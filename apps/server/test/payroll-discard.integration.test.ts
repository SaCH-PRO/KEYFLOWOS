/**
 * P59 — V1-65 (TOF-PAYROLL-DISCARD, D-144, server side):
 * `POST /payroll/businesses/:businessId/runs/:runId/discard`
 *
 * The payroll page is hidden in v1 (payroll ruling) and KEY loses its payroll
 * write tools, yet DRAFT and APPROVED runs still reserve safe-to-spend (D-144).
 * This route lets an operator with `operations:write` discard:
 *   - any unposted DRAFT run (business currency or foreign currency), or
 *   - any unposted legacy APPROVED run in a non-business currency (run currency
 *     or any line item currency != Business.currency, D-13/D-144)
 * transitioning it atomically to `VOID` with server-derived actor and sanitized
 * reason recorded on the run and in `activities`, releasing safe-to-spend and
 * invalidating the business financial snapshot cache.
 *
 * Refuses `409 Conflict` for PAID runs, any run with a ledger posting
 * (`FinancialTransaction` with `sourceType='PayrollRun', sourceId=runId`),
 * same-currency APPROVED runs, and already-VOID runs. Refuses `403` for
 * `operations:read` and non-members (including memberless SUPER_ADMIN /
 * `Business.ownerId`-only callers, D-46/D-104).
 *
 * REAL Postgres database, REAL PayrollController, AuthGuard, BusinessGuard,
 * ModuleScopeGuard, PayrollService, SafeToSpendService, CashPositionService,
 * BusinessGraphService, ExpensePostingService, PostingService.
 * Fixtures use prefix `v65g_` and are hard-deleted with `sqlLikePrefix(P)`.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 90_000 });

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v65g_';
const HEADER = 'x-v65g-user';

const ID = {
  ownerA: `${P}ownerA`,
  opsWrite: `${P}opsWrite`,
  opsRead: `${P}opsRead`,
  memberlessOwner: `${P}memberlessOwner`,
  superAdmin: `${P}superAdmin`,
  ownerB: `${P}ownerB`,
  bizA: `${P}bizA`,
  bizNoMember: `${P}bizNoMember`,
  bizB: `${P}bizB`,
  orgUnitA: `${P}orgUnitA`,
  assignA: `${P}assignA`,
};

/* eslint-disable @typescript-eslint/no-explicit-any */
let db: any;
let app: any;
let safeToSpend: any;
let businessGraph: any;
let payrollService: any;
let expensePosting: any;
let invalidateSnapshotCache: (businessId: string) => void;
/* eslint-enable @typescript-eslint/no-explicit-any */

const userRoles = new Map<string, string>();

