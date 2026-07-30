import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
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
      parameters?: Record<string, unknown>;
      sessionId?: string;
      correlationId?: string;
      autonomyLevel?: number;
    };

    const toolName = payload.toolName;
    if (!toolName) {
      return { success: false, error: 'EXECUTE_TOOL proposal missing payload.toolName' };
    }

    const ctx: KeyCortexToolContext = {
      businessId,
      userId: executedBy ?? proposal.userId ?? undefined,
      sessionId: payload.sessionId,
      correlationId: payload.correlationId,
      autonomyLevel: payload.autonomyLevel ?? 4,
    };

    const result = await this.toolRegistry.execute(
      toolName,
      ctx,
      payload.parameters ?? {},
    );

    return {
      success: result.success,
      result: result.data as Record<string, unknown> | undefined,
      error: result.error,
    };
  }
}
