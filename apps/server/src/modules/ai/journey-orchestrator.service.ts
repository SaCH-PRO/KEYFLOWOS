import { Injectable, Logger, Inject, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PlannerService } from './planner.service';
import { AiOversightService } from './ai-oversight.service';
import { FlowOrchestratorService } from './flow-orchestrator.service';
import { RoleEngineService, BusinessRole } from './role-engine.service';
import { getTemplatesForEvent, JourneyTemplate, JourneyStep } from './journey-templates';

export interface JourneyExecutionResult {
  journeyInstanceId: string;
  planId: string;
  status: string;
  stepsExecuted: number;
  stepsFailed: number;
}

@Injectable()
export class JourneyOrchestratorService implements OnModuleInit {
  private readonly logger = new Logger(JourneyOrchestratorService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
    @Inject(PlannerService) private readonly planner: PlannerService,
    @Inject(AiOversightService) private readonly governance: AiOversightService,
    @Inject(FlowOrchestratorService) private readonly flowOrchestrator: FlowOrchestratorService,
    @Inject(RoleEngineService) private readonly roleEngine: RoleEngineService,
  ) {}

  onModuleInit() {
    this.logger.log(`Journey Orchestrator initialized with ${getTemplatesForEvent('*').length} templates`);
  }

  async handleEvent(eventName: string, payload: Record<string, any>): Promise<JourneyExecutionResult[]> {
    const businessId = payload?.businessId;
    if (!businessId) {
      this.logger.warn(`Event ${eventName} has no businessId, skipping journey check`);
      return [];
    }

    const templates = getTemplatesForEvent(eventName);
    if (templates.length === 0) return [];

    const results: JourneyExecutionResult[] = [];
    for (const template of templates) {
      try {
        const result = await this.executeJourney(businessId, template, payload);
        if (result) results.push(result);
      } catch (err) {
        this.logger.error(`Journey ${template.key} failed for event ${eventName}: ${(err as Error).message}`);
      }
    }

    return results;
  }

  async executeJourney(
    businessId: string,
    template: JourneyTemplate,
    payload: Record<string, any>,
  ): Promise<JourneyExecutionResult | null> {
    // Check daily auto-action limit
    const settings = await this.prisma.client.autopilotSettings.findUnique({ where: { businessId } });
    if (settings) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayActions = await this.prisma.client.aiExecutionLog.count({
        where: { businessId, actor: 'ai', createdAt: { gte: today } },
      });
      if (todayActions >= settings.maxDailyAutoActions) {
        this.logger.warn(`Daily auto-action limit reached for business ${businessId}, skipping journey ${template.key}`);
        return null;
      }
    }

    // Evaluate which steps should execute
    const previousResults: Record<string, any>[] = [];
    const stepStates: Array<{ stepIndex: number; status: string; result?: any; error?: string }> = [];

    for (let i = 0; i < template.steps.length; i++) {
      const step = template.steps[i];
      const shouldRun = this.shouldExecuteStep(step, payload, previousResults);
      stepStates.push({ stepIndex: i, status: shouldRun ? 'pending' : 'skipped' });
      if (!shouldRun) {
        previousResults.push({ skipped: true, stepIndex: i });
      }
    }

    const executableSteps = template.steps.filter((s, i) => stepStates[i].status === 'pending');
    if (executableSteps.length === 0) {
      this.logger.log(`Journey ${template.key} has no executable steps for business ${businessId}`);
      return null;
    }

    // Create AiPlan for the journey
    const planResult = await this.planner.createPlan(
      businessId,
      {
        objective: `Journey: ${template.name}`,
        rawInput: `Auto-triggered by ${template.triggerEvent}: ${template.description}`,
        urgency: 'normal',
        scope: [template.triggerEvent],
        modules: executableSteps.map((s) => this.inferModule(s.toolName)).filter(Boolean) as string[],
        maxRiskTier: Math.max(...executableSteps.map((s) => this.governance.getToolTier(s.toolName))),
        actionCandidates: [],
        missingInfo: [],
        clarificationNeeded: false,
      } as any,
      undefined,
    );

    if (!planResult) {
      this.logger.warn(`Failed to create plan for journey ${template.key}`);
      return null;
    }

