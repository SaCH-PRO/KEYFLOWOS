/**
 * The read-only handoff viewer's projector and collector.
 * (KF-META-HANDOFF-MONITOR-001, scope issue #178, acceptance matrix)
 *
 * Each negative case is paired with its referent: the same chain with the
 * defect removed reaches the stage, so no assertion passes on a projection
 * that simply never advances.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  STAGES,
  WORKER_AVAILABILITY,
  projectHandoffs,
  redactCredentials,
  safeSourceUrl,
  viewOf,
} from '../lib/handoff-projector.mjs';
import {
  CollectionError,
  allowedRequest,
  createGithubTransport,
  createHandoffMonitor,
} from '../lib/handoff-collector.mjs';
import { createFixtureTransport, loadFixture } from '../lib/handoff-fixture-transport.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const IRP177 = path.join(HERE, '..', 'fixtures', 'handoff-irp177.json');

const HEAD = 'a'.repeat(40);
const OTHER_HEAD = 'b'.repeat(40);
const MAIN = 'c'.repeat(40);

let nextId = 9_000_000_000;
const at = (minute) => `2026-10-17T05:${String(minute).padStart(2, '0')}:00Z`;

/** A REST-shaped #80 comment from the shared owner account. */
function comment(minute, lines, { author = 'SaCH-PRO', id = nextId++, updated = null } = {}) {
  return {
    id,
    html_url: `https://github.com/SaCH-PRO/KEYFLOWOS/issues/80#issuecomment-${id}`,
    created_at: at(minute),
    updated_at: updated || at(minute),
    user: { login: author },
    body: `${lines.join('\n')}\n\nprose follows here, indented or not a key line.`,
  };
}

