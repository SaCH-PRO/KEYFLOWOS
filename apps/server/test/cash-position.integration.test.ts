/**
 * V1-34-DM-CASH-POSITION — the cockpit's cash is read from the ledger (REAL
 * database, REAL ledger posting, REAL payment and refund routes, REAL readers
 * behind the real AuthGuard and BusinessGuard).
 *
 * CF-41 (docs/reconstruction/BUILD-MAP-001.md): FinancialAccount.currentBalance
 * is an opening snapshot. FinanceAccountsService.create writes it once
 * (`currentBalance: opening`, finance-accounts.service.ts:78) and nothing ever
 * updates it, yet safe-to-spend, the OS command center and the Finance overview
 * summed it as live cash. A payment posted through the ledger door therefore
 * never moved the cockpit's cash: an opening balance of 1000 plus a 100 manual
 * payment still read 1000.
 *
 * Contract pinned here:
 *
 *   CP-01  baseline: an account opened with 1000 (the opening balance posted
 *          through the door) reads 1000 on safe-to-spend, the OS command center
 *          and the Finance overview, each labelled cashBasis 'ledger'
 *   CP-02  RED-BEFORE / GREEN-AFTER: a 100 manual cash payment (real HTTP route)
 *          -> cash 1100 on all three surfaces, equal to the independent sum of
 *          the tenant's CASH/BANK/PAYMENT_PROCESSOR LedgerEntry rows; safe-to-
 *          spend's arithmetic consumes it (buffer 500, safe 600);
 *          FinancialAccount.currentBalance is untouched (still 1000)
 *   CP-03  the refund of that payment (real HTTP route; the posting is REVERSED
 *          beside its REVERSAL) returns cash to 1000 on all three surfaces: the
 *          pair nets to zero; currentBalance still untouched
 *   CP-04  only cash-class accounts count: a credit-card expense (CREDIT_CARD is
 *          a liability) leaves cash unchanged; a processor settlement counts; a
 *          processor-to-bank transfer leaves it unchanged; three 0.10 cash
 *          expenses take exactly 0.30 (cents-safe)
 *   CP-05  TENANT: another tenant's cash entries (opening 5000 + a 70 payment)
 *          are never counted in A's figure, even with an A account linked to B's
 *          BANK chart-of-account row; B reads its own 5070; A's owner gets 403
 *          on B's safe-to-spend and command center
 *
 * Open (it.todo, outside the V1-34 write set): FinanceAccountsService.create
 * records an opening balance on the account row only; it does not post it.
 *
 * Nothing on the boundary is mocked: PrismaService, AuthGuard, BusinessGuard,
 * the global TenantInterceptor, CommerceService, InvoiceWorkflowService,
 * RevenuePostingService, PostingService, AccountingPeriodService,
 * ChartOfAccountsSeederService, FinanceAccountsService, SafeToSpendService,
 * FinanceOverviewService, OsService and CommandService read and write real rows.
 * The OS app is composed like OsModule (no finance providers). Identity
 * attachment is the one stand-in: a test middleware reads `x-v34a-user`, loads
 * that seeded user row and attaches `{ id, email, role }` exactly as the
 * Supabase-verifying AuthMiddleware would. Collaborators off the money path
 * (events, CRM, timeline, notifications, realtime, AI, Gmail, Drive) are stubs.
 *
 * Fixtures: prefix `v34a_` (registered in test/helpers/fixture-prefixes.json);
 * hard-deleted by raw SQL (patterns built by sqlLikePrefix) in dependency order
 * in beforeAll and afterAll; no $transaction wrapping.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL (the
// shell / CI env wins because dotenv never overrides an existing variable).
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v34a_';
const HEADER = 'x-v34a-user';

const ID = {
  ownerA: `${P}ownerA`,
  ownerB: `${P}ownerB`,
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  contactA: `${P}contactA`,
  contactB: `${P}contactB`,
  invA: `${P}invA`,
  invB: `${P}invB`,
};

const CASH_KEYS = ['CASH', 'BANK', 'PAYMENT_PROCESSOR'];

let db: any;
let commerceApp: any;
let financeApp: any;
let osApp: any;
let redis: any;
let posting: any;
let coaSeeder: any;
let accounts: any;
let tillA: any; // A's cash account, opened with 1000
let paymentA: any; // the 100 manual payment on A's invoice

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
    `DELETE FROM activities WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM revenue_actions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM ledger_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM financial_transactions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM financial_accounts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payments WHERE business_id LIKE ${sqlLikePrefix(P)} OR invoice_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payment_links WHERE business_id LIKE ${sqlLikePrefix(P)} OR invoice_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoice_items WHERE invoice_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM chart_of_accounts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

/** Identity attachment only. No guard is overridden. */
function attachIdentity(app: any) {
  app.use(async (req: any, _res: any, next: any) => {
    const header = req.headers[HEADER];
    const id = typeof header === 'string' ? header : undefined;
    if (id && id.startsWith(P)) {
      const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
      if (user) req.user = { id: user.id, email: user.email, role: user.role };
    }
    next();
  });
}

