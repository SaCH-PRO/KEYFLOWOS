/**
 * V1-64 (SWP-INV-MONEY-TOTALS; sweep BUG-020, BUG-024) — the money totals count
 * deposits and part payments (REAL database, REAL routes behind the real
 * AuthGuard / BusinessGuard / ModuleScopeGuard).
 *
 * BUG-020: an invoice of 13,723 with a 400 deposit recorded counted nowhere.
 * GET /commerce/businesses/:b/stats (CommerceStatsService.getCommerceStats, the
 * Sales KPI strip, the billing card and Today) summed the totals of PAID
 * invoices as revenue and the totals of SENT / OVERDUE invoices as outstanding,
 * so a PARTIALLY_PAID invoice was neither: revenue 0, outstanding 0. The
 * Executive Summary (GET /businesses/:b/reports/generate, ReportsService) summed
 * the totals of SENT and DRAFT invoices as "Outstanding Receivables": a draft
 * nobody was sent counted as owed, and a part-paid invoice did not.
 *
 * Contract pinned here (owner rulings D-13, D-14, D-57, D-75):
 *   - revenue is the money received net of refunds on the business's own
 *     invoices, read from the invoices' own-tenant Payment rows through the
 *     shared balance contract (balanceOfStoredRows / CASH_NET_PAYMENT_WHERE):
 *     SUCCESSFUL rows in, negative REFUNDED rows out, PENDING and FAILED rows
 *     nothing, a row carrying another businessId nothing (D-75, D-14);
 *   - outstanding is the remaining balance of the SENT, OVERDUE, PARTIALLY_PAID
 *     and PARTIALLY_CREDITED invoices (net of the invoice's own APPLIED credit
 *     notes), never a DRAFT, never below zero; overdue is the part of it past
 *     its due date;
 *   - every money figure is per currency (D-13): the top level is the business
 *     currency's, the others sit under byCurrency;
 *   - the Executive Summary states the same outstanding, which is what the A/R
 *     aging (GET /finance/businesses/:b/receivables/aging) states;
 *   - both reads need revenue:read (D-57) and the caller's own business.
 *
 * RED-BEFORE marks a case that fails on the base (main 5c17e7b4).
 *
 *   MT-01 RED-BEFORE (BUG-020) an invoice of 13,723 issued and a 400 payment
 *         recorded through the real routes -> stats totalRevenue 400,
 *         outstandingAmount 13,323, monthlyPaid 400, this month's revenue 400,
 *         in the TTD bucket and at the top level (RED-BEFORE: 0 / 0)
 *   MT-02 RED-BEFORE a DRAFT is not outstanding: the Executive Summary states
 *         13,323 over 1 invoice (RED-BEFORE: 999, the draft alone); stats never
 *         counted it (control)
 *   MT-03 RED-BEFORE the Executive Summary's outstanding equals the A/R aging's
 *         total and the stats', on a CASH and on an ACCRUAL business
 *   MT-04 RED-BEFORE refunds (D-14): 60 + 40 paid, the 40 refunded through the
 *         real refund route -> that invoice adds 60 to revenue and 40 to
 *         outstanding; a part-paid invoice past its due date adds its remaining
 *         300 to overdue; a fully paid invoice adds its total and nothing owed
 *   MT-05 RED-BEFORE per currency (D-13): a USD invoice of 250 with 100 paid on
 *         the TTD business sits under byCurrency.USD (100 / 150); no TTD figure
 *         moves and no figure adds TTD and USD; the Executive Summary's
 *         outstanding (labelled TTD) does not add the USD 150
 *   MT-06 RED-BEFORE own-tenant rows only (D-75): a SUCCESSFUL row carrying
 *         another businessId on this business's invoice is not its money, in
 *         neither business's figures; the other business reads its own book
 *         and is refused on this business's routes (403)
 *   MT-07 revenue read (D-57): a STAFF member with revenue:none gets 403 and no
 *         figure from stats and from the Executive Summary; a STAFF member with
 *         revenue:read reads the owner's figures; no identity gets 401
 *   MT-08 RED-BEFORE credited and odd rows: a PARTIALLY_CREDITED invoice of 200
 *         with an APPLIED credit note of 50 and 30 paid owes 120 (another
 *         tenant's note on it is not netted); FULLY_CREDITED owes nothing; an
 *         overpaid invoice owes 0, never a negative; a PENDING and a FAILED row
 *         are not money; a legacy positive REFUNDED row nets to nothing
 *   MT-09 contract binding: for every business here stats' revenue is the sum of
 *         balanceOfStoredRows(...).net over its invoices' own-tenant rows, and
 *         outstanding the sum of the credit-aware remaining of its open invoices
 *
 * Review repairs (RED-BEFORE = the packet head 7513180a):
 *   MT-10 RED-BEFORE (COR-2) a PAID invoice that carries no payment row of its
 *         own still counts its total as received, on the day it was paid, as
 *         on the base: the marketplace order writer (CommerceIntegrationService,
 *         INV-ORD-...) still writes such invoices, and no owner ruling says
 *         their money stops being revenue. 250 paid now + 60 paid last month
 *         -> revenue 310, this month 250, last month 60 (the head: 0 / 0 / 0)
 *   MT-11 RED-BEFORE (COR-8a, COR-6, COR-7) the months go by the date of each
 *         payment row: 300 received last month and 150 now on an unpaid
 *         invoice read 300 then 150, each month counting the one invoice money
 *         came in on (the head counted PAID invoices: 0); 100 received last
 *         month and refunded now reads +100 then -100, revenue 0: a month's
 *         figure is the net cash of that month and may be below zero
 *   MT-12 RED-BEFORE (COR-4) the Executive Summary states what is owed in each
 *         currency under outstandingByCurrency (TTD 13,323 and USD 150 on the
 *         TTD business); its headline stays the business currency's
 *   MT-13 (SEC-2) no business named reads nothing: readInvoiceMoney answers no
 *         rows and getCommerceStats is refused, for undefined, '' and a filter
 *         object
 *
 * MT-03's equality with the A/R aging holds on books where both read the same
 * invoices. The aging (ReceivablesService.getAging, outside this packet) reads
 * SENT / PARTIALLY_PAID / OVERDUE / PENDING, adds every currency and does not
 * net credit notes; the packet's rule reads SENT / OVERDUE / PARTIALLY_PAID /
 * PARTIALLY_CREDITED in the business currency, credit-aware. On a book with a
 * PARTIALLY_CREDITED invoice (bizK) or another currency's invoice (bizA after
 * MT-05) the two differ by exactly those invoices (review COR-3, reported).
 *
 * Nothing on the boundary is mocked: PrismaService, AuthGuard, BusinessGuard,
 * ModuleScopeGuard, PlanLimitGuard (plan answer stubbed), CommerceController,
 * CommerceAiController, CommerceService, CommerceStatsService,
 * InvoiceWorkflowService, RevenuePostingService, PostingService,
 * AccountingPeriodService, ChartOfAccountsSeederService, LedgerBalanceService,
 * FinanceController over the real ReceivablesService, ReportsController over
 * the real ReportsService and LedgerReportingService read and write real rows,
 * with the production GlobalHttpExceptionFilter and ValidationPipe installed.
 * Identity attachment is the one stand-in: a test middleware reads
 * `x-v64e-user`, loads that seeded user row and attaches `{ id, email, role }`
 * as the Supabase-verifying AuthMiddleware would. The report's AI narrative
 * (AiUsageService.callAi) answers a fixed text; EventEmitter2, the contact
 * timeline and the AI / Gmail / Drive services are stubs off the boundary.
 *
 * The stats service caches an answer per business for 60 s and no commerce
 * write clears it; each read here clears it first (CommerceStatsService
 * .invalidateCache), so a case reads the rows as they are.
 *
 * Fixtures: prefix `v64e_` (registered in test/helpers/fixture-prefixes.json);
 * hard-deleted by raw SQL (patterns built by sqlLikePrefix) in dependency order
 * in beforeAll and afterAll; no $transaction wrapping. Rows the server creates
 * get server ids under the prefixed businesses and are deleted through them.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

vi.setConfig({ testTimeout: 60_000 });

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v64e_';
const HEADER = 'x-v64e-user';

const ID = {
  ownerA: `${P}ownerA`,
  ownerR: `${P}ownerR`,
  ownerC: `${P}ownerC`,
  ownerK: `${P}ownerK`,
  ownerM: `${P}ownerM`,
  ownerB: `${P}ownerB`,
  staffNone: `${P}staffNone`,
  staffRead: `${P}staffRead`,
  bizA: `${P}bizA`, // CASH, TTD: the BUG-020 book, the draft, the USD invoice, the foreign row, the roles
  bizR: `${P}bizR`, // CASH, TTD: refunds, overdue, paid in full
  bizC: `${P}bizC`, // ACCRUAL, TTD: the ledger-sourced aging
  bizK: `${P}bizK`, // CASH, TTD: seeded credited and odd rows
  bizM: `${P}bizM`, // CASH, TTD: seeded rows dated in other months; PAID invoices with no payment row
  bizB: `${P}bizB`, // another tenant
  contactA: `${P}contactA`,
  contactR: `${P}contactR`,
  contactC: `${P}contactC`,
  contactK: `${P}contactK`,
  contactM: `${P}contactM`,
  contactB: `${P}contactB`,
};

const OWNER_OF: Record<string, string> = {
  [ID.bizA]: ID.ownerA,
  [ID.bizR]: ID.ownerR,
  [ID.bizC]: ID.ownerC,
  [ID.bizK]: ID.ownerK,
  [ID.bizM]: ID.ownerM,
  [ID.bizB]: ID.ownerB,
};

let db: any;
let app: any;
let financeApp: any;
let reportsApp: any;
let redis: any;
let statsSvc: any;
let coa: any;
let readInvoiceMoney: any;
let prismaClient: any;
let balanceOfStoredRows: any;
let creditAwareBalance: any;

/** The invoices the real routes created, by a short key. */
const INV: Record<string, string> = {};

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
    `DELETE FROM financial_accounts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM credit_notes WHERE business_id LIKE ${sqlLikePrefix(P)} OR invoice_id IN (SELECT id FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM payments WHERE business_id LIKE ${sqlLikePrefix(P)} OR invoice_id IN (SELECT id FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM payment_links WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM activities WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM chart_of_accounts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM team_activity_logs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

const agent = () => request(app.getHttpServer());
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** An invoice of one line through the real create route, then issued (SENT) through the real status route. */
async function issuedInvoice(key: string, biz: string, contactId: string, total: number, over: Record<string, unknown> = {}, issue = true) {
  const as = OWNER_OF[biz];
  await sleep(3); // invoice numbers default to INV-<ms>, unique per tenant
  const created = await agent()
    .post(`/commerce/businesses/${biz}/invoices`)
    .set(HEADER, as)
    .send({ contactId, items: [{ description: `v64e ${key}`, quantity: 1, unitPrice: total }], ...over });
  expect(created.status, `create ${key}: ${JSON.stringify(created.body)}`).toBe(201);
  expect(Number(created.body.total), `total of ${key}`).toBe(total);
  INV[key] = created.body.id;
  if (issue) {
    const sent = await agent().patch(`/commerce/invoices/${created.body.id}/status/sent`).set(HEADER, as).send({ businessId: biz, status: 'SENT' });
    expect(sent.status, `issue ${key}: ${JSON.stringify(sent.body)}`).toBe(200);
  }
  return created.body.id as string;
}

/** A manual payment through the real route; answers the Payment row it wrote. */
async function pay(key: string, biz: string, amount: number) {
  const res = await agent()
    .post(`/commerce/businesses/${biz}/invoices/${INV[key]}/payments`)
    .set(HEADER, OWNER_OF[biz])
    .send({ amount, method: 'cash' });
  expect(res.status, `pay ${amount} on ${key}: ${JSON.stringify(res.body)}`).toBe(201);
  const row = await db.payment.findFirst({ where: { invoiceId: INV[key], businessId: biz, status: 'SUCCESSFUL', amount }, orderBy: { createdAt: 'desc' } });
  expect(row, `the ${amount} payment row on ${key}`).toBeTruthy();
  return row;
}

async function statusOf(key: string): Promise<string> {
  return (await db.invoice.findUnique({ where: { id: INV[key] }, select: { status: true } })).status;
}

/** GET stats as `as`, on the rows as they are (the 60 s cache cleared first). */
async function stats(biz: string, as: string = OWNER_OF[biz]) {
  statsSvc.invalidateCache(biz);
  return agent().get(`/commerce/businesses/${biz}/stats`).set(HEADER, as);
}

async function statsOf(biz: string) {
  const res = await stats(biz);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body;
}

function report(biz: string, as: string = OWNER_OF[biz]) {
  return request(reportsApp.getHttpServer()).get(`/businesses/${biz}/reports/generate?type=executive`).set(HEADER, as);
}

async function reportOf(biz: string) {
  const res = await report(biz);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body;
}

async function agingOf(biz: string) {
  const res = await request(financeApp.getHttpServer()).get(`/finance/businesses/${biz}/receivables/aging`).set(HEADER, OWNER_OF[biz]);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body;
}

/** Every number reachable from `value`, with its path. */
function numbersIn(value: any, at = '$'): Array<[string, number]> {
  if (typeof value === 'number') return [[at, value]];
  if (Array.isArray(value)) return value.flatMap((v, i) => numbersIn(v, `${at}[${i}]`));
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([k, v]) => numbersIn(v, `${at}.${k}`));
  return [];
}

const cents = (n: number) => Math.round(n * 100);

/** Noon on the 15th of the month before this one: never this month, always inside the six-month series. */
const LAST_MONTH = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() - 1, 15, 12);
};

/** A seeded invoice row (bizK / bizB: states the routes do not produce on demand). */
async function seedInvoice(key: string, biz: string, contactId: string, status: string, total: number, over: Record<string, unknown> = {}) {
  const id = `${P}${key}`;
  await db.invoice.create({
    data: {
      id,
      businessId: biz,
      contactId,
      invoiceNumber: `${P}${key}`,
      status,
      subtotal: total,
      total,
      currency: 'TTD',
      issueDate: new Date(),
      items: { create: [{ description: `v64e ${key}`, quantity: 1, unitPrice: total, total }] },
      ...over,
    },
  });
  INV[key] = id;
  return id;
}

/** A seeded Payment row, written as its writer writes it. */
async function seedPayment(key: string, tag: string, businessId: string, amount: number, status: string, over: Record<string, unknown> = {}) {
  return db.payment.create({
    data: {
      id: `${P}pay_${key}_${tag}`,
      businessId,
      invoiceId: INV[key],
      amount,
      currency: 'TTD',
      status,
      provider: 'cash',
      method: 'cash',
      providerPaymentId: `${P}pp_${key}_${tag}`,
      ...over,
    },
  });
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
  const statsMod = await import('../src/modules/commerce/commerce-stats.service');
  const { CommerceStatsService } = statsMod;
  readInvoiceMoney = statsMod.readInvoiceMoney;
  const workflowMod = await import('../src/modules/commerce/invoice-workflow.service');
  const { InvoiceWorkflowService } = workflowMod;
  balanceOfStoredRows = workflowMod.balanceOfStoredRows;
  creditAwareBalance = workflowMod.creditAwareBalance;
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
  const { FinanceController } = await import('../src/modules/finance/finance.controller');
  const { ReceivablesService } = await import('../src/modules/finance/receivables.service');
  const { ReportsController } = await import('../src/modules/reports/reports.controller');
  const { ReportsService } = await import('../src/modules/reports/reports.service');
  const { LedgerReportingService } = await import('../src/modules/reports/ledger-reporting.service');
  // FinanceController's collaborators off the receivables path (stubbed).
  const financeStubs = await Promise.all([
    import('../src/modules/finance/finance-overview.service').then((m) => m.FinanceOverviewService),
    import('../src/modules/finance/finance-accounts.service').then((m) => m.FinanceAccountsService),
    import('../src/modules/finance/finance-coa.service').then((m) => m.FinanceCoaService),
    import('../src/modules/finance/finance-tax-rate.service').then((m) => m.FinanceTaxRateService),
    import('../src/modules/finance/finance-settings.service').then((m) => m.FinanceSettingsService),
    import('../src/modules/finance/bank-import.service').then((m) => m.BankImportService),
    import('../src/modules/finance/statement-source.service').then((m) => m.StatementSourceService),
    import('../src/modules/finance/bank-matching.service').then((m) => m.BankMatchingService),
    import('../src/modules/finance/bank-rule.service').then((m) => m.BankRuleService),
    import('../src/modules/finance/recurring-journal-entry.service').then((m) => m.RecurringJournalEntryService),
    import('../src/modules/finance/reconciliation.service').then((m) => m.ReconciliationService),
    import('../src/modules/finance/tax-liability.service').then((m) => m.TaxLiabilityService),
    import('../src/modules/finance/accountant-export.service').then((m) => m.AccountantExportService),
    import('../src/modules/finance/finance-intelligence.service').then((m) => m.FinanceIntelligenceService),
    import('../src/modules/finance/accountant-export-email.service').then((m) => m.AccountantExportEmailService),
    import('../src/modules/finance/safe-to-spend.service').then((m) => m.SafeToSpendService),
    import('../src/modules/finance/cashflow-forecast.service').then((m) => m.CashflowForecastService),
    import('../src/modules/finance/money-moves.service').then((m) => m.MoneyMovesService),
    import('../src/modules/finance/cash-reserve.service').then((m) => m.CashReserveService),
    import('../src/modules/finance/credit-note.service').then((m) => m.CreditNoteService),
    import('../src/modules/finance/bank-connection.service').then((m) => m.BankConnectionService),
    import('../src/modules/finance/exchange-rate.service').then((m) => m.ExchangeRateService),
    import('../src/modules/finance/fixed-asset.service').then((m) => m.FixedAssetService),
  ]);

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
  statsSvc = moduleRef.get(CommerceStatsService);
  coa = moduleRef.get(ChartOfAccountsSeederService);
  const prismaService = moduleRef.get(PrismaService);
  prismaClient = prismaService.client;

  /** Identity attachment only. No guard is overridden. */
  const attachIdentity = (target: any) => target.use(async (req: any, _res: any, next: any) => {
    const header = req.headers[HEADER];
    const id = typeof header === 'string' ? header : undefined;
    if (id && id.startsWith(P)) {
      const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
      if (user) req.user = { id: user.id, email: user.email, role: user.role };
    }
    next();
  });

  app = moduleRef.createNestApplication();
  attachIdentity(app);
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();

  // The real A/R aging route over the real ReceivablesService.
  const receivables = new ReceivablesService(prismaService, coa);
  const financeRef = await Test.createTestingModule({
    controllers: [FinanceController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      LedgerBalanceService,
      PostingService,
      AccountingPeriodService,
      { provide: ReceivablesService, useValue: receivables },
      ...financeStubs.map((token) => ({ provide: token, useValue: {} })),
    ],
  }).compile();
  financeApp = financeRef.createNestApplication();
  attachIdentity(financeApp);
  financeApp.useGlobalFilters(new GlobalHttpExceptionFilter());
  await financeApp.init();

  // The real report route over the real ReportsService (fixed AI narrative).
  const reporting = new LedgerReportingService(prismaService, moduleRef.get(LedgerBalanceService), receivables);
  const reports = new ReportsService(prismaService, { callAi: async () => ({ content: 'v64e narrative' }) } as any, reporting);
  const reportsRef = await Test.createTestingModule({
    controllers: [ReportsController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      { provide: LedgerReportingService, useValue: reporting },
      { provide: ReportsService, useValue: reports },
    ],
  }).compile();
  reportsApp = reportsRef.createNestApplication();
  attachIdentity(reportsApp);
  reportsApp.useGlobalFilters(new GlobalHttpExceptionFilter());
  await reportsApp.init();

  await cleanup(); // in case a prior run aborted

  for (const [user, biz, basis, contact, tag] of [
    [ID.ownerA, ID.bizA, 'CASH', ID.contactA, 'a'],
    [ID.ownerR, ID.bizR, 'CASH', ID.contactR, 'r'],
    [ID.ownerC, ID.bizC, 'ACCRUAL', ID.contactC, 'c'],
    [ID.ownerK, ID.bizK, 'CASH', ID.contactK, 'k'],
    [ID.ownerM, ID.bizM, 'CASH', ID.contactM, 'm'],
    [ID.ownerB, ID.bizB, 'CASH', ID.contactB, 'b'],
  ] as const) {
    await db.user.create({ data: { id: user, email: `${P}owner-${tag}@test.local`, role: 'USER' } });
    await db.business.create({
      data: { id: biz, name: `V64E ${tag}`, slug: `${P}biz-${tag}`, ownerId: user, currency: 'TTD', accountingBasis: basis },
    });
    await db.membership.create({ data: { id: `${user}_m`, userId: user, businessId: biz, role: 'OWNER' } });
    await db.contact.create({ data: { id: contact, businessId: biz, firstName: 'V64e', lastName: tag, email: `${P}contact-${tag}@test.local` } });
    await coa.ensureDefaults(biz);
  }
  for (const [user, revenue] of [[ID.staffNone, 'none'], [ID.staffRead, 'read']] as const) {
    await db.user.create({ data: { id: user, email: `${P}staff-${revenue}@test.local`, role: 'USER' } });
    await db.membership.create({
      data: { id: `${user}_m`, userId: user, businessId: ID.bizA, role: 'STAFF', permissionScopes: { revenue, crm: 'write' } },
    });
  }

  // bizA: the BUG-020 book. 13,723 issued, 400 received; a 999 draft never sent.
  await issuedInvoice('a_deposit', ID.bizA, ID.contactA, 13723);
  await pay('a_deposit', ID.bizA, 400);
  await issuedInvoice('a_draft', ID.bizA, ID.contactA, 999, {}, false);

  // bizC (ACCRUAL): 1,000 issued (receivable posted), 250 received; a 50 draft.
  await issuedInvoice('c_part', ID.bizC, ID.contactC, 1000);
  await pay('c_part', ID.bizC, 250);
  await issuedInvoice('c_draft', ID.bizC, ID.contactC, 50, {}, false);

  // bizR: 60 + 40 paid and the 40 refunded; 500 due ten days ago with 200 paid; 75 paid in full.
  await issuedInvoice('r_refund', ID.bizR, ID.contactR, 100);
  await pay('r_refund', ID.bizR, 60);
  const forty = await pay('r_refund', ID.bizR, 40);
  const refunded = await agent().post(`/commerce/businesses/${ID.bizR}/payments/${forty.id}/refund`).set(HEADER, ID.ownerR).send({ reason: 'v64e refund' });
  expect(refunded.status, JSON.stringify(refunded.body)).toBe(201);
  await issuedInvoice('r_overdue', ID.bizR, ID.contactR, 500, { dueDate: new Date(Date.now() - 10 * 86400_000).toISOString() });
  await pay('r_overdue', ID.bizR, 200);
  await issuedInvoice('r_paid', ID.bizR, ID.contactR, 75);
  await pay('r_paid', ID.bizR, 75);

  // bizB (another tenant): 70 sent, nothing received.
  await seedInvoice('b_sent', ID.bizB, ID.contactB, 'SENT', 70);

  // bizK: states seeded as their writers leave them.
  //  k_credit   200 PARTIALLY_CREDITED, APPLIED note 50 (own) + 25 (another tenant's), 30 paid -> owes 120
  //  k_full     80 FULLY_CREDITED (APPLIED note 80)                                           -> owes 0
  //  k_over     100 PAID with 120 received                                                    -> owes 0, received 120
  //  k_noise    90 SENT with a PENDING 90 and a FAILED 90                                     -> owes 90, received 0
  //  k_legacy   40 SENT with a positive REFUNDED 40 (flipped before V1-29)                    -> owes 40, received 0
  await seedInvoice('k_credit', ID.bizK, ID.contactK, 'PARTIALLY_CREDITED', 200);
  await seedPayment('k_credit', 'p30', ID.bizK, 30, 'SUCCESSFUL');
  await db.creditNote.create({ data: { id: `${P}cn_own`, businessId: ID.bizK, invoiceId: INV.k_credit, creditNoteNumber: `${P}CN-1`, status: 'APPLIED', amount: 50, appliedAt: new Date() } });
  await db.creditNote.create({ data: { id: `${P}cn_foreign`, businessId: ID.bizB, invoiceId: INV.k_credit, creditNoteNumber: `${P}CN-2`, status: 'APPLIED', amount: 25, appliedAt: new Date() } });
  await seedInvoice('k_full', ID.bizK, ID.contactK, 'FULLY_CREDITED', 80);
  await db.creditNote.create({ data: { id: `${P}cn_full`, businessId: ID.bizK, invoiceId: INV.k_full, creditNoteNumber: `${P}CN-3`, status: 'APPLIED', amount: 80, appliedAt: new Date() } });
  await seedInvoice('k_over', ID.bizK, ID.contactK, 'PAID', 100, { paidAt: new Date() });
  await seedPayment('k_over', 'p120', ID.bizK, 120, 'SUCCESSFUL');
  await seedInvoice('k_noise', ID.bizK, ID.contactK, 'SENT', 90);
  await seedPayment('k_noise', 'pending', ID.bizK, 90, 'PENDING');
  await seedPayment('k_noise', 'failed', ID.bizK, 90, 'FAILED');
  await seedInvoice('k_legacy', ID.bizK, ID.contactK, 'SENT', 40);
  await seedPayment('k_legacy', 'flipped', ID.bizK, 40, 'REFUNDED');

  // bizM: rows dated in other months, and PAID invoices with no payment row.
  //  m_rowless_now   250 PAID now, no payment row (as the marketplace order writer leaves INV-ORD-...)
  //  m_rowless_last  60 PAID on the 15th of last month, no payment row
  //  m_two           1,000 PARTIALLY_PAID: 300 received last month, 150 now
  //  m_refund        100 SENT: 100 received last month, refunded now (a negative REFUNDED row, D-14)
  const lastMonth = LAST_MONTH();
  await seedInvoice('m_rowless_now', ID.bizM, ID.contactM, 'PAID', 250, { paidAt: new Date() });
  await seedInvoice('m_rowless_last', ID.bizM, ID.contactM, 'PAID', 60, { paidAt: lastMonth });
  await seedInvoice('m_two', ID.bizM, ID.contactM, 'PARTIALLY_PAID', 1000);
  await seedPayment('m_two', 'p300', ID.bizM, 300, 'SUCCESSFUL', { createdAt: lastMonth });
  await seedPayment('m_two', 'p150', ID.bizM, 150, 'SUCCESSFUL');
  await seedInvoice('m_refund', ID.bizM, ID.contactM, 'SENT', 100);
  await seedPayment('m_refund', 'p100', ID.bizM, 100, 'SUCCESSFUL', { createdAt: lastMonth });
  await seedPayment('m_refund', 'r100', ID.bizM, -100, 'REFUNDED', { reference: `${P}pp_m_refund_p100` });
}, 240_000);

afterAll(async () => {
  if (app) await app.close();
  if (financeApp) await financeApp.close();
  if (reportsApp) await reportsApp.close();
  if (db) await cleanup();
  if (redis) await redis.quit().catch(() => undefined);
}, 60_000);

describe('V1-64 commerce stats count a deposit (BUG-020)', () => {
  it('MT-01 RED-BEFORE: 13,723 issued with 400 received -> totalRevenue 400, outstandingAmount 13,323 (base: 0 / 0)', async () => {
    expect(await statusOf('a_deposit')).toBe('PARTIALLY_PAID');
    const s = await statsOf(ID.bizA);
    expect(s.currency).toBe('TTD');
    expect({ totalRevenue: s.totalRevenue, outstandingAmount: s.outstandingAmount }).toEqual({ totalRevenue: 400, outstandingAmount: 13323 });
    expect(s.byCurrency.TTD).toMatchObject({ totalRevenue: 400, outstandingAmount: 13323, overdueAmount: 0, monthlyPaid: 400 });
    expect(s.monthlyPaid).toBe(400);
    // The money came in this month: the last of the six months carries it, and the six add up to the revenue.
    const months = s.revenueByMonth as Array<{ month: string; revenue: number }>;
    expect(months).toHaveLength(6);
    expect(months[5]).toMatchObject({ revenue: 400, invoiceCount: 1 }); // one invoice money came in on
    expect(months.reduce((n, m) => n + cents(m.revenue), 0)).toBe(cents(400));
    // What the invoice is, is unchanged: one PARTIALLY_PAID invoice of 13,723 and one draft.
    expect(s.invoiceStatusBreakdown.PARTIALLY_PAID).toEqual({ count: 1, total: 13723 });
    expect(s.invoiceStatusBreakdown.DRAFT).toEqual({ count: 1, total: 999 });
    expect(s.invoiceCount).toBe(2);
  });

  it('MT-02 RED-BEFORE: a DRAFT is not outstanding. The Executive Summary states 13,323 over 1 invoice (base: 999, the draft alone)', async () => {
    expect(await statusOf('a_draft')).toBe('DRAFT');
    const r = await reportOf(ID.bizA);
    expect(r.metrics.currency).toBe('TTD');
    expect({ outstanding: r.metrics.revenue.outstanding, outstandingCount: r.metrics.revenue.outstandingCount, overdueCount: r.metrics.revenue.overdueCount })
      .toEqual({ outstanding: 13323, outstandingCount: 1, overdueCount: 0 });
    // Control: stats never counted the draft.
    expect((await statsOf(ID.bizA)).outstandingAmount).toBe(13323);
  });

  it.each([
    ['CASH', ID.bizA, 13323],
    ['ACCRUAL', ID.bizC, 750],
    ['CASH (refunds, overdue)', ID.bizR, 340],
  ] as const)('MT-03 RED-BEFORE: on the %s business the Executive Summary outstanding = the A/R aging total = the stats outstanding', async (_basis, biz, owed) => {
    const [r, aging, s] = [await reportOf(biz), await agingOf(biz), await statsOf(biz)];
    expect(aging.totalOutstanding, 'the A/R aging').toBe(owed);
    expect(r.metrics.revenue.outstanding, 'the Executive Summary').toBe(aging.totalOutstanding);
    expect(s.outstandingAmount, 'the stats').toBe(aging.totalOutstanding);
  });
});

describe('V1-64 refunds, overdue and paid in full (D-14)', () => {
  it('MT-04 RED-BEFORE: 60 + 40 paid with the 40 refunded adds 60 / 40; 500 past due with 200 paid adds 200 / 300 overdue; 75 paid adds 75 / 0', async () => {
    expect([await statusOf('r_refund'), await statusOf('r_overdue'), await statusOf('r_paid')]).toEqual(['PARTIALLY_PAID', 'PARTIALLY_PAID', 'PAID']);
    const s = await statsOf(ID.bizR);
    expect({ totalRevenue: s.totalRevenue, outstandingAmount: s.outstandingAmount, overdueAmount: s.overdueAmount, monthlyPaid: s.monthlyPaid })
      .toEqual({ totalRevenue: 335, outstandingAmount: 340, overdueAmount: 300, monthlyPaid: 335 });
    expect(s.revenueByMonth[5].revenue).toBe(335);
    // The average is still the paid invoices' own: one PAID invoice of 75.
    expect(s.byCurrency.TTD).toMatchObject({ paidInvoiceCount: 1, averageInvoiceValue: 75 });
    const r = await reportOf(ID.bizR);
    expect({ outstanding: r.metrics.revenue.outstanding, outstandingCount: r.metrics.revenue.outstandingCount, overdueCount: r.metrics.revenue.overdueCount })
      .toEqual({ outstanding: 340, outstandingCount: 2, overdueCount: 1 });
  });
});

describe('V1-64 per currency (D-13)', () => {
  it('MT-05 RED-BEFORE: a USD 250 invoice with 100 received on the TTD business sits under byCurrency.USD; no TTD figure moves', async () => {
    await issuedInvoice('a_usd', ID.bizA, ID.contactA, 250, { currency: 'USD' });
    const res = await agent().post(`/commerce/businesses/${ID.bizA}/invoices/${INV.a_usd}/payments`).set(HEADER, ID.ownerA).send({ amount: 100, method: 'cash' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const s = await statsOf(ID.bizA);
    expect(s.byCurrency.USD).toMatchObject({ totalRevenue: 100, outstandingAmount: 150, monthlyPaid: 100 });
    expect(s.byCurrency.TTD).toMatchObject({ totalRevenue: 400, outstandingAmount: 13323, monthlyPaid: 400 });
    expect({ currency: s.currency, totalRevenue: s.totalRevenue, outstandingAmount: s.outstandingAmount }).toEqual({ currency: 'TTD', totalRevenue: 400, outstandingAmount: 13323 });
    for (const [where, n] of numbersIn(s)) {
      if (/Count$|\.count$|Rate$|quoteStatusBreakdown/.test(where)) continue;
      expect([500, 13473].includes(n), `${where} = ${n} adds TTD and USD`).toBe(false);
    }
    // The Executive Summary is labelled TTD: its outstanding is the TTD 13,323, the USD 150 is not added.
    const r = await reportOf(ID.bizA);
    expect(r.metrics.currency).toBe('TTD');
    expect(r.metrics.revenue.outstanding).toBe(13323);
  });
});

describe('V1-64 own-tenant rows and tenant isolation (D-75)', () => {
  it("MT-06 RED-BEFORE: another business's SUCCESSFUL row on this invoice is nobody's revenue here; the other tenant reads its own book and is refused on this one", async () => {
    await seedPayment('a_deposit', 'foreign', ID.bizB, 5000, 'SUCCESSFUL');
    const a = await statsOf(ID.bizA);
    expect({ totalRevenue: a.totalRevenue, outstandingAmount: a.outstandingAmount }).toEqual({ totalRevenue: 400, outstandingAmount: 13323 });
    expect((await reportOf(ID.bizA)).metrics.revenue.outstanding).toBe(13323);

    const b = await statsOf(ID.bizB);
    expect({ totalRevenue: b.totalRevenue, outstandingAmount: b.outstandingAmount, monthlyPaid: b.monthlyPaid }).toEqual({ totalRevenue: 0, outstandingAmount: 70, monthlyPaid: 0 });
    expect((await reportOf(ID.bizB)).metrics.revenue).toMatchObject({ outstanding: 70, outstandingCount: 1 });
    expect(JSON.stringify(b)).not.toMatch(/13323|13723|5000/);

    const foreignStats = await stats(ID.bizA, ID.ownerB);
    expect(foreignStats.status).toBe(403);
    expect(JSON.stringify(foreignStats.body)).not.toMatch(/totalRevenue|outstandingAmount|13323|byCurrency/);
    const foreignReport = await report(ID.bizA, ID.ownerB);
    expect(foreignReport.status).toBe(403);
    expect(JSON.stringify(foreignReport.body)).not.toMatch(/outstanding|13323|metrics/);
  });
});

describe('V1-64 revenue read (D-57)', () => {
  it('MT-07: revenue:none -> 403 and no figure from stats and the Executive Summary; revenue:read reads the owner figures; no identity -> 401', async () => {
    for (const read of [stats(ID.bizA, ID.staffNone), report(ID.bizA, ID.staffNone)]) {
      const res = await read;
      expect(res.status, JSON.stringify(res.body)).toBe(403);
      expect(JSON.stringify(res.body)).not.toMatch(/totalRevenue|outstanding|13323|byCurrency|metrics|narrative/);
    }
    const owner = await statsOf(ID.bizA);
    const reader = await stats(ID.bizA, ID.staffRead);
    expect(reader.status, JSON.stringify(reader.body)).toBe(200);
    expect(reader.body).toEqual(owner);
    const readerReport = await report(ID.bizA, ID.staffRead);
    expect(readerReport.status, JSON.stringify(readerReport.body)).toBe(200);
    expect(readerReport.body.metrics.revenue.outstanding).toBe(13323);

    statsSvc.invalidateCache(ID.bizA);
    expect((await agent().get(`/commerce/businesses/${ID.bizA}/stats`)).status).toBe(401);
    expect((await request(reportsApp.getHttpServer()).get(`/businesses/${ID.bizA}/reports/generate?type=executive`)).status).toBe(401);
    // A cached answer is refused the same way: the owner's read fills the cache, the refused member still gets nothing.
    await agent().get(`/commerce/businesses/${ID.bizA}/stats`).set(HEADER, ID.ownerA);
    const cached = await agent().get(`/commerce/businesses/${ID.bizA}/stats`).set(HEADER, ID.staffNone);
    expect(cached.status).toBe(403);
    expect(JSON.stringify(cached.body)).not.toMatch(/totalRevenue|13323/);
  });
});

describe('V1-64 credited invoices and rows that are not money', () => {
  it('MT-08 RED-BEFORE: PARTIALLY_CREDITED 200 less its own APPLIED 50 less 30 paid owes 120; FULLY_CREDITED and an overpaid invoice owe 0; PENDING / FAILED / a flipped REFUNDED row are not received', async () => {
    const s = await statsOf(ID.bizK);
    // received: 30 (k_credit) + 120 (k_over); owed: 120 (k_credit) + 90 (k_noise) + 40 (k_legacy)
    expect({ totalRevenue: s.totalRevenue, outstandingAmount: s.outstandingAmount, overdueAmount: s.overdueAmount }).toEqual({ totalRevenue: 150, outstandingAmount: 250, overdueAmount: 0 });
    for (const [where, n] of numbersIn(s)) expect(n, `${where} is negative`).toBeGreaterThanOrEqual(0);
    const r = await reportOf(ID.bizK);
    expect({ outstanding: r.metrics.revenue.outstanding, outstandingCount: r.metrics.revenue.outstandingCount }).toEqual({ outstanding: 250, outstandingCount: 3 });
  });
});

describe('V1-64 contract binding', () => {
  it('MT-09: stats revenue = the sum of balanceOfStoredRows(...).net over own-tenant rows; outstanding = the sum of the credit-aware remaining of the open invoices', async () => {
    const OPEN = ['SENT', 'OVERDUE', 'PARTIALLY_PAID', 'PARTIALLY_CREDITED'];
    for (const biz of [ID.bizA, ID.bizR, ID.bizC, ID.bizK, ID.bizB]) {
      const invoices = await db.invoice.findMany({
        where: { businessId: biz, deletedAt: null, currency: 'TTD' },
        select: { id: true, total: true, status: true, currency: true, payments: { where: { businessId: biz }, select: { amount: true, status: true } } },
      });
      let net = 0;
      let owed = 0;
      for (const inv of invoices) {
        const balance = balanceOfStoredRows(Number(inv.total), inv.payments, inv.currency);
        net += cents(balance.net);
        if (!OPEN.includes(inv.status)) continue;
        const applied = await db.creditNote.aggregate({ where: { invoiceId: inv.id, businessId: biz, status: 'APPLIED' }, _sum: { amount: true } });
        const credited = inv.status === 'PARTIALLY_CREDITED' ? Number(applied._sum.amount ?? 0) : 0;
        owed += cents(creditAwareBalance(balance, credited).remaining);
      }
      const s = await statsOf(biz);
      expect(cents(s.totalRevenue), `${biz} revenue`).toBe(net);
      expect(cents(s.outstandingAmount), `${biz} outstanding`).toBe(owed);
    }
  });
});

describe('V1-64 review repairs', () => {
  it('MT-10 RED-BEFORE (COR-2): a PAID invoice with no payment row of its own still counts its total, on the day it was paid (the head: 0)', async () => {
    const s = await statsOf(ID.bizM);
    // 250 (rowless, now) + 60 (rowless, last month) + 300 + 150 (m_two) + 100 - 100 (m_refund)
    expect(s.totalRevenue).toBe(760);
    expect(s.byCurrency.TTD).toMatchObject({ paidInvoiceCount: 2, averageInvoiceValue: 155 });
    expect(s.invoiceStatusBreakdown.PAID).toEqual({ count: 2, total: 310 });
    // A row of another tenant on a rowless PAID invoice changes nothing: it is not this invoice's money (D-75).
    await seedPayment('m_rowless_now', 'foreign', ID.bizB, 9999, 'SUCCESSFUL');
    expect((await statsOf(ID.bizM)).totalRevenue).toBe(760);
    expect(JSON.stringify(await statsOf(ID.bizB))).not.toMatch(/9999/);
    // Once the invoice carries a payment row of its own, the rows are the money: 250 total with 100 received reads 100.
    await seedPayment('m_rowless_now', 'own100', ID.bizM, 100, 'SUCCESSFUL');
    expect((await statsOf(ID.bizM)).totalRevenue).toBe(610);
    await db.payment.delete({ where: { id: `${P}pay_m_rowless_now_own100` } });
    expect((await statsOf(ID.bizM)).totalRevenue).toBe(760);
  });

  it('MT-11 RED-BEFORE (COR-8a, COR-6, COR-7): the months go by each payment row date; a month is its net cash, below zero when a refund outweighs it', async () => {
    const s = await statsOf(ID.bizM);
    const months = s.revenueByMonth as Array<{ month: string; revenue: number; invoiceCount: number }>;
    // last month: 60 (rowless, paid then) + 300 (m_two) + 100 (m_refund) on three invoices
    expect(months[4]).toMatchObject({ revenue: 460, invoiceCount: 3 });
    // this month: 250 (rowless, paid now) + 150 (m_two) - 100 (m_refund's refund) on three invoices
    expect(months[5]).toMatchObject({ revenue: 300, invoiceCount: 3 });
    expect(s.monthlyPaid).toBe(300);
    expect(months.reduce((n, m) => n + cents(m.revenue), 0)).toBe(cents(s.totalRevenue));
    // The unpaid invoice owes what is left of it; the refunded one owes its whole total again.
    expect(s.outstandingAmount).toBe(650);

    // A month whose refunds outweigh its receipts is stated as it is: net cash out.
    await db.payment.updateMany({ where: { invoiceId: { in: [INV.m_two, INV.m_rowless_now] }, businessId: ID.bizM }, data: { status: 'FAILED' } });
    await db.invoice.update({ where: { id: INV.m_rowless_now }, data: { status: 'VOID', paidAt: null } });
    const net = await statsOf(ID.bizM);
    expect(net.monthlyPaid).toBe(-100);
    expect(net.revenueByMonth[5]).toMatchObject({ revenue: -100, invoiceCount: 1 });
    expect(net.revenueByMonth[4]).toMatchObject({ revenue: 160, invoiceCount: 2 });
    expect(net.totalRevenue).toBe(60);
  });

  it('MT-12 RED-BEFORE (COR-4): the Executive Summary states what is owed per currency; the headline stays the business currency', async () => {
    const r = await reportOf(ID.bizA);
    expect(r.metrics.currency).toBe('TTD');
    expect(r.metrics.revenue).toMatchObject({ outstanding: 13323, outstandingCount: 1, overdueCount: 0 });
    expect(r.metrics.revenue.outstandingByCurrency).toEqual({
      TTD: { outstanding: 13323, count: 1, overdueCount: 0 },
      USD: { outstanding: 150, count: 1, overdueCount: 0 },
    });
    // A single-currency book states one bucket, equal to the headline.
    const single = await reportOf(ID.bizR);
    expect(single.metrics.revenue.outstandingByCurrency).toEqual({ TTD: { outstanding: 340, count: 2, overdueCount: 1 } });
    // The other tenant's report carries none of it.
    expect((await reportOf(ID.bizB)).metrics.revenue.outstandingByCurrency).toEqual({ TTD: { outstanding: 70, count: 1, overdueCount: 0 } });
  });

  it('MT-13 (SEC-2): no business named reads nothing, from any tenant', async () => {
    for (const missing of [undefined, null, '', { not: '' }, { contains: 'v64e' }] as any[]) {
      expect(await readInvoiceMoney(prismaClient, missing), JSON.stringify(missing)).toEqual([]);
      expect(await readInvoiceMoney(prismaClient, missing, new Date(), { openOnly: true }), JSON.stringify(missing)).toEqual([]);
      await expect(statsSvc.getCommerceStats(missing), JSON.stringify(missing)).rejects.toThrow(/business/i);
    }
    // Control: a named business reads its own rows.
    expect((await readInvoiceMoney(prismaClient, ID.bizB)).map((m: any) => m.id)).toEqual([INV.b_sent]);
  });
});
