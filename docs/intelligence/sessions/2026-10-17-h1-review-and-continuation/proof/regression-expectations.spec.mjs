// Review probes: expected to FAIL on PR #179; no repository file is modified.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const REPO = path.resolve(process.env.KF_H1_REPO || process.cwd());
const moduleUrl = (name) => pathToFileURL(path.join(REPO, 'scripts/agent-control/lib', name)).href;
const { projectHandoffs } = await import(moduleUrl('handoff-projector.mjs'));
const { createHandoffMonitor, CollectionError } = await import(moduleUrl('handoff-collector.mjs'));
const { createFixtureTransport } = await import(moduleUrl('handoff-fixture-transport.mjs'));
const { collectAuthority } = await import(moduleUrl('control-envelope.mjs'));
const { readEffect } = await import(moduleUrl('authority-effects.mjs'));

const HEAD = 'a'.repeat(40), MAIN = 'c'.repeat(40);
const at = (minute) => `2026-10-17T05:${String(minute).padStart(2, '0')}:00Z`;
const msg = (id, minute, fields, author = 'SaCH-PRO') => ({
  id, created_at: at(minute), updated_at: at(minute), user: { login: author },
  body: Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join('\n'),
});
const base = { packet_id: 'KF-X-1', source_main: MAIN, source_head: HEAD,
  implementation_branch: 'impl/kf-x-1', pr_number: 500, state: 'PROVING', health: 'YELLOW',
  scope_changed: false, production_touched: false };
const req = (extra = {}) => msg(9000000000, 1, { ...base, message_id: 'CG-REQ-1', message_type: 'REVIEW',
  sender: 'chatgpt', recipient: 'claude', control_effect: 'NO_STATE_CHANGE', merge_authority: false, ...extra });
const ret = () => msg(9000000002, 5, { message_id: 'CC-RET-1', message_type: 'RETURN', sender: 'claude',
  in_reply_to: 'CG-REQ-1', reviewed_head: HEAD, pr_number: 500, semantic_review_outcome: 'PASS', unresolved_substantive_findings: 0 });
const admit = (extra = {}, minute = 7, id = 9000000003) => msg(id, minute, { ...base, message_id: 'CG-ADMIT-1',
  message_type: 'REVIEW', sender: 'chatgpt', in_reply_to: 'CC-RET-1', return_comment_id: 9000000002,
  control_effect: 'PACKET_ADMISSION', merge_authority: true, review_status: 'READY_TO_MERGE',
  unresolved_substantive_findings: 0, state: 'READY_TO_MERGE', health: 'GREEN', ...extra });
const task = (snap) => snap.tasks.find((x) => x.task_id === 9000000000);
const pulls = { 500: { head: { sha: HEAD }, state: 'open' } };

test('a canonical effect rejection cannot render a valid merge grant', () => {
  const valid = admit();
  assert.equal(readEffect(collectAuthority([valid]).messages[0]).ok, true);
  assert.equal(task(projectHandoffs([req(), ret(), valid])).merge_authority.status, 'GRANTED');
  const bad = admit({ message_type: 'DIRECTIVE' });
  assert.equal(readEffect(collectAuthority([bad]).messages[0]).code, 'CONTROL_EFFECT_TYPE_MISMATCH');
  assert.notEqual(task(projectHandoffs([req(), ret(), bad])).merge_authority.status, 'GRANTED');
});

test('a newer explicit correction does not leave the earlier grant displayed as current', () => {
  const correction = admit({ message_id: 'CG-CORRECT-1', control_effect: 'PACKET_CORRECTION',
    merge_authority: false, review_status: 'CHANGES_REQUIRED', state: 'FIXING_PROOF_FAILURES', health: 'YELLOW' }, 8, 9000000004);
  const t = task(projectHandoffs([req(), ret(), admit(), correction]));
  assert.equal(t.stages.DECISION_RECORDED.disposition, 'CHANGES_REQUIRED');
  assert.notEqual(t.merge_authority.status, 'GRANTED');
});

