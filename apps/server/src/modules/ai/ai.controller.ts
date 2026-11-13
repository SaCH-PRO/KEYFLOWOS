import { Body, Controller, Delete, forwardRef, Get, Inject, NotFoundException, Param, Post, Put, Query, Req, UseGuards, UnauthorizedException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Prisma } from '@prisma/client';
import { CrmRateLimit, CrmRateLimitGuard } from '../crm/guards/rate-limit.guard';
import { AiAdvisorService } from './ai-advisor.service';
import { AiUsageService } from './ai-usage.service';
import { AiExecutionLogService } from './ai-execution-log.service';
import { AiOversightService, RiskTier } from './ai-oversight.service';
import { BusinessGraphService } from './business-graph.service';
import { IntentParserService } from './intent-parser.service';
import { PlannerService } from './planner.service';
import {
  PLAN_APPROVER_ROLES,
  assertMayRunGraphAction,
  graphPlanReadScope,
  planStepDispatchedTool,
  visiblePlanSteps,
  visiblePlans,
  type GraphPlanReadScope,
} from './graph-actions.controller';
import { AiMemoryService, MemoryCategory } from './ai-memory.service';
import { StrategicIntelligenceService } from './strategic-intelligence.service';
import { ProAutoMonitorService } from './pro-auto-monitor.service';
import { ProfileIntelligenceService } from './profile-intelligence.service';
import { WorkspaceRecommendationsService } from './workspace-recommendations.service';
import { ModelGatewayService, AiMode, BudgetCaps, AiProvider } from './model-gateway.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { ModuleScopeGuard, RequireModuleScope } from '../../core/auth/module-scope.guard';
import { Request } from 'express';
import { PrismaService } from '../../core/prisma/prisma.service';
import { KeyCommandService } from './key-command.service';
import { KeyActionProposalService } from '../key-autonomy/key-action-proposal.service';
import { KeyCortexApprovalOrchestratorService } from '../key-cortex/key-cortex-approval-orchestrator.service';

interface AuthenticatedRequest extends Request {
  user?: { id: string; email?: string; role?: string };
}
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
import { KeyAgentConfigService } from './key-agent-config.service';
import { membershipApprovalTier } from '../../core/authority/approval-tier';
import { resolveCrmAccess, visibilityClause } from '../crm/crm-permissions.helper';
import { contactWhereBase } from '../crm/crm.helpers';
import {
  activityModuleScope,
  activityPrefilter,
  filterVisibleActivity,
  readVisibleActivityPage,
  resolveTimelineViewer,
  TIMELINE_SCAN_LIMIT,
  type TimelineViewer,
} from '../timeline/timeline-visibility';


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

/** The columns of an execution log row (AiExecutionLog) that say which plan step it is judged as. */
interface ExecutionLogStepKey {
  toolName: string | null;
  action: string;
  module: string | null;
}

/** An execution log row as GET ai/execution-logs reads it (AiExecutionLog). */
interface ExecutionLogRow extends ExecutionLogStepKey {
  inputSummary: unknown;
}

/**
 * What a run left on its execution log row besides its input: its output (outputSummary, and the
 * tool result and next step a writer may add) and, when it failed, its error (logToolExecution
 * writes a failed run's result there). Judged together as the step's output.
 */
const EXECUTION_LOG_OUTPUT_FIELDS = ['outputSummary', 'toolResult', 'nextStepSuggested', 'errorMessage'] as const;

/**
 * The module FlowOrchestratorService.executePlan writes a plan's own rows under (plan:start,
 * plan:complete: no tool, no input or output, the plan's objective as their rationale).
 */
const PLAN_RECORD_MODULE = 'planner';

/**
 * W6-BRIEFINGS-SCOPE review CR-W6BS-1 (owner ruling D-63): the most rows one findMany returns.
 * @keyflow/db's defaultTakeExtension caps every findMany at 1000 rows whatever `take` asks, so a read
 * that asks for more gets 1000 and cannot tell them from the end of the query. The End of Day count
 * reads the day in batches of this size.
 */
const ACTIVITY_FIND_MANY_CAP = 1000;

/**
 * W5-EXEC-LOGS-VISIBILITY review CR-EXL-2: the plan step a row is judged as (visiblePlanSteps). A
 * plan's own row (PLAN_RECORD_MODULE, no tool) is no step: it records the plan, which the plan read
 * rule shows with its objective to whoever may read the plan (GET ai/plans), so it is judged as a
 * step that names no tool and no module (shown with its plan, its input and output filtered by the
 * viewer's contact visibility, D-74). Any other row is the step it ran: its tool, or, for a
 * KEY-cortex command's row (it names its tool `module.action`), a step KeyCortexPlannerService
 * stores with no tool and the plan read rule judges by its module (KEY-R3a review SEC-R3a-1: a module
 * the rule maps to nothing is denied by default).
 */
function executionLogStep(row: ExecutionLogStepKey): { toolName: string | null; action: string | null; module: string | null } {
  if (row.module === PLAN_RECORD_MODULE && !row.toolName) return { toolName: null, action: null, module: null };
  return {
    toolName: row.module && row.toolName === `${row.module}.${row.action}` ? null : row.toolName,
    action: row.action,
    module: row.module,
  };
}

/**
 * W5-EXEC-LOGS-VISIBILITY review SEC-W5EL-1: whether `value` holds a payload its writer stored cut
 * down to a preview ({ _truncated, _size, _preview }: AiExecutionLogService.sanitizePayload and
 * KEY-cortex auditJson keep the first 500 characters of one past 5000). A preview cannot be judged by
 * the contacts it names (the id naming its row may be past its end), so it is withheld from a viewer
 * who may not open every contact.
 */
function holdsCutDownPayload(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(holdsCutDownPayload);
  const record = value as Record<string, unknown>;
  if (record._truncated === true && '_preview' in record) return true;
  return Object.values(record).some(holdsCutDownPayload);
}

/**
 * W5-EXEC-LOGS-VISIBILITY (CV-08l; D-74, D-93): execution log rows as `scope` lets its viewer read
 * them, by the plan read rule (visiblePlanSteps; KEY-R3a/KEY-R3b), not a second one. Each row is the
 * plan step it ran (executionLogStep), its input (inputSummary) and its output
 * (EXECUTION_LOG_OUTPUT_FIELDS). A row whose step the viewer may not see is not served; a row whose
 * output only the OWNER and a SUPER_ADMIN read (a contact read) is served with that output null;
 * every other output loses the rows naming a contact the viewer may not open, and a row whose input
 * names one is served with input and output null (D-74). Review SEC-W5EL-1: for a viewer who may not
 * open every contact, a cut-down input (holdsCutDownPayload) may name one, so the row is served with
 * input and output null, and a cut-down output is served null, as the plan read rule withholds the
 * step whose whole value names one. The OWNER's rows are unchanged.
 */
