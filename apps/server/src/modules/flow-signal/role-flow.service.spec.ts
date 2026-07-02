import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RoleFlowService } from './role-flow.service';
import { FlowType } from '@prisma/client';

function createMockPrisma(rows: any[] = []) {
  return {
    client: {
      flowSignal: {
        findMany: vi.fn().mockResolvedValue(rows),
      },
    },
  };
}

describe('RoleFlowService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the AR Clerk queue filtered by invoice signals', async () => {
    const rows = [
      { id: 'sig_1', businessId: 'biz_1', type: 'invoice.overdue', flows: [FlowType.FINANCIAL], status: 'RECORDED', importance: 'HIGH', payload: {}, signals: {}, tags: [] },
      { id: 'sig_2', businessId: 'biz_1', type: 'invoice.sent', flows: [FlowType.FINANCIAL], status: 'RECORDED', importance: 'NORMAL', payload: {}, signals: {}, tags: [] },
    ];
    const prisma = createMockPrisma(rows);
    const service = new RoleFlowService(prisma as any);

    const queue = await service.getRoleQueue('biz_1', 'ACCOUNTS_RECEIVABLE_CLERK');

    expect(queue.roleKey).toBe('ACCOUNTS_RECEIVABLE_CLERK');
    expect(queue.total).toBe(2);
    expect(queue.summary.high).toBe(1);
    expect(prisma.client.flowSignal.findMany).toHaveBeenCalledTimes(3); // one per subscription
  });

  it('throws for unknown roles', async () => {
    const prisma = createMockPrisma();
    const service = new RoleFlowService(prisma as any);

    await expect(service.getRoleQueue('biz_1', 'UNKNOWN_ROLE')).rejects.toThrow('not found');
  });
});
