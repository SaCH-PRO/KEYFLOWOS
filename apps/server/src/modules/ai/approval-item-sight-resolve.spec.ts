/**
 * FU-AI-APPROVALS-MONEY-SIGHT (P0; D-100, D-234, D-238): the resolve paths the HTTP suite
 * (test/ai-approvals-money-sight.integration.test.ts) does not reach.
 * - The legacy aiApprovalItem fallback of POST businesses/:b/ai/approvals/:id/resolve (AiController.resolveLegacyApproval):
 *   an item the resolver may not read is answered as one not in the business; one they may read but not act on is 403;
 *   neither is migrated to a proposal nor resolved.
 * - The reply-based approval of a staff position (AiOversightService.resolveApprovalByAssignment): a money item needs
 *   revenue write held by every membership that acts through the position; a contact-only position holds none.
 * - The staff chat bridge names a pending item to a position (its reply and KEY's hint) only when the position may read it.
 */
import { describe, it, expect, vi } from 'vitest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiOversightService } from './ai-oversight.service';
import { StaffChatBridgeService } from '../structure/staff-chat-bridge.service';

const MONEY_ITEM = {
  id: 'item_m', businessId: 'b1', status: 'pending', riskTier: 1, toolName: 'crm_add_note', module: 'crm',
  title: 'Follow up with Acme', description: 'Acme owes TTD 4,000 on invoice INV-7', rationale: null, expectedBenefit: null,
  risks: null, inputPayload: { amount: 4000 }, affectedEntities: null, resolution: null, planStepId: null, approverAssignmentId: 'asg_1',
};
const PLAIN_ITEM = { ...MONEY_ITEM, id: 'item_p', title: 'Call Jane about the meeting', description: 'Schedule a call', inputPayload: { contact: 'Jane' } };

const member = (permissionScopes: Record<string, string> | null, role = 'STAFF') => ({ role, permissionScopes, maxApprovalTier: 4 });

function legacyController(item: any, membership: any) {
  const c = Object.create(AiController.prototype) as any;
  c.proposals = { get: vi.fn(async () => { throw new NotFoundException('Action proposal not found'); }), viewForReader: vi.fn(async (_b: string, p: any) => p) };
  c.prisma = {
    client: {
      aiApprovalItem: { findFirst: vi.fn(async ({ where }: any) => (where.id === item.id && where.businessId === 'b1' ? item : null)), update: vi.fn(async () => item) },
      user: { findUnique: vi.fn(async () => ({ id: 'u1', role: 'USER' })) },
      membership: { findFirst: vi.fn(async () => membership), findUnique: vi.fn(async () => membership) },
    },
  };
  c.migrateAiApprovalItemToProposal = vi.fn(async () => ({ id: 'kap_m', status: 'PENDING' }));
  c.approvalOrchestrator = { approve: vi.fn(async () => ({ id: 'kap_m', status: 'APPROVED' })), reject: vi.fn(async () => ({ id: 'kap_m', status: 'REJECTED' })) };
  return c;
}

describe('legacy aiApprovalItem resolve (AiController.resolveLegacyApproval)', () => {
  it('LEG-01: an item the resolver may not read is answered as an item not in the business', async () => {
    const hidden = legacyController(MONEY_ITEM, member({ operations: 'write' }));
    const err = await hidden.resolveLegacyApproval('b1', MONEY_ITEM.id, 'approved', 'u1', 'USER').catch((e: unknown) => e);
    const foreign = legacyController(MONEY_ITEM, member({ operations: 'write' }));
    const foreignErr = await foreign.resolveLegacyApproval('b1', 'item_elsewhere', 'approved', 'u1', 'USER').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NotFoundException);
    expect((err as Error).message.replace(MONEY_ITEM.id, 'X')).toBe((foreignErr as Error).message.replace('item_elsewhere', 'X'));
    expect(hidden.migrateAiApprovalItemToProposal).not.toHaveBeenCalled();
    expect(hidden.prisma.client.aiApprovalItem.update).not.toHaveBeenCalled();
  });

  it('LEG-02: revenue read but not write: 403, nothing migrated, deferred or resolved', async () => {
    for (const resolution of ['approved', 'rejected', 'deferred'] as const) {
      const c = legacyController(MONEY_ITEM, member({ operations: 'write', revenue: 'read' }));
      await expect(c.resolveLegacyApproval('b1', MONEY_ITEM.id, resolution, 'u1', 'USER')).rejects.toBeInstanceOf(ForbiddenException);
      expect(c.migrateAiApprovalItemToProposal).not.toHaveBeenCalled();
      expect(c.prisma.client.aiApprovalItem.update).not.toHaveBeenCalled();
    }
  });

  it('LEG-03: revenue write resolves it; an item that states nothing resolves at operations alone (no change)', async () => {
    const c = legacyController(MONEY_ITEM, member({ operations: 'write', revenue: 'write' }));
    await c.resolveLegacyApproval('b1', MONEY_ITEM.id, 'approved', 'u1', 'USER');
    expect(c.approvalOrchestrator.approve).toHaveBeenCalled();
    const p = legacyController(PLAIN_ITEM, member({ operations: 'write' }));
    await p.resolveLegacyApproval('b1', PLAIN_ITEM.id, 'approved', 'u1', 'USER');
    expect(p.approvalOrchestrator.approve).toHaveBeenCalled();
  });
});

