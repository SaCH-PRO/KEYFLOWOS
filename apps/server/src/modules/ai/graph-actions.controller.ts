import { Body, Controller, Get, Inject, Param, Post, Query, Req, UseGuards, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { CrmRateLimit, CrmRateLimitGuard } from '../crm/guards/rate-limit.guard';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BusinessGraphService } from './business-graph.service';
import { IntentParserService } from './intent-parser.service';
import { PlannerService } from './planner.service';
import { AiOversightService } from './ai-oversight.service';
import { FlowOrchestratorService } from './flow-orchestrator.service';
import { AiExecutionLogService } from './ai-execution-log.service';
import { WorkspaceRecommendationsService } from './workspace-recommendations.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { Request } from 'express';
import { ActionExecutedPayload, ActionBlockedPayload } from '../../core/event-bus/events.types';

interface AuthenticatedRequest extends Request {
  user?: { id: string; email?: string; role?: string };
}

function safeInt(val: string | undefined, fallback: number): number {
  if (!val) return fallback;
  const n = parseInt(val, 10);
  return Number.isNaN(n) || n < 0 ? fallback : n;
}

@Controller()
@UseGuards(CrmRateLimitGuard)
export class GraphActionsController {
  constructor(
    @Inject(BusinessGraphService) private readonly businessGraph: BusinessGraphService,
    @Inject(IntentParserService) private readonly intentParser: IntentParserService,
    @Inject(PlannerService) private readonly planner: PlannerService,
    @Inject(AiOversightService) private readonly governance: AiOversightService,
    @Inject(FlowOrchestratorService) private readonly orchestrator: FlowOrchestratorService,
    @Inject(AiExecutionLogService) private readonly executionLog: AiExecutionLogService,
    @Inject(WorkspaceRecommendationsService) private readonly workspaceRecs: WorkspaceRecommendationsService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly eventEmitter: EventEmitter2,
  ) {}

