import { describe, it, expect, beforeEach, vi } from 'vitest';
import { KeyCortexMemoryService } from '../key-cortex-memory.service';

const mockPrisma = {
  client: {
    keyCortexMemory: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
  },
};

const mockRedis = {
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
  keys: vi.fn().mockReturnValue([]),
};

function createService(): KeyCortexMemoryService {
  return new KeyCortexMemoryService(
    mockPrisma as any,
    mockRedis as any,
  );
}

describe('KeyCortexMemoryService', () => {
  let service: KeyCortexMemoryService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = createService();
  });

  it('stores memory in Prisma and invalidates cache', async () => {
    mockPrisma.client.keyCortexMemory.create.mockResolvedValue({
      id: 'mem_1',
      businessId: 'biz_1',
      userId: null,
      type: 'business_fact',
      key: 'primary_workflow',
      value: 'project-based',
      source: 'genome',
      confidence: 0.9,
      accessCount: 1,
      lastAccessedAt: new Date(),
      createdAt: new Date(),
    });

    const memory = await service.storeBusinessFact(
      'biz_1',
      'primary_workflow',
      'project-based',
    );

    expect(memory.value).toBe('project-based');
    expect(memory.type).toBe('business_fact');
    expect(mockPrisma.client.keyCortexMemory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          businessId: 'biz_1',
          type: 'business_fact',
          key: 'primary_workflow',
          value: 'project-based',
          source: 'genome',
          confidence: 0.9,
        }),
      }),
    );
  });

  it('retrieves memories from DB when cache is empty', async () => {
    mockRedis.get.mockResolvedValue(null);
    mockPrisma.client.keyCortexMemory.findMany.mockResolvedValue([
      {
        id: 'mem_1',
        businessId: 'biz_1',
        userId: null,
        type: 'user_preference',
        key: 'tone',
        value: 'professional',
        source: 'explicit',
        confidence: 1,
        accessCount: 1,
        lastAccessedAt: new Date(),
        createdAt: new Date(),
      },
    ]);

    const memories = await service.retrieve({ businessId: 'biz_1' });

    expect(memories).toHaveLength(1);
    expect(memories[0].type).toBe('user_preference');
    expect(mockRedis.set).toHaveBeenCalled();
  });

  it('returns cached memories when available', async () => {
    const cached = [
      {
        id: 'mem_2',
        businessId: 'biz_1',
        type: 'business_fact',
        key: 'industry',
        value: 'consulting',
        source: 'genome',
        confidence: 0.9,
        accessCount: 1,
        lastAccessedAt: new Date(),
        createdAt: new Date(),
      },
    ];
    mockRedis.get.mockResolvedValue(JSON.stringify(cached));

    const memories = await service.retrieve({ businessId: 'biz_1' });

    expect(memories).toHaveLength(1);
    expect(mockPrisma.client.keyCortexMemory.findMany).not.toHaveBeenCalled();
  });

  it('formats memory for prompts', () => {
    const formatted = service.formatForPrompt([
      {
        id: 'm1',
        businessId: 'b1',
        type: 'business_fact',
        key: 'k1',
        value: 'we sell subscriptions',
        source: 'genome',
        confidence: 0.9,
        accessCount: 1,
        lastAccessedAt: new Date(),
        createdAt: new Date(),
      },
    ]);

    expect(formatted).toContain('Business Fact');
    expect(formatted).toContain('we sell subscriptions');
  });
});
