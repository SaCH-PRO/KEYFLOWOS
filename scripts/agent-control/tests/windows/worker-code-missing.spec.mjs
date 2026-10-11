/**
 * Windows worker proofs: the worker's own scripts going missing or answering
 * with something that is not a decision, through the REAL worker tick (see
 * harness.mjs).
 *
 * A running worker keeps only claude-worker.ps1 in memory and reads its
 * sibling scripts from disk on every tick. The installed worker ran from the
 * interactive checkout; when that checkout changed to a branch without
 * scripts/agent-control, every tick logged "Invalid JSON primitive: Windows."
 * -- powershell.exe's banner, printed for a -File that does not exist, parsed
 * as JSON -- for three days, with nothing naming the cause.
 *
 *   - a missing sibling script -> WAITING_OPERATOR naming it, nothing polled,
 *     claude not woken, nothing recorded
 *   - the scripts back in place -> the same directive is processed
 *   - a selector that prints a banner instead of a decision -> an error that
 *     carries the exit code, the script and the output, and no wake
 *
 * Windows-only, and FAILS elsewhere rather than skipping (WORKER-CI-PLATFORM-001).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { requireWindows } from '../helpers/powershell.mjs';
import {
  makeWorld, cleanup, comment, done, setComments, setTranscripts,
  worker, install, tick, invocations, posts, cursor,
} from './harness.mjs';

const SOURCE = path.resolve('scripts/agent-control');

/** A private copy of the worker and the code it calls, so a proof can break it. */
function ownWorkerCode(world) {
  const dir = path.join(world.tmp, 'worker-code');
  fs.mkdirSync(dir);
  for (const entry of fs.readdirSync(SOURCE, { withFileTypes: true })) {
    if (entry.isFile() && /\.(ps1|mjs)$/.test(entry.name)) fs.copyFileSync(path.join(SOURCE, entry.name), path.join(dir, entry.name));
  }
  fs.cpSync(path.join(SOURCE, 'lib'), path.join(dir, 'lib'), { recursive: true });
  world.workerPath = path.join(dir, 'claude-worker.ps1');
  return dir;
}

for (const gone of ['select-directive.ps1', 'select-directive.mjs', 'evaluate-run.ps1']) {
  test(`a worker whose ${gone} is gone waits for the operator and wakes nobody`, () => {
    requireWindows(assert);
    const w = makeWorld();
    try {
      const dir = ownWorkerCode(w);
      install(w);
      setComments(w, [comment({ id: 'CG-CODE-GONE-001' })]);
      setTranscripts(w, [done('CG-CODE-GONE-001')]);
      const held = path.join(w.tmp, gone);
      fs.renameSync(path.join(dir, gone), held);

      const r = tick(w);
      assert.match(r.out, /\[WAITING_OPERATOR\] worker_code_missing/);
      assert.ok(r.out.includes(`missing="${gone}"`), r.out);
      assert.ok(r.out.includes(dir), 'the log names the directory the code was expected in');
      assert.doesNotMatch(r.out, /Invalid JSON primitive/);
      assert.equal(invocations(w).length, 0, 'claude is not woken by a worker that cannot select or judge');
      assert.equal(posts(w).length, 0, 'and it posts nothing to the control room');
      assert.deepEqual(cursor(w), [], 'nothing is recorded as processed');

      const status = worker(w, '-Status');
      assert.ok(status.out.includes(`MISSING ${gone}`), status.out);

      // Positive control: the same copy, made whole, does the work. Without
      // this the tests above could pass on a copy that never worked at all.
      fs.renameSync(held, path.join(dir, gone));
      const again = tick(w);
      assert.match(again.out, /claude completed for CG-CODE-GONE-001/, again.out);
      assert.equal(invocations(w).length, 1);
      assert.deepEqual(cursor(w), ['CG-CODE-GONE-001']);
    } finally {
      cleanup(w);
    }
  });
}

test('a selector that answers with a banner is reported as that, with its exit code, and wakes nobody', () => {
  requireWindows(assert);
  const w = makeWorld();
  try {
    const dir = ownWorkerCode(w);
    install(w);
    setComments(w, [comment({ id: 'CG-BANNER-001' })]);
    setTranscripts(w, [done('CG-BANNER-001')]);
    // What powershell.exe prints for a script it cannot run, with the exit
    // status it leaves.
    fs.writeFileSync(
      path.join(dir, 'select-directive.ps1'),
      "param($CommentsFile, $CursorFile, $AuthorizedAuthors)\r\n'Windows PowerShell'\r\n'Copyright (C) Microsoft Corporation. All rights reserved.'\r\nexit 7\r\n",
    );

    const r = tick(w);
    assert.match(r.out, /\[ERROR\] selector_output_unreadable exit=7 /);
    assert.match(r.out, /stdout_head="Windows PowerShell Copyright/);
    assert.ok(r.out.includes(path.join(dir, 'select-directive.ps1')), 'the error names the script that answered');
    assert.doesNotMatch(r.out, /Invalid JSON primitive/);
    assert.equal(invocations(w).length, 0);
    assert.deepEqual(cursor(w), []);
  } finally {
    cleanup(w);
  }
});

test('unreadable output is not a decision even when the selector exits 0', () => {
  requireWindows(assert);
  const w = makeWorld();
  try {
    const dir = ownWorkerCode(w);
    install(w);
    setComments(w, [comment({ id: 'CG-BANNER-002' })]);
    setTranscripts(w, [done('CG-BANNER-002')]);
    // Valid JSON that is not a selection must not be read as "nothing selected".
    fs.writeFileSync(path.join(dir, 'select-directive.ps1'), "param($CommentsFile, $CursorFile, $AuthorizedAuthors)\r\n'{\"banner\":true}'\r\nexit 0\r\n");

    const r = tick(w);
    assert.match(r.out, /\[ERROR\] selector_output_unreadable exit=0 /);
    assert.doesNotMatch(r.out, /no unprocessed directive/, 'a non-decision is never reported as an idle channel');
    assert.equal(invocations(w).length, 0);
  } finally {
    cleanup(w);
  }
});
