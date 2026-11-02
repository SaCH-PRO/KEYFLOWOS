/**
 * Native DAST harness (V1-13-SEC-NATIVE-DAST, PRS-M08, PRS-M09).
 *
 * The required admission gate 'DAST (HawkScan)' goes green without scanning
 * whenever HAWK_API_KEY is absent (its guard step short-circuits every heavy
 * step). This harness, ported from #114, needs no third-party account: it
 * boots the API locally and sends unauthenticated requests to protected
 * routes, which must answer 401 or 403 and nothing else.
 *
 * #114 probed no Release 0 route (PRS-M09). The manifest must now carry
 * unauthenticated probes for the five Release 0 money/CRM routes below.
 *
 * Every protected route the manifest probes is AuthGuard-first, so an
 * anonymous call and a call whose credential authentication must refuse both
 * get 401. A 403 there is what BusinessGuard answers a caller authentication
 * ACCEPTED, so a forged token that slipped through the verifier would pass on
 * 403 (review SEC-DAST-1): such probes expect exactly [401], and the harness
 * fails an invalid_credential probe on 403 whatever its expected_status says.
 * The bearer probes are JWT-shaped (alg none, wrong key, expired, wrong
 * audience, foreign issuer), and the workflow gives the server its verifier
 * keys, so each verifier check is reached; a valid token for a non-member
 * must get 403, which also proves the server holds the key (SEC-DAST-2).
 *
 * What this spec holds:
 *   1. The manifest contract: each Release 0 route has an unauthenticated
 *      probe (no Authorization, no Cookie) expecting exactly [401] and an
 *      invalid-credential probe expecting exactly [401]; every protected probe
 *      expects a subset of [401, 403]; each verifier check is targeted by one
 *      JWT probe whose only defect is that check; the manifest validates.
 *   2. evaluateProbeResult fails a 404 from a protected route, any 5xx, an
 *      unexpected status (200, a redirect, a 400), a forbidden body marker,
 *      and a 403 to an invalid credential, even when a probe's expected_status
 *      was widened to allow them.
 *   3. validateManifest refuses a manifest that would let a weak probe pass.
 *   4. Minted tokens are what the manifest declares, and a probe's declared
 *      headers and body are what reach the server (review CR-1).
 *   5. runProbes against a real local HTTP server: a probe passes only on the
 *      right answer; a server that accepts forged tokens, drops one verifier
 *      check, or holds no verifier key fails; an unreachable base URL is a
 *      transport failure on every probe, never a skip.
 *   6. The CLI exits non-zero on a transport failure, on a non-loopback base
 *      URL (the harness never probes a remote host) and on an unset signing
 *      key.
 *   7. The workflow runs this spec before the probe job, with no secret and
 *      no continue-on-error, and gives the server and the harness one random
 *      verifier key per run.
 *
 * REQUIRED_WORKFLOWS (scripts/agent-control/lib/events.mjs) is deliberately
 * not asserted here: the gate swap is V1-30, which edits that list.
 *
 * Run: node --test scripts/security/tests/native-dast.spec.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseYaml } from '../../agent-control/lib/yaml.mjs';
import {
  PROTECTED_STATUSES,
  INVALID_CREDENTIAL_STATUSES,
  evaluateProbeResult,
  validateManifest,
  resolveBaseUrl,
  resolveSigningKeys,
  mintBearerJwt,
  buildProbeRequest,
  runProbes,
} from '../native-dast.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const harnessPath = path.join(repoRoot, 'scripts/security/native-dast.mjs');
const manifestPath = path.join(repoRoot, 'scripts/security/native-dast-manifest.json');
const workflowPath = path.join(repoRoot, '.github/workflows/native-dast.yml');
const supabaseAuthPath = path.join(repoRoot, 'apps/server/src/core/auth/supabase-auth.service.ts');

const loadManifest = () => JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

// The variable SupabaseAuthService.verifyLocal verifies with, and a stand-in
// value for it in this spec (the workflow makes a random one per run).
const KEY_ENV = 'SUPABASE_JWT_SECRET';
const TEST_KEY = 'native-dast-spec-key-0123456789abcdef';
const TEST_ENV = { [KEY_ENV]: TEST_KEY };

// The Release 0 routes this packet must probe, as the server declares them
// (apps/server/src/modules/crm/crm.controller.ts and
// apps/server/src/modules/commerce/commerce.controller.ts).
const RELEASE0_ROUTES = [
  { name: 'contacts', method: 'GET', path: /^\/crm\/businesses\/[^/]+\/contacts$/ },
  { name: 'invoices', method: 'GET', path: /^\/commerce\/businesses\/[^/]+\/invoices$/ },
  { name: 'invoice detail', method: 'GET', path: /^\/commerce\/businesses\/[^/]+\/invoices\/[^/]+$/ },
  { name: 'payments-record', method: 'POST', path: /^\/commerce\/businesses\/[^/]+\/invoices\/[^/]+\/payments$/ },
  { name: 'tenant payments', method: 'GET', path: /^\/commerce\/businesses\/[^/]+\/payments$/ },
];

const CREDENTIAL_HEADERS = new Set(['authorization', 'cookie', 'x-api-key', 'proxy-authorization']);

function isUnauthenticated(probe) {
  return probe.bearer_jwt === undefined
    && Object.keys(probe.headers || {}).every((name) => !CREDENTIAL_HEADERS.has(name.toLowerCase()));
}

function sortedStatuses(probe) {
  return [...(probe.expected_status || [])].sort((a, b) => a - b);
}

function isSubsetOfProtected(probe) {
  const statuses = probe.expected_status || [];
  return statuses.length > 0 && statuses.every((s) => PROTECTED_STATUSES.includes(s));
}

function decodeJwt(token) {
  const parts = token.split('.');
  assert.equal(parts.length, 3, `not a three-part JWT: ${token}`);
  const [h, b, signature] = parts;
  return {
    header: JSON.parse(Buffer.from(h, 'base64url').toString('utf8')),
    payload: JSON.parse(Buffer.from(b, 'base64url').toString('utf8')),
    signingInput: `${h}.${b}`,
    signature,
  };
}

const hs256 = (key, input) => createHmac('sha256', key).update(input).digest('base64url');

function bearerOf(authorization) {
  const match = /^Bearer (.+)$/.exec(authorization ?? '');
  return match ? match[1] : null;
}

/**
 * A model of the server's answer on an AuthGuard-first, business-scoped route
 * (AuthMiddleware -> SupabaseAuthService.verifyLocal with no SUPABASE_URL under
 * NODE_ENV=test -> AuthGuard -> BusinessGuard): 401 unless the bearer is an
 * HS256 JWT signed with `key`, live, with aud 'authenticated' and no iss, in
 * which case the caller is authenticated but no member, so 403. `drop` removes
 * checks (alg, sig, exp, aud, iss) to model a broken verifier; `key` null
 * models a server with no verifier key.
 */
