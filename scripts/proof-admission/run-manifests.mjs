#!/usr/bin/env node
/**
 * Run every case manifest's suites once and judge every manifest at HEAD
 * (R0-16-PROOF-BINDING).
 *
 *   node scripts/proof-admission/run-manifests.mjs [options]
 *   pnpm --filter server proof:manifests [-- options]
 *
 * It reads every *.json under scripts/proof-admission/manifests/ and sorts it
 * by type:
 *   resource           has `resources` (ci-resources.json, local-worktree-resources.json):
 *                      judged by admit-resources.mjs, SKIPPED here;
 *   negative-controls  has `controls` (action-001-negative-controls.json): the
 *                      clean-tree half of a live control, every test a control
 *                      names must pass at HEAD (the mutations themselves are
 *                      run by negative-controls.mjs, not here);
 *   case               has `requiredCases`: judged by evaluate.mjs;
 *   anything else      REJECTED (KF_PROOF_MANIFEST_TYPE_UNKNOWN).
 * It unions the suites the case and negative-controls manifests bind (their
 * `suites`, else the files of their description's `npx vitest run` command;
 * see evaluate.mjs), builds dist/main.js first when a suite needsDist, runs
 * vitest ONCE over the union with the JSON reporter, then judges every
 * manifest against that one report with --expect-head set to the HEAD the run
 * started at. One line per manifest; exit 0 only when every case and
 * negative-controls manifest is SATISFIED.
 *
 * So a packet binds its suites by adding one manifest; CI (ci-cd.yml, after
 * the server tests) runs this, and nobody edits the workflow to add a proof.
 *
 * Options:
 *   --only a.json,b.json   judge (and run the suites of) only these manifests
 *   --manifests-dir <dir>  another manifests directory (the self-test uses this)
 *   --report <file>        judge an existing vitest JSON report; run nothing
 *   --out <file>           also write every receipt as JSON
 *   --skip-build           do not build dist/main.js (it must exist and be newer
 *                          than every apps/server/src file)
 *   --vitest-arg <arg>     pass one more argument to vitest (repeatable),
 *                          e.g. --vitest-arg --no-file-parallelism
 *   --plan                 print the manifests, their types and suites and the
 *                          union as JSON; run nothing. Exit 2 if a manifest is
 *                          unbound, of unknown type, or names a missing file.
 *   --skip-file-check      with --plan, do not require the suite files to exist
 *
 * The environment (DATABASE_URL, REDIS_URL, ...) is the caller's: this script
 * reads none of it and prints none of it.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { manifestSuites, sourceHead, sourceTreeClean } from './evaluate.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '..', '..');
const SERVER_DIR = join(REPO_ROOT, 'apps', 'server');
const EVALUATOR = join(SCRIPT_DIR, 'evaluate.mjs');
const DEFAULT_MANIFESTS = join(SCRIPT_DIR, 'manifests');
const VITEST = join(SERVER_DIR, 'node_modules', 'vitest', 'vitest.mjs');
const DIST_MAIN = join(SERVER_DIR, 'dist', 'main.js');

const EXIT = Object.freeze({ SATISFIED: 0, REJECTED: 2, INCOMPLETE: 3 });

function parseArgs(argv) {
  const args = { vitestArgs: [] };
  const flags = new Set(['--skip-build', '--plan', '--skip-file-check']);
  const valued = new Set(['--only', '--manifests-dir', '--report', '--out', '--vitest-arg']);
  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i];
    if (raw === '--') continue; // pnpm <script> -- <args> may pass the separator through
    const eq = raw.indexOf('=');
    const name = raw.startsWith('--') && eq > 0 ? raw.slice(0, eq) : raw;
    if (flags.has(name)) {
      args[name.slice(2)] = true;
      continue;
    }
    if (!valued.has(name)) throw new Error(`unknown argument ${raw}`);
    let value;
    if (eq > 0 && raw.startsWith('--')) value = raw.slice(eq + 1);
    else {
      value = argv[i + 1];
      i += 1;
    }
    if (value === undefined || value === '') throw new Error(`missing value for ${name}`);
    if (name === '--vitest-arg') args.vitestArgs.push(value);
    else args[name.slice(2)] = value;
  }
  return args;
}

const normalize = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

function classify(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return 'unknown';
  if (Array.isArray(manifest.resources)) return 'resource';
  if (Array.isArray(manifest.controls)) return 'negative-controls';
  if (Array.isArray(manifest.requiredCases)) return 'case';
  return 'unknown';
}

/**
 * The case manifest a negative-controls manifest implies on a clean tree: every
 * test any control names is required to pass, so a control cannot go dead by a
 * rename or a skip while the suite stays green.
 */
