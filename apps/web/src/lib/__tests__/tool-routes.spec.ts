/**
 * Every KEY tool must point at a screen where a person can do the same thing.
 *
 * This assertion already existed, as apps/web/scripts/check-tool-routes.ts, and
 * it worked — it is what caught twelve tools pointing at routes that did not
 * survive the 2026-08 fork-close merge. The problem was where it lived.
 *
 * .github/workflows/ci-cd.yml runs `pnpm test:ci`, `pnpm run build` and
 * `pnpm audit`. It has never run that script. So the check fired only when a
 * person remembered to type the command, and the twelve broken routes sat in a
 * fully green pipeline until somebody went looking. Every sibling gate in this
 * directory — nav-reachability, nav-destinations, no-fabricated-screens,
 * disclosure-mode — is a spec for exactly this reason.
 *
 * The analysis is unchanged and lives in ../tool-route-audit. This file is the
 * half that makes CI run it.
 */
import { describe, it, expect } from 'vitest';
import { auditToolRoutes, describeFindings, type ToolRouteFindings } from '../tool-route-audit';

// Reading 245 tools and walking the import graph of every page they name takes
// a few seconds — well past vitest's 5s default, and unrelated to correctness.
const TIMEOUT = 60_000;

let cached: ToolRouteFindings | null = null;
async function findings(): Promise<ToolRouteFindings> {
  cached ??= await auditToolRoutes();
  return cached;
}

/** The failure message is the point: it must name what to fix, not just fail. */
function report(f: ToolRouteFindings): string {
  return ['', ...describeFindings(f)].join('\n');
}

describe('every KEY tool has a manual equivalent', () => {
  it('the registry is readable and non-trivial', async () => {
    const f = await findings();
    // A registry that fails to load would make every assertion below vacuously
    // pass. 100 is far below the real count and far above an accident.
    expect(f.tools.length).toBeGreaterThan(100);
    expect(f.writeTools.length).toBeGreaterThan(50);
  }, TIMEOUT);

  it('declares a manualEquivalentRoute', async () => {
    const f = await findings();
    expect(f.missing, report(f)).toEqual([]);
  }, TIMEOUT);

  it('names a route that has a page behind it', async () => {
    const f = await findings();
    expect(f.unresolved, report(f)).toEqual([]);
  }, TIMEOUT);

  it('does not name a route next.config redirects away', async () => {
    const f = await findings();
    expect(f.redirectedAway, report(f)).toEqual([]);
  }, TIMEOUT);

  it('sends write tools to a screen inside their own domain', async () => {
    const f = await findings();
    expect(f.crossDomain, report(f)).toEqual([]);
  }, TIMEOUT);

  it('sends write tools to a screen a human can actually write from', async () => {
    const f = await findings();
    expect(f.noManualWrite, report(f)).toEqual([]);
  }, TIMEOUT);
});
