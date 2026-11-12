#!/usr/bin/env node
/**
 * Native DAST harness (V1-13-SEC-NATIVE-DAST; ported from #114).
 *
 * Sends the probes in a manifest to a locally started API and judges each
 * answer. It needs no third-party account, so unlike the HawkScan workflow it
 * cannot go green by skipping: every probe is sent, and a probe that cannot be
 * sent is a failure.
 *
 * Rules a probe is judged by (evaluateProbeResult):
 *   - the status must be in the probe's expected_status;
 *   - a protected probe passes ONLY on 401 or 403, whatever its expected_status
 *     says: a 404 means the route is absent (no auth-boundary proof), a 2xx or
 *     3xx means the boundary let an anonymous caller through or redirected it;
 *   - an invalid_credential probe (one whose credential authentication must
 *     refuse) passes ONLY on 401, whatever its expected_status says. 403 is
 *     what a business guard answers a caller authentication ACCEPTED, so a
 *     forged token that got through the verifier would pass on 403 (review
 *     SEC-DAST-1);
 *   - any 5xx fails, even if allowlisted;
 *   - a body carrying a forbidden internal marker (stack frame, Prisma error)
 *     fails, even on the right status;
 *   - body_must_include fragments must be present.
 *
 * Credentials a probe can carry:
 *   - a literal header (headers.authorization), e.g. a malformed bearer;
 *   - bearer_jwt: a JWT minted at run time, never committed. Its fields:
 *       signing    'none' (alg none, empty signature), 'random-key' (HS256
 *                  with 32 random bytes made for this probe, a key no server
 *                  holds) or 'env-key' (HS256 with the value of key_env: the
 *                  server's own verification key, for tokens whose signature
 *                  is right and whose claims are not, and for the valid-token
 *                  control);
 *       key_env    'env-key' only: the variable holding that key. The harness
 *                  refuses to run (exit 2) when it is unset or empty;
 *       exp_in_s   exp = now + exp_in_s (negative: already expired);
 *       claims     static claims merged over { sub, iat, exp }. sub is a fresh
 *                  random UUID per probe, so no token names a real account.
 *   A token that can never verify ('none', 'random-key') must be marked
 *   invalid_credential.
 *
 * The base URL comes from the variable the manifest names (base_url_env,
 * default NATIVE_DAST_BASE_URL). It must be set and must be a loopback http(s)
 * URL: the harness probes a server started on this machine, never a remote
 * host.
 *
 * Usage:
 *   NATIVE_DAST_BASE_URL=http://127.0.0.1:3001 SUPABASE_JWT_SECRET=<the server's> \
 *     node scripts/security/native-dast.mjs [manifest.json]
 *
 * Exit codes: 0 every probe passed; 1 at least one probe failed (including a
 * transport failure); 2 configuration refused (manifest invalid, base URL
 * unset or not loopback, a signing key variable unset). It prints one JSON
 * summary to stdout. Minted tokens are never printed.
 */
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROTECTED_STATUSES = Object.freeze([401, 403]);
/** The one answer that proves authentication refused a credential. */
export const INVALID_CREDENTIAL_STATUSES = Object.freeze([401]);
export const JWT_SIGNINGS = Object.freeze(['none', 'random-key', 'env-key']);
/** Claims the harness sets itself: a fresh sub, and iat/exp from exp_in_s. */
const HARNESS_CLAIMS = new Set(['sub', 'iat', 'exp']);
const ENV_NAME = /^[A-Z_][A-Z0-9_]*$/;

const DEFAULT_MANIFEST = 'scripts/security/native-dast-manifest.json';
const DEFAULT_BASE_URL_ENV = 'NATIVE_DAST_BASE_URL';
const DEFAULT_TIMEOUT_MS = 10_000;
const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
const LOOPBACK_HOSTS = new Set(['localhost', '[::1]', '::1']);

