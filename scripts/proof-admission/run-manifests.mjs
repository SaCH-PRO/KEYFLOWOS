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
 * A manifest is exactly one type: one with more than one of `resources`,
 * `controls` and `requiredCases` is REJECTED (KF_PROOF_MANIFEST_TYPE_AMBIGUOUS),
 * so adding `controls` to a case manifest cannot swap its own requiredCases
 * and strictness for the lenient set the controls name.
 * It unions the suites the case and negative-controls manifests bind (their
 * `suites`, else the files of their description's `npx vitest run` command;
 * see evaluate.mjs), builds dist/main.js first when a suite needsDist, runs
 * vitest ONCE over the union with the JSON reporter, then judges every
 * manifest against that one report with --expect-head set to the HEAD the run
 * started at. One line per manifest; exit 0 only when every case and
 * negative-controls manifest is SATISFIED and, when this run ran vitest, vitest
 * itself exited 0 (an unhandled error fails vitest but not one assertion).
 *
 * EXACT HEAD. A receipt binds what was tested to HEAD only when this run ran
 * the suites itself, from the committed manifests directory, on a tree where
 * no tracked file differs from HEAD and no untracked file sits under
 * apps/server, packages or scripts/proof-admission (evaluate.mjs
 * sourceTreeState). Anything else (a dirty tree, --report, --manifests-dir) is
 * still judged, but every SATISFIED line says NOT-EXACT-HEAD and the summary
 * says why: such a receipt is not evidence for the commit it names.
 *
 * So a packet binds its suites by adding one manifest; CI (ci-cd.yml, after
 * the server tests) runs this, and nobody edits the workflow to add a proof.
 *
 * Options:
 *   --only a.json,b.json   judge (and run the suites of) only these manifests
 *   --manifests-dir <dir>  another manifests directory (the self-test uses this)
 *   --report <file>        judge an existing vitest JSON report; run nothing
 *                          (NOT-EXACT-HEAD: a report does not say which commit
 *                          it was produced at)
 *   --out <file>           also write every receipt as JSON
 *   --keep-report <file>   also keep the vitest JSON report this run produced
 *                          (proof:release0, scripts/proof-admission/release0.mjs,
 *                          reads every case status from it); refused with
 *                          --report and --plan, which produce none
 *   --skip-build           do not build dist/main.js (it must exist, and the
 *                          newest file under dist/ must be newer than every
 *                          apps/server/src file)
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
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { manifestSuites, sourceHead, sourceTreeState } from './evaluate.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '..', '..');
const SERVER_DIR = join(REPO_ROOT, 'apps', 'server');
const EVALUATOR = join(SCRIPT_DIR, 'evaluate.mjs');
const DEFAULT_MANIFESTS = join(SCRIPT_DIR, 'manifests');
const VITEST = join(SERVER_DIR, 'node_modules', 'vitest', 'vitest.mjs');
const VITEST_BIN = join(SERVER_DIR, 'node_modules', '.bin', process.platform === 'win32' ? 'vitest.cmd' : 'vitest');

const EXIT = Object.freeze({ SATISFIED: 0, REJECTED: 2, INCOMPLETE: 3 });

