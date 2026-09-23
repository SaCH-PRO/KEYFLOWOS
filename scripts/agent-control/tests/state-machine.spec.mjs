import test from 'node:test';
import assert from 'node:assert/strict';
import { canTransition, assertTransition, legalNext, STATES, TransitionError } from '../lib/state-machine.mjs';

test('the declared eight states are exactly the standard states', () => {
  assert.deepEqual(STATES, [
    'CHARACTERIZING',
    'IMPLEMENTING',
    'PROVING',
    'FIXING_PROOF_FAILURES',
    'READY_TO_MERGE',
    'MERGED',
    'CHECKPOINTED',
    'BLOCKED',
  ]);
});

test('the ordinary forward path is legal end to end', () => {
  const path = [
    ['CHARACTERIZING', 'IMPLEMENTING', {}],
    ['IMPLEMENTING', 'PROVING', {}],
    ['PROVING', 'READY_TO_MERGE', { authority_marker: 'CG-REVIEW-X' }],
    ['READY_TO_MERGE', 'MERGED', { authority_marker: 'CG-REVIEW-X' }],
    ['MERGED', 'CHECKPOINTED', { authority_marker: 'post-merge-verified' }],
  ];
  for (const [from, to, ctx] of path) {
    assert.equal(canTransition(from, to, ctx).ok, true, `${from} -> ${to} should be legal`);
  }
});

test('proof failures route back through FIXING and re-PROVING', () => {
  assert.equal(canTransition('PROVING', 'FIXING_PROOF_FAILURES').ok, true);
  assert.equal(canTransition('FIXING_PROOF_FAILURES', 'PROVING').ok, true);
});

// ------------------------------------------------------------ FAIL CLOSED

test('ILLEGAL: characterizing cannot jump straight to merge readiness', () => {
  const v = canTransition('CHARACTERIZING', 'READY_TO_MERGE');
  assert.equal(v.ok, false);
  assert.equal(v.code, 'ILLEGAL_TRANSITION');
});

test('ILLEGAL: a packet cannot skip from IMPLEMENTING to MERGED', () => {
  assert.equal(canTransition('IMPLEMENTING', 'MERGED').code, 'ILLEGAL_TRANSITION');
});

test('ILLEGAL: CHECKPOINTED is terminal', () => {
  assert.equal(canTransition('CHECKPOINTED', 'IMPLEMENTING').code, 'TERMINAL_STATE');
  assert.deepEqual(legalNext('CHECKPOINTED'), []);
});

test('ILLEGAL: an unknown state is rejected, never waved through', () => {
  assert.equal(canTransition('DEFINITELY_NOT_A_STATE', 'MERGED').code, 'UNKNOWN_FROM_STATE');
  assert.equal(canTransition('PROVING', 'SHIPPED').code, 'UNKNOWN_TO_STATE');
});

test('ILLEGAL: re-entering the same state is not a transition', () => {
  assert.equal(canTransition('PROVING', 'PROVING').code, 'NO_OP_TRANSITION');
});

// ------------------------------------------------------------ AUTHORITY

test('merge and checkpoint require a recorded authority marker', () => {
  assert.equal(canTransition('READY_TO_MERGE', 'MERGED').code, 'AUTHORITY_REQUIRED');
  assert.equal(canTransition('MERGED', 'CHECKPOINTED').code, 'AUTHORITY_REQUIRED');
  assert.equal(canTransition('PROVING', 'READY_TO_MERGE').code, 'AUTHORITY_REQUIRED');
  assert.equal(canTransition('READY_TO_MERGE', 'MERGED', { authority_marker: 'x' }).ok, true);
});

test('an unresolved contradiction blocks every advance except BLOCKED', () => {
  const ctx = { unresolved_contradictions: ['META-C1'], authority_marker: 'x' };
  assert.equal(canTransition('IMPLEMENTING', 'PROVING', ctx).code, 'UNRESOLVED_CONTRADICTION');
  assert.equal(canTransition('READY_TO_MERGE', 'MERGED', ctx).code, 'UNRESOLVED_CONTRADICTION');
  assert.equal(canTransition('IMPLEMENTING', 'BLOCKED', { ...ctx, reason: 'contradiction' }).ok, true);
});

test('BLOCKED requires a recorded reason', () => {
  assert.equal(canTransition('IMPLEMENTING', 'BLOCKED').code, 'BLOCK_REASON_REQUIRED');
  assert.equal(canTransition('IMPLEMENTING', 'BLOCKED', { reason: 'META-C1' }).ok, true);
});

test('BLOCKED can return to any working state but never straight to CHECKPOINTED', () => {
  assert.equal(canTransition('BLOCKED', 'IMPLEMENTING').ok, true);
  assert.equal(canTransition('BLOCKED', 'CHECKPOINTED').code, 'ILLEGAL_TRANSITION');
});

test('assertTransition throws a typed error carrying the reason code', () => {
  assert.throws(
    () => assertTransition('CHARACTERIZING', 'MERGED'),
    (err) => err instanceof TransitionError && err.code === 'ILLEGAL_TRANSITION',
  );
});

test('NEGATIVE CONTROL: a permissive table would accept the illegal jump', () => {
  // Proves the assertions above test the guard, not a tautology.
  const permissive = () => ({ ok: true });
  assert.equal(permissive('CHARACTERIZING', 'MERGED').ok, true);
  assert.equal(canTransition('CHARACTERIZING', 'MERGED').ok, false);
});
