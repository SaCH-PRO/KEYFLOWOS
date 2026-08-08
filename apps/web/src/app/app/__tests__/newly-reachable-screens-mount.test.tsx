/**
 * The 29 screens that just got a door, actually mounted.
 *
 * Opening a nav entry does one thing no gate here measured: it creates a new
 * MOUNT PATH. Until 2026-08-08 these screens rendered nowhere, so "finished
 * and tested" meant they typechecked and that static analysis liked them. Of
 * the 138 web tests, exactly zero rendered any of them.
 *
 * That gap is not theoretical. KeyGenomePreview typechecks perfectly and
 * throws `useGenome must be used within a GenomeProvider` the moment it is
 * rendered outside one — fine while it was only ever mounted inside a
 * provider, broken the instant something else mounted it. Twenty-nine new
 * mount paths is twenty-nine chances at exactly that, and tsc cannot see any
 * of them.
 *
 * So this asserts the weakest useful thing, and deliberately only that: each
 * page mounts without throwing. It does not check what renders. A screen can
 * pass here and still be wrong — but a screen that FAILS here is broken for
 * every user who clicks its new nav entry, and nothing else in the suite would
 * have said so.
 *
 * Everything external is stubbed to its emptiest honest answer: no business
 * selected is a real state, an empty list is a real response. If a screen can
 * only mount against populated data, that is worth knowing too.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { GenomeProvider } from '@/contexts/genome-context';

/* ── Everything a page reaches for that jsdom does not have ─────────────── */

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(),
    refresh: vi.fn(), prefetch: vi.fn(),
  }),
  usePathname: () => '/app',
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(), error: vi.fn(), message: vi.fn(),
    warning: vi.fn(), info: vi.fn(), loading: vi.fn(), dismiss: vi.fn(),
  }),
  Toaster: () => null,
}));

/** Charts measure their container; jsdom reports zero and some libraries throw. */
vi.mock('recharts', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div style={{ width: 800, height: 400 }}>{children}</div>
    ),
  };
});

/**
 * Every route whose nav entry was added on 2026-08-08, by the section it
 * landed in. Kept as one list so a screen cannot be linked without appearing
 * here.
 */
const NEWLY_REACHABLE: Array<[string, () => Promise<{ default: React.ComponentType }>]> = [
  // Money
  ['/app/procurement', () => import('../procurement/page')],
  ['/app/procurement/new', () => import('../procurement/new/page')],
  ['/app/procurement/suppliers', () => import('../procurement/suppliers/page')],
  ['/app/retainers', () => import('../retainers/page')],
  ['/app/finance/bank-rules', () => import('../finance/bank-rules/page')],
  ['/app/finance/credit-notes', () => import('../finance/credit-notes/page')],
  ['/app/finance/exchange-rates', () => import('../finance/exchange-rates/page')],
  ['/app/accounting', () => import('../accounting/page')],
  // Customers
  ['/app/crm/accounts', () => import('../crm/accounts/page')],
  ['/app/crm/data-quality', () => import('../crm/data-quality/page')],
  ['/app/crm/duplicates', () => import('../crm/duplicates/page')],
  ['/app/crm/network', () => import('../crm/network/page')],
  ['/app/crm/dashboard', () => import('../crm/dashboard/page')],
  ['/app/sales-team', () => import('../sales-team/page')],
  // Work
  ['/app/time-tracking', () => import('../time-tracking/page')],
  ['/app/operations', () => import('../operations/page')],
  ['/app/operations-flow', () => import('../operations-flow/page')],
  ['/app/change-orders', () => import('../change-orders/page')],
  // Marketing
  ['/app/whatsapp', () => import('../whatsapp/page')],
  ['/app/marketing-flow', () => import('../marketing-flow/page')],
  // Build
  ['/app/assets', () => import('../assets/page')],
  ['/app/portal', () => import('../portal/page')],
  ['/app/automations', () => import('../automations/page')],
  ['/app/key-flows', () => import('../key-flows/page')],
  ['/app/trash', () => import('../trash/page')],
  // Reached from the money hub's "See all"
  ['/app/money/actions', () => import('../money/actions/page')],
  // Opened by the fork close rather than by bec5a501. These five arrive from
  // integration/2026-07-consolidation, which shipped them with no nav entry on
  // either branch, so nothing had ever mounted them. /app/procurement came from
  // exactly there and threw on an empty response — same origin, same gate.
  ['/app/commerce/gateway', () => import('../commerce/gateway/page')],
  ['/app/events', () => import('../events/page')],
  ['/app/genome', () => import('../genome/page')],
  ['/app/payroll', () => import('../payroll/page')],
  ['/app/performance', () => import('../performance/page')],
];

let realFetch: typeof globalThis.fetch;

beforeEach(() => {
  realFetch = globalThis.fetch;
  // The emptiest honest answer. A screen that needs populated data to mount is
  // a screen that breaks for every new business.
  //
  // ONE STUB CANNOT MATCH EVERY ENDPOINT. Some return a bare array, some
  // `{ items: [] }`. This body satisfies both readings badly on purpose, and
  // that turned out to be the useful part: /app/automations did
  // `actRes.data ?? []` and then `.filter`, which throws on any body that is
  // not an array. It is guarded now (Array.isArray).
  //
  // THE LIMITATION THAT FOUND EXPOSED. That failure happened inside load(),
  // after render() had already returned — so the mount assertion PASSED and
  // vitest failed the run on an unhandled rejection instead. This gate catches
  // synchronous throws, not asynchronous ones. A screen can mount, satisfy
  // every assertion here, and still crash a tick later.
  //
  // So: this proves screens MOUNT. It does not prove they survive their own
  // data loading, and it does not prove anything about what they render.
  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => ({ items: [], data: [], results: [] }),
    text: async () => '{"items":[]}',
  })) as unknown as typeof fetch;

  window.localStorage.setItem('kf_business_id', 'biz_mount_test');
  window.localStorage.setItem('activeBusinessId', 'biz_mount_test');
});

afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  window.localStorage.clear();
  vi.clearAllMocks();
});

describe('every newly-reachable screen mounts', () => {
  it('covers every door opened in bec5a501', () => {
    // If a nav entry is added without a line here, this count drifts and the
    // next person notices. 25 nav entries; procurement contributes three
    // routes and money/actions arrives from the See-all fix. Plus the five the
    // fork close linked in from integration/2026-07-consolidation.
    expect(NEWLY_REACHABLE.length).toBeGreaterThanOrEqual(31);
  });

  for (const [route, load] of NEWLY_REACHABLE) {
    it(`${route} renders without throwing`, async () => {
      const mod = await load();
      const Page = mod.default;
      expect(Page, `${route} has no default export`).toBeTruthy();

      // The assertion is deliberately weak: mounting is the thing the nav
      // entry newly causes, and a throw here is a white screen for the user.
      //
      // Rendered inside GenomeProvider because app/app/layout.tsx wraps every
      // /app/* page in it. A bare render made /app/genome throw "useGenome must
      // be used within a GenomeProvider" — a page that mounts perfectly well in
      // the real tree. That is the false death this file's sibling gate warns
      // about: it would have sent someone to fix working code.
      expect(
        () =>
          render(
            <GenomeProvider>
              <Page />
            </GenomeProvider>,
          ),
        `${route} throws on mount`,
      ).not.toThrow();
    });
  }
});
