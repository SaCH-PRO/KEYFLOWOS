import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateProbeResult } from '../native-dast.mjs';

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
  const probe = { expected_status: [500] };
  const problems = evaluateProbeResult(probe, { status: 500 }, '', []);
  assert.ok(problems.some((x) => x.includes('server error')));
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

test('public health proof requires its expected body marker', () => {
  const probe = { expected_status: [200], body_must_include: ['"status":"ok"'] };
  assert.deepEqual(evaluateProbeResult(probe, { status: 200 }, '{"status":"ok"}', []), []);
  assert.ok(evaluateProbeResult(probe, { status: 200 }, '{"status":"bad"}', []).length > 0);
});
