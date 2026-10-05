import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KeyCortexToolRegistryService, type KeyCortexToolDefinition } from './key-cortex-tool-registry.service';

/**
 * KF-EXEC-ACTION-001. A bridged handler can answer "not executed": the KEY
 * action boundary, behind the handler of a capability it has adopted, refuses
 * the call or files it for approval. The registry must not treat that as the
 * tool failing.
 *
 * It matters beyond bookkeeping. `ToolOutcomeScore` is read by
 * AutonomyOrchestratorService before a proposal executes: under 30% success
 * over five uses the tool is blocked. A surface that can only ever file
 * proposals would drive the score to zero and block the approvals it filed.
 */
describe('KeyCortexToolRegistryService — a handler that did not execute', () => {
  let registry: KeyCortexToolRegistryService;
  let upsert: ReturnType<typeof vi.fn>;
  let safety: { check: ReturnType<typeof vi.fn>; recordExecution: ReturnType<typeof vi.fn> };
  let idempotency: { check: ReturnType<typeof vi.fn>; complete: ReturnType<typeof vi.fn>; fail: ReturnType<typeof vi.fn> };
  let saga: { addStep: ReturnType<typeof vi.fn>; completeStep: ReturnType<typeof vi.fn>; failStep: ReturnType<typeof vi.fn>; compensate: ReturnType<typeof vi.fn> };
  let learning: { recordOutcome: ReturnType<typeof vi.fn> };

  const tool = (handler: KeyCortexToolDefinition['handler']): KeyCortexToolDefinition => ({
    name: 'helpdesk_create_ticket',
    module: 'crud',
    description: 'Create a support ticket',
    parameters: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] },
    riskTier: 2,
    requiresApproval: false,
    handler,
  });
  // Autonomy high enough, and the action marked pre-approved, so the registry's
  // own gate lets the call through to the handler.
  const ctx = { businessId: 'biz_1', autonomyLevel: 5, preApproved: true, idempotencyKey: 'idem_1', sagaId: 'saga_1' };

  beforeEach(() => {
    upsert = vi.fn().mockResolvedValue(undefined);
    safety = { check: vi.fn().mockResolvedValue({ allowed: true }), recordExecution: vi.fn().mockResolvedValue(undefined) };
    idempotency = { check: vi.fn().mockResolvedValue({ status: 'new' }), complete: vi.fn().mockResolvedValue(undefined), fail: vi.fn().mockResolvedValue(undefined) };
    saga = { addStep: vi.fn().mockResolvedValue(undefined), completeStep: vi.fn().mockResolvedValue(undefined), failStep: vi.fn().mockResolvedValue(undefined), compensate: vi.fn().mockResolvedValue([]) };
    learning = { recordOutcome: vi.fn().mockResolvedValue(undefined) };
    registry = new KeyCortexToolRegistryService(
      {
        client: {
          cortexActionLog: { create: vi.fn().mockResolvedValue(undefined) },
          toolOutcomeScore: { findUnique: vi.fn().mockResolvedValue(null), upsert },
        },
      } as any,
      safety as any,
      idempotency as any,
      saga as any,
      learning as any,
      { emit: vi.fn().mockResolvedValue(undefined) } as any,
      { emit: vi.fn() } as any,
    );
  });

  const settleBackgroundWrites = () => new Promise((r) => setTimeout(r, 0));

  it('a "sent for approval" answer is returned as it is and scored as nothing', async () => {
    const answer = { success: false, notExecuted: true, requiresApproval: true, error: 'Not executed: sent for approval', data: { proposalId: 'p1' } };
    registry.register(tool(vi.fn().mockResolvedValue(answer)));

    const result = await registry.execute('helpdesk_create_ticket', ctx, { title: 'x' });
    await settleBackgroundWrites();

    expect(result).toEqual(answer);
    // Not a failure of the tool.
    expect(upsert).not.toHaveBeenCalled();
    expect(learning.recordOutcome).not.toHaveBeenCalled();
    expect(registry.getToolScore('helpdesk_create_ticket').totalUses).toBe(0);
    // Not an execution against the daily limits.
    expect(safety.recordExecution).not.toHaveBeenCalled();
    // Not the outcome of the idempotency key: a retry must reach the handler again.
    expect(idempotency.complete).not.toHaveBeenCalled();
    // The saga step it opened is closed as not done, with no compensation.
    expect(saga.failStep).toHaveBeenCalledWith('saga_1', expect.any(Number), 'Not executed: sent for approval');
    expect(saga.completeStep).not.toHaveBeenCalled();
    expect(saga.compensate).not.toHaveBeenCalled();
  });

  it('a refusal is scored as nothing either', async () => {
    registry.register(tool(vi.fn().mockResolvedValue({ success: false, notExecuted: true, requiresApproval: false, error: 'Not executed: blocked' })));

    await registry.execute('helpdesk_create_ticket', ctx, { title: 'x' });
    await settleBackgroundWrites();

    expect(upsert).not.toHaveBeenCalled();
    expect(registry.getToolScore('helpdesk_create_ticket').totalUses).toBe(0);
  });

  it('five refusals do not make a failing tool of it', async () => {
    registry.register(tool(vi.fn().mockResolvedValue({ success: false, notExecuted: true, requiresApproval: true, error: 'sent for approval' })));
    for (let i = 0; i < 5; i++) await registry.execute('helpdesk_create_ticket', { ...ctx, idempotencyKey: undefined, sagaId: undefined }, { title: 'x' });
    await settleBackgroundWrites();

    expect(upsert).not.toHaveBeenCalled();
  });

  // The rule is narrow. Everything that is not a "not executed" answer is
  // scored exactly as before.
  it('a real failure is still scored as a failure', async () => {
    registry.register(tool(vi.fn().mockResolvedValue({ success: false, error: 'database is down' })));

    await registry.execute('helpdesk_create_ticket', ctx, { title: 'x' });
    await settleBackgroundWrites();

    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert.mock.calls[0][0].create).toMatchObject({ toolName: 'helpdesk_create_ticket', successCount: 0, failureCount: 1 });
  });

  it('a failure that only says it needs approval is still scored: the marker is notExecuted', async () => {
    registry.register(tool(vi.fn().mockResolvedValue({ success: false, requiresApproval: true, error: 'handler-level refusal' })));

    await registry.execute('helpdesk_create_ticket', ctx, { title: 'x' });
    await settleBackgroundWrites();

    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it('a success is still scored as a success, even if it carries the marker', async () => {
    registry.register(tool(vi.fn().mockResolvedValue({ success: true, notExecuted: true, data: { id: 't1' } })));

    await registry.execute('helpdesk_create_ticket', ctx, { title: 'x' });
    await settleBackgroundWrites();

    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert.mock.calls[0][0].create).toMatchObject({ successCount: 1, failureCount: 0 });
    expect(safety.recordExecution).toHaveBeenCalledTimes(1);
  });
});