function controlsAsCaseManifest(manifest) {
  const names = [];
  for (const control of manifest.controls) {
    for (const list of Object.values(control?.mustFail ?? {})) {
      for (const name of Array.isArray(list) ? list : []) {
        const id = normalize(name);
        if (id && !names.includes(id)) names.push(id);
      }
    }
  }
  return {
    manifestVersion: manifest.manifestVersion,
    packageId: manifest.packageId,
    proofScope: 'negative-controls-clean-tree',
    requireReportSuccess: true,
    allowAdditionalCases: true,
    suites: manifest.suites,
    description: manifest.description,
    requiredCases: names,
  };
}

/** Every manifest in the directory, typed, with the suites it binds or the problem that stops it. */
function loadManifests(dir, only, checkFiles) {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort();
  const selected = only ? files.filter((f) => only.includes(f)) : files;
  if (only) {
    for (const name of only) {
      if (!files.includes(name)) throw new Error(`--only names ${name}, which is not in ${dir}`);
    }
  }
  return selected.map((file) => {
    const entry = { file, path: join(dir, file), type: 'unknown', packageId: null, suites: [], needsDist: false, problem: null };
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(entry.path, 'utf8'));
    } catch (error) {
      entry.problem = { reason: 'KF_PROOF_MANIFEST_UNTRUSTED', detail: error.message };
      return entry;
    }
    entry.type = classify(manifest);
    entry.packageId = typeof manifest?.packageId === 'string' ? manifest.packageId : null;
    if (entry.type === 'resource') return entry;
    if (entry.type === 'unknown') {
      entry.problem = { reason: 'KF_PROOF_MANIFEST_TYPE_UNKNOWN', detail: 'no requiredCases, controls or resources' };
      return entry;
    }
    entry.evaluated = entry.type === 'negative-controls' ? controlsAsCaseManifest(manifest) : manifest;
    if (entry.type === 'negative-controls' && entry.evaluated.requiredCases.length === 0) {
      entry.problem = { reason: 'KF_PROOF_MANIFEST_UNTRUSTED', detail: 'no control names a test' };
      return entry;
    }
    const bound = manifestSuites(entry.evaluated);
    if (bound.error) {
      entry.problem = { reason: bound.error, detail: 'declare "suites" (paths relative to apps/server)' };
      return entry;
    }
    entry.suites = bound.suites.map((s) => s.path);
    entry.suiteSource = bound.source;
    entry.needsDist = bound.suites.some((s) => s.needsDist);
    if (checkFiles) {
      const absent = entry.suites.filter((s) => !existsSync(join(SERVER_DIR, s)));
      if (absent.length > 0) entry.problem = { reason: 'KF_PROOF_SUITE_FILE_MISSING', detail: absent.join(', ') };
    }
    return entry;
  });
}

function newestMtime(dir) {
  let newest = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) newest = Math.max(newest, newestMtime(p));
    else if (/\.ts$/.test(e.name) && !/\.spec\.ts$/.test(e.name)) newest = Math.max(newest, statSync(p).mtimeMs);
  }
  return newest;
}

/** dist/main.js exists and is newer than every non-spec source file, or the reason it is not. */
function distProblem() {
  if (!existsSync(DIST_MAIN)) return `${DIST_MAIN} does not exist`;
  const built = statSync(DIST_MAIN).mtimeMs;
  const newest = Math.max(newestMtime(join(SERVER_DIR, 'src')), statSync(join(SERVER_DIR, 'tsconfig.json')).mtimeMs);
  return built >= newest ? null : `${DIST_MAIN} is older than the newest apps/server/src file: rebuild it`;
}

