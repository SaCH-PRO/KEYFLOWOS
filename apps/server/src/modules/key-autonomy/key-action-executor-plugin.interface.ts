import type { KeyActionProposalData, KeyExecutableActionType } from './key-action-proposal.types';

export interface ExecutionOutcome {
  success: boolean;
  result?: Record<string, unknown>;
  error?: string;
}

export interface KeyActionExecutorPlugin {
  readonly name: string;
  canExecute(actionType: KeyExecutableActionType): boolean;
  execute(
    businessId: string,
    proposal: KeyActionProposalData,
    executedBy?: string,
  ): Promise<ExecutionOutcome>;
}
