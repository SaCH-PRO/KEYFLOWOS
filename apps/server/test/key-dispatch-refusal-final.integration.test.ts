/**
 * W11-DISPATCH-REFUSAL-FINAL (owner ruling D-134; DS-05 and DS-06 of
 * src/modules/ai/flow-orchestrator-dispatch-status.spec.ts) on the real database: what the plan queue does
 * with a step whose tool answers 400 or 409.
 *
 * Before this packet FlowOrchestratorService.executeToolDirectly handed the dispatcher every 400 and 409 as a
 * plain Error (W10-DISPATCH-STATUS review CR-W10DS-1), and validateToolInput's refusal was a plain Error on
 * every surface. So a member's step the tool can only ever refuse (a task that needs evidence, an argument
 * the tool's schema does not take) was tried three times, and five such steps opened that business's
 * circuit for the tool: the OWNER's next, valid step was answered 'Circuit breaker open' (the QW-07b class).
 *
 *   RF-01  a 400 the tool itself answers (ProjectsService's evidence gate) is answered once and counted
 *          toward no circuit: six refused steps leave projects_complete_task running for the business.
 *   RF-02  a call the tool's schema refuses (validateToolInput) reaches the dispatcher as a 400, before the
 *          tool does any work: answered once, not counted.
 *   RF-03  the one 409 a service marks retryable (ProjectsService.updateTask's stale write,
 *          RetryableConflictException) is still retried, and completes when the race clears; a race that
 *          never clears is a failure counted once, toward that business's circuit only.
 *   RF-04  control (tenancy): another business's plan step naming this business's task is the tool's own
 *          404, answered once, not counted, and the task is untouched.
 *
 * Real: PrismaService, the plan-queue worker body (QueueService.processPlanStep with the real
 * planStepRunRefusal gate), ActionDispatcherService, AiExecutionLogService, FlowOrchestratorService's
 * executeToolDirectly, executeTool, validateToolInput, memberScopeRefusal and executeToolAction (the
 * projects_complete_task case), ProjectsService, TimelineService and EvidenceService, against DATABASE_URL.
 * Stand-ins: governance (allows), the event emitters, the plan state machine, and the dispatcher's retry
 * spacing (production waits 1 s and 3 s; the attempts are production's). RF-03's race is a second writer on
 * the same row through the same database, landed between updateTask's read and its conditional write.
 *
 * Fixtures: prefix `v99r_` (registered in test/helpers/fixture-prefixes.json), hard-deleted by raw SQL
 * with sqlLikePrefix() in beforeAll and afterAll.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { BadRequestException, ConflictException, HttpException, Logger, NotFoundException } from '@nestjs/common';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v99r_';
vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const ID = {
  ownerA: `${P}owner_a`,
  ownerB: `${P}owner_b`,
  bizA: `${P}biz_a`,
  bizB: `${P}biz_b`,
  projectA: `${P}project_a`,
  projectB: `${P}project_b`,
  taskEvidence: `${P}task_evidence`, // bizA, evidenceRequired, none filed: completing it is a 400
  taskPlain: `${P}task_plain`, // bizA
  taskRace: `${P}task_race`, // bizA
  taskRaceLost: `${P}task_race_lost`, // bizA
  taskTenancy: `${P}task_tenancy`, // bizA, named by bizB's plan
  taskB: `${P}task_b`, // bizB
};
const TOOL = 'projects_complete_task';
const CONFLICT = 'The task changed while it was being updated; try again';
const EVIDENCE_REFUSAL = 'This task requires evidence before completion. Please submit proof (photo, file, note, etc.) and try again.';
const CLOSED = { open: false, failures: 0, lastFailure: null };

let db: any;
let prisma: any;
let flow: any;
let RetryableConflictException: any;
let makeWorker: () => { worker: any; dispatcher: any };

/** What executeToolDirectly threw at the dispatcher, per plan step, in order. */
const delivered: Array<{ planStepId?: string; error: unknown }> = [];
/** Every call the dispatcher made to executeToolDirectly, per plan step. */
const attempts: Array<{ planStepId?: string }> = [];
/** Calls that reached the real ProjectsService.updateTask. */
const toolWork: Array<{ businessId: string; taskId: string }> = [];
/** RF-03: how many of updateTask's next conditional writes lose to a second writer, and on which task. */
const race = { taskId: '', remaining: 0 };

