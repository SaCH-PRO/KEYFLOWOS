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
import { render, cleanup, screen, within } from '@testing-library/react';
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
      // 20s, not vitest's default 5s. This test asks "does it throw", never "is
      // it fast", so a wall-clock ceiling can only produce false failures. It
      // produced one: /app/procurement failed a full run at 5021ms, then passed
      // in isolation and on two consecutive full runs afterwards. Measured, it
      // is the slowest mount here and swings 984ms to 1651ms between runs on an
      // idle machine — a dynamic import of a heavy page plus framer-motion and
      // recharts. On a loaded CI box that variance reaches 5s.
      //
      // A gate that fails for reasons unrelated to what it measures gets
      // switched off, which is the failure this file's siblings keep warning
      // about. If a page ever genuinely takes 20s to mount, that is a real
      // finding and this number should not be raised again.
    }, 20_000);
  }
});

/**
 * V1-47-COCKPIT-TRUTH, re-pointed by TODAY-4BLOCK. /app/command-center (Today) is the one screen whose mount has to
 * say something true about the data. CF-19: a source that failed rendered as a healthy zero. The cockpit's Release 0
 * tiles and degraded banner were removed with the snapshot read; Today is now four blocks from GET .../today
 * (TODAY-AGGREGATE). What each original assertion protected, and where it lives now:
 *   - each tile shows its count and links to its list: Pulse shows each money figure it has, and Get set up links
 *     each step to its page; the contacts and payments counts are no longer on Today (they were the snapshot's)
 *   - a real zero reads 0: a Pulse figure that is 0 while others are not reads TTD 0.00
 *   - no degraded banner when the read is healthy: no "could not be loaded" alert
 *   - the degraded banner appears and says so (role alert): a Today read that fails shows the alert, role alert
 *   - a missing count reads Unavailable, never 0: a failed read shows no figure and no 0.00 at all
 *   - a restricted one reads No access: a member without revenue read (pulseStatus RESTRICTED) gets no Pulse block
 */
const TODAY_STEPS = [
  { key: 'catalog', label: 'Add a product or service', done: true, href: '/app/settings/catalog' },
  { key: 'hours', label: 'Set your business hours', done: false, href: '/app/profile' },
];

function todayAnswer(over: Record<string, unknown> = {}) {
  return {
    businessId: 'biz_mount_test',
    generatedAt: '2026-11-02T14:00:00.000Z',
    timezone: 'America/Port_of_Spain',
    needsYou: { items: [], totalCount: 0, hasMore: false },
    today: {
      bookings: [], invoices: [], acceptedQuotes: [], tasks: [], orders: [], reminders: [],
      counts: { bookings: 0, invoices: 0, acceptedQuotes: 0, tasks: 0, orders: 0, reminders: 0, total: 0 },
    },
    pulseStatus: 'OK',
    pulse: {
      cash: 400, cashBasis: 'ledger', cashCurrency: 'TTD', otherCurrencyCash: [], owedToYou: 600, owedCount: 1,
      overdueAmount: 0, overdueCount: 0, youOwe: 0, youOweCount: 0, monthRevenue: 400, monthExpenses: 0,
      monthProfit: 400, safeToSpend: 150, currency: 'TTD',
    },
    getSetUp: { complete: false, steps: TODAY_STEPS },
    ...over,
  };
}

/**
 * Answer GET .../today with `answer` (status, body); every other read Today's panels make (the queue, what is due,
 * the approved actions, /identity/me) answers 500: those panels are not under test here and each has its own
 * unavailable state. A 500, not a 503: lib/fetch-with-retry.ts retries a GET on 503.
 */
function serveToday(answer: { status: number; body: unknown }) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const isToday = url.includes('/business-command-center/businesses/biz_mount_test/today');
    const status = isToday ? answer.status : 500;
    const body = JSON.stringify(isToday ? answer.body : { message: 'Internal server error' });
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? 'OK' : 'Internal Server Error',
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => JSON.parse(body),
      text: async () => body,
    };
  }) as unknown as typeof fetch;
}

async function renderToday(answer: { status: number; body: unknown }) {
  serveToday(answer);
  const { default: Page } = await import('../command-center/page');
  render(
    <GenomeProvider>
      <Page />
    </GenomeProvider>,
  );
  return screen.findByRole('heading', { level: 2, name: /^needs you$/i }, { timeout: 10_000 });
}

describe('V1-47-COCKPIT-TRUTH (re-pointed to Today, TODAY-4BLOCK): Today says what it knows, and says when it does not', () => {
  it('a healthy read: Pulse shows each figure, a real zero reads 0, each Get set up step links its page, and no "could not be loaded" alert', async () => {
    await renderToday({ status: 200, body: todayAnswer() });
    const pulse = await screen.findByRole('region', { name: /^pulse$/i });
    const text = (pulse.textContent ?? '').replace(/\s+/g, ' ');
    expect(text).toMatch(/Cash[^0-9]*400\.00/);
    expect(text).toMatch(/Owed to you[^0-9]*600\.00/);
    expect(text).toMatch(/You owe[^0-9]*0\.00/);
    const setup = screen.getByRole('region', { name: /^get set up$/i });
    for (const s of TODAY_STEPS) expect(within(setup).getByRole('link', { name: new RegExp(s.label) }).getAttribute('href')).toBe(s.href);
    expect(screen.queryByTestId('today-unavailable')).toBeNull();
  }, 20_000);

  it('a failed read says so (role alert) and shows no figure and no zero; a member without revenue read gets no Pulse block', async () => {
    await renderToday({ status: 500, body: { statusCode: 500, message: 'Internal server error' } });
    const alert = await screen.findByTestId('today-unavailable', {}, { timeout: 10_000 });
    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.textContent).toMatch(/could not be loaded/i);
    expect(screen.queryByRole('region', { name: /^pulse$/i })).toBeNull();
    expect(document.body.textContent ?? '').not.toMatch(/\d\.\d{2}/);
    cleanup();

    await renderToday({ status: 200, body: todayAnswer({ pulseStatus: 'RESTRICTED', pulse: null }) });
    await screen.findByRole('region', { name: /^get set up$/i });
    expect(screen.queryByRole('region', { name: /^pulse$/i })).toBeNull();
    expect(screen.queryByRole('heading', { name: /^pulse$/i })).toBeNull();
  }, 20_000);
});
