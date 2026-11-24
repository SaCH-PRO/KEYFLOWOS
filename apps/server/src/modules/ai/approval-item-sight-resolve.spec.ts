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
import { approvalItemNeeds } from './approval-item-sight';
import { AgentHealthService } from './agent-health.service';
import { CommandGeneratorService } from '../command/command-generator.service';

const MONEY_ITEM = {
  id: 'item_m', businessId: 'b1', status: 'pending', riskTier: 4, toolName: 'crm_add_note', module: 'crm',
  title: 'Follow up with Acme', description: 'Acme owes TTD 4,000 on invoice INV-7', rationale: null, expectedBenefit: null,
  risks: null, inputPayload: { amount: 4000 }, affectedEntities: null, resolution: null, planStepId: null, approverAssignmentId: 'asg_1',
};
const PLAIN_ITEM = { ...MONEY_ITEM, id: 'item_p', riskTier: 1, title: 'Call Jane about the meeting', description: 'Schedule a call', inputPayload: { contact: 'Jane' } };

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

function oversightWith(item: any, assignment: any, phoneMembers: any[] = [], extraMembership: Record<string, any> = {}) {
  const updates: any[] = [];
  const prisma = {
    client: {
      aiApprovalItem: { findFirst: vi.fn(async ({ where }: any) => (where.id === item.id ? item : null)), update: vi.fn(async (a: any) => { updates.push(a); return item; }) },
      orgAssignment: { findFirst: vi.fn(async () => assignment) },
      membership: {
        findFirst: vi.fn(async () => extraMembership.findFirst ?? assignment?.membership ?? null),
        findUnique: vi.fn(async () => extraMembership.findUnique ?? assignment?.membership ?? null),
        findMany: vi.fn(async () => extraMembership.findMany ?? phoneMembers),
      },
      teamActivityLog: { create: vi.fn(async () => ({})) },
      aiPlanStep: { update: vi.fn(async () => ({})) },
    },
  };
  const svc = new (AiOversightService as any)(prisma, { log: async () => undefined }, { recordApprovalSignal: async () => undefined }, {}, {}, {});
  return { svc, updates };
}

const holder = (scopes: Record<string, string>, userOverrides: Record<string, unknown> = {}) => ({
  id: 'asg_1', businessId: 'b1', userId: 'u_h', membershipId: 'm_h', autoApprovalViaReply: true, contactPhone: null,
  jobRole: { id: 'jr', name: 'Manager', permissions: {}, defaultApprovalTier: 4 },
  membership: {
    id: 'm_h', userId: 'u_h', businessId: 'b1', role: 'STAFF', permissionScopes: scopes, maxApprovalTier: 4,
    user: { deletedAt: null, bannedAt: null, email: 'holder@biz.local', ...userOverrides },
  },
});