async function visibleExecutionLogs<L extends ExecutionLogRow>(logs: readonly L[], scope: GraphPlanReadScope): Promise<L[]> {
  const judgesContacts = scope.hiddenContacts !== null;
  const steps = logs.map((log) => {
    const fields = log as unknown as Record<string, unknown>;
    const outputs = EXECUTION_LOG_OUTPUT_FIELDS.filter((f) => f in fields);
    const inputCutDown = judgesContacts && holdsCutDownPayload(log.inputSummary);
    const outputWithheld = inputCutDown || (judgesContacts && outputs.some((f) => holdsCutDownPayload(fields[f])));
    return {
      log,
      ...executionLogStep(log),
      inputPayload: inputCutDown ? null : log.inputSummary,
      outputResult: outputWithheld ? null : (Object.fromEntries(outputs.map((f) => [f, fields[f] ?? null])) as Record<string, unknown>),
    };
  });
  const shown = await visiblePlanSteps(steps, scope);
  return shown.map(({ log, inputPayload, outputResult }) => {
    const output = (outputResult ?? {}) as Record<string, unknown>;
    const row: Record<string, unknown> = { ...(log as unknown as Record<string, unknown>), inputSummary: inputPayload ?? null };
    for (const f of EXECUTION_LOG_OUTPUT_FIELDS) if (f in row) row[f] = output[f] ?? null;
    return row as unknown as L;
  });
}

/**
 * W5-EXEC-LOGS-VISIBILITY review CR-EXL-1: the rows among `keys` (each distinct step key of the rows a
 * page is read from) whose step `scope` shows, as a filter on those keys, or null when it shows every
 * one. visibleExecutionLogs drops a row only by its step (executionLogStep), which its key decides,
 * so a page read with this filter holds `limit` rows while more are served and its count is the
 * number served. The plan read rule judges each key once (visiblePlanSteps over keys with no input or
 * output: no contact is looked up).
 */
async function servedExecutionLogKeys(
  keys: readonly ExecutionLogStepKey[],
  scope: GraphPlanReadScope,
): Promise<Prisma.AiExecutionLogWhereInput[] | null> {
  const shown = await visiblePlanSteps(
    keys.map((key, index) => ({ ...executionLogStep(key), index })),
    scope,
  );
  if (shown.length === keys.length) return null;
  return shown.map(({ index }) => ({ toolName: keys[index].toolName, action: keys[index].action, module: keys[index].module }));
}

