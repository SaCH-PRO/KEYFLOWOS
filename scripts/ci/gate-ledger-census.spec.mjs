/**
 * Gate-ledger census (RR-GATE-LEDGER-CENSUS, owner rulings D-261, D-262, D-22).
 *
 * Every file under apps/, packages/, scripts/, or .github/ that declares a
 * shrink-only ledger or ratchet (matching PHRASE_PATTERN) must either be
 * registered in scripts/os/ledger-sizes.mjs (so `node scripts/os/ledger-sizes.mjs`
 * parses and reports its numeric cardinality) or appear in EXEMPT below with a
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
import * as osLib from '../os/lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const LEDGER_SCRIPT = path.join('scripts', 'os', 'ledger-sizes.mjs');
const SELF = 'scripts/ci/gate-ledger-census.spec.mjs';
const CENSUS_JOB = 'lint-and-typecheck';

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

  it('ledger-sizes.mjs exits 0 with all 14 original ledgers plus KNOWN_BROKEN, lint ceilings, trpc.broken_ctx_business, and site counts', () => {
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

    const trpcBroken = byName.get('trpc.broken_ctx_business');
    assert.ok(trpcBroken, 'trpc.broken_ctx_business must be registered in ledger-sizes.mjs');
    assert.equal(trpcBroken.file, 'apps/server/src/trpc.module.spec.ts');
    assert.equal(trpcBroken.direction, 'shrink');
    assert.ok(Number.isInteger(trpcBroken.value) && trpcBroken.value >= 0);

    const balanceSites = byName.get('commerce.balance_known_outside_sites');
    assert.ok(balanceSites, 'commerce.balance_known_outside_sites must be registered in ledger-sizes.mjs');
    assert.equal(balanceSites.direction, 'shrink');
    assert.ok(Number.isInteger(balanceSites.value) && balanceSites.value >= 0);

    const unencodedSites = byName.get('web.unencoded_invoice_detail_outside_sites');
    assert.ok(unencodedSites, 'web.unencoded_invoice_detail_outside_sites must be registered in ledger-sizes.mjs');
    assert.equal(unencodedSites.direction, 'shrink');
    assert.ok(Number.isInteger(unencodedSites.value) && unencodedSites.value >= 0);
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

  it(`this census spec itself runs in ci-cd.yml's ${CENSUS_JOB} job via an active run step before pnpm install`, () => {
    const ci = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci-cd.yml'), 'utf8');
    const lines = ci.split(/\r?\n/).map((l) => (/^\s*#/.test(l) ? '' : l));
    const jobsIdx = lines.findIndex((l) => /^jobs:\s*$/.test(l));
    assert.ok(jobsIdx >= 0, 'ci-cd.yml has jobs:');
    const start = lines.findIndex((l, k) => k > jobsIdx && new RegExp(`^ {2}${CENSUS_JOB}:\\s*$`).test(l));
    assert.ok(start >= 0, `ci-cd.yml has a ${CENSUS_JOB} job`);
    let end = start + 1;
    while (end < lines.length && !/^ {2}[A-Za-z_][\w-]*:\s*$/.test(lines[end]) && !/^\S/.test(lines[end])) end += 1;
    const jobSrc = lines.slice(start, end).join('\n');
    assert.equal(typeof osLib.extractWorkflowRunCommands, 'function', 'extractWorkflowRunCommands must be exported from scripts/os/lib.mjs');
    const runs = osLib.extractWorkflowRunCommands(jobSrc);
    const selfRun = runs.find((r) => {
      const uncommented = r.text.split(/\r?\n/).map((l) => l.replace(/(^|[\s;&|()])#.*$/, '$1')).join('\n');
      return /(?:^|[\n;&|])\s*node\s+--test\b[^\n;&|]*\bscripts\/ci\/gate-ledger-census\.spec\.mjs\b/.test(uncommented);
    });
    assert.ok(selfRun, `an active node --test run line in ${CENSUS_JOB} must name ${SELF}`);
    const installRun = runs.find((r) => /\bpnpm\s+install\b/.test(r.text));
    assert.ok(installRun, `${CENSUS_JOB} installs dependencies`);
    assert.ok(selfRun.line < installRun.line, `census step (line ${selfRun.line}) must run before pnpm install (line ${installRun.line})`);
  });
});

describe('RR-GATE-LEDGER-CENSUS: negative controls & parser hardening', () => {
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

  it('parseWorkflowMaxWarnings parses active inline/block pnpm lint runs and rejects comments, echo, spoofs, 0, and >1 matches', () => {
    assert.equal(typeof osLib.parseWorkflowMaxWarnings, 'function', 'parseWorkflowMaxWarnings must be exported from scripts/os/lib.mjs');

    const inlineWf = 'jobs:\n  lint:\n    steps:\n      - run: pnpm --filter server lint --max-warnings 3343\n';
    assert.equal(osLib.parseWorkflowMaxWarnings(inlineWf, 'server'), 3343);

    const blockWf = [
      'jobs:',
      '  lint:',
      '    steps:',
      '      - run: |',
      '          CI=1 pnpm --filter=web lint --max-warnings=26',
    ].join('\n');
    assert.equal(osLib.parseWorkflowMaxWarnings(blockWf, 'web'), 26);

    // Inline shell comment with ceiling must NOT be matched
    const inlineCommentWf = 'jobs:\n  lint:\n    steps:\n      - run: true # pnpm --filter server lint --max-warnings 0\n';
    assert.throws(() => osLib.parseWorkflowMaxWarnings(inlineCommentWf, 'server'));

    // echo command mentioning pnpm must NOT be matched
    const echoWf = 'jobs:\n  lint:\n    steps:\n      - run: echo "pnpm --filter server lint --max-warnings 0"\n';
    assert.throws(() => osLib.parseWorkflowMaxWarnings(echoWf, 'server'));

    // Trailing comment ceiling spoof must read the REAL command ceiling (9999), never the commented 3343
    const spoofWf = 'jobs:\n  lint:\n    steps:\n      - run: pnpm --filter server lint --max-warnings 9999 # old: pnpm --filter server lint --max-warnings 3343\n';
    assert.equal(osLib.parseWorkflowMaxWarnings(spoofWf, 'server'), 9999);

    // YAML full-line comment must NOT be matched
    const yamlCommentWf = 'jobs:\n  lint:\n    steps:\n      # - run: pnpm --filter server lint --max-warnings 0\n';
    assert.throws(() => osLib.parseWorkflowMaxWarnings(yamlCommentWf, 'server'));

    // Duplicate runs must fail closed
    const dupWf = [
      'jobs:',
      '  lint:',
      '    steps:',
      '      - run: pnpm --filter server lint --max-warnings 10',
      '      - run: pnpm --filter server lint --max-warnings 20',
    ].join('\n');
    assert.throws(() => osLib.parseWorkflowMaxWarnings(dupWf, 'server'));
  });

  it('extractInitializer handles => and string literals in TS types, and fails closed on empty scalars', () => {
    const withArrow = 'const A: { fn: (x: number) => string; count: number } = { a: 1, b: 2 };';
    assert.equal(osLib.objectKeyCount(osLib.extractInitializer(withArrow, 'A')), 2);

    const withTypeStr = "const B: Record<string, 'a;b=c<d'> = { x: 'a;b=c<d' };";
    assert.equal(osLib.objectKeyCount(osLib.extractInitializer(withTypeStr, 'B')), 1);

    // Empty scalar initializer must throw, never silently parse as 0
    assert.throws(() => osLib.extractInitializer('const ALLOWLIST_CEILING = ;', 'ALLOWLIST_CEILING'));
    assert.throws(() => osLib.extractInitializer('const ALLOWLIST_CEILING =   ;', 'ALLOWLIST_CEILING'));
  });

  it('arrayElementCount and objectKeyCount handle nested/empty/trailing-comma forms and fail closed on malformed inputs', () => {
    assert.equal(osLib.arrayElementCount('[]'), 0);
    assert.equal(osLib.arrayElementCount('[{ a: 1, b: [1, 2] }, `x,y`, ]'), 2);
    assert.equal(osLib.objectKeyCount('{}'), 0);
    assert.equal(osLib.objectKeyCount('{ AiPlanResult: { count: 2, why: "a, b" }, "quoted": 1, }'), 2);

    // Malformed / unbalanced / multi-literal / unterminated strings MUST throw
    assert.throws(() => osLib.arrayElementCount('[{ a: 1 ]'));
    assert.throws(() => osLib.arrayElementCount('[a], [b]'));
    assert.throws(() => osLib.arrayElementCount('["unterminated]'));
    assert.throws(() => osLib.objectKeyCount('{ a: { b: 1 }'));
    assert.throws(() => osLib.objectKeyCount('{ a: 1 }, { b: 2 }'));
    assert.throws(() => osLib.objectKeyCount('{ a: "unterminated}'));
  });

  it('stripComments handles regex literals containing quotes/backticks without desyncing subsequent comments', () => {
    const src = [
      'const re = /source:\\s*["\'`]([^"\'`]+)["\'`]/g;',
      'const ITEMS = [',
      "  // don't count this apostrophe's comment",
      "  'one',",
      "  'two',",
      '];',
    ].join('\n');
    const init = osLib.extractInitializer(src, 'ITEMS');
    assert.deepEqual(osLib.stringLiterals(init), ['one', 'two']);
  });
});
