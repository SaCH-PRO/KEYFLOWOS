import { describe, it, expect, beforeEach, vi } from 'vitest';
import { KeyCortexActionsService } from '../key-cortex-actions.service';

const mockPrisma = {
  client: {
    cortexActionLog: {
      create: vi.fn(),
    },
    task: {
      create: vi.fn(),
    },
  },
};

const mockToolRegistry = {
  listTools: vi.fn().mockReturnValue([]),
  executeTool: vi.fn(),
};

const mockCommandService = {
  execute: vi.fn(),
  enqueue: vi.fn(),
};

const mockKeyCortexToolRegistry = {
  registerMany: vi.fn(),
  execute: vi.fn(),
  listTools: vi.fn().mockReturnValue([]),
  buildGatewayDefinitions: vi.fn().mockReturnValue([]),
};

const mockEventBus = {
  emit: vi.fn(),
};

const mockApprovalService = {
  createRequest: vi.fn(),
};

function createService(): KeyCortexActionsService {
  return new KeyCortexActionsService(
    mockPrisma as any,
    mockToolRegistry as any,
    mockCommandService as any,
    mockKeyCortexToolRegistry as any,
    mockEventBus as any,
    mockApprovalService as any,
  );
}

describe('KeyCortexActionsService — approval gate', () => {
  let service: KeyCortexActionsService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = createService();
  });

  it('creates an ApprovalRequest for high-impact actions', async () => {
    mockApprovalService.createRequest.mockResolvedValue({ id: 'apr_1' });

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
    expect(approval.approvalRequestId).toBe('apr_1');
    expect(mockApprovalService.createRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: 'biz_1',
        requester: 'key_cortex',
        requesterId: 'user_1',
        actionType: 'CREATE_INVOICE',
        actionModule: 'key_cortex',
      }),
    );
  });

  it('returns approved=false without requestId if approval service is missing', async () => {
    const serviceWithoutApproval = new KeyCortexActionsService(
      mockPrisma as any,
      mockToolRegistry as any,
      mockCommandService as any,
      mockKeyCortexToolRegistry as any,
      mockEventBus as any,
      undefined,
    );

    const approval = await (serviceWithoutApproval as any).requestApproval(
      { actionType: 'CREATE_INVOICE', status: 'pending_approval', description: 'x' },
      { id: 'sess_1', businessId: 'biz_1', userId: 'user_1' } as any,
    );

    expect(approval.approved).toBe(false);
    expect(approval.approvalRequestId).toBeUndefined();
  });

  it('returns approved=false without requestId if persistence fails', async () => {
    mockApprovalService.createRequest.mockRejectedValue(new Error('DB down'));

    const approval = await (service as any).requestApproval(
      { actionType: 'CREATE_INVOICE', status: 'pending_approval', description: 'x' },
      { id: 'sess_1', businessId: 'biz_1', userId: 'user_1' } as any,
    );

    expect(approval.approved).toBe(false);
    expect(approval.approvalRequestId).toBeUndefined();
  });

  it('executeActions marks high-impact action as pending_approval with requestId', async () => {
    mockApprovalService.createRequest.mockResolvedValue({ id: 'apr_2' });

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
    expect(results[0].approvalRequestId).toBe('apr_2');
    expect(results[0].requiresApproval).toBe(true);
  });

  it('executeActions runs low-risk actions without approval via canonical registry', async () => {
    mockKeyCortexToolRegistry.execute.mockResolvedValue({
      success: true,
      data: { taskId: 'task_1', title: 'Follow up' },
    });

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
    expect(mockApprovalService.createRequest).not.toHaveBeenCalled();
    expect(mockKeyCortexToolRegistry.execute).toHaveBeenCalledWith(
      'cortex.create_task',
      expect.objectContaining({ businessId: 'biz_1', sessionId: 'sess_1', userId: 'user_1', autonomyLevel: 4 }),
      expect.objectContaining({ title: 'Follow up' }),
    );
  });

  it('executeActions surfaces tool execution errors', async () => {
    mockKeyCortexToolRegistry.execute.mockResolvedValue({
      success: false,
      error: 'Missing required parameters: title',
    });

    const results = await service.executeActions(
      [
        {
          actionType: 'CREATE_TASK',
          status: 'success',
          description: 'Create follow-up task',
          result: {},
        },
      ],
      { id: 'sess_1', businessId: 'biz_1', userId: 'user_1' } as any,
    );

    expect(results[0].status).toBe('error');
    expect(results[0].error).toContain('missing required parameters');
  });
});