function lineFor(entry, receipt) {
  const pad = (s, n) => String(s).padEnd(n);
  if (entry.type === 'resource') {
    return `${pad('SKIPPED', 10)}${pad(entry.file, 40)} resource manifest (judged by admit-resources.mjs)`;
  }
  if (entry.problem) {
    return `${pad('REJECTED', 10)}${pad(entry.file, 40)} ${entry.problem.reason}: ${entry.problem.detail}`;
  }
  if (receipt?.status === 'SATISFIED_AT_DECLARED_SCOPE') {
    const kind = entry.type === 'negative-controls' ? ' named-by-controls' : '';
    return `${pad('SATISFIED', 10)}${pad(entry.file, 40)} ${entry.packageId} required=${receipt.requiredCaseCount}${kind} suites=${receipt.boundSuites.length} head=${receipt.sourceHead}`;
  }
  const reasons = (receipt?.reasons ?? ['KF_PROOF_EVALUATOR_FAILED']).join(',');
  const detail =
    receipt?.missing ?? receipt?.unexpected ?? receipt?.duplicated ?? receipt?.missingSuites ?? receipt?.failedCases ?? receipt?.notPassed;
  const shown = Array.isArray(detail) ? detail.slice(0, 3).map((d) => (typeof d === 'string' ? d : JSON.stringify(d))) : [];
  const more = Array.isArray(detail) && detail.length > 3 ? ` (+${detail.length - 3} more)` : '';
  return `${pad('REJECTED', 10)}${pad(entry.file, 40)} ${reasons}${shown.length ? `: ${shown.join(' | ')}${more}` : ''}`;
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`run-manifests: ${error.message}`);
    process.exit(EXIT.REJECTED);
  }

  const dir = resolve(args['manifests-dir'] ?? DEFAULT_MANIFESTS);
  const only = args.only ? args.only.split(',').map((s) => s.trim()).filter(Boolean) : null;
  // vitest silently drops a filter that names no file, so before a run every
  // declared suite must exist. A given --report already says what ran (a bound
  // suite it lacks is KF_PROOF_BOUND_SUITE_MISSING), so it needs no file check.
  const checkFiles = args.plan ? !args['skip-file-check'] : !args.report;
  let entries;
  try {
    entries = loadManifests(dir, only, checkFiles);
  } catch (error) {
    console.error(`run-manifests: ${error.message}`);
    process.exit(EXIT.REJECTED);
  }

  const runnable = entries.filter((e) => e.type !== 'resource' && !e.problem);
  const union = [...new Set(runnable.flatMap((e) => e.suites))].sort();
  const needsDist = runnable.some((e) => e.needsDist);

  if (args.plan) {
    const problems = entries.filter((e) => e.problem).map((e) => ({ file: e.file, ...e.problem }));
    const plan = {
      head: sourceHead(),
      manifests: entries.map((e) => ({
        file: e.file,
        type: e.type,
        packageId: e.packageId,
        suites: e.suites,
        suiteSource: e.suiteSource ?? null,
        needsDist: e.needsDist,
      })),
      suites: union,
      needsDist,
      problems,
    };
    console.log(JSON.stringify(plan, null, 2));
    process.exit(problems.length === 0 ? EXIT.SATISFIED : EXIT.REJECTED);
  }

  const head = sourceHead();
  if (!head) {
    console.error('run-manifests: cannot read HEAD; an exact-head proof needs a git checkout');
    process.exit(EXIT.REJECTED);
  }
  const work = mkdtempSync(join(tmpdir(), 'kf-run-manifests-'));
  let code;
  try {
    code = runAndJudge({ args, dir, entries, runnable, union, needsDist, head, work });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  process.exit(code);
}

