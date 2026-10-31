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
 * Two request pipelines (R0-34 review ST-1, ST-2):
 *   - `app` is the PRODUCTION pipeline: TenantInterceptor is installed as an
 *     APP_INTERCEPTOR (app.module.ts) and the Prisma tenant extension's context
 *     provider is installed (main.ts, setTenantContextProvider), so every scoped
 *     query has `where.businessId` overwritten with the ambient tenant the
 *     interceptor picked. Every case runs here unless it says otherwise.
 *   - `bareApp` has no TenantInterceptor, so the extension is inert and the
 *     handler's own binding is the only control. It proves the handler binds
 *     the tenant by itself, independent of the extension.
 *
 * What leaked at the base (5787c722), measured under the production pipeline:
 * a member of A naming `?businessId=A` already got only A's rows, because the
 * extension injected A where the handler passed `undefined` (the response still
 * echoed `businessId: undefined`). What leaked was (1) SUPER_ADMIN naming no
 * tenant, and (2) a non-string `businessId` in the body (`{"not":"x"}`,
 * `{"equals":"B"}`, urlencoded `businessId[not]=x`) next to
 * `?businessId=A`: BusinessGuard checked A, TenantInterceptor installed the
 * object as the ambient tenant (it takes the first truthy field, with no type
 * check), and the extension handed the object to Prisma as a filter, so the
 * route read every tenant, or B, under a response that said A. The first fix
 * (dddaeef4) closed (1) and the handler-only path; it did not close (2), which
 * its harness could not see without the interceptor. The handlers now also pin
 * the ambient tenant to the guard-checked one. TenantInterceptor itself still
 * picks by truthiness for every other route; that is outside this packet.
 *
 * Every seeded row carries the `k34a_` prefix and is hard-deleted by raw SQL in
 * beforeAll and afterAll.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL.
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'k34a_';

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
let bareApp: INestApplication;
let tenant: typeof import('../src/core/tenant/tenant-context');
// Each real service call: the tenant argument it was handed, and the ambient
// tenant the Prisma extension would inject into its scoped queries.
let serviceCalls: Array<{ service: string; businessId: unknown; ambientTenant: unknown }> = [];

