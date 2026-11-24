/**
 * FU-CI-SHARD-PARALLEL (P24: CI C3 + C4 + C5):
 *   C3: Shard apps/server vitest 4 ways (`test-server` matrix), aggregated by
 *       `test` (`Run Tests`) running `scripts/ci/verify-vitest-shards.mjs`
 *       (fails closed unless all 4 shards passed and every tracked server test
 *       file ran exactly once).
 *   C4: Move `run-manifests` + `proof:release0` (`test-proofs`, keeping
 *       proof:release0 right after run-manifests per R0-bound [R035-13]) and
 *       `web/api/k12/self-test` (`test-web-api`) into parallel gating jobs,
 *       all required by `ci-verdict`.
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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const VERIFIER = path.join(ROOT, 'scripts', 'ci', 'verify-vitest-shards.mjs');
const WORKFLOW = path.join(ROOT, '.github', 'workflows', 'ci-cd.yml');

/** Minimal line-based job splitter (avoids importing ci-verdict.spec.mjs and double-running its suites). */
function parseWorkflowJobs(source) {
  const lines = source.split(/\r?\n/);
  const jobsStart = lines.findIndex((line) => /^jobs:\s*(#.*)?$/.test(line));
  assert.ok(jobsStart >= 0, 'ci-cd.yml must have a top-level jobs: section');
  const blocks = new Map();
  let currentId = null;
  for (const line of lines.slice(jobsStart + 1)) {
    if (line.trim() === '' || /^\s*#/.test(line)) {
      if (currentId !== null) blocks.get(currentId).push(line);
      continue;
    }
    if (/^\S/.test(line)) break;
    const head = /^ {2}([A-Za-z_][\w-]*):\s*(#.*)?$/.exec(line);
    if (head) {
      currentId = head[1];
      blocks.set(currentId, [line]);
    } else if (currentId !== null) {
      blocks.get(currentId).push(line);
    }
  }
  return blocks;
}

function jobHeaderField(blockLines, fieldName) {
  const re = new RegExp(`^ {4}${fieldName}:\\s*(.*)$`);
  for (let i = 1; i < blockLines.length; i += 1) {
    if (/^ {4}steps:\s*$/.test(blockLines[i])) break;
    const m = re.exec(blockLines[i]);
    if (m) {
      const rest = [m[1].trim()];
      for (let j = i + 1; j < blockLines.length; j += 1) {
        if (/^ {0,4}\S/.test(blockLines[j])) break;
        if (blockLines[j].trim() && !/^\s*#/.test(blockLines[j])) rest.push(blockLines[j].trim());
      }
      return rest.filter(Boolean).join(' ');
    }
  }
  return '';
}

function makeTempRepo(expectedFiles, shardReports = {}) {
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
    numPendingTestSuites: 0,
    numFailedTests: 0,
    testResults: relFiles.map((rel) => ({
      name: path.join(rootDir, rel),
      status: 'passed',
      assertionResults: [{ fullName: `${rel} > passes`, status: 'passed' }],
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

  it('RED-BEFORE: verifier script exists and passes on a valid disjoint exhaustive 4-shard union (including alternate CI runner path prefix)', () => {
    assert.ok(fs.existsSync(VERIFIER), 'scripts/ci/verify-vitest-shards.mjs must exist');
    const { dir, shardsDir } = makeTempRepo(FOUR_FILES);
    try {
      for (let i = 0; i < 3; i += 1) {
        fs.writeFileSync(
          path.join(shardsDir, `shard-${i + 1}.json`),
          JSON.stringify(makeReport(dir, [FOUR_FILES[i]])),
        );
      }
      // Shard 4 simulates a different runner workspace root prefix.
      fs.writeFileSync(
        path.join(shardsDir, 'shard-4.json'),
        JSON.stringify(makeReport('/home/runner/work/KEYFLOWOS/KEYFLOWOS', [FOUR_FILES[3]])),
      );
      const res = runVerifier(dir, shardsDir, 4);
      assert.equal(res.status, 0, `expected exit 0, got ${res.status}:\n${res.stdout}\n${res.stderr}`);
      assert.match(res.stdout, /4\/4/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('RED-BEFORE (negative control): missing shard report exits non-zero', () => {
    const { dir, shardsDir } = makeTempRepo(FOUR_FILES);
    try {
      for (let i = 0; i < 3; i += 1) {
        fs.writeFileSync(path.join(shardsDir, `shard-${i + 1}.json`), JSON.stringify(makeReport(dir, [FOUR_FILES[i]])));
      }
      const res = runVerifier(dir, shardsDir, 4);
      assert.notEqual(res.status, 0, 'missing shard-4.json must fail closed');
      assert.match(res.stderr, /shard-4\.json|missing/i);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('RED-BEFORE (negative control): omitted expected test file exits non-zero', () => {
    const { dir, shardsDir } = makeTempRepo(FOUR_FILES);
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
    const { dir, shardsDir } = makeTempRepo(FOUR_FILES);
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
    const { dir, shardsDir } = makeTempRepo(FOUR_FILES);
    try {
      fs.writeFileSync(path.join(shardsDir, 'shard-1.json'), JSON.stringify(makeReport(dir, [FOUR_FILES[0]])));
      fs.writeFileSync(
        path.join(shardsDir, 'shard-2.json'),
        JSON.stringify(
          makeReport(dir, [FOUR_FILES[1]], {
            success: false,
            numFailedTestSuites: 1,
            testResults: [{ name: path.join(dir, FOUR_FILES[1]), status: 'failed', assertionResults: [{ status: 'failed' }] }],
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

  it('RED-BEFORE (R1 MAJOR-1 negative control): numPendingTestSuites > 0 exits non-zero even when success=true', () => {
    const { dir, shardsDir } = makeTempRepo(FOUR_FILES);
    try {
      fs.writeFileSync(path.join(shardsDir, 'shard-1.json'), JSON.stringify(makeReport(dir, [FOUR_FILES[0]], { numPendingTestSuites: 1 })));
      fs.writeFileSync(path.join(shardsDir, 'shard-2.json'), JSON.stringify(makeReport(dir, [FOUR_FILES[1]])));
      fs.writeFileSync(path.join(shardsDir, 'shard-3.json'), JSON.stringify(makeReport(dir, [FOUR_FILES[2]])));
      fs.writeFileSync(path.join(shardsDir, 'shard-4.json'), JSON.stringify(makeReport(dir, [FOUR_FILES[3]])));
      const res = runVerifier(dir, shardsDir, 4);
      assert.notEqual(res.status, 0, 'numPendingTestSuites > 0 must fail closed');
      assert.match(res.stderr, /numPendingTestSuites/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('RED-BEFORE (R1 MAJOR-2 negative control): suite status=passed with failed or pending assertionResult exits non-zero', () => {
    for (const badStatus of ['failed', 'pending']) {
      const { dir, shardsDir } = makeTempRepo(FOUR_FILES);
      try {
        fs.writeFileSync(
          path.join(shardsDir, 'shard-1.json'),
          JSON.stringify(
            makeReport(dir, [FOUR_FILES[0]], {
              testResults: [
                {
                  name: path.join(dir, FOUR_FILES[0]),
                  status: 'passed',
                  assertionResults: [{ fullName: 'tampered case', status: badStatus }],
                },
              ],
            }),
          ),
        );
        fs.writeFileSync(path.join(shardsDir, 'shard-2.json'), JSON.stringify(makeReport(dir, [FOUR_FILES[1]])));
        fs.writeFileSync(path.join(shardsDir, 'shard-3.json'), JSON.stringify(makeReport(dir, [FOUR_FILES[2]])));
        fs.writeFileSync(path.join(shardsDir, 'shard-4.json'), JSON.stringify(makeReport(dir, [FOUR_FILES[3]])));
        const res = runVerifier(dir, shardsDir, 4);
        assert.notEqual(res.status, 0, `assertion status=${badStatus} must fail closed`);
        assert.match(res.stderr, new RegExp(badStatus));
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it('RED-BEFORE (R1 MINOR-1 negative controls): corrupt JSON, extra shard-5.json, and path traversal exit non-zero', () => {
    // 1. Corrupt JSON
    {
      const { dir, shardsDir } = makeTempRepo(FOUR_FILES);
      try {
        fs.writeFileSync(path.join(shardsDir, 'shard-1.json'), '{not valid json');
        fs.writeFileSync(path.join(shardsDir, 'shard-2.json'), JSON.stringify(makeReport(dir, [FOUR_FILES[1]])));
        fs.writeFileSync(path.join(shardsDir, 'shard-3.json'), JSON.stringify(makeReport(dir, [FOUR_FILES[2]])));
        fs.writeFileSync(path.join(shardsDir, 'shard-4.json'), JSON.stringify(makeReport(dir, [FOUR_FILES[3]])));
        const res = runVerifier(dir, shardsDir, 4);
        assert.notEqual(res.status, 0, 'corrupt JSON must fail closed');
        assert.match(res.stderr, /Invalid JSON/);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }

    // 2. Unexpected extra shard-5.json
    {
      const { dir, shardsDir } = makeTempRepo(FOUR_FILES);
      try {
        for (let i = 0; i < 4; i += 1) {
          fs.writeFileSync(path.join(shardsDir, `shard-${i + 1}.json`), JSON.stringify(makeReport(dir, [FOUR_FILES[i]])));
        }
        fs.writeFileSync(path.join(shardsDir, 'shard-5.json'), JSON.stringify(makeReport(dir, [])));
        const res = runVerifier(dir, shardsDir, 4);
        assert.notEqual(res.status, 0, 'extra shard-5.json must fail closed');
        assert.match(res.stderr, /shard-5\.json/);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }

    // 3. Path traversal escaping subdir
    {
      const { dir, shardsDir } = makeTempRepo(FOUR_FILES);
      try {
        fs.writeFileSync(
          path.join(shardsDir, 'shard-1.json'),
          JSON.stringify(
            makeReport(dir, [FOUR_FILES[0]], {
              testResults: [{ name: 'apps/server/../../etc/passwd', status: 'passed', assertionResults: [] }],
            }),
          ),
        );
        fs.writeFileSync(path.join(shardsDir, 'shard-2.json'), JSON.stringify(makeReport(dir, [FOUR_FILES[1]])));
        fs.writeFileSync(path.join(shardsDir, 'shard-3.json'), JSON.stringify(makeReport(dir, [FOUR_FILES[2]])));
        fs.writeFileSync(path.join(shardsDir, 'shard-4.json'), JSON.stringify(makeReport(dir, [FOUR_FILES[3]])));
        const res = runVerifier(dir, shardsDir, 4);
        assert.notEqual(res.status, 0, 'path traversal must fail closed');
        assert.match(res.stderr, /could not normalize/);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  });
});

describe('FU-CI-SHARD-PARALLEL (P24): ci-cd.yml workflow structure (C3 + C4 + C5)', () => {
  const source = fs.readFileSync(WORKFLOW, 'utf8');
  const blocks = parseWorkflowJobs(source);

  it('RED-BEFORE (C3): test-server runs 4 vitest shards and test (Run Tests) aggregates them with verify-vitest-shards.mjs', () => {
    assert.ok(blocks.has('test-server'), 'ci-cd.yml must define test-server shard job');
    assert.ok(blocks.has('test'), 'ci-cd.yml must retain test aggregate job id');
    const serverText = blocks.get('test-server').join('\n');
    assert.ok(serverText.includes('--shard=${{ matrix.shard }}/4'), 'test-server must run vitest --shard=${{ matrix.shard }}/4');
    const aggLines = blocks.get('test');
    const aggText = aggLines.join('\n');
    assert.equal(jobHeaderField(aggLines, 'name'), 'Run Tests', 'test job display name must stay Run Tests for scripts/deploy.sh');
    assert.ok(jobHeaderField(aggLines, 'needs').includes('test-server'), 'test aggregate job must need test-server');
    assert.ok(aggText.includes('scripts/ci/verify-vitest-shards.mjs'), 'test aggregate job must run verify-vitest-shards.mjs');
  });

  it('RED-BEFORE (C4): test-proofs (run-manifests + release0 consecutive for R035-13) and test-web-api run in parallel gating jobs', () => {
    for (const id of ['test-proofs', 'test-web-api']) {
      assert.ok(blocks.has(id), `ci-cd.yml must define parallel gating job ${id}`);
    }
    const proofsText = blocks.get('test-proofs').join('\n');
    const manifestIdx = proofsText.indexOf('node scripts/proof-admission/run-manifests.mjs --skip-build');
    const r0Idx = proofsText.indexOf('pnpm --filter server proof:release0 --skip-build');
    assert.ok(manifestIdx >= 0 && r0Idx > manifestIdx, 'test-proofs must run run-manifests followed by proof:release0');
    assert.equal(
      (proofsText.slice(manifestIdx, r0Idx).match(/\n\s+- name:/g) ?? []).length,
      1,
      'proof:release0 must remain the step immediately after run-manifests ([R035-13])',
    );
    const webApiText = blocks.get('test-web-api').join('\n');
    assert.ok(webApiText.includes('scripts/ci/test-local.selftest.sh'));
    assert.ok(webApiText.includes('proof:k12'));
    assert.ok(webApiText.includes('pnpm --filter web test:unit'));
    assert.ok(webApiText.includes('pnpm --filter @keyflow/api test:unit'));
  });

  it('RED-BEFORE (C5): build and test jobs do not wait on lint-and-typecheck (ci-verdict still gates on all)', () => {
    for (const id of ['build-server', 'build-web', 'e2e-mocked', 'test-server', 'test-proofs', 'test-web-api']) {
      assert.ok(blocks.has(id), `expected job ${id}`);
      const needsText = jobHeaderField(blocks.get(id), 'needs');
      assert.ok(!needsText.includes('lint-and-typecheck'), `${id} must not wait on lint-and-typecheck`);
    }
  });

  it('CONTROL: lint-and-typecheck still exists and runs the Node runtime pin and script-spec census', () => {
    assert.ok(blocks.has('lint-and-typecheck'));
    const tcText = blocks.get('lint-and-typecheck').join('\n');
    assert.ok(tcText.includes('scripts/ci/runtime-pin.spec.mjs'));
    assert.ok(tcText.includes('scripts/ci/script-specs-in-ci.spec.mjs'));
  });
});
