/**
 * KEY Cortex Lifecycle Service (Phase 3 Skeleton)
 *
 * Owns the cross-cutting identity thread and lifecycle state for every
 * KEY Cortex turn. It wraps KeyCortexConversationService and becomes the
 * single place where sessions, commands, execution logs, and audit events
 * are created with consistent correlationId/sessionId/commandId linkage.
 */

import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { RedisService } from '../../core/redis/redis.service';
import { KeyCortexEventBusService } from './key-cortex-event-bus.service';
import { KeyCortexConversationService } from './key-cortex-conversation.service';
import { auditErrorText, auditResultText } from './key-cortex-tool-registry.service';
import { getToolByName } from '../ai/flow-tool-registry';
import {
  CortexSession,
  CortexSessionStatus,
  CortexPersona,
  CortexVoice,
  CortexMood,
  CortexProvider,
} from './key-cortex.types';

export interface TurnIdentity {
  correlationId: string;
  sessionId: string;
  commandId: string;
  businessId: string;
  userId?: string | null;
}

export interface StartTurnInput {
  businessId: string;
  userId?: string | null;
  sessionId?: string | null;
  rawInput?: string;
  mode?: 'ask' | 'do' | 'plan' | 'auto';
  persona?: CortexPersona;
  provider?: CortexProvider;
  metadata?: Record<string, unknown>;
}

/**
 * W9-KEY-CORTEX-AUDIT: a tool call's input or answer as the lifecycle's ai_execution_logs row stores it.
 *
 * Review SEC-W9KCA-1: the treatment the call's CortexActionLog row gets (auditResultText, V1-19c
 * SEC-V19c-1): every value of the call's input taken out (the record ids it names kept), bounded as
 * AiExecutionLogService.sanitizePayload bounds its copy ({ _truncated, _size, _preview } past 5000
 * characters, the first 500 kept). These rows are read into prompts, business-wide where the caller
 * names no member (UnifiedMemoryRetrievalService), so the row holds nothing of a member's typed input,
 * and nothing its CortexActionLog row does not. Undefined (the column is left NULL) when the value is
 * empty or has no JSON form, so an odd payload never costs the call its row.
 */
function executionLogJson(value: unknown, input: unknown): Prisma.InputJsonValue | undefined {
  const text = auditResultText(value, input);
  return text === null ? undefined : (JSON.parse(text) as Prisma.InputJsonValue);
}

/**
 * W9-KEY-CORTEX-AUDIT review (CR-W9KCA-1): whether a tool call's AiExecutionLog row is
 * FlowOrchestratorService.executeTool's to write. A flow tool reaches the cortex registry through the
 * efferent bridge (KeyCortexEfferentBridgeService mirrors FLOW_TOOLS under their own names), which runs
 * it through executeTool, and executeTool writes that call's row (actor 'flow') for an answer and for a
 * failure. A second row here counted one call twice in every reader of the table: the hourly
 * auto-execution cap (KeyCortexExecutorService.fetchApprovalPolicy counts every success row), the
 * execution-log stats, the morning briefing's failed count and GET ai/execution-logs. A flow-named
 * call the registry answered without running it (refused, sent for approval), or one an organ
 * registered under a flow name (the bridge then leaves it to the organ), has no AiExecutionLog row,
 * as before this packet, when every recordExecution row was refused; its CortexActionLog row is
 * still written.
 */
function executionLoggedByFlow(toolName: string): boolean {
  return getToolByName(toolName) !== undefined;
}

export interface RecordExecutionInput {
  identity: TurnIdentity;
  toolName: string;
  module: string;
  riskTier: number;
  requiresApproval: boolean;
  input: Record<string, unknown>;
  output?: unknown;
  success: boolean;
  error?: string;
  durationMs: number;
  startedAt: Date;
  completedAt: Date;
  planId?: string | null;
  planStepId?: string | null;
}

