#!/usr/bin/env node
/**
 * proof:release0, the Release 0 exit gate (R0-35-EXIT-PROOF; BUILD-MAP-001
 * section (d)):
 *
 *   node scripts/proof-admission/release0.mjs [--skip-build] [--vitest-arg <a>] [--out <file>]
 *   pnpm --filter server proof:release0 [-- options]
 *
 * 1. run-manifests.mjs over exactly the manifests scripts/proof-admission/
 *    release0-index.json lists (--only, read from the index so it cannot
 *    drift), keeping the vitest JSON report that run produced (--keep-report).
 *    Every Release 0 manifest must be SATISFIED at this head.
 * 2. apps/server/src/core/config/release0-proof-coverage.spec.ts: every
 *    Release 0 server suite is bound, no manifest names a missing suite, every
 *    skip or todo the source shows is explained, every explanation is well
 *    formed (a CLOSED one names a proof this gate runs).
 * 3. The runtime skip check on that report (review SEC-R035-1): a case of a
 *    Release 0 suite the run did not run (skipped, todo, pending), whatever
 *    the source spelled (it.concurrent.skip, { skip: true }, ctx.skip(), a
 *    skipIf the scan cannot evaluate), fails the gate unless an explanation of
 *    its suite covers its title or a describe around it; so does a Release 0
 *    suite missing from the report.
 * 4. The OPEN explanations (review SEC-R035-4): Release 0 gaps still open. They
 *    are printed for the owner and the gate answers NOT MET.
 *
 * Exit codes: 0 MET (all four hold and nothing is OPEN); 2 REJECTED (a
 * manifest, the spec, the runtime check or the run itself failed); 3 NOT MET
 * (everything is proven, and OPEN items remain). The R0 exit gate needs 0.
 *
 * --only, --manifests-dir, --report and --keep-report are refused: the gate
 * runs the committed Release 0 manifests itself. Every other option goes to
 * run-manifests.mjs.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '..', '..');
const SERVER_DIR = join(REPO_ROOT, 'apps', 'server');
const INDEX_PATH = join(SCRIPT_DIR, 'release0-index.json');
const RUNNER = join(SCRIPT_DIR, 'run-manifests.mjs');
const THIS_SPEC = 'src/core/config/release0-proof-coverage.spec.ts';
const VITEST = join(SERVER_DIR, 'node_modules', 'vitest', 'vitest.mjs');
const VITEST_BIN = join(SERVER_DIR, 'node_modules', '.bin', process.platform === 'win32' ? 'vitest.cmd' : 'vitest');

export const EXIT = Object.freeze({ MET: 0, REJECTED: 2, NOT_MET: 3 });

const REFUSED = /^--(only|manifests-dir|report|keep-report)(=|$)/;

const normalize = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

/** Does a report suite name (vitest writes the absolute file path) belong to a suite path relative to apps/server? */
function suiteMatches(reportName, suitePath) {
  if (typeof reportName !== 'string') return false;
  const name = reportName.replaceAll('\\', '/');
  return name === suitePath || name.endsWith(`/${suitePath}`);
}

/** A case the run did not run: vitest's JSON reporter says skipped, todo or pending (failed is run-manifests' to judge). */
const notRun = (status) => status !== 'passed' && status !== 'failed';

/** Does an explanation cover a case the run did not run: its suite, and its title or a describe around it starting with titleStartsWith? */
export function explainsAssertion(entry, suite, assertion) {
  if (!entry || entry.suite !== suite) return false;
  const prefix = normalize(entry.titleStartsWith);
  if (prefix.length === 0 || prefix === '<dynamic>') return false;
  return [assertion.title, ...(assertion.ancestorTitles ?? [])].some((t) => normalize(t).startsWith(prefix));
}

/**
 * Every case of a Release 0 suite the report did not run, split by whether an
 * explanation covers it, and every Release 0 suite the report does not hold.
 */
export function runtimeSkips(report, index) {
  const out = { unexplained: [], explained: [], missingSuites: [] };
  const results = Array.isArray(report?.testResults) ? report.testResults : [];
  for (const suite of Object.keys(index.suites ?? {}).sort()) {
    const files = results.filter((r) => suiteMatches(r?.name, suite));
    if (files.length === 0) {
      out.missingSuites.push(suite);
      continue;
    }
    for (const file of files) {
      for (const assertion of file.assertionResults ?? []) {
        if (!notRun(assertion.status)) continue;
        const entry = { suite, status: assertion.status, fullName: normalize(assertion.fullName) };
        const covered = (index.explained ?? []).some((e) => explainsAssertion(e, suite, assertion));
        (covered ? out.explained : out.unexplained).push(entry);
      }
    }
  }
  return out;
}

