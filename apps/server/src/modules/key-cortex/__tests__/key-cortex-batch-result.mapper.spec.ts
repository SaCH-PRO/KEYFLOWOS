import { describe, expect, it } from 'vitest';
import type { BatchResult, ExecutionRecord } from '../key-cortex-executor.service';
import {
  blockedCortexAction,
  mapCortexBatchResult,
  pendingApprovalCortexAction,
  unverifiedCortexBatchAction,
} from '../key-cortex-batch-result.mapper';

function record(action: string, success: boolean, data?: unknown, error?: string): ExecutionRecord {
  const command = { module: 'crm' as const, action, parameters: {}, businessId: 'biz',
    userId: 'user', source: 'key_cortex' as const, timestamp: new Date(), correlationId: 'trace' };
  return { id: 'exec-' + action, command, result: { command, success, data, error, executionTimeMs: 1 },
    startedAt: new Date(), finishedAt: new Date(), durationMs: 1, traceId: 'trace', rolledBack: false };
}
function batch(records: ExecutionRecord[], totalCommands = records.length): BatchResult {
  return { results: records, totalCommands, succeededCount: records.filter(r => r.result.success).length,
    failedCount: records.filter(r => !r.result.success).length, rolledBackCount: 0, durationMs: 1,
    traceId: 'trace', stoppedEarly: records.length < totalCommands, summary: 'synthetic fixture' };
}
describe('Cortex actual BatchResult consumption', () => {
  it('maps BatchResult.results with nested success data', () => {
    expect(mapCortexBatchResult(batch([record('create_task', true, { id: 'task' })]))[0])
      .toMatchObject({ actionType: 'CREATE_TASK', status: 'success', result: { id: 'task' } });
  });
  it('preserves real nested error rather than reporting false success', () => {
    expect(mapCortexBatchResult(batch([record('send_email', false, undefined, 'denied')]))[0])
      .toMatchObject({ actionType: 'SEND_EMAIL', status: 'error', error: 'denied' });
  });
  it('maps a mixed batch in execution order', () => {
    expect(mapCortexBatchResult(batch([record('create_task', true), record('send_email', false, undefined, 'no')]))
      .map(r => r.status)).toEqual(['success', 'error']);
  });
  it('represents pending approval as pending, not a failure or a success', () => {
    expect(mapCortexBatchResult(batch([record('create_invoice', false, { approvalStatus: 'pending' }, 'Approval pending')]))[0])
      .toMatchObject({ status: 'pending_approval', requiresApproval: true, approvalRequestId: 'exec-create_invoice' });
  });
  it('does not label unrelated failure as pending approval', () => {
    expect(mapCortexBatchResult(batch([record('create_invoice', false, { approvalStatus: 'pending' }, 'Timeout')]))[0])
      .toMatchObject({ status: 'error', requiresApproval: false });
  });
  it('does not invent an attempted third command when batch stopped early', () => {
    expect(mapCortexBatchResult(batch([record('create_task', false, undefined, 'denied')], 3))).toHaveLength(1);
  });
  it('wraps a primitive successful payload rather than casting it to an object', () => {
    expect(mapCortexBatchResult(batch([record('create_task', true, 'ok')]))[0].result).toEqual({ value: 'ok' });
  });
  it('rejects an old array mock as an invalid batch envelope', () => {
    expect(() => mapCortexBatchResult([record('create_task', true)] as unknown as BatchResult))
      .toThrow('Invalid Cortex batch result');
  });
  it('rejects contradictory aggregate counts', () => {
    const invalid = batch([record('create_task', true)]); invalid.failedCount = 1;
    expect(() => mapCortexBatchResult(invalid)).toThrow('Invalid Cortex batch result');
  });
  it('rejects false boolean-shaped success in an execution record', () => {
    const invalid = batch([record('create_task', true)]);
    (invalid.results[0] as any).result = { success: 'true' };
    expect(() => mapCortexBatchResult(invalid)).toThrow('Invalid Cortex execution record');
  });
  it('permits the genuine empty result of an empty batch', () => {
    expect(mapCortexBatchResult(batch([]))).toEqual([]);
  });
  it('reports unknown outcome without claiming retry safety', () => {
    const result = unverifiedCortexBatchAction();
    expect(result.status).toBe('error');
    expect(result.description).toContain('unverified');
    expect(result.error).toContain('not attempted');
  });
});

// V1-02 review repair (CR-V102-1, SEC-V102-2): a command the pipeline's gate
// kept from the executor is shown as waiting on its approval request, or as
// blocked; never as an attempted execution.
describe('Cortex display records for commands that were not executed', () => {
  it('shows an approval-required command as pending on its approval request', () => {
    expect(pendingApprovalCortexAction({ module: 'commerce', action: 'create invoice' }, 'proposal_1'))
      .toEqual({
        actionType: 'CREATE_INVOICE',
        status: 'pending_approval',
        description: 'Approval pending for create invoice on commerce',
        error: 'Approval pending',
        requiresApproval: true,
        approvalRequestId: 'proposal_1',
      });
  });
  it('shows a refused command as blocked with its reason, not as a failed attempt', () => {
    expect(blockedCortexAction({ module: 'autopilot', action: 'create_task' }, 'policy denies'))
      .toEqual({
        actionType: 'CREATE_TASK',
        status: 'blocked',
        description: 'Blocked create_task on autopilot: policy denies',
        error: 'policy denies',
        requiresApproval: false,
      });
  });
});