const envelope = (fields) => Object.entries(fields).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}: ${v}`);

function request(minute, extra = {}, opts) {
  return comment(minute, envelope({
    message_id: 'CG-REQ-1', message_type: 'REVIEW', packet_id: 'KF-X-1', sender: 'chatgpt', recipient: 'claude',
    source_main: MAIN, source_head: HEAD, implementation_branch: 'impl/kf-x-1', pr_number: 500,
    state: 'PROVING', health: 'YELLOW', scope_changed: 'false', production_touched: 'false',
    control_effect: 'NO_STATE_CHANGE', merge_authority: 'false', ...extra,
  }), opts);
}
function ack(minute, extra = {}, opts) {
  return comment(minute, envelope({
    message_id: 'CC-ACK-1', message_type: 'ACK', packet_id: 'KF-X-1', sender: 'claude', in_reply_to: 'CG-REQ-1',
    source_head: HEAD, pr_number: 500, ...extra,
  }), opts);
}
function ret(minute, ackComment, extra = {}, opts) {
  return comment(minute, envelope({
    message_id: 'CC-RET-1', message_type: 'RETURN', packet_id: 'KF-X-1', sender: 'claude', recipient: 'chatgpt',
    in_reply_to: 'CG-REQ-1', ack_ref: ackComment ? ackComment.html_url : undefined, reviewed_head: HEAD, pr_number: 500,
    semantic_review_outcome: 'CHANGES_REQUIRED', unresolved_substantive_findings: 3, ...extra,
  }), opts);
}
function receipt(minute, retComment, extra = {}, opts) {
  return comment(minute, envelope({
    message_id: 'CG-RECEIPT-1', message_type: 'PROGRESS', packet_id: 'KF-X-1', sender: 'chatgpt', recipient: 'claude',
    in_reply_to: 'CC-RET-1', return_comment_id: retComment.id, source_head: HEAD, pr_number: 500,
    review_status: 'CHANGES_REQUIRED', unresolved_substantive_findings: 3, receipt_status: 'CONSUMED', merge_authority: 'false', ...extra,
  }), opts);
}

function chain() {
  const r = request(1);
  const a = ack(2);
  const t = ret(5, a);
  const c = receipt(7, t);
  return { r, a, t, c, all: [r, a, t, c] };
}

const taskOf = (snapshot, id = 'CG-REQ-1') => snapshot.tasks.find((t) => t.request.message_id === id);
const status = (task, stage) => task.stages[stage].status;
const project = (comments, extra = {}) => projectHandoffs(comments, { observedAt: at(30), ...extra });

// ------------------------------------------------------------ real fixture

test('the real PR #177 chain: returned, consumed, CHANGES_REQUIRED, six findings, no merge grant, liveness UNKNOWN', () => {
  const fx = loadFixture(IRP177);
  const pulls = [{ number: 177, head_sha: fx.pulls['177'].head.sha, state: 'OPEN_DRAFT' }];
  const snap = projectHandoffs(fx.comments, { observedAt: '2026-10-17T05:00:00Z', pulls });
  const task = taskOf(snap, 'CG-DIR-IRP177-REVIEW-001');

  assert.equal(task.task_id, 6229439023);
  assert.deepEqual(task.stages.ACKNOWLEDGED.evidence.map((e) => e.comment_id), [6229470452]);
  assert.deepEqual(task.stages.RETURNED.evidence.map((e) => e.comment_id), [6229520428]);
  assert.deepEqual(task.stages.RETURN_CONSUMED.evidence.map((e) => e.comment_id), [6229558462]);
  assert.equal(task.stages.RETURN_CONSUMED.receipt_status, 'CONSUMED');
  assert.equal(task.stages.DECISION_RECORDED.disposition, 'CHANGES_REQUIRED');
  assert.equal(task.stages.DECISION_RECORDED.classification, 'EVIDENCE_ONLY');
  assert.equal(task.delivery.stage, 'DECISION_RECORDED');
  assert.deepEqual(task.delivery.gaps, []);

  assert.equal(task.review.outcome, 'CHANGES_REQUIRED');
  assert.notEqual(task.review.outcome, 'PASS');
  assert.equal(task.review.unresolved_substantive_findings, 6);
  assert.equal(task.review.findings_ref.safe_url, 'https://github.com/SaCH-PRO/KEYFLOWOS/pull/177#issuecomment-6229516997');
  assert.equal(task.merge_authority.status, 'NOT_GRANTED');

  assert.equal(task.revision.requested_head, '8ecb71582bb916c9d915493de050d7925c372634');
  assert.equal(task.revision.returned_head, '8ecb71582bb916c9d915493de050d7925c372634');
  assert.equal(task.revision.status, 'MATCH');
  // The PR has moved on since the review: historical, not current approval.
  assert.equal(task.revision.current_pr_head, fx.pulls['177'].head.sha);
  assert.equal(task.revision.current_status, fx.pulls['177'].head.sha === task.revision.returned_head ? 'CURRENT' : 'SUPERSEDED');
  assert.equal(task.confidence, 'HIGH');

  // No liveness claim for the reviewer, and no telemetry.
  assert.equal(status(task, 'WORKING_LAST_OBSERVED'), 'NOT_OBSERVED');
  assert.deepEqual(snap.worker, WORKER_AVAILABILITY);
  assert.equal(snap.worker.status, 'UNKNOWN');

  // Account-level provenance only: one login speaks as both agents.
  assert.deepEqual(snap.provenance.shared_accounts, [{ login: 'SaCH-PRO', senders: ['chatgpt', 'claude'] }]);
  const returned = task.returns[0];
  assert.match(returned.claimed_model, /claude-opus-5-5/);
  assert.equal(snap.messages.find((m) => m.comment_id === 6229520428).provenance.shared_account, true);

  // ChatGPT's own PROGRESS on its request is context, never a stage.
  assert.deepEqual(task.related.map((r) => r.comment_id), [6229480291]);
  assert.equal(snap.counts.auto_events, 2);
  assert.equal(snap.unmatched.length, 0);
});

// ------------------------------------------------------- delivery stages

test('request -> ACK -> RETURN -> receipt reaches every stage; the referent of the negative cases below', () => {
  const { r, a, t, c, all } = chain();
  const task = taskOf(project(all));
  assert.equal(task.task_id, r.id);
  assert.equal(task.stages.ACKNOWLEDGED.evidence[0].comment_id, a.id);
  assert.equal(task.stages.RETURNED.evidence[0].comment_id, t.id);
  assert.equal(task.stages.RETURN_CONSUMED.evidence[0].comment_id, c.id);
  assert.equal(task.stages.DECISION_RECORDED.evidence[0].comment_id, c.id);
  assert.equal(task.review.outcome, 'CHANGES_REQUIRED');
  assert.equal(task.revision.status, 'MATCH');
  assert.equal(task.confidence, 'HIGH');
  assert.equal(task.delivery.pending.party, 'SEE_DECISION');
});

test('a PASS RETURN is PASS and CHANGES_REQUIRED never becomes PASS', () => {
  const r = request(1);
  const a = ack(2);
  const pass = taskOf(project([r, a, ret(5, a, { semantic_review_outcome: 'PASS', unresolved_substantive_findings: 0 })]));
  assert.equal(pass.review.outcome, 'PASS');
  const odd = taskOf(project([r, a, ret(5, a, { semantic_review_outcome: 'LGTM' })]));
  assert.equal(odd.review.outcome, 'UNKNOWN');
});

test('no ACK: a RETURN is still RETURNED, with the missing ACK shown as a gap', () => {
  const r = request(1);
  const t = ret(5, null);
  const task = taskOf(project([r, t]));
  assert.equal(status(task, 'ACKNOWLEDGED'), 'NOT_OBSERVED');
  assert.equal(status(task, 'RETURNED'), 'OBSERVED');
  assert.deepEqual(task.delivery.gaps, ['ACKNOWLEDGED']);
});

test('nothing returned: the responder is pending, and an old ACK is not liveness', () => {
  const task = taskOf(project([request(1), ack(2)]));
  assert.equal(task.delivery.stage, 'ACKNOWLEDGED');
  assert.equal(task.delivery.pending.party, 'claude');
  assert.match(task.delivery.pending.reason, /UNKNOWN/);
  assert.equal(status(task, 'WORKING_LAST_OBSERVED'), 'NOT_OBSERVED');
});

test('progress is last-observed evidence with an age, never present liveness', () => {
  const progress = comment(10, envelope({ message_id: 'CC-PROG-1', message_type: 'PROGRESS', sender: 'claude', in_reply_to: 'CG-REQ-1', pr_number: 500, source_head: OTHER_HEAD }));
  const task = taskOf(project([request(1), ack(2), progress]));
  const w = task.stages.WORKING_LAST_OBSERVED;
  assert.equal(w.status, 'LAST_OBSERVED');
  assert.equal(w.liveness, 'UNKNOWN');
  assert.equal(w.age_seconds, 20 * 60);
  assert.equal(w.evidence[0].comment_id, progress.id);
});

test('clock skew: progress dated after the observation is age 0 and flagged', () => {
  const progress = comment(45, envelope({ message_id: 'CC-PROG-1', message_type: 'PROGRESS', sender: 'claude', in_reply_to: 'CG-REQ-1' }));
  const w = taskOf(project([request(1), progress])).stages.WORKING_LAST_OBSERVED;
  assert.equal(w.age_seconds, 0);
  assert.equal(w.clock_skew_suspected, true);
});

// --------------------------------------------- wrong reference / recipient

test('an ACK and RETURN from another sender are mismatched, not delivery', () => {
  const r = request(1);
  const a = ack(2, { sender: 'kimi' });
  const t = ret(5, null, { sender: 'kimi' });
  const task = taskOf(project([r, a, t]));
  assert.equal(status(task, 'ACKNOWLEDGED'), 'NOT_OBSERVED');
  assert.equal(status(task, 'RETURNED'), 'NOT_OBSERVED');
  assert.deepEqual(task.mismatched.map((m) => m.reason).sort(), ['WRONG_SENDER', 'WRONG_SENDER']);
  assert.equal(task.review.outcome, 'UNKNOWN');
});

test('a reply naming another request never attaches by packet or PR', () => {
  const r = request(1);
  const a = ack(2, { in_reply_to: 'CG-REQ-OTHER' });
  const t = ret(5, null, { in_reply_to: 'CG-REQ-OTHER' });
  const snap = project([r, a, t]);
  const task = taskOf(snap);
  assert.equal(task.delivery.stage, 'POSTED');
  assert.deepEqual(snap.unmatched.map((u) => u.reason), ['UNRESOLVED_REFERENCE', 'UNRESOLVED_REFERENCE']);
});

test('a reply with no reference at all stays unmatched, even with the same packet and PR', () => {
  const t = ret(5, null, { in_reply_to: undefined });
  const snap = project([request(1), t]);
  assert.equal(taskOf(snap).delivery.stage, 'POSTED');
  assert.equal(snap.unmatched[0].reason, 'NO_REFERENCE');
});

test('wrong PR is mismatched', () => {
  const task = taskOf(project([request(1), ack(2, { pr_number: 501 })]));
  assert.equal(status(task, 'ACKNOWLEDGED'), 'NOT_OBSERVED');
  assert.equal(task.mismatched[0].reason, 'WRONG_PR');
});

test('a RETURN for a changed semantic head is not a return of this request', () => {
  const r = request(1);
  const a = ack(2);
  const task = taskOf(project([r, a, ret(5, a, { reviewed_head: OTHER_HEAD })]));
  assert.equal(status(task, 'RETURNED'), 'NOT_OBSERVED');
  assert.equal(task.review.outcome, 'UNKNOWN');
  assert.equal(task.mismatched[0].reason, 'WRONG_REVISION');
  // Referent: the same RETURN at the requested head is accepted.
  assert.equal(status(taskOf(project([r, a, ret(5, a)])), 'RETURNED'), 'OBSERVED');
});

test('an implementation RETURN reports the head it produced without a false match', () => {
  const r = request(1, { message_type: 'DIRECTIVE' });
  const t = ret(5, null, { reviewed_head: undefined, source_head: OTHER_HEAD, semantic_review_outcome: undefined });
  const task = taskOf(project([r, t]));
  assert.equal(status(task, 'RETURNED'), 'OBSERVED');
  assert.equal(task.revision.status, 'PRODUCED_HEAD');
  assert.equal(task.revision.returned_head, OTHER_HEAD);
  assert.equal(task.confidence, 'MEDIUM');
});

test('a RETURN whose ack_ref names a different ACK is rejected', () => {
  const r = request(1);
  const a = ack(2);
  const stranger = comment(3, ['message_id: CC-ACK-9', 'message_type: ACK', 'sender: claude', 'in_reply_to: CG-OTHER']);
  const task = taskOf(project([r, a, stranger, ret(5, stranger)]));
  assert.equal(status(task, 'RETURNED'), 'NOT_OBSERVED');
  assert.equal(task.mismatched.find((m) => m.message_type === 'RETURN').reason, 'ACK_REF_MISMATCH');
});

test('a reply posted before the request is not a reply to it', () => {
  const a = ack(0);
  const task = taskOf(project([a, request(1)]));
  assert.equal(status(task, 'ACKNOWLEDGED'), 'NOT_OBSERVED');
  assert.equal(task.mismatched[0].reason, 'BEFORE_REQUEST');
});

test('historical sender spellings match the Claude role at MEDIUM confidence; others do not', () => {
  const r = request(1);
  const a = ack(2, { sender: 'claude-code' });
  const task = taskOf(project([r, a, ret(5, a, { sender: 'claude-worker' })]));
  assert.equal(status(task, 'ACKNOWLEDGED'), 'OBSERVED');
  assert.equal(status(task, 'RETURNED'), 'OBSERVED');
  assert.equal(task.sender_alias_used, true);
  assert.equal(task.confidence, 'MEDIUM');
  const near = taskOf(project([r, ack(2, { sender: 'Claude' })]));
  assert.equal(status(near, 'ACKNOWLEDGED'), 'NOT_OBSERVED');
});

// ------------------------------------------- consumption and decisions

test('return without a receipt is awaiting ChatGPT, and refreshing the viewer never consumes it', async () => {
  const r = request(1);
  const a = ack(2);
  const t = ret(5, a);
  const task = taskOf(project([r, a, t]));
  assert.equal(status(task, 'RETURN_CONSUMED'), 'NOT_OBSERVED');
  assert.equal(task.delivery.pending.party, 'chatgpt');
  assert.match(task.delivery.pending.reason, /awaiting chatgpt consumption of CC-RET-1/);

  let clock = Date.parse(at(10));
  const transport = createFixtureTransport({ comments: [r, a, t] });
  const monitor = createHandoffMonitor({ transport, now: () => clock, config: { minRefreshMs: 1 } });
  for (let i = 0; i < 3; i += 1) {
    clock += 1000;
    const { snapshot } = await monitor.read();
    assert.equal(status(taskOf(snapshot), 'RETURN_CONSUMED'), 'NOT_OBSERVED');
  }
  assert.equal(transport.requests.length > 3, true);
});

test('a receipt from the responder itself is context, not consumption', () => {
  const r = request(1);
  const a = ack(2);
  const t = ret(5, a);
  const self = receipt(7, t, { sender: 'claude', message_id: 'CC-NOTE-1' });
  const task = taskOf(project([r, a, t, self]));
  assert.equal(status(task, 'RETURN_CONSUMED'), 'NOT_OBSERVED');
  assert.equal(task.related.some((x) => x.comment_id === self.id), true);
});

test('a receipt whose two references disagree is rejected', () => {
  const r = request(1);
  const a = ack(2);
  const t = ret(5, a);
  const bad = receipt(7, t, { return_comment_id: t.id + 1 });
  const task = taskOf(project([r, a, t, bad]));
  assert.equal(status(task, 'RETURN_CONSUMED'), 'NOT_OBSERVED');
  assert.equal(task.mismatched.some((m) => m.reason === 'CONFLICTING_RETURN_REFERENCE'), true);
});

test('a receipt naming only return_comment_id is consumption', () => {
  const r = request(1);
  const a = ack(2);
  const t = ret(5, a);
  const byId = receipt(7, t, { in_reply_to: undefined });
  assert.equal(status(taskOf(project([r, a, t, byId])), 'RETURN_CONSUMED'), 'OBSERVED');
});

test('merge authority is read only from a valid PACKET_ADMISSION, never synthesized', () => {
  const r = request(1);
  const a = ack(2);
  const t = ret(5, a, { semantic_review_outcome: 'PASS', unresolved_substantive_findings: 0 });
  const progressClaim = receipt(7, t, { merge_authority: 'true', control_effect: 'PACKET_ADMISSION' });
  assert.equal(taskOf(project([r, a, t, progressClaim])).merge_authority.status, 'NOT_GRANTED');

  const admission = receipt(7, t, {
    message_type: 'REVIEW', message_id: 'CG-ADMIT-1', merge_authority: 'true', control_effect: 'PACKET_ADMISSION',
    source_main: MAIN, implementation_branch: 'impl/kf-x-1', state: 'READY_TO_MERGE', health: 'GREEN',
    scope_changed: 'false', production_touched: 'false',
  });
  const granted = taskOf(project([r, a, t, admission]));
  assert.equal(granted.merge_authority.status, 'GRANTED');
  assert.equal(granted.stages.DECISION_RECORDED.classification, 'AUTHORITY');
});

// ------------------------------- duplicates, ordering, edits, deletions

test('a duplicated request id attributes no reply to either comment', () => {
  const r1 = request(1);
  const r2 = request(3);
  const snap = project([r1, ack(2), r2, ret(5, null)]);
  for (const task of snap.tasks) {
    assert.equal(task.delivery.stage, 'POSTED');
    assert.match(task.problems.join(' '), /DUPLICATE_LOGICAL_ID/);
  }
});

test('a duplicated RETURN id is not a return', () => {
  const r = request(1);
  const a = ack(2);
  const task = taskOf(project([r, a, ret(5, a), ret(6, a)]));
  assert.equal(status(task, 'RETURNED'), 'NOT_OBSERVED');
  assert.equal(task.mismatched.filter((m) => m.reason === 'DUPLICATE_LOGICAL_ID').length, 2);
});

test('duplicate deliveries of one comment and out-of-order arrival give the same projection', () => {
  const { all } = chain();
  const strip = (s) => JSON.stringify({ ...s, counts: { ...s.counts, duplicate_deliveries: 0 } });
  const base = project(all);
  const shuffled = project([all[3], all[1], all[0], all[2]]);
  const doubled = project([...all, all[2], all[0]]);
  assert.equal(strip(shuffled), strip(base));
  assert.equal(strip(doubled), strip(base));
  assert.equal(doubled.counts.duplicate_deliveries, 2);
});

test('two deliveries of one id that disagree are treated as an edit', () => {
  const { r, a, t, c } = chain();
  const changed = { ...t, body: t.body.replace('CHANGES_REQUIRED', 'PASS'), updated_at: at(9) };
  const task = taskOf(project([r, a, t, changed, c]));
  assert.equal(status(task, 'RETURNED'), 'NOT_OBSERVED');
});

test('an edited RETURN is not evidence; an edited request makes the authority record unverifiable', () => {
  const { r, a, c } = chain();
  const editedReturn = ret(5, a, {}, { updated: at(20) });
  const task = taskOf(project([r, a, editedReturn, c]));
  assert.equal(status(task, 'RETURNED'), 'NOT_OBSERVED');
  assert.equal(project([r, a, editedReturn]).messages.find((m) => m.comment_id === editedReturn.id).edit_state, 'EDITED');

  const editedRequest = request(1, {}, { updated: at(20) });
  const snap = project([editedRequest, a]);
  assert.equal(snap.authority_record.verified, false);
  assert.equal(snap.authority_record.code, 'AUTHORITY_EDITED');
  assert.equal(taskOf(snap).request.authority_status, 'EDITED');
  assert.equal(status(taskOf(snap), 'ACKNOWLEDGED'), 'NOT_OBSERVED');
});

test('an amended autopilot status is a bot amendment, not edited authority', () => {
  const bot = comment(4, ['<!-- keyflow-autopilot-event:x -->', '```yaml', 'message_id: AUTO-EVENT-x', 'message_type: AUTO_EVENT', 'sender: github-autopilot', '```'],
    { author: 'github-actions[bot]', updated: at(9) });
  const snap = project([request(1), bot]);
  const m = snap.messages.find((x) => x.comment_id === bot.id);
  assert.equal(m.edit_state, 'AMENDED_BOT_STATUS');
  assert.equal(m.noise, true);
  assert.equal(m.authority.status, 'NOT_AUTHORITY');
  assert.equal(snap.authority_record.verified, true);
  assert.equal(viewOf(snap).feed.some((f) => f.comment_id === bot.id), false);
  assert.equal(viewOf(snap, { includeNoise: true }).feed.some((f) => f.comment_id === bot.id), true);
});

test('a malformed reply (repeated key) is not usable evidence', () => {
  const r = request(1);
  const bad = comment(2, [...envelope({ message_id: 'CC-ACK-1', message_type: 'ACK', sender: 'claude', in_reply_to: 'CG-REQ-1' }), 'Required: x', 'Required: y']);
  const snap = project([r, bad]);
  assert.equal(status(taskOf(snap), 'ACKNOWLEDGED'), 'NOT_OBSERVED');
  assert.equal(snap.unmatched[0].reason, 'NOT_USABLE_EVIDENCE');
});

test('a receipt naming a RETURN that is missing from the record stays unmatched', () => {
  const r = request(1);
  const orphan = comment(7, envelope({ message_id: 'CG-RECEIPT-9', message_type: 'PROGRESS', sender: 'chatgpt', in_reply_to: 'CC-RET-GONE', return_comment_id: 123 }));
  const snap = project([r, orphan]);
  assert.equal(snap.unmatched[0].reason, 'UNRESOLVED_REFERENCE');
});

// ------------------------------------------------------- safe rendering

test('source links are only this repository on github.com; credentials are redacted', () => {
  assert.equal(safeSourceUrl('https://github.com/SaCH-PRO/KEYFLOWOS/pull/177#issuecomment-6229516997'), 'https://github.com/SaCH-PRO/KEYFLOWOS/pull/177#issuecomment-6229516997');
  for (const bad of [
    'javascript:alert(1)',
    'https://github.com.evil.test/SaCH-PRO/KEYFLOWOS/pull/1',
    'https://github.com/other/repo/pull/1',
    'http://github.com/SaCH-PRO/KEYFLOWOS/pull/1',
    'https://github.com/SaCH-PRO/KEYFLOWOS/pull/1#x" onmouseover="alert(1)',
    'https://github.com/SaCH-PRO/KEYFLOWOS/pull/1/../../../evil',
  ]) assert.equal(safeSourceUrl(bad), null, bad);

  const token = `ghp_${'A1b2'.repeat(9)}`;
  const r = request(1);
  const a = ack(2);
  const t = ret(5, a, { findings_ref: 'javascript:alert(document.cookie)' });
  t.body += `\n<script>alert(1)</script><img src=x onerror=alert(2)> token ${token}`;
  const snap = project([r, a, t]);
  const m = snap.messages.find((x) => x.comment_id === t.id);
  assert.equal(m.refs.findings_ref.safe_url, null);
  assert.equal(taskOf(snap).review.findings_ref.safe_url, null);
  assert.equal(m.body.includes(token), false);
  assert.match(m.body, /\[REDACTED:github-token\]/);
  assert.equal(m.redactions, 1);
  // Text stays text: the projector never turns it into markup.
  assert.match(m.body, /<script>alert\(1\)<\/script>/);
  assert.equal(m.url, `https://github.com/SaCH-PRO/KEYFLOWOS/issues/80#issuecomment-${t.id}`);
  assert.equal(redactCredentials('Authorization: Bearer abcdefghijklmnopqrstuvwxyz').text.includes('abcdefghijklmnop'), false);
});

