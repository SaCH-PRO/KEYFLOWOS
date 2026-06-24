import { describe, expect, it, vi } from 'vitest';
import { MarketingGenomeService } from './marketing-genome.service';
import type {
  GenomeContentStrategyData,
  GenomeGrowthChannelData,
} from './key-genome.types';

function makeChannel(overrides: Partial<GenomeGrowthChannelData> = {}): GenomeGrowthChannelData {
  return {
    id: 'ch_1',
    businessId: 'biz_1',
    key: 'paid_social',
    label: 'Paid Social',
    channelType: 'paid',
    status: 'ACTIVE',
    monthlyBudget: 5000,
    currency: 'TTD',
    targetCac: 100,
    targetConversionRate: 0.03,
    assumptions: {},
    evidenceIds: [],
    confidence: 0.8,
    sourceModule: null,
    sourceEntityType: null,
    sourceEntityId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeStrategy(overrides: Partial<GenomeContentStrategyData> = {}): GenomeContentStrategyData {
  return {
    id: 'cs_1',
    businessId: 'biz_1',
    pillars: ['Education', 'Product'],
    cadence: 'Weekly',
    formats: ['Video', 'Blog'],
    distributionChannels: ['social', 'email'],
    contentGoals: {},
    confidence: 0.8,
    sourceModule: null,
    sourceEntityType: null,
    sourceEntityId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeService() {
  const storedSnapshots: any[] = [];
  const storedMemory: any[] = [];
  let nextSnapshotId = 1;
  let nextSignalId = 1;
  let nextRecId = 1;

  const prisma = {
    client: {
      genomeMarketingSnapshot: {
        create: vi.fn(async ({ data }: { data: any }) => {
          const row = { id: `mgsnap_${nextSnapshotId++}`, ...data };
          storedSnapshots.push(row);
          return row;
        }),
        findFirst: vi.fn(async ({ where }: { where: any }) => {
          const matches = storedSnapshots.filter(
            (r) => r.businessId === where.businessId && (where.period === undefined || r.period === where.period),
          );
          matches.sort((a: any, b: any) => new Date(b.computedAt).getTime() - new Date(a.computedAt).getTime());
          return matches[0] ?? null;
        }),
        findMany: vi.fn(async ({ where, take }: { where: any; take?: number }) => {
          let results = storedSnapshots.filter((r) => r.businessId === where.businessId);
          if (where.period !== undefined) results = results.filter((r) => r.period === where.period);
          if (where.overallRisk) results = results.filter((r) => r.overallRisk === where.overallRisk);
          results.sort((a: any, b: any) => new Date(b.computedAt).getTime() - new Date(a.computedAt).getTime());
          return results.slice(0, take);
        }),
        update: vi.fn(async ({ where, data }: { where: { id: string }; data: any }) => {
          const idx = storedSnapshots.findIndex((r) => r.id === where.id);
          if (idx === -1) throw new Error('Not found');
          storedSnapshots[idx] = { ...storedSnapshots[idx], ...data };
          return storedSnapshots[idx];
        }),
      },
    },
  } as any;

  const channels = {
    findMany: vi.fn().mockResolvedValue([]),
    findById: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue(makeChannel()),
    update: vi.fn().mockResolvedValue(makeChannel()),
    delete: vi.fn().mockResolvedValue({ deleted: true }),
  };

  const contentStrategies = {
    findMany: vi.fn().mockResolvedValue([]),
    findById: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue(makeStrategy()),
    update: vi.fn().mockResolvedValue(makeStrategy()),
    delete: vi.fn().mockResolvedValue({ deleted: true }),
  };

  const signals = {
    createSignals: vi.fn().mockImplementation(async (inputs: any[]) => {
      return inputs.map((input) => ({
        id: `sig_${nextSignalId++}`,
        businessId: input.businessId,
        signalType: input.signalType,
        section: input.section,
        domain: input.domain,
        field: input.field,
        reason: input.reason,
        confidence: input.confidence,
        status: 'NEW',
        evidence: [],
        createdAt: new Date().toISOString(),
        reviewedAt: null,
      }));
    }),
  };

  const recommendations = {
    createRecommendation: vi.fn().mockImplementation(async (input: any) => ({
      id: `rec_${nextRecId++}`,
      ...input,
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
      reviewedAt: null,
      outcomeTrackedAt: null,
    })),
  };

  const memory = {
    createMemoryEvent: vi.fn().mockImplementation(async (input: any) => {
      const row = { id: `mem_${storedMemory.length + 1}`, ...input, createdAt: new Date() };
      storedMemory.push(row);
      return row;
    }),
  };

  const departmentReadiness = {
    computeOneDepartment: vi.fn().mockResolvedValue({ code: 'CMO_MARKETING' }),
  };

  const service = new MarketingGenomeService(
    prisma,
    channels as any,
    contentStrategies as any,
    signals as any,
    recommendations as any,
    memory as any,
    departmentReadiness as any,
  );

  return {
    service,
    prisma,
    channels,
    contentStrategies,
    signals,
    recommendations,
    memory,
    departmentReadiness,
    storedSnapshots,
    storedMemory,
  };
}

describe('MarketingGenomeService', () => {
  it('computes snapshot with complete data', async () => {
    const { service, channels, contentStrategies } = makeService();
    channels.findMany.mockResolvedValue([
      makeChannel({ monthlyBudget: 2500 }),
      makeChannel({ id: 'ch_2', key: 'seo', label: 'SEO', channelType: 'owned', monthlyBudget: 2500 }),
    ]);
    contentStrategies.findMany.mockResolvedValue([makeStrategy()]);

    const snapshot = await service.computeMarketingGrowthSnapshot('biz_1');

    expect(snapshot.channelMix.length).toBe(2);
    expect(snapshot.contentConsistencyScore).toBeGreaterThan(0);
    expect(snapshot.channelDiversificationScore).toBeGreaterThan(0);
    expect(snapshot.overallRisk).toBe('LOW');
    expect(snapshot.missingInputs.length).toBe(0);
  });

  it('detects channel concentration', async () => {
    const { service, channels } = makeService();
    channels.findMany.mockResolvedValue([
      makeChannel({ monthlyBudget: 9000 }),
      makeChannel({ id: 'ch_2', key: 'seo', label: 'SEO', channelType: 'owned', monthlyBudget: 1000 }),
    ]);

    const snapshot = await service.computeMarketingGrowthSnapshot('biz_1');

    expect(
      snapshot.warnings.some((w) => w.type === 'CHANNEL_CONCENTRATION'),
    ).toBe(true);
    expect(
      snapshot.recommendations.some((r) => r.type === 'DIVERSIFY_CHANNELS'),
    ).toBe(true);
  });

  it('detects missing content strategy', async () => {
    const { service, channels } = makeService();
    channels.findMany.mockResolvedValue([makeChannel()]);

    const snapshot = await service.computeMarketingGrowthSnapshot('biz_1');

    expect(snapshot.missingInputs).toContain('content_strategy');
    expect(
      snapshot.warnings.some((w) => w.type === 'NO_CONTENT_STRATEGY'),
    ).toBe(true);
  });

  it('detects high target CAC', async () => {
    const { service, channels } = makeService();
    channels.findMany.mockResolvedValue([
      makeChannel({ targetCac: 600 }),
    ]);

    const snapshot = await service.computeMarketingGrowthSnapshot('biz_1');

    expect(
      snapshot.warnings.some((w) => w.type === 'HIGH_TARGET_CAC'),
    ).toBe(true);
  });

  it('identifies missing growth inputs', async () => {
    const { service } = makeService();

    const snapshot = await service.computeMarketingGrowthSnapshot('biz_1');

    expect(snapshot.missingInputs.length).toBeGreaterThan(0);
    expect(snapshot.missingInputs).toContain('growth_channels');
    expect(snapshot.missingInputs).toContain('content_strategy');
  });

  it('writes memory event on snapshot compute', async () => {
    const { service, memory } = makeService();

    await service.computeMarketingGrowthSnapshot('biz_1');

    expect(memory.createMemoryEvent).toHaveBeenCalled();
    const call = memory.createMemoryEvent.mock.calls[0][0];
    expect(call.eventType).toBe('MARKETING_GROWTH_SNAPSHOT_COMPUTED');
  });

  it('recomputes CMO_MARKETING and SALES departments after snapshot', async () => {
    const { service, departmentReadiness } = makeService();

    await service.computeMarketingGrowthSnapshot('biz_1');

    expect(departmentReadiness.computeOneDepartment).toHaveBeenCalledWith('biz_1', 'CMO_MARKETING');
    expect(departmentReadiness.computeOneDepartment).toHaveBeenCalledWith('biz_1', 'SALES');
  });

  it('generates marketing/growth signals from snapshot', async () => {
    const { service, channels, signals } = makeService();
    channels.findMany.mockResolvedValue([
      makeChannel({ targetCac: 600 }),
    ]);

    await service.computeMarketingGrowthSnapshot('biz_1');
    const generated = await service.generateMarketingGrowthSignals('biz_1');

    expect(signals.createSignals).toHaveBeenCalled();
    expect(generated.length).toBeGreaterThan(0);
    expect(generated[0].businessId).toBe('biz_1');
  });

  it('generates marketing/growth recommendations from snapshot', async () => {
    const { service, channels, recommendations } = makeService();
    channels.findMany.mockResolvedValue([
      makeChannel({ targetCac: 600 }),
    ]);

    await service.computeMarketingGrowthSnapshot('biz_1');
    const generated = await service.generateMarketingGrowthRecommendations('biz_1');

    expect(recommendations.createRecommendation).toHaveBeenCalled();
    expect(generated.length).toBeGreaterThan(0);
  });

  it('lists marketing/growth snapshots', async () => {
    const { service, channels } = makeService();
    channels.findMany.mockResolvedValue([makeChannel()]);

    await service.computeMarketingGrowthSnapshot('biz_1');
    await service.computeMarketingGrowthSnapshot('biz_1');
    const list = await service.listMarketingGrowthSnapshots('biz_1');

    expect(list.length).toBe(2);
  });

  it('returns empty signals when no snapshot exists', async () => {
    const { service, signals } = makeService();

    const generated = await service.generateMarketingGrowthSignals('biz_1');

    expect(signals.createSignals).not.toHaveBeenCalled();
    expect(generated).toEqual([]);
  });

  it('returns empty recommendations when no snapshot exists', async () => {
    const { service, recommendations } = makeService();

    const generated = await service.generateMarketingGrowthRecommendations('biz_1');

    expect(recommendations.createRecommendation).not.toHaveBeenCalled();
    expect(generated).toEqual([]);
  });
});
