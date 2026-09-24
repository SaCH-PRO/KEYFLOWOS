/**
 * Windows worker proofs: bounded retry (W6, CG-REVIEW-META-AUTO-WORKER-002),
 * through the REAL worker tick (see harness.mjs).
 *
 *   - two identical failures -> HELD_RETRYABLE, one escalation, no third invocation
 *   - a changed blocker signature permits another bounded attempt
 *   - a total-attempt backstop; release by a newer directive or the operator
 *
 * Windows-only, and FAILS elsewhere rather than skipping (WORKER-CI-PLATFORM-001).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { requireWindows } from '../helpers/powershell.mjs';
import {
  makeWorld, cleanup, comment, done, blocked, setComments, setTranscripts,
  worker, install, tick, invocations, posts, cursor, git, samePath,
} from './harness.mjs';


test('two identical blocked runs: held, ONE escalation, no third invocation', () => {
  requireWindows(assert);
  const w = makeWorld();
  try {
    install(w);
    setComments(w, [comment({ id: 'CG-STUCK-001' })]);
    setTranscripts(w, [blocked('a human-only approval gate')]);

    tick(w);
    assert.equal(invocations(w).length, 1);
    assert.equal(posts(w).length, 0, 'one failure is retryable, not an escalation');

    const second = tick(w);
    assert.equal(invocations(w).length, 2);
    assert.match(second.out, /HELD_RETRYABLE/);
    assert.equal(posts(w).length, 1, 'the hold escalates exactly once');
    const post = posts(w)[0].body;
    assert.match(post, /message_type: MOMENTUM/);
    assert.match(post, /sender: claude-worker/);
    assert.match(post, /disposition: HELD_RETRYABLE/);
    assert.match(post, /held_directive: CG-STUCK-001/);

    for (let i = 0; i < 2; i += 1) {
      const again = tick(w);
      assert.match(again.out, /CG-STUCK-001 is held/);
    }
    assert.equal(invocations(w).length, 2, 'no third claude invocation for a held directive');
    assert.equal(posts(w).length, 1, 'the escalation is not repeated');
    assert.deepEqual(cursor(w), [], 'a held directive is NOT recorded as processed');
  } finally {
    cleanup(w);
  }
});

test('a changed blocker signature permits a new bounded attempt', () => {
  requireWindows(assert);
  const w = makeWorld();
  try {
    install(w);
    setComments(w, [comment({ id: 'CG-FLAP-001' })]);
    setTranscripts(w, [blocked('reason A'), blocked('reason B'), blocked('reason B')]);

    tick(w);
    tick(w);
    assert.equal(invocations(w).length, 2);
    assert.equal(posts(w).length, 0, 'A then B is progress of a kind, not a repeat');

    tick(w);
    assert.equal(invocations(w).length, 3, 'the changed signature bought one more attempt');
    tick(w);
    assert.equal(invocations(w).length, 3, 'B then B is a repeat: held');
    assert.equal(posts(w).length, 1);
  } finally {
    cleanup(w);
  }
});

test('the total-attempt backstop holds a blocker that never repeats itself', () => {
  requireWindows(assert);
  const w = makeWorld();
  try {
    install(w);
    setComments(w, [comment({ id: 'CG-DRIFT-001' })]);
    setTranscripts(w, ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7'].map((r) => blocked(r)));
    for (let i = 0; i < 7; i += 1) tick(w);
    assert.equal(invocations(w).length, 5, 'five attempts, then held regardless of wording');
    assert.equal(posts(w).length, 1);
  } finally {
    cleanup(w);
  }
});

test('a held directive is released by a newer directive or by the operator', () => {
  requireWindows(assert);
  const w = makeWorld();
  try {
    install(w);
    setComments(w, [comment({ id: 'CG-HELD-001' })]);
    setTranscripts(w, [blocked('x'), blocked('x'), done('CG-HELD-001')]);
    tick(w);
    tick(w);
    tick(w);
    assert.equal(invocations(w).length, 2, 'held');

    const released = worker(w, '-ReleaseHold', 'CG-HELD-001');
    assert.equal(released.status, 0, released.out);
    tick(w);
    assert.equal(invocations(w).length, 3, 'operator release permits one more attempt');
    assert.deepEqual(cursor(w), ['CG-HELD-001']);

    // A newer directive supersedes whatever is held.
    setComments(w, [comment({ id: 'CG-HELD-002' })]);
    setTranscripts(w, [blocked('y'), blocked('y'), blocked('y'), blocked('y'), blocked('y'), done('CG-NEWER-001')]);
    tick(w);
    tick(w);
    tick(w);
    assert.equal(invocations(w).length, 5, 'CG-HELD-002 is held after two');
    setComments(w, [comment({ id: 'CG-HELD-002' }), comment({ id: 'CG-NEWER-001' })]);
    tick(w);
    assert.equal(invocations(w).length, 6, 'a newer directive wakes the worker again');
  } finally {
    cleanup(w);
  }
});
