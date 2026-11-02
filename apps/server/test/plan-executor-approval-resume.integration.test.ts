/**
 * V1-19-KEY-IDEMPOTENCY-CLAIM (characterization): an approved plan-queue step
 * runs its tool exactly once (REAL database, REAL Redis and BullMQ). #174
 * KEY-03, PRS-M27. This packet changes no plan-executor, queue or dispatcher
 * code; it records what the path does today.
 *
 * KEY-03 was read across three files and never exercised:
 *   - plan-executor.service.ts (onProposalApproved, 409-427) sets an approved
 *     step back to 'pending' and calls enqueuePlanSteps, which enqueues it
 *     under the same idempotency key as before, `plan:<planId>:step:<stepId>`
 *     (lines 194 and 316);
 *   - queue.service.ts:109 uses that key as the BullMQ job id, and keeps a
 *     failed job for seven days (removeOnFail, line 113);
 *   - action-dispatcher.service.ts:79-85 answers a dispatch whose key already
 *     has an ai_execution_logs row with that row's outcome, without running
 *     the tool.
 *
 * Required, and asserted here: a step that needs no approval is run once by
 * the queue worker and completes (control); a step whose action the KEY action
 * boundary files for approval waits ('awaiting_approval', not failed) without
 * running its tool; approving its proposal runs the tool exactly once and
 * completes the step and the plan. Each layer KEY-03 names is also exercised on
 * its own: the dispatcher's resume dispatch under the parked dispatch's key,
 * and BullMQ's handling of a job re-enqueued under the id of a job it retains
 * as failed.
 *
 * WHAT IS REAL: PrismaService and the Prisma client against DATABASE_URL;
 * Redis at REDIS_URL with BullMQ's real Queue and Worker (QueueService, its
 * 'ai-plan-steps' queue and worker, retries and backoff as configured);
 * PlanExecutorService (enqueuePlanSteps, onProposalApproved: called directly,
 * as the 'plan.approved' and 'key.action.approved' listeners are; its 30 s
 * poller is not started, so it never picks up another suite's plans);
 * QueueService.processPlanStep; ActionDispatcherService (circuit breaker,
 * idempotent replay, retries); AiExecutionLogService (the ai_execution_logs
 * rows the replay reads); AgentStateMachineService; the AiPlan / AiPlanStep
 * rows.
 * Stand-ins: the flow orchestrator's executeToolDirectly, which models the
 * KEY action boundary in front of the tool: for a step marked to park, it
 * throws the boundary's own ActionNotClearedError (AWAITING_APPROVAL, not
 * retryable) until the step's proposal is approved, then runs the tool, which
 * records the run (the external effect this suite counts) and returns an id;
 * AiOversightService and the autonomy orchestrator (allow, auto-approve: the
 * only approval in play is the boundary's); the proposal service (records,
 * unused on this path); the timeline and undo services (no-ops); the event
 * emitter (records).
 *
 * Queue isolation (V1-19 review, CR-V19-3; the R0-19 CR-R19-1 pattern of
 * evidence-feed.integration.test.ts): 'ai-plan-steps' and 'ai-cron-triggers'
 * are global BullMQ queue names, and every app on the same REDIS_URL (a
 * dist/main.js that a parallel test file spawns loads AiModule's QueueService)
 * runs its own 'ai-plan-steps' worker, which would take this run's jobs and run
 * them through the real flow orchestrator. BullMQ's real Queue, Worker and
 * QueueEvents are therefore constructed with a BullMQ `prefix` of this run's
 * own (vi.mock below adds only that option); QueueService itself is unchanged.
 * This run's keys under that prefix are deleted in afterAll.
 *
 * Every seeded row carries the `v19b_` prefix (user, business, plan and step
 * ids, the queue job ids) and is hard-deleted by raw SQL with sqlLikePrefix()
 * in beforeAll and afterAll, and this suite's BullMQ jobs are removed by id;
 * no $transaction wrapping.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

/** CR-V19-3: this run's own BullMQ key prefix (no other app on REDIS_URL shares it). */
const BULL = vi.hoisted(() => ({
  prefix: `v19b-bull-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
}));

// The real BullMQ classes; only the key prefix is set, for every queue, worker
// and event stream QueueService builds ('ai-plan-steps', 'ai-cron-triggers').
vi.mock('bullmq', async (importOriginal) => {
  const actual = await importOriginal<typeof import('bullmq')>();
  type QueueArgs = ConstructorParameters<typeof actual.Queue>;
  type WorkerArgs = ConstructorParameters<typeof actual.Worker>;
  type EventsArgs = ConstructorParameters<typeof actual.QueueEvents>;
  class Queue extends actual.Queue {
    constructor(name: string, opts?: QueueArgs[1], connection?: QueueArgs[2]) {
      super(name, { ...opts, prefix: BULL.prefix } as QueueArgs[1], connection);
    }
  }
  class Worker extends actual.Worker {
    constructor(name: string, processor?: WorkerArgs[1], opts?: WorkerArgs[2], connection?: WorkerArgs[3]) {
      super(name, processor, { ...opts, prefix: BULL.prefix } as WorkerArgs[2], connection);
    }
  }
  class QueueEvents extends actual.QueueEvents {
    constructor(name: string, opts?: EventsArgs[1], connection?: EventsArgs[2]) {
      super(name, { ...opts, prefix: BULL.prefix } as EventsArgs[1], connection);
    }
  }
  return { ...actual, Queue, Worker, QueueEvents };
});

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL (the
// shell / CI env wins because dotenv never overrides an existing variable).
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v19b_';

const ID = {
  owner: `${P}owner`,
  biz: `${P}biz`,
};

const TOOL = 'helpdesk_create_ticket';

let db: any;
let redis: any;
let queue: any;
let executor: any;
let dispatcher: any;
let ActionNotClearedError: any;

/** Every tool run the stand-in performed (the external effect). */
const toolRuns: Array<{ stepId: string | undefined; args: unknown; surface: unknown }> = [];
/** The action boundary stand-in: which steps it files for approval, and which of those are approved. */
const boundary = {
  parks: new Set<string>(),
  approved: new Set<string>(),
  proposalFor: new Map<string, string>(),
};
const emitted: Array<{ name: string; payload: any }> = [];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const runsFor = (stepId: string) => toolRuns.filter((r) => r.stepId === stepId).length;
const dispatchesFor = (stepId: string) =>
  dispatcher.dispatch.mock.calls.filter((c: any[]) => c[0]?.planStepId === stepId).length;
const planKey = (planId: string, stepId: string) => `plan:${planId}:step:${stepId}`;

async function cleanup() {
  for (const sql of [
    `DELETE FROM ai_execution_logs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM ai_plans WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

/** Remove this suite's BullMQ jobs, by id (never the whole queue: other suites may share the Redis index). */
async function removeJobs() {
  if (!queue) return;
  const jobs = await queue.planQueue.getJobs(['completed', 'failed', 'delayed', 'waiting', 'active', 'prioritized', 'paused']);
  for (const job of jobs) {
    if (job && typeof job.id === 'string' && job.id.includes(P)) {
      try { await job.remove(); } catch { /* active or already gone */ }
    }
  }
}

/** A one-step plan in biz, approved, its step a helpdesk ticket; `parks` marks the step for the boundary to file. */
async function seedPlan(planId: string, opts: { parks: boolean }) {
  const stepId = `${planId}_s1`;
  await db.aiPlan.create({
    data: {
      id: planId, businessId: ID.biz, userId: ID.owner, objective: `v19b ${planId}`, status: 'approved',
      steps: {
        create: [{
          id: stepId, order: 1, module: 'helpdesk', action: 'create_ticket', toolName: TOOL,
          riskTier: 2, inputPayload: { title: `${planId} ticket` },
        }],
      },
    },
  });
  if (opts.parks) boundary.parks.add(stepId);
  return stepId;
}

const stepRow = (stepId: string) =>
  db.aiPlanStep.findUnique({ where: { id: stepId }, select: { status: true, errorMessage: true, outputResult: true } });
const planStatus = async (planId: string) => (await db.aiPlan.findUnique({ where: { id: planId }, select: { status: true } }))?.status;

/** The job's state, once BullMQ has finished with it (retries included); 'absent' when no such job exists. */
async function settle(jobId: string, timeoutMs = 30_000): Promise<string> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const job = await queue.planQueue.getJob(jobId);
    if (!job) return 'absent';
    const state = await job.getState();
    if (state === 'completed' || state === 'failed' || Date.now() > until) return state;
    await sleep(100);
  }
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;
  const tenant = await import('../src/core/tenant/tenant-context');
  // As main.ts does before the app serves (no request scope here: the queue worker has none).
  dbMod.setTenantContextProvider({ getCurrentBusinessId: tenant.getCurrentBusinessId });

  const IORedis = (await import('ioredis')).default;
  // BullMQ requires maxRetriesPerRequest: null, as RedisModule sets it.
  redis = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: null });

  ({ ActionNotClearedError } = await import('../src/modules/key-autonomy/action-boundary/key-action-boundary.service'));
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AiExecutionLogService } = await import('../src/modules/ai/ai-execution-log.service');
  const { AgentStateMachineService } = await import('../src/modules/ai/agent-state-machine.service');
  const { ActionDispatcherService } = await import('../src/modules/ai/action-dispatcher.service');
  const { QueueService } = await import('../src/modules/ai/queue.service');
  const { PlanExecutorService } = await import('../src/modules/ai/plan-executor.service');

  const events = { emit: (name: string, payload: any) => { emitted.push({ name, payload }); return true; } };
  const ALLOW = {
    allowed: true, tier: 2, reason: 'v19b: allowed',
    requiresFormalApproval: false, requiresAdminApproval: false, requiresQuickConfirm: false,
  };
  const governance = {
    evaluate: async () => ({ ...ALLOW }),
    evaluateAutoApproval: async () => ({ ...ALLOW, autoApproved: true }),
    createApprovalItem: async () => { throw new Error('v19b: the legacy approval item is off this path'); },
    getToolTier: () => 2,
  };
  const autonomy = { evaluateAction: async () => ({ allowed: true, requiresApproval: false, tier: 'autonomous', reason: 'v19b: autonomous' }) };
  const proposals = { create: async () => { throw new Error('v19b: the planner-level proposal is off this path'); } };
  const timeline = { recordEvent: async () => null };
  const undo = { registerAction: async () => undefined };
  const flow = {
    executeToolDirectly: async (
      _businessId: string,
      _toolName: string,
      args: Record<string, unknown>,
      planContext?: { planId: string; planStepId: string },
      action?: { surface?: string },
    ) => {
      const stepId = planContext?.planStepId;
      if (stepId && boundary.parks.has(stepId) && !boundary.approved.has(stepId)) {
        const proposalId = `${P}proposal_${stepId}`;
        boundary.proposalFor.set(stepId, proposalId);
        throw new ActionNotClearedError(
          'CONTROL_EVIDENCE_REQUIRED',
          `Not executed: this ticket has been sent for approval (proposal ${proposalId}).`,
          proposalId,
          'AWAITING_APPROVAL',
        );
      }
      toolRuns.push({ stepId, args, surface: action?.surface });
      return { ticketId: `${P}ticket_${toolRuns.length}`, title: args.title };
    },
  };

  const prisma = new PrismaService();
  const executionLog = new AiExecutionLogService(prisma);
  const stateMachine = new AgentStateMachineService(prisma, events as any);
  dispatcher = new ActionDispatcherService(prisma, events as any, executionLog, governance as any, flow as any, undo as any);
  // Counted, not replaced: every call runs the real dispatcher.
  vi.spyOn(dispatcher, 'dispatch');
  queue = new QueueService(
    redis, prisma, events as any, flow as any, governance as any, executionLog, undo as any, stateMachine, dispatcher,
  );
  executor = new PlanExecutorService(
    prisma, events as any, governance as any, autonomy as any, proposals as any, flow as any, executionLog,
    timeline as any, queue, stateMachine,
  );

  await cleanup(); // in case a prior run aborted
  await removeJobs();
  await queue.onModuleInit(); // the BullMQ workers

  await db.user.create({ data: { id: ID.owner, email: `${P}owner@test.local`, role: 'USER' } });
  await db.business.create({ data: { id: ID.biz, name: 'V19B Biz', ownerId: ID.owner } });
}, 120_000);

