import { describe, it, expect, beforeEach, vi } from 'vitest';
import { KeyCortexMemoryService } from '../key-cortex-memory.service';
import { UnifiedMemoryWriterService } from '../unified-memory-writer.service';
import { AiMemoryService } from '../../ai/ai-memory.service';

const mockAiMemory = {
  getAll: vi.fn(),
  upsert: vi.fn(),
  remove: vi.fn(),
};

const mockWriter = {
  store: vi.fn(),
  storePreference: vi.fn(),
  storeBusinessFact: vi.fn(),
  storeLesson: vi.fn(),
  storeDocumentExtraction: vi.fn(),
  remove: vi.fn(),
  mapEntry: vi.fn((_businessId, entry) => ({
    id: entry.id,
    businessId: entry.businessId,
    userId: undefined,
    type: entry.category,
    key: entry.key,
    value: entry.value,
    confidence: entry.confidence,
    source: entry.source === 'user' ? 'explicit' : entry.source,
    accessCount: 1,
    lastAccessedAt: entry.updatedAt ?? entry.createdAt,
    createdAt: entry.createdAt,
  })),
};

const mockRedis = {
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
  keys: vi.fn().mockReturnValue([]),
};

function createService(): KeyCortexMemoryService {
  return new KeyCortexMemoryService(
    mockAiMemory as any,
    mockWriter as any,
    mockRedis as any,
  );
}

describe('KeyCortexMemoryService', () => {
  let service: KeyCortexMemoryService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = createService();
  });

  it('stores memory via UnifiedMemoryWriter and invalidates cache', async () => {
    mockWriter.store.mockResolvedValue({
      id: 'mem_1',
      businessId: 'biz_1',
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
    expect(mockWriter.store).toHaveBeenCalledWith(
      'biz_1',
      'business_fact',
      'primary_workflow',
      'project-based',
      expect.objectContaining({
        confidence: 0.9,
        source: 'genome',
      }),
    );
    expect(mockRedis.keys).toHaveBeenCalled();
  });

  it('retrieves memories from AiMemory when cache is empty', async () => {
    const now = new Date();
    mockRedis.get.mockResolvedValue(null);
    mockAiMemory.getAll.mockResolvedValue([
      {
        id: 'mem_1',
        businessId: 'biz_1',
        category: 'user_preference',
        key: 'tone',
        value: 'professional',
        source: 'user',
        confidence: 1,
        expiresAt: null,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    const memories = await service.retrieve({ businessId: 'biz_1' });

    expect(memories).toHaveLength(1);
    expect(memories[0].type).toBe('user_preference');
    expect(memories[0].source).toBe('explicit');
    expect(mockAiMemory.getAll).toHaveBeenCalledWith('biz_1');
    expect(mockRedis.set).toHaveBeenCalled();
  });

  it('filters retrieved memories by type', async () => {
    const now = new Date();
    mockRedis.get.mockResolvedValue(null);
    mockAiMemory.getAll.mockResolvedValue([
      {
        id: 'mem_1',
        businessId: 'biz_1',
        category: 'user_preference',
        key: 'tone',
        value: 'professional',
        source: 'user',
        confidence: 1,
        expiresAt: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'mem_2',
        businessId: 'biz_1',
        category: 'business_fact',
        key: 'industry',
        value: 'consulting',
        source: 'pattern_analysis',
        confidence: 0.9,
        expiresAt: null,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    const memories = await service.retrieve({
      businessId: 'biz_1',
      memoryTypes: ['business_fact'],
    });

    expect(memories).toHaveLength(1);
    expect(memories[0].type).toBe('business_fact');
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
    expect(mockAiMemory.getAll).not.toHaveBeenCalled();
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
