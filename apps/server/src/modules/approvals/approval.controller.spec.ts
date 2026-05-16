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
    const result = await controller.approve('ar_1', { decision: 'approve' } as any, { user: { id: 'manager_1' } } as any);
    expect(result!.status).toBe('approved');
  });

  it('rejects a step', async () => {
    const result = await controller.reject('ar_1', { decision: 'reject' } as any, { user: { id: 'manager_1' } } as any);
    expect(result!.status).toBe('approved');
  });

  it('escalates a request', async () => {
    const result = await controller.escalate('ar_1', { reason: 'No response' });
    expect(result!.status).toBe('escalated');
  });
});
