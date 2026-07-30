import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UnifiedMemoryRetrievalService } from './unified-memory-retrieval.service';

function makePrisma(overrides?: Partial<any>) {
  const defaults = {
    aiMemory: { findMany: vi.fn().mockResolvedValue([]) },
    genomeMemoryEvent: { findMany: vi.fn().mockResolvedValue([]) },
    temporalFlowMemory: { findMany: vi.fn().mockResolvedValue([]) },
    cognitionMemory: { findMany: vi.fn().mockResolvedValue([]) },
    cognitiveEvent: { findMany: vi.fn().mockResolvedValue([]) },
    businessEvent: { findMany: vi.fn().mockResolvedValue([]) },
    aiExecutionLog: { findMany: vi.fn().mockResolvedValue([]) },
    cortexActionLog: { findMany: vi.fn().mockResolvedValue([]) },
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

  it('includes episodic sources by default', async () => {
    const now = new Date();
    const prisma = makePrisma({
      businessEvent: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'be_1',
            eventType: 'invoice_paid',
            subjectType: 'invoice',
            subjectId: 'inv_1',
            actorType: 'system',
            actorId: 'key',
            action: 'update',
            before: null,
            after: { status: 'paid' },
            metadata: {},
            createdAt: now,
          },
        ]),
      },
      aiExecutionLog: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'aex_1',
            action: 'send_email',
            toolName: 'email_sender',
            module: 'communications',
            success: true,
            rationale: 'User requested update',
            inputSummary: {},
            outputSummary: {},
            errorMessage: null,
            metadata: {},
            createdAt: now,
          },
        ]),
      },
      cortexActionLog: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'cal_1',
            actionType: 'CREATE_TASK',
            status: 'success',
            description: 'Follow up with client',
            result: 'Task created',
            error: null,
            requiresApproval: false,
            estimatedImpact: 'medium',
            createdAt: now,
          },
        ]),
      },
    });

    service = new UnifiedMemoryRetrievalService(prisma as any, makeSemanticMemory() as any);
    const fragments = await service.retrieveContext('biz_1', {});

    const sourceTypes = fragments.map((f) => f.sourceType);
    expect(sourceTypes).toContain('business_event');
    expect(sourceTypes).toContain('ai_execution_log');
    expect(sourceTypes).toContain('cortex_action_log');
  });

  it('excludes episodic sources when includeEpisodic is false', async () => {
    const prisma = makePrisma({
      businessEvent: {
        findMany: vi.fn().mockResolvedValue([{ id: 'be_1', createdAt: new Date() }]),
      },
    });

    service = new UnifiedMemoryRetrievalService(prisma as any, makeSemanticMemory() as any);
    const fragments = await service.retrieveContext('biz_1', { includeEpisodic: false });

    expect(fragments).toHaveLength(0);
    expect(prisma.client.businessEvent.findMany).not.toHaveBeenCalled();
  });

  it('retrieveEpisodicContext returns only episodic fragments', async () => {
    const now = new Date();
    const prisma = makePrisma({
      aiMemory: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'am_1', category: 'pref', key: 'k1', value: 'v1', confidence: 1, createdAt: now },
        ]),
      },
      cortexActionLog: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'cal_1',
            actionType: 'CREATE_TASK',
            status: 'success',
            description: 'Follow up',
            result: null,
            error: null,
            requiresApproval: false,
            estimatedImpact: null,
            createdAt: now,
          },
        ]),
      },
    });

    service = new UnifiedMemoryRetrievalService(prisma as any, makeSemanticMemory() as any);
    const fragments = await service.retrieveEpisodicContext('biz_1', {});

    expect(fragments).toHaveLength(1);
    expect(fragments[0].sourceType).toBe('cortex_action_log');
  });
});
