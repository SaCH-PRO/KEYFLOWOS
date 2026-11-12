import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyHealthBody } from '../verify-up-body.mjs';

const check = (label, body) => verifyHealthBody(label, JSON.stringify(body)).ok;

test('API process liveness accepts only explicit ok', () => {
  assert.equal(check('api.healthz', { status: 'ok' }), true);
  assert.equal(check('api.healthz', { status: 'degraded' }), false);
  assert.equal(check('api.healthz', {}), false);
});

test('API readiness requires explicit DB success', () => {
  assert.equal(check('api.readyz', { status: 'ready', db: { ok: true } }), true);
  assert.equal(check('api.readyz', { status: 'ready', db: { ok: false } }), false);
  assert.equal(check('api.readyz', { status: 'ready' }), false);
  assert.equal(check('api.readyz', { status: 'not-ready', db: { ok: true } }), false);
});

test('web readiness rejects a degraded HTTP 200 and unreachable API', () => {
  assert.equal(check('web.healthz', { status: 'ok', apiReachable: true, env: 'ok' }), true);
  assert.equal(check('web.healthz', { status: 'degraded', apiReachable: false, env: 'ok' }), false);
  assert.equal(check('web.healthz', { status: 'ok', apiReachable: false, env: 'ok' }), false);
  assert.equal(check('web.healthz', { status: 'ok', apiReachable: true, env: 'invalid' }), false);
  assert.equal(check('web.healthz', { status: 'ok', env: 'ok' }), false);
});

test('malformed and unknown bodies fail closed', () => {
  assert.deepEqual(verifyHealthBody('web.healthz', 'not-json'), { ok: false, reason: 'invalid_json' });
  assert.deepEqual(verifyHealthBody('web.healthz', 'null'), { ok: false, reason: 'not_an_object' });
  assert.deepEqual(verifyHealthBody('web.healthz', '[]'), { ok: false, reason: 'not_an_object' });
  assert.deepEqual(verifyHealthBody('unrecognized', '{}'), { ok: false, reason: 'unknown_probe' });
});

// CLI entry (review repairs VU-SEC-1 / CR-V120-1 and VU-SEC-2). The module is
// run as a child process the same way scripts/verify-up.sh runs it.
const MODULE_REAL = fileURLToPath(new URL('../verify-up-body.mjs', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SENTINEL = 'VERIFY_UP_SENTINEL_7f3a91';
const DEGRADED_WEB = JSON.stringify({ status: 'degraded', apiReachable: false, env: 'ok' });
const HEALTHY_WEB = JSON.stringify({ status: 'ok', apiReachable: true, env: 'ok' });

function withTmp(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'verify-up-body-'));
  try { return fn(dir); }
  finally { rmSync(dir, { recursive: true, force: true }); }
}

function runCli(modulePath, label, raw, dir) {
  const file = join(dir, 'body.json');
  writeFileSync(file, raw);
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, [modulePath, label, file], { env, encoding: 'utf8', timeout: 10_000 });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

test('CLI prints a positive verdict on stdout only for a healthy body', () => withTmp((dir) => {
  const ok = runCli(MODULE_REAL, 'web.healthz', HEALTHY_WEB, dir);
  assert.equal(ok.code, 0, ok.stderr);
  assert.equal(ok.stdout, 'valid_health_body\n');
  const bad = runCli(MODULE_REAL, 'web.healthz', DEGRADED_WEB, dir);
  assert.equal(bad.code, 1);
  assert.equal(bad.stdout, '');
  assert.equal(bad.stderr, 'health_body_unhealthy\n');
}));

test('CLI run through a symlinked checkout still checks the body (fails closed)', () => withTmp((dir) => {
  // Deploy layouts such as current -> releases/N, or /tmp -> /private/tmp on
  // macOS: argv[1] keeps the symlinked path while import.meta.url is the real one.
  const link = join(dir, 'current');
  symlinkSync(REPO_ROOT, link, 'dir');
  const viaLink = join(link, 'scripts', 'verify-up-body.mjs');
  const bad = runCli(viaLink, 'web.healthz', DEGRADED_WEB, dir);
  assert.equal(bad.code, 1, 'degraded body passed through a symlinked path: ' + bad.stdout + bad.stderr);
  assert.equal(bad.stderr, 'health_body_unhealthy\n');
  const malformed = runCli(viaLink, 'web.healthz', 'not-json', dir);
  assert.equal(malformed.code, 1);
  assert.equal(malformed.stderr, 'invalid_json\n');
  const ok = runCli(viaLink, 'web.healthz', HEALTHY_WEB, dir);
  assert.equal(ok.code, 0, ok.stderr);
  assert.equal(ok.stdout, 'valid_health_body\n');
}));

test('CLI never echoes response body text on stdout or stderr', () => withTmp((dir) => {
  const bodies = [
    ['web.healthz', JSON.stringify({ status: 'degraded', apiReachable: false, env: 'invalid', apiBase: 'http://' + SENTINEL, apiError: SENTINEL, envError: SENTINEL })],
    ['api.readyz', JSON.stringify({ status: 'ready', db: { ok: false, error: SENTINEL } })],
    ['web.healthz', SENTINEL + ' is not json'],
    ['web.healthz', JSON.stringify([SENTINEL])],
  ];
  for (const [label, raw] of bodies) {
    const result = runCli(MODULE_REAL, label, raw, dir);
    assert.equal(result.code, 1, label + ': ' + result.stdout + result.stderr);
    const out = result.stdout + result.stderr;
    assert.ok(!out.includes(SENTINEL), 'body text leaked for ' + label + ': ' + out);
  }
}));