function oversightWith(item: any, assignment: any, phoneMembers: any[] = []) {
  const updates: any[] = [];
  const prisma = {
    client: {
      aiApprovalItem: { findFirst: vi.fn(async ({ where }: any) => (where.id === item.id ? item : null)), update: vi.fn(async (a: any) => { updates.push(a); return item; }) },
      orgAssignment: { findFirst: vi.fn(async () => assignment) },
      membership: { findUnique: vi.fn(async () => assignment.membership), findMany: vi.fn(async () => phoneMembers) },
      teamActivityLog: { create: vi.fn(async () => ({})) },
      aiPlanStep: { update: vi.fn(async () => ({})) },
    },
  };
  const svc = new (AiOversightService as any)(prisma, { log: async () => undefined }, { recordApprovalSignal: async () => undefined }, {}, {}, {});
  return { svc, updates };
}

const holder = (scopes: Record<string, string>) => ({
  id: 'asg_1', businessId: 'b1', userId: 'u_h', membershipId: 'm_h', autoApprovalViaReply: true, contactPhone: null,
  jobRole: { id: 'jr', name: 'Manager', permissions: {}, defaultApprovalTier: 4 },
  membership: { id: 'm_h', userId: 'u_h', businessId: 'b1', role: 'STAFF', permissionScopes: scopes, maxApprovalTier: 4, user: { deletedAt: null, bannedAt: null } },
});

describe('reply-based approval (AiOversightService.resolveApprovalByAssignment)', () => {
  it('BY-01: a position whose holder has no revenue read: the money item is answered as not found, nothing resolved', async () => {
    const { svc, updates } = oversightWith(MONEY_ITEM, holder({ operations: 'write' }));
    await expect(svc.resolveApprovalByAssignment(MONEY_ITEM.id, 'b1', 'asg_1', 'approved')).rejects.toBeInstanceOf(NotFoundException);
    expect(updates).toEqual([]);
  });

  it('BY-02: revenue read but not write: 403, nothing resolved', async () => {
    const { svc, updates } = oversightWith(MONEY_ITEM, holder({ operations: 'write', revenue: 'read' }));
    await expect(svc.resolveApprovalByAssignment(MONEY_ITEM.id, 'b1', 'asg_1', 'approved')).rejects.toBeInstanceOf(ForbiddenException);
    expect(updates).toEqual([]);
  });

  it('BY-03: a contact-only position (no membership) holds no sight: the money item is not acted on', async () => {
    const contactOnly = { ...holder({}), userId: null, membershipId: null, membership: null };
    const { svc, updates } = oversightWith(MONEY_ITEM, contactOnly);
    await expect(svc.resolveApprovalByAssignment(MONEY_ITEM.id, 'b1', 'asg_1', 'approved')).rejects.toBeInstanceOf(NotFoundException);
    expect(updates).toEqual([]);
  });

  it('BY-04: revenue write resolves it (no change for an entitled holder)', async () => {
    const { svc, updates } = oversightWith(MONEY_ITEM, holder({ operations: 'write', revenue: 'write' }));
    await svc.resolveApprovalByAssignment(MONEY_ITEM.id, 'b1', 'asg_1', 'approved');
    expect(updates.some((u) => u.data?.status === 'approved')).toBe(true);
  });
});

describe('the staff chat bridge names a pending item only to a position that may read it', () => {
  function bridge(item: any, visible: boolean) {
    const chats: any[] = [];
    const structure = {
      resolveStaffByPhone: vi.fn(async () => ({ id: 'asg_1', autoApprovalViaReply: true, contactName: 'Pat', activeFlowSessionId: 's1', jobRole: null })),
      setActiveFlowSession: vi.fn(async () => undefined),
    };
    const prisma = { client: { webhookEvent: { create: vi.fn(async () => ({})) }, aiApprovalItem: { findFirst: vi.fn(async () => item) } } };
    const oversight = {
      approvalVisibleToPosition: vi.fn(async () => visible),
      resolveApprovalByAssignment: vi.fn(async () => { throw new ForbiddenException('refused'); }),
    };
    const orchestrator = {
      getConversationHistory: vi.fn(async () => []),
      chat: vi.fn(async (...args: any[]) => { chats.push(args); return { reply: 'ok', sessionId: 's1' }; }),
    };
    const policy = { envelopeForPosition: vi.fn(() => null), holderForPosition: vi.fn(() => null) };
    const moduleRef = {
      get: vi.fn((token: any) => {
        const name = token?.name ?? '';
        if (name === 'AiOversightService') return oversight;
        if (name === 'FlowOrchestratorService') return orchestrator;
        return policy;
      }),
    };
    const svc = new (StaffChatBridgeService as any)(structure, prisma, moduleRef);
    return { svc, chats, oversight };
  }

  it('BRIDGE-01: a hidden item is not named in KEY\'s hint', async () => {
    const { svc, chats } = bridge(MONEY_ITEM, false);
    await svc.routeInboundMessage('b1', '+15550001111', 'what is on today?', 'whatsapp', 'ext_1');
    const hints = JSON.stringify(chats[0]?.[4]?.hints ?? []);
    expect(hints).not.toContain('Acme');
    expect(hints).not.toContain('4,000');
  });

  it('BRIDGE-02: a hidden item is not named in the reply to a decision', async () => {
    const { svc } = bridge(MONEY_ITEM, false);
    const out = await svc.routeInboundMessage('b1', '+15550001111', 'YES', 'whatsapp', 'ext_2');
    expect(JSON.stringify(out)).not.toContain('Acme');
  });

  it('BRIDGE-03: an item the position may read is named as before', async () => {
    const { svc, chats } = bridge(PLAIN_ITEM, true);
    await svc.routeInboundMessage('b1', '+15550001111', 'what is on today?', 'whatsapp', 'ext_3');
    expect(JSON.stringify(chats[0]?.[4]?.hints ?? [])).toContain('Call Jane about the meeting');
  });
});
