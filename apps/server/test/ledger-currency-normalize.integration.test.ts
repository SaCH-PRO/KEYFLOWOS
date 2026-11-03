/**
 * V1-37c-CURRENCY-NORMALIZE-CASH (part 1: the ledger readers) — the trial
 * balance and the balance sheet group by the NORMALIZED currency code (REAL
 * database, REAL ledger door, REAL trial-balance and balance-sheet routes
 * behind the real AuthGuard, BusinessGuard and ModuleScopeGuard).
 *
 * VR-03 (independent verification of int/trial-I; a V1-37 / V1-37b regression
 * and a V1-34 gap): ledger rows written before the posting door normalized the
 * code hold it as their writer spelled it (lower-case 'ttd'). The trial
 * balance grouped by the raw stored currency (LedgerBalanceService
 * getTrialBalance, groupBy ['accountId', 'currency']), so one account read two
 * rows, {ttd, debit 100} and {TTD, debit 50}; the balance sheet keyed its
 * per-currency sheets on the raw row currency, so the business-currency sheet
 * (TTD) dropped the 'ttd' rows (cashAndBank 50, totalAssets 50; byCurrency
 * keys [TTD, ttd]), and LedgerReportingService.getCurrency read the business's
 * stored currency raw, so a business stored as 'ttd' labelled its top-level
 * sheet 'ttd' and lost every door-posted 'TTD' row from it. Owner ruling D-13:
 * one currency per business (TTD and USD supported), no heterogeneous sums.
 * No backfill of stored codes (no migration): the readers normalize on read.
 *
 * Contract pinned here (RED-BEFORE marks a case that fails at int/trial-I):
 *
 *   LCN-01 RED-BEFORE GET trial-balance (real route) on a TTD business holding
 *          legacy 'ttd' and 'usd' rows beside door-posted 'TTD' and 'USD' rows:
 *          one CASH row, TTD, debit 150; every row's currency is an upper-case
 *          D-13 code; one row per (account, normalized currency); per currency
 *          sum(debit) = sum(credit); each row equals Postgres' own sum grouped
 *          by UPPER(TRIM(currency)); no row of another tenant
 *   LCN-02 RED-BEFORE GET balance-sheet (real route): the top level is the TTD
 *          sheet with cashAndBank 150 and totalAssets 150; byCurrency keys are
 *          exactly [TTD, USD]; each sheet one line per account, every line
 *          labelled with its sheet's currency, each figure equal to Postgres'
 *          own per-normalized-currency sums, each identity holding; nothing
 *          adds TTD and USD
 *   LCN-03 RED-BEFORE a business whose stored currency is the legacy 'ttd':
 *          the trial balance reads every row (idle accounts too) as TTD, the
 *          balance sheet's top level is TTD and carries the door-posted cash
 *          (byCurrency [TTD] only), the P&L is labelled TTD; another tenant's
 *          owner gets 403 on both reports
 *
 * Nothing on the boundary is mocked: PrismaService, AuthGuard, BusinessGuard,
 * ModuleScopeGuard, the global TenantInterceptor, PostingService,
 * AccountingPeriodService, ChartOfAccountsSeederService, LedgerBalanceService
 * and LedgerReportingService read and write real rows. Identity attachment is
 * the one stand-in: a test middleware reads `x-v37c-user`, loads that seeded
 * user row and attaches `{ id, email, role }` as the Supabase-verifying
 * AuthMiddleware would. FinanceController's and ReportsController's
 * collaborators off the trial-balance / balance-sheet / P&L path are stubs.
 * The legacy rows are inserted directly (as the pre-normalizing writers left
 * them): the door now normalizes every code it writes, so it cannot write one.
 *
 * Fixtures: prefix `v37c_` (registered in test/helpers/fixture-prefixes.json);
 * hard-deleted by raw SQL (patterns built by sqlLikePrefix) in dependency order
 * in beforeAll and afterAll; no $transaction wrapping.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v37c_';
const HEADER = 'x-v37c-user';

const ID = {
  ownerT: `${P}ownerT`,
  bizT: `${P}bizT`, // currency 'TTD': legacy 'ttd' / 'usd' rows beside door-posted TTD / USD rows
  ownerL: `${P}ownerL`,
  bizL: `${P}bizL`, // currency stored as the legacy lower-case 'ttd'
};

const D13 = ['TTD', 'USD'];
const CASH_KEYS = ['CASH', 'BANK', 'PAYMENT_PROCESSOR'];

let db: any;
let financeApp: any;
let reportsApp: any;
let posting: any;
let coa: any;

async function cleanup() {
  for (const sql of [
    `DELETE FROM ledger_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM financial_transactions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM financial_accounts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM team_activity_logs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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
const minuteAgo = () => new Date(Date.now() - 60_000);
const asOf = () => new Date(Date.now() + 60_000).toISOString();

/** A balanced posting through the real door. A non-business currency needs a source document (D-13). */
async function post(businessId: string, kind: string, amount: number, debitKey: string, creditKey: string, currency?: string) {
  const dr = await coa.getBySystemKey(businessId, debitKey);
  const cr = await coa.getBySystemKey(businessId, creditKey);
  return posting.post({
    businessId,
    type: 'ADJUSTMENT',
    date: minuteAgo(),
    amount,
    ...(currency ? { currency, sourceType: 'V37cFixture', sourceId: `${P}${kind}` } : {}),
    description: `v37c ${kind}`,
    kind,
    entries: [
      { accountId: dr.id, debit: amount },
      { accountId: cr.id, credit: amount },
    ],
  });
}

