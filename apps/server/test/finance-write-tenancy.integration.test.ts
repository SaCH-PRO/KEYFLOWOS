/**
 * FOLLOW3-A5-FINANCE-WRITE-TENANCY — the Books journal-entry write and the
 * per-account balance are bound to the route's business (REAL database, REAL
 * FinanceController behind the real AuthGuard, BusinessGuard and the global
 * TenantInterceptor, REAL PostingService and LedgerBalanceService).
 *
 * Two tenancy defects on finance.controller.ts:
 *
 *   FWT-01  RED-BEFORE POST finance/businesses/:b/journal-entries ran no
 *           ensureAccess, the check every sibling Books write runs (accounts,
 *           chart-of-accounts, ...). BusinessGuard lets a SUPER_ADMIN through
 *           (business.guard.ts), so a SUPER_ADMIN with no Membership posted an
 *           ADJUSTMENT (DR cash 30 / CR equity 30) into another business's
 *           ledger: 201. GREEN-AFTER: 403 'No access to this business' and A's
 *           financial_transactions and ledger_entries counts are unchanged.
 *           Control: owner A's identical call answers 201 and posts.
 *   FWT-02  RED-BEFORE GET finance/businesses/:b/trial-balance/account/:accountId
 *           summed ledger entries by accountId alone (LedgerBalanceService
 *           .getAccountBalance runs ledgerEntry.aggregate, which the tenant
 *           extension does not hook), so owner B read A's CASH balance through
 *           B's route: 200 {balance:'100'}. GREEN-AFTER: 404 'Account not
 *           found', the same answer as an id that does not exist. Controls:
 *           owner A and A's STAFF member read A's account on A (200 '100');
 *           owner B reads B's own CASH (200 '0').
 *
 * Nothing on the boundary is mocked: PrismaService, AuthGuard, BusinessGuard,
 * TenantInterceptor, PostingService, AccountingPeriodService,
 * LedgerBalanceService and ChartOfAccountsSeederService run against the
 * database at DATABASE_URL. Identity attachment is the one stand-in: a test
 * middleware reads `x-v81e-user`, loads that seeded user row and attaches
 * `{ id, email, role }` exactly as the Supabase-verifying AuthMiddleware would.
 * FinanceController's other collaborators are off these two routes and stubbed.
 *
 * Fixtures: prefix `v81e_` (registered in test/helpers/fixture-prefixes.json);
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

const P = 'v81e_';
const HEADER = 'x-v81e-user';

const ID = {
  ownerA: `${P}ownerA`,
  ownerB: `${P}ownerB`,
  staffA: `${P}staffA`,
  superAdmin: `${P}super`,
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
};

let db: any;
let app: any;
let posting: any;
let coa: any;
/** A's CASH, REVENUE and OWNER_EQUITY chart-of-account rows; B's CASH row. */
const ACC: Record<string, string> = {};

