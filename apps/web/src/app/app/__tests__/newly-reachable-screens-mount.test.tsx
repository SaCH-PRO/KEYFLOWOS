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
 * V1-47-COCKPIT-TRUTH. The cockpit (/app/command-center) is not a newly opened
 * door, so it is not in the list above; it is here because it is the one screen
 * whose mount has to say something true about the data. CF-19: a source that
 * failed rendered as a healthy zero, and the Release 0 records (contacts, open
 * invoices, payments) were not visible from it at all. So these cases assert
 * WHAT renders, with the snapshot shaped like the server's
 * (business-command-center.types.ts): each Release 0 tile shows its count and
 * links to its list, a real zero reads 0, a missing count never reads 0, and
 * the degraded banner appears exactly when the snapshot says degraded.
 */
function cockpitSnapshot(over: Record<string, unknown> = {}) {
  const ok = (label: string) => ({ label, status: 'OK', fetchedAt: '2026-11-02T10:00:00.000Z' });
  return {
    businessId: 'biz_mount_test',
    generatedAt: '2026-11-02T10:00:00.000Z',
    health: {
      genomeIntegrity: 0, executiveReadinessScore: 0, genomeStage: 'SEED', criticalCount: 0, highPriorityCount: 0,
      pendingApprovalCount: 0, approvedAwaitingExecutionCount: 0, urgentTemporalCount: 0, pendingGenomeProposalCount: 0,
      assetRiskCount: 0, constitutionStale: false, keyGenomeOverall: 0, keyGenomeReadiness: 0, keyGenomeConfidence: 0,
      blockedModuleCount: 0, lowReadinessModuleCount: 0, missingBlockingFactCount: 0,
    },
    summary: 'Cockpit summary.',
    pulse: { overallScore: 0, dimensions: [] },
    briefing: { headline: 'No urgent actions today.', bullets: [], warnings: [] },
    governance: { autoReady: 0, needsApproval: 0, dueToday: 0, urgentRisks: 0 },
    topPriorities: [], pendingApprovals: [], approvedAwaitingExecution: [], urgentItems: [], risks: [], opportunities: [],
    genome: { integrity: 0, readiness: 0, stage: 'SEED', pendingProposals: [], weakestSections: [] },
    keyGenome: { overall: 0, integrity: 0, readiness: 0, confidence: 0, computedAt: '2026-11-02T10:00:00.000Z', sections: [], weakestSections: [] },
    moduleReadiness: [],
    constitution: { latestVersion: null, stale: false, reason: null, href: '/app/profile?tab=business-genome&section=constitution' },
    executiveModes: [],
    recommendedActions: [],
    degraded: false,
    sources: { pendingApprovals: ok('pendingApprovals'), contacts: ok('contacts'), openInvoices: ok('openInvoices'), payments: ok('payments') },
    results: {
      contacts: { label: 'Contacts', count: 1, status: 'OK', href: '/app/crm/contacts' },
      openInvoices: { label: 'Open invoices', count: 0, status: 'OK', href: '/app/commerce/invoices' },
      payments: { label: 'Payments', count: 2, status: 'OK', href: '/app/payments' },
    },
    ...over,
  };
}

/**
 * Answer the snapshot route with `snapshot`, and every other read the cockpit's
 * side panels make (nudges, cross-domain, obligations, KEY streams) with a 503:
 * those panels are not under test here and each has its own unavailable state.
 * The file-wide 200 `{ items: [] }` body is not one any of their routes returns
 * (NudgesWidgetV2 and CrossDomainPanelV2 throw on it after mount), so it would
 * measure the stub, not the cockpit.
 */
function serveCockpit(snapshot: unknown) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const isSnapshot = url.includes('/business-command-center/businesses/biz_mount_test/snapshot');
    const body = isSnapshot ? JSON.stringify(snapshot) : '{"message":"Service Unavailable"}';
    return {
      ok: isSnapshot,
      status: isSnapshot ? 200 : 503,
      statusText: isSnapshot ? 'OK' : 'Service Unavailable',
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => JSON.parse(body),
      text: async () => body,
    };
  }) as unknown as typeof fetch;
}

async function renderCockpit(snapshot: unknown) {
  serveCockpit(snapshot);
  const { default: Page } = await import('../command-center/page');
  render(
    <GenomeProvider>
      <Page />
    </GenomeProvider>,
  );
  return screen.findByTestId('cockpit-results', {}, { timeout: 10_000 });
}

describe('V1-47-COCKPIT-TRUTH: the cockpit shows the Release 0 results and says when it is degraded', () => {
  it('each Release 0 tile shows its count and links to its list; a real zero reads 0; no degraded banner when degraded is false', async () => {
    const results = await renderCockpit(cockpitSnapshot());
    const tile = (key: string) => within(results).getByTestId(`cockpit-result-${key}`);
    expect(tile('contacts').getAttribute('href')).toBe('/app/crm/contacts');
    expect(tile('openInvoices').getAttribute('href')).toBe('/app/commerce/invoices');
    expect(tile('payments').getAttribute('href')).toBe('/app/payments');
    expect(within(tile('contacts')).getByText('Contacts')).toBeTruthy();
    expect(within(tile('contacts')).getByTestId('cockpit-result-count').textContent).toBe('1');
    expect(within(tile('openInvoices')).getByTestId('cockpit-result-count').textContent).toBe('0');
    expect(within(tile('payments')).getByTestId('cockpit-result-count').textContent).toBe('2');
    expect(screen.queryByTestId('cockpit-degraded-banner')).toBeNull();
  }, 20_000);

  it('the degraded banner appears when degraded is true and names the failed sources; a missing count reads Unavailable, never 0; a restricted one reads No access', async () => {
    const failed = { label: 'contacts', status: 'FAILED', fetchedAt: '2026-11-02T10:00:00.000Z' };
    const results = await renderCockpit(
      cockpitSnapshot({
        degraded: true,
        sources: {
          pendingApprovals: { label: 'pendingApprovals', status: 'FAILED', fetchedAt: '2026-11-02T10:00:00.000Z' },
          contacts: failed,
          openInvoices: { label: 'openInvoices', status: 'OK', fetchedAt: '2026-11-02T10:00:00.000Z' },
        },
        results: {
          contacts: { label: 'Contacts', count: null, status: 'FAILED', href: '/app/crm/contacts' },
          openInvoices: { label: 'Open invoices', count: 4, status: 'OK', href: '/app/commerce/invoices' },
          payments: { label: 'Payments', count: null, status: 'RESTRICTED', href: '/app/payments' },
        },
      }),
    );
    const banner = screen.getByTestId('cockpit-degraded-banner');
    expect(banner.getAttribute('role')).toBe('alert');
    expect(banner.textContent).toContain('pendingApprovals');
    expect(banner.textContent).toContain('contacts');
    expect(banner.textContent).not.toContain('openInvoices');
    const count = (key: string) => within(within(results).getByTestId(`cockpit-result-${key}`)).getByTestId('cockpit-result-count').textContent;
    expect(count('contacts')).toBe('Unavailable');
    expect(count('openInvoices')).toBe('4');
    expect(count('payments')).toBe('No access');
  }, 20_000);
});
