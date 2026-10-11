/**
 * Windows worker proofs: a worktree the host can hold, and a worktree failure
 * that is counted, through the REAL worker tick (see harness.mjs).
 *
 * On 2026-10-11 the worker could not deliver
 * CG-DIRECTIVE-META-AUTHORITY-EFFECT-COMPAT-INTEGRATION-CORRECTION-004. The
 * worktree is named after the message id; that id is 68 characters, the
 * worktree path 124, and the repository's longest tracked path 140. 265
 * characters is over what Windows allows, `git worktree add` failed on every
 * tick, and because the failure was thrown before the attempt ledger it was
 * never counted, held or escalated.
 *
 *   - the longest tracked path of a wake's worktree fits the path budget
 *   - a shortened worktree name is the same on every attempt, and distinct per id
 *   - a worktree made under the full id is still found
 *   - a worktree that cannot be made is a failed attempt: held and escalated once
 *   - a failed fetch is not counted against the directive
 *
 * The length proofs assert on the path the session really ran in. They do not
 * depend on git failing, so they hold on a host with core.longpaths set.
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
  install, tick, invocations, posts, cursor, git, samePath,
} from './harness.mjs';

// The worker's $WorktreePathBudget. Stated here, not read from the worker: the
// proof is that real paths fit it.
const BUDGET = 240;

// 99 characters, like the real ids but longer than any worktree root leaves room for.
const LONG_ID = `CG-DIRECTIVE-${'LONG-PACKET-NAME-'.repeat(4)}INTEGRATION-CORRECTION-004`;
const LONG_SIBLING = LONG_ID.replace(/004$/, '005');

/** The repository's own longest path is a 140-character screenshot name. */
const LONG_FILE = `attached_assets/screenshots/${'d'.repeat(108)}.png`;

/** Push a branch to origin through a scratch clone, with no checkout of what it adds. */
function pushBranch(world, branch, build) {
  const scratch = path.join(world.tmp, `scratch-${branch.replace(/\W/g, '-')}`);
  git(world.tmp, 'clone', '-q', path.join(world.tmp, 'origin.git'), scratch);
  git(scratch, 'checkout', '-q', '-b', branch);
  build(scratch);
  git(scratch, 'commit', '-q', '-m', branch);
  git(scratch, 'push', '-q', 'origin', branch);
  return git(scratch, 'rev-parse', 'HEAD');
}

/** A branch whose tree holds one path as long as the repository's longest. */
function longPathBranch(world) {
  assert.equal(LONG_FILE.length, 140);
  return pushBranch(world, 'impl/long-path', (scratch) => {
    fs.mkdirSync(path.join(scratch, path.dirname(LONG_FILE)), { recursive: true });
    fs.writeFileSync(path.join(scratch, LONG_FILE), 'png');
    git(scratch, 'add', '.');
  });
}

/**
 * A branch git cannot check out on Windows: a tracked name with a colon. The
 * entry goes straight into the index, so no file of that name is ever made;
 * core.protectNTFS is lifted for that one command only, and the worker's own
 * git keeps the default that refuses the checkout.
 */
function uncheckoutableBranch(world) {
  return pushBranch(world, 'impl/bad-path', (scratch) => {
    const blob = git(scratch, 'rev-parse', 'HEAD:README.md');
    git(scratch, '-c', 'core.protectNTFS=false', 'update-index', '--add', '--cacheinfo', `100644,${blob},not:a:windows:name.txt`);
  });
}

const attempts = (world) => {
  const f = path.join(world.root, '.agent-control', '.worker', 'attempts.json');
  if (!fs.existsSync(f)) return [];
  return JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, '')).entries || [];
};

