/**
 * P235 FU-PAYROLL-IS-MONEY (D-310 / D-100 / D-140): real-DB PostgreSQL HTTP
 * proof that payroll money figures (runs list `totalGross`, run detail
 * `totalGross` + `items[].grossPay` + rate-bearing `items[].notes`, rates
 * `amount`, approve/discard responses `totalGross`, and Activity rows carrying
 * `payroll_run` / `data.totalGross`) are withheld from members without
 * `revenue:read` (including explicit-scope OWNERs under D-140), while members
 * holding `operations:read` + `revenue:read` (and unscoped OWNERs) still read them.
 *
 * Fixture prefix: `v92n_` (registered in apps/server/test/helpers/fixture-prefixes.json).
 * Hard-deleted via raw SQL with sqlLikePrefix(P) in beforeAll and afterAll.
 */
import 'reflect-metadata';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v92n_';
const HEADER = 'x-v92n-user';

const ID = {
  ownerA: `${P}owner_a`,
  scopedOwnerNoRevA: `${P}owner_norev_a`,
  staffOpsOnlyA: `${P}staff_ops_a`,
  staffOpsRevA: `${P}staff_ops_rev_a`,
  staffNoneA: `${P}staff_none_a`,
  ownerB: `${P}owner_b`,
  bizA: `${P}biz_a`,
  bizB: `${P}biz_b`,
  orgUnitA: `${P}unit_a`,
  jobRoleA: `${P}role_a`,
  assignmentA: `${P}asgn_a`,
  rateA: `${P}rate_a`,
  runDraftA: `${P}run_draft_a`,
  runApproveA: `${P}run_approve_a`,
  runDiscardA: `${P}run_discard_a`,
};

let db: typeof import('@keyflow/db').db;
let app: import('@nestjs/common').INestApplication;
let canReadActivityRow: typeof import('../src/modules/timeline/timeline-visibility').canReadActivityRow;
let resolveTimelineViewer: typeof import('../src/modules/timeline/timeline-visibility').resolveTimelineViewer;
let prismaStub: { client: typeof import('@keyflow/db').db };

