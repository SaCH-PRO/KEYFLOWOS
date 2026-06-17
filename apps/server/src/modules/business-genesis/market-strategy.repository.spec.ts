import { describe, expect, it, vi } from 'vitest';
import { MarketStrategyRepository } from './market-strategy.repository';
import type { PrismaService } from '../../core/prisma/prisma.service';

function makePrisma(overrides: Record<string, unknown> = {}) {
  const txClient = {
    marketStrategy: { upsert: vi.fn().mockResolvedValue({ id: 'ms_1', businessId: 'biz_1' }) },
    competitor: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      createManyAndReturn: vi.fn().mockResolvedValue([{ id: 'c1' }]),
    },
    ...overrides,
  };
  return {
    prismaService: {
      client: {
        $transaction: vi.fn(async (fn: (tx: typeof txClient) => Promise<unknown>) => fn(txClient)),
        marketStrategy: { findUnique: vi.fn().mockResolvedValue(null) },
        competitor: { findMany: vi.fn().mockResolvedValue([]) },
      },
    },
    txClient,
  };
}

const strategyData = {
  swot: { strengths: [], weaknesses: [], opportunities: [], threats: [] },
  pestle: { political: '', economic: '', social: '', technological: '', legal: '', environmental: '' },
  positioning: { tagline: '', valueProposition: '', keyMessages: [], differentiators: [], targetSegments: [] },
  launchPlan: { summary: '', phases: [] },
  analysisSummary: { marketOpportunityScore: 50, keyInsight: '' },
  generatedAt: new Date().toISOString(),
};

describe('MarketStrategyRepository', () => {
  it('replaceStrategyAndCompetitors upserts strategy and replaces competitors in a transaction', async () => {
    const { prismaService, txClient } = makePrisma();
    const repo = new MarketStrategyRepository(prismaService as unknown as PrismaService);

    const result = await repo.replaceStrategyAndCompetitors('biz_1', strategyData, [
      { name: 'A', threatLevel: 'HIGH', strengths: [], weaknesses: [] },
      { name: 'B', threatLevel: 'invalid' as unknown as 'LOW', strengths: [], weaknesses: [] },
    ]);

    expect(prismaService.client.$transaction).toHaveBeenCalledOnce();
    expect(txClient.marketStrategy.upsert).toHaveBeenCalledOnce();
    expect(txClient.competitor.deleteMany).toHaveBeenCalledWith({ where: { businessId: 'biz_1' } });
    expect(txClient.competitor.createManyAndReturn).toHaveBeenCalledOnce();
    const created = txClient.competitor.createManyAndReturn.mock.calls[0][0].data;
    expect(created[0].threatLevel).toBe('HIGH');
    expect(created[1].threatLevel).toBeNull();
    expect(result.strategy.id).toBe('ms_1');
  });

  it('findStrategyWithCompetitors returns strategy and competitors', async () => {
    const prismaService = {
      client: {
        $transaction: vi.fn(),
        marketStrategy: { findUnique: vi.fn().mockResolvedValue({ id: 'ms_1' }) },
        competitor: { findMany: vi.fn().mockResolvedValue([{ id: 'c1' }, { id: 'c2' }]) },
      },
    };
    const repo = new MarketStrategyRepository(prismaService as unknown as PrismaService);
    const result = await repo.findStrategyWithCompetitors('biz_1');

    expect(result.strategy).toEqual({ id: 'ms_1' });
    expect(result.competitors).toHaveLength(2);
    expect(prismaService.client.marketStrategy.findUnique).toHaveBeenCalledWith({ where: { businessId: 'biz_1' } });
    expect(prismaService.client.competitor.findMany).toHaveBeenCalledWith({ where: { businessId: 'biz_1' }, orderBy: { createdAt: 'asc' } });
  });
});