afterAll(async () => {
  await removeJobs().catch(() => undefined);
  if (queue) await queue.onModuleDestroy().catch(() => undefined);
  if (redis) {
    // CR-V19-3: drop this run's BullMQ keys (failed jobs are kept for seven days otherwise).
    try {
      let cursor = '0';
      do {
        const [next, keys] = await redis.scan(cursor, 'MATCH', `${BULL.prefix}:*`, 'COUNT', 500);
        if (keys.length) await redis.del(...keys);
        cursor = next;
      } while (cursor !== '0');
    } catch { /* best-effort */ }
    await redis.quit().catch(() => undefined);
  }
  if (db) await cleanup();
  const dbMod = await import('@keyflow/db');
  dbMod.setTenantContextProvider({ getCurrentBusinessId: () => undefined });
}, 60_000);

describe('harness isolation (V1-19 review, CR-V19-3)', () => {
  it("the plan and cron queues, the plan worker and its event stream run under this run's own BullMQ prefix, so no other app on REDIS_URL takes this run's jobs; no cron worker runs under NODE_ENV=test (V1-24b)", () => {
    expect(BULL.prefix).not.toBe('bull');
    expect(queue.planQueue.name).toBe('ai-plan-steps');
    expect(queue.planQueue.opts.prefix).toBe(BULL.prefix);
    expect(queue.cronQueue.opts.prefix).toBe(BULL.prefix);
    expect(queue.planWorker?.opts?.prefix, 'the plan worker shares the prefix').toBe(BULL.prefix);
    // V1-24b (SEC-V124b-1): with schedulers off (NODE_ENV=test here) the
    // ai-cron-triggers worker is not started at all, so it cannot take any
    // app's cron jobs; if it ever runs in this harness it must share the prefix.
    if (queue.cronWorker) {
      expect(queue.cronWorker.opts?.prefix, 'the cron worker shares the prefix').toBe(BULL.prefix);
    } else {
      expect(process.env.NODE_ENV).toBe('test');
      expect(process.env.ENABLE_SCHEDULERS_IN_TEST ?? '').toBe('');
    }
    expect(queue.planEvents?.opts?.prefix, 'the event stream shares the prefix').toBe(BULL.prefix);
  });
});

