import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CognitionSessionService } from './cognition-session.service';

const mockPrismaClient = {
  cognitionSession: {
    create: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
  },
};

const mockPrisma = {
  client: mockPrismaClient,
} as any;

describe('CognitionSessionService', () => {
  let service: CognitionSessionService;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetAllMocks();
    service = new CognitionSessionService(mockPrisma);
  });

  describe('createSession', () => {
    it('creates a session with default snapshot and metadata', async () => {
      mockPrismaClient.cognitionSession.create.mockResolvedValue({
        id: 'session-1',
        businessId: 'biz-1',
        sessionId: 'ext-1',
        status: 'active',
      });

      const result = await service.createSession({ businessId: 'biz-1', sessionId: 'ext-1' });

      expect(result).toMatchObject({ id: 'session-1', businessId: 'biz-1', sessionId: 'ext-1', status: 'active' });
      expect(mockPrismaClient.cognitionSession.create).toHaveBeenCalledWith({
        data: {
          businessId: 'biz-1',
          sessionId: 'ext-1',
          userId: null,
          contextSnapshot: {},
          metadata: {},
        },
      });
    });

    it('creates a session with optional fields', async () => {
      mockPrismaClient.cognitionSession.create.mockResolvedValue({ id: 'session-2' });

      await service.createSession({
        businessId: 'biz-1',
        sessionId: 'ext-2',
        userId: 'user-1',
        contextSnapshot: { key: 'value' },
        metadata: { source: 'test' },
      });

      expect(mockPrismaClient.cognitionSession.create).toHaveBeenCalledWith({
        data: {
          businessId: 'biz-1',
          sessionId: 'ext-2',
          userId: 'user-1',
          contextSnapshot: { key: 'value' },
          metadata: { source: 'test' },
        },
      });
    });
  });

  describe('getSession', () => {
    it('finds a session by business and external session id', async () => {
      mockPrismaClient.cognitionSession.findFirst.mockResolvedValue({ id: 'session-1' });

      const result = await service.getSession('biz-1', 'ext-1');

      expect(result).toEqual({ id: 'session-1' });
      expect(mockPrismaClient.cognitionSession.findFirst).toHaveBeenCalledWith({
        where: { businessId: 'biz-1', sessionId: 'ext-1' },
      });
    });

    it('returns null when session is not found', async () => {
      mockPrismaClient.cognitionSession.findFirst.mockResolvedValue(null);

      const result = await service.getSession('biz-1', 'missing');

      expect(result).toBeNull();
    });
  });

  describe('updateSession', () => {
    it('updates session fields by business and session id', async () => {
      mockPrismaClient.cognitionSession.findFirst.mockResolvedValue({ id: 'session-1' });
      mockPrismaClient.cognitionSession.update.mockResolvedValue({
        id: 'session-1',
        status: 'paused',
        contextSnapshot: { updated: true },
      });

      const result = await service.updateSession('biz-1', 'ext-1', {
        status: 'paused',
        contextSnapshot: { updated: true },
      });

      expect(result).toMatchObject({ id: 'session-1', status: 'paused', contextSnapshot: { updated: true } });
      expect(mockPrismaClient.cognitionSession.update).toHaveBeenCalledWith({
        where: { id: 'session-1' },
        data: {
          status: 'paused',
          contextSnapshot: { updated: true },
        },
      });
    });

    it('throws when session does not exist', async () => {
      mockPrismaClient.cognitionSession.findFirst.mockResolvedValue(null);

      await expect(
        service.updateSession('biz-1', 'missing', { status: 'completed' }),
      ).rejects.toThrow('CognitionSession not found');
    });
  });

  describe('completeSession', () => {
    it('sets status to completed', async () => {
      mockPrismaClient.cognitionSession.findFirst.mockResolvedValue({ id: 'session-1' });
      mockPrismaClient.cognitionSession.update.mockResolvedValue({
        id: 'session-1',
        status: 'completed',
      });

      const result = await service.completeSession('biz-1', 'ext-1');

      expect(result.status).toBe('completed');
      expect(mockPrismaClient.cognitionSession.update).toHaveBeenCalledWith({
        where: { id: 'session-1' },
        data: { status: 'completed' },
      });
    });
  });
});
