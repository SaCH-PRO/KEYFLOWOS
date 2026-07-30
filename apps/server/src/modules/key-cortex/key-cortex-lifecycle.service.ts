/**
 * KEY Cortex Lifecycle Service (Phase 3 Skeleton)
 *
 * Owns the cross-cutting identity thread and lifecycle state for every
 * KEY Cortex turn. It wraps KeyCortexConversationService and becomes the
 * single place where sessions, commands, execution logs, and audit events
 * are created with consistent correlationId/sessionId/commandId linkage.
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { RedisService } from '../../core/redis/redis.service';
import { KeyCortexEventBusService } from './key-cortex-event-bus.service';
import { KeyCortexConversationService } from './key-cortex-conversation.service';
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

    const executionLogPromise = (this.prisma.client as any).aiExecutionLog.create({
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
        errorMessage: input.error,
        inputSummary: input.input as any,
        outputSummary: input.output as any,
        durationMs: input.durationMs,
        startedAt: input.startedAt,
        planId: input.planId ?? null,
        planStepId: input.planStepId ?? null,
        actor: 'key_cortex',
      },
    });

    const actionLogPromise = (this.prisma.client as any).cortexActionLog.create({
      data: {
        sessionId: identity.sessionId,
        businessId: identity.businessId,
        userId: identity.userId ?? null,
        commandId: identity.commandId,
        correlationId: identity.correlationId,
        actionType: input.toolName,
        status: input.success ? 'success' : 'error',
        description: `${input.module}.${input.toolName}`,
        result: input.success ? JSON.stringify(input.output) : undefined,
        error: input.error,
        requiresApproval: input.requiresApproval,
        startedAt: input.startedAt,
        completedAt: input.completedAt,
        durationMs: input.durationMs,
        createdAt: now,
      },
    });

    await Promise.all([executionLogPromise, actionLogPromise]);

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
        error: input.error,
      },
      metadata: {
        correlationId: identity.correlationId,
        sessionId: identity.sessionId,
        entityType: 'AiExecutionLog',
        importance: input.success ? 'normal' : 'high',
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
