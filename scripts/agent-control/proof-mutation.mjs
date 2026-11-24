#!/usr/bin/env node
/**
 * AUTO-PROOF-MUTATION — generic negative-control runner.
 *
 * A proof that cannot fail proves nothing. This runner takes a manifest in
 * which each critical claim declares:
 *   - the defect to restore (an exact text substitution), and
 *   - the proof command that MUST fail once the defect is restored.
 *
 * It then verifies, for each entry:
 *   1. the proof passes on the unmutated tree, and
 *   2. the proof fails on the mutated tree.
 * Either half missing means the negative control is vacuous.
 *
 * Isolation: mutations are applied inside a throwaway `git worktree` built
 * from a commit-ish. The working tree, the branch and main are never touched.
 * One worktree serves the whole run (FU-CI-NC-WORKTREE-REUSE, D-274): before
 * each control it is reset to the exact commit and must then be pristine (no
 * change, untracked or ignored file, HEAD at the commit), or that control fails
 * without running. Creating and removing a full worktree per control was 89% of
 * the Windows worker proof's hour.
 *
 * Usage:
 *   node scripts/agent-control/proof-mutation.mjs --manifest <path> [--ref HEAD] [--json]
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseYaml } from './lib/yaml.mjs';

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function run(cmd, args, options = {}) {
  return spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, ...options });
}

/** Variables that tell git which repository, index or tree to use: the runner's own git calls never inherit them. */
const GIT_LOCATION_VARS = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY', 'GIT_NAMESPACE'];
const gitEnv = () => {
  const env = { ...process.env };
  for (const name of GIT_LOCATION_VARS) delete env[name];
  return env;
};

/** git in `cwd`, discovering the repository from there. */
function git(cwd, ...args) {
  return run('git', args, { cwd, env: gitEnv() });
}

/** git pinned to one worktree: never discovered through its `.git` file, which a proof may have rewritten. */
function pinned(worktree, ...args) {
  return run('git', [`--git-dir=${worktree.gitDir}`, `--work-tree=${worktree.dir}`, ...args], { cwd: worktree.dir, env: gitEnv() });
}

const samePath = (a, b) => {
  try {
    return fs.realpathSync.native(a) === fs.realpathSync.native(b);
  } catch {
    return false;
  }
};

function runShell(command, cwd, timeout) {
  return spawnSync(command, { shell: true, cwd, encoding: 'utf8', timeout: timeout || 900_000, maxBuffer: 32 * 1024 * 1024 });
}

export function applyMutation(root, mutation) {
  const file = path.join(root, mutation.file);
  if (!fs.existsSync(file)) return { ok: false, reason: `file not found: ${mutation.file}` };
  const before = fs.readFileSync(file, 'utf8');

  // The worktree is a fresh checkout, so on Windows git rewrites LF to CRLF.
  // A multi-line `find` written with LF would then never match and the control
  // would report VACUOUS for a bookkeeping reason rather than a real one.
  // Match the file's own convention instead of assuming either.
  const fileUsesCrlf = before.includes('\r\n');
  const toFileEol = (text) => {
    const lf = String(text).replace(/\r\n/g, '\n');
    return fileUsesCrlf ? lf.replace(/\n/g, '\r\n') : lf;
  };
  mutation = { ...mutation, find: toFileEol(mutation.find), replace: toFileEol(mutation.replace) };

  const occurrences = before.split(mutation.find).length - 1;
  if (occurrences === 0) return { ok: false, reason: `mutation target not found in ${mutation.file}` };
  if (occurrences > 1 && !mutation.replace_all) {
    return { ok: false, reason: `mutation target occurs ${occurrences} times in ${mutation.file}; refusing an ambiguous edit` };
  }
  const after = mutation.replace_all
    ? before.split(mutation.find).join(mutation.replace)
    : before.replace(mutation.find, mutation.replace);
  if (after === before) return { ok: false, reason: 'mutation produced no change' };
  fs.writeFileSync(file, after, 'utf8');
  return { ok: true, occurrences };
}

/**
 * Resets a worktree ({ dir, gitDir }: the git dir recorded when it was added) to exactly `commit` (a full commit id,
 * resolved once by the caller) and checks it is pristine. Returns { ok: true } or { ok: false, detail }.
 *
 * Pristine is what a fresh worktree is: git in the directory finds this worktree's own git dir (a proof may have
 * rewritten `.git` to point anywhere, the main repository included); no sparse checkout and no index entry flagged
 * skip-worktree or assume-unchanged; every tracked file as committed; no untracked or ignored file; HEAD at the commit.
 * Every git call that changes anything is pinned to the recorded git dir and the directory, so it never follows a
 * rewritten `.git`; and nothing here writes the repository's config. State a reset cannot undo (sparse checkout, a
 * flagged entry, a redirected `.git`) is reported as not pristine, and the caller recreates the worktree.
 *
 * `worktree` may be a bare directory (a checkout whose own git dir is found from it): its git dir is then read once.
 */
