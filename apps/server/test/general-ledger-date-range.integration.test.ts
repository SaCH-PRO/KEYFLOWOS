/**
 * V1-66 SWP-FIN-LEDGER (BUG-029). REAL database, through the HTTP route.
 *
 * GET /finance/businesses/:businessId/general-ledger?to=D parsed a date-only end date as midnight UTC and
 * filtered `date <= midnight`, so every line later in day D was dropped: picking one day on the General
 * Ledger page (from=D&to=D) answered only the lines dated exactly midnight. The controller turned `to` into
 * a Date before the service saw it, so the service could not tell a date-only value from a timestamp.
 *
 * Packet rule: a date-only `to` (YYYY-MM-DD) covers the whole of that day in the business's timezone
 * (Business.timezone); a `to` that is a timestamp keeps `<=`. `from` is unchanged (midnight UTC, `>=`).
 *
 * Business A keeps America/Port_of_Spain (UTC-4, no daylight saving). On D = 2026-03-10 it holds 9 postings
 * (18 lines): 3 dated midnight UTC (the 6 lines the old filter answered) and 6 through the day, the last at
 * 23:59:59.999 local (D+1 03:59:59.999Z). One posting sits just before D (D-1 23:59:59.999Z) and one at the
 * first instant of the next local day (D+1 04:00:00.000Z).
 *
 *   GLD-01  RED-BEFORE  from=D&to=D answers the day's 18 lines (it answered 6), total 18
 *   GLD-02  RED-BEFORE  to=D alone answers everything up to the end of local day D, and not the next day's line
 *   GLD-03  KEEP        a timestamp `to` keeps `<=`: the line dated exactly `to` is in, later lines are out;
 *                       midnight written as a timestamp is not widened to the day; an offset timestamp is read
 *                       as the instant it names
 *   GLD-04  RED-BEFORE  pageSize is honoured over the whole day: 5 a page, 4 pages, 18 distinct lines, total 18
 *                       (it paged the 6 lines); `limit` is not a parameter of this route
 *   GLD-05  RED-BEFORE  the day is the BUSINESS's day: Asia/Kolkata (UTC+5:30) ends D at D 18:30Z; New York on
 *                       the day the clocks go forward (2026-03-08, a 23-hour day) ends it at 04:00Z, not 05:00Z
 *   GLD-06  RED-BEFORE  a date that is not on the calendar (2026-02-31) is refused 400 'Invalid to date' (it
 *                       was read as 3 March); words that are no date keep their 400
 *   GLD-07  RED-BEFORE  a business whose stored timezone is not a zone still answers (the platform default
 *                       zone, America/Port_of_Spain), it does not fail
 *   GLD-08  RED-BEFORE  every line says its own currency (a TTD business's USD line says USD)
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
}, 120_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
}, 60_000);

describe('V1-66 SWP-FIN-LEDGER: the General Ledger end date covers its whole day', () => {
  it('GLD-01: from=D&to=D answers the 18 lines of the day', async () => {
    const res = await ledger(ID.bizA, { from: D, to: D });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(18);
    expect(res.body.rows).toHaveLength(18);
    expect(labels(res.body)).toEqual(twice(A_MIDNIGHT, A_DAY));
  });

  it('GLD-02: to=D alone answers everything up to the end of the business day, and nothing of the next', async () => {
    const res = await ledger(ID.bizA, { to: D });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(20);
    expect(labels(res.body)).toEqual(twice(A_BEFORE, A_MIDNIGHT, A_DAY));
    expect(labels(res.body)).not.toContain('next-local-day');
  });

  it('GLD-03: a timestamp end keeps <= and is not widened to a day', async () => {
    // The line dated exactly the end instant is in; later lines are out.
    const atNoon = await ledger(ID.bizA, { from: D, to: '2026-03-10T13:00:00.000Z' });
    expect(atNoon.status).toBe(200);
    expect(labels(atNoon.body)).toEqual(twice(A_MIDNIGHT, { 'local-start': '', morning: '', 'noon-usd': '' }));

    const justBeforeNoon = await ledger(ID.bizA, { from: D, to: '2026-03-10T12:59:59.999Z' });
    expect(labels(justBeforeNoon.body)).toEqual(twice(A_MIDNIGHT, { 'local-start': '', morning: '' }));

    // Midnight written as a timestamp means midnight.
    const midnight = await ledger(ID.bizA, { from: D, to: '2026-03-10T00:00:00.000Z' });
    expect(midnight.status).toBe(200);
    expect(midnight.body.total).toBe(6);
    expect(labels(midnight.body)).toEqual(twice(A_MIDNIGHT));

    // An offset timestamp is the instant it names: 09:30 at UTC-4 is 13:30Z.
    const offset = await ledger(ID.bizA, { from: D, to: '2026-03-10T09:30:00-04:00' });
    expect(offset.status).toBe(200);
    expect(labels(offset.body)).toEqual(twice(A_MIDNIGHT, { 'local-start': '', morning: '', 'noon-usd': '' }));
  });

  it('GLD-04: pageSize is honoured across the whole day', async () => {
    const seen = new Set<string>();
    const sizes: number[] = [];
    for (const page of [1, 2, 3, 4]) {
      const res = await ledger(ID.bizA, { from: D, to: D, pageSize: 5, page });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ total: 18, page, pageSize: 5 });
      sizes.push(res.body.rows.length);
      for (const row of res.body.rows) seen.add(row.entryId);
    }
    expect(sizes).toEqual([5, 5, 5, 3]);
    expect(seen.size).toBe(18);

    // No pageSize: the default page (100) holds the day.
    const whole = await ledger(ID.bizA, { from: D, to: D });
    expect(whole.body).toMatchObject({ total: 18, page: 1, pageSize: 100 });
    // `limit` is not a parameter of this route: it does not page.
    const limited = await ledger(ID.bizA, { from: D, to: D, limit: 5 });
    expect(limited.body.rows).toHaveLength(18);
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
    for (const row of own.body.rows) expect(String(row.description)).not.toMatch(/kolkata|ny-|bad-/);
  });
});
