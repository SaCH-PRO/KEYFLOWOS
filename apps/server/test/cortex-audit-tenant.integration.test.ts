/**
 * R0-34-KEY-AUDIT-TENANT (PRS-M30) — cortex audit routes bind the tenant the
 * guard checked (REAL database).
 *
 * KeyCortexAuditController is mounted at `/api/v1/cortex` behind AuthGuard and
 * BusinessGuard, and none of its paths has a `:businessId` segment. BusinessGuard
 * checks the tenant named by the request (params, then body, then query; the web
 * compliance page sends `?businessId=`), but the four audit handlers read
 * `@Param('businessId')`, which is always `undefined` on these paths, and handed
 * it to Prisma — where `where: { businessId: undefined }` filters nothing.
 *
 * The defect claimed at c2f6f46d: audit/decisions, values, assessment and
 * acceptance receive businessId `undefined`. The open question was whether the
 * services then return another tenant's rows; the cases below answer it against
 * real AutonomyVerdict and ValueConstraint rows in two tenants.
 *
 * Nothing on the authorization boundary is mocked: PrismaService, the user,
 * business and membership rows, AuthGuard, BusinessGuard, ValueLearningService,
 * SelfAssessmentService, DigitalEmployeeAcceptanceService and
 * ComplianceMapService are real against DATABASE_URL. The only stand-ins are
 * identity attachment (a test middleware reads `x-test-user` and attaches the
 * seeded user row's `{ id, email, role }`, as AuthMiddleware does after token
 * verification) and EvalHarnessService, which the audit routes never call.
 *
 * Every seeded row carries the `k34a_` prefix and is hard-deleted by raw SQL in
 * beforeAll and afterAll.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL.
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'k34a_';
// LIKE pattern for the prefix with its underscore escaped (an unescaped `_`
// matches any character and could reach rows this suite did not seed).
const LIKE = `k34a\\_%`;

const ID = {
  ownerA: `${P}ownerA`, // OWNER of bizA (Business.ownerId)
  staffA: `${P}staffA`, // STAFF member of bizA (Membership)
  ownerB: `${P}ownerB`, // OWNER of bizB only
  nomember: `${P}nomember`, // no business anywhere
  superAdmin: `${P}super`, // role SUPER_ADMIN, no membership
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
};

const B_MARKER = 'k34a-tenant-B-private-reason';

// bizA: 3 verdicts, 1 blocked. bizB: 4 verdicts, all blocked, dated a minute
// ahead so they are the newest rows in the table if a read is unscoped.
const A_VERDICTS = [
  { id: `${P}vA1`, allowed: true, requiresApproval: false },
  { id: `${P}vA2`, allowed: true, requiresApproval: false },
  { id: `${P}vA3`, allowed: false, requiresApproval: false },
];
const B_VERDICTS = [`${P}vB1`, `${P}vB2`, `${P}vB3`, `${P}vB4`];

// bizA: one aligned value and one drifting value. bizB: two drifting values.
const A_VALUES = [
  { valueKey: `${P}valA_honesty`, weight: 0.9, evidenceCount: 5 },
  { valueKey: `${P}valA_drift`, weight: 0.2, evidenceCount: 3 },
];
const B_VALUES = [
  { valueKey: `${P}valB_secret`, weight: 0.1, evidenceCount: 4 },
  { valueKey: `${P}valB_other`, weight: 0.15, evidenceCount: 6 },
];

const ROUTES = ['audit/decisions', 'audit/values', 'audit/assessment', 'audit/acceptance'] as const;

let db: any;
let app: any;
let serviceCalls: Array<{ service: string; businessId: unknown }> = [];

async function cleanup() {
  for (const sql of [
    `DELETE FROM autonomy_verdicts WHERE business_id LIKE '${LIKE}'`,
    `DELETE FROM value_constraints WHERE business_id LIKE '${LIKE}'`,
    `DELETE FROM memberships WHERE id LIKE '${LIKE}'`,
    `DELETE FROM businesses WHERE id LIKE '${LIKE}'`,
    `DELETE FROM users WHERE id LIKE '${LIKE}'`,
  ]) {
    try {
      await db.$executeRawUnsafe(sql);
    } catch {
      /* best-effort */
    }
  }
}

function get(route: string, actor: string | null, businessId?: string) {
  const qs = businessId === undefined ? '' : `?businessId=${encodeURIComponent(businessId)}`;
  const req = request(app.getHttpServer()).get(`/api/v1/cortex/${route}${qs}`);
  return actor ? req.set('x-test-user', actor) : req;
}

