import { HttpException, HttpStatus, Injectable, Logger, Optional, forwardRef, Inject } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../core/prisma/prisma.service';
import { FeedbackLoopService } from './feedback-loop.service';
import { AiExecutionLogService } from '../ai/ai-execution-log.service';
import { AiOversightService } from '../ai/ai-oversight.service';
import { FlowOrchestratorService } from '../ai/flow-orchestrator.service';
import { UndoService } from './undo.service';

export interface DispatchContext {
  businessId: string;
  toolName: string;
  args: Record<string, any>;
  idempotencyKey?: string;
  planId?: string;
  planStepId?: string;
  source?: string;
  retryCount?: number;
  /** When true, suppresses confirmation UI callbacks (used by background workers) */
  background?: boolean;
}

export interface DispatchResult {
  success: boolean;
  result?: any;
  error?: string;
  dispatchId: string;
  durationMs: number;
  /**
   * KF-EXEC-ACTION-001: the KEY action boundary recorded the action and is
   * waiting for a human to confirm or approve it. Nothing ran. This is not a
   * failure of the tool.
   */
  awaitingApproval?: { actionId: string | null };
}

interface CircuitState {
  failures: number;
  lastFailure: number;
  open: boolean;
}

/**
 * W9-DISPATCH-CIRCUIT (review SEC-W8CTNM-1, owner ruling D-73): the circuit a dispatch counts toward
 * is one business's circuit for one tool. Keyed by tool name alone, five failures in one business
 * (five refusals of one member's plans) stopped the tool for every business for CIRCUIT_TIMEOUT_MS.
 */
function circuitKey(businessId: string, toolName: string): string {
  return JSON.stringify([businessId, toolName]);
}

/**
 * W9-DISPATCH-CIRCUIT (review SEC-W8CTNM-1, D-73): the tool refused this request with a 4xx answer of
 * its own (an HttpException: a contact the member may not open, 404; a principal who is no member of
 * the business, 403; an argument it does not take, 400). Asking again gets the same answer, and the
 * refusal is the tool working, not failing, so it is neither retried nor counted toward the circuit.
 * 408 Request Timeout and 429 Too Many Requests ask the caller to try again later: those stay failures.
 */
function isToolRefusal(err: unknown): boolean {
  if (!(err instanceof HttpException)) return false;
  const status = err.getStatus();
  return (
    status >= 400 && status < 500 && status !== HttpStatus.REQUEST_TIMEOUT && status !== HttpStatus.TOO_MANY_REQUESTS
  );
}