test('a delayed edit must invalidate cached authority even below the global latest timestamp', async () => {
  const r = req();
  const latest = msg(9000000009, 10, { message_id: 'AUTO-EVENT-new', message_type: 'AUTO_EVENT', sender: 'github-autopilot' }, 'github-actions[bot]');
  let clock = Date.parse(at(11));
  const transport = createFixtureTransport({ comments: [r, ret(), latest], pulls });
  const monitor = createHandoffMonitor({ transport, now: () => clock, config: { minRefreshMs: 1, fullResyncMs: 0 } });
  assert.equal((await monitor.read()).snapshot.authority_record.verified, true);
  transport.dataset.comments[0] = { ...r, updated_at: at(9), body: `${r.body}\n\nChanged after posting.` };
  assert.equal(projectHandoffs(transport.dataset.comments).authority_record.code, 'AUTHORITY_EDITED');
  clock += 60000;
  const got = await monitor.read();
  assert.equal(got.snapshot.authority_record.code, 'AUTHORITY_EDITED');
});

test('a new next-page link on 304 remains traversable on full resync', async () => {
  let clock = Date.parse(at(11));
  const comments = Array.from({ length: 100 }, (_, i) => msg(8000000000+i, 1,
    { message_id: `CC-NOTE-${i}`, message_type: 'PROGRESS', sender: 'claude' }));
  const transport = createFixtureTransport({ comments });
  const monitor = createHandoffMonitor({ transport, now: () => clock, config: { minRefreshMs: 1, fullResyncMs: 3600000 } });
  assert.equal((await monitor.read()).snapshot.counts.comments, 100);
  transport.dataset.comments.push(msg(8000000100, 12, { message_id: 'CC-NEW', message_type: 'PROGRESS', sender: 'claude' }));
  clock = Date.parse(at(12));
  assert.equal((await monitor.read()).snapshot.counts.comments, 101);
  monitor.config.fullResyncMs = 0;
  clock = Date.parse(at(13));
  const got = await monitor.read();
  assert.equal(got.freshness.coverage.status, 'COMPLETE');
  assert.equal(got.snapshot.counts.comments, 101);
});

test('partial PR collection cannot advance overall success time and erase known-good facts', async () => {
  let fail = false, clock = Date.parse(at(11));
  const transport = createFixtureTransport({ comments: [req(), ret()], pulls },
    { fail: (url) => fail && /\/pulls\//.test(url) ? new CollectionError('TIMEOUT', 'PR timed out') : null });
  const monitor = createHandoffMonitor({ transport, now: () => clock, config: { minRefreshMs: 1, fullResyncMs: 0 } });
  const before = await monitor.read();
  assert.equal(task(before.snapshot).revision.current_status, 'CURRENT');
  fail = true; clock += 60000;
  const got = await monitor.read();
  assert.equal(got.freshness.last_success_at, before.freshness.last_success_at);
  assert.notEqual(got.freshness.coverage.status, 'COMPLETE');
});

test('partial count mismatch retains the previous complete handoff snapshot', async () => {
  let clock = Date.parse(at(11));
  const transport = createFixtureTransport({ comments: [req(), ret()], pulls });
  const monitor = createHandoffMonitor({ transport, now: () => clock, config: { minRefreshMs: 1, fullResyncMs: 0 } });
  const before = await monitor.read();
  assert.equal(task(before.snapshot).delivery.stage, 'RETURNED');
  transport.dataset.issueCount = 2;
  transport.dataset.comments = [req()];
  clock += 60000;
  const got = await monitor.read();
  assert.equal(got.freshness.coverage.status, 'PARTIAL');
  assert.equal(task(got.snapshot).delivery.stage, 'RETURNED');
});

test('last-observed age advances with time on successful unchanged refreshes', async () => {
  const progress = msg(9000000001, 10, { message_id: 'CC-PROG-1', message_type: 'PROGRESS', sender: 'claude', in_reply_to: 'CG-REQ-1' });
  let clock = Date.parse(at(11));
  const monitor = createHandoffMonitor({ transport: createFixtureTransport({ comments: [req(), progress], pulls }),
    now: () => clock, config: { minRefreshMs: 1, fullResyncMs: 0 } });
  assert.equal(task((await monitor.read()).snapshot).stages.WORKING_LAST_OBSERVED.age_seconds, 60);
  clock += 3600000;
  assert.equal(task((await monitor.read()).snapshot).stages.WORKING_LAST_OBSERVED.age_seconds, 3660);
});

test('a correlated implementation RETURN supplies its newly created PR for truth collection', async () => {
  const r = req({ message_type: 'DIRECTIVE', pr_number: 'null' });
  const transport = createFixtureTransport({ comments: [r, ret()], pulls });
  const got = await createHandoffMonitor({ transport, now: () => Date.parse(at(11)) }).read();
  assert.equal(got.freshness.coverage.pulls_requested, 1);
  assert.equal(task(got.snapshot).revision.current_status, 'CURRENT');
});
