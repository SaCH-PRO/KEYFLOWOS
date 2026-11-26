import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { KnowledgeIngestionService, MAX_PG_INT32 } from './knowledge-ingestion.service';
import {
  KnowledgeIngestionController,
  MAX_OFFSET,
  MAX_SYNC_TEXT_BYTES,
  MAX_URL_LENGTH,
} from './knowledge-ingestion.controller';

function fixture() {
  const knowledgeSource = {
    create: vi.fn().mockResolvedValue({ id: 'ks-1' }),
    findFirst: vi.fn().mockResolvedValue(null),
    update: vi.fn().mockResolvedValue({ id: 'ks-1', status: 'approved' }),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    findMany: vi.fn().mockResolvedValue([]),
  };
  const prisma = { client: { knowledgeSource } };
  const service = new KnowledgeIngestionService(prisma as never);
  const controller = new KnowledgeIngestionController(service);
  return { service, controller, knowledgeSource };
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

  it('approves a tenant-owned quarantined source atomically with tenant+state updateMany', async () => {
    const { service, knowledgeSource } = fixture();
    knowledgeSource.findFirst.mockResolvedValueOnce({ id: 'ks-1', status: 'quarantined' });

    const res = await service.approveSource('biz-1', 'ks-1');

    expect(res).toEqual({ sourceId: 'ks-1', status: 'approved' });
    expect(knowledgeSource.findFirst).toHaveBeenCalledWith({
      where: { id: 'ks-1', businessId: 'biz-1' },
      select: { id: true, status: true },
    });
    expect(knowledgeSource.updateMany).toHaveBeenCalledWith({
      where: { id: 'ks-1', businessId: 'biz-1', status: 'quarantined' },
      data: { status: 'approved' },
    });
    expect(knowledgeSource.update).not.toHaveBeenCalled();
  });

  it('returns cleanly when approving an already-approved source without redundant update', async () => {
    const { service, knowledgeSource } = fixture();
    knowledgeSource.findFirst.mockResolvedValueOnce({ id: 'ks-1', status: 'approved' });

    const res = await service.approveSource('biz-1', 'ks-1');

    expect(res).toEqual({ sourceId: 'ks-1', status: 'approved' });
    expect(knowledgeSource.update).not.toHaveBeenCalled();
    expect(knowledgeSource.updateMany).not.toHaveBeenCalled();
  });

  it('handles concurrent approval cleanly and rejects concurrent non-approved transition with ConflictException', async () => {
    const { service, knowledgeSource } = fixture();
    knowledgeSource.findFirst
      .mockResolvedValueOnce({ id: 'ks-1', status: 'quarantined' })
      .mockResolvedValueOnce({ id: 'ks-1', status: 'approved' });
    knowledgeSource.updateMany.mockResolvedValueOnce({ count: 0 });

    const ok = await service.approveSource('biz-1', 'ks-1');
    expect(ok).toEqual({ sourceId: 'ks-1', status: 'approved' });

    knowledgeSource.findFirst
      .mockResolvedValueOnce({ id: 'ks-2', status: 'quarantined' })
      .mockResolvedValueOnce({ id: 'ks-2', status: 'rejected' });
    knowledgeSource.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(service.approveSource('biz-1', 'ks-2')).rejects.toThrow(ConflictException);
  });

  it('refuses pending, failed, and rejected sources with ConflictException and zero writes', async () => {
    for (const disallowed of ['pending', 'failed', 'rejected']) {
      const { service, knowledgeSource } = fixture();
      knowledgeSource.findFirst.mockResolvedValueOnce({ id: 'ks-1', status: disallowed });

      await expect(
        service.approveSource('biz-1', 'ks-1'),
        `approveSource should reject status=${disallowed}`,
      ).rejects.toThrow(ConflictException);
      expect(knowledgeSource.update).not.toHaveBeenCalled();
      expect(knowledgeSource.updateMany).not.toHaveBeenCalled();
    }
  });

  it('throws NotFoundException on missing or foreign sourceId without mutating', async () => {
    const { service, knowledgeSource } = fixture();
    knowledgeSource.findFirst.mockResolvedValueOnce(null);

    await expect(service.approveSource('biz-2', 'ks-owned-by-biz-1')).rejects.toThrow(
      NotFoundException,
    );
    expect(knowledgeSource.findFirst).toHaveBeenCalledWith({
      where: { id: 'ks-owned-by-biz-1', businessId: 'biz-2' },
      select: { id: true, status: true },
    });
    expect(knowledgeSource.update).not.toHaveBeenCalled();
    expect(knowledgeSource.updateMany).not.toHaveBeenCalled();
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

  it('caps service-side pagination defensively including Int32 offset ceiling', async () => {
    const { service, knowledgeSource } = fixture();

    await service.listSources('biz-1', undefined, { limit: 500, offset: -3 });

    expect(knowledgeSource.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 100,
        skip: 0,
      }),
    );

    await service.listSources('biz-1', undefined, { limit: 10, offset: MAX_PG_INT32 + 500 });
    expect(knowledgeSource.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        take: 10,
        skip: MAX_PG_INT32,
      }),
    );
  });
});

