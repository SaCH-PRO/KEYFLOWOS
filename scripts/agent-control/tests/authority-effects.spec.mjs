/**
 * The derived projection as a deterministic fold of typed #80 authority over a
 * reviewed checkpoint. (KF-META-STATE-REDUCER-LIVE-001)
 *
 * Every negative control asserts the exact finding and the exact message the
 * fold stopped at, and pairs it with a referent: the same input with the
 * defect removed advances, so no assertion passes on any non-advancing shape.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { activeHolds, emptyState, loadState, validateState } from '../lib/state.mjs';
import { decide, ACTIONS } from '../lib/orchestrator.mjs';
import { collectAuthority, reconcile, reconcileProjection, FINDINGS } from '../lib/reconcile.mjs';
import { reduceAuthority, readEffect, applyEffect, CONTROL_EFFECTS, EFFECT_PROBLEMS, FOLD_NOT_STARTED } from '../lib/authority-effects.mjs';
import { parseEnvelope } from '../lib/control-envelope.mjs';
import { applicationPacketsOf, reconcileWithTruth } from '../lib/truth.mjs';
import { loadDag } from '../lib/dag.mjs';
import { ROLES, AGENT_STATUS } from '../lib/adapters.mjs';

const SHA_MAIN = 'a'.repeat(40);
const SHA_SOURCE = 'b'.repeat(40);
const CHECKPOINTED_BEFORE = ['KF-EXEC-K12-001', 'KF-EXEC-EXTFX-001', 'KF-EXEC-TENANT-001', 'KF-EXEC-AUTH-001'];
const DAG = loadDag(process.cwd());
const APP = applicationPacketsOf(DAG);
const OPTIONS = { applicationPackets: APP };
const readyBuilder = {
  id: 'test-builder',
  vendor: 'test',
  roles: [ROLES.BUILDER],
  probeAuth: () => ({ status: AGENT_STATUS.READY, detail: 'ok' }),
  invoke: () => ({ status: 'COMPLETED', output: 'done' }),
};

let nextId = 5000;
function comment(fields, { author = 'SaCH-PRO', at, id, edited = false } = {}) {
  const lines = Object.entries(fields).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}: ${v}`);
  nextId += 1;
  const created = at ?? new Date(Date.UTC(2026, 9, 3, 1, 0, nextId - 5000)).toISOString();
  return {
    id: id ?? nextId,
    created_at: created,
    updated_at: edited ? new Date(Date.parse(created) + 60000).toISOString() : created,
    user: { login: author },
    body: ['```yaml', ...lines, '```'].join('\n'),
  };
}

/** A full #80 authority envelope in live vocabulary, optionally typed. */
const authority = (type, id, packet, extra = {}, opts = {}) => comment({
  message_id: id,
  message_type: type,
  packet_id: packet,
  sender: 'chatgpt',
  source_main: SHA_SOURCE,
  implementation_branch: extra.implementation_branch ?? `impl/${packet.toLowerCase()}`,
  state: 'REVIEWED',
  health: 'GREEN',
  scope_changed: 'false',
  production_touched: 'false',
  ...extra,
}, opts);

const typed = (type, id, packet, effect, extra = {}, opts = {}) => authority(type, id, packet, { control_effect: effect, ...extra }, opts);

/** A checkpoint anchored to `anchor`, with the meta packet P released and no PR. */
function checkpoint(anchor, programme = {}, extra = {}) {
  const state = emptyState();
  Object.assign(state.programme, {
    checkpointed: [...CHECKPOINTED_BEFORE],
    active_packet: 'KF-META-P',
    state: 'CHARACTERIZING',
    health: 'GREEN',
    source_main: SHA_SOURCE,
    implementation_branch: 'impl/kf-meta-p',
    pr_number: null,
    ...programme,
  });
  const msg = collectAuthority([anchor]).newest;
  state.authority_basis = { message_id: msg.message_id, comment_id: msg.comment_id };
  return Object.assign(state, extra);
}

const repo = (pr = null, overrides = {}) => ({ verified: true, main_sha: SHA_MAIN, source_main_on_main: true, pr, ...overrides });
const openPr = (number, ref) => ({ number, state: 'open', merged: false, head_ref: ref });
const mergedPr = (number, ref) => ({ number, state: 'closed', merged: true, head_ref: ref });
const fold = (state, comments) => reduceAuthority(state, collectAuthority(comments), OPTIONS);
const project = (state, comments, repoFor) => reconcileProjection(state, collectAuthority(comments), repoFor, OPTIONS);
const codes = (rec) => rec.findings.map((f) => f.code);
const act = (rec) => decide({ state: rec.effective_state, reconciliation: rec, dag: DAG, registry: [readyBuilder] });

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

// One packet's ordinary lifecycle, typed: correction, admission, checkpoint.
function lifecycle() {
  const anchor = authority('DIRECTIVE', 'CG-DIRECTIVE-P', 'KF-META-P');
  const base = checkpoint(anchor);
  const correction = typed('REVIEW', 'CG-REVIEW-P-CORRECTION', 'KF-META-P', 'PACKET_CORRECTION', { pr_number: 41, health: 'YELLOW' });
  const admission = typed('REVIEW', 'CG-REVIEW-P-ADMIT', 'KF-META-P', 'PACKET_ADMISSION', { pr_number: 41, merge_authority: 'true' });
  const close = typed('REVIEW', 'CG-REVIEW-P-CHECKPOINT', 'KF-META-P', 'CHECKPOINT', { pr_number: 41 });
  return { anchor, base, correction, admission, close, comments: [anchor, correction, admission, close] };
}

// ------------------------------------------------------------------ the vocabulary

test('the effect vocabulary is explicit, closed, and carries no programme activation', () => {
  assert.deepEqual([...CONTROL_EFFECTS], [
    'NO_STATE_CHANGE', 'PACKET_RELEASE', 'PACKET_CORRECTION', 'PACKET_ADMISSION', 'CHECKPOINT', 'HOLD_SET', 'HOLD_CLEAR',
  ]);
  assert.ok(!CONTROL_EFFECTS.some((e) => /ACTIVAT|PROGRAMME/.test(e)), 'activation is never a fold');
});

// ------------------------------------------------------------------ determinism, replay, idempotency

test('deterministic: the same checkpoint and authority always fold to the same projection', () => {
  const { base, comments } = lifecycle();
  const a = fold(base, comments);
  const b = fold(base, comments);
  assert.deepEqual(a, b);
  // Order of observation does not matter: authority is ordered by time, then comment id.
  const shuffled = fold(base, [comments[2], comments[0], comments[3], comments[1]]);
  assert.deepEqual(shuffled, a);
  assert.equal(a.state.programme.state, 'CHECKPOINTED');
});

test('the fold is pure: the checkpoint and the authority snapshot are never modified', () => {
  const { base, comments } = lifecycle();
  const before = structuredClone(base);
  const auth = collectAuthority(comments);
  deepFreeze(base);
  deepFreeze(auth);
  const out = reduceAuthority(base, auth, OPTIONS);
  assert.deepEqual(base, before);
  assert.notEqual(out.state, base);
});

