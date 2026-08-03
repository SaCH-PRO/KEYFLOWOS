import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { FlowOrchestratorService } from '../ai/flow-orchestrator.service';
import type {
  ExecutionOutcome,
  KeyActionExecutorPlugin,
} from '../key-autonomy/key-action-executor-plugin.interface';
import { KeyActionExecutorRegistryService } from '../key-autonomy/key-action-executor-registry.service';
import type { KeyActionProposalData } from '../key-autonomy/key-action-proposal.types';
import {
  KeyCortexToolRegistryService,
  KeyCortexToolContext,
} from './key-cortex-tool-registry.service';

@Injectable()
export class KeyCortexActionExecutorPlugin
  implements OnModuleInit, KeyActionExecutorPlugin
{
  readonly name = 'key-cortex-execute-tool';

  constructor(
    @Inject(KeyActionExecutorRegistryService)
    private readonly registry: KeyActionExecutorRegistryService,
    @Inject(KeyCortexToolRegistryService)
    private readonly toolRegistry: KeyCortexToolRegistryService,
    private readonly moduleRef: ModuleRef,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  canExecute(actionType: string): boolean {
    return actionType === 'EXECUTE_TOOL';
  }

  async execute(
    businessId: string,
    proposal: KeyActionProposalData,
    executedBy?: string,
  ): Promise<ExecutionOutcome> {
    const payload = (proposal.payload ?? {}) as {
      toolName?: string;
      /** What PlanExecutorService actually writes. */
      inputPayload?: Record<string, unknown>;
      /** Legacy/alternate key, kept as a fallback. */
      parameters?: Record<string, unknown>;
      planContext?: { planId: string; planStepId: string };
      sessionId?: string;
      correlationId?: string;
      autonomyLevel?: number;
    };

    const toolName = payload.toolName;
    if (!toolName) {
      return { success: false, error: 'EXECUTE_TOOL proposal missing payload.toolName' };
    }

    // `inputPayload` FIRST. PlanExecutorService.createStepProposal writes
    // `payload.inputPayload`; this plugin read `payload.parameters`, so every
    // approved plan step executed with `{}` and failed required-field
    // validation — on top of the registry mismatch below.
    const args = payload.inputPayload ?? payload.parameters ?? {};

    // Route by name shape. There are two disjoint tool vocabularies in this
    // server and they share ZERO names: the cortex registry uses dotted
    // namespaces (`cortex.create_task`, `key_inbox.send_reply`), while
    // FLOW_TOOLS — the 118 tools the shipped chat and the planner both use —
    // are bare snake_case (`commerce_create_invoice`).
    //
    // This plugin sent everything to the cortex registry, so every proposal
    // originating from a plan or from ProAutoMonitor failed with
    // `Tool "..." not found in canonical registry`. Approval was a dead end
    // for 100% of flow-named actions, which is every action a plan produces.
    if (!toolName.includes('.')) {
      try {
        // Resolved through ModuleRef rather than the constructor: AiModule and
        // KeyCortexModule forwardRef each other at the module level, and a
        // constructor edge would add a boot-graph dependency for something
        // only needed at execution time. The import is static and safe —
        // flow-orchestrator pulls in two key-cortex *service* files and
        // nothing that leads back to this plugin, so there is no file cycle.
        const orchestrator = this.moduleRef.get(FlowOrchestratorService, {
          strict: false,
        });

        // planContext is forwarded so an approved step is still attributed to
        // its plan — that is what lets FeedbackLoopService engage, since it
        // requires both planId and planStepId.
        const result = await orchestrator.executeToolDirectly(
          businessId,
          toolName,
          args as Record<string, any>,
          payload.planContext,
        );

        return { success: true, result: result as Record<string, unknown> | undefined };
      } catch (err: unknown) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }

    const ctx: KeyCortexToolContext = {
      businessId,
      userId: executedBy ?? proposal.userId ?? undefined,
      sessionId: payload.sessionId,
      correlationId: payload.correlationId,
      autonomyLevel: payload.autonomyLevel ?? 4,
      // This plugin only ever runs an APPROVED proposal — that is the whole
      // contract of KeyActionExecutorPlugin. Without this flag a tier-3 tool
      // could never execute: checkRisk refuses tier 3 at every autonomy level,
      // so the approval bounced off the same gate that raised it and filed
      // another proposal. Safety limits and the kill switch still apply.
      preApproved: true,
    };

    const result = await this.toolRegistry.execute(toolName, ctx, args);

    return {
      success: result.success,
      result: result.data as Record<string, unknown> | undefined,
      error: result.error,
    };
  }
}