async function cleanup() {
  for (const sql of [
    `DELETE FROM ledger_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM financial_transactions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM accounting_periods WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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

/** The business's financial_transactions and ledger_entries row counts, by raw SQL. */
async function bookCounts(businessId: string) {
  const [tx]: Array<{ n: number }> = await db.$queryRawUnsafe(
    'SELECT COUNT(*)::int AS n FROM financial_transactions WHERE business_id = $1', businessId,
  );
  const [le]: Array<{ n: number }> = await db.$queryRawUnsafe(
    'SELECT COUNT(*)::int AS n FROM ledger_entries WHERE business_id = $1', businessId,
  );
  return { transactions: tx.n, entries: le.n };
}

/** DR cash 30 / CR owner equity 30 on business A's chart rows. */
function journalBody() {
  return {
    date: new Date(Date.now() - 60_000).toISOString(),
    description: 'v81e manual adjustment',
    reference: 'v81e-ref',
    entries: [
      { accountId: ACC.cashA, debit: 30 },
      { accountId: ACC.equityA, credit: 30 },
    ],
  };
}

function postJournal(businessId: string, as: string) {
  return request(app.getHttpServer())
    .post(`/finance/businesses/${businessId}/journal-entries`)
    .set(HEADER, as)
    .send(journalBody());
}

function accountBalance(businessId: string, accountId: string, as: string) {
  return request(app.getHttpServer())
    .get(`/finance/businesses/${businessId}/trial-balance/account/${accountId}`)
    .set(HEADER, as);
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { TenantInterceptor } = await import('../src/core/tenant/tenant.interceptor');
  const { FinanceController } = await import('../src/modules/finance/finance.controller');
  const { PostingService } = await import('../src/modules/finance/posting.service');
  const { AccountingPeriodService } = await import('../src/modules/finance/accounting-period.service');
  const { LedgerBalanceService } = await import('../src/modules/finance/ledger-balance.service');
  const { ChartOfAccountsSeederService } = await import('../src/modules/finance/chart-of-accounts-seeder.service');

  // FinanceController's collaborators off the journal-entry and per-account routes.
  const stubs = await Promise.all([
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
    import('../src/core/object-storage').then((m) => m.ObjectStorageService),
  ]);

  const moduleRef = await Test.createTestingModule({
    controllers: [FinanceController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      // Live: the ledger door, its period lock and the balance reader.
      PostingService,
      AccountingPeriodService,
      LedgerBalanceService,
      ChartOfAccountsSeederService,
      ...stubs.map((token) => ({ provide: token, useValue: {} })),
    ],
  }).compile();
  posting = moduleRef.get(PostingService);
  coa = moduleRef.get(ChartOfAccountsSeederService);

  app = moduleRef.createNestApplication();
  attachIdentity(app);
  app.useGlobalInterceptors(new TenantInterceptor(moduleRef.get(PrismaService)));
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  await app.init();

  await cleanup(); // in case a prior run aborted

  for (const [id, role] of [
    [ID.ownerA, 'USER'], [ID.ownerB, 'USER'], [ID.staffA, 'USER'], [ID.superAdmin, 'SUPER_ADMIN'],
  ] as const) {
    await db.user.create({ data: { id, email: `${id}@test.local`, name: id, role } });
  }
  for (const [biz, owner, tag] of [[ID.bizA, ID.ownerA, 'a'], [ID.bizB, ID.ownerB, 'b']] as const) {
    await db.business.create({ data: { id: biz, name: `V81E ${tag}`, slug: `${P}biz-${tag}`, ownerId: owner, currency: 'TTD' } });
    await db.membership.create({ data: { id: `${biz}_owner`, userId: owner, businessId: biz, role: 'OWNER' } });
    await coa.ensureDefaults(biz);
  }
  // A's STAFF member (role defaults). The SUPER_ADMIN has no Membership anywhere.
  await db.membership.create({ data: { id: `${ID.bizA}_staff`, userId: ID.staffA, businessId: ID.bizA, role: 'STAFF' } });

  ACC.cashA = (await coa.getBySystemKey(ID.bizA, 'CASH')).id;
  ACC.revenueA = (await coa.getBySystemKey(ID.bizA, 'REVENUE')).id;
  ACC.equityA = (await coa.getBySystemKey(ID.bizA, 'OWNER_EQUITY')).id;
  ACC.cashB = (await coa.getBySystemKey(ID.bizB, 'CASH')).id;

  // A's book: DR CASH 100 / CR REVENUE 100.
  await posting.post({
    businessId: ID.bizA,
    type: 'INCOME',
    date: new Date(Date.now() - 120_000),
    amount: 100,
    currency: 'TTD',
    description: 'v81e income',
    sourceType: 'V81eFixture',
    sourceId: `${P}income`,
    kind: 'income',
    entries: [
      { accountId: ACC.cashA, debit: 100 },
      { accountId: ACC.revenueA, credit: 100 },
    ],
  });
}, 60_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
}, 60_000);

describe('FOLLOW3-A5 (FWT-02): the per-account balance is bound to the route business', () => {
  it("[FWT-02] RED-BEFORE: owner B reading A's CASH chart-account id through B's route answers 404 'Account not found', the same as an unknown id; owner A and A's STAFF member read 100 on A; owner B reads B's own CASH", async () => {
    const leak = await accountBalance(ID.bizB, ACC.cashA, ID.ownerB);
    expect(leak.status, JSON.stringify(leak.body)).toBe(404);
    expect(leak.body).toMatchObject({ code: 'NOT_FOUND', message: 'Account not found' });
    expect(JSON.stringify(leak.body), "no figure of A's account is served").not.toMatch(/"balance"|100/);

    const unknown = await accountBalance(ID.bizB, `${P}no-such-account`, ID.ownerB);
    expect(unknown.status, JSON.stringify(unknown.body)).toBe(404);
    expect(unknown.body).toMatchObject({ code: 'NOT_FOUND', message: 'Account not found' });

    for (const as of [ID.ownerA, ID.staffA]) {
      const own = await accountBalance(ID.bizA, ACC.cashA, as);
      expect(own.status, `${as}: ${JSON.stringify(own.body)}`).toBe(200);
      expect(own.body).toEqual({ accountId: ACC.cashA, balance: '100' });
    }

    const ownB = await accountBalance(ID.bizB, ACC.cashB, ID.ownerB);
    expect(ownB.status, JSON.stringify(ownB.body)).toBe(200);
    expect(ownB.body).toEqual({ accountId: ACC.cashB, balance: '0' });

    // Unchanged: owner B on A's route is refused by BusinessGuard.
    const foreignRoute = await accountBalance(ID.bizA, ACC.cashA, ID.ownerB);
    expect(foreignRoute.status, JSON.stringify(foreignRoute.body)).toBe(403);
  }, 30_000);
});

describe('FOLLOW3-A5 (FWT-01): a journal entry needs owner or membership, as every sibling Books write does', () => {
  it("[FWT-01] RED-BEFORE: a SUPER_ADMIN with no Membership POSTing A's journal-entries {DR cash 30 / CR equity 30} answers 403 'No access to this business' and A's book is unchanged", async () => {
    const before = await bookCounts(ID.bizA);
    const adjustmentsBefore = await db.financialTransaction.count({ where: { businessId: ID.bizA, type: 'ADJUSTMENT' } });

    const res = await postJournal(ID.bizA, ID.superAdmin);
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body).toMatchObject({ code: 'FORBIDDEN', message: 'No access to this business' });
    expect(res.body).not.toHaveProperty('transactionId');

    expect(await bookCounts(ID.bizA), "A's financial_transactions and ledger_entries counts are unchanged").toEqual(before);
    expect(await db.financialTransaction.count({ where: { businessId: ID.bizA, type: 'ADJUSTMENT' } })).toBe(adjustmentsBefore);
    const byAdmin = await db.financialTransaction.count({ where: { createdById: ID.superAdmin } });
    expect(byAdmin, 'no posting names the SUPER_ADMIN anywhere').toBe(0);
  }, 30_000);

  it("[FWT-01] control: owner A's identical call answers 201 and posts one ADJUSTMENT (DR CASH 30 / CR OWNER_EQUITY 30) in A, authored by owner A", async () => {
    const before = await bookCounts(ID.bizA);

    const res = await postJournal(ID.bizA, ID.ownerA);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.alreadyPosted).toBe(false);
    expect(typeof res.body.transactionId).toBe('string');

    expect(await bookCounts(ID.bizA)).toEqual({ transactions: before.transactions + 1, entries: before.entries + 2 });
    const tx = await db.financialTransaction.findUnique({
      where: { id: res.body.transactionId },
      include: { entries: true },
    });
    expect(tx).toMatchObject({ businessId: ID.bizA, type: 'ADJUSTMENT', status: 'POSTED', createdById: ID.ownerA });
    const legs = tx.entries
      .map((e: any) => [e.accountId, Number(e.debit), Number(e.credit)])
      .sort((a: any[], b: any[]) => String(a[0]).localeCompare(String(b[0])));
    expect(legs).toEqual(
      [[ACC.cashA, 30, 0], [ACC.equityA, 0, 30]].sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    );
  }, 30_000);
});
