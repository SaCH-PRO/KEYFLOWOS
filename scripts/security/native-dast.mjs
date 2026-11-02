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
 *   - any 5xx fails, even if allowlisted;
 *   - a body carrying a forbidden internal marker (stack frame, Prisma error)
 *     fails, even on the right status;
 *   - body_must_include fragments must be present.
 *
 * The base URL comes from the variable the manifest names (base_url_env,
 * default NATIVE_DAST_BASE_URL). It must be set and must be a loopback http(s)
 * URL: the harness probes a server started on this machine, never a remote
 * host.
 *
 * Usage:
 *   NATIVE_DAST_BASE_URL=http://127.0.0.1:3001 \
 *     node scripts/security/native-dast.mjs [manifest.json]
 *
 * Exit codes: 0 every probe passed; 1 at least one probe failed (including a
 * transport failure); 2 configuration refused (manifest invalid, base URL
 * unset or not loopback). It prints one JSON summary to stdout.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROTECTED_STATUSES = Object.freeze([401, 403]);

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
  });
  return problems;
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

async function sendProbe(probe, baseUrl, fetchImpl, timeoutMs) {
  const method = probe.method || 'GET';
  const init = {
    method,
    headers: { ...(probe.headers || {}) },
    redirect: 'manual',
    signal: AbortSignal.timeout(timeoutMs),
  };
  if (probe.body !== undefined) {
    init.body = typeof probe.body === 'string' ? probe.body : JSON.stringify(probe.body);
  }
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
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const forbidden = manifest.forbidden_body_patterns || [];

  const results = [];
  for (const probe of manifest.probes) {
    const method = probe.method || 'GET';
    let status = null;
    let probeProblems;
    try {
      const answer = await sendProbe(probe, baseUrl, fetchImpl, timeoutMs);
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
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stdout.write(JSON.stringify({ schema_version: 1, error: message, manifest: manifestPath }, null, 2) + '\n');
    process.stderr.write(`native-dast: configuration refused: ${message}\n`);
    return 2;
  }
  const summary = await runProbes(manifest, { baseUrl });
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
