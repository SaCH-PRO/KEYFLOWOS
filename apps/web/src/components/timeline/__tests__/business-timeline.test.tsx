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
import { BusinessTimeline, BusinessActivityFeed, businessFeedAccess } from '../business-timeline';

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
      // A 503 is retried by fetchWithRetry (about 2 s of backoff) before it settles.
      const unavailable = await screen.findByTestId('business-timeline-unavailable', {}, { timeout: 10_000 });
      expect(unavailable.textContent, `status ${status}`).toContain('Activity unavailable');
      expect(screen.queryByText('No activity yet'), `status ${status}`).toBeNull();
      cleanup();
    }

    serve([timelineRoute([])]);
    render(<BusinessTimeline businessId={BIZ} />);
    expect(await screen.findByText('No activity yet')).toBeTruthy();
    expect(screen.queryByTestId('business-timeline-unavailable')).toBeNull();
  }, 30_000);

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

/**
 * V1-25 review repairs.
 *   BT-06  SEC-V125-1/2: the timeline read is tenant-guarded, not scope-filtered,
 *          so the cockpit shows it only to a caller the V1-47 tiles report able
 *          to read revenue AND CRM; a member without either sees "No access" and
 *          the feed is never read (no amount, no contact name reaches the page)
 *   BT-07  the gate fails closed: no results, or a tile that FAILED, is
 *          "Activity unavailable" and no read; all three tiles OK reads the feed
 *   BT-08  CR-V125-1: ActivityEventListener and AutomationExecutorService both
 *          write a row for one invoice.paid (and invoice.sent, ...); the pair is
 *          shown once, while a genuine repeat (a re-send days later) is kept
 *   BT-09  CR-V125-2: CrmTimelineService's contact mirror rows: the
 *          invoice.payment_recorded mirror (a second copy of the FINANCE row) is
 *          not shown; any other mirror shows its event label, never the raw event
 *          name, and never its JSON.stringify(data) detail
 */
