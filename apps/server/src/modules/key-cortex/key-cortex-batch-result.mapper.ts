/**
 * Pure bridge from the executor's BatchResult to Cortex display records.
 * No execution or retry belongs in this module.
 */
import type { BatchResult } from './key-cortex-executor.service';
import type { CortexActionResult, CortexActionType } from './key-cortex.types';

export function mapCortexBatchResult(batch: BatchResult): CortexActionResult[] {
  if (!batch || !Array.isArray(batch.results) ||
      !Number.isSafeInteger(batch.totalCommands) || batch.totalCommands < 0 ||
      batch.results.length > batch.totalCommands ||
      batch.succeededCount + batch.failedCount !== batch.results.length) {
    throw new Error('Invalid Cortex batch result envelope');
  }

  return batch.results.map((record, index): CortexActionResult => {
    if (!record || !record.command ||
        typeof record.command.action !== 'string' ||
        typeof record.command.module !== 'string' ||
        !record.result || typeof record.result.success !== 'boolean') {
      throw new Error(`Invalid Cortex execution record at index ${index}`);
    }

    const outcome = record.result;
    const action = record.command.action;
    const moduleName = record.command.module;
    const pendingApproval = !outcome.success &&
      outcome.error === 'Approval pending' &&
      outcome.data !== null && typeof outcome.data === 'object' &&
      !Array.isArray(outcome.data) &&
      (outcome.data as { approvalStatus?: unknown }).approvalStatus === 'pending';

    const status: CortexActionResult['status'] = outcome.success
      ? 'success' : pendingApproval ? 'pending_approval' : 'error';

    const data: Record<string, unknown> | undefined = outcome.success
      ? outcome.data === undefined ? undefined
        : outcome.data !== null && typeof outcome.data === 'object' && !Array.isArray(outcome.data)
          ? outcome.data as Record<string, unknown> : { value: outcome.data }
      : undefined;

    return {
      actionType: action.toUpperCase().replace(/\s+/g, '_') as CortexActionType,
      status,
      description: outcome.success
        ? `Executed ${action} on ${moduleName}`
        : pendingApproval
          ? `Approval pending for ${action} on ${moduleName}`
          : `Failed ${action} on ${moduleName}: ${outcome.error ?? 'Unknown error'}`,
      result: data,
      error: outcome.success ? undefined : outcome.error ?? 'Unknown execution error',
      requiresApproval: pendingApproval,
      approvalRequestId: pendingApproval ? record.id : undefined,
    };
  });
}

export function unverifiedCortexBatchAction(): CortexActionResult {
  return {
    actionType: 'EXECUTE_TOOL',
    status: 'error',
    description: 'Execution outcome unverified. Review the audit before retrying.',
    error: 'Batch result unavailable; automatic fallback was not attempted.',
    requiresApproval: false,
  };
}