export function evaluateProbeResult(probe, response, body, forbiddenPatterns = []) {
  const problems = [];
  const status = response?.status;
  const text = typeof body === 'string' ? body : '';
  if (!Number.isInteger(status)) {
    problems.push(`no HTTP status received (${String(status)})`);
    return problems;
  }
  const expected = Array.isArray(probe.expected_status) ? probe.expected_status : [];
  if (!expected.includes(status)) {
    problems.push(`status ${status} not in expected [${expected.join(', ')}]`);
  }
  if (probe.protected === true) {
    if (status === 404) {
      problems.push('protected route returned 404; route absence is not auth-boundary proof');
    } else if (!PROTECTED_STATUSES.includes(status) && status < 500) {
      problems.push(`protected route returned ${status}; only ${PROTECTED_STATUSES.join(' or ')} proves the auth boundary`);
    }
  }
  if (probe.invalid_credential === true && PROTECTED_STATUSES.includes(status)
    && !INVALID_CREDENTIAL_STATUSES.includes(status)) {
    problems.push(`invalid credential answered ${status}: a later guard refused a caller authentication accepted; only 401 proves the verifier refused it`);
  }
  if (status >= 500) {
    problems.push(`server error ${status}`);
  }
  for (const needle of probe.body_must_include || []) {
    if (!text.includes(needle)) problems.push(`body missing required fragment: ${needle}`);
  }
  for (const pattern of forbiddenPatterns) {
    if (text.includes(pattern)) problems.push(`response leaked forbidden internal marker: ${pattern}`);
  }
  return problems;
}

export function validateManifest(manifest) {
  const problems = [];
  if (!manifest || typeof manifest !== 'object') return ['manifest is not an object'];
  const probes = manifest.probes;
  if (!Array.isArray(probes) || probes.length === 0) {
    problems.push('manifest has no probes; an empty run proves nothing');
    return problems;
  }
  if (manifest.forbidden_body_patterns !== undefined
    && (!Array.isArray(manifest.forbidden_body_patterns)
      || manifest.forbidden_body_patterns.some((p) => typeof p !== 'string' || p.length === 0))) {
    problems.push('forbidden_body_patterns must be an array of non-empty strings');
  }
  const ids = new Set();
  probes.forEach((probe, index) => {
    const label = probe && typeof probe.id === 'string' && probe.id ? probe.id : `probes[${index}]`;
    if (!probe || typeof probe !== 'object') {
      problems.push(`${label}: not an object`);
      return;
    }
    if (typeof probe.id !== 'string' || probe.id.length === 0) problems.push(`${label}: id missing`);
    else if (ids.has(probe.id)) problems.push(`${label}: duplicate id`);
    else ids.add(probe.id);
    if (typeof probe.path !== 'string' || !probe.path.startsWith('/') || probe.path.startsWith('//')) {
      problems.push(`${label}: path must be a server-relative path starting with a single "/"`);
    }
    const method = probe.method ?? 'GET';
    if (!METHODS.has(method)) problems.push(`${label}: unsupported method ${String(method)}`);
    const expected = probe.expected_status;
    if (!Array.isArray(expected) || expected.length === 0 || !expected.every(Number.isInteger)) {
      problems.push(`${label}: expected_status must be a non-empty array of integers`);
      return;
    }
    if (expected.some((s) => s >= 500)) problems.push(`${label}: a 5xx can never be an expected answer`);
    if (probe.protected === true) {
      const outside = expected.filter((s) => !PROTECTED_STATUSES.includes(s));
      if (outside.length) {
        problems.push(`${label}: a protected probe may expect only ${PROTECTED_STATUSES.join(', ')} (found ${outside.join(', ')})`);
      }
    }
    problems.push(...credentialProblems(probe, label, expected));
  });
  return problems;
}

function hasHeader(probe, name) {
  return Object.keys(probe.headers || {}).some((h) => h.toLowerCase() === name);
}

