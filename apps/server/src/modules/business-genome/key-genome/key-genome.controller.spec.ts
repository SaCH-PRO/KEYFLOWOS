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
import { GenomeFinancialMetricService } from './genome-financial-metric.service';
import { FinanceGenomeService } from './finance-genome.service';
import { GenomeCustomerSegmentService } from './genome-customer-segment.service';
import { GenomeSalesMotionService } from './genome-sales-motion.service';
import { CustomerSalesGenomeService } from './customer-sales-genome.service';

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
      mockProvider(GenomeFinancialMetricService, {
        listMetrics: vi.fn().mockResolvedValue([]),
        upsertMetric: vi.fn().mockResolvedValue({ id: 'finm_1' }),
        getLatestMetric: vi.fn().mockResolvedValue(null),
        getLatestMetricsByType: vi.fn().mockResolvedValue({}),
        deleteMetric: vi.fn().mockResolvedValue({ deleted: true }),
      }),
      mockProvider(FinanceGenomeService, {
        computeFinanceSnapshot: vi.fn().mockResolvedValue({ id: 'finsnap_1' }),
        getLatestFinanceSnapshot: vi.fn().mockResolvedValue({ id: 'finsnap_1' }),
        listFinanceSnapshots: vi.fn().mockResolvedValue([]),
        generateFinanceSignals: vi.fn().mockResolvedValue([]),
        generateFinanceRecommendations: vi.fn().mockResolvedValue([]),
      }),
      mockProvider(GenomeCustomerSegmentService, {
        listSegments: vi.fn().mockResolvedValue([]),
        upsertSegment: vi.fn().mockResolvedValue({ id: 'seg_1' }),
        deleteSegment: vi.fn().mockResolvedValue({ deleted: true }),
      }),
      mockProvider(GenomeSalesMotionService, {
        listMotions: vi.fn().mockResolvedValue([]),
        upsertMotion: vi.fn().mockResolvedValue({ id: 'mot_1' }),
        deleteMotion: vi.fn().mockResolvedValue({ deleted: true }),
      }),
      mockProvider(CustomerSalesGenomeService, {
        computeCustomerSalesSnapshot: vi.fn().mockResolvedValue({ id: 'cssnap_1' }),
        getLatestCustomerSalesSnapshot: vi.fn().mockResolvedValue({ id: 'cssnap_1' }),
        listCustomerSalesSnapshots: vi.fn().mockResolvedValue([]),
        generateCustomerSalesSignals: vi.fn().mockResolvedValue([]),
        generateCustomerSalesRecommendations: vi.fn().mockResolvedValue([]),
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

  it('lists finance metrics', async () => {
    const { controller } = await makeController();
    const result = await controller.listFinanceMetrics('biz_1', 'REVENUE', '2026-06', 'TTD', '0.8', '10');

    expect(result).toEqual([]);
  });

  it('upserts a finance metric', async () => {
    const { controller } = await makeController();
    const result = await controller.upsertFinanceMetric('biz_1', {
      businessId: 'biz_1',
      metricType: 'REVENUE',
      value: 10000,
      period: '2026-06',
    } as any);

    expect(result.id).toBe('finm_1');
  });

  it('gets latest finance snapshot', async () => {
    const { controller } = await makeController();
    const result = await controller.getFinanceSnapshot('biz_1');

    expect(result?.id).toBe('finsnap_1');
  });

  it('computes finance snapshot', async () => {
    const { controller } = await makeController();
    const result = await controller.computeFinanceSnapshot('biz_1', '2026-06');

    expect(result.id).toBe('finsnap_1');
  });

  it('lists finance snapshots', async () => {
    const { controller } = await makeController();
    const result = await controller.listFinanceSnapshots('biz_1', '2026-06', 'MEDIUM', '5');

    expect(result).toEqual([]);
  });

  it('generates finance signals', async () => {
    const { controller } = await makeController();
    const result = await controller.generateFinanceSignals('biz_1');

    expect(result).toEqual([]);
  });

  it('generates finance recommendations', async () => {
    const { controller } = await makeController();
    const result = await controller.generateFinanceRecommendations('biz_1');

    expect(result).toEqual([]);
  });

  it('lists customer segments', async () => {
    const { controller } = await makeController();
    const result = await controller.listCustomerSegments('biz_1', 'HIGH_VALUE', 'online', '0.8', '10');

    expect(result).toEqual([]);
  });

  it('upserts a customer segment', async () => {
    const { controller } = await makeController();
    const result = await controller.upsertCustomerSegment('biz_1', {
      businessId: 'biz_1',
      name: 'Enterprise',
      segmentType: 'HIGH_VALUE',
    } as any);

    expect(result.id).toBe('seg_1');
  });

  it('lists sales motions', async () => {
    const { controller } = await makeController();
    const result = await controller.listSalesMotions('biz_1', 'INBOUND', 'AWARENESS', 'online', 'true', '0.8', '10');

    expect(result).toEqual([]);
  });

  it('upserts a sales motion', async () => {
    const { controller } = await makeController();
    const result = await controller.upsertSalesMotion('biz_1', {
      businessId: 'biz_1',
      name: 'Inbound',
      motionType: 'INBOUND',
    } as any);

    expect(result.id).toBe('mot_1');
  });

  it('gets latest customer/sales snapshot', async () => {
    const { controller } = await makeController();
    const result = await controller.getCustomerSalesSnapshot('biz_1');

    expect(result?.id).toBe('cssnap_1');
  });

  it('computes customer/sales snapshot', async () => {
    const { controller } = await makeController();
    const result = await controller.computeCustomerSalesSnapshot('biz_1', '2026-06');

    expect(result.id).toBe('cssnap_1');
  });

  it('lists customer/sales snapshots', async () => {
    const { controller } = await makeController();
    const result = await controller.listCustomerSalesSnapshots('biz_1', '2026-06', 'MEDIUM', '5');

    expect(result).toEqual([]);
  });

  it('generates customer/sales signals', async () => {
    const { controller } = await makeController();
    const result = await controller.generateCustomerSalesSignals('biz_1');

    expect(result).toEqual([]);
  });

  it('generates customer/sales recommendations', async () => {
    const { controller } = await makeController();
    const result = await controller.generateCustomerSalesRecommendations('biz_1');

    expect(result).toEqual([]);
  });
});
