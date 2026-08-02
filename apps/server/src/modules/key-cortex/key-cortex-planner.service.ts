import { Injectable, Logger, NotFoundException, Optional, Inject } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { PlannerService } from '../ai/planner.service';
import { AiUsageService } from '../ai/ai-usage.service';
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

export interface PlanGoal {
  objective: string;
  constraints?: string[];
  successCriteria?: string[];
  horizon?: 'immediate' | 'tactical' | 'strategic';
}

export interface PlanStep {
  order: number;
  action: string;
  module?: string;
  parameters?: Record<string, unknown>;
  dependsOn?: number[];
  riskTier?: number;
  expectedBenefit?: string;
}

export interface PlanSimulationResult {
  successProbability: number;
  risks: string[];
  assumptions: string[];
}

export interface GeneratedPlan {
  goal: PlanGoal;
  steps: PlanStep[];
  confidence: number;
  simulationResult?: PlanSimulationResult;
}

@Injectable()
export class KeyCortexPlannerService {
  private readonly logger = new Logger(KeyCortexPlannerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly planner: PlannerService,
    private readonly executor: KeyCortexExecutorService,
    private readonly saga: KeyCortexSagaService,
    @Optional()
    @Inject(AiUsageService)
    private readonly aiUsage?: AiUsageService,
  ) {}

  async createGoal(businessId: string, input: CreateGoalInput) {
    // parentGoalId is caller-supplied and must be proven to belong to THIS
    // business before it is written. Until recently the global ValidationPipe
    // stripped the field (the DTO carried no validator metadata), so the
    // unchecked write was unreachable and therefore harmless. Making the DTO
    // work makes the field live, and without this check a caller could parent
    // their goal onto another tenant's goal — reading its id back out of the
    // relation afterwards.
    if (input.parentGoalId) {
      const parent = await this.prisma.client.aiGoal.findFirst({
        where: { id: input.parentGoalId, businessId },
        select: { id: true },
      });
      if (!parent) {
        // Not found vs. not yours are deliberately indistinguishable here:
        // distinguishing them would confirm the existence of another tenant's
        // goal id.
        throw new NotFoundException('Parent goal not found');
      }
    }

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

    const generated = await this.generatePlan(goal.businessId, {
      objective: `${goal.title}${goal.description ? ` - ${goal.description}` : ''}`,
      horizon: 'tactical',
    });

    const planResult = await this.planner.createPlan(
      goal.businessId,
      this.generatedPlanToIntent(generated),
      userId,
    );

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
    const generated = await this.generatePlan(businessId, {
      objective: input.objective,
      constraints: input.scope,
      horizon: 'immediate',
    });

    return this.planner.createPlan(
      businessId,
      this.generatedPlanToIntent(generated, input),
      userId,
    );
  }

  /**
   * Generate a plan from a high-level goal.
   *
   * Uses an LLM when available; falls back to deterministic keyword
   * decomposition. The resulting plan is persisted as an aiPlan row.
   */
  async generatePlan(businessId: string, goal: PlanGoal): Promise<GeneratedPlan> {
    const steps = await this.decomposeGoal(businessId, goal);
    const simulation = this.simulatePlan(steps, goal);

    this.logger.log(`[generatePlan] Decomposed goal for ${businessId} into ${steps.length} step(s)`);

    return {
      goal,
      steps,
      confidence: simulation.successProbability,
      simulationResult: simulation,
    };
  }

