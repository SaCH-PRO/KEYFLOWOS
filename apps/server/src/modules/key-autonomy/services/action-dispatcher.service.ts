import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { KeyActionExecutorService } from '../key-action-executor.service';
import type { ExecutionOutcome } from '../key-action-executor.service';

export interface DispatchContext {
  businessId: string;
  planId: string;
  stepIndex: number;
  actionType: string;
  actionPayload: Record<string, unknown>;
  executedBy?: string;
}

export interface DispatchResult {
  success: boolean;
  result?: Record<string, unknown>;
  error?: string;
}

/**
 * ActionDispatcher — Routes plan step actions to the appropriate executor.
 *
 * This service is the bridge between the plan executor loop and the
 * existing action execution infrastructure. It handles the actual
 * dispatch of actions by looking up the correct handler and
 * recording the outcome.
 */
@Injectable()
export class ActionDispatcher {
  private readonly logger = new Logger(ActionDispatcher.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly keyActionExecutor: KeyActionExecutorService,
  ) {}

  /**
   * Dispatch a single action from a plan step.
   *
   * The actionPayload should contain at minimum:
   *   - proposal: The KeyActionProposalData shaped object
   *   - Or raw parameters for built-in action types
   */
  async dispatch(ctx: DispatchContext): Promise<DispatchResult> {
    const { businessId, planId, stepIndex, actionType, actionPayload } = ctx;

    this.logger.log(
      `[ActionDispatcher] Dispatching step ${stepIndex} (actionType=${actionType}) for plan ${planId}`,
    );

    try {
      // Normalize payload into proposal shape expected by KeyActionExecutorService
      const proposal = this.buildProposal(actionType, actionPayload, planId);

      const outcome: ExecutionOutcome = await this.keyActionExecutor.execute(
        businessId,
        proposal,
        ctx.executedBy ?? 'plan_executor',
      );

      if (outcome.success) {
        this.logger.log(
          `[ActionDispatcher] Step ${stepIndex} succeeded: ${JSON.stringify(outcome.result)}`,
        );
        return { success: true, result: outcome.result };
      } else {
        this.logger.warn(
          `[ActionDispatcher] Step ${stepIndex} failed: ${outcome.error}`,
        );
        return { success: false, error: outcome.error };
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `[ActionDispatcher] Step ${stepIndex} threw exception: ${message}`,
        err instanceof Error ? err.stack : undefined,
      );
      return { success: false, error: message };
    }
  }

  /**
   * Build a proposal object compatible with KeyActionExecutorService.execute().
   */
  private buildProposal(
    actionType: string,
    actionPayload: Record<string, unknown>,
    planId: string,
  ): Parameters<KeyActionExecutorService['execute']>[1] {
    return {
      id: `plan-step-${planId}-${Date.now()}`,
      businessId: (actionPayload.businessId as string) ?? '',
      userId: (actionPayload.userId as string) ?? null,
      sourceType: 'MANUAL',
      sourceId: planId,
      sourceMode: 'plan_executor',
      title: (actionPayload.title as string) ?? `Plan step: ${actionType}`,
      summary: (actionPayload.summary as string) ?? null,
      rationale: (actionPayload.rationale as string) ?? null,
      evidence: Array.isArray(actionPayload.evidence)
        ? (actionPayload.evidence as string[])
        : [],
      actionType: actionType as any,
      payload: (actionPayload.payload as Record<string, unknown>) ?? actionPayload,
      riskLevel: (actionPayload.riskLevel as any) ?? 'LOW',
      status: 'APPROVED',
      requiresApproval: false,
      approvedBy: null,
      approvedAt: null,
      rejectedBy: null,
      rejectedAt: null,
      rejectionReason: null,
      executedBy: null,
      executedAt: null,
      executionResult: null,
      failureReason: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }
}