export function resetToPristine(worktree, commit) {
  if (typeof worktree === 'string') {
    const found = git(worktree, 'rev-parse', '--absolute-git-dir');
    if (found.status !== 0) return { ok: false, detail: `not a git checkout: ${worktree}` };
    worktree = { dir: worktree, gitDir: found.stdout.trim() };
  }
  // 1. The directory must still be this worktree (read only, by discovery, as the proof will see it).
  const gitDir = git(worktree.dir, 'rev-parse', '--absolute-git-dir');
  const top = git(worktree.dir, 'rev-parse', '--show-toplevel');
  if (gitDir.status !== 0 || top.status !== 0 || !samePath(gitDir.stdout.trim(), worktree.gitDir) || !samePath(top.stdout.trim(), worktree.dir)) {
    return { ok: false, detail: `the worktree's .git no longer leads to its own git dir (${(gitDir.stdout || gitDir.stderr).trim()})` };
  }
  const target = pinned(worktree, 'rev-parse', '--verify', '--quiet', `${commit}^{commit}`);
  if (target.status !== 0) return { ok: false, detail: `cannot resolve ${commit}` };
  const resolved = target.stdout.trim();
  // 2. State a reset keeps: sparse checkout, flagged index entries. Read only; a tree with either is not pristine.
  const sparse = pinned(worktree, 'config', '--bool', 'core.sparseCheckout');
  if (sparse.stdout.trim() === 'true') return { ok: false, detail: 'sparse checkout is on' };
  const flagged = () => {
    const listed = pinned(worktree, 'ls-files', '-v', '-z');
    if (listed.status !== 0) return [`(git ls-files failed: ${listed.stderr.trim()})`];
    return listed.stdout.split('\0').filter((entry) => entry && !entry.startsWith('H '));
  };
  const before = flagged();
  if (before.length > 0) return { ok: false, detail: `index entries not in normal state: ${before.slice(0, 5).join(', ')}` };
  // 3. Reset and clean, pinned.
  const reset = pinned(worktree, 'reset', '--quiet', '--hard', resolved);
  if (reset.status !== 0) return { ok: false, detail: `git reset failed: ${reset.stderr.trim()}` };
  const clean = pinned(worktree, 'clean', '-q', '-ffdx');
  if (clean.status !== 0) return { ok: false, detail: `git clean failed: ${clean.stderr.trim()}` };
  // 4. Check the result.
  const status = pinned(worktree, 'status', '--porcelain', '--ignored');
  if (status.status !== 0 || status.stdout.trim() !== '') {
    return { ok: false, detail: `not pristine after reset: ${(status.stdout || status.stderr).trim().slice(0, 400)}` };
  }
  const after = flagged();
  if (after.length > 0) return { ok: false, detail: `index not in normal state after reset: ${after.slice(0, 5).join(', ')}` };
  const head = pinned(worktree, 'rev-parse', 'HEAD');
  if (head.status !== 0 || head.stdout.trim() !== resolved) return { ok: false, detail: `HEAD is not ${resolved} after reset` };
  return { ok: true };
}

function addWorktree(repoRoot, commit) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-proof-'));
  const added = git(repoRoot, 'worktree', 'add', '--detach', dir, commit);
  if (added.status !== 0) return { dir: null, detail: added.stderr.trim() };
  // Its own git dir, recorded before any proof runs: every later git call is pinned to it.
  const gitDir = git(dir, 'rev-parse', '--absolute-git-dir');
  if (gitDir.status !== 0) {
    removeWorktree(repoRoot, dir);
    return { dir: null, detail: `cannot read the new worktree's git dir: ${gitDir.stderr.trim()}` };
  }
  return { dir, gitDir: gitDir.stdout.trim() };
}

/**
 * Removes a worktree. One a proof broke (its .git rewritten) cannot be removed by git: it is deleted and its record
 * pruned. A delete that fails (EBUSY or EPERM on Windows, for a file another process holds) is reported, never thrown,
 * so the run still ends with its summary. Returns { ok: true } or { ok: false, detail }.
 */
