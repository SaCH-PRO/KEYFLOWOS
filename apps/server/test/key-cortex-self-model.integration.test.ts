/**
 * V1-63 (TOF-KEY-SELF-MODEL, P105, D-129 / D-141) — KEY operational self-model
 * read projection on GET /api/v1/cortex/context (REAL Postgres).
 *
 * Proves:
 *   1. D-129: OWNER, co-owner (OWNER membership, not Business.ownerId), and
 *      platform SUPER_ADMIN calling GET /api/v1/cortex/context receive
 *      `selfModel` composed from real Postgres rows and canonical capability
 *      contracts:
 *        - AiGoal rows with uppercase status in ['ACTIVE', 'PLANNED', 'IN_PROGRESS']
 *          (excluding COMPLETED, ARCHIVED, and lowercase 'active');
 *        - KeyActionProposal rows with status 'PENDING', exposing `riskLevel`
 *          (never `riskTier`) and a `byRiskLevel` count breakdown (excluding
 *          APPROVED / REJECTED proposals);
 *        - Metacognition metrics and explicit operational limitations.
 *   2. Tenant isolation: another business's seeded goals and proposals never
 *      appear in the caller's selfModel.
 *   3. D-129 refusal: ADMIN, STAFF, recorded Business.ownerId holding only
 *      ADMIN membership, cross-tenant OWNER who is STAFF here, non-members,
 *      and unauthenticated requests receive 403/401 and never invoke
 *      KeyCortexOperationalSelfModelService.build().
 *   4. D-141 error surfacing: when aiGoal.findMany, keyActionProposal.findMany,
 *      or metacognition.buildSelfModel rejects, that section is reported as
 *      explicitly `unavailable` (with `null` data, `sections.<name>.status ===
 *      'unavailable'`, `unavailableSections`, and a `limitations` note — never
 *      indistinguishable from an empty `[]` success, and never leaking raw
 *      SQL/secrets) while healthy sibling sections remain `available`.
 *
 * Every seeded row carries the `v63a_` prefix (registered in
 * test/helpers/fixture-prefixes.json) and is hard-deleted by raw SQL with
 * sqlLikePrefix(P) in beforeAll and afterAll.
 */
import 'reflect-metadata';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v63a_';
const HEADER = 'x-v63a-user';

const ID = {
  owner: `${P}owner`,
  coOwner: `${P}coowner`,
  admin: `${P}admin`,
  staff: `${P}staff`,
  recordedAdmin: `${P}recorded_admin`,
  ownerElsewhere: `${P}owner_elsewhere`,
  superAdmin: `${P}super`,
  nonMember: `${P}nonmember`,
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  bizC: `${P}bizC`,
  goalActive: `${P}goal_active`,
  goalInProgress: `${P}goal_in_progress`,
  goalPlanned: `${P}goal_planned`,
  goalCompleted: `${P}goal_completed`,
  goalArchived: `${P}goal_archived`,
  goalLowercase: `${P}goal_lowercase`,
  goalBizC: `${P}goal_bizC`,
  propHigh1: `${P}prop_high_1`,
  propHigh2: `${P}prop_high_2`,
  propMedium: `${P}prop_medium`,
  propLow: `${P}prop_low`,
  propApproved: `${P}prop_approved`,
  propRejected: `${P}prop_rejected`,
  propBizC: `${P}prop_bizC`,
};

const CONTEXT_MARKER = 'v63a-context-marker';
const FORMATTED_MARKER = 'v63a formatted context marker';

