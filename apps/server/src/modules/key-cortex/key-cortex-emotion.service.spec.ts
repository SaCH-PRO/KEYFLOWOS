/**
 * The emotion organ detects a user's emotional state from their message, their
 * session history and business stress signals.
 *
 * Mocks here mirror the REAL service contracts — PrismaService.client and
 * AiUsageService.trackAndComplete — not structural stand-ins. Mocking shapes
 * nothing implements is what let the earlier port look healthy while being
 * unable to run.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { KeyCortexEmotionService } from './key-cortex-emotion.service';

function makeService(opts: { sessions?: Array<{ messages: unknown }>; aiContent?: string } = {}) {
  const findMany = vi.fn().mockResolvedValue(opts.sessions ?? []);
  const prisma = { client: { cortexSession: { findMany } } };
  const trackAndComplete = vi.fn().mockResolvedValue({
    content: opts.aiContent ?? '{"emotion":"calm","intensity":0.3,"confidence":0.6}',
  });
  const aiUsage = { trackAndComplete };
  const service = new KeyCortexEmotionService(prisma as never, aiUsage as never);
  return { service, findMany, trackAndComplete };
}

describe('KeyCortexEmotionService', () => {
  let service: KeyCortexEmotionService;

  beforeEach(() => {
    service = makeService().service;
  });

  describe('detectEmotion', () => {
    it('returns a structured emotional state', async () => {
      const state = await service.detectEmotion('biz_1', 'user_1', 'the invoices are late again', []);
      expect(state).toBeDefined();
      expect(typeof state.primary).toBe('string');
      expect(state.intensity).toBeGreaterThanOrEqual(0);
      expect(state.intensity).toBeLessThanOrEqual(1);
    });

    it('routes the AI call through AiUsageService so usage is tracked', async () => {
      const { service: svc, trackAndComplete } = makeService();
      await svc.detectEmotion('biz_1', 'user_1', 'this is completely unacceptable', []);
      expect(trackAndComplete).toHaveBeenCalled();
      const [businessId, userId, feature] = trackAndComplete.mock.calls[0];
      expect(businessId).toBe('biz_1');
      expect(userId).toBe('user_1');
      expect(feature).toBe('emotion_detection');
    });

    it('degrades to a neutral state when the AI call fails, rather than throwing', async () => {
      const prisma = { client: { cortexSession: { findMany: vi.fn().mockResolvedValue([]) } } };
      const aiUsage = { trackAndComplete: vi.fn().mockRejectedValue(new Error('gateway down')) };
      const svc = new KeyCortexEmotionService(prisma as never, aiUsage as never);
      const state = await svc.detectEmotion('biz_1', 'user_1', 'anything', []);
      expect(state).toBeDefined();
      expect(state.intensity).toBeGreaterThanOrEqual(0);
    });

    it('distinguishes distressed from neutral text', async () => {
      const calm = await service.detectEmotion('biz_1', 'user_1', 'thanks, all good here', []);
      const upset = await service.detectEmotion(
        'biz_1',
        'user_1',
        'this is broken, useless and I am completely fed up',
        [],
      );
      // The organ must respond to content, not return a constant.
      expect(JSON.stringify(calm)).not.toBe(JSON.stringify(upset));
    });
  });

  describe('session history', () => {
    it('reads messages from CortexSession.messages — there is no CortexMessage table', async () => {
      const { service: svc, findMany } = makeService({
        sessions: [{ messages: [{ metadata: { stressIndicator: true } }] }],
      });
      await svc.detectEmotion('biz_1', 'user_1', 'checking in', []);
      expect(findMany).toHaveBeenCalled();
      const arg = findMany.mock.calls[0][0];
      expect(arg.select).toEqual({ messages: true });
    });

    it('tolerates sessions whose messages Json is not an array', async () => {
      const { service: svc } = makeService({
        sessions: [{ messages: null }, { messages: 'not-an-array' }, { messages: [] }],
      });
      const state = await svc.detectEmotion('biz_1', 'user_1', 'hello', []);
      expect(state).toBeDefined();
    });

    it('survives a database failure without throwing', async () => {
      const prisma = {
        client: { cortexSession: { findMany: vi.fn().mockRejectedValue(new Error('db down')) } },
      };
      const aiUsage = {
        trackAndComplete: vi.fn().mockResolvedValue({ content: '{"emotion":"calm"}' }),
      };
      const svc = new KeyCortexEmotionService(prisma as never, aiUsage as never);
      const state = await svc.detectEmotion('biz_1', 'user_1', 'hello', []);
      expect(state).toBeDefined();
    });
  });

  describe('getEmotionalBaseline', () => {
    it('returns a baseline state for a user', async () => {
      const baseline = await service.getEmotionalBaseline('user_1');
      expect(baseline).toBeDefined();
      expect(typeof baseline.primary).toBe('string');
    });
  });
});