/**
 * A ledger posting as a writer that predates the door's normalization left it:
 * the transaction and its entries hold `currency` exactly as spelled. Inserted
 * directly; the door upper-cases every code it writes.
 */
async function legacyPosting(businessId: string, key: string, currency: string, amount: number, debitKey: string, creditKey: string) {
  const dr = await coa.getBySystemKey(businessId, debitKey);
  const cr = await coa.getBySystemKey(businessId, creditKey);
  const date = minuteAgo();
  const id = `${P}${key}`;
  await db.financialTransaction.create({
    data: {
      id, businessId, type: 'ADJUSTMENT', status: 'POSTED', date, amount, currency,
      description: `v37c legacy ${key}`, sourceType: 'V37cLegacy', sourceId: id, externalRef: `V37cLegacy:${id}:legacy`,
    },
  });
  await db.ledgerEntry.createMany({
    data: [
      { businessId, transactionId: id, accountId: dr.id, currency, date, debit: amount, credit: 0 },
      { businessId, transactionId: id, accountId: cr.id, currency, date, debit: 0, credit: amount },
    ],
  });
}

/**
 * LEDGER, computed independently of every reader under test: Postgres' own
 * debit and credit sums per (account, normalized currency) of the business's
 * entries, with each account's system key and type.
 */
async function ledgerSums(businessId: string): Promise<Array<{ accountId: string; systemKey: string | null; type: string; currency: string; debit: number; credit: number }>> {
  const rows: any[] = await db.$queryRawUnsafe(
    `SELECT le.account_id AS "accountId", coa.system_key AS "systemKey", coa.type AS type,
            UPPER(TRIM(le.currency)) AS currency,
            SUM(le.debit)::text AS debit, SUM(le.credit)::text AS credit
       FROM ledger_entries le
       JOIN chart_of_accounts coa ON coa.id = le.account_id
      WHERE le.business_id = $1
      GROUP BY 1, 2, 3, 4`,
    businessId,
  );
  return rows.map((r) => ({ ...r, debit: money(Number(r.debit)), credit: money(Number(r.credit)) }));
}

async function trialBalance(biz: string, as: string) {
  const res = await request(financeApp.getHttpServer()).get(`/finance/businesses/${biz}/trial-balance`).set(HEADER, as);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.items as Array<{ accountId: string; systemKey: string | null; type: string; currency: string; debit: string; credit: string; net: string }>;
}

async function balanceSheet(biz: string, as: string) {
  return request(reportsApp.getHttpServer()).get(`/businesses/${biz}/reports/balance-sheet`).query({ asOf: asOf() }).set(HEADER, as);
}

