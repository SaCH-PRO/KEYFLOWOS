/**
 * W11-LOAD-SENSITIVE-TESTS (WAVE-2 NOTE):
 * A full `run-manifests.mjs` run with `--vitest-arg --no-file-parallelism`
 * takes ~891 s, longer than the 600 s `maxReportAgeSeconds` declared by 8
 * manifests (`KF_PROOF_REPORT_STALE` with every test passing).
 *
 * These tests pin the bounded harness setting (`--max-report-age-seconds` /
 * `KF_PROOF_MAX_REPORT_AGE_SECONDS`):
 *   (a) default staleness still rejects reports older than the manifest's 600 s;
 *   (b) raising the setting via CLI or env allows a report within the raised
 *       window at the SAME exact head (and still rejects reports beyond the
 *       raised window, without lowering a manifest's own window);
 *   (c) a mismatched commit SHA STILL fails closed (`KF_PROOF_HEAD_MISMATCH`)
 *       even with a raised stale age, and exact-head binding stays intact;
 *   (d) invalid or unbounded values fail closed (exit 2).
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO = resolve(process.cwd(), '../..');
const EVALUATOR = join(REPO, 'scripts', 'proof-admission', 'evaluate.mjs');
const RUNNER = join(REPO, 'scripts', 'proof-admission', 'run-manifests.mjs');
const HEAD = execFileSync('git', ['-C', REPO, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const WRONG_HEAD = HEAD.replace(/.$/, (c) => (c === '0' ? '1' : '0'));

function makeManifest(maxReportAgeSeconds = 600) {
  return {
    manifestVersion: 1,
    packageId: 'KF-W11-REPORT-AGE',
    proofScope: 'fixture',
    requireReportSuccess: true,
    allowAdditionalCases: false,
    maxReportAgeSeconds,
    suites: ['test/alpha.integration.test.ts'],
    requiredCases: ['alpha one'],
  };
}

function makeAgedReport(ageSeconds: number) {
  return {
    numTotalTestSuites: 1,
    numPassedTestSuites: 1,
    numFailedTestSuites: 0,
    numPendingTestSuites: 0,
    numTotalTests: 1,
    numPassedTests: 1,
    numFailedTests: 0,
    numPendingTests: 0,
    numTodoTests: 0,
    startTime: Date.now() - ageSeconds * 1000,
    success: true,
    testResults: [
      {
        assertionResults: [
          {
            ancestorTitles: [],
            fullName: 'alpha one',
            status: 'passed',
            title: 'alpha one',
            duration: 1,
            failureMessages: [],
          },
        ],
        status: 'passed',
        message: '',
        name: '/ci/checkout/apps/server/test/alpha.integration.test.ts',
      },
    ],
  };
}

function makeFixture(ageSeconds: number, manifestMaxAge = 600) {
  const dir = mkdtempSync(join(tmpdir(), 'kf-report-age-'));
  const manifestsDir = join(dir, 'manifests');
  mkdirSync(manifestsDir);
  const manifestPath = join(manifestsDir, 'alpha.json');
  const reportPath = join(dir, 'report.json');
  writeFileSync(manifestPath, JSON.stringify(makeManifest(manifestMaxAge), null, 2));
  writeFileSync(reportPath, JSON.stringify(makeAgedReport(ageSeconds), null, 2));
  return { dir, manifestsDir, manifestPath, reportPath };
}

function runEvaluator(manifestPath: string, reportPath: string, extraArgs: string[] = []) {
  const child = spawnSync(
    process.execPath,
    [EVALUATOR, '--manifest', manifestPath, '--report', reportPath, ...extraArgs],
    { encoding: 'utf8', cwd: REPO },
  );
  return {
    status: child.status,
    result: JSON.parse(child.stdout.trim()),
  };
}

function runRunner(args: string[], extraEnv: Record<string, string | undefined> = {}) {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && k !== 'KF_PROOF_MAX_REPORT_AGE_SECONDS') env[k] = v;
  }
  for (const [k, v] of Object.entries(extraEnv)) {
    if (v !== undefined) env[k] = v;
  }
  const child = spawnSync(process.execPath, [RUNNER, ...args], {
    encoding: 'utf8',
    cwd: REPO,
    env,
  });
  return { status: child.status, stdout: child.stdout ?? '', stderr: child.stderr ?? '' };
}

describe('proof admission configurable maxReportAgeSeconds (W11-LOAD-SENSITIVE-TESTS)', () => {
  it('default staleness still rejects a 900s-old report against a 600s manifest in evaluate.mjs and run-manifests.mjs', () => {
    const { manifestsDir, manifestPath, reportPath } = makeFixture(900, 600);

    const evalRes = runEvaluator(manifestPath, reportPath, ['--expect-head', HEAD]);
    expect(evalRes.status).toBe(2);
    expect(evalRes.result.status).toBe('REJECTED');
    expect(evalRes.result.reasons).toContain('KF_PROOF_REPORT_STALE');

    const runRes = runRunner(['--manifests-dir', manifestsDir, '--report', reportPath]);
    expect(runRes.status).toBe(2);
    expect(runRes.stdout).toMatch(/^REJECTED\s+alpha\.json\b.*KF_PROOF_REPORT_STALE/m);
  });

  it('raising --max-report-age-seconds allows a 900s-old report at the SAME exact head while still rejecting beyond the raised bound', () => {
    const { manifestsDir, manifestPath, reportPath, dir } = makeFixture(900, 600);

    const evalOk = runEvaluator(manifestPath, reportPath, [
      '--expect-head',
      HEAD,
      '--max-report-age-seconds',
      '1800',
    ]);
    expect(evalOk.status).toBe(0);
    expect(evalOk.result.status).toBe('SATISFIED_AT_DECLARED_SCOPE');
    expect(evalOk.result.sourceHead).toBe(HEAD);
    expect(evalOk.result.expectedHead).toBe(HEAD);

    const outPath = join(dir, 'receipts.json');
    const runOk = runRunner([
      '--manifests-dir',
      manifestsDir,
      '--report',
      reportPath,
      '--max-report-age-seconds',
      '1800',
      '--out',
      outPath,
    ]);
    expect(runOk.status, runOk.stdout + runOk.stderr).toBe(0);
    expect(runOk.stdout).toMatch(/^SATISFIED\s+alpha\.json\b/m);
    const receipts = JSON.parse(readFileSync(outPath, 'utf8'));
    expect(receipts.head).toBe(HEAD);
    expect(receipts.exactHead).toBe(false);
    expect(receipts.manifests[0].receipt.sourceHead).toBe(HEAD);
    expect(receipts.manifests[0].receipt.expectedHead).toBe(HEAD);

    // Still rejects when age exceeds the raised window (2000s > 1800s).
    const tooOld = makeFixture(2000, 600);
    const evalTooOld = runEvaluator(tooOld.manifestPath, tooOld.reportPath, [
      '--expect-head',
      HEAD,
      '--max-report-age-seconds',
      '1800',
    ]);
    expect(evalTooOld.status).toBe(2);
    expect(evalTooOld.result.reasons).toContain('KF_PROOF_REPORT_STALE');
  });

  it('KF_PROOF_MAX_REPORT_AGE_SECONDS env raises the staleness window in run-manifests.mjs for slow serial runs', () => {
    const { manifestsDir, reportPath } = makeFixture(900, 600);

    const runOk = runRunner(['--manifests-dir', manifestsDir, '--report', reportPath], {
      KF_PROOF_MAX_REPORT_AGE_SECONDS: '1800',
    });
    expect(runOk.status, runOk.stdout + runOk.stderr).toBe(0);
    expect(runOk.stdout).toMatch(/^SATISFIED\s+alpha\.json\b/m);
  });

  it('NEGATIVE CONTROL: a mismatched commit SHA STILL fails closed (KF_PROOF_HEAD_MISMATCH) even with a raised stale age', () => {
    const { manifestPath, reportPath } = makeFixture(900, 600);

    const evalWrongHead = runEvaluator(manifestPath, reportPath, [
      '--expect-head',
      WRONG_HEAD,
      '--max-report-age-seconds',
      '1800',
    ]);
    expect(evalWrongHead.status).toBe(2);
    expect(evalWrongHead.result.status).toBe('REJECTED');
    expect(evalWrongHead.result.reasons).toContain('KF_PROOF_HEAD_MISMATCH');
    expect(evalWrongHead.result.sourceHead).toBe(HEAD);
    expect(evalWrongHead.result.expectedHead).toBe(WRONG_HEAD);
  });

  it('NEGATIVE CONTROL: invalid, non-positive, or unbounded --max-report-age-seconds / env values fail closed', () => {
    const { manifestsDir, manifestPath, reportPath } = makeFixture(10, 600);

    for (const bad of ['0', '-60', 'not-a-number', 'Infinity', '999999']) {
      const evalBad = runEvaluator(manifestPath, reportPath, [
        '--expect-head',
        HEAD,
        '--max-report-age-seconds',
        bad,
      ]);
      expect(evalBad.status, `evaluate.mjs bad=${bad}`).toBe(2);
      expect(evalBad.result.reasons, `evaluate.mjs bad=${bad}`).toContain('KF_PROOF_ARGUMENT_INVALID');

      const cliBad = runRunner([
        '--manifests-dir',
        manifestsDir,
        '--report',
        reportPath,
        '--max-report-age-seconds',
        bad,
      ]);
      expect(cliBad.status, `run-manifests CLI bad=${bad}`).toBe(2);

      const envBad = runRunner(['--manifests-dir', manifestsDir, '--report', reportPath], {
        KF_PROOF_MAX_REPORT_AGE_SECONDS: bad,
      });
      expect(envBad.status, `run-manifests ENV bad=${bad}`).toBe(2);
    }
  });
});
