/**
 * FU-KEY-GENOME-READS-RESIDUAL (D-235): the routes pass the reader's revenue sight to the genome reads they serve.
 * Kept apart from key-cortex.controller.spec.ts, whose cases the Release 0 manifest key-cortex-actor-binding.json binds.
 */
import { describe, it, expect, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { KeyCortexController } from '../key-cortex.controller';

const viewer = (revenue: string) => ({ userId: 'u1', businessId: 'biz_A', role: 'STAFF', superAdmin: false, scopes: { revenue }, member: true });
function controller(evolution: unknown, awareness: unknown) {
  const args: any[] = Array(24).fill({});
  args[14] = evolution;
  args[22] = awareness;
  return new (KeyCortexController as any)(...args);
}

describe('GET cortex/evolution/decision and GET cortex/awareness pass the reader (D-235)', () => {
  it('RED-BEFORE: evolution/decision is explained for the reader: the guarded business and the reader\'s revenue sight are passed', async () => {
    const evolution = { explainDecision: vi.fn(async () => ({ explanation: 'x' })) };
    const ctl = controller(evolution, {});
    await ctl.evolutionExplainDecision('biz_A', 'dec_1', viewer('none'));
    expect(evolution.explainDecision).toHaveBeenCalledWith('dec_1', 'biz_A', { readsRevenue: false, userId: 'u1', ownerView: false });
    await ctl.evolutionExplainDecision('biz_A', 'dec_1', viewer('read'));
    expect(evolution.explainDecision).toHaveBeenLastCalledWith('dec_1', 'biz_A', { readsRevenue: true, userId: 'u1', ownerView: false });
  });

  it('RED-BEFORE: a decision that does not exist for the reader answers 404, not 503', async () => {
    const evolution = { explainDecision: vi.fn(async () => { throw new NotFoundException('Decision not found'); }) };
    await expect(controller(evolution, {}).evolutionExplainDecision('biz_A', 'dec_1', viewer('none'))).rejects.toBeInstanceOf(NotFoundException);
  });

  it('RED-BEFORE: awareness is read for the reader', async () => {
    const awareness = { getAwareness: vi.fn(async () => ({ items: [], counts: {}, latestAt: null })) };
    const ctl = controller({}, awareness);
    await ctl.getAwareness('biz_A', undefined, undefined, viewer('none'));
    expect(awareness.getAwareness.mock.calls[0][1]).toMatchObject({ readsRevenue: false });
  });
});
