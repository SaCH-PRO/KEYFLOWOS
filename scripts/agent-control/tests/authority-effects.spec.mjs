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
import { SHAPE_INVALID, STATE_PATH, activeHolds, emptyState, hasProcessed, loadState, normalizeState, saveState, shapeProblems, validateState } from '../lib/state.mjs';
import { parseYaml, stringifyYaml } from '../lib/yaml.mjs';
import { decide, ACTIONS } from '../lib/orchestrator.mjs';
import { collectAuthority, reconcile, reconcileProjection, FINDINGS } from '../lib/reconcile.mjs';
import { reduceAuthority, readEffect, applyEffect, CONTROL_EFFECTS, EFFECT_PROBLEMS, FOLD_NOT_STARTED } from '../lib/authority-effects.mjs';
import { compareAuthorityOrder, parseEnvelope } from '../lib/control-envelope.mjs';
import { applicationPacketsOf, reconcileWithTruth } from '../lib/truth.mjs';
import { DAG_PATH, loadDag } from '../lib/dag.mjs';
import { ROLES, AGENT_STATUS } from '../lib/adapters.mjs';
import { buildStatus, renderHuman } from '../status.mjs';

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
  const base = checkpoint(anchor, {}, { holds: { 'KF-EXEC-HELD-001': { active: true, packet_id: 'KF-EXEC-HELD-001', reason: 'held' } } });
  const effects = [
    ['REVIEW', 'KF-META-P', 'PACKET_CORRECTION', { pr_number: 41 }],
    ['REVIEW', 'KF-META-P', 'NO_STATE_CHANGE', {}],
    ['HOLD', 'KF-EXEC-OTHER-001', 'HOLD_SET', {}],
    ['RESUME', 'KF-EXEC-HELD-001', 'HOLD_CLEAR', {}],
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

const INHERITED_KEYS = ['__proto__', 'constructor', 'toString', 'hasOwnProperty'];

test('NC an unmatched HOLD_CLEAR for an inherited name fails closed (AUDIT-CORRECTION-007 A7-F1, Copilot r4171599236)', () => {
  const anchor = authority('DIRECTIVE', 'CG-D', 'KF-META-P');
  const base = checkpoint(anchor);
  for (const packet of INHERITED_KEYS) {
    const msg = typed('RESUME', 'CG-PROTO-CLEAR', packet, 'HOLD_CLEAR', { implementation_branch: 'impl/x' });
    const rec = project(base, [anchor, msg], repo());
    assert.equal(rec.reduction.blocked?.code, EFFECT_PROBLEMS.HOLD_MISMATCH, packet);
    assert.deepEqual(rec.effective_state, base, `${packet}: the anchor did not move`);
    assert.equal(act(rec).action, ACTIONS.REPORT_DRIFT, packet);
  }
  // Below readEffect too: an inherited key is never an active hold.
  const message = collectAuthority([anchor, typed('RESUME', 'CG-R', 'KF-META-P', 'HOLD_CLEAR')]).newest;
  for (const packet of INHERITED_KEYS) {
    assert.equal(applyEffect(base, message, { ok: true, effect: 'HOLD_CLEAR', packet_id: packet }).code, EFFECT_PROBLEMS.HOLD_MISMATCH, packet);
  }
});

test('a hold for any non-blank packet id, inherited names included, sets and clears as an own key without prototype mutation (A7-F1)', () => {
  const anchor = authority('DIRECTIVE', 'CG-D', 'KF-META-P');
  const base = checkpoint(anchor);
  for (const packet of INHERITED_KEYS) {
    const set = typed('HOLD', `CG-PROTO-SET-${packet}`, packet, 'HOLD_SET', { implementation_branch: 'impl/x' });
    const held = fold(base, [anchor, set]);
    assert.equal(held.blocked, null, `${packet} HOLD_SET folds`);
    const holds = held.state.holds;
    assert.equal(Object.getPrototypeOf(holds), Object.prototype, `${packet}: the holds map's prototype is untouched`);
    assert.ok(Object.hasOwn(holds, packet), `${packet} is an own key`);
    assert.equal(holds[packet].packet_id, packet);
    assert.deepEqual(Object.keys(holds), [packet]);
    assert.deepEqual(activeHolds(held.state).map((h) => h.packet_id), [packet]);
    // A duplicate hold on it is a duplicate, as for any packet.
    const dup = fold(base, [anchor, set, typed('HOLD', 'CG-PROTO-DUP', packet, 'HOLD_SET', { implementation_branch: 'impl/x' })]);
    assert.equal(dup.blocked?.code, EFFECT_PROBLEMS.HOLD_DUPLICATE, packet);
    // Its RESUME clears it, deterministically.
    const clear = typed('RESUME', `CG-PROTO-RESUME-${packet}`, packet, 'HOLD_CLEAR', { implementation_branch: 'impl/x' });
    const cleared = fold(base, [anchor, set, clear]);
    assert.equal(cleared.blocked, null, `${packet} HOLD_CLEAR folds`);
    assert.equal(cleared.state.holds[packet].active, false);
    assert.equal(Object.getPrototypeOf(cleared.state.holds), Object.prototype);
    assert.deepEqual(activeHolds(cleared.state), []);
    assert.deepEqual(fold(base, [anchor, set, clear]), cleared, 'replay is deterministic');
  }
  assert.equal(Object.prototype.active, undefined, 'Object.prototype was not polluted');
});

test('a hold keyed by an inherited name survives the checkpoint YAML round trip as an own key (A7-F1)', () => {
  const anchor = authority('DIRECTIVE', 'CG-D', 'KF-META-P');
  const held = fold(checkpoint(anchor), [anchor, typed('HOLD', 'CG-PROTO-SET', '__proto__', 'HOLD_SET', { implementation_branch: 'impl/x' })]);
  const text = stringifyYaml(held.state);
  const parsed = parseYaml(text);
  assert.equal(Object.getPrototypeOf(parsed.holds), Object.prototype, 'parsing never runs the __proto__ setter');
  assert.ok(Object.hasOwn(parsed.holds, '__proto__'));
  const reloaded = normalizeState(parsed);
  assert.ok(Object.hasOwn(reloaded.holds, '__proto__'));
  assert.deepEqual(activeHolds(reloaded).map((h) => h.packet_id), ['__proto__']);
  assert.deepEqual(validateState(reloaded).problems, []);
});

// Copilot r4171689174: stringifyYaml() wrote a key holding a colon plain, and
// matchKey() then rejected the line or read another key from it.
const AMBIGUOUS_KEYS = [':', 'a:b', 'a: b', 'a :b', 'KF-META-P: 2', '- z', '-', '1.50', '-007', 'null', '#x', 'a #b', '[x]', '{}', '>', '& a', 'say "hi": now', "it's: here", 'back\\slash: x', 'trailing '];

test('NC a hold keyed by a colon-bearing or otherwise ambiguous packet id survives the checkpoint YAML round trip under the same key (C10-F1, Copilot r4171689174)', () => {
  const anchor = authority('DIRECTIVE', 'CG-D', 'KF-META-P');
  const base = checkpoint(anchor);
  const message = collectAuthority([anchor, typed('HOLD', 'CG-H', 'KF-META-P', 'HOLD_SET')]).newest;
  const clearing = collectAuthority([anchor, typed('RESUME', 'CG-R', 'KF-META-P', 'HOLD_CLEAR')]).newest;
  let all = base;
  for (const packet of [...AMBIGUOUS_KEYS, ...INHERITED_KEYS]) {
    const held = applyEffect(base, message, { ok: true, effect: 'HOLD_SET', packet_id: packet });
    assert.equal(held.ok, true, packet);
    const text = stringifyYaml(held.state);
    const parsed = parseYaml(text);
    assert.deepEqual(Object.keys(parsed.holds), [packet], `${JSON.stringify(packet)} reads back as the same single key`);
    assert.equal(parsed.holds[packet].packet_id, packet);
    assert.equal(stringifyYaml(parsed), text, `${JSON.stringify(packet)}: a second save is identical`);
    const reloaded = normalizeState(parsed);
    assert.deepEqual(reloaded, normalizeState(held.state), `${JSON.stringify(packet)}: the reloaded checkpoint is the saved one`);
    assert.deepEqual(activeHolds(reloaded).map((h) => h.packet_id), [packet]);
    assert.deepEqual(validateState(reloaded).problems, []);
    // The reloaded hold is still the packet's own hold: a duplicate is refused and its RESUME clears it.
    assert.equal(applyEffect(reloaded, message, { ok: true, effect: 'HOLD_SET', packet_id: packet }).code, EFFECT_PROBLEMS.HOLD_DUPLICATE, packet);
    const cleared = applyEffect(reloaded, clearing, { ok: true, effect: 'HOLD_CLEAR', packet_id: packet });
    assert.equal(cleared.ok, true, packet);
    assert.deepEqual(activeHolds(cleared.state), []);
    all = applyEffect(all, message, { ok: true, effect: 'HOLD_SET', packet_id: packet }).state;
  }
  // Every one of them at once: no key collides with, or is swallowed by, another.
  const together = parseYaml(stringifyYaml(all));
  assert.deepEqual(Object.keys(together.holds), [...AMBIGUOUS_KEYS, ...INHERITED_KEYS]);
  assert.equal(Object.getPrototypeOf(together.holds), Object.prototype);
  assert.deepEqual(normalizeState(together), normalizeState(all));
});

test('a colon-bearing packet id folds from a real envelope and survives the round trip (C10-F1)', () => {
  // The packet-id vocabulary is not narrowed: these arrive through the #80 envelope parser as written.
  const anchor = authority('DIRECTIVE', 'CG-D', 'KF-META-P');
  for (const packet of [':', 'a:b', 'a: b', '- z']) {
    const set = typed('HOLD', 'CG-COLON-SET', packet, 'HOLD_SET', { implementation_branch: 'impl/x' });
    const held = fold(checkpoint(anchor), [anchor, set]);
    assert.equal(held.blocked, null, `${JSON.stringify(packet)} HOLD_SET folds`);
    assert.deepEqual(Object.keys(held.state.holds), [packet]);
    const reloaded = normalizeState(parseYaml(stringifyYaml(held.state)));
    assert.deepEqual(activeHolds(reloaded).map((h) => h.packet_id), [packet]);
    // From the reloaded checkpoint its RESUME clears it; before the fix the reload threw or lost the key.
    const clear = typed('RESUME', 'CG-COLON-RESUME', packet, 'HOLD_CLEAR', { implementation_branch: 'impl/x' });
    const cleared = fold(reloaded, [anchor, set, clear]);
    assert.equal(cleared.blocked, null, `${JSON.stringify(packet)} HOLD_CLEAR folds from the reloaded checkpoint`);
    assert.deepEqual(activeHolds(cleared.state), []);
  }
});

test('the fold never hands decide() an invalid projection: a step the state contract rejects stops it', () => {
  // The checkpoint is valid, so the step check is what stops this fold; an
  // invalid checkpoint never starts one (CHECKPOINT-VALIDATION-017, below).
  // The envelope parser never emits valid authority with a blank message id.
  // A snapshot entry carrying one would anchor the projection to nothing.
  const anchor = authority('DIRECTIVE', 'CG-D', 'KF-META-P');
  const msg = typed('REVIEW', 'CG-N', 'KF-META-P', 'NO_STATE_CHANGE');
  const base = checkpoint(anchor);
  assert.deepEqual(validateState(base).problems, []);
  const auth = collectAuthority([anchor, msg]);
  auth.messages.find((m) => m.message_id === 'CG-N').message_id = '';
  const rec = reconcileProjection(base, auth, repo(), OPTIONS);
  assert.equal(rec.reduction.started, true);
  assert.equal(rec.reduction.blocked.code, EFFECT_PROBLEMS.PROJECTION_INVALID);
  assert.deepEqual(rec.reduction.blocked.detail, ['AUTHORITY_BASIS_INVALID']);
  assert.deepEqual(rec.effective_state, base, 'the rejected step is not applied');
  assert.equal(act(rec).action, ACTIONS.REPORT_DRIFT);
  // Referent: the same effect, as the parser emits it, folds over the same checkpoint.
  assert.equal(project(checkpoint(anchor), [anchor, msg], repo()).consistent, true);
});

// ------------------------------------------------------------------ the checkpoint itself (CHECKPOINT-VALIDATION-017)

/** Checkpoints validateState() rejects, each with the one problem it reports. */
const INVALID_CHECKPOINTS = [
  ['health AMBER', (s) => { s.programme.health = 'AMBER'; }, 'UNKNOWN_HEALTH'],
  ['state REVIEWED', (s) => { s.programme.state = 'REVIEWED'; }, 'UNKNOWN_STATE'],
  ['source_main is not a sha', (s) => { s.programme.source_main = 'main'; }, 'SOURCE_MAIN_NOT_A_SHA'],
  ['production touched', (s) => { s.programme.production_touched = true; }, 'PRODUCTION_TOUCHED'],
  ['merge authority without a marker', (s) => { s.programme.merge_authority = true; }, 'MERGE_AUTHORITY_WITHOUT_MARKER'],
  ['a hold under another packet key', (s) => { s.holds = { 'KF-X': { active: true, packet_id: 'KF-Y' } }; }, 'HOLD_KEY_MISMATCH'],
  ['a packet in both hold and holds', (s) => {
    s.hold = { active: true, packet_id: 'KF-X' };
    s.holds = { 'KF-X': { active: true, packet_id: 'KF-X' } };
  }, 'HOLD_REPRESENTATION_AMBIGUOUS'],
  ['duplicate processed keys', (s) => { s.processed_event_keys = ['k', 'k']; }, 'DUPLICATE_PROCESSED_KEYS'],
];
const invalidCheckpoint = (anchor, mutate, programme = {}, extra = {}) => {
  const state = checkpoint(anchor, programme, extra);
  mutate(state);
  return state;
};
const amber = (s) => { s.programme.health = 'AMBER'; };

test('NC an invalid checkpoint whose anchor is the newest authority fails closed, and is not repaired (017)', () => {
  const anchor = authority('DIRECTIVE', 'CG-D', 'KF-META-P');
  for (const [name, mutate, code] of INVALID_CHECKPOINTS) {
    const bad = invalidCheckpoint(anchor, mutate);
    const before = structuredClone(bad);
    const out = fold(bad, [anchor]);
    assert.equal(out.started, false, name);
    assert.equal(out.reason, FOLD_NOT_STARTED.CHECKPOINT_INVALID, name);
    assert.deepEqual(out.checkpoint_problems.map((x) => x.code), [code], name);
    assert.equal(out.checkpoint_generation, 1, name);
    assert.equal(out.observed_generation, null, name);
    assert.deepEqual([out.applied, out.blocked, out.unapplied], [[], null, []], name);
    assert.deepEqual(bad, before, `${name}: the checkpoint is not repaired, normalized or coerced`);

    const rec = project(bad, [anchor], repo());
    assert.equal(rec.consistent, false, name);
    assert.deepEqual(codes(rec), [FINDINGS.DERIVED_STATE_INVALID], name);
    assert.deepEqual(rec.findings[0].detail.anchor, bad.authority_basis, name);
    assert.deepEqual(rec.findings[0].detail.problems.map((x) => x.code), [code], name);
    assert.equal(rec.reduction.reason, FOLD_NOT_STARTED.CHECKPOINT_INVALID, name);
    assert.deepEqual(rec.effective_state, before, name);
    const decision = act(rec);
    assert.equal(decision.action, ACTIONS.REPORT_DRIFT, name);
    assert.deepEqual(decision.findings.map((f) => f.code), [FINDINGS.DERIVED_STATE_INVALID], name);
  }
  // Referent: the same checkpoint without a defect, same single message, is usable as before.
  const good = fold(checkpoint(anchor), [anchor]);
  assert.deepEqual([good.started, good.reason, good.checkpoint_problems, good.applied, good.observed_generation], [true, null, [], [], 1]);
  const rec = project(checkpoint(anchor), [anchor], repo());
  assert.equal(rec.consistent, true, JSON.stringify(rec.findings));
  assert.deepEqual(rec.effective_state, checkpoint(anchor));
  assert.equal(act(rec).action, ACTIONS.DISPATCH_BUILDER);
});

test('NC a checkpoint with health AMBER cannot reconcile as consistent on real #80 with zero newer effects (017, Copilot r4178799610)', () => {
  const recorded = JSON.parse(fs.readFileSync(RECOVERY, 'utf8'));
  const auth = collectAuthority(recorded.comments);
  assert.equal(auth.newest.comment_id, ANCHOR_021.comment_id, 'the anchor is the newest recorded authority: nothing folds');
  const state = loadState(process.cwd());
  state.programme.health = 'AMBER';
  const rec = reconcileProjection(state, auth, recorded.repo, OPTIONS);
  assert.equal(rec.consistent, false);
  assert.deepEqual(rec.findings, [{
    code: FINDINGS.DERIVED_STATE_INVALID,
    detail: { anchor: ANCHOR_021, problems: [{ code: 'UNKNOWN_HEALTH', detail: 'programme.health=AMBER' }] },
  }]);
  assert.equal(rec.reduction.started, false);
  assert.equal(rec.reduction.reason, FOLD_NOT_STARTED.CHECKPOINT_INVALID);
  assert.equal(rec.effective_state.programme.health, 'AMBER', 'never translated');
  assert.equal(act(rec).action, ACTIONS.REPORT_DRIFT);
  // Referent: the committed checkpoint on the same recording reconciles and waits on the ACTION-001 hold.
  const clean = reconcileProjection(loadState(process.cwd()), auth, recorded.repo, OPTIONS);
  assert.equal(clean.consistent, true, JSON.stringify(clean.findings));
  assert.equal(act(clean).action, ACTIONS.WAIT_AUTHORITY);
});

test('NC an invalid checkpoint is never the base of a fold, with one or many newer effects (017)', () => {
  const { anchor, correction, comments } = lifecycle();
  const pr = repo(openPr(41, 'impl/kf-meta-p'));
  // The correction projects health YELLOW. Folded over the AMBER checkpoint it
  // would overwrite the defect, and the result would pass every step check.
  for (const [name, newer, stale] of [['one newer effect', [correction], 1], ['many newer effects', comments.slice(1), 3]]) {
    const bad = invalidCheckpoint(anchor, amber);
    const before = structuredClone(bad);
    const out = fold(bad, [anchor, ...newer]);
    assert.equal(out.started, false, name);
    assert.equal(out.reason, FOLD_NOT_STARTED.CHECKPOINT_INVALID, name);
    assert.deepEqual(out.applied, [], name);
    assert.equal(out.state, bad, name);
    const rec = project(bad, [anchor, ...newer], pr);
    assert.deepEqual(codes(rec), [FINDINGS.DERIVED_STATE_INVALID, FINDINGS.DERIVED_STATE_STALE_AUTHORITY], name);
    assert.equal(rec.findings[1].detail.newer.length, stale, name);
    assert.deepEqual(rec.effective_state, before, name);
    assert.equal(act(rec).action, ACTIONS.REPORT_DRIFT, name);
  }
  // Referent: the valid checkpoint folds the same messages exactly as before.
  const one = project(checkpoint(anchor), [anchor, correction], pr);
  assert.equal(one.consistent, true, JSON.stringify(one.findings));
  assert.deepEqual(one.reduction.applied.map((a) => a.effect), ['PACKET_CORRECTION']);
  assert.equal(one.effective_state.programme.health, 'YELLOW');
  const many = fold(checkpoint(anchor), comments);
  assert.deepEqual(many.applied.map((a) => a.effect), ['PACKET_CORRECTION', 'PACKET_ADMISSION', 'CHECKPOINT']);
  assert.equal(many.state.programme.state, 'CHECKPOINTED');
  assert.deepEqual(many.checkpoint_problems, []);
});

test('NC an invalid checkpoint reaches no dispatch, review, admission or wait decision as if it were valid (017)', () => {
  const anchor = authority('DIRECTIVE', 'CG-D', 'KF-META-P');
  const marker = { merge_authority_marker: { message_id: 'CG-D', comment_id: collectAuthority([anchor]).newest.comment_id } };
  const pr = repo(openPr(41, 'impl/kf-meta-p'));
  const shapes = [
    ['dispatch', {}, {}, repo(), ACTIONS.DISPATCH_BUILDER],
    ['review', { state: 'PROVING', pr_number: 41 }, {}, pr, ACTIONS.REQUEST_REVIEW],
    ['admission', { state: 'READY_TO_MERGE', pr_number: 41, merge_authority: true }, marker, pr, ACTIONS.EVALUATE_ADMISSION],
    ['wait', {}, { holds: { 'KF-X': { active: true, packet_id: 'KF-X', reason: 'held' } } }, repo(), ACTIONS.WAIT_AUTHORITY],
  ];
  for (const [name, programme, extra, truth, normal] of shapes) {
    // Referent first: valid, this checkpoint reaches its normal decision.
    const good = project(checkpoint(anchor, programme, extra), [anchor], truth);
    assert.equal(good.consistent, true, `${name}: ${JSON.stringify(good.findings)}`);
    assert.equal(act(good).action, normal, name);
    const rec = project(invalidCheckpoint(anchor, amber, programme, extra), [anchor], truth);
    const decision = act(rec);
    assert.equal(decision.action, ACTIONS.REPORT_DRIFT, name);
    assert.equal(decision.advancement, 'NONE', name);
    assert.deepEqual(decision.findings.map((f) => f.code), [FINDINGS.DERIVED_STATE_INVALID], name);
  }
});

test('an invalid checkpoint does not change the precedence of unverifiable authority or a missing anchor (017)', () => {
  const anchor = authority('DIRECTIVE', 'CG-D', 'KF-META-P');
  const effect = typed('REVIEW', 'CG-R', 'KF-META-P', 'PACKET_CORRECTION', { pr_number: 41 });
  const edited = typed('REVIEW', 'CG-R', 'KF-META-P', 'PACKET_CORRECTION', { pr_number: 41 }, { id: effect.id, at: effect.created_at, edited: true });
  const unanchored = (s) => { s.authority_basis = null; };
  const partial = (s) => { s.authority_basis = { message_id: 'CG-D' }; };
  const lost = (s) => { s.authority_basis = { message_id: 'CG-GONE', comment_id: 1 }; };
  const cases = [
    ['edited authority', () => {}, [anchor, edited], FOLD_NOT_STARTED.AUTHORITY_UNVERIFIED, [FINDINGS.AUTHORITY_EDITED]],
    ['no anchor', unanchored, [anchor, effect], FOLD_NOT_STARTED.CHECKPOINT_UNANCHORED, [FINDINGS.DERIVED_STATE_UNANCHORED]],
    ['an anchor without a comment id', partial, [anchor, effect], FOLD_NOT_STARTED.CHECKPOINT_UNANCHORED, [FINDINGS.DERIVED_STATE_UNANCHORED]],
    ['an anchor that is not on #80', lost, [anchor, effect], FOLD_NOT_STARTED.CHECKPOINT_ANCHOR_NOT_FOUND, [FINDINGS.DERIVED_ANCHOR_NOT_FOUND]],
  ];
  for (const [name, shape, comments, reason, expected] of cases) {
    const verdicts = [() => {}, amber].map((defect) => {
      const state = checkpoint(anchor);
      defect(state);
      shape(state);
      return project(state, comments, repo(openPr(41, 'impl/kf-meta-p')));
    });
    for (const rec of verdicts) {
      assert.equal(rec.reduction.started, false, name);
      assert.equal(rec.reduction.reason, reason, name);
      assert.deepEqual(rec.reduction.checkpoint_problems, [], name);
      assert.deepEqual(codes(rec), expected, name);
      assert.equal(act(rec).action, ACTIONS.REPORT_DRIFT, name);
    }
  }
  // Malformed authority newer than the anchor is still reported beside the invalid checkpoint.
  const malformed = comment({ message_id: 'CG-BAD', message_type: 'REVIEW', sender: 'chatgpt' });
  const rec = project(invalidCheckpoint(anchor, amber), [anchor, malformed], repo());
  assert.equal(rec.reduction.reason, FOLD_NOT_STARTED.CHECKPOINT_INVALID);
  assert.deepEqual(codes(rec), [FINDINGS.DERIVED_STATE_INVALID, FINDINGS.AUTHORITY_MALFORMED]);
  // Referent: over the valid checkpoint the same malformed message stops a started fold, as before.
  const started = project(checkpoint(anchor), [anchor, malformed], repo());
  assert.equal(started.reduction.started, true);
  assert.equal(started.reduction.blocked.code, EFFECT_PROBLEMS.AUTHORITY_MALFORMED);
  assert.deepEqual(codes(started), [FINDINGS.AUTHORITY_MALFORMED]);
});

// ------------------------------------------------------------------ the checkpoint's raw shape (CONVERGED-CORRECTIONS-018 K2)

const HELD_X = { active: true, packet_id: 'KF-X', reason: 'held' };

/** Containers present with the wrong structural type: [name, container, value as written, what was found]. */
const WRONG_SHAPES = [
  ['holds: []', 'holds', [], 'mapping', 'list'],
  ['holds: a list of holds', 'holds', [HELD_X], 'mapping', 'list'],
  ['holds: null', 'holds', null, 'mapping', 'null'],
  ['holds: text', 'holds', 'none', 'mapping', 'string'],
  ['programme: []', 'programme', [], 'mapping', 'list'],
  ['programme: null', 'programme', null, 'mapping', 'null'],
  ['momentum: []', 'momentum', [], 'mapping', 'list'],
  ['momentum: 0', 'momentum', 0, 'mapping', 'number'],
  ['correction: text', 'correction', 'none', 'mapping', 'string'],
  ['agents: []', 'agents', [], 'mapping', 'list'],
  ['agents: false', 'agents', false, 'mapping', 'boolean'],
  ['programme.checkpointed: {}', 'programme.checkpointed', {}, 'list', 'mapping'],
  ['programme.checkpointed: null', 'programme.checkpointed', null, 'list', 'null'],
  ['programme.checkpointed: text', 'programme.checkpointed', 'KF-EXEC-K12-001', 'list', 'string'],
  ['unresolved_contradictions: {}', 'unresolved_contradictions', {}, 'list', 'mapping'],
  ['unresolved_contradictions: null', 'unresolved_contradictions', null, 'list', 'null'],
  ['processed_event_keys: {}', 'processed_event_keys', {}, 'list', 'mapping'],
  ['processed_event_keys: text', 'processed_event_keys', 'k', 'list', 'string'],
  ['event_journal: {}', 'event_journal', {}, 'list', 'mapping'],
  ['event_journal: 3', 'event_journal', 3, 'list', 'number'],
  ['hold: []', 'hold', [], 'mapping or null', 'list'],
  ['hold: text', 'hold', 'held', 'mapping or null', 'string'],
];
const containerOf = (state, name) => name.split('.').reduce((at, key) => at[key], state);
/** The checkpoint as a document on disk: written as YAML, with one container set to `value`. */
function writtenWith(anchor, name, value, programme = {}, extra = {}) {
  const raw = structuredClone(checkpoint(anchor, programme, extra));
  const keys = name.split('.');
  const last = keys.pop();
  keys.reduce((at, key) => at[key], raw)[last] = value;
  return stringifyYaml(raw);
}
const shapeProblem = (name, expected, found) => ({ code: SHAPE_INVALID, detail: `${name} must be a ${expected} when present, found ${found}` });

test('NC a container present with the wrong type is left as written and fails closed before any fold or decision (018 K2)', () => {
  // Copilot review 5407820973: normalizeState() turned `holds: []` into `{}`,
  // so validateState() accepted the checkpoint and the fold started from it.
  const anchor = authority('DIRECTIVE', 'CG-D', 'KF-META-P');
  for (const [label, name, value, expected, found] of WRONG_SHAPES) {
    const text = writtenWith(anchor, name, value);
    const raw = parseYaml(text);
    assert.deepEqual(containerOf(raw, name), value, `${label}: the document carries the wrong container`);
    const problem = shapeProblem(name, expected, found);
    // Rejected as written, before normalization.
    assert.deepEqual(shapeProblems(raw), [problem], label);
    // Normalization does not turn it into the right type.
    const loaded = normalizeState(raw);
    assert.deepEqual(containerOf(loaded, name), value, `${label}: left as written`);
    assert.deepEqual(validateState(loaded), { ok: false, problems: [problem] }, label);
    const before = structuredClone(loaded);

    const out = fold(loaded, [anchor]);
    assert.equal(out.started, false, label);
    assert.equal(out.reason, FOLD_NOT_STARTED.CHECKPOINT_INVALID, label);
    assert.deepEqual(out.checkpoint_problems, [problem], label);
    assert.deepEqual([out.applied, out.blocked, out.unapplied], [[], null, []], label);

    const rec = project(loaded, [anchor], repo());
    assert.equal(rec.consistent, false, label);
    assert.deepEqual(codes(rec), [FINDINGS.DERIVED_STATE_INVALID], label);
    assert.deepEqual(rec.findings[0].detail.problems, [problem], label);
    const decision = act(rec);
    assert.equal(decision.action, ACTIONS.REPORT_DRIFT, label);
    assert.equal(decision.advancement, 'NONE', label);
    assert.deepEqual(loaded, before, `${label}: not repaired by the fold, the reconciliation or the decision`);
    // The journal lookup the orchestrator makes before deciding reads it without failing.
    assert.equal(hasProcessed(loaded, 'issue_comment:1:created'), false, label);
    // And it can never be written back.
    assert.throws(() => saveState(loaded, os.tmpdir()), /programme-state invalid: CHECKPOINT_SHAPE_INVALID/, label);
  }
  // A newer typed effect is not folded over it either.
  const { anchor: first, correction } = lifecycle();
  const listed = normalizeState(parseYaml(writtenWith(first, 'holds', [])));
  const newer = project(listed, [first, correction], repo(openPr(41, 'impl/kf-meta-p')));
  assert.equal(newer.reduction.started, false);
  assert.deepEqual(newer.reduction.applied, []);
  assert.deepEqual(codes(newer), [FINDINGS.DERIVED_STATE_INVALID, FINDINGS.DERIVED_STATE_STALE_AUTHORITY]);
  assert.equal(act(newer).action, ACTIONS.REPORT_DRIFT);
  // A document that is not a mapping at all is not read as an empty checkpoint.
  assert.deepEqual(validateState(undefined), { ok: false, problems: [shapeProblem('programme-state', 'mapping', 'undefined')] });
  assert.deepEqual(validateState(null), { ok: false, problems: [shapeProblem('programme-state', 'mapping', 'null')] });
  for (const [document, found] of [[[], 'list'], [[{ holds: {} }], 'list'], ['text', 'string'], [7, 'number']]) {
    assert.deepEqual(shapeProblems(document), [shapeProblem('programme-state', 'mapping', found)], JSON.stringify(document));
    assert.deepEqual(normalizeState(document), document, 'returned as written');
    assert.equal(validateState(normalizeState(document)).ok, false);
    const rec = project(normalizeState(document), [anchor], repo());
    assert.equal(rec.consistent, false, JSON.stringify(document));
    assert.equal(act(rec).action, ACTIONS.REPORT_DRIFT, JSON.stringify(document));
  }
  // Referent: the same document with every container in its own type is valid and reaches its decision.
  const good = normalizeState(parseYaml(stringifyYaml(checkpoint(anchor))));
  assert.deepEqual(shapeProblems(good), []);
  assert.deepEqual(validateState(good).problems, []);
  const rec = project(good, [anchor], repo());
  assert.equal(rec.consistent, true, JSON.stringify(rec.findings));
  assert.equal(act(rec).action, ACTIONS.DISPATCH_BUILDER);
});

test('NC a wrong-type container reaches no dispatch, review, admission or wait decision as if it were valid (018 K2)', () => {
  const anchor = authority('DIRECTIVE', 'CG-D', 'KF-META-P');
  const marker = { merge_authority_marker: { message_id: 'CG-D', comment_id: collectAuthority([anchor]).newest.comment_id } };
  const pr = repo(openPr(41, 'impl/kf-meta-p'));
  const shapes = [
    ['dispatch', {}, {}, repo(), ACTIONS.DISPATCH_BUILDER],
    ['review', { state: 'PROVING', pr_number: 41 }, {}, pr, ACTIONS.REQUEST_REVIEW],
    ['admission', { state: 'READY_TO_MERGE', pr_number: 41, merge_authority: true }, marker, pr, ACTIONS.EVALUATE_ADMISSION],
    ['wait', {}, { hold: { active: true, reason: 'held, no packet named' } }, repo(), ACTIONS.WAIT_AUTHORITY],
  ];
  for (const [name, programme, extra, truth, normal] of shapes) {
    // Referent first: with its containers in their own types, this checkpoint reaches its normal decision.
    const good = project(normalizeState(parseYaml(stringifyYaml(checkpoint(anchor, programme, extra)))), [anchor], truth);
    assert.equal(good.consistent, true, `${name}: ${JSON.stringify(good.findings)}`);
    assert.equal(act(good).action, normal, name);
    for (const [container, value] of [['holds', []], ['agents', []], ['event_journal', {}], ['programme.checkpointed', {}]]) {
      const label = `${name}, ${container}`;
      const bad = normalizeState(parseYaml(writtenWith(anchor, container, value, programme, extra)));
      const rec = project(bad, [anchor], truth);
      const decision = act(rec);
      assert.equal(decision.action, ACTIONS.REPORT_DRIFT, label);
      assert.equal(decision.advancement, 'NONE', label);
      assert.deepEqual(decision.findings.map((f) => f.code), [FINDINGS.DERIVED_STATE_INVALID], label);
      assert.deepEqual(decision.findings[0].detail.problems.map((x) => x.code), [SHAPE_INVALID], label);
    }
  }
});

test('NC a wrong-type hold container yields no hold entry in activeHolds, the status or its rendering (020 K2)', () => {
  // Copilot r4179736650: `holds: none` was shown as four one-letter holds and
  // `holds: [{...}]` as a real-looking hold, beside the drift that rejects them.
  const anchor = authority('DIRECTIVE', 'CG-D', 'KF-META-P');
  const held = { active: true, packet_id: 'KF-X', reason: 'held by review', resume_condition: 'a typed RESUME' };
  const statusOf = (rec) => buildStatus(process.cwd(), { state: rec.effective_state, dag: DAG, registry: [], reconciliation: rec });
  const wrong = [
    ['holds: none', 'holds', 'none', 'mapping', 'string'],
    ['holds: [{...}]', 'holds', [held], 'mapping', 'list'],
    ['holds: []', 'holds', [], 'mapping', 'list'],
    ['holds: null', 'holds', null, 'mapping', 'null'],
    ['holds: 7', 'holds', 7, 'mapping', 'number'],
    ['hold: text', 'hold', 'held', 'mapping or null', 'string'],
    ['hold: [{...}]', 'hold', [held], 'mapping or null', 'list'],
    ['hold: true', 'hold', true, 'mapping or null', 'boolean'],
  ];
  for (const [label, name, value, expected, found] of wrong) {
    const loaded = normalizeState(parseYaml(writtenWith(anchor, name, value)));
    assert.deepEqual(loaded[name], value, `${label}: left as written`);
    assert.deepEqual(activeHolds(loaded), [], label);
    // The wrong container is still what the drift names.
    const problem = shapeProblem(name, expected, found);
    const rec = project(loaded, [anchor], repo());
    assert.deepEqual(codes(rec), [FINDINGS.DERIVED_STATE_INVALID], label);
    assert.deepEqual(rec.findings[0].detail.problems, [problem], label);
    assert.equal(act(rec).action, ACTIONS.REPORT_DRIFT, label);
    const status = statusOf(rec);
    assert.equal(status.hold, null, label);
    assert.deepEqual(status.holds, [], label);
    const text = renderHuman(status);
    assert.doesNotMatch(text, /^HOLD\b/m, label);
    assert.doesNotMatch(text, /resume when/, label);
    assert.match(text, /Reconciliation : DRIFT/, label);
    assert.ok(text.includes('DERIVED_STATE_INVALID') && text.includes(problem.detail), label);
  }
  // An entry of `holds` that is not a mapping is no hold either; the contract names it under its own code.
  for (const entry of ['held', [held], 7, true, null]) {
    const label = `holds.KF-X: ${JSON.stringify(entry)}`;
    const loaded = normalizeState(parseYaml(writtenWith(anchor, 'holds', { 'KF-X': entry })));
    assert.deepEqual(loaded.holds['KF-X'], entry, label);
    assert.deepEqual(activeHolds(loaded), [], label);
    assert.deepEqual(validateState(loaded).problems.map((x) => x.code), ['HOLD_KEY_MISMATCH'], label);
    assert.doesNotMatch(renderHuman(statusOf(project(loaded, [anchor], repo()))), /^HOLD\b/m, label);
  }
  // A state that is not a mapping has no holds to read.
  for (const state of [undefined, null, 'text', 7, [], [{ holds: { 'KF-X': held } }]]) assert.deepEqual(activeHolds(state), [], JSON.stringify(state));

  // Referent: valid packet-keyed and legacy holds are read and rendered as before.
  const first = { active: true, packet_id: 'KF-A', reason: 'held first' };
  const released = { active: false, packet_id: 'KF-OFF', reason: 'released' };
  const legacy = { active: true, reason: 'legacy hold, no packet named' };
  const good = normalizeState(parseYaml(stringifyYaml(checkpoint(anchor, {}, { holds: { 'KF-X': held, 'KF-OFF': released, 'KF-A': first }, hold: legacy }))));
  assert.deepEqual(validateState(good).problems, []);
  assert.deepEqual(activeHolds(good), [first, held, legacy], 'keyed holds in packet order, then the legacy hold');
  const rec = project(good, [anchor], repo());
  assert.equal(rec.consistent, true, JSON.stringify(rec.findings));
  const decision = act(rec);
  assert.equal(decision.action, ACTIONS.WAIT_AUTHORITY);
  assert.deepEqual(decision.holds, [first, held, legacy]);
  const status = statusOf(rec);
  assert.deepEqual(status.hold, first);
  assert.deepEqual(status.holds, [first, held, legacy]);
  const text = renderHuman(status);
  assert.deepEqual(text.split('\n').filter((line) => /^HOLD\b|resume when/.test(line)), [
    'HOLD           : KF-A -- held first',
    'HOLD           : KF-X -- held by review',
    '  resume when : a typed RESUME',
    'HOLD           : legacy hold, no packet named',
  ]);
  // A legacy hold alone, and one switched off.
  assert.deepEqual(activeHolds({ ...emptyState(), hold: legacy }), [legacy]);
  assert.deepEqual(activeHolds({ ...emptyState(), hold: { ...legacy, active: false } }), []);
  assert.deepEqual(activeHolds(emptyState()), []);
});

test('an absent container still gets its default, and the checkpoint is as usable as before (018 K2)', () => {
  const anchor = authority('DIRECTIVE', 'CG-D', 'KF-META-P');
  const full = checkpoint(anchor);
  const legacy = structuredClone(full);
  for (const key of ['momentum', 'correction', 'agents', 'holds', 'hold', 'unresolved_contradictions', 'processed_event_keys', 'event_journal']) delete legacy[key];
  delete legacy.programme.checkpointed;
  const text = stringifyYaml(legacy);
  for (const key of ['momentum', 'correction', 'agents', 'holds', 'event_journal', 'checkpointed']) assert.doesNotMatch(text, new RegExp(`^\\s*${key}:`, 'm'), key);

  assert.deepEqual(shapeProblems(parseYaml(text)), []);
  const loaded = normalizeState(parseYaml(text));
  const defaults = emptyState();
  for (const key of ['momentum', 'correction', 'agents', 'holds', 'hold', 'unresolved_contradictions', 'processed_event_keys', 'event_journal']) {
    assert.deepEqual(loaded[key], defaults[key], key);
  }
  assert.deepEqual(loaded.programme.checkpointed, []);
  assert.equal(loaded.programme.active_packet, 'KF-META-P');
  assert.deepEqual(validateState(loaded).problems, []);
  const rec = project(loaded, [anchor], repo());
  assert.equal(rec.consistent, true, JSON.stringify(rec.findings));
  assert.equal(act(rec).action, ACTIONS.DISPATCH_BUILDER);

  // A document with no programme, and an empty one, are filled in whole, as before.
  const { programme: omitted, ...bare } = legacy;
  assert.deepEqual(normalizeState(parseYaml(stringifyYaml(bare))).programme, defaults.programme);
  assert.deepEqual(normalizeState(parseYaml('')), defaults);
  assert.deepEqual(normalizeState(undefined), defaults);
  assert.deepEqual(validateState(normalizeState(parseYaml(''))).problems, []);
  // Containers in their own types are copied, never shared with the document.
  const raw = parseYaml(stringifyYaml(full));
  const copy = normalizeState(raw);
  assert.deepEqual(copy, normalizeState(parseYaml(stringifyYaml(full))));
  for (const key of ['programme', 'momentum', 'correction', 'agents', 'holds', 'unresolved_contradictions', 'processed_event_keys', 'event_journal']) {
    assert.notEqual(copy[key], raw[key], key);
  }
  // The existing explicit checks are unchanged once the shape holds.
  for (const [name, mutate, code] of INVALID_CHECKPOINTS) {
    const bad = normalizeState(parseYaml(stringifyYaml(invalidCheckpoint(anchor, mutate))));
    assert.deepEqual(validateState(bad).problems.map((x) => x.code), [code], name);
  }
  assert.deepEqual(validateState(Object.assign(checkpoint(anchor), { authority_basis: [] })).problems.map((x) => x.code), ['AUTHORITY_BASIS_INVALID']);
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

/**
 * The checkpoint this packet first committed, anchored to its release directive
 * CG-DIRECTIVE-META-STATE-REDUCER-LIVE-001 (5963509515). It was re-derived under
 * CONTRACT-CORRECTION-008 (C8-F2) and is rebuilt here from the committed one.
 */
function previousCheckpoint() {
  const state = loadState(process.cwd());
  state.authority_basis = { message_id: 'CG-DIRECTIVE-META-STATE-REDUCER-LIVE-001', comment_id: 5963509515 };
  Object.assign(state.programme, { state: 'CHARACTERIZING', health: 'GREEN', pr_number: null });
  return state;
}

test('recorded evidence (reducer): the previous checkpoint folds the real typed CORRECTION-001 on real #80 and main 11053288, and stays held', () => {
  const recorded = JSON.parse(fs.readFileSync(RECORDED, 'utf8'));
  const state = previousCheckpoint();
  const auth = collectAuthority(recorded.comments);
  const anchor = auth.messages.find((m) => m.message_id === 'CG-DIRECTIVE-META-STATE-REDUCER-LIVE-001');
  assert.deepEqual(state.authority_basis, { message_id: anchor.message_id, comment_id: anchor.comment_id });

  // The PACKET_RELEASE the anchor directive would declare projects exactly that programme.
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

// ------------------------------------------------------------------ reviewed recovery past malformed authority (C8-F2)

const RECOVERY = 'scripts/agent-control/fixtures/reducer-recovery-truth.json';
const CORRECTION_004 = { message_id: 'CG-REVIEW-META-STATE-REDUCER-LIVE-CORRECTION-004', comment_id: 5964575594 };
const CONTRACT_008 = { message_id: 'CG-REVIEW-META-STATE-REDUCER-LIVE-CONTRACT-CORRECTION-008', comment_id: 5965390363 };
// The second reviewed recovery, past a malformed REVIEW for another packet:
// authorized by RECOVERY-REANCHOR-015 and anchored, as EXACT-BINDING-016 ruled, to 016.
const MEMORY_REVIEW = { message_id: 'CG-REVIEW-META-MEMORY-TRUTH-AUDIT-CORRECTION-001', comment_id: 5982337036 };
const ANCHOR_016 = { message_id: 'CG-REVIEW-META-STATE-REDUCER-LIVE-EXACT-BINDING-016', comment_id: 5982685256 };
// The third reviewed recovery, past a malformed second ruling for this packet:
// RECOVERY-021 authorized it and is itself the anchor.
const RULING_020 = { message_id: 'CG-REVIEW-META-STATE-REDUCER-LIVE-CONTRADICTION-RULING-020', comment_id: 5985754624 };
const ANCHOR_021 = { message_id: 'CG-REVIEW-META-STATE-REDUCER-LIVE-RECOVERY-021', comment_id: 5993146604 };
/** A time after every recorded comment, for authority the tests add. */
const AFTER_RECORDING = '2026-10-06T00:00:00Z';

/**
 * The checkpoint anchored to CONTRACT-CORRECTION-008, which RECOVERY-REANCHOR-015
 * replaced. Every REVIEW between the two anchors is a PACKET_CORRECTION that
 * projects the same programme, so only the anchor differs from the committed one.
 */
function checkpoint008() {
  const state = loadState(process.cwd());
  state.authority_basis = { ...CONTRACT_008 };
  return state;
}

/**
 * The checkpoint anchored to EXACT-BINDING-016, which RECOVERY-021 replaced.
 * Every valid REVIEW between the two anchors is a PACKET_CORRECTION of the
 * same packet or, for SEMANTIC-ACCEPT-019, a NO_STATE_CHANGE, so only the
 * anchor differs.
 */
function checkpoint016() {
  const state = loadState(process.cwd());
  state.authority_basis = { ...ANCHOR_016 };
  return state;
}

/** A ChatGPT authority comment newer than everything recorded. */
function laterAuthority(id, lines) {
  const at = AFTER_RECORDING;
  return {
    id, html_url: `https://github.com/SaCH-PRO/KEYFLOWOS/issues/80#issuecomment-${id}`, created_at: at, updated_at: at, user: { login: 'SaCH-PRO' },
    body: lines.join('\n'),
  };
}
const reducerEnvelope = (id, extra = []) => [
  `message_id: CG-REVIEW-LATER-${id}`, 'message_type: REVIEW', 'packet_id: KF-META-STATE-REDUCER-LIVE-001', 'sender: chatgpt',
  'source_main: 110532883411007787f62de35e0a951aa1c16cfa', 'implementation_branch: impl/kf-meta-state-reducer-live-001',
  'state: FIXING_PROOF_FAILURES', 'health: YELLOW', 'scope_changed: false', 'production_touched: false', 'pr_number: 120', ...extra,
];

/** Every authority candidate recorded after CONTRACT-CORRECTION-008, oldest first. */
const AFTER_008 = [
  'CG-REVIEW-META-STATE-REDUCER-LIVE-COPILOT-CORRECTION-010',
  'CG-REVIEW-META-STATE-REDUCER-LIVE-CONTRADICTION-RULING-011',
  'CG-REVIEW-META-STATE-REDUCER-LIVE-CONTRADICTION-RULING-012',
  MEMORY_REVIEW.message_id,
  'CG-REVIEW-META-STATE-REDUCER-LIVE-R12-SURGICAL-CORRECTION-013',
  'CG-REVIEW-META-STATE-REDUCER-LIVE-R13-ACTION-SHAPE-014',
  'CG-REVIEW-META-STATE-REDUCER-LIVE-RECOVERY-REANCHOR-015',
  ANCHOR_016.message_id,
];

/** Every authority candidate recorded after EXACT-BINDING-016, oldest first. */
const AFTER_016 = [
  'CG-REVIEW-META-STATE-REDUCER-LIVE-CHECKPOINT-VALIDATION-017',
  'CG-REVIEW-META-STATE-REDUCER-LIVE-CONVERGED-CORRECTIONS-018',
  'CG-REVIEW-META-STATE-REDUCER-LIVE-SEMANTIC-ACCEPT-019',
  'CG-REVIEW-META-STATE-REDUCER-LIVE-FINAL-CORRECTION-020',
  RULING_020.message_id,
  ANCHOR_021.message_id,
];

test('recorded evidence (recovery): the recording is complete, minimized, and holds all three real malformed messages', () => {
  const recorded = JSON.parse(fs.readFileSync(RECOVERY, 'utf8'));
  const ids = recorded.comments.map((c) => c.id);
  assert.equal(ids.length, 205);
  assert.equal(new Set(ids).size, 205);
  assert.deepEqual(ids, [...ids].sort((a, b) => a - b), 'in comment order');
  assert.equal(Math.min(...ids), 5963509515);
  assert.equal(ids.filter((id) => id <= CONTRACT_008.comment_id).length, 48, 'the first recording is intact');
  assert.equal(ids.filter((id) => id <= ANCHOR_016.comment_id).length, 105, 'the second recording is intact');
  assert.equal(Math.max(...ids), ANCHOR_021.comment_id);
  for (const c of recorded.comments) {
    const env = parseEnvelope(c.body);
    assert.equal(env.keys.reduce((n, key) => n + env.values[key].length, 0), c.body.split('\n').length, `comment ${c.id} is minimized`);
    assert.equal(c.updated_at, c.created_at, `comment ${c.id} is unedited`);
  }
  const auth = collectAuthority(recorded.comments);
  assert.equal(auth.verified, true, auth.reason);
  assert.deepEqual(auth.malformed.map((m) => [m.message_id, m.comment_id, m.problems]), [
    [CORRECTION_004.message_id, CORRECTION_004.comment_id, ['Required (repeated; ambiguous)']],
    [MEMORY_REVIEW.message_id, MEMORY_REVIEW.comment_id, ['Required (repeated; ambiguous)']],
    [RULING_020.message_id, RULING_020.comment_id, ['Reason (repeated; ambiguous)']],
  ]);
  assert.equal(auth.newest.message_id, ANCHOR_021.message_id);
});

test('recorded evidence (recovery): the previous checkpoint stops at the malformed CORRECTION-004 and skips nothing after it (C8-F2 1, 5)', () => {
  const recorded = JSON.parse(fs.readFileSync(RECOVERY, 'utf8'));
  const rec = reconcileProjection(previousCheckpoint(), collectAuthority(recorded.comments), recorded.repo, OPTIONS);
  assert.deepEqual(rec.reduction.applied.map((a) => a.message_id), [
    'CG-REVIEW-META-STATE-REDUCER-LIVE-CORRECTION-001',
    'CG-REVIEW-META-STATE-REDUCER-LIVE-CONTROL-ARTIFACTS-002',
    'CG-REVIEW-META-STATE-REDUCER-LIVE-CORRECTION-003',
  ]);
  assert.equal(rec.reduction.blocked.message_id, CORRECTION_004.message_id);
  assert.equal(rec.reduction.blocked.code, 'AUTHORITY_MALFORMED');
  // Every later message, valid and typed or not, stays unapplied: nothing is skipped.
  assert.deepEqual(rec.reduction.unapplied.map((m) => m.message_id), [
    CORRECTION_004.message_id,
    'CG-REVIEW-META-STATE-REDUCER-LIVE-BLOCKER-RULING-005',
    'CG-REVIEW-META-STATE-REDUCER-LIVE-HUMAN-GATES-CLEARED-006',
    'CG-REVIEW-META-STATE-REDUCER-LIVE-AUDIT-CORRECTION-006',
    'CG-REVIEW-META-STATE-REDUCER-LIVE-AUDIT-CORRECTION-007',
    CONTRACT_008.message_id,
    ...AFTER_008,
    ...AFTER_016,
  ]);
  assert.deepEqual(codes(rec), [FINDINGS.DERIVED_STATE_STALE_AUTHORITY, FINDINGS.AUTHORITY_MALFORMED]);
  assert.equal(act(rec).action, ACTIONS.REPORT_DRIFT);
});

test('recorded evidence (recovery): the CONTRACT-CORRECTION-008 checkpoint folds three typed corrections, then stops at the malformed memory REVIEW and skips nothing after it (R15)', () => {
  const recorded = JSON.parse(fs.readFileSync(RECOVERY, 'utf8'));
  const auth = collectAuthority(recorded.comments);
  const rec = reconcileProjection(checkpoint008(), auth, recorded.repo, OPTIONS);
  assert.deepEqual(rec.reduction.applied.map((a) => [a.message_id, a.effect]), AFTER_008.slice(0, 3).map((id) => [id, 'PACKET_CORRECTION']));
  assert.equal(rec.reduction.blocked.message_id, MEMORY_REVIEW.message_id);
  assert.equal(rec.reduction.blocked.code, 'AUTHORITY_MALFORMED');
  assert.equal(rec.reduction.blocked.coordinate, '2026-10-04T16:59:19Z#5982337036');
  // The typed, valid REVIEWs after it stay unapplied, both later anchors included.
  assert.deepEqual(rec.reduction.unapplied.map((m) => m.message_id), [...AFTER_008.slice(3), ...AFTER_016]);
  assert.deepEqual(codes(rec), [FINDINGS.DERIVED_STATE_STALE_AUTHORITY, FINDINGS.AUTHORITY_MALFORMED]);
  assert.equal(act(rec).action, ACTIONS.REPORT_DRIFT);
  // The malformed REVIEW names another packet; it projects nothing, and the hold is untouched.
  assert.equal(auth.malformed.find((m) => m.comment_id === MEMORY_REVIEW.comment_id).packet_id, 'KF-META-MEMORY-TRUTH-AUDIT-001');
  assert.equal(rec.effective_state.programme.active_packet, 'KF-META-STATE-REDUCER-LIVE-001');
  assert.deepEqual(activeHolds(rec.effective_state).map((h) => h.packet_id), ['KF-EXEC-ACTION-001']);
  // Referent: on the recording as it stood before the memory REVIEW, the same checkpoint reconciles.
  const before = collectAuthority(recorded.comments.filter((c) => c.id < MEMORY_REVIEW.comment_id));
  const clean = reconcileProjection(checkpoint008(), before, recorded.repo, OPTIONS);
  assert.equal(clean.consistent, true, JSON.stringify(clean.findings));
  assert.equal(clean.reduction.applied.length, 3);
});

test('recorded evidence (recovery): the EXACT-BINDING-016 checkpoint folds four typed effects, then stops at the malformed RULING-020 and skips nothing after it (R21)', () => {
  const recorded = JSON.parse(fs.readFileSync(RECOVERY, 'utf8'));
  const auth = collectAuthority(recorded.comments);
  const rec = reconcileProjection(checkpoint016(), auth, recorded.repo, OPTIONS);
  // FINAL-CORRECTION-020 is the valid ruling of that round and folds; the malformed one follows it.
  assert.deepEqual(rec.reduction.applied.map((a) => [a.message_id, a.effect]), [
    [AFTER_016[0], 'PACKET_CORRECTION'],
    [AFTER_016[1], 'PACKET_CORRECTION'],
    [AFTER_016[2], 'NO_STATE_CHANGE'],
    [AFTER_016[3], 'PACKET_CORRECTION'],
  ]);
  assert.equal(rec.reduction.blocked.message_id, RULING_020.message_id);
  assert.equal(rec.reduction.blocked.code, 'AUTHORITY_MALFORMED');
  assert.deepEqual(rec.reduction.blocked.detail, ['Reason (repeated; ambiguous)']);
  assert.equal(rec.reduction.blocked.coordinate, '2026-10-04T23:51:21Z#5985754624');
  // The typed, valid REVIEW after it, the new anchor, stays unapplied: a recovery is never a skip.
  assert.deepEqual(rec.reduction.unapplied.map((m) => m.message_id), AFTER_016.slice(4));
  assert.deepEqual(codes(rec), [FINDINGS.DERIVED_STATE_STALE_AUTHORITY, FINDINGS.AUTHORITY_MALFORMED]);
  assert.equal(act(rec).action, ACTIONS.REPORT_DRIFT);
  // The malformed ruling names this packet and still projects nothing: the hold and the packet are as before.
  assert.equal(auth.malformed.find((m) => m.comment_id === RULING_020.comment_id).packet_id, 'KF-META-STATE-REDUCER-LIVE-001');
  assert.equal(rec.effective_state.programme.active_packet, 'KF-META-STATE-REDUCER-LIVE-001');
  assert.equal(rec.effective_state.programme.merge_authority, false);
  assert.deepEqual(activeHolds(rec.effective_state).map((h) => h.packet_id), ['KF-EXEC-ACTION-001']);
  // Referent: on the recording as it stood before RULING-020, the same checkpoint reconciles.
  const before = collectAuthority(recorded.comments.filter((c) => c.id < RULING_020.comment_id));
  const clean = reconcileProjection(checkpoint016(), before, recorded.repo, OPTIONS);
  assert.equal(clean.consistent, true, JSON.stringify(clean.findings));
  assert.equal(clean.reduction.applied.length, 4);
});

test('recorded evidence (recovery): the committed checkpoint is re-derived at RECOVERY-021 and starts after all three malformed messages (C8-F2 2, R15, R16, R21)', () => {
  const recorded = JSON.parse(fs.readFileSync(RECOVERY, 'utf8'));
  const state = loadState(process.cwd());
  const auth = collectAuthority(recorded.comments);
  const anchor = auth.messages.find((m) => m.message_id === ANCHOR_021.message_id);
  assert.deepEqual(state.authority_basis, ANCHOR_021);
  assert.equal(anchor.comment_id, ANCHOR_021.comment_id);
  assert.equal(auth.newest.comment_id, ANCHOR_021.comment_id, 'the anchor is the newest recorded authority');
  assert.equal(auth.candidates.indexOf(anchor) + 1,
    AFTER_016.length + AFTER_008.length + auth.candidates.findIndex((m) => m.comment_id === CONTRACT_008.comment_id) + 1);
  // The re-derived programme is exactly what the previous checkpoints recorded: every
  // valid REVIEW between the anchors is a correction of the same packet on the same PR,
  // or changes no state.
  assert.deepEqual(state.programme, checkpoint008().programme);
  assert.deepEqual(state.programme, checkpoint016().programme);
  // Recorded for the live issue read whole; this recording starts later, so its positions differ
  // by the 63 candidates older than the release directive.
  assert.equal(state.derivation.anchor_generation, 87);
  assert.equal(auth.candidates.indexOf(anchor) + 1, 87 - 63);
  // The anchor's posted identity and ordering metadata, as GitHub returned them.
  assert.equal(anchor.created_at, '2026-10-05T11:02:59Z');
  assert.equal(new Date(state.derivation.anchor_created_at).toISOString(), '2026-10-05T11:02:59.000Z');

  // The anchor's own PACKET_CORRECTION projects exactly the committed programme.
  const read = readEffect(anchor);
  assert.equal(read.ok, true);
  assert.equal(read.effect, 'PACKET_CORRECTION');
  const p = state.programme;
  assert.deepEqual(
    { active_packet: p.active_packet, state: p.state, health: p.health, source_main: p.source_main, implementation_branch: p.implementation_branch, pr_number: p.pr_number, merge_authority: p.merge_authority },
    { active_packet: read.packet_id, state: 'FIXING_PROOF_FAILURES', health: read.health, source_main: read.source_main, implementation_branch: read.implementation_branch, pr_number: read.pr_number, merge_authority: false },
  );
  // Safety truth is preserved: 4/35, ACTION-001 held, the platform inactive, every flag false, no credit.
  assert.deepEqual(p.checkpointed, CHECKPOINTED_BEFORE);
  assert.deepEqual(activeHolds(state).map((h) => h.packet_id), ['KF-EXEC-ACTION-001']);
  assert.equal(state.platform_programme.status, 'INACTIVE_SUCCESSOR');
  assert.ok(Object.values(state.safety).filter((v) => typeof v === 'boolean').every((v) => v === false));
  assert.equal(p.production_touched, false);

  // The memory track is recorded as a parallel zero-credit track, never as programme state.
  assert.deepEqual(state.meta_package.parallel_tracks.map((t) => [t.packet_id, t.programme_credit, t.sequential_state_transition]),
    [['KF-META-MEMORY-TRUTH-AUDIT-001', 'ZERO', false]]);
  assert.equal(state.meta_package.in_flight, 'KF-META-STATE-REDUCER-LIVE-001');

  // From here the fold starts after all three malformed messages, which are evidence-only history.
  const rec = reconcileProjection(state, auth, recorded.repo, OPTIONS);
  assert.equal(rec.consistent, true, JSON.stringify(rec.findings));
  assert.equal(rec.reduction.blocked, null);
  assert.deepEqual(rec.reduction.applied, []);
  for (const older of [CORRECTION_004, MEMORY_REVIEW, RULING_020]) {
    const malformed = auth.malformed.find((m) => m.comment_id === older.comment_id);
    assert.ok(compareAuthorityOrder(malformed, anchor) < 0, `${older.message_id} is older than the new anchor`);
  }
  assert.equal(act(rec).action, ACTIONS.WAIT_AUTHORITY, 'ACTION-001 stays held');
});

test('recorded evidence (recovery): from the new checkpoint later typed authority folds, and later malformed authority still fails closed (C8-F2 3, 4, 5)', () => {
  const recorded = JSON.parse(fs.readFileSync(RECOVERY, 'utf8'));
  const state = loadState(process.cwd());
  const typedLater = laterAuthority(5966000001, reducerEnvelope(1, ['control_effect: PACKET_CORRECTION']));
  const advanced = reconcileProjection(state, collectAuthority([...recorded.comments, typedLater]), recorded.repo, OPTIONS);
  assert.equal(advanced.consistent, true, JSON.stringify(advanced.findings));
  assert.deepEqual(advanced.reduction.applied.map((a) => [a.message_id, a.effect]), [['CG-REVIEW-LATER-1', 'PACKET_CORRECTION']]);

  // A later message malformed the same way as CORRECTION-004 stops the fold and is never skipped,
  // even when valid typed authority follows it.
  const malformedLater = laterAuthority(5966000002, reducerEnvelope(2, ['control_effect: PACKET_CORRECTION', 'Required:', 'Required:']));
  const after = laterAuthority(5966000003, reducerEnvelope(3, ['control_effect: PACKET_CORRECTION']));
  const stopped = reconcileProjection(state, collectAuthority([...recorded.comments, typedLater, malformedLater, after]), recorded.repo, OPTIONS);
  assert.deepEqual(stopped.reduction.applied.map((a) => a.message_id), ['CG-REVIEW-LATER-1']);
  assert.equal(stopped.reduction.blocked.message_id, 'CG-REVIEW-LATER-2');
  assert.equal(stopped.reduction.blocked.code, 'AUTHORITY_MALFORMED');
  assert.deepEqual(stopped.reduction.unapplied.map((m) => m.message_id), ['CG-REVIEW-LATER-2', 'CG-REVIEW-LATER-3']);
  assert.deepEqual(codes(stopped), [FINDINGS.DERIVED_STATE_STALE_AUTHORITY, FINDINGS.AUTHORITY_MALFORMED]);
  assert.equal(act(stopped).action, ACTIONS.REPORT_DRIFT);
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
  const recorded = JSON.parse(fs.readFileSync(RECOVERY, 'utf8'));
  const state = loadState(process.cwd());
  const at = AFTER_RECORDING;
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

  const observed = run([...recorded.comments, msg(5966100001, 'REVIEW', 'KF-META-STATE-REDUCER-LIVE-001', 'NO_STATE_CHANGE')]);
  assert.equal(observed.reconciliation.consistent, true, 'an observed typed REVIEW no longer makes the projection stale');
  assert.equal(observed.reconciliation.effective_state.authority_basis.message_id, 'REVIEW-5966100001');
  assert.deepEqual(observed.reconciliation.reduction.applied.map((a) => a.effect), ['NO_STATE_CHANGE']);

  // With ACTION-001 explicitly released and a test builder available, the
  // in-flight packet reaches DISPATCH_BUILDER. Readiness comes from the stub
  // seam, never from the host or the runner (CORRECTION-003 F2).
  const resumeMsg = msg(5966100002, 'RESUME', 'KF-EXEC-ACTION-001', 'HOLD_CLEAR');
  const resume = withBuilder(true, (env) => run([...recorded.comments, resumeMsg], env));
  assert.equal(resume.reconciliation.consistent, true);
  assert.equal(resume.reconciliation.effective_state.holds['KF-EXEC-ACTION-001'].active, false);
  assert.equal(resume.decision.action, ACTIONS.DISPATCH_BUILDER);
  assert.equal(resume.decision.packet_id, 'KF-META-STATE-REDUCER-LIVE-001');

  // A subsequent typed HOLD_SET still wins, with the same builder available.
  const reheld = withBuilder(true, (env) => run([...recorded.comments, resumeMsg, msg(5966100004, 'HOLD', 'KF-EXEC-ACTION-001', 'HOLD_SET')], env));
  assert.equal(reheld.reconciliation.consistent, true);
  assert.equal(reheld.reconciliation.effective_state.holds['KF-EXEC-ACTION-001'].active, true);
  assert.equal(reheld.decision.action, ACTIONS.WAIT_AUTHORITY);

  // Referent: the same release with no builder available waits for one, so the
  // dispatch above is the seam's doing, not the host's.
  const noBuilder = withBuilder(false, (env) => run([...recorded.comments, resumeMsg], env));
  assert.equal(noBuilder.decision.action, ACTIONS.WAIT_EXTERNAL_AGENT);
  assert.equal(noBuilder.decision.role, ROLES.BUILDER);

  const untyped = run([...recorded.comments, { ...msg(5966100003, 'REVIEW', 'KF-META-STATE-REDUCER-LIVE-001', 'NO_STATE_CHANGE'), body: msg(5966100003, 'REVIEW', 'KF-META-STATE-REDUCER-LIVE-001', 'X').body.replace('control_effect: X\n', '') }]);
  assert.equal(untyped.decision.action, ACTIONS.REPORT_DRIFT);
  assert.deepEqual(untyped.reconciliation.findings.map((f) => f.code), [FINDINGS.DERIVED_STATE_STALE_AUTHORITY]);

  // The fold is never written back: the committed checkpoint is unchanged.
  assert.deepEqual(loadState(process.cwd()), state);
});

/**
 * The autopilot's two steps for one delivered #80 comment, as the workflow runs
 * them: normalize-event.mjs on the event payload, then orchestrate.mjs on the
 * same payload with #80 read from a snapshot that contains the comment.
 */
function wake(comment, snapshot, extraEnv = {}, action = 'created') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-wake-'));
  try {
    const eventFile = path.join(dir, 'event.json');
    const truthFile = path.join(dir, 'truth.json');
    fs.writeFileSync(eventFile, JSON.stringify({ action, issue: { number: 80 }, comment }));
    fs.writeFileSync(truthFile, JSON.stringify(snapshot));
    const env = { ...process.env, ...extraEnv, GITHUB_EVENT_NAME: 'issue_comment', GITHUB_EVENT_PATH: eventFile };
    delete env.GITHUB_RUN_ID;
    for (const [key, value] of Object.entries(extraEnv)) if (value === undefined) delete env[key];
    const normalized = spawnSync(process.execPath, ['scripts/agent-control/normalize-event.mjs'], { encoding: 'utf8', env });
    assert.equal(normalized.status, 0, normalized.stderr);
    const decided = spawnSync(process.execPath, ['scripts/agent-control/orchestrate.mjs', '--json', '--truth-file', truthFile], { encoding: 'utf8', env });
    assert.equal(decided.status, 0, decided.stderr);
    return { event: JSON.parse(normalized.stdout), out: JSON.parse(decided.stdout) };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('wake path end to end: a typed RESUME and a typed HOLD each wake, and the fold reads HOLD_CLEAR and HOLD_SET from the comment that woke', () => {
  const recorded = JSON.parse(fs.readFileSync(RECOVERY, 'utf8'));
  const state = loadState(process.cwd());
  const at = AFTER_RECORDING;
  const msg = (id, type, effect, lines = [`control_effect: ${effect}`]) => ({
    id, html_url: `https://github.com/SaCH-PRO/KEYFLOWOS/issues/80#issuecomment-${id}`, created_at: at, updated_at: at, user: { login: 'SaCH-PRO' },
    body: ['```yaml', `message_id: ${type}-${id}`, `message_type: ${type}`, 'packet_id: KF-EXEC-ACTION-001', 'sender: chatgpt',
      `source_main: ${state.programme.source_main}`, `implementation_branch: ${state.programme.implementation_branch}`, 'state: HELD',
      'health: GREEN', 'scope_changed: false', 'production_touched: false', ...lines, '```'].join('\n'),
  });
  const applied = (out) => out.reconciliation.reduction.applied.map((a) => a.effect);

  // RESUME: the comment wakes, and the decision made in that wake has the hold released.
  const resumeMsg = msg(5982400001, 'RESUME', 'HOLD_CLEAR');
  const resume = withBuilder(true, (env) => wake(resumeMsg, { comments: [...recorded.comments, resumeMsg], repo: recorded.repo }, env));
  assert.equal(resume.event.actionable, true, resume.event.wake_refused);
  assert.equal(resume.event.kind, 'RESUME');
  assert.equal(resume.event.control_effect, 'HOLD_CLEAR');
  assert.deepEqual(resume.out.event, { kind: 'RESUME', key: 'issue_comment:5982400001:created', actionable: true });
  assert.deepEqual(applied(resume.out), ['HOLD_CLEAR']);
  assert.equal(resume.out.reconciliation.effective_state.authority_basis.comment_id, 5982400001);
  assert.equal(resume.out.reconciliation.effective_state.holds['KF-EXEC-ACTION-001'].active, false);
  assert.equal(resume.out.decision.action, ACTIONS.DISPATCH_BUILDER);

  // HOLD: the comment wakes, and the decision made in that wake has the hold set again.
  const holdMsg = msg(5982400002, 'HOLD', 'HOLD_SET');
  const hold = withBuilder(true, (env) => wake(holdMsg, { comments: [...recorded.comments, resumeMsg, holdMsg], repo: recorded.repo }, env));
  assert.equal(hold.event.actionable, true, hold.event.wake_refused);
  assert.equal(hold.event.kind, 'HOLD');
  assert.equal(hold.event.control_effect, 'HOLD_SET');
  assert.deepEqual(hold.out.event, { kind: 'HOLD', key: 'issue_comment:5982400002:created', actionable: true });
  assert.deepEqual(applied(hold.out), ['HOLD_CLEAR', 'HOLD_SET']);
  assert.equal(hold.out.reconciliation.effective_state.holds['KF-EXEC-ACTION-001'].active, true);
  assert.equal(hold.out.reconciliation.effective_state.holds['KF-EXEC-ACTION-001'].hold_message_id, 'HOLD-5982400002');
  assert.equal(hold.out.decision.action, ACTIONS.WAIT_AUTHORITY);

  // NC: an untyped RESUME is valid authority and wakes nothing; read by any
  // later wake, it stops the fold and the hold stays.
  const untyped = msg(5982400003, 'RESUME', null, []);
  const stale = withBuilder(true, (env) => wake(untyped, { comments: [...recorded.comments, untyped], repo: recorded.repo }, env));
  assert.equal(stale.event.actionable, false);
  assert.equal(stale.event.kind, 'RESUME');
  assert.match(stale.event.wake_refused, /CONTROL_EFFECT_MISSING/);
  assert.equal(stale.out.event.actionable, false);
  assert.equal(stale.out.decision.action, ACTIONS.REPORT_DRIFT);
  assert.equal(stale.out.reconciliation.effective_state.holds['KF-EXEC-ACTION-001'].active, true);

  // NC: the same typed RESUME delivered as an edit wakes nothing.
  const edited = withBuilder(true, (env) => wake(resumeMsg, { comments: [...recorded.comments, resumeMsg], repo: recorded.repo }, env, 'edited'));
  assert.equal(edited.event.actionable, false);
  assert.match(edited.event.wake_refused, /only a created comment wakes/);

  assert.deepEqual(loadState(process.cwd()), state);
});

test('CLI end to end: status --verify renders the effective projection and how it was reached', () => {
  const src = fs.readFileSync('scripts/agent-control/status.mjs', 'utf8');
  assert.match(src, /reconcileWithTruth\(checkpoint\)/);
  assert.match(src, /reconciliation \? reconciliation\.effective_state : checkpoint/);
});

test('CLI end to end: an invalid checkpoint on disk is reported as drift by orchestrate and by the status rendering (017)', () => {
  const recorded = JSON.parse(fs.readFileSync(RECOVERY, 'utf8'));
  const committed = loadState(process.cwd());
  const script = path.resolve('scripts/agent-control/orchestrate.mjs');
  // A repository root holding only what the CLI reads: the checkpoint and the programme DAG.
  const run = (state) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-checkpoint-'));
    try {
      for (const file of [STATE_PATH, DAG_PATH]) fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      // Written as text, not through saveState(), which would refuse it.
      fs.writeFileSync(path.join(root, STATE_PATH), stringifyYaml(state));
      fs.copyFileSync(DAG_PATH, path.join(root, DAG_PATH));
      const truth = path.join(root, 'truth.json');
      fs.writeFileSync(truth, JSON.stringify({ comments: recorded.comments, repo: recorded.repo }));
      const env = { ...process.env, KEYFLOW_AGENT_CLAUDE_DISABLED: '1' };
      delete env.GITHUB_EVENT_NAME;
      delete env.GITHUB_EVENT_PATH;
      const res = spawnSync(process.execPath, [script, '--json', '--truth-file', truth], { encoding: 'utf8', env, cwd: root });
      assert.equal(res.status, 0, res.stderr);
      return { out: JSON.parse(res.stdout), reloaded: loadState(root) };
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  };

  const bad = run(Object.assign(structuredClone(committed), { programme: { ...committed.programme, health: 'AMBER' } }));
  assert.equal(bad.reloaded.programme.health, 'AMBER', 'loadState() reads the checkpoint as written');
  assert.equal(bad.out.reconciliation.consistent, false);
  assert.deepEqual(bad.out.reconciliation.findings.map((f) => f.code), [FINDINGS.DERIVED_STATE_INVALID]);
  assert.deepEqual(bad.out.reconciliation.findings[0].detail.problems, [{ code: 'UNKNOWN_HEALTH', detail: 'programme.health=AMBER' }]);
  assert.equal(bad.out.reconciliation.reduction.reason, FOLD_NOT_STARTED.CHECKPOINT_INVALID);
  assert.equal(bad.out.decision.action, ACTIONS.REPORT_DRIFT);
  assert.equal(bad.out.decision.advancement, 'NONE');

  // What `status --verify` prints for that verdict.
  const text = renderHuman(buildStatus(process.cwd(), { state: bad.out.reconciliation.effective_state, dag: DAG, registry: [], reconciliation: bad.out.reconciliation }));
  assert.match(text, /Reconciliation : DRIFT/);
  assert.match(text, /DERIVED_STATE_INVALID .*"code":"UNKNOWN_HEALTH","detail":"programme\.health=AMBER"/);
  assert.doesNotMatch(text, /CONSISTENT/);

  // Referent: the committed checkpoint in the same kind of root reconciles and waits on the hold.
  const good = run(committed);
  assert.deepEqual(good.reloaded, committed);
  assert.equal(good.out.reconciliation.consistent, true, JSON.stringify(good.out.reconciliation.findings));
  assert.equal(good.out.decision.action, ACTIONS.WAIT_AUTHORITY);
});

test('CLI end to end: a checkpoint on disk with a wrong-type container is drift for orchestrate, with or without an event, and for the status rendering (018 K2)', () => {
  const recorded = JSON.parse(fs.readFileSync(RECOVERY, 'utf8'));
  const committedText = fs.readFileSync(STATE_PATH, 'utf8').replace(/\r\n/g, '\n');
  const script = path.resolve('scripts/agent-control/orchestrate.mjs');
  // One line of the committed document replaced; everything else is the reviewed checkpoint.
  const rewritten = (pattern, replacement) => {
    assert.match(committedText, pattern);
    return committedText.replace(pattern, replacement);
  };
  const run = (text, event = null) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-shape-'));
    try {
      for (const file of [STATE_PATH, DAG_PATH]) fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(path.join(root, STATE_PATH), text);
      fs.copyFileSync(DAG_PATH, path.join(root, DAG_PATH));
      const truth = path.join(root, 'truth.json');
      fs.writeFileSync(truth, JSON.stringify({ comments: recorded.comments, repo: recorded.repo }));
      const env = { ...process.env, KEYFLOW_AGENT_CLAUDE_DISABLED: '1' };
      delete env.GITHUB_EVENT_NAME;
      delete env.GITHUB_EVENT_PATH;
      delete env.GITHUB_RUN_ID;
      if (event) {
        const eventFile = path.join(root, 'event.json');
        fs.writeFileSync(eventFile, JSON.stringify(event));
        Object.assign(env, { GITHUB_EVENT_NAME: 'schedule', GITHUB_EVENT_PATH: eventFile });
      }
      const res = spawnSync(process.execPath, [script, '--json', '--truth-file', truth], { encoding: 'utf8', env, cwd: root });
      assert.equal(res.status, 0, res.stderr);
      return { out: JSON.parse(res.stdout), reloaded: loadState(root), text: fs.readFileSync(path.join(root, STATE_PATH), 'utf8') };
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  };

  const cases = [
    // The committed checkpoint holds ACTION-001 in `holds`. Read as `{}`, an empty list would release it.
    ['holds: []', rewritten(/^holds:\n(?: .*\n|\n)*?(?=^\S)/m, 'holds: []\n\n'), 'holds must be a mapping when present, found list'],
    ['processed_event_keys: {}', rewritten(/^processed_event_keys: \[\]$/m, 'processed_event_keys: {}'), 'processed_event_keys must be a list when present, found mapping'],
    ['event_journal: null', rewritten(/^event_journal: \[\]$/m, 'event_journal: null'), 'event_journal must be a list when present, found null'],
  ];
  for (const [name, text, detail] of cases) {
    for (const event of [null, { schedule_time: '2026-10-04T22:00:00Z' }]) {
      const label = `${name}${event ? ', with an event' : ''}`;
      const bad = run(text, event);
      assert.equal(bad.text, text, `${label}: the document is not rewritten`);
      assert.equal(bad.out.duplicate, false, label);
      assert.equal(bad.out.reconciliation.consistent, false, label);
      assert.deepEqual(bad.out.reconciliation.findings.map((f) => f.code), [FINDINGS.DERIVED_STATE_INVALID], label);
      assert.deepEqual(bad.out.reconciliation.findings[0].detail.problems, [{ code: SHAPE_INVALID, detail }], label);
      assert.equal(bad.out.reconciliation.reduction.reason, FOLD_NOT_STARTED.CHECKPOINT_INVALID, label);
      assert.equal(bad.out.decision.action, ACTIONS.REPORT_DRIFT, label);
      assert.equal(bad.out.decision.advancement, 'NONE', label);

      const rendered = renderHuman(buildStatus(process.cwd(), { state: bad.out.reconciliation.effective_state, dag: DAG, registry: [], reconciliation: bad.out.reconciliation }));
      assert.match(rendered, /Reconciliation : DRIFT/, label);
      assert.ok(rendered.includes(`DERIVED_STATE_INVALID`) && rendered.includes(detail), label);
      assert.doesNotMatch(rendered, /CONSISTENT/, label);
    }
  }
  assert.deepEqual(run(cases[0][1]).reloaded.holds, [], 'loadState() reads the list as written');

  // Referent: the committed document in the same kind of root reconciles and waits on the hold.
  const good = run(committedText, { schedule_time: '2026-10-04T22:00:00Z' });
  assert.equal(good.out.reconciliation.consistent, true, JSON.stringify(good.out.reconciliation.findings));
  assert.equal(good.out.decision.action, ACTIONS.WAIT_AUTHORITY);
});

test('CLI end to end: --apply on an invalid checkpoint journals nothing, writes nothing and still reports the drift (020 K1)', () => {
  // Copilot r4179736619: with `processed_event_keys: {}` or `event_journal: null`
  // the journal step threw a TypeError, and with any other invalid checkpoint
  // saveState() threw, so --apply exited 2 and printed no decision.
  const recorded = JSON.parse(fs.readFileSync(RECOVERY, 'utf8'));
  const committedText = fs.readFileSync(STATE_PATH, 'utf8').replace(/\r\n/g, '\n');
  const script = path.resolve('scripts/agent-control/orchestrate.mjs');
  const rewritten = (pattern, replacement) => {
    assert.match(committedText, pattern);
    return committedText.replace(pattern, replacement);
  };
  // A repository root holding the checkpoint, the programme DAG and one schedule event.
  const inRoot = (text, fn) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-apply-'));
    try {
      for (const file of [STATE_PATH, DAG_PATH]) fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(path.join(root, STATE_PATH), text);
      fs.copyFileSync(DAG_PATH, path.join(root, DAG_PATH));
      const truth = path.join(root, 'truth.json');
      fs.writeFileSync(truth, JSON.stringify({ comments: recorded.comments, repo: recorded.repo }));
      const eventFile = path.join(root, 'event.json');
      fs.writeFileSync(eventFile, JSON.stringify({ schedule_time: '2026-10-04T22:00:00Z' }));
      const env = { ...process.env, KEYFLOW_AGENT_CLAUDE_DISABLED: '1', GITHUB_EVENT_NAME: 'schedule', GITHUB_EVENT_PATH: eventFile };
      delete env.GITHUB_RUN_ID;
      const invoke = (...flags) => {
        const res = spawnSync(process.execPath, [script, ...flags, '--truth-file', truth], { encoding: 'utf8', env, cwd: root });
        return { status: res.status, stdout: res.stdout, stderr: res.stderr, text: fs.readFileSync(path.join(root, STATE_PATH), 'utf8') };
      };
      const files = () => fs.readdirSync(root, { recursive: true }).map(String).sort();
      return fn(invoke, files);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  };
  const shape = (detail) => [{ code: SHAPE_INVALID, detail }];

  const invalid = [
    ['processed_event_keys: {}', rewritten(/^processed_event_keys: \[\]$/m, 'processed_event_keys: {}'), shape('processed_event_keys must be a list when present, found mapping')],
    ['event_journal: null', rewritten(/^event_journal: \[\]$/m, 'event_journal: null'), shape('event_journal must be a list when present, found null')],
    ['holds: []', rewritten(/^holds:\n(?: .*\n|\n)*?(?=^\S)/m, 'holds: []\n\n'), shape('holds must be a mapping when present, found list')],
    ['health: AMBER', rewritten(/^ {2}health: YELLOW$/m, '  health: AMBER'), [{ code: 'UNKNOWN_HEALTH', detail: 'programme.health=AMBER' }]],
  ];
  for (const [label, text, problems] of invalid) {
    inRoot(text, (invoke, files) => {
      const before = files();
      // Referent: without --apply this checkpoint is reported as drift and the run exits 0.
      const plain = invoke('--json');
      assert.equal(plain.status, 0, `${label}: ${plain.stderr}`);
      const dry = JSON.parse(plain.stdout);
      assert.equal(dry.decision.action, ACTIONS.REPORT_DRIFT, label);
      assert.ok(!('applied' in dry) && !('apply_refused' in dry), label);

      const applied = invoke('--json', '--apply');
      assert.equal(applied.status, 0, `${label}: ${applied.stderr}`);
      assert.equal(applied.stderr, '', label);
      const out = JSON.parse(applied.stdout);
      // The journal step was reached: an actionable event that is not a duplicate.
      assert.deepEqual([out.event.actionable, out.duplicate], [true, false], label);
      assert.equal(out.applied, false, label);
      assert.deepEqual(out.apply_refused, { code: FOLD_NOT_STARTED.CHECKPOINT_INVALID, problems }, label);
      // The result is the one the run without --apply gives.
      assert.equal(out.decision.action, ACTIONS.REPORT_DRIFT, label);
      assert.equal(out.decision.advancement, 'NONE', label);
      assert.deepEqual(out.reconciliation.findings.map((f) => f.code), [FINDINGS.DERIVED_STATE_INVALID], label);
      assert.deepEqual(out.reconciliation.findings[0].detail.problems, problems, label);
      assert.deepEqual(out.decision, dry.decision, label);
      assert.deepEqual(out.reconciliation, dry.reconciliation, label);
      // Nothing is written: the checkpoint is byte-identical and no file appears.
      assert.equal(applied.text, text, `${label}: the document is not rewritten`);
      assert.deepEqual(files(), before, label);

      // The plain form prints the same decision and says why nothing was journaled.
      const human = invoke('--apply');
      assert.equal(human.status, 0, `${label}: ${human.stderr}`);
      assert.equal(human.stderr, '', label);
      assert.match(human.stdout, /^ACTION : REPORT_DRIFT$/m, label);
      assert.match(human.stdout, /^DRIFT {2}: DERIVED_STATE_INVALID /m, label);
      assert.ok(human.stdout.includes(`APPLY  : refused, nothing journaled or written: CHECKPOINT_INVALID ${JSON.stringify(problems)}\n`), label);
      assert.equal(human.text, text, `${label}: the document is not rewritten`);
      assert.deepEqual(files(), before, label);
    });
  }

  // Referent: the committed checkpoint with the same event and --apply journals it, exactly once.
  inRoot(committedText, (invoke, files) => {
    const before = files();
    const first = invoke('--json', '--apply');
    assert.equal(first.status, 0, first.stderr);
    const out = JSON.parse(first.stdout);
    assert.equal(out.reconciliation.consistent, true, JSON.stringify(out.reconciliation.findings));
    assert.equal(out.decision.action, ACTIONS.WAIT_AUTHORITY);
    assert.equal(out.applied, true);
    assert.ok(!('apply_refused' in out));
    assert.notEqual(first.text, committedText);
    const saved = normalizeState(parseYaml(first.text));
    assert.deepEqual(validateState(saved).problems, []);
    assert.deepEqual(saved.processed_event_keys, [out.event.key]);
    assert.equal(saved.last_processed_event_key, out.event.key);
    assert.deepEqual(saved.event_journal.map((entry) => [entry.key, entry.action, entry.rule]), [[out.event.key, ACTIONS.WAIT_AUTHORITY, 'AUTO-ORCHESTRATOR']]);
    assert.equal(saved.next_legal_action.action, ACTIONS.WAIT_AUTHORITY);
    assert.deepEqual(files(), before, 'only the checkpoint is written');

    const second = invoke('--json', '--apply');
    assert.equal(second.status, 0, second.stderr);
    const again = JSON.parse(second.stdout);
    assert.equal(again.duplicate, true);
    assert.equal(again.decision.action, ACTIONS.DUPLICATE_EVENT);
    assert.ok(!('applied' in again) && !('apply_refused' in again));
    assert.equal(second.text, first.text, 'the same event is not journaled a second time');
  });
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
