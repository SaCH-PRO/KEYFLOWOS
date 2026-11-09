import { Injectable, Logger, OnModuleInit, OnModuleDestroy, Inject } from '@nestjs/common';
import { Queue, Worker, Job, QueueEvents } from 'bullmq';
import { REDIS_CLIENT } from '../../core/redis/redis.constants';
import type { Redis } from 'ioredis';
import { PrismaService } from '../../core/prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { FlowOrchestratorService } from './flow-orchestrator.service';
import { AiOversightService } from './ai-oversight.service';
import { AiExecutionLogService } from './ai-execution-log.service';
import { UndoService } from './undo.service';
import { AgentStateMachineService } from './agent-state-machine.service';
import { ActionDispatcherService } from './action-dispatcher.service';
import { schedulersDisabled } from '../../core/config/env';

export interface PlanStepJob {
  planId: string;
  stepId: string;
  businessId: string;
  toolName: string;
  args: Record<string, any>;
  order: number;
  dependsOn?: string[];
  retryCount?: number;
  idempotencyKey: string;
  planContext?: { planId: string; planStepId: string };
}

/**
 * The step did not fail: it is waiting for a human. Thrown so the job ends
 * the way the pre-dispatch "requires manual approval" branch ends it, without
 * the step being marked failed on the way out.
 */
class StepAwaitingApproval extends Error {}

export interface CronTriggerJob {
  triggerId: string;
  businessId: string;
  eventName: string;
  payload: Record<string, any>;
}

/** The job name a trigger's repeatable is registered under: stable across schedule changes, unique per AgentTrigger id. */
const cronTriggerJobName = (triggerId: string) => `cron-trigger:${triggerId}`;

/** FOLLOW3-C3: how long onModuleDestroy waits for the workers' and events' own connections to be ready before it closes them. */
const READY_BEFORE_CLOSE_MS = 2_000;

