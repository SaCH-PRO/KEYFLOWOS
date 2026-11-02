/**
 * V1-03-KEY-CORTEX-PRINCIPAL — who may write the KEY autonomy profile (REAL
 * database). Build map CF-28 and M47; owner ruling D-17.
 *
 * PATCH /api/v1/cortex/autonomy-profile writes the tenant's
 * BusinessAutonomyProfile: the global kill switch (when on, KEY refuses every
 * autonomous tool execution), the daily caps and maxTierWithoutApproval (tools
 * above that tier always need a human approval). At the V1 base it sat behind
 * AuthGuard and BusinessGuard only, so any member, STAFF included, could
 * switch the kill switch off or raise the tier ceiling to 4.
 *
 * Required, and pinned here: only OWNER or ADMIN (the owner of record,
 * Business.ownerId, counts as OWNER; SUPER_ADMIN keeps the platform bypass
 * BusinessGuard grants) may write the profile, and nobody may raise
 * maxTierWithoutApproval above the approval tier they hold themselves (the
 * Membership rule in core/authority/approval-tier.ts: OWNER 4, ADMIN 3, STAFF 0
 * by default). The role is read in the tenant BusinessGuard checked, which is
 * the tenant the handler writes, so a body businessId naming another tenant
 * never writes. Every member still reads the profile (GET).
 *
 * Two request pipelines, as in key-cortex-tenant-binding.integration.test.ts:
 *   - `production`: TenantInterceptor installed as an APP_INTERCEPTOR and the
 *     Prisma tenant extension's context provider installed (main.ts);
 *   - `bare`: no TenantInterceptor, so the handler's own binding is the only
 *     tenant control.
 *
 * WHAT IS REAL: PrismaService, AuthGuard, BusinessGuard, the route's
 * AutonomyProfileWriteGuard, TenantInterceptor and the Prisma tenant extension
 * (production pipeline), the production GlobalHttpExceptionFilter and
 * ValidationPipe, KeyCortexController and KeyAutonomySafetyService, against
 * DATABASE_URL. Stand-ins: identity attachment (a test middleware reads
 * `x-v03a-user` and attaches the seeded user row, as AuthMiddleware does after
 * token verification) and the collaborators the controller holds for its other
 * routes (an allow-listed mocker; the autonomy-profile routes reach none of
 * them). Vitest's esbuild transform emits no parameter types, so the suite
 * writes the ones tsc emits for the controller's constructor and for
 * updateAutonomyProfile (key-cortex-tenant-binding.spec.ts checks the latter
 * against tsc's own output).
 *
 * Every seeded row carries the `v03a_` prefix and is hard-deleted by raw SQL
 * with sqlLikePrefix() in beforeAll and afterAll; no $transaction wrapping.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL (the
// shell / CI env wins because dotenv never overrides an existing variable).
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v03a_';
const HEADER = 'x-v03a-user';

const ID = {
  ownerA: `${P}ownerA`, // OWNER membership of bizA and Business.ownerId
  adminA: `${P}adminA`, // ADMIN of bizA, role-default tier (3)
  staffA: `${P}staffA`, // STAFF of bizA
  dual: `${P}dual`, // STAFF of bizA and OWNER of bizB
  ownerB: `${P}ownerB`, // OWNER of bizB (Business.ownerId)
  founderC: `${P}founderC`, // Business.ownerId of bizC, no membership row
  nomember: `${P}nomember`, // no business anywhere
  superAdmin: `${P}super`, // role SUPER_ADMIN, no membership
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  bizC: `${P}bizC`,
};

/** The profile each tenant holds before every case: the kill switch on, a tier ceiling below 4. */
const BASELINE: Record<string, { globalKillSwitch: boolean; maxDailyAutoActions: number; maxDailySpendTtd: number; maxTierWithoutApproval: number; notifyOnBlock: boolean }> = {
  [ID.bizA]: { globalKillSwitch: true, maxDailyAutoActions: 10, maxDailySpendTtd: 0, maxTierWithoutApproval: 3, notifyOnBlock: true },
  [ID.bizB]: { globalKillSwitch: true, maxDailyAutoActions: 77, maxDailySpendTtd: 0, maxTierWithoutApproval: 2, notifyOnBlock: true },
  [ID.bizC]: { globalKillSwitch: true, maxDailyAutoActions: 5, maxDailySpendTtd: 0, maxTierWithoutApproval: 1, notifyOnBlock: true },
};

