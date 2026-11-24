#!/usr/bin/env node
/**
 * Fail-closed verifier for sharded Vitest JSON reports (P24: FU-CI-SHARD-PARALLEL, C3).
 *
 * Usage:
 *   node scripts/ci/verify-vitest-shards.mjs \
 *     --shards-dir .proof/server-shards \
 *     --total-shards 4 \
 *     [--root .] \
 *     [--subdir apps/server]
 *
 * Exits 0 ONLY when:
 *   1. All shard-1.json .. shard-N.json exist, parse as JSON, and have
 *      success === true, numFailedTestSuites === 0, numFailedTests === 0.
 *   2. Every suite entry in every shard has status === 'passed'.
 *   3. Every tracked test file under <subdir> (git ls-files matching Vitest's
 *      default `*.{spec,test}.?(c|m)[jt]s?(x)` pattern, excluding dist/ and
 *      node_modules/) appears in EXACTLY ONE shard (0 missing, 0 duplicates,
 *      0 unexpected files).
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const TEST_FILE_RE = /\.(spec|test)\.[cm]?[jt]sx?$/;
const EXCLUDED_SEGMENTS_RE = /(?:^|\/)(?:dist|node_modules)\//;

function parseArgs(argv) {
  const out = { root: process.cwd(), subdir: 'apps/server', shardsDir: null, totalShards: null };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const next = argv[i + 1];
    if (flag === '--root' && next) {
      out.root = next;
      i += 1;
    } else if (flag === '--subdir' && next) {
      out.subdir = next;
      i += 1;
    } else if (flag === '--shards-dir' && next) {
      out.shardsDir = next;
      i += 1;
    } else if (flag === '--total-shards' && next) {
      out.totalShards = Number(next);
      i += 1;
    } else {
      throw new Error(`Unknown or incomplete argument: ${flag}`);
    }
  }
  if (!out.shardsDir) throw new Error('Missing required --shards-dir');
  if (!Number.isInteger(out.totalShards) || out.totalShards < 1) {
    throw new Error(`--total-shards must be a positive integer, got: ${out.totalShards}`);
  }
  return out;
}

function toPosix(p) {
  return p.replace(/\\/g, '/');
}

function expectedTestFiles(rootDir, subdir) {
  const normalizedSubdir = toPosix(subdir).replace(/^\/+|\/+$/g, '');
  const res = spawnSync('git', ['ls-files', '-z', '--', normalizedSubdir], {
    cwd: rootDir,
    encoding: 'utf8',
  });
  if (res.status !== 0) {
    throw new Error(`git ls-files failed in ${rootDir}: ${res.stderr}`);
  }
  return res.stdout
    .split('\0')
    .filter(Boolean)
    .map(toPosix)
    .filter((f) => TEST_FILE_RE.test(f) && !EXCLUDED_SEGMENTS_RE.test(f))
    .sort();
}

function normalizeReportedPath(rawName, rootDir, subdir) {
  if (typeof rawName !== 'string' || rawName.trim() === '') return null;
  const normalizedSubdir = toPosix(subdir).replace(/^\/+|\/+$/g, '');
  const posixRaw = toPosix(rawName);
  const resolvedRoot = toPosix(path.resolve(rootDir)).replace(/\/+$/, '');

  let rel = null;
  if (posixRaw.startsWith(`${resolvedRoot}/`)) {
    rel = posixRaw.slice(resolvedRoot.length + 1);
  } else if (posixRaw.startsWith(`${normalizedSubdir}/`)) {
    rel = posixRaw;
  } else {
    const marker = `/${normalizedSubdir}/`;
    const idx = posixRaw.lastIndexOf(marker);
    if (idx !== -1) {
      rel = `${normalizedSubdir}/${posixRaw.slice(idx + marker.length)}`;
    }
  }
  if (!rel) return null;
  const clean = path.posix.normalize(rel);
  if (clean.startsWith('..') || !clean.startsWith(`${normalizedSubdir}/`)) return null;
  return clean;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const rootDir = path.resolve(args.root);
  const shardsDir = path.resolve(args.shardsDir);
  const problems = [];

  const expected = expectedTestFiles(rootDir, args.subdir);
  if (expected.length === 0) {
    problems.push(`No expected test files discovered under ${args.subdir}`);
  }
  const expectedSet = new Set(expected);

  if (!fs.existsSync(shardsDir) || !fs.statSync(shardsDir).isDirectory()) {
    problems.push(`Shards directory does not exist: ${shardsDir}`);
  }

  const seenByFile = new Map();
  let totalPassedSuites = 0;

  if (problems.length === 0) {
    const expectedShardNames = new Set();
    for (let i = 1; i <= args.totalShards; i += 1) {
      expectedShardNames.add(`shard-${i}.json`);
    }

    const dirEntries = fs.readdirSync(shardsDir).filter((f) => f.endsWith('.json')).sort();
    for (const entry of dirEntries) {
      if (!expectedShardNames.has(entry)) {
        problems.push(`Unexpected extra shard report found: ${entry}`);
      }
    }

    for (let shard = 1; shard <= args.totalShards; shard += 1) {
      const fileName = `shard-${shard}.json`;
      const fullPath = path.join(shardsDir, fileName);
      if (!fs.existsSync(fullPath)) {
        problems.push(`Missing shard report: ${fileName}`);
        continue;
      }

      let report;
      try {
        report = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
      } catch (err) {
        problems.push(`Invalid JSON in ${fileName}: ${err.message}`);
        continue;
      }

      if (report?.success !== true) {
        problems.push(`${fileName}: report.success is ${JSON.stringify(report?.success)}, expected true`);
      }
      if (report?.numFailedTestSuites !== 0) {
        problems.push(`${fileName}: numFailedTestSuites is ${JSON.stringify(report?.numFailedTestSuites)}, expected 0`);
      }
      if (report?.numFailedTests !== 0) {
        problems.push(`${fileName}: numFailedTests is ${JSON.stringify(report?.numFailedTests)}, expected 0`);
      }
      if (report?.numPendingTestSuites !== 0) {
        problems.push(`${fileName}: numPendingTestSuites is ${JSON.stringify(report?.numPendingTestSuites)}, expected 0`);
      }
      if (!Array.isArray(report?.testResults)) {
        problems.push(`${fileName}: missing testResults array`);
        continue;
      }

      for (const suite of report.testResults) {
        const rel = normalizeReportedPath(suite?.name, rootDir, args.subdir);
        if (!rel) {
          problems.push(`${fileName}: could not normalize suite path ${JSON.stringify(suite?.name)}`);
          continue;
        }
        if (suite?.status !== 'passed') {
          problems.push(`${fileName}: suite ${rel} status is ${JSON.stringify(suite?.status)}, expected "passed"`);
        }
        if (!Array.isArray(suite?.assertionResults)) {
          problems.push(`${fileName}: suite ${rel} missing assertionResults array`);
        } else {
          for (const assertion of suite.assertionResults) {
            if (!assertion || typeof assertion !== 'object') {
              problems.push(`${fileName}: suite ${rel} has non-object entry in assertionResults`);
              continue;
            }
            if (assertion.status === 'failed' || assertion.status === 'pending') {
              problems.push(
                `${fileName}: suite ${rel} assertion ${JSON.stringify(assertion.fullName ?? assertion.title ?? 'unknown')} has status ${JSON.stringify(assertion.status)}`,
              );
            }
          }
        }
        if (seenByFile.has(rel)) {
          problems.push(`Duplicate test file across shards: ${rel} (shard ${seenByFile.get(rel)} and shard ${shard})`);
        } else {
          seenByFile.set(rel, shard);
          totalPassedSuites += 1;
        }
      }
    }

    const missing = expected.filter((f) => !seenByFile.has(f));
    if (missing.length > 0) {
      problems.push(
        `Missing ${missing.length} expected test file(s): ${missing.slice(0, 10).join(', ')}${missing.length > 10 ? ', ...' : ''}`,
      );
    }

    const unexpected = [...seenByFile.keys()].filter((f) => !expectedSet.has(f)).sort();
    if (unexpected.length > 0) {
      problems.push(
        `Unexpected ${unexpected.length} reported test file(s) not in git ls-files: ${unexpected.slice(0, 10).join(', ')}${unexpected.length > 10 ? ', ...' : ''}`,
      );
    }
  }

  if (problems.length > 0) {
    for (const p of problems) {
      console.error(`ERROR: ${p}`);
    }
    process.exit(1);
  }

  console.log(
    `VERIFIED: ${args.totalShards} shards, ${totalPassedSuites}/${expected.length} unique ${args.subdir} test files passed (0 missing, 0 duplicates, 0 failures)`,
  );
}

try {
  main();
} catch (err) {
  console.error(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
