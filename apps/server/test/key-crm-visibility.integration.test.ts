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
 * runs with no member (D-88's convention). One visibility clause (contactReadAccess: resolveCrmAccess
 * + visibilityClause, the rule GET contacts applies) bounds every case.
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

/** Every tool the plan-queue dispatcher handed the flow orchestrator. */
const dispatched: Array<{ toolName: string; planStepId?: string; principal: unknown }> = [];

async function cleanup() {
  for (const sql of [
    `DELETE FROM ai_execution_logs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM ai_plans WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM crm_sequence_enrollments WHERE sequence_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM crm_sequences WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_tasks WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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
async function runQueueStep(planId: string, toolName: string, args: Record<string, unknown>) {
  const stepId = `${planId}_s1`;
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
  ({ noMemberToolRefusal } = (await import('../src/modules/ai/plan-step-authority')) as any);
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

  const testing = await Test.createTestingModule({
    controllers: [GraphActionsController],
    providers: [
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

  await cleanup(); // in case a prior run aborted

  for (const name of ['owner', 'admin', 'staffOwned'] as const) {
    await db.user.create({ data: { id: ID[name], email: `${P}${name}@test.local`, role: 'USER' } });
  }
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

describe("W3-KEY-CRM-VISIBILITY (D-37, D-88): a member's plan run with no principal is the OWNER's only for these tools; a plan with no member keeps the OWNER's view", () => {
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

  it("CV-08 CONTROL (D-88): the OWNER's plan runs fetch_client_health on the queue over the whole book; a plan with no member is not refused these tools and runs them in the OWNER's view (the PRIVATE top spender named, every overdue contact enrolled)", async () => {
    const owner = `${P}cv08_owner`;
    await seedPlan(owner, ID.owner, 'fetch_client_health', {}, 'approved');
    await runQueueStep(owner, 'fetch_client_health', {});
    const ownerRow = await stepRow(owner);
    expect(ownerRow.status, String(ownerRow.errorMessage)).toBe('completed');
    expect(JSON.stringify(ownerRow.outputResult)).toContain(NAME.priv);

    expect(noMemberToolRefusal('fetch_client_health')).toBeNull();
    expect(noMemberToolRefusal('sequence_enroll_overdue')).toBeNull();
    const none = `${P}cv08_none`;
    await seedPlan(none, null, 'fetch_client_health', {}, 'approved');
    await runQueueStep(none, 'fetch_client_health', {});
    const noneRow = await stepRow(none);
    expect(noneRow.status, String(noneRow.errorMessage)).toBe('completed');
    expect(JSON.stringify(noneRow.outputResult)).toContain(NAME.priv);
    expect(dispatched.find((d) => d.planStepId === `${none}_s1`)?.principal).toBeUndefined();

    const noneSeq = `${P}cv08_none_seq`;
    await seedPlan(noneSeq, null, 'sequence_enroll_overdue', { sequenceId: ID.seqQueueNone }, 'approved');
    await runQueueStep(noneSeq, 'sequence_enroll_overdue', { sequenceId: ID.seqQueueNone });
    expect((await stepRow(noneSeq)).status).toBe('completed');
    expect(await enrolledIn(ID.seqQueueNone)).toEqual(ALL);
  });
});
