import { Body, Controller, Delete, Get, Inject, Param, Post, Put, Query, Req, UseGuards, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CrmRateLimit, CrmRateLimitGuard } from '../crm/guards/rate-limit.guard';
import { AiAdvisorService } from './ai-advisor.service';
import { AiUsageService } from './ai-usage.service';
import { AiExecutionLogService } from './ai-execution-log.service';
import { GovernanceService, RiskTier } from './governance.service';
import { BusinessGraphService } from './business-graph.service';
import { IntentParserService } from './intent-parser.service';
import { PlannerService } from './planner.service';
import { AiMemoryService, MemoryCategory } from './ai-memory.service';
import { StrategicIntelligenceService } from './strategic-intelligence.service';
import { ProAutoMonitorService } from './pro-auto-monitor.service';
import { ProfileIntelligenceService } from './profile-intelligence.service';
import { WorkspaceRecommendationsService } from './workspace-recommendations.service';
import { ModelGatewayService, AiMode, BudgetCaps } from './model-gateway.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { Request } from 'express';

interface AuthenticatedRequest extends Request {
  user?: { id: string; email?: string; role?: string };
}
import { PrismaService } from '../../core/prisma/prisma.service';
import { KeyCommandService } from './key-command.service';
import { AutopilotRulesService } from './autopilot-rules.service';
import { AgentHealthService } from './agent-health.service';
import { JourneyOrchestratorService } from './journey-orchestrator.service';
import { MorningBriefingService } from './morning-briefing.service';
import { UnifiedInboxService } from './unified-inbox.service';
import { GoalTrackerService } from './goal-tracker.service';
import { WorkloadAggregatorService } from './workload-aggregator.service';
import { TaskPrioritizerService } from './task-prioritizer.service';
import { CapacityInsightService } from './capacity-insight.service';
import { TaskRebalancerService } from './task-rebalancer.service';
import { UndoService } from './undo.service';
import { ProactiveSuggestionService } from './proactive-suggestion.service';
import { WorkflowTemplateService } from './workflow-template.service';


const RESERVED_MEMORY_CATEGORIES = new Set(['settings']);
const ALLOWED_MEMORY_CATEGORIES = new Set<string>([
  'goals', 'tone', 'riskTolerance', 'outreachStyle', 'reportingCadence',
  'priorities', 'bottlenecks', 'corrections', 'patterns', 'preferences',
]);

function assertMemoryCategoryAllowed(category: string): void {
  if (RESERVED_MEMORY_CATEGORIES.has(category)) {
    throw new BadRequestException(`Category "${category}" is reserved and cannot be modified through this endpoint`);
  }
  if (!ALLOWED_MEMORY_CATEGORIES.has(category)) {
    throw new BadRequestException(`Invalid memory category "${category}"`);
  }
}

function safeInt(val: string | undefined, fallback: number): number {
  if (!val) return fallback;
  const n = parseInt(val, 10);
  return Number.isNaN(n) || n < 0 ? fallback : n;
}

