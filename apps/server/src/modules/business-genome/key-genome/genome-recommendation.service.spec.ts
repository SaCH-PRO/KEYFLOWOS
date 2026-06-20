import { describe, expect, it, vi } from 'vitest';
import { GenomeRecommendationService } from './genome-recommendation.service';
import type {
  CreateGenomeRecommendationInput,
  GenomeRecommendationData,
  GenomeSignalData,
  ModuleReadinessData,
} from './key-genome.types';

function makeInput(overrides: Partial<CreateGenomeRecommendationInput> = {}): CreateGenomeRecommendationInput {
  return {
    businessId: 'biz_1',
    domain: 'VISION_IDENTITY',
    title: 'Provide blocking fact: identity.business_name',
    insight: 'Readiness is low.',
    diagnosis: 'Missing blocking fact: Business name',
    recommendation: 'Capture business name.',
    expectedGain: 'Unlocks key_inbox.',
    expectedGainScore: 85,
    riskLevel: 'HIGH',
    effortLevel: 'LOW',
    confidence: 0.75,
    evidenceIds: [],
    ...overrides,
  };
}

function makeService() {
  const storedRecs: any[] = [];
  const storedExperiments: any[] = [];
  let nextRecId = 1;
  let nextExpId = 1;

  const prisma = {
    client: {
      genomeRecommendation: {
        findFirst: vi.fn().mockImplementation(({ where }: { where: any }) => {
          const match = storedRecs.find(
            (r) =>
              r.businessId === where.businessId &&
              r.domain === where.domain &&
              r.title === where.title &&
              (where.status?.in ?? []).includes(r.status),
          );
          return Promise.resolve(match ?? null);
        }),
        findUnique: vi.fn().mockImplementation(({ where }: { where: { id: string } }) => {
          return Promise.resolve(storedRecs.find((r) => r.id === where.id) ?? null);
        }),
        findMany: vi.fn().mockImplementation(({ where }: { where: any }) => {
          let results = storedRecs.filter((r) => r.businessId === where.businessId);
          if (where.status) results = results.filter((r) => r.status === where.status);
          if (where.domain) results = results.filter((r) => r.domain === where.domain);
          if (where.expectedGainScore?.gte !== undefined)
            results = results.filter((r) => r.expectedGainScore >= where.expectedGainScore.gte);
          return Promise.resolve(results);
        }),
        create: vi.fn().mockImplementation(({ data }: { data: any }) => {
          const row = {
            id: `rec_${nextRecId++}`,
            ...data,
            createdAt: new Date(),
            reviewedAt: null,
            outcomeTrackedAt: null,
          };
          storedRecs.push(row);
          return Promise.resolve(row);
        }),
        update: vi.fn().mockImplementation(({ where, data }: { where: { id: string }; data: any }) => {
          const idx = storedRecs.findIndex((r) => r.id === where.id);
          if (idx === -1) throw new Error('Not found');
          storedRecs[idx] = { ...storedRecs[idx], ...data };
          return Promise.resolve(storedRecs[idx]);
        }),
      },
      genomeExperiment: {
        create: vi.fn().mockImplementation(({ data }: { data: any }) => {
          const row = {
            id: `exp_${nextExpId++}`,
            ...data,
            createdAt: new Date(),
            startedAt: null,
            endedAt: null,
            result: null,
          };
          storedExperiments.push(row);
          return Promise.resolve(row);
        }),
      },
    },
  } as any;

  const signalService = {
    listSignals: vi.fn().mockResolvedValue([]),
  } as any;

  const readiness = {
    getReadiness: vi.fn().mockResolvedValue([]),
  } as any;

  const scoring = {
    computeFactScores: vi.fn().mockResolvedValue([]),
    computeBusinessScore: vi.fn().mockReturnValue({ sections: [] }),
  } as any;

  const experimentService = {
    createExperiment: vi.fn().mockImplementation((input: any) => {
      const row = {
        id: `exp_${nextExpId++}`,
        ...input,
        createdAt: new Date(),
        startedAt: null,
        endedAt: null,
        status: 'PROPOSED',
        result: null,
      };
      storedExperiments.push(row);
      return Promise.resolve(row);
    }),
  } as any;

  const service = new GenomeRecommendationService(
    prisma,
    signalService,
    readiness,
    scoring,
    experimentService,
  );

  return {
    service,
    prisma,
    signalService,
    readiness,
    scoring,
    experimentService,
    storedRecs,
    storedExperiments,
  };
}

