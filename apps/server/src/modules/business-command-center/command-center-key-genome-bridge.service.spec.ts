import { describe, it, expect, vi } from 'vitest';
import { CommandCenterKeyGenomeBridgeService } from './command-center-key-genome-bridge.service';

const makeSnapshot = (overrides = {}) => ({
  id: 'cds_1',
  businessId: 'biz_1',
  period: null,
  overallHealthScore: 72,
  overallRiskLevel: 'MEDIUM' as const,
  domainScores: [
    { domain: 'finance' as const, healthScore: 75, riskLevel: 'LOW' as const, snapshotId: 'fin_1', computedAt: new Date().toISOString() },
    { domain: 'customer_sales_revenue' as const, healthScore: 70, riskLevel: 'MEDIUM' as const, snapshotId: 'csr_1', computedAt: new Date().toISOString() },
    { domain: 'operations_delivery' as const, healthScore: 65, riskLevel: 'MEDIUM' as const, snapshotId: 'ops_1', computedAt: new Date().toISOString() },
    { domain: 'marketing_growth' as const, healthScore: 80, riskLevel: 'LOW' as const, snapshotId: 'mkt_1', computedAt: new Date().toISOString() },
  ],
  domainRisks: {
    finance: 'LOW' as const,
    customer_sales_revenue: 'MEDIUM' as const,
    operations_delivery: 'MEDIUM' as const,
    marketing_growth: 'LOW' as const,
  },
  readinessSummary: {
    averageReadinessScore: 68,
    departmentCount: 4,
    readyDepartments: ['finance', 'marketing_growth'],
    atRiskDepartments: ['customer_sales_revenue', 'operations_delivery'],
  },
  evidenceSummary: {
    totalFacts: 40,
    highConfidenceFacts: 32,
    totalEvidence: 60,
    verifiedEvidence: 50,
  },
  bottlenecks: [],
  opportunities: [],
  recommendedFocus: [],
  computedAt: new Date().toISOString(),
  ...overrides,
});

const makeRanked = (overrides = {}) => ({
  businessId: 'biz_1',
  generatedAt: new Date().toISOString(),
  snapshotId: 'cds_1',
  overallHealthScore: 72,
  overallRiskLevel: 'MEDIUM' as const,
  rankedRecommendations: [
    { id: 'rec_1', title: 'Tighten cash collection', affectedDomains: ['finance' as const], rankScore: 0.9 },
  ],
  nextSafeActions: [
    { id: 'rec_2', title: 'Launch referral campaign', affectedDomains: ['marketing_growth' as const], rankScore: 0.85 },
  ],
  blockedActions: [
    { id: 'rec_3', title: 'Scale paid acquisition', affectedDomains: ['marketing_growth' as const, 'finance' as const], rankScore: 0.7 },
    { id: 'rec_4', title: 'Hire delivery lead', affectedDomains: ['operations_delivery' as const], rankScore: 0.6 },
    { id: 'rec_5', title: 'Expand sales territory', affectedDomains: ['customer_sales_revenue' as const], rankScore: 0.55 },
  ],
  ...overrides,
});

const makeOpportunities = (overrides = {}) => ({
  businessId: 'biz_1',
  generatedAt: new Date().toISOString(),
  snapshotId: 'cds_1',
  overallHealthScore: 72,
  overallRiskLevel: 'MEDIUM' as const,
  opportunities: [],
  prioritizedOpportunities: [
    { id: 'opp_1', label: 'Reinvest healthy cash position', affectedDomains: ['finance' as const], potentialImpact: 'MEDIUM' as const, confidence: 0.7, estimatedValueScore: 75, evidence: [], requiredConditions: [], suggestedAction: '' },
  ],
  ...overrides,
});

const makeGateResult = (actionType: string) => ({
  businessId: 'biz_1',
  actionType,
  affectedDomains: ['marketing_growth'],
  decision: 'BLOCK' as const,
  riskLevel: 'HIGH' as const,
  readinessScore: 45,
  confidenceScore: 50,
  blockingReasons: ['Cross-domain risk is HIGH.'],
  approvalReasons: [],
  evidenceWarnings: [],
  recommendedNextStep: 'Review readiness before scaling.',
  checkedAt: new Date().toISOString(),
});