const money = (n: number) => Math.round(n * 100) / 100;

/**
 * LEDGER, computed independently of every reader under test: the net
 * (debit - credit) of the business's LedgerEntry rows on its CASH, BANK and
 * PAYMENT_PROCESSOR chart-of-account rows, summed by Postgres in numeric.
 */
async function ledgerCash(businessId: string): Promise<number> {
  const rows: Array<{ net: string }> = await db.$queryRawUnsafe(
    `SELECT COALESCE(SUM(le.debit - le.credit), 0)::text AS net
       FROM ledger_entries le
       JOIN chart_of_accounts coa ON coa.id = le.account_id
      WHERE le.business_id = $1
        AND coa.business_id = $1
        AND coa.system_key IN ('CASH', 'BANK', 'PAYMENT_PROCESSOR')`,
    businessId,
  );
  return money(Number(rows[0].net));
}

async function safeToSpend(biz: string, as: string) {
  return request(financeApp.getHttpServer()).get(`/finance/businesses/${biz}/safe-to-spend`).set(HEADER, as);
}

async function commandCenter(biz: string, as: string) {
  return request(osApp.getHttpServer()).get(`/os/businesses/${biz}/command-center`).set(HEADER, as);
}

async function overview(biz: string, as: string) {
  return request(financeApp.getHttpServer()).get(`/finance/businesses/${biz}/overview`).set(HEADER, as);
}

/** The cash every surface serves for `biz`, asserted equal and ledger-labelled. */
async function surfaces(biz: string, as: string) {
  const [s, o, f] = await Promise.all([safeToSpend(biz, as), commandCenter(biz, as), overview(biz, as)]);
  expect(s.status, JSON.stringify(s.body)).toBe(200);
  expect(o.status, JSON.stringify(o.body)).toBe(200);
  expect(f.status, JSON.stringify(f.body)).toBe(200);
  return {
    safe: s.body,
    os: o.body,
    overview: f.body,
    cash: { safe: s.body.cashBalance, os: o.body.flows?.financial?.cashBalance, overview: f.body.cashBalance },
    basis: { safe: s.body.cashBasis, os: o.body.flows?.financial?.cashBasis, overview: f.body.cashBasis },
  };
}

async function expectCash(biz: string, as: string, expected: number) {
  const read = await surfaces(biz, as);
  expect(read.cash, `${biz}: every surface serves the ledger cash`).toEqual({ safe: expected, os: expected, overview: expected });
  expect(read.basis, `${biz}: every surface labels the figure as ledger-derived`).toEqual({ safe: 'ledger', os: 'ledger', overview: 'ledger' });
  expect(await ledgerCash(biz), `${biz}: LEDGER - the independent sum of the cash-class rows`).toBe(expected);
  return read;
}