const OFF_BOUNDARY = new Set([
  'KeyCortexReasoningService',
  'KeyCortexConversationService',
  'KeyCortexVoiceService',
  'KeyCortexPersonalityService',
  'KeyCortexActionsService',
  'KeyCortexContextService',
  'KeyCortexConnectorService',
  'KeyCortexCommandService',
  'KeyCortexExecutorService',
  'KeyCortexInsightService',
  'KeyCortexMonitorV2Service',
  'KeyCortexSandboxService',
  'KeyCortexFlowStudioService',
  'KeyCortexEvolutionService',
  'KeyCortexPhoneService',
  'KeyCortexDocumentService',
  'KeyCortexLearningService',
  'KeyAutonomySafetyService',
  'KeyCortexApprovalOrchestratorService',
  'KeyCortexConsciousnessService',
  'KeyCortexSessionService',
  'KeyCortexAwarenessService',
]);

interface StubCall {
  method: string;
  businessId: unknown;
}

const calls: StubCall[] = [];
const callsSince = (from: number) => calls.slice(from);

let db: any;
let app: any;
let metacognitionService: any;
let buildSpy: ReturnType<typeof vi.spyOn> | undefined;

let failAiGoal: Error | null = null;
let failProposal: Error | null = null;

async function cleanup() {
  for (const sql of [
    `DELETE FROM key_action_proposals WHERE business_id LIKE ${sqlLikePrefix(P)} OR id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM ai_goals WHERE business_id LIKE ${sqlLikePrefix(P)} OR id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM business_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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

function getContext(user: string | undefined, businessId: string) {
  let req = request(app.getHttpServer()).get('/api/v1/cortex/context');
  if (user) req = req.set(HEADER, user);
  return req.query({ businessId });
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { ValidationPipe } = await import('@nestjs/common');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { CapabilityContractService } = await import('../src/modules/capabilities/capability-contract.service');
  const { KeyCortexController } = await import('../src/modules/key-cortex/key-cortex.controller');
  const { KeyCortexContextV2Service } = await import('../src/modules/key-cortex/key-cortex-context-v2.service');
  const { KeyCortexEventService } = await import('../src/modules/key-cortex/key-cortex-event.service');
  const { KeyCortexEvidenceService } = await import('../src/modules/key-cortex/key-cortex-evidence.service');
  const { KeyCortexMetacognitionService } = await import('../src/modules/key-cortex/key-cortex-metacognition.service');

  const selfModelFile = path.resolve(
    __dirname,
    '../src/modules/key-cortex/key-cortex-operational-self-model.service.ts',
  );
  let KeyCortexOperationalSelfModelService: any;
  if (existsSync(selfModelFile)) {
    const mod = await import(selfModelFile);
    KeyCortexOperationalSelfModelService = mod.KeyCortexOperationalSelfModelService;
  }

  const realPrisma = new PrismaService();
  await realPrisma.onModuleInit();

  const instrumentedClient = new Proxy(realPrisma.client as any, {
    get(target, prop, receiver) {
      if (prop === 'aiGoal' && failAiGoal) {
        const err = failAiGoal;
        return new Proxy(Reflect.get(target, prop, receiver), {
          get(modelTarget, modelProp, modelReceiver) {
            if (modelProp === 'findMany') {
              return () => Promise.reject(err);
            }
            return Reflect.get(modelTarget, modelProp, modelReceiver);
          },
        });
      }
      if (prop === 'keyActionProposal' && failProposal) {
        const err = failProposal;
        return new Proxy(Reflect.get(target, prop, receiver), {
          get(modelTarget, modelProp, modelReceiver) {
            if (modelProp === 'findMany') {
              return () => Promise.reject(err);
            }
            return Reflect.get(modelTarget, modelProp, modelReceiver);
          },
        });
      }
      return Reflect.get(target, prop, receiver);
    },
  });

  const prismaProvider = new Proxy(realPrisma as any, {
    get(target, prop, receiver) {
      if (prop === 'client') return instrumentedClient;
      return Reflect.get(target, prop, receiver);
    },
  });

  const contextV2 = {
    getFullContext: async (businessId: unknown) => {
      calls.push({ method: 'contextV2.getFullContext', businessId });
      return { businessId, marker: CONTEXT_MARKER };
    },
    formatContextForPrompt: (context: any) => {
      calls.push({ method: 'contextV2.formatContextForPrompt', businessId: context?.businessId });
      return FORMATTED_MARKER;
    },
  };

  const providers: any[] = [
    { provide: PrismaService, useValue: prismaProvider },
    AuthGuard,
    BusinessGuard,
    ModuleScopeGuard,
    CapabilityContractService,
    KeyCortexEventService,
    KeyCortexEvidenceService,
    KeyCortexMetacognitionService,
    { provide: KeyCortexContextV2Service, useValue: contextV2 },
  ];
  if (KeyCortexOperationalSelfModelService) {
    providers.push(KeyCortexOperationalSelfModelService);
  }

  const moduleRef = await Test.createTestingModule({
    controllers: [KeyCortexController],
    providers,
  })
    .useMocker((token: any) => {
      const name = typeof token === 'function' ? token.name : String(token);
      return OFF_BOUNDARY.has(name) ? {} : undefined;
    })
    .compile();

  metacognitionService = moduleRef.get(KeyCortexMetacognitionService);
  if (KeyCortexOperationalSelfModelService) {
    const selfModelService = moduleRef.get(KeyCortexOperationalSelfModelService);
    buildSpy = vi.spyOn(selfModelService, 'build');
  }

  app = moduleRef.createNestApplication();
  app.use(async (req: any, _res: any, next: any) => {
    const header = req.headers[HEADER];
    const id = typeof header === 'string' ? header : undefined;
    if (id && id.startsWith(P)) {
      const user = await db.user.findUnique({
        where: { id },
        select: { id: true, email: true, role: true },
      });
      if (user) req.user = { id: user.id, email: user.email, role: user.role };
    }
    next();
  });
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();

  await cleanup();

  for (const [id, role] of [
    [ID.owner, 'USER'],
    [ID.coOwner, 'USER'],
    [ID.admin, 'USER'],
    [ID.staff, 'USER'],
    [ID.recordedAdmin, 'USER'],
    [ID.ownerElsewhere, 'USER'],
    [ID.superAdmin, 'SUPER_ADMIN'],
    [ID.nonMember, 'USER'],
  ] as const) {
    await db.user.create({
      data: { id, email: `${P}${id.slice(P.length)}@test.local`, role },
    });
  }

  await db.business.create({ data: { id: ID.bizA, name: 'V63A Biz A', ownerId: ID.owner } });
  await db.business.create({ data: { id: ID.bizB, name: 'V63A Biz B', ownerId: ID.recordedAdmin } });
  await db.business.create({ data: { id: ID.bizC, name: 'V63A Biz C', ownerId: ID.ownerElsewhere } });

  const memberships: Array<{ userId: string; businessId: string; role: string }> = [
    { userId: ID.owner, businessId: ID.bizA, role: 'OWNER' },
    { userId: ID.coOwner, businessId: ID.bizA, role: 'OWNER' },
    { userId: ID.admin, businessId: ID.bizA, role: 'ADMIN' },
    { userId: ID.staff, businessId: ID.bizA, role: 'STAFF' },
    { userId: ID.recordedAdmin, businessId: ID.bizB, role: 'ADMIN' },
    { userId: ID.ownerElsewhere, businessId: ID.bizC, role: 'OWNER' },
    { userId: ID.ownerElsewhere, businessId: ID.bizA, role: 'STAFF' },
  ];
  for (const m of memberships) {
    await db.membership.create({
      data: { id: `${P}m_${m.userId.slice(P.length)}_${m.businessId.slice(P.length)}`, ...m },
    });
  }

  const targetDate = new Date('2026-12-31T00:00:00.000Z');
  for (const goal of [
    { id: ID.goalActive, businessId: ID.bizA, title: `${P}Grow recurring revenue`, status: 'ACTIVE', priority: 10, targetDate },
    { id: ID.goalInProgress, businessId: ID.bizA, title: `${P}Automate client onboarding`, status: 'IN_PROGRESS', priority: 8, targetDate: null },
    { id: ID.goalPlanned, businessId: ID.bizA, title: `${P}Launch partner channel`, status: 'PLANNED', priority: 6, targetDate: null },
    { id: ID.goalCompleted, businessId: ID.bizA, title: `${P}Completed legacy goal`, status: 'COMPLETED', priority: 99, targetDate: null },
    { id: ID.goalArchived, businessId: ID.bizA, title: `${P}Archived legacy goal`, status: 'ARCHIVED', priority: 98, targetDate: null },
    { id: ID.goalLowercase, businessId: ID.bizA, title: `${P}Lowercase status goal`, status: 'active', priority: 97, targetDate: null },
    { id: ID.goalBizC, businessId: ID.bizC, title: `${P}BizC confidential goal`, status: 'ACTIVE', priority: 50, targetDate: null },
  ]) {
    await db.aiGoal.create({ data: goal });
  }

  for (const proposal of [
    {
      id: ID.propHigh1,
      businessId: ID.bizA,
      sourceType: 'PROACTIVE_ENGINE',
      title: `${P}High risk money move`,
      actionType: 'EXECUTE_TOOL',
      capabilityName: 'finance_money_moves',
      riskLevel: 'HIGH',
      status: 'PENDING',
    },
    {
      id: ID.propHigh2,
      businessId: ID.bizA,
      sourceType: 'PROACTIVE_ENGINE',
      title: `${P}High risk refund`,
      actionType: 'EXECUTE_TOOL',
      capabilityName: 'commerce_refund_invoice',
      riskLevel: 'HIGH',
      status: 'PENDING',
    },
    {
      id: ID.propMedium,
      businessId: ID.bizA,
      sourceType: 'PROACTIVE_ENGINE',
      title: `${P}Medium risk contact merge`,
      actionType: 'EXECUTE_TOOL',
      capabilityName: 'crm_merge_execute',
      riskLevel: 'MEDIUM',
      status: 'PENDING',
    },
    {
      id: ID.propLow,
      businessId: ID.bizA,
      sourceType: 'PROACTIVE_ENGINE',
      title: `${P}Low risk follow-up task`,
      actionType: 'EXECUTE_TOOL',
      capabilityName: 'create_task',
      riskLevel: 'LOW',
      status: 'PENDING',
    },
    {
      id: ID.propApproved,
      businessId: ID.bizA,
      sourceType: 'PROACTIVE_ENGINE',
      title: `${P}Already approved proposal`,
      actionType: 'EXECUTE_TOOL',
      capabilityName: 'finance_money_moves',
      riskLevel: 'CRITICAL',
      status: 'APPROVED',
    },
    {
      id: ID.propRejected,
      businessId: ID.bizA,
      sourceType: 'PROACTIVE_ENGINE',
      title: `${P}Already rejected proposal`,
      actionType: 'EXECUTE_TOOL',
      capabilityName: 'finance_money_moves',
      riskLevel: 'HIGH',
      status: 'REJECTED',
    },
    {
      id: ID.propBizC,
      businessId: ID.bizC,
      sourceType: 'PROACTIVE_ENGINE',
      title: `${P}BizC confidential proposal`,
      actionType: 'EXECUTE_TOOL',
      capabilityName: 'finance_money_moves',
      riskLevel: 'CRITICAL',
      status: 'PENDING',
    },
  ]) {
    await db.keyActionProposal.create({ data: proposal });
  }
}, 180_000);

afterEach(() => {
  failAiGoal = null;
  failProposal = null;
});

afterAll(async () => {
  if (db) await cleanup();
  if (app) await app.close();
});

describe('V1-63 TOF-KEY-SELF-MODEL fixture sanity (real rows)', () => {
  it('seeds real goals and pending proposals across bizA and bizC', async () => {
    expect(await db.aiGoal.count({ where: { businessId: ID.bizA } })).toBe(6);
    expect(await db.aiGoal.count({ where: { businessId: ID.bizC } })).toBe(1);
    expect(await db.keyActionProposal.count({ where: { businessId: ID.bizA } })).toBe(6);
    expect(await db.keyActionProposal.count({ where: { businessId: ID.bizC } })).toBe(1);
  });
});

describe('V1-63 TOF-KEY-SELF-MODEL D-129: non-owner and unauthenticated callers are refused before selfModel is built', () => {
  let from = 0;

  beforeEach(() => {
    from = calls.length;
    buildSpy?.mockClear();
  });

  it.each([
    ['an ADMIN member', ID.admin, ID.bizA],
    ['a STAFF member', ID.staff, ID.bizA],
    ['the recorded Business.ownerId holding only ADMIN membership', ID.recordedAdmin, ID.bizB],
    ['the OWNER of another business who is only STAFF here', ID.ownerElsewhere, ID.bizA],
    ['a non-member', ID.nonMember, ID.bizA],
  ])('D-129: %s receives 403 and never invokes operationalSelfModel.build', async (_label, user, businessId) => {
    const res = await getContext(user, businessId);
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(callsSince(from)).toEqual([]);
    if (buildSpy) expect(buildSpy).not.toHaveBeenCalled();
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain(ID.goalActive);
    expect(serialized).not.toContain(ID.propHigh1);
  });

  it('D-129: an unauthenticated caller receives 401 and never invokes operationalSelfModel.build', async () => {
    const res = await getContext(undefined, ID.bizA);
    expect(res.status, JSON.stringify(res.body)).toBe(401);
    expect(callsSince(from)).toEqual([]);
    if (buildSpy) expect(buildSpy).not.toHaveBeenCalled();
  });
});

describe('V1-63 TOF-KEY-SELF-MODEL D-129/D-141: GET /api/v1/cortex/context carries selfModel with uppercase goals and riskLevel breakdown', () => {
  it('OWNER receives selfModel with ACTIVE/PLANNED/IN_PROGRESS goals, PENDING riskLevel proposals + byRiskLevel, and no non-active or cross-tenant rows', async () => {
    const res = await getContext(ID.owner, ID.bizA);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.context).toEqual({ businessId: ID.bizA, marker: CONTEXT_MARKER });
    expect(res.body.formatted).toBe(FORMATTED_MARKER);

    const sm = res.body.selfModel;
    expect(sm, 'selfModel must be present on GET /api/v1/cortex/context').toBeDefined();
    expect(sm.identity).toEqual({ agent: 'KEY', stableAcrossProviders: true });
    expect(sm.scope).toEqual({ businessId: ID.bizA, userId: ID.owner });
    expect(sm).not.toHaveProperty('provider');
    expect(sm).not.toHaveProperty('authorityGrant');

    expect(sm.capabilities.total).toBeGreaterThan(0);
    expect(Array.isArray(sm.capabilities.sample)).toBe(true);
    expect(sm.capabilities.sample.length).toBeGreaterThan(0);

    // Fix 1: uppercase goal statuses only, ordered by priority desc
    expect(sm.sections.goals).toEqual({ status: 'available' });
    expect(sm.goals.map((g: any) => g.id)).toEqual([
      ID.goalActive,
      ID.goalInProgress,
      ID.goalPlanned,
    ]);
    expect(sm.goals.map((g: any) => g.status)).toEqual(['ACTIVE', 'IN_PROGRESS', 'PLANNED']);
    expect(sm.goals[0].targetDate).toBe('2026-12-31T00:00:00.000Z');
    const goalIds = sm.goals.map((g: any) => g.id);
    expect(goalIds).not.toContain(ID.goalCompleted);
    expect(goalIds).not.toContain(ID.goalArchived);
    expect(goalIds).not.toContain(ID.goalLowercase);
    expect(goalIds).not.toContain(ID.goalBizC);

    // Fix 2: PENDING proposals with riskLevel (never riskTier) + byRiskLevel breakdown
    expect(sm.sections.pendingDecisions).toEqual({ status: 'available' });
    const pendingIds = sm.pendingDecisions.map((p: any) => p.id).sort();
    expect(pendingIds).toEqual([ID.propHigh1, ID.propHigh2, ID.propLow, ID.propMedium].sort());
    for (const item of sm.pendingDecisions) {
      expect(typeof item.riskLevel).toBe('string');
      expect(item).not.toHaveProperty('riskTier');
    }
    expect(sm.byRiskLevel).toEqual({ HIGH: 2, MEDIUM: 1, LOW: 1 });
    expect(pendingIds).not.toContain(ID.propApproved);
    expect(pendingIds).not.toContain(ID.propRejected);
    expect(pendingIds).not.toContain(ID.propBizC);

    // Metacognition and explicit health-sampling limitation
    expect(sm.sections.metacognition).toEqual({ status: 'available' });
    expect(sm.metacognition).not.toBeNull();
    expect(typeof sm.metacognition.recommendationAccuracy).toBe('number');
    expect(Array.isArray(sm.metacognition.knowledgeGaps)).toBe(true);
    expect(Array.isArray(sm.metacognition.dataGaps)).toBe(true);
    expect(sm.unavailableSections).toEqual([]);
    expect(sm.limitations.join(' ')).toContain('health-aware action admission');
    expect(typeof sm.generatedAt).toBe('string');
  });

  it('co-owner (OWNER membership, not Business.ownerId) receives selfModel scoped to bizA and coOwner userId', async () => {
    const res = await getContext(ID.coOwner, ID.bizA);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.selfModel).toBeDefined();
    expect(res.body.selfModel.scope).toEqual({ businessId: ID.bizA, userId: ID.coOwner });
    expect(res.body.selfModel.goals.map((g: any) => g.id)).toEqual([
      ID.goalActive,
      ID.goalInProgress,
      ID.goalPlanned,
    ]);
    expect(res.body.selfModel.byRiskLevel).toEqual({ HIGH: 2, MEDIUM: 1, LOW: 1 });
  });

  it('platform SUPER_ADMIN (no membership) receives selfModel for bizA', async () => {
    const res = await getContext(ID.superAdmin, ID.bizA);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.selfModel).toBeDefined();
    expect(res.body.selfModel.scope).toEqual({ businessId: ID.bizA, userId: ID.superAdmin });
    expect(res.body.selfModel.goals.map((g: any) => g.id)).toEqual([
      ID.goalActive,
      ID.goalInProgress,
      ID.goalPlanned,
    ]);
    expect(res.body.selfModel.byRiskLevel).toEqual({ HIGH: 2, MEDIUM: 1, LOW: 1 });
  });

  it('tenant isolation: OWNER of bizC sees only bizC goals and proposals, never bizA rows', async () => {
    const res = await getContext(ID.ownerElsewhere, ID.bizC);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const sm = res.body.selfModel;
    expect(sm).toBeDefined();
    expect(sm.scope).toEqual({ businessId: ID.bizC, userId: ID.ownerElsewhere });
    expect(sm.goals.map((g: any) => g.id)).toEqual([ID.goalBizC]);
    expect(sm.pendingDecisions.map((p: any) => p.id)).toEqual([ID.propBizC]);
    expect(sm.byRiskLevel).toEqual({ CRITICAL: 1 });
    const serialized = JSON.stringify(sm);
    expect(serialized).not.toContain(ID.goalActive);
    expect(serialized).not.toContain(ID.propHigh1);
  });
});

describe('V1-63 TOF-KEY-SELF-MODEL D-141: Prisma / dependency failure surfaces explicit unavailable state (never empty [] success)', () => {
  it('aiGoal.findMany failure marks goals unavailable (null, not []) while pendingDecisions and metacognition remain available', async () => {
    failAiGoal = Object.assign(
      new Error('SELECT * FROM ai_goals WHERE password=v63a_secret_goal_leak'),
      { code: 'P2024' },
    );

    const res = await getContext(ID.owner, ID.bizA);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const sm = res.body.selfModel;
    expect(sm).toBeDefined();

    expect(sm.goals).toBeNull();
    expect(sm.sections.goals.status).toBe('unavailable');
    expect(typeof sm.sections.goals.error).toBe('string');
    expect(sm.unavailableSections).toEqual(['goals']);
    expect(sm.limitations.join(' ').toLowerCase()).toContain('goals');
    expect(sm.limitations.join(' ').toLowerCase()).toContain('unavailable');

    // Sibling sections remain healthy
    expect(sm.sections.pendingDecisions).toEqual({ status: 'available' });
    expect(sm.pendingDecisions).toHaveLength(4);
    expect(sm.byRiskLevel).toEqual({ HIGH: 2, MEDIUM: 1, LOW: 1 });
    expect(sm.sections.metacognition).toEqual({ status: 'available' });
    expect(sm.metacognition).not.toBeNull();

    // Raw internal SQL / secret details must not leak
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain('v63a_secret_goal_leak');
    expect(serialized).not.toContain('SELECT * FROM ai_goals');
  });

  it('keyActionProposal.findMany failure marks pendingDecisions unavailable (null, not []) while goals and metacognition remain available', async () => {
    failProposal = new Error('SELECT * FROM key_action_proposals token=v63a_secret_prop_leak');

    const res = await getContext(ID.owner, ID.bizA);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const sm = res.body.selfModel;
    expect(sm).toBeDefined();

    expect(sm.pendingDecisions).toBeNull();
    expect(sm.byRiskLevel).toBeNull();
    expect(sm.sections.pendingDecisions.status).toBe('unavailable');
    expect(typeof sm.sections.pendingDecisions.error).toBe('string');
    expect(sm.unavailableSections).toEqual(['pendingDecisions']);
    expect(sm.limitations.join(' ').toLowerCase()).toContain('pendingdecisions');
    expect(sm.limitations.join(' ').toLowerCase()).toContain('unavailable');

    // Sibling sections remain healthy
    expect(sm.sections.goals).toEqual({ status: 'available' });
    expect(sm.goals).toHaveLength(3);
    expect(sm.sections.metacognition).toEqual({ status: 'available' });
    expect(sm.metacognition).not.toBeNull();

    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain('v63a_secret_prop_leak');
    expect(serialized).not.toContain('SELECT * FROM key_action_proposals');
  });

  it('metacognition.buildSelfModel failure marks metacognition unavailable (null) while goals and pendingDecisions remain available', async () => {
    const spy = vi
      .spyOn(metacognitionService, 'buildSelfModel')
      .mockRejectedValueOnce(new Error('SELECT * FROM business_events key=v63a_secret_meta_leak'));

    try {
      const res = await getContext(ID.owner, ID.bizA);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const sm = res.body.selfModel;
      expect(sm).toBeDefined();

      expect(sm.metacognition).toBeNull();
      expect(sm.sections.metacognition.status).toBe('unavailable');
      expect(typeof sm.sections.metacognition.error).toBe('string');
      expect(sm.unavailableSections).toEqual(['metacognition']);
      expect(sm.limitations.join(' ').toLowerCase()).toContain('metacognition');
      expect(sm.limitations.join(' ').toLowerCase()).toContain('unavailable');

      // Sibling sections remain healthy
      expect(sm.sections.goals).toEqual({ status: 'available' });
      expect(sm.goals).toHaveLength(3);
      expect(sm.sections.pendingDecisions).toEqual({ status: 'available' });
      expect(sm.pendingDecisions).toHaveLength(4);
      expect(sm.byRiskLevel).toEqual({ HIGH: 2, MEDIUM: 1, LOW: 1 });

      const serialized = JSON.stringify(res.body);
      expect(serialized).not.toContain('v63a_secret_meta_leak');
      expect(serialized).not.toContain('SELECT * FROM business_events');
    } finally {
      spy.mockRestore();
    }
  });
});
