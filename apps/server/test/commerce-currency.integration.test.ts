/**
 * V1-37-DM-CURRENCY — currency integrity (REAL database, REAL routes behind the
 * real AuthGuard / BusinessGuard / ModuleScopeGuard, REAL ledger door, REAL
 * trial balance).
 *
 * CF-38 and M23 (docs/reconstruction/BUILD-MAP-001.md); owner ruling D-13: one
 * currency per business, documents defaulting to the business currency; TTD
 * and USD supported. P0-7 (local currency) and the "no heterogeneous sum"
 * invariant were violated on the cockpit and billing surfaces:
 *
 *   - CommerceService wrote the literal 'TTD' when a document named no
 *     currency (createInvoiceForService commerce.service.ts:311, createInvoice
 *     :470, createQuote :1828 at the V1-36 head; the packet cited :187, :282,
 *     :1363 of an older head), so a USD business's invoices were TTD;
 *   - CommerceStatsService summed TTD and USD invoices into one figure, and so
 *     did getCampaignRevenue;
 *   - PostingService wrote 'TTD' for a posting that named no currency and
 *     accepted any currency at all, whatever the business keeps;
 *   - LedgerBalanceService.getTrialBalance grouped by account only, adding a
 *     USD debit to a TTD debit on the same account.
 *
 * Contract pinned here (RED-BEFORE marks a case that fails at the V1-36 head):
 *
 *   CUR-01 RED-BEFORE POST invoice on a USD business with no currency -> USD (response and row)
 *   CUR-02 an explicit currency wins (TTD on the USD business), upper-cased; an unsupported one
 *          (EUR, not D-13 and not the business currency) -> 400, nothing written (RED-BEFORE: 201 EUR)
 *   CUR-03 RED-BEFORE POST quote and createInvoiceForService (service and deposit invoices) on the
 *          USD business with no currency -> USD
 *   CUR-04 RED-BEFORE GET stats (real route): byCurrency {TTD, USD}; the top-level figures are the
 *          business currency's bucket; no figure adds TTD and USD
 *   CUR-05 RED-BEFORE campaign revenue: per currency, the top level in the business currency
 *   CUR-06 the door (real PostingService): RED-BEFORE no currency -> the business currency (USD);
 *          RED-BEFORE a sourceless TTD posting on the USD business -> 400, nothing written;
 *          RED-BEFORE EUR -> 400, nothing written; control: the TTD invoice issued and paid
 *          through the real routes on the USD business posts in TTD (document currency wins,
 *          V1-15 TB-01)
 *   CUR-07 LEDGER RED-BEFORE trial balance by currency: every row carries a currency; per currency
 *          sum(debit) = sum(credit) and equals Postgres' own per-(account, currency) sums; an
 *          account with no activity reads once, in the business currency; another tenant's
 *          rows never appear
 *
 * Review repairs (V1-37 review):
 *
 *   CUR-04b (RV37-03) the top-level invoiceStatusBreakdown counts every invoice (counts are not
 *          money); its totals stay in the business currency
 *   CUR-08 (ST-V37-1) the currency of an issued invoice is fixed: PATCH {currency} on a SENT or
 *          OVERDUE invoice -> 409, nothing written; restating the stored currency stays allowed;
 *          a DRAFT may still change; the payment then posts in the invoice's own currency and
 *          its receivable closes in that currency
 *   CUR-09 (RV37-05) an expense in a currency the door refuses (EUR on a TTD business) fails
 *          closed: 400 and no expense row, no ledger row (the posting runs inside the create)
 *   it.todo: the findings whose repair lies outside the V1-37 write set (ST-V37-2, ST-V37-3 /
 *          RV37-01, RV37-02, RV37-04), each with its reason
 *
 * Nothing on the boundary is mocked: PrismaService, AuthGuard, BusinessGuard,
 * ModuleScopeGuard, PlanLimitGuard (plan answer stubbed), CommerceService,
 * CommerceStatsService, InvoiceWorkflowService, RevenuePostingService,
 * PostingService, AccountingPeriodService, ChartOfAccountsSeederService and
 * LedgerBalanceService read and write real rows, and the production
 * GlobalHttpExceptionFilter + ValidationPipe are installed. Identity
 * attachment is the one stand-in: a test middleware reads `x-v37a-user`, loads
 * that seeded user row and attaches `{ id, email, role }` exactly as the
 * Supabase-verifying AuthMiddleware would. EventEmitter2, the contact timeline
 * (CrmService), TimelineService, CommerceAiService and the AI / Gmail / Drive
 * services are stubs off the boundary; ExpensePostingService (COGS) is a no-op
 * stub (no product lines here).
 *
 * Fixtures: prefix `v37a_` (registered in test/helpers/fixture-prefixes.json);
 * hard-deleted by raw SQL (patterns built by sqlLikePrefix) in dependency order
 * in beforeAll and afterAll; no $transaction wrapping. Rows the server creates
 * get server ids under the prefixed businesses and are deleted through them.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v37a_';
const HEADER = 'x-v37a-user';

const ID = {
  owner: `${P}owner`,
  ownerT: `${P}ownerT`,
  bizUsd: `${P}bizUsd`, // currency USD, ACCRUAL: issuing posts AR
  bizTtd: `${P}bizTtd`, // currency TTD: the stats and campaign fixtures
  contactU: `${P}contactU`,
  contactT: `${P}contactT`,
  campaign: `${P}campaign`,
};

let db: any;
let app: any;
let redis: any;
let commerce: any;
let posting: any;
let coa: any;
let ledgerBalance: any;
let expenses: any;

const eventStub = {
  emit: () => true,
  emitAsync: async () => [],
  on: () => undefined,
  off: () => undefined,
  once: () => undefined,
  removeListener: () => undefined,
};

async function cleanup() {
  for (const sql of [
    `DELETE FROM ledger_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM financial_transactions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payments WHERE business_id LIKE ${sqlLikePrefix(P)} OR invoice_id IN (SELECT id FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM payment_links WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM quote_items WHERE quote_id IN (SELECT id FROM quotes WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM quotes WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM email_campaigns WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM expenses WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM chart_of_accounts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM team_activity_logs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

function agent() {
  return request(app.getHttpServer());
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Invoice numbers default to INV-<ms>, unique per tenant: space the creates. */
async function createInvoice(biz: string, as: string, body: Record<string, unknown>) {
  await sleep(3);
  return agent().post(`/commerce/businesses/${biz}/invoices`).set(HEADER, as).send(body);
}
function issue(biz: string, as: string, invoiceId: string) {
  return agent().patch(`/commerce/invoices/${invoiceId}/status/sent`).set(HEADER, as).send({ businessId: biz, status: 'SENT' });
}
function pay(biz: string, as: string, invoiceId: string, amount: number) {
  return agent().post(`/commerce/businesses/${biz}/invoices/${invoiceId}/payments`).set(HEADER, as).send({ amount, method: 'cash' });
}

