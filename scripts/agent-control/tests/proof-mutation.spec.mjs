/**
 * FU-CI-NC-WORKTREE-REUSE (D-274, R&D-1 C1): the negative-control runner reuses one worktree, and every control still
 * starts from the exact commit.
 *
 * The Windows worker proof spent 61 of its 65 minutes in proof-mutation.mjs, and 89% of that creating and removing a
 * full `git worktree` (6,222 files) for each of the 323 controls. The runner now creates one worktree and, before
 * each control, resets it to the ref (`reset --hard`, `clean -ffdx`) and requires it pristine
 * (`status --porcelain --ignored` empty, HEAD at the ref); a control whose tree cannot be made pristine fails. The
 * proofs, mutations and verdicts are unchanged.
 *
 *   PM-01  RED-BEFORE  the controls of one run share one worktree
 *   PM-02  control     whatever a control leaves (an edited tracked file, an untracked file, an ignored file, a commit),
 *                      the next control's baseline sees the exact commit
 *   PM-03  control     live and vacuous verdicts are as before
 *   PM-04  control     no worktree is left behind
 *   PM-05  RED-BEFORE  resetToPristine reports a tree it cannot reset, and a control on such a tree fails (never runs)
 *
 * C1 acceptance review (a4f85f72): the reused worktree must isolate as the fresh one did.
 *   PM-06  RED-AT-a4f85f72  ref 'HEAD' (what CI passes) is resolved once, in the repository: a proof that commits in the
 *                           worktree does not move the commit the next control starts from
 *   PM-07  RED-AT-a4f85f72  a skip-worktree flag a proof sets does not survive into the next control
 *   PM-08  RED-AT-a4f85f72  sparse-checkout a proof turns on does not survive into the next control
 *   PM-09  RED-AT-a4f85f72  a proof that breaks the worktree fails only its own control: the next one runs on a fresh,
 *                           exact tree (one fresh worktree, then a second reset), as before
 *   PM-10  control          (confirmation review finding 2; restated at the second repair) a tree the reset cannot make
 *                           (a required smudge filter that fails once a proof has changed the file): that control fails
 *                           at stage 'reset' and its proof never runs. (The first fixture, a smudge filter with no
 *                           matching clean, is reported not pristine only when git's status re-reads the file, which
 *                           depends on timing: not a deterministic test. The repository has no filter attribute.)
 *   (was)  ...              a commit that no checkout can make pristine (a CRLF file
 *                           committed under `* text=auto`, which shows modified even freshly checked out): the control
 *                           fails at stage 'reset' and its proof never runs
 *
 * C1 repair review (42d8df6d): the runner's own git calls must never reach outside its worktree.
 *   PM-11  RED-AT-42d8df6d  a proof that points the worktree's .git at the main repository: the reset does not follow
 *                           it (the main checkout's branch and staged changes are untouched) and the next control runs
 *                           on a fresh worktree
 *   PM-12  RED-AT-42d8df6d  a run leaves the repository's config exactly as it was (`sparse-checkout disable` wrote
 *                           `extensions.worktreeConfig` into it)
 *   PM-13  control          a skip-worktree flag on a path git quotes (non-ASCII) does not survive into the next control
 *   PM-14  RED-AT-42d8df6d  removing a worktree whose files cannot be deleted (EBUSY on Windows) is reported, never
 *                           thrown: the run still ends with its summary
 *
 * C1 second repair review (da70c68e): a reused worktree must be indistinguishable from a fresh one, git dir included.
 *   PM-15  RED-AT-da70c68e  a proof that attaches HEAD to the main checkout's branch: the reset does not move that
 *                           branch, and the next control runs on a detached HEAD at the commit
 *   PM-16  RED-AT-da70c68e  per-worktree git state a proof leaves (a refs/worktree ref, a bisect) does not survive
 *   PM-17  RED-AT-da70c68e  under core.autocrlf (windows-latest's default) a file a proof rewrote with LF and staged is
 *                           checked out again with CRLF, as a fresh worktree has it
 *   PM-18  RED-AT-da70c68e  a proof that times out leaving a process that keeps writing: the next control runs where
 *                           that process cannot reach
 *   PM-19  RED-AT-da70c68e  a proof that locks the worktree: no worktree is left behind (also RED on main 054cac4b,
 *                           which left the locked worktree too)
 * PM-05 now resets a worktree the runner made (addWorktree), as the runner does: resetToPristine takes the worktree
 * record ({ dir, gitDir, ... }) and no longer accepts a bare directory.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import * as runner from '../proof-mutation.mjs';

/** Every throwaway directory a test made, removed when the file's tests are done. */
const made = [];
process.on('exit', () => {
  for (const dir of made) {
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      // A process a proof left (PM-18) may still hold a file on Windows; the directory is under the temp dir.
    }
  }
});

