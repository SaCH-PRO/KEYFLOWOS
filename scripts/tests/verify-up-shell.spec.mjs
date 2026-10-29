/** Integration proof for the launch verifier against a local HTTP fixture.
 * Exercises the actual Bash entrypoint, curl, JSON parser, and exit status.
 * No public endpoints, credentials, production runtime, or mutations.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../verify-up.sh', import.meta.url));
const GOOD = Object.freeze({
  '/healthz': { status: 200, body: { status: 'ok' } },
  '/readyz': { status: 200, body: { status: 'ready', db: { ok: true } } },
  '/api/healthz': { status: 200, body: { status: 'ok', apiReachable: true, env: 'ok' } },
  '/': { status: 200, body: '<html>Test only</html>' },
});

async function fixture(overrides = {}) {
  const routes = { ...GOOD, ...overrides };
  const server = createServer((req, res) => {
    const selected = routes[req.url] ?? { status: 404, body: 'not found' };
    res.writeHead(selected.status, { 'content-type': typeof selected.body === 'string' ? 'text/plain' : 'application/json' });
    res.end(typeof selected.body === 'string' ? selected.body : JSON.stringify(selected.body));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    base: 'http://127.0.0.1:' + server.address().port,
    close: () => new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve())),
  };
}

async function runVerifier(base, { sameHost = false } = {}) {
  const env = { ...process.env };
  delete env.BASE_URL;
  delete env.API_BASE;
  delete env.WEB_BASE;
  if (sameHost) env.BASE_URL = base;
  else { env.API_BASE = base; env.WEB_BASE = base; }
  return new Promise((resolve, reject) => {
    const child = spawn('bash', [SCRIPT], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => child.kill('SIGKILL'), 12_000);
    child.stdout.setEncoding('utf8').on('data', (s) => { stdout += s; });
    child.stderr.setEncoding('utf8').on('data', (s) => { stderr += s; });
    child.once('error', reject);
    child.once('close', (code, signal) => {
      clearTimeout(timeout);
      if (signal) reject(new Error('Verifier ended by ' + signal + ': ' + stderr));
      else resolve({ code, stdout, stderr });
    });
  });
}

async function scenario(overrides, options = {}) {
  const server = await fixture(overrides);
  try { return await runVerifier(server.base, options); }
  finally { await server.close(); }
}

test('split-host readiness accepts four healthy HTTP and JSON probes', async () => {
  const result = await scenario({});
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Passed: 4\s+Failed: 0/);
});

test('same-origin readiness accepts web health and homepage only', async () => {
  const result = await scenario({}, { sameHost: true });
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Passed: 2\s+Failed: 0/);
  assert.doesNotMatch(result.stdout, /PASS\s+api\.readyz/);
});

test('degraded web response with HTTP 200 fails the actual Bash command', async () => {
  const result = await scenario({ '/api/healthz': { status: 200, body: { status: 'degraded', apiReachable: false, env: 'ok' } } }, { sameHost: true });
  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /FAIL\s+web\.healthz\s+200/);
  assert.match(result.stdout, /health_body_unhealthy/);
  assert.match(result.stdout, /Passed: 1\s+Failed: 1/);
});

test('DB not ready with HTTP 200 fails split-host readiness', async () => {
  const result = await scenario({ '/readyz': { status: 200, body: { status: 'ready', db: { ok: false } } } });
  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /FAIL\s+api\.readyz\s+200/);
  assert.match(result.stdout, /Passed: 3\s+Failed: 1/);
});

test('malformed web JSON with HTTP 200 fails closed', async () => {
  const result = await scenario({ '/api/healthz': { status: 200, body: 'invalid-json' } }, { sameHost: true });
  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /invalid_json/);
});

test('unexpected HTTP status fails even with a superficially healthy body', async () => {
  const result = await scenario({ '/readyz': { status: 503, body: { status: 'ready', db: { ok: true } } } });
  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /unexpected_http_status/);
});

test('curl transport failure fails (never becomes a clean skip)', async () => {
  const server = await fixture();
  const base = server.base;
  await server.close();
  const result = await runVerifier(base, { sameHost: true });
  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /curl_transport_failure/);
  assert.match(result.stdout, /Failed: 2/);
});