/** Every number reachable from `value`, with its path. */
function numbersIn(value: any, at = '$'): Array<[string, number]> {
  if (typeof value === 'number') return [[at, value]];
  if (Array.isArray(value)) return value.flatMap((v, i) => numbersIn(v, `${at}[${i}]`));
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([k, v]) => numbersIn(v, `${at}.${k}`));
  return [];
}

/** A balanced posting through the real door (DR CASH / CR OWNER_EQUITY). */
async function postAdjustment(businessId: string, amount: number, over: Record<string, unknown> = {}) {
  const cash = await coa.getBySystemKey(businessId, 'CASH');
  const equity = await coa.getBySystemKey(businessId, 'OWNER_EQUITY');
  return posting.post({
    businessId,
    type: 'ADJUSTMENT',
    date: new Date(Date.now() - 60_000),
    amount,
    description: `v37a adjustment ${amount}`,
    entries: [
      { accountId: cash.id, debit: amount },
      { accountId: equity.id, credit: amount },
    ],
    ...over,
  });
}

async function ledgerCount(businessId: string) {
  const [t, e] = await Promise.all([
    db.financialTransaction.count({ where: { businessId } }),
    db.ledgerEntry.count({ where: { businessId } }),
  ]);
  return { transactions: t, entries: e };
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { ValidationPipe } = await import('@nestjs/common');
  const { EventEmitter2 } = await import('@nestjs/event-emitter');
  const IORedis = (await import('ioredis')).default;
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { PublicRateLimitGuard } = await import('../src/core/guards/public-rate-limit.guard');
  const { REDIS_CLIENT } = await import('../src/core/redis/redis.constants');
  const { TeamAuditInterceptor } = await import('../src/core/interceptors/team-audit.interceptor');
  const { PlanLimitGuard } = await import('../src/modules/subscriptions/plan-limit.guard');
  const { SubscriptionsService } = await import('../src/modules/subscriptions/subscriptions.service');
  const { CommerceController } = await import('../src/modules/commerce/commerce.controller');
  const { CommerceAiController } = await import('../src/modules/commerce/commerce-ai.controller');
  const { CommerceAiService } = await import('../src/modules/commerce/commerce-ai.service');
  const { CommerceService } = await import('../src/modules/commerce/commerce.service');
  const { CommerceStatsService } = await import('../src/modules/commerce/commerce-stats.service');
  const { InvoiceWorkflowService } = await import('../src/modules/commerce/invoice-workflow.service');
  const { InvoiceReceiptBuilderService } = await import('../src/modules/commerce/invoice-receipt-builder.service');
  const { GmailService } = await import('../src/modules/commerce/gmail.service');
  const { CommerceVisionService } = await import('../src/modules/commerce/commerce-vision.service');
  const { StoreReadinessService } = await import('../src/modules/commerce/store-readiness.service');
  const { PaymentEvidenceService } = await import('../src/modules/commerce/payment-evidence.service');
  const { DocumentIntelligenceService } = await import('../src/modules/ai/document-intelligence.service');
  const { GoogleDriveService } = await import('../src/modules/google-drive/google-drive.service');
  const { TimeEntryService } = await import('../src/modules/time-tracking/time-entry.service');
  const { CatalogService } = await import('../src/modules/catalog/catalog.service');
  const { PublicEventsService } = await import('../src/modules/public-events/public-events.service');
  const { CrmService } = await import('../src/modules/crm/crm.service');
  const { EvidenceService } = await import('../src/modules/evidence/evidence.service');
  const { TaskAssignmentService } = await import('../src/modules/task-assignments/task-assignment.service');
  const { RevenuePostingService } = await import('../src/modules/finance/revenue-posting.service');
  const { PostingService } = await import('../src/modules/finance/posting.service');
  const { AccountingPeriodService } = await import('../src/modules/finance/accounting-period.service');
  const { ChartOfAccountsSeederService } = await import('../src/modules/finance/chart-of-accounts-seeder.service');
  const { LedgerBalanceService } = await import('../src/modules/finance/ledger-balance.service');
  const { ExpensePostingService } = await import('../src/modules/finance/expense-posting.service');
  const { TimelineService } = await import('../src/modules/timeline/timeline.service');
  const { ExpensesService } = await import('../src/modules/expenses/expenses.service');

  redis = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: 2, lazyConnect: false });

  const moduleRef = await Test.createTestingModule({
    controllers: [CommerceController, CommerceAiController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      PublicRateLimitGuard,
      PlanLimitGuard,
      TeamAuditInterceptor,
      { provide: REDIS_CLIENT, useValue: redis },
      CommerceService,
      CommerceStatsService,
      InvoiceWorkflowService,
      InvoiceReceiptBuilderService,
      RevenuePostingService,
      PostingService,
      AccountingPeriodService,
      ChartOfAccountsSeederService,
      LedgerBalanceService,
      { provide: CommerceAiService, useValue: {} },
      { provide: ExpensePostingService, useValue: { onProductSold: async () => null } },
      { provide: EventEmitter2, useValue: eventStub },
      { provide: CrmService, useValue: { logContactEvent: async () => null } },
      { provide: EvidenceService, useValue: {} },
      { provide: TaskAssignmentService, useValue: {} },
      { provide: SubscriptionsService, useValue: { checkLimit: async () => ({ allowed: true }) } },
      { provide: CatalogService, useValue: {} },
      { provide: PublicEventsService, useValue: {} },
      { provide: TimelineService, useValue: { recordEvent: async () => null } },
      { provide: TimeEntryService, useValue: {} },
      { provide: GmailService, useValue: {} },
      { provide: CommerceVisionService, useValue: {} },
      { provide: StoreReadinessService, useValue: {} },
      PaymentEvidenceService,
      { provide: DocumentIntelligenceService, useValue: {} },
      { provide: GoogleDriveService, useValue: {} },
    ],
  }).compile();
  commerce = moduleRef.get(CommerceService);
  posting = moduleRef.get(PostingService);
  coa = moduleRef.get(ChartOfAccountsSeederService);
  ledgerBalance = moduleRef.get(LedgerBalanceService);
  // CUR-09: the real expense create (row + posting in one transaction) over the
  // real expense-posting recipes and the real ledger door. Only the event bus
  // and the timeline are stubs.
  expenses = new ExpensesService(
    moduleRef.get(PrismaService),
    eventStub as any,
    new ExpensePostingService(moduleRef.get(PrismaService), posting, coa),
    { recordEvent: async () => null } as any,
    posting,
  );

  app = moduleRef.createNestApplication();
  // Identity attachment only. No guard is overridden.
  app.use(async (req: any, _res: any, next: any) => {
    const header = req.headers[HEADER];
    const id = typeof header === 'string' ? header : undefined;
    if (id && id.startsWith(P)) {
      const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
      if (user) req.user = { id: user.id, email: user.email, role: user.role };
    }
    next();
  });
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();

  await cleanup(); // in case a prior run aborted

  for (const [user, biz, currency, contact, tag] of [
    [ID.owner, ID.bizUsd, 'USD', ID.contactU, 'usd'],
    [ID.ownerT, ID.bizTtd, 'TTD', ID.contactT, 'ttd'],
  ] as const) {
    await db.user.create({ data: { id: user, email: `${P}owner-${tag}@test.local`, role: 'USER' } });
    await db.business.create({
      data: { id: biz, name: `V37A ${currency}`, slug: `${P}biz-${tag}`, ownerId: user, currency, accountingBasis: 'ACCRUAL' },
    });
    await db.membership.create({ data: { id: `${user}_m`, userId: user, businessId: biz, role: 'OWNER' } });
    await db.contact.create({ data: { id: contact, businessId: biz, firstName: 'V37a', lastName: currency, email: `${P}contact-${tag}@test.local` } });
    await coa.ensureDefaults(biz);
  }

  // The TTD business's book: TTD 100 + 15 (last month) paid, USD 250 paid,
  // TTD 40 open, USD 60 overdue. Two of them carry the campaign.
  await db.emailCampaign.create({ data: { id: ID.campaign, businessId: ID.bizTtd, name: 'V37A campaign', subject: 's', body: 'b' } });
  const now = new Date();
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 15, 12);
  const rows: Array<[string, string, string, number, Date | null, Date | null, boolean]> = [
    ['sT1', 'TTD', 'PAID', 100, now, null, true],
    ['sU1', 'USD', 'PAID', 250, now, null, true],
    ['sT2', 'TTD', 'SENT', 40, null, new Date(Date.now() + 10 * 86400_000), false],
    ['sU2', 'USD', 'OVERDUE', 60, null, new Date(Date.now() - 10 * 86400_000), false],
    ['sT3', 'TTD', 'PAID', 15, lastMonth, null, false],
  ];
  for (const [key, currency, status, total, paidAt, dueDate, inCampaign] of rows) {
    const id = `${P}${key}`;
    await db.invoice.create({
      data: {
        id,
        businessId: ID.bizTtd,
        contactId: ID.contactT,
        invoiceNumber: `${P}${key}`,
        status,
        subtotal: total,
        total,
        currency,
        paidAt,
        dueDate,
        campaignId: inCampaign ? ID.campaign : null,
        items: { create: [{ description: `V37A ${currency} work`, quantity: 1, unitPrice: total, total }] },
      },
    });
  }
}, 180_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
  if (redis) await redis.quit().catch(() => undefined);
}, 60_000);

