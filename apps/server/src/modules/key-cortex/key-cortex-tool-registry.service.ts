/**
 * KEY Cortex — Canonical Tool Registry
 *
 * The single source of truth for every action/tool KEY can execute.
 * Organs, muscles, and modules register tools here at boot time.
 * The reasoning brain queries this registry to decide what KEY can do,
 * and the executor invokes tools through this registry.
 *
 * Design principles:
 * - One registry, many adapters (organs register tools at module init).
 * - Every tool declares its schema, risk tier, and approval requirements.
 * - Execution is audited and wrapped with uniform error handling.
 */

import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { KeyAutonomySafetyService } from '../key-autonomy/key-autonomy-safety.service';
import { KeyActionProposalService } from '../key-autonomy/key-action-proposal.service';
import { KeyIdempotencyService } from './key-idempotency.service';
import { KeyCortexSagaService } from './key-cortex-saga.service';
import { KeyCortexCompensationService } from './key-cortex-compensation.service';
import { KeyCortexLearningService } from './key-cortex-learning.service';
import { KeyCortexAuditService } from './key-cortex-audit.service';
import { KeyCortexEventBusService } from './key-cortex-event-bus.service';
import { GatewayToolDefinition } from './key-cortex.types';

export interface KeyCortexToolContext {
  businessId: string;
  userId?: string;
  sessionId?: string;
  commandId?: string;
  autonomyLevel?: number;
  correlationId?: string;
  idempotencyKey?: string;
  sagaId?: string;
  /**
   * Set ONLY when a human has already approved this exact action.
   *
   * checkRisk answers "may KEY do this on its own?" — a question an approved
   * proposal has already answered with human authority, so it is skipped here.
   * Without this, a tier-3 tool could never execute at all: checkRisk refuses
   * tier 3 at EVERY autonomy level, so approving a proposal sent it back
   * through the same gate, which refused it and filed another proposal. An
   * infinite approval loop, and the user never got the action they authorised.
   *
   * It does NOT bypass KeyAutonomySafetyService. The kill switch, the daily
   * action cap and the spend cap still apply — an operator killing autonomy
   * must outrank an approval granted five minutes earlier.
   */
  preApproved?: boolean;
}

export interface KeyCortexToolCompensation {
  action: string;
  payload: Record<string, unknown>;
}

export interface KeyCortexToolResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  costTtd?: number;
  requiresApproval?: boolean;
}

export interface KeyCortexToolDefinition {
  /** Fully-qualified tool name, e.g. "cortex.create_task" or "inbox.send_reply" */
  name: string;
  /** Organ/module that owns this tool */
  module: string;
  /** Human-readable description for the AI */
  description: string;
  /** JSON Schema parameters object */
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
  };
  /** Risk tier: 1=low, 2=medium, 3=high, 4=critical */
  riskTier: 1 | 2 | 3 | 4;
  /** Whether this tool requires explicit user approval before execution */
  requiresApproval: boolean;
  /** Optional tags for grouping/role filtering */
  tags?: string[];
  /** Optional compensation action for rollback */
  compensation?: KeyCortexToolCompensation;
  /** Handler that performs the actual work */
  handler: (
    ctx: KeyCortexToolContext,
    input: Record<string, unknown>,
  ) => Promise<KeyCortexToolResult>;
}

export interface KeyCortexToolMetadata {
  name: string;
  module: string;
  description: string;
  parameters: KeyCortexToolDefinition['parameters'];
  riskTier: KeyCortexToolDefinition['riskTier'];
  requiresApproval: boolean;
  tags?: string[];
}

export interface KeyCortexToolScore {
  successRate: number;
  avgDurationMs: number;
  totalUses: number;
}

