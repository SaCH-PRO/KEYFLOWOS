/**
 * FU-KEY-GENOME-READS-RESIDUAL (D-235; D-233, D-234) round 6 (security MINOR-1, MINOR-2): the same "counted after the
 * limit" inference round 4 closed for processQuery's ranked recommendations, on two more paths. The stream's V3 prompt
 * takes the reader's projection of the business's money-weighted top ten, and GET cortex/awareness projects what is
 * left of the newest 25 rows of a kind: in both, how many rows a reader without revenue read is handed tells how many of
 * the top rows were withheld. Both now read with headroom for that reader; a revenue reader is read as before.
 */
import { describe, it, expect, vi } from 'vitest';
import { KeyCortexQueryPipelineService } from '../key-cortex-query-pipeline.service';
import { KeyCortexAwarenessService } from '../key-cortex-awareness.service';

const fin = (i: number) => ({ id: `fin_${i}`, title: `Raise the retainer ${i}`, description: 'x', impact: 'high', category: 'FINANCIAL', confidence: 0.9 });
const ops = (i: number) => ({ id: `ops_${i}`, title: `Write the SOPs ${i}`, description: 'y', impact: 'medium', category: 'OPERATIONS', confidence: 0.5 });

describe('streamQuery: the V3 prompt\'s ranked recommendations are read for the reader (round 6, security MINOR-1)', () => {
  function pipeline(ranked: any[]) {
    const svc = Object.create(KeyCortexQueryPipelineService.prototype) as any;
    svc.logger = { log: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };
    svc.genomeContextService = { getRankedRecommendations: vi.fn(async (_b: string, limit = 5) => ranked.slice(0, limit)) };
    return svc;
  }
  // The business's top ten (as the enriched context holds them) are seven finance rows and three operations rows; more
  // operations rows rank below them.
  const ranked = [fin(1), fin(2), ops(1), fin(3), fin(4), fin(5), ops(2), fin(6), fin(7), ops(3), ops(4), ops(5), ops(6)];
  const projectedTopTen = [ops(1), ops(2), ops(3)];

  it('RED-BEFORE: a reader without revenue read is handed five non-finance rows, not what is left of the top ten', async () => {
    const svc = pipeline(ranked);
    const out = await svc.streamPromptRecommendations('biz_A', { recommendations: projectedTopTen }, false);
    expect(out.map((r: any) => r.id)).toEqual(['ops_1', 'ops_2', 'ops_3', 'ops_4', 'ops_5']);
    expect(svc.genomeContextService.getRankedRecommendations).toHaveBeenCalledWith('biz_A', 50);
  });

  it('RED-BEFORE: when the ranked read fails, a reader without revenue read is handed none (fails closed), not the top-ten remainder', async () => {
    const svc = pipeline(ranked);
    svc.genomeContextService.getRankedRecommendations = vi.fn(async () => { throw new Error('bridge down'); });
    expect(await svc.streamPromptRecommendations('biz_A', { recommendations: projectedTopTen }, false)).toEqual([]);
  });

  it('control: a revenue reader is handed the first five of the genome context, as before, with no extra read', async () => {
    const svc = pipeline(ranked);
    const context = { recommendations: ranked.slice(0, 10) };
    expect(await svc.streamPromptRecommendations('biz_A', context, true)).toEqual(ranked.slice(0, 5));
    expect(svc.genomeContextService.getRankedRecommendations).not.toHaveBeenCalled();
  });
});

describe('GET cortex/awareness reads with headroom for a reader without revenue read (round 6, security MINOR-2)', () => {
  const at = (i: number) => new Date(Date.UTC(2026, 10, 22, 12, 0, 0) - i * 60_000);
  // The 40 newest concerns: the newest seven state money, the rest do not.
  const rows = Array.from({ length: 40 }, (_, i) => ({
    key: `c_${i}`,
    value: JSON.stringify(i < 7 ? { headline: `Invoice ${i} for $4,000 is overdue` } : { headline: `Delivery ${i} slipped a day` }),
    confidence: 0.8,
    createdAt: at(i),
  }));
  function awareness() {
    const svc = Object.create(KeyCortexAwarenessService.prototype) as any;
    svc.logger = { log: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };
    const findMany = vi.fn(async ({ take }: any) => rows.slice(0, take));
    svc.prisma = { client: { keyCortexMemory: { findMany } } };
    return { svc, findMany };
  }

  it('RED-BEFORE: a reader without revenue read is served 25 money-free concerns, and the count is of those, not of what is left of the newest 25', async () => {
    const { svc, findMany } = awareness();
    const out = await svc.getAwareness('biz_A', { kinds: ['concern'], readsRevenue: false });
    expect(out.items).toHaveLength(25);
    expect(out.counts.concern).toBe(25);
    expect(out.items.map((i: any) => i.id)).toEqual(Array.from({ length: 25 }, (_, i) => `c_${i + 7}`));
    expect(findMany.mock.calls[0][0].take).toBeGreaterThan(25);
  });

  it('control: a revenue reader is read and counted as before (the newest 25)', async () => {
    const { svc, findMany } = awareness();
    const out = await svc.getAwareness('biz_A', { kinds: ['concern'], readsRevenue: true });
    expect(findMany.mock.calls[0][0].take).toBe(25);
    expect(out.items).toHaveLength(25);
    expect(out.counts.concern).toBe(25);
    expect(out.items[0].id).toBe('c_0');
  });
});

describe('streamQuery: the opening thought counts nothing for a reader without revenue read (round 7, security MINOR-1)', () => {
  const svc = Object.create(KeyCortexQueryPipelineService.prototype) as any;
  // The reader's projection of the business's top ten recommendations and newest twenty signals.
  const projected = { signals: [{ id: 's1' }, { id: 's2' }], recommendations: [ops(1), ops(2), ops(3)] };

  it('RED-BEFORE: a reader without revenue read is not told how many signals and recommendations survived the projection', () => {
    const thought: string = svc.genomeStreamThought(undefined, projected, false);
    expect(thought).not.toMatch(/\d/);
    expect(thought).toContain('genome-aware context');
    expect(thought).not.toContain('undefined');
  });

  it('control: a revenue reader is told the counts and the stage, as before', () => {
    expect(svc.genomeStreamThought('growth', projected, true)).toBe('Analyzing genome-aware context for growth stage business — 2 active signals, 3 recommendations available...');
  });
});