test('the view bounds the feed and returns one task chain with bodies', () => {
  const { r, all } = chain();
  const view = viewOf(project(all), { task: r.id, limit: 2 });
  assert.equal(view.feed.length, 2);
  assert.equal(view.feed[0].body, undefined);
  assert.equal(view.task.chain.length, 4);
  assert.equal(typeof view.task.chain[0].body, 'string');
  // The selected task uses the list's stage shape: one newest evidence object
  // per stage, with every piece of evidence kept beside it.
  assert.equal(view.task.stages.ACKNOWLEDGED.evidence.comment_id, view.tasks[0].stages.ACKNOWLEDGED.evidence.comment_id);
  assert.equal(Array.isArray(view.task.stages.ACKNOWLEDGED.evidence), false);
  assert.equal(view.task.stage_evidence.ACKNOWLEDGED.length, 1);
  assert.equal(view.task.stages.POSTED.evidence.comment_id, r.id);
  assert.deepEqual(Object.keys(view.tasks[0].stages), STAGES);
  assert.equal(viewOf(project(all), { task: 1 }).task.missing, true);
});

// ----------------------------------------------------------- collection

function dataset(n) {
  const comments = [];
  for (let i = 0; i < n; i += 1) {
    comments.push(comment(1, [`message_id: CC-NOTE-${i}`, 'message_type: PROGRESS', 'sender: claude'], { id: 1000 + i }));
  }
  return { comments };
}

