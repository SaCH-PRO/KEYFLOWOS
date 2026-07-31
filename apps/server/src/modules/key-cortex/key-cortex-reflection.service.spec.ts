/**
 * The reflection organ runs four cycles — reflection, dream, synthesis,
 * maintenance — and exposes the most recent session to the orchestrator.
 *
 * Several capabilities are inert by construction because their tables were
 * never created. These tests pin that they stay honest: no fabricated evidence,
 * no queries against relations that do not exist.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { KeyCortexReflectionService } from './key-cortex-reflection.service';

function makeService() {
  const model = () => ({
    findMany: vi.fn().mockResolvedValue([]),
    findFirst: vi.fn().mockResolvedValue(null),
    count: vi.fn().mockResolvedValue(0),
  });
  const prisma = {
    client: {
      businessEvent: model(),
      business: model(),
      invoice: model(),
      booking: model(),
      contact: model(),
      payment: model(),
      $queryRaw: vi.fn().mockResolvedValue([]),
    },
  };
  const eventService = {
    getEvents: vi.fn().mockResolvedValue([]),
    logDecision: vi.fn().mockResolvedValue({ id: 'e1' }),
    logInsight: vi.fn().mockResolvedValue({ id: 'e2' }),
  };
  const insightService = { generateRecommendations: vi.fn().mockResolvedValue([]) };
  const genomeBridge = {
    getGenomeIntelligence: vi.fn().mockResolvedValue({ stage: 'seed' }),
    updateDnaScore: vi.fn().mockResolvedValue(undefined),
    getRankedRecommendations: vi.fn().mockResolvedValue([]),
  };
  const modelGateway = { complete: vi.fn().mockResolvedValue({ content: '[]' }) };
  const aiUsage = { trackAndComplete: vi.fn().mockResolvedValue({ content: '[]' }) };
  const service = new KeyCortexReflectionService(
    prisma as never,
    eventService as never,
    insightService as never,
    genomeBridge as never,
    modelGateway as never,
    aiUsage as never,
  );
  return { service, prisma, eventService };
}

describe('KeyCortexReflectionService', () => {
  let service: KeyCortexReflectionService;

  beforeEach(() => {
    service = makeService().service;
  });

  describe('reflect() dispatcher', () => {
    // The peripheral surface addresses this organ by intent, not by internal
    // method name. Each type must reach its own cycle.
    const types = ['reflection', 'dream', 'synthesis', 'maintenance'];

    for (const type of types) {
      it(`"${type}" runs a cycle and returns a session`, async () => {
        const session = await service.reflect('biz_1', type);
        expect(session).toBeDefined();
        expect(session.id).toBeTruthy();
      });
    }

    it('an unknown type falls back to the standard reflection cycle', async () => {
      const session = await service.reflect('biz_1', 'not-a-real-type');
      expect(session).toBeDefined();
    });
  });

  describe('getLastReflectionSession', () => {
    it('returns null before any cycle has run in this process', async () => {
      const last = await service.getLastReflectionSession('biz_never_run');
      expect(last).toBeNull();
    });

    it('returns the session that reflect() just produced', async () => {
      const produced = await service.reflect('biz_1', 'reflection');
      const last = await service.getLastReflectionSession('biz_1');
      expect(last?.id).toBe(produced.id);
    });

    it('keeps sessions separate per business', async () => {
      await service.reflect('biz_a', 'reflection');
      expect(await service.getLastReflectionSession('biz_b')).toBeNull();
    });
  });

  describe('honesty about missing capability', () => {
    it('never queries KeyCortexInsight — no such table exists', () => {
      const src = KeyCortexReflectionService.prototype.constructor.toString();
      expect(src).not.toContain('KeyCortexInsight');
    });

    it('does not fabricate evidence for hypothesis sources', async () => {
      // validateHypothesisAgainstSource was never implemented; the organ must
      // contribute no evidence rather than inventing supporting facts.
      const src = KeyCortexReflectionService.prototype.constructor.toString();
      expect(src).not.toContain('validateHypothesisAgainstSource');
    });
  });

  describe('resilience', () => {
    it('survives a total database failure', async () => {
      const failing = {
        findMany: vi.fn().mockRejectedValue(new Error('db down')),
        findFirst: vi.fn().mockRejectedValue(new Error('db down')),
        count: vi.fn().mockRejectedValue(new Error('db down')),
      };
      const prisma = {
        client: {
          businessEvent: failing,
          business: failing,
          invoice: failing,
          booking: failing,
          contact: failing,
          payment: failing,
          $queryRaw: vi.fn().mockRejectedValue(new Error('db down')),
        },
      };
      const svc = new KeyCortexReflectionService(
        prisma as never,
        { getEvents: vi.fn().mockRejectedValue(new Error('x')), logDecision: vi.fn(), logInsight: vi.fn() } as never,
        { generateRecommendations: vi.fn().mockRejectedValue(new Error('x')) } as never,
        { getGenomeIntelligence: vi.fn().mockRejectedValue(new Error('x')), updateDnaScore: vi.fn(), getRankedRecommendations: vi.fn().mockResolvedValue([]) } as never,
        { complete: vi.fn().mockRejectedValue(new Error('x')) } as never,
        { trackAndComplete: vi.fn().mockRejectedValue(new Error('x')) } as never,
      );
      await expect(svc.reflect('biz_1', 'reflection')).resolves.toBeDefined();
    });
  });
});