  @UseGuards(AuthGuard, BusinessGuard)
  @CrmRateLimit(20, 60_000)
  @Get('graph/business/:businessId')
  async getGraph(
    @Param('businessId') businessId: string,
    @Query('refresh') refresh?: string,
  ) {
    const forceRefresh = refresh === 'true' || refresh === '1';
    const snapshot = await this.businessGraph.getSnapshot(businessId, forceRefresh);
    return {
      snapshot,
      generatedAt: new Date().toISOString(),
      linkCount: snapshot.links.length,
      entityCounts: {
        topContacts: snapshot.entities.topContacts.length,
        overdueInvoices: snapshot.entities.overdueInvoices.length,
        catalogProducts: snapshot.entities.catalogProducts.length,
      },
    };
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('actions/businesses/:businessId/plan')
  async planAction(
    @Param('businessId') businessId: string,
    @Body() body: { input: string },
    @Req() req: AuthenticatedRequest,
  ) {
    if (!body.input?.trim()) {
      throw new BadRequestException('Input is required');
    }
    const userId = req?.user?.id;
    const intent = await this.intentParser.parse(businessId, body.input);
    if (intent.clarificationNeeded) {
      return { intent, plan: null, clarificationNeeded: true };
    }
    const plan = await this.planner.createPlan(businessId, intent, userId);

    const snapshot = await this.businessGraph.getSnapshot(businessId);
    const affectedModules = intent.modules;
    const riskAssessment = {
      maxTier: plan.maxRiskTier,
      requiresApproval: plan.maxRiskTier >= 2,
      affectedModules,
      estimatedImpact: this.estimateImpact(plan.steps, snapshot),
    };

    return { intent, plan, clarificationNeeded: false, riskAssessment };
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('actions/businesses/:businessId/execute')
  async executeAction(
    @Param('businessId') businessId: string,
    @Body() body: { toolName: string; args: Record<string, any>; planId?: string; planStepId?: string },
    @Req() req: AuthenticatedRequest,
  ) {
    const userId = req?.user?.id;
    if (!userId) throw new UnauthorizedException('Authenticated user required');
    if (!body.toolName?.trim()) throw new BadRequestException('toolName is required');

    const decision = await this.governance.evaluate(businessId, body.toolName);

    if (!decision.allowed) {
      const blockedPayload: ActionBlockedPayload = {
        businessId,
        toolName: body.toolName,
        reason: decision.reason ?? 'Governance policy',
        riskTier: decision.tier,
      };
      this.eventEmitter.emit('action.blocked', blockedPayload);
      return {
        success: false,
        blocked: true,
        reason: decision.reason,
        tier: decision.tier,
      };
    }

    if (decision.requiresFormalApproval || decision.requiresAdminApproval) {
      const approval = await this.governance.createApprovalItem(businessId, {
        toolName: body.toolName,
        title: `Execute ${body.toolName}`,
        description: `User-initiated action execution`,
        inputPayload: body.args,
        planId: body.planId,
        planStepId: body.planStepId,
      });
      return {
        success: false,
        requiresApproval: true,
        approvalId: approval.id,
        tier: decision.tier,
        reason: decision.reason,
      };
    }

    try {
      const result = await this.orchestrator.executeToolDirect(
        businessId,
        body.toolName,
        body.args,
        body.planId,
        body.planStepId,
      );
      const executedPayload: ActionExecutedPayload = {
        businessId,
        toolName: body.toolName,
        module: this.inferModule(body.toolName),
        riskTier: decision.tier,
        success: result.success,
        changedEntities: result.changedEntities,
      };
      this.eventEmitter.emit('action.executed', executedPayload);
      return {
        success: result.success,
        result: result.result,
        changedEntities: result.changedEntities,
        followOnSuggestions: result.followOnSuggestions,
        tier: decision.tier,
      };
    } catch (err) {
      const failPayload: ActionExecutedPayload = {
        businessId,
        toolName: body.toolName,
        module: null,
        riskTier: decision.tier,
        success: false,
      };
      this.eventEmitter.emit('action.executed', failPayload);
      return {
        success: false,
        error: (err as Error).message,
        tier: decision.tier,
      };
    }
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('actions/businesses/:businessId/queue')
  async getActionQueue(
    @Param('businessId') businessId: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    const take = safeInt(limit, 30);

    const [pendingApprovals, recentLogs, activePlans] = await Promise.all([
      this.governance.getPendingApprovals(businessId, take),
      this.executionLog.getHistory(businessId, {}, take, 0),
      this.planner.listPlans(businessId, status || undefined, take),
    ]);

    const pending = pendingApprovals.map((a: any) => ({
      id: a.id,
      type: 'pending_approval' as const,
      toolName: a.toolName,
      title: a.title,
      description: a.description,
      riskTier: a.riskTier,
      module: a.module ?? this.inferModule(a.toolName),
      status: 'pending' as const,
      createdAt: a.createdAt,
      affectedEntities: a.inputPayload ? this.extractAffectedEntities(a.inputPayload) : [],
    }));

    const logs = (recentLogs.logs ?? recentLogs ?? []).map((l: any) => ({
      id: l.id,
      type: 'executed' as const,
      toolName: l.toolName,
      title: l.action ?? l.toolName,
      description: l.rationale ?? null,
      riskTier: l.riskTier ?? 1,
      module: l.module ?? this.inferModule(l.toolName),
      status: l.success ? ('completed' as const) : ('failed' as const),
      createdAt: l.createdAt,
      affectedEntities: l.outputSummary?.changedEntities ?? [],
    }));

    const planItems = (activePlans ?? [])
      .filter((p: any) => ['pending', 'in_progress', 'approved'].includes(p.status))
      .map((p: any) => ({
        id: p.id,
        type: 'scheduled' as const,
        toolName: p.steps?.[0]?.toolName ?? 'plan',
        title: p.objective,
        description: `${p.steps?.length ?? 0} step plan`,
        riskTier: p.maxRiskTier ?? 1,
        module: p.modules?.[0] ?? null,
        status: p.status === 'in_progress' ? ('active' as const) : ('scheduled' as const),
        createdAt: p.createdAt,
        affectedEntities: p.modules ?? [],
      }));

    let items = [...pending, ...planItems, ...logs];
    if (status) {
      items = items.filter(i => i.status === status);
    }
    items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return {
      items: items.slice(0, take),
      counts: {
        pending: pending.length,
        scheduled: planItems.filter((p: any) => p.status === 'scheduled').length,
        active: planItems.filter((p: any) => p.status === 'active').length,
        completed: logs.filter((l: any) => l.status === 'completed').length,
        failed: logs.filter((l: any) => l.status === 'failed').length,
      },
      plans: activePlans,
    };
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('autopilot/businesses/:businessId/coverage')
  async getAutopilotCoverage(@Param('businessId') businessId: string) {
    const [coverage, settings, snapshot] = await Promise.all([
      this.workspaceRecs.getAutomationCoverage(businessId),
      this.governance.getAutonomySettings(businessId),
      this.businessGraph.getSnapshot(businessId),
    ]);

    const recentExecCount = await this.prisma.client.aiExecutionLog.count({
      where: {
        businessId,
        createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      },
    });

    const pendingApprovalCount = await this.prisma.client.aiApprovalItem.count({
      where: { businessId, status: 'pending' },
    });

    const moduleGaps: Array<{ module: string; gap: string; severity: 'high' | 'medium' | 'low' }> = [];
    for (const mod of coverage.modules) {
      if (mod.coveragePct < 20) {
        moduleGaps.push({ module: mod.module, gap: `Only ${mod.coveragePct}% automated`, severity: 'high' });
      } else if (mod.coveragePct < 50) {
        moduleGaps.push({ module: mod.module, gap: `${mod.coveragePct}% automated`, severity: 'medium' });
      }
    }

    return {
      overallCoverage: coverage.overallPct,
      modules: coverage.modules,
      gaps: moduleGaps,
      governance: {
        mode: settings.mode,
        maxAutoTier: settings.maxAutoTier,
        blockedToolCount: settings.blockedTools.length,
        blockedModuleCount: settings.blockedModules.length,
      },
      activity: {
        executionsLast7Days: recentExecCount,
        pendingApprovals: pendingApprovalCount,
        activeFlows: snapshot.automations.activeCount,
        disabledFlows: snapshot.automations.disabledCount,
      },
    };
  }

  private inferModule(toolName: string | null): string | null {
    if (!toolName) return null;
    const lower = toolName.toLowerCase();
    if (lower.includes('contact') || lower.includes('client') || lower.includes('lead')) return 'crm';
    if (lower.includes('invoice') || lower.includes('payment') || lower.includes('revenue')) return 'revenue';
    if (lower.includes('booking') || lower.includes('calendar') || lower.includes('schedule')) return 'calendar';
    if (lower.includes('campaign') || lower.includes('content') || lower.includes('post')) return 'content';
    if (lower.includes('project') || lower.includes('task')) return 'projects';
    if (lower.includes('expense') || lower.includes('budget')) return 'expenses';
    if (lower.includes('flow') || lower.includes('automation')) return 'flows';
    if (lower.includes('store') || lower.includes('product') || lower.includes('storefront')) return 'store';
    return null;
  }

  private extractAffectedEntities(inputPayload: Record<string, any>): string[] {
    const entities: string[] = [];
    for (const key of ['contactId', 'invoiceId', 'bookingId', 'projectId', 'productId', 'campaignId']) {
      if (inputPayload[key]) entities.push(`${key.replace('Id', '')}:${inputPayload[key]}`);
    }
    return entities;
  }

  private estimateImpact(
    steps: Array<{ riskTier: number; module: string | null }>,
    snapshot: any,
  ): string {
    const highRisk = steps.filter(s => s.riskTier >= 3).length;
    const modules = [...new Set(steps.map(s => s.module).filter(Boolean))];
    if (highRisk > 0) {
      return `${highRisk} high-risk step${highRisk > 1 ? 's' : ''} across ${modules.length} module${modules.length > 1 ? 's' : ''}`;
    }
    return `${steps.length} step${steps.length > 1 ? 's' : ''} across ${modules.length} module${modules.length > 1 ? 's' : ''}`;
  }
}
