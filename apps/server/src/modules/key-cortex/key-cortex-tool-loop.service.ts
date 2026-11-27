import { Injectable, Logger, Inject, Optional } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { ModelGatewayService, GatewayMessage, TaskCategory } from '../ai/model-gateway.service';
import { KeyCortexToolRegistryService } from './key-cortex-tool-registry.service';
import { KeyCortexLifecycleService } from './key-cortex-lifecycle.service';
import { RouteDecision } from './adaptive-router.service';
import { CortexQuery, CortexActionResult, CortexActionType } from './key-cortex.types';
import { AutonomyOrchestratorService } from '../key-autonomy/autonomy-orchestrator.service';
import { KeyAutonomySafetyService } from '../key-autonomy/key-autonomy-safety.service';
import { AutonomyLevelService } from '../key-autonomy/autonomy-level.service';
import { v1ToolRefusalReason } from '../ai/v1-tool-allowlist';

/**
 * Executes the LLM ↔ tool-call loop.
 *
 * When the model returns tool calls, this service runs each one through the
 * canonical KeyCortexToolRegistry, records the execution via the lifecycle
 * service, and re-calls the model with the results to produce a final answer.
 */
/**
 * RR-TOOL-ARGS-MALFORMED-NEVER-RUN: the one parse step for a tool call's
 * arguments (the same rule as flow-orchestrator.service.ts parseToolArguments,
 * kept local so this module does not import the Flow orchestrator). A missing
 * or empty string means no arguments ({}); anything else that is not a JSON
 * object, whitespace alone included, is refused.
 */
function parseToolArguments(raw: string | null | undefined): { ok: true; args: Record<string, unknown> } | { ok: false } {
  if (raw === undefined || raw === null || raw === '') return { ok: true, args: {} };
  if (typeof raw !== 'string') return { ok: false };
  try {
    // JSON.parse tolerates whitespace around a value; whitespace alone is not a value and is refused.
    const parsed: unknown = JSON.parse(raw);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { ok: true, args: parsed as Record<string, unknown> };
    }
  } catch {
    // fall through: refused
  }
  return { ok: false };
}

/** The visible result of a refused call. Names the tool only: the broken arguments are never echoed. */
function toolArgumentsRefusal(toolName: string): string {
  return `not run: the arguments for ${toolName} were not valid JSON`;
}

@Injectable()
export class KeyCortexToolLoopService {
  private readonly logger = new Logger(KeyCortexToolLoopService.name);

  constructor(
    private readonly modelGateway: ModelGatewayService,
    private readonly prisma: PrismaService,
    @Optional()
    @Inject(KeyCortexToolRegistryService)
    private readonly toolRegistry?: KeyCortexToolRegistryService,
    @Optional()
    @Inject(KeyCortexLifecycleService)
    private readonly lifecycle?: KeyCortexLifecycleService,
    @Optional()
    @Inject(AutonomyOrchestratorService)
    private readonly autonomyOrchestrator?: AutonomyOrchestratorService,
    @Optional()
    @Inject(KeyAutonomySafetyService)
    private readonly safety?: KeyAutonomySafetyService,
    @Optional()
    @Inject(AutonomyLevelService)
    private readonly autonomyLevelService?: AutonomyLevelService,
  ) {}