export function removeWorktree(repoRoot, dir, rm = fs.rmSync) {
  if (!dir) return { ok: true };
  const removed = git(repoRoot, 'worktree', 'remove', '--force', dir);
  if (removed.status === 0) return { ok: true };
  try {
    rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch (error) {
    return { ok: false, detail: `could not delete ${dir}: ${error.message}` };
  } finally {
    git(repoRoot, 'worktree', 'prune');
  }
  return { ok: true };
}

export function runManifest(manifest, options = {}) {
  const repoRoot = options.repoRoot || process.cwd();
  const ref = options.ref || 'HEAD';
  const results = [];
  const controls = manifest.negative_controls || [];
  if (controls.length === 0) return { total: 0, live: 0, vacuous: 0, results };

  // The ref is resolved once, in the repository (never inside the worktree, where a proof's own commit would move
  // HEAD): every control starts from this exact commit.
  const resolved = git(repoRoot, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`);
  const commit = resolved.status === 0 ? resolved.stdout.trim() : null;
  let worktree = commit ? addWorktree(repoRoot, commit) : { dir: null, detail: `cannot resolve ${ref}` };
  if (!worktree.dir) {
    for (const entry of controls) results.push({ id: entry.id, ok: false, stage: 'worktree', detail: worktree.detail });
    return { total: results.length, live: 0, vacuous: results.length, results };
  }

  try {
    for (const entry of controls) {
      let pristine = resetToPristine(worktree, commit);
      if (!pristine.ok) {
        // Whatever the last proof left, the next control gets what the per-control design gave it: a fresh worktree
        // at the commit, checked the same way. Only if that too cannot be made pristine does this control fail.
        const removed = removeWorktree(repoRoot, worktree.dir);
        if (!removed.ok) process.stderr.write(`proof-mutation: ${removed.detail}\n`);
        worktree = addWorktree(repoRoot, commit);
        pristine = worktree.dir ? resetToPristine(worktree, commit) : { ok: false, detail: worktree.detail };
      }
      if (!pristine.ok) {
        // Never run a control on a tree that is not exactly the commit: its verdict would prove nothing.
        results.push({ id: entry.id, ok: false, stage: 'reset', detail: pristine.detail });
        if (!worktree.dir) break;
        continue;
      }

      // 1. Baseline: the proof must pass before the defect is restored.
      const baseline = runShell(entry.proof_command, worktree.dir, entry.timeout_ms);
      const baselinePassed = baseline.status === 0;

      // 2. Restore the defect.
      const mutated = applyMutation(worktree.dir, entry.mutation);
      if (!mutated.ok) {
        results.push({ id: entry.id, ok: false, stage: 'mutation', detail: mutated.reason, baseline_passed: baselinePassed });
        continue;
      }

      // 3. The proof must now fail. If it still passes, it never tested the claim.
      const after = runShell(entry.proof_command, worktree.dir, entry.timeout_ms);
      const failedAsRequired = after.status !== 0;

      results.push({
        id: entry.id,
        claim: entry.claim || null,
        ok: baselinePassed && failedAsRequired,
        baseline_passed: baselinePassed,
        failed_when_defect_restored: failedAsRequired,
        detail: baselinePassed
          ? failedAsRequired
            ? 'negative control is live'
            : 'VACUOUS: proof still passes with the defect restored'
          : 'proof does not pass on the clean tree',
      });
    }
  } finally {
    const removed = removeWorktree(repoRoot, worktree.dir);
    if (!removed.ok) process.stderr.write(`proof-mutation: ${removed.detail}\n`);
  }

  // Controls never reached (the worktree could not be recreated) are reported, never silently dropped.
  for (const entry of controls.slice(results.length)) results.push({ id: entry.id, ok: false, stage: 'worktree', detail: 'no worktree' });

  return {
    total: results.length,
    live: results.filter((r) => r.ok).length,
    vacuous: results.filter((r) => !r.ok).length,
    results,
  };
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith('proof-mutation.mjs');
if (invokedDirectly) {
  const manifestPath = arg('--manifest', 'scripts/agent-control/negative-controls.yaml');
  if (!fs.existsSync(manifestPath)) {
    process.stderr.write(`manifest not found: ${manifestPath}\n`);
    process.exit(2);
  }
  const manifest = parseYaml(fs.readFileSync(manifestPath, 'utf8'));
  const summary = runManifest(manifest, { repoRoot: process.cwd(), ref: arg('--ref', 'HEAD') });

  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
  } else {
    for (const r of summary.results) {
      process.stdout.write(`${r.ok ? 'LIVE   ' : 'VACUOUS'}  ${r.id}  ${r.detail}\n`);
    }
    process.stdout.write(`\n${summary.live}/${summary.total} negative controls are live\n`);
  }
  process.exit(summary.vacuous === 0 ? 0 : 1);
}

export default { runManifest, applyMutation };
