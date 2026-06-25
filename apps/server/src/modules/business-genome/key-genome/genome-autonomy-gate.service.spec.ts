import { describe, expect, it, vi } from 'vitest';
import { GenomeAutonomyGateService } from './genome-autonomy-gate.service';
import type {
  GenomeCrossDomainSnapshotData,
  GenomeFactData,
  ModuleReadinessData,
} from './key-genome.types';

function makeSnapshot(
  overrides: Partial<GenomeCrossDomainSnapshotData> = {},
): GenomeCrossDomainSnapshotData {
  return {
    id: 'snap_1',
    businessId: 'biz_1',
    period: null,
    overallHealthScore: 70,
    overallRiskLevel: 'MEDIUM',
    domainScores: [
      { domain: 'finance', healthScore: 80, riskLevel: 'LOW', snapshotId: 'finsnap_1', computedAt: new Date().toISOString() },
      { domain: 'customer_sales_revenue', healthScore: 65, riskLevel: 'MEDIUM', snapshotId: 'cssnap_1', computedAt: new Date().toISOString() },
      { domain: 'operations_delivery', healthScore: 70, riskLevel: 'MEDIUM', snapshotId: 'opsnap_1', computedAt: new Date().toISOString() },
      { domain: 'marketing_growth', healthScore: 65, riskLevel: 'MEDIUM', snapshotId: 'mgsnap_1', computedAt: new Date().toISOString() },
    ],
    domainRisks: {
      finance: 'LOW',
      customer_sales_revenue: 'MEDIUM',
      operations_delivery: 'MEDIUM',
      marketing_growth: 'MEDIUM',
    },
    readinessSummary: { averageReadinessScore: 70, departmentCount: 4, readyDepartments: [], atRiskDepartments: [] },
    evidenceSummary: { totalFacts: 10, highConfidenceFacts: 6, totalEvidence: 10, verifiedEvidence: 6 },
    bottlenecks: [],
    opportunities: [],
    recommendedFocus: [],
    computedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeFact(
  overrides: Partial<GenomeFactData> = {},
): GenomeFactData {
  return {
    id: 'fact_1',
    businessId: 'biz_1',
    section: 'OPERATIONS_DELIVERY',
    domain: 'operations',
    field: 'capacity',
    value: { raw: 100, type: 'NUMBER' },
    sourceType: 'manual',
    score: {
      completeness: 0.8,
      quality: 0.8,
      confidence: 0.8,
      freshness: 0.8,
      operationalReadiness: 0.8,
      riskPenalty: 0,
      overall: 0.8,
    },
    verificationStatus: 'USER_VERIFIED',
    riskIfWrong: 'MEDIUM',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeService() {
  const memoryService = {
    createMemoryEvent: vi.fn().mockResolvedValue({ id: 'mem_1' }),
  };

  const crossDomainService = {
    getLatestCrossDomainSnapshot: vi.fn().mockResolvedValue(makeSnapshot()),
    computeCrossDomainSnapshot: vi.fn().mockResolvedValue(makeSnapshot()),
  };

  const readinessService = {
    getReadiness: vi.fn().mockResolvedValue([]),
  };

  const factService = {
    listFacts: vi.fn().mockResolvedValue([makeFact()]),
  };

  const service = new GenomeAutonomyGateService(
    crossDomainService as any,
    readinessService as any,
    factService as any,
    memoryService as any,
  );

  return {
    service,
    crossDomainService,
    readinessService,
    factService,
    memoryService,
  };
}

describe('GenomeAutonomyGateService', () => {
  it('returns ALLOW for healthy domains with good confidence', async () => {
    const { service } = makeService();
    const result = await service.checkGate({
      businessId: 'biz_1',
      actionType: 'CREATE_TASK',
      affectedDomains: ['operations_delivery'],
    });

    expect(result.decision).toBe('ALLOW');
    expect(result.riskLevel).toBe('MEDIUM');
    expect(result.blockingReasons).toHaveLength(0);
  });

  it('BLOCKs when cross-domain risk is CRITICAL', async () => {
    const { service, crossDomainService } = makeService();
    crossDomainService.getLatestCrossDomainSnapshot.mockResolvedValue(
      makeSnapshot({ overallRiskLevel: 'CRITICAL' }),
    );

    const result = await service.checkGate({
      businessId: 'biz_1',
      actionType: 'CREATE_TASK',
      affectedDomains: ['operations_delivery'],
    });

    expect(result.decision).toBe('BLOCK');
    expect(result.blockingReasons.some((r) => r.includes('CRITICAL'))).toBe(true);
  });

  it('BLOCKs when an affected domain has critically low readiness', async () => {
    const { service, crossDomainService } = makeService();
    crossDomainService.getLatestCrossDomainSnapshot.mockResolvedValue(
      makeSnapshot({
        domainScores: [
          { domain: 'finance', healthScore: 80, riskLevel: 'LOW', snapshotId: 'finsnap_1', computedAt: new Date().toISOString() },
          { domain: 'customer_sales_revenue', healthScore: 65, riskLevel: 'MEDIUM', snapshotId: 'cssnap_1', computedAt: new Date().toISOString() },
          { domain: 'operations_delivery', healthScore: 25, riskLevel: 'HIGH', snapshotId: 'opsnap_1', computedAt: new Date().toISOString() },
          { domain: 'marketing_growth', healthScore: 65, riskLevel: 'MEDIUM', snapshotId: 'mgsnap_1', computedAt: new Date().toISOString() },
        ],
      }),
    );

    const result = await service.checkGate({
      businessId: 'biz_1',
      actionType: 'CREATE_TASK',
      affectedDomains: ['operations_delivery'],
    });

    expect(result.decision).toBe('BLOCK');
    expect(result.blockingReasons.some((r) => r.includes('critically low'))).toBe(true);
  });

  it('infers affected domains from action type when not provided', async () => {
    const { service, factService } = makeService();
    factService.listFacts.mockResolvedValue([
      makeFact({ section: 'FINANCIAL', domain: 'finance', field: 'budget' }),
    ]);

    const result = await service.checkGate({
      businessId: 'biz_1',
      actionType: 'INCREASE_AD_SPEND',
    });

    expect(result.affectedDomains).toContain('marketing_growth');
    expect(result.affectedDomains).toContain('finance');
  });

  it('NEEDS_MORE_EVIDENCE when confidence is too low', async () => {
    const { service, factService } = makeService();
    factService.listFacts.mockResolvedValue([
      makeFact({
        score: {
          completeness: 0.2,
          quality: 0.2,
          confidence: 0.2,
          freshness: 0.2,
          operationalReadiness: 0.2,
          riskPenalty: 0,
          overall: 0.2,
        },
      }),
    ]);

    const result = await service.checkGate({
      businessId: 'biz_1',
      actionType: 'CREATE_TASK',
      affectedDomains: ['operations_delivery'],
    });

    expect(result.decision).toBe('NEEDS_MORE_EVIDENCE');
  });

  it('ALLOW_WITH_APPROVAL when risk is HIGH', async () => {
    const { service, crossDomainService, factService } = makeService();
    crossDomainService.getLatestCrossDomainSnapshot.mockResolvedValue(
      makeSnapshot({
        overallRiskLevel: 'HIGH',
        domainRisks: {
          finance: 'LOW',
          customer_sales_revenue: 'HIGH',
          operations_delivery: 'MEDIUM',
          marketing_growth: 'MEDIUM',
        },
      }),
    );
    factService.listFacts.mockResolvedValue([
      makeFact({ section: 'CUSTOMER_MARKET', domain: 'customer', field: 'ideal_customer' }),
    ]);

    const result = await service.checkGate({
      businessId: 'biz_1',
      actionType: 'CREATE_TASK',
      affectedDomains: ['customer_sales_revenue'],
    });

    expect(result.decision).toBe('ALLOW_WITH_APPROVAL');
  });

  it('logs an autonomy gate memory event', async () => {
    const { service, memoryService } = makeService();
    await service.checkGate({
      businessId: 'biz_1',
      actionType: 'CREATE_TASK',
      affectedDomains: ['operations_delivery'],
    });

    expect(memoryService.createMemoryEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: 'biz_1',
        eventType: 'AUTONOMY_GATE_DECISION_RECORDED',
        sourceType: 'CROSS_DOMAIN_GENOME',
      }),
    );
  });
});
