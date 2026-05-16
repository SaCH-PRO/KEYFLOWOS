import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AiExecutionLogService } from '../ai/ai-execution-log.service';
import { GovernanceService } from '../ai/governance.service';
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
}

export interface DispatchResult {
  success: boolean;
  result?: any;
  error?: string;
  dispatchId: string;
  durationMs: number;
}

interface CircuitState {
  failures: number;
  lastFailure: number;
  open: boolean;
}

@Injectable()
export class ActionDispatcherService {
  private readonly logger = new Logger(ActionDispatcherService.name);
  private readonly circuits = new Map<string, CircuitState>();
  private readonly CIRCUIT_THRESHOLD = 5;
  private readonly CIRCUIT_TIMEOUT_MS = 60_000;
  private readonly MAX_RETRIES = 2;
  private readonly RETRY_DELAYS = [1_000, 3_000];

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
    private readonly executionLog: AiExecutionLogService,
    private readonly governance: GovernanceService,
    private readonly flowOrchestrator: FlowOrchestratorService,
    private readonly undoService: UndoService,
  ) {}

  async dispatch(ctx: DispatchContext): Promise<DispatchResult> {
    const dispatchId = ctx.idempotencyKey ?? `disp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const startTime = Date.now();

    // Check circuit breaker
    if (this.isCircuitOpen(ctx.toolName)) {
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
      this.recordFailure(ctx.toolName);
      return {
        success: false,
        error: decision.reason,
        dispatchId,
        durationMs: Date.now() - startTime,
      };
    }

    // Execute with retries
    let lastError: string | undefined;
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
        );

        const durationMs = Date.now() - startTime;
        this.recordSuccess(ctx.toolName);

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

        return { success: true, result, dispatchId, durationMs };
      } catch (err) {
        lastError = (err as Error).message;
        this.logger.warn(`Dispatch ${dispatchId} attempt ${attempt + 1} failed: ${lastError}`);
      }
    }

    const durationMs = Date.now() - startTime;
    this.recordFailure(ctx.toolName);

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

    return { success: false, error: lastError, dispatchId, durationMs };
  }

  async dispatchBatch(ctxs: DispatchContext[]): Promise<DispatchResult[]> {
    return Promise.all(ctxs.map((ctx) => this.dispatch(ctx)));
  }

  getCircuitStatus(toolName: string): { open: boolean; failures: number; lastFailure: number | null } {
    const state = this.circuits.get(toolName);
    return {
      open: state?.open ?? false,
      failures: state?.failures ?? 0,
      lastFailure: state?.lastFailure ?? null,
    };
  }

  resetCircuit(toolName: string): void {
    this.circuits.delete(toolName);
  }

  private isCircuitOpen(toolName: string): boolean {
    const state = this.circuits.get(toolName);
    if (!state || !state.open) return false;
    if (Date.now() - state.lastFailure > this.CIRCUIT_TIMEOUT_MS) {
      state.open = false;
      state.failures = 0;
      return false;
    }
    return true;
  }

  private recordSuccess(toolName: string): void {
    const state = this.circuits.get(toolName);
    if (state) {
      state.failures = Math.max(0, state.failures - 1);
      if (state.failures === 0) state.open = false;
    }
  }

  private recordFailure(toolName: string): void {
    const state = this.circuits.get(toolName) ?? { failures: 0, lastFailure: 0, open: false };
    state.failures++;
    state.lastFailure = Date.now();
    if (state.failures >= this.CIRCUIT_THRESHOLD) {
      state.open = true;
      this.logger.warn(`Circuit breaker opened for tool "${toolName}" after ${state.failures} failures`);
    }
    this.circuits.set(toolName, state);
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
      where: { businessId, action: { startsWith: 'tool:' } },
      orderBy: { createdAt: 'desc' },
      take: 1,
    });
    // Note: true idempotency would require storing the idempotency key on the log record.
    // For now we rely on callers to use deterministic keys for short windows.
    return null;
  }
}
