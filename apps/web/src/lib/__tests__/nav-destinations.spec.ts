/**
 * A nav that lies about where it goes.
 *
 * Measured on 2026-08-06, before this spec existed:
 *
 *   "Deals"     -> /app/crm/contacts, while /app/crm/deals — a real 356-line
 *                  screen with forecast, stages, velocity and an account pivot —
 *                  had no way in at all.
 *   "Reports"   -> /app/finance, an 8-line redirect to /app/financial-flow,
 *                  which is where the "Financial Flow" entry directly above it
 *                  already went. Two labels, one screen, and the real 546-line
 *                  reports page unreachable.
 *   "Workflows" -> /app/workflows, a redirect to /app/approvals, which
 *                  "Approvals" already reached directly.
 *   An entire "Operations" section of {Projects, Tasks} duplicating the same two
 *   labels and routes already present under Temporal Flow.
 *
 * None of this breaks. A nav entry that goes to the wrong place looks exactly
 * like one that goes to the right place — you only find out by clicking every
 * item and knowing what you expected.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const WEB_SRC = path.join(__dirname, '..', '..');
const APP_DIR = path.join(WEB_SRC, 'app');

const isDir = (p: string) => fs.existsSync(p) && fs.statSync(p).isDirectory();

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
  const page = path.join(dir, 'page.tsx');
  return fs.existsSync(page) ? page : null;
}

function navItems(): Array<{ label: string; href: string }> {
  const src = fs.readFileSync(path.join(WEB_SRC, 'lib', 'nav-config.ts'), 'utf8');
  return [...src.matchAll(/label: "([^"]+)", href: "(\/app\/[^"?]+)"/g)].map((m) => ({
    label: m[1],
    href: m[2],
  }));
}

/**
 * Routes reached under more than one label ON PURPOSE.
 *
 * The mobile bottom nav and the drawer are different surfaces and reasonably
 * name the same destination differently.
 */
const INTENTIONAL_ALIASES: Record<string, string> = {
  '/app/key-inbox': 'drawer says "Inbox" under KEY, mobile bottom nav says "Inbox"',
};
describe('every nav item goes somewhere real', () => {
  const items = navItems();

  it('finds the nav', () => {
    expect(items.length).toBeGreaterThan(30);
  });

  it('no nav item points at a redirect stub', () => {
    // A redirect in the nav means the label is attached to a forwarding
    // address rather than a screen, and the real destination usually already
    // has its own entry — so the user gets two doors into one room and no door
    // into the room they wanted.
    const stubs = items.filter((item) => {
      const page = pageFor(item.href);
      if (!page) return false;
      const body = fs.readFileSync(page, 'utf8');
      return /redirect\(\s*["'`]\//.test(body) && body.split('\n').length < 25;
    });

    expect(
      stubs.map((s) => `${s.label} -> ${s.href}`),
      'these labels point at a forwarding address, not a screen',
    ).toEqual([]);
  });

  it('no two labels share a destination without a reason', () => {
    const byRoute = new Map<string, string[]>();
    for (const item of items) {
      byRoute.set(item.href, [...(byRoute.get(item.href) ?? []), item.label]);
    }

    const undocumented = [...byRoute.entries()]
      .filter(([route, labels]) => labels.length > 1 && !INTENTIONAL_ALIASES[route])
      .map(([route, labels]) => `${route} (${labels.join(', ')})`);

    expect(
      undocumented,
      'add an INTENTIONAL_ALIASES entry with the reason, or give one of them its own screen',
    ).toEqual([]);
  });

  it('the alias list stays honest', () => {
    // An alias entry for a route that no longer has two labels is stale, and a
    // stale exemption is where the next duplicate hides.
    const byRoute = new Map<string, number>();
    for (const item of items) byRoute.set(item.href, (byRoute.get(item.href) ?? 0) + 1);

    const stale = Object.keys(INTENTIONAL_ALIASES).filter((route) => (byRoute.get(route) ?? 0) < 2);

    expect(stale, `no longer duplicated, remove from the list: ${stale.join(', ')}`).toEqual([]);
  });
});

describe('the screens that were unreachable now have a door', () => {
  const byLabel = new Map(navItems().map((i) => [i.label, i.href]));

  it('Deals goes to the deals screen', () => {
    expect(byLabel.get('Deals')).toBe('/app/crm/deals');
  });

  it('Reports goes to the reports screen', () => {
    expect(byLabel.get('Reports')).toBe('/app/reports');
  });

  it('Inbox goes to the inbox the inbox_* tools write to', () => {
    // Labelled "KEY Inbox" until the nav was streamlined; inside the KEY
    // section "Inbox" is unambiguous. The mobile bottom nav also says "Inbox"
    // and pointed at /app/data-inbox, which is data capture — not the thing a
    // user means when they say inbox.
    expect(byLabel.get('Inbox')).toBe('/app/key-inbox');
  });
});
