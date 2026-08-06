/**
 * A redirect to a page that does not exist is a 404 nobody can route around.
 *
 * middleware.ts carried `PREFIX_REDIRECTS = { "/app/settings/":
 * "/app/build/system/" }`. There are 21 screens under /app/settings and five
 * under /app/build/system, so seventeen of them redirected to a URL with no
 * page. Middleware runs BEFORE routing, so typing the address did not help
 * either — 5,438 lines of finished settings code were unreachable by any means:
 * team (1014), output-templates (680), webhooks (626), custom-fields (528),
 * ai-control (479), notifications (466), and eleven more.
 *
 * Two were linked from the main nav — "Account" and "Team" — and "Account" is
 * in the startup disclosure allowlist, so a brand-new user clicking the first
 * settings link they see landed on a 404.
 *
 * The file's own comment stated the rule it broke: "Only URLs that have been
 * MOVED (not pages with real existing content) are redirected." Another
 * constraint written down and enforced by nothing — the fourth found today,
 * after the disclosure allowlists, the compensation table, and the mobile
 * badge.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const WEB_SRC = path.join(__dirname, '..', '..');
const APP_DIR = path.join(WEB_SRC, 'app');

/** The redirect tables, read from source — middleware.ts is edge-runtime code. */
function redirectTables(): { exact: Record<string, string>; prefix: Record<string, string> } {
  const src = fs.readFileSync(path.join(WEB_SRC, 'middleware.ts'), 'utf8');

  const grab = (name: string) => {
    const at = src.indexOf(`const ${name}: Record<string, string> = {`);
    expect(at, `${name} not found — middleware was restructured`).toBeGreaterThan(-1);
    const body = src.slice(at, src.indexOf('};', at));
    return Object.fromEntries(
      [...body.matchAll(/"([^"]+)":\s*"([^"]+)"/g)].map((m) => [m[1], m[2]]),
    );
  };

  return { exact: grab('REDIRECTS'), prefix: grab('PREFIX_REDIRECTS') };
}

const isDir = (p: string) => fs.existsSync(p) && fs.statSync(p).isDirectory();

/** Does this app-router path render a page? Mirrors the check in check-tool-routes. */
function pageExists(route: string): boolean {
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
    if (!dynamic) return false;
    dir = path.join(dir, dynamic);
  }
  return ['page.tsx', 'page.ts'].some((f) => fs.existsSync(path.join(dir, f)));
}

describe('every redirect lands somewhere', () => {
  const { exact, prefix } = redirectTables();

  it('has redirects to check', () => {
    expect(Object.keys(exact).length).toBeGreaterThan(0);
  });

  for (const [from, to] of Object.entries(redirectTables().exact)) {
    it(`${from} -> ${to} resolves to a real page`, () => {
      expect(pageExists(to), `${to} has no page.tsx — this redirect is a 404`).toBe(true);
    });
  }

  it('no redirect points at a page that redirects again indefinitely', () => {
    // A -> B -> A would loop in the browser. Cheap to check, expensive to hit.
    for (const [from, to] of Object.entries(exact)) {
      expect(exact[to], `${from} -> ${to} -> ${exact[to]} is a redirect chain`).not.toBe(from);
    }
  });

  it('prefix redirects do not strand pages that did not move', () => {
    // The rule a prefix cannot express. If /app/x/ -> /app/y/, then EVERY page
    // under /app/x must have a counterpart under /app/y, or the ones that do
    // not become unreachable — which is what happened to seventeen settings
    // screens.
    for (const [fromPrefix, toPrefix] of Object.entries(prefix)) {
      const fromDir = path.join(APP_DIR, fromPrefix.replace(/^\//, '').replace(/\/$/, ''));
      if (!isDir(fromDir)) continue;

      const stranded = fs
        .readdirSync(fromDir)
        .filter((child) => fs.existsSync(path.join(fromDir, child, 'page.tsx')))
        .filter((child) => !pageExists(`${toPrefix}${child}`));

      expect(
        stranded,
        `${fromPrefix} -> ${toPrefix} strands ${stranded.length} page(s) with no counterpart: ${stranded.join(', ')}`,
      ).toEqual([]);
    }
  });
});

describe('the settings area is reachable again', () => {
  // The specific regression, named. These are the screens the prefix rule ate.
  const RESTORED = [
    'team', 'output-templates', 'webhooks', 'custom-fields', 'ai-control',
    'notifications', 'templates', 'insights', 'autonomy', 'privacy',
    'conversion', 'invite', 'security', 'catalog', 'business', 'billing', 'profile',
  ];

  const { exact, prefix } = redirectTables();

  for (const page of RESTORED) {
    it(`/app/settings/${page} is served rather than redirected into a hole`, () => {
      expect(pageExists(`/app/settings/${page}`), 'the page itself is missing').toBe(true);

      const redirectedTo = exact[`/app/settings/${page}`];
      if (redirectedTo) {
        expect(pageExists(redirectedTo), `redirected to ${redirectedTo}, which has no page`).toBe(true);
      }

      for (const [fromPrefix, toPrefix] of Object.entries(prefix)) {
        if (`/app/settings/${page}`.startsWith(fromPrefix)) {
          const target = `${toPrefix}${page}`;
          expect(pageExists(target), `prefix-redirected to ${target}, which has no page`).toBe(true);
        }
      }
    });
  }
});
