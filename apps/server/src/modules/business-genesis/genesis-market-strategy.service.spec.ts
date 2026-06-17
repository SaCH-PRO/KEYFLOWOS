import { describe, expect, it, vi } from 'vitest';
import { GenesisMarketStrategyService } from './genesis-market-strategy.service';
import type { BlueprintService } from '../blueprint/blueprint.service';
import type { GenesisReadinessScorer } from './readiness-scorer.service';
import type { MarketStrategyContextBuilder } from './market-strategy-context-builder.service';
import type { MarketStrategyAiGenerator } from './market-strategy-ai-generator.service';
import type { MarketStrategyRepository } from './market-strategy.repository';
import type { MarketStrategyDocumentBuilder } from './market-strategy-document-builder.service';
import type { MarketStrategyMapper } from './market-strategy.mapper';
import type { BlueprintData } from '../blueprint/blueprint.types';

function makeService() {
  const blueprint = {
    getBlueprint: vi.fn().mockReturnValue({
      identity: { name: 'Biz' },
      marketProfile: { marketOpportunityScore: 50 },
    } as BlueprintData),
    updateBlueprint: vi.fn().mockReturnValue({
      identity: { name: 'Biz' },
      marketProfile: { marketStrategyGeneratedAt: '2026-06-15T00:00:00.000Z', competitorCount: 2, marketOpportunityScore: 72 },
    } as BlueprintData),
  } as unknown as BlueprintService;

  const readiness = {
    calculate: vi.fn().mockReturnValue({ overall: 70, market: 80, legal: 60, finance: 60, operations: 40, compliance: 30, blockers: [] }),
  } as unknown as GenesisReadinessScorer;

  const contextBuilder = { build: vi.fn().mockReturnValue('context') } as unknown as MarketStrategyContextBuilder;

  const ai = {
    generateSwotPestlePositioning: vi.fn().mockResolvedValue({
      swot: { strengths: [], weaknesses: [], opportunities: [], threats: [] },
      pestle: { political: '', economic: '', social: '', technological: '', legal: '', environmental: '' },
      positioning: { tagline: '', valueProposition: '', keyMessages: [], differentiators: [], targetSegments: [] },
      analysisSummary: { marketOpportunityScore: 72, keyInsight: 'insight' },
    }),
    generateCompetitors: vi.fn().mockResolvedValue([{ name: 'C1', threatLevel: 'MEDIUM', strengths: [], weaknesses: [] }]),
    generateLaunchPlan: vi.fn().mockResolvedValue({ launchPlan: { summary: '', phases: [] } }),
  } as unknown as MarketStrategyAiGenerator;

  const repository = {
    replaceStrategyAndCompetitors: vi.fn().mockResolvedValue({
      strategy: { id: 'ms_1', businessId: 'biz_1' },
      competitors: [{ id: 'c1' }],
    }),
    findStrategyWithCompetitors: vi.fn().mockResolvedValue({
      strategy: { id: 'ms_1', businessId: 'biz_1' },
      competitors: [{ id: 'c1' }],
    }),
  } as unknown as MarketStrategyRepository;

  const documentBuilder = {
    buildOrUpdate: vi.fn().mockResolvedValue({ id: 'market-strategy:biz_1' }),
    exists: vi.fn().mockResolvedValue(true),
    getInstanceId: vi.fn().mockReturnValue('market-strategy:biz_1'),
  } as unknown as MarketStrategyDocumentBuilder;

  const mapper = {
    toResponse: vi.fn().mockImplementation((_strategy, _competitors, documentInstanceId, readiness) => ({
      strategy: { id: 'ms_1' },
      competitors: [],
      documentInstanceId,
      readiness,
    })),
  } as unknown as MarketStrategyMapper;

  const service = new GenesisMarketStrategyService(blueprint, readiness, contextBuilder, ai, repository, documentBuilder, mapper);

  return { service, blueprint, readiness, contextBuilder, ai, repository, documentBuilder, mapper };
}

describe('GenesisMarketStrategyService', () => {
  it('generateMarketStrategy orchestrates AI, persistence, document, blueprint patch and readiness recalc', async () => {
    const deps = makeService();
    const result = await deps.service.generateMarketStrategy('biz_1');

    expect(deps.contextBuilder.build).toHaveBeenCalledOnce();
    expect(deps.ai.generateSwotPestlePositioning).toHaveBeenCalledOnce();
    expect(deps.ai.generateCompetitors).toHaveBeenCalledOnce();
    expect(deps.ai.generateLaunchPlan).toHaveBeenCalledOnce();
    expect(deps.repository.replaceStrategyAndCompetitors).toHaveBeenCalledOnce();
    expect(deps.documentBuilder.buildOrUpdate).toHaveBeenCalledOnce();
    expect(deps.blueprint.updateBlueprint).toHaveBeenCalledTimes(2);
    expect(deps.readiness.calculate).toHaveBeenCalledTimes(2);
    expect(result.documentInstanceId).toBe('market-strategy:biz_1');
    expect(deps.mapper.toResponse).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'ms_1' }),
      expect.any(Array),
      'market-strategy:biz_1',
      expect.objectContaining({ overall: 70 }),
    );
  });

  it('getMarketStrategy returns mapped response and document instance id', async () => {
    const deps = makeService();
    const result = await deps.service.getMarketStrategy('biz_1');

    expect(deps.repository.findStrategyWithCompetitors).toHaveBeenCalledWith('biz_1');
    expect(deps.blueprint.getBlueprint).toHaveBeenCalledWith('biz_1');
    expect(deps.documentBuilder.exists).toHaveBeenCalledWith('biz_1');
    expect(deps.mapper.toResponse).toHaveBeenCalled();
    expect(result.documentInstanceId).toBe('market-strategy:biz_1');
  });

  it('continues when document builder fails', async () => {
    const deps = makeService();
    deps.documentBuilder.buildOrUpdate = vi.fn().mockRejectedValue(new Error('Doc engine down'));
    const result = await deps.service.generateMarketStrategy('biz_1');

    expect(deps.repository.replaceStrategyAndCompetitors).toHaveBeenCalledOnce();
    expect(result.documentInstanceId).toBeNull();
  });
});