@Injectable()
export class ActionDispatcherService {
  private readonly logger = new Logger(ActionDispatcherService.name);
  /** One circuit per business and tool (circuitKey; W9-DISPATCH-CIRCUIT). */
  private readonly circuits = new Map<string, CircuitState>();
  private readonly CIRCUIT_THRESHOLD = 5;
  private readonly CIRCUIT_TIMEOUT_MS = 60_000;
  private readonly MAX_RETRIES = 2;
  private readonly RETRY_DELAYS = [1_000, 3_000];

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
    private readonly executionLog: AiExecutionLogService,
    private readonly governance: AiOversightService,
    private readonly flowOrchestrator: FlowOrchestratorService,
    private readonly undoService: UndoService,
    // Appended, not spliced in — other call sites construct positionally.
    // @Optional + forwardRef: FeedbackLoopService pulls in PlannerService, and
    // making dispatch hard-depend on the analysis layer would mean a module
    // that omits it could no longer execute a tool at all.
    @Optional()
    @Inject(forwardRef(() => FeedbackLoopService))
    private readonly feedbackLoop?: FeedbackLoopService,
  ) {}

  async dispatch(ctx: DispatchContext): Promise<DispatchResult> {
    const dispatchId = ctx.idempotencyKey ?? `disp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const startTime = Date.now();

    // Check circuit breaker (this business's, for this tool: W9-DISPATCH-CIRCUIT)
    if (this.isCircuitOpen(ctx.businessId, ctx.toolName)) {
      const msg = `Circuit breaker open for tool "${ctx.toolName}"`;
      this.logger.warn(msg);
      return { success: false, error: msg, dispatchId, durationMs: Date.now() - startTime };
    }

    // Check idempotency
    if (ctx.idempotencyKey) {
      const existing = await this.findIdempotentExecution(ctx.businessId, ctx.idempotencyKey);
      if (existing) {
        this.logger.log(`Idempotent hit for key "${ctx.idempotencyKey}"`);
        return { success: existing.success, result: existing.result, error: existing.error, dispatchId, durationMs: 0 };
      }
    }

    // Governance check
    const decision = await this.governance.evaluate(ctx.businessId, ctx.toolName);
    if (!decision.allowed) {
      this.recordFailure(ctx.businessId, ctx.toolName);
      return {
        success: false,
        error: decision.reason,
        dispatchId,
        durationMs: Date.now() - startTime,
      };
    }

    // Execute with retries
    let lastError: string | undefined;
    let boundaryAnswer: { actionId?: string | null; disposition?: string } | undefined;
    let refused = false;
    const retries = ctx.retryCount ?? this.MAX_RETRIES;

    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) {
        const delay = this.RETRY_DELAYS[Math.min(attempt - 1, this.RETRY_DELAYS.length - 1)];
        this.logger.log(`Retrying dispatch ${dispatchId} after ${delay}ms (attempt ${attempt + 1}/${retries + 1})`);
        await new Promise((r) => setTimeout(r, delay));
      }

      try {
        const result = await this.flowOrchestrator.executeToolDirectly(
          ctx.businessId,
          ctx.toolName,
          ctx.args,
          ctx.planId && ctx.planStepId ? { planId: ctx.planId, planStepId: ctx.planStepId } : undefined,
          // KF-EXEC-ACTION-001: the queue worker has a business and no principal.
          { surface: 'PLAN_QUEUE', planId: ctx.planId ?? null, planStepId: ctx.planStepId ?? null },
        );

        const durationMs = Date.now() - startTime;
        this.recordSuccess(ctx.businessId, ctx.toolName);

        await this.executionLog.logToolExecution(
          ctx.businessId,
          ctx.toolName,
          ctx.args,
          result,
          true,
          durationMs,
          {
            mode: 'autonomous',
            planId: ctx.planId,
            planStepId: ctx.planStepId,
            riskTier: decision.tier,
            idempotencyKey: ctx.idempotencyKey,
          },
        );

        this.events.emit('action.executed', {
          businessId: ctx.businessId,
          toolName: ctx.toolName,
          dispatchId,
          planId: ctx.planId,
          planStepId: ctx.planStepId,
          result,
        });

        // Register for undo if result contains entity info
        if (result?.id || result?.entityId) {
          const entityType = this.inferEntityType(ctx.toolName);
          if (entityType) {
            this.undoService.registerAction({
              businessId: ctx.businessId,
              actionType: ctx.toolName,
              entityType,
              entityId: result.id ?? result.entityId,
              originalPayload: ctx.args,
            }).catch(() => {});
          }
        }

        await this.runFeedback(ctx, result, true);

        return { success: true, result, dispatchId, durationMs };
      } catch (err: any) {
        lastError = (err as Error).message;
        this.logger.warn(`Dispatch ${dispatchId} attempt ${attempt + 1} failed: ${lastError}`);
        // The action boundary answered: the action is waiting for a human or
        // was refused. Asking again gets the same answer.
        if ((err as { retryable?: boolean })?.retryable === false) {
          boundaryAnswer = err as { actionId?: string | null; disposition?: string };
          break;
        }
        // W9-DISPATCH-CIRCUIT (SEC-W8CTNM-1, D-73): the tool's own 4xx refusal is final too.
        if (isToolRefusal(err)) {
          refused = true;
          break;
        }
      }
    }

    const durationMs = Date.now() - startTime;
    // A refusal by the boundary is the boundary working, not the tool failing.
    // Counting it would open this tool's circuit after five proposals and stop
    // the sixth from being filed at all. W9-DISPATCH-CIRCUIT (SEC-W8CTNM-1,
    // D-73): so is the tool's own 4xx refusal (five of one member's refused
    // plans stopped call_create_task for every business), and what is counted
    // is counted toward this business's circuit for the tool only.
    if (!boundaryAnswer && !refused) this.recordFailure(ctx.businessId, ctx.toolName);
    const awaitingApproval = boundaryAnswer?.disposition?.startsWith('AWAITING')
      ? { actionId: boundaryAnswer.actionId ?? null }
      : undefined;

    await this.executionLog.logToolExecution(
      ctx.businessId,
      ctx.toolName,
      ctx.args,
      lastError,
      false,
      durationMs,
      {
        mode: 'autonomous',
        planId: ctx.planId,
        planStepId: ctx.planStepId,
        riskTier: decision.tier,
        idempotencyKey: ctx.idempotencyKey,
      },
    );

    this.events.emit('action.blocked', {
      businessId: ctx.businessId,
      toolName: ctx.toolName,
      dispatchId,
      planId: ctx.planId,
      planStepId: ctx.planStepId,
      reason: lastError,
    });

    // Waiting for a human is not an outcome for the feedback loop to learn from.
    if (!awaitingApproval) await this.runFeedback(ctx, undefined, false, lastError);

    return { success: false, error: lastError, dispatchId, durationMs, ...(awaitingApproval ? { awaitingApproval } : {}) };
  }

  /**
   * Let the feedback loop see how this step went.
   *
   * FeedbackLoopService was registered in ai.module.ts and injected by nothing —
   * 223 lines that could decide whether to continue, skip, replan or record a
   * learned correction, and were never given the chance. DispatchContext already
   * carried planId and planStepId, exactly the shape FeedbackContext wants; the
   * wiring was simply never done.
   *
   * Only runs for dispatches that belong to a plan. A one-off tool call has no
   * plan to adapt, and analyze() would have nothing to act on.
   *
   * Cheap on the happy path: analyze() returns immediately for a successful,
   * healthy result and only spends a model call when something actually went
   * wrong — which is when the analysis is worth paying for.
   *
   * Never throws. Feedback is an improvement on the outcome, not part of it:
   * the tool has already run and its result must be returned regardless.
   */
  private async runFeedback(
    ctx: DispatchContext,
    outputResult: unknown,
    success: boolean,
    errorMessage?: string,
  ): Promise<void> {
    if (!this.feedbackLoop || !ctx.planId || !ctx.planStepId) return;

    try {
      const feedbackCtx = {
        businessId: ctx.businessId,
        planId: ctx.planId,
        planStepId: ctx.planStepId,
        toolName: ctx.toolName,
        inputPayload: ctx.args,
        outputResult,
        success,
        errorMessage,
      };
      const analysis = await this.feedbackLoop.analyze(feedbackCtx);
      await this.feedbackLoop.applyFeedbackToPlan(feedbackCtx, analysis);
    } catch (error: unknown) {
      this.logger.warn(
        `Feedback loop failed for ${ctx.toolName}: ` +
          `${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
  }

  async dispatchBatch(ctxs: DispatchContext[]): Promise<DispatchResult[]> {
    return Promise.all(ctxs.map((ctx) => this.dispatch(ctx)));
  }

  /**
   * `businessId`'s circuit for `toolName` (W9-DISPATCH-CIRCUIT). Without a business, the tool's
   * circuits in every business read as one: open when any is open, their failures summed, the
   * latest failure.
   */
  getCircuitStatus(toolName: string, businessId?: string): { open: boolean; failures: number; lastFailure: number | null } {
    const states =
      businessId !== undefined
        ? [this.circuits.get(circuitKey(businessId, toolName))].filter((s): s is CircuitState => !!s)
        : [...this.circuits.entries()].filter(([key]) => (JSON.parse(key) as string[])[1] === toolName).map(([, s]) => s);
    return {
      open: states.some((s) => s.open),
      failures: states.reduce((sum, s) => sum + s.failures, 0),
      lastFailure: states.length ? Math.max(...states.map((s) => s.lastFailure)) : null,
    };
  }

  /** Closes `businessId`'s circuit for `toolName`, or without a business the tool's circuit in every business. */
  resetCircuit(toolName: string, businessId?: string): void {
    if (businessId !== undefined) {
      this.circuits.delete(circuitKey(businessId, toolName));
      return;
    }
    for (const key of [...this.circuits.keys()]) {
      if ((JSON.parse(key) as string[])[1] === toolName) this.circuits.delete(key);
    }
  }

  private isCircuitOpen(businessId: string, toolName: string): boolean {
    const key = circuitKey(businessId, toolName);
    const state = this.circuits.get(key);
    if (!state || !state.open) return false;
    if (Date.now() - state.lastFailure > this.CIRCUIT_TIMEOUT_MS) {
      // Closed and forgotten: the map holds only circuits with failures to remember.
      this.circuits.delete(key);
      return false;
    }
    return true;
  }

  private recordSuccess(businessId: string, toolName: string): void {
    const key = circuitKey(businessId, toolName);
    const state = this.circuits.get(key);
    if (state) {
      state.failures = Math.max(0, state.failures - 1);
      if (state.failures === 0) this.circuits.delete(key);
    }
  }

  private recordFailure(businessId: string, toolName: string): void {
    const key = circuitKey(businessId, toolName);
    const state = this.circuits.get(key) ?? { failures: 0, lastFailure: 0, open: false };
    state.failures++;
    state.lastFailure = Date.now();
    if (state.failures >= this.CIRCUIT_THRESHOLD) {
      state.open = true;
      this.logger.warn(
        `Circuit breaker opened for tool "${toolName}" in business ${businessId} after ${state.failures} failures`,
      );
    }
    this.circuits.set(key, state);
  }

  private inferEntityType(toolName: string): string | null {
    if (toolName.includes('invoice')) return 'invoice';
    if (toolName.includes('contact')) return 'contact';
    if (toolName.includes('booking')) return 'booking';
    if (toolName.includes('task')) return 'task';
    if (toolName.includes('message') || toolName.includes('send')) return 'message';
    return null;
  }

  private async findIdempotentExecution(businessId: string, key: string): Promise<{ success: boolean; result?: any; error?: string } | null> {
    const log = await this.prisma.client.aiExecutionLog.findFirst({
      where: { businessId, idempotencyKey: key },
      orderBy: { createdAt: 'desc' },
    });
    if (!log) return null;
    return {
      success: log.success,
      result: log.outputSummary ?? undefined,
      error: log.errorMessage ?? undefined,
    };
  }
}
