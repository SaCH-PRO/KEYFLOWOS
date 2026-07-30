import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DataInboxService } from './data-inbox.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { IngestionOrchestrator } from './ingestion-orchestrator.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';

describe('DataInboxService', () => {
  let service: DataInboxService;
  let prisma: {
    client: {
      ingestionItem: {
        findMany: ReturnType<typeof vi.fn>;
        findFirst: ReturnType<typeof vi.fn>;
        findUnique: ReturnType<typeof vi.fn>;
        update: ReturnType<typeof vi.fn>;
      };
    };
  };
  let orchestrator: {
    execute: ReturnType<typeof vi.fn>;
    reject: ReturnType<typeof vi.fn>;
    correct: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    prisma = {
      client: {
        ingestionItem: {
          findMany: vi.fn(),
          findFirst: vi.fn(),
          findUnique: vi.fn(),
          update: vi.fn(),
        },
      },
    };
    orchestrator = {
      execute: vi.fn(),
      reject: vi.fn(),
      correct: vi.fn(),
    };

    service = new DataInboxService(
      prisma as unknown as PrismaService,
      orchestrator as unknown as IngestionOrchestrator,
    );
  });

  const baseItem = {
    id: 'item_1',
    businessId: 'biz_1',
    sourceType: 'email',
    sourceConnectorType: 'gmail',
    status: 'reviewing',
    summary: 'Invoice request',
    confidence: 0.85,
    intentType: 'invoice_request',
    fromName: 'Alice',
    fromEmail: 'alice@example.com',
    createdAt: new Date(),
    updatedAt: new Date(),
    rawPayload: { id: 'msg_1' },
    attachments: [],
    extractedData: {},
    proposedActions: [{ type: 'create_invoice', payload: {} }],
    userFeedback: null,
    executedResults: null,
  };

  describe('listItems', () => {
    it('returns paginated items with cursor', async () => {
      prisma.client.ingestionItem.findMany.mockResolvedValue([
        { ...baseItem, id: 'item_1' },
        { ...baseItem, id: 'item_2' },
      ]);

      const result = await service.listItems('biz_1', { limit: 2 });

      expect(result.items).toHaveLength(2);
      expect(result.hasMore).toBe(false);
      expect(result.nextCursor).toBeNull();
      expect(prisma.client.ingestionItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { businessId: 'biz_1' },
          take: 3,
          skip: 0,
        }),
      );
    });

    it('applies filters and search', async () => {
      prisma.client.ingestionItem.findMany.mockResolvedValue([{ ...baseItem }]);

      await service.listItems('biz_1', {
        status: 'reviewing',
        sourceType: 'email',
        intentType: 'invoice',
        search: 'alice',
        sortBy: 'confidence',
        sortOrder: 'desc',
      });

      expect(prisma.client.ingestionItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            businessId: 'biz_1',
            status: 'reviewing',
            sourceType: 'email',
            intentType: expect.objectContaining({ contains: 'invoice' }),
            OR: expect.any(Array),
          }),
          orderBy: { confidence: 'desc' },
        }),
      );
    });

    it('sets nextCursor when more items exist', async () => {
      prisma.client.ingestionItem.findMany.mockResolvedValue([
        { ...baseItem, id: 'item_1' },
        { ...baseItem, id: 'item_2' },
        { ...baseItem, id: 'item_3' },
      ]);

      const result = await service.listItems('biz_1', { limit: 2 });

      expect(result.items).toHaveLength(2);
      expect(result.hasMore).toBe(true);
      expect(result.nextCursor).toBe('item_2');
    });
  });

  describe('getItem', () => {
    it('returns the item when owned by the business', async () => {
      prisma.client.ingestionItem.findFirst.mockResolvedValue({ ...baseItem });

      const result = await service.getItem('biz_1', 'item_1');

      expect(result.id).toBe('item_1');
      expect(prisma.client.ingestionItem.findFirst).toHaveBeenCalledWith({
        where: { id: 'item_1', businessId: 'biz_1' },
      });
    });

    it('throws NotFoundException when item does not belong', async () => {
      prisma.client.ingestionItem.findFirst.mockResolvedValue(null);

      await expect(service.getItem('biz_1', 'item_1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('approveItem', () => {
    it('calls orchestrator.execute and returns result', async () => {
      prisma.client.ingestionItem.findFirst.mockResolvedValue({ id: 'item_1' });
      orchestrator.execute.mockResolvedValue({ ...baseItem, status: 'approved' });

      const result = await service.approveItem('biz_1', 'item_1', 'user_1');

      expect(orchestrator.execute).toHaveBeenCalledWith('item_1', 'user_1');
      expect(result.status).toBe('approved');
    });
  });

  describe('rejectItem', () => {
    it('calls orchestrator.reject with reason', async () => {
      prisma.client.ingestionItem.findFirst.mockResolvedValue({ id: 'item_1' });
      orchestrator.reject.mockResolvedValue({ ...baseItem, status: 'rejected' });

      const result = await service.rejectItem('biz_1', 'item_1', 'spam');

      expect(orchestrator.reject).toHaveBeenCalledWith('item_1', 'user', 'spam');
      expect(result.status).toBe('rejected');
    });
  });

  describe('correctItem', () => {
    it('calls orchestrator.correct with actions', async () => {
      prisma.client.ingestionItem.findFirst.mockResolvedValue({ id: 'item_1' });
      orchestrator.correct.mockResolvedValue({ ...baseItem, proposedActions: [{ type: 'updated' }] });

      const result = await service.correctItem('biz_1', 'item_1', [{ type: 'updated' }], 'fix amount');

      expect(orchestrator.correct).toHaveBeenCalledWith('item_1', [{ type: 'updated' }], 'fix amount');
      expect(result.proposedActions).toEqual([{ type: 'updated' }]);
    });

    it('throws BadRequestException for empty actions', async () => {
      prisma.client.ingestionItem.findFirst.mockResolvedValue({ id: 'item_1' });

      await expect(service.correctItem('biz_1', 'item_1', [], 'note')).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
