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
 *   bizM, bizG  per section (SEC-W11D116K-1: OWNER memberships with an object map;
 *         TOF-GRAPH-SCOPE-ARRAY: memberships stored as a JSON array).
 *   bizR, bizK, bizP  per section (TOF-GRAPH-SCOPE-ARRAY review repair; W11-OWNER-MAP-UNMAPPED-TOOLS and its
 *         review repair: OWNER memberships with an explicit map on the KEY surfaces and the KEY cortex plan door).
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
/**
 * W11-OWNER-MAP-UNMAPPED-TOOLS (owner ruling D-140): what an OWNER membership that carries an explicit permissionScopes
 * map (an object or a JSON array, as ModuleScopeGuard reads it) is told for a tool the authority map does not map.
 */
const OWNER_MAP_UNMAPPED_REFUSAL = (tool: string) =>
  `Tool "${tool}" needs the business owner's unrestricted access (it is mapped to no module scope), and this OWNER membership is bound by its explicit scope map (D-140)`;
/** The mapped-to-no-module-scope refusal every non-owner gets for an unmapped tool (D-119, unchanged by D-140). */
const NOT_MAPPED_REFUSAL = (tool: string) => `Tool "${tool}" is mapped to no module scope, so it is not executed from this route`;
/** W11A-SEAM-REPAIR: the KEY connector reads B1 maps to connect read (D-131), which no role default holds. */
const KEY_CONNECTOR_READS = ['key_connector.list_providers', 'key_connector.list_connections', 'key_connector.check_health'] as const;
const CONNECT_READ_REFUSAL = 'Insufficient permissions: connect requires read access (you have none)';

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
    `DELETE FROM key_action_proposals WHERE ${biz}`,
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
      expect(String(refusal), userId).toBe('not available in this version');
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

  // W11-OWNER-MAP-UNMAPPED-TOOLS (owner ruling D-140): this was a D-119 control (the scoped co-owner ran the unmapped
  // dotted tool, whatever its map said: review SEC-SR-3, awaiting a ruling). D-140 binds an OWNER membership's explicit
  // map on the unmapped tools too. RED at e4e3b35b for the unmapped half (admitted: null); the rest is unchanged.
  it('RED-BEFORE (D-140; was a D-119 control): the scoped co-owner and the scoped recorded owner are refused the unmapped dotted tool, with or without the principal; the scoped co-owner still runs a mapped tool its map reaches, as the principal when asked; a tool the map never runs stays refused', async () => {
    for (const userId of [M.coM, M.recM]) {
      for (const asPrincipal of [false, true]) {
        expect(await memberToolRunAuthority(prismaSvc, M.bizM, userId, UNMAPPED_TOOL, { asPrincipal }), `${userId} asPrincipal ${asPrincipal}`).toEqual({
          refusal: OWNER_MAP_UNMAPPED_REFUSAL(UNMAPPED_TOOL),
          principal: false,
        });
      }
    }
    expect(await memberToolRunAuthority(prismaSvc, M.bizM, M.coM, IN_MAP_TOOL)).toEqual({ refusal: null, principal: false });
    expect(await memberToolRunAuthority(prismaSvc, M.bizM, M.coM, IN_MAP_TOOL, { asPrincipal: true })).toEqual({ refusal: null, principal: true });
    expect(String((await memberToolRunAuthority(prismaSvc, M.bizM, M.coM, REFUSED_TOOL)).refusal)).toBe('not available in this version');
  });

  it('control (D-125, D-71): an OWNER membership with no explicit map (the co-owner of bizA, the recorded owner of bizO) still runs every mapped tool the scoped owners are refused (the OWNER defaults)', async () => {
    for (const [businessId, userId] of [[ID.bizA, ID.coOwner], [ID.bizO, ID.ownerO]] as const) {
      for (const [tool] of OUT_OF_MAP) {
        expect(await memberToolRunAuthority(prismaSvc, businessId, userId, tool), `${userId} ${tool}`).toEqual({ refusal: null, principal: false });
      }
    }
  });

  it('W11A-SEAM-REPAIR control (SEC-W11D116K-1 stays closed for organ tools; D-125, D-131): the scoped recorded owner and co-owner (explicit map: no connect, revenue none) are refused the three KEY connector reads and temporal_flow.list_events, with or without the principal, and run cortex.create_task (ai write in their map)', async () => {
    for (const userId of [M.recM, M.coM]) {
      for (const asPrincipal of [false, true]) {
        for (const tool of KEY_CONNECTOR_READS) {
          expect(await memberToolRunAuthority(prismaSvc, M.bizM, userId, tool, { asPrincipal }), `${userId} ${tool} asPrincipal ${asPrincipal}`).toEqual({ refusal: CONNECT_READ_REFUSAL, principal: false });
        }
        expect(await memberToolRunAuthority(prismaSvc, M.bizM, userId, 'temporal_flow.list_events', { asPrincipal }), `${userId} asPrincipal ${asPrincipal}`).toEqual({
          refusal: 'Insufficient permissions: revenue requires read access (you have none)',
          principal: false,
        });
        expect(await memberToolRunAuthority(prismaSvc, M.bizM, userId, 'cortex.create_task', { asPrincipal }), `${userId} asPrincipal ${asPrincipal}`).toEqual({ refusal: null, principal: asPrincipal });
      }
    }
  });
});

/**
 * W11A-SEAM-REPAIR (seam C0 W11-D116-KEY-OWNER x B1 W11-KEY-ORGAN-AUTHORITY-MAP; owner rulings D-116, D-119,
 * D-125, D-131). B1 maps key_connector.list_providers, list_connections and check_health to connect read (D-131);
 * C0 (review SEC-W11D116K-1) sends every mapped tool, for the owner too, through assertMayRunGraphAction, where an
 * OWNER membership with no explicit map reads the OWNER role defaults, and those give connect 'none' (every role's
 * default, module-vocabulary CONNECT_DEFAULT). At 8109839a the business owner (the recorded owner or a co-owner,
 * each holding an OWNER membership) was therefore refused the three reads on every KEY surface, while still
 * running the far wider unmapped key_connector.execute_internal. The owner keeps every KEY organ tool, mapped or
 * unmapped; D-131 binds members; an explicit map on an OWNER membership still binds it (case above).
 */
