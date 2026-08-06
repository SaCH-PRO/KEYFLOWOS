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