@Injectable()
export class KeyCortexLifecycleService {
  private readonly logger = new Logger(KeyCortexLifecycleService.name);
  private readonly COMMAND_TTL_SECONDS = 24 * 3600;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly eventBus: KeyCortexEventBusService,
    private readonly conversation: KeyCortexConversationService,
  ) {}

  // ========================================================================
  // Identity generation
  // ========================================================================

  generateCorrelationId(): string {
    return `corr_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }

  generateCommandId(): string {
    return `cmd_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }

  // ========================================================================
  // Session helpers
  // ========================================================================

  async getOrCreateSession(input: StartTurnInput): Promise<{ session: CortexSession; isNew: boolean }> {
    if (input.sessionId) {
      const existing = await this.conversation.getSession(input.sessionId);
      if (existing) {
        return { session: existing, isNew: false };
      }
    }

    if (!input.businessId) {
      throw new Error('businessId is required to create a session');
    }

    const session = await this.conversation.createSession(
      input.businessId,
      input.userId ?? 'anonymous',
      {
        persona: input.persona,
        preferredProvider: input.provider,
      },
    );

    return { session, isNew: true };
  }

  async touchSession(sessionId: string): Promise<void> {
    await (this.prisma.client as any).cortexSession.update({
      where: { id: sessionId },
      data: { lastAccessedAt: new Date(), updatedAt: new Date() },
    });
  }

  // ========================================================================
  // Turn lifecycle
  // ========================================================================

  async startTurn(input: StartTurnInput): Promise<{ identity: TurnIdentity; session: CortexSession }> {
    const correlationId = this.generateCorrelationId();
    const commandId = this.generateCommandId();

    const { session, isNew } = await this.getOrCreateSession(input);

    const identity: TurnIdentity = {
      correlationId,
      sessionId: session.id,
      commandId,
      businessId: input.businessId,
      userId: input.userId ?? null,
    };

    // Persist identity thread on the session for this turn
    await (this.prisma.client as any).cortexSession.update({
      where: { id: session.id },
      data: {
        correlationId,
        commandId,
        lastAccessedAt: new Date(),
      },
    });

    // Create the command record
    await (this.prisma.client as any).keyCommand.create({
      data: {
        id: commandId,
        businessId: input.businessId,
        userId: input.userId ?? null,
        sessionId: session.id,
        correlationId,
        rawInput: input.rawInput ?? '',
        inputMode: 'TEXT',
        status: 'RECEIVED',
        riskLevel: 'LOW',
        autonomyLevel: 0,
        mode: input.mode ?? 'do',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    // Cache identity for downstream synchronous code paths
    await this.cacheIdentity(identity);

    // Emit lifecycle event
    this.eventBus.emit({
      source: 'key_cortex',
      type: 'cortex.turn_started',
      businessId: input.businessId,
      userId: input.userId ?? undefined,
      payload: {
        sessionId: session.id,
        commandId,
        correlationId,
        isNewSession: isNew,
        rawInput: input.rawInput,
        mode: input.mode,
        metadata: input.metadata,
      },
      metadata: {
        correlationId,
        sessionId: session.id,
        entityType: 'KeyCommand',
        entityId: commandId,
        importance: 'normal',
      },
    });

    if (isNew) {
      this.eventBus.emit({
        source: 'key_cortex',
        type: 'cortex.session_started',
        businessId: input.businessId,
        userId: input.userId ?? undefined,
        payload: {
          sessionId: session.id,
          correlationId,
          persona: session.persona,
        },
        metadata: {
          correlationId,
          sessionId: session.id,
          entityType: 'CortexSession',
          entityId: session.id,
          importance: 'normal',
        },
      });
    }

    this.logger.log(
      `[startTurn] session=${session.id} command=${commandId} correlation=${correlationId} business=${input.businessId}`,
    );

    return { identity, session };
  }

  async updateCommandStatus(
    identity: TurnIdentity,
    status: 'RECEIVED' | 'PLANNED' | 'APPROVED' | 'EXECUTED' | 'FAILED' | 'REJECTED',
    updates?: { executionResult?: Record<string, unknown>; executionLogs?: Record<string, unknown>[] },
  ): Promise<void> {
    const data: any = { status, updatedAt: new Date() };
    if (updates?.executionResult) {
      data.executionResult = updates.executionResult;
    }
    if (updates?.executionLogs) {
      data.executionLogs = updates.executionLogs;
    }

    await (this.prisma.client as any).keyCommand.update({
      where: { id: identity.commandId },
      data,
    });

    this.eventBus.emit({
      source: 'key_cortex',
      type: 'cortex.command_status_changed',
      businessId: identity.businessId,
      userId: identity.userId ?? undefined,
      payload: {
        commandId: identity.commandId,
        sessionId: identity.sessionId,
        correlationId: identity.correlationId,
        status,
      },
      metadata: {
        correlationId: identity.correlationId,
        sessionId: identity.sessionId,
        entityType: 'KeyCommand',
        entityId: identity.commandId,
        importance: status === 'FAILED' ? 'high' : 'normal',
      },
    });
  }

  async completeTurn(
    identity: TurnIdentity,
    outcome: { responseText: string; actionsExecuted: number; actionsFailed: number; autonomyApproved: number },
  ): Promise<void> {
    await this.updateCommandStatus(identity, 'EXECUTED', {
      executionResult: {
        success: outcome.actionsFailed === 0,
        responseText: outcome.responseText,
        actionsExecuted: outcome.actionsExecuted,
        actionsFailed: outcome.actionsFailed,
        autonomyApproved: outcome.autonomyApproved,
      },
    });

    await this.touchSession(identity.sessionId);

    this.eventBus.emit({
      source: 'key_cortex',
      type: 'cortex.turn_completed',
      businessId: identity.businessId,
      userId: identity.userId ?? undefined,
      payload: {
        sessionId: identity.sessionId,
        commandId: identity.commandId,
        correlationId: identity.correlationId,
        ...outcome,
      },
      metadata: {
        correlationId: identity.correlationId,
        sessionId: identity.sessionId,
        entityType: 'KeyCommand',
        entityId: identity.commandId,
        importance: outcome.actionsFailed > 0 ? 'high' : 'normal',
      },
    });

    this.logger.log(
      `[completeTurn] command=${identity.commandId} executed=${outcome.actionsExecuted} failed=${outcome.actionsFailed}`,
    );
  }

  async failTurn(identity: TurnIdentity, error: string): Promise<void> {
    await this.updateCommandStatus(identity, 'FAILED', {
      executionResult: { success: false, error },
    });

    this.eventBus.emit({
      source: 'key_cortex',
      type: 'cortex.turn_failed',
      businessId: identity.businessId,
      userId: identity.userId ?? undefined,
      payload: {
        sessionId: identity.sessionId,
        commandId: identity.commandId,
        correlationId: identity.correlationId,
        error,
      },
      metadata: {
        correlationId: identity.correlationId,
        sessionId: identity.sessionId,
        entityType: 'KeyCommand',
        entityId: identity.commandId,
        importance: 'high',
      },
    });

    this.logger.error(`[failTurn] command=${identity.commandId} error=${error}`);
  }

  // ========================================================================
  // Execution / audit logging
  // ========================================================================

  async recordExecution(input: RecordExecutionInput): Promise<void> {
    const { identity } = input;
    const now = new Date();

    // W9-KEY-CORTEX-AUDIT: only columns AiExecutionLog has. The write named startedAt, which the model
    // does not have, so Prisma refused every row, recordExecution rejected and cortex.action_executed
    // was never emitted. The call's timing is durationMs here (and startedAt/completedAt on its
    // CortexActionLog row). Review SEC-W9KCA-1: the input, answer and error are stored as the call's
    // CortexActionLog row stores them (the input's values taken out, bounded). Review CR-W9KCA-1: a
    // bridged flow tool's row is FlowOrchestratorService.executeTool's, so none is written here.
    const executionLogPromise = executionLoggedByFlow(input.toolName)
      ? Promise.resolve()
      : (this.prisma.client as any).aiExecutionLog.create({
          data: {
            businessId: identity.businessId,
            userId: identity.userId ?? null,
            sessionId: identity.sessionId,
            commandId: identity.commandId,
            correlationId: identity.correlationId,
            action: input.toolName,
            toolName: input.toolName,
            module: input.module,
            riskTier: input.riskTier,
            success: input.success,
            errorMessage: auditErrorText(input.error, input.input) ?? undefined,
            inputSummary: executionLogJson(input.input, input.input),
            outputSummary: executionLogJson(input.output, input.input),
            durationMs: input.durationMs,
            planId: input.planId ?? null,
            planStepId: input.planStepId ?? null,
            actor: 'key_cortex',
          },
        });

    const actionLogPromise = this.recordActionLog(input, now);

    // Both writes settle before this answers (V1-19c): Promise.all rejected on
    // the first failure while the other write was still in flight, so a caller
    // could not know whether the CortexActionLog row had been written yet.
    const settled = await Promise.allSettled([executionLogPromise, actionLogPromise]);
    const failed = settled.find((s): s is PromiseRejectedResult => s.status === 'rejected');
    if (failed) throw failed.reason;

    this.eventBus.emit({
      source: input.module,
      type: input.success ? 'cortex.action_executed' : 'cortex.action_failed',
      businessId: identity.businessId,
      userId: identity.userId ?? undefined,
      payload: {
        sessionId: identity.sessionId,
        commandId: identity.commandId,
        correlationId: identity.correlationId,
        toolName: input.toolName,
        module: input.module,
        riskTier: input.riskTier,
        durationMs: input.durationMs,
        success: input.success,
        // Review SEC-W9KCA-1: the bus persists this payload to business_events and cognitive_events, both
        // read into prompts business-wide: the error as the rows store it, the input's values taken out.
        error: auditErrorText(input.error, input.input) ?? undefined,
      },
      metadata: {
        correlationId: identity.correlationId,
        sessionId: identity.sessionId,
        entityType: 'AiExecutionLog',
        importance: input.success ? 'normal' : 'high',
      },
    });
  }

  /**
   * The CortexActionLog row of a tool call the tool loop records, unless the
   * registry already wrote it (V1-19c).
   *
   * KeyCortexToolLoopService calls this right after
   * KeyCortexToolRegistryService.execute for the same call, and the registry
   * writes the CortexActionLog row of every execution it runs, awaited before
   * execute() answers. Writing here too would make every tool-loop execution
   * two rows. So the row is written only when no registry row of this call
   * exists: same business, tool and outcome, started inside this call's
   * window, and the same command thread (correlationId). That keeps the
   * record of a call the registry answered without running the tool (not
   * found, refused, invalid input), which only this row records. A failed
   * lookup writes the row: a duplicate is better than a lost record.
   *
   * A tool loop with no turn identity (lifecycle.startTurn threw) runs the
   * tool with no command thread, so the registry's row has correlationId null
   * and sessionId 'unknown', and then gives this record a correlationId it
   * made up afterwards (V1-19c review, CR-V19c-1: the lookup missed and the
   * call got two rows). A thread-less registry row of the same session (and
   * the same user, when this record names one) is that call's row too.
   *
   * The stored answer and error get the registry row's treatment: the call's
   * input taken out, bounded (auditResultText, auditErrorText; SEC-V19c-1).
   */
  private async recordActionLog(input: RecordExecutionInput, now: Date): Promise<void> {
    const { identity } = input;
    const status = input.success ? 'success' : 'error';
    let auditedByRegistry = false;
    try {
      const existing = await this.prisma.client.cortexActionLog.findFirst({
        where: {
          businessId: identity.businessId,
          actionType: input.toolName,
          status,
          startedAt: { gte: input.startedAt, lte: input.completedAt },
          OR: [
            { correlationId: identity.correlationId },
            {
              correlationId: null,
              sessionId: identity.sessionId,
              ...(identity.userId ? { userId: identity.userId } : {}),
            },
          ],
        },
        select: { id: true },
      });
      auditedByRegistry = Boolean(existing);
    } catch (err) {
      this.logger.warn(
        `[recordExecution][${identity.businessId}] could not check for the registry's CortexActionLog row: ${(err as Error).message}`,
      );
    }
    if (auditedByRegistry) return;

    await this.prisma.client.cortexActionLog.create({
      data: {
        sessionId: identity.sessionId,
        businessId: identity.businessId,
        userId: identity.userId ?? null,
        commandId: identity.commandId,
        correlationId: identity.correlationId,
        actionType: input.toolName,
        status,
        description: `${input.module}.${input.toolName}`,
        result: input.success ? auditResultText(input.output, input.input) : null,
        error: auditErrorText(input.error, input.input),
        requiresApproval: input.requiresApproval,
        startedAt: input.startedAt,
        completedAt: input.completedAt,
        durationMs: input.durationMs,
        createdAt: now,
      },
    });
  }

  // ========================================================================
  // Identity cache (for synchronous downstream lookups)
  // ========================================================================

  private async cacheIdentity(identity: TurnIdentity): Promise<void> {
    try {
      await this.redis.set(
        `cortex:identity:${identity.correlationId}`,
        JSON.stringify(identity),
        this.COMMAND_TTL_SECONDS,
      );
    } catch (err) {
      this.logger.warn(`[cacheIdentity] ${(err as Error).message}`);
    }
  }

  async getIdentityByCorrelationId(correlationId: string): Promise<TurnIdentity | null> {
    try {
      const raw = await this.redis.get(`cortex:identity:${correlationId}`);
      if (!raw) return null;
      return JSON.parse(raw) as TurnIdentity;
    } catch (err) {
      this.logger.warn(`[getIdentityByCorrelationId] ${(err as Error).message}`);
      return null;
    }
  }
}
