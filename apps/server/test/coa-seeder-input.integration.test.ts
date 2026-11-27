/**
 * V1-91 FU-COA-SEEDER-AND-INPUT (P146, D-167): ChartOfAccountsSeederService respects active-code
 * uniqueness under the coa-code advisory lock, and FinanceCoaService validates update/create input types
 * (400 instead of 500). REAL Postgres database.
 *
 *   CSI-01  SANITY      fixture sanity: fresh businesses have expected pre-test charts
 *   CSI-02  RED-BEFORE  seeder skips colliding system codes held by active custom accounts (exact and
 *                       untrimmed-whitespace codes), keeps custom accounts intact, preserves systemKey
 *                       and parentId links with code=null, reports via Logger.warn, and re-seeds idempotently
 *   CSI-03  RED-BEFORE  partial seed (simulating a future SYSTEM_COA code added later) respects an active
 *                       custom holder, reports the collision via Logger.warn, and leaves other rows intact
 *   CSI-04  CONTROL     an inactive (archived) custom account frees its code under SWP-COA-UNIQUE-CODE:
 *                       seeder claims the code cleanly, re-seeding is idempotent, and reactivating the
 *                       archived custom account is refused 409 COA_CODE_TAKEN
 *   CSI-05  CONTROL     cross-tenant isolation: Biz A's colliding custom codes do not affect Biz B; under
 *                       a mismatched ALS tenant, seeding acts on the active tenant and leaves the other untouched
 *   CSI-06  CONCURRENCY concurrent ensureDefaults() and POST /chart-of-accounts on the same system code
 *                       serialize under the shared coa-code advisory lock and leave exactly 1 active holder
 *   CSI-07  RED-BEFORE  FinanceCoaService.update() with operator-object / non-string / empty / self parentId
 *                       returns 400 (never 500) and writes nothing
 *   CSI-08  RED-BEFORE  FinanceCoaService.update() (and create()) with non-string / empty name, non-string
 *                       subtype, non-string code, or non-boolean isActive returns 400 (never 500) and writes nothing
 *   CSI-09  CONTROL     valid update() succeeds cleanly (name, parentId, subtype, isActive, clearing parentId);
 *                       cross-tenant parentId is rejected 400 on both PATCH and POST
 *
 * Fixtures: prefix `v91p_` (registered in test/helpers/fixture-prefixes.json); hard-deleted by raw SQL
 * (sqlLikePrefix) in dependency order in beforeAll and afterAll; zero .deleteMany() calls.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { BadRequestException, Logger } from '@nestjs/common';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

vi.setConfig({ testTimeout: 30_000 });

const P = 'v91p_';
const HEADER = 'x-v91p-user';
const COA_CODE_WHITESPACE = ' \t\n\r\f\v';

const ID = {
  ownerA: `${P}ownerA`,
  ownerB: `${P}ownerB`,
  bizCollide: `${P}bizCollide`,
  bizPartial: `${P}bizPartial`,
  bizInactive: `${P}bizInactive`,
  bizCleanB: `${P}bizCleanB`,
  bizUpdate: `${P}bizUpdate`,
  bizRace: `${P}bizRace`,
  bizTenantA: `${P}bizTenantA`,
  bizTenantB: `${P}bizTenantB`,
};

let db: any;
let app: any;
let coaService: any;
let seeder: any;
let SYSTEM_COA: Array<{ systemKey: string; name: string; code?: string; parentSystemKey?: string }>;
let setTenantContextProvider: (p: { getCurrentBusinessId: () => string | undefined }) => void;
let runWithTenant: <T>(businessId: string, userId: string, fn: () => T) => T;

async function cleanup() {
  for (const sql of [
    `DELETE FROM expense_categories WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `UPDATE chart_of_accounts SET parent_id = NULL WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM chart_of_accounts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM team_activity_logs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
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

const http = () => request(app.getHttpServer());
const coaUrl = (biz: string, id?: string) => `/finance/businesses/${biz}/chart-of-accounts${id ? `/${id}` : ''}`;
const post = (biz: string, user: string, body: unknown) => http().post(coaUrl(biz)).set(HEADER, user).send(body as object);
const patch = (biz: string, user: string, id: string, body: unknown) =>
  http().patch(coaUrl(biz, id)).set(HEADER, user).send(body as object);

/** Full chart snapshot for a business as JSON text (raw SQL) to prove "nothing written". */
async function chart(biz: string): Promise<string> {
  const [row]: Array<{ j: string }> = await db.$queryRawUnsafe(
    `SELECT COALESCE(json_agg(t ORDER BY t.id), '[]'::json)::text AS j FROM chart_of_accounts t WHERE t.business_id = $1`,
    biz,
  );
  return row.j;
}

