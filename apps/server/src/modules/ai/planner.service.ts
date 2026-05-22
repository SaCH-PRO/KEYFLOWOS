import { Injectable, Logger, Inject, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AiUsageService } from './ai-usage.service';
import { BusinessGraphService } from './business-graph.service';
import { GovernanceService } from './governance.service';
import { AiMemoryService } from './ai-memory.service';
import { ParsedIntent } from './intent-parser.service';
import { BlueprintService } from '../blueprint/blueprint.service';

interface RawAiStep {
  order?: number;
  toolName?: string;
  module?: string;
  action?: string;
  description?: string;
  riskTier?: number;
  dependsOnOrders?: number[];
  dependsOn?: string[];
  inputPayload?: Record<string, unknown>;
  expectedBenefit?: string;
}

export interface PlanStep {
  order: number;
  toolName: string | null;
  module: string | null;
  action: string;
  description: string;
  riskTier: number;
  requiresApproval: boolean;
  dependsOnOrders: number[];
  inputPayload: Record<string, any> | null;
  expectedBenefit: string | null;
}

export interface AiPlanResultStep {
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
  steps: AiPlanResultStep[];
}

@Injectable()
export class PlannerService {
  private readonly logger = new Logger(PlannerService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AiUsageService) private readonly aiUsage: AiUsageService,
    @Inject(BusinessGraphService) private readonly businessGraph: BusinessGraphService,
    @Inject(GovernanceService) private readonly governance: GovernanceService,
    @Inject(AiMemoryService) private readonly memory: AiMemoryService,
    @Inject(BlueprintService) private readonly blueprint: BlueprintService,
  ) {}

  async createPlan(businessId: string, intent: ParsedIntent, userId?: string, role?: string): Promise<AiPlanResult> {
    const snapshot = await this.businessGraph.getSnapshot(businessId);
    const contextString = this.businessGraph.buildContextString(snapshot);

    const memoryCtx = await this.memory.buildContextBlock(businessId);
    const memorySection = this.memory.buildPromptSection(memoryCtx);

    const blueprintCtx = await this.blueprint.getBlueprintContext(businessId);
    const blueprintSection = blueprintCtx
      ? `\n\nBUSINESS BLUEPRINT (operating DNA, completeness ${blueprintCtx.completeness}%):\n${blueprintCtx.summary}`
      : '';

    const systemPrompt = `You are KeyFlow AI's plan decomposition engine. Given a parsed intent and business context, produce an ordered list of concrete steps to accomplish the objective.

BUSINESS CONTEXT:
${contextString}${memorySection}${blueprintSection}

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

Respond with JSON only: { "steps": [ { "order": 1, "toolName": "tool_name_or_null", "module": "crm|commerce|bookings|marketing|content|projects|expenses|automations|null", "action": "verb phrase", "description": "detail", "riskTier": 1-4, "dependsOnOrders": [<order numbers of prerequisite steps, e.g. [1] means depends on step with order=1>], "inputPayload": {} or null, "expectedBenefit": "string" } ] }`;

    let steps: PlanStep[];

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

      steps = rawSteps.map((s: RawAiStep, idx: number) => {
        const tierFromGov = s.toolName ? this.governance.getToolTier(s.toolName) : (s.riskTier || 1);
        const depOrders = Array.isArray(s.dependsOnOrders) ? s.dependsOnOrders
          : Array.isArray(s.dependsOn) ? s.dependsOn : [];
        return {
          order: s.order ?? idx + 1,
          toolName: s.toolName || null,
          module: s.module || null,
          action: s.action || `Step ${idx + 1}`,
          description: s.description || '',
          riskTier: tierFromGov,
          requiresApproval: tierFromGov >= 2,
          dependsOnOrders: depOrders.map((v: string | number) => typeof v === 'number' ? v : parseInt(String(v), 10)).filter((n: number) => !isNaN(n)),
          inputPayload: (s.inputPayload as Record<string, unknown> | null) || null,
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
        dependsOnOrders: [] as number[],
        inputPayload: null,
        expectedBenefit: null,
      }));
    }

    const maxRiskTier = steps.reduce((max, s) => Math.max(max, s.riskTier), 1);

    const plan = await this.prisma.client.aiPlan.create({
      data: {
        businessId,
        userId: userId ?? null,
        objective: intent.objective,
        rawInput: intent.rawInput,
        urgency: intent.urgency,
        scope: intent.scope,
        modules: intent.modules,
        maxRiskTier: maxRiskTier,
        status: 'draft',
        role: role ?? null,
        steps: {
          create: steps.map(s => ({
            order: s.order,
            toolName: s.toolName ?? undefined,
            module: s.module ?? undefined,
            action: s.action,
            description: s.description,
            riskTier: s.riskTier,
            requiresApproval: s.requiresApproval,
            dependsOn: [],
            inputPayload: s.inputPayload ? (s.inputPayload as Prisma.InputJsonValue) : Prisma.JsonNull,
            expectedBenefit: s.expectedBenefit ?? undefined,
            status: 'pending',
            role: role ?? undefined,
          })),
        },
      },
      include: { steps: { orderBy: { order: 'asc' } } },
    });

    const hasDeps = steps.some(s => s.dependsOnOrders.length > 0);
    if (hasDeps) {
      const orderToIdMap = new Map<number, string>();
      for (const s of plan.steps) {
        orderToIdMap.set(s.order, s.id);
      }

      for (const rawStep of steps) {
        if (rawStep.dependsOnOrders.length > 0) {
          const dbStep = plan.steps.find(s => s.order === rawStep.order);
          if (!dbStep) continue;
          const resolvedIds = rawStep.dependsOnOrders
            .map((depOrder: number) => orderToIdMap.get(depOrder))
            .filter((id): id is string => !!id);
          if (resolvedIds.length > 0) {
            await this.prisma.client.aiPlanStep.update({
              where: { id: dbStep.id },
              data: { dependsOn: resolvedIds },
            });
          }
        }
      }

      const updatedPlan = await this.prisma.client.aiPlan.findUnique({
        where: { id: plan.id },
        include: { steps: { orderBy: { order: 'asc' } } },
      });
      if (updatedPlan) {
        plan.steps.splice(0, plan.steps.length, ...updatedPlan.steps);
      }
    }

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
      startedAt: plan.startedAt,
      completedAt: plan.completedAt,
      createdAt: plan.createdAt,
      steps: plan.steps.map(s => ({
        id: s.id,
        order: s.order,
        status: s.status,
        toolName: s.toolName,
        module: s.module,
        action: s.action,
        description: s.description ?? '',
        riskTier: s.riskTier,
        requiresApproval: s.requiresApproval,
        dependsOn: s.dependsOn,
        inputPayload: s.inputPayload as Record<string, any> | null,
        outputResult: s.outputResult as Record<string, any> | null,
        errorMessage: s.errorMessage,
        expectedBenefit: s.expectedBenefit,
        startedAt: s.startedAt,
        completedAt: s.completedAt,
      })),
    };
  }

  async listPlans(businessId: string, status?: string, limit = 20) {
    const where: { businessId: string; status?: string } = { businessId };
    if (status) where.status = status;

    return this.prisma.client.aiPlan.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { steps: { orderBy: { order: 'asc' } } },
    });
  }

  async approvePlan(planId: string, businessId: string, userId: string) {
    const plan = await this.prisma.client.aiPlan.findFirst({
      where: { id: planId, businessId },
      include: { steps: true },
    });
    if (!plan) throw new NotFoundException(`Plan ${planId} not found for business ${businessId}`);
    if (plan.status !== 'draft') {
      throw new BadRequestException(`Plan must be in "draft" state to approve (current: "${plan.status}")`);
    }

    const maxTier = plan.maxRiskTier;
    if (maxTier >= 4) {
      const user = await this.prisma.client.user.findUnique({ where: { id: userId } });
      if (!user) throw new NotFoundException('User not found');
      const membership = await this.prisma.client.membership.findFirst({
        where: { userId, businessId },
      });
      const isAdmin = user.role === 'SUPER_ADMIN' || membership?.role === 'OWNER' || membership?.role === 'ADMIN';
      if (!isAdmin) {
        throw new ForbiddenException('Plans with Tier 4 actions require admin-level authorization to approve');
      }
    }

    const updated = await this.prisma.client.aiPlan.update({
      where: { id: planId },
      data: { status: 'approved' },
      include: { steps: { orderBy: { order: 'asc' } } },
    });

    return updated;
  }

  async updatePlanStatus(planId: string, businessId: string, status: string) {
    const updateData: Record<string, unknown> = { status };
    if (status === 'executing') updateData.startedAt = new Date();
    if (status === 'completed' || status === 'failed' || status === 'partial') updateData.completedAt = new Date();

    const plan = await this.prisma.client.aiPlan.findFirst({
      where: { id: planId, businessId },
    });
    if (!plan) throw new NotFoundException(`Plan ${planId} not found for business ${businessId}`);
    return this.prisma.client.aiPlan.update({
      where: { id: planId },
      data: updateData,
    });
  }

  async updateStepStatus(stepId: string, status: string, result?: Record<string, unknown> | null, errorMessage?: string, durationMs?: number) {
    const updateData: Record<string, unknown> = { status };
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