@Injectable()
export class KeyCortexToolRegistryService {
  private readonly logger = new Logger(KeyCortexToolRegistryService.name);
  private readonly tools = new Map<string, KeyCortexToolDefinition>();
  private readonly outcomes = new Map<
    string,
    { successes: number; failures: number; totalDurationMs: number; lastUsedAt: Date }
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly safety: KeyAutonomySafetyService,
    private readonly idempotency: KeyIdempotencyService,
    private readonly saga: KeyCortexSagaService,
    @Optional()
    private readonly learning?: KeyCortexLearningService,
    @Optional()
    private readonly auditService?: KeyCortexAuditService,
    @Optional()
    private readonly eventBus?: KeyCortexEventBusService,
    @Optional()
    private readonly proposals?: KeyActionProposalService,
    // APPENDED, never inserted. Every spec in this repo constructs services
    // positionally, so adding a parameter mid-list silently shifts every
    // argument after it — which is how peekBody stopped being called once
    // already, with no symptom other than a feature quietly not happening.
    @Optional()
    private readonly compensation?: KeyCortexCompensationService,
  ) {}

  // ========================================================================
  // Registration
  // ========================================================================

  register(tool: KeyCortexToolDefinition): void {
    if (!tool.name || !tool.module) {
      throw new Error(`Tool must have a name and module: ${JSON.stringify(tool)}`);
    }
    if (this.tools.has(tool.name)) {
      this.logger.warn(`Tool "${tool.name}" is being overwritten in the canonical registry`);
    }
    this.tools.set(tool.name, tool);
  }

  registerMany(tools: KeyCortexToolDefinition[]): void {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  // ========================================================================
  // Lookup
  // ========================================================================

  getTool(name: string): KeyCortexToolDefinition | undefined {
    return this.tools.get(name);
  }

  hasTool(name: string): boolean {
    return this.tools.has(name);
  }

  listTools(filter?: { module?: string; tags?: string[] }): KeyCortexToolMetadata[] {
    let tools = Array.from(this.tools.values());
    if (filter?.module) {
      tools = tools.filter((t) => t.module === filter.module);
    }
    if (filter?.tags && filter.tags.length > 0) {
      tools = tools.filter((t) => filter.tags!.some((tag) => t.tags?.includes(tag)));
    }
    return tools.map((t) => this.toMetadata(t));
  }

  listModules(): string[] {
    return Array.from(new Set(Array.from(this.tools.values()).map((t) => t.module)));
  }

  // ========================================================================
  // Execution
  // ========================================================================

  /**
   * How this step would be undone, recorded BEFORE it runs.
   *
   * Two sources, in priority order. A tool that declares its own compensation
   * wins — nothing does today, but the field is part of the definition and a
   * hand-written one should beat a table lookup. Otherwise ask
   * KeyCortexCompensationService what reverses this tool.
   *
   * That second source is the one that was missing, and its absence was total:
   * `tool.compensation` is set by no tool anywhere, and the only code that ever
   * built a compensation from the table lives in KeyCortexSagaExecutorService,
   * which has no callers. So every saga step in production stored
   * `compensationAction: null`, every rollback found nothing to run, and the
   * saga was recorded `compensation_unavailable`. Every limb that moves money,
   * mail or bookings had no undo, and this is the line where that was decided.
   *
   * Recorded before execution rather than after, deliberately: a step that
   * crashes mid-write is exactly the one that needs undoing, and a compensation
   * written on the success path would not exist for it.
   *
   * Returning undefined is a real answer — this tool has no known reversal —
   * and the saga service records that distinctly instead of claiming a rollback.
   */
  private compensationFor(
    name: string,
    ctx: KeyCortexToolContext,
    input: Record<string, unknown>,
  ): { stepName: string; action: string; payload: Record<string, unknown> } | undefined {
    const tool = this.tools.get(name);

    if (tool?.compensation) {
      return {
        stepName: name,
        action: tool.compensation.action,
        payload: tool.compensation.payload,
      };
    }

    const action = this.compensation?.getCompensatingAction(name);
    if (!action) return undefined;

    // businessId LAST so it wins: a tool argument of the same name must not be
    // able to point the rollback at another tenant.
    return { stepName: name, action, payload: { ...input, businessId: ctx.businessId } };
  }

  async execute(
    name: string,
    ctx: KeyCortexToolContext,
    input: Record<string, unknown> = {},
  ): Promise<KeyCortexToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { success: false, error: `Tool "${name}" not found in canonical registry` };
    }

    // Phase 0: idempotency gate — return cached outcome for duplicate keys.
    if (ctx.idempotencyKey) {
      const cached = await this.idempotency.check({
        businessId: ctx.businessId,
        idempotencyKey: ctx.idempotencyKey,
        requestHash: this.hashRequest(name, input),
      });
      if (cached.status === 'completed') {
        return { success: true, data: cached.response as any };
      }
      if (cached.status === 'failed') {
        return { success: false, error: cached.error ?? 'Duplicate request failed previously' };
      }
    }

    // Phase 0: global autonomy kill switch, safety limits, and tier enforcement
    // are the first gate.
    const safetyCheck = await this.safety.check({
      businessId: ctx.businessId,
      toolName: name,
      riskTier: tool.riskTier,
      mode: ctx.autonomyLevel && ctx.autonomyLevel >= 2 ? 'auto' : 'manual',
      estimatedCostTtd: 0,
    });
    if (!safetyCheck.allowed) {
      this.logger.warn(`[execute][${ctx.businessId}] Safety gate blocked ${name}: ${safetyCheck.reason}`);
      const blocked: KeyCortexToolResult = {
        success: false,
        error: safetyCheck.reason ?? 'Blocked by autonomy safety gate',
        requiresApproval: safetyCheck.requiresApproval,
      };
      await this.emitBusinessEvent(ctx, name, input, blocked, 0).catch((err) => {
        this.logger.warn(`Tool business-event emit failed: ${(err as Error).message}`);
      });
      return blocked;
    }

    const validation = this.validateInput(tool, input);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    // An approved action skips the autonomy threshold — a human already
    // granted the authority checkRisk exists to withhold. Skipping the whole
    // branch also breaks the loop: re-entering it would file a second proposal
    // for an action that was already approved.
    const riskCheck = ctx.preApproved
      ? { allowed: true as const, reason: undefined }
      : this.checkRisk(tool, ctx.autonomyLevel ?? 0);
    if (!riskCheck.allowed) {
      // A refusal used to end here. The tier-3 message even said the tool
      // "requires explicit user approval" — and then there was no way to ask
      // for any. KEY could decline, never request. That is a brain with an
      // inhibitory gate and no voluntary pathway around it.
      //
      // Tier 4 stays a hard refusal: critical actions are not delegated to a
      // request. Everything else becomes a proposal a human can approve, and
      // approving it now genuinely executes — KeyCortexActionExecutorPlugin
      // dispatches to the right registry with the right payload key, which it
      // did not do until recently.
      if (tool.riskTier < 4) {
        const proposalId = await this.proposeForApproval(tool, ctx, input, riskCheck.reason);
        if (proposalId) {
          return {
            success: false,
            requiresApproval: true,
            error: `${riskCheck.reason} — sent for approval`,
            data: { proposalId } as KeyCortexToolResult['data'],
          };
        }
      }
      return { success: false, error: riskCheck.reason, requiresApproval: tool.riskTier < 4 };
    }

    const startMs = Date.now();
    let sagaStepIndex: number | undefined;
    try {
      if (ctx.sagaId) {
        sagaStepIndex = Date.now();
        await this.saga.addStep(
          ctx.sagaId,
          sagaStepIndex,
          name,
          input,
          this.compensationFor(name, ctx, input),
        );
      }

      const result = await tool.handler(ctx, validation.parsed);
      const durationMs = Date.now() - startMs;

      this.recordToolOutcome(name, result.success, durationMs, ctx.businessId);
      await this.recordLearningOutcome(ctx, name, result.success, result.error, durationMs).catch((err) => {
        this.logger.warn(`Learning outcome recording failed: ${(err as Error).message}`);
      });

      if (ctx.sagaId && sagaStepIndex !== undefined) {
        await this.saga.completeStep(ctx.sagaId, sagaStepIndex, result as any).catch((err) => {
          this.logger.warn(`Saga step completion failed: ${(err as Error).message}`);
        });
      }

      // Record successful autonomous execution against daily limits.
      if (safetyCheck.allowed) {
        await this.safety
          .recordExecution({
            businessId: ctx.businessId,
            toolName: name,
            riskTier: tool.riskTier,
            mode: ctx.autonomyLevel && ctx.autonomyLevel >= 2 ? 'auto' : 'manual',
            actualCostTtd: result.costTtd,
          })
          .catch((err) => {
            this.logger.warn(`Safety record failed: ${(err as Error).message}`);
          });
      }

      if (ctx.idempotencyKey) {
        await this.idempotency.complete(
          { businessId: ctx.businessId, idempotencyKey: ctx.idempotencyKey },
          result,
        );
      }

      await this.audit(ctx, name, input, result, durationMs).catch((err) => {
        this.logger.warn(`Tool audit failed: ${(err as Error).message}`);
      });
      await this.emitBusinessEvent(ctx, name, input, result, durationMs).catch((err) => {
        this.logger.warn(`Tool business-event emit failed: ${(err as Error).message}`);
      });
      return result;
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      const durationMs = Date.now() - startMs;
      const result: KeyCortexToolResult = { success: false, error: err.message };

      this.recordToolOutcome(name, false, durationMs, ctx.businessId);
      await this.recordLearningOutcome(ctx, name, false, err.message, durationMs).catch((learnErr) => {
        this.logger.warn(`Learning outcome recording failed: ${(learnErr as Error).message}`);
      });

      if (ctx.sagaId && sagaStepIndex !== undefined) {
        await this.saga.failStep(ctx.sagaId, sagaStepIndex, err.message).catch((sagaErr) => {
          this.logger.warn(`Saga step failure logging failed: ${(sagaErr as Error).message}`);
        });
        if (tool.compensation) {
          await this.saga.compensate(ctx.sagaId).catch((compErr) => {
            this.logger.warn(`Saga compensation failed: ${(compErr as Error).message}`);
          });
        }
      }

      if (ctx.idempotencyKey) {
        await this.idempotency.fail(
          { businessId: ctx.businessId, idempotencyKey: ctx.idempotencyKey },
          err.message,
        );
      }

      await this.audit(ctx, name, input, result, durationMs).catch((auditErr) => {
        this.logger.warn(`Tool audit failed: ${(auditErr as Error).message}`);
      });
      await this.emitBusinessEvent(ctx, name, input, result, durationMs).catch((err) => {
        this.logger.warn(`Tool business-event emit failed: ${(err as Error).message}`);
      });
      return result;
    }
  }

  // ========================================================================
  // AI Gateway Tool Definitions
  // ========================================================================

  buildGatewayDefinitions(filter?: { module?: string; tags?: string[] }): GatewayToolDefinition[] {
    const tools = this.listTools(filter);
    return tools.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
  }

  // ========================================================================
  // Tool success scoring (Phase D.3)
  // ========================================================================

  recordToolOutcome(toolName: string, success: boolean, durationMs: number, businessId?: string): void {
    const existing = this.outcomes.get(toolName) ?? {
      successes: 0,
      failures: 0,
      totalDurationMs: 0,
      lastUsedAt: new Date(),
    };

    if (success) {
      existing.successes++;
    } else {
      existing.failures++;
    }
    existing.totalDurationMs += durationMs;
    existing.lastUsedAt = new Date();

    this.outcomes.set(toolName, existing);

    if (businessId) {
      this.persistToolOutcomeScore(businessId, toolName, success, durationMs).catch((err) => {
        this.logger.warn(`[recordToolOutcome] Persist failed: ${(err as Error).message}`);
      });
    }
  }

  async getToolScoreForBusiness(
    businessId: string,
    toolName: string,
  ): Promise<KeyCortexToolScore> {
    const row = await this.prisma.client.toolOutcomeScore.findUnique({
      where: { businessId_toolName: { businessId, toolName } },
    });
    if (!row) {
      return { successRate: 0, avgDurationMs: 0, totalUses: 0 };
    }
    const totalUses = row.successCount + row.failureCount;
    return {
      successRate: totalUses > 0 ? row.successCount / totalUses : 0,
      avgDurationMs: row.avgExecutionMs ?? 0,
      totalUses,
    };
  }

  private async persistToolOutcomeScore(
    businessId: string,
    toolName: string,
    success: boolean,
    durationMs: number,
  ): Promise<void> {
    const existing = await this.prisma.client.toolOutcomeScore.findUnique({
      where: { businessId_toolName: { businessId, toolName } },
    });

    const successCount = (existing?.successCount ?? 0) + (success ? 1 : 0);
    const failureCount = (existing?.failureCount ?? 0) + (success ? 0 : 1);
    const totalUses = successCount + failureCount;
    const avgExecutionMs =
      existing?.avgExecutionMs != null
        ? Math.round((existing.avgExecutionMs * (totalUses - 1) + durationMs) / totalUses)
        : durationMs;

    await this.prisma.client.toolOutcomeScore.upsert({
      where: { businessId_toolName: { businessId, toolName } },
      create: {
        businessId,
        toolName,
        successCount,
        failureCount,
        avgExecutionMs,
      },
      update: {
        successCount,
        failureCount,
        avgExecutionMs,
      },
    });
  }

  getToolScore(toolName: string): KeyCortexToolScore {
    const stats = this.outcomes.get(toolName);
    if (!stats) {
      return { successRate: 0, avgDurationMs: 0, totalUses: 0 };
    }

    const totalUses = stats.successes + stats.failures;
    return {
      successRate: totalUses > 0 ? stats.successes / totalUses : 0,
      avgDurationMs: totalUses > 0 ? Math.round(stats.totalDurationMs / totalUses) : 0,
      totalUses,
    };
  }

  getAllToolScores(): Record<string, KeyCortexToolScore> {
    const scores: Record<string, KeyCortexToolScore> = {};
    for (const toolName of this.tools.keys()) {
      scores[toolName] = this.getToolScore(toolName);
    }
    for (const toolName of this.outcomes.keys()) {
      if (!scores[toolName]) {
        scores[toolName] = this.getToolScore(toolName);
      }
    }
    return scores;
  }

  private async recordLearningOutcome(
    ctx: KeyCortexToolContext,
    toolName: string,
    success: boolean,
    error: string | undefined,
    durationMs: number,
  ): Promise<void> {
    if (!this.learning) return;

    await this.learning.recordOutcome({
      businessId: ctx.businessId,
      sessionId: ctx.sessionId ?? ctx.correlationId ?? `tool_${toolName}_${Date.now()}`,
      toolName,
      success,
      error,
      durationMs,
      metadata: {
        commandId: ctx.commandId,
        autonomyLevel: ctx.autonomyLevel,
        sagaId: ctx.sagaId,
      },
    });
  }

  // ========================================================================
  // Risk / Approval helpers
  // ========================================================================

  /**
   * Turn a refusal into a request.
   *
   * The payload shape is the contract KeyCortexActionExecutorPlugin reads back
   * on approval: `toolName` plus `inputPayload`. Getting either wrong means the
   * proposal is approved and then fails silently, which is exactly what used to
   * happen — the plugin read `payload.parameters` while the planner wrote
   * `payload.inputPayload`, so every approved action executed with `{}`.
   *
   * Never throws. A proposal that cannot be filed must degrade to the original
   * refusal, not turn a blocked action into an error the caller cannot read.
   */
  private async proposeForApproval(
    tool: KeyCortexToolDefinition,
    ctx: KeyCortexToolContext,
    input: Record<string, unknown>,
    reason?: string,
  ): Promise<string | null> {
    if (!this.proposals) return null;

    try {
      const proposal = await this.proposals.create(
        ctx.businessId,
        {
          sourceType: 'KEY_CORTEX',
          sourceId: ctx.correlationId ?? ctx.sessionId,
          title: `${tool.name}`,
          summary: tool.description,
          rationale: reason,
          actionType: 'EXECUTE_TOOL',
          toolName: tool.name,
          module: tool.module,
          payload: {
            toolName: tool.name,
            inputPayload: input,
          },
        },
        ctx.userId,
      );

      this.logger.log(
        `[execute][${ctx.businessId}] ${tool.name} exceeded autonomy — proposal ${proposal.id} filed for approval`,
      );
      return proposal.id;
    } catch (err: unknown) {
      this.logger.warn(
        `[execute][${ctx.businessId}] could not file approval for ${tool.name}: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  checkRisk(
    tool: KeyCortexToolDefinition,
    autonomyLevel: number,
  ): { allowed: boolean; reason?: string } {
    if (tool.riskTier === 4) {
      return { allowed: false, reason: `CRITICAL risk tool "${tool.name}" is blocked from AI execution` };
    }
    if (tool.riskTier === 3) {
      return { allowed: false, reason: `HIGH risk tool "${tool.name}" requires explicit user approval` };
    }
    if (tool.riskTier === 2 && autonomyLevel < 4) {
      return { allowed: false, reason: `MEDIUM risk tool "${tool.name}" requires TRUSTED_AUTOPILOT autonomy` };
    }
    if (tool.riskTier === 1 && autonomyLevel < 2) {
      return { allowed: false, reason: `LOW risk tool "${tool.name}" requires INTERNAL_EXEC autonomy or higher` };
    }
    return { allowed: true };
  }

  // ========================================================================
  // Statistics
  // ========================================================================

  getStats(): { total: number; byModule: Record<string, number>; byRiskTier: Record<string, number> } {
    const byModule: Record<string, number> = {};
    const byRiskTier: Record<string, number> = { '1': 0, '2': 0, '3': 0, '4': 0 };
    for (const tool of this.tools.values()) {
      byModule[tool.module] = (byModule[tool.module] ?? 0) + 1;
      byRiskTier[tool.riskTier] = (byRiskTier[tool.riskTier] ?? 0) + 1;
    }
    return { total: this.tools.size, byModule, byRiskTier };
  }

  // ========================================================================
  // Private helpers
  // ========================================================================

  private toMetadata(tool: KeyCortexToolDefinition): KeyCortexToolMetadata {
    return {
      name: tool.name,
      module: tool.module,
      description: tool.description,
      parameters: tool.parameters,
      riskTier: tool.riskTier,
      requiresApproval: tool.requiresApproval,
      tags: tool.tags,
    };
  }

  private hashRequest(name: string, input: Record<string, unknown>): string {
    try {
      const payload = JSON.stringify({ name, input });
      let hash = 0;
      for (let i = 0; i < payload.length; i++) {
        const char = payload.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash |= 0;
      }
      return hash.toString(16);
    } catch {
      return '0';
    }
  }

  private validateInput(
    tool: KeyCortexToolDefinition,
    input: Record<string, unknown>,
  ): { valid: true; parsed: Record<string, unknown> } | { valid: false; error: string } {
    const required = tool.parameters.required ?? [];
    const missing = required.filter((key) => input[key] === undefined);
    if (missing.length > 0) {
      return { valid: false, error: `Missing required parameters: ${missing.join(', ')}` };
    }
    return { valid: true, parsed: input };
  }

  private async audit(
    ctx: KeyCortexToolContext,
    toolName: string,
    input: Record<string, unknown>,
    result: KeyCortexToolResult,
    durationMs: number,
  ): Promise<void> {
    try {
      await (this.prisma.client as any).cortexActionLog.create({
        data: {
          sessionId: ctx.sessionId ?? ctx.correlationId ?? 'unknown',
          actionType: toolName,
          status: result.success ? 'success' : 'error',
          description: result.success
            ? `Executed tool ${toolName}`
            : `Tool ${toolName} failed: ${result.error}`,
          result: result.data ? JSON.stringify(result.data) : null,
          error: result.error ?? null,
          businessId: ctx.businessId,
          userId: ctx.userId ?? null,
          metadata: {
            input,
            durationMs,
            autonomyLevel: ctx.autonomyLevel,
          } as any,
          createdAt: new Date(),
        },
      });
    } catch (err: unknown) {
      this.logger.error(`Failed to audit tool execution: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Emit a canonical BusinessEvent for every tool execution attempt.
   * Prefers KeyCortexAuditService (unified audit ledger) and falls back to
   * the KeyCortexEventBusService if the audit service is unavailable.
   */
  private async emitBusinessEvent(
    ctx: KeyCortexToolContext,
    toolName: string,
    input: Record<string, unknown>,
    result: KeyCortexToolResult,
    durationMs: number,
  ): Promise<void> {
    const actorId = ctx.userId ?? 'key_ai';
    const metadata: Record<string, unknown> = {
      module: toolName.split('.')[0] ?? 'cortex',
      input,
      durationMs,
      autonomyLevel: ctx.autonomyLevel,
      riskTier: this.tools.get(toolName)?.riskTier,
      requiresApproval: result.requiresApproval ?? false,
    };

    if (this.auditService) {
      await this.auditService.emit(
        result.success ? 'ACTION_EXECUTED' : 'ACTION_FAILED',
        toolName,
        'tool_execution',
        ctx.commandId ?? ctx.correlationId ?? ctx.sessionId ?? toolName,
        {
          businessId: ctx.businessId,
          actorType: ctx.userId ? 'human' : 'ai',
          actorId,
          source: 'ai',
          sessionId: ctx.sessionId,
          commandId: ctx.commandId,
          correlationId: ctx.correlationId,
          proposalId: (ctx as any).proposalId,
          metadata,
        },
        { status: 'attempted' },
        {
          status: result.success ? 'success' : 'error',
          result: result.data,
          error: result.error,
          durationMs,
        },
      );
      return;
    }

    if (this.eventBus) {
      this.eventBus.emit({
        source: 'key_cortex_tool_registry',
        type: result.success ? 'tool.executed' : 'tool.failed',
        businessId: ctx.businessId,
        userId: actorId,
        payload: {
          toolName,
          success: result.success,
          result: result.data,
          error: result.error,
          input,
          durationMs,
        },
        metadata: {
          correlationId: ctx.correlationId,
          sessionId: ctx.sessionId,
          commandId: ctx.commandId,
          entityType: 'tool_execution',
          entityId: ctx.commandId ?? ctx.correlationId ?? ctx.sessionId ?? toolName,
        },
      });
    }
  }
}