describe('GenomeRecommendationService', () => {
  it('creates an ACTIVE recommendation', async () => {
    const { service, storedRecs } = makeService();
    const rec = await service.createRecommendation(makeInput());

    expect(rec.status).toBe('ACTIVE');
    expect(rec.title).toContain('business_name');
    expect(storedRecs).toHaveLength(1);
  });

  it('deduplicates active recommendations by domain and title', async () => {
    const { service, storedRecs } = makeService();
    await service.createRecommendation(makeInput());
    const duplicate = await service.createRecommendation(makeInput({ confidence: 0.9 }));

    expect(storedRecs).toHaveLength(1);
    expect(duplicate.confidence).toBe(0.75);
  });

  it('accepts, dismisses, and applies a recommendation', async () => {
    const { service } = makeService();
    const created = await service.createRecommendation(makeInput());

    const accepted = await service.acceptRecommendation('biz_1', created.id);
    expect(accepted.status).toBe('ACCEPTED');
    expect(accepted.reviewedAt).not.toBeNull();

    const dismissed = await service.dismissRecommendation('biz_1', created.id);
    expect(dismissed.status).toBe('DISMISSED');

    const applied = await service.applyRecommendation('biz_1', created.id);
    expect(applied.status).toBe('APPLIED');
    expect(applied.outcomeTrackedAt).not.toBeNull();
  });

  it('throws when recommendation is not found or belongs to another business', async () => {
    const { service } = makeService();
    const created = await service.createRecommendation(makeInput());

    await expect(service.getRecommendation('biz_2', created.id)).rejects.toThrow(
      'Genome recommendation not found',
    );
    await expect(service.getRecommendation('biz_1', 'missing')).rejects.toThrow(
      'Genome recommendation not found',
    );
  });

  it('generates recommendations from readiness gaps', async () => {
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
        recommendedSetupActions: ['Provide blocking fact: identity.business_name'],
        automationAllowed: false,
        riskLevel: 'HIGH',
        lastComputedAt: new Date().toISOString(),
      },
    ] as ModuleReadinessData[]);

    const recs = await service.generateRecommendations({ businessId: 'biz_1' });

    expect(recs.length).toBeGreaterThan(0);
    expect(recs[0].title).toContain('business_name');
    expect(recs[0].domain).toBe('VISION_IDENTITY');
  });

  it('generates recommendations from weak Genome sections', async () => {
    const { service, scoring } = makeService();
    scoring.computeBusinessScore.mockReturnValue({
      sections: [
        {
          section: 'FINANCIAL',
          weight: 12,
          score: {
            overall: 0.35,
            confidence: 0.3,
            freshness: 0.2,
          },
        },
      ],
    });

    const recs = await service.generateRecommendations({ businessId: 'biz_1', sources: ['WEAK_SECTION'] });

    expect(recs.length).toBe(1);
    expect(recs[0].domain).toBe('FINANCIAL');
    expect(recs[0].title).toContain('Strengthen');
  });

  it('creates a suggested experiment for low-risk pattern signals', async () => {
    const { service, signalService, experimentService } = makeService();
    signalService.listSignals.mockResolvedValue([
      {
        id: 'sig_1',
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
        evidence: [{ id: 'ev_1', summary: 'Three customers asked.', sourceModule: 'key_inbox', sourceEntityType: 'KeyInboxThread' }],
        confidence: 0.85,
        status: 'NEW',
        createdAt: new Date().toISOString(),
        reviewedAt: null,
      },
    ] as GenomeSignalData[]);

    const recs = await service.generateRecommendations({ businessId: 'biz_1', sources: ['SIGNAL'] });

    expect(recs.length).toBe(1);
    expect(recs[0].suggestedExperimentId).not.toBeNull();
    expect(experimentService.createExperiment).toHaveBeenCalled();
  });

  it('does not create an experiment for high-risk signal types', async () => {
    const { service, signalService, experimentService } = makeService();
    signalService.listSignals.mockResolvedValue([
      {
        id: 'sig_2',
        businessId: 'biz_1',
        sourceModule: 'executive_mode',
        sourceEntityType: 'CFO',
        sourceEntityId: 'finding_1',
        signalType: 'RISK_PATTERN',
        section: 'FINANCIAL',
        domain: 'finance',
        field: 'cash_flow',
        proposedValue: null,
        reason: 'Cash flow risk detected.',
        evidence: [{ id: 'ev_2', summary: 'CFO finding.', sourceModule: 'executive_mode', sourceEntityType: 'CFO' }],
        confidence: 0.85,
        status: 'NEW',
        createdAt: new Date().toISOString(),
        reviewedAt: null,
      },
    ] as GenomeSignalData[]);

    const recs = await service.generateRecommendations({ businessId: 'biz_1', sources: ['SIGNAL'] });

    expect(recs.length).toBe(1);
    expect(recs[0].suggestedExperimentId).toBeNull();
    expect(experimentService.createExperiment).not.toHaveBeenCalled();
  });

  it('ranks generated recommendations and respects maxRecommendations', async () => {
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
          {
            section: 'VISION_IDENTITY',
            domain: 'identity',
            field: 'mission',
            reason: 'Missing degraded fact: Mission',
            impact: 'DEGRADED',
          },
        ],
        optionalFacts: [],
        blockedReasons: [],
        recommendedSetupActions: [],
        automationAllowed: false,
        riskLevel: 'HIGH',
        lastComputedAt: new Date().toISOString(),
      },
    ] as ModuleReadinessData[]);

    const recs = await service.generateRecommendations({ businessId: 'biz_1', maxRecommendations: 1 });

    expect(recs).toHaveLength(1);
    expect(recs[0].title).toContain('business_name');
  });
});