/** A balanced posting through the door. */
async function post(businessId: string, kind: string, amount: number, debitKey: string, creditKey: string, type = 'ADJUSTMENT') {
  const dr = await coaSeeder.getBySystemKey(businessId, debitKey);
  const cr = await coaSeeder.getBySystemKey(businessId, creditKey);
  return posting.post({
    businessId,
    type,
    date: new Date(Date.now() - 60_000),
    amount,
    currency: 'TTD',
    description: `v34a ${kind}`,
    sourceType: 'V34aFixture',
    sourceId: `${P}${kind}`,
    kind,
    entries: [
      { accountId: dr.id, debit: amount },
      { accountId: cr.id, credit: amount },
    ],
  });
}

/** An account opened with `amount`, its opening balance posted through the door. */
async function openAccount(businessId: string, name: string, type: string, systemKey: string, amount: number) {
  const account = await accounts.create(businessId, { name, type, openingBalance: amount, currency: 'TTD' });
  const cash = await coaSeeder.getBySystemKey(businessId, systemKey);
  const equity = await coaSeeder.getBySystemKey(businessId, 'OWNER_EQUITY');
  await posting.post({
    businessId,
    type: 'OPENING_BALANCE',
    date: new Date(Date.now() - 30 * 24 * 3600 * 1000),
    amount,
    currency: 'TTD',
    description: `Opening balance ${name}`,
    sourceType: 'FinancialAccount',
    sourceId: account.id,
    kind: 'opening_balance',
    entries: [
      { accountId: cash.id, debit: amount },
      { accountId: equity.id, credit: amount },
    ],
  });
  return account;
}