/** Active rows matching normalized code (raw SQL, matching FinanceCoaService). */
async function activeHoldersOfCode(
  biz: string,
  code: string,
): Promise<Array<{ id: string; name: string; code: string | null; is_system: boolean; is_active: boolean; system_key: string | null }>> {
  return db.$queryRawUnsafe(
    `SELECT id, name, code, is_system, is_active, system_key
     FROM chart_of_accounts
     WHERE business_id = $1
       AND is_active = true
       AND code IS NOT NULL
       AND lower(btrim(code, $2)) = lower($3)
     ORDER BY id`,
    biz,
    COA_CODE_WHITESPACE,
    code,
  );
}

/** Insert a custom chart_of_accounts row via raw SQL (simulating pre-existing custom rows before seeding). */
async function insertCustomRow(
  id: string,
  biz: string,
  code: string | null,
  name: string,
  isActive = true,
) {
  await db.$executeRawUnsafe(
    `INSERT INTO chart_of_accounts (id, business_id, code, name, type, is_system, is_active, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'EXPENSE', false, $5, now(), now())`,
    id,
    biz,
    code,
    name,
    isActive,
  );
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;
  const tenantMod = await import('../src/core/tenant/tenant-context');
  setTenantContextProvider = dbMod.setTenantContextProvider;
  runWithTenant = tenantMod.runWithTenant;
  setTenantContextProvider({ getCurrentBusinessId: tenantMod.getCurrentBusinessId });

  const { Test } = await import('@nestjs/testing');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { TenantInterceptor } = await import('../src/core/tenant/tenant.interceptor');
  const { CrmRateLimitGuard } = await import('../src/modules/crm/guards/rate-limit.guard');
  const { FinanceController } = await import('../src/modules/finance/finance.controller');
  const { FinanceCoaService } = await import('../src/modules/finance/finance-coa.service');
  const seederMod = await import('../src/modules/finance/chart-of-accounts-seeder.service');
  const { ChartOfAccountsSeederService } = seederMod;
  SYSTEM_COA = seederMod.SYSTEM_COA;

  const stubs = await Promise.all([
    import('../src/modules/finance/receivables.service').then((m) => m.ReceivablesService),
    import('../src/modules/finance/ledger-balance.service').then((m) => m.LedgerBalanceService),
    import('../src/modules/finance/finance-overview.service').then((m) => m.FinanceOverviewService),
    import('../src/modules/finance/finance-accounts.service').then((m) => m.FinanceAccountsService),
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
    import('../src/modules/finance/posting.service').then((m) => m.PostingService),
    import('../src/modules/finance/safe-to-spend.service').then((m) => m.SafeToSpendService),
    import('../src/modules/finance/cashflow-forecast.service').then((m) => m.CashflowForecastService),
    import('../src/modules/finance/money-moves.service').then((m) => m.MoneyMovesService),
    import('../src/modules/finance/cash-reserve.service').then((m) => m.CashReserveService),
    import('../src/modules/finance/credit-note.service').then((m) => m.CreditNoteService),
    import('../src/modules/finance/accounting-period.service').then((m) => m.AccountingPeriodService),
    import('../src/modules/finance/bank-connection.service').then((m) => m.BankConnectionService),
    import('../src/modules/finance/exchange-rate.service').then((m) => m.ExchangeRateService),
    import('../src/modules/finance/fixed-asset.service').then((m) => m.FixedAssetService),
  ]);

  const moduleRef = await Test.createTestingModule({
    controllers: [FinanceController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      CrmRateLimitGuard,
      FinanceCoaService,
      ChartOfAccountsSeederService,
      ...stubs.map((token) => ({ provide: token, useValue: {} })),
    ],
  }).compile();

  coaService = moduleRef.get(FinanceCoaService);
  seeder = moduleRef.get(ChartOfAccountsSeederService);

  app = moduleRef.createNestApplication();
  attachIdentity(app);
  app.useGlobalInterceptors(new TenantInterceptor(moduleRef.get(PrismaService)));
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  await app.init();

  await cleanup();

  for (const id of [ID.ownerA, ID.ownerB]) {
    await db.user.create({ data: { id, email: `${P}${id.slice(P.length)}@test.local`, name: id, role: 'USER' } });
  }
  const businesses: ReadonlyArray<readonly [string, string]> = [
    [ID.bizCollide, ID.ownerA],
    [ID.bizPartial, ID.ownerA],
    [ID.bizInactive, ID.ownerA],
    [ID.bizCleanB, ID.ownerB],
    [ID.bizUpdate, ID.ownerA],
    [ID.bizRace, ID.ownerA],
    [ID.bizTenantA, ID.ownerA],
    [ID.bizTenantB, ID.ownerB],
  ];
  for (const [id, ownerId] of businesses) {
    await db.business.create({ data: { id, name: `V91P ${id}`, slug: id, ownerId, currency: 'TTD' } });
    await db.membership.create({ data: { id: `${P}m_${id.slice(P.length)}`, userId: ownerId, businessId: id, role: 'OWNER' } });
  }

  await seeder.ensureDefaults(ID.bizUpdate);
}, 120_000);

