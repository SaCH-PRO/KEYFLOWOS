/**
 * V1-63 SWP-COA-UNIQUE-CODE (BUG-111): the chart of accounts refuses a duplicate account code. REAL database.
 *
 * The sweep found three accounts of one business sharing code 6100: FinanceCoaService.create and .update
 * (POST and PATCH finance/businesses/:b/chart-of-accounts, and KEY's finance_create_coa_account tool, which
 * calls the same create) wrote whatever code they were given. The rule: a code is used by at most one
 * ACTIVE account of a business. A write that would make a second one is refused 409 COA_CODE_TAKEN and
 * writes nothing. Owner ruling D-167 (`migrations`): the check stays in the service; no unique index.
 *
 *   CUC-01  RED-BEFORE  a second 6100 (the seeded Marketing account holds it) -> 409 COA_CODE_TAKEN, no row
 *   CUC-02  RED-BEFORE  renaming an account's code to a taken one -> 409, the account keeps its code
 *   CUC-03  CONTROL     another business may use the same codes; its accounts never block this one, and the
 *                       409 names only the caller's own account
 *   CUC-04  CONTROL     a free code is 201; accounts without a code never collide; an account may be saved
 *                       with its own code again; a code may move to a free one
 *   CUC-05  RED-BEFORE  the same code written with other spacing or letter case is the same code -> 409; a
 *                       code is stored trimmed, and a blank code is stored as no code
 *   CUC-06  RED-BEFORE  an archived account frees its code (CONTROL), and cannot come back active while
 *                       another active account holds it -> 409
 *   CUC-07  RED-BEFORE  two concurrent creates of one free code: exactly one 201, one 409, one row
 *   CUC-08  RED-BEFORE  a business whose chart was never seeded: a custom 6100 is refused (the seed runs
 *                       first), so the seed never lands a second 6100 beside it
 *   CUC-09  RED-BEFORE  a code that is not text (a JSON number or object) -> 400, not a 500, nothing written
 *   CUC-10  CONTROL then RED-BEFORE  accounts that already share a code (rows written before this rule) can
 *                       still be renamed and archived, and nothing is rewritten for them; no third joins them
 *   CUC-11  RED-BEFORE  the service door KEY's finance_create_coa_account tool calls refuses the same way
 *   CUC-12  RED-BEFORE  isActive that is not true or false ({ set: true }, "true", 1) -> 400, nothing written:
 *                       a Prisma operator object cannot bring an archived account back around the check
 *   CUC-13  RED-BEFORE  rows stored before codes were trimmed ('7140 ', a trailing tab) hold their code like
 *                       any other: they cannot come back beside its holder, and they block a new one
 *   CUC-14  RED-BEFORE  under an active tenant that differs from the businessId argument, the check runs on
 *                       the business the write lands in (the active tenant); the other chart is untouched
 *
 * Nothing on the boundary is mocked: PrismaService, AuthGuard, BusinessGuard, TenantInterceptor,
 * FinanceController, FinanceCoaService and ChartOfAccountsSeederService run against DATABASE_URL, and the
 * tenant-isolation extension of `@keyflow/db` is wired to the AsyncLocalStorage tenant as main.ts wires it.
 * Stand-ins: identity attachment (a test middleware reads `x-v63h-user`, loads that seeded user row and
 * attaches `{ id, email, role }`, as the Supabase-verifying AuthMiddleware does); FinanceController's
 * collaborators off the chart-of-accounts routes (empty objects, never reached).
 *
 * Fixtures: prefix `v63h_` (registered in test/helpers/fixture-prefixes.json); hard-deleted by raw SQL
 * (patterns built by sqlLikePrefix) in dependency order in beforeAll and afterAll; no $transaction wrapping.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

vi.setConfig({ testTimeout: 30_000 });

const P = 'v63h_';
const HEADER = 'x-v63h-user';

const ID = {
  ownerA: `${P}ownerA`,
  ownerB: `${P}ownerB`,
  bizA: `${P}bizA`, // chart seeded in beforeAll
  bizB: `${P}bizB`, // the other business; chart seeded in beforeAll
  bizFresh: `${P}bizFresh`, // ownerA's; chart never seeded before CUC-08
};

const TAKEN = 'COA_CODE_TAKEN';

let db: any;
let app: any;
let coaService: any;
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
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
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

/** The chart of a business, row by row, as JSON text (raw SQL): "nothing written" is byte-identical. */
async function chart(biz: string): Promise<string> {
  const [row]: Array<{ j: string }> = await db.$queryRawUnsafe(
    `SELECT COALESCE(json_agg(t ORDER BY t.id), '[]'::json)::text AS j FROM chart_of_accounts t WHERE t.business_id = $1`,
    biz,
  );
  return row.j;
}

