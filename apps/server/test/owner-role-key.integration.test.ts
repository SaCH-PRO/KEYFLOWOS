/**
 * W11-D116-KEY-OWNER — owner rulings D-116 and D-125 (2026-11-12) on the KEY
 * owner checks, the autonomy-profile write guard and the mail addressed to the
 * business owner. REAL database.
 *
 * THE RULE (D-116, read by D-125): an owner-only action needs an OWNER-role
 * Membership of this business. A co-owner (an OWNER membership, not
 * Business.ownerId) IS the owner; Business.ownerId grants nothing on its own;
 * a recorded owner (Business.ownerId) who holds only an ADMIN or STAFF
 * membership is that role. D-119: KEY chat (and the plan queue) stays
 * fail-closed for a tool the member authority map does not map (a dotted organ
 * or legacy cortex tool): only the business owner runs it; ADMINs are not
 * admitted.
 *
 * THE DEFECT (at fb00af1c): each check below admitted Business.ownerId holding
 * ANY membership, through an arm
 * `business.findFirst({ where: { id, ownerId: X, members: { some: { userId: X } } } })`
 * (owner ruling D-104 had only required that some Membership exist):
 *
 *   memberToolRunAuthority (plan-step-authority.ts; KEY chat's tool calls, the plan
 *       queue, the proposal executor, the Pro Auto monitor): the owner arm runs every
 *       mapped tool and every unmapped (D-119 owner-only) tool, so a recorded owner
 *       holding ADMIN ran owner-only tools;
 *   PUT ai/businesses/:businessId/agent/triggers/:triggerId (agent-trigger.service.ts
 *       isBusinessOwner): owner-run default rules (AGENT_TRIGGER_OWNER_ONLY) and
 *       schedules (AGENT_TRIGGER_SCHEDULE_OWNER_ONLY);
 *   KeyCortexPlannerService.executePlan (isBusinessOwner): the owner runs a plan no
 *       member created;
 *   PATCH api/v1/cortex/autonomy-profile (AutonomyProfileWriteGuard.writerTier): a
 *       member outside {OWNER, ADMIN} who is Business.ownerId wrote at the OWNER tier,
 *       so a recorded owner holding STAFF could release the kill switch and raise
 *       maxTierWithoutApproval to 4;
 *   businessOwnerRecipient (business.guard.ts; weekly financial briefing, quote alerts,
 *       AI usage alerts): mailed the business's figures to a recorded owner holding STAFF.
 *
 * FIXTURES (prefix v97x_, registered in test/helpers/fixture-prefixes.json):
 *   bizA  Business.ownerId = recAdmin, who holds an ADMIN membership (role defaults);
 *         coOwner holds an OWNER membership and is not Business.ownerId (D-125: the owner).
 *   bizS  Business.ownerId = recStaff, who holds a STAFF membership (role defaults).
 *   bizO  Business.ownerId = ownerO, who holds an OWNER membership (the control).
 * Cases tagged RED-BEFORE fail at the packet's base. The co-owner and the
 * OWNER-holding recorded owner are the owner on every surface (controls, except
 * where a case says the co-owner was refused at the base); the recorded owner
 * holding ADMIN keeps the ADMIN rights below owner-only tools (the ADMIN
 * approval tier on the autonomy profile).
 *
 * COMPOSITION (the contacts-visibility / autonomy-profile-authority model): one
 * real Nest app on the real database with the real AgentController (PUT
 * agent/triggers) and KeyCortexController (PATCH autonomy-profile), the real
 * PrismaService, AuthGuard, BusinessGuard, AutonomyProfileWriteGuard,
 * AutonomyProfileAuditInterceptor, KeyAutonomySafetyService, the production
 * TenantInterceptor (global, as AppModule registers it) and the production
 * GlobalHttpExceptionFilter and ValidationPipe; the controllers' collaborators
 * for routes this suite does not call are inert. The one stand-in on the
 * authorization path is identity attachment: a test middleware reads
 * `x-v97x-user` and attaches the seeded user's { id, email, role } exactly as
 * AuthMiddleware does. memberToolRunAuthority and businessOwnerRecipient are
 * called with that PrismaService. KeyCortexPlannerService runs with the real
 * KeyCortexExecutorService and KeyCortexSagaService; the connector the
 * executor routes through is a recorder (no adapter or provider is reached) and
 * the autonomy orchestrator allows. KEY is never asked to reason (no model, no
 * provider traffic).
 *
 * Every row is hard-deleted with LIKE ${sqlLikePrefix(P)} in beforeAll and
 * afterAll. No $transaction wrapping.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { sqlLikePrefix } from './helpers/sql-like.js';

vi.setConfig({ testTimeout: 60_000 });

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL.
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v97x_';
const HEADER = 'x-v97x-user';

const ID = {
  recAdmin: `${P}recAdmin`, // Business.ownerId of bizA; ADMIN membership on bizA (role defaults)
  coOwner: `${P}coOwner`,   // OWNER membership on bizA, not Business.ownerId (D-125: the owner)
  recStaff: `${P}recStaff`, // Business.ownerId of bizS; STAFF membership on bizS (role defaults)
  ownerO: `${P}ownerO`,     // Business.ownerId of bizO and its OWNER membership (control)
  bizA: `${P}bizA`,
  bizS: `${P}bizS`,
  bizO: `${P}bizO`,
};
const USERS = [ID.recAdmin, ID.coOwner, ID.recStaff, ID.ownerO];
const BUSINESSES = [ID.bizA, ID.bizS, ID.bizO];
const OWNER_OF: Record<string, string> = { [ID.bizA]: ID.recAdmin, [ID.bizS]: ID.recStaff, [ID.bizO]: ID.ownerO };

/** An owner-only graph tool (CRM_ROW_VISIBILITY_TOOLS: it writes a contact with no actor) whose module scope an ADMIN holds. */
const OWNER_ONLY_TOOL = 'crm_update_contact';
/** A dotted organ tool the authority map does not map (D-119: only the business owner runs it). */
const UNMAPPED_TOOL = 'cortex.execute_tool';
/** A tool the authority map never runs, whoever asks (KEY-R3b review SEC-R3b-2). */
const REFUSED_TOOL = 'execute_custom_logic';
const OWNER_ONLY_REFUSAL = /^Tool "crm_update_contact" is executed from here only for the business owner: /;
const UNMAPPED_REFUSAL = 'Tool "cortex.execute_tool" is mapped to no module scope, so it is not executed from this route';

