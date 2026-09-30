import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

test('NC fake green: required security scans may not swallow failures', () => {
  const ci = read('.github/workflows/ci-cd.yml');
  const security = ci.match(/\n  security-scan:[\s\S]*?(?=\n  [a-zA-Z0-9_-]+:|$)/)?.[0] || '';
  assert.ok(security, 'security-scan job must exist');
  assert.ok(!/continue-on-error:\s*true/.test(security), 'Security Scan must fail the workflow when audit or secret scanning fails');

  const dast = read('.github/workflows/hawkscan.yml');
  assert.ok(!/continue-on-error:\s*true/.test(dast), 'required DAST may not swallow scanner failures');
});

test('NC fake green: required DAST cannot succeed by skipping all scan steps', () => {
  const dast = read('.github/workflows/hawkscan.yml');
  assert.match(dast, /HAWK_API_KEY is absent[\s\S]*?exit 1/, 'missing DAST credentials must fail closed');
  assert.ok(!/run=false/.test(dast), 'required DAST must not emit a green no-op state');
});

test('NC hidden skip: worker proof supplies an authenticated control channel on both platforms', () => {
  const worker = read('.github/workflows/agent-control-worker-proof.yml');
  const matches = worker.match(/GH_TOKEN:\s*\$\{\{ github\.token \}\}/g) || [];
  assert.equal(matches.length, 2, 'portable and Windows worker proof must both receive GH_TOKEN');
});

test('NC hidden skip: worker cursor proof is mandatory in CI', () => {
  const testSource = read('scripts/agent-control/tests/worker.spec.mjs');
  assert.match(testSource, /CI_REQUIRES_CHANNEL/);
  assert.match(testSource, /CI requires PowerShell plus an authenticated GitHub control channel/);
  assert.ok(!/skip:\s*CHANNEL_READY\s*\?\s*false/.test(testSource), 'CI proof must not use the old unconditional channel skip');
});

test('capture-and-reraise remains explicit for Branch divergence', () => {
  const divergence = read('.github/workflows/branch-divergence.yml');
  const tolerated = (divergence.match(/continue-on-error:\s*true/g) || []).length;
  assert.ok(tolerated >= 1, 'branch divergence intentionally captures command status to render evidence');
  assert.match(divergence, /Fail when thresholds exceeded[\s\S]*?exit 1/, 'captured divergence failure must be re-raised explicitly');
});
