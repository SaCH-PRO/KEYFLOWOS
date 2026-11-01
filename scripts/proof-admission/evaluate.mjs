#!/usr/bin/env node
/**
 * Proof admission: judge one vitest JSON report against one case manifest.
 *
 *   node scripts/proof-admission/evaluate.mjs --manifest <json> --report <json> [--expect-head <sha>]
 *
 * SUITE BINDING (R0-16-PROOF-BINDING). A case manifest names the suite files
 * it binds, relative to apps/server, in `suites`: each entry is a path, or
 * { "path": ..., "needsDist": true } for a suite that spawns dist/main.js. A
 * manifest with no `suites` field falls back to the files named by the
 * `npx vitest run ...` command in its description. One with neither is
 * KF_PROOF_MANIFEST_UNBOUND, so a manifest cannot silently bind nothing.
 *
 * Every check reads only the assertions of the bound suites: required cases
 * are looked up there, a duplicate or (allowAdditionalCases false) an
 * unexpected case is judged there, and requireReportSuccess means every bound
 * suite passed. So one combined report (scripts/proof-admission/run-manifests.mjs
 * runs the union of every manifest's suites once) can be judged against every
 * manifest, and a case of a suite another manifest binds is not "unexpected"
 * here. A bound suite absent from the report is KF_PROOF_BOUND_SUITE_MISSING.
 *
 * EXACT HEAD. The receipt carries sourceHead (HEAD of the checkout this
 * script belongs to) and sourceTreeClean (no tracked file differs from HEAD
 * and no untracked file sits under SOURCE_PATHS; see sourceTreeState). With
 * --expect-head the verdict is REJECTED (KF_PROOF_HEAD_MISMATCH) unless
 * sourceHead is exactly that sha. sourceHead names the evaluator's checkout,
 * not the report: a vitest report carries no commit, so this script alone
 * cannot say where a report came from. Only run-manifests.mjs, which runs the
 * suites itself on a clean tree, issues an exact-head receipt.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const EXIT = Object.freeze({
  SATISFIED: 0,
  REJECTED: 2,
  INCOMPLETE: 3,
});

const HEAD_SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

function normalizeCaseId(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function verdict(status, reasons, details = {}) {
  return {
    status,
    reasons,
    ...details,
  };
}

function validateManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return ['KF_PROOF_MANIFEST_UNTRUSTED'];
  }
  if (manifest.manifestVersion !== 1) {
    return ['KF_PROOF_MANIFEST_UNTRUSTED'];
  }
  if (typeof manifest.packageId !== 'string' || manifest.packageId.length === 0) {
    return ['KF_PROOF_MANIFEST_UNTRUSTED'];
  }
  if (!Array.isArray(manifest.requiredCases) || manifest.requiredCases.length === 0) {
    return ['KF_PROOF_MANIFEST_UNTRUSTED'];
  }
  if (
    manifest.maxReportAgeSeconds !== undefined &&
    (!Number.isFinite(manifest.maxReportAgeSeconds) || manifest.maxReportAgeSeconds <= 0)
  ) {
    return ['KF_PROOF_MANIFEST_UNTRUSTED'];
  }

  const ids = manifest.requiredCases.map(normalizeCaseId);
  if (ids.some((id) => id.length === 0)) {
    return ['KF_PROOF_MANIFEST_UNTRUSTED'];
  }
  if (new Set(ids).size !== ids.length) {
    return ['KF_PROOF_MANIFEST_DUPLICATE_CASE_ID'];
  }
  return [];
}

/** A suite path relative to apps/server: not absolute, no `.` or `..` segment, no backslash. */
function isPlainSuitePath(value) {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) return false;
  if (value.startsWith('/') || value.includes('\\') || /^[A-Za-z]:/.test(value)) return false;
  return value.split('/').every((part) => part.length > 0 && part !== '.' && part !== '..');
}

const TEST_FILE = /^[A-Za-z0-9_@./-]+\.(?:spec|test)\.[cm]?[jt]sx?$/;
const OPTIONS_WITH_VALUE = new Set(['-c', '--config', '--project', '--dir', '--root']);

/**
 * The files named by every `npx vitest run ...` command in a description: the
 * test-file tokens after `vitest run`, skipping options, up to the first token
 * that is neither (so prose after the command binds nothing). Each occurrence
 * of `vitest run` is scanned on its own: a description is one line of JSON,
 * so a later command on the same line (or a real command after a prose
 * mention of `vitest run`) binds its files too.
 */
