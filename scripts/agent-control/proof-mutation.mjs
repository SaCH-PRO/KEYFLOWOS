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

export function runManifest(manifest, options = {}) {
  const repoRoot = options.repoRoot || process.cwd();
  const ref = options.ref || 'HEAD';
  const results = [];

  for (const entry of manifest.negative_controls || []) {
    const worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-proof-'));
    const added = run('git', ['worktree', 'add', '--detach', worktree, ref], { cwd: repoRoot });
    if (added.status !== 0) {
      results.push({ id: entry.id, ok: false, stage: 'worktree', detail: added.stderr.trim() });
      continue;
    }

    try {
      // 1. Baseline: the proof must pass before the defect is restored.
      const baseline = runShell(entry.proof_command, worktree, entry.timeout_ms);
      const baselinePassed = baseline.status === 0;

      // 2. Restore the defect.
      const mutated = applyMutation(worktree, entry.mutation);
      if (!mutated.ok) {
        results.push({ id: entry.id, ok: false, stage: 'mutation', detail: mutated.reason, baseline_passed: baselinePassed });
        continue;
      }

      // 3. The proof must now fail. If it still passes, it never tested the claim.
      const after = runShell(entry.proof_command, worktree, entry.timeout_ms);
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
    } finally {
      run('git', ['worktree', 'remove', '--force', worktree], { cwd: repoRoot });
    }
  }

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