/** Rows of a business holding exactly this stored code (raw SQL, active or not). */
async function rowsWithCode(biz: string, code: string): Promise<Array<{ id: string; name: string; is_active: boolean }>> {
  return db.$queryRawUnsafe(
    `SELECT id, name, is_active FROM chart_of_accounts WHERE business_id = $1 AND code = $2 ORDER BY id`,
    biz,
    code,
  );
}

const post = (biz: string, user: string, body: unknown) => http().post(coaUrl(biz)).set(HEADER, user).send(body as object);
const patch = (biz: string, user: string, id: string, body: unknown) =>
  http().patch(coaUrl(biz, id)).set(HEADER, user).send(body as object);

/** A custom account through the real door; must succeed. */
async function make(biz: string, user: string, name: string, code?: string | null): Promise<string> {
  const res = await post(biz, user, { name, type: 'EXPENSE', ...(code !== undefined ? { code } : {}) });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id as string;
}

function expectTaken(res: { status: number; body: any }) {
  expect(res.status, JSON.stringify(res.body)).toBe(409);
  expect(res.body).toMatchObject({ statusCode: 409, code: TAKEN });
  expect(typeof res.body.message).toBe('string');
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;
  // As main.ts: the db extension rewrites businessId to the AsyncLocalStorage tenant when there is one.
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
  const { ChartOfAccountsSeederService } = await import('../src/modules/finance/chart-of-accounts-seeder.service');

  // FinanceController's collaborators off the chart-of-accounts routes.
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
      // Live: the chart service and the seeder it calls.
      FinanceCoaService,
      ChartOfAccountsSeederService,
      ...stubs.map((token) => ({ provide: token, useValue: {} })),
    ],
  }).compile();
  coaService = moduleRef.get(FinanceCoaService);
  const seeder = moduleRef.get(ChartOfAccountsSeederService);

  app = moduleRef.createNestApplication();
  attachIdentity(app);
  app.useGlobalInterceptors(new TenantInterceptor(moduleRef.get(PrismaService)));
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  await app.init();

  await cleanup();

  for (const id of [ID.ownerA, ID.ownerB]) {
    await db.user.create({ data: { id, email: `${P}${id.slice(P.length)}@test.local`, name: id, role: 'USER' } });
  }
  for (const [id, ownerId] of [[ID.bizA, ID.ownerA], [ID.bizB, ID.ownerB], [ID.bizFresh, ID.ownerA]] as const) {
    await db.business.create({ data: { id, name: `V63H ${id}`, slug: id, ownerId, currency: 'TTD' } });
    await db.membership.create({ data: { id: `${P}m_${id.slice(P.length)}`, userId: ownerId, businessId: id, role: 'OWNER' } });
  }
  await seeder.ensureDefaults(ID.bizA);
  await seeder.ensureDefaults(ID.bizB);
}, 120_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
  if (setTenantContextProvider) setTenantContextProvider({ getCurrentBusinessId: () => undefined });
}, 60_000);

