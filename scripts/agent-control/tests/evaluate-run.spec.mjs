/**
 * Behavioural proofs for the run verdict.
 *
 * These feed recorded-shape transcripts to evaluate-run.ps1 and assert the
 * decision, rather than grepping the worker for strings. The string-matching
 * version of these assertions passed while the check it claimed to cover had
 * been removed, which is the whole reason this file exists.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const EVALUATOR = 'scripts/agent-control/evaluate-run.ps1';
const MSG = 'CG-DIRECTIVE-TEST-001';

function powershell() {
  for (const bin of ['pwsh', 'powershell']) {
    const probe = spawnSync(bin, ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], { encoding: 'utf8' });
    if (probe.status === 0) return bin;
  }
  return null;
}
const PS = powershell();

/** Run the evaluator against a synthetic transcript. */
function evaluate(transcript, messageId = MSG) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-eval-'));
  const file = path.join(dir, 'run.json');
  if (transcript !== null) fs.writeFileSync(file, JSON.stringify(transcript), 'utf8');
  const run = spawnSync(
    PS,
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.resolve(EVALUATOR), '-RunFile', file, '-MessageId', messageId],
    { encoding: 'utf8' },
  );
  fs.rmSync(dir, { recursive: true, force: true });
  let verdict = null;
  try {
    verdict = JSON.parse((run.stdout || '').trim());
  } catch {
    /* leave null so the assertion reports the raw output */
  }
  return { status: run.status, verdict, raw: run.stdout, stderr: run.stderr };
}

const done = (extra = {}) => ({
  is_error: false,
  permission_denials: [],
  result: `Processed it.\n\nKEYFLOW-WORKER-DONE: ${MSG}`,
  ...extra,
});

test('a completed session with the marker is a success', { skip: PS ? false : 'no PowerShell' }, () => {
  const { status, verdict } = evaluate(done());
  assert.equal(status, 0);
  assert.equal(verdict.ok, true);
  assert.equal(verdict.reason, 'completed');
});

test('THE FALSE SUCCESS: a fully blocked session exits 0 but is NOT a success', { skip: PS ? false : 'no PowerShell' }, () => {
  // This is the recorded shape of the real failure: every tool call denied,
  // exit 0, is_error false, no marker. The worker used to record this as
  // processed, so the directive would never be retried.
  const blocked = {
    is_error: false,
    permission_denials: [
      { tool_name: 'Bash', tool_input: { command: 'gh issue view 80' } },
      { tool_name: 'Bash', tool_input: { command: 'git fetch origin main' } },
    ],
    result: 'I stopped before doing anything. I could not read or reply on the control room.',
  };
  const { status, verdict } = evaluate(blocked);
  assert.equal(status, 1, 'a blocked session must not be a success');
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, 'no_completion_marker');
  assert.equal(verdict.denial_count, 2);
});

test('a denial that did NOT stop the work is only a warning', { skip: PS ? false : 'no PowerShell' }, () => {
  // The opposite failure: failing on any denial leaves the message unprocessed
  // and the worker re-wakes on it every poll.
  const workedAround = done({
    permission_denials: [{ tool_name: 'Bash', tool_input: { command: 'cat > scratch.md' } }],
  });
  const { status, verdict } = evaluate(workedAround);
  assert.equal(status, 0, 'a session that finished despite a denial is a success');
  assert.equal(verdict.ok, true);
  assert.equal(verdict.denial_count, 1, 'but the denial is still reported');
  assert.deepEqual(verdict.denied_tools, ['Bash']);
});

test('an explicit BLOCKED report is a retryable failure', { skip: PS ? false : 'no PowerShell' }, () => {
  const { status, verdict } = evaluate({
    is_error: false,
    permission_denials: [],
    result: 'KEYFLOW-WORKER-BLOCKED: the control channel was unreadable',
  });
  assert.equal(status, 1);
  assert.match(verdict.reason, /session_reported_blocked: the control channel was unreadable/);
});

test('is_error is a failure even with a marker present', { skip: PS ? false : 'no PowerShell' }, () => {
  const { status, verdict } = evaluate(done({ is_error: true }));
  assert.equal(status, 1);
  assert.equal(verdict.reason, 'session_reported_is_error');
});

test("a marker for a DIFFERENT message does not count", { skip: PS ? false : 'no PowerShell' }, () => {
  const { status, verdict } = evaluate({
    is_error: false,
    permission_denials: [],
    result: 'KEYFLOW-WORKER-DONE: SOME-OTHER-MESSAGE-999',
  });
  assert.equal(status, 1, 'the marker must name this message');
  assert.equal(verdict.reason, 'no_completion_marker');
});

test('a missing or unparseable transcript is a failure', { skip: PS ? false : 'no PowerShell' }, () => {
  const missing = evaluate(null);
  assert.equal(missing.status, 1);
  assert.equal(missing.verdict.reason, 'transcript_missing');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-eval-'));
  const file = path.join(dir, 'run.json');
  fs.writeFileSync(file, 'not json at all', 'utf8');
  const run = spawnSync(
    PS,
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.resolve(EVALUATOR), '-RunFile', file, '-MessageId', MSG],
    { encoding: 'utf8' },
  );
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(run.status, 1);
  assert.match(run.stdout, /transcript_unparseable/);
});

test('the real recorded transcripts from the live wake proof evaluate correctly', { skip: PS ? false : 'no PowerShell' }, () => {
  // Uses whatever the worker actually recorded on this machine, if present.
  const runFile = '.agent-control/.worker/run-TEST-WAKE-PROOF-001.json';
  if (!fs.existsSync(runFile)) return;
  const run = spawnSync(
    PS,
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.resolve(EVALUATOR), '-RunFile', path.resolve(runFile), '-MessageId', 'TEST-WAKE-PROOF-001'],
    { encoding: 'utf8' },
  );
  const verdict = JSON.parse(run.stdout.trim());
  assert.equal(typeof verdict.ok, 'boolean');
  assert.ok(['completed', 'no_completion_marker'].includes(verdict.reason) || /blocked/.test(verdict.reason));
});
