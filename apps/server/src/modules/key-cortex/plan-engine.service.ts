import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

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

export interface GeneratedPlan {
  goal: PlanGoal;
  steps: PlanStep[];
  confidence: number;
  simulationResult?: PlanSimulationResult;
}

export interface PlanSimulationResult {
  successProbability: number;
  risks: string[];
  assumptions: string[];
}

/**
 * Long-horizon planning engine for KEY.
 *
 * Decomposes goals into ordered steps, simulates execution, monitors
 * progress, and triggers replanning when assumptions fail.
 */
@Injectable()
export class PlanEngineService {
  private readonly logger = new Logger(PlanEngineService.name);

  constructor(private readonly prisma: PrismaService) {}

  async generatePlan(businessId: string, goal: PlanGoal): Promise<GeneratedPlan> {
    // Foundation implementation: deterministic decomposition based on keywords.
    const steps = this.decomposeGoal(goal);
    const simulation = this.simulatePlan(steps, goal);

    const plan = await this.prisma.client.aiPlan.create({
      data: {
        businessId,
        objective: goal.objective,
        status: 'draft',
        urgency: 'normal',
        scope: goal.successCriteria ?? [],
        modules: Array.from(new Set(steps.map((s) => s.module ?? 'general'))),
        maxRiskTier: Math.max(1, ...steps.map((s) => s.riskTier ?? 1)),
        rawInput: JSON.stringify({ goal, simulation }),
      },
    });

    for (const step of steps) {
      await this.prisma.client.aiPlanStep.create({
        data: {
          planId: plan.id,
          order: step.order,
          status: 'pending',
          toolName: step.action,
          action: step.action,
          module: step.module ?? 'general',
          description: step.expectedBenefit ?? '',
          riskTier: step.riskTier ?? 1,
          inputPayload: step.parameters as any,
          expectedBenefit: step.expectedBenefit ?? '',
        },
      });
    }

    this.logger.log(`[generatePlan] Created plan ${plan.id} with ${steps.length} step(s)`);

    return {
      goal,
      steps,
      confidence: simulation.successProbability,
      simulationResult: simulation,
    };
  }

  async replanIfNeeded(planId: string): Promise<GeneratedPlan | null> {
    const plan = await this.prisma.client.aiPlan.findUnique({
      where: { id: planId },
      include: { steps: true },
    });
    if (!plan) return null;

    const failedSteps = plan.steps.filter((s) => s.status === 'failed');
    if (failedSteps.length === 0) return null;

    // Foundation: append recovery steps for failed steps.
    const newSteps: PlanStep[] = failedSteps.map((s, i) => ({
      order: plan.steps.length + i + 1,
      action: `recover_${s.action}`,
      module: s.module ?? 'general',
      parameters: (s.inputPayload as Record<string, unknown>) ?? {},
      dependsOn: [s.order],
      riskTier: Math.min(4, (s.riskTier ?? 1) + 1),
      expectedBenefit: `Recover from failure: ${s.errorMessage ?? 'unknown'}`,
    }));

    for (const step of newSteps) {
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

    return {
      goal: { objective: plan.objective },
      steps: newSteps,
      confidence: 0.5,
    };
  }

  private decomposeGoal(goal: PlanGoal): PlanStep[] {
    const text = goal.objective.toLowerCase();
    const steps: PlanStep[] = [];

    if (text.includes('invoice') || text.includes('bill')) {
      steps.push(
        { order: 1, action: 'validate_customer', module: 'crm', riskTier: 1, expectedBenefit: 'Confirm customer exists and is billable' },
        { order: 2, action: 'draft_invoice', module: 'commerce', riskTier: 2, expectedBenefit: 'Create invoice draft' },
        { order: 3, action: 'send_invoice', module: 'commerce', riskTier: 2, dependsOn: [2], expectedBenefit: 'Deliver invoice to customer' },
      );
    } else if (text.includes('follow') || text.includes('task')) {
      steps.push(
        { order: 1, action: 'create_task', module: 'workflow', riskTier: 1, expectedBenefit: 'Create follow-up task' },
        { order: 2, action: 'schedule_reminder', module: 'calendar', riskTier: 1, dependsOn: [1], expectedBenefit: 'Set reminder' },
      );
    } else {
      steps.push(
        { order: 1, action: 'analyze_request', module: 'ai', riskTier: 1, expectedBenefit: 'Understand request' },
        { order: 2, action: 'draft_response', module: 'ai', riskTier: 1, dependsOn: [1], expectedBenefit: 'Prepare response' },
      );
    }

    return steps;
  }

  private simulatePlan(steps: PlanStep[], _goal: PlanGoal): PlanSimulationResult {
    const maxRisk = Math.max(1, ...steps.map((s) => s.riskTier ?? 1));
    const successProbability = Math.max(0.3, 1 - (maxRisk - 1) * 0.15 - steps.length * 0.02);
    return {
      successProbability,
      risks: steps.filter((s) => (s.riskTier ?? 1) >= 3).map((s) => `High-risk step: ${s.action}`),
      assumptions: ['Business data is current', 'Required permissions are granted'],
    };
  }
}