async function cleanup() {
  for (const sql of [
    `DELETE FROM autonomy_verdicts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM value_constraints WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE id LIKE ${sqlLikePrefix(P)}`,
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

function get(route: string, actor: string | null, businessId?: string, target: INestApplication = app) {
  const qs = businessId === undefined ? '' : `?businessId=${encodeURIComponent(businessId)}`;
  const req = request(target.getHttpServer()).get(`/api/v1/cortex/${route}${qs}`);
  return actor ? req.set('x-test-user', actor) : req;
}

/** The parts of an audit route's JSON body that identify whose rows it carries. */
type AuditBody = {
  businessId?: unknown;
  total?: unknown;
  blocked?: unknown;
  recent?: Array<{ id: string; businessId: string }>;
  constraints?: Array<{ valueKey: string }>;
  drift?: unknown;
  report?: { businessId?: unknown; autonomyConsistencyScore?: unknown; valueDriftScore?: unknown };
  result?: unknown;
};

/** The audit data a route returns, projected to the fields that identify a tenant's rows. */
function auditView(route: (typeof ROUTES)[number], body: AuditBody | undefined): Record<string, unknown> {
  switch (route) {
    case 'audit/decisions': {
      const recent = body?.recent ?? [];
      return {
        businessId: body?.businessId,
        total: body?.total,
        blocked: body?.blocked,
        recentTenants: [...new Set(recent.map((r) => r.businessId))].sort(),
        recentIds: recent.map((r) => r.id).sort(),
      };
    }
    case 'audit/values':
      return {
        businessId: body?.businessId,
        constraints: (body?.constraints ?? []).map((c) => c.valueKey),
        drift: body?.drift,
      };
    case 'audit/assessment':
      return {
        businessId: body?.businessId,
        reportBusinessId: body?.report?.businessId,
        autonomyConsistencyScore: body?.report?.autonomyConsistencyScore,
        valueDriftScore: body?.report?.valueDriftScore,
      };
    case 'audit/acceptance':
      return { businessId: body?.businessId, result: body?.result };
  }
}

/** Exactly A's audit data on each route (the values the 'sees only A' cases below derive). */
const ONLY_A: Record<(typeof ROUTES)[number], Record<string, unknown>> = {
  'audit/decisions': {
    businessId: ID.bizA,
    total: 3,
    blocked: 1,
    recentTenants: [ID.bizA],
    recentIds: A_VERDICTS.map((v) => v.id).sort(),
  },
  'audit/values': {
    businessId: ID.bizA,
    constraints: [`${P}valA_honesty`, `${P}valA_drift`],
    drift: { driftScore: 0.2, conflicting: [`${P}valA_drift`] },
  },
  'audit/assessment': {
    businessId: ID.bizA,
    reportBusinessId: ID.bizA,
    autonomyConsistencyScore: 1 - 1 / 3,
    valueDriftScore: 0.8,
  },
  'audit/acceptance': {
    businessId: ID.bizA,
    result: { scenario: 'one_week_routine_operations', score: 2 / 3 - 1 / 3, passed: false, gaps: [] },
  },
};

/** A 200 carrying exactly A's audit data, nothing of B, and every service read pinned to A. */
function expectOnlyA(
  route: (typeof ROUTES)[number],
  res: { status: number; body: AuditBody },
  ambientTenant: string | undefined,
  label: string,
) {
  expect({ label, route, status: res.status }).toEqual({ label, route, status: 200 });
  expect({ label, route, view: auditView(route, res.body) }).toEqual({ label, route, view: ONLY_A[route] });
  expectNothingOfB(res.body);
  // audit/decisions reads Prisma directly; every other route goes through a recorded service.
  if (route !== 'audit/decisions') expect({ label, route, calls: serviceCalls.length > 0 }).toEqual({ label, route, calls: true });
  for (const c of serviceCalls) {
    expect({ label, route, ...c }).toEqual({ label, route, service: c.service, businessId: ID.bizA, ambientTenant });
  }
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
  tenant = await import('../src/core/tenant/tenant-context');
  // As main.ts does before the app serves: the extension reads the ambient
  // tenant that TenantInterceptor installs.
  dbMod.setTenantContextProvider({ getCurrentBusinessId: tenant.getCurrentBusinessId });

  const { Test } = await import('@nestjs/testing');
  const { APP_INTERCEPTOR } = await import('@nestjs/core');
  const { TenantInterceptor } = await import('../src/core/tenant/tenant.interceptor');
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

  const build = async (withTenantInterceptor: boolean) => {
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
        // Installed globally in production (app.module.ts).
        ...(withTenantInterceptor ? [{ provide: APP_INTERCEPTOR, useClass: TenantInterceptor }] : []),
      ],
    }).compile();

    // Record (and call through) the tenant each real service is handed, and the
    // ambient tenant the extension would inject at that moment, so the claim
    // "the service receives businessId undefined" is observed, not argued.
    const record = (service: string, instance: any, method: string) => {
      const original = instance[method].bind(instance);
      vi.spyOn(instance, method).mockImplementation(async (...args: any[]) => {
        serviceCalls.push({
          service: `${service}.${method}`,
          businessId: args[0],
          ambientTenant: tenant.getCurrentBusinessId(),
        });
        return original(...args);
      });
    };
    record('ValueLearningService', moduleRef.get(ValueLearningService), 'getValueConstraints');
    record('ValueLearningService', moduleRef.get(ValueLearningService), 'detectDrift');
    record('SelfAssessmentService', moduleRef.get(SelfAssessmentService), 'generate');
    record('DigitalEmployeeAcceptanceService', moduleRef.get(DigitalEmployeeAcceptanceService), 'evaluate');

    const nest = moduleRef.createNestApplication();
    nest.use(async (req: any, _res: any, next: any) => {
      const header = req.headers['x-test-user'];
      const id = typeof header === 'string' ? header : undefined;
      if (id && id.startsWith(P)) {
        const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
        if (user) req.user = { id: user.id, email: user.email, role: user.role };
      }
      next();
    });
    await nest.init();
    return nest;
  };
  app = await build(true);
  bareApp = await build(false);

  await cleanup(); // in case a prior run aborted

  for (const [id, role] of [
    [ID.ownerA, 'USER'],
    [ID.staffA, 'USER'],
    [ID.ownerB, 'USER'],
    [ID.nomember, 'USER'],
    [ID.superAdmin, 'SUPER_ADMIN'],
  ] as const) {
    await db.user.create({ data: { id, email: `${P}${id.slice(P.length)}@test.local`, role } });
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
  if (bareApp) await bareApp.close();
  if (db) await cleanup();
  const dbMod = await import('@keyflow/db');
  dbMod.setTenantContextProvider({ getCurrentBusinessId: () => undefined });
});

