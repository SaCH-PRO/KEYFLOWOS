/**
 * FU-LEDGER-ZONED-FROM (server half, P2 launch-track, Journey H):
 * Real-Postgres + real-HTTP integration proof for GET /finance/businesses/:businessId/general-ledger:
 *
 *   GLZF-01: Date-only `from=D&to=D` starts at local 00:00 in Business.timezone (Port of Spain = 04:00Z),
 *            so D-1 20:00 local (D 00:00Z) and D-1 23:59:59.999 local (D 03:59:59.999Z) are excluded from D
 *            and included in D-1 (zero overlap between adjacent single-day queries).
 *   GLZF-02: Business-zone & DST handling for date-only `from` (Asia/Kolkata UTC+5:30, America/Havana
 *            spring-forward midnight jump, Asia/Amman repeated midnight), while timestamp `from` keeps >=.
 *   GLZF-03: Invalid calendar date-only `from` (2026-02-31, 2026-13-01, 2026-00-10), repeated `from`/`to`,
 *            and out-of-range timestamps (+100000 / -000001) return 400 (never 200 or 500).
 *   GLZF-04: Huge/non-positive/non-integer/repeated `page`, invalid/huge/repeated `pageSize`, and
 *            repeated `accountId` return 400 (never 500).
 *   GLZF-05: Tenancy and revenue:read scope hold on date-only `from` queries.
 *
 * Fixture prefix: `v92r_` (registered in `fixture-prefixes.json`).
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });
vi.setConfig({ testTimeout: 30_000 });

const P = 'v92r_';
const HEADER = 'x-v92r-user';

const ID = {
  owner: `${P}owner`,
  ownerB: `${P}ownerB`,
  staffNone: `${P}staffNone`,
  bizPos: `${P}bizPos`, // America/Port_of_Spain (UTC-4)
  bizIst: `${P}bizIst`, // Asia/Kolkata (UTC+5:30)
  bizHav: `${P}bizHav`, // America/Havana (spring forward over midnight 2026-03-08)
  bizAmm: `${P}bizAmm`, // Asia/Amman (fall back over midnight 2019-10-25)
};

let db: any;
let app: any;
let coa: any;
let posting: any;
let cashPosId: string;
let cashIstId: string;

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
    try {
      await db.$executeRawUnsafe(sql);
    } catch {
      /* best-effort */
    }
  }
}

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

function ledger(biz: string, qs: string | Record<string, unknown>, as = ID.owner) {
  const url =
    typeof qs === 'string'
      ? `/finance/businesses/${biz}/general-ledger?${qs}`
      : `/finance/businesses/${biz}/general-ledger`;
  const req = request(app.getHttpServer()).get(url).set(HEADER, as);
  return typeof qs === 'string' ? req : req.query(qs);
}

const labels = (body: any): string[] =>
  Array.from(new Set((body?.rows ?? []).map((r: any) => String(r.description).replace(P, ''))));

async function postAt(
  businessId: string,
  cashId: string,
  revId: string,
  label: string,
  iso: string,
  amount = 100,
) {
  await posting.post({
    businessId,
    type: 'ADJUSTMENT',
    date: new Date(iso),
    amount,
    description: `${P}${label}`,
    entries: [
      { accountId: cashId, debit: amount },
      { accountId: revId, credit: amount },
    ],
  });
}

async function seedBiz(businessId: string, ownerId: string, timezone: string) {
  await db.business.create({
    data: { id: businessId, name: `${P}${businessId}`, slug: `${businessId}-slug`, ownerId, currency: 'TTD', timezone },
  });
  await db.membership.create({
    data: { id: `${P}m_${businessId}_${ownerId}`, businessId, userId: ownerId, role: 'OWNER' },
  });
  await coa.ensureDefaults(businessId);
  const cash = await coa.getBySystemKey(businessId, 'OWNER_DRAWINGS');
  const rev = await coa.getBySystemKey(businessId, 'OWNER_EQUITY');
  return { cashId: cash.id as string, revId: rev.id as string };
}

