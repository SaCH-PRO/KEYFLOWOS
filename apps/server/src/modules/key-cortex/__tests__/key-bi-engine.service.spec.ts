import { describe, it, expect, beforeEach, vi } from 'vitest';
import { KeyBiEngineService } from '../key-bi-engine.service';

function createMockPrisma(overrides: {
  businessFindMany?: Array<{ id: string }>;
  businessGenome?: any;
  invoiceCount?: number;
  invoiceAggregate?: any;
  taskCount?: number;
  leadCount?: number;
  dealAggregate?: any;
} = {}) {
  return {
    client: {
      business: {
        findMany: vi.fn().mockResolvedValue(overrides.businessFindMany ?? [{ id: 'biz_1' }]),
      },
      businessGenome: {
        findUnique: vi.fn().mockResolvedValue(overrides.businessGenome ?? null),
      },
      invoice: {
        count: vi.fn().mockResolvedValue(overrides.invoiceCount ?? 0),
        aggregate: vi
          .fn()
          .mockResolvedValue(overrides.invoiceAggregate ?? { _sum: { total: 0 }, _count: { id: 0 } }),
      },
      task: {
        count: vi.fn().mockResolvedValue(overrides.taskCount ?? 0),
      },
      lead: {
        count: vi.fn().mockResolvedValue(overrides.leadCount ?? 0),
      },
      deal: {
        aggregate: vi
          .fn()
          .mockResolvedValue(overrides.dealAggregate ?? { _sum: { value: 0 }, _count: { id: 0 } }),
      },
      businessHealthSnapshot: {
        create: vi.fn().mockResolvedValue({ id: 'snap_1' }),
      },
    },
  };
}

const mockRedis = {
  getJson: vi.fn().mockResolvedValue(null),
  setJson: vi.fn().mockResolvedValue(undefined),
};

function createService(mockPrisma: ReturnType<typeof createMockPrisma>) {
  return new KeyBiEngineService(mockPrisma as any, mockRedis as any);
}

describe('KeyBiEngineService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('refreshBusiness computes a mental model and caches + persists it', async () => {
    const mockPrisma = createMockPrisma({
      businessGenome: {
        businessId: 'biz_1',
        stage: 'growth',
        dnaScores: { execution: 80, strategy: 70, finance: 60, marketing: 75, operations: 65 },
      },
      invoiceAggregate: { _sum: { total: 5000 }, _count: { id: 3 } },
      taskCount: 4,
      leadCount: 8,
      dealAggregate: { _sum: { value: 25000 }, _count: { id: 5 } },
    });

    const service = createService(mockPrisma);
    const model = await service.refreshBusiness('biz_1');

    expect(model.businessId).toBe('biz_1');
    expect(model.healthScore).toBeGreaterThanOrEqual(0);
    expect(model.healthScore).toBeLessThanOrEqual(100);
    expect(model.healthStatus).toBeDefined();
    expect(model.metrics.activeLeads).toBe(8);
    expect(model.metrics.activeDeals).toBe(5);
    expect(model.metrics.activeDealValue).toBe(25000);

    expect(mockRedis.setJson).toHaveBeenCalledWith(
      'key-bi-engine:mental-model:biz_1',
      model,
      15 * 60,
    );
    expect(mockPrisma.client.businessHealthSnapshot.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          businessId: 'biz_1',
          area: 'MENTAL_MODEL',
          score: model.healthScore,
          status: model.healthStatus,
        }),
      }),
    );
  });

  it('getMentalModel returns cached value when available', async () => {
    const cached = {
      businessId: 'biz_1',
      generatedAt: new Date().toISOString(),
      healthScore: 72,
      healthStatus: 'good',
      topRisks: [],
      topOpportunities: [],
      keyTrends: [],
      attentionItems: [],
      metrics: {} as any,
    };
    mockRedis.getJson.mockResolvedValueOnce(cached);

    const service = createService(createMockPrisma());
    const model = await service.getMentalModel('biz_1');

    expect(model).toEqual(cached);
    expect(mockRedis.setJson).not.toHaveBeenCalled();
  });

  it('computeMentalModel flags overdue invoices and tasks as risks', async () => {
    const mockPrisma = createMockPrisma({
      businessGenome: {
        dnaScores: { execution: 40, strategy: 40, finance: 40, marketing: 40, operations: 40 },
      },
      invoiceAggregate: { _sum: { total: 15000 }, _count: { id: 6 } },
      taskCount: 12,
    });

    const service = createService(mockPrisma);
    const model = await service.computeMentalModel('biz_1');

    const riskTypes = model.topRisks.map((r) => r.type);
    expect(riskTypes).toContain('cashflow');
    expect(riskTypes).toContain('operations');
    expect(riskTypes).toContain('genome');
    expect(model.attentionItems.some((i) => i.type === 'overdue_invoice')).toBe(true);
    expect(model.attentionItems.some((i) => i.type === 'overdue_task')).toBe(true);
  });

  it('computeMentalModel surfaces opportunities from leads and deals', async () => {
    const mockPrisma = createMockPrisma({
      invoiceAggregate: { _sum: { total: 0 }, _count: { id: 0 } },
      leadCount: 10,
      dealAggregate: { _sum: { value: 50000 }, _count: { id: 7 } },
    });

    const service = createService(mockPrisma);
    const model = await service.computeMentalModel('biz_1');

    const oppTypes = model.topOpportunities.map((o) => o.type);
    expect(oppTypes).toContain('lead');
    expect(oppTypes).toContain('deal');
  });

  it('refreshAll scans active businesses and isolates failures', async () => {
    const mockPrisma = createMockPrisma({
      businessFindMany: [{ id: 'biz_ok' }, { id: 'biz_fail' }],
    });

    mockPrisma.client.businessGenome.findUnique.mockImplementation((args: any) => {
      if (args.where.businessId === 'biz_fail') {
        return Promise.reject(new Error('genome DB error'));
      }
      return Promise.resolve({ dnaScores: { execution: 70 } });
    });

    const service = createService(mockPrisma);
    await service.refreshAll();

    expect(mockPrisma.client.business.findMany).toHaveBeenCalled();
    expect(mockRedis.setJson).toHaveBeenCalledWith(
      'key-bi-engine:mental-model:biz_ok',
      expect.any(Object),
      15 * 60,
    );
  });

  it('getActiveBusinesses returns empty array on query failure', async () => {
    const mockPrisma = createMockPrisma();
    mockPrisma.client.business.findMany.mockRejectedValue(new Error('DB down'));

    const service = createService(mockPrisma);
    const ids = await (service as any).getActiveBusinesses();

    expect(ids).toEqual([]);
  });

  it('health status maps correctly to score ranges', async () => {
    const mockPrisma = createMockPrisma({
      businessGenome: { dnaScores: { execution: 95, strategy: 95, finance: 95, marketing: 95, operations: 95 } },
      invoiceAggregate: { _sum: { total: 0 }, _count: { id: 0 } },
      taskCount: 0,
      leadCount: 10,
      dealAggregate: { _sum: { value: 10000 }, _count: { id: 2 } },
    });

    const service = createService(mockPrisma);
    const model = await service.computeMentalModel('biz_1');

    expect(model.healthScore).toBeGreaterThanOrEqual(85);
    expect(model.healthStatus).toBe('excellent');
  });
});
