/**
 * Windows worker proofs: workspace isolation (W7, CG-REVIEW-META-AUTO-WORKER-002),
 * through the REAL worker tick (see harness.mjs).
 *
 *   - every wake runs in a dedicated worktree, never the interactive checkout
 *   - cleanup never deletes uncommitted or unpushed work
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


test('a wake runs in a dedicated worktree, never the interactive checkout', () => {
  requireWindows(assert);
  const w = makeWorld();
  try {
    install(w);
    setComments(w, [comment({ id: 'CG-WT-001', extra: 'implementation_branch: impl/test-branch' })]);
    setTranscripts(w, [done('CG-WT-001')]);
    const r = tick(w);
    const [call] = invocations(w);
    assert.ok(call, r.out);
    assert.ok(!samePath(call.cwd, w.root), `claude ran in the interactive checkout ${call.cwd}`);
    assert.ok(samePath(path.dirname(call.cwd), w.wtRoot), `claude ran outside the worktree root: ${call.cwd}`);
    assert.equal(call.head, w.implSha, 'the worktree is based on origin/<implementation_branch>');
    // Clean and fully pushed: the worker removes it after success.
    assert.ok(!fs.existsSync(call.cwd), 'a clean worktree is removed after success');
    assert.equal(git(w.root, 'rev-parse', '--abbrev-ref', 'HEAD'), 'main', 'the checkout was not switched');
  } finally {
    cleanup(w);
  }
});

test('cleanup never deletes uncommitted work, in the worktree or the checkout', () => {
  requireWindows(assert);
  const w = makeWorld();
  try {
    install(w);
    // Interactive work in progress in the human's checkout.
    fs.writeFileSync(path.join(w.root, 'human-wip.txt'), 'do not touch');
    setComments(w, [comment({ id: 'CG-DIRTY-001' })]);
    setTranscripts(w, [done('CG-DIRTY-001')]);
    w.env.KF_STUB_CLAUDE_WRITE = 'worker-wip.txt';
    const r = tick(w);
    const [call] = invocations(w);
    assert.ok(call, r.out);
    assert.ok(fs.existsSync(path.join(call.cwd, 'worker-wip.txt')), `uncommitted worker output was deleted\n${r.out}`);
    assert.match(r.out, /kept worktree .* uncommitted changes/);
    assert.equal(fs.readFileSync(path.join(w.root, 'human-wip.txt'), 'utf8'), 'do not touch');
    assert.ok(!fs.existsSync(path.join(w.root, 'worker-wip.txt')), 'the wake wrote into the interactive checkout');
  } finally {
    cleanup(w);
  }
});

test('cleanup never deletes commits that are on no remote', () => {
  requireWindows(assert);
  const w = makeWorld();
  try {
    install(w);
    setComments(w, [comment({ id: 'CG-UNPUSHED-001' })]);
    setTranscripts(w, [done('CG-UNPUSHED-001')]);
    w.env.KF_STUB_CLAUDE_COMMIT = '1';
    const r = tick(w);
    const [call] = invocations(w);
    assert.ok(fs.existsSync(call.cwd), `a worktree holding an unpushed commit was removed\n${r.out}`);
    assert.match(r.out, /kept worktree .* on no remote/);
  } finally {
    cleanup(w);
  }
});

test('a retry reuses the same worktree, so partial work carries over', () => {
  requireWindows(assert);
  const w = makeWorld();
  try {
    install(w);
    setComments(w, [comment({ id: 'CG-RETRY-001' })]);
    setTranscripts(w, [blocked('first'), done('CG-RETRY-001')]);
    w.env.KF_STUB_CLAUDE_WRITE = 'partial.txt';
    tick(w);
    tick(w);
    const [a, b] = invocations(w);
    assert.ok(a && b);
    assert.ok(samePath(a.cwd, b.cwd), 'the retry must resume in the same worktree');
  } finally {
    cleanup(w);
  }
});

test('a worktree root inside the checkout is refused without waking claude', () => {
  requireWindows(assert);
  const w = makeWorld();
  try {
    install(w);
    w.wtRoot = path.join(w.root, 'nested-worktrees');
    setComments(w, [comment({ id: 'CG-NESTED-001' })]);
    setTranscripts(w, [done('CG-NESTED-001')]);
    const r = tick(w);
    assert.equal(invocations(w).length, 0, r.out);
    assert.match(r.out, /inside the interactive checkout/);
  } finally {
    cleanup(w);
  }
});
