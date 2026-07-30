import { Injectable, Logger, OnModuleInit, OnModuleDestroy, Inject, forwardRef } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../core/prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AiOversightService } from './ai-oversight.service';
import { FlowOrchestratorService } from './flow-orchestrator.service';
import { AiExecutionLogService } from './ai-execution-log.service';
import { TimelineService } from '../timeline/timeline.service';
import { QueueService } from './queue.service';
import { AgentStateMachineService, type AgentState } from './agent-state-machine.service';
import { AutonomyOrchestratorService } from '../key-autonomy/autonomy-orchestrator.service';
import { KeyActionProposalService } from '../key-autonomy/key-action-proposal.service';

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
    @Inject(forwardRef(() => AiOversightService)) private readonly governance: AiOversightService,
    @Inject(forwardRef(() => AutonomyOrchestratorService)) private readonly autonomyOrchestrator: AutonomyOrchestratorService,
    @Inject(forwardRef(() => KeyActionProposalService)) private readonly proposalService: KeyActionProposalService,
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

  /**
   * Immediately enqueue steps when a plan is approved.
   * This eliminates the 30s polling delay for newly approved plans.
   */
  @OnEvent('plan.approved', { async: true })
  async onPlanApproved(payload: { planId: string; businessId: string }): Promise<void> {
    this.logger.log(`Plan ${payload.planId} approved — immediate execution triggered`);
    try {
      await this.enqueuePlanSteps(payload.planId, payload.businessId);
    } catch (err: any) {
      this.logger.error(`Immediate execution failed for plan ${payload.planId}: ${(err as Error).message}`);
    }
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
    } catch (err: any) {
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
      } catch (err: any) {
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
      const decision = await this.evaluateStep(businessId, toolName);
      if (!decision.allowed) {
        await this.prisma.client.aiPlanStep.update({
          where: { id: step.id },
          data: { status: 'failed', errorMessage: decision.reason },
        });
        continue;
      }

      if (decision.requiresFormalApproval || decision.requiresAdminApproval) {
        await this.createStepProposal(businessId, planId, step, toolName);
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
      } catch (err: any) {
        this.logger.error(`Failed to enqueue step ${step.id}: ${(err as Error).message}`);
      }
    }

    // After processing steps, check for newly unblocked steps (dependencies resolved)
    // and enqueue them immediately without waiting for next poll
    await this.enqueueUnblockedSteps(planId, businessId);

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

  /**
   * After steps complete, re-evaluate the plan to find steps whose
   * dependencies are now satisfied and enqueue them immediately.
   */
  private async enqueueUnblockedSteps(planId: string, businessId: string): Promise<void> {
    const plan = await this.prisma.client.aiPlan.findUnique({
      where: { id: planId },
      include: { steps: { orderBy: { order: 'asc' } } },
    });
    if (!plan || plan.status !== 'executing') return;

    const steps = plan.steps as unknown as StepNode[];
    const completedSteps = steps.filter((s) => s.status === 'completed').map((s) => s.id);
    const failedSteps = steps.filter((s) => s.status === 'failed').map((s) => s.id);

    for (const step of steps) {
      if (step.status !== 'pending') continue;
      if (step.scheduledAt && new Date(step.scheduledAt) > new Date()) continue;

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

      // Dependency just resolved — enqueue this step now
      const toolName = step.toolName ?? step.action;
      const decision = await this.evaluateStep(businessId, toolName);
      if (!decision.allowed) {
        await this.prisma.client.aiPlanStep.update({
          where: { id: step.id },
          data: { status: 'failed', errorMessage: decision.reason },
        });
        continue;
      }

      if (decision.requiresFormalApproval || decision.requiresAdminApproval) {
        await this.createStepProposal(businessId, planId, step, toolName);
        await this.prisma.client.aiPlanStep.update({
          where: { id: step.id },
          data: { status: 'awaiting_approval' },
        });
        continue;
      }

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
          { priority: step.riskTier <= 2 ? 3 : 5 },
        );
        await this.prisma.client.aiPlanStep.update({
          where: { id: step.id },
          data: { status: 'executing', startedAt: new Date() },
        });
        this.logger.log(`Enqueued unblocked step ${step.id} (${toolName}) for plan ${planId}`);
      } catch (err: any) {
        this.logger.error(`Failed to enqueue unblocked step ${step.id}: ${(err as Error).message}`);
      }
    }
  }

  private async evaluateStep(
    businessId: string,
    toolName: string,
  ): Promise<{ allowed: boolean; reason: string; requiresFormalApproval: boolean; requiresAdminApproval: boolean }> {
    if (this.autonomyOrchestrator) {
      try {
        const verdict = await this.autonomyOrchestrator.evaluateAction(businessId, toolName);
        return {
          allowed: verdict.allowed,
          reason: verdict.reason,
          requiresFormalApproval: verdict.requiresApproval && verdict.tier === 'supervised',
          requiresAdminApproval: verdict.tier === 'manual',
        };
      } catch (err: any) {
        this.logger.warn(
          `Autonomy orchestrator step evaluation failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    const decision = await this.governance.evaluate(businessId, toolName);
    return {
      allowed: decision.allowed,
      reason: decision.reason,
      requiresFormalApproval: decision.requiresFormalApproval,
      requiresAdminApproval: decision.requiresAdminApproval,
    };
  }

  private async createStepProposal(
    businessId: string,
    planId: string,
    step: StepNode,
    toolName: string,
  ): Promise<void> {
    const riskLevel = this.mapRiskTier(step.riskTier);
    try {
      await this.proposalService.create(
        businessId,
        {
          sourceType: 'AI_PLAN',
          sourceId: planId,
          planId,
          planStepId: step.id,
          title: `Plan step: ${step.action}`,
          summary: step.description ?? undefined,
          actionType: 'EXECUTE_TOOL',
          payload: {
            toolName,
            inputPayload: step.inputPayload,
            planContext: { planId, planStepId: step.id },
          },
        },
        undefined, // requesterId unknown at this layer
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to create proposal for plan step ${step.id}: ${message}`);
      // Fallback to legacy governance item so the plan does not silently stall
      await this.governance.createApprovalItem(businessId, {
        toolName,
        title: `Plan step: ${step.action}`,
        description: step.description ?? undefined,
        inputPayload: step.inputPayload,
        planId,
        planStepId: step.id,
      });
    }
  }

  private mapRiskTier(riskTier: number): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
    if (riskTier >= 4) return 'CRITICAL';
    if (riskTier === 3) return 'HIGH';
    if (riskTier === 2) return 'MEDIUM';
    return 'LOW';
  }

  @OnEvent('key.action.approved', { async: true })
  async onProposalApproved(payload: {
    proposalId: string;
    businessId: string;
    proposal: { planId?: string | null; planStepId?: string | null };
  }): Promise<void> {
    const { planId, planStepId } = payload.proposal;
    if (!planId || !planStepId) return;
    this.logger.log(`Proposal ${payload.proposalId} approved — resuming plan ${planId} step ${planStepId}`);
    try {
      await this.prisma.client.aiPlanStep.update({
        where: { id: planStepId },
        data: { status: 'pending', errorMessage: null },
      });
      await this.enqueuePlanSteps(planId, payload.businessId);
    } catch (err: any) {
      this.logger.error(`Failed to resume plan ${planId}: ${(err as Error).message}`);
    }
  }

  @OnEvent('key.action.rejected', { async: true })
  async onProposalRejected(payload: {
    proposalId: string;
    businessId: string;
    proposal: { planId?: string | null; planStepId?: string | null };
    reason?: string;
  }): Promise<void> {
    const { planId, planStepId } = payload.proposal;
    if (!planId || !planStepId) return;
    this.logger.log(`Proposal ${payload.proposalId} rejected — failing plan ${planId} step ${planStepId}`);
    try {
      await this.prisma.client.aiPlanStep.update({
        where: { id: planStepId },
        data: { status: 'failed', errorMessage: payload.reason || 'Approval rejected' },
      });
      await this.enqueuePlanSteps(planId, payload.businessId);
    } catch (err: any) {
      this.logger.error(`Failed to fail plan step ${planStepId}: ${(err as Error).message}`);
    }
  }
}