describe('fixture sanity (real rows)', () => {
  it('each seeded business has exactly one account on 6100, the system Marketing account; the fresh one has no chart', async () => {
    for (const biz of [ID.bizA, ID.bizB]) {
      const rows = await rowsWithCode(biz, '6100');
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ name: 'Marketing', is_active: true });
    }
    expect(await db.chartOfAccount.count({ where: { businessId: ID.bizFresh } })).toBe(0);
  });
});

describe('CUC-01: a second account on a taken code', () => {
  it('CUC-01 RED-BEFORE: POST code 6100 (held by the system Marketing account) is 409 COA_CODE_TAKEN and writes no row', async () => {
    const before = await chart(ID.bizA);
    const res = await post(ID.bizA, ID.ownerA, { name: 'v63h Second marketing', type: 'EXPENSE', code: '6100' });
    expectTaken(res);
    expect(res.body.message).toContain('6100');
    expect(await chart(ID.bizA)).toEqual(before);
    expect(await rowsWithCode(ID.bizA, '6100')).toHaveLength(1);
  });

  it('CUC-01b RED-BEFORE: a custom account\'s code is held the same way (the third 6100 of the sweep was a second custom one)', async () => {
    await make(ID.bizA, ID.ownerA, 'v63h Vehicle costs', '7010');
    const before = await chart(ID.bizA);
    const res = await post(ID.bizA, ID.ownerA, { name: 'v63h Vehicle costs again', type: 'EXPENSE', code: '7010' });
    expectTaken(res);
    expect(await chart(ID.bizA)).toEqual(before);
  });
});

describe('CUC-02: renaming an account to a taken code', () => {
  it('CUC-02 RED-BEFORE: PATCH code to one another active account holds is 409 and the account keeps its code and name', async () => {
    await make(ID.bizA, ID.ownerA, 'v63h Tools', '7020');
    const id = await make(ID.bizA, ID.ownerA, 'v63h Uniforms', '7021');
    const before = await chart(ID.bizA);
    // The name in the same request is not written either: the refusal is whole.
    expectTaken(await patch(ID.bizA, ID.ownerA, id, { code: '7020', name: 'v63h Uniforms renamed' }));
    expectTaken(await patch(ID.bizA, ID.ownerA, id, { code: '6100' }));
    expect(await chart(ID.bizA)).toEqual(before);
  });
});

describe('CUC-03: the rule is per business', () => {
  it('CUC-03 CONTROL: another business uses the codes this one holds, and its accounts never block this one', async () => {
    await make(ID.bizA, ID.ownerA, 'v63h A only', '7030');
    // B takes a code A holds.
    const inB = await make(ID.bizB, ID.ownerB, 'v63h B same code', '7030');
    expect(await rowsWithCode(ID.bizB, '7030')).toHaveLength(1);
    // B holds a code A does not; A may take it.
    await make(ID.bizB, ID.ownerB, 'v63h B secret account', '7031');
    await make(ID.bizA, ID.ownerA, 'v63h A takes 7031', '7031');
    // B may rename onto a code only A holds.
    await make(ID.bizA, ID.ownerA, 'v63h A holds 7032', '7032');
    const moved = await patch(ID.bizB, ID.ownerB, inB, { code: '7032' });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    expect(moved.body.code).toBe('7032');
  });

  it('CUC-03b RED-BEFORE then CONTROL: a refusal names nothing of another business, and a non-member is refused before the code is looked at', async () => {
    await make(ID.bizB, ID.ownerB, 'v63h B hidden name', '7040');
    await make(ID.bizA, ID.ownerA, 'v63h A visible name', '7040');
    const res = await post(ID.bizA, ID.ownerA, { name: 'v63h dup', type: 'EXPENSE', code: '7040' });
    expectTaken(res);
    expect(JSON.stringify(res.body)).not.toContain('B hidden name');
    expect(JSON.stringify(res.body)).not.toContain(ID.bizB);
    // ownerA is no member of B: taken and free codes answer the same 403, so codes of B cannot be probed.
    const beforeB = await chart(ID.bizB);
    const takenInB = await post(ID.bizB, ID.ownerA, { name: 'v63h probe', type: 'EXPENSE', code: '7040' });
    const freeInB = await post(ID.bizB, ID.ownerA, { name: 'v63h probe', type: 'EXPENSE', code: '7999' });
    expect(takenInB.status, JSON.stringify(takenInB.body)).toBe(403);
    expect(freeInB.status, JSON.stringify(freeInB.body)).toBe(403);
    expect(takenInB.body.message).toEqual(freeInB.body.message);
    expect(await chart(ID.bizB)).toEqual(beforeB);
  });
});