describe('reply-based approval (AiOversightService.resolveApprovalByAssignment & approvalVisibleToPosition)', () => {
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

  it('RED-BEFORE (SEC-1 / CR-3 / CR-5): banned/deleted holders and missing-in-business holders have zero sight on position & route notifications', async () => {
    const bannedHolder = holder({ operations: 'write', revenue: 'admin' }, { bannedAt: new Date() });
    const deletedHolder = holder({ operations: 'write', revenue: 'admin' }, { deletedAt: new Date() });
    const activeHolder = holder({ operations: 'write', revenue: 'read' });

    const { svc: bannedSvc } = oversightWith(MONEY_ITEM, bannedHolder);
    expect(await bannedSvc.approvalVisibleToPosition('b1', 'asg_1', MONEY_ITEM)).toBe(false);
    await expect(bannedSvc.resolveApprovalByAssignment(MONEY_ITEM.id, 'b1', 'asg_1', 'approved')).rejects.toBeInstanceOf(NotFoundException);

    const { svc: deletedSvc } = oversightWith(MONEY_ITEM, deletedHolder);
    expect(await deletedSvc.approvalVisibleToPosition('b1', 'asg_1', MONEY_ITEM)).toBe(false);

    // Control: active revenue reader can see MONEY_ITEM via approvalVisibleToPosition (CR-5)
    const { svc: activeSvc } = oversightWith(MONEY_ITEM, activeHolder);
    expect(await activeSvc.approvalVisibleToPosition('b1', 'asg_1', MONEY_ITEM)).toBe(true);

    // Holder-backed assignment whose membership is NOT in businessId fails closed even when phoneMembers has an OWNER
    const foreignHolder = { ...holder({}), membership: null, contactPhone: '+15550009999' };
    const ownerPhoneMember = { role: 'OWNER', permissionScopes: null, user: { deletedAt: null, bannedAt: null } };
    const { svc: foreignSvc } = oversightWith(MONEY_ITEM, foreignHolder, [ownerPhoneMember]);
    expect(await foreignSvc.approvalVisibleToPosition('b1', 'asg_1', MONEY_ITEM)).toBe(false);

    // routeActor: banned member on email route gets redacted notification
    const bannedRouteNotif = await (bannedSvc as any).notificationFor('b1', {
      approverAssignmentId: 'asg_1', approverMembershipId: 'm_h', approverUserId: 'u_h',
      displayName: 'Alice', channel: 'email', contactPhone: null, contactEmail: 'holder@biz.local', method: 'delegation_rule', reason: 'test',
    }, MONEY_ITEM, 4);
    expect(JSON.stringify(bannedRouteNotif)).not.toContain('4,000');

    // routeActor: email channel where contactEmail points to a different/non-member address fails closed
    const mismatchedEmailNotif = await (activeSvc as any).notificationFor('b1', {
      approverAssignmentId: 'asg_1', approverMembershipId: 'm_h', approverUserId: 'u_h',
      displayName: 'Owner', channel: 'email', contactPhone: null, contactEmail: 'assistant@biz.local', method: 'delegation_rule', reason: 'test',
    }, MONEY_ITEM, 4);
    expect(JSON.stringify(mismatchedEmailNotif)).not.toContain('4,000');
  });

  it('RED-BEFORE (SEC-6): resolveApprovalByAssignment answers 404 (not 403) when a hidden item has a different approverAssignmentId', async () => {
    const otherAssigned = { ...MONEY_ITEM, approverAssignmentId: 'asg_other' };
    const { svc } = oversightWith(otherAssigned, holder({ operations: 'write' }));
    await expect(svc.resolveApprovalByAssignment(otherAssigned.id, 'b1', 'asg_1', 'approved')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('SEC-2 & CR-6: approvalItemNeeds Unicode/escape folding and non-double-counted content cap', () => {
  it('RED-BEFORE (SEC-2): catches ZWSP, fullwidth, combining-mark, and JSON-escaped expense terms', () => {
    const base = { toolName: 'crm_add_note', module: 'crm', description: null, rationale: null, expectedBenefit: null, risks: null, inputPayload: null, affectedEntities: null, resolution: null };
    expect(approvalItemNeeds({ ...base, title: 'Call the l\u200Bandlord' })).toContain('expenses');
    expect(approvalItemNeeds({ ...base, title: 'Check \uFF56\uFF45\uFF4E\uFF44\uFF4F\uFF52 status' })).toContain('expenses');
    expect(approvalItemNeeds({ ...base, title: 'Call the landlo\u0301rd' })).toContain('expenses');
    expect(approvalItemNeeds({ ...base, title: 'Check note', inputPayload: { note: 'Call ven\\u0064or about le\\u0061se' } })).toContain('expenses');
    expect(approvalItemNeeds({ ...base, title: 'Pay r\u200Bent 500' })).toEqual(['revenue', 'expenses']);
  });

  it('RED-BEFORE (CR-6): 30 KB clean description stays under MAX_ITEM_CLASSIFIED (not double-counted), and pure expense item needs expenses only', () => {
    const base = { toolName: 'crm_add_note', module: 'crm', rationale: null, expectedBenefit: null, risks: null, inputPayload: null, affectedEntities: null, resolution: null };
    expect(approvalItemNeeds({ ...base, title: 'Plain follow-up', description: 'a'.repeat(30_000) })).toEqual([]);
    expect(approvalItemNeeds({ ...base, title: 'Call the landlord about the lease', description: 'Confirm signing date' })).toEqual(['expenses']);
  });
});

describe('the staff chat bridge names a pending item only to a position that may read it (SEC-4 / CR-2)', () => {
  function bridge(items: any[], visibilityById: Record<string, boolean>, resolveImpl?: (...args: any[]) => Promise<any>) {
    const chats: any[] = [];
    const structure = {
      resolveStaffByPhone: vi.fn(async () => ({ id: 'asg_1', autoApprovalViaReply: true, contactName: 'Pat', activeFlowSessionId: 's1', jobRole: null })),
      setActiveFlowSession: vi.fn(async () => undefined),
    };
    const prisma = {
      client: {
        webhookEvent: { create: vi.fn(async () => ({})) },
        aiApprovalItem: {
          findFirst: vi.fn(async () => items[0] ?? null),
          findMany: vi.fn(async () => items),
        },
      },
    };
    const oversight = {
      approvalVisibleToPosition: vi.fn(async (_b: string, _a: string, it: any) => Boolean(visibilityById[it.id])),
      resolveApprovalByAssignment: vi.fn(resolveImpl ?? (async () => ({ status: 'approved' }))),
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

  it('BRIDGE-01 & RED-BEFORE (SEC-4): a hidden-only item injects NO pendingApprovalHint and discloses NO riskTier', async () => {
    const { svc, chats } = bridge([MONEY_ITEM], { [MONEY_ITEM.id]: false });
    await svc.routeInboundMessage('b1', '+15550001111', 'what is on today?', 'whatsapp', 'ext_1');
    const hints = JSON.stringify(chats[0]?.[4]?.hints ?? []);
    expect(hints).not.toContain('Acme');
    expect(hints).not.toContain('4,000');
    expect(hints).not.toContain('Tier 4');
    expect(hints).not.toContain('pending approval');
  });

  it('BRIDGE-02 & RED-BEFORE (SEC-4 / CR-2): an older hidden money item does not head-of-line block a newer visible item or leak its ID on YES', async () => {
    const { svc, oversight } = bridge([MONEY_ITEM, PLAIN_ITEM], { [MONEY_ITEM.id]: false, [PLAIN_ITEM.id]: true });
    const out = await svc.routeInboundMessage('b1', '+15550001111', 'YES', 'whatsapp', 'ext_2');
    expect(oversight.resolveApprovalByAssignment).toHaveBeenCalledWith(PLAIN_ITEM.id, 'b1', 'asg_1', 'approved');
    expect(JSON.stringify(out)).toContain('Call Jane about the meeting');
    expect(JSON.stringify(out)).not.toContain(MONEY_ITEM.id);
    expect(JSON.stringify(out)).not.toContain('Acme');
  });

  it('BRIDGE-02b & RED-BEFORE (SEC-4): replying YES when only a hidden item is pending does not call resolve or leak item ID', async () => {
    const { svc, oversight } = bridge([MONEY_ITEM], { [MONEY_ITEM.id]: false });
    const out = await svc.routeInboundMessage('b1', '+15550001111', 'YES', 'whatsapp', 'ext_2b');
    expect(oversight.resolveApprovalByAssignment).not.toHaveBeenCalled();
    expect(JSON.stringify(out)).not.toContain(MONEY_ITEM.id);
    expect(JSON.stringify(out)).not.toContain('Acme');
  });

  it('BRIDGE-03: an item the position may read is named as before', async () => {
    const { svc, chats } = bridge([PLAIN_ITEM], { [PLAIN_ITEM.id]: true });
    await svc.routeInboundMessage('b1', '+15550001111', 'what is on today?', 'whatsapp', 'ext_3');
    expect(JSON.stringify(chats[0]?.[4]?.hints ?? [])).toContain('Call Jane about the meeting');
  });
});

describe('SEC-5: untouched AiApprovalItem readers filter by sight', () => {
  it('RED-BEFORE (SEC-5b): AgentHealthService.getHealthDashboard counts only approvals visible to viewerId', async () => {
    const prisma = {
      client: {
        aiPlan: { groupBy: vi.fn(async () => []), findMany: vi.fn(async () => []), update: vi.fn(async () => ({})) },
        aiPlanStep: { findMany: vi.fn(async () => []) },
        delegationLoop: { findMany: vi.fn(async () => []) },
        aiApprovalItem: {
          groupBy: vi.fn(async () => [{ status: 'pending', _count: 2 }]),
          findMany: vi.fn(async () => [MONEY_ITEM, PLAIN_ITEM]),
        },
        aiExecutionLog: { groupBy: vi.fn(async () => []) },
        membership: { findUnique: vi.fn(async ({ where }: any) => where.userId_businessId.userId === 'u_owner' ? { role: 'OWNER', permissionScopes: null } : { role: 'STAFF', permissionScopes: { operations: 'read' } }) },
      },
    };
    const svc = new (AgentHealthService as any)(prisma);
    const opsHealth = await svc.getHealthDashboard('b1', 'u_ops');
    expect(opsHealth.approvals.pending).toBe(1);
    const ownerHealth = await svc.getHealthDashboard('b1', 'u_owner');
    expect(ownerHealth.approvals.pending).toBe(2);
  });

  it('RED-BEFORE (SEC-5c): CommandGeneratorService.seedFromPendingApprovals skips financial/expense approval items', async () => {
    const prisma = {
      client: {
        aiApprovalItem: { findMany: vi.fn(async () => [MONEY_ITEM, PLAIN_ITEM]) },
      },
    };
    const svc = Object.assign(Object.create(CommandGeneratorService.prototype), { prisma });
    const seeds: any[] = [];
    await (svc as any).seedFromPendingApprovals('b1', seeds);
    expect(seeds.map((s) => s.sourceId)).toEqual([PLAIN_ITEM.id]);
    expect(JSON.stringify(seeds)).not.toContain('4,000');
  });
});