function credentialProblems(probe, label, expected) {
  const problems = [];
  if (probe.headers !== undefined && (typeof probe.headers !== 'object' || probe.headers === null
    || Array.isArray(probe.headers) || Object.values(probe.headers).some((v) => typeof v !== 'string'))) {
    problems.push(`${label}: headers must be an object of string values`);
  }
  const jwt = probe.bearer_jwt;
  if (jwt !== undefined) {
    if (!jwt || typeof jwt !== 'object' || Array.isArray(jwt)) {
      problems.push(`${label}: bearer_jwt must be an object`);
    } else {
      if (!JWT_SIGNINGS.includes(jwt.signing)) {
        problems.push(`${label}: bearer_jwt.signing must be one of ${JWT_SIGNINGS.join(', ')}`);
      }
      if (jwt.signing === 'env-key') {
        if (typeof jwt.key_env !== 'string' || !ENV_NAME.test(jwt.key_env)) {
          problems.push(`${label}: bearer_jwt.key_env must name the variable holding the server's key`);
        }
      } else if (jwt.key_env !== undefined) {
        problems.push(`${label}: bearer_jwt.key_env applies to signing 'env-key' only`);
      }
      if (!Number.isInteger(jwt.exp_in_s)) problems.push(`${label}: bearer_jwt.exp_in_s must be an integer`);
      if (jwt.claims !== undefined) {
        if (!jwt.claims || typeof jwt.claims !== 'object' || Array.isArray(jwt.claims)) {
          problems.push(`${label}: bearer_jwt.claims must be an object`);
        } else {
          const owned = Object.keys(jwt.claims).filter((k) => HARNESS_CLAIMS.has(k));
          if (owned.length) problems.push(`${label}: bearer_jwt.claims may not set ${owned.join(', ')} (the harness sets them)`);
        }
      }
      if ((jwt.signing === 'none' || jwt.signing === 'random-key') && probe.invalid_credential !== true) {
        problems.push(`${label}: a '${jwt.signing}' token can never verify; mark the probe invalid_credential`);
      }
    }
    if (hasHeader(probe, 'authorization')) {
      problems.push(`${label}: bearer_jwt and an authorization header are mutually exclusive`);
    }
  }
  if (probe.invalid_credential !== undefined && probe.invalid_credential !== true) {
    problems.push(`${label}: invalid_credential may only be true`);
  }
  if (probe.invalid_credential === true) {
    if (probe.protected !== true) problems.push(`${label}: an invalid_credential probe must be protected`);
    if (jwt === undefined && !hasHeader(probe, 'authorization')) {
      problems.push(`${label}: an invalid_credential probe must carry a credential (authorization header or bearer_jwt)`);
    }
    const outside = expected.filter((s) => !INVALID_CREDENTIAL_STATUSES.includes(s));
    if (outside.length) {
      problems.push(`${label}: an invalid_credential probe may expect only ${INVALID_CREDENTIAL_STATUSES.join(', ')} (found ${outside.join(', ')}); 403 is what an ACCEPTED credential gets from a business guard`);
    }
  }
  return problems;
}

/**
 * The signing keys the manifest's 'env-key' probes need, read from `env`.
 * Throws when one is unset or empty: a probe that cannot be signed is a
 * configuration error, never a skip.
 */
export function resolveSigningKeys(manifest, env = process.env) {
  const keys = {};
  const missing = [];
  for (const probe of manifest?.probes || []) {
    const jwt = probe?.bearer_jwt;
    if (!jwt || jwt.signing !== 'env-key') continue;
    const value = env[jwt.key_env];
    if (typeof value !== 'string' || value.length === 0) {
      if (!missing.includes(jwt.key_env)) missing.push(jwt.key_env);
    } else {
      keys[jwt.key_env] = value;
    }
  }
  if (missing.length) {
    throw new Error(`${missing.join(', ')} not set; the 'env-key' probes are signed with the key the server verifies with, so set it to the server's value`);
  }
  return keys;
}

/** Mint the JWT a bearer_jwt spec describes. `keys` maps key_env names to values. */
export function mintBearerJwt(spec, keys = {}, nowMs = Date.now()) {
  const nowS = Math.floor(nowMs / 1000);
  const exp = nowS + spec.exp_in_s;
  const header = { alg: spec.signing === 'none' ? 'none' : 'HS256', typ: 'JWT' };
  const payload = { sub: randomUUID(), iat: Math.min(nowS, exp - 3600), exp, ...(spec.claims || {}) };
  const encode = (value) => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
  const signingInput = `${encode(header)}.${encode(payload)}`;
  if (spec.signing === 'none') return `${signingInput}.`;
  let key;
  if (spec.signing === 'env-key') {
    key = keys[spec.key_env];
    if (typeof key !== 'string' || key.length === 0) throw new Error(`no signing key for ${spec.key_env}`);
  } else if (spec.signing === 'random-key') {
    key = randomBytes(32);
  } else {
    throw new Error(`unsupported bearer_jwt.signing ${String(spec.signing)}`);
  }
  return `${signingInput}.${createHmac('sha256', key).update(signingInput).digest('base64url')}`;
}