  /**
   * LLM-based goal decomposition with deterministic fallback.
   */
  async decomposeGoal(businessId: string, goal: PlanGoal): Promise<PlanStep[]> {
    if (this.aiUsage) {
      try {
        const result = await this.aiUsage.callAi({
          businessId,
          feature: 'plan_decompose',
          messages: [
            {
              role: 'system',
              content: `You are KeyFlow's planning engine. Decompose the user's goal into ordered, concrete steps. Each step should use a canonical tool action (e.g. crm.list_contacts, commerce.create_invoice, autopilot.create_task). Respond with JSON only: { "steps": [ { "order": number, "action": "tool_name", "module": "crm|commerce|bookings|autopilot|workflow|key_inbox|key_genome", "parameters": {}, "dependsOn": [order numbers], "riskTier": 1-4, "expectedBenefit": "string" } ] }`,
            },
            {
              role: 'user',
              content: `Goal: ${goal.objective}\nConstraints: ${(goal.constraints ?? []).join(', ')}\nSuccess criteria: ${(goal.successCriteria ?? []).join(', ')}`,
            },
          ],
          maxTokens: 1200,
          temperature: 0.3,
          responseMode: 'structured_json',
        });

        const parsed = JSON.parse(result.content);
        const rawSteps = Array.isArray(parsed.steps) ? parsed.steps : [];
        if (rawSteps.length > 0) {
          return rawSteps.map((s: any, idx: number) => ({
            order: s.order ?? idx + 1,
            action: s.action ?? s.toolName ?? 'analyze',
            module: s.module ?? 'general',
            parameters: s.parameters ?? s.inputPayload ?? {},
            dependsOn: Array.isArray(s.dependsOn) ? s.dependsOn : [],
            riskTier: s.riskTier ?? 1,
            expectedBenefit: s.expectedBenefit ?? '',
          }));
        }
      } catch (err: unknown) {
        this.logger.warn(`LLM decomposition failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return this.fallbackDecomposeGoal(goal);
  }

  /**
   * Deterministic fallback decomposition.
   */
  private fallbackDecomposeGoal(goal: PlanGoal): PlanStep[] {
    const text = goal.objective.toLowerCase();
    const steps: PlanStep[] = [];

    if (text.includes('invoice') || text.includes('bill')) {
      steps.push(
        { order: 1, action: 'list_contacts', module: 'crm', riskTier: 1, expectedBenefit: 'Confirm customer exists and is billable' },
        { order: 2, action: 'create_invoice', module: 'commerce', riskTier: 2, dependsOn: [1], expectedBenefit: 'Create invoice' },
        { order: 3, action: 'send_invoice', module: 'commerce', riskTier: 2, dependsOn: [2], expectedBenefit: 'Deliver invoice to customer' },
      );
    } else if (text.includes('follow') || text.includes('task')) {
      steps.push(
        { order: 1, action: 'create_task', module: 'autopilot', riskTier: 1, expectedBenefit: 'Create follow-up task' },
        { order: 2, action: 'send_message', module: 'communications', riskTier: 2, dependsOn: [1], expectedBenefit: 'Notify stakeholder' },
      );
    } else if (text.includes('booking') || text.includes('appointment')) {
      steps.push(
        { order: 1, action: 'list_contacts', module: 'crm', riskTier: 1, expectedBenefit: 'Confirm customer exists' },
        { order: 2, action: 'get_services', module: 'bookings', riskTier: 1, dependsOn: [1], expectedBenefit: 'Find available service' },
        { order: 3, action: 'create_booking', module: 'bookings', riskTier: 2, dependsOn: [2], expectedBenefit: 'Book appointment' },
      );
    } else {
      steps.push(
        { order: 1, action: 'analyze_request', module: 'ai', riskTier: 1, expectedBenefit: 'Understand request' },
        { order: 2, action: 'draft_response', module: 'ai', riskTier: 1, dependsOn: [1], expectedBenefit: 'Prepare response' },
      );
    }

    return steps;
  }

  /**
   * Score a plan based on risk and complexity.
   */
  simulatePlan(steps: PlanStep[], _goal: PlanGoal): PlanSimulationResult {
    const maxRisk = Math.max(1, ...steps.map((s) => s.riskTier ?? 1));
    const dependencyPenalty = steps.reduce((acc, s) => acc + (s.dependsOn?.length ?? 0), 0) * 0.01;
    const successProbability = Math.max(0.25, 1 - (maxRisk - 1) * 0.15 - steps.length * 0.02 - dependencyPenalty);
    return {
      successProbability: Math.round(successProbability * 100) / 100,
      risks: steps.filter((s) => (s.riskTier ?? 1) >= 3).map((s) => `High-risk step: ${s.action}`),
      assumptions: ['Business data is current', 'Required permissions are granted'],
    };
  }

  /**
   * Replan after failures by appending recovery steps.
   */
  async replanIfNeeded(planId: string): Promise<GeneratedPlan | null> {
    const plan = await this.prisma.client.aiPlan.findUnique({
      where: { id: planId },
      include: { steps: true },
    });
    if (!plan) return null;

    const failedSteps = plan.steps.filter((s: any) => s.status === 'failed');
    if (failedSteps.length === 0) return null;

    const maxOrder = Math.max(0, ...plan.steps.map((s: any) => s.order ?? 0));
    const recoverySteps: PlanStep[] = failedSteps.map((s: any, i: number) => ({
      order: maxOrder + i + 1,
      action: `recover_${s.action}`,
      module: s.module ?? 'general',
      parameters: (s.inputPayload as Record<string, unknown>) ?? {},
      dependsOn: [s.order ?? 1],
      riskTier: Math.min(4, (s.riskTier ?? 1) + 1),
      expectedBenefit: `Recover from failure: ${s.errorMessage ?? 'unknown'}`,
    }));

    for (const step of recoverySteps) {
      await this.prisma.client.aiPlanStep.create({
        data: {
          planId,
          order: step.order,
          status: 'pending',
          toolName: step.action,
          action: step.action,
          module: step.module ?? 'general',
          description: step.expectedBenefit,
          riskTier: step.riskTier ?? 1,
          inputPayload: step.parameters as any,
          expectedBenefit: step.expectedBenefit,
        },
      });
    }

    await this.prisma.client.aiPlan.update({
      where: { id: planId },
      data: { status: 'draft' },
    });

    const goal: PlanGoal = { objective: plan.objective };
    return {
      goal,
      steps: recoverySteps,
      confidence: 0.5,
      simulationResult: this.simulatePlan(recoverySteps, goal),
    };
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
      ? plan.steps.some((s: any) => s.status === 'waiting_approval')
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

  private generatedPlanToIntent(
    generated: GeneratedPlan,
    input?: CreatePlanFromCommandInput,
  ): ParsedIntent {
    return {
      objective: generated.goal.objective,
      urgency: input?.urgency ?? 'normal',
      scope: generated.goal.successCriteria ?? input?.scope ?? [],
      modules: generated.steps.map((s) => s.module).filter(Boolean) as string[],
      missingInfo: [],
      actionCandidates: generated.steps.map((s) => ({
        toolName: `${s.module}.${s.action}`,
        description: s.expectedBenefit ?? `${s.module}.${s.action}`,
        confidence: 0.8,
        riskTier: s.riskTier ?? 1,
      })),
      clarificationNeeded: false,
      rawInput: input?.rawInput ?? generated.goal.objective,
    };
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
