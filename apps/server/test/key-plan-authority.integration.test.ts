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
import { ForbiddenException, HttpException, Logger } from '@nestjs/common';
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
  ctPriv: `${P}ct_priv`, // a contact task on the OWNER's PRIVATE contact
  ctOwned: `${P}ct_owned`, // a contact task on staffOwned's own contact
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
let noMemberToolRefusal: (toolName: string) => string | null;
let planStepRunRefusal: (prisma: any, businessId: string, planId: string, toolName: string) => Promise<string | null>;
let assertMayRunGraphAction: (...args: any[]) => Promise<void>;
let graphPlanReadScope: (...args: any[]) => Promise<{ stepOutput: (toolName: string) => boolean }>;
let PLAN_APPROVER_ROLES: ReadonlySet<string>;

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
    `DELETE FROM contact_tasks WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM call_logs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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

/** The daily briefing as MorningBriefingService writes it (no member, approved, scope 'briefing'), its one step `toolName`. */
async function seedBriefingPlan(id: string, userId: string | null, toolName: string, args: Record<string, unknown> = {}, businessId = ID.biz) {
  await db.aiPlan.create({
    data: {
      id, businessId, userId, objective: `Daily Briefing — v87b ${id}`, rawInput: 'Morning briefing auto-generated scan',
      scope: ['briefing'], status: 'approved',
      steps: { create: [{ id: `${id}_s1`, order: 1, toolName, action: toolName, module: 'ai', status: 'pending', inputPayload: args }] },
    },
  });
  return `${id}_s1`;
}

/**
 * Runs the plan-queue worker body on the plan's one step, as BullMQ hands it a job. `opts.retryCount`:
 * the job's retry count (0 unless a case says; PlanExecutorService enqueues a step with 2, W9-DISPATCH-CIRCUIT
 * review CR-W9DC-1); `opts.worker`: the queue worker to run it on (the harness's own unless a case builds one).
 */
async function runQueueStep(
  planId: string,
  toolName: string,
  args: Record<string, unknown> = {},
  businessId = ID.biz,
  opts: { retryCount?: number; worker?: any } = {},
) {
  const stepId = `${planId}_s1`;
  const job = {
    data: {
      planId, stepId, businessId, toolName, args, order: 1, dependsOn: [], retryCount: opts.retryCount ?? 0,
      idempotencyKey: `${planId}_job`, planContext: { planId, planStepId: stepId },
    },
  };
  return (opts.worker ?? queue).processPlanStep(job).then((r: unknown) => ({ ok: true, value: r }), (e: unknown) => ({ ok: false, error: e }));
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
  ({ noMemberToolRefusal, planStepRunRefusal } = await import('../src/modules/ai/plan-step-authority') as any);
  ({ assertMayRunGraphAction, graphPlanReadScope, PLAN_APPROVER_ROLES } = await import('../src/modules/ai/graph-actions.controller') as any);
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
  const autonomy = { evaluateAction: async () => ({ allowed: true, requiresApproval: false, tier: 'full' }) };
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
  // W8-CALL-TASK-NO-MEMBER review CR-W8CTNM-1: call_create_task's own case writes through the real
  // CallLogService (its caller rule over real memberships and contacts), so PA-04's owner-run monitor
  // records a real call log (cleaned up with the v87b_ business).
  const { CallLogService } = await import('../src/modules/call-tasks/call-log.service');
  const callLog = new CallLogService(prisma, { emit: () => true } as any);
  flow.getCallLog = () => callLog;
  const realExecuteToolAction = FlowOrchestratorService.prototype['executeToolAction' as keyof typeof FlowOrchestratorService.prototype] as any;
  // Contact reads run the orchestrator's own query (crm_list_contacts with contactReadAccess;
  // segment_contacts, which applies no member's visibility at all). W8-CALL-TASK-NO-MEMBER (D-73):
  // call_create_task runs the orchestrator's own case, which refuses a run with no member before it
  // writes anything (QW-06 runs it only for plans with no member).
  const REAL_TOOLS = new Set(['crm_list_contacts', 'segment_contacts', 'call_create_task']);
  flow.executeToolAction = async (businessId: string, toolName: string, args: Record<string, unknown>, action?: any) => {
    monitorCalls.push({ toolName, action });
    if (REAL_TOOLS.has(toolName)) return realExecuteToolAction.call(flow, businessId, toolName, args, action);
    return { id: `${P}fake_${toolName}` };
  };
  const flowForQueue = {
    executeToolDirectly: async (businessId: string, toolName: string, args: Record<string, unknown>, planContext?: { planStepId: string }, action?: any) => {
      dispatched.push({ toolName, planStepId: planContext?.planStepId, principal: action?.principalUserId, surface: action?.surface });
      if (REAL_TOOLS.has(toolName)) return realExecuteToolAction.call(flow, businessId, toolName, args, action);
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
  await db.contactTask.create({ data: { id: ID.ctPriv, businessId: ID.biz, contactId: ID.cPriv, title: 'v87b task on the private contact' } });
  await db.contactTask.create({ data: { id: ID.ctOwned, businessId: ID.biz, contactId: ID.cOwned, title: 'v87b task on staffOwned\'s contact' } });
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

  // W7-CALL-TASK-CALLER review CR-W7CTC-1 hand-off (D-73, D-88): call_create_task now records the
  // member the command runs for and refuses a run with no member, but only inside dispatch:
  // noMemberToolRefusal('call_create_task') answers null, so planStepRunRefusal lets a non-system plan
  // with no member through, ActionDispatcherService retries the plain-Error refusal (3 attempts, 4 s)
  // and counts it toward the circuit breaker it keys by tool name alone, process-wide (5 refusals open
  // call_create_task for every business for 60 s; reproduced with the real ActionDispatcherService
  // and executeToolAction). The refusal is permanent, so it belongs in the pre-dispatch gate the queue,
  // the Pro Auto monitor and the proposal executor read (noMemberToolRefusal, plan-step-authority.ts),
  // outside W7-CALL-TASK-CALLER's write set (the call_create_task case only).
  // W8-CALL-TASK-NO-MEMBER (D-73): call_create_task names a contact and records a caller, so a plan
  // with no member is refused it before dispatch, as it is refused a contact read or a money write.
  // The dispatcher here is the real ActionDispatcherService and call_create_task runs the
  // orchestrator's own case (REAL_TOOLS), so a step that got through would reach the real refusal
  // and count it; CIRCUIT_THRESHOLD (5) such steps opened the tool's circuit for every business.
  it('QW-06 W8-CALL-TASK-NO-MEMBER (D-73): a plan with no member with call_create_task: refused before dispatch and recorded on the step, nothing dispatched, the job completes, and no refusal counts toward the tool\'s circuit breaker (review CR-W7CTC-1; plan-step-authority.ts noMemberToolRefusal)', async () => {
    const circuit = () => queue.actionDispatcher.getCircuitStatus('call_create_task');
    expect(circuit()).toMatchObject({ open: false, failures: 0 });
    for (let i = 1; i <= 5; i++) {
      const planId = `${P}qw06_${i}`;
      const args = { contactId: ID.cTeam, callerId: ID.owner, notes: `v87b qw06 ${i}` };
      const stepId = await seedQueuePlan(planId, null, 'call_create_task', args);
      const result = await runQueueStep(planId, 'call_create_task', args);
      expect(dispatchedFor(stepId), planId).toEqual([]);
      expect(result, planId).toMatchObject({ ok: true, value: { refused: expect.stringMatching(/call_create_task.*no member/) } });
      const row = await planRow(planId);
      expect(row.steps[0].status, planId).toBe('failed');
      expect(String(row.steps[0].errorMessage), planId).toMatch(/^Refused: .*no member principal/);
    }
    expect(circuit()).toEqual({ open: false, failures: 0, lastFailure: null });
    expect(noMemberToolRefusal('call_create_task')).toMatch(/no member principal/);
    // Regression control: the gate is the no-member one only. The OWNER's plan, and the daily
    // briefing (stored with no member, run as the business owner: D-93), still pass it.
    const own = `${P}qw06_owner`;
    await seedQueuePlan(own, ID.owner, 'call_create_task', { contactId: ID.cTeam });
    expect(await planStepRunRefusal(prisma, ID.biz, own, 'call_create_task')).toBeNull();
    const brief = `${P}qw06_brief`;
    await seedBriefingPlan(brief, null, 'call_create_task', { contactId: ID.cTeam });
    expect(await planStepRunRefusal(prisma, ID.biz, brief, 'call_create_task')).toBeNull();
  });

  // W8-CALL-TASK-NO-MEMBER review SEC-W8CTNM-1, reproduced here with the real ActionDispatcherService
  // and a real CallLogService: QW-06 keeps the runs with no member out of the breaker, but a member's
  // plan still reaches call_create_task's refusals inside dispatch. Five plans of staffCrmW (STAFF, crm
  // write) naming the OWNER's PRIVATE contact each passed planStepRunRefusal (null), each failed in
  // dispatch with 404 'Contact not found', and the fifth opened the circuit ({open: true, failures: 5});
  // the bizB OWNER's plan with call_create_task then failed with 'Circuit breaker open for tool
  // "call_create_task"', nothing dispatched. The same held for an owner by Business.ownerId alone (403,
  // CR-W4PP-2) and a SUPER_ADMIN who is no member (403, D-46). The breaker was ActionDispatcherService's,
  // keyed by tool name alone, process-wide, and recordFailure counted a permanent 4xx refusal.
  // W9-DISPATCH-CIRCUIT (SEC-W8CTNM-1, D-73): circuits are keyed by business and tool, and a 4xx
  // refusal (an HttpException other than 408 or 429) is answered once, neither retried nor counted.
  // This harness hands the dispatcher the refusal as CallLogService throws it (executeToolAction);
  // QW-07b is the same refusal through FlowOrchestratorService.executeToolDirectly.
  // Review SEC-W9DC-2 / CR-W9DC-1: so no refusal is counted here, and bizB would run whatever the
  // circuit is keyed by (QW-07 stayed green with one process-wide circuit per tool). QW-07 proves the
  // dispatcher's refusal branch (answered once, not counted); QW-07c pins the per-business keying end
  // to end, with failures delivered as production delivers them.
  it('QW-07 W8-CALL-TASK-NO-MEMBER review SEC-W8CTNM-1 (D-73): a member\'s plan whose call_create_task is refused inside dispatch (a contact the member may not open: 404; an owner by Business.ownerId alone or a SUPER_ADMIN who is no member: 403) counts toward no circuit breaker another business shares: five such refusals in biz leave call_create_task running for bizB (W9-DISPATCH-CIRCUIT, was it.todo)', async () => {
    const dispatcher = queue.actionDispatcher;
    const superAdmin = `${P}qw07_sa`; // a SUPER_ADMIN who is no member of biz (D-46)
    const ownerOnly = `${P}qw07_owner_only`; // bizC's owner by Business.ownerId alone, no membership (CR-W4PP-2)
    const bizC = `${P}qw07_bizc`;
    const cB = `${P}qw07_c_bizb`;
    const cC = `${P}qw07_c_bizc`;
    await db.user.create({ data: { id: superAdmin, email: `${P}qw07_sa@test.local`, role: 'SUPER_ADMIN' } });
    await db.user.create({ data: { id: ownerOnly, email: `${P}qw07_owner_only@test.local`, role: 'USER' } });
    await db.business.create({ data: { id: bizC, name: 'V87B Biz C', ownerId: ownerOnly } });
    await db.contact.create({ data: { id: cB, businessId: ID.bizB, firstName: 'V87B B', visibility: 'TEAM', ownerId: ID.outsider } });
    await db.contact.create({ data: { id: cC, businessId: bizC, firstName: 'V87B C', visibility: 'TEAM', ownerId: ownerOnly } });
    const callLogs = (businessId: string) => db.callLog.findMany({ where: { businessId, notes: { startsWith: 'v87b qw07' } }, select: { contactId: true, callerId: true, notes: true } });

    try {
      expect(dispatcher.getCircuitStatus('call_create_task')).toEqual({ open: false, failures: 0, lastFailure: null });
      const refusals: Array<{ planId: string; userId: string; businessId: string; contactId: string; error: RegExp }> = [];
      for (let i = 1; i <= 5; i++) {
        refusals.push({ planId: `${P}qw07_crmw_${i}`, userId: ID.staffCrmW, businessId: ID.biz, contactId: ID.cPriv, error: /^Contact not found$/ });
      }
      refusals.push({ planId: `${P}qw07_sa`, userId: superAdmin, businessId: ID.biz, contactId: ID.cTeam, error: /Only a member of this business/ });
      refusals.push({ planId: `${P}qw07_owner_only`, userId: ownerOnly, businessId: bizC, contactId: cC, error: /Only a member of this business/ });
      for (const r of refusals) {
        // callerId is the tool contract's (validateToolInput requires it); the dispatcher ignores it (D-88).
        const args = { contactId: r.contactId, callerId: ID.owner, notes: `v87b qw07 ${r.planId}` };
        const stepId = await seedQueuePlan(r.planId, r.userId, 'call_create_task', args, r.businessId);
        // It passes the gate before dispatch (the refusal is the tool's, inside dispatch).
        expect(await planStepRunRefusal(prisma, r.businessId, r.planId, 'call_create_task'), r.planId).toBeNull();
        // retryCount 2, as PlanExecutorService enqueues the step (review CR-W9DC-1): with 0 the dispatcher
        // makes one attempt whatever it makes of the answer, and 'answered once' below would prove nothing.
        const result = await runQueueStep(r.planId, 'call_create_task', args, r.businessId, { retryCount: 2 });
        expect(result.ok, r.planId).toBe(false);
        // Answered once: a refusal is not retried.
        expect(dispatchedFor(stepId), r.planId).toHaveLength(1);
        const row = await planRow(r.planId);
        expect(row.steps[0].status, r.planId).toBe('failed');
        expect(String(row.steps[0].errorMessage), r.planId).toMatch(r.error);
      }
      expect(await callLogs(ID.biz)).toEqual([]);
      expect(await callLogs(bizC)).toEqual([]);
      // No refusal counted, in any business.
      expect(dispatcher.getCircuitStatus('call_create_task', ID.biz)).toEqual({ open: false, failures: 0, lastFailure: null });
      expect(dispatcher.getCircuitStatus('call_create_task', bizC)).toEqual({ open: false, failures: 0, lastFailure: null });
      expect(dispatcher.getCircuitStatus('call_create_task')).toEqual({ open: false, failures: 0, lastFailure: null });

      // bizB's OWNER still runs call_create_task: dispatched once, completed, the call log recorded.
      const planB = `${P}qw07_bizb`;
      const argsB = { contactId: cB, callerId: ID.owner, notes: 'v87b qw07 bizb owner' };
      const stepB = await seedQueuePlan(planB, ID.outsider, 'call_create_task', argsB, ID.bizB);
      const ranB = await runQueueStep(planB, 'call_create_task', argsB, ID.bizB);
      expect(ranB, JSON.stringify(ranB)).toMatchObject({ ok: true });
      expect(dispatchedFor(stepB)).toHaveLength(1);
      expect((await planRow(planB)).steps[0].status).toBe('completed');
      expect(await callLogs(ID.bizB)).toEqual([{ contactId: cB, callerId: ID.outsider, notes: 'v87b qw07 bizb owner' }]);

      // Regression control: biz's OWNER still runs it in biz too.
      const planA = `${P}qw07_owner`;
      const argsA = { contactId: ID.cTeam, callerId: ID.staff, notes: 'v87b qw07 biz owner' };
      await seedQueuePlan(planA, ID.owner, 'call_create_task', argsA);
      expect(await runQueueStep(planA, 'call_create_task', argsA)).toMatchObject({ ok: true });
      expect((await planRow(planA)).steps[0].status).toBe('completed');
      expect(await callLogs(ID.biz)).toEqual([{ contactId: ID.cTeam, callerId: ID.owner, notes: 'v87b qw07 biz owner' }]);
    } finally {
      // A RED run leaves no open circuit for the cases after this one.
      dispatcher.resetCircuit('call_create_task');
    }
  });

  // W9-DISPATCH-CIRCUIT review SEC-W9DC-2 / CR-W9DC-1 (SEC-W8CTNM-1, owner ruling D-73): the per-business
  // circuit, end to end, as production reaches it. The queue's dispatcher calls the REAL
  // FlowOrchestratorService.executeToolDirectly here (its real executeTool, which catches what the tool
  // throws and rethrows a failure as a plain Error, the form production delivers it in; a refusal, since
  // W10-DISPATCH-STATUS, as the tool's HttpException: SEC-W9DC-1, QW-07b), on a worker of the case's own (its own ActionDispatcherService, so
  // no circuit leaks into other cases), with the job's retryCount 2 as PlanExecutorService enqueues it.
  // biz's circuit is opened by genuine failures (call_create_task erroring, its store not answering), which
  // stay failures whatever becomes of SEC-W9DC-1, so the bizB check below is never vacuous. With the circuit
  // keyed by tool alone (one process-wide circuit), bizB's plan is refused 'Circuit breaker open'.
  it('QW-07c W9-DISPATCH-CIRCUIT review SEC-W9DC-2, CR-W9DC-1 (SEC-W8CTNM-1, D-73): through the real FlowOrchestratorService.executeToolDirectly (a failure reaches the dispatcher as a plain Error, retried as the plan executor enqueues it), five genuine failures of call_create_task in biz open biz\'s circuit for the tool and only biz\'s: bizB\'s OWNER still runs call_create_task (dispatched once, completed, the call log recorded) while biz\'s OWNER is held by biz\'s open circuit', async () => {
    const { ActionDispatcherService } = await import('../src/modules/ai/action-dispatcher.service');
    const { QueueService } = await import('../src/modules/ai/queue.service');
    const { FlowOrchestratorService } = await import('../src/modules/ai/flow-orchestrator.service');
    const { AiExecutionLogService } = await import('../src/modules/ai/ai-execution-log.service');
    const cB = `${P}qw07c_c_bizb`;
    await db.contact.create({ data: { id: cB, businessId: ID.bizB, firstName: 'V87B C B', visibility: 'TEAM', ownerId: ID.outsider } });
    const callLogs = (businessId: string) => db.callLog.findMany({ where: { businessId, notes: { startsWith: 'v87b qw07c' } }, select: { contactId: true, callerId: true, notes: true } });

    // The harness's orchestrator, whose call_create_task fails in biz as a tool fails (not as it refuses).
    const STORE_DOWN = 'v87b qw07c: the call log store did not answer';
    const failingInBiz = Object.create(flow);
    failingInBiz.executeToolAction = async (businessId: string, toolName: string, args: Record<string, unknown>, action?: any) => {
      if (businessId === ID.biz && toolName === 'call_create_task') throw new Error(STORE_DOWN);
      return flow.executeToolAction(businessId, toolName, args, action);
    };
    // What reached the dispatcher from executeToolDirectly on each failed attempt.
    const delivered: unknown[] = [];
    const realExecuteToolDirectly = FlowOrchestratorService.prototype.executeToolDirectly;
    const flowAsProduction = {
      executeToolDirectly: async (businessId: string, toolName: string, args: Record<string, unknown>, planContext?: { planId: string; planStepId: string }, action?: any) => {
        dispatched.push({ toolName, planStepId: planContext?.planStepId, principal: action?.principalUserId, surface: action?.surface });
        try {
          return await realExecuteToolDirectly.call(failingInBiz, businessId, toolName, args, planContext, action);
        } catch (e) {
          delivered.push(e);
          throw e;
        }
      },
    };
    const ALLOW = { allowed: true, tier: 1, reason: 'v87b: allowed', requiresFormalApproval: false, requiresAdminApproval: false, requiresQuickConfirm: false };
    const governance = { evaluate: async () => ({ ...ALLOW }), evaluateAutoApproval: async () => ({ ...ALLOW, autoApproved: true }), getToolTier: () => 1 };
    const events = { emit: () => true };
    const executionLog = new AiExecutionLogService(prisma);
    const dispatcher = new ActionDispatcherService(prisma, events as any, executionLog, governance as any, flowAsProduction as any, { registerAction: async () => undefined } as any);
    // Production's retry delays are 1 s and 3 s; the attempts are production's, only their spacing is not.
    (dispatcher as unknown as { RETRY_DELAYS: number[] }).RETRY_DELAYS = [0, 0];
    const worker = Object.create(QueueService.prototype);
    Object.assign(worker, {
      prisma, events, governance, executionLog, actionDispatcher: dispatcher, flowOrchestrator: flowAsProduction,
      stateMachine: { transition: async () => undefined },
      logger: new Logger('v87b-qw07c-queue'),
    });
    const CLOSED = { open: false, failures: 0, lastFailure: null };

    try {
      expect(dispatcher.getCircuitStatus('call_create_task')).toEqual(CLOSED);
      for (let i = 1; i <= 5; i++) {
        const planId = `${P}qw07c_fail_${i}`;
        const args = { contactId: ID.cTeam, callerId: ID.owner, notes: `v87b qw07c fail ${i}` };
        const stepId = await seedQueuePlan(planId, ID.owner, 'call_create_task', args);
        const result = await runQueueStep(planId, 'call_create_task', args, ID.biz, { retryCount: 2, worker });
        expect(result.ok, planId).toBe(false);
        // A genuine failure is retried: three attempts, as the plan executor enqueues the step.
        expect(dispatchedFor(stepId), planId).toHaveLength(3);
        const row = await planRow(planId);
        expect(row.steps[0].status, planId).toBe('failed');
        expect(String(row.steps[0].errorMessage), planId).toBe(STORE_DOWN);
      }
      // Each failure reached the dispatcher as production delivers it: a plain Error, no HTTP status.
      expect(delivered).toHaveLength(15);
      for (const e of delivered) {
        expect(e).toBeInstanceOf(Error);
        expect(e).not.toBeInstanceOf(HttpException);
        expect((e as Error).message).toBe(STORE_DOWN);
      }
      // The five opened biz's circuit for the tool (so the bizB check is not vacuous), and only biz's.
      expect(dispatcher.getCircuitStatus('call_create_task', ID.biz)).toMatchObject({ open: true, failures: 5 });
      expect(dispatcher.getCircuitStatus('call_create_task', ID.bizB)).toEqual(CLOSED);
      expect(await callLogs(ID.biz)).toEqual([]);

      // bizB's OWNER still runs call_create_task: dispatched once, completed, the call log recorded.
      const planB = `${P}qw07c_bizb`;
      const argsB = { contactId: cB, callerId: ID.owner, notes: 'v87b qw07c bizb owner' };
      const stepB = await seedQueuePlan(planB, ID.outsider, 'call_create_task', argsB, ID.bizB);
      const ranB = await runQueueStep(planB, 'call_create_task', argsB, ID.bizB, { retryCount: 2, worker });
      expect(ranB, JSON.stringify(ranB)).toMatchObject({ ok: true });
      expect(dispatchedFor(stepB)).toHaveLength(1);
      expect((await planRow(planB)).steps[0].status).toBe('completed');
      expect(await callLogs(ID.bizB)).toEqual([{ contactId: cB, callerId: ID.outsider, notes: 'v87b qw07c bizb owner' }]);
      expect(dispatcher.getCircuitStatus('call_create_task', ID.bizB)).toEqual(CLOSED);

      // biz's own circuit is open: biz's OWNER is held by it (nothing dispatched) until it closes.
      const planA = `${P}qw07c_owner`;
      const argsA = { contactId: ID.cTeam, callerId: ID.owner, notes: 'v87b qw07c biz owner' };
      const stepA = await seedQueuePlan(planA, ID.owner, 'call_create_task', argsA);
      const ranA = await runQueueStep(planA, 'call_create_task', argsA, ID.biz, { retryCount: 2, worker });
      expect(ranA.ok).toBe(false);
      expect(dispatchedFor(stepA)).toEqual([]);
      expect(String((await planRow(planA)).steps[0].errorMessage)).toBe('Circuit breaker open for tool "call_create_task"');
    } finally {
      dispatcher.resetCircuit('call_create_task');
    }
  });

  // W9-DISPATCH-CIRCUIT (SEC-W8CTNM-1, D-73), left open there and closed by W10-DISPATCH-STATUS (D-73):
  // through the real FlowOrchestratorService.executeToolDirectly the refusal did not reach the dispatcher
  // as the HttpException CallLogService throws. executeTool caught it and answered { success: false, error }
  // with the message alone, and executeToolDirectly rethrew a plain Error(result.error), so the dispatcher
  // saw no status and still retried and counted a member's 404/403 toward the circuit of that business
  // and tool. Review SEC-W9DC-1 (confirmed by running, W9 repair round 1): over the real executeToolDirectly
  // and executeTool, five 404 'Contact not found' refusals in biz made 15 tool calls (each retried twice)
  // and opened biz's circuit ({open: true, failures: 5}); biz's OWNER was then answered 'Circuit breaker
  // open for tool "call_create_task"', while bizB ran (QW-07c pins that half).
  // W10-DISPATCH-STATUS (SEC-W9DC-1, D-73): executeToolDirectly rethrows the tool's HttpException, its
  // status and message, so W9's non-retryable-4xx rule (isToolRefusal) runs in production; the envelope
  // executeTool answers its other callers keeps its shape. Here the queue's dispatcher calls the REAL
  // executeToolDirectly and executeTool over the harness's orchestrator (call_create_task its own case,
  // over the real CallLogService), on a worker of the case's own (its own ActionDispatcherService, so no
  // circuit leaks into other cases), with the job's retryCount 2 as PlanExecutorService enqueues it.
  it('QW-07b W9-DISPATCH-CIRCUIT review SEC-W9DC-1 (SEC-W8CTNM-1, D-73): through the real FlowOrchestratorService.executeToolDirectly, a member\'s call_create_task refused inside dispatch (404, 403) reaches the dispatcher as an HttpException of the refusal\'s status, is answered once and counts toward no circuit in its own business either: five such refusals in biz leave call_create_task running for biz\'s OWNER, and the envelope executeTool answers keeps its shape (W10-DISPATCH-STATUS, D-73, was it.todo)', async () => {
    const { ActionDispatcherService } = await import('../src/modules/ai/action-dispatcher.service');
    const { QueueService } = await import('../src/modules/ai/queue.service');
    const { FlowOrchestratorService } = await import('../src/modules/ai/flow-orchestrator.service');
    const { AiExecutionLogService } = await import('../src/modules/ai/ai-execution-log.service');
    const superAdmin = `${P}qw07b_sa`; // a SUPER_ADMIN who is no member of biz (D-46)
    const ownerOnly = `${P}qw07b_owner_only`; // bizC's owner by Business.ownerId alone, no membership (CR-W4PP-2, D-104)
    const bizC = `${P}qw07b_bizc`;
    const cC = `${P}qw07b_c_bizc`;
    await db.user.create({ data: { id: superAdmin, email: `${P}qw07b_sa@test.local`, role: 'SUPER_ADMIN' } });
    await db.user.create({ data: { id: ownerOnly, email: `${P}qw07b_owner_only@test.local`, role: 'USER' } });
    await db.business.create({ data: { id: bizC, name: 'V87B Biz C (QW-07b)', ownerId: ownerOnly } });
    await db.contact.create({ data: { id: cC, businessId: bizC, firstName: 'V87B C', visibility: 'TEAM', ownerId: ownerOnly } });
    const callLogs = (businessId: string) => db.callLog.findMany({ where: { businessId, notes: { startsWith: 'v87b qw07b' } }, select: { contactId: true, callerId: true, notes: true } });

    // What reached the dispatcher from the real executeToolDirectly on each failed attempt.
    const delivered: Array<{ planStepId?: string; error: unknown }> = [];
    const realExecuteToolDirectly = FlowOrchestratorService.prototype.executeToolDirectly;
    const flowAsProduction = {
      executeToolDirectly: async (businessId: string, toolName: string, args: Record<string, unknown>, planContext?: { planId: string; planStepId: string }, action?: any) => {
        dispatched.push({ toolName, planStepId: planContext?.planStepId, principal: action?.principalUserId, surface: action?.surface });
        try {
          return await realExecuteToolDirectly.call(flow, businessId, toolName, args, planContext, action);
        } catch (e) {
          delivered.push({ planStepId: planContext?.planStepId, error: e });
          throw e;
        }
      },
    };
    const ALLOW = { allowed: true, tier: 1, reason: 'v87b: allowed', requiresFormalApproval: false, requiresAdminApproval: false, requiresQuickConfirm: false };
    const governance = { evaluate: async () => ({ ...ALLOW }), evaluateAutoApproval: async () => ({ ...ALLOW, autoApproved: true }), getToolTier: () => 1 };
    const events = { emit: () => true };
    const executionLog = new AiExecutionLogService(prisma);
    const dispatcher = new ActionDispatcherService(prisma, events as any, executionLog, governance as any, flowAsProduction as any, { registerAction: async () => undefined } as any);
    // Production's retry delays are 1 s and 3 s; the attempts are production's, only their spacing is not.
    (dispatcher as unknown as { RETRY_DELAYS: number[] }).RETRY_DELAYS = [0, 0];
    const worker = Object.create(QueueService.prototype);
    Object.assign(worker, {
      prisma, events, governance, executionLog, actionDispatcher: dispatcher, flowOrchestrator: flowAsProduction,
      stateMachine: { transition: async () => undefined },
      logger: new Logger('v87b-qw07b-queue'),
    });
    const CLOSED = { open: false, failures: 0, lastFailure: null };

    try {
      expect(dispatcher.getCircuitStatus('call_create_task')).toEqual(CLOSED);
      const refusals: Array<{ planId: string; userId: string; businessId: string; contactId: string; status: number; error: RegExp }> = [];
      for (let i = 1; i <= 5; i++) {
        refusals.push({ planId: `${P}qw07b_crmw_${i}`, userId: ID.staffCrmW, businessId: ID.biz, contactId: ID.cPriv, status: 404, error: /^Contact not found$/ });
      }
      refusals.push({ planId: `${P}qw07b_sa`, userId: superAdmin, businessId: ID.biz, contactId: ID.cTeam, status: 403, error: /Only a member of this business/ });
      refusals.push({ planId: `${P}qw07b_owner_only`, userId: ownerOnly, businessId: bizC, contactId: cC, status: 403, error: /Only a member of this business/ });
      for (const r of refusals) {
        // callerId is the tool contract's (validateToolInput requires it); the dispatcher ignores it (D-88).
        const args = { contactId: r.contactId, callerId: ID.owner, notes: `v87b qw07b ${r.planId}` };
        const stepId = await seedQueuePlan(r.planId, r.userId, 'call_create_task', args, r.businessId);
        // It passes the gate before dispatch (the refusal is the tool's, inside dispatch).
        expect(await planStepRunRefusal(prisma, r.businessId, r.planId, 'call_create_task'), r.planId).toBeNull();
        const result = await runQueueStep(r.planId, 'call_create_task', args, r.businessId, { retryCount: 2, worker });
        expect(result.ok, r.planId).toBe(false);
        // Answered once: a refusal is not retried.
        expect(dispatchedFor(stepId), r.planId).toHaveLength(1);
        // It reached the dispatcher as an HttpException of the refusal's status, with the tool's message.
        const reached = delivered.filter((d) => d.planStepId === stepId).map((d) => d.error);
        expect(reached, r.planId).toHaveLength(1);
        expect(reached[0], r.planId).toBeInstanceOf(HttpException);
        expect((reached[0] as HttpException).getStatus(), r.planId).toBe(r.status);
        expect((reached[0] as Error).message, r.planId).toMatch(r.error);
        const row = await planRow(r.planId);
        expect(row.steps[0].status, r.planId).toBe('failed');
        expect(String(row.steps[0].errorMessage), r.planId).toMatch(r.error);
      }
      expect(await callLogs(ID.biz)).toEqual([]);
      expect(await callLogs(bizC)).toEqual([]);
      // No refusal counted, in biz's own circuit either.
      expect(dispatcher.getCircuitStatus('call_create_task', ID.biz)).toEqual(CLOSED);
      expect(dispatcher.getCircuitStatus('call_create_task', bizC)).toEqual(CLOSED);
      expect(dispatcher.getCircuitStatus('call_create_task')).toEqual(CLOSED);

      // biz's OWNER still runs call_create_task in biz: dispatched once, completed, the call log recorded.
      const planA = `${P}qw07b_owner`;
      const argsA = { contactId: ID.cTeam, callerId: ID.staff, notes: 'v87b qw07b biz owner' };
      const stepA = await seedQueuePlan(planA, ID.owner, 'call_create_task', argsA);
      const ranA = await runQueueStep(planA, 'call_create_task', argsA, ID.biz, { retryCount: 2, worker });
      expect(ranA, JSON.stringify(ranA)).toMatchObject({ ok: true });
      expect(dispatchedFor(stepA)).toHaveLength(1);
      expect((await planRow(planA)).steps[0].status).toBe('completed');
      expect(await callLogs(ID.biz)).toEqual([{ contactId: ID.cTeam, callerId: ID.owner, notes: 'v87b qw07b biz owner' }]);
      expect(dispatcher.getCircuitStatus('call_create_task', ID.biz)).toEqual(CLOSED);

      // The envelope executeTool answers its other callers (executeToolDirect here, as the plan run over
      // HTTP and the chat read it) keeps its shape: the same keys, the tool's message as the error.
      const planE = `${P}qw07b_envelope`;
      const argsE = { contactId: ID.cPriv, callerId: ID.owner, notes: 'v87b qw07b envelope' };
      const stepE = await seedQueuePlan(planE, ID.staffCrmW, 'call_create_task', argsE);
      const envelope = await flow.executeToolDirect(ID.biz, 'call_create_task', argsE, planE, stepE, { surface: 'PLAN_QUEUE', planId: planE, planStepId: stepE });
      expect(Object.keys(envelope).sort()).toEqual(['changedEntities', 'error', 'family', 'followOnSuggestions', 'name', 'result', 'riskTier', 'success', 'toolCallId']);
      expect(envelope).toMatchObject({ success: false, result: null, error: 'Contact not found', name: 'call_create_task' });
      expect(await callLogs(ID.biz)).toHaveLength(1);
    } finally {
      dispatcher.resetCircuit('call_create_task');
    }
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

  it('PA-04 W8-CALL-TASK-NO-MEMBER (D-73, D-93; review CR-W8CTNM-1): run for no member, call_create_task is refused before it runs (blocked, a recorded refusal, no call log); run for the business owner it passes the gate, records the owner as the caller (not the callerId the model named), and its execution log row withholds the arguments and the answer', async () => {
    const pa04Logs = () => db.callLog.findMany({ where: { businessId: ID.biz, notes: { startsWith: 'v87b pa04' } }, select: { contactId: true, callerId: true, notes: true } });
    const from = monitorCalls.length;
    const result = await flow.autoExecuteToolForMonitoring(ID.biz, 'call_create_task', { contactId: ID.cTeam, callerId: ID.staff, notes: 'v87b pa04 no member' });
    expect(monitorCalls.slice(from)).toEqual([]);
    expect(result).toMatchObject({ success: false, blocked: true });
    expect(String(result.error)).toMatch(/^Refused: "call_create_task" .*no member principal has no member to record \(D-73\)/);
    const refused = await db.aiExecutionLog.findFirst({ where: { businessId: ID.biz, toolName: 'call_create_task', mode: 'pro_auto' }, orderBy: { createdAt: 'desc' } });
    expect(refused).toMatchObject({ success: false, userId: null });
    expect(await pa04Logs()).toEqual([]);

    // Regression control (D-93): ProAutoMonitorService runs the monitor for the business owner.
    const fromOwner = monitorCalls.length;
    const ran = await flow.autoExecuteToolForMonitoring(ID.biz, 'call_create_task', { contactId: ID.cTeam, callerId: ID.staff, notes: 'v87b pa04 owner' }, { memberId: ID.owner });
    expect(ran, JSON.stringify(ran)).toMatchObject({ success: true });
    expect(monitorCalls.slice(fromOwner)).toEqual([{ toolName: 'call_create_task', action: { surface: 'PRO_AUTO_MONITOR', onBehalfOfUserId: ID.owner } }]);
    expect(await pa04Logs()).toEqual([{ contactId: ID.cTeam, callerId: ID.owner, notes: 'v87b pa04 owner' }]);
    const row = await db.aiExecutionLog.findFirst({ where: { businessId: ID.biz, toolName: 'call_create_task', mode: 'pro_auto', success: true }, orderBy: { createdAt: 'desc' } });
    expect(row).toMatchObject({ userId: ID.owner });
    expect(JSON.stringify([row.inputSummary, row.outputSummary, row.toolResult])).toContain('withheld');
    expect(JSON.stringify(row)).not.toContain('v87b pa04 owner');
    expect(JSON.stringify(row)).not.toContain(ID.cTeam);
  });
});

/** NOPRINCIPAL-SURFACES: briefing/:planId/execute-all approved the briefing's steps for no member. */
describe('briefing/:planId/execute-all runs the briefing as the member who asked, in the business it named', () => {
  it('BR-01 RED-BEFORE: a STAFF member executing the daily briefing (written with no member) records itself as the plan\'s member, so its contact read is checked against the STAFF member and refused at run time', async () => {
    const planId = `${P}br01`;
    const stepId = await seedBriefingPlan(planId, null, 'crm_list_contacts');
    const res = await briefing.executeAllBriefingCards(ID.biz, planId, ID.staffCrmW);
    expect(res).toMatchObject({ executed: 1 });
    expect((await planRow(planId)).userId).toBe(ID.staffCrmW);
    await runQueueStep(planId, 'crm_list_contacts');
    expect(dispatchedFor(stepId)).toEqual([]);
    expect((await planRow(planId)).steps[0].status).toBe('failed');
  });

  it("BR-02 RED-BEFORE: a member of biz naming biz cannot execute another business's briefing by its id: refused, its steps still pending", async () => {
    const planId = `${P}br02`;
    await seedBriefingPlan(planId, null, 'crm_list_contacts', {}, ID.bizB);
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

/**
 * KEY-R3b-PLAN-AUTHORITY review repairs. SEC-R3b-1: the no-member gate and the member path at run
 * time knew contact reads only as the four GRAPH_ACTION_CONTACT_READ_TOOLS, so segment_contacts
 * (every contact of the business, no visibility clause) and the other crm tools that read contacts
 * passed. SEC-R3b-2: the no-member gate allowed by default a tool the authority map refuses
 * (execute_custom_logic) or does not map, and the Business.ownerId shortcut ran a refused tool.
 */
describe('review repairs: a contact read is known by what the tool does; a refused or unmapped tool is denied by default', () => {
  const CONTACT_READERS = ['segment_contacts', 'draft_followup_message', 'create_followup_queue', 'deals_get', 'portal_list_access', 'call_list_tasks'];

  it('RV-01 RED-BEFORE (SEC-R3b-1): a plan or monitor with no member refuses every crm tool that reads contacts, not only the four contact-list tools; a tool that reads none still passes', () => {
    for (const tool of CONTACT_READERS) {
      expect(noMemberToolRefusal(tool), tool).toMatch(/reads the business's contacts/);
    }
    expect(noMemberToolRefusal('helpdesk_create_ticket')).toBeNull();
    expect(noMemberToolRefusal('crm_create_contact')).toBeNull();
  });

  it('RV-02 RED-BEFORE (SEC-R3b-1): a plan with no member with segment_contacts is refused on the queue and recorded, nothing dispatched, the PRIVATE contact not read', async () => {
    const planId = `${P}rv02`;
    const stepId = await seedQueuePlan(planId, null, 'segment_contacts', { name: 'v87b segment' });
    await runQueueStep(planId, 'segment_contacts', { name: 'v87b segment' });
    expect(dispatchedFor(stepId)).toEqual([]);
    const row = await planRow(planId);
    expect(row.steps[0].status).toBe('failed');
    expect(String(row.steps[0].errorMessage)).toMatch(/no member/i);
    expect(JSON.stringify(row.steps[0].outputResult ?? null)).not.toContain(ID.cPriv);
  });

  it('RV-03 RED-BEFORE (SEC-R3b-1): PRO_AUTO_MONITOR refuses segment_contacts and draft_followup_message before they run', async () => {
    for (const tool of ['segment_contacts', 'draft_followup_message']) {
      const from = monitorCalls.length;
      const result = await flow.autoExecuteToolForMonitoring(ID.biz, tool, { name: 'v87b segment', contactId: ID.cPriv });
      expect(monitorCalls.slice(from), tool).toEqual([]);
      expect(result, tool).toMatchObject({ success: false, blocked: true });
      expect(JSON.stringify(result)).not.toContain(ID.cPriv);
    }
  });

  it("RV-04 RED-BEFORE (SEC-R3b-1): a member's plan with a crm contact reader runs only for the OWNER at run time (the queue hands the dispatcher no principal): STAFF kept to its own book and an ADMIN are refused; the OWNER's runs", async () => {
    const args = { name: 'v87b segment', dealId: `${P}nodeal` };
    for (const [planId, member, tool] of [
      [`${P}rv04_staff`, ID.staffOwned, 'segment_contacts'],
      [`${P}rv04_admin`, ID.admin, 'deals_get'],
    ] as const) {
      const stepId = await seedQueuePlan(planId, member, tool, args);
      await runQueueStep(planId, tool, args);
      expect(dispatchedFor(stepId), planId).toEqual([]);
      const row = await planRow(planId);
      expect(row.steps[0].status, planId).toBe('failed');
      expect(JSON.stringify(row.steps[0].outputResult ?? null)).not.toContain(ID.cPriv);
    }
    const owner = `${P}rv04_owner`;
    const ownerStep = await seedQueuePlan(owner, ID.owner, 'segment_contacts', { name: 'v87b segment' });
    await runQueueStep(owner, 'segment_contacts', { name: 'v87b segment' });
    expect(dispatchedFor(ownerStep)).toHaveLength(1);
    const ownerRow = await planRow(owner);
    expect(ownerRow.steps[0].status).toBe('completed');
    expect(JSON.stringify(ownerRow.steps[0].outputResult)).toContain(ID.cPriv);
  });

  it('RV-05 RED-BEFORE (SEC-R3b-1): POST ai/plans/:planId/approve applies the same rule (no principal): an ADMIN may not approve a contact reader, the OWNER may; the plans read shows such a step\'s stored output to the OWNER only', async () => {
    const opts = { proposerOverrideRoles: PLAN_APPROVER_ROLES, noPrincipal: true };
    const adminRead = await graphPlanReadScope(prisma, ID.biz, { id: ID.admin, role: 'USER' });
    const ownerRead = await graphPlanReadScope(prisma, ID.biz, { id: ID.owner, role: 'USER' });
    for (const tool of ['segment_contacts', 'deals_get']) {
      const err = await assertMayRunGraphAction(prisma, ID.biz, { id: ID.admin, role: 'USER' }, tool, ID.admin, opts).then(() => null, (e: unknown) => e);
      expect(err, tool).toBeInstanceOf(ForbiddenException);
      await expect(assertMayRunGraphAction(prisma, ID.biz, { id: ID.owner, role: 'USER' }, tool, ID.owner, opts)).resolves.toBeUndefined();
      expect(adminRead.stepOutput(tool), tool).toBe(false);
      expect(ownerRead.stepOutput(tool), tool).toBe(true);
    }
    expect(adminRead.stepOutput('helpdesk_create_ticket')).toBe(true);
  });

  it('RV-06 RED-BEFORE (SEC-R3b-2): a refused tool (execute_custom_logic) and an unmapped one are refused with no member, by the gate, the queue and the monitor; nothing runs', async () => {
    expect(noMemberToolRefusal('execute_custom_logic')).not.toBeNull();
    expect(noMemberToolRefusal(`${P}not_a_tool`)).not.toBeNull();
    const code = "const r = await api.callTool('crm_list_contacts', {}); return JSON.stringify(r);";
    const planId = `${P}rv06`;
    const stepId = await seedQueuePlan(planId, null, 'execute_custom_logic', { code });
    expect(await planStepRunRefusal(prisma, ID.biz, planId, 'execute_custom_logic')).not.toBeNull();
    await runQueueStep(planId, 'execute_custom_logic', { code });
    expect(dispatchedFor(stepId)).toEqual([]);
    expect((await planRow(planId)).steps[0].status).toBe('failed');
    const from = monitorCalls.length;
    const result = await flow.autoExecuteToolForMonitoring(ID.biz, 'execute_custom_logic', { code });
    expect(monitorCalls.slice(from)).toEqual([]);
    expect(result).toMatchObject({ success: false, blocked: true });
  });

  it('RV-07 RED-BEFORE (SEC-R3b-2): the business owner (Business.ownerId) is refused a tool the authority map never runs, whoever asks; an unmapped tool still passes the owner', async () => {
    const planId = `${P}rv07`;
    const stepId = await seedQueuePlan(planId, ID.owner, 'execute_custom_logic', { code: 'return 1;' });
    expect(await planStepRunRefusal(prisma, ID.biz, planId, 'execute_custom_logic')).toMatch(/not executed/);
    await runQueueStep(planId, 'execute_custom_logic', { code: 'return 1;' });
    expect(dispatchedFor(stepId)).toEqual([]);
    expect(await planStepRunRefusal(prisma, ID.biz, planId, 'mcp__v87b__tool')).toBeNull();
  });
});

/**
 * KEY-R3b review SEC-R3b-3 / CR-R3b-2: the owned-view rule found the contacts a crm step reaches
 * only through contactId, masterContactId and duplicateContactId. crm.complete_task reaches a task by
 * taskId alone (the adapter ignores contactId), so a member kept to its own book completed a task on
 * the OWNER's PRIVATE contact. POST tasks/:taskId/complete refuses it (assertVisibleChildRow).
 */
describe("review repairs: a crm step that names a task is checked against the task's contact", () => {
  it("RV-08 RED-BEFORE: a STAFF member kept to its own book is refused crm.complete_task on a task of the OWNER's PRIVATE contact, with or without its own contactId as cover, and on a task id not in the business; nothing routed", async () => {
    for (const [suffix, params] of [
      ['bare', { taskId: ID.ctPriv }],
      ['cover', { taskId: ID.ctPriv, contactId: ID.cOwned }],
      ['unknown', { taskId: `${P}no_such_task` }],
    ] as const) {
      const planId = `${P}rv08_${suffix}`;
      await seedCortexPlan(planId, [{ module: 'crm', action: 'complete_task', params }], ID.staffOwned);
      const from = routed.length;
      const err = await planner.executePlan(planId, {}, asMember(ID.staffOwned)).catch((e: unknown) => e);
      expect(err, `${suffix} ${String(err)}`).toBeInstanceOf(ForbiddenException);
      expect(routedFor(planId, from), suffix).toEqual([]);
      expect(await planRow(planId), suffix).toMatchObject({ status: 'pending', startedAt: null });
    }
  });

  it("RV-09 regression control: the same member completes a task on its own contact; the OWNER completes the PRIVATE contact's task", async () => {
    for (const [planId, member, taskId] of [
      [`${P}rv09_own`, ID.staffOwned, ID.ctOwned],
      [`${P}rv09_owner`, ID.owner, ID.ctPriv],
    ] as const) {
      await seedCortexPlan(planId, [{ module: 'crm', action: 'complete_task', params: { taskId } }], member);
      const from = routed.length;
      expect(await planner.executePlan(planId, {}, asMember(member)), planId).toMatchObject({ status: 'completed', executed: 1 });
      expect(routedFor(planId, from).map((r) => r.userId), planId).toEqual([member]);
    }
  });
});

/**
 * KEY-R3b review CR-R3b-1, ruled a deliberate consequence of D-37 and pinned here: D-71 keeps every
 * module scope for an ADMIN, but an ADMIN's contact visibility still excludes another member's
 * PRIVATE contact (visibilityClause), and the crm adapter reads with none. So a crm read naming no
 * contact (crm.list_contacts, the first step of the invoice and booking fallback plans) runs for the
 * business OWNER only, an ADMIN included, as POST ai/plans/:planId/approve already rules for the
 * dispatcher's contact reads with no principal. A crm step naming a contact the ADMIN can open runs.
 */
describe('review repairs: an ADMIN keeps every module, and its crm steps keep to its contact visibility (D-71, D-37)', () => {
  it("RV-10 an ADMIN's plan opening with crm.list_contacts (the invoice fallback plan's shape) is refused 403 before the claim: nothing routed, the plan still pending", async () => {
    const planId = `${P}rv10`;
    await seedCortexPlan(planId, [{ module: 'crm', action: 'list_contacts' }, { module: 'commerce', action: 'create_invoice' }], ID.admin);
    const from = routed.length;
    const err = await planner.executePlan(planId, {}, asMember(ID.admin)).catch((e: unknown) => e);
    expect(err, String(err)).toBeInstanceOf(ForbiddenException);
    expect(String((err as Error).message)).toMatch(/business owner/);
    expect(routedFor(planId, from)).toEqual([]);
    expect(await planRow(planId)).toMatchObject({ status: 'pending', startedAt: null });
  });

  it("RV-11 an ADMIN's crm step naming a TEAM contact runs with the ADMIN's invoice step; one naming the OWNER's PRIVATE contact is refused", async () => {
    const team = `${P}rv11_team`;
    await seedCortexPlan(team, [{ module: 'crm', action: 'get_contact', params: { contactId: ID.cTeam } }, { module: 'commerce', action: 'create_invoice' }], ID.admin);
    const from = routed.length;
    expect(await planner.executePlan(team, {}, asMember(ID.admin))).toMatchObject({ status: 'completed', executed: 2 });
    expect(routedFor(team, from).map((r) => r.userId)).toEqual([ID.admin, ID.admin]);

    const priv = `${P}rv11_priv`;
    await seedCortexPlan(priv, [{ module: 'crm', action: 'get_contact', params: { contactId: ID.cPriv } }], ID.admin);
    const privFrom = routed.length;
    const err = await planner.executePlan(priv, {}, asMember(ID.admin)).catch((e: unknown) => e);
    expect(err, String(err)).toBeInstanceOf(ForbiddenException);
    expect(routedFor(priv, privFrom)).toEqual([]);
  });
});

/**
 * KEY-R3b review SEC-R3b-4: POST briefing/:planId/execute-all took any plan with no member (a journey,
 * an agent trigger, a KEY-cortex system plan), bound it for good to the first member who called, and
 * no one could rebind it, the OWNER included. Only the daily briefing is taken now, and the business
 * OWNER (or an ADMIN) who runs it takes it over.
 */
describe('review repairs: briefing execute-all takes only the daily briefing, and the owner can take a briefing over', () => {
  it('RV-12 RED-BEFORE: a plan with no member that is not the daily briefing is not taken: refused, still no member, its step still pending', async () => {
    const planId = `${P}rv12`;
    await seedQueuePlan(planId, null, 'bookings_create', { serviceId: `${P}svc` });
    const err = await briefing.executeAllBriefingCards(ID.biz, planId, ID.staffNoBook).then(() => null, (e: unknown) => e);
    expect(err).not.toBeNull();
    const row = await planRow(planId);
    expect(row.userId).toBeNull();
    expect(row.steps[0].status).toBe('pending');
  });

  it('RV-13 RED-BEFORE: a briefing a STAFF member took is taken over by the OWNER, whose scopes then run its step; another STAFF member is refused', async () => {
    const planId = `${P}rv13`;
    const stepId = await seedBriefingPlan(planId, null, 'bookings_create', { serviceId: `${P}svc` });
    await briefing.executeAllBriefingCards(ID.biz, planId, ID.staffNoBook);
    expect((await planRow(planId)).userId).toBe(ID.staffNoBook);
    await briefing.executeAllBriefingCards(ID.biz, planId, ID.owner);
    expect((await planRow(planId)).userId).toBe(ID.owner);
    const err = await briefing.executeAllBriefingCards(ID.biz, planId, ID.staff).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect((await planRow(planId)).userId).toBe(ID.owner);
    await runQueueStep(planId, 'bookings_create', { serviceId: `${P}svc` });
    expect(dispatchedFor(stepId)).toHaveLength(1);
  });
});

/**
 * W10-KEY-PLAN-SCOPE (owner ruling D-114, amending D-71 for an explicit revenue 'none' only; D-57;
 * W9-MONEY-REPORTS-KEY review SEC-W9MRK-1 and SEC-W9MRK-2). assertMemberSteps skipped every step check
 * for an ADMIN (D-71: an ADMIN keeps every module), and memberPlanStepScopeRefusal held a money report
 * step (finance.generate_pnl, analytics.create_report, analytics.export_report) to its module's scope
 * alone, while POST cortex/execute also asks revenue:read for it (cortexCommandRefusal, D-57). D-114: an
 * ADMIN whose explicit scope map sets revenue to none is refused money steps (the money reports and the
 * invoice actions); an ADMIN with role-default scopes is unaffected, and keeps every other module. The
 * plan read rule withholds such a step's stored output from a viewer without revenue read (SEC-W9MRK-2).
 * The members below are added for this block only (the fixture sanity case above counts the others).
 */
describe('W10-KEY-PLAN-SCOPE (D-114, D-57): an explicit revenue none binds an ADMIN\'s money steps, a money report step needs revenue read, and its stored output follows the plan read rule', () => {
  const KP = {
    adminNoRev: `${P}admin_norev`, // ADMIN, explicit scope map: role defaults with revenue and bookings 'none'
    adminDef: `${P}admin_def`, // ADMIN, no scope map (role defaults: revenue admin)
    staffFinNoRev: `${P}staff_fin_norev`, // STAFF, role defaults + expenses and analytics write, revenue 'none'
    staffFinRev: `${P}staff_fin_rev`, // STAFF, role defaults + expenses and analytics write (revenue read)
  };
  const MONEY_REPORT_STEPS = [
    { module: 'finance', action: 'generate_pnl' },
    { module: 'analytics', action: 'create_report' },
    { module: 'analytics', action: 'export_report' },
  ];
  let visiblePlanSteps: (steps: any[], scope: any) => Promise<any[]>;
  let aiController: any;

  beforeAll(async () => {
    ({ visiblePlanSteps } = await import('../src/modules/ai/graph-actions.controller') as any);
    const { AiController } = await import('../src/modules/ai/ai.controller');
    const { AiExecutionLogService } = await import('../src/modules/ai/ai-execution-log.service');
    aiController = Object.create(AiController.prototype);
    Object.assign(aiController, { prisma, executionLog: new AiExecutionLogService(prisma) });
    const adminDefaults = defaultScopesForRole('ADMIN');
    const staffDefaults = defaultScopesForRole('STAFF');
    for (const id of Object.values(KP)) {
      await db.user.create({ data: { id, email: `${P}${id.slice(P.length)}@test.local`, role: 'USER' } });
    }
    const member = (userId: string, role: string, permissionScopes?: Record<string, string>) =>
      db.membership.create({ data: { id: `${P}m_${userId.slice(P.length)}_biz`, userId, businessId: ID.biz, role, ...(permissionScopes ? { permissionScopes } : {}) } });
    await member(KP.adminNoRev, 'ADMIN', { ...adminDefaults, revenue: 'none', bookings: 'none' });
    await member(KP.adminDef, 'ADMIN');
    await member(KP.staffFinNoRev, 'STAFF', { ...staffDefaults, expenses: 'write', analytics: 'write', revenue: 'none' });
    await member(KP.staffFinRev, 'STAFF', { ...staffDefaults, expenses: 'write', analytics: 'write' });
  });

  it('PM-07 RED-BEFORE (W10-KEY-PLAN-SCOPE, D-114; SEC-W9MRK-1): an ADMIN whose explicit scope map sets revenue to none is refused its own plan with a money step (finance.generate_pnl, analytics.create_report, analytics.export_report; commerce.create_invoice already was), executed by that ADMIN or run with no member: 403 before the claim, nothing routed, the plan still pending', async () => {
    for (const step of [...MONEY_REPORT_STEPS, { module: 'commerce', action: 'create_invoice' }]) {
      const label = `${step.module}.${step.action}`;
      for (const path of ['member', 'creator'] as const) {
        const planId = `${P}pm07_${step.action}_${path}`;
        await seedCortexPlan(planId, [{ module: 'bookings', action: 'create_booking' }, step], KP.adminNoRev);
        const from = routed.length;
        const run = path === 'member' ? planner.executePlan(planId, {}, asMember(KP.adminNoRev)) : planner.executePlan(planId, { traceId: planId });
        const err = await run.catch((e: unknown) => e);
        expect(err, `${label} ${path} ${String(err)}`).toBeInstanceOf(ForbiddenException);
        expect(String((err as Error).message), `${label} ${path}`).toMatch(
          step.module === 'commerce' ? /revenue requires write access \(you have none\)/ : /revenue requires read access \(you have none\).*D-114/,
        );
        expect(routedFor(planId, from), `${label} ${path}`).toEqual([]);
        expect(await planRow(planId), `${label} ${path}`).toMatchObject({ status: 'pending', startedAt: null });
      }
    }
  });

  it('PM-08 regression control (W10-KEY-PLAN-SCOPE, D-114, D-71): an ADMIN with role-default scopes runs the same money steps; the ADMIN whose explicit map holds revenue runs a money report; the ADMIN whose map sets revenue to none still runs a step of a module its map denies (bookings) and a finance step that reads no money report; each step once, as that member', async () => {
    for (const [planId, creator, steps] of [
      [`${P}pm08_admindef`, KP.adminDef, [...MONEY_REPORT_STEPS, { module: 'commerce', action: 'create_invoice', params: INVOICE_ARGS }]],
      [`${P}pm08_adminrev`, ID.admin, [{ module: 'finance', action: 'generate_pnl' }]],
      [`${P}pm08_adminnorev`, KP.adminNoRev, [{ module: 'bookings', action: 'create_booking' }, { module: 'finance', action: 'record_expense' }]],
    ] as const) {
      await seedCortexPlan(planId, steps as any, creator);
      const from = routed.length;
      expect(await planner.executePlan(planId, {}, asMember(creator)), planId).toMatchObject({ planId, status: 'completed', executed: steps.length });
      expect(routedFor(planId, from).map((r) => r.userId), planId).toEqual(steps.map(() => creator));
    }
  });

  it('PM-09 RED-BEFORE (W10-KEY-PLAN-SCOPE, D-57; SEC-W9MRK-1): a STAFF member holding the module\'s write scope but revenue none is refused a money report step, executed by that member or run with no member (nothing routed); the same plan runs for a STAFF member who also holds revenue read', async () => {
    for (const step of MONEY_REPORT_STEPS) {
      const label = `${step.module}.${step.action}`;
      for (const path of ['member', 'creator'] as const) {
        const planId = `${P}pm09_${step.action}_${path}`;
        await seedCortexPlan(planId, [step], KP.staffFinNoRev);
        const from = routed.length;
        const run = path === 'member' ? planner.executePlan(planId, {}, asMember(KP.staffFinNoRev)) : planner.executePlan(planId, { traceId: planId });
        const err = await run.catch((e: unknown) => e);
        expect(err, `${label} ${path} ${String(err)}`).toBeInstanceOf(ForbiddenException);
        expect(String((err as Error).message), `${label} ${path}`).toMatch(/revenue requires read access \(you have none\).*D-57/);
        expect(routedFor(planId, from), `${label} ${path}`).toEqual([]);
        expect(await planRow(planId), `${label} ${path}`).toMatchObject({ status: 'pending', startedAt: null });
      }
    }
    const planId = `${P}pm09_rev`;
    await seedCortexPlan(planId, MONEY_REPORT_STEPS, KP.staffFinRev);
    const from = routed.length;
    expect(await planner.executePlan(planId, {}, asMember(KP.staffFinRev))).toMatchObject({ planId, status: 'completed', executed: MONEY_REPORT_STEPS.length });
    expect(routedFor(planId, from).map((r) => r.userId)).toEqual(MONEY_REPORT_STEPS.map(() => KP.staffFinRev));
  });

  it('PM-10 RED-BEFORE (W10-KEY-PLAN-SCOPE, D-114, D-57, D-74; SEC-W9MRK-2): the stored output of the money report steps an ADMIN with role-default scopes ran (stored as KeyCortexPlannerService steps, module.action with no tool) is withheld from the ADMIN whose explicit map sets revenue to none, on the plan read (visiblePlanSteps) and on GET ai/execution-logs (the KEY executor\'s rows), the steps still shown; the expense step keeps its output; the ADMIN with role-default scopes and the OWNER read every output', async () => {
    const planId = `${P}pm10`;
    const steps = [...MONEY_REPORT_STEPS, { module: 'finance', action: 'record_expense' }];
    await db.aiPlan.create({
      data: {
        id: planId, businessId: ID.biz, userId: KP.adminDef, objective: `v87b ${planId}`, status: 'pending',
        steps: { create: steps.map((s, i) => ({ id: `${planId}_s${i + 1}`, order: i + 1, module: s.module, action: s.action, toolName: null, inputPayload: { marker: `${planId}_s${i + 1}` } })) },
      },
    });
    expect(await planner.executePlan(planId, {}, asMember(KP.adminDef))).toMatchObject({ planId, status: 'completed', executed: steps.length });
    const stored = (await db.aiPlan.findUnique({ where: { id: planId }, include: { steps: { orderBy: { order: 'asc' } } } })).steps;
    expect(stored.map((s: any) => s.outputResult)).toEqual(steps.map((_s, i) => expect.objectContaining({ done: `${planId}_s${i + 1}` })));

    const read = async (viewer: string) => {
      const scope = await graphPlanReadScope(prisma, ID.biz, { id: viewer, role: 'USER' });
      const planSteps = await visiblePlanSteps(stored, scope);
      const page = await aiController.getExecutionLogs(ID.biz, { user: { id: viewer, role: 'USER' } }, undefined, undefined, '1000');
      const rows = (page.logs as any[]).filter((l) => typeof l.inputSummary?.parameters?.marker === 'string' && l.inputSummary.parameters.marker.startsWith(`${planId}_s`));
      rows.sort((a, b) => String(a.inputSummary.parameters.marker).localeCompare(String(b.inputSummary.parameters.marker)));
      return { planSteps, rows };
    };
    const markers = steps.map((_s, i) => `${planId}_s${i + 1}`);

    const denied = await read(KP.adminNoRev);
    expect(denied.planSteps.map((s: any) => `${s.module}.${s.action}`)).toEqual(steps.map((s) => `${s.module}.${s.action}`));
    expect(denied.planSteps.map((s: any) => s.outputResult)).toEqual([null, null, null, expect.objectContaining({ done: markers[3] })]);
    expect(denied.rows.map((r) => r.inputSummary.parameters.marker)).toEqual(markers);
    expect(denied.rows.map((r) => r.outputSummary)).toEqual([null, null, null, expect.objectContaining({ data: { done: markers[3] } })]);

    for (const viewer of [KP.adminDef, ID.owner]) {
      const served = await read(viewer);
      expect(served.planSteps.map((s: any) => s.outputResult), viewer).toEqual(markers.map((m) => expect.objectContaining({ done: m })));
      expect(served.rows.map((r) => r.outputSummary), viewer).toEqual(markers.map((m) => expect.objectContaining({ data: { done: m } })));
    }
  });

  it('SEC-W10KPS-1 RED-BEFORE (W10-KEY-PLAN-SCOPE review, D-114, D-57, D-74): a stored step naming a non-money tool (projects_list, fetch_project_status, create_task) with module finance, analytics or commerce runs as module.action (the P&L, a report, the invoices); GET cortex/plans/:planId judges it by its module too: the money report output is withheld from the ADMIN whose explicit map sets revenue to none and from a STAFF proposer without revenue read, the commerce step is not shown to them, a projects step keeps its output; the ADMIN with role-default scopes and the OWNER read every output; GET ai/execution-logs agrees', async () => {
    const toolSteps = [
      { toolName: 'projects_list', module: 'finance', action: 'generate_pnl' },
      { toolName: 'fetch_project_status', module: 'analytics', action: 'create_report' },
      { toolName: 'create_task', module: 'commerce', action: 'list_invoices' },
      { toolName: 'projects_list', module: 'projects', action: 'list_projects' },
    ];
    const labels = toolSteps.map((s) => `${s.module}.${s.action}`);
    const seed = (planId: string, userId: string) => db.aiPlan.create({
      data: {
        id: planId, businessId: ID.biz, userId, objective: `v87b ${planId}`, status: 'pending',
        steps: { create: toolSteps.map((s, i) => ({ id: `${planId}_s${i + 1}`, order: i + 1, toolName: s.toolName, module: s.module, action: s.action, inputPayload: { marker: `${planId}_s${i + 1}` } })) },
      },
    });
    // a plan of the ADMIN with role-default scopes, run by that ADMIN; a plan the STAFF member without
    // revenue read proposed, run by the OWNER: each step runs as module.action, whatever its toolName
    const adminPlan = `${P}kps1_admin`;
    const staffPlan = `${P}kps1_staff`;
    await seed(adminPlan, KP.adminDef);
    await seed(staffPlan, KP.staffFinNoRev);
    for (const [planId, runner] of [[adminPlan, KP.adminDef], [staffPlan, ID.owner]] as const) {
      const from = routed.length;
      expect(await planner.executePlan(planId, {}, asMember(runner)), planId).toMatchObject({ planId, status: 'completed', executed: toolSteps.length });
      expect(routedFor(planId, from).map((r) => `${r.module}.${r.action}`), planId).toEqual(labels);
    }

    const read = async (planId: string, viewer: string) => {
      const plan = await goalsController.getPlan(planId, ID.biz, { id: viewer, role: 'USER' });
      const steps = [...(plan?.steps ?? [])].sort((a: any, b: any) => a.order - b.order);
      return steps.map((s: any) => [`${s.module}.${s.action}`, s.outputResult]);
    };
    const outputOf = (planId: string, i: number) => expect.objectContaining({ done: `${planId}_s${i + 1}` });

    for (const [planId, viewer] of [[adminPlan, KP.adminNoRev], [staffPlan, KP.adminNoRev], [staffPlan, KP.staffFinNoRev]] as const) {
      expect(await read(planId, viewer), `${planId} ${viewer}`).toEqual([
        ['finance.generate_pnl', null],
        ['analytics.create_report', null],
        ['projects.list_projects', outputOf(planId, 3)],
      ]);
    }
    for (const viewer of [KP.adminDef, ID.owner]) {
      for (const planId of [adminPlan, staffPlan]) {
        expect(await read(planId, viewer), `${planId} ${viewer}`).toEqual(labels.map((l, i) => [l, outputOf(planId, i)]));
      }
    }

    // GET ai/execution-logs (the KEY executor's rows, toolName module.action): the same answer for the ADMIN
    const page = await aiController.getExecutionLogs(ID.biz, { user: { id: KP.adminNoRev, role: 'USER' } }, undefined, undefined, '1000');
    const rows = (page.logs as any[])
      .filter((l) => typeof l.inputSummary?.parameters?.marker === 'string' && l.inputSummary.parameters.marker.startsWith(`${adminPlan}_s`))
      .sort((a, b) => String(a.inputSummary.parameters.marker).localeCompare(String(b.inputSummary.parameters.marker)));
    expect(rows.map((r) => [r.toolName, r.outputSummary])).toEqual([
      ['finance.generate_pnl', null],
      ['analytics.create_report', null],
      ['projects.list_projects', expect.objectContaining({ data: { done: `${adminPlan}_s4` } })],
    ]);
  });
});
