/**
 * KEY-R3b-PLAN-AUTHORITY: KEY plans run as a member, with that member's module scopes checked per
 * step at run time (owner rulings D-71 and D-73, 2026-11-03; D-46). REAL database.
 *
 * The trial-N repair round 2 KEY recheck left three owner items, ruled since:
 *   - PLAN-MODULE-RULE: KeyCortexPlannerService checked only revenue write, and only for commerce
 *     steps. A STAFF creator without a module's write (or read) scope had a step of that module run.
 *     D-71: each step needs the running member's scope for its module (write for a write, read for
 *     a read); OWNER and ADMIN keep every module; a STAFF member's own-contact (owned-view) rules
 *     still apply to the contacts a crm step reaches.
 *   - KEY-SYSACTOR-COMMERCE: a cortex trigger fired without a member ran its plan as
 *     SYSTEM_PLAN_ACTOR with no check (commerce steps included), and any member could create the
 *     rule. D-73: a trigger records its creator and the plans it fires run as that member; a plan
 *     with no member principal may not write money or invoices and may not read contacts.
 *   - NOPRINCIPAL-SURFACES: the ai plan queue (PlanExecutorService -> QueueService ->
 *     ActionDispatcher, PLAN_QUEUE with no principal), which also runs the journey, agent-trigger
 *     and briefing plans (all written with no userId and approved), PRO_AUTO_MONITOR and
 *     briefing/:planId/execute-all read the whole contact book and ran money writes with no member.
 *     D-73 again; and D-71 at run time for a plan a member proposed.
 * Plus the DENY-SYSTEM-ACTOR nit: a task denied by a system plan ('key_cortex') or by the
 * autopilot adapter's fallback ('key-cortex') was recorded as a human's denial.
 *
 * WHAT IS REAL: PrismaService and the Prisma client against DATABASE_URL; KeyCortexPlannerService
 * (claim, per-step authority, run), KeyCortexExecutorService (its approval policy read from the
 * real BusinessSetting row, its ai_execution_logs rows), KeyCortexSagaService, KeyCortexTriggerService
 * (rules, filter, firing) and KeyCortexGoalsController (trigger create/update) over real rows;
 * QueueService.processPlanStep (the plan-queue worker body, called as BullMQ calls it) with the real
 * ActionDispatcherService and AiExecutionLogService; FlowOrchestratorService's own executeToolAction
 * for the contact reads (crm_list_contacts against real contacts, with its real contactReadAccess) and
 * its autoExecuteToolForMonitoring (PRO_AUTO_MONITOR); MorningBriefingService.executeAllBriefingCards;
 * AutopilotService.denyTask; crm visibility helpers.
 * Stand-ins: the KEY connector (records every command it is handed, the external effect counted
 * here, and answers success); the autonomy orchestrator (allows); PlannerService.createPlan (writes
 * the AiPlan row and one step per action candidate, as PlannerService does); the cortex event bus
 * (hands the trigger service its subscriber); the oversight service (allows, auto-approves); the
 * state machine, undo, timeline, event emitter and BusinessEventService (record or no-op); the
 * flow orchestrator's other tools on the queue path (record, return an id).
 *
 * Every seeded row carries the `v87b_` prefix and is hard-deleted by raw SQL with sqlLikePrefix()
 * in beforeAll and afterAll; no $transaction wrapping.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { ForbiddenException, Logger } from '@nestjs/common';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v87b_';

// Each case runs plans end to end against the real database; under a parallel run 5 s is too short.
vi.setConfig({ testTimeout: 30_000 });

const ID = {
  owner: `${P}owner`, // OWNER membership of biz and Business.ownerId
  admin: `${P}admin`, // ADMIN, explicit scope map with bookings 'none' (ADMIN keeps every module: D-71)
  staff: `${P}staff`, // STAFF, role defaults: read on every module but settings/team/ai, revenue read
  staffBook: `${P}staff_book`, // STAFF, role defaults + bookings write
  staffNoBook: `${P}staff_nobook`, // STAFF, role defaults with bookings 'none'
  staffCrmW: `${P}staff_crmw`, // STAFF, role defaults + crm write (crm_view all)
  staffOwned: `${P}staff_owned`, // STAFF, role defaults + crm write, crm_view owned
  outsider: `${P}outsider`, // OWNER of bizB, no membership of biz
  biz: `${P}biz`,
  bizB: `${P}bizb`,
  cPriv: `${P}c_priv`, // the OWNER's PRIVATE contact
  cTeam: `${P}c_team`, // a TEAM contact the OWNER owns
  cOwned: `${P}c_owned`, // a TEAM contact staffOwned owns
  task: `${P}task_deny`,
  taskDash: `${P}task_deny_dash`,
};

let db: any;
let prisma: any;
let planner: any;
let executor: any;
let triggers: any;
let goalsController: any;
let queue: any;
let flow: any;
let briefing: any;
let autopilot: any;
let busHandler: ((event: any) => Promise<void>) | undefined;
let isSystemActor: (id?: string | null) => boolean;
let defaultScopesForRole: (role: string) => Record<string, string>;

interface Routed { marker: unknown; module: unknown; action: unknown; userId: unknown; planId?: unknown }
/** Every command the KEY executor routed to the connector (the external effect). */
const routed: Routed[] = [];
/** Every tool the plan-queue dispatcher handed the flow orchestrator, with the principal it carried. */
const dispatched: Array<{ toolName: string; planStepId?: string; principal: unknown; surface: unknown }> = [];
/** Every tool PRO_AUTO_MONITOR reached executeToolAction with. */
const monitorCalls: Array<{ toolName: string; action: unknown }> = [];
/** BusinessEvents AutopilotService emitted. */
const businessEvents: any[] = [];

