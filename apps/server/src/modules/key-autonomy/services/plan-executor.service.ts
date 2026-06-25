import { Injectable, Logger, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { ActionDispatcher } from './action-dispatcher.service';

/**
 * PlanStep — Individual step within an ExecutionPlan.
 */
export interface PlanStep {
  index: number;
  actionType: string;
  actionPayload: Record<string, unknown>;
  dependencies: number[]; // Step indices that must complete first
  retries: number;
  timeoutMs: number;
}

/**
 * StepResult — Outcome of executing a single plan step.
 */
export interface StepResult {
  stepIndex: number;
  actionType: string;
  status: 'completed' | 'failed' | 'skipped';
  output?: Record<string, unknown>;
  error?: string;
  retryCount: number;
  startedAt: Date;
  completedAt: Date;
}

/**
 * RecoveryResult — Outcome of attempting to recover from a step failure.
 */
export interface RecoveryResult {
  recovered: boolean;
  action: 'retry' | 'skip' | 'escalate';
  reason: string;
}

/**
 * ExecutionTrace — Summary of a full plan execution.
 */
export interface ExecutionTrace {
  planId: string;
  stepsCompleted: number;
  stepsFailed: number;
  stepsSkipped: number;
  startedAt: Date;
  completedAt?: Date;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
}

/**
 * ExecutionStatus — Current runtime status of a plan.
 */
export interface ExecutionStatus {
  planId: string;
  status: string;
  currentStepIndex: number;
  totalSteps: number;
  isRunning: boolean;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * PlanExecutor — Core engine for executing multi-step plans with
 * dependency ordering, retry logic, cancellation, and full persistence.
 *
 * This is the critical fix for KEY's autonomy gap: previously plans
 * were created but never executed. This service closes that loop.
 */
@Injectable()
export class PlanExecutor {
  private readonly logger = new Logger(PlanExecutor.name);
  private activeExecutions = new Map<string, AbortController>();

  // Maximum retries per step (exponential backoff: 1s, 2s, 4s)
  private readonly MAX_RETRIES = 3;
  private readonly BACKOFF_BASE_MS = 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly actionDispatcher: ActionDispatcher,
  ) {}

  // =========================================================================
  // 1. executePlan — Main entry point: load, validate, and run all steps
  // =========================================================================

  async executePlan(planId: string, executedBy?: string): Promise<ExecutionTrace> {
    this.logger.log(`[executePlan] Starting execution of plan ${planId}`);

    // Prevent double-execution
    if (this.activeExecutions.has(planId)) {
      throw new ConflictException(`Plan ${planId} is already running`);
    }

    // Create abort controller for this execution
    const abortController = new AbortController();
    this.activeExecutions.set(planId, abortController);

    const trace: ExecutionTrace = {
      planId,
      stepsCompleted: 0,
      stepsFailed: 0,
      stepsSkipped: 0,
      startedAt: new Date(),
      status: 'running',
    };

    try {
      // Load plan and validate
      const plan = await this.prisma.executionPlan.findUnique({
        where: { id: planId },
      });

      if (!plan) {
        throw new NotFoundException(`Execution plan ${planId} not found`);
      }

      const steps: PlanStep[] = plan.steps as unknown as PlanStep[];

      if (!steps || steps.length === 0) {
        this.logger.warn(`[executePlan] Plan ${planId} has no steps; marking completed`);
        await this.finalizePlan(planId, 'completed', 0);
        trace.status = 'completed';
        trace.completedAt = new Date();
        return trace;
      }

      // Validate plan can run
      if (plan.status === 'running') {
        throw new ConflictException(`Plan ${planId} is already marked as running`);
      }
      if (plan.status === 'completed') {
        this.logger.log(`[executePlan] Plan ${planId} already completed; returning cached trace`);
        trace.status = 'completed';
        trace.stepsCompleted = steps.length;
        trace.completedAt = plan.completedAt ?? new Date();
        return trace;
      }

      // Mark as running
      await this.prisma.executionPlan.update({
        where: { id: planId },
        data: {
          status: 'running',
          startedAt: new Date(),
          currentStepIndex: 0,
        },
      });

      // Compute execution order via topological sort
      const executionOrder = this.topologicalSort(steps);
      this.logger.log(
        `[executePlan] Plan ${planId}: ${steps.length} steps, execution order: [${executionOrder.join(', ')}]`,
      );

      // Execute steps in order
      const completedSteps = new Set<number>();
      const failedSteps = new Set<number>();

      for (const stepIndex of executionOrder) {
        // Check cancellation before each step
        if (abortController.signal.aborted) {
          this.logger.log(`[executePlan] Plan ${planId} cancelled mid-execution`);
          trace.status = 'cancelled';
          await this.finalizePlan(planId, 'cancelled', stepIndex);
          return trace;
        }

        const step = steps.find((s) => s.index === stepIndex);
        if (!step) {
          this.logger.error(`[executePlan] Step ${stepIndex} not found in plan ${planId}`);
          failedSteps.add(stepIndex);
          trace.stepsFailed++;
          continue;
        }

        // Update current step index
        await this.prisma.executionPlan.update({
          where: { id: planId },
          data: { currentStepIndex: stepIndex },
        });

        // Check if all dependencies completed
        const depsSatisfied = step.dependencies.every(
          (dep) => completedSteps.has(dep) || failedSteps.has(dep),
        );
        if (!depsSatisfied) {
          this.logger.warn(
            `[executePlan] Step ${stepIndex} dependencies not satisfied; skipping`,
          );
          await this.recordStepResult(planId, step, 'skipped', undefined, 'Dependencies not satisfied');
          trace.stepsSkipped++;
          continue;
        }

        // If any dependency failed, skip this step
        const hasFailedDep = step.dependencies.some((dep) => failedSteps.has(dep));
        if (hasFailedDep) {
          this.logger.warn(
            `[executePlan] Step ${stepIndex} has failed dependency; skipping`,
          );
          await this.recordStepResult(planId, step, 'skipped', undefined, 'Dependency failed');
          trace.stepsSkipped++;
          continue;
        }

        // Execute the step
        const result = await this.executeStep(step, planId, plan.businessId, executedBy, abortController);

        if (result.status === 'completed') {
          completedSteps.add(stepIndex);
          trace.stepsCompleted++;
          this.logger.log(`[executePlan] Step ${stepIndex} completed`);
        } else if (result.status === 'skipped') {
          trace.stepsSkipped++;
          this.logger.log(`[executePlan] Step ${stepIndex} skipped`);
        } else {
          failedSteps.add(stepIndex);
          trace.stepsFailed++;
          this.logger.error(`[executePlan] Step ${stepIndex} failed: ${result.error}`);

          // Attempt recovery
          const recovery = this.handleStepFailure(step, result.error ?? 'Unknown error');
          if (recovery.action === 'escalate') {
            this.logger.error(
              `[executePlan] Step ${stepIndex} requires escalation; halting plan ${planId}`,
            );
            break;
          }
        }
      }

      // Determine final status
      const finalStatus: 'completed' | 'failed' =
        failedSteps.size > 0 || trace.stepsFailed > 0 ? 'failed' : 'completed';

      trace.status = finalStatus;
      trace.completedAt = new Date();

      await this.finalizePlan(planId, finalStatus, executionOrder[executionOrder.length - 1] ?? 0);

      this.logger.log(
        `[executePlan] Plan ${planId} finished: completed=${trace.stepsCompleted}, failed=${trace.stepsFailed}, skipped=${trace.stepsSkipped}`,
      );

      return trace;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`[executePlan] Fatal error executing plan ${planId}: ${message}`);

      trace.status = 'failed';
      trace.completedAt = new Date();

      try {
        await this.finalizePlan(planId, 'failed', 0);
      } catch {
        // Best-effort cleanup
      }

      throw err;
    } finally {
      this.activeExecutions.delete(planId);
    }
  }

  // =========================================================================
  // 2. executeStep — Run a single step with retry logic
  // =========================================================================

  async executeStep(
    step: PlanStep,
    planId: string,
    businessId: string,
    executedBy?: string,
    abortController?: AbortController,
  ): Promise<StepResult> {
    const startedAt = new Date();
    const maxRetries = step.retries ?? this.MAX_RETRIES;

    this.logger.log(
      `[executeStep] Step ${step.index} (actionType=${step.actionType}) starting, maxRetries=${maxRetries}`,
    );

    // Mark step as running
    await this.recordStepResult(planId, step, 'running');

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      // Check cancellation
      if (abortController?.signal.aborted) {
        this.logger.log(`[executeStep] Step ${step.index} cancelled`);
        return {
          stepIndex: step.index,
          actionType: step.actionType,
          status: 'skipped',
          error: 'Execution cancelled',
          retryCount: attempt,
          startedAt,
          completedAt: new Date(),
        };
      }

      try {
        const dispatchResult = await this.actionDispatcher.dispatch({
          businessId,
          planId,
          stepIndex: step.index,
          actionType: step.actionType,
          actionPayload: step.actionPayload,
          executedBy,
        });

        if (dispatchResult.success) {
          await this.recordStepResult(planId, step, 'completed', dispatchResult.result);
          return {
            stepIndex: step.index,
            actionType: step.actionType,
            status: 'completed',
            output: dispatchResult.result,
            retryCount: attempt,
            startedAt,
            completedAt: new Date(),
          };
        } else {
          // Dispatch returned failure — check if we should retry
          if (attempt < maxRetries) {
            const backoffMs = this.BACKOFF_BASE_MS * Math.pow(2, attempt);
            this.logger.warn(
              `[executeStep] Step ${step.index} attempt ${attempt + 1} failed, retrying in ${backoffMs}ms...`,
            );
            await sleep(backoffMs);
            continue;
          } else {
            // Exhausted retries
            await this.recordStepResult(planId, step, 'failed', undefined, dispatchResult.error);
            return {
              stepIndex: step.index,
              actionType: step.actionType,
              status: 'failed',
              error: dispatchResult.error,
              retryCount: attempt,
              startedAt,
              completedAt: new Date(),
            };
          }
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(`[executeStep] Step ${step.index} exception: ${message}`);

        if (attempt < maxRetries) {
          const backoffMs = this.BACKOFF_BASE_MS * Math.pow(2, attempt);
          this.logger.warn(
            `[executeStep] Step ${step.index} attempt ${attempt + 1} threw, retrying in ${backoffMs}ms...`,
          );
          await sleep(backoffMs);
          continue;
        } else {
          await this.recordStepResult(planId, step, 'failed', undefined, message);
          return {
            stepIndex: step.index,
            actionType: step.actionType,
            status: 'failed',
            error: message,
            retryCount: attempt,
            startedAt,
            completedAt: new Date(),
          };
        }
      }
    }

    // Should not reach here, but return failed as fallback
    return {
      stepIndex: step.index,
      actionType: step.actionType,
      status: 'failed',
      error: 'Unknown failure after retries exhausted',
      retryCount: maxRetries,
      startedAt,
      completedAt: new Date(),
    };
  }

  // =========================================================================
  // 3. handleStepFailure — Decide recovery strategy for a failed step
  // =========================================================================

  handleStepFailure(step: PlanStep, error: string): RecoveryResult {
    this.logger.error(
      `[handleStepFailure] Step ${step.index} (${step.actionType}) failed: ${error}`,
    );

    // Default: escalate for critical actions, skip for non-critical
    const nonCriticalActions = new Set([
      'SEND_NOTIFICATION',
      'LOG_EVENT',
      'UPDATE_STATUS',
      'SCHEDULE_FOLLOWUP',
    ]);

    if (nonCriticalActions.has(step.actionType)) {
      this.logger.log(
        `[handleStepFailure] Non-critical step ${step.index}; action=skip`,
      );
      return {
        recovered: true,
        action: 'skip',
        reason: `Non-critical action ${step.actionType} failed; skipping to allow plan to continue`,
      };
    }

    this.logger.error(
      `[handleStepFailure] Critical step ${step.index} failed; action=escalate`,
    );
    return {
      recovered: false,
      action: 'escalate',
      reason: `Critical step ${step.actionType} failed after all retries: ${error}`,
    };
  }

  // =========================================================================
  // 4. getExecutionStatus — Get current runtime status of a plan
  // =========================================================================

  async getExecutionStatus(planId: string): Promise<ExecutionStatus> {
    const plan = await this.prisma.executionPlan.findUnique({
      where: { id: planId },
    });

    if (!plan) {
      throw new NotFoundException(`Execution plan ${planId} not found`);
    }

    const steps: PlanStep[] = (plan.steps as unknown as PlanStep[]) ?? [];
    const isRunning = this.activeExecutions.has(planId) && plan.status === 'running';

    return {
      planId: plan.id,
      status: plan.status,
      currentStepIndex: plan.currentStepIndex,
      totalSteps: steps.length,
      isRunning,
    };
  }

  // =========================================================================
  // 5. cancelExecution — Cancel a running plan via AbortController
  // =========================================================================

  cancelExecution(planId: string): void {
    this.logger.log(`[cancelExecution] Cancelling plan ${planId}`);

    const controller = this.activeExecutions.get(planId);
    if (!controller) {
      this.logger.warn(`[cancelExecution] Plan ${planId} is not running; nothing to cancel`);
      return;
    }

    controller.abort();
    this.activeExecutions.delete(planId);

    this.logger.log(`[cancelExecution] Plan ${planId} cancelled successfully`);
  }

  // =========================================================================
  // Helpers
  // =========================================================================

  /**
   * Topological sort of plan steps based on dependencies.
   * Steps with no dependencies come first. Steps that depend
   * on others come after their dependencies.
   */
  private topologicalSort(steps: PlanStep[]): number[] {
    const adjacency = new Map<number, number[]>();
    const inDegree = new Map<number, number>();

    // Initialize
    for (const step of steps) {
      adjacency.set(step.index, []);
      inDegree.set(step.index, 0);
    }

    // Build graph
    for (const step of steps) {
      for (const dep of step.dependencies) {
        if (adjacency.has(dep)) {
          adjacency.get(dep)!.push(step.index);
          inDegree.set(step.index, (inDegree.get(step.index) ?? 0) + 1);
        }
      }
    }

    // Kahn's algorithm
    const queue: number[] = [];
    for (const [idx, degree] of inDegree.entries()) {
      if (degree === 0) queue.push(idx);
    }

    const result: number[] = [];
    while (queue.length > 0) {
      // Sort queue for deterministic order (lower indices first)
      queue.sort((a, b) => a - b);
      const current = queue.shift()!;
      result.push(current);

      for (const neighbor of adjacency.get(current) ?? []) {
        const newDegree = (inDegree.get(neighbor) ?? 0) - 1;
        inDegree.set(neighbor, newDegree);
        if (newDegree === 0) {
          queue.push(neighbor);
        }
      }
    }

    // Cycle detection — if result doesn't include all steps, there's a cycle
    // In that case, fall back to index order
    if (result.length < steps.length) {
      this.logger.warn(
        `[topologicalSort] Dependency cycle detected; falling back to index order`,
      );
      return steps.map((s) => s.index).sort((a, b) => a - b);
    }

    return result;
  }

  /**
   * Record a PlanStepResult in the database.
   */
  private async recordStepResult(
    planId: string,
    step: PlanStep,
    status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped',
    output?: Record<string, unknown>,
    error?: string,
  ): Promise<void> {
    try {
      // Upsert: update existing or create new
      const existing = await this.prisma.planStepResult.findFirst({
        where: { planId, stepIndex: step.index },
      });

      const data = {
        status,
        actionType: step.actionType,
        input: step.actionPayload as any,
        output: output ? (output as any) : undefined,
        error: error ?? undefined,
        startedAt: status === 'running' ? new Date() : existing?.startedAt,
        completedAt: status === 'completed' || status === 'failed' || status === 'skipped'
          ? new Date()
          : undefined,
      };

      if (existing) {
        await this.prisma.planStepResult.update({
          where: { id: existing.id },
          data,
        });
      } else {
        await this.prisma.planStepResult.create({
          data: {
            planId,
            stepIndex: step.index,
            actionType: step.actionType,
            status,
            input: step.actionPayload as any,
            output: output ? (output as any) : undefined,
            error: error ?? undefined,
            startedAt: status === 'running' ? new Date() : undefined,
            completedAt: status === 'completed' || status === 'failed' || status === 'skipped'
              ? new Date()
              : undefined,
          },
        });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`[recordStepResult] Failed to record step result: ${message}`);
      // Non-fatal: don't let recording failures crash the execution
    }
  }

  /**
   * Finalize a plan by setting its end state.
   */
  private async finalizePlan(
    planId: string,
    status: 'completed' | 'failed' | 'cancelled',
    finalStepIndex: number,
  ): Promise<void> {
    await this.prisma.executionPlan.update({
      where: { id: planId },
      data: {
        status,
        completedAt: new Date(),
        currentStepIndex: finalStepIndex,
      },
    });
  }
}