export function descriptionSuites(description) {
  if (typeof description !== 'string') return [];
  const found = [];
  const command = /\bvitest\s+run\b/g;
  let match;
  while ((match = command.exec(description)) !== null) {
    // The rest of this line; the next exec starts right after this `vitest run`.
    const rest = description.slice(command.lastIndex).split('\n', 1)[0];
    const tokens = rest.trim().split(/\s+/);
    for (let i = 0; i < tokens.length; i += 1) {
      const token = tokens[i].replace(/[,;)]+$/, '');
      if (OPTIONS_WITH_VALUE.has(token)) {
        i += 1;
        continue;
      }
      if (token.startsWith('-')) continue;
      if (!TEST_FILE.test(token) || !isPlainSuitePath(token)) break;
      if (!found.includes(token)) found.push(token);
    }
  }
  return found;
}

/**
 * The suites a manifest binds: { suites: [{ path, needsDist }], source } with
 * source 'suites' or 'description', or { error }: KF_PROOF_MANIFEST_UNTRUSTED
 * for a malformed `suites`, KF_PROOF_MANIFEST_UNBOUND when nothing is bound.
 */
export function manifestSuites(manifest) {
  if (manifest && typeof manifest === 'object' && Object.prototype.hasOwnProperty.call(manifest, 'suites')) {
    if (!Array.isArray(manifest.suites)) return { error: 'KF_PROOF_MANIFEST_UNTRUSTED' };
    const suites = [];
    for (const entry of manifest.suites) {
      const isObject = entry !== null && typeof entry === 'object' && !Array.isArray(entry);
      const path = isObject ? entry.path : entry;
      if (!isPlainSuitePath(path)) return { error: 'KF_PROOF_MANIFEST_UNTRUSTED' };
      if (isObject && entry.needsDist !== undefined && typeof entry.needsDist !== 'boolean') {
        return { error: 'KF_PROOF_MANIFEST_UNTRUSTED' };
      }
      if (suites.some((s) => s.path === path)) return { error: 'KF_PROOF_MANIFEST_UNTRUSTED' };
      suites.push({ path, needsDist: isObject && entry.needsDist === true });
    }
    if (suites.length === 0) return { error: 'KF_PROOF_MANIFEST_UNBOUND' };
    return { suites, source: 'suites' };
  }
  const named = descriptionSuites(manifest?.description);
  if (named.length === 0) return { error: 'KF_PROOF_MANIFEST_UNBOUND' };
  return { suites: named.map((path) => ({ path, needsDist: false })), source: 'description' };
}

/** Does a report suite name (vitest writes the absolute file path) belong to a bound suite path? */
function suiteMatches(reportName, suitePath) {
  if (typeof reportName !== 'string') return false;
  const name = reportName.replaceAll('\\', '/');
  return name === suitePath || name.endsWith(`/${suitePath}`);
}

function collectAssertions(report) {
  if (!report || typeof report !== 'object' || !Array.isArray(report.testResults)) {
    return { error: 'KF_PROOF_REPORT_MALFORMED' };
  }

  const assertions = [];
  for (const suite of report.testResults) {
    if (!suite || !Array.isArray(suite.assertionResults)) {
      return { error: 'KF_PROOF_REPORT_MALFORMED' };
    }
    for (const assertion of suite.assertionResults) {
      if (!assertion || typeof assertion !== 'object') {
        return { error: 'KF_PROOF_REPORT_MALFORMED' };
      }
      const caseId = normalizeCaseId(assertion.fullName);
      if (!caseId || typeof assertion.status !== 'string') {
        return { error: 'KF_PROOF_REPORT_MALFORMED' };
      }
      assertions.push({
        caseId,
        status: assertion.status,
        title: assertion.title ?? null,
        suite: suite.name ?? null,
      });
    }
  }
  return { assertions, suites: report.testResults };
}

/**
 * @param manifest  a case manifest
 * @param report    a vitest JSON report: one packet's run or a combined run
 * @param options   { expectHead, sourceHead }: with expectHead the verdict is
 *                  REJECTED unless sourceHead, the head the report is judged
 *                  at, is exactly expectHead.
 */
