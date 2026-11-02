import {
  Body,
  Controller,
  Get,
  Inject,
  Logger,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
  UnauthorizedException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
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
import { CanonicalModule, LEVEL_RANK, defaultScopesForRole, rankOf } from '../../core/authority/module-vocabulary';
import { getToolByName } from './flow-tool-registry';
import type { BusinessRole } from './role-engine.service';

interface AuthenticatedRequest extends Request {
  user?: { id: string; email?: string; role?: string };
}

/**
 * V1-31b-KEY-ACTION-ROUTES-BIND (V1-31 review SEC-V131-1, M46). The module scope
 * a tool executed from POST actions/businesses/:businessId/execute needs, by
 * tool-name prefix (an entry ending in '_') or exact name; the first match
 * wins. The executing member must hold it as ModuleScopeGuard computes scopes
 * (a 'read' family tool needs read, every other tool write). A tool that
 * matches nothing is refused: deny by default, so a tool added to the
 * registry is not executable from this route until it is mapped here.
 */
export const GRAPH_ACTION_TOOL_MODULES: ReadonlyArray<readonly [string, CanonicalModule]> = [
  ['fetch_', 'analytics'],
  ['reports_', 'analytics'],
  ['crm_', 'crm'],
  ['deals_', 'crm'],
  ['call_', 'crm'],
  ['sequence_', 'crm'],
  ['segment_contacts', 'crm'],
  ['tag_contact', 'crm'],
  ['create_followup_queue', 'crm'],
  ['draft_followup_message', 'crm'],
  ['commerce_', 'revenue'],
  ['payments_', 'revenue'],
  ['finance_', 'revenue'],
  ['reconcile_', 'revenue'],
  ['retainers_', 'revenue'],
  ['draft_payment_reminder', 'revenue'],
  ['expenses_', 'expenses'],
  ['bookings_', 'bookings'],
  ['calendar_', 'bookings'],
  ['projects_', 'projects'],
  ['time_', 'projects'],
  ['goals_', 'projects'],
  ['draft_project_update', 'projects'],
  ['content_', 'content'],
  ['social_', 'content'],
  ['marketing_', 'content'],
  ['assets_', 'content'],
  ['comms_', 'content'],
  ['community_', 'content'],
  ['seo_', 'content'],
  ['sync_seo_pages', 'content'],
  ['queue_campaign', 'content'],
  ['draft_campaign_bundle', 'content'],
  ['generate_content_brief', 'content'],
  ['automations_', 'automations'],
  ['delegation_', 'automations'],
  ['enable_flow_with_approval', 'automations'],
  ['store_', 'storefront'],
  ['inventory_', 'storefront'],
  ['suppliers_', 'storefront'],
  ['marketplace_', 'storefront'],
  ['apply_storefront_recommendation', 'storefront'],
  ['draft_storefront_copy', 'storefront'],
  ['structure_', 'team'],
  ['people_', 'team'],
  ['performance_', 'team'],
  ['payroll_', 'operations'],
  ['contracts_', 'operations'],
  ['contract_', 'operations'],
  ['helpdesk_', 'operations'],
  ['inbox_', 'operations'],
  ['approval_', 'operations'],
  ['command_', 'operations'],
  ['procurement_', 'operations'],
  ['governance_', 'operations'],
  ['evidence_', 'operations'],
  ['documents_', 'operations'],
  ['drive_', 'operations'],
];

/** The module scope a graph action needs, or null when the tool is mapped to none (refused). */
export function graphActionModuleScope(toolName: string): { module: CanonicalModule; minLevel: 'read' | 'write' } | null {
  const entry = GRAPH_ACTION_TOOL_MODULES.find(([key]) => (key.endsWith('_') ? toolName.startsWith(key) : toolName === key));
  if (!entry) return null;
  return { module: entry[1], minLevel: getToolByName(toolName)?.family === 'read' ? 'read' : 'write' };
}

/** The plan states whose pending steps this route may still execute. */
const OPEN_PLAN_STATUSES = new Set(['draft', 'pending', 'approved', 'executing']);

/** What a caller is told when it sends a tool name and arguments instead of a stored step. */
const UNBOUND_GRAPH_ACTION =
  'An action is executed only as a plan step the server holds: send planId and planStepId (from POST actions/businesses/:businessId/plan). A tool name and arguments sent by the client are not executed.';

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function safeInt(val: string | undefined, fallback: number): number {
  if (!val) return fallback;
  const n = parseInt(val, 10);
  return Number.isNaN(n) || n < 0 ? fallback : n;
}

@Controller()
@UseGuards(CrmRateLimitGuard)
export class GraphActionsController {
  private readonly logger = new Logger(GraphActionsController.name);

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
    const created = await this.planner.createPlan(businessId, intent, userId);
    // V1-31b: the stored plan, with the step ids POST .../execute takes
    // (createPlan answers its steps without ids).
    const plan = (await this.planner.getPlan(created.id, businessId)) ?? created;

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

  /**
   * V1-31b-KEY-ACTION-ROUTES-BIND (V1-31 review SEC-V131-1, M46). Executes one
   * plan step the server holds, looked up by planId and planStepId inside the
   * guarded business: the step's own tool and stored arguments, never a tool
   * name or arguments the client sends (those are ignored beside the ids, and
   * refused 400 without them). A step of another business, of another plan
   * or that does not exist is the same 404. The executing member must hold the
   * tool's module scope (graphActionModuleScope; an unmapped tool is refused).
   * The step is claimed pending -> executing (or awaiting_approval) by one
   * compare-and-set, so a replay or a concurrent call is 409 and runs nothing.
   * Confirming a stored step by its id is the quick confirmation; a step that
   * needs formal approval is queued once, with the stored payload, requested
   * by the caller.
   */
  @UseGuards(AuthGuard, BusinessGuard)
  @Post('actions/businesses/:businessId/execute')
  async executeAction(
    @Param('businessId') businessId: string,
    @Body() body: { planId?: unknown; planStepId?: unknown; toolName?: unknown; args?: unknown },
    @Req() req: AuthenticatedRequest,
  ) {
    const user = req?.user;
    const userId = user?.id;
    if (!user || !userId) throw new UnauthorizedException('Authenticated user required');
    const planId = typeof body?.planId === 'string' && body.planId.length > 0 ? body.planId : null;
    const planStepId = typeof body?.planStepId === 'string' && body.planStepId.length > 0 ? body.planStepId : null;
    if (!planId || !planStepId) throw new BadRequestException(UNBOUND_GRAPH_ACTION);

    const step = await this.prisma.client.aiPlanStep.findFirst({
      where: { id: planStepId, planId, plan: { businessId } },
      include: { plan: { select: { status: true, role: true } } },
    });
    if (!step) throw new NotFoundException('Plan step not found');
    if (body.toolName !== undefined || body.args !== undefined) {
      this.logger.warn(`Plan step ${step.id} was sent with a client tool name or arguments; only the stored step is considered`);
    }
    const toolName = step.toolName;
    if (!toolName) throw new BadRequestException('This plan step has no action to execute');
    if (!OPEN_PLAN_STATUSES.has(step.plan.status)) {
      throw new ConflictException(`This plan is ${step.plan.status}; its steps are not executed`);
    }
    const scope = graphActionModuleScope(toolName);
    if (!scope) {
      throw new ForbiddenException(`Tool "${toolName}" is mapped to no module scope, so it is not executed from this route`);
    }
    await this.requireModuleScope(businessId, { id: userId, role: user.role }, scope.module, scope.minLevel);

    const spent = () => new ConflictException('This plan step was already executed or is being executed');
    if (step.status !== 'pending') throw spent();

    const args: Record<string, unknown> = isJsonObject(step.inputPayload) ? { ...step.inputPayload } : {};
    const role = (step.role ?? step.plan.role ?? undefined) as BusinessRole | undefined;
    const decision = await this.governance.evaluate(businessId, toolName, undefined, role);
    /** The claim: true when this call moved the step out of 'pending'. */
    const claim = async (status: string) => {
      const { count } = await this.prisma.client.aiPlanStep.updateMany({
        where: { id: step.id, planId, status: 'pending' },
        data: { status, ...(status === 'executing' ? { startedAt: new Date() } : {}) },
      });
      return count === 1;
    };

    if (!decision.allowed) {
      // Nothing is claimed: the step can run once policy allows it.
      const blockedPayload: ActionBlockedPayload = {
        businessId,
        toolName,
        reason: decision.reason ?? 'Governance policy',
        riskTier: decision.tier,
      };
      this.eventEmitter.emit('action.blocked', blockedPayload);
      return { success: false, blocked: true, reason: decision.reason, tier: decision.tier };
    }

    if (decision.requiresFormalApproval || decision.requiresAdminApproval) {
      if (!(await claim('awaiting_approval'))) throw spent();
      let approval: { id: string };
      try {
        approval = await this.governance.createApprovalItem(businessId, {
          toolName,
          title: step.action || `Execute ${toolName}`,
          description: step.description ?? `Plan step ${step.order}`,
          inputPayload: args,
          planId,
          planStepId: step.id,
        });
      } catch (err: unknown) {
        // Nothing was queued: give the step back so it can be asked again.
        await this.prisma.client.aiPlanStep
          .updateMany({ where: { id: step.id, planId, status: 'awaiting_approval' }, data: { status: 'pending' } })
          .catch(() => undefined);
        throw err;
      }
      // createApprovalItem takes no requester; name the member who asked (as V1-31 does for Flow).
      await this.prisma.client.aiApprovalItem
        .updateMany({ where: { id: approval.id, businessId }, data: { userId } })
        .catch((e: unknown) => this.logger.warn(`Could not name the requester of approval item ${approval.id}: ${e instanceof Error ? e.message : String(e)}`));
      return {
        success: false,
        requiresApproval: true,
        approvalId: approval.id,
        tier: decision.tier,
        reason: decision.reason,
      };
    }

    if (!(await claim('executing'))) throw spent();
    const startedAt = Date.now();
    try {
      const result = await this.orchestrator.executeToolDirect(
        businessId,
        toolName,
        args,
        planId,
        step.id,
        // KF-EXEC-ACTION-001: the authenticated caller is the principal.
        { surface: 'GRAPH_ACTION', principalUserId: userId, planId, planStepId: step.id },
      );
      if (result.notCleared) {
        // The action boundary recorded the action and is waiting for it to be
        // confirmed or approved by its server-issued id. Nothing ran.
        await this.planner.updateStepStatus(step.id, 'awaiting_approval');
        return {
          success: false,
          requiresConfirmation: result.notCleared.disposition === 'AWAITING_CONFIRMATION',
          requiresApproval: result.notCleared.disposition === 'AWAITING_APPROVAL',
          confirmationId: result.notCleared.actionId,
          reason: result.error,
          tier: decision.tier,
        };
      }
      await this.planner.updateStepStatus(
        step.id,
        result.success ? 'completed' : 'failed',
        result.success && isJsonObject(result.result) ? result.result : null,
        result.success ? undefined : result.error,
        Date.now() - startedAt,
      );
      const executedPayload: ActionExecutedPayload = {
        businessId,
        toolName,
        module: this.inferModule(toolName),
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
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      await this.planner
        .updateStepStatus(step.id, 'failed', null, message, Date.now() - startedAt)
        .catch((e: unknown) => this.logger.warn(`Could not record the failure of plan step ${step.id}: ${e instanceof Error ? e.message : String(e)}`));
      const failPayload: ActionExecutedPayload = {
        businessId,
        toolName,
        module: null,
        riskTier: decision.tier,
        success: false,
      };
      this.eventEmitter.emit('action.executed', failPayload);
      return {
        success: false,
        error: message,
        tier: decision.tier,
      };
    }
  }

  /**
   * The member's scope on `module`, as ModuleScopeGuard computes it: SUPER_ADMIN
   * passes; otherwise the membership's explicit scope map, else its role's
   * defaults. A non-member, or a level below `minLevel`, is 403.
   */
  private async requireModuleScope(
    businessId: string,
    user: { id: string; role?: string },
    module: CanonicalModule,
    minLevel: 'read' | 'write',
  ): Promise<void> {
    if (user.role === 'SUPER_ADMIN') return;
    const membership = await this.prisma.client.membership.findUnique({
      where: { userId_businessId: { userId: user.id, businessId } },
      select: { role: true, permissionScopes: true },
    });
    if (!membership) throw new ForbiddenException('Not a member of this business');
    const scopes: Record<string, string> = isJsonObject(membership.permissionScopes)
      ? (membership.permissionScopes as Record<string, string>)
      : defaultScopesForRole(membership.role);
    const level = scopes[module] || 'none';
    if (rankOf(level) < LEVEL_RANK[minLevel]) {
      throw new ForbiddenException(`Insufficient permissions: ${module} requires ${minLevel} access (you have ${level})`);
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