describe('fixture sanity (real rows, real Redis)', () => {
  it('biz and its owner exist, Redis answers, and the plan-queue worker is running', async () => {
    expect(await db.business.findUnique({ where: { id: ID.biz }, select: { ownerId: true } })).toEqual({ ownerId: ID.owner });
    expect(await redis.ping()).toBe('PONG');
    expect(queue.planWorker?.isRunning()).toBe(true);
  });
});


/*
 * RESULT AT THE V1-19 BASE (claude/elegant-curie-7azpsb, V1-10 landed), recorded
 * by this suite against Postgres 16 and Redis with bullmq 5.76.8: every
 * required case below FAILS, and is kept red-tagged with `it.fails`; each
 * failure is pinned exactly by the "observed" case beside it, which passes.
 * A follow-up fix packet turns each `it.fails` back into `it` (it then fails
 * as `it.fails` until it does) and deletes or rewrites the observed case.
 *
 *   1. No plan-queue step runs at all. BullMQ refuses the plan executor's job
 *      id `plan:<planId>:step:<stepId>` (queue.service.ts:109 passes the
 *      idempotency key as jobId) with "Custom Id cannot contain :" (bullmq
 *      job.js validateOptions: a custom id may contain ':' only as exactly
 *      three segments). enqueuePlanSteps logs "Failed to enqueue step" and the
 *      step stays 'pending' in an 'executing' plan, so even a step that needs
 *      no approval never runs (control).
 *   2. KEY-03 end to end therefore never reaches the boundary: no proposal is
 *      filed, and the approval listener re-enqueues into the same refusal.
 *   3. The dispatcher layer (action-dispatcher.service.ts:79-85): the resume
 *      dispatch under the parked dispatch's key is an "idempotent hit" on the
 *      parked dispatch's ai_execution_logs failure row and returns that failure
 *      without running the tool (and without `awaitingApproval`).
 *   4. The queue layer (queue.service.ts:109-113), with a job id BullMQ
 *      accepts: the parked step's job is retried (attempts 3, backoff 2 s
 *      exponential); the retry's dispatch replays the logged failure (3.), so
 *      the step a human is about to approve is marked 'failed'; the job ends
 *      'failed' and is retained, and re-enqueueing under its id is a no-op:
 *      the job stays failed and nothing is dispatched again.
 */