@Controller('ai')
@UseGuards(CrmRateLimitGuard)
export class AiController {
  constructor(
    @Inject(AiAdvisorService) private readonly advisor: AiAdvisorService,
    @Inject(AiUsageService) private readonly aiUsage: AiUsageService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AiExecutionLogService) private readonly executionLog: AiExecutionLogService,
    @Inject(GovernanceService) private readonly governance: GovernanceService,
    @Inject(BusinessGraphService) private readonly businessGraph: BusinessGraphService,
    @Inject(IntentParserService) private readonly intentParser: IntentParserService,
    @Inject(PlannerService) private readonly planner: PlannerService,
    @Inject(AiMemoryService) private readonly memory: AiMemoryService,
    @Inject(StrategicIntelligenceService) private readonly strategic: StrategicIntelligenceService,
    @Inject(ProAutoMonitorService) private readonly proAutoMonitor: ProAutoMonitorService,
    @Inject(ProfileIntelligenceService) private readonly profileIntelligence: ProfileIntelligenceService,
    @Inject(WorkspaceRecommendationsService) private readonly workspaceRecs: WorkspaceRecommendationsService,
    @Inject(ModelGatewayService) private readonly gateway: ModelGatewayService,
    @Inject(KeyCommandService) private readonly keyCommand: KeyCommandService,
    @Inject(AutopilotRulesService) private readonly autopilot: AutopilotRulesService,
    @Inject(AgentHealthService) private readonly agentHealth: AgentHealthService,
    @Inject(JourneyOrchestratorService) private readonly journeyOrchestrator: JourneyOrchestratorService,
    @Inject(MorningBriefingService) private readonly morningBriefingSvc: MorningBriefingService,
    @Inject(UnifiedInboxService) private readonly inbox: UnifiedInboxService,
    @Inject(GoalTrackerService) private readonly goalTracker: GoalTrackerService,
    @Inject(WorkloadAggregatorService) private readonly workload: WorkloadAggregatorService,
    @Inject(TaskPrioritizerService) private readonly prioritizer: TaskPrioritizerService,
    @Inject(CapacityInsightService) private readonly capacityInsight: CapacityInsightService,
    @Inject(TaskRebalancerService) private readonly rebalancer: TaskRebalancerService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
    @Inject(UndoService) private readonly undoService: UndoService,
    @Inject(ProactiveSuggestionService) private readonly suggestions: ProactiveSuggestionService,
    @Inject(WorkflowTemplateService) private readonly workflows: WorkflowTemplateService,
  ) {}

  @Get('health')
  health() {
    return { status: 'ok', module: 'ai' };
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @CrmRateLimit(30, 60_000)
  @Post('businesses/:businessId/ai/chat')
  async chat(
    @Param('businessId') businessId: string,
    @Body() body: { message: string; history?: Array<{ role: string; content: string }> },
  ) {
    return this.advisor.chat(businessId, body.message, body.history);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @CrmRateLimit(10, 60_000)
  @Get('businesses/:businessId/ai/briefing')
  async briefing(@Param('businessId') businessId: string) {
    return this.advisor.generateDailyBriefing(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/ai/cash-flow-forecast')
  async cashFlowForecast(
    @Param('businessId') businessId: string,
    @Query('days') days?: string,
  ) {
    return this.advisor.predictCashFlow(businessId, days ? parseInt(days, 10) : 30);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @CrmRateLimit(10, 60_000)
  @Post('businesses/:businessId/ai/simulate')
  async simulate(
    @Param('businessId') businessId: string,
    @Body() body: { scenario: string; variables?: Record<string, any> },
  ) {
    return this.advisor.simulateScenario(businessId, body.scenario, body.variables);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @CrmRateLimit(5, 60_000)
  @Post('businesses/:businessId/ai/business-model')
  async generateBusinessModel(
    @Param('businessId') businessId: string,
    @Body() body: {
      businessIdea: string;
      targetMarket?: string;
      valueProposition?: string;
      revenueModel?: string;
      goals?: string;
      stage?: string;
      challenges?: string;
      budget?: string;
      timeline?: string;
      teamSize?: string;
      location?: string;
      legalStructure?: string;
      industry?: string;
      problemSolved?: string;
      assets?: string;
      competitiveContext?: string;
      interactionMode?: string;
    },
  ) {
    const result = await this.advisor.generateBusinessModel(businessId, body);
    if (result.success && result.model) {
      const existing = await this.prisma.client.businessPlan.findFirst({
        where: { businessId },
        orderBy: { version: 'desc' },
      });
      await this.prisma.client.businessPlan.create({
        data: {
          businessId,
          version: existing ? existing.version + 1 : 1,
          name: `Business Plan v${existing ? existing.version + 1 : 1}`,
          status: 'ACTIVE',
          intake: body as any,
          model: result.model as any,
        },
      });
      if (existing) {
        await this.prisma.client.businessPlan.update({
          where: { id: existing.id },
          data: { status: 'SUPERSEDED' },
        });
      }
    }
    return result;
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/ai/business-plan')
  async getBusinessPlan(@Param('businessId') businessId: string) {
    const plan = await this.prisma.client.businessPlan.findFirst({
      where: { businessId, status: 'ACTIVE' },
      orderBy: { version: 'desc' },
    });
    return { plan };
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/ai/business-plan/history')
  async getBusinessPlanHistory(@Param('businessId') businessId: string) {
    const plans = await this.prisma.client.businessPlan.findMany({
      where: { businessId },
      orderBy: { version: 'desc' },
      select: { id: true, version: true, name: true, status: true, createdAt: true },
    });
    return { plans };
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Put('businesses/:businessId/ai/business-plan/:planId')
  async updateBusinessPlan(
    @Param('businessId') businessId: string,
    @Param('planId') planId: string,
    @Body() body: { model?: Record<string, unknown>; name?: string },
  ) {
    const plan = await this.prisma.client.businessPlan.findFirst({
      where: { id: planId, businessId },
    });
    if (!plan) return { error: 'Plan not found' };
    const updated = await this.prisma.client.businessPlan.update({
      where: { id: planId },
      data: {
        ...(body.model ? { model: body.model as any } : {}),
        ...(body.name ? { name: body.name } : {}),
      },
    });
    return { plan: updated };
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @CrmRateLimit(10, 60_000)
  @Post('businesses/:businessId/ai/seo-score')
  async seoScore(
    @Param('businessId') businessId: string,
    @Body() body: { title?: string; description?: string; content?: string; url?: string },
  ) {
    return this.advisor.scoreSEO(body);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/ai/usage')
  async getUsageSummary(@Param('businessId') businessId: string) {
    return this.aiUsage.getUsageSummary(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/ai/usage/history')
  async getUsageHistory(
    @Param('businessId') businessId: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.aiUsage.getUsageHistory(
      businessId,
      limit ? parseInt(limit, 10) : 50,
      offset ? parseInt(offset, 10) : 0,
    );
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/ai/credits')
  async getCredits(@Param('businessId') businessId: string) {
    return this.aiUsage.checkCredits(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/ai/billing')
  async getBilling(@Param('businessId') businessId: string) {
    return this.aiUsage.getBillingSummary(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/ai/graph')
  async getBusinessGraph(@Param('businessId') businessId: string) {
    return this.businessGraph.getSnapshot(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @CrmRateLimit(20, 60_000)
  @Post('businesses/:businessId/ai/intent')
  async parseIntent(
    @Param('businessId') businessId: string,
    @Body() body: { input: string },
  ) {
    return this.intentParser.parse(businessId, body.input);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @CrmRateLimit(10, 60_000)
  @Post('businesses/:businessId/ai/plan')
  async createPlan(
    @Param('businessId') businessId: string,
    @Body() body: { input: string },
    @Req() req: AuthenticatedRequest,
  ) {
    const userId = req?.user?.id;
    const intent = await this.intentParser.parse(businessId, body.input);
    if (intent.clarificationNeeded) {
      return { intent, plan: null, clarificationNeeded: true };
    }
    const plan = await this.planner.createPlan(businessId, intent, userId);
    return { intent, plan, clarificationNeeded: false };
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/ai/plans')
  async listPlans(
    @Param('businessId') businessId: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    return this.planner.listPlans(businessId, status, safeInt(limit, 20));
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/ai/plans/:planId')
  async getPlan(
    @Param('businessId') businessId: string,
    @Param('planId') planId: string,
  ) {
    return this.planner.getPlan(planId, businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/ai/plans/:planId/approve')
  async approvePlan(
    @Param('businessId') businessId: string,
    @Param('planId') planId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const userId = req?.user?.id;
    if (!userId) throw new UnauthorizedException('Authenticated user required to approve plans');
    const result = await this.planner.approvePlan(planId, businessId, userId);
    // Trigger immediate execution — no 30s polling delay
    this.events.emit('plan.approved', { planId, businessId });
    return result;
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/ai/plans/:planId/steps/:stepId/undo')
  async undoPlanStep(
    @Param('businessId') businessId: string,
    @Param('planId') planId: string,
    @Param('stepId') stepId: string,
    @Body() body: { undoId?: string },
    @Req() req: AuthenticatedRequest,
  ) {
    const step = await this.prisma.client.aiPlanStep.findFirst({
      where: { id: stepId, planId, plan: { businessId } },
    });
    if (!step) throw new BadRequestException('Step not found');
    if (step.status !== 'completed') throw new BadRequestException('Only completed steps can be undone');

    if (!body.undoId) {
      // Try to find the most recent undoable action for this step
      const recent = await this.undoService.getRecentActions(businessId);
      const match = recent.find((a) => a.createdAt > new Date(Date.now() - 60 * 1000)); // within last minute
      if (!match) throw new BadRequestException('Undo window expired or no undoable action found');
      const result = await this.undoService.undo(match.id, req.user?.id);
      if (result.success) {
        await this.prisma.client.aiPlanStep.update({
          where: { id: stepId },
          data: { status: 'failed', errorMessage: 'Undone by user' },
        });
      }
      return result;
    }

    const result = await this.undoService.undo(body.undoId, req.user?.id);
    if (result.success) {
      await this.prisma.client.aiPlanStep.update({
        where: { id: stepId },
        data: { status: 'failed', errorMessage: 'Undone by user' },
      });
    }
    return result;
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/ai/workflows')
  async listWorkflows() {
    return this.workflows.getTemplates();
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/ai/workflows/:templateKey/instantiate')
  async instantiateWorkflow(
    @Param('businessId') businessId: string,
    @Param('templateKey') templateKey: string,
    @Req() req: AuthenticatedRequest,
    @Body() body: { contactId?: string; projectId?: string; amount?: number },
  ) {
    const result = await this.workflows.instantiateWorkflow(businessId, templateKey, req.user?.id, body);
    return result;
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/ai/suggestions')
  async getSuggestions(@Param('businessId') businessId: string) {
    return this.suggestions.getPendingSuggestions(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/ai/suggestions/refresh')
  async refreshSuggestions(@Param('businessId') businessId: string) {
    const suggestions = await this.suggestions.generateSuggestions(businessId);
    return { suggestions, count: suggestions.length };
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/ai/suggestions/:suggestionId/dismiss')
  async dismissSuggestion(
    @Param('businessId') businessId: string,
    @Param('suggestionId') suggestionId: string,
  ) {
    await this.suggestions.dismissSuggestion(businessId, suggestionId);
    return { dismissed: true };
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/ai/suggestions/:category/block')
  async blockSuggestionCategory(
    @Param('businessId') businessId: string,
    @Param('category') category: string,
  ) {
    await this.suggestions.blockCategory(businessId, category);
    return { blocked: true };
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/ai/execution-logs')
  async getExecutionLogs(
    @Param('businessId') businessId: string,
    @Query('module') module?: string,
    @Query('toolName') toolName?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.executionLog.getHistory(
      businessId,
      { module, toolName },
      safeInt(limit, 50),
      safeInt(offset, 0),
    );
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/ai/execution-stats')
  async getExecutionStats(
    @Param('businessId') businessId: string,
    @Query('days') days?: string,
  ) {
    return this.executionLog.getStats(businessId, safeInt(days, 30));
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/ai/approvals')
  async getPendingApprovals(@Param('businessId') businessId: string) {
    return this.governance.getPendingApprovals(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/ai/approvals/history')
  async getApprovalHistory(
    @Param('businessId') businessId: string,
    @Query('limit') limit?: string,
  ) {
    return this.governance.getApprovalHistory(businessId, safeInt(limit, 50));
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/ai/approvals/:approvalId/resolve')
  async resolveApproval(
    @Param('businessId') businessId: string,
    @Param('approvalId') approvalId: string,
    @Body() body: { resolution: 'approved' | 'rejected' | 'deferred' },
    @Req() req: AuthenticatedRequest,
  ) {
    const userId = req?.user?.id;
    if (!userId) throw new UnauthorizedException('Authenticated user required to resolve approvals');
    return this.governance.resolveApproval(approvalId, businessId, body.resolution, userId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/ai/approvals/batch-resolve')
  async resolveApprovalsBatch(
    @Param('businessId') businessId: string,
    @Body() body: { approvalIds: string[]; resolution: 'approved' | 'rejected' },
    @Req() req: AuthenticatedRequest,
  ) {
    const userId = req?.user?.id;
    if (!userId) throw new UnauthorizedException('Authenticated user required to resolve approvals');
    return this.governance.resolveApprovalsBatch(businessId, body.approvalIds, body.resolution, userId);
  }



  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/ai/health')
  async getAgentHealth(@Param('businessId') businessId: string) {
    return this.agentHealth.getHealthDashboard(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/ai/governance')
  async getGovernanceSettings(@Param('businessId') businessId: string) {
    return this.governance.getAutonomySettings(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Put('businesses/:businessId/ai/governance')
  async updateGovernanceSettings(
    @Param('businessId') businessId: string,
    @Body() body: { mode?: 'advisory' | 'assisted' | 'pro_auto' | 'restricted'; maxAutoTier?: RiskTier; blockedTools?: string[]; blockedModules?: string[] },
    @Req() req: AuthenticatedRequest,
  ) {
    const userId = req?.user?.id;
    if (!userId) throw new UnauthorizedException('Authenticated user required to update governance settings');
    return this.governance.updateAutonomySettings(businessId, body, userId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/ai/memory')
  async getMemory(
    @Param('businessId') businessId: string,
    @Query('category') category?: string,
  ) {
    if (category) {
      const entries = await this.memory.getByCategory(businessId, category as MemoryCategory);
      return { memories: entries };
    }
    const entries = await this.memory.getAll(businessId);
    return { memories: entries };
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Put('businesses/:businessId/ai/memory')
  async upsertMemory(
    @Param('businessId') businessId: string,
    @Body() body: { category: MemoryCategory; key: string; value: string; confidence?: number },
  ) {
    assertMemoryCategoryAllowed(body.category);
    const entry = await this.memory.upsert(businessId, {
      category: body.category,
      key: body.key,
      value: body.value,
      confidence: body.confidence,
      source: 'user',
    });
    return { memory: entry };
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Put('businesses/:businessId/ai/memory/bulk')
  async upsertMemoryBulk(
    @Param('businessId') businessId: string,
    @Body() body: { entries: Array<{ category: MemoryCategory; key: string; value: string; confidence?: number }> },
  ) {
    for (const e of body.entries) {
      assertMemoryCategoryAllowed(e.category);
    }
    const results = await this.memory.upsertMany(
      businessId,
      body.entries.map(e => ({ ...e, source: 'user' as const })),
    );
    return { memories: results };
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Delete('businesses/:businessId/ai/memory/:category/:key')
  async deleteMemory(
    @Param('businessId') businessId: string,
    @Param('category') category: string,
    @Param('key') key: string,
  ) {
    assertMemoryCategoryAllowed(category);
    const deleted = await this.memory.remove(businessId, category as MemoryCategory, key);
    return { deleted };
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/ai/memory/context')
  async getMemoryContext(@Param('businessId') businessId: string) {
    const ctx = await this.memory.buildContextBlock(businessId);
    return ctx;
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @CrmRateLimit(5, 60_000)
  @Post('businesses/:businessId/ai/memory/summarize-patterns')
  async summarizePatterns(@Param('businessId') businessId: string) {
    const patterns = await this.memory.summarizePatterns(businessId);
    return { patterns };
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @CrmRateLimit(10, 60_000)
  @Get('businesses/:businessId/ai/strategic/dashboard')
  async strategicDashboard(@Param('businessId') businessId: string) {
    return this.strategic.getStrategicDashboard(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/ai/strategic/revenue-forecast')
  async revenueForecast(
    @Param('businessId') businessId: string,
    @Query('days') days?: string,
  ) {
    const horizon = safeInt(days, 90);
    const clamped = Math.min(Math.max(horizon, 7), 365);
    return this.strategic.forecastRevenue(businessId, { horizonDays: clamped });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/ai/strategic/profitability')
  async profitability(@Param('businessId') businessId: string) {
    return this.strategic.analyzeProfitability(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/ai/strategic/pricing-advisor')
  async pricingAdvisor(@Param('businessId') businessId: string) {
    return this.strategic.advisePricing(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/ai/strategic/seasonal-patterns')
  async seasonalPatterns(@Param('businessId') businessId: string) {
    return this.strategic.detectSeasonalPatterns(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/ai/strategic/opportunities')
  async opportunities(@Param('businessId') businessId: string) {
    return this.strategic.scanOpportunities(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/ai/strategic/risks')
  async risks(@Param('businessId') businessId: string) {
    return this.strategic.scanRisks(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @CrmRateLimit(5, 60_000)
  @Get('businesses/:businessId/ai/strategic/weekly-plan')
  async weeklyPlan(@Param('businessId') businessId: string) {
    return this.strategic.generateWeeklyPlan(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/ai/strategic/actions')
  async strategicActions(@Param('businessId') businessId: string) {
    const actions = await this.strategic.getStrategicActions(businessId);
    return { actions };
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/ai/monitoring/insights')
  async monitoringInsights(@Param('businessId') businessId: string) {
    const insights = await this.proAutoMonitor.scanInsights(businessId);
    return { insights };
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/ai/control-tower')
  async controlTower(@Param('businessId') businessId: string) {
    const [snapshot, dashboard, insightsRes, approvals, totalPendingApprovals] = await Promise.all([
      this.businessGraph.getSnapshot(businessId),
      this.strategic.getStrategicDashboard(businessId),
      this.proAutoMonitor.scanInsights(businessId),
      this.prisma.client.aiApprovalItem.findMany({
        where: { businessId, status: 'pending' },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      this.prisma.client.aiApprovalItem.count({
        where: { businessId, status: 'pending' },
      }),
    ]);
    const insights = insightsRes ?? [];
    const healthIndicators = snapshot.healthIndicators ?? [];

    type PriorityItem = {
      id: string;
      type: 'risk' | 'approval' | 'action' | 'opportunity';
      severity: 'critical' | 'warning' | 'info' | 'opportunity';
      title: string;
      description: string;
      module: string;
      urgency: number;
      actionLabel?: string;
      actionRoute?: string;
    };

    const priorities: PriorityItem[] = [];
    let priorityIdx = 0;

    for (const h of healthIndicators) {
      if (h.status === 'good') continue;
      priorities.push({
        id: `health-${priorityIdx++}`,
        type: 'risk',
        severity: h.status === 'critical' ? 'critical' : 'warning',
        title: h.detail,
        description: `${h.area} health alert`,
        module: h.area,
        urgency: h.status === 'critical' ? 100 : 70,
      });
    }

    if (dashboard.overdueInvoices > 0) {
      priorities.push({
        id: `overdue-inv-${priorityIdx++}`,
        type: 'action',
        severity: 'critical',
        title: `Collect ${dashboard.overdueInvoices} overdue invoices`,
        description: `$${dashboard.overdueAmount.toFixed(0)} TTD at risk`,
        module: 'revenue',
        urgency: 95,
        actionLabel: 'Review Invoices',
        actionRoute: '/app/commerce?tab=operations',
      });
    }

    if (dashboard.pendingQuotes > 0) {
      priorities.push({
        id: `pending-quotes-${priorityIdx++}`,
        type: 'opportunity',
        severity: 'opportunity',
        title: `${dashboard.pendingQuotes} pending quotes worth $${dashboard.pendingQuoteValue.toFixed(0)}`,
        description: 'Follow up to convert to revenue',
        module: 'revenue',
        urgency: 60,
        actionLabel: 'View Quotes',
        actionRoute: '/app/commerce?tab=operations',
      });
    }

    if (dashboard.staleLeads > 0) {
      priorities.push({
        id: `stale-leads-${priorityIdx}`,
        type: 'opportunity',
        severity: 'warning',
        title: `${dashboard.staleLeads} stale leads need attention`,
        description: 'Leads inactive for 30+ days',
        module: 'crm',
        urgency: 50,
        actionLabel: 'View Leads',
        actionRoute: '/app/crm/pipeline',
      });
    }

    for (const insight of insights.slice(0, 10)) {
      priorities.push({
        id: `insight-${insight.id}`,
        type: insight.severity === 'opportunity' ? 'opportunity' : 'risk',
        severity: insight.severity,
        title: insight.title,
        description: insight.description,
        module: insight.module,
        urgency: insight.severity === 'critical' ? 90 : insight.severity === 'warning' ? 65 : 40,
      });
    }

    for (const a of approvals) {
      priorities.push({
        id: `approval-${a.id}`,
        type: 'approval',
        severity: a.riskTier >= 3 ? 'warning' : 'info',
        title: a.title,
        description: a.description ?? 'AI action awaiting your decision',
        module: 'ai',
        urgency: 80,
      });
    }

    priorities.sort((a, b) => b.urgency - a.urgency);

    type RiskAlert = {
      id: string;
      domain: 'cash_flow' | 'churn' | 'overdue' | 'capacity' | 'storefront' | 'delivery';
      severity: 'critical' | 'warning' | 'info';
      title: string;
      description: string;
      module: string;
      actionLabel?: string;
      actionRoute?: string;
    };

    const risks: RiskAlert[] = [];
    let riskIdx = 0;

    if (dashboard.overdueInvoices > 0) {
      risks.push({
        id: `risk-cashflow-${riskIdx++}`,
        domain: 'cash_flow',
        severity: dashboard.overdueAmount > 5000 ? 'critical' : 'warning',
        title: `$${dashboard.overdueAmount.toFixed(0)} TTD in overdue invoices`,
        description: `${dashboard.overdueInvoices} invoice${dashboard.overdueInvoices > 1 ? 's' : ''} past due — follow up immediately to protect cash flow`,
        module: 'revenue',
        actionLabel: 'Review Invoices',
        actionRoute: '/app/commerce?tab=operations',
      });
    }

    if (dashboard.staleLeads > 3) {
      risks.push({
        id: `risk-churn-${riskIdx++}`,
        domain: 'churn',
        severity: dashboard.staleLeads > 10 ? 'critical' : 'warning',
        title: `${dashboard.staleLeads} leads going cold`,
        description: 'Leads inactive 30+ days — high churn risk without re-engagement',
        module: 'crm',
        actionLabel: 'View Leads',
        actionRoute: '/app/crm/pipeline',
      });
    }

    const overdueTaskCount = snapshot.projects?.overdueTaskCount ?? 0;
    if (overdueTaskCount > 0) {
      risks.push({
        id: `risk-delivery-${riskIdx++}`,
        domain: 'delivery',
        severity: overdueTaskCount > 5 ? 'critical' : 'warning',
        title: `${overdueTaskCount} overdue project tasks`,
        description: 'Delivery delays can cascade into client dissatisfaction and revenue loss',
        module: 'projects',
        actionLabel: 'View Projects',
        actionRoute: '/app/projects',
      });
    }

    const utilRate = snapshot.bookings?.utilizationRate ?? 100;
    if (utilRate < 40) {
      risks.push({
        id: `risk-capacity-${riskIdx++}`,
        domain: 'capacity',
        severity: utilRate < 20 ? 'critical' : 'warning',
        title: `Only ${utilRate.toFixed(0)}% booking utilization`,
        description: 'Low utilization means lost revenue potential — consider promotions or outreach',
        module: 'bookings',
        actionLabel: 'View Calendar',
        actionRoute: '/app/bookings',
      });
    }

    const activeProducts = snapshot.storefront?.activeProductCount ?? 0;
    if (activeProducts === 0) {
      risks.push({
        id: `risk-storefront-${riskIdx++}`,
        domain: 'storefront',
        severity: 'warning',
        title: 'Storefront has no active products',
        description: 'Your public store is empty — visitors will leave without converting',
        module: 'storefront',
        actionLabel: 'Manage Products',
        actionRoute: '/app/commerce?tab=catalog',
      });
    }

    for (const h of healthIndicators) {
      if (h.status === 'critical') {
        risks.push({
          id: `risk-health-${riskIdx++}`,
          domain: 'overdue',
          severity: 'critical',
          title: h.detail,
          description: `Critical health alert in ${h.area}`,
          module: h.area,
        });
      }
    }

    for (const insight of insights.slice(0, 5)) {
      if (insight.severity === 'critical' || insight.severity === 'warning') {
        risks.push({
          id: `risk-insight-${insight.id}`,
          domain: 'overdue',
          severity: insight.severity as 'critical' | 'warning',
          title: insight.title,
          description: insight.description,
          module: insight.module,
        });
      }
    }

    return {
      snapshot: {
        business: snapshot.business,
        momentumScore: snapshot.momentumScore,
        healthIndicators: snapshot.healthIndicators,
      },
      dashboard,
      priorities: priorities.slice(0, 25),
      risks,
      pendingApprovals: totalPendingApprovals,
      modules: {
        contacts: snapshot.contacts,
        revenue: snapshot.revenue,
        bookings: snapshot.bookings,
        expenses: snapshot.expenses,
        projects: snapshot.projects,
        content: snapshot.content,
        automations: snapshot.automations,
        storefront: snapshot.storefront,
      },
    };
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/ai/workspace-recommendations')
  async workspaceRecommendations(
    @Param('businessId') businessId: string,
    @Query('module') module: string,
  ) {
    const validModules: readonly string[] = ['crm', 'revenue', 'bookings', 'marketing', 'projects', 'expenses', 'automations'];
    if (!module || !validModules.includes(module)) {
      throw new BadRequestException(`Invalid module. Must be one of: ${validModules.join(', ')}`);
    }
    return this.workspaceRecs.getRecommendations(
      businessId,
      module as 'crm' | 'revenue' | 'bookings' | 'marketing' | 'projects' | 'expenses' | 'automations',
    );
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/ai/automation-coverage')
  async automationCoverage(@Param('businessId') businessId: string) {
    return this.workspaceRecs.getAutomationCoverage(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/ai/cross-module-links')
  async crossModuleLinks(
    @Param('businessId') businessId: string,
    @Query('entityType') entityType: string,
    @Query('entityId') entityId: string,
  ) {
    if (!entityType || !entityId) {
      throw new BadRequestException('entityType and entityId are required');
    }
    return this.workspaceRecs.getCrossModuleLinks(businessId, entityType, entityId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @CrmRateLimit(20, 60_000)
  @Post('businesses/:businessId/ai/profile/chat')
  async profileChat(
    @Param('businessId') businessId: string,
    @Body() body: { message: string },
  ) {
    if (!body.message?.trim()) throw new BadRequestException('Message is required');
    return this.profileIntelligence.chat(businessId, body.message.trim());
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/ai/profile/status')
  async profileStatus(@Param('businessId') businessId: string) {
    return this.profileIntelligence.getCompletionSummary(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/ai/profile/confirm')
  async profileConfirm(
    @Param('businessId') businessId: string,
    @Body() body: { confirmedKeys?: string[] },
  ) {
    return this.profileIntelligence.confirmExtractions(businessId, body.confirmedKeys);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/ai/profile/reset')
  async profileReset(@Param('businessId') businessId: string) {
    this.profileIntelligence.resetSession(businessId);
    return { success: true };
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/ai/preferences')
  async getAiPreferences(@Param('businessId') businessId: string) {
    const prefs = await this.gateway.getPreferences(businessId);
    return {
      mode: prefs.aiMode,
      writingStyle: prefs.preferredWritingStyle || 'professional',
      byokOpenai: prefs.byokOpenai ? '••••••••' : null,
      byokAnthropic: prefs.byokAnthropic ? '••••••••' : null,
      byokXai: prefs.byokXai ? '••••••••' : null,
      budgetCaps: prefs.budgetCaps || null,
    };
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Put('businesses/:businessId/ai/preferences')
  async updateAiPreferences(
    @Param('businessId') businessId: string,
    @Body() body: {
      mode?: AiMode;
      writingStyle?: string;
      byokOpenai?: string | null;
      byokAnthropic?: string | null;
      byokXai?: string | null;
      budgetCaps?: BudgetCaps | null;
    },
  ) {
    const validModes: AiMode[] = ['balanced', 'premium', 'fast'];
    if (body.mode !== undefined && !validModes.includes(body.mode)) {
      throw new BadRequestException(`Invalid AI mode. Must be one of: ${validModes.join(', ')}`);
    }

    if (body.budgetCaps !== undefined && body.budgetCaps !== null) {
      const caps = body.budgetCaps;
      for (const [key, val] of Object.entries(caps)) {
        if (val !== undefined && val !== null && (typeof val !== 'number' || val < 0)) {
          throw new BadRequestException(`Budget cap "${key}" must be a non-negative number`);
        }
      }
    }

    const updates: Record<string, unknown> = {};
    if (body.mode !== undefined) updates.aiMode = body.mode;
    if (body.writingStyle !== undefined) updates.preferredWritingStyle = body.writingStyle;
    if (body.byokOpenai !== undefined) updates.byokOpenai = body.byokOpenai === null ? '' : body.byokOpenai;
    if (body.byokAnthropic !== undefined) updates.byokAnthropic = body.byokAnthropic === null ? '' : body.byokAnthropic;
    if (body.byokXai !== undefined) updates.byokXai = body.byokXai === null ? '' : body.byokXai;
    if (body.budgetCaps !== undefined) updates.budgetCaps = body.budgetCaps === null ? undefined : body.budgetCaps;

    const merged = await this.gateway.updatePreferences(businessId, updates);
    return {
      success: true,
      mode: merged.aiMode,
      writingStyle: merged.preferredWritingStyle || 'professional',
      budgetCaps: merged.budgetCaps || null,
    };
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/ai/budget-status')
  async getBudgetStatus(@Param('businessId') businessId: string) {
    return this.gateway.getBudgetStatus(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/ai/provider-health')
  async getProviderHealth(@Param('businessId') _businessId: string) {
    return this.gateway.getProviderHealth();
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/ai/provider-stats')
  async getProviderStats(@Param('businessId') businessId: string) {
    return this.aiUsage.getProviderStats(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/ai/routing-config')
  async getRoutingConfig(@Param('businessId') _businessId: string) {
    return this.gateway.getRoutingConfig();
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Put('businesses/:businessId/ai/routing-config')
  async updateRoutingConfig(
    @Param('businessId') _businessId: string,
    @Req() req: AuthenticatedRequest,
    @Body() body: Record<string, unknown>,
  ) {
    if (req.user?.role !== 'SUPER_ADMIN') {
      throw new BadRequestException('Only super admins can update routing configuration');
    }
    return this.gateway.updateRoutingConfig(body as Record<string, Record<string, { primary: { provider: string; model: string }; fallbacks: Array<{ provider: string; model: string }> }>>);
  }

  // ── KEY Command Orchestrator (Phase 6 MD) ───────────────────────────────

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/key/command')
  @CrmRateLimit(30, 60_000)
  async executeKeyCommand(
    @Param('businessId') businessId: string,
    @Req() req: AuthenticatedRequest,
    @Body() body: { rawInput: string; inputMode?: 'TEXT' | 'VOICE'; mode?: 'ask' | 'do' | 'plan' | 'auto' },
  ) {
    const mode = body.mode ?? 'do';
    const cmd = await this.keyCommand.receiveCommand(businessId, req.user?.id, body.rawInput, body.inputMode ?? 'TEXT', mode as any);

    // DO and AUTO modes generate actionable "Do It For Me" suggestions
    if (mode === 'do' || mode === 'auto') {
      const result = await this.keyCommand.generateDoItForMe(businessId, body.rawInput);
      await (this.prisma as any).client.keyCommand.update({
        where: { id: cmd.id },
        data: { status: 'EXECUTED', executionResult: result as any },
      });
      return result;
    }

    // ASK and PLAN modes use the traditional planning pipeline
    const intent = await this.keyCommand.interpretIntent(cmd.id);
    await this.keyCommand.groundIntent(cmd.id, businessId);
    const plan = await this.keyCommand.planActions(cmd.id, intent);
    const riskLevel = this.keyCommand.classifyRisk(plan);

    // PLAN mode returns the plan without executing
    if (mode === 'plan') {
      await (this.prisma as any).client.keyCommand.update({
        where: { id: cmd.id },
        data: { status: 'PLANNED' },
      });
      return { commandId: cmd.id, intent, plan, riskLevel, mode };
    }

    // ASK mode executes low-risk plans, queues high-risk for approval
    const results = await this.keyCommand.executeApprovedPlan(cmd.id, plan, businessId);
    return { commandId: cmd.id, intent, plan, riskLevel, results, mode };
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/key/commands')
  @CrmRateLimit(60, 60_000)
  async listKeyCommands(@Param('businessId') businessId: string) {
    return (this.prisma as any).client.keyCommand.findMany({
      where: { businessId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  // ── Briefings (Phase 7 MD) ──────────────────────────────────────────────

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/briefing/morning')
  @CrmRateLimit(30, 60_000)
  async morningBriefing(@Param('businessId') businessId: string) {
    const [schedule, revenue, openInvoices, leads] = await Promise.all([
      (this.prisma as any).client.activity.findMany({
        where: { businessId, occurredAt: { gte: new Date(Date.now() - 86400000) }, status: 'SCHEDULED' },
        orderBy: { occurredAt: 'asc' },
        take: 10,
      }),
      (this.prisma as any).client.invoice.aggregate({
        where: { businessId, deletedAt: null, status: 'PAID', paidAt: { gte: new Date(Date.now() - 86400000) } },
        _sum: { total: true },
      }),
      (this.prisma as any).client.invoice.count({
        where: { businessId, deletedAt: null, status: { in: ['SENT', 'OVERDUE'] } },
      }),
      (this.prisma as any).client.contact.count({
        where: { businessId, deletedAt: null, leadScore: { gte: 60 } },
      }),
    ]);

    return {
      today: new Date().toISOString(),
      schedule,
      revenueToday: Number(revenue._sum.total ?? 0),
      openInvoices,
      activeLeads: leads,
    };
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/briefing/eod')
  @CrmRateLimit(30, 60_000)
  async endOfDayBriefing(@Param('businessId') businessId: string) {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const [events, revenue, bookings, contactsUpdated] = await Promise.all([
      (this.prisma as any).client.activity.count({ where: { businessId, occurredAt: { gte: start } } }),
      (this.prisma as any).client.invoice.aggregate({
        where: { businessId, deletedAt: null, status: 'PAID', paidAt: { gte: start } },
        _sum: { total: true },
      }),
      (this.prisma as any).client.booking.count({ where: { businessId, deletedAt: null, createdAt: { gte: start } } }),
      (this.prisma as any).client.contact.count({ where: { businessId, deletedAt: null, updatedAt: { gte: start } } }),
    ]);

    return {
      date: start.toISOString(),
      events,
      revenueCollected: Number(revenue._sum.total ?? 0),
      bookingsCompleted: bookings,
      contactsUpdated,
    };
  }

  // ── Autopilot Rules (Phase 7 MD) ────────────────────────────────────────

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/autopilot-rules')
  @CrmRateLimit(60, 60_000)
  async getAutopilotRules(@Param('businessId') businessId: string) {
    return this.autopilot.getRules(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Put('businesses/:businessId/autopilot-rules/:ruleId')
  @CrmRateLimit(30, 60_000)
  async updateAutopilotRule(
    @Param('businessId') businessId: string,
    @Param('ruleId') ruleId: string,
    @Body() body: { enabled: boolean },
  ) {
    return this.autopilot.updateRule(businessId, ruleId, body.enabled);
  }

  // ── Journey Orchestrator (Phase 7) ──────────────────────────────────────

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/journeys')
  @CrmRateLimit(30, 60_000)
  async listJourneys(@Param('businessId') businessId: string) {
    const instances = await this.journeyOrchestrator.getJourneyInstances(businessId);
    return { instances };
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/journeys/:instanceId')
  @CrmRateLimit(30, 60_000)
  async getJourneyInstance(
    @Param('businessId') businessId: string,
    @Param('instanceId') instanceId: string,
  ) {
    return this.journeyOrchestrator.getJourneyInstance(instanceId, businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/journeys/:key/trigger')
  @CrmRateLimit(10, 60_000)
  async triggerJourney(
    @Param('businessId') businessId: string,
    @Param('key') key: string,
    @Body() body: { payload?: Record<string, any> },
  ) {
    const { getJourneyTemplate } = await import('./journey-templates');
    const template = getJourneyTemplate(key);
    if (!template) throw new BadRequestException(`Unknown journey template: ${key}`);
    return this.journeyOrchestrator.executeJourney(businessId, template, body.payload ?? {});
  }

  // ── Morning Briefing (Phase 7) ──────────────────────────────────────────

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/briefing')
  @CrmRateLimit(10, 60_000)
  async getBriefing(@Param('businessId') businessId: string) {
    return this.morningBriefingSvc.generateBriefing(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/briefing/:planId/execute-all')
  @CrmRateLimit(10, 60_000)
  async executeAllBriefingCards(
    @Param('businessId') businessId: string,
    @Param('planId') planId: string,
  ) {
    return this.morningBriefingSvc.executeAllBriefingCards(businessId, planId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/briefing/:planId/skip')
  @CrmRateLimit(10, 60_000)
  async skipBriefing(
    @Param('businessId') businessId: string,
    @Param('planId') planId: string,
  ) {
    return this.morningBriefingSvc.skipBriefing(businessId, planId);
  }

  // ── Unified Inbox (Phase 7) ─────────────────────────────────────────────

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/inbox')
  @CrmRateLimit(60, 60_000)
  async getInbox(
    @Param('businessId') businessId: string,
    @Query('channel') channel?: string,
    @Query('status') status?: string,
    @Query('role') role?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.inbox.getInbox(businessId, {
      channel,
      status,
      assignedRole: role,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/inbox/:threadId')
  @CrmRateLimit(60, 60_000)
  async getThread(
    @Param('businessId') businessId: string,
    @Param('threadId') threadId: string,
  ) {
    return this.inbox.getThread(threadId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/inbox/:threadId/reply')
  @CrmRateLimit(30, 60_000)
  async replyToThread(
    @Param('businessId') businessId: string,
    @Param('threadId') threadId: string,
    @Body() body: { body: string; role?: string },
  ) {
    return this.inbox.recordOutboundMessage(threadId, body.body, { role: body.role });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/inbox/:threadId/resolve')
  @CrmRateLimit(30, 60_000)
  async resolveThread(
    @Param('businessId') businessId: string,
    @Param('threadId') threadId: string,
  ) {
    return this.inbox.resolveThread(threadId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/inbox/:threadId/assign-role')
  @CrmRateLimit(30, 60_000)
  async assignThreadRole(
    @Param('businessId') businessId: string,
    @Param('threadId') threadId: string,
    @Body() body: { role: string },
  ) {
    return this.inbox.assignRole(threadId, body.role);
  }

  // ── Goal Tracker (Phase 7) ──────────────────────────────────────────────

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/goals')
  @CrmRateLimit(60, 60_000)
  async listGoals(
    @Param('businessId') businessId: string,
    @Query('status') status?: string,
    @Query('category') category?: string,
    @Query('role') role?: string,
  ) {
    return this.goalTracker.getGoals(businessId, { status, category, role });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/goals')
  @CrmRateLimit(30, 60_000)
  async createGoal(
    @Param('businessId') businessId: string,
    @Body() body: {
      title: string;
      description?: string;
      category: string;
      targetValue?: number;
      unit?: string;
      deadline?: string;
      role?: string;
      autoActions?: boolean;
    },
  ) {
    return this.goalTracker.createGoal(businessId, {
      ...body,
      deadline: body.deadline ? new Date(body.deadline) : undefined,
      role: body.role as any,
    });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/goals/:goalId')
  @CrmRateLimit(60, 60_000)
  async getGoal(
    @Param('businessId') businessId: string,
    @Param('goalId') goalId: string,
  ) {
    return this.goalTracker.getGoal(businessId, goalId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Put('businesses/:businessId/goals/:goalId')
  @CrmRateLimit(30, 60_000)
  async updateGoal(
    @Param('businessId') businessId: string,
    @Param('goalId') goalId: string,
    @Body() body: Partial<{
      title: string;
      description: string;
      targetValue: number;
      unit: string;
      deadline: string;
      status: string;
      priority: number;
      role: string;
      autoActions: boolean;
    }>,
  ) {
    return this.goalTracker.updateGoal(businessId, goalId, {
      ...body,
      deadline: body.deadline ? new Date(body.deadline) : undefined,
    });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Delete('businesses/:businessId/goals/:goalId')
  @CrmRateLimit(30, 60_000)
  async deleteGoal(
    @Param('businessId') businessId: string,
    @Param('goalId') goalId: string,
  ) {
    return this.goalTracker.deleteGoal(businessId, goalId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/goals/:goalId/progress')
  @CrmRateLimit(30, 60_000)
  async updateGoalProgress(
    @Param('businessId') businessId: string,
    @Param('goalId') goalId: string,
  ) {
    return this.goalTracker.updateProgress(businessId, goalId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/goals/:goalId/actions')
  @CrmRateLimit(30, 60_000)
  async suggestGoalActions(
    @Param('businessId') businessId: string,
    @Param('goalId') goalId: string,
  ) {
    return this.goalTracker.suggestActions(businessId, goalId);
  }

  // === L4 Manager — Operations Dashboard AI Panel ===

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/ai/workload')
  @CrmRateLimit(30, 60_000)
  async getWorkload(@Param('businessId') businessId: string) {
    return this.workload.getWorkloadForBusiness(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/ai/priorities')
  @CrmRateLimit(30, 60_000)
  async getPriorities(@Param('businessId') businessId: string) {
    return this.prioritizer.getPrioritizedQueue(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/ai/capacity-alerts')
  @CrmRateLimit(30, 60_000)
  async getCapacityAlerts(@Param('businessId') businessId: string) {
    return this.capacityInsight.scanBusiness(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/ai/rebalance')
  @CrmRateLimit(10, 60_000)
  async rebalance(@Param('businessId') businessId: string) {
    return this.rebalancer.rebalanceBusiness(businessId);
  }
}