/** Nothing seeded for tenant B appears anywhere in a response. */
function expectNothingOfB(body: unknown) {
  const text = JSON.stringify(body ?? {});
  expect(text).not.toContain(B_MARKER);
  expect(text).not.toContain(ID.bizB);
  for (const id of B_VERDICTS) expect(text).not.toContain(id);
  for (const v of B_VALUES) expect(text).not.toContain(v.valueKey);
}

/** No audit data of any tenant in a refused response. */
function expectNoAuditData(body: unknown) {
  for (const key of ['recent', 'total', 'blocked', 'constraints', 'drift', 'report', 'result']) {
    expect(body).not.toHaveProperty(key);
  }
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { KeyCortexAuditController } = await import('../src/modules/key-cortex/key-cortex-audit.controller');
  const { EvalHarnessService } = await import('../src/modules/key-cortex/eval-harness.service');
  const { SelfAssessmentService } = await import('../src/modules/key-cortex/self-assessment.service');
  const { DigitalEmployeeAcceptanceService } = await import('../src/modules/key-cortex/digital-employee-acceptance.service');
  const { ValueLearningService } = await import('../src/modules/key-cortex/value-learning.service');
  const { ComplianceMapService } = await import('../src/modules/key-autonomy/compliance-map.service');

  // The production build (tsc, emitDecoratorMetadata) records each class's
  // constructor parameter types, and Nest injects by them. Vitest's esbuild
  // transform does not emit that metadata, and these classes declare no
  // @Inject tokens, so without this every dependency would be injected as
  // undefined and each route would 500 before reaching the code under test.
  // This writes exactly the metadata tsc emits for these constructors (and
  // leaves a class alone if its metadata is already present).
  const emitParamTypes = (cls: object, types: unknown[]) => {
    if (!Reflect.getMetadata('design:paramtypes', cls)) Reflect.defineMetadata('design:paramtypes', types, cls);
  };
  emitParamTypes(KeyCortexAuditController, [
    PrismaService,
    EvalHarnessService,
    SelfAssessmentService,
    DigitalEmployeeAcceptanceService,
    ValueLearningService,
    ComplianceMapService,
  ]);
  emitParamTypes(ValueLearningService, [PrismaService]);
  emitParamTypes(SelfAssessmentService, [PrismaService, ValueLearningService]);
  emitParamTypes(DigitalEmployeeAcceptanceService, [PrismaService]);

  const moduleRef = await Test.createTestingModule({
    controllers: [KeyCortexAuditController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ValueLearningService,
      SelfAssessmentService,
      DigitalEmployeeAcceptanceService,
      ComplianceMapService,
      // Not on the audit routes' path; the eval routes are not under test here.
      { provide: EvalHarnessService, useValue: { getSuiteNames: () => [], runAll: async () => [], runSuite: async () => ({}) } },
    ],
  }).compile();

  // Record (and call through) the tenant each real service is handed, so the
  // claim "the service receives businessId undefined" is observed, not argued.
  const record = (service: string, instance: any, method: string) => {
    const original = instance[method].bind(instance);
    vi.spyOn(instance, method).mockImplementation(async (...args: any[]) => {
      serviceCalls.push({ service: `${service}.${method}`, businessId: args[0] });
      return original(...args);
    });
  };
  record('ValueLearningService', moduleRef.get(ValueLearningService), 'getValueConstraints');
  record('ValueLearningService', moduleRef.get(ValueLearningService), 'detectDrift');
  record('SelfAssessmentService', moduleRef.get(SelfAssessmentService), 'generate');
  record('DigitalEmployeeAcceptanceService', moduleRef.get(DigitalEmployeeAcceptanceService), 'evaluate');

  app = moduleRef.createNestApplication();
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

  await cleanup(); // in case a prior run aborted

  for (const [id, role] of [
    [ID.ownerA, 'USER'],
    [ID.staffA, 'USER'],
    [ID.ownerB, 'USER'],
    [ID.nomember, 'USER'],
    [ID.superAdmin, 'SUPER_ADMIN'],
  ] as const) {
    await db.user.create({ data: { id, email: `${id}@test.local`, role } });
  }
  await db.business.create({ data: { id: ID.bizA, name: 'K34A Biz A', ownerId: ID.ownerA } });
  await db.business.create({ data: { id: ID.bizB, name: 'K34A Biz B', ownerId: ID.ownerB } });
  await db.membership.create({ data: { id: `${P}m_staffA_bizA`, userId: ID.staffA, businessId: ID.bizA, role: 'STAFF' } });

  const verdict = (id: string, businessId: string, allowed: boolean, requiresApproval: boolean, reason: string, createdAt?: Date) =>
    db.autonomyVerdict.create({
      data: {
        id,
        businessId,
        actionKey: `${P}action`,
        allowed,
        requiresApproval,
        tier: 'supervised',
        confidence: 0.9,
        reason,
        ruleTrace: [],
        ...(createdAt ? { createdAt } : {}),
      },
    });
  for (const v of A_VERDICTS) await verdict(v.id, ID.bizA, v.allowed, v.requiresApproval, 'k34a-tenant-A-reason');
  const ahead = new Date(Date.now() + 60_000);
  for (const id of B_VERDICTS) await verdict(id, ID.bizB, false, false, B_MARKER, ahead);

  for (const v of A_VALUES) await db.valueConstraint.create({ data: { businessId: ID.bizA, source: `${P}seed`, ...v } });
  for (const v of B_VALUES) await db.valueConstraint.create({ data: { businessId: ID.bizB, source: `${P}seed`, ...v } });
}, 120_000);

