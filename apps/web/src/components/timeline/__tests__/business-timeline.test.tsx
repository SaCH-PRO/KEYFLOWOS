/**
 * V1-25-EVT-BUSINESS-FEED (M49, P1-3 event feed). The invoice page already has
 * a row-derived timeline; the missing view is the business-level one.
 * BusinessTimeline existed and had no importer, and it read the legacy
 * /api/flows/.../activity route rather than the tenant-guarded timeline read
 * (GET /timeline/businesses/:id/events) that the R0-19 evidence suite proves on
 * a real database. D-08: Activity rows power the user feed.
 *
 * Contract pinned here:
 *   BT-01  the cockpit (/app/command-center) mounts the business feed and renders
 *          the payment_recorded and paid rows WITH their amounts, read from
 *          /timeline/businesses/:id/events (never the legacy flows route)
 *   BT-02  BusinessTimeline reads /timeline/businesses/:id/events?limit=50 by
 *          default; a payment row shows data.amount, an invoice row data.total,
 *          each in its currency, to the cent (D-13)
 *   BT-03  the limit it sends is bounded to the server's maximum (200) and to at
 *          least 1, so the cockpit never asks for a page the server refuses
 *   BT-04  a feed that could not be read says so; it never reads "No activity
 *          yet" (the V1-47 rule: an unknown is never shown as a healthy zero)
 *   BT-05  amounts are cents-safe: 0.1 + 0.2 reads 0.30, thousands are grouped,
 *          and a row with no amount shows no amount
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen, within, waitFor } from '@testing-library/react';
import { GenomeProvider } from '@/contexts/genome-context';
import { BusinessTimeline } from '../business-timeline';

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(),
    refresh: vi.fn(), prefetch: vi.fn(),
  }),
  usePathname: () => '/app/command-center',
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

const BIZ = 'biz_feed_test';
const NOW = new Date().toISOString();

/** An Activity row exactly as GET /timeline/businesses/:id/events returns it. */
function activityRow(over: Record<string, unknown>) {
  return {
    id: 'act_x',
    businessId: BIZ,
    module: 'commerce',
    action: 'created',
    entityType: 'invoice',
    entityId: 'inv_1',
    title: 'Row',
    detail: null,
    icon: null,
    tone: null,
    data: null,
    contactId: 'ct_1',
    category: null,
    type: null,
    actorType: 'SYSTEM',
    actorId: null,
    status: 'COMPLETED',
    priority: null,
    revenueImpact: null,
    startsAt: null,
    endsAt: null,
    occurredAt: NOW,
    createdAt: NOW,
    ...over,
  };
}

/** What a partial (100) and a final (150) payment on a 250 invoice leave in the feed. */
const PAYMENT_FEED = [
  activityRow({
    id: 'act_paid',
    module: 'commerce',
    action: 'paid',
    entityType: 'invoice',
    entityId: 'inv_250',
    title: 'Payment received',
    detail: 'Invoice INV-0001 — TTD 250',
    icon: 'dollar-sign',
    tone: 'success',
    data: { invoiceId: 'inv_250', total: 250, currency: 'TTD' },
    category: 'PAYMENT',
    revenueImpact: 250,
  }),
  activityRow({
    id: 'act_pay_full',
    module: 'FINANCE',
    action: 'payment_recorded',
    entityType: 'payment',
    entityId: 'pay_full',
    title: 'Payment recorded: TTD 150',
    detail: 'Invoice INV-0001',
    data: { amount: 150, currency: 'TTD', provider: 'MANUAL' },
  }),
  activityRow({
    id: 'act_pay_partial',
    module: 'FINANCE',
    action: 'payment_recorded',
    entityType: 'payment',
    entityId: 'pay_partial',
    title: 'Payment recorded: TTD 100',
    detail: 'Invoice INV-0001',
    data: { amount: 100, currency: 'TTD', provider: 'MANUAL' },
  }),
];

type Route = { match: (url: string) => boolean; status: number; body: unknown };

