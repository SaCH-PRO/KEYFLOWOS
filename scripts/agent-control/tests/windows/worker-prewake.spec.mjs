/**
 * Windows worker proofs: every failure between selecting a directive and
 * waking Claude is counted, through the REAL worker tick (see harness.mjs).
 *
 * A worktree that cannot be made was already a counted attempt. A failed
 * `git fetch origin` was not: it was thrown past the attempt ledger so that an
 * outage of a few minutes would not hold a healthy directive, and so a fetch
 * that never worked again was logged every interval for ever, never held and
 * never escalated. A worktree root that was refused or could not be made went
 * the same way.
 *
 *   - a network fault is counted apart from the two-strike budget, and holds a
 *     directive only after enough consecutive failures that ALSO span enough time
 *   - the hold escalates once, names the fault class, and never wakes Claude
 *   - a short outage holds nothing and the directive is delivered once
 *   - a tick that gets past the fetch starts the network count again
 *   - network failures never spend the attempt budget
 *   - a failure nothing classified is a counted attempt: two identical -> held
 *
 * The proofs lower the failure count with -MaxNetworkFailures and move the
 * recorded start of an outage back in the ledger, so none of them waits.
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
  worker, install, tick, invocations, posts, cursor, git,
} from './harness.mjs';

const ledgerFile = (world) => path.join(world.root, '.agent-control', '.worker', 'attempts.json');
const attempts = (world) => {
  if (!fs.existsSync(ledgerFile(world))) return [];
  return JSON.parse(fs.readFileSync(ledgerFile(world), 'utf8').replace(/^﻿/, '')).entries || [];
};

const offline = (world) => git(world.root, 'remote', 'set-url', 'origin', path.join(world.tmp, 'no-such-remote.git'));
const online = (world) => git(world.root, 'remote', 'set-url', 'origin', path.join(world.tmp, 'origin.git'));

/** Move the recorded start of a directive's outage back, as if that long had passed. */
function ageOutage(world, minutes) {
  const entries = attempts(world);
  assert.equal(entries.length, 1, 'the scenario needs one ledger entry');
  assert.ok(entries[0].network_first_at, 'the scenario needs a recorded outage');
  entries[0].network_first_at = new Date(Date.now() - minutes * 60000).toISOString().replace(/\.\d+Z$/, 'Z');
  fs.writeFileSync(ledgerFile(world), JSON.stringify({ entries }));
}

/** One tick with the failure count lowered to three; the 30 minutes are the worker's own. */
const tick3 = (world) => worker(world, '-Once', '-MaxNetworkFailures', '3');