function makeService() {
  const crossDomain = {
    getLatestCrossDomainSnapshot: vi.fn().mockResolvedValue(makeSnapshot()),
    computeCrossDomainSnapshot: vi.fn().mockResolvedValue(makeSnapshot()),
  };

  const ranker = {
    rankRecommendations: vi.fn().mockResolvedValue(makeRanked()),
    generateAndRankRecommendations: vi.fn().mockResolvedValue(makeRanked()),
  };

  const opportunityDetector = {
    detectOpportunities: vi.fn().mockResolvedValue(makeOpportunities()),
  };

  const autonomyGate = {
    checkGate: vi.fn().mockImplementation((input) => Promise.resolve(makeGateResult(input.actionType))),
  };

  const signalService = {
    listSignals: vi.fn().mockResolvedValue([]),
  };

  const service = new CommandCenterKeyGenomeBridgeService(
    crossDomain as any,
    ranker as any,
    opportunityDetector as any,
    autonomyGate as any,
    signalService as any,
  );

  return {
    service,
    crossDomain,
    ranker,
    opportunityDetector,
    autonomyGate,
    signalService,
  };
}

describe('CommandCenterKeyGenomeBridgeService', () => {
  it('returns a complete cross-domain brief', async () => {
    const { service, signalService } = makeService();
    signalService.listSignals.mockImplementation((_biz: string, filters: { signalType?: string }) => {
      if (filters.signalType === 'STALE_FACT') {
        return Promise.resolve([{ id: 'sig_1', signalType: 'STALE_FACT', status: 'NEW' }]);
      }
      if (filters.signalType === 'LOW_CONFIDENCE_FACT') {
        return Promise.resolve([{ id: 'sig_2', signalType: 'LOW_CONFIDENCE_FACT', status: 'NEW' }]);
      }
      return Promise.resolve([]);
    });

    const brief = await service.buildCrossDomainBrief('biz_1', [
      { missingFacts: [{ impact: 'BLOCKING' }, { impact: 'DEGRADED' }] } as any,
      { missingFacts: [{ impact: 'BLOCKING' }] } as any,
    ]);

    expect(brief.healthScore).toBe(72);
    expect(brief.readinessScore).toBe(68);
    expect(brief.confidenceScore).toBe(80);
    expect(brief.overallRiskLevel).toBe('MEDIUM');
    expect(Object.keys(brief.domainHealth)).toEqual(['finance', 'customer_sales_revenue', 'operations_delivery', 'marketing_growth']);
    expect(brief.topRecommendations.length).toBeGreaterThan(0);
    expect(brief.topOpportunities.length).toBeGreaterThan(0);
    expect(brief.staleFactCount).toBe(2);
    expect(brief.criticalMissingFactCount).toBe(2);
  });

  it('computes a fresh snapshot when no latest snapshot exists', async () => {
    const { service, crossDomain } = makeService();
    crossDomain.getLatestCrossDomainSnapshot.mockResolvedValue(null);

    const brief = await service.buildCrossDomainBrief('biz_1', [{ missingFacts: [] } as any]);

    expect(crossDomain.computeCrossDomainSnapshot).toHaveBeenCalledWith('biz_1');
    expect(brief.healthScore).toBe(72);
  });

  it('returns a safe default when all underlying services are empty', async () => {
    const { service, crossDomain, ranker, opportunityDetector } = makeService();
    crossDomain.getLatestCrossDomainSnapshot.mockResolvedValue(null);
    crossDomain.computeCrossDomainSnapshot.mockResolvedValue(null);
    ranker.rankRecommendations.mockResolvedValue({
      businessId: 'biz_1',
      generatedAt: new Date().toISOString(),
      overallHealthScore: 0,
      overallRiskLevel: 'UNKNOWN',
      rankedRecommendations: [],
      nextSafeActions: [],
      blockedActions: [],
    });
    opportunityDetector.detectOpportunities.mockResolvedValue({
      businessId: 'biz_1',
      generatedAt: new Date().toISOString(),
      overallHealthScore: 0,
      overallRiskLevel: 'UNKNOWN',
      opportunities: [],
      prioritizedOpportunities: [],
    });

    const brief = await service.buildCrossDomainBrief('biz_1', [{ missingFacts: [] } as any]);

    expect(brief.healthScore).toBe(0);
    expect(brief.overallRiskLevel).toBe('UNKNOWN');
    expect(brief.topRecommendations).toEqual([]);
    expect(brief.topOpportunities).toEqual([]);
    expect(brief.unsafeAutomationBlocks).toEqual([]);
  });

  it('only evaluates autonomy gate for the top blocked recommendations', async () => {
    const { service, autonomyGate } = makeService();

    const brief = await service.buildCrossDomainBrief('biz_1', [{ missingFacts: [] } as any]);

    expect(autonomyGate.checkGate).toHaveBeenCalledTimes(3);
    expect(brief.unsafeAutomationBlocks.length).toBe(3);
  });
});
