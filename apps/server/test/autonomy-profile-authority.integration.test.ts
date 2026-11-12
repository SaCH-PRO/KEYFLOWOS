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
 * Required, and pinned here: only OWNER or ADMIN (by membership: the owner of
 * record, Business.ownerId, grants nothing on its own since owner ruling D-104,
 * and one holding only ADMIN or STAFF is that role since D-116,
 * W11-D116-KEY-OWNER; SUPER_ADMIN keeps the platform bypass
 * BusinessGuard grants) may write the profile, and nobody may raise
 * maxTierWithoutApproval above the approval tier they hold themselves (the
 * Membership rule in core/authority/approval-tier.ts: OWNER 4, ADMIN 3, STAFF 0
 * by default). The role is read in the tenant BusinessGuard checked, which is
 * the tenant the handler writes, so a body businessId naming another tenant
 * never writes. Every member still reads the profile (GET).
 *
 * Review repairs (V1-03 ST-1, CR-V103-1, ST-2), pinned in the last block:
 *   - the write is judged against the profile it leaves behind: releasing the
 *     kill switch, raising a daily cap, lifting the spend cap (0 is unlimited)
 *     or turning block notices off needs the caller's tier to reach the tier
 *     ceiling the profile keeps, so an ADMIN at tier 3 cannot release the kill
 *     switch over an OWNER's ceiling of 4, and an ADMIN restricted to tier 0
 *     loosens nothing;
 *   - a field sent with its stored value is no change: the web form
 *     (apps/web settings/autonomy) sends every field on every save, so an
 *     ADMIN under an OWNER's ceiling of 4 can still switch the kill switch ON;
 *   - every admitted write leaves one team_activity_logs row naming its
 *     writer, with the stored profile as `before`, whichever request field
 *     names the tenant; a refused write leaves none.
 *
 * Second review (SEC-V103-1..3), pinned in the final block:
 *   - the write is a compare-and-set on the profile the guard judged: a
 *     request whose judged profile changed before its write lands is 409 and
 *     writes nothing, so a tier-3 ADMIN's stale resubmission of an OWNER's
 *     ceiling of 4 can no longer overwrite their own release of the kill
 *     switch with the ceiling lowered to 3;
 *   - the audit row's `before` is the row the write replaced, so the audit
 *     rows of any interleaving chain from the stored profile to the final one;
 *   - the write and its audit row commit together: when the insert fails the
 *     request is 500 and the profile is unchanged.
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
import { isDeepStrictEqual } from 'util';
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
  adminA0: `${P}adminA0`, // ADMIN of bizA the OWNER restricted to tier 0 (explicit scope map)
  adminA2: `${P}adminA2`, // ADMIN of bizA the OWNER restricted to tier 2 (explicit scope map)
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

/** A test-only trigger that refuses the audit insert for bizA's rows (SEC-V103-3); created and dropped by its case. */
const AUDIT_REFUSAL = `${P}audit_refusal`;

