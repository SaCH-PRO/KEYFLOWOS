import { describe, expect, it, vi } from 'vitest';
import { MarketStrategyDocumentBuilder } from './market-strategy-document-builder.service';
import type { PrismaService } from '../../core/prisma/prisma.service';

function makePrisma(overrides: Record<string, unknown> = {}) {
  const txClient = {
    documentSection: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      create: vi.fn().mockResolvedValue({ id: 'sec_1' }),
    },
    documentVersion: { create: vi.fn().mockResolvedValue({ id: 'ver_2' }) },
    documentInstance: { update: vi.fn().mockResolvedValue({ id: 'market-strategy:biz_1', currentVersionNum: 2 }) },
  };
  return {
    prismaService: {
      client: {
        $transaction: vi.fn(async (fn: (tx: typeof txClient) => Promise<unknown>) => fn(txClient)),
        documentType: { findUnique: vi.fn().mockResolvedValue({ id: 'dt_1', slug: 'market-strategy' }) },
        documentInstance: {
          findUnique: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue({ id: 'market-strategy:biz_1', currentVersionNum: 1 }),
        },
        business: { findUnique: vi.fn().mockResolvedValue({ id: 'biz_1', name: 'Test Biz' }) },
        businessProfileVersion: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue({ id: 'bpv_1', versionNumber: 1 }),
        },
        ...overrides,
      },
    },
    txClient,
  };
}

const strategyData = {
  swot: { strengths: ['s1'], weaknesses: ['w1'], opportunities: ['o1'], threats: ['t1'] },
  pestle: { political: 'p', economic: 'e', social: 's', technological: 't', legal: 'l', environmental: 'e' },
  positioning: { tagline: 'tag', valueProposition: 'vp', keyMessages: ['m1'], differentiators: ['d1'], targetSegments: ['seg1'] },
  launchPlan: { summary: 'summary', phases: [{ name: 'P1', duration: 'Week 1', actions: ['a1'] }] },
  analysisSummary: { marketOpportunityScore: 72, keyInsight: 'insight' },
  generatedAt: new Date().toISOString(),
};

describe('MarketStrategyDocumentBuilder', () => {
  it('returns deterministic instance id', () => {
    const { prismaService } = makePrisma();
    const builder = new MarketStrategyDocumentBuilder(prismaService as unknown as PrismaService);
    expect(builder.getInstanceId('biz_1')).toBe('market-strategy:biz_1');
  });

  it('checks existence by querying documentInstance', async () => {
    const { prismaService } = makePrisma();
    prismaService.client.documentInstance.findUnique = vi.fn().mockResolvedValue({ id: 'market-strategy:biz_1' });
    const builder = new MarketStrategyDocumentBuilder(prismaService as unknown as PrismaService);
    expect(await builder.exists('biz_1')).toBe(true);
  });

  it('throws NotFoundException when document type is missing', async () => {
    const { prismaService } = makePrisma();
    prismaService.client.documentType.findUnique = vi.fn().mockResolvedValue(null);
    const builder = new MarketStrategyDocumentBuilder(prismaService as unknown as PrismaService);
    await expect(builder.buildOrUpdate('biz_1', strategyData, [])).rejects.toThrow('market-strategy not found');
  });

  it('creates a new document instance when none exists', async () => {
    const { prismaService } = makePrisma();
    const builder = new MarketStrategyDocumentBuilder(prismaService as unknown as PrismaService);
    const result = await builder.buildOrUpdate('biz_1', strategyData, [{ name: 'Comp', threatLevel: 'MEDIUM', strengths: [], weaknesses: [] }]);

    expect(result.id).toBe('market-strategy:biz_1');
    expect(prismaService.client.documentInstance.create).toHaveBeenCalledOnce();
    const createData = prismaService.client.documentInstance.create.mock.calls[0][0].data;
    expect(createData.sections.create).toHaveLength(5);
    expect(createData.versions.create.versionNumber).toBe(1);
  });

  it('updates an existing document instance with a new version', async () => {
    const { prismaService, txClient } = makePrisma();
    prismaService.client.documentInstance.findUnique = vi.fn().mockResolvedValue({ id: 'market-strategy:biz_1', currentVersionNum: 1 });
    const builder = new MarketStrategyDocumentBuilder(prismaService as unknown as PrismaService);
    const result = await builder.buildOrUpdate('biz_1', strategyData, []);

    expect(result.currentVersionNum).toBe(2);
    expect(prismaService.client.$transaction).toHaveBeenCalledOnce();
    expect(txClient.documentSection.deleteMany).toHaveBeenCalledWith({ where: { instanceId: 'market-strategy:biz_1' } });
    expect(txClient.documentVersion.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ versionNumber: 2 }) }));
  });
});
