import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AiUsageAlertSchedulerService } from './ai-usage-alert-scheduler.service';

const mockPrismaClient = {
  aiUsageAlert: {
    findMany: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
    count: vi.fn(),
  },
  business: {
    findUnique: vi.fn(),
  },
  user: {
    findUnique: vi.fn(),
  },
};

const mockPrisma = {
  client: mockPrismaClient,
};

const mockNotifications = {
  create: vi.fn().mockResolvedValue({}),
};

const mockSystemEmail = {
  sendTransactional: vi.fn().mockResolvedValue({ id: 'msg-1' }),
};

const mockModuleRef = {
  get: vi.fn(),
};

function createService(): AiUsageAlertSchedulerService {
  return new AiUsageAlertSchedulerService(mockPrisma as any, mockModuleRef as any);
}

describe('AiUsageAlertSchedulerService', () => {
  let service: AiUsageAlertSchedulerService;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetAllMocks();
    service = createService();
  });

  describe('tick', () => {
    it('dispatches no alerts when none are unnotified', async () => {
      mockPrismaClient.aiUsageAlert.findMany.mockResolvedValue([]);
      const result = await service.tick();
      expect(result.dispatched).toBe(0);
    });

    it('dispatches and marks alerts as notified', async () => {
      const alert = {
        id: 'alert-1',
        businessId: 'biz-1',
        type: 'budget_threshold',
        threshold: 80,
        metadata: { used: 80, limit: 100, pct: 80 },
        triggeredAt: new Date(),
      };
      mockPrismaClient.aiUsageAlert.findMany.mockResolvedValue([alert]);
      mockPrismaClient.business.findUnique.mockResolvedValue({
        name: 'Acme',
        email: 'acme@example.com',
        ownerId: 'user-1',
      });
      mockModuleRef.get
        .mockReturnValueOnce(mockNotifications)
        .mockReturnValueOnce(mockSystemEmail);

      const result = await service.tick();

      expect(result.dispatched).toBe(1);
      expect(mockNotifications.create).toHaveBeenCalledWith(
        expect.objectContaining({
          businessId: 'biz-1',
          type: 'ai_usage.budget_threshold',
          title: 'Acme: AI credit usage at 80%',
        }),
      );
      expect(mockSystemEmail.sendTransactional).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'acme@example.com',
          subject: 'Acme: AI credit usage at 80%',
        }),
      );
      expect(mockPrismaClient.aiUsageAlert.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'alert-1' },
          data: { notified: true },
        }),
      );
    });

    it('falls back to owner email when business email is missing', async () => {
      const alert = {
        id: 'alert-2',
        businessId: 'biz-1',
        type: 'credit_depleted',
        threshold: 100,
        metadata: { used: 100, limit: 100 },
        triggeredAt: new Date(),
      };
      mockPrismaClient.aiUsageAlert.findMany.mockResolvedValue([alert]);
      mockPrismaClient.business.findUnique.mockResolvedValue({
        name: 'Acme',
        email: null,
        ownerId: 'user-1',
      });
      mockPrismaClient.user.findUnique.mockResolvedValue({ email: 'owner@example.com' });
      mockModuleRef.get
        .mockReturnValueOnce(mockNotifications)
        .mockReturnValueOnce(mockSystemEmail);

      await service.tick();

      expect(mockSystemEmail.sendTransactional).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'owner@example.com',
        }),
      );
    });

    it('skips email when SystemEmailService is unavailable', async () => {
      const alert = {
        id: 'alert-3',
        businessId: 'biz-1',
        type: 'budget_threshold',
        threshold: 50,
        metadata: { used: 50, limit: 100, pct: 50 },
        triggeredAt: new Date(),
      };
      mockPrismaClient.aiUsageAlert.findMany.mockResolvedValue([alert]);
      mockPrismaClient.business.findUnique.mockResolvedValue({
        name: 'Acme',
        email: 'acme@example.com',
        ownerId: 'user-1',
      });
      mockModuleRef.get
        .mockReturnValueOnce(mockNotifications)
        .mockReturnValueOnce(undefined);

      await service.tick();

      expect(mockNotifications.create).toHaveBeenCalled();
      expect(mockSystemEmail.sendTransactional).not.toHaveBeenCalled();
      expect(mockPrismaClient.aiUsageAlert.update).toHaveBeenCalled();
    });

    it('marks alert notified even when business is missing', async () => {
      const alert = {
        id: 'alert-4',
        businessId: 'biz-missing',
        type: 'budget_threshold',
        threshold: 80,
        metadata: {},
        triggeredAt: new Date(),
      };
      mockPrismaClient.aiUsageAlert.findMany.mockResolvedValue([alert]);
      mockPrismaClient.business.findUnique.mockResolvedValue(null);

      await service.tick();

      expect(mockNotifications.create).not.toHaveBeenCalled();
      expect(mockSystemEmail.sendTransactional).not.toHaveBeenCalled();
      expect(mockPrismaClient.aiUsageAlert.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'alert-4' },
          data: { notified: true },
        }),
      );
    });

    it('continues dispatching remaining alerts when one fails', async () => {
      const alerts = [
        {
          id: 'alert-5',
          businessId: 'biz-1',
          type: 'budget_threshold',
          threshold: 80,
          metadata: {},
          triggeredAt: new Date(),
        },
        {
          id: 'alert-6',
          businessId: 'biz-2',
          type: 'budget_threshold',
          threshold: 50,
          metadata: {},
          triggeredAt: new Date(),
        },
      ];
      mockPrismaClient.aiUsageAlert.findMany.mockResolvedValue(alerts);
      mockPrismaClient.business.findUnique
        .mockRejectedValueOnce(new Error('db error'))
        .mockResolvedValueOnce({
          name: 'Beta',
          email: 'beta@example.com',
          ownerId: 'user-2',
        });
      mockModuleRef.get
        .mockReturnValueOnce(mockNotifications)
        .mockReturnValueOnce(mockSystemEmail);

      const result = await service.tick();

      expect(result.dispatched).toBe(1);
      expect(mockPrismaClient.aiUsageAlert.update).toHaveBeenCalledTimes(1);
    });
  });

  describe('buildAlertContent', () => {
    it('builds depleted alert content', () => {
      const content = (service as any).buildAlertContent(
        { type: 'credit_depleted', threshold: 100, metadata: { used: 100, limit: 100 } },
        'Acme',
      );
      expect(content.title).toBe('Acme: AI credits depleted');
      expect(content.body).toContain('100 of 100 AI credits');
    });

    it('builds threshold alert content', () => {
      const content = (service as any).buildAlertContent(
        { type: 'budget_threshold', threshold: 80, metadata: { used: 80, limit: 100, pct: 80 } },
        'Acme',
      );
      expect(content.title).toBe('Acme: AI credit usage at 80%');
      expect(content.body).toContain('80 of 100 AI credits');
    });

    it('builds generic alert content for unknown types', () => {
      const content = (service as any).buildAlertContent(
        { type: 'unknown', threshold: null, metadata: {} },
        'Acme',
      );
      expect(content.title).toBe('Acme: AI usage alert');
    });
  });
});
