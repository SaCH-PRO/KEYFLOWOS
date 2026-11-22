/**
 * FU-PROPOSAL-REVENUE-SIGHT review repair (security MAJOR-5; D-238): KeyActionProposalService emits each proposal's
 * lifecycle to the timeline (entityType key_action_proposal; key.action.proposed / executed / approval_lapsed, carrying
 * the risk level, the execution result or a reason). A reader without revenue read is served a proposal's timeline
 * events only when the proposal is non-financial; every other event is unchanged here.
 */
import { describe, it, expect, vi } from 'vitest';
import { TemporalFlowService } from './temporal-flow.service';

const EVENTS = [
  { id: 'ev_money', businessId: 'biz_1', entityType: 'key_action_proposal', entityId: 'kap_money', title: 'KEY action executed', description: null, metadata: { executionResult: { amount: 12345 } } },
  { id: 'ev_task', businessId: 'biz_1', entityType: 'key_action_proposal', entityId: 'kap_task', title: 'KEY action proposed', description: null, metadata: { riskLevel: 'LOW' } },
  { id: 'ev_unknown', businessId: 'biz_1', entityType: 'key_action_proposal', entityId: 'kap_gone', title: 'KEY action approval lapsed', description: null, metadata: {} },
  { id: 'ev_booking', businessId: 'biz_1', entityType: 'booking', entityId: 'bk_1', title: 'Booking confirmed', description: null, metadata: {} },
];
const PROPOSALS = [
  { id: 'kap_money', actionType: 'EXECUTE_TOOL', module: 'commerce', toolName: 'commerce.record_payment', title: 'Record the payment' },
  { id: 'kap_task', actionType: 'CREATE_TASK', module: 'crm', toolName: null, title: 'Call Kerry back' },
];
const MEMBERS: Record<string, unknown> = {
  blind: { role: 'STAFF', permissionScopes: { revenue: 'none', operations: 'read' } },
  owner: { role: 'OWNER', permissionScopes: null },
};

function service() {
  const prisma = {
    client: {
      temporalFlowEvent: { findMany: vi.fn(async () => EVENTS) },
      keyActionProposal: { findMany: vi.fn(async ({ where }: any) => (where.businessId === 'biz_1' ? PROPOSALS.filter((p) => where.id.in.includes(p.id)) : [])) },
      membership: { findUnique: vi.fn(async ({ where }: any) => MEMBERS[where.userId_businessId.userId] ?? null) },
    },
  };
  return { svc: new TemporalFlowService(prisma as any), prisma };
}

describe('the timeline of KEY proposals (D-238)', () => {
  it('RED-BEFORE: a reader without revenue read is served the task proposal\'s event and not the money or unclassifiable one; other events stay', async () => {
    const { svc } = service();
    const rows = await (svc as any).list('biz_1', {}, { id: 'blind', role: 'USER' });
    expect(rows.map((r: any) => r.id)).toEqual(['ev_task', 'ev_booking']);
  });
  it('RED-BEFORE: a request with no reader is served no financial proposal event (fail closed)', async () => {
    const { svc } = service();
    expect((await (svc as any).list('biz_1', {}, null)).map((r: any) => r.id)).toEqual(['ev_task', 'ev_booking']);
  });
  it('control: the owner and a SUPER_ADMIN are served every event, and the business filter holds', async () => {
    const { svc, prisma } = service();
    expect((await (svc as any).list('biz_1', {}, { id: 'owner', role: 'USER' })).map((r: any) => r.id)).toEqual(EVENTS.map((e) => e.id));
    expect((await (svc as any).list('biz_1', {}, { id: 'admin', role: 'SUPER_ADMIN' })).map((r: any) => r.id)).toEqual(EVENTS.map((e) => e.id));
    for (const call of prisma.client.keyActionProposal.findMany.mock.calls as any[]) expect(call[0].where.businessId).toBe('biz_1');
  });
  it('control: an in-process call with no reader argument is unchanged (the scheduler, KEY tools that apply their own authority)', async () => {
    const { svc } = service();
    expect((await svc.list('biz_1', {})).map((r: any) => r.id)).toEqual(EVENTS.map((e) => e.id));
  });
});

