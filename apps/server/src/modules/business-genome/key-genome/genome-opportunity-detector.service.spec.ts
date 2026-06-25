import { describe, expect, it, vi } from 'vitest';
import { GenomeOpportunityDetectorService } from './genome-opportunity-detector.service';
import type {
  GenomeCrossDomainSnapshotData,
  GenomeRecommendationData,
} from './key-genome.types';

function makeSnapshot(
  overrides: Partial<GenomeCrossDomainSnapshotData> = {},
): GenomeCrossDomainSnapshotData {
  return {
    id: 'snap_1',
    businessId: 'biz_1',
    period: null,
    overallHealthScore: 72,
    overallRiskLevel: 'MEDIUM',
    domainScores: [
      { domain: 'finance', healthScore: 80, riskLevel: 'LOW', snapshotId: 'finsnap_1', computedAt: new Date().toISOString() },
      { domain: 'customer_sales_revenue', healthScore: 70, riskLevel: 'MEDIUM', snapshotId: 'cssnap_1', computedAt: new Date().toISOString() },
      { domain: 'operations_delivery', healthScore: 75, riskLevel: 'MEDIUM', snapshotId: 'opsnap_1', computedAt: new Date().toISOString() },
      { domain: 'marketing_growth', healthScore: 65, riskLevel: 'MEDIUM', snapshotId: 'mgsnap_1', computedAt: new Date().toISOString() },
    ],
    domainRisks: {
      finance: 'LOW',
      customer_sales_revenue: 'MEDIUM',
      operations_delivery: 'MEDIUM',
      marketing_growth: 'MEDIUM',
    },
    readinessSummary: { averageReadinessScore: 72, departmentCount: 4, readyDepartments: [], atRiskDepartments: [] },
    evidenceSummary: { totalFacts: 10, highConfidenceFacts: 6, totalEvidence: 10, verifiedEvidence: 6 },
    bottlenecks: [],
    opportunities: [],
    recommendedFocus: [],
    computedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeRecommendation(
  overrides: Partial<GenomeRecommendationData> = {},
): GenomeRecommendationData {
  return {
    id: 'rec_1',
    businessId: 'biz_1',
    domain: 'MARKETING_GROWTH',
    title: 'Test paid social',
    insight: 'Channel diversification is strong.',
    diagnosis: 'Paid channel has not been tested.',
    recommendation: 'Run a small paid-social experiment.',
    expectedGain: 'New leads.',
    expectedGainScore: 70,
    riskLevel: 'MEDIUM',
    effortLevel: 'LOW',
    confidence: 0.7,
    evidenceIds: [],
    status: 'ACTIVE',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeService() {
  const memoryService = {
    createMemoryEvent: vi.fn().mockResolvedValue({ id: 'mem_1' }),
  };

  const recommendationService = {
    listRecommendations: vi.fn().mockResolvedValue([]),
  };

  const crossDomainService = {
    getLatestCrossDomainSnapshot: vi.fn().mockResolvedValue(makeSnapshot()),
    computeCrossDomainSnapshot: vi.fn().mockResolvedValue(makeSnapshot()),
  };

  const service = new GenomeOpportunityDetectorService(
    crossDomainService as any,
    recommendationService as any,
    memoryService as any,
  );

  return {
    service,
    recommendationService,
    crossDomainService,
    memoryService,
  };
}

describe('GenomeOpportunityDetectorService', () => {
  it('detects scale-acquisition opportunity when all domains are healthy', async () => {
    const { service } = makeService();
    const result = await service.detectOpportunities('biz_1');

    const scaleOpp = result.opportunities.find(
      (o) => o.id === 'opp-scale-paid-acquisition',
    );
    expect(scaleOpp).toBeDefined();
    expect(scaleOpp?.potentialImpact).toBe('HIGH');
  });

  it('prioritizes high-impact opportunities first', async () => {
    const { service } = makeService();
    const result = await service.detectOpportunities('biz_1');

    const impacts = result.prioritizedOpportunities.map((o) => o.potentialImpact);
    expect(impacts).toEqual([...impacts].sort((a, b) => (b === 'HIGH' ? 1 : -1)));
  });

  it('filters by minimum potential impact', async () => {
    const { service } = makeService();
    const result = await service.detectOpportunities('biz_1', {
      minPotentialImpact: 'HIGH',
    });

    expect(
      result.prioritizedOpportunities.every((o) => o.potentialImpact === 'HIGH'),
    ).toBe(true);
  });

  it('includes risk-mitigation opportunities when finance is critical', async () => {
    const { service, crossDomainService } = makeService();
    const snapshot = makeSnapshot({
      domainScores: [
        { domain: 'finance', healthScore: 30, riskLevel: 'CRITICAL', snapshotId: 'finsnap_1', computedAt: new Date().toISOString() },
        { domain: 'customer_sales_revenue', healthScore: 70, riskLevel: 'MEDIUM', snapshotId: 'cssnap_1', computedAt: new Date().toISOString() },
        { domain: 'operations_delivery', healthScore: 75, riskLevel: 'MEDIUM', snapshotId: 'opsnap_1', computedAt: new Date().toISOString() },
        { domain: 'marketing_growth', healthScore: 65, riskLevel: 'MEDIUM', snapshotId: 'mgsnap_1', computedAt: new Date().toISOString() },
      ],
      domainRisks: {
        finance: 'CRITICAL',
        customer_sales_revenue: 'MEDIUM',
        operations_delivery: 'MEDIUM',
        marketing_growth: 'MEDIUM',
      },
    });
    crossDomainService.getLatestCrossDomainSnapshot.mockResolvedValue(snapshot);

    const result = await service.detectOpportunities('biz_1');

    const mitigate = result.opportunities.find(
      (o) => o.id === 'opp-strengthen-finance-controls',
    );
    expect(mitigate).toBeDefined();
    expect(mitigate?.potentialImpact).toBe('HIGH');
  });

  it('uses active recommendations as evidence', async () => {
    const { service, recommendationService } = makeService();
    recommendationService.listRecommendations.mockResolvedValue([
      makeRecommendation({ title: 'Run paid social test' }),
    ]);

    const result = await service.detectOpportunities('biz_1');

    const scaleOpp = result.opportunities.find(
      (o) => o.id === 'opp-scale-paid-acquisition',
    );
    expect(scaleOpp?.evidence).toContain('Run paid social test');
  });

  it('logs a memory event after detection', async () => {
    const { service, memoryService } = makeService();
    await service.detectOpportunities('biz_1');

    expect(memoryService.createMemoryEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: 'biz_1',
        eventType: 'CROSS_DOMAIN_OPPORTUNITIES_DETECTED',
        sourceType: 'CROSS_DOMAIN_GENOME',
      }),
    );
  });
});