test('collection paginates completely with GET only and allowlisted targets', async () => {
  const transport = createFixtureTransport(dataset(250));
  const monitor = createHandoffMonitor({ transport, now: () => Date.parse(at(10)) });
  const { snapshot, freshness } = await monitor.read();
  assert.equal(snapshot.counts.comments, 250);
  assert.equal(freshness.status, 'FRESH');
  assert.equal(freshness.coverage.status, 'COMPLETE');
  assert.equal(freshness.coverage.pages, 3);
  assert.equal(freshness.last_success_at, new Date(Date.parse(at(10))).toISOString());
  assert.ok(transport.requests.every((q) => q.method === 'GET'));
  for (const q of transport.requests) assert.doesNotThrow(() => allowedRequest(q.target));
});

test('a failed page with no prior snapshot is PARTIAL with no success time', async () => {
  const transport = createFixtureTransport(dataset(250), { fail: (t) => (/page=2/.test(t) ? { status: 502, headers: {} } : null) });
  const monitor = createHandoffMonitor({ transport, now: () => Date.parse(at(10)) });
  const { snapshot, freshness } = await monitor.read();
  assert.equal(snapshot.counts.comments, 100);
  assert.equal(freshness.status, 'PARTIAL');
  assert.equal(freshness.last_success_at, null);
  assert.equal(freshness.coverage.status, 'FAILED');
  assert.match(freshness.error, /HTTP_ERROR/);
});