describe('round-3 repair (security m1): a proposal event whose own payload states money', () => {
  it('RED-BEFORE: a rejection event of a non-financial proposal whose reason states money is withheld from a reader without revenue read', async () => {
    const prisma = {
      client: {
        temporalFlowEvent: { findMany: vi.fn(async () => [{ id: 'ev_rej', businessId: 'biz_1', entityType: 'key_action_proposal', entityId: 'kap_task', title: 'KEY action rejected', description: null, payload: { reason: 'not now: $9,876 is due first' }, metadata: {} }]) },
        keyActionProposal: { findMany: vi.fn(async () => [{ id: 'kap_task', actionType: 'CREATE_TASK', module: 'crm', toolName: null, title: 'Call Kerry back' }]) },
        membership: { findUnique: vi.fn(async () => ({ role: 'STAFF', permissionScopes: { revenue: 'none' } })) },
      },
    };
    const svc = new TemporalFlowService(prisma as any);
    expect((await (svc as any).list('biz_1', {}, { id: 'blind', role: 'USER' })).map((r: any) => r.id)).toEqual([]);
  });
});

describe('round-4 repair (correctness MAJOR-2): the proposal row is read with every field the classifier reads', () => {
  it('RED-BEFORE: a task proposal whose money is only in its expected benefit withholds its events', async () => {
    const findMany = vi.fn(async () => [{ id: 'kap_task', actionType: 'CREATE_TASK', module: 'crm', toolName: null, title: 'Call Kerry back', expectedBenefit: 'Recover TTD 40,000 renewal' }]);
    const prisma = {
      client: {
        temporalFlowEvent: { findMany: vi.fn(async () => [{ id: 'ev', businessId: 'biz_1', entityType: 'key_action_proposal', entityId: 'kap_task', title: 'KEY action executed', description: null, payload: {}, metadata: {} }]) },
        keyActionProposal: { findMany },
        genomeRecommendation: { findMany: vi.fn(async () => []) },
        membership: { findUnique: vi.fn(async () => ({ role: 'STAFF', permissionScopes: { revenue: 'none' } })) },
      },
    };
    const { PROPOSAL_CLASSIFY_SELECT } = await import('../business-genome/key-genome/genome-finance-scope');
    const svc = new TemporalFlowService(prisma as any);
    expect(await (svc as any).list('biz_1', {}, { id: 'blind', role: 'USER' })).toEqual([]);
    expect((findMany.mock.calls[0] as any[])[0].select).toEqual(PROPOSAL_CLASSIFY_SELECT);
  });
});

describe('Codex P2 on #218: the timeline limit counts what the reader may see', () => {
  it('RED-BEFORE: with limit 1, a newest financial proposal event does not hide an older booking event from a reader without revenue read', async () => {
    const events = [
      { id: 'ev_fin', businessId: 'biz_1', entityType: 'key_action_proposal', entityId: 'kap_fin', title: 'KEY action proposed', description: null, payload: {}, metadata: {}, occurredAt: new Date('2026-11-22') },
      { id: 'ev_book', businessId: 'biz_1', entityType: 'booking', entityId: 'b1', title: 'Booking confirmed', description: null, payload: {}, metadata: {}, occurredAt: new Date('2026-11-21') },
    ];
    const prisma = {
      client: {
        temporalFlowEvent: { findMany: vi.fn(async ({ take }: any) => events.slice(0, take ?? events.length)) },
        keyActionProposal: { findMany: vi.fn(async () => [{ id: 'kap_fin', actionType: 'EXECUTE_TOOL', toolName: 'commerce.create_invoice', title: 'Invoice Acme' }]) },
        genomeRecommendation: { findMany: vi.fn(async () => []) },
        membership: { findUnique: vi.fn(async () => ({ role: 'STAFF', permissionScopes: { revenue: 'none' } })) },
      },
    };
    const svc = new TemporalFlowService(prisma as any);
    expect((await (svc as any).list('biz_1', { limit: 1 }, { id: 'blind', role: 'USER' })).map((e: any) => e.id)).toEqual(['ev_book']);
  });
});