function modelAnswer(authorization, { key = TEST_KEY, drop = [] } = {}) {
  const token = bearerOf(authorization);
  if (!token || !key) return 401;
  const parts = token.split('.');
  if (parts.length !== 3) return 401;
  try {
    const { header, payload, signingInput, signature } = decodeJwt(token);
    if (!drop.includes('alg') && header.alg !== 'HS256') return 401;
    if (!drop.includes('sig') && signature !== hs256(key, signingInput)) return 401;
    if (!drop.includes('exp') && (typeof payload.exp !== 'number' || payload.exp < Date.now() / 1000)) return 401;
    if (!drop.includes('iss') && payload.iss !== undefined) return 401;
    if (!drop.includes('aud') && payload.aud !== 'authenticated') return 401;
    return 403;
  } catch {
    return 401;
  }
}

// The verifier check a JWT probe's token is built to fail, and so the checks
// a server must drop before it is accepted.
function targetedChecks(jwt) {
  if (jwt.signing === 'none') return ['alg', 'sig'];
  if (jwt.signing === 'random-key') return ['sig'];
  if (jwt.exp_in_s < 0) return ['exp'];
  if (jwt.claims?.aud !== 'authenticated') return ['aud'];
  if (jwt.claims?.iss !== undefined) return ['iss'];
  return [];
}

// A real HTTP server on an ephemeral loopback port. `answer` is either a
// function (req, body) -> [status, body], or a map of "METHOD /path" to
// [status, body] where anything else answers 404. Every request is recorded
// with its headers and body.
async function startStub(answer) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      seen.push({
        method: req.method,
        url: req.url,
        authorization: req.headers.authorization ?? null,
        headers: { ...req.headers },
        body,
      });
      const hit = typeof answer === 'function'
        ? answer(req, body)
        : answer[`${req.method} ${req.url}`] ?? answer['*'];
      const [status, responseBody] = hit ?? [404, '{"statusCode":404,"message":"Cannot GET"}'];
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(responseBody);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    seen,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

// The server model for every protected path in `manifest`; healthz answers ok
// and anything else 404.
function modelServer(manifest, options = {}) {
  const protectedRoutes = new Set(
    manifest.probes.filter((p) => p.protected).map((p) => `${p.method || 'GET'} ${p.path}`),
  );
  return (req) => {
    if (req.method === 'GET' && req.url === '/healthz') return [200, '{"status":"ok","uptimeSec":1}'];
    if (!protectedRoutes.has(`${req.method} ${req.url}`)) return undefined;
    const status = options.override?.(req) ?? modelAnswer(req.headers.authorization, options);
    const message = status === 401 ? 'Authentication required' : status === 403 ? 'No access to this business' : 'ok';
    return [status, JSON.stringify({ statusCode: status, message })];
  };
}

