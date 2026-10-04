import { describe, expect, it, vi } from 'vitest';
import { KnowledgeIngestionService } from './knowledge-ingestion.service';

function fixture() {
  const knowledgeSource = {
    create: vi.fn().mockResolvedValue({ id: 'ks-1' }),
    findMany: vi.fn().mockResolvedValue([]),
  };
  const prisma = { client: { knowledgeSource } };
  const service = new KnowledgeIngestionService(prisma as never);
  return { service, knowledgeSource };
}

describe('KnowledgeIngestionService reachability foundation', () => {
  it('quarantines supplied text instead of writing it into live semantic retrieval', async () => {
    const { service, knowledgeSource } = fixture();

    const id = await service.ingestText({
      businessId: 'biz-1',
      title: 'Primary source',
      sourceType: 'url',
      sourceUrl: 'https://example.com/source',
      content: 'untrusted external instructions',
    });

    expect(id).toBe('ks-1');
    expect(knowledgeSource.create).toHaveBeenCalledWith({
      data: {
        businessId: 'biz-1',
        title: 'Primary source',
        sourceType: 'url',
        sourceUrl: 'https://example.com/source',
        content: 'untrusted external instructions',
        status: 'quarantined',
      },
    });
  });

  it('registers a URL as pending without pretending it was fetched or learned', async () => {
    const { service, knowledgeSource } = fixture();

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
  });

  it('lists bounded metadata only and never materializes source content', async () => {
    const { service, knowledgeSource } = fixture();

    await service.listSources('biz-1', 'quarantined', { limit: 25, offset: 50 });

    expect(knowledgeSource.findMany).toHaveBeenCalledWith({
      where: { businessId: 'biz-1', status: 'quarantined' },
      orderBy: { createdAt: 'desc' },
      take: 25,
      skip: 50,
      select: {
        id: true,
        title: true,
        sourceType: true,
        status: true,
        createdAt: true,
      },
    });
  });

  it('caps service-side pagination defensively', async () => {
    const { service, knowledgeSource } = fixture();

    await service.listSources('biz-1', undefined, { limit: 500, offset: -3 });

    expect(knowledgeSource.findMany).toHaveBeenCalledWith(expect.objectContaining({
      take: 100,
      skip: 0,
    }));
  });
});
