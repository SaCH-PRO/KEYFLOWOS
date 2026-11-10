/**
 * W8-MONEY-SIGNALS (owner ruling D-100; review findings CR-W7CMV-2,
 * SEC-W7CMV-3, SEC-W7CMV-1, SEC-W7CMV-2): a member without revenue read sees
 * no money signal at all (REAL database).
 *
 * W7-CONTACT-MONEY-VIEWS withheld one contact's amounts from a member with crm
 * read and revenue 'none' (D-90 / D-63: detail, dossier, journey, story,
 * revenue summary). Its review left four doors open, which D-100 closes:
 *   1. CR-W7CMV-2: GET /crm/businesses/:b/contacts (CrmService.listContacts)
 *      sorted and filtered on revenue for that member (sortBy=revenue,
 *      minRevenue, hasUnpaidInvoices), so the order and membership of the
 *      list told them who pays and who owes, and its rows carried the stored
 *      amounts (lifetimeValue, averageSpend, paymentReliability, the
 *      invoice-derived riskFlags / opportunities) and, with includeStats,
 *      meta's invoice figures. D-100: the revenue sorts and filters are
 *      ignored for that member and no revenue field is served.
 *   2. SEC-W7CMV-3: the payment-health ratio (paid / total invoices) on GET
 *      .../health-metrics and the dossier's health. D-100: withheld, as
 *      amounts are (the entry is left out; the other three metrics stay).
 *   3. SEC-W7CMV-1: GET /crm/businesses/:b/predictive-revenue and
 *      .../financial-growth served the business-wide collected, invoiced,
 *      pipeline and average-client figures on crm read alone. D-100: their
 *      shape with every money figure 0 (and no top-service revenue ranking).
 *   4. SEC-W7CMV-2: GET .../ai-insight called the insight with no member (the
 *      owner's view: the payment sentence with its amount and the 'high-value'
 *      tag), and GET .../insight-card (and its POST recompute) served the
 *      cached card (lifetimeValue, 'high-value', the overdue-invoice churn
 *      reason, an AI summary written from those figures). D-100: both routes
 *      pass the member, and the card fails closed: no member, or one without
 *      revenue read, is served the card computed without money (not the
 *      cached one).
 * The OWNER and a member with revenue read keep every figure, order and
 * filter (controls).
 *
 * Nothing on the authorization boundary is mocked: PrismaService over the real
 * client, AuthGuard, BusinessGuard, ModuleScopeGuard, CrmRateLimitGuard and
 * FeatureFlagGuard (the business has ai_tools on), the user / business /
 * membership / contact / invoice / quote rows, the real CrmController and
 * CrmAiController and the services the routes here call (CrmService,
 * CrmStatsService, CrmJourneyService, CrmRevenueService, ContactInsightService
 * with BestChannelService). Identity is attached by a test middleware from
 * `x-test-user` exactly as the Supabase-verifying AuthMiddleware would after
 * token verification. Stand-ins: the AI gateway (AiUsageService.callAi) is a
 * recorder whose summary repeats the lifetime value it was given (no provider
 * traffic); the CRM caches and the controllers' other collaborators, which no
 * route here calls, are empty stand-ins.
 *
 * Requires DATABASE_URL. Every seeded row has the `v94e_` prefix (or belongs to
 * a v94e_ business) and is hard-deleted by raw SQL in beforeAll and afterAll.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

vi.setConfig({ testTimeout: 60_000 });

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL.
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v94e_';
const ID = {
  owner: `${P}owner`, // OWNER of biz
  noRev: `${P}noRev`, // STAFF of biz: crm read, revenue 'none'
  rev: `${P}rev`, // STAFF of biz: crm read, revenue read
  biz: `${P}biz`,
  // Contacts, oldest first (createdAt t0..t3), all TEAM and the owner's.
  cNone: `${P}cNone`, // no invoice
  cHigh: `${P}cHigh`, // CLIENT: PAID HIGH + OVERDUE, a SENT quote, stored money fields
  cMid: `${P}cMid`, // CLIENT: PAID MID
  cLow: `${P}cLow`, // PROSPECT: PAID LOW
};

/** Distinctive amounts, so a withheld response can be searched for them. */
const MONEY = {
  PAID_HIGH: 7319.47,
  OVERDUE_HIGH: 613.29,
  PAID_MID: 2847.13,
  PAID_LOW: 121.77,
  QUOTE_HIGH: 1489.61,
  LIFETIME_VALUE: 7319.47,
  AVERAGE_SPEND: 3966.38,
};

/** cHigh's stored signals: the invoice- and quote-derived entries among others (SEC-W7CMV-3). */
const STORED = {
  riskFlags: ['unpaid_invoices', 'dormant', 'poor_payment_history', 'high_cancellation_rate', 'declining_engagement'],
  opportunities: ['pending_quotes', 'open_deals', 'upsell_ready', 'referral_ask'],
  paymentReliability: 50,
};
/** What a member without revenue read is served of them (GET contacts/:c's rule, V55-13i). */
const STORED_WITHOUT_MONEY = {
  riskFlags: ['dormant', 'high_cancellation_rate'],
  opportunities: ['open_deals', 'referral_ask'],
};

