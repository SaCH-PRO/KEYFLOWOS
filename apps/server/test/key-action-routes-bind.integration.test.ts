/**
 * V1-31b-KEY-ACTION-ROUTES-BIND: every KEY "execute action" HTTP route executes
 * only a proposal the server holds, looked up by id inside the guarded
 * business; approval resolution routes need a real principal (REAL database).
 *
 * V1-31 review SEC-V131-1 (M46, KEY-CONFIRM-BIND-001) left the it.todo in
 * flow-confirmation-binding.spec.ts: POST /actions/businesses/:businessId/execute
 * (GraphActionsController.executeAction, AuthGuard + BusinessGuard only)
 * evaluated governance on the CLIENT's toolName and ran executeToolDirect with
 * the CLIENT's args. Census of the sibling routes (every route under
 * modules/ai, key-cortex, key-inbox and autopilot named execute/run/apply or
 * calling a tool executor), read from this base:
 *
 *   GA  POST actions/businesses/:b/execute (graph-actions)      client toolName + args -> executeToolDirect. BOUND here to a stored AiPlanStep.
 *   KI  POST key-inbox/.../threads/:t/actions/:i/execute       stored suggestion by index, but payloadOverride merged ANY client key into
 *                                                               the payload, 'user' stood in for a missing principal, no claim (a double
 *                                                               submit ran twice) and only operations scope (a crm write ran without crm
 *                                                               write). BOUND here: claim, crm scope, editable text only, real principal.
 *   AP  POST autopilot/.../actions/:a/execute                  client contactId/channel/message; the action ids are computed by
 *                                                               CrmActionsService, never stored, so there is no proposal to bind:
 *                                                               REFUSED here (410). It wrote "WhatsApp/email sent" timeline rows for
 *                                                               messages the server never sent, attributed to AI.
 *   AP  POST autopilot/.../tasks/:t/approve                    approvedBy from the BODY. Now the authenticated caller.
 *   AA  POST ai-approvals/.../items/:i/resolve, bulk-resolve   req.user?.id ?? 'user'. Now 401 without a principal (unit: the it.todo in
 *                                                               approval.controller.spec.ts), the real user over HTTP.
 *   Stored-id routes, no client tool or arguments (unchanged): flow/confirm (V1-31), flow/execute-plan, ai/plans/:id/approve,
 *   briefing/:planId/execute-all, ai/approvals/:id/resolve, key-autonomy proposals/:id/execute (V1-32), cortex plans/:id/execute
 *   (V1-10), autopilot loops/:id/run and key/execute (a stored DelegationLoop by id in the business).
 *   Outside this write set, still passing request-body tool names or arguments to an executor (KNOWN_BODY_EXECUTORS below, kind
 *   'open', each an it.todo): cortex POST execute and batch (client module.action + parameters), sandbox/execute (client
 *   code), sandbox/apply (client template parameters), flows/:id/execute (client inputs to a stored flow). code-executor
 *   tool-bridge is kind 'bounded' (a server-minted one-time token, tier 1-2 tools only).
 *
 * WHAT IS REAL: PrismaService and the Prisma client at DATABASE_URL, AuthGuard,
 * BusinessGuard, ModuleScopeGuard, CrmRateLimitGuard, the four controllers,
 * PlannerService.getPlan/updateStepStatus, KeyInboxService.getThread,
 * KeyInboxActionExecutorService (it writes the contact_tasks this suite
 * counts), AutopilotService, AiApprovalsService, the users, businesses,
 * memberships, contacts, ai_plans, ai_plan_steps, ai_approval_items,
 * key_inbox_threads, key_inbox_messages, autopilot_tasks and idempotency_keys
 * rows. Identity attachment is a test middleware (x-test-user, seeded v31b_
 * users only), as in contacts-visibility. Stand-ins: the tool executor
 * (FlowOrchestratorService.executeToolDirect records every call, the external
 * effect, and answers after a short delay so concurrent calls overlap),
 * governance (AiOversightService: evaluate allows unless a tool is listed,
 * createApprovalItem writes a real ai_approval_items row, resolveApproval
 * records), the intent parser and plan generation (no LLM), the business
 * graph, the business-event and contact-timeline sinks (record). No provider
 * is reached.
 *
 * Every seeded row carries the `v31b_` prefix (or a v31b_ business id) and is
 * hard-deleted by raw SQL with sqlLikePrefix() in beforeAll and afterAll; no
 * $transaction wrapping.
 */
import 'reflect-metadata';
import path from 'path';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import * as ts from 'typescript';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v31b_';

const ID = {
  owner: `${P}owner`, // OWNER of bizA (role-default scopes)
  staffNoRev: `${P}staffNoRev`, // STAFF of bizA: crm write, revenue read, operations write
  staffNoCrm: `${P}staffNoCrm`, // STAFF of bizA: crm read, operations write
  other: `${P}other`, // OWNER of bizB only
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  contactA: `${P}contactA`,
  contactB: `${P}contactB`,
  // graph-action plans
  planA: `${P}planA`,
  planB: `${P}planB`,
  sStored: `${P}sStored`, // crm_add_note, executed with a conflicting client toolName/args
  sConc: `${P}sConc`, // crm_add_note, 8 concurrent executes
  sRev: `${P}sRev`, // commerce_mark_invoice_paid (revenue write)
  sUnmapped: `${P}sUnmapped`, // execute_custom_logic (mapped to no module: denied by default)
  sApproval: `${P}sApproval`, // crm_delete_contact (governance stand-in asks for formal approval)
  sForeign: `${P}sForeign`, // a step of bizB's plan
  // key inbox
  threadA: `${P}threadA`,
  threadB: `${P}threadB`,
  msgA: `${P}msgA`,
  msgB: `${P}msgB`,
  // autopilot / approvals
  taskA: `${P}taskA`,
  itemA: `${P}itemA`,
};

