import { Injectable, Logger, OnModuleInit, OnModuleDestroy, Inject } from '@nestjs/common';
import { Queue, Worker, Job, QueueEvents } from 'bullmq';
import { REDIS_CLIENT } from '../../core/redis/redis.module';
import type { Redis } from 'ioredis';
import { PrismaService } from '../../core/prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { FlowOrchestratorService } from './flow-orchestrator.service';
import { GovernanceService } from './governance.service';
import { AiExecutionLogService } from './ai-execution-log.service';
import { UndoService } from './undo.service';
import { AgentStateMachineService } from './agent-state-machine.service';

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

export interface CronTriggerJob {
  triggerId: string;
  businessId: string;
  eventName: string;
  payload: Record<string, any>;
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
    @Inject(GovernanceService) private readonly governance: GovernanceService,
    @Inject(AiExecutionLogService) private readonly executionLog: AiExecutionLogService,
    @Inject(UndoService) private readonly undoService: UndoService,
    @Inject(AgentStateMachineService) private readonly stateMachine: AgentStateMachineService,
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

    this.cronWorker = new Worker<CronTriggerJob>(
      'ai-cron-triggers',
      async (job) => this.processCronTrigger(job),
      {
        connection: this.redis,
        concurrency: 3,
      },
    );

    this.planEvents = new QueueEvents('ai-plan-steps', { connection: this.redis });
    this.planEvents.on('failed', ({ jobId, failedReason }) => {
      this.logger.error(`Plan step ${jobId} failed: ${failedReason}`);
    });

    this.logger.log('BullMQ workers initialized');
  }

  async onModuleDestroy() {
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
    const jobId = `cron:${job.triggerId}`;
    // Upsert repeatable job
    const existing = await this.cronQueue.getRepeatableJobs();
    const match = existing.find((r) => r.id === jobId);
    if (match) {
      await this.cronQueue.removeRepeatableByKey(match.key);
    }

    await this.cronQueue.add(
      `cron-trigger:${job.triggerId}`,
      job,
      {
        jobId,
        repeat: { pattern: cronExpression, tz: 'UTC' },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 50 },
      },
    );
  }

  async removeCronTrigger(triggerId: string): Promise<void> {
    const existing = await this.cronQueue.getRepeatableJobs();
    const match = existing.find((r) => r.id === `cron:${triggerId}`);
    if (match) {
      await this.cronQueue.removeRepeatableByKey(match.key);
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
      const result = await this.flowOrchestrator.executeToolDirectly(
        data.businessId,
        data.toolName,
        data.args,
        data.planContext,
      );

      const durationMs = Date.now() - startTime;

      // Update step
      await this.prisma.client.aiPlanStep.update({
        where: { id: data.stepId },
        data: { status: 'completed', outputResult: result as any, completedAt: new Date() },
      });

      // Log execution
      await this.executionLog.log({
        businessId: data.businessId,
        action: `tool:${data.toolName}`,
        toolName: data.toolName,
        mode: 'autonomous',
        actor: 'ai',
        success: true,
        durationMs,
        inputSummary: data.args,
        outputSummary: result,
        planId: data.planId,
        planStepId: data.stepId,
      }).catch(() => {});

      // Register for undo
      if (result?.id || result?.entityId) {
        const entityType = this.inferEntityType(data.toolName);
        if (entityType) {
          await this.undoService.registerAction({
            businessId: data.businessId,
            actionType: data.toolName,
            entityType,
            entityId: result.id ?? result.entityId,
            originalPayload: data.args,
          }).catch(() => {});
        }
      }

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
    } catch (err) {
      const durationMs = Date.now() - startTime;
      const errorMsg = (err as Error).message;

      await this.prisma.client.aiPlanStep.update({
        where: { id: data.stepId },
        data: { status: 'failed', errorMessage: errorMsg },
      });

      await this.executionLog.log({
        businessId: data.businessId,
        action: `tool:${data.toolName}`,
        toolName: data.toolName,
        mode: 'autonomous',
        actor: 'ai',
        success: false,
        durationMs,
        inputSummary: data.args,
        outputSummary: { error: errorMsg },
        planId: data.planId,
        planStepId: data.stepId,
      }).catch(() => {});

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

  private async processCronTrigger(job: Job<CronTriggerJob>): Promise<void> {
    const data = job.data;
    this.logger.log(`Cron trigger fired: ${data.triggerId} for ${data.businessId}`);

    this.events.emit(data.eventName, {
      name: data.eventName,
      businessId: data.businessId,
      payload: data.payload,
      source: 'cron',
      triggerId: data.triggerId,
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