// A loopback port nothing listens on: bind an ephemeral port, then release it.
async function closedPort() {
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function runCli(args, env) {
  // spawn (not spawnSync): the stub server lives in this process's event loop.
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [harnessPath, ...args], {
      cwd: repoRoot,
      env: { PATH: process.env.PATH, ...env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

// ---------------------------------------------------------------------------
// 1. Manifest contract
// ---------------------------------------------------------------------------

test('PROTECTED_STATUSES is exactly 401 and 403; INVALID_CREDENTIAL_STATUSES is exactly 401', () => {
  assert.deepEqual([...PROTECTED_STATUSES].sort((a, b) => a - b), [401, 403]);
  assert.deepEqual([...INVALID_CREDENTIAL_STATUSES], [401]);
});

for (const route of RELEASE0_ROUTES) {
  test(`manifest probes the Release 0 ${route.name} route unauthenticated and with an invalid credential, expecting only 401`, () => {
    const manifest = loadManifest();
    const probes = manifest.probes.filter(
      (p) => (p.method || 'GET') === route.method && route.path.test(p.path),
    );
    assert.ok(probes.length > 0, `no probe for ${route.method} ${route.path}`);
    const unauthenticated = probes.filter(isUnauthenticated);
    assert.ok(unauthenticated.length > 0, `the ${route.name} probe must send no credential header`);
    for (const probe of unauthenticated) {
      assert.deepEqual(sortedStatuses(probe), [401], `${probe.id}: an anonymous caller of an AuthGuard-first route gets 401`);
    }
    const invalid = probes.filter((p) => p.invalid_credential === true);
    assert.ok(invalid.length > 0, `the ${route.name} route needs an invalid-credential probe`);
    for (const probe of invalid) {
      assert.deepEqual(sortedStatuses(probe), [401], `${probe.id}: an invalid credential must get 401, never 403`);
    }
    for (const probe of probes) {
      assert.equal(probe.protected, true, `${probe.id} must be marked protected`);
      assert.ok(isSubsetOfProtected(probe), `${probe.id} must expect only statuses from [401, 403]`);
    }
  });
}

test('the shipped manifest validates, every protected probe expects a subset of 401/403, ids are unique', () => {
  const manifest = loadManifest();
  assert.deepEqual(validateManifest(manifest), []);
  const ids = manifest.probes.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const probe of manifest.probes.filter((p) => p.protected)) {
    assert.ok(isSubsetOfProtected(probe), probe.id);
    // Every probed protected route is AuthGuard-first: anonymous and refused
    // credentials get 401; only a credential the verifier accepts may get 403.
    if (isUnauthenticated(probe) || probe.invalid_credential === true) {
      assert.deepEqual(sortedStatuses(probe), [401], probe.id);
    } else {
      assert.equal(probe.bearer_jwt?.signing, 'env-key', `${probe.id}: a credential probe that is not invalid_credential must be the valid-token control`);
      assert.deepEqual(targetedChecks(probe.bearer_jwt), [], `${probe.id}: the valid-token control must carry no defect`);
      assert.deepEqual(sortedStatuses(probe), [403], probe.id);
    }
  }
  // Leak markers the probes check every body for.
  for (const marker of ['PrismaClientKnownRequestError', 'node_modules/', 'TypeError:']) {
    assert.ok(manifest.forbidden_body_patterns.includes(marker), `missing forbidden marker ${marker}`);
  }
});

test('each verifier check is targeted by a JWT probe whose only defect is that check (SEC-DAST-2)', () => {
  const manifest = loadManifest();
  const jwtProbes = manifest.probes.filter((p) => p.bearer_jwt);
  const targeted = new Set();
  for (const probe of jwtProbes) {
    const checks = targetedChecks(probe.bearer_jwt);
    const token = mintBearerJwt(probe.bearer_jwt, TEST_ENV);
    const authorization = `Bearer ${token}`;
    if (checks.length === 0) {
      assert.equal(modelAnswer(authorization), 403, `${probe.id}: the control token must verify`);
      continue;
    }
    assert.equal(probe.invalid_credential, true, `${probe.id} must be invalid_credential`);
    assert.equal(modelAnswer(authorization), 401, `${probe.id}: a correct verifier refuses it`);
    assert.equal(modelAnswer(authorization, { drop: checks }), 403, `${probe.id}: only ${checks.join('+')} refuses it`);
    targeted.add(checks.join('+'));
  }
  for (const check of ['alg+sig', 'sig', 'exp', 'aud', 'iss']) {
    assert.ok(targeted.has(check), `no JWT probe targets ${check}`);
  }
  const controls = jwtProbes.filter((p) => targetedChecks(p.bearer_jwt).length === 0);
  assert.ok(controls.length > 0, 'the manifest needs a valid-token control (proves the server holds the key)');
  assert.ok(controls.every((p) => RELEASE0_ROUTES.some((r) => r.path.test(p.path))), 'the control runs on a Release 0 route');
});

test('env-key probes sign with SUPABASE_JWT_SECRET, the variable the server verifies with', () => {
  const source = fs.readFileSync(supabaseAuthPath, 'utf8');
  assert.match(source, /process\.env\.SUPABASE_JWT_SECRET/);
  const envKeyProbes = loadManifest().probes.filter((p) => p.bearer_jwt?.signing === 'env-key');
  assert.ok(envKeyProbes.length > 0);
  for (const probe of envKeyProbes) assert.equal(probe.bearer_jwt.key_env, KEY_ENV, probe.id);
});

// ---------------------------------------------------------------------------
// 2. evaluateProbeResult (ported from #114, extended)
// ---------------------------------------------------------------------------

test('protected routes accept only explicit auth rejection statuses', () => {
  const probe = { expected_status: [401, 403], protected: true };
  assert.deepEqual(evaluateProbeResult(probe, { status: 401 }, '', []), []);
  assert.deepEqual(evaluateProbeResult(probe, { status: 403 }, '', []), []);
  assert.ok(evaluateProbeResult(probe, { status: 200 }, '', []).some((x) => x.includes('not in expected')));
});

test('NC verifier bypass: an invalid credential answered 403 fails even when 403 is allowlisted', () => {
  const probe = { expected_status: [401, 403], protected: true, invalid_credential: true };
  assert.deepEqual(evaluateProbeResult(probe, { status: 401 }, '', []), []);
  const problems = evaluateProbeResult(probe, { status: 403 }, '{"message":"No access to this business"}', []);
  assert.ok(problems.some((x) => x.includes('invalid credential answered 403')), JSON.stringify(problems));
  // A 401-only expectation fails a 403 too.
  assert.ok(evaluateProbeResult({ ...probe, expected_status: [401] }, { status: 403 }, '', []).length > 0);
});

test('NC 404-as-security: a missing protected route is never accepted as proof', () => {
  const probe = { expected_status: [401, 403, 404], protected: true };
  const problems = evaluateProbeResult(probe, { status: 404 }, '', []);
  assert.ok(problems.some((x) => x.includes('route absence')));
});

test('NC hidden server failure: 5xx can never pass even if mistakenly allowlisted', () => {
  for (const status of [500, 502, 503, 504]) {
    const problems = evaluateProbeResult({ expected_status: [status] }, { status }, '', []);
    assert.ok(problems.some((x) => x.includes('server error')), `status ${status}`);
  }
});

test('NC widened allowlist: a protected route answering 200, 302 or 400 fails even when allowlisted', () => {
  for (const status of [200, 204, 302, 400, 422]) {
    const probe = { expected_status: [401, 403, status], protected: true };
    const problems = evaluateProbeResult(probe, { status }, '', []);
    assert.ok(problems.length > 0, `protected probe passed on ${status}`);
  }
});

test('NC internal leakage: stack/database markers make the probe fail', () => {
  const probe = { expected_status: [401] };
  const problems = evaluateProbeResult(
    probe,
    { status: 401 },
    'PrismaClientKnownRequestError at node_modules/pkg/index.js',
    ['PrismaClientKnownRequestError', 'node_modules/'],
  );
  assert.equal(problems.length, 2);
});

test('NC internal leakage on a protected 403: the auth answer does not excuse a leaked marker', () => {
  const probe = { expected_status: [401, 403], protected: true };
  const problems = evaluateProbeResult(probe, { status: 403 }, '{"message":"TypeError: x is undefined"}', ['TypeError:']);
  assert.ok(problems.some((x) => x.includes('forbidden internal marker')));
});

test('a missing or non-numeric status is a failure, never a pass', () => {
  const probe = { expected_status: [401, 403], protected: true };
  assert.ok(evaluateProbeResult(probe, { status: null }, '', []).length > 0);
  assert.ok(evaluateProbeResult(probe, {}, '', []).length > 0);
});

test('public health proof requires its expected body marker', () => {
  const probe = { expected_status: [200], body_must_include: ['"status":"ok"'] };
  assert.deepEqual(evaluateProbeResult(probe, { status: 200 }, '{"status":"ok"}', []), []);
  assert.ok(evaluateProbeResult(probe, { status: 200 }, '{"status":"bad"}', []).length > 0);
});

// ---------------------------------------------------------------------------
// 3. validateManifest
// ---------------------------------------------------------------------------

const goodProbe = { id: 'p', method: 'GET', path: '/x', expected_status: [401, 403], protected: true };
const manifestWith = (probes) => ({ probes, forbidden_body_patterns: ['TypeError:'] });
const goodJwt = { signing: 'env-key', key_env: KEY_ENV, exp_in_s: 3600, claims: { aud: 'authenticated' } };
const forgedProbe = {
  id: 'f', method: 'GET', path: '/x', expected_status: [401], protected: true, invalid_credential: true,
  bearer_jwt: { signing: 'none', exp_in_s: 3600, claims: { aud: 'authenticated' } },
};

test('validateManifest refuses an empty or missing probe list (no vacuous green)', () => {
  assert.ok(validateManifest({ forbidden_body_patterns: [] }).length > 0);
  assert.ok(validateManifest(manifestWith([])).length > 0);
});

test('validateManifest refuses a protected probe allowing anything beyond 401/403', () => {
  for (const extra of [200, 302, 404, 500]) {
    const problems = validateManifest(manifestWith([{ ...goodProbe, expected_status: [401, 403, extra] }]));
    assert.ok(problems.length > 0, `protected probe allowing ${extra} validated`);
  }
});

test('validateManifest refuses any probe allowlisting a 5xx, an empty expectation, a duplicate id, an absolute URL', () => {
  assert.ok(validateManifest(manifestWith([{ id: 'h', path: '/healthz', expected_status: [200, 503] }])).length > 0);
  assert.ok(validateManifest(manifestWith([{ ...goodProbe, expected_status: [] }])).length > 0);
  assert.ok(validateManifest(manifestWith([goodProbe, { ...goodProbe }])).length > 0);
  assert.ok(validateManifest(manifestWith([{ ...goodProbe, path: 'https://example.com/x' }])).length > 0);
  assert.ok(validateManifest(manifestWith([{ ...goodProbe, path: '//example.com/x' }])).length > 0);
  assert.deepEqual(validateManifest(manifestWith([goodProbe])), []);
});

test('validateManifest refuses an invalid_credential probe that could pass on 403, or that carries no credential', () => {
  assert.deepEqual(validateManifest(manifestWith([forgedProbe])), []);
  const header = { ...goodProbe, expected_status: [401], invalid_credential: true, headers: { authorization: 'Bearer x' } };
  assert.deepEqual(validateManifest(manifestWith([header])), []);
  for (const expected of [[401, 403], [403]]) {
    const problems = validateManifest(manifestWith([{ ...forgedProbe, expected_status: expected }]));
    assert.ok(problems.some((x) => x.includes('may expect only 401')), `${expected} validated: ${problems}`);
  }
  const { bearer_jwt: _drop, ...noCredential } = forgedProbe;
  assert.ok(validateManifest(manifestWith([noCredential])).some((x) => x.includes('must carry a credential')));
  assert.ok(validateManifest(manifestWith([{ ...forgedProbe, protected: false }])).some((x) => x.includes('must be protected')));
  assert.ok(validateManifest(manifestWith([{ ...forgedProbe, invalid_credential: 'yes' }])).length > 0);
});

test('validateManifest refuses a malformed bearer_jwt', () => {
  const withJwt = (bearer_jwt, extra = {}) => manifestWith([{ ...goodProbe, expected_status: [403], bearer_jwt, ...extra }]);
  assert.deepEqual(validateManifest(withJwt(goodJwt)), []);
  const cases = {
    'unknown signing': withJwt({ ...goodJwt, signing: 'rs256' }),
    'env-key without key_env': withJwt({ ...goodJwt, key_env: undefined }),
    'lower-case key_env': withJwt({ ...goodJwt, key_env: 'supabase' }),
    'key_env on random-key': manifestWith([{ ...forgedProbe, bearer_jwt: { ...forgedProbe.bearer_jwt, signing: 'random-key', key_env: KEY_ENV } }]),
    'missing exp_in_s': withJwt({ ...goodJwt, exp_in_s: undefined }),
    'claims setting sub': withJwt({ ...goodJwt, claims: { sub: 'real-user' } }),
    'claims setting exp': withJwt({ ...goodJwt, claims: { exp: 1 } }),
    'claims as array': withJwt({ ...goodJwt, claims: ['aud'] }),
    'not an object': withJwt('token'),
    'alongside an authorization header': withJwt(goodJwt, { headers: { authorization: 'Bearer x' } }),
    'non-string header': manifestWith([{ ...goodProbe, headers: { authorization: 1 } }]),
  };
  for (const [name, manifest] of Object.entries(cases)) {
    assert.ok(validateManifest(manifest).length > 0, `${name} validated`);
  }
  for (const signing of ['none', 'random-key']) {
    const problems = validateManifest(withJwt({ signing, exp_in_s: 3600 }));
    assert.ok(problems.some((x) => x.includes('can never verify')), `${signing} without invalid_credential validated`);
  }
});

// ---------------------------------------------------------------------------
// 4. Minted tokens and the request a probe sends (review CR-1)
// ---------------------------------------------------------------------------

test('mintBearerJwt: alg none carries an empty signature; random-key never verifies with the server key', () => {
  const none = decodeJwt(mintBearerJwt({ signing: 'none', exp_in_s: 3600, claims: { aud: 'authenticated' } }));
  assert.equal(none.header.alg, 'none');
  assert.equal(none.signature, '');
  assert.equal(none.payload.aud, 'authenticated');

  const spec = { signing: 'random-key', exp_in_s: 3600, claims: { aud: 'authenticated' } };
  const a = decodeJwt(mintBearerJwt(spec, TEST_ENV));
  const b = decodeJwt(mintBearerJwt(spec, TEST_ENV));
  assert.equal(a.header.alg, 'HS256');
  assert.notEqual(a.signature, hs256(TEST_KEY, a.signingInput));
  assert.notEqual(a.signature, b.signature, 'each random-key token is signed with a fresh key');
});

test('mintBearerJwt: env-key verifies with the key, sets exp from exp_in_s, a fresh sub, and merges claims', () => {
  const before = Math.floor(Date.now() / 1000);
  const spec = { signing: 'env-key', key_env: KEY_ENV, exp_in_s: -3600, claims: { aud: 'x', iss: 'https://i.invalid/auth/v1' } };
  const one = decodeJwt(mintBearerJwt(spec, TEST_ENV));
  const two = decodeJwt(mintBearerJwt(spec, TEST_ENV));
  const after = Math.floor(Date.now() / 1000);
  assert.equal(one.header.alg, 'HS256');
  assert.equal(one.signature, hs256(TEST_KEY, one.signingInput));
  assert.ok(one.payload.exp >= before - 3600 && one.payload.exp <= after - 3600, 'exp is now + exp_in_s');
  assert.ok(one.payload.iat < one.payload.exp && one.payload.iat <= after);
  assert.equal(one.payload.aud, 'x');
  assert.equal(one.payload.iss, 'https://i.invalid/auth/v1');
  assert.match(one.payload.sub, /^[0-9a-f-]{36}$/);
  assert.notEqual(one.payload.sub, two.payload.sub, 'every token names a fresh subject');
  assert.throws(() => mintBearerJwt(spec, {}), /SUPABASE_JWT_SECRET/);
});

test('resolveSigningKeys names an unset or empty key variable and needs nothing without env-key probes', () => {
  const manifest = manifestWith([{ ...goodProbe, expected_status: [403], bearer_jwt: goodJwt }]);
  assert.deepEqual(resolveSigningKeys(manifest, TEST_ENV), TEST_ENV);
  assert.throws(() => resolveSigningKeys(manifest, {}), /SUPABASE_JWT_SECRET not set/);
  assert.throws(() => resolveSigningKeys(manifest, { [KEY_ENV]: '' }), /SUPABASE_JWT_SECRET not set/);
  assert.deepEqual(resolveSigningKeys(manifestWith([goodProbe, forgedProbe]), {}), {});
});

test('buildProbeRequest sends the declared headers and body verbatim, plus the minted bearer', () => {
  const probe = {
    ...forgedProbe,
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-trace': 'native-dast' },
    body: { amount: 1 },
  };
  const request = buildProbeRequest(probe, TEST_ENV);
  assert.equal(request.method, 'POST');
  assert.equal(request.headers['content-type'], 'application/json');
  assert.equal(request.headers['x-trace'], 'native-dast');
  assert.equal(decodeJwt(bearerOf(request.headers.authorization)).header.alg, 'none');
  assert.equal(request.body, '{"amount":1}');
  assert.equal(probe.headers.authorization, undefined, 'the probe itself is not mutated');
  const literal = buildProbeRequest({ ...goodProbe, headers: { authorization: 'Bearer literal' } });
  assert.equal(literal.headers.authorization, 'Bearer literal');
  assert.equal(literal.body, undefined);
});

// ---------------------------------------------------------------------------
// 5. runProbes against a real local HTTP server
// ---------------------------------------------------------------------------

test('runProbes passes every shipped probe against a correct server, and every probe arrives as declared', async () => {
  const manifest = loadManifest();
  const stub = await startStub(modelServer(manifest));
  try {
    const summary = await runProbes(manifest, { baseUrl: stub.baseUrl, env: TEST_ENV });
    assert.equal(summary.probes, manifest.probes.length);
    assert.equal(summary.failed, 0, JSON.stringify(summary.results.filter((r) => !r.passed), null, 2));
    assert.equal(summary.passed, manifest.probes.length);
    // Every probe reached the server once, in manifest order (runProbes is
    // sequential), with the method, path, headers and body it declares.
    assert.equal(stub.seen.length, manifest.probes.length);
    const now = Date.now() / 1000;
    manifest.probes.forEach((probe, index) => {
      const req = stub.seen[index];
      assert.equal(req.method, probe.method || 'GET', probe.id);
      assert.equal(req.url, probe.path, probe.id);
      for (const [name, value] of Object.entries(probe.headers || {})) {
        assert.equal(req.headers[name.toLowerCase()], value, `${probe.id}: header ${name} did not arrive as declared`);
      }
      if (probe.bearer_jwt) {
        const token = bearerOf(req.authorization);
        assert.ok(token, `${probe.id}: the minted bearer did not arrive`);
        const jwt = decodeJwt(token);
        const spec = probe.bearer_jwt;
        assert.equal(jwt.header.alg, spec.signing === 'none' ? 'none' : 'HS256', probe.id);
        for (const [claim, value] of Object.entries(spec.claims || {})) {
          assert.deepEqual(jwt.payload[claim], value, `${probe.id}: claim ${claim}`);
        }
        assert.ok(Math.abs(jwt.payload.exp - (now + spec.exp_in_s)) < 120, `${probe.id}: exp`);
        if (spec.signing === 'env-key') assert.equal(jwt.signature, hs256(TEST_KEY, jwt.signingInput), probe.id);
        else assert.notEqual(jwt.signature, hs256(TEST_KEY, jwt.signingInput), probe.id);
      } else if (isUnauthenticated(probe)) {
        assert.equal(req.authorization, null, `${probe.id} must reach the server unauthenticated`);
        assert.equal(req.headers.cookie, undefined, probe.id);
      }
      if (probe.body !== undefined) {
        assert.deepEqual(JSON.parse(req.body), probe.body, `${probe.id}: body did not arrive as declared`);
      } else {
        assert.equal(req.body, '', `${probe.id} sent a body it does not declare`);
      }
    });
  } finally {
    await stub.close();
  }
});

test('NC verifier bypass (SEC-DAST-1): a server that authenticates any bearer fails exactly the invalid-credential probes', async () => {
  const manifest = loadManifest();
  // Any bearer authenticates; BusinessGuard then refuses the non-member: 403.
  const stub = await startStub(modelServer(manifest, { override: (req) => (bearerOf(req.headers.authorization) ? 403 : 401) }));
  try {
    const summary = await runProbes(manifest, { baseUrl: stub.baseUrl, env: TEST_ENV });
    const invalidIds = manifest.probes.filter((p) => p.invalid_credential).map((p) => p.id).sort();
    const failed = summary.results.filter((r) => !r.passed);
    assert.ok(invalidIds.length >= 6);
    assert.deepEqual(failed.map((r) => r.id).sort(), invalidIds);
    for (const result of failed) {
      assert.equal(result.status, 403);
      assert.ok(result.problems.some((x) => x.includes('invalid credential answered 403')), result.id);
    }
  } finally {
    await stub.close();
  }
});

test('NC dropped verifier check: each JWT probe fails when the server drops the check it targets', async () => {
  const manifest = loadManifest();
  for (const drop of [['alg', 'sig'], ['sig'], ['exp'], ['aud'], ['iss']]) {
    const stub = await startStub(modelServer(manifest, { drop }));
    try {
      const summary = await runProbes(manifest, { baseUrl: stub.baseUrl, env: TEST_ENV });
      const expectedFail = manifest.probes
        .filter((p) => p.bearer_jwt && targetedChecks(p.bearer_jwt).length > 0
          && targetedChecks(p.bearer_jwt).every((c) => drop.includes(c)))
        .map((p) => p.id).sort();
      assert.ok(expectedFail.length > 0, `no probe catches a verifier without ${drop.join('+')}`);
      const failed = summary.results.filter((r) => !r.passed);
      assert.deepEqual(failed.map((r) => r.id).sort(), expectedFail, `dropping ${drop.join('+')}`);
      assert.ok(failed.every((r) => r.status === 403));
    } finally {
      await stub.close();
    }
  }
});

test('NC no verifier key (SEC-DAST-2): a server that verifies nothing fails the valid-token control', async () => {
  const manifest = loadManifest();
  for (const options of [{ key: null }, { key: 'a-different-key' }]) {
    const stub = await startStub(modelServer(manifest, options));
    try {
      const summary = await runProbes(manifest, { baseUrl: stub.baseUrl, env: TEST_ENV });
      const failed = summary.results.filter((r) => !r.passed);
      const controls = manifest.probes.filter((p) => p.bearer_jwt && targetedChecks(p.bearer_jwt).length === 0);
      assert.deepEqual(failed.map((r) => r.id).sort(), controls.map((p) => p.id).sort());
      assert.ok(failed.every((r) => r.status === 401));
    } finally {
      await stub.close();
    }
  }
});

test('NC unguarded route: one protected route answering 200 fails exactly that probe', async () => {
  const manifest = loadManifest();
  const target = manifest.probes.find((p) => p.protected && /\/commerce\/businesses\/[^/]+\/payments$/.test(p.path));
  const stub = await startStub(modelServer(manifest, {
    override: (req) => (req.method === 'GET' && req.url === target.path ? 200 : undefined),
  }));
  try {
    const summary = await runProbes(manifest, { baseUrl: stub.baseUrl, env: TEST_ENV });
    const failed = summary.results.filter((r) => !r.passed);
    assert.ok(failed.length > 0);
    assert.ok(failed.every((r) => r.path === target.path), JSON.stringify(failed));
    assert.ok(failed.some((r) => r.id === target.id && r.status === 200));
  } finally {
    await stub.close();
  }
});

test('NC route absent: protected routes answering 404 fail', async () => {
  const manifest = loadManifest();
  const stub = await startStub({ 'GET /healthz': [200, '{"status":"ok"}'] });
  try {
    const summary = await runProbes(manifest, { baseUrl: stub.baseUrl, env: TEST_ENV });
    const protectedResults = summary.results.filter((r) => manifest.probes.find((p) => p.id === r.id).protected);
    assert.ok(protectedResults.length > 0);
    assert.ok(protectedResults.every((r) => !r.passed && r.problems.some((x) => x.includes('route absence'))));
  } finally {
    await stub.close();
  }
});

test('an unreachable base URL is a transport failure on every probe, never a skip', async () => {
  const manifest = loadManifest();
  const port = await closedPort();
  const summary = await runProbes(manifest, { baseUrl: `http://127.0.0.1:${port}`, timeoutMs: 3000, env: TEST_ENV });
  assert.equal(summary.probes, manifest.probes.length);
  assert.equal(summary.failed, manifest.probes.length);
  assert.equal(summary.passed, 0);
  for (const result of summary.results) {
    assert.equal(result.passed, false);
    assert.ok(result.problems.some((x) => x.startsWith('transport failure')), JSON.stringify(result));
  }
  assert.ok(!JSON.stringify(summary).toLowerCase().includes('skip'));
});

test('a server that never answers is a transport failure (timeout), not a hang', async () => {
  const server = http.createServer(() => { /* never responds */ });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const summary = await runProbes(
      manifestWith([{ ...goodProbe, path: '/hang' }]),
      { baseUrl: `http://127.0.0.1:${port}`, timeoutMs: 300 },
    );
    assert.equal(summary.failed, 1);
    assert.ok(summary.results[0].problems.some((x) => x.startsWith('transport failure')));
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('runProbes refuses an invalid manifest instead of reporting it green', async () => {
  await assert.rejects(() => runProbes(manifestWith([]), { baseUrl: 'http://127.0.0.1:1' }), /manifest/);
});

test('runProbes refuses to run, sending nothing, when a signing key is unset', async () => {
  const manifest = loadManifest();
  const stub = await startStub(modelServer(manifest));
  try {
    await assert.rejects(() => runProbes(manifest, { baseUrl: stub.baseUrl, env: {} }), /SUPABASE_JWT_SECRET not set/);
    assert.equal(stub.seen.length, 0);
  } finally {
    await stub.close();
  }
});

// ---------------------------------------------------------------------------
// 6. CLI exit codes
// ---------------------------------------------------------------------------

test('CLI: unreachable base URL exits non-zero and reports every probe failed', async () => {
  const port = await closedPort();
  const { code, stdout } = await runCli([manifestPath], { ...TEST_ENV, NATIVE_DAST_BASE_URL: `http://127.0.0.1:${port}` });
  assert.notEqual(code, 0);
  const summary = JSON.parse(stdout);
  assert.equal(summary.failed, summary.probes);
  assert.ok(summary.probes > 0);
});

test('CLI: all probes answered correctly exits 0', async () => {
  const manifest = loadManifest();
  const stub = await startStub(modelServer(manifest));
  try {
    const { code, stdout, stderr } = await runCli([manifestPath], { ...TEST_ENV, NATIVE_DAST_BASE_URL: stub.baseUrl });
    assert.equal(code, 0, stdout + stderr);
    assert.equal(JSON.parse(stdout).failed, 0);
    assert.ok(!stdout.includes(TEST_KEY) && !stderr.includes(TEST_KEY), 'the signing key is never printed');
    assert.ok(!/eyJ[\w-]+\.[\w-]+\./.test(stdout + stderr), 'minted tokens are never printed');
  } finally {
    await stub.close();
  }
});

test('CLI: an unset signing key is a configuration refusal (exit 2) before any request', async () => {
  const manifest = loadManifest();
  const stub = await startStub(modelServer(manifest));
  try {
    const { code, stdout } = await runCli([manifestPath], { NATIVE_DAST_BASE_URL: stub.baseUrl });
    assert.equal(code, 2);
    assert.match(JSON.parse(stdout).error, /SUPABASE_JWT_SECRET not set/);
    assert.equal(stub.seen.length, 0);
  } finally {
    await stub.close();
  }
});

test('CLI: a remote base URL is refused before any request (exit non-zero)', () => {
  const result = spawnSync(process.execPath, [harnessPath, manifestPath], {
    cwd: repoRoot,
    env: { PATH: process.env.PATH, ...TEST_ENV, NATIVE_DAST_BASE_URL: 'https://keyflowos.example' },
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout + result.stderr, /loopback/);
});

// ---------------------------------------------------------------------------
// 7. Workflow contract
// ---------------------------------------------------------------------------

test('native-dast.yml runs this spec in a job the probe job needs, with no secret and no soft gate', () => {
  const text = fs.readFileSync(workflowPath, 'utf8');
  const wf = parseYaml(text);
  assert.equal(wf.name, 'DAST (Native)');

  const jobs = Object.entries(wf.jobs);
  const runs = (job) => (job.steps || []).map((s) => s.run || '').join('\n');
  const specJob = jobs.find(([, job]) => runs(job).includes('node --test scripts/security/tests/native-dast.spec.mjs'));
  const probeJob = jobs.find(([, job]) =>
    runs(job).includes('node scripts/security/native-dast.mjs scripts/security/native-dast-manifest.json'));
  assert.ok(specJob, 'no job runs the native DAST spec');
  assert.ok(probeJob, 'no job runs the native DAST probes');
  assert.notEqual(specJob[0], probeJob[0], 'the spec runs in its own job, before the probe job');
  const needs = [].concat(probeJob[1].needs || []);
  assert.ok(needs.includes(specJob[0]), `probe job must need ${specJob[0]}`);

  // The probe job boots the built server and waits for health before probing.
  const probeRuns = runs(probeJob[1]);
  assert.match(probeRuns, /node apps\/server\/dist\/main\.js/);
  assert.match(probeRuns, /\/healthz/);

  // Loopback target, no third-party secret, no soft gate, no Supabase provider.
  const baseUrl = probeJob[1].env?.NATIVE_DAST_BASE_URL ?? wf.env?.NATIVE_DAST_BASE_URL;
  assert.equal(resolveBaseUrl({ NATIVE_DAST_BASE_URL: baseUrl }), baseUrl.replace(/\/$/, ''));
  assert.ok(!text.includes('secrets.'), 'the native harness must not need a repository secret');
  assert.ok(!/SUPABASE_URL/.test(text), 'probes must not reach a Supabase provider');
  assert.ok(!/SUPABASE_ANON_KEY/.test(text), 'probes must not reach a Supabase provider');
  for (const [, job] of jobs) {
    assert.notEqual(job['continue-on-error'], true);
    for (const step of job.steps || []) assert.notEqual(step['continue-on-error'], true, step.name);
  }
});

test('native-dast.yml gives the server random verifier keys and the harness the same SUPABASE_JWT_SECRET (SEC-DAST-2)', () => {
  const wf = parseYaml(fs.readFileSync(workflowPath, 'utf8'));
  const probeJob = Object.values(wf.jobs).find((job) =>
    (job.steps || []).some((s) => (s.run || '').includes('node scripts/security/native-dast.mjs')));
  const steps = probeJob.steps;
  const startIndex = steps.findIndex((s) => /node apps\/server\/dist\/main\.js/.test(s.run || ''));
  const probeIndex = steps.findIndex((s) => (s.run || '').includes('node scripts/security/native-dast.mjs'));
  assert.ok(startIndex >= 0 && probeIndex > startIndex, 'the probes run after the server starts');
  const start = steps[startIndex].run;

  // Both verifiers get a per-run random key before the server starts.
  assert.match(start, /export ADMIN_JWT_SECRET="\$\(openssl rand -hex (3[2-9]|[4-9]\d)\)"/);
  assert.match(start, /SUPABASE_JWT_SECRET="\$\(openssl rand -hex (3[2-9]|[4-9]\d)\)"/);
  assert.match(start, /export SUPABASE_JWT_SECRET\b/);
  assert.match(start, /::add-mask::\$SUPABASE_JWT_SECRET/);
  // The probe step signs with the server's key: it reaches it via GITHUB_ENV.
  assert.match(start, /echo "SUPABASE_JWT_SECRET=\$SUPABASE_JWT_SECRET" >> "\$GITHUB_ENV"/);
  const serverLaunch = start.indexOf('node apps/server/dist/main.js');
  for (const exported of ['export ADMIN_JWT_SECRET=', 'export SUPABASE_JWT_SECRET']) {
    const at = start.indexOf(exported);
    assert.ok(at >= 0 && at < serverLaunch, `${exported} comes before the server starts`);
  }
  // No step or job env overrides the key with a literal.
  for (const step of steps) assert.equal(step.env?.SUPABASE_JWT_SECRET, undefined, step.name);
  assert.equal(probeJob.env?.SUPABASE_JWT_SECRET, undefined);
  assert.equal(wf.env?.SUPABASE_JWT_SECRET, undefined);

  // Every key the manifest signs with is the one the workflow hands over.
  const keyEnvs = new Set(loadManifest().probes.filter((p) => p.bearer_jwt?.key_env).map((p) => p.bearer_jwt.key_env));
  assert.deepEqual([...keyEnvs], [KEY_ENV]);
});