async function cleanup() {
  for (const sql of [
    `DROP TRIGGER IF EXISTS ${AUDIT_REFUSAL} ON team_activity_logs`,
    `DROP FUNCTION IF EXISTS ${AUDIT_REFUSAL}()`,
    `DELETE FROM team_activity_logs WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
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
    [ID.adminA0, 'USER'],
    [ID.adminA2, 'USER'],
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
  // An explicit scope map makes the stored maxApprovalTier authoritative (core/authority/approval-tier.ts).
  for (const [userId, maxApprovalTier] of [[ID.adminA0, 0], [ID.adminA2, 2]] as const) {
    await db.membership.create({
      data: { id: `${P}m_${userId.slice(P.length)}_bizA`, userId, businessId: ID.bizA, role: 'ADMIN', maxApprovalTier, permissionScopes: {} },
    });
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
  it('three tenants hold a profile with the kill switch on; A has an OWNER, three ADMINs (tiers 3, 0, 2) and two STAFF; C has an owner of record and no membership', async () => {
    for (const biz of [ID.bizA, ID.bizB, ID.bizC]) expect(await profile(biz)).toEqual(BASELINE[biz]);
    const roles = await db.membership.findMany({ where: { businessId: ID.bizA }, select: { userId: true, role: true }, orderBy: { userId: 'asc' } });
    expect(roles).toEqual([
      { userId: ID.adminA, role: 'ADMIN' },
      { userId: ID.adminA0, role: 'ADMIN' },
      { userId: ID.adminA2, role: 'ADMIN' },
      { userId: ID.dual, role: 'STAFF' },
      { userId: ID.ownerA, role: 'OWNER' },
      { userId: ID.staffA, role: 'STAFF' },
    ]);
    expect(await db.membership.count({ where: { businessId: ID.bizC } })).toBe(0);
    expect(await db.membership.findUnique({ where: { userId_businessId: { userId: ID.dual, businessId: ID.bizB } }, select: { role: true } })).toEqual({ role: 'OWNER' });
    const restricted = await db.membership.findMany({
      where: { userId: { in: [ID.adminA0, ID.adminA2] } }, select: { userId: true, maxApprovalTier: true, permissionScopes: true }, orderBy: { userId: 'asc' },
    });
    expect(restricted).toEqual([
      { userId: ID.adminA0, maxApprovalTier: 0, permissionScopes: {} },
      { userId: ID.adminA2, maxApprovalTier: 2, permissionScopes: {} },
    ]);
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

    it("owner ruling D-104 (W10-OWNER-MEMBERSHIP; was: writes C's profile at the OWNER tier): the owner of record of C (Business.ownerId, no membership row) is refused (403) and nothing is written", async () => {
      const before = await snapshot();
      const res = await patch(pipeline, { user: ID.founderC, query: { businessId: ID.bizC }, body: { maxTierWithoutApproval: 4, globalKillSwitch: false } });
      expect(res.status, describeBody(res)).toBe(403);
      expect(await snapshot()).toEqual(before);
      expect(await profile(ID.bizC)).toEqual(BASELINE[ID.bizC]);
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

/* ------------------------------------------------------------------ */
/*  Review repairs: ST-1 (the profile the write leaves), CR-V103-1     */
/*  (an unchanged field is no change), ST-2 (every write is audited)   */
/* ------------------------------------------------------------------ */

/** Overwrite a tenant's stored profile for one case (beforeEach restores the baseline). */
async function setProfile(businessId: string, row: Partial<(typeof BASELINE)[string]>) {
  await db.businessAutonomyProfile.update({ where: { businessId }, data: row });
}

/** The KEY autonomy-profile audit rows of a tenant, oldest first. */
async function auditRows(businessId: string) {
  return db.teamActivityLog.findMany({
    where: { businessId, action: 'key_autonomy_profile_updated' },
    orderBy: { createdAt: 'asc' },
    select: { userId: true, module: true, entityType: true, entityId: true, title: true, meta: true },
  });
}

/** What apps/web/src/app/app/settings/autonomy/page.tsx sends on every save: the tenant and every field. */
const webForm = (businessId: string, row: (typeof BASELINE)[string]) => ({ businessId, ...row });

for (const pipeline of PIPELINES) {
  describe(`PATCH autonomy-profile review repairs — ${PIPELINE_LABEL[pipeline]}`, () => {
    it("ST-1(a): an ADMIN restricted to tier 0 releasing the kill switch, removing the spend cap and raising the action cap under the OWNER's ceiling of 4 is 403 and nothing is written", async () => {
      await setProfile(ID.bizA, { maxTierWithoutApproval: 4, globalKillSwitch: true, maxDailySpendTtd: 100 });
      const before = await snapshot();
      const res = await patch(pipeline, {
        user: ID.adminA0, query: { businessId: ID.bizA }, body: { globalKillSwitch: false, maxDailySpendTtd: 0, maxDailyAutoActions: 1_000_000 },
      });
      expect(res.status, describeBody(res)).toBe(403);
      expect(await snapshot()).toEqual(before);
      expect(await profile(ID.bizA)).toEqual({ ...BASELINE[ID.bizA], maxTierWithoutApproval: 4, globalKillSwitch: true, maxDailySpendTtd: 100 });
    });

    it('ST-1(a): the tier-0 ADMIN loosening any one setting at the default ceiling of 3 is 403; each tightening is 200', async () => {
      await setProfile(ID.bizA, { maxDailySpendTtd: 100 });
      const before = await snapshot();
      for (const body of [{ globalKillSwitch: false }, { maxDailySpendTtd: 0 }, { maxDailySpendTtd: 500 }, { maxDailyAutoActions: 11 }, { notifyOnBlock: false }]) {
        const res = await patch(pipeline, { user: ID.adminA0, query: { businessId: ID.bizA }, body });
        expect(res.status, `${JSON.stringify(body)} ${describeBody(res)}`).toBe(403);
      }
      expect(await snapshot()).toEqual(before);
      const tighten = await patch(pipeline, { user: ID.adminA0, query: { businessId: ID.bizA }, body: { maxDailySpendTtd: 50, maxDailyAutoActions: 2, maxTierWithoutApproval: 1 } });
      expect(tighten.status, describeBody(tighten)).toBe(200);
      expect(await profile(ID.bizA)).toEqual({ ...BASELINE[ID.bizA], maxDailySpendTtd: 50, maxDailyAutoActions: 2, maxTierWithoutApproval: 1 });
    });

    it("ST-1(b): a default-tier ADMIN (tier 3) releasing the kill switch over the OWNER's ceiling of 4 is 403 and the kill switch stays on", async () => {
      await setProfile(ID.bizA, { maxTierWithoutApproval: 4 });
      const before = await snapshot();
      const res = await patch(pipeline, { user: ID.adminA, query: { businessId: ID.bizA }, body: { globalKillSwitch: false } });
      expect(res.status, describeBody(res)).toBe(403);
      expect(await snapshot()).toEqual(before);
      expect(await profile(ID.bizA)).toMatchObject({ globalKillSwitch: true, maxTierWithoutApproval: 4 });
    });

    it("ST-1: the tier-3 ADMIN raising the action cap under the OWNER's ceiling of 4 is 403 with the kill switch off too", async () => {
      await setProfile(ID.bizA, { maxTierWithoutApproval: 4, globalKillSwitch: false });
      const before = await snapshot();
      const res = await patch(pipeline, { user: ID.adminA, query: { businessId: ID.bizA }, body: { maxDailyAutoActions: 50 } });
      expect(res.status, describeBody(res)).toBe(403);
      expect(await snapshot()).toEqual(before);
    });

    it('ST-1(b) positive control: the tier-3 ADMIN releasing the kill switch while bringing the ceiling down to 3 is 200 and written', async () => {
      await setProfile(ID.bizA, { maxTierWithoutApproval: 4 });
      const res = await patch(pipeline, { user: ID.adminA, query: { businessId: ID.bizA }, body: { globalKillSwitch: false, maxTierWithoutApproval: 3 } });
      expect(res.status, describeBody(res)).toBe(200);
      expect(await profile(ID.bizA)).toEqual({ ...BASELINE[ID.bizA], globalKillSwitch: false, maxTierWithoutApproval: 3 });
    });

    it("CR-V103-1: the tier-3 ADMIN saving the web form's full body to switch the kill switch ON under the OWNER's ceiling of 4 is 200 and the kill switch is on", async () => {
      await setProfile(ID.bizA, { globalKillSwitch: false, maxTierWithoutApproval: 4 });
      const res = await patch(pipeline, {
        user: ID.adminA,
        body: webForm(ID.bizA, { ...BASELINE[ID.bizA], globalKillSwitch: true, maxTierWithoutApproval: 4 }),
      });
      expect(res.status, describeBody(res)).toBe(200);
      expect(await profile(ID.bizA)).toEqual({ ...BASELINE[ID.bizA], globalKillSwitch: true, maxTierWithoutApproval: 4 });
    });

    it('CR-V103-1: an ADMIN restricted to tier 2 saving the unchanged form at the default ceiling of 3 is 200; the same form releasing the kill switch is 403', async () => {
      const save = await patch(pipeline, { user: ID.adminA2, body: webForm(ID.bizA, BASELINE[ID.bizA]) });
      expect(save.status, describeBody(save)).toBe(200);
      expect(await profile(ID.bizA)).toEqual(BASELINE[ID.bizA]);
      const before = await snapshot();
      const release = await patch(pipeline, { user: ID.adminA2, body: webForm(ID.bizA, { ...BASELINE[ID.bizA], globalKillSwitch: false }) });
      expect(release.status, describeBody(release)).toBe(403);
      expect(await snapshot()).toEqual(before);
    });

    it('ST-2: a write naming the tenant in the query string leaves one audit row naming the writer, with the stored profile as before', async () => {
      const prior = (await auditRows(ID.bizA)).length;
      const res = await patch(pipeline, { user: ID.adminA, query: { businessId: ID.bizA }, body: { globalKillSwitch: false } });
      expect(res.status, describeBody(res)).toBe(200);
      const rows = await auditRows(ID.bizA);
      expect(rows.length).toBe(prior + 1);
      expect(rows[rows.length - 1]).toMatchObject({
        userId: ID.adminA,
        module: 'settings',
        entityType: 'businessAutonomyProfile',
        entityId: res.body.id,
        meta: {
          before: BASELINE[ID.bizA],
          after: { ...BASELINE[ID.bizA], globalKillSwitch: false },
          changed: ['globalKillSwitch'],
          loosened: ['globalKillSwitch'],
          actorTier: 3,
        },
      });
      expect(rows[rows.length - 1].title).toContain('globalKillSwitch true -> false');
    });

    it("ST-2: a write naming the tenant in the body is audited with the stored profile as before, not the request body; B's audit is untouched", async () => {
      const prior = (await auditRows(ID.bizA)).length;
      const priorB = (await auditRows(ID.bizB)).length;
      const res = await patch(pipeline, { user: ID.ownerA, body: { businessId: ID.bizA, maxTierWithoutApproval: 4 } });
      expect(res.status, describeBody(res)).toBe(200);
      const rows = await auditRows(ID.bizA);
      expect(rows.length).toBe(prior + 1);
      expect(rows[rows.length - 1]).toMatchObject({
        userId: ID.ownerA,
        meta: { before: BASELINE[ID.bizA], after: { ...BASELINE[ID.bizA], maxTierWithoutApproval: 4 }, changed: ['maxTierWithoutApproval'], actorTier: 4 },
      });
      expect((await auditRows(ID.bizB)).length).toBe(priorB);
    });

    it('ST-2: a refused write (STAFF, a tier-3 ADMIN raising the ceiling, a non-member) leaves no audit row', async () => {
      const prior = (await auditRows(ID.bizA)).length;
      for (const [user, body] of [
        [ID.staffA, { globalKillSwitch: false }],
        [ID.adminA, { maxTierWithoutApproval: 4 }],
        [ID.nomember, { globalKillSwitch: false }],
      ] as const) {
        const res = await patch(pipeline, { user, query: { businessId: ID.bizA }, body });
        expect(res.status, `${user} ${describeBody(res)}`).toBe(403);
      }
      expect((await auditRows(ID.bizA)).length).toBe(prior);
    });
  });
}

/* ------------------------------------------------------------------ */
/*  Second review: SEC-V103-1 (stale writes), SEC-V103-2 (the audit's  */
/*  before is the replaced row), SEC-V103-3 (write and audit commit    */
/*  together)                                                          */
/* ------------------------------------------------------------------ */

type ProfileRow = (typeof BASELINE)[string];

/** Resolves once some backend is waiting on a lock the backend `pid` holds. */
async function waitUntilBlockedBy(pid: number) {
  for (let i = 0; i < 400; i++) {
    const [{ n }] = await db.$queryRaw`SELECT count(*)::int AS n FROM pg_stat_activity WHERE ${pid}::int = ANY(pg_blocking_pids(pid))`;
    if (n > 0) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`no request reached its write behind backend ${pid} within 10s`);
}

/**
 * The stored profile changes between a request's guard read and its write, deterministically: the
 * test holds the tenant's profile row locked (as a concurrent write in flight would), sends the
 * request, waits until its UPDATE is blocked behind that lock (the guard read is a plain SELECT, so
 * it has already judged the old row), then applies `concurrent` to the row and commits. Only the
 * lock-holding writer is a transaction; the fixtures are not wrapped.
 */
async function landBetweenCheckAndWrite<T>(businessId: string, send: () => Promise<T>, concurrent: Partial<ProfileRow>): Promise<T> {
  let pending: Promise<T> | undefined;
  await db.$transaction(async (tx: any) => {
    const [{ pid }] = await tx.$queryRaw`SELECT pg_backend_pid()::int AS pid`;
    await tx.$queryRaw`SELECT id FROM business_autonomy_profiles WHERE business_id = ${businessId} FOR UPDATE`;
    pending = send();
    await waitUntilBlockedBy(pid);
    await tx.businessAutonomyProfile.update({ where: { businessId }, data: concurrent });
  }, { timeout: 30_000, maxWait: 10_000 });
  return pending!;
}

/**
 * Whether the audit rows chain from `start` to `end` in some order: the first one's before is
 * `start`, each next one's before is the previous one's after, and the last one's after is `end`.
 */
function chains(rows: Array<{ meta: any }>, start: ProfileRow, end: ProfileRow): boolean {
  const same = (a: unknown, b: unknown) => isDeepStrictEqual(a, b);
  const orders = rows.length === 2 ? [rows, [rows[1], rows[0]]] : [rows];
  return orders.some((order) => {
    let at: unknown = start;
    for (const row of order) {
      if (!same(row.meta.before, at)) return false;
      at = row.meta.after;
    }
    return same(at, end);
  });
}

for (const pipeline of PIPELINES) {
  describe(`PATCH autonomy-profile second review (SEC-V103-1..3) — ${PIPELINE_LABEL[pipeline]}`, () => {
    it("SEC-V103-1: a tier-3 ADMIN's stale resubmission of the OWNER's ceiling of 4 does not overwrite their release of the kill switch with the ceiling lowered to 3: 409, and no audit row", async () => {
      await setProfile(ID.bizA, { globalKillSwitch: true, maxTierWithoutApproval: 4 });
      const prior = (await auditRows(ID.bizA)).length;
      // The release (admitted on its own: it lowers the ceiling to the ADMIN's tier) lands after the
      // stale request's guard read and before its write.
      const res = await landBetweenCheckAndWrite(
        ID.bizA,
        () => patch(pipeline, { user: ID.adminA, query: { businessId: ID.bizA }, body: { maxTierWithoutApproval: 4 } }).then((r) => r),
        { globalKillSwitch: false, maxTierWithoutApproval: 3 },
      );
      expect(res.status, describeBody(res)).toBe(409);
      expect(await profile(ID.bizA)).toEqual({ ...BASELINE[ID.bizA], globalKillSwitch: false, maxTierWithoutApproval: 3 });
      expect((await auditRows(ID.bizA)).length).toBe(prior);
    });

    it("SEC-V103-1: an ADMIN's kill-switch release judged under a ceiling of 3 does not land once the OWNER has raised the ceiling to 4: 409, the kill switch stays on", async () => {
      const prior = (await auditRows(ID.bizA)).length;
      const res = await landBetweenCheckAndWrite(
        ID.bizA,
        () => patch(pipeline, { user: ID.adminA, query: { businessId: ID.bizA }, body: { globalKillSwitch: false } }).then((r) => r),
        { maxTierWithoutApproval: 4 },
      );
      expect(res.status, describeBody(res)).toBe(409);
      expect(await profile(ID.bizA)).toEqual({ ...BASELINE[ID.bizA], globalKillSwitch: true, maxTierWithoutApproval: 4 });
      expect((await auditRows(ID.bizA)).length).toBe(prior);
    });

    it('SEC-V103-1 / SEC-V103-2, the race as the review ran it: the two ADMIN writes sent together never leave the kill switch off under a ceiling of 4, and the audit rows chain from the stored profile to the final one', async () => {
      const start: ProfileRow = { ...BASELINE[ID.bizA], globalKillSwitch: true, maxTierWithoutApproval: 4 };
      const released: ProfileRow = { ...start, globalKillSwitch: false, maxTierWithoutApproval: 3 };
      const seen = new Set<string>();
      for (let round = 0; round < 12; round++) {
        await setProfile(ID.bizA, start);
        const prior = (await auditRows(ID.bizA)).length;
        const [stale, release] = await Promise.all([
          patch(pipeline, { user: ID.adminA, query: { businessId: ID.bizA }, body: { maxTierWithoutApproval: 4 } }).then((r) => r),
          patch(pipeline, { user: ID.adminA, query: { businessId: ID.bizA }, body: { globalKillSwitch: false, maxTierWithoutApproval: 3 } }).then((r) => r),
        ]);
        seen.add(`${stale.status}/${release.status}`);
        // The stale write changes no setting, so the release always lands. The stale one lands only
        // before it (200); judged before it and landing after, it is 409; judged after it, it raises
        // the ceiling from 3 to 4 and the guard refuses it (403).
        expect(release.status, `round ${round} ${describeBody(release)}`).toBe(200);
        expect([200, 403, 409], `round ${round} ${describeBody(stale)}`).toContain(stale.status);
        expect(await profile(ID.bizA), `round ${round}`).toEqual(released);
        const rows = (await auditRows(ID.bizA)).slice(prior);
        expect(rows.length, `round ${round}`).toBe([stale, release].filter((r) => r.status === 200).length);
        expect(chains(rows, start, released), `round ${round} ${JSON.stringify(rows.map((r: any) => r.meta))}`).toBe(true);
        const releaseRow = rows.find((r: any) => r.meta.changed.includes('globalKillSwitch'));
        expect(releaseRow?.meta).toMatchObject({ before: { globalKillSwitch: true, maxTierWithoutApproval: 4 }, loosened: ['globalKillSwitch'], actorTier: 3 });
      }
      for (const statuses of seen) expect(['200/200', '403/200', '409/200']).toContain(statuses);
    }, 60_000);

    it('SEC-V103-3: when the audit row cannot be inserted the write rolls back: 500, the kill switch stays on and no audit row', async () => {
      await db.$executeRawUnsafe(
        `CREATE OR REPLACE FUNCTION ${AUDIT_REFUSAL}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'v03a: audit insert refused'; END $$`,
      );
      await db.$executeRawUnsafe(
        `CREATE TRIGGER ${AUDIT_REFUSAL} BEFORE INSERT ON team_activity_logs FOR EACH ROW
           WHEN (NEW.business_id = '${ID.bizA}') EXECUTE FUNCTION ${AUDIT_REFUSAL}()`,
      );
      try {
        const before = await snapshot();
        const prior = (await auditRows(ID.bizA)).length;
        const res = await patch(pipeline, { user: ID.adminA, query: { businessId: ID.bizA }, body: { globalKillSwitch: false } });
        expect(res.status, describeBody(res)).toBe(500);
        expect(await snapshot()).toEqual(before);
        expect((await profile(ID.bizA))!.globalKillSwitch).toBe(true);
        expect((await auditRows(ID.bizA)).length).toBe(prior);
      } finally {
        await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${AUDIT_REFUSAL} ON team_activity_logs`);
        await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${AUDIT_REFUSAL}()`);
      }
      // The same write goes through once the insert is allowed again.
      const again = await patch(pipeline, { user: ID.adminA, query: { businessId: ID.bizA }, body: { globalKillSwitch: false } });
      expect(again.status, describeBody(again)).toBe(200);
      expect((await profile(ID.bizA))!.globalKillSwitch).toBe(false);
    });
  });
}
