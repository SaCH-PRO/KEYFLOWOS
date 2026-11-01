import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
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
    maxReportAgeSeconds: 600,
    // R0-16-PROOF-BINDING: a manifest names the suites it binds (or a
    // description `npx vitest run` command); one that binds nothing is
    // KF_PROOF_MANIFEST_UNBOUND. The fixture report below is one suite file.
    suites: ['proof-fixture.spec.ts'],
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

function runEvaluator(manifest: unknown, report: unknown, extraArgs: string[] = []) {
  const dir = mkdtempSync(join(tmpdir(), 'kf-proof-'));
  const manifestPath = join(dir, 'manifest.json');
  const reportPath = join(dir, 'report.json');
  writeFileSync(manifestPath, JSON.stringify(manifest));
  writeFileSync(reportPath, JSON.stringify(report));

  const child = spawnSync(process.execPath, [EVALUATOR, '--manifest', manifestPath, '--report', reportPath, ...extraArgs], {
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

  it('[K12-P10] rejects a stale runner report', () => {
    const report = makeReport([{ fullName: 'case A', status: 'passed' }]);
    report.startTime = Date.now() - 20 * 60 * 1000;
    const result = runEvaluator(makeManifest(['case A']), report);
    expect(result.status).toBe(2);
    expect(result.result.reasons).toContain('KF_PROOF_REPORT_STALE');
  });
});

// ---------------------------------------------------------------------------
// R0-16-PROOF-BINDING: exact-head verdicts and suite-scoped evaluation of one
// combined report against every case manifest.
// ---------------------------------------------------------------------------

const REPO = resolve(process.cwd(), '../..');
const RUNNER = join(REPO, 'scripts', 'proof-admission', 'run-manifests.mjs');
const MANIFESTS_DIR = join(REPO, 'scripts', 'proof-admission', 'manifests');
const HEAD = execFileSync('git', ['-C', REPO, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const WRONG_HEAD = HEAD.replace(/.$/, (c) => (c === '0' ? '1' : '0'));

type FixtureCase = { fullName: string; status: AssertionStatus };

/** A vitest JSON report of several suite files, named the way vitest names them (absolute paths). */
function makeCombinedReport(files: Array<{ name: string; cases: FixtureCase[] }>) {
  const all = files.flatMap((f) => f.cases);
  const failedFiles = files.filter((f) => f.cases.some((c) => c.status === 'failed'));
  return {
    numTotalTestSuites: files.length,
    numPassedTestSuites: files.length - failedFiles.length,
    numFailedTestSuites: failedFiles.length,
    numPendingTestSuites: 0,
    numTotalTests: all.length,
    numPassedTests: all.filter((c) => c.status === 'passed').length,
    numFailedTests: all.filter((c) => c.status === 'failed').length,
    numPendingTests: all.filter((c) => ['pending', 'skipped'].includes(c.status)).length,
    numTodoTests: all.filter((c) => c.status === 'todo').length,
    startTime: Date.now(),
    success: failedFiles.length === 0,
    testResults: files.map((f) => ({
      assertionResults: f.cases.map((c) => ({
        ancestorTitles: [],
        fullName: c.fullName,
        status: c.status,
        title: c.fullName,
        duration: 1,
        failureMessages: c.status === 'failed' ? ['fixture failure'] : [],
      })),
      status: f.cases.some((c) => c.status === 'failed') ? 'failed' : 'passed',
      message: '',
      name: `/ci/checkout/apps/server/${f.name}`,
    })),
  };
}

function boundManifest(overrides: Record<string, unknown>) {
  return {
    manifestVersion: 1,
    packageId: 'KF-R0-16-FIXTURE',
    proofScope: 'fixture',
    requireReportSuccess: true,
    allowAdditionalCases: false,
    requiredCases: ['alpha one', 'alpha two'],
    suites: ['test/alpha.integration.test.ts'],
    ...overrides,
  };
}

function withoutSuites(manifest: Record<string, unknown>) {
  const copy = { ...manifest };
  delete copy.suites;
  return copy;
}

const passed = (fullName: string): FixtureCase => ({ fullName, status: 'passed' });

const ALPHA = { name: 'test/alpha.integration.test.ts', cases: [passed('alpha one'), passed('alpha two')] };
const BETA = { name: 'src/beta/beta.service.spec.ts', cases: [passed('beta one'), passed('beta two'), passed('beta three')] };

describe('proof admission evaluator: exact head and suite binding (R0-16-PROOF-BINDING)', () => {
  it('[K12-P17] the verdict carries the evaluated head, and the exact --expect-head is satisfied', () => {
    const result = runEvaluator(boundManifest({}), makeCombinedReport([ALPHA]), ['--expect-head', HEAD]);
    expect(result.status).toBe(0);
    expect(result.result.status).toBe('SATISFIED_AT_DECLARED_SCOPE');
    expect(result.result.sourceHead).toBe(HEAD);
    expect(result.result.expectedHead).toBe(HEAD);
    expect(typeof result.result.sourceTreeClean).toBe('boolean');
  });

  it('[K12-P18] NEGATIVE CONTROL: a wrong --expect-head is REJECTED (KF_PROOF_HEAD_MISMATCH) although every case passed', () => {
    const result = runEvaluator(boundManifest({}), makeCombinedReport([ALPHA]), ['--expect-head', WRONG_HEAD]);
    expect(result.status).toBe(2);
    expect(result.result.status).toBe('REJECTED');
    expect(result.result.reasons).toContain('KF_PROOF_HEAD_MISMATCH');
    expect(result.result.sourceHead).toBe(HEAD);
    expect(result.result.expectedHead).toBe(WRONG_HEAD);
  });

  it('[K12-P19] NEGATIVE CONTROL: a malformed --expect-head is refused as an invalid argument', () => {
    const result = runEvaluator(boundManifest({}), makeCombinedReport([ALPHA]), ['--expect-head', 'main']);
    expect(result.status).toBe(2);
    expect(result.result.reasons).toContain('KF_PROOF_ARGUMENT_INVALID');
  });

  it('[K12-P20] NEGATIVE CONTROL: a misspelled required case gives KF_PROOF_REQUIRED_CASE_MISSING in a combined report', () => {
    const manifest = boundManifest({ requiredCases: ['alpha one', 'alpha tow'], allowAdditionalCases: true });
    const result = runEvaluator(manifest, makeCombinedReport([ALPHA, BETA]), ['--expect-head', HEAD]);
    expect(result.status).toBe(2);
    expect(result.result.reasons).toContain('KF_PROOF_REQUIRED_CASE_MISSING');
    expect(result.result.missing).toEqual(['alpha tow']);
  });

  it('[K12-P21] NEGATIVE CONTROL: a skipped required case in a combined report is rejected', () => {
    const alpha = { name: ALPHA.name, cases: [passed('alpha one'), { fullName: 'alpha two', status: 'skipped' as const }] };
    const result = runEvaluator(boundManifest({}), makeCombinedReport([alpha, BETA]), ['--expect-head', HEAD]);
    expect(result.status).toBe(2);
    expect(result.result.reasons).toContain('KF_PROOF_REQUIRED_CASE_SKIPPED');
  });

  it('[K12-P22] NEGATIVE CONTROL: a strict manifest rejects an unexpected case in a suite it binds', () => {
    const alpha = { name: ALPHA.name, cases: [...ALPHA.cases, passed('alpha renamed three')] };
    const result = runEvaluator(boundManifest({}), makeCombinedReport([alpha, BETA]), ['--expect-head', HEAD]);
    expect(result.status).toBe(2);
    expect(result.result.reasons).toContain('KF_PROOF_UNEXPECTED_CASE');
    expect(result.result.unexpected).toEqual(['alpha renamed three']);
  });

  it('[K12-P23] a strict manifest ignores the cases of a suite it does not bind in the same combined report', () => {
    const result = runEvaluator(boundManifest({}), makeCombinedReport([ALPHA, BETA]), ['--expect-head', HEAD]);
    expect(result.status).toBe(0);
    expect(result.result.status).toBe('SATISFIED_AT_DECLARED_SCOPE');
    expect(result.result.discoveredCaseCount).toBe(2);
    expect(result.result.boundSuites).toEqual(['test/alpha.integration.test.ts']);
  });

  it('[K12-P24] a failing suite the manifest does not bind leaves it satisfied; a failing suite it binds rejects it', () => {
    const betaFailing = { name: BETA.name, cases: [passed('beta one'), { fullName: 'beta two', status: 'failed' as const }] };
    const report = makeCombinedReport([ALPHA, betaFailing]);
    expect(report.success).toBe(false);

    const unbound = runEvaluator(boundManifest({}), report, ['--expect-head', HEAD]);
    expect(unbound.status).toBe(0);

    const lenient = boundManifest({ requiredCases: ['beta one'], suites: [BETA.name], allowAdditionalCases: true });
    const bound = runEvaluator(lenient, report, ['--expect-head', HEAD]);
    expect(bound.status).toBe(2);
    expect(bound.result.reasons).toContain('KF_PROOF_REPORT_UNSUCCESSFUL');
  });

  it('[K12-P25] NEGATIVE CONTROL: a manifest with neither suites nor a description command is KF_PROOF_MANIFEST_UNBOUND', () => {
    const noSuites = withoutSuites(boundManifest({}));
    const bare = runEvaluator(noSuites, makeCombinedReport([ALPHA]), ['--expect-head', HEAD]);
    expect(bare.status).toBe(2);
    expect(bare.result.reasons).toContain('KF_PROOF_MANIFEST_UNBOUND');

    const prose = runEvaluator(
      { ...noSuites, description: 'Proves alpha. Run the alpha suite against a migrated database.' },
      makeCombinedReport([ALPHA]),
      ['--expect-head', HEAD],
    );
    expect(prose.status).toBe(2);
    expect(prose.result.reasons).toContain('KF_PROOF_MANIFEST_UNBOUND');

    const empty = runEvaluator(boundManifest({ suites: [] }), makeCombinedReport([ALPHA]), ['--expect-head', HEAD]);
    expect(empty.status).toBe(2);
    expect(empty.result.reasons).toContain('KF_PROOF_MANIFEST_UNBOUND');
  });

  it("[K12-P26] a manifest with no suites field binds the files of its description's npx vitest run command", () => {
    const manifest = {
      ...withoutSuites(boundManifest({})),
      description:
        'Alpha holds. Run from apps/server: npx vitest run test/alpha.integration.test.ts --no-file-parallelism ' +
        '--reporter=json --outputFile=.proof/alpha.json, then node ../../scripts/proof-admission/evaluate.mjs ' +
        '--manifest ../../scripts/proof-admission/manifests/alpha.json --report .proof/alpha.json. ' +
        'A later packet that adds a case to src/beta/beta.service.spec.ts binds it elsewhere.',
    };
    const satisfied = runEvaluator(manifest, makeCombinedReport([ALPHA, BETA]), ['--expect-head', HEAD]);
    expect(satisfied.status).toBe(0);
    expect(satisfied.result.boundSuites).toEqual(['test/alpha.integration.test.ts']);
    expect(satisfied.result.suiteSource).toBe('description');

    const alpha = { name: ALPHA.name, cases: [...ALPHA.cases, passed('alpha extra')] };
    const rejected = runEvaluator(manifest, makeCombinedReport([alpha, BETA]), ['--expect-head', HEAD]);
    expect(rejected.status).toBe(2);
    expect(rejected.result.reasons).toContain('KF_PROOF_UNEXPECTED_CASE');
  });

  it('[K12-P27] NEGATIVE CONTROL: a declared suite that is absent from the report is KF_PROOF_BOUND_SUITE_MISSING', () => {
    const manifest = boundManifest({ suites: ['test/alpha.integration.test.ts', 'test/alpha-typo.integration.test.ts'] });
    const result = runEvaluator(manifest, makeCombinedReport([ALPHA, BETA]), ['--expect-head', HEAD]);
    expect(result.status).toBe(2);
    expect(result.result.reasons).toContain('KF_PROOF_BOUND_SUITE_MISSING');
    expect(result.result.missingSuites).toEqual(['test/alpha-typo.integration.test.ts']);
  });

  it('[K12-P28] NEGATIVE CONTROL: a suites entry that is not a plain relative path is an untrusted manifest', () => {
    const invalid: unknown[] = [
      ['/abs/test/alpha.integration.test.ts'],
      ['../alpha.integration.test.ts'],
      [''],
      [{ path: 7 }],
      'test/alpha.integration.test.ts',
    ];
    for (const suites of invalid) {
      const result = runEvaluator(boundManifest({ suites }), makeCombinedReport([ALPHA]), ['--expect-head', HEAD]);
      expect(result.status, JSON.stringify(suites)).toBe(2);
      expect(result.result.reasons, JSON.stringify(suites)).toContain('KF_PROOF_MANIFEST_UNTRUSTED');
    }
    const object = runEvaluator(
      boundManifest({ suites: [{ path: 'test/alpha.integration.test.ts', needsDist: true }] }),
      makeCombinedReport([ALPHA]),
      ['--expect-head', HEAD],
    );
    expect(object.status).toBe(0);
  });

  it('[K12-P29] NEGATIVE CONTROL: a required case reported only by a suite the manifest does not bind does not satisfy it', () => {
    const manifest = boundManifest({ requiredCases: ['alpha one', 'alpha two', 'beta one'], allowAdditionalCases: true });
    const result = runEvaluator(manifest, makeCombinedReport([ALPHA, BETA]), ['--expect-head', HEAD]);
    expect(result.status).toBe(2);
    expect(result.result.reasons).toContain('KF_PROOF_REQUIRED_CASE_MISSING');
    expect(result.result.missing).toEqual(['beta one']);
  });

  it('[K12-P30] a duplicate case identity is rejected inside the bound suites and ignored outside them', () => {
    const beta = { name: BETA.name, cases: [passed('alpha one'), passed('beta one')] };
    const outside = runEvaluator(boundManifest({}), makeCombinedReport([ALPHA, beta]), ['--expect-head', HEAD]);
    expect(outside.status).toBe(0);

    const both = boundManifest({ suites: [ALPHA.name, BETA.name], allowAdditionalCases: true });
    const inside = runEvaluator(both, makeCombinedReport([ALPHA, beta]), ['--expect-head', HEAD]);
    expect(inside.status).toBe(2);
    expect(inside.result.reasons).toContain('KF_PROOF_DUPLICATE_CASE_ID');
  });
});

function writeJson(path: string, value: unknown) {
  writeFileSync(path, JSON.stringify(value, null, 2));
}

/** A manifests directory holding one of each kind, and a combined report that satisfies every case manifest. */
function fixtureManifestsDir() {
  const dir = mkdtempSync(join(tmpdir(), 'kf-proof-manifests-'));
  const manifests = join(dir, 'manifests');
  mkdirSync(manifests);
  writeJson(join(manifests, 'alpha.json'), boundManifest({}));
  writeJson(
    join(manifests, 'beta.json'),
    boundManifest({
      packageId: 'KF-R0-16-BETA',
      requiredCases: ['beta one'],
      allowAdditionalCases: true,
      suites: [{ path: BETA.name, needsDist: true }],
    }),
  );
  writeJson(join(manifests, 'beta-controls.json'), {
    manifestVersion: 1,
    packageId: 'KF-R0-16-BETA-CONTROLS',
    description: 'Negative controls for beta.',
    suites: [BETA.name],
    proofs: { unit: { cwd: 'apps/server', runner: 'apps/server/node_modules/vitest/vitest.mjs', args: ['run', BETA.name] } },
    controls: [
      {
        id: 'NC-BETA-1',
        claim: 'beta',
        mutation: { file: 'x.ts', find: 'a', replace: 'b' },
        mustFail: { unit: ['beta two', 'beta three'] },
      },
    ],
  });
  writeJson(join(manifests, 'local-resources.json'), {
    manifestVersion: 1,
    environment: 'fixture',
    requiredEnv: {},
    resources: [
      { env: 'DATABASE_URL', kind: 'postgres', allowedProtocols: ['postgresql:'], allowedHosts: ['localhost'], allowedPorts: [5432] },
    ],
  });
  const reportPath = join(dir, 'report.json');
  writeJson(reportPath, makeCombinedReport([ALPHA, BETA]));
  return { dir, manifests, reportPath };
}

function runRunner(args: string[]) {
  const child = spawnSync(process.execPath, [RUNNER, ...args], { encoding: 'utf8', cwd: REPO });
  return { status: child.status, stdout: child.stdout ?? '', stderr: child.stderr ?? '' };
}

describe('proof manifest runner (R0-16-PROOF-BINDING)', () => {
  it('[K12-P31] evaluates every case manifest against one report at HEAD, one line each, skipping resource manifests by type', () => {
    const { dir, manifests, reportPath } = fixtureManifestsDir();
    const out = join(dir, 'receipts.json');
    const run = runRunner(['--manifests-dir', manifests, '--report', reportPath, '--out', out]);
    expect(run.status, run.stdout + run.stderr).toBe(0);
    expect(run.stdout).toMatch(/^SATISFIED\s+alpha\.json\b/m);
    expect(run.stdout).toMatch(/^SATISFIED\s+beta\.json\b/m);
    expect(run.stdout).toMatch(/^SATISFIED\s+beta-controls\.json\b/m);
    expect(run.stdout).toMatch(/^SKIPPED\s+local-resources\.json\b.*resource/m);
    expect(run.stdout).toContain(HEAD);

    const receipts = JSON.parse(readFileSync(out, 'utf8'));
    expect(receipts.head).toBe(HEAD);
    expect(receipts.manifests).toHaveLength(4);
    for (const m of receipts.manifests.filter((r: { type: string }) => r.type !== 'resource')) {
      expect(m.receipt.sourceHead, m.file).toBe(HEAD);
      expect(m.receipt.expectedHead, m.file).toBe(HEAD);
    }
  });

  it('[K12-P32] NEGATIVE CONTROL: exits non-zero and names each manifest that is not satisfied, with its reason', () => {
    const { manifests, reportPath } = fixtureManifestsDir();
    writeJson(
      join(manifests, 'gamma.json'),
      boundManifest({ packageId: 'KF-R0-16-GAMMA', requiredCases: ['alpha one', 'alpha tow'], allowAdditionalCases: true }),
    );
    const run = runRunner(['--manifests-dir', manifests, '--report', reportPath]);
    expect(run.status).not.toBe(0);
    expect(run.stdout).toMatch(/^REJECTED\s+gamma\.json\b.*KF_PROOF_REQUIRED_CASE_MISSING/m);
    expect(run.stdout).toMatch(/^SATISFIED\s+alpha\.json\b/m);
  });

  it('[K12-P33] NEGATIVE CONTROL: a negative-controls manifest whose named test is skipped or renamed fails the run', () => {
    const { dir, manifests } = fixtureManifestsDir();
    const beta = {
      name: BETA.name,
      cases: [passed('beta one'), passed('beta 2'), { fullName: 'beta three', status: 'skipped' as const }],
    };
    const reportPath = join(dir, 'report-renamed.json');
    writeJson(reportPath, makeCombinedReport([ALPHA, beta]));
    const run = runRunner(['--manifests-dir', manifests, '--report', reportPath]);
    expect(run.status).not.toBe(0);
    expect(run.stdout).toMatch(/^REJECTED\s+beta-controls\.json\b.*KF_PROOF_REQUIRED_CASE_MISSING/m);
  });

  it('[K12-P34] NEGATIVE CONTROL: an unbound case manifest or a file of unknown type fails the run', () => {
    const { manifests, reportPath } = fixtureManifestsDir();
    writeJson(join(manifests, 'unbound.json'), withoutSuites(boundManifest({ packageId: 'KF-R0-16-UNBOUND' })));
    writeJson(join(manifests, 'mystery.json'), { manifestVersion: 1, packageId: 'KF-R0-16-MYSTERY' });
    const run = runRunner(['--manifests-dir', manifests, '--report', reportPath]);
    expect(run.status).not.toBe(0);
    expect(run.stdout).toMatch(/^REJECTED\s+unbound\.json\b.*KF_PROOF_MANIFEST_UNBOUND/m);
    expect(run.stdout).toMatch(/^REJECTED\s+mystery\.json\b.*KF_PROOF_MANIFEST_TYPE_UNKNOWN/m);
  });

  it('[K12-P35] --plan unions the suites of every case manifest, marks the ones that need dist/main.js, and runs nothing', () => {
    const { manifests } = fixtureManifestsDir();
    const run = runRunner(['--manifests-dir', manifests, '--plan', '--skip-file-check']);
    expect(run.status, run.stdout + run.stderr).toBe(0);
    const plan = JSON.parse(run.stdout);
    expect(plan.suites).toEqual([BETA.name, ALPHA.name].sort());
    expect(plan.needsDist).toBe(true);
    expect(plan.manifests.map((m: { file: string; type: string }) => `${m.file}:${m.type}`)).toEqual([
      'alpha.json:case',
      'beta-controls.json:negative-controls',
      'beta.json:case',
      'local-resources.json:resource',
    ]);
  });

  it('[K12-P36] every committed case manifest declares the suites it binds, and every declared suite file exists', () => {
    const files = readdirSync(MANIFESTS_DIR).filter((f) => f.endsWith('.json'));
    expect(files.length).toBeGreaterThan(25);
    const run = runRunner(['--plan']);
    expect(run.status, run.stdout + run.stderr).toBe(0);
    const plan = JSON.parse(run.stdout);
    expect(plan.manifests).toHaveLength(files.length);
    expect(plan.problems).toEqual([]);
    const caseManifests = plan.manifests.filter((m: { type: string }) => m.type !== 'resource');
    expect(caseManifests.length).toBeGreaterThan(25);
    for (const m of caseManifests) {
      expect(m.suites.length, `${m.file} binds no suite`).toBeGreaterThan(0);
    }
    const resource = plan.manifests.filter((m: { type: string }) => m.type === 'resource').map((m: { file: string }) => m.file);
    expect(resource).toEqual(['ci-resources.json', 'local-worktree-resources.json']);
    for (const suite of plan.suites) {
      expect(existsSync(join(REPO, 'apps', 'server', suite)), suite).toBe(true);
    }
  });
});