/** The profile each tenant holds before every autonomy case: the kill switch on, a tier ceiling of 3. */
const BASELINE_PROFILE = { globalKillSwitch: true, maxDailyAutoActions: 10, maxDailySpendTtd: 0, maxTierWithoutApproval: 3, notifyOnBlock: true };

/** The collaborators the two controllers hold for their other routes; the routes under test reach none of them. */
const OFF_BOUNDARY = new Set([
  // AgentController
  'AgentStateMachineService', 'AgentBusService', 'PatternDetectorService', 'UndoService',
  'CalendarIntelligenceService', 'DocumentIntelligenceService', 'SemanticMemoryService',
  // KeyCortexController
  'KeyCortexReasoningService', 'KeyCortexConversationService', 'KeyCortexVoiceService', 'KeyCortexPersonalityService',
  'KeyCortexActionsService', 'KeyCortexContextService', 'KeyCortexConnectorService', 'KeyCortexCommandService',
  'KeyCortexExecutorService', 'KeyCortexContextV2Service', 'KeyCortexInsightService', 'KeyCortexMonitorV2Service',
  'KeyCortexSandboxService', 'KeyCortexFlowStudioService', 'KeyCortexEvolutionService', 'KeyCortexPhoneService',
  'KeyCortexDocumentService', 'KeyCortexLearningService', 'KeyCortexApprovalOrchestratorService',
  'KeyCortexConsciousnessService', 'KeyCortexSessionService', 'KeyCortexAwarenessService',
]);

let db: any;
let app: any;
let plannerModule: any;
let prismaSvc: any;
let planner: any;
let executor: any;
let memberToolRunAuthority: (prisma: any, businessId: string, memberId: string, toolName: string, options?: { asPrincipal?: boolean }) => Promise<{ refusal: string | null; principal: boolean }>;
let businessOwnerRecipient: (prisma: any, businessId: string, ownerId: string | null | undefined) => Promise<{ email: string | null; name: string | null } | null>;
let DEFAULT_AGENT_TRIGGERS: ReadonlyArray<{ name: string; eventPattern: string; objective: string; maxRiskTier: number; autoExecute: boolean }>;
let TRIGGER_RULE_CREATOR_KEY: string;

interface Routed { marker: unknown; module: unknown; action: unknown; userId: unknown }
/** Every command the KEY executor routed to the connector (the external effect). */
const routed: Routed[] = [];

