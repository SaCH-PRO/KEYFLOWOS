/**
 * W3-KEY-CRM-VISIBILITY (FOLLOW4; owner rulings D-37 and D-88; KEY-R3b residuals): the KEY CRM tools
 * fetch_client_health, sequence_enroll_overdue, segment_contacts and create_followup_queue read and
 * write only the contacts the member the command runs for may open (REAL database).
 *
 * KEY-R3b-PLAN-AUTHORITY recorded three residuals outside its findings:
 *   - fetch_client_health (an analytics read) counts and names contacts. Run with a member principal
 *     it applies their visibility (V1-84), but the authority map did not know it as a contact read,
 *     so a member's plan the queue runs with no principal (or a plan an ADMIN approves) named every
 *     contact, the OWNER's PRIVATE top spender included.
 *   - sequence_enroll_overdue enrolled every contact with an overdue invoice, whoever asked: a STAFF
 *     member kept to their own book enrolled the OWNER's PRIVATE and TEAM contacts.
 *   - POST actions/businesses/:businessId/execute ran create_followup_queue over every stale lead,
 *     ignoring the principal (tasks written on, and names returned of, contacts the member may not
 *     open). segment_contacts already applies the principal's visibility since V1-84; it is pinned.
 * The rule is KEY-R3a/R3b's: the member the command runs for; the OWNER's view when the plan queue
 * runs with no member (D-88's convention, narrowed by D-93: a plan with no member reads no
 * contacts). One visibility clause (contactReadAccess: resolveCrmAccess
 * + visibilityClause, the rule GET contacts applies) bounds every case.
 *
 * Review repairs (CV-09..CV-12): the V1-84 calendar and booking reads (calendar_list_events,
 * calendar_check_conflicts, bookings_list_bookings, bookings_list_waitlist) and sequence_enroll are
 * bounded by the same clause, so with no principal they are the OWNER's only too (SEC-W3CV-1;
 * graph-action-visibility-bound.spec.ts derives the set from the dispatcher), and sequence_enroll
 * refuses a contact the member may not open (SEC-W3CV-4). CV-08b characterized the no-member run
 * pending an owner ruling (SEC-W3CV-2, D-73 vs D-88), since given as D-93 (below).
 *
 * W4-PROPOSAL-PRINCIPAL (FOLLOW5; owner rulings D-73, D-71, D-46, D-37; review SEC-W3CV-3), CV-13..CV-13c:
 * an approved AI_PLAN EXECUTE_TOOL proposal (PlanExecutorService.createStepProposal files one for a
 * plan step that needs approval) ran through KeyCortexActionExecutorPlugin with surface PROPOSAL, no
 * principal and no plan-step run refusal, for every tool: a STAFF member's step read and wrote the
 * whole book once an ADMIN (or the OWNER) approved it, and a plan with no member read contacts and
 * wrote money. It now runs as the plan's member (the principal) under planStepRunRefusal, the rule
 * the plan queue applies, before it dispatches. The plugin is driven as KeyActionExecutorService
 * hands it a claimed proposal, with this suite's real orchestrator and PrismaService.
 * Review repairs (CV-13d..CV-13f): only the stored AiPlan id (a column the HTTP route cannot set)
 * names a proposal's member, and a payload.planContext naming a plan the proposal was not filed for
 * is refused (SEC-W4PP-1, CR-W4PP-1); a flow-tool proposal that is no plan step runs only if the
 * member it runs for may run the tool with no principal (SEC-W4PP-2); a plan of the owner by
 * Business.ownerId alone runs with no principal, as the queue runs it (CR-W4PP-2).
 *
 * W4-D93-NO-MEMBER-CONTACTS (FOLLOW5; owner ruling D-93, D-73 as written; review SEC-W3CV-2),
 * CV-08b..CV-08f: a KEY plan with no member principal reads no contacts, so it is refused the tools
 * only the principal's visibility bounds (fetch_client_health, sequence_enroll_overdue,
 * sequence_enroll, the calendar and booking reads), as it is create_followup_queue; CV-08b, which
 * characterized the OWNER's view for such a run, is now that refusal. The Pro Auto monitor and every
 * system-created plan run with the business owner as their member: the monitor runs its reads as the
 * owner and its execution log names the owner; the plans the system writes (a default agent trigger's,
 * a journey's, the daily briefing) record the owner, and such a plan stored with no member (written
 * before D-93) is resolved to the owner when it runs. A trigger a member created that records no
 * creator still fires a plan with no member (D-73). Driven with the real ProAutoMonitorService,
 * AgentTriggerService, DefaultTriggersService, JourneyOrchestratorService and MorningBriefingService
 * against this suite's rows; their planner and event emitter are stand-ins.
 *
 * WHAT IS REAL: PrismaService and the Prisma client against DATABASE_URL; AuthGuard, BusinessGuard,
 * CrmRateLimitGuard and GraphActionsController (POST .../execute: assertMayRunGraphAction, the step
 * claim, the step's stored outcome through PlannerService.updateStepStatus, AiExecutionLogService);
 * FlowOrchestratorService's executeToolDirect / executeToolDirectly / executeTool /
 * executeToolAction (its contactReadAccess); CrmSequenceService (sequence rows, enrolments);
 * QueueService.processPlanStep (the plan-queue worker body, as BullMQ calls it) with the real
 * ActionDispatcherService and plan-step-authority; assertMayRunGraphAction and graphPlanReadScope
 * (POST ai/plans/:planId/approve's rule and the plan read rule).
 * Stand-ins: identity attachment (a test middleware loads the seeded user named by `x-test-user`,
 * as AuthMiddleware does after token verification); the oversight decision (allows: governance is
 * policy, not authority); CrmService.addTask (writes the real ContactTask row and nothing else); the
 * sequence's timeline event writer (no-op); the business graph, intent parser, workspace
 * recommendations, event emitter, state machine and undo (unused on this path or no-op).
 *
 * Fixtures: prefix `v89k_` (registered in test/helpers/fixture-prefixes.json), hard-deleted by raw
 * SQL with sqlLikePrefix() in beforeAll and afterAll. No $transaction wrapping. Cases tagged
 * RED-BEFORE fail on the unmodified code; CONTROL cases pass before and after.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { sqlLikePrefix } from './helpers/sql-like.js';

vi.setConfig({ testTimeout: 30_000 });

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v89k_';
const ID = {
  owner: `${P}owner`, // OWNER of biz and Business.ownerId
  admin: `${P}admin`, // ADMIN of biz, role defaults (every module; another member's PRIVATE contact stays out)
  staffOwned: `${P}staff_owned`, // STAFF of biz: role defaults + crm write, crm_view 'owned' (their own book)
  biz: `${P}biz`,
  cPriv: `${P}c_priv`, // the OWNER's PRIVATE contact (stale lead, top spender, overdue invoice)
  cTeam: `${P}c_team`, // a TEAM contact the OWNER owns (stale lead, overdue invoice)
  cMine: `${P}c_mine`, // a TEAM contact staffOwned owns (stale lead, overdue invoice)
  seqStaff: `${P}seq_staff`,
  seqOwner: `${P}seq_owner`,
  seqQueueStaff: `${P}seq_q_staff`,
  seqQueueNone: `${P}seq_q_none`,
  // Review repairs (SEC-W3CV-1, SEC-W3CV-4): a calendar event and a booking on the OWNER's PRIVATE
  // contact (and an event on staffOwned's own), and the sequences sequence_enroll writes into.
  evPriv: `${P}ev_priv`,
  evMine: `${P}ev_mine`,
  svc: `${P}svc`,
  bkPriv: `${P}bk_priv`,
  seqEnrolStaff: `${P}seq_e_staff`,
  seqEnrolOwner: `${P}seq_e_owner`,
  seqEnrolQueue: `${P}seq_e_queue`,
  // W4-PROPOSAL-PRINCIPAL (D-46): a platform SUPER_ADMIN who is not a member of biz; and the
  // sequences the proposal runs enrol into.
  superAdmin: `${P}super_admin`,
  seqPropStaff: `${P}seq_p_staff`,
  seqPropOwner: `${P}seq_p_owner`,
};
const NAME = { priv: 'V89KPrivate', team: 'V89KTeam', mine: 'V89KMine' };

let db: any;
let app: any;
let prisma: any;
let queue: any;
let assertMayRunGraphAction: (...args: any[]) => Promise<void>;
let graphPlanReadScope: (...args: any[]) => Promise<{ stepOutput: (toolName: string) => boolean }>;
let PLAN_APPROVER_ROLES: ReadonlySet<string>;
let noMemberToolRefusal: (toolName: string) => string | null;
let systemPlanMember: (prisma: unknown, businessId: string, planId: string) => Promise<string | null>;
let planStepRunAuthority: (prisma: unknown, businessId: string, planId: string, toolName: string) => Promise<{ memberId: string | null; refusal: string | null }>;

/** Every tool the plan-queue dispatcher handed the flow orchestrator. */
const dispatched: Array<{ toolName: string; planStepId?: string; principal: unknown }> = [];

/** W4-PROPOSAL-PRINCIPAL: the executor plugin for approved EXECUTE_TOOL proposals, and every tool it handed the orchestrator. */
let proposalExecutor: any;
const proposalDispatched: Array<{ toolName: string; planStepId?: string; principal: unknown; surface?: string }> = [];

/**
 * W4-D93-NO-MEMBER-CONTACTS: the Pro Auto monitor (the real service over an orchestrator whose
 * execution log is the real AiExecutionLogService), every tool the monitor's orchestrator ran (with the
 * member it ran for), the system plan creators, and the member each asked the planner to record.
 */
let monitor: any;
let monitorFlow: any;
const monitorDispatched: Array<{ toolName: string; principal: unknown; onBehalfOf: unknown; surface?: string; result?: unknown }> = [];
let agentTriggers: any;
let defaultTriggers: any;
let journeys: any;
let briefings: any;
let DEFAULT_AGENT_TRIGGERS: ReadonlyArray<{ name: string; eventPattern: string; objective: string; maxRiskTier: number }>;
const plannedFor: Array<{ id?: string; objective: string; rawInput?: string; userId: unknown }> = [];