async function cleanup() {
  for (const sql of [
    `DELETE FROM ledger_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `UPDATE financial_transactions SET reversal_of_id = NULL WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM financial_transactions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM accounting_periods WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM activities WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payroll_items WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payroll_runs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM pay_rates WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM org_assignments WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM org_units WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM financial_accounts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM chart_of_accounts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try {
      await db.$executeRawUnsafe(sql);
    } catch {
      /* table absent on this schema has nothing of ours */
    }
  }
}

function discardReq(
  actor: string | null,
  businessId: string,
  runId: string,
  body?: Record<string, unknown>,
) {
  const req = request(app.getHttpServer()).post(
    `/payroll/businesses/${businessId}/runs/${runId}/discard`,
  );
  if (actor) req.set(HEADER, actor);
  return body !== undefined ? req.send(body) : req.send({});
}

function approveReq(actor: string, businessId: string, runId: string) {
  return request(app.getHttpServer())
    .post(`/payroll/businesses/${businessId}/runs/${runId}/approve`)
    .set(HEADER, actor)
    .send({});
}

function markPaidReq(actor: string, businessId: string, runId: string, body: Record<string, unknown>) {
  return request(app.getHttpServer())
    .post(`/payroll/businesses/${businessId}/runs/${runId}/mark-paid`)
    .set(HEADER, actor)
    .send(body);
}

let runSeq = 0;
async function seedRun(opts: {
  businessId?: string;
  status: string;
  currency: string;
  totalGross?: number;
  notes?: string | null;
  itemCurrencies?: string[];
  paidAt?: Date | null;
  approvedAt?: Date | null;
  periodDayOffset?: number;
}) {
  runSeq += 1;
  const businessId = opts.businessId ?? ID.bizA;
  const day = opts.periodDayOffset ?? runSeq;
  const periodStart = new Date(Date.UTC(2026, 0, day, 0, 0, 0));
  const periodEnd = new Date(Date.UTC(2026, 0, day, 23, 59, 59));
  const gross = opts.totalGross ?? 2500;
  const itemCurrencies = opts.itemCurrencies ?? [opts.currency];
  const runId = `${P}run_${runSeq}`;

  return db.payrollRun.create({
    data: {
      id: runId,
      businessId,
      periodStart,
      periodEnd,
      status: opts.status,
      totalGross: gross,
      currency: opts.currency,
      itemCount: itemCurrencies.length,
      notes: opts.notes ?? null,
      approvedAt: opts.approvedAt ?? (opts.status === 'APPROVED' || opts.status === 'PAID' ? new Date() : null),
      paidAt: opts.paidAt ?? (opts.status === 'PAID' ? new Date() : null),
      items: {
        create: itemCurrencies.map((currency, idx) => ({
          id: `${runId}_i${idx}`,
          businessId,
          assignmentId: ID.assignA,
          grossPay: idx === 0 ? gross : 0,
          currency,
          notes: 'Seeded payroll line',
        })),
      },
    },
    include: { items: true },
  });
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { ChartOfAccountsSeederService } = await import('../src/modules/finance/chart-of-accounts-seeder.service');
  const { AccountingPeriodService } = await import('../src/modules/finance/accounting-period.service');
  const { PostingService } = await import('../src/modules/finance/posting.service');
  const { ExpensePostingService } = await import('../src/modules/finance/expense-posting.service');
  const { CashPositionService } = await import('../src/modules/finance/cash-position.service');
  const { SafeToSpendService } = await import('../src/modules/finance/safe-to-spend.service');
  const { BusinessGraphService } = await import('../src/modules/ai/business-graph.service');
  const { PayrollController } = await import('../src/modules/payroll/payroll.controller');
  const { PayrollService } = await import('../src/modules/payroll/payroll.service');

  const moduleRef = await Test.createTestingModule({
    controllers: [PayrollController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      ChartOfAccountsSeederService,
      AccountingPeriodService,
      PostingService,
      ExpensePostingService,
      CashPositionService,
      SafeToSpendService,
      BusinessGraphService,
      PayrollService,
    ],
  }).compile();

  app = moduleRef.createNestApplication();
  app.use((req: any, _res: any, next: () => void) => {
    const uid = req.headers[HEADER];
    if (typeof uid === 'string' && uid.trim()) {
      req.user = { id: uid.trim(), role: userRoles.get(uid.trim()) ?? 'USER' };
    }
    next();
  });
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  await app.init();

  const { invalidateBusinessFinancialSnapshotCache } = await import('../src/modules/finance/finance-accounting.util');
  invalidateSnapshotCache = invalidateBusinessFinancialSnapshotCache;

  safeToSpend = moduleRef.get(SafeToSpendService);
  businessGraph = moduleRef.get(BusinessGraphService);
  payrollService = moduleRef.get(PayrollService);
  expensePosting = moduleRef.get(ExpensePostingService);

  await cleanup();

  const users: Array<[string, string, string]> = [
    [ID.ownerA, `${P}owner-a@example.test`, 'USER'],
    [ID.opsWrite, `${P}ops-write@example.test`, 'USER'],
    [ID.opsRead, `${P}ops-read@example.test`, 'USER'],
    [ID.memberlessOwner, `${P}memberless@example.test`, 'USER'],
    [ID.superAdmin, `${P}superadmin@example.test`, 'SUPER_ADMIN'],
    [ID.ownerB, `${P}owner-b@example.test`, 'USER'],
  ];
  for (const [id, email, role] of users) {
    userRoles.set(id, role);
    await db.user.create({ data: { id, email, role } });
  }

  await db.business.create({
    data: { id: ID.bizA, name: 'V65G TTD Studio', slug: `${P}biz-a`, ownerId: ID.ownerA, currency: 'TTD' },
  });
  await db.business.create({
    data: { id: ID.bizNoMember, name: 'V65G Memberless', slug: `${P}biz-nomem`, ownerId: ID.memberlessOwner, currency: 'TTD' },
  });
  await db.business.create({
    data: { id: ID.bizB, name: 'V65G Other Biz', slug: `${P}biz-b`, ownerId: ID.ownerB, currency: 'TTD' },
  });

  await db.membership.create({
    data: { id: `${P}m_ownerA`, userId: ID.ownerA, businessId: ID.bizA, role: 'OWNER' },
  });
  await db.membership.create({
    data: {
      id: `${P}m_opsWrite`,
      userId: ID.opsWrite,
      businessId: ID.bizA,
      role: 'STAFF',
      permissionScopes: { operations: 'write', expenses: 'none', revenue: 'read' },
    },
  });
  await db.membership.create({
    data: {
      id: `${P}m_opsRead`,
      userId: ID.opsRead,
      businessId: ID.bizA,
      role: 'STAFF',
      permissionScopes: { operations: 'read', expenses: 'write', revenue: 'read' },
    },
  });
  await db.membership.create({
    data: { id: `${P}m_ownerB`, userId: ID.ownerB, businessId: ID.bizB, role: 'OWNER' },
  });

  await db.orgUnit.create({
    data: { id: ID.orgUnitA, businessId: ID.bizA, name: 'Operations', type: 'DEPARTMENT' },
  });
  await db.orgAssignment.create({
    data: { id: ID.assignA, businessId: ID.bizA, orgUnitId: ID.orgUnitA, contactName: 'Keisha Staff' },
  });
  await db.payRate.create({
    data: {
      id: `${P}rate_a`,
      businessId: ID.bizA,
      assignmentId: ID.assignA,
      amount: 2500,
      currency: 'TTD',
      periodType: 'monthly',
    },
  });
});

