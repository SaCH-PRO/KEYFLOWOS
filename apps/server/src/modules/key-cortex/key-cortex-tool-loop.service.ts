import { Injectable, Logger, Inject, Optional } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { ModelGatewayService, GatewayMessage, TaskCategory } from '../ai/model-gateway.service';
import { KeyCortexToolRegistryService } from './key-cortex-tool-registry.service';
import { KeyCortexLifecycleService } from './key-cortex-lifecycle.service';
import { RouteDecision } from './adaptive-router.service';
import { CortexQuery, CortexActionResult, CortexActionType } from './key-cortex.types';

/**
 * Executes the LLM ↔ tool-call loop.
 *
 * When the model returns tool calls, this service runs each one through the
 * canonical KeyCortexToolRegistry, records the execution via the lifecycle
 * service, and re-calls the model with the results to produce a final answer.
 */
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

    const ctx: any = {
      businessId: query.businessId,
      userId: query.userId ?? null,
      autonomyLevel: await this.resolveAutonomyLevel(query.businessId),
      commandId: turnIdentity?.commandId,
      sessionId: turnIdentity?.sessionId,
      correlationId: turnIdentity?.correlationId,
    };

    const toolMessages: GatewayMessage[] = [];
    const executedActions: CortexActionResult[] = [];

    for (const tc of toolCalls) {
      const toolName = tc.function?.name;
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.function?.arguments ?? '{}');
      } catch {
        this.logger.warn(`[handleToolCalls] Failed to parse arguments for ${toolName}`);
      }

      const startedAt = Date.now();
      let result: any;
      try {
        result = await this.toolRegistry.execute(toolName, ctx, args);
      } catch (err: any) {
        result = { success: false, error: err instanceof Error ? err.message : String(err) };
      }

      executedActions.push({
        actionType: (toolName?.toUpperCase()?.replace(/\./g, '_') ?? 'EXECUTE_TOOL') as CortexActionType,
        status: result.success ? 'success' : 'error',
        description: result.success
          ? `Executed ${toolName}`
          : `Failed: ${result.error ?? 'Unknown error'}`,
        result: result.success ? (result.data as Record<string, unknown>) : undefined,
        error: result.error,
        requiresApproval: false,
      });

      toolMessages.push({
        role: 'tool',
        tool_call_id: tc.id,
        name: toolName,
        content: JSON.stringify(result),
      } as GatewayMessage);

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
    try {
      const settings = await (this.prisma.client as any).businessSetting.findUnique({
        where: { businessId },
        select: { aiAutonomyLevel: true },
      });
      return settings?.aiAutonomyLevel ?? 0;
    } catch {
      return 0;
    }
  }

  private generateCorrelationId(): string {
    return `kc_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }
}
