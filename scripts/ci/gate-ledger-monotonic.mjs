#!/usr/bin/env node
// RR-GATE-LEDGER-MONOTONIC (REC-ANTI-FAKE-GREEN, D-261, D-262, D-239):
// Compares every registered shrink-only ledger and floor ratchet between a
// base ref and a head ref using `git show`, failing (exit 1) if any ledger
// moves against its declared direction or fails to parse at head.
//
// Deliberately accepts NO override flags or bypass environment variables:
// legitimate ledger growth stays red so human owner authority decides (D-239).

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { measure } from '../os/ledger-sizes.mjs';

const ZERO_SHA = '0000000000000000000000000000000000000000';

function assertSafeGitRef(ref, label) {
  if (typeof ref !== 'string' || ref.trim() === '' || ref.startsWith('-')) {
    throw new Error(`Invalid ${label} git ref: ${String(ref)}`);
  }
  return ref.trim();
}

function makeGitShowReader(cwd, ref) {
  const safeRef = assertSafeGitRef(ref, 'git');
  const cache = new Map();
  return (relPath) => {
    if (cache.has(relPath)) return cache.get(relPath);
    let content = null;
    try {
      content = execFileSync('git', ['show', `${safeRef}:${relPath}`], {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: 32 * 1024 * 1024,
      });
    } catch {
      content = null;
    }
    cache.set(relPath, content);
    return content;
  };
}

function verifyRefExists(cwd, ref, label) {
  const safeRef = assertSafeGitRef(ref, label);
  try {
    return execFileSync('git', ['rev-parse', '--verify', `${safeRef}^{commit}`], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (err) {
    throw new Error(`Unable to resolve ${label} ref "${safeRef}": ${err?.message ?? err}`);
  }
}

/**
 * Compare measured ledger results at base and head.
 * - Any error at head (parse failure, missing file, anti-vacuity) fails.
 * - A ledger absent at base (file or constant did not exist yet) is recorded
 *   as `new` and passes.
 * - Direction rules:
 *     shrink: head > base -> violation
 *     grow:   head < base -> violation
 *     fixed:  head !== base -> violation
 */
export function compare(baseMeasured, headMeasured) {
  const baseByName = new Map((baseMeasured?.results ?? []).map((r) => [r.name, r]));
  const violations = [];
  const added = [];
  const entries = [];
  const errors = [...(headMeasured?.errors ?? [])];

  for (const h of headMeasured?.results ?? []) {
    const b = baseByName.get(h.name);
    if (!b) {
      const rec = { name: h.name, direction: h.direction, base: null, head: h.value, status: 'new' };
      added.push(rec);
      entries.push(rec);
      continue;
    }
    let violated = false;
    let status = 'ok';
    if (h.direction === 'shrink') {
      if (h.value > b.value) violated = true;
      else if (h.value < b.value) status = 'improved';
    } else if (h.direction === 'grow') {
      if (h.value < b.value) violated = true;
      else if (h.value > b.value) status = 'improved';
    } else if (h.direction === 'fixed') {
      if (h.value !== b.value) violated = true;
    } else {
      errors.push(`${h.name}: unknown direction "${h.direction}"`);
      continue;
    }
    const rec = {
      name: h.name,
      file: h.file,
      direction: h.direction,
      base: b.value,
      head: h.value,
      status: violated ? 'violation' : status,
    };
    if (violated) violations.push(rec);
    entries.push(rec);
  }

  return {
    ok: errors.length === 0 && violations.length === 0,
    entries,
    added,
    violations,
    errors,
  };
}

/**
 * Resolve base and head commits in `cwd`, measure every registered ledger at
 * both trees via `git show`, and return the monotonic comparison report.
 */
export function compareRefs({ cwd = process.cwd(), baseRef, headRef = 'HEAD' }) {
  const resolvedBase = verifyRefExists(cwd, baseRef, 'base');
  const resolvedHead = verifyRefExists(cwd, headRef, 'head');

  const baseMeasured = measure(makeGitShowReader(cwd, resolvedBase));
  const headMeasured = measure(makeGitShowReader(cwd, resolvedHead));
  const report = compare(baseMeasured, headMeasured);
  return {
    baseSha: resolvedBase,
    headSha: resolvedHead,
    ...report,
  };
}

export function resolveBaseRef({
  cwd = process.cwd(),
  eventName = process.env.GITHUB_EVENT_NAME ?? '',
  prBaseSha = process.env.GITHUB_PR_BASE_SHA ?? '',
  mergeGroupBaseSha = process.env.GITHUB_MERGE_GROUP_BASE_SHA ?? '',
  beforeSha = process.env.GITHUB_BEFORE_SHA ?? '',
  headRef = 'HEAD',
} = {}) {
  if (eventName === 'pull_request' && prBaseSha && prBaseSha !== ZERO_SHA) {
    return prBaseSha;
  }
  if (eventName === 'merge_group' && mergeGroupBaseSha && mergeGroupBaseSha !== ZERO_SHA) {
    return mergeGroupBaseSha;
  }
  if (eventName === 'push' && beforeSha && beforeSha !== ZERO_SHA) {
    return beforeSha;
  }
  // Fallback for initial branch push (all-zeros before SHA) or local/manual runs.
  try {
    const mb = execFileSync('git', ['merge-base', 'origin/main', assertSafeGitRef(headRef, 'head')], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    if (mb) return mb;
  } catch {
    // Fall through to parent commit when origin/main is unavailable.
  }
  return verifyRefExists(cwd, `${assertSafeGitRef(headRef, 'head')}~1`, 'base');
}

function parseCliArgs(argv) {
  let baseRef = null;
  let headRef = 'HEAD';
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--base') {
      if (i + 1 >= argv.length) throw new Error('--base requires a value');
      baseRef = argv[++i];
    } else if (arg === '--head') {
      if (i + 1 >= argv.length) throw new Error('--head requires a value');
      headRef = argv[++i];
    } else {
      throw new Error(`Unknown argument "${arg}" (only --base <ref> and --head <ref> are accepted; no overrides exist)`);
    }
  }
  return { baseRef, headRef };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const { baseRef: cliBase, headRef } = parseCliArgs(process.argv.slice(2));
    const cwd = process.cwd();
    const baseRef = cliBase ?? resolveBaseRef({ cwd, headRef });
    const report = compareRefs({ cwd, baseRef, headRef });

    console.log(`gate-ledger-monotonic: ${report.baseSha.slice(0, 12)} -> ${report.headSha.slice(0, 12)}`);
    for (const e of report.entries) {
      const from = e.base === null ? 'absent' : String(e.base);
      console.log(`  ${e.name} (${e.direction}): ${from} -> ${e.head} [${e.status}]`);
    }
    if (report.errors.length > 0) {
      console.error(`\ngate-ledger-monotonic: ${report.errors.length} head parse/vacuity error(s):`);
      for (const err of report.errors) console.error(`  - ${err}`);
    }
    if (report.violations.length > 0) {
      console.error(`\ngate-ledger-monotonic: ${report.violations.length} monotonic violation(s):`);
      for (const v of report.violations) {
        console.error(`  - ${v.name} (${v.direction}): ${v.base} -> ${v.head} (${v.file})`);
      }
    }
    process.exit(report.ok ? 0 : 1);
  } catch (err) {
    console.error(`gate-ledger-monotonic: ${err?.message ?? err}`);
    process.exit(1);
  }
}
