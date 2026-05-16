import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { AiUsageAdminController } from './ai-usage-admin.controller';

const mockAiUsage = {
  getUsageSummary: vi.fn(),
  getUsageHistory: vi.fn(),
};

const mockPrismaClient = {
  aiUsageAlert: {
    findMany: vi.fn(),
    count: vi.fn(),
  },
  aiUsageLog: {
    aggregate: vi.fn(),
    groupBy: vi.fn(),
    count: vi.fn(),
  },
};

const mockPrisma = {
  client: mockPrismaClient,
};

function createController(): AiUsageAdminController {
  return new AiUsageAdminController(mockAiUsage as any, mockPrisma as any);
}

function superAdminReq() {
  return { user: { role: 'SUPER_ADMIN' } } as any;
}

function regularUserReq() {
  return { user: { role: 'USER' } } as any;
}

describe('AiUsageAdminController', () => {
  let controller: AiUsageAdminController;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetAllMocks();
    controller = createController();
  });

  describe('businessSummary', () => {
    it('returns summary for super admin', async () => {
      mockAiUsage.getUsageSummary.mockResolvedValue({ creditsUsed: 10 });
      const result = await controller.businessSummary(superAdminReq(), 'biz-1');
      expect(result).toEqual({ creditsUsed: 10 });
      expect(mockAiUsage.getUsageSummary).toHaveBeenCalledWith('biz-1');
    });

    it('throws ForbiddenException for non-admin', async () => {
      await expect(controller.businessSummary(regularUserReq(), 'biz-1')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('businessHistory', () => {
    it('returns history with default pagination', async () => {
      mockAiUsage.getUsageHistory.mockResolvedValue({ logs: [], total: 0 });
      const result = await controller.businessHistory(superAdminReq(), 'biz-1');
      expect(result).toEqual({ logs: [], total: 0 });
      expect(mockAiUsage.getUsageHistory).toHaveBeenCalledWith('biz-1', 50, 0);
    });

    it('returns history with custom pagination', async () => {
      mockAiUsage.getUsageHistory.mockResolvedValue({ logs: [], total: 0 });
      const result = await controller.businessHistory(superAdminReq(), 'biz-1', '10', '20');
      expect(mockAiUsage.getUsageHistory).toHaveBeenCalledWith('biz-1', 10, 20);
    });
  });

  describe('businessAlerts', () => {
    it('returns alerts filtered by notified', async () => {
      mockPrismaClient.aiUsageAlert.findMany.mockResolvedValue([{ id: 'a1' }]);
      const result = await controller.businessAlerts(superAdminReq(), 'biz-1', 'false');
      expect(result).toEqual([{ id: 'a1' }]);
      expect(mockPrismaClient.aiUsageAlert.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { businessId: 'biz-1', notified: false },
        }),
      );
    });
  });

  describe('platformSummary', () => {
    it('returns aggregated platform stats', async () => {
      mockPrismaClient.aiUsageLog.aggregate.mockResolvedValue({
        _count: 100,
        _sum: { creditsUsed: 500, estimatedCost: 1.5, totalTokens: 20000 },
      });
      mockPrismaClient.aiUsageLog.groupBy
        .mockResolvedValueOnce([
          { businessId: 'biz-1', _sum: { creditsUsed: 300, estimatedCost: 1.0 }, _count: 60 },
        ])
        .mockResolvedValueOnce([
          { feature: 'chat', _sum: { creditsUsed: 200, estimatedCost: 0.5 }, _count: 40 },
        ])
        .mockResolvedValueOnce([
          { provider: 'openai', _sum: { creditsUsed: 500, estimatedCost: 1.5, totalTokens: 20000 }, _count: 100 },
        ]);
      mockPrismaClient.aiUsageAlert.count
        .mockResolvedValueOnce(10)
        .mockResolvedValueOnce(3);

      const result = await controller.platformSummary(superAdminReq());

      expect(result.totals.calls).toBe(100);
      expect(result.totals.creditsUsed).toBe(500);
      expect(result.topBusinesses).toHaveLength(1);
      expect(result.byFeature).toHaveLength(1);
      expect(result.byProvider).toHaveLength(1);
      expect(result.alerts.total).toBe(10);
      expect(result.alerts.unnotified).toBe(3);
    });

    it('throws ForbiddenException for non-admin', async () => {
      await expect(controller.platformSummary(regularUserReq())).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('platformAlerts', () => {
    it('returns unnotified alerts with pagination', async () => {
      mockPrismaClient.aiUsageAlert.findMany.mockResolvedValue([{ id: 'a1' }]);
      mockPrismaClient.aiUsageAlert.count.mockResolvedValue(5);

      const result = await controller.platformAlerts(superAdminReq(), '10', '0');

      expect(result).toEqual({ alerts: [{ id: 'a1' }], total: 5, limit: 10, offset: 0 });
    });
  });
});
