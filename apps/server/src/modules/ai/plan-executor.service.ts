import { Injectable, Logger, OnModuleInit, OnModuleDestroy, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { GovernanceService } from './governance.service';
import { FlowOrchestratorService } from './flow-orchestrator.service';
import { AiExecutionLogService } from './ai-execution-log.service';
import { TimelineService } from '../timeline/timeline.service';
import { QueueService } from './queue.service';
import { AgentStateMachineService, type AgentState } from './agent-state-machine.service';

export interface PlanExecutionResult {
  planId: string;
  status: 'completed' | 'partial' | 'failed';
  stepsCompleted: number;
  stepsFailed: number;
  stepsTotal: number;
  errorMessage?: string;
}

interface StepNode {
  id: string;
  order: number;
  status: string;
  toolName: string | null;
  action: string;
  description: string | null;
  riskTier: number;
  requiresApproval: boolean;
  dependsOn: string[];
  inputPayload: any;
  scheduledAt: Date | null;
}

@Injectable()
export class PlanExecutorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PlanExecutorService.name);
  private pollInterval: NodeJS.Timeout | null = null;
  private readonly POLL_MS = 30_000;
  private isRunning = false;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
    @Inject(forwardRef(() => GovernanceService)) private readonly governance: GovernanceService,
    @Inject(forwardRef(() => FlowOrchestratorService)) private readonly flowOrchestrator: FlowOrchestratorService,
    @Inject(AiExecutionLogService) private readonly executionLog: AiExecutionLogService,
    @Inject(TimelineService) private readonly timeline: TimelineService,
    @Inject(QueueService) private readonly queue: QueueService,
    @Inject(AgentStateMachineService) private readonly stateMachine: AgentStateMachineService,
  ) {}

  onModuleInit() {
    this.pollInterval = setInterval(() => this.tick(), this.POLL_MS);
    this.logger.log(`Plan executor polling started every ${this.POLL_MS}ms`);
  }

  onModuleDestroy() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.logger.log('Plan executor polling stopped');
  }

  async tick(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    try {
      await this.enqueueReadySteps();
    } catch (err) {
      this.logger.error(`Plan executor tick failed: ${(err as Error).message}`);
    } finally {
      this.isRunning = false;
    }
  }

  private async enqueueReadySteps(): Promise<void> {
    const plans = await this.prisma.client.aiPlan.findMany({
      where: { status: { in: ['approved', 'executing'] } },
      include: {
        steps: { orderBy: { order: 'asc' } },
        business: { select: { id: true, timezone: true } },
      },
      take: 20,
    });

    for (const plan of plans) {
      try {
        await this.enqueuePlanSteps(plan.id, plan.businessId);
      } catch (err) {
        this.logger.error(`Failed to enqueue plan ${plan.id}: ${(err as Error).message}`);
      }
    }
  }

  async enqueuePlanSteps(planId: string, businessId: string): Promise<void> {
    const plan = await this.prisma.client.aiPlan.findUnique({
      where: { id: planId },
      include: { steps: { orderBy: { order: 'asc' } } },
    });

    if (!plan) return;
    if (plan.status !== 'approved' && plan.status !== 'executing') return;

    if (plan.status === 'approved') {
      await this.prisma.client.aiPlan.update({
        where: { id: planId },
        data: { status: 'executing', startedAt: new Date() },
      });
      await this.stateMachine.transition(planId, businessId, 'executing', 'plan_executor');
    }

    const steps = plan.steps as unknown as StepNode[];
    const completedSteps = steps.filter((s) => s.status === 'completed').map((s) => s.id);
    const failedSteps = steps.filter((s) => s.status === 'failed').map((s) => s.id);

    for (const step of steps) {
      // Skip already processed
      if (['completed', 'failed', 'skipped', 'executing', 'awaiting_approval'].includes(step.status)) continue;

      // Check scheduled deferral
      if (step.scheduledAt && new Date(step.scheduledAt) > new Date()) continue;

      // Check dependencies
      const hasFailedDep = step.dependsOn.some((depId) => failedSteps.includes(depId));
      if (hasFailedDep) {
        await this.prisma.client.aiPlanStep.update({
          where: { id: step.id },
          data: { status: 'skipped', errorMessage: 'Skipped because a dependency failed' },
        });
        continue;
      }

      const depsMet = step.dependsOn.every((depId) => completedSteps.includes(depId));
      if (!depsMet) continue;

      // Governance pre-check
      const toolName = step.toolName ?? step.action;
      const decision = await this.governance.evaluate(businessId, toolName);
      if (!decision.allowed) {
        await this.prisma.client.aiPlanStep.update({
          where: { id: step.id },
          data: { status: 'failed', errorMessage: decision.reason },
        });
        continue;
      }

      if (decision.requiresFormalApproval || decision.requiresAdminApproval) {
        await this.governance.createApprovalItem(businessId, {
          toolName,
          title: `Plan step: ${step.action}`,
          description: step.description ?? undefined,
          inputPayload: step.inputPayload,
          planId,
          planStepId: step.id,
        });
        await this.prisma.client.aiPlanStep.update({
          where: { id: step.id },
          data: { status: 'awaiting_approval' },
        });
        await this.stateMachine.transition(planId, businessId, 'awaiting_input', 'plan_executor');
        continue;
      }

      // Enqueue to BullMQ
      const delay = step.scheduledAt && new Date(step.scheduledAt) > new Date()
        ? new Date(step.scheduledAt).getTime() - Date.now()
        : undefined;

      try {
        await this.queue.enqueuePlanStep(
          {
            planId,
            stepId: step.id,
            businessId,
            toolName,
            args: (step.inputPayload as Record<string, any>) ?? {},
            order: step.order,
            dependsOn: step.dependsOn,
            retryCount: 2,
            idempotencyKey: `plan:${planId}:step:${step.id}`,
            planContext: { planId, planStepId: step.id },
          },
          { delay, priority: step.riskTier <= 2 ? 3 : 5 },
        );

        await this.prisma.client.aiPlanStep.update({
          where: { id: step.id },
          data: { status: 'executing', startedAt: new Date() },
        });

        this.logger.log(`Enqueued step ${step.id} (${toolName}) for plan ${planId}`);
      } catch (err) {
        this.logger.error(`Failed to enqueue step ${step.id}: ${(err as Error).message}`);
      }
    }

    // Check if plan is complete
    const updatedPlan = await this.prisma.client.aiPlan.findUnique({
      where: { id: planId },
      include: { steps: true },
    });

    if (!updatedPlan) return;
    const allDone = updatedPlan.steps.every((s) =>
      ['completed', 'failed', 'skipped', 'awaiting_approval'].includes(s.status),
    );

    if (allDone) {
      const failed = updatedPlan.steps.filter((s) => s.status === 'failed' || s.status === 'skipped').length;
      const completed = updatedPlan.steps.filter((s) => s.status === 'completed').length;
      const finalStatus: 'completed' | 'partial' | 'failed' =
        failed === 0 ? 'completed' : completed === 0 ? 'failed' : 'partial';

      await this.prisma.client.aiPlan.update({
        where: { id: planId },
        data: { status: finalStatus, completedAt: new Date() },
      });

      const stateMachineStatus: AgentState = finalStatus === 'partial' ? 'completed' : finalStatus;
      await this.stateMachine.transition(planId, businessId, stateMachineStatus, 'plan_executor');

      this.events.emit('plan.executed', { planId, businessId, status: finalStatus });
      this.timeline.recordEvent({
        businessId,
        module: 'ai',
        action: 'plan_executed',
        entityType: 'aiPlan',
        entityId: planId,
        title: `AI plan executed: ${plan.objective}`,
        detail: `Status: ${finalStatus}, completed: ${completed}, failed: ${failed}`,
        data: { planId, status: finalStatus, completed, failed },
      }).catch(() => {});
    }
  }
}