test('a failure after success keeps the last good snapshot and its success time, then goes STALE', async () => {
  let clock = Date.parse(at(10));
  let broken = false;
  const transport = createFixtureTransport(dataset(5), { fail: () => (broken ? new CollectionError('TIMEOUT', 'slow') : null) });
  const monitor = createHandoffMonitor({ transport, now: () => clock, config: { minRefreshMs: 1000, staleAfterMs: 60_000, backoffBaseMs: 1000 } });
  const first = await monitor.read();
  const successAt = first.freshness.last_success_at;

  broken = true;
  clock += 5000;
  const degraded = await monitor.read();
  assert.equal(degraded.freshness.status, 'DEGRADED');
  assert.equal(degraded.freshness.last_success_at, successAt);
  assert.equal(degraded.freshness.last_attempt_at, new Date(clock).toISOString());
  assert.equal(degraded.freshness.last_attempt_outcome, 'FAILED');
  assert.equal(degraded.snapshot.counts.comments, 5);

  clock += 120_000;
  const stale = await monitor.read();
  assert.equal(stale.freshness.status, 'STALE');
  assert.equal(stale.freshness.last_success_at, successAt);
});

test('rate limiting backs off until the reset without calling GitHub again', async () => {
  let clock = Date.parse(at(10));
  const reset = Math.floor(clock / 1000) + 600;
  let limited = false;
  const transport = createFixtureTransport(dataset(3), {
    fail: () => (limited ? { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) } } : null),
  });
  const monitor = createHandoffMonitor({ transport, now: () => clock, config: { minRefreshMs: 1000, backoffBaseMs: 1000 } });
  await monitor.read();
  limited = true;
  clock += 2000;
  const hit = await monitor.read();
  assert.match(hit.freshness.error, /RATE_LIMITED/);
  assert.equal(hit.freshness.backoff_until, new Date(reset * 1000).toISOString());
  const calls = transport.requests.length;
  clock += 60_000;
  await monitor.read();
  assert.equal(transport.requests.length, calls);
});