/** Control: the queue path runs a step at all. Without it, nothing below means anything. */
describe('control: a plan-queue step that needs no approval', () => {
  const planId = `${P}plan_plain`;
  let stepId: string;
  let jobState: string;

  beforeAll(async () => {
    stepId = await seedPlan(planId, { parks: false });
    await executor.enqueuePlanSteps(planId, ID.biz);
    jobState = await settle(planKey(planId, stepId));
  }, 60_000);

  it.fails('[RED, result 1] the plan executor enqueues it, the worker runs its tool exactly once, and the step and the plan complete', async () => {
    expect(runsFor(stepId)).toBe(1);
    expect((await stepRow(stepId))?.status).toBe('completed');
    expect(await planStatus(planId)).toBe('completed');
  });

  it("observed at this base: BullMQ refuses the job id plan:<planId>:step:<stepId> ('Custom Id cannot contain :'); no job exists, the tool never ran, the step is still 'pending' in an 'executing' plan", async () => {
    expect(jobState).toBe('absent');
    expect(runsFor(stepId)).toBe(0);
    expect(await stepRow(stepId)).toMatchObject({ status: 'pending' });
    expect(await planStatus(planId)).toBe('executing');
    await expect(
      queue.enqueuePlanStep({
        planId, stepId, businessId: ID.biz, toolName: TOOL, args: {}, order: 1, dependsOn: [], retryCount: 2,
        idempotencyKey: planKey(planId, stepId), planContext: { planId, planStepId: stepId },
      }),
    ).rejects.toThrow('Custom Id cannot contain :');
  });
});

