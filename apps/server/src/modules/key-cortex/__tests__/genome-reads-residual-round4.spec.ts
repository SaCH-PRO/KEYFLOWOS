/**
 * FU-KEY-GENOME-READS-RESIDUAL (D-235; D-233, D-234) round 4: the chat path's ranked recommendations are read with
 * headroom for a reader without revenue read (security MINOR-1, correctness finding 1: how many of the business's top
 * five are finance or sales was readable from how many the reader was handed), and getActiveGoals orders a reader's goals
 * as the projected recommendations are ordered (security NIT-2). The guards of the two routes are pinned (NIT-5).
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { KeyCortexGenomeContextService } from '../key-cortex-genome-context.service';
import { KeyCortexConsciousnessService } from '../key-cortex-consciousness.service';
import { CortexMemberAuthorityGuard, KeyCortexController } from '../key-cortex.controller';

const fin = (i: number) => ({ id: `fin_${i}`, title: `Raise the retainer ${i}`, recommendation: 'x', impact: 0.9, confidence: 0.9, domain: 'FINANCIAL', rankScore: 90 - i });
const ops = (i: number) => ({ id: `ops_${i}`, title: `Write the SOPs ${i}`, recommendation: 'y', impact: 0.5, confidence: 0.5, domain: 'OPERATIONS', rankScore: 50 - i });

function genomeContext(ranked: any[]) {
  const bridge = { getRankedRecommendations: vi.fn(async (_b: string, limit = 5) => ranked.slice(0, limit)) } as any;
  const redis = { getJson: vi.fn(async () => null), setJson: vi.fn() } as any;
  return { svc: new KeyCortexGenomeContextService(redis, bridge), bridge };
}

describe('the chat path\'s ranked recommendations (round 4, security MINOR-1 / correctness finding 1)', () => {
  // The business's top five are four finance rows and one operations row; five more operations rows rank below them.
  const ranked = [fin(1), fin(2), ops(1), fin(3), fin(4), ops(2), ops(3), ops(4), ops(5), ops(6)];

  it('RED-BEFORE: a reader without revenue read is handed five non-finance rows, not what is left of the top five', async () => {
    const { svc, bridge } = genomeContext(ranked);
    const out = await svc.getRankedRecommendationsForReader('biz_A', false);
    expect(out.map((r) => r.id)).toEqual(['ops_1', 'ops_2', 'ops_3', 'ops_4', 'ops_5']);
    expect(bridge.getRankedRecommendations).toHaveBeenCalledWith('biz_A', 50);
    for (const r of out as any[]) expect(r).not.toHaveProperty('genomeScore');
  });

  it('RED-BEFORE: with no reader it fails closed', async () => {
    const { svc } = genomeContext(ranked);
    const out = await svc.getRankedRecommendationsForReader('biz_A');
    expect(out.map((r) => r.category)).not.toContain('FINANCIAL');
  });

  it('control: a revenue reader is handed the top five as before, in the ranker\'s order', async () => {
    const { svc, bridge } = genomeContext(ranked);
    const out = await svc.getRankedRecommendationsForReader('biz_A', true);
    expect(out).toEqual(await svc.getRankedRecommendations('biz_A', 5));
    expect(out.map((r) => r.id)).toEqual(['fin_1', 'fin_2', 'ops_1', 'fin_3', 'fin_4']);
    expect(bridge.getRankedRecommendations).toHaveBeenNthCalledWith(1, 'biz_A', 5);
  });

  it('RED-BEFORE: the query pipeline reads them for the reader, not the business\'s top five', () => {
    const source = readFileSync(join(__dirname, '..', 'key-cortex-query-pipeline.service.ts'), 'utf8');
    expect(source).not.toMatch(/genomeContextService\.getRankedRecommendations\(/);
    expect(source).toMatch(/genomeContextService\.getRankedRecommendationsForReader\(\s*query\.businessId,\s*await this\.readsRevenue\(query\),?\s*\)/);
  });
});

describe('getActiveGoals orders a reader\'s goals as the projected recommendations (round 4, security NIT-2)', () => {
  function consciousness(ranked: any[]) {
    const svc = Object.create(KeyCortexConsciousnessService.prototype) as any;
    svc.activeGoalsCache = new Map();
    svc.genomeBridge = { getRankedRecommendations: vi.fn(async (_b: string, limit = 5) => ranked.slice(0, limit)) };
    svc.eventService = { getEvents: vi.fn(async () => []) };
    svc.intuition = { detectWeakSignals: vi.fn(async () => []) };
    return svc;
  }
  // The ranker puts the low-impact row first (its money-weighted score); its own impact and confidence put it second.
  const ranked = [{ ...ops(1), impact: 0.2, confidence: 0.2 }, { ...ops(2), impact: 0.9, confidence: 0.9 }];

  it('RED-BEFORE: a reader without revenue read gets the goals in the order of their own impact and confidence', async () => {
    const goals: string[] = await consciousness(ranked).getActiveGoals('biz_A', false);
    expect(goals.filter((g) => g.startsWith('[Genome]'))).toEqual(['[Genome] Write the SOPs 2', '[Genome] Write the SOPs 1']);
  });

  it('control: a revenue reader keeps the ranker\'s order', async () => {
    const goals: string[] = await consciousness(ranked).getActiveGoals('biz_A', true);
    expect(goals.filter((g) => g.startsWith('[Genome]'))).toEqual(['[Genome] Write the SOPs 1', '[Genome] Write the SOPs 2']);
  });
});

describe('the two routes keep their member guard (round 4, security NIT-5)', () => {
  it.each(['evolutionExplainDecision', 'getAwareness'])('%s is guarded by CortexMemberAuthorityGuard', (name) => {
    const guards: unknown[] = Reflect.getMetadata('__guards__', (KeyCortexController.prototype as any)[name]) ?? [];
    expect(guards).toContain(CortexMemberAuthorityGuard);
  });
});