function parseArgs(argv) {
  const args = { vitestArgs: [] };
  const flags = new Set(['--skip-build', '--plan', '--skip-file-check']);
  const valued = new Set(['--only', '--manifests-dir', '--report', '--out', '--vitest-arg', '--keep-report']);
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

const TYPE_KEYS = Object.freeze(['requiredCases', 'controls', 'resources']);

/** The type keys a manifest carries (present at all, whatever their value). */
export function typeKeys(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return [];
  return TYPE_KEYS.filter((key) => Object.prototype.hasOwnProperty.call(manifest, key));
}

export function classify(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return 'unknown';
  if (typeKeys(manifest).length > 1) return 'ambiguous';
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
    if (entry.type === 'ambiguous') {
      entry.problem = {
        reason: 'KF_PROOF_MANIFEST_TYPE_AMBIGUOUS',
        detail: `has ${typeKeys(manifest).join(' and ')}; a manifest is exactly one of case (requiredCases), negative-controls (controls) or resource (resources)`,
      };
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

const isBuildInput = (name) => /\.ts$/.test(name) && !/\.spec\.ts$/.test(name);

/** The newest mtime of the files under dir that `keep` accepts (0 when there are none). */
function newestMtime(dir, keep) {
  let newest = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) newest = Math.max(newest, newestMtime(p, keep));
    else if (keep(e.name)) newest = Math.max(newest, statSync(p).mtimeMs);
  }
  return newest;
}

/**
 * dist/main.js exists and the build is at least as new as its inputs, or the
 * reason it is not. apps/server/tsconfig.json builds incrementally
 * (dist/.tsbuildinfo), so a build re-emits only the files an edit affects and
 * dist/main.js alone can be older than an up-to-date build. The build is fresh
 * when its newest output (any file under dist/, .tsbuildinfo included) is at
 * least as new as every non-spec source file and tsconfig.json.
 */
export function distProblem(serverDir = SERVER_DIR) {
  const distDir = join(serverDir, 'dist');
  const distMain = join(distDir, 'main.js');
  if (!existsSync(distMain)) return `${distMain} does not exist`;
  const built = newestMtime(distDir, () => true);
  const newest = Math.max(newestMtime(join(serverDir, 'src'), isBuildInput), statSync(join(serverDir, 'tsconfig.json')).mtimeMs);
  return built >= newest
    ? null
    : `the newest file under ${distDir} is older than the newest apps/server/src file: rebuild it (pnpm --filter server build). ` +
        'If a rebuild does not clear this, a source file was touched without a change (tsc then emits nothing): ' +
        'delete dist/.tsbuildinfo and rebuild';
}

const sameDir = (a, b) => {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return false;
  }
};

/**
 * Whether this run's receipts bind what was tested to HEAD: { exact, reasons }.
 * Only a run that executed the suites itself, from the committed manifests
 * directory, on a clean source tree (evaluate.mjs sourceTreeState) is exact.
 */
export function headBinding({ reportGiven, manifestsDir, tree }) {
  const reasons = [];
  const some = (list) => `${list.slice(0, 3).join(', ')}${list.length > 3 ? ` (+${list.length - 3} more)` : ''}`;
  if (reportGiven) reasons.push('the report was given by --report, not produced by this run at HEAD');
  if (!sameDir(manifestsDir, DEFAULT_MANIFESTS)) reasons.push(`the manifests are from ${manifestsDir}, not the committed directory`);
  if (!tree || tree.clean === null) reasons.push('git cannot report the tree state');
  else {
    if (tree.modified.length > 0) reasons.push(`${tree.modified.length} tracked file(s) differ from HEAD: ${some(tree.modified)}`);
    if (tree.untracked.length > 0) reasons.push(`${tree.untracked.length} untracked source file(s): ${some(tree.untracked)}`);
  }
  return { exact: reasons.length === 0, reasons };
}

/**
 * The run's exit code: SATISFIED only when no manifest failed and, when this
 * run ran vitest, vitest exited 0. vitest 2's JSON report leaves an unhandled
 * error out of `success` and of every file status, so a suite that passes its
 * assertions and leaks an unhandled rejection is visible only in vitest's exit.
 */
export function runExitCode({ failures, vitestExit }) {
  if (failures > 0) return EXIT.REJECTED;
  if (vitestExit !== null && vitestExit !== undefined && vitestExit !== 0) return EXIT.REJECTED;
  return EXIT.SATISFIED;
}

