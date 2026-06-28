import { describe, it, expect, beforeEach, vi } from 'vitest';
import { KeyCortexLearningService } from '../key-cortex-learning.service';

function createMockPrisma(memories: any[] = []) {
  return {
    client: {
      cognitionMemory: {
        create: vi.fn().mockResolvedValue({ id: 'cm_1' }),
        findFirst: vi.fn().mockResolvedValue(memories[0] ?? null),
        findMany: vi.fn().mockResolvedValue(memories),
        update: vi.fn().mockResolvedValue({ id: 'cm_1' }),
        count: vi.fn().mockResolvedValue(0),
      },
      genomeRecommendationOutcome: {
        create: vi.fn().mockResolvedValue({ id: 'gro_1' }),
      },
      keyEvolutionLog: {
        create: vi.fn().mockResolvedValue({ id: 'kel_1' }),
      },
    },
  };
}

const mockModelGateway = {
  complete: vi.fn().mockResolvedValue({ text: 'Users prefer shorter responses.\nAvoid aggressive upsells.' }),
};

function createService(mockPrisma: any, withGateway = true) {
  return new KeyCortexLearningService(
    mockPrisma,
    withGateway ? mockModelGateway : undefined,
  );
}

describe('KeyCortexLearningService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('recordObservation creates a cognition memory with no_action', async () => {
    const mockPrisma = createMockPrisma();
    const service = createService(mockPrisma);

    await service.recordObservation({
      sessionId: 'sess_1',
      businessId: 'biz_1',
      userId: 'user_1',
      roleId: 'ceo',
      functionId: 'strategy',
      query: 'How do I grow revenue?',
      recommendation: 'Focus on upselling existing customers.',
      confidence: 0.8,
    });

    expect(mockPrisma.client.cognitionMemory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sessionId: 'sess_1',
          businessId: 'biz_1',
          userResponse: 'no_action',
          confidence: 0.8,
        }),
      }),
    );
  });

  it('recordFeedback updates existing cognition memory and extracts lessons', async () => {
    const existing = {
      id: 'cm_1',
      query: 'How do I grow revenue?',
      recommendation: 'Focus on upselling existing customers.',
      confidence: 0.8,
      lessonsLearned: [],
      metadata: {},
    };
    const mockPrisma = createMockPrisma([existing]);
    const service = createService(mockPrisma);

    await service.recordFeedback({
      sessionId: 'sess_1',
      businessId: 'biz_1',
      userResponse: 'accepted',
      actualOutcome: 'Revenue increased 10%',
    });

    expect(mockPrisma.client.cognitionMemory.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'cm_1' },
        data: expect.objectContaining({
          userResponse: 'accepted',
          actualOutcome: 'Revenue increased 10%',
          lessonsLearned: expect.arrayContaining([
            expect.stringContaining('Users prefer shorter responses'),
            expect.stringContaining('Avoid aggressive upsells'),
          ]),
        }),
      }),
    );

    expect(mockPrisma.client.genomeRecommendationOutcome.create).toHaveBeenCalled();
    expect(mockPrisma.client.keyEvolutionLog.create).toHaveBeenCalled();
  });

  it('recordFeedback falls back to rule-based lessons when LLM is unavailable', async () => {
    const existing = {
      id: 'cm_1',
      query: 'How do I grow revenue?',
      recommendation: 'Focus on upselling existing customers.',
      confidence: 0.8,
      lessonsLearned: [],
      metadata: {},
    };
    const mockPrisma = createMockPrisma([existing]);
    const service = createService(mockPrisma, false);

    await service.recordFeedback({
      sessionId: 'sess_1',
      businessId: 'biz_1',
      userResponse: 'rejected',
    });

    expect(mockPrisma.client.cognitionMemory.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userResponse: 'rejected',
          lessonsLearned: expect.arrayContaining([
            expect.stringContaining('rejected'),
          ]),
        }),
      }),
    );
  });

  it('retrieveLessons returns formatted lessons relevant to query', async () => {
    const memories = [
      {
        query: 'pricing strategy',
        recommendation: 'Raise prices by 10%',
        lessonsLearned: ['Users resist price increases without added value.'],
      },
      {
        query: 'marketing channels',
        recommendation: 'Use email marketing',
        lessonsLearned: ['Email marketing performs well for retention.'],
      },
    ];
    const mockPrisma = createMockPrisma(memories);
    const service = createService(mockPrisma, false);

    const lessons = await service.retrieveLessons('biz_1', 'What pricing should we use?', { limit: 2 });

    expect(lessons.length).toBeGreaterThan(0);
    expect(lessons[0]).toContain('price increases');
  });

  it('getAcceptanceRate aggregates accepted/rejected/modified responses', async () => {
    const mockPrisma = createMockPrisma();
    mockPrisma.client.cognitionMemory.count = vi
      .fn()
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(8);

    const service = createService(mockPrisma, false);
    const rate = await service.getAcceptanceRate('biz_1');

    expect(rate.accepted).toBe(5);
    expect(rate.rejected).toBe(2);
    expect(rate.modified).toBe(1);
    expect(rate.total).toBe(8);
    expect(rate.rate).toBe(0.625);
  });

  it('calibrateConfidence returns calibrated value and knowledge gap when overconfident', async () => {
    const mockPrisma = createMockPrisma();
    mockPrisma.client.cognitionMemory.count = vi
      .fn()
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(8)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(11);

    const service = createService(mockPrisma, false);
    const calibration = await service.calibrateConfidence(0.9, 'biz_1');

    expect(calibration.reliable).toBe(true);
    expect(calibration.calibrated).toBeLessThan(0.9);
    expect(calibration.knowledgeGap).toContain('higher than observed acceptance rate');
  });

  it('calibrateConfidence marks unreliable when sample size is low', async () => {
    const mockPrisma = createMockPrisma();
    mockPrisma.client.cognitionMemory.count = vi.fn().mockResolvedValue(0);

    const service = createService(mockPrisma, false);
    const calibration = await service.calibrateConfidence(0.8, 'biz_1', { minSamples: 5 });

    expect(calibration.reliable).toBe(false);
    expect(calibration.calibrated).toBe(0.8);
  });
});
