import { describe, expect, it } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { ApprovalController } from './approval.controller';
import { ApprovalRequestService } from './approval-request.service';
import { AiApprovalsController } from '../ai/ai-approvals.controller';

function createMockApprovalService(): any {
  return {
    createRequest: async () => ({
      id: 'ar_1',
      status: 'pending',
      title: 'Test',
      steps: [{ stepOrder: 0, approverId: 'user_1', status: 'pending' }],
    }),
    listForBusiness: async () => ({ items: [], total: 0 }),
    getById: async () => ({
      id: 'ar_1',
      businessId: 'biz_1',
      status: 'pending',
      steps: [{ stepOrder: 0, approverId: 'user_1', status: 'pending' }],
    }),
    decideStep: async () => ({ id: 'ar_1', status: 'approved' }),
    delegateStep: async () => ({ id: 'ar_1', status: 'delegated' }),
    cancelRequest: async () => ({ id: 'ar_1', status: 'cancelled' }),
    getPendingForUser: async () => [],
    escalateRequest: async () => ({ id: 'ar_1', status: 'escalated' }),
  };
}

describe('ApprovalController', () => {
  const service = createMockApprovalService();
  const controller = new ApprovalController(service);

  it('creates an approval request', async () => {
    const result = await controller.create('biz_1', {
      requestType: 'expense',
      title: 'Laptop',
      steps: [{ stepOrder: 0, approverId: 'manager_1' }],
    } as any, { user: { id: 'user_1' } } as any);

    expect(result.status).toBe('pending');
  });

  it('approves a step', async () => {
    const result = await controller.approve('biz_1', 'ar_1', { decision: 'approve' } as any, { user: { id: 'manager_1' } } as any);
    expect(result!.status).toBe('approved');
  });

  it('rejects a step', async () => {
    const result = await controller.reject('biz_1', 'ar_1', { decision: 'reject' } as any, { user: { id: 'manager_1' } } as any);
    expect(result!.status).toBe('approved');
  });

  it('escalates a request', async () => {
    const result = await controller.escalate('biz_1', 'ar_1', { reason: 'No response' }, { user: { id: 'user_1' } } as any);
    expect(result!.status).toBe('escalated');
  });

  it("refuses another business's request on every per-request route like an unknown id and calls no service write", async () => {
    const calls: string[] = [];
    const tracked: any = {
      ...createMockApprovalService(),
      decideStep: async () => { calls.push('decideStep'); return {}; },
      delegateStep: async () => { calls.push('delegateStep'); return {}; },
      cancelRequest: async () => { calls.push('cancelRequest'); return {}; },
      escalateRequest: async () => { calls.push('escalateRequest'); return {}; },
    };
    const scoped = new ApprovalController(tracked);
    const req = { user: { id: 'user_1' } } as any;
    const attempts: Array<[string, () => Promise<unknown>]> = [
      ['getById', () => scoped.getById('biz_other', 'ar_1')],
      ['approve', () => scoped.approve('biz_other', 'ar_1', { decision: 'approve' } as any, req)],
      ['reject', () => scoped.reject('biz_other', 'ar_1', { decision: 'reject' } as any, req)],
      ['delegate', () => scoped.delegate('biz_other', 'ar_1', { delegatedTo: 'user_2' } as any, req)],
      ['cancel', () => scoped.cancel('biz_other', 'ar_1', req)],
      ['escalate', () => scoped.escalate('biz_other', 'ar_1', { reason: 'x' }, req)],
    ];
    for (const [name, attempt] of attempts) {
      await expect(attempt(), name).rejects.toMatchObject({ status: 404, message: 'Approval request not found' });
    }
    expect(calls).toEqual([]);
    await expect(scoped.getById('biz_1', 'ar_1')).resolves.toMatchObject({ id: 'ar_1', businessId: 'biz_1' });
  });

  describe('V1-31: approvals carry the real principal, never a fabricated one', () => {
    function tracked() {
      const calls: Array<[string, unknown]> = [];
      const service: any = {
        ...createMockApprovalService(),
        createRequest: async (input: unknown) => { calls.push(['createRequest', input]); return { id: 'ar_1', status: 'pending' }; },
        getPendingForUser: async (businessId: string, userId: string) => { calls.push(['getPendingForUser', { businessId, userId }]); return []; },
        decideStep: async (input: unknown) => { calls.push(['decideStep', input]); return { id: 'ar_1', status: 'approved' }; },
        delegateStep: async (input: unknown) => { calls.push(['delegateStep', input]); return { id: 'ar_1', status: 'delegated' }; },
        cancelRequest: async (approvalId: string, userId: string) => { calls.push(['cancelRequest', { approvalId, userId }]); return { id: 'ar_1', status: 'cancelled' }; },
      };
      return { calls, controller: new ApprovalController(service) };
    }

    const attempts = (controller: ApprovalController, req: any): Array<[string, () => Promise<unknown>]> => [
      ['create', () => controller.create('biz_1', { requestType: 'expense', title: 'Laptop', steps: [{ stepOrder: 0, approverId: 'manager_1' }] } as any, req)],
      ['pendingForMe', () => controller.pendingForMe('biz_1', req)],
      ['approve', () => controller.approve('biz_1', 'ar_1', { comment: 'ok' } as any, req)],
      ['reject', () => controller.reject('biz_1', 'ar_1', { comment: 'no' } as any, req)],
      ['delegate', () => controller.delegate('biz_1', 'ar_1', { delegatedTo: 'user_2' } as any, req)],
      ['cancel', () => controller.cancel('biz_1', 'ar_1', req)],
    ];

    it.each([
      ['no user', {}],
      ['a user with no id', { user: {} }],
      ['an empty id', { user: { id: '' } }],
    ])('with %s, every principal-bearing route answers 401 and calls no service method (it used to act as "system")', async (_label, req) => {
      const { calls, controller } = tracked();
      for (const [name, attempt] of attempts(controller, req)) {
        await expect(attempt(), name).rejects.toBeInstanceOf(UnauthorizedException);
        await expect(attempt(), name).rejects.toMatchObject({ status: 401 });
      }
      expect(calls).toEqual([]);
    });

    it('the authenticated caller is the requester, the approver, the delegator, the canceller and the "pending for me" subject', async () => {
      const { calls, controller } = tracked();
      for (const [, attempt] of attempts(controller, { user: { id: 'manager_1' } })) await attempt();
      expect(calls).toEqual([
        ['createRequest', expect.objectContaining({ businessId: 'biz_1', requesterId: 'manager_1' })],
        ['getPendingForUser', { businessId: 'biz_1', userId: 'manager_1' }],
        ['decideStep', expect.objectContaining({ approvalRequestId: 'ar_1', approverId: 'manager_1', decision: 'approve' })],
        ['decideStep', expect.objectContaining({ approvalRequestId: 'ar_1', approverId: 'manager_1', decision: 'reject' })],
        ['delegateStep', expect.objectContaining({ approvalRequestId: 'ar_1', approverId: 'manager_1', delegatedTo: 'user_2' })],
        ['cancelRequest', { approvalId: 'ar_1', userId: 'manager_1' }],
      ]);
    });

    it('a missing principal is refused before the tenant lookup, so it learns nothing about the request', async () => {
      let lookedUp = 0;
      const controller = new ApprovalController({ ...createMockApprovalService(), getById: async () => { lookedUp += 1; return { id: 'ar_1', businessId: 'biz_1' }; } } as any);
      await expect(controller.approve('biz_other', 'ar_1', {} as any, {} as any)).rejects.toMatchObject({ status: 401 });
      expect(lookedUp).toBe(0);
    });

    it.each([
      ['no request', undefined],
      ['no user', {}],
      ['a user with no id', { user: {} }],
      ['an empty id', { user: { id: '' } }],
    ])('review SEC-V131-3: escalate with %s answers 401 before the tenant lookup and never escalates', async (_label, req) => {
      const calls: string[] = [];
      const controller = new ApprovalController({
        ...createMockApprovalService(),
        getById: async () => { calls.push('getById'); return { id: 'ar_1', businessId: 'biz_1', status: 'pending' }; },
        escalateRequest: async () => { calls.push('escalateRequest'); return { id: 'ar_1', status: 'escalated' }; },
      } as any);
      await expect(controller.escalate('biz_1', 'ar_1', { reason: 'x' }, req as any)).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(controller.escalate('biz_1', 'ar_1', { reason: 'x' }, req as any)).rejects.toMatchObject({ status: 401 });
      expect(calls).toEqual([]);
    });

    it('review SEC-V131-3: an authenticated caller still escalates a request of the path business', async () => {
      const calls: Array<[string, unknown]> = [];
      const controller = new ApprovalController({
        ...createMockApprovalService(),
        escalateRequest: async (approvalId: string, reason?: string) => { calls.push(['escalateRequest', { approvalId, reason }]); return { id: 'ar_1', status: 'escalated' }; },
      } as any);
      await expect(controller.escalate('biz_1', 'ar_1', { reason: 'No response' }, { user: { id: 'manager_1' } } as any)).resolves.toMatchObject({ status: 'escalated' });
      expect(calls).toEqual([['escalateRequest', { approvalId: 'ar_1', reason: 'No response' }]]);
    });

    // V1-31b-KEY-ACTION-ROUTES-BIND closed this: ai-approvals.controller.ts resolved items as
    // req.user?.id ?? 'user'. Over HTTP: test/key-action-routes-bind.integration.test.ts AA-01, AA-02.
    it.each([
      ['no request', undefined],
      ['no user', {}],
      ['a user with no id', { user: {} }],
      ['an empty id', { user: { id: '' } }],
    ])("V1-31b: AiApprovalsController resolve and bulk-resolve with %s answer 401 and resolve nothing (never as 'user')", async (_label, req) => {
      const calls: unknown[][] = [];
      const service: any = {
        resolveItem: async (...args: unknown[]) => { calls.push(['resolveItem', ...args]); return { id: 'item_1' }; },
        resolveBatch: async (...args: unknown[]) => { calls.push(['resolveBatch', ...args]); return { succeeded: 1 }; },
      };
      const controller = new AiApprovalsController(service);
      await expect(controller.resolveItem('biz_1', 'item_1', { resolution: 'approved' } as any, req as any)).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(controller.bulkResolve('biz_1', { ids: ['item_1'], resolution: 'approved' } as any, req as any)).rejects.toMatchObject({ status: 401 });
      expect(calls).toEqual([]);
    });

    it('V1-31b: AiApprovalsController resolves as the authenticated caller', async () => {
      const calls: unknown[][] = [];
      const service: any = {
        resolveItem: async (...args: unknown[]) => { calls.push(['resolveItem', ...args]); return { id: 'item_1' }; },
        resolveBatch: async (...args: unknown[]) => { calls.push(['resolveBatch', ...args]); return { succeeded: 1 }; },
      };
      const controller = new AiApprovalsController(service);
      await controller.resolveItem('biz_1', 'item_1', { resolution: 'approved' } as any, { user: { id: 'manager_1' } } as any);
      await controller.bulkResolve('biz_1', { ids: ['item_1'], resolution: 'rejected' } as any, { user: { id: 'manager_1' } } as any);
      expect(calls).toEqual([
        ['resolveItem', 'biz_1', 'item_1', 'approved', 'manager_1'],
        ['resolveBatch', 'biz_1', ['item_1'], 'rejected', 'manager_1'],
      ]);
    });
  });
});