@Controller('ai')
@UseGuards(CrmRateLimitGuard)
export class AiController {
  constructor(
    @Inject(AiAdvisorService) private readonly advisor: AiAdvisorService,
    @Inject(AiUsageService) private readonly aiUsage: AiUsageService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AiExecutionLogService) private readonly executionLog: AiExecutionLogService,
    @Inject(AiOversightService) private readonly governance: AiOversightService,
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
    @Inject(KeyAgentConfigService) private readonly keyAgentConfig: KeyAgentConfigService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
    @Inject(UndoService) private readonly undoService: UndoService,
    @Inject(ProactiveSuggestionService) private readonly suggestions: ProactiveSuggestionService,
    @Inject(WorkflowTemplateService) private readonly workflows: WorkflowTemplateService,
    @Inject(KeyActionProposalService) private readonly proposals: KeyActionProposalService,
    @Inject(forwardRef(() => KeyCortexApprovalOrchestratorService))
    private readonly approvalOrchestrator: KeyCortexApprovalOrchestratorService,
  ) {}

  @Get('health')
  health() {
    return { status: 'ok', module: 'ai' };
  }

  /**
   * W10-ADVISOR-TIMELINE (review SEC-W9TO-2; owner ruling D-63, timeline-scope TS-13e): this built the
   * model's prompt from the business's ten newest Activity titles and every figure for any member. The
   * member who asks is now the chat's viewer (AiAdvisorService.chat): filtered, not refused.
   */
  @UseGuards(AuthGuard, BusinessGuard)
  @CrmRateLimit(30, 60_000)
  @Post('businesses/:businessId/ai/chat')
  async chat(
    @Param('businessId') businessId: string,
    @Body() body: { message: string; history?: Array<{ role: string; content: string }> },
    @Req() req: AuthenticatedRequest,
  ) {
    const viewer = await resolveTimelineViewer(this.prisma, businessId, this.planViewer(req).id);
    return this.advisor.chat(businessId, body.message, body.history, viewer);
  }

  /**
   * W7-BRIEFINGS-REST (review SEC-W6BS-1; owner ruling D-63, as W5/W6 applied it to the morning and
   * end-of-day briefings): this answered every member the month's cashFlow and built the model's prompt
   * from every recent Activity title and every figure. The member who asks is now the briefing's viewer
   * (AiAdvisorService.generateDailyBriefing): filtered, not refused.
   */
  @UseGuards(AuthGuard, BusinessGuard)
  @CrmRateLimit(10, 60_000)
  @Get('businesses/:businessId/ai/briefing')
  async briefing(@Param('businessId') businessId: string, @Req() req: AuthenticatedRequest) {
    const viewer = await resolveTimelineViewer(this.prisma, businessId, this.planViewer(req).id);
    return this.advisor.generateDailyBriefing(businessId, viewer);
  }

  /**
   * W11-AI-CASHFLOW-REVENUE (review SEC-W10AT-2; owner rulings D-57, D-100, D-104): the forecast is the
   * business's currentBalance, projectedBalance, daily revenue and expense rates and an alert naming the
   * outstanding invoices' total, so it needs revenue read, as its commerce twin GET
   * commerce/businesses/:businessId/cash-flow-forecast does (TS-20e). ModuleScopeGuard takes businessId from
   * the path and refuses before any read; SUPER_ADMIN and the membership rule are its own (D-104).
   */
  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('revenue', 'read')
  @Get('businesses/:businessId/ai/cash-flow-forecast')
  async cashFlowForecast(
    @Param('businessId') businessId: string,
    @Query('days') days?: string,
  ) {
    return this.advisor.predictCashFlow(businessId, days ? parseInt(days, 10) : 30);
  }

  /**
   * W11-AI-SIMULATE-VIEWER (review SEC-W10AT-3; owner rulings D-63, D-100; timeline-scope TS-13g): this put
   * the business's whole context (contacts whatever their visibility, every figure, the ten newest Activity
   * titles) in the model's prompt for any member. The member who asks is now the simulation's viewer
   * (AiAdvisorService.simulateScenario), as the chat's is: filtered, not refused.
   */
  @UseGuards(AuthGuard, BusinessGuard)
  @CrmRateLimit(10, 60_000)
  @Post('businesses/:businessId/ai/simulate')
  async simulate(
    @Param('businessId') businessId: string,
    @Body() body: { scenario: string; variables?: Record<string, any> },
    @Req() req: AuthenticatedRequest,
  ) {
    const viewer = await resolveTimelineViewer(this.prisma, businessId, this.planViewer(req).id);
    return this.advisor.simulateScenario(businessId, body.scenario, body.variables, viewer);
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

  /**
   * Trial-N repair round 2 recheck (AI-PLANS-READ): these returned every plan of the business with
   * its steps, inputPayload and outputResult to any member, undoing the queue's QUEUE-READ rule.
   * They now apply that rule (graphPlanReadScope): a plan to its proposer, the business OWNER, an
   * ADMIN or a SUPER_ADMIN; within it the steps whose dispatched tool's module scopes the viewer
   * holds at read; and a contact read's output (written by the plan executor from a run with no
   * principal) to the OWNER or a SUPER_ADMIN only (visiblePlanSteps). Another member's plan is
   * answered exactly as an unknown id.
   *
   * KEY-R3a-PLAN-READS (D-74): the same rule as every plan read route (the queue, GET
   * cortex/plans/:planId): a KEY-cortex step with no tool is judged by its module (its crm reads'
   * output is the OWNER's only), and every step output is filtered by the viewer's contact
   * visibility at read, whoever approved the step (visiblePlans).
   */
  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/ai/plans')
  async listPlans(
    @Param('businessId') businessId: string,
    @Query('status') status: string | undefined,
    @Query('limit') limit: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    const viewer = this.planViewer(req);
    const mayRead = await graphPlanReadScope(this.prisma, businessId, viewer);
    const plans = await this.planner.listPlans(businessId, status, safeInt(limit, 20), mayRead.seesEveryPlan ? undefined : viewer.id);
    return visiblePlans(plans, mayRead);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/ai/plans/:planId')
  async getPlan(
    @Param('businessId') businessId: string,
    @Param('planId') planId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const viewer = this.planViewer(req);
    const [mayRead, proposer] = await Promise.all([
      graphPlanReadScope(this.prisma, businessId, viewer),
      this.prisma.client.aiPlan.findFirst({ where: { id: planId, businessId }, select: { userId: true } }),
    ]);
    if (!proposer || (!mayRead.seesEveryPlan && proposer.userId !== viewer.id)) return null;
    const plan = await this.planner.getPlan(planId, businessId);
    return plan ? { ...plan, steps: await visiblePlanSteps(plan.steps, mayRead) } : null;
  }

  private planViewer(req: AuthenticatedRequest): { id: string; role?: string } {
    const id = req?.user?.id;
    if (!id) throw new UnauthorizedException('Authenticated user required');
    return { id, role: req.user?.role };
  }

  /**
   * Trial-N repair round 2 (PLAN-APPROVE): an approval makes PlanExecutorService run every stored
   * step with no principal, so the approver must be one who could have each step run: what
   * POST actions/.../execute requires (assertMayRunGraphAction: the tool's module scopes, the CRM
   * sub-permission, the OWNER for owner-only tools, D-46 for a SUPER_ADMIN who is not a member),
   * with the contact reads the dispatcher bounds by its principal kept to the OWNER (the executor
   * hands it none), and the plan proposed by the approver or the approver the business OWNER or an
   * ADMIN. Refused 403 before anything changes.
   *
   * Trial-N repair round 2 recheck (APPROVE-NOTOOL): the tool checked is the one the executor
   * dispatches (planStepDispatchedTool: `toolName ?? action`), so a step stored with no toolName
   * whose action names a tool is checked as that tool; only a step whose action names nothing the
   * dispatcher runs (an 'analyze' step) runs nothing and needs nothing.
   */
  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/ai/plans/:planId/approve')
  async approvePlan(
    @Param('businessId') businessId: string,
    @Param('planId') planId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const userId = req?.user?.id;
    if (!userId) throw new UnauthorizedException('Authenticated user required to approve plans');
    const plan = await this.prisma.client.aiPlan.findFirst({
      where: { id: planId, businessId },
      select: { userId: true, steps: { select: { toolName: true, action: true }, orderBy: { order: 'asc' } } },
    });
    for (const toolName of new Set((plan?.steps ?? []).map(planStepDispatchedTool).filter((t): t is string => !!t))) {
      await assertMayRunGraphAction(this.prisma, businessId, { id: userId, role: req.user?.role }, toolName, plan?.userId ?? null, {
        proposerOverrideRoles: PLAN_APPROVER_ROLES,
        proposerRefusal: 'This plan is approved only by the member who proposed it, the business owner or an admin',
        noPrincipal: true,
      });
    }
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

    // V1-42b-UNDO-TENANT-SCOPE (SEC-V42-1): body.undoId is the client's. The
    // service resolves it only inside this guarded business (404 otherwise) and
    // requires req.user to hold write on the module of what is undone.
    if (!body.undoId) {
      // Try to find the most recent undoable action for this step
      const recent = await this.undoService.getRecentActions(businessId);
      const match = recent.find((a) => a.createdAt > new Date(Date.now() - 60 * 1000)); // within last minute
      if (!match) throw new BadRequestException('Undo window expired or no undoable action found');
      const result = await this.undoService.undo(match.id, req.user?.id, businessId);
      if (result.success) {
        await this.prisma.client.aiPlanStep.update({
          where: { id: stepId },
          data: { status: 'failed', errorMessage: 'Undone by user' },
        });
      }
      return result;
    }

    const result = await this.undoService.undo(body.undoId, req.user?.id, businessId);
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

  /**
   * W5-EXEC-LOGS-VISIBILITY (CV-08l; owner rulings D-74, D-93; review SEC-D93-1, SEC-D93-2 residual):
   * this answered every row of the business, input and output, to every member. The plan-queue
   * dispatcher logs each step's whole result, so the output of an owner-run plan (the OWNER's own, a
   * journey, a default trigger, the daily briefing: D-93 runs the system's plans as the owner)
   * reached every member, contacts a STAFF member may not open included. It now applies the plan
   * read rule (graphPlanReadScope, as GET ai/plans): a viewer who sees every plan (the OWNER, an
   * ADMIN, a SUPER_ADMIN) is served the rows of every run, anyone else the rows of their own runs
   * (memberRunsFilter); each row is then judged as the plan step it ran (visibleExecutionLogs:
   * visiblePlanSteps' rule, its output withheld when only the OWNER reads that step's output and
   * otherwise filtered by the viewer's contact visibility, D-74), a plan's own row with its plan
   * (review CR-EXL-2). Review CR-EXL-1: the page is read and counted over the rows served
   * (servedExecutionLogPage), so it holds `limit` rows while more are served and `total` counts
   * those. The OWNER is served every row as stored.
   */
  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/ai/execution-logs')
  async getExecutionLogs(
    @Param('businessId') businessId: string,
    @Req() req: AuthenticatedRequest,
    @Query('module') module?: string,
    @Query('toolName') toolName?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const viewer = this.planViewer(req);
    const mayRead = await graphPlanReadScope(this.prisma, businessId, viewer);
    const page = await this.servedExecutionLogPage(businessId, viewer.id, mayRead, { module, toolName }, safeInt(limit, 50), safeInt(offset, 0));
    return { ...page, logs: await visibleExecutionLogs(page.logs, mayRead) };
  }

  /**
   * W5-EXEC-LOGS-VISIBILITY review CR-EXL-1: one page of the execution log rows `scope` serves its
   * viewer, newest first, and their count. The rows are those of the runs the viewer may read (every
   * run for a viewer who sees every plan, else memberRunsFilter) whose step the plan read rule shows
   * (servedExecutionLogKeys), so visibleExecutionLogs drops none of them. When every row of every run
   * is served, getHistory reads the page as before.
   */
  private async servedExecutionLogPage(
    businessId: string,
    viewerId: string,
    scope: GraphPlanReadScope,
    filter: { module?: string; toolName?: string },
    limit: number,
    offset: number,
  ) {
    const runs = scope.seesEveryPlan ? null : await this.memberRunsFilter(businessId, viewerId);
    const where: Prisma.AiExecutionLogWhereInput = {
      businessId,
      ...(filter.module ? { module: filter.module } : {}),
      ...(filter.toolName ? { toolName: filter.toolName } : {}),
      ...(runs ? { OR: runs } : {}),
    };
    const keys = await this.prisma.client.aiExecutionLog.groupBy({ by: ['toolName', 'action', 'module'], where });
    const served = await servedExecutionLogKeys(keys, scope);
    if (!runs && !served) return this.executionLog.getHistory(businessId, filter, limit, offset);
    if (served && served.length === 0) return { logs: [], total: 0, limit, offset };
    const page: Prisma.AiExecutionLogWhereInput = served ? { AND: [where, { OR: served }] } : where;
    const [logs, total] = await Promise.all([
      this.prisma.client.aiExecutionLog.findMany({ where: page, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit, skip: offset }),
      this.prisma.client.aiExecutionLog.count({ where: page }),
    ]);
    return { logs, total, limit, offset };
  }

  /**
   * W5-EXEC-LOGS-VISIBILITY (D-74): the execution log rows of the runs `memberId` may read when they
   * do not see every plan: a row of a plan they proposed (the plan read rule: a plan to its
   * proposer), and a row of no plan that ran for them (its userId: the member a tool ran for, as the
   * orchestrator and the execute route attribute it). A row of another member's plan, or of none that
   * ran for nobody (the system's runs), is not theirs.
   */
  private async memberRunsFilter(businessId: string, memberId: string): Promise<Prisma.AiExecutionLogWhereInput[]> {
    const plans = await this.prisma.client.aiPlan.findMany({ where: { businessId, userId: memberId }, select: { id: true } });
    return [
      { planId: null, userId: memberId },
      ...(plans.length > 0 ? [{ planId: { in: plans.map((p) => p.id) } }] : []),
    ];
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
    // Phase 0.6: all pending approvals are served from the canonical
    // KeyActionProposal table (legacy AI items, PRO_AUTO insights, etc.).
    return this.proposals.list(businessId, { status: 'PENDING' });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/ai/approvals/history')
  async getApprovalHistory(
    @Param('businessId') businessId: string,
    @Query('limit') limit?: string,
  ) {
    // Phase 0.6: approval history is now read from KeyActionProposal.
    // See getPendingApprovals for the migration note on response shape.
    const proposals = await this.proposals.list(businessId, { sourceType: 'AI_LEGACY' });
    const history = proposals
      .filter((p) => p.status !== 'PENDING')
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, safeInt(limit, 50));
    return history;
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
    return this.resolveLegacyApproval(businessId, approvalId, body.resolution, userId);
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
    const results = await Promise.allSettled(
      body.approvalIds.map((id) => this.resolveLegacyApproval(businessId, id, body.resolution, userId)),
    );
    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected').length;
    return { succeeded, failed, total: body.approvalIds.length };
  }

  private async resolveLegacyApproval(
    businessId: string,
    approvalId: string,
    resolution: 'approved' | 'rejected' | 'deferred',
    userId: string,
  ) {
    // Canonical path: resolve directly from KeyActionProposal.
    let proposal: any;
    try {
      proposal = await this.proposals.get(businessId, approvalId);
    } catch {
      proposal = null;
    }

    if (proposal) {
      await this.assertCanResolveApproval(businessId, proposal.riskTier ?? 2, userId);
      if (resolution === 'deferred') {
        // Defer by rejecting with a deferral reason; true deferral state is not in the proposal model.
        return this.approvalOrchestrator.reject({
          proposalId: approvalId,
          businessId,
          userId,
          reason: 'Deferred by operator',
        });
      }
      if (proposal.status !== 'PENDING') {
        throw new BadRequestException(`Proposal ${approvalId} is already resolved (status: ${proposal.status})`);
      }
      return resolution === 'approved'
        ? this.approvalOrchestrator.approve({ proposalId: approvalId, businessId, userId, autoExecute: false })
        : this.approvalOrchestrator.reject({ proposalId: approvalId, businessId, userId });
    }

    // Compatibility fallback: legacy aiApprovalItem records are migrated once on resolution.
    const item = await this.prisma.client.aiApprovalItem.findFirst({
      where: { id: approvalId, businessId },
    });
    if (!item) throw new NotFoundException(`Approval item ${approvalId} not found for business ${businessId}`);

    await this.assertCanResolveApproval(businessId, item.riskTier, userId);

    if (resolution === 'deferred') {
      await this.prisma.client.aiApprovalItem.update({
        where: { id: approvalId },
        data: { status: 'deferred', resolution: 'deferred', resolvedAt: new Date(), resolvedByUserId: userId },
      });
      return { deferred: true, approvalId };
    }

    proposal = await this.migrateAiApprovalItemToProposal(businessId, item);
    if (proposal.status !== 'PENDING') {
      throw new BadRequestException(`Proposal ${proposal.id} is already resolved (status: ${proposal.status})`);
    }

    const resolved =
      resolution === 'approved'
        ? await this.approvalOrchestrator.approve({
            proposalId: proposal.id,
            businessId,
            userId,
            autoExecute: false,
          })
        : await this.approvalOrchestrator.reject({
            proposalId: proposal.id,
            businessId,
            userId,
            reason: (item.rationale ?? undefined) as string | undefined,
          });

    await this.prisma.client.aiApprovalItem.update({
      where: { id: item.id },
      data: {
        status: resolution,
        resolution,
        resolvedAt: new Date(),
        resolvedByUserId: userId,
        migratedToProposalId: proposal.id,
      },
    });

    return resolved;
  }

  private async migrateAiApprovalItemToProposal(
    businessId: string,
    item: any,
  ) {
    if (item.migratedToProposalId) {
      return this.proposals.get(businessId, item.migratedToProposalId);
    }

    const proposal = await this.approvalOrchestrator.propose({
      businessId,
      userId: item.userId ?? undefined,
      sourceType: 'AI_LEGACY',
      sourceId: item.id,
      actionType: 'EXECUTE_TOOL',
      toolName: item.toolName,
      module: item.module ?? undefined,
      title: item.title,
      description: item.description ?? undefined,
      summary: item.description ?? undefined,
      rationale: item.rationale ?? undefined,
      expectedBenefit: item.expectedBenefit ?? undefined,
      risks: item.risks ?? undefined,
      parameters: (item.inputPayload as Record<string, unknown>) ?? {},
      affectedEntities: (item.affectedEntities as Record<string, unknown>) ?? {},
      planId: item.planId ?? undefined,
      planStepId: item.planStepId ?? undefined,
      correlationId: item.correlationId ?? undefined,
    });

    await this.prisma.client.aiApprovalItem.update({
      where: { id: item.id },
      data: { migratedToProposalId: proposal.id },
    });

    return proposal;
  }

  private async assertCanResolveApproval(
    businessId: string,
    riskTier: number,
    userId: string,
  ) {
    const user = await this.prisma.client.user.findUnique({ where: { id: userId } });
    const isSuperAdmin = user?.role === 'SUPER_ADMIN';
    if (isSuperAdmin) return;

    const membership = await this.prisma.client.membership.findFirst({
      where: { userId, businessId },
    });
    if (!membership) throw new NotFoundException('User is not a member of this business');

    // KF-EXEC-AUTH-001: was the third of three identical copies of this rule.
    const memberTier = membershipApprovalTier(membership);

    if (riskTier > memberTier) {
      throw new ForbiddenException(`Tier ${riskTier} approvals require approval tier ${riskTier} or higher (you have tier ${memberTier})`);
    }
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
        actionRoute: '/app/crm/contacts',
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
        actionRoute: '/app/crm/contacts',
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

  /**
   * Which AI providers this business can pick between, and whether each is
   * usable right now.
   *
   * Returns every provider the product supports rather than only the working
   * ones, with a reason attached when a provider is unusable. A business that
   * cannot see Anthropic in the list has no reason to go and supply an
   * Anthropic key, so hiding the unconfigured ones would keep them
   * unconfigured.
   */
  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/ai/providers')
  async getAiProviders(@Param('businessId') businessId: string) {
    return { providers: await this.gateway.listSelectableProviders(businessId) };
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/ai/preferences')
  async getAiPreferences(@Param('businessId') businessId: string) {
    const prefs = await this.gateway.getPreferences(businessId);
    return {
      mode: prefs.aiMode,
      writingStyle: prefs.preferredWritingStyle || 'professional',
      preferredProvider: prefs.preferredProvider ?? null,
      byokOpenai: prefs.byokOpenai ? '••••••••' : null,
      byokAnthropic: prefs.byokAnthropic ? '••••••••' : null,
      byokXai: prefs.byokXai ? '••••••••' : null,
      budgetCaps: prefs.budgetCaps || null,
    };
  }

  /**
   * SWEEP-P0-SCOPES round 2 class repair (CLASS B; finding CW-1): settings admin. The body writes,
   * replaces and clears the business's BYOK provider keys (byokOpenai, byokAnthropic, byokXai, stored by
   * ModelGatewayService.updatePreferences in ai_memories settings / ai_preferences), and every AI call
   * of the business then runs on the stored key: a provider credential binding, the SEC-1 class. It ran
   * AuthGuard and BusinessGuard only, so a STAFF member with every module none swapped the owner's key
   * for one of their own (the owner's read answers only '••••••••') and cleared it. The routing mode,
   * writing style and budget caps it also writes are the same business-wide AI settings.
   */
  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('settings', 'admin')
  @Put('businesses/:businessId/ai/preferences')
  async updateAiPreferences(
    @Param('businessId') businessId: string,
    @Body() body: {
      mode?: AiMode;
      /** Null clears the preference and returns routing to the default chain. */
      preferredProvider?: AiProvider | null;
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
    // '' is the clear signal the gateway understands, matching how the BYOK
    // fields below treat null. Validation of the value itself lives in
    // updatePreferences so it applies however the preference is set.
    if (body.preferredProvider !== undefined) {
      updates.preferredProvider = body.preferredProvider === null ? '' : body.preferredProvider;
    }
    if (body.byokOpenai !== undefined) updates.byokOpenai = body.byokOpenai === null ? '' : body.byokOpenai;
    if (body.byokAnthropic !== undefined) updates.byokAnthropic = body.byokAnthropic === null ? '' : body.byokAnthropic;
    if (body.byokXai !== undefined) updates.byokXai = body.byokXai === null ? '' : body.byokXai;
    if (body.budgetCaps !== undefined) updates.budgetCaps = body.budgetCaps === null ? undefined : body.budgetCaps;

    const merged = await this.gateway.updatePreferences(businessId, updates);
    return {
      success: true,
      mode: merged.aiMode,
      writingStyle: merged.preferredWritingStyle || 'professional',
      preferredProvider: merged.preferredProvider ?? null,
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
    @Body() body: { rawInput: string; inputMode?: 'TEXT' | 'VOICE'; mode?: 'ask' | 'do' | 'plan' | 'draft' | 'auto' },
  ) {
    const mode = body.mode ?? 'do';
    const cmd = await this.keyCommand.receiveCommand(businessId, req.user?.id, body.rawInput, body.inputMode ?? 'TEXT', mode as any);

    // DO and AUTO modes generate actionable "Do It For Me" suggestions
    if (mode === 'do' || mode === 'auto') {
      const result = await this.keyCommand.generateDoItForMe(businessId, body.rawInput, req.user?.id, cmd.id);
      await (this.prisma as any).client.keyCommand.update({
        where: { id: cmd.id },
        data: { status: 'EXECUTED', executionResult: { goal: result.goal, findings: result.findings, actions: result.actions, commandItemIds: result.commandItemIds } as any },
      });
      // SEC-V109b-2: what GET key/commands lists this caller for the row just written.
      return this.keyCommand.projectDoItForMe(businessId, req.user?.id, result);
    }

    // ASK and PLAN modes use the traditional planning pipeline
    const intent = await this.keyCommand.interpretIntent(cmd.id);
    await this.keyCommand.groundIntent(cmd.id, businessId);
    const plan = await this.keyCommand.planActions(cmd.id, intent);
    const riskLevel = this.keyCommand.classifyRisk(plan);

    // DRAFT mode generates drafts without executing
    if (mode === 'draft') {
      const result = await this.keyCommand.generateDoItForMe(businessId, body.rawInput, req.user?.id, cmd.id);
      await (this.prisma as any).client.keyCommand.update({
        where: { id: cmd.id },
        data: { status: 'PLANNED', executionResult: { goal: result.goal, findings: result.findings, actions: result.actions, commandItemIds: result.commandItemIds, mode: 'draft' } as any },
      });
      // SEC-V109b-2: the drafts GET key/commands lists this caller for the row just written.
      const shown = await this.keyCommand.projectDoItForMe(businessId, req.user?.id, result);
      return { commandId: cmd.id, intent, plan, riskLevel, mode, drafts: shown.actions, ...(shown.dataWithheld ? { dataWithheld: true } : {}) };
    }

    // PLAN mode returns the plan without executing
    if (mode === 'plan') {
      await (this.prisma as any).client.keyCommand.update({
        where: { id: cmd.id },
        data: { status: 'PLANNED' },
      });
      return { commandId: cmd.id, intent, plan, riskLevel, mode };
    }

    // ASK mode executes low-risk plans, queues high-risk for approval
    const results = await this.keyCommand.executeApprovedPlan(cmd.id, plan, businessId, req.user?.id);
    return { commandId: cmd.id, intent, plan, riskLevel, results, mode };
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/key/commands')
  @CrmRateLimit(60, 60_000)
  async listKeyCommands(@Param('businessId') businessId: string, @Req() req: AuthenticatedRequest) {
    // SEC-V109-1 (V1-09b): a member's own rows, an OWNER/ADMIN's every row,
    // each projected to the caller's module scopes and contact visibility.
    return this.keyCommand.listCommands(businessId, req.user?.id);
  }

  // ── Briefings (Phase 7 MD) ──────────────────────────────────────────────

  /**
   * W5-BRIEFING-SCOPE (review SEC-W4TS-1 / ST-3; owner ruling D-63, the rule V1-84 built in
   * timeline-visibility.ts): this served every member the last day's SCHEDULED Activity rows
   * (revenueImpact, invoice numbers and contacts included), revenueToday, openInvoices and
   * activeLeads, unfiltered. Each part now follows what the member may read, as the timeline reads
   * do (filtered, not refused, so a partial-scope member keeps a working briefing):
   *   - schedule: the rows the timeline rule serves them (canReadActivityRow and contact visibility,
   *     filterVisibleActivity), the page filled as /upcoming fills it (readVisibleActivityPage);
   *   - revenueToday and openInvoices: revenue figures, withheld (0, as the day summary reports a
   *     revenueImpact of 0, V1-84 TS-04) from a member without revenue read;
   *   - activeLeads: the leads the member may list (crm read and the CRM list rule, visibilityClause
   *     M7), 0 without crm read.
   */
  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/briefing/morning')
  @CrmRateLimit(30, 60_000)
  async morningBriefing(@Param('businessId') businessId: string, @Req() req: AuthenticatedRequest) {
    const viewer = await resolveTimelineViewer(this.prisma, businessId, this.planViewer(req).id);
    const readsRevenue = viewer.readable.has('revenue');
    const readsCrm = viewer.readable.has('crm');
    const since = new Date(Date.now() - 86400000);
    const prefilter = activityPrefilter(viewer);
    const scheduleWhere = { businessId, occurredAt: { gte: since }, status: 'SCHEDULED', ...(prefilter.length ? { AND: prefilter } : {}) };
    const leadClause = readsCrm ? visibilityClause(viewer.crmAccess, viewer.userId) : null;
    const [schedule, revenue, openInvoices, leads] = await Promise.all([
      readVisibleActivityPage(this.prisma, viewer, 10, (skip, take) =>
        (this.prisma as any).client.activity.findMany({
          where: scheduleWhere,
          orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
          skip,
          take,
        }),
      ),
      readsRevenue
        ? (this.prisma as any).client.invoice.aggregate({
            where: { businessId, deletedAt: null, status: 'PAID', paidAt: { gte: since } },
            _sum: { total: true },
          })
        : null,
      readsRevenue
        ? (this.prisma as any).client.invoice.count({
            where: { businessId, deletedAt: null, status: { in: ['SENT', 'OVERDUE'] } },
          })
        : 0,
      readsCrm
        ? (this.prisma as any).client.contact.count({
            where: { ...contactWhereBase(businessId), leadScore: { gte: 60 }, ...(leadClause ? { AND: [leadClause] } : {}) },
          })
        : 0,
    ]);

    return {
      today: new Date().toISOString(),
      schedule,
      revenueToday: Number(revenue?._sum?.total ?? 0),
      openInvoices,
      activeLeads: leads,
    };
  }

  /**
   * W6-BRIEFINGS-SCOPE (review SEC-W5BS-1; owner ruling D-63, the rule V1-84 built in
   * timeline-visibility.ts, as W5-BRIEFING-SCOPE applied it to the morning briefing): this counted the
   * day's Activity rows, summed the day's paid invoices and counted the day's bookings and updated
   * contacts over the whole business, for every member (the control tower's End of Day report). Each
   * figure now follows what the member may read (filtered, not refused):
   *   - events: the day's rows the timeline rule serves them (canReadActivityRow and contact visibility,
   *     filterVisibleActivity), as /events serves them (countVisibleDayActivity). Review CR-W6BS-2: so the
   *     OWNER's count, like their /events, leaves out the rows of a module they do not read (connect is
   *     'none' for every role by default, D-63), and is one database count, not a capped row scan;
   *   - revenueCollected: a revenue figure, withheld (0, as V1-84 TS-04 reports a day's revenueImpact)
   *     from a member without revenue read;
   *   - bookingsCompleted: 0 without bookings read (GET bookings' module scope);
   *   - contactsUpdated: the contacts the member may list (crm read and the CRM list rule,
   *     visibilityClause M7), 0 without crm read.
   */
  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/briefing/eod')
  @CrmRateLimit(30, 60_000)
  async endOfDayBriefing(@Param('businessId') businessId: string, @Req() req: AuthenticatedRequest) {
    const viewer = await resolveTimelineViewer(this.prisma, businessId, this.planViewer(req).id);
    const readsCrm = viewer.readable.has('crm');
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const contactClause = visibilityClause(viewer.crmAccess, viewer.userId);
    const [events, revenue, bookings, contactsUpdated] = await Promise.all([
      this.countVisibleDayActivity(viewer, start),
      viewer.readable.has('revenue')
        ? (this.prisma as any).client.invoice.aggregate({
            where: { businessId, deletedAt: null, status: 'PAID', paidAt: { gte: start } },
            _sum: { total: true },
          })
        : null,
      viewer.readable.has('bookings')
        ? (this.prisma as any).client.booking.count({ where: { businessId, deletedAt: null, createdAt: { gte: start } } })
        : 0,
      readsCrm
        ? this.prisma.client.contact.count({
            where: {
              ...contactWhereBase(businessId),
              updatedAt: { gte: start },
              ...(contactClause ? { AND: [contactClause as Prisma.ContactWhereInput] } : {}),
            },
          })
        : 0,
    ]);

    return {
      date: start.toISOString(),
      events,
      revenueCollected: Number(revenue?._sum?.total ?? 0),
      bookingsCompleted: bookings,
      contactsUpdated,
    };
  }

  /**
   * W6-BRIEFINGS-SCOPE review CR-W6BS-1 / CR-W6BS-2 (owner ruling D-63): how many of the business's
   * Activity rows since `start` the timeline rule serves `viewer` (filterVisibleActivity).
   *   - A member who reads revenue and crm and whom visibilityClause does not restrict (OWNER,
   *     SUPER_ADMIN) is withheld a row by its module only: canReadActivityRow's money and contact terms
   *     need revenue and crm read, and hiddenContacts withholds no contact from them. Their count is one
   *     database count per stored module value (groupBy), each module judged by activityModuleScope, so
   *     it is exact for any number of rows (at base it was one COUNT of every row, every module
   *     included; the packet's row scan stopped at 1000). Owner ruling D-118
   *     (W11-D118-NAME-MISMATCH-OWNER-ONLY): only a viewer with readsOwnerWithheld (the D-116 / D-125
   *     owner, SUPER_ADMIN) counts this way, as canReadActivityRow withholds a d115_withheld row whose
   *     reason is not 'source_gone' from anyone else.
   *   - Any other member's rows are judged one by one: the day is read in batches of
   *     ACTIVITY_FIND_MANY_CAP (the most @keyflow/db's findMany returns; a larger take came back as 1000
   *     rows and read as the end of the day, CR-W6BS-1), the database prefilter first, up to the day's
   *     first TIMELINE_SCAN_LIMIT prefiltered rows, as a feed read examines at most that many.
   */
  private async countVisibleDayActivity(viewer: TimelineViewer, start: Date): Promise<number> {
    const dayWhere = { businessId: viewer.businessId, occurredAt: { gte: start } };
    // Owner ruling D-118 (W11-D118-NAME-MISMATCH-OWNER-ONLY): the per-module count serves every row of
    // module d115_withheld, so it is taken only for a viewer who reads owner-withheld rows too.
    if (
      viewer.readable.has('revenue') &&
      viewer.readable.has('crm') &&
      viewer.readsOwnerWithheld === true &&
      !visibilityClause(viewer.crmAccess, viewer.userId)
    ) {
      const byModule = await this.prisma.client.activity.groupBy({ by: ['module'], where: dayWhere, _count: { _all: true } });
      return byModule.reduce((sum, group) => {
        const scope = activityModuleScope(group.module);
        const served = scope === null ? viewer.readsUnmapped : viewer.readable.has(scope);
        return served ? sum + group._count._all : sum;
      }, 0);
    }
    const prefilter = activityPrefilter(viewer);
    let served = 0;
    for (let skip = 0; skip < TIMELINE_SCAN_LIMIT; skip += ACTIVITY_FIND_MANY_CAP) {
      const take = Math.min(ACTIVITY_FIND_MANY_CAP, TIMELINE_SCAN_LIMIT - skip);
      const batch = await this.prisma.client.activity.findMany({
        where: { ...dayWhere, ...(prefilter.length ? { AND: prefilter } : {}) },
        select: { id: true, module: true, category: true, contactId: true, entityType: true, entityId: true, revenueImpact: true, action: true, type: true, data: true },
        orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
        skip,
        take,
      });
      served += (await filterVisibleActivity(this.prisma, viewer, batch)).length;
      if (batch.length < take) break;
    }
    return served;
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

  /**
   * W5-JOURNEY-ROUTES (CV-08k; owner rulings D-74, D-93; review SEC-D93-1 residual): this handed
   * getJourneyInstance no viewer, which since W4-D93-NO-MEMBER-CONTACTS withholds every step's input
   * and output from a reader it cannot judge, so every reader (the OWNER included) saw no step data.
   * It now hands the authenticated member as the viewer, and the plan read rule (graphPlanReadScope +
   * visiblePlanSteps, as GET ai/plans/:planId) answers each what they may read (D-74).
   */
  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/journeys/:instanceId')
  @CrmRateLimit(30, 60_000)
  async getJourneyInstance(
    @Param('businessId') businessId: string,
    @Param('instanceId') instanceId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.journeyOrchestrator.getJourneyInstance(instanceId, businessId, this.planViewer(req));
  }

  /**
   * W5-JOURNEY-ROUTES (CV-08n; owner rulings D-73, D-93; review SEC-D93-1 residual): this recorded no
   * member, so the journey's plan ran memberless and D-73/D-93 refused its contact reads. A journey a
   * member's payload shapes is theirs: it records the requesting member as the journey plan's member
   * (D-73: a trigger records its creator and the plans it fires run as that member), so its steps run
   * under that member's authority, checked at run time (planStepRunAuthority).
   *
   * W5-JOURNEY-ROUTES review (SEC-W5JR-1; owner rulings D-64, D-37, D-71, D-73): recording the member
   * makes them the proposer of a plan whose step arguments their payload wrote, and a journey with a
   * tier-3 step stays an open plan whose stored steps POST actions/.../execute runs for its proposer.
   * So a payload may name only contacts the member may open (assertJourneyContactsVisible): one they
   * may not is refused 404, as D-64 refuses it to invoice and quote create, before any plan exists.
   */
  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/journeys/:key/trigger')
  @CrmRateLimit(10, 60_000)
  async triggerJourney(
    @Param('businessId') businessId: string,
    @Param('key') key: string,
    @Body() body: { payload?: Record<string, any> },
    @Req() req: AuthenticatedRequest,
  ) {
    const member = this.planViewer(req);
    const { getJourneyTemplate } = await import('./journey-templates');
    const template = getJourneyTemplate(key);
    if (!template) throw new BadRequestException(`Unknown journey template: ${key}`);
    const payload = body?.payload ?? {};
    await this.assertJourneyContactsVisible(businessId, member.id, payload);
    return this.journeyOrchestrator.executeJourney(businessId, template, payload, { memberId: member.id });
  }

  /**
   * W5-JOURNEY-ROUTES review (SEC-W5JR-1; owner rulings D-64, D-37, D-71): every contact a journey
   * payload names (`contactId`, and the value of any other top-level key that names contacts:
   * `targetContactId`, `contactIds`, ...) must be one `memberId` may open by the rule GET
   * contacts/:contactId applies (the tenant predicate, deletedAt null and the member's CRM visibility
   * clause: resolveCrmAccess + visibilityClause), so a STAFF member's own-contact rules and another
   * member's PRIVATE contacts hold for the steps the payload shapes (D-71). A hidden contact answers
   * exactly as an absent one, 404 'Contact not found' (D-64); a value that is not a contact id (not a
   * string) is refused 400, since the templates copy it into the steps' arguments as written.
   */
  private async assertJourneyContactsVisible(businessId: string, memberId: string, payload: unknown): Promise<void> {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return;
    const named = new Set<string>();
    for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
      if (!/contact_?ids?$/i.test(key) || value === undefined || value === null) continue;
      for (const id of Array.isArray(value) ? value : [value]) {
        if (typeof id !== 'string') throw new BadRequestException(`${key} must name contacts by their id`);
        named.add(id);
      }
    }
    if (named.size === 0) return;
    const access = await resolveCrmAccess(this.prisma, businessId, memberId);
    const clause = visibilityClause(access, memberId);
    const open = await this.prisma.client.contact.findMany({
      where: { ...contactWhereBase(businessId), id: { in: [...named] }, ...(clause ? { AND: [clause as Prisma.ContactWhereInput] } : {}) },
      select: { id: true },
    });
    if (open.length !== named.size) throw new NotFoundException('Contact not found');
  }

  // ── Morning Briefing (Phase 7) ──────────────────────────────────────────

  /**
   * W6-BRIEFINGS-SCOPE (review SEC-W5BS-2; owner ruling D-63): this built the daily briefing's cards
   * with no viewer, so every member got overdue invoice numbers and totals (card titles), the contact
   * and the amount (card args) and totalAtStake. The briefing is still written once a day for the
   * business (D-93), and the member who asks is now its viewer: they get the cards the timeline rule
   * serves them (MorningBriefingService.generateBriefing -> forViewer).
   */
  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/briefing')
  @CrmRateLimit(10, 60_000)
  async getBriefing(@Param('businessId') businessId: string, @Req() req: AuthenticatedRequest) {
    const viewer = await resolveTimelineViewer(this.prisma, businessId, this.planViewer(req).id);
    return this.morningBriefingSvc.generateBriefing(businessId, viewer);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/briefing/:planId/execute-all')
  @CrmRateLimit(10, 60_000)
  async executeAllBriefingCards(
    @Param('businessId') businessId: string,
    @Param('planId') planId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    // KEY-R3b-PLAN-AUTHORITY (D-73): the briefing runs as the member who asks, checked per step at run time.
    const userId = req?.user?.id;
    if (!userId) throw new UnauthorizedException('Authenticated user required');
    return this.morningBriefingSvc.executeAllBriefingCards(businessId, planId, userId);
  }

  /**
   * W7-BRIEFINGS-REST (review SEC-W6BS-2; owner ruling D-73, KEY-R3b review SEC-R3b-4): this skipped
   * any plan by id alone for any member and recorded nothing. MorningBriefingService.skipBriefing now
   * takes only the business's daily briefing, for the member it runs as, the OWNER or an ADMIN (as
   * execute-all does), and the skip is recorded as the plan's own execution-log row (PLAN_RECORD_MODULE,
   * no tool: shown with its plan by the plan read rule) naming the member who skipped it.
   *
   * Review SEC-W7BR-2 (D-73): it answers how many steps were skipped and the plan's status, and a skip
   * that changed nothing (a repeat, a briefing already finished) writes no audit row.
   */
  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/briefing/:planId/skip')
  @CrmRateLimit(10, 60_000)
  async skipBriefing(
    @Param('businessId') businessId: string,
    @Param('planId') planId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<{ skipped: number; status: string }> {
    const userId = req?.user?.id;
    if (!userId) throw new UnauthorizedException('Authenticated user required');
    const { skipped, status, changed } = await this.morningBriefingSvc.skipBriefing(businessId, planId, userId);
    if (!changed) return { skipped, status };
    await this.executionLog.log({
      businessId,
      action: 'plan:skip',
      module: PLAN_RECORD_MODULE,
      mode: 'assisted',
      actor: 'user',
      userId,
      planId,
      rationale: `Daily briefing skipped by ${userId}`,
      success: true,
    });
    return { skipped, status };
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

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/ai/agent-config')
  async getAgentConfig(@Param('businessId') businessId: string) {
    return this.keyAgentConfig.getOrCreate(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Put('businesses/:businessId/ai/agent-config')
  async updateAgentConfig(@Param('businessId') businessId: string, @Body() body: any) {
    return this.keyAgentConfig.update(businessId, body);
  }
}