async function cleanup() {
  for (const sql of [
    `DELETE FROM ai_execution_logs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM ai_plans WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM ai_goals WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM saga_executions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM key_cortex_trigger_rules WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM autopilot_tasks WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM business_settings WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

const asMember = (userId: string, role = 'USER') => ({ userId, role, businessId: ID.biz });

/** A KEY-cortex plan in biz: one AiPlanStep per entry, each carrying a marker so a routed command names its step. */
async function seedCortexPlan(id: string, steps: Array<{ module: string; action: string; params?: Record<string, unknown> }>, userId: string | null) {
  await db.aiPlan.create({
    data: {
      id, businessId: ID.biz, userId, objective: `v87b ${id}`, status: 'pending',
      steps: {
        create: steps.map((s, i) => ({
          id: `${id}_s${i + 1}`, order: i + 1, module: s.module, action: s.action,
          toolName: `${s.module}.${s.action}`, inputPayload: { ...(s.params ?? {}), marker: `${id}_s${i + 1}` },
        })),
      },
    },
  });
}

const routedFor = (planId: string, from = 0) => routed.slice(from).filter((r) => typeof r.marker === 'string' && r.marker.startsWith(`${planId}_s`));
const planRow = (id: string) => db.aiPlan.findUnique({
  where: { id },
  select: { userId: true, status: true, startedAt: true, steps: { select: { id: true, status: true, errorMessage: true, outputResult: true }, orderBy: { order: 'asc' } } },
});

/** An ai plan as the plan queue holds it (approved), its one step `toolName`. */
async function seedQueuePlan(id: string, userId: string | null, toolName: string, args: Record<string, unknown> = {}, businessId = ID.biz) {
  await db.aiPlan.create({
    data: {
      id, businessId, userId, objective: `v87b ${id}`, status: 'approved',
      steps: { create: [{ id: `${id}_s1`, order: 1, toolName, action: toolName, module: 'ai', status: 'pending', inputPayload: args }] },
    },
  });
  return `${id}_s1`;
}

/** Runs the plan-queue worker body on the plan's one step, as BullMQ hands it a job. */
async function runQueueStep(planId: string, toolName: string, args: Record<string, unknown> = {}, businessId = ID.biz) {
  const stepId = `${planId}_s1`;
  const job = {
    data: {
      planId, stepId, businessId, toolName, args, order: 1, dependsOn: [], retryCount: 0,
      idempotencyKey: `${planId}_job`, planContext: { planId, planStepId: stepId },
    },
  };
  return queue.processPlanStep(job).then((r: unknown) => ({ ok: true, value: r }), (e: unknown) => ({ ok: false, error: e }));
}

const dispatchedFor = (stepId: string) => dispatched.filter((d) => d.planStepId === stepId);
const INVOICE_ARGS = { items: [{ description: 'v87b line', quantity: 1, unitPrice: 10 }] };

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;
  const tenant = await import('../src/core/tenant/tenant-context');
  dbMod.setTenantContextProvider({ getCurrentBusinessId: tenant.getCurrentBusinessId });

  ({ isSystemActor } = await import('../src/core/auth/system-actor'));
  ({ defaultScopesForRole } = await import('../src/core/authority/module-vocabulary') as any);
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { KeyCortexExecutorService } = await import('../src/modules/key-cortex/key-cortex-executor.service');
  const { KeyCortexSagaService } = await import('../src/modules/key-cortex/key-cortex-saga.service');
  const { KeyCortexPlannerService } = await import('../src/modules/key-cortex/key-cortex-planner.service');
  const { KeyCortexTriggerService } = await import('../src/modules/key-cortex/key-cortex-trigger.service');
  const { KeyCortexGoalsController } = await import('../src/modules/key-cortex/key-cortex-goals.controller');
  const { AiExecutionLogService } = await import('../src/modules/ai/ai-execution-log.service');
  const { ActionDispatcherService } = await import('../src/modules/ai/action-dispatcher.service');
  const { QueueService } = await import('../src/modules/ai/queue.service');
  const { FlowOrchestratorService } = await import('../src/modules/ai/flow-orchestrator.service');
  const { MorningBriefingService } = await import('../src/modules/ai/morning-briefing.service');
  const { AutopilotService } = await import('../src/modules/autopilot/autopilot.service');

  prisma = new PrismaService();
  const events = { emit: () => true };

  // KEY cortex: the connector stand-in records what it is handed and answers success.
  const connector = {
    getAllCapabilities: () => [],
    execute: async (c: any) => {
      routed.push({ marker: c?.parameters?.marker, module: c?.module, action: c?.action, userId: c?.userId });
      return { success: true, data: { done: c?.parameters?.marker ?? null }, executionTimeMs: 1, command: c };
    },
  };
  const autonomy = { evaluateAction: async () => ({ allowed: true, requiresApproval: false }) };
  const legacyGateOff = { checkGate: async () => { throw new Error('v87b: the legacy autonomy gate is off this path'); } };
  executor = new KeyCortexExecutorService(connector as any, prisma, events as any, legacyGateOff as any, autonomy as any, undefined, undefined);
  const saga = new KeyCortexSagaService(prisma);
  // PlannerService.createPlan, as it writes a plan: the row for `userId`, one step per action candidate.
  const plannerStandIn = {
    createPlan: async (businessId: string, intent: any, userId?: string) => db.aiPlan.create({
      data: {
        businessId, userId: userId ?? null, objective: intent.objective, status: 'draft',
        steps: {
          create: (intent.actionCandidates ?? []).map((c: any, i: number) => {
            const [module, ...rest] = String(c.toolName).split('.');
            return { order: i + 1, module, action: rest.join('.'), toolName: c.toolName, inputPayload: { marker: `trig_${i + 1}` } };
          }),
        },
      },
    }),
  };
  planner = new KeyCortexPlannerService(prisma, plannerStandIn as any, executor, saga);
  const bus = { subscribeAll: (handler: any) => { busHandler = handler; return () => undefined; } };
  triggers = new KeyCortexTriggerService(prisma, bus as any, planner);
  triggers.onModuleInit();
  goalsController = new KeyCortexGoalsController(planner, triggers, prisma);

  // The ai plan queue: the worker body with the real dispatcher. Contact reads run the orchestrator's
  // own executeToolAction (real query, real contactReadAccess); other tools are recorded.
  flow = Object.create(FlowOrchestratorService.prototype);
  Object.assign(flow, {
    prisma,
    logger: new Logger('v87b-flow'),
    governance: {
      evaluate: async () => ({ allowed: true, tier: 1, reason: 'v87b: allowed', requiresFormalApproval: false, requiresAdminApproval: false, requiresQuickConfirm: false }),
      getToolTier: () => 1,
    },
    executionLog: new AiExecutionLogService(prisma),
    businessGraph: { invalidateCache: () => undefined },
  });
  const realExecuteToolAction = FlowOrchestratorService.prototype['executeToolAction' as keyof typeof FlowOrchestratorService.prototype] as any;
  flow.executeToolAction = async (businessId: string, toolName: string, args: Record<string, unknown>, action?: any) => {
    monitorCalls.push({ toolName, action });
    if (toolName === 'crm_list_contacts') return realExecuteToolAction.call(flow, businessId, toolName, args, action);
    return { id: `${P}fake_${toolName}` };
  };
  const flowForQueue = {
    executeToolDirectly: async (businessId: string, toolName: string, args: Record<string, unknown>, planContext?: { planStepId: string }, action?: any) => {
      dispatched.push({ toolName, planStepId: planContext?.planStepId, principal: action?.principalUserId, surface: action?.surface });
      if (toolName === 'crm_list_contacts') return realExecuteToolAction.call(flow, businessId, toolName, args, action);
      return { id: `${P}fake_${toolName}` };
    },
  };
  const ALLOW = { allowed: true, tier: 1, reason: 'v87b: allowed', requiresFormalApproval: false, requiresAdminApproval: false, requiresQuickConfirm: false };
  const governance = {
    evaluate: async () => ({ ...ALLOW }),
    evaluateAutoApproval: async () => ({ ...ALLOW, autoApproved: true }),
    getToolTier: () => 1,
  };
  const executionLog = new AiExecutionLogService(prisma);
  const dispatcher = new ActionDispatcherService(prisma, events as any, executionLog, governance as any, flowForQueue as any, { registerAction: async () => undefined } as any);
  queue = Object.create(QueueService.prototype);
  Object.assign(queue, {
    prisma, events, governance, executionLog, actionDispatcher: dispatcher, flowOrchestrator: flowForQueue,
    stateMachine: { transition: async () => undefined },
    logger: new Logger('v87b-queue'),
  });

  briefing = new MorningBriefingService(
    prisma, events as any, {} as any, { updateStepStatus: async () => undefined } as any, {} as any, governance as any, {} as any,
  );
  autopilot = new AutopilotService(prisma, {} as any, { emit: async (e: any) => { businessEvents.push(e); } } as any);

  await cleanup();

  const staffDefaults = defaultScopesForRole('STAFF');
  const adminDefaults = defaultScopesForRole('ADMIN');
  for (const [id, role] of [[ID.owner, 'USER'], [ID.admin, 'USER'], [ID.staff, 'USER'], [ID.staffBook, 'USER'], [ID.staffNoBook, 'USER'], [ID.staffCrmW, 'USER'], [ID.staffOwned, 'USER'], [ID.outsider, 'USER']] as const) {
    await db.user.create({ data: { id, email: `${P}${id.slice(P.length)}@test.local`, role } });
  }
  await db.business.create({ data: { id: ID.biz, name: 'V87B Biz', ownerId: ID.owner } });
  await db.business.create({ data: { id: ID.bizB, name: 'V87B Biz B', ownerId: ID.outsider } });
  const member = (userId: string, role: string, permissionScopes?: Record<string, string>, businessId = ID.biz) =>
    db.membership.create({ data: { id: `${P}m_${userId.slice(P.length)}_${businessId.slice(P.length)}`, userId, businessId, role, ...(permissionScopes ? { permissionScopes } : {}) } });
  await member(ID.owner, 'OWNER');
  await member(ID.admin, 'ADMIN', { ...adminDefaults, bookings: 'none' });
  await member(ID.staff, 'STAFF');
  await member(ID.staffBook, 'STAFF', { ...staffDefaults, bookings: 'write' });
  await member(ID.staffNoBook, 'STAFF', { ...staffDefaults, bookings: 'none' });
  await member(ID.staffCrmW, 'STAFF', { ...staffDefaults, crm: 'write' });
  await member(ID.staffOwned, 'STAFF', { ...staffDefaults, crm: 'write', crm_view: 'owned' });
  await member(ID.outsider, 'OWNER', undefined, ID.bizB);
  for (const businessId of [ID.biz, ID.bizB]) {
    await db.businessSetting.create({ data: { id: `${P}setting_${businessId.slice(P.length)}`, businessId, aiAutonomyLevel: 'full', aiAlwaysRequireApproval: [] } });
  }
  await db.contact.create({ data: { id: ID.cPriv, businessId: ID.biz, firstName: 'V87B Private', visibility: 'PRIVATE', ownerId: ID.owner } });
  await db.contact.create({ data: { id: ID.cTeam, businessId: ID.biz, firstName: 'V87B Team', visibility: 'TEAM', ownerId: ID.owner } });
  await db.contact.create({ data: { id: ID.cOwned, businessId: ID.biz, firstName: 'V87B Owned', visibility: 'TEAM', ownerId: ID.staffOwned } });
  await db.autopilotTask.create({ data: { id: ID.task, businessId: ID.biz, title: 'v87b denied by a system plan', category: 'OPERATIONS', status: 'AWAITING_APPROVAL', requiresApproval: true } });
  await db.autopilotTask.create({ data: { id: ID.taskDash, businessId: ID.biz, title: 'v87b denied by the adapter fallback', category: 'OPERATIONS', status: 'AWAITING_APPROVAL', requiresApproval: true } });
}, 180_000);

afterAll(async () => {
  if (db) await cleanup();
  if (executor?.approvalCleanupInterval) clearInterval(executor.approvalCleanupInterval);
  const dbMod = await import('@keyflow/db');
  dbMod.setTenantContextProvider({ getCurrentBusinessId: () => undefined });
});

describe('fixture sanity (real rows)', () => {
  it('biz has its OWNER, an ADMIN without bookings, STAFF members with role defaults or explicit scope maps, three contacts (one PRIVATE to the OWNER) and a full-autonomy policy', async () => {
    const rows = await db.membership.findMany({ where: { businessId: ID.biz }, select: { userId: true, role: true }, orderBy: { userId: 'asc' } });
    expect(rows.map((r: any) => r.role).sort()).toEqual(['ADMIN', 'OWNER', 'STAFF', 'STAFF', 'STAFF', 'STAFF', 'STAFF']);
    expect(defaultScopesForRole('STAFF')).toMatchObject({ bookings: 'read', revenue: 'read', crm: 'read', settings: 'none' });
    expect(await db.contact.count({ where: { businessId: ID.biz } })).toBe(3);
    const asCommand = (module: string, action: string) => ({ module, action, parameters: {}, businessId: ID.biz, userId: ID.owner, source: 'key_cortex', timestamp: new Date() });
    for (const [module, action] of [['bookings', 'create_booking'], ['bookings', 'get_services'], ['crm', 'update_contact'], ['crm', 'list_contacts'], ['commerce', 'create_invoice'], ['autopilot', 'create_task']]) {
      expect(await executor.requiresApproval(asCommand(module, action)), `${module}.${action}`).toBe(false);
    }
  });
});

/**
 * PLAN-MODULE-RULE (D-71). assertMayExecutePlan / assertCreatorMayWriteInvoices held a plan only to
 * revenue write, and only for commerce steps; every other step ran for any creator.
 */
describe('D-71: every KEY plan step needs the running member\'s scope for its module (write for a write, read for a read)', () => {
  it('PM-01 RED-BEFORE: a STAFF creator holding bookings read only (role defaults) is refused its own plan that creates a booking: 403, nothing routed, the plan still pending', async () => {
    const planId = `${P}pm01`;
    await seedCortexPlan(planId, [{ module: 'bookings', action: 'create_booking' }], ID.staff);
    const from = routed.length;
    const err = await planner.executePlan(planId, {}, asMember(ID.staff)).catch((e: unknown) => e);
    expect(err, String(err)).toBeInstanceOf(ForbiddenException);
    expect(String((err as Error).message)).toMatch(/bookings requires write/);
    expect(routedFor(planId, from)).toEqual([]);
    expect(await planRow(planId)).toMatchObject({ status: 'pending', startedAt: null });
  });

  it('PM-02 RED-BEFORE: the same plan run with no member (the query pipeline, a trigger) is held to its creator\'s scopes: 403 and nothing routed', async () => {
    const planId = `${P}pm02`;
    await seedCortexPlan(planId, [{ module: 'bookings', action: 'create_booking' }], ID.staff);
    const from = routed.length;
    const err = await planner.executePlan(planId, { traceId: `${P}pm02` }).catch((e: unknown) => e);
    expect(err, String(err)).toBeInstanceOf(ForbiddenException);
    expect(String((err as Error).message)).toMatch(/bookings requires write/);
    expect(routedFor(planId, from)).toEqual([]);
  });

  it('PM-03 RED-BEFORE: a read step needs read: a STAFF member whose scope map denies bookings is refused bookings.get_services', async () => {
    const planId = `${P}pm03`;
    await seedCortexPlan(planId, [{ module: 'bookings', action: 'get_services' }], ID.staffNoBook);
    const from = routed.length;
    const err = await planner.executePlan(planId, {}, asMember(ID.staffNoBook)).catch((e: unknown) => e);
    expect(err, String(err)).toBeInstanceOf(ForbiddenException);
    expect(String((err as Error).message)).toMatch(/bookings requires read/);
    expect(routedFor(planId, from)).toEqual([]);
  });

  it('PM-04 regression control: a STAFF member holding bookings write runs create_booking, one holding read runs get_services, an ADMIN whose map denies bookings still runs create_booking (ADMIN keeps every module), and the OWNER runs every module; each step once, as that member', async () => {
    for (const [planId, creator, step] of [
      [`${P}pm04_staffbook`, ID.staffBook, { module: 'bookings', action: 'create_booking' }],
      [`${P}pm04_staffread`, ID.staff, { module: 'bookings', action: 'get_services' }],
      [`${P}pm04_admin`, ID.admin, { module: 'bookings', action: 'create_booking' }],
      [`${P}pm04_owner`, ID.owner, { module: 'finance', action: 'record_expense' }],
    ] as const) {
      await seedCortexPlan(planId, [step], creator);
      const from = routed.length;
      expect(await planner.executePlan(planId, {}, asMember(creator)), planId).toMatchObject({ planId, status: 'completed', executed: 1 });
      expect(routedFor(planId, from).map((r) => r.userId), planId).toEqual([creator]);
    }
  });

  it('PM-05 RED-BEFORE (owned-view): a STAFF member kept to its own book (crm write, crm_view owned) is refused a crm step naming a contact it cannot open (the OWNER\'s PRIVATE one, a TEAM one it does not own); its step on its own contact runs', async () => {
    for (const contactId of [ID.cPriv, ID.cTeam]) {
      const planId = `${P}pm05_${contactId.slice(P.length)}`;
      await seedCortexPlan(planId, [{ module: 'crm', action: 'update_contact', params: { contactId, firstName: 'v87b hijack' } }], ID.staffOwned);
      const from = routed.length;
      const err = await planner.executePlan(planId, {}, asMember(ID.staffOwned)).catch((e: unknown) => e);
      expect(err, `${contactId} ${String(err)}`).toBeInstanceOf(ForbiddenException);
      expect(routedFor(planId, from), contactId).toEqual([]);
    }
    const own = `${P}pm05_own`;
    await seedCortexPlan(own, [{ module: 'crm', action: 'add_note', params: { contactId: ID.cOwned, body: 'v87b note' } }], ID.staffOwned);
    const from = routed.length;
    expect(await planner.executePlan(own, {}, asMember(ID.staffOwned))).toMatchObject({ status: 'completed', executed: 1 });
    expect(routedFor(own, from).map((r) => r.userId)).toEqual([ID.staffOwned]);
  });

  it('PM-06 RED-BEFORE: a crm read that names no contact (crm.list_contacts reads through the crm adapter, which applies no member\'s visibility) is refused to a STAFF member, PRIVATE contacts would be in it; the OWNER\'s runs', async () => {
    const planId = `${P}pm06_staff`;
    await seedCortexPlan(planId, [{ module: 'crm', action: 'list_contacts' }], ID.staffCrmW);
    const from = routed.length;
    const err = await planner.executePlan(planId, {}, asMember(ID.staffCrmW)).catch((e: unknown) => e);
    expect(err, String(err)).toBeInstanceOf(ForbiddenException);
    expect(routedFor(planId, from)).toEqual([]);

    const owner = `${P}pm06_owner`;
    await seedCortexPlan(owner, [{ module: 'crm', action: 'list_contacts' }], ID.owner);
    const ownerFrom = routed.length;
    expect(await planner.executePlan(owner, {}, asMember(ID.owner))).toMatchObject({ status: 'completed', executed: 1 });
    expect(routedFor(owner, ownerFrom).map((r) => r.userId)).toEqual([ID.owner]);
  });
});

/**
 * D-73 for a KEY-cortex plan no member created (a legacy trigger rule, a system caller): it may not
 * write money or invoices and may not read contacts. The refusal is recorded on the plan (failed,
 * the refused step failed with the reason) and nothing is routed.
 */
describe('D-73: a KEY plan with no member principal refuses money and invoice writes and contact reads (recorded, nothing routed)', () => {
  it('SP-01 RED-BEFORE: a plan no member created with commerce.create_invoice: refused, recorded on the plan, nothing routed (it ran as key_cortex)', async () => {
    const planId = `${P}sp01`;
    await seedCortexPlan(planId, [{ module: 'commerce', action: 'create_invoice' }], null);
    const from = routed.length;
    const err = await planner.executePlan(planId, {}).catch((e: unknown) => e);
    expect(err, String(err)).toBeInstanceOf(ForbiddenException);
    expect(routedFor(planId, from)).toEqual([]);
    const row = await planRow(planId);
    expect(row.status).toBe('failed');
    expect(row.steps[0].status).toBe('failed');
    expect(String(row.steps[0].errorMessage)).toMatch(/no member/i);
  });

  it('SP-02 RED-BEFORE: a plan no member created with crm.list_contacts: refused and recorded, nothing routed', async () => {
    const planId = `${P}sp02`;
    await seedCortexPlan(planId, [{ module: 'autopilot', action: 'create_task' }, { module: 'crm', action: 'list_contacts' }], null);
    const from = routed.length;
    const err = await planner.executePlan(planId, {}).catch((e: unknown) => e);
    expect(err, String(err)).toBeInstanceOf(ForbiddenException);
    expect(routedFor(planId, from)).toEqual([]);
    const row = await planRow(planId);
    expect(row.status).toBe('failed');
    expect(row.steps.map((s: any) => s.status)).toEqual(['skipped', 'failed']);
  });

  it('SP-03 regression control: a plan no member created that neither writes money nor reads contacts still runs, as key_cortex', async () => {
    const planId = `${P}sp03`;
    await seedCortexPlan(planId, [{ module: 'autopilot', action: 'create_task' }], null);
    const from = routed.length;
    expect(await planner.executePlan(planId, {})).toMatchObject({ status: 'completed', executed: 1 });
    expect(routedFor(planId, from).map((r) => r.userId)).toEqual(['key_cortex']);
  });
});

/** The plans a trigger rule fired (its goal's description names the rule). */
async function plansOfRule(ruleId: string) {
  const goals = await db.aiGoal.findMany({ where: { businessId: ID.biz, description: { contains: ruleId } }, select: { id: true } });
  return db.aiPlan.findMany({
    where: { goalId: { in: goals.map((g: any) => g.id) } },
    select: { id: true, userId: true, status: true, steps: { select: { id: true, status: true, errorMessage: true }, orderBy: { order: 'asc' } } },
  });
}

async function fire(eventType: string, userId?: string) {
  await busHandler!({ id: `${P}evt_${eventType}`, source: 'v87b', type: eventType, businessId: ID.biz, ...(userId ? { userId } : {}), payload: {}, metadata: {} });
}

/** The commands routed for the plans of `ruleId` (the stand-in createPlan marks trigger steps trig_<n>). */
function routedForPlans(plans: Array<{ id: string }>, from: number) {
  return routed.slice(from).filter((r) => typeof r.marker === 'string' && r.marker.startsWith('trig_')).map((r) => ({ action: r.action, userId: r.userId }));
}

/**
 * KEY-SYSACTOR-COMMERCE (D-73). fireRule created the plan for event.userId (none, for most events)
 * and ran it with no member: SYSTEM_PLAN_ACTOR ran crm.list_contacts, commerce.create_invoice and
 * commerce.send_invoice. The rule recorded no creator, and any member could create it.
 */
describe('D-73: a cortex trigger records its creator and the plans it fires run as that member', () => {
  it('TR-01 RED-BEFORE: POST triggers records the authenticated member as the rule\'s creator (in the rule\'s filter JSON, no migration); a creator named in the body is ignored; the rule still matches its events', async () => {
    const rule = await goalsController.createTriggerRule(
      { businessId: ID.biz, eventType: 'v87b.tr01', goalTemplateId: null, filterJson: { $createdBy: ID.owner } },
      { id: ID.staff, role: 'USER' },
    );
    const row = await db.keyCortexTriggerRule.findUnique({ where: { id: rule.id } });
    expect(row.filterJson).toEqual({ $createdBy: ID.staff });
    const goalsBefore = await db.aiGoal.count({ where: { businessId: ID.biz, description: { contains: rule.id } } });
    await fire('v87b.tr01');
    expect(await db.aiGoal.count({ where: { businessId: ID.biz, description: { contains: rule.id } } })).toBe(goalsBefore + 1);
  });

  it('TR-02 RED-BEFORE: a rule a STAFF member (revenue read) created fires a plan that is the STAFF member\'s, and its invoice steps are refused (403 before the claim): nothing routed', async () => {
    const rule = await goalsController.createTriggerRule(
      { businessId: ID.biz, eventType: 'v87b.invoice.tr02', goalTemplateId: `${P}tpl`, cooldownMinutes: 0 },
      { id: ID.staff, role: 'USER' },
    );
    const from = routed.length;
    await fire('v87b.invoice.tr02');
    const plans = await plansOfRule(rule.id);
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ userId: ID.staff, status: 'pending' });
    expect(routedForPlans(plans, from)).toEqual([]);
  });

  it('TR-03 RED-BEFORE: a rule the OWNER created fires a plan that runs every step as the OWNER, never as key_cortex', async () => {
    const rule = await goalsController.createTriggerRule(
      { businessId: ID.biz, eventType: 'v87b.invoice.tr03', goalTemplateId: `${P}tpl`, cooldownMinutes: 0 },
      { id: ID.owner, role: 'USER' },
    );
    const from = routed.length;
    await fire('v87b.invoice.tr03', ID.staff); // the event's user is not who the plan runs as
    const plans = await plansOfRule(rule.id);
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ userId: ID.owner, status: 'completed' });
    expect(routedForPlans(plans, from)).toEqual([
      { action: 'list_contacts', userId: ID.owner },
      { action: 'create_invoice', userId: ID.owner },
      { action: 'send_invoice', userId: ID.owner },
    ]);
  });

  it('TR-04 RED-BEFORE: a rule with no recorded creator (written before D-73) fires a plan with no member: its contact read and invoice steps are refused and recorded, nothing routed', async () => {
    const rule = await db.keyCortexTriggerRule.create({
      data: { id: `${P}rule_legacy`, businessId: ID.biz, eventType: 'v87b.invoice.tr04', goalTemplateId: `${P}tpl`, cooldownMinutes: 0 },
    });
    const from = routed.length;
    await fire('v87b.invoice.tr04', ID.owner);
    const plans = await plansOfRule(rule.id);
    expect(plans).toHaveLength(1);
    expect(plans[0].userId).toBeNull();
    expect(plans[0].status).toBe('failed');
    expect(plans[0].steps.every((s: any) => s.status === 'failed' && /no member/i.test(String(s.errorMessage)))).toBe(true);
    expect(routedForPlans(plans, from)).toEqual([]);
  });

  it('TR-05 RED-BEFORE: PATCH triggers/:id re-records the member who changed the rule (a STAFF member editing the OWNER\'s rule does not borrow the OWNER\'s authority) and keeps a filter the body names; a creator in the body is ignored', async () => {
    const rule = await goalsController.createTriggerRule({ businessId: ID.biz, eventType: 'v87b.tr05' }, { id: ID.owner, role: 'USER' });
    await goalsController.updateTriggerRule(rule.id, { filterJson: { kind: 'x', $createdBy: ID.owner } }, ID.biz, { id: ID.staff, role: 'USER' });
    expect((await db.keyCortexTriggerRule.findUnique({ where: { id: rule.id } })).filterJson).toEqual({ kind: 'x', $createdBy: ID.staff });
    await goalsController.updateTriggerRule(rule.id, { enabled: true }, ID.biz, { id: ID.owner, role: 'USER' });
    expect((await db.keyCortexTriggerRule.findUnique({ where: { id: rule.id } })).filterJson).toEqual({ kind: 'x', $createdBy: ID.owner });
  });
});

/**
 * NOPRINCIPAL-SURFACES and D-71 on the ai plan queue. QueueService.processPlanStep dispatched every
 * step with no principal (PLAN_QUEUE): the dispatcher's contact reads then read every contact
 * (contactReadAccess is null with no principal), and money writes ran for no member. JourneyOrchestrator,
 * AgentTriggerService and MorningBriefingService write their plans with no userId and approve them,
 * so they run here.
 */
describe('the ai plan queue runs each step as the plan\'s member, checked at run time; a plan with no member reads no contacts and writes no money', () => {
  it('QW-01 RED-BEFORE: a plan with no member (as a journey, an agent trigger or the daily briefing write it) with crm_list_contacts: refused and recorded on the step, nothing dispatched, no contact read', async () => {
    const planId = `${P}qw01`;
    const stepId = await seedQueuePlan(planId, null, 'crm_list_contacts');
    const result = await runQueueStep(planId, 'crm_list_contacts');
    expect(dispatchedFor(stepId)).toEqual([]);
    const row = await planRow(planId);
    expect(row.steps[0].status).toBe('failed');
    expect(String(row.steps[0].errorMessage)).toMatch(/no member/i);
    expect(JSON.stringify(row.steps[0].outputResult ?? null)).not.toContain(ID.cPriv);
    expect(result.ok).toBe(true);
  });

  it('QW-02 RED-BEFORE: a plan with no member with commerce_create_invoice: refused and recorded, nothing dispatched', async () => {
    const planId = `${P}qw02`;
    const stepId = await seedQueuePlan(planId, null, 'commerce_create_invoice', INVOICE_ARGS);
    await runQueueStep(planId, 'commerce_create_invoice', INVOICE_ARGS);
    expect(dispatchedFor(stepId)).toEqual([]);
    const row = await planRow(planId);
    expect(row.steps[0].status).toBe('failed');
    expect(String(row.steps[0].errorMessage)).toMatch(/no member/i);
  });

  it('QW-03 RED-BEFORE (D-71 at run time): a plan a STAFF member proposed (revenue read) with commerce_create_invoice is refused when the worker runs it, whoever approved it; nothing dispatched', async () => {
    const planId = `${P}qw03`;
    const stepId = await seedQueuePlan(planId, ID.staff, 'commerce_create_invoice', INVOICE_ARGS);
    await runQueueStep(planId, 'commerce_create_invoice', INVOICE_ARGS);
    expect(dispatchedFor(stepId)).toEqual([]);
    const row = await planRow(planId);
    expect(row.steps[0].status).toBe('failed');
    expect(String(row.steps[0].errorMessage)).toMatch(/revenue requires write/);
  });

  it('QW-04 RED-BEFORE: a STAFF member\'s plan with crm_list_contacts (the queue hands the dispatcher no principal, so no visibility clause would apply) is refused: nothing dispatched', async () => {
    const planId = `${P}qw04`;
    const stepId = await seedQueuePlan(planId, ID.staffCrmW, 'crm_list_contacts');
    await runQueueStep(planId, 'crm_list_contacts');
    expect(dispatchedFor(stepId)).toEqual([]);
    expect((await planRow(planId)).steps[0].status).toBe('failed');
  });

  it("QW-05 regression control: the OWNER's plan reads its contacts and writes its invoice; a plan with no member still runs a step that neither reads contacts nor writes money", async () => {
    const read = `${P}qw05_read`;
    const readStep = await seedQueuePlan(read, ID.owner, 'crm_list_contacts', { limit: 50 });
    await runQueueStep(read, 'crm_list_contacts', { limit: 50 });
    expect(dispatchedFor(readStep)).toHaveLength(1);
    const readRow = await planRow(read);
    expect(readRow.steps[0].status).toBe('completed');
    expect(JSON.stringify(readRow.steps[0].outputResult)).toContain(ID.cPriv);

    const inv = `${P}qw05_inv`;
    const invStep = await seedQueuePlan(inv, ID.owner, 'commerce_create_invoice', INVOICE_ARGS);
    await runQueueStep(inv, 'commerce_create_invoice', INVOICE_ARGS);
    expect(dispatchedFor(invStep)).toHaveLength(1);

    const ticket = `${P}qw05_ticket`;
    const ticketStep = await seedQueuePlan(ticket, null, 'helpdesk_create_ticket', { title: 'v87b ticket' });
    await runQueueStep(ticket, 'helpdesk_create_ticket', { title: 'v87b ticket' });
    expect(dispatchedFor(ticketStep)).toHaveLength(1);
    expect((await planRow(ticket)).steps[0].status).toBe('completed');
  });
});

/** NOPRINCIPAL-SURFACES: PRO_AUTO_MONITOR runs tools with no member at all. */
describe('PRO_AUTO_MONITOR has no member: it reads no contacts and writes no money', () => {
  it('PA-01 RED-BEFORE: crm_list_contacts is refused before it runs (blocked, a recorded refusal), so no contact is read', async () => {
    const from = monitorCalls.length;
    const result = await flow.autoExecuteToolForMonitoring(ID.biz, 'crm_list_contacts', {});
    expect(monitorCalls.slice(from)).toEqual([]);
    expect(result).toMatchObject({ success: false, blocked: true });
    expect(String(result.error)).toMatch(/no member/i);
    expect(JSON.stringify(result)).not.toContain(ID.cPriv);
    const logged = await db.aiExecutionLog.findFirst({ where: { businessId: ID.biz, toolName: 'crm_list_contacts', mode: 'pro_auto' }, orderBy: { createdAt: 'desc' } });
    expect(logged).toMatchObject({ success: false });
  });

  it('PA-02 RED-BEFORE: commerce_create_invoice is refused before it runs', async () => {
    const from = monitorCalls.length;
    const result = await flow.autoExecuteToolForMonitoring(ID.biz, 'commerce_create_invoice', INVOICE_ARGS);
    expect(monitorCalls.slice(from)).toEqual([]);
    expect(result).toMatchObject({ success: false, blocked: true });
  });

  it('PA-03 regression control: a tool that neither reads contacts nor writes money still runs', async () => {
    const from = monitorCalls.length;
    const result = await flow.autoExecuteToolForMonitoring(ID.biz, 'helpdesk_create_ticket', { title: 'v87b monitor ticket' });
    expect(result).toMatchObject({ success: true });
    expect(monitorCalls.slice(from).map((c) => c.toolName)).toEqual(['helpdesk_create_ticket']);
  });
});

/** NOPRINCIPAL-SURFACES: briefing/:planId/execute-all approved the briefing's steps for no member. */
describe('briefing/:planId/execute-all runs the briefing as the member who asked, in the business it named', () => {
  it('BR-01 RED-BEFORE: a STAFF member executing the daily briefing (written with no member) records itself as the plan\'s member, so its contact read is checked against the STAFF member and refused at run time', async () => {
    const planId = `${P}br01`;
    const stepId = await seedQueuePlan(planId, null, 'crm_list_contacts');
    const res = await briefing.executeAllBriefingCards(ID.biz, planId, ID.staffCrmW);
    expect(res).toMatchObject({ executed: 1 });
    expect((await planRow(planId)).userId).toBe(ID.staffCrmW);
    await runQueueStep(planId, 'crm_list_contacts');
    expect(dispatchedFor(stepId)).toEqual([]);
    expect((await planRow(planId)).steps[0].status).toBe('failed');
  });

  it("BR-02 RED-BEFORE: a member of biz naming biz cannot execute another business's briefing by its id: refused, its steps still pending", async () => {
    const planId = `${P}br02`;
    await seedQueuePlan(planId, null, 'crm_list_contacts', {}, ID.bizB);
    const err = await briefing.executeAllBriefingCards(ID.biz, planId, ID.owner).then(() => null, (e: unknown) => e);
    expect(err).not.toBeNull();
    const row = await planRow(planId);
    expect(row.userId).toBeNull();
    expect(row.steps[0].status).toBe('pending');
  });
});

/** DENY-SYSTEM-ACTOR (nit): isSystemActor knew only 'key_ai'. */
describe('a task denied by a system actor is recorded as the system\'s denial', () => {
  it("DS-01 RED-BEFORE: isSystemActor knows SYSTEM_PLAN_ACTOR 'key_cortex' and the autopilot adapter's fallback 'key-cortex', and still no member id", () => {
    expect(isSystemActor('key_cortex')).toBe(true);
    expect(isSystemActor('key-cortex')).toBe(true);
    expect(isSystemActor('key_ai')).toBe(true);
    expect(isSystemActor(ID.owner)).toBe(false);
    expect(isSystemActor(null)).toBe(false);
  });

  it("DS-02 RED-BEFORE: AutopilotService.denyTask by 'key_cortex' or 'key-cortex' writes autopilot_task.denied with actorType 'system'; a member's denial stays 'human'", async () => {
    const from = businessEvents.length;
    await autopilot.denyTask(ID.task, ID.biz, 'key_cortex');
    await autopilot.denyTask(ID.taskDash, ID.biz, 'key-cortex');
    const events = businessEvents.slice(from).filter((e) => e.eventType === 'autopilot_task.denied');
    expect(events.map((e) => [e.actorId, e.actorType])).toEqual([['key_cortex', 'system'], ['key-cortex', 'system']]);
  });
});
