/**
 * Windows worker proofs: one worker per repository and control issue on a
 * machine, whichever checkout it was started from, through the REAL worker
 * (see harness.mjs).
 *
 * The single-instance lock lived in the checkout. Two workers started with
 * different -RepoRoot values therefore served the same control issue for days
 * without excluding each other: separate cursors and attempt ledgers, one
 * shared worktree root. And the lock trusted any live process with the
 * recorded PID, so after an unclean stop and PID reuse a new worker refused
 * to start.
 *
 *   - a second worker for the same repository and issue refuses, from any checkout
 *   - a different issue number is a different lock
 *   - a lock is owned by PID AND process start time: a dead PID or a reused one is reclaimed
 *   - a lock written before start times were recorded still holds while its PID lives
 *   - the modes that never wake Claude take no machine lock
 *   - both locks are released on a normal exit
 *
 * The "live worker" in these proofs is a real one: the worker started as the
 * installed launcher starts it, holding its locks until the proof stops it.
 *
 * Windows-only, and FAILS elsewhere rather than skipping (WORKER-CI-PLATFORM-001).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { requireWindows } from '../helpers/powershell.mjs';
import {
  makeWorld, cleanup, comment, done, setComments, setTranscripts,
  worker, startWorker, install, tick, invocations,
} from './harness.mjs';

// The worker's machine-lock name for its default repository and issue. Stated
// here, not read from the worker: the runbook tells an operator this name.
const MACHINE_LOCK = 'worker-sach-pro_keyflowos-issue-80.lock';

const machineLock = (world) => path.join(world.lockRoot, MACHINE_LOCK);
const repoLock = (world) => path.join(world.root, '.agent-control', '.worker', 'worker.lock');
const logOf = (world) => {
  const f = path.join(world.root, '.agent-control', '.worker', 'worker.log');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
};
const readLock = (file) => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const errors = (out) => out.split(/\r?\n/).filter((l) => l.includes('[ERROR]'));

/** A lock as this worker writes it, for a process the proof chooses. */
function writeLock(file, pid, processStartedAt, root) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({
    pid, process_started_at: processStartedAt, started_at: new Date().toISOString(), repo_root: root, repo: 'SaCH-PRO/KEYFLOWOS', issue: 80,
  }));
}

/** Start a looping worker and wait until its first tick is over and it sleeps. */
async function live(world, ...extra) {
  install(world);
  const child = startWorker(world, ...extra);
  const exited = new Promise((resolve) => { child.on('exit', (code) => resolve(code)); });
  const handle = {
    pid: child.pid,
    exited,
    stop: async () => { child.kill(); await exited; },
  };
  const deadline = Date.now() + 60000;
  while (!/no unprocessed directive/.test(logOf(world))) {
    if (child.exitCode !== null || Date.now() > deadline) {
      await handle.stop();
      throw new Error(`the live worker did not reach its first idle tick (exit ${child.exitCode})\n${logOf(world)}`);
    }
    await sleep(200);
  }
  return handle;
}

test('two checkouts, one issue: the second worker refuses to start and names the owner', async () => {
  requireWindows(assert);
  const a = makeWorld();
  const b = makeWorld();
  b.lockRoot = a.lockRoot;
  let first;
  try {
    first = await live(a);
    assert.equal(readLock(machineLock(a)).pid, first.pid, 'the running worker holds the machine lock');

    install(b);
    setComments(b, [comment({ id: 'CG-SECOND-CHECKOUT-001' })]);
    setTranscripts(b, [done('CG-SECOND-CHECKOUT-001')]);
    const r = tick(b);

    assert.equal(r.status, 1, `a second worker for the same issue must exit non-zero\n${r.out}`);
    assert.equal(invocations(b).length, 0, 'the second worker must not wake claude');
    const said = errors(r.out);
    assert.equal(said.length, 1, `one ERROR, not ${said.length}:\n${r.out}`);
    assert.match(said[0], /another worker already serves SaCH-PRO\/KEYFLOWOS issue 80 on this machine/);
    assert.ok(said[0].includes(`pid ${first.pid},`), `the ERROR does not name the owner's pid ${first.pid}: ${said[0]}`);
    assert.ok(said[0].toLowerCase().includes(`repo root ${a.root.toLowerCase()},`), `the ERROR does not name the owner's repo root: ${said[0]}`);
    assert.match(said[0], /started \d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ\)/, 'the ERROR names when the owner started');

    assert.equal(readLock(machineLock(a)).pid, first.pid, 'the owner still holds the machine lock');
    assert.ok(!fs.existsSync(repoLock(b)), 'the refused worker left its checkout lock behind');

    const status = worker(b, '-Status');
    assert.equal(status.status, 0, status.out);
    assert.match(status.out, /machine\s+: held by pid \d+ \(repo root .+, started \d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ\) -- SaCH-PRO\/KEYFLOWOS issue 80/);
    assert.ok(status.out.includes(`held by pid ${first.pid} `), `-Status does not show the owner:\n${status.out}`);
    assert.ok(status.out.toLowerCase().includes(`repo root ${a.root.toLowerCase()},`), `-Status does not show the owner's repo root:\n${status.out}`);
  } finally {
    if (first) await first.stop();
    cleanup(a);
    cleanup(b);
  }
});