async function cleanup() {
  for (const sql of [
    `DELETE FROM ai_execution_logs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM ai_plans WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM activities WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM project_tasks WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM projects WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM business_settings WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

/** An ai plan as the plan queue holds it (approved), its one step `TOOL` with `args`. */
async function seedQueuePlan(id: string, userId: string, businessId: string, args: Record<string, unknown>) {
  await db.aiPlan.create({
    data: {
      id, businessId, userId, objective: `v99r ${id}`, status: 'approved',
      steps: { create: [{ id: `${id}_s1`, order: 1, toolName: TOOL, action: TOOL, module: 'ai', status: 'pending', inputPayload: args }] },
    },
  });
  return `${id}_s1`;
}

/** Runs the plan-queue worker body on the plan's one step, as BullMQ hands it a job (retryCount 2, as PlanExecutorService enqueues it). */
function runQueueStep(worker: any, planId: string, businessId: string, args: Record<string, unknown>) {
  const stepId = `${planId}_s1`;
  const job = {
    data: {
      planId, stepId, businessId, toolName: TOOL, args, order: 1, dependsOn: [], retryCount: 2,
      idempotencyKey: `${planId}_job`, planContext: { planId, planStepId: stepId },
    },
  };
  return worker.processPlanStep(job).then((r: unknown) => ({ ok: true, value: r }), (e: unknown) => ({ ok: false, error: e }));
}

const stepRow = (stepId: string) => db.aiPlanStep.findUnique({ where: { id: stepId }, select: { status: true, errorMessage: true } });
const taskRow = (id: string) => db.projectTask.findUnique({ where: { id }, select: { businessId: true, isCompleted: true, status: true } });
const attemptsFor = (stepId: string) => attempts.filter((a) => a.planStepId === stepId).length;
const deliveredFor = (stepId: string) => delivered.filter((d) => d.planStepId === stepId).map((d) => d.error);
const toolWorkFor = (taskId: string) => toolWork.filter((w) => w.taskId === taskId).length;

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;
  const tenant = await import('../src/core/tenant/tenant-context');
  dbMod.setTenantContextProvider({ getCurrentBusinessId: tenant.getCurrentBusinessId });

  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AiExecutionLogService } = await import('../src/modules/ai/ai-execution-log.service');
  const { ActionDispatcherService } = await import('../src/modules/ai/action-dispatcher.service');
  const { QueueService } = await import('../src/modules/ai/queue.service');
  const { FlowOrchestratorService } = await import('../src/modules/ai/flow-orchestrator.service');
  const { ProjectsService } = await import('../src/modules/projects/projects.service');
  const { TimelineService } = await import('../src/modules/timeline/timeline.service');
  const { EvidenceService } = await import('../src/modules/evidence/evidence.service');
  // Absent on the packet base (the RED there is each case's own: this stays undefined).
  ({ RetryableConflictException } = await import('../src/core/utils/retryable-conflict').catch(() => ({ RetryableConflictException: undefined })) as any);

  prisma = new PrismaService();
  const events = { emit: () => true };

  // ProjectsService reads and writes through the real client. RF-03: while `race.remaining` is positive, a
  // second writer moves the task's status after updateTask's read and before its conditional write.
  const racingClient = new Proxy(prisma.client, {
    get(target, prop, receiver) {
      if (prop !== '$transaction') return Reflect.get(target, prop, receiver);
      return async (...args: unknown[]) => {
        if (race.remaining > 0) {
          race.remaining -= 1;
          const row = await db.projectTask.findUnique({ where: { id: race.taskId }, select: { status: true } });
          await db.projectTask.update({ where: { id: race.taskId }, data: { status: row.status === 'TODO' ? 'IN_PROGRESS' : 'TODO' } });
        }
        return (target as any).$transaction(...args);
      };
    },
  });
  const racingPrisma = Object.create(prisma, { client: { get: () => racingClient } });
  const projects = new ProjectsService(
    racingPrisma,
    events as any,
    new TimelineService(prisma),
    new EvidenceService(prisma, {} as any, events as any),
    {} as any,
  );
  const realUpdateTask = projects.updateTask.bind(projects);
  projects.updateTask = async (businessId: string, taskId: string, ...rest: any[]) => {
    toolWork.push({ businessId, taskId });
    return (realUpdateTask as any)(businessId, taskId, ...rest);
  };

  flow = Object.create(FlowOrchestratorService.prototype);
  Object.assign(flow, {
    prisma,
    logger: new Logger('v99r-flow'),
    governance: { getToolTier: () => 1 },
    executionLog: new AiExecutionLogService(prisma),
    businessGraph: { invalidateCache: () => undefined },
    moduleRef: {
      get: (token: unknown) => {
        if (token === ProjectsService) return projects;
        throw new Error(`v99r: the harness resolves ProjectsService only, not ${String((token as any)?.name ?? token)}`);
      },
    },
  });

  const realExecuteToolDirectly = FlowOrchestratorService.prototype.executeToolDirectly;
  const flowAsProduction = {
    executeToolDirectly: async (businessId: string, toolName: string, args: Record<string, unknown>, planContext?: { planId: string; planStepId: string }, action?: any) => {
      attempts.push({ planStepId: planContext?.planStepId });
      try {
        return await realExecuteToolDirectly.call(flow, businessId, toolName, args, planContext, action);
      } catch (e) {
        delivered.push({ planStepId: planContext?.planStepId, error: e });
        throw e;
      }
    },
  };
  const ALLOW = { allowed: true, tier: 1, reason: 'v99r: allowed', requiresFormalApproval: false, requiresAdminApproval: false, requiresQuickConfirm: false };
  const governance = { evaluate: async () => ({ ...ALLOW }), evaluateAutoApproval: async () => ({ ...ALLOW, autoApproved: true }), getToolTier: () => 1 };
  // Each case runs on a worker of its own (its own ActionDispatcherService), so no circuit leaks between cases.
  makeWorker = () => {
    const executionLog = new AiExecutionLogService(prisma);
    const dispatcher = new ActionDispatcherService(prisma, events as any, executionLog, governance as any, flowAsProduction as any, { registerAction: async () => undefined } as any);
    (dispatcher as unknown as { RETRY_DELAYS: number[] }).RETRY_DELAYS = [0, 0];
    const worker = Object.create(QueueService.prototype);
    Object.assign(worker, {
      prisma, events, governance, executionLog, actionDispatcher: dispatcher, flowOrchestrator: flowAsProduction,
      stateMachine: { transition: async () => undefined },
      logger: new Logger('v99r-queue'),
    });
    return { worker, dispatcher };
  };

  await cleanup();
  for (const id of [ID.ownerA, ID.ownerB]) {
    await db.user.create({ data: { id, email: `${P}${id.slice(P.length)}@test.local`, role: 'USER' } });
  }
  await db.business.create({ data: { id: ID.bizA, name: 'V99R Biz A', ownerId: ID.ownerA } });
  await db.business.create({ data: { id: ID.bizB, name: 'V99R Biz B', ownerId: ID.ownerB } });
  await db.membership.create({ data: { id: `${P}m_a`, userId: ID.ownerA, businessId: ID.bizA, role: 'OWNER' } });
  await db.membership.create({ data: { id: `${P}m_b`, userId: ID.ownerB, businessId: ID.bizB, role: 'OWNER' } });
  for (const businessId of [ID.bizA, ID.bizB]) {
    await db.businessSetting.create({ data: { id: `${P}setting_${businessId.slice(P.length)}`, businessId, aiAutonomyLevel: 'full', aiAlwaysRequireApproval: [] } });
  }
  await db.project.create({ data: { id: ID.projectA, businessId: ID.bizA, name: 'V99R Project A' } });
  await db.project.create({ data: { id: ID.projectB, businessId: ID.bizB, name: 'V99R Project B' } });
  const task = (id: string, businessId: string, projectId: string, extra: Record<string, unknown> = {}) =>
    db.projectTask.create({ data: { id, businessId, projectId, title: `v99r ${id}`, ...extra } });
  await task(ID.taskEvidence, ID.bizA, ID.projectA, { evidenceRequired: true });
  await task(ID.taskPlain, ID.bizA, ID.projectA);
  await task(ID.taskRace, ID.bizA, ID.projectA);
  await task(ID.taskRaceLost, ID.bizA, ID.projectA);
  await task(ID.taskTenancy, ID.bizA, ID.projectA);
  await task(ID.taskB, ID.bizB, ID.projectB);
}, 180_000);

afterAll(async () => {
  if (db) {
    await cleanup();
    // cleanup() is best-effort per statement, so a failed delete would leave rows silently: none may remain.
    const left = await db.$queryRawUnsafe(
      `SELECT (SELECT count(*) FROM businesses WHERE id LIKE ${sqlLikePrefix(P)})::int AS businesses,
              (SELECT count(*) FROM users WHERE id LIKE ${sqlLikePrefix(P)})::int AS users,
              (SELECT count(*) FROM project_tasks WHERE business_id LIKE ${sqlLikePrefix(P)})::int AS tasks,
              (SELECT count(*) FROM ai_plans WHERE business_id LIKE ${sqlLikePrefix(P)})::int AS plans,
              (SELECT count(*) FROM ai_execution_logs WHERE business_id LIKE ${sqlLikePrefix(P)})::int AS logs,
              (SELECT count(*) FROM activities WHERE business_id LIKE ${sqlLikePrefix(P)})::int AS activities`,
    );
    expect(left).toEqual([{ businesses: 0, users: 0, tasks: 0, plans: 0, logs: 0, activities: 0 }]);
  }
  const dbMod = await import('@keyflow/db');
  dbMod.setTenantContextProvider({ getCurrentBusinessId: () => undefined });
});

describe('W11-DISPATCH-REFUSAL-FINAL (D-134): the plan queue answers a tool\'s 400 and plain 409 once, uncounted; the marked 409 is retried (real Postgres)', () => {
  it('RF-01 RED-BEFORE: a 400 the tool itself answers (the evidence gate of ProjectsService.updateTask) reaches the dispatcher as the BadRequestException, is answered once and counts toward no circuit: threshold+1 refused steps leave projects_complete_task running for the business, and another business is unaffected', async () => {
    const { worker, dispatcher } = makeWorker();
    const threshold = (dispatcher as unknown as { CIRCUIT_THRESHOLD: number }).CIRCUIT_THRESHOLD;
    expect(threshold).toBeGreaterThan(0); // else the loops below would run nothing
    const args = { taskId: ID.taskEvidence };
    for (let i = 1; i <= threshold + 1; i++) {
      const planId = `${P}rf01_refused_${i}`;
      const stepId = await seedQueuePlan(planId, ID.ownerA, ID.bizA, args);
      const ran = await runQueueStep(worker, planId, ID.bizA, args);
      expect(ran.ok, planId).toBe(false);
      expect(await stepRow(stepId), planId).toEqual({ status: 'failed', errorMessage: EVIDENCE_REFUSAL });
      // Answered once: the refusal is not retried.
      expect(attemptsFor(stepId), planId).toBe(1);
      const reached = deliveredFor(stepId);
      expect(reached, planId).toHaveLength(1);
      expect(reached[0], planId).toBeInstanceOf(BadRequestException);
      expect((reached[0] as Error).message, planId).toBe(EVIDENCE_REFUSAL);
      expect(dispatcher.getCircuitStatus(TOOL, ID.bizA), planId).toEqual(CLOSED);
    }
    expect(toolWorkFor(ID.taskEvidence)).toBe(threshold + 1);
    expect(await taskRow(ID.taskEvidence)).toMatchObject({ isCompleted: false });

    // The business's next, valid step runs: dispatched once, the task completed.
    const okPlan = `${P}rf01_ok`;
    const okArgs = { taskId: ID.taskPlain };
    const okStep = await seedQueuePlan(okPlan, ID.ownerA, ID.bizA, okArgs);
    const ran = await runQueueStep(worker, okPlan, ID.bizA, okArgs);
    expect(ran, JSON.stringify(ran)).toMatchObject({ ok: true });
    expect(attemptsFor(okStep)).toBe(1);
    expect(await stepRow(okStep)).toMatchObject({ status: 'completed' });
    expect(await taskRow(ID.taskPlain)).toMatchObject({ isCompleted: true });
    expect(dispatcher.getCircuitStatus(TOOL, ID.bizA)).toEqual(CLOSED);
    expect(dispatcher.getCircuitStatus(TOOL, ID.bizB)).toEqual(CLOSED);

    // One failed execution log row per refused step from the dispatcher (autonomous), none a retry's.
    const logs = await db.aiExecutionLog.count({ where: { businessId: ID.bizA, planId: { startsWith: `${P}rf01_refused_` }, mode: 'autonomous', success: false } });
    expect(logs).toBe(threshold + 1);
  });

  it('RF-02 RED-BEFORE: a call the tool\'s schema refuses (validateToolInput: no taskId, a taskId that is no string) reaches the dispatcher as a BadRequestException with the message it always had, before the tool does any work: answered once, not counted', async () => {
    const { worker, dispatcher } = makeWorker();
    const threshold = (dispatcher as unknown as { CIRCUIT_THRESHOLD: number }).CIRCUIT_THRESHOLD;
    expect(threshold).toBeGreaterThan(0); // else the loops below would run nothing
    const before = toolWork.length;
    const cases: Array<[Record<string, unknown>, string]> = [
      [{}, `Missing required fields for ${TOOL}: taskId`],
      [{ taskId: 42 }, `Field "taskId" for ${TOOL} must be a string`],
    ];
    let n = 0;
    for (let i = 1; i <= threshold + 1; i++) {
      for (const [args, message] of cases) {
        n += 1;
        const planId = `${P}rf02_refused_${n}`;
        const stepId = await seedQueuePlan(planId, ID.ownerA, ID.bizA, args);
        const ran = await runQueueStep(worker, planId, ID.bizA, args);
        expect(ran.ok, planId).toBe(false);
        expect(await stepRow(stepId), planId).toEqual({ status: 'failed', errorMessage: message });
        expect(attemptsFor(stepId), planId).toBe(1);
        const reached = deliveredFor(stepId);
        expect(reached, planId).toHaveLength(1);
        expect(reached[0], planId).toBeInstanceOf(BadRequestException);
        expect((reached[0] as HttpException).getStatus(), planId).toBe(400);
        expect((reached[0] as Error).message, planId).toBe(message);
        expect(dispatcher.getCircuitStatus(TOOL, ID.bizA), planId).toEqual(CLOSED);
      }
    }
    // The tool's own work never ran for a refused call.
    expect(toolWork.length).toBe(before);
  });

  it('RF-03 RED-BEFORE: ProjectsService.updateTask\'s stale write (a second writer changes the task between its read and its conditional write, on both of its attempts) is a RetryableConflictException; the dispatcher receives it as a plain Error with that exception as its cause, retries, and the step completes when the race clears. A race that never clears is a failure, counted once toward this business\'s circuit only', async () => {
    const { worker, dispatcher } = makeWorker();

    // The race lasts through updateTask's two attempts of the dispatcher's first try, then clears.
    race.taskId = ID.taskRace;
    race.remaining = 2;
    const planId = `${P}rf03_clears`;
    const args = { taskId: ID.taskRace };
    const stepId = await seedQueuePlan(planId, ID.ownerA, ID.bizA, args);
    const ran = await runQueueStep(worker, planId, ID.bizA, args);
    expect(ran, JSON.stringify(ran)).toMatchObject({ ok: true });
    expect(race.remaining).toBe(0);
    expect(attemptsFor(stepId)).toBe(2);
    const reached = deliveredFor(stepId);
    expect(reached).toHaveLength(1);
    expect(reached[0]).not.toBeInstanceOf(HttpException);
    expect((reached[0] as Error).message).toBe(CONFLICT);
    expect(RetryableConflictException, 'core/utils/retryable-conflict exports RetryableConflictException').toBeTypeOf('function');
    expect((reached[0] as Error).cause).toBeInstanceOf(RetryableConflictException);
    expect((reached[0] as Error).cause).toBeInstanceOf(ConflictException);
    expect(await stepRow(stepId)).toMatchObject({ status: 'completed' });
    expect(await taskRow(ID.taskRace)).toMatchObject({ isCompleted: true });
    expect(dispatcher.getCircuitStatus(TOOL, ID.bizA)).toEqual(CLOSED);

    // The race outlasts all three tries (two attempts each): a failure, counted once, the task not completed.
    race.taskId = ID.taskRaceLost;
    race.remaining = 6;
    const lostPlan = `${P}rf03_lost`;
    const lostArgs = { taskId: ID.taskRaceLost };
    const lostStep = await seedQueuePlan(lostPlan, ID.ownerA, ID.bizA, lostArgs);
    const lost = await runQueueStep(worker, lostPlan, ID.bizA, lostArgs);
    expect(lost.ok).toBe(false);
    expect(race.remaining).toBe(0);
    expect(attemptsFor(lostStep)).toBe(3);
    for (const e of deliveredFor(lostStep)) {
      expect(e).not.toBeInstanceOf(HttpException);
      expect((e as Error).cause).toBeInstanceOf(RetryableConflictException);
    }
    expect(await stepRow(lostStep)).toEqual({ status: 'failed', errorMessage: CONFLICT });
    expect(await taskRow(ID.taskRaceLost)).toMatchObject({ isCompleted: false });
    expect(dispatcher.getCircuitStatus(TOOL, ID.bizA)).toMatchObject({ open: false, failures: 1 });
    expect(dispatcher.getCircuitStatus(TOOL, ID.bizB)).toEqual(CLOSED);
  });

  it('RF-04 control (tenancy): another business\'s plan step naming this business\'s task is the tool\'s own 404, answered once and counted toward no circuit; the task is untouched, and that business completes its own task', async () => {
    const { worker, dispatcher } = makeWorker();
    const threshold = (dispatcher as unknown as { CIRCUIT_THRESHOLD: number }).CIRCUIT_THRESHOLD;
    expect(threshold).toBeGreaterThan(0); // else the loops below would run nothing
    const args = { taskId: ID.taskTenancy };
    for (let i = 1; i <= threshold + 1; i++) {
      const planId = `${P}rf04_foreign_${i}`;
      const stepId = await seedQueuePlan(planId, ID.ownerB, ID.bizB, args);
      const ran = await runQueueStep(worker, planId, ID.bizB, args);
      expect(ran.ok, planId).toBe(false);
      expect(await stepRow(stepId), planId).toEqual({ status: 'failed', errorMessage: 'Task not found' });
      expect(attemptsFor(stepId), planId).toBe(1);
      const reached = deliveredFor(stepId);
      expect(reached, planId).toHaveLength(1);
      expect(reached[0], planId).toBeInstanceOf(NotFoundException);
      expect(dispatcher.getCircuitStatus(TOOL, ID.bizB), planId).toEqual(CLOSED);
    }
    expect(await taskRow(ID.taskTenancy)).toEqual({ businessId: ID.bizA, isCompleted: false, status: 'TODO' });

    const ownPlan = `${P}rf04_own`;
    const ownArgs = { taskId: ID.taskB };
    const ownStep = await seedQueuePlan(ownPlan, ID.ownerB, ID.bizB, ownArgs);
    expect(await runQueueStep(worker, ownPlan, ID.bizB, ownArgs)).toMatchObject({ ok: true });
    expect(await stepRow(ownStep)).toMatchObject({ status: 'completed' });
    expect(await taskRow(ID.taskB)).toMatchObject({ businessId: ID.bizB, isCompleted: true });
    expect(dispatcher.getCircuitStatus(TOOL, ID.bizA)).toEqual(CLOSED);
  });
});