test('replay is idempotent: folding the effective projection again applies nothing and changes nothing', () => {
  const { base, comments } = lifecycle();
  const once = fold(base, comments);
  // Referent: the first fold really applied the whole lifecycle, so "nothing applied" below is not vacuous.
  assert.equal(once.blocked, null);
  assert.deepEqual(once.applied.map((a) => a.effect), ['PACKET_CORRECTION', 'PACKET_ADMISSION', 'CHECKPOINT']);
  const twice = fold(once.state, comments);
  assert.equal(twice.blocked, null);
  assert.equal(twice.applied.length, 0);
  assert.deepEqual(twice.state, once.state);
  assert.equal(twice.observed_generation, once.observed_generation);
});

test('replay is incremental: folding a prefix and then the rest equals folding once', () => {
  const { base, comments } = lifecycle();
  const whole = fold(base, comments);
  for (let cut = 1; cut < comments.length; cut += 1) {
    const prefix = fold(base, comments.slice(0, cut));
    const rest = fold(prefix.state, comments);
    assert.deepEqual(rest.state, whole.state, `cut at ${cut}`);
  }
});

test('generation: each message has its 1-based authority position; observed generation tracks the fold', () => {
  const { base, comments } = lifecycle();
  const out = fold(base, comments);
  assert.equal(out.generation, 4);
  assert.equal(out.checkpoint_generation, 1);
  assert.equal(out.observed_generation, 4);
  assert.deepEqual(out.applied.map((a) => [a.generation, a.effect]), [[2, 'PACKET_CORRECTION'], [3, 'PACKET_ADMISSION'], [4, 'CHECKPOINT']]);
  assert.deepEqual(out.state.authority_basis, { message_id: 'CG-REVIEW-P-CHECKPOINT', comment_id: comments[3].id });
});

test('packet effects project state from the effect, never from the free-vocabulary state field', () => {
  const { base, anchor, correction, admission } = lifecycle();
  const c = fold(base, [anchor, correction]).state.programme;
  assert.equal(c.state, 'FIXING_PROOF_FAILURES');
  assert.equal(c.health, 'YELLOW', 'canonical health is projected as authority wrote it');
  assert.equal(c.pr_number, 41);
  assert.equal(c.merge_authority, false);
  const ad = fold(base, [anchor, correction, admission]);
  assert.equal(ad.state.programme.state, 'READY_TO_MERGE');
  assert.equal(ad.state.programme.merge_authority, true);
  assert.deepEqual(ad.state.merge_authority_marker, { message_id: 'CG-REVIEW-P-ADMIT', comment_id: admission.id });
  assert.equal(validateState(ad.state).ok, true, JSON.stringify(validateState(ad.state).problems));
});

test('CHECKPOINT credits only programme DAG packets, once; meta packets stay at zero credit', () => {
  const { base, comments } = lifecycle();
  const meta = fold(base, comments).state.programme;
  assert.equal(meta.state, 'CHECKPOINTED');
  assert.deepEqual(meta.checkpointed, CHECKPOINTED_BEFORE, 'a meta packet earns no credit');
  assert.equal(meta.merge_authority, false, 'a checkpoint clears merge authority');

  const anchor = authority('DIRECTIVE', 'CG-D', 'KF-META-P');
  const app = checkpoint(anchor, { active_packet: 'KF-EXEC-ACTION-001', state: 'READY_TO_MERGE', pr_number: 7, implementation_branch: 'impl/kf-exec-action-001' });
  assert.ok(APP.has('KF-EXEC-ACTION-001'), 'referent: ACTION-001 is a DAG packet');
  const once = typed('REVIEW', 'CG-C1', 'KF-EXEC-ACTION-001', 'CHECKPOINT', { pr_number: 7 });
  const again = typed('REVIEW', 'CG-C2', 'KF-EXEC-ACTION-001', 'CHECKPOINT', { pr_number: 7 });
  const out = fold(app, [anchor, once, again]).state.programme;
  assert.deepEqual(out.checkpointed, [...CHECKPOINTED_BEFORE, 'KF-EXEC-ACTION-001']);
});

// ------------------------------------------------------------------ fail closed: untyped, malformed, edited, ambiguous

test('NC untyped authority: a newer message without control_effect stops the fold and the projection reports stale', () => {
  const anchor = authority('DIRECTIVE', 'CG-D', 'KF-META-P');
  const base = checkpoint(anchor);
  const untyped = authority('REVIEW', 'CG-REVIEW-UNTYPED', 'KF-META-P', { pr_number: 41 });
  const laterTyped = typed('REVIEW', 'CG-REVIEW-TYPED', 'KF-META-P', 'PACKET_CORRECTION', { pr_number: 41 });

  const rec = project(base, [anchor, untyped, laterTyped], repo(openPr(41, 'impl/kf-meta-p')));
  assert.deepEqual(codes(rec), [FINDINGS.DERIVED_STATE_STALE_AUTHORITY]);
  const detail = rec.findings[0].detail;
  assert.equal(detail.blocked.message_id, 'CG-REVIEW-UNTYPED');
  assert.equal(detail.blocked.code, EFFECT_PROBLEMS.EFFECT_MISSING);
  assert.deepEqual(detail.newer.map((m) => m.message_id), ['CG-REVIEW-UNTYPED', 'CG-REVIEW-TYPED'], 'a typed message after the stop is not applied');
  assert.equal(rec.effective_state.programme.state, 'CHARACTERIZING');
  assert.equal(act(rec).action, ACTIONS.REPORT_DRIFT);

  // Referent: typing the same message lets both fold and the projection advance.
  const fixed = typed('REVIEW', 'CG-REVIEW-UNTYPED', 'KF-META-P', 'PACKET_CORRECTION', { pr_number: 41 }, { id: untyped.id, at: untyped.created_at });
  const ok = project(base, [anchor, fixed, laterTyped], repo(openPr(41, 'impl/kf-meta-p')));
  assert.equal(ok.consistent, true, JSON.stringify(ok.findings));
  assert.equal(act(ok).action, ACTIONS.DISPATCH_BUILDER);
});

