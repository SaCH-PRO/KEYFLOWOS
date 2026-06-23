import { describe, expect, it, vi } from 'vitest';
import { OutcomeLearningService } from './outcome-learning.service';
import type {
  GenomeExperimentData,
  GenomeRecommendationData,
  GenomeSignalData,
} from './key-genome.types';

function makeService() {
  const storedMemory: any[] = [];
  let nextMemoryId = 1;

  const memory = {
    createMemoryEvent: vi.fn(async (input: any) => {
      const row = { id: `mem_${nextMemoryId++}`, ...input, createdAt: new Date().toISOString() };
      storedMemory.push(row);
      return row;
    }),
    summarizeMemory: vi.fn(async (businessId: string) => ({
      businessId,
      generatedAt: new Date().toISOString(),
      totalMemoryEvents: storedMemory.length,
      successCount: 0,
      failureCount: 0,
      mixedCount: 0,
      unknownCount: storedMemory.length,
      averageImpactScore: 0.5,
      averageConfidenceDelta: 0,
      topLessons: [],
      strongestDomains: [],
      weakestDomains: [],
      recentMemory: storedMemory.slice(0, 25),
    })),
    findSimilarMemory: vi.fn(async () => []),
  } as any;

  const prisma = {
    client: {
      keyActionProposal: {
        findFirst: vi.fn(async ({ where }: any) => {
          if (where.id === 'prop_1') {
            return { id: 'prop_1', businessId: where.businessId, title: 'Test action', actionType: 'CREATE_TASK' };
          }
          return null;
        }),
      },
    },
  } as any;

  const service = new OutcomeLearningService(prisma, memory);

  return { service, memory, storedMemory, prisma };
}

describe('OutcomeLearningService', () => {
  function makeRec(overrides: Partial<GenomeRecommendationData> = {}): GenomeRecommendationData {
    return {
      id: 'rec_1',
      businessId: 'biz_1',
      domain: 'MARKETING',
      title: 'Test recommendation',
      insight: 'Insight',
      diagnosis: 'Diagnosis',
      recommendation: 'Do something',
      expectedGainScore: 70,
      riskLevel: 'MEDIUM',
      effortLevel: 'LOW',
      confidence: 0.7,
      evidenceIds: [],
      status: 'ACCEPTED',
      createdAt: new Date().toISOString(),
      ...overrides,
    };
  }

  function makeExp(overrides: Partial<GenomeExperimentData> = {}): GenomeExperimentData {
    return {
      id: 'exp_1',
      businessId: 'biz_1',
      hypothesis: 'Test hypothesis',
      action: 'Run test',
      successMetric: 'Conversion',
      durationDays: 14,
      riskLevel: 'LOW',
      status: 'RUNNING',
      createdAt: new Date().toISOString(),
      ...overrides,
    };
  }

  function makeSignal(overrides: Partial<GenomeSignalData> = {}): GenomeSignalData {
    return {
      id: 'sig_1',
      businessId: 'biz_1',
      sourceModule: 'key_inbox',
      sourceEntityType: 'KeyInboxThread',
      sourceEntityId: 'thread_1',
      signalType: 'CUSTOMER_PATTERN',
      section: 'CUSTOMER_MARKET',
      domain: 'customer',
      reason: 'Customers ask about weekends.',
      evidence: [],
      confidence: 0.8,
      status: 'ACCEPTED',
      createdAt: new Date().toISOString(),
      ...overrides,
    };
  }

  it('records successful recommendation outcome', async () => {
    const { service, storedMemory } = makeService();
    await service.recordRecommendationOutcome('biz_1', makeRec(), { success: true, measuredValue: 85 });

    expect(storedMemory).toHaveLength(1);
    expect(storedMemory[0].outcome).toBe('SUCCESS');
    expect(storedMemory[0].confidenceDelta).toBeGreaterThan(0);
  });

  it('records failed recommendation outcome', async () => {
    const { service, storedMemory } = makeService();
    await service.recordRecommendationOutcome('biz_1', makeRec(), { success: false });

    expect(storedMemory[0].outcome).toBe('FAILURE');
    expect(storedMemory[0].confidenceDelta).toBeLessThan(0);
  });

  it('creates correct confidenceDelta for signal accepted', async () => {
    const { service, storedMemory } = makeService();
    await service.recordSignalAccepted('biz_1', makeSignal());

    expect(storedMemory[0].eventType).toBe('SIGNAL_ACCEPTED');
    expect(storedMemory[0].confidenceDelta).toBe(0.05);
  });

  it('records completed experiment outcome', async () => {
    const { service, storedMemory } = makeService();
    await service.recordExperimentCompleted('biz_1', makeExp(), { success: true, measuredValue: 90 });

    expect(storedMemory[0].outcome).toBe('SUCCESS');
    expect(storedMemory[0].eventType).toBe('EXPERIMENT_COMPLETED');
  });

  it('records failed experiment outcome', async () => {
    const { service, storedMemory } = makeService();
    await service.recordExperimentFailed('biz_1', makeExp(), { success: false });

    expect(storedMemory[0].outcome).toBe('FAILURE');
    expect(storedMemory[0].eventType).toBe('EXPERIMENT_FAILED');
  });

  it('records signal accepted/merged memory', async () => {
    const { service, storedMemory } = makeService();
    await service.recordSignalMerged('biz_1', makeSignal());

    expect(storedMemory[0].eventType).toBe('SIGNAL_MERGED');
    expect(storedMemory[0].outcome).toBe('SUCCESS');
    expect(storedMemory[0].confidenceDelta).toBe(0.1);
  });

  it('records blocked action memory', async () => {
    const { service, storedMemory } = makeService();
    await service.recordActionOutcome('biz_1', 'prop_1', 'BLOCKED');

    expect(storedMemory[0].eventType).toBe('ACTION_BLOCKED');
    expect(storedMemory[0].outcome).toBe('UNKNOWN');
  });

  it('produces learning summary', async () => {
    const { service } = makeService();
    await service.recordRecommendationOutcome('biz_1', makeRec(), { success: true });

    const summary = await service.computeLearningSummary('biz_1');
    expect(summary.totalMemoryEvents).toBe(1);
  });
});