describe('V1-25 review repairs: the cockpit feed respects access, and shows each fact once and readably', () => {
  /** The snapshot as V1-47 builds it for a caller whose access gives these tile statuses. */
  function snapshotWith(status: { contacts: string; openInvoices: string; payments: string }) {
    const snap = cockpitSnapshot();
    for (const key of ['contacts', 'openInvoices', 'payments'] as const) {
      const restricted = status[key] !== 'OK';
      snap.results[key] = { ...snap.results[key], status: status[key], count: restricted ? null : snap.results[key].count } as never;
    }
    return snap;
  }

  it('BT-06: a member without revenue read, or without CRM read, sees "No access" in the cockpit and the feed is never read', async () => {
    const { default: Page } = await import('@/app/app/command-center/page');
    for (const [who, status] of [
      ['revenue none', { contacts: 'OK', openInvoices: 'RESTRICTED', payments: 'RESTRICTED' }],
      ['crm none', { contacts: 'RESTRICTED', openInvoices: 'OK', payments: 'OK' }],
    ] as const) {
      requested = [];
      serve([
        { match: (url) => url.includes(`/business-command-center/businesses/${BIZ}/snapshot`), status: 200, body: snapshotWith(status) },
        timelineRoute(PAYMENT_FEED),
      ]);
      render(
        <GenomeProvider>
          <Page />
        </GenomeProvider>,
      );
      const notice = await screen.findByTestId('business-timeline-restricted', {}, { timeout: 10_000 });
      expect(notice.textContent, who).toContain('No access');
      expect(screen.queryByTestId('business-timeline'), who).toBeNull();
      expect(screen.queryAllByTestId('business-timeline-amount'), who).toEqual([]);
      expect(screen.queryByText(/Payment recorded: TTD/), who).toBeNull();
      expect(timelineRequests(), `${who}: the feed was read`).toEqual([]);
      cleanup();
    }
  }, 60_000);

  it('BT-07: the gate fails closed (no results, or a FAILED tile, is "Activity unavailable" with no read); all three tiles OK reads the feed', async () => {
    const ok = { label: 'x', count: 1, status: 'OK', href: '/' } as const;
    const failed = { ...ok, count: null, status: 'FAILED' } as const;
    const restricted = { ...ok, count: null, status: 'RESTRICTED' } as const;
    expect(businessFeedAccess(undefined)).toBe('unknown');
    expect(businessFeedAccess(null)).toBe('unknown');
    expect(businessFeedAccess({ contacts: ok, openInvoices: ok })).toBe('unknown');
    expect(businessFeedAccess({ contacts: ok, openInvoices: ok, payments: failed })).toBe('unknown');
    expect(businessFeedAccess({ contacts: failed, openInvoices: ok, payments: restricted })).toBe('restricted');
    expect(businessFeedAccess({ contacts: ok, openInvoices: ok, payments: ok })).toBe('allowed');

    for (const results of [undefined, { contacts: ok, openInvoices: ok, payments: failed }]) {
      requested = [];
      serve([timelineRoute(PAYMENT_FEED)]);
      render(<BusinessActivityFeed businessId={BIZ} results={results} />);
      const unavailable = screen.getByTestId('business-timeline-unavailable');
      expect(unavailable.textContent).toContain('Activity unavailable');
      expect(screen.queryByText('No activity yet')).toBeNull();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(timelineRequests()).toEqual([]);
      cleanup();
    }

    requested = [];
    serve([timelineRoute(PAYMENT_FEED)]);
    render(<BusinessActivityFeed businessId={BIZ} results={{ contacts: ok, openInvoices: ok, payments: ok }} />);
    await waitFor(() => expect(screen.getAllByTestId('business-timeline-row')).toHaveLength(3));
    expect(timelineRequests()).toHaveLength(1);
  });

  it('BT-08: the paid row both listeners write for one invoice.paid is shown once, with one amount; a re-send days later is a second row', async () => {
    const t0 = Date.now() - 60_000;
    const at = (ms: number) => new Date(t0 + ms).toISOString();
    const twoDaysAgo = (ms: number) => new Date(t0 - 2 * 86_400_000 + ms).toISOString();
    serve([
      timelineRoute([
        // AutomationExecutorService.onInvoicePaid (automation-executor.service.ts), 40 ms after the listener's row.
        activityRow({
          id: 'act_paid_executor', module: 'commerce', action: 'paid', entityType: 'invoice', entityId: 'inv_250',
          title: 'Invoice paid', detail: 'TTD 250.00', icon: 'DollarSign', tone: 'success',
          data: { total: 250, currency: 'TTD' }, occurredAt: at(40), createdAt: at(40),
        }),
        // ActivityEventListener.onInvoicePaid (activity-event.listener.ts).
        activityRow({
          id: 'act_paid_listener', module: 'commerce', action: 'paid', entityType: 'invoice', entityId: 'inv_250',
          title: 'Payment received', detail: 'Invoice INV-0001 — TTD 250', icon: 'dollar-sign', tone: 'success',
          data: { invoiceId: 'inv_250', total: 250, currency: 'TTD' }, category: 'PAYMENT', revenueImpact: 250,
          occurredAt: at(0), createdAt: at(0),
        }),
        activityRow({ ...PAYMENT_FEED[1], occurredAt: at(-1_000), createdAt: at(-1_000) }),
        activityRow({ ...PAYMENT_FEED[2], occurredAt: at(-60_000), createdAt: at(-60_000) }),
        // invoice.sent written by both listeners (20 ms apart), and a re-send two days earlier.
        activityRow({ id: 'act_sent_a', action: 'sent', entityId: 'inv_250', title: 'Invoice sent', occurredAt: at(-120_000), createdAt: at(-120_000) }),
        activityRow({ id: 'act_sent_b', action: 'sent', entityId: 'inv_250', title: 'Invoice sent', occurredAt: at(-120_020), createdAt: at(-120_020) }),
        activityRow({ id: 'act_sent_old', action: 'sent', entityId: 'inv_250', title: 'Invoice sent', occurredAt: twoDaysAgo(0), createdAt: twoDaysAgo(0) }),
      ]),
    ]);
    render(<BusinessTimeline businessId={BIZ} />);
    await waitFor(() => expect(screen.getAllByTestId('business-timeline-row')).toHaveLength(5));

    const rows = screen.getAllByTestId('business-timeline-row');
    const paid = rows.filter((r) => r.getAttribute('data-action') === 'paid');
    expect(paid).toHaveLength(1);
    expect(amountOf(paid[0])).toBe('TTD 250.00');
    expect(screen.getAllByTestId('business-timeline-amount').map((a) => a.textContent).sort()).toEqual(['TTD 100.00', 'TTD 150.00', 'TTD 250.00']);
    expect(rows.filter((r) => r.getAttribute('data-action') === 'sent'), 'the double write once, the re-send kept').toHaveLength(2);
    expect(rows.filter((r) => r.getAttribute('data-action') === 'payment_recorded')).toHaveLength(2);
  });

  it("BT-09: the contact mirror of invoice.payment_recorded is not shown; other mirrors show their label, never the raw event name or the JSON detail", async () => {
    const mirror = (over: Record<string, unknown>) => activityRow({ module: 'crm', entityType: 'contact', entityId: 'ct_1', contactId: 'ct_1', category: 'CONTACT', ...over });
    const paymentData = {
      invoiceId: 'inv_250', amount: 150, method: 'bank_transfer', reference: 'REF-777', totalPaid: 250,
      invoiceTotal: 250, newStatus: 'PAID', overPaid: 0, recordedBy: 'user_owner_secret',
    };
    serve([
      timelineRoute([
        PAYMENT_FEED[1],
        // CrmTimelineService.logContactEvent's mirror, exactly as written (crm-timeline.service.ts).
        mirror({
          id: 'act_mirror_payment', action: 'invoice.payment_recorded', title: 'invoice.payment_recorded',
          detail: JSON.stringify(paymentData), data: paymentData, category: 'PAYMENT', actorType: 'USER', actorId: 'user_owner_secret',
        }),
        mirror({ id: 'act_mirror_note', action: 'note.created', title: 'note.created', detail: JSON.stringify({ noteId: 'n_1', authorId: 'user_owner_secret' }), data: { noteId: 'n_1' } }),
        mirror({ id: 'act_mirror_followup', action: 'booking.status.followup', title: 'booking.status.followup', detail: '[]', data: {} }),
      ]),
    ]);
    render(<BusinessTimeline businessId={BIZ} />);
    await waitFor(() => expect(screen.getAllByTestId('business-timeline-row')).toHaveLength(3));

    const rows = screen.getAllByTestId('business-timeline-row');
    expect(rows.map((r) => r.getAttribute('data-action')).sort()).toEqual(['booking.status.followup', 'note.created', 'payment_recorded']);
    expect(within(rowFor('note.created', 'ct_1')).getByText('Note added')).toBeTruthy();
    expect(within(rowFor('booking.status.followup', 'ct_1')).getByText('Booking follow-up')).toBeTruthy();
    // The FINANCE row keeps its own detail line.
    expect(within(rowFor('payment_recorded', 'pay_full')).getByTestId('business-timeline-detail').textContent).toBe('Invoice INV-0001');

    const text = screen.getByTestId('business-timeline').textContent ?? '';
    for (const raw of ['invoice.payment_recorded', 'note.created', 'booking.status.followup', 'recordedBy', 'user_owner_secret', 'REF-777', '{']) {
      expect(text.includes(raw), `the feed shows ${raw}`).toBe(false);
    }
  });
});