afterAll(async () => {
  vi.restoreAllMocks();
  if (app) await app.close();
  if (db) await cleanup();
});

describe('fixture sanity (real rows)', () => {
  it('seeded verdicts and value constraints in two tenants', async () => {
    expect(await db.autonomyVerdict.count({ where: { businessId: ID.bizA } })).toBe(3);
    expect(await db.autonomyVerdict.count({ where: { businessId: ID.bizB } })).toBe(4);
    expect(await db.valueConstraint.count({ where: { businessId: ID.bizA } })).toBe(2);
    expect(await db.valueConstraint.count({ where: { businessId: ID.bizB } })).toBe(2);
    expect(await db.membership.count({ where: { businessId: ID.bizA, userId: ID.staffA } })).toBe(1);
  });
});

describe('cortex audit routes refuse callers the guard does not admit', () => {
  it('a request with no identity is 401 on every audit route', async () => {
    for (const route of ROUTES) {
      const res = await get(route, null, ID.bizA);
      expect({ route, status: res.status }).toEqual({ route, status: 401 });
      expectNoAuditData(res.body);
    }
  });

  it('a user with no membership is 403 on every audit route', async () => {
    for (const route of ROUTES) {
      const res = await get(route, ID.nomember, ID.bizA);
      expect({ route, status: res.status }).toEqual({ route, status: 403 });
      expectNoAuditData(res.body);
    }
  });

  it('a member of A calling with ?businessId=B is denied on every audit route', async () => {
    for (const actor of [ID.ownerA, ID.staffA]) {
      for (const route of ROUTES) {
        const res = await get(route, actor, ID.bizB);
        expect({ actor, route, status: res.status }).toEqual({ actor, route, status: 403 });
        expectNoAuditData(res.body);
        expectNothingOfB(res.body);
      }
    }
  });

  it('a member of A naming no tenant is refused on every audit route', async () => {
    for (const route of ROUTES) {
      const res = await get(route, ID.ownerA);
      expect({ route, status: res.status }).toEqual({ route, status: 403 });
      expectNoAuditData(res.body);
    }
  });

  it('SUPER_ADMIN naming no tenant gets 400 or 403, and no service is called with undefined', async () => {
    serviceCalls = [];
    const observed: Array<{ route: string; status: number; keys: string[] }> = [];
    for (const route of ROUTES) {
      const res = await get(route, ID.superAdmin);
      observed.push({ route, status: res.status, keys: Object.keys(res.body ?? {}).sort() });
      expectNoAuditData(res.body);
      expectNothingOfB(res.body);
    }
    for (const o of observed) expect([400, 403], JSON.stringify(observed)).toContain(o.status);
    expect(serviceCalls).toEqual([]);
  });
});