describe('review of the Codex fixes on #218: the timeline', () => {
  const blind = { id: 'blind', role: 'USER' };
  const base = (events: any[], proposals: any[]) => {
    const findMany = vi.fn(async ({ take, skip }: any) => events.slice(skip ?? 0, (skip ?? 0) + (take ?? events.length)));
    const prisma = {
      client: {
        temporalFlowEvent: { findMany },
        keyActionProposal: { findMany: vi.fn(async ({ where }: any) => proposals.filter((p) => where.id.in.includes(p.id))) },
        genomeRecommendation: { findMany: vi.fn(async () => []) },
        membership: { findUnique: vi.fn(async ({ where }: any) => (where.userId_businessId.userId === 'owner' ? { role: 'OWNER', permissionScopes: null } : { role: 'STAFF', permissionScopes: { revenue: 'none' } })) },
      },
    };
    return { svc: new TemporalFlowService(prisma as any) as any, findMany };
  };
  const TASK = { id: 'kap_task', actionType: 'CREATE_TASK', module: 'crm', toolName: null, title: 'Call Kerry back' };
  const FIN = { id: 'kap_fin', actionType: 'EXECUTE_TOOL', toolName: 'commerce.create_invoice', title: 'Invoice Acme' };
  const ev = (id: string, entityType: string, entityId: string, extra: object = {}) => ({ id, businessId: 'biz_1', entityType, entityId, title: 'Event', description: null, payload: {}, metadata: {}, ...extra });

  it.each(['card declined', 'Total due 900', 'unpaid for 3 months', 'Acme paid late', 'the balance owed is 900'])(
    'RED-BEFORE (security MAJOR-1): a failed event of a non-financial proposal whose failure reason reads "%s" is withheld from a reader without revenue read',
    async (failureReason) => {
      const { svc } = base([ev('ev_fail', 'key_action_proposal', 'kap_task', { title: 'KEY action failed', payload: { actionType: 'CREATE_TASK', failureReason } })], [TASK]);
      expect((await svc.list('biz_1', {}, blind)).map((e: any) => e.id)).toEqual([]);
    },
  );
  it('control: a failed event whose reason states no money is served', async () => {
    const { svc } = base([ev('ev_fail', 'key_action_proposal', 'kap_task', { title: 'KEY action failed', payload: { actionType: 'CREATE_TASK', failureReason: 'Rate limited: retry after 30s' } })], [TASK]);
    expect((await svc.list('biz_1', {}, blind)).map((e: any) => e.id)).toEqual(['ev_fail']);
  });

  it('RED-BEFORE (security m2): with limit 1, five newest hidden proposal events do not hide the older booking (the read pages on until the limit is met)', async () => {
    const events = [...Array.from({ length: 5 }, (_, i) => ev(`ev_fin_${i}`, 'key_action_proposal', 'kap_fin')), ev('ev_book', 'booking', 'b1')];
    const { svc } = base(events, [FIN]);
    expect((await svc.list('biz_1', { limit: 1 }, blind)).map((e: any) => e.id)).toEqual(['ev_book']);
  });
  it('RED-BEFORE (security m2): with limit 100, 500 newest hidden events do not hide the older booking', async () => {
    const events = [...Array.from({ length: 500 }, (_, i) => ev(`ev_fin_${i}`, 'key_action_proposal', 'kap_fin')), ev('ev_book', 'booking', 'b1')];
    const { svc } = base(events, [FIN]);
    expect((await svc.list('biz_1', { limit: 100 }, blind)).map((e: any) => e.id)).toEqual(['ev_book']);
  });
  it('the paged read is bounded: an endless run of hidden events ends the read', async () => {
    const findMany = vi.fn(async ({ take }: any) => Array.from({ length: take }, (_, i) => ev(`ev_${i}`, 'key_action_proposal', 'kap_fin')));
    const { svc } = base([], [FIN]);
    svc.prisma.client.temporalFlowEvent.findMany = findMany;
    expect(await svc.list('biz_1', { limit: 10 }, blind)).toEqual([]);
    const scanned = (findMany.mock.calls as any[]).reduce((n, c) => n + c[0].take, 0);
    expect(scanned).toBeLessThanOrEqual(10_000);
  });
  it('the limit still holds after the filter, the order is kept, and a reader who reads revenue costs one read of `limit` rows', async () => {
    const events = [ev('b1', 'booking', 'x1'), ev('f1', 'key_action_proposal', 'kap_fin'), ev('b2', 'booking', 'x2'), ev('b3', 'booking', 'x3')];
    const { svc } = base(events, [FIN]);
    expect((await svc.list('biz_1', { limit: 2 }, blind)).map((e: any) => e.id)).toEqual(['b1', 'b2']);
    const owner = base(events, [FIN]);
    expect((await owner.svc.list('biz_1', { limit: 2 }, { id: 'owner', role: 'USER' })).map((e: any) => e.id)).toEqual(['b1', 'f1']);
    expect(owner.findMany).toHaveBeenCalledTimes(1);
    expect((owner.findMany.mock.calls[0] as any[])[0].take).toBe(2);
  });
  it('RED-BEFORE (correctness m6): a negative or fractional limit from a reader is not passed to the database: negative serves nothing, a fraction is truncated', async () => {
    const events = [ev('b1', 'booking', 'x1'), ev('b2', 'booking', 'x2')];
    const { svc, findMany } = base(events, []);
    expect(await svc.list('biz_1', { limit: -5 }, blind)).toEqual([]);
    expect((await svc.list('biz_1', { limit: 1.5 }, blind)).map((e: any) => e.id)).toEqual(['b1']);
    for (const call of findMany.mock.calls as any[]) expect(Number.isInteger(call[0].take) && call[0].take > 0, String(call[0].take)).toBe(true);
  });
});
