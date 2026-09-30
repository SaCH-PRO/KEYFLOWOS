import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateControlEffect,
  authorityGeneration,
  checkpointObservedGeneration,
  reduceAuthorityFromCheckpoint,
} from '../lib/control-effects.mjs';

const checkpoint = () => ({
  authority_basis: { message_id: 'CG-ANCHOR', comment_id: 1 },
  programme: {
    active_packet: 'KF-OLD',
    state: 'CHECKPOINTED',
    health: 'GREEN',
    implementation_branch: 'impl/old',
    checkpointed: ['KF-OLD'],
    merge_authority: false,
  },
  hold: null,
  platform_programme: { programme: 'KEYFLOWOS_PLATFORM_CONVERGENCE', status: 'INACTIVE_SUCCESSOR', activation_authorized: false },
});

const msg = (id, effect, over = {}) => ({
  message_id: id,
  message_type: 'REVIEW',
  packet_id: 'KF-NEW',
  comment_id: over.comment_id ?? 2,
  control_effect: effect,
  state: over.state ?? 'FIXING_PROOF_FAILURES',
  health: over.health ?? 'YELLOW',
  implementation_branch: over.implementation_branch ?? 'impl/new',
  ...over,
});

const authority = (...messages) => ({
  messages: [
    { message_id: 'CG-ANCHOR', message_type: 'DIRECTIVE', packet_id: 'KF-OLD', comment_id: 1 },
    ...messages,
  ],
});

test('generation and observed generation are deterministic from authority order', () => {
  const a = authority(msg('CG-1', 'NO_STATE_CHANGE'), msg('CG-2', 'NO_STATE_CHANGE', { comment_id: 3 }));
  assert.equal(authorityGeneration(a), 3);
  assert.equal(checkpointObservedGeneration(checkpoint(), a), 1);
});

test('legacy/untyped newer authority fails closed rather than being inferred from prose', () => {
  const a = authority({ message_id: 'CG-LEGACY', message_type: 'REVIEW', packet_id: 'KF-NEW', comment_id: 2 });
  const out = reduceAuthorityFromCheckpoint(checkpoint(), a);
  assert.equal(out.ok, false);
  assert.equal(out.code, 'CONTROL_EFFECT_MISSING');
  assert.equal(out.blocked_message_id, 'CG-LEGACY');
});

test('NO_STATE_CHANGE advances observed generation without mutating programme state', () => {
  const before = checkpoint();
  const out = reduceAuthorityFromCheckpoint(before, authority(msg('CG-OBSERVE', 'NO_STATE_CHANGE')));
  assert.equal(out.ok, true);
  assert.equal(out.generation, 2);
  assert.equal(out.observed_generation, 2);
  assert.deepEqual(out.state.programme, before.programme);
});

test('PACKET_CORRECTION projects explicit packet state but never grants merge authority', () => {
  const out = reduceAuthorityFromCheckpoint(checkpoint(), authority(msg('CG-FIX', 'PACKET_CORRECTION')));
  assert.equal(out.ok, true);
  assert.equal(out.state.programme.active_packet, 'KF-NEW');
  assert.equal(out.state.programme.state, 'FIXING_PROOF_FAILURES');
  assert.equal(out.state.programme.health, 'YELLOW');
  assert.equal(out.state.programme.merge_authority, false);
});

test('HOLD_SET and HOLD_CLEAR are explicit and packet-bound', () => {
  const set = msg('CG-HOLD', 'HOLD_SET', { message_type: 'DIRECTIVE', control_reason: 'proof failed' });
  const clear = msg('CG-RESUME', 'HOLD_CLEAR', { message_type: 'RESUME', comment_id: 3 });
  const out = reduceAuthorityFromCheckpoint(checkpoint(), authority(set, clear));
  assert.equal(out.ok, true);
  assert.equal(out.state.hold.active, false);
  assert.equal(out.state.hold.released_by, 'CG-RESUME');

  const mismatch = reduceAuthorityFromCheckpoint(checkpoint(), authority(clear));
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.code, 'CONTROL_EFFECT_HOLD_MISMATCH');
});

test('HOLD_CLEAR requires an explicit RESUME message', () => {
  const v = validateControlEffect(msg('CG-BAD', 'HOLD_CLEAR', { message_type: 'REVIEW' }));
  assert.equal(v.ok, false);
  assert.equal(v.code, 'CONTROL_EFFECT_RESUME_REQUIRED');
});

test('CHECKPOINT is idempotent and preserves application credit uniqueness', () => {
  const one = msg('CG-CHECK', 'CHECKPOINT', { state: 'CHECKPOINTED', health: 'GREEN' });
  const two = msg('CG-CHECK-2', 'CHECKPOINT', { state: 'CHECKPOINTED', health: 'GREEN', comment_id: 3 });
  const out = reduceAuthorityFromCheckpoint(checkpoint(), authority(one, two));
  assert.equal(out.ok, true);
  assert.deepEqual(out.state.programme.checkpointed, ['KF-OLD', 'KF-NEW']);
});

test('programme activation is explicit and cannot be expressed without programme identity', () => {
  assert.equal(
    validateControlEffect(msg('CG-ACT', 'PROGRAMME_ACTIVATE', { programme: null })).code,
    'CONTROL_EFFECT_PROGRAMME_MISSING',
  );
  const out = reduceAuthorityFromCheckpoint(
    checkpoint(),
    authority(msg('CG-ACT', 'PROGRAMME_ACTIVATE', { programme: 'KEYFLOWOS_PLATFORM_CONVERGENCE' })),
  );
  assert.equal(out.ok, true);
  assert.equal(out.state.platform_programme.status, 'ACTIVE');
  assert.equal(out.state.platform_programme.activation_authorized, true);
});

test('unknown effects fail closed', () => {
  const out = reduceAuthorityFromCheckpoint(checkpoint(), authority(msg('CG-X', 'DO_MAGIC')));
  assert.equal(out.ok, false);
  assert.equal(out.code, 'CONTROL_EFFECT_UNKNOWN');
});
