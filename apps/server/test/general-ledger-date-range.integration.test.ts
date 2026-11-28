/**
 * V1-66 SWP-FIN-LEDGER (BUG-029). REAL database, through the HTTP route.
 *
 * GET /finance/businesses/:businessId/general-ledger?to=D parsed a date-only end date as midnight UTC and
 * filtered `date <= midnight`, so every line later in day D was dropped: picking one day on the General
 * Ledger page (from=D&to=D) answered only the lines dated exactly midnight. The controller turned `to` into
 * a Date before the service saw it, so the service could not tell a date-only value from a timestamp.
 *
 * Packet rule: a date-only `to` (YYYY-MM-DD) covers the whole of that day in the business's timezone
 * (Business.timezone); a `to` that is a timestamp keeps `<=`. Under FU-LEDGER-ZONED-FROM, a date-only
 * `from` also starts at 00:00 in the business's timezone (`>= beginOfZonedDay`), while a timestamp `from`
 * keeps `>=` its exact instant.
 *
 * Business A keeps America/Port_of_Spain (UTC-4, no daylight saving). On D = 2026-03-10 it holds 3 postings
 * dated midnight UTC (2026-03-09 20:00 local, 6 lines) and 6 postings through local day D (12 lines, starting
 * at D 04:00:00.000Z through D+1 03:59:59.999Z). One posting sits just before midnight UTC (D-1 23:59:59.999Z)
 * and one at the first instant of the next local day (D+1 04:00:00.000Z).
 *
 *   GLD-01  RED-BEFORE  from=D&to=D answers the 12 lines of local day D (FU-LEDGER-ZONED-FROM), total 12
 *   GLD-02  RED-BEFORE  to=D alone answers everything up to the end of local day D, and not the next day's line
 *   GLD-03  KEEP        a timestamp `to` keeps `<=`: the line dated exactly `to` is in, later lines are out;
 *                       midnight written as a timestamp is not widened to the day; an offset timestamp is read
 *                       as the instant it names
 *   GLD-04  RED-BEFORE  pageSize is honoured over the whole local day: 5 a page, 3 pages, 12 distinct lines,
 *                       total 12; `limit` is not a parameter of this route
 *   GLD-05  RED-BEFORE  the day is the BUSINESS's day: Asia/Kolkata (UTC+5:30) ends D at D 18:30Z; New York on
 *                       the day the clocks go forward (2026-03-08, a 23-hour day) ends it at 04:00Z, not 05:00Z
 *   GLD-06  RED-BEFORE  a date that is not on the calendar (2026-02-31) is refused 400 'Invalid to date' (it
 *                       was read as 3 March); words that are no date keep their 400
 *   GLD-07  RED-BEFORE  a business whose stored timezone is not a zone still answers (the platform default
 *                       zone, America/Port_of_Spain), it does not fail
 *   GLD-08  RED-BEFORE  every line says its own currency (a TTD business's USD line says USD)
 *   GLD-10  RED-BEFORE  (review F2) a day whose next local midnight does not exist: Havana puts its clocks forward at
 *                       00:00 on 2026-03-08, so 7 March ends at 05:00Z; the line at 23:59:59.999 local is in
 *                       (the end was computed an hour early, 04:00Z, and dropped the day's last hour)
 *   GLD-11  RED-BEFORE  (review N-1) the last day a timestamp can hold: to=9999-12-31 answers 200 with the
 *                       business's lines, it does not fail on an end instant in year 10000
 *   GLD-12  RED-BEFORE  (review C-2) a day whose next local midnight comes twice: Amman put its clocks back at
 *                       01:00 on 2019-10-25, so 24 October ends at the FIRST 00:00 (21:00Z), not the second
 *   GLD-13  RED-BEFORE  (review C-4) the running balance is per account AND currency: the USD line's balance is
 *                       its own 107, not 107 added to the TTD lines before it (D-13: two currencies are never
 *                       added into one figure)
 *   GLD-14  RED-BEFORE  (final review C-2) a skipped stretch that straddles midnight: Toronto, 1919-03-30, 23:30
 *                       jumped to 00:30, so 30 March ends at the jump (04:30Z), not half an hour later
 *   GLD-15  RED-BEFORE  (final review C-1) the order is total: lines tied on date and creation time (the two
 *                       lines of one posting) come in id order, so a page boundary between them neither
 *                       repeats nor drops a line (the tie was left to Postgres)
 *   GLD-16  RED-BEFORE  (acceptance review B-1) the running balance does not start over on a later page: page N
 *                       carries on from the lines of pages 1 to N-1 in the same range and order, so every line's
 *                       balance is the one the whole range on one page gives it (page 2 started from the lines
 *                       dated before `from`, or from nothing without `from`, and dropped page 1's lines)
 *                       It also catches a seed keyed by account alone (not currency): the USD posting sits on page
 *                       3 at 5 a page and the TTD 'afternoon' lines of the same accounts on page 4 (checked: that
 *                       mutant answers page 4 '-836', not '-729')
 *   GLD-17  RED-BEFORE  (orchestrator review S-1) a page past the end answers no rows and the range's total, and
 *                       reads no opening balance (it loaded every line of the range into the server to seed it)
 *   GLD-18  RED-BEFORE  (orchestrator review S-1) a later page seeds its balance in the database: no read of
 *                       ledger lines asks for more than the page holds (it loaded (page-1)*pageSize lines)
 *   GLD-09  KEEP        tenancy and scope hold on the date-only read: another business's owner and a
 *                       revenue-none member are refused 403 and get no line; no answer carries another
 *                       business's line
 *
 * Nothing on the boundary is mocked: PrismaService, AuthGuard, BusinessGuard, ModuleScopeGuard,
 * TenantInterceptor, FinanceController, LedgerBalanceService, PostingService, AccountingPeriodService and
 * ChartOfAccountsSeederService run against DATABASE_URL. Stand-ins: identity attachment (a test middleware
 * reads `x-v66g-user`, loads that seeded user row and attaches `{ id, email, role }`, as the
 * Supabase-verifying AuthMiddleware does) and FinanceController's collaborators off this route (empty objects).
 *
 * Fixtures: prefix `v66g_` (registered in test/helpers/fixture-prefixes.json); hard-deleted by raw SQL
 * (patterns built by sqlLikePrefix) in dependency order in beforeAll and afterAll.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

vi.setConfig({ testTimeout: 30_000 });

const P = 'v66g_';
const HEADER = 'x-v66g-user';

const ID = {
  owner: `${P}owner`, // OWNER of A, NY and BAD
  ownerB: `${P}ownerB`, // OWNER of B only
  staffNone: `${P}staffNone`, // STAFF of A { revenue: 'none', crm: 'read' }
  bizA: `${P}bizA`, // America/Port_of_Spain
  bizB: `${P}bizB`, // Asia/Kolkata
  bizNy: `${P}bizNy`, // America/New_York
  bizBad: `${P}bizBad`, // timezone 'Not/AZone'
  bizHav: `${P}bizHav`, // America/Havana
  bizAmm: `${P}bizAmm`, // Asia/Amman
  bizTor: `${P}bizTor`, // America/Toronto
};

const D = '2026-03-10';
const REVENUE_DENIED = 'Insufficient permissions: revenue requires read access (you have none)';

/** Business A's postings: label -> instant. Each posts two lines. */
const A_BEFORE = { 'before-day': '2026-03-09T23:59:59.999Z' };
const A_MIDNIGHT = {
  'midnight-1': '2026-03-10T00:00:00.000Z',
  'midnight-2': '2026-03-10T00:00:00.000Z',
  'midnight-3': '2026-03-10T00:00:00.000Z',
};
const A_DAY = {
  'local-start': '2026-03-10T04:00:00.000Z',
  morning: '2026-03-10T09:30:00.000Z',
  'noon-usd': '2026-03-10T13:00:00.000Z',
  afternoon: '2026-03-10T17:45:00.000Z',
  'utc-end': '2026-03-10T23:59:59.999Z',
  'local-end': '2026-03-11T03:59:59.999Z',
};
const A_AFTER = { 'next-local-day': '2026-03-11T04:00:00.000Z' };

