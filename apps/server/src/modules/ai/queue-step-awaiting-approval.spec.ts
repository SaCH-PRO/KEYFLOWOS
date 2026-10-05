import { describe, expect, it, vi } from 'vitest';
import { QueueService, type PlanStepJob } from './queue.service';

/**
 * KF-EXEC-ACTION-001. When the KEY action boundary files a plan step's action
 * for a human, the dispatcher reports `awaitingApproval`. The worker must leave
 * the step waiting, as its own governance branch does, and must not mark it
 * failed: approving the proposal is what sets the step pending and runs it
 * again (PlanExecutorService.onProposalApproved).
 */
function worker(dispatchResult: Record<string, unknown>) {
  const stepUpdates: Array<Record<string, unknown>> = [];
  const transitions: string[] = [];
  const emitted: string[] = [];
  // The class without its constructor, which opens BullMQ queues on Redis.
  const service: any = Object.assign(Object.create(QueueService.prototype), {
    logger: { log() {}, warn() {}, error() {}, debug() {} },
    prisma: {
      client: {
        aiPlanStep: {
          findMany: vi.fn().mockResolvedValue([]),
          update: vi.fn(async ({ data }: any) => void stepUpdates.push(data)),
          count: vi.fn().mockResolvedValue(1),
        },
        aiPlan: { update: vi.fn() },
      },
    },
    events: { emit: (name: string) => void emitted.push(name) },
    governance: { evaluateAutoApproval: vi.fn().mockResolvedValue({ autoApproved: true, allowed: true, tier: 2, reason: 'auto' }) },
    stateMachine: { transition: vi.fn(async (_plan: string, _biz: string, state: string) => void transitions.push(state)) },
    actionDispatcher: { dispatch: vi.fn().mockResolvedValue({ dispatchId: 'd1', durationMs: 1, ...dispatchResult }) },
  });
  const data: PlanStepJob = {
    planId: 'plan_1',
    stepId: 'step_1',
    businessId: 'biz_1',
    toolName: 'helpdesk_create_ticket',
    args: { title: 'x' },
    order: 0,
    idempotencyKey: 'idem_1',
  };
  return { run: () => service.processPlanStep({ data }), stepUpdates, transitions, emitted, service };
}

describe('QueueService.processPlanStep — a step whose action is waiting for a human', () => {
  it('leaves the step awaiting approval and the plan awaiting input', async () => {
    const w = worker({ success: false, error: 'Not executed: sent for approval (proposal p1)', awaitingApproval: { actionId: 'p1' } });

    await expect(w.run()).rejects.toThrow('Step step_1 requires manual approval');

    expect(w.stepUpdates).toEqual([{ status: 'awaiting_approval' }]);
    expect(w.transitions).toEqual(['executing', 'awaiting_input']);
    // Not a failed step, and not announced as a failed action.
    expect(w.stepUpdates.some((u) => u.status === 'failed')).toBe(false);
    expect(w.emitted).not.toContain('action.failed');
  });

  it('passes the plan step to the dispatcher, which is how the boundary finds the step’s action again', async () => {
    const w = worker({ success: false, error: 'x', awaitingApproval: { actionId: 'p1' } });
    await w.run().catch(() => undefined);

    expect(w.service.actionDispatcher.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ businessId: 'biz_1', toolName: 'helpdesk_create_ticket', planId: 'plan_1', planStepId: 'step_1' }),
    );
  });

  // Everything that is not "awaiting approval" keeps the behaviour it had.
  it('a dispatch that failed still fails the step', async () => {
    const w = worker({ success: false, error: 'database is down' });

    await expect(w.run()).rejects.toThrow('database is down');

    expect(w.stepUpdates).toEqual([{ status: 'failed', errorMessage: 'database is down' }]);
    expect(w.emitted).toContain('action.failed');
  });

  it('a dispatch that succeeded still completes the step', async () => {
    const w = worker({ success: true, result: { id: 't1' } });

    await expect(w.run()).resolves.toEqual({ id: 't1' });

    expect(w.stepUpdates[0]).toMatchObject({ status: 'completed', outputResult: { id: 't1' } });
  });
});
