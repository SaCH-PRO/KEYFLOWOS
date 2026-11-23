/**
 * FU-KEY-GENOME-READS-RESIDUAL (D-235; D-233, D-234) round 8.
 * Security MINOR-1: the genome signals a reader without revenue read is handed (the chat answer's urgent signals, the
 * stream's alert thought, the V3 prompt's urgent block, the suggestion fallback) were what was left of the business's
 * newest twenty, so the shortfall told how many recent signals were finance or sales. The bridge now loads a pool of the
 * newest signals once (the first twenty are `signals`, as before), and a reader without revenue read is projected from
 * the pool, then limited to twenty; the pool itself is never handed on.
 * Correctness MINOR-1: the awareness read bound is pinned on the default (fail-closed) path too.
 */
import { describe, it, expect, vi } from 'vitest';
import { KeyCortexGenomeBridgeService } from '../key-cortex-genome-bridge.service';
import { KeyCortexGenomeContextService } from '../key-cortex-genome-context.service';
import { KeyCortexAwarenessService } from '../key-cortex-awareness.service';
import { genomeContextForReader } from '../genome-context-for-reader';

const finSig = (i: number) => ({ id: `sf_${i}`, type: 'revenue_drop', message: `Revenue fell ${i}%`, module: 'finance', section: 'finance', domain: 'FINANCIAL', severity: 'high', createdAt: new Date() });
const opsSig = (i: number) => ({ id: `so_${i}`, type: 'delivery_delay', message: `Delivery ${i} late`, module: 'operations', section: 'operations', domain: 'OPERATIONS', severity: 'high', createdAt: new Date() });
// The newest 15 signals are finance; 30 operations signals follow.
const pool = [...Array.from({ length: 15 }, (_, i) => finSig(i)), ...Array.from({ length: 30 }, (_, i) => opsSig(i))];
const ctx = (signals: any[], signalPool?: any[]) => ({
  dnaScores: { operations: 70 }, genomeStage: 'growth', executiveReadiness: 60, recommendations: [], opportunities: [], autonomyMap: {}, timestamp: new Date(),
  signals, ...(signalPool ? { signalPool } : {}),
}) as any;

describe('genome signals are projected from a pool, not from what is left of the newest twenty (round 8, security MINOR-1)', () => {
  it('RED-BEFORE: a reader without revenue read is handed twenty non-finance signals, and not the pool', () => {
    const out = genomeContextForReader(ctx(pool.slice(0, 20), pool), false) as any;
    expect(out.signals).toHaveLength(20);
    expect(out.signals.map((s: any) => s.id)).toEqual(Array.from({ length: 20 }, (_, i) => `so_${i}`));
    expect(out).not.toHaveProperty('signalPool');
  });

  it('control: a revenue reader is handed the context as it was (the newest twenty signals)', () => {
    const c = ctx(pool.slice(0, 20), pool);
    expect(genomeContextForReader(c, true)).toBe(c);
  });

  it('control: a context with no pool (an older shape) is still projected from its signals', () => {
    const out = genomeContextForReader(ctx(pool.slice(0, 20)), false) as any;
    expect(out.signals.map((s: any) => s.id)).toEqual(['so_0', 'so_1', 'so_2', 'so_3', 'so_4']);
  });

  it('RED-BEFORE: the bridge loads the pool once; its first twenty are the signals, as before', async () => {
    const bridge = Object.create(KeyCortexGenomeBridgeService.prototype) as any;
    bridge.logger = { warn: vi.fn(), debug: vi.fn(), log: vi.fn() };
    bridge.prisma = { client: { businessGenome: { findUnique: vi.fn(async () => ({ dnaScores: {}, stage: 'growth', executiveReadiness: 60 })) } } };
    const listSignals = vi.fn(async (_b: string, { limit }: { limit: number }) => pool.slice(0, limit));
    bridge.signalService = { listSignals };
    bridge.loadRankedRecommendations = vi.fn(async () => []);
    bridge.loadOpportunities = vi.fn(async () => []);
    bridge.loadCrossDomainSnapshot = vi.fn(async () => null);
    bridge.loadModuleReadiness = vi.fn(async () => []);
    const intel = await bridge.getGenomeIntelligence('biz_A');
    expect(listSignals).toHaveBeenCalledTimes(1);
    expect(listSignals.mock.calls[0][1]).toMatchObject({ status: 'NEW', limit: 100 });
    expect(intel.signals).toHaveLength(20);
    expect(intel.signals.map((s: any) => s.id)).toEqual(pool.slice(0, 20).map((s) => s.id));
    expect(intel.signalPool.map((s: any) => s.id)).toEqual(pool.map((s) => s.id));
  });

  it('RED-BEFORE: the enriched context carries the pool, under a cache key no entry without a pool was stored under', async () => {
    const store = new Map<string, unknown>();
    const redis = { getJson: vi.fn(async (k: string) => store.get(k) ?? null), setJson: vi.fn(async (k: string, v: unknown) => { store.set(k, v); }) } as any;
    const toBridge = (s: any) => ({ ...s, createdAt: s.createdAt.toISOString() });
    const bridge = { getGenomeIntelligence: vi.fn(async () => ({ dnaScores: {}, genomeStage: 'growth', executiveReadiness: 60, recommendations: [], opportunities: [], autonomyMap: {}, signals: pool.slice(0, 20).map(toBridge), signalPool: pool.map(toBridge) })) } as any;
    const svc = new KeyCortexGenomeContextService(redis, bridge);
    // An entry stored by the code before round 8, without a pool.
    store.set('genome:context:v2:biz_A', ctx(pool.slice(0, 20)));
    const enriched = (await svc.getGenomeEnrichedContext('biz_A')) as any;
    expect(enriched.signals).toHaveLength(20);
    expect(enriched.signalPool).toHaveLength(45);
    const blind = genomeContextForReader(enriched, false) as any;
    expect(blind.signals.map((s: any) => s.id)).toEqual(Array.from({ length: 20 }, (_, i) => `so_${i}`));
  });
});

describe('the awareness read is bounded on the default path too (round 8, correctness MINOR-1)', () => {
  it('a reader without revenue read, and no reader, read at most 100 rows of a kind and are served at most 25', async () => {
    const rows = Array.from({ length: 500 }, (_, i) => ({ key: `c_${i}`, value: JSON.stringify({ headline: `Delivery ${i} slipped` }), confidence: 0.8, createdAt: new Date(Date.UTC(2026, 10, 22) - i * 60_000) }));
    for (const opts of [{ readsRevenue: false }, {}]) {
      const svc = Object.create(KeyCortexAwarenessService.prototype) as any;
      svc.logger = { log: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };
      const findMany = vi.fn(async ({ take }: any) => rows.slice(0, take ?? rows.length));
      svc.prisma = { client: { keyCortexMemory: { findMany } } };
      const out = await svc.getAwareness('biz_A', opts);
      for (const call of findMany.mock.calls) {
        expect(call[0].take, JSON.stringify(opts)).toBeGreaterThan(0);
        expect(call[0].take, JSON.stringify(opts)).toBeLessThanOrEqual(100);
      }
      for (const kind of Object.keys(out.counts)) expect(out.counts[kind], kind).toBeLessThanOrEqual(25);
    }
  });
});