describe('CUC-04: what the rule leaves alone', () => {
  it('CUC-04 CONTROL: a free code is 201, accounts without a code never collide, and an account may be saved with its own code', async () => {
    const id = await make(ID.bizA, ID.ownerA, 'v63h Free code', '7050');
    await make(ID.bizA, ID.ownerA, 'v63h No code 1');
    await make(ID.bizA, ID.ownerA, 'v63h No code 2', null);
    const noCode = await make(ID.bizA, ID.ownerA, 'v63h No code 3');
    // Saving the whole form back (same code) with a new name.
    const same = await patch(ID.bizA, ID.ownerA, id, { code: '7050', name: 'v63h Free code renamed' });
    expect(same.status, JSON.stringify(same.body)).toBe(200);
    expect(same.body).toMatchObject({ code: '7050', name: 'v63h Free code renamed' });
    // Moving to a free code, and clearing a code.
    const moved = await patch(ID.bizA, ID.ownerA, id, { code: '7051' });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    expect(moved.body.code).toBe('7051');
    const cleared = await patch(ID.bizA, ID.ownerA, id, { code: null });
    expect(cleared.status, JSON.stringify(cleared.body)).toBe(200);
    expect(cleared.body.code).toBeNull();
    // The code it left is free again.
    await make(ID.bizA, ID.ownerA, 'v63h Takes 7051', '7051');
    // An account with no code may take a free one.
    const coded = await patch(ID.bizA, ID.ownerA, noCode, { code: '7052' });
    expect(coded.status, JSON.stringify(coded.body)).toBe(200);
  });
});

describe('CUC-05: one code, however it is typed', () => {
  it('CUC-05 RED-BEFORE: spacing or letter case does not make a second code; codes are stored trimmed', async () => {
    const created = await post(ID.bizA, ID.ownerA, { name: 'v63h Trimmed', type: 'EXPENSE', code: '  70A60 ' });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.code).toBe('70A60');
    const before = await chart(ID.bizA);
    expectTaken(await post(ID.bizA, ID.ownerA, { name: 'v63h spaced', type: 'EXPENSE', code: ' 6100 ' }));
    expectTaken(await post(ID.bizA, ID.ownerA, { name: 'v63h lower', type: 'EXPENSE', code: '70a60' }));
    const other = await make(ID.bizA, ID.ownerA, 'v63h Other', '7061');
    const mid = await chart(ID.bizA);
    expectTaken(await patch(ID.bizA, ID.ownerA, other, { code: '\t70a60' }));
    expect(await chart(ID.bizA)).toEqual(mid);
    expect(mid).not.toEqual(before); // only the control account was added
    // An account may change the letter case of its own code.
    const recased = await patch(ID.bizA, ID.ownerA, created.body.id, { code: '70a60' });
    expect(recased.status, JSON.stringify(recased.body)).toBe(200);
    expect(recased.body.code).toBe('70a60');
  });

  it('CUC-05b RED-BEFORE: a blank code is no code (stored null), on create and on update', async () => {
    const a = await post(ID.bizA, ID.ownerA, { name: 'v63h Blank 1', type: 'EXPENSE', code: '   ' });
    const b = await post(ID.bizA, ID.ownerA, { name: 'v63h Blank 2', type: 'EXPENSE', code: '' });
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    expect(b.status, JSON.stringify(b.body)).toBe(201);
    expect(a.body.code).toBeNull();
    expect(b.body.code).toBeNull();
    const id = await make(ID.bizA, ID.ownerA, 'v63h To blank', '7062');
    const cleared = await patch(ID.bizA, ID.ownerA, id, { code: ' ' });
    expect(cleared.status, JSON.stringify(cleared.body)).toBe(200);
    expect(cleared.body.code).toBeNull();
  });
});