function lineFor(entry, receipt, binding) {
  const pad = (s, n) => String(s).padEnd(n);
  if (entry.type === 'resource') {
    return `${pad('SKIPPED', 10)}${pad(entry.file, 40)} resource manifest (judged by admit-resources.mjs)`;
  }
  if (entry.problem) {
    return `${pad('REJECTED', 10)}${pad(entry.file, 40)} ${entry.problem.reason}: ${entry.problem.detail}`;
  }
  if (receipt?.status === 'SATISFIED_AT_DECLARED_SCOPE') {
    const kind = entry.type === 'negative-controls' ? ' named-by-controls' : '';
    const exact = binding?.exact ? '' : ' NOT-EXACT-HEAD';
    return `${pad('SATISFIED', 10)}${pad(entry.file, 40)} ${entry.packageId} required=${receipt.requiredCaseCount}${kind} suites=${receipt.boundSuites.length} head=${receipt.sourceHead}${exact}`;
  }
  const reasons = (receipt?.reasons ?? ['KF_PROOF_EVALUATOR_FAILED']).join(',');
  const detail = [
    receipt?.missing,
    receipt?.unexpected,
    receipt?.duplicated,
    receipt?.missingSuites,
    receipt?.notPassed,
    receipt?.failedCases,
    receipt?.failedSuites,
  ].find((d) => Array.isArray(d) && d.length > 0);
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

  if (args['keep-report'] && (args.report || args.plan)) {
    console.error('run-manifests: --keep-report keeps the report this run produces; --report and --plan produce none');
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
    // A build this run just ran (exit 0) is as fresh as tsc makes it. With
    // --skip-build the caller vouches for dist/, so it is checked.
    if (needsDist && args['skip-build']) {
      const problem = distProblem();
      if (problem) {
        console.error(`run-manifests: ${problem}`);
        return EXIT.REJECTED;
      }
    }
    const files = union.map((s) => join(SERVER_DIR, s));
    console.log(`run-manifests: vitest run over ${files.length} suites bound by ${runnable.length} manifests at ${head}`);
    const vitestArgs = ['run', ...files, '--reporter=dot', '--reporter=json', `--outputFile=${reportPath}`, ...args.vitestArgs];
    // The package-manager shim, as `pnpm test:ci` runs it: it sets the NODE_PATH
    // under which vite resolves the repo-root postcss.config.js plugins. Calling
    // vitest.mjs bare dies in config loading under pnpm's isolated layout.
    const run = existsSync(VITEST_BIN)
      ? spawnSync(VITEST_BIN, vitestArgs, { cwd: SERVER_DIR, stdio: 'inherit', env: process.env })
      : spawnSync(process.execPath, [VITEST, ...vitestArgs], { cwd: SERVER_DIR, stdio: 'inherit', env: process.env });
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
  if (args['keep-report']) copyFileSync(reportPath, resolve(args['keep-report']));

  const tree = sourceTreeState();
  const binding = headBinding({ reportGiven: Boolean(args.report), manifestsDir: dir, tree });
  const bindingText = binding.exact
    ? 'exact-head receipt: tree clean, suites run by this run, committed manifests'
    : `NOT an exact-head receipt: ${binding.reasons.join('; ')}`;
  console.log(`run-manifests: judging ${entries.length} manifests from ${basename(dir)}/ against one report at ${head} (${bindingText})`);
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
    console.log(lineFor(entry, receipt, binding));
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
  const code = runExitCode({ failures, vitestExit });
  console.log(
    `run-manifests: ${judged - failures} of ${judged} manifests SATISFIED, ${failures} not, ${results.length - judged} resource manifests skipped; vitest exit ${vitestExit ?? 'n/a'}; head ${head}${binding.exact ? ' (exact-head receipt)' : ' (NOT an exact-head receipt)'}`,
  );
  if (failures === 0 && code !== EXIT.SATISFIED) {
    console.log(
      `run-manifests: REJECTED: vitest exited ${vitestExit} although every manifest is satisfied (an unhandled error, a failing hook or a crashed worker is not in the JSON report); see vitest's output above`,
    );
  }
  if (args.out) {
    writeFileSync(
      resolve(args.out),
      JSON.stringify(
        {
          head,
          exactHead: binding.exact,
          notExactHeadReasons: binding.reasons,
          treeClean: tree.clean,
          modified: tree.modified,
          untracked: tree.untracked,
          vitestExit,
          exitCode: code,
          report: args.report ? reportPath : null,
          suites: union,
          manifests: results,
        },
        null,
        2,
      ),
    );
  }
  return code;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
