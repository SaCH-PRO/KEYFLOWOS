/**
 * FU-PROPOSAL-REVENUE-SIGHT round 4 (security minor 4; owner ruling D-238): GET recommendations/:id/execution-status
 * answers the linked KEY proposal's execution result and failure reason. For a reader without revenue read, a financial
 * linked proposal's result and a failure reason that states money are withheld; its status stays (D-226).
 */
import { describe, it, expect, vi } from 'vitest';
import { GenomeRecommendationOutcomeService } from './genome-recommendation-outcome.service';

function service(proposal: Record<string, unknown>) {
  const svc = Object.create(GenomeRecommendationOutcomeService.prototype) as any;
  svc.prisma = {
    client: {
      genomeRecommendationOutcome: { findFirst: vi.fn(async () => ({ decision: 'ACCEPTED', linkedActionType: 'key_action_proposal', linkedActionId: 'kap_1' })) },
      keyActionProposal: { findFirst: vi.fn(async () => ({ id: 'kap_1', status: 'FAILED', executedAt: null, executedBy: null, executionResult: { amount: 12345 }, failureReason: 'balance $12,345 too low', ...proposal })) },
      genomeRecommendation: { findMany: vi.fn(async () => []), findFirst: vi.fn(async () => null) },
    },
  };
  return svc as GenomeRecommendationOutcomeService;
}
const MONEY = { actionType: 'EXECUTE_TOOL', toolName: 'commerce.create_invoice', title: 'Invoice Acme', payload: {} };
const TASK = { actionType: 'CREATE_TASK', module: 'crm', title: 'Call Kerry back', payload: {} };

describe('execution status of a linked KEY proposal (D-238, round 4)', () => {
  it('RED-BEFORE: a reader without revenue read is not answered a financial proposal\'s result or money failure reason', async () => {
    const out = await (service(MONEY) as any).getExecutionStatus('biz_1', 'rec_1', { readsRevenue: false });
    expect(out).toMatchObject({ status: 'FAILED', executionResult: null, failureReason: null });
  });
  it('a revenue reader, and the internal callers with no reader, get it whole', async () => {
    expect(await (service(MONEY) as any).getExecutionStatus('biz_1', 'rec_1', { readsRevenue: true })).toMatchObject({ executionResult: JSON.stringify({ amount: 12345 }) });
    expect(await service(MONEY).getExecutionStatus('biz_1', 'rec_1')).toMatchObject({ failureReason: 'balance $12,345 too low' });
  });
  it('a non-financial proposal keeps its result; a failure reason that states money is still withheld', async () => {
    const out = await (service({ ...TASK, executionResult: { taskId: 't1' } }) as any).getExecutionStatus('biz_1', 'rec_1', { readsRevenue: false });
    expect(out).toMatchObject({ executionResult: JSON.stringify({ taskId: 't1' }), failureReason: null });
  });
});

describe('round 6 (security minor 2): a financial linked proposal\'s failure reason is withheld whatever it says', () => {
  it('RED-BEFORE: a financial proposal\'s failure reason that states no money in words ("Card declined") is withheld', async () => {
    const out = await (service({ ...MONEY, failureReason: 'Card declined' }) as any).getExecutionStatus('biz_1', 'rec_1', { readsRevenue: false });
    expect(out).toMatchObject({ executionResult: null, failureReason: null });
  });
});