afterAll(async () => {
  try {
    if (app) await app.close();
  } finally {
    if (db) await cleanup();
    if (setTenantContextProvider) setTenantContextProvider({ getCurrentBusinessId: () => undefined });
  }
}, 60_000);

describe('CSI-01: fixture sanity', () => {
  it('fresh businesses have empty charts and bizUpdate is seeded', async () => {
    for (const biz of [ID.bizCollide, ID.bizPartial, ID.bizInactive, ID.bizCleanB, ID.bizRace, ID.bizTenantA, ID.bizTenantB]) {
      expect(await db.chartOfAccount.count({ where: { businessId: biz } }), biz).toBe(0);
    }
    expect(await db.chartOfAccount.count({ where: { businessId: ID.bizUpdate } })).toBe(SYSTEM_COA.length);
  });
});

describe('CSI-02: seeder respects active-code uniqueness and reports skipped collisions', () => {
  it('CSI-02 RED-BEFORE: active custom accounts holding SYSTEM_COA codes (exact and untrimmed) are preserved with 1 active holder, system rows keep systemKey/parentId with code=null, and collision is reported via Logger.warn', async () => {
    const custom6100 = `${P}custom6100`;
    const custom6200 = `${P}custom6200`;
    await insertCustomRow(custom6100, ID.bizCollide, '6100', 'v91p Custom Marketing', true);
    await insertCustomRow(custom6200, ID.bizCollide, ' 6200\t', 'v91p Custom Software Untrimmed', true);

    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    try {
      await seeder.ensureDefaults(ID.bizCollide);

      // Exactly 1 active account holds 6100 and it is the untouched custom account.
      const holders6100 = await activeHoldersOfCode(ID.bizCollide, '6100');
      expect(holders6100).toHaveLength(1);
      expect(holders6100[0]).toMatchObject({
        id: custom6100,
        name: 'v91p Custom Marketing',
        code: '6100',
        is_system: false,
        is_active: true,
      });

      // Exactly 1 active account holds normalized 6200 (matching the untrimmed custom row).
      const holders6200 = await activeHoldersOfCode(ID.bizCollide, '6200');
      expect(holders6200).toHaveLength(1);
      expect(holders6200[0]).toMatchObject({
        id: custom6200,
        name: 'v91p Custom Software Untrimmed',
        code: ' 6200\t',
        is_system: false,
        is_active: true,
      });

      // System rows for EXPENSE_MARKETING and EXPENSE_SOFTWARE still exist by systemKey with code=null
      // and proper parentId so postings and category linking continue working without a duplicate code.
      const expenseGeneral = await db.chartOfAccount.findUnique({
        where: { businessId_systemKey: { businessId: ID.bizCollide, systemKey: 'EXPENSE_GENERAL' } },
      });
      expect(expenseGeneral).toBeTruthy();

      for (const sysKey of ['EXPENSE_MARKETING', 'EXPENSE_SOFTWARE']) {
        const sysRow = await db.chartOfAccount.findUnique({
          where: { businessId_systemKey: { businessId: ID.bizCollide, systemKey: sysKey } },
        });
        expect(sysRow, sysKey).toBeTruthy();
        expect(sysRow.isSystem).toBe(true);
        expect(sysRow.isActive).toBe(true);
        expect(sysRow.code).toBeNull();
        expect(sysRow.parentId).toBe(expenseGeneral.id);
      }

      // Non-colliding system codes were seeded normally.
      const holders6300 = await activeHoldersOfCode(ID.bizCollide, '6300');
      expect(holders6300).toHaveLength(1);
      expect(holders6300[0]).toMatchObject({ is_system: true, system_key: 'EXPENSE_RENT', code: '6300' });

      // Both skipped code collisions were reported via Logger.warn.
      const warnMessages = warnSpy.mock.calls.map((args) => args.map(String).join(' '));
      expect(warnMessages.some((m) => m.includes('6100') && m.includes('EXPENSE_MARKETING'))).toBe(true);
      expect(warnMessages.some((m) => m.includes('6200') && m.includes('EXPENSE_SOFTWARE'))).toBe(true);

      // Idempotent re-seed: second call changes nothing and emits no new collision warnings.
      const beforeReseed = await chart(ID.bizCollide);
      warnSpy.mockClear();
      await seeder.ensureDefaults(ID.bizCollide);
      expect(await chart(ID.bizCollide)).toEqual(beforeReseed);
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe('CSI-03: future SYSTEM_COA code colliding with an active custom account on an already-seeded chart', () => {
  it('CSI-03 RED-BEFORE: seeding a missing system account skips the code held by an active custom account and reports it', async () => {
    await seeder.ensureDefaults(ID.bizPartial);
    // Simulate a chart that predated EXPENSE_TRAVEL (6600) and already had an active custom 6600.
    await db.$executeRawUnsafe(
      `DELETE FROM chart_of_accounts WHERE business_id = $1 AND system_key = 'EXPENSE_TRAVEL'`,
      ID.bizPartial,
    );
    const custom6600 = `${P}custom6600`;
    await insertCustomRow(custom6600, ID.bizPartial, '6600', 'v91p Custom Fleet Travel', true);

    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    try {
      await seeder.ensureDefaults(ID.bizPartial);

      const holders6600 = await activeHoldersOfCode(ID.bizPartial, '6600');
      expect(holders6600).toHaveLength(1);
      expect(holders6600[0]).toMatchObject({
        id: custom6600,
        name: 'v91p Custom Fleet Travel',
        is_system: false,
        is_active: true,
      });

      const sysTravel = await db.chartOfAccount.findUnique({
        where: { businessId_systemKey: { businessId: ID.bizPartial, systemKey: 'EXPENSE_TRAVEL' } },
      });
      expect(sysTravel).toBeTruthy();
      expect(sysTravel.isSystem).toBe(true);
      expect(sysTravel.code).toBeNull();

      const warnMessages = warnSpy.mock.calls.map((args) => args.map(String).join(' '));
      expect(warnMessages.some((m) => m.includes('6600') && m.includes('EXPENSE_TRAVEL'))).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe('CSI-04: inactive custom account frees the code and idempotent system re-seeding', () => {
  it('CSI-04 CONTROL: an inactive custom account on 6100 does not block the system Marketing account, and cannot reactivate over it', async () => {
    const archived6100 = `${P}archived6100`;
    await insertCustomRow(archived6100, ID.bizInactive, '6100', 'v91p Archived 6100', false);

    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    try {
      await seeder.ensureDefaults(ID.bizInactive);

      // System Marketing claimed 6100 because the custom account is inactive.
      const holders6100 = await activeHoldersOfCode(ID.bizInactive, '6100');
      expect(holders6100).toHaveLength(1);
      expect(holders6100[0]).toMatchObject({
        system_key: 'EXPENSE_MARKETING',
        name: 'Marketing',
        code: '6100',
        is_system: true,
        is_active: true,
      });
      expect(warnSpy).not.toHaveBeenCalled();

      // Re-seeding when system account already holds 6100 is an idempotent no-op.
      const snap = await chart(ID.bizInactive);
      await seeder.ensureDefaults(ID.bizInactive);
      expect(await chart(ID.bizInactive)).toEqual(snap);
      expect(warnSpy).not.toHaveBeenCalled();

      // Attempting to reactivate the archived custom account fails 409 COA_CODE_TAKEN.
      const reactivate = await patch(ID.bizInactive, ID.ownerA, archived6100, { isActive: true });
      expect(reactivate.status, JSON.stringify(reactivate.body)).toBe(409);
      expect(reactivate.body.code).toBe('COA_CODE_TAKEN');
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe('CSI-05: cross-tenant isolation during seeding', () => {
  it('CSI-05 CONTROL: Biz A custom collisions never affect Biz B, and mismatched ALS tenant seeds only the active tenant', async () => {
    // bizCollide already has custom 6100 and 6200; bizCleanB must still get the full SYSTEM_COA with codes intact.
    await seeder.ensureDefaults(ID.bizCleanB);
    const b6100 = await activeHoldersOfCode(ID.bizCleanB, '6100');
    const b6200 = await activeHoldersOfCode(ID.bizCleanB, '6200');
    expect(b6100).toHaveLength(1);
    expect(b6100[0]).toMatchObject({ system_key: 'EXPENSE_MARKETING', is_system: true, code: '6100' });
    expect(b6200).toHaveLength(1);
    expect(b6200[0]).toMatchObject({ system_key: 'EXPENSE_SOFTWARE', is_system: true, code: '6200' });

    // Mismatched ALS tenant: active tenant is bizTenantA (which has custom 6100), arg is bizTenantB.
    const tenantACustom = `${P}tenantA6100`;
    await insertCustomRow(tenantACustom, ID.bizTenantA, '6100', 'v91p TenantA 6100', true);
    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    try {
      await runWithTenant(ID.bizTenantA, ID.ownerA, () => seeder.ensureDefaults(ID.bizTenantB));
      const a6100 = await activeHoldersOfCode(ID.bizTenantA, '6100');
      expect(a6100).toHaveLength(1);
      expect(a6100[0].id).toBe(tenantACustom);
      // bizTenantB was never touched.
      expect(await db.chartOfAccount.count({ where: { businessId: ID.bizTenantB } })).toBe(0);
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe('CSI-06: concurrent seeder and FinanceCoaService write serialize under the shared coa-code lock', () => {
  it('CSI-06: concurrent ensureDefaults() and POST on code 6100 end with exactly 1 active holder and zero 500s', async () => {
    const [seedResult, postRes] = await Promise.all([
      seeder.ensureDefaults(ID.bizRace).then(() => 'ok' as const),
      post(ID.bizRace, ID.ownerA, { name: 'v91p Concurrent 6100', type: 'EXPENSE', code: '6100' }),
    ]);

    expect(seedResult).toBe('ok');
    expect([201, 409]).toContain(postRes.status);
    const holders = await activeHoldersOfCode(ID.bizRace, '6100');
    expect(holders).toHaveLength(1);
  });
});

describe('CSI-07: FinanceCoaService.update() parentId input validation (400, never 500)', () => {
  it('CSI-07 RED-BEFORE: operator-object, non-string, empty, and self parentId return 400 and write nothing', async () => {
    const created = await post(ID.bizUpdate, ID.ownerA, { name: 'v91p Update Target', type: 'EXPENSE', code: '7400' });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const acctId: string = created.body.id;
    const before = await chart(ID.bizUpdate);

    const badParentIds: unknown[] = [
      { not: null },
      { equals: acctId },
      { set: acctId },
      123,
      true,
      false,
      [acctId],
      '',
      '   ',
      acctId, // self-parent
    ];

    for (const parentId of badParentIds) {
      const res = await patch(ID.bizUpdate, ID.ownerA, acctId, { parentId });
      expect(res.status, `parentId=${JSON.stringify(parentId)} body=${JSON.stringify(res.body)}`).toBe(400);
    }

    // Direct service door check: throws BadRequestException (400), never raw Prisma 500.
    const directErr = await coaService
      .update(ID.bizUpdate, acctId, { parentId: { not: null } as any })
      .then(() => null, (e: unknown) => e);
    expect(directErr).toBeInstanceOf(BadRequestException);
    expect((directErr as BadRequestException).getStatus()).toBe(400);

    expect(await chart(ID.bizUpdate)).toEqual(before);
  });
});

describe('CSI-08: FinanceCoaService.update() and create() field type validation (400, never 500)', () => {
  it('CSI-08 RED-BEFORE: non-string/empty name, non-string subtype, non-string code, and non-boolean isActive return 400 and write nothing', async () => {
    const created = await post(ID.bizUpdate, ID.ownerA, { name: 'v91p Field Validation Target', type: 'EXPENSE', code: '7401' });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const acctId: string = created.body.id;
    const before = await chart(ID.bizUpdate);

    // Invalid name values on PATCH
    for (const name of [123, { foo: 'bar' }, { set: 'hijack' }, ['a'], true, false, '', '   ', null]) {
      const res = await patch(ID.bizUpdate, ID.ownerA, acctId, { name });
      expect(res.status, `PATCH name=${JSON.stringify(name)} body=${JSON.stringify(res.body)}`).toBe(400);
    }

    // Direct service call with non-string name
    const directNameErr = await coaService
      .update(ID.bizUpdate, acctId, { name: 123 as any })
      .then(() => null, (e: unknown) => e);
    expect(directNameErr).toBeInstanceOf(BadRequestException);

    // Invalid subtype values on PATCH
    for (const subtype of [123, { set: 'sub' }, ['sub'], true, false]) {
      const res = await patch(ID.bizUpdate, ID.ownerA, acctId, { subtype });
      expect(res.status, `PATCH subtype=${JSON.stringify(subtype)} body=${JSON.stringify(res.body)}`).toBe(400);
    }

    // Invalid code and isActive values on PATCH
    for (const body of [
      { code: 7402 },
      { code: { set: '7402' } },
      { isActive: { set: false } },
      { isActive: 'false' },
    ]) {
      const res = await patch(ID.bizUpdate, ID.ownerA, acctId, body);
      expect(res.status, `PATCH body=${JSON.stringify(body)} res=${JSON.stringify(res.body)}`).toBe(400);
    }

    // Invalid field types on POST create() as well (never 500)
    for (const body of [
      { name: 123, type: 'EXPENSE' },
      { name: { set: 'bad' }, type: 'EXPENSE' },
      { name: 'v91p Bad Parent', type: 'EXPENSE', parentId: { not: null } },
      { name: 'v91p Bad Parent Num', type: 'EXPENSE', parentId: 123 },
      { name: 'v91p Bad Subtype', type: 'EXPENSE', subtype: { set: 'x' } },
      { name: 'v91p Bad Type', type: { set: 'EXPENSE' } },
    ]) {
      const res = await post(ID.bizUpdate, ID.ownerA, body);
      expect(res.status, `POST body=${JSON.stringify(body)} res=${JSON.stringify(res.body)}`).toBe(400);
    }

    expect(await chart(ID.bizUpdate)).toEqual(before);
  });
});

describe('CSI-09: positive controls and cross-tenant parentId rejection', () => {
  it('CSI-09 CONTROL: valid update() succeeds and cross-tenant parentId is rejected 400 on PATCH and POST', async () => {
    const parentRes = await post(ID.bizUpdate, ID.ownerA, { name: 'v91p Valid Parent', type: 'EXPENSE', code: '7410' });
    expect(parentRes.status, JSON.stringify(parentRes.body)).toBe(201);
    const parentId: string = parentRes.body.id;

    const childRes = await post(ID.bizUpdate, ID.ownerA, { name: 'v91p Valid Child', type: 'EXPENSE', code: '7411' });
    expect(childRes.status, JSON.stringify(childRes.body)).toBe(201);
    const childId: string = childRes.body.id;

    // Valid PATCH updating name, parentId, subtype, isActive
    const updated = await patch(ID.bizUpdate, ID.ownerA, childId, {
      name: '  v91p Valid Child Renamed  ',
      parentId,
      subtype: 'OPERATING',
      isActive: false,
    });
    expect(updated.status, JSON.stringify(updated.body)).toBe(200);
    expect(updated.body).toMatchObject({
      id: childId,
      name: 'v91p Valid Child Renamed',
      parentId,
      subtype: 'OPERATING',
      isActive: false,
    });

    // Clear parentId to null, clear subtype to null, reactivate
    const cleared = await patch(ID.bizUpdate, ID.ownerA, childId, {
      parentId: null,
      subtype: null,
      isActive: true,
    });
    expect(cleared.status, JSON.stringify(cleared.body)).toBe(200);
    expect(cleared.body).toMatchObject({
      id: childId,
      parentId: null,
      subtype: null,
      isActive: true,
    });

    // Cross-tenant parentId belonging to bizCleanB is rejected 400 on PATCH and POST.
    const bizBParent = await db.chartOfAccount.findFirst({ where: { businessId: ID.bizCleanB }, select: { id: true } });
    expect(bizBParent).toBeTruthy();

    const before = await chart(ID.bizUpdate);
    const crossPatch = await patch(ID.bizUpdate, ID.ownerA, childId, { parentId: bizBParent.id });
    expect(crossPatch.status, JSON.stringify(crossPatch.body)).toBe(400);

    const crossPost = await post(ID.bizUpdate, ID.ownerA, {
      name: 'v91p Cross Parent Create',
      type: 'EXPENSE',
      code: '7412',
      parentId: bizBParent.id,
    });
    expect(crossPost.status, JSON.stringify(crossPost.body)).toBe(400);
    expect(await chart(ID.bizUpdate)).toEqual(before);
  });
});