async function cleanup() {
  for (const sql of [
    `DELETE FROM journey_instances WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM agent_triggers WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM autopilot_settings WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM ai_execution_logs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM ai_plans WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM crm_sequence_enrollments WHERE sequence_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM crm_sequences WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_tasks WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM bookings WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM services WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM calendar_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

let ipSeq = 0;
/** A distinct client address per request, so CrmRateLimitGuard's per-address buckets never cap the suite. */
function nextIp() {
  ipSeq += 1;
  return `10.89.${Math.floor(ipSeq / 250)}.${(ipSeq % 250) + 1}`;
}

/** A plan `userId` proposed, its one step `toolName` with `args` (status 'pending': POST .../execute runs it; 'approved': the queue does). */
async function seedPlan(id: string, userId: string | null, toolName: string, args: Record<string, unknown>, status = 'pending') {
  await db.aiPlan.create({
    data: {
      id, businessId: ID.biz, userId, objective: `v89k ${id}`, status,
      steps: { create: [{ id: `${id}_s1`, order: 1, toolName, action: toolName, module: 'ai', status: 'pending', inputPayload: args }] },
    },
  });
  return `${id}_s1`;
}

/** POST actions/businesses/:businessId/execute for the plan's one step, as `actor`. */
async function executeStep(actor: string, planId: string) {
  const res = await request(app.getHttpServer())
    .post(`/actions/businesses/${ID.biz}/execute`)
    .set('x-test-user', actor)
    .set('x-forwarded-for', nextIp())
    .send({ planId, planStepId: `${planId}_s1` });
  expect(res.status, JSON.stringify(res.body).slice(0, 400)).toBe(201);
  expect(res.body.success, JSON.stringify(res.body).slice(0, 400)).toBe(true);
  return res.body;
}

/** A member proposes a plan with one step of `toolName` and runs it through POST .../execute. */
async function memberExecutes(actor: string, planId: string, toolName: string, args: Record<string, unknown>) {
  await seedPlan(planId, actor, toolName, args);
  const body = await executeStep(actor, planId);
  const step = await db.aiPlanStep.findUnique({ where: { id: `${planId}_s1` }, select: { status: true, outputResult: true } });
  return { body, step };
}

/** Runs the plan-queue worker body on the plan's one step, as BullMQ hands it a job. */
async function runQueueStep(planId: string, toolName: string, args: Record<string, unknown>, stepId = `${planId}_s1`) {
  const job = {
    data: {
      planId, stepId, businessId: ID.biz, toolName, args, order: 1, dependsOn: [], retryCount: 0,
      idempotencyKey: `${planId}_job`, planContext: { planId, planStepId: stepId },
    },
  };
  return queue.processPlanStep(job).then((r: unknown) => ({ ok: true, value: r }), (e: unknown) => ({ ok: false, error: e }));
}

const stepRow = (planId: string) =>
  db.aiPlanStep.findUnique({ where: { id: `${planId}_s1` }, select: { status: true, errorMessage: true, outputResult: true } });

/** What a contact the member may not open must never disclose: its id and its name. */
function expectNoHidden(value: unknown, hidden: Array<'priv' | 'team'> = ['priv', 'team']) {
  const text = JSON.stringify(value ?? null);
  for (const which of hidden) {
    const id = which === 'priv' ? ID.cPriv : ID.cTeam;
    expect(text, `discloses ${id}`).not.toContain(id);
    expect(text, `discloses ${NAME[which]}`).not.toContain(NAME[which]);
  }
}

const sortedIds = (rows: Array<{ contactId: string }>) => rows.map((r) => r.contactId).sort();
const enrolledIn = async (sequenceId: string) =>
  sortedIds(await db.crmSequenceEnrollment.findMany({ where: { sequenceId }, select: { contactId: true } }));
const tasksTitled = async (prefix: string) =>
  sortedIds(await db.contactTask.findMany({ where: { businessId: ID.biz, title: { startsWith: prefix } }, select: { contactId: true } }));
const ALL = [ID.cMine, ID.cPriv, ID.cTeam].sort();

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { Logger, ValidationPipe } = await import('@nestjs/common');
  const { EventEmitter2 } = await import('@nestjs/event-emitter');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { CrmRateLimitGuard } = await import('../src/modules/crm/guards/rate-limit.guard');
  const { defaultScopesForRole } = (await import('../src/core/authority/module-vocabulary')) as any;
  const graphActions = (await import('../src/modules/ai/graph-actions.controller')) as any;
  const { GraphActionsController } = graphActions;
  ({ assertMayRunGraphAction, graphPlanReadScope, PLAN_APPROVER_ROLES } = graphActions);
  ({ noMemberToolRefusal, systemPlanMember, planStepRunAuthority } = (await import('../src/modules/ai/plan-step-authority')) as any);
  const { BusinessGraphService } = await import('../src/modules/ai/business-graph.service');
  const { IntentParserService } = await import('../src/modules/ai/intent-parser.service');
  const { PlannerService } = await import('../src/modules/ai/planner.service');
  const { AiOversightService } = await import('../src/modules/ai/ai-oversight.service');
  const { FlowOrchestratorService } = await import('../src/modules/ai/flow-orchestrator.service');
  const { AiExecutionLogService } = await import('../src/modules/ai/ai-execution-log.service');
  const { WorkspaceRecommendationsService } = await import('../src/modules/ai/workspace-recommendations.service');
  const { ActionDispatcherService } = await import('../src/modules/ai/action-dispatcher.service');
  const { QueueService } = await import('../src/modules/ai/queue.service');
  const { CrmService } = await import('../src/modules/crm/crm.service');
  const { CrmSequenceService } = await import('../src/modules/crm/crm-sequence.service');

  Logger.overrideLogger(false);
  prisma = new PrismaService();
  const quiet = { log() {}, warn() {}, error() {}, debug() {}, verbose() {} };
  const events = { emit: () => true };
  const ALLOW = { allowed: true, tier: 1, reason: 'v89k: allowed', requiresFormalApproval: false, requiresAdminApproval: false, requiresQuickConfirm: false };
  const governance = {
    evaluate: async () => ({ ...ALLOW }),
    evaluateAutoApproval: async () => ({ ...ALLOW, autoApproved: true }),
    getToolTier: () => 1,
  };
  const executionLog = new AiExecutionLogService(prisma);

  // The orchestrator's lazy cross-module edges: the real sequence service; CrmService.addTask
  // writes the real ContactTask row (the task the follow-up queue creates) and nothing else.
  const registry = new Map<unknown, unknown>();
  registry.set(CrmSequenceService, new CrmSequenceService(prisma, { logEvent: async () => undefined } as any));
  registry.set(CrmService, {
    addTask: (input: { businessId: string; contactId: string; title: string; priority?: string; source?: string }) =>
      db.contactTask.create({
        data: { businessId: input.businessId, contactId: input.contactId, title: input.title, priority: input.priority ?? 'NORMAL', source: input.source ?? null },
      }),
  });
  const moduleRef = {
    get(token: any) {
      if (!registry.has(token)) throw new Error(`test moduleRef has no provider for ${token?.name ?? String(token)}`);
      return registry.get(token);
    },
  };
  // The real class: executeToolDirect, executeToolDirectly, executeTool, executeToolAction and
  // contactReadAccess are its own.
  const orchestrator = Object.assign(Object.create(FlowOrchestratorService.prototype), {
    logger: quiet,
    prisma,
    moduleRef,
    governance,
    executionLog: { logToolExecution: async () => undefined, log: async () => undefined },
    businessGraph: { invalidateCache() {} },
  });
  const planner = Object.assign(Object.create(PlannerService.prototype), { prisma, logger: quiet });

  // W5-AGENT-TRIGGERS-AUTHORITY (D-73, D-93): the real AgentController (POST and PUT agent/triggers,
  // AuthGuard and BusinessGuard) over the real PrismaService; its collaborators for routes this suite
  // does not call are inert.
  const { AgentController } = await import('../src/modules/ai/agent.controller');
  const agentControllerOffBoundary = await Promise.all([
    import('../src/modules/ai/agent-state-machine.service').then((m) => m.AgentStateMachineService),
    import('../src/modules/ai/agent-bus.service').then((m) => m.AgentBusService),
    import('../src/modules/ai/pattern-detector.service').then((m) => m.PatternDetectorService),
    import('../src/modules/ai/undo.service').then((m) => m.UndoService),
    import('../src/modules/ai/calendar-intelligence.service').then((m) => m.CalendarIntelligenceService),
    import('../src/modules/ai/document-intelligence.service').then((m) => m.DocumentIntelligenceService),
    import('../src/modules/ai/semantic-memory.service').then((m) => m.SemanticMemoryService),
  ]);

  const testing = await Test.createTestingModule({
    controllers: [GraphActionsController, AgentController],
    providers: [
      ...agentControllerOffBoundary.map((token) => ({ provide: token, useValue: {} })),
      { provide: PrismaService, useValue: prisma },
      AuthGuard,
      BusinessGuard,
      CrmRateLimitGuard,
      { provide: BusinessGraphService, useValue: { invalidateCache() {} } },
      { provide: IntentParserService, useValue: {} },
      { provide: PlannerService, useValue: planner },
      { provide: AiOversightService, useValue: governance },
      { provide: FlowOrchestratorService, useValue: orchestrator },
      { provide: AiExecutionLogService, useValue: executionLog },
      { provide: WorkspaceRecommendationsService, useValue: {} },
      { provide: EventEmitter2, useValue: events },
    ],
  }).compile();

  app = testing.createNestApplication();
  app.getHttpAdapter().getInstance().set('trust proxy', true);
  // Identity attachment only. No guard is overridden.
  app.use(async (req: any, _res: any, next: any) => {
    const header = req.headers['x-test-user'];
    const id = typeof header === 'string' ? header : undefined;
    if (id && id.startsWith(P)) {
      const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
      if (user) req.user = { id: user.id, email: user.email, role: user.role };
    }
    next();
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  await app.init();

  // The ai plan queue: the worker body with the real dispatcher, which hands the real orchestrator
  // the step with no principal (PLAN_QUEUE).
  const flowForQueue = {
    executeToolDirectly: (businessId: string, toolName: string, args: Record<string, unknown>, planContext?: { planStepId: string }, action?: any) => {
      dispatched.push({ toolName, planStepId: planContext?.planStepId, principal: action?.principalUserId });
      return orchestrator.executeToolDirectly(businessId, toolName, args, planContext, action);
    },
  };
  const dispatcher = new ActionDispatcherService(prisma, events as any, executionLog, governance as any, flowForQueue as any, { registerAction: async () => undefined } as any);
  queue = Object.assign(Object.create(QueueService.prototype), {
    prisma, events, governance, executionLog, actionDispatcher: dispatcher, flowOrchestrator: flowForQueue,
    stateMachine: { transition: async () => undefined },
    logger: quiet,
  });

  // W4-PROPOSAL-PRINCIPAL: the real executor plugin for an approved EXECUTE_TOOL proposal, as
  // KeyActionExecutorService hands it a claimed one. Its ModuleRef resolves the real orchestrator
  // (each dispatch recorded with the principal it carries) and the real PrismaService.
  const { KeyCortexActionExecutorPlugin } = await import('../src/modules/key-cortex/key-cortex-action-executor.plugin');
  const flowForProposals = {
    executeToolDirectly: (businessId: string, toolName: string, args: Record<string, unknown>, planContext?: { planStepId: string }, action?: any) => {
      proposalDispatched.push({ toolName, planStepId: planContext?.planStepId, principal: action?.principalUserId, surface: action?.surface });
      return orchestrator.executeToolDirectly(businessId, toolName, args, planContext, action);
    },
  };
  const proposalRef = {
    get(token: any) {
      if (token === FlowOrchestratorService) return flowForProposals;
      if (token === PrismaService) return prisma;
      throw new Error(`test moduleRef has no provider for ${token?.name ?? String(token)}`);
    },
  };
  proposalExecutor = new KeyCortexActionExecutorPlugin({ register() {} } as any, {} as any, proposalRef as any);

  // W4-D93-NO-MEMBER-CONTACTS: the real Pro Auto monitor over the real orchestrator class, whose
  // execution log is the real AiExecutionLogService (the row the monitor's read is attributed on).
  // Each tool the monitor's orchestrator runs is recorded with the member it runs for.
  const { ProAutoMonitorService } = await import('../src/modules/ai/pro-auto-monitor.service');
  monitorFlow = Object.assign(Object.create(FlowOrchestratorService.prototype), {
    logger: quiet,
    prisma,
    moduleRef,
    governance,
    executionLog,
    businessGraph: { invalidateCache() {} },
  });
  const runToolAction = (FlowOrchestratorService.prototype as any).executeToolAction;
  monitorFlow.executeToolAction = async function (businessId: string, toolName: string, args: Record<string, unknown>, action?: any) {
    const call: (typeof monitorDispatched)[number] = { toolName, principal: action?.principalUserId, onBehalfOf: action?.onBehalfOfUserId, surface: action?.surface };
    monitorDispatched.push(call);
    // Review SEC-D93-2: what the tool answered (the owner's view), kept here so a case can tell it from
    // what the monitor stores where every member reads it.
    call.result = await runToolAction.call(this, businessId, toolName, args, action);
    return call.result;
  };
  monitor = new ProAutoMonitorService(prisma, { getSnapshot: async () => ({}) } as any, governance as any, executionLog, monitorFlow);

  // The system plan creators (D-93): the real AgentTriggerService, DefaultTriggersService,
  // JourneyOrchestratorService and MorningBriefingService, with a planner that writes the plan row
  // (no steps) and records the member it was asked to record.
  const { AgentTriggerService } = await import('../src/modules/ai/agent-trigger.service');
  const triggerDefaults = await import('../src/modules/ai/default-triggers.service');
  const { JourneyOrchestratorService } = await import('../src/modules/ai/journey-orchestrator.service');
  const { MorningBriefingService } = await import('../src/modules/ai/morning-briefing.service');
  DEFAULT_AGENT_TRIGGERS = triggerDefaults.DEFAULT_AGENT_TRIGGERS as any;
  let plannedSeq = 0;
  const recordingPlanner = {
    createPlan: async (businessId: string, intent: { objective: string; rawInput?: string; scope?: string[] }, userId?: string) => {
      plannedSeq += 1;
      plannedFor.push({ id: `${P}planned_${plannedSeq}`, objective: intent.objective, rawInput: intent.rawInput, userId });
      return db.aiPlan.create({
        data: { id: `${P}planned_${plannedSeq}`, businessId, userId: userId ?? null, objective: intent.objective, rawInput: intent.rawInput ?? null, scope: intent.scope ?? [], status: 'draft' },
      });
    },
    updateStepStatus: async () => undefined,
  };
  defaultTriggers = new triggerDefaults.DefaultTriggersService(prisma);
  agentTriggers = new AgentTriggerService(
    prisma, events as any, governance as any, recordingPlanner as any, {} as any, executionLog, { handleEvent: async () => [] } as any,
  );
  journeys = new JourneyOrchestratorService(prisma, events as any, recordingPlanner as any, governance as any, {} as any, {} as any);
  briefings = new MorningBriefingService(prisma, events as any, {} as any, recordingPlanner as any, {} as any, governance as any, {} as any);

  await cleanup(); // in case a prior run aborted

  for (const name of ['owner', 'admin', 'staffOwned'] as const) {
    await db.user.create({ data: { id: ID[name], email: `${P}${name}@test.local`, role: 'USER' } });
  }
  // W4-PROPOSAL-PRINCIPAL (D-46): a platform SUPER_ADMIN with no membership in biz.
  await db.user.create({ data: { id: ID.superAdmin, email: `${P}super_admin@test.local`, role: 'SUPER_ADMIN' } });
  await db.business.create({ data: { id: ID.biz, name: 'V89K Biz', ownerId: ID.owner } });
  await db.membership.create({ data: { id: `${P}m_owner`, userId: ID.owner, businessId: ID.biz, role: 'OWNER' } });
  await db.membership.create({ data: { id: `${P}m_admin`, userId: ID.admin, businessId: ID.biz, role: 'ADMIN' } });
  await db.membership.create({
    data: { id: `${P}m_staff_owned`, userId: ID.staffOwned, businessId: ID.biz, role: 'STAFF', permissionScopes: { ...defaultScopesForRole('STAFF'), crm: 'write', crm_view: 'owned' } },
  });

  const contact = (id: string, firstName: string, visibility: string, ownerId: string) =>
    db.contact.create({ data: { id, businessId: ID.biz, firstName, lastName: 'V89K', email: `${P}${id.slice(P.length)}@test.local`, status: 'LEAD', visibility, ownerId } });
  await contact(ID.cPriv, NAME.priv, 'PRIVATE', ID.owner);
  await contact(ID.cTeam, NAME.team, 'TEAM', ID.owner);
  await contact(ID.cMine, NAME.mine, 'TEAM', ID.staffOwned);
  // Every lead is stale (create_followup_queue's default is 14 days without activity).
  await db.$executeRawUnsafe(`UPDATE contacts SET updated_at = now() - interval '40 days' WHERE business_id LIKE ${sqlLikePrefix(P)}`);

  const invoice = (id: string, contactId: string, n: number, status: string, total: number, dueDate?: Date) =>
    db.invoice.create({ data: { id, businessId: ID.biz, contactId, invoiceNumber: `V89K-00${n}`, status, subtotal: total, total, currency: 'TTD', ...(dueDate ? { dueDate } : {}) } });
  // PAID: the OWNER's PRIVATE contact is the top spender.
  await invoice(`${P}inv_paid_priv`, ID.cPriv, 1, 'PAID', 9000);
  await invoice(`${P}inv_paid_team`, ID.cTeam, 2, 'PAID', 500);
  await invoice(`${P}inv_paid_mine`, ID.cMine, 3, 'PAID', 300);
  // SENT and ten days overdue: every contact is a dunning candidate.
  const overdue = new Date(Date.now() - 10 * 86400000);
  await invoice(`${P}inv_due_priv`, ID.cPriv, 4, 'SENT', 200, overdue);
  await invoice(`${P}inv_due_team`, ID.cTeam, 5, 'SENT', 200, overdue);
  await invoice(`${P}inv_due_mine`, ID.cMine, 6, 'SENT', 200, overdue);

  for (const id of [ID.seqStaff, ID.seqOwner, ID.seqQueueStaff, ID.seqQueueNone]) {
    await db.crmSequence.create({
      data: { id, businessId: ID.biz, name: `v89k dunning ${id}`, status: 'active', steps: [{ type: 'email', subject: 'v89k reminder', body: 'v89k', delayDays: 0 }] },
    });
  }

  // Review repairs (SEC-W3CV-1): a meeting on the OWNER's PRIVATE contact (and one on staffOwned's
  // own) tomorrow, and a booking on the PRIVATE contact (its contact's name is in the booking list).
  const tomorrow = new Date(Date.now() + 86400000);
  const event = (id: string, contactId: string, firstName: string) =>
    db.calendarEvent.create({
      data: {
        id, businessId: ID.biz, title: `Meet ${firstName}`, type: 'BOOKING', module: 'BOOKINGS', startAt: tomorrow,
        endAt: new Date(tomorrow.getTime() + 30 * 60_000), visibility: 'TEAM', sourceType: 'test', sourceId: id, contactId,
      },
    });
  await event(ID.evPriv, ID.cPriv, NAME.priv);
  await event(ID.evMine, ID.cMine, NAME.mine);
  await db.service.create({ data: { id: ID.svc, businessId: ID.biz, name: 'V89K consult', duration: 30, price: 100 } });
  await db.booking.create({
    data: { id: ID.bkPriv, businessId: ID.biz, contactId: ID.cPriv, serviceId: ID.svc, startTime: tomorrow, endTime: new Date(tomorrow.getTime() + 30 * 60_000) },
  });
}, 180_000);

afterAll(async () => {
  if (db) await cleanup();
  if (app) await app.close();
});

describe('fixture sanity (real rows)', () => {
  it("biz has its OWNER, an ADMIN, a STAFF member kept to their own book, three stale leads with overdue invoices (one the OWNER's PRIVATE top spender) and four active sequences", async () => {
    expect(await db.contact.count({ where: { businessId: ID.biz, status: 'LEAD', updatedAt: { lt: new Date(Date.now() - 14 * 86400000) } } })).toBe(3);
    expect(await db.invoice.count({ where: { businessId: ID.biz, status: 'SENT' } })).toBe(3);
    expect(await db.crmSequence.count({ where: { businessId: ID.biz, status: 'active' } })).toBe(4);
    const staff = await db.membership.findUnique({ where: { id: `${P}m_staff_owned` }, select: { permissionScopes: true } });
    expect(staff.permissionScopes).toMatchObject({ crm: 'write', crm_view: 'owned' });
  });
});

describe('W3-KEY-CRM-VISIBILITY (D-37): POST graph actions execute runs the CRM tools for the calling member, over the contacts they may open', () => {
  it("CV-01 RED-BEFORE (D-37): create_followup_queue for a STAFF member kept to their own book queues a follow-up only on their own stale lead: no task on the OWNER's PRIVATE or TEAM contact, neither named in the answer nor in the stored step output", async () => {
    const { body, step } = await memberExecutes(ID.staffOwned, `${P}cv01`, 'create_followup_queue', { taskTitle: 'v89k cv01 {name}' });
    expect(await tasksTitled('v89k cv01')).toEqual([ID.cMine]);
    expect(body.result.created).toBe(1);
    expect(sortedIds(body.result.contacts)).toEqual([ID.cMine]);
    expectNoHidden(body);
    expect(step.status).toBe('completed');
    expectNoHidden(step.outputResult);
  });

  it("CV-02 RED-BEFORE (D-37): sequence_enroll_overdue for the same member enrols only their own overdue contact: the OWNER's PRIVATE and TEAM contacts are not enrolled", async () => {
    const { body } = await memberExecutes(ID.staffOwned, `${P}cv02`, 'sequence_enroll_overdue', { sequenceId: ID.seqStaff });
    expect(await enrolledIn(ID.seqStaff)).toEqual([ID.cMine]);
    expect(body.result.enrolled).toBe(1);
  });

  it('CV-03 CONTROL (D-37, V1-84 pin): segment_contacts for the same member answers only their own contact', async () => {
    const { body, step } = await memberExecutes(ID.staffOwned, `${P}cv03`, 'segment_contacts', { name: 'v89k all' });
    expect(sortedIds((body.result.contacts as Array<{ id: string }>).map((c) => ({ contactId: c.id })))).toEqual([ID.cMine]);
    expect(body.result.matchedCount).toBe(1);
    expectNoHidden(body);
    expectNoHidden(step.outputResult);
  });

  it("CV-04 CONTROL (D-37, V1-84 pin): fetch_client_health for the same member counts and names only their own contact: no hidden contact's name or id in the answer or the stored step output", async () => {
    const { body, step } = await memberExecutes(ID.staffOwned, `${P}cv04`, 'fetch_client_health', {});
    expect(body.result.totalContacts).toBe(1);
    expect((body.result.topSpenders as Array<{ contactId: string; name: string }>).map((s) => s.contactId)).toEqual([ID.cMine]);
    expectNoHidden(body);
    expectNoHidden(step.outputResult);
  });

  it("CV-05 CONTROL (D-37): the OWNER's runs cover the whole book: follow-ups on every stale lead, every overdue contact enrolled, every contact segmented, the PRIVATE top spender named", async () => {
    const followups = await memberExecutes(ID.owner, `${P}cv05_fq`, 'create_followup_queue', { taskTitle: 'v89k cv05 {name}' });
    expect(await tasksTitled('v89k cv05')).toEqual(ALL);
    expect(followups.body.result.created).toBe(3);
    const enrol = await memberExecutes(ID.owner, `${P}cv05_seq`, 'sequence_enroll_overdue', { sequenceId: ID.seqOwner });
    expect(await enrolledIn(ID.seqOwner)).toEqual(ALL);
    expect(enrol.body.result.enrolled).toBe(3);
    const segment = await memberExecutes(ID.owner, `${P}cv05_seg`, 'segment_contacts', { name: 'v89k all' });
    expect(segment.body.result.matchedCount).toBe(3);
    const health = await memberExecutes(ID.owner, `${P}cv05_health`, 'fetch_client_health', {});
    expect(health.body.result.totalContacts).toBe(3);
    expect(health.body.result.topSpenders[0]).toMatchObject({ contactId: ID.cPriv, name: `${NAME.priv} V89K` });
  });
});

describe("W3-KEY-CRM-VISIBILITY (D-37, D-88, D-93): a member's plan run with no principal is the OWNER's only for these tools; a plan with no member reads no contacts (D-73)", () => {
  /** The tools only the principal's visibility bounds (GRAPH_ACTION_VISIBILITY_BOUND_TOOLS): with no member principal they read no contacts (D-93). */
  const D93_VISIBILITY_BOUND = ['fetch_client_health', 'sequence_enroll_overdue', 'sequence_enroll', 'calendar_list_events', 'calendar_check_conflicts', 'bookings_list_bookings', 'bookings_list_waitlist'];

  it("CV-06 RED-BEFORE (D-37): a STAFF member's plan with fetch_client_health or sequence_enroll_overdue is refused by the queue worker at run time (it would run with no principal, in the OWNER's view): nothing dispatched, no hidden contact named, nobody enrolled", async () => {
    const health = `${P}cv06_health`;
    await seedPlan(health, ID.staffOwned, 'fetch_client_health', {}, 'approved');
    await runQueueStep(health, 'fetch_client_health', {});
    expect(dispatched.filter((d) => d.planStepId === `${health}_s1`)).toEqual([]);
    const healthRow = await stepRow(health);
    expect(healthRow.status).toBe('failed');
    expect(String(healthRow.errorMessage)).toMatch(/^Refused: .*business owner/);
    expectNoHidden(healthRow.outputResult);

    const enrol = `${P}cv06_seq`;
    await seedPlan(enrol, ID.staffOwned, 'sequence_enroll_overdue', { sequenceId: ID.seqQueueStaff }, 'approved');
    await runQueueStep(enrol, 'sequence_enroll_overdue', { sequenceId: ID.seqQueueStaff });
    expect(dispatched.filter((d) => d.planStepId === `${enrol}_s1`)).toEqual([]);
    expect((await stepRow(enrol)).status).toBe('failed');
    expect(await enrolledIn(ID.seqQueueStaff)).toEqual([]);
  });

  it("CV-07 RED-BEFORE (D-37): POST ai/plans/:planId/approve's rule (no principal) refuses fetch_client_health and sequence_enroll_overdue to an ADMIN and to the STAFF member, the OWNER may; the plans read shows their stored output to the OWNER only", async () => {
    const opts = { proposerOverrideRoles: PLAN_APPROVER_ROLES, noPrincipal: true };
    const adminRead = await graphPlanReadScope(prisma, ID.biz, { id: ID.admin, role: 'USER' });
    const ownerRead = await graphPlanReadScope(prisma, ID.biz, { id: ID.owner, role: 'USER' });
    for (const tool of ['fetch_client_health', 'sequence_enroll_overdue']) {
      for (const member of [ID.admin, ID.staffOwned]) {
        const err = await assertMayRunGraphAction(prisma, ID.biz, { id: member, role: 'USER' }, tool, member, opts).then(() => null, (e: unknown) => e);
        expect(err, `${tool} ${member}`).toBeInstanceOf(ForbiddenException);
      }
      await expect(assertMayRunGraphAction(prisma, ID.biz, { id: ID.owner, role: 'USER' }, tool, ID.owner, opts)).resolves.toBeUndefined();
      expect(adminRead.stepOutput(tool), tool).toBe(false);
      expect(ownerRead.stepOutput(tool), tool).toBe(true);
    }
    // With the caller as principal (POST .../execute) the member still runs them, bounded by their view.
    await expect(assertMayRunGraphAction(prisma, ID.biz, { id: ID.staffOwned, role: 'USER' }, 'fetch_client_health', ID.staffOwned)).resolves.toBeUndefined();
    await expect(assertMayRunGraphAction(prisma, ID.biz, { id: ID.staffOwned, role: 'USER' }, 'sequence_enroll_overdue', ID.staffOwned)).resolves.toBeUndefined();
  });

  it("CV-08 CONTROL (D-88): the OWNER's plan runs fetch_client_health on the queue over the whole book (the PRIVATE top spender named)", async () => {
    const owner = `${P}cv08_owner`;
    await seedPlan(owner, ID.owner, 'fetch_client_health', {}, 'approved');
    await runQueueStep(owner, 'fetch_client_health', {});
    const ownerRow = await stepRow(owner);
    expect(ownerRow.status, String(ownerRow.errorMessage)).toBe('completed');
    expect(JSON.stringify(ownerRow.outputResult)).toContain(NAME.priv);
  });

  // Review SEC-W3CV-2, settled by owner ruling D-93: D-73 stands as written, so a plan with no member
  // principal reads no contacts, these tools included (CV-08b was a characterization of the OWNER's
  // view such a run had). The Pro Auto monitor and the system-created plans run as the business owner
  // instead (CV-08d..CV-08f).
  it("CV-08b RED-BEFORE (W4-D93-NO-MEMBER-CONTACTS; D-93, D-73; review SEC-W3CV-2): a plan with no member that no system wrote is refused fetch_client_health and sequence_enroll_overdue by the queue worker at run time: nothing dispatched, no hidden contact named, nobody enrolled", async () => {
    expect(String(noMemberToolRefusal('fetch_client_health'))).toMatch(/no member principal reads no contacts/);
    expect(String(noMemberToolRefusal('sequence_enroll_overdue'))).toMatch(/no member principal reads no contacts/);
    const none = `${P}cv08_none`;
    await seedPlan(none, null, 'fetch_client_health', {}, 'approved');
    await runQueueStep(none, 'fetch_client_health', {});
    expect(dispatched.filter((d) => d.planStepId === `${none}_s1`)).toEqual([]);
    const noneRow = await stepRow(none);
    expect(noneRow.status).toBe('failed');
    expect(String(noneRow.errorMessage)).toMatch(/^Refused: .*no member/);
    expectNoHidden(noneRow.outputResult);

    const noneSeq = `${P}cv08_none_seq`;
    await seedPlan(noneSeq, null, 'sequence_enroll_overdue', { sequenceId: ID.seqQueueNone }, 'approved');
    await runQueueStep(noneSeq, 'sequence_enroll_overdue', { sequenceId: ID.seqQueueNone });
    expect(dispatched.filter((d) => d.planStepId === `${noneSeq}_s1`)).toEqual([]);
    expect((await stepRow(noneSeq)).status).toBe('failed');
    expect(await enrolledIn(ID.seqQueueNone)).toEqual([]);
  });

  it("CV-08c RED-BEFORE (W4-D93-NO-MEMBER-CONTACTS; D-93, D-73; review SEC-W3CV-2): with no member principal fetch_client_health, sequence_enroll_overdue, sequence_enroll and the calendar and booking reads are refused as contact reads, as create_followup_queue is; a plan with no member is refused calendar_list_events and bookings_list_bookings on the queue; the Pro Auto monitor run for no member is refused fetch_client_health before it runs", async () => {
    for (const tool of [...D93_VISIBILITY_BOUND, 'create_followup_queue']) {
      expect(String(noMemberToolRefusal(tool)), tool).toMatch(/reads the business's contacts.*no member principal reads no contacts/);
    }
    for (const tool of ['calendar_list_events', 'bookings_list_bookings']) {
      const planId = `${P}cv08c_${tool}`;
      await seedPlan(planId, null, tool, {}, 'approved');
      await runQueueStep(planId, tool, {});
      expect(dispatched.filter((d) => d.planStepId === `${planId}_s1`), tool).toEqual([]);
      const row = await stepRow(planId);
      expect(row.status, tool).toBe('failed');
      expect(String(row.errorMessage), tool).toMatch(/^Refused: .*no member/);
      expectNoHidden(row.outputResult, ['priv']);
    }
    const from = monitorDispatched.length;
    const result = await monitorFlow.autoExecuteToolForMonitoring(ID.biz, 'fetch_client_health', { businessId: ID.biz });
    expect(result).toMatchObject({ success: false, blocked: true });
    expect(String(result.error)).toMatch(/no member/);
    expect(monitorDispatched.slice(from)).toEqual([]);
    expectNoHidden(result, ['priv']);
  });
});

describe('W4-D93-NO-MEMBER-CONTACTS (D-93, D-73): the Pro Auto monitor and every system-created plan run with the business owner as their member', () => {
  /** A plan stored with no member and one crm_list_contacts step, approved, as a system writer left it before D-93. */
  const seedMemberless = (id: string, data: Record<string, unknown>) =>
    db.aiPlan.create({
      data: {
        id, businessId: ID.biz, userId: null, status: 'approved', ...data,
        steps: { create: [{ id: `${id}_s1`, order: 1, toolName: 'crm_list_contacts', action: 'crm_list_contacts', module: 'ai', status: 'pending', inputPayload: { limit: 50 } }] },
      },
    });

  // The owner rides as the member the call is run for (onBehalfOfUserId), not as its principal: the
  // monitor authenticates no human, so the action boundary must not take a write it adopted as one a
  // trusted principal asked for (control-clearance: no principal, a human approves).
  // Review SEC-D93-2: what the monitor runs for the owner answers in the owner's view, and the monitor
  // keeps it where every member reads it: the cached insight (GET ai/monitoring/insights) and the
  // execution log row (GET ai/execution-logs). Neither keeps a tool's input or output that only the
  // owner's membership let it run (one D-73 refuses a run with no member).
  it("CV-08d RED-BEFORE (W4-D93-NO-MEMBER-CONTACTS; D-93; review SEC-D93-2): the Pro Auto monitor runs as the business owner: ProAutoMonitorService.escalateInsights runs fetch_client_health over the owner's view (the PRIVATE top spender named in what the tool answered), handed to the orchestrator on the owner's behalf (no authenticated principal); its execution log row is attributed to the owner, and neither that row nor the cached insight every member reads names the PRIVATE contact", async () => {
    const from = monitorDispatched.length;
    const insight: any = {
      id: `${P}cv08d`, category: 'client_risk', severity: 'warning', title: 'v89k clients at risk', description: 'v89k cv08d',
      suggestedTool: 'fetch_client_health', riskTier: 1, module: 'crm', timestamp: new Date().toISOString(),
    };
    await monitor.escalateInsights(ID.biz, [insight], { mode: 'pro_auto', maxAutoTier: 2 });
    expect(insight.autoExecuteResult, JSON.stringify(insight.autoExecuteResult ?? null).slice(0, 400)).toEqual({ success: true });
    expectNoHidden(insight);
    const calls = monitorDispatched.slice(from);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ toolName: 'fetch_client_health', surface: 'PRO_AUTO_MONITOR', onBehalfOf: ID.owner });
    expect(calls[0].principal ?? null).toBeNull();
    expect(JSON.stringify(calls[0].result)).toContain(NAME.priv);
    const logged = await db.aiExecutionLog.findFirst({
      where: { businessId: ID.biz, toolName: 'fetch_client_health', mode: 'pro_auto', success: true },
      orderBy: { createdAt: 'desc' },
      select: { userId: true, inputSummary: true, outputSummary: true },
    });
    expect(logged?.userId).toBe(ID.owner);
    expectNoHidden(logged);
  });

  it("CV-08g RED-BEFORE (W4-D93-NO-MEMBER-CONTACTS; D-93; review SEC-D93-2): the monitor's draft_followup_message for the stalest lead (the OWNER's PRIVATE contact) runs as the owner, but GET ai/monitoring/insights' cached insight and the execution log row name neither that contact nor its id", async () => {
    await db.$executeRawUnsafe(`UPDATE contacts SET updated_at = now() - interval '90 days' WHERE id = '${ID.cPriv}'`);
    const ai = monitorFlow.aiUsage;
    monitorFlow.aiUsage = { callAi: async () => ({ content: JSON.stringify({ subject: 'v89k cv08g', body: 'v89k cv08g draft', callToAction: 'v89k' }) }) };
    try {
      const from = monitorDispatched.length;
      const insight: any = {
        id: `${P}cv08g`, category: 'stale_leads', severity: 'warning', title: 'v89k stale leads', description: 'v89k cv08g',
        suggestedTool: 'draft_followup_message', riskTier: 1, module: 'crm', timestamp: new Date().toISOString(),
      };
      monitor.insightCache.set(ID.biz, { insights: [insight], expiresAt: Date.now() + 600_000 });
      await monitor.escalateInsights(ID.biz, await monitor.scanInsights(ID.biz), { mode: 'pro_auto', maxAutoTier: 2 });
      const calls = monitorDispatched.slice(from);
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ toolName: 'draft_followup_message', surface: 'PRO_AUTO_MONITOR', onBehalfOf: ID.owner });
      expect(JSON.stringify(calls[0].result)).toContain(NAME.priv);
      const served = await monitor.scanInsights(ID.biz);
      expect(served[0].autoExecuteResult).toEqual({ success: true });
      expectNoHidden(served, ['priv']);
      const logged = await db.aiExecutionLog.findFirst({
        where: { businessId: ID.biz, toolName: 'draft_followup_message', mode: 'pro_auto', success: true },
        orderBy: { createdAt: 'desc' },
        select: { userId: true, inputSummary: true, outputSummary: true },
      });
      expect(logged?.userId).toBe(ID.owner);
      expectNoHidden(logged, ['priv']);
    } finally {
      monitorFlow.aiUsage = ai;
      monitor.insightCache.delete(ID.biz);
      await db.$executeRawUnsafe(`UPDATE contacts SET updated_at = now() - interval '40 days' WHERE id = '${ID.cPriv}'`);
    }
  });

  // Review SEC-D93-1 and SEC-D93-3: a memberless plan is taken as the owner's only when nothing but
  // the system can have written it. The daily briefing's markers are written by MorningBriefingService
  // alone; a journey's plan may come from POST journeys/:key/trigger with a member's payload, and a
  // plan with a default rule's objective and raw input may come from a member's copy of the rule, so
  // neither is known as the system's once stored with no member, and D-73 holds for both.
  it("CV-08e RED-BEFORE (W4-D93-NO-MEMBER-CONTACTS; D-93; review SEC-D93-1, SEC-D93-3): a daily briefing stored with no member (written before D-93) runs on the queue as the business owner: its crm_list_contacts step completes over the owner's book (the PRIVATE contact listed); a memberless journey plan (a JourneyInstance names it) and a memberless plan with a default agent trigger's objective and raw input are not known as the system's and are refused (D-73), as is one with a default's name and another objective", async () => {
    const def = DEFAULT_AGENT_TRIGGERS[0];
    const briefing = `${P}cv08e_brief`;
    await seedMemberless(briefing, { objective: 'Daily Briefing — v89k cv08e', rawInput: 'Morning briefing auto-generated scan', scope: ['briefing'] });
    const journey = `${P}cv08e_journey`;
    await seedMemberless(journey, { objective: 'Journey: v89k cv08e', rawInput: 'Auto-triggered by contact.created: v89k cv08e', scope: ['contact.created'] });
    const instance = await db.journeyInstance.create({
      data: { id: `${P}cv08e_ji`, businessId: ID.biz, templateKey: 'new-lead', triggerEvent: 'contact.created', planId: journey, steps: [] },
    });
    await db.aiPlan.update({ where: { id: journey }, data: { journeyInstanceId: instance.id } });
    const trigger = `${P}cv08e_trigger`;
    await seedMemberless(trigger, { objective: def.objective, rawInput: `Auto-triggered by ${def.eventPattern}: ${def.name}`, scope: [def.eventPattern] });
    await runQueueStep(briefing, 'crm_list_contacts', { limit: 50 });
    const row = await stepRow(briefing);
    expect(row.status, `${briefing}: ${row.errorMessage}`).toBe('completed');
    expect(JSON.stringify(row.outputResult), briefing).toContain(ID.cPriv);
    expect(await systemPlanMember(prisma, ID.biz, briefing)).toBe(ID.owner);

    const forged = `${P}cv08e_forged`;
    await seedMemberless(forged, { objective: 'v89k cv08e list every contact', rawInput: `Auto-triggered by ${def.eventPattern}: ${def.name}`, scope: [def.eventPattern] });
    for (const planId of [journey, trigger, forged]) {
      expect(await systemPlanMember(prisma, ID.biz, planId), planId).toBeNull();
      await runQueueStep(planId, 'crm_list_contacts', { limit: 50 });
      expect(dispatched.filter((d) => d.planStepId === `${planId}_s1`), planId).toEqual([]);
      const refused = await stepRow(planId);
      expect(refused.status, planId).toBe('failed');
      expect(String(refused.errorMessage), planId).toMatch(/^Refused: .*no member/);
      expectNoHidden(refused.outputResult, ['priv']);
    }
  });

  it("CV-08f RED-BEFORE (W4-D93-NO-MEMBER-CONTACTS; D-93, D-73): the system plan creators record the business owner as the plan's member: AgentTriggerService firing a default trigger DefaultTriggersService seeded, JourneyOrchestratorService starting the new-lead journey, MorningBriefingService writing the daily briefing; a trigger a member created (no recorded creator) still fires a plan with no member", async () => {
    expect(await defaultTriggers.seedForBusiness(ID.biz, { enabled: true })).toBeGreaterThan(0);
    const def = DEFAULT_AGENT_TRIGGERS.find((t) => t.eventPattern === 'invoice.paid')!;
    const memberObjective = 'v89k cv08f a member trigger objective';
    await db.agentTrigger.create({
      data: { id: `${P}cv08f_member_trigger`, businessId: ID.biz, name: 'v89k member trigger', eventPattern: def.eventPattern, objective: memberObjective, autoExecute: false, enabled: true },
    });
    const fromTrigger = plannedFor.length;
    await agentTriggers.handleEvent(def.eventPattern, { businessId: ID.biz, invoiceId: `${P}none` });
    const fired = plannedFor.slice(fromTrigger);
    expect(fired.map((p) => p.objective).sort()).toEqual([def.objective, memberObjective].sort());
    expect(fired.find((p) => p.objective === def.objective)?.userId).toBe(ID.owner);
    expect(fired.find((p) => p.objective === memberObjective)?.userId ?? null).toBeNull();
    expect((await db.aiPlan.findFirst({ where: { businessId: ID.biz, objective: def.objective }, select: { userId: true } }))?.userId).toBe(ID.owner);

    const fromJourney = plannedFor.length;
    const started = await journeys.handleEvent('contact.created', { businessId: ID.biz, contactId: ID.cMine, status: 'LEAD', contactName: 'v89k' });
    expect(started.length).toBeGreaterThan(0);
    const journeyPlans = plannedFor.slice(fromJourney);
    expect(journeyPlans.length).toBeGreaterThan(0);
    for (const p of journeyPlans) expect(p.userId, p.objective).toBe(ID.owner);

    const brief = await briefings.generateBriefing(ID.biz);
    expect(brief?.planId).toBeTruthy();
    expect((await db.aiPlan.findUnique({ where: { id: brief.planId }, select: { userId: true } }))?.userId).toBe(ID.owner);
  });

  // Review SEC-D93-1: POST businesses/:businessId/journeys/:key/trigger (AuthGuard and BusinessGuard
  // only) calls executeJourney with the client's body.payload, which becomes the steps' arguments. A
  // journey a member's payload shapes is not system-created: executeJourney records no member unless
  // its caller names one, and only handleEvent (an event the system emitted) names the owner.
  it("CV-08h RED-BEFORE (W4-D93-NO-MEMBER-CONTACTS; D-93, D-73; review SEC-D93-1): a journey started with a payload a member wrote (executeJourney with no member, as POST journeys/:key/trigger calls it) records no member: its auto-approved create_followup_queue step is refused on the queue (no task written, no hidden contact named) and the post-booking journey's commerce_create_invoice on the OWNER's PRIVATE contact is refused (D-73); a system event (handleEvent) still records the owner", async () => {
    const { getJourneyTemplate } = await import('../src/modules/ai/journey-templates');
    const tasksBefore = await db.contactTask.count({ where: { businessId: ID.biz } });

    const fromLead = plannedFor.length;
    const lead = await journeys.executeJourney(ID.biz, getJourneyTemplate('new-lead'), { status: 'LEAD', contactId: ID.cPriv });
    expect(lead?.planId).toBeTruthy();
    expect(plannedFor.slice(fromLead).map((p) => p.userId ?? null)).toEqual([null]);
    const leadPlan = await db.aiPlan.findUnique({ where: { id: lead.planId }, select: { userId: true, status: true } });
    expect(leadPlan).toEqual({ userId: null, status: 'approved' });
    expect(await systemPlanMember(prisma, ID.biz, lead.planId)).toBeNull();
    const queueStep = await db.aiPlanStep.findFirst({ where: { planId: lead.planId, toolName: 'create_followup_queue' }, select: { id: true, inputPayload: true } });
    await runQueueStep(lead.planId, 'create_followup_queue', queueStep.inputPayload, queueStep.id);
    expect(dispatched.filter((d) => d.planStepId === queueStep.id)).toEqual([]);
    const queueRow = await db.aiPlanStep.findUnique({ where: { id: queueStep.id }, select: { status: true, errorMessage: true, outputResult: true } });
    expect(queueRow.status).toBe('failed');
    expect(String(queueRow.errorMessage)).toMatch(/^Refused: .*reads the business's contacts.*no member/);
    expectNoHidden(queueRow.outputResult);
    expect(await db.contactTask.count({ where: { businessId: ID.biz } })).toBe(tasksBefore);

    const booking = await journeys.executeJourney(ID.biz, getJourneyTemplate('post-booking'), { contactId: ID.cPriv, amount: 10 });
    expect((await db.aiPlan.findUnique({ where: { id: booking.planId }, select: { userId: true } }))?.userId ?? null).toBeNull();
    const money = await planStepRunAuthority(prisma, ID.biz, booking.planId, 'commerce_create_invoice');
    expect(money.memberId).toBeNull();
    expect(String(money.refusal)).toMatch(/writes the business's money or invoices.*D-73/);

    const fromEvent = plannedFor.length;
    await journeys.handleEvent('contact.created', { businessId: ID.biz, contactId: ID.cMine, status: 'LEAD' });
    const evented = plannedFor.slice(fromEvent);
    expect(evented.length).toBeGreaterThan(0);
    for (const p of evented) expect(p.userId, p.objective).toBe(ID.owner);
  });

  // Review SEC-D93-1: GET businesses/:businessId/journeys/:instanceId (AuthGuard and BusinessGuard
  // only) answered the journey's plan with every step's stored input and output, whoever asked. A
  // journey the system ran as the owner stores the owner's view there.
  it("CV-08i RED-BEFORE (W4-D93-NO-MEMBER-CONTACTS; D-93, D-74; review SEC-D93-1): getJourneyInstance does not answer an owner-run journey step's input or output to a reader it cannot judge (no viewer: what GET journeys/:instanceId passes), nor to the STAFF member or the ADMIN who may not open the OWNER's PRIVATE contact (the plan read rule, D-74); the OWNER reads it", async () => {
    const planId = `${P}cv08i_plan`;
    await db.aiPlan.create({
      data: {
        id: planId, businessId: ID.biz, userId: ID.owner, status: 'completed', objective: 'Journey: v89k cv08i', rawInput: 'Auto-triggered by contact.created: v89k cv08i', scope: ['contact.created'],
        steps: {
          create: [{
            id: `${planId}_s1`, order: 1, toolName: 'create_followup_queue', action: 'create_followup_queue', module: 'organize', status: 'completed',
            inputPayload: { contactId: ID.cPriv },
            outputResult: { queued: [{ contactId: ID.cPriv, name: `${NAME.priv} V89K` }, { contactId: ID.cTeam, name: `${NAME.team} V89K` }] },
          }],
        },
      },
    });
    const instance = await db.journeyInstance.create({
      data: { id: `${P}cv08i_ji`, businessId: ID.biz, templateKey: 'new-lead', triggerEvent: 'contact.created', planId, steps: [] },
    });

    const unjudged = await journeys.getJourneyInstance(instance.id, ID.biz);
    expect(unjudged?.id).toBe(instance.id);
    expect(unjudged.plan.steps).toHaveLength(1);
    expect(unjudged.plan.steps[0]).toMatchObject({ status: 'completed', inputPayload: null, outputResult: null });
    expectNoHidden(unjudged);

    const staff = await journeys.getJourneyInstance(instance.id, ID.biz, { id: ID.staffOwned, role: 'USER' });
    expect(staff?.id).toBe(instance.id);
    expectNoHidden(staff);
    const admin = await journeys.getJourneyInstance(instance.id, ID.biz, { id: ID.admin, role: 'USER' });
    expectNoHidden(admin, ['priv']);
    const owner = await journeys.getJourneyInstance(instance.id, ID.biz, { id: ID.owner, role: 'USER' });
    expect(JSON.stringify(owner.plan.steps)).toContain(NAME.priv);
    expect(await journeys.getJourneyInstance(instance.id, `${P}other_biz`)).toBeNull();
  });

  // Review SEC-D93-3: a member's rule is the system's only when it is the seeded rule word for word:
  // name, event, objective and condition, at no higher risk tier. A copy that differs in any of them
  // fires a plan with no member, and no plan stored with no member is taken as a default rule's at
  // run time (CV-08e), so the tier guard holds.
  it("CV-08j RED-BEFORE (W4-D93-NO-MEMBER-CONTACTS; D-93, D-73; review SEC-D93-3): a member's copy of a default rule at a higher risk tier, or with another condition, fires a plan with no member, whose crm_list_contacts step is refused on the queue (D-73): no hidden contact listed", async () => {
    const paid = DEFAULT_AGENT_TRIGGERS.find((t) => t.eventPattern === 'invoice.paid')!;
    const lead = DEFAULT_AGENT_TRIGGERS.find((t) => t.eventPattern === 'contact.created')!;
    expect(paid.maxRiskTier).toBe(1);
    // Only the copies fire here: the rules seeded earlier (CV-08f) are switched off.
    await db.agentTrigger.updateMany({ where: { businessId: ID.biz }, data: { enabled: false } });
    await db.agentTrigger.create({
      data: { id: `${P}cv08j_tier`, businessId: ID.biz, name: paid.name, eventPattern: paid.eventPattern, objective: paid.objective, maxRiskTier: 2, autoExecute: true, enabled: true },
    });
    await db.agentTrigger.create({
      data: { id: `${P}cv08j_cond`, businessId: ID.biz, name: lead.name, eventPattern: lead.eventPattern, objective: lead.objective, maxRiskTier: lead.maxRiskTier, autoExecute: true, enabled: true },
    });
    try {
      for (const [event, payload] of [
        [paid.eventPattern, { businessId: ID.biz, invoiceId: `${P}none` }],
        [lead.eventPattern, { businessId: ID.biz, contactId: ID.cMine, status: 'CLIENT' }],
      ] as const) {
        const from = plannedFor.length;
        await agentTriggers.handleEvent(event, payload);
        const fired = plannedFor.slice(from);
        expect(fired, event).toHaveLength(1);
        expect(fired[0].userId ?? null, event).toBeNull();
        const planId = fired[0].id!;
        expect(await db.aiPlan.findUnique({ where: { id: planId }, select: { userId: true, status: true } }), event).toEqual({ userId: null, status: 'approved' });
        await db.aiPlanStep.create({
          data: { id: `${planId}_s1`, planId, order: 1, toolName: 'crm_list_contacts', action: 'crm_list_contacts', module: 'ai', status: 'pending', inputPayload: { limit: 50 } },
        });
        await runQueueStep(planId, 'crm_list_contacts', { limit: 50 });
        expect(dispatched.filter((d) => d.planStepId === `${planId}_s1`), event).toEqual([]);
        const row = await stepRow(planId);
        expect(row.status, event).toBe('failed');
        expect(String(row.errorMessage), event).toMatch(/^Refused: .*no member/);
        expectNoHidden(row.outputResult);
      }
    } finally {
      await db.agentTrigger.deleteMany({ where: { id: { in: [`${P}cv08j_tier`, `${P}cv08j_cond`] } } });
    }
  });

  // W5-AGENT-TRIGGERS-AUTHORITY (owner rulings D-73, D-93; review SEC-D93-3, the CV-08m residual): POST
  // and PUT agent/triggers (AuthGuard and BusinessGuard only) let any member switch on a seeded default
  // rule or write it word for word, and a default rule's plans run as the business owner (D-93), so a
  // STAFF member could make owner-run plans. Only the owner switches on, switches off or edits a rule
  // that runs as the owner; a rule a member writes records that member (D-73) and is never the system's.
  describe('W5-AGENT-TRIGGERS-AUTHORITY (D-73, D-93): only the owner turns on or edits an owner-run default trigger', () => {
    const triggerUrl = (id?: string) => `/ai/businesses/${ID.biz}/agent/triggers${id ? `/${id}` : ''}`;
    const paidDefault = () => DEFAULT_AGENT_TRIGGERS.find((t) => t.eventPattern === 'invoice.paid')!;
    /** The seeded 'Payment Received' rule, every rule of biz switched off first so only the rule a case switches on fires. */
    async function seededPaidRule() {
      await defaultTriggers.seedForBusiness(ID.biz);
      await db.agentTrigger.updateMany({ where: { businessId: ID.biz }, data: { enabled: false } });
      const def = paidDefault();
      const row = await db.agentTrigger.findFirst({ where: { businessId: ID.biz, name: def.name, eventPattern: def.eventPattern, objective: def.objective } });
      expect(row, 'the seeded default rule').toBeTruthy();
      return row;
    }
    /** The members AgentTriggerService records on the plans it writes for an invoice.paid event. */
    async function firePaid() {
      const from = plannedFor.length;
      await agentTriggers.handleEvent('invoice.paid', { businessId: ID.biz, invoiceId: `${P}none` });
      return plannedFor.slice(from).map((p) => ({ objective: p.objective, userId: p.userId ?? null }));
    }

    it("CV-08m RED-BEFORE (W5-AGENT-TRIGGERS-AUTHORITY; D-93, D-73; review SEC-D93-3): PUT agent/triggers answers 403 to the STAFF member and the ADMIN who switch on, switch off or edit a seeded default rule (it stays as seeded and fires nothing); the OWNER switching it on still fires its plan as the business owner", async () => {
      const seeded = await seededPaidRule();
      const def = paidDefault();
      try {
        for (const [actor, body] of [
          [ID.staffOwned, { enabled: true }],
          [ID.staffOwned, { enabled: true, objective: def.objective, maxRiskTier: 1 }],
          [ID.admin, { enabled: true }],
          [ID.admin, { autoExecute: false }],
        ] as const) {
          const res = await request(app.getHttpServer()).put(triggerUrl(seeded.id)).set('x-test-user', actor).send(body);
          expect(res.status, `${actor} ${JSON.stringify(body)}: ${JSON.stringify(res.body).slice(0, 300)}`).toBe(403);
        }
        const after = await db.agentTrigger.findUnique({ where: { id: seeded.id } });
        expect({ enabled: after.enabled, autoExecute: after.autoExecute, condition: after.condition, objective: after.objective, maxRiskTier: after.maxRiskTier })
          .toEqual({ enabled: false, autoExecute: seeded.autoExecute, condition: null, objective: def.objective, maxRiskTier: def.maxRiskTier });
        expect(await firePaid()).toEqual([]);

        // A seeded rule the OWNER switched on is still one only the owner switches off.
        const on = await request(app.getHttpServer()).put(triggerUrl(seeded.id)).set('x-test-user', ID.owner).send({ enabled: true });
        expect(on.status, JSON.stringify(on.body).slice(0, 300)).toBe(200);
        expect(await firePaid()).toEqual([{ objective: def.objective, userId: ID.owner }]);
        const off = await request(app.getHttpServer()).put(triggerUrl(seeded.id)).set('x-test-user', ID.staffOwned).send({ enabled: false });
        expect(off.status, JSON.stringify(off.body).slice(0, 300)).toBe(403);
        expect((await db.agentTrigger.findUnique({ where: { id: seeded.id } })).enabled).toBe(true);
      } finally {
        await db.agentTrigger.updateMany({ where: { businessId: ID.biz }, data: { enabled: false } });
      }
    });

    it("CV-08m2 RED-BEFORE (W5-AGENT-TRIGGERS-AUTHORITY; D-73, D-93; review SEC-D93-3): POST agent/triggers records the member who wrote the rule: a STAFF member's word-for-word copy of a default rule fires its plan as that STAFF member, never as the owner; a creator the body names is ignored; the STAFF member's own PUT of their copy keeps it theirs", async () => {
      await seededPaidRule();
      const def = paidDefault();
      const created: string[] = [];
      try {
        const copy = await request(app.getHttpServer()).post(triggerUrl()).set('x-test-user', ID.staffOwned)
          .send({ name: def.name, eventPattern: def.eventPattern, objective: def.objective, autoExecute: true, maxRiskTier: def.maxRiskTier });
        expect(copy.status, JSON.stringify(copy.body).slice(0, 300)).toBe(201);
        created.push(copy.body.id);
        expect(await firePaid()).toEqual([{ objective: def.objective, userId: ID.staffOwned }]);

        // A creator the body names (the reserved key, KEY-R3b's) is dropped and the writer recorded.
        const forgedObjective = 'v89k cv08m2 forged creator';
        const forged = await request(app.getHttpServer()).post(triggerUrl()).set('x-test-user', ID.staffOwned)
          .send({ name: def.name, eventPattern: def.eventPattern, objective: forgedObjective, condition: { $createdBy: ID.owner }, maxRiskTier: def.maxRiskTier });
        expect(forged.status, JSON.stringify(forged.body).slice(0, 300)).toBe(201);
        created.push(forged.body.id);
        expect((await firePaid()).sort((a, b) => a.objective.localeCompare(b.objective)))
          .toEqual([{ objective: def.objective, userId: ID.staffOwned }, { objective: forgedObjective, userId: ID.staffOwned }].sort((a, b) => a.objective.localeCompare(b.objective)));

        // The STAFF member switches their own copy off and on: theirs to edit, and still theirs.
        for (const enabled of [false, true]) {
          const res = await request(app.getHttpServer()).put(triggerUrl(copy.body.id)).set('x-test-user', ID.staffOwned)
            .send({ enabled, condition: { $createdBy: ID.owner } });
          expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
        }
        await db.agentTrigger.update({ where: { id: forged.body.id }, data: { enabled: false } });
        expect(await firePaid()).toEqual([{ objective: def.objective, userId: ID.staffOwned }]);
      } finally {
        await db.agentTrigger.deleteMany({ where: { id: { in: created } } });
        await db.agentTrigger.updateMany({ where: { businessId: ID.biz }, data: { enabled: false } });
      }
    });
  });

  // Residuals of review SEC-D93-1..3 outside this packet's write set (plan-step-authority, the default
  // triggers, the system plan creators' member field, the orchestrator's choice of the memberless view):
  it.todo("CV-08k TODO (review SEC-D93-1 residual; D-74): GET businesses/:businessId/journeys/:instanceId hands getJourneyInstance its viewer (ai.controller.ts, outside W4-D93-NO-MEMBER-CONTACTS's write set), so the plan read rule answers each viewer what it may read; until then the route withholds every step's input and output from every reader");
  it.todo("CV-08l TODO (review SEC-D93-1, SEC-D93-2 residual; D-74): GET businesses/:businessId/ai/execution-logs answers only what its viewer may read: ActionDispatcherService (outside this write set) logs a plan step's whole result, so an owner-run system plan's output (and, before D-93, the owner's own plan's) reaches every member");
  it.todo("CV-08n TODO (review SEC-D93-1 residual; D-73): POST businesses/:businessId/journeys/:key/trigger records the requesting member as the journey plan's member (ai.controller.ts, outside this write set), so the journey runs as that member rather than as no member");
});

describe("W3-KEY-CRM-VISIBILITY review repairs (D-37): every dispatcher case the principal's visibility bounds is the OWNER's only with no principal, and sequence_enroll honours the member's view", () => {
  /** The V1-84 calendar and booking reads: contactReadAccess / calendarContactScope bound their contacts (SEC-W3CV-1). */
  const CALENDAR_AND_BOOKING_READS = ['calendar_list_events', 'calendar_check_conflicts', 'bookings_list_bookings', 'bookings_list_waitlist'];
  const activeSequence = (id: string) =>
    db.crmSequence.create({ data: { id, businessId: ID.biz, name: `v89k ${id}`, status: 'active', steps: [{ type: 'email', subject: 'v89k', body: 'v89k', delayDays: 0 }] } });

  it("CV-09 RED-BEFORE (D-37, review SEC-W3CV-1): a STAFF member's plan with calendar_list_events or bookings_list_bookings is refused by the queue worker at run time (it would run with no principal, in the OWNER's view): nothing dispatched, no hidden contact named", async () => {
    for (const tool of ['calendar_list_events', 'bookings_list_bookings']) {
      const planId = `${P}cv09_${tool}`;
      await seedPlan(planId, ID.staffOwned, tool, {}, 'approved');
      await runQueueStep(planId, tool, {});
      expect(dispatched.filter((d) => d.planStepId === `${planId}_s1`), tool).toEqual([]);
      const row = await stepRow(planId);
      expect(row.status, tool).toBe('failed');
      expect(String(row.errorMessage), tool).toMatch(/^Refused: .*business owner/);
      expectNoHidden(row.outputResult, ['priv']);
    }
  });

  it("CV-10 RED-BEFORE (D-37, review SEC-W3CV-1): POST ai/plans/:planId/approve's rule (no principal) refuses calendar_list_events, calendar_check_conflicts, bookings_list_bookings and bookings_list_waitlist to an ADMIN and to the STAFF member, the OWNER may; the plans read shows their stored output (rows and count) to the OWNER only; with the caller as principal the member still runs them over their own view", async () => {
    const opts = { proposerOverrideRoles: PLAN_APPROVER_ROLES, noPrincipal: true };
    const adminRead = await graphPlanReadScope(prisma, ID.biz, { id: ID.admin, role: 'USER' });
    const staffRead = await graphPlanReadScope(prisma, ID.biz, { id: ID.staffOwned, role: 'USER' });
    const ownerRead = await graphPlanReadScope(prisma, ID.biz, { id: ID.owner, role: 'USER' });
    for (const tool of CALENDAR_AND_BOOKING_READS) {
      for (const member of [ID.admin, ID.staffOwned]) {
        const err = await assertMayRunGraphAction(prisma, ID.biz, { id: member, role: 'USER' }, tool, member, opts).then(() => null, (e: unknown) => e);
        expect(err, `${tool} ${member}`).toBeInstanceOf(ForbiddenException);
        expect(String((err as Error).message), `${tool} ${member}`).toMatch(/only for the business owner/);
      }
      await expect(assertMayRunGraphAction(prisma, ID.biz, { id: ID.owner, role: 'USER' }, tool, ID.owner, opts)).resolves.toBeUndefined();
      expect(adminRead.stepOutput(tool), tool).toBe(false);
      expect(staffRead.stepOutput(tool), tool).toBe(false);
      expect(ownerRead.stepOutput(tool), tool).toBe(true);
      // With the caller as principal (POST .../execute) the ADMIN still runs them (bounded by their view).
      await expect(assertMayRunGraphAction(prisma, ID.biz, { id: ID.admin, role: 'USER' }, tool, ID.admin)).resolves.toBeUndefined();
    }
    // The STAFF member (bookings read) runs the calendar reads with the caller as principal, over their own view.
    for (const tool of ['calendar_list_events', 'calendar_check_conflicts']) {
      await expect(assertMayRunGraphAction(prisma, ID.biz, { id: ID.staffOwned, role: 'USER' }, tool, ID.staffOwned), tool).resolves.toBeUndefined();
    }
    const { body } = await memberExecutes(ID.staffOwned, `${P}cv10_exec`, 'calendar_list_events', {});
    expect((body.result.events as Array<{ id: string }>).map((e) => e.id)).toEqual([ID.evMine]);
    expectNoHidden(body, ['priv']);
  });

  it("CV-11 RED-BEFORE (D-37, review SEC-W3CV-4): sequence_enroll for the STAFF member kept to their own book refuses a contact they may not open (the OWNER's PRIVATE or TEAM contact, alone or beside their own) as an unknown contact and enrols nobody; their own contact is enrolled; the OWNER enrols the PRIVATE contact", async () => {
    await activeSequence(ID.seqEnrolStaff);
    await activeSequence(ID.seqEnrolOwner);
    for (const [n, contactIds] of [[ID.cPriv], [ID.cTeam], [ID.cMine, ID.cPriv]].entries()) {
      const planId = `${P}cv11_${n}`;
      await seedPlan(planId, ID.staffOwned, 'sequence_enroll', { sequenceId: ID.seqEnrolStaff, contactIds });
      const res = await request(app.getHttpServer())
        .post(`/actions/businesses/${ID.biz}/execute`)
        .set('x-test-user', ID.staffOwned)
        .set('x-forwarded-for', nextIp())
        .send({ planId, planStepId: `${planId}_s1` });
      expect(res.status, String(contactIds)).toBe(201);
      expect(res.body.success, `${contactIds} ${JSON.stringify(res.body).slice(0, 300)}`).toBe(false);
      const row = await stepRow(planId);
      expect(row.status, String(contactIds)).toBe('failed');
      expect(String(row.errorMessage), String(contactIds)).toMatch(/Contact not found/);
      expect(await enrolledIn(ID.seqEnrolStaff), String(contactIds)).toEqual([]);
    }
    const mine = await memberExecutes(ID.staffOwned, `${P}cv11_mine`, 'sequence_enroll', { sequenceId: ID.seqEnrolStaff, contactIds: [ID.cMine] });
    expect(mine.body.result.enrolled).toBe(1);
    expect(await enrolledIn(ID.seqEnrolStaff)).toEqual([ID.cMine]);
    const owner = await memberExecutes(ID.owner, `${P}cv11_owner`, 'sequence_enroll', { sequenceId: ID.seqEnrolOwner, contactIds: [ID.cPriv] });
    expect(owner.body.result.enrolled).toBe(1);
    expect(await enrolledIn(ID.seqEnrolOwner)).toEqual([ID.cPriv]);
  });

  it("CV-12 RED-BEFORE (D-37, review SEC-W3CV-4): a STAFF member's plan with sequence_enroll is refused by the queue worker (it would run with no principal, unbounded), and neither an ADMIN nor the STAFF member may approve it with no principal, the OWNER may; nobody enrolled", async () => {
    await activeSequence(ID.seqEnrolQueue);
    const args = { sequenceId: ID.seqEnrolQueue, contactIds: [ID.cPriv] };
    const planId = `${P}cv12`;
    await seedPlan(planId, ID.staffOwned, 'sequence_enroll', args, 'approved');
    await runQueueStep(planId, 'sequence_enroll', args);
    expect(dispatched.filter((d) => d.planStepId === `${planId}_s1`)).toEqual([]);
    const row = await stepRow(planId);
    expect(row.status).toBe('failed');
    expect(String(row.errorMessage)).toMatch(/^Refused: .*business owner/);
    expect(await enrolledIn(ID.seqEnrolQueue)).toEqual([]);
    const opts = { proposerOverrideRoles: PLAN_APPROVER_ROLES, noPrincipal: true };
    for (const member of [ID.admin, ID.staffOwned]) {
      const err = await assertMayRunGraphAction(prisma, ID.biz, { id: member, role: 'USER' }, 'sequence_enroll', member, opts).then(() => null, (e: unknown) => e);
      expect(err, member).toBeInstanceOf(ForbiddenException);
    }
    await expect(assertMayRunGraphAction(prisma, ID.biz, { id: ID.owner, role: 'USER' }, 'sequence_enroll', ID.owner, opts)).resolves.toBeUndefined();
  });

  // Review SEC-W3CV-3 (the proposal surface) was recorded here as it.todo CV-13; W4-PROPOSAL-PRINCIPAL
  // makes it live below (CV-13..CV-13c).
});

describe('W4-PROPOSAL-PRINCIPAL (D-73, D-71, D-46, D-37; review SEC-W3CV-3): an approved AI_PLAN EXECUTE_TOOL proposal runs as its plan\'s member, under the plan-step run rules, before it dispatches', () => {
  const activeSequence = (id: string) =>
    db.crmSequence.create({ data: { id, businessId: ID.biz, name: `v89k ${id}`, status: 'active', steps: [{ type: 'email', subject: 'v89k', body: 'v89k', delayDays: 0 }] } });
  const INVOICE_ARGS = { contactId: ID.cMine, items: [{ description: 'v89k proposal', quantity: 1, unitPrice: 10 }] };

  /**
   * An approved, claimed KEY action proposal as PlanExecutorService.createStepProposal files it for
   * the plan's one step (sourceType AI_PLAN; userId null: "requester unknown at this layer") and
   * KeyActionProposalService.execute hands it to the executor plugin. `planId` null: an AI_PLAN
   * proposal that names no plan.
   */
  function planProposal(tag: string, planId: string | null, toolName: string, args: Record<string, unknown>, approvedBy: string) {
    const planStepId = planId ? `${planId}_s1` : null;
    return {
      id: `${P}prop_${tag}`,
      businessId: ID.biz,
      userId: null,
      sourceType: 'AI_PLAN',
      sourceId: planId,
      planId,
      planStepId,
      title: `Plan step: ${toolName}`,
      actionType: 'EXECUTE_TOOL',
      status: 'EXECUTING',
      requiresApproval: true,
      approvedBy,
      payload: { toolName, inputPayload: args, ...(planId ? { planContext: { planId, planStepId } } : {}) },
    };
  }

  /** Seeds a plan of `member` with one step of `toolName`, then executes its approved proposal as `approver`. */
  async function runPlanProposal(tag: string, member: string | null, toolName: string, args: Record<string, unknown>, approver: string) {
    const planId = `${P}cv13_${tag}`;
    await seedPlan(planId, member, toolName, args, 'approved');
    const before = proposalDispatched.length;
    const outcome = await proposalExecutor.execute(ID.biz, planProposal(tag, planId, toolName, args, approver), approver);
    return { outcome, sent: proposalDispatched.slice(before) };
  }

  it("CV-13 RED-BEFORE (W4-PROPOSAL-PRINCIPAL; D-73, D-37; review SEC-W3CV-3): a STAFF member's plan step proposal, approved and executed by the ADMIN (or the OWNER), runs with that STAFF member as its principal (surface PROPOSAL): sequence_enroll_overdue enrols only their own overdue contact, fetch_client_health and crm_list_contacts count and name only it, create_followup_queue queues a task only on it; no hidden contact named", async () => {
    await activeSequence(ID.seqPropStaff);
    const enrol = await runPlanProposal('staff_seq', ID.staffOwned, 'sequence_enroll_overdue', { sequenceId: ID.seqPropStaff }, ID.admin);
    expect(enrol.sent.map((d) => [d.surface, d.principal]), JSON.stringify(enrol.outcome).slice(0, 300)).toEqual([['PROPOSAL', ID.staffOwned]]);
    expect(enrol.outcome.success, enrol.outcome.error).toBe(true);
    expect(await enrolledIn(ID.seqPropStaff)).toEqual([ID.cMine]);

    const health = await runPlanProposal('staff_health', ID.staffOwned, 'fetch_client_health', {}, ID.admin);
    expect(health.sent.map((d) => d.principal)).toEqual([ID.staffOwned]);
    expect(health.outcome.success, health.outcome.error).toBe(true);
    expect(health.outcome.result.totalContacts).toBe(1);
    expect((health.outcome.result.topSpenders as Array<{ contactId: string }>).map((s) => s.contactId)).toEqual([ID.cMine]);
    expectNoHidden(health.outcome);

    // The approver does not widen the member's run: the OWNER approving and executing it reads the STAFF member's book.
    const list = await runPlanProposal('staff_list', ID.staffOwned, 'crm_list_contacts', { limit: 50 }, ID.owner);
    expect(list.sent.map((d) => d.principal)).toEqual([ID.staffOwned]);
    expect(list.outcome.success, list.outcome.error).toBe(true);
    expect((list.outcome.result.contacts as Array<{ id: string }>).map((c) => c.id)).toEqual([ID.cMine]);
    expectNoHidden(list.outcome);

    const followups = await runPlanProposal('staff_fq', ID.staffOwned, 'create_followup_queue', { taskTitle: 'v89k cv13 {name}' }, ID.admin);
    expect(followups.outcome.success, followups.outcome.error).toBe(true);
    expect(await tasksTitled('v89k cv13')).toEqual([ID.cMine]);
    expectNoHidden(followups.outcome);
  });

  it("CV-13a RED-BEFORE (W4-PROPOSAL-PRINCIPAL; D-71, D-46): the plan's member is held to the plan-step rules before dispatch: the STAFF member's commerce_create_invoice step (revenue write they do not hold) and a non-member platform SUPER_ADMIN's (D-46) are refused, whoever approved them; nothing dispatched, no invoice written", async () => {
    const invoicesBefore = await db.invoice.count({ where: { businessId: ID.biz } });
    const staff = await runPlanProposal('staff_inv', ID.staffOwned, 'commerce_create_invoice', INVOICE_ARGS, ID.owner);
    expect(staff.sent).toEqual([]);
    expect(staff.outcome.success).toBe(false);
    expect(String(staff.outcome.error)).toMatch(/^Refused: Insufficient permissions: revenue requires write access/);

    const superAdmin = await runPlanProposal('super_inv', ID.superAdmin, 'commerce_create_invoice', INVOICE_ARGS, ID.owner);
    expect(superAdmin.sent).toEqual([]);
    expect(superAdmin.outcome.success).toBe(false);
    expect(String(superAdmin.outcome.error)).toMatch(/^Refused: .*\(D-46\)/);
    expect(await db.invoice.count({ where: { businessId: ID.biz } })).toBe(invoicesBefore);
  });

  it("CV-13b RED-BEFORE (W4-PROPOSAL-PRINCIPAL; D-73): a plan proposal with no member (a plan with no userId, or an AI_PLAN proposal that names no plan) is refused a contact read (crm_list_contacts) and a money/invoice write (commerce_create_invoice), as the plan queue refuses a memberless plan; nothing dispatched, no invoice written", async () => {
    const invoicesBefore = await db.invoice.count({ where: { businessId: ID.biz } });
    const read = await runPlanProposal('none_list', null, 'crm_list_contacts', { limit: 50 }, ID.owner);
    expect(read.sent).toEqual([]);
    expect(read.outcome.success).toBe(false);
    expect(String(read.outcome.error)).toMatch(/^Refused: .*reads no contacts \(D-73\)/);
    expectNoHidden(read.outcome);

    const write = await runPlanProposal('none_inv', null, 'commerce_create_invoice', INVOICE_ARGS, ID.owner);
    expect(write.sent).toEqual([]);
    expect(write.outcome.success).toBe(false);
    expect(String(write.outcome.error)).toMatch(/^Refused: .*writes neither \(D-73\)/);

    const before = proposalDispatched.length;
    const noPlan = await proposalExecutor.execute(ID.biz, planProposal('noplan_list', null, 'crm_list_contacts', { limit: 50 }, ID.owner), ID.owner);
    expect(proposalDispatched.slice(before)).toEqual([]);
    expect(noPlan.success).toBe(false);
    expect(String(noPlan.error)).toMatch(/^Refused: .*reads no contacts \(D-73\)/);
    expectNoHidden(noPlan);
    expect(await db.invoice.count({ where: { businessId: ID.biz } })).toBe(invoicesBefore);
  });

  it("CV-13c CONTROL (W4-PROPOSAL-PRINCIPAL; D-37): the OWNER's plan step proposal, approved and executed by the OWNER, still covers the whole book: fetch_client_health names the PRIVATE top spender, crm_list_contacts lists every contact, sequence_enroll_overdue enrols every overdue contact", async () => {
    const health = await runPlanProposal('owner_health', ID.owner, 'fetch_client_health', {}, ID.owner);
    expect(health.outcome.success, health.outcome.error).toBe(true);
    expect(health.outcome.result.totalContacts).toBe(3);
    expect(health.outcome.result.topSpenders[0]).toMatchObject({ contactId: ID.cPriv, name: `${NAME.priv} V89K` });

    const list = await runPlanProposal('owner_list', ID.owner, 'crm_list_contacts', { limit: 50 }, ID.owner);
    expect(list.outcome.success, list.outcome.error).toBe(true);
    expect((list.outcome.result.contacts as Array<{ id: string }>).map((c) => c.id).sort()).toEqual(ALL);

    await activeSequence(ID.seqPropOwner);
    const enrol = await runPlanProposal('owner_seq', ID.owner, 'sequence_enroll_overdue', { sequenceId: ID.seqPropOwner }, ID.owner);
    expect(enrol.outcome.success, enrol.outcome.error).toBe(true);
    expect(await enrolledIn(ID.seqPropOwner)).toEqual(ALL);
  });
});

describe('W4-PROPOSAL-PRINCIPAL review repairs (SEC-W4PP-1, CR-W4PP-1, SEC-W4PP-2, CR-W4PP-2; D-73, D-71, D-37): only the stored plan names a proposal\'s member, and every other flow-tool proposal runs only for a member who may run the tool', () => {
  /**
   * An approved, claimed EXECUTE_TOOL proposal of `businessId` as KeyActionProposalService.execute
   * hands it to the plugin. POST key-autonomy/businesses/:businessId/actions/proposals stores the
   * client's sourceType (any of KEY_ACTION_SOURCE_TYPES, AI_PLAN included) and payload verbatim,
   * with planId and planStepId null: only PlanExecutorService.createStepProposal (and the legacy
   * approval-item migration) write those columns.
   */
  function filed(tag: string, over: Record<string, unknown>, payload: Record<string, unknown>, businessId: string = ID.biz) {
    return {
      id: `${P}prop_r_${tag}`,
      businessId,
      userId: null,
      sourceType: 'MANUAL',
      planId: null,
      planStepId: null,
      title: `v89k ${tag}`,
      actionType: 'EXECUTE_TOOL',
      status: 'EXECUTING',
      requiresApproval: true,
      approvedBy: null,
      ...over,
      payload,
    };
  }

  async function run(row: Record<string, unknown>, executedBy: string | undefined) {
    const before = proposalDispatched.length;
    const outcome = await proposalExecutor.execute(row.businessId, row, executedBy);
    return { outcome, sent: proposalDispatched.slice(before) };
  }

  it("CV-13d RED-BEFORE (W4-PROPOSAL-PRINCIPAL review SEC-W4PP-1, CR-W4PP-1; D-73, D-37): an AI_PLAN proposal with no stored planId whose payload.planContext names the OWNER's plan (what the HTTP route files for any member) is refused before dispatch, whoever files, approves and executes it: the STAFF member's crm_list_contacts and fetch_client_health do not run as the OWNER; nothing dispatched, no hidden contact named", async () => {
    const ownerPlan = `${P}cv13d_owner`;
    await seedPlan(ownerPlan, ID.owner, 'crm_list_contacts', {}, 'approved');
    const planContext = { planId: ownerPlan, planStepId: `${ownerPlan}_s1` };
    for (const [toolName, args] of [['crm_list_contacts', { limit: 50 }], ['fetch_client_health', {}]] as const) {
      const staff = { userId: ID.staffOwned, approvedBy: ID.staffOwned, sourceType: 'AI_PLAN' };
      const out = await run(filed(`cv13d_${toolName}`, staff, { toolName, inputPayload: args, planContext }), ID.staffOwned);
      expect(out.sent, `${toolName} dispatched ${JSON.stringify(out.sent)}`).toEqual([]);
      expect(out.outcome.success, toolName).toBe(false);
      expect(String(out.outcome.error), toolName).toMatch(/^Refused: .*names a plan it was not filed for/);
      expectNoHidden(out.outcome);
    }
    // The same forged attribution on a proposal of another source is refused alike: no payload names a plan the proposal was not filed for.
    const manual = await run(
      filed('cv13d_manual', { userId: ID.staffOwned, approvedBy: ID.staffOwned }, { toolName: 'crm_list_contacts', inputPayload: { limit: 50 }, planContext }),
      ID.staffOwned,
    );
    expect(manual.sent).toEqual([]);
    expect(String(manual.outcome.error)).toMatch(/^Refused: .*names a plan it was not filed for/);
  });

  it("CV-13e RED-BEFORE (W4-PROPOSAL-PRINCIPAL review SEC-W4PP-2; D-37, D-71, D-73): a flow-tool proposal that is no plan step (MANUAL, KEY_CORTEX) runs only if the member it runs for (executor, else approver, else requester) may run the tool with no principal (the approve rule): the STAFF member's self-approved crm_list_contacts and fetch_client_health and the ADMIN's crm_list_contacts are refused before dispatch, as is one with no member; the OWNER's lists the whole book (CONTROL)", async () => {
    const staff = { userId: ID.staffOwned, approvedBy: ID.staffOwned };
    for (const [tag, sourceType, toolName, args] of [
      ['manual_list', 'MANUAL', 'crm_list_contacts', { limit: 50 }],
      ['cortex_health', 'KEY_CORTEX', 'fetch_client_health', {}],
    ] as const) {
      const out = await run(filed(`cv13e_${tag}`, { ...staff, sourceType }, { toolName, inputPayload: args }), ID.staffOwned);
      expect(out.sent, `${tag} dispatched ${JSON.stringify(out.sent)}`).toEqual([]);
      expect(out.outcome.success, tag).toBe(false);
      expect(String(out.outcome.error), tag).toMatch(/^Refused: Tool "(crm_list_contacts|fetch_client_health)" is executed from here only for the business owner/);
      expectNoHidden(out.outcome);
    }
    // The ADMIN, who may not open the OWNER's PRIVATE contact, would read it with no principal.
    const admin = await run(filed('cv13e_admin', { userId: ID.staffOwned, approvedBy: ID.admin }, { toolName: 'crm_list_contacts', inputPayload: { limit: 50 } }), ID.admin);
    expect(admin.sent).toEqual([]);
    expect(String(admin.outcome.error)).toMatch(/^Refused: Tool "crm_list_contacts" is executed from here only for the business owner/);
    expectNoHidden(admin.outcome);
    // No member at all (KEY executes, nobody approved or asked): D-73's memberless rule.
    const none = await run(filed('cv13e_none', {}, { toolName: 'crm_list_contacts', inputPayload: { limit: 50 } }), 'key_ai');
    expect(none.sent).toEqual([]);
    expect(String(none.outcome.error)).toMatch(/^Refused: .*reads no contacts \(D-73\)/);

    // CONTROL: the OWNER's proposal runs as before (surface PROPOSAL, no principal), over the whole book.
    const owner = await run(filed('cv13e_owner', { userId: ID.owner, approvedBy: ID.owner }, { toolName: 'crm_list_contacts', inputPayload: { limit: 50 } }), ID.owner);
    expect(owner.sent.map((d) => [d.surface, d.principal])).toEqual([['PROPOSAL', undefined]]);
    expect(owner.outcome.success, owner.outcome.error).toBe(true);
    expect((owner.outcome.result.contacts as Array<{ id: string }>).map((c) => c.id).sort()).toEqual(ALL);
  });

  it("CV-13f RED-BEFORE (W4-PROPOSAL-PRINCIPAL review CR-W4PP-2; D-71, D-73): a plan whose member owns the business by Business.ownerId alone (no membership row) runs its crm_list_contacts step proposal as the plan queue runs it: admitted by planStepRunRefusal and dispatched with no principal (the owner's view is the whole book), not refused 'Not a member of this business'; that owner's own MANUAL proposal runs alike", async () => {
    const ownerC = `${P}owner_c`;
    const bizC = `${P}biz_c`;
    const planC = `${P}cv13f_plan`;
    await db.user.create({ data: { id: ownerC, email: `${P}owner_c@test.local`, role: 'USER' } });
    await db.business.create({ data: { id: bizC, name: 'V89K Biz C', ownerId: ownerC } });
    await db.contact.create({ data: { id: `${P}c_c`, businessId: bizC, firstName: 'V89KC', lastName: 'V89K', email: `${P}c_c@test.local`, status: 'LEAD' } });
    await db.aiPlan.create({
      data: {
        id: planC, businessId: bizC, userId: ownerC, objective: 'v89k cv13f', status: 'approved',
        steps: { create: [{ id: `${planC}_s1`, order: 1, toolName: 'crm_list_contacts', action: 'crm_list_contacts', module: 'ai', status: 'pending', inputPayload: {} }] },
      },
    });
    const { planStepRunRefusal } = await import('../src/modules/ai/plan-step-authority');
    expect(await planStepRunRefusal(prisma, bizC, planC, 'crm_list_contacts')).toBeNull();

    const step = await run(
      filed('cv13f_plan', { sourceType: 'AI_PLAN', planId: planC, planStepId: `${planC}_s1`, approvedBy: ownerC }, {
        toolName: 'crm_list_contacts', inputPayload: { limit: 50 }, planContext: { planId: planC, planStepId: `${planC}_s1` },
      }, bizC),
      ownerC,
    );
    expect(step.sent.map((d) => [d.surface, d.principal, d.planStepId])).toEqual([['PROPOSAL', undefined, `${planC}_s1`]]);
    expect(step.outcome.success, step.outcome.error).toBe(true);
    expect((step.outcome.result.contacts as Array<{ id: string }>).map((c) => c.id)).toEqual([`${P}c_c`]);

    const manual = await run(filed('cv13f_manual', { userId: ownerC, approvedBy: ownerC }, { toolName: 'crm_list_contacts', inputPayload: { limit: 50 } }, bizC), ownerC);
    expect(manual.outcome.success, manual.outcome.error).toBe(true);
    expect((manual.outcome.result.contacts as Array<{ id: string }>).map((c) => c.id)).toEqual([`${P}c_c`]);
  });
});