async function pay(biz: string, inv: string, as: string, amount: number, reference: string) {
  const res = await request(commerceApp.getHttpServer())
    .post(`/commerce/businesses/${biz}/invoices/${inv}/payments`)
    .set(HEADER, as)
    .send({ amount, method: 'cash', reference });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.payment;
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
  const { TenantInterceptor } = await import('../src/core/tenant/tenant.interceptor');
  const { PlanLimitGuard } = await import('../src/modules/subscriptions/plan-limit.guard');
  const { SubscriptionsService } = await import('../src/modules/subscriptions/subscriptions.service');
  const { CommerceController } = await import('../src/modules/commerce/commerce.controller');
  const { CommerceService } = await import('../src/modules/commerce/commerce.service');
  const { CommerceStatsService } = await import('../src/modules/commerce/commerce-stats.service');
  const workflowMod = await import('../src/modules/commerce/invoice-workflow.service');
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
  const { FinancialAccountSeederService } = await import('../src/modules/finance/financial-account-seeder.service');
  const { FinanceAccountsService } = await import('../src/modules/finance/finance-accounts.service');
  const { ExpensePostingService } = await import('../src/modules/finance/expense-posting.service');
  const { TimelineService } = await import('../src/modules/timeline/timeline.service');
  const { NotificationsService } = await import('../src/modules/notifications/notifications.service');
  const { RealtimeService } = await import('../src/modules/realtime/realtime.service');
  const { CommandService } = await import('../src/modules/command/command.service');
  const { OsController } = await import('../src/modules/os/os.controller');
  const { OsService } = await import('../src/modules/os/os.service');
  const { FinanceController } = await import('../src/modules/finance/finance.controller');
  const { SafeToSpendService } = await import('../src/modules/finance/safe-to-spend.service');
  const { FinanceOverviewService } = await import('../src/modules/finance/finance-overview.service');
  const { ReceivablesService } = await import('../src/modules/finance/receivables.service');
  // The ledger reader this packet adds. FinanceModule provides it; before the
  // packet it does not exist and the finance app is composed without it.
  const cashPositionToken: any = await import('../src/modules/finance/cash-position.service')
    .then((m: any) => m.CashPositionService)
    .catch(() => null);

  redis = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: 2, lazyConnect: false });

  // ---- commerce app: the real manual payment and refund routes --------
  const commerceRef = await Test.createTestingModule({
    controllers: [CommerceController],
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
      workflowMod.InvoiceWorkflowService,
      InvoiceReceiptBuilderService,
      // Real ledger chain: the proof is the rows it posts and reverses.
      RevenuePostingService,
      PostingService,
      AccountingPeriodService,
      ChartOfAccountsSeederService,
      FinancialAccountSeederService,
      FinanceAccountsService,
      { provide: ExpensePostingService, useValue: { onProductSold: async () => null } },
      { provide: EventEmitter2, useValue: eventStub },
      { provide: CrmService, useValue: { logContactEvent: async () => null } },
      { provide: EvidenceService, useValue: {} },
      { provide: TaskAssignmentService, useValue: {} },
      { provide: SubscriptionsService, useValue: { checkLimit: async () => ({ allowed: true }) } },
      { provide: CommerceStatsService, useValue: { invalidateCache: () => undefined } },
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
  posting = commerceRef.get(PostingService);
  coaSeeder = commerceRef.get(ChartOfAccountsSeederService);
  accounts = commerceRef.get(FinanceAccountsService);
  commerceApp = commerceRef.createNestApplication();
  attachIdentity(commerceApp);
  commerceApp.useGlobalFilters(new GlobalHttpExceptionFilter());
  commerceApp.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await commerceApp.init();

  // ---- finance app: safe-to-spend and the overview ---------------------
  const collaborators = await Promise.all([
    import('../src/modules/finance/ledger-balance.service').then((m) => m.LedgerBalanceService),
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
    import('../src/modules/finance/cashflow-forecast.service').then((m) => m.CashflowForecastService),
    import('../src/modules/finance/money-moves.service').then((m) => m.MoneyMovesService),
    import('../src/modules/finance/cash-reserve.service').then((m) => m.CashReserveService),
    import('../src/modules/finance/credit-note.service').then((m) => m.CreditNoteService),
    import('../src/modules/finance/bank-connection.service').then((m) => m.BankConnectionService),
    import('../src/modules/finance/exchange-rate.service').then((m) => m.ExchangeRateService),
    import('../src/modules/finance/fixed-asset.service').then((m) => m.FixedAssetService),
  ]);
  const financeRef = await Test.createTestingModule({
    controllers: [FinanceController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      // Live: the readers under test and what they read through.
      SafeToSpendService,
      FinanceOverviewService,
      ReceivablesService,
      FinancialAccountSeederService,
      FinanceAccountsService,
      ChartOfAccountsSeederService,
      PostingService,
      AccountingPeriodService,
      ...(cashPositionToken ? [cashPositionToken] : []),
      // FinanceController's other collaborators are off the cash path.
      ...collaborators.map((token) => ({ provide: token, useValue: {} })),
    ],
  }).compile();
  financeApp = financeRef.createNestApplication();
  attachIdentity(financeApp);
  financeApp.useGlobalInterceptors(new TenantInterceptor(financeRef.get(PrismaService)));
  financeApp.useGlobalFilters(new GlobalHttpExceptionFilter());
  await financeApp.init();

  // ---- OS app: composed like OsModule (Prisma, Auth, Command; no finance) ----
  const osRef = await Test.createTestingModule({
    controllers: [OsController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      OsService,
      CommandService,
      { provide: TimelineService, useValue: { recordEvent: async () => null } },
      { provide: NotificationsService, useValue: { create: async () => null } },
      { provide: RealtimeService, useValue: { emit: () => undefined } },
    ],
  }).compile();
  osApp = osRef.createNestApplication();
  attachIdentity(osApp);
  osApp.useGlobalInterceptors(new TenantInterceptor(osRef.get(PrismaService)));
  osApp.useGlobalFilters(new GlobalHttpExceptionFilter());
  await osApp.init();

  await cleanup(); // in case a prior run aborted

  for (const [user, biz, name, email] of [
    [ID.ownerA, ID.bizA, 'V34A Biz A', `${P}owner_a@test.local`],
    [ID.ownerB, ID.bizB, 'V34A Biz B', `${P}owner_b@test.local`],
  ] as const) {
    await db.user.create({ data: { id: user, email, role: 'USER' } });
    await db.business.create({ data: { id: biz, name, ownerId: user, currency: 'TTD' } });
    await db.membership.create({ data: { id: `${user}_m`, userId: user, businessId: biz, role: 'OWNER' } });
    await coaSeeder.ensureDefaults(biz);
  }
  for (const [id, biz, inv, n, total] of [
    [ID.contactA, ID.bizA, ID.invA, 'V34A-001', 100],
    [ID.contactB, ID.bizB, ID.invB, 'V34A-002', 70],
  ] as const) {
    await db.contact.create({ data: { id, businessId: biz, firstName: 'V34a', lastName: 'Customer', email: `${id}@test.local` } });
    await db.invoice.create({
      data: {
        id: inv,
        invoiceNumber: n,
        status: 'SENT',
        subtotal: total,
        total,
        currency: 'TTD',
        businessId: biz,
        contactId: id,
        items: { create: [{ id: `${inv}_item1`, description: `V34A item ${n}`, quantity: 1, unitPrice: total, total }] },
      },
    });
  }

  // A: one cash account opened with 1000. B: one bank account opened with 5000.
  tillA = await openAccount(ID.bizA, 'V34A Till', 'CASH', 'CASH', 1000);
  await openAccount(ID.bizB, 'V34A Bank B', 'BANK', 'BANK', 5000);
}, 180_000);