/** The request a probe sends: its method, its declared headers (plus a minted bearer), its body. */
export function buildProbeRequest(probe, keys = {}) {
  const headers = { ...(probe.headers || {}) };
  if (probe.bearer_jwt) headers.authorization = `Bearer ${mintBearerJwt(probe.bearer_jwt, keys)}`;
  const request = { method: probe.method || 'GET', headers };
  if (probe.body !== undefined) {
    request.body = typeof probe.body === 'string' ? probe.body : JSON.stringify(probe.body);
  }
  return request;
}

function isLoopbackHost(hostname) {
  if (LOOPBACK_HOSTS.has(hostname)) return true;
  return /^127(\.\d{1,3}){3}$/.test(hostname);
}

export function resolveBaseUrl(env = process.env, manifest = {}) {
  const name = manifest.base_url_env || DEFAULT_BASE_URL_ENV;
  const raw = env[name];
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new Error(`${name} is not set; point it at a locally started API (e.g. http://127.0.0.1:3001)`);
  }
  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error(`${name} is not a URL: ${raw}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${name} must be an http or https URL (got ${url.protocol})`);
  }
  if (!isLoopbackHost(url.hostname)) {
    throw new Error(`${name} must name a loopback host; the native DAST harness never probes a remote host (got ${url.hostname})`);
  }
  return url.toString().replace(/\/$/, '');
}

async function sendProbe(probe, baseUrl, fetchImpl, timeoutMs, keys) {
  const init = {
    ...buildProbeRequest(probe, keys),
    redirect: 'manual',
    signal: AbortSignal.timeout(timeoutMs),
  };
  const response = await fetchImpl(baseUrl + probe.path, init);
  const body = await response.text();
  return { status: response.status, body };
}

export async function runProbes(manifest, options = {}) {
  const problems = validateManifest(manifest);
  if (problems.length) {
    throw new Error(`invalid native DAST manifest: ${problems.join('; ')}`);
  }
  const baseUrl = String(options.baseUrl ?? '').replace(/\/$/, '');
  if (!baseUrl) throw new Error('runProbes needs a baseUrl');
  const keys = resolveSigningKeys(manifest, options.env ?? process.env);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const forbidden = manifest.forbidden_body_patterns || [];

  const results = [];
  for (const probe of manifest.probes) {
    const method = probe.method || 'GET';
    let status = null;
    let probeProblems;
    try {
      const answer = await sendProbe(probe, baseUrl, fetchImpl, timeoutMs, keys);
      status = answer.status;
      probeProblems = evaluateProbeResult(probe, { status }, answer.body, forbidden);
    } catch (error) {
      const cause = error?.cause?.code || error?.cause?.message;
      const message = error instanceof Error ? error.message : String(error);
      probeProblems = [`transport failure: ${message}${cause ? ` (${cause})` : ''}`];
    }
    results.push({
      id: probe.id,
      method,
      path: probe.path,
      status,
      passed: probeProblems.length === 0,
      problems: probeProblems,
    });
  }
  const failed = results.filter((r) => !r.passed).length;
  return {
    schema_version: 1,
    base_url: baseUrl,
    probes: results.length,
    passed: results.length - failed,
    failed,
    results,
  };
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const manifestPath = argv[0] || DEFAULT_MANIFEST;
  let manifest;
  let baseUrl;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const problems = validateManifest(manifest);
    if (problems.length) throw new Error(`invalid native DAST manifest: ${problems.join('; ')}`);
    baseUrl = resolveBaseUrl(env, manifest);
    resolveSigningKeys(manifest, env);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stdout.write(JSON.stringify({ schema_version: 1, error: message, manifest: manifestPath }, null, 2) + '\n');
    process.stderr.write(`native-dast: configuration refused: ${message}\n`);
    return 2;
  }
  const summary = await runProbes(manifest, { baseUrl, env });
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
  for (const result of summary.results.filter((r) => !r.passed)) {
    process.stderr.write(`native-dast: FAIL ${result.id} ${result.method} ${result.path}: ${result.problems.join('; ')}\n`);
  }
  return summary.failed === 0 ? 0 : 1;
}

// Compare real paths: Node resolves the entry module through symlinks, so a
// plain string comparison would make a run from a symlinked checkout do
// nothing and exit 0.
function isEntryModule() {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(path.resolve(process.argv[1])) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryModule()) {
  process.exitCode = await main();
}