/** Every trial-balance row is labelled with an upper-case D-13 code, once per (account, currency), and each currency balances. */
function expectNormalizedTrialBalance(items: Array<{ accountId: string; currency: string; debit: string; credit: string }>) {
  for (const item of items) expect(D13, `${item.accountId} ${item.currency}`).toContain(item.currency);
  const keys = items.map((i) => `${i.accountId}|${i.currency}`);
  expect(new Set(keys).size, 'one row per (account, normalized currency)').toBe(keys.length);
  for (const code of new Set(items.map((i) => i.currency))) {
    const rows = items.filter((i) => i.currency === code);
    const debit = money(rows.reduce((s, r) => s + Number(r.debit), 0));
    const credit = money(rows.reduce((s, r) => s + Number(r.credit), 0));
    expect(debit, `${code}: sum(debit) = sum(credit)`).toBe(credit);
  }
}

/** Each trial-balance row equals Postgres' own (account, normalized currency) sums; every SQL group is a row. */
async function expectTrialBalanceEqualsLedger(biz: string, items: Array<{ accountId: string; currency: string; debit: string; credit: string }>) {
  const sums = await ledgerSums(biz);
  for (const s of sums) {
    const item = items.find((i) => i.accountId === s.accountId && i.currency === s.currency);
    expect(item, `${s.systemKey} ${s.currency} is a trial-balance row`).toBeDefined();
    expect({ debit: money(Number(item!.debit)), credit: money(Number(item!.credit)) }, `${s.systemKey} ${s.currency}`).toEqual({ debit: s.debit, credit: s.credit });
  }
  for (const item of items.filter((i) => Number(i.debit) !== 0 || Number(i.credit) !== 0)) {
    expect(sums.some((s) => s.accountId === item.accountId && s.currency === item.currency), `${item.accountId} ${item.currency} has ledger rows`).toBe(true);
  }
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
  const { PostingService } = await import('../src/modules/finance/posting.service');
  const { AccountingPeriodService } = await import('../src/modules/finance/accounting-period.service');
  const { ChartOfAccountsSeederService } = await import('../src/modules/finance/chart-of-accounts-seeder.service');
  const { LedgerBalanceService } = await import('../src/modules/finance/ledger-balance.service');
  const { FinanceController } = await import('../src/modules/finance/finance.controller');
  const { ReportsController } = await import('../src/modules/reports/reports.controller');
  const { ReportsService } = await import('../src/modules/reports/reports.service');
  const { LedgerReportingService } = await import('../src/modules/reports/ledger-reporting.service');
  const { ReceivablesService } = await import('../src/modules/finance/receivables.service');
  // FinanceController's collaborators off the trial-balance path (stubbed).
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

  // ---- finance app: the real trial-balance route --------------------------
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
      ChartOfAccountsSeederService,
      { provide: ReceivablesService, useValue: {} },
      ...financeStubs.map((token) => ({ provide: token, useValue: {} })),
    ],
  }).compile();
  posting = financeRef.get(PostingService);
  coa = financeRef.get(ChartOfAccountsSeederService);
  financeApp = financeRef.createNestApplication();
  attachIdentity(financeApp);
  financeApp.useGlobalInterceptors(new TenantInterceptor(financeRef.get(PrismaService)));
  financeApp.useGlobalFilters(new GlobalHttpExceptionFilter());
  await financeApp.init();

  // ---- reports app: the real balance-sheet and P&L routes over the real trial balance ----
  const reportsRef = await Test.createTestingModule({
    controllers: [ReportsController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      LedgerBalanceService,
      LedgerReportingService,
      // Off the balance-sheet and accrual P&L path.
      { provide: ReceivablesService, useValue: {} },
      { provide: ReportsService, useValue: {} },
    ],
  }).compile();
  reportsApp = reportsRef.createNestApplication();
  attachIdentity(reportsApp);
  reportsApp.useGlobalInterceptors(new TenantInterceptor(reportsRef.get(PrismaService)));
  reportsApp.useGlobalFilters(new GlobalHttpExceptionFilter());
  await reportsApp.init();

  await cleanup(); // in case a prior run aborted

  for (const [user, biz, currency, tag] of [
    [ID.ownerT, ID.bizT, 'TTD', 't'],
    [ID.ownerL, ID.bizL, 'ttd', 'l'],
  ] as const) {
    await db.user.create({ data: { id: user, email: `${P}owner_${tag}@test.local`, role: 'USER' } });
    await db.business.create({ data: { id: biz, name: `V37C ${tag}`, ownerId: user, currency, accountingBasis: 'ACCRUAL' } });
    await db.membership.create({ data: { id: `${user}_m`, userId: user, businessId: biz, role: 'OWNER' } });
    await coa.ensureDefaults(biz);
  }

  // T: the verifier's repro. A legacy 'ttd' cash receipt of 100 beside a
  // door-posted TTD 50; a door-posted USD 20 (from a source document) beside a
  // legacy 'usd' 5.
  await legacyPosting(ID.bizT, 't_legacy_ttd', 'ttd', 100, 'CASH', 'OWNER_EQUITY');
  await post(ID.bizT, 't_door_ttd', 50, 'CASH', 'OTHER_INCOME');
  await post(ID.bizT, 't_door_usd', 20, 'BANK', 'OWNER_EQUITY', 'USD');
  await legacyPosting(ID.bizT, 't_legacy_usd', 'usd', 5, 'BANK', 'OWNER_EQUITY');

  // L (stored currency 'ttd'): the door posts in the normalized TTD; a legacy
  // writer left its raw 'ttd'.
  await post(ID.bizL, 'l_door', 70, 'CASH', 'OTHER_INCOME');
  await legacyPosting(ID.bizL, 'l_legacy', 'ttd', 30, 'CASH', 'OWNER_EQUITY');
}, 180_000);