describe('V1-37 business-currency defaults (CF-38, P0-7)', () => {
  it('CUR-01 RED-BEFORE: POST invoice on a USD business with no currency -> a USD invoice (response and row)', async () => {
    const res = await createInvoice(ID.bizUsd, ID.owner, { contactId: ID.contactU, items: [{ description: 'v37a usd work', quantity: 1, unitPrice: 120 }] });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.currency).toBe('USD');
    const row = await db.invoice.findUnique({ where: { id: res.body.id }, select: { currency: true, businessId: true } });
    expect(row).toEqual({ currency: 'USD', businessId: ID.bizUsd });
  }, 30_000);

  it('CUR-02: an explicit currency wins (TTD on the USD business), stored upper-case; an unsupported one (EUR) -> 400 and nothing written', async () => {
    const ttd = await createInvoice(ID.bizUsd, ID.owner, { contactId: ID.contactU, currency: 'TTD', items: [{ description: 'v37a ttd work', quantity: 1, unitPrice: 80 }] });
    expect(ttd.status, JSON.stringify(ttd.body)).toBe(201);
    expect(ttd.body.currency).toBe('TTD');

    const lower = await createInvoice(ID.bizUsd, ID.owner, { contactId: ID.contactU, currency: 'ttd', items: [{ description: 'v37a ttd lower', quantity: 1, unitPrice: 5 }] });
    expect(lower.status, JSON.stringify(lower.body)).toBe(201);
    expect(lower.body.currency).toBe('TTD');
    expect((await db.invoice.findUnique({ where: { id: lower.body.id }, select: { currency: true } })).currency).toBe('TTD');

    const before = await db.invoice.count({ where: { businessId: ID.bizUsd } });
    const eur = await createInvoice(ID.bizUsd, ID.owner, { contactId: ID.contactU, currency: 'EUR', items: [{ description: 'v37a eur work', quantity: 1, unitPrice: 50 }] });
    expect(eur.status, JSON.stringify(eur.body)).toBe(400);
    expect(JSON.stringify(eur.body)).toMatch(/EUR/);
    expect(await db.invoice.count({ where: { businessId: ID.bizUsd } })).toBe(before);
  }, 30_000);

  it('CUR-03 RED-BEFORE: a quote and a service / deposit invoice on the USD business with no currency -> USD', async () => {
    const quote = await agent()
      .post(`/commerce/businesses/${ID.bizUsd}/quotes`)
      .set(HEADER, ID.owner)
      .send({ contactId: ID.contactU, items: [{ description: 'v37a quote line', quantity: 2, unitPrice: 30 }] });
    expect(quote.status, JSON.stringify(quote.body)).toBe(201);
    expect(quote.body.currency).toBe('USD');
    expect((await db.quote.findUnique({ where: { id: quote.body.id }, select: { currency: true } })).currency).toBe('USD');

    const service = { id: `${P}svc`, name: 'V37A consult', price: 90 } as any;
    const full = await commerce.createInvoiceForService(ID.bizUsd, ID.contactU, service);
    expect(full.currency).toBe('USD');
    const deposit = await commerce.createInvoiceForService(ID.bizUsd, ID.contactU, service, { kind: 'DEPOSIT', amountOverride: 30 });
    expect(deposit.currency).toBe('USD');
    expect((await db.invoice.findUnique({ where: { id: deposit.id }, select: { currency: true } })).currency).toBe('USD');

    // The TTD business's defaults are unchanged.
    const ttdQuote = await agent()
      .post(`/commerce/businesses/${ID.bizTtd}/quotes`)
      .set(HEADER, ID.ownerT)
      .send({ contactId: ID.contactT, items: [{ description: 'v37a ttd quote', quantity: 1, unitPrice: 10 }] });
    expect(ttdQuote.status, JSON.stringify(ttdQuote.body)).toBe(201);
    expect(ttdQuote.body.currency).toBe('TTD');
  }, 30_000);
});

