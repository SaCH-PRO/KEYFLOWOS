import { Injectable, Logger, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AiUsageService } from '../ai/ai-usage.service';
import { BlueprintService } from '../blueprint/blueprint.service';
import { AiOversightService } from '../ai/ai-oversight.service';
import { StrategicIntelligenceService } from '../ai/strategic-intelligence.service';
import { WorkloadAggregatorService } from '../ai/workload-aggregator.service';

interface PlanGenerationResult {
  strategySummary: string;
  swot: {
    strengths: string[];
    weaknesses: string[];
    opportunities: string[];
    threats: string[];
  };
  resourceEstimate: {
    totalHours: number;
    budget: number;
    people: number;
    durationDays: number;
  };
  risks: Array<{
    description: string;
    impact: 'high' | 'medium' | 'low';
    likelihood: 'high' | 'medium' | 'low';
    mitigation: string;
  }>;
  timeline: Array<{
    sortOrder: number;
    eventType: 'task' | 'milestone' | 'decision_gate' | 'review';
    title: string;
    description: string;
    executionContext: 'IN_APP' | 'OUT_APP';
    automationTool: string | null;
    toolPayload: Record<string, unknown> | null;
    manualInstructions: string | null;
    estimatedHours: number | null;
    estimatedStart: string | null;
    estimatedEnd: string | null;
    dependsOn: number[];
    requiredRoles: string[];
    estimatedCost: number | null;
  }>;
}

interface ImpactAnalysisResult {
  canProceed: boolean;
  dependencyViolations: string[];
  timeDeltaDays: number;
  budgetDelta: number;
  peopleImpact: Array<{
    role: string;
    impact: 'overloaded' | 'underutilized' | 'shifted';
    details: string;
  }>;
  riskDelta: 'increased' | 'decreased' | 'neutral';
  newRisks: Array<{ description: string; severity: 'high' | 'medium' | 'low' }>;
  pros: string[];
  cons: string[];
  recommendation: string;
}

const TOOL_ACTIVITY_MAP: Record<string, string> = {
  'create invoice': 'commerce_create_invoice',
  'send quote': 'commerce_create_quote',
  'find contacts': 'crm_search_contacts',
  'search contacts': 'crm_search_contacts',
  'send email': 'marketing_send_campaign',
  'email campaign': 'marketing_send_campaign',
  'schedule post': 'content_schedule_post',
  'social post': 'content_schedule_post',
  'create booking': 'bookings_create_booking',
  'schedule appointment': 'bookings_create_booking',
  'generate report': 'analytics_generate_report',
  'create task': 'projects_create_task',
  'send reminder': 'automation_send_reminder',
  'create deal': 'crm_create_deal',
  'update contact': 'crm_update_contact',
};

