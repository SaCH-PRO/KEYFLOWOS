import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEvent, concurrencyKey, parseControlMessage, readField } from '../lib/events.mjs';

const comment = (body, id = 5001) => ({
  issue: { number: 80 },
  action: 'created',
  comment: { id, body, html_url: 'https://example/x', user: { login: 'SaCH-PRO' } },
});

test('RETURN on the control issue is actionable', () => {
  const e = normalizeEvent('issue_comment', comment('message_id: X\nmessage_type: RETURN\npacket_id: P\nstate: PROVING\nhealth: GREEN'));
  assert.equal(e.actionable, true);
  assert.equal(e.kind, 'RETURN');
  assert.equal(e.packet_id, 'P');
});

test('a comment on another issue is ignored', () => {
  const e = normalizeEvent('issue_comment', { issue: { number: 79 }, comment: { id: 1, body: 'message_type: RETURN' } });
  assert.equal(e.actionable, false);
  assert.equal(e.idempotency_key, null);
});

test('ordinary PROGRESS is recorded but is not a wake event', () => {
  const e = normalizeEvent('issue_comment', comment('message_type: PROGRESS'));
  assert.equal(e.actionable, false);
  assert.equal(e.kind, 'PROGRESS');
});

// ------------------------------------------------------------- F3 IDEMPOTENCY

test('F3: the same comment replayed under different run ids yields one key', () => {
  process.env.GITHUB_RUN_ID = '111';
  const first = normalizeEvent('issue_comment', comment('message_type: RETURN', 4242));
  process.env.GITHUB_RUN_ID = '222';
  const second = normalizeEvent('issue_comment', comment('message_type: RETURN', 4242));
  delete process.env.GITHUB_RUN_ID;
  assert.equal(first.idempotency_key, second.idempotency_key);
  assert.equal(first.idempotency_key, 'issue_comment:4242:created');
});

test('F3: a workflow_run re-observed keeps one key; a new attempt is a new key', () => {
  const payload = (attempt) => ({
    workflow_run: { id: 99, run_attempt: attempt, name: 'CI/CD Pipeline', status: 'completed', conclusion: 'success', head_sha: 'abc', pull_requests: [{ number: 9 }] },
  });
  assert.equal(normalizeEvent('workflow_run', payload(1)).idempotency_key, 'workflow_run:99:1');
  assert.equal(normalizeEvent('workflow_run', payload(1)).idempotency_key, 'workflow_run:99:1');
  assert.notEqual(normalizeEvent('workflow_run', payload(2)).idempotency_key, 'workflow_run:99:1');
});

test('F3: a merged PR keys on the merge commit, so replay converges', () => {
  const payload = {
    action: 'closed',
    pull_request: { number: 9, merged: true, merge_commit_sha: 'deadbeef', head: { ref: 'impl/x', sha: 'abc' }, base: { sha: 'base' } },
  };
  const a = normalizeEvent('pull_request_target', payload);
  const b = normalizeEvent('pull_request_target', payload);
  assert.equal(a.idempotency_key, b.idempotency_key);
  assert.equal(a.idempotency_key, 'pr_merged:9:deadbeef');
  assert.equal(a.actionable, true);
});

test('F3: scheduled ticks inside one hour collapse to one key', () => {
  const a = normalizeEvent('schedule', { schedule_time: '2026-09-23T21:17:00Z' });
  const b = normalizeEvent('schedule', { schedule_time: '2026-09-23T21:59:00Z' });
  const c = normalizeEvent('schedule', { schedule_time: '2026-09-23T22:01:00Z' });
  assert.equal(a.idempotency_key, b.idempotency_key);
  assert.notEqual(a.idempotency_key, c.idempotency_key);
});

test('NEGATIVE CONTROL: no idempotency key is ever the observing run id', () => {
  process.env.GITHUB_RUN_ID = '987654321';
  const events = [
    normalizeEvent('issue_comment', comment('message_type: RETURN')),
    normalizeEvent('workflow_run', { workflow_run: { id: 1, run_attempt: 1, status: 'completed', pull_requests: [{ number: 2 }] } }),
    normalizeEvent('pull_request_target', { action: 'closed', pull_request: { number: 3, merged: true, merge_commit_sha: 'm', head: { ref: 'impl/a' } } }),
    normalizeEvent('schedule', {}),
  ];
  for (const e of events) {
    assert.ok(!String(e.idempotency_key).includes('987654321'), `${e.kind} key leaked the run id: ${e.idempotency_key}`);
  }
  delete process.env.GITHUB_RUN_ID;
});

test('a merged PR without a merge commit is malformed, not actionable', () => {
  const e = normalizeEvent('pull_request_target', {
    action: 'closed',
    pull_request: { number: 9, merged: true, head: { ref: 'impl/x' } },
  });
  assert.equal(e.actionable, false);
  assert.equal(e.kind, 'MALFORMED');
});

test('a comment with no id is malformed rather than silently keyed', () => {
  const e = normalizeEvent('issue_comment', { issue: { number: 80 }, comment: { body: 'message_type: RETURN' } });
  assert.equal(e.kind, 'MALFORMED');
  assert.equal(e.idempotency_key, null);
});

// ------------------------------------------------------------- F1 CONCURRENCY

test('F1: schedule and workflow_run for the same packet share one concurrency key', () => {
  const scheduled = normalizeEvent('schedule', {});
  const workflow = normalizeEvent('workflow_run', {
    workflow_run: { id: 5, run_attempt: 1, status: 'completed', conclusion: 'success', head_sha: 'h', pull_requests: [{ number: 12 }] },
  });
  assert.equal(concurrencyKey(scheduled, 'KF-META-AUTO-001'), concurrencyKey(workflow, 'KF-META-AUTO-001'));
  assert.equal(concurrencyKey(scheduled, 'KF-META-AUTO-001'), 'packet:KF-META-AUTO-001');
});

test('F1: with no active packet, schedule still takes a shared programme-wide lock', () => {
  const a = concurrencyKey(normalizeEvent('schedule', { schedule_time: '2026-09-23T21:00:00Z' }), null);
  const b = concurrencyKey(normalizeEvent('schedule', { schedule_time: '2026-09-23T22:00:00Z' }), null);
  assert.equal(a, b, 'two scheduled sweeps must not run concurrently');
  assert.equal(a, 'programme:KEYFLOWOS');
});

test('NEGATIVE CONTROL: the prototype key (run id) would not have collided', () => {
  // Reproduces the F1 defect to prove the new test would catch it.
  const prototypeKey = (event, runId) => event.head_sha || event.pull_request_sha || runId;
  const scheduled = prototypeKey({}, 'run-1');
  const workflow = prototypeKey({ head_sha: 'abc' }, 'run-2');
  assert.notEqual(scheduled, workflow, 'the old scheme let a scheduled sweep run beside a workflow merge');
});

// ------------------------------------------------------------- FIELD PARSING

test('field reads are anchored so prose cannot spoof a control field', () => {
  const body = 'summary: >\n  someone wrote message_type: RETURN inside prose\nmessage_type: PROGRESS';
  assert.equal(parseControlMessage(body).message_type, 'PROGRESS');
});

test('null and empty fields normalize to null', () => {
  assert.equal(readField('source_head: null', 'source_head'), null);
  assert.equal(readField('source_head:', 'source_head'), null);
  assert.equal(readField('source_head: abc123', 'source_head'), 'abc123');
});
