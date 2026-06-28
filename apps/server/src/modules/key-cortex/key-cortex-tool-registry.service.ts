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

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { KeyAutonomySafetyService } from '../key-autonomy/key-autonomy-safety.service';
import { KeyIdempotencyService } from './key-idempotency.service';
import { KeyCortexSagaService } from './key-cortex-saga.service';
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

@Injectable()
export class KeyCortexToolRegistryService {
  private readonly logger = new Logger(KeyCortexToolRegistryService.name);
  private readonly tools = new Map<string, KeyCortexToolDefinition>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly safety: KeyAutonomySafetyService,
    private readonly idempotency: KeyIdempotencyService,
    private readonly saga: KeyCortexSagaService,
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

    // Phase 0: global autonomy kill switch and safety limits are the first gate.
    const safetyCheck = await this.safety.check({
      businessId: ctx.businessId,
      toolName: name,
      riskTier: tool.riskTier,
      mode: ctx.autonomyLevel && ctx.autonomyLevel >= 2 ? 'auto' : 'manual',
      estimatedCostTtd: 0,
    });
    if (!safetyCheck.allowed) {
      this.logger.warn(`[execute][${ctx.businessId}] Safety gate blocked ${name}: ${safetyCheck.reason}`);
      return { success: false, error: safetyCheck.reason ?? 'Blocked by autonomy safety gate' };
    }

    const validation = this.validateInput(tool, input);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    const riskCheck = this.checkRisk(tool, ctx.autonomyLevel ?? 0);
    if (!riskCheck.allowed) {
      return { success: false, error: riskCheck.reason };
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
          tool.compensation
            ? {
                stepName: name,
                action: tool.compensation.action,
                payload: tool.compensation.payload,
              }
            : undefined,
        );
      }

      const result = await tool.handler(ctx, validation.parsed);
      const durationMs = Date.now() - startMs;

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
      return result;
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      const durationMs = Date.now() - startMs;
      const result: KeyCortexToolResult = { success: false, error: err.message };

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
  // Risk / Approval helpers
  // ========================================================================

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
}