let db: any;
let app: any;
let coa: any;
let posting: any;

async function cleanup() {
  for (const sql of [
    `DELETE FROM ledger_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM financial_transactions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM financial_accounts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM accounting_periods WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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

function ledger(biz: string, query: Record<string, string | number>, as: string = ID.owner) {
  return request(app.getHttpServer()).get(`/finance/businesses/${biz}/general-ledger`).query(query).set(HEADER, as);
}

/**
 * Records the ledger-line reads the route makes (PrismaService.client is this same `db`). A plain wrapper:
 * vi.spyOn on a Prisma delegate answers undefined and deletes the method on restore.
 */
function watch() {
  const delegate = db.ledgerEntry;
  const findMany = delegate.findMany;
  const queryRaw = db.$queryRaw;
  const queryRawUnsafe = db.$queryRawUnsafe;
  const groupBy = delegate.groupBy;
  const aggregate = delegate.aggregate;
  const seen = { findMany: [] as any[], raw: 0, sums: 0, restore: () => {} };
  delegate.findMany = (...a: any[]) => { seen.findMany.push(a[0]); return findMany.apply(delegate, a); };
  delegate.groupBy = (...a: any[]) => { seen.sums += 1; return groupBy.apply(delegate, a); };
  delegate.aggregate = (...a: any[]) => { seen.sums += 1; return aggregate.apply(delegate, a); };
  db.$queryRaw = (...a: any[]) => { seen.raw += 1; return queryRaw.apply(db, a); };
  db.$queryRawUnsafe = (...a: any[]) => { seen.raw += 1; return queryRawUnsafe.apply(db, a); };
  seen.restore = () => {
    delegate.findMany = findMany;
    delegate.groupBy = groupBy;
    delegate.aggregate = aggregate;
    db.$queryRaw = queryRaw;
    db.$queryRawUnsafe = queryRawUnsafe;
  };
  return seen;
}

/** The labels of the postings an answer carries, one per line, sorted. */
const labels = (body: any): string[] =>
  (body.rows ?? []).map((r: any) => String(r.description).replace(`${P}`, '')).sort();
/** Two lines per posting. */
const twice = (...groups: Array<Record<string, string>>): string[] =>
  groups.flatMap((g) => Object.keys(g)).flatMap((l) => [l, l]).sort();

let seq = 0;
async function post(biz: string, label: string, at: string, opts: { usd?: boolean } = {}) {
  seq += 1;
  const amount = 100 + seq;
  await posting.post({
    businessId: biz,
    type: 'ADJUSTMENT',
    date: new Date(at),
    amount,
    description: `${P}${label}`,
    // A posting in a currency the business does not keep must follow a source document (D-13).
    ...(opts.usd ? { currency: 'USD', sourceType: 'Invoice', sourceId: `${P}inv-${label}`, kind: 'v66g' } : {}),
    entries: [
      { accountId: (await coa.getBySystemKey(biz, 'OWNER_DRAWINGS')).id, debit: amount },
      { accountId: (await coa.getBySystemKey(biz, 'OWNER_EQUITY')).id, credit: amount },
    ],
  });
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
  const { ChartOfAccountsSeederService } = await import('../src/modules/finance/chart-of-accounts-seeder.service');
  const { PostingService } = await import('../src/modules/finance/posting.service');
  const { AccountingPeriodService } = await import('../src/modules/finance/accounting-period.service');

  // FinanceController's collaborators off the general-ledger route.
  const stubs = await Promise.all([
    import('../src/modules/finance/receivables.service').then((m) => m.ReceivablesService),
    import('../src/modules/finance/finance-overview.service').then((m) => m.FinanceOverviewService),
    import('../src/modules/finance/safe-to-spend.service').then((m) => m.SafeToSpendService),
    import('../src/modules/finance/cash-position.service').then((m) => m.CashPositionService),
    import('../src/modules/finance/financial-account-seeder.service').then((m) => m.FinancialAccountSeederService),
    import('../src/modules/finance/cashflow-forecast.service').then((m) => m.CashflowForecastService),
    import('../src/modules/finance/money-moves.service').then((m) => m.MoneyMovesService),
    import('../src/modules/finance/accountant-export.service').then((m) => m.AccountantExportService),
    import('../src/modules/finance/accountant-export-email.service').then((m) => m.AccountantExportEmailService),
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
      LedgerBalanceService,
      ChartOfAccountsSeederService,
      PostingService,
      AccountingPeriodService,
      ...stubs.map((token) => ({ provide: token, useValue: {} })),
    ],
  }).compile();
  coa = moduleRef.get(ChartOfAccountsSeederService);
  posting = moduleRef.get(PostingService);

  app = moduleRef.createNestApplication();
  attachIdentity(app);
  app.useGlobalInterceptors(new TenantInterceptor(moduleRef.get(PrismaService)));
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  await app.init();

  await cleanup(); // in case a prior run aborted

  for (const id of [ID.owner, ID.ownerB, ID.staffNone]) {
    await db.user.create({ data: { id, email: `${P}${id.slice(P.length)}@test.local`, name: id, role: 'USER' } });
  }
  for (const [id, ownerId, timezone] of [
    [ID.bizA, ID.owner, 'America/Port_of_Spain'],
    [ID.bizB, ID.ownerB, 'Asia/Kolkata'],
    [ID.bizNy, ID.owner, 'America/New_York'],
    [ID.bizBad, ID.owner, 'Not/AZone'],
    [ID.bizHav, ID.owner, 'America/Havana'],
    [ID.bizAmm, ID.owner, 'Asia/Amman'],
    [ID.bizTor, ID.owner, 'America/Toronto'],
  ] as const) {
    await db.business.create({
      data: { id, name: `V66G ${id.slice(P.length)}`, slug: id, ownerId, currency: 'TTD', timezone, accountingBasis: 'CASH' },
    });
    await db.membership.create({ data: { id: `${id}_own`, userId: ownerId, businessId: id, role: 'OWNER' } });
    await coa.ensureDefaults(id);
  }
  await db.membership.create({
    data: { id: `${ID.staffNone}_m`, userId: ID.staffNone, businessId: ID.bizA, role: 'STAFF', permissionScopes: { revenue: 'none', crm: 'read' } },
  });

  for (const group of [A_BEFORE, A_MIDNIGHT, A_DAY, A_AFTER]) {
    for (const [label, at] of Object.entries(group)) await post(ID.bizA, label, at, { usd: label === 'noon-usd' });
  }
  // B, Asia/Kolkata (UTC+5:30): local day D ends at D 18:30Z.
  await post(ID.bizB, 'kolkata-last', '2026-03-10T18:29:59.999Z');
  await post(ID.bizB, 'kolkata-next-day', '2026-03-10T18:30:00.000Z');
  // New York, 2026-03-08 (clocks go forward at 02:00): the day starts 05:00Z (EST) and ends 04:00Z (EDT).
  await post(ID.bizNy, 'ny-last', '2026-03-09T03:59:59.999Z');
  await post(ID.bizNy, 'ny-next-day', '2026-03-09T04:00:00.000Z');
  // A stored timezone that is no zone: the platform default (America/Port_of_Spain) is used.
  await post(ID.bizBad, 'bad-noon', '2026-03-10T12:00:00.000Z');
  await post(ID.bizBad, 'bad-last', '2026-03-11T03:59:59.999Z');
  await post(ID.bizBad, 'bad-next-day', '2026-03-11T04:00:00.000Z');
  // Havana, 2026-03-07: the clocks go forward at 00:00 on the 8th (00:00 -> 01:00), so the 7th ends 05:00Z.
  await post(ID.bizHav, 'havana-last', '2026-03-08T04:59:59.999Z');
  await post(ID.bizHav, 'havana-next-day', '2026-03-08T05:00:00.000Z');
  // Amman, 2019-10-24: the clocks go back at 01:00 on the 25th (to 00:00), so the 25th starts at the first 00:00, 21:00Z.
  await post(ID.bizAmm, 'amman-last', '2019-10-24T20:59:59.999Z');
  await post(ID.bizAmm, 'amman-next-day', '2019-10-24T21:00:00.000Z');
  // Toronto, 1919-03-30: 23:30 jumped to 00:30 (no instant reads 00:00 on the 31st), so the 30th ends 04:30Z.
  await post(ID.bizTor, 'toronto-last', '1919-03-31T04:29:59.999Z');
  await post(ID.bizTor, 'toronto-next-day', '1919-03-31T04:30:00.000Z');
}, 120_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
}, 60_000);

describe('V1-66 SWP-FIN-LEDGER: the General Ledger end date covers its whole day', () => {
  it('GLD-01: from=D&to=D answers the 12 lines of the business day (FU-LEDGER-ZONED-FROM: D-1 20:00 local midnight UTC excluded)', async () => {
    const res = await ledger(ID.bizA, { from: D, to: D });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(12);
    expect(res.body.rows).toHaveLength(12);
    expect(labels(res.body)).toEqual(twice(A_DAY));
  });

  it('GLD-02: to=D alone answers everything up to the end of the business day, and nothing of the next', async () => {
    const res = await ledger(ID.bizA, { to: D });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(20);
    expect(labels(res.body)).toEqual(twice(A_BEFORE, A_MIDNIGHT, A_DAY));
    expect(labels(res.body)).not.toContain('next-local-day');
  });

  it('GLD-03: a timestamp end keeps <= and is not widened to a day', async () => {
    const UTC_MIDNIGHT = '2026-03-10T00:00:00.000Z';
    // The line dated exactly the end instant is in; later lines are out.
    const atNoon = await ledger(ID.bizA, { from: UTC_MIDNIGHT, to: '2026-03-10T13:00:00.000Z' });
    expect(atNoon.status).toBe(200);
    expect(labels(atNoon.body)).toEqual(twice(A_MIDNIGHT, { 'local-start': '', morning: '', 'noon-usd': '' }));

    const justBeforeNoon = await ledger(ID.bizA, { from: UTC_MIDNIGHT, to: '2026-03-10T12:59:59.999Z' });
    expect(labels(justBeforeNoon.body)).toEqual(twice(A_MIDNIGHT, { 'local-start': '', morning: '' }));

    // Midnight written as a timestamp means midnight.
    const midnight = await ledger(ID.bizA, { from: UTC_MIDNIGHT, to: '2026-03-10T00:00:00.000Z' });
    expect(midnight.status).toBe(200);
    expect(midnight.body.total).toBe(6);
    expect(labels(midnight.body)).toEqual(twice(A_MIDNIGHT));

    // An offset timestamp is the instant it names: 09:30 at UTC-4 is 13:30Z.
    const offset = await ledger(ID.bizA, { from: UTC_MIDNIGHT, to: '2026-03-10T09:30:00-04:00' });
    expect(offset.status).toBe(200);
    expect(labels(offset.body)).toEqual(twice(A_MIDNIGHT, { 'local-start': '', morning: '', 'noon-usd': '' }));
  });

  it('GLD-04: pageSize is honoured across the whole business day', async () => {
    const seen = new Set<string>();
    const sizes: number[] = [];
    for (const page of [1, 2, 3]) {
      const res = await ledger(ID.bizA, { from: D, to: D, pageSize: 5, page });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ total: 12, page, pageSize: 5 });
      sizes.push(res.body.rows.length);
      for (const row of res.body.rows) seen.add(row.entryId);
    }
    expect(sizes).toEqual([5, 5, 2]);
    expect(seen.size).toBe(12);

    // No pageSize: the default page (100) holds the day.
    const whole = await ledger(ID.bizA, { from: D, to: D });
    expect(whole.body).toMatchObject({ total: 12, page: 1, pageSize: 100 });
    // `limit` is not a parameter of this route: it does not page.
    const limited = await ledger(ID.bizA, { from: D, to: D, limit: 5 });
    expect(limited.body.rows).toHaveLength(12);
    expect(limited.body.pageSize).toBe(100);
  });

  it("GLD-05: the day is the business's own day, daylight saving included", async () => {
    const kolkata = await ledger(ID.bizB, { to: D }, ID.ownerB);
    expect(kolkata.status).toBe(200);
    expect(labels(kolkata.body)).toEqual(twice({ 'kolkata-last': '' }));

    const newYork = await ledger(ID.bizNy, { to: '2026-03-08' });
    expect(newYork.status).toBe(200);
    expect(labels(newYork.body)).toEqual(twice({ 'ny-last': '' }));
    // The day after holds the rest.
    const newYorkNext = await ledger(ID.bizNy, { to: '2026-03-09' });
    expect(labels(newYorkNext.body)).toEqual(twice({ 'ny-last': '', 'ny-next-day': '' }));
  });

  it('GLD-06: an end date that is not on the calendar is refused', async () => {
    for (const to of ['2026-02-31', '2026-13-01', '2026-00-10', 'not-a-date']) {
      const res = await ledger(ID.bizA, { to });
      expect(res.status, to).toBe(400);
      expect(JSON.stringify(res.body), to).toContain('Invalid to date');
      expect(res.body.rows, to).toBeUndefined();
    }
    // A leap day is on the calendar.
    const leap = await ledger(ID.bizA, { to: '2024-02-29' });
    expect(leap.status).toBe(200);
    expect(leap.body.total).toBe(0);
  });

  it('GLD-07: a stored timezone that is no zone falls back to the platform default, it does not fail', async () => {
    const res = await ledger(ID.bizBad, { from: D, to: D });
    expect(res.status).toBe(200);
    expect(labels(res.body)).toEqual(twice({ 'bad-noon': '', 'bad-last': '' }));
  });

  it('GLD-08: every line says its own currency', async () => {
    const res = await ledger(ID.bizA, { from: D, to: D });
    expect(res.status).toBe(200);
    const byLabel = new Map<string, Set<string>>();
    for (const row of res.body.rows) {
      const label = String(row.description).replace(P, '');
      byLabel.set(label, (byLabel.get(label) ?? new Set()).add(row.currency));
    }
    expect([...(byLabel.get('noon-usd') ?? [])]).toEqual(['USD']);
    for (const [label, currencies] of byLabel) {
      if (label !== 'noon-usd') expect([...currencies], label).toEqual(['TTD']);
    }
  });

  it('GLD-10: a day whose next local midnight does not exist keeps its last hour', async () => {
    const res = await ledger(ID.bizHav, { to: '2026-03-07' });
    expect(res.status).toBe(200);
    expect(labels(res.body)).toEqual(twice({ 'havana-last': '' }));
    const next = await ledger(ID.bizHav, { to: '2026-03-08' });
    expect(labels(next.body)).toEqual(twice({ 'havana-last': '', 'havana-next-day': '' }));
  });

  it('GLD-11: the last day a timestamp can hold is answered, not failed', async () => {
    const res = await ledger(ID.bizA, { to: '9999-12-31' });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(22);
  });

  it('GLD-12: a day whose next local midnight comes twice ends at the first', async () => {
    const res = await ledger(ID.bizAmm, { to: '2019-10-24' });
    expect(res.status).toBe(200);
    expect(labels(res.body)).toEqual(twice({ 'amman-last': '' }));
  });

  it('GLD-13: the running balance is per account and currency', async () => {
    const res = await ledger(ID.bizA, { to: '2026-12-31' });
    expect(res.status).toBe(200);
    const rows: any[] = res.body.rows;
    expect(rows).toHaveLength(22);
    // Recomputed here from the lines as answered, in their order.
    const running = new Map<string, number>();
    for (const row of rows) {
      const key = `${row.accountId}:${row.currency}`;
      const next = Math.round(((running.get(key) ?? 0) + Number(row.debit) - Number(row.credit)) * 100) / 100;
      running.set(key, next);
      expect(Number(row.runningBalance), `${row.description} ${row.accountName}`).toBe(next);
    }
    const usd = rows.filter((r) => r.currency === 'USD');
    expect(usd).toHaveLength(2);
    // The one USD posting: its balances are its own debit and credit.
    expect(usd.map((r) => Math.abs(Number(r.runningBalance)))).toEqual([Number(usd[0].debit) + Number(usd[0].credit), Number(usd[1].debit) + Number(usd[1].credit)]);
  });

  it('GLD-14: a skipped stretch that straddles midnight ends the day at the jump', async () => {
    const res = await ledger(ID.bizTor, { to: '1919-03-30' });
    expect(res.status).toBe(200);
    expect(labels(res.body)).toEqual(twice({ 'toronto-last': '' }));
  });

  it('GLD-15: the order is total: date, then creation time, then id', async () => {
    const res = await ledger(ID.bizA, { to: '2026-12-31' });
    const rows: any[] = res.body.rows;
    expect(rows).toHaveLength(22);
    const created: Array<{ id: string; created_at: Date }> = await db.$queryRawUnsafe(
      `SELECT id, created_at FROM ledger_entries WHERE business_id = $1`, ID.bizA,
    );
    const createdAt = new Map(created.map((r) => [r.id, new Date(r.created_at).getTime()]));
    const expected = [...rows].sort((a, b) =>
      new Date(a.date).getTime() - new Date(b.date).getTime()
      || createdAt.get(a.entryId)! - createdAt.get(b.entryId)!
      || (a.entryId < b.entryId ? -1 : a.entryId > b.entryId ? 1 : 0));
    expect(rows.map((r) => r.entryId)).toEqual(expected.map((r) => r.entryId));
    // The same order page by page: one line a page, nothing repeated, nothing dropped.
    const paged: string[] = [];
    for (let page = 1; page <= 22; page += 1) {
      const one = await ledger(ID.bizA, { to: '2026-12-31', pageSize: 1, page });
      expect(one.body.rows).toHaveLength(1);
      paged.push(one.body.rows[0].entryId);
    }
    expect(paged).toEqual(expected.map((r) => r.entryId));
  });

  it('GLD-16: a later page carries the running balance on from the pages before it', async () => {
    for (const range of [{ to: '2026-12-31' }, { from: D, to: D }]) {
      const whole = await ledger(ID.bizA, range);
      expect(whole.status).toBe(200);
      const expected = new Map<string, string>(whole.body.rows.map((r: any) => [r.entryId, String(r.runningBalance)]));
      const total: number = whole.body.total;
      expect(total).toBeGreaterThan(10);
      const seen: string[] = [];
      for (let page = 1; (page - 1) * 5 < total; page += 1) {
        const res = await ledger(ID.bizA, { ...range, pageSize: 5, page });
        expect(res.status).toBe(200);
        for (const row of res.body.rows) {
          seen.push(row.entryId);
          expect(String(row.runningBalance), `${JSON.stringify(range)} page ${page} ${row.description} ${row.accountName}`)
            .toBe(expected.get(row.entryId));
        }
      }
      expect(seen).toEqual(whole.body.rows.map((r: any) => r.entryId));
    }
  });

  it('GLD-17: a page past the end answers no rows, the total, and reads no opening balance', async () => {
    const reads = watch();
    try {
      const res = await ledger(ID.bizA, { to: '2026-12-31', pageSize: 5, page: 1000 });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ rows: [], total: 22, page: 1000, pageSize: 5 });
      // The page read only: no line is read, and nothing is summed, to seed a balance no row shows.
      expect(reads.findMany).toHaveLength(1);
      expect(reads.sums).toBe(0);
      expect(reads.raw).toBe(0);
    } finally {
      reads.restore();
    }
  });

  it('GLD-18: a later page seeds its balance in the database, not by loading the earlier lines', async () => {
    const reads = watch();
    try {
      const res = await ledger(ID.bizA, { to: '2026-12-31', pageSize: 5, page: 4 });
      expect(res.status).toBe(200);
      expect(res.body.rows).toHaveLength(5);
      const takes = reads.findMany.map((a: any) => a?.take);
      // The page read only; the opening sums are one grouped read in the database.
      expect(reads.findMany).toHaveLength(1);
      expect(reads.sums).toBe(1);
      expect(reads.raw).toBe(0);
      expect(takes.every((t: unknown) => typeof t === 'number' && t <= 5), `ledgerEntry.findMany takes: ${JSON.stringify(takes)}`).toBe(true);
    } finally {
      reads.restore();
    }
  });

  it('GLD-09: tenancy and scope hold on the date-only read', async () => {
    // Another business's owner.
    const outsider = await ledger(ID.bizA, { from: D, to: D }, ID.ownerB);
    expect(outsider.status).toBe(403);
    expect(outsider.body.rows).toBeUndefined();
    expect(JSON.stringify(outsider.body)).not.toContain(P + 'morning');
    const outsiderOther = await ledger(ID.bizB, { to: D }, ID.owner);
    expect(outsiderOther.status).toBe(403);
    expect(outsiderOther.body.rows).toBeUndefined();

    // A member whose revenue scope is none.
    const none = await ledger(ID.bizA, { from: D, to: D }, ID.staffNone);
    expect(none.status).toBe(403);
    expect(JSON.stringify(none.body)).toContain(REVENUE_DENIED);
    expect(none.body.rows).toBeUndefined();

    // No identity.
    const anonymous = await request(app.getHttpServer()).get(`/finance/businesses/${ID.bizA}/general-ledger`).query({ from: D, to: D });
    expect([401, 403]).toContain(anonymous.status);
    expect(anonymous.body.rows).toBeUndefined();

    // A's own answer holds A's lines only.
    const own = await ledger(ID.bizA, { to: '2026-12-31' });
    expect(own.status).toBe(200);
    expect(own.body.total).toBe(22);
    for (const row of own.body.rows) expect(String(row.description)).not.toMatch(/kolkata|ny-|bad-|havana|amman|toronto/);
  });
});