test('a 304 confirms the fetch without changing event times or the generation', async () => {
  let clock = Date.parse(at(10));
  const transport = createFixtureTransport(dataset(3));
  const monitor = createHandoffMonitor({ transport, now: () => clock, config: { minRefreshMs: 1000, fullResyncMs: 0 } });
  const first = await monitor.read();
  clock += 5000;
  const second = await monitor.read();
  assert.equal(second.freshness.last_attempt_outcome, 'UNCHANGED');
  assert.equal(second.freshness.coverage.pages_not_modified, 1);
  assert.equal(second.freshness.generation, first.freshness.generation);
  assert.equal(second.freshness.last_success_at, new Date(clock).toISOString());
  assert.equal(second.freshness.confirmed_unchanged_at, new Date(clock).toISOString());
  assert.deepEqual(second.snapshot.messages.map((m) => m.created_at), first.snapshot.messages.map((m) => m.created_at));
});

test('concurrent reads share one refresh and reads inside the refresh window hit the cache', async () => {
  let clock = Date.parse(at(10));
  const transport = createFixtureTransport(dataset(3));
  const monitor = createHandoffMonitor({ transport, now: () => clock, config: { minRefreshMs: 30_000 } });
  await Promise.all([monitor.read(), monitor.read(), monitor.read()]);
  assert.equal(monitor.attempts, 1);
  clock += 10_000;
  await monitor.read();
  assert.equal(monitor.attempts, 1);
  clock += 30_000;
  await monitor.read();
  assert.equal(monitor.attempts, 2);
});

