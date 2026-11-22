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
