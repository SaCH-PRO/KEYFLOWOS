import { describe, expect, it, vi, beforeEach } from 'vitest';
import { TemporalFlowMemoryService } from './temporal-flow-memory.service';
import type { SemanticMemoryService } from '../ai/semantic-memory.service';

function makeService() {
  const memoryRows: any[] = [];
  const prisma = {
    client: {
      temporalFlowMemory: {
        findFirst: vi.fn(),
        findMany: vi.fn().mockResolvedValue(memoryRows),
        create: vi.fn(async (args: any) => {
          const row = { id: 'mem_1', ...args.data, createdAt: new Date(), updatedAt: new Date() };
          memoryRows.push(row);
          return row;
        }),
        update: vi.fn(async (args: any) => ({ id: args.where.id, ...args.data, createdAt: new Date(), updatedAt: new Date() })),
      },
      temporalFlowEvent: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      business: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    },
  } as any;

  const semanticMemory = {
    store: vi.fn().mockResolvedValue('emb_1'),
    search: vi.fn().mockResolvedValue([]),
  } as unknown as SemanticMemoryService;

  const service = new TemporalFlowMemoryService(prisma, semanticMemory);
  return { service, prisma, semanticMemory };
}

describe('TemporalFlowMemoryService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a new memory row and stores an embedding when confidence is high', async () => {
    const { service, prisma, semanticMemory } = makeService();
    prisma.client.temporalFlowMemory.findFirst.mockResolvedValue(null);

    const result = await service.createMemory({
      businessId: 'biz_1',
      entityType: 'thread',
      entityId: 'thread_1',
      type: 'summary',
      content: 'Test thread memory',
      sourceModule: 'key_inbox',
      confidence: 0.85,
    });

    expect(result.content).toBe('Test thread memory');
    expect(result.confidence).toBe(0.85);
    expect(prisma.client.temporalFlowMemory.create).toHaveBeenCalled();
    expect(semanticMemory.store).toHaveBeenCalled();
  });

  it('updates an existing memory row instead of duplicating', async () => {
    const { service, prisma } = makeService();
    prisma.client.temporalFlowMemory.findFirst.mockResolvedValue({
      id: 'mem_existing',
      businessId: 'biz_1',
      entityType: 'thread',
      entityId: 'thread_1',
      type: 'summary',
    });

    await service.createMemory({
      businessId: 'biz_1',
      entityType: 'thread',
      entityId: 'thread_1',
      type: 'summary',
      content: 'Updated memory',
      sourceModule: 'key_inbox',
    });

    expect(prisma.client.temporalFlowMemory.update).toHaveBeenCalledWith({
      where: { id: 'mem_existing' },
      data: expect.objectContaining({ content: 'Updated memory' }),
    });
  });

  it('summarizes a thread from temporal events', async () => {
    const { service, prisma } = makeService();
    prisma.client.temporalFlowEvent.findMany.mockResolvedValue([
      {
        id: 'ev_1',
        source: 'whatsapp',
        type: 'key_inbox.message_received',
        title: 'WhatsApp message received',
        occurredAt: new Date(),
        payload: { intent: 'lead_inquiry', sentiment: 'positive', urgency: 'HIGH' },
      },
    ]);

    const result = await service.summarizeThread('biz_1', 'thread_1');
    expect(result).not.toBeNull();
    expect(result?.content).toContain('1 event');
    expect(result?.content).toContain('lead_inquiry');
    expect(result?.confidence).toBeGreaterThan(0.5);
  });

  it('returns empty summary when no events exist', async () => {
    const { service, prisma } = makeService();
    prisma.client.temporalFlowEvent.findMany.mockResolvedValue([]);
    const result = await service.summarizeThread('biz_1', 'thread_1');
    expect(result).toBeNull();
  });

  it('compacts a business and returns counts', async () => {
    const { service, prisma } = makeService();
    prisma.client.temporalFlowEvent.findMany.mockResolvedValue([
      { threadId: 't1', contactId: 'c1', source: 'whatsapp' },
    ]);

    const result = await service.compactBusiness('biz_1');
    expect(result.threads).toBe(1);
    expect(result.contacts).toBe(1);
    expect(result.channels).toBe(1);
  });
});
