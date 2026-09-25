import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { emptyState, recordEvent, hasProcessed, saveState, loadState, validateState, projectionDrift } from '../lib/state.mjs';
import { normalizeEvent } from '../lib/events.mjs';

const mergedEvent = () =>
  normalizeEvent('pull_request_target', {
    action: 'closed',
    pull_request: { number: 87, merged: true, merge_commit_sha: 'abc123', head: { ref: 'impl/x', sha: 'h' }, base: { sha: 'b' } },
  });

test('an event is journalled exactly once', () => {
  const event = mergedEvent();
  const first = recordEvent(emptyState(), event, { action: 'merge' });
  assert.equal(first.recorded, true);
  assert.equal(first.duplicate, false);
  assert.equal(first.state.event_journal.length, 1);
  assert.equal(first.state.last_processed_event_key, 'pr_merged:87:abc123');
});

test('RECOVERY: replaying the identical event produces no second effect', () => {
  const event = mergedEvent();
  const first = recordEvent(emptyState(), event, { action: 'merge' });
  const second = recordEvent(first.state, event, { action: 'merge' });
  assert.equal(second.duplicate, true);
  assert.equal(second.recorded, false);
  assert.equal(second.state.event_journal.length, 1, 'no duplicate journal entry');
  assert.equal(second.state, first.state, 'state is returned unmutated');
});

test('RECOVERY: a crashed workflow cannot double-merge or double-checkpoint', () => {
  const event = mergedEvent();
  let state = emptyState();
  let merges = 0;
  // Three crash/retry cycles of the same underlying event.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (hasProcessed(state, event.idempotency_key)) continue;
    merges += 1;
    state = recordEvent(state, event, { action: 'merge' }).state;
  }
  assert.equal(merges, 1, 'the merge effect happened exactly once across three retries');
});

test('NEGATIVE CONTROL: a run-id keyed journal double-merges on retry', () => {
  // Restores the F3 defect to prove the test above is not vacuous.
  let state = emptyState();
  let merges = 0;
  for (const runId of ['run-1', 'run-2', 'run-3']) {
    const defective = { ...mergedEvent(), idempotency_key: `autopilot:${runId}` };
    if (hasProcessed(state, defective.idempotency_key)) continue;
    merges += 1;
    state = recordEvent(state, defective, { action: 'merge' }).state;
  }
  assert.equal(merges, 3, 'the defective key scheme merges once per retry');
});

test('an event with no idempotency key is never silently journalled', () => {
  const result = recordEvent(emptyState(), { kind: 'IGNORE', idempotency_key: null });
  assert.equal(result.recorded, false);
  assert.match(result.reason, /no idempotency key/);
});

test('the journal survives a save/load round trip', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-state-'));
  try {
    const state = recordEvent(emptyState(), mergedEvent(), { action: 'merge', rule: 'AUTO-ADMISSION' }).state;
    state.programme.active_packet = 'KF-META-AUTO-001';
    state.programme.state = 'IMPLEMENTING';
    state.programme.health = 'GREEN';
    state.programme.source_main = '8'.repeat(40);
    saveState(state, root);

    const reloaded = loadState(root);
    assert.equal(reloaded.programme.active_packet, 'KF-META-AUTO-001');
    assert.equal(reloaded.programme.state, 'IMPLEMENTING');
    assert.equal(reloaded.event_journal.length, 1);
    assert.equal(reloaded.event_journal[0].key, 'pr_merged:87:abc123');
    assert.equal(hasProcessed(reloaded, 'pr_merged:87:abc123'), true, 'idempotency survives a restart');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------- VALIDATION

test('state validation rejects an unknown state and a non-sha source_main', () => {
  const bad = emptyState();
  bad.programme.state = 'ALMOST_DONE';
  bad.programme.source_main = 'not-a-sha';
  const v = validateState(bad);
  assert.equal(v.ok, false);
  const codes = v.problems.map((p) => p.code);
  assert.ok(codes.includes('UNKNOWN_STATE'));
  assert.ok(codes.includes('SOURCE_MAIN_NOT_A_SHA'));
});

test('production_touched=true is a validation failure, not a saveable state', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-state-'));
  try {
    const bad = emptyState();
    bad.programme.production_touched = true;
    assert.throws(() => saveState(bad, root), /PRODUCTION_TOUCHED/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('merge_authority cannot be true without a recorded marker', () => {
  const bad = emptyState();
  bad.programme.merge_authority = true;
  assert.ok(validateState(bad).problems.some((p) => p.code === 'MERGE_AUTHORITY_WITHOUT_MARKER'));
});

// ------------------------------------------------------------- DRIFT

test('board drift is reported, and reporting does not rewrite programme-state', () => {
  const state = emptyState();
  state.programme.active_packet = 'KF-META-AUTO-001';
  state.programme.state = 'IMPLEMENTING';
  state.programme.health = 'GREEN';

  // The intelligence board still projects the held packet as active.
  const drift = projectionDrift(state, { active_packet: 'KF-EXEC-ACTION-001', state: 'CHARACTERIZING', health: 'GREEN' });
  assert.equal(drift.drift, true);
  const fields = drift.details.map((d) => d.field);
  assert.ok(fields.includes('active_packet'));
  assert.ok(fields.includes('state'));
  // Reporting must not change the programme-state values.
  assert.equal(state.programme.active_packet, 'KF-META-AUTO-001');
});

test('no drift is reported when the projection agrees', () => {
  const state = emptyState();
  state.programme.active_packet = 'KF-META-AUTO-001';
  state.programme.state = 'IMPLEMENTING';
  const drift = projectionDrift(state, { active_packet: 'KF-META-AUTO-001', state: 'IMPLEMENTING' });
  assert.equal(drift.drift, false);
});
