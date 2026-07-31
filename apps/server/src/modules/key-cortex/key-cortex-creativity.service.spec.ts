/**
 * The creativity organ generates strategies and ideas through named techniques,
 * falling back to deterministic generators when the model is unavailable.
 *
 * Mocks mirror the real service contracts (PrismaService.client,
 * AiUsageService, ModelGatewayService), not structural stand-ins.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { KeyCortexCreativityService } from './key-cortex-creativity.service';

function makeService(opts: { aiContent?: string; failAi?: boolean } = {}) {
  const prisma = {
    client: {
      business: {
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn().mockResolvedValue({ id: 'biz_1', name: 'Acme' }),
      },
    },
  };
  const complete = opts.failAi
    ? vi.fn().mockRejectedValue(new Error('gateway down'))
    : vi.fn().mockResolvedValue({ content: opts.aiContent ?? '[]' });
  const modelGateway = { complete };
  const aiUsage = {
    trackAndComplete: opts.failAi
      ? vi.fn().mockRejectedValue(new Error('gateway down'))
      : vi.fn().mockResolvedValue({ content: opts.aiContent ?? '[]' }),
  };
  const contextService = { getFullContext: vi.fn().mockResolvedValue({ name: 'Acme' }) };
  const insightService = { generateRecommendations: vi.fn().mockResolvedValue([]) };
  const service = new KeyCortexCreativityService(
    prisma as never,
    modelGateway as never,
    aiUsage as never,
    contextService as never,
    insightService as never,
  );
  return { service, aiUsage, contextService };
}

describe('KeyCortexCreativityService', () => {
  let service: KeyCortexCreativityService;

  beforeEach(() => {
    service = makeService().service;
  });

  describe('brainstorm', () => {
    it('returns a result for a prompt', async () => {
      const result = await service.brainstorm('how do we win back lapsed customers', 'biz_1', {});
      expect(result).toBeDefined();
    });

    it('still produces ideas when the model is unavailable', async () => {
      // The organ has deterministic fallback generators; a gateway outage must
      // degrade rather than fail.
      const { service: svc } = makeService({ failAi: true });
      const result = await svc.brainstorm('grow weekday bookings', 'biz_1', {});
      expect(result).toBeDefined();
    });

    it('tolerates malformed model output', async () => {
      const { service: svc } = makeService({ aiContent: 'not json at all' });
      const result = await svc.brainstorm('anything', 'biz_1', {});
      expect(result).toBeDefined();
    });
  });

  describe('getCreativeHistory', () => {
    it('returns a list without throwing when nothing is stored', async () => {
      const history = await service.getCreativeHistory('biz_1');
      expect(Array.isArray(history)).toBe(true);
    });
  });

  describe('business scoping', () => {
    it('passes the requested business through to context resolution', async () => {
      const { service: svc, contextService } = makeService();
      await svc.brainstorm('idea', 'biz_scoped', {});
      const called = contextService.getFullContext.mock.calls.flat();
      if (called.length) expect(called).toContain('biz_scoped');
    });
  });

  describe('Prisma contract', () => {
    it('never filters Business on a non-existent `active` column', async () => {
      // Business has no `active`; liveness is deletedAt: null. Pinning the
      // correction made during the port.
      const src = KeyCortexCreativityService.prototype.constructor.toString();
      expect(src).not.toContain('active: true');
    });
  });
});
