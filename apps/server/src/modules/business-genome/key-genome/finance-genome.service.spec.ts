import { describe, expect, it, vi } from 'vitest';
import { FinanceGenomeService } from './finance-genome.service';
import type { GenomeFinanceSnapshotData } from './key-genome.types';

function makeService() {
  const storedSnapshots: any[] = [];
  const storedMemory: any[] = [];
  let nextSnapshotId = 1;
  let nextSignalId = 1;
  let nextRecId = 1;

  const prisma = {
    client: {
      genomeFinanceSnapshot: {
        create: vi.fn(async ({ data }: { data: any }) => {
          const row = { id: `finsnap_${nextSnapshotId++}`, ...data };
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

  const metricService = {
    upsertMetric: vi.fn().mockResolvedValue({}),
    listMetrics: vi.fn().mockResolvedValue([]),
    getLatestMetric: vi.fn().mockResolvedValue(null),
    getLatestMetricsByType: vi.fn().mockResolvedValue({}),
    deleteMetric: vi.fn().mockResolvedValue({ deleted: true }),
  };

  const factService = {
    getFact: vi.fn().mockResolvedValue(null),
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
    computeOneDepartment: vi.fn().mockResolvedValue({ code: 'CFO_FINANCE' }),
  };

  const service = new FinanceGenomeService(
    prisma,
    metricService as any,
    factService as any,
    signals as any,
    recommendations as any,
    memory as any,
    departmentReadiness as any,
  );

  return {
    service,
    prisma,
    metricService,
    factService,
    signals,
    recommendations,
    memory,
    departmentReadiness,
    storedSnapshots,
    storedMemory,
  };
}

describe('FinanceGenomeService', () => {
  it('computes snapshot with complete metrics', async () => {
    const { service, metricService } = makeService();
    metricService.getLatestMetricsByType.mockResolvedValue({
      REVENUE: { value: 100000, currency: 'TTD', confidence: 0.9 },
      GROSS_PROFIT: { value: 60000, currency: 'TTD', confidence: 0.9 },
      NET_PROFIT: { value: 15000, currency: 'TTD', confidence: 0.8 },
      MONTHLY_EXPENSE: { value: 10000, currency: 'TTD', confidence: 0.9 },
      CASH_ON_HAND: { value: 50000, currency: 'TTD', confidence: 0.95 },
    });

    const snapshot = await service.computeFinanceSnapshot('biz_1');

    expect(snapshot.revenue).toBe(100000);
    expect(snapshot.grossMarginPercent).toBeCloseTo(60);
    expect(snapshot.netMarginPercent).toBeCloseTo(15);
    expect(snapshot.runwayMonths).toBeCloseTo(5);
    expect(snapshot.healthScore).toBeGreaterThan(0);
  });

  it('detects critical low runway', async () => {
    const { service, metricService } = makeService();
    metricService.getLatestMetricsByType.mockResolvedValue({
      MONTHLY_EXPENSE: { value: 10000, currency: 'TTD', confidence: 0.9 },
      CASH_ON_HAND: { value: 5000, currency: 'TTD', confidence: 0.9 },
    });

    const snapshot = await service.computeFinanceSnapshot('biz_1');

    expect(snapshot.runwayMonths).toBeCloseTo(0.5);
    expect(snapshot.cashFlowRisk).toBe('CRITICAL');
    expect(snapshot.warnings.some((w) => w.code === 'LOW_RUNWAY')).toBe(true);
  });

  it('detects negative margin', async () => {
    const { service, metricService } = makeService();
    metricService.getLatestMetricsByType.mockResolvedValue({
      REVENUE: { value: 10000, currency: 'TTD', confidence: 0.9 },
      NET_PROFIT: { value: -2000, currency: 'TTD', confidence: 0.9 },
    });

    const snapshot = await service.computeFinanceSnapshot('biz_1');

    expect(snapshot.netMarginPercent).toBeCloseTo(-20);
    expect(snapshot.marginRisk).toBe('CRITICAL');
    expect(snapshot.warnings.some((w) => w.code === 'NEGATIVE_NET_MARGIN')).toBe(true);
  });

  it('identifies missing finance inputs', async () => {
    const { service, metricService } = makeService();
    metricService.getLatestMetricsByType.mockResolvedValue({});

    const snapshot = await service.computeFinanceSnapshot('biz_1');

    expect(snapshot.missingInputs.length).toBeGreaterThan(0);
    expect(snapshot.missingInputs).toContain('revenue');
    expect(snapshot.missingInputs).toContain('monthly_expenses');
  });

  it('computes health score between 0 and 100', async () => {
    const { service, metricService } = makeService();
    metricService.getLatestMetricsByType.mockResolvedValue({
      REVENUE: { value: 100000, currency: 'TTD', confidence: 0.9 },
      GROSS_PROFIT: { value: 60000, currency: 'TTD', confidence: 0.9 },
      NET_PROFIT: { value: 15000, currency: 'TTD', confidence: 0.8 },
      MONTHLY_EXPENSE: { value: 10000, currency: 'TTD', confidence: 0.9 },
      CASH_ON_HAND: { value: 100000, currency: 'TTD', confidence: 0.95 },
      TAX_RESERVE: { value: 15000, currency: 'TTD', confidence: 0.9 },
    });

    const snapshot = await service.computeFinanceSnapshot('biz_1');

    expect(snapshot.healthScore).toBeGreaterThanOrEqual(0);
    expect(snapshot.healthScore).toBeLessThanOrEqual(100);
  });

  it('writes memory event on snapshot compute', async () => {
    const { service, memory, metricService } = makeService();
    metricService.getLatestMetricsByType.mockResolvedValue({
      REVENUE: { value: 100000, currency: 'TTD', confidence: 0.9 },
    });

    await service.computeFinanceSnapshot('biz_1');

    expect(memory.createMemoryEvent).toHaveBeenCalled();
    const call = memory.createMemoryEvent.mock.calls[0][0];
    expect(call.eventType).toBe('FINANCE_SNAPSHOT_COMPUTED');
  });

  it('recomputes CFO_FINANCE department after snapshot', async () => {
    const { service, departmentReadiness, metricService } = makeService();
    metricService.getLatestMetricsByType.mockResolvedValue({
      REVENUE: { value: 100000, currency: 'TTD', confidence: 0.9 },
    });

    await service.computeFinanceSnapshot('biz_1');

    expect(departmentReadiness.computeOneDepartment).toHaveBeenCalledWith('biz_1', 'CFO_FINANCE');
  });

  it('generates finance signals from snapshot', async () => {
    const { service, signals, metricService } = makeService();
    metricService.getLatestMetricsByType.mockResolvedValue({
      MONTHLY_EXPENSE: { value: 10000, currency: 'TTD', confidence: 0.9 },
      CASH_ON_HAND: { value: 5000, currency: 'TTD', confidence: 0.9 },
    });

    await service.computeFinanceSnapshot('biz_1');
    const generated = await service.generateFinanceSignals('biz_1');

    expect(signals.createSignals).toHaveBeenCalled();
    expect(generated.length).toBeGreaterThan(0);
    expect(generated[0].businessId).toBe('biz_1');
  });

  it('generates finance recommendations from snapshot', async () => {
    const { service, recommendations, metricService } = makeService();
    metricService.getLatestMetricsByType.mockResolvedValue({
      MONTHLY_EXPENSE: { value: 10000, currency: 'TTD', confidence: 0.9 },
      CASH_ON_HAND: { value: 5000, currency: 'TTD', confidence: 0.9 },
    });

    await service.computeFinanceSnapshot('biz_1');
    const generated = await service.generateFinanceRecommendations('biz_1');

    expect(recommendations.createRecommendation).toHaveBeenCalled();
    expect(generated.length).toBeGreaterThan(0);
  });

  it('lists finance snapshots', async () => {
    const { service, metricService } = makeService();
    metricService.getLatestMetricsByType.mockResolvedValue({
      REVENUE: { value: 100000, currency: 'TTD', confidence: 0.9 },
    });

    await service.computeFinanceSnapshot('biz_1');
    await service.computeFinanceSnapshot('biz_1');
    const list = await service.listFinanceSnapshots('biz_1');

    expect(list.length).toBe(2);
  });
});
