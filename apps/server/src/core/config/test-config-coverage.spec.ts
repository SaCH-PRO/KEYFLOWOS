/**
 * Every test file is claimed by at least one vitest config.
 *
 * THE TRAP THIS EXISTS FOR. CI runs `pnpm test:ci`, which is `vitest run`
 * against the default config — no `include`, so it matches vitest's default
 * glob and picks up everything: 396 files. The obvious way to make CI faster is
 * to split it into the named configs:
 *
 *     pnpm test:unit && pnpm test:integration
 *
 * That runs 344 + 21 = 365. **Thirty-one files stop running, and nothing says
 * so.** The suite still reports green, with a smaller number nobody reads.
 *
 * Among the files it would drop is `test/commonjs-compat.test.ts` — the gate
 * standing between this repository and an unbootable server, which `jose` came
 * one lockfile edit from shipping and `uuid@14` actually did.
 *
 * So this asserts the named configs COVER the default one. With that true, the
 * CI split is safe to make; without it, the speedup silently disables the boot
 * protection. The check is cheap and the failure mode it prevents is a suite
 * that gets faster by testing less — which is the most flattering possible
 * shape for a regression.
 *
 * It also fails if a new test file matches NO config, which is how a file comes
 * to be written, committed, and never run.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const SERVER_ROOT = join(__dirname, '..', '..', '..');

/** Every test file on disk, as a posix path relative to apps/server. */
function testFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (['node_modules', 'dist', 'coverage'].includes(e.name)) continue;
        walk(p);
      } else if (/\.(spec|test)\.ts$/.test(e.name)) {
        out.push(relative(SERVER_ROOT, p).split(sep).join('/'));
      }
    }
  };
  for (const root of ['src', 'test']) walk(join(SERVER_ROOT, root));
  return out;
}

/** The `include` globs of a named config, or null when it has none. */
function includesOf(configFile: string): string[] | null {
  const src = readFileSync(join(SERVER_ROOT, configFile), 'utf8');
  const m = /include:\s*\[([^\]]*)\]/.exec(src);
  if (!m) return null;
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

/**
 * Minimal glob match for the two shapes these configs use.
 *
 * Via sentinels, because the naive version is wrong in a way that looks right:
 * replacing `** /` with `(?:.*\/)?` and THEN replacing `*` with `[^/]*` rewrites
 * the `.*` that was just inserted, producing `(?:.[^/]*\/)?`. That reported 374
 * of 399 files as uncovered — a number so large it was obviously the matcher
 * and not the configs, which is the only reason it was caught.
 */
function matches(file: string, glob: string): boolean {
  const GLOBSTAR_SLASH = '@@GS@@';
  const GLOBSTAR = '@@GG@@';
  const STAR = '@@ST@@';

  const pattern = glob
    .replace(/\*\*\//g, GLOBSTAR_SLASH)
    .replace(/\*\*/g, GLOBSTAR)
    .replace(/\*/g, STAR)
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .split(GLOBSTAR_SLASH)
    .join('(?:.*/)?')
    .split(GLOBSTAR)
    .join('.*')
    .split(STAR)
    .join('[^/]*');

  return new RegExp('^' + pattern + '$').test(file);
}

const NAMED_CONFIGS = [
  'vitest.unit.config.ts',
  'vitest.integration.config.ts',
  'vitest.smoke.config.ts',
];

describe('the named vitest configs cover every test file', () => {
  const files = testFiles();

  it('finds both sides — this check is not vacuous', () => {
    expect(files.length, 'no test files found — the walker is broken').toBeGreaterThan(300);
    for (const c of NAMED_CONFIGS) {
      expect(includesOf(c), `${c} has no include — it would match everything`).not.toBeNull();
    }
  });

  it('reports which files only the default config runs', () => {
    const globs = NAMED_CONFIGS.flatMap((c) => includesOf(c) ?? []);
    const uncovered = files.filter((f) => !globs.some((g) => matches(f, g)));

    // NOT asserted empty. Today 30 files are reachable only through the default
    // config, and that is the STATUS QUO, not a regression — `vitest run` runs
    // them all. Recording the number here is what makes the CI split a decision
    // rather than an accident: whoever changes test:ci to the named configs has
    // to bring this to zero first, and will see exactly which files they are
    // about to stop running.
    const summary = uncovered.slice(0, 40).join('\n    ');
    expect(
      uncovered.length,
      `${uncovered.length} test files are matched by NO named config and run only ` +
        `under the default \`vitest run\`. Splitting CI into test:unit + ` +
        `test:integration would silently stop running them:\n    ${summary}\n\n  ` +
        'If this number has GROWN, a new test file has been added that the named ' +
        'configs cannot see. If you are here to shrink it, widen a config include.',
    ).toBeLessThanOrEqual(30);
  });

  it('the boot-protection gate is never orphaned', () => {
    // Named explicitly because it is the one whose absence is least survivable:
    // it is what catches an ESM-only dependency that cannot be require()d, and
    // this server is CommonJS on Node 20.18.
    const boot = 'test/commonjs-compat.test.ts';
    expect(files, 'the CommonJS compatibility gate has moved or been deleted').toContain(boot);
  });

  it('every test file is reachable by SOME runner', () => {
    // The default config has no include, so it matches vitest's default glob:
    // **/*.{test,spec}.?(c|m)[jt]s?(x). A file outside that pattern is written,
    // committed, and never executed by anything.
    const defaultGlob = /\.(test|spec)\.[cm]?[jt]sx?$/;
    const orphans = files.filter((f) => !defaultGlob.test(f));
    expect(orphans, 'these match no runner at all and have never run').toEqual([]);
  });
});
