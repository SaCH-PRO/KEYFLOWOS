/**
 * FU-PROPOSAL-REVENUE-SIGHT (owner ruling D-238), rounds 3-4: POST cortex/actions/approve keeps the orchestrator's
 * authority and answers a member without revenue read a financial proposal's redacted view. Kept apart from
 * key-cortex.controller.spec.ts, whose cases the Release 0 manifest key-cortex-actor-binding.json binds exactly.
 */
import { describe, it, expect, vi } from 'vitest';
import { KeyCortexController } from './key-cortex.controller';

describe('FU-PROPOSAL-REVENUE-SIGHT round-3 repair (security B2; D-238): POST cortex/actions/approve over a financial proposal', () => {
  const MONEY = { id: 'kap_1', status: 'APPROVED', title: '$12,345 outstanding across 7 invoices', summary: 'Outstanding invoices exceed 1.5x your monthly revenue.', actionType: 'EXECUTE_TOOL', module: 'commerce', riskLevel: 'HIGH' };
  const make = () => {
    const orchestrator = { approve: vi.fn(async () => ({ ...MONEY })), reject: vi.fn(async () => ({ ...MONEY, status: 'REJECTED' })) };
    const args: any[] = Array(22).fill({});
    args[19] = orchestrator; // approvalOrchestrator
    const ctl = new (KeyCortexController as any)(...args);
    return { ctl, orchestrator };
  };
  const dto = (approved: boolean) => ({ sessionId: 's1', businessId: 'b1', actionId: 'kap_1', approved }) as any;
  const viewer = (revenue: string) => ({ userId: 'u1', businessId: 'b1', role: 'STAFF', superAdmin: false, scopes: { revenue }, member: true });

  for (const approved of [true, false]) {
    it(`RED-BEFORE: ${approved ? 'approve' : 'reject'} answers a member without revenue read the redacted view (no title, summary or figure)`, async () => {
      const { ctl } = make();
      const res = await ctl.approveAction(dto(approved), { user: { id: 'u1' } }, viewer('none'));
      expect(JSON.stringify(res)).not.toContain('12,345');
      expect(JSON.stringify(res)).not.toContain('monthly revenue');
      expect(res.result).toMatchObject({ id: 'kap_1' });
    });
    it(`control: ${approved ? 'approve' : 'reject'} answers a revenue reader the proposal whole`, async () => {
      const { ctl } = make();
      const res = await ctl.approveAction(dto(approved), { user: { id: 'u1' } }, viewer('read'));
      expect(JSON.stringify(res)).toContain('12,345');
    });
  }
});

describe('FU-PROPOSAL-REVENUE-SIGHT round 4 (security minor 6): POST cortex/actions/approve after the decision has been applied', () => {
  it('RED-BEFORE: a failed provenance read answers the redacted view, not a 503 for a decision that took effect', async () => {
    const TASK = { id: 'kap_t', status: 'APPROVED', title: 'Plan the next step', actionType: 'CREATE_TASK', module: 'crm', payload: { recommendationId: 'rec_1' } };
    const orchestrator = { approve: vi.fn(async () => ({ ...TASK })), reject: vi.fn(), isFinancial: vi.fn(async () => { throw new Error('db down'); }) };
    const args: any[] = Array(22).fill({});
    args[19] = orchestrator;
    const ctl = new (KeyCortexController as any)(...args);
    const viewer = { userId: 'u1', businessId: 'b1', role: 'STAFF', superAdmin: false, scopes: { revenue: 'none' }, member: true };
    const res = await ctl.approveAction({ sessionId: 's1', businessId: 'b1', actionId: 'kap_t', approved: true }, { user: { id: 'u1' } }, viewer);
    expect(res.result).toEqual({ id: 'kap_t', status: 'APPROVED' });
  });
});
