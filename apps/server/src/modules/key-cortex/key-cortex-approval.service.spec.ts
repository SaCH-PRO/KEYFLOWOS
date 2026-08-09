/**
 * An approval may not be decided by someone outside its tenant.
 *
 * THE DEFECT THIS EXISTS FOR
 *
 * Every decide path in this service used to open the same way:
 *
 *     const proposal = await this.proposalService.getById(requestId)
 *     ...
 *     await this.proposalService.approve(proposal.businessId, requestId, by)
 *
 * `getById` is an unscoped `findUnique({ where: { id } })`
 * (key-action-proposal.service.ts:110). The tenant then handed to the write is
 * `proposal.businessId` — read off the row that was just fetched.
 *
 * The scoped sibling `proposalService.approve()` does check: it calls
 * `get(businessId, proposalId)`, a `findFirst` with both columns
 * (key-action-proposal.service.ts:102). But its expected value came from the
 * object being checked, so the comparison was `row.businessId ===
 * row.businessId`. A check that cannot fail — the same family as the optional
 * dependency that was never provided and the rate-limit count that was always
 * undefined.
 *
 * WHY THE TENANT EXTENSION DID NOT COVER IT
 *
 * The only caller is the WebSocket gateway, and TenantInterceptor's
 * AsyncLocalStorage only exists on the HTTP path. With no ambient business the
 * isolation extension injects no where-clause, so the unscoped findUnique was
 * genuinely unscoped. The one mechanism that might have caught this is off
 * precisely where the hole is.
 *
 * WHAT AN ATTACKER GOT
 *
 * An ordinary authenticated user of business A, connected legitimately to their
 * own socket, could send `key:approve` with a proposal id belonging to business
 * B. The proposal was approved and then EXECUTED against B's data — and the
 * activity notice was pushed to A's room, so nobody in B saw it happen.
 *
 * The assertion below is therefore on the WRITE, not on the thrown error: a
 * version that throws after already calling `proposalService.approve` would
 * still have corrupted B.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { KeyCortexApprovalService } from './key-cortex-approval.service';

const BIZ_A = 'biz_a';
const BIZ_B = 'biz_b';
const PROPOSAL_IN_B = 'prop_owned_by_b';

function proposalRow(businessId: string) {
  return {
    id: PROPOSAL_IN_B,
    businessId,
    userId: 'owner_of_b',
    actionType: 'send_invoice',
    title: 'Send invoice #42',
    status: 'PENDING',
    sourceMode: 'key_cortex',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    payload: {},
  };
}

describe('KeyCortexApprovalService tenant boundary', () => {
  let proposalService: {
    getById: ReturnType<typeof vi.fn>;
    approve: ReturnType<typeof vi.fn>;
    reject: ReturnType<typeof vi.fn>;
  };
  let service: KeyCortexApprovalService;

  beforeEach(() => {
    // getById is unscoped by design — it is the primitive the defect abused.
    // Modelling it faithfully is the point: a mock that scoped it would make
    // this file assert nothing.
    proposalService = {
      getById: vi.fn(async () => proposalRow(BIZ_B)),
      approve: vi.fn(async () => ({ ...proposalRow(BIZ_B), status: 'APPROVED' })),
      reject: vi.fn(async () => ({ ...proposalRow(BIZ_B), status: 'REJECTED' })),
    };
    service = new KeyCortexApprovalService(proposalService as never);
  });

  it('refuses to approve a proposal belonging to another business', async () => {
    await expect(
      service.approveAction(PROPOSAL_IN_B, { approvedBy: 'user_of_a', businessId: BIZ_A }),
    ).rejects.toBeInstanceOf(NotFoundException);

    // The load-bearing assertion. Throwing is not enough: throwing AFTER the
    // write would leave B's proposal approved.
    expect(
      proposalService.approve,
      "business A reached into B's proposal — the write went through",
    ).not.toHaveBeenCalled();
  });

  it('refuses to reject a proposal belonging to another business', async () => {
    await expect(
      service.rejectAction(PROPOSAL_IN_B, { rejectedBy: 'user_of_a', businessId: BIZ_A }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(proposalService.reject).not.toHaveBeenCalled();
  });

  it('reports a foreign proposal as not-found, never as forbidden', async () => {
    // NotFound rather than Forbidden on purpose: a Forbidden would confirm that
    // the id exists, turning the endpoint into an oracle for enumerating other
    // tenants' proposal ids.
    const err = await service
      .approveAction(PROPOSAL_IN_B, { approvedBy: 'user_of_a', businessId: BIZ_A })
      .then(() => null)
      .catch((e: Error) => e);

    expect(err).toBeInstanceOf(NotFoundException);
    expect(String(err?.message)).not.toMatch(/forbidden|not allowed|permission/i);
  });

  // ---- negative controls -------------------------------------------------
  // Without these the three tests above would also pass against a service that
  // refuses every approval, which is not the behaviour anyone wants.

  it("approves normally when the caller is inside the proposal's own business", async () => {
    const result = await service.approveAction(PROPOSAL_IN_B, {
      approvedBy: 'owner_of_b',
      businessId: BIZ_B,
    });

    expect(proposalService.approve).toHaveBeenCalledWith(BIZ_B, PROPOSAL_IN_B, 'owner_of_b');
    expect(result.status).toBe('approved');
  });

  it("rejects normally when the caller is inside the proposal's own business", async () => {
    const result = await service.rejectAction(PROPOSAL_IN_B, {
      rejectedBy: 'owner_of_b',
      businessId: BIZ_B,
      reason: 'not now',
    });

    expect(proposalService.reject).toHaveBeenCalledWith(BIZ_B, PROPOSAL_IN_B, 'owner_of_b', 'not now');
    expect(result.status).toBe('rejected');
  });
});