const UNFOLDABLE = [
  ['unknown effect', (p) => typed('REVIEW', 'CG-X', p, 'DO_MAGIC', { pr_number: 41 }), EFFECT_PROBLEMS.EFFECT_UNKNOWN],
  ['lower-case effect', (p) => typed('REVIEW', 'CG-X', p, 'packet_correction', { pr_number: 41 }), EFFECT_PROBLEMS.EFFECT_UNKNOWN],
  ['blank effect', (p) => typed('REVIEW', 'CG-X', p, '""', { pr_number: 41 }), EFFECT_PROBLEMS.EFFECT_MISSING],
  ['block-scalar effect', (p) => typed('REVIEW', 'CG-X', p, '>', { pr_number: 41 }), EFFECT_PROBLEMS.EFFECT_MISSING],
  ['HOLD_CLEAR on a REVIEW', (p) => typed('REVIEW', 'CG-X', p, 'HOLD_CLEAR'), EFFECT_PROBLEMS.EFFECT_TYPE_MISMATCH],
  ['HOLD_SET on a DIRECTIVE', (p) => typed('DIRECTIVE', 'CG-X', p, 'HOLD_SET'), EFFECT_PROBLEMS.EFFECT_TYPE_MISMATCH],
  ['a HOLD that releases a packet', (p) => typed('HOLD', 'CG-X', p, 'PACKET_RELEASE'), EFFECT_PROBLEMS.EFFECT_TYPE_MISMATCH],
  ['a RESUME that admits', (p) => typed('RESUME', 'CG-X', p, 'PACKET_ADMISSION', { pr_number: 41 }), EFFECT_PROBLEMS.EFFECT_TYPE_MISMATCH],
  ['programme activation alongside an effect', (p) => typed('DIRECTIVE', 'CG-X', p, 'NO_STATE_CHANGE', { programme: 'KEYFLOWOS_PLATFORM_CONVERGENCE', programme_action: 'ACTIVATE' }), EFFECT_PROBLEMS.PROGRAMME_NOT_FOLDABLE],
  ['admission without pr_number', (p) => typed('REVIEW', 'CG-X', p, 'PACKET_ADMISSION'), EFFECT_PROBLEMS.FIELD_MISSING],
  ['checkpoint without pr_number', (p) => typed('REVIEW', 'CG-X', p, 'CHECKPOINT'), EFFECT_PROBLEMS.FIELD_MISSING],
  ['admission with a non-numeric pr_number', (p) => typed('REVIEW', 'CG-X', p, 'PACKET_ADMISSION', { pr_number: '#41' }), EFFECT_PROBLEMS.FIELD_MISSING],
  ['correction with a non-numeric pr_number', (p) => typed('REVIEW', 'CG-X', p, 'PACKET_CORRECTION', { pr_number: 'none' }), EFFECT_PROBLEMS.FIELD_MISSING],
  ['correction with a short source_main', (p) => typed('REVIEW', 'CG-X', p, 'PACKET_CORRECTION', { pr_number: 41, source_main: 'abc123' }), EFFECT_PROBLEMS.FIELD_MISSING],
  ['admission with merge_authority yes', (p) => typed('REVIEW', 'CG-X', p, 'PACKET_ADMISSION', { pr_number: 41, merge_authority: 'yes' }), EFFECT_PROBLEMS.FIELD_MISSING],
  ['correction for a packet that is not active', () => typed('REVIEW', 'CG-X', 'KF-META-OTHER', 'PACKET_CORRECTION', { pr_number: 41 }), EFFECT_PROBLEMS.PACKET_NOT_ACTIVE],
  ['a release while a packet is in flight', () => typed('DIRECTIVE', 'CG-X', 'KF-META-OTHER', 'PACKET_RELEASE'), EFFECT_PROBLEMS.PACKET_IN_FLIGHT],
];

for (const [name, make, code] of UNFOLDABLE) {
  test(`NC unfoldable authority (${name}) stops the fold with ${code}`, () => {
    const anchor = authority('DIRECTIVE', 'CG-D', 'KF-META-P');
    const base = checkpoint(anchor);
    const bad = make('KF-META-P');
    const rec = project(base, [anchor, bad], repo());
    assert.equal(rec.consistent, false);
    assert.deepEqual(codes(rec), [FINDINGS.DERIVED_STATE_STALE_AUTHORITY]);
    assert.equal(rec.reduction.blocked.code, code);
    assert.equal(rec.reduction.blocked.message_id, 'CG-X');
    assert.deepEqual(rec.effective_state, base, 'nothing was applied');
    assert.equal(act(rec).action, ACTIONS.REPORT_DRIFT);
  });
}