    // Create JourneyInstance
    const journeyInstance = await this.prisma.client.journeyInstance.create({
      data: {
        businessId,
        templateKey: template.key,
        triggerEvent: template.triggerEvent,
        status: 'running',
        planId: planResult.id,
        steps: stepStates as any,
      },
    });

    // Update plan with journey instance ID
    await this.prisma.client.aiPlan.update({
      where: { id: planResult.id },
      data: { journeyInstanceId: journeyInstance.id },
    });

    // Create plan steps for each journey step
    const planSteps: Array<{ id: string; order: number; role?: string }> = [];
    for (let i = 0; i < template.steps.length; i++) {
      const step = template.steps[i];
      const stepState = stepStates[i];
      if (stepState.status === 'skipped') continue;

      const args = step.inputMapping(payload, previousResults);
      const tier = this.governance.getToolTier(step.toolName);

      const planStep = await this.prisma.client.aiPlanStep.create({
        data: {
          planId: planResult.id,
          order: i + 1,
          status: 'pending',
          toolName: step.toolName,
          module: this.inferModule(step.toolName),
          action: step.description,
          description: step.description,
          riskTier: tier,
          requiresApproval: tier >= 2,
          dependsOn: i > 0 ? [planSteps[planSteps.length - 1]?.id].filter(Boolean) as string[] : [],
          inputPayload: args as any,
          role: step.role,
          journeyStepIndex: i,
        },
      });
      planSteps.push({ id: planStep.id, order: planStep.order, role: step.role });
    }

    // Auto-approve the plan if all steps are within risk tolerance
    const maxTier = Math.max(...executableSteps.map((s) => this.governance.getToolTier(s.toolName)));
    if (maxTier <= 2) {
      await this.prisma.client.aiPlan.update({
        where: { id: planResult.id },
        data: { status: 'approved' },
      });
      this.logger.log(`Auto-approved plan ${planResult.id} for journey ${template.key}`);
      // Trigger immediate execution — no 30s polling delay
      this.events.emit('plan.approved', { planId: planResult.id, businessId });
    }

    this.events.emit('journey.started', {
      businessId,
      journeyInstanceId: journeyInstance.id,
      planId: planResult.id,
      templateKey: template.key,
    });

    return {
      journeyInstanceId: journeyInstance.id,
      planId: planResult.id,
      status: 'running',
      stepsExecuted: 0,
      stepsFailed: 0,
    };
  }

  private shouldExecuteStep(
    step: JourneyStep,
    payload: Record<string, any>,
    previousResults: Record<string, any>[],
  ): boolean {
    if (step.condition) {
      try {
        return step.condition(payload, previousResults);
      } catch {
        return false;
      }
    }
    return true;
  }

  async getJourneyInstances(businessId: string, status?: string): Promise<any[]> {
    return this.prisma.client.journeyInstance.findMany({
      where: { businessId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
      include: { plan: { select: { id: true, status: true, objective: true } } },
    });
  }

  async getJourneyInstance(instanceId: string, businessId: string): Promise<any | null> {
    return this.prisma.client.journeyInstance.findFirst({
      where: { id: instanceId, businessId },
      include: { plan: { include: { steps: { orderBy: { order: 'asc' } } } } },
    });
  }

  async updateJourneyStatus(instanceId: string, status: string): Promise<void> {
    await this.prisma.client.journeyInstance.update({
      where: { id: instanceId },
      data: { status, ...(status === 'completed' || status === 'failed' ? { completedAt: new Date() } : {}) },
    });
  }

  private inferModule(toolName: string): string | null {
    if (toolName.startsWith('crm_')) return 'crm';
    if (toolName.startsWith('commerce_')) return 'commerce';
    if (toolName.startsWith('bookings_')) return 'bookings';
    if (toolName.startsWith('marketing_')) return 'marketing';
    if (toolName.startsWith('social_')) return 'content';
    if (toolName.startsWith('projects_')) return 'projects';
    if (toolName.startsWith('fetch_')) return 'intelligence';
    if (toolName.startsWith('draft_')) return 'drafts';
    if (toolName.startsWith('create_') || toolName.startsWith('tag_') || toolName.startsWith('segment_')) return 'organize';
    if (toolName.startsWith('send_')) return 'communications';
    return 'system';
  }
}
