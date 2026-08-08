/**
 * A screen that invents numbers is indistinguishable from working software.
 *
 * Three nav-linked screens fetched nothing, waited on a setTimeout to fake
 * network latency, and then rendered hardcoded business metrics:
 *
 *   /app/growth                  "87.3%", "12.4%", scores 82/76/64/71
 *   /app/storefront-intelligence "7.4%" conversion, "$29.60" AOV, "284" orders
 *   /app/document-intelligence   "47" processed, "94%" accuracy, "18 min" saved
 *
 * All three were in the main nav. An owner could read "conversion rate 7.4%"
 * and price against it. The fake loading state is what makes it dangerous
 * rather than merely unfinished — a spinner followed by numbers is the exact
 * signature of software that works.
 *
 * This is the same defect as a tool reporting success for work it never did:
 * `markCampaignSent` emitting recipientCount 0, `social.publishPost` marking
 * POSTED with no connected account, `commerce_send_invoice` logging "sent to
 * Ada" having emailed nobody. The product rule is that KEY never claims what it
 * has not done; a screen is held to the same standard.
 *
 * Placeholder work is fine. Placeholder work wearing the costume of real data,
 * reachable from the nav, is not.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const WEB_SRC = path.join(__dirname, '..', '..');
const APP_DIR = path.join(WEB_SRC, 'app');

/** Screens allowed to render without a data source, with the reason. */
const STATIC_BY_DESIGN: Record<string, string> = {
  '/app/finance': 'redirect shim',
  '/app/notifications': 'redirect shim',
  '/app/settings': 'redirect shim',
  '/app/settings/profile': 'redirect shim',
  '/app/workflows': 'redirect shim',
};

const isDir = (p: string) => fs.existsSync(p) && fs.statSync(p).isDirectory();

function navDestinations(): string[] {
  const src = fs.readFileSync(path.join(WEB_SRC, 'lib', 'nav-config.ts'), 'utf8');
  return [...new Set([...src.matchAll(/href: "(\/app\/[a-z0-9/-]+)"/g)].map((m) => m[1]))];
}