test('NC malformed authority after the anchor stops the fold and is reported, never skipped', () => {
  const anchor = authority('DIRECTIVE', 'CG-D', 'KF-META-P');
  const base = checkpoint(anchor);
  // A repeated control_effect is ambiguous, so the envelope is malformed.
  const repeated = comment({
    message_id: 'CG-REVIEW-REPEATED', message_type: 'REVIEW', packet_id: 'KF-META-P', sender: 'chatgpt',
    source_main: SHA_SOURCE, implementation_branch: 'impl/kf-meta-p', state: 'REVIEWED', health: 'GREEN',
    scope_changed: 'false', production_touched: 'false', pr_number: 41, control_effect: 'PACKET_CORRECTION',
  });
  repeated.body = repeated.body.replace(/```$/, 'control_effect: CHECKPOINT\n```');
  const laterTyped = typed('REVIEW', 'CG-REVIEW-TYPED', 'KF-META-P', 'PACKET_CORRECTION', { pr_number: 41 });
  const auth = collectAuthority([anchor, repeated, laterTyped]);
  assert.equal(auth.malformed.length, 1, 'referent: the repeated key really is malformed');

  const rec = reconcileProjection(base, auth, repo(openPr(41, 'impl/kf-meta-p')), OPTIONS);
  assert.equal(rec.reduction.blocked.code, EFFECT_PROBLEMS.AUTHORITY_MALFORMED);
  assert.equal(rec.reduction.applied.length, 0, 'the typed message after it is not applied');
  assert.deepEqual(codes(rec).sort(), [FINDINGS.AUTHORITY_MALFORMED, FINDINGS.DERIVED_STATE_STALE_AUTHORITY].sort());
  assert.equal(act(rec).action, ACTIONS.REPORT_DRIFT);
});

test('NC edited or unorderable authority never reaches the fold', () => {
  const anchor = authority('DIRECTIVE', 'CG-D', 'KF-META-P');
  const base = checkpoint(anchor);
  const effect = typed('REVIEW', 'CG-R', 'KF-META-P', 'PACKET_CORRECTION', { pr_number: 41 });

  const edited = typed('REVIEW', 'CG-R', 'KF-META-P', 'PACKET_CORRECTION', { pr_number: 41 }, { id: effect.id, at: effect.created_at, edited: true });
  const twin = { ...typed('REVIEW', 'CG-R2', 'KF-META-P', 'PACKET_CORRECTION', { pr_number: 41 }), id: effect.id };
  const cases = [
    ['edited', [anchor, edited], FINDINGS.AUTHORITY_EDITED],
    ['two comments share an id', [anchor, effect, twin], FINDINGS.AUTHORITY_ORDER_AMBIGUOUS],
    ['unparseable timestamp', [anchor, { ...effect, created_at: 'soon', updated_at: 'soon' }], FINDINGS.AUTHORITY_ORDER_AMBIGUOUS],
    ['edit state unknown', [anchor, { ...effect, updated_at: undefined }], FINDINGS.AUTHORITY_UNVERIFIABLE],
  ];
  for (const [name, comments, code] of cases) {
    const rec = project(base, comments, repo(openPr(41, 'impl/kf-meta-p')));
    assert.equal(rec.reduction.started, false, name);
    assert.equal(rec.reduction.reason, FOLD_NOT_STARTED.AUTHORITY_UNVERIFIED, name);
    assert.deepEqual(rec.effective_state, base, name);
    assert.ok(codes(rec).includes(code), `${name}: expected ${code}, got ${codes(rec)}`);
    assert.equal(act(rec).action, ACTIONS.REPORT_DRIFT, name);
  }
  // Referent: the same typed effect, unedited and uniquely ordered, folds.
  assert.equal(project(base, [anchor, effect], repo(openPr(41, 'impl/kf-meta-p'))).consistent, true);
});

test('NC an unanchored or unfound checkpoint is not folded from', () => {
  const anchor = authority('DIRECTIVE', 'CG-D', 'KF-META-P');
  const effect = typed('REVIEW', 'CG-R', 'KF-META-P', 'PACKET_CORRECTION', { pr_number: 41 });
  const none = Object.assign(checkpoint(anchor), { authority_basis: null });
  const lost = Object.assign(checkpoint(anchor), { authority_basis: { message_id: 'CG-GONE', comment_id: 1 } });
  assert.equal(fold(none, [anchor, effect]).reason, FOLD_NOT_STARTED.CHECKPOINT_UNANCHORED);
  assert.equal(fold(lost, [anchor, effect]).reason, FOLD_NOT_STARTED.CHECKPOINT_ANCHOR_NOT_FOUND);
  assert.deepEqual(codes(project(none, [anchor, effect], repo())), [FINDINGS.DERIVED_STATE_UNANCHORED]);
  assert.deepEqual(codes(project(lost, [anchor, effect], repo())), [FINDINGS.DERIVED_ANCHOR_NOT_FOUND]);
});

test('readEffect never infers meaning from prose or message ids', () => {
  const prose = authority('DIRECTIVE', 'CG-HOLD-ACTION-AUTO-009', 'KF-EXEC-ACTION-001');
  prose.body += '\n\nHOLD ACTION-001. This is a hold. Resume later. control_effect HOLD_SET';
  const entry = collectAuthority([prose]).newest;
  assert.equal(readEffect(entry).code, EFFECT_PROBLEMS.EFFECT_MISSING);
});

// ------------------------------------------------------------------ explicit holds

test('HOLD_SET on a HOLD holds the packet; HOLD_CLEAR on a RESUME releases it; nothing else does', () => {
  const anchor = authority('DIRECTIVE', 'CG-D', 'KF-META-P');
  const base = checkpoint(anchor, { state: 'CHECKPOINTED', active_packet: 'KF-META-P', pr_number: 9, implementation_branch: 'impl/kf-meta-p' });
  const pr = repo(mergedPr(9, 'impl/kf-meta-p'));

  // Referent: unheld and consistent, the projection proposes the next packet.
  const free = project(base, [anchor], pr);
  assert.equal(act(free).action, ACTIONS.SELECT_NEXT_PACKET);
  assert.equal(act(free).packet_id, 'KF-EXEC-ACTION-001');

  const hold = typed('HOLD', 'CG-HOLD-ACTION-X', 'KF-EXEC-ACTION-001', 'HOLD_SET');
  const held = project(base, [anchor, hold], pr);
  assert.equal(held.consistent, true, JSON.stringify(held.findings));
  const h = held.effective_state.holds['KF-EXEC-ACTION-001'];
  assert.equal(h.active, true);
  assert.equal(h.packet_id, 'KF-EXEC-ACTION-001');
  assert.equal(h.hold_message_id, 'CG-HOLD-ACTION-X');
  assert.equal(act(held).action, ACTIONS.WAIT_AUTHORITY);

  const resume = typed('RESUME', 'CG-RESUME-ACTION-X', 'KF-EXEC-ACTION-001', 'HOLD_CLEAR');
  const released = project(base, [anchor, hold, resume], pr);
  assert.equal(released.consistent, true);
  assert.equal(released.effective_state.holds['KF-EXEC-ACTION-001'].active, false);
  assert.equal(released.effective_state.holds['KF-EXEC-ACTION-001'].released_by, 'CG-RESUME-ACTION-X');
  assert.equal(act(released).action, ACTIONS.SELECT_NEXT_PACKET);
});

test('holds are packet-keyed: several packets can be held at once, and each is cleared on its own', () => {
  const anchor = authority('DIRECTIVE', 'CG-D', 'KF-META-P');
  const base = checkpoint(anchor);
  const holdA = typed('HOLD', 'CG-HOLD-A', 'KF-EXEC-ACTION-001', 'HOLD_SET');
  const holdB = typed('HOLD', 'CG-HOLD-B', 'KF-EXEC-OTHER-001', 'HOLD_SET');
  const clearA = typed('RESUME', 'CG-RESUME-A', 'KF-EXEC-ACTION-001', 'HOLD_CLEAR');

  const both = project(base, [anchor, holdA, holdB], repo());
  assert.equal(both.consistent, true, JSON.stringify(both.findings));
  assert.deepEqual(activeHolds(both.effective_state).map((x) => x.packet_id), ['KF-EXEC-ACTION-001', 'KF-EXEC-OTHER-001']);
  assert.equal(act(both).action, ACTIONS.WAIT_AUTHORITY, 'execution policy stays serialized while any hold is active');
  assert.equal(act(both).holds.length, 2);

  const one = project(base, [anchor, holdA, holdB, clearA], repo());
  assert.deepEqual(activeHolds(one.effective_state).map((x) => x.packet_id), ['KF-EXEC-OTHER-001'], 'clearing A leaves B held');
  assert.equal(validateState(one.effective_state).ok, true, JSON.stringify(validateState(one.effective_state).problems));
});

test('a hold on packet A does not make a valid effect for unrelated packet B unfoldable', () => {
  const anchor = authority('DIRECTIVE', 'CG-D', 'KF-META-P');
  const base = checkpoint(anchor, {}, { holds: { 'KF-EXEC-ACTION-001': { active: true, packet_id: 'KF-EXEC-ACTION-001', reason: 'held' } } });
  const correction = typed('REVIEW', 'CG-R', 'KF-META-P', 'PACKET_CORRECTION', { pr_number: 41 });
  const rec = project(base, [anchor, correction], repo(openPr(41, 'impl/kf-meta-p')));
  assert.equal(rec.consistent, true, JSON.stringify(rec.findings));
  assert.equal(rec.reduction.blocked, null);
  assert.equal(rec.effective_state.programme.state, 'FIXING_PROOF_FAILURES');
  assert.equal(rec.effective_state.holds['KF-EXEC-ACTION-001'].active, true, 'and A stays held');
});

test('a legacy single hold naming a packet is lifted into holds and cleared only by its RESUME', () => {
  const anchor = authority('DIRECTIVE', 'CG-D', 'KF-META-P');
  const base = checkpoint(anchor, {}, { hold: { active: true, packet_id: 'KF-EXEC-ACTION-001', reason: 'legacy' } });
  const clear = typed('RESUME', 'CG-RESUME', 'KF-EXEC-ACTION-001', 'HOLD_CLEAR');
  const out = fold(base, [anchor, clear]);
  assert.equal(out.blocked, null);
  assert.equal(out.state.hold, null);
  assert.equal(out.state.holds['KF-EXEC-ACTION-001'].active, false);
  assert.equal(out.state.holds['KF-EXEC-ACTION-001'].reason, 'legacy');
  assert.deepEqual(activeHolds(out.state), []);
});

test('NC holds are packet-bound: a duplicate hold, a clear without its hold, or an effect on a held packet fail closed', () => {
  const anchor = authority('DIRECTIVE', 'CG-D', 'KF-META-P');
  const held = checkpoint(anchor, { state: 'CHECKPOINTED', pr_number: 9 }, { holds: { 'KF-EXEC-ACTION-001': { active: true, packet_id: 'KF-EXEC-ACTION-001', reason: 'held' } } });
  const cases = [
    ['clear of a packet that is not held', typed('RESUME', 'CG-X', 'KF-EXEC-OTHER-001', 'HOLD_CLEAR'), EFFECT_PROBLEMS.HOLD_MISMATCH],
    ['clear with no hold at all', null, EFFECT_PROBLEMS.HOLD_MISMATCH],
    ['a duplicate hold on the held packet', typed('HOLD', 'CG-X', 'KF-EXEC-ACTION-001', 'HOLD_SET'), EFFECT_PROBLEMS.HOLD_DUPLICATE],
    ['a release of the held packet', typed('DIRECTIVE', 'CG-X', 'KF-EXEC-ACTION-001', 'PACKET_RELEASE'), EFFECT_PROBLEMS.PACKET_HELD],
  ];
  for (const [name, message, code] of cases) {
    const state = message ? held : Object.assign(structuredClone(held), { holds: {} });
    const msg = message || typed('RESUME', 'CG-X', 'KF-EXEC-ACTION-001', 'HOLD_CLEAR');
    const rec = project(state, [anchor, msg], repo(mergedPr(9, 'impl/kf-meta-p')));
    assert.equal(rec.reduction.blocked?.code, code, name);
    assert.deepEqual(codes(rec), [FINDINGS.DERIVED_STATE_STALE_AUTHORITY], name);
    assert.equal(act(rec).action, ACTIONS.REPORT_DRIFT, name);
  }
  // Referent: a hold on a packet that is not yet held folds.
  const other = project(held, [anchor, typed('HOLD', 'CG-Y', 'KF-EXEC-OTHER-001', 'HOLD_SET')], repo(mergedPr(9, 'impl/kf-meta-p')));
  assert.equal(other.reduction.blocked, null);
});

// ------------------------------------------------------------------ the projection stays valid (Copilot r4171049945)

test('NC health outside the vocabulary fails closed before the effect applies; canonical health folds (CORRECTION-003 F1)', () => {
  const anchor = authority('DIRECTIVE', 'CG-D', 'KF-META-P');
  const base = checkpoint(anchor);
  for (const health of ['GREEN', 'YELLOW', 'RED']) {
    const msg = typed('REVIEW', `CG-H-${health}`, 'KF-META-P', 'PACKET_CORRECTION', { pr_number: 41, health });
    const rec = project(base, [anchor, msg], repo(openPr(41, 'impl/kf-meta-p')));
    assert.equal(rec.reduction.blocked, null, health);
    assert.equal(rec.consistent, true, health);
    assert.equal(rec.effective_state.programme.health, health, health);
    assert.deepEqual(validateState(rec.effective_state).problems, [], health);
  }
  for (const [effect, extra] of [['PACKET_CORRECTION', { pr_number: 41 }], ['NO_STATE_CHANGE', {}]]) {
    for (const health of ['PURPLE', 'AMBER', 'green']) {
      const msg = typed('REVIEW', `CG-H-${health}`, 'KF-META-P', effect, { ...extra, health });
      const rec = project(base, [anchor, msg], repo(openPr(41, 'impl/kf-meta-p')));
      assert.equal(rec.reduction.blocked?.code, EFFECT_PROBLEMS.HEALTH_INVALID, `${effect} ${health}`);
      assert.deepEqual(rec.effective_state, base, 'nothing applied; the anchor did not move');
      assert.deepEqual(codes(rec), [FINDINGS.DERIVED_STATE_STALE_AUTHORITY]);
      assert.equal(act(rec).action, ACTIONS.REPORT_DRIFT, 'orchestration never consumes the invalid health');
    }
  }
});

test('NC production_touched other than false fails closed on every effect, holds included (Copilot r4171364250)', () => {
  const anchor = authority('DIRECTIVE', 'CG-D', 'KF-META-P');
  const base = checkpoint(anchor);
  const effects = [
    ['REVIEW', 'KF-META-P', 'PACKET_CORRECTION', { pr_number: 41 }],
    ['REVIEW', 'KF-META-P', 'NO_STATE_CHANGE', {}],
    ['HOLD', 'KF-EXEC-OTHER-001', 'HOLD_SET', {}],
  ];
  for (const [type, packet, effect, extra] of effects) {
    // Referent: the canonical safe value folds.
    const safe = project(base, [anchor, typed(type, 'CG-PT-SAFE', packet, effect, extra)], repo(openPr(41, 'impl/kf-meta-p')));
    assert.equal(safe.reduction.blocked, null, `${effect} false`);
    for (const touched of ['true', 'TRUE', 'yes', 'null']) {
      const msg = typed(type, `CG-PT-${touched}`, packet, effect, { ...extra, production_touched: touched });
      const rec = project(base, [anchor, msg], repo(openPr(41, 'impl/kf-meta-p')));
      assert.equal(rec.reduction.blocked?.code, EFFECT_PROBLEMS.PRODUCTION_TOUCHED, `${effect} ${touched}`);
      assert.deepEqual(rec.effective_state, base, 'nothing applied; the anchor did not move');
      assert.equal(act(rec).action, ACTIONS.REPORT_DRIFT, `${effect} ${touched}: orchestration never consumes it`);
    }
  }
});

test('NC a packet_id that is not a KF- packet id never keys a hold (Copilot r4171599236)', () => {
  const anchor = authority('DIRECTIVE', 'CG-D', 'KF-META-P');
  const base = checkpoint(anchor);
  for (const packet of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
    for (const [type, effect] of [['RESUME', 'HOLD_CLEAR'], ['HOLD', 'HOLD_SET']]) {
      const msg = typed(type, 'CG-PROTO', packet, effect, { implementation_branch: 'impl/x' });
      const rec = project(base, [anchor, msg], repo());
      assert.equal(rec.reduction.blocked?.code, EFFECT_PROBLEMS.PACKET_ID_INVALID, `${effect} ${packet}`);
      assert.deepEqual(rec.effective_state, base, `${effect} ${packet}: the anchor did not move`);
    }
  }
  // Defence in depth: below readEffect, an inherited key is still not an active hold.
  const message = collectAuthority([anchor, typed('RESUME', 'CG-R', 'KF-META-P', 'HOLD_CLEAR')]).newest;
  for (const packet of ['__proto__', 'constructor']) {
    const out = applyEffect(base, message, { ok: true, effect: 'HOLD_CLEAR', packet_id: packet });
    assert.equal(out.code, EFFECT_PROBLEMS.HOLD_MISMATCH, packet);
  }
});

test('the fold never hands decide() an invalid projection: a step the state contract rejects stops it', () => {
  const anchor = authority('DIRECTIVE', 'CG-D', 'KF-META-P');
  const tainted = checkpoint(anchor, { production_touched: true });
  const msg = typed('REVIEW', 'CG-N', 'KF-META-P', 'NO_STATE_CHANGE');
  const rec = project(tainted, [anchor, msg], repo());
  assert.equal(rec.reduction.blocked.code, EFFECT_PROBLEMS.PROJECTION_INVALID);
  assert.deepEqual(rec.reduction.blocked.detail, ['PRODUCTION_TOUCHED']);
  assert.equal(act(rec).action, ACTIONS.REPORT_DRIFT);
  // Referent: the same effect over a valid checkpoint folds.
  assert.equal(project(checkpoint(anchor), [anchor, msg], repo()).consistent, true);
});

test('the programme diagnostic names only the actual prohibition (Copilot r4171100288)', () => {
  const msg = typed('DIRECTIVE', 'CG-X', 'KF-META-P', 'NO_STATE_CHANGE', { programme_action: 'null' });
  const read = readEffect(collectAuthority([msg]).newest);
  assert.equal(read.code, EFFECT_PROBLEMS.PROGRAMME_NOT_FOLDABLE, 'mere presence, even null, stops the fold');
  assert.match(read.detail, /programme_action is present; programme activation is never folded/);
  assert.doesNotMatch(read.detail, /hold/i);
});

// ------------------------------------------------------------------ PR numbers

test('a correction before any PR exists folds, and a later correction keeps the projected PR', () => {
  const anchor = authority('DIRECTIVE', 'CG-D', 'KF-META-P');
  const base = checkpoint(anchor);
  const early = typed('REVIEW', 'CG-EARLY', 'KF-META-P', 'PACKET_CORRECTION');
  const named = typed('REVIEW', 'CG-NAMED', 'KF-META-P', 'PACKET_CORRECTION', { pr_number: 41 });
  const again = typed('DIRECTIVE', 'CG-AGAIN', 'KF-META-P', 'PACKET_CORRECTION');
  const out = fold(base, [anchor, early, named, again]);
  assert.equal(out.blocked, null);
  assert.equal(out.state.programme.pr_number, 41, 'a correction that names no PR carries the projected one forward');
  // A correction or admission naming another PR is a conflict, not a switch.
  const other = fold(base, [anchor, named, typed('REVIEW', 'CG-OTHER', 'KF-META-P', 'PACKET_ADMISSION', { pr_number: 42 })]);
  assert.equal(other.blocked.code, EFFECT_PROBLEMS.PR_CONFLICT);
});

// ------------------------------------------------------------------ generation never renumbers (C2)

test('NC generation is stable: a later event keeps its generation and coordinate when an earlier one turns malformed or edited', () => {
  const anchor = authority('DIRECTIVE', 'CG-D', 'KF-META-P');
  const base = checkpoint(anchor);
  const first = typed('REVIEW', 'CG-FIRST', 'KF-META-P', 'NO_STATE_CHANGE');
  const later = typed('REVIEW', 'CG-LATER', 'KF-META-P', 'NO_STATE_CHANGE');
  const clean = fold(base, [anchor, first, later]);
  const g = clean.applied.find((a) => a.message_id === 'CG-LATER');
  assert.equal(g.generation, 3);
  assert.equal(g.coordinate, `${later.created_at}#${later.id}`);

  // The earlier message becomes malformed (a repeated key): replay stops there,
  // and the later message still carries the same generation and coordinate.
  const broken = { ...first, body: first.body.replace(/```$/, 'control_effect: CHECKPOINT\n```') };
  const stopped = fold(base, [anchor, broken, later]);
  assert.equal(stopped.blocked.message_id, 'CG-FIRST');
  assert.equal(stopped.blocked.generation, 2, 'the malformed message keeps its own place');
  assert.equal(stopped.generation, clean.generation);
  const unapplied = stopped.unapplied.find((u) => u.message_id === 'CG-LATER');
  assert.deepEqual({ generation: unapplied.generation, coordinate: unapplied.coordinate }, { generation: g.generation, coordinate: g.coordinate });

  // An edit makes the snapshot unverifiable: nothing is numbered, so nothing is renumbered.
  const edited = fold(base, [anchor, { ...first, updated_at: '2026-10-04T00:00:00Z' }, later]);
  assert.equal(edited.reason, FOLD_NOT_STARTED.AUTHORITY_UNVERIFIED);
  assert.deepEqual([edited.applied, edited.unapplied, edited.blocked], [[], [], null]);
  // Once the snapshot is valid again, the original numbering returns.
  assert.deepEqual(fold(base, [anchor, first, later]).applied, clean.applied);
});

test('the committed checkpoint keeps ACTION-001 held against any typed effect except an explicit RESUME HOLD_CLEAR', () => {
  const state = loadState(process.cwd());
  const anchor = authority('DIRECTIVE', state.authority_basis.message_id, 'KF-META-STATE-REDUCER-LIVE-001', {}, { id: state.authority_basis.comment_id, at: '2026-10-03T00:16:04Z' });
  for (const [msg, code] of [
    // The hold is the reason, ahead of any in-flight or not-active conflict.
    [typed('DIRECTIVE', 'CG-X', 'KF-EXEC-ACTION-001', 'PACKET_RELEASE'), EFFECT_PROBLEMS.PACKET_HELD],
    [typed('DIRECTIVE', 'CG-X', 'KF-EXEC-ACTION-001', 'PACKET_CORRECTION', { pr_number: 77 }), EFFECT_PROBLEMS.PACKET_HELD],
    [typed('REVIEW', 'CG-X', 'KF-EXEC-ACTION-001', 'HOLD_CLEAR'), EFFECT_PROBLEMS.EFFECT_TYPE_MISMATCH],
  ]) {
    const out = fold(state, [anchor, msg]);
    assert.equal(out.blocked?.code, code, msg.body);
    assert.deepEqual(activeHolds(out.state).map((h) => h.packet_id), ['KF-EXEC-ACTION-001']);
  }
  // Referent: the explicit RESUME HOLD_CLEAR is the one thing that releases it.
  const resume = fold(state, [anchor, typed('RESUME', 'CG-RESUME', 'KF-EXEC-ACTION-001', 'HOLD_CLEAR')]);
  assert.equal(resume.blocked, null);
  assert.deepEqual(activeHolds(resume.state), []);
});

// ------------------------------------------------------------------ repository truth is never overwritten

test('NC repository contradictions still report drift after a typed effect folds', () => {
  const { base, anchor, correction, admission, close } = lifecycle();
  const ref = 'impl/kf-meta-p';
  const cases = [
    ['CHECKPOINT folded but the PR never merged', [anchor, correction, admission, close], openPr(41, ref), [FINDINGS.PR_NOT_MERGED]],
    ['ADMISSION folded but the PR closed unmerged', [anchor, correction, admission], { number: 41, state: 'closed', merged: false, head_ref: ref }, [FINDINGS.PR_CLOSED_UNMERGED]],
    ['ADMISSION folded and the PR already merged', [anchor, correction, admission], mergedPr(41, ref), [FINDINGS.PR_ALREADY_MERGED]],
    ['CORRECTION names a branch the PR does not have', [anchor, correction], openPr(41, 'impl/elsewhere'), [FINDINGS.PR_BRANCH_MISMATCH]],
  ];
  for (const [name, comments, pr, expect] of cases) {
    const rec = project(base, comments, (programme) => repo(Number(programme.pr_number) === pr.number ? pr : null));
    assert.equal(rec.reduction.blocked, null, `${name}: the fold itself succeeded`);
    assert.deepEqual(codes(rec), expect, name);
    assert.equal(act(rec).action, ACTIONS.REPORT_DRIFT, name);
  }
  const offMain = project(base, [anchor, correction], repo(openPr(41, ref), { source_main_on_main: false }));
  assert.deepEqual(codes(offMain), [FINDINGS.SOURCE_MAIN_NOT_ON_MAIN]);
});

test('repository truth is read for the effective projection, not the stored checkpoint', () => {
  const { base, anchor, correction } = lifecycle();
  const asked = [];
  const rec = project(base, [anchor, correction], (programme) => {
    asked.push(programme.pr_number);
    return repo(openPr(41, 'impl/kf-meta-p'));
  });
  assert.deepEqual(asked, [41], 'the stored checkpoint names no PR; the folded one names 41');
  assert.equal(rec.consistent, true);
});

// ------------------------------------------------------------------ stale-projection recovery

test('stale projection recovery: typed authority advances a stale checkpoint with no reconciliation PR', () => {
  const { base, comments } = lifecycle();
  // The plain reconcile() of the stored checkpoint is stale: what main did before this packet.
  const strict = reconcile(base, collectAuthority(comments), repo(null));
  assert.deepEqual(codes(strict), [FINDINGS.DERIVED_STATE_STALE_AUTHORITY]);
  // The fold recovers it, end to end through the lifecycle.
  const rec = project(base, comments, repo(mergedPr(41, 'impl/kf-meta-p')));
  assert.equal(rec.consistent, true, JSON.stringify(rec.findings));
  assert.equal(rec.authority_newest.message_id, 'CG-REVIEW-P-CHECKPOINT');
  assert.equal(act(rec).action, ACTIONS.SELECT_NEXT_PACKET);
});

const RECORDED = 'scripts/agent-control/fixtures/reducer-live-truth.json';

test('recorded evidence (reducer): every recorded body is only the column-0 lines parseEnvelope reads (C4-F2)', () => {
  const recorded = JSON.parse(fs.readFileSync(RECORDED, 'utf8'));
  assert.equal(recorded.comments.length, 18);
  for (const c of recorded.comments) {
    const lines = c.body.split('\n');
    const env = parseEnvelope(c.body);
    // Each line is a field the parser read, so no prose, fence or nested line survives.
    const read = env.keys.reduce((n, key) => n + env.values[key].length, 0);
    assert.equal(read, lines.length, `comment ${c.id} carries ${lines.length - read} line(s) the parser does not read`);
    assert.deepEqual(env.problems, [], `comment ${c.id}`);
  }
});

test('recorded evidence (reducer): the RECONCILE-002 checkpoint is stale on real #80 and cannot fold its untyped authority', () => {
  const recorded = JSON.parse(fs.readFileSync(RECORDED, 'utf8'));
  const auth = collectAuthority(recorded.comments);
  assert.equal(auth.verified, true, auth.reason);
  assert.equal(auth.newest.message_id, 'CG-REVIEW-META-STATE-REDUCER-LIVE-CORRECTION-001');
  const old = loadState(process.cwd());
  old.authority_basis = { message_id: 'CG-DIRECTIVE-META-STATE-RECONCILE-002', comment_id: 5875639550 };
  Object.assign(old.programme, { active_packet: 'KF-META-CONTROL-PARSER-001', state: 'CHECKPOINTED', pr_number: 100, implementation_branch: 'impl/kf-meta-control-parser-001' });
  const rec = reconcileProjection(old, auth, repo(mergedPr(100, 'impl/kf-meta-control-parser-001')), OPTIONS);
  assert.deepEqual(codes(rec), [FINDINGS.DERIVED_STATE_STALE_AUTHORITY]);
  assert.equal(rec.reduction.blocked.message_id, 'CG-REVIEW-META-STATE-RECONCILE-CORRECTION-001');
  assert.equal(rec.reduction.blocked.code, EFFECT_PROBLEMS.EFFECT_MISSING);
  // Generation is a position in the observed #80 snapshot. This recording starts at
  // the old anchor (1); the live issue, read whole, puts it at 51 and this message at 52.
  assert.equal(rec.reduction.checkpoint_generation, 1);
  assert.equal(rec.reduction.blocked.generation, 2);
  assert.equal(rec.reduction.blocked.coordinate, '2026-09-28T18:37:48Z#5876210525', 'the coordinate is absolute');
  assert.equal(rec.findings[0].detail.newer.length, 14);
});

test('recorded evidence (reducer): the committed checkpoint folds the real typed CORRECTION-001 on real #80 and main 11053288, and stays held', () => {
  const recorded = JSON.parse(fs.readFileSync(RECORDED, 'utf8'));
  const state = loadState(process.cwd());
  const auth = collectAuthority(recorded.comments);
  const anchor = auth.messages.find((m) => m.message_id === 'CG-DIRECTIVE-META-STATE-REDUCER-LIVE-001');
  assert.deepEqual(state.authority_basis, { message_id: anchor.message_id, comment_id: anchor.comment_id });

  // The PACKET_RELEASE the anchor directive would declare projects exactly the committed programme.
  const p = state.programme;
  assert.deepEqual(
    { active_packet: p.active_packet, state: p.state, source_main: p.source_main, implementation_branch: p.implementation_branch, pr_number: p.pr_number },
    { active_packet: anchor.packet_id, state: 'CHARACTERIZING', source_main: anchor.source_main, implementation_branch: anchor.implementation_branch, pr_number: null },
  );

  // The real ChatGPT REVIEW posted after the anchor is typed, and it folds.
  const rec = reconcileProjection(state, auth, recorded.repo, OPTIONS);
  assert.equal(rec.consistent, true, JSON.stringify(rec.findings));
  // Positions in this recording (the live issue, read whole, gives 64 and 65).
  assert.deepEqual(rec.reduction.applied.map((a) => [a.message_id, a.effect, a.generation, a.coordinate]),
    [['CG-REVIEW-META-STATE-REDUCER-LIVE-CORRECTION-001', 'PACKET_CORRECTION', 15, '2026-10-03T00:30:35Z#5963636295']]);
  assert.equal(rec.reduction.checkpoint_generation, 14);
  assert.equal(rec.effective_state.programme.state, 'FIXING_PROOF_FAILURES');
  assert.equal(rec.effective_state.programme.pr_number, null);
  assert.equal(act(rec).action, ACTIONS.WAIT_AUTHORITY, 'ACTION-001 stays held');
  // Referent: the plain comparison of the stored checkpoint is stale on the same evidence.
  assert.deepEqual(codes(reconcile(state, auth, recorded.repo)), [FINDINGS.DERIVED_STATE_STALE_AUTHORITY]);

  // A further typed correction naming the PR folds; an untyped one does not.
  const base = { id: 5963800000, html_url: 'https://github.com/SaCH-PRO/KEYFLOWOS/issues/80#issuecomment-5963800000', created_at: '2026-10-03T02:00:00Z', updated_at: '2026-10-03T02:00:00Z', user: { login: 'SaCH-PRO' } };
  const envelope = [
    'message_id: CG-REVIEW-META-STATE-REDUCER-LIVE-CORRECTION-001', 'message_type: REVIEW', 'packet_id: KF-META-STATE-REDUCER-LIVE-001',
    'sender: chatgpt', `source_main: ${p.source_main}`, `implementation_branch: ${p.implementation_branch}`, 'state: REVIEWED', 'health: YELLOW',
    'scope_changed: false', 'production_touched: false', 'pr_number: 110',
  ];
  const typedReview = { ...base, body: ['```yaml', ...envelope, 'control_effect: PACKET_CORRECTION', '```'].join('\n') };
  const untypedReview = { ...base, body: ['```yaml', ...envelope, '```'].join('\n') };
  const pr = { number: 110, state: 'open', merged: false, head_ref: p.implementation_branch };
  const repoFor = (programme) => ({ ...recorded.repo, pr: programme.pr_number === 110 ? pr : null });

  const advanced = reconcileProjection(state, collectAuthority([...recorded.comments, typedReview]), repoFor, OPTIONS);
  assert.equal(advanced.consistent, true, JSON.stringify(advanced.findings));
  assert.equal(advanced.effective_state.programme.state, 'FIXING_PROOF_FAILURES');
  assert.equal(advanced.effective_state.programme.pr_number, 110);
  assert.equal(act(advanced).action, ACTIONS.WAIT_AUTHORITY, 'the ACTION-001 hold still outranks progression');

  const stale = reconcileProjection(state, collectAuthority([...recorded.comments, untypedReview]), repoFor, OPTIONS);
  assert.deepEqual(codes(stale), [FINDINGS.DERIVED_STATE_STALE_AUTHORITY]);
});

// ------------------------------------------------------------------ live wiring

function cli(script, args, snapshot, extraEnv = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-reducer-'));
  try {
    const file = path.join(dir, 'truth.json');
    fs.writeFileSync(file, JSON.stringify(snapshot));
    const env = { ...process.env, ...extraEnv };
    delete env.GITHUB_EVENT_NAME;
    delete env.GITHUB_EVENT_PATH;
    for (const [key, value] of Object.entries(extraEnv)) if (value === undefined) delete env[key];
    return spawnSync(process.execPath, [script, ...args, '--truth-file', file], { encoding: 'utf8', env });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Builder readiness as an explicit test seam (CORRECTION-003 F2). The CLI's
 * Claude adapter is READY when KEYFLOW_CLAUDE_BIN answers `--version`. A stub
 * on a temporary PATH answers it, so readiness never comes from the host or
 * the runner, and no credential or provider traffic is involved.
 * `available: false` disables the adapter instead.
 */
function withBuilder(available, fn) {
  if (!available) return fn({ KEYFLOW_AGENT_CLAUDE_DISABLED: '1' });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-stub-builder-'));
  try {
    if (process.platform === 'win32') {
      fs.writeFileSync(path.join(dir, 'kf-stub-claude.cmd'), '@echo kf-stub-claude 0.0.0\r\n');
    } else {
      fs.writeFileSync(path.join(dir, 'kf-stub-claude'), '#!/bin/sh\necho kf-stub-claude 0.0.0\n', { mode: 0o755 });
    }
    const pathKey = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH') || 'PATH';
    return fn({
      [pathKey]: `${dir}${path.delimiter}${process.env[pathKey] || ''}`,
      KEYFLOW_CLAUDE_BIN: 'kf-stub-claude',
      KEYFLOW_AGENT_CLAUDE_DISABLED: undefined,
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('CLI end to end: orchestrate decides on the effective projection, and a hold set by typed authority wins', () => {
  const recorded = JSON.parse(fs.readFileSync(RECORDED, 'utf8'));
  const state = loadState(process.cwd());
  const at = '2026-10-03T03:00:00Z';
  const msg = (id, type, packet, effect, extra = []) => ({
    id, html_url: `https://github.com/SaCH-PRO/KEYFLOWOS/issues/80#issuecomment-${id}`, created_at: at, updated_at: at, user: { login: 'SaCH-PRO' },
    body: ['```yaml', `message_id: ${type}-${id}`, `message_type: ${type}`, `packet_id: ${packet}`, 'sender: chatgpt',
      `source_main: ${state.programme.source_main}`, `implementation_branch: ${state.programme.implementation_branch}`, 'state: REVIEWED',
      'health: GREEN', 'scope_changed: false', 'production_touched: false', `control_effect: ${effect}`, ...extra, '```'].join('\n'),
  });
  const run = (comments, env = { KEYFLOW_AGENT_CLAUDE_DISABLED: '1' }) => {
    const res = cli('scripts/agent-control/orchestrate.mjs', ['--json'], { comments, repo: recorded.repo }, env);
    assert.equal(res.status, 0, res.stderr);
    return JSON.parse(res.stdout);
  };

  const plain = run(recorded.comments);
  assert.equal(plain.reconciliation.consistent, true, JSON.stringify(plain.reconciliation.findings));
  assert.equal(plain.decision.action, ACTIONS.WAIT_AUTHORITY);

  const observed = run([...recorded.comments, msg(5963700001, 'REVIEW', 'KF-META-STATE-REDUCER-LIVE-001', 'NO_STATE_CHANGE')]);
  assert.equal(observed.reconciliation.consistent, true, 'an observed typed REVIEW no longer makes the projection stale');
  assert.equal(observed.reconciliation.effective_state.authority_basis.message_id, 'REVIEW-5963700001');
  assert.deepEqual(observed.reconciliation.reduction.applied.map((a) => a.effect), ['PACKET_CORRECTION', 'NO_STATE_CHANGE']);

  // With ACTION-001 explicitly released and a test builder available, the
  // in-flight packet reaches DISPATCH_BUILDER. Readiness comes from the stub
  // seam, never from the host or the runner (CORRECTION-003 F2).
  const resumeMsg = msg(5963700002, 'RESUME', 'KF-EXEC-ACTION-001', 'HOLD_CLEAR');
  const resume = withBuilder(true, (env) => run([...recorded.comments, resumeMsg], env));
  assert.equal(resume.reconciliation.consistent, true);
  assert.equal(resume.reconciliation.effective_state.holds['KF-EXEC-ACTION-001'].active, false);
  assert.equal(resume.decision.action, ACTIONS.DISPATCH_BUILDER);
  assert.equal(resume.decision.packet_id, 'KF-META-STATE-REDUCER-LIVE-001');

  // A subsequent typed HOLD_SET still wins, with the same builder available.
  const reheld = withBuilder(true, (env) => run([...recorded.comments, resumeMsg, msg(5963700004, 'HOLD', 'KF-EXEC-ACTION-001', 'HOLD_SET')], env));
  assert.equal(reheld.reconciliation.consistent, true);
  assert.equal(reheld.reconciliation.effective_state.holds['KF-EXEC-ACTION-001'].active, true);
  assert.equal(reheld.decision.action, ACTIONS.WAIT_AUTHORITY);

  // Referent: the same release with no builder available waits for one, so the
  // dispatch above is the seam's doing, not the host's.
  const noBuilder = withBuilder(false, (env) => run([...recorded.comments, resumeMsg], env));
  assert.equal(noBuilder.decision.action, ACTIONS.WAIT_EXTERNAL_AGENT);
  assert.equal(noBuilder.decision.role, ROLES.BUILDER);

  const untyped = run([...recorded.comments, { ...msg(5963700003, 'REVIEW', 'KF-META-STATE-REDUCER-LIVE-001', 'NO_STATE_CHANGE'), body: msg(5963700003, 'REVIEW', 'KF-META-STATE-REDUCER-LIVE-001', 'X').body.replace('control_effect: X\n', '') }]);
  assert.equal(untyped.decision.action, ACTIONS.REPORT_DRIFT);
  assert.deepEqual(untyped.reconciliation.findings.map((f) => f.code), [FINDINGS.DERIVED_STATE_STALE_AUTHORITY]);

  // The fold is never written back: the committed checkpoint is unchanged.
  assert.deepEqual(loadState(process.cwd()), state);
});

test('CLI end to end: status --verify renders the effective projection and how it was reached', () => {
  const src = fs.readFileSync('scripts/agent-control/status.mjs', 'utf8');
  assert.match(src, /reconcileWithTruth\(checkpoint\)/);
  assert.match(src, /reconciliation \? reconciliation\.effective_state : checkpoint/);
});

test('reconcileWithTruth folds with the programme DAG as the credit set and reads live truth for the effective projection', () => {
  const state = loadState(process.cwd());
  const calls = [];
  const rec = reconcileWithTruth(state, {
    repository: 'o/r',
    dag: DAG,
    run: (args) => {
      calls.push(args.join(' '));
      throw Object.assign(new Error('x'), { stderr: 'gh: not logged in' });
    },
  });
  assert.ok(codes(rec).includes(FINDINGS.AUTHORITY_UNVERIFIABLE));
  assert.ok(codes(rec).includes(FINDINGS.REPO_TRUTH_UNVERIFIABLE));
  assert.equal(rec.reduction.reason, FOLD_NOT_STARTED.AUTHORITY_UNVERIFIED);
  assert.ok(calls[0].includes('issues/80/comments'), 'authority is read before repository truth');
});
