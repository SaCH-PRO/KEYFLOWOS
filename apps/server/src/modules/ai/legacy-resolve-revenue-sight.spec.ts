/**
 * FU-PROPOSAL-REVENUE-SIGHT round 4 (correctness MAJOR-1, security minor 1; owner ruling D-238): resolving a legacy
 * aiApprovalItem not yet migrated keeps its own authority (assertCanResolveApproval, the orchestrator) and answers the
 * resolver what they may see: a financial proposal's redacted view for a resolver without revenue read.
 */
import { describe, it, expect, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { AiController } from './ai.controller';

const ITEM = { id: 'item_1', businessId: 'b1', toolName: 'create_invoice', title: 'Invoice Acme TTD 4,000', riskTier: 1, rationale: null };
const MIGRATED = { id: 'kap_m', status: 'PENDING', title: 'Invoice Acme TTD 4,000', actionType: 'EXECUTE_TOOL', toolName: 'create_invoice' };
const RESOLVED = { ...MIGRATED, status: 'APPROVED', payload: { amount: 4000 } };

function controller(viewForReader: (b: string, p: any, r: any) => Promise<unknown>) {
  const c = Object.create(AiController.prototype) as any;
  c.proposals = { get: vi.fn(async () => { throw new NotFoundException('Action proposal not found'); }), viewForReader: vi.fn(viewForReader) };
  c.prisma = { client: { aiApprovalItem: { findFirst: vi.fn(async () => ITEM), update: vi.fn(async () => ITEM) } } };
  c.assertCanResolveApproval = vi.fn(async () => undefined);
  c.migrateAiApprovalItemToProposal = vi.fn(async () => MIGRATED);
  c.approvalOrchestrator = { approve: vi.fn(async () => RESOLVED), reject: vi.fn(async () => ({ ...RESOLVED, status: 'REJECTED' })) };
  return c;
}

describe('legacy aiApprovalItem resolve fallback (D-238, round 4)', () => {
  for (const resolution of ['approved', 'rejected'] as const) {
    it(`RED-BEFORE: ${resolution} answers through the reader view, for the resolver`, async () => {
      const c = controller(async (_b, p) => ({ id: p.id, status: p.status }));
      const out = await c.resolveLegacyApproval('b1', 'item_1', resolution, 'u_blind', 'USER');
      expect(c.assertCanResolveApproval).toHaveBeenCalledWith('b1', 1, 'u_blind');
      expect(c.proposals.viewForReader).toHaveBeenCalledWith('b1', expect.objectContaining({ id: 'kap_m' }), { id: 'u_blind', role: 'USER' });
      expect(JSON.stringify(out)).not.toContain('4,000');
      expect(JSON.stringify(out)).not.toContain('4000');
    });
  }
});

describe('round 5 (security m3): only a missing proposal falls through to the legacy path', () => {
  it('a proposal read that fails for another reason is not hidden by the legacy path', async () => {
    const c = controller(async (_b, p) => p);
    c.proposals.get = vi.fn(async () => { throw new Error('db down'); });
    await expect(c.resolveLegacyApproval('b1', 'item_1', 'approved', 'u1', 'USER')).rejects.toThrow('db down');
    expect(c.prisma.client.aiApprovalItem.findFirst).not.toHaveBeenCalled();
  });
});
