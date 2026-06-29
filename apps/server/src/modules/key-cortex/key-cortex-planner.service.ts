import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { PlannerService } from '../ai/planner.service';
import { ParsedIntent } from '../ai/intent-parser.service';
import {
  KeyCortexExecutorService,
  ExecuteOptions,
  ExecutionRecord,
} from './key-cortex-executor.service';
import { KeyCortexSagaService } from './key-cortex-saga.service';
import { ConnectorCommand } from './key-cortex-connector.types';

export interface CreateGoalInput {
  title: string;
  description?: string;
  priority?: number;
  targetDate?: Date | string;
  parentGoalId?: string;
}

export interface CreatePlanFromCommandInput {
  objective: string;
  rawInput?: string;
  urgency?: ParsedIntent['urgency'];
  modules?: string[];
  scope?: string[];
  userId?: string;
}

@Injectable()
export class KeyCortexPlannerService {
  private readonly logger = new Logger(KeyCortexPlannerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly planner: PlannerService,
    private readonly executor: KeyCortexExecutorService,
    private readonly saga: KeyCortexSagaService,
  ) {}

  async createGoal(businessId: string, input: CreateGoalInput) {
    return this.prisma.client.aiGoal.create({
      data: {
        businessId,
        title: input.title,
        description: input.description,
        priority: input.priority ?? 0,
        targetDate: input.targetDate ? new Date(input.targetDate) : null,
        parentGoalId: input.parentGoalId,
      },
    });
  }

  async listGoals(businessId: string, status?: string) {
    return this.prisma.client.aiGoal.findMany({
      where: { businessId, status: status ?? undefined },
      orderBy: { priority: 'desc' },
    });
  }

  async getGoal(businessId: string, goalId: string) {
    const goal = await this.prisma.client.aiGoal.findFirst({
      where: { id: goalId, businessId },
      include: { plans: { orderBy: { createdAt: 'desc' } } },
    });
    if (!goal) throw new NotFoundException('Goal not found');
    return goal;
  }

  async createPlanFromGoal(goalId: string, userId?: string) {
    const goal = await this.prisma.client.aiGoal.findUnique({
      where: { id: goalId },
    });
    if (!goal) throw new NotFoundException('Goal not found');

    const intent: ParsedIntent = {
      objective: `${goal.title}${goal.description ? ` - ${goal.description}` : ''}`,
      urgency: 'normal',
      scope: [],
      modules: [],
      missingInfo: [],
      actionCandidates: [],
      clarificationNeeded: false,
      rawInput: goal.description || goal.title,
    };

    const planResult = await this.planner.createPlan(goal.businessId, intent, userId);

    await this.prisma.client.aiPlan.update({
      where: { id: planResult.id },
      data: { goalId: goal.id, status: 'pending' },
    });

    return this.prisma.client.aiPlan.findUnique({
      where: { id: planResult.id },
      include: { steps: true },
    });
  }

  async createPlanFromCommand(
    businessId: string,
    input: CreatePlanFromCommandInput,
    userId?: string,
  ) {
    const intent: ParsedIntent = {
      objective: input.objective,
      urgency: input.urgency ?? 'normal',
      scope: input.scope ?? [],
      modules: input.modules ?? [],
      missingInfo: [],
      actionCandidates: [],
      clarificationNeeded: false,
      rawInput: input.rawInput ?? input.objective,
    };

    return this.planner.createPlan(businessId, intent, userId);
  }