/** The controller's collaborators for its other routes; the autonomy-profile routes reach none of them. */
const OFF_BOUNDARY = new Set([
  'KeyCortexReasoningService', 'KeyCortexConversationService', 'KeyCortexVoiceService', 'KeyCortexPersonalityService',
  'KeyCortexActionsService', 'KeyCortexContextService', 'KeyCortexConnectorService', 'KeyCortexCommandService',
  'KeyCortexExecutorService', 'KeyCortexContextV2Service', 'KeyCortexInsightService', 'KeyCortexMonitorV2Service',
  'KeyCortexSandboxService', 'KeyCortexFlowStudioService', 'KeyCortexEvolutionService', 'KeyCortexPhoneService',
  'KeyCortexDocumentService', 'KeyCortexLearningService', 'KeyCortexApprovalOrchestratorService',
  'KeyCortexConsciousnessService', 'KeyCortexSessionService', 'KeyCortexAwarenessService',
]);

type Pipeline = 'production' | 'bare';
const PIPELINES: Pipeline[] = ['production', 'bare'];
const PIPELINE_LABEL: Record<Pipeline, string> = {
  production: 'production pipeline (TenantInterceptor + tenant extension)',
  bare: 'handler alone (no TenantInterceptor)',
};

let db: any;
const apps: Partial<Record<Pipeline, any>> = {};

