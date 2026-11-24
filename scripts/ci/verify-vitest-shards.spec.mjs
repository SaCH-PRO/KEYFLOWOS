/**
 * FU-CI-SHARD-PARALLEL (P24: CI C3 + C4 + C5):
 *   C3: Shard apps/server vitest 4 ways (`test-server` matrix), aggregated by
 *       `test` running `scripts/ci/verify-vitest-shards.mjs` (fails closed unless
 *       all 4 shards passed and every tracked server test file ran exactly once).
 *   C4: Move `run-manifests`, `proof:release0`, and `web/api/k12/self-test` into
 *       dedicated parallel gating jobs, all required by `ci-verdict`.
 *   C5: Drop `needs: [lint-and-typecheck]` from `build-server`, `build-web`,
 *       `e2e-mocked`, and the test jobs so they start in parallel while
 *       `ci-verdict` still gates on all of them.
 *
 * Run: node --test scripts/ci/verify-vitest-shards.spec.mjs
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { jobBlocks, readJob } from './ci-verdict.spec.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const VERIFIER = path.join(ROOT, 'scripts', 'ci', 'verify-vitest-shards.mjs');
const WORKFLOW = path.join(ROOT, '.github', 'workflows', 'ci-cd.yml');

function makeTempRepo(expectedFiles, shardReports) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-shard-verify-'));
  const git = (args) => {
    const res = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
    assert.equal(res.status, 0, `git ${args.join(' ')} failed: ${res.stderr}`);
  };
  git(['init', '-q']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);

  for (const rel of expectedFiles) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, '// stub test\n');
  }
  git(['add', '.']);
  git(['commit', '-q', '-m', 'seed']);

  const shardsDir = path.join(dir, 'shards');
  fs.mkdirSync(shardsDir, { recursive: true });
  for (const [name, payload] of Object.entries(shardReports)) {
    fs.writeFileSync(path.join(shardsDir, name), typeof payload === 'string' ? payload : JSON.stringify(payload));
  }
  return { dir, shardsDir };
}

function makeReport(rootDir, relFiles, overrides = {}) {
  return {
    success: true,
    numTotalTestSuites: relFiles.length,
    numPassedTestSuites: relFiles.length,
    numFailedTestSuites: 0,
    numFailedTests: 0,
    testResults: relFiles.map((rel) => ({
      name: path.join(rootDir, rel),
      status: 'passed',
    })),
    ...overrides,
  };
}

function runVerifier(dir, shardsDir, totalShards = 4) {
  return spawnSync(
    process.execPath,
    [VERIFIER, '--root', dir, '--subdir', 'apps/server', '--shards-dir', shardsDir, '--total-shards', String(totalShards)],
    { encoding: 'utf8' },
  );
}

describe('FU-CI-SHARD-PARALLEL (P24): verify-vitest-shards.mjs contract & negative controls', () => {
  const FOUR_FILES = [
    'apps/server/src/a.spec.ts',
    'apps/server/src/b.spec.ts',
    'apps/server/test/c.integration.test.ts',
    'apps/server/test/d.e2e.test.ts',
  ];

  it('RED-BEFORE: verifier script exists and passes on a valid disjoint exhaustive 4-shard union', () => {
    assert.ok(fs.existsSync(VERIFIER), 'scripts/ci/verify-vitest-shards.mjs must exist');
    const { dir, shardsDir } = makeTempRepo(FOUR_FILES, {});
    try {
      for (let i = 0; i < 4; i += 1) {
        fs.writeFileSync(
          path.join(shardsDir, `shard-${i + 1}.json`),
          JSON.stringify(makeReport(dir, [FOUR_FILES[i]])),
        );
      }
      const res = runVerifier(dir, shardsDir, 4);
      assert.equal(res.status, 0, `expected exit 0, got ${res.status}:\n${res.stdout}\n${res.stderr}`);
      assert.match(res.stdout, /4\/4/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('RED-BEFORE (negative control): missing shard report exits non-zero', () => {
    assert.ok(fs.existsSync(VERIFIER), 'scripts/ci/verify-vitest-shards.mjs must exist');
    const { dir, shardsDir } = makeTempRepo(FOUR_FILES, {});
    try {
      for (let i = 0; i < 3; i += 1) {
        fs.writeFileSync(
          path.join(shardsDir, `shard-${i + 1}.json`),
          JSON.stringify(makeReport(dir, [FOUR_FILES[i]])),
        );
      }
      const res = runVerifier(dir, shardsDir, 4);
      assert.notEqual(res.status, 0, 'missing shard-4.json must fail closed');
      assert.match(res.stderr, /shard-4\.json|missing/i);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('RED-BEFORE (negative control): omitted expected test file exits non-zero', () => {
    assert.ok(fs.existsSync(VERIFIER), 'scripts/ci/verify-vitest-shards.mjs must exist');
    const { dir, shardsDir } = makeTempRepo(FOUR_FILES, {});
    try {
      fs.writeFileSync(path.join(shardsDir, 'shard-1.json'), JSON.stringify(makeReport(dir, [FOUR_FILES[0]])));
      fs.writeFileSync(path.join(shardsDir, 'shard-2.json'), JSON.stringify(makeReport(dir, [FOUR_FILES[1]])));
      fs.writeFileSync(path.join(shardsDir, 'shard-3.json'), JSON.stringify(makeReport(dir, [FOUR_FILES[2]])));
      fs.writeFileSync(path.join(shardsDir, 'shard-4.json'), JSON.stringify(makeReport(dir, [])));
      const res = runVerifier(dir, shardsDir, 4);
      assert.notEqual(res.status, 0, 'omitted test file must fail closed');
      assert.match(res.stderr, /d\.e2e\.test\.ts/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('RED-BEFORE (negative control): duplicate test file across shards exits non-zero', () => {
    assert.ok(fs.existsSync(VERIFIER), 'scripts/ci/verify-vitest-shards.mjs must exist');
    const { dir, shardsDir } = makeTempRepo(FOUR_FILES, {});
    try {
      fs.writeFileSync(path.join(shardsDir, 'shard-1.json'), JSON.stringify(makeReport(dir, [FOUR_FILES[0], FOUR_FILES[1]])));
      fs.writeFileSync(path.join(shardsDir, 'shard-2.json'), JSON.stringify(makeReport(dir, [FOUR_FILES[1]])));
      fs.writeFileSync(path.join(shardsDir, 'shard-3.json'), JSON.stringify(makeReport(dir, [FOUR_FILES[2]])));
      fs.writeFileSync(path.join(shardsDir, 'shard-4.json'), JSON.stringify(makeReport(dir, [FOUR_FILES[3]])));
      const res = runVerifier(dir, shardsDir, 4);
      assert.notEqual(res.status, 0, 'duplicate file across shards must fail closed');
      assert.match(res.stderr, /duplicate/i);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('RED-BEFORE (negative control): shard with failed suite or success=false exits non-zero', () => {
    assert.ok(fs.existsSync(VERIFIER), 'scripts/ci/verify-vitest-shards.mjs must exist');
    const { dir, shardsDir } = makeTempRepo(FOUR_FILES, {});
    try {
      fs.writeFileSync(path.join(shardsDir, 'shard-1.json'), JSON.stringify(makeReport(dir, [FOUR_FILES[0]])));
      fs.writeFileSync(
        path.join(shardsDir, 'shard-2.json'),
        JSON.stringify(
          makeReport(dir, [FOUR_FILES[1]], {
            success: false,
            numFailedTestSuites: 1,
            testResults: [{ name: path.join(dir, FOUR_FILES[1]), status: 'failed' }],
          }),
        ),
      );
      fs.writeFileSync(path.join(shardsDir, 'shard-3.json'), JSON.stringify(makeReport(dir, [FOUR_FILES[2]])));
      fs.writeFileSync(path.join(shardsDir, 'shard-4.json'), JSON.stringify(makeReport(dir, [FOUR_FILES[3]])));
      const res = runVerifier(dir, shardsDir, 4);
      assert.notEqual(res.status, 0, 'failed suite in shard must fail closed');
      assert.match(res.stderr, /failed|success/i);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('FU-CI-SHARD-PARALLEL (P24): ci-cd.yml workflow structure (C3 + C4 + C5)', () => {
  const source = fs.readFileSync(WORKFLOW, 'utf8');
  const blocks = jobBlocks(source);

  it('RED-BEFORE (C3): test-server runs 4 vitest shards and test aggregates them with verify-vitest-shards.mjs', () => {
    assert.ok(blocks.has('test-server'), 'ci-cd.yml must define test-server shard job');
    assert.ok(blocks.has('test'), 'ci-cd.yml must retain test aggregate job id');
    const serverJob = readJob(blocks.get('test-server'));
    assert.ok(serverJob.steps.some((s) => (s.run ?? '').includes('--shard=${{ matrix.shard }}/4')), 'test-server must run vitest --shard=${{ matrix.shard }}/4');
    const aggJob = readJob(blocks.get('test'));
    assert.ok(
      (aggJob.header.needs?.inline ?? '').includes('test-server') ||
        (aggJob.header.needs?.block ?? []).some((l) => l.includes('test-server')),
      'test aggregate job must need test-server',
    );
    assert.ok(
      aggJob.steps.some((s) => (s.run ?? '').includes('scripts/ci/verify-vitest-shards.mjs')),
      'test aggregate job must run verify-vitest-shards.mjs',
    );
  });

  it('RED-BEFORE (C4): run-manifests, proof:release0, and web/api/k12/self-test run in parallel gating jobs', () => {
    for (const id of ['test-manifests', 'test-release0', 'test-web-api']) {
      assert.ok(blocks.has(id), `ci-cd.yml must define parallel gating job ${id}`);
    }
    const manifestsJob = readJob(blocks.get('test-manifests'));
    assert.ok(manifestsJob.steps.some((s) => (s.run ?? '').includes('scripts/proof-admission/run-manifests.mjs')));
    const r0Job = readJob(blocks.get('test-release0'));
    assert.ok(r0Job.steps.some((s) => (s.run ?? '').includes('proof:release0')));
    const webApiJob = readJob(blocks.get('test-web-api'));
    assert.ok(webApiJob.steps.some((s) => (s.run ?? '').includes('scripts/ci/test-local.selftest.sh')));
    assert.ok(webApiJob.steps.some((s) => (s.run ?? '').includes('proof:k12')));
    assert.ok(webApiJob.steps.some((s) => (s.run ?? '').includes('pnpm --filter web test:unit')));
    assert.ok(webApiJob.steps.some((s) => (s.run ?? '').includes('pnpm --filter @keyflow/api test:unit')));
  });

  it('RED-BEFORE (C5): build and test jobs do not wait on lint-and-typecheck (ci-verdict still gates on all)', () => {
    for (const id of ['build-server', 'build-web', 'e2e-mocked', 'test-server', 'test-manifests', 'test-release0', 'test-web-api']) {
      assert.ok(blocks.has(id), `expected job ${id}`);
      const job = readJob(blocks.get(id));
      const needsText = `${job.header.needs?.inline ?? ''} ${(job.header.needs?.block ?? []).join(' ')}`;
      assert.ok(!needsText.includes('lint-and-typecheck'), `${id} must not wait on lint-and-typecheck`);
    }
  });

  it('CONTROL: lint-and-typecheck still exists and runs the Node runtime pin and script-spec census', () => {
    assert.ok(blocks.has('lint-and-typecheck'));
    const tc = readJob(blocks.get('lint-and-typecheck'));
    assert.ok(tc.steps.some((s) => (s.run ?? '').includes('scripts/ci/runtime-pin.spec.mjs')));
    assert.ok(tc.steps.some((s) => (s.run ?? '').includes('scripts/ci/script-specs-in-ci.spec.mjs')));
  });
});
