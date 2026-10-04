import { describe, expect, it, vi } from 'vitest';
import { KnowledgeIngestionService } from './knowledge-ingestion.service';

function fixture() {
  const knowledgeSource = {
    create: vi.fn().mockResolvedValue({ id: 'ks-1' }),
    update: vi.fn().mockResolvedValue({ id: 'ks-1' }),
    findMany: vi.fn().mockResolvedValue([]),
  };
  const prisma = { client: { knowledgeSource } };
  const semanticMemory = { store: vi.fn().mockResolvedValue(undefined) };
  const service = new KnowledgeIngestionService(
    prisma as never,
    semanticMemory as never,
  );
  return { service, knowledgeSource, semanticMemory };
}

describe('KnowledgeIngestionService reachability foundation', () => {
  it('chunks supplied text and preserves the source lineage on every semantic-memory write', async () => {
    const { service, knowledgeSource, semanticMemory } = fixture();
    const content = 'x'.repeat(4_501);

    const id = await service.ingestText({
      businessId: 'biz-1',
      title: 'Primary source',
      sourceType: 'url',
      sourceUrl: 'https://example.com/source',
      content,
    });

    expect(id).toBe('ks-1');
    expect(knowledgeSource.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        businessId: 'biz-1',
        title: 'Primary source',
        sourceType: 'url',
        sourceUrl: 'https://example.com/source',
        status: 'pending',
      }),
    });
    expect(semanticMemory.store).toHaveBeenCalledTimes(3);
    expect(semanticMemory.store).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        businessId: 'biz-1',
        sourceId: 'ks-1:0',
        metadata: expect.objectContaining({
          knowledgeSourceId: 'ks-1',
          chunkIndex: 0,
          sourceType: 'url',
        }),
      }),
    );
    expect(knowledgeSource.update).toHaveBeenCalledWith({
      where: { id: 'ks-1' },
      data: { status: 'processed' },
    });
  });

  it('registers a URL as pending without pretending it was fetched or learned', async () => {
    const { service, knowledgeSource, semanticMemory } = fixture();

    const id = await service.ingestUrl('biz-1', 'https://example.com/live', 'Live source');

    expect(id).toBe('ks-1');
    expect(knowledgeSource.create).toHaveBeenCalledWith({
      data: {
        businessId: 'biz-1',
        title: 'Live source',
        sourceType: 'url',
        sourceUrl: 'https://example.com/live',
        content: '',
        status: 'pending',
      },
    });
    expect(semanticMemory.store).not.toHaveBeenCalled();
    expect(knowledgeSource.update).not.toHaveBeenCalled();
  });
});