afterAll(async () => {
  for (const app of [financeApp, reportsApp]) {
    if (app) await app.close();
  }
  if (db) await cleanup();
}, 60_000);

describe('V1-37c fixture sanity (real rows)', () => {
  it('the legacy rows hold their raw codes; the door wrote upper-case codes', async () => {
    const codes: Array<{ currency: string }> = await db.$queryRawUnsafe(
      `SELECT DISTINCT currency FROM ledger_entries WHERE business_id = $1 ORDER BY currency`,
      ID.bizT,
    );
    expect(codes.map((c) => c.currency)).toEqual(['TTD', 'USD', 'ttd', 'usd']);
    const door = await db.ledgerEntry.findMany({ where: { businessId: ID.bizL, transaction: { sourceId: null } }, select: { currency: true } });
    expect(door.map((e: any) => e.currency)).toEqual(['TTD', 'TTD']);
  }, 30_000);
});

describe('V1-37c the ledger readers group by the normalized currency code (VR-03)', () => {
  it("LCN-01 RED-BEFORE: GET trial-balance reads legacy 'ttd' rows with 'TTD' (one CASH row, debit 150) and equals Postgres' normalized sums", async () => {
    const items = await trialBalance(ID.bizT, ID.ownerT);
    const cash = await coa.getBySystemKey(ID.bizT, 'CASH');
    const cashRows = items.filter((i) => i.accountId === cash.id);
    expect(cashRows.map((r) => ({ currency: r.currency, debit: Number(r.debit), credit: Number(r.credit) }))).toEqual([
      { currency: 'TTD', debit: 150, credit: 0 },
    ]);
    const bank = await coa.getBySystemKey(ID.bizT, 'BANK');
    expect(items.filter((i) => i.accountId === bank.id).map((r) => [r.currency, Number(r.debit)])).toEqual([['USD', 25]]);
    const equity = await coa.getBySystemKey(ID.bizT, 'OWNER_EQUITY');
    expect(items.filter((i) => i.accountId === equity.id).map((r) => [r.currency, Number(r.credit)])).toEqual([['TTD', 100], ['USD', 25]]);

    expectNormalizedTrialBalance(items);
    await expectTrialBalanceEqualsLedger(ID.bizT, items);

    // TENANT: every row is one of T's chart rows.
    const own = new Set((await db.chartOfAccount.findMany({ where: { businessId: ID.bizT }, select: { id: true } })).map((a: any) => a.id));
    for (const item of items) expect(own.has(item.accountId), item.accountId).toBe(true);
  }, 30_000);

  it('LCN-02 RED-BEFORE: GET balance-sheet: the TTD sheet carries the legacy rows (cashAndBank 150, totalAssets 150); byCurrency is exactly [TTD, USD]', async () => {
    const res = await balanceSheet(ID.bizT, ID.ownerT);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const sheet = res.body;
    expect(sheet.currency).toBe('TTD');
    expect(sheet.assets.cashAndBank).toBe(150);
    expect(sheet.assets.total).toBe(150);
    expect(sheet.equity.ownerEquity).toBe(100);
    expect(sheet.netEquityFromIncome).toBe(50);
    expect(sheet.identityHolds).toBe(true);
    expect(Object.keys(sheet.byCurrency).sort()).toEqual(['TTD', 'USD']);
    expect(sheet.byCurrency.USD).toMatchObject({ currency: 'USD', identityHolds: true });
    expect(sheet.byCurrency.USD.assets).toMatchObject({ cashAndBank: 25, total: 25 });
    expect(sheet.byCurrency.USD.equity.ownerEquity).toBe(25);

    // Independent: Postgres' own per-normalized-currency sums.
    const sums = await ledgerSums(ID.bizT);
    for (const code of ['TTD', 'USD']) {
      const s = sheet.byCurrency[code];
      const inCode = sums.filter((r) => r.currency === code);
      const net = (rows: typeof sums) => money(rows.reduce((t, r) => t + r.debit - r.credit, 0));
      expect(s.assets.cashAndBank, `${code} cash`).toBe(net(inCode.filter((r) => r.systemKey && CASH_KEYS.includes(r.systemKey))));
      expect(s.assets.total, `${code} assets`).toBe(net(inCode.filter((r) => r.type === 'ASSET')));
      expect(s.equity.total, `${code} equity`).toBe(-net(inCode.filter((r) => r.type === 'EQUITY')));
      // One line per account, every line labelled with its sheet's currency.
      const lines = [...s.assets.lines, ...s.liabilities.lines, ...s.equity.lines];
      expect(new Set(lines.map((l: any) => l.accountId)).size, `${code}: one line per account`).toBe(lines.length);
      for (const line of lines) expect(line.currency, `${code} ${line.name}`).toBe(code);
    }
    // The top level is the TTD sheet, never a TTD + USD sum.
    expect(sheet.assets.total).toBe(sheet.byCurrency.TTD.assets.total);
  }, 30_000);

  it("LCN-03 RED-BEFORE: a business stored as 'ttd' reads every row as TTD; the top-level sheet carries the door-posted cash; the P&L is labelled TTD; another tenant gets 403", async () => {
    const items = await trialBalance(ID.bizL, ID.ownerL);
    expect([...new Set(items.map((i) => i.currency))], 'idle accounts too read in the normalized business currency').toEqual(['TTD']);
    const cash = await coa.getBySystemKey(ID.bizL, 'CASH');
    expect(items.filter((i) => i.accountId === cash.id).map((r) => [r.currency, Number(r.debit)])).toEqual([['TTD', 100]]);
    expectNormalizedTrialBalance(items);
    await expectTrialBalanceEqualsLedger(ID.bizL, items);

    const res = await balanceSheet(ID.bizL, ID.ownerL);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.currency).toBe('TTD');
    expect(Object.keys(res.body.byCurrency)).toEqual(['TTD']);
    expect(res.body.assets).toMatchObject({ cashAndBank: 100, total: 100 });
    expect(res.body.equity.ownerEquity).toBe(30);
    expect(res.body.netEquityFromIncome).toBe(70);
    expect(res.body.identityHolds).toBe(true);

    const from = new Date(Date.now() - 86_400_000).toISOString();
    const pnl = await request(reportsApp.getHttpServer())
      .get(`/businesses/${ID.bizL}/reports/pnl`).query({ from, to: asOf() }).set(HEADER, ID.ownerL);
    expect(pnl.status, JSON.stringify(pnl.body)).toBe(200);
    expect(pnl.body.currency).toBe('TTD');
    expect(pnl.body.revenue.total).toBe(70);

    // TENANT: neither owner reads the other's books.
    expect((await balanceSheet(ID.bizT, ID.ownerL)).status).toBe(403);
    expect((await request(financeApp.getHttpServer()).get(`/finance/businesses/${ID.bizL}/trial-balance`).set(HEADER, ID.ownerT)).status).toBe(403);
  }, 30_000);
});
