/** Integration proof for the launch verifier against a local HTTP fixture.
 * Exercises the actual Bash entrypoint, curl, JSON parser, and exit status.
 * No public endpoints, credentials, production runtime, or mutations.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../verify-up.sh', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SENTINEL = 'VERIFY_UP_SENTINEL_51c0de';
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

async function runVerifier(base, { sameHost = false, script = SCRIPT, cwd } = {}) {
  const env = { ...process.env };
  delete env.BASE_URL;
  delete env.API_BASE;
  delete env.WEB_BASE;
  if (sameHost) env.BASE_URL = base;
  else { env.API_BASE = base; env.WEB_BASE = base; }
  // Keep the logical (possibly symlinked) cwd, as an interactive shell would.
  if (cwd) env.PWD = cwd;
  return new Promise((resolve, reject) => {
    const child = spawn('bash', [script], { env, cwd, stdio: ['ignore', 'pipe', 'pipe'] });
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

// Review repairs (VU-SEC-1 / CR-V120-1): the documented entrypoint run from a
// symlinked checkout (deploy `current -> releases/N`, macOS /tmp) must still
// check every body.
async function withTmp(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'verify-up-shell-'));
  try { return await fn(dir); }
  finally { rmSync(dir, { recursive: true, force: true }); }
}

test('symlinked checkout: degraded HTTP 200 bodies still fail (absolute and relative entry)', () => withTmp(async (dir) => {
  const link = join(dir, 'current');
  symlinkSync(REPO_ROOT, link, 'dir');
  const viaLink = join(link, 'scripts', 'verify-up.sh');
  const degraded = {
    '/readyz': { status: 200, body: { status: 'ready', db: { ok: false } } },
    '/api/healthz': { status: 200, body: { status: 'degraded', apiReachable: false, env: 'ok' } },
  };
  const absolute = await scenario(degraded, { script: viaLink });
  assert.equal(absolute.code, 1, absolute.stdout + absolute.stderr);
  assert.match(absolute.stdout, /FAIL\s+api\.readyz\s+200.*health_body_unhealthy/);
  assert.match(absolute.stdout, /FAIL\s+web\.healthz\s+200.*health_body_unhealthy/);
  assert.match(absolute.stdout, /Passed: 2\s+Failed: 2/);

  const relative = await scenario({ '/api/healthz': { status: 200, body: 'invalid-json' } }, { sameHost: true, script: 'scripts/verify-up.sh', cwd: link });
  assert.equal(relative.code, 1, relative.stdout + relative.stderr);
  assert.match(relative.stdout, /FAIL\s+web\.healthz\s+200.*invalid_json/);

  const healthy = await scenario({}, { script: viaLink });
  assert.equal(healthy.code, 0, healthy.stdout + healthy.stderr);
  assert.match(healthy.stdout, /Passed: 4\s+Failed: 0/);
}));

// The shell, not the module, owns the pass decision: exit 0 alone is not a
// verdict. A copy of verify-up.sh next to a stub body verifier isolates that.
async function withStubVerifier(stubSource, fn) {
  return withTmp(async (dir) => {
    const scripts = join(dir, 'scripts');
    mkdirSync(scripts);
    copyFileSync(SCRIPT, join(scripts, 'verify-up.sh'));
    writeFileSync(join(scripts, 'verify-up-body.mjs'), stubSource);
    return fn(join(scripts, 'verify-up.sh'));
  });
}

test('a body verifier that exits 0 without the positive verdict fails closed', () => withStubVerifier('// silent no-op\n', async (script) => {
  const result = await scenario({}, { script });
  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /FAIL\s+web\.healthz\s+200.*health_verifier_no_verdict/);
  assert.match(result.stdout, /Passed: 1\s+Failed: 3/);
  assert.match(result.stdout, /PASS\s+web\.root\s+200/);
}));

test('verifier stderr outside the reason allow-list is never printed', () => withStubVerifier(
  "process.stderr.write('health_body_unhealthy " + SENTINEL + "\\n');\nprocess.exitCode = 1;\n",
  async (script) => {
    const result = await scenario({}, { sameHost: true, script });
    assert.equal(result.code, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /FAIL\s+web\.healthz\s+200.*health_verifier_failed/);
    assert.ok(!(result.stdout + result.stderr).includes(SENTINEL), result.stdout + result.stderr);
  },
));

// Disclosure invariant (VU-SEC-2): no response body text reaches stdout or
// stderr, on any failure path. The web /api/healthz body carries apiBase,
// apiError and envError.
test('response bodies never reach stdout or stderr on failure', async () => {
  const leakyHealth = { status: 'degraded', apiReachable: false, env: 'invalid', apiBase: 'http://' + SENTINEL, apiError: SENTINEL, envError: SENTINEL };
  const cases = [
    [{ '/readyz': { status: 503, body: { status: 'not-ready', db: { ok: false, error: SENTINEL } } } }, {}],
    [{ '/api/healthz': { status: 200, body: leakyHealth } }, { sameHost: true }],
    [{ '/api/healthz': { status: 503, body: leakyHealth } }, { sameHost: true }],
    [{ '/api/healthz': { status: 200, body: SENTINEL + ' not json' } }, { sameHost: true }],
    [{ '/': { status: 500, body: '<html>' + SENTINEL + '</html>' } }, { sameHost: true }],
  ];
  for (const [overrides, options] of cases) {
    const result = await scenario(overrides, options);
    assert.equal(result.code, 1, result.stdout + result.stderr);
    const out = result.stdout + result.stderr;
    assert.ok(!out.includes(SENTINEL), 'body text leaked: ' + out);
  }
});