beforeAll(async () => {
  const { Test } = await import('@nestjs/testing');
  const { db: client } = await import('@keyflow/db');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { TenantInterceptor } = await import('../src/core/tenant/tenant.interceptor');
  const { FinanceController } = await import('../src/modules/finance/finance.controller');
  const { LedgerBalanceService } = await import('../src/modules/finance/ledger-balance.service');
  const { PostingService } = await import('../src/modules/finance/posting.service');
  const { AccountingPeriodService } = await import('../src/modules/finance/accounting-period.service');
  const { ChartOfAccountsSeederService } = await import('../src/modules/finance/chart-of-accounts-seeder.service');

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

  db = client;
  await cleanup();

  const moduleRef = await Test.createTestingModule({
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
      ...stubs.map((provide) => ({ provide, useValue: {} })),
    ],
  }).compile();

  coa = moduleRef.get(ChartOfAccountsSeederService);
  posting = moduleRef.get(PostingService);

  app = moduleRef.createNestApplication();
  attachIdentity(app);
  app.useGlobalInterceptors(new TenantInterceptor(moduleRef.get(PrismaService)));
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  await app.init();

  await db.user.createMany({
    data: [
      { id: ID.owner, email: `${P}owner@test.local`, name: 'v92r Owner', role: 'USER' },
      { id: ID.ownerB, email: `${P}ownerb@test.local`, name: 'v92r OwnerB', role: 'USER' },
      { id: ID.staffNone, email: `${P}staff@test.local`, name: 'v92r StaffNone', role: 'USER' },
    ],
  });

  const pos = await seedBiz(ID.bizPos, ID.owner, 'America/Port_of_Spain');
  cashPosId = pos.cashId;
  await db.membership.create({
    data: {
      id: `${P}m_staff_none`,
      businessId: ID.bizPos,
      userId: ID.staffNone,
      role: 'STAFF',
      permissionScopes: { revenue: 'none', crm: 'read' },
    },
  });
  // Port of Spain (UTC-4):
  //   2026-03-09 local = [2026-03-09T04:00:00.000Z, 2026-03-10T04:00:00.000Z)
  //   2026-03-10 local = [2026-03-10T04:00:00.000Z, 2026-03-11T04:00:00.000Z)
  await postAt(ID.bizPos, pos.cashId, pos.revId, 'd1-morning', '2026-03-09T14:00:00.000Z');
  await postAt(ID.bizPos, pos.cashId, pos.revId, 'd1-evening-utc-midnight', '2026-03-10T00:00:00.000Z');
  await postAt(ID.bizPos, pos.cashId, pos.revId, 'd1-last-ms', '2026-03-10T03:59:59.999Z');
  await postAt(ID.bizPos, pos.cashId, pos.revId, 'd2-first-ms', '2026-03-10T04:00:00.000Z');
  await postAt(ID.bizPos, pos.cashId, pos.revId, 'd2-noon', '2026-03-10T16:00:00.000Z');
  await postAt(ID.bizPos, pos.cashId, pos.revId, 'd2-last-ms', '2026-03-11T03:59:59.999Z');

  // Asia/Kolkata (UTC+5:30): 2026-03-10 starts at 2026-03-09T18:30:00.000Z.
  const ist = await seedBiz(ID.bizIst, ID.ownerB, 'Asia/Kolkata');
  cashIstId = ist.cashId;
  await postAt(ID.bizIst, ist.cashId, ist.revId, 'ist-before', '2026-03-09T18:29:59.999Z');
  await postAt(ID.bizIst, ist.cashId, ist.revId, 'ist-start', '2026-03-09T18:30:00.000Z');
  await postAt(ID.bizIst, ist.cashId, ist.revId, 'ist-midday', '2026-03-10T06:00:00.000Z');

  // America/Havana: clocks jump forward at 00:00 on 2026-03-08 -> 2026-03-08 starts at 05:00Z.
  const hav = await seedBiz(ID.bizHav, ID.owner, 'America/Havana');
  await postAt(ID.bizHav, hav.cashId, hav.revId, 'hav-before', '2026-03-08T04:59:59.999Z');
  await postAt(ID.bizHav, hav.cashId, hav.revId, 'hav-start', '2026-03-08T05:00:00.000Z');

  // Asia/Amman: clocks fall back at 01:00 on 2019-10-25 -> first 00:00 is 2019-10-24T21:00:00.000Z.
  const amm = await seedBiz(ID.bizAmm, ID.owner, 'Asia/Amman');
  await postAt(ID.bizAmm, amm.cashId, amm.revId, 'amm-before', '2019-10-24T20:59:59.999Z');
  await postAt(ID.bizAmm, amm.cashId, amm.revId, 'amm-start', '2019-10-24T21:00:00.000Z');
}, 60_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
});

