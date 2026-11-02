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
 * What this spec holds:
 *   1. The manifest contract: each Release 0 route has an unauthenticated
 *      probe (no Authorization, no Cookie) expecting exactly [401, 403], and
 *      the manifest as a whole validates.
 *   2. evaluateProbeResult fails a 404 from a protected route, any 5xx, an
 *      unexpected status (200, a redirect, a 400) and a forbidden body marker,
 *      even when a probe's expected_status was widened to allow them.
 *   3. validateManifest refuses a manifest that would let a weak probe pass.
 *   4. runProbes against a real local HTTP server: a probe passes only on the
 *      right answer, and an unreachable base URL is a transport failure on
 *      every probe, never a skip.
 *   5. The CLI exits non-zero on a transport failure and on a non-loopback
 *      base URL (the harness never probes a remote host).
 *   6. The workflow runs this spec before the probe job, with no secret and
 *      no continue-on-error.
 *
 * REQUIRED_WORKFLOWS (scripts/agent-control/lib/events.mjs) is deliberately
 * not asserted here: the gate swap is V1-30, which edits that list.
 *
 * Run: node --test scripts/security/tests/native-dast.spec.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseYaml } from '../../agent-control/lib/yaml.mjs';
import {
  PROTECTED_STATUSES,
  evaluateProbeResult,
  validateManifest,
  resolveBaseUrl,
  runProbes,
} from '../native-dast.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const harnessPath = path.join(repoRoot, 'scripts/security/native-dast.mjs');
const manifestPath = path.join(repoRoot, 'scripts/security/native-dast-manifest.json');
const workflowPath = path.join(repoRoot, '.github/workflows/native-dast.yml');

const loadManifest = () => JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

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
  return Object.keys(probe.headers || {}).every((name) => !CREDENTIAL_HEADERS.has(name.toLowerCase()));
}

function sortedStatuses(probe) {
  return [...(probe.expected_status || [])].sort((a, b) => a - b);
}

