import { describe, expect, it, vi } from 'vitest';
import { KeyGenomeGovernanceService } from './key-genome-governance.service';
import type {
  GenomeExperimentData,
  GenomeRecommendationData,
  GenomeSignalData,
  ModuleReadinessData,
} from './key-genome.types';

function makeService() {
  const signals = {
    listSignals: vi.fn().mockResolvedValue([]),
  } as any;

  const recommendations = {
    listRecommendations: vi.fn().mockResolvedValue([]),
  } as any;

  const experiments = {
    listExperiments: vi.fn().mockResolvedValue([]),
  } as any;

  const readiness = {
    getReadiness: vi.fn().mockResolvedValue([]),
  } as any;

  const scoring = {
    computeFactScores: vi.fn().mockResolvedValue([]),
    computeBusinessScore: vi.fn().mockReturnValue({
      businessId: 'biz_1',
      overall: 0.5,
      integrity: 0.5,
      readiness: 0.5,
      confidence: 0.5,
      sections: [],
      computedAt: new Date().toISOString(),
    }),
  } as any;

  const departments = {
    listDepartments: vi.fn().mockResolvedValue([]),
  } as any;

  const prisma = {
    client: {
      keyActionProposal: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      genomeMemoryEvent: {
        count: vi.fn().mockResolvedValue(0),
      },
    },
  } as any;

  const service = new KeyGenomeGovernanceService(
    prisma,
    signals,
    recommendations,
    experiments,
    readiness,
    scoring,
    departments,
  );

  return {
    service,
    signals,
    recommendations,
    experiments,
    readiness,
    scoring,
    departments,
    prisma,
  };
}

