import { describe, expect, it, vi } from 'vitest';
import { MarketStrategyAiGenerator } from './market-strategy-ai-generator.service';
import type { ModelGatewayService } from '../ai/model-gateway.service';

function makeGateway(response?: { content: string | null }) {
  return {
    complete: vi.fn().mockResolvedValue({
      content: response?.content ?? null,
      provider: 'openai/gpt-4o-mini',
      model: 'gpt-4o-mini',
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    }),
  } as unknown as ModelGatewayService;
}

const swotPayload = {
  swot: { strengths: ['s1'], weaknesses: ['w1'], opportunities: ['o1'], threats: ['t1'] },
  pestle: { political: 'p', economic: 'e', social: 's', technological: 't', legal: 'l', environmental: 'e2' },
  positioning: { tagline: 'tag', valueProposition: 'vp', keyMessages: ['m1'], differentiators: ['d1'], targetSegments: ['seg1'] },
  analysisSummary: { marketOpportunityScore: 72, keyInsight: ' insight' },
};

const competitorPayload = {
  competitors: [
    { name: 'A', threatLevel: 'HIGH', strengths: ['s'], weaknesses: ['w'], positioning: 'pos' },
    { name: 'B', threatLevel: 'low', strengths: [], weaknesses: [], positioning: null },
    { name: 'C', threatLevel: 'unknown', strengths: [], weaknesses: [] },
  ],
};

const launchPlanPayload = {
  launchPlan: { summary: 'summary', phases: [{ name: 'P1', duration: 'Week 1', actions: ['a1'] }] },
};

describe('MarketStrategyAiGenerator', () => {
  it('parses and returns SWOT/PESTLE/positioning result', async () => {
    const gateway = makeGateway({ content: JSON.stringify(swotPayload) });
    const gen = new MarketStrategyAiGenerator(gateway);
    const result = await gen.generateSwotPestlePositioning('biz_1', 'context');

    expect(result.swot.strengths).toEqual(['s1']);
    expect(result.positioning.tagline).toBe('tag');
    expect(result.analysisSummary.marketOpportunityScore).toBe(72);
    expect(gateway.complete).toHaveBeenCalledOnce();
  });

  it('returns safe fallback when model gateway throws', async () => {
    const gateway = { complete: vi.fn().mockRejectedValue(new Error('Provider down')) } as unknown as ModelGatewayService;
    const gen = new MarketStrategyAiGenerator(gateway);
    const result = await gen.generateSwotPestlePositioning('biz_1', 'context');

    expect(result.swot.strengths).toEqual([]);
    expect(result.analysisSummary.marketOpportunityScore).toBe(0);
  });

  it('normalizes and truncates competitors', async () => {
    const gateway = makeGateway({ content: JSON.stringify(competitorPayload) });
    const gen = new MarketStrategyAiGenerator(gateway);
    const result = await gen.generateCompetitors('biz_1', 'context');

    expect(result).toHaveLength(3);
    expect(result[0].threatLevel).toBe('HIGH');
    expect(result[1].threatLevel).toBe('LOW');
    expect(result[2].threatLevel).toBeNull();
  });

  it('truncates competitors to 5 and returns fallback for none', async () => {
    const gateway = makeGateway({ content: JSON.stringify({ competitors: Array.from({ length: 8 }, (_, i) => ({ name: `C${i}`, threatLevel: 'MEDIUM', strengths: [], weaknesses: [] })) }) });
    const gen = new MarketStrategyAiGenerator(gateway);
    const result = await gen.generateCompetitors('biz_1', 'context');

    expect(result).toHaveLength(5);
  });

  it('returns empty competitors fallback on gateway error', async () => {
    const gateway = { complete: vi.fn().mockRejectedValue(new Error('Provider down')) } as unknown as ModelGatewayService;
    const gen = new MarketStrategyAiGenerator(gateway);
    const result = await gen.generateCompetitors('biz_1', 'context');

    expect(result).toEqual([]);
  });

  it('parses launch plan result', async () => {
    const gateway = makeGateway({ content: JSON.stringify(launchPlanPayload) });
    const gen = new MarketStrategyAiGenerator(gateway);
    const result = await gen.generateLaunchPlan('biz_1', 'context');

    expect(result.launchPlan.summary).toBe('summary');
    expect(result.launchPlan.phases).toHaveLength(1);
  });

  it('strips markdown fences before parsing', async () => {
    const gateway = makeGateway({ content: '```json\n' + JSON.stringify(swotPayload) + '\n```' });
    const gen = new MarketStrategyAiGenerator(gateway);
    const result = await gen.generateSwotPestlePositioning('biz_1', 'context');

    expect(result.swot.strengths).toEqual(['s1']);
  });
});
