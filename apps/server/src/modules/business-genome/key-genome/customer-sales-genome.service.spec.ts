import { describe, expect, it, vi } from 'vitest';
import { CustomerSalesGenomeService } from './customer-sales-genome.service';
import type { GenomeCustomerSalesSnapshotData } from './key-genome.types';

function makeService() {
  const storedSnapshots: any[] = [];
  const storedMemory: any[] = [];
  let nextSnapshotId = 1;
  let nextSignalId = 1;
  let nextRecId = 1;

  const prisma = {
    client: {
      genomeCustomerSalesSnapshot: {
        create: vi.fn(async ({ data }: { data: any }) => {
          const row = { id: `cssnap_${nextSnapshotId++}`, ...data };
          storedSnapshots.push(row);
          return row;
        }),
        findFirst: vi.fn(async ({ where }: { where: any }) => {
          const matches = storedSnapshots.filter(
            (r) => r.businessId === where.businessId && (where.period === undefined || r.period === where.period),
          );
          matches.sort((a: any, b: any) => new Date(b.computedAt).getTime() - new Date(a.computedAt).getTime());
          return matches[0] ?? null;
        }),
        findMany: vi.fn(async ({ where, take }: { where: any; take?: number }) => {
          let results = storedSnapshots.filter((r) => r.businessId === where.businessId);
          if (where.period !== undefined) results = results.filter((r) => r.period === where.period);
          if (where.overallRisk) results = results.filter((r) => r.overallRisk === where.overallRisk);
          results.sort((a: any, b: any) => new Date(b.computedAt).getTime() - new Date(a.computedAt).getTime());
          return results.slice(0, take);
        }),
      },
    },
  } as any;

  const financialMetrics = {
    getLatestMetricsByType: vi.fn().mockResolvedValue({}),
  };

  const segments = {
    listSegments: vi.fn().mockResolvedValue([]),
    upsertSegment: vi.fn().mockResolvedValue({}),
    deleteSegment: vi.fn().mockResolvedValue({ deleted: true }),
  };

  const motions = {
    listMotions: vi.fn().mockResolvedValue([]),
    upsertMotion: vi.fn().mockResolvedValue({}),
    deleteMotion: vi.fn().mockResolvedValue({ deleted: true }),
  };

  const signals = {
    createSignals: vi.fn().mockImplementation(async (inputs: any[]) => {
      return inputs.map((input) => ({
        id: `sig_${nextSignalId++}`,
        businessId: input.businessId,
        signalType: input.signalType,
        section: input.section,
        domain: input.domain,
        field: input.field,
        reason: input.reason,
        confidence: input.confidence,
        status: 'NEW',
        evidence: [],
        createdAt: new Date().toISOString(),
        reviewedAt: null,
      }));
    }),
  };

  const recommendations = {
    createRecommendation: vi.fn().mockImplementation(async (input: any) => ({
      id: `rec_${nextRecId++}`,
      ...input,
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
      reviewedAt: null,
      outcomeTrackedAt: null,
    })),
  };

  const memory = {
    createMemoryEvent: vi.fn().mockImplementation(async (input: any) => {
      const row = { id: `mem_${storedMemory.length + 1}`, ...input, createdAt: new Date() };
      storedMemory.push(row);
      return row;
    }),
  };

  const departmentReadiness = {
    computeOneDepartment: vi.fn().mockResolvedValue({ code: 'SALES' }),
  };

  const service = new CustomerSalesGenomeService(
    prisma,
    financialMetrics as any,
    segments as any,
    motions as any,
    signals as any,
    recommendations as any,
    memory as any,
    departmentReadiness as any,
  );

  return {
    service,
    prisma,
    financialMetrics,
    segments,
    motions,
    signals,
    recommendations,
    memory,
    departmentReadiness,
    storedSnapshots,
    storedMemory,
  };
}