describe('W11A-SEAM-REPAIR (D-116, D-119, D-125, D-131): memberToolRunAuthority — the business owner runs the KEY connector reads', () => {
  it('RED-BEFORE (D-125, D-131): the co-owner of bizA and the OWNER-holding recorded owner of bizO (no explicit map) run the three KEY connector reads, with or without the principal (was refused: connect requires read access)', async () => {
    for (const [businessId, userId] of [[ID.bizA, ID.coOwner], [ID.bizO, ID.ownerO]] as const) {
      for (const tool of KEY_CONNECTOR_READS) {
        expect(await memberToolRunAuthority(prismaSvc, businessId, userId, tool), `${userId} ${tool}`).toEqual({ refusal: null, principal: false });
        expect(await memberToolRunAuthority(prismaSvc, businessId, userId, tool, { asPrincipal: true }), `${userId} ${tool}`).toEqual({ refusal: null, principal: true });
      }
    }
  });

  it('RED-BEFORE (D-125): the plan queue (planStepRunRefusal) admits the three KEY connector reads on a plan the co-owner created', async () => {
    const { planStepRunRefusal } = await import('../src/modules/ai/plan-step-authority');
    const planId = `${P}bizA_plan_co_connect`;
    await db.aiPlan.create({ data: { id: planId, businessId: ID.bizA, userId: ID.coOwner, objective: `v97x ${planId}`, status: 'approved' } });
    try {
      for (const tool of KEY_CONNECTOR_READS) {
        expect(await planStepRunRefusal(prismaSvc, ID.bizA, planId, tool), tool).toBeNull();
      }
    } finally {
      await db.aiPlan.delete({ where: { id: planId } });
    }
  });

  it('control (D-131, D-116): members are still held to connect read: the recorded owner holding ADMIN (bizA) and the recorded owner holding STAFF (bizS), on role defaults, are refused the three KEY connector reads', async () => {
    for (const [businessId, userId] of [[ID.bizA, ID.recAdmin], [ID.bizS, ID.recStaff]] as const) {
      for (const tool of KEY_CONNECTOR_READS) {
        expect(await memberToolRunAuthority(prismaSvc, businessId, userId, tool), `${userId} ${tool}`).toEqual({ refusal: CONNECT_READ_REFUSAL, principal: false });
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
    // SWP-CENSUS-KEY-A (V1-64): default STAFF (ai:none) is refused at ModuleScopeGuard before reaching the controller.
    const ungranted = await putTrigger(ID.recStaff, ID.bizS, defaultTriggerId(ID.bizS), { enabled: true });
    expect(ungranted.status, describeBody(ungranted)).toBe(403);
    expect(String(ungranted.body?.message ?? '')).toMatch(/ai requires write access/);
    // Even with explicit ai:write, the recorded owner holding STAFF is still refused by the D-116 owner-only trigger rules.
    const { defaultScopesForRole } = await import('../src/core/authority/module-vocabulary');
    await db.membership.update({
      where: { userId_businessId: { userId: ID.recStaff, businessId: ID.bizS } },
      data: { permissionScopes: { ...defaultScopesForRole('STAFF'), ai: 'write' } },
    });
    try {
      const def = await putTrigger(ID.recStaff, ID.bizS, defaultTriggerId(ID.bizS), { enabled: true });
      expect(def.status, describeBody(def)).toBe(403);
      expect(codeOf(def)).toContain('AGENT_TRIGGER_OWNER_ONLY');
      const sched = await putTrigger(ID.recStaff, ID.bizS, memberTriggerId(ID.bizS), { schedule: '0 9 * * *' });
      expect(sched.status, describeBody(sched)).toBe(403);
      expect(codeOf(sched)).toContain('AGENT_TRIGGER_SCHEDULE_OWNER_ONLY');
      expect(await triggerRowText(defaultTriggerId(ID.bizS))).toBe(defBefore);
      expect(await triggerRowText(memberTriggerId(ID.bizS))).toBe(ownBefore);
    } finally {
      await db.membership.update({
        where: { userId_businessId: { userId: ID.recStaff, businessId: ID.bizS } },
        data: { permissionScopes: null },
      });
    }
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

/**
 * TOF-GRAPH-SCOPE-ARRAY (tie-off follow-up; owner rulings D-71, D-119, D-125). permissionScopes is a Json
 * column, so an array can be stored in it, and ModuleScopeGuard (memberModuleLevel, since the PR195 port's
 * review SEC-P195-2) reads any non-null object, an ARRAY INCLUDED, as an explicit scope map in which every
 * module is absent (none): such a member, the OWNER included, is refused every module route. At the packet's
 * base KEY's graph actions tested isJsonObject, false for an array, and read the role's defaults instead:
 * assertMayRunGraphAction (POST actions/.../execute and the plan queue), graphPlanReadScope (GET
 * actions/.../queue) and isExplicitScopeMap (memberToolRunAuthority's owner arm).
 *
 * FIXTURES: bizG, Business.ownerId = ownerArr, who holds an OWNER membership stored as []; staffArr holds a
 * STAFF membership stored as []; staffMapG holds a STAFF membership whose object map grants revenue read and
 * operations write (the control). Each holds a pending plan of its own with a revenue-read step
 * (commerce_list_invoices) and an operations-write step (helpdesk_create_ticket). Created here, removed by the
 * suite's prefix cleanup.
 *
 * HTTP COMPOSITION: one real Nest app with the real GraphActionsController, PrismaService, AuthGuard,
 * BusinessGuard, CrmRateLimitGuard, PlannerService (its step status write), the production TenantInterceptor,
 * GlobalHttpExceptionFilter and ValidationPipe, and this suite's identity middleware. Stand-ins: governance
 * (allows every tool at tier 1, no pending approvals), the execution log (records; no history) and the FLOW
 * dispatcher (records each executeToolDirect call, the route's external effect, and answers success: no
 * tool runs, no provider is reached); the graph, intent and workspace services no case reaches.
 */
describe('TOF-GRAPH-SCOPE-ARRAY (D-71, D-119, D-125): a JSON-array permissionScopes binds KEY\'s graph actions as ModuleScopeGuard reads it', () => {
  const G = {
    bizG: `${P}bizG`,
    ownerArr: `${P}ownerArr`,
    staffArr: `${P}staffArr`,
    staffMapG: `${P}staffMapG`,
  };
  const REVENUE_READ = 'commerce_list_invoices';
  const OPERATIONS_WRITE = 'helpdesk_create_ticket';
  const REVENUE_READ_NONE = 'Insufficient permissions: revenue requires read access (you have none)';
  const OPERATIONS_WRITE_NONE = 'Insufficient permissions: operations requires write access (you have none)';
  const SCOPES: Record<string, unknown> = {
    [G.ownerArr]: [],
    [G.staffArr]: [],
    [G.staffMapG]: { revenue: 'read', operations: 'write' },
  };
  const planOf = (userId: string) => `${userId}_plan`;
  const stepOf = (userId: string, kind: 'rev' | 'ops') => `${userId}_s_${kind}`;

  let graphApp: any;
  /** Every tool the route handed the FLOW dispatcher, with the principal it named. */
  const dispatchedG: Array<{ toolName: string; planStepId: unknown; principal: unknown }> = [];

  async function resetPlans() {
    await db.$executeRawUnsafe('DELETE FROM ai_execution_logs WHERE business_id = $1', G.bizG);
    await db.$executeRawUnsafe('DELETE FROM ai_plans WHERE business_id = $1', G.bizG);
    dispatchedG.length = 0;
    for (const userId of [G.ownerArr, G.staffArr, G.staffMapG]) {
      await db.aiPlan.create({
        data: {
          id: planOf(userId), businessId: G.bizG, userId, objective: `v97x ${planOf(userId)}`, status: 'pending',
          steps: {
            create: [
              { id: stepOf(userId, 'rev'), order: 1, toolName: REVENUE_READ, action: REVENUE_READ, description: 'v97x revenue read', inputPayload: {} },
              { id: stepOf(userId, 'ops'), order: 2, toolName: OPERATIONS_WRITE, action: OPERATIONS_WRITE, description: 'v97x operations write', inputPayload: { subject: 'v97x ticket' } },
            ],
          },
        },
      });
    }
  }

  const stepStatus = async (id: string) => (await db.aiPlanStep.findUnique({ where: { id }, select: { status: true } }))?.status;
  const execute = (userId: string, kind: 'rev' | 'ops') =>
    request(graphApp.getHttpServer())
      .post(`/actions/businesses/${G.bizG}/execute`)
      .set(HEADER, userId)
      .send({ planId: planOf(userId), planStepId: stepOf(userId, kind) });
  const queue = (userId: string) => request(graphApp.getHttpServer()).get(`/actions/businesses/${G.bizG}/queue?limit=50`).set(HEADER, userId);

  beforeAll(async () => {
    for (const id of [G.ownerArr, G.staffArr, G.staffMapG]) {
      await db.user.create({ data: { id, email: `${P}${id.slice(P.length)}@test.local`, name: id, role: 'USER' } });
    }
    await db.business.create({ data: { id: G.bizG, name: `${G.bizG}-name`, ownerId: G.ownerArr } });
    for (const [userId, role] of [[G.ownerArr, 'OWNER'], [G.staffArr, 'STAFF'], [G.staffMapG, 'STAFF']] as const) {
      await db.membership.create({ data: { id: `${P}m_${userId.slice(P.length)}`, userId, businessId: G.bizG, role, permissionScopes: SCOPES[userId] } });
    }
    await resetPlans();

    const { Test } = await import('@nestjs/testing');
    const { ValidationPipe } = await import('@nestjs/common');
    const { APP_INTERCEPTOR } = await import('@nestjs/core');
    const { EventEmitter2 } = await import('@nestjs/event-emitter');
    const { TenantInterceptor } = await import('../src/core/tenant/tenant.interceptor');
    const { PrismaService } = await import('../src/core/prisma/prisma.service');
    const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
    const { AuthGuard } = await import('../src/core/auth/auth.guard');
    const { BusinessGuard } = await import('../src/core/auth/business.guard');
    const { CrmRateLimitGuard } = await import('../src/modules/crm/guards/rate-limit.guard');
    const { GraphActionsController } = await import('../src/modules/ai/graph-actions.controller');
    const { PlannerService } = await import('../src/modules/ai/planner.service');
    const { BusinessGraphService } = await import('../src/modules/ai/business-graph.service');
    const { IntentParserService } = await import('../src/modules/ai/intent-parser.service');
    const { AiOversightService } = await import('../src/modules/ai/ai-oversight.service');
    const { FlowOrchestratorService } = await import('../src/modules/ai/flow-orchestrator.service');
    const { AiExecutionLogService } = await import('../src/modules/ai/ai-execution-log.service');
    const { WorkspaceRecommendationsService } = await import('../src/modules/ai/workspace-recommendations.service');

    const graphRef = await Test.createTestingModule({
      controllers: [GraphActionsController],
      providers: [
        PrismaService,
        AuthGuard,
        BusinessGuard,
        CrmRateLimitGuard,
        { provide: EventEmitter2, useValue: new EventEmitter2() },
        { provide: PlannerService, inject: [PrismaService], useFactory: (prisma: any) => new (PlannerService as any)(prisma, {}, {}, {}, {}, {}) },
        { provide: BusinessGraphService, useValue: {} },
        { provide: IntentParserService, useValue: {} },
        {
          provide: AiOversightService,
          useValue: {
            evaluate: async () => ({ allowed: true, tier: 1, requiresFormalApproval: false, requiresAdminApproval: false }),
            getPendingApprovals: async () => [],
          },
        },
        {
          provide: FlowOrchestratorService,
          useValue: {
            executeToolDirect: async (_businessId: string, toolName: string, _args: unknown, _planId: unknown, planStepId: unknown, ctx: any) => {
              dispatchedG.push({ toolName, planStepId, principal: ctx?.principalUserId });
              return { success: true, result: { v97x: 'dispatched' }, changedEntities: [] };
            },
          },
        },
        { provide: AiExecutionLogService, useValue: { log: async () => undefined, getHistory: async () => ({ logs: [] }) } },
        { provide: WorkspaceRecommendationsService, useValue: {} },
        { provide: APP_INTERCEPTOR, useClass: TenantInterceptor },
      ],
    }).compile();
    graphApp = graphRef.createNestApplication();
    graphApp.use(async (req: any, _res: any, next: any) => {
      const header = req.headers[HEADER];
      const id = typeof header === 'string' ? header : undefined;
      if (id && id.startsWith(P)) {
        const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
        if (user) req.user = { id: user.id, email: user.email, role: user.role };
      }
      next();
    });
    graphApp.useGlobalFilters(new GlobalHttpExceptionFilter());
    graphApp.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await graphApp.init();
  }, 120_000);

  afterAll(async () => {
    if (graphApp) await graphApp.close();
  });

  it('fixture sanity: bizG is recorded as ownerArr\'s; ownerArr (OWNER) and staffArr (STAFF) are stored as [], staffMapG as an object map; each holds its own pending plan with the two steps', async () => {
    expect(await db.business.findUnique({ where: { id: G.bizG }, select: { ownerId: true } })).toEqual({ ownerId: G.ownerArr });
    const rows = await db.membership.findMany({ where: { businessId: G.bizG }, select: { userId: true, role: true, permissionScopes: true }, orderBy: { userId: 'asc' } });
    expect(rows).toEqual([
      { userId: G.ownerArr, role: 'OWNER', permissionScopes: [] },
      { userId: G.staffArr, role: 'STAFF', permissionScopes: [] },
      { userId: G.staffMapG, role: 'STAFF', permissionScopes: { revenue: 'read', operations: 'write' } },
    ]);
    const { memberModuleLevel } = await import('../src/core/authority/module-vocabulary');
    for (const row of rows.slice(0, 2)) {
      for (const module of ['revenue', 'operations', 'ai', 'connect']) expect(memberModuleLevel(row, module), `${row.userId} ${module}`).toBe('none');
    }
    for (const userId of [G.ownerArr, G.staffArr, G.staffMapG]) {
      expect(await stepStatus(stepOf(userId, 'rev'))).toBe('pending');
      expect(await stepStatus(stepOf(userId, 'ops'))).toBe('pending');
    }
  });

  it('RED-BEFORE: POST actions/.../execute refuses the STAFF member stored as [] its own revenue-read step, 403 before anything is claimed or dispatched (was run: the STAFF defaults read revenue)', async () => {
    await resetPlans();
    const res = await execute(G.staffArr, 'rev');
    expect(res.status, describeBody(res)).toBe(403);
    expect(JSON.stringify(res.body)).toContain(REVENUE_READ_NONE);
    expect(dispatchedG).toEqual([]);
    expect(await stepStatus(stepOf(G.staffArr, 'rev'))).toBe('pending');
    expect(await db.aiExecutionLog.count({ where: { businessId: G.bizG } })).toBe(0);
  });

  it('RED-BEFORE: POST actions/.../execute refuses the STAFF member stored as [] its own operations-write step on its explicit map (none; was refused on the STAFF defaults: read)', async () => {
    await resetPlans();
    const res = await execute(G.staffArr, 'ops');
    expect(res.status, describeBody(res)).toBe(403);
    expect(JSON.stringify(res.body)).toContain(OPERATIONS_WRITE_NONE);
    expect(dispatchedG).toEqual([]);
    expect(await stepStatus(stepOf(G.staffArr, 'ops'))).toBe('pending');
  });

  it('RED-BEFORE (D-125, D-71): POST actions/.../execute refuses the OWNER stored as [] its own revenue-read and operations-write steps, as ModuleScopeGuard refuses it every module route (was run: the OWNER defaults)', async () => {
    await resetPlans();
    for (const [kind, refusal] of [['rev', REVENUE_READ_NONE], ['ops', OPERATIONS_WRITE_NONE]] as const) {
      const res = await execute(G.ownerArr, kind);
      expect(res.status, `${kind} ${describeBody(res)}`).toBe(403);
      expect(JSON.stringify(res.body), kind).toContain(refusal);
      expect(await stepStatus(stepOf(G.ownerArr, kind)), kind).toBe('pending');
    }
    expect(dispatchedG).toEqual([]);
  });

  it('control (object maps unchanged): the STAFF member whose object map grants revenue read and operations write runs both of its steps once, as their principal', async () => {
    await resetPlans();
    for (const kind of ['rev', 'ops'] as const) {
      const res = await execute(G.staffMapG, kind);
      expect(res.status, `${kind} ${describeBody(res)}`).toBe(201);
      expect(res.body.success, kind).toBe(true);
      expect(await stepStatus(stepOf(G.staffMapG, kind)), kind).toBe('completed');
    }
    expect(dispatchedG).toEqual([
      { toolName: REVENUE_READ, planStepId: stepOf(G.staffMapG, 'rev'), principal: G.staffMapG },
      { toolName: OPERATIONS_WRITE, planStepId: stepOf(G.staffMapG, 'ops'), principal: G.staffMapG },
    ]);
    await resetPlans();
  });

  it('RED-BEFORE: GET actions/.../queue shows the STAFF member stored as [] its own plan without the revenue and operations steps (was shown both: the STAFF defaults read them); the object-map control is shown both', async () => {
    await resetPlans();
    const arr = await queue(G.staffArr);
    expect(arr.status, describeBody(arr)).toBe(200);
    expect(arr.body.plans.map((p: any) => p.id)).toEqual([planOf(G.staffArr)]);
    expect(arr.body.plans[0].steps).toEqual([]);
    const map = await queue(G.staffMapG);
    expect(map.status, describeBody(map)).toBe(200);
    expect(map.body.plans.map((p: any) => p.id)).toEqual([planOf(G.staffMapG)]);
    expect(map.body.plans[0].steps.map((s: any) => s.id)).toEqual([stepOf(G.staffMapG, 'rev'), stepOf(G.staffMapG, 'ops')]);
  });

  it('RED-BEFORE (D-125, D-71; the owner-role-key case for []): memberToolRunAuthority refuses the OWNER stored as [] every mapped tool, FLOW and KEY organ alike, with or without the principal (was admitted: null)', async () => {
    const refusals: ReadonlyArray<readonly [string, string]> = [
      ['commerce_mark_invoice_paid', 'Insufficient permissions: revenue requires write access (you have none)'],
      [REVENUE_READ, REVENUE_READ_NONE],
      [OPERATIONS_WRITE, OPERATIONS_WRITE_NONE],
      ['cortex.create_task', 'Insufficient permissions: ai requires write access (you have none)'],
      ...KEY_CONNECTOR_READS.map((tool) => [tool, CONNECT_READ_REFUSAL] as const),
    ];
    for (const [tool, refusal] of refusals) {
      for (const asPrincipal of [false, true]) {
        expect(await memberToolRunAuthority(prismaSvc, G.bizG, G.ownerArr, tool, { asPrincipal }), `${tool} asPrincipal ${asPrincipal}`).toEqual({ refusal, principal: false });
      }
    }
  });

  it('RED-BEFORE: the plan queue (planStepRunRefusal) refuses a revenue-read step of the plan the OWNER stored as [] created (was admitted)', async () => {
    const { planStepRunRefusal } = await import('../src/modules/ai/plan-step-authority');
    expect(await planStepRunRefusal(prismaSvc, G.bizG, planOf(G.ownerArr), REVENUE_READ)).toBe(REVENUE_READ_NONE);
    expect(await planStepRunRefusal(prismaSvc, G.bizG, planOf(G.ownerArr), 'cortex.create_task')).toBe('Insufficient permissions: ai requires write access (you have none)');
  });

  // W11-OWNER-MAP-UNMAPPED-TOOLS (owner ruling D-140): this was a D-119 control. A JSON array is an explicit map (the one
  // naming no module, as ModuleScopeGuard reads it), so D-140 refuses the OWNER stored as [] the unmapped dotted tool too.
  // RED at e4e3b35b for the unmapped half (admitted: null).
  it('RED-BEFORE (D-140; was a D-119 control): the OWNER stored as [] is refused the unmapped dotted tool, with or without the principal, and a tool the map never runs stays refused', async () => {
    for (const asPrincipal of [false, true]) {
      expect(await memberToolRunAuthority(prismaSvc, G.bizG, G.ownerArr, UNMAPPED_TOOL, { asPrincipal }), `asPrincipal ${asPrincipal}`).toEqual({
        refusal: OWNER_MAP_UNMAPPED_REFUSAL(UNMAPPED_TOOL),
        principal: false,
      });
    }
    expect(String((await memberToolRunAuthority(prismaSvc, G.bizG, G.ownerArr, REFUSED_TOOL)).refusal)).toBe('not available in this version');
  });
});

/**
 * TOF-GRAPH-SCOPE-ARRAY review repair (review findings SEC-TGSA-1, COR-TOFGSA-1, SEC-TGSA-2, SEC-TGSA-3; owner
 * rulings D-71, D-114, D-140, D-125, D-57).
 *
 * SEC-TGSA-1 / COR-TOFGSA-1: the KEY cortex readers still read a stored JSON array as the role's defaults
 * (`typeof === 'object' && !Array.isArray(...)`), while ModuleScopeGuard and KEY's graph actions read it as an
 * explicit map in which every module is none. The owner's team route stores one (PATCH .../team/:m/permissions
 * { scopes: [] }). So an ADMIN stored as [] ran a KEY plan's money steps, invoice writes included, and a STAFF
 * member stored as [] ran expenses and analytics reads (POST api/v1/cortex/plans/:planId/execute:
 * KeyCortexPlannerService.assertMemberSteps and assertRevenueWrite); both ran direct commands and queries the
 * REST door refuses (POST api/v1/cortex/execute and POST api/v1/cortex/query: CortexMemberAuthorityGuard), and the
 * KEY chat's commands (KeyCortexQueryPipelineService.memberAuthority). The projects plan door read the same way
 * (POST projects/.../plans/:planId/approve: assertMayGovernPlans), with no wider grant for a STAFF member but the
 * wrong level in its refusal. Each now reads memberScopeMap: an array is the explicit map that names no module.
 *
 * SEC-TGSA-2: GET graph/business/:businessId (and its twin GET ai/businesses/:businessId/ai/graph) answered every
 * member the shared snapshot, so a member whose map grants no revenue read got the business's revenue totals, its
 * overdue invoices and its top clients (name, email, revenue). Both now answer the snapshot projected for the
 * viewer (BusinessGraphService.getSharedSnapshotForMember): the revenue figures only at revenue read and the
 * expenses figures only at expenses read, as KEY's standing context projects them (keyContextSight), and still no
 * treasury, pipeline or support section.
 *
 * SEC-TGSA-3: graphPlanReadScope returned every step and output to any OWNER membership before it read the map, so
 * an OWNER stored as [] read another member's revenue step and its stored output (GET api/v1/cortex/plans/:planId),
 * which assertMayRunGraphAction refuses it to run. D-140: it reads the steps its map reads.
 *
 * FIXTURES (bizR, Business.ownerId = rvOwner): rvOwner holds an OWNER membership with no map (the control);
 * rvCo an OWNER membership stored as [] (D-125: an owner); rvAdmin an ADMIN and rvStaff a STAFF membership stored
 * as []; rvDefStaff a STAFF membership with no map (the STAFF defaults: revenue and expenses read); rvMapStaff a
 * STAFF object map granting revenue, expenses and analytics read; rvRevStaff a STAFF object map granting revenue
 * read alone. Seeded: a contact (v97x Client) with a PAID invoice of 7777 and an overdue SENT invoice of 1234.
 *
 * HTTP COMPOSITION: one real Nest app with the real GraphActionsController, AiController, KeyCortexController,
 * KeyCortexGoalsController and ProjectsController, the real PrismaService, AuthGuard, BusinessGuard,
 * ModuleScopeGuard, CrmRateLimitGuard, CortexMemberAuthorityGuard, BusinessGraphService (on the real rows),
 * KeyCortexPlannerService (the suite's: the real executor and saga, the recording connector), ProjectsService (its
 * plan door), the production TenantInterceptor, GlobalHttpExceptionFilter and ValidationPipe, and this suite's
 * identity middleware. Stand-ins: KEY's executor and connector behind POST cortex/execute and POST cortex/query
 * record each command, query and audit row (no adapter or provider is reached); every other collaborator no
 * case reaches is inert. The KEY chat's command rule (memberCommandRefusals, which the chat runs on a model's
 * parsed commands) is read on the real rows through the service's own method: the chat route needs a model.
 */
describe('TOF-GRAPH-SCOPE-ARRAY review repair (D-71, D-114, D-140, D-57): a JSON-array permissionScopes binds the KEY cortex doors, the business graph and the plan reads as ModuleScopeGuard reads it', () => {
  const R = {
    bizR: `${P}bizR`,
    owner: `${P}rvOwner`,
    co: `${P}rvCo`,
    admin: `${P}rvAdmin`,
    staff: `${P}rvStaff`,
    defStaff: `${P}rvDefStaff`,
    mapStaff: `${P}rvMapStaff`,
    revStaff: `${P}rvRevStaff`,
    client: `${P}rvClient`,
  };
  const MEMBERS: ReadonlyArray<readonly [string, string, unknown]> = [
    [R.owner, 'OWNER', undefined],
    [R.co, 'OWNER', []],
    [R.admin, 'ADMIN', []],
    [R.staff, 'STAFF', []],
    [R.defStaff, 'STAFF', undefined],
    // SWP-CENSUS-KEY-B (P109, Ruling B2): POST plans/:planId/execute requires ai:write; R.mapStaff keeps read-only revenue/expenses/analytics.
    [R.mapStaff, 'STAFF', { revenue: 'read', expenses: 'read', analytics: 'read', ai: 'write' }],
    [R.revStaff, 'STAFF', { revenue: 'read' }],
  ];
  const AI_WRITE_NONE = 'Insufficient permissions: ai requires write access (you have none)';
  const REVENUE_WRITE_NONE = 'Insufficient permissions: revenue requires write access (you have none)';
  const REVENUE_READ_NONE = 'Insufficient permissions: revenue requires read access (you have none)';
  const PLAN_REVENUE_WRITE_NONE = `${REVENUE_WRITE_NONE}; this plan writes the business's invoices or payments`;
  const PLAN_EXPENSES_READ_NONE = 'Insufficient permissions: expenses requires read access (you have none); plan step "finance.list_expenses" is not run (D-71)';
  const PROJECT_PLAN_REFUSAL = (level: string) =>
    `Insufficient permissions: approving or deleting a project plan needs the owner, an admin or projects write access (you have ${level})`;
  const MONEY_AREAS = ['revenue', 'expenses', 'profitability'];

  const ADMIN_PLAN = `${R.admin}_plan`;
  const STAFF_PLAN = `${R.staff}_plan`;
  const MAP_PLAN = `${R.mapStaff}_plan`;
  const DONE_PLAN = `${R.mapStaff}_done`;
  const PLAN_STEPS: Record<string, ReadonlyArray<readonly [string, string]>> = {
    [ADMIN_PLAN]: [['commerce', 'list_invoices'], ['commerce', 'mark_invoice_paid'], ['finance', 'get_profit_loss']],
    [STAFF_PLAN]: [['finance', 'list_expenses'], ['analytics', 'get_overview']],
    [MAP_PLAN]: [['finance', 'list_expenses'], ['analytics', 'get_overview']],
  };
  const DONE_OUTPUT = { invoices: [{ number: 'v97x-INV-1', total: 4321 }] };

  let rvApp: any;
  /** What KEY's executor and connector were handed behind POST cortex/execute and POST cortex/query. */
  const cortexExecuted: Array<{ module: unknown; action: unknown; userId: unknown }> = [];
  const cortexQueried: Array<{ module: unknown; query: unknown; userId: unknown }> = [];
  const cortexAudits: Array<{ module: unknown; action: unknown; error: unknown }> = [];

  async function resetPlans() {
    await db.$executeRawUnsafe('DELETE FROM ai_plans WHERE business_id = $1', R.bizR);
    await db.$executeRawUnsafe('DELETE FROM saga_executions WHERE business_id = $1', R.bizR);
    for (const [planId, steps] of Object.entries(PLAN_STEPS)) {
      const userId = planId === ADMIN_PLAN ? R.admin : planId === STAFF_PLAN ? R.staff : R.mapStaff;
      await db.aiPlan.create({
        data: {
          id: planId, businessId: R.bizR, userId, objective: `v97x ${planId}`, status: 'pending',
          steps: {
            create: steps.map(([module, action], i) => ({
              id: `${planId}_s${i + 1}`, order: i + 1, module, action, toolName: `${module}.${action}`,
              inputPayload: { marker: `${planId}_s${i + 1}` },
            })),
          },
        },
      });
    }
    await db.aiPlan.create({
      data: {
        id: DONE_PLAN, businessId: R.bizR, userId: R.mapStaff, objective: `v97x ${DONE_PLAN}`, status: 'completed',
        steps: {
          create: [{
            id: `${DONE_PLAN}_s1`, order: 1, module: 'commerce', action: 'list_invoices', toolName: 'commerce_list_invoices',
            status: 'completed', inputPayload: {}, outputResult: DONE_OUTPUT,
          }],
        },
      },
    });
    cortexExecuted.length = 0;
    cortexQueried.length = 0;
    cortexAudits.length = 0;
  }

  const as = (userId: string) => ({ [HEADER]: userId });
  const executePlanAs = (userId: string, planId: string) =>
    request(rvApp.getHttpServer()).post(`/api/v1/cortex/plans/${planId}/execute`).set(as(userId)).send({ businessId: R.bizR });
  const cortexExecute = (userId: string, module: string, action: string) =>
    request(rvApp.getHttpServer()).post('/api/v1/cortex/execute').set(as(userId))
      // FU-CORTEX-EXECUTE-STRUCTURED-DTO: structured calls send module+action without command.
      .send({ businessId: R.bizR, module, action, parameters: { marker: `v97x-${module}.${action}` } });
  const cortexQuery = (userId: string, module: string, query: string) =>
    request(rvApp.getHttpServer()).post('/api/v1/cortex/query').set(as(userId)).send({ businessId: R.bizR, module, query });
  const graphOf = (userId: string) => request(rvApp.getHttpServer()).get(`/graph/business/${R.bizR}`).set(as(userId));
  const aiGraphOf = (userId: string) => request(rvApp.getHttpServer()).get(`/ai/businesses/${R.bizR}/ai/graph`).set(as(userId));
  const planReadAs = (userId: string, planId: string) =>
    request(rvApp.getHttpServer()).get(`/api/v1/cortex/plans/${planId}`).query({ businessId: R.bizR }).set(as(userId));
  const planStatus = async (planId: string) => (await db.aiPlan.findUnique({ where: { id: planId }, select: { status: true } }))?.status;

  /** The snapshot as GET graph/business answers it, or as GET ai/graph answers it (the snapshot itself). */
  const snapshotOf = (res: { body: any }, route: 'graph' | 'ai') => (route === 'graph' ? res.body.snapshot : res.body);

  beforeAll(async () => {
    for (const [id] of MEMBERS) {
      await db.user.create({ data: { id, email: `${P}${id.slice(P.length)}@test.local`, name: id, role: 'USER' } });
    }
    await db.business.create({ data: { id: R.bizR, name: `${R.bizR}-name`, ownerId: R.owner } });
    await db.businessSetting.create({ data: { id: `${R.bizR}_setting`, businessId: R.bizR, aiAutonomyLevel: 'full' } });
    for (const [userId, role, permissionScopes] of MEMBERS) {
      await db.membership.create({
        data: { id: `${P}m_${userId.slice(P.length)}`, userId, businessId: R.bizR, role, ...(permissionScopes === undefined ? {} : { permissionScopes }) },
      });
    }
    await db.contact.create({
      data: { id: R.client, businessId: R.bizR, firstName: 'v97x', lastName: 'Client', email: `${P}client@test.local`, status: 'CLIENT' },
    });
    await db.invoice.create({ data: { id: `${P}rvInvPaid`, businessId: R.bizR, contactId: R.client, invoiceNumber: 'v97x-PAID-1', total: 7777, status: 'PAID' } });
    await db.invoice.create({
      data: {
        id: `${P}rvInvOver`, businessId: R.bizR, contactId: R.client, invoiceNumber: 'v97x-OVER-1', total: 1234, status: 'SENT',
        dueDate: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      },
    });
    await resetPlans();

    const { Test } = await import('@nestjs/testing');
    const { ValidationPipe } = await import('@nestjs/common');
    const { APP_INTERCEPTOR } = await import('@nestjs/core');
    const { EventEmitter2 } = await import('@nestjs/event-emitter');
    const { TenantInterceptor } = await import('../src/core/tenant/tenant.interceptor');
    const { PrismaService } = await import('../src/core/prisma/prisma.service');
    const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
    const { AuthGuard } = await import('../src/core/auth/auth.guard');
    const { BusinessGuard } = await import('../src/core/auth/business.guard');
    const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
    const { CrmRateLimitGuard } = await import('../src/modules/crm/guards/rate-limit.guard');
    const { GraphActionsController } = await import('../src/modules/ai/graph-actions.controller');
    const { AiController } = await import('../src/modules/ai/ai.controller');
    const { BusinessGraphService } = await import('../src/modules/ai/business-graph.service');
    const { KeyCortexController, CortexMemberAuthorityGuard } = await import('../src/modules/key-cortex/key-cortex.controller');
    const { KeyCortexGoalsController } = await import('../src/modules/key-cortex/key-cortex-goals.controller');
    const { KeyCortexPlannerService } = await import('../src/modules/key-cortex/key-cortex-planner.service');
    const { KeyCortexTriggerService } = await import('../src/modules/key-cortex/key-cortex-trigger.service');
    const { KeyCortexExecutorService } = await import('../src/modules/key-cortex/key-cortex-executor.service');
    const { KeyCortexConnectorService } = await import('../src/modules/key-cortex/key-cortex-connector.service');
    const { ProjectsController } = await import('../src/modules/projects/projects.controller');
    const { ProjectsService } = await import('../src/modules/projects/projects.service');

    // The constructor parameter types tsc emits for KeyCortexGoalsController (no @Inject; vitest's esbuild emits none).
    if (!Reflect.getMetadata('design:paramtypes', KeyCortexGoalsController)) {
      Reflect.defineMetadata('design:paramtypes', [KeyCortexPlannerService, KeyCortexTriggerService, PrismaService], KeyCortexGoalsController);
    }

    const cortexExecutor = {
      execute: async (c: any) => {
        cortexExecuted.push({ module: c?.module, action: c?.action, userId: c?.userId });
        return { id: 'v97x-exec', command: c, result: { success: true, data: { v97x: 'executed' }, executionTimeMs: 1, command: c } };
      },
      logExecution: async (record: any) => {
        cortexAudits.push({ module: record?.command?.module, action: record?.command?.action, error: record?.result?.error });
      },
    };
    const cortexConnector = {
      getAllCapabilities: () => [],
      query: async (module: unknown, query: unknown, _parameters: unknown, _businessId: unknown, userId: unknown) => {
        cortexQueried.push({ module, query, userId });
        return { success: true, data: { v97x: 'queried' }, executionTimeMs: 1 };
      },
    };

    const rvRef = await Test.createTestingModule({
      controllers: [GraphActionsController, AiController, KeyCortexController, KeyCortexGoalsController, ProjectsController],
      providers: [
        PrismaService,
        AuthGuard,
        BusinessGuard,
        ModuleScopeGuard,
        CrmRateLimitGuard,
        CortexMemberAuthorityGuard,
        { provide: EventEmitter2, useValue: new EventEmitter2() },
        { provide: BusinessGraphService, inject: [PrismaService], useFactory: (prisma: any) => new BusinessGraphService(prisma) },
        { provide: KeyCortexPlannerService, useValue: planner },
        { provide: KeyCortexExecutorService, useValue: cortexExecutor },
        { provide: KeyCortexConnectorService, useValue: cortexConnector },
        {
          provide: ProjectsService,
          inject: [PrismaService],
          useFactory: (prisma: any) => new (ProjectsService as any)(prisma, new EventEmitter2(), {}, {}, {}),
        },
        { provide: APP_INTERCEPTOR, useClass: TenantInterceptor },
      ],
    })
      // Every collaborator no case reaches is inert.
      .useMocker(() => ({}))
      .compile();
    rvApp = rvRef.createNestApplication();
    rvApp.use(async (req: any, _res: any, next: any) => {
      const header = req.headers[HEADER];
      const id = typeof header === 'string' ? header : undefined;
      if (id && id.startsWith(P)) {
        const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
        if (user) req.user = { id: user.id, email: user.email, role: user.role };
      }
      next();
    });
    rvApp.useGlobalFilters(new GlobalHttpExceptionFilter());
    rvApp.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await rvApp.init();
  }, 180_000);

  afterAll(async () => {
    if (rvApp) await rvApp.close();
    await db.$executeRawUnsafe('DELETE FROM invoices WHERE business_id = $1', R.bizR);
    await db.$executeRawUnsafe('DELETE FROM contacts WHERE business_id = $1', R.bizR);
  });

  it('fixture sanity: the memberships are stored as described; ModuleScopeGuard (memberModuleLevel) reads every array member as none on revenue, expenses, analytics and projects', async () => {
    const rows = await db.membership.findMany({ where: { businessId: R.bizR }, select: { userId: true, role: true, permissionScopes: true } });
    const byUser = new Map(rows.map((r: any) => [r.userId, r]));
    for (const [userId, role, permissionScopes] of MEMBERS) {
      expect(byUser.get(userId), userId).toEqual({ userId, role, permissionScopes: permissionScopes ?? null });
    }
    const { memberModuleLevel } = await import('../src/core/authority/module-vocabulary');
    for (const userId of [R.co, R.admin, R.staff]) {
      for (const module of ['revenue', 'expenses', 'analytics', 'projects']) expect(memberModuleLevel(byUser.get(userId) as any, module), `${userId} ${module}`).toBe('none');
    }
    expect(await db.invoice.count({ where: { businessId: R.bizR } })).toBe(2);
  });

  /* ------------------ SEC-TGSA-1: POST api/v1/cortex/plans/:planId/execute ------------------ */

  it('RED-BEFORE (SEC-TGSA-1, D-114): the ADMIN stored as [] is refused its own plan of money steps (an invoice write among them), 403 (HTTP ai:write and planner revenue:write) before the claim; the plan stays pending and no step reaches the connector (was run: completed, all three routed)', async () => {
    await resetPlans();
    const routedBefore = routedFor(ADMIN_PLAN).length;
    const res = await executePlanAs(R.admin, ADMIN_PLAN);
    expect(res.status, describeBody(res)).toBe(403);
    expect(JSON.stringify(res.body)).toContain(AI_WRITE_NONE);
    let caught: any;
    await planner.executePlan(ADMIN_PLAN, {}, { userId: R.admin, role: 'USER', businessId: R.bizR }).catch((err: unknown) => { caught = err; });
    expect(caught?.getStatus?.(), String(caught)).toBe(403);
    expect(caught.message).toBe(PLAN_REVENUE_WRITE_NONE);
    expect(await planStatus(ADMIN_PLAN)).toBe('pending');
    expect(routedFor(ADMIN_PLAN).length).toBe(routedBefore);
  });

  it('RED-BEFORE (SEC-TGSA-1, D-71): the STAFF member stored as [] is refused its own plan of expenses and analytics reads, 403 (HTTP ai:write and planner expenses:read) before the claim (was run on the STAFF defaults: completed, both routed)', async () => {
    await resetPlans();
    const routedBefore = routedFor(STAFF_PLAN).length;
    const res = await executePlanAs(R.staff, STAFF_PLAN);
    expect(res.status, describeBody(res)).toBe(403);
    expect(res.body.message).toBe(AI_WRITE_NONE);
    let caught: any;
    await planner.executePlan(STAFF_PLAN, {}, { userId: R.staff, role: 'USER', businessId: R.bizR }).catch((err: unknown) => { caught = err; });
    expect(caught?.getStatus?.(), String(caught)).toBe(403);
    expect(caught.message).toBe(PLAN_EXPENSES_READ_NONE);
    expect(await planStatus(STAFF_PLAN)).toBe('pending');
    expect(routedFor(STAFF_PLAN).length).toBe(routedBefore);
  });

  it('control (object maps unchanged): the STAFF member whose map grants expenses and analytics read runs the same plan once, every step as themselves', async () => {
    await resetPlans();
    const routedBefore = routedFor(MAP_PLAN).length;
    const res = await executePlanAs(R.mapStaff, MAP_PLAN);
    expect(res.status, describeBody(res)).toBe(201);
    expect(await planStatus(MAP_PLAN)).toBe('completed');
    const ran = routedFor(MAP_PLAN).slice(routedBefore);
    expect(ran.map((r) => [r.module, r.action, r.userId])).toEqual([
      ['finance', 'list_expenses', R.mapStaff],
      ['analytics', 'get_overview', R.mapStaff],
    ]);
  });

  /* ------------------ SEC-TGSA-1: POST api/v1/cortex/execute and POST api/v1/cortex/query ------------------ */

  it('RED-BEFORE (SEC-TGSA-1): POST cortex/execute refuses an invoice write to the ADMIN and to the STAFF member stored as [], 403 with an audit row each, and nothing reaches the executor (was run for the ADMIN on its defaults; the STAFF member was refused at read)', async () => {
    await resetPlans();
    for (const userId of [R.admin, R.staff]) {
      const res = await cortexExecute(userId, 'commerce', 'create_invoice');
      expect(res.status, `${userId} ${describeBody(res)}`).toBe(403);
      expect(JSON.stringify(res.body), userId).toContain(REVENUE_WRITE_NONE);
    }
    expect(cortexExecuted).toEqual([]);
    expect(cortexAudits).toEqual([
      { module: 'commerce', action: 'create_invoice', error: REVENUE_WRITE_NONE },
      { module: 'commerce', action: 'create_invoice', error: REVENUE_WRITE_NONE },
    ]);
  });

  it('RED-BEFORE (SEC-TGSA-1): POST cortex/query refuses the revenue summary to the ADMIN and to the STAFF member stored as [], 403, and nothing reaches the connector (was answered on their role defaults)', async () => {
    await resetPlans();
    for (const userId of [R.admin, R.staff]) {
      const res = await cortexQuery(userId, 'commerce', 'get_revenue_summary');
      expect(res.status, `${userId} ${describeBody(res)}`).toBe(403);
      expect(JSON.stringify(res.body), userId).toContain(REVENUE_READ_NONE);
    }
    expect(cortexQueried).toEqual([]);
  });

  it('control (unchanged): the OWNER with no map runs the invoice write as themselves; the STAFF defaults and a revenue-read map are answered the revenue summary', async () => {
    await resetPlans();
    const exec = await cortexExecute(R.owner, 'commerce', 'create_invoice');
    expect(exec.status, describeBody(exec)).toBe(200);
    expect(cortexExecuted).toEqual([{ module: 'commerce', action: 'create_invoice', userId: R.owner }]);
    for (const userId of [R.defStaff, R.mapStaff]) {
      const res = await cortexQuery(userId, 'commerce', 'get_revenue_summary');
      expect(res.status, `${userId} ${describeBody(res)}`).toBe(200);
    }
    expect(cortexQueried).toEqual([
      { module: 'commerce', query: 'get_revenue_summary', userId: R.defStaff },
      { module: 'commerce', query: 'get_revenue_summary', userId: R.mapStaff },
    ]);
  });

  /* ------------------ SEC-TGSA-1: the KEY chat's commands (memberCommandRefusals) ------------------ */

  it('RED-BEFORE (SEC-TGSA-1): the KEY chat refuses an invoice write to the ADMIN, the STAFF member and the co-owner stored as [] (was admitted for the ADMIN and the co-owner on their defaults; refused the STAFF member at read); the OWNER with no map is admitted', async () => {
    const { KeyCortexQueryPipelineService } = await import('../src/modules/key-cortex/key-cortex-query-pipeline.service');
    const pipeline: any = Object.create(KeyCortexQueryPipelineService.prototype);
    pipeline.prisma = prismaSvc;
    const refusalFor = async (userId: string) => {
      const command = { module: 'commerce', action: 'create_invoice' };
      const refusals: Map<unknown, string> = await pipeline.memberCommandRefusals([command], { businessId: R.bizR, userId });
      return refusals.get(command) ?? null;
    };
    for (const userId of [R.admin, R.staff, R.co]) expect(await refusalFor(userId), userId).toBe(REVENUE_WRITE_NONE);
    expect(await refusalFor(R.owner)).toBeNull();
  });

  /* ------------------ SEC-TGSA-1: the projects plan door (assertMayGovernPlans) ------------------ */

  it('RED-BEFORE (COR-TOFGSA-1): POST projects/.../plans/:planId/approve refuses the STAFF member stored as [] at its explicit level, none (was refused at the STAFF default: read); the STAFF defaults are refused at read', async () => {
    const approve = (userId: string) =>
      request(rvApp.getHttpServer()).post(`/projects/businesses/${R.bizR}/plans/${P}rvNoPlan/approve`).set(as(userId)).send({});
    const arr = await approve(R.staff);
    expect(arr.status, describeBody(arr)).toBe(403);
    expect(JSON.stringify(arr.body)).toContain(PROJECT_PLAN_REFUSAL('none'));
    const defaults = await approve(R.defStaff);
    expect(defaults.status, describeBody(defaults)).toBe(403);
    expect(JSON.stringify(defaults.body)).toContain(PROJECT_PLAN_REFUSAL('read'));
  });

  /* ------------------ SEC-TGSA-2: GET graph/business/:businessId and GET ai/businesses/:businessId/ai/graph ------------------ */

  for (const route of ['graph', 'ai'] as const) {
    const path = route === 'graph' ? 'GET graph/business/:businessId' : 'GET ai/businesses/:businessId/ai/graph';
    const get = (userId: string) => (route === 'graph' ? graphOf(userId) : aiGraphOf(userId));

    it(`RED-BEFORE (SEC-TGSA-2): ${path} answers a member without revenue or expenses read (the STAFF, the ADMIN and the co-owner stored as []) no revenue or expenses figure, no overdue invoice, no top client or contact and no link (was answered all of them)`, async () => {
      for (const userId of [R.staff, R.admin, R.co]) {
        const res = await get(userId);
        expect(res.status, `${userId} ${describeBody(res)}`).toBe(200);
        const snapshot = snapshotOf(res, route);
        expect(snapshot.revenue, userId).toBeUndefined();
        expect(snapshot.expenses, userId).toBeUndefined();
        expect(snapshot.entities.overdueInvoices, userId).toEqual([]);
        expect(snapshot.entities.topContacts, userId).toEqual([]);
        expect(snapshot.contacts.topClients, userId).toEqual([]);
        expect(snapshot.links, userId).toEqual([]);
        expect(snapshot.healthIndicators.filter((h: any) => MONEY_AREAS.includes(h.area)), userId).toEqual([]);
        const text = JSON.stringify(res.body);
        for (const leak of ['7777', '1234', 'v97x-OVER-1', `${P}client@test.local`, 'v97x Client']) expect(text, `${userId} ${leak}`).not.toContain(leak);
        if (route === 'graph') expect(res.body.entityCounts, userId).toEqual({ topContacts: 0, overdueInvoices: 0, catalogProducts: 0 });
      }
    });

    it(`RED-BEFORE (SEC-TGSA-2): ${path} answers a revenue-read map its revenue figures and not the expenses figures`, async () => {
      const res = await get(R.revStaff);
      expect(res.status, describeBody(res)).toBe(200);
      const snapshot = snapshotOf(res, route);
      expect(snapshot.revenue.totalCollected).toBe(7777);
      expect(snapshot.expenses).toBeUndefined();
      expect(snapshot.healthIndicators.filter((h: any) => h.area === 'expenses' || h.area === 'profitability')).toEqual([]);
    });

    it(`control (D-57): ${path} answers the OWNER with no map, the STAFF defaults and a revenue and expenses map the revenue figures, the overdue invoice, the top client and the expenses section; no treasury, pipeline or support section on this route for anyone`, async () => {
      for (const userId of [R.owner, R.defStaff, R.mapStaff]) {
        const res = await get(userId);
        expect(res.status, `${userId} ${describeBody(res)}`).toBe(200);
        const snapshot = snapshotOf(res, route);
        expect(snapshot.revenue, userId).toMatchObject({ totalCollected: 7777, overdueAmount: 1234, overdueCount: 1 });
        expect(snapshot.expenses, userId).toBeDefined();
        expect(snapshot.entities.overdueInvoices.map((i: any) => [i.number, i.total, i.contactName]), userId).toEqual([['v97x-OVER-1', 1234, 'v97x Client']]);
        expect(snapshot.entities.topContacts.map((c: any) => [c.email, c.revenue]), userId).toEqual([[`${P}client@test.local`, 7777]]);
        expect(snapshot.contacts.topClients.map((c: any) => c.revenue), userId).toEqual([7777]);
        for (const key of ['treasury', 'pipeline', 'support']) expect(snapshot[key], `${userId} ${key}`).toBeUndefined();
      }
    });
  }

  /* ------------------ SEC-TGSA-3: GET api/v1/cortex/plans/:planId ------------------ */

  it('RED-BEFORE (SEC-TGSA-3, D-140): GET cortex/plans/:planId shows the co-owner stored as [] another member\'s plan without its revenue step or that step\'s output (was shown the output)', async () => {
    await resetPlans();
    const res = await planReadAs(R.co, DONE_PLAN);
    expect(res.status, describeBody(res)).toBe(200);
    expect(res.body.id).toBe(DONE_PLAN);
    expect(res.body.steps).toEqual([]);
    expect(JSON.stringify(res.body)).not.toContain('4321');
  });

  it('control (unchanged): the OWNER with no map is shown that step and its output', async () => {
    await resetPlans();
    const res = await planReadAs(R.owner, DONE_PLAN);
    expect(res.status, describeBody(res)).toBe(200);
    expect(res.body.steps.map((s: any) => [s.id, s.outputResult])).toEqual([[`${DONE_PLAN}_s1`, DONE_OUTPUT]]);
  });
});

/**
 * W11-OWNER-MAP-UNMAPPED-TOOLS (owner ruling D-140, 2026-11-12; closes seam review SEC-SR-3). D-140: an OWNER
 * membership that carries an explicit permissionScopes map is bound by it on KEY as on REST: it is refused every
 * unmapped KEY tool (fail closed), as it already is any mapped tool outside its map; an OWNER membership with no
 * explicit map keeps every tool.
 *
 * THE DEFECT (at e4e3b35b): memberToolRunAuthority's owner arm (plan-step-authority.ts) held an OWNER membership's
 * explicit map on every mapped tool (review SEC-W11D116K-1) but still ran every tool the authority map does not map
 * (graphActionRequirement null: the dotted organ and legacy cortex tools of KEY_ORGAN_TOOLS_UNMAPPED, D-119 "the
 * owner's only") for any OWNER membership, whatever its map said. So an owner whose own map grants
 * {operations: write} alone ran cortex.execute_tool (any registry tool by name) and key_connector.execute_internal
 * (any connector module.action by argument) on every KEY surface that judges a member by this rule: the KEY chat's
 * tool calls, the plan queue and an approved proposal (KeyCortexActionExecutorPlugin.runAuthority, the SEC-SR-1 path).
 * ModuleScopeGuard refuses that owner every module route its map leaves out.
 *
 * Required, and pinned here on the real rows: an OWNER membership with an explicit map (an object map, or a JSON array:
 * the map naming no module, memberModuleLevel's reading) is refused each unmapped tool with a stable refusal naming
 * that the tool needs the business owner's unrestricted access; an OWNER membership with no map (the recorded owner of
 * bizO, the co-owner of bizK) keeps them; non-owners keep D-119's refusal word for word.
 *
 * FIXTURES (bizK, Business.ownerId = kRecMap): kRecMap holds an OWNER membership with the explicit map
 * {operations: 'write'}; kCoArr an OWNER membership stored as []; kCoNull an OWNER membership with no map (D-125: a
 * co-owner, the control); kAdmin an ADMIN on role defaults; kStaff a STAFF membership with the same map as kRecMap.
 * The suite's bizO (ownerO: the recorded owner holding an OWNER membership with no map) is the second control.
 *
 * COMPOSITION:
 *   - the approved proposal over HTTP: POST key-autonomy/businesses/:businessId/actions/proposals/:proposalId/execute
 *     on one real Nest app with the real KeyActionProposalController, AuthGuard, BusinessGuard, ModuleScopeGuard,
 *     KeyCortexApprovalOrchestratorService, KeyActionProposalService (the claim and the approver re-read included),
 *     KeyActionPolicyService, KeyActionBoundaryService, CapabilityContractService, KeyActionExecutorService,
 *     KeyActionExecutorRegistryService, SafetyShellService and KeyCortexActionExecutorPlugin, the production
 *     TenantInterceptor, GlobalHttpExceptionFilter and ValidationPipe, and the suite's identity middleware. Stand-ins:
 *     the KEY cortex tool registry (records every tool the plugin hands it: the external effect counted here), the
 *     autonomy orchestrator and genome policy (allow), the temporal sink, the action audit and the cortex audit (no-op).
 *   - the plan queue: QueueService.processPlanStep, the worker body, called as BullMQ calls it, on the real
 *     PrismaService; its dispatcher records each step it is handed (the external effect), the oversight auto-approves.
 *   - the KEY chat's tool-call rule (KeyCortexQueryPipelineService.memberToolCallRefusals, which processQuery and
 *     streamQuery run on the model's tool calls) on the real rows through the service's own method: the chat route
 *     needs a model (the unit spec key-cortex-query-pipeline.service.spec.ts drives both chat paths).
 */
describe('W11-OWNER-MAP-UNMAPPED-TOOLS (D-140): an OWNER membership with an explicit scope map is refused every unmapped KEY tool on the KEY chat, the plan queue and an approved proposal', () => {
  const K = {
    bizK: `${P}bizK`,
    recMap: `${P}kRecMap`, // Business.ownerId of bizK; OWNER membership with the explicit map {operations: 'write'}
    coArr: `${P}kCoArr`, // co-owner: OWNER membership stored as [] (an explicit map naming no module)
    coNull: `${P}kCoNull`, // co-owner: OWNER membership with no explicit map (control)
    admin: `${P}kAdmin`, // ADMIN on role defaults (control: non-owner)
    staff: `${P}kStaff`, // STAFF with the same explicit map as kRecMap (control: non-owner)
  };
  const OPERATIONS_WRITE_MAP = { operations: 'write' };
  const MEMBERS: ReadonlyArray<readonly [string, string, unknown]> = [
    [K.recMap, 'OWNER', OPERATIONS_WRITE_MAP],
    [K.coArr, 'OWNER', []],
    [K.coNull, 'OWNER', undefined],
    [K.admin, 'ADMIN', undefined],
    [K.staff, 'STAFF', OPERATIONS_WRITE_MAP],
  ];
  /** The unmapped dotted tools D-140's definition of done names (KEY_ORGAN_TOOLS_UNMAPPED). */
  const UNMAPPED = ['cortex.execute_tool', 'key_connector.execute_internal'] as const;
  /** The OWNER memberships an explicit map binds (D-140). */
  const SCOPED_OWNERS = [K.recMap, K.coArr] as const;
  /** The OWNER memberships with no map: the co-owner of bizK and the recorded owner of bizO (the suite's control). */
  const UNBOUND_OWNERS: ReadonlyArray<readonly [string, string]> = [[K.bizK, K.coNull], [ID.bizO, ID.ownerO]];
  const slug = (tool: string) => tool.replace(/\./g, '_');

  let propApp: any;
  let worker: any;
  /** Every tool KeyCortexActionExecutorPlugin handed the KEY cortex registry, and the member it ran for. */
  const cortexRan: Array<{ tool: string; userId: unknown }> = [];
  /** Every plan step the plan-queue worker handed its dispatcher. */
  const dispatched: Array<{ toolName: string; planStepId: unknown }> = [];

  /** A plan `userId` created in `businessId`, approved, with the one step `toolName` (as PlannerService stores a step). */
  async function seedToolPlan(id: string, businessId: string, userId: string, toolName: string) {
    await db.aiPlan.create({
      data: {
        id, businessId, userId, objective: `v97x ${id}`, status: 'approved',
        steps: { create: [{ id: `${id}_s1`, order: 1, toolName, action: toolName, module: 'ai', status: 'pending', inputPayload: { marker: `${id}_s1` } }] },
      },
    });
    return `${id}_s1`;
  }

  /** The plan-queue worker body on the plan's one step, as BullMQ hands it a job. */
  function runQueueStep(planId: string, businessId: string, toolName: string) {
    const stepId = `${planId}_s1`;
    return worker.processPlanStep({
      data: {
        planId, stepId, businessId, toolName, args: {}, order: 1, dependsOn: [], retryCount: 0,
        idempotencyKey: `${planId}_job`, planContext: { planId, planStepId: stepId },
      },
    });
  }

  /**
   * An approved EXECUTE_TOOL proposal of `toolName`, as POST .../actions/proposals files it (MANUAL, the client's
   * payload, no stored plan) and the member approved it, or (`planId`) as PlanExecutorService.createStepProposal
   * files a plan step that needed approval (AI_PLAN, the stored plan and step).
   */
  async function seedProposal(id: string, businessId: string, userId: string, toolName: string, plan?: { planId: string; planStepId: string }) {
    await db.keyActionProposal.create({
      data: {
        id, businessId, userId, sourceType: plan ? 'AI_PLAN' : 'MANUAL', title: `v97x ${id}`, actionType: 'EXECUTE_TOOL',
        payload: { toolName, inputPayload: { marker: id } }, status: 'APPROVED', approvedBy: userId, approvedAt: new Date(),
        requiresApproval: true, riskLevel: 'MEDIUM', ...(plan ? { planId: plan.planId, planStepId: plan.planStepId } : {}),
      },
    });
  }

  const executeProposal = (userId: string, businessId: string, proposalId: string) =>
    request(propApp.getHttpServer()).post(`/key-autonomy/businesses/${businessId}/actions/proposals/${proposalId}/execute`).set(HEADER, userId).send({});
  const proposalRow = (id: string) => db.keyActionProposal.findUnique({ where: { id }, select: { status: true, failureReason: true, executedBy: true } });

  beforeAll(async () => {
    for (const [id] of MEMBERS) {
      await db.user.create({ data: { id, email: `${P}${id.slice(P.length)}@test.local`, name: id, role: 'USER' } });
    }
    await db.business.create({ data: { id: K.bizK, name: `${K.bizK}-name`, ownerId: K.recMap } });
    for (const [userId, role, permissionScopes] of MEMBERS) {
      await db.membership.create({
        data: { id: `${P}m_${userId.slice(P.length)}`, userId, businessId: K.bizK, role, ...(permissionScopes === undefined ? {} : { permissionScopes }) },
      });
    }

    const { Test } = await import('@nestjs/testing');
    const { Logger, ValidationPipe } = await import('@nestjs/common');
    const { APP_INTERCEPTOR } = await import('@nestjs/core');
    const { EventEmitter2 } = await import('@nestjs/event-emitter');
    const { TenantInterceptor } = await import('../src/core/tenant/tenant.interceptor');
    const { PrismaService } = await import('../src/core/prisma/prisma.service');
    const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
    const { AuthGuard } = await import('../src/core/auth/auth.guard');
    const { BusinessGuard } = await import('../src/core/auth/business.guard');
    const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
    const { TemporalFlowService } = await import('../src/modules/temporal-flow/temporal-flow.service');
    const { CapabilityContractService } = await import('../src/modules/capabilities/capability-contract.service');
    const { KeyActionProposalController } = await import('../src/modules/key-autonomy/key-action-proposal.controller');
    const { KeyActionProposalService } = await import('../src/modules/key-autonomy/key-action-proposal.service');
    const { KeyActionPolicyService } = await import('../src/modules/key-autonomy/key-action-policy.service');
    const { KeyActionExecutorService } = await import('../src/modules/key-autonomy/key-action-executor.service');
    const { KeyActionExecutorRegistryService } = await import('../src/modules/key-autonomy/key-action-executor-registry.service');
    const { SafetyShellService } = await import('../src/modules/key-autonomy/safety-shell.service');
    const { ActionAuditService } = await import('../src/modules/key-autonomy/action-audit.service');
    const { KeyActionGenomePolicyService } = await import('../src/modules/key-autonomy/key-action-genome-policy.service');
    const { AutonomyOrchestratorService } = await import('../src/modules/key-autonomy/autonomy-orchestrator.service');
    const { KeyActionBoundaryService } = await import('../src/modules/key-autonomy/action-boundary/key-action-boundary.service');
    const { KeyCortexApprovalOrchestratorService } = await import('../src/modules/key-cortex/key-cortex-approval-orchestrator.service');
    const { KeyCortexActionExecutorPlugin } = await import('../src/modules/key-cortex/key-cortex-action-executor.plugin');
    const { QueueService } = await import('../src/modules/ai/queue.service');

    const cortexRegistry = {
      execute: async (tool: string, ctx: { userId?: unknown }) => {
        cortexRan.push({ tool, userId: ctx?.userId });
        return { success: true, data: { v97x: tool } };
      },
    };
    const allow = { allowed: true, requiresApproval: false, tier: 'full', confidence: 1, reason: 'v97x: allowed', ruleTrace: [], createdAt: new Date() };
    const noop = async () => undefined;

    const propRef = await Test.createTestingModule({
      controllers: [KeyActionProposalController],
      providers: [
        PrismaService,
        AuthGuard,
        BusinessGuard,
        ModuleScopeGuard,
        KeyActionProposalService,
        KeyActionPolicyService,
        KeyActionBoundaryService,
        CapabilityContractService,
        KeyActionExecutorService,
        KeyActionExecutorRegistryService,
        SafetyShellService,
        { provide: EventEmitter2, useValue: new EventEmitter2() },
        { provide: TemporalFlowService, useValue: { emit: async () => ({}) } },
        { provide: ActionAuditService, useValue: { recordBlocked: noop, recordFailed: noop, recordExecuted: noop } },
        { provide: KeyActionGenomePolicyService, useValue: { evaluateExecution: async () => ({ allowed: true, requiresExtraConfirmation: false, message: 'v97x: allowed', blockedReasons: [], missingFacts: [] }) } },
        { provide: AutonomyOrchestratorService, useValue: { evaluateAction: async () => allow } },
        // Constructed by hand: its second parameter carries no @Inject (vitest's esbuild emits no design:paramtypes).
        {
          provide: KeyCortexApprovalOrchestratorService,
          inject: [KeyActionProposalService],
          useFactory: (proposals: any) => new KeyCortexApprovalOrchestratorService(proposals, { emit: noop } as any),
        },
        { provide: APP_INTERCEPTOR, useClass: TenantInterceptor },
      ],
    })
      // Every collaborator no case reaches is inert (the executor's genome and constitution services).
      .useMocker(() => ({}))
      .compile();
    // The real plugin, registered as its onModuleInit registers it, over the recording KEY cortex registry; it reads
    // the PrismaService through the module, as in production.
    const plugin = new KeyCortexActionExecutorPlugin(propRef.get(KeyActionExecutorRegistryService), cortexRegistry as any, propRef as any);
    plugin.onModuleInit();
    propApp = propRef.createNestApplication();
    propApp.use(async (req: any, _res: any, next: any) => {
      const header = req.headers[HEADER];
      const id = typeof header === 'string' ? header : undefined;
      if (id && id.startsWith(P)) {
        const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
        if (user) req.user = { id: user.id, email: user.email, role: user.role };
      }
      next();
    });
    propApp.useGlobalFilters(new GlobalHttpExceptionFilter());
    propApp.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await propApp.init();

    worker = Object.create(QueueService.prototype);
    Object.assign(worker, {
      prisma: prismaSvc,
      events: { emit: () => true },
      governance: { evaluateAutoApproval: async () => ({ autoApproved: true }) },
      actionDispatcher: {
        dispatch: async (req: { toolName: string; planStepId?: string }) => {
          dispatched.push({ toolName: req.toolName, planStepId: req.planStepId });
          return { success: true, result: { v97x: req.toolName } };
        },
      },
      stateMachine: { transition: async () => undefined },
      logger: new Logger('v97x-queue'),
    });
  }, 180_000);

  // Every row this section writes (bizK's and bizO's plans and proposals included) goes with the suite's prefix
  // cleanup (key_action_proposals before ai_plans).
  afterAll(async () => {
    if (propApp) await propApp.close();
  });

  it('fixture sanity: bizK is recorded as kRecMap\'s; the memberships are stored as described (the scoped owners\' maps explicit, as ModuleScopeGuard reads them); bizO\'s recorded owner holds an OWNER membership with no map', async () => {
    expect(await db.business.findUnique({ where: { id: K.bizK }, select: { ownerId: true } })).toEqual({ ownerId: K.recMap });
    const rows = await db.membership.findMany({ where: { businessId: K.bizK }, select: { userId: true, role: true, permissionScopes: true }, orderBy: { userId: 'asc' } });
    expect(rows).toEqual([
      { userId: K.admin, role: 'ADMIN', permissionScopes: null },
      { userId: K.coArr, role: 'OWNER', permissionScopes: [] },
      { userId: K.coNull, role: 'OWNER', permissionScopes: null },
      { userId: K.recMap, role: 'OWNER', permissionScopes: OPERATIONS_WRITE_MAP },
      { userId: K.staff, role: 'STAFF', permissionScopes: OPERATIONS_WRITE_MAP },
    ]);
    expect(await db.membership.findUnique({ where: { userId_businessId: { userId: ID.ownerO, businessId: ID.bizO } }, select: { role: true, permissionScopes: true } }))
      .toEqual({ role: 'OWNER', permissionScopes: null });
  });

  /* ------------------------------ the rule (memberToolRunAuthority) ------------------------------ */

  it('RED-BEFORE (D-140): memberToolRunAuthority refuses the scoped recorded owner ({operations: write}) and the co-owner stored as [] both unmapped dotted tools, with or without the principal, naming the business owner\'s unrestricted access (was admitted: null)', async () => {
    for (const userId of SCOPED_OWNERS) {
      for (const tool of UNMAPPED) {
        for (const asPrincipal of [false, true]) {
          expect(await memberToolRunAuthority(prismaSvc, K.bizK, userId, tool, { asPrincipal }), `${userId} ${tool} asPrincipal ${asPrincipal}`).toEqual({
            refusal: OWNER_MAP_UNMAPPED_REFUSAL(tool),
            principal: false,
          });
        }
      }
    }
  });

  it('control (D-140, D-125, D-119): the OWNER memberships with no map (the co-owner of bizK, the recorded owner of bizO) run both, as the principal when asked; the ADMIN and the STAFF member keep D-119\'s refusal word for word; the scoped recorded owner still runs a mapped organ tool its map reaches (key_inbox.list_threads: operations read)', async () => {
    for (const [businessId, userId] of UNBOUND_OWNERS) {
      for (const tool of UNMAPPED) {
        expect(await memberToolRunAuthority(prismaSvc, businessId, userId, tool), `${userId} ${tool}`).toEqual({ refusal: null, principal: false });
        expect(await memberToolRunAuthority(prismaSvc, businessId, userId, tool, { asPrincipal: true }), `${userId} ${tool}`).toEqual({ refusal: null, principal: true });
      }
    }
    for (const userId of [K.admin, K.staff]) {
      for (const tool of UNMAPPED) {
        expect(await memberToolRunAuthority(prismaSvc, K.bizK, userId, tool), `${userId} ${tool}`).toEqual({ refusal: NOT_MAPPED_REFUSAL(tool), principal: false });
      }
    }
    expect(await memberToolRunAuthority(prismaSvc, K.bizK, K.recMap, 'key_inbox.list_threads')).toEqual({ refusal: null, principal: false });
  });

  /* ------------------------------ the KEY chat's tool calls ------------------------------ */

  it('RED-BEFORE (D-140): the KEY chat\'s tool-call rule (memberToolCallRefusals, on the real rows) refuses both scoped owners both unmapped dotted tools (was run); the owners with no map run them; the ADMIN and the STAFF member are refused them as before', async () => {
    const { KeyCortexQueryPipelineService } = await import('../src/modules/key-cortex/key-cortex-query-pipeline.service');
    const pipeline: any = Object.create(KeyCortexQueryPipelineService.prototype);
    pipeline.prisma = prismaSvc;
    const refusalsFor = async (businessId: string, userId: string) =>
      Object.fromEntries((await pipeline.memberToolCallRefusals([...UNMAPPED], { businessId, userId })) as Map<string, string>);
    for (const userId of SCOPED_OWNERS) {
      expect(await refusalsFor(K.bizK, userId), userId).toEqual(Object.fromEntries(UNMAPPED.map((tool) => [tool, OWNER_MAP_UNMAPPED_REFUSAL(tool)])));
    }
    for (const [businessId, userId] of UNBOUND_OWNERS) expect(await refusalsFor(businessId, userId), userId).toEqual({});
    for (const userId of [K.admin, K.staff]) {
      expect(await refusalsFor(K.bizK, userId), userId).toEqual(Object.fromEntries(UNMAPPED.map((tool) => [tool, NOT_MAPPED_REFUSAL(tool)])));
    }
  });

  /* ------------------------------ the plan queue ------------------------------ */

  it('RED-BEFORE (D-140): the plan queue (QueueService.processPlanStep) refuses a step of either unmapped tool on a plan either scoped owner created: the step is recorded failed with the refusal and nothing is dispatched (was dispatched and completed)', async () => {
    for (const userId of SCOPED_OWNERS) {
      for (const tool of UNMAPPED) {
        const planId = `${userId}_q_${slug(tool)}`;
        const stepId = await seedToolPlan(planId, K.bizK, userId, tool);
        const before = dispatched.length;
        expect(await runQueueStep(planId, K.bizK, tool), planId).toEqual({ refused: OWNER_MAP_UNMAPPED_REFUSAL(tool) });
        expect(dispatched.slice(before), planId).toEqual([]);
        expect(await db.aiPlanStep.findUnique({ where: { id: stepId }, select: { status: true, errorMessage: true } }), planId).toEqual({
          status: 'failed',
          errorMessage: `Refused: ${OWNER_MAP_UNMAPPED_REFUSAL(tool)}`,
        });
      }
    }
  });

  it('control (D-140, D-125; D-119 unchanged): the plan queue dispatches the same steps once on a plan an OWNER with no map created (the co-owner of bizK, the recorded owner of bizO), and they complete; the ADMIN\'s and the STAFF member\'s steps are refused as before', async () => {
    for (const [businessId, userId] of UNBOUND_OWNERS) {
      for (const tool of UNMAPPED) {
        const planId = `${P}k_q_${userId.slice(P.length)}_${slug(tool)}`;
        const stepId = await seedToolPlan(planId, businessId, userId, tool);
        const before = dispatched.length;
        expect(await runQueueStep(planId, businessId, tool), planId).toEqual({ v97x: tool });
        expect(dispatched.slice(before), planId).toEqual([{ toolName: tool, planStepId: stepId }]);
        expect((await db.aiPlanStep.findUnique({ where: { id: stepId }, select: { status: true } }))?.status, planId).toBe('completed');
      }
    }
    for (const userId of [K.admin, K.staff]) {
      for (const tool of UNMAPPED) {
        const planId = `${userId}_q_${slug(tool)}`;
        await seedToolPlan(planId, K.bizK, userId, tool);
        const before = dispatched.length;
        expect(await runQueueStep(planId, K.bizK, tool), planId).toEqual({ refused: NOT_MAPPED_REFUSAL(tool) });
        expect(dispatched.slice(before), planId).toEqual([]);
      }
    }
  });

  /* ------------------------------ an approved proposal, over HTTP ------------------------------ */

  it('RED-BEFORE (D-140): POST key-autonomy/.../proposals/:id/execute of an approved EXECUTE_TOOL proposal of either unmapped tool, filed (MANUAL) and executed by either scoped owner, never reaches the KEY cortex registry (K.recMap FAILED with D-140 refusal; K.coArr [] refused 403 operations:write by ModuleScopeGuard)', async () => {
    for (const userId of SCOPED_OWNERS) {
      for (const tool of UNMAPPED) {
        const id = `${userId}_p_${slug(tool)}`;
        await seedProposal(id, K.bizK, userId, tool);
        const before = cortexRan.length;
        const res = await executeProposal(userId, K.bizK, id);
        if (userId === K.coArr) {
          // SWP-CENSUS-KEY-B (P109, Ruling B2): K.coArr ([]) holds operations:none, so ModuleScopeGuard refuses 403 before execution.
          expect(res.status, describeBody(res)).toBe(403);
          expect(String(res.body.message), id).toMatch(/operations requires write/i);
        } else {
          expect(res.status, describeBody(res)).toBe(201);
          expect(res.body, id).toMatchObject({ id, status: 'FAILED', failureReason: `Refused: ${OWNER_MAP_UNMAPPED_REFUSAL(tool)}` });
          expect(await proposalRow(id), id).toEqual({ status: 'FAILED', failureReason: `Refused: ${OWNER_MAP_UNMAPPED_REFUSAL(tool)}`, executedBy: userId });
        }
        expect(cortexRan.slice(before), id).toEqual([]);
      }
    }
  });

  it('RED-BEFORE (D-140): an approved plan step\'s proposal (AI_PLAN, its stored plan created by either scoped owner) runs as the plan\'s member (planStepRunAuthority), so executing it over HTTP, whoever executes it (the co-owner with no map included), is FAILED with the refusal and never reaches the KEY cortex registry (was EXECUTED)', async () => {
    for (const userId of SCOPED_OWNERS) {
      for (const tool of UNMAPPED) {
        const planId = `${userId}_pp_${slug(tool)}`;
        const planStepId = await seedToolPlan(planId, K.bizK, userId, tool);
        const id = `${planId}_proposal`;
        await seedProposal(id, K.bizK, K.coNull, tool, { planId, planStepId });
        const before = cortexRan.length;
        const res = await executeProposal(K.coNull, K.bizK, id);
        expect(res.status, describeBody(res)).toBe(201);
        expect(res.body, id).toMatchObject({ id, status: 'FAILED', failureReason: `Refused: ${OWNER_MAP_UNMAPPED_REFUSAL(tool)}` });
        expect(cortexRan.slice(before), id).toEqual([]);
      }
    }
  });

  it('control (D-140, D-125; D-119 unchanged): the same proposals filed and executed by an OWNER with no map (the co-owner of bizK, the recorded owner of bizO) are EXECUTED, each reaching the KEY cortex registry once, run for that owner; the ADMIN\'s and the STAFF member\'s are FAILED with D-119\'s refusal and reach nothing', async () => {
    for (const [businessId, userId] of UNBOUND_OWNERS) {
      for (const tool of UNMAPPED) {
        const id = `${P}k_p_${userId.slice(P.length)}_${slug(tool)}`;
        await seedProposal(id, businessId, userId, tool);
        const before = cortexRan.length;
        const res = await executeProposal(userId, businessId, id);
        expect(res.status, describeBody(res)).toBe(201);
        expect(res.body, id).toMatchObject({ id, status: 'EXECUTED', executionResult: { v97x: tool } });
        expect(cortexRan.slice(before), id).toEqual([{ tool, userId }]);
      }
    }
    for (const userId of [K.admin, K.staff]) {
      for (const tool of UNMAPPED) {
        const id = `${userId}_p_${slug(tool)}`;
        await seedProposal(id, K.bizK, userId, tool);
        const before = cortexRan.length;
        const res = await executeProposal(userId, K.bizK, id);
        expect(res.status, describeBody(res)).toBe(201);
        expect(res.body, id).toMatchObject({ id, status: 'FAILED', failureReason: `Refused: ${NOT_MAPPED_REFUSAL(tool)}` });
        expect(cortexRan.slice(before), id).toEqual([]);
      }
    }
  });
});

/**
 * W11-OWNER-MAP-UNMAPPED-TOOLS review repair (review findings SEC-W11OMU-1, COR-W11OMU-1, SEC-W11OMU-2; owner ruling
 * D-140, with D-71, D-114, D-46 and V1-10 review ST-3): the KEY cortex plan door, POST api/v1/cortex/plans/:planId/execute
 * (KeyCortexPlannerService.executePlan), binds an OWNER membership's explicit scope map as the other KEY surfaces do.
 *
 * THE DEFECT (at 67b55e96, and at e4e3b35b before it): the planner's owner bypass in assertStepsWithinAuthority,
 * assertRevenueWrite and mayOverrideApproval read only the membership's role (isBusinessOwner), never its
 * permissionScopes map. So an OWNER membership with an explicit map (stored as [], or an object map) ran, on this door:
 * plan steps of modules mapped to no module scope (genome, activity: memberPlanStepScopeRefusal refuses them to every
 * other member), steps of mapped modules its map leaves out (expenses, revenue), invoice and payment writes its revenue
 * level does not reach (another member's plan included), and skipApproval past the business's approval policy. The same
 * owner is refused that work by memberToolRunAuthority (the KEY chat, the plan queue, an approved proposal), by POST
 * api/v1/cortex/execute, and is not shown those steps by GET api/v1/cortex/plans/:planId (graphPlanReadScope, SEC-TGSA-3).
 *
 * Required, pinned here over HTTP on the real rows: only an OWNER membership with NO explicit map passes every step,
 * holds revenue write and may skip the approval policy. An OWNER membership with an explicit map is held to it like any
 * member (assertMemberSteps: memberPlanStepScopeRefusal on its map; memberModuleLevel's revenue write for an invoice or
 * payment plan), and its skipApproval is ignored (the steps follow the business's approval policy). It stays the business
 * owner for who may run a plan (another member's included) and for contact visibility (a role rule, not a module scope,
 * as graphPlanReadScope keeps it every member's plans and every contact).
 *
 * FIXTURES (bizP, Business.ownerId = pOwner): pOwner holds an OWNER membership with no map (the control); pCoArr an
 * OWNER membership stored as [] (D-125: an owner; the map naming no module); pCoMap an OWNER membership with the object
 * map {operations: 'write'}; pStaff a STAFF membership on role defaults (the creator of another member's plan);
 * pStaffArr a STAFF membership stored as [] (the D-71 control: the refusal the scoped owners now get). bizP's settings:
 * full autonomy, and notifications.send_notification always needs approval (aiAlwaysRequireApproval), so a skipApproval
 * that is honoured runs it and one that is ignored parks it.
 *
 * HTTP COMPOSITION: one real Nest app with the real KeyCortexGoalsController, PrismaService, AuthGuard, BusinessGuard,
 * the production TenantInterceptor, GlobalHttpExceptionFilter and ValidationPipe, and the suite's identity middleware;
 * the planner is the suite's (the real KeyCortexPlannerService, KeyCortexExecutorService and KeyCortexSagaService over
 * the recording connector: `routed` is the external effect). The no-member path (the query pipeline and the cortex
 * triggers call executePlan with no member) is driven on the same planner.
 */
describe('W11-OWNER-MAP-UNMAPPED-TOOLS review repair (SEC-W11OMU-1, COR-W11OMU-1; D-140): POST cortex/plans/:planId/execute holds an OWNER membership with an explicit scope map to it', () => {
  const Q = {
    bizP: `${P}bizP`,
    owner: `${P}pOwner`, // Business.ownerId of bizP; OWNER membership with no map (control)
    coArr: `${P}pCoArr`, // co-owner: OWNER membership stored as []
    coMap: `${P}pCoMap`, // co-owner: OWNER membership with the object map {operations: 'write'}
    staff: `${P}pStaff`, // STAFF on role defaults (creates another member's plan)
    staffArr: `${P}pStaffArr`, // STAFF stored as [] (D-71 control)
  };
  // SWP-CENSUS-KEY-B (P109, Ruling B2): POST plans/:planId/execute requires ai:write; Q.coMap keeps revenue/expenses/genome absent.
  const OPERATIONS_WRITE_MAP = { operations: 'write', ai: 'write' };
  const AI_WRITE_NONE = 'Insufficient permissions: ai requires write access (you have none)';
  const MEMBERS: ReadonlyArray<readonly [string, string, unknown]> = [
    [Q.owner, 'OWNER', undefined],
    [Q.coArr, 'OWNER', []],
    [Q.coMap, 'OWNER', OPERATIONS_WRITE_MAP],
    [Q.staff, 'STAFF', undefined],
    [Q.staffArr, 'STAFF', []],
  ];
  /** The step the business's approval policy always parks (bizP's aiAlwaysRequireApproval). */
  const NEEDS_APPROVAL: readonly [string, string] = ['notifications', 'send_notification'];

  const PLAN_REVENUE_WRITE_NONE = 'Insufficient permissions: revenue requires write access (you have none); this plan writes the business\'s invoices or payments';
  const UNMAPPED_STEP = (module: string, action: string) =>
    `Plan step "${module}.${action}": module "${module}" is mapped to no module scope, so it is not run for this member (D-71)`;
  const EXPENSES_READ_NONE = 'Insufficient permissions: expenses requires read access (you have none); plan step "finance.list_expenses" is not run (D-71)';

  /** Every plan this section runs: its creator and its steps (module, action). */
  const PLANS: Record<string, { userId: string; steps: ReadonlyArray<readonly [string, string]> }> = {
    // Another member's plan of money steps, an invoice write among them (the reviewer's case (a)).
    [`${Q.staff}_money`]: { userId: Q.staff, steps: [['commerce', 'list_invoices'], ['commerce', 'mark_invoice_paid'], ['finance', 'get_profit_loss']] },
    // A plan of unmapped modules and a mapped module the map leaves out (COR-W11OMU-1's probe), by each actor.
    [`${Q.coArr}_probe`]: { userId: Q.coArr, steps: [['genome', 'get_dna'], ['activity', 'list_recent'], ['finance', 'list_expenses']] },
    [`${Q.coArr}_probe_nm`]: { userId: Q.coArr, steps: [['genome', 'get_dna'], ['activity', 'list_recent'], ['finance', 'list_expenses']] },
    [`${Q.staffArr}_probe`]: { userId: Q.staffArr, steps: [['genome', 'get_dna'], ['activity', 'list_recent'], ['finance', 'list_expenses']] },
    [`${Q.owner}_probe`]: { userId: Q.owner, steps: [['genome', 'get_dna'], ['activity', 'list_recent'], ['finance', 'list_expenses']] },
    [`${Q.owner}_probe_nm`]: { userId: Q.owner, steps: [['genome', 'get_dna'], ['activity', 'list_recent'], ['finance', 'list_expenses']] },
    // An unmapped write and two payment writes, run with skipApproval (the reviewer's case (b)).
    [`${Q.coArr}_pay`]: { userId: Q.coArr, steps: [['genome', 'update_dna'], ['commerce', 'process_payment'], ['commerce', 'send_invoice']] },
    [`${Q.owner}_pay`]: { userId: Q.owner, steps: [['genome', 'update_dna'], ['commerce', 'process_payment'], ['commerce', 'send_invoice']] },
    // The object-map owner: a step its map reaches beside an unmapped one; a mapped module its map leaves out; a
    // step its map reaches alone; the step the policy always parks (with skipApproval).
    [`${Q.coMap}_genome`]: { userId: Q.coMap, steps: [['inbox', 'archive_thread'], ['genome', 'update_dna']] },
    [`${Q.coMap}_expenses`]: { userId: Q.coMap, steps: [['finance', 'list_expenses']] },
    [`${Q.coMap}_ok`]: { userId: Q.coMap, steps: [['inbox', 'archive_thread']] },
    [`${Q.coMap}_skip`]: { userId: Q.coMap, steps: [NEEDS_APPROVAL] },
    [`${Q.owner}_skip`]: { userId: Q.owner, steps: [NEEDS_APPROVAL] },
  };

  let planApp: any;

  async function resetPlans() {
    await db.$executeRawUnsafe('DELETE FROM ai_plans WHERE business_id = $1', Q.bizP);
    await db.$executeRawUnsafe('DELETE FROM saga_executions WHERE business_id = $1', Q.bizP);
    for (const [planId, { userId, steps }] of Object.entries(PLANS)) {
      await db.aiPlan.create({
        data: {
          id: planId, businessId: Q.bizP, userId, objective: `v97x ${planId}`, status: 'pending',
          steps: {
            create: steps.map(([module, action], i) => ({
              id: `${planId}_s${i + 1}`, order: i + 1, module, action, toolName: `${module}.${action}`,
              inputPayload: { marker: `${planId}_s${i + 1}` },
            })),
          },
        },
      });
    }
  }

  const executeAs = (userId: string, planId: string, body: Record<string, unknown> = {}) =>
    request(planApp.getHttpServer()).post(`/api/v1/cortex/plans/${planId}/execute`).set(HEADER, userId).send({ businessId: Q.bizP, ...body });
  const readAs = (userId: string, planId: string) =>
    request(planApp.getHttpServer()).get(`/api/v1/cortex/plans/${planId}`).query({ businessId: Q.bizP }).set(HEADER, userId);
  const planState = async (planId: string) => {
    const row = await planRow(planId);
    return { status: row?.status, steps: row?.steps.map((s: { status: string }) => s.status) };
  };
  /** What the connector was handed for `planId`'s steps since `from` (an index into the suite's `routed`). */
  const routedSince = (from: number, planId: string) =>
    routed.slice(from).filter((r) => typeof r.marker === 'string' && r.marker.startsWith(`${planId}_s`));
  const ranAs = (from: number, planId: string) => routedSince(from, planId).map((r) => [r.module, r.action, r.userId]);

  /**
   * `userId` executes `planId` over HTTP and is refused: 403 with `refusal`, and the plan is left as it was (still
   * pending, no step run) with nothing routed.
   */
  async function expectRefused(userId: string, planId: string, refusal: string, body: Record<string, unknown> = {}) {
    const from = routed.length;
    const res = await executeAs(userId, planId, body);
    expect(res.status, `${planId}: ${describeBody(res)}`).toBe(403);
    expect(res.body.message, planId).toBe(refusal);
    expect(await planState(planId), planId).toEqual({ status: 'pending', steps: PLANS[planId].steps.map(() => 'pending') });
    expect(routedSince(from, planId), planId).toEqual([]);
  }

  beforeAll(async () => {
    for (const [id] of MEMBERS) {
      await db.user.create({ data: { id, email: `${P}${id.slice(P.length)}@test.local`, name: id, role: 'USER' } });
    }
    await db.business.create({ data: { id: Q.bizP, name: `${Q.bizP}-name`, ownerId: Q.owner } });
    await db.businessSetting.create({
      data: { id: `${Q.bizP}_setting`, businessId: Q.bizP, aiAutonomyLevel: 'full', aiAlwaysRequireApproval: [NEEDS_APPROVAL.join('.')] },
    });
    for (const [userId, role, permissionScopes] of MEMBERS) {
      await db.membership.create({
        data: { id: `${P}m_${userId.slice(P.length)}`, userId, businessId: Q.bizP, role, ...(permissionScopes === undefined ? {} : { permissionScopes }) },
      });
    }

    const { Test } = await import('@nestjs/testing');
    const { ValidationPipe } = await import('@nestjs/common');
    const { APP_INTERCEPTOR } = await import('@nestjs/core');
    const { TenantInterceptor } = await import('../src/core/tenant/tenant.interceptor');
    const { PrismaService } = await import('../src/core/prisma/prisma.service');
    const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
    const { AuthGuard } = await import('../src/core/auth/auth.guard');
    const { BusinessGuard } = await import('../src/core/auth/business.guard');
    const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
    const { KeyCortexGoalsController } = await import('../src/modules/key-cortex/key-cortex-goals.controller');
    const { KeyCortexPlannerService } = await import('../src/modules/key-cortex/key-cortex-planner.service');
    const { KeyCortexTriggerService } = await import('../src/modules/key-cortex/key-cortex-trigger.service');

    // The constructor parameter types tsc emits for KeyCortexGoalsController (no @Inject; vitest's esbuild emits none).
    if (!Reflect.getMetadata('design:paramtypes', KeyCortexGoalsController)) {
      Reflect.defineMetadata('design:paramtypes', [KeyCortexPlannerService, KeyCortexTriggerService, PrismaService], KeyCortexGoalsController);
    }
    const planRef = await Test.createTestingModule({
      controllers: [KeyCortexGoalsController],
      providers: [
        PrismaService,
        AuthGuard,
        BusinessGuard,
        ModuleScopeGuard,
        { provide: KeyCortexPlannerService, useValue: planner },
        { provide: APP_INTERCEPTOR, useClass: TenantInterceptor },
      ],
    })
      // The trigger service and every other collaborator no case reaches are inert.
      .useMocker(() => ({}))
      .compile();
    planApp = planRef.createNestApplication();
    planApp.use(async (req: any, _res: any, next: any) => {
      const header = req.headers[HEADER];
      const id = typeof header === 'string' ? header : undefined;
      if (id && id.startsWith(P)) {
        const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
        if (user) req.user = { id: user.id, email: user.email, role: user.role };
      }
      next();
    });
    planApp.useGlobalFilters(new GlobalHttpExceptionFilter());
    planApp.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await planApp.init();
  }, 180_000);

  // Every row this section writes goes with the suite's prefix cleanup.
  afterAll(async () => {
    if (planApp) await planApp.close();
  });

  it('fixture sanity: bizP is recorded as pOwner\'s; the memberships are stored as described (ModuleScopeGuard reads both scoped owners\' maps as explicit: no expenses, no revenue); bizP\'s policy always parks notifications.send_notification', async () => {
    expect(await db.business.findUnique({ where: { id: Q.bizP }, select: { ownerId: true } })).toEqual({ ownerId: Q.owner });
    const rows = await db.membership.findMany({ where: { businessId: Q.bizP }, select: { userId: true, role: true, permissionScopes: true }, orderBy: { userId: 'asc' } });
    expect(rows).toEqual([
      { userId: Q.coArr, role: 'OWNER', permissionScopes: [] },
      { userId: Q.coMap, role: 'OWNER', permissionScopes: OPERATIONS_WRITE_MAP },
      { userId: Q.owner, role: 'OWNER', permissionScopes: null },
      { userId: Q.staff, role: 'STAFF', permissionScopes: null },
      { userId: Q.staffArr, role: 'STAFF', permissionScopes: [] },
    ]);
    const { memberModuleLevel } = await import('../src/core/authority/module-vocabulary');
    for (const userId of [Q.coArr, Q.coMap]) {
      const m = rows.find((r: any) => r.userId === userId);
      for (const module of ['revenue', 'expenses']) expect(memberModuleLevel(m as any, module), `${userId} ${module}`).toBe('none');
    }
    expect(memberModuleLevel(rows.find((r: any) => r.userId === Q.coMap) as any, 'operations')).toBe('write');
    expect(await db.businessSetting.findUnique({ where: { businessId: Q.bizP }, select: { aiAutonomyLevel: true, aiAlwaysRequireApproval: true } }))
      .toEqual({ aiAutonomyLevel: 'full', aiAlwaysRequireApproval: ['notifications.send_notification'] });
  });

  /* ------------------ the OWNER membership stored as [] ------------------ */

  it('RED-BEFORE (SEC-W11OMU-1 (a); D-140, D-46): the co-owner stored as [] executing another member\'s plan of money steps (an invoice write among them) is refused 403 (HTTP ai:write and planner revenue:write), before the claim: the plan stays pending and nothing reaches the connector (was run: completed, all three routed as the co-owner)', async () => {
    await resetPlans();
    const planId = `${Q.staff}_money`;
    await expectRefused(Q.coArr, planId, AI_WRITE_NONE);
    let caught: any;
    await planner.executePlan(planId, {}, { userId: Q.coArr, role: 'USER', businessId: Q.bizP }).catch((err: unknown) => { caught = err; });
    expect(caught?.getStatus?.(), String(caught)).toBe(403);
    expect(caught.message).toBe(PLAN_REVENUE_WRITE_NONE);
  });

  it('RED-BEFORE (COR-W11OMU-1; D-140, D-71): the co-owner stored as [] executing its own plan of genome, activity and expenses steps is refused 403 (HTTP ai:write and planner first step), as the STAFF member stored as [] is (was run: completed, all three routed); GET cortex/plans/:planId shows it none of those steps, so the run rule and the read rule agree', async () => {
    await resetPlans();
    for (const [userId, planId] of [[Q.coArr, `${Q.coArr}_probe`], [Q.staffArr, `${Q.staffArr}_probe`]] as const) {
      await expectRefused(userId, planId, AI_WRITE_NONE);
      let caught: any;
      await planner.executePlan(planId, {}, { userId, role: 'USER', businessId: Q.bizP }).catch((err: unknown) => { caught = err; });
      expect(caught?.getStatus?.(), String(caught)).toBe(403);
      expect(caught.message).toBe(UNMAPPED_STEP('genome', 'get_dna'));
      const read = await readAs(userId, planId);
      expect(read.status, describeBody(read)).toBe(200);
      expect(read.body.steps, planId).toEqual([]);
    }
  });

  it('RED-BEFORE (SEC-W11OMU-1 (b); D-140, D-46, ST-3): the co-owner stored as [] executing its own plan of an unmapped genome write and two payment writes with skipApproval is refused 403 before the claim: nothing reaches the connector (was run: completed, all three routed)', async () => {
    await resetPlans();
    const planId = `${Q.coArr}_pay`;
    await expectRefused(Q.coArr, planId, AI_WRITE_NONE, { skipApproval: true });
    let caught: any;
    await planner.executePlan(planId, { skipApproval: true }, { userId: Q.coArr, role: 'USER', businessId: Q.bizP }).catch((err: unknown) => { caught = err; });
    expect(caught?.getStatus?.(), String(caught)).toBe(403);
    expect(caught.message).toBe(PLAN_REVENUE_WRITE_NONE);
  });

  it('RED-BEFORE (COR-W11OMU-1; D-140, D-71, D-73): with no member (the query pipeline and the cortex triggers), the co-owner\'s plan runs as its creator and is held to the same map: refused 403 at its first step, nothing routed (was run: completed)', async () => {
    await resetPlans();
    const planId = `${Q.coArr}_probe_nm`;
    const from = routed.length;
    let caught: any;
    await planner.executePlan(planId).catch((err: unknown) => { caught = err; });
    expect(caught?.getStatus?.(), String(caught)).toBe(403);
    expect(caught.message).toBe(UNMAPPED_STEP('genome', 'get_dna'));
    expect(await planState(planId)).toEqual({ status: 'pending', steps: ['pending', 'pending', 'pending'] });
    expect(routedSince(from, planId)).toEqual([]);
  });

  /* ------------------ the OWNER membership with an object map ------------------ */

  it('RED-BEFORE (SEC-W11OMU-1; D-140, D-71): the co-owner whose map is {operations: write} is refused its plan pairing an inbox write its map reaches with an unmapped genome write (at the genome step), and its plan of an expenses read its map leaves out; both 403 before the claim, nothing routed (was run: completed)', async () => {
    await resetPlans();
    await expectRefused(Q.coMap, `${Q.coMap}_genome`, UNMAPPED_STEP('genome', 'update_dna'));
    await expectRefused(Q.coMap, `${Q.coMap}_expenses`, EXPENSES_READ_NONE);
  });

  it('RED-BEFORE (SEC-W11OMU-1; D-140, V1-10 review ST-3): the same co-owner\'s skipApproval is ignored, as any member\'s is: the step the business\'s policy always parks waits for approval and nothing is routed (was honoured: the step ran)', async () => {
    await resetPlans();
    const planId = `${Q.coMap}_skip`;
    const from = routed.length;
    const res = await executeAs(Q.coMap, planId, { skipApproval: true });
    expect(res.status, describeBody(res)).toBe(201);
    expect(res.body).toMatchObject({ planId, status: 'waiting_approval', executed: 1 });
    expect(await planState(planId)).toEqual({ status: 'waiting_approval', steps: ['waiting_approval'] });
    expect(routedSince(from, planId)).toEqual([]);
  });

  it('control (D-140: bound by its map, not refused everything): the same co-owner runs its plan of the inbox write its map reaches, once, as itself', async () => {
    await resetPlans();
    const planId = `${Q.coMap}_ok`;
    const from = routed.length;
    const res = await executeAs(Q.coMap, planId);
    expect(res.status, describeBody(res)).toBe(201);
    expect(res.body).toMatchObject({ planId, status: 'completed', executed: 1 });
    expect(ranAs(from, planId)).toEqual([['inbox', 'archive_thread', Q.coMap]]);
  });

  /* ------------------ the OWNER membership with no map (control) ------------------ */

  it('control (D-140: an OWNER with no explicit map keeps every step; D-125): the recorded owner holding OWNER with no map runs another member\'s money plan, its own genome/activity/expenses plan (over HTTP and with no member) and its own genome and payment plan with skipApproval, every step once as itself; its skipApproval runs the step the policy parks', async () => {
    await resetPlans();
    const cases: ReadonlyArray<readonly [string, Record<string, unknown>, ReadonlyArray<readonly [string, string]>]> = [
      [`${Q.staff}_money`, {}, PLANS[`${Q.staff}_money`].steps],
      [`${Q.owner}_probe`, {}, PLANS[`${Q.owner}_probe`].steps],
      [`${Q.owner}_pay`, { skipApproval: true }, PLANS[`${Q.owner}_pay`].steps],
      [`${Q.owner}_skip`, { skipApproval: true }, PLANS[`${Q.owner}_skip`].steps],
    ];
    for (const [planId, body, steps] of cases) {
      const from = routed.length;
      const res = await executeAs(Q.owner, planId, body);
      expect(res.status, `${planId}: ${describeBody(res)}`).toBe(201);
      expect(res.body, planId).toMatchObject({ planId, status: 'completed', executed: steps.length });
      expect(ranAs(from, planId), planId).toEqual(steps.map(([module, action]) => [module, action, Q.owner]));
    }
    const noMember = `${Q.owner}_probe_nm`;
    const from = routed.length;
    expect(await planner.executePlan(noMember)).toMatchObject({ planId: noMember, status: 'completed', executed: 3 });
    expect(ranAs(from, noMember)).toEqual(PLANS[noMember].steps.map(([module, action]) => [module, action, Q.owner]));
  });
});
