import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AiApprovalsService } from './ai-approvals.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AiOversightService } from './ai-oversight.service';
import { NotFoundException } from '@nestjs/common';

describe('AiApprovalsService', () => {
  let service: AiApprovalsService;
  let prisma: {
    client: {
      aiApprovalItem: {
        findMany: ReturnType<typeof vi.fn>;
        findFirst: ReturnType<typeof vi.fn>;
        update: ReturnType<typeof vi.fn>;
        count: ReturnType<typeof vi.fn>;
        groupBy: ReturnType<typeof vi.fn>;
      };
    };
  };
  let oversight: {
    resolveApproval: ReturnType<typeof vi.fn>;
    resolveApprovalsBatch: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    prisma = {
      client: {
        aiApprovalItem: {
          findMany: vi.fn(),
          findFirst: vi.fn(),
          update: vi.fn(),
          count: vi.fn(),
          groupBy: vi.fn(),
        },
      },
    };
    oversight = {
      resolveApproval: vi.fn(),
      resolveApprovalsBatch: vi.fn(),
    };

    service = new AiApprovalsService(
      prisma as unknown as PrismaService,
      oversight as unknown as AiOversightService,
    );
  });

  const baseItem = {
    id: 'ai_1',
    businessId: 'biz_1',
    userId: null,
    status: 'pending',
    riskTier: 2,
    toolName: 'test_tool',
    module: 'operations',
    title: 'Test approval',
    description: null,
    rationale: null,
    expectedBenefit: null,
    risks: null,
    inputPayload: { key: 'value' },
    affectedEntities: [{ id: 'ent_1' }],
    planId: null,
    planStepId: null,
    resolvedAt: null,
    resolvedBy: null,
    resolvedByUserId: null,
    resolution: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  describe('listItems', () => {
    it('returns paginated items with default status', async () => {
      prisma.client.aiApprovalItem.findMany.mockResolvedValue([
        { ...baseItem, id: 'ai_1' },
        { ...baseItem, id: 'ai_2' },
      ]);

      const result = await service.listItems('biz_1', { limit: 2 });

      expect(result.items).toHaveLength(2);
      expect(result.hasMore).toBe(false);
      expect(result.nextCursor).toBeNull();
      expect(prisma.client.aiApprovalItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { businessId: 'biz_1', status: 'pending' },
          take: 3,
          skip: 0,
        }),
      );
    });

    it('applies search and module filters', async () => {
      prisma.client.aiApprovalItem.findMany.mockResolvedValue([{ ...baseItem }]);

      await service.listItems('biz_1', {
        status: 'approved',
        module: 'operations',
        search: 'Test',
      });

      expect(prisma.client.aiApprovalItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            businessId: 'biz_1',
            status: 'approved',
            module: 'operations',
            OR: expect.any(Array),
          }),
        }),
      );
    });

    it('sets nextCursor when more items exist', async () => {
      prisma.client.aiApprovalItem.findMany.mockResolvedValue([
        { ...baseItem, id: 'ai_1' },
        { ...baseItem, id: 'ai_2' },
        { ...baseItem, id: 'ai_3' },
      ]);

      const result = await service.listItems('biz_1', { limit: 2 });

      expect(result.items).toHaveLength(2);
      expect(result.hasMore).toBe(true);
      expect(result.nextCursor).toBe('ai_2');
    });
  });

  describe('getItem', () => {
    it('returns serialized item', async () => {
      prisma.client.aiApprovalItem.findFirst.mockResolvedValue({ ...baseItem });

      const result = await service.getItem('biz_1', 'ai_1');

      expect(result.id).toBe('ai_1');
      expect(result.inputPayload).toEqual({ key: 'value' });
      expect(result.affectedEntities).toEqual([{ id: 'ent_1' }]);
    });

    it('throws NotFoundException when item missing', async () => {
      prisma.client.aiApprovalItem.findFirst.mockResolvedValue(null);

      await expect(service.getItem('biz_1', 'missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('resolveItem', () => {
    it('delegates to AiOversightService', async () => {
      oversight.resolveApproval.mockResolvedValue({ ...baseItem, status: 'approved' });

      const result = await service.resolveItem('biz_1', 'ai_1', 'approved', 'user_1');

      expect(oversight.resolveApproval).toHaveBeenCalledWith('ai_1', 'biz_1', 'approved', 'user_1');
      expect(result.status).toBe('approved');
    });
  });

  describe('resolveBatch', () => {
    it('uses batch resolver for approved', async () => {
      oversight.resolveApprovalsBatch.mockResolvedValue({ succeeded: 2, failed: 0, total: 2 });

      const result = await service.resolveBatch('biz_1', ['ai_1', 'ai_2'], 'approved', 'user_1');

      expect(oversight.resolveApprovalsBatch).toHaveBeenCalledWith(
        'biz_1',
        ['ai_1', 'ai_2'],
        'approved',
        'user_1',
      );
      expect(result.succeeded).toBe(2);
    });

    it('resolves deferred items individually', async () => {
      oversight.resolveApproval.mockResolvedValue({ status: 'deferred' });

      const result = await service.resolveBatch('biz_1', ['ai_1'], 'deferred', 'user_1');

      expect(oversight.resolveApproval).toHaveBeenCalledWith('ai_1', 'biz_1', 'deferred', 'user_1');
      expect(oversight.resolveApprovalsBatch).not.toHaveBeenCalled();
      expect(result.succeeded).toBe(1);
    });
  });

  describe('getStats', () => {
    it('returns aggregated counts', async () => {
      prisma.client.aiApprovalItem.count.mockResolvedValueOnce(5);
      prisma.client.aiApprovalItem.count.mockResolvedValueOnce(2);
      prisma.client.aiApprovalItem.count.mockResolvedValueOnce(1);
      prisma.client.aiApprovalItem.count.mockResolvedValueOnce(0);
      prisma.client.aiApprovalItem.groupBy.mockResolvedValue([
        { module: 'operations', _count: { module: 3 } },
        { module: null, _count: { module: 2 } },
      ]);

      const result = await service.getStats('biz_1');

      expect(result).toEqual({
        pending: 5,
        approvedToday: 2,
        rejectedToday: 1,
        escalated: 0,
        byModule: [
          { module: 'operations', count: 3 },
          { module: 'unknown', count: 2 },
        ],
      });
    });
  });
});
