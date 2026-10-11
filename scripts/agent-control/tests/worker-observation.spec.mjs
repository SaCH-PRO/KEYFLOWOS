/**
 * Worker observation proofs (lib/worker-observation.mjs, worker-status.mjs).
 *
 * Twice the worker was alive and delivering nothing, and only its log said
 * so: 1,650 identical errors from a worker whose scripts had left the disk,
 * and a directive whose worktree could not be made, retried every two minutes
 * with an empty ledger. Each proof below builds a state directory as the
 * worker would have left it and asserts what the observation says about it.
 * The log lines are the worker's real lines.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { observeWorker, renderWorker, parseLog, STALE_TICK_SECONDS, REPEATING_ERROR_TICKS } from '../lib/worker-observation.mjs';

const CLI = 'scripts/agent-control/worker-status.mjs';
const NOW = new Date('2026-10-11T18:00:00Z');
const BOM = '\uFEFF';

/** A control-room comment as `gh issue view --json comments` stores it, with the full envelope. */
function authority(id, n, type = 'DIRECTIVE') {
  const fields = {
    message_id: id, message_type: type, packet_id: 'KF-TEST-001', sender: 'chatgpt',
    source_main: 'null', implementation_branch: 'null', state: 'RELEASED', health: 'GREEN',
    scope_changed: 'false', production_touched: 'false',
  };
  return {
    author: { login: 'SaCH-PRO' },
    body: ['```yaml', ...Object.entries(fields).map(([k, v]) => `${k}: ${v}`), '```'].join('\n'),
    createdAt: `2026-10-11T1${n}:00:00Z`,
    includesCreatedEdit: false,
    url: `https://github.com/SaCH-PRO/KEYFLOWOS/issues/80#issuecomment-${9000 + n}`,
  };
}

