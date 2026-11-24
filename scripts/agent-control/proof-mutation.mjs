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
 * Resets `worktree` to exactly `commit` (a full commit id, resolved once by the caller) and checks it is pristine:
 * every tracked file as committed, in normal index state (no skip-worktree or assume-unchanged flag, no sparse
 * checkout: state a fresh worktree never has), no untracked or ignored file, HEAD at the commit. Returns { ok: true }
 * or { ok: false, detail }.
 */
export function resetToPristine(worktree, commit) {
  const target = run('git', ['rev-parse', '--verify', '--quiet', `${commit}^{commit}`], { cwd: worktree });
  if (target.status !== 0) return { ok: false, detail: `cannot resolve ${commit}` };
  const resolved = target.stdout.trim();
  // A proof may have turned on sparse checkout or flagged index entries; undo both before the reset, which keeps them.
  run('git', ['sparse-checkout', 'disable'], { cwd: worktree });
  const flagged = run('git', ['ls-files', '-v'], { cwd: worktree });
  if (flagged.status !== 0) return { ok: false, detail: `git ls-files failed: ${flagged.stderr.trim()}` };
  const unusual = flagged.stdout.split('\n').filter((l) => l && !l.startsWith('H ')).map((l) => l.slice(2));
  if (unusual.length > 0) {
    const cleared = run('git', ['update-index', '--no-skip-worktree', '--no-assume-unchanged', '--', ...unusual], { cwd: worktree });
    if (cleared.status !== 0) return { ok: false, detail: `git update-index failed: ${cleared.stderr.trim()}` };
  }
  const reset = run('git', ['reset', '--quiet', '--hard', resolved], { cwd: worktree });
  if (reset.status !== 0) return { ok: false, detail: `git reset failed: ${reset.stderr.trim()}` };
  const clean = run('git', ['clean', '-q', '-ffdx'], { cwd: worktree });
  if (clean.status !== 0) return { ok: false, detail: `git clean failed: ${clean.stderr.trim()}` };
  const status = run('git', ['status', '--porcelain', '--ignored'], { cwd: worktree });
  if (status.status !== 0 || status.stdout.trim() !== '') {
    return { ok: false, detail: `not pristine after reset: ${(status.stdout || status.stderr).trim().slice(0, 400)}` };
  }
  const after = run('git', ['ls-files', '-v'], { cwd: worktree });
  const stillUnusual = after.status !== 0 ? ['(ls-files failed)'] : after.stdout.split('\n').filter((l) => l && !l.startsWith('H '));
  if (stillUnusual.length > 0) return { ok: false, detail: `index not in normal state after reset: ${stillUnusual.slice(0, 5).join(', ')}` };
  const head = run('git', ['rev-parse', 'HEAD'], { cwd: worktree });
  if (head.status !== 0 || head.stdout.trim() !== resolved) return { ok: false, detail: `HEAD is not ${resolved} after reset` };
  return { ok: true };
}

function addWorktree(repoRoot, commit) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-proof-'));
  const added = run('git', ['worktree', 'add', '--detach', dir, commit], { cwd: repoRoot });
  return added.status === 0 ? { dir } : { dir: null, detail: added.stderr.trim() };
}

function removeWorktree(repoRoot, dir) {
  if (!dir) return;
  const removed = run('git', ['worktree', 'remove', '--force', dir], { cwd: repoRoot });
  if (removed.status !== 0) {
    // A worktree a proof broke (its .git file rewritten) cannot be removed by git: remove it and prune the record.
    fs.rmSync(dir, { recursive: true, force: true });
    run('git', ['worktree', 'prune'], { cwd: repoRoot });
  }
}

export function runManifest(manifest, options = {}) {
  const repoRoot = options.repoRoot || process.cwd();
  const ref = options.ref || 'HEAD';
  const results = [];
  const controls = manifest.negative_controls || [];
  if (controls.length === 0) return { total: 0, live: 0, vacuous: 0, results };

  // The ref is resolved once, in the repository (never inside the worktree, where a proof's own commit would move
  // HEAD): every control starts from this exact commit.
  const resolved = run('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { cwd: repoRoot });
  const commit = resolved.status === 0 ? resolved.stdout.trim() : null;
  let worktree = commit ? addWorktree(repoRoot, commit) : { dir: null, detail: `cannot resolve ${ref}` };
  if (!worktree.dir) {
    for (const entry of controls) results.push({ id: entry.id, ok: false, stage: 'worktree', detail: worktree.detail });
    return { total: results.length, live: 0, vacuous: results.length, results };
  }

  try {
    for (const entry of controls) {
      let pristine = resetToPristine(worktree.dir, commit);
      if (!pristine.ok) {
        // Whatever the last proof left, the next control gets what the per-control design gave it: a fresh worktree
        // at the commit, checked the same way. Only if that too cannot be made pristine does this control fail.
        removeWorktree(repoRoot, worktree.dir);
        worktree = addWorktree(repoRoot, commit);
        pristine = worktree.dir ? resetToPristine(worktree.dir, commit) : { ok: false, detail: worktree.detail };
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
    removeWorktree(repoRoot, worktree.dir);
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