beforeEach(async () => {
  await db.$executeRawUnsafe(`DELETE FROM ledger_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`);
  await db.$executeRawUnsafe(`UPDATE financial_transactions SET reversal_of_id = NULL WHERE business_id LIKE ${sqlLikePrefix(P)}`);
  await db.$executeRawUnsafe(`DELETE FROM financial_transactions WHERE business_id LIKE ${sqlLikePrefix(P)}`);
  await db.$executeRawUnsafe(`DELETE FROM activities WHERE business_id LIKE ${sqlLikePrefix(P)}`);
  await db.$executeRawUnsafe(`DELETE FROM payroll_items WHERE business_id LIKE ${sqlLikePrefix(P)}`);
  await db.$executeRawUnsafe(`DELETE FROM payroll_runs WHERE business_id LIKE ${sqlLikePrefix(P)}`);
  invalidateSnapshotCache(ID.bizA);
});

afterAll(async () => {
  await cleanup();
  if (app) await app.close();
});

describe('P59 — V1-65 (TOF-PAYROLL-DISCARD, D-144): POST /payroll/businesses/:businessId/runs/:runId/discard', () => {
  it('PD-01 RED-BEFORE: discarding a DRAFT run transitions it to VOID with server actor & reason, writes Activity audit, and drops safe-to-spend + KEY committed payroll', async () => {
    const run = await seedRun({
      status: 'DRAFT',
      currency: 'TTD',
      totalGross: 2500,
      notes: 'Initial draft note',
    });

    const beforeS2S = await safeToSpend.calculate(ID.bizA);
    expect(beforeS2S.payrollReserved).toBe(2500);
    const beforeGraph = await businessGraph.getSnapshotForViewer(ID.bizA, ID.ownerA);
    expect(beforeGraph.treasury?.committedPayrollAmount).toBe(2500);

    const res = await discardReq(ID.ownerA, ID.bizA, run.id, {
      reason: 'Wrong period entered',
      actorId: 'forged_actor_must_be_ignored',
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      id: run.id,
      status: 'VOID',
      totalGross: 2500,
      discardedById: ID.ownerA,
      discardReason: 'Wrong period entered',
    });
    expect(typeof res.body.discardedAt).toBe('string');

    const stored = await db.payrollRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(stored.status).toBe('VOID');
    expect(stored.notes).toContain('Initial draft note');
    expect(stored.notes).toContain(ID.ownerA);
    expect(stored.notes).toContain('Wrong period entered');
    expect(stored.notes).not.toContain('forged_actor_must_be_ignored');

    const auditRows = await db.activity.findMany({
      where: { businessId: ID.bizA, entityType: 'payroll_run', entityId: run.id, type: 'payroll_run.discarded' },
    });
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].actorId).toBe(ID.ownerA);
    expect(auditRows[0].detail).toBe('Wrong period entered');
    expect(auditRows[0].data).toMatchObject({
      previousStatus: 'DRAFT',
      actorId: ID.ownerA,
      reason: 'Wrong period entered',
      currency: 'TTD',
      totalGross: 2500,
    });

    const afterS2S = await safeToSpend.calculate(ID.bizA);
    expect(afterS2S.payrollReserved).toBe(0);
    const afterGraph = await businessGraph.getSnapshotForViewer(ID.bizA, ID.ownerA);
    expect(afterGraph.treasury?.committedPayrollAmount).toBe(0);

    // Period overlap check ignores VOID runs, so regenerating for the same period works.
    const regen = await payrollService.generateRun(ID.bizA, run.periodStart, run.periodEnd);
    expect(regen.status).toBe('DRAFT');
  });

  it('PD-02 RED-BEFORE: legacy runs in a non-business currency (USD DRAFT, USD APPROVED, or TTD APPROVED with USD item in a TTD business) with no posting discard to VOID and drop otherCurrencyPayroll', async () => {
    const usdDraft = await seedRun({ status: 'DRAFT', currency: 'USD', totalGross: 800, periodDayOffset: 10 });
    const usdApproved = await seedRun({ status: 'APPROVED', currency: 'USD', totalGross: 1200, periodDayOffset: 11 });
    const mixedApproved = await seedRun({
      status: 'APPROVED',
      currency: 'TTD',
      totalGross: 500,
      itemCurrencies: ['TTD', 'USD'],
      periodDayOffset: 12,
    });

    const before = await safeToSpend.calculate(ID.bizA);
    expect(before.otherCurrencyPayroll).toEqual([{ currency: 'USD', amount: 2000 }]);
    expect(before.payrollReserved).toBe(500);

    for (const [target, reason] of [
      [usdDraft, 'Legacy USD draft cleanup'],
      [usdApproved, 'Legacy USD approved cleanup (D-144)'],
      [mixedApproved, 'Mixed-currency approved run cleanup'],
    ] as const) {
      const res = await discardReq(ID.ownerA, ID.bizA, target.id, { reason });
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('VOID');
      const row = await db.payrollRun.findUniqueOrThrow({ where: { id: target.id } });
      expect(row.status).toBe('VOID');
      expect(row.notes).toContain(reason);
    }

    const after = await safeToSpend.calculate(ID.bizA);
    expect(after.otherCurrencyPayroll).toEqual([]);
    expect(after.payrollReserved).toBe(0);
  });

  it('PD-03 RED-BEFORE: refuses PAID runs, posted runs, same-currency APPROVED runs, and already-VOID runs with 409 and leaves DB untouched', async () => {
    const paidRun = await seedRun({ status: 'PAID', currency: 'TTD', totalGross: 1500, periodDayOffset: 20 });
    const sameCurrencyApproved = await seedRun({ status: 'APPROVED', currency: 'TTD', totalGross: 1800, periodDayOffset: 21 });
    const postedForeignApproved = await seedRun({ status: 'APPROVED', currency: 'USD', totalGross: 900, periodDayOffset: 22 });
    const alreadyVoid = await seedRun({ status: 'VOID', currency: 'TTD', totalGross: 400, notes: 'Original void note', periodDayOffset: 23 });

    // Post a real ledger transaction linked to postedForeignApproved (simulating a posted run).
    await expensePosting.onPayrollRunPaid({
      id: postedForeignApproved.id,
      businessId: ID.bizA,
      totalGross: 900,
      currency: 'USD',
      paidAt: new Date('2026-01-22T12:00:00Z'),
      periodStart: postedForeignApproved.periodStart,
      periodEnd: postedForeignApproved.periodEnd,
      paymentMethod: 'bank_transfer',
      actorId: ID.ownerA,
    });

    for (const target of [paidRun, sameCurrencyApproved, postedForeignApproved, alreadyVoid]) {
      const res = await discardReq(ID.ownerA, ID.bizA, target.id, { reason: 'Should be refused' });
      expect(res.status).toBe(409);
    }

    expect((await db.payrollRun.findUniqueOrThrow({ where: { id: paidRun.id } })).status).toBe('PAID');
    expect((await db.payrollRun.findUniqueOrThrow({ where: { id: sameCurrencyApproved.id } })).status).toBe('APPROVED');
    expect((await db.payrollRun.findUniqueOrThrow({ where: { id: postedForeignApproved.id } })).status).toBe('APPROVED');
    const voidRow = await db.payrollRun.findUniqueOrThrow({ where: { id: alreadyVoid.id } });
    expect(voidRow.status).toBe('VOID');
    expect(voidRow.notes).toBe('Original void note');

    const auditCount = await db.activity.count({
      where: { businessId: ID.bizA, type: 'payroll_run.discarded' },
    });
    expect(auditCount).toBe(0);
  });

  it('PD-04 RED-BEFORE: enforces operations:write, D-46/D-104 membership, and tenant isolation', async () => {
    const runA = await seedRun({ status: 'DRAFT', currency: 'TTD', totalGross: 1000, periodDayOffset: 25 });
    const runMemberless = await seedRun({
      businessId: ID.bizNoMember,
      status: 'DRAFT',
      currency: 'TTD',
      totalGross: 700,
      periodDayOffset: 26,
    });

    // Unauthenticated -> 401
    expect((await discardReq(null, ID.bizA, runA.id, { reason: 'No auth' })).status).toBe(401);

    // operations:read (even with expenses:write) -> 403
    expect((await discardReq(ID.opsRead, ID.bizA, runA.id, { reason: 'Read only' })).status).toBe(403);

    // Platform SUPER_ADMIN without Membership in bizA -> 403 (D-46/D-104)
    expect((await discardReq(ID.superAdmin, ID.bizA, runA.id, { reason: 'SA no membership' })).status).toBe(403);

    // Recorded Business.ownerId with no Membership row -> 403 (D-104)
    expect((await discardReq(ID.memberlessOwner, ID.bizNoMember, runMemberless.id, { reason: 'OwnerId only' })).status).toBe(403);

    // Cross-tenant: ownerB asking under bizB for bizA's run -> 404; asking under bizA -> 403
    expect((await discardReq(ID.ownerB, ID.bizB, runA.id, { reason: 'Cross tenant B' })).status).toBe(404);
    expect((await discardReq(ID.ownerB, ID.bizA, runA.id, { reason: 'Cross tenant A' })).status).toBe(403);

    // Run is still DRAFT after all refused attempts
    expect((await db.payrollRun.findUniqueOrThrow({ where: { id: runA.id } })).status).toBe('DRAFT');

    // Member with operations:write (even with expenses:none) -> succeeds (201)
    const okRes = await discardReq(ID.opsWrite, ID.bizA, runA.id, { reason: 'Ops write member discard' });
    expect(okRes.status).toBe(201);
    expect(okRes.body.status).toBe('VOID');
    expect(okRes.body.discardedById).toBe(ID.opsWrite);
  });

  it('PD-05 RED-BEFORE: validates/sanitizes reason deterministically (surrogates, C0/C1/BiDi, default fallback) and handles concurrent discard calls atomically via CAS', async () => {
    const runSanitize = await seedRun({ status: 'DRAFT', currency: 'TTD', totalGross: 1100, periodDayOffset: 27 });
    const runDefault = await seedRun({ status: 'DRAFT', currency: 'TTD', totalGross: 600, periodDayOffset: 28 });
    const runConcurrent = await seedRun({ status: 'DRAFT', currency: 'TTD', totalGross: 950, periodDayOffset: 29 });

    // Non-string reason -> 400
    expect((await discardReq(ID.ownerA, ID.bizA, runSanitize.id, { reason: 12345 as unknown as string })).status).toBe(400);
    // Overlong reason (> 500 chars) -> 400
    expect((await discardReq(ID.ownerA, ID.bizA, runSanitize.id, { reason: 'x'.repeat(501) })).status).toBe(400);
    // Unpaired UTF-16 surrogates -> 400 (SEC-P59-2, never 500 on DB write)
    expect((await discardReq(ID.ownerA, ID.bizA, runSanitize.id, { reason: 'bad \ud800 high' })).status).toBe(400);
    expect((await discardReq(ID.ownerA, ID.bizA, runSanitize.id, { reason: 'bad \udfff low' })).status).toBe(400);

    // Deterministic C0, C1 (U+009B), and BiDi override (U+202E) sanitization (COR-P59-2, SEC-P59-2).
    const sanRes = await discardReq(ID.ownerA, ID.bizA, runSanitize.id, {
      reason: 'Line 1\r\nLine 2\t\u0007\u009b\u202eok',
    });
    expect(sanRes.status).toBe(201);
    expect(sanRes.body.discardReason).toBe('Line 1 Line 2 ok');
    const sanRow = await db.payrollRun.findUniqueOrThrow({ where: { id: runSanitize.id } });
    expect(sanRow.notes).toContain(': Line 1 Line 2 ok]');
    const sanAct = await db.activity.findFirstOrThrow({
      where: { businessId: ID.bizA, entityId: runSanitize.id, type: 'payroll_run.discarded' },
    });
    expect(sanAct.detail).toBe('Line 1 Line 2 ok');

    // Deterministic whitespace-only reason falls back to 'Discarded by operator'.
    const defRes = await discardReq(ID.ownerA, ID.bizA, runDefault.id, { reason: '   \t\r\n  ' });
    expect(defRes.status).toBe(201);
    expect(defRes.body.discardReason).toBe('Discarded by operator');

    // Concurrent discards on the same DRAFT run: exactly one wins (201), one loses (409), one Activity row.
    const [r1, r2] = await Promise.all([
      discardReq(ID.ownerA, ID.bizA, runConcurrent.id, { reason: 'First caller' }),
      discardReq(ID.opsWrite, ID.bizA, runConcurrent.id, { reason: 'Second caller' }),
    ]);
    const statuses = [r1.status, r2.status].sort((a, b) => a - b);
    expect(statuses).toEqual([201, 409]);

    const winner = r1.status === 201 ? r1.body : r2.body;
    expect(winner.status).toBe('VOID');

    const audits = await db.activity.findMany({
      where: { businessId: ID.bizA, entityType: 'payroll_run', entityId: runConcurrent.id, type: 'payroll_run.discarded' },
    });
    expect(audits).toHaveLength(1);
  });

  it('PD-06 (SEC-P59-1 / COR-P59-1): concurrent approveRun vs discardRun is mutually exclusive — VOID is never resurrected to APPROVED', async () => {
    for (let i = 0; i < 4; i += 1) {
      const run = await seedRun({
        status: 'DRAFT',
        currency: 'TTD',
        totalGross: 1300,
        periodDayOffset: 40 + i,
      });

      const [appRes, discRes] = await Promise.all([
        approveReq(ID.ownerA, ID.bizA, run.id),
        discardReq(ID.opsWrite, ID.bizA, run.id, { reason: `Race iteration ${i}` }),
      ]);

      // Exactly one transition may succeed (201); the loser must be refused (400 or 409).
      const winners = [appRes.status, discRes.status].filter((s) => s === 201);
      const losers = [appRes.status, discRes.status].filter((s) => s !== 201);
      expect(winners).toHaveLength(1);
      expect(losers).toHaveLength(1);
      expect([400, 409]).toContain(losers[0]);

      const stored = await db.payrollRun.findUniqueOrThrow({ where: { id: run.id } });
      const audits = await db.activity.findMany({
        where: { businessId: ID.bizA, entityType: 'payroll_run', entityId: run.id, type: 'payroll_run.discarded' },
      });

      if (discRes.status === 201) {
        expect(stored.status).toBe('VOID');
        expect(stored.notes).toContain('[VOIDED by');
        expect(audits).toHaveLength(1);
      } else {
        expect(stored.status).toBe('APPROVED');
        expect(stored.notes ?? '').not.toContain('[VOIDED by');
        expect(audits).toHaveLength(0);
      }
    }
  });

  it('PD-07 (COR-P59-3): markRunPaid rejects VOID cleanly (400), empty-items & padded/lowercase foreign currency discard cleanly, and REVERSED posting refuses with 409', async () => {
    // 1. Empty items (itemCount: 0) DRAFT run discards cleanly, and markRunPaid on VOID returns 400 with 0 ledger rows.
    const emptyDraft = await seedRun({
      status: 'DRAFT',
      currency: 'TTD',
      totalGross: 0,
      itemCurrencies: [],
      periodDayOffset: 50,
    });
    const emptyRes = await discardReq(ID.ownerA, ID.bizA, emptyDraft.id);
    expect(emptyRes.status).toBe(201);
    expect(emptyRes.body.status).toBe('VOID');
    expect(emptyRes.body.discardReason).toBe('Discarded by operator');

    const payVoidRes = await markPaidReq(ID.ownerA, ID.bizA, emptyDraft.id, { paymentMethod: 'bank_transfer' });
    expect(payVoidRes.status).toBe(400);
    const voidPostings = await db.financialTransaction.count({
      where: { businessId: ID.bizA, sourceType: 'PayrollRun', sourceId: emptyDraft.id },
    });
    expect(voidPostings).toBe(0);

    // 2. Lowercase/padded foreign currency (' usd ') APPROVED run in TTD business discards cleanly.
    const paddedUsd = await seedRun({
      status: 'APPROVED',
      currency: ' usd ',
      totalGross: 450,
      itemCurrencies: [' usd '],
      periodDayOffset: 51,
    });
    const paddedRes = await discardReq(ID.ownerA, ID.bizA, paddedUsd.id, { reason: 'Legacy padded usd run' });
    expect(paddedRes.status).toBe(201);
    expect(paddedRes.body.status).toBe('VOID');

    // 3. A DRAFT run that has a REVERSED ledger FinancialTransaction is still refused with 409.
    const reversedPostedDraft = await seedRun({
      status: 'DRAFT',
      currency: 'TTD',
      totalGross: 850,
      periodDayOffset: 52,
    });
    await db.financialTransaction.create({
      data: {
        id: `${P}ftx_rev`,
        businessId: ID.bizA,
        type: 'EXPENSE',
        status: 'REVERSED',
        date: new Date('2026-02-21T12:00:00Z'),
        amount: 850,
        currency: 'TTD',
        sourceType: 'PayrollRun',
        sourceId: reversedPostedDraft.id,
        externalRef: `PayrollRun:${reversedPostedDraft.id}:paid`,
      },
    });
    const revRes = await discardReq(ID.ownerA, ID.bizA, reversedPostedDraft.id, { reason: 'Try discard reversed posting' });
    expect(revRes.status).toBe(409);
    expect((await db.payrollRun.findUniqueOrThrow({ where: { id: reversedPostedDraft.id } })).status).toBe('DRAFT');
  });
});
