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
 * W9-MONEY-RANKING (owner ruling D-100) closes the two rankings W8 left open:
 *   - SEC-W8MS-2 residual: POST .../ai-search (CrmAiService.naturalLanguageSearch)
 *     ordered that member's 'score' or 'revenue' search by the stored lead
 *     score, which carries the invoice terms, and served that score. D-100:
 *     ordered by the money-free key GET contacts uses for them (createdAt
 *     desc), every leadScore null.
 *   - SEC-W8MS-3 residual: GET .../highlights served that member no
 *     high-potential card at all (W8: the cards were ranked by the stored
 *     score). D-100: the cards ranked by the money-free lead score (the score
 *     without its invoice terms), with no balance or unpaid count.
 * Its review repairs (a second business, biz2): SEC-W9MR-1, those cards are
 * picked from the contacts that member may open (never another member's
 * PRIVATE contact); SEC-W9MR-2, that member's next actions are worked out with
 * no invoice follow-up before the cap of 6, and the timeline's money rows are
 * left out before its cut to 20, so unpaid invoices crowd nothing out.
 *
 * W10-MONEY-SIGNALS-REST (owner rulings D-100 and D-63) closes the W9 residuals:
 *   - SEC-W9MR-3: GET .../ai-revenue-opportunities (CrmAiService.revenueOpportunityScan)
 *     serves a member without revenue read no opportunity (each is picked by a
 *     money signal) and every money figure 0;
 *   - SEC-W9MR-4: GET .../ai-reengagement (bulkReengagementSuggestions) serves
 *     that member every leadScore null, in the owner's (money-free) order;
 *   - SEC-W9MR-1 residual: GET .../highlights is worked out from the contacts
 *     the viewer may open whenever a visibility rule hides some (cards, overdue
 *     reminders, next actions, segment contacts and counts, timeline entries,
 *     service-affinity bookings), a member with revenue read included; the
 *     owner's highlights are unchanged (a third business, biz3);
 *   - SEC-W9MR-2 remainder: the timeline's event read leaves the money-type
 *     ContactEvent rows out in the query, so they take none of its 10 places.
 * Its review repair SEC-W10MSR-1 (D-100, D-90, D-63; a fourth business, biz4):
 * that read judges each event by the feed rule GET contacts/:c/events applies,
 * so an event of another type whose data carries an amount (payment.completed,
 * store_order.paid / refunded, autopilot.payment_recovery) is left out too.
 *
 * W11-CRM-SEGMENTS-VISIBLE (F-10; owner rulings D-63 and D-100, on biz3): GET
 * .../segments counts only the contacts the member may open, as the highlights
 * already do, worked out per request with no cache read or write; the owner's
 * counts stay business-wide and cached, and the unpaid projection (SEC-W8MS-3)
 * is kept. Its review repair SEC-W11SV-1 (owner ruling D-133, the CRM count
 * widgets, on biz3): GET .../contact-stats (totalCount, by status, by source,
 * recent growth, top tags) and GET .../contacts/poll (count, newest edit) are
 * worked out the same way, so the member cannot compare them with segments to
 * learn of a hidden contact; the owner's figures stay business-wide.
 * W11-CRM-COUNTS-RULING (owner ruling D-133, option (a), on biz3) pins the
 * ruling's figures for each STAFF member: contact-stats totalCount 1 and CLIENT
 * 0 (the owner's 2 and 1), and a member's contacts poll that the owner's edit
 * of c3Priv through PATCH contacts/:c does not move (the owner's poll moves).
 *
 * The AI rate limit (checkAiRateLimit: 10 AI calls a minute per business)
 * bounds the AI routes this suite calls: 4 to ai-insight and the recompute,
 * 4 to ai-search; the ai-search matrix is also run on the service directly.
 *
 * Nothing on the authorization boundary is mocked: PrismaService over the real
 * client, AuthGuard, BusinessGuard, ModuleScopeGuard, CrmRateLimitGuard and
 * FeatureFlagGuard (the business has ai_tools on), the user / business /
 * membership / contact / invoice / quote rows, the real CrmController and
 * CrmAiController and the services the routes here call (CrmService,
 * CrmStatsService, CrmJourneyService, CrmRevenueService, ContactInsightService
 * with BestChannelService, CrmAiService). Identity is attached by a test middleware from
 * `x-test-user` exactly as the Supabase-verifying AuthMiddleware would after
 * token verification. Stand-ins: the AI gateway (AiUsageService.callAi) is a
 * recorder whose summary repeats the lifetime value it was given and whose
 * search parse is a fixed table (NL_SEARCH; no provider traffic); the CRM caches and the controllers' other collaborators, which no
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

// hookTimeout as the other real-DB suites set it: the top-level beforeAll (Nest compile + seed) passes 10 s on a loaded machine.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

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
/** POST ai-search (W9-MONEY-RANKING): the filters the recorded model parses out of each query. */
const NL_SEARCH = {
  scoreDesc: { query: 'v94e best leads first', filters: { sortBy: 'score' } },
  scoreAsc: { query: 'v94e weakest leads first', filters: { sortBy: 'score', sortOrder: 'asc' } },
  revenueDesc: { query: 'v94e top payers first', filters: { sortBy: 'revenue', sortOrder: 'desc' } },
  revenueAsc: { query: 'v94e smallest payers first', filters: { sortBy: 'revenue', sortOrder: 'asc' } },
};
const aiCalls: Array<{ feature: string; prompt: string }> = [];
const aiGateway = {
  callAi: async (args: { feature: string; messages?: Array<{ content: string }> }) => {
    const prompt = (args.messages ?? []).map((m) => m.content).join('\n');
    aiCalls.push({ feature: args.feature, prompt });
    if (args.feature === 'nl_search') {
      const query = args.messages?.[args.messages.length - 1]?.content ?? '';
      const parsed = Object.values(NL_SEARCH).find((entry) => entry.query === query);
      return { content: JSON.stringify({ filters: parsed?.filters ?? {}, interpretation: `v94e recorded: ${query}`, confidence: 0.9 }), model: 'v94e-recorder', usage: { creditsUsed: 1 } };
    }
    // The summary repeats the lifetime value it was handed, as a model would.
    const ltv = /"lifetimeValue":\s*([0-9.]+)/.exec(prompt)?.[1] ?? 'none';
    return { content: JSON.stringify({ summary: `${AI_SUMMARY_MARK}: lifetime value TTD ${ltv}` }), model: 'v94e-recorder', usage: { creditsUsed: 1 } };
  },
};

let db: any;
let app: any;
let contactInsight: any;
let crmAi: any;

async function cleanup() {
  for (const sql of [
    `DELETE FROM contact_insight_snapshots WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM bookings WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM services WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoice_items WHERE invoice_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM quotes WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_audit_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_notes WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_tasks WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM activities WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    // W11-CRM-COUNTS-RULING: the owner's PATCH contacts/:c leaves a TeamAuditInterceptor row.
    `DELETE FROM team_activity_logs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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
  const { CrmAiService } = await import('../src/modules/crm/crm-ai.service');
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
  // CrmAiService: the real natural-language search (POST ai-search) over the recorder; the
  // sequences service is a stand-in with no sequence (GET ai-reengagement lists them, W10-MONEY-SIGNALS-REST).
  const sequences = { listSequences: async () => [] };
  crmAi = new CrmAiService(prisma, aiGateway as any, sequences as any, new CrmListsService(prisma), crmTimeline, crmService);

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
      { provide: CrmAiService, useValue: crmAi },
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

  it("SEC-W8MS-3 (D-100): GET .../segments serves that member the unpaid count as 0 (every other count as the owner's), and GET .../highlights no amount and no ranking by money: no overdue reminders, no high-potential card carrying a balance or an unpaid count (W9-MONEY-RANKING ranks them by the money-free score, the case below), no unpaid segment, no invoice timeline row or invoice follow-up, no service revenue, each segment contact without its money fields; the owner and a member with revenue read keep them", async () => {
    await storeScores();
    const ownerSegments = await ok(ID.owner, 'segments');
    expect(ownerSegments.unpaid).toBe(1);
    expect(await ok(ID.noRev, 'segments')).toEqual({ ...ownerSegments, unpaid: 0 });
    expect((await ok(ID.rev, 'segments')).unpaid).toBe(1);

    const withheld = await ok(ID.noRev, 'highlights');
    const ownerHighlights = await ok(ID.owner, 'highlights');
    expect(withheld.highlights.overdueReminders).toEqual([]);
    // W8 served no card here; W9-MONEY-RANKING (D-100) serves the money-free ranking (pinned in the case below).
    for (const card of withheld.highlights.highPotential as Array<Record<string, any>>) {
      expect([card.outstandingBalance, card.unpaidInvoices], card.contactId).toEqual([0, 0]);
    }
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

  // ---- W9-MONEY-RANKING (owner ruling D-100): the rankings W8 left on the stored score ------------

  /** The default list order (createdAt desc) ranked by `score` (desc, ties kept in that order), as a highlight list ranks its cards. */
  const rankedBy = (score: Record<string, number>) => [...DEFAULT_ORDER].sort((a, b) => score[b] - score[a]);

  it("SEC-W8MS-3 residual (D-100) (W9-MONEY-RANKING): GET .../highlights serves that member a non-empty highPotential ranked by the money-free lead score (the score without its invoice terms, as that member's segment rows carry it), each card with no balance and no unpaid count, so no card is placed by an invoice; the owner and a member with revenue read keep the stored-score ranking with its balances", async () => {
    await storeScores();
    // Money-free: the two CLIENTs (55) above the PROSPECT and the LEAD (50). Stored: cLow's paid invoice (+10) puts it above cHigh, whose overdue one costs 5.
    const moneyFreeRanking = rankedBy(MONEY_FREE_SCORE);
    const storedRanking = rankedBy(STORED_SCORE);
    expect(moneyFreeRanking).toEqual([ID.cMid, ID.cHigh, ID.cLow, ID.cNone]);
    expect(storedRanking).toEqual([ID.cMid, ID.cLow, ID.cHigh, ID.cNone]);

    const withheld = await ok(ID.noRev, 'highlights');
    const cards = withheld.highlights.highPotential as Array<Record<string, any>>;
    expect(cards.map((card) => card.contactId)).toEqual(moneyFreeRanking);
    for (const card of cards) {
      const why = `revenue 'none' highPotential ${card.contactId}`;
      expect(card.leadScore, why).toBe(MONEY_FREE_SCORE[card.contactId]);
      expect([card.outstandingBalance, card.unpaidInvoices], why).toEqual([0, 0]);
    }
    // The card's score is the one that member's segment rows carry (both without the invoice terms).
    for (const segment of withheld.segments as Array<{ key: string; contacts: Array<Record<string, any>> }>) {
      for (const row of segment.contacts) {
        const card = cards.find((c) => c.contactId === row.id);
        if (card) expect(card.leadScore, `${segment.key} ${row.id}`).toBe(row.leadScore);
      }
    }
    expect(withheld.highlights.overdueReminders).toEqual([]);
    expectNoAmount(withheld, "revenue 'none' GET highlights (W9-MONEY-RANKING)");

    // Controls: the stored-score ranking (with its invoice terms) and each card's balance.
    for (const user of [ID.owner, ID.rev]) {
      const full = (await ok(user, 'highlights')).highlights.highPotential as Array<Record<string, any>>;
      expect(full.map((card) => card.contactId), user).toEqual(storedRanking);
      expect(full.map((card) => card.leadScore), user).toEqual(storedRanking.map((id) => STORED_SCORE[id]));
      const high = full.find((card) => card.contactId === ID.cHigh)!;
      expect(high.outstandingBalance, user).toBeCloseTo(MONEY.OVERDUE_HIGH, 2);
      expect(high.unpaidInvoices, user).toBe(1);
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

  /** POST ai-search as `user`: the contact ids in order and each one's leadScore. */
  async function aiSearch(user: string, query: string) {
    const res = await request(app.getHttpServer()).post(`/crm/businesses/${ID.biz}/ai-search`).set('x-test-user', user).send({ query });
    expect(res.status, `${user} POST ai-search '${query}': ${JSON.stringify(res.body).slice(0, 300)}`).toBe(201);
    const contacts = res.body.contacts as Array<{ id: string; leadScore: number | null }>;
    return { ids: contacts.map((c) => c.id), scores: contacts.map((c) => c.leadScore), body: res.body };
  }

  it("SEC-W8MS-2 residual (D-100) (W9-MONEY-RANKING, was it.todo): POST .../ai-search (CrmAiService.naturalLanguageSearch) orders a 'score' or 'revenue' search of a member without revenue read by the money-free key GET contacts uses for them (createdAt desc, whatever the sortOrder) and serves every leadScore null, not the stored lead score, which carries the invoice terms; the owner and a member with revenue read keep the stored lead score order and score", async () => {
    await storeScores();
    // Four route calls (the AI rate limit is 10 a minute per business; the matrix is run on the service in the case below).
    for (const search of [NL_SEARCH.scoreDesc, NL_SEARCH.revenueAsc]) {
      const withheld = await aiSearch(ID.noRev, search.query);
      expect(withheld.ids, `revenue 'none' ${search.query}`).toEqual(DEFAULT_ORDER);
      expect(withheld.scores, `revenue 'none' ${search.query}`).toEqual(DEFAULT_ORDER.map(() => null));
      expect(withheld.body.totalResults).toBe(DEFAULT_ORDER.length);
    }

    // Controls: the stored score order (ties at 60 in either order) and the stored score.
    for (const [user, search] of [[ID.owner, NL_SEARCH.scoreDesc], [ID.rev, NL_SEARCH.revenueDesc]] as const) {
      const full = await aiSearch(user, search.query);
      expect(full.scores, `${user} ${search.query}`).toEqual([65, 60, 60, 50]);
      expect(full.ids.map((id) => STORED_SCORE[id]), `${user} ${search.query}`).toEqual([65, 60, 60, 50]);
      expect(full.ids[0], `${user} ${search.query}`).toBe(ID.cMid);
    }
  });

  it("SEC-W8MS-2 residual (D-100) (W9-MONEY-RANKING): CrmAiService.naturalLanguageSearch named a viewer without revenue read orders every 'score' and 'revenue' search (either sortOrder) by createdAt desc and serves no leadScore; named the owner or a member with revenue read, the stored lead score order (asc and desc) and score", async () => {
    await storeScores();
    for (const search of Object.values(NL_SEARCH)) {
      const withheld = await crmAi.naturalLanguageSearch(ID.biz, search.query, null, ID.noRev);
      expect(withheld.contacts.map((c: { id: string }) => c.id), `revenue 'none' ${search.query}`).toEqual(DEFAULT_ORDER);
      expect(withheld.contacts.map((c: { leadScore: number | null }) => c.leadScore), `revenue 'none' ${search.query}`).toEqual(DEFAULT_ORDER.map(() => null));
    }
    for (const user of [ID.owner, ID.rev]) {
      for (const search of Object.values(NL_SEARCH)) {
        const full = await crmAi.naturalLanguageSearch(ID.biz, search.query, null, user);
        const expected = search.filters.sortOrder === 'asc' ? [50, 60, 60, 65] : [65, 60, 60, 50];
        expect(full.contacts.map((c: { leadScore: number | null }) => c.leadScore), `${user} ${search.query}`).toEqual(expected);
        expect(full.contacts.map((c: { id: string }) => STORED_SCORE[c.id]), `${user} ${search.query}`).toEqual(expected);
      }
    }
  });

  // ---- W10-MONEY-SIGNALS-REST (owner ruling D-100): the AI scans W9-MONEY-RANKING left open ----------

  type Opportunity = { contactId: string; opportunityType: string; totalRevenue: number; estimatedValue: number; leadScore: number | null };
  /** The scan's opportunities by contact id (the scan reads its contacts in no order). */
  const byContact = (opportunities: Opportunity[]) => [...opportunities].sort((a, b) => a.contactId.localeCompare(b.contactId));

  it("SEC-W9MR-3 (D-100, D-63, D-90): GET .../ai-revenue-opportunities (CrmAiService.revenueOpportunityScan) serves a member without revenue read the scan's shape with no money signal: no opportunity (each one is picked by a money signal: 'Hot prospect' by the stored lead score with its invoice terms, 'Repeat business' by the last invoice's age, 'Upsell' by the paid total), totalEstimatedRevenue 0, contactsAnalyzed as the owner's; the owner and a member with revenue read keep the opportunities with their totals (W10-MONEY-SIGNALS-REST, D-100, was it.todo)", async () => {
    await storeScores();
    const owner = await ok(ID.owner, 'ai-revenue-opportunities');
    // The owner's: cLow a 'Hot prospect' by its stored score (60 = 50 + its paid invoice's 10; 50 without it), cHigh and cMid 'Upsell' by their paid totals.
    const full = byContact(owner.opportunities as Opportunity[]);
    expect(full.map((o) => [o.contactId, o.opportunityType.split(' ')[0]])).toEqual(
      [[ID.cHigh, 'Upsell'], [ID.cLow, 'Hot'], [ID.cMid, 'Upsell']].sort((a, b) => a[0].localeCompare(b[0])),
    );
    expect(full.find((o) => o.contactId === ID.cLow)!.leadScore).toBe(STORED_SCORE[ID.cLow]);
    expect(full.find((o) => o.contactId === ID.cHigh)!.totalRevenue).toBeCloseTo(MONEY.PAID_HIGH, 2);
    expect(owner.totalEstimatedRevenue).toBeGreaterThan(0);
    expect(owner.contactsAnalyzed).toBe(3);

    const withheld = await ok(ID.noRev, 'ai-revenue-opportunities');
    expect(withheld).toEqual({ opportunities: [], totalEstimatedRevenue: 0, contactsAnalyzed: owner.contactsAnalyzed });
    expectNoAmount(withheld, "revenue 'none' GET ai-revenue-opportunities");

    // Control: a member with revenue read gets the owner's scan.
    const rev = await ok(ID.rev, 'ai-revenue-opportunities');
    expect({ ...rev, opportunities: byContact(rev.opportunities) }).toEqual({ ...owner, opportunities: full });

    // The service: named a viewer without revenue read, the same; the owner, a revenue reader or no viewer (as before), the full scan.
    expect(await crmAi.revenueOpportunityScan(ID.biz, null, ID.noRev)).toEqual(withheld);
    for (const viewer of [ID.owner, ID.rev, undefined]) {
      const scan = await crmAi.revenueOpportunityScan(ID.biz, null, viewer);
      expect({ ...scan, opportunities: byContact(scan.opportunities) }, String(viewer)).toEqual({ ...owner, opportunities: full });
    }
  });

  it("SEC-W9MR-4 (D-100): GET .../ai-reengagement (CrmAiService.bulkReengagementSuggestions) serves a member without revenue read every suggestion's leadScore null (the stored score carries the invoice terms, +10 a paid and -5 an unpaid invoice: the SEC-W8MS-1 class), in the owner's money-free order (staleness, then the status urgency; the lead score places none); the owner and a member with revenue read keep the stored score (W10-MONEY-SIGNALS-REST, D-100, was it.todo)", async () => {
    await storeScores();
    // Every contact stale, oldest interaction first: cHigh, cMid, cNone, cLow.
    for (const [id, days] of [[ID.cHigh, 50], [ID.cMid, 45], [ID.cNone, 40], [ID.cLow, 35]] as const) {
      await db.contact.update({ where: { id }, data: { lastInteractionAt: new Date(Date.now() - days * 86_400_000) } });
    }
    // The urgency sort puts the PROSPECT (high) before the others (medium), which keep their staleness order;
    // the stored score order would be cMid (65), cLow and cHigh (60), cNone (50).
    const ORDER = [ID.cLow, ID.cHigh, ID.cMid, ID.cNone];

    const owner = await ok(ID.owner, 'ai-reengagement');
    const ownerRows = owner.suggestions as Array<{ contactId: string; leadScore: number | null }>;
    expect(ownerRows.map((s) => s.contactId)).toEqual(ORDER);
    expect(ownerRows.map((s) => s.leadScore)).toEqual(ORDER.map((id) => STORED_SCORE[id]));

    const withheld = await ok(ID.noRev, 'ai-reengagement');
    expect(withheld).toEqual({ ...owner, suggestions: ownerRows.map((row) => ({ ...row, leadScore: null })) });

    // Control: a member with revenue read gets the owner's suggestions with the stored score.
    expect(await ok(ID.rev, 'ai-reengagement')).toEqual(owner);

    // The service: named a viewer without revenue read, the same; the owner, a revenue reader or no viewer (as before), the stored score.
    expect(await crmAi.bulkReengagementSuggestions(ID.biz, null, ID.noRev)).toEqual(withheld);
    for (const viewer of [ID.owner, ID.rev, undefined]) {
      expect(await crmAi.bulkReengagementSuggestions(ID.biz, null, viewer), String(viewer)).toEqual(owner);
    }
  });
});

// ---- W9-MONEY-RANKING review repairs (owner ruling D-100) -----------------------------------------

/**
 * W9-MONEY-RANKING review repairs SEC-W9MR-1 and SEC-W9MR-2 (owner ruling
 * D-100), on a second business of this suite (biz2), so the first business's
 * contacts and orders stay as the cases above pin them. Contacts, oldest
 * first, all the owner's:
 *   c2Task          LEAD, TEAM: 8 tasks (one overdue) and 8 notes, all older than the invoices;
 *   c2Priv          CLIENT, PRIVATE (no share), stale (no interaction for 30 days): the member with
 *                   crm read and revenue 'none' cannot open it (GET contacts/:c 404);
 *   c2Owe1..c2Owe6  LEAD, TEAM: one SENT invoice each (OWE_AMOUNT).
 */
const ID2 = {
  biz: `${P}biz2`,
  cTask: `${P}c2Task`,
  cPriv: `${P}c2Priv`,
  cOwe: [1, 2, 3, 4, 5, 6].map((n) => `${P}c2Owe${n}`),
};
const OWE_AMOUNT = 431.57;
const PRIVATE_NAME = 'V94E PrivateSecretName';
/** The six owing contacts newest first (createdAt desc: the order the highlights read contacts in). */
const OWE_NEWEST_FIRST = [...ID2.cOwe].reverse();

/** GET /crm/businesses/:biz2/<routePath> as `user`. */
function call2(user: string, routePath: string) {
  return request(app.getHttpServer()).get(`/crm/businesses/${ID2.biz}/${routePath}`).set('x-test-user', user);
}

async function ok2(user: string, routePath: string) {
  const res = await call2(user, routePath);
  expect(res.status, `${user} GET biz2 ${routePath}: ${JSON.stringify(res.body).slice(0, 300)}`).toBe(200);
  return res.body;
}

describe('W9-MONEY-RANKING review repairs: the highlights of a member without revenue read (D-100, real DB)', () => {
  const noteIds: string[] = [];
  const taskIds: string[] = [];

  beforeAll(async () => {
    await db.business.create({ data: { id: ID2.biz, name: 'V94E Biz2', ownerId: ID.owner, metaData: { features: { ai_tools: true } } } });
    await db.membership.create({ data: { id: `${P}m2_owner`, userId: ID.owner, businessId: ID2.biz, role: 'OWNER' } });
    await db.membership.create({ data: { id: `${P}m2_noRev`, userId: ID.noRev, businessId: ID2.biz, role: 'STAFF', permissionScopes: { crm: 'read', revenue: 'none' } } });
    await db.membership.create({ data: { id: `${P}m2_rev`, userId: ID.rev, businessId: ID2.biz, role: 'STAFF', permissionScopes: { crm: 'read', revenue: 'read' } } });

    const t0 = Date.now() - 10 * 60 * 60_000;
    const at = (hours: number) => new Date(t0 + hours * 60 * 60_000);
    const contact = (id: string, hour: number, status: string, extra: Record<string, unknown> = {}) =>
      db.contact.create({
        data: {
          id, businessId: ID2.biz, firstName: 'V94E', lastName: id.slice(P.length), status, visibility: 'TEAM', ownerId: ID.owner,
          email: `${P}${id.slice(P.length).toLowerCase()}@contacts.test`, createdAt: at(hour), ...extra,
        },
      });
    await contact(ID2.cTask, 0, 'LEAD');
    await contact(ID2.cPriv, 1, 'CLIENT', { visibility: 'PRIVATE', lastName: 'PrivateSecretName' });
    for (const [i, id] of ID2.cOwe.entries()) await contact(id, 2 + i, 'LEAD');

    // c2Task's 8 tasks (the first overdue, the others without a due date) and 8 notes, older than the invoices.
    for (let k = 0; k < 8; k += 1) {
      const taskId = `${P}c2task${k}`;
      await db.contactTask.create({
        data: {
          id: taskId, businessId: ID2.biz, contactId: ID2.cTask, title: `V94E task ${k}`,
          dueDate: k === 0 ? new Date(Date.now() - 86_400_000) : null, createdAt: at(0.1 + k * 0.1),
        },
      });
      taskIds.push(taskId);
      const noteId = `${P}c2note${k}`;
      await db.contactNote.create({ data: { id: noteId, businessId: ID2.biz, contactId: ID2.cTask, body: `V94E note ${k}`, createdAt: at(0.15 + k * 0.1) } });
      noteIds.push(noteId);
    }

    for (const id of ID2.cOwe) {
      await db.invoice.create({
        data: {
          id: `${id}_inv`, invoiceNumber: `V94E-${id.slice(P.length)}`, status: 'SENT', subtotal: OWE_AMOUNT, total: OWE_AMOUNT, currency: 'TTD',
          businessId: ID2.biz, contactId: id, dueDate: new Date(Date.now() + 5 * 86_400_000),
          items: { create: [{ id: `${id}_inv_item1`, description: `V94E ${id.slice(P.length)}`, quantity: 1, unitPrice: OWE_AMOUNT, total: OWE_AMOUNT }] },
        },
      });
    }

    // c2Priv stale: no interaction for 30 days, its stored score and last interaction already the ones
    // CrmStatsService.attachContactStats works out, so no read rewrites the row (and its updatedAt).
    const stale = new Date(Date.now() - 30 * 86_400_000);
    await db.$executeRawUnsafe('UPDATE contacts SET updated_at = $1, last_interaction_at = $1, lead_score = 55 WHERE id = $2', stale, ID2.cPriv);
  });

  it("SEC-W9MR-1 (D-100) (W9-MONEY-RANKING review): GET .../highlights picks that member's high-potential cards from the contacts they may open: another member's PRIVATE contact (GET contacts/:c 404, not in GET contacts) is never a card, whatever its money-free score; the owner's cards keep it", async () => {
    expect((await call2(ID.noRev, `contacts/${ID2.cPriv}`)).status).toBe(404);
    const listed = ((await ok2(ID.noRev, 'contacts')).contacts as Array<{ id: string }>).map((c) => c.id);
    expect(listed).not.toContain(ID2.cPriv);
    expect(listed).toHaveLength(7);

    const withheld = await ok2(ID.noRev, 'highlights');
    const cards = withheld.highlights.highPotential as Array<Record<string, any>>;
    // Money-free: each owing LEAD 50 (no -5 unpaid term), c2Task 45 (its overdue task); c2Priv (CLIENT, 55) would lead.
    expect(cards.map((card) => card.contactId)).toEqual(OWE_NEWEST_FIRST.slice(0, 4));
    for (const card of cards) {
      expect(listed, card.contactId).toContain(card.contactId);
      expect(card.leadScore, card.contactId).toBe(50);
      expect([card.outstandingBalance, card.unpaidInvoices], card.contactId).toEqual([0, 0]);
    }
    expect(JSON.stringify(withheld.highlights)).not.toContain('PrivateSecretName');
    expect(JSON.stringify(withheld.highlights)).not.toContain(ID2.cPriv);

    // Control: the owner may open c2Priv, and their cards rank it first (stored: c2Priv 55, each owing LEAD 45).
    const owner = await ok2(ID.owner, 'highlights');
    expect((owner.highlights.highPotential as Array<{ contactId: string }>).map((card) => card.contactId)).toEqual([ID2.cPriv, ...OWE_NEWEST_FIRST.slice(0, 3)]);
    expect(owner.highlights.highPotential[0].name).toBe(PRIVATE_NAME);
  });

  it("SEC-W9MR-2 (D-100) (W9-MONEY-RANKING review): GET .../highlights works out that member's next actions with no invoice follow-up before the cap of 6, so unpaid invoices of newer contacts do not push their other actions out (the actions they see do not tell who owes), from the contacts they may open (not c2Priv's stale-contact action); the owner and a member with revenue read get the 6 invoice follow-ups", async () => {
    const withheld = await ok2(ID.noRev, 'highlights');
    expect((withheld.nextActions as Array<{ id: string }>).map((action) => action.id)).toEqual([`${ID2.cTask}-task-overdue`, `${ID2.cTask}-task`]);
    expect(JSON.stringify(withheld.nextActions)).not.toContain(ID2.cPriv);

    for (const user of [ID.owner, ID.rev]) {
      const full = await ok2(user, 'highlights');
      expect((full.nextActions as Array<{ id: string }>).map((action) => action.id), user).toEqual(OWE_NEWEST_FIRST.map((id) => `${id}-invoice`));
      expect((full.nextActions as Array<{ trigger: string }>).every((action) => action.trigger === 'invoice-unpaid'), user).toBe(true);
    }
  });

  it("SEC-W9MR-2 (D-100) (W9-MONEY-RANKING review): GET .../highlights cuts that member's timeline to 20 entries after its invoice rows are left out, so the six newer invoices do not push task and note rows out (all 16 are served); the owner's and a revenue-read member's timeline keep the invoice rows within their 20", async () => {
    const withheld = await ok2(ID.noRev, 'highlights');
    const timeline = withheld.timeline as Array<{ id: string; type: string }>;
    expect(timeline.filter((entry) => entry.type === 'invoice')).toEqual([]);
    expect(timeline.map((entry) => entry.id).sort()).toEqual([...taskIds, ...noteIds].sort());
    expect(JSON.stringify(withheld)).not.toContain(String(OWE_AMOUNT));

    for (const user of [ID.owner, ID.rev]) {
      const full = (await ok2(user, 'highlights')).timeline as Array<{ type: string }>;
      expect(full, user).toHaveLength(20);
      expect(full.slice(0, 6).map((entry) => entry.type), user).toEqual(Array(6).fill('invoice'));
    }
  });

});

// ---- W10-MONEY-SIGNALS-REST (owner rulings D-63, D-100): the highlights residuals ------------------

/**
 * W10-MONEY-SIGNALS-REST, on a third business of this suite (biz3), so the
 * other two keep the orders the cases above pin. Contacts, all the owner's:
 *   c3Team  LEAD, TEAM (older): a SENT invoice (TEAM_OWE, due in 5 days), an overdue task, a note,
 *           one COMPLETED booking of s3 (60 days ago), one non-money ContactEvent (communication.call)
 *           and, newer than it, 11 money-type ContactEvents (invoice.sent);
 *   c3Priv  CLIENT, PRIVATE, no share (newer): a SENT invoice past its due date (PRIV_OWE), an
 *           overdue task, a note, two COMPLETED bookings of s3 (60 days ago). Neither STAFF member
 *           (crm read; revenue 'none' or revenue read) may open it.
 */
const ID3 = {
  biz: `${P}biz3`,
  cTeam: `${P}c3Team`,
  cPriv: `${P}c3Priv`,
  service: `${P}s3`,
  callEvent: `${P}c3ev_call`,
  moneyEvents: Array.from({ length: 11 }, (_, k) => `${P}c3ev_money${String(k).padStart(2, '0')}`),
};
const PRIV_OWE = 913.37;
const TEAM_OWE = 217.43;
const S3_PRICE = 150;
const PRIVATE_NAME3 = 'V94E PrivSecretThree';
const TEAM_NAME3 = 'V94E c3Team';

/** GET /crm/businesses/:biz3/<routePath> as `user`. */
function call3(user: string, routePath: string) {
  return request(app.getHttpServer()).get(`/crm/businesses/${ID3.biz}/${routePath}`).set('x-test-user', user);
}

async function ok3(user: string, routePath: string) {
  const res = await call3(user, routePath);
  expect(res.status, `${user} GET biz3 ${routePath}: ${JSON.stringify(res.body).slice(0, 300)}`).toBe(200);
  return res.body;
}

type Highlights = {
  highlights: { highPotential: Array<Record<string, any>>; overdueReminders: Array<Record<string, any>>; serviceAffinity: Array<Record<string, any>> };
  segments: Array<{ key: string; count: number; contacts: Array<{ id: string }> }>;
  timeline: Array<{ id: string; type: string; title: string; contactId: string }>;
  nextActions: Array<{ id: string; contactId: string }>;
};

describe('W10-MONEY-SIGNALS-REST: the highlights are worked out from the contacts the viewer may open (D-63, D-100, real DB)', () => {
  const rowsOf = { note: {} as Record<string, string>, task: {} as Record<string, string>, invoice: {} as Record<string, string>, bookings: {} as Record<string, string[]> };

  beforeAll(async () => {
    await db.business.create({ data: { id: ID3.biz, name: 'V94E Biz3', ownerId: ID.owner, metaData: { features: { ai_tools: true } } } });
    await db.membership.create({ data: { id: `${P}m3_owner`, userId: ID.owner, businessId: ID3.biz, role: 'OWNER' } });
    await db.membership.create({ data: { id: `${P}m3_noRev`, userId: ID.noRev, businessId: ID3.biz, role: 'STAFF', permissionScopes: { crm: 'read', revenue: 'none' } } });
    await db.membership.create({ data: { id: `${P}m3_rev`, userId: ID.rev, businessId: ID3.biz, role: 'STAFF', permissionScopes: { crm: 'read', revenue: 'read' } } });
    await db.service.create({ data: { id: ID3.service, name: 'V94E service three', duration: 60, price: S3_PRICE, businessId: ID3.biz } });

    const now = Date.now();
    const ago = (minutes: number) => new Date(now - minutes * 60_000);
    const contact = (id: string, minutesAgo: number, status: string, extra: Record<string, unknown> = {}) =>
      db.contact.create({
        data: {
          id, businessId: ID3.biz, firstName: 'V94E', lastName: id.slice(P.length), status, visibility: 'TEAM', ownerId: ID.owner,
          email: `${P}${id.slice(P.length).toLowerCase()}@contacts.test`, createdAt: ago(minutesAgo), ...extra,
        },
      });
    await contact(ID3.cTeam, 180, 'LEAD');
    await contact(ID3.cPriv, 170, 'CLIENT', { visibility: 'PRIVATE', lastName: 'PrivSecretThree' });

    const old = new Date(now - 60 * 86_400_000);
    for (const [contactId, amount, dueInDays, bookings] of [[ID3.cTeam, TEAM_OWE, 5, 1], [ID3.cPriv, PRIV_OWE, -3, 2]] as const) {
      const tag = contactId.slice(P.length);
      rowsOf.task[contactId] = `${P}${tag}_task`;
      await db.contactTask.create({
        data: { id: rowsOf.task[contactId], businessId: ID3.biz, contactId, title: `V94E task ${tag}`, dueDate: new Date(now - 86_400_000), createdAt: ago(100) },
      });
      rowsOf.note[contactId] = `${P}${tag}_note`;
      await db.contactNote.create({ data: { id: rowsOf.note[contactId], businessId: ID3.biz, contactId, body: `V94E note ${tag}`, createdAt: ago(95) } });
      rowsOf.invoice[contactId] = `${P}${tag}_inv`;
      await db.invoice.create({
        data: {
          id: rowsOf.invoice[contactId], invoiceNumber: `V94E-${tag}`, status: 'SENT', subtotal: amount, total: amount, currency: 'TTD',
          businessId: ID3.biz, contactId, dueDate: new Date(now + dueInDays * 86_400_000), createdAt: ago(90),
          items: { create: [{ id: `${P}${tag}_inv_item1`, description: `V94E ${tag}`, quantity: 1, unitPrice: amount, total: amount }] },
        },
      });
      rowsOf.bookings[contactId] = [];
      for (let k = 0; k < bookings; k += 1) {
        const bookingId = `${P}${tag}_booking${k}`;
        await db.booking.create({
          data: {
            id: bookingId, businessId: ID3.biz, contactId, serviceId: ID3.service, status: 'COMPLETED',
            startTime: old, endTime: new Date(old.getTime() + 60 * 60_000), createdAt: ago(85 - k),
          },
        });
        rowsOf.bookings[contactId].push(bookingId);
      }
    }

    // c3Team's events: the non-money one first, then 11 newer money-type ones (more than the 10 the timeline reads).
    await db.contactEvent.create({ data: { id: ID3.callEvent, businessId: ID3.biz, contactId: ID3.cTeam, type: 'communication.call', data: {}, source: 'v94e', createdAt: ago(30) } });
    for (const [k, id] of ID3.moneyEvents.entries()) {
      await db.contactEvent.create({ data: { id, businessId: ID3.biz, contactId: ID3.cTeam, type: 'invoice.sent', data: {}, source: 'v94e', createdAt: ago(20 - k) } });
    }
  }, 60_000);

  const ids = (rows: Array<{ contactId: string }>) => rows.map((row) => row.contactId);
  const segmentsByKey = (payload: Highlights) => new Map(payload.segments.map((segment) => [segment.key, segment]));

  it("SEC-W9MR-1 residual (D-63, D-100): GET .../highlights is worked out from the contacts the viewer may open whenever a visibility rule hides some (visibilityClause, the rule GET contacts/:c applies): a member with revenue read is served no high-potential card, overdue reminder, next action, segment contact or count, timeline entry or service-affinity booking of another member's PRIVATE contact, and a member without revenue read no segment contact or count, timeline entry or service-affinity booking of it either; the owner's highlights are unchanged and name it in every part (W10-MONEY-SIGNALS-REST, D-63, was it.todo)", async () => {
    for (const user of [ID.noRev, ID.rev]) expect((await call3(user, `contacts/${ID3.cPriv}`)).status, user).toBe(404);

    // Control: the owner's highlights name c3Priv in every part.
    const owner: Highlights = await ok3(ID.owner, 'highlights');
    expect(ids(owner.highlights.highPotential)).toEqual([ID3.cPriv, ID3.cTeam]);
    expect(ids(owner.highlights.overdueReminders)).toEqual([ID3.cPriv, ID3.cTeam]);
    expect(owner.nextActions.map((action) => action.id)).toEqual(
      [ID3.cPriv, ID3.cTeam].flatMap((id) => [`${id}-invoice`, `${id}-task-overdue`, `${id}-task`]),
    );
    const ownerSegments = segmentsByKey(owner);
    expect([ownerSegments.get('top-clients')!.count, ownerSegments.get('top-clients')!.contacts.map((c) => c.id)]).toEqual([1, [ID3.cPriv]]);
    expect([ownerSegments.get('cold-with-unpaid')!.count, ownerSegments.get('cold-with-unpaid')!.contacts.map((c) => c.id)]).toEqual([2, [ID3.cPriv, ID3.cTeam]]);
    expect(owner.timeline.map((entry) => entry.id)).toEqual(expect.arrayContaining([
      rowsOf.note[ID3.cPriv], rowsOf.task[ID3.cPriv], rowsOf.invoice[ID3.cPriv], ...rowsOf.bookings[ID3.cPriv],
    ]));
    expect(owner.highlights.serviceAffinity).toEqual([{
      serviceId: ID3.service, serviceName: 'V94E service three', bookings: 3, revenue: 3 * S3_PRICE,
      topContact: { id: ID3.cPriv, name: PRIVATE_NAME3, bookings: 2 },
    }]);

    /** The viewer's segments: the owner's keys (but `dropped`), each count and contact list without c3Priv. */
    const expectSegmentsWithoutPrivate = (served: Highlights, why: string, dropped: string[] = []) => {
      expect(served.segments.map((s) => s.key), why).toEqual(owner.segments.map((s) => s.key).filter((key) => !dropped.includes(key)));
      for (const segment of served.segments) {
        const ownerSegment = ownerSegments.get(segment.key)!;
        const ownerIds = ownerSegment.contacts.map((c) => c.id);
        expect(segment.count, `${why} ${segment.key} count`).toBe(ownerSegment.count - (ownerIds.includes(ID3.cPriv) ? 1 : 0));
        expect(segment.contacts.map((c) => c.id), `${why} ${segment.key} contacts`).toEqual(ownerIds.filter((id) => id !== ID3.cPriv));
      }
    };

    // A member with revenue read: every part from c3Team only, its money kept.
    const rev: Highlights = await ok3(ID.rev, 'highlights');
    expect(ids(rev.highlights.highPotential)).toEqual([ID3.cTeam]);
    expect(rev.highlights.highPotential[0].outstandingBalance).toBeCloseTo(TEAM_OWE, 2);
    expect(ids(rev.highlights.overdueReminders)).toEqual([ID3.cTeam]);
    expect(rev.nextActions.map((action) => action.id)).toEqual([`${ID3.cTeam}-invoice`, `${ID3.cTeam}-task-overdue`, `${ID3.cTeam}-task`]);
    expectSegmentsWithoutPrivate(rev, 'revenue read');
    expect([segmentsByKey(rev).get('cold-with-unpaid')!.count, segmentsByKey(rev).get('top-clients')!.count]).toEqual([1, 0]);
    expect(rev.timeline.map((entry) => entry.id)).toEqual(owner.timeline.filter((entry) => entry.contactId !== ID3.cPriv).map((entry) => entry.id));
    expect(rev.timeline.map((entry) => entry.id)).toContain(rowsOf.invoice[ID3.cTeam]);
    expect(rev.highlights.serviceAffinity).toEqual([{
      serviceId: ID3.service, serviceName: 'V94E service three', bookings: 1, revenue: S3_PRICE,
      topContact: { id: ID3.cTeam, name: TEAM_NAME3, bookings: 1 },
    }]);
    expect(JSON.stringify(rev)).not.toContain(ID3.cPriv);
    expect(JSON.stringify(rev)).not.toContain('PrivSecretThree');

    // A member without revenue read: the same contact rule, and no money (D-100).
    const withheld: Highlights = await ok3(ID.noRev, 'highlights');
    expect(ids(withheld.highlights.highPotential)).toEqual([ID3.cTeam]);
    expect(withheld.highlights.overdueReminders).toEqual([]);
    expect(withheld.nextActions.map((action) => action.id)).toEqual([`${ID3.cTeam}-task-overdue`, `${ID3.cTeam}-task`]);
    expectSegmentsWithoutPrivate(withheld, "revenue 'none'", ['cold-with-unpaid']);
    expect(withheld.timeline.length).toBeGreaterThan(0);
    for (const entry of withheld.timeline) expect(entry.contactId, entry.id).toBe(ID3.cTeam);
    expect(withheld.highlights.serviceAffinity).toEqual([{
      serviceId: ID3.service, serviceName: 'V94E service three', bookings: 1, revenue: 0,
      topContact: { id: ID3.cTeam, name: TEAM_NAME3, bookings: 1 },
    }]);
    expect(JSON.stringify(withheld)).not.toContain(ID3.cPriv);
    expect(JSON.stringify(withheld)).not.toContain('PrivSecretThree');
    for (const amount of [PRIV_OWE, TEAM_OWE]) expect(JSON.stringify(withheld)).not.toContain(String(amount));
  });

  it("SEC-W9MR-2 remainder (D-100) (W10-MONEY-SIGNALS-REST): GET .../highlights leaves the money-type ContactEvent rows out of the timeline's event read itself (CrmTimelineService.buildTimeline reads the 10 newest events), so a member without revenue read is served the non-money event the 11 newer invoice.sent events would push out of those 10: that member's timeline is c3Team's call event, note, task and booking; the owner's and a revenue-read member's timeline keep the 10 newest events, all invoice.sent", async () => {
    const withheld: Highlights = await ok3(ID.noRev, 'highlights');
    expect(withheld.timeline.filter((entry) => entry.type === 'event').map((entry) => [entry.id, entry.title])).toEqual([[ID3.callEvent, 'communication.call']]);
    expect(withheld.timeline.map((entry) => entry.id).sort()).toEqual(
      [ID3.callEvent, rowsOf.note[ID3.cTeam], rowsOf.task[ID3.cTeam], ...rowsOf.bookings[ID3.cTeam]].sort(),
    );

    const newestTen = [...ID3.moneyEvents].reverse().slice(0, 10);
    for (const user of [ID.owner, ID.rev]) {
      const full: Highlights = await ok3(user, 'highlights');
      expect(full.timeline.filter((entry) => entry.type === 'event').map((entry) => entry.id), user).toEqual(newestTen);
    }
  });

  // ---- W11-CRM-SEGMENTS-VISIBLE (F-10; owner rulings D-63 and D-100) -------------------------------
  type SegmentCounts = Record<'lead' | 'prospect' | 'client' | 'lost' | 'unpaid' | 'stale' | 'newThisWeek' | 'atRisk' | 'dormant', number>;

  /** The member's visibility clause, by the rule GET contacts/:c applies (resolveCrmAccess + visibilityClause); null for the owner. */
  const clauseOf = async (user: string) => {
    const { resolveCrmAccess, visibilityClause } = await import('../src/modules/crm/crm-permissions.helper');
    return visibilityClause(await resolveCrmAccess({ client: db } as any, ID3.biz, user), user) as Record<string, unknown> | null;
  };

  /** GET .../segments' nine counts, read straight from the database over the live contacts of biz3 that `clause` admits (null: all of them). */
  const directSegmentCounts = async (clause: Record<string, unknown> | null): Promise<SegmentCounts> => {
    const base = clause ? { businessId: ID3.biz, deletedAt: null, AND: [clause] } : { businessId: ID3.biz, deletedAt: null };
    const startOfWeek = new Date();
    startOfWeek.setHours(0, 0, 0, 0);
    const day = startOfWeek.getDay();
    startOfWeek.setDate(startOfWeek.getDate() - day + (day === 0 ? -6 : 1));
    const staleCutoff = new Date();
    staleCutoff.setDate(staleCutoff.getDate() - 30);
    const count = (where: Record<string, unknown>) => db.contact.count({ where: { ...base, ...where } }) as Promise<number>;
    const [lead, prospect, client, lost, unpaid, stale, newThisWeek, atRisk, dormant] = await Promise.all([
      count({ status: 'LEAD' }),
      count({ status: 'PROSPECT' }),
      count({ status: 'CLIENT' }),
      count({ status: 'LOST' }),
      count({ invoices: { some: { status: { in: ['SENT', 'OVERDUE'] }, deletedAt: null } } }),
      count({ createdAt: { lte: staleCutoff }, bookings: { none: { startTime: { gte: staleCutoff }, deletedAt: null } } }),
      count({ createdAt: { gte: startOfWeek } }),
      count({ relationshipHealth: 'AT_RISK' }),
      count({ relationshipHealth: 'DORMANT' }),
    ]);
    return { lead, prospect, client, lost, unpaid, stale, newThisWeek, atRisk, dormant };
  };

  it("F-10: GET .../segments counts only the contacts the member may open (W11-CRM-SEGMENTS-VISIBLE, D-63, D-100): each count is worked out from the contacts the member's visibility clause admits (visibilityClause, the rule GET contacts/:c and GET .../highlights apply), so another member's PRIVATE contact (c3Priv) is not counted, for a member with revenue read too; a member without revenue read is also served unpaid 0 (D-100, SEC-W8MS-3); the owner's counts stay business-wide", async () => {
    // Control: the owner's counts name c3Priv (CLIENT, an overdue SENT invoice) and equal the business-wide counts.
    const owner: SegmentCounts = await ok3(ID.owner, 'segments');
    expect([owner.lead, owner.client, owner.unpaid]).toEqual([1, 1, 2]);
    expect(await clauseOf(ID.owner)).toBeNull();
    expect(owner).toEqual(await directSegmentCounts(null));

    for (const user of [ID.rev, ID.noRev]) {
      // The member cannot open c3Priv and GET contacts lists only c3Team.
      expect((await call3(user, `contacts/${ID3.cPriv}`)).status, user).toBe(404);
      expect(((await ok3(user, 'contacts')).contacts as Array<{ id: string }>).map((c) => c.id), user).toEqual([ID3.cTeam]);
      expect(await clauseOf(user), user).not.toBeNull();
    }

    const rev: SegmentCounts = await ok3(ID.rev, 'segments');
    expect([rev.lead, rev.client, rev.unpaid], 'revenue read').toEqual([1, 0, 1]);
    expect(rev, 'revenue read: every key a direct count over the contacts the member may open').toEqual(await directSegmentCounts(await clauseOf(ID.rev)));

    const withheld: SegmentCounts = await ok3(ID.noRev, 'segments');
    expect([withheld.lead, withheld.client, withheld.unpaid], "revenue 'none'").toEqual([1, 0, 0]);
    expect(withheld, "revenue 'none': every key a direct count over the contacts the member may open, unpaid 0").toEqual({
      ...(await directSegmentCounts(await clauseOf(ID.noRev))),
      unpaid: 0,
    });

    // The two CRM surfaces agree for each viewer: the highlights' new-this-week segment counts what segments' newThisWeek counts.
    for (const [user, served] of [[ID.owner, owner], [ID.rev, rev], [ID.noRev, withheld]] as const) {
      const highlights: Highlights = await ok3(user, 'highlights');
      expect(segmentsByKey(highlights).get('new-this-week')!.count, user).toBe(served.newThisWeek);
    }
  });

  it("F-10: CrmStatsService.segmentSummary named a member works out the counts per request (W11-CRM-SEGMENTS-VISIBLE, D-63): with the owner's payload primed in the business cache under `${businessId}:segmentSummary`, a member is served the member's own counts and the cache is neither read nor written; the owner, and a call naming no viewer, are still served the cached business-wide payload", async () => {
    const { CrmStatsService } = await import('../src/modules/crm/crm-stats.service');
    const key = `${ID3.biz}:segmentSummary`;
    const ownerPayload: SegmentCounts = await ok3(ID.owner, 'segments');
    expect(ownerPayload.client).toBe(1);
    const store = new Map<string, unknown>([[key, ownerPayload]]);
    const reads: string[] = [];
    const writes: string[] = [];
    const recordingCache = {
      get: async (k: string) => { reads.push(k); return store.get(k) ?? null; },
      set: async (k: string, v: unknown) => { writes.push(k); store.set(k, v); },
      invalidate: async () => undefined,
    };
    // segmentSummary reads no timeline.
    const stats = new CrmStatsService({ client: db } as any, {} as any, recordingCache as any);

    for (const user of [ID.rev, ID.noRev]) {
      const served = (await stats.segmentSummary({ businessId: ID3.biz, viewerUserId: user } as any)) as SegmentCounts;
      expect(served, user).toEqual(await directSegmentCounts(await clauseOf(user)));
      expect([served.client, served.unpaid], user).toEqual([0, 1]);
    }
    expect(reads, 'a member call reads no cache entry').toEqual([]);
    expect(writes, 'a member call writes no cache entry').toEqual([]);
    expect(store.get(key)).toEqual(ownerPayload);

    expect(await stats.segmentSummary({ businessId: ID3.biz, viewerUserId: ID.owner } as any), 'owner').toEqual(ownerPayload);
    expect(reads, 'the owner call reads the business cache entry').toEqual([key]);
    expect(await stats.segmentSummary({ businessId: ID3.biz }), 'no viewer').toEqual(ownerPayload);
    expect(reads).toEqual([key, key]);
    expect(writes, 'served from the cache, nothing rewritten').toEqual([]);
  });

  // ---- W11-CRM-SEGMENTS-VISIBLE review repair SEC-W11SV-1 (owner ruling D-133: the CRM count widgets) ----
  describe('W11-CRM-SEGMENTS-VISIBLE review repair: the contact stats and the contacts poll count only the contacts the member may open (D-133)', () => {
    /** A source and a tag only c3Priv carries, a source only c3Team carries, and a tag both carry (set for these cases, cleared after them). */
    const D133 = { privSource: 'v94e-source-priv', teamSource: 'v94e-source-team', privTag: 'v94e-tag-priv', sharedTag: 'v94e-tag-shared' };
    type ContactStats = {
      totalCount: number;
      countByStatus: Record<string, number>;
      countBySource: Array<{ source: string; count: number }>;
      recentGrowth: Array<{ week: string; count: number }>;
      topTags: Array<{ tag: string; count: number }>;
    };
    const bySource = (stats: ContactStats) => stats.countBySource.map((row) => [row.source, row.count]).sort();
    const grown = (stats: ContactStats) => stats.recentGrowth.reduce((sum, week) => sum + week.count, 0);

    beforeAll(async () => {
      await db.contact.update({ where: { id: ID3.cTeam }, data: { source: D133.teamSource, tags: [D133.sharedTag] } });
      await db.contact.update({ where: { id: ID3.cPriv }, data: { source: D133.privSource, tags: [D133.privTag, D133.sharedTag] } });
    });
    afterAll(async () => {
      for (const id of [ID3.cTeam, ID3.cPriv]) await db.contact.update({ where: { id }, data: { source: null, tags: [] } });
    });

    it("SEC-W11SV-1 (D-133) (W11-CRM-SEGMENTS-VISIBLE review): GET .../contact-stats counts only the contacts the member may open: a member with crm read (revenue read or 'none') is served totalCount, countByStatus, countBySource, recentGrowth and topTags without another member's PRIVATE contact (c3Priv: CLIENT, a source and a tag of its own), so its status counts agree with GET .../segments; the owner's stats stay business-wide and name it", async () => {
      // Control: the owner's stats count c3Priv everywhere.
      const owner: ContactStats = await ok3(ID.owner, 'contact-stats');
      expect(owner.totalCount).toBe(2);
      expect(owner.countByStatus).toEqual({ LEAD: 1, PROSPECT: 0, CLIENT: 1, LOST: 0 });
      expect(bySource(owner)).toEqual([[D133.privSource, 1], [D133.teamSource, 1]]);
      expect(owner.topTags).toEqual([{ tag: D133.sharedTag, count: 2 }, { tag: D133.privTag, count: 1 }]);
      expect(grown(owner)).toBe(2);
      expect(owner.recentGrowth).toHaveLength(6);

      const privCreatedAt = (await db.contact.findUniqueOrThrow({ where: { id: ID3.cPriv }, select: { createdAt: true } })).createdAt.getTime();
      for (const user of [ID.rev, ID.noRev]) {
        expect((await call3(user, `contacts/${ID3.cPriv}`)).status, user).toBe(404);
        const served: ContactStats = await ok3(user, 'contact-stats');
        expect(served.totalCount, user).toBe(1);
        expect(served.countByStatus, user).toEqual({ LEAD: 1, PROSPECT: 0, CLIENT: 0, LOST: 0 });
        expect(bySource(served), user).toEqual([[D133.teamSource, 1]]);
        expect(served.topTags, user).toEqual([{ tag: D133.sharedTag, count: 1 }]);
        // The owner's six weeks, each without c3Priv in the week it was created.
        expect(served.recentGrowth.map((week) => week.week), user).toEqual(owner.recentGrowth.map((week) => week.week));
        for (const [k, week] of served.recentGrowth.entries()) {
          const start = new Date(week.week);
          const end = new Date(start);
          end.setDate(end.getDate() + 7);
          const holdsPriv = privCreatedAt >= start.getTime() && privCreatedAt < end.getTime();
          expect(week.count, `${user} ${week.week}`).toBe(owner.recentGrowth[k].count - (holdsPriv ? 1 : 0));
        }
        expect(grown(served), user).toBe(1);
        // The finding's comparison: the two CRM count routes agree for the member.
        const segments = await ok3(user, 'segments');
        expect([served.countByStatus.LEAD, served.countByStatus.PROSPECT, served.countByStatus.CLIENT, served.countByStatus.LOST], user)
          .toEqual([segments.lead, segments.prospect, segments.client, segments.lost]);
        expect(JSON.stringify(served), user).not.toContain(D133.privSource);
        expect(JSON.stringify(served), user).not.toContain(D133.privTag);
      }
    });

    it("SEC-W11SV-1 (D-133): CrmStatsService.getContactStats named a member works out the stats per request: with the owner's payload primed in the business cache under `${businessId}:getContactStats`, a member is served the member's own stats and the cache is neither read nor written; the owner, and a call naming no viewer, are still served the cached business-wide payload", async () => {
      const { CrmStatsService } = await import('../src/modules/crm/crm-stats.service');
      const key = `${ID3.biz}:getContactStats`;
      const ownerPayload: ContactStats = await ok3(ID.owner, 'contact-stats');
      expect([ownerPayload.totalCount, ownerPayload.countByStatus.CLIENT]).toEqual([2, 1]);
      const store = new Map<string, unknown>([[key, ownerPayload]]);
      const reads: string[] = [];
      const writes: string[] = [];
      const recordingCache = {
        get: async (k: string) => { reads.push(k); return store.get(k) ?? null; },
        set: async (k: string, v: unknown) => { writes.push(k); store.set(k, v); },
        invalidate: async () => undefined,
      };
      // getContactStats reads no timeline.
      const stats = new CrmStatsService({ client: db } as any, {} as any, recordingCache as any);

      for (const user of [ID.rev, ID.noRev]) {
        const served = (await stats.getContactStats(ID3.biz, user)) as ContactStats;
        expect([served.totalCount, served.countByStatus.LEAD, served.countByStatus.CLIENT], user).toEqual([1, 1, 0]);
        expect(bySource(served), user).toEqual([[D133.teamSource, 1]]);
        expect(served.topTags, user).toEqual([{ tag: D133.sharedTag, count: 1 }]);
      }
      expect(reads, 'a member call reads no cache entry').toEqual([]);
      expect(writes, 'a member call writes no cache entry').toEqual([]);
      expect(store.get(key)).toEqual(ownerPayload);

      expect(await stats.getContactStats(ID3.biz, ID.owner), 'owner').toEqual(ownerPayload);
      expect(reads, 'the owner call reads the business cache entry').toEqual([key]);
      expect(await stats.getContactStats(ID3.biz), 'no viewer').toEqual(ownerPayload);
      expect(reads).toEqual([key, key]);
      expect(writes, 'served from the cache, nothing rewritten').toEqual([]);
    });

    it("SEC-W11SV-1 (D-133): GET .../contacts/poll counts and dates only the contacts the member may open: a member's totalCount leaves c3Priv out and its lastUpdatedAt is c3Team's edit, not c3Priv's later one (which would tell the member a hidden contact changed); the owner's poll stays business-wide (both contacts, c3Priv's edit)", async () => {
      const teamAt = new Date(Date.now() - 10 * 60_000);
      const privAt = new Date(Date.now() - 60_000);
      await db.contact.update({ where: { id: ID3.cTeam }, data: { updatedAt: teamAt } });
      await db.contact.update({ where: { id: ID3.cPriv }, data: { updatedAt: privAt } });

      expect(await ok3(ID.owner, 'contacts/poll')).toEqual({ lastUpdatedAt: privAt.toISOString(), totalCount: 2 });
      for (const user of [ID.rev, ID.noRev]) {
        expect((await call3(user, `contacts/${ID3.cPriv}`)).status, user).toBe(404);
        expect(await ok3(user, 'contacts/poll'), user).toEqual({ lastUpdatedAt: teamAt.toISOString(), totalCount: 1 });
      }
    });
  });

  // ---- W11-CRM-COUNTS-RULING (owner ruling D-133, option (a): the CRM count widgets are per viewer) ----
  describe("W11-CRM-COUNTS-RULING: the contact stats and the contacts poll follow the viewer's contact visibility (owner ruling D-133, option (a))", () => {
    /** contact-stats' totalCount and countByStatus, read straight from the database over the live contacts of biz3 that `clause` admits (null: all of them). */
    const directStatusCounts = async (clause: Record<string, unknown> | null) => {
      const where = clause ? { businessId: ID3.biz, deletedAt: null, AND: [clause] } : { businessId: ID3.biz, deletedAt: null };
      const countByStatus: Record<string, number> = { LEAD: 0, PROSPECT: 0, CLIENT: 0, LOST: 0 };
      for (const status of Object.keys(countByStatus)) countByStatus[status] = await db.contact.count({ where: { ...where, status } });
      return { totalCount: (await db.contact.count({ where })) as number, countByStatus };
    };
    const updatedAtOf = async (id: string) => ((await db.contact.findUniqueOrThrow({ where: { id }, select: { updatedAt: true } })).updatedAt as Date);
    const EDITED_JOB_TITLE = 'V94E edited by the owner';

    afterAll(async () => {
      // The owner's edit below (PATCH contacts/:c) is undone; its event and audit rows go with the suite's cleanup.
      await db.contact.update({ where: { id: ID3.cPriv }, data: { jobTitle: null } });
    });

    it("W11-CRM-COUNTS-RULING (D-133): GET .../contact-stats as each STAFF member (crm read; revenue read and revenue 'none') counts only the contacts that member may open: totalCount 1 and countByStatus.CLIENT 0, c3Priv (CLIENT, another member's PRIVATE contact) left out, each equal to a direct count under the member's visibility clause, in the owner's response shape; the owner's stats stay business-wide: totalCount 2 and countByStatus.CLIENT 1", async () => {
      // Control: the owner (no visibility clause) is served the business-wide figures, c3Priv counted.
      const owner = await ok3(ID.owner, 'contact-stats');
      expect([owner.totalCount, owner.countByStatus.CLIENT], 'owner').toEqual([2, 1]);
      expect(await clauseOf(ID.owner)).toBeNull();
      expect({ totalCount: owner.totalCount, countByStatus: owner.countByStatus }, 'owner').toEqual(await directStatusCounts(null));

      for (const user of [ID.rev, ID.noRev]) {
        // The member cannot open c3Priv.
        expect((await call3(user, `contacts/${ID3.cPriv}`)).status, user).toBe(404);
        const served = await ok3(user, 'contact-stats');
        expect([served.totalCount, served.countByStatus.CLIENT], user).toEqual([1, 0]);
        expect({ totalCount: served.totalCount, countByStatus: served.countByStatus }, user).toEqual(await directStatusCounts(await clauseOf(user)));
        // D-133 changes the figures, not the response shape.
        expect(Object.keys(served).sort(), user).toEqual(Object.keys(owner).sort());
        expect(served.recentGrowth, user).toHaveLength(owner.recentGrowth.length);
      }
    });

    it("W11-CRM-COUNTS-RULING (D-133): GET .../contacts/poll as a STAFF member stays at totalCount 1 and the same lastUpdatedAt after the owner edits c3Priv through PATCH contacts/:c, so the poll never wakes the member on a contact they cannot open; the owner's poll moves to that edit (totalCount 2, c3Priv's new updatedAt)", async () => {
      const ownerBefore = await ok3(ID.owner, 'contacts/poll');
      expect(ownerBefore.totalCount, 'owner before').toBe(2);
      const memberBefore = new Map<string, unknown>();
      for (const user of [ID.rev, ID.noRev]) {
        const served = await ok3(user, 'contacts/poll');
        // The member's poll dates c3Team, the one contact they may open.
        expect(served, user).toEqual({ lastUpdatedAt: (await updatedAtOf(ID3.cTeam)).toISOString(), totalCount: 1 });
        memberBefore.set(user, served);
      }

      // The owner edits c3Priv through the real route (crm write, the contact's owner).
      const edit = await request(app.getHttpServer())
        .patch(`/crm/businesses/${ID3.biz}/contacts/${ID3.cPriv}`)
        .set('x-test-user', ID.owner)
        .send({ jobTitle: EDITED_JOB_TITLE });
      expect(edit.status, `owner PATCH c3Priv: ${JSON.stringify(edit.body).slice(0, 300)}`).toBe(200);
      const privEditedAt = await updatedAtOf(ID3.cPriv);
      expect(privEditedAt.getTime(), 'the edit moved c3Priv').toBeGreaterThan(new Date(ownerBefore.lastUpdatedAt).getTime());

      // The owner's poll moves to the edit; each member's poll is exactly what it was.
      expect(await ok3(ID.owner, 'contacts/poll'), 'owner after').toEqual({ lastUpdatedAt: privEditedAt.toISOString(), totalCount: 2 });
      for (const user of [ID.rev, ID.noRev]) {
        expect(await ok3(user, 'contacts/poll'), `${user} after the owner's edit`).toEqual(memberBefore.get(user));
      }
    });
  });
});

// ---- W10-MONEY-SIGNALS-REST review repair SEC-W10MSR-1: a fourth business (biz4) ----
const ID4 = {
  biz: `${P}biz4`,
  cTeam: `${P}c4Team`,
  callEvent: `${P}c4ev_call`,
  moneyEvents: Array.from({ length: 11 }, (_, k) => `${P}c4ev_money${String(k).padStart(2, '0')}`),
};
/**
 * ContactEvent types outside the sales_revenue category whose rows here carry
 * an amount in data (a MONEY_DATA_FIELDS field, which crmRowCarriesMoney reads),
 * so the feed rule withholds them from a member without revenue read.
 */
const DATA_MONEY_TYPES = ['payment.completed', 'store_order.paid', 'store_order.refunded', 'autopilot.payment_recovery'];
const EVENT_AMOUNT = 777.31;

async function ok4(user: string, routePath: string) {
  const res = await request(app.getHttpServer()).get(`/crm/businesses/${ID4.biz}/${routePath}`).set('x-test-user', user);
  expect(res.status, `${user} GET biz4 ${routePath}: ${JSON.stringify(res.body).slice(0, 300)}`).toBe(200);
  return res.body;
}

describe('W10-MONEY-SIGNALS-REST review repair: the highlights timeline judges each ContactEvent by the feed rule (D-100, D-90, D-63, real DB)', () => {
  beforeAll(async () => {
    await db.business.create({ data: { id: ID4.biz, name: 'V94E Biz4', ownerId: ID.owner, metaData: { features: { ai_tools: true } } } });
    await db.membership.create({ data: { id: `${P}m4_owner`, userId: ID.owner, businessId: ID4.biz, role: 'OWNER' } });
    await db.membership.create({ data: { id: `${P}m4_noRev`, userId: ID.noRev, businessId: ID4.biz, role: 'STAFF', permissionScopes: { crm: 'read', revenue: 'none' } } });
    await db.membership.create({ data: { id: `${P}m4_rev`, userId: ID.rev, businessId: ID4.biz, role: 'STAFF', permissionScopes: { crm: 'read', revenue: 'read' } } });

    const now = Date.now();
    const ago = (minutes: number) => new Date(now - minutes * 60_000);
    await db.contact.create({
      data: {
        id: ID4.cTeam, businessId: ID4.biz, firstName: 'V94E', lastName: 'c4Team', status: 'LEAD', visibility: 'TEAM', ownerId: ID.owner,
        email: `${P}c4team@contacts.test`, createdAt: ago(180),
      },
    });
    // c4Team's events: the non-money one first, then 11 newer ones (more than the 10 the timeline reads)
    // whose type is no sales_revenue type but whose data carries an amount.
    await db.contactEvent.create({ data: { id: ID4.callEvent, businessId: ID4.biz, contactId: ID4.cTeam, type: 'communication.call', data: {}, source: 'v94e', createdAt: ago(30) } });
    for (const [k, id] of ID4.moneyEvents.entries()) {
      await db.contactEvent.create({
        data: {
          id, businessId: ID4.biz, contactId: ID4.cTeam, type: DATA_MONEY_TYPES[k % DATA_MONEY_TYPES.length],
          data: { amount: EVENT_AMOUNT, currency: 'TTD' }, source: 'v94e', createdAt: ago(20 - k),
        },
      });
    }
  }, 60_000);

  it("SEC-W10MSR-1 (D-100, D-90, D-63) (W10-MONEY-SIGNALS-REST review): GET .../highlights serves a member without revenue read no ContactEvent the feed rule withholds from them (canReadActivityRow: a crm row whose data carries an amount, whatever its type, e.g. payment.completed, store_order.paid, store_order.refunded, autopilot.payment_recovery), exactly as GET contacts/:c/events withholds them, and those rows take none of the timeline's 10 event places: that member's timeline is c4Team's call event; the owner's and a revenue-read member's timeline keep the 10 newest events", async () => {
    const newestFirst = [...ID4.moneyEvents].reverse();

    // The feed rule, as GET contacts/:c/events applies it (W6-CONTACT-EVENTS-MONEY): the owner reads every
    // event, the member without revenue read the call event only.
    const ownerEvents = (await ok4(ID.owner, `contacts/${ID4.cTeam}/events`)) as Array<{ id: string; type: string }>;
    expect(ownerEvents.map((event) => event.id)).toEqual([...newestFirst, ID4.callEvent]);
    expect(new Set(ownerEvents.map((event) => event.type))).toEqual(new Set([...DATA_MONEY_TYPES, 'communication.call']));
    const withheldEvents = (await ok4(ID.noRev, `contacts/${ID4.cTeam}/events`)) as Array<{ id: string }>;
    expect(withheldEvents.map((event) => event.id)).toEqual([ID4.callEvent]);

    // The highlights timeline judges the events by the same rule.
    const withheld: Highlights = await ok4(ID.noRev, 'highlights');
    expect(withheld.timeline.map((entry) => [entry.id, entry.type, entry.title])).toEqual([[ID4.callEvent, 'event', 'communication.call']]);
    const text = JSON.stringify(withheld);
    for (const id of ID4.moneyEvents) expect(text).not.toContain(id);
    for (const type of DATA_MONEY_TYPES) expect(text).not.toContain(type);
    expect(text).not.toContain(String(EVENT_AMOUNT));

    for (const user of [ID.owner, ID.rev]) {
      const full: Highlights = await ok4(user, 'highlights');
      expect(full.timeline.filter((entry) => entry.type === 'event').map((entry) => entry.id), user).toEqual(newestFirst.slice(0, 10));
    }
  });
});
