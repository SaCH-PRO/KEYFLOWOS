/**
 * SWP-CENSUS-OPEN-WRITES (V1-66; D-146, the coawrite ruling): the chart-of-accounts writes need Money
 * write. Against a REAL database, through the HTTP routes.
 *
 * Premise at main 9a7b5011: POST, PATCH and DELETE /finance/businesses/:businessId/chart-of-accounts
 * checked membership only (ensureAccess); the REST scope census recorded them as `deferred` to the
 * Books gate, and books-write-scope.spec.ts kept them as reviewed exemptions with an owner question.
 * The owner ruled (D-146, coawrite): only members with Money write change the chart, the rows every
 * posting names.
 *
 * THE RULE: each of the three routes runs ModuleScopeGuard with revenue write, refused 403 before the
 * handler, so a refused call reads and writes nothing of the chart; ensureAccess stays, so a platform
 * SUPER_ADMIN who is not a member is still refused (D-46); GET chart-of-accounts is untouched (every
 * member reads the chart, as before).
 *
 * WHAT IS REAL: PrismaService over DATABASE_URL, AuthGuard, BusinessGuard, ModuleScopeGuard, the
 * GlobalHttpExceptionFilter and FinanceController; identity is attached by a test middleware from the
 * `x-test-user` header (the seeded User row, as AuthMiddleware attaches it). FinanceCoaService is a
 * recorder: the door is under test, not the chart's own code (its code-uniqueness lock and seed race
 * are proven by their own suites).
 *
 *   COW-A01  RED-BEFORE  a member with revenue none is refused POST, PATCH and DELETE chart-of-accounts:
 *                        403 in ModuleScopeGuard's words, the service never called
 *   COW-A02  RED-BEFORE  revenue read is refused the same three doors
 *   COW-B01  control     the owner, a STAFF revenue:write member and an ADMIN with revenue write reach the
 *                        service (POST 201, PATCH 200, DELETE 200), once each
 *   COW-B02  control     GET chart-of-accounts still answers revenue none (reads are unchanged)
 *   COW-C01  pinned      another business's owner and a SUPER_ADMIN who is not a member are refused every
 *                        door (403), the service never called
 *
 * Requires DATABASE_URL. Every seeded row carries the `v66h_` prefix and is hard-deleted by raw SQL
 * (sqlLikePrefix) in beforeAll and afterAll.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v66h_';

const ID = {
  owner: `${P}owner`,
  revNone: `${P}revNone`,
  revRead: `${P}revRead`,
  staffWrite: `${P}staffWrite`,
  adminWrite: `${P}adminWrite`,
  otherOwner: `${P}otherOwner`,
  superNon: `${P}superNon`,
  biz: `${P}biz`,
  other: `${P}other`,
  coa: `${P}coa_a`,
};
const USERS = [ID.owner, ID.revNone, ID.revRead, ID.staffWrite, ID.adminWrite, ID.otherOwner, ID.superNon];
const emailOf = (id: string) => `${id}@v66h.test.local`;
const refusal = (have: string) => `Insufficient permissions: revenue requires write access (you have ${have})`;

let db: any;
let app: any;

/** FinanceCoaService stand-in: records every reach of the chart's own code. */
const coa = {
  calls: [] as Array<{ op: string; businessId: string }>,
  async list(businessId: string) {
    this.calls.push({ op: 'list', businessId });
    return [{ id: ID.coa, name: `${P}Sales`, type: 'INCOME' }];
  },
  async create(businessId: string, input: unknown) {
    this.calls.push({ op: 'create', businessId });
    return { id: `${P}created`, ...(input as object) };
  },
  async update(businessId: string, id: string, input: unknown) {
    this.calls.push({ op: 'update', businessId });
    return { id, ...(input as object) };
  },
  async archive(businessId: string, id: string) {
    this.calls.push({ op: 'archive', businessId });
    return { id, isActive: false };
  },
};
const writes = () => coa.calls.filter((c) => c.op !== 'list');

async function cleanup() {
  for (const sql of [
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)} OR owner_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* cascades cover most of these */ }
  }
}