describe('V1-37 per-currency figures (no heterogeneous sum)', () => {
  it('CUR-04 RED-BEFORE: GET stats (real route) -> byCurrency {TTD, USD}; the top level is the TTD bucket; nothing adds TTD and USD', async () => {
    const res = await agent().get(`/commerce/businesses/${ID.bizTtd}/stats`).set(HEADER, ID.ownerT);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const s = res.body;
    expect(s.byCurrency, JSON.stringify(s)).toBeDefined();
    expect(Object.keys(s.byCurrency).sort()).toEqual(['TTD', 'USD']);
    expect(s.byCurrency.TTD).toMatchObject({ totalRevenue: 115, outstandingAmount: 40, overdueAmount: 0, monthlyPaid: 100 });
    expect(s.byCurrency.USD).toMatchObject({ totalRevenue: 250, outstandingAmount: 60, overdueAmount: 60, monthlyPaid: 250 });
    expect(s.currency).toBe('TTD');
    expect(s.totalRevenue).toBe(115);
    expect(s.outstandingAmount).toBe(40);
    expect(s.monthlyPaid).toBe(100);
    // RED-BEFORE: totalRevenue 365 (TTD 115 + USD 250), monthlyPaid 350 (100 + 250).
    for (const [where, n] of numbersIn(s)) {
      if (/Count$|\.count$|Rate$|quoteStatusBreakdown/.test(where)) continue;
      expect([365, 350].includes(n), `${where} = ${n} adds TTD and USD`).toBe(false);
    }
    // Another tenant: the USD business reads its own book, labelled USD.
    const u = await agent().get(`/commerce/businesses/${ID.bizUsd}/stats`).set(HEADER, ID.owner);
    expect(u.status, JSON.stringify(u.body)).toBe(200);
    expect(u.body.currency).toBe('USD');
    expect(u.body.byCurrency.USD.totalRevenue).toBe(0);
    expect(u.body.byCurrency.TTD.totalRevenue).toBe(0);
    // ...and cannot read the TTD business's.
    const foreign = await agent().get(`/commerce/businesses/${ID.bizTtd}/stats`).set(HEADER, ID.owner);
    expect(foreign.status).toBe(403);
  }, 30_000);

  it('CUR-04b (review RV37-03): the top-level status breakdown counts every invoice; its totals stay TTD', async () => {
    // The KPI strip, the billing card and the insights tab read the OVERDUE,
    // DRAFT and SENT counts here: the USD OVERDUE invoice is overdue on this
    // TTD business too. Its money stays under byCurrency.USD.
    const res = await agent().get(`/commerce/businesses/${ID.bizTtd}/stats`).set(HEADER, ID.ownerT);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const s = res.body;
    expect(s.invoiceStatusBreakdown).toEqual({
      PAID: { count: 3, total: 115 },
      SENT: { count: 1, total: 40 },
      OVERDUE: { count: 1, total: 0 },
    });
    const counted = Object.values<any>(s.invoiceStatusBreakdown).reduce((n, e) => n + e.count, 0);
    expect(counted).toBe(s.invoiceCount);
    expect(s.byCurrency.USD.invoiceStatusBreakdown).toEqual({ PAID: { count: 1, total: 250 }, OVERDUE: { count: 1, total: 60 } });
  }, 30_000);

  it('CUR-05 RED-BEFORE: campaign revenue is per currency; the top level is the business currency', async () => {
    const r = await commerce.getCampaignRevenue(ID.bizTtd, ID.campaign);
    expect(r.currency).toBe('TTD');
    expect(r.totalRevenue).toBe(100); // TTD only (RED-BEFORE: 350)
    expect(r.byCurrency).toEqual({
      TTD: { totalRevenue: 100, pipelineRevenue: 0, invoiceCount: 1 },
      USD: { totalRevenue: 250, pipelineRevenue: 0, invoiceCount: 1 },
    });
    expect(r.invoiceCount).toBe(2);
  }, 30_000);
});

