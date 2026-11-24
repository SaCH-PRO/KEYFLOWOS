/**
 * FU-KEY-GENOME-READS-RESIDUAL (D-235; D-233, D-234) round 9 (correctness MINOR-1): the stream's V3 prompt ran the
 * recommendation ranker (and wrote its memory event) on every turn of a reader without revenue read, to read with
 * headroom. The headroom now comes from a ranked pool the bridge reads once into the cached genome context (as round 8
 * did for signals): the context's recommendations are the pool's first ten, as before, and a reader without revenue read
 * is projected from the pool, then limited to ten; the pool is never handed on. The stream reads no ranking per turn.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { KeyCortexGenomeBridgeService } from '../key-cortex-genome-bridge.service';
import { KeyCortexGenomeContextService } from '../key-cortex-genome-context.service';
import { genomeContextForReader } from '../genome-context-for-reader';

const fin = (i: number) => ({ id: `fin_${i}`, title: `Raise the retainer ${i}`, description: 'x', impact: 'high', category: 'FINANCIAL', confidence: 0.9, genomeScore: 90 - i });
const ops = (i: number) => ({ id: `ops_${i}`, title: `Write the SOPs ${i}`, description: 'y', impact: 'medium', category: 'OPERATIONS', confidence: 0.5, genomeScore: 50 - i });
// The business's top ten are seven finance rows and three operations rows; more operations rows rank below them.
const pool = [fin(1), fin(2), ops(1), fin(3), fin(4), fin(5), ops(2), fin(6), fin(7), ops(3), ...Array.from({ length: 12 }, (_, i) => ops(i + 4))];
const ctx = (recommendations: any[], recommendationPool?: any[]) => ({
  dnaScores: { operations: 70 }, genomeStage: 'growth', executiveReadiness: 60, signals: [], opportunities: [], autonomyMap: {}, timestamp: new Date(),
  recommendations, ...(recommendationPool ? { recommendationPool } : {}),
}) as any;

describe('ranked recommendations are projected from a pool the cached context carries (round 9, correctness MINOR-1)', () => {
  it('RED-BEFORE: a reader without revenue read is handed ten non-finance rows from the pool, and not the pool', () => {
    const out = genomeContextForReader(ctx(pool.slice(0, 10), pool), false) as any;
    expect(out.recommendations).toHaveLength(10);
    for (const r of out.recommendations) expect(r.category).toBe('OPERATIONS');
    expect(out).not.toHaveProperty('recommendationPool');
    for (const r of out.recommendations) expect(r).not.toHaveProperty('genomeScore');
  });

  it('control: a revenue reader is handed the context as it was (the top ten, in rank order)', () => {
    const c = ctx(pool.slice(0, 10), pool);
    expect(genomeContextForReader(c, true)).toBe(c);
  });

  it('RED-BEFORE: the bridge ranks the pool once; its first ten are the recommendations, as before', async () => {
    const ranked = pool.map((r, i) => ({ id: r.id, title: r.title, recommendation: r.description, domain: r.category, confidence: r.confidence, rankScore: 100 - i, riskLevel: 'LOW' }));
    const bridge = Object.create(KeyCortexGenomeBridgeService.prototype) as any;
    bridge.logger = { warn: vi.fn(), debug: vi.fn(), log: vi.fn() };
    bridge.prisma = { client: { businessGenome: { findUnique: vi.fn(async () => ({ dnaScores: {}, stage: 'growth', executiveReadiness: 60 })) } } };
    const rankRecommendations = vi.fn(async (_b: string, { limit }: { limit: number }) => ({ rankedRecommendations: ranked.slice(0, limit) }));
    bridge.rankerService = { rankRecommendations };
    bridge.signalService = { listSignals: vi.fn(async () => []) };
    bridge.loadOpportunities = vi.fn(async () => []);
    bridge.loadCrossDomainSnapshot = vi.fn(async () => null);
    bridge.loadModuleReadiness = vi.fn(async () => []);
    const intel = await bridge.getGenomeIntelligence('biz_A');
    expect(rankRecommendations).toHaveBeenCalledTimes(1);
    expect(rankRecommendations.mock.calls[0][1]).toMatchObject({ limit: 50 });
    expect(intel.recommendations.map((r: any) => r.id)).toEqual(pool.slice(0, 10).map((r) => r.id));
    expect(intel.recommendationPool.map((r: any) => r.id)).toEqual(pool.map((r) => r.id));
  });

  it('RED-BEFORE: the enriched context carries the pool, so a reader without revenue read is projected from it', async () => {
    const store = new Map<string, unknown>();
    const redis = { getJson: vi.fn(async (k: string) => store.get(k) ?? null), setJson: vi.fn(async (k: string, v: unknown) => { store.set(k, v); }) } as any;
    const bridge = { getGenomeIntelligence: vi.fn(async () => ({ dnaScores: {}, genomeStage: 'growth', executiveReadiness: 60, signals: [], opportunities: [], autonomyMap: {}, recommendations: pool.slice(0, 10), recommendationPool: pool })) } as any;
    const enriched = (await new KeyCortexGenomeContextService(redis, bridge).getGenomeEnrichedContext('biz_A')) as any;
    expect(enriched.recommendations.map((r: any) => r.id)).toEqual(pool.slice(0, 10).map((r) => r.id));
    expect(enriched.recommendationPool).toHaveLength(pool.length);
    const blind = genomeContextForReader(enriched, false) as any;
    expect(blind.recommendations.slice(0, 5).map((r: any) => r.category)).toEqual(Array(5).fill('OPERATIONS'));
  });

  it('RED-BEFORE: streamQuery reads no ranking per turn; its V3 prompt takes the projected context\'s first five', () => {
    const source = readFileSync(join(__dirname, '..', 'key-cortex-query-pipeline.service.ts'), 'utf8');
    const start = source.indexOf('async *streamQuery(');
    expect(start).toBeGreaterThan(-1);
    const end = source.indexOf('\n  }\n', start);
    const stream = source.slice(start, end);
    expect(stream).not.toMatch(/getRankedRecommendations|streamPromptRecommendations|rankedRecommendationsForReader/);
    expect(stream).toMatch(/genomeContext\.recommendations\.slice\(0, 5\)/);
    expect(source).not.toMatch(/streamPromptRecommendations/);
  });
});