test('path budget: a long directive id still gets a worktree whose longest tracked path fits', () => {
  requireWindows(assert);
  const w = makeWorld();
  try {
    install(w);
    const sha = longPathBranch(w);
    const fullName = path.join(w.wtRoot, LONG_ID, LONG_FILE);
    assert.ok(fullName.length > 260, `the scenario must not fit under the full id (${fullName.length})`);

    setComments(w, [comment({ id: LONG_ID, extra: 'implementation_branch: impl/long-path' })]);
    setTranscripts(w, [done(LONG_ID)]);
    w.env.KF_STUB_CLAUDE_WRITE = 'keep-the-worktree.txt';
    const r = tick(w);

    const [call] = invocations(w);
    assert.ok(call, `claude was not woken for a long directive id\n${r.out}`);
    assert.equal(call.head, sha, 'the worktree is the directive branch');
    assert.ok(samePath(path.dirname(call.cwd), w.wtRoot), `claude ran outside the worktree root: ${call.cwd}`);

    const longest = path.join(call.cwd, LONG_FILE);
    assert.ok(longest.length <= BUDGET, `the longest tracked path is ${longest.length} characters, over the budget of ${BUDGET}: ${longest}`);
    assert.ok(fs.existsSync(longest), 'the longest tracked file was checked out');

    const name = path.basename(call.cwd);
    assert.ok(LONG_ID.startsWith(name.slice(0, -9)), `the worktree name does not begin as its directive id does: ${name}`);
    assert.match(name, /-[0-9a-f]{8}$/, 'a shortened name ends in the digest of its id');
    assert.deepEqual(cursor(w), [LONG_ID], 'the directive is processed');
    assert.deepEqual(attempts(w), [], 'nothing failed');
  } finally {
    cleanup(w);
  }
});

test('path budget: an id that fits keeps its full name', () => {
  requireWindows(assert);
  const w = makeWorld();
  try {
    install(w);
    longPathBranch(w);
    setComments(w, [comment({ id: 'CG-FITS-001', extra: 'implementation_branch: impl/long-path' })]);
    setTranscripts(w, [done('CG-FITS-001')]);
    w.env.KF_STUB_CLAUDE_WRITE = 'keep-the-worktree.txt';
    const r = tick(w);
    const [call] = invocations(w);
    assert.ok(call, r.out);
    assert.equal(path.basename(call.cwd), 'CG-FITS-001', 'a name that fits is not shortened');
  } finally {
    cleanup(w);
  }
});

test('shortened name: a retry resumes in the same worktree, and another long id gets its own', () => {
  requireWindows(assert);
  const w = makeWorld();
  try {
    install(w);
    longPathBranch(w);
    setComments(w, [comment({ id: LONG_ID, extra: 'implementation_branch: impl/long-path' })]);
    setTranscripts(w, [blocked('first'), done(LONG_ID), done(LONG_SIBLING)]);
    w.env.KF_STUB_CLAUDE_WRITE = 'partial.txt';
    tick(w);
    tick(w);
    const [a, b] = invocations(w);
    assert.ok(a && b, 'both attempts woke claude');
    assert.ok(samePath(a.cwd, b.cwd), `the retry ran in another worktree: ${a.cwd} then ${b.cwd}`);

    // The sibling id differs from the first only in its last character, far
    // past where the name is cut.
    setComments(w, [
      comment({ id: LONG_ID, extra: 'implementation_branch: impl/long-path' }),
      comment({ id: LONG_SIBLING, extra: 'implementation_branch: impl/long-path' }),
    ]);
    const r = tick(w);
    const c = invocations(w)[2];
    assert.ok(c, `the sibling directive did not wake claude\n${r.out}`);
    assert.ok(!samePath(c.cwd, a.cwd), `two directives share one worktree: ${c.cwd}`);
    assert.ok(path.join(c.cwd, LONG_FILE).length <= BUDGET);
  } finally {
    cleanup(w);
  }
});

/** Remove the long path from the branch, as a clean-up commit on the real repository would. */
function dropLongPath(world) {
  const scratch = path.join(world.tmp, 'scratch-drop-long-path');
  git(world.tmp, 'clone', '-q', '-b', 'impl/long-path', path.join(world.tmp, 'origin.git'), scratch);
  git(scratch, 'rm', '-q', LONG_FILE);
  git(scratch, 'commit', '-q', '-m', 'drop the long path');
  git(scratch, 'push', '-q', 'origin', 'impl/long-path');
}