describe('V1-37 the posting door keeps the D-13 currency policy (real PostingService)', () => {
  it('CUR-06a RED-BEFORE: a posting with no currency on the USD business is written in USD', async () => {
    const res = await postAdjustment(ID.bizUsd, 12, { sourceType: 'V37aFixture', sourceId: `${P}adj-default`, kind: 'adj' });
    const txn = await db.financialTransaction.findUnique({ where: { id: res.transactionId }, include: { entries: true } });
    expect(txn.currency).toBe('USD');
    expect(txn.entries.map((e: any) => e.currency)).toEqual(['USD', 'USD']);
  }, 30_000);

  it('CUR-06b RED-BEFORE: a sourceless TTD posting on the USD business -> 400, nothing written', async () => {
    const before = await ledgerCount(ID.bizUsd);
    await expect(postAdjustment(ID.bizUsd, 7, { currency: 'TTD' })).rejects.toMatchObject({ status: 400 });
    expect(await ledgerCount(ID.bizUsd)).toEqual(before);
  }, 30_000);

  it('CUR-06c RED-BEFORE: an unsupported currency (EUR) -> 400 even with a source document, nothing written', async () => {
    const before = await ledgerCount(ID.bizUsd);
    await expect(
      postAdjustment(ID.bizUsd, 9, { currency: 'EUR', sourceType: 'V37aFixture', sourceId: `${P}adj-eur`, kind: 'adj' }),
    ).rejects.toMatchObject({ status: 400 });
    expect(await ledgerCount(ID.bizUsd)).toEqual(before);
  }, 30_000);

  it('CUR-06d control (V1-15 TB-01): a TTD invoice and a USD invoice on the USD business, issued and paid through the routes, post in their own currencies', async () => {
    for (const [currency, amount] of [['TTD', 80], ['USD', 120]] as const) {
      const created = await createInvoice(ID.bizUsd, ID.owner, {
        contactId: ID.contactU,
        ...(currency === 'TTD' ? { currency } : {}),
        items: [{ description: `v37a ${currency} ledger`, quantity: 1, unitPrice: amount }],
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      expect(created.body.currency).toBe(currency);
      const sent = await issue(ID.bizUsd, ID.owner, created.body.id);
      expect(sent.status, JSON.stringify(sent.body)).toBe(200);
      const paid = await pay(ID.bizUsd, ID.owner, created.body.id, amount);
      expect(paid.status, JSON.stringify(paid.body)).toBe(201);
      const txns = await db.financialTransaction.findMany({
        where: {
          businessId: ID.bizUsd,
          OR: [{ sourceType: 'Invoice', sourceId: created.body.id }, { sourceType: 'Payment', sourceId: paid.body.payment.id }],
        },
        include: { entries: true },
      });
      expect(txns.length, `${currency}: AR on issue + the payment`).toBe(2);
      for (const t of txns) {
        expect(t.currency).toBe(currency);
        expect(new Set(t.entries.map((e: any) => e.currency))).toEqual(new Set([currency]));
      }
    }
  }, 60_000);
});

describe('V1-37 LEDGER: the trial balance is by currency', () => {
  it('CUR-07 RED-BEFORE: every row carries a currency; per currency sum(debit) = sum(credit) and equals Postgres per (account, currency); idle accounts read once in USD', async () => {
    const rows: any[] = await ledgerBalance.getTrialBalance(ID.bizUsd);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(typeof r.currency, `${r.name} carries a currency`).toBe('string');

    const independent: Array<{ account_id: string; currency: string; debit: string; credit: string }> = await db.$queryRawUnsafe(
      `SELECT account_id, currency, SUM(debit)::text AS debit, SUM(credit)::text AS credit
         FROM ledger_entries WHERE business_id = $1 GROUP BY account_id, currency`,
      ID.bizUsd,
    );
    // The book holds both currencies (CUR-06a USD adjustment, CUR-06d TTD and USD invoices).
    expect(new Set(independent.map((r) => r.currency))).toEqual(new Set(['TTD', 'USD']));
    for (const g of independent) {
      const row = rows.find((r) => r.accountId === g.account_id && r.currency === g.currency);
      expect(row, `${g.account_id} ${g.currency} has its own row`).toBeDefined();
      expect(row.debit.toString(), `${g.account_id} ${g.currency} debit`).toBe(String(Number(g.debit)));
      expect(row.credit.toString(), `${g.account_id} ${g.currency} credit`).toBe(String(Number(g.credit)));
      expect(row.net.toString()).toBe(String(Number(g.debit) - Number(g.credit)));
    }

    // Per currency, debits equal credits (and equal Postgres' totals).
    for (const currency of ['TTD', 'USD']) {
      const mine = rows.filter((r) => r.currency === currency);
      const debit = mine.reduce((s, r) => s + Number(r.debit), 0);
      const credit = mine.reduce((s, r) => s + Number(r.credit), 0);
      const pg = independent.filter((r) => r.currency === currency);
      const pgDebit = pg.reduce((s, r) => s + Number(r.debit), 0);
      expect(Math.round(debit * 100), `${currency} debits = credits`).toBe(Math.round(credit * 100));
      expect(Math.round(debit * 100), `${currency} debits = Postgres`).toBe(Math.round(pgDebit * 100));
      expect(debit).toBeGreaterThan(0);
    }
    // AR saw both currencies: two rows, never one mixed figure.
    const ar = await coa.getBySystemKey(ID.bizUsd, 'ACCOUNTS_RECEIVABLE');
    expect(rows.filter((r) => r.accountId === ar.id).map((r) => r.currency).sort()).toEqual(['TTD', 'USD']);

    // An account with no activity reads once, zero, in the business currency.
    const active = new Set(independent.map((r) => r.account_id));
    const idle = rows.filter((r) => !active.has(r.accountId));
    expect(idle.length).toBeGreaterThan(0);
    for (const r of idle) {
      expect(r.currency).toBe('USD');
      expect(rows.filter((x) => x.accountId === r.accountId)).toHaveLength(1);
      expect(Number(r.debit)).toBe(0);
      expect(Number(r.credit)).toBe(0);
    }

    // TENANT: only the USD business's chart rows.
    const own = new Set((await db.chartOfAccount.findMany({ where: { businessId: ID.bizUsd }, select: { id: true } })).map((a: any) => a.id));
    for (const r of rows) expect(own.has(r.accountId), `${r.accountId} belongs to the USD business`).toBe(true);
  }, 30_000);
});

describe('V1-37 review: the currency of an issued invoice is fixed (ST-V37-1)', () => {
  function patchInvoice(invoiceId: string, body: Record<string, unknown>) {
    return agent().patch(`/commerce/businesses/${ID.bizUsd}/invoices/${invoiceId}`).set(HEADER, ID.owner).send(body);
  }

  it('CUR-08a control: a DRAFT invoice may change its currency (the D-13 rule still applies)', async () => {
    const created = await createInvoice(ID.bizUsd, ID.owner, { contactId: ID.contactU, items: [{ description: 'v37a draft switch', quantity: 1, unitPrice: 30 }] });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.status).toBe('DRAFT');
    const ttd = await patchInvoice(created.body.id, { currency: 'ttd' });
    expect(ttd.status, JSON.stringify(ttd.body)).toBe(200);
    expect(ttd.body.currency).toBe('TTD');
    const eur = await patchInvoice(created.body.id, { currency: 'EUR' });
    expect(eur.status, JSON.stringify(eur.body)).toBe(400);
    expect((await db.invoice.findUnique({ where: { id: created.body.id }, select: { currency: true } })).currency).toBe('TTD');
  }, 30_000);

  it('CUR-08b: PATCH {currency} on a SENT invoice whose receivable has posted -> 409, nothing written; the payment posts in USD and the receivable closes in USD', async () => {
    const created = await createInvoice(ID.bizUsd, ID.owner, { contactId: ID.contactU, items: [{ description: 'v37a sent switch', quantity: 1, unitPrice: 100 }] });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.currency).toBe('USD');
    const sent = await issue(ID.bizUsd, ID.owner, created.body.id);
    expect(sent.status, JSON.stringify(sent.body)).toBe(200);

    const before = await ledgerCount(ID.bizUsd);
    const switched = await patchInvoice(created.body.id, { currency: 'TTD', notes: 'v37a should not land' });
    expect(switched.status, JSON.stringify(switched.body)).toBe(409);
    expect(JSON.stringify(switched.body)).toMatch(/currency/i);
    const row = await db.invoice.findUnique({ where: { id: created.body.id }, select: { currency: true, status: true, notes: true } });
    expect(row).toEqual({ currency: 'USD', status: 'SENT', notes: null });
    expect(await ledgerCount(ID.bizUsd)).toEqual(before);

    // Restating the stored currency (any case) is not a change: an edit form may send the whole document.
    const restated = await patchInvoice(created.body.id, { currency: 'usd', notes: 'v37a restated' });
    expect(restated.status, JSON.stringify(restated.body)).toBe(200);
    expect(restated.body.currency).toBe('USD');
    expect(restated.body.notes).toBe('v37a restated');

    const paid = await pay(ID.bizUsd, ID.owner, created.body.id, 100);
    expect(paid.status, JSON.stringify(paid.body)).toBe(201);
    const after = await db.invoice.findUnique({ where: { id: created.body.id }, select: { currency: true, status: true } });
    expect(after).toEqual({ currency: 'USD', status: 'PAID' });

    // The receivable for this invoice nets to zero in USD and never saw TTD.
    const ar = await coa.getBySystemKey(ID.bizUsd, 'ACCOUNTS_RECEIVABLE');
    const arRows: Array<{ currency: string; d: string; c: string }> = await db.$queryRawUnsafe(
      `SELECT le.currency, SUM(le.debit)::text AS d, SUM(le.credit)::text AS c
         FROM ledger_entries le JOIN financial_transactions ft ON ft.id = le.transaction_id
        WHERE le.business_id = $1 AND le.account_id = $2
          AND (ft.source_id = $3 OR ft.source_id IN (SELECT id FROM payments WHERE invoice_id = $3))
        GROUP BY le.currency`,
      ID.bizUsd, ar.id, created.body.id,
    );
    expect(arRows.map((r) => ({ currency: r.currency, d: Number(r.d), c: Number(r.c) }))).toEqual([{ currency: 'USD', d: 100, c: 100 }]);
  }, 60_000);

  it('CUR-08c: PATCH {currency} on an OVERDUE invoice -> 409, nothing written', async () => {
    const created = await createInvoice(ID.bizUsd, ID.owner, { contactId: ID.contactU, items: [{ description: 'v37a overdue switch', quantity: 1, unitPrice: 45 }] });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect((await issue(ID.bizUsd, ID.owner, created.body.id)).status).toBe(200);
    const overdue = await agent()
      .patch(`/commerce/invoices/${created.body.id}/status/overdue`)
      .set(HEADER, ID.owner)
      .send({ businessId: ID.bizUsd, status: 'OVERDUE' });
    expect(overdue.status, JSON.stringify(overdue.body)).toBe(200);
    expect(overdue.body.status).toBe('OVERDUE');

    const switched = await patchInvoice(created.body.id, { currency: 'TTD' });
    expect(switched.status, JSON.stringify(switched.body)).toBe(409);
    expect((await db.invoice.findUnique({ where: { id: created.body.id }, select: { currency: true } })).currency).toBe('USD');
  }, 30_000);
});