test('a different issue number is a different lock: both workers run', async () => {
  requireWindows(assert);
  const a = makeWorld();
  const b = makeWorld();
  b.lockRoot = a.lockRoot;
  let first;
  try {
    first = await live(a);
    install(b);
    setComments(b, [comment({ id: 'CG-OTHER-ISSUE-001' })]);
    setTranscripts(b, [done('CG-OTHER-ISSUE-001')]);
    const r = worker(b, '-Once', '-IssueNumber', '81');
    assert.equal(r.status, 0, r.out);
    assert.equal(invocations(b).length, 1, `a worker for another issue was shut out\n${r.out}`);
    assert.deepEqual(fs.readdirSync(a.lockRoot), [MACHINE_LOCK], 'the other issue\'s lock is released and the first is untouched');
    assert.equal(readLock(machineLock(a)).pid, first.pid);
  } finally {
    if (first) await first.stop();
    cleanup(a);
    cleanup(b);
  }
});

test('the modes that never wake claude take no machine lock and run beside a live worker', async () => {
  requireWindows(assert);
  const a = makeWorld();
  const b = makeWorld();
  b.lockRoot = a.lockRoot;
  let first;
  try {
    first = await live(a);
    setComments(b, [comment({ id: 'CG-DRY-001' })]);
    for (const mode of [
      ['-RecordInstall', '-InstallMethod', 'Test', '-InstallLocation', 'test'],
      ['-Status'],
      ['-Pause'],
      ['-Resume'],
      ['-ReleaseHold', 'CG-NOT-HELD-001'],
      ['-DryRun'],
    ]) {
      const r = worker(b, ...mode);
      assert.equal(r.status, 0, `${mode[0]} did not run beside a live worker\n${r.out}`);
      if (mode[0] === '-DryRun') assert.match(r.out, /DRY RUN: would invoke claude for CG-DRY-001/);
    }
    assert.equal(invocations(b).length, 0);
    assert.deepEqual(fs.readdirSync(a.lockRoot), [MACHINE_LOCK]);
    assert.equal(readLock(machineLock(a)).pid, first.pid, 'the live worker still holds its lock');
  } finally {
    if (first) await first.stop();
    cleanup(a);
    cleanup(b);
  }
});

test('a stale machine lock from a dead process is reclaimed', () => {
  requireWindows(assert);
  const w = makeWorld();
  try {
    install(w);
    setComments(w, [comment({ id: 'CG-DEAD-OWNER-001' })]);
    setTranscripts(w, [done('CG-DEAD-OWNER-001')]);
    // PID 999999 is not a running process (Windows PIDs are multiples of four).
    writeLock(machineLock(w), 999999, '2026-10-01T00:00:00.0000000Z', 'C:\\somewhere\\else');

    const r = tick(w);
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /\[WARN\] removing a stale machine lock \(pid 999999 is no longer running\)/);
    assert.equal(invocations(w).length, 1, `a dead owner must not block the worker\n${r.out}`);
  } finally {
    cleanup(w);
  }
});

test('PID reuse: a lock whose PID is alive but started at another time is reclaimed, in the checkout and on the machine', () => {
  requireWindows(assert);
  const w = makeWorld();
  try {
    install(w);
    setComments(w, [comment({ id: 'CG-PID-REUSED-001' })]);
    setTranscripts(w, [done('CG-PID-REUSED-001')]);
    // This test process is alive, and it did not start in 2001.
    writeLock(machineLock(w), process.pid, '2001-01-01T00:00:00.0000000Z', 'C:\\somewhere\\else');
    writeLock(repoLock(w), process.pid, '2001-01-01T00:00:00.0000000Z', w.root);

    const r = tick(w);
    assert.equal(r.status, 0, `a reused PID kept the worker out\n${r.out}`);
    const reclaimed = new RegExp(`pid ${process.pid} is now another process: it started \\d{4}-\\S+, the lock's owner 2001-01-01T00:00:00Z\\)`);
    assert.match(r.out, new RegExp(`\\[WARN\\] removing a stale lock \\(${reclaimed.source}`));
    assert.match(r.out, new RegExp(`\\[WARN\\] removing a stale machine lock \\(${reclaimed.source}`));
    assert.equal(invocations(w).length, 1, r.out);
  } finally {
    cleanup(w);
  }
});