function pageFor(route: string): string | null {
  let dir = APP_DIR;
  for (const segment of route.replace(/^\//, '').split('/').filter(Boolean)) {
    const literal = path.join(dir, segment);
    if (isDir(literal)) {
      dir = literal;
      continue;
    }
    const dynamic = isDir(dir)
      ? fs.readdirSync(dir).find((d) => /^[[(]/.test(d) && isDir(path.join(dir, d)))
      : undefined;
    if (!dynamic) return null;
    dir = path.join(dir, dynamic);
  }
  return ['page.tsx', 'page.ts'].map((f) => path.join(dir, f)).find((f) => fs.existsSync(f)) ?? null;
}

function resolveImport(spec: string, from: string): string[] {
  let base: string;
  if (spec.startsWith('@/')) base = path.join(WEB_SRC, spec.slice(2));
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(from), spec);
  else return [];

  const direct = [base + '.tsx', base + '.ts', path.join(base, 'index.tsx'), path.join(base, 'index.ts')]
    .filter((f) => fs.existsSync(f));
  if (direct.length) return direct;

  return isDir(base) ? fs.readdirSync(base).filter((f) => /\.tsx?$/.test(f)).map((f) => path.join(base, f)) : [];
}

/** Does this screen, or anything it renders, actually talk to the API? */
function hasDataSource(file: string, depth = 3, seen = new Set<string>()): boolean {
  if (depth < 0 || seen.has(file)) return false;
  seen.add(file);

  const body = fs.readFileSync(file, 'utf8');
  if (/from ["']@\/lib\/(api|client)/.test(body)) return true;

  for (const match of body.matchAll(/from\s+["']([^"']+)["']/g)) {
    for (const resolved of resolveImport(match[1], file)) {
      // The api layer is the destination, not a waypoint — see check-tool-routes.
      if (path.relative(WEB_SRC, resolved).split(path.sep).join('/').startsWith('lib/')) continue;
      if (hasDataSource(resolved, depth - 1, seen)) return true;
    }
  }
  return false;
}

/** A spinner that resolves on a timer, with nothing behind it. */
const FAKES_A_LOAD = /setTimeout\([\s\S]{0,80}?setLoading\(false\)/;

/**
 * Every route under /app that renders a page — not just the ones in the nav.
 *
 * The nav is a subset, and checking only the subset means a screen is audited
 * at the moment it becomes visible rather than at the moment it is written.
 */
/**
 * Screens that simulate a network request and render invented numbers.
 *
 * Found on 2026-08-08 while auditing 39 unreachable screens for nav entries —
 * one step before the exact mistake the gate above now prevents. All three
 * were outside the nav, which is the only reason nobody had been misled: the
 * detector could already recognise them, it was just never pointed at
 * anything but nav destinations.
 *
 *   /app/growth                    900ms fake timer. "+24.5% Revenue Growth",
 *                                  "$2,840 Lifetime Value", "18 referrals this
 *                                  month". 325 lines, no data import at all.
 *   /app/document-intelligence     700ms fake timer, "94%". KeyCortexDocument
 *                                  Service exists — AND TWO KEY TOOLS NAME
 *                                  THIS AS THEIR MANUAL EQUIVALENT, so KEY
 *                                  currently offers document work whose manual
 *                                  path is a mockup.
 *   /app/storefront-intelligence   800ms fake timer, "3,847", "$8,420",
 *                                  "$29.60". storefront-conversion.service.ts
 *                                  exists.
 *
 * Listed, not fixed, because each is a decision — wire it to the service that
 * already exists, or delete it — and three of those is a separate piece of
 * work from stopping a fourth. The list may only shrink.
 */
const KNOWN_FABRICATED = [
  '/app/document-intelligence',
  '/app/growth',
  '/app/storefront-intelligence',
];

/** Every route whose page fakes a load and has no data behind it. */
function fabricatedRoutes(): string[] {
  return allRoutes().filter((route) => {
    if (STATIC_BY_DESIGN[route]) return false;
    const page = pageFor(route);
    if (!page) return false;
    return FAKES_A_LOAD.test(fs.readFileSync(page, 'utf8')) && !hasDataSource(page);
  });
}

function allRoutes(): string[] {
  const found: string[] = [];
  const walk = (dir: string, route: string) => {
    if (fs.existsSync(path.join(dir, 'page.tsx'))) found.push(route);
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('_') || entry.name === '__tests__') continue;
      walk(path.join(dir, entry.name), `${route}/${entry.name}`);
    }
  };
  walk(path.join(APP_DIR, 'app'), '/app');
  return found.sort();
}

describe('no nav-linked screen fabricates data', () => {
  const destinations = navDestinations();

  it('finds the nav', () => {
    expect(destinations.length).toBeGreaterThan(20);
  });

  it('no screen fakes a loading state it has no data for', () => {
    // The load-bearing assertion. Static content is honest; a simulated network
    // request is a costume.
    const fabricated = destinations.filter((route) => {
      if (STATIC_BY_DESIGN[route]) return false;
      const page = pageFor(route);
      if (!page) return false;
      return FAKES_A_LOAD.test(fs.readFileSync(page, 'utf8')) && !hasDataSource(page);
    });

    expect(
      fabricated,
      `these screens simulate a network request and render invented numbers: ${fabricated.join(', ')}`,
    ).toEqual([]);
  });

  it('every nav destination either fetches data or is listed as static by design', () => {
    const undocumented = destinations.filter((route) => {
      if (STATIC_BY_DESIGN[route]) return false;
      const page = pageFor(route);
      if (!page) return false;
      return !hasDataSource(page);
    });

    expect(
      undocumented,
      `no data source and no entry in STATIC_BY_DESIGN: ${undocumented.join(', ')}`,
    ).toEqual([]);
  });

  it('no screen ANYWHERE fakes a loading state, linked or not', () => {
    // The gate above only ever looked at nav destinations, which means a
    // fabricated screen was caught the moment somebody LINKED it. That is
    // backwards: you find out you built a fake dashboard by shipping it.
    //
    // It is not hypothetical. Three of these were sitting outside the nav with
    // the detector above already able to recognise them:
    //
    //   /app/growth                    900ms fake timer, "+24.5%", "$2,840"
    //   /app/document-intelligence     700ms fake timer, "94%"
    //   /app/storefront-intelligence   800ms fake timer, "3,847", "$8,420"
    //
    // All three were found while auditing 39 unreachable screens for nav
    // entries — i.e. one step before the exact mistake this now prevents.
    // An unreachable fake is harmless; a linked one is a business decision
    // made on invented numbers.
    const unexpected = fabricatedRoutes().filter((r) => !KNOWN_FABRICATED.includes(r));

    expect(
      unexpected,
      'these simulate a network request and render invented numbers. Wire them ' +
        'to real data or delete them: ' + unexpected.join(', '),
    ).toEqual([]);
  });

  it('a fabricated screen is never given a nav entry', () => {
    // The assertion that actually protects anyone. An unreachable fake is
    // inert; a linked one puts invented numbers in front of somebody deciding
    // what to do with their business. This was one step from happening — all
    // three were found mid-audit of 39 unreachable screens for nav entries.
    const linked = fabricatedRoutes().filter((r) => navDestinations().includes(r));

    expect(
      linked,
      `${linked.join(', ')} renders invented numbers and is now in the nav. ` +
        'A user cannot tell it from a real dashboard.',
    ).toEqual([]);
  });

  it('the fabricated list does not outlive the fabrication', () => {
    // If one gets wired to real data, its entry here becomes a lie about the
    // codebase — and the next person reads the list as current.
    const fixed = KNOWN_FABRICATED.filter((r) => !fabricatedRoutes().includes(r));

    expect(
      fixed,
      `${fixed.join(', ')} no longer fabricates — remove it from KNOWN_FABRICATED.`,
    ).toEqual([]);
  });

  it('the exemption list stays honest', () => {
    // An exemption for a screen that has since grown a real data source is
    // stale, and a stale exemption is how the list becomes a place to hide
    // things.
    const stale = Object.keys(STATIC_BY_DESIGN).filter((route) => {
      const page = pageFor(route);
      return page !== null && hasDataSource(page);
    });

    expect(stale, `these now fetch data and should leave the list: ${stale.join(', ')}`).toEqual([]);
  });
});

/**
 * The same defect one level down, which everything above was blind to.
 *
 * The Store performance tab renders four panels of hardcoded business data —
 * orders with customer names and totals, profit summaries with margins,
 * customer lifetime values, promo redemption counts. None of them fetch
 * anything. `performance-tab.tsx` mounts all four.
 *
 * Every assertion above passed on it, for three separate structural reasons:
 *
 *   1. hasDataSource() walks the whole import tree and returns true if ANYTHING
 *      in it reaches @/lib/api. /app/store genuinely fetches for its catalog, so
 *      one real call cleared the entire page including the fabricated half.
 *   2. FAKES_A_LOAD is tested against pageFor(route) — the page file only. The
 *      panels are components, so the regex never saw them.
 *   3. It iterates nav destinations, so a screen outside the nav is never
 *      examined at all.
 *
 * The lesson generalises past this file: the gate checked a SHAPE (does this
 * route's tree contain a fetch?) rather than a REFERENT (does the thing on
 * screen come from the database?). The manual-parity checker had the same flaw
 * in the same week — it accepted any mutation rather than the domain's own, so
 * the time-tracking tools point at /app/projects and pass.
 *
 * This block checks the referent directly, file by file, with no nav filter and
 * no import-tree escape hatch.
 */
describe('no component renders invented data', () => {
  /** Constants whose name announces they are not real. */
  const FABRICATED_CONST = /^const (DEMO|MOCK|SAMPLE|FAKE|PLACEHOLDER|DUMMY)_[A-Z0-9_]*/m;

  /**
   * Files allowed to declare one, with the reason.
   *
   * A component that fetches AND keeps a placeholder for the empty state is
   * honest — the placeholder is never what the user is shown as fact. That case
   * is handled by the data-source check below rather than by this list, so the
   * list should stay empty unless something genuinely static needs it.
   */
  const FABRICATION_ALLOWED: Record<string, string> = {};

  /** Every .tsx/.ts file under app/, which is where screens and their parts live. */
  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (isDir(full)) walk(full, out);
      else if (/\.tsx?$/.test(entry)) out.push(full);
    }
    return out;
  }

  /**
   * Deliberately NOT the transitive hasDataSource() above.
   *
   * Asking whether this file talks to the API is the whole point — following
   * imports is exactly how four fabricated panels inherited the catalog's
   * legitimacy. A component that receives real data through props sits in a tree
   * whose fetching parent passes; a component that seeds its own state from a
   * constant does not, and that is the distinction being drawn.
   */
  const fetchesItself = (body: string) => /from ["']@\/lib\/(api|client)/.test(body);

  it('no file seeds its own render state from a hardcoded dataset', () => {
    const fabricated = walk(APP_DIR)
      .filter((file) => {
        const rel = path.relative(WEB_SRC, file).split(path.sep).join('/');
        if (FABRICATION_ALLOWED[rel]) return false;

        const body = fs.readFileSync(file, 'utf8');
        return FABRICATED_CONST.test(body) && !fetchesItself(body);
      })
      .map((f) => path.relative(WEB_SRC, f).split(path.sep).join('/'));

    expect(
      fabricated,
      'these render hardcoded business data and never call the API — wire them to ' +
        'a service, or delete the surface rather than dressing it as working software',
    ).toEqual([]);
  });

  it('no file synthesises a data series instead of hardcoding one', () => {
    // A second, sneakier shape found in the same sweep. profit-panel.tsx carried
    //
    //   function seedRandom(seed: number) { ... }
    //   const TREND_DATA_30 = generateTrendData(30, 42);
    //
    // and charted it as "Revenue & Profit Trend" with 30 and 90-day toggles.
    // The DEMO_ rule above does not catch this: the constant is not named like a
    // placeholder, and the numbers are computed rather than written down. A
    // deterministic RNG in a rendering component has no honest use — real
    // randomness is not reproducible, and reproducibility is only wanted when
    // the output is meant to look like data.
    const synthesised = walk(APP_DIR)
      .filter((file) => {
        const body = fs.readFileSync(file, 'utf8');
        return /function seed[Rr]andom|const\s+\w*(rng|RNG)\w*\s*=\s*seed/.test(body);
      })
      .map((f) => path.relative(WEB_SRC, f).split(path.sep).join('/'));

    expect(
      synthesised,
      'these generate a reproducible pseudo-random series and render it as business data',
    ).toEqual([]);
  });

  it('the allowance list stays honest', () => {
    const stale = Object.keys(FABRICATION_ALLOWED).filter((rel) => {
      const full = path.join(WEB_SRC, rel);
      if (!fs.existsSync(full)) return true;
      const body = fs.readFileSync(full, 'utf8');
      return !FABRICATED_CONST.test(body) || fetchesItself(body);
    });

    expect(
      stale,
      `no longer fabricating (or gone) — remove from the list: ${stale.join(', ')}`,
    ).toEqual([]);
  });
});