  async handleToolCalls(
    completionResult: any,
    messages: GatewayMessage[],
    query: CortexQuery,
    routeDecision: RouteDecision,
    personalityConfig: any,
    taskCategory: TaskCategory,
    turnIdentity?: { correlationId: string; sessionId: string; commandId: string; businessId: string; userId?: string | null },
    maxContextTokens = 4000,
  ): Promise<{ content: string; actions: CortexActionResult[] } | undefined> {
    const toolCalls = completionResult.toolCalls;
    if (!toolCalls || toolCalls.length === 0 || !this.toolRegistry) {
      return undefined;
    }

    const autonomyLevel = await this.resolveAutonomyLevel(query.businessId);
    const ctx: any = {
      businessId: query.businessId,
      userId: query.userId ?? null,
      autonomyLevel,
      commandId: turnIdentity?.commandId,
      sessionId: turnIdentity?.sessionId,
      correlationId: turnIdentity?.correlationId,
    };

    const toolMessages: GatewayMessage[] = [];
    const executedActions: CortexActionResult[] = [];

    for (const tc of toolCalls) {
      const toolName = tc.function?.name;
      const startedAt = Date.now();
      let result: any;

      // RR-TOOL-ARGS-MALFORMED-NEVER-RUN: arguments that do not parse to a JSON
      // object refuse the call here, before the safety gate, the autonomy
      // oracle and execution. The loop used to keep args = {} and run the tool
      // with it: a call the model never made. The refusal goes back to the
      // model as this call's tool message and to the member as an action with
      // status error; it names the tool, never the broken text.
      const parsed = parseToolArguments(tc.function?.arguments);
      if (!parsed.ok) {
        this.logger.warn(`[handleToolCalls] ${toolName} refused: arguments were not valid JSON`);
        result = { success: false, error: toolArgumentsRefusal(toolName), notExecuted: true };
        executedActions.push(this.buildActionResult(toolName, result));
        toolMessages.push(this.buildToolMessage(tc, result));
        continue;
      }
      const args: Record<string, unknown> = parsed.args;

      // 0. V1 tool allowlist gate (before safety/autonomy approval creation)
      const v1Refusal = v1ToolRefusalReason(toolName);
      if (v1Refusal) {
        result = {
          success: false,
          error: v1Refusal,
          requiresApproval: false,
        };
        executedActions.push(this.buildActionResult(toolName, result));
        toolMessages.push(this.buildToolMessage(tc, result));
        continue;
      }

      // 1. Global safety gate (kill switch, daily caps, tier ceiling)
      const tool = this.toolRegistry.getTool(toolName);
      const moduleAction = this.parseModuleAction(toolName);
      if (this.safety && tool) {
        const safetyCheck = await this.safety.check({
          businessId: query.businessId,
          toolName,
          riskTier: tool.riskTier,
          mode: autonomyLevel >= 2 ? 'auto' : 'manual',
          estimatedCostTtd: 0,
        });
        if (!safetyCheck.allowed) {
          result = {
            success: false,
            error: safetyCheck.reason ?? 'Blocked by autonomy safety gate',
            requiresApproval: safetyCheck.requiresApproval ?? false,
          };
          executedActions.push(this.buildActionResult(toolName, result));
          toolMessages.push(this.buildToolMessage(tc, result));
          continue;
        }
      }

      // 2. Canonical autonomy oracle (consolidated verdict)
      if (this.autonomyOrchestrator && tool && moduleAction) {
        const verdict = await this.autonomyOrchestrator.evaluate({
          businessId: query.businessId,
          module: moduleAction.module,
          action: moduleAction.action,
          actionKey: toolName,
          parameters: args,
          proposedBy: query.userId ?? null,
        });
        if (!verdict.allowed) {
          result = {
            success: false,
            error: verdict.reason ?? 'Blocked by autonomy orchestrator',
            requiresApproval: false,
          };
          executedActions.push(this.buildActionResult(toolName, result));
          toolMessages.push(this.buildToolMessage(tc, result));
          continue;
        }
        if (verdict.requiresApproval) {
          result = {
            success: false,
            error: verdict.reason ?? 'Requires approval before execution',
            requiresApproval: true,
            proposalId: verdict.proposalId,
          };
          executedActions.push(this.buildActionResult(toolName, result));
          toolMessages.push(this.buildToolMessage(tc, result));
          continue;
        }
      }

      try {
        result = await this.toolRegistry.execute(toolName, ctx, args);
      } catch (err: any) {
        result = { success: false, error: err instanceof Error ? err.message : String(err) };
      }

      // Record successful execution against daily limits.
      if (this.safety && result.success && tool) {
        await this.safety
          .recordExecution({
            businessId: query.businessId,
            toolName,
            riskTier: tool.riskTier,
            mode: autonomyLevel >= 2 ? 'auto' : 'manual',
            actualCostTtd: result.costTtd,
          })
          .catch((err) => {
            this.logger.warn(`Safety record failed: ${(err as Error).message}`);
          });
      }

      executedActions.push(this.buildActionResult(toolName, result));
      toolMessages.push(this.buildToolMessage(tc, result));

      // Best-effort lifecycle audit
      if (this.lifecycle) {
        const tool = this.toolRegistry.getTool(toolName);
        this.lifecycle.recordExecution({
          identity: turnIdentity ?? {
            correlationId: ctx.correlationId ?? this.generateCorrelationId(),
            sessionId: ctx.sessionId ?? 'unknown',
            commandId: ctx.commandId ?? 'unknown',
            businessId: query.businessId,
            userId: query.userId ?? null,
          },
          toolName,
          module: tool?.module ?? 'unknown',
          riskTier: tool?.riskTier ?? 1,
          requiresApproval: tool?.requiresApproval ?? false,
          input: args,
          output: result.data,
          success: result.success,
          error: result.error,
          durationMs: Date.now() - startedAt,
          startedAt: new Date(startedAt),
          completedAt: new Date(),
        }).catch(() => {});
      }
    }

    // Re-call LLM with tool results to get final answer
    const finalMessages: GatewayMessage[] = [
      ...messages,
      {
        role: 'assistant',
        content: null,
        tool_calls: toolCalls.map((tc: any) => ({
          id: tc.id,
          type: tc.type,
          function: tc.function,
        })),
      } as any,
      ...toolMessages,
    ];

    try {
      const finalResult = await this.modelGateway.complete({
        businessId: query.businessId,
        taskCategory,
        messages: finalMessages,
        temperature: routeDecision.temperatureOverride ?? personalityConfig.temperature,
        maxTokens: routeDecision.maxTokensOverride ?? maxContextTokens,
        responseFormat: { type: 'text' },
      });

      return {
        content: finalResult.content ?? '',
        actions: executedActions,
      };
    } catch (err: any) {
      this.logger.error(
        `[handleToolCalls] Final LLM call failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return {
        content: `I executed ${executedActions.length} tool(s) but could not generate a final summary.`,
        actions: executedActions,
      };
    }
  }

  private async resolveAutonomyLevel(businessId: string): Promise<number> {
    if (this.autonomyLevelService) {
      try {
        const level = await this.autonomyLevelService.resolve(businessId);
        return level.level;
      } catch (err) {
        this.logger.warn(`resolveAutonomyLevel failed: ${(err as Error).message}`);
      }
    }
    return 0;
  }

  private parseModuleAction(toolName: string): { module: string; action: string } | undefined {
    const idx = toolName.indexOf('.');
    if (idx <= 0 || idx >= toolName.length - 1) return undefined;
    return {
      module: toolName.slice(0, idx),
      action: toolName.slice(idx + 1),
    };
  }

  private buildActionResult(
    toolName: string,
    result: any,
  ): CortexActionResult {
    const status = result.success
      ? 'success'
      : result.requiresApproval
        ? 'pending_approval'
        : 'error';
    return {
      actionType: (toolName?.toUpperCase()?.replace(/\./g, '_') ?? 'EXECUTE_TOOL') as CortexActionType,
      status,
      description: result.success
        ? `Executed ${toolName}`
        : `Failed: ${result.error ?? 'Unknown error'}`,
      result: result.success ? (result.data as Record<string, unknown>) : undefined,
      error: result.error,
      requiresApproval: result.requiresApproval ?? false,
      approvalRequestId: result.proposalId,
    };
  }

  private buildToolMessage(tc: any, result: any): GatewayMessage {
    return {
      role: 'tool',
      tool_call_id: tc.id,
      name: tc.function?.name,
      content: JSON.stringify(result),
    } as GatewayMessage;
  }

  private generateCorrelationId(): string {
    return `kc_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }
}
