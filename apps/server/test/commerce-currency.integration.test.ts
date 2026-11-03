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
 *
 * V1-37b-CURRENCY-PROJECTIONS (the V1-37 review residuals that lay outside the
 * V1-37 write set; each was an it.todo here, each is now a real case):
 *
 *   ST-V37-2  RED-BEFORE GET stats and every commerce-ai read route (ai-cashflow, ai-analyze,
 *             ai-reminder, ai-pricing, ai-search, ...) answer 403 to a member whose revenue scope
 *             is none, the service is never reached and nothing is returned; a revenue:read
 *             member and the owner still read (RED-BEFORE: 200/201 with the data)
 *   ST-V37-3 / RV37-01  RED-BEFORE GET /finance/businesses/:id/trial-balance items carry `currency`,
 *             one item per (account, currency), equal to the service rows; per currency the items
 *             balance (the web page keys and totals by (accountId, currency): apps/web
 *             finance/trial-balance/__tests__)
 *   RV37-02   RED-BEFORE getBalanceSheet never sums across currencies: the top level is the
 *             business currency's sheet (every line labelled with it); byCurrency carries one
 *             sheet per currency the books hold, each line labelled, one line per account, each
 *             total equal to Postgres' own per-(currency, account type) sums, each identity holding
 *   RV37-04   RED-BEFORE applyRules skips (does not abort) a bank row whose currency the posting
 *             door refuses (400, EUR on a TTD business), reports it in `skipped` and the finance
 *             audit, leaves it UNMATCHED with nothing posted, and posts the other rows (TTD; USD,
 *             a supported currency carried by the rule's source)
 *
 * V1-37b review repairs:
 *
 *   SEC-V37b-1 RED-BEFORE GET /finance/businesses/:id/trial-balance needs revenue:read
 *             (ModuleScopeGuard, the commerce revenue reads' gate): a revenue:none member gets 403
 *             and no rows; a revenue:read member and the owner still read it (RED-BEFORE: 200 with
 *             the REVENUE rows). The balance-sheet route and its CSV / PDF export and GET
 *             revenue-reports/:preset lie outside the V1-37b write set: it.todo below, each with why.
 *
 * V1-37d-LEGACY-CURRENCY-PAYMENTS (verify-money VR-04, a V1-37 regression confirmed on
 * int/trial-I): money against a document already stored in a currency outside D-13 is still
 * recorded, in that document's own currency; only new documents are held to D-13. The legacy
 * book: a business that kept JMD issues two JMD invoices through the real routes (their
 * receivables post in JMD, its own currency) and keeps a JMD draft; it then keeps TTD (D-13).
 *
 *   LC-01 RED-BEFORE (VR-04) POST payments {amount 50} on the SENT JMD invoice of the TTD business
 *          -> 201, payment row [SUCCESSFUL, 50, JMD], posting [INCOME, JMD, 50] (single currency,
 *          balanced), invoice PARTIALLY_PAID (RED-BEFORE: 400 'Unsupported posting currency JMD',
 *          no payment row, no posting, invoice SENT)
 *   LC-02 RED-BEFORE a partial refund of that payment (the provider refund door's recipe) posts a
 *          JMD REFUND; the manual refund of the rest reverses the recording and the partial in
 *          JMD; the payment's transactions net to zero per account, all JMD
 *   LC-03 RED-BEFORE paying the invoice in full -> PAID; its receivable closes in JMD, never TTD
 *   LC-04 control a void of the other legacy JMD invoice reverses its receivable in JMD
 *   LC-05 control new documents and free-standing postings keep the D-13 refusal (400, nothing
 *          written): a new JMD invoice; issuing the legacy JMD draft (its new receivable; the
 *          draft may move to TTD); a sourceless JMD posting; a JMD posting sourced by a document
 *          that is not a payment (a fixture, the invoice itself), by a payment of a TTD invoice,
 *          by no payment, or by another business's JMD payment
 *   LC-06 RED-BEFORE the trial balance per currency balances with JMD rows (CASH JMD 100 net),
 *          equal to Postgres per (account, currency); the TTD rows balance on their own
 *   LC-07 RED-BEFORE recurring schedules are held to D-13 when created and when they generate:
 *          POST/PATCH {currency JMD} on a TTD business -> 400, nothing written; no currency on
 *          the USD business -> USD (it was the literal TTD); a legacy JMD schedule on a CASH
 *          business (no posting refuses it) generates no invoice and records the failure, while
 *          a TTD schedule of that business is billed (RED-BEFORE: 201 JMD schedules and a SENT JMD
 *          invoice)
 *
 * V1-37d review repairs (RED-BEFORE = the packet head 0e0c2c65):
 *   LC-07d/e RED-BEFORE (ST-V37D-2 / CR-V37D-2) the legacy JMD schedule is refused before
 *          recurring_invoice.due is emitted and paused with the reason: three runs emit no `due`
 *          and one `failed`; edited to TTD and resumed, it bills the period that was due (the
 *          packet head emitted `due` and `failed` on every run, forever). LC-07 schedules fall due
 *          a year from now, never on a fixed date (CR-V37D-3).
 *   LC-08 RED-BEFORE (ST-V37D-1 / CR-V37D-1) a NEW document in an unsupported currency gets no
 *          ledger exception: the real storefront checkout of a product priced JMD or 'zzz' on a
 *          CASH TTD business answers 400 and writes nothing (no invoice, payment or posting; the
 *          order stays unpaid), and so does the storefront recipe for EUR. The packet head posted
 *          them (JMD, ZZZ, EUR).
 *   LC-09 the legacy marker on CASH, where no receivable exists: a payment on an invoice stored
 *          in JMD before D13_DOCUMENTS_FROM posts in JMD through the real route (VR-04 on the
 *          default basis), while one on a JMD invoice written now is refused (RED-BEFORE). Its
 *          final payment, with an inventory-costed line, posts its COGS in JMD and keeps the
 *          payment (RED-BEFORE, ST-V37D-3: 400 and nothing kept).
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
 * stub (no product lines here). The CommerceAiService stub records each call
 * and answers a sentinel, so a refused route is proven never to reach it. The
 * finance app (V1-37b) mounts the real FinanceController behind the real
 * AuthGuard and BusinessGuard over the real LedgerBalanceService; its other
 * collaborators are off the trial-balance path and stubbed. LedgerReportingService
 * and BankRuleService (with the real FinanceAuditService and PostingService) run
 * on real rows.
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
  // V1-37b (ST-V37-2): members of the TTD business by revenue scope.
  memberNone: `${P}memberNone`,
  memberRead: `${P}memberRead`,
  // V1-37d: a business that kept JMD before D-13 (ACCRUAL), then TTD; and a CASH TTD business.
  ownerL: `${P}ownerL`,
  bizLegacy: `${P}bizLegacy`,
  contactL: `${P}contactL`,
  bizCash: `${P}bizCash`,
  contactC: `${P}contactC`,
  // V1-37d review: a CASH TTD business for the legacy marker and the storefront.
  bizNew: `${P}bizNew`,
  contactN: `${P}contactN`,
};

let db: any;
let app: any;
let financeApp: any;
let redis: any;
let commerce: any;
let posting: any;
let coa: any;
let ledgerBalance: any;
let expenses: any;
let reporting: any;
let bankRules: any;
// V1-37d: the refund recipe the provider refund door calls, and a recurring run scoped to the CASH business.
let revenuePosting: any;
let recurringRunner: any;
// V1-37d review: the real client, workflow and the CASH-scoped schedule client, for runners and services built in tests.
let prismaRef: any;
let invoiceWorkflow: any;
let recurringClient: any;

/**
 * V1-37b (ST-V37-2): the CommerceAiService stand-in. Every read the commerce-ai
 * routes reach records its call and answers a sentinel, so a refused route is
 * proven to reach nothing and return nothing.
 */
const AI_SENTINEL = 'v37a-ai-read';
const AI_READS = [
  'analyzeRevenue', 'generateInvoiceReminder', 'suggestPricing', 'cashFlowForecast', 'naturalLanguageSearch',
  'productHealthScan', 'clientPaymentIntelligence', 'quoteWinAnalysis', 'interpretCommand', 'predictiveCollectionsScore',
  'suggestPaymentPlan', 'smartQuoteFollowUp', 'churnRiskAlerts', 'revenueJourney', 'quoteFromConversation',
] as const;
const aiCalls: Array<{ method: string; businessId: string }> = [];
const commerceAiStub = Object.fromEntries(
  AI_READS.map((method) => [method, async (businessId: string) => {
    aiCalls.push({ method, businessId });
    return { sentinel: AI_SENTINEL, method };
  }]),
);

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
    `DELETE FROM bank_transactions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM bank_rules WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM financial_accounts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payments WHERE business_id LIKE ${sqlLikePrefix(P)} OR invoice_id IN (SELECT id FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM payment_links WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM stock_movements WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM marketplace_order_items WHERE order_id IN (SELECT id FROM marketplace_orders WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM marketplace_orders WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM quote_items WHERE quote_id IN (SELECT id FROM quotes WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM quotes WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM email_campaigns WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM recurring_invoices WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM inventory_stocks WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM warehouses WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM products WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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
  // V1-37b: the trial-balance route, the balance sheet and the bank rules.
  const { FinanceController } = await import('../src/modules/finance/finance.controller');
  const { LedgerReportingService } = await import('../src/modules/reports/ledger-reporting.service');
  const { BankRuleService } = await import('../src/modules/finance/bank-rule.service');
  const { FinanceAuditService } = await import('../src/modules/finance/finance-audit.service');
  // V1-37d: the real recurring routes and service.
  const { RecurringInvoiceController } = await import('../src/modules/commerce/recurring-invoice.controller');
  const { RecurringInvoiceService } = await import('../src/modules/commerce/recurring-invoice.service');
  // FinanceController's collaborators off the trial-balance path (stubbed).
  const financeStubs = await Promise.all([
    import('../src/modules/finance/receivables.service').then((m) => m.ReceivablesService),
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
    controllers: [CommerceController, CommerceAiController, RecurringInvoiceController],
    providers: [
      RecurringInvoiceService,
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
      { provide: CommerceAiService, useValue: commerceAiStub },
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

  // V1-37b: the balance sheet over the real trial balance (receivables are off
  // the balance-sheet path), and the bank rules over the real door and audit.
  const prismaService = moduleRef.get(PrismaService);
  reporting = new LedgerReportingService(prismaService, ledgerBalance, {} as any);
  bankRules = new BankRuleService(prismaService, posting, new FinanceAuditService(prismaService));

  // V1-37d: the real refund recipe, and a second recurring runner over the
  // real workflow whose due-schedule scan is scoped to this suite's CASH
  // business (its own where clause kept), so a run never bills another
  // suite's schedules. Every other call is the real client's.
  revenuePosting = moduleRef.get(RevenuePostingService);
  const scopedClient = new Proxy(db, {
    get(target: any, prop: string | symbol) {
      if (prop === 'recurringInvoice') {
        const delegate = Reflect.get(target, prop);
        return new Proxy(delegate, {
          get(d: any, method: string | symbol) {
            const orig = Reflect.get(d, method);
            if (method !== 'findMany' || typeof orig !== 'function') return typeof orig === 'function' ? orig.bind(d) : orig;
            return (args: any = {}) => orig.call(d, { ...args, where: { AND: [args.where ?? {}, { businessId: ID.bizCash }] } });
          },
        });
      }
      const v = Reflect.get(target, prop);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
  recurringRunner = new RecurringInvoiceService(
    { client: scopedClient } as any,
    eventStub as any,
    moduleRef.get(InvoiceWorkflowService),
  );
  prismaRef = prismaService;
  invoiceWorkflow = moduleRef.get(InvoiceWorkflowService);
  recurringClient = scopedClient;

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

  // V1-37b (ST-V37-3 / RV37-01): the real trial-balance route.
  const financeRef = await Test.createTestingModule({
    controllers: [FinanceController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      // V1-37b review SEC-V37b-1: the trial balance needs revenue:read.
      ModuleScopeGuard,
      LedgerBalanceService,
      PostingService,
      AccountingPeriodService,
      ...financeStubs.map((token) => ({ provide: token, useValue: {} })),
    ],
  }).compile();
  financeApp = financeRef.createNestApplication();
  attachIdentity(financeApp);
  financeApp.useGlobalFilters(new GlobalHttpExceptionFilter());
  await financeApp.init();

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

  // V1-37b (ST-V37-2): two STAFF members of the TTD business with explicit
  // scope maps, one without revenue access, one that may read revenue.
  for (const [user, revenue] of [[ID.memberNone, 'none'], [ID.memberRead, 'read']] as const) {
    await db.user.create({ data: { id: user, email: `${P}member-${revenue}@test.local`, role: 'USER' } });
    await db.membership.create({
      data: { id: `${user}_m`, userId: user, businessId: ID.bizTtd, role: 'STAFF', permissionScopes: { revenue, crm: 'write' } },
    });
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
  if (financeApp) await financeApp.close();
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

/**
 * V1-37b-CURRENCY-PROJECTIONS: the V1-37 review findings whose repair lay
 * outside the V1-37 write set. Each was an it.todo here.
 */
describe('V1-37 review residuals (V1-37b): revenue scope on the commerce-ai reads (ST-V37-2)', () => {
  const B = `/commerce/businesses/${ID.bizTtd}`;
  /** Every business-scoped commerce-ai read route and the service read it reaches. */
  const AI_READ_ROUTES: Array<{ method: 'get' | 'post'; path: string; body?: Record<string, unknown>; reaches: string }> = [
    { method: 'get', path: `${B}/ai-cashflow`, reaches: 'cashFlowForecast' },
    { method: 'post', path: `${B}/ai-analyze`, reaches: 'analyzeRevenue' },
    { method: 'post', path: `${B}/invoices/${P}sT1/ai-reminder`, reaches: 'generateInvoiceReminder' },
    { method: 'post', path: `${B}/products/${P}product/ai-pricing`, reaches: 'suggestPricing' },
    { method: 'post', path: `${B}/ai-search`, body: { query: 'unpaid invoices' }, reaches: 'naturalLanguageSearch' },
    { method: 'post', path: `${B}/ai-product-health`, reaches: 'productHealthScan' },
    { method: 'post', path: `${B}/ai-client-intelligence`, body: { contactId: ID.contactT }, reaches: 'clientPaymentIntelligence' },
    { method: 'post', path: `${B}/ai-quote-analysis`, reaches: 'quoteWinAnalysis' },
    { method: 'post', path: `${B}/ai-command`, body: { command: 'show overdue invoices' }, reaches: 'interpretCommand' },
    { method: 'post', path: `${B}/ai-collections-score`, reaches: 'predictiveCollectionsScore' },
    { method: 'post', path: `${B}/invoices/${P}sT1/ai-payment-plan`, reaches: 'suggestPaymentPlan' },
    { method: 'post', path: `${B}/quotes/${P}quote/ai-follow-up`, reaches: 'smartQuoteFollowUp' },
    { method: 'post', path: `${B}/ai-churn-risk`, reaches: 'churnRiskAlerts' },
    { method: 'post', path: `${B}/ai-revenue-journey`, reaches: 'revenueJourney' },
    { method: 'post', path: `${B}/ai-quote-from-conversation`, body: { conversationText: 'v37a: two hours of consulting' }, reaches: 'quoteFromConversation' },
  ];
  function call(route: { method: 'get' | 'post'; path: string; body?: Record<string, unknown> }, as: string) {
    const req = route.method === 'get' ? agent().get(route.path) : agent().post(route.path).send(route.body ?? {});
    return req.set(HEADER, as);
  }

  it('ST-V37-2 RED-BEFORE: a revenue:none member gets 403 and nothing from GET stats and every commerce-ai read route; the service is never reached', async () => {
    // The routes cover every read the stub answers: no read route is left out.
    expect(AI_READ_ROUTES.map((r) => r.reaches).sort()).toEqual([...AI_READS].sort());
    aiCalls.length = 0;

    const stats = await agent().get(`${B}/stats`).set(HEADER, ID.memberNone);
    expect(stats.status, JSON.stringify(stats.body)).toBe(403);
    expect(JSON.stringify(stats.body)).toMatch(/revenue/);
    expect(JSON.stringify(stats.body)).not.toMatch(/byCurrency|totalRevenue|invoiceStatusBreakdown/);

    for (const route of AI_READ_ROUTES) {
      const res = await call(route, ID.memberNone);
      expect(res.status, `${route.method.toUpperCase()} ${route.path}: ${JSON.stringify(res.body)}`).toBe(403);
      expect(JSON.stringify(res.body), `${route.path} returns nothing of the read`).not.toContain(AI_SENTINEL);
    }
    expect(aiCalls, 'no refused route reached CommerceAiService').toEqual([]);
  }, 60_000);

  it('ST-V37-2 control: a revenue:read member and the owner still read stats and the commerce-ai reads (tenant-bound)', async () => {
    aiCalls.length = 0;
    for (const as of [ID.memberRead, ID.ownerT]) {
      const stats = await agent().get(`${B}/stats`).set(HEADER, as);
      expect(stats.status, JSON.stringify(stats.body)).toBe(200);
      expect(stats.body.byCurrency.TTD.totalRevenue).toBe(115);
    }
    // A few of the AI reads (the per-business AI rate limit is 10 a minute).
    for (const route of AI_READ_ROUTES.filter((r) => ['cashFlowForecast', 'analyzeRevenue', 'quoteFromConversation'].includes(r.reaches))) {
      const res = await call(route, ID.memberRead);
      expect(res.status, `${route.path}: ${JSON.stringify(res.body)}`).toBe(route.method === 'get' ? 200 : 201);
      expect(res.body).toEqual({ sentinel: AI_SENTINEL, method: route.reaches });
    }
    expect(aiCalls).toEqual([
      { method: 'cashFlowForecast', businessId: ID.bizTtd },
      { method: 'analyzeRevenue', businessId: ID.bizTtd },
      { method: 'quoteFromConversation', businessId: ID.bizTtd },
    ]);
    // Revenue read on one business is no access to another.
    const foreign = await agent().get(`/commerce/businesses/${ID.bizUsd}/ai-cashflow`).set(HEADER, ID.memberRead);
    expect(foreign.status).toBe(403);
    expect(aiCalls).toHaveLength(3);
  }, 60_000);
});

describe('V1-37 review residuals (V1-37b): the trial-balance projection is per (account, currency) (ST-V37-3 / RV37-01)', () => {
  it('ST-V37-3 / RV37-01 RED-BEFORE: GET trial-balance items carry currency, one per (account, currency), equal to the service rows; each currency balances', async () => {
    const res = await request(financeApp.getHttpServer()).get(`/finance/businesses/${ID.bizUsd}/trial-balance`).set(HEADER, ID.owner);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const items: any[] = res.body.items;
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) expect(item.currency, `${item.name} carries its currency`).toMatch(/^(TTD|USD)$/);

    // One item per (account, currency): nothing collapsed, nothing duplicated.
    const keys = items.map((i) => `${i.accountId}:${i.currency}`);
    expect(new Set(keys).size).toBe(items.length);

    // The projection is the service's rows, field for field.
    const rows: any[] = await ledgerBalance.getTrialBalance(ID.bizUsd);
    expect(items).toEqual(rows.map((r) => ({
      accountId: r.accountId,
      systemKey: r.systemKey,
      name: r.name,
      type: r.type,
      currency: r.currency,
      debit: r.debit.toString(),
      credit: r.credit.toString(),
      net: r.net.toString(),
    })));

    // Per currency the items balance; the book holds both currencies.
    const cents = (s: string) => Math.round(Number(s) * 100);
    for (const currency of ['TTD', 'USD']) {
      const mine = items.filter((i) => i.currency === currency);
      const debit = mine.reduce((s, i) => s + cents(i.debit), 0);
      const credit = mine.reduce((s, i) => s + cents(i.credit), 0);
      expect(debit, `${currency} debits = credits`).toBe(credit);
      expect(debit).toBeGreaterThan(0);
    }
    const ar = await coa.getBySystemKey(ID.bizUsd, 'ACCOUNTS_RECEIVABLE');
    expect(items.filter((i) => i.accountId === ar.id).map((i) => i.currency).sort()).toEqual(['TTD', 'USD']);

    // TENANT: the TTD business's owner cannot read the USD business's trial balance.
    const foreign = await request(financeApp.getHttpServer()).get(`/finance/businesses/${ID.bizUsd}/trial-balance`).set(HEADER, ID.ownerT);
    expect(foreign.status).toBe(403);
  }, 30_000);
});

describe('V1-37b review (SEC-V37b-1): a revenue:none member reads no revenue through the trial balance', () => {
  it('SEC-V37b-1 RED-BEFORE: GET trial-balance answers 403 and no rows to a revenue:none member; a revenue:read member and the owner read the REVENUE rows', async () => {
    // A revenue posting on the TTD business, so its trial balance holds a REVENUE row.
    const cash = await coa.getBySystemKey(ID.bizTtd, 'CASH');
    const revenue = await coa.getBySystemKey(ID.bizTtd, 'REVENUE');
    await posting.post({
      businessId: ID.bizTtd,
      type: 'INCOME',
      date: new Date(Date.now() - 60_000),
      amount: 777.77,
      description: 'v37a revenue (SEC-V37b-1)',
      entries: [
        { accountId: cash.id, debit: 777.77 },
        { accountId: revenue.id, credit: 777.77 },
      ],
    });
    const trialBalance = (as: string) =>
      request(financeApp.getHttpServer()).get(`/finance/businesses/${ID.bizTtd}/trial-balance`).set(HEADER, as);

    const refused = await trialBalance(ID.memberNone);
    expect(refused.status, JSON.stringify(refused.body)).toBe(403);
    expect(JSON.stringify(refused.body)).toMatch(/revenue/);
    expect(JSON.stringify(refused.body), 'no row of the trial balance is returned').not.toMatch(/777\.77|"items"|REVENUE/);

    for (const as of [ID.memberRead, ID.ownerT]) {
      const res = await trialBalance(as);
      expect(res.status, `${as}: ${JSON.stringify(res.body)}`).toBe(200);
      const rows = res.body.items.filter((i: any) => i.accountId === revenue.id);
      expect(rows.map((i: any) => i.currency), `${as} reads the TTD revenue row`).toEqual(['TTD']);
      expect(Number(rows[0].credit)).toBeGreaterThanOrEqual(777.77);
    }
  }, 30_000);

  it.todo(
    'SEC-V37b-1 residual, outside the V1-37b write set: GET /businesses/:id/reports/balance-sheet (reports.controller.ts, '
    + 'AuthGuard + BusinessGuard only) answers a revenue:none member 200 with accounts receivable per currency; it needs '
    + 'revenue:read on the reports controller (with its CSV / PDF export and the P&L, the same class)',
  );
  it.todo(
    'SEC-V37b-1 residual, outside the V1-37b write set: GET /commerce/businesses/:id/revenue-reports/:preset '
    + '(revenue-reporting.controller.ts, AuthGuard + BusinessGuard only) answers a revenue:none member 200 with invoice '
    + 'totals by contact; it needs ModuleScopeGuard + revenue:read like the commerce invoice reads',
  );
});

describe('V1-37 review residuals (V1-37b): the balance sheet never sums across currencies (RV37-02)', () => {
  it('RV37-02 RED-BEFORE: the top level is the business currency (USD) sheet; byCurrency holds one labelled sheet per currency, each equal to Postgres and balanced', async () => {
    const sheet = await reporting.getBalanceSheet(ID.bizUsd, new Date(Date.now() + 60_000));
    expect(sheet.currency).toBe('USD');
    const linesOf = (s: any) => [...s.assets.lines, ...s.liabilities.lines, ...s.equity.lines];

    // The top level is the business currency's sheet: every line is labelled USD.
    for (const l of linesOf(sheet)) expect(l.currency, `${l.name} is labelled`).toBe('USD');

    // Postgres' own sums per (currency, account type) over the USD business's book.
    const pg: Array<{ currency: string; type: string; d: string; c: string }> = await db.$queryRawUnsafe(
      `SELECT le.currency, coa.type, SUM(le.debit)::text AS d, SUM(le.credit)::text AS c
         FROM ledger_entries le JOIN chart_of_accounts coa ON coa.id = le.account_id
        WHERE le.business_id = $1 AND coa.business_id = $1
        GROUP BY le.currency, coa.type`,
      ID.bizUsd,
    );
    const cur = [...new Set(pg.map((r) => r.currency))].sort();
    expect(cur).toEqual(['TTD', 'USD']);
    expect(Object.keys(sheet.byCurrency ?? {}).sort()).toEqual(cur);

    const net = (currency: string, type: string, nature: 'debit' | 'credit') => {
      const r = pg.find((x) => x.currency === currency && x.type === type);
      if (!r) return 0;
      const v = Number(r.d) - Number(r.c);
      return Math.round((nature === 'debit' ? v : -v) * 100) / 100;
    };
    for (const currency of cur) {
      const s = sheet.byCurrency[currency];
      expect(s.currency).toBe(currency);
      for (const l of linesOf(s)) expect(l.currency, `${currency}: ${l.name} is labelled`).toBe(currency);
      // One line per account within a currency: never two unlabelled lines for one account.
      for (const section of [s.assets, s.liabilities, s.equity]) {
        const ids = section.lines.map((l: any) => l.accountId);
        expect(new Set(ids).size, `${currency}: one line per account`).toBe(ids.length);
      }
      expect(s.assets.total, `${currency} assets`).toBe(net(currency, 'ASSET', 'debit'));
      expect(s.liabilities.total, `${currency} liabilities`).toBe(net(currency, 'LIABILITY', 'credit'));
      expect(s.equity.total, `${currency} equity`).toBe(net(currency, 'EQUITY', 'credit'));
      const income = net(currency, 'INCOME', 'credit') - net(currency, 'COGS', 'debit') - net(currency, 'EXPENSE', 'debit');
      expect(s.netEquityFromIncome, `${currency} period income`).toBe(Math.round(income * 100) / 100);
      expect(s.identityHolds, `${currency}: assets = liabilities + equity`).toBe(true);
    }

    // The top level is exactly the business currency's section.
    const { byCurrency, ...top } = sheet;
    expect(top).toEqual(byCurrency.USD);

    // AR saw both currencies: in each currency's sheet it is one line carrying
    // that currency's own balance (absent when it nets to zero), never a sum.
    const ar = await coa.getBySystemKey(ID.bizUsd, 'ACCOUNTS_RECEIVABLE');
    const arNet: Array<{ currency: string; net: string }> = await db.$queryRawUnsafe(
      `SELECT currency, SUM(debit - credit)::text AS net FROM ledger_entries
        WHERE business_id = $1 AND account_id = $2 GROUP BY currency`,
      ID.bizUsd, ar.id,
    );
    expect(arNet.map((r) => r.currency).sort()).toEqual(['TTD', 'USD']);
    for (const { currency, net: n } of arNet) {
      const lines = sheet.byCurrency[currency].assets.lines.filter((l: any) => l.accountId === ar.id);
      const expected = Math.round(Number(n) * 100) / 100;
      if (expected === 0) expect(lines, `${currency} AR nets to zero`).toHaveLength(0);
      else expect(lines.map((l: any) => [l.currency, l.amount]), `${currency} AR`).toEqual([[currency, expected]]);
    }
  }, 30_000);

  it.todo(
    'RV37b-CR-03, outside the V1-37b write set: the balance-sheet CSV and PDF exports (report-formatters.ts '
    + 'balanceSheetToCsv / balanceSheetToPdf, served by reports.controller.ts) read the top-level business-currency '
    + 'sheet only and drop byCurrency; each other currency must be exported as its own labelled sheet, never summed. '
    + 'Until then the Books view says beside the sheets that the export carries the business currency only',
  );
});

describe('V1-37 review residuals (V1-37b): bank rules skip a row the door refuses for currency (RV37-04)', () => {
  it('RV37-04 RED-BEFORE: applyRules skips and reports the EUR row (400 at the door), posts the TTD and USD rows, never aborts', async () => {
    const bank = await coa.getBySystemKey(ID.bizTtd, 'BANK');
    const supplies = await coa.getBySystemKey(ID.bizTtd, 'EXPENSE_GENERAL');
    const accountIds = { EUR: `${P}faEur`, TTD: `${P}faTtd`, USD: `${P}faUsd` } as const;
    for (const [currency, id] of Object.entries(accountIds)) {
      await db.financialAccount.create({
        data: { id, businessId: ID.bizTtd, chartOfAccountId: bank.id, name: `V37A bank ${currency}`, type: 'BANK', currency },
      });
    }
    const rule = await db.bankRule.create({
      data: { id: `${P}rule`, businessId: ID.bizTtd, name: 'V37A supplies', pattern: 'v37a supplies', matchType: 'contains', accountId: supplies.id },
    });
    // The refused row first: before the repair its 400 aborted the run before the others.
    const rows = [
      { id: `${P}btEur`, accountId: accountIds.EUR, amount: -12.5, currency: 'EUR' },
      { id: `${P}btTtd`, accountId: accountIds.TTD, amount: -20, currency: 'TTD' },
      { id: `${P}btUsd`, accountId: accountIds.USD, amount: -7.25, currency: 'USD' },
    ];
    for (const [i, r] of rows.entries()) {
      await db.bankTransaction.create({
        data: {
          id: r.id, businessId: ID.bizTtd, accountId: r.accountId, currency: r.currency,
          date: new Date(Date.now() - (3 - i) * 60_000), description: `V37A supplies ${r.currency}`, amount: r.amount,
        },
      });
    }
    const before = await ledgerCount(ID.bizTtd);

    const result = await bankRules.applyRules(ID.bizTtd, rows.map((r) => r.id), { userId: ID.ownerT });
    expect(result.scanned).toBe(3);
    expect(result.matched).toBe(2);
    expect(result.createdTransactions).toBe(2);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]).toMatchObject({ bankTransactionId: `${P}btEur`, ruleId: rule.id });
    expect(result.skipped[0].reason).toMatch(/EUR/);

    // The refused row: UNMATCHED, nothing posted for it, and the skip is audited.
    const eur = await db.bankTransaction.findUnique({ where: { id: `${P}btEur` }, select: { status: true, matchedTransactionId: true } });
    expect(eur).toEqual({ status: 'UNMATCHED', matchedTransactionId: null });
    expect(await db.financialTransaction.count({ where: { businessId: ID.bizTtd, externalRef: `BankRule:${rule.id}:${P}btEur` } })).toBe(0);
    const audit = await db.teamActivityLog.findFirst({ where: { businessId: ID.bizTtd, entityId: `${P}btEur`, action: 'BANK_TRANSACTION_UNMATCHED' } });
    expect(audit?.detail).toMatch(/EUR/);

    // The others posted, each in its own account's currency, and are linked.
    for (const r of rows.slice(1)) {
      const row = await db.bankTransaction.findUnique({ where: { id: r.id }, select: { status: true, matchedTransactionId: true } });
      expect(row.status, `${r.id} matched`).toBe('MATCHED');
      const txn = await db.financialTransaction.findUnique({ where: { id: row.matchedTransactionId }, include: { entries: true } });
      expect(txn.externalRef).toBe(`BankRule:${rule.id}:${r.id}`);
      expect(txn.currency).toBe(r.currency);
      expect(new Set(txn.entries.map((e: any) => e.currency))).toEqual(new Set([r.currency]));
      expect(Number(txn.amount)).toBe(Math.abs(r.amount));
    }
    expect(await ledgerCount(ID.bizTtd)).toEqual({ transactions: before.transactions + 2, entries: before.entries + 4 });

    // Re-applying skips the refused row again and posts nothing new.
    const again = await bankRules.applyRules(ID.bizTtd, rows.map((r) => r.id), { userId: ID.ownerT });
    expect(again).toMatchObject({ scanned: 1, matched: 0, createdTransactions: 0 });
    expect(again.skipped.map((s: any) => s.bankTransactionId)).toEqual([`${P}btEur`]);
    expect(await ledgerCount(ID.bizTtd)).toEqual({ transactions: before.transactions + 2, entries: before.entries + 4 });
  }, 60_000);
});

/** Per account, debits less credits in cents. */
function netByAccount(entries: Array<{ accountId: string; debit: unknown; credit: unknown }>): Map<string, number> {
  const net = new Map<string, number>();
  for (const e of entries) {
    net.set(e.accountId, (net.get(e.accountId) ?? 0) + Math.round(Number(e.debit) * 100) - Math.round(Number(e.credit) * 100));
  }
  return net;
}

/** Every transaction a payment sourced (its recording, partial refunds and their reversals), with entries. */
function paymentTransactions(businessId: string, paymentId: string) {
  return db.financialTransaction.findMany({
    where: { businessId, sourceType: 'Payment', sourceId: paymentId },
    include: { entries: { include: { account: { select: { systemKey: true } } } } },
    orderBy: { createdAt: 'asc' },
  });
}

/**
 * V1-37d-LEGACY-CURRENCY-PAYMENTS (verify-money VR-04). The legacy book: before
 * D-13 the business kept JMD, so its invoices were JMD and issuing posted their
 * receivables in JMD through the real door (the business currency is always
 * postable). It then keeps TTD. Its JMD documents and receivables stay.
 */
describe('V1-37d legacy currency: money against a stored JMD invoice is still recorded (VR-04)', () => {
  const legacy: Record<'paid' | 'voided' | 'draft', string> = { paid: '', voided: '', draft: '' };
  let paymentId = '';

  beforeAll(async () => {
    await db.user.create({ data: { id: ID.ownerL, email: `${P}owner-legacy@test.local`, role: 'USER' } });
    await db.business.create({
      data: { id: ID.bizLegacy, name: 'V37A legacy JMD', slug: `${P}biz-legacy`, ownerId: ID.ownerL, currency: 'JMD', accountingBasis: 'ACCRUAL' },
    });
    await db.membership.create({ data: { id: `${ID.ownerL}_m`, userId: ID.ownerL, businessId: ID.bizLegacy, role: 'OWNER' } });
    await db.contact.create({
      data: { id: ID.contactL, businessId: ID.bizLegacy, firstName: 'V37a', lastName: 'Legacy', email: `${P}contact-legacy@test.local` },
    });
    await coa.ensureDefaults(ID.bizLegacy);
    for (const [key, amount, issued] of [['paid', 100, true], ['voided', 60, true], ['draft', 40, false]] as const) {
      const created = await createInvoice(ID.bizLegacy, ID.ownerL, {
        contactId: ID.contactL,
        items: [{ description: `v37d legacy ${key}`, quantity: 1, unitPrice: amount }],
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      expect(created.body.currency).toBe('JMD');
      legacy[key] = created.body.id;
      if (issued) {
        const sent = await issue(ID.bizLegacy, ID.ownerL, created.body.id);
        expect(sent.status, JSON.stringify(sent.body)).toBe(200);
        const ar = await db.financialTransaction.findUnique({
          where: { businessId_externalRef: { businessId: ID.bizLegacy, externalRef: `Invoice:${created.body.id}:invoice_finalized` } },
          select: { currency: true },
        });
        expect(ar?.currency, `${key}: its receivable posted in JMD`).toBe('JMD');
      }
    }
    // D-13: the business now keeps TTD.
    await db.business.update({ where: { id: ID.bizLegacy }, data: { currency: 'TTD' } });
  }, 60_000);

  it('LC-01 RED-BEFORE (VR-04): POST payments {amount 50} on the SENT JMD invoice of the TTD business -> 201, payment [SUCCESSFUL, 50, JMD], posting [INCOME, JMD, 50], PARTIALLY_PAID', async () => {
    const before = await ledgerCount(ID.bizLegacy);
    const res = await pay(ID.bizLegacy, ID.ownerL, legacy.paid, 50);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    paymentId = res.body.payment.id;
    const row = await db.payment.findUnique({ where: { id: paymentId }, select: { status: true, amount: true, currency: true, invoiceId: true } });
    expect(row).toEqual({ status: 'SUCCESSFUL', amount: 50, currency: 'JMD', invoiceId: legacy.paid });

    const txns = await paymentTransactions(ID.bizLegacy, paymentId);
    expect(txns).toHaveLength(1);
    const [txn] = txns;
    expect({ type: txn.type, currency: txn.currency, amount: Number(txn.amount), status: txn.status }).toEqual({
      type: 'INCOME', currency: 'JMD', amount: 50, status: 'POSTED',
    });
    expect(new Set(txn.entries.map((e: any) => e.currency))).toEqual(new Set(['JMD']));
    const debit = txn.entries.reduce((s: number, e: any) => s + Number(e.debit), 0);
    const credit = txn.entries.reduce((s: number, e: any) => s + Number(e.credit), 0);
    expect({ debit, credit }).toEqual({ debit: 50, credit: 50 });
    // ACCRUAL: the cash comes in and the JMD receivable is cleared.
    expect(txn.entries.filter((e: any) => Number(e.credit) > 0).map((e: any) => e.account.systemKey)).toEqual(['ACCOUNTS_RECEIVABLE']);
    expect(txn.entries.filter((e: any) => Number(e.debit) > 0).map((e: any) => e.account.systemKey)).toEqual(['CASH']);

    const invoice = await db.invoice.findUnique({ where: { id: legacy.paid }, select: { status: true, currency: true } });
    expect(invoice).toEqual({ status: 'PARTIALLY_PAID', currency: 'JMD' });
    expect(await ledgerCount(ID.bizLegacy)).toEqual({ transactions: before.transactions + 1, entries: before.entries + 2 });
  }, 30_000);

  it('LC-02 RED-BEFORE: a partial refund posts a JMD REFUND; the manual refund of the rest reverses the recording and the partial in JMD; the payment nets to zero', async () => {
    expect(paymentId, 'LC-01 recorded the payment').not.toBe('');
    const original = await db.payment.findUnique({ where: { id: paymentId }, select: { providerPaymentId: true } });
    // The provider refund door's recipe (PaymentsService.createRefundWithPosting):
    // the REFUNDED row linked to the payment and its posting, in one transaction.
    await db.$transaction(async (tx: any) => {
      const row = await tx.payment.create({
        data: {
          provider: 'cash', method: 'cash', providerPaymentId: `${P}jmd-refund-1`, amount: -20, currency: 'JMD',
          status: 'REFUNDED', invoiceId: legacy.paid, businessId: ID.bizLegacy, reference: original.providerPaymentId,
        },
      });
      await revenuePosting.onPaymentRefunded(paymentId, { tx, refund: { paymentId: row.id, amount: 20 } });
    });
    const partial = await db.financialTransaction.findUnique({
      where: { businessId_externalRef: { businessId: ID.bizLegacy, externalRef: `Payment:${paymentId}:payment_refunded:1` } },
      include: { entries: true },
    });
    expect(partial, 'the partial refund posted').not.toBeNull();
    expect({ type: partial.type, currency: partial.currency, amount: Number(partial.amount) }).toEqual({ type: 'REFUND', currency: 'JMD', amount: 20 });
    expect(new Set(partial.entries.map((e: any) => e.currency))).toEqual(new Set(['JMD']));

    const refund = await agent()
      .post(`/commerce/businesses/${ID.bizLegacy}/payments/${paymentId}/refund`)
      .set(HEADER, ID.ownerL)
      .send({ reason: 'v37d legacy refund' });
    expect(refund.status, JSON.stringify(refund.body)).toBe(201);
    expect(refund.body).toMatchObject({ amount: -30, currency: 'JMD', status: 'REFUNDED' });

    const txns = await paymentTransactions(ID.bizLegacy, paymentId);
    expect(txns.map((t: any) => t.type).sort()).toEqual(['INCOME', 'REFUND', 'REVERSAL', 'REVERSAL']);
    for (const t of txns) {
      expect(t.currency, `${t.type} ${t.id}`).toBe('JMD');
      expect(new Set(t.entries.map((e: any) => e.currency))).toEqual(new Set(['JMD']));
    }
    for (const [account, cents] of netByAccount(txns.flatMap((t: any) => t.entries))) {
      expect(cents, `${account} nets to zero over the payment`).toBe(0);
    }
  }, 30_000);

  it('LC-03 RED-BEFORE: paying the invoice in full -> PAID; its receivable closes in JMD and never saw TTD', async () => {
    const res = await pay(ID.bizLegacy, ID.ownerL, legacy.paid, 100);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(await db.payment.findUnique({ where: { id: res.body.payment.id }, select: { currency: true } })).toEqual({ currency: 'JMD' });
    expect(await db.invoice.findUnique({ where: { id: legacy.paid }, select: { status: true } })).toEqual({ status: 'PAID' });

    const ar = await coa.getBySystemKey(ID.bizLegacy, 'ACCOUNTS_RECEIVABLE');
    const arRows: Array<{ currency: string; d: string; c: string }> = await db.$queryRawUnsafe(
      `SELECT le.currency, SUM(le.debit)::text AS d, SUM(le.credit)::text AS c
         FROM ledger_entries le JOIN financial_transactions ft ON ft.id = le.transaction_id
        WHERE le.business_id = $1 AND le.account_id = $2
          AND (ft.source_id = $3 OR ft.source_id IN (SELECT id FROM payments WHERE invoice_id = $3))
        GROUP BY le.currency`,
      ID.bizLegacy, ar.id, legacy.paid,
    );
    // Dr 100 issue + 20 partial refund + 50 reversal; Cr 50 + 20 reversal of the partial + 100.
    expect(arRows.map((r) => ({ currency: r.currency, d: Number(r.d), c: Number(r.c) }))).toEqual([{ currency: 'JMD', d: 170, c: 170 }]);
  }, 30_000);

  it('LC-04 control: voiding the other legacy JMD invoice reverses its receivable in JMD', async () => {
    const voided = await agent()
      .patch(`/commerce/invoices/${legacy.voided}/status/void`)
      .set(HEADER, ID.ownerL)
      .send({ businessId: ID.bizLegacy, status: 'VOID' });
    expect(voided.status, JSON.stringify(voided.body)).toBe(200);
    const txns = await db.financialTransaction.findMany({
      where: { businessId: ID.bizLegacy, sourceType: 'Invoice', sourceId: legacy.voided },
      include: { entries: true },
    });
    expect(txns.map((t: any) => `${t.type}:${t.status}`).sort()).toEqual(['INCOME:REVERSED', 'REVERSAL:POSTED']);
    for (const t of txns) {
      expect(t.currency).toBe('JMD');
      expect(Number(t.amount)).toBe(60);
      expect(new Set(t.entries.map((e: any) => e.currency))).toEqual(new Set(['JMD']));
    }
  }, 30_000);

  it('LC-05 control: new documents and free-standing postings keep the D-13 refusal (400, nothing written)', async () => {
    // A new JMD invoice on the TTD business.
    const invoices = await db.invoice.count({ where: { businessId: ID.bizLegacy } });
    const jmd = await createInvoice(ID.bizLegacy, ID.ownerL, { contactId: ID.contactL, currency: 'JMD', items: [{ description: 'v37d new jmd', quantity: 1, unitPrice: 10 }] });
    expect(jmd.status, JSON.stringify(jmd.body)).toBe(400);
    expect(JSON.stringify(jmd.body)).toMatch(/JMD/);
    expect(await db.invoice.count({ where: { businessId: ID.bizLegacy } })).toBe(invoices);

    // Issuing the legacy JMD draft would create a new JMD receivable: refused, the draft stays a draft.
    const ledger = await ledgerCount(ID.bizLegacy);
    const sent = await issue(ID.bizLegacy, ID.ownerL, legacy.draft);
    expect(sent.status, JSON.stringify(sent.body)).toBe(400);
    expect(JSON.stringify(sent.body)).toMatch(/JMD/);
    expect(await db.invoice.findUnique({ where: { id: legacy.draft }, select: { status: true, currency: true } })).toEqual({ status: 'DRAFT', currency: 'JMD' });
    expect(await ledgerCount(ID.bizLegacy)).toEqual(ledger);
    // ...it may move to the business currency (a DRAFT may), then issue and take a TTD payment.
    const moved = await agent().patch(`/commerce/businesses/${ID.bizLegacy}/invoices/${legacy.draft}`).set(HEADER, ID.ownerL).send({ currency: 'TTD' });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    expect((await issue(ID.bizLegacy, ID.ownerL, legacy.draft)).status).toBe(200);
    const ttdPaid = await pay(ID.bizLegacy, ID.ownerL, legacy.draft, 40);
    expect(ttdPaid.status, JSON.stringify(ttdPaid.body)).toBe(201);
    const ttdPaymentId = ttdPaid.body.payment.id;
    expect(await db.payment.findUnique({ where: { id: ttdPaymentId }, select: { currency: true } })).toEqual({ currency: 'TTD' });

    // Free-standing and wrongly-sourced JMD postings through the real door.
    const before = await ledgerCount(ID.bizLegacy);
    for (const over of [
      { currency: 'JMD' }, // sourceless
      { currency: 'JMD', sourceType: 'V37aFixture', sourceId: `${P}doc-jmd`, kind: 'v37d-probe' }, // not a payment
      { currency: 'JMD', sourceType: 'Invoice', sourceId: legacy.paid, kind: 'v37d-probe' }, // the invoice itself, not money following it
      { currency: 'JMD', sourceType: 'Payment', sourceId: ttdPaymentId, kind: 'v37d-probe' }, // a payment of a TTD invoice
      { currency: 'JMD', sourceType: 'Payment', sourceId: `${P}no-such-payment`, kind: 'v37d-probe' }, // no such payment
    ]) {
      await expect(postAdjustment(ID.bizLegacy, 5, over), JSON.stringify(over)).rejects.toMatchObject({ status: 400 });
    }
    expect(await ledgerCount(ID.bizLegacy)).toEqual(before);

    // Another business cannot borrow the legacy business's JMD payment.
    const foreign = await ledgerCount(ID.bizTtd);
    await expect(
      postAdjustment(ID.bizTtd, 5, { currency: 'JMD', sourceType: 'Payment', sourceId: paymentId, kind: 'v37d-probe' }),
    ).rejects.toMatchObject({ status: 400 });
    expect(await ledgerCount(ID.bizTtd)).toEqual(foreign);
  }, 60_000);

  it('LC-06 RED-BEFORE: the trial balance per currency balances with JMD rows (CASH JMD 100 net) and equals Postgres per (account, currency)', async () => {
    const rows: any[] = await ledgerBalance.getTrialBalance(ID.bizLegacy);
    const independent: Array<{ account_id: string; currency: string; debit: string; credit: string }> = await db.$queryRawUnsafe(
      `SELECT account_id, currency, SUM(debit)::text AS debit, SUM(credit)::text AS credit
         FROM ledger_entries WHERE business_id = $1 GROUP BY account_id, currency`,
      ID.bizLegacy,
    );
    expect(new Set(independent.map((r) => r.currency))).toEqual(new Set(['JMD', 'TTD']));
    for (const g of independent) {
      const row = rows.find((r) => r.accountId === g.account_id && r.currency === g.currency);
      expect(row, `${g.account_id} ${g.currency} has its own row`).toBeDefined();
      expect(Number(row.debit), `${g.account_id} ${g.currency} debit`).toBe(Number(g.debit));
      expect(Number(row.credit), `${g.account_id} ${g.currency} credit`).toBe(Number(g.credit));
    }
    for (const currency of ['JMD', 'TTD']) {
      const mine = rows.filter((r) => r.currency === currency);
      const debit = Math.round(mine.reduce((s, r) => s + Number(r.debit), 0) * 100);
      const credit = Math.round(mine.reduce((s, r) => s + Number(r.credit), 0) * 100);
      expect(debit, `${currency} debits = credits`).toBe(credit);
      expect(debit).toBeGreaterThan(0);
    }
    // The cash the legacy payments brought in: 50 - 20 - 30 refunded + 100 = 100 JMD, in its own row.
    const cash = await coa.getBySystemKey(ID.bizLegacy, 'CASH');
    const cashJmd = rows.find((r) => r.accountId === cash.id && r.currency === 'JMD');
    expect(cashJmd, 'CASH has a JMD row').toBeDefined();
    expect(Number(cashJmd.debit) - Number(cashJmd.credit)).toBe(100);
  }, 30_000);
});

/**
 * V1-37d: a recurring schedule is a document generator. It is held to D-13
 * when it is created or edited (the CommerceService.documentCurrency rule:
 * none named -> the business currency; a named one must be the business
 * currency or a D-13 currency) and when it generates (a schedule stored in
 * another currency before D-13 bills nothing and records why).
 */
describe('V1-37d recurring schedules are held to D-13 when created and when they generate', () => {
  const schedules = (biz: string) => `/commerce/businesses/${biz}/recurring-invoices`;
  // V1-37d review (CR-V37D-3): due a year from now, never on a fixed date, so
  // these ACTIVE schedules never fall due while the suite runs (LC-07d).
  const body = (contactId: string, over: Record<string, unknown> = {}) => ({
    contactId,
    name: 'V37D retainer',
    frequency: 'MONTHLY',
    amount: 75,
    startDate: '2026-11-01T00:00:00Z',
    nextRunDate: new Date(Date.now() + 365 * 86_400_000).toISOString(),
    ...over,
  });

  beforeAll(async () => {
    await db.user.upsert({ where: { id: ID.ownerL }, update: {}, create: { id: ID.ownerL, email: `${P}owner-legacy@test.local`, role: 'USER' } });
    await db.business.create({
      data: { id: ID.bizCash, name: 'V37A cash TTD', slug: `${P}biz-cash`, ownerId: ID.ownerL, currency: 'TTD', accountingBasis: 'CASH' },
    });
    await db.membership.create({ data: { id: `${ID.ownerL}_mc`, userId: ID.ownerL, businessId: ID.bizCash, role: 'OWNER' } });
    await db.contact.create({
      data: { id: ID.contactC, businessId: ID.bizCash, firstName: 'V37a', lastName: 'Cash', email: `${P}contact-cash@test.local` },
    });
    await coa.ensureDefaults(ID.bizCash);
  }, 60_000);

  afterAll(async () => {
    if (db) await db.recurringInvoice.updateMany({ where: { businessId: ID.bizCash }, data: { status: 'CANCELLED' } });
  });

  it('LC-07a RED-BEFORE: POST a JMD schedule on a TTD business -> 400 naming JMD, nothing written; a supported one is stored upper-case', async () => {
    const before = await db.recurringInvoice.count({ where: { businessId: ID.bizCash } });
    const jmd = await agent().post(schedules(ID.bizCash)).set(HEADER, ID.ownerL).send(body(ID.contactC, { currency: 'JMD' }));
    expect(jmd.status, JSON.stringify(jmd.body)).toBe(400);
    expect(JSON.stringify(jmd.body)).toMatch(/JMD/);
    expect(await db.recurringInvoice.count({ where: { businessId: ID.bizCash } })).toBe(before);

    const usd = await agent().post(schedules(ID.bizCash)).set(HEADER, ID.ownerL).send(body(ID.contactC, { currency: 'usd' }));
    expect(usd.status, JSON.stringify(usd.body)).toBe(201);
    expect(usd.body.currency).toBe('USD');
    expect((await db.recurringInvoice.findUnique({ where: { id: usd.body.id }, select: { currency: true } })).currency).toBe('USD');
  }, 30_000);

  it('LC-07b RED-BEFORE: a schedule that names no currency is in the business currency (USD on the USD business; it was the literal TTD)', async () => {
    const res = await agent().post(schedules(ID.bizUsd)).set(HEADER, ID.owner).send(body(ID.contactU));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.currency).toBe('USD');
    expect((await db.recurringInvoice.findUnique({ where: { id: res.body.id }, select: { currency: true } })).currency).toBe('USD');
    await db.recurringInvoice.update({ where: { id: res.body.id }, data: { status: 'CANCELLED' } });
  }, 30_000);

  it('LC-07c RED-BEFORE: PATCH {currency: JMD} -> 400 and the schedule keeps its currency; PATCH {currency: ttd} -> TTD', async () => {
    const created = await agent().post(schedules(ID.bizCash)).set(HEADER, ID.ownerL).send(body(ID.contactC));
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.currency).toBe('TTD');
    const jmd = await agent().patch(`${schedules(ID.bizCash)}/${created.body.id}`).set(HEADER, ID.ownerL).send({ currency: 'JMD', name: 'v37d should not land' });
    expect(jmd.status, JSON.stringify(jmd.body)).toBe(400);
    expect(await db.recurringInvoice.findUnique({ where: { id: created.body.id }, select: { currency: true, name: true } })).toEqual({
      currency: 'TTD', name: 'V37D retainer',
    });
    const usd = await agent().patch(`${schedules(ID.bizCash)}/${created.body.id}`).set(HEADER, ID.ownerL).send({ currency: 'usd' });
    expect(usd.status, JSON.stringify(usd.body)).toBe(200);
    expect(usd.body.currency).toBe('USD');
    const ttd = await agent().patch(`${schedules(ID.bizCash)}/${created.body.id}`).set(HEADER, ID.ownerL).send({ currency: 'ttd' });
    expect(ttd.status, JSON.stringify(ttd.body)).toBe(200);
    expect(ttd.body.currency).toBe('TTD');
  }, 30_000);

  it('LC-07d RED-BEFORE: a legacy JMD schedule on a CASH business generates no invoice, records the failure and is paused; its TTD schedule is billed (control)', async () => {
    // Nothing else of the business is due: the schedules created above fall due a year from now.
    const due = new Date(Date.now() - 60_000);
    for (const [key, currency] of [['recJmd', 'JMD'], ['recTtd', 'TTD']] as const) {
      await db.recurringInvoice.create({
        data: {
          id: `${P}${key}`, businessId: ID.bizCash, contactId: ID.contactC, name: `V37D ${currency} retainer`,
          description: `v37d ${currency} retainer`, frequency: 'MONTHLY', amount: 75, currency,
          startDate: new Date('2026-01-01T00:00:00Z'), nextRunDate: due, status: 'ACTIVE',
        },
      });
    }
    const result = await recurringRunner.processRecurringInvoices();
    expect(result.map((r: any) => r.recurringId)).toEqual([`${P}recTtd`]);

    // The legacy JMD schedule: no invoice, the period still due, the failure recorded.
    expect(await db.invoice.count({ where: { recurringInvoiceId: `${P}recJmd` } })).toBe(0);
    const jmd = await db.recurringInvoice.findUnique({
      where: { id: `${P}recJmd` },
      select: { nextRunDate: true, generatedCount: true, failureCount: true, lastError: true, status: true },
    });
    expect(jmd.nextRunDate.getTime()).toBe(due.getTime());
    expect(jmd.generatedCount).toBe(0);
    expect(jmd.failureCount).toBe(1);
    expect(jmd.lastError).toMatch(/JMD/);
    // V1-37d review (ST-V37D-2): paused, so the next runs neither bill nor report it again.
    expect(jmd.status).toBe('PAUSED');

    // The TTD schedule: one SENT TTD invoice.
    const billed = await db.invoice.findMany({ where: { recurringInvoiceId: `${P}recTtd` }, select: { status: true, currency: true, total: true } });
    expect(billed).toEqual([{ status: 'SENT', currency: 'TTD', total: 75 }]);
  }, 60_000);

  it('LC-07e RED-BEFORE (ST-V37D-2 / CR-V37D-2): a legacy JMD schedule never emits recurring_invoice.due; it is reported once and paused; edited to TTD and resumed, it bills the period that was due', async () => {
    const { RecurringInvoiceService } = await import('../src/modules/commerce/recurring-invoice.service');
    const events: Array<{ name: string; payload: any }> = [];
    const recorder = { ...eventStub, emit: (name: string, payload: any) => { events.push({ name, payload }); return true; } };
    const runner = new RecurringInvoiceService({ client: recurringClient } as any, recorder as any, invoiceWorkflow);
    const id = `${P}recJmd2`;
    const due = new Date(Date.now() - 60_000);
    await db.recurringInvoice.create({
      data: {
        id, businessId: ID.bizCash, contactId: ID.contactC, name: 'V37D JMD retainer 2', description: 'v37d JMD retainer 2',
        frequency: 'MONTHLY', amount: 75, currency: 'JMD', startDate: new Date('2026-01-01T00:00:00Z'), nextRunDate: due, status: 'ACTIVE',
      },
    });
    const mine = (name: string) => events.filter((e) => e.name === name && e.payload?.recurringInvoice?.id === id);

    for (let run = 0; run < 3; run += 1) await runner.processRecurringInvoices();
    expect(mine('recurring_invoice.due'), 'due is never emitted for a schedule D-13 refuses').toHaveLength(0);
    expect(mine('recurring_invoice.failed')).toHaveLength(1);
    expect(mine('recurring_invoice.failed')[0].payload.error).toMatch(/JMD/);
    expect(await db.invoice.count({ where: { recurringInvoiceId: id } })).toBe(0);
    const paused = await db.recurringInvoice.findUnique({
      where: { id },
      select: { status: true, nextRunDate: true, failureCount: true, generatedCount: true, lastError: true },
    });
    expect(paused.status).toBe('PAUSED');
    expect(paused.nextRunDate.getTime()).toBe(due.getTime());
    expect({ failureCount: paused.failureCount, generatedCount: paused.generatedCount }).toEqual({ failureCount: 1, generatedCount: 0 });
    expect(paused.lastError).toMatch(/JMD/);

    // The owner moves it to the business currency (held to D-13) and resumes it, through the real routes.
    const edited = await agent().patch(`${schedules(ID.bizCash)}/${id}`).set(HEADER, ID.ownerL).send({ currency: 'TTD' });
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    const resumed = await agent().post(`${schedules(ID.bizCash)}/${id}/resume`).set(HEADER, ID.ownerL).send({});
    expect(resumed.status, JSON.stringify(resumed.body)).toBe(201);
    events.length = 0;
    const billed = await runner.processRecurringInvoices();
    expect(billed.map((r: any) => r.recurringId)).toEqual([id]);
    expect(mine('recurring_invoice.due')).toHaveLength(1);
    expect(mine('recurring_invoice.failed')).toHaveLength(0);
    expect(await db.invoice.findMany({ where: { recurringInvoiceId: id }, select: { status: true, currency: true, total: true } })).toEqual([
      { status: 'SENT', currency: 'TTD', total: 75 },
    ]);
    const after = await db.recurringInvoice.findUnique({ where: { id }, select: { status: true, nextRunDate: true, generatedCount: true, failureCount: true } });
    expect(after.status).toBe('ACTIVE');
    expect(after.nextRunDate.getTime()).toBeGreaterThan(due.getTime());
    expect({ generatedCount: after.generatedCount, failureCount: after.failureCount }).toEqual({ generatedCount: 1, failureCount: 0 });
  }, 60_000);
});

/**
 * V1-37d review (ST-V37D-1 / CR-V37D-1, ST-V37D-3): the ledger exception is
 * bound to a legacy invoice: one stored before D13_DOCUMENTS_FROM, or whose
 * money the ledger already holds in its currency (the receivables of LC-01).
 * On CASH there is no receivable, so the date marks it. A new document in an
 * unsupported currency, from a writer that does not check yet (the storefront
 * checkout here), keeps the V1-37 refusal at the door.
 */
describe('V1-37d review: only money that follows a legacy invoice keeps its currency', () => {
  /** A row the base wrote before D-13 held new documents. */
  const LEGACY_CREATED = new Date('2026-06-01T00:00:00Z');

  beforeAll(async () => {
    await db.user.upsert({ where: { id: ID.ownerL }, update: {}, create: { id: ID.ownerL, email: `${P}owner-legacy@test.local`, role: 'USER' } });
    await db.business.create({
      data: { id: ID.bizNew, name: 'V37A new CASH TTD', slug: `${P}biz-new`, ownerId: ID.ownerL, currency: 'TTD', accountingBasis: 'CASH' },
    });
    await db.membership.create({ data: { id: `${ID.ownerL}_mn`, userId: ID.ownerL, businessId: ID.bizNew, role: 'OWNER' } });
    await db.contact.create({
      data: { id: ID.contactN, businessId: ID.bizNew, firstName: 'V37a', lastName: 'New', email: `${P}contact-new@test.local` },
    });
    await coa.ensureDefaults(ID.bizNew);
  }, 60_000);

  /** An invoice row as a writer leaves it: SENT, in `currency`, created at `createdAt`. */
  async function storedInvoice(key: string, currency: string, total: number, createdAt: Date, productId?: string) {
    return db.invoice.create({
      data: {
        id: `${P}inv_${key}`, businessId: ID.bizNew, contactId: ID.contactN, invoiceNumber: `${P}INV-${key}`, status: 'SENT',
        subtotal: total, total, currency, issueDate: createdAt, createdAt,
        items: { create: [{ description: `v37d ${key}`, quantity: 1, unitPrice: total, total, ...(productId ? { productId } : {}) }] },
      },
    });
  }

  it('LC-09 fixture: LEGACY_CREATED lies before the door\'s D13_DOCUMENTS_FROM, and now lies after it', async () => {
    const { D13_DOCUMENTS_FROM } = (await import('../src/modules/finance/posting.service')) as any;
    expect(D13_DOCUMENTS_FROM).toBeInstanceOf(Date);
    expect(LEGACY_CREATED.getTime()).toBeLessThan(D13_DOCUMENTS_FROM.getTime());
    expect(Date.now()).toBeGreaterThanOrEqual(D13_DOCUMENTS_FROM.getTime());
  });

  it('LC-08 RED-BEFORE (ST-V37D-1 / CR-V37D-1): a NEW storefront order priced JMD or zzz, and the storefront recipe in EUR, are refused at the door (400) and write nothing', async () => {
    const { StoreOrderService } = await import('../src/modules/site/store-order.service');
    for (const cur of ['JMD', 'zzz']) {
      const product = await db.product.create({
        data: { id: `${P}prod_${cur}`, businessId: ID.bizNew, name: `v37d ${cur} widget`, price: 25, currency: cur, category: 'PRODUCT', inventoryMode: 'untracked' },
      });
      const store = new StoreOrderService(
        prismaRef,
        eventStub as any,
        { incrementUsage: async () => null, validate: async () => null } as any,
        { findOrCreateContact: async () => ({ id: ID.contactN }) } as any,
        { logStorefrontEvent: async () => null, upsertStorefrontContact: async () => ({ id: ID.contactN }), backstitchVisitor: async () => null } as any,
        invoiceWorkflow,
        { evaluateProduct: async () => null } as any,
        { record: async () => null } as any,
        revenuePosting,
      );
      const order = await store.createOrder({
        businessId: ID.bizNew,
        cartItems: [{ productId: product.id, quantity: 2 }],
        customerInfo: { name: 'V37d Buyer', email: `${P}buyer-${cur}@test.local` },
        paymentMethod: 'CARD',
      });
      // The unchecked writer: the order carries the product's currency as given.
      expect(order.currency).toBe(cur);
      const before = await ledgerCount(ID.bizNew);
      const outcome = await store.completeCheckout({ orderId: order.id, provider: 'wipay', method: 'card', paymentRef: `${P}ref_${cur}` })
        .then(() => ({ status: 201, message: 'completed' }), (e: any) => ({ status: e?.status, message: String(e?.message) }));
      expect(outcome.status, outcome.message).toBe(400);
      expect(outcome.message).toMatch(new RegExp(`Unsupported posting currency ${cur.toUpperCase()}`));
      expect(await db.invoice.count({ where: { businessId: ID.bizNew, notes: { contains: order.orderNumber } } })).toBe(0);
      expect(await db.payment.count({ where: { providerPaymentId: `${P}ref_${cur}` } })).toBe(0);
      expect(await ledgerCount(ID.bizNew)).toEqual(before);
      expect((await db.marketplaceOrder.findUnique({ where: { id: order.id }, select: { paymentStatus: true } })).paymentStatus).not.toBe('PAID');
    }

    // The storefront recipe for an ISO currency outside D-13: invoice, payment and posting in one transaction.
    const before = await ledgerCount(ID.bizNew);
    const eur = await db.$transaction(async (tx: any) => {
      const inv = await tx.invoice.create({
        data: { id: `${P}inv_eur`, businessId: ID.bizNew, contactId: ID.contactN, invoiceNumber: `${P}INV-eur`, status: 'PAID', subtotal: 30, total: 30, currency: 'EUR', issueDate: new Date() },
      });
      const row = await tx.payment.create({
        data: { businessId: ID.bizNew, invoiceId: inv.id, amount: 30, currency: 'EUR', status: 'SUCCESSFUL', provider: 'wipay', method: 'card', providerPaymentId: `${P}ref_eur` },
      });
      await revenuePosting.onPaymentRecorded(row.id, { tx });
      return 'posted';
    }).catch((e: any) => ({ status: e?.status, message: String(e?.message) }));
    expect(eur).toMatchObject({ status: 400 });
    expect((eur as any).message).toMatch(/Unsupported posting currency EUR/);
    expect(await db.invoice.count({ where: { id: `${P}inv_eur` } })).toBe(0);
    expect(await db.payment.count({ where: { providerPaymentId: `${P}ref_eur` } })).toBe(0);
    expect(await ledgerCount(ID.bizNew)).toEqual(before);
  }, 60_000);

  it('LC-09a (VR-04 on CASH): POST payments on a SENT JMD invoice stored before D-13 -> 201, posting [INCOME, JMD] (Dr CASH, Cr REVENUE); on one written now -> 400, nothing written (RED-BEFORE)', async () => {
    const legacy = await storedInvoice('cash_legacy', 'JMD', 100, LEGACY_CREATED);
    const before = await ledgerCount(ID.bizNew);
    const res = await pay(ID.bizNew, ID.ownerL, legacy.id, 40);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const paymentId = res.body.payment.id;
    expect(await db.payment.findUnique({ where: { id: paymentId }, select: { currency: true, amount: true, status: true } })).toEqual({
      currency: 'JMD', amount: 40, status: 'SUCCESSFUL',
    });
    const [txn, ...rest] = await paymentTransactions(ID.bizNew, paymentId);
    expect(rest).toHaveLength(0);
    expect({ type: txn.type, currency: txn.currency, amount: Number(txn.amount) }).toEqual({ type: 'INCOME', currency: 'JMD', amount: 40 });
    expect(new Set(txn.entries.map((e: any) => e.currency))).toEqual(new Set(['JMD']));
    expect(txn.entries.filter((e: any) => Number(e.debit) > 0).map((e: any) => e.account.systemKey)).toEqual(['CASH']);
    expect(txn.entries.filter((e: any) => Number(e.credit) > 0).map((e: any) => e.account.systemKey)).toEqual(['REVENUE']);
    expect(await db.invoice.findUnique({ where: { id: legacy.id }, select: { status: true } })).toEqual({ status: 'PARTIALLY_PAID' });
    expect(await ledgerCount(ID.bizNew)).toEqual({ transactions: before.transactions + 1, entries: before.entries + 2 });

    // A JMD invoice written now (a writer that does not check D-13 yet) is a new document: its money is refused.
    const fresh = await storedInvoice('cash_new', 'JMD', 100, new Date());
    const refused = await pay(ID.bizNew, ID.ownerL, fresh.id, 40);
    expect(refused.status, JSON.stringify(refused.body)).toBe(400);
    expect(JSON.stringify(refused.body)).toMatch(/JMD/);
    expect(await db.payment.count({ where: { invoiceId: fresh.id } })).toBe(0);
    expect(await db.invoice.findUnique({ where: { id: fresh.id }, select: { status: true } })).toEqual({ status: 'SENT' });
    expect(await ledgerCount(ID.bizNew)).toEqual({ transactions: before.transactions + 1, entries: before.entries + 2 });
  }, 30_000);

  it('LC-09b RED-BEFORE (ST-V37D-3): the final payment of a legacy JMD invoice with an inventory-costed line posts its COGS in JMD and keeps the payment', async () => {
    const { InvoiceWorkflowService } = await import('../src/modules/commerce/invoice-workflow.service');
    const { ExpensePostingService } = await import('../src/modules/finance/expense-posting.service');
    // CommerceService.recordPayment's recipe over the real COGS posting (the app's ExpensePostingService is a no-op stub).
    const workflow = new InvoiceWorkflowService(prismaRef, eventStub as any, revenuePosting, new ExpensePostingService(prismaRef, posting, coa));
    const product = await db.product.create({ data: { id: `${P}prod_cost`, businessId: ID.bizNew, name: 'v37d costed', price: 30, currency: 'JMD', category: 'PRODUCT' } });
    const warehouse = await db.warehouse.create({ data: { id: `${P}wh`, businessId: ID.bizNew, name: 'v37d warehouse' } });
    await db.inventoryStock.create({ data: { id: `${P}stock`, businessId: ID.bizNew, productId: product.id, warehouseId: warehouse.id, quantity: 10, costPerUnit: 5, currency: 'JMD' } });
    const invoice = await storedInvoice('cash_cost', 'JMD', 30, LEGACY_CREATED, product.id);

    const settled = await db.$transaction(async (tx: any) => {
      const row = await tx.payment.create({
        data: { businessId: ID.bizNew, invoiceId: invoice.id, amount: 30, currency: 'JMD', status: 'SUCCESSFUL', provider: 'cash', method: 'cash', providerPaymentId: `${P}cost` },
      });
      await revenuePosting.onPaymentRecorded(row.id, { tx });
      return workflow.reconcileFromPayments(invoice.id, { tx, eventBuffer: [] });
    }).catch((e: any) => ({ status: e?.status, message: String(e?.message) }));
    expect(settled, JSON.stringify(settled)).toMatchObject({ status: 'PAID', changed: true });
    expect(await db.payment.count({ where: { invoiceId: invoice.id } })).toBe(1);

    const cogs = await db.financialTransaction.findUnique({
      where: { businessId_externalRef: { businessId: ID.bizNew, externalRef: `Invoice:${invoice.id}:cogs` } },
      include: { entries: { include: { account: { select: { systemKey: true } } } } },
    });
    expect(cogs, 'the COGS posted').not.toBeNull();
    expect({ type: cogs.type, currency: cogs.currency, amount: Number(cogs.amount) }).toEqual({ type: 'EXPENSE', currency: 'JMD', amount: 5 });
    expect(new Set(cogs.entries.map((e: any) => e.currency))).toEqual(new Set(['JMD']));
    expect(cogs.entries.filter((e: any) => Number(e.debit) > 0).map((e: any) => e.account.systemKey)).toEqual(['COGS']);
    expect(cogs.entries.filter((e: any) => Number(e.credit) > 0).map((e: any) => e.account.systemKey)).toEqual(['INVENTORY_ASSET']);
  }, 30_000);
});