afterAll(async () => {
  for (const app of [commerceApp, financeApp, osApp]) {
    if (app) await app.close();
  }
  if (db) await cleanup();
  if (redis) await redis.quit().catch(() => undefined);
}, 60_000);

describe('V1-34 fixture sanity (real rows)', () => {
  it('A holds one 1000 opening posting on CASH and an account whose currentBalance is the 1000 snapshot', async () => {
    const till = await db.financialAccount.findUnique({ where: { id: tillA.id } });
    expect(Number(till.openingBalance)).toBe(1000);
    expect(Number(till.currentBalance)).toBe(1000);
    expect(await ledgerCash(ID.bizA)).toBe(1000);
    expect(await ledgerCash(ID.bizB)).toBe(5000);
    const cashClass = await db.chartOfAccount.findMany({ where: { businessId: ID.bizA, systemKey: { in: CASH_KEYS } } });
    expect(cashClass).toHaveLength(3);
  });
});

describe('V1-34 cash position is ledger-derived (CF-41)', () => {
  it('CP-01 baseline: 1000 opened -> safe-to-spend, OS status and the overview all read 1000, labelled ledger', async () => {
    const read = await expectCash(ID.bizA, ID.ownerA, 1000);
    expect(read.safe.operatingBuffer).toBe(500);
    expect(read.safe.safeToSpend).toBe(500);
  });

  it('CP-02 RED-BEFORE / GREEN-AFTER: a 100 manual payment moves cash to 1100 everywhere; currentBalance is untouched', async () => {
    paymentA = await pay(ID.bizA, ID.invA, ID.ownerA, 100, 'v34a-cash-100');
    // The payment posted through the door: DR CASH 100.
    const postings = await db.financialTransaction.findMany({
      where: { businessId: ID.bizA, externalRef: `Payment:${paymentA.id}:payment_recorded` },
      include: { entries: { include: { account: { select: { systemKey: true } } } } },
    });
    expect(postings).toHaveLength(1);
    expect(postings[0].entries.some((e: any) => e.account.systemKey === 'CASH' && Number(e.debit) === 100)).toBe(true);

    const read = await expectCash(ID.bizA, ID.ownerA, 1100);
    // Safe-to-spend's arithmetic consumes the ledger figure.
    expect(read.safe.operatingBuffer).toBe(500);
    expect(read.safe.safeToSpend).toBe(600);
    expect(read.safe.explanation[0]).toBe('Cash balance: TTD 1100.00 (ledger)');

    const till = await db.financialAccount.findUnique({ where: { id: tillA.id } });
    expect(Number(till.currentBalance), 'currentBalance is never written by the cash reader').toBe(1000);
    expect(Number(till.openingBalance)).toBe(1000);
  });

  it('CP-03 the refund (REVERSED original beside its REVERSAL) returns cash to 1000 everywhere', async () => {
    const res = await request(commerceApp.getHttpServer())
      .post(`/commerce/businesses/${ID.bizA}/payments/${paymentA.id}/refund`)
      .set(HEADER, ID.ownerA)
      .send({ reason: 'v34a refund' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const original = await db.financialTransaction.findFirst({
      where: { businessId: ID.bizA, externalRef: `Payment:${paymentA.id}:payment_recorded` },
    });
    const reversal = await db.financialTransaction.findFirst({
      where: { businessId: ID.bizA, externalRef: `Payment:${paymentA.id}:payment_recorded:reversal` },
    });
    expect(original.status).toBe('REVERSED');
    expect(reversal?.status).toBe('POSTED');
    expect(reversal?.reversalOfId).toBe(original.id);

    const read = await expectCash(ID.bizA, ID.ownerA, 1000);
    expect(read.safe.safeToSpend).toBe(500);
    const till = await db.financialAccount.findUnique({ where: { id: tillA.id } });
    expect(Number(till.currentBalance)).toBe(1000);
  });

  it('CP-04 only cash-class accounts count: credit card no, processor yes, transfers net, cents exact', async () => {
    // A credit-card expense: DR expense / CR CREDIT_CARD (a liability) -> no cash moved.
    await post(ID.bizA, 'card_expense', 40, 'EXPENSE_GENERAL', 'CREDIT_CARD', 'EXPENSE');
    await expectCash(ID.bizA, ID.ownerA, 1000);
    // A processor settlement counts.
    await post(ID.bizA, 'processor_settlement', 25.35, 'PAYMENT_PROCESSOR', 'OTHER_INCOME', 'INCOME');
    await expectCash(ID.bizA, ID.ownerA, 1025.35);
    // Processor -> bank transfer: both legs are cash.
    await post(ID.bizA, 'processor_payout', 25.35, 'BANK', 'PAYMENT_PROCESSOR', 'TRANSFER');
    await expectCash(ID.bizA, ID.ownerA, 1025.35);
    // Three 0.10 cash expenses take exactly 0.30 (floats would leave 1025.0500000000002).
    for (const n of [1, 2, 3]) await post(ID.bizA, `petty_${n}`, 0.1, 'EXPENSE_GENERAL', 'CASH', 'EXPENSE');
    await expectCash(ID.bizA, ID.ownerA, 1025.05);
  });

  it("CP-05 TENANT: B's entries are never counted in A's figure, even through a link to B's BANK row", async () => {
    await pay(ID.bizB, ID.invB, ID.ownerB, 70, 'v34a-cash-70');
    // FinanceAccountsService.create accepts any chartOfAccountId: A links an account to B's BANK row.
    const bBank = await coaSeeder.getBySystemKey(ID.bizB, 'BANK');
    await accounts.create(ID.bizA, { name: 'V34A Linked', type: 'BANK', chartOfAccountId: bBank.id, currency: 'TTD' });

    await expectCash(ID.bizA, ID.ownerA, 1025.05);
    await expectCash(ID.bizB, ID.ownerB, 5070);

    // And A's owner cannot read B's figure at all.
    expect((await safeToSpend(ID.bizB, ID.ownerA)).status).toBe(403);
    expect((await commandCenter(ID.bizB, ID.ownerA)).status).toBe(403);
    expect((await overview(ID.bizB, ID.ownerA)).status).toBe(403);
  });

  it.todo(
    'FinanceAccountsService.create posts an account opening balance through the ledger door (OPENING_BALANCE, DR the account chart row / CR OWNER_EQUITY): '
      + 'today it writes openingBalance and currentBalance on the row only, so an opening balance entered on an account reaches the '
      + 'ledger-derived cash only once posted; finance-accounts.service.ts is outside the V1-34 write set (follow-up, with a backfill for '
      + 'accounts whose openingBalance has no posting)',
  );
});