describe('a member of A sees only A through the cortex audit routes', () => {
  it('audit/decisions returns exactly A’s AutonomyVerdict rows and counts', async () => {
    for (const actor of [ID.ownerA, ID.staffA]) {
      const res = await get('audit/decisions', actor, ID.bizA);
      expect(res.status).toBe(200);
      const recent = (res.body.recent ?? []) as Array<{ id: string; businessId: string }>;
      const seen = {
        businessId: res.body.businessId,
        total: res.body.total,
        blocked: res.body.blocked,
        recentTenants: [...new Set(recent.map((r) => r.businessId))].sort(),
        recentIds: recent.map((r) => r.id).sort(),
      };
      expect(seen).toEqual({
        businessId: ID.bizA,
        total: 3,
        blocked: 1,
        recentTenants: [ID.bizA],
        recentIds: A_VERDICTS.map((v) => v.id).sort(),
      });
      expectNothingOfB(res.body);
    }
  });

  it('audit/values returns exactly A’s value constraints and drift', async () => {
    serviceCalls = [];
    const res = await get('audit/values', ID.ownerA, ID.bizA);
    expect(res.status).toBe(200);
    expect({
      businessId: res.body.businessId,
      constraints: (res.body.constraints ?? []).map((c: any) => c.valueKey),
      drift: res.body.drift,
    }).toEqual({
      businessId: ID.bizA,
      constraints: [`${P}valA_honesty`, `${P}valA_drift`],
      drift: { driftScore: 0.2, conflicting: [`${P}valA_drift`] },
    });
    expectNothingOfB(res.body);
    expect(serviceCalls).toEqual([
      { service: 'ValueLearningService.getValueConstraints', businessId: ID.bizA },
      { service: 'ValueLearningService.detectDrift', businessId: ID.bizA },
    ]);
  });

  it('audit/assessment scores A’s rows only', async () => {
    serviceCalls = [];
    const res = await get('audit/assessment', ID.ownerA, ID.bizA);
    expect(res.status).toBe(200);
    const report = res.body.report ?? {};
    expect({
      businessId: res.body.businessId,
      reportBusinessId: report.businessId,
      autonomyConsistencyScore: report.autonomyConsistencyScore,
      memoryRetrievalPrecisionScore: report.memoryRetrievalPrecisionScore,
      valueDriftScore: report.valueDriftScore,
      knowledgeGapCount: report.knowledgeGapCount,
    }).toEqual({
      businessId: ID.bizA,
      reportBusinessId: ID.bizA,
      // 1 - blocked/total over A's rows only: 1 - 1/3 (the service's own formula,
      // so the float is exactly the one it computes).
      autonomyConsistencyScore: 1 - 1 / 3,
      memoryRetrievalPrecisionScore: 0,
      valueDriftScore: 0.8,
      knowledgeGapCount: 0,
    });
    expect(Array.isArray(res.body.compliance) && res.body.compliance.length > 0).toBe(true);
    expectNothingOfB(res.body);
    expect(serviceCalls).toEqual([
      { service: 'SelfAssessmentService.generate', businessId: ID.bizA },
      { service: 'ValueLearningService.detectDrift', businessId: ID.bizA },
    ]);
  });

  it('audit/acceptance evaluates A’s last week only', async () => {
    serviceCalls = [];
    const res = await get('audit/acceptance', ID.ownerA, ID.bizA);
    expect(res.status).toBe(200);
    expect({ businessId: res.body.businessId, result: res.body.result }).toEqual({
      businessId: ID.bizA,
      result: { scenario: 'one_week_routine_operations', score: 2 / 3 - 1 / 3, passed: false, gaps: [] },
    });
    expect(res.body.scenario?.name).toBe('one_week_routine_operations');
    expectNothingOfB(res.body);
    expect(serviceCalls).toEqual([{ service: 'DigitalEmployeeAcceptanceService.evaluate', businessId: ID.bizA }]);
  });
});

describe('the handler acts on the tenant the guard checked', () => {
  it('B’s owner sending body businessId=B with ?businessId=A gets B’s rows, never A’s', async () => {
    // BusinessGuard resolves body before query, so it checks B (which this
    // caller owns). The handler must act on that same tenant.
    const res = await request(app.getHttpServer())
      .get(`/api/v1/cortex/audit/decisions?businessId=${ID.bizA}`)
      .set('x-test-user', ID.ownerB)
      .set('Content-Type', 'application/json')
      .send({ businessId: ID.bizB });
    expect(res.status).toBe(200);
    const recent = (res.body.recent ?? []) as Array<{ id: string; businessId: string }>;
    expect({
      businessId: res.body.businessId,
      total: res.body.total,
      recentIds: recent.map((r) => r.id).sort(),
    }).toEqual({ businessId: ID.bizB, total: 4, recentIds: [...B_VERDICTS].sort() });
    for (const v of A_VERDICTS) expect(JSON.stringify(res.body)).not.toContain(v.id);
  });

  it('SUPER_ADMIN naming B sees only B’s verdicts', async () => {
    const res = await get('audit/decisions', ID.superAdmin, ID.bizB);
    expect(res.status).toBe(200);
    const recent = (res.body.recent ?? []) as Array<{ id: string; businessId: string }>;
    expect({
      businessId: res.body.businessId,
      total: res.body.total,
      blocked: res.body.blocked,
      recentIds: recent.map((r) => r.id).sort(),
    }).toEqual({ businessId: ID.bizB, total: 4, blocked: 4, recentIds: [...B_VERDICTS].sort() });
  });
});