describe('CUC-06: archived accounts', () => {
  it('CUC-06 CONTROL then RED-BEFORE: an archived account frees its code, and cannot come back while another active account holds it', async () => {
    const old = await make(ID.bizA, ID.ownerA, 'v63h Old 7070', '7070');
    const archived = await http().delete(coaUrl(ID.bizA, old)).set(HEADER, ID.ownerA);
    expect(archived.status, JSON.stringify(archived.body)).toBe(200);
    // CONTROL: the rule is about ACTIVE accounts; the code is free again.
    const fresh = await make(ID.bizA, ID.ownerA, 'v63h New 7070', '7070');
    const before = await chart(ID.bizA);
    // RED-BEFORE: reactivating the old one would make two active accounts on 7070.
    expectTaken(await patch(ID.bizA, ID.ownerA, old, { isActive: true }));
    expectTaken(await patch(ID.bizA, ID.ownerA, old, { isActive: true, code: '7070' }));
    expect(await chart(ID.bizA)).toEqual(before);
    // It comes back with a free code in the same request, or once the holder is archived.
    const back = await patch(ID.bizA, ID.ownerA, old, { isActive: true, code: '7071' });
    expect(back.status, JSON.stringify(back.body)).toBe(200);
    expect(back.body).toMatchObject({ isActive: true, code: '7071' });
    expect((await http().delete(coaUrl(ID.bizA, fresh)).set(HEADER, ID.ownerA)).status).toBe(200);
    const swapped = await patch(ID.bizA, ID.ownerA, old, { code: '7070' });
    expect(swapped.status, JSON.stringify(swapped.body)).toBe(200);
    expect((await rowsWithCode(ID.bizA, '7070')).filter((r) => r.is_active)).toHaveLength(1);
  });

  it('CUC-06b RED-BEFORE: an archived account cannot be given a code an active account holds, archived or coming back', async () => {
    await make(ID.bizA, ID.ownerA, 'v63h Holder 7075', '7075');
    const parked = await make(ID.bizA, ID.ownerA, 'v63h Parked', '7076');
    expect((await http().delete(coaUrl(ID.bizA, parked)).set(HEADER, ID.ownerA)).status).toBe(200);
    const before = await chart(ID.bizA);
    // The code is refused even while the account stays archived: no row is ever one step from a duplicate.
    expectTaken(await patch(ID.bizA, ID.ownerA, parked, { code: '7075' }));
    expectTaken(await patch(ID.bizA, ID.ownerA, parked, { code: '7075', isActive: false }));
    expectTaken(await patch(ID.bizA, ID.ownerA, parked, { code: '7075', isActive: true }));
    expect(await chart(ID.bizA)).toEqual(before);
    expect((await rowsWithCode(ID.bizA, '7075')).filter((r) => r.is_active)).toHaveLength(1);
  });
});

