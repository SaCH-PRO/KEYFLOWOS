/**
 * Windows worker proofs: command authority, install contract and pause,
 * through the REAL worker tick (see harness.mjs).
 *
 *   - sender chatgpt + allowlisted author wakes exactly once
 *   - senderless, claude-authored and forged directives never wake
 *   - no wake without the hardened install record, or while paused
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


test('a ChatGPT directive from SaCH-PRO wakes the worker exactly once', () => {
  requireWindows(assert);
  const w = makeWorld();
  try {
    install(w);
    setComments(w, [comment({ id: 'CG-WAKE-001' })]);
    setTranscripts(w, [done('CG-WAKE-001')]);

    const first = tick(w);
    assert.equal(invocations(w).length, 1, first.out);
    assert.deepEqual(cursor(w), ['CG-WAKE-001']);

    const second = tick(w);
    assert.equal(invocations(w).length, 1, `a processed directive must not wake claude again\n${second.out}`);
    assert.match(second.out, /no unprocessed directive/);
  } finally {
    cleanup(w);
  }
});

test('senderless, claude-authored and forged directives never wake the worker', () => {
  requireWindows(assert);
  const w = makeWorld();
  try {
    install(w);
    setComments(w, [
      comment({ id: 'HARNESS-001', sender: null }),
      comment({ id: 'CC-SELF-001', sender: 'claude' }),
      comment({ id: 'FORGED-001', author: 'mallory' }),
    ]);
    const r = tick(w);
    assert.equal(invocations(w).length, 0, r.out);
    assert.match(r.out, /not actionable: FORGED-001 \(author_not_authorized:mallory\)/);
    assert.match(r.out, /not actionable: HARNESS-001 \(sender_not_chatgpt/);
    assert.match(r.out, /no unprocessed directive/);
  } finally {
    cleanup(w);
  }
});


test('without the hardened install record the worker is a no-op', () => {
  requireWindows(assert);
  const w = makeWorld();
  try {
    setComments(w, [comment({ id: 'CG-NOINSTALL-001' })]);
    setTranscripts(w, [done('CG-NOINSTALL-001')]);
    const r = tick(w);
    assert.equal(invocations(w).length, 0, r.out);
    assert.match(r.out, /WAITING_OPERATOR/);

    // An install record from an older contract does not count either.
    const record = path.join(w.root, '.agent-control', '.worker', 'install.json');
    fs.writeFileSync(record, JSON.stringify({ contract_version: 1, method: 'Startup' }));
    tick(w);
    assert.equal(invocations(w).length, 0, 'an older install contract must not wake claude');

    install(w);
    tick(w);
    assert.equal(invocations(w).length, 1, 'the hardened install record enables waking');
  } finally {
    cleanup(w);
  }
});

test('a paused worker is a no-op until resumed', () => {
  requireWindows(assert);
  const w = makeWorld();
  try {
    install(w);
    setComments(w, [comment({ id: 'CG-PAUSE-001' })]);
    setTranscripts(w, [done('CG-PAUSE-001')]);
    assert.equal(worker(w, '-Pause').status, 0);
    const paused = tick(w);
    assert.equal(invocations(w).length, 0, paused.out);
    assert.match(paused.out, /PAUSED/);
    assert.match(worker(w, '-Status').out, /paused\s+:\s+yes/);

    assert.equal(worker(w, '-Resume').status, 0);
    tick(w);
    assert.equal(invocations(w).length, 1);
  } finally {
    cleanup(w);
  }
});