test('deletions and missed comments are found by count check and full resync', async () => {
  let clock = Date.parse(at(10));
  const data = dataset(4);
  const transport = createFixtureTransport(data);
  const monitor = createHandoffMonitor({ transport, now: () => clock, config: { minRefreshMs: 1000, fullResyncMs: 3_600_000 } });
  await monitor.read();
  transport.dataset.comments.splice(1, 1);
  clock += 5000;
  const after = await monitor.read();
  assert.equal(after.freshness.coverage.mode, 'FULL_AFTER_COUNT_MISMATCH');
  assert.equal(after.freshness.coverage.deletions_detected, 1);
  assert.equal(after.snapshot.counts.comments, 3);
  assert.equal(after.freshness.coverage.status, 'COMPLETE');
});

test('an incremental pass picks up edits; an older copy never overwrites a newer one', async () => {
  let clock = Date.parse(at(10));
  const data = dataset(2);
  const transport = createFixtureTransport(data);
  const monitor = createHandoffMonitor({ transport, now: () => clock, config: { minRefreshMs: 1000, fullResyncMs: 3_600_000 } });
  await monitor.read();
  const edited = { ...transport.dataset.comments[0], updated_at: at(9), body: `${transport.dataset.comments[0].body}\nedited` };
  transport.dataset.comments[0] = edited;
  clock += 5000;
  const after = await monitor.read();
  assert.equal(after.freshness.coverage.mode, 'INCREMENTAL');
  assert.equal(after.snapshot.messages.find((m) => m.comment_id === edited.id).edit_state, 'EDITED');

  // A lagging replica now serves the pre-edit copy in a full pass.
  transport.dataset.comments[0] = { ...edited, updated_at: at(1), body: edited.body.replace('\nedited', '') };
  monitor.config.fullResyncMs = 0;
  clock += 5000;
  const lagged = await monitor.read();
  assert.equal(lagged.snapshot.messages.find((m) => m.comment_id === edited.id).edit_state, 'EDITED');
});