async function cleanup() {
  for (const sql of [
    `DELETE FROM business_autonomy_profiles WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

/** The stored profile of a tenant, every column but the timestamps, which compare separately. */
async function profile(businessId: string) {
  const row = await db.businessAutonomyProfile.findUnique({ where: { businessId } });
  if (!row) return null;
  return {
    globalKillSwitch: row.globalKillSwitch,
    maxDailyAutoActions: row.maxDailyAutoActions,
    maxDailySpendTtd: row.maxDailySpendTtd,
    maxTierWithoutApproval: row.maxTierWithoutApproval,
    notifyOnBlock: row.notifyOnBlock,
  };
}

const updatedAt = async (businessId: string) =>
  (await db.businessAutonomyProfile.findUnique({ where: { businessId }, select: { updatedAt: true } }))?.updatedAt?.toISOString();

/** Every tenant's stored profile, with its updatedAt, so a refused write is visibly byte-identical. */
async function snapshot() {
  const out: Record<string, unknown> = {};
  for (const biz of [ID.bizA, ID.bizB, ID.bizC]) out[biz] = { ...(await profile(biz)), updatedAt: await updatedAt(biz) };
  return out;
}

function patch(pipeline: Pipeline, opts: { user?: string; query?: Record<string, string>; body: Record<string, unknown> }) {
  let req = request(apps[pipeline]!.getHttpServer()).patch('/api/v1/cortex/autonomy-profile');
  if (opts.user) req = req.set(HEADER, opts.user);
  if (opts.query) req = req.query(opts.query);
  return req.send(opts.body);
}

function get(pipeline: Pipeline, opts: { user: string; query: Record<string, string> }) {
  return request(apps[pipeline]!.getHttpServer()).get('/api/v1/cortex/autonomy-profile').set(HEADER, opts.user).query(opts.query);
}

const describeBody = (res: { status: number; body: unknown }) => `${res.status} ${JSON.stringify(res.body)}`;

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;
  const tenant = await import('../src/core/tenant/tenant-context');
  // As main.ts does before the app serves: the extension reads the ambient
  // tenant that TenantInterceptor installs.
  dbMod.setTenantContextProvider({ getCurrentBusinessId: tenant.getCurrentBusinessId });

  const { Test } = await import('@nestjs/testing');
  const { ValidationPipe } = await import('@nestjs/common');
  const { APP_INTERCEPTOR } = await import('@nestjs/core');
  const { TenantInterceptor } = await import('../src/core/tenant/tenant.interceptor');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const controllerModule = await import('../src/modules/key-cortex/key-cortex.controller');
  const { KeyCortexController, UpdateAutonomyProfileDto } = controllerModule;
  const { KeyCortexReasoningService } = await import('../src/modules/key-cortex/key-cortex-reasoning.service');
  const { KeyCortexConversationService } = await import('../src/modules/key-cortex/key-cortex-conversation.service');
  const { KeyCortexVoiceService } = await import('../src/modules/key-cortex/key-cortex-voice.service');
  const { KeyCortexPersonalityService } = await import('../src/modules/key-cortex/key-cortex-personality.service');
  const { KeyCortexActionsService } = await import('../src/modules/key-cortex/key-cortex-actions.service');
  const { KeyCortexContextService } = await import('../src/modules/key-cortex/key-cortex-context.service');
  const { KeyCortexConnectorService } = await import('../src/modules/key-cortex/key-cortex-connector.service');
  const { KeyCortexCommandService } = await import('../src/modules/key-cortex/key-cortex-command.service');
  const { KeyCortexExecutorService } = await import('../src/modules/key-cortex/key-cortex-executor.service');
  const { KeyCortexContextV2Service } = await import('../src/modules/key-cortex/key-cortex-context-v2.service');
  const { KeyCortexInsightService } = await import('../src/modules/key-cortex/key-cortex-insight.service');
  const { KeyCortexMonitorV2Service } = await import('../src/modules/key-cortex/key-cortex-monitor-v2.service');
  const { KeyCortexSandboxService } = await import('../src/modules/key-cortex/key-cortex-sandbox.service');
  const { KeyCortexFlowStudioService } = await import('../src/modules/key-cortex/key-cortex-flow-studio.service');
  const { KeyCortexEvolutionService } = await import('../src/modules/key-cortex/key-cortex-evolution.service');
  const { KeyCortexPhoneService } = await import('../src/modules/key-cortex/key-cortex-phone.service');
  const { KeyCortexDocumentService } = await import('../src/modules/key-cortex/key-cortex-document.service');
  const { KeyCortexLearningService } = await import('../src/modules/key-cortex/key-cortex-learning.service');
  const { KeyAutonomySafetyService } = await import('../src/modules/key-autonomy/key-autonomy-safety.service');
  const { KeyCortexApprovalOrchestratorService } = await import('../src/modules/key-cortex/key-cortex-approval-orchestrator.service');
  const { KeyCortexConsciousnessService } = await import('../src/modules/key-cortex/key-cortex-consciousness.service');
  const { KeyCortexSessionService } = await import('../src/modules/key-cortex/key-cortex-session.service');
  const { KeyCortexAwarenessService } = await import('../src/modules/key-cortex/key-cortex-awareness.service');

  // The constructor parameter types tsc emits for the controller (Nest injects
  // by them; vitest's esbuild transform emits none), left alone if present.
  if (!Reflect.getMetadata('design:paramtypes', KeyCortexController)) {
    Reflect.defineMetadata('design:paramtypes', [
      KeyCortexReasoningService, KeyCortexConversationService, KeyCortexVoiceService, KeyCortexPersonalityService,
      KeyCortexActionsService, KeyCortexContextService, KeyCortexConnectorService, KeyCortexCommandService,
      KeyCortexExecutorService, KeyCortexContextV2Service, KeyCortexInsightService, KeyCortexMonitorV2Service,
      KeyCortexSandboxService, KeyCortexFlowStudioService, KeyCortexEvolutionService, KeyCortexPhoneService,
      KeyCortexDocumentService, KeyCortexLearningService, KeyAutonomySafetyService, KeyCortexApprovalOrchestratorService,
      KeyCortexConsciousnessService, KeyCortexSessionService, KeyCortexAwarenessService,
    ], KeyCortexController);
  }
  // The handler parameter types the ValidationPipe reads (as tsc emits them).
  if (!Reflect.getMetadata('design:paramtypes', KeyCortexController.prototype, 'updateAutonomyProfile')) {
    Reflect.defineMetadata('design:paramtypes', [UpdateAutonomyProfileDto, String], KeyCortexController.prototype, 'updateAutonomyProfile');
  }

  const build = async (pipeline: Pipeline) => {
    const moduleRef = await Test.createTestingModule({
      controllers: [KeyCortexController],
      providers: [
        PrismaService,
        AuthGuard,
        BusinessGuard,
        {
          provide: KeyAutonomySafetyService,
          useFactory: (prisma: any) => new KeyAutonomySafetyService(prisma),
          inject: [PrismaService],
        },
        // Installed globally in production (app.module.ts).
        ...(pipeline === 'production' ? [{ provide: APP_INTERCEPTOR, useClass: TenantInterceptor }] : []),
      ],
    })
      .useMocker((token: any) => {
        const name = typeof token === 'function' ? token.name : String(token);
        return OFF_BOUNDARY.has(name) ? {} : undefined;
      })
      .compile();

    const nest = moduleRef.createNestApplication();
    // Identity attachment only, for seeded v03a_ users. No guard is overridden.
    nest.use(async (req: any, _res: any, next: any) => {
      const header = req.headers[HEADER];
      const id = typeof header === 'string' ? header : undefined;
      if (id && id.startsWith(P)) {
        const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
        if (user) req.user = { id: user.id, email: user.email, role: user.role };
      }
      next();
    });
    // Same filter and pipe as app-bootstrap.ts, so status codes and bodies are the production ones.
    nest.useGlobalFilters(new GlobalHttpExceptionFilter());
    nest.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await nest.init();
    return nest;
  };
  apps.production = await build('production');
  apps.bare = await build('bare');

  await cleanup(); // in case a prior run aborted

  for (const [id, role] of [
    [ID.ownerA, 'USER'],
    [ID.adminA, 'USER'],
    [ID.staffA, 'USER'],
    [ID.dual, 'USER'],
    [ID.ownerB, 'USER'],
    [ID.founderC, 'USER'],
    [ID.nomember, 'USER'],
    [ID.superAdmin, 'SUPER_ADMIN'],
  ] as const) {
    await db.user.create({ data: { id, email: `${P}${id.slice(P.length)}@test.local`, role } });
  }
  await db.business.create({ data: { id: ID.bizA, name: 'V03A Biz A', ownerId: ID.ownerA } });
  await db.business.create({ data: { id: ID.bizB, name: 'V03A Biz B', ownerId: ID.ownerB } });
  await db.business.create({ data: { id: ID.bizC, name: 'V03A Biz C', ownerId: ID.founderC } });
  for (const [userId, businessId, role] of [
    [ID.ownerA, ID.bizA, 'OWNER'],
    [ID.adminA, ID.bizA, 'ADMIN'],
    [ID.staffA, ID.bizA, 'STAFF'],
    [ID.dual, ID.bizA, 'STAFF'],
    [ID.dual, ID.bizB, 'OWNER'],
    [ID.ownerB, ID.bizB, 'OWNER'],
  ] as const) {
    await db.membership.create({ data: { id: `${P}m_${userId.slice(P.length)}_${businessId.slice(P.length)}`, userId, businessId, role } });
  }
  for (const [businessId, row] of Object.entries(BASELINE)) {
    await db.businessAutonomyProfile.create({ data: { businessId, ...row } });
  }
}, 180_000);

afterAll(async () => {
  for (const pipeline of PIPELINES) if (apps[pipeline]) await apps[pipeline].close();
  if (db) await cleanup();
  const dbMod = await import('@keyflow/db');
  dbMod.setTenantContextProvider({ getCurrentBusinessId: () => undefined });
});

beforeEach(async () => {
  // Every case starts from the baseline, so each refusal is checked against a known profile.
  for (const [businessId, row] of Object.entries(BASELINE)) {
    await db.businessAutonomyProfile.update({ where: { businessId }, data: row });
  }
});

describe('fixture sanity (real rows)', () => {
  it('three tenants hold a profile with the kill switch on; A has an OWNER, an ADMIN and two STAFF; C has an owner of record and no membership', async () => {
    for (const biz of [ID.bizA, ID.bizB, ID.bizC]) expect(await profile(biz)).toEqual(BASELINE[biz]);
    const roles = await db.membership.findMany({ where: { businessId: ID.bizA }, select: { userId: true, role: true }, orderBy: { userId: 'asc' } });
    expect(roles).toEqual([
      { userId: ID.adminA, role: 'ADMIN' },
      { userId: ID.dual, role: 'STAFF' },
      { userId: ID.ownerA, role: 'OWNER' },
      { userId: ID.staffA, role: 'STAFF' },
    ]);
    expect(await db.membership.count({ where: { businessId: ID.bizC } })).toBe(0);
    expect(await db.membership.findUnique({ where: { userId_businessId: { userId: ID.dual, businessId: ID.bizB } }, select: { role: true } })).toEqual({ role: 'OWNER' });
  });
});

for (const pipeline of PIPELINES) {
  describe(`PATCH api/v1/cortex/autonomy-profile — ${PIPELINE_LABEL[pipeline]}`, () => {
    it("STAFF switching A's kill switch off is 403 and A's kill switch stays on", async () => {
      const before = await snapshot();
      const res = await patch(pipeline, { user: ID.staffA, query: { businessId: ID.bizA }, body: { globalKillSwitch: false } });
      expect(res.status, describeBody(res)).toBe(403);
      expect(await snapshot()).toEqual(before);
      expect((await profile(ID.bizA))!.globalKillSwitch).toBe(true);
    });

    it("STAFF raising the tier ceiling, the daily caps or turning off block notices is 403 and A's profile is byte-identical", async () => {
      const before = await snapshot();
      for (const body of [{ maxTierWithoutApproval: 4 }, { maxDailyAutoActions: 500 }, { maxDailySpendTtd: 0, notifyOnBlock: false }]) {
        const res = await patch(pipeline, { user: ID.staffA, query: { businessId: ID.bizA }, body });
        expect(res.status, `${JSON.stringify(body)} ${describeBody(res)}`).toBe(403);
      }
      expect(await snapshot()).toEqual(before);
    });

    it("STAFF still reads A's profile (GET is 200)", async () => {
      const res = await get(pipeline, { user: ID.staffA, query: { businessId: ID.bizA } });
      expect(res.status, describeBody(res)).toBe(200);
      expect(res.body).toMatchObject({ businessId: ID.bizA, ...BASELINE[ID.bizA] });
    });

    it("ADMIN raising maxTierWithoutApproval to 4 (above their tier 3) is 403 and A's ceiling stays 3", async () => {
      const before = await snapshot();
      const res = await patch(pipeline, { user: ID.adminA, query: { businessId: ID.bizA }, body: { maxTierWithoutApproval: 4 } });
      expect(res.status, describeBody(res)).toBe(403);
      expect(await snapshot()).toEqual(before);
      expect((await profile(ID.bizA))!.maxTierWithoutApproval).toBe(3);
    });

    it("ADMIN switching the kill switch off and lowering the ceiling to 2 is 200 and written to A only", async () => {
      const others = { b: await snapshot().then((s) => s[ID.bizB]), c: await snapshot().then((s) => s[ID.bizC]) };
      const res = await patch(pipeline, { user: ID.adminA, query: { businessId: ID.bizA }, body: { globalKillSwitch: false, maxTierWithoutApproval: 2 } });
      expect(res.status, describeBody(res)).toBe(200);
      expect(res.body).toMatchObject({ businessId: ID.bizA, globalKillSwitch: false, maxTierWithoutApproval: 2 });
      expect(await profile(ID.bizA)).toEqual({ ...BASELINE[ID.bizA], globalKillSwitch: false, maxTierWithoutApproval: 2 });
      const after = await snapshot();
      expect({ b: after[ID.bizB], c: after[ID.bizC] }).toEqual(others);
    });

    it("OWNER raising maxTierWithoutApproval to 4 and switching the kill switch off is 200 and written", async () => {
      const res = await patch(pipeline, { user: ID.ownerA, query: { businessId: ID.bizA }, body: { maxTierWithoutApproval: 4, globalKillSwitch: false } });
      expect(res.status, describeBody(res)).toBe(200);
      expect(await profile(ID.bizA)).toEqual({ ...BASELINE[ID.bizA], globalKillSwitch: false, maxTierWithoutApproval: 4 });
    });

    it("a body businessId of another tenant never writes: A's STAFF who owns B, sending ?businessId=B with the body {businessId: A}, is 403 and neither A nor B changes", async () => {
      const before = await snapshot();
      const res = await patch(pipeline, {
        user: ID.dual,
        query: { businessId: ID.bizB },
        body: { businessId: ID.bizA, globalKillSwitch: false, maxTierWithoutApproval: 4 },
      });
      expect(res.status, describeBody(res)).toBe(403);
      expect(await snapshot()).toEqual(before);
    });

    it("a body businessId of another tenant never writes: A's OWNER naming B in the body (query A) is 403 and B is unchanged", async () => {
      const before = await snapshot();
      const res = await patch(pipeline, {
        user: ID.ownerA,
        query: { businessId: ID.bizA },
        body: { businessId: ID.bizB, globalKillSwitch: false, maxTierWithoutApproval: 4 },
      });
      expect(res.status, describeBody(res)).toBe(403);
      expect(await snapshot()).toEqual(before);
    });

    it("B's OWNER (A's STAFF) writing B's own profile is 200 and A is unchanged (positive control for the dual member)", async () => {
      const a = (await snapshot())[ID.bizA];
      const res = await patch(pipeline, { user: ID.dual, query: { businessId: ID.bizB }, body: { globalKillSwitch: false } });
      expect(res.status, describeBody(res)).toBe(200);
      expect(res.body.businessId).toBe(ID.bizB);
      expect((await profile(ID.bizB))!.globalKillSwitch).toBe(false);
      expect((await snapshot())[ID.bizA]).toEqual(a);
    });

    it("the owner of record of C (Business.ownerId, no membership row) writes C's profile at the OWNER tier", async () => {
      const res = await patch(pipeline, { user: ID.founderC, query: { businessId: ID.bizC }, body: { maxTierWithoutApproval: 4, globalKillSwitch: false } });
      expect(res.status, describeBody(res)).toBe(200);
      expect(await profile(ID.bizC)).toEqual({ ...BASELINE[ID.bizC], globalKillSwitch: false, maxTierWithoutApproval: 4 });
    });

    it("SUPER_ADMIN naming A writes A's profile (the platform bypass BusinessGuard grants)", async () => {
      const res = await patch(pipeline, { user: ID.superAdmin, query: { businessId: ID.bizA }, body: { maxTierWithoutApproval: 4 } });
      expect(res.status, describeBody(res)).toBe(200);
      expect((await profile(ID.bizA))!.maxTierWithoutApproval).toBe(4);
    });

    it('no authenticated user is 401 and a non-member is 403; nothing is written', async () => {
      const before = await snapshot();
      const anon = await patch(pipeline, { query: { businessId: ID.bizA }, body: { globalKillSwitch: false } });
      expect(anon.status, describeBody(anon)).toBe(401);
      const stranger = await patch(pipeline, { user: ID.nomember, query: { businessId: ID.bizA }, body: { globalKillSwitch: false } });
      expect(stranger.status, describeBody(stranger)).toBe(403);
      expect(await snapshot()).toEqual(before);
    });

    it("ADMIN sending maxTierWithoutApproval as the string '4' is refused and nothing is written", async () => {
      const before = await snapshot();
      const res = await patch(pipeline, { user: ID.adminA, query: { businessId: ID.bizA }, body: { maxTierWithoutApproval: '4' } });
      expect([400, 403], describeBody(res)).toContain(res.status);
      expect(await snapshot()).toEqual(before);
    });
  });
}
