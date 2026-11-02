import { test } from 'node:test';
import assert from 'node:assert/strict';
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
