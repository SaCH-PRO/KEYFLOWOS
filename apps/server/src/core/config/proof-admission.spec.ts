import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const EVALUATOR = resolve(process.cwd(), '../../scripts/proof-admission/evaluate.mjs');

type AssertionStatus = 'passed' | 'failed' | 'pending' | 'todo' | 'skipped';

function makeManifest(requiredCases: string[]) {
  return {
    manifestVersion: 1,
    packageId: 'KF-EXEC-K12-001',
    proofScope: 'fixture',
    requireReportSuccess: true,
    allowAdditionalCases: true,
    requiredCases,
  };
}

function makeReport(cases: Array<{ fullName: string; status: AssertionStatus }>, success = true) {
  return {
    numTotalTestSuites: 1,
    numPassedTestSuites: success ? 1 : 0,
    numFailedTestSuites: success ? 0 : 1,
    numPendingTestSuites: 0,
    numTotalTests: cases.length,
    numPassedTests: cases.filter((c) => c.status === 'passed').length,
    numFailedTests: cases.filter((c) => c.status === 'failed').length,
    numPendingTests: cases.filter((c) => ['pending', 'skipped'].includes(c.status)).length,
    numTodoTests: cases.filter((c) => c.status === 'todo').length,
    startTime: Date.now(),
    success,
    testResults: [
      {
        assertionResults: cases.map((c) => ({
          ancestorTitles: ['proof fixture'],
          fullName: c.fullName,
          status: c.status,
          title: c.fullName,
          duration: 1,
          failureMessages: c.status === 'failed' ? ['fixture failure'] : [],
        })),
        status: success ? 'passed' : 'failed',
        message: '',
        name: 'proof-fixture.spec.ts',
      },
    ],
  };
}

function runEvaluator(manifest: unknown, report: unknown) {
  const dir = mkdtempSync(join(tmpdir(), 'kf-proof-'));
  const manifestPath = join(dir, 'manifest.json');
  const reportPath = join(dir, 'report.json');
  writeFileSync(manifestPath, JSON.stringify(manifest));
  writeFileSync(reportPath, JSON.stringify(report));

  const child = spawnSync(process.execPath, [EVALUATOR, '--manifest', manifestPath, '--report', reportPath], {
    encoding: 'utf8',
  });
  return {
    status: child.status,
    result: JSON.parse(child.stdout.trim()),
  };
}

describe('proof admission evaluator', () => {
  it('[K12-P01] accepts exact passing required cases', () => {
    const result = runEvaluator(makeManifest(['case A']), makeReport([{ fullName: 'case A', status: 'passed' }]));
    expect(result.status).toBe(0);
    expect(result.result.status).toBe('SATISFIED_AT_DECLARED_SCOPE');
  });

  it('[K12-P02] rejects a missing required case', () => {
    const result = runEvaluator(makeManifest(['case A', 'case B']), makeReport([{ fullName: 'case A', status: 'passed' }]));
    expect(result.status).toBe(2);
    expect(result.result.reasons).toContain('KF_PROOF_REQUIRED_CASE_MISSING');
  });

  it('[K12-P03] rejects duplicate case identities', () => {
    const report = makeReport([
      { fullName: 'case A', status: 'passed' },
      { fullName: 'case A', status: 'passed' },
    ]);
    const result = runEvaluator(makeManifest(['case A']), report);
    expect(result.status).toBe(2);
    expect(result.result.reasons).toContain('KF_PROOF_DUPLICATE_CASE_ID');
  });

  it('[K12-P04] rejects skipped required cases', () => {
    const result = runEvaluator(makeManifest(['case A']), makeReport([{ fullName: 'case A', status: 'skipped' }]));
    expect(result.status).toBe(2);
    expect(result.result.reasons).toContain('KF_PROOF_REQUIRED_CASE_SKIPPED');
  });

  it('[K12-P05] rejects failed required cases', () => {
    const result = runEvaluator(makeManifest(['case A']), makeReport([{ fullName: 'case A', status: 'failed' }], false));
    expect(result.status).toBe(2);
    expect(result.result.reasons).toContain('KF_PROOF_REQUIRED_CASE_FAILED');
  });

  it('[K12-P06] rejects malformed report structure', () => {
    const result = runEvaluator(makeManifest(['case A']), { success: true });
    expect(result.status).toBe(2);
    expect(result.result.reasons).toContain('KF_PROOF_REPORT_MALFORMED');
  });

  it('[K12-P07] rejects unsuccessful aggregate reports', () => {
    const result = runEvaluator(makeManifest(['case A']), makeReport([{ fullName: 'case A', status: 'passed' }], false));
    expect(result.status).toBe(2);
    expect(result.result.reasons).toContain('KF_PROOF_REPORT_UNSUCCESSFUL');
  });

  it('[K12-P08] reports a missing runner report as incomplete', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kf-proof-'));
    const manifestPath = join(dir, 'manifest.json');
    writeFileSync(manifestPath, JSON.stringify(makeManifest(['case A'])));

    const child = spawnSync(process.execPath, [
      EVALUATOR,
      '--manifest',
      manifestPath,
      '--report',
      join(dir, 'missing-report.json'),
    ], { encoding: 'utf8' });

    expect(child.status).toBe(3);
    const result = JSON.parse(child.stdout.trim());
    expect(result.status).toBe('INCOMPLETE');
    expect(result.reasons).toContain('KF_PROOF_REPORT_MISSING');
  });

  it('[K12-P09] rejects duplicate required identities in the accepted manifest', () => {
    const result = runEvaluator(makeManifest(['case A', 'case A']), makeReport([{ fullName: 'case A', status: 'passed' }]));
    expect(result.status).toBe(2);
    expect(result.result.reasons).toContain('KF_PROOF_MANIFEST_DUPLICATE_CASE_ID');
  });
});