test('a fetch that keeps failing: held only past the bound, ONE escalation naming the network fault, claude never woken', () => {
  requireWindows(assert);
  const w = makeWorld();
  try {
    install(w);
    setComments(w, [comment({ id: 'CG-OUTAGE-001' })]);
    setTranscripts(w, [done('CG-OUTAGE-001'), done('CG-AFTER-OUTAGE-002')]);
    offline(w);

    // Enough failures, but seconds apart: not an outage yet.
    for (let i = 1; i <= 4; i += 1) {
      const r = tick3(w);
      assert.match(r.out, new RegExp(`network_unavailable: git fetch origin failed; not waking claude on a stale base for CG-OUTAGE-001 \\(network failure ${i}; held at 3 over 30 minutes\\)`));
      assert.equal(attempts(w)[0].network_failures, i, 'every failed tick is counted');
      assert.equal(attempts(w)[0].held, false, `held after ${i} failures within a minute`);
    }
    assert.equal(posts(w).length, 0, 'nothing is escalated before the bound');

    // The same failures, now 31 minutes after the first.
    ageOutage(w, 31);
    const held = tick3(w);
    assert.match(held.out, /\[HELD_RETRYABLE\] CG-OUTAGE-001 held/);
    const [entry] = attempts(w);
    assert.equal(entry.held, true, held.out);
    assert.equal(entry.network_failures, 5);
    assert.equal(entry.attempts, 0, 'claude was never invoked, so no attempt is recorded');
    assert.equal(posts(w).length, 1, 'the hold escalates exactly once');
    const post = posts(w)[0].body;
    assert.match(post, /message_type: MOMENTUM/);
    assert.match(post, /disposition: HELD_RETRYABLE/);
    assert.match(post, /held_directive: CG-OUTAGE-001/);
    assert.match(post, /held_reason: "network fault: 5 consecutive identical failures over 31 minutes, claude never woken: network_unavailable: git fetch origin failed/);
    assert.ok(!post.includes('\\'), `the escalation carries a backslash into its YAML:\n${post}`);

    // Held is held, even once the network is back.
    online(w);
    for (let i = 0; i < 2; i += 1) {
      const again = tick3(w);
      assert.match(again.out, /CG-OUTAGE-001 is held \(network fault: /);
    }
    assert.equal(attempts(w)[0].network_failures, 5, 'a held directive is not attempted again');
    assert.equal(posts(w).length, 1, 'the escalation is not repeated');
    assert.equal(invocations(w).length, 0, 'claude is never woken for it');
    assert.deepEqual(cursor(w), [], 'a held directive is NOT recorded as processed');

    // A newer directive supersedes it, as it does any other hold.
    setComments(w, [comment({ id: 'CG-OUTAGE-001' }), comment({ id: 'CG-AFTER-OUTAGE-002' })]);
    setTranscripts(w, [done('CG-AFTER-OUTAGE-002')]);
    const next = tick3(w);
    assert.equal(invocations(w).length, 1, `a newer directive did not wake the worker\n${next.out}`);
    assert.deepEqual(cursor(w), ['CG-AFTER-OUTAGE-002']);
  } finally {
    cleanup(w);
  }
});

test('a network hold is released by the operator like any other', () => {
  requireWindows(assert);
  const w = makeWorld();
  try {
    install(w);
    setComments(w, [comment({ id: 'CG-OUTAGE-RELEASE-001' })]);
    setTranscripts(w, [done('CG-OUTAGE-RELEASE-001')]);
    offline(w);
    tick3(w);
    tick3(w);
    ageOutage(w, 45);
    const held = tick3(w);
    assert.equal(attempts(w)[0].held, true, held.out);
    assert.equal(posts(w).length, 1);

    online(w);
    tick3(w);
    assert.equal(invocations(w).length, 0, 'still held');
    const released = worker(w, '-ReleaseHold', 'CG-OUTAGE-RELEASE-001');
    assert.equal(released.status, 0, released.out);
    const r = tick3(w);
    assert.equal(invocations(w).length, 1, r.out);
    assert.deepEqual(cursor(w), ['CG-OUTAGE-RELEASE-001']);
    assert.equal(posts(w).length, 1);
  } finally {
    cleanup(w);
  }
});

test('a short run of fetch failures, then the network returns: nothing is held and the directive is delivered once', () => {
  requireWindows(assert);
  const w = makeWorld();
  try {
    install(w);
    setComments(w, [comment({ id: 'CG-BLIP-001' })]);
    setTranscripts(w, [done('CG-BLIP-001')]);
    offline(w);
    tick3(w);
    tick3(w);
    // Long enough ago that only the count stands between the blip and a hold.
    ageOutage(w, 45);
    assert.equal(attempts(w)[0].network_failures, 2);
    assert.equal(invocations(w).length, 0);

    online(w);
    const r = tick3(w);
    assert.equal(invocations(w).length, 1, r.out);
    assert.deepEqual(cursor(w), ['CG-BLIP-001']);
    assert.deepEqual(attempts(w), [], 'a delivered directive leaves no ledger entry');

    const after = tick3(w);
    assert.match(after.out, /no unprocessed directive/);
    assert.equal(invocations(w).length, 1, 'delivered once');
    assert.equal(posts(w).length, 0, 'a blip is never escalated');
  } finally {
    cleanup(w);
  }
});

test('two fetch failures an hour apart are not an outage', () => {
  requireWindows(assert);
  const w = makeWorld();
  try {
    install(w);
    setComments(w, [comment({ id: 'CG-ASLEEP-001' })]);
    offline(w);
    tick3(w);
    ageOutage(w, 61);
    const r = tick3(w);
    const [entry] = attempts(w);
    assert.equal(entry.network_failures, 2);
    assert.equal(entry.held, false, `two failures held the directive\n${r.out}`);
    assert.equal(posts(w).length, 0);
  } finally {
    cleanup(w);
  }
});

test('a tick that gets past the fetch starts the network count again, and leaves the attempt count alone', () => {
  requireWindows(assert);
  const w = makeWorld();
  try {
    install(w);
    setComments(w, [comment({ id: 'CG-FLAKY-NET-001' })]);
    setTranscripts(w, [blocked('a human-only approval gate')]);
    const zeroMinutes = () => worker(w, '-Once', '-MaxNetworkFailures', '3', '-MinNetworkOutageMinutes', '0');

    offline(w);
    zeroMinutes();
    zeroMinutes();
    assert.equal(attempts(w)[0].network_failures, 2);

    // The fetch works; the run itself is blocked, so the entry stays.
    online(w);
    zeroMinutes();
    assert.equal(invocations(w).length, 1);
    let [entry] = attempts(w);
    assert.equal(entry.attempts, 1);
    assert.equal(Number(entry.network_failures), 0, 'the outage ended when the fetch worked');

    // Two more failures are a new outage of two, not the old one grown to four.
    offline(w);
    zeroMinutes();
    const r = zeroMinutes();
    [entry] = attempts(w);
    assert.equal(entry.network_failures, 2);
    assert.equal(entry.held, false, `two short outages added up to a hold\n${r.out}`);
    assert.equal(entry.attempts, 1, 'a failed fetch is not an attempt');
    assert.equal(entry.consecutive, 1, 'nor does it break or extend a run of identical failures');
    assert.equal(posts(w).length, 0);

    // The second identical blocked run is the directive's second strike.
    online(w);
    const second = zeroMinutes();
    assert.equal(invocations(w).length, 2);
    [entry] = attempts(w);
    assert.equal(entry.held, true, second.out);
    assert.match(entry.held_reason, /^2 consecutive materially identical failures: /);
    assert.equal(posts(w).length, 1);
  } finally {
    cleanup(w);
  }
});

test('more fetch failures than the attempt budget allows hold nothing while the network bound is not reached', () => {
  requireWindows(assert);
  const w = makeWorld();
  try {
    install(w);
    setComments(w, [comment({ id: 'CG-LONG-BLIP-001' })]);
    setTranscripts(w, [done('CG-LONG-BLIP-001')]);
    offline(w);
    // Six: past two identical (the strike rule) and past five in total (the backstop).
    for (let i = 0; i < 6; i += 1) tick(w);
    const [entry] = attempts(w);
    assert.equal(entry.network_failures, 6);
    assert.equal(entry.attempts, 0, 'a failed fetch spent an attempt');
    assert.equal(entry.held, false, 'an outage under the network bound held the directive');
    assert.equal(posts(w).length, 0);

    online(w);
    const r = tick(w);
    assert.equal(invocations(w).length, 1, r.out);
    assert.deepEqual(cursor(w), ['CG-LONG-BLIP-001']);
  } finally {
    cleanup(w);
  }
});

test('a worktree root that cannot be made is a counted failure: held after two, escalated once, claude never woken', () => {
  requireWindows(assert);
  const w = makeWorld();
  try {
    install(w);
    // A directory name Windows cannot hold: the root is refused before anything is made.
    w.wtRoot = path.join(w.tmp, 'no|such|name', 'worktrees');
    setComments(w, [comment({ id: 'CG-NO-ROOT-001' })]);
    setTranscripts(w, [done('CG-NO-ROOT-001')]);

    const first = tick(w);
    assert.match(first.out, /\[ERROR\] wake_setup_failed: .+ for CG-NO-ROOT-001; claude was not woken/);
    assert.equal(attempts(w).length, 1, `the failure was not recorded\n${first.out}`);
    assert.equal(attempts(w)[0].attempts, 1);
    assert.equal(attempts(w)[0].held, false, 'one failure is retryable');
    assert.equal(posts(w).length, 0);

    const second = tick(w);
    assert.match(second.out, /HELD_RETRYABLE/);
    assert.equal(attempts(w)[0].held, true, 'two identical failures hold the directive');
    assert.match(attempts(w)[0].held_reason, /^2 consecutive materially identical failures: wake_setup_failed: /);
    assert.equal(posts(w).length, 1, 'the hold escalates exactly once');
    assert.match(posts(w)[0].body, /held_reason: "2 consecutive materially identical failures: wake_setup_failed: /);

    const third = tick(w);
    assert.match(third.out, /CG-NO-ROOT-001 is held/);
    assert.equal(attempts(w)[0].attempts, 2);
    assert.equal(posts(w).length, 1);
    assert.equal(invocations(w).length, 0, 'claude is never woken for it');
    assert.deepEqual(cursor(w), []);
  } finally {
    cleanup(w);
  }
});

test('a worktree root inside the checkout is a counted failure, and its escalation carries no Windows path separator', () => {
  requireWindows(assert);
  const w = makeWorld();
  try {
    install(w);
    w.wtRoot = path.join(w.root, 'nested-worktrees');
    setComments(w, [comment({ id: 'CG-NESTED-ROOT-001' })]);
    setTranscripts(w, [done('CG-NESTED-ROOT-001')]);

    tick(w);
    assert.equal(attempts(w)[0].attempts, 1);
    const second = tick(w);
    assert.equal(invocations(w).length, 0, second.out);
    assert.equal(attempts(w)[0].held, true, second.out);
    assert.equal(posts(w).length, 1);
    const post = posts(w)[0].body;
    assert.match(post, /wake_setup_failed: worktree root .+ is inside the interactive checkout/);
    assert.ok(!post.includes('\\'), `the escalation carries a Windows path into its YAML:\n${post}`);
  } finally {
    cleanup(w);
  }
});
