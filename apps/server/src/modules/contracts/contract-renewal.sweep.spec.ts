/**
 * The first thing that ever reads `renewalNoticeDays`.
 *
 * The field is written by the AI extractor, by the KEY tool and by the service,
 * and until this sweep nothing read it. A business set "warn me 60 days before"
 * and the number sat in a column.
 *
 * The tests are mostly about the WINDOW, because that is the field's entire
 * meaning: too early and the list fills with decisions nobody can act on yet;
 * too late and the contract has already renewed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContractRenewalSweep } from './contract-renewal.sweep';
import { WORK_OBLIGATION_RAISED } from '@keyflow/shared';

const NOW = new Date('2026-08-11T09:00:00Z');
const day = (n: number) => new Date(NOW.getTime() + n * 24 * 60 * 60 * 1000);

function contract(over: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    businessId: 'biz_1',
    title: 'Ramkissoon supply agreement',
    renewalDate: day(20),
    renewalNoticeDays: 30,
    renewalType: null,
    contractValue: 12000,
    currency: 'TTD',
    parties: [{ name: 'Ramkissoon Ltd' }],
    ...over,
  };
}

function build(contracts: unknown[]) {
  const emit = vi.fn();
  const prisma = {
    client: { contract: { findMany: vi.fn(async () => contracts) } },
  };
  const svc = new ContractRenewalSweep(prisma as never, { emit } as never);
  return { svc, emit, prisma };
}

describe('contract renewal sweep', () => {
  it('raises an obligation once the notice window opens', async () => {
    // 20 days out, 30 days notice — inside the window.
    const { svc, emit } = build([contract()]);
    const out = await svc.raiseDueRenewals(NOW);

    expect(out.raised).toBe(1);
    expect(emit).toHaveBeenCalledWith(WORK_OBLIGATION_RAISED, expect.objectContaining({
      businessId: 'biz_1',
      sourceModule: 'contracts',
      sourceType: 'contract',
      sourceId: 'c1',
      actionType: 'CONTRACT_RENEWAL',
      owedToLabel: 'Ramkissoon Ltd',
    }));
  });

  it('stays silent outside the window the business asked for', async () => {
    // 90 days out, 30 days notice. The whole point of renewalNoticeDays: a
    // contract renewing next quarter is not this week's problem.
    const { svc, emit } = build([contract({ renewalDate: day(90) })]);
    expect((await svc.raiseDueRenewals(NOW)).raised).toBe(0);
    expect(emit).not.toHaveBeenCalled();
  });

  it('honours a longer notice period on the contract that set it', async () => {
    // Same 90 days out, but this business asked for 120 days' warning.
    const { svc, emit } = build([contract({ renewalDate: day(90), renewalNoticeDays: 120 })]);
    expect((await svc.raiseDueRenewals(NOW)).raised).toBe(1);
    expect(emit).toHaveBeenCalled();
  });

  it('falls back to 30 days when the contract sets none', async () => {
    const { svc } = build([contract({ renewalNoticeDays: null, renewalDate: day(20) })]);
    expect((await svc.raiseDueRenewals(NOW)).raised).toBe(1);

    const { svc: svc2 } = build([contract({ renewalNoticeDays: null, renewalDate: day(45) })]);
    expect((await svc2.raiseDueRenewals(NOW)).raised).toBe(0);
  });

  it('still raises for a renewal already in the past', async () => {
    // An overdue renewal is the MOST urgent case. `regenerateAlerts` drops
    // RENEWAL_DUE once the date passes (`renewal > now`), which is exactly the
    // moment someone needs telling.
    const { svc, emit } = build([contract({ renewalDate: day(-5) })]);
    expect((await svc.raiseDueRenewals(NOW)).raised).toBe(1);
    expect(emit).toHaveBeenCalled();
  });

  it('says plainly that an auto-renewing contract renews by doing nothing', async () => {
    const { svc, emit } = build([contract({ renewalType: 'AUTO_RENEW' })]);
    await svc.raiseDueRenewals(NOW);

    const payload = emit.mock.calls[0][1];
    expect(payload.title).toMatch(/auto-renews/i);
    expect(payload.description).toMatch(/Doing nothing renews it/);
    // Costing money by default outranks merely lapsing.
    expect(payload.priority).toBeGreaterThan(60);
  });

  it('only scans contracts that can still be renewed', async () => {
    const { svc, prisma } = build([]);
    await svc.raiseDueRenewals(NOW);

    const where = prisma.client.contract.findMany.mock.calls[0][0].where;
    expect(where.status.in).toEqual(['ACTIVE', 'RENEWAL_DUE']);
    // A terminated contract raising a renewal obligation would be noise a user
    // cannot act on, and noise is what makes a due list stop being read.
  });

  it('a failing sweep does not take the process down', async () => {
    const emit = vi.fn();
    const prisma = {
      client: { contract: { findMany: vi.fn(async () => { throw new Error('db down'); }) } },
    };
    const svc = new ContractRenewalSweep(prisma as never, { emit } as never);
    await expect(svc.sweep()).resolves.toEqual({ scanned: 0, raised: 0 });
  });

  it('is safe to run twice — the obligation contract dedupes, not this', async () => {
    // Two replicas both fire this cron; there is no leader election in this
    // server. Both emit, and the five-tuple upsert in the listener collapses
    // them. Asserted here so nobody "fixes" the duplicate emit by adding state.
    const { svc, emit } = build([contract()]);
    await svc.raiseDueRenewals(NOW);
    await svc.raiseDueRenewals(NOW);

    expect(emit).toHaveBeenCalledTimes(2);
    const [, first] = emit.mock.calls[0];
    const [, second] = emit.mock.calls[1];
    expect(first.sourceId).toBe(second.sourceId);
    expect(first.actionType).toBe(second.actionType);
  });
});
