import { describe, expect, it, vi } from 'vitest';
import { GenomeRecommendationRankerService } from './genome-recommendation-ranker.service';
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

function makeRecommendation(
  overrides: Partial<GenomeRecommendationData> = {},
): GenomeRecommendationData {
  return {
    id: 'rec_1',
    businessId: 'biz_1',
    domain: 'FINANCIAL',
    title: 'Reduce operating expenses',
    insight: 'Cash burn is high.',
    diagnosis: 'Expenses exceed plan.',
    recommendation: 'Cut discretionary spend.',
    expectedGain: 'Improves runway.',
    expectedGainScore: 80,
    riskLevel: 'MEDIUM',
    effortLevel: 'LOW',
    confidence: 0.8,
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
    generateRecommendations: vi.fn().mockResolvedValue([]),
  };

  const crossDomainService = {
    getLatestCrossDomainSnapshot: vi.fn().mockResolvedValue(makeSnapshot()),
    computeCrossDomainSnapshot: vi.fn().mockResolvedValue(makeSnapshot()),
  };

  const service = new GenomeRecommendationRankerService(
    recommendationService as any,
    crossDomainService as any,
    memoryService as any,
  );

  return {
    service,
    recommendationService,
    crossDomainService,
    memoryService,
  };
}

describe('GenomeRecommendationRankerService', () => {
  it('returns empty ranking when no recommendations exist', async () => {
    const { service } = makeService();
    const result = await service.rankRecommendations('biz_1');

    expect(result.rankedRecommendations).toHaveLength(0);
    expect(result.nextSafeActions).toHaveLength(0);
    expect(result.blockedActions).toHaveLength(0);
  });

  it('ranks recommendations by score descending', async () => {
    const { service, recommendationService } = makeService();
    recommendationService.listRecommendations.mockResolvedValue([
      makeRecommendation({
        id: 'rec_low',
        domain: 'OPERATIONS',
        expectedGainScore: 40,
        confidence: 0.5,
        riskLevel: 'HIGH',
        effortLevel: 'HIGH',
      }),
      makeRecommendation({
        id: 'rec_high',
        domain: 'FINANCIAL',
        expectedGainScore: 90,
        confidence: 0.9,
        riskLevel: 'LOW',
        effortLevel: 'LOW',
      }),
    ]);

    const result = await service.rankRecommendations('biz_1');

    expect(result.rankedRecommendations).toHaveLength(2);
    expect(result.rankedRecommendations[0].id).toBe('rec_high');
    expect(result.rankedRecommendations[1].id).toBe('rec_low');
  });

  it('classifies high-risk capacity constraints as blocked actions', async () => {
    const { service, recommendationService, crossDomainService } = makeService();
    const snapshot = makeSnapshot({
      domainScores: [
        { domain: 'finance', healthScore: 80, riskLevel: 'LOW', snapshotId: 'finsnap_1', computedAt: new Date().toISOString() },
        { domain: 'customer_sales_revenue', healthScore: 65, riskLevel: 'MEDIUM', snapshotId: 'cssnap_1', computedAt: new Date().toISOString() },
        { domain: 'operations_delivery', healthScore: 30, riskLevel: 'HIGH', snapshotId: 'opsnap_1', computedAt: new Date().toISOString() },
        { domain: 'marketing_growth', healthScore: 65, riskLevel: 'MEDIUM', snapshotId: 'mgsnap_1', computedAt: new Date().toISOString() },
      ],
      domainRisks: {
        finance: 'LOW',
        customer_sales_revenue: 'MEDIUM',
        operations_delivery: 'HIGH',
        marketing_growth: 'MEDIUM',
      },
    });
    crossDomainService.getLatestCrossDomainSnapshot.mockResolvedValue(snapshot);
    recommendationService.listRecommendations.mockResolvedValue([
      makeRecommendation({ id: 'rec_1', domain: 'OPERATIONS' }),
    ]);

    const result = await service.rankRecommendations('biz_1');

    expect(result.rankedRecommendations[0].capacityGating).toBe('HARD_CONSTRAINT');
    expect(result.blockedActions).toHaveLength(1);
    expect(result.nextSafeActions).toHaveLength(0);
  });

  it('logs a memory event after ranking', async () => {
    const { service, recommendationService, memoryService } = makeService();
    recommendationService.listRecommendations.mockResolvedValue([
      makeRecommendation(),
    ]);

    await service.rankRecommendations('biz_1');

    expect(memoryService.createMemoryEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: 'biz_1',
        eventType: 'CROSS_DOMAIN_RECOMMENDATIONS_RANKED',
        sourceType: 'CROSS_DOMAIN_GENOME',
      }),
    );
  });

  it('generates and ranks recommendations', async () => {
    const { service, recommendationService } = makeService();
    recommendationService.listRecommendations.mockResolvedValue([
      makeRecommendation(),
    ]);

    const result = await service.generateAndRankRecommendations('biz_1', {
      limit: 5,
    });

    expect(recommendationService.generateRecommendations).toHaveBeenCalledWith({
      businessId: 'biz_1',
      sources: ['READINESS_GAP', 'SIGNAL', 'WEAK_SECTION'],
      maxRecommendations: 5,
    });
    expect(result.rankedRecommendations).toHaveLength(1);
  });
});
