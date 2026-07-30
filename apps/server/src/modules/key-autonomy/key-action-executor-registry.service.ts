import { Injectable, Logger } from '@nestjs/common';
import type {
  ExecutionOutcome,
  KeyActionExecutorPlugin,
} from './key-action-executor-plugin.interface';
import type { KeyActionProposalData, KeyExecutableActionType } from './key-action-proposal.types';

@Injectable()
export class KeyActionExecutorRegistryService {
  private readonly logger = new Logger(KeyActionExecutorRegistryService.name);
  private readonly plugins: KeyActionExecutorPlugin[] = [];

  register(plugin: KeyActionExecutorPlugin): void {
    if (this.plugins.some((p) => p.name === plugin.name)) {
      this.logger.warn(`Executor plugin "${plugin.name}" already registered; ignoring duplicate`);
      return;
    }
    this.plugins.push(plugin);
    this.logger.log(`Registered KEY action executor plugin: ${plugin.name}`);
  }

  hasPlugin(actionType: KeyExecutableActionType): boolean {
    return this.plugins.some((p) => p.canExecute(actionType));
  }

  async execute(
    businessId: string,
    proposal: KeyActionProposalData,
    executedBy?: string,
  ): Promise<ExecutionOutcome> {
    const plugin = this.plugins.find((p) => p.canExecute(proposal.actionType));
    if (!plugin) {
      return {
        success: false,
        error: `No executor plugin registered for action type ${proposal.actionType}`,
      };
    }
    try {
      return await plugin.execute(businessId, proposal, executedBy);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Plugin "${plugin.name}" execution failed: ${message}`);
      return { success: false, error: message };
    }
  }
}