describe('CustomerSalesGenomeService', () => {
  it('computes snapshot with complete data', async () => {
    const { service, financialMetrics, segments, motions } = makeService();
    financialMetrics.getLatestMetricsByType.mockResolvedValue({
      REVENUE: { value: 100000 },
      CUSTOMER_ACQUISITION_COST: { value: 200 },
      LIFETIME_VALUE: { value: 1200 },
      AVERAGE_ORDER_VALUE: { value: 100 },
      GROSS_MARGIN_PERCENT: { value: 60 },
    });
    segments.listSegments.mockResolvedValue([
      {
        id: 'seg_1',
        businessId: 'biz_1',
        name: 'SMB',
        segmentType: 'HIGH_VALUE',
        estimatedSize: 100,
        averageRevenue: 1000,
        churnRate: 0.05,
        lifetimeValue: 1200,
        acquisitionCost: 200,
        confidence: 0.8,
        tags: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);
    motions.listMotions.mockResolvedValue([
      {
        id: 'mot_1',
        businessId: 'biz_1',
        name: 'Inbound',
        motionType: 'INBOUND',
        stage: 'AWARENESS',
        conversionRate: 0.04,
        volume: 1000,
        isActive: true,
        confidence: 0.8,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);

    const snapshot = await service.computeCustomerSalesSnapshot('biz_1');

    expect(snapshot.totalCustomers).toBe(100);
    expect(snapshot.lifetimeValue).toBe(1200);
    expect(snapshot.customerAcquisitionCost).toBe(200);
    expect(snapshot.ltvCacRatio).toBeCloseTo(6);
    expect(snapshot.revenueQualityScore).toBeGreaterThan(0);
    expect(snapshot.revenueQualityScore).toBeLessThanOrEqual(100);
  });

  it('detects critical CAC/LTV economics', async () => {
    const { service, financialMetrics } = makeService();
    financialMetrics.getLatestMetricsByType.mockResolvedValue({
      REVENUE: { value: 10000 },
      CUSTOMER_ACQUISITION_COST: { value: 500 },
      LIFETIME_VALUE: { value: 300 },
    });

    const snapshot = await service.computeCustomerSalesSnapshot('biz_1');

    expect(snapshot.ltvCacRatio).toBeCloseTo(0.6);
    expect(snapshot.cacRisk).toBe('CRITICAL');
    expect(snapshot.warnings.some((w) => w.code === 'CAC_RISK')).toBe(true);
  });

  it('identifies missing customer/sales inputs', async () => {
    const { service } = makeService();

    const snapshot = await service.computeCustomerSalesSnapshot('biz_1');

    expect(snapshot.missingInputs.length).toBeGreaterThan(0);
    expect(snapshot.missingInputs).toContain('customer_segments');
    expect(snapshot.missingInputs).toContain('sales_motions');
  });

  it('writes memory event on snapshot compute', async () => {
    const { service, memory } = makeService();

    await service.computeCustomerSalesSnapshot('biz_1');

    expect(memory.createMemoryEvent).toHaveBeenCalled();
    const call = memory.createMemoryEvent.mock.calls[0][0];
    expect(call.eventType).toBe('CUSTOMER_SALES_SNAPSHOT_COMPUTED');
  });

  it('recomputes relevant departments after snapshot', async () => {
    const { service, departmentReadiness } = makeService();

    await service.computeCustomerSalesSnapshot('biz_1');

    expect(departmentReadiness.computeOneDepartment).toHaveBeenCalledWith('biz_1', 'SALES');
    expect(departmentReadiness.computeOneDepartment).toHaveBeenCalledWith('biz_1', 'CUSTOMER_SUCCESS');
    expect(departmentReadiness.computeOneDepartment).toHaveBeenCalledWith('biz_1', 'CFO_FINANCE');
  });

  it('generates customer/sales signals from snapshot', async () => {
    const { service, financialMetrics, signals } = makeService();
    financialMetrics.getLatestMetricsByType.mockResolvedValue({
      CUSTOMER_ACQUISITION_COST: { value: 500 },
      LIFETIME_VALUE: { value: 300 },
    });

    await service.computeCustomerSalesSnapshot('biz_1');
    const generated = await service.generateCustomerSalesSignals('biz_1');

    expect(signals.createSignals).toHaveBeenCalled();
    expect(generated.length).toBeGreaterThan(0);
    expect(generated[0].businessId).toBe('biz_1');
  });

  it('generates customer/sales recommendations from snapshot', async () => {
    const { service, financialMetrics, recommendations } = makeService();
    financialMetrics.getLatestMetricsByType.mockResolvedValue({
      CUSTOMER_ACQUISITION_COST: { value: 500 },
      LIFETIME_VALUE: { value: 300 },
    });

    await service.computeCustomerSalesSnapshot('biz_1');
    const generated = await service.generateCustomerSalesRecommendations('biz_1');

    expect(recommendations.createRecommendation).toHaveBeenCalled();
    expect(generated.length).toBeGreaterThan(0);
  });

  it('lists customer/sales snapshots', async () => {
    const { service, financialMetrics } = makeService();
    financialMetrics.getLatestMetricsByType.mockResolvedValue({
      REVENUE: { value: 10000 },
    });

    await service.computeCustomerSalesSnapshot('biz_1');
    await service.computeCustomerSalesSnapshot('biz_1');
    const list = await service.listCustomerSalesSnapshots('biz_1');

    expect(list.length).toBe(2);
  });
});