describe('V1-37 review: an expense in a refused currency fails closed (RV37-05)', () => {
  it('CUR-09: EUR expense on the TTD business -> 400 and no expense row and no ledger row; a TTD expense posts (control)', async () => {
    const before = await ledgerCount(ID.bizTtd);
    const rowsBefore = await db.expense.count({ where: { businessId: ID.bizTtd } });
    await expect(
      expenses.createExpense({ businessId: ID.bizTtd, description: 'v37a EUR hotel', amount: 20, currency: 'EUR' }),
    ).rejects.toMatchObject({ status: 400 });
    expect(await db.expense.count({ where: { businessId: ID.bizTtd } })).toBe(rowsBefore);
    expect(await ledgerCount(ID.bizTtd)).toEqual(before);

    const ok = await expenses.createExpense({ businessId: ID.bizTtd, description: 'v37a TTD supplies', amount: 20, currency: 'TTD' });
    const txn = await db.financialTransaction.findFirst({ where: { businessId: ID.bizTtd, sourceType: 'Expense', sourceId: ok.id }, include: { entries: true } });
    expect(txn?.currency).toBe('TTD');
    expect(new Set(txn.entries.map((e: any) => e.currency))).toEqual(new Set(['TTD']));
  }, 30_000);
});

describe('V1-37 review findings whose repair lies outside the V1-37 write set', () => {
  it.todo(
    'ST-V37-2: GET /commerce/businesses/:id/stats answers 403 to a member whose revenue scope is none ' +
      '(needs ModuleScopeGuard + @RequireModuleScope(revenue, read) on commerce-ai.controller.ts, outside the write set)',
  );
  it.todo(
    'ST-V37-3 / RV37-01: GET /finance/businesses/:id/trial-balance items carry `currency`, and the web page keys and totals ' +
      'by (accountId, currency) (finance.controller.ts:171 projection and web finance/trial-balance/page.tsx, outside the write set)',
  );
  it.todo(
    'RV37-02: getBalanceSheet lines are one per (account, currency) with their currency, never two unlabelled lines per account ' +
      '(reports/ledger-reporting.service.ts and BooksReportView.tsx, outside the write set)',
  );
  it.todo(
    'RV37-04: applyRules skips (does not abort) a bank row whose currency the posting door refuses (400) and posts the rest ' +
      '(finance/bank-rule.service.ts catch at :236, outside the write set)',
  );
});
