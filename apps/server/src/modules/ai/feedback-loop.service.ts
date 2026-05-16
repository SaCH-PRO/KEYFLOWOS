import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ModelGatewayService } from './model-gateway.service';
import { AiMemoryService } from './ai-memory.service';
import { AiExecutionLogService } from './ai-execution-log.service';
import { PlannerService } from './planner.service';
import { GovernanceService } from './governance.service';
import { AiUsageService } from './ai-usage.service';

export interface FeedbackContext {
  businessId: string;
  planId: string;
  planStepId: string;
  toolName: string;
  inputPayload: any;
  outputResult: any;
  success: boolean;
  errorMessage?: string;
}

export interface FeedbackAnalysis {
  shouldContinue: boolean;
  shouldSkipNext: boolean;
  shouldReplan: boolean;
  suggestedNextStep?: {
    action: string;
    toolName?: string;
    description: string;
    inputPayload: any;
  };
  correction?: {
    category: string;
    reason: string;
    learnedPattern: string;
  };
}

@Injectable()
export class FeedbackLoopService {
  private readonly logger = new Logger(FeedbackLoopService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
    @Inject(ModelGatewayService) private readonly gateway: ModelGatewayService,
    @Inject(AiMemoryService) private readonly memory: AiMemoryService,
    @Inject(AiExecutionLogService) private readonly executionLog: AiExecutionLogService,
    @Inject(forwardRef(() => PlannerService)) private readonly planner: PlannerService,
    @Inject(forwardRef(() => GovernanceService)) private readonly governance: GovernanceService,
    @Inject(AiUsageService) private readonly aiUsage: AiUsageService,
  ) {}

  async analyze(ctx: FeedbackContext): Promise<FeedbackAnalysis> {
    // Fast path: success with no anomalies
    if (ctx.success && this.isResultHealthy(ctx.outputResult)) {
      return { shouldContinue: true, shouldSkipNext: false, shouldReplan: false };
    }

    const analysis = await this.runAiAnalysis(ctx);

    // Store learned corrections
    if (analysis.correction) {
      await this.memory.upsert(ctx.businessId, {
        category: 'learned_corrections',
        key: `${ctx.toolName}:${analysis.correction.category}`,
        value: JSON.stringify(analysis.correction),
        source: 'feedback_loop',
      }).catch((e: unknown) => {
        this.logger.warn(`Failed to store correction: ${e instanceof Error ? e.message : String(e)}`);
      });
    }

    // Log the feedback
    await this.executionLog.log({
      businessId: ctx.businessId,
      action: 'feedback:analysis',
      toolName: ctx.toolName,
      planId: ctx.planId,
      planStepId: ctx.planStepId,
      mode: 'autonomous',
      actor: 'ai',
      success: ctx.success,
      inputSummary: { success: ctx.success, shouldReplan: analysis.shouldReplan },
      outputSummary: analysis,
    }).catch(() => {});

    return analysis;
  }

  async applyFeedbackToPlan(ctx: FeedbackContext, analysis: FeedbackAnalysis): Promise<void> {
    if (!analysis.shouldReplan && !analysis.suggestedNextStep) return;

    const plan = await this.prisma.client.aiPlan.findUnique({
      where: { id: ctx.planId },
      include: { steps: { orderBy: { order: 'asc' } } },
    });

    if (!plan) return;

    const currentStep = plan.steps.find((s) => s.id === ctx.planStepId);
    if (!currentStep) return;

    // If a next step is suggested, insert it after the current step
    if (analysis.suggestedNextStep) {
      const maxOrder = Math.max(...plan.steps.map((s) => s.order), 0);
      await this.prisma.client.aiPlanStep.create({
        data: {
          planId: ctx.planId,
          order: currentStep.order + 0.5,
          status: 'pending',
          toolName: analysis.suggestedNextStep.toolName ?? null,
          action: analysis.suggestedNextStep.action,
          description: analysis.suggestedNextStep.description,
          inputPayload: analysis.suggestedNextStep.inputPayload,
          riskTier: await this.inferRiskTier(analysis.suggestedNextStep.toolName),
          dependsOn: [ctx.planStepId],
        },
      });

      // Re-normalize orders
      const steps = await this.prisma.client.aiPlanStep.findMany({
        where: { planId: ctx.planId },
        orderBy: { order: 'asc' },
      });
      for (let i = 0; i < steps.length; i++) {
        if (steps[i].order !== i + 1) {
          await this.prisma.client.aiPlanStep.update({
            where: { id: steps[i].id },
            data: { order: i + 1 },
          });
        }
      }
    }

    // If replan is needed, mark the plan for replanning
    if (analysis.shouldReplan) {
      await this.prisma.client.aiPlan.update({
        where: { id: ctx.planId },
        data: { status: 'draft' },
      });

      this.events.emit('plan.replan_required', {
        planId: ctx.planId,
        businessId: ctx.businessId,
        reason: analysis.correction?.reason ?? 'Execution feedback indicated need for replanning',
      });
    }
  }

  private isResultHealthy(result: any): boolean {
    if (!result) return true;
    if (typeof result === 'object') {
      if (result.error || result.failed || result.bounce || result.rejected) return false;
    }
    return true;
  }

  private async runAiAnalysis(ctx: FeedbackContext): Promise<FeedbackAnalysis> {
    try {
      const systemPrompt = `You are an AI execution feedback analyzer. Given a tool execution result, decide:
1. Should the plan continue normally?
2. Should the next step be skipped?
3. Should the plan be replanned?
4. Is there a specific next step that should be inserted?
5. What correction should be learned for future executions?

Respond ONLY with valid JSON in this exact shape:
{
  "shouldContinue": boolean,
  "shouldSkipNext": boolean,
  "shouldReplan": boolean,
  "suggestedNextStep": null | { "action": string, "toolName": string|null, "description": string, "inputPayload": object },
  "correction": null | { "category": string, "reason": string, "learnedPattern": string }
}`;

      const userPrompt = `Tool: ${ctx.toolName}
Success: ${ctx.success}
Input: ${JSON.stringify(ctx.inputPayload)}
Output: ${JSON.stringify(ctx.outputResult)}
Error: ${ctx.errorMessage ?? 'none'}`;

      const response = await this.aiUsage.trackAndComplete(
        ctx.businessId,
        undefined,
        'feedback_loop',
        {
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          maxTokens: 800,
          temperature: 0.2,
        },
      );

      const content = response.content?.trim() ?? '';
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]) as FeedbackAnalysis;
      }
    } catch (err) {
      this.logger.warn(`AI feedback analysis failed: ${(err as Error).message}`);
    }

    // Fallback: simple heuristic
    return {
      shouldContinue: ctx.success,
      shouldSkipNext: false,
      shouldReplan: !ctx.success,
      correction: ctx.success ? undefined : {
        category: 'execution_failure',
        reason: ctx.errorMessage ?? 'Unknown error',
        learnedPattern: `Tool ${ctx.toolName} failed; review input payload before retry`,
      },
    };
  }

  private async inferRiskTier(toolName?: string): Promise<number> {
    if (!toolName) return 2;
    return this.governance.getToolTier(toolName);
  }
}
