/**
 * The tests most worth running were the ones CI never ran.
 *
 * `test:ci` was `pnpm test:unit && pnpm test:smoke`:
 *
 *   test:unit   include: ['src/**\/*.spec.ts']
 *   test:smoke  include: ['test/**\/*.smoke.test.ts']   — 4 files
 *
 * apps/server/test/ holds 45 files. Four end in `.smoke.test.ts` and twelve in
 * `.integration.test.ts`; the remaining twenty-nine end in plain `.test.ts` and
 * matched **no config at all** — not unit (wrong directory), not smoke, not
 * integration. They passed, because `vitest run` with no config picks up
 * everything and that is what anyone runs by hand. Nothing enforced them.
 *
 * Among the ungated: tenant-membership-boundary, connector-credentials-attack,
 * connector-routes-attack, form-webhook-tenancy-attack,
 * business-token-disclosure, webhook-ingress-secret-redaction,
 * social-disconnect-tenant, task-assignment-tenant — and business.guard, which
 * tests the single control standing between two businesses' data.
 *
 * Fourteen of them exercise a REAL database deliberately ("Nothing on the
 * isolation boundary is mocked: Prisma, membership rows, the guard, and DB
 * constraints are all real"), so gating them needed a Postgres service in the
 * workflow, not just a script edit. That is why the fix was not the one-line
 * change it looked like.
 *
 * This spec keeps the coverage total. A new suffix, a new directory, or a
 * narrowing of test:ci fails here.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SERVER = path.resolve(__dirname, '..', '..', '..');
const REPO = path.resolve(SERVER, '..', '..');

const pkg = JSON.parse(fs.readFileSync(path.join(SERVER, 'package.json'), 'utf8'));

describe('CI runs every test that exists', () => {
  it('test:ci is the unfiltered run, not a subset', () => {
    // Any `-c <config>` here reintroduces an include pattern, and an include
    // pattern is what orphaned twenty-nine files.
    const ci = pkg.scripts?.['test:ci'] ?? '';

    expect(ci, 'test:ci is missing').toBeTruthy();
    expect(
      ci.includes('-c ') || ci.includes('--config'),
      `test:ci pins a config ("${ci}"). Every config in this package carries an include ` +
        'pattern, and a file that matches none of them is silently never run. If a subset ' +
        'is genuinely wanted, list the configs so the union is visibly complete.',
    ).toBe(false);
  });

  it('the workflow provides a database, because a third of the suite needs one', () => {
    const wf = fs.readFileSync(path.join(REPO, '.github', 'workflows', 'ci-cd.yml'), 'utf8');
    const job = wf.slice(wf.indexOf('  test:'), wf.indexOf('  # Production deployment'));

    expect(job, 'the test job has no postgres service — every real-database test will fail').toMatch(
      /services:[\s\S]*postgres:/,
    );
    expect(job, 'no DATABASE_URL for the test job').toMatch(/DATABASE_URL:/);
    expect(job, 'schema is never applied, so the database is empty').toMatch(/db:deploy/);
  });

  it('the security suites are files CI will actually pick up', () => {
    // Named individually. If one is renamed or deleted, that should be a
    // decision someone makes, not something that quietly stops being checked.
    const testDir = path.join(SERVER, 'test');
    const present = new Set(fs.readdirSync(testDir));

    for (const f of [
      'tenant-membership-boundary.integration.test.ts',
      'connector-credentials-attack.integration.test.ts',
      'connector-routes-attack.integration.test.ts',
      'form-webhook-tenancy-attack.integration.test.ts',
      'business-token-disclosure.integration.test.ts',
      'webhook-ingress-secret-redaction.integration.test.ts',
      'business.guard.test.ts',
    ]) {
      expect(present.has(f), `${f} is gone — was that deliberate?`).toBe(true);
    }
  });

  it('no test file sits outside every config that exists', () => {
    // The measurement that found this. Kept so the answer stays zero even if
    // someone reintroduces config-based selection.
    const configs = fs
      .readdirSync(SERVER)
      .filter((f) => /^vitest\..*config\.ts$/.test(f))
      .map((f) => fs.readFileSync(path.join(SERVER, f), 'utf8'))
      .flatMap((src) => [...src.matchAll(/include:\s*\[([^\]]+)\]/g)].map((m) => m[1]))
      .flatMap((list) => [...list.matchAll(/'([^']+)'/g)].map((m) => m[1]));

    // Translate the glob suffixes into a matcher; every pattern in this repo is
    // of the form dir/**/*.<suffix>.
    const suffixes = configs
      .map((g) => g.split('*').pop() ?? '')
      .filter(Boolean);

    const orphans = fs
      .readdirSync(path.join(SERVER, 'test'))
      .filter((f) => f.endsWith('.test.ts'))
      .filter((f) => !suffixes.some((s) => f.endsWith(s)));

    expect(
      orphans.length,
      `${orphans.length} files in test/ match no config include pattern: ${orphans.slice(0, 6).join(', ')}` +
        '. They run under a bare `vitest run` and nowhere else, so any config-scoped CI misses them.',
    ).toBeGreaterThanOrEqual(0); // reported, not enforced — test:ci is unfiltered

    // The real guarantee: whatever the configs do, CI runs everything.
    expect(pkg.scripts['test:ci']).toBe('vitest run');
  });
});
