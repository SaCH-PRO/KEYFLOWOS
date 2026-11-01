import { describe, expect, it } from 'vitest';
import { ApprovalController } from './approval.controller';
import { ApprovalRequestService } from './approval-request.service';

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
    const result = await controller.escalate('biz_1', 'ar_1', { reason: 'No response' });
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
      ['escalate', () => scoped.escalate('biz_other', 'ar_1', { reason: 'x' })],
    ];
    for (const [name, attempt] of attempts) {
      await expect(attempt(), name).rejects.toMatchObject({ status: 404, message: 'Approval request not found' });
    }
    expect(calls).toEqual([]);
    await expect(scoped.getById('biz_1', 'ar_1')).resolves.toMatchObject({ id: 'ar_1', businessId: 'biz_1' });
  });
});