describe('KnowledgeIngestionController input validation', () => {
  it('accepts http and https URLs and rejects unsafe protocols, control chars, whitespace, and oversized URLs', async () => {
    const { controller, knowledgeSource } = fixture();

    const okHttps = await controller.registerUrl('biz-1', {
      url: 'https://example.com/guide',
      title: 'Guide',
    });
    expect(okHttps).toEqual({
      sourceId: 'ks-1',
      status: 'pending',
      acquisition: 'NOT_FETCHED',
    });

    const okHttp = await controller.registerUrl('biz-1', {
      url: 'http://example.com/legacy',
    });
    expect(okHttp.status).toBe('pending');
    expect(knowledgeSource.create).toHaveBeenCalledTimes(2);

    for (const badUrl of [
      'javascript:alert(1)',
      'file:///etc/passwd',
      'data:text/plain,hi',
      'ftp://example.com/file',
      `https://example.com/${'a'.repeat(MAX_URL_LENGTH)}`,
      'https://example.com/path\r\nX-Injected: 1',
      'https://example.com/path\nline2',
      'https://example.com/path\rline2',
      'https://example.com/path\tcol2',
      'https://example.com/path with spaces',
      ' https://example.com/leading-space',
      'https://example.com/nul\u0000byte',
      'https://example.com/del\u007fchar',
    ]) {
      await expect(
        controller.registerUrl('biz-1', { url: badUrl }),
        `registerUrl should reject ${JSON.stringify(badUrl.slice(0, 48))}`,
      ).rejects.toThrow(BadRequestException);

      await expect(
        controller.ingestText('biz-1', {
          title: 'Doc',
          content: 'safe body',
          sourceUrl: badUrl,
        }),
        `ingestText sourceUrl should reject ${JSON.stringify(badUrl.slice(0, 48))}`,
      ).rejects.toThrow(BadRequestException);
    }
  });

  it('enforces the 64 KiB UTF-8 byte cap including multi-byte UTF-8 characters', async () => {
    const { controller } = fixture();

    // Exact 64 KiB ASCII succeeds
    const exactOk = await controller.ingestText('biz-1', {
      title: 'Exact 64 KiB',
      content: 'a'.repeat(MAX_SYNC_TEXT_BYTES),
    });
    expect(exactOk).toEqual({
      sourceId: 'ks-1',
      status: 'quarantined',
      retrieval: 'NOT_ADMITTED',
    });

    // 64 KiB + 1 ASCII byte fails
    await expect(
      controller.ingestText('biz-1', {
        title: 'Over ASCII',
        content: 'a'.repeat(MAX_SYNC_TEXT_BYTES + 1),
      }),
    ).rejects.toThrow(BadRequestException);

    // 32,769 2-byte UTF-8 characters = 65,538 bytes (> 64 KiB) even though string.length < 65,536
    await expect(
      controller.ingestText('biz-1', {
        title: 'Over multi-byte UTF-8',
        content: 'é'.repeat(MAX_SYNC_TEXT_BYTES / 2 + 1),
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects invalid pagination, repeated-param arrays, Int32 offset overflow, and invalid status on list()', () => {
    const { controller } = fixture();

    const cases: Array<[string | string[] | undefined, string | string[] | undefined, string | string[] | undefined]> = [
      [undefined, '0', undefined],
      [undefined, '-1', undefined],
      [undefined, '101', undefined],
      [undefined, 'abc', undefined],
      [undefined, '1.5', undefined],
      [undefined, ['10', '20'], undefined],
      [undefined, undefined, '-1'],
      [undefined, undefined, 'abc'],
      [undefined, undefined, ''],
      [undefined, undefined, ['0', '10']],
      [undefined, undefined, String(MAX_OFFSET + 1)],
      [undefined, undefined, '99999999999999999999'],
      ['unknown_status', undefined, undefined],
      [['approved', 'pending'], undefined, undefined],
    ];

    for (const [status, limit, offset] of cases) {
      expect(
        () => controller.list('biz-1', status, limit, offset),
        `list(${JSON.stringify(status)}, ${JSON.stringify(limit)}, ${JSON.stringify(offset)}) should throw`,
      ).toThrow(BadRequestException);
    }
  });
});