test('more pages than the bound is never COMPLETE', async () => {
  const transport = createFixtureTransport(dataset(250));
  const monitor = createHandoffMonitor({ transport, now: () => Date.parse(at(10)), config: { maxPages: 2 } });
  const { freshness } = await monitor.read();
  assert.notEqual(freshness.coverage.status, 'COMPLETE');
  assert.match(freshness.error, /TRUNCATED/);
  assert.equal(freshness.last_success_at, null);
});

test('a restarted monitor starts empty and rebuilds from GitHub', async () => {
  const transport = createFixtureTransport(dataset(2));
  const monitor = createHandoffMonitor({ transport, now: () => Date.parse(at(10)) });
  const cold = await monitor.read({ refresh: false });
  assert.equal(cold.snapshot, null);
  assert.equal(cold.freshness.status, 'NOT_YET_COLLECTED');
  const warm = await monitor.read();
  assert.equal(warm.snapshot.counts.comments, 2);
});

test('the request allowlist admits only this repository, issue #80 and PR pages', () => {
  for (const ok of [
    '/repos/SaCH-PRO/KEYFLOWOS/issues/80',
    '/repos/SaCH-PRO/KEYFLOWOS/issues/80/comments?per_page=100&page=3',
    '/repos/SaCH-PRO/KEYFLOWOS/issues/80/comments?per_page=100&since=2026-10-17T00:00:00.000Z',
    'https://api.github.com/repos/SaCH-PRO/KEYFLOWOS/pulls/177',
  ]) assert.doesNotThrow(() => allowedRequest(ok), ok);
  for (const bad of [
    '/repos/SaCH-PRO/KEYFLOWOS/issues/81/comments',
    '/repos/other/repo/issues/80/comments',
    '/repos/SaCH-PRO/KEYFLOWOS/issues/80/comments?per_page=100&state=all',
    'https://evil.test/repos/SaCH-PRO/KEYFLOWOS/issues/80',
    'http://api.github.com/repos/SaCH-PRO/KEYFLOWOS/issues/80',
    'https://github.com/SaCH-PRO/KEYFLOWOS/pull/177#issuecomment-6229516997',
    '/repos/SaCH-PRO/KEYFLOWOS/issues/comments/6229516997',
    '/repos/SaCH-PRO/KEYFLOWOS/pulls/177/merge',
    'https://user:pw@api.github.com/repos/SaCH-PRO/KEYFLOWOS/issues/80',
  ]) assert.throws(() => allowedRequest(bad), (err) => err.code === 'REQUEST_NOT_ALLOWED', bad);
});

test('the live transport sends GET only, keeps the credential in the header and out of errors', async () => {
  const token = `ghp_${'Z9y8'.repeat(9)}`;
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (calls.length === 2) throw new Error(`socket closed for ${init.headers.Authorization}`);
    return { status: 200, headers: new Map([['etag', '"x"']]), json: async () => ({ comments: 0 }) };
  };
  fetchImpl.toString = () => 'fake';
  const transport = createGithubTransport({ token, fetchImpl: async (url, init) => {
    const res = await fetchImpl(url, init);
    return { ...res, headers: { get: (k) => res.headers.get(k) ?? null } };
  } });
  await transport.get('/repos/SaCH-PRO/KEYFLOWOS/issues/80');
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.redirect, 'error');
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${token}`);
  assert.equal(calls[0].url.includes(token), false);
  await assert.rejects(transport.get('/repos/SaCH-PRO/KEYFLOWOS/issues/80'), (err) => err.code === 'NETWORK' && !err.message.includes(token));
  await assert.rejects(transport.get('https://evil.test/x'), (err) => err.code === 'REQUEST_NOT_ALLOWED');
  assert.equal(calls.length, 2);
  assert.throws(() => createGithubTransport({ token: '' }), (err) => err.code === 'NOT_CONFIGURED');
});
