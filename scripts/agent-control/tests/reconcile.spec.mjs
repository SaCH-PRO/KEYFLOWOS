/**
 * Source precedence: repository truth > newest #80 authority > derived
 * programme-state. (CG-DIRECTIVE-META-STATE-RECONCILE-001)
 *
 * Every negative control below also shows the UNGATED rule table
 * (derivedDecision) taking the unsafe action for the same input, so each
 * assertion has a real referent rather than passing on any non-advancing shape.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { emptyState, loadState, validateState } from '../lib/state.mjs';
import { decide, derivedDecision, ACTIONS } from '../lib/orchestrator.mjs';
import { collectAuthority, reconcile, FINDINGS, AUTHORIZED_AUTHORS } from '../lib/reconcile.mjs';
import { fetchRepoTruth, reconcileWithTruth } from '../lib/truth.mjs';
import { evaluateAdmission, ADMISSION_REASONS } from '../lib/admission.mjs';
import { loadDag } from '../lib/dag.mjs';
import { parseYaml } from '../lib/yaml.mjs';
import { ROLES, AGENT_STATUS } from '../lib/adapters.mjs';

const SHA_MAIN = 'a'.repeat(40);
const SHA_SOURCE = 'b'.repeat(40);
const CHECKPOINTED_BEFORE = ['KF-EXEC-K12-001', 'KF-EXEC-EXTFX-001', 'KF-EXEC-TENANT-001', 'KF-EXEC-AUTH-001'];
const readyBuilder = {
  id: 'test-builder',
  vendor: 'test',
  roles: [ROLES.BUILDER],
  probeAuth: () => ({ status: AGENT_STATUS.READY, detail: 'ok' }),
  invoke: () => ({ status: 'COMPLETED', output: 'done' }),
};

let nextId = 1000;
function comment(fields, { author = 'SaCH-PRO', at, id } = {}) {
  const lines = Object.entries(fields).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}: ${v}`);
  nextId += 1;
  return {
    id: id ?? nextId,
    created_at: at ?? new Date(Date.UTC(2026, 8, 24, 0, 0, nextId - 1000)).toISOString(),
    user: { login: author },
    body: ['```yaml', ...lines, '```'].join('\n'),
  };
}
const chatgpt = (type, id, packet, opts) => comment({ message_id: id, message_type: type, packet_id: packet, sender: 'chatgpt' }, opts);

function anchoredState(programme, anchorComment, extra = {}) {
  const state = emptyState();
  Object.assign(state.programme, { source_main: SHA_SOURCE, ...programme });
  const msg = collectAuthority([anchorComment]).newest;
  state.authority_basis = { message_id: msg.message_id, comment_id: msg.comment_id };
  return Object.assign(state, extra);
}

function repo(pr = null, overrides = {}) {
  return { verified: true, main_sha: SHA_MAIN, source_main_on_main: true, pr, ...overrides };
}

const verdict = (state, comments, repoTruth) => reconcile(state, collectAuthority(comments), repoTruth);
const codes = (rec) => rec.findings.map((f) => f.code);

function run(state, rec, extra = {}) {
  return decide({ state, reconciliation: rec, dag: loadDag(process.cwd()), registry: [readyBuilder], ...extra });
}
function ungated(state, extra = {}) {
  return derivedDecision({ state, dag: loadDag(process.cwd()), registry: [readyBuilder], ...extra });
}

// ------------------------------------------------------------- AUTHORITY INPUT

test('only chatgpt-sent DIRECTIVE/REVIEW/HOLD/RESUME from an allowlisted author is authority, oldest first', () => {
  const comments = [
    chatgpt('REVIEW', 'CG-R-2', 'P', { at: '2026-09-24T02:00:00Z', id: 20 }),
    chatgpt('DIRECTIVE', 'CG-D-1', 'P', { at: '2026-09-24T01:00:00Z', id: 10 }),
    chatgpt('HOLD', 'CG-H-3', 'P', { at: '2026-09-24T03:00:00Z', id: 30 }),
    chatgpt('RESUME', 'CG-U-4', 'P', { at: '2026-09-24T04:00:00Z', id: 40 }),
    comment({ message_id: 'CC-R', message_type: 'REVIEW', sender: 'claude' }, { id: 50 }),
    comment({ message_id: 'X-1', message_type: 'DIRECTIVE' }, { id: 51 }), // senderless
    comment({ message_id: 'X-2', message_type: 'DIRECTIVE', sender: 'ChatGPT' }, { id: 52 }), // not exact
    chatgpt('DIRECTIVE', 'X-3', 'P', { author: 'someone-else', id: 53 }), // forged in a public repo
    comment({ message_id: 'AUTO-EVENT-x', message_type: 'AUTO_EVENT', sender: 'github-autopilot' }, { id: 54 }),
    comment({ message_id: 'CC-ACK', message_type: 'ACK', sender: 'claude' }, { id: 55 }),
  ];
  const auth = collectAuthority(comments);
  assert.equal(auth.verified, true);
  assert.deepEqual(auth.messages.map((m) => m.message_id), ['CG-D-1', 'CG-R-2', 'CG-H-3', 'CG-U-4']);
  assert.equal(auth.newest.message_id, 'CG-U-4');
  assert.equal(auth.rejected, 4, 'claude, senderless, wrong-case sender and forged author are rejected');
});

test('equal timestamps are ordered by comment id, deterministically', () => {
  const at = '2026-09-24T01:00:00Z';
  const auth = collectAuthority([chatgpt('REVIEW', 'B', 'P', { at, id: 9 }), chatgpt('REVIEW', 'A', 'P', { at, id: 3 })]);
  assert.deepEqual(auth.messages.map((m) => m.message_id), ['A', 'B']);
});

test('the authority allowlist matches the worker dispatch policy', () => {
  const policy = parseYaml(fs.readFileSync('docs/development/AGENT_AUTOPILOT_POLICY.yaml', 'utf8'));
  assert.deepEqual([...AUTHORIZED_AUTHORS], policy.worker.dispatch_authority.author_allowlist);
});

// ------------------------------------------------------------- NEGATIVE CONTROL 1
// Stale programme-state says READY_TO_MERGE while its PR is already merged
// (the exact shape main projected for PR #87 after #87 and #89 merged).

test('NC: stale READY_TO_MERGE for a merged PR reports drift -- no second merge, no next work', () => {
  const review = chatgpt('REVIEW', 'CG-REVIEW-META-AUTO-003', 'KF-META-AUTO-001');
  const state = anchoredState({
    active_packet: 'KF-META-AUTO-001',
    state: 'READY_TO_MERGE',
    implementation_branch: 'impl/kf-meta-auto-001-orchestrator',
    pr_number: 87,
    checkpointed: CHECKPOINTED_BEFORE,
  }, review);
  const merged = { number: 87, state: 'closed', merged: true, head_ref: 'impl/kf-meta-auto-001-orchestrator' };

  // Referent: without the gate the stale projection asks for admission again.
  assert.equal(ungated(state).action, ACTIONS.EVALUATE_ADMISSION);

  const rec = verdict(state, [review], repo(merged));
  assert.deepEqual(codes(rec), [FINDINGS.PR_ALREADY_MERGED]);
  const out = run(state, rec);
  assert.equal(out.action, ACTIONS.REPORT_DRIFT);
  assert.equal(out.advancement, 'NONE');
  assert.match(out.reason, /PR_ALREADY_MERGED/);

  // Even a merge event for that PR does not advance from the stale projection.
  const onMerge = run(state, rec, { event: { kind: 'PR_MERGED', pr_number: 87, merge_commit_sha: 'm' } });
  assert.equal(onMerge.action, ACTIONS.REPORT_DRIFT);

  // And the merge executor independently refuses a second merge of that PR.
  const admission = evaluateAdmission({ pr: { number: 87, state: 'closed', draft: false, head_ref: merged.head_ref } });
  assert.equal(admission.eligible, false);
  assert.equal(admission.reason, ADMISSION_REASONS.PR_NOT_OPEN);
});

// ------------------------------------------------------------- NEGATIVE CONTROL 2
// A newer #80 HOLD overrides an older derived allow/advance state.

for (const [label, hold] of [
  ['a typed HOLD', () => chatgpt('HOLD', 'CG-HOLD-X-001', 'KF-EXEC-ACTION-001')],
  // How holds have actually been posted on #80 so far: typed DIRECTIVE.
  ['a DIRECTIVE-typed hold (as CG-HOLD-ACTION-AUTO-001 was posted)', () => chatgpt('DIRECTIVE', 'CG-HOLD-ACTION-AUTO-002', 'KF-EXEC-ACTION-001')],
]) {
  test(`NC: ${label} newer than the projection stops a derived SELECT_NEXT_PACKET`, () => {
    const review = chatgpt('REVIEW', 'CG-REVIEW-OLD', 'KF-META-AUTO-001');
    const state = anchoredState({
      active_packet: 'KF-META-AUTO-001',
      state: 'CHECKPOINTED',
      pr_number: 89,
      implementation_branch: 'impl/x',
      checkpointed: CHECKPOINTED_BEFORE,
    }, review);
    const holdComment = hold();

    // Referent: the derived projection alone would propose ACTION-001.
    assert.equal(ungated(state).action, ACTIONS.SELECT_NEXT_PACKET);

    const rec = verdict(state, [review, holdComment], repo({ number: 89, state: 'closed', merged: true, head_ref: 'impl/x' }));
    assert.deepEqual(codes(rec), [FINDINGS.DERIVED_STATE_STALE_AUTHORITY]);
    assert.deepEqual(rec.findings[0].detail.newer.map((m) => m.message_id), [holdComment.body.match(/message_id: (\S+)/)[1]]);
    const out = run(state, rec);
    assert.equal(out.action, ACTIONS.REPORT_DRIFT);
    assert.equal(out.authority_newest.packet_id, 'KF-EXEC-ACTION-001');
  });
}

test('NC: a newer RESUME cannot release a derived hold -- release is never automatic', () => {
  const hold = chatgpt('DIRECTIVE', 'CG-HOLD-ACTION-AUTO-001', 'KF-EXEC-ACTION-001');
  const state = anchoredState({ active_packet: 'KF-META-AUTO-001', state: 'CHECKPOINTED', checkpointed: CHECKPOINTED_BEFORE }, hold, {
    hold: { active: true, packet_id: 'KF-EXEC-ACTION-001', reason: 'held' },
  });
  const resume = chatgpt('RESUME', 'CG-RESUME-ACTION-001', 'KF-EXEC-ACTION-001');
  const rec = verdict(state, [hold, resume], repo());
  assert.deepEqual(codes(rec), [FINDINGS.DERIVED_STATE_STALE_AUTHORITY]);
  const out = run(state, rec);
  assert.equal(out.action, ACTIONS.REPORT_DRIFT);
  assert.notEqual(out.action, ACTIONS.SELECT_NEXT_PACKET);
});

// ------------------------------------------------------------- NEGATIVE CONTROL 3
// Repository reality contradicts the projection: fail closed, report the drift.

const REPO_CONTRADICTIONS = [
  {
    name: 'MERGED projection, PR still open',
    programme: { state: 'MERGED', pr_number: 5, implementation_branch: 'impl/a' },
    pr: { number: 5, state: 'open', merged: false, head_ref: 'impl/a' },
    expect: [FINDINGS.PR_NOT_MERGED],
    ungatedAction: ACTIONS.CHECKPOINT,
  },
  {
    name: 'CHECKPOINTED projection, PR closed unmerged',
    programme: { state: 'CHECKPOINTED', pr_number: 5, implementation_branch: 'impl/a', checkpointed: CHECKPOINTED_BEFORE },
    pr: { number: 5, state: 'closed', merged: false, head_ref: 'impl/a' },
    expect: [FINDINGS.PR_NOT_MERGED],
    ungatedAction: ACTIONS.SELECT_NEXT_PACKET,
  },
  {
    name: 'IMPLEMENTING projection, PR closed unmerged',
    programme: { state: 'IMPLEMENTING', pr_number: 5, implementation_branch: 'impl/a' },
    pr: { number: 5, state: 'closed', merged: false, head_ref: 'impl/a' },
    expect: [FINDINGS.PR_CLOSED_UNMERGED],
    ungatedAction: ACTIONS.DISPATCH_BUILDER,
  },
  {
    name: 'READY_TO_MERGE projection naming the wrong branch',
    programme: { state: 'READY_TO_MERGE', pr_number: 5, implementation_branch: 'impl/a' },
    pr: { number: 5, state: 'open', merged: false, head_ref: 'impl/b' },
    expect: [FINDINGS.PR_BRANCH_MISMATCH],
    ungatedAction: ACTIONS.EVALUATE_ADMISSION,
  },
  {
    name: 'READY_TO_MERGE projection naming no PR',
    programme: { state: 'READY_TO_MERGE', pr_number: null },
    pr: null,
    expect: [FINDINGS.PR_REFERENCE_MISSING],
    ungatedAction: ACTIONS.EVALUATE_ADMISSION,
  },
  {
    name: 'source_main that is not on main',
    programme: { state: 'IMPLEMENTING' },
    pr: null,
    repoOverrides: { source_main_on_main: false },
    expect: [FINDINGS.SOURCE_MAIN_NOT_ON_MAIN],
    ungatedAction: ACTIONS.DISPATCH_BUILDER,
  },
];

for (const c of REPO_CONTRADICTIONS) {
  test(`NC: repository contradicts projection (${c.name}) -> REPORT_DRIFT with the finding`, () => {
    const anchor = chatgpt('REVIEW', 'CG-R', 'P');
    const state = anchoredState({ active_packet: 'P', ...c.programme }, anchor);
    assert.equal(ungated(state).action, c.ungatedAction, 'referent: the ungated table would act');
    const rec = verdict(state, [anchor], repo(c.pr, c.repoOverrides));
    assert.deepEqual(codes(rec), c.expect);
    const out = run(state, rec);
    assert.equal(out.action, ACTIONS.REPORT_DRIFT);
    assert.deepEqual(out.findings.map((f) => f.code), c.expect, 'drift is surfaced explicitly, not summarized away');
  });
}

// ------------------------------------------------------------- UNVERIFIABLE => CLOSED

test('anything that cannot be verified fails closed', () => {
  const anchor = chatgpt('REVIEW', 'CG-R', 'P');
  const base = () => anchoredState({ active_packet: 'P', state: 'IMPLEMENTING' }, anchor);

  const cases = [
    ['#80 unreadable', reconcile(base(), collectAuthority(null), repo()), FINDINGS.AUTHORITY_UNVERIFIABLE],
    ['repository unreadable', verdict(base(), [anchor], { verified: false, reason: 'offline' }), FINDINGS.REPO_TRUTH_UNVERIFIABLE],
    ['source_main ancestry unknown', verdict(base(), [anchor], repo(null, { source_main_on_main: null })), FINDINGS.REPO_TRUTH_UNVERIFIABLE],
    ['projection has no anchor', verdict(Object.assign(base(), { authority_basis: null }), [anchor], repo()), FINDINGS.DERIVED_STATE_UNANCHORED],
    ['anchor comment is not valid authority',
      verdict(Object.assign(base(), { authority_basis: { message_id: 'CC-RETURN-1', comment_id: 999999 } }), [anchor], repo()),
      FINDINGS.DERIVED_ANCHOR_NOT_FOUND],
    ['anchored comment id now carries another message id (edited)',
      verdict(Object.assign(base(), { authority_basis: { message_id: 'CG-OTHER', comment_id: anchor.id } }), [anchor], repo()),
      FINDINGS.DERIVED_ANCHOR_NOT_FOUND],
    ['PR named but not observed',
      verdict(anchoredState({ active_packet: 'P', state: 'IMPLEMENTING', pr_number: 7 }, anchor), [anchor], repo(null)),
      FINDINGS.REPO_TRUTH_UNVERIFIABLE],
  ];
  for (const [name, rec, code] of cases) {
    assert.ok(codes(rec).includes(code), `${name}: expected ${code}, got ${codes(rec).join(',')}`);
    assert.equal(run(base(), rec).action, ACTIONS.REPORT_DRIFT, name);
  }
});

test('decide() without a strictly consistent reconciliation never consults the projection', () => {
  const state = emptyState();
  state.programme.state = 'IMPLEMENTING';
  assert.equal(ungated(state).action, ACTIONS.DISPATCH_BUILDER);
  for (const rec of [undefined, null, {}, { consistent: 'true', findings: [] }, { consistent: false, findings: [] }]) {
    const out = decide({ state, reconciliation: rec, registry: [readyBuilder] });
    assert.equal(out.action, ACTIONS.REPORT_DRIFT, JSON.stringify(rec));
    assert.ok(out.findings.length > 0, 'a drift report always names a reason');
  }
  assert.equal(decide({ state, registry: [readyBuilder] }).findings[0].code, FINDINGS.RECONCILIATION_NOT_PERFORMED);
});

// ------------------------------------------------------------- POSITIVE CONTROL
// Consistent authority + repository truth + projection permits exactly the
// same legal advancement as before the gate existed.

const POSITIVE = [
  { state: 'CHARACTERIZING', pr: null, action: ACTIONS.DISPATCH_BUILDER },
  { state: 'IMPLEMENTING', pr: { state: 'open', merged: false }, action: ACTIONS.DISPATCH_BUILDER },
  { state: 'PROVING', pr: { state: 'open', merged: false }, action: ACTIONS.REQUEST_REVIEW },
  { state: 'FIXING_PROOF_FAILURES', pr: { state: 'open', merged: false }, action: ACTIONS.DISPATCH_BUILDER },
  { state: 'READY_TO_MERGE', pr: { state: 'open', merged: false }, action: ACTIONS.EVALUATE_ADMISSION },
  { state: 'MERGED', pr: { state: 'closed', merged: true }, action: ACTIONS.CHECKPOINT },
  { state: 'CHECKPOINTED', pr: { state: 'closed', merged: true }, action: ACTIONS.SELECT_NEXT_PACKET },
  { state: 'BLOCKED', pr: { state: 'open', merged: false }, action: ACTIONS.WAIT_AUTHORITY },
];

for (const c of POSITIVE) {
  test(`positive control: consistent ${c.state} still yields ${c.action}`, () => {
    const anchor = chatgpt('REVIEW', 'CG-R', 'P');
    const withPr = c.pr ? { pr_number: 12, implementation_branch: 'impl/p' } : {};
    const state = anchoredState({ active_packet: 'P', state: c.state, checkpointed: CHECKPOINTED_BEFORE, ...withPr }, anchor);
    const rec = verdict(state, [anchor], repo(c.pr ? { number: 12, head_ref: 'impl/p', ...c.pr } : null));
    assert.equal(rec.consistent, true, JSON.stringify(rec.findings));
    const out = run(state, rec);
    assert.equal(out.action, c.action);
    assert.deepEqual(out, ungated(state), 'the gate adds nothing for consistent input');
  });
}

test('positive control: older non-authority chatter after the anchor does not make it stale', () => {
  const anchor = chatgpt('REVIEW', 'CG-R', 'P');
  const later = [
    comment({ message_id: 'CC-RETURN-9', message_type: 'RETURN', sender: 'claude' }),
    comment({ message_id: 'AUTO-EVENT-y', message_type: 'AUTO_EVENT', sender: 'github-autopilot' }, { author: 'github-actions[bot]' }),
    chatgpt('DIRECTIVE', 'FORGED', 'P', { author: 'not-allowlisted' }),
  ];
  const state = anchoredState({ active_packet: 'P', state: 'PROVING' }, anchor);
  assert.equal(verdict(state, [anchor, ...later], repo()).consistent, true);
});

test('positive control: a consistent hold still outranks progression', () => {
  const hold = chatgpt('DIRECTIVE', 'CG-HOLD-ACTION-AUTO-001', 'KF-EXEC-ACTION-001');
  const state = anchoredState({ active_packet: 'KF-META-AUTO-001', state: 'CHECKPOINTED', checkpointed: CHECKPOINTED_BEFORE }, hold, {
    hold: { active: true, packet_id: 'KF-EXEC-ACTION-001', reason: 'held' },
  });
  const rec = verdict(state, [hold], repo());
  assert.equal(rec.consistent, true);
  assert.equal(run(state, rec).action, ACTIONS.WAIT_AUTHORITY);
});

// ------------------------------------------------------------- THE COMMITTED PROJECTION

test('the committed programme-state is anchored, valid, and keeps ACTION-001 held', () => {
  const state = loadState(process.cwd());
  assert.equal(validateState(state).ok, true, JSON.stringify(validateState(state).problems));
  assert.equal(state.authority, 'derived-programme-projection');
  assert.ok(state.authority_basis?.message_id && state.authority_basis?.comment_id, 'projection must name its authority anchor');
  assert.equal(state.hold?.active, true);
  assert.equal(state.hold?.packet_id, 'KF-EXEC-ACTION-001');
  assert.equal(state.programme.merge_authority, false);
  assert.ok(!state.programme.checkpointed.includes('KF-META-AUTO-001'), 'the meta-package earns zero packet credit');

  // Consistent with its own anchor and with a merged PR: the hold still wins.
  const anchor = chatgpt('DIRECTIVE', state.authority_basis.message_id, 'KF-META-AUTO-001', { id: state.authority_basis.comment_id });
  const pr = state.programme.pr_number
    ? { number: state.programme.pr_number, state: 'closed', merged: true, head_ref: state.programme.implementation_branch }
    : null;
  const rec = verdict(state, [anchor], repo(pr));
  assert.equal(rec.consistent, true, JSON.stringify(rec.findings));
  assert.equal(run(state, rec).action, ACTIONS.WAIT_AUTHORITY);
});

// ------------------------------------------------------------- SNAPSHOT GATHERING

test('repository truth: 404 on ancestry means not on main; other errors are unverifiable', () => {
  const programme = { source_main: SHA_SOURCE, pr_number: 3 };
  const ok = (answers) => (args) => {
    const key = args[args.length - 1];
    for (const [pattern, value] of answers) {
      if (key.includes(pattern)) {
        if (value instanceof Error) throw value;
        return JSON.stringify(value);
      }
    }
    throw new Error(`unexpected gh call ${key}`);
  };
  const err = (msg) => Object.assign(new Error(msg), { stderr: msg });

  const good = fetchRepoTruth('o/r', programme, ok([
    ['commits/main', { sha: SHA_MAIN }],
    ['/compare/', { status: 'ahead' }],
    ['pulls/3', { number: 3, state: 'closed', merged: true, head: { ref: 'impl/z' } }],
  ]));
  assert.deepEqual(good, { verified: true, main_sha: SHA_MAIN, source_main_on_main: true, pr: { number: 3, state: 'closed', merged: true, head_ref: 'impl/z' } });

  const diverged = fetchRepoTruth('o/r', programme, ok([['commits/main', { sha: SHA_MAIN }], ['/compare/', { status: 'diverged' }], ['pulls/3', { number: 3, state: 'open', merged: false, head: { ref: 'x' } }]]));
  assert.equal(diverged.source_main_on_main, false);

  const unknownSha = fetchRepoTruth('o/r', programme, ok([['commits/main', { sha: SHA_MAIN }], ['/compare/', err('gh: Not Found (HTTP 404)')], ['pulls/3', { number: 3, state: 'open', merged: false, head: { ref: 'x' } }]]));
  assert.equal(unknownSha.source_main_on_main, false);

  const flaky = fetchRepoTruth('o/r', programme, ok([['commits/main', { sha: SHA_MAIN }], ['/compare/', err('gh: Server Error (HTTP 502)')]]));
  assert.equal(flaky.verified, false);

  const noPr = fetchRepoTruth('o/r', programme, ok([['commits/main', { sha: SHA_MAIN }], ['/compare/', { status: 'identical' }], ['pulls/3', err('HTTP 404')]]));
  assert.equal(noPr.verified, false, 'a named PR that cannot be read is unverifiable, not absent');
});

test('an unreadable control issue is AUTHORITY_UNVERIFIABLE, never "no newer authority"', () => {
  const state = loadState(process.cwd());
  const rec = reconcileWithTruth(state, { repository: 'o/r', run: () => { throw Object.assign(new Error('x'), { stderr: 'gh: not logged in' }); } });
  assert.ok(codes(rec).includes(FINDINGS.AUTHORITY_UNVERIFIABLE));
  assert.ok(codes(rec).includes(FINDINGS.REPO_TRUTH_UNVERIFIABLE));
  assert.equal(rec.consistent, false);
});

// ------------------------------------------------------------- WIRING

test('the orchestrator CLI reconciles before deciding and never calls the ungated table', () => {
  const src = fs.readFileSync('scripts/agent-control/orchestrate.mjs', 'utf8');
  assert.match(src, /reconcileWithTruth\(state/);
  assert.match(src, /decide\(\{ state, reconciliation,/);
  assert.ok(!/derivedDecision/.test(src), 'orchestrate.mjs must not bypass the reconciliation gate');
});

function cli(snapshot) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-truth-'));
  try {
    const file = path.join(dir, 'truth.json');
    fs.writeFileSync(file, JSON.stringify(snapshot));
    const env = { ...process.env };
    delete env.GITHUB_EVENT_NAME;
    delete env.GITHUB_EVENT_PATH;
    const res = spawnSync(process.execPath, ['scripts/agent-control/orchestrate.mjs', '--json', '--truth-file', file], { encoding: 'utf8', env });
    assert.equal(res.status, 0, res.stderr);
    return JSON.parse(res.stdout);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('CLI end to end: a newer #80 message makes the committed projection report drift', () => {
  const state = loadState(process.cwd());
  const anchor = chatgpt('DIRECTIVE', state.authority_basis.message_id, 'KF-META-AUTO-001', { id: state.authority_basis.comment_id, at: '2026-09-25T02:00:11Z' });
  const newer = chatgpt('REVIEW', 'CG-REVIEW-LATER', 'KF-META-AUTO-001', { id: Number(state.authority_basis.comment_id) + 1, at: '2026-09-25T09:00:00Z' });
  const pr = state.programme.pr_number
    ? { number: state.programme.pr_number, state: 'closed', merged: true, head_ref: state.programme.implementation_branch }
    : null;

  const consistent = cli({ comments: [anchor], repo: repo(pr) });
  assert.equal(consistent.reconciliation.consistent, true, JSON.stringify(consistent.reconciliation.findings));
  assert.equal(consistent.decision.action, ACTIONS.WAIT_AUTHORITY, 'ACTION-001 stays held');

  const stale = cli({ comments: [anchor, newer], repo: repo(pr) });
  assert.equal(stale.decision.action, ACTIONS.REPORT_DRIFT);
  assert.deepEqual(stale.reconciliation.findings.map((f) => f.code), [FINDINGS.DERIVED_STATE_STALE_AUTHORITY]);

  const blind = cli({ comments: null, repo: { verified: false, reason: 'no token' } });
  assert.equal(blind.decision.action, ACTIONS.REPORT_DRIFT);
});