/** The explanations that record a Release 0 gap still open. */
export function openEntries(index) {
  return (index.explained ?? []).filter((e) => e.status === 'OPEN');
}

/** The gate's verdict from its steps' results: REJECTED on any failure, else NOT MET while anything is OPEN, else MET. */
export function gateVerdict({ runManifestsExit, specExit, runtime, open }) {
  const failed =
    runManifestsExit !== 0 ||
    specExit !== 0 ||
    !runtime ||
    runtime.unexplained.length > 0 ||
    runtime.missingSuites.length > 0;
  if (failed) return { code: EXIT.REJECTED, verdict: 'REJECTED' };
  if (open.length > 0) return { code: EXIT.NOT_MET, verdict: 'NOT MET' };
  return { code: EXIT.MET, verdict: 'MET' };
}

function run(command, args, cwd) {
  const child = spawnSync(command, args, { cwd, stdio: 'inherit', env: process.env });
  return child.status ?? null;
}

function main() {
  const args = process.argv.slice(2).filter((a) => a !== '--');
  const refused = args.filter((a) => REFUSED.test(a));
  if (refused.length > 0) {
    console.error(
      `proof:release0: the manifests come from scripts/proof-admission/release0-index.json and the report from this run; ${refused.join(', ')} refused`,
    );
    process.exit(EXIT.REJECTED);
  }
  const index = JSON.parse(readFileSync(INDEX_PATH, 'utf8'));
  const work = mkdtempSync(join(tmpdir(), 'kf-release0-'));
  const reportPath = join(work, 'release0-vitest.json');
  let result;
  try {
    // 1. Every Release 0 manifest at this head; the report stays for step 3.
    const runManifestsExit = run(
      process.execPath,
      [RUNNER, '--only', index.manifests.join(','), '--keep-report', reportPath, ...args],
      REPO_ROOT,
    );
    // 2. The coverage spec, even when step 1 failed: its own findings are part of the verdict.
    const specArgs = ['run', THIS_SPEC];
    const specExit = existsSync(VITEST_BIN)
      ? run(VITEST_BIN, specArgs, SERVER_DIR)
      : run(process.execPath, [VITEST, ...specArgs], SERVER_DIR);
    // 3. The runtime skip check on the report run-manifests produced at this head.
    let runtime = null;
    if (existsSync(reportPath)) {
      runtime = runtimeSkips(JSON.parse(readFileSync(reportPath, 'utf8')), index);
    } else {
      console.error('proof:release0: run-manifests kept no report, so the runtime skip check cannot run');
    }
    const open = openEntries(index);
    result = gateVerdict({ runManifestsExit, specExit, runtime, open });

    console.log(`proof:release0: run-manifests exit ${runManifestsExit ?? 'signal'}; ${THIS_SPEC} exit ${specExit ?? 'signal'}`);
    if (runtime) {
      console.log(
        `proof:release0: runtime skip check: ${runtime.explained.length} case(s) not run, each explained; ` +
          `${runtime.unexplained.length} not run with no explanation; ${runtime.missingSuites.length} Release 0 suite(s) missing from the run`,
      );
      for (const u of runtime.unexplained) console.log(`  UNEXPLAINED ${u.status.padEnd(8)} ${u.suite} :: ${u.fullName}`);
      for (const s of runtime.missingSuites) console.log(`  MISSING     ${s}`);
    }
    if (open.length > 0) {
      console.log(`proof:release0: ${open.length} OPEN Release 0 item(s), REPORTED TO THE OWNER (release0-index.json "explained", status OPEN):`);
      for (const e of open) {
        console.log(`  OPEN ${e.suite} :: ${normalize(e.titleStartsWith)}`);
        console.log(`       owner: ${e.owner}${e.followUp ? `; follow-up: ${e.followUp}` : ''}`);
      }
    }
    console.log(
      `proof:release0: R0 EXIT GATE ${result.verdict} (exit ${result.code})` +
        (result.code === EXIT.NOT_MET ? ': every Release 0 manifest and skip is proven; the OPEN items above remain' : ''),
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  process.exit(result.code);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