  async executePlan(planId: string, options: ExecuteOptions = {}) {
    const plan = await this.prisma.client.aiPlan.findUnique({
      where: { id: planId },
      include: { steps: true },
    });
    if (!plan) throw new NotFoundException('Plan not found');

    await this.prisma.client.aiPlan.update({
      where: { id: planId },
      data: { status: 'running', startedAt: new Date() },
    });

    const saga = await this.saga.start({
      businessId: plan.businessId,
      sagaType: 'ai_plan',
      correlationId: options.traceId,
    });

    const sorted = this.topologicalSort(plan.steps);
    const executed: ExecutionRecord[] = [];
    let stopped = false;

    for (let i = 0; i < sorted.length; i++) {
      const step = sorted[i];
      if (stopped) {
        await this.prisma.client.aiPlanStep.update({
          where: { id: step.id },
          data: { status: 'skipped' },
        });
        continue;
      }

      await this.prisma.client.aiPlanStep.update({
        where: { id: step.id },
        data: { status: 'running', startedAt: new Date() },
      });

      const command = this.buildCommand(plan, step, options);
      await this.saga.addStep(saga.id, i, `${step.module}.${step.action}`, {
        stepId: step.id,
        command,
      });

      const record = await this.executor.execute(command, {
        ...options,
        traceId: `${saga.id}_step${i}`,
        rollbackOnFailure: true,
      });
      executed.push(record);

      if (record.result.success) {
        await this.prisma.client.aiPlanStep.update({
          where: { id: step.id },
          data: {
            status: 'completed',
            outputResult: record.result.data as Record<string, unknown>,
            completedAt: new Date(),
            durationMs: record.durationMs,
          },
        });
        await this.saga.completeStep(saga.id, i, record.result.data as Record<string, unknown>);
      } else if ((record.result.data as Record<string, unknown>)?.approvalStatus) {
        await this.prisma.client.aiPlanStep.update({
          where: { id: step.id },
          data: { status: 'waiting_approval' },
        });
        stopped = true;
      } else {
        await this.prisma.client.aiPlanStep.update({
          where: { id: step.id },
          data: {
            status: 'failed',
            errorMessage: record.result.error ?? 'Execution failed',
            completedAt: new Date(),
            durationMs: record.durationMs,
          },
        });
        await this.saga.failStep(saga.id, i, record.result.error ?? 'Execution failed');
        try {
          await this.saga.compensate(saga.id);
        } catch (compErr: unknown) {
          this.logger.error(`Plan compensation failed: ${(compErr as Error).message}`);
        }
        stopped = true;
      }
    }

    const finalStatus = stopped
      ? plan.steps.some((s) => s.status === 'waiting_approval')
        ? 'waiting_approval'
        : 'failed'
      : 'completed';

    await this.prisma.client.aiPlan.update({
      where: { id: planId },
      data: {
        status: finalStatus,
        completedAt: stopped ? null : new Date(),
      },
    });

    if (finalStatus === 'completed' || finalStatus === 'failed') {
      await this.recordPlanResult(planId, executed, finalStatus);
    }

    await (finalStatus === 'completed'
      ? this.saga.completeSaga(saga.id)
      : this.saga.failSaga(saga.id));

    return { planId, status: finalStatus, executed: executed.length, sagaId: saga.id };
  }

  async getPlan(planId: string) {
    return this.prisma.client.aiPlan.findUnique({
      where: { id: planId },
      include: { steps: true, result: true, goal: true },
    });
  }

  private buildCommand(
    plan: { businessId: string; userId?: string | null },
    step: { module: string | null; action: string; inputPayload: unknown; toolName: string | null },
    _options: ExecuteOptions,
  ): ConnectorCommand {
    return {
      module: (step.module ?? 'general') as any,
      action: step.action,
      parameters: (step.inputPayload as Record<string, unknown>) ?? {},
      businessId: plan.businessId,
      userId: plan.userId ?? 'key_cortex',
      source: 'key_cortex',
      timestamp: new Date(),
      correlationId: `plan_${plan.businessId}_${Date.now()}`,
    };
  }

  private topologicalSort(steps: Array<{ id: string; order: number; dependsOn: string[]; module: string | null; action: string; inputPayload: unknown; toolName: string | null }>) {
    const map = new Map(steps.map((s) => [s.id, s]));
    const visited = new Set<string>();
    const result: typeof steps = [];

    const visit = (step: typeof steps[0]) => {
      if (visited.has(step.id)) return;
      visited.add(step.id);
      for (const depId of step.dependsOn ?? []) {
        const dep = map.get(depId);
        if (dep) visit(dep);
      }
      result.push(step);
    };

    for (const step of [...steps].sort((a, b) => a.order - b.order)) {
      visit(step);
    }
    return result;
  }

  private async recordPlanResult(
    planId: string,
    records: ExecutionRecord[],
    status: string,
  ) {
    const successCount = records.filter((r) => r.result.success).length;
    const score = status === 'completed' ? 10 : Math.round((successCount / Math.max(records.length, 1)) * 10);
    await this.prisma.client.aiPlanResult.upsert({
      where: { planId },
      create: {
        planId,
        goalAchievementScore: score,
        businessImpactJson: { executed: records.length, succeeded: successCount, failed: records.length - successCount },
      },
      update: {
        goalAchievementScore: score,
        businessImpactJson: { executed: records.length, succeeded: successCount, failed: records.length - successCount },
      },
    });
  }
}
