/**
 * The reflection organ runs four cycles — reflection, dream, synthesis,
 * maintenance — and exposes the most recent session to the orchestrator.
 *
 * Several capabilities are inert by construction because their tables were
 * never created. These tests pin that they stay honest: no fabricated evidence,
 * no queries against relations that do not exist.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as ts from 'typescript';
import { KeyCortexReflectionService } from './key-cortex-reflection.service';

/**
 * The class's CODE, with comments dropped (string literals kept). The class's
 * own comments name the capabilities it does not have ("needs
 * KeyCortexInsight", "validateHypothesisAgainstSource was never implemented"),
 * and whether a comment survives in toString() is up to the transform: esbuild
 * dropped them, swc and tsc (production) keep them
 * (FU-VITEST-DECORATOR-METADATA). These checks are about what the code does.
 */
function codeOf(fn: Function): string {
  return ts.transpileModule(fn.toString(), {
    compilerOptions: { removeComments: true, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}

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
      const src = codeOf(KeyCortexReflectionService.prototype.constructor);
      expect(src).toContain('getLastReflectionSession');
      // Case-insensitive, so a Prisma accessor (db.keyCortexInsight) counts too.
      expect(src.toLowerCase()).not.toContain('keycortexinsight');
    });

    it('does not fabricate evidence for hypothesis sources', async () => {
      // validateHypothesisAgainstSource was never implemented; the organ must
      // contribute no evidence rather than inventing supporting facts.
      const src = codeOf(KeyCortexReflectionService.prototype.constructor);
      expect(src).toContain('getLastReflectionSession');
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

  describe('RR-REFLECTION-HONEST: honest maintenance reporting and bounded in-process dream journal', () => {
    it('runMaintenance reports "not run: <reason>" instead of fake success and persists indicesUpdated: null, integrityChecked: false', async () => {
      const { service: svc, prisma } = makeService();
      const persistedRows: Array<{ id: string; key: string; userId: null; value: string; createdAt: Date; businessId: string; type: string }> = [];
      (prisma.client as Record<string, unknown>).keyCortexMemory = {
        create: vi.fn().mockImplementation(async ({ data }: { data: { businessId: string; type: string; key: string; value: string } }) => {
          const row = { id: `mem_${persistedRows.length}`, userId: null, createdAt: new Date(), ...data };
          persistedRows.push(row);
          return row;
        }),
        findFirst: vi.fn().mockImplementation(async ({ where }: { where: { businessId: string; type: string } }) => {
          return [...persistedRows].reverse().find((r) => r.businessId === where.businessId && r.type === where.type) ?? null;
        }),
      };

      const session = await svc.runMaintenance('biz_honest');

      expect(session.type).toBe('maintenance');
      expect(session.actionsTaken.some((a) => /updated\s+\d+\s+temporal memory indices/i.test(a))).toBe(false);
      expect(session.actionsTaken.some((a) => /data integrity check passed/i.test(a))).toBe(false);

      expect(session.actionsTaken.some((a) => /temporal.*not run:/i.test(a))).toBe(true);
      expect(session.actionsTaken.some((a) => /integrity.*not run:/i.test(a))).toBe(true);

      expect(session.metadata?.indicesUpdated).toBeNull();
      expect(session.metadata?.integrityChecked).toBe(false);
      expect(session.metadata?.integrityIssuesFound).toBeNull();

      // Persisted record + getLastReflectionSession serve the same honest record to consciousness layer
      expect(persistedRows).toHaveLength(1);
      const last = await svc.getLastReflectionSession('biz_honest');
      expect(last?.actionsTaken).toEqual(session.actionsTaken);
      expect(last?.metadata?.indicesUpdated).toBeNull();
      expect(last?.metadata?.integrityChecked).toBe(false);
    });

    it('caps in-process dreamJournal per business (evicting oldest), preserves tenant isolation, and marks entries persisted: false with zero new memory writes', async () => {
      const { service: svc, prisma } = makeService();
      const upsertSpy = vi.fn();
      const createSpy = vi.fn();
      (prisma.client as Record<string, unknown>).keyCortexMemory = {
        upsert: upsertSpy,
        create: createSpy,
        findMany: vi.fn().mockResolvedValue([]),
      };

      const store = (
        svc as unknown as {
          storeDreamHypotheses: (businessId: string, hypotheses: Array<Record<string, unknown>>, parentId: string) => Promise<void>;
        }
      ).storeDreamHypotheses.bind(svc);

      const batchSize = 150;
      const baseTime = Date.UTC(2026, 10, 1, 0, 0, 0);
      const batchA = Array.from({ length: batchSize }, (_, i) => ({
        id: `hyp_a_${i}`,
        description: `Hypothesis A #${i}`,
        sources: ['src'],
        confidence: 0.2,
        creativityScore: 0.5,
        status: 'pending',
        businessId: 'biz_a',
        createdAt: new Date(baseTime + i * 1000),
      }));
      await store('biz_a', batchA, 'dream_1');
      await store(
        'biz_b',
        [
          {
            id: 'hyp_b_0',
            description: 'Hypothesis B #0',
            sources: ['src'],
            confidence: 0.2,
            creativityScore: 0.5,
            status: 'pending',
            businessId: 'biz_b',
            createdAt: new Date(baseTime),
          },
        ],
        'dream_b',
      );

      const journalA = await svc.getDreamJournal('biz_a');
      expect(journalA.length).toBeLessThanOrEqual(100);
      expect(journalA.length).toBeGreaterThan(0);
      // Oldest dropped, newest retained
      expect(journalA.some((h) => h.id === 'hyp_a_0')).toBe(false);
      expect(journalA.some((h) => h.id === `hyp_a_${batchSize - 1}`)).toBe(true);
      // Every in-process dream journal entry is explicitly marked persisted: false
      for (const entry of journalA) {
        expect(entry.persisted).toBe(false);
      }

      // Per-business isolation: biz_b untouched and marked persisted: false
      const journalB = await svc.getDreamJournal('biz_b');
      expect(journalB).toHaveLength(1);
      expect(journalB[0].id).toBe('hyp_b_0');
      expect(journalB[0].persisted).toBe(false);

      // D-257: zero new KeyCortexMemory writes added by storing dream hypotheses
      expect(upsertSpy).not.toHaveBeenCalled();
      expect(createSpy).not.toHaveBeenCalled();
    });
  });
});
