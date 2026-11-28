/**
 * Gate-ledger census (RR-GATE-LEDGER-CENSUS, owner rulings D-261, D-262, D-22).
 *
 * Every file under apps/, packages/, scripts/, or .github/ that declares a
 * shrink-only ledger or ratchet (matching PHRASE_RE) must either be registered
 * in scripts/os/ledger-sizes.mjs (so `node scripts/os/ledger-sizes.mjs` parses
 * and reports its numeric cardinality) or appear in EXEMPT below with a
 * one-line factual reason.
 *
 * No external dependencies: runs before `pnpm install` in ci-cd.yml's
 * `lint-and-typecheck` job.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const LEDGER_SCRIPT = path.join('scripts', 'os', 'ledger-sizes.mjs');
const SELF = 'scripts/ci/gate-ledger-census.spec.mjs';

export const PHRASE_PATTERN = 'shrink-only|may only shrink|only shrink|can only go down|may only fall';
export const SCAN_ROOTS = Object.freeze(['apps/', 'packages/', 'scripts/', '.github/']);

/**
 * Files matching PHRASE_PATTERN that do NOT declare a new unregistered ledger
 * constant/ratchet of their own (e.g. a test enforcing a ledger defined in
 * another already-registered file, the registry/census itself, or a manifest
 * quoting a test title). Every entry must match PHRASE_PATTERN today and must
 * NOT be registered in ledger-sizes.mjs (stale or needless entries fail CI).
 */
export const EXEMPT = Object.freeze({
  'apps/server/src/core/config/doc-debt-ledger.spec.ts':
    'Gate spec enforcing architecture/os/state/DOC_DEBT.md (already measured by docs.debt in ledger-sizes.mjs).',
  'apps/server/src/core/config/route-parity-ledger.spec.ts':
    'Gate spec enforcing architecture/os/state/ROUTE_PARITY.md (already measured by routes.parity_absent in ledger-sizes.mjs).',
  'apps/server/src/modules/ai/flow-orchestrator.service.ts':
    'Runtime comment referencing PRO_AUTO_MONITOR_EXEMPT_READ_TOOLS (measured from flow-tool-registry.ts).',
  'apps/server/src/modules/ai/strict-tool-caller-census.spec.ts':
    'Gate spec enforcing PRO_AUTO_MONITOR_EXEMPT_READ_TOOLS (measured from flow-tool-registry.ts).',
  'apps/server/src/modules/ai/strict-tool-schemas.spec.ts':
    'Gate spec enforcing NON_STRICT_OPENAI_TOOLS (measured from flow-tool-registry.ts).',
  'apps/server/test/ai-credit-billing.integration.test.ts':
    'Integration test enforcing UNPRICED_ACKNOWLEDGED (already measured by billing.unpriced from plans.ts).',
  'scripts/ci/gate-ledger-census.spec.mjs':
    'This census spec itself (embeds the phrase pattern in its detector and negative controls).',
  'scripts/os/ledger-sizes.mjs':
    'The ledger registry itself (declares LEDGERS, not a debt ledger).',
  'scripts/proof-admission/manifests/shadowed-routes-live.json':
    'Release 0 proof-admission manifest quoting test title from route-shadowing.spec.ts (measured by routes.shadowing_allow_listed).',
  'scripts/proof-admission/manifests/worktree-isolation.json':
    'Release 0 proof-admission manifest quoting test title from fixture-prefix-registry.spec.ts (measured by fixtures.legacy_prefixes).',
});

const EXISTING_LEDGER_NAMES = [
  'tenant.acknowledged_unscoped',
  'tenant.never_scope',
  'tenant.business_id_models',
  'events.known_dead',
  'providers.unreachable',
  'billing.unpriced',
  'billing.unenforced_limits',
  'auth.public_handlers',
  'auth.public_controllers',
  'web.known_fabricated',
  'trpc.unchecked',
  'ai.handler_coverage_floor_pct',
  'docs.debt',
  'routes.parity_absent',
];