/** #174 KEY-03 (PRS-M27), end to end through the plan executor and the queue. */
describe('KEY-03: a step the action boundary files for approval, then approved', () => {
  const planId = `${P}plan_park`;
  let stepId: string;
  let parked: { jobState: string; step: any; proposal: string | undefined; runs: number };
  let resumed: { jobState: string; step: any; plan: string | undefined; runs: number };

  beforeAll(async () => {
    stepId = await seedPlan(planId, { parks: true });
    await executor.enqueuePlanSteps(planId, ID.biz);
    // A human answers later than BullMQ's retries (2 s and 4 s backoff): let them run out first.
    const parkedState = await settle(planKey(planId, stepId));
    parked = { jobState: parkedState, step: await stepRow(stepId), proposal: boundary.proposalFor.get(stepId), runs: runsFor(stepId) };

    boundary.approved.add(stepId);
    // As KeyActionProposalService.approve's 'key.action.approved' event invokes it.
    await executor.onProposalApproved({
      proposalId: `${P}proposal_${stepId}`,
      businessId: ID.biz,
      proposal: { planId, planStepId: stepId },
    });
    const resumedState = await settle(planKey(planId, stepId));
    resumed = { jobState: resumedState, step: await stepRow(stepId), plan: await planStatus(planId), runs: runsFor(stepId) };
  }, 90_000);

  it.fails("[RED, result 2] waits for a human: the step is 'awaiting_approval' (not failed), its tool has not run, and the boundary filed its proposal", () => {
    expect(parked.proposal).toBe(`${P}proposal_${stepId}`);
    expect(parked.runs).toBe(0);
    expect(parked.step).toMatchObject({ status: 'awaiting_approval' });
  });

  it.fails('[RED, result 2] approving its proposal (the key.action.approved listener) runs the tool exactly once, and the step and the plan complete', () => {
    expect(resumed.runs).toBe(1);
    expect(resumed.step?.status).toBe('completed');
    expect(resumed.plan).toBe('completed');
  });

  it("observed at this base: the step never reached the worker, so the boundary filed nothing; after the approval listener it is still 'pending', with no job and no tool run", () => {
    expect(parked).toEqual({ jobState: 'absent', step: expect.objectContaining({ status: 'pending' }), proposal: undefined, runs: 0 });
    expect(resumed).toEqual({ jobState: 'absent', step: expect.objectContaining({ status: 'pending' }), plan: 'executing', runs: 0 });
  });
});