export function evaluateProof(manifest, report, options = {}) {
  const manifestErrors = validateManifest(manifest);
  if (manifestErrors.length > 0) {
    return verdict('REJECTED', manifestErrors);
  }

  const bound = manifestSuites(manifest);
  if (bound.error) {
    return verdict('REJECTED', [bound.error]);
  }
  const boundSuites = bound.suites.map((s) => s.path);

  if (options.expectHead !== undefined && options.expectHead !== null) {
    if (!options.sourceHead || options.sourceHead !== options.expectHead) {
      return verdict('REJECTED', ['KF_PROOF_HEAD_MISMATCH'], {
        expectedHead: options.expectHead,
        sourceHead: options.sourceHead ?? null,
      });
    }
  }

  const collected = collectAssertions(report);
  if (collected.error) {
    return verdict('REJECTED', [collected.error]);
  }

  let reportAgeMs = null;
  if (manifest.maxReportAgeSeconds !== undefined) {
    if (!Number.isFinite(report.startTime)) {
      return verdict('REJECTED', ['KF_PROOF_REPORT_MALFORMED']);
    }
    reportAgeMs = Date.now() - report.startTime;
    if (reportAgeMs < -60_000 || reportAgeMs > manifest.maxReportAgeSeconds * 1000) {
      return verdict('REJECTED', ['KF_PROOF_REPORT_STALE'], {
        reportAgeMs,
        maxReportAgeSeconds: manifest.maxReportAgeSeconds,
      });
    }
  }

  // Only the bound suites speak for this manifest.
  const inScope = (suiteName) => boundSuites.some((path) => suiteMatches(suiteName, path));
  const missingSuites = boundSuites.filter(
    (path) => !collected.suites.some((suite) => suiteMatches(suite.name, path)),
  );
  if (missingSuites.length > 0) {
    return verdict('REJECTED', ['KF_PROOF_BOUND_SUITE_MISSING'], { missingSuites, boundSuites });
  }

  const assertions = collected.assertions.filter((a) => inScope(a.suite));
  const byId = new Map();
  for (const assertion of assertions) {
    const existing = byId.get(assertion.caseId) ?? [];
    existing.push(assertion);
    byId.set(assertion.caseId, existing);
  }

  const duplicated = [...byId.entries()]
    .filter(([, entries]) => entries.length > 1)
    .map(([caseId]) => caseId);

  if (duplicated.length > 0) {
    return verdict('REJECTED', ['KF_PROOF_DUPLICATE_CASE_ID'], { duplicated });
  }

  const requiredCases = manifest.requiredCases.map(normalizeCaseId);
  const missing = requiredCases.filter((caseId) => !byId.has(caseId));
  if (missing.length > 0) {
    return verdict('REJECTED', ['KF_PROOF_REQUIRED_CASE_MISSING'], { missing });
  }

  const notPassed = requiredCases
    .map((caseId) => byId.get(caseId)[0])
    .filter((assertion) => assertion.status !== 'passed');

  if (notPassed.length > 0) {
    const statuses = [...new Set(notPassed.map((a) => a.status))];
    const reasons = statuses.some((s) => ['pending', 'skipped', 'todo'].includes(s))
      ? ['KF_PROOF_REQUIRED_CASE_SKIPPED']
      : ['KF_PROOF_REQUIRED_CASE_FAILED'];
    return verdict('REJECTED', reasons, {
      notPassed: notPassed.map(({ caseId, status }) => ({ caseId, status })),
    });
  }

  // vitest's report.success means "no suite and no test failed". For one
  // manifest that is: every suite it binds passed, whatever an unbound suite
  // of a combined run did.
  if (manifest.requireReportSuccess !== false) {
    const failedSuites = collected.suites
      .filter((suite) => inScope(suite.name))
      .filter((suite) => (suite.status === undefined ? report.success !== true : suite.status !== 'passed'))
      .map((suite) => suite.name);
    const failedCases = assertions.filter((a) => a.status === 'failed').map((a) => a.caseId);
    if (failedSuites.length > 0 || failedCases.length > 0) {
      return verdict('REJECTED', ['KF_PROOF_REPORT_UNSUCCESSFUL'], { failedSuites, failedCases });
    }
  }

  if (manifest.allowAdditionalCases === false) {
    const required = new Set(requiredCases);
    const unexpected = assertions.map((a) => a.caseId).filter((id) => !required.has(id));
    if (unexpected.length > 0) {
      return verdict('REJECTED', ['KF_PROOF_UNEXPECTED_CASE'], { unexpected });
    }
  }

  return verdict('SATISFIED_AT_DECLARED_SCOPE', [], {
    packageId: manifest.packageId,
    proofScope: manifest.proofScope ?? null,
    requiredCaseCount: requiredCases.length,
    discoveredCaseCount: assertions.length,
    boundSuites,
    suiteSource: bound.source,
    reportAgeMs,
  });
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`missing value for --${key}`);
    }
    args[key] = value;
    i += 1;
  }
  return args;
}

function loadJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function currentSourceSha() {
  if (process.env.GITHUB_SHA && /^[0-9a-f]{40}$/i.test(process.env.GITHUB_SHA)) {
    return process.env.GITHUB_SHA;
  }
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function git(repoRoot, args) {
  return execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

/** HEAD of the checkout this evaluator, and the manifests beside it, belong to. */
export function sourceHead(repoRoot = REPO_ROOT) {
  try {
    const head = git(repoRoot, ['rev-parse', 'HEAD']).trim();
    return HEAD_SHA.test(head) ? head : null;
  } catch {
    return null;
  }
}

/**
 * Where an untracked file is source for a proof: the server and its suites,
 * the workspace packages they import, and the proof scripts and manifests. An
 * untracked suite or manifest under these is run and judged, but is not at HEAD.
 */
export const SOURCE_PATHS = Object.freeze(['apps/server', 'packages', 'scripts/proof-admission']);

/**
 * Untracked paths that are never source: node_modules (the .gitignore entry
 * `node_modules/` matches a directory, not a node_modules symlink) and
 * apps/server/.proof/, where the proof commands write their reports.
 */
const NOT_SOURCE = /(?:^|\/)node_modules(?:\/|$)|^apps\/server\/\.proof\//;

/**
 * The checkout's source against HEAD: { clean, modified, untracked }.
 * `modified` lists the tracked files that differ from HEAD (anywhere),
 * `untracked` the untracked, unignored files under SOURCE_PATHS. clean is
 * true only when both are empty, and null when git cannot say.
 */
export function sourceTreeState(repoRoot = REPO_ROOT) {
  try {
    const lines = (text) => text.split('\n').filter((line) => line.length > 0);
    const modified = lines(git(repoRoot, ['status', '--porcelain', '--untracked-files=no'])).map((line) => line.slice(3));
    const untracked = lines(git(repoRoot, ['ls-files', '--others', '--exclude-standard', '--', ...SOURCE_PATHS])).filter(
      (path) => !NOT_SOURCE.test(path),
    );
    return { clean: modified.length === 0 && untracked.length === 0, modified, untracked };
  } catch {
    return { clean: null, modified: [], untracked: [] };
  }
}

/** true when no tracked file differs from HEAD and no untracked source file exists (sourceTreeState). */
export function sourceTreeClean(repoRoot = REPO_ROOT) {
  return sourceTreeState(repoRoot).clean;
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.log(JSON.stringify(verdict('REJECTED', ['KF_PROOF_ARGUMENT_INVALID'], { message: error.message })));
    process.exit(EXIT.REJECTED);
  }

  if (!args.manifest || !args.report) {
    console.log(JSON.stringify(verdict('REJECTED', ['KF_PROOF_ARGUMENT_INVALID'])));
    process.exit(EXIT.REJECTED);
  }
  if (args['expect-head'] !== undefined && !HEAD_SHA.test(args['expect-head'])) {
    console.log(
      JSON.stringify(
        verdict('REJECTED', ['KF_PROOF_ARGUMENT_INVALID'], { message: '--expect-head takes a full lowercase commit sha' }),
      ),
    );
    process.exit(EXIT.REJECTED);
  }

  let manifest;
  try {
    manifest = loadJson(args.manifest);
  } catch (error) {
    console.log(JSON.stringify(verdict('REJECTED', ['KF_PROOF_MANIFEST_UNTRUSTED'], { message: error.message })));
    process.exit(EXIT.REJECTED);
  }

  let report;
  try {
    report = loadJson(args.report);
  } catch (error) {
    const missing = error && error.code === 'ENOENT';
    const result = verdict(
      missing ? 'INCOMPLETE' : 'REJECTED',
      [missing ? 'KF_PROOF_REPORT_MISSING' : 'KF_PROOF_REPORT_MALFORMED'],
      { message: error.message },
    );
    console.log(JSON.stringify(result));
    process.exit(missing ? EXIT.INCOMPLETE : EXIT.REJECTED);
  }

  const head = sourceHead();
  const result = evaluateProof(manifest, report, { expectHead: args['expect-head'], sourceHead: head });
  const receipt = {
    ...result,
    sourceHead: head,
    sourceTreeClean: sourceTreeClean(),
    expectedHead: args['expect-head'] ?? null,
    sourceSha: currentSourceSha(),
    runId: process.env.GITHUB_RUN_ID ?? null,
    reportStartTime: Number.isFinite(report?.startTime) ? report.startTime : null,
  };
  console.log(JSON.stringify(receipt));
  process.exit(result.status === 'SATISFIED_AT_DECLARED_SCOPE' ? EXIT.SATISFIED : EXIT.REJECTED);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
