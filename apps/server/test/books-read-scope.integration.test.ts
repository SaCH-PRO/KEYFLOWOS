/**
 * FOLLOW3-A6-BOOKS-READ-SCOPE — the Books reads that carry revenue and cash
 * figures need revenue:read, as GET trial-balance has since V1-37b
 * (SEC-V37b-1). Owner ruling D-57 (2026-11-03): the Books reads carrying
 * revenue and cash figures need revenue:read (the trial-balance gate); no new
 * module key. REAL database, REAL FinanceController behind the real AuthGuard,
 * BusinessGuard, ModuleScopeGuard and the global TenantInterceptor.
 *
 * F4 (verify-money-findings C3-01..C3-03): only GET trial-balance carried
 * @UseGuards(ModuleScopeGuard) @RequireModuleScope('revenue', 'read'); a STAFF
 * member whose explicit scope map says revenue:'none' read the same REVENUE
 * and cash figures through six sibling reads, and the overview read even
 * wrote rows (the default Cash and Bank financial_accounts, the overdue
 * invoice's revenue action).
 *
 *   BRS-01..06  RED-BEFORE staffNone {revenue:'none', crm:'read'} gets 200 with
 *               the figures on GET general-ledger (BRS-01),
 *               trial-balance/account/<REVENUE> (BRS-02), receivables/aging
 *               (BRS-03), customers/:contactId/balance (BRS-04), overview
 *               (BRS-05, which also creates financial_accounts rows) and
 *               safe-to-spend (BRS-06). GREEN-AFTER each answers 403
 *               'Insufficient permissions: revenue requires read access (you
 *               have none)' before the service runs (the service method is
 *               never called), carries no figure, and the financial_accounts
 *               and revenue_actions counts are unchanged by staffNone's reads.
 *   BRS-07      controls: staffRead {revenue:'read'}, a STAFF member on role
 *               defaults (revenue:'read') and the owner get 200 with the same
 *               figures as at head on all six reads.
 *   BRS-08      the outsider (no Membership) gets 403 on every route, the six
 *               and the trial balance, before any service runs.
 *   C3-00       GET trial-balance is unchanged: staffNone 403 with the same
 *               message; staffRead, role-default STAFF and the owner read the
 *               REVENUE row.
 *
 * Review repairs (FOLLOW3-A5A6 review):
 *   BRS-09      SEC-A5A6-02: the routes that serve the same figures again
 *               (GET journal-entries, GET accountant-export.zip, POST
 *               accountant-export, POST accountant-export/email, GET
 *               money-moves, GET cashflow-forecast) refuse staffNone with the
 *               same 403 before the service runs. RED-BEFORE: 200/201 with the
 *               ADJUSTMENT lines, the export built (and mailed), 'could add
 *               TTD 54.33', the forecast.
 *   BRS-10      control: staffRead, role-default STAFF and the owner still read
 *               them (journal lines, export built, email handed to the sender
 *               stand-in, money-moves 54.33, forecast).
 *   BRS-11      SEC-A5A6-04: a SUPER_ADMIN with no Membership (BusinessGuard and
 *               ModuleScopeGuard pass that role) is refused 403 'No access to
 *               this business' on the six reads, the trial balance, GET
 *               journal-entries, money-moves and the cashflow forecast before
 *               any service runs. RED-BEFORE: aging, customer balance,
 *               safe-to-spend, journal-entries, money-moves and the forecast
 *               answered 200 with the figures.
 *   BRS-12      W10-OWNER-MEMBERSHIP (owner ruling D-104, was it.todo): the
 *               distinguished owner (Business.ownerId) with no Membership row
 *               is refused by BusinessGuard 'No access to this business' on
 *               every Books read, also GET expense-breakdown, which carries no
 *               module gate (RED-BEFORE: 200 there, and ModuleScopeGuard's
 *               'Not a member of this business' on the gated reads); after the
 *               operator backfill (apps/server/scripts/
 *               backfill-owner-memberships.ts --apply) writes its OWNER
 *               Membership it reads the owner's figures.
 *
 * Fixtures: one TTD business (CASH basis); an invoice of 345.67 PAID by a
 * SUCCESSFUL payment with its INCOME posting (DR CASH / CR REVENUE 345.67,
 * sourced from the Payment); an OVERDUE invoice of 54.33 to a second contact,
 * so the aging has an outstanding figure.
 *
 * Nothing on the boundary is mocked: PrismaService, AuthGuard, BusinessGuard,
 * ModuleScopeGuard, TenantInterceptor, LedgerBalanceService,
 * ReceivablesService, FinanceOverviewService, SafeToSpendService,
 * CashPositionService, FinancialAccountSeederService,
 * ChartOfAccountsSeederService and PostingService run against the database at
 * DATABASE_URL. The service methods are wrapped by vi.spyOn, which calls
 * through, only to record whether a refused read reached them. Identity
 * attachment is the one stand-in: a test middleware reads `x-v81f-user`, loads
 * that seeded user row and attaches `{ id, email, role }` exactly as the
 * Supabase-verifying AuthMiddleware would. FinanceController's other
 * collaborators are off these routes and stubbed; the overview runs without
 * its Redis cache (RedisService is optional), so every read computes.
 *
 * Fixtures: prefix `v81f_` (registered in test/helpers/fixture-prefixes.json);
 * hard-deleted by raw SQL (patterns built by sqlLikePrefix) in dependency order
 * in beforeAll and afterAll; no $transaction wrapping.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL (the
// shell / CI env wins because dotenv never overrides an existing variable).
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v81f_';
const HEADER = 'x-v81f-user';

const ID = {
  owner: `${P}owner`,
  staffNone: `${P}staffNone`,
  staffRead: `${P}staffRead`,
  staffDefault: `${P}staffDefault`,
  outsider: `${P}outsider`,
  superAdmin: `${P}superAdmin`,
  /** BRS-12 (D-104): Business.ownerId with no Membership row. */
  distOwner: `${P}distOwner`,
  biz: `${P}biz`,
  contactPaid: `${P}contactPaid`,
  contactOpen: `${P}contactOpen`,
  invPaid: `${P}invPaid`,
  invOpen: `${P}invOpen`,
  payment: `${P}payment`,
};

