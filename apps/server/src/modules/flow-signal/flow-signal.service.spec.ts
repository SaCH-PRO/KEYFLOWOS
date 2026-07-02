import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FlowSignalService } from './flow-signal.service';
import { FlowType } from '@prisma/client';

function createMockPrisma(rows: any[] = []) {
  return {
    client: {
      flowSignal: {
        create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'sig_1', ...data })),
        findMany: vi.fn().mockResolvedValue(rows),
        count: vi.fn().mockResolvedValue(rows.length),
        update: vi.fn().mockImplementation(({ data, where }: any) =>
          Promise.resolve({ id: where.id, businessId: where.businessId, ...rows.find((r) => r.id === where.id), ...data }),
        ),
      },
    },
  };
}

describe('FlowSignalService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('emits a signal with routed flows', async () => {
    const prisma = createMockPrisma();
    const service = new FlowSignalService(prisma as any);

    const result = await service.emit({
      businessId: 'biz_1',
      source: 'proactive_watcher',
      type: 'invoice.overdue',
      flows: [FlowType.FINANCIAL, FlowType.TEMPORAL, FlowType.PEOPLE],
      title: 'Invoice overdue',
      ownerRoleHint: 'ACCOUNTS_RECEIVABLE_CLERK',
      importance: 'HIGH',
      payload: { invoiceId: 'inv_1' },
    });

    expect(prisma.client.flowSignal.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          business: { connect: { id: 'biz_1' } },
          type: 'invoice.overdue',
          flows: [FlowType.FINANCIAL, FlowType.TEMPORAL, FlowType.PEOPLE],
          ownerRoleHint: 'ACCOUNTS_RECEIVABLE_CLERK',
          importance: 'HIGH',
        }),
      }),
    );
    expect(result.type).toBe('invoice.overdue');
    expect(result.flows).toEqual([FlowType.FINANCIAL, FlowType.TEMPORAL, FlowType.PEOPLE]);
  });

  it('lists signals by flow type', async () => {
    const rows = [
      { id: 'sig_1', businessId: 'biz_1', type: 'invoice.overdue', flows: [FlowType.FINANCIAL], status: 'RECORDED', importance: 'HIGH', payload: {}, signals: {}, tags: [] },
    ];
    const prisma = createMockPrisma(rows);
    const service = new FlowSignalService(prisma as any);

    const result = await service.list('biz_1', { flows: FlowType.FINANCIAL });

    expect(prisma.client.flowSignal.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ businessId: 'biz_1', flows: { hasEvery: [FlowType.FINANCIAL] } }),
      }),
    );
    expect(result.items).toHaveLength(1);
  });

  it('marks a signal resolved', async () => {
    const rows = [{ id: 'sig_1', businessId: 'biz_1', status: 'RECORDED' }];
    const prisma = createMockPrisma(rows);
    const service = new FlowSignalService(prisma as any);

    const result = await service.markResolved('biz_1', 'sig_1');

    expect(prisma.client.flowSignal.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'sig_1', businessId: 'biz_1' },
        data: expect.objectContaining({ status: 'RESOLVED' }),
      }),
    );
    expect(result.status).toBe('RESOLVED');
  });
});