/** Every GET the screen makes, recorded; unmatched routes answer 503 (each panel has its own unavailable state). */
let requested: string[] = [];

function serve(routes: Route[]) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    requested.push(url);
    const route = routes.find((r) => r.match(url));
    const status = route?.status ?? 503;
    const body = JSON.stringify(route ? route.body : { message: 'Service Unavailable' });
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? 'OK' : 'Service Unavailable',
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => JSON.parse(body),
      text: async () => body,
    };
  }) as unknown as typeof fetch;
}

const timelineRoute = (body: unknown, status = 200): Route => ({
  match: (url) => url.includes(`/timeline/businesses/${BIZ}/events`),
  status,
  body,
});

function timelineRequests(): URL[] {
  return requested.filter((u) => u.includes('/timeline/businesses/')).map((u) => new URL(u, 'http://localhost'));
}

function rowFor(action: string, entityId: string): HTMLElement {
  const rows = screen.getAllByTestId('business-timeline-row');
  const row = rows.find((r) => r.getAttribute('data-action') === action && r.getAttribute('data-entity-id') === entityId);
  if (!row) throw new Error(`no ${action} row for ${entityId}; rows: ${rows.map((r) => r.getAttribute('data-action')).join(',')}`);
  return row;
}

function amountOf(row: HTMLElement): string | null {
  return within(row).queryByTestId('business-timeline-amount')?.textContent ?? null;
}

let realFetch: typeof globalThis.fetch;

beforeEach(() => {
  realFetch = globalThis.fetch;
  requested = [];
  window.localStorage.setItem('kf_business_id', BIZ);
  window.localStorage.setItem('activeBusinessId', BIZ);
});

afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  window.localStorage.clear();
  vi.clearAllMocks();
});

/** The V1-47 snapshot shape (business-command-center.types.ts), minimal and healthy. */
function cockpitSnapshot() {
  const ok = (label: string) => ({ label, status: 'OK', fetchedAt: NOW });
  return {
    businessId: BIZ,
    generatedAt: NOW,
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
    keyGenome: { overall: 0, integrity: 0, readiness: 0, confidence: 0, computedAt: NOW, sections: [], weakestSections: [] },
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
  };
}

describe('V1-25: the cockpit mounts the business feed (M49)', () => {
  it('BT-01: /app/command-center renders the payment_recorded and paid rows with their amounts, read from /timeline/businesses/:id/events', async () => {
    serve([
      { match: (url) => url.includes(`/business-command-center/businesses/${BIZ}/snapshot`), status: 200, body: cockpitSnapshot() },
      timelineRoute(PAYMENT_FEED),
    ]);
    const { default: Page } = await import('@/app/app/command-center/page');
    render(
      <GenomeProvider>
        <Page />
      </GenomeProvider>,
    );

    const feed = await screen.findByTestId('business-timeline', {}, { timeout: 10_000 });
    await waitFor(() => expect(within(feed).getAllByTestId('business-timeline-row')).toHaveLength(3), { timeout: 10_000 });

    expect(amountOf(rowFor('payment_recorded', 'pay_partial'))).toBe('TTD 100.00');
    expect(amountOf(rowFor('payment_recorded', 'pay_full'))).toBe('TTD 150.00');
    expect(amountOf(rowFor('paid', 'inv_250'))).toBe('TTD 250.00');
    expect(within(rowFor('paid', 'inv_250')).getByText('Payment received')).toBeTruthy();

    const reads = timelineRequests();
    expect(reads.length, 'the cockpit read the tenant timeline').toBeGreaterThan(0);
    for (const url of reads) {
      expect(url.pathname.endsWith(`/timeline/businesses/${BIZ}/events`)).toBe(true);
      const limit = Number(url.searchParams.get('limit'));
      expect(limit).toBeGreaterThanOrEqual(1);
      expect(limit).toBeLessThanOrEqual(200);
    }
    expect(requested.some((u) => u.includes('/api/flows/businesses/') && u.includes('/activity')), 'legacy flows activity route').toBe(false);
  }, 30_000);
});