const as = (actor: string) => ({
  post: (url: string, body: Record<string, unknown> = {}) => request(app.getHttpServer()).post(url).set('x-test-user', actor).send(body),
  patch: (url: string, body: Record<string, unknown> = {}) => request(app.getHttpServer()).patch(url).set('x-test-user', actor).send(body),
  del: (url: string) => request(app.getHttpServer()).delete(url).set('x-test-user', actor),
  get: (url: string) => request(app.getHttpServer()).get(url).set('x-test-user', actor),
});
const base = (biz = ID.biz) => `/finance/businesses/${biz}/chart-of-accounts`;
const doors = (actor: string, biz = ID.biz) => [
  ['POST', () => as(actor).post(base(biz), { name: `${P}Consulting`, type: 'INCOME' })],
  ['PATCH', () => as(actor).patch(`${base(biz)}/${ID.coa}`, { name: `${P}Renamed` })],
  ['DELETE', () => as(actor).del(`${base(biz)}/${ID.coa}`)],
] as const;

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { FinanceController } = await import('../src/modules/finance/finance.controller');
  const { FinanceCoaService } = await import('../src/modules/finance/finance-coa.service');

  // The controller's other collaborators: never reached by these routes.
  const unused = await Promise.all([
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
    import('../src/modules/finance/finance-intelligence.service').then((m) => m.FinanceIntelligenceService),
    import('../src/core/object-storage').then((m) => m.ObjectStorageService),
  ]);

  const moduleRef = await Test.createTestingModule({
    controllers: [FinanceController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      { provide: FinanceCoaService, useValue: coa },
      ...unused.map((token) => ({ provide: token, useValue: {} })),
    ],
  }).compile();

  app = moduleRef.createNestApplication();
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  // Identity attachment only, as AuthMiddleware attaches it from the User row. No guard on these routes is overridden.
  app.use(async (req: any, _res: any, next: any) => {
    const header = req.headers['x-test-user'];
    const id = typeof header === 'string' ? header : undefined;
    if (id && id.startsWith(P)) {
      const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
      if (user) req.user = { id: user.id, email: user.email, role: user.role };
    }
    next();
  });
  await app.init();

  await cleanup();
  for (const id of USERS) {
    await db.user.create({ data: { id, email: emailOf(id), name: id, role: id === ID.superNon ? 'SUPER_ADMIN' : 'USER' } });
  }
  await db.business.create({ data: { id: ID.biz, name: `${ID.biz}-name`, ownerId: ID.owner, currency: 'TTD' } });
  await db.business.create({ data: { id: ID.other, name: `${ID.other}-name`, ownerId: ID.otherOwner, currency: 'TTD' } });
  const { ROLE_DEFAULT_SCOPES } = await import('../src/core/authority/module-vocabulary');
  const memberships: Array<{ userId: string; businessId: string; role: string; permissionScopes?: Record<string, string> }> = [
    { userId: ID.owner, businessId: ID.biz, role: 'OWNER' },
    { userId: ID.revNone, businessId: ID.biz, role: 'ADMIN', permissionScopes: { ...ROLE_DEFAULT_SCOPES.ADMIN, revenue: 'none' } },
    { userId: ID.revRead, businessId: ID.biz, role: 'ADMIN', permissionScopes: { ...ROLE_DEFAULT_SCOPES.ADMIN, revenue: 'read' } },
    { userId: ID.staffWrite, businessId: ID.biz, role: 'STAFF', permissionScopes: { revenue: 'write' } },
    { userId: ID.adminWrite, businessId: ID.biz, role: 'ADMIN', permissionScopes: { ...ROLE_DEFAULT_SCOPES.ADMIN, revenue: 'write' } },
    { userId: ID.otherOwner, businessId: ID.other, role: 'OWNER' },
  ];
  for (const m of memberships) {
    await db.membership.create({ data: { id: `${P}m_${m.userId.slice(P.length)}_${m.businessId.slice(P.length)}`, ...m } });
  }
}, 60_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
});

beforeEach(() => {
  coa.calls.length = 0;
});

describe('SWP-CENSUS-OPEN-WRITES (D-146, coawrite): the chart-of-accounts writes need Money write', () => {
  it('COW-X01 fixture sanity: the five members of the business', async () => {
    expect(await db.membership.count({ where: { businessId: ID.biz } })).toBe(5);
  });

  it.each([
    ['COW-A01 RED-BEFORE: revenue none', ID.revNone, 'none'],
    ['COW-A02 RED-BEFORE: revenue read', ID.revRead, 'read'],
  ])('%s is refused POST, PATCH and DELETE chart-of-accounts, the service never called', async (_label, actor, have) => {
    for (const [door, call] of doors(actor)) {
      const res = await call();
      expect(res.status, `${door}: ${JSON.stringify(res.body)}`).toBe(403);
      expect(res.body?.message, door).toBe(refusal(have));
    }
    expect(writes()).toEqual([]);
  });

  it.each([
    ['the owner', ID.owner],
    ['a STAFF revenue:write member', ID.staffWrite],
    ['an ADMIN with revenue write', ID.adminWrite],
  ])('COW-B01 control: %s reaches the chart through all three doors, once each', async (_label, actor) => {
    const expected = { POST: 201, PATCH: 200, DELETE: 200 } as const;
    for (const [door, call] of doors(actor)) {
      const res = await call();
      expect(res.status, `${door}: ${JSON.stringify(res.body)}`).toBe(expected[door]);
    }
    expect(writes().map((c) => c.op)).toEqual(['create', 'update', 'archive']);
    expect(writes().every((c) => c.businessId === ID.biz)).toBe(true);
  });

  it('COW-B02 control: GET chart-of-accounts still answers revenue none (reads are unchanged)', async () => {
    const res = await as(ID.revNone).get(base());
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(coa.calls.map((c) => c.op)).toEqual(['list']);
  });

  it.each([
    ["another business's owner", ID.otherOwner],
    ['a SUPER_ADMIN who is not a member', ID.superNon],
  ])('COW-C01 pinned: %s is refused every door (D-46), the service never called', async (_label, actor) => {
    for (const [door, call] of doors(actor)) {
      const res = await call();
      expect(res.status, `${door}: ${JSON.stringify(res.body)}`).toBe(403);
    }
    expect(writes()).toEqual([]);
  });
});