/** Tracked files under SCAN_ROOTS matching PHRASE_PATTERN (case-insensitive), sorted repo-relative POSIX paths. */
export function matchingFiles(root = ROOT) {
  const res = spawnSync(
    'git',
    ['grep', '-liE', PHRASE_PATTERN, '--', ...SCAN_ROOTS],
    { cwd: root, encoding: 'utf8' },
  );
  // git grep exits 1 when zero files match; >=2 is a real error.
  if (res.status !== 0 && res.status !== 1) {
    throw new Error(`git grep failed (${res.status}): ${res.stderr}`);
  }
  if (res.status === 1) return [];
  return res.stdout
    .split(/\r?\n/)
    .map((f) => f.trim().replace(/\\/g, '/'))
    .filter(Boolean)
    .sort();
}

/** Run scripts/os/ledger-sizes.mjs and return its parsed JSON rows. */
export function readLedgerRows(root = ROOT) {
  const res = spawnSync(process.execPath, [path.join(root, LEDGER_SCRIPT)], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(
    res.status,
    0,
    `node ${LEDGER_SCRIPT} exited ${res.status}:\n${res.stderr}\n${res.stdout}`,
  );
  const rows = JSON.parse(res.stdout);
  assert.ok(Array.isArray(rows) && rows.length > 0, 'ledger-sizes.mjs must emit a non-empty JSON array');
  return rows;
}

/**
 * Pure census check: returns empty array when every matched file is registered
 * or honestly exempt, and every EXEMPT entry is still needed and explained.
 */
export function census(matchedFiles, registeredFiles, exempt = EXEMPT) {
  const matchedSet = new Set(matchedFiles);
  const regSet = new Set(registeredFiles);
  const problems = [];

  for (const file of matchedFiles) {
    if (regSet.has(file)) continue;
    if (Object.prototype.hasOwnProperty.call(exempt, file)) continue;
    problems.push(
      `${file}: declares a shrink-only ledger/ratchet phrase but is neither registered in ${LEDGER_SCRIPT} nor listed in EXEMPT`,
    );
  }

  for (const [file, reason] of Object.entries(exempt)) {
    if (typeof reason !== 'string' || !reason.trim()) {
      problems.push(`EXEMPT ${file}: missing one-line reason`);
    }
    if (!matchedSet.has(file)) {
      problems.push(`EXEMPT ${file}: no longer matches phrase list (stale entry; remove it)`);
    } else if (regSet.has(file)) {
      problems.push(`EXEMPT ${file}: already registered in ${LEDGER_SCRIPT} (needless entry; remove it)`);
    }
  }

  return problems;
}

describe('RR-GATE-LEDGER-CENSUS: every shrink-only ledger/ratchet is measured by ledger-sizes.mjs or exempt with a reason', () => {
  const matched = matchingFiles();
  const rows = readLedgerRows();
  const registeredFiles = [...new Set(rows.map((r) => r.file))];

  it('ledger-sizes.mjs exits 0 with all 14 original ledgers plus KNOWN_BROKEN and server/web lint ceilings', () => {
    const byName = new Map(rows.map((r) => [r.name, r]));

    // Zero duplicate ledger names
    assert.equal(byName.size, rows.length, 'ledger-sizes.mjs must not emit duplicate ledger names');

    for (const name of EXISTING_LEDGER_NAMES) {
      assert.ok(byName.has(name), `existing ledger missing: ${name}`);
      assert.equal(typeof byName.get(name).value, 'number');
    }

    const knownBroken = byName.get('cast.known_broken');
    assert.ok(knownBroken, 'cast.known_broken must be registered in ledger-sizes.mjs');
    assert.equal(knownBroken.file, 'apps/server/src/core/config/cast-call-integrity.spec.ts');
    assert.equal(knownBroken.direction, 'shrink');
    assert.ok(Number.isInteger(knownBroken.value) && knownBroken.value >= 0);

    const serverLint = byName.get('lint.server_max_warnings');
    assert.ok(serverLint, 'lint.server_max_warnings must be registered in ledger-sizes.mjs');
    assert.equal(serverLint.file, '.github/workflows/ci-cd.yml');
    assert.equal(serverLint.direction, 'shrink');
    assert.ok(Number.isInteger(serverLint.value) && serverLint.value > 0);

    const webLint = byName.get('lint.web_max_warnings');
    assert.ok(webLint, 'lint.web_max_warnings must be registered in ledger-sizes.mjs');
    assert.equal(webLint.file, '.github/workflows/ci-cd.yml');
    assert.equal(webLint.direction, 'shrink');
    assert.ok(Number.isInteger(webLint.value) && webLint.value > 0);
  });

  it('every file matching the shrink-only phrase list is registered in ledger-sizes.mjs or honestly EXEMPT', () => {
    assert.ok(matched.length >= 20, `expected >= 20 matching files, found ${matched.length}`);
    const problems = census(matched, registeredFiles);
    assert.deepEqual(problems, [], `\n${problems.join('\n')}\n`);
  });

  it('every registered ledger file exists on disk', () => {
    for (const file of registeredFiles) {
      assert.ok(fs.existsSync(path.join(ROOT, file)), `registered ledger file missing: ${file}`);
    }
  });

  it('this census spec itself is run in ci-cd.yml before pnpm install', () => {
    const ci = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci-cd.yml'), 'utf8');
    const selfPos = ci.indexOf(SELF);
    const installPos = ci.indexOf('pnpm install --frozen-lockfile');
    assert.ok(selfPos > -1, `${SELF} must be named in .github/workflows/ci-cd.yml`);
    assert.ok(installPos > -1, 'ci-cd.yml must run pnpm install');
    assert.ok(selfPos < installPos, `${SELF} must run before pnpm install`);
  });
});

describe('RR-GATE-LEDGER-CENSUS: negative controls', () => {
  it('a fixture file with "may only SHRINK" and no registration fails matchingFiles + census', () => {
    const tmp = fs.mkdtempSync(path.join(tmpdir(), 'kf-ledger-census-'));
    try {
      const fixtureRel = 'apps/server/src/example/unregistered-ledger.spec.ts';
      const target = path.join(tmp, fixtureRel);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, '// This list may only SHRINK.\nconst DEBT = ["a"];\n', 'utf8');
      const git = (args) => {
        const r = spawnSync('git', args, { cwd: tmp, encoding: 'utf8' });
        assert.equal(r.status, 0, `git ${args.join(' ')} failed: ${r.stderr}`);
      };
      git(['init', '-q']);
      git(['add', fixtureRel]);

      const found = matchingFiles(tmp);
      assert.deepEqual(found, [fixtureRel]);

      const problems = census(found, ['apps/server/src/other.spec.ts'], {});
      assert.equal(problems.length, 1);
      assert.ok(problems[0].includes(fixtureRel), problems[0]);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('a stale EXEMPT entry for a file that no longer matches fails', () => {
    const problems = census(
      ['apps/server/src/a.spec.ts'],
      ['apps/server/src/a.spec.ts'],
      { 'apps/server/src/gone.spec.ts': 'historical reason' },
    );
    assert.equal(problems.length, 1);
    assert.match(problems[0], /stale entry/);
  });

  it('a needless EXEMPT entry for a file already registered in ledger-sizes.mjs fails', () => {
    const problems = census(
      ['apps/server/src/a.spec.ts'],
      ['apps/server/src/a.spec.ts'],
      { 'apps/server/src/a.spec.ts': 'still registered' },
    );
    assert.equal(problems.length, 1);
    assert.match(problems[0], /needless entry/);
  });

  it('an EXEMPT entry with an empty reason fails', () => {
    const problems = census(
      ['apps/server/src/a.spec.ts'],
      [],
      { 'apps/server/src/a.spec.ts': '   ' },
    );
    assert.equal(problems.length, 1);
    assert.match(problems[0], /missing one-line reason/);
  });
});