const git = (cwd, ...args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};

/** A throwaway repository: claim.txt holds "good"; check.mjs is the proof; .gitignore ignores *.log. */
function fixtureRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-pm-fixture-'));
  made.push(dir);
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 'fixture@example.test');
  git(dir, 'config', 'user.name', 'Fixture');
  git(dir, 'config', 'core.autocrlf', 'false');
  fs.writeFileSync(path.join(dir, 'claim.txt'), 'good\n');
  fs.writeFileSync(path.join(dir, '.gitignore'), '*.log\n');
  fs.writeFileSync(path.join(dir, '\u00e9t\u00e9.txt'), 'summer\n');
  // The proof: logs where it ran (KF_PM_LOG, outside the repository), then passes only on a pristine exact tree whose
  // claim is good. Run as `node check.mjs litter` it also leaves every kind of debris behind it (an argument, not an
// environment variable, so the command is the same under cmd.exe on the Windows runner).
  fs.writeFileSync(
    path.join(dir, 'check.mjs'),
    [
      "import fs from 'node:fs';",
      "import { execSync, execFileSync, spawn } from 'node:child_process';",
      "const top = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();",
      "if (process.env.KF_PM_LOG) fs.appendFileSync(process.env.KF_PM_LOG, top + '\\n');",
      "const head = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();",
      "const dirty = execSync('git status --porcelain --ignored', { encoding: 'utf8' }).trim();",
      // A fresh worktree is detached, has no per-worktree ref or bisect, and (under autocrlf) CRLF files.
      "let detached = true;",
      "try { execSync('git symbolic-ref -q HEAD', { stdio: 'ignore' }); detached = false; } catch {}",
      "let marked = true;",
      "try { execSync('git rev-parse -q --verify refs/worktree/mark', { stdio: 'ignore' }); } catch { marked = false; }",
      "const bisecting = fs.existsSync(execSync('git rev-parse --git-path BISECT_LOG', { encoding: 'utf8' }).trim());",
      "const eolOk = !process.env.KF_PM_EXPECT_CRLF || fs.readFileSync('claim.txt', 'utf8').includes('\\r\\n');",
      "const ok = fs.readFileSync('claim.txt', 'utf8').includes('good') && head === process.env.KF_PM_REF && dirty === '' && detached && !marked && !bisecting && eolOk;",
      "if (process.argv[2] === 'litter') {",
      "  fs.writeFileSync('stray.txt', 'untracked');",
      "  fs.writeFileSync('noise.log', 'ignored');",
      "  fs.writeFileSync('claim.txt', 'good but edited\\n');",
      "  execSync('git -c user.email=x@example.test -c user.name=x commit -qam litter');",
      "}",
      // Index and checkout state a fresh worktree never had (C1 acceptance review finding 2).
      "if (process.argv[2] === 'skip') {",
      "  execSync('git update-index --skip-worktree claim.txt');",
      "  fs.writeFileSync('claim.txt', 'xxxx\\n');",
      "}",
      "if (process.argv[2] === 'sparse') {",
      "  execSync('git sparse-checkout set --no-cone /check.mjs /.gitignore');",
      "}",
      // A worktree the proof broke outright (finding 3): git cannot work in it any more.
      "if (process.argv[2] === 'corrupt') {",
      "  fs.writeFileSync('.git', 'gitdir: /nonexistent/broken\\n');",
      "}",
      // A worktree whose .git now points at the main repository (C1 repair review finding 1).
      "if (process.argv[2] === 'redirect') {",
      "  fs.writeFileSync('.git', 'gitdir: ' + process.env.KF_PM_MAIN_GITDIR + '\\n');",
      "}",
      // Second repair review: HEAD attached to a branch (F1), per-worktree state (F2), an LF rewrite staged under
      // autocrlf (F3), a process left writing after a timeout (F4), a locked worktree (F6).
      "if (process.argv[2] === 'attach') {",
      "  execSync('git symbolic-ref HEAD refs/heads/' + process.env.KF_PM_BRANCH);",
      "}",
      "if (process.argv[2] === 'perworktree') {",
      "  execSync('git update-ref refs/worktree/mark HEAD');",
      "  execSync('git bisect start', { stdio: 'ignore' });",
      "}",
      "if (process.argv[2] === 'lf') {",
      "  fs.writeFileSync('claim.txt', 'good\\n');",
      "  execSync('git add claim.txt');",
      "}",
      "if (process.argv[2] === 'hang') {",
      "  const writer = \"const fs = require('fs'); const end = Date.now() + 4000; const t = setInterval(() => { try { fs.writeFileSync('late.txt', 'late'); } catch {} if (Date.now() > end) clearInterval(t); }, 50);\";",
      "  spawn(process.execPath, ['-e', writer], { stdio: 'ignore' }).unref();",
      "  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1500);",
      "}",
      "if (process.argv[2] === 'lock') {",
      "  execFileSync('git', ['worktree', 'lock', process.cwd()]);",
      "}",
      // A flag on a path git C-quotes in `ls-files -v` (finding 3).
      "if (process.argv[2] === 'skipname') {",
      "  execSync('git update-index --skip-worktree -- \u00e9t\u00e9.txt');",
      "  fs.writeFileSync('\u00e9t\u00e9.txt', 'changed');",
      "}",
      'process.exit(ok ? 0 : 1);',
      '',
    ].join('\n'),
  );
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'fixture');
  return { dir, ref: git(dir, 'rev-parse', 'HEAD') };
}