/** Build if needed, run the union once (unless --report), judge every manifest; returns the exit code. */
function runAndJudge({ args, dir, entries, runnable, union, needsDist, head, work }) {
  const reportPath = args.report ? resolve(args.report) : join(work, 'vitest-report.json');
  let vitestExit = null;

  if (!args.report && union.length > 0) {
    if (needsDist && !args['skip-build']) {
      console.log('run-manifests: a bound suite spawns dist/main.js; building the server (pnpm run build)');
      const build = spawnSync('pnpm', ['run', 'build'], { cwd: SERVER_DIR, stdio: 'inherit', env: process.env });
      if (build.status !== 0) {
        console.error(`run-manifests: the server build exited ${build.status ?? build.signal}; not running suites against an old dist`);
        return EXIT.REJECTED;
      }
    }
    if (needsDist) {
      const problem = distProblem();
      if (problem) {
        console.error(`run-manifests: ${problem}`);
        return EXIT.REJECTED;
      }
    }
    const files = union.map((s) => join(SERVER_DIR, s));
    console.log(`run-manifests: vitest run over ${files.length} suites bound by ${runnable.length} manifests at ${head}`);
    const run = spawnSync(
      process.execPath,
      [VITEST, 'run', ...files, '--reporter=dot', '--reporter=json', `--outputFile=${reportPath}`, ...args.vitestArgs],
      { cwd: SERVER_DIR, stdio: 'inherit', env: process.env },
    );
    vitestExit = run.status ?? run.signal;
    if (!existsSync(reportPath)) {
      console.error(`run-manifests: vitest exited ${vitestExit} and wrote no report`);
      return EXIT.INCOMPLETE;
    }
  } else if (!args.report) {
    // Nothing to run: an empty report, so every manifest is still judged (and rejected) the same way.
    writeFileSync(reportPath, JSON.stringify({ success: true, startTime: Date.now(), testResults: [] }));
  }
  if (!existsSync(reportPath)) {
    console.error(`run-manifests: no report at ${reportPath}`);
    return EXIT.INCOMPLETE;
  }

  const clean = sourceTreeClean();
  console.log(
    `run-manifests: judging ${entries.length} manifests from ${basename(dir)}/ against one report at ${head} (${clean === true ? 'tree clean' : clean === false ? 'tree has modified tracked files' : 'tree state unknown'})`,
  );
  const derivedDir = join(work, 'derived');
  mkdirSync(derivedDir, { recursive: true });
  const results = [];
  let failures = 0;
  for (const entry of entries) {
    let receipt = null;
    if (entry.type !== 'resource' && !entry.problem) {
      let manifestPath = entry.path;
      if (entry.type === 'negative-controls') {
        manifestPath = join(derivedDir, entry.file);
        writeFileSync(manifestPath, JSON.stringify(entry.evaluated));
      }
      const child = spawnSync(
        process.execPath,
        [EVALUATOR, '--manifest', manifestPath, '--report', reportPath, '--expect-head', head],
        { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: process.env },
      );
      try {
        receipt = JSON.parse(child.stdout.trim());
      } catch {
        receipt = { status: 'REJECTED', reasons: ['KF_PROOF_EVALUATOR_FAILED'], message: child.stderr?.slice(0, 500) };
      }
    }
    const satisfied = entry.type === 'resource' || receipt?.status === 'SATISFIED_AT_DECLARED_SCOPE';
    if (!satisfied) failures += 1;
    console.log(lineFor(entry, receipt));
    results.push({
      file: entry.file,
      type: entry.type,
      packageId: entry.packageId,
      status: entry.type === 'resource' ? 'SKIPPED' : satisfied ? 'SATISFIED' : 'REJECTED',
      problem: entry.problem,
      receipt,
    });
  }

  const judged = results.filter((r) => r.type !== 'resource').length;
  console.log(
    `run-manifests: ${judged - failures} of ${judged} manifests SATISFIED, ${failures} not, ${results.length - judged} resource manifests skipped; vitest exit ${vitestExit ?? 'n/a'}; head ${head}`,
  );
  if (args.out) {
    writeFileSync(
      resolve(args.out),
      JSON.stringify(
        { head, treeClean: clean, vitestExit, report: args.report ? reportPath : null, suites: union, manifests: results },
        null,
        2,
      ),
    );
  }
  return failures === 0 ? EXIT.SATISFIED : EXIT.REJECTED;
}

main();
