import { Injectable, Logger, NotFoundException, ForbiddenException, ConflictException, Optional, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import type { Prisma } from '@prisma/client';
import { PlannerService } from '../ai/planner.service';
import { AiUsageService } from '../ai/ai-usage.service';
import { ParsedIntent } from '../ai/intent-parser.service';
import {
  KeyCortexExecutorService,
  ExecuteOptions,
  ExecutionRecord,
} from './key-cortex-executor.service';
import { KeyCortexSagaService } from './key-cortex-saga.service';
import { KeyCortexCompensationService } from './key-cortex-compensation.service';
import { ConnectorCommand } from './key-cortex-connector.types';
import { LEVEL_RANK, defaultScopesForRole, rankOf } from '../../core/authority/module-vocabulary';

export interface CreateGoalInput {
  title: string;
  description?: string;
  priority?: number;
  targetDate?: Date | string;
  parentGoalId?: string;
}

/**
 * No `userId`: who a plan is for is createPlanFromCommand's `userId` argument
 * (KeyCortexGoalsController passes the authenticated principal, R0-09e), never
 * a field of the request body.
 */
export interface CreatePlanFromCommandInput {
  objective: string;
  rawInput?: string;
  urgency?: ParsedIntent['urgency'];
  modules?: string[];
  scope?: string[];
}

/**
 * R0-09e-KEY-PLAN-ACTOR (R0-09c review ST-5 / CR-2): the member who asked, over
 * HTTP, for a plan to run. KeyCortexGoalsController builds it from the
 * principal AuthGuard admitted (@CurrentUser()) and the tenant BusinessGuard
 * checked; nothing in it comes from the request body.
 */
export interface PlanExecutionActor {
  /** The executing member's user id. */
  userId: string;
  /** Its User role, as AuthMiddleware attaches it (SUPER_ADMIN keeps the platform bypass). */
  role?: string | null;
  /** The tenant BusinessGuard checked: the plan must belong to it. */
  businessId: string;
}

/**
 * The actor a plan step runs as when no member is behind it: executePlan
 * called with no PlanExecutionActor (a system trigger, the query pipeline) on a
 * plan no member created. It names no User row, so the settings adapter's owner
 * rule and every other actor check refuse it, and the executor's audit row
 * records it as `actor: 'system'` with no userId.
 */
export const SYSTEM_PLAN_ACTOR = 'key_cortex';

/**
 * The AiPlan statuses executePlan may claim (R0-09e repair, review ST-2): a plan
 * not yet run ('draft', 'pending', 'approved') and one a member may run again
 * ('failed', 'waiting_approval'; the goals page offers Run on both). Never
 * 'running' (another execute holds it), 'completed', or the other executor's
 * 'executing'. A plan that stopped at an approval pause is claimed but never
 * re-run (V1-10 review ST-2): see runClaimedPlan.
 */
export const RUNNABLE_PLAN_STATUSES: readonly string[] = ['draft', 'pending', 'approved', 'failed', 'waiting_approval'];

/**
 * The status a plan's saga is closed with when its run stops at a step parked
 * for approval (V1-10 review ST-1). Terminal, with completedAt set: an approval
 * runs the parked step outside the saga, and nothing resumes it, so leaving it
 * 'running' recorded work in flight that would never finish or be compensated.
 * It is neither 'failed' nor compensated: a pause undoes none of the steps that
 * ran.
 */
export const SAGA_STOPPED_FOR_APPROVAL = 'stopped_for_approval';

/**
 * Trial-N repair round 2 (KEY-PLANS-D46): the connector modules whose actions
 * write the business's invoices and payments, the ones POST cortex/execute
 * holds to the revenue scope (CORTEX_MODULE_RULES: commerce -> revenue). A
 * plan step of one runs only for a member who holds revenue write.
 */
export const INVOICE_WRITE_MODULES: ReadonlySet<string> = new Set(['commerce']);

export interface PlanGoal {
  objective: string;
  constraints?: string[];
  successCriteria?: string[];
  horizon?: 'immediate' | 'tactical' | 'strategic';
}

export interface PlanStep {
  order: number;
  action: string;
  module?: string;
  parameters?: Record<string, unknown>;
  dependsOn?: number[];
  riskTier?: number;
  expectedBenefit?: string;
}

export interface PlanSimulationResult {
  successProbability: number;
  risks: string[];
  assumptions: string[];
}

export interface GeneratedPlan {
  goal: PlanGoal;
  steps: PlanStep[];
  confidence: number;
  simulationResult?: PlanSimulationResult;
}

@Injectable()
export class KeyCortexPlannerService {
  private readonly logger = new Logger(KeyCortexPlannerService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => PlannerService)) private readonly planner: PlannerService,
    @Inject(forwardRef(() => KeyCortexExecutorService)) private readonly executor: KeyCortexExecutorService,
    @Inject(forwardRef(() => KeyCortexSagaService)) private readonly saga: KeyCortexSagaService,
    @Optional()
    @Inject(AiUsageService)
    private readonly aiUsage?: AiUsageService,
    // APPENDED, never inserted — specs here construct positionally.
    @Optional() @Inject(forwardRef(() => KeyCortexCompensationService)) private readonly compensation?: KeyCortexCompensationService,
  ) {}

  async createGoal(businessId: string, input: CreateGoalInput) {
    // parentGoalId is caller-supplied and must be proven to belong to THIS
    // business before it is written. Until recently the global ValidationPipe
    // stripped the field (the DTO carried no validator metadata), so the
    // unchecked write was unreachable and therefore harmless. Making the DTO
    // work makes the field live, and without this check a caller could parent
    // their goal onto another tenant's goal — reading its id back out of the
    // relation afterwards.
    if (input.parentGoalId) {
      const parent = await this.prisma.client.aiGoal.findFirst({
        where: { id: input.parentGoalId, businessId },
        select: { id: true },
      });
      if (!parent) {
        // Not found vs. not yours are deliberately indistinguishable here:
        // distinguishing them would confirm the existence of another tenant's
        // goal id.
        throw new NotFoundException('Parent goal not found');
      }
    }

    return this.prisma.client.aiGoal.create({
      data: {
        businessId,
        title: input.title,
        description: input.description,
        priority: input.priority ?? 0,
        targetDate: input.targetDate ? new Date(input.targetDate) : null,
        parentGoalId: input.parentGoalId,
      },
    });
  }

  async listGoals(businessId: string, status?: string) {
    return this.prisma.client.aiGoal.findMany({
      where: { businessId, status: status ?? undefined },
      orderBy: { priority: 'desc' },
    });
  }

  async getGoal(businessId: string, goalId: string) {
    const goal = await this.prisma.client.aiGoal.findFirst({
      where: { id: goalId, businessId },
      include: { plans: { orderBy: { createdAt: 'desc' } } },
    });
    if (!goal) throw new NotFoundException('Goal not found');
    return goal;
  }

  /**
   * businessId is required, and it is first so that every existing caller fails
   * to compile until it supplies one.
   *
   * This used to take only a goalId and resolve it with
   * `findUnique({ where: { id: goalId } })` — no tenant scoping anywhere in the
   * path. AiGoal is not among the 47 models the Prisma tenant extension covers,
   * so nothing upstream was scoping it either, and POST
   * /cortex/goals/:goalId/plans passes the id straight from the URL with no
   * ownership check.
   *
   * So an authenticated user of business A could post another business's goal
   * id and get back a plan whose objective is built from that goal's title and
   * description. A cross-tenant read, and a write into the other tenant, from a
   * route that looks like it only touches your own data.
   *
   * AiGoal and AiPlan have since been added to BUSINESS_ID_MODELS as well. Two
   * layers, deliberately: the extension only fires when a request-scoped tenant
   * context is active, and cron and event-driven callers have none.
   */
  /**
   * Deleting was written inline in the controller. Lifted here so the HTTP
   * route and the goals_delete tool run the same scoped code — the alternative
   * is a handler doing its own prisma work, which is how finance_view_receivables
   * ended up computing an AR figure that could disagree with the Finance screen.
   */
  async deleteGoal(businessId: string, goalId: string) {
    const goal = await this.prisma.client.aiGoal.findFirst({
      where: { id: goalId, businessId },
    });
    if (!goal) throw new NotFoundException('Goal not found');

    await this.prisma.client.aiGoal.delete({ where: { id: goalId } });
    return { success: true, deletedId: goalId };
  }

  async createPlanFromGoal(businessId: string, goalId: string, userId?: string) {
    const goal = await this.prisma.client.aiGoal.findFirst({
      where: { id: goalId, businessId },
    });
    if (!goal) throw new NotFoundException('Goal not found');

    const generated = await this.generatePlan(goal.businessId, {
      objective: `${goal.title}${goal.description ? ` - ${goal.description}` : ''}`,
      horizon: 'tactical',
    });

    const planResult = await this.planner.createPlan(
      goal.businessId,
      this.generatedPlanToIntent(generated),
      userId,
    );

    await this.prisma.client.aiPlan.update({
      where: { id: planResult.id },
      data: { goalId: goal.id, status: 'pending' },
    });

    return this.prisma.client.aiPlan.findUnique({
      where: { id: planResult.id },
      include: { steps: true },
    });
  }

  async createPlanFromCommand(
    businessId: string,
    input: CreatePlanFromCommandInput,
    userId?: string,
  ) {
    const generated = await this.generatePlan(businessId, {
      objective: input.objective,
      constraints: input.scope,
      horizon: 'immediate',
    });

    return this.planner.createPlan(
      businessId,
      this.generatedPlanToIntent(generated, input),
      userId,
    );
  }

  /**
   * Generate a plan from a high-level goal.
   *
   * Uses an LLM when available; falls back to deterministic keyword
   * decomposition. The resulting plan is persisted as an aiPlan row.
   */
  async generatePlan(businessId: string, goal: PlanGoal): Promise<GeneratedPlan> {
    const steps = await this.decomposeGoal(businessId, goal);
    const simulation = this.simulatePlan(steps, goal);

    this.logger.log(`[generatePlan] Decomposed goal for ${businessId} into ${steps.length} step(s)`);

    return {
      goal,
      steps,
      confidence: simulation.successProbability,
      simulationResult: simulation,
    };
  }

  /**
   * LLM-based goal decomposition with deterministic fallback.
   */
  async decomposeGoal(businessId: string, goal: PlanGoal): Promise<PlanStep[]> {
    if (this.aiUsage) {
      try {
        const result = await this.aiUsage.callAi({
          businessId,
          feature: 'plan_decompose',
          messages: [
            {
              role: 'system',
              content: `You are KeyFlow's planning engine. Decompose the user's goal into ordered, concrete steps. Each step should use a canonical tool action (e.g. crm.list_contacts, commerce.create_invoice, autopilot.create_task). Respond with JSON only: { "steps": [ { "order": number, "action": "tool_name", "module": "crm|commerce|bookings|autopilot|workflow|key_inbox|key_genome", "parameters": {}, "dependsOn": [order numbers], "riskTier": 1-4, "expectedBenefit": "string" } ] }`,
            },
            {
              role: 'user',
              content: `Goal: ${goal.objective}\nConstraints: ${(goal.constraints ?? []).join(', ')}\nSuccess criteria: ${(goal.successCriteria ?? []).join(', ')}`,
            },
          ],
          maxTokens: 1200,
          temperature: 0.3,
          responseMode: 'structured_json',
        });

        const parsed = JSON.parse(result.content);
        const rawSteps = Array.isArray(parsed.steps) ? parsed.steps : [];
        if (rawSteps.length > 0) {
          return rawSteps.map((s: any, idx: number) => ({
            order: s.order ?? idx + 1,
            action: s.action ?? s.toolName ?? 'analyze',
            module: s.module ?? 'general',
            parameters: s.parameters ?? s.inputPayload ?? {},
            dependsOn: Array.isArray(s.dependsOn) ? s.dependsOn : [],
            riskTier: s.riskTier ?? 1,
            expectedBenefit: s.expectedBenefit ?? '',
          }));
        }
      } catch (err: unknown) {
        this.logger.warn(`LLM decomposition failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return this.fallbackDecomposeGoal(goal);
  }

  /**
   * Deterministic fallback decomposition.
   */
  private fallbackDecomposeGoal(goal: PlanGoal): PlanStep[] {
    const text = goal.objective.toLowerCase();
    const steps: PlanStep[] = [];

    if (text.includes('invoice') || text.includes('bill')) {
      steps.push(
        { order: 1, action: 'list_contacts', module: 'crm', riskTier: 1, expectedBenefit: 'Confirm customer exists and is billable' },
        { order: 2, action: 'create_invoice', module: 'commerce', riskTier: 2, dependsOn: [1], expectedBenefit: 'Create invoice' },
        { order: 3, action: 'send_invoice', module: 'commerce', riskTier: 2, dependsOn: [2], expectedBenefit: 'Deliver invoice to customer' },
      );
    } else if (text.includes('follow') || text.includes('task')) {
      steps.push(
        { order: 1, action: 'create_task', module: 'autopilot', riskTier: 1, expectedBenefit: 'Create follow-up task' },
        { order: 2, action: 'send_message', module: 'communications', riskTier: 2, dependsOn: [1], expectedBenefit: 'Notify stakeholder' },
      );
    } else if (text.includes('booking') || text.includes('appointment')) {
      steps.push(
        { order: 1, action: 'list_contacts', module: 'crm', riskTier: 1, expectedBenefit: 'Confirm customer exists' },
        { order: 2, action: 'get_services', module: 'bookings', riskTier: 1, dependsOn: [1], expectedBenefit: 'Find available service' },
        { order: 3, action: 'create_booking', module: 'bookings', riskTier: 2, dependsOn: [2], expectedBenefit: 'Book appointment' },
      );
    } else {
      steps.push(
        { order: 1, action: 'analyze_request', module: 'ai', riskTier: 1, expectedBenefit: 'Understand request' },
        { order: 2, action: 'draft_response', module: 'ai', riskTier: 1, dependsOn: [1], expectedBenefit: 'Prepare response' },
      );
    }

    return steps;
  }

  /**
   * Score a plan based on risk and complexity.
   */
  simulatePlan(steps: PlanStep[], _goal: PlanGoal): PlanSimulationResult {
    const maxRisk = Math.max(1, ...steps.map((s) => s.riskTier ?? 1));
    const dependencyPenalty = steps.reduce((acc, s) => acc + (s.dependsOn?.length ?? 0), 0) * 0.01;
    const successProbability = Math.max(0.25, 1 - (maxRisk - 1) * 0.15 - steps.length * 0.02 - dependencyPenalty);
    return {
      successProbability: Math.round(successProbability * 100) / 100,
      risks: steps.filter((s) => (s.riskTier ?? 1) >= 3).map((s) => `High-risk step: ${s.action}`),
      assumptions: ['Business data is current', 'Required permissions are granted'],
    };
  }

  /**
   * Replan after failures by appending recovery steps.
   */
  async replanIfNeeded(planId: string): Promise<GeneratedPlan | null> {
    const plan = await this.prisma.client.aiPlan.findUnique({
      where: { id: planId },
      include: { steps: true },
    });
    if (!plan) return null;

    const failedSteps = plan.steps.filter((s: any) => s.status === 'failed');
    if (failedSteps.length === 0) return null;

    const maxOrder = Math.max(0, ...plan.steps.map((s: any) => s.order ?? 0));
    const recoverySteps: PlanStep[] = failedSteps.map((s: any, i: number) => ({
      order: maxOrder + i + 1,
      action: `recover_${s.action}`,
      module: s.module ?? 'general',
      parameters: (s.inputPayload as Record<string, unknown>) ?? {},
      dependsOn: [s.order ?? 1],
      riskTier: Math.min(4, (s.riskTier ?? 1) + 1),
      expectedBenefit: `Recover from failure: ${s.errorMessage ?? 'unknown'}`,
    }));

    for (const step of recoverySteps) {
      await this.prisma.client.aiPlanStep.create({
        data: {
          planId,
          order: step.order,
          status: 'pending',
          toolName: step.action,
          action: step.action,
          module: step.module ?? 'general',
          description: step.expectedBenefit,
          riskTier: step.riskTier ?? 1,
          inputPayload: step.parameters as any,
          expectedBenefit: step.expectedBenefit,
        },
      });
    }

    await this.prisma.client.aiPlan.update({
      where: { id: planId },
      data: { status: 'draft' },
    });

    const goal: PlanGoal = { objective: plan.objective };
    return {
      goal,
      steps: recoverySteps,
      confidence: 0.5,
      simulationResult: this.simulatePlan(recoverySteps, goal),
    };
  }

  /**
   * R0-09e-KEY-PLAN-ACTOR (R0-09c review ST-5 / CR-2). Every step used to run as
   * `plan.userId ?? 'key_cortex'`, and POST plans/:planId/execute handed this
   * method no actor at all, while plan.userId came from the request body. So a
   * STAFF member who named the OWNER's id ran KEY commands as the OWNER (the
   * settings adapter's owner rule then passed), and any member ran any plan.
   *
   * With a `member` (the HTTP route): the plan is read in the member's checked
   * tenant only (another tenant's plan is not found), the member must be the
   * plan's creator, the business OWNER (OWNER membership or Business.ownerId)
   * or SUPER_ADMIN (else 403, before the plan starts), and every step runs as
   * that EXECUTING member, never as the creator named in the row and never as
   * SYSTEM_PLAN_ACTOR. With no member (a system trigger or the query pipeline,
   * which call this directly): a member's plan runs as that member, and only a
   * plan no member created runs as SYSTEM_PLAN_ACTOR. On either path a plan
   * runs only once it is claimed out of RUNNABLE_PLAN_STATUSES (409 'not
   * claimable' otherwise: running, completed, or a concurrent execute claimed
   * it first; V1-10, PRS-M24). `options.skipApproval` is honoured only for the
   * business OWNER or SUPER_ADMIN (V1-10 review ST-3). A plan stopped at an
   * approval pause runs none of its completed or parked steps again (review
   * ST-2), and its saga is closed SAGA_STOPPED_FOR_APPROVAL (review ST-1).
   */
  async executePlan(planId: string, options: ExecuteOptions = {}, member?: PlanExecutionActor) {
    const plan = member
      ? await this.prisma.client.aiPlan.findFirst({
          where: { id: planId, businessId: member.businessId },
          include: { steps: true },
        })
      : await this.prisma.client.aiPlan.findUnique({
          where: { id: planId },
          include: { steps: true },
        });
    if (!plan) throw new NotFoundException('Plan not found');
    if (member) await this.assertMayExecutePlan(plan, member);
    const actorId = member ? member.userId : (plan.userId ?? SYSTEM_PLAN_ACTOR);

    // V1-10 review ST-3: skipApproval skips the executor's whole approval
    // policy (the business's aiAlwaysRequireApproval, a capability's
    // requiresApproval flag, the spending threshold and the hourly cap), and
    // POST plans/:planId/execute passed it from the request body. So a STAFF
    // member who created a plan ran the steps the OWNER's policy parks. It is
    // honoured only for the business OWNER or SUPER_ADMIN; for anyone else (and
    // for a system caller, none of which sends it) the steps follow the policy.
    let runOptions = options;
    if (options.skipApproval && !(await this.mayOverrideApproval(plan.businessId, member))) {
      this.logger.warn(`[plans] execute ${planId}: skipApproval ignored for ${member ? member.userId : 'a system caller'} (only the business OWNER or SUPER_ADMIN may skip approval)`);
      runOptions = { ...options, skipApproval: false };
    }

    // R0-09e repair (review ST-2): claim the plan atomically. This set the
    // status to 'running' unconditionally, so a 'completed' plan re-ran every
    // side-effecting step under a new saga, and two concurrent executes of one
    // pending plan both ran it. Only a plan in RUNNABLE_PLAN_STATUSES is
    // claimed, in one conditional write; a plan that is running, completed or
    // in any other state is refused 409 and nothing runs.
    const claimed = await this.prisma.client.aiPlan.updateMany({
      where: { id: planId, businessId: plan.businessId, status: { in: [...RUNNABLE_PLAN_STATUSES] } },
      data: { status: 'running', startedAt: new Date() },
    });
    if (claimed.count !== 1) {
      throw new ConflictException('Plan is not claimable: it is already running, completed or otherwise not runnable');
    }

    try {
      return await this.runClaimedPlan(planId, plan, actorId, runOptions);
    } catch (err) {
      // An unexpected error while the plan is still 'running' must not leave it
      // so for ever (no execute could claim it again): it is released as
      // 'failed', which a member may run again, and the error is rethrown. Only
      // a plan still 'running' is released, so an error after the final status
      // was written never turns a 'completed' plan runnable again.
      await this.prisma.client.aiPlan
        .updateMany({ where: { id: planId, status: 'running' }, data: { status: 'failed', completedAt: null } })
        .catch((releaseErr: unknown) => this.logger.error(`Plan ${planId} release failed: ${(releaseErr as Error).message}`));
      throw err;
    }
  }

  /** Runs the steps of a plan executePlan has claimed ('running'), as `actorId`. */
  private async runClaimedPlan(
    planId: string,
    plan: Prisma.AiPlanGetPayload<{ include: { steps: true } }>,
    actorId: string,
    options: ExecuteOptions,
  ) {
    // V1-10 review ST-2: the steps as they are now that this run holds the
    // claim. The rows executePlan loaded before claiming can be stale: another
    // execute may have run the plan to an approval pause in between.
    const current = await this.prisma.client.aiPlan.findUnique({
      where: { id: planId },
      include: { steps: true },
    });
    const sorted = this.topologicalSort(current?.steps ?? plan.steps);

    // V1-10 review ST-2: a plan whose last run stopped at an approval pause (a
    // step still 'waiting_approval'; recorded 'waiting_approval', or 'failed'
    // by the V1 base) is never re-run from the top. That repeated every step
    // that had completed (its external effect happened twice) and parked the
    // paused step again (a second approval request, so two approvals ran it
    // twice). A step that completed in that run is not run again, and a parked
    // step is not parked again: the run stops there, still waiting. Only an
    // approval runs it, outside the plan.
    const resuming = sorted.some((s) => s.status === 'waiting_approval');

    // A resumed run starts a saga only if it runs a step, so Run on a plan
    // still waiting for approval leaves no saga behind.
    let saga: Awaited<ReturnType<KeyCortexSagaService['start']>> | undefined = resuming
      ? undefined
      : await this.startPlanSaga(plan.businessId, options);

    const executed: ExecutionRecord[] = [];
    let stopped = false;
    // V1-10 (PRS-M25): whether the run stopped at a step the executor parked
    // for approval. The final status was read from `plan.steps`, the rows as
    // loaded BEFORE the run (never 'waiting_approval'), so every pause was
    // recorded as a failure: the plan 'failed', a failed plan result written
    // and the saga failed.
    let pausedForApproval = false;

    for (let i = 0; i < sorted.length; i++) {
      const step = sorted[i];
      if (stopped) {
        await this.prisma.client.aiPlanStep.update({
          where: { id: step.id },
          data: { status: 'skipped' },
        });
        continue;
      }
      if (resuming && step.status === 'completed') continue;
      if (resuming && step.status === 'waiting_approval') {
        pausedForApproval = true;
        stopped = true;
        continue;
      }
      if (!saga) saga = await this.startPlanSaga(plan.businessId, options);

      await this.prisma.client.aiPlanStep.update({
        where: { id: step.id },
        data: { status: 'running', startedAt: new Date() },
      });

      const command = this.buildCommand(plan, step, actorId);
      const actionRef = `${step.module}.${step.action}`;

      // Record how this step would be undone, BEFORE running it.
      //
      // This call passed no compensation at all, so every step of every plan
      // stored `compensationAction: null` and the rollback below found nothing
      // to run — KeyCortexSagaService then recorded the saga
      // `compensation_unavailable`. This is the ONLY saga driver that runs in
      // production, so "sagas can roll back" was false everywhere it mattered.
      const undo = this.compensation?.getCompensatingAction(actionRef);
      await this.saga.addStep(
        saga.id,
        i,
        actionRef,
        { stepId: step.id, command },
        undo
          ? {
              stepName: actionRef,
              action: undo,
              // businessId last so a step payload cannot aim the rollback at
              // another tenant.
              payload: { ...(step.inputPayload as Record<string, unknown> ?? {}), businessId: plan.businessId },
            }
          : undefined,
      );

      const record = await this.executor.execute(command, {
        ...options,
        traceId: `${saga.id}_step${i}`,
        rollbackOnFailure: true,
      });
      executed.push(record);

      if (record.result.success) {
        await this.prisma.client.aiPlanStep.update({
          where: { id: step.id },
          data: {
            status: 'completed',
            outputResult: record.result.data as Record<string, unknown>,
            completedAt: new Date(),
            durationMs: record.durationMs,
          },
        });
        await this.saga.completeStep(saga.id, i, record.result.data as Record<string, unknown>);
      } else if ((record.result.data as Record<string, unknown>)?.approvalStatus) {
        await this.prisma.client.aiPlanStep.update({
          where: { id: step.id },
          data: { status: 'waiting_approval' },
        });
        // V1-10 review ST-1: the saga step names the approval request that now
        // holds it (the executor's record id is that request's id).
        // KeyCortexSagaService has no write for a parked step, so it is made
        // here, on this saga's own row.
        await this.prisma.client.sagaStep.updateMany({
          where: { sagaId: saga.id, stepIndex: i },
          data: {
            status: 'waiting_approval',
            output: {
              approvalStatus: (record.result.data as Record<string, unknown>).approvalStatus,
              approvalId: record.id,
            } as Prisma.InputJsonValue,
          },
        });
        pausedForApproval = true;
        stopped = true;
      } else {
        await this.prisma.client.aiPlanStep.update({
          where: { id: step.id },
          data: {
            status: 'failed',
            errorMessage: record.result.error ?? 'Execution failed',
            completedAt: new Date(),
            durationMs: record.durationMs,
          },
        });
        await this.saga.failStep(saga.id, i, record.result.error ?? 'Execution failed');
        try {
          await this.saga.compensate(saga.id);
        } catch (compErr: unknown) {
          this.logger.error(`Plan compensation failed: ${(compErr as Error).message}`);
        }
        stopped = true;
      }
    }

    const finalStatus = pausedForApproval ? 'waiting_approval' : stopped ? 'failed' : 'completed';

    await this.prisma.client.aiPlan.update({
      where: { id: planId },
      data: {
        status: finalStatus,
        completedAt: stopped ? null : new Date(),
      },
    });

    if (finalStatus === 'completed' || finalStatus === 'failed') {
      await this.recordPlanResult(planId, executed, finalStatus);
    }

    // A plan waiting for approval has not failed: its saga is neither failed
    // nor compensated (a pause undoes none of the steps that ran). V1-10 review
    // ST-1: nor is it left 'running', since nothing resumes it; it is closed as
    // SAGA_STOPPED_FOR_APPROVAL. KeyCortexSagaService has no write for that,
    // so it is made here, on this run's own saga row and only while it is
    // still running.
    if (saga) {
      if (finalStatus === 'completed') await this.saga.completeSaga(saga.id);
      else if (finalStatus === 'failed') await this.saga.failSaga(saga.id);
      else {
        await this.prisma.client.sagaExecution.updateMany({
          where: { id: saga.id, businessId: plan.businessId, status: 'running' },
          data: { status: SAGA_STOPPED_FOR_APPROVAL, completedAt: new Date() },
        });
      }
    }

    return { planId, status: finalStatus, executed: executed.length, sagaId: saga?.id ?? null };
  }

  private startPlanSaga(businessId: string, options: ExecuteOptions) {
    return this.saga.start({
      businessId,
      sagaType: 'ai_plan',
      correlationId: options.traceId,
    });
  }

  async getPlan(planId: string) {
    return this.prisma.client.aiPlan.findUnique({
      where: { id: planId },
      include: { steps: true, result: true, goal: true },
    });
  }

  private generatedPlanToIntent(
    generated: GeneratedPlan,
    input?: CreatePlanFromCommandInput,
  ): ParsedIntent {
    return {
      objective: generated.goal.objective,
      urgency: input?.urgency ?? 'normal',
      scope: generated.goal.successCriteria ?? input?.scope ?? [],
      modules: generated.steps.map((s) => s.module).filter(Boolean) as string[],
      missingInfo: [],
      actionCandidates: generated.steps.map((s) => ({
        toolName: `${s.module}.${s.action}`,
        description: s.expectedBenefit ?? `${s.module}.${s.action}`,
        confidence: 0.8,
        riskTier: s.riskTier ?? 1,
      })),
      clarificationNeeded: false,
      rawInput: input?.rawInput ?? generated.goal.objective,
    };
  }

  /**
   * Who may execute a plan over HTTP (R0-09e, pinned): its creator, the
   * business OWNER (the OWNER membership or Business.ownerId, the two arms
   * IdentityService.assertBusinessOwner admits) or SUPER_ADMIN. A plan no member
   * created (plan.userId null) is the OWNER's or SUPER_ADMIN's to run.
   *
   * Trial-N repair round 2 (KEY-PLANS-D46): a plan with a step that writes the
   * business's invoices or payments (INVOICE_WRITE_MODULES) runs only for a
   * member who holds revenue write: the commerce adapter writes as
   * KEY_SYSTEM_ACTOR_ID, so the service membership and scope checks that apply
   * over HTTP never run on this path. A SUPER_ADMIN who is not a member of the
   * business is refused such a plan (D-46); one who is a member keeps the
   * platform bypass, as on POST cortex/execute (cortexCommandRefusal). The
   * check runs before the claim, so a refused plan is left as it was.
   */
  private async assertMayExecutePlan(
    plan: { businessId: string; userId?: string | null; steps?: Array<{ module: string | null }> },
    member: PlanExecutionActor,
  ): Promise<void> {
    const writesInvoices = (plan.steps ?? []).some((s) => !!s.module && INVOICE_WRITE_MODULES.has(s.module));
    if (member.role === 'SUPER_ADMIN') {
      if (writesInvoices && !(await this.membershipOf(plan.businessId, member.userId))) {
        throw new ForbiddenException(
          'Not a member of this business: a platform SUPER_ADMIN who is not a member does not write its invoices or payments (D-46), so this plan is not run',
        );
      }
      return;
    }
    const mayRun =
      (!!plan.userId && plan.userId === member.userId) || (await this.isBusinessOwner(plan.businessId, member.userId));
    if (!mayRun) throw new ForbiddenException("Only the plan's creator or the business owner can execute this plan");
    if (writesInvoices) await this.assertRevenueWrite(plan.businessId, member.userId);
  }

  /**
   * Revenue write as ModuleScopeGuard computes it (the membership's explicit scope
   * map, else its role's defaults); the business OWNER (either arm) holds it.
   */
  private async assertRevenueWrite(businessId: string, userId: string): Promise<void> {
    if (await this.isBusinessOwner(businessId, userId)) return;
    const membership = await this.membershipOf(businessId, userId);
    if (!membership) throw new ForbiddenException('Not a member of this business');
    const explicit = membership.permissionScopes;
    const scopes: Record<string, string> =
      explicit && typeof explicit === 'object' && !Array.isArray(explicit)
        ? (explicit as Record<string, string>)
        : defaultScopesForRole(membership.role);
    const level = scopes.revenue || 'none';
    if (rankOf(level) < LEVEL_RANK.write) {
      throw new ForbiddenException(
        `Insufficient permissions: revenue requires write access (you have ${level}); this plan writes the business's invoices or payments`,
      );
    }
  }

  private membershipOf(businessId: string, userId: string) {
    return this.prisma.client.membership.findUnique({
      where: { userId_businessId: { userId, businessId } },
      select: { role: true, permissionScopes: true },
    });
  }

  /**
   * Whether a run may skip the executor's approval policy (V1-10 review ST-3):
   * only for the business OWNER (the OWNER membership or Business.ownerId) or
   * SUPER_ADMIN, who hold authority over that policy. Never for a STAFF
   * creator or a system caller.
   */
  private async mayOverrideApproval(businessId: string, member?: PlanExecutionActor): Promise<boolean> {
    if (!member) return false;
    if (member.role === 'SUPER_ADMIN') return true;
    return this.isBusinessOwner(businessId, member.userId);
  }

  /** The two arms IdentityService.assertBusinessOwner admits: the OWNER membership or Business.ownerId. */
  private async isBusinessOwner(businessId: string, userId: string): Promise<boolean> {
    const membership = await this.prisma.client.membership.findUnique({
      where: { userId_businessId: { userId, businessId } },
      select: { role: true },
    });
    if (membership?.role === 'OWNER') return true;
    const owned = await this.prisma.client.business.findFirst({
      where: { id: businessId, ownerId: userId },
      select: { id: true },
    });
    return !!owned;
  }

  /** Every step's command names `actorId`, which executePlan resolves (R0-09e). */
  private buildCommand(
    plan: { businessId: string },
    step: { module: string | null; action: string; inputPayload: unknown; toolName: string | null },
    actorId: string,
  ): ConnectorCommand {
    return {
      module: (step.module ?? 'general') as any,
      action: step.action,
      parameters: (step.inputPayload as Record<string, unknown>) ?? {},
      businessId: plan.businessId,
      userId: actorId,
      source: 'key_cortex',
      timestamp: new Date(),
      correlationId: `plan_${plan.businessId}_${Date.now()}`,
    };
  }

  private topologicalSort(steps: Array<{ id: string; order: number; dependsOn: string[]; module: string | null; action: string; inputPayload: unknown; toolName: string | null; status?: string | null }>) {
    const map = new Map(steps.map((s) => [s.id, s]));
    const visited = new Set<string>();
    const result: typeof steps = [];

    const visit = (step: typeof steps[0]) => {
      if (visited.has(step.id)) return;
      visited.add(step.id);
      for (const depId of step.dependsOn ?? []) {
        const dep = map.get(depId);
        if (dep) visit(dep);
      }
      result.push(step);
    };

    for (const step of [...steps].sort((a, b) => a.order - b.order)) {
      visit(step);
    }
    return result;
  }

  private async recordPlanResult(
    planId: string,
    records: ExecutionRecord[],
    status: string,
  ) {
    const successCount = records.filter((r) => r.result.success).length;
    const score = status === 'completed' ? 10 : Math.round((successCount / Math.max(records.length, 1)) * 10);
    await this.prisma.client.aiPlanResult.upsert({
      where: { planId },
      create: {
        planId,
        goalAchievementScore: score,
        businessImpactJson: { executed: records.length, succeeded: successCount, failed: records.length - successCount },
      },
      update: {
        goalAchievementScore: score,
        businessImpactJson: { executed: records.length, succeeded: successCount, failed: records.length - successCount },
      },
    });
  }
}