const control = (id, extra = {}) => ({
  id,
  claim: `claim ${id}`,
  proof_command: 'node check.mjs',
  mutation: { file: 'claim.txt', find: 'good', replace: 'bad' },
  ...extra,
});

function withEnv(vars, fn) {
  const before = {};
  for (const [k, v] of Object.entries(vars)) {
    before[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(before)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test('PM-01 RED-BEFORE: the controls of one run share one worktree', () => {
  const { dir, ref } = fixtureRepo();
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-pm-log-'));
  made.push(logDir);
  const log = path.join(logDir, 'where.txt');
  const summary = withEnv({ KF_PM_LOG: log, KF_PM_REF: ref }, () =>
    runner.runManifest({ negative_controls: [control('a'), control('b'), control('c')] }, { repoRoot: dir, ref }),
  );
  assert.equal(summary.live, 3, JSON.stringify(summary.results));
  const places = new Set(fs.readFileSync(log, 'utf8').trim().split('\n'));
  assert.equal(places.size, 1, `one worktree for the run, saw ${places.size}: ${[...places].join(', ')}`);
});

test('PM-02 control: whatever a control leaves behind, the next control starts from the exact commit', () => {
  const { dir, ref } = fixtureRepo();
  // Control 1 litters (edits a tracked file, adds an untracked and an ignored file, commits); control 2 must still
  // see the exact, pristine ref, or its baseline fails and it is reported as not live.
  const litter = control('litter', { proof_command: 'node check.mjs litter' });
  const summary = withEnv({ KF_PM_LOG: undefined, KF_PM_REF: ref }, () =>
    runner.runManifest({ negative_controls: [litter, control('after-litter'), control('again')] }, { repoRoot: dir, ref }),
  );
  const byId = Object.fromEntries(summary.results.map((r) => [r.id, r]));
  assert.equal(byId['after-litter'].baseline_passed, true, JSON.stringify(byId['after-litter']));
  assert.equal(byId['after-litter'].ok, true);
  assert.equal(byId.again.ok, true);
});

test('PM-03 control: live and vacuous verdicts are as before', () => {
  const { dir, ref } = fixtureRepo();
  // A proof that ignores the claim cannot fail: vacuous. A mutation that finds nothing: not live.
  const vacuous = control('vacuous', { proof_command: 'node -e "process.exit(0)"' });
  const missing = control('missing', { mutation: { file: 'claim.txt', find: 'nowhere', replace: 'x' } });
  const summary = withEnv({ KF_PM_LOG: undefined, KF_PM_REF: ref }, () =>
    runner.runManifest({ negative_controls: [control('live'), vacuous, missing] }, { repoRoot: dir, ref }),
  );
  const byId = Object.fromEntries(summary.results.map((r) => [r.id, r]));
  assert.equal(summary.total, 3);
  assert.equal(byId.live.ok, true);
  assert.equal(byId.vacuous.ok, false);
  assert.match(byId.vacuous.detail, /VACUOUS/);
  assert.equal(byId.missing.ok, false);
  assert.equal(byId.missing.stage, 'mutation');
});

test('PM-04 control: no worktree is left behind', () => {
  const { dir, ref } = fixtureRepo();
  withEnv({ KF_PM_LOG: undefined, KF_PM_REF: ref }, () =>
    runner.runManifest({ negative_controls: [control('a'), control('b')] }, { repoRoot: dir, ref }),
  );
  const listed = git(dir, 'worktree', 'list', '--porcelain').split('\n').filter((l) => l.startsWith('worktree '));
  assert.equal(listed.length, 1, listed.join('\n'));
});

test('PM-05 RED-BEFORE: a tree that cannot be reset to the ref is reported, and its control fails without running', () => {
  assert.equal(typeof runner.resetToPristine, 'function', 'resetToPristine is exported');
  const { dir, ref } = fixtureRepo();
  // A pristine reset of a worktree the runner made succeeds; a reset to a ref that does not exist does not.
  const worktree = runner.addWorktree(dir, ref);
  assert.ok(worktree.dir, worktree.detail);
  try {
    assert.deepEqual(runner.resetToPristine(worktree, ref), { ok: true });
    const bad = runner.resetToPristine(worktree, '0000000000000000000000000000000000000000');
    assert.equal(bad.ok, false);
    assert.ok(bad.detail.length > 0);
  } finally {
    runner.removeWorktree(dir, worktree.dir);
  }
});

/** Runs [first, plain, plain] at `ref` and returns the two plain controls' results. */
function afterFirst(first, ref, dir, refSha) {
  const summary = withEnv({ KF_PM_LOG: undefined, KF_PM_REF: refSha }, () =>
    runner.runManifest({ negative_controls: [first, control('second'), control('third')] }, { repoRoot: dir, ref }),
  );
  const byId = Object.fromEntries(summary.results.map((r) => [r.id, r]));
  return [byId.second, byId.third];
}

test("PM-06 RED-AT-a4f85f72: with ref 'HEAD', a proof's own commit does not move where the next control starts", () => {
  const { dir, ref } = fixtureRepo();
  for (const r of afterFirst(control('litter', { proof_command: 'node check.mjs litter' }), 'HEAD', dir, ref)) {
    assert.equal(r.ok, true, JSON.stringify(r));
  }
});

test('PM-07 RED-AT-a4f85f72: a skip-worktree flag does not survive into the next control', () => {
  const { dir, ref } = fixtureRepo();
  for (const r of afterFirst(control('skip', { proof_command: 'node check.mjs skip' }), ref, dir, ref)) {
    assert.equal(r.ok, true, JSON.stringify(r));
  }
});

test('PM-08 RED-AT-a4f85f72: sparse-checkout does not survive into the next control', () => {
  const { dir, ref } = fixtureRepo();
  for (const r of afterFirst(control('sparse', { proof_command: 'node check.mjs sparse' }), ref, dir, ref)) {
    assert.equal(r.ok, true, JSON.stringify(r));
  }
});

test('PM-09 RED-AT-a4f85f72: a proof that breaks the worktree fails only its own control', () => {
  const { dir, ref } = fixtureRepo();
  for (const r of afterFirst(control('corrupt', { proof_command: 'node check.mjs corrupt' }), ref, dir, ref)) {
    assert.equal(r.ok, true, JSON.stringify(r));
  }
  const listed = git(dir, 'worktree', 'list', '--porcelain').split('\n').filter((l) => l.startsWith('worktree '));
  assert.equal(listed.length, 1, 'no worktree left behind, broken or not: ' + listed.join(' | '));
});

/** A smudge filter run by node (portable to the Windows runner): `node <script>` with its own state file. */
function nodeFilter(dir, name, body) {
  const scriptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-pm-filter-'));
  made.push(scriptDir);
  const script = path.join(scriptDir, `${name}.cjs`);
  fs.writeFileSync(script, body.replace('STATE', JSON.stringify(path.join(scriptDir, 'count.txt'))));
  git(dir, 'config', `filter.${name}.smudge`, `node "${script.split(path.sep).join('/')}"`);
  git(dir, 'config', `filter.${name}.clean`, 'cat');
  return scriptDir;
}

test('PM-10 control: a tree the reset cannot make (its checkout cannot be repeated) fails that control at the reset, and its proof never runs', () => {
  const { dir } = fixtureRepo();
  // A required smudge filter that works once, then fails: the worktree is made, but once a proof has changed
  // claim.txt neither the reset nor a new worktree can check it out again.
  fs.writeFileSync(path.join(dir, '.gitattributes'), 'claim.txt filter=once\n');
  git(dir, 'add', '.gitattributes');
  git(dir, 'commit', '-qm', 'filter');
  nodeFilter(dir, 'once', [
    "const fs = require('fs');",
    'const state = STATE;',
    "const n = (fs.existsSync(state) ? Number(fs.readFileSync(state, 'utf8')) : 0) + 1;",
    'fs.writeFileSync(state, String(n));',
    'if (n > 1) process.exit(1);',
    'process.stdin.pipe(process.stdout);',
    '',
  ].join('\n'));
  git(dir, 'config', 'filter.once.required', 'true');
  const ref = git(dir, 'rev-parse', 'HEAD');
  const markerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-pm-marker-'));
  made.push(markerDir);
  const marker = path.join(markerDir, 'ran.txt');
  const edits = control('edits', { proof_command: `node -e "require('fs').writeFileSync('claim.txt', 'edited')"` });
  const probe = control('never-runs', { proof_command: `node -e "require('fs').writeFileSync(process.argv[1], 'ran')" "${marker}"` });
  const summary = withEnv({ KF_PM_LOG: undefined, KF_PM_REF: ref }, () =>
    runner.runManifest({ negative_controls: [edits, probe] }, { repoRoot: dir, ref }),
  );
  const byId = Object.fromEntries(summary.results.map((r) => [r.id, r]));
  assert.equal(byId['never-runs'].ok, false, JSON.stringify(byId['never-runs']));
  assert.equal(byId['never-runs'].stage, 'reset', JSON.stringify(byId['never-runs']));
  assert.equal(fs.existsSync(marker), false, 'the proof did not run on a tree that is not the commit');
  const listed = git(dir, 'worktree', 'list', '--porcelain').split('\n').filter((l) => l.startsWith('worktree '));
  assert.equal(listed.length, 1, 'no worktree left behind');
});

/** The main checkout's state the runner must never touch: its branch, HEAD, staged changes and config. */
function mainState(dir) {
  return {
    branch: git(dir, 'symbolic-ref', '-q', 'HEAD'),
    head: git(dir, 'rev-parse', 'HEAD'),
    staged: git(dir, 'diff', '--cached', '--name-only'),
    config: fs.readFileSync(path.join(dir, '.git', 'config'), 'utf8'),
  };
}

test("PM-11 RED-AT-42d8df6d: a worktree whose .git points at the main repository is not reset through it", () => {
  const { dir, ref } = fixtureRepo();
  // The main checkout has moved on (a newer commit) and holds a staged change; the run is at the older commit.
  fs.writeFileSync(path.join(dir, 'later.txt'), 'later\n');
  git(dir, 'add', 'later.txt');
  git(dir, 'commit', '-qm', 'later');
  fs.writeFileSync(path.join(dir, 'staged.txt'), 'staged\n');
  git(dir, 'add', 'staged.txt');
  const before = mainState(dir);
  const results = withEnv({ KF_PM_MAIN_GITDIR: path.join(dir, '.git') }, () =>
    afterFirst(control('redirect', { proof_command: 'node check.mjs redirect' }), ref, dir, ref),
  );
  assert.deepEqual(mainState(dir), before, 'the main checkout is untouched');
  for (const r of results) assert.equal(r.ok, true, JSON.stringify(r));
});

test("PM-12 RED-AT-42d8df6d: a run leaves the repository's config exactly as it was", () => {
  const { dir, ref } = fixtureRepo();
  const before = fs.readFileSync(path.join(dir, '.git', 'config'), 'utf8');
  const summary = withEnv({ KF_PM_LOG: undefined, KF_PM_REF: ref }, () =>
    runner.runManifest({ negative_controls: [control('a'), control('b')] }, { repoRoot: dir, ref }),
  );
  assert.equal(summary.live, 2, JSON.stringify(summary.results));
  assert.equal(fs.readFileSync(path.join(dir, '.git', 'config'), 'utf8'), before);
});

test('PM-13 control: a skip-worktree flag on a path git quotes does not survive into the next control', () => {
  const { dir, ref } = fixtureRepo();
  for (const r of afterFirst(control('skipname', { proof_command: 'node check.mjs skipname' }), ref, dir, ref)) {
    assert.equal(r.ok, true, JSON.stringify(r));
  }
});

test('PM-14 RED-AT-42d8df6d: a worktree that cannot be deleted is reported, never thrown', () => {
  assert.equal(typeof runner.removeWorktree, 'function', 'removeWorktree is exported');
  const { dir } = fixtureRepo();
  // Not a worktree git knows, so `git worktree remove` fails and the runner deletes it itself; the delete throws
  // as fs.rmSync does on Windows for a file another process holds open.
  const stuck = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-pm-stuck-'));
  made.push(stuck);
  const busy = () => {
    throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' });
  };
  let outcome;
  assert.doesNotThrow(() => {
    outcome = runner.removeWorktree(dir, stuck, busy);
  });
  assert.equal(outcome.ok, false);
  assert.match(outcome.detail, /EBUSY/);
});

/** The main checkout's branch name. */
const branchOf = (dir) => git(dir, 'symbolic-ref', '--short', 'HEAD');

test('PM-15 RED-AT-da70c68e: a proof that attaches HEAD to the main branch does not get that branch reset', () => {
  const { dir, ref } = fixtureRepo();
  fs.writeFileSync(path.join(dir, 'later.txt'), 'later\n');
  git(dir, 'add', 'later.txt');
  git(dir, 'commit', '-qm', 'later');
  const before = mainState(dir);
  const results = withEnv({ KF_PM_BRANCH: branchOf(dir) }, () =>
    afterFirst(control('attach', { proof_command: 'node check.mjs attach' }), ref, dir, ref),
  );
  assert.deepEqual(mainState(dir), before, 'the main branch did not move');
  for (const r of results) assert.equal(r.ok, true, JSON.stringify(r));
});

test('PM-16 RED-AT-da70c68e: per-worktree git state (a refs/worktree ref, a bisect) does not survive', () => {
  const { dir, ref } = fixtureRepo();
  for (const r of afterFirst(control('perworktree', { proof_command: 'node check.mjs perworktree' }), ref, dir, ref)) {
    assert.equal(r.ok, true, JSON.stringify(r));
  }
});

test('PM-17 RED-AT-da70c68e: under autocrlf, an LF rewrite a proof staged is checked out again with CRLF', () => {
  const { dir, ref } = fixtureRepo();
  git(dir, 'config', 'core.autocrlf', 'true');
  const results = withEnv({ KF_PM_EXPECT_CRLF: '1' }, () =>
    afterFirst(control('lf', { proof_command: 'node check.mjs lf' }), ref, dir, ref),
  );
  for (const r of results) assert.equal(r.ok, true, JSON.stringify(r));
});

test('PM-18 RED-AT-da70c68e: a proof that times out leaving a writer behind does not reach the next control', () => {
  const { dir, ref } = fixtureRepo();
  const hang = control('hang', { proof_command: 'node check.mjs hang', timeout_ms: 400 });
  const [second, third] = afterFirst(hang, ref, dir, ref);
  assert.equal(second.ok, true, JSON.stringify(second));
  assert.equal(third.ok, true, JSON.stringify(third));
});

test('PM-19 RED-AT-da70c68e and main: a proof that locks the worktree leaves no worktree behind', () => {
  const { dir, ref } = fixtureRepo();
  for (const r of afterFirst(control('lock', { proof_command: 'node check.mjs lock' }), ref, dir, ref)) {
    assert.equal(r.ok, true, JSON.stringify(r));
  }
  const listed = git(dir, 'worktree', 'list', '--porcelain').split('\n').filter((l) => l.startsWith('worktree '));
  assert.equal(listed.length, 1, 'no worktree left behind, locked or not: ' + listed.join(' | '));
});