test('a checkout lock written before start times were recorded is respected while its worker lives', async () => {
  requireWindows(assert);
  const a = makeWorld();
  const b = makeWorld();
  let first;
  try {
    // A real worker process. It serves another checkout and another lock root,
    // so only the old-format lock below can be what keeps the second out.
    first = await live(a);
    install(b);
    setComments(b, [comment({ id: 'CG-OLD-LOCK-001' })]);
    setTranscripts(b, [done('CG-OLD-LOCK-001')]);
    // Byte for byte what the earlier worker wrote: Set-Content -Encoding utf8, no process start time.
    const old = `\uFEFF${JSON.stringify({ pid: first.pid, started_at: new Date().toISOString(), repo_root: b.root })}\r\n`;
    fs.writeFileSync(repoLock(b), old);

    const r = tick(b);
    assert.equal(r.status, 1, `an old-format lock held by a live worker was ignored\n${r.out}`);
    assert.ok(r.out.includes(`another worker is already running (pid ${first.pid})`), r.out);
    assert.equal(invocations(b).length, 0);
    assert.equal(fs.readFileSync(repoLock(b), 'utf8'), old, 'the old worker\'s lock was rewritten or removed');
    assert.ok(!fs.existsSync(machineLock(b)), 'a refused worker must not keep the machine lock');
  } finally {
    if (first) await first.stop();
    cleanup(a);
    cleanup(b);
  }
});

test('both locks are released on a normal exit, and the next worker starts', () => {
  requireWindows(assert);
  const w = makeWorld();
  try {
    install(w);
    setComments(w, [comment({ id: 'CG-RELEASE-001' })]);
    setTranscripts(w, [done('CG-RELEASE-001')]);
    const first = tick(w);
    assert.equal(first.status, 0, first.out);
    assert.equal(invocations(w).length, 1, first.out);
    assert.ok(fs.existsSync(w.lockRoot), 'the worker never took the machine lock');
    assert.deepEqual(fs.readdirSync(w.lockRoot), [], 'the machine lock outlived its worker');
    assert.ok(!fs.existsSync(repoLock(w)), 'the checkout lock outlived its worker');

    const second = tick(w);
    assert.equal(second.status, 0, second.out);
    assert.ok(!/stale/.test(second.out), `a released lock was found again as stale\n${second.out}`);
  } finally {
    cleanup(w);
  }
});

test('four workers started at once from four checkouts: exactly one serves the issue', async () => {
  requireWindows(assert);
  const worlds = [0, 1, 2, 3].map(() => makeWorld());
  for (const w of worlds) w.lockRoot = worlds[0].lockRoot;
  const children = [];
  try {
    for (const w of worlds) install(w);
    for (const w of worlds) {
      const child = startWorker(w);
      children.push({ child, world: w, exited: new Promise((resolve) => { child.on('exit', (code) => resolve(code)); }) });
    }
    const settled = (c) => c.child.exitCode !== null || /no unprocessed directive/.test(logOf(c.world));
    const deadline = Date.now() + 90000;
    while (!children.every(settled)) {
      assert.ok(Date.now() < deadline, 'the workers did not settle');
      await sleep(200);
    }
    const serving = children.filter((c) => c.child.exitCode === null);
    const refused = children.filter((c) => c.child.exitCode !== null);
    assert.equal(serving.length, 1, `${serving.length} workers serve one issue`);
    for (const c of refused) {
      assert.equal(c.child.exitCode, 1);
      assert.match(logOf(c.world), /another worker already serves SaCH-PRO\/KEYFLOWOS issue 80 on this machine/);
    }
    assert.equal(readLock(machineLock(worlds[0])).pid, serving[0].child.pid, 'the lock names the worker that is running');
  } finally {
    for (const c of children) {
      if (c.child.exitCode === null) c.child.kill();
      await c.exited;
    }
    for (const w of worlds) cleanup(w);
  }
});
