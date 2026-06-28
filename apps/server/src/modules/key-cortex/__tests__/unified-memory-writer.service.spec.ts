import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UnifiedMemoryWriterService } from '../unified-memory-writer.service';
import { AiMemoryService } from '../../ai/ai-memory.service';

const mockAiMemory = {
  upsert: vi.fn(),
  remove: vi.fn(),
};

const mockSemanticMemory = {
  store: vi.fn(),
};

function createService(): UnifiedMemoryWriterService {
  return new UnifiedMemoryWriterService(
    mockAiMemory as any,
    mockSemanticMemory as any,
  );
}

function mockEntry(overrides: Partial<ReturnType<typeof mockAiMemory.upsert>> = {}) {
  const now = new Date();
  return {
    id: 'mem_1',
    businessId: 'biz_1',
    category: 'business_fact',
    key: 'primary_workflow',
    value: 'project-based',
    source: 'pattern_analysis',
    confidence: 0.9,
    expiresAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('UnifiedMemoryWriterService', () => {
  let service: UnifiedMemoryWriterService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = createService();
  });

  it('stores a memory and maps it to CortexMemory', async () => {
    mockAiMemory.upsert.mockResolvedValue(mockEntry());

    const memory = await service.store(
      'biz_1',
      'business_fact',
      'primary_workflow',
      'project-based',
      { confidence: 0.9, source: 'genome' },
    );

    expect(mockAiMemory.upsert).toHaveBeenCalledWith(
      'biz_1',
      expect.objectContaining({
        category: 'business_fact',
        key: 'primary_workflow',
        value: 'project-based',
        confidence: 0.9,
        source: 'pattern_analysis',
      }),
    );
    expect(memory.type).toBe('business_fact');
    expect(memory.source).toBe('genome');
    expect(memory.accessCount).toBe(1);
  });

  it('maps explicit source to user', async () => {
    mockAiMemory.upsert.mockResolvedValue(
      mockEntry({ source: 'user', category: 'user_preference', key: 'tone' }),
    );

    const memory = await service.storePreference('biz_1', 'user_1', 'tone', 'professional');

    expect(mockAiMemory.upsert).toHaveBeenCalledWith(
      'biz_1',
      expect.objectContaining({
        category: 'user_preference',
        source: 'user',
        confidence: 1.0,
      }),
    );
    expect(memory.source).toBe('explicit');
  });

  it('stores document extraction and normalizes key_document_service source', async () => {
    mockAiMemory.upsert.mockResolvedValue(
      mockEntry({
        category: 'document_extraction',
        key: 'doc_1',
        source: 'role_engine',
      }),
    );

    const memory = await service.storeDocumentExtraction(
      'biz_1',
      'doc_1',
      JSON.stringify({ extracted: true }),
      { source: 'key_document_service' },
    );

    expect(mockAiMemory.upsert).toHaveBeenCalledWith(
      'biz_1',
      expect.objectContaining({
        category: 'document_extraction',
        key: 'doc_1',
        source: 'role_engine',
      }),
    );
    expect(memory.type).toBe('document_extraction');
    expect(memory.source).toBe('inferred');
  });

  it('removes a memory by type and key', async () => {
    mockAiMemory.remove.mockResolvedValue(true);

    const result = await service.remove(
      'biz_1',
      'failed_attempt',
      'decision_123',
    );

    expect(result).toBe(true);
    expect(mockAiMemory.remove).toHaveBeenCalledWith(
      'biz_1',
      'failed_attempt',
      'decision_123',
    );
  });

  it('defaults source to inferred', async () => {
    mockAiMemory.upsert.mockResolvedValue(mockEntry({ source: 'inferred' }));

    const memory = await service.store(
      'biz_1',
      'current_goal',
      'goal_1',
      'launch product',
    );

    expect(mockAiMemory.upsert).toHaveBeenCalledWith(
      'biz_1',
      expect.objectContaining({ source: 'inferred' }),
    );
    expect(memory.source).toBe('inferred');
  });
});