describe('V1-25: BusinessTimeline reads the tenant timeline and shows amounts', () => {
  it('BT-02: reads /timeline/businesses/:id/events?limit=50 by default; payment rows show data.amount, the paid row data.total, in their currency', async () => {
    serve([timelineRoute(PAYMENT_FEED)]);
    render(<BusinessTimeline businessId={BIZ} />);
    await waitFor(() => expect(screen.getAllByTestId('business-timeline-row')).toHaveLength(3));

    const reads = timelineRequests();
    expect(reads).toHaveLength(1);
    expect(reads[0].pathname).toBe(`/timeline/businesses/${BIZ}/events`);
    expect(reads[0].searchParams.get('limit')).toBe('50');
    expect(requested.some((u) => u.includes('/api/flows/')), 'legacy flows activity route').toBe(false);

    expect(amountOf(rowFor('payment_recorded', 'pay_partial'))).toBe('TTD 100.00');
    expect(amountOf(rowFor('payment_recorded', 'pay_full'))).toBe('TTD 150.00');
    expect(amountOf(rowFor('paid', 'inv_250'))).toBe('TTD 250.00');
    expect(within(rowFor('payment_recorded', 'pay_partial')).getByText('Payment recorded: TTD 100')).toBeTruthy();
  });

  it('BT-03: the limit sent is bounded to the server maximum (200) and to at least 1', async () => {
    for (const [asked, sent] of [[10_000, '200'], [200, '200'], [10, '10'], [0, '1'], [-5, '1'], [12.7, '12']] as const) {
      requested = [];
      serve([timelineRoute([])]);
      render(<BusinessTimeline businessId={BIZ} limit={asked} />);
      await screen.findByText('No activity yet');
      const reads = timelineRequests();
      expect(reads, `limit ${asked}`).toHaveLength(1);
      expect(reads[0].searchParams.get('limit'), `limit ${asked}`).toBe(sent);
      cleanup();
    }
  });

  it('BT-04: a feed that could not be read says it is unavailable, never "No activity yet"; an empty feed reads "No activity yet"', async () => {
    for (const status of [503, 400, 403]) {
      requested = [];
      serve([timelineRoute({ message: 'nope' }, status)]);
      render(<BusinessTimeline businessId={BIZ} />);
      const unavailable = await screen.findByTestId('business-timeline-unavailable');
      expect(unavailable.textContent, `status ${status}`).toContain('Activity unavailable');
      expect(screen.queryByText('No activity yet'), `status ${status}`).toBeNull();
      cleanup();
    }

    serve([timelineRoute([])]);
    render(<BusinessTimeline businessId={BIZ} />);
    expect(await screen.findByText('No activity yet')).toBeTruthy();
    expect(screen.queryByTestId('business-timeline-unavailable')).toBeNull();
  });

  it('BT-05: amounts are cents-safe (0.1 + 0.2 reads 0.30), thousands are grouped, and a row with no amount shows none', async () => {
    serve([
      timelineRoute([
        activityRow({ id: 'a1', module: 'FINANCE', action: 'payment_recorded', entityType: 'payment', entityId: 'p_float', title: 'Float', data: { amount: 0.1 + 0.2, currency: 'USD' } }),
        activityRow({ id: 'a2', module: 'FINANCE', action: 'payment_recorded', entityType: 'payment', entityId: 'p_big', title: 'Big', data: { amount: 1234.5, currency: 'TTD' } }),
        activityRow({ id: 'a3', module: 'crm', action: 'created', entityType: 'contact', entityId: 'c_1', title: 'New contact', data: { contactId: 'c_1' } }),
      ]),
    ]);
    render(<BusinessTimeline businessId={BIZ} />);
    await waitFor(() => expect(screen.getAllByTestId('business-timeline-row')).toHaveLength(3));
    expect(amountOf(rowFor('payment_recorded', 'p_float'))).toBe('USD 0.30');
    expect(amountOf(rowFor('payment_recorded', 'p_big'))).toBe('TTD 1,234.50');
    expect(amountOf(rowFor('created', 'c_1'))).toBeNull();
  });
});