describe('FU-LEDGER-ZONED-FROM (server half, Journey H)', () => {
  it('[GLZF-01] RED-BEFORE: date-only from=D&to=D uses Business.timezone start of day so adjacent days never overlap', async () => {
    const day1 = await ledger(ID.bizPos, { from: '2026-03-09', to: '2026-03-09' });
    expect(day1.status).toBe(200);
    expect(labels(day1.body)).toEqual(['d1-morning', 'd1-evening-utc-midnight', 'd1-last-ms']);

    const day2 = await ledger(ID.bizPos, { from: '2026-03-10', to: '2026-03-10' });
    expect(day2.status).toBe(200);
    expect(labels(day2.body)).toEqual(['d2-first-ms', 'd2-noon', 'd2-last-ms']);

    // Zero overlap between adjacent single-day queries.
    const day1Ids = new Set(day1.body.rows.map((r: any) => r.entryId));
    for (const row of day2.body.rows) {
      expect(day1Ids.has(row.entryId)).toBe(false);
    }

    // from=D alone (without `to`) also starts at D 00:00 local (04:00Z).
    const fromOnly = await ledger(ID.bizPos, { from: '2026-03-10' });
    expect(fromOnly.status).toBe(200);
    expect(labels(fromOnly.body)).toEqual(['d2-first-ms', 'd2-noon', 'd2-last-ms']);
  });

  it('[GLZF-02] RED-BEFORE: date-only from respects UTC+ zones and DST transitions, while timestamp from keeps >= exact instant', async () => {
    const ist = await ledger(ID.bizIst, { from: '2026-03-10', to: '2026-03-10' }, ID.ownerB);
    expect(ist.status).toBe(200);
    expect(labels(ist.body)).toEqual(['ist-start', 'ist-midday']);

    const hav = await ledger(ID.bizHav, { from: '2026-03-08', to: '2026-03-08' });
    expect(hav.status).toBe(200);
    expect(labels(hav.body)).toEqual(['hav-start']);

    const amm = await ledger(ID.bizAmm, { from: '2019-10-25', to: '2019-10-25' });
    expect(amm.status).toBe(200);
    expect(labels(amm.body)).toEqual(['amm-start']);

    // Timestamp `from` is NOT widened or shifted to local midnight: exact >= instant.
    const tsFrom = await ledger(ID.bizPos, { from: '2026-03-10T00:00:00.000Z', to: '2026-03-10' });
    expect(tsFrom.status).toBe(200);
    expect(labels(tsFrom.body)).toEqual(['d1-evening-utc-midnight', 'd1-last-ms', 'd2-first-ms', 'd2-noon', 'd2-last-ms']);
  });

  it('[GLZF-03] RED-BEFORE: impossible calendar dates, year-0000 dates, empty strings, repeated from/to params, and out-of-range timestamps return 400 (never 200 or 500)', async () => {
    for (const badFrom of [
      '',
      '0000-01-01',
      '0000-12-31',
      '2026-02-31',
      '2026-13-01',
      '2026-00-10',
      'not-a-date',
      '+100000-01-01T00:00:00.000Z',
      '-000001-01-01T00:00:00.000Z',
    ]) {
      const res = await ledger(ID.bizPos, { from: badFrom });
      expect(res.status, `from=${badFrom}: ${JSON.stringify(res.body)}`).toBe(400);
      expect(res.body.rows).toBeUndefined();
    }

    for (const badTo of [
      '',
      '0000-01-01',
      '0000-12-31',
      '+100000-01-01T00:00:00.000Z',
      '-000001-01-01T00:00:00.000Z',
    ]) {
      const res = await ledger(ID.bizPos, { to: badTo });
      expect(res.status, `to=${badTo}: ${JSON.stringify(res.body)}`).toBe(400);
      expect(res.body.rows).toBeUndefined();
    }

    const repFrom = await ledger(ID.bizPos, 'from=2026-03-09&from=2026-03-10');
    expect(repFrom.status, JSON.stringify(repFrom.body)).toBe(400);

    const repTo = await ledger(ID.bizPos, 'to=2026-03-09&to=2026-03-10');
    expect(repTo.status, JSON.stringify(repTo.body)).toBe(400);

    // Valid leap day accepted.
    const leap = await ledger(ID.bizPos, { from: '2024-02-29', to: '2024-02-29' });
    expect(leap.status).toBe(200);
    expect(leap.body.total).toBe(0);
  });

  it('[GLZF-04] RED-BEFORE: huge/invalid/empty/repeated page, pageSize, and accountId return 400 (never 500)', async () => {
    for (const qs of [
      'page=',
      'page=999999999999',
      'page=10001',
      'page=0',
      'page=-1',
      'page=1.5',
      'page=12abc',
      'page=1&page=2',
      'pageSize=',
      'pageSize=0',
      'pageSize=-5',
      'pageSize=501',
      'pageSize=999999999',
      'pageSize=10abc',
      'pageSize=10&pageSize=20',
      'accountId=',
      `accountId=${cashPosId}&accountId=${cashPosId}`,
    ]) {
      const res = await ledger(ID.bizPos, qs);
      expect(res.status, `${qs}: ${JSON.stringify(res.body)}`).toBe(400);
      expect(res.body.rows).toBeUndefined();
    }

    // Valid accountId + valid page/pageSize still work.
    const ok = await ledger(ID.bizPos, { from: '2026-03-10', to: '2026-03-10', accountId: cashPosId, page: '1', pageSize: '50' });
    expect(ok.status).toBe(200);
    expect(ok.body.rows).toHaveLength(3);
    expect(ok.body.rows.every((r: any) => r.accountId === cashPosId)).toBe(true);
  });

  it('[GLZF-05] tenancy, cross-tenant accountId isolation, and revenue:read scope hold on zoned from queries', async () => {
    const outsider = await ledger(ID.bizPos, { from: '2026-03-10', to: '2026-03-10' }, ID.ownerB);
    expect(outsider.status).toBe(403);
    expect(outsider.body.rows).toBeUndefined();

    const denied = await ledger(ID.bizPos, { from: '2026-03-10', to: '2026-03-10' }, ID.staffNone);
    expect(denied.status).toBe(403);
    expect(denied.body.rows).toBeUndefined();

    // Cross-tenant accountId returns 200 with 0 rows and no leak.
    const crossAccount = await ledger(ID.bizPos, { from: '2026-03-10', to: '2026-03-10', accountId: cashIstId });
    expect(crossAccount.status).toBe(200);
    expect(crossAccount.body.rows).toEqual([]);
    expect(crossAccount.body.total).toBe(0);
  });
});