@Injectable()
export class ProjectPlannerService {
  private readonly logger = new Logger(ProjectPlannerService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AiUsageService) private readonly aiUsage: AiUsageService,
    @Inject(BlueprintService) private readonly blueprint: BlueprintService,
    @Inject(AiOversightService) private readonly governance: AiOversightService,
    @Inject(StrategicIntelligenceService) private readonly strategic: StrategicIntelligenceService,
    @Inject(WorkloadAggregatorService) private readonly workload: WorkloadAggregatorService,
  ) {}

  async generatePlan(
    businessId: string,
    userIdea: string,
    goalId?: string,
    options?: { estimatedBudget?: number; estimatedDurationDays?: number; preferredModules?: string[] },
  ) {
    const [business, blueprintCtx, goals, workloadSnapshot] = await Promise.all([
      this.prisma.client.business.findUnique({
        where: { id: businessId },
        select: { name: true, industry: true, archetype: true, revenueModel: true, currency: true, tagline: true, description: true },
      }),
      this.blueprint.getBlueprint(businessId).catch(() => null),
      this.prisma.client.businessGoal.findMany({ where: { businessId, status: 'active' }, select: { id: true, title: true, category: true, targetValue: true, currentValue: true, unit: true } }),
      this.workload.getWorkloadForBusiness(businessId).catch(() => null),
    ]);

    if (!business) {
      throw new NotFoundException('Business not found');
    }

    const relevantGoal = goalId ? goals.find(g => g.id === goalId) : null;

    const systemPrompt = `You are Key, KeyFlowOS's strategic planning AI. Given a user's business idea and their business context, generate a comprehensive execution plan rooted in best practices from business strategy, economics, and finance.

BUSINESS CONTEXT:
- Name: ${business.name}
- Industry: ${business.industry || 'N/A'}
- Archetype: ${business.archetype || 'N/A'}
- Revenue Model: ${business.revenueModel || 'N/A'}
- Currency: ${business.currency}
- Description: ${business.description || 'N/A'}
${blueprintCtx ? `- Blueprint Completeness: ${(blueprintCtx as any).completeness || 'N/A'}%` : ''}
${workloadSnapshot ? `- Team Utilization: ${(workloadSnapshot as any).utilizationPercent || 'N/A'}%` : ''}

ACTIVE GOALS:
${goals.map(g => `- ${g.title} (${g.category}): ${g.currentValue ?? 0}/${g.targetValue ?? '?'} ${g.unit || ''}`).join('\n')}
${relevantGoal ? `\nRELEVANT GOAL FOR THIS PLAN: ${relevantGoal.title} (${relevantGoal.category})` : ''}

USER IDEA: ${userIdea}
${options?.estimatedBudget ? `USER BUDGET CONSTRAINT: ${options.estimatedBudget} ${business.currency}` : ''}
${options?.estimatedDurationDays ? `USER TIME CONSTRAINT: ${options.estimatedDurationDays} days` : ''}

OUTPUT FORMAT (JSON):
{
  "strategySummary": "2-3 paragraph strategic rationale grounded in business/finance best practices",
  "swot": { "strengths": [""], "weaknesses": [""], "opportunities": [""], "threats": [""] },
  "resourceEstimate": { "totalHours": number, "budget": number, "people": number, "durationDays": number },
  "risks": [{ "description": "", "impact": "high|medium|low", "likelihood": "high|medium|low", "mitigation": "" }],
  "timeline": [
    {
      "sortOrder": 1,
      "eventType": "task|milestone|decision_gate|review",
      "title": "",
      "description": "",
      "executionContext": "IN_APP|OUT_APP",
      "automationTool": "tool_name_or_null",
      "toolPayload": {},
      "manualInstructions": "",
      "estimatedHours": number,
      "estimatedStart": "ISO date",
      "estimatedEnd": "ISO date",
      "dependsOn": [sortOrder numbers],
      "requiredRoles": [""],
      "estimatedCost": number
    }
  ]
}

RULES:
1. IN_APP tasks must map to available KeyFlowOS tools: ${Object.keys(TOOL_ACTIVITY_MAP).join(', ')}
2. OUT_APP tasks must have clear, actionable manual instructions
3. Sequence tasks by dependency — data gathering first, then decisions, then execution
4. Estimate resources based on the business's actual capacity and financial position
5. Include decision gates before high-risk or high-cost phases
6. Milestones should mark meaningful deliverables or phase completions
7. Budget estimates should be realistic and account for labor, materials, and overhead
8. If the idea is vague, infer reasonable specifics based on the business archetype and industry`;

    const result = await this.aiUsage.callAi({
      businessId,
      feature: 'project_plan_generate',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Create an execution plan for: ${userIdea}` },
      ],
      maxTokens: 2500,
      temperature: 0.4,
      responseMode: 'structured_json',
      taskCategory: 'reasoning',
    });

    let parsed: PlanGenerationResult;
    try {
      parsed = JSON.parse(result.content);
    } catch (err: any) {
      this.logger.warn(`Plan generation JSON parse failed, attempting repair: ${(err as Error).message}`);
      const jsonMatch = result.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        throw new BadRequestException('AI returned invalid plan format');
      }
    }

    // Create ProjectPlan record
    const projectPlan = await this.prisma.client.projectPlan.create({
      data: {
        businessId,
        goalId: goalId || null,
        status: 'draft',
        userIdea,
        strategySummary: parsed.strategySummary,
        estimatedTotalHours: parsed.resourceEstimate?.totalHours,
        estimatedBudget: parsed.resourceEstimate?.budget,
        estimatedPeople: parsed.resourceEstimate?.people,
        estimatedDurationDays: parsed.resourceEstimate?.durationDays,
        riskAnalysis: parsed.risks ? { risks: parsed.risks, overallRiskScore: this.computeOverallRisk(parsed.risks) } : undefined,
        swotAnalysis: parsed.swot || null,
      },
    });

    // Create timeline events
    const timelineEvents = parsed.timeline || [];
    const eventRecords = await Promise.all(
      timelineEvents.map(async (event, idx) => {
        const toolName = event.automationTool || this.inferTool(event.title, event.description);
        const tier = toolName ? this.governance.getToolTier(toolName) : 1;
        return this.prisma.client.projectPlanEvent.create({
          data: {
            planId: projectPlan.id,
            sortOrder: event.sortOrder ?? idx + 1,
            eventType: event.eventType || 'task',
            title: event.title,
            description: event.description,
            executionContext: event.executionContext || 'OUT_APP',
            automationTool: toolName,
            toolPayload: (event.toolPayload || (toolName ? this.buildToolPayload(toolName, event) : undefined)) as Prisma.InputJsonValue | undefined,
            autoExecute: event.executionContext === 'IN_APP' && tier <= 2,
            requiresApproval: tier >= 2,
            manualInstructions: event.manualInstructions || (event.executionContext === 'OUT_APP' ? event.description : null),
            estimatedHours: event.estimatedHours,
            estimatedStart: event.estimatedStart ? new Date(event.estimatedStart) : null,
            estimatedEnd: event.estimatedEnd ? new Date(event.estimatedEnd) : null,
            dependsOn: event.dependsOn?.map(String) || [],
            requiredRoles: event.requiredRoles || [],
            estimatedCost: event.estimatedCost,
          },
        });
      }),
    );

    return {
      ...projectPlan,
      timelineEvents: eventRecords,
      strategySummary: parsed.strategySummary,
      swot: parsed.swot,
      resourceEstimate: parsed.resourceEstimate,
      risks: parsed.risks,
    };
  }

  async analyzeRearrangement(
    businessId: string,
    planId: string,
    eventId: string,
    newSortOrder: number,
  ): Promise<ImpactAnalysisResult> {
    const plan = await this.prisma.client.projectPlan.findFirst({
      where: { id: planId, businessId },
      include: { timelineEvents: { orderBy: { sortOrder: 'asc' } } },
    });

    if (!plan) {
      throw new NotFoundException('Plan not found');
    }

    const event = plan.timelineEvents.find(e => e.id === eventId);
    if (!event) {
      throw new NotFoundException('Event not found');
    }

    const currentEvents = plan.timelineEvents.map(e => ({
      id: e.id,
      sortOrder: e.id === eventId ? newSortOrder : e.sortOrder,
      title: e.title,
      eventType: e.eventType,
      estimatedHours: e.estimatedHours,
      estimatedCost: e.estimatedCost,
      requiredRoles: e.requiredRoles,
      dependsOn: e.dependsOn,
      executionContext: e.executionContext,
    }));

    // Sort by the proposed new order
    currentEvents.sort((a, b) => a.sortOrder - b.sortOrder);

    const systemPrompt = `You are Key's strategic planning impact analyzer. Given a project plan timeline and a proposed rearrangement, analyze the impact on effort, time, people, and budget.

CURRENT TIMELINE (with proposed change):
${JSON.stringify(currentEvents, null, 2)}

PROPOSED CHANGE: Move "${event.title}" to position ${newSortOrder}

RESOURCE CONSTRAINTS:
- Estimated total hours: ${plan.estimatedTotalHours || 'N/A'}
- Budget: ${plan.estimatedBudget || 'N/A'}
- People: ${plan.estimatedPeople || 'N/A'}

Analyze:
1. Does this violate any dependencies?
2. How does this affect total duration?
3. How does this affect resource utilization?
4. How does this affect budget?
5. What new risks does this introduce?
6. What are the advantages?

Respond with JSON only:
{
  "canProceed": boolean,
  "dependencyViolations": [""],
  "timeDeltaDays": number,
  "budgetDelta": number,
  "peopleImpact": [{ "role": "", "impact": "overloaded|underutilized|shifted", "details": "" }],
  "riskDelta": "increased|decreased|neutral",
  "newRisks": [{ "description": "", "severity": "high|medium|low" }],
  "pros": [""],
  "cons": [""],
  "recommendation": ""
}`;

    const result = await this.aiUsage.callAi({
      businessId,
      feature: 'project_plan_impact_analysis',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Analyze the impact of moving "${event.title}" to position ${newSortOrder}` },
      ],
      maxTokens: 1200,
      temperature: 0.3,
      responseMode: 'structured_json',
      taskCategory: 'reasoning',
    });

    let parsed: ImpactAnalysisResult;
    try {
      parsed = JSON.parse(result.content);
    } catch (err: any) {
      this.logger.warn(`Impact analysis JSON parse failed: ${(err as Error).message}`);
      parsed = {
        canProceed: true,
        dependencyViolations: [],
        timeDeltaDays: 0,
        budgetDelta: 0,
        peopleImpact: [],
        riskDelta: 'neutral',
        newRisks: [],
        pros: [],
        cons: ['Unable to analyze impact due to parsing error'],
        recommendation: 'Proceed with caution',
      };
    }

    // Cache the impact analysis on the event
    await this.prisma.client.projectPlanEvent.update({
      where: { id: eventId },
      data: {
        impactAnalysis: {
          timeDeltaDays: parsed.timeDeltaDays,
          budgetDelta: parsed.budgetDelta,
          riskDelta: parsed.riskDelta,
          pros: parsed.pros,
          cons: parsed.cons,
          recommendation: parsed.recommendation,
          analyzedAt: new Date().toISOString(),
        },
      },
    });

    return parsed;
  }

  async getPlan(businessId: string, planId: string) {
    const plan = await this.prisma.client.projectPlan.findFirst({
      where: { id: planId, businessId },
      include: {
        timelineEvents: { orderBy: { sortOrder: 'asc' } },
        goal: true,
        project: true,
      },
    });

    if (!plan) {
      throw new NotFoundException('Plan not found');
    }

    return plan;
  }

  async listPlans(businessId: string) {
    return this.prisma.client.projectPlan.findMany({
      where: { businessId },
      include: {
        timelineEvents: { orderBy: { sortOrder: 'asc' }, take: 3 },
        goal: { select: { id: true, title: true, category: true } },
        project: { select: { id: true, name: true, status: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async updatePlan(businessId: string, planId: string, body: {
    status?: string;
    strategySummary?: string;
    estimatedTotalHours?: number;
    estimatedBudget?: number;
    estimatedPeople?: number;
    estimatedDurationDays?: number;
    riskAnalysis?: Record<string, unknown>;
    swotAnalysis?: Record<string, unknown>;
  }) {
    const plan = await this.prisma.client.projectPlan.findFirst({
      where: { id: planId, businessId },
    });

    if (!plan) {
      throw new NotFoundException('Plan not found');
    }

    return this.prisma.client.projectPlan.update({
      where: { id: planId },
      data: body,
    });
  }

  async reorderEvents(businessId: string, planId: string, updates: { eventId: string; sortOrder: number }[]) {
    const plan = await this.prisma.client.projectPlan.findFirst({
      where: { id: planId, businessId },
    });

    if (!plan) {
      throw new NotFoundException('Plan not found');
    }

    await Promise.all(
      updates.map(u =>
        this.prisma.client.projectPlanEvent.update({
          where: { id: u.eventId, planId },
          data: { sortOrder: u.sortOrder },
        }),
      ),
    );

    return this.getPlan(businessId, planId);
  }

  async deletePlan(businessId: string, planId: string) {
    const plan = await this.prisma.client.projectPlan.findFirst({
      where: { id: planId, businessId },
    });

    if (!plan) {
      throw new NotFoundException('Plan not found');
    }

    // Cascade delete timeline events
    await this.prisma.client.projectPlanEvent.deleteMany({
      where: { planId },
    });

    await this.prisma.client.projectPlan.delete({
      where: { id: planId },
    });

    return { success: true };
  }

  private inferTool(title: string, description?: string | null): string | null {
    const text = `${title} ${description || ''}`.toLowerCase();
    for (const [keyword, tool] of Object.entries(TOOL_ACTIVITY_MAP)) {
      if (text.includes(keyword)) {
        return tool;
      }
    }
    return null;
  }

  private buildToolPayload(toolName: string, event: any): Record<string, unknown> | null {
    // Build minimal payload based on tool name — executor will fill in gaps
    const basePayload: Record<string, unknown> = {};
    if (toolName.includes('commerce')) {
      basePayload['businessId'] = '';
    }
    if (toolName.includes('crm')) {
      basePayload['businessId'] = '';
    }
    if (toolName.includes('bookings')) {
      basePayload['businessId'] = '';
    }
    if (toolName.includes('marketing')) {
      basePayload['businessId'] = '';
    }
    return Object.keys(basePayload).length > 0 ? basePayload : null;
  }

  private computeOverallRisk(risks: Array<{ impact: string; likelihood: string }>): number {
    const scoreMap: Record<string, number> = { high: 3, medium: 2, low: 1 };
    if (!risks.length) return 0;
    const total = risks.reduce((sum, r) => {
      return sum + (scoreMap[r.impact] || 1) * (scoreMap[r.likelihood] || 1);
    }, 0);
    return Math.round((total / (risks.length * 9)) * 100);
  }
}
