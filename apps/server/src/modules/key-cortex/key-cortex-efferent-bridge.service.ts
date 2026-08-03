import { Injectable, Logger, OnModuleInit, Inject, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { FLOW_TOOLS } from '../ai/flow-tool-registry';
import { FlowOrchestratorService } from '../ai/flow-orchestrator.service';
import {
  KeyCortexToolRegistryService,
  type KeyCortexToolContext,
  type KeyCortexToolResult,
  type KeyCortexToolDefinition,
} from './key-cortex-tool-registry.service';

/**
 * The efferent bridge — how a thought becomes an action.
 *
 * THE PROBLEM THIS SOLVES
 *
 * KEY had two disjoint motor vocabularies that shared exactly ZERO names:
 *
 *   FLOW_TOOLS            118 tools, bare snake_case (`commerce_create_invoice`)
 *                         real handlers, real Prisma writes, but reachable only
 *                         from the chat path
 *   cortex registry       ~45 tools, dotted (`cortex.create_task`), organ
 *                         adapters and memory, reachable from the cortex
 *
 * So the brain that deliberates could not touch CRM, commerce, bookings or
 * projects, and the brain that acts could not touch the organs.
 * `KeyCortexConsciousnessService` in particular injects the eight cognition
 * layers and NOTHING else — grep it for `executor|toolRegistry|executeTool` and
 * you get zero hits. It could think, at length, and had no hands.
 *
 * WHY REGISTER RATHER THAN CALL DIRECTLY
 *
 * The obvious shortcut is to let cortex code call
 * `FlowOrchestratorService.executeToolDirectly`. That would be wrong: that
 * method runs `executeToolAction` with NO governance. Oversight is enforced by
 * the CALLER on the chat path (`chat()` evaluates before executing), so the
 * direct entry point is a raw motor pathway with no inhibitory gate.
 *
 * Registering into the cortex registry instead means every flow tool inherits
 * the gate that registry already applies on `execute()`:
 *   - idempotency (a duplicate command does not double-fire)
 *   - KeyAutonomySafetyService: global kill switch, daily action cap, daily
 *     spend cap, tier ceiling
 *   - checkRisk: tier-based autonomy thresholds
 *
 * A motor neuron that fires without passing inhibition is a seizure, not an
 * action. This keeps the gate in the pathway rather than in one of its callers.
 *
 * WHAT THIS DOES NOT DO
 *
 * It does not loosen any gate. Cortex-initiated action stays conservative by
 * design — the chat path has a human in the loop and its own approval flow,
 * autonomous action does not. Tools the gate refuses now become approval
 * proposals rather than dead ends; see KeyCortexToolRegistryService.
 */
@Injectable()
export class KeyCortexEfferentBridgeService implements OnModuleInit {
  private readonly logger = new Logger(KeyCortexEfferentBridgeService.name);

  constructor(
    @Inject(KeyCortexToolRegistryService)
    private readonly registry: KeyCortexToolRegistryService,
    @Optional() private readonly moduleRef?: ModuleRef,
  ) {}

  onModuleInit(): void {
    const registered = this.registerFlowTools();
    this.logger.log(
      `[efferent] ${registered} flow tools bridged into the canonical registry — ` +
        `the cortex can now act on the business, not just reason about it`,
    );
  }

  /**
   * Mirror FLOW_TOOLS into the canonical registry.
   *
   * Names are kept EXACTLY as they are rather than being namespaced to
   * `flow.*`. The planner, ProAutoMonitor and every stored AiPlanStep already
   * carry bare flow names, so renaming here would break the proposal pipeline
   * that was only just repaired — and would recreate the vocabulary split this
   * service exists to remove.
   */
  private registerFlowTools(): number {
    let count = 0;

    for (const tool of FLOW_TOOLS) {
      // Never shadow a tool the organs already registered. Organ adapters
      // register first (OnModuleInit ordering follows the provider graph), and
      // an organ's own implementation of a name is the authoritative one.
      if (this.registry.hasTool(tool.name)) continue;

      const definition: KeyCortexToolDefinition = {
        name: tool.name,
        module: tool.family ?? 'flow',
        description: tool.description,
        parameters: tool.parameters as KeyCortexToolDefinition['parameters'],
        riskTier: (tool.riskTier ?? this.tierFromLevel(tool.riskLevel)) as 1 | 2 | 3 | 4,
        // The registry's own gate decides this per business and autonomy level;
        // declaring it here would double-gate and hide the real reason.
        requiresApproval: false,
        tags: ['flow', tool.family].filter(Boolean) as string[],
        handler: (ctx, input) => this.dispatch(tool.name, ctx, input),
      };

      try {
        this.registry.register(definition);
        count += 1;
      } catch (err: unknown) {
        this.logger.warn(
          `[efferent] could not bridge ${tool.name}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return count;
  }

  /**
   * Execute a bridged tool.
   *
   * Resolved lazily: FlowOrchestratorService is a large graph and this bridge
   * is constructed during boot. Resolving at call time also means a flow tool
   * invoked before the orchestrator is ready fails cleanly instead of
   * poisoning module initialisation.
   */
  private async dispatch(
    toolName: string,
    ctx: KeyCortexToolContext,
    input: Record<string, unknown>,
  ): Promise<KeyCortexToolResult> {
    if (!this.moduleRef) {
      return { success: false, error: 'Efferent bridge has no module context' };
    }

    try {
      const orchestrator = this.moduleRef.get(FlowOrchestratorService, { strict: false });
      const result = await orchestrator.executeToolDirectly(
        ctx.businessId,
        toolName,
        input as Record<string, any>,
      );
      return { success: true, data: result as KeyCortexToolResult['data'] };
    } catch (err: unknown) {
      // executeToolDirectly throws on failure. The registry expects a result
      // object, and a throw here would escape the registry's own outcome
      // recording and idempotency bookkeeping.
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private tierFromLevel(level?: string): number {
    switch (level) {
      case 'low':
        return 1;
      case 'high':
        return 3;
      default:
        return 2;
    }
  }
}