describe('CUC-07: two writers at once', () => {
  it('CUC-07 RED-BEFORE: concurrent creates of one free code end with exactly one account on it', async () => {
    for (let round = 0; round < 5; round++) {
      const code = `708${round}`;
      const results = await Promise.all(
        [1, 2, 3, 4].map((n) => post(ID.bizA, ID.ownerA, { name: `v63h Race ${code} ${n}`, type: 'EXPENSE', code })),
      );
      const statuses = results.map((r) => r.status).sort();
      expect(statuses, JSON.stringify(results.map((r) => r.body))).toEqual([201, 409, 409, 409]);
      for (const r of results.filter((x) => x.status === 409)) expect(r.body.code).toBe(TAKEN);
      expect(await rowsWithCode(ID.bizA, code)).toHaveLength(1);
    }
  });

  it('CUC-07b RED-BEFORE: a concurrent create and rename onto one free code end with exactly one account on it', async () => {
    for (let round = 0; round < 5; round++) {
      const code = `709${round}`;
      const mover = await make(ID.bizA, ID.ownerA, `v63h Mover ${round}`, `719${round}`);
      const [created, renamed] = await Promise.all([
        post(ID.bizA, ID.ownerA, { name: `v63h Racer ${round}`, type: 'EXPENSE', code }),
        patch(ID.bizA, ID.ownerA, mover, { code }),
      ]);
      // Exactly one of the two wins the code.
      expect(
        (created.status === 201 && renamed.status === 409) || (created.status === 409 && renamed.status === 200),
        JSON.stringify([created.status, created.body, renamed.status, renamed.body]),
      ).toBe(true);
      expect((await rowsWithCode(ID.bizA, code)).filter((r) => r.is_active)).toHaveLength(1);
    }
  });
});

describe('CUC-08: a chart that was never seeded', () => {
  it('CUC-08 RED-BEFORE: the first write seeds the system accounts, so a custom 6100 is refused and the chart ends with one 6100', async () => {
    expect(await db.chartOfAccount.count({ where: { businessId: ID.bizFresh } })).toBe(0);
    expectTaken(await post(ID.bizFresh, ID.ownerA, { name: 'v63h Early marketing', type: 'EXPENSE', code: '6100' }));
    const listed = await http().get(coaUrl(ID.bizFresh)).set(HEADER, ID.ownerA);
    expect(listed.status, JSON.stringify(listed.body)).toBe(200);
    const on6100 = (listed.body.items as Array<{ code: string | null; name: string }>).filter((r) => r.code === '6100');
    expect(on6100).toHaveLength(1);
    expect(on6100[0].name).toBe('Marketing');
    // A free code is still accepted there.
    await make(ID.bizFresh, ID.ownerA, 'v63h Fresh custom', '7100');
  });
});

describe('CUC-09: a code that is not text', () => {
  it('CUC-09 RED-BEFORE: a number or an object as the code is 400 on create and update, and nothing is written', async () => {
    const id = await make(ID.bizA, ID.ownerA, 'v63h Typed', '7110');
    const before = await chart(ID.bizA);
    for (const code of [6100, { equals: '6100' }, ['6100'], true]) {
      const created = await post(ID.bizA, ID.ownerA, { name: 'v63h typed', type: 'EXPENSE', code });
      expect(created.status, JSON.stringify(created.body)).toBe(400);
      const updated = await patch(ID.bizA, ID.ownerA, id, { code });
      expect(updated.status, JSON.stringify(updated.body)).toBe(400);
    }
    expect(await chart(ID.bizA)).toEqual(before);
  });
});

describe('CUC-10: accounts that already share a code', () => {
  it('CUC-10 CONTROL then RED-BEFORE: two rows written before the rule (raw SQL) keep their code and can still be renamed and archived; no third joins them', async () => {
    const ids = [`${P}legacy1`, `${P}legacy2`];
    for (const id of ids) {
      await db.$executeRawUnsafe(
        `INSERT INTO chart_of_accounts (id, business_id, code, name, type, is_system, is_active, created_at, updated_at)
         VALUES ($1, $2, '7120', $3, 'EXPENSE', false, true, now(), now())`,
        id, ID.bizA, `v63h ${id}`,
      );
    }
    const renamed = await patch(ID.bizA, ID.ownerA, ids[0], { name: 'v63h legacy renamed' });
    expect(renamed.status, JSON.stringify(renamed.body)).toBe(200);
    // The whole form saved back, code unchanged.
    const saved = await patch(ID.bizA, ID.ownerA, ids[0], { name: 'v63h legacy saved', code: '7120', subtype: 'x' });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body.code).toBe('7120');
    // No third one joins them.
    expectTaken(await post(ID.bizA, ID.ownerA, { name: 'v63h third', type: 'EXPENSE', code: '7120' }));
    // One is archived; it then cannot come back beside the other.
    expect((await http().delete(coaUrl(ID.bizA, ids[1])).set(HEADER, ID.ownerA)).status).toBe(200);
    expectTaken(await patch(ID.bizA, ID.ownerA, ids[1], { isActive: true }));
    expect((await rowsWithCode(ID.bizA, '7120')).filter((r) => r.is_active)).toHaveLength(1);
  });
});