// A real HTTP server on an ephemeral loopback port. `routes` maps
// "METHOD /path" to [status, body]; anything else answers 404.
async function startStub(routes) {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push({ method: req.method, url: req.url, authorization: req.headers.authorization ?? null });
    const hit = routes[`${req.method} ${req.url}`] ?? routes['*'];
    const [status, body] = hit ?? [404, '{"statusCode":404,"message":"Cannot GET"}'];
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    seen,
    close: () => new Promise((resolve) => server.close(resolve)),
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

function stubRoutesFor(manifest, protectedAnswer) {
  const routes = { 'GET /healthz': [200, '{"status":"ok","uptimeSec":1}'] };
  for (const probe of manifest.probes) {
    if (probe.protected) routes[`${probe.method || 'GET'} ${probe.path}`] = protectedAnswer;
  }
  return routes;
}

// ---------------------------------------------------------------------------
// 1. Manifest contract
// ---------------------------------------------------------------------------

test('PROTECTED_STATUSES is exactly 401 and 403', () => {
  assert.deepEqual([...PROTECTED_STATUSES].sort((a, b) => a - b), [401, 403]);
});

for (const route of RELEASE0_ROUTES) {
  test(`manifest probes the Release 0 ${route.name} route unauthenticated, expecting only [401, 403]`, () => {
    const manifest = loadManifest();
    const probes = manifest.probes.filter(
      (p) => (p.method || 'GET') === route.method && route.path.test(p.path),
    );
    assert.ok(probes.length > 0, `no probe for ${route.method} ${route.path}`);
    const unauthenticated = probes.filter(isUnauthenticated);
    assert.ok(unauthenticated.length > 0, `the ${route.name} probe must send no credential header`);
    for (const probe of probes) {
      assert.equal(probe.protected, true, `${probe.id} must be marked protected`);
      assert.deepEqual(sortedStatuses(probe), [401, 403], `${probe.id} must expect only [401, 403]`);
    }
  });
}

test('the shipped manifest validates, every protected probe expects only 401/403, ids are unique', () => {
  const manifest = loadManifest();
  assert.deepEqual(validateManifest(manifest), []);
  const ids = manifest.probes.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const probe of manifest.probes.filter((p) => p.protected)) {
    assert.deepEqual(sortedStatuses(probe), [401, 403], probe.id);
  }
  // Leak markers the probes check every body for.
  for (const marker of ['PrismaClientKnownRequestError', 'node_modules/', 'TypeError:']) {
    assert.ok(manifest.forbidden_body_patterns.includes(marker), `missing forbidden marker ${marker}`);
  }
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

// ---------------------------------------------------------------------------
// 4. resolveBaseUrl: loopback only, explicit
// ---------------------------------------------------------------------------

test('resolveBaseUrl accepts loopback hosts and strips a trailing slash', () => {
  assert.equal(resolveBaseUrl({ NATIVE_DAST_BASE_URL: 'http://127.0.0.1:3001/' }), 'http://127.0.0.1:3001');
  assert.equal(resolveBaseUrl({ NATIVE_DAST_BASE_URL: 'http://localhost:4000' }), 'http://localhost:4000');
  assert.equal(resolveBaseUrl({ NATIVE_DAST_BASE_URL: 'http://[::1]:4000' }), 'http://[::1]:4000');
  assert.equal(resolveBaseUrl({ OTHER: 'http://127.0.0.1:9' }, { base_url_env: 'OTHER' }), 'http://127.0.0.1:9');
});

test('resolveBaseUrl refuses a remote host, a non-http scheme and an unset variable', () => {
  assert.throws(() => resolveBaseUrl({ NATIVE_DAST_BASE_URL: 'https://api.keyflowos.example' }), /loopback/);
  assert.throws(() => resolveBaseUrl({ NATIVE_DAST_BASE_URL: 'http://10.0.0.5:3001' }), /loopback/);
  assert.throws(() => resolveBaseUrl({ NATIVE_DAST_BASE_URL: 'ftp://127.0.0.1/' }), /http/);
  assert.throws(() => resolveBaseUrl({}), /NATIVE_DAST_BASE_URL/);
});

// ---------------------------------------------------------------------------
// 5. runProbes against a real local HTTP server
// ---------------------------------------------------------------------------

test('runProbes passes every shipped probe against a server that answers 401 on protected routes', async () => {
  const manifest = loadManifest();
  const stub = await startStub(stubRoutesFor(manifest, [401, '{"statusCode":401,"message":"Unauthorized"}']));
  try {
    const summary = await runProbes(manifest, { baseUrl: stub.baseUrl });
    assert.equal(summary.probes, manifest.probes.length);
    assert.equal(summary.failed, 0, JSON.stringify(summary.results.filter((r) => !r.passed), null, 2));
    assert.equal(summary.passed, manifest.probes.length);
    // Every probe really reached the server, with the method it declares.
    assert.equal(stub.seen.length, manifest.probes.length);
    // The unauthenticated probes sent no Authorization header.
    for (const probe of manifest.probes.filter(isUnauthenticated)) {
      const req = stub.seen.find((s) => s.url === probe.path && s.method === (probe.method || 'GET') && s.authorization === null);
      assert.ok(req, `${probe.id} did not reach the server unauthenticated`);
    }
  } finally {
    await stub.close();
  }
});

test('NC unguarded route: one protected route answering 200 fails exactly that probe', async () => {
  const manifest = loadManifest();
  const target = manifest.probes.find((p) => p.protected && /\/commerce\/businesses\/[^/]+\/payments$/.test(p.path));
  const routes = stubRoutesFor(manifest, [401, '{"statusCode":401}']);
  routes[`GET ${target.path}`] = [200, '[]'];
  const stub = await startStub(routes);
  try {
    const summary = await runProbes(manifest, { baseUrl: stub.baseUrl });
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
    const summary = await runProbes(manifest, { baseUrl: stub.baseUrl });
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
  const summary = await runProbes(manifest, { baseUrl: `http://127.0.0.1:${port}`, timeoutMs: 3000 });
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

// ---------------------------------------------------------------------------
// 6. CLI exit codes
// ---------------------------------------------------------------------------

test('CLI: unreachable base URL exits non-zero and reports every probe failed', async () => {
  const port = await closedPort();
  const { code, stdout } = await runCli([manifestPath], { NATIVE_DAST_BASE_URL: `http://127.0.0.1:${port}` });
  assert.notEqual(code, 0);
  const summary = JSON.parse(stdout);
  assert.equal(summary.failed, summary.probes);
  assert.ok(summary.probes > 0);
});

test('CLI: all probes answered correctly exits 0', async () => {
  const manifest = loadManifest();
  const stub = await startStub(stubRoutesFor(manifest, [403, '{"statusCode":403,"message":"Forbidden"}']));
  try {
    const { code, stdout, stderr } = await runCli([manifestPath], { NATIVE_DAST_BASE_URL: stub.baseUrl });
    assert.equal(code, 0, stdout + stderr);
    assert.equal(JSON.parse(stdout).failed, 0);
  } finally {
    await stub.close();
  }
});

test('CLI: a remote base URL is refused before any request (exit non-zero)', () => {
  const result = spawnSync(process.execPath, [harnessPath, manifestPath], {
    cwd: repoRoot,
    env: { PATH: process.env.PATH, NATIVE_DAST_BASE_URL: 'https://keyflowos.example' },
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
  for (const [, job] of jobs) {
    assert.notEqual(job['continue-on-error'], true);
    for (const step of job.steps || []) assert.notEqual(step['continue-on-error'], true, step.name);
  }
});