function stateDir({ cursor = [], ledger = [], comments = [], log = [], paused = false, raw = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-observe-'));
  const put = (name, value) => fs.writeFileSync(path.join(dir, name), typeof value === 'string' ? value : BOM + JSON.stringify(value, null, 4));
  put('cursor.json', { processed_message_ids: cursor, last_message_id: cursor[cursor.length - 1] ?? null, last_processed_at: cursor.length ? '2026-10-11T16:21:38Z' : null });
  put('attempts.json', { entries: ledger });
  put('comments.json', { comments });
  put('worker.lock', { pid: 25676, started_at: '2026-10-11T16:43:31.8776534Z', repo_root: 'C:\\control' });
  put('install.json', { contract_version: 2 });
  if (paused) put('paused.json', { paused_at: '2026-10-11T17:00:00Z' });
  fs.writeFileSync(path.join(dir, 'worker.log'), BOM + log.join('\r\n') + '\r\n');
  for (const [name, text] of Object.entries(raw)) fs.writeFileSync(path.join(dir, name), text);
  return dir;
}
const rm = (dir) => fs.rmSync(dir, { recursive: true, force: true });
const codes = (o) => o.attention.map((a) => a.code);
const idle = (at) => `${at} [INFO] no unprocessed directive`;

test('an idle, polling worker with everything processed needs no attention', () => {
  const dir = stateDir({
    cursor: ['CG-A-001'],
    comments: [authority('CG-A-001', 1)],
    log: ['2026-10-11T16:43:31Z [INFO] worker started (interval 120s, dry-run False, contract 2)', idle('2026-10-11T17:56:00Z'), idle('2026-10-11T17:58:10Z')],
  });
  try {
    const o = observeWorker(dir, { now: NOW });
    assert.equal(o.healthy, true, JSON.stringify(o.attention));
    assert.deepEqual([o.queued, o.running, o.blocked, o.failed], [[], null, [], []]);
    assert.equal(o.completed.count, 1);
    assert.equal(o.worker.last_log_age_seconds, 110);
    assert.equal(o.selection, 'newest_already_processed:CG-A-001');
    assert.equal(o.worker.lock_pid, 25676, 'BOM-prefixed JSON from Windows PowerShell 5.1 is read');
  } finally { rm(dir); }
});

test('queued: an unprocessed directive in the worker\'s last snapshot is shown', () => {
  const dir = stateDir({ cursor: ['CG-A-001'], comments: [authority('CG-A-001', 1), authority('CG-B-002', 2, 'REVIEW')], log: [idle('2026-10-11T17:58:10Z')] });
  try {
    const o = observeWorker(dir, { now: NOW });
    assert.deepEqual(o.queued, [{ message_id: 'CG-B-002', message_type: 'REVIEW', packet_id: 'KF-TEST-001' }]);
  } finally { rm(dir); }
});

test('running: a session that was woken and has no verdict yet, and it is not also queued', () => {
  const dir = stateDir({
    comments: [authority('CG-B-002', 2)],
    log: [
      '2026-10-11T16:17:32Z [INFO] unprocessed DIRECTIVE: CG-B-002',
      '2026-10-11T16:17:35Z [INFO] created worktree C:\\wt\\CG-B-002 at origin/main',
      '2026-10-11T16:17:35Z [INFO] invoking claude for CG-B-002 (KF-TEST-001), attempt 2, in C:\\wt\\CG-B-002',
    ],
  });
  try {
    const o = observeWorker(dir, { now: NOW });
    assert.deepEqual(o.running, { message_id: 'CG-B-002', packet_id: 'KF-TEST-001', attempt: 2, since: '2026-10-11T16:17:35Z' });
    assert.deepEqual(o.queued, []);
    // A session can run for an hour: an old last line is not a stopped worker while one is running.
    assert.ok(!codes(o).includes('TICKS_STOPPED'));
  } finally { rm(dir); }
});

test('running ends with a completion, a failed verdict, or a worker restart', () => {
  const invoke = '2026-10-11T16:17:35Z [INFO] invoking claude for CG-B-002 (KF-TEST-001), attempt 1, in C:\\wt\\CG-B-002';
  for (const end of [
    '2026-10-11T16:21:38Z [INFO] claude completed for CG-B-002',
    '2026-10-11T16:21:38Z [ERROR] run verdict for CG-B-002: no_completion_marker; leaving it unprocessed so it stays retryable',
    '2026-10-11T16:43:31Z [INFO] worker started (interval 120s, dry-run False, contract 2)',
  ]) {
    const dir = stateDir({ log: [invoke, end, idle('2026-10-11T17:58:10Z')] });
    try { assert.equal(observeWorker(dir, { now: NOW }).running, null, end); } finally { rm(dir); }
  }
});

test('blocked and failed: a held directive and a retryable one are listed apart, and a held one is not "queued"', () => {
  const dir = stateDir({
    comments: [authority('CG-HELD-008', 3)],
    ledger: [
      { message_id: 'CG-HELD-008', packet_id: 'KF-TEST-001', attempts: 5, last_signature: 'session_reported_blocked: x', held: true, held_reason: '5 failed attempts in total (backstop)', held_at: '2026-10-03T04:45:22Z', escalation_posted: true },
      { message_id: 'CG-RETRY-001', packet_id: 'KF-TEST-001', attempts: 1, last_signature: 'no_completion_marker', held: false },
    ],
    log: ['2026-10-11T17:58:10Z [HELD_RETRYABLE] CG-HELD-008 is held (5 failed attempts in total (backstop)); not waking claude until a newer directive or -ReleaseHold'],
  });
  try {
    const o = observeWorker(dir, { now: NOW });
    assert.deepEqual(o.blocked.map((b) => [b.message_id, b.attempts, b.escalation_posted]), [['CG-HELD-008', 5, true]]);
    assert.deepEqual(o.failed.map((f) => [f.message_id, f.last_failure]), [['CG-RETRY-001', 'no_completion_marker']]);
    assert.deepEqual(o.queued, [], 'the selector offers a held directive every tick; the worker declines it');
    assert.ok(codes(o).includes('DIRECTIVE_HELD') && codes(o).includes('DIRECTIVE_FAILED_RETRYABLE'));
    assert.equal(o.healthy, false);
  } finally { rm(dir); }
});

test('a hold whose escalation was never posted says so', () => {
  const dir = stateDir({ ledger: [{ message_id: 'CG-HELD-008', attempts: 2, held: true, held_reason: 'two identical failures', escalation_posted: false }], log: [idle('2026-10-11T17:58:10Z')] });
  try {
    assert.match(observeWorker(dir, { now: NOW }).attention.find((a) => a.code === 'DIRECTIVE_HELD').detail, /escalation NOT posted/);
  } finally { rm(dir); }
});

test('the same error ending tick after tick is reported; one or two are not', () => {
  const err = (at) => `${at} [ERROR] Invalid JSON primitive: Windows.`;
  const three = stateDir({ log: [idle('2026-10-11T17:50:00Z'), err('2026-10-11T17:52:00Z'), err('2026-10-11T17:54:00Z'), err('2026-10-11T17:56:00Z')] });
  const two = stateDir({ log: [idle('2026-10-11T17:52:00Z'), err('2026-10-11T17:54:00Z'), err('2026-10-11T17:56:00Z')] });
  const recovered = stateDir({ log: [err('2026-10-11T17:50:00Z'), err('2026-10-11T17:52:00Z'), err('2026-10-11T17:54:00Z'), idle('2026-10-11T17:56:00Z')] });
  try {
    assert.equal(REPEATING_ERROR_TICKS, 3);
    const o = observeWorker(three, { now: NOW });
    assert.deepEqual(o.repeating_error, { message: 'Invalid JSON primitive: Windows.', ticks: 3, since: '2026-10-11T17:52:00Z', last: '2026-10-11T17:56:00Z' });
    assert.ok(codes(o).includes('ERROR_REPEATING'));
    assert.equal(observeWorker(two, { now: NOW }).repeating_error, null);
    assert.equal(observeWorker(recovered, { now: NOW }).repeating_error, null, 'a tick that succeeded since ends the run');
  } finally { rm(three); rm(two); rm(recovered); }
});

test('the silent loop: a directive that fails before it is counted shows as queued but not delivered', () => {
  // 2026-10-11 12:10 to 12:34 UTC: the worktree could not be made, the error
  // was thrown before the ledger, and nothing was held or escalated.
  const fail = (at) => [
    `${at} [INFO] unprocessed DIRECTIVE: CG-LONG-004`,
    `${at} [ERROR] git worktree add failed for C:\\wt\\CG-LONG-004 at origin/impl/x`,
  ];
  const dir = stateDir({
    cursor: ['CG-A-001'],
    comments: [authority('CG-A-001', 1), authority('CG-LONG-004', 2)],
    ledger: [],
    log: [...fail('2026-10-11T17:52:00Z'), ...fail('2026-10-11T17:54:00Z'), ...fail('2026-10-11T17:56:00Z'), ...fail('2026-10-11T17:58:00Z')],
  });
  try {
    const o = observeWorker(dir, { now: NOW });
    assert.deepEqual(o.queued.map((q) => q.message_id), ['CG-LONG-004']);
    assert.deepEqual([o.blocked, o.failed], [[], []], 'the ledger knows nothing: that is the defect');
    assert.equal(o.repeating_error.ticks, 4);
    assert.ok(codes(o).includes('QUEUED_BUT_NOT_DELIVERED'));
  } finally { rm(dir); }
});

test('a worker that stopped ticking, is paused, or is waiting on an operator is flagged', () => {
  const stale = stateDir({ log: [idle('2026-10-11T17:40:00Z')] });
  const paused = stateDir({ paused: true, log: ['2026-10-11T17:58:10Z [PAUSED] worker is paused (claude-worker.ps1 -Resume to lift it); not polling'] });
  const waiting = stateDir({ log: ['2026-10-11T17:58:10Z [WAITING_EXTERNAL_AGENT] claude is not on PATH'] });
  const fresh = stateDir({ log: [idle('2026-10-11T17:51:00Z')] });
  try {
    assert.equal(STALE_TICK_SECONDS, 600);
    assert.deepEqual(codes(observeWorker(stale, { now: NOW })), ['TICKS_STOPPED']);
    assert.deepEqual(codes(observeWorker(paused, { now: NOW })), ['PAUSED']);
    assert.deepEqual(codes(observeWorker(waiting, { now: NOW })), ['WAITING_EXTERNAL_AGENT']);
    assert.deepEqual(codes(observeWorker(fresh, { now: NOW })), [], 'nine minutes is inside the limit');
  } finally { rm(stale); rm(paused); rm(waiting); rm(fresh); }
});

test('state it cannot read is reported as unreadable, never as empty', () => {
  const dir = stateDir({ cursor: ['CG-A-001'], log: [idle('2026-10-11T17:58:10Z')], raw: { 'cursor.json': '{"processed_message_ids": [', 'attempts.json': 'Windows PowerShell' } });
  try {
    const o = observeWorker(dir, { now: NOW });
    assert.deepEqual(o.attention.filter((a) => a.code === 'STATE_UNREADABLE').map((a) => a.detail.split(':')[0]), ['cursor.json', 'attempts.json']);
    assert.equal(o.healthy, false, 'a truncated cursor must not read as "nothing completed, all well"');
  } finally { rm(dir); }
});

test('a checkout no worker has run from says so', () => {
  const o = observeWorker(path.join(os.tmpdir(), 'kf-observe-absent-' + process.pid), { now: NOW });
  assert.equal(o.present, false);
  assert.deepEqual(codes(o), ['NO_WORKER_STATE']);
  assert.match(renderWorker(o), /No worker state here/);
});

test('it only reads: the state directory is byte-identical afterwards', () => {
  const dir = stateDir({ cursor: ['CG-A-001'], comments: [authority('CG-B-002', 2)], log: [idle('2026-10-11T17:58:10Z')] });
  try {
    const snapshot = () => fs.readdirSync(dir).sort().map((f) => [f, fs.readFileSync(path.join(dir, f)).toString('hex')]);
    const before = snapshot();
    observeWorker(dir, { now: NOW });
    spawnSync(process.execPath, [CLI, `--state-dir=${dir}`], { encoding: 'utf8' });
    assert.deepEqual(snapshot(), before);
  } finally { rm(dir); }
});

test('cli: exit 0 when nothing needs attention, 3 when something does, with the reason printed', () => {
  // The CLI uses the real clock, so the fixtures are stamped relative to it.
  const stamp = (secondsAgo) => new Date(Date.now() - secondsAgo * 1000).toISOString().replace(/\.\d+Z$/, 'Z');
  const ok = stateDir({ cursor: ['CG-A-001'], comments: [authority('CG-A-001', 1)], log: [idle(stamp(30))] });
  const held = stateDir({ ledger: [{ message_id: 'CG-HELD-008', attempts: 2, held: true, held_reason: 'two identical failures', escalation_posted: true }], log: [idle(stamp(30))] });
  try {
    const a = spawnSync(process.execPath, [CLI, `--state-dir=${ok}`], { encoding: 'utf8' });
    assert.equal(a.status, 0, a.stdout + a.stderr);
    assert.match(a.stdout, /Attention      : none/);
    const b = spawnSync(process.execPath, [CLI, `--state-dir=${held}`, '--json'], { encoding: 'utf8' });
    assert.equal(b.status, 3);
    assert.deepEqual(JSON.parse(b.stdout).attention.map((x) => x.code), ['DIRECTIVE_HELD']);
  } finally { rm(ok); rm(held); }
});

test('the log parser keeps only the worker\'s own lines', () => {
  const entries = parseLog(`${BOM}2026-10-11T17:58:10Z [INFO] no unprocessed directive\r\nstray text\r\n2026-10-11T18:00:21Z [WAITING_OPERATOR] worker_code_missing dir="C:\\x"\r\n`);
  assert.deepEqual(entries.map((e) => [e.at, e.level]), [['2026-10-11T17:58:10Z', 'INFO'], ['2026-10-11T18:00:21Z', 'WAITING_OPERATOR']]);
});