async function cleanup() {
  const biz = `business_id LIKE ${sqlLikePrefix(P)}`;
  for (const sql of [
    `DELETE FROM team_activity_logs WHERE ${biz} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM business_autonomy_profiles WHERE ${biz}`,
    `DELETE FROM agent_triggers WHERE ${biz}`,
    `DELETE FROM ai_execution_logs WHERE ${biz}`,
    `DELETE FROM ai_plans WHERE ${biz}`,
    `DELETE FROM saga_executions WHERE ${biz}`,
    `DELETE FROM business_settings WHERE ${biz}`,
    `DELETE FROM memberships WHERE ${biz} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)} OR owner_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort: cascades cover most of these */ }
  }
}

const describeBody = (res: { status: number; body: unknown }) => `${res.status} ${JSON.stringify(res.body).slice(0, 400)}`;
const codeOf = (res: { body: any }) => res.body?.code ?? res.body?.error?.code ?? JSON.stringify(res.body);

/* ---------------------------- agent triggers ---------------------------- */

/** The owner-run default rule of a business (a seeded default by content, no recorded creator). */
const defaultTriggerId = (businessId: string) => `${businessId}_trg_default`;
/** A rule its business's recorded owner created (recorded in its condition), unscheduled. */
const memberTriggerId = (businessId: string) => `${businessId}_trg_member`;

async function resetTriggers() {
  const def = DEFAULT_AGENT_TRIGGERS[0];
  for (const businessId of BUSINESSES) {
    await db.$executeRawUnsafe('DELETE FROM agent_triggers WHERE business_id = $1', businessId);
    await db.agentTrigger.create({
      data: {
        id: defaultTriggerId(businessId), businessId, name: def.name, eventPattern: def.eventPattern,
        objective: def.objective, autoExecute: def.autoExecute, maxRiskTier: def.maxRiskTier, enabled: false,
      },
    });
    await db.agentTrigger.create({
      data: {
        id: memberTriggerId(businessId), businessId, name: 'v97x member rule', eventPattern: 'invoice.paid',
        objective: 'v97x a rule the recorded owner wrote', autoExecute: false, maxRiskTier: 1, enabled: false,
        condition: { [TRIGGER_RULE_CREATOR_KEY]: OWNER_OF[businessId] },
      },
    });
  }
}

/** The trigger row as Postgres stores it, so "unchanged" means byte-identical. */
async function triggerRowText(id: string): Promise<string> {
  const rows = await db.$queryRawUnsafe('SELECT row_to_json(t)::text AS j FROM agent_triggers t WHERE t.id = $1', id);
  expect(rows.length, `trigger ${id} exists`).toBe(1);
  return rows[0].j as string;
}

function putTrigger(user: string, businessId: string, triggerId: string, body: Record<string, unknown>) {
  return request(app.getHttpServer()).put(`/ai/businesses/${businessId}/agent/triggers/${triggerId}`).set(HEADER, user).send(body);
}

/* --------------------------- autonomy profile --------------------------- */

async function resetProfiles() {
  for (const businessId of BUSINESSES) {
    await db.businessAutonomyProfile.upsert({ where: { businessId }, create: { businessId, ...BASELINE_PROFILE }, update: BASELINE_PROFILE });
  }
}

/** The stored profile row of a tenant as Postgres stores it (its updatedAt included). */
async function profileRowText(businessId: string): Promise<string> {
  const rows = await db.$queryRawUnsafe('SELECT row_to_json(p)::text AS j FROM business_autonomy_profiles p WHERE p.business_id = $1', businessId);
  expect(rows.length, `profile of ${businessId} exists`).toBe(1);
  return rows[0].j as string;
}

async function profileOf(businessId: string) {
  const row = await db.businessAutonomyProfile.findUnique({ where: { businessId } });
  return {
    globalKillSwitch: row.globalKillSwitch,
    maxDailyAutoActions: row.maxDailyAutoActions,
    maxDailySpendTtd: row.maxDailySpendTtd,
    maxTierWithoutApproval: row.maxTierWithoutApproval,
    notifyOnBlock: row.notifyOnBlock,
  };
}

const auditRows = (businessId: string) => db.teamActivityLog.count({ where: { businessId } });

function patchProfile(user: string, businessId: string, body: Record<string, unknown>) {
  return request(app.getHttpServer()).patch('/api/v1/cortex/autonomy-profile').set(HEADER, user).query({ businessId }).send(body);
}

/* ---------------------------- plan execution ---------------------------- */

const STEPS = [
  { module: 'crm', action: 'create_note' },
  { module: 'crm', action: 'create_task' },
];

/** A KEY plan no member created (userId null), one AiPlanStep per entry, each carrying a marker. */
async function seedSystemPlan(id: string, businessId: string) {
  await db.aiPlan.create({
    data: {
      id, businessId, userId: null, objective: `v97x ${id}`, status: 'pending',
      steps: {
        create: STEPS.map((s, i) => ({
          id: `${id}_s${i + 1}`, order: i + 1, module: s.module, action: s.action,
          toolName: `${s.module}.${s.action}`, inputPayload: { marker: `${id}_s${i + 1}` },
        })),
      },
    },
  });
}

const planRow = (id: string) => db.aiPlan.findUnique({
  where: { id },
  select: { status: true, startedAt: true, steps: { select: { status: true }, orderBy: { order: 'asc' } } },
});
const routedFor = (planId: string) => routed.filter((r) => typeof r.marker === 'string' && r.marker.startsWith(`${planId}_s`));
const sagaCount = (businessId: string) => db.sagaExecution.count({ where: { businessId } });
const asMember = (userId: string, businessId: string) => ({ userId, role: 'USER', businessId });

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;
  const tenant = await import('../src/core/tenant/tenant-context');
  // As main.ts does before the app serves: the extension reads the ambient tenant TenantInterceptor installs.
  dbMod.setTenantContextProvider({ getCurrentBusinessId: tenant.getCurrentBusinessId });

  const { Test } = await import('@nestjs/testing');
  const { ValidationPipe } = await import('@nestjs/common');
  const { APP_INTERCEPTOR } = await import('@nestjs/core');
  const { TenantInterceptor } = await import('../src/core/tenant/tenant.interceptor');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const businessGuardModule = await import('../src/core/auth/business.guard');
  const { BusinessGuard } = businessGuardModule;
  businessOwnerRecipient = businessGuardModule.businessOwnerRecipient as any;
  ({ memberToolRunAuthority } = (await import('../src/modules/ai/plan-step-authority')) as any);
  ({ DEFAULT_AGENT_TRIGGERS } = (await import('../src/modules/ai/default-triggers.constants')) as any);
  ({ TRIGGER_RULE_CREATOR_KEY } = await import('../src/modules/key-cortex/key-cortex-trigger.service'));
  const { AgentController } = await import('../src/modules/ai/agent.controller');
  const controllerModule = await import('../src/modules/key-cortex/key-cortex.controller');
  const { KeyCortexController, UpdateAutonomyProfileDto } = controllerModule;
  const { KeyAutonomySafetyService } = await import('../src/modules/key-autonomy/key-autonomy-safety.service');

  // The constructor parameter types tsc emits for KeyCortexController (Nest injects by them; vitest's
  // esbuild transform emits none), left alone if present, as autonomy-profile-authority writes them.
  if (!Reflect.getMetadata('design:paramtypes', KeyCortexController)) {
    const names = [
      ['key-cortex-reasoning.service', 'KeyCortexReasoningService'], ['key-cortex-conversation.service', 'KeyCortexConversationService'],
      ['key-cortex-voice.service', 'KeyCortexVoiceService'], ['key-cortex-personality.service', 'KeyCortexPersonalityService'],
      ['key-cortex-actions.service', 'KeyCortexActionsService'], ['key-cortex-context.service', 'KeyCortexContextService'],
      ['key-cortex-connector.service', 'KeyCortexConnectorService'], ['key-cortex-command.service', 'KeyCortexCommandService'],
      ['key-cortex-executor.service', 'KeyCortexExecutorService'], ['key-cortex-context-v2.service', 'KeyCortexContextV2Service'],
      ['key-cortex-insight.service', 'KeyCortexInsightService'], ['key-cortex-monitor-v2.service', 'KeyCortexMonitorV2Service'],
      ['key-cortex-sandbox.service', 'KeyCortexSandboxService'], ['key-cortex-flow-studio.service', 'KeyCortexFlowStudioService'],
      ['key-cortex-evolution.service', 'KeyCortexEvolutionService'], ['key-cortex-phone.service', 'KeyCortexPhoneService'],
      ['key-cortex-document.service', 'KeyCortexDocumentService'], ['key-cortex-learning.service', 'KeyCortexLearningService'],
      [null, 'KeyAutonomySafetyService'],
      ['key-cortex-approval-orchestrator.service', 'KeyCortexApprovalOrchestratorService'],
      ['key-cortex-consciousness.service', 'KeyCortexConsciousnessService'], ['key-cortex-session.service', 'KeyCortexSessionService'],
      ['key-cortex-awareness.service', 'KeyCortexAwarenessService'],
    ] as const;
    const types: unknown[] = [];
    for (const [file, name] of names) {
      types.push(file === null ? KeyAutonomySafetyService : (await import(`../src/modules/key-cortex/${file}`))[name]);
    }
    Reflect.defineMetadata('design:paramtypes', types, KeyCortexController);
  }
  // The handler parameter types the ValidationPipe reads (as tsc emits them).
  if (!Reflect.getMetadata('design:paramtypes', KeyCortexController.prototype, 'updateAutonomyProfile')) {
    Reflect.defineMetadata('design:paramtypes', [UpdateAutonomyProfileDto, String], KeyCortexController.prototype, 'updateAutonomyProfile');
  }

  const moduleRef = await Test.createTestingModule({
    controllers: [AgentController, KeyCortexController],
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
      { provide: APP_INTERCEPTOR, useClass: TenantInterceptor },
    ],
  })
    .useMocker((token: any) => {
      const name = typeof token === 'function' ? token.name : String(token);
      return OFF_BOUNDARY.has(name) ? {} : undefined;
    })
    .compile();

  app = moduleRef.createNestApplication();
  // Identity attachment only, for seeded v97x_ users. No guard is overridden.
  app.use(async (req: any, _res: any, next: any) => {
    const header = req.headers[HEADER];
    const id = typeof header === 'string' ? header : undefined;
    if (id && id.startsWith(P)) {
      const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
      if (user) req.user = { id: user.id, email: user.email, role: user.role };
    }
    next();
  });
  // Same filter and pipe as app-bootstrap.ts, so status codes and bodies are the production ones.
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  prismaSvc = moduleRef.get(PrismaService);

  // KeyCortexPlannerService over the real executor and saga, as key-cortex-plan-execution wires it.
  const { KeyCortexExecutorService } = await import('../src/modules/key-cortex/key-cortex-executor.service');
  const { KeyCortexSagaService } = await import('../src/modules/key-cortex/key-cortex-saga.service');
  const { KeyCortexPlannerService } = await import('../src/modules/key-cortex/key-cortex-planner.service');
  const connector = {
    getAllCapabilities: () => [],
    execute: async (c: any) => {
      routed.push({ marker: c?.parameters?.marker, module: c?.module, action: c?.action, userId: c?.userId });
      return { success: true, data: { done: c?.parameters?.marker ?? null }, executionTimeMs: 1, command: c };
    },
  };
  const autonomy = { evaluateAction: async () => ({ allowed: true, requiresApproval: false, tier: 'full' }) };
  const legacyGateOff = { checkGate: async () => { throw new Error('v97x: the legacy autonomy gate is off this path'); } };
  const events = { emit: () => true };
  plannerModule = await Test.createTestingModule({
    providers: [
      PrismaService,
      {
        provide: KeyCortexExecutorService,
        useFactory: (prisma: any) => new KeyCortexExecutorService(
          connector as any, prisma, events as any, legacyGateOff as any, autonomy as any, undefined, undefined,
        ),
        inject: [PrismaService],
      },
      { provide: KeyCortexSagaService, useFactory: (prisma: any) => new KeyCortexSagaService(prisma), inject: [PrismaService] },
      {
        provide: KeyCortexPlannerService,
        useFactory: (prisma: any, exec: any, saga: any) => new KeyCortexPlannerService(prisma, {} as any, exec, saga),
        inject: [PrismaService, KeyCortexExecutorService, KeyCortexSagaService],
      },
    ],
  }).compile();
  await plannerModule.init();
  planner = plannerModule.get(KeyCortexPlannerService);
  executor = plannerModule.get(KeyCortexExecutorService);

  await cleanup(); // in case a prior run aborted

  for (const id of USERS) {
    await db.user.create({ data: { id, email: `${P}${id.slice(P.length)}@test.local`, name: id, role: 'USER' } });
  }
  for (const businessId of BUSINESSES) {
    await db.business.create({ data: { id: businessId, name: `${businessId}-name`, ownerId: OWNER_OF[businessId] } });
    // Full autonomy, so a plan step that runs is routed (the executor reads the real BusinessSetting row).
    await db.businessSetting.create({ data: { id: `${businessId}_setting`, businessId, aiAutonomyLevel: 'full' } });
  }
  for (const [userId, businessId, role] of [
    [ID.recAdmin, ID.bizA, 'ADMIN'],
    [ID.coOwner, ID.bizA, 'OWNER'],
    [ID.recStaff, ID.bizS, 'STAFF'],
    [ID.ownerO, ID.bizO, 'OWNER'],
  ] as const) {
    await db.membership.create({ data: { id: `${P}m_${userId.slice(P.length)}`, userId, businessId, role } });
  }
  await resetProfiles();
  await resetTriggers();
}, 180_000);

afterAll(async () => {
  if (app) await app.close();
  if (executor?.approvalCleanupInterval) clearInterval(executor.approvalCleanupInterval);
  if (plannerModule) await plannerModule.close();
  if (db) await cleanup();
  const dbMod = await import('@keyflow/db');
  dbMod.setTenantContextProvider({ getCurrentBusinessId: () => undefined });
});

describe('fixture sanity (real rows)', () => {
  it('bizA is recorded as recAdmin\'s (ADMIN) with an OWNER co-owner; bizS is recStaff\'s (STAFF); bizO is ownerO\'s (OWNER); each tenant holds its autonomy profile and its two agent rules', async () => {
    const owners = await db.business.findMany({ where: { id: { in: BUSINESSES } }, select: { id: true, ownerId: true }, orderBy: { id: 'asc' } });
    expect(owners).toEqual([
      { id: ID.bizA, ownerId: ID.recAdmin },
      { id: ID.bizO, ownerId: ID.ownerO },
      { id: ID.bizS, ownerId: ID.recStaff },
    ]);
    const roles = await db.membership.findMany({ where: { businessId: { in: BUSINESSES } }, select: { userId: true, businessId: true, role: true }, orderBy: { userId: 'asc' } });
    expect(roles).toEqual([
      { userId: ID.coOwner, businessId: ID.bizA, role: 'OWNER' },
      { userId: ID.ownerO, businessId: ID.bizO, role: 'OWNER' },
      { userId: ID.recAdmin, businessId: ID.bizA, role: 'ADMIN' },
      { userId: ID.recStaff, businessId: ID.bizS, role: 'STAFF' },
    ]);
    for (const businessId of BUSINESSES) {
      expect(await profileOf(businessId)).toEqual(BASELINE_PROFILE);
      expect(await db.agentTrigger.count({ where: { businessId } })).toBe(2);
    }
  });
});

describe('W11-D116-KEY-OWNER (D-116, D-119, D-125): memberToolRunAuthority — the business owner holds an OWNER membership', () => {
  it('RED-BEFORE (D-116, D-119): the recorded owner (Business.ownerId) holding ADMIN is refused an owner-only graph tool and an unmapped dotted tool (was admitted as the owner: null)', async () => {
    expect(await memberToolRunAuthority(prismaSvc, ID.bizA, ID.recAdmin, OWNER_ONLY_TOOL)).toEqual({ refusal: expect.stringMatching(OWNER_ONLY_REFUSAL), principal: false });
    expect(await memberToolRunAuthority(prismaSvc, ID.bizA, ID.recAdmin, UNMAPPED_TOOL)).toEqual({ refusal: UNMAPPED_REFUSAL, principal: false });
  });

  it('RED-BEFORE (D-116, D-119): the recorded owner (Business.ownerId) holding STAFF is refused the same two tools, with or without the principal', async () => {
    for (const asPrincipal of [false, true]) {
      const ownerOnly = await memberToolRunAuthority(prismaSvc, ID.bizS, ID.recStaff, OWNER_ONLY_TOOL, { asPrincipal });
      expect(ownerOnly, `asPrincipal ${asPrincipal}`).toEqual({ refusal: expect.stringMatching(OWNER_ONLY_REFUSAL), principal: false });
      const unmapped = await memberToolRunAuthority(prismaSvc, ID.bizS, ID.recStaff, UNMAPPED_TOOL, { asPrincipal });
      expect(unmapped, `asPrincipal ${asPrincipal}`).toEqual({ refusal: UNMAPPED_REFUSAL, principal: false });
    }
  });

  it('control (D-116, D-125): the recorded owner holding OWNER runs the owner-only graph tool and the unmapped dotted tool (null), and is the run\'s principal when asked', async () => {
    for (const tool of [OWNER_ONLY_TOOL, UNMAPPED_TOOL]) {
      expect(await memberToolRunAuthority(prismaSvc, ID.bizO, ID.ownerO, tool), tool).toEqual({ refusal: null, principal: false });
      expect(await memberToolRunAuthority(prismaSvc, ID.bizO, ID.ownerO, tool, { asPrincipal: true }), tool).toEqual({ refusal: null, principal: true });
    }
  });

  it('control (D-125): the co-owner (OWNER membership, not Business.ownerId) runs the owner-only graph tool (null), and is the run\'s principal when asked', async () => {
    expect(await memberToolRunAuthority(prismaSvc, ID.bizA, ID.coOwner, OWNER_ONLY_TOOL)).toEqual({ refusal: null, principal: false });
    expect(await memberToolRunAuthority(prismaSvc, ID.bizA, ID.coOwner, OWNER_ONLY_TOOL, { asPrincipal: true })).toEqual({ refusal: null, principal: true });
  });

  it('RED-BEFORE (D-125, D-119): the co-owner (OWNER membership, not Business.ownerId) is the business owner for the unmapped dotted tool too (null; was refused as mapped to no module scope)', async () => {
    expect(await memberToolRunAuthority(prismaSvc, ID.bizA, ID.coOwner, UNMAPPED_TOOL)).toEqual({ refusal: null, principal: false });
    expect(await memberToolRunAuthority(prismaSvc, ID.bizA, ID.coOwner, UNMAPPED_TOOL, { asPrincipal: true })).toEqual({ refusal: null, principal: true });
  });

  it('control (D-119 set unchanged): a tool the authority map never runs is refused to every owner too; the recorded owner holding ADMIN keeps the ADMIN rights below owner-only tools (a mapped tool its scopes reach runs)', async () => {
    for (const [businessId, userId] of [[ID.bizO, ID.ownerO], [ID.bizA, ID.coOwner], [ID.bizA, ID.recAdmin]] as const) {
      const { refusal } = await memberToolRunAuthority(prismaSvc, businessId, userId, REFUSED_TOOL);
      expect(String(refusal), userId).toMatch(/^Tool "execute_custom_logic" is not executed/);
    }
    expect(await memberToolRunAuthority(prismaSvc, ID.bizA, ID.recAdmin, 'expenses_list')).toEqual({ refusal: null, principal: false });
  });
});

/**
 * W11-D116-KEY-OWNER review SEC-W11D116K-1 (owner rulings D-125, D-116, D-71, D-119): the owner arm
 * of memberToolRunAuthority took any OWNER membership past assertMayRunGraphAction, so an OWNER
 * membership's explicit permissionScopes map (writable onto a co-owner through POST structure
 * assignments: StructureService.writeCopy) no longer bound it on the plan queue, the proposal executor
 * or KEY chat's tool calls, while ModuleScopeGuard, POST .../execute and D-98's revenue gate still read
 * it. At the packet's base the co-owner went through assertMayRunGraphAction and was refused. A mapped
 * tool goes through assertMayRunGraphAction for every member (an OWNER with no map holds every module
 * there, the OWNER defaults); only a tool the map does not map (D-119: the owner's only) is the owner
 * arm's. D-125: the recorded owner's OWNER membership is read the same way (Business.ownerId grants
 * nothing on its own).
 *
 * FIXTURES: bizM, Business.ownerId = recM; recM and coM each hold an OWNER membership whose explicit
 * map is SCOPED_MAP (revenue none, crm read, expenses none, ai write). Created here, removed by the
 * suite's prefix cleanup.
 */
describe('W11-D116-KEY-OWNER review SEC-W11D116K-1 (D-125, D-116, D-71, D-119): an OWNER membership\'s explicit scope map binds it on KEY\'s mapped tools', () => {
  const M = { bizM: `${P}bizM`, recM: `${P}recM`, coM: `${P}coM`, planCo: `${P}bizM_plan_co`, planRec: `${P}bizM_plan_rec` };
  const SCOPED_MAP = { revenue: 'none', crm: 'read', expenses: 'none', ai: 'write' };
  /** Mapped tools SCOPED_MAP does not reach, and the refusal assertMayRunGraphAction gives each. */
  const OUT_OF_MAP: ReadonlyArray<readonly [string, string]> = [
    ['commerce_mark_invoice_paid', 'Insufficient permissions: revenue requires write access (you have none)'],
    ['expenses_create', 'Insufficient permissions: expenses requires write access (you have none)'],
    [OWNER_ONLY_TOOL, 'Insufficient permissions: crm requires write access (you have read)'],
  ];
  /** A mapped contact read SCOPED_MAP reaches (crm read; with no principal the OWNER's only, D-37). */
  const IN_MAP_TOOL = 'crm_list_contacts';

  beforeAll(async () => {
    for (const id of [M.recM, M.coM]) {
      await db.user.create({ data: { id, email: `${P}${id.slice(P.length)}@test.local`, name: id, role: 'USER' } });
    }
    await db.business.create({ data: { id: M.bizM, name: `${M.bizM}-name`, ownerId: M.recM } });
    for (const userId of [M.recM, M.coM]) {
      await db.membership.create({ data: { id: `${P}m_${userId.slice(P.length)}`, userId, businessId: M.bizM, role: 'OWNER', permissionScopes: SCOPED_MAP } });
    }
    for (const [id, userId] of [[M.planCo, M.coM], [M.planRec, M.recM]] as const) {
      await db.aiPlan.create({ data: { id, businessId: M.bizM, userId, objective: `v97x ${id}`, status: 'approved' } });
    }
  });

  it('fixture sanity: bizM is recorded as recM\'s; recM and coM each hold an OWNER membership carrying the explicit map', async () => {
    expect(await db.business.findUnique({ where: { id: M.bizM }, select: { ownerId: true } })).toEqual({ ownerId: M.recM });
    const rows = await db.membership.findMany({ where: { businessId: M.bizM }, select: { userId: true, role: true, permissionScopes: true }, orderBy: { userId: 'asc' } });
    expect(rows).toEqual([
      { userId: M.coM, role: 'OWNER', permissionScopes: SCOPED_MAP },
      { userId: M.recM, role: 'OWNER', permissionScopes: SCOPED_MAP },
    ]);
  });

  it('RED-BEFORE (review SEC-W11D116K-1; D-125, D-71): the co-owner whose OWNER membership carries an explicit map is refused the mapped tools the map does not reach, with or without the principal (was admitted: null)', async () => {
    for (const [tool, refusal] of OUT_OF_MAP) {
      for (const asPrincipal of [false, true]) {
        expect(await memberToolRunAuthority(prismaSvc, M.bizM, M.coM, tool, { asPrincipal }), `${tool} asPrincipal ${asPrincipal}`).toEqual({ refusal, principal: false });
      }
    }
  });

  it('RED-BEFORE (review SEC-W11D116K-1; D-125: Business.ownerId grants nothing on its own): the recorded owner whose OWNER membership carries the same map is held to it as the co-owner is', async () => {
    for (const [tool, refusal] of OUT_OF_MAP) {
      expect(await memberToolRunAuthority(prismaSvc, M.bizM, M.recM, tool), tool).toEqual({ refusal, principal: false });
    }
  });

  it('RED-BEFORE (review SEC-W11D116K-1): the plan queue (planStepRunRefusal) refuses a revenue write step of a plan either scoped owner created', async () => {
    const { planStepRunRefusal } = await import('../src/modules/ai/plan-step-authority');
    for (const planId of [M.planCo, M.planRec]) {
      expect(await planStepRunRefusal(prismaSvc, M.bizM, planId, 'commerce_mark_invoice_paid'), planId).toBe(OUT_OF_MAP[0][1]);
    }
  });

  it('control (D-119, D-125, D-71): the scoped co-owner still runs the unmapped dotted tool (the owner\'s only) and a mapped tool its map reaches, as the principal when asked; a tool the map never runs stays refused', async () => {
    for (const tool of [UNMAPPED_TOOL, IN_MAP_TOOL]) {
      expect(await memberToolRunAuthority(prismaSvc, M.bizM, M.coM, tool), tool).toEqual({ refusal: null, principal: false });
      expect(await memberToolRunAuthority(prismaSvc, M.bizM, M.coM, tool, { asPrincipal: true }), tool).toEqual({ refusal: null, principal: true });
    }
    expect(String((await memberToolRunAuthority(prismaSvc, M.bizM, M.coM, REFUSED_TOOL)).refusal)).toMatch(/^Tool "execute_custom_logic" is not executed/);
  });

  it('control (D-125, D-71): an OWNER membership with no explicit map (the co-owner of bizA, the recorded owner of bizO) still runs every mapped tool the scoped owners are refused (the OWNER defaults)', async () => {
    for (const [businessId, userId] of [[ID.bizA, ID.coOwner], [ID.bizO, ID.ownerO]] as const) {
      for (const [tool] of OUT_OF_MAP) {
        expect(await memberToolRunAuthority(prismaSvc, businessId, userId, tool), `${userId} ${tool}`).toEqual({ refusal: null, principal: false });
      }
    }
  });
});

describe('W11-D116-KEY-OWNER (D-116, D-125): PUT agent/triggers — owner-run default rules and schedules are the OWNER membership\'s', () => {
  it('RED-BEFORE (D-116): the recorded owner holding ADMIN switching on or editing bizA\'s owner-run default rule is 403 AGENT_TRIGGER_OWNER_ONLY and the rule is byte-identical', async () => {
    await resetTriggers();
    const before = await triggerRowText(defaultTriggerId(ID.bizA));
    for (const body of [{ enabled: true }, { autoExecute: false, maxRiskTier: 1 }]) {
      const res = await putTrigger(ID.recAdmin, ID.bizA, defaultTriggerId(ID.bizA), body);
      expect(res.status, `${JSON.stringify(body)} ${describeBody(res)}`).toBe(403);
      expect(codeOf(res)).toContain('AGENT_TRIGGER_OWNER_ONLY');
    }
    expect(await triggerRowText(defaultTriggerId(ID.bizA))).toBe(before);
  });

  it('RED-BEFORE (D-116): the recorded owner holding ADMIN putting its own rule on a schedule is 403 AGENT_TRIGGER_SCHEDULE_OWNER_ONLY and the rule stays unscheduled', async () => {
    await resetTriggers();
    const before = await triggerRowText(memberTriggerId(ID.bizA));
    for (const body of [{ schedule: '0 9 * * *' }, { schedule: '* * * * *', enabled: true }]) {
      const res = await putTrigger(ID.recAdmin, ID.bizA, memberTriggerId(ID.bizA), body);
      expect(res.status, `${JSON.stringify(body)} ${describeBody(res)}`).toBe(403);
      expect(codeOf(res)).toContain('AGENT_TRIGGER_SCHEDULE_OWNER_ONLY');
    }
    expect(await triggerRowText(memberTriggerId(ID.bizA))).toBe(before);
    // Unscheduled, the rule is still its creator's to write (the ADMIN rights below owner-only writes).
    const own = await putTrigger(ID.recAdmin, ID.bizA, memberTriggerId(ID.bizA), { enabled: true });
    expect(own.status, describeBody(own)).toBe(200);
    expect((await db.agentTrigger.findUnique({ where: { id: memberTriggerId(ID.bizA) } })).enabled).toBe(true);
  });

  it('RED-BEFORE (D-116): the recorded owner holding STAFF is refused bizS\'s owner-run default rule (AGENT_TRIGGER_OWNER_ONLY) and a schedule on its own rule (AGENT_TRIGGER_SCHEDULE_OWNER_ONLY); both rules byte-identical', async () => {
    await resetTriggers();
    const defBefore = await triggerRowText(defaultTriggerId(ID.bizS));
    const ownBefore = await triggerRowText(memberTriggerId(ID.bizS));
    const def = await putTrigger(ID.recStaff, ID.bizS, defaultTriggerId(ID.bizS), { enabled: true });
    expect(def.status, describeBody(def)).toBe(403);
    expect(codeOf(def)).toContain('AGENT_TRIGGER_OWNER_ONLY');
    const sched = await putTrigger(ID.recStaff, ID.bizS, memberTriggerId(ID.bizS), { schedule: '0 9 * * *' });
    expect(sched.status, describeBody(sched)).toBe(403);
    expect(codeOf(sched)).toContain('AGENT_TRIGGER_SCHEDULE_OWNER_ONLY');
    expect(await triggerRowText(defaultTriggerId(ID.bizS))).toBe(defBefore);
    expect(await triggerRowText(memberTriggerId(ID.bizS))).toBe(ownBefore);
  });

  it('control (D-125): the co-owner of bizA and the OWNER-holding recorded owner of bizO switch on their owner-run default rule and schedule a member\'s rule (200, written); the default still records no member', async () => {
    await resetTriggers();
    for (const [userId, businessId] of [[ID.coOwner, ID.bizA], [ID.ownerO, ID.bizO]] as const) {
      const on = await putTrigger(userId, businessId, defaultTriggerId(businessId), { enabled: true });
      expect(on.status, `${userId} ${describeBody(on)}`).toBe(200);
      const row = await db.agentTrigger.findUnique({ where: { id: defaultTriggerId(businessId) } });
      expect(row.enabled, userId).toBe(true);
      expect(row.condition ?? null, userId).toBeNull();
      const sched = await putTrigger(userId, businessId, memberTriggerId(businessId), { schedule: '0 9 * * *' });
      expect(sched.status, `${userId} ${describeBody(sched)}`).toBe(200);
      expect((await db.agentTrigger.findUnique({ where: { id: memberTriggerId(businessId) } })).schedule, userId).toBe('0 9 * * *');
    }
    await resetTriggers();
  });
});

describe('W11-D116-KEY-OWNER (D-116, D-125; D-73): KeyCortexPlannerService.executePlan — a plan no member created is the OWNER membership\'s to run', () => {
  it('RED-BEFORE (D-116): the recorded owner holding STAFF executing a plan no member created is refused 403 before the plan starts: nothing routed, no saga, the plan still pending', async () => {
    const planId = `${P}plan_staff`;
    await seedSystemPlan(planId, ID.bizS);
    const sagas = await sagaCount(ID.bizS);
    const err = await planner.executePlan(planId, {}, asMember(ID.recStaff, ID.bizS)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect((err as Error).message).toBe("Only the plan's creator or the business owner can execute this plan");
    expect(routedFor(planId)).toEqual([]);
    expect(await sagaCount(ID.bizS)).toBe(sagas);
    expect(await planRow(planId)).toEqual({ status: 'pending', startedAt: null, steps: [{ status: 'pending' }, { status: 'pending' }] });
  });

  it('RED-BEFORE (D-116): the recorded owner holding ADMIN is refused the same (403 before the plan starts, nothing routed)', async () => {
    const planId = `${P}plan_admin`;
    await seedSystemPlan(planId, ID.bizA);
    const err = await planner.executePlan(planId, {}, asMember(ID.recAdmin, ID.bizA)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(routedFor(planId)).toEqual([]);
    expect((await planRow(planId)).status).toBe('pending');
  });

  it('control (D-125, D-73): the co-owner of bizA and the OWNER-holding recorded owner of bizO run a plan no member created, every step once as themselves', async () => {
    for (const [userId, businessId] of [[ID.coOwner, ID.bizA], [ID.ownerO, ID.bizO]] as const) {
      const planId = `${P}plan_ok_${userId.slice(P.length)}`;
      await seedSystemPlan(planId, businessId);
      const result = await planner.executePlan(planId, {}, asMember(userId, businessId));
      expect(result.status, userId).toBe('completed');
      expect(routedFor(planId).map((r) => [r.marker, r.userId]), userId).toEqual([
        [`${planId}_s1`, userId],
        [`${planId}_s2`, userId],
      ]);
    }
  });
});

describe('W11-D116-KEY-OWNER (D-116, D-125): PATCH autonomy-profile — the OWNER tier is the OWNER membership\'s', () => {
  it('RED-BEFORE (D-116): the recorded owner holding STAFF releasing the kill switch or raising maxTierWithoutApproval to 4 is 403; bizS\'s profile is byte-identical and no audit row is written', async () => {
    await resetProfiles();
    const before = await profileRowText(ID.bizS);
    const audits = await auditRows(ID.bizS);
    for (const body of [{ globalKillSwitch: false, maxTierWithoutApproval: 4 }, { globalKillSwitch: false }, { maxTierWithoutApproval: 4 }, { maxDailyAutoActions: 500 }]) {
      const res = await patchProfile(ID.recStaff, ID.bizS, body);
      expect(res.status, `${JSON.stringify(body)} ${describeBody(res)}`).toBe(403);
    }
    expect(await profileRowText(ID.bizS)).toBe(before);
    expect(await auditRows(ID.bizS)).toBe(audits);
  });

  it('control (D-116: the recorded owner holding ADMIN is that role): raising maxTierWithoutApproval to 4 is refused at the ADMIN tier 3 and the profile is unchanged; within the ADMIN tier the write is admitted', async () => {
    await resetProfiles();
    const before = await profileRowText(ID.bizA);
    const raise = await patchProfile(ID.recAdmin, ID.bizA, { maxTierWithoutApproval: 4 });
    expect(raise.status, describeBody(raise)).toBe(403);
    expect(JSON.stringify(raise.body)).toContain('Setting maxTierWithoutApproval to 4 requires approval tier 4; you have tier 3');
    expect(await profileRowText(ID.bizA)).toBe(before);
    const within = await patchProfile(ID.recAdmin, ID.bizA, { globalKillSwitch: false, maxTierWithoutApproval: 2 });
    expect(within.status, describeBody(within)).toBe(200);
    expect(await profileOf(ID.bizA)).toEqual({ ...BASELINE_PROFILE, globalKillSwitch: false, maxTierWithoutApproval: 2 });
    await resetProfiles();
  });

  it('control (D-125): the co-owner of bizA and the OWNER-holding recorded owner of bizO write at the OWNER tier (maxTierWithoutApproval 4, kill switch off: 200, written)', async () => {
    for (const [userId, businessId] of [[ID.coOwner, ID.bizA], [ID.ownerO, ID.bizO]] as const) {
      await resetProfiles();
      const res = await patchProfile(userId, businessId, { maxTierWithoutApproval: 4, globalKillSwitch: false });
      expect(res.status, `${userId} ${describeBody(res)}`).toBe(200);
      expect(await profileOf(businessId), userId).toEqual({ ...BASELINE_PROFILE, globalKillSwitch: false, maxTierWithoutApproval: 4 });
    }
    await resetProfiles();
  });
});

describe('W11-D116-KEY-OWNER (D-116): businessOwnerRecipient — mail addressed to the business owner reaches the recorded owner only while they hold an OWNER membership', () => {
  it('RED-BEFORE (D-116): the recorded owner holding STAFF, or holding ADMIN, is no recipient (null); the owner mail is not redirected to the co-owner', async () => {
    expect(await businessOwnerRecipient(prismaSvc, ID.bizS, ID.recStaff)).toBeNull();
    expect(await businessOwnerRecipient(prismaSvc, ID.bizA, ID.recAdmin)).toBeNull();
  });

  it('control (D-116): the recorded owner holding OWNER is the recipient, for their own business only', async () => {
    expect(await businessOwnerRecipient(prismaSvc, ID.bizO, ID.ownerO)).toEqual({ email: `${P}ownerO@test.local`, name: ID.ownerO });
    expect(await businessOwnerRecipient(prismaSvc, ID.bizA, ID.ownerO)).toBeNull();
  });
});