describe('CUC-11: the service door (KEY finance_create_coa_account calls FinanceCoaService.create)', () => {
  it('CUC-11 RED-BEFORE: create and update called directly throw a 409 ConflictException carrying COA_CODE_TAKEN', async () => {
    const { ConflictException } = await import('@nestjs/common');
    const before = await chart(ID.bizA);
    const err = await coaService.create(ID.bizA, { name: 'v63h via tool', type: 'EXPENSE', code: '6100' }).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as any).getStatus()).toBe(409);
    expect((err as any).getResponse()).toMatchObject({ code: TAKEN });
    expect(await chart(ID.bizA)).toEqual(before);
    const id = (await coaService.create(ID.bizA, { name: 'v63h via tool ok', type: 'EXPENSE', code: '7130' })).id;
    const err2 = await coaService.update(ID.bizA, id, { code: '6100' }).then(() => null, (e: unknown) => e);
    expect(err2).toBeInstanceOf(ConflictException);
    // An account of another business is not found, whatever code is asked for (unchanged).
    const { NotFoundException } = await import('@nestjs/common');
    const err3 = await coaService.update(ID.bizB, id, { code: '7999' }).then(() => null, (e: unknown) => e);
    expect(err3).toBeInstanceOf(NotFoundException);
  });
});

/** A row as code written before this rule could leave it (raw SQL: stored verbatim, untrimmed). */
async function legacyRow(id: string, code: string, active: boolean) {
  await db.$executeRawUnsafe(
    `INSERT INTO chart_of_accounts (id, business_id, code, name, type, is_system, is_active, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'EXPENSE', false, $5, now(), now())`,
    id, ID.bizA, code, `v63h ${id}`, active,
  );
}

describe('CUC-12: isActive that is not a boolean', () => {
  it('CUC-12 RED-BEFORE: { set: true }, "true" and 1 are 400 and cannot bring an archived account back beside the holder of its code', async () => {
    const old = await make(ID.bizA, ID.ownerA, 'v63h Old 7130x', '7135');
    expect((await http().delete(coaUrl(ID.bizA, old)).set(HEADER, ID.ownerA)).status).toBe(200);
    await make(ID.bizA, ID.ownerA, 'v63h New 7135', '7135');
    const before = await chart(ID.bizA);
    for (const isActive of [{ set: true }, 'true', 1, { set: false }, [true]]) {
      for (const body of [{ isActive }, { isActive, code: '7135' }, { isActive, name: 'v63h renamed by bad flag' }]) {
        const res = await patch(ID.bizA, ID.ownerA, old, body);
        expect(res.status, JSON.stringify([body, res.body])).toBe(400);
      }
    }
    expect(await chart(ID.bizA)).toEqual(before);
    expect((await rowsWithCode(ID.bizA, '7135')).filter((r) => r.is_active)).toHaveLength(1);
    // CONTROL: real booleans still work, and null leaves the flag alone (as before).
    const other = await make(ID.bizA, ID.ownerA, 'v63h Flag control', '7136');
    const off = await patch(ID.bizA, ID.ownerA, other, { isActive: false });
    expect(off.status, JSON.stringify(off.body)).toBe(200);
    expect(off.body.isActive).toBe(false);
    const untouched = await patch(ID.bizA, ID.ownerA, other, { isActive: null, name: 'v63h Flag control 2' });
    expect(untouched.status, JSON.stringify(untouched.body)).toBe(200);
    expect(untouched.body.isActive).toBe(false);
    const on = await patch(ID.bizA, ID.ownerA, other, { isActive: true });
    expect(on.status, JSON.stringify(on.body)).toBe(200);
    expect(on.body.isActive).toBe(true);
  });
});

