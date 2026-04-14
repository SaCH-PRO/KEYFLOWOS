import { Body, Controller, Delete, Get, Inject, Param, Post, Put, Query, Req, UseGuards, UnauthorizedException, BadRequestException } from '@nestjs/common';
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
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { Request } from 'express';

interface AuthenticatedRequest extends Request {
  user?: { id: string; email?: string; role?: string };
}
import { PrismaService } from '../../core/prisma/prisma.service';

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
  ) {}

  @Get('health')
  health() {
    return { status: 'ok', module: 'ai' };
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/ai/chat')
  async chat(
    @Param('businessId') businessId: string,
    @Body() body: { message: string; history?: Array<{ role: string; content: string }> },
  ) {
    return this.advisor.chat(businessId, body.message, body.history);
  }

  @UseGuards(AuthGuard, BusinessGuard)
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
  @Post('businesses/:businessId/ai/simulate')
  async simulate(
    @Param('businessId') businessId: string,
    @Body() body: { scenario: string; variables?: Record<string, any> },
  ) {
    return this.advisor.simulateScenario(businessId, body.scenario, body.variables);
  }

  @UseGuards(AuthGuard, BusinessGuard)
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
  @Post('businesses/:businessId/ai/intent')
  async parseIntent(
    @Param('businessId') businessId: string,
    @Body() body: { input: string },
  ) {
    return this.intentParser.parse(businessId, body.input);
  }

  @UseGuards(AuthGuard, BusinessGuard)
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
    return this.planner.approvePlan(planId, businessId, userId);
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
  @Post('businesses/:businessId/ai/memory/summarize-patterns')
  async summarizePatterns(@Param('businessId') businessId: string) {
    const patterns = await this.memory.summarizePatterns(businessId);
    return { patterns };
  }

  @UseGuards(AuthGuard, BusinessGuard)
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
        id: `stale-leads-${priorityIdx++}`,
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

    return {
      snapshot: {
        business: snapshot.business,
        momentumScore: snapshot.momentumScore,
        healthIndicators: snapshot.healthIndicators,
      },
      dashboard,
      priorities: priorities.slice(0, 25),
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
}