/** The default list order (createdAt desc), and the owner's revenue order (paid total desc). */
const DEFAULT_ORDER = [ID.cLow, ID.cMid, ID.cHigh, ID.cNone];
const REVENUE_DESC = [ID.cHigh, ID.cMid, ID.cLow, ID.cNone];
const REVENUE_ASC = [...REVENUE_DESC].reverse();

// ---- the AI gateway recorder (no provider traffic) ---------------------------
const AI_SUMMARY_MARK = 'v94e recorded AI summary';
const aiCalls: Array<{ feature: string; prompt: string }> = [];
const aiGateway = {
  callAi: async (args: { feature: string; messages?: Array<{ content: string }> }) => {
    const prompt = (args.messages ?? []).map((m) => m.content).join('\n');
    aiCalls.push({ feature: args.feature, prompt });
    // The summary repeats the lifetime value it was handed, as a model would.
    const ltv = /"lifetimeValue":\s*([0-9.]+)/.exec(prompt)?.[1] ?? 'none';
    return { content: JSON.stringify({ summary: `${AI_SUMMARY_MARK}: lifetime value TTD ${ltv}` }), model: 'v94e-recorder', usage: { creditsUsed: 1 } };
  },
};

let db: any;
let app: any;
let contactInsight: any;

async function cleanup() {
  for (const sql of [
    `DELETE FROM contact_insight_snapshots WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoice_items WHERE invoice_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM quotes WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_audit_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_notes WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_tasks WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM activities WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

/** GET (or POST) /crm/businesses/:biz/<routePath> as `user`. */
function call(user: string, routePath: string, method: 'get' | 'post' = 'get') {
  return request(app.getHttpServer())[method](`/crm/businesses/${ID.biz}/${routePath}`).set('x-test-user', user);
}

async function ok(user: string, routePath: string, method: 'get' | 'post' = 'get') {
  const res = await call(user, routePath, method);
  expect(res.status, `${user} ${method.toUpperCase()} ${routePath}: ${JSON.stringify(res.body).slice(0, 300)}`).toBe(method === 'post' ? 201 : 200);
  return res.body;
}

/** The list's contact ids, in order, with its paging fields. */
async function listIds(user: string, query: string) {
  const body = await ok(user, `contacts${query ? `?${query}` : ''}`);
  return { ids: (body.contacts as Array<{ id: string }>).map((c) => c.id), hasMore: body.hasMore, nextCursor: body.nextCursor ?? null };
}

/** The amounts this suite seeds, as they could be printed (raw, rounded, grouped). */
function amountSpellings(): string[] {
  const out = new Set<string>();
  for (const v of [MONEY.PAID_HIGH, MONEY.OVERDUE_HIGH, MONEY.PAID_MID, MONEY.QUOTE_HIGH, MONEY.AVERAGE_SPEND]) {
    out.add(String(v));
    out.add(String(Math.round(v)));
    out.add(v.toLocaleString());
    out.add(Math.round(v).toLocaleString());
  }
  return [...out].filter((s) => s.length >= 4);
}

/** `body` names none of the seeded amounts, in any spelling. */
function expectNoAmount(body: unknown, why: string) {
  const text = JSON.stringify(body);
  for (const spelling of amountSpellings()) {
    expect(text.includes(spelling), `${why}: carries ${spelling}`).toBe(false);
  }
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { EventEmitter2 } = await import('@nestjs/event-emitter');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { TimelineService } = await import('../src/modules/timeline/timeline.service');
  const { CrmRateLimitGuard } = await import('../src/modules/crm/guards/rate-limit.guard');
  const { FeatureFlagGuard } = await import('../src/modules/crm/guards/feature-flag.guard');
  const { CrmController } = await import('../src/modules/crm/crm.controller');
  const { CrmAiController } = await import('../src/modules/crm/crm-ai.controller');
  const { CrmService } = await import('../src/modules/crm/crm.service');
  const { CrmStatsService } = await import('../src/modules/crm/crm-stats.service');
  const { CrmTimelineService } = await import('../src/modules/crm/crm-timeline.service');
  const { CrmJourneyService } = await import('../src/modules/crm/crm-journey.service');
  const { CrmRevenueService } = await import('../src/modules/crm/crm-revenue.service');
  const { CrmListsService } = await import('../src/modules/crm/crm-lists.service');
  const { ContactInsightService } = await import('../src/modules/crm/contact-insight.service');
  const { BestChannelService } = await import('../src/modules/crm/best-channel.service');
  const { ContactAuditService } = await import('../src/modules/crm/privacy/contact-audit.service');

  // ---- the real services over the real client -------------------------------
  const prisma = { client: db } as any;
  const events = new EventEmitter2();
  const crmTimeline = new CrmTimelineService(prisma, events, new TimelineService(prisma), {} as any, {} as any);
  // The stats cache: CrmStatsService.contactDetail and attachContactStats never read it.
  const statsCacheStore = { get: async () => null, set: async () => undefined, invalidate: async () => undefined };
  const crmStats = new CrmStatsService(prisma, crmTimeline, statsCacheStore as any);
  const flowCache = { invalidateCache: () => undefined };
  // CrmService: the real list (listContacts). SubscriptionsService, EntityResolutionService and
  // the custom field values: on no path here.
  const crmService = new CrmService(
    prisma, events, {} as any, crmTimeline, crmStats, new CrmListsService(prisma), flowCache as any, {} as any, new ContactAuditService(prisma), {} as any,
  );
  contactInsight = new ContactInsightService(prisma, aiGateway as any, new BestChannelService(prisma), events);

  const moduleRef = await Test.createTestingModule({
    controllers: [CrmController, CrmAiController],
    providers: [
      { provide: PrismaService, useValue: prisma },
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      CrmRateLimitGuard,
      FeatureFlagGuard,
      { provide: CrmService, useValue: crmService },
      { provide: CrmStatsService, useValue: crmStats },
      { provide: CrmTimelineService, useValue: crmTimeline },
      { provide: CrmJourneyService, useValue: new CrmJourneyService(prisma) },
      { provide: CrmRevenueService, useValue: new CrmRevenueService(prisma) },
      { provide: ContactInsightService, useValue: contactInsight },
      { provide: EventEmitter2, useValue: events },
    ],
  })
    // The controllers' other collaborators: no route here calls them.
    .useMocker(() => ({}))
    .compile();

  app = moduleRef.createNestApplication();
  // Identity attachment only: what AuthMiddleware attaches after Supabase
  // verifies the token, for seeded v94e_ users only. No guard is overridden.
  app.use(async (req: any, _res: any, next: any) => {
    const header = req.headers['x-test-user'];
    const id = typeof header === 'string' ? header : undefined;
    if (id && id.startsWith(P)) {
      const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
      if (user) req.user = { id: user.id, email: user.email, role: user.role };
    }
    next();
  });
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  await app.init();

  await cleanup(); // in case a prior run aborted

  // ---- identities, tenant, memberships ---------------------------------------
  for (const id of [ID.owner, ID.noRev, ID.rev]) {
    await db.user.create({ data: { id, email: `${P}${id.slice(P.length)}@test.local`, role: 'USER' } });
  }
  await db.business.create({ data: { id: ID.biz, name: 'V94E Biz', ownerId: ID.owner, metaData: { features: { ai_tools: true } } } });
  await db.membership.create({ data: { id: `${P}m_owner`, userId: ID.owner, businessId: ID.biz, role: 'OWNER' } });
  await db.membership.create({ data: { id: `${P}m_noRev`, userId: ID.noRev, businessId: ID.biz, role: 'STAFF', permissionScopes: { crm: 'read', revenue: 'none' } } });
  await db.membership.create({ data: { id: `${P}m_rev`, userId: ID.rev, businessId: ID.biz, role: 'STAFF', permissionScopes: { crm: 'read', revenue: 'read' } } });

  // ---- contacts (createdAt t0 < t1 < t2 < t3), invoices, a quote ------------
  const t0 = Date.now() - 4 * 60 * 60_000;
  const at = (hours: number) => new Date(t0 + hours * 60 * 60_000);
  const contact = (id: string, hour: number, status: string, extra: Record<string, unknown> = {}) =>
    db.contact.create({
      data: {
        id, businessId: ID.biz, firstName: 'V94E', lastName: id.slice(P.length), status, visibility: 'TEAM', ownerId: ID.owner,
        email: `${P}${id.slice(P.length).toLowerCase()}@contacts.test`, createdAt: at(hour), ...extra,
      },
    });
  await contact(ID.cNone, 0, 'LEAD');
  await contact(ID.cHigh, 1, 'CLIENT', {
    lifetimeValue: MONEY.LIFETIME_VALUE,
    averageSpend: MONEY.AVERAGE_SPEND,
    paymentReliability: STORED.paymentReliability,
    riskFlags: STORED.riskFlags,
    opportunities: STORED.opportunities,
  });
  await contact(ID.cMid, 2, 'CLIENT');
  await contact(ID.cLow, 3, 'PROSPECT');

  const invoice = (id: string, contactId: string, status: string, total: number, extra: Record<string, unknown> = {}) =>
    db.invoice.create({
      data: {
        id, invoiceNumber: `V94E-${id.slice(P.length)}`, status, subtotal: total, total, currency: 'TTD', businessId: ID.biz, contactId,
        items: { create: [{ id: `${id}_item1`, description: `V94E ${id.slice(P.length)}`, quantity: 1, unitPrice: total, total }] },
        ...extra,
      },
    });
  const now = new Date();
  await invoice(`${P}invHighPaid`, ID.cHigh, 'PAID', MONEY.PAID_HIGH, { paidAt: now });
  await invoice(`${P}invHighOverdue`, ID.cHigh, 'OVERDUE', MONEY.OVERDUE_HIGH, { dueDate: new Date(now.getTime() - 10 * 86_400_000) });
  await invoice(`${P}invMidPaid`, ID.cMid, 'PAID', MONEY.PAID_MID, { paidAt: now });
  await invoice(`${P}invLowPaid`, ID.cLow, 'PAID', MONEY.PAID_LOW, { paidAt: now });
  await db.quote.create({
    data: {
      id: `${P}quoteHigh`, quoteNumber: `V94E-Q-high`, status: 'SENT', subtotal: MONEY.QUOTE_HIGH, total: MONEY.QUOTE_HIGH, currency: 'TTD',
      businessId: ID.biz, contactId: ID.cHigh, expiryDate: new Date(now.getTime() + 3 * 86_400_000),
    },
  });
});

afterAll(async () => {
  if (db) await cleanup();
  if (app) await app.close();
});

describe('W8-MONEY-SIGNALS: a member without revenue read sees no money signal (D-100, real DB)', () => {
  it("fixture sanity: three paid invoices of three contacts and one overdue, one SENT quote; the member with revenue 'none' holds crm read (GET contacts answers 200 with every contact)", async () => {
    expect(await db.invoice.count({ where: { businessId: ID.biz, status: 'PAID' } })).toBe(3);
    expect(await db.invoice.count({ where: { businessId: ID.biz, status: 'OVERDUE' } })).toBe(1);
    expect(await db.quote.count({ where: { businessId: ID.biz, status: 'SENT' } })).toBe(1);
    for (const user of [ID.owner, ID.noRev, ID.rev]) {
      expect((await listIds(user, '')).ids, user).toEqual(DEFAULT_ORDER);
    }
  });

  it("CR-W7CMV-2 (D-100): GET /crm/businesses/:b/contacts ignores sortBy=revenue (either sortOrder), minRevenue and hasUnpaidInvoices for a member with crm read and revenue 'none': the list keeps the default order, membership and paging; the owner and a member with revenue read get the revenue order and the filtered lists", async () => {
    const plain = await listIds(ID.noRev, '');
    const plainPage = await listIds(ID.noRev, 'take=2');
    expect(plain.ids).toEqual(DEFAULT_ORDER);
    for (const query of [
      'sortBy=revenue',
      'sortBy=revenue&sortOrder=desc',
      'sortBy=revenue&sortOrder=asc',
      'minRevenue=1000',
      'minRevenue=999999999',
      'hasUnpaidInvoices=true',
      'sortBy=revenue&minRevenue=1000&hasUnpaidInvoices=true&includeStats=true',
    ]) {
      expect(await listIds(ID.noRev, query), `revenue 'none' ?${query}`).toEqual(plain);
    }
    // Paging: the revenue sort read up to 500 rows and paged in memory (nextCursor null); ignored, the list pages by cursor as without it.
    expect(await listIds(ID.noRev, 'sortBy=revenue&take=2'), "revenue 'none' ?sortBy=revenue&take=2").toEqual(plainPage);
    expect(plainPage.ids).toEqual(DEFAULT_ORDER.slice(0, 2));
    expect(plainPage.hasMore).toBe(true);

    // Controls: the owner and a member with revenue read (D-100 covers only the member without it).
    for (const user of [ID.owner, ID.rev]) {
      expect((await listIds(user, 'sortBy=revenue')).ids, `${user} revenue desc`).toEqual(REVENUE_DESC);
      expect((await listIds(user, 'sortBy=revenue&sortOrder=asc')).ids, `${user} revenue asc`).toEqual(REVENUE_ASC);
      expect((await listIds(user, 'minRevenue=1000')).ids, `${user} minRevenue`).toEqual([ID.cMid, ID.cHigh]);
      expect((await listIds(user, 'minRevenue=999999999')).ids, `${user} minRevenue above every total`).toEqual([]);
      expect((await listIds(user, 'hasUnpaidInvoices=true')).ids, `${user} hasUnpaidInvoices`).toEqual([ID.cHigh]);
    }
  });

  it("CR-W7CMV-2 (D-100): GET /crm/businesses/:b/contacts serves that member no revenue field: every row's stored lifetimeValue, averageSpend and paymentReliability null and its riskFlags / opportunities without the invoice- and quote-derived entries, exactly as GET contacts/:c serves them (V55-13i); with includeStats meta's invoice figures 0 or null and its lead score without the invoice terms; the owner and a member with revenue read keep every stored value and figure", async () => {
    for (const query of ['', 'includeStats=true']) {
      const body = await ok(ID.noRev, `contacts${query ? `?${query}` : ''}`);
      const rows = body.contacts as Array<Record<string, any>>;
      expect(rows.map((r) => r.id)).toEqual(DEFAULT_ORDER);
      for (const row of rows) {
        expect(row.lifetimeValue, `${row.id} ?${query} lifetimeValue`).toBeNull();
        expect(row.averageSpend, `${row.id} ?${query} averageSpend`).toBeNull();
        expect(row.paymentReliability, `${row.id} ?${query} paymentReliability`).toBeNull();
      }
      const high = rows.find((r) => r.id === ID.cHigh)!;
      expect(high.riskFlags, `?${query}`).toEqual(STORED_WITHOUT_MONEY.riskFlags);
      expect(high.opportunities, `?${query}`).toEqual(STORED_WITHOUT_MONEY.opportunities);
      if (query) {
        for (const row of rows) {
          const meta = row.meta;
          expect(meta, `${row.id} meta`).toBeTruthy();
          expect(
            {
              totalRevenue: meta.totalRevenue,
              outstandingBalance: meta.outstandingBalance,
              paidInvoices: meta.paidInvoices,
              unpaidInvoices: meta.unpaidInvoices,
              invoiceCount: meta.invoiceCount,
              oldestUnpaidInvoiceDueAt: meta.oldestUnpaidInvoiceDueAt,
            },
            `${row.id} meta`,
          ).toEqual({ totalRevenue: 0, outstandingBalance: 0, paidInvoices: 0, unpaidInvoices: 0, invoiceCount: 0, oldestUnpaidInvoiceDueAt: null });
        }
        // The lead score as GET contacts/:c works it out for that member: no paid (+10) or unpaid (-5) invoice term.
        expect(high.meta.leadScore).toBe(50 + 5);
      }
      expectNoAmount(body, `revenue 'none' GET contacts?${query}`);

      // The list and the detail withhold the same entries (the two reads agree).
      const detail = await ok(ID.noRev, `contacts/${ID.cHigh}`);
      expect(detail.contact.riskFlags).toEqual(high.riskFlags);
      expect(detail.contact.opportunities).toEqual(high.opportunities);
      expect(detail.contact.paymentReliability).toBeNull();
    }

    // Controls: every stored value and figure.
    for (const user of [ID.owner, ID.rev]) {
      const body = await ok(user, 'contacts?includeStats=true');
      const high = (body.contacts as Array<Record<string, any>>).find((r) => r.id === ID.cHigh)!;
      expect(Number(high.lifetimeValue), user).toBeCloseTo(MONEY.LIFETIME_VALUE, 2);
      expect(Number(high.averageSpend), user).toBeCloseTo(MONEY.AVERAGE_SPEND, 2);
      expect(high.paymentReliability, user).toBe(STORED.paymentReliability);
      expect(high.riskFlags, user).toEqual(STORED.riskFlags);
      expect(high.opportunities, user).toEqual(STORED.opportunities);
      expect(high.meta.totalRevenue, user).toBeCloseTo(MONEY.PAID_HIGH, 2);
      expect(high.meta.outstandingBalance, user).toBeCloseTo(MONEY.OVERDUE_HIGH, 2);
      expect([high.meta.paidInvoices, high.meta.unpaidInvoices, high.meta.invoiceCount], user).toEqual([1, 1, 2]);
      expect(high.meta.oldestUnpaidInvoiceDueAt, user).toBeTruthy();
      expect(high.meta.leadScore, user).toBe(50 + 10 - 5 + 5);
    }
  });

  it("SEC-W7CMV-3 (D-100): the payment-health ratio is withheld from that member: GET .../health-metrics and the dossier's health carry no payment entry, the other three metrics as the owner's; the owner and a member with revenue read get payment 50 (one of two invoices paid)", async () => {
    const owner = await ok(ID.owner, `contacts/${ID.cHigh}/health-metrics`);
    expect(owner.payment).toBe(50);
    const withheld = await ok(ID.noRev, `contacts/${ID.cHigh}/health-metrics`);
    expect(Object.keys(withheld).sort()).toEqual(['engagement', 'relationship', 'responsiveness']);
    expect(withheld).toEqual({ engagement: owner.engagement, responsiveness: owner.responsiveness, relationship: owner.relationship });

    const dossier = await ok(ID.noRev, `contacts/${ID.cHigh}/dossier`);
    expect(dossier.health).toBeTruthy();
    expect(dossier.health).not.toHaveProperty('payment');
    expect(dossier.health).toEqual(withheld);

    for (const user of [ID.owner, ID.rev]) {
      expect((await ok(user, `contacts/${ID.cHigh}/health-metrics`)).payment, user).toBe(50);
      expect((await ok(user, `contacts/${ID.cHigh}/dossier`)).health.payment, `${user} dossier`).toBe(50);
    }
  });

  it("SEC-W7CMV-1 (D-100): GET /crm/businesses/:b/predictive-revenue and .../financial-growth serve that member their shape with every money figure 0 (no pipeline, client value, overdue or expiring quote figure; six empty months; no top-service revenue ranking); the client count stays; the owner and a member with revenue read get the figures", async () => {
    const predictive = await ok(ID.noRev, 'predictive-revenue');
    expect(predictive).toEqual({
      fromActivePipeline: 0,
      fromRecurringClients: 0,
      fromColdLeads: 0,
      expiringQuotes: { count: 0, value: 0 },
      overdueInvoices: { count: 0, value: 0 },
    });
    const growth = await ok(ID.noRev, 'financial-growth');
    const ownerGrowth = await ok(ID.owner, 'financial-growth');
    expect(growth).toEqual({
      monthlyRevenue: (ownerGrowth.monthlyRevenue as Array<{ month: string }>).map((m) => ({ month: m.month, collected: 0, invoiced: 0 })),
      totalCollected: 0,
      totalInvoiced: 0,
      collectionRate: 0,
      avgClientValue: 0,
      clientCount: ownerGrowth.clientCount,
      revenueGrowthPct: 0,
      avgDaysToPayment: 0,
      topServices: [],
      revenueAtRisk: 0,
    });
    expect(growth.monthlyRevenue).toHaveLength(6);
    expectNoAmount(predictive, "revenue 'none' predictive-revenue");
    expectNoAmount(growth, "revenue 'none' financial-growth");

    for (const user of [ID.owner, ID.rev]) {
      const full = await ok(user, 'predictive-revenue');
      expect(full.fromActivePipeline, user).toBeCloseTo(MONEY.QUOTE_HIGH, 2);
      expect(full.overdueInvoices.count, user).toBe(1);
      expect(full.overdueInvoices.value, user).toBeCloseTo(MONEY.OVERDUE_HIGH, 2);
      expect(full.expiringQuotes.count, user).toBe(1);
      expect(full.fromRecurringClients, user).toBeGreaterThan(0);
      const fullGrowth = await ok(user, 'financial-growth');
      expect(fullGrowth.totalCollected, user).toBe(Math.round(MONEY.PAID_HIGH + MONEY.PAID_MID + MONEY.PAID_LOW));
      expect(fullGrowth.revenueAtRisk, user).toBe(Math.round(MONEY.OVERDUE_HIGH + MONEY.QUOTE_HIGH));
      expect(fullGrowth.clientCount, user).toBe(2);
    }
  });

  it("SEC-W7CMV-2 (D-100): GET .../ai-insight is read for the session member: that member's insight has no payment sentence, amount or 'high-value' tag; the owner's and a revenue-read member's keep them", async () => {
    const withheld = await ok(ID.noRev, `contacts/${ID.cHigh}/ai-insight`);
    expect(withheld.summary).toBeTruthy();
    expect(withheld.summary).not.toMatch(/payment/i);
    expect(withheld.tags).not.toContain('high-value');
    expectNoAmount(withheld, "revenue 'none' ai-insight");
    for (const user of [ID.owner, ID.rev]) {
      const full = await ok(user, `contacts/${ID.cHigh}/ai-insight`);
      expect(full.summary, user).toMatch(/payments totaling TTD/);
      expect(full.tags, user).toContain('high-value');
    }
  });

  it("SEC-W7CMV-2 (D-100): GET .../insight-card and POST .../insight-card/recompute serve that member the card without money (lifetimeValue 0, no 'high-value' tag, no overdue-invoice churn reason, a relationship summary that is not the cached AI text and names no amount), even with the owner's card, every figure in it, cached; the owner's card keeps them", async () => {
    // The owner first: the card is computed with every figure and cached.
    const ownerCard = await ok(ID.owner, `contacts/${ID.cHigh}/insight-card`);
    expect(ownerCard.payload.lifetimeValue).toBeCloseTo(MONEY.PAID_HIGH, 2);
    expect(ownerCard.payload.tags).toContain('high-value');
    expect(ownerCard.payload.churnRiskReason).toMatch(/1 overdue invoice/);
    expect(ownerCard.payload.relationshipSummary).toContain(AI_SUMMARY_MARK);
    expect(await db.contactInsightSnapshot.count({ where: { contactId: ID.cHigh } })).toBe(1);

    for (const [method, routePath] of [['get', 'insight-card'], ['post', 'insight-card/recompute']] as const) {
      const card = await ok(ID.noRev, `contacts/${ID.cHigh}/${routePath}`, method);
      const why = `revenue 'none' ${method.toUpperCase()} ${routePath}`;
      expect(card.payload.lifetimeValue, why).toBe(0);
      expect(card.payload.tags, why).not.toContain('high-value');
      expect(card.payload.churnRiskReason, why).not.toMatch(/overdue invoice/);
      expect(card.payload.churnRiskReason, why).not.toMatch(/revenue/);
      expect(card.payload.relationshipSummary, why).not.toContain(AI_SUMMARY_MARK);
      expect(card.payload.relationshipSummary, why).not.toMatch(/lifetime value/i);
      expect(card.payload.churnRisk, why).toBeLessThanOrEqual(ownerCard.payload.churnRisk);
      // The card's shape is kept (the web card reads every field).
      expect(Object.keys(card.payload).sort(), why).toEqual(Object.keys(ownerCard.payload).sort());
      expect(card.payload.openDeals, why).toEqual({ count: 0, value: 0 });
      expectNoAmount(card, why);
    }

    // The owner, and a member with revenue read, still get the cached card with every figure.
    for (const user of [ID.owner, ID.rev]) {
      const card = await ok(user, `contacts/${ID.cHigh}/insight-card`);
      expect(card.payload.lifetimeValue, user).toBeCloseTo(MONEY.PAID_HIGH, 2);
      expect(card.payload.tags, user).toContain('high-value');
      expect(card.payload.relationshipSummary, user).toContain(AI_SUMMARY_MARK);
    }
  });

  it('SEC-W7CMV-2 (D-100): ContactInsightService.getSnapshot fails closed: called with no member it serves the card computed without money, not the cached owner view', async () => {
    // The owner's card is cached (the case above, or here).
    await ok(ID.owner, `contacts/${ID.cHigh}/insight-card`);
    const card = await contactInsight.getSnapshot(ID.biz, ID.cHigh);
    expect(card.payload.lifetimeValue).toBe(0);
    expect(card.payload.tags).not.toContain('high-value');
    expect(card.payload.relationshipSummary).not.toContain(AI_SUMMARY_MARK);
    expectNoAmount(card, 'getSnapshot with no member');
  });

  // ---- review repairs (W8-MONEY-SIGNALS review, owner ruling D-100) ---------------------------

  /** Each contact's stored lead score as an includeStats read writes it (CrmStatsService.attachContactStats: +10 a paid, -5 an unpaid invoice). */
  const STORED_SCORE: Record<string, number> = { [ID.cLow]: 50 + 10, [ID.cMid]: 50 + 10 + 5, [ID.cHigh]: 50 + 10 - 5 + 5, [ID.cNone]: 50 };
  /** The same score without the invoice terms (the detail's meta.leadScore for that member). */
  const MONEY_FREE_SCORE: Record<string, number> = { [ID.cLow]: 50, [ID.cMid]: 50 + 5, [ID.cHigh]: 50 + 5, [ID.cNone]: 50 };

  /** Store the scores an includeStats read would write, so a background write of one changes nothing. */
  async function storeScores() {
    for (const [id, leadScore] of Object.entries(STORED_SCORE)) {
      await db.contact.update({ where: { id }, data: { leadScore } });
    }
  }

  it("SEC-W8MS-1 (D-100): the stored lead score carries the invoice terms, so that member is served the score without them: GET contacts with includeStats serves each row's leadScore as its meta.leadScore (also after its own read stored the full score), without includeStats null; GET contacts/:c and the dossier serve the contact's leadScore as their meta.leadScore; the owner and a member with revenue read keep the stored score", async () => {
    await storeScores();
    // Twice: the first read's background score write (attachContactStats) stores the full score again.
    for (const pass of [1, 2]) {
      const body = await ok(ID.noRev, 'contacts?includeStats=true');
      for (const row of body.contacts as Array<Record<string, any>>) {
        expect(row.leadScore, `pass ${pass} ${row.id} leadScore`).toBe(MONEY_FREE_SCORE[row.id]);
        expect(row.meta.leadScore, `pass ${pass} ${row.id} meta.leadScore`).toBe(MONEY_FREE_SCORE[row.id]);
      }
    }
    for (const row of (await ok(ID.noRev, 'contacts')).contacts as Array<Record<string, any>>) {
      expect(row.leadScore, `${row.id} leadScore without includeStats`).toBeNull();
    }
    expect((await db.contact.findUnique({ where: { id: ID.cHigh }, select: { leadScore: true } })).leadScore).toBe(STORED_SCORE[ID.cHigh]);
    for (const id of [ID.cHigh, ID.cMid, ID.cLow]) {
      const detail = await ok(ID.noRev, `contacts/${id}`);
      expect(detail.meta.leadScore, `${id} detail meta`).toBe(MONEY_FREE_SCORE[id]);
      expect(detail.contact.leadScore, `${id} detail contact`).toBe(detail.meta.leadScore);
      const dossier = await ok(ID.noRev, `contacts/${id}/dossier`);
      expect(dossier.contact.leadScore, `${id} dossier contact`).toBe(MONEY_FREE_SCORE[id]);
      expect(dossier.meta.leadScore, `${id} dossier meta`).toBe(MONEY_FREE_SCORE[id]);
    }

    // Controls: the stored score, with its invoice terms.
    for (const user of [ID.owner, ID.rev]) {
      for (const row of (await ok(user, 'contacts?includeStats=true')).contacts as Array<Record<string, any>>) {
        expect(row.leadScore, `${user} ${row.id}`).toBe(STORED_SCORE[row.id]);
      }
      expect((await ok(user, `contacts/${ID.cMid}`)).contact.leadScore, `${user} detail`).toBe(STORED_SCORE[ID.cMid]);
      expect((await ok(user, `contacts/${ID.cMid}/dossier`)).contact.leadScore, `${user} dossier`).toBe(STORED_SCORE[ID.cMid]);
    }
  });

  it("SEC-W8MS-2 (D-100): GET contacts ignores sortBy=score (either sortOrder) for that member, as it ignores sortBy=revenue: the stored lead score it orders by carries the invoice terms; the list keeps the default order and paging; the owner and a member with revenue read get the stored score order", async () => {
    await storeScores();
    const plain = await listIds(ID.noRev, '');
    const plainPage = await listIds(ID.noRev, 'take=2');
    expect(plain.ids).toEqual(DEFAULT_ORDER);
    for (const query of ['sortBy=score', 'sortBy=score&sortOrder=desc', 'sortBy=score&sortOrder=asc', 'sortBy=score&includeStats=true']) {
      expect(await listIds(ID.noRev, query), `revenue 'none' ?${query}`).toEqual(plain);
    }
    expect(await listIds(ID.noRev, 'sortBy=score&take=2'), "revenue 'none' ?sortBy=score&take=2").toEqual(plainPage);

    for (const user of [ID.owner, ID.rev]) {
      const desc = (await listIds(user, 'sortBy=score')).ids;
      expect(desc.map((id) => STORED_SCORE[id]), `${user} score desc`).toEqual([65, 60, 60, 50]);
      expect(desc[0], `${user} score desc`).toBe(ID.cMid);
      const asc = (await listIds(user, 'sortBy=score&sortOrder=asc')).ids;
      expect(asc.map((id) => STORED_SCORE[id]), `${user} score asc`).toEqual([50, 60, 60, 65]);
    }
  });

  it("SEC-W8MS-3 (D-100): GET .../segments serves that member the unpaid count as 0 (every other count as the owner's), and GET .../highlights no amount and no ranking by money: no overdue reminders, no high-potential cards (ranked by the lead score with its invoice terms), no unpaid segment, no invoice timeline row or invoice follow-up, no service revenue, each segment contact without its money fields; the owner and a member with revenue read keep them", async () => {
    await storeScores();
    const ownerSegments = await ok(ID.owner, 'segments');
    expect(ownerSegments.unpaid).toBe(1);
    expect(await ok(ID.noRev, 'segments')).toEqual({ ...ownerSegments, unpaid: 0 });
    expect((await ok(ID.rev, 'segments')).unpaid).toBe(1);

    const withheld = await ok(ID.noRev, 'highlights');
    const ownerHighlights = await ok(ID.owner, 'highlights');
    expect(withheld.highlights.overdueReminders).toEqual([]);
    expect(withheld.highlights.highPotential).toEqual([]);
    for (const service of withheld.highlights.serviceAffinity as Array<Record<string, any>>) {
      expect(service.revenue, service.serviceId).toBe(0);
    }
    expect((withheld.segments as Array<{ key: string }>).map((s) => s.key)).toEqual(
      (ownerHighlights.segments as Array<{ key: string }>).map((s) => s.key).filter((key) => key !== 'cold-with-unpaid'),
    );
    for (const segment of withheld.segments as Array<{ key: string; contacts: Array<Record<string, any>> }>) {
      for (const row of segment.contacts) {
        const why = `${segment.key} ${row.id}`;
        expect([row.lifetimeValue, row.averageSpend, row.paymentReliability], why).toEqual([null, null, null]);
        expect(row.leadScore, why).toBe(MONEY_FREE_SCORE[row.id]);
        expect([row.meta.totalRevenue, row.meta.outstandingBalance, row.meta.paidInvoices, row.meta.unpaidInvoices], why).toEqual([0, 0, 0, 0]);
      }
    }
    expect((withheld.timeline as Array<{ type: string }>).filter((entry) => entry.type === 'invoice')).toEqual([]);
    expect((withheld.nextActions as Array<{ trigger: string }>).filter((action) => action.trigger === 'invoice-unpaid')).toEqual([]);
    expectNoAmount(withheld, "revenue 'none' GET highlights");

    // Controls: the owner's and a revenue-read member's highlights keep every figure and ranking.
    for (const user of [ID.owner, ID.rev]) {
      const full = user === ID.owner ? ownerHighlights : await ok(user, 'highlights');
      expect(full.highlights.overdueReminders.map((c: { contactId: string }) => c.contactId), user).toEqual([ID.cHigh]);
      expect(full.highlights.overdueReminders[0].outstandingBalance, user).toBeCloseTo(MONEY.OVERDUE_HIGH, 2);
      expect(full.highlights.highPotential[0].contactId, user).toBe(ID.cMid);
      expect((full.segments as Array<{ key: string }>).map((s) => s.key), user).toContain('cold-with-unpaid');
      expect((full.timeline as Array<{ type: string }>).some((entry) => entry.type === 'invoice'), user).toBe(true);
      expect((full.nextActions as Array<{ trigger: string }>).some((action) => action.trigger === 'invoice-unpaid'), user).toBe(true);
    }
  });

  it("SEC-W8MS-4 (D-100): the stored fields ContactInsightService.computeContactIntelligenceFields works out from the contact's invoices (nextBestAction, followUpPriority, conversionProbability, referralLikelihood, responsivenessScore) are withheld (null) from that member in GET contacts, GET contacts/:c and the dossier; the owner and a member with revenue read keep them", async () => {
    await contactInsight.computeContactIntelligenceFields(ID.biz, ID.cHigh);
    const stored = await db.contact.findUnique({
      where: { id: ID.cHigh },
      select: { nextBestAction: true, followUpPriority: true, conversionProbability: true, referralLikelihood: true, responsivenessScore: true },
    });
    // The writer's invoice terms: an unpaid invoice is the next best action and makes the follow-up URGENT.
    expect(stored.nextBestAction).toBe('Send invoice reminder');
    expect(stored.followUpPriority).toBe('URGENT');
    for (const field of ['conversionProbability', 'referralLikelihood', 'responsivenessScore'] as const) {
      expect(stored[field], field).not.toBeNull();
    }
    const withheldFields = { nextBestAction: null, followUpPriority: null, conversionProbability: null, referralLikelihood: null, responsivenessScore: null };
    const pick = (row: Record<string, any>) => ({
      nextBestAction: row.nextBestAction,
      followUpPriority: row.followUpPriority,
      conversionProbability: row.conversionProbability,
      referralLikelihood: row.referralLikelihood,
      responsivenessScore: row.responsivenessScore,
    });

    for (const query of ['', 'includeStats=true']) {
      const rows = (await ok(ID.noRev, `contacts${query ? `?${query}` : ''}`)).contacts as Array<Record<string, any>>;
      expect(pick(rows.find((r) => r.id === ID.cHigh)!), `list ?${query}`).toEqual(withheldFields);
    }
    expect(pick((await ok(ID.noRev, `contacts/${ID.cHigh}`)).contact), 'detail').toEqual(withheldFields);
    expect(pick((await ok(ID.noRev, `contacts/${ID.cHigh}/dossier`)).contact), 'dossier').toEqual(withheldFields);

    for (const user of [ID.owner, ID.rev]) {
      const rows = (await ok(user, 'contacts')).contacts as Array<Record<string, any>>;
      expect(pick(rows.find((r) => r.id === ID.cHigh)!), `${user} list`).toEqual(stored);
      expect(pick((await ok(user, `contacts/${ID.cHigh}`)).contact), `${user} detail`).toEqual(stored);
    }
  });

  it.todo(
    "SEC-W8MS-2 residual (D-100): POST .../ai-search (CrmAiService.naturalLanguageSearch) orders a 'score' or 'revenue' search by the stored lead score, which carries the invoice terms, and serves that score, to a member without revenue read; its query is built in crm-ai.service.ts, outside the W8-MONEY-SIGNALS write set (companion packet)",
  );
});