describe('CUC-13: codes stored before they were trimmed', () => {
  it('CUC-13 RED-BEFORE: an archived row stored as \'7140 \' cannot come back beside the active 7140', async () => {
    await legacyRow(`${P}legacySpace`, '7140 ', false);
    await make(ID.bizA, ID.ownerA, 'v63h Holder 7140', '7140');
    const before = await chart(ID.bizA);
    expectTaken(await patch(ID.bizA, ID.ownerA, `${P}legacySpace`, { isActive: true }));
    expect(await chart(ID.bizA)).toEqual(before);
  });

  it('CUC-13b RED-BEFORE: an active row stored with a trailing tab or newline holds its code against a new account and a rename', async () => {
    await legacyRow(`${P}legacyTab`, '7141\t', true);
    await legacyRow(`${P}legacyNl`, ' 7142\r\n', true);
    const mover = await make(ID.bizA, ID.ownerA, 'v63h Mover 7143', '7143');
    const before = await chart(ID.bizA);
    expectTaken(await post(ID.bizA, ID.ownerA, { name: 'v63h new 7141', type: 'EXPENSE', code: '7141' }));
    expectTaken(await post(ID.bizA, ID.ownerA, { name: 'v63h new 7142', type: 'EXPENSE', code: '7142' }));
    expectTaken(await patch(ID.bizA, ID.ownerA, mover, { code: '7141' }));
    expect(await chart(ID.bizA)).toEqual(before);
    // CONTROL: the legacy row saved with its own code (as the form shows it) is not refused, and is stored trimmed.
    const saved = await patch(ID.bizA, ID.ownerA, `${P}legacyTab`, { code: '7141', name: 'v63h legacy tab saved' });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body.code).toBe('7141');
  });
});

describe('CUC-14: an active tenant that differs from the businessId argument', () => {
  it('CUC-14 RED-BEFORE: the check runs on the business the write lands in, and the business named by the argument is untouched', async () => {
    const { ConflictException } = await import('@nestjs/common');
    await make(ID.bizA, ID.ownerA, 'v63h A holds 7150', '7150');
    await make(ID.bizB, ID.ownerB, 'v63h B holds 7151', '7151');
    const beforeA = await chart(ID.bizA);
    const beforeB = await chart(ID.bizB);
    // Active tenant A, argument B: the db extension writes into A, so A's codes decide.
    const refused = await runWithTenant(ID.bizA, ID.ownerA, () =>
      coaService.create(ID.bizB, { name: 'v63h mismatched', type: 'EXPENSE', code: '7150' }).then(() => null, (e: unknown) => e));
    expect(refused).toBeInstanceOf(ConflictException);
    expect(JSON.stringify((refused as any).getResponse())).toContain('A holds 7150');
    expect(await chart(ID.bizA)).toEqual(beforeA);
    expect(await chart(ID.bizB)).toEqual(beforeB);
    // A code only B holds is free in A: the write lands in A and B's chart is byte-identical.
    const landed = await runWithTenant(ID.bizA, ID.ownerA, () =>
      coaService.create(ID.bizB, { name: 'v63h mismatched free', type: 'EXPENSE', code: '7151' }));
    expect(landed.businessId).toBe(ID.bizA);
    expect(await chart(ID.bizB)).toEqual(beforeB);
    expect(await rowsWithCode(ID.bizA, '7151')).toHaveLength(1);
    // An update naming B's business for A's row under tenant A acts on A's row and checks A's codes.
    const err = await runWithTenant(ID.bizA, ID.ownerA, () =>
      coaService.update(ID.bizB, landed.id, { code: '7150' }).then(() => null, (e: unknown) => e));
    expect(err).toBeInstanceOf(ConflictException);
    expect(await chart(ID.bizB)).toEqual(beforeB);
  });
});
