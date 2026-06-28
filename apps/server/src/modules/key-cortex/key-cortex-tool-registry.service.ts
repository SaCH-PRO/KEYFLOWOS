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
import { GatewayToolDefinition } from './key-cortex.types';

export interface KeyCortexToolContext {
  businessId: string;
  userId?: string;
  sessionId?: string;
  commandId?: string;
  autonomyLevel?: number;
  correlationId?: string;
}

export interface KeyCortexToolResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
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

  constructor(private readonly prisma: PrismaService) {}

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

    const validation = this.validateInput(tool, input);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    const riskCheck = this.checkRisk(tool, ctx.autonomyLevel ?? 0);
    if (!riskCheck.allowed) {
      return { success: false, error: riskCheck.reason };
    }

    const startMs = Date.now();
    try {
      const result = await tool.handler(ctx, validation.parsed);
      const durationMs = Date.now() - startMs;
      await this.audit(ctx, name, input, result, durationMs).catch((err) => {
        this.logger.warn(`Tool audit failed: ${(err as Error).message}`);
      });
      return result;
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      const durationMs = Date.now() - startMs;
      const result: KeyCortexToolResult = { success: false, error: err.message };
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
