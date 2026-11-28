// RR-GATE-LEDGER-MONOTONIC (REC-ANTI-FAKE-GREEN, D-261, D-262, D-239):
// CI compares every registered shrink-only ledger and floor ratchet between
// base and head via `git show` and exits 1 if any moves the wrong way.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = path.join(ROOT, 'scripts', 'ci', 'gate-ledger-monotonic.mjs');
const LEDGER_SIZES = path.join(ROOT, 'scripts', 'os', 'ledger-sizes.mjs');
const WORKFLOW = path.join(ROOT, '.github', 'workflows', 'ci-cd.yml');

function git(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
    },
  }).trim();
}

function writeFile(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
}

function makeFixtureFiles(overrides = {}) {
  const bidmEntries = Array.from({ length: overrides.businessIdModels ?? 310 }, (_, i) => `'Model${i}'`).join(', ');
  const ackUnscoped = (overrides.acknowledgedUnscoped ?? []).map((s) => `'${s}'`).join(', ');
  const neverScope = Array.from({ length: overrides.neverScope ?? 10 }, (_, i) => `'Global${i}'`).join(', ');
  const knownDead = Array.from({ length: overrides.knownDead ?? 10 }, (_, i) => `'evt.${i}'`).join(', ');
  const floorPct = overrides.floorPct ?? 39;

  const files = {
    'apps/server/src/core/prisma/tenant-model-list.spec.ts':
      `const ACKNOWLEDGED_UNSCOPED = [${ackUnscoped}];\nconst NEVER_SCOPE = [${neverScope}];\n`,
    'packages/db/src/client.ts':
      `const BUSINESS_ID_MODELS = new Set([${bidmEntries}]);\n`,
    'apps/server/src/core/event-bus/event-wiring.spec.ts':
      `const KNOWN_DEAD = new Set([${knownDead}]);\n`,
    'apps/server/src/core/config/unreachable-provider.spec.ts':
      `const UNREACHABLE_ACKNOWLEDGED = ['p1', 'p2'];\n`,
    'apps/server/src/modules/subscriptions/plans.ts':
      `const UNPRICED_ACKNOWLEDGED = ['f1'];\n`,
    'apps/server/src/modules/subscriptions/plan-limit-enforcement.spec.ts':
      `const UNENFORCED_ACKNOWLEDGED = ['l1'];\n`,
    'apps/server/src/core/auth/public-surface.spec.ts':
      `const ACKNOWLEDGED_PUBLIC = { 'a.ts': 2, 'b.ts': 3 };\n`,
    'apps/web/src/lib/__tests__/no-fabricated-screens.spec.ts':
      `const KNOWN_FABRICATED = [];\n`,
    'apps/server/src/trpc.module.spec.ts':
      `const ACKNOWLEDGED_UNCHECKED = {};\n`,
    'apps/server/src/modules/ai/handler-coverage-ratchet.spec.ts':
      `const FLOOR_PCT = ${floorPct};\n`,
    'architecture/os/state/DOC_DEBT.md':
      `| doc | false claim | disproving command | disposition |\n| --- | --- | --- | --- |\n| a.md | x | cmd | open |\n`,
    'architecture/os/state/ROUTE_PARITY.md':
      `| path | client source | recorded |\n| --- | --- | --- |\n| /x | a.ts | 2026-01-01 |\n`,
  };

  for (const [rel, val] of Object.entries(overrides.raw ?? {})) {
    if (val === null) delete files[rel];
    else files[rel] = val;
  }
  return files;
}