describe('fixture sanity (real rows)', () => {
  it('seeded verdicts and value constraints in two tenants', async () => {
    expect(await db.autonomyVerdict.count({ where: { businessId: ID.bizA } })).toBe(3);
    expect(await db.autonomyVerdict.count({ where: { businessId: ID.bizB } })).toBe(4);
    expect(await db.valueConstraint.count({ where: { businessId: ID.bizA } })).toBe(2);
    expect(await db.valueConstraint.count({ where: { businessId: ID.bizB } })).toBe(2);
    expect(await db.membership.count({ where: { businessId: ID.bizA, userId: ID.staffA } })).toBe(1);
  });

  it('the Prisma tenant extension is live in this process (production pipeline)', async () => {
    // Outside any tenant context the extension is inert; inside A's it rewrites
    // an unscoped read to A. Without this the TenantInterceptor cases below
    // would prove nothing about the production pipeline. (A Prisma query runs
    // when it is awaited, so it is awaited inside the context.)
    const where = { actionKey: `${P}action` };
    expect(await db.autonomyVerdict.count({ where })).toBe(7);
    expect(await tenant.runWithTenant(ID.bizA, ID.ownerA, async () => await db.autonomyVerdict.count({ where }))).toBe(3);
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
      { service: 'ValueLearningService.getValueConstraints', businessId: ID.bizA, ambientTenant: ID.bizA },
      { service: 'ValueLearningService.detectDrift', businessId: ID.bizA, ambientTenant: ID.bizA },
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
      { service: 'SelfAssessmentService.generate', businessId: ID.bizA, ambientTenant: ID.bizA },
      { service: 'ValueLearningService.detectDrift', businessId: ID.bizA, ambientTenant: ID.bizA },
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
    expect(serviceCalls).toEqual([
      { service: 'DigitalEmployeeAcceptanceService.evaluate', businessId: ID.bizA, ambientTenant: ID.bizA },
    ]);
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

describe('under the production TenantInterceptor a non-string businessId cannot steer the tenant', () => {
  // BusinessGuard and @GuardedBusinessId skip a non-string businessId and
  // resolve A from the query; TenantInterceptor took the first truthy field and
  // installed the object as the ambient tenant, which the Prisma extension then
  // wrote over the handler's where.businessId (R0-34 review ST-1).
  const withBody = (route: string, actor: string, contentType: string, body: string | object) =>
    get(route, actor, ID.bizA).set('Content-Type', contentType).send(body);

  it('a member of A sending ?businessId=A with the JSON body {businessId:{not:…}} reads only A on every audit route', async () => {
    for (const actor of [ID.ownerA, ID.staffA]) {
      for (const route of ROUTES) {
        serviceCalls = [];
        const res = await withBody(route, actor, 'application/json', { businessId: { not: 'x' } });
        expectOnlyA(route, res, ID.bizA, actor);
      }
    }
  });

  it('the JSON body {businessId:{equals:B}} with ?businessId=A reads A, never B, on every audit route', async () => {
    for (const route of ROUTES) {
      serviceCalls = [];
      const res = await withBody(route, ID.ownerA, 'application/json', { businessId: { equals: ID.bizB } });
      expectOnlyA(route, res, ID.bizA, 'equals-B');
    }
  });

  it('the urlencoded body businessId[not]=x with ?businessId=A reads A, never B, on every audit route', async () => {
    for (const route of ROUTES) {
      serviceCalls = [];
      const res = await withBody(route, ID.staffA, 'application/x-www-form-urlencoded', 'businessId[not]=x');
      expectOnlyA(route, res, ID.bizA, 'urlencoded');
    }
  });

  it('SUPER_ADMIN sending ?businessId=A with an object body reads only A', async () => {
    for (const route of ROUTES) {
      serviceCalls = [];
      const res = await withBody(route, ID.superAdmin, 'application/json', { businessId: { not: 'x' } });
      expectOnlyA(route, res, ID.bizA, 'super-admin');
    }
  });

  it('a tenant named only by a non-string query (?businessId[not]=x) is refused on every audit route, SUPER_ADMIN included', async () => {
    serviceCalls = [];
    for (const actor of [ID.ownerA, ID.superAdmin]) {
      for (const route of ROUTES) {
        const res = await request(app.getHttpServer())
          .get(`/api/v1/cortex/${route}?businessId%5Bnot%5D=x`)
          .set('x-test-user', actor);
        expect({ actor, route, status: res.status }).toEqual({ actor, route, status: 403 });
        expectNoAuditData(res.body);
        expectNothingOfB(res.body);
      }
    }
    expect(serviceCalls).toEqual([]);
  });
});

describe('without TenantInterceptor the handler alone binds the tenant', () => {
  it('a member of A naming A sees only A on every audit route (tenant extension inert)', async () => {
    for (const actor of [ID.ownerA, ID.staffA]) {
      for (const route of ROUTES) {
        serviceCalls = [];
        const res = await get(route, actor, ID.bizA, bareApp);
        // ambientTenant undefined: nothing but the handler's own binding scoped these reads.
        expectOnlyA(route, res, undefined, actor);
      }
    }
  });
});
