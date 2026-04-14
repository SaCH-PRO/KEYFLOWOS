import { Injectable, Logger, Inject } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AiUsageService } from './ai-usage.service';
import { BusinessGraphService } from './business-graph.service';
import { GovernanceService } from './governance.service';
import { ParsedIntent } from './intent-parser.service';

export interface PlanStep {
  order: number;
  toolName: string | null;
  module: string | null;
  action: string;
  description: string;
  riskTier: number;
  requiresApproval: boolean;
  dependsOn: string[];
  inputPayload: Record<string, any> | null;
  expectedBenefit: string | null;
}

export interface AiPlanResult {
  id: string;
  status: string;
  objective: string;
  urgency: string;
  modules: string[];
  maxRiskTier: number;
  steps: PlanStep[];
}

@Injectable()
export class PlannerService {
  private readonly logger = new Logger(PlannerService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AiUsageService) private readonly aiUsage: AiUsageService,
    @Inject(BusinessGraphService) private readonly businessGraph: BusinessGraphService,
    @Inject(GovernanceService) private readonly governance: GovernanceService,
  ) {}

  async createPlan(businessId: string, intent: ParsedIntent): Promise<AiPlanResult> {
    const snapshot = await this.businessGraph.getSnapshot(businessId);
    const contextString = this.businessGraph.buildContextString(snapshot);

    const systemPrompt = `You are KeyFlow AI's plan decomposition engine. Given a parsed intent and business context, produce an ordered list of concrete steps to accomplish the objective.

BUSINESS CONTEXT:
${contextString}

INTENT:
- Objective: ${intent.objective}
- Urgency: ${intent.urgency}
- Modules: ${intent.modules.join(', ')}
- Scope: ${intent.scope.join(', ')}
${intent.missingInfo.length > 0 ? `- Missing info (work around if possible): ${intent.missingInfo.join(', ')}` : ''}

ACTION CANDIDATES (from intent parser):
${intent.actionCandidates.map(ac => `  - ${ac.toolName}: ${ac.description} (confidence: ${ac.confidence}, tier: ${ac.riskTier})`).join('\n')}

RULES:
1. Each step should use one of the available tools or be an "analyze" step that gathers info
2. Steps should be ordered by dependency — data-gathering first, then actions
3. Higher-risk steps (tier 3-4) must come after lower-risk confirmation steps where possible
4. Be specific with input payloads when enough context exists
5. Include expected benefits for each step

Respond with JSON only: { "steps": [ { "order": 1, "toolName": "tool_name_or_null", "module": "crm|commerce|bookings|marketing|content|projects|expenses|automations|null", "action": "verb phrase", "description": "detail", "riskTier": 1-4, "dependsOn": [], "inputPayload": {} or null, "expectedBenefit": "string" } ] }`;

    let steps: PlanStep[] = [];

    try {
      const result = await this.aiUsage.callAi({
        businessId,
        feature: 'plan_decompose',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Create an execution plan for: ${intent.objective}` },
        ],
        maxTokens: 1200,
        temperature: 0.3,
        responseMode: 'structured_json',
      });

      const parsed = JSON.parse(result.content);
      const rawSteps = Array.isArray(parsed.steps) ? parsed.steps : Array.isArray(parsed) ? parsed : [];

      steps = rawSteps.map((s: any, idx: number) => {
        const tierFromGov = s.toolName ? this.governance.getToolTier(s.toolName) : (s.riskTier || 1);
        return {
          order: s.order ?? idx + 1,
          toolName: s.toolName || null,
          module: s.module || null,
          action: s.action || `Step ${idx + 1}`,
          description: s.description || '',
          riskTier: tierFromGov,
          requiresApproval: tierFromGov >= 2,
          dependsOn: Array.isArray(s.dependsOn) ? s.dependsOn : [],
          inputPayload: s.inputPayload || null,
          expectedBenefit: s.expectedBenefit || null,
        };
      });
    } catch (err) {
      this.logger.warn(`Plan generation fallback: ${(err as Error).message}`);
      steps = intent.actionCandidates.map((ac, idx) => ({
        order: idx + 1,
        toolName: ac.toolName,
        module: null,
        action: ac.description,
        description: ac.description,
        riskTier: ac.riskTier,
        requiresApproval: ac.riskTier >= 2,
        dependsOn: [],
        inputPayload: null,
        expectedBenefit: null,
      }));
    }

    const maxRiskTier = steps.reduce((max, s) => Math.max(max, s.riskTier), 1);

    const plan = await this.prisma.client.aiPlan.create({
      data: {
        businessId,
        objective: intent.objective,
        rawInput: intent.rawInput,
        urgency: intent.urgency,
        scope: intent.scope,
        modules: intent.modules,
        maxRiskTier: maxRiskTier,
        status: 'draft',
        steps: {
          create: steps.map(s => ({
            order: s.order,
            toolName: s.toolName ?? undefined,
            module: s.module ?? undefined,
            action: s.action,
            description: s.description,
            riskTier: s.riskTier,
            requiresApproval: s.requiresApproval,
            dependsOn: s.dependsOn,
            inputPayload: s.inputPayload ? (s.inputPayload as Prisma.InputJsonValue) : Prisma.JsonNull,
            expectedBenefit: s.expectedBenefit ?? undefined,
            status: 'pending',
          })),
        },
      },
      include: { steps: { orderBy: { order: 'asc' } } },
    });

    return {
      id: plan.id,
      status: plan.status,
      objective: plan.objective,
      urgency: plan.urgency,
      modules: plan.modules,
      maxRiskTier: plan.maxRiskTier,
      steps: plan.steps.map(s => ({
        order: s.order,
        toolName: s.toolName,
        module: s.module,
        action: s.action,
        description: s.description ?? '',
        riskTier: s.riskTier,
        requiresApproval: s.requiresApproval,
        dependsOn: s.dependsOn,
        inputPayload: s.inputPayload as Record<string, any> | null,
        expectedBenefit: s.expectedBenefit,
      })),
    };
  }

  async getPlan(planId: string, businessId: string): Promise<AiPlanResult | null> {
    const plan = await this.prisma.client.aiPlan.findFirst({
      where: { id: planId, businessId },
      include: { steps: { orderBy: { order: 'asc' } } },
    });
    if (!plan) return null;

    return {
      id: plan.id,
      status: plan.status,
      objective: plan.objective,
      urgency: plan.urgency,
      modules: plan.modules,
      maxRiskTier: plan.maxRiskTier,
      steps: plan.steps.map(s => ({
        order: s.order,
        toolName: s.toolName,
        module: s.module,
        action: s.action,
        description: s.description ?? '',
        riskTier: s.riskTier,
        requiresApproval: s.requiresApproval,
        dependsOn: s.dependsOn,
        inputPayload: s.inputPayload as Record<string, any> | null,
        expectedBenefit: s.expectedBenefit,
      })),
    };
  }

  async listPlans(businessId: string, status?: string, limit = 20) {
    const where: any = { businessId };
    if (status) where.status = status;

    return this.prisma.client.aiPlan.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { steps: { orderBy: { order: 'asc' } } },
    });
  }

  async updatePlanStatus(planId: string, businessId: string, status: string) {
    const updateData: any = { status };
    if (status === 'executing') updateData.startedAt = new Date();
    if (status === 'completed' || status === 'failed') updateData.completedAt = new Date();

    const plan = await this.prisma.client.aiPlan.findFirst({
      where: { id: planId, businessId },
    });
    if (!plan) throw new Error(`Plan ${planId} not found for business ${businessId}`);
    return this.prisma.client.aiPlan.update({
      where: { id: planId },
      data: updateData,
    });
  }

  async updateStepStatus(stepId: string, status: string, result?: any, errorMessage?: string, durationMs?: number) {
    const updateData: any = { status };
    if (status === 'executing') updateData.startedAt = new Date();
    if (status === 'completed' || status === 'failed') updateData.completedAt = new Date();
    if (result !== undefined) updateData.outputResult = result;
    if (errorMessage) updateData.errorMessage = errorMessage;
    if (durationMs !== undefined) updateData.durationMs = durationMs;

    return this.prisma.client.aiPlanStep.update({
      where: { id: stepId },
      data: updateData,
    });
  }
}