function initFixtureRepo(baseOverrides, headOverrides) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-ledger-mono-'));
  git(dir, ['init', '-b', 'main']);
  const baseFiles = makeFixtureFiles(baseOverrides);
  for (const [rel, content] of Object.entries(baseFiles)) {
    writeFile(dir, rel, content);
  }
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-m', 'base']);
  const baseSha = git(dir, ['rev-parse', 'HEAD']);

  // Replace tree with headFiles
  for (const rel of Object.keys(baseFiles)) {
    fs.rmSync(path.join(dir, rel), { force: true });
  }
  const headFiles = makeFixtureFiles(headOverrides);
  for (const [rel, content] of Object.entries(headFiles)) {
    writeFile(dir, rel, content);
  }
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-m', 'head']);
  const headSha = git(dir, ['rev-parse', 'HEAD']);
  return { dir, baseSha, headSha };
}

function runCli(cwd, args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: 'utf8',
  });
}

describe('RR-GATE-LEDGER-MONOTONIC: monotonic comparison across git commits', () => {
  it('flags shrink ledger growth (ACKNOWLEDGED_UNSCOPED 0 -> 1) in compare() and exits 1 in CLI', async () => {
    const mod = await import('./gate-ledger-monotonic.mjs');
    const { dir, baseSha, headSha } = initFixtureRepo(
      { acknowledgedUnscoped: [] },
      { acknowledgedUnscoped: ['NewUnscopedModel'] },
    );
    try {
      const report = mod.compareRefs({ cwd: dir, baseRef: baseSha, headRef: headSha });
      assert.equal(report.ok, false);
      assert.ok(
        report.violations.some((v) => v.name === 'tenant.acknowledged_unscoped' && v.base === 0 && v.head === 1),
        `expected tenant.acknowledged_unscoped violation, got: ${JSON.stringify(report.violations)}`,
      );

      const res = runCli(dir, ['--base', baseSha, '--head', headSha]);
      assert.equal(res.status, 1, `expected exit 1, got ${res.status}\nstdout=${res.stdout}\nstderr=${res.stderr}`);
      assert.match(res.stdout + res.stderr, /tenant\.acknowledged_unscoped/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('passes when a shrink ledger shrinks (KNOWN_DEAD 10 -> 9) and when a grow floor rises (FLOOR_PCT 39 -> 40)', async () => {
    const mod = await import('./gate-ledger-monotonic.mjs');
    const { dir, baseSha, headSha } = initFixtureRepo(
      { knownDead: 10, floorPct: 39 },
      { knownDead: 9, floorPct: 40 },
    );
    try {
      const report = mod.compareRefs({ cwd: dir, baseRef: baseSha, headRef: headSha });
      assert.equal(report.ok, true);
      assert.equal(report.violations.length, 0);

      const res = runCli(dir, ['--base', baseSha, '--head', headSha]);
      assert.equal(res.status, 0, `expected exit 0, got ${res.status}\nstdout=${res.stdout}\nstderr=${res.stderr}`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails when a grow floor falls (FLOOR_PCT 39 -> 38)', async () => {
    const mod = await import('./gate-ledger-monotonic.mjs');
    const { dir, baseSha, headSha } = initFixtureRepo(
      { floorPct: 39 },
      { floorPct: 38 },
    );
    try {
      const report = mod.compareRefs({ cwd: dir, baseRef: baseSha, headRef: headSha });
      assert.equal(report.ok, false);
      assert.ok(
        report.violations.some((v) => v.name === 'ai.handler_coverage_floor_pct' && v.base === 39 && v.head === 38),
      );

      const res = runCli(dir, ['--base', baseSha, '--head', headSha]);
      assert.equal(res.status, 1);
      assert.match(res.stdout + res.stderr, /ai\.handler_coverage_floor_pct/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails when a fixed ledger changes in either direction (NEVER_SCOPE 10 -> 11 or 10 -> 9)', async () => {
    const mod = await import('./gate-ledger-monotonic.mjs');
    for (const nextCount of [11, 9]) {
      const { dir, baseSha, headSha } = initFixtureRepo(
        { neverScope: 10 },
        { neverScope: nextCount },
      );
      try {
        const report = mod.compareRefs({ cwd: dir, baseRef: baseSha, headRef: headSha });
        assert.equal(report.ok, false);
        assert.ok(
          report.violations.some((v) => v.name === 'tenant.never_scope' && v.base === 10 && v.head === nextCount),
        );
        const res = runCli(dir, ['--base', baseSha, '--head', headSha]);
        assert.equal(res.status, 1);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it('reports a ledger absent at base as "new" and passes', async () => {
    const mod = await import('./gate-ledger-monotonic.mjs');
    const { dir, baseSha, headSha } = initFixtureRepo(
      { raw: { 'architecture/os/state/DOC_DEBT.md': null } },
      {},
    );
    try {
      const report = mod.compareRefs({ cwd: dir, baseRef: baseSha, headRef: headSha });
      assert.equal(report.ok, true);
      assert.ok(report.added.some((r) => r.name === 'docs.debt' && r.status === 'new'));

      const res = runCli(dir, ['--base', baseSha, '--head', headSha]);
      assert.equal(res.status, 0);
      assert.match(res.stdout, /docs\.debt.*new/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails when a head constant cannot be parsed or fails anti-vacuity (BUSINESS_ID_MODELS < 300)', async () => {
    const mod = await import('./gate-ledger-monotonic.mjs');
    const broken = initFixtureRepo(
      {},
      { raw: { 'apps/server/src/modules/ai/handler-coverage-ratchet.spec.ts': '// constant removed\n' } },
    );
    try {
      const report = mod.compareRefs({ cwd: broken.dir, baseRef: broken.baseSha, headRef: broken.headSha });
      assert.equal(report.ok, false);
      assert.ok(report.errors.some((e) => e.includes('ai.handler_coverage_floor_pct')));

      const res = runCli(broken.dir, ['--base', broken.baseSha, '--head', broken.headSha]);
      assert.equal(res.status, 1);
    } finally {
      fs.rmSync(broken.dir, { recursive: true, force: true });
    }

    const vacuous = initFixtureRepo({}, { businessIdModels: 50 });
    try {
      const report = mod.compareRefs({ cwd: vacuous.dir, baseRef: vacuous.baseSha, headRef: vacuous.headSha });
      assert.equal(report.ok, false);
      assert.ok(report.errors.some((e) => e.includes('BUSINESS_ID_MODELS')));
      const res = runCli(vacuous.dir, ['--base', vacuous.baseSha, '--head', vacuous.headSha]);
      assert.equal(res.status, 1);
    } finally {
      fs.rmSync(vacuous.dir, { recursive: true, force: true });
    }
  });

  it('rejects unknown/override flags and exposes measure(readFile) while preserving ledger-sizes.mjs CLI output', async () => {
    const sizesMod = await import('../os/ledger-sizes.mjs');
    assert.equal(typeof sizesMod.measure, 'function');

    const cliOut = spawnSync(process.execPath, [LEDGER_SIZES], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(cliOut.status, 0, cliOut.stderr);
    const parsedCli = JSON.parse(cliOut.stdout);
    const measured = sizesMod.measure((rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8'));
    assert.equal(measured.errors.length, 0);
    assert.deepEqual(parsedCli, measured.results);

    const badFlag = runCli(ROOT, ['--base', 'HEAD', '--head', 'HEAD', '--allow-growth']);
    assert.notEqual(badFlag.status, 0);
  });

  it('wires the gating job "Gate ledgers (monotonic)" into ci-cd.yml and ci-verdict with fetch-depth 0 and event base SHAs', () => {
    const yml = fs.readFileSync(WORKFLOW, 'utf8');
    assert.match(yml, /name:\s*Gate ledgers \(monotonic\)/);
    assert.match(yml, /fetch-depth:\s*0/);
    assert.match(yml, /GITHUB_PR_BASE_SHA:\s*\$\{\{\s*github\.event\.pull_request\.base\.sha\s*\}\}/);
    assert.match(yml, /GITHUB_MERGE_GROUP_BASE_SHA:\s*\$\{\{\s*github\.event\.merge_group\.base_sha\s*\}\}/);
    assert.match(yml, /GITHUB_BEFORE_SHA:\s*\$\{\{\s*github\.event\.before\s*\}\}/);
    assert.match(yml, /scripts\/ci\/gate-ledger-monotonic\.mjs/);
    assert.match(yml, /scripts\/ci\/gate-ledger-monotonic\.spec\.mjs/);
    assert.match(yml, /needs:\s*\[[^\]]*gate-ledgers[^\]]*\]/);
  });

  it('R1: fails closed when base has a parse or anti-vacuity error instead of treating ledgers as "new"', async () => {
    const mod = await import('./gate-ledger-monotonic.mjs');
    // Unterminated / unparseable constant at base must NOT allow growth at head as "new"
    const brokenBase = initFixtureRepo(
      {
        raw: {
          'apps/server/src/core/prisma/tenant-model-list.spec.ts':
            'const ACKNOWLEDGED_UNSCOPED = [ /* unterminated\nconst NEVER_SCOPE = [];\n',
        },
      },
      { acknowledgedUnscoped: ['SmuggledModel'] },
    );
    try {
      const report = mod.compareRefs({ cwd: brokenBase.dir, baseRef: brokenBase.baseSha, headRef: brokenBase.headSha });
      assert.equal(report.ok, false, `expected base parse error to fail closed, got: ${JSON.stringify(report)}`);
      assert.ok(report.errors.some((e) => e.includes('base') && e.includes('tenant.acknowledged_unscoped')));
      const res = runCli(brokenBase.dir, ['--base', brokenBase.baseSha, '--head', brokenBase.headSha]);
      assert.equal(res.status, 1);
    } finally {
      fs.rmSync(brokenBase.dir, { recursive: true, force: true });
    }

    // Genuine constant not yet declared in base file (e.g., new ledger registered later) is still "new"
    const absentConst = initFixtureRepo(
      {
        raw: {
          'apps/server/src/modules/ai/handler-coverage-ratchet.spec.ts': '// before FLOOR_PCT existed\n',
        },
      },
      { floorPct: 39 },
    );
    try {
      const report = mod.compareRefs({ cwd: absentConst.dir, baseRef: absentConst.baseSha, headRef: absentConst.headSha });
      assert.equal(report.ok, true, `expected genuinely absent constant to be new, got: ${JSON.stringify(report)}`);
      assert.ok(report.added.some((a) => a.name === 'ai.handler_coverage_floor_pct' && a.status === 'new'));
    } finally {
      fs.rmSync(absentConst.dir, { recursive: true, force: true });
    }

    // Direct compare() with base parse errors fails closed
    const synthetic = mod.compare(
      { results: [], absent: [], errors: ['tenant.acknowledged_unscoped: parse failure'] },
      { results: [{ name: 'tenant.acknowledged_unscoped', file: 'x', direction: 'shrink', value: 99 }], absent: [], errors: [] },
    );
    assert.equal(synthetic.ok, false);
    assert.ok(synthetic.errors.length > 0);
  });

  it('R1: resolveBaseRef covers all CI events, fails closed on missing PR/merge_group SHAs, and never self-compares HEAD===base', async () => {
    const mod = await import('./gate-ledger-monotonic.mjs');
    const ZERO = '0000000000000000000000000000000000000000';
    const { dir, baseSha, headSha } = initFixtureRepo({ knownDead: 10 }, { knownDead: 9 });
    try {
      // pull_request / pull_request_target / merge_group return explicit base SHA
      assert.equal(mod.resolveBaseRef({ cwd: dir, eventName: 'pull_request', prBaseSha: baseSha }), baseSha);
      assert.equal(mod.resolveBaseRef({ cwd: dir, eventName: 'pull_request_target', prBaseSha: baseSha }), baseSha);
      assert.equal(mod.resolveBaseRef({ cwd: dir, eventName: 'merge_group', mergeGroupBaseSha: baseSha }), baseSha);
      assert.equal(mod.resolveBaseRef({ cwd: dir, eventName: 'push', beforeSha: baseSha }), baseSha);

      // Missing or ZERO_SHA on PR / pull_request_target / merge_group MUST fail closed (throw)
      assert.throws(() => mod.resolveBaseRef({ cwd: dir, eventName: 'pull_request', prBaseSha: '' }));
      assert.throws(() => mod.resolveBaseRef({ cwd: dir, eventName: 'pull_request', prBaseSha: ZERO }));
      assert.throws(() => mod.resolveBaseRef({ cwd: dir, eventName: 'pull_request_target', prBaseSha: '' }));
      assert.throws(() => mod.resolveBaseRef({ cwd: dir, eventName: 'merge_group', mergeGroupBaseSha: '' }));
      assert.throws(() => mod.resolveBaseRef({ cwd: dir, eventName: 'merge_group', mergeGroupBaseSha: ZERO }));

      // Create origin/main pointing AT headSha: fallback must NOT self-compare headSha===headSha, must step to baseSha (HEAD~1)
      git(dir, ['update-ref', 'refs/remotes/origin/main', headSha]);
      const resolvedOnMain = mod.resolveBaseRef({ cwd: dir, eventName: 'push', beforeSha: ZERO, headRef: 'HEAD' });
      assert.equal(resolvedOnMain, baseSha);

      // When origin/main is behind HEAD on a feature branch, fallback resolves merge-base (baseSha)
      git(dir, ['update-ref', 'refs/remotes/origin/main', baseSha]);
      const resolvedOnBranch = mod.resolveBaseRef({ cwd: dir, eventName: 'push', beforeSha: ZERO, headRef: 'HEAD' });
      assert.equal(resolvedOnBranch, baseSha);

      // Default CLI invocation without --base using CI env vars works end-to-end
      const envRes = spawnSync(process.execPath, [CLI], {
        cwd: dir,
        encoding: 'utf8',
        env: {
          ...process.env,
          GITHUB_EVENT_NAME: 'pull_request',
          GITHUB_PR_BASE_SHA: baseSha,
        },
      });
      assert.equal(envRes.status, 0, envRes.stderr);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('R1: assertSafeGitRef rejects leading-whitespace option injection and colon/control chars; CLI runs through symlinks', async () => {
    const mod = await import('./gate-ledger-monotonic.mjs');
    for (const bad of [' --independent', ' --help', '-n', 'HEAD:file', 'HEAD\nmain', '   ']) {
      assert.throws(
        () => mod.resolveBaseRef({ cwd: ROOT, eventName: '', headRef: bad }),
        `expected ref "${bad}" to be rejected`,
      );
      assert.throws(
        () => mod.compareRefs({ cwd: ROOT, baseRef: bad, headRef: 'HEAD' }),
        `expected baseRef "${bad}" to be rejected`,
      );
    }

    // Invoking CLI via symlink must still execute (realpathSync in isMain), not exit 0 silently
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-ledger-sym-'));
    try {
      const linkCli = path.join(tmpDir, 'mono-link.mjs');
      fs.symlinkSync(CLI, linkCli);
      const res = spawnSync(process.execPath, [linkCli, '--unknown-flag'], { cwd: ROOT, encoding: 'utf8' });
      assert.notEqual(res.status, 0, 'symlinked CLI must run and reject unknown flag rather than exit 0 silently');

      const linkSizes = path.join(tmpDir, 'sizes-link.mjs');
      fs.symlinkSync(LEDGER_SIZES, linkSizes);
      const sz = spawnSync(process.execPath, [linkSizes], { cwd: ROOT, encoding: 'utf8' });
      assert.equal(sz.status, 0, sz.stderr);
      assert.ok(JSON.parse(sz.stdout).length >= 14);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
