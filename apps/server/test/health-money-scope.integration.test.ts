/**
 * FU-HEALTH-MONEY-SCOPE (P101, owner rulings D-259, D-100, D-234): the health score's money
 * area withholds money figures and amount-bearing reasons from readers without revenue:read.
 * REAL database, through the HTTP routes and ScheduledScansService.
 *
 * THE GAP: GET /intelligence/businesses/:businessId/health (@RequireModuleScope('settings', 'read'))
 * and POST /intelligence/businesses/:businessId/health/refresh (@RequireModuleScope('settings', 'write'))
 * returned the full `money` area (cashBalance, cashCurrency, overdueReceivables, billsDue30,
 * taxDueSoon, uncategorizedExpenses, and amount-bearing reasons) to any member holding settings
 * scope even when their revenue level is `none`. ScheduledScansService.scanBusiness also bridged
 * money health reasons verbatim into CommandItem.description (read under operations:read).
 *
 * THE RULE (D-259, D-100, D-234):
 *   - Readers holding settings scope without revenue:read (revenue:none, explicit scope map omitting
 *     revenue, or ADMIN with revenue:none) still receive the health response (200 / 201) with the
 *     exact unchanged money `score` and `status`, and all non-money areas unchanged, while the
 *     `money` area's `metrics` is `{}` and its `reasons` strips all amount-bearing, numeric, and
 *     cash/bills/overdue/tax-disclosing lines (preserving any non-money non-numeric reasons).
 *   - Persisted BusinessHealthSnapshot rows ALWAYS store the full unredacted metrics and reasons;
 *     projection happens purely at read/response time (never persisting redacted snapshots).
 *   - Owners, revenue:read members, ADMINs with default scopes, and platform SUPER_ADMINs receive
 *     the full `money` metrics and reasons with identical `score` and `status`.
 *   - ScheduledScansService.scanBusiness persists the full BusinessHealthSnapshot, and projects
 *     money reasons (no numbers/amounts/cash-balance text) before bridging into CommandItem.description.
 *   - Guards, JSON array permissionScopes (`[]`), cross-tenant callers, D-104 (ownerId without
 *     Membership), and unauthenticated requests keep their existing refusals (403 / 401).
 *
 * FIXTURES: every id has the `v98h_` prefix (test/helpers/fixture-prefixes.json, packet
 * 'V1-98 (FU-HEALTH-MONEY-SCOPE, P101)'); every User.email embeds it; every row is hard-deleted
 * with LIKE ${sqlLikePrefix(P)} in beforeAll and afterAll. No $transaction wrapping.
 *
 *   HMS-X01  fixture sanity
 *   HMS-A01  RED-BEFORE  GET .../health (cold start): settings:read + revenue:none / omitted revenue /
 *                        ADMIN revenue:none see unchanged score & status, metrics {}, zero digits or
 *                        money text in reasons, non-money areas unchanged, full DB snapshot persisted
 *   HMS-A02  RED-BEFORE  GET .../health (saved snapshots): same redaction from persisted snapshots
 *                        while preserving a non-money non-numeric reason and keeping DB snapshot full
 *   HMS-A03  RED-BEFORE  POST .../health/refresh: settings:write + revenue:none receives projected
 *                        money area (metrics {}, no digits/money text) while DB snapshot stays full
 *   HMS-A04  RED-BEFORE  ScheduledScansService.scanBusiness: bridged money health CommandItem
 *                        description has no digits/amounts/cash-balance text while DB snapshot is full
 *   HMS-B01  control     OWNER, STAFF revenue:read, ADMIN (defaults), SUPER_ADMIN see full money
 *                        metrics & reasons on GET (cold + saved) and POST .../refresh (where allowed)
 *   HMS-C01  pinned      STAFF with JSON array [], settings:read on refresh, cross-tenant owner,
 *                        D-104 ownerId without membership -> 403; unauthenticated -> 401
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL.
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v98h_';

const ID = {
  owner: `${P}owner`,                       // OWNER of bizA (Business.ownerId + OWNER membership)
  staffRevNone: `${P}staffRevNone`,         // STAFF, { settings: 'read', revenue: 'none' }
  staffOmitRev: `${P}staffOmitRev`,         // STAFF, { settings: 'read' } (explicit map omitting revenue)
  adminRevNone: `${P}adminRevNone`,         // ADMIN, ADMIN defaults with settings: 'admin', revenue: 'none'
  staffArray: `${P}staffArray`,             // STAFF, permissionScopes: [] (refused 403 settings:read)
  staffWriteRevNone: `${P}staffWrRevNone`,  // STAFF, { settings: 'write', revenue: 'none' }
  staffRevRead: `${P}staffRevRead`,         // STAFF, { settings: 'read', revenue: 'read' }
  adminDefault: `${P}adminDefault`,         // ADMIN, role defaults (settings: admin, revenue: admin)
  superAdmin: `${P}superAdmin`,             // User.role SUPER_ADMIN, no membership anywhere
  otherOwner: `${P}otherOwner`,             // OWNER of bizB; no membership in bizA
  orphanOwner: `${P}orphanOwner`,           // Business.ownerId of bizOrphan; NO membership (D-104)
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  bizOrphan: `${P}bizOrphan`,
  contact: `${P}contact`,
  coaBank: `${P}coa_bank`,
  faBank: `${P}fa_bank`,
  invoice: `${P}inv_overdue`,
  bill: `${P}exp_bill`,
  tax: `${P}tax_due`,
};

const USERS = [
  ID.owner,
  ID.staffRevNone,
  ID.staffOmitRev,
  ID.adminRevNone,
  ID.staffArray,
  ID.staffWriteRevNone,
  ID.staffRevRead,
  ID.adminDefault,
  ID.superAdmin,
  ID.otherOwner,
  ID.orphanOwner,
];

const emailOf = (id: string) => `${id}@v98h.test.local`;

const MONEY_LEAK_RE = /\d|cash balance|bills due|overdue invoices|tax due/i;

interface AreaResult {
  area: string;
  score: number;
  status: string;
  reasons: string[];
  metrics: Record<string, number | string>;
}

let db: any;
let app: any;
let scheduledScans: any;

async function cleanup() {
  for (const sql of [
    `DELETE FROM business_health_snapshots WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM command_items WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM business_signals WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM business_rules WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)} OR id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM expenses WHERE business_id LIKE ${sqlLikePrefix(P)} OR id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM tax_liabilities WHERE business_id LIKE ${sqlLikePrefix(P)} OR id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM financial_accounts WHERE business_id LIKE ${sqlLikePrefix(P)} OR id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM chart_of_accounts WHERE business_id LIKE ${sqlLikePrefix(P)} OR id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)} OR id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)} OR owner_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

async function clearRuntimeRows() {
  for (const sql of [
    `DELETE FROM business_health_snapshots WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM command_items WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM business_signals WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM business_rules WHERE business_id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    await db.$executeRawUnsafe(sql);
  }
}

const getHealth = (actor?: string, biz = ID.bizA) => {
  const req = request(app.getHttpServer()).get(`/intelligence/businesses/${biz}/health`);
  return actor ? req.set('x-test-user', actor) : req;
};

const refreshHealth = (actor?: string, biz = ID.bizA) => {
  const req = request(app.getHttpServer()).post(`/intelligence/businesses/${biz}/health/refresh`);
  return actor ? req.set('x-test-user', actor) : req;
};

const findArea = (body: AreaResult[], area: string): AreaResult => {
  const hit = body.find((a) => a.area === area);
  if (!hit) throw new Error(`Area ${area} missing from response`);
  return hit;
};

const nonMoneyAreas = (body: AreaResult[]) =>
  body.filter((a) => a.area !== 'money').sort((a, b) => a.area.localeCompare(b.area));

function assertMoneyWithheld(money: AreaResult, expectedReasons: string[] = []) {
  expect(money.metrics).toEqual({});
  expect(money.metrics).not.toHaveProperty('cashBalance');
  expect(money.metrics).not.toHaveProperty('cashCurrency');
  expect(money.metrics).not.toHaveProperty('overdueReceivables');
  expect(money.metrics).not.toHaveProperty('billsDue30');
  expect(money.metrics).not.toHaveProperty('taxDueSoon');
  expect(money.metrics).not.toHaveProperty('uncategorizedExpenses');
  expect(money.reasons).toEqual(expectedReasons);
  for (const r of money.reasons) {
    expect(r).not.toMatch(MONEY_LEAK_RE);
  }
}

function assertLiveMoneyFull(money: AreaResult) {
  expect(money.score).toBe(50);
  expect(money.status).toBe('AT_RISK');
  expect(money.metrics).toMatchObject({
    cashBalance: 1000,
    cashCurrency: 'TTD',
    overdueReceivables: 750,
    billsDue30: 650,
    uncategorizedExpenses: 1,
    taxDueSoon: 225,
  });
  expect(money.reasons.some((r) => r.includes('750.00'))).toBe(true);
  expect(money.reasons).toContain('Bills due exceed 50% of cash balance');
  expect(money.reasons.some((r) => r.includes('225.00'))).toBe(true);
  expect(money.reasons).toContain('1 uncategorized expenses');
}

async function latestDbMoneySnapshot(businessId = ID.bizA) {
  return db.businessHealthSnapshot.findFirst({
    where: { businessId, area: 'money' },
    orderBy: { calculatedAt: 'desc' },
  });
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { CashPositionService } = await import('../src/modules/finance/cash-position.service');
  const { IntelligenceController } = await import('../src/modules/intelligence/intelligence.controller');
  const { HealthScoreService } = await import('../src/modules/intelligence/health-score.service');
  const { RulesService } = await import('../src/modules/intelligence/rules.service');
  const { SignalsService } = await import('../src/modules/intelligence/signals.service');
  const { CommandBridgeService } = await import('../src/modules/intelligence/command-bridge.service');
  const { ScheduledScansService } = await import('../src/modules/intelligence/scheduled-scans.service');
  const { EntityResolverService } = await import('../src/modules/intelligence/entity-resolver.service');

  const moduleRef = await Test.createTestingModule({
    controllers: [IntelligenceController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      CashPositionService,
      HealthScoreService,
      RulesService,
      SignalsService,
      CommandBridgeService,
      ScheduledScansService,
      { provide: EntityResolverService, useValue: {} },
    ],
  }).compile();

  scheduledScans = moduleRef.get(ScheduledScansService);

  app = moduleRef.createNestApplication();
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
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
    await db.user.create({
      data: { id, email: emailOf(id), name: id, role: id === ID.superAdmin ? 'SUPER_ADMIN' : 'USER' },
    });
  }

  await db.business.create({ data: { id: ID.bizA, name: `${ID.bizA}-name`, ownerId: ID.owner, currency: 'TTD' } });
  await db.business.create({ data: { id: ID.bizB, name: `${ID.bizB}-name`, ownerId: ID.otherOwner, currency: 'TTD' } });
  await db.business.create({ data: { id: ID.bizOrphan, name: `${ID.bizOrphan}-name`, ownerId: ID.orphanOwner, currency: 'TTD' } });

  const { ROLE_DEFAULT_SCOPES } = await import('../src/core/authority/module-vocabulary');
  const memberships: Array<{
    userId: string;
    businessId: string;
    role: string;
    permissionScopes?: unknown;
  }> = [
    { userId: ID.owner, businessId: ID.bizA, role: 'OWNER' },
    { userId: ID.staffRevNone, businessId: ID.bizA, role: 'STAFF', permissionScopes: { settings: 'read', revenue: 'none' } },
    { userId: ID.staffOmitRev, businessId: ID.bizA, role: 'STAFF', permissionScopes: { settings: 'read' } },
    { userId: ID.adminRevNone, businessId: ID.bizA, role: 'ADMIN', permissionScopes: { ...ROLE_DEFAULT_SCOPES.ADMIN, settings: 'admin', revenue: 'none' } },
    { userId: ID.staffArray, businessId: ID.bizA, role: 'STAFF', permissionScopes: [] },
    { userId: ID.staffWriteRevNone, businessId: ID.bizA, role: 'STAFF', permissionScopes: { settings: 'write', revenue: 'none' } },
    { userId: ID.staffRevRead, businessId: ID.bizA, role: 'STAFF', permissionScopes: { settings: 'read', revenue: 'read' } },
    { userId: ID.adminDefault, businessId: ID.bizA, role: 'ADMIN' },
    { userId: ID.otherOwner, businessId: ID.bizB, role: 'OWNER' },
  ];
  for (const m of memberships) {
    await db.membership.create({
      data: {
        id: `${P}m_${m.userId.slice(P.length)}_${m.businessId.slice(P.length)}`,
        userId: m.userId,
        businessId: m.businessId,
        role: m.role,
        ...(m.permissionScopes !== undefined ? { permissionScopes: m.permissionScopes as any } : {}),
      },
    });
  }

  const now = Date.now();
  await db.contact.create({
    data: {
      id: ID.contact,
      businessId: ID.bizA,
      firstName: 'Test',
      lastName: 'Client',
      email: `${P}client@v98h.test.local`,
      status: 'CLIENT',
    },
  });
  await db.chartOfAccount.create({
    data: {
      id: ID.coaBank,
      businessId: ID.bizA,
      code: '1010',
      name: `${P}Bank`,
      type: 'ASSET',
      systemKey: 'BANK',
      isSystem: true,
    },
  });
  await db.financialAccount.create({
    data: {
      id: ID.faBank,
      businessId: ID.bizA,
      chartOfAccountId: ID.coaBank,
      name: `${P}Main Bank`,
      type: 'BANK',
      currency: 'TTD',
      openingBalance: 1000,
      currentBalance: 1000,
      isActive: true,
    },
  });
  await db.invoice.create({
    data: {
      id: ID.invoice,
      businessId: ID.bizA,
      contactId: ID.contact,
      invoiceNumber: `${P}INV-001`,
      status: 'SENT',
      subtotal: 750,
      total: 750,
      currency: 'TTD',
      dueDate: new Date(now - 10 * 86_400_000),
    },
  });
  await db.expense.create({
    data: {
      id: ID.bill,
      businessId: ID.bizA,
      description: `${P}vendor_bill`,
      amount: 650,
      currency: 'TTD',
      status: 'BILL',
      dueDate: new Date(now + 10 * 86_400_000),
      categoryId: null,
    },
  });
  await db.taxLiability.create({
    data: {
      id: ID.tax,
      businessId: ID.bizA,
      type: 'VAT',
      periodStart: new Date(now - 30 * 86_400_000),
      periodEnd: new Date(now - 86_400_000),
      amountDue: 225,
      dueDate: new Date(now + 7 * 86_400_000),
      status: 'OPEN',
    },
  });
}, 60_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
});

beforeEach(async () => {
  await clearRuntimeRows();
});

describe('FU-HEALTH-MONEY-SCOPE (P101, D-259/D-100/D-234): money health projection for readers without revenue:read', () => {
  it('HMS-X01 fixture sanity: memberships, cash account, overdue invoice, upcoming bill, tax liability', async () => {
    expect(await db.membership.count({ where: { businessId: ID.bizA } })).toBe(8);
    expect(await db.membership.count({ where: { businessId: ID.bizOrphan } })).toBe(0);
    expect(await db.businessHealthSnapshot.count({ where: { businessId: ID.bizA } })).toBe(0);
    expect(await db.invoice.count({ where: { id: ID.invoice, status: 'SENT' } })).toBe(1);
    expect(await db.expense.count({ where: { id: ID.bill, status: 'BILL', categoryId: null } })).toBe(1);
    expect(await db.taxLiability.count({ where: { id: ID.tax, status: 'OPEN' } })).toBe(1);
  });

  it.each([
    ['STAFF { settings: read, revenue: none }', ID.staffRevNone],
    ['STAFF { settings: read } (explicit map omitting revenue)', ID.staffOmitRev],
    ['ADMIN { settings: admin, revenue: none }', ID.adminRevNone],
  ])(
    'HMS-A01 RED-BEFORE: GET .../health cold start withholds money metrics and amount reasons for %s while persisting full snapshot',
    async (_label, actor) => {
      // Owner baseline first, then clear snapshots so the non-revenue reader hits the cold-start path.
      const ownerRes = await getHealth(ID.owner);
      expect(ownerRes.status, JSON.stringify(ownerRes.body)).toBe(200);
      const ownerMoney = findArea(ownerRes.body, 'money');
      assertLiveMoneyFull(ownerMoney);
      const ownerNonMoney = nonMoneyAreas(ownerRes.body);

      await clearRuntimeRows();

      const res = await getHealth(actor);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const money = findArea(res.body, 'money');
      expect(money.score).toBe(ownerMoney.score);
      expect(money.status).toBe(ownerMoney.status);
      assertMoneyWithheld(money, []);
      expect(nonMoneyAreas(res.body)).toEqual(ownerNonMoney);

      // The cold-start write MUST persist the full unredacted money snapshot in Postgres.
      const snap = await latestDbMoneySnapshot();
      expect(snap).toBeTruthy();
      expect(snap.score).toBe(50);
      expect(snap.status).toBe('AT_RISK');
      expect(snap.metrics).toMatchObject({
        cashBalance: 1000,
        cashCurrency: 'TTD',
        overdueReceivables: 750,
        billsDue30: 650,
        uncategorizedExpenses: 1,
        taxDueSoon: 225,
      });
      expect((snap.reasons as string[]).some((r) => r.includes('750.00'))).toBe(true);
      expect(snap.reasons).toContain('Bills due exceed 50% of cash balance');
    },
  );

  it.each([
    ['STAFF { settings: read, revenue: none }', ID.staffRevNone],
    ['STAFF { settings: read } (explicit map omitting revenue)', ID.staffOmitRev],
    ['ADMIN { settings: admin, revenue: none }', ID.adminRevNone],
  ])(
    'HMS-A02 RED-BEFORE: GET .../health from saved snapshots withholds money figures/reasons for %s, preserves non-money reason, keeps DB snapshot full',
    async (_label, actor) => {
      const savedMoneyMetrics = {
        cashBalance: -150,
        cashCurrency: 'TTD',
        overdueReceivables: 500,
        billsDue30: 300,
        uncategorizedExpenses: 2,
        taxDueSoon: 100,
      };
      const savedMoneyReasons = [
        '3 overdue invoices totaling 500.00',
        'Bills due exceed 50% of cash balance',
        '2 uncategorized expenses',
        'Tax due soon: 100.00',
        'Negative cash balance',
        'Bookkeeping review recommended',
      ];
      await db.businessHealthSnapshot.create({
        data: {
          businessId: ID.bizA,
          area: 'money',
          score: 35,
          status: 'CRITICAL',
          reasons: savedMoneyReasons,
          metrics: savedMoneyMetrics,
        },
      });
      await db.businessHealthSnapshot.create({
        data: {
          businessId: ID.bizA,
          area: 'time',
          score: 80,
          status: 'HEALTHY',
          reasons: ['2 overdue tasks'],
          metrics: { overdueTasks: 2, upcomingBookings: 1, unconfirmedBookings: 0 },
        },
      });

      const res = await getHealth(actor);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const money = findArea(res.body, 'money');
      expect(money.score).toBe(35);
      expect(money.status).toBe('CRITICAL');
      assertMoneyWithheld(money, ['Bookkeeping review recommended']);

      const time = findArea(res.body, 'time');
      expect(time).toEqual({
        area: 'time',
        score: 80,
        status: 'HEALTHY',
        reasons: ['2 overdue tasks'],
        metrics: { overdueTasks: 2, upcomingBookings: 1, unconfirmedBookings: 0 },
      });

      // Persisted snapshot in DB remains completely intact.
      const snap = await latestDbMoneySnapshot();
      expect(snap.metrics).toEqual(savedMoneyMetrics);
      expect(snap.reasons).toEqual(savedMoneyReasons);
    },
  );

  it('HMS-A03 RED-BEFORE: POST .../health/refresh returns projected money area to settings:write + revenue:none while persisting full snapshot', async () => {
    const res = await refreshHealth(ID.staffWriteRevNone);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const money = findArea(res.body, 'money');
    expect(money.score).toBe(50);
    expect(money.status).toBe('AT_RISK');
    assertMoneyWithheld(money, []);

    const time = findArea(res.body, 'time');
    expect(time.metrics).toHaveProperty('overdueTasks');

    // Full snapshot persisted in Postgres for owner / revenue readers.
    const snap = await latestDbMoneySnapshot();
    expect(snap).toBeTruthy();
    expect(snap.score).toBe(50);
    expect(snap.metrics).toMatchObject({
      cashBalance: 1000,
      cashCurrency: 'TTD',
      overdueReceivables: 750,
      billsDue30: 650,
      uncategorizedExpenses: 1,
      taxDueSoon: 225,
    });
    expect((snap.reasons as string[]).some((r) => r.includes('750.00'))).toBe(true);
    expect((snap.reasons as string[]).some((r) => r.includes('225.00'))).toBe(true);
  });

  it('HMS-A04 RED-BEFORE: ScheduledScansService.scanBusiness projects money health reasons before bridging into CommandItem while keeping full DB snapshot', async () => {
    await scheduledScans.scanBusiness(ID.bizA);

    const healthCmd = await db.commandItem.findFirst({
      where: {
        businessId: ID.bizA,
        sourceModule: 'intelligence',
        sourceType: 'health',
        actionType: 'REVIEW_HEALTH',
      },
    });
    expect(healthCmd).toBeTruthy();
    expect(healthCmd.category).toBe('MONEY');
    expect(healthCmd.title).toBe('money health is at_risk');
    expect(healthCmd.description ?? '').not.toMatch(MONEY_LEAK_RE);

    const snap = await latestDbMoneySnapshot();
    expect(snap).toBeTruthy();
    expect(snap.metrics).toMatchObject({
      cashBalance: 1000,
      cashCurrency: 'TTD',
      overdueReceivables: 750,
      billsDue30: 650,
      uncategorizedExpenses: 1,
      taxDueSoon: 225,
    });
    expect((snap.reasons as string[]).some((r) => r.includes('750.00'))).toBe(true);
  });

  it.each([
    ['OWNER (with membership)', ID.owner, true],
    ['STAFF { settings: read, revenue: read }', ID.staffRevRead, false],
    ['ADMIN (role defaults)', ID.adminDefault, true],
    ['SUPER_ADMIN (no membership)', ID.superAdmin, true],
  ])(
    'HMS-B01 control: %s sees full money metrics and reasons on GET (cold + saved) and POST refresh (when permitted)',
    async (_label, actor, canRefresh) => {
      // Cold-start GET
      const coldRes = await getHealth(actor);
      expect(coldRes.status, JSON.stringify(coldRes.body)).toBe(200);
      assertLiveMoneyFull(findArea(coldRes.body, 'money'));

      // Saved-snapshot GET (now reading the persisted snapshot)
      const savedRes = await getHealth(actor);
      expect(savedRes.status, JSON.stringify(savedRes.body)).toBe(200);
      assertLiveMoneyFull(findArea(savedRes.body, 'money'));

      // Refresh (only for actors with settings:write)
      if (canRefresh) {
        const refRes = await refreshHealth(actor);
        expect(refRes.status, JSON.stringify(refRes.body)).toBe(201);
        assertLiveMoneyFull(findArea(refRes.body, 'money'));
      }
    },
  );

  it('HMS-C01 pinned: JSON array scopes, missing settings:write on refresh, cross-tenant, D-104 ownerId without membership -> 403; unauthenticated -> 401', async () => {
    const arrRes = await getHealth(ID.staffArray);
    expect(arrRes.status, JSON.stringify(arrRes.body)).toBe(403);
    expect(arrRes.body?.message).toBe('Insufficient permissions: settings requires read access (you have none)');

    const readOnRefresh = await refreshHealth(ID.staffRevRead);
    expect(readOnRefresh.status, JSON.stringify(readOnRefresh.body)).toBe(403);
    expect(readOnRefresh.body?.message).toBe('Insufficient permissions: settings requires write access (you have read)');

    const crossGet = await getHealth(ID.otherOwner, ID.bizA);
    expect(crossGet.status, JSON.stringify(crossGet.body)).toBe(403);
    const crossRefresh = await refreshHealth(ID.otherOwner, ID.bizA);
    expect(crossRefresh.status, JSON.stringify(crossRefresh.body)).toBe(403);

    const orphanGet = await getHealth(ID.orphanOwner, ID.bizOrphan);
    expect(orphanGet.status, JSON.stringify(orphanGet.body)).toBe(403);
    const orphanRefresh = await refreshHealth(ID.orphanOwner, ID.bizOrphan);
    expect(orphanRefresh.status, JSON.stringify(orphanRefresh.body)).toBe(403);

    const unauthGet = await getHealth(undefined, ID.bizA);
    expect(unauthGet.status, JSON.stringify(unauthGet.body)).toBe(401);
    const unauthRefresh = await refreshHealth(undefined, ID.bizA);
    expect(unauthRefresh.status, JSON.stringify(unauthRefresh.body)).toBe(401);
  });
});
