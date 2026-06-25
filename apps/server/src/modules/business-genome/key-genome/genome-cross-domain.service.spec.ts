import { describe, expect, it, vi } from 'vitest';
import { GenomeCrossDomainService } from './genome-cross-domain.service';
import type {
  GenomeFinanceSnapshotData,
  GenomeCustomerSalesSnapshotData,
  GenomeOperationsSnapshotData,
  GenomeMarketingGrowthSnapshotData,
} from './key-genome.types';

function makeFinanceSnapshot(
  overrides: Partial<GenomeFinanceSnapshotData> = {},
): GenomeFinanceSnapshotData {
  return {
    id: 'fin_1',
    businessId: 'biz_1',
    currency: 'TTD',
    healthScore: 75,
    cashFlowRisk: 'LOW',
    marginRisk: 'MEDIUM',
    pricingRisk: 'LOW',
    taxRisk: 'LOW',
    overallRisk: 'MEDIUM',
    missingInputs: [],
    warnings: [],
    recommendations: [],
    computedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeCustomerSalesSnapshot(
  overrides: Partial<GenomeCustomerSalesSnapshotData> = {},
): GenomeCustomerSalesSnapshotData {
  return {
    id: 'cs_1',
    businessId: 'biz_1',
    currency: 'TTD',
    revenueQualityScore: 60,
    revenueConcentrationRisk: 'HIGH',
    cacRisk: 'MEDIUM',
    ltvRisk: 'MEDIUM',
    churnRisk: 'LOW',
    conversionRisk: 'LOW',
    overallRisk: 'HIGH',
    missingInputs: [],
    warnings: [
      { code: 'REVENUE_CONCENTRATION', message: 'Concentrated', severity: 'HIGH' },
    ],
    recommendations: [],
    computedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeOperationsSnapshot(
  overrides: Partial<GenomeOperationsSnapshotData> = {},
): GenomeOperationsSnapshotData {
  return {
    id: 'ops_1',
    businessId: 'biz_1',
    processCount: 3,
    documentedCount: 2,
    bottleneckCount: 1,
    highRiskProcessCount: 0,
    overloadedCapabilityCount: 0,
    deliveryReadinessScore: 80,
    qualityRisk: 'LOW',
    capacityRisk: 'LOW',
    sopRisk: 'MEDIUM',
    overallRisk: 'MEDIUM',
    missingInputs: [],
    warnings: [],
    recommendations: [],
    computedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeMarketingSnapshot(
  overrides: Partial<GenomeMarketingGrowthSnapshotData> = {},
): GenomeMarketingGrowthSnapshotData {
  return {
    id: 'mkt_1',
    businessId: 'biz_1',
    channelMix: [],
    contentConsistencyScore: 70,
    channelDiversificationScore: 60,
    overallRisk: 'MEDIUM',
    missingInputs: [],
    warnings: [],
    recommendations: [],
    computedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeService() {
  const storedSnapshots: any[] = [];
  const storedMemory: any[] = [];
  let nextSnapshotId = 1;

  const prisma = {
    client: {
      genomeCrossDomainSnapshot: {
        create: vi.fn(async ({ data }: { data: any }) => {
          const row = { id: `cds_${nextSnapshotId++}`, ...data };
          storedSnapshots.push(row);
          return row;
        }),
        findFirst: vi.fn(async ({ where }: { where: any }) => {
          const matches = storedSnapshots
            .filter((r) => r.businessId === where.businessId)
            .sort((a: any, b: any) => new Date(b.computedAt).getTime() - new Date(a.computedAt).getTime());
          return matches[0] ?? null;
        }),
        findMany: vi.fn(async ({ where, take }: { where: any; take?: number }) => {
          let results = storedSnapshots.filter((r) => r.businessId === where.businessId);
          if (where.period !== undefined) results = results.filter((r) => r.period === where.period);
          if (where.overallRiskLevel) results = results.filter((r) => r.overallRiskLevel === where.overallRiskLevel);
          results.sort((a: any, b: any) => new Date(b.computedAt).getTime() - new Date(a.computedAt).getTime());
          return results.slice(0, take);
        }),
      },
      genomeFact: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      genomeEvidence: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    },
  } as any;

  const financeGenome = {
    computeFinanceSnapshot: vi.fn().mockResolvedValue(makeFinanceSnapshot()),
  };

  const customerSalesGenome = {
    computeCustomerSalesSnapshot: vi.fn().mockResolvedValue(makeCustomerSalesSnapshot()),
  };

  const operationsGenome = {
    computeOperationsSnapshot: vi.fn().mockResolvedValue(makeOperationsSnapshot()),
  };

  const marketingGenome = {
    computeMarketingGrowthSnapshot: vi.fn().mockResolvedValue(makeMarketingSnapshot()),
  };

  const memory = {
    createMemoryEvent: vi.fn().mockImplementation(async (input: any) => {
      const row = { id: `mem_${storedMemory.length + 1}`, ...input, createdAt: new Date() };
      storedMemory.push(row);
      return row;
    }),
  };

  const departments = {
    listDepartments: vi.fn().mockResolvedValue([
      { code: 'CEO_STRATEGY', readinessScore: 80, riskLevel: 'LOW' },
      { code: 'CFO_FINANCE', readinessScore: 55, riskLevel: 'MEDIUM' },
    ]),
  };

  const service = new GenomeCrossDomainService(
    prisma,
    financeGenome as any,
    customerSalesGenome as any,
    operationsGenome as any,
    marketingGenome as any,
    memory as any,
    departments as any,
  );

  return {
    service,
    prisma,
    financeGenome,
    customerSalesGenome,
    operationsGenome,
    marketingGenome,
    memory,
    departments,
    storedSnapshots,
    storedMemory,
  };
}

describe('GenomeCrossDomainService', () => {
  it('computes snapshot aggregating four domains', async () => {
    const { service } = makeService();

    const snapshot = await service.computeCrossDomainSnapshot('biz_1');

    expect(snapshot.businessId).toBe('biz_1');
    expect(snapshot.domainScores).toHaveLength(4);
    expect(snapshot.domainScores.map((d) => d.domain)).toEqual([
      'finance',
      'customer_sales_revenue',
      'operations_delivery',
      'marketing_growth',
    ]);
    expect(snapshot.overallHealthScore).toBeGreaterThan(0);
    expect(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL', 'UNKNOWN']).toContain(snapshot.overallRiskLevel);
    expect(snapshot.bottlenecks.length).toBeGreaterThan(0);
    expect(snapshot.recommendedFocus.length).toBe(4);
  });

  it('uses MEDIUM risk when marketing snapshot is HIGH and others are LOW', async () => {
    const { service, customerSalesGenome } = makeService();
    customerSalesGenome.computeCustomerSalesSnapshot.mockResolvedValue(
      makeCustomerSalesSnapshot({ overallRisk: 'HIGH', revenueQualityScore: 40 }),
    );

    const snapshot = await service.computeCrossDomainSnapshot('biz_1');

    expect(snapshot.overallRiskLevel).toBe('HIGH');
    expect(snapshot.domainRisks.customer_sales_revenue).toBe('HIGH');
  });

  it('returns UNKNOWN risk and zero health score when a domain compute fails', async () => {
    const { service, financeGenome } = makeService();
    financeGenome.computeFinanceSnapshot.mockRejectedValue(new Error('down'));

    const snapshot = await service.computeCrossDomainSnapshot('biz_1');

    const financeDomain = snapshot.domainScores.find((d) => d.domain === 'finance');
    expect(financeDomain?.healthScore).toBe(0);
    expect(financeDomain?.riskLevel).toBe('UNKNOWN');
  });

  it('writes a memory event on compute', async () => {
    const { service, memory } = makeService();

    await service.computeCrossDomainSnapshot('biz_1');

    expect(memory.createMemoryEvent).toHaveBeenCalled();
    const call = memory.createMemoryEvent.mock.calls[0][0];
    expect(call.eventType).toBe('CROSS_DOMAIN_SNAPSHOT_COMPUTED');
  });

  it('builds readiness summary from departments', async () => {
    const { service } = makeService();

    const snapshot = await service.computeCrossDomainSnapshot('biz_1');

    expect(snapshot.readinessSummary.departmentCount).toBe(2);
    expect(snapshot.readinessSummary.readyDepartments).toContain('CEO_STRATEGY');
    expect(snapshot.readinessSummary.atRiskDepartments).toContain('CFO_FINANCE');
  });

  it('builds recommended focus with lowest-health domain first', async () => {
    const { service, customerSalesGenome } = makeService();
    customerSalesGenome.computeCustomerSalesSnapshot.mockResolvedValue(
      makeCustomerSalesSnapshot({ overallRisk: 'CRITICAL', revenueQualityScore: 10 }),
    );

    const snapshot = await service.computeCrossDomainSnapshot('biz_1');

    expect(snapshot.recommendedFocus[0].domain).toBe('customer_sales_revenue');
    expect(snapshot.recommendedFocus[0].priority).toBe(1);
  });

  it('retrieves the latest snapshot', async () => {
    const { service } = makeService();

    await service.computeCrossDomainSnapshot('biz_1');
    await service.computeCrossDomainSnapshot('biz_1');

    const latest = await service.getLatestCrossDomainSnapshot('biz_1');

    expect(latest).not.toBeNull();
    expect(latest?.businessId).toBe('biz_1');
  });

  it('lists snapshots newest first', async () => {
    const { service } = makeService();

    await service.computeCrossDomainSnapshot('biz_1');
    await new Promise((resolve) => setTimeout(resolve, 5));
    await service.computeCrossDomainSnapshot('biz_1');

    const list = await service.listCrossDomainSnapshots('biz_1');

    expect(list.length).toBe(2);
    expect(new Date(list[0].computedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(list[1].computedAt).getTime(),
    );
  });

  it('returns null when no latest snapshot exists', async () => {
    const { service } = makeService();

    const latest = await service.getLatestCrossDomainSnapshot('biz_1');

    expect(latest).toBeNull();
  });
});
