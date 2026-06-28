import { describe, it, expect, beforeEach, vi } from 'vitest';
import { KeyCortexActionsService } from '../key-cortex-actions.service';

const mockPrisma = {
  client: {
    aiApprovalRequest: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
    cortexActionLog: {
      create: vi.fn(),
    },
  },
};

const mockToolRegistry = {
  listTools: vi.fn(),
};

const mockCommandService = {
  execute: vi.fn(),
};

const mockApprovalService = {
  createRequest: vi.fn(),
};

function createService(): KeyCortexActionsService {
  return new KeyCortexActionsService(
    mockPrisma as any,
    mockToolRegistry as any,
    mockCommandService as any,
    mockApprovalService as any,
  );
}

describe('KeyCortexActionsService — approval gate', () => {
  let service: KeyCortexActionsService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = createService();
  });

  it('creates an AiApprovalRequest for high-impact actions', async () => {
    mockPrisma.client.aiApprovalRequest.create.mockResolvedValue({ id: 'ar_1' });

    const approval = await service['requestApproval'](
      {
        actionType: 'CREATE_INVOICE',
        status: 'pending_approval',
        description: 'Create invoice for $5000',
        result: { amount: 5000 },
      },
      { id: 'sess_1', businessId: 'biz_1', userId: 'user_1' } as any,
    );

    expect(approval.approved).toBe(false);
    expect(approval.approvalRequestId).toBe('ar_1');
    expect(mockPrisma.client.aiApprovalRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          businessId: 'biz_1',
          userId: 'user_1',
          module: 'key_cortex',
          action: 'CREATE_INVOICE',
          status: 'PENDING',
        }),
      }),
    );
  });

  it('also creates a dashboard ApprovalRequest when approval service is available', async () => {
    mockPrisma.client.aiApprovalRequest.create.mockResolvedValue({ id: 'ar_1' });
    mockApprovalService.createRequest.mockResolvedValue({ id: 'apr_1' });

    await (service as any).requestApproval(
      {
        actionType: 'SEND_EMAIL',
        status: 'pending_approval',
        description: 'Send campaign email',
      },
      { id: 'sess_1', businessId: 'biz_1', userId: 'user_1' } as any,
    );

    expect(mockApprovalService.createRequest).toHaveBeenCalled();
  });

  it('returns approved=false without requestId if persistence fails', async () => {
    mockPrisma.client.aiApprovalRequest.create.mockRejectedValue(new Error('DB down'));

    const approval = await (service as any).requestApproval(
      { actionType: 'CREATE_INVOICE', status: 'pending_approval', description: 'x' },
      { id: 'sess_1', businessId: 'biz_1', userId: 'user_1' } as any,
    );

    expect(approval.approved).toBe(false);
    expect(approval.approvalRequestId).toBeUndefined();
  });

  it('executeActions marks high-impact action as pending_approval with requestId', async () => {
    mockPrisma.client.aiApprovalRequest.create.mockResolvedValue({ id: 'ar_2' });

    const results = await service.executeActions(
      [
        {
          actionType: 'CREATE_INVOICE',
          status: 'success',
          description: 'Create invoice',
          result: { customerId: 'cust_1' },
        },
      ],
      { id: 'sess_1', businessId: 'biz_1', userId: 'user_1' } as any,
    );

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('pending_approval');
    expect(results[0].approvalRequestId).toBe('ar_2');
    expect(results[0].requiresApproval).toBe(true);
  });

  it('executeActions runs low-risk actions without approval', async () => {
    const results = await service.executeActions(
      [
        {
          actionType: 'CREATE_TASK',
          status: 'success',
          description: 'Create follow-up task',
          result: { title: 'Follow up' },
        },
      ],
      { id: 'sess_1', businessId: 'biz_1', userId: 'user_1' } as any,
    );

    expect(results[0].status).not.toBe('pending_approval');
    expect(mockPrisma.client.aiApprovalRequest.create).not.toHaveBeenCalled();
  });
});
