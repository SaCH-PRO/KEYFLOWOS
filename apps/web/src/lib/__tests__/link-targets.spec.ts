/**
 * Every hardcoded link goes somewhere that exists.
 *
 * The nav is already guarded from both directions — nav-destinations.spec.ts
 * asserts each nav href resolves, nav-reachability.spec.ts asserts each page has
 * a door. Neither looks at the other several hundred links in the product: the
 * "Manage contacts" button on a settings card, the back-arrow at the top of a
 * detail page. Those are the ones nobody clicks until a customer does.
 *
 * Found when this was first run, both live in the shipped product:
 *
 *   /app/contacts   "Manage contacts", on the accounting page's customer-sync
 *                   card. The route is /app/crm/contacts. Fixed here.
 *   /app/plans      the back-arrow on /app/plans/[planId]. There is no plans
 *                   index — the directory holds only [planId]. Acknowledged
 *                   below rather than fixed, because the destination does not
 *                   exist and inventing one is a product decision.
 *
 * This is the same defect that put six KEY tools on /app/finance/reports, an
 * 8-line redirect, and it is invisible to typecheck: `href` is a string, and
 * every string is a valid one.
 *
 * WHY ONLY LITERALS. nav-reachability measured this app's navigation as 39
 * static <Link href="/app/…">, 222 dynamic href={…} and 293 router.push(…) —
 * about 93% computed — and dropped a static link-graph for that reason. That
 * reasoning is about REACHABILITY, where a missed edge invents an orphan and
 * the gate turns noisy. The direction here is the safe one: a literal string
 * naming a route that does not exist is wrong no matter what the other 93% do.
 * Skipping computed targets costs coverage; it cannot cost correctness.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const WEB_SRC = path.join(__dirname, '..', '..');
const APP_DIR = path.join(WEB_SRC, 'app');
const PUBLIC_DIR = path.join(WEB_SRC, '..', 'public');

const isDir = (p: string) => fs.existsSync(p) && fs.statSync(p).isDirectory();

/**
 * Link targets that do not resolve, and are staying that way for now.
 * Shrink-only: an entry here is a promise to fix, not permission to add more.
 */
const ACKNOWLEDGED: Record<string, string> = {
  '/app/plans':
    'back-arrow on /app/plans/[planId], which nav-reachability already carries ' +
    'as todo-connect. No plans index exists; building one is a product call.',
};

/** Route -> the file that would serve it, using the app-router conventions. */
function resolvesToRoute(route: string): boolean {
  let dir = APP_DIR;
  for (const seg of route.replace(/^\//, '').split('/').filter(Boolean)) {
    const literal = path.join(dir, seg);
    if (isDir(literal)) {
      dir = literal;
      continue;
    }
    const dynamic = isDir(dir)
      ? fs.readdirSync(dir).find((d) => /^[[(]/.test(d) && isDir(path.join(dir, d)))
      : undefined;
    if (!dynamic) return false;
    dir = path.join(dir, dynamic);
  }
  return fs.existsSync(path.join(dir, 'page.tsx')) || fs.existsSync(path.join(dir, 'route.ts'));
}

/**
 * Next generates these from a file whose name is not the URL, so they resolve
 * at runtime while looking absent on disk.
 */
const GENERATED: Record<string, string> = {
  '/manifest.webmanifest': 'manifest.ts',
  '/robots.txt': 'robots.ts',
  '/sitemap.xml': 'sitemap.ts',
};

function resolvesToAsset(target: string): boolean {
  const generated = GENERATED[target];
  if (generated && fs.existsSync(path.join(APP_DIR, generated))) return true;
  return fs.existsSync(path.join(PUBLIC_DIR, target.replace(/^\//, '')));
}

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (['node_modules', '.next', 'dist'].includes(e.name)) continue;
        walk(p);
      } else if (/\.tsx?$/.test(e.name) && !/__tests__|\.spec\.|\.test\./.test(p)) {
        out.push(p);
      }
    }
  };
  walk(WEB_SRC);
  return out;
}

/** Only forms where the destination is a literal in the source. */
const PATTERNS: RegExp[] = [
  /href="(\/[^"#?]*)"/g,
  /href=\{'(\/[^'#?]*)'\}/g,
  /router\.push\('(\/[^'#?]*)'\)/g,
  /router\.replace\('(\/[^'#?]*)'\)/g,
  /\bredirect\('(\/[^'#?]*)'\)/g,
];

function literalTargets(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const file of sourceFiles()) {
    const src = fs.readFileSync(file, 'utf8');
    for (const re of PATTERNS) {
      for (const m of src.matchAll(re)) {
        const target = m[1];
        if (!found.has(target)) found.set(target, []);
        const where = path.relative(WEB_SRC, file).split(path.sep).join('/');
        if (!found.get(target)!.includes(where)) found.get(target)!.push(where);
      }
    }
  }
  return found;
}

describe('hardcoded links point at routes that exist', () => {
  const targets = literalTargets();

  it('finds links to check — this gate is not vacuous', () => {
    // Without this, deleting a pattern above makes every assertion below pass
    // by having nothing to say. That failure mode has happened five times in
    // this repository; see gate-vacuity.spec.ts on the server.
    expect(targets.size, 'no literal link targets found — the extractor is broken').toBeGreaterThan(
      25,
    );
    expect([...targets.keys()], 'the nav links are missing — expected extraction to see them').toContain(
      '/app/settings',
    );
  });

  it('the resolver recognises a route that exists and rejects one that does not', () => {
    // A resolver that returns true for everything would pass the real assertion
    // silently, which is how a green gate comes to be measuring nothing.
    expect(resolvesToRoute('/app/settings'), 'a known-good route was rejected').toBe(true);
    expect(resolvesToRoute('/app/definitely-not-a-real-route-xyz'), 'a bogus route resolved').toBe(
      false,
    );
  });

  it('every literal target resolves to a route, an asset, or is acknowledged', () => {
    const broken = [...targets.entries()]
      .filter(([t]) => !(t in ACKNOWLEDGED))
      .filter(([t]) => !resolvesToRoute(t) && !resolvesToAsset(t))
      .map(([t, files]) => `${t}  <- ${files.slice(0, 3).join(', ')}`);

    expect(
      broken,
      'these hardcoded links go nowhere. Either the route moved and the link ' +
        'was not updated, or the destination was never built. Fix the href, or ' +
        'add it to ACKNOWLEDGED with the reason it cannot be fixed yet.',
    ).toEqual([]);
  });

  it('the acknowledged list only contains links that are still broken', () => {
    // Keeps the ledger shrink-only and self-cleaning: once a destination is
    // built, its excuse has to go, or the list slowly stops meaning anything.
    for (const [target, reason] of Object.entries(ACKNOWLEDGED)) {
      const stillUsed = targets.has(target);
      const stillBroken = !resolvesToRoute(target) && !resolvesToAsset(target);
      expect(
        stillUsed && stillBroken,
        `${target} is acknowledged ("${reason}") but is now ` +
          `${!stillUsed ? 'no longer linked anywhere' : 'a real destination'} — remove the entry.`,
      ).toBe(true);
    }
  });
});