const REVENUE_DENIED = 'Insufficient permissions: revenue requires read access (you have none)';

let db: any;
let app: any;
let coa: any;
let posting: any;
/** The ADJUSTMENT posted by hand (equity only: no cash, revenue or receivable figure moves). */
const ADJUSTMENT = 12.34;
/** The business's REVENUE and CASH chart-of-account rows. */
const ACC: Record<string, string> = {};
/** vi.spyOn wrappers (calling through) on the real service methods behind the six reads. */
const SPY: Record<string, any> = {};

async function cleanup() {
  for (const sql of [
    `DELETE FROM revenue_actions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM ledger_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM financial_transactions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM financial_accounts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM accounting_periods WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payments WHERE business_id LIKE ${sqlLikePrefix(P)} OR invoice_id LIKE ${sqlLikePrefix(P)}`,
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
function attachIdentity(nest: any) {
  nest.use(async (req: any, _res: any, next: any) => {
    const header = req.headers[HEADER];
    const id = typeof header === 'string' ? header : undefined;
    if (id && id.startsWith(P)) {
      const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
      if (user) req.user = { id: user.id, email: user.email, role: user.role };
    }
    next();
  });
}

/**
 * The six Books reads: the route, the service method behind it, and the
 * figures a reader that may see them is served (as at head).
 */
const READS: Array<{ id: string; route: () => string; spy: string; figures: (body: any) => unknown; expected: unknown }> = [
  {
    id: 'BRS-01',
    route: () => 'general-ledger',
    spy: 'getGeneralLedger',
    figures: (b) => (b.rows ?? [])
      .filter((r: any) => r.accountId === ACC.revenue)
      .map((r: any) => ({ accountName: r.accountName, credit: Number(r.credit), sourceId: r.sourceId })),
    expected: [{ accountName: 'Revenue', credit: 345.67, sourceId: `${P}payment` }],
  },
  {
    id: 'BRS-02',
    route: () => `trial-balance/account/${ACC.revenue}`,
    spy: 'getAccountBalance',
    figures: (b) => b,
    expected: { accountId: '<revenue>', balance: '-345.67' },
  },
  {
    id: 'BRS-03',
    route: () => 'receivables/aging',
    spy: 'getAging',
    figures: (b) => ({
      totalOutstanding: b.totalOutstanding,
      totalOverdue: b.totalOverdue,
      customers: (b.customers ?? []).map((c: any) => [c.contactId, c.total]),
    }),
    expected: { totalOutstanding: 54.33, totalOverdue: 54.33, customers: [[`${P}contactOpen`, 54.33]] },
  },
  {
    id: 'BRS-04',
    route: () => `customers/${ID.contactPaid}/balance`,
    spy: 'getCustomerBalance',
    figures: (b) => ({ invoicedTotal: b.invoicedTotal, paidTotal: b.paidTotal, outstanding: b.outstanding }),
    expected: { invoicedTotal: 345.67, paidTotal: 345.67, outstanding: 0 },
  },
  {
    id: 'BRS-05',
    route: () => 'overview',
    spy: 'getOverview',
    figures: (b) => ({ revenueThisMonth: b.revenueThisMonth, cashBalance: b.cashBalance }),
    expected: { revenueThisMonth: 345.67, cashBalance: 345.67 },
  },
  {
    id: 'BRS-06',
    route: () => 'safe-to-spend',
    spy: 'calculate',
    figures: (b) => ({ cashBalance: b.cashBalance, cashBasis: b.cashBasis, currency: b.currency }),
    expected: { cashBalance: 345.67, cashBasis: 'ledger', currency: 'TTD' },
  },
];

function expectedOf(read: (typeof READS)[number]) {
  return read.id === 'BRS-02' ? { accountId: ACC.revenue, balance: '-345.67' } : read.expected;
}

function get(route: string, as: string) {
  return request(app.getHttpServer()).get(`/finance/businesses/${ID.biz}/${route}`).set(HEADER, as);
}

async function rowCount(table: 'financial_accounts' | 'revenue_actions') {
  const [row]: Array<{ n: number }> = await db.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM ${table} WHERE business_id = $1`, ID.biz,
  );
  return row.n;
}

function clearSpies() {
  for (const spy of Object.values(SPY)) spy.mockClear();
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { TenantInterceptor } = await import('../src/core/tenant/tenant.interceptor');
  const { FinanceController } = await import('../src/modules/finance/finance.controller');
  const { LedgerBalanceService } = await import('../src/modules/finance/ledger-balance.service');
  const { ReceivablesService } = await import('../src/modules/finance/receivables.service');
  const { FinanceOverviewService } = await import('../src/modules/finance/finance-overview.service');
  const { SafeToSpendService } = await import('../src/modules/finance/safe-to-spend.service');
  const { CashPositionService } = await import('../src/modules/finance/cash-position.service');
  const { FinancialAccountSeederService } = await import('../src/modules/finance/financial-account-seeder.service');
  const { ChartOfAccountsSeederService } = await import('../src/modules/finance/chart-of-accounts-seeder.service');
  const { PostingService } = await import('../src/modules/finance/posting.service');
  const { AccountingPeriodService } = await import('../src/modules/finance/accounting-period.service');
  const { CashflowForecastService } = await import('../src/modules/finance/cashflow-forecast.service');
  const { MoneyMovesService } = await import('../src/modules/finance/money-moves.service');
  const { AccountantExportService } = await import('../src/modules/finance/accountant-export.service');
  const { AccountantExportEmailService } = await import('../src/modules/finance/accountant-export-email.service');
  // The export's builder and mailer are stand-ins (no object storage, no mail
  // provider): only whether a request reaches them is under test.
  SPY.build = vi.fn(async () => ({
    buffer: Buffer.from('v81f-zip'), contentType: 'application/zip', bytes: 8, filename: 'v81f-export.zip',
  }));
  SPY.send = vi.fn(async () => ({ sent: true }));

  // FinanceController's collaborators off the six reads and the trial balance.
  const stubs = await Promise.all([
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
    import('../src/modules/finance/finance-intelligence.service').then((m) => m.FinanceIntelligenceService),
    import('../src/modules/finance/cash-reserve.service').then((m) => m.CashReserveService),
    import('../src/modules/finance/credit-note.service').then((m) => m.CreditNoteService),
    import('../src/modules/finance/bank-connection.service').then((m) => m.BankConnectionService),
    import('../src/modules/finance/exchange-rate.service').then((m) => m.ExchangeRateService),
    import('../src/modules/finance/fixed-asset.service').then((m) => m.FixedAssetService),
    import('../src/core/object-storage').then((m) => m.ObjectStorageService),
  ]);

  const moduleRef = await Test.createTestingModule({
    controllers: [FinanceController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      // Live: the readers under test and what they read and write through.
      LedgerBalanceService,
      ReceivablesService,
      FinanceOverviewService,
      SafeToSpendService,
      CashPositionService,
      FinancialAccountSeederService,
      ChartOfAccountsSeederService,
      PostingService,
      AccountingPeriodService,
      CashflowForecastService,
      MoneyMovesService,
      { provide: AccountantExportService, useValue: { build: SPY.build } },
      { provide: AccountantExportEmailService, useValue: { send: SPY.send } },
      ...stubs.map((token) => ({ provide: token, useValue: {} })),
    ],
  }).compile();
  coa = moduleRef.get(ChartOfAccountsSeederService);
  posting = moduleRef.get(PostingService);
  const ledgerBalance = moduleRef.get(LedgerBalanceService);
  const receivables = moduleRef.get(ReceivablesService);
  SPY.getGeneralLedger = vi.spyOn(ledgerBalance, 'getGeneralLedger');
  SPY.getAccountBalance = vi.spyOn(ledgerBalance, 'getAccountBalance');
  SPY.getTrialBalance = vi.spyOn(ledgerBalance, 'getTrialBalance');
  SPY.getAging = vi.spyOn(receivables, 'getAging');
  SPY.getCustomerBalance = vi.spyOn(receivables, 'getCustomerBalance');
  SPY.getOverview = vi.spyOn(moduleRef.get(FinanceOverviewService), 'getOverview');
  SPY.calculate = vi.spyOn(moduleRef.get(SafeToSpendService), 'calculate');
  SPY.forecast = vi.spyOn(moduleRef.get(CashflowForecastService), 'forecast');
  SPY.generate = vi.spyOn(moduleRef.get(MoneyMovesService), 'generate');

  app = moduleRef.createNestApplication();
  attachIdentity(app);
  app.useGlobalInterceptors(new TenantInterceptor(moduleRef.get(PrismaService)));
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  await app.init();

  await cleanup(); // in case a prior run aborted

  for (const id of [ID.owner, ID.staffNone, ID.staffRead, ID.staffDefault, ID.outsider, ID.superAdmin]) {
    const role = id === ID.superAdmin ? 'SUPER_ADMIN' : 'USER';
    await db.user.create({ data: { id, email: `${P}${id.slice(P.length)}@test.local`, name: id, role } });
  }
  await db.business.create({
    data: { id: ID.biz, name: 'V81F Books', slug: `${P}biz`, ownerId: ID.owner, currency: 'TTD', accountingBasis: 'CASH' },
  });
  for (const [user, role, permissionScopes] of [
    [ID.owner, 'OWNER', undefined],
    [ID.staffNone, 'STAFF', { revenue: 'none', crm: 'read' }],
    [ID.staffRead, 'STAFF', { revenue: 'read' }],
    [ID.staffDefault, 'STAFF', undefined],
  ] as const) {
    await db.membership.create({
      data: { id: `${user}_m`, userId: user, businessId: ID.biz, role, ...(permissionScopes ? { permissionScopes } : {}) },
    });
  }
  await coa.ensureDefaults(ID.biz);
  ACC.revenue = (await coa.getBySystemKey(ID.biz, 'REVENUE')).id;
  ACC.cash = (await coa.getBySystemKey(ID.biz, 'CASH')).id;

  for (const [id, last] of [[ID.contactPaid, 'Paid'], [ID.contactOpen, 'Open']] as const) {
    await db.contact.create({ data: { id, businessId: ID.biz, firstName: 'V81f', lastName: last, email: `${P}${id.slice(P.length)}@test.local` } });
  }
  const now = new Date();
  await db.invoice.create({
    data: {
      id: ID.invPaid, businessId: ID.biz, contactId: ID.contactPaid, invoiceNumber: 'V81F-0001', status: 'PAID',
      subtotal: 345.67, total: 345.67, currency: 'TTD', issueDate: now, paidAt: now,
    },
  });
  await db.payment.create({
    data: {
      id: ID.payment, businessId: ID.biz, invoiceId: ID.invPaid, amount: 345.67, currency: 'TTD',
      status: 'SUCCESSFUL', provider: 'cash', method: 'cash', providerPaymentId: `${P}cash-1`,
    },
  });
  await posting.post({
    businessId: ID.biz,
    type: 'INCOME',
    date: new Date(Date.now() - 60_000),
    amount: 345.67,
    currency: 'TTD',
    description: 'v81f payment received',
    contactId: ID.contactPaid,
    sourceType: 'Payment',
    sourceId: ID.payment,
    kind: 'payment_received',
    entries: [
      { accountId: ACC.cash, debit: 345.67 },
      { accountId: ACC.revenue, credit: 345.67 },
    ],
  });
  // A manual journal entry (GET journal-entries lists ADJUSTMENTs): equity
  // only, so the cash, revenue and receivable figures above are unchanged.
  await posting.post({
    businessId: ID.biz,
    type: 'ADJUSTMENT',
    date: new Date(Date.now() - 30_000),
    amount: ADJUSTMENT,
    currency: 'TTD',
    description: 'v81f owner drawings reclass',
    entries: [
      { accountId: (await coa.getBySystemKey(ID.biz, 'OWNER_DRAWINGS')).id, debit: ADJUSTMENT },
      { accountId: (await coa.getBySystemKey(ID.biz, 'OWNER_EQUITY')).id, credit: ADJUSTMENT },
    ],
  });
  await db.invoice.create({
    data: {
      id: ID.invOpen, businessId: ID.biz, contactId: ID.contactOpen, invoiceNumber: 'V81F-0002', status: 'OVERDUE',
      subtotal: 54.33, total: 54.33, currency: 'TTD', issueDate: new Date(Date.now() - 40 * 86400_000),
      dueDate: new Date(Date.now() - 10 * 86400_000), sentAt: new Date(Date.now() - 40 * 86400_000),
    },
  });
}, 60_000);

afterAll(async () => {
  vi.restoreAllMocks();
  if (app) await app.close();
  if (db) await cleanup();
}, 60_000);

describe('FOLLOW3-A6 (BRS-01..06): a revenue:none member reads no revenue or cash figure through the Books reads', () => {
  it('[BRS-00] baseline: no read has run, so the business holds no financial_accounts and no revenue_actions rows', async () => {
    expect(await rowCount('financial_accounts')).toBe(0);
    expect(await rowCount('revenue_actions')).toBe(0);
  });

  for (const read of READS) {
    it(`[${read.id}] RED-BEFORE: staffNone GET ${read.route === READS[1].route ? 'trial-balance/account/<REVENUE>' : read.route()} answers 403 '${REVENUE_DENIED}' before the service runs, with no figure`, async () => {
      clearSpies();
      const res = await get(read.route(), ID.staffNone);
      expect(res.status, JSON.stringify(res.body)).toBe(403);
      expect(res.body).toMatchObject({ code: 'FORBIDDEN', message: REVENUE_DENIED });
      expect(JSON.stringify(res.body), 'no revenue or cash figure is served').not.toMatch(/345\.67|54\.33|"rows"|"balance"|"totals"|"cashBalance"|"revenueThisMonth"|"invoicedTotal"/);
      expect(SPY[read.spy], `${read.spy} never runs for a refused read`).not.toHaveBeenCalled();
      // The overview seeded the default Cash and Bank accounts and upserted the
      // overdue invoice's revenue action on its first read; a refused read writes nothing.
      expect(await rowCount('financial_accounts'), 'financial_accounts unchanged by staffNone').toBe(0);
      expect(await rowCount('revenue_actions'), 'revenue_actions unchanged by staffNone').toBe(0);
    }, 30_000);
  }
});

describe('FOLLOW3-A6 (BRS-07): members who may read revenue keep every figure', () => {
  it('[BRS-07] control: staffRead {revenue:read}, STAFF on role defaults and the owner get 200 with the same figures as at head on all six reads', async () => {
    for (const as of [ID.staffRead, ID.staffDefault, ID.owner]) {
      for (const read of READS) {
        const res = await get(read.route(), as);
        expect(res.status, `${as} ${read.id}: ${JSON.stringify(res.body)}`).toBe(200);
        expect(read.figures(res.body), `${as} ${read.id}`).toEqual(expectedOf(read));
      }
    }
    // The first permitted overview read seeds the default accounts, as it always did.
    expect(await rowCount('financial_accounts')).toBeGreaterThan(0);
  }, 60_000);
});

describe('FOLLOW3-A6 (BRS-08): a non-member is refused on every Books read', () => {
  it('[BRS-08] the outsider gets 403 on the six reads and the trial balance, before any service runs', async () => {
    clearSpies();
    for (const route of [...READS.map((r) => r.route()), 'trial-balance']) {
      const res = await get(route, ID.outsider);
      expect(res.status, `${route}: ${JSON.stringify(res.body)}`).toBe(403);
      expect(res.body).toMatchObject({ code: 'FORBIDDEN', message: 'No access to this business' });
      expect(JSON.stringify(res.body)).not.toMatch(/345\.67|54\.33/);
    }
    for (const [name, spy] of Object.entries(SPY)) expect(spy, name).not.toHaveBeenCalled();
  }, 30_000);
});

describe('FOLLOW3-A6 (C3-00): GET trial-balance is unchanged', () => {
  it('[C3-00] staffNone is refused with the same message; staffRead, role-default STAFF and the owner read the REVENUE row', async () => {
    clearSpies();
    const refused = await get('trial-balance', ID.staffNone);
    expect(refused.status, JSON.stringify(refused.body)).toBe(403);
    expect(refused.body).toMatchObject({ code: 'FORBIDDEN', message: REVENUE_DENIED });
    expect(SPY.getTrialBalance).not.toHaveBeenCalled();

    for (const as of [ID.staffRead, ID.staffDefault, ID.owner]) {
      const res = await get('trial-balance', as);
      expect(res.status, `${as}: ${JSON.stringify(res.body)}`).toBe(200);
      const rows = res.body.items.filter((i: any) => i.accountId === ACC.revenue);
      expect(rows.map((i: any) => [i.currency, i.credit, i.net]), as).toEqual([['TTD', '345.67', '-345.67']]);
    }
  }, 30_000);
});

/**
 * Review SEC-A5A6-02: the routes that serve the gated figures again. `call`
 * makes the request; `spy` is the service method behind it ('' for the
 * journal list, which reads Prisma directly); `served` checks what a reader
 * that may see the figures gets back.
 */
const SIBLINGS: Array<{ route: string; spy: string; call: (as: string) => request.Test; served: (res: request.Response) => void }> = [
  {
    route: 'GET journal-entries',
    spy: '',
    call: (as) => get('journal-entries', as),
    served: (res) => {
      type Line = { debit: string; credit: string };
      const items: Array<{ entries?: Line[] }> = res.body.items ?? [];
      const amounts = items.flatMap((t) => (t.entries ?? []).map((e) => Number(e.debit) || Number(e.credit)));
      expect(amounts).toEqual([ADJUSTMENT, ADJUSTMENT]);
    },
  },
  {
    route: 'GET accountant-export.zip',
    spy: 'build',
    call: (as) => get('accountant-export.zip?start=2026-01-01&end=2026-12-31', as),
    served: (res) => expect(res.headers['content-disposition']).toContain('v81f-export.zip'),
  },
  {
    route: 'POST accountant-export',
    spy: 'build',
    call: (as) => request(app.getHttpServer()).post(`/finance/businesses/${ID.biz}/accountant-export`).set(HEADER, as)
      .send({ periodStart: '2026-01-01', periodEnd: '2026-12-31' }),
    // A permitted call goes on to object storage, which this harness does not
    // stand up; the refusal is what is under test, so BRS-10 skips it.
    served: () => undefined,
  },
  {
    route: 'POST accountant-export/email',
    spy: 'send',
    call: (as) => request(app.getHttpServer()).post(`/finance/businesses/${ID.biz}/accountant-export/email`).set(HEADER, as)
      .send({ periodStart: '2026-01-01', periodEnd: '2026-12-31', to: `${P}accountant@test.local` }),
    served: (res) => expect(res.body).toMatchObject({ sent: true }),
  },
  {
    route: 'GET money-moves',
    spy: 'generate',
    call: (as) => get('money-moves', as),
    served: (res) => expect(JSON.stringify(res.body)).toContain('could add TTD 54.33'),
  },
  {
    route: 'GET cashflow-forecast',
    spy: 'forecast',
    call: (as) => get('cashflow-forecast', as),
    served: (res) => expect(res.body).toHaveProperty('currency', 'TTD'),
  },
];

describe('FOLLOW3-A6 review SEC-A5A6-02 (BRS-09): the routes that serve the gated figures again carry the same gate', () => {
  for (const sibling of SIBLINGS) {
    it(`[BRS-09] RED-BEFORE: staffNone ${sibling.route} answers 403 '${REVENUE_DENIED}' before the service runs, with no figure`, async () => {
      clearSpies();
      const res = await sibling.call(ID.staffNone);
      expect(res.status, JSON.stringify(res.body)).toBe(403);
      expect(res.body).toMatchObject({ code: 'FORBIDDEN', message: REVENUE_DENIED });
      expect(JSON.stringify(res.body)).not.toMatch(/345\.67|54\.33|12\.34|"items"|"entries"|could add/);
      for (const [name, spy] of Object.entries(SPY)) expect(spy, `${name} never runs for a refused read`).not.toHaveBeenCalled();
    }, 30_000);
  }

  it('[BRS-10] control: staffRead, STAFF on role defaults and the owner still read them', async () => {
    for (const as of [ID.staffRead, ID.staffDefault, ID.owner]) {
      for (const sibling of SIBLINGS.filter((s) => s.route !== 'POST accountant-export')) {
        clearSpies();
        const res = await sibling.call(as);
        expect(res.status, `${as} ${sibling.route}: ${JSON.stringify(res.body)}`).toBeLessThan(300);
        sibling.served(res);
        if (sibling.spy) expect(SPY[sibling.spy], `${as} ${sibling.route}`).toHaveBeenCalledTimes(1);
        // The export's builder and mailer are handed the route business and the caller.
        if (sibling.spy === 'build' || sibling.spy === 'send') {
          expect(SPY[sibling.spy].mock.calls[0][0], `${as} ${sibling.route}`).toMatchObject({ businessId: ID.biz, userId: as });
        }
      }
    }
  }, 60_000);
});

describe('FOLLOW3-A6 review SEC-A5A6-04 (BRS-11): a SUPER_ADMIN with no Membership reads no Books figure', () => {
  it("[BRS-11] RED-BEFORE: the non-member SUPER_ADMIN gets 403 'No access to this business' on the six reads, the trial balance, journal-entries, money-moves and the cashflow forecast, before any service runs", async () => {
    clearSpies();
    for (const route of [...READS.map((r) => r.route()), 'trial-balance', 'journal-entries', 'money-moves', 'cashflow-forecast']) {
      const res = await get(route, ID.superAdmin);
      expect(res.status, `${route}: ${JSON.stringify(res.body)}`).toBe(403);
      expect(res.body).toMatchObject({ code: 'FORBIDDEN', message: 'No access to this business' });
      expect(JSON.stringify(res.body)).not.toMatch(/345\.67|54\.33|12\.34/);
    }
    for (const [name, spy] of Object.entries(SPY)) expect(spy, name).not.toHaveBeenCalled();
  }, 30_000);
});

describe('FOLLOW3-A6 review CR-A6-02 / SEC-A5A6-03 (BRS-12): the distinguished owner without a Membership row', () => {
  it("[BRS-12] (W10-OWNER-MEMBERSHIP, D-104, was it.todo) the distinguished owner (Business.ownerId) with no Membership row is refused 403 'No access to this business' by BusinessGuard on the six Books reads, the trial balance, journal-entries, money-moves, the cashflow forecast and GET expense-breakdown (no module gate) before any service runs; after the operator backfill writes its OWNER Membership it reads the owner's figures", async () => {
    // The distinguished owner: Business.ownerId names them and no Membership
    // row does (ID.owner keeps its OWNER membership; it is no longer ownerId).
    // Fixture setup only; restored in `finally`.
    await db.user.create({ data: { id: ID.distOwner, email: `${P}distOwner@test.local`, name: ID.distOwner, role: 'USER' } });
    await db.business.update({ where: { id: ID.biz }, data: { ownerId: ID.distOwner } });
    try {
      expect(await db.membership.count({ where: { businessId: ID.biz, userId: ID.distOwner } })).toBe(0);
      clearSpies();
      const routes = [...READS.map((r) => r.route()), 'trial-balance', 'journal-entries', 'money-moves', 'cashflow-forecast', 'expense-breakdown'];
      for (const route of routes) {
        const res = await get(route, ID.distOwner);
        expect(res.status, `${route}: ${JSON.stringify(res.body)}`).toBe(403);
        expect(res.body, route).toMatchObject({ code: 'FORBIDDEN', message: 'No access to this business' });
        expect(JSON.stringify(res.body)).not.toMatch(/345\.67|54\.33|12\.34|"items"/);
      }
      for (const [name, spy] of Object.entries(SPY)) expect(spy, name).not.toHaveBeenCalled();

      // D-104: the operator script writes the missing OWNER Membership (scoped
      // to this suite's business: the CLI scans every business).
      const { backfillOwnerMemberships } = await import('../scripts/backfill-owner-memberships');
      const counts = await backfillOwnerMemberships({ db, apply: true, businessIds: [ID.biz] });
      expect(counts).toMatchObject({ businessesScanned: 1, missingOwnerMembership: 1, written: 1, failed: 0 });
      const rows = await db.membership.findMany({ where: { businessId: ID.biz, userId: ID.distOwner }, select: { role: true } });
      expect(rows).toEqual([{ role: 'OWNER' }]);

      for (const read of READS) {
        const res = await get(read.route(), ID.distOwner);
        expect(res.status, `${read.id}: ${JSON.stringify(res.body)}`).toBe(200);
        expect(read.figures(res.body), read.id).toEqual(expectedOf(read));
      }
      const breakdown = await get('expense-breakdown', ID.distOwner);
      expect(breakdown.status, JSON.stringify(breakdown.body)).toBe(200);
      expect(breakdown.body).toEqual({ items: [] });
    } finally {
      await db.business.update({ where: { id: ID.biz }, data: { ownerId: ID.owner } });
    }
  }, 60_000);
});