test('shortened name: a retry still resumes in the first worktree after the base loses its longest path', () => {
  // How much of the id fits depends on the base's longest tracked path. If a
  // retry recomputed the name, deleting that path between attempts would give
  // it a different directory and strand the first attempt's work. Found by
  // review of 2d012625.
  requireWindows(assert);
  const w = makeWorld();
  try {
    install(w);
    longPathBranch(w);
    setComments(w, [comment({ id: LONG_ID, extra: 'implementation_branch: impl/long-path' })]);
    setTranscripts(w, [blocked('first'), done(LONG_ID)]);
    w.env.KF_STUB_CLAUDE_WRITE = 'partial.txt';
    tick(w);
    const [a] = invocations(w);
    assert.ok(a, 'the first attempt woke claude');
    assert.notEqual(path.basename(a.cwd), LONG_ID, 'the scenario needs a shortened name for the first attempt');
    assert.ok(fs.existsSync(path.join(a.cwd, 'partial.txt')), 'the first attempt left work behind');

    dropLongPath(w);
    // With the long path gone the whole id would now fit.
    assert.ok(path.join(w.wtRoot, LONG_ID, 'README.md').length <= BUDGET, 'the scenario needs the full id to fit after the drop');

    const r = tick(w);
    const b = invocations(w)[1];
    assert.ok(b, `the retry did not wake claude\n${r.out}`);
    assert.ok(samePath(a.cwd, b.cwd), `the retry ran in another worktree: ${a.cwd} then ${b.cwd}`);
    assert.ok(fs.existsSync(path.join(b.cwd, 'partial.txt')), 'the retry sees the first attempt\'s work');
    assert.deepEqual(fs.readdirSync(w.wtRoot), [path.basename(a.cwd)], 'no second worktree was made for the directive');
    assert.deepEqual(cursor(w), [LONG_ID]);
  } finally {
    cleanup(w);
  }
});

test('shortened name: two directories carrying one directive\'s tag are a counted failure, not a guess', () => {
  requireWindows(assert);
  const w = makeWorld();
  try {
    install(w);
    longPathBranch(w);
    setComments(w, [comment({ id: LONG_ID, extra: 'implementation_branch: impl/long-path' })]);
    setTranscripts(w, [blocked('first'), done(LONG_ID)]);
    tick(w);
    const [a] = invocations(w);
    const first = path.basename(a.cwd);
    // A second directory with the same tag and a shorter head of the same id.
    const twin = first.slice(0, 20) + first.slice(-9);
    fs.mkdirSync(path.join(w.wtRoot, twin));

    const r = tick(w);
    assert.equal(invocations(w).length, 1, `claude must not be woken when the worktree is ambiguous\n${r.out}`);
    assert.match(r.out, /worktree_unavailable: 2 worktree directories carry the tag/);
    assert.equal(attempts(w).find((e) => e.message_id === LONG_ID).attempts, 2, 'counted in the ledger, so it ends in a hold');
    assert.deepEqual(cursor(w), []);
  } finally {
    cleanup(w);
  }
});

test('full-id worktree: one made under the whole id is found again, not replaced by a shortened one', () => {
  requireWindows(assert);
  const w = makeWorld();
  try {
    install(w);
    longPathBranch(w);
    // An earlier attempt, made when the tree was short enough for the whole id.
    const earlier = path.join(w.wtRoot, LONG_ID);
    fs.mkdirSync(w.wtRoot, { recursive: true });
    git(w.root, 'worktree', 'add', '-q', '--detach', earlier, 'origin/main');
    fs.writeFileSync(path.join(earlier, 'partial.txt'), 'work from the earlier attempt');

    setComments(w, [comment({ id: LONG_ID, extra: 'implementation_branch: impl/long-path' })]);
    setTranscripts(w, [done(LONG_ID)]);
    const r = tick(w);
    const [call] = invocations(w);
    assert.ok(call, r.out);
    assert.ok(samePath(call.cwd, earlier), `the earlier worktree was not reused: ${call.cwd}`);
    assert.equal(fs.readFileSync(path.join(earlier, 'partial.txt'), 'utf8'), 'work from the earlier attempt');
  } finally {
    cleanup(w);
  }
});

