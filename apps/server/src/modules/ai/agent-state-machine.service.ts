import { Injectable, Logger, Inject } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

export type AgentState =
  | 'idle'
  | 'planning'
  | 'awaiting_input'
  | 'executing'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'stalled';

export interface StateTransition {
  from: AgentState;
  to: AgentState;
  triggeredBy: string;
  reason?: string;
}

export interface AgentStateSnapshot {
  planId: string;
  businessId: string;
  state: AgentState;
  currentStepId?: string;
  currentStepAction?: string;
  progressPercent: number;
  startedAt?: Date;
  estimatedCompletion?: Date;
  history: StateTransition[];
}

const VALID_TRANSITIONS: Record<AgentState, AgentState[]> = {
  idle: ['planning'],
  planning: ['awaiting_input', 'executing', 'paused', 'failed'],
  awaiting_input: ['executing', 'paused', 'failed'],
  executing: ['awaiting_input', 'paused', 'completed', 'failed', 'stalled'],
  paused: ['executing', 'failed'],
  completed: ['idle'],
  failed: ['idle', 'planning'],
  stalled: ['executing', 'failed'],
};

@Injectable()
export class AgentStateMachineService {
  private readonly logger = new Logger(AgentStateMachineService.name);
  private stateHistory = new Map<string, StateTransition[]>();

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
  ) {}

  async transition(
    planId: string,
    businessId: string,
    toState: AgentState,
    triggeredBy: string,
    reason?: string,
    opts?: { currentStepId?: string; estimatedCompletion?: Date },
  ): Promise<boolean> {
    const plan = await this.prisma.client.aiPlan.findUnique({
      where: { id: planId },
      include: { steps: { orderBy: { order: 'asc' } } },
    });

    if (!plan) {
      this.logger.warn(`Cannot transition plan ${planId}: not found`);
      return false;
    }

    const fromState = this.inferStateFromPlan(plan) as AgentState;

    if (!VALID_TRANSITIONS[fromState].includes(toState)) {
      this.logger.warn(
        `Invalid state transition: ${fromState} -> ${toState} for plan ${planId}`,
      );
      return false;
    }

    // Update plan state
    const updateData: any = {};
    if (toState === 'executing') {
      updateData.status = 'executing';
      updateData.startedAt = new Date();
    } else if (toState === 'completed') {
      updateData.status = 'completed';
      updateData.completedAt = new Date();
    } else if (toState === 'failed' || toState === 'stalled') {
      updateData.status = 'failed';
      updateData.completedAt = new Date();
    } else if (toState === 'paused') {
      // Keep status as-is but track pause
    } else if (toState === 'awaiting_input') {
      updateData.status = 'executing'; // Still technically executing
    }

    if (Object.keys(updateData).length > 0) {
      await this.prisma.client.aiPlan.update({
        where: { id: planId },
        data: updateData,
      });
    }

    // Record transition
    const transition: StateTransition = { from: fromState, to: toState, triggeredBy, reason };
    const history = this.stateHistory.get(planId) ?? [];
    history.push(transition);
    this.stateHistory.set(planId, history);

    this.events.emit('agent.state_changed', {
      planId,
      businessId,
      fromState,
      toState,
      triggeredBy,
      reason,
    });

    this.logger.log(`Plan ${planId}: ${fromState} -> ${toState} (${triggeredBy})`);
    return true;
  }

  async getSnapshot(planId: string): Promise<AgentStateSnapshot | null> {
    const plan = await this.prisma.client.aiPlan.findUnique({
      where: { id: planId },
      include: { steps: { orderBy: { order: 'asc' } } },
    });

    if (!plan) return null;

    const state = this.inferStateFromPlan(plan) as AgentState;
    const totalSteps = plan.steps.length;
    const completedSteps = plan.steps.filter((s) => s.status === 'completed').length;
    const progressPercent = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;

    const currentStep = plan.steps.find((s) => s.status === 'executing');
    const history = this.stateHistory.get(planId) ?? [];

    return {
      planId,
      businessId: plan.businessId,
      state,
      currentStepId: currentStep?.id,
      currentStepAction: currentStep?.action,
      progressPercent,
      startedAt: plan.startedAt ?? undefined,
      history,
    };
  }

  async pausePlan(planId: string, userId: string, reason?: string): Promise<boolean> {
    return this.transition(planId, '', 'paused', userId, reason ?? 'User requested pause');
  }

  async resumePlan(planId: string, userId: string): Promise<boolean> {
    return this.transition(planId, '', 'executing', userId, 'User requested resume');
  }

  async abortPlan(planId: string, userId: string, reason?: string): Promise<boolean> {
    const ok = await this.transition(planId, '', 'failed', userId, reason ?? 'User aborted');
    if (ok) {
      await this.prisma.client.aiPlan.update({
        where: { id: planId },
        data: { status: 'failed', completedAt: new Date() },
      });
    }
    return ok;
  }

  private inferStateFromPlan(plan: any): AgentState {
    const status = plan.status;
    const steps = plan.steps ?? [];

    if (status === 'draft') return 'planning';
    if (status === 'approved') return 'idle';
    if (status === 'executing') {
      const hasAwaiting = steps.some((s: any) => s.status === 'awaiting_approval');
      if (hasAwaiting) return 'awaiting_input';
      return 'executing';
    }
    if (status === 'completed') return 'completed';
    if (status === 'failed') return 'failed';
    if (status === 'partial') return 'failed';
    return 'idle';
  }

  async getAllActiveSnapshots(businessId: string): Promise<AgentStateSnapshot[]> {
    const plans = await this.prisma.client.aiPlan.findMany({
      where: {
        businessId,
        status: { in: ['executing', 'approved'] },
      },
      include: { steps: { orderBy: { order: 'asc' } } },
      orderBy: { updatedAt: 'desc' },
    });

    return plans.map((plan) => {
      const state = this.inferStateFromPlan(plan) as AgentState;
      const totalSteps = plan.steps.length;
      const completedSteps = plan.steps.filter((s) => s.status === 'completed').length;
      const currentStep = plan.steps.find((s) => s.status === 'executing');

      return {
        planId: plan.id,
        businessId: plan.businessId,
        state,
        currentStepId: currentStep?.id,
        currentStepAction: currentStep?.action,
        progressPercent: totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0,
        startedAt: plan.startedAt ?? undefined,
        history: this.stateHistory.get(plan.id) ?? [],
      };
    });
  }
}
