import { Injectable, Inject, Logger } from '@nestjs/common';
import { BlueprintService } from '../blueprint/blueprint.service';
import { GenesisReadinessScorer } from './readiness-scorer.service';
import { MarketStrategyContextBuilder } from './market-strategy-context-builder.service';
import { MarketStrategyAiGenerator } from './market-strategy-ai-generator.service';
import { MarketStrategyRepository } from './market-strategy.repository';
import { MarketStrategyDocumentBuilder } from './market-strategy-document-builder.service';
import { MarketStrategyMapper } from './market-strategy.mapper';
import type { MarketStrategyResponse, GenesisReadinessScore } from './business-genesis.types';

@Injectable()
export class GenesisMarketStrategyService {
  private readonly logger = new Logger(GenesisMarketStrategyService.name);

  constructor(
    @Inject(BlueprintService) private readonly blueprint: BlueprintService,
    @Inject(GenesisReadinessScorer) private readonly readiness: GenesisReadinessScorer,
    @Inject(MarketStrategyContextBuilder) private readonly contextBuilder: MarketStrategyContextBuilder,
    @Inject(MarketStrategyAiGenerator) private readonly ai: MarketStrategyAiGenerator,
    @Inject(MarketStrategyRepository) private readonly repository: MarketStrategyRepository,
    @Inject(MarketStrategyDocumentBuilder) private readonly documentBuilder: MarketStrategyDocumentBuilder,
    @Inject(MarketStrategyMapper) private readonly mapper: MarketStrategyMapper,
  ) {}

  async generateMarketStrategy(businessId: string): Promise<MarketStrategyResponse> {
    const blueprint = await this.blueprint.getBlueprint(businessId);
    const previousReadiness = this.readiness.calculate(blueprint);

    const context = this.contextBuilder.build(blueprint);

    const [swotPestlePositioning, competitors, launchPlan] = await Promise.all([
      this.ai.generateSwotPestlePositioning(businessId, context),
      this.ai.generateCompetitors(businessId, context),
      this.ai.generateLaunchPlan(businessId, context),
    ]);

    const marketOpportunityScore = this.clampScore(
      swotPestlePositioning.analysisSummary?.marketOpportunityScore,
    );

    const generatedAt = new Date().toISOString();

    const strategyData = {
      swot: swotPestlePositioning.swot,
      pestle: swotPestlePositioning.pestle,
      positioning: swotPestlePositioning.positioning,
      launchPlan: launchPlan.launchPlan,
      analysisSummary: {
        marketOpportunityScore,
        keyInsight: swotPestlePositioning.analysisSummary?.keyInsight ?? '',
      },
      generatedAt,
    };

    const competitorData = competitors.map((c) => ({
      name: c.name,
      threatLevel: c.threatLevel ?? null,
      strengths: c.strengths,
      weaknesses: c.weaknesses,
      positioning: c.positioning ?? null,
    }));

    const { strategy, competitors: persistedCompetitors } = await this.repository.replaceStrategyAndCompetitors(
      businessId,
      strategyData,
      competitorData,
    );

    let documentInstanceId: string | null = null;
    try {
      const instance = await this.documentBuilder.buildOrUpdate(businessId, strategyData, competitorData);
      documentInstanceId = instance.id;
    } catch (err) {
      this.logger.warn(`Document build failed for ${businessId}: ${(err as Error).message}`);
    }

    const updatedBlueprint = await this.blueprint.updateBlueprint(businessId, {
      marketProfile: {
        marketStrategyGeneratedAt: generatedAt,
        competitorCount: persistedCompetitors.length,
        marketOpportunityScore,
      },
    });

    let readinessScore: GenesisReadinessScore;
    try {
      readinessScore = this.readiness.calculate(updatedBlueprint);
      await this.blueprint.updateBlueprint(businessId, { readinessScore: readinessScore.overall });
    } catch (err) {
      this.logger.warn(`Readiness update failed for ${businessId}: ${(err as Error).message}`);
      readinessScore = previousReadiness;
    }

    return this.mapper.toResponse(strategy, persistedCompetitors, documentInstanceId, readinessScore);
  }

  async getMarketStrategy(businessId: string): Promise<MarketStrategyResponse> {
    const { strategy, competitors } = await this.repository.findStrategyWithCompetitors(businessId);
    const blueprint = await this.blueprint.getBlueprint(businessId);
    const readiness = this.readiness.calculate(blueprint);

    const documentInstanceId = (await this.documentBuilder.exists(businessId))
      ? this.documentBuilder.getInstanceId(businessId)
      : null;

    return this.mapper.toResponse(strategy, competitors, documentInstanceId, readiness);
  }

  private clampScore(value: unknown): number {
    if (typeof value !== 'number' || Number.isNaN(value)) return 0;
    return Math.max(0, Math.min(100, value));
  }
}