const STORED_ARGS = { contactId: `${P}contactA`, body: 'v31b stored note' };
const CLIENT_ARGS = { contactId: `${P}contactB`, body: 'v31b client note', force: true };

/** The suggested actions on msgA, by index. */
const ACTIONS = [
  { type: 'create_task', label: 'Task', confidence: 0.9, payload: { title: 'v31b stored title 0' } }, // 0: override refused (non-editable key)
  { type: 'create_task', label: 'Task', confidence: 0.9, payload: { title: 'v31b stored title 1' } }, // 1: 8 concurrent executes
  { type: 'create_task', label: 'Task', confidence: 0.9, payload: { title: 'v31b stored title 2' } }, // 2: staffNoCrm refused
  { type: 'transfer_funds', label: 'Unknown', confidence: 0.9, payload: {} }, // 3: an unmapped type
  { type: 'create_task', label: 'Task', confidence: 0.9, payload: { title: 'v31b stored title 4' } }, // 4: editable title honoured
];

const EXECUTOR_DELAY_MS = 40;

let db: any;
let app: any;

/** Every tool the executor stand-in was handed. */
const executions: Array<{ businessId: string; toolName: string; args: unknown; planId?: string; planStepId?: string; action?: any }> = [];
/** Every governance evaluation. */
const evaluations: string[] = [];
/** Every approval resolution the oversight stand-in was handed. */
const resolutions: Array<{ kind: string; ids: string[]; businessId: string; resolution: string; userId: unknown }> = [];
/** Every business event and contact timeline row emitted. */
const businessEvents: any[] = [];
const timelineEvents: any[] = [];
/** Tools governance asks a formal approval for. */
const FORMAL_APPROVAL_TOOLS = new Set(['crm_delete_contact']);

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function cleanup() {
  for (const sql of [
    `DELETE FROM idempotency_keys WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_tasks WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM key_inbox_messages WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM key_inbox_threads WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM ai_approval_items WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM ai_plan_steps WHERE plan_id IN (SELECT id FROM ai_plans WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM ai_plans WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM autopilot_tasks WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

function http() {
  return request(app.getHttpServer());
}

function executeGraph(actor: string | null, body: Record<string, unknown>, businessId = ID.bizA) {
  const req = http().post(`/actions/businesses/${businessId}/execute`).send(body);
  return actor ? req.set('x-test-user', actor) : req;
}

function executeInbox(actor: string | null, threadId: string, index: number | string, body: Record<string, unknown>, businessId = ID.bizA) {
  const req = http().post(`/key-inbox/businesses/${businessId}/threads/${threadId}/actions/${index}/execute`).send(body);
  return actor ? req.set('x-test-user', actor) : req;
}

async function stepStatus(id: string): Promise<string | null> {
  const row = await db.aiPlanStep.findUnique({ where: { id }, select: { status: true } });
  return row?.status ?? null;
}

async function seedStep(id: string, planId: string, order: number, toolName: string, inputPayload: Record<string, unknown>) {
  await db.aiPlanStep.create({
    data: { id, planId, order, toolName, action: `v31b ${toolName}`, description: 'v31b', riskTier: 1, inputPayload, status: 'pending' },
  });
}

async function contactTasks(title?: string) {
  return db.contactTask.findMany({ where: { businessId: ID.bizA, ...(title ? { title } : {}) } });
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { EventEmitter2 } = await import('@nestjs/event-emitter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { CrmRateLimitGuard } = await import('../src/modules/crm/guards/rate-limit.guard');
  const { GraphActionsController } = await import('../src/modules/ai/graph-actions.controller');
  const { AiApprovalsController } = await import('../src/modules/ai/ai-approvals.controller');
  const { KeyInboxController } = await import('../src/modules/key-inbox/key-inbox.controller');
  const { AutopilotController } = await import('../src/modules/autopilot/autopilot.controller');
  const { BusinessGraphService } = await import('../src/modules/ai/business-graph.service');
  const { IntentParserService } = await import('../src/modules/ai/intent-parser.service');
  const { PlannerService } = await import('../src/modules/ai/planner.service');
  const { AiOversightService } = await import('../src/modules/ai/ai-oversight.service');
  const { FlowOrchestratorService } = await import('../src/modules/ai/flow-orchestrator.service');
  const { AiExecutionLogService } = await import('../src/modules/ai/ai-execution-log.service');
  const { WorkspaceRecommendationsService } = await import('../src/modules/ai/workspace-recommendations.service');
  const { AiApprovalsService } = await import('../src/modules/ai/ai-approvals.service');
  const { AiUsageService } = await import('../src/modules/ai/ai-usage.service');
  const { KeyInboxService } = await import('../src/modules/key-inbox/key-inbox.service');
  const { KeyInboxActionExecutorService } = await import('../src/modules/key-inbox/key-inbox-action-executor.service');
  const { KeyInboxIntelligenceService } = await import('../src/modules/key-inbox/key-inbox-intelligence.service');
  const { KeyInboxAnalysisService } = await import('../src/modules/key-inbox/key-inbox-analysis.service');
  const { KeyInboxActionService } = await import('../src/modules/key-inbox/key-inbox-action.service');
  const { KeyInboxTemporalEmitterService } = await import('../src/modules/key-inbox/key-inbox-temporal-emitter.service');
  const { KeyInboxReplySenderService } = await import('../src/modules/key-inbox/key-inbox-reply-sender.service');
  const { BusinessEventService } = await import('../src/modules/business-events/business-event.service');
  const { AutopilotService } = await import('../src/modules/autopilot/autopilot.service');
  const { AutopilotAiService } = await import('../src/modules/autopilot/autopilot-ai.service');
  const { DelegationLoopService } = await import('../src/modules/autopilot/delegation-loop.service');
  const { CrmTimelineService } = await import('../src/modules/crm/crm-timeline.service');

  const governance = {
    evaluate: async (_businessId: string, toolName: string) => {
      evaluations.push(toolName);
      const base = { allowed: true, requiresQuickConfirm: false, requiresFormalApproval: false, requiresAdminApproval: false, tier: 1 };
      return FORMAL_APPROVAL_TOOLS.has(toolName)
        ? { ...base, tier: 3, requiresFormalApproval: true, reason: 'Tier 3 action requires explicit approval before execution' }
        : { ...base, reason: 'v31b allows' };
    },
    createApprovalItem: async (businessId: string, data: any) =>
      db.aiApprovalItem.create({
        data: {
          id: `${P}approval_${Math.random().toString(36).slice(2, 10)}`,
          businessId,
          toolName: data.toolName,
          title: data.title,
          description: data.description ?? null,
          inputPayload: data.inputPayload ?? undefined,
          planId: data.planId ?? null,
          planStepId: data.planStepId ?? null,
          riskTier: 3,
        },
      }),
    resolveApproval: async (itemId: string, businessId: string, resolution: string, userId: unknown) => {
      resolutions.push({ kind: 'one', ids: [itemId], businessId, resolution, userId });
      return { id: itemId, status: resolution };
    },
    resolveApprovalsBatch: async (businessId: string, ids: string[], resolution: string, userId: unknown) => {
      resolutions.push({ kind: 'batch', ids, businessId, resolution, userId });
      return { succeeded: ids.length, failed: 0, total: ids.length };
    },
    getPendingApprovals: async () => [],
    getAutonomySettings: async () => ({ mode: 'pro_auto', maxAutoTier: 2, blockedTools: [], blockedModules: [] }),
  };

  const orchestrator = {
    executeToolDirect: async (businessId: string, toolName: string, args: unknown, planId?: string, planStepId?: string, action?: any) => {
      executions.push({ businessId, toolName, args, planId, planStepId, action });
      await pause(EXECUTOR_DELAY_MS);
      return { toolCallId: `manual_${toolName}`, name: toolName, result: { ok: true }, changedEntities: [], followOnSuggestions: [], success: true };
    },
  };

  /** Plan generation without an LLM: writes the plan the way PlannerService.createPlan does, and answers its shape (no step ids). */
  const createPlan = async (businessId: string, intent: any, userId?: string) => {
    const plan = await db.aiPlan.create({
      data: {
        id: `${P}planGen_${Math.random().toString(36).slice(2, 10)}`,
        businessId,
        userId: userId ?? null,
        objective: intent.objective,
        status: 'draft',
        maxRiskTier: 1,
        steps: { create: [{ order: 1, toolName: 'crm_add_note', action: 'Add a note', description: 'v31b', riskTier: 1, inputPayload: STORED_ARGS, status: 'pending' }] },
      },
      include: { steps: { orderBy: { order: 'asc' } } },
    });
    return {
      id: plan.id, status: plan.status, objective: plan.objective, urgency: plan.urgency, modules: plan.modules,
      maxRiskTier: plan.maxRiskTier, startedAt: null, completedAt: null, createdAt: plan.createdAt,
      steps: plan.steps.map((s: any) => ({ order: s.order, toolName: s.toolName, module: s.module, action: s.action, description: s.description ?? '', riskTier: s.riskTier, requiresApproval: false, dependsOn: [], inputPayload: s.inputPayload, expectedBenefit: null })),
    };
  };

  const moduleRef = await Test.createTestingModule({
    controllers: [GraphActionsController, AiApprovalsController, KeyInboxController, AutopilotController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      CrmRateLimitGuard,
      { provide: EventEmitter2, useValue: new EventEmitter2() },
      {
        provide: BusinessGraphService,
        useValue: { getSnapshot: async () => ({ links: [], entities: { topContacts: [], overdueInvoices: [], catalogProducts: [] }, automations: {} }) },
      },
      {
        provide: IntentParserService,
        useValue: { parse: async (_b: string, input: string) => ({ objective: input, rawInput: input, urgency: 'normal', modules: ['crm'], scope: [], missingInfo: [], actionCandidates: [], clarificationNeeded: false }) },
      },
      {
        provide: PlannerService,
        inject: [PrismaService],
        useFactory: (prisma: any) => {
          const planner: any = new (PlannerService as any)(prisma, {}, {}, {}, {}, {});
          planner.createPlan = createPlan;
          return planner;
        },
      },
      { provide: AiOversightService, useValue: governance },
      { provide: FlowOrchestratorService, useValue: orchestrator },
      { provide: AiExecutionLogService, useValue: {} },
      { provide: WorkspaceRecommendationsService, useValue: {} },
      AiApprovalsService,
      KeyInboxService,
      KeyInboxActionExecutorService,
      { provide: KeyInboxIntelligenceService, useValue: {} },
      { provide: KeyInboxAnalysisService, useValue: {} },
      { provide: KeyInboxActionService, useValue: {} },
      { provide: KeyInboxTemporalEmitterService, useValue: {} },
      { provide: KeyInboxReplySenderService, useValue: {} },
      { provide: AiUsageService, useValue: {} },
      { provide: BusinessEventService, useValue: { emit: async (e: any) => void businessEvents.push(e), getTimeline: async () => [] } },
      AutopilotService,
      { provide: CrmTimelineService, useValue: { logEvent: async (...args: any[]) => void timelineEvents.push(args) } },
      { provide: AutopilotAiService, useValue: {} },
      { provide: DelegationLoopService, useValue: {} },
    ],
  }).compile();

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

  await cleanup();

  for (const id of [ID.owner, ID.staffNoRev, ID.staffNoCrm, ID.other]) {
    await db.user.create({ data: { id, email: `${id}@test.local`, role: 'USER' } });
  }
  await db.business.create({ data: { id: ID.bizA, name: 'V31b Biz A', ownerId: ID.owner } });
  await db.business.create({ data: { id: ID.bizB, name: 'V31b Biz B', ownerId: ID.other } });
  const m = (userId: string, businessId: string, role: string, permissionScopes?: Record<string, string>) =>
    db.membership.create({ data: { id: `${P}m_${userId.slice(P.length)}_${businessId.slice(P.length)}`, userId, businessId, role, permissionScopes } });
  await m(ID.owner, ID.bizA, 'OWNER');
  await m(ID.staffNoRev, ID.bizA, 'STAFF', { crm: 'write', revenue: 'read', operations: 'write' });
  await m(ID.staffNoCrm, ID.bizA, 'STAFF', { crm: 'read', operations: 'write' });
  await m(ID.other, ID.bizB, 'OWNER');

  await db.contact.create({ data: { id: ID.contactA, businessId: ID.bizA, firstName: 'V31b A', visibility: 'TEAM' } });
  await db.contact.create({ data: { id: ID.contactB, businessId: ID.bizB, firstName: 'V31b B', visibility: 'TEAM' } });

  await db.aiPlan.create({ data: { id: ID.planA, businessId: ID.bizA, userId: ID.owner, objective: 'v31b plan A', status: 'draft' } });
  await db.aiPlan.create({ data: { id: ID.planB, businessId: ID.bizB, userId: ID.other, objective: 'v31b plan B', status: 'draft' } });
  await seedStep(ID.sStored, ID.planA, 1, 'crm_add_note', STORED_ARGS);
  await seedStep(ID.sConc, ID.planA, 2, 'crm_add_note', STORED_ARGS);
  await seedStep(ID.sRev, ID.planA, 3, 'commerce_mark_invoice_paid', { invoiceId: `${P}inv` });
  await seedStep(ID.sUnmapped, ID.planA, 4, 'execute_custom_logic', { code: 'return 1' });
  await seedStep(ID.sApproval, ID.planA, 5, 'crm_delete_contact', { contactId: ID.contactA });
  await seedStep(ID.sForeign, ID.planB, 1, 'crm_add_note', { contactId: ID.contactB, body: 'b' });

  await db.keyInboxThread.create({ data: { id: ID.threadA, businessId: ID.bizA, channel: 'email', contactId: ID.contactA, subject: 'v31b A' } });
  await db.keyInboxThread.create({ data: { id: ID.threadB, businessId: ID.bizB, channel: 'email', contactId: ID.contactB, subject: 'v31b B' } });
  await db.keyInboxMessage.create({
    data: { id: ID.msgA, businessId: ID.bizA, threadId: ID.threadA, channel: 'email', direction: 'INBOUND', contentText: 'hi', receivedAt: new Date(), suggestedActions: ACTIONS },
  });
  await db.keyInboxMessage.create({
    data: { id: ID.msgB, businessId: ID.bizB, threadId: ID.threadB, channel: 'email', direction: 'INBOUND', contentText: 'hi', receivedAt: new Date(), suggestedActions: [ACTIONS[0]] },
  });

  await db.autopilotTask.create({ data: { id: ID.taskA, businessId: ID.bizA, title: 'v31b approve me', category: 'OPERATIONS', status: 'AWAITING_APPROVAL', requiresApproval: true } });
  await db.aiApprovalItem.create({ data: { id: ID.itemA, businessId: ID.bizA, toolName: 'crm_add_note', title: 'v31b item', riskTier: 1 } });
}, 120_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
});

describe('fixture sanity (real rows)', () => {
  it('seeded the plans, steps, inbox thread and memberships', async () => {
    expect(await db.aiPlanStep.count({ where: { planId: ID.planA, status: 'pending' } })).toBe(5);
    expect(await db.membership.count({ where: { businessId: ID.bizA } })).toBe(3);
    const msg = await db.keyInboxMessage.findUnique({ where: { id: ID.msgA } });
    expect(msg.suggestedActions).toHaveLength(ACTIONS.length);
  });
});

describe('V1-31b GA: POST /actions/businesses/:businessId/execute executes only a stored plan step', () => {
  it('GA-01 a client tool name and arguments without a stored plan step are refused 400 and nothing runs', async () => {
    const before = executions.length;
    const res = await executeGraph(ID.owner, { toolName: 'crm_add_note', args: CLIENT_ARGS });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/plan step/i);
    expect(executions.length).toBe(before);
  });

  it('GA-02 a stored step runs its own tool and arguments; a client toolName and args sent beside the ids are ignored', async () => {
    const before = executions.length;
    const res = await executeGraph(ID.owner, { planId: ID.planA, planStepId: ID.sStored, toolName: 'crm_delete_contact', args: CLIENT_ARGS });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ success: true });
    const ran = executions.slice(before);
    expect(ran).toHaveLength(1);
    expect(ran[0]).toMatchObject({ businessId: ID.bizA, toolName: 'crm_add_note', args: STORED_ARGS, planId: ID.planA, planStepId: ID.sStored });
    expect(ran[0].action).toMatchObject({ surface: 'GRAPH_ACTION', principalUserId: ID.owner });
    expect(evaluations).not.toContain('crm_delete_contact');
    expect(await stepStatus(ID.sStored)).toBe('completed');

    // Spent: a replay runs nothing.
    const replay = await executeGraph(ID.owner, { planId: ID.planA, planStepId: ID.sStored });
    expect(replay.status).toBe(409);
    expect(executions.length).toBe(before + 1);
  });

  it("GA-03 another business's step id answers 404 byte-identical to an unknown id and runs nothing", async () => {
    const before = executions.length;
    const foreign = await executeGraph(ID.owner, { planId: ID.planB, planStepId: ID.sForeign });
    const unknown = await executeGraph(ID.owner, { planId: `${P}nope`, planStepId: `${P}nope` });
    const mixed = await executeGraph(ID.owner, { planId: ID.planA, planStepId: ID.sForeign });
    expect(foreign.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(mixed.status).toBe(404);
    expect(foreign.text).toBe(unknown.text);
    expect(mixed.text).toBe(unknown.text);
    expect(executions.length).toBe(before);
    expect(await stepStatus(ID.sForeign)).toBe('pending');
  });

  it('GA-04 eight concurrent executes of one stored step run it exactly once; the others are 409', async () => {
    const before = executions.length;
    const responses = await Promise.all(Array.from({ length: 8 }, () => executeGraph(ID.owner, { planId: ID.planA, planStepId: ID.sConc })));
    const statuses = responses.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(7);
    expect(executions.slice(before).filter((e) => e.planStepId === ID.sConc)).toHaveLength(1);
    expect(await stepStatus(ID.sConc)).toBe('completed');
  });

  it("GA-05 the executed tool's module write scope is checked: a member without revenue write is refused 403 and nothing runs", async () => {
    const before = executions.length;
    const res = await executeGraph(ID.staffNoRev, { planId: ID.planA, planStepId: ID.sRev });
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).toMatch(/revenue/);
    expect(executions.length).toBe(before);
    expect(await stepStatus(ID.sRev)).toBe('pending');
  });

  it('GA-06 a tool mapped to no module scope is denied by default, even to the OWNER', async () => {
    const before = executions.length;
    const res = await executeGraph(ID.owner, { planId: ID.planA, planStepId: ID.sUnmapped });
    expect(res.status).toBe(403);
    expect(executions.length).toBe(before);
    expect(await stepStatus(ID.sUnmapped)).toBe('pending');
  });

  it('GA-07 a stored step that needs formal approval queues one approval item with the stored payload, requested by the real user', async () => {
    const before = executions.length;
    const res = await executeGraph(ID.owner, { planId: ID.planA, planStepId: ID.sApproval, args: CLIENT_ARGS });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ success: false, requiresApproval: true, approvalId: expect.any(String) });
    const item = await db.aiApprovalItem.findUnique({ where: { id: res.body.approvalId } });
    expect(item).toMatchObject({ businessId: ID.bizA, toolName: 'crm_delete_contact', planId: ID.planA, planStepId: ID.sApproval, userId: ID.owner });
    expect(item.inputPayload).toEqual({ contactId: ID.contactA });
    expect(await stepStatus(ID.sApproval)).toBe('awaiting_approval');
    expect(executions.length).toBe(before);

    const again = await executeGraph(ID.owner, { planId: ID.planA, planStepId: ID.sApproval });
    expect(again.status).toBe(409);
    expect(await db.aiApprovalItem.count({ where: { businessId: ID.bizA, planStepId: ID.sApproval } })).toBe(1);
  });

  it('GA-08 no principal is 401 and runs nothing', async () => {
    const before = executions.length;
    const res = await executeGraph(null, { planId: ID.planA, planStepId: ID.sRev });
    expect(res.status).toBe(401);
    expect(executions.length).toBe(before);
  });

  it('GA-09 the plan route answers the stored step ids the execute route takes', async () => {
    const res = await http().post(`/actions/businesses/${ID.bizA}/plan`).set('x-test-user', ID.owner).send({ input: 'note the client' });
    expect(res.status).toBe(201);
    const steps = res.body.plan.steps;
    const rows = await db.aiPlanStep.findMany({ where: { planId: res.body.plan.id }, orderBy: { order: 'asc' } });
    expect(steps.map((s: any) => s.id)).toEqual(rows.map((r: any) => r.id));
  });
});

describe('V1-31b AA: ai-approvals resolution records the real principal', () => {
  it('AA-01 resolve and bulk-resolve hand the authenticated user to oversight', async () => {
    resolutions.length = 0;
    const one = await http().post(`/ai-approvals/businesses/${ID.bizA}/items/${ID.itemA}/resolve`).set('x-test-user', ID.owner).send({ resolution: 'approved' });
    const bulk = await http().post(`/ai-approvals/businesses/${ID.bizA}/items/bulk-resolve`).set('x-test-user', ID.owner).send({ ids: [ID.itemA], resolution: 'rejected' });
    expect(one.status).toBe(201);
    expect(bulk.status).toBe(201);
    expect(resolutions.map((r) => r.userId)).toEqual([ID.owner, ID.owner]);
  });

  it('AA-02 without a principal both routes answer 401 and resolve nothing', async () => {
    resolutions.length = 0;
    const one = await http().post(`/ai-approvals/businesses/${ID.bizA}/items/${ID.itemA}/resolve`).send({ resolution: 'approved' });
    const bulk = await http().post(`/ai-approvals/businesses/${ID.bizA}/items/bulk-resolve`).send({ ids: [ID.itemA], resolution: 'approved' });
    expect([one.status, bulk.status]).toEqual([401, 401]);
    expect(resolutions).toEqual([]);
  });
});

describe('V1-31b KI: key-inbox executes a stored suggestion once, under its module scope', () => {
  it('KI-01 a payloadOverride key the suggestion does not let a member edit is refused 400; nothing is written', async () => {
    const tasksBefore = (await contactTasks()).length;
    const eventsBefore = businessEvents.length;
    const res = await executeInbox(ID.owner, ID.threadA, 0, { confirmed: true, messageId: ID.msgA, payloadOverride: { title: 'v31b x', contactId: ID.contactB } });
    expect(res.status).toBe(400);
    expect((await contactTasks()).length).toBe(tasksBefore);
    expect(businessEvents.length).toBe(eventsBefore);
  });

  it('KI-02 eight concurrent executes of one suggestion create one task; the others are 409', async () => {
    const responses = await Promise.all(
      Array.from({ length: 8 }, () => executeInbox(ID.owner, ID.threadA, 1, { confirmed: true, messageId: ID.msgA })),
    );
    const statuses = responses.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(7);
    expect(await contactTasks('v31b stored title 1')).toHaveLength(1);
  });

  it('KI-03 a create_task suggestion needs crm write: a member with crm read is refused 403 and no task is written', async () => {
    const res = await executeInbox(ID.staffNoCrm, ID.threadA, 2, { confirmed: true, messageId: ID.msgA });
    expect(res.status).toBe(403);
    expect(await contactTasks('v31b stored title 2')).toHaveLength(0);
  });

  it('KI-04 a suggestion type mapped to no module scope is refused 400 before any event or execution', async () => {
    const eventsBefore = businessEvents.length;
    const res = await executeInbox(ID.owner, ID.threadA, 3, { confirmed: true, messageId: ID.msgA });
    expect(res.status).toBe(400);
    expect(businessEvents.length).toBe(eventsBefore);
  });

  it("KI-05 another business's thread answers 404 byte-identical to an unknown thread", async () => {
    const foreign = await executeInbox(ID.owner, ID.threadB, 0, { confirmed: true });
    const unknown = await executeInbox(ID.owner, `${P}nothread`, 0, { confirmed: true });
    expect(foreign.status).toBe(404);
    expect(foreign.text).toBe(unknown.text);
  });

  it('KI-06 an editable title is honoured and the events name the real user', async () => {
    businessEvents.length = 0;
    const res = await executeInbox(ID.owner, ID.threadA, 4, { confirmed: true, messageId: ID.msgA, payloadOverride: { title: 'v31b edited title' } });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ success: true, type: 'create_task' });
    expect(await contactTasks('v31b edited title')).toHaveLength(1);
    expect(businessEvents.map((e) => e.actorId)).toEqual([ID.owner, ID.owner]);
  });
});

describe('V1-31b AP: autopilot', () => {
  it('AP-01 actions/:actionId/execute has no stored proposal to bind: it is refused 410 and writes nothing', async () => {
    timelineEvents.length = 0;
    const res = await http()
      .post(`/autopilot/businesses/${ID.bizA}/actions/checkin_${ID.contactA}/execute`)
      .set('x-test-user', ID.owner)
      .send({ contactId: ID.contactB, channel: 'whatsapp', message: 'v31b forged send' });
    expect(res.status).toBe(410);
    expect(timelineEvents).toEqual([]);
  });

  it('AP-02 approving an autopilot task records the authenticated user, not the body approvedBy', async () => {
    const res = await http()
      .post(`/autopilot/businesses/${ID.bizA}/tasks/${ID.taskA}/approve`)
      .set('x-test-user', ID.owner)
      .send({ approvedBy: `${P}someone_else` });
    expect(res.status).toBe(201);
    const task = await db.autopilotTask.findUnique({ where: { id: ID.taskA } });
    expect(task.approvedBy).toBe(ID.owner);
  });
});

/* ------------------------------------------------------------------------ */
/*  Census: no controller route passes request-body tool names/arguments    */
/*  to an executor unless it is listed here with a reason.                  */
/* ------------------------------------------------------------------------ */

/**
 * WHAT IS READ (typescript AST, every non-test *.controller.ts under apps/server/src):
 * each route handler (a method decorated Get/Post/Put/Patch/Delete/All) and
 * its @Body() parameters. A value is BODY-DERIVED when it is the body
 * parameter itself, any property of it other than an id (a name that is `id`
 * or ends in `Id`/`Ids` selects a stored row), or a local whose initializer
 * contains such a value (in source order, so taint carries through locals).
 * A handler is FLAGGED when it passes a body-derived value in the arguments of
 * an EXECUTOR call: executeToolDirect, executeToolDirectly, executeTool,
 * executeToolAction, autoExecuteToolForMonitoring, handleToolBridge,
 * confirmAndExecute, executeBatch, applyTemplate, executeApproved, `.execute(...)`
 * or `.executeAction(...)` on any receiver other than bare `this`, or a call of
 * innerToolExecutor.
 *
 * WHAT IS REQUIRED: the flagged handlers are exactly KNOWN_BODY_EXECUTORS. A new
 * one fails until it is bound to a stored proposal or listed with a reason; a
 * listed one that no longer passes body data fails until its entry is removed.
 *
 * WHAT THIS CANNOT DO: it does not follow a body value through a call into
 * another method (`this.helper(body)` that executes is not seen), and it trusts
 * the id naming rule. Real behaviour is proven by the HTTP cases above.
 */
const KNOWN_BODY_EXECUTORS: Record<string, { kind: 'bounded' | 'open'; reason: string }> = {
  'modules/key-inbox/key-inbox.controller.ts#KeyInboxController.executeAction': {
    kind: 'bounded',
    reason:
      'V1-31b: the action (type, thread, contact) is the stored suggestion by index; the only body data passed is the member-edited text the confirm dialog shows (title; title and dueDate; draft/content), per type, every other key refused 400 (KI-01).',
  },
  'modules/ai/code-executor.controller.ts#CodeExecutorController.toolBridge': {
    kind: 'bounded',
    reason:
      'E2B sandbox bridge, not a member route: a server-minted one-time execution token bound to one business; tier 1-2 tools only, a budget per execution (CodeExecutorService.validateToolCall).',
  },
  'modules/command/command.controller.ts#CommandController.execute': {
    kind: 'bounded',
    reason:
      'Runs no tool: CommandService.execute marks a stored CommandItem (by id, in the business) EXECUTED and stores the body result as the outcome the member reports. (Its timeline actorType for a KEY-executable item is a G5-EB matter.)',
  },
  'modules/key-cortex/key-cortex.controller.ts#KeyCortexController.flowApplyTemplate': {
    kind: 'bounded',
    reason:
      'Runs nothing: KeyCortexFlowStudioService.applyTemplate builds a flow definition from a built-in template with the member name and parameters; the flow only runs through flows/:id/execute (open below).',
  },
  'modules/key-cortex/key-cortex.controller.ts#KeyCortexController.executeCommand': {
    kind: 'open',
    reason: 'POST api/v1/cortex/execute: a structured dto.module/dto.action/dto.parameters runs through KeyCortexExecutorService (autonomy gate only). Outside the V1-31b write set.',
  },
  'modules/key-cortex/key-cortex.controller.ts#KeyCortexController.executeBatch': {
    kind: 'open',
    reason: 'POST api/v1/cortex/batch: client commands (module/action/parameters) through executeBatch. Outside the V1-31b write set.',
  },
  'modules/key-cortex/key-cortex.controller.ts#KeyCortexController.sandboxExecute': {
    kind: 'open',
    reason: 'POST api/v1/cortex/sandbox/execute: client code in the cortex sandbox. Outside the V1-31b write set.',
  },
  'modules/key-cortex/key-cortex.controller.ts#KeyCortexController.sandboxApply': {
    kind: 'open',
    reason: 'POST api/v1/cortex/sandbox/apply: a stored template with client parameters. Outside the V1-31b write set.',
  },
  'modules/key-cortex/key-cortex.controller.ts#KeyCortexController.flowExecute': {
    kind: 'open',
    reason: 'POST api/v1/cortex/flows/:id/execute: a stored flow by id with client inputs. Outside the V1-31b write set.',
  },
};

const SRC = path.resolve(__dirname, '../src');
const ROUTE_DECORATORS = new Set(['Get', 'Post', 'Put', 'Patch', 'Delete', 'All']);
const ALWAYS_EXECUTORS = new Set([
  'executeToolDirect', 'executeToolDirectly', 'executeTool', 'executeToolAction', 'autoExecuteToolForMonitoring',
  'handleToolBridge', 'confirmAndExecute', 'executeBatch', 'applyTemplate', 'executeApproved',
]);
const ID_FIELD = /^(id|ids|.*Id|.*Ids)$/;

function listControllerFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) listControllerFiles(full, out);
    else if (name.endsWith('.controller.ts')) out.push(full);
  }
  return out;
}

function decoratorName(d: ts.Decorator): string | undefined {
  const e = d.expression;
  if (ts.isCallExpression(e) && ts.isIdentifier(e.expression)) return e.expression.text;
  if (ts.isIdentifier(e)) return e.text;
  return undefined;
}

function decoratorsOf(node: ts.Node): readonly ts.Decorator[] {
  return (ts.canHaveDecorators(node) ? ts.getDecorators(node) : undefined) ?? [];
}

function isExecutorCall(call: ts.CallExpression): boolean {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return callee.text === 'innerToolExecutor';
  if (!ts.isPropertyAccessExpression(callee)) return false;
  const name = callee.name.text;
  if (ALWAYS_EXECUTORS.has(name)) return true;
  const bareThis = callee.expression.kind === ts.SyntaxKind.ThisKeyword;
  return (name === 'execute' || name === 'executeAction') && !bareThis;
}

/** True when `node` contains a body-derived value (see the census comment). */
function carriesBody(node: ts.Node, body: ReadonlySet<string>, tainted: ReadonlySet<string>): boolean {
  let found = false;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (ts.isIdentifier(n)) {
      const parent = n.parent;
      // The name side of `x.name`, a property key, or a declared name is not a read.
      if (parent && ts.isPropertyAccessExpression(parent) && parent.name === n) return;
      if (parent && (ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent) || ts.isMethodDeclaration(parent)) && parent.name === n) return;
      if (parent && ts.isVariableDeclaration(parent) && parent.name === n) return;
      if (tainted.has(n.text)) { found = true; return; }
      if (body.has(n.text)) {
        if (parent && ts.isPropertyAccessExpression(parent) && parent.expression === n && ID_FIELD.test(parent.name.text)) return;
        found = true;
        return;
      }
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

function bindingNames(name: ts.BindingName, out: string[] = []): string[] {
  if (ts.isIdentifier(name)) out.push(name.text);
  else for (const el of name.elements) if (!ts.isOmittedExpression(el)) bindingNames(el.name, out);
  return out;
}

/** The flagged route handlers of one source file, as `<rel>#<Class>.<method>`. */
function flaggedHandlers(fileName: string, text: string): string[] {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const flagged: string[] = [];
  const visitClass = (cls: ts.ClassDeclaration) => {
    for (const member of cls.members) {
      if (!ts.isMethodDeclaration(member) || !member.body) continue;
      if (!decoratorsOf(member).some((d) => ROUTE_DECORATORS.has(decoratorName(d) ?? ''))) continue;
      const body = new Set<string>();
      for (const p of member.parameters) {
        if (decoratorsOf(p).some((d) => decoratorName(d) === 'Body')) bindingNames(p.name, []).forEach((n) => body.add(n));
      }
      if (body.size === 0) continue;
      const tainted = new Set<string>();
      let passes = false;
      const walk = (n: ts.Node): void => {
        if (ts.isVariableDeclaration(n) && n.initializer && carriesBody(n.initializer, body, tainted)) {
          if (ts.isObjectBindingPattern(n.name) && ts.isIdentifier(n.initializer) && body.has(n.initializer.text)) {
            for (const el of n.name.elements) {
              const key = el.propertyName && ts.isIdentifier(el.propertyName) ? el.propertyName.text : ts.isIdentifier(el.name) ? el.name.text : '';
              if (!ID_FIELD.test(key)) bindingNames(el.name).forEach((x) => tainted.add(x));
            }
          } else {
            bindingNames(n.name).forEach((x) => tainted.add(x));
          }
        }
        if (ts.isCallExpression(n) && isExecutorCall(n) && n.arguments.some((a) => carriesBody(a, body, tainted))) passes = true;
        ts.forEachChild(n, walk);
      };
      walk(member.body);
      if (passes) flagged.push(`${path.relative(SRC, fileName).split(path.sep).join('/')}#${cls.name?.text ?? '?'}.${(member.name as ts.Identifier).text}`);
    }
  };
  const top = (n: ts.Node): void => {
    if (ts.isClassDeclaration(n)) visitClass(n);
    ts.forEachChild(n, top);
  };
  top(sf);
  return flagged;
}

describe('V1-31b CS: census of controller routes that hand request-body tool names or arguments to an executor', () => {
  it('CS-01 the flagged routes are exactly the known, reasoned list (a new one fails)', () => {
    const flagged = listControllerFiles(SRC).flatMap((f) => flaggedHandlers(f, readFileSync(f, 'utf8'))).sort();
    expect(flagged).toEqual(Object.keys(KNOWN_BODY_EXECUTORS).sort());
  });

  it('CS-02 the reader flags a body tool name, a tainted local and the whole body, and not a stored-id lookup', () => {
    const src = `
      class Synthetic {
        @Post('a') a(@Body() body: any) { return this.orchestrator.executeToolDirect(b, body.toolName, {}); }
        @Post('b') b(@Body() dto: any) { const cmd = { module: dto.module, action: dto.action }; return this.executor.execute(cmd); }
        @Post('c') c(@Body() body: any) { return this.bridge.handleToolBridge(token, body ?? {}); }
        @Post('d') async d(@Body() body: any) {
          const step = await this.prisma.client.aiPlanStep.findFirst({ where: { id: body.planStepId } });
          return this.orchestrator.executeToolDirect(b, step.toolName, step.inputPayload, body.planId, body.planStepId);
        }
        @Post('e') e(@Body() { toolName }: any) { return this.orchestrator.executeTool(b, toolName, {}); }
      }`;
    expect(flaggedHandlers(path.join(SRC, 'modules/x/synthetic.controller.ts'), src)).toEqual([
      'modules/x/synthetic.controller.ts#Synthetic.a',
      'modules/x/synthetic.controller.ts#Synthetic.b',
      'modules/x/synthetic.controller.ts#Synthetic.c',
      'modules/x/synthetic.controller.ts#Synthetic.e',
    ]);
  });

  describe('routes outside the V1-31b write set that still pass body data to an executor (follow-up packets)', () => {
    for (const [key, entry] of Object.entries(KNOWN_BODY_EXECUTORS)) {
      if (entry.kind === 'open') it.todo(`${key}: ${entry.reason} Bind it to a stored proposal by id, or refuse it.`);
    }
  });
});