describe('KeyGenomeGovernanceService', () => {
  it('returns an empty governance summary safely', async () => {
    const { service } = makeService();
    const summary = await service.summary('biz_1');

    expect(summary.businessId).toBe('biz_1');
    expect(summary.counts.newSignals).toBe(0);
    expect(summary.counts.activeRecommendations).toBe(0);
    expect(summary.urgentReviewItems).toHaveLength(0);
  });

  it('counts NEW and ACCEPTED signals', async () => {
    const { service, signals } = makeService();
    signals.listSignals.mockImplementation((businessId: string, query: any) => {
      if (query.status === 'NEW')
        return Promise.resolve([{ id: 'sig_1', signalType: 'CUSTOMER_PATTERN', domain: 'customer' }]);
      if (query.status === 'ACCEPTED')
        return Promise.resolve([{ id: 'sig_2', signalType: 'CUSTOMER_PATTERN', domain: 'customer' }]);
      return Promise.resolve([]);
    });

    const summary = await service.summary('biz_1');
    expect(summary.counts.newSignals).toBe(1);
    expect(summary.counts.acceptedSignals).toBe(1);
  });

  it('counts ACTIVE and ACCEPTED recommendations', async () => {
    const { service, recommendations } = makeService();
    recommendations.listRecommendations.mockImplementation((businessId: string, query: any) => {
      if (query.status === 'ACTIVE') return Promise.resolve([{ id: 'rec_1' }]);
      if (query.status === 'ACCEPTED') return Promise.resolve([{ id: 'rec_2' }]);
      return Promise.resolve([]);
    });

    const summary = await service.summary('biz_1');
    expect(summary.counts.activeRecommendations).toBe(1);
    expect(summary.counts.acceptedRecommendations).toBe(1);
  });

  it('counts PROPOSED and RUNNING experiments', async () => {
    const { service, experiments } = makeService();
    experiments.listExperiments.mockResolvedValue([
      { id: 'exp_1', status: 'PROPOSED' },
      { id: 'exp_2', status: 'RUNNING' },
    ] as GenomeExperimentData[]);

    const summary = await service.summary('biz_1');
    expect(summary.counts.proposedExperiments).toBe(1);
    expect(summary.counts.runningExperiments).toBe(1);
  });

  it('creates a CRITICAL urgent item for a FACT_CONFLICT signal', async () => {
    const { service, signals } = makeService();
    signals.listSignals.mockImplementation((businessId: string, query: any) => {
      if (query.status !== 'NEW') return Promise.resolve([]);
      return Promise.resolve([
        {
          id: 'sig_conflict',
          businessId: 'biz_1',
          sourceModule: 'executive_mode',
          sourceEntityType: 'CFO',
          sourceEntityId: 'finding_1',
          signalType: 'FACT_CONFLICT',
          section: 'FINANCIAL',
          domain: 'finance',
          field: 'pricing_model',
          proposedValue: null,
          reason: 'Pricing model conflicts between sources.',
          evidence: [],
          confidence: 0.9,
          status: 'NEW',
          createdAt: new Date().toISOString(),
          reviewedAt: null,
        },
      ] as GenomeSignalData[]);
    });

    const summary = await service.summary('biz_1');
    const urgent = summary.urgentReviewItems.find((i) => i.type === 'SIGNAL');
    expect(urgent).toBeDefined();
    expect(urgent!.priority).toBe('CRITICAL');
    expect(urgent!.actions.some((a) => a.actionType === 'ACCEPT')).toBe(true);
  });

  it('creates a HIGH urgent item for an ACCEPTED signal awaiting merge', async () => {
    const { service, signals } = makeService();
    signals.listSignals.mockImplementation((businessId: string, query: any) => {
      if (query.status !== 'ACCEPTED') return Promise.resolve([]);
      return Promise.resolve([
        {
          id: 'sig_accepted',
          businessId: 'biz_1',
          sourceModule: 'key_inbox',
          sourceEntityType: 'KeyInboxThread',
          sourceEntityId: 'thread_1',
          signalType: 'CUSTOMER_PATTERN',
          section: 'CUSTOMER_MARKET',
          domain: 'customer',
          field: 'pain_points',
          proposedValue: ['weekend delivery'],
          reason: 'Customers keep asking about weekend delivery.',
          evidence: [],
          confidence: 0.85,
          status: 'ACCEPTED',
          createdAt: new Date().toISOString(),
          reviewedAt: new Date().toISOString(),
        },
      ] as GenomeSignalData[]);
    });

    const summary = await service.summary('biz_1');
    const urgent = summary.urgentReviewItems.find((i) => i.id === 'signal-sig_accepted');
    expect(urgent).toBeDefined();
    expect(urgent!.priority).toBe('HIGH');
    expect(urgent!.actions.some((a) => a.actionType === 'MERGE')).toBe(true);
  });

  it('creates readiness blocker items for blocked modules', async () => {
    const { service, readiness } = makeService();
    readiness.getReadiness.mockResolvedValue([
      {
        businessId: 'biz_1',
        module: 'key_inbox',
        readinessScore: 25,
        requiredFacts: [],
        missingFacts: [
          {
            section: 'VISION_IDENTITY',
            domain: 'identity',
            field: 'business_name',
            reason: 'Missing blocking fact: Business name',
            impact: 'BLOCKING',
          },
        ],
        optionalFacts: [],
        blockedReasons: ['Missing blocking fact: identity.business_name'],
        recommendedSetupActions: [],
        automationAllowed: false,
        riskLevel: 'HIGH',
        lastComputedAt: new Date().toISOString(),
      },
    ] as ModuleReadinessData[]);

    const summary = await service.summary('biz_1');
    expect(summary.counts.blockedModules).toBe(1);
    const blocker = summary.readinessBlockers.find((i) => i.type === 'READINESS_BLOCKER');
    expect(blocker).toBeDefined();
    expect(blocker!.priority).toBe('CRITICAL');
  });

  it('includes weak Genome sections in the governance summary', async () => {
    const { service, scoring } = makeService();
    scoring.computeBusinessScore.mockReturnValue({
      businessId: 'biz_1',
      overall: 0.45,
      integrity: 0.5,
      readiness: 0.5,
      confidence: 0.5,
      sections: [
        {
          section: 'FINANCIAL',
          weight: 12,
          score: {
            completeness: 0.3,
            quality: 0.4,
            confidence: 0.3,
            freshness: 0.2,
            operationalReadiness: 0.4,
            riskPenalty: 0.03,
            overall: 0.35,
          },
        },
      ],
      computedAt: new Date().toISOString(),
    });

    const summary = await service.summary('biz_1');
    expect(summary.genomeHealth.weakestSections.length).toBeGreaterThan(0);
    expect(summary.genomeHealth.weakestSections[0].section).toBe('FINANCIAL');

    const weakItem = summary.urgentReviewItems.find((i) => i.type === 'WEAK_SECTION');
    expect(weakItem).toBeDefined();
    expect(weakItem!.priority).toBe('HIGH');
  });

  it('exposes Create action plan action for ACCEPTED recommendations', async () => {
    const { service, recommendations } = makeService();
    recommendations.listRecommendations.mockImplementation((businessId: string, query: any) => {
      if (query.status === 'ACCEPTED') {
        return Promise.resolve([
          {
            id: 'rec_accepted',
            businessId,
            domain: 'VISION_IDENTITY',
            title: 'Strengthen Vision Genome section',
            insight: 'Weak vision section.',
            diagnosis: 'Low score.',
            recommendation: 'Capture more facts.',
            expectedGainScore: 70,
            riskLevel: 'MEDIUM',
            effortLevel: 'MEDIUM',
            confidence: 0.7,
            evidenceIds: [],
            suggestedExperimentId: null,
            status: 'ACCEPTED',
            createdAt: new Date().toISOString(),
            reviewedAt: new Date().toISOString(),
            outcomeTrackedAt: null,
          },
        ] as GenomeRecommendationData[]);
      }
      return Promise.resolve([]);
    });

    const summary = await service.summary('biz_1');
    const item = summary.recommendationQueue.find((i) => i.id === 'recommendation-rec_accepted');
    expect(item).toBeDefined();
    expect(item!.actions.some((a) => a.actionType === 'BRIDGE' && a.label === 'Create action plan')).toBe(true);
  });

  it('includes memory event counts in summary', async () => {
    const { service, prisma } = makeService();
    prisma.client.genomeMemoryEvent.count.mockImplementation(({ where }: any) => {
      if (where?.outcome === 'FAILURE') return Promise.resolve(2);
      return Promise.resolve(7);
    });

    const summary = await service.summary('biz_1');
    expect(summary.counts.memoryEventsLast7Days).toBe(7);
    expect(summary.counts.failedOutcomesLast30Days).toBe(2);
  });

  it('sorts urgent review items by priority then createdAt', async () => {
    const { service, signals } = makeService();
    signals.listSignals.mockImplementation((businessId: string, query: any) => {
      if (query.status !== 'NEW') return Promise.resolve([]);
      const now = new Date();
      return Promise.resolve([
        {
          id: 'sig_high',
          businessId: 'biz_1',
          sourceModule: 'key_inbox',
          sourceEntityType: 'KeyInboxThread',
          sourceEntityId: 'thread_1',
          signalType: 'CUSTOMER_PATTERN',
          section: 'CUSTOMER_MARKET',
          domain: 'customer',
          field: 'pain_points',
          proposedValue: null,
          reason: 'Strong customer pattern.',
          evidence: [],
          confidence: 0.85,
          status: 'NEW',
          createdAt: new Date(now.getTime() - 1000).toISOString(),
          reviewedAt: null,
        },
        {
          id: 'sig_critical',
          businessId: 'biz_1',
          sourceModule: 'executive_mode',
          sourceEntityType: 'CFO',
          sourceEntityId: 'finding_1',
          signalType: 'FACT_CONFLICT',
          section: 'FINANCIAL',
          domain: 'finance',
          field: 'pricing_model',
          proposedValue: null,
          reason: 'Pricing conflict.',
          evidence: [],
          confidence: 0.9,
          status: 'NEW',
          createdAt: now.toISOString(),
          reviewedAt: null,
        },
      ] as GenomeSignalData[]);
    });

    const summary = await service.summary('biz_1');
    expect(summary.urgentReviewItems[0].id).toBe('signal-sig_critical');
    expect(summary.urgentReviewItems[1].id).toBe('signal-sig_high');
  });
});
