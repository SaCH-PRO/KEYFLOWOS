import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UnifiedMemoryRetrievalService } from './unified-memory-retrieval.service';

function makePrisma(overrides?: Partial<any>) {
  const defaults = {
    aiMemory: { findMany: vi.fn().mockResolvedValue([]) },
    genomeMemoryEvent: { findMany: vi.fn().mockResolvedValue([]) },
    temporalFlowMemory: { findMany: vi.fn().mockResolvedValue([]) },
    cognitionMemory: { findMany: vi.fn().mockResolvedValue([]) },
    cognitiveEvent: { findMany: vi.fn().mockResolvedValue([]) },
  };
  return {
    client: { ...defaults, ...overrides },
  };
}

function makeSemanticMemory(overrides?: Partial<any>) {
  return {
    search: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

describe('UnifiedMemoryRetrievalService', () => {
  let service: UnifiedMemoryRetrievalService;

  beforeEach(() => {
    service = new UnifiedMemoryRetrievalService(makePrisma() as any, makeSemanticMemory() as any);
  });

  it('returns normalized fragments from structured memory', async () => {
    const now = new Date();
    const prisma = makePrisma({
      aiMemory: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'am_1',
            category: 'preference',
            key: 'timezone',
            value: 'America/Port_of_Spain',
            confidence: 0.95,
            createdAt: now,
          },
        ]),
      },
    });

    service = new UnifiedMemoryRetrievalService(prisma as any, makeSemanticMemory() as any);
    const fragments = await service.retrieveContext('biz_1', {});

    expect(fragments).toHaveLength(1);
    expect(fragments[0]).toMatchObject({
      id: 'am_1',
      sourceType: 'ai_memory',
      title: 'preference',
      content: 'preference.timezone: America/Port_of_Spain',
      confidence: 0.95,
    });
  });

  it('includes semantic memory when a query is provided', async () => {
    const now = new Date();
    const semanticMemory = makeSemanticMemory({
      search: vi.fn().mockResolvedValue([
        {
          id: 'sem_1',
          content: 'Previous invoice discussion',
          similarity: 0.88,
          metadata: { createdAt: now.toISOString() },
        },
      ]),
    });

    service = new UnifiedMemoryRetrievalService(makePrisma() as any, semanticMemory as any);
    const fragments = await service.retrieveContext('biz_1', { query: 'invoice' });

    expect(fragments).toHaveLength(1);
    expect(fragments[0]).toMatchObject({
      id: 'sem_1',
      sourceType: 'ai_memory_embedding',
      content: 'Previous invoice discussion',
    });
    expect(semanticMemory.search).toHaveBeenCalledWith(
      expect.objectContaining({ businessId: 'biz_1', query: 'invoice' }),
    );
  });

  it('filters by source type', async () => {
    const now = new Date();
    const prisma = makePrisma({
      aiMemory: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'am_1', category: 'pref', key: 'k1', value: 'v1', confidence: 1, createdAt: now },
        ]),
      },
      genomeMemoryEvent: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'gme_1',
            sourceType: 'signal',
            sourceEntityId: null,
            eventType: 'opportunity',
            title: 'Opportunity',
            summary: 'Revenue opportunity detected',
            confidenceDelta: 0.2,
            createdAt: now,
            metadata: {},
          },
        ]),
      },
    });

    service = new UnifiedMemoryRetrievalService(prisma as any, makeSemanticMemory() as any);
    const fragments = await service.retrieveContext('biz_1', { sourceTypes: ['genome_memory_event'] });

    expect(fragments).toHaveLength(1);
    expect(fragments[0].sourceType).toBe('genome_memory_event');
  });

  it('limits results and ranks by composite score', async () => {
    const now = new Date();
    const prisma = makePrisma({
      aiMemory: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'am_1', category: 'pref', key: 'k1', value: 'v1', confidence: 0.5, createdAt: now },
          { id: 'am_2', category: 'pref', key: 'k2', value: 'v2', confidence: 1, createdAt: now },
        ]),
      },
    });

    service = new UnifiedMemoryRetrievalService(prisma as any, makeSemanticMemory() as any);
    const fragments = await service.retrieveContext('biz_1', { limit: 1 });

    expect(fragments).toHaveLength(1);
    expect(fragments[0].id).toBe('am_2');
  });

  it('gracefully returns empty results when structured memory load fails', async () => {
    const prisma = makePrisma({
      aiMemory: {
        findMany: vi.fn().mockRejectedValue(new Error('DB unavailable')),
      },
    });

    service = new UnifiedMemoryRetrievalService(prisma as any, makeSemanticMemory() as any);
    const fragments = await service.retrieveContext('biz_1', {});

    expect(fragments).toEqual([]);
  });
});