/** The layers KEY-03 names, each on its own. */
describe('KEY-03, the dispatcher layer (action-dispatcher.service.ts:79-85)', () => {
  const planId = `${P}plan_dispatch`;
  let stepId: string;
  let first: any;
  let second: any;
  let runsAfterFirst: number;

  beforeAll(async () => {
    stepId = await seedPlan(planId, { parks: true });
    const ctx = {
      businessId: ID.biz, toolName: TOOL, args: { title: `${planId} ticket` }, idempotencyKey: planKey(planId, stepId),
      planId, planStepId: stepId, source: 'plan_worker', retryCount: 2, background: true,
    };
    first = await dispatcher.dispatch(ctx);
    runsAfterFirst = runsFor(stepId);
    boundary.approved.add(stepId);
    second = await dispatcher.dispatch(ctx);
  }, 30_000);

  it('the parked dispatch reports awaitingApproval with the proposal, and nothing ran (passes)', () => {
    expect(first).toMatchObject({ success: false, awaitingApproval: { actionId: `${P}proposal_${stepId}` } });
    expect(runsAfterFirst).toBe(0);
  });

  it.fails('[RED, result 3] after approval, the resume dispatch under the same idempotency key runs the tool exactly once and succeeds', () => {
    expect(runsFor(stepId)).toBe(1);
    expect(second.success).toBe(true);
  });

  it("observed at this base: the resume dispatch is an idempotent hit on the parked dispatch's ai_execution_logs failure row: it returns that failure, runs nothing, and no longer says it is awaiting approval", async () => {
    expect(runsFor(stepId)).toBe(0);
    expect(second.success).toBe(false);
    expect(second.error).toContain(`sent for approval (proposal ${P}proposal_${stepId})`);
    expect(second.awaitingApproval).toBeUndefined();
    expect(second.durationMs).toBe(0);
    expect(await db.aiExecutionLog.count({ where: { businessId: ID.biz, idempotencyKey: planKey(planId, stepId) } })).toBe(1);
  });
});

describe("KEY-03, the queue layer (queue.service.ts:109-113), with a job id BullMQ accepts (no ':')", () => {
  const planId = `${P}plan_retained`;
  const jobId = `${planId}_s1_job`;
  let stepId: string;
  let firstState: string;
  let stepAfterRetries: any;
  let dispatchedBefore: number;
  let secondState: string;

  beforeAll(async () => {
    stepId = await seedPlan(planId, { parks: true });
    const job = {
      planId, stepId, businessId: ID.biz, toolName: TOOL, args: { title: `${planId} ticket` }, order: 1, dependsOn: [],
      retryCount: 2, idempotencyKey: jobId, planContext: { planId, planStepId: stepId },
    };
    await queue.enqueuePlanStep(job, { priority: 3 });
    firstState = await settle(jobId);
    stepAfterRetries = await stepRow(stepId);
    dispatchedBefore = dispatchesFor(stepId);

    // What onProposalApproved does before it enqueues again.
    boundary.approved.add(stepId);
    await db.aiPlanStep.update({ where: { id: stepId }, data: { status: 'pending', errorMessage: null } });
    await queue.enqueuePlanStep(job, { priority: 3 });
    await sleep(1_500);
    secondState = await settle(jobId);
  }, 90_000);

  it.fails("[RED, result 4] while the step waits for approval, BullMQ's retries leave it 'awaiting_approval' (not failed)", () => {
    expect(stepAfterRetries).toMatchObject({ status: 'awaiting_approval' });
  });

  it.fails('[RED, result 4] the step re-enqueued under the id of the job BullMQ retains as failed is run again', () => {
    expect(dispatchesFor(stepId)).toBeGreaterThan(dispatchedBefore);
  });

  it("observed at this base: the retry replays the logged failure, so the step is marked 'failed'; the job ends 'failed' after 3 dispatches, and the re-enqueue is a no-op (still failed, nothing dispatched, the tool never ran)", () => {
    expect(firstState).toBe('failed');
    expect(stepAfterRetries).toMatchObject({ status: 'failed', errorMessage: expect.stringContaining('sent for approval') });
    expect(dispatchedBefore).toBe(3);
    expect(secondState).toBe('failed');
    expect(dispatchesFor(stepId)).toBe(dispatchedBefore);
    expect(runsFor(stepId)).toBe(0);
  });
});