test('worktree failure: a worktree that cannot be made is counted, held after two, escalated once, and never wakes claude', () => {
  requireWindows(assert);
  const w = makeWorld();
  try {
    install(w);
    uncheckoutableBranch(w);
    setComments(w, [comment({ id: 'CG-NO-WORKTREE-001', extra: 'implementation_branch: impl/bad-path' })]);
    setTranscripts(w, [done('CG-NO-WORKTREE-001')]);

    const first = tick(w);
    assert.equal(invocations(w).length, 0, `claude was woken without a worktree\n${first.out}`);
    assert.match(first.out, /worktree_unavailable: git worktree add failed for CG-NO-WORKTREE-001 at origin\/impl\/bad-path/);
    assert.equal(attempts(w).length, 1, `the failure was not recorded\n${first.out}`);
    assert.equal(attempts(w)[0].attempts, 1);
    assert.equal(attempts(w)[0].held, false, 'one failure is retryable');
    assert.equal(posts(w).length, 0, 'one failure is not an escalation');

    const second = tick(w);
    assert.match(second.out, /HELD_RETRYABLE/);
    assert.equal(attempts(w)[0].attempts, 2);
    assert.equal(attempts(w)[0].held, true, 'two identical failures hold the directive');
    assert.equal(posts(w).length, 1, 'the hold escalates exactly once');
    const post = posts(w)[0].body;
    assert.match(post, /message_type: MOMENTUM/);
    assert.match(post, /held_directive: CG-NO-WORKTREE-001/);
    assert.match(post, /worktree_unavailable/);
    assert.ok(!post.includes('\\'), `the escalation carries a Windows path into its YAML:\n${post}`);

    for (let i = 0; i < 2; i += 1) {
      const again = tick(w);
      assert.match(again.out, /CG-NO-WORKTREE-001 is held/);
    }
    assert.equal(attempts(w)[0].attempts, 2, 'a held directive is not attempted again');
    assert.equal(posts(w).length, 1, 'the escalation is not repeated');
    assert.equal(invocations(w).length, 0, 'claude is never woken for it');
    assert.deepEqual(cursor(w), [], 'a held directive is NOT recorded as processed');
  } finally {
    cleanup(w);
  }
});

test('worktree failure: a directory in the way that is not a worktree is counted the same way and left alone', () => {
  requireWindows(assert);
  const w = makeWorld();
  try {
    install(w);
    const inTheWay = path.join(w.wtRoot, 'CG-IN-THE-WAY-001');
    fs.mkdirSync(inTheWay, { recursive: true });
    fs.writeFileSync(path.join(inTheWay, 'someone-elses.txt'), 'not the worker\'s');
    setComments(w, [comment({ id: 'CG-IN-THE-WAY-001' })]);
    setTranscripts(w, [done('CG-IN-THE-WAY-001')]);

    tick(w);
    const second = tick(w);
    assert.equal(invocations(w).length, 0, second.out);
    assert.match(second.out, /HELD_RETRYABLE/);
    assert.equal(attempts(w)[0].held, true);
    assert.equal(posts(w).length, 1);
    assert.equal(fs.readFileSync(path.join(inTheWay, 'someone-elses.txt'), 'utf8'), 'not the worker\'s', 'the directory was touched');
  } finally {
    cleanup(w);
  }
});

test('a failed fetch is the network\'s: it is not counted against the directive and nothing is escalated', () => {
  requireWindows(assert);
  const w = makeWorld();
  try {
    install(w);
    setComments(w, [comment({ id: 'CG-OFFLINE-001' })]);
    setTranscripts(w, [done('CG-OFFLINE-001')]);
    git(w.root, 'remote', 'set-url', 'origin', path.join(w.tmp, 'no-such-remote.git'));

    for (let i = 0; i < 3; i += 1) {
      const r = tick(w);
      assert.match(r.out, /git fetch origin failed/);
    }
    assert.equal(invocations(w).length, 0, 'claude is not woken on a stale base');
    assert.deepEqual(attempts(w), [], 'an outage must not hold a directive');
    assert.equal(posts(w).length, 0);

    // The remote comes back and the same directive runs.
    git(w.root, 'remote', 'set-url', 'origin', path.join(w.tmp, 'origin.git'));
    const r = tick(w);
    assert.equal(invocations(w).length, 1, r.out);
    assert.deepEqual(cursor(w), ['CG-OFFLINE-001']);
  } finally {
    cleanup(w);
  }
});