async function cleanup() {
  for (const sql of [
    `DELETE FROM activities WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payroll_items WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payroll_runs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM pay_rates WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM org_assignments WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM job_roles WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM org_units WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;
  prismaStub = { client: db };

  const tv = await import('../src/modules/timeline/timeline-visibility');
  canReadActivityRow = tv.canReadActivityRow;
  resolveTimelineViewer = tv.resolveTimelineViewer;

  const { Test } = await import('@nestjs/testing');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { TenantInterceptor } = await import('../src/core/tenant/tenant.interceptor');
  const { PayrollController } = await import('../src/modules/payroll/payroll.controller');
  const { PayrollService } = await import('../src/modules/payroll/payroll.service');

  const moduleRef = await Test.createTestingModule({
    controllers: [PayrollController],
    providers: [
      { provide: PrismaService, useValue: prismaStub },
      PayrollService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      TenantInterceptor,
    ],
  }).compile();

  app = moduleRef.createNestApplication();
  app.use((req: any, _res: any, next: () => void) => {
    const uid = req.headers[HEADER];
    if (typeof uid === 'string' && uid.trim()) {
      req.user = { id: uid.trim(), email: `${uid.trim()}@test.local`, role: 'USER' };
    }
    next();
  });
  app.useGlobalInterceptors(moduleRef.get(TenantInterceptor));
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  await app.init();

  await cleanup();

  await db.user.createMany({
    data: [
      { id: ID.ownerA, email: `${P}owner_a@test.local`, name: 'Owner A' },
      { id: ID.scopedOwnerNoRevA, email: `${P}owner_norev_a@test.local`, name: 'Scoped Owner NoRev A' },
      { id: ID.staffOpsOnlyA, email: `${P}staff_ops_a@test.local`, name: 'Staff Ops Only A' },
      { id: ID.staffOpsRevA, email: `${P}staff_ops_rev_a@test.local`, name: 'Staff Ops+Rev A' },
      { id: ID.staffNoneA, email: `${P}staff_none_a@test.local`, name: 'Staff None A' },
      { id: ID.ownerB, email: `${P}owner_b@test.local`, name: 'Owner B' },
    ],
  });

  await db.business.createMany({
    data: [
      { id: ID.bizA, name: 'Biz A Payroll', slug: `${P}biz-a`, ownerId: ID.ownerA, currency: 'TTD' },
      { id: ID.bizB, name: 'Biz B Payroll', slug: `${P}biz-b`, ownerId: ID.ownerB, currency: 'TTD' },
    ],
  });

  await db.membership.createMany({
    data: [
      { id: `${P}mem_owner_a`, businessId: ID.bizA, userId: ID.ownerA, role: 'OWNER' },
      {
        id: `${P}mem_owner_norev_a`,
        businessId: ID.bizA,
        userId: ID.scopedOwnerNoRevA,
        role: 'OWNER',
        permissionScopes: { operations: 'write', revenue: 'none' },
      },
      {
        id: `${P}mem_staff_ops_a`,
        businessId: ID.bizA,
        userId: ID.staffOpsOnlyA,
        role: 'STAFF',
        permissionScopes: { operations: 'write', revenue: 'none' },
      },
      {
        id: `${P}mem_staff_ops_rev_a`,
        businessId: ID.bizA,
        userId: ID.staffOpsRevA,
        role: 'STAFF',
        permissionScopes: { operations: 'read', revenue: 'read' },
      },
      {
        id: `${P}mem_staff_none_a`,
        businessId: ID.bizA,
        userId: ID.staffNoneA,
        role: 'STAFF',
        permissionScopes: { operations: 'none', revenue: 'none' },
      },
      { id: `${P}mem_owner_b`, businessId: ID.bizB, userId: ID.ownerB, role: 'OWNER' },
    ],
  });

  await db.orgUnit.create({
    data: { id: ID.orgUnitA, businessId: ID.bizA, name: 'Operations', type: 'DEPARTMENT' },
  });
  await db.jobRole.create({
    data: { id: ID.jobRoleA, businessId: ID.bizA, name: 'Technician' },
  });
  await db.orgAssignment.create({
    data: {
      id: ID.assignmentA,
      businessId: ID.bizA,
      orgUnitId: ID.orgUnitA,
      jobRoleId: ID.jobRoleA,
      userId: ID.staffOpsOnlyA,
      status: 'ACTIVE',
    },
  });
  await db.payRate.create({
    data: {
      id: ID.rateA,
      businessId: ID.bizA,
      assignmentId: ID.assignmentA,
      amount: 75,
      currency: 'TTD',
      periodType: 'hourly',
      effectiveFrom: new Date('2026-01-01T00:00:00Z'),
    },
  });

  const seedRun = async (id: string, totalGross: number, dayOffset: number) => {
    const start = new Date(`2026-05-${String(1 + dayOffset).padStart(2, '0')}T00:00:00Z`);
    const end = new Date(`2026-05-${String(7 + dayOffset).padStart(2, '0')}T00:00:00Z`);
    await db.payrollRun.create({
      data: {
        id,
        businessId: ID.bizA,
        periodStart: start,
        periodEnd: end,
        status: 'DRAFT',
        totalGross,
        currency: 'TTD',
        itemCount: 1,
        items: {
          create: [
            {
              id: `${id}_item`,
              businessId: ID.bizA,
              assignmentId: ID.assignmentA,
              hoursWorked: 40,
              grossPay: totalGross,
              currency: 'TTD',
              notes: '40.00h × 75',
            },
          ],
        },
      },
    });
  };

  await seedRun(ID.runDraftA, 3000, 0);
  await seedRun(ID.runApproveA, 2500, 10);
  await seedRun(ID.runDiscardA, 1800, 20);
}, 60_000);

afterAll(async () => {
  await cleanup();
  await app?.close();
});

describe('P235 FU-PAYROLL-IS-MONEY (D-310 / D-100 / D-140, v92n_)', () => {
  it('[PIM-01] RED-BEFORE: withholds totalGross, grossPay, rate notes, and pay rate amount from operations members and D-140 scoped OWNERs without revenue:read; preserves them with revenue:read', async () => {
    for (const actor of [ID.staffOpsOnlyA, ID.scopedOwnerNoRevA]) {
      const runsRes = await request(app.getHttpServer())
        .get(`/payroll/businesses/${ID.bizA}/runs`)
        .set(HEADER, actor)
        .expect(200);
      expect(runsRes.body.length).toBeGreaterThanOrEqual(3);
      for (const r of runsRes.body) {
        expect(r.totalGross, `listRuns totalGross withheld for ${actor}`).toBeNull();
      }

      const runRes = await request(app.getHttpServer())
        .get(`/payroll/businesses/${ID.bizA}/runs/${ID.runDraftA}`)
        .set(HEADER, actor)
        .expect(200);
      expect(runRes.body.totalGross, `getRun totalGross withheld for ${actor}`).toBeNull();
      expect(runRes.body.items).toHaveLength(1);
      expect(runRes.body.items[0].grossPay, `getRun item grossPay withheld for ${actor}`).toBeNull();
      expect(runRes.body.items[0].notes, `getRun item rate notes withheld for ${actor}`).toBeNull();

      const ratesRes = await request(app.getHttpServer())
        .get(`/payroll/businesses/${ID.bizA}/rates`)
        .set(HEADER, actor)
        .expect(200);
      expect(ratesRes.body).toHaveLength(1);
      expect(ratesRes.body[0].amount, `listRates amount withheld for ${actor}`).toBeNull();
    }

    // Positive controls: unscoped OWNER and STAFF with operations:read + revenue:read see real figures
    for (const actor of [ID.ownerA, ID.staffOpsRevA]) {
      const runsRes = await request(app.getHttpServer())
        .get(`/payroll/businesses/${ID.bizA}/runs`)
        .set(HEADER, actor)
        .expect(200);
      const draft = runsRes.body.find((r: any) => r.id === ID.runDraftA);
      expect(draft?.totalGross).toBe(3000);

      const runRes = await request(app.getHttpServer())
        .get(`/payroll/businesses/${ID.bizA}/runs/${ID.runDraftA}`)
        .set(HEADER, actor)
        .expect(200);
      expect(runRes.body.totalGross).toBe(3000);
      expect(runRes.body.items[0].grossPay).toBe(3000);
      expect(runRes.body.items[0].notes).toBe('40.00h × 75');

      const ratesRes = await request(app.getHttpServer())
        .get(`/payroll/businesses/${ID.bizA}/rates`)
        .set(HEADER, actor)
        .expect(200);
      expect(ratesRes.body[0].amount).toBe(75);
    }
  });

  it('[PIM-02] RED-BEFORE: approve/discard responses withhold totalGross without revenue:read, and canReadActivityRow withholds payroll Activity rows (data.totalGross) without revenue:read', async () => {
    // STAFF with operations:write + revenue:none approves and discards runs -> responses withhold totalGross
    const approveRes = await request(app.getHttpServer())
      .post(`/payroll/businesses/${ID.bizA}/runs/${ID.runApproveA}/approve`)
      .set(HEADER, ID.staffOpsOnlyA)
      .expect(201);
    expect(approveRes.body.status).toBe('APPROVED');
    expect(approveRes.body.totalGross).toBeNull();

    const discardRes = await request(app.getHttpServer())
      .post(`/payroll/businesses/${ID.bizA}/runs/${ID.runDiscardA}/discard`)
      .set(HEADER, ID.staffOpsOnlyA)
      .send({ reason: 'Wrong period' })
      .expect(201);
    expect(discardRes.body.status).toBe('VOID');
    expect(discardRes.body.totalGross).toBeNull();

    // Verify real Activity row written by discardRun carries data.totalGross = 1800
    const actRow = await db.activity.findFirstOrThrow({
      where: { businessId: ID.bizA, entityType: 'payroll_run', entityId: ID.runDiscardA },
    });
    expect((actRow.data as any)?.totalGross).toBe(1800);

    // canReadActivityRow withholds it from operations-only STAFF and D-140 scoped OWNER without revenue:read
    const staffNoRevViewer = await resolveTimelineViewer(prismaStub as any, ID.bizA, ID.staffOpsOnlyA);
    const scopedOwnerNoRevViewer = await resolveTimelineViewer(prismaStub as any, ID.bizA, ID.scopedOwnerNoRevA);
    const staffWithRevViewer = await resolveTimelineViewer(prismaStub as any, ID.bizA, ID.staffOpsRevA);
    const ownerViewer = await resolveTimelineViewer(prismaStub as any, ID.bizA, ID.ownerA);

    expect(canReadActivityRow(staffNoRevViewer, actRow)).toBe(false);
    expect(canReadActivityRow(scopedOwnerNoRevViewer, actRow)).toBe(false);
    expect(canReadActivityRow(staffWithRevViewer, actRow)).toBe(true);
    expect(canReadActivityRow(ownerViewer, actRow)).toBe(true);

    // Also catches JSON-stringified data carrying totalGross or grossPay on any operations row
    const stringDataRow = {
      module: 'operations',
      action: 'updated',
      category: 'SYSTEM',
      data: JSON.stringify({ totalGross: 1800 }),
    };
    expect(canReadActivityRow(staffNoRevViewer, stringDataRow)).toBe(false);
    expect(canReadActivityRow(ownerViewer, stringDataRow)).toBe(true);
  });

  it('[PIM-03] auth, scope, and cross-tenant boundaries remain fail-closed (401/403)', async () => {
    await request(app.getHttpServer()).get(`/payroll/businesses/${ID.bizA}/runs`).expect(401);
    await request(app.getHttpServer())
      .get(`/payroll/businesses/${ID.bizA}/runs`)
      .set(HEADER, ID.staffNoneA)
      .expect(403);
    await request(app.getHttpServer())
      .get(`/payroll/businesses/${ID.bizA}/runs`)
      .set(HEADER, ID.ownerB)
      .expect(403);
  });
});