/** Resolves once every one of these is ready or failed to initialize, or after `ms`, whichever comes first. */
async function readyOrAfter(ms: number, items: Array<{ waitUntilReady(): Promise<unknown> } | undefined>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.all(items.map((item) => item?.waitUntilReady().catch(() => undefined))),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

@Injectable()
export class QueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);

  readonly planQueue: Queue<PlanStepJob>;
  readonly cronQueue: Queue<CronTriggerJob>;

  private planWorker?: Worker<PlanStepJob>;
  private cronWorker?: Worker<CronTriggerJob>;
  private planEvents?: QueueEvents;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
    @Inject(FlowOrchestratorService) private readonly flowOrchestrator: FlowOrchestratorService,
    @Inject(AiOversightService) private readonly governance: AiOversightService,
    @Inject(AiExecutionLogService) private readonly executionLog: AiExecutionLogService,
    @Inject(UndoService) private readonly undoService: UndoService,
    @Inject(AgentStateMachineService) private readonly stateMachine: AgentStateMachineService,
    @Inject(ActionDispatcherService) private readonly actionDispatcher: ActionDispatcherService,
  ) {
    this.planQueue = new Queue<PlanStepJob>('ai-plan-steps', { connection: redis });
    this.cronQueue = new Queue<CronTriggerJob>('ai-cron-triggers', { connection: redis });
  }

  async onModuleInit() {
    this.planWorker = new Worker<PlanStepJob>(
      'ai-plan-steps',
      async (job) => this.processPlanStep(job),
      {
        connection: this.redis,
        concurrency: 5,
        stalledInterval: 30_000,
        maxStalledCount: 2,
      },
    );

    // V1-24b review (SEC-V124b-1): the ai-cron-triggers queue holds only the
    // tenants' repeatable AgentTrigger schedules (CronSchedulerService), which
    // stay in Redis across restarts. With schedulers off this process runs none
    // of them, so the cron worker is not started. Plan steps are enqueued on
    // demand and keep their worker.
    if (schedulersDisabled()) {
      this.logger.log('Cron trigger worker not started (DISABLE_SCHEDULERS, KF_DISABLE_SCHEDULERS or NODE_ENV=test)');
    } else {
      this.cronWorker = new Worker<CronTriggerJob>(
        'ai-cron-triggers',
        async (job) => this.processCronTrigger(job),
        {
          connection: this.redis,
          concurrency: 3,
        },
      );
    }

    this.planEvents = new QueueEvents('ai-plan-steps', { connection: this.redis });
    this.planEvents.on('failed', ({ jobId, failedReason }) => {
      this.logger.error(`Plan step ${jobId} failed: ${failedReason}`);
    });

    this.logger.log('BullMQ workers initialized');
  }

  async onModuleDestroy() {
    // FOLLOW3-C3 (CR-C3-1): each worker's blocking connection is a duplicate
    // of this.redis that bullmq initializes in the background (connect, then
    // an INFO for its version check). A close() before that INFO is answered
    // disconnects the duplicate under it, and bullmq re-emits the rejected INFO
    // on an emitter close() has already stripped: an unhandled 'Connection is
    // closed' rejection from RedisConnection.getRedisVersionAndType <-
    // RedisConnection.init (see TemporalFlowMemoryQueueService.onModuleDestroy).
    // So they are closed once ready, or once they failed to initialize (the
    // events connection too, although QueueEvents.close() already awaits its
    // own). The wait is bounded: with Redis unreachable they never become ready
    // (ioredis reconnects forever), and a shutdown must not wait on that; after
    // the bound close() runs as before.
    await readyOrAfter(READY_BEFORE_CLOSE_MS, [this.planWorker, this.cronWorker, this.planEvents]);
    await this.planWorker?.close();
    await this.cronWorker?.close();
    await this.planEvents?.close();
    await this.planQueue.close();
    await this.cronQueue.close();
  }

  async enqueuePlanStep(job: PlanStepJob, options?: { delay?: number; priority?: number }): Promise<Job<PlanStepJob>> {
    return this.planQueue.add(
      `plan-step:${job.planId}:${job.stepId}`,
      job,
      {
        jobId: job.idempotencyKey,
        delay: options?.delay,
        priority: options?.priority ?? 5,
        removeOnComplete: { age: 24 * 3600, count: 1000 },
        removeOnFail: { age: 7 * 24 * 3600, count: 500 },
        attempts: (job.retryCount ?? 2) + 1,
        backoff: { type: 'exponential', delay: 2000 },
      },
    );
  }

  async enqueueCronTrigger(job: CronTriggerJob, cronExpression: string): Promise<void> {
    // Upsert: a changed schedule hashes to a new repeatable key, so every
    // repeatable the trigger already has is removed first (V1-24c).
    await this.removeCronTrigger(job.triggerId);

    await this.cronQueue.add(
      cronTriggerJobName(job.triggerId),
      job,
      {
        jobId: `cron:${job.triggerId}`,
        repeat: { pattern: cronExpression, tz: 'UTC' },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 50 },
      },
    );
  }

  /**
   * V1-24c: a trigger's repeatables are found by the job NAME they are
   * registered under. bullmq 5's getRepeatableJobs() entries carry key (an md5
   * of name:jobId:endDate:tz:pattern), name, tz, pattern and next, but no `id`,
   * so the old lookup by id never matched: a removed trigger kept firing and a
   * changed schedule added a second repeatable beside the old one. Every match
   * is removed (duplicates that lookup left behind included), each with its
   * next delayed run. An unknown trigger matches nothing.
   */
  async removeCronTrigger(triggerId: string): Promise<void> {
    const name = cronTriggerJobName(triggerId);
    for (const r of await this.cronQueue.getRepeatableJobs()) {
      if (r.name === name) await this.cronQueue.removeRepeatableByKey(r.key);
    }
  }

  async getQueueStats(): Promise<{ plan: { waiting: number; active: number; completed: number; failed: number }; cron: { waiting: number; active: number; completed: number; failed: number } }> {
    const [planWaiting, planActive, planCompleted, planFailed, cronWaiting, cronActive, cronCompleted, cronFailed] = await Promise.all([
      this.planQueue.getWaitingCount(),
      this.planQueue.getActiveCount(),
      this.planQueue.getCompletedCount(),
      this.planQueue.getFailedCount(),
      this.cronQueue.getWaitingCount(),
      this.cronQueue.getActiveCount(),
      this.cronQueue.getCompletedCount(),
      this.cronQueue.getFailedCount(),
    ]);
    return {
      plan: { waiting: planWaiting, active: planActive, completed: planCompleted, failed: planFailed },
      cron: { waiting: cronWaiting, active: cronActive, completed: cronCompleted, failed: cronFailed },
    };
  }

  private async processPlanStep(job: Job<PlanStepJob>): Promise<any> {
    const data = job.data;
    const startTime = Date.now();

    // Update state machine
    await this.stateMachine.transition(data.planId, data.businessId, 'executing', 'queue_worker');

    // Check dependencies
    if (data.dependsOn && data.dependsOn.length > 0) {
      const deps = await this.prisma.client.aiPlanStep.findMany({
        where: { id: { in: data.dependsOn }, planId: data.planId },
        select: { status: true },
      });
      const allCompleted = deps.every((d) => d.status === 'completed');
      if (!allCompleted) {
        throw new Error(`Dependencies not satisfied for step ${data.stepId}`);
      }
    }

    // KEY-R3b-PLAN-AUTHORITY (D-71, D-73; NOPRINCIPAL-SURFACES): the step runs as the plan's member,
    // checked now, at run time, against the plan as stored (never the job's data): that member's
    // module scopes and the no-principal rules (the dispatcher below is handed no principal), and for
    // a plan with no member (a journey, an agent trigger, the daily briefing) no contact read and no
    // money write. A refused step is recorded failed with the reason and nothing is dispatched; the
    // job completes (asking again gets the same answer).
    const { planStepRunRefusal } = await import('./plan-step-authority');
    const refusal = await planStepRunRefusal(this.prisma, data.businessId, data.planId, data.toolName);
    if (refusal) {
      this.logger.warn(`Plan step ${data.stepId} (${data.toolName}) refused: ${refusal}`);
      await this.prisma.client.aiPlanStep.update({
        where: { id: data.stepId },
        data: { status: 'failed', errorMessage: `Refused: ${refusal}`, completedAt: new Date() },
      });
      this.events.emit('action.failed', {
        businessId: data.businessId,
        toolName: data.toolName,
        planId: data.planId,
        planStepId: data.stepId,
        error: `Refused: ${refusal}`,
      });
      return { refused: refusal };
    }

    // Governance check
    const decision = await this.governance.evaluateAutoApproval(data.businessId, data.toolName, { confidence: 0.8, planStepId: data.planContext?.planStepId });
    if (!decision.autoApproved) {
      await this.prisma.client.aiPlanStep.update({
        where: { id: data.stepId },
        data: { status: 'awaiting_approval' },
      });
      await this.stateMachine.transition(data.planId, data.businessId, 'awaiting_input', 'queue_worker');
      throw new Error(`Step ${data.stepId} requires manual approval`);
    }

    try {
      // Route through ActionDispatcher for unified execution (circuit breaker, retry, idempotency, audit)
      const dispatchResult = await this.actionDispatcher.dispatch({
        businessId: data.businessId,
        toolName: data.toolName,
        args: data.args,
        idempotencyKey: data.idempotencyKey,
        planId: data.planId,
        planStepId: data.stepId,
        source: 'plan_worker',
        retryCount: data.retryCount ?? 2,
        background: true,
      });

      const durationMs = Date.now() - startTime;

      if (dispatchResult.awaitingApproval) {
        // KF-EXEC-ACTION-001: the KEY action boundary filed the step's action
        // for a human. Same state as the governance branch above: the step
        // waits, and approving the proposal sets it pending and runs it again
        // (PlanExecutorService.onProposalApproved).
        await this.prisma.client.aiPlanStep.update({
          where: { id: data.stepId },
          data: { status: 'awaiting_approval' },
        });
        await this.stateMachine.transition(data.planId, data.businessId, 'awaiting_input', 'queue_worker');
        throw new StepAwaitingApproval(`Step ${data.stepId} requires manual approval`);
      }

      if (!dispatchResult.success) {
        throw new Error(dispatchResult.error ?? `Tool ${data.toolName} failed`);
      }

      const result = dispatchResult.result;

      // Update step
      await this.prisma.client.aiPlanStep.update({
        where: { id: data.stepId },
        data: { status: 'completed', outputResult: result as any, completedAt: new Date() },
      });

      // Emit event
      this.events.emit('action.executed', {
        businessId: data.businessId,
        toolName: data.toolName,
        planId: data.planId,
        planStepId: data.stepId,
        result,
      });

      // Check if all steps completed
      const remaining = await this.prisma.client.aiPlanStep.count({
        where: { planId: data.planId, status: { not: 'completed' } },
      });
      if (remaining === 0) {
        await this.prisma.client.aiPlan.update({
          where: { id: data.planId },
          data: { status: 'completed', completedAt: new Date() },
        });
        await this.stateMachine.transition(data.planId, data.businessId, 'completed', 'ai_queue');
      }

      return result;
    } catch (err: any) {
      if (err instanceof StepAwaitingApproval) throw err;

      const durationMs = Date.now() - startTime;
      const errorMsg = (err as Error).message;

      await this.prisma.client.aiPlanStep.update({
        where: { id: data.stepId },
        data: { status: 'failed', errorMessage: errorMsg },
      });

      this.events.emit('action.failed', {
        businessId: data.businessId,
        toolName: data.toolName,
        planId: data.planId,
        planStepId: data.stepId,
        error: errorMsg,
      });

      throw err;
    }
  }

  /**
   * V1-24c review (ST-V124c-1, CR-V124c-2): no production path removes a
   * trigger's repeatable when its AgentTrigger row is deleted (directly or with
   * its business), disabled, unscheduled or rescheduled: the API writes the row
   * only and the boot sync only adds. So each run re-reads the row by its id
   * AND the business it was registered for, and fires only an enabled row still
   * on the schedule this run came from, with the row's current event and
   * payload (not the copy stored in Redis at registration). A missing, disabled
   * or unscheduled row (or one now under another business) has its repeatables
   * removed and fires nothing; a rescheduled row is re-registered on its current
   * schedule and nothing fires on the old one. A failed lookup throws: the run
   * fails and fires nothing, and the repeatable is kept.
   */
  private async processCronTrigger(job: Job<CronTriggerJob>): Promise<void> {
    const { triggerId, businessId } = job.data;
    const row = await this.prisma.client.agentTrigger.findFirst({
      where: { id: triggerId, businessId },
      select: { id: true, businessId: true, name: true, eventPattern: true, objective: true, condition: true, enabled: true, schedule: true },
    });

    if (!row || !row.enabled || !row.schedule) {
      await this.removeCronTrigger(triggerId);
      this.logger.log(`Cron trigger ${triggerId} for ${businessId} is no longer scheduled: repeatable removed, not fired`);
      return;
    }

    const current: CronTriggerJob = {
      triggerId: row.id,
      businessId: row.businessId,
      eventName: row.eventPattern,
      payload: { triggerId: row.id, name: row.name, objective: row.objective, condition: row.condition },
    };

    if (row.schedule !== job.opts.repeat?.pattern) {
      await this.enqueueCronTrigger(current, row.schedule);
      this.logger.log(`Cron trigger ${triggerId} for ${businessId} was rescheduled (${row.schedule}): re-registered, not fired on the old schedule`);
      return;
    }

    this.logger.log(`Cron trigger fired: ${triggerId} for ${businessId}`);

    this.events.emit(current.eventName, {
      name: current.eventName,
      businessId: current.businessId,
      payload: current.payload,
      source: 'cron',
      triggerId: current.triggerId,
    });
  }

  private inferEntityType(toolName: string): string | null {
    if (toolName.includes('invoice')) return 'invoice';
    if (toolName.includes('contact')) return 'contact';
    if (toolName.includes('booking')) return 'booking';
    if (toolName.includes('task')) return 'task';
    if (toolName.includes('message') || toolName.includes('send')) return 'message';
    return null;
  }
}
