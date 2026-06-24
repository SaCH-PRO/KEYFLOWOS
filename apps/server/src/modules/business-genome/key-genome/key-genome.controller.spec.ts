import { describe, expect, it, beforeEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { AuthGuard } from '../../../core/auth/auth.guard';
import { BusinessGuard } from '../../../core/auth/business.guard';
import { KeyGenomeController } from './key-genome.controller';
import { GenomeSignalService } from './genome-signal.service';
import { GenomeRecommendationService } from './genome-recommendation.service';
import { GenomeExperimentService } from './genome-experiment.service';
import { KeyGenomeGovernanceService } from './key-genome-governance.service';
import { GenomeMemoryService } from './genome-memory.service';
import { GenomeDepartmentService } from './genome-department.service';
import { DepartmentReadinessService } from './department-readiness.service';

function mockProvider(
  token: string | symbol | (new (...args: any[]) => any),
  value: Record<string, unknown>,
) {
  return { provide: token, useValue: value };
}

function makeMemoryEvent(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'mem_1',
    businessId: 'biz_1',
    sourceType: 'GENOME_RECOMMENDATION',
    sourceEntityId: 'rec_1',
    eventType: 'RECOMMENDATION_ACCEPTED',
    domain: 'VISION_IDENTITY',
    section: null,
    title: 'Recommendation accepted: Test',
    summary: 'Insight',
    outcome: 'UNKNOWN',
    impactScore: 0.5,
    confidenceDelta: 0,
    evidence: [],
    lessons: [],
    metadata: {},
    occurredAt: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

async function makeController() {
  const memoryService = {
    listMemoryEvents: vi.fn().mockResolvedValue([makeMemoryEvent()]),
    summarizeMemory: vi.fn().mockResolvedValue({
      businessId: 'biz_1',
      generatedAt: new Date().toISOString(),
      totalMemoryEvents: 1,
      successCount: 0,
      failureCount: 0,
      mixedCount: 0,
      unknownCount: 1,
      averageImpactScore: 0.5,
      averageConfidenceDelta: 0,
      topLessons: [],
      strongestDomains: [],
      weakestDomains: [],
      recentMemory: [],
    }),
    getMemoryEvent: vi.fn().mockResolvedValue(makeMemoryEvent()),
    findSimilarMemory: vi.fn().mockResolvedValue([makeMemoryEvent()]),
  };

  const moduleRef = await Test.createTestingModule({
    controllers: [KeyGenomeController],
    providers: [
      mockProvider(GenomeSignalService, {
        listSignals: vi.fn().mockResolvedValue([]),
        getSignal: vi.fn().mockResolvedValue({}),
        reviewSignal: vi.fn().mockResolvedValue({}),
        acceptSignal: vi.fn().mockResolvedValue({}),
        rejectSignal: vi.fn().mockResolvedValue({}),
        mergeSignal: vi.fn().mockResolvedValue({}),
      }),
      mockProvider(GenomeRecommendationService, {
        listRecommendations: vi.fn().mockResolvedValue([]),
        getRecommendation: vi.fn().mockResolvedValue({}),
        acceptRecommendation: vi.fn().mockResolvedValue({}),
        dismissRecommendation: vi.fn().mockResolvedValue({}),
        applyRecommendation: vi.fn().mockResolvedValue({}),
        trackOutcome: vi.fn().mockResolvedValue({}),
        generateRecommendations: vi.fn().mockResolvedValue([]),
      }),
      mockProvider(GenomeExperimentService, {
        listExperiments: vi.fn().mockResolvedValue([]),
        getExperiment: vi.fn().mockResolvedValue({}),
        createExperiment: vi.fn().mockResolvedValue({}),
        startExperiment: vi.fn().mockResolvedValue({}),
        completeExperiment: vi.fn().mockResolvedValue({}),
        failExperiment: vi.fn().mockResolvedValue({}),
        cancelExperiment: vi.fn().mockResolvedValue({}),
      }),
      mockProvider(KeyGenomeGovernanceService, {
        summary: vi.fn().mockResolvedValue({ businessId: 'biz_1' }),
        queue: vi.fn().mockResolvedValue([]),
      }),
      mockProvider(GenomeMemoryService, memoryService),
      mockProvider(GenomeDepartmentService, {
        listDepartments: vi.fn().mockResolvedValue([]),
        summary: vi.fn().mockResolvedValue({}),
        seedDepartments: vi.fn().mockResolvedValue({}),
        getDepartment: vi.fn().mockResolvedValue({}),
      }),
      mockProvider(DepartmentReadinessService, {
        computeDepartmentReadiness: vi.fn().mockResolvedValue({}),
        computeOneDepartment: vi.fn().mockResolvedValue({}),
      }),
    ],
  })
    .overrideGuard(AuthGuard)
    .useValue({ canActivate: () => true })
    .overrideGuard(BusinessGuard)
    .useValue({ canActivate: () => true })
    .compile();

  const controller = moduleRef.get<KeyGenomeController>(KeyGenomeController);
  return { controller, memoryService };
}

describe('KeyGenomeController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists memory events with filters', async () => {
    const { controller, memoryService } = await makeController();
    const result = await controller.listMemoryEvents('biz_1', 'GENOME_RECOMMENDATION', undefined, 'VISION_IDENTITY');

    expect(memoryService.listMemoryEvents).toHaveBeenCalledWith('biz_1', {
      sourceType: 'GENOME_RECOMMENDATION',
      eventType: undefined,
      domain: 'VISION_IDENTITY',
      section: undefined,
      outcome: undefined,
      minImpactScore: undefined,
      limit: undefined,
    });
    expect(result).toHaveLength(1);
  });

  it('returns memory summary', async () => {
    const { controller, memoryService } = await makeController();
    const result = await controller.memorySummary('biz_1');

    expect(memoryService.summarizeMemory).toHaveBeenCalledWith('biz_1');
    expect(result.totalMemoryEvents).toBe(1);
  });

  it('finds similar memory', async () => {
    const { controller, memoryService } = await makeController();
    const result = await controller.findSimilarMemory('biz_1', 'VISION_IDENTITY', 'RECOMMENDATION_ACCEPTED', 'SUCCESS');

    expect(memoryService.findSimilarMemory).toHaveBeenCalledWith('biz_1', {
      domain: 'VISION_IDENTITY',
      eventType: 'RECOMMENDATION_ACCEPTED',
      outcome: 'SUCCESS',
      limit: undefined,
    });
    expect(result).toHaveLength(1);
  });

  it('gets a single memory event', async () => {
    const { controller, memoryService } = await makeController();
    const result = await controller.getMemoryEvent('biz_1', 'mem_1');

    expect(memoryService.getMemoryEvent).toHaveBeenCalledWith('biz_1', 'mem_1');
    expect(result.id).toBe('mem_1');
  });
});
