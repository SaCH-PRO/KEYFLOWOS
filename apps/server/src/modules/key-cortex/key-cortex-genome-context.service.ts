import { genomeContextForReader, genomeRecommendationsForReader } from './genome-context-for-reader';
import { Injectable, Logger, Optional, Inject } from '@nestjs/common';
import { RedisService } from '../../core/redis/redis.service';
import { KeyCortexGenomeBridgeService } from './key-cortex-genome-bridge.service';
import { KeyCortexContextV2Service } from './key-cortex-context-v2.service';
import {
  GenomeEnrichedContext,
  GenomeRecommendation,
  GenomeSignal,
  GenomeOpportunity,
  Suggestion,
} from './key-cortex-reasoning.types';

/**
 * KeyCortexGenomeContextService
 *
 * Provides genome-enriched context, ranked recommendations, and proactive
 * suggestions for the KEY Cortex reasoning pipeline.
 */
@Injectable()
export class KeyCortexGenomeContextService {
  private readonly logger = new Logger(KeyCortexGenomeContextService.name);
  private readonly GENOME_CONTEXT_TTL: number;

  constructor(
    private readonly redis: RedisService,
    @Optional()
    @Inject(KeyCortexGenomeBridgeService)
    private readonly genomeBridgeService?: KeyCortexGenomeBridgeService,
    @Optional()
    @Inject(KeyCortexContextV2Service)
    private readonly contextV2Service?: KeyCortexContextV2Service,
  ) {
    this.GENOME_CONTEXT_TTL =
      parseInt(process.env.KEY_CORTEX_GENOME_CONTEXT_TTL_SECONDS ?? '60', 10);
  }

  /**
   * Get a genome-enriched context, cached for 60 seconds.
   */
  async getGenomeEnrichedContext(
    businessId: string,
  ): Promise<GenomeEnrichedContext> {
    // v2 (FU-KEY-CHAT-GENOME-MONEY-SIGHT): signals carry section and domain; a v1 entry lacks them.
    const cacheKey = `genome:context:v2:${businessId}`;
    const cached = await this.redis.getJson<GenomeEnrichedContext>(cacheKey);
    if (cached) {
      this.logger.debug(
        `[getGenomeEnrichedContext] Cache hit for business=${businessId}`,
      );
      return cached;
    }

    if (!this.genomeBridgeService) {
      throw new Error('Genome bridge service is not available');
    }

    this.logger.debug(
      `[getGenomeEnrichedContext] Building genome-enriched context for business=${businessId}`,
    );

    const genomeIntelligence =
      await (this.genomeBridgeService as any).getGenomeIntelligence(businessId);

    const enriched: GenomeEnrichedContext = {
      dnaScores: genomeIntelligence.dnaScores ?? {},
      genomeStage: genomeIntelligence.genomeStage ?? 'unknown',
      executiveReadiness: genomeIntelligence.executiveReadiness ?? 0,
      recommendations: (genomeIntelligence.recommendations ?? []).map(
        (rec: any) => ({
          id: rec.id ?? this.generateId(),
          title: rec.title ?? 'Untitled recommendation',
          description: rec.description ?? '',
          impact: rec.impact ?? 'medium',
          category: rec.category ?? 'general',
          confidence: rec.confidence ?? 0.5,
          genomeScore: rec.genomeScore ?? 0,
        }),
      ),
      signals: (genomeIntelligence.signals ?? []).map((sig: any) => ({
        id: sig.id ?? this.generateId(),
        type: sig.type ?? 'info',
        message: sig.message ?? '',
        module: sig.module ?? 'general',
        section: sig.section ?? null,
        domain: sig.domain ?? null,
        severity: sig.severity ?? 'low',
        createdAt: sig.createdAt ? new Date(sig.createdAt) : new Date(),
      })),
      opportunities: (genomeIntelligence.opportunities ?? []).map(
        (opp: any) => ({
          id: opp.id ?? this.generateId(),
          title: opp.title ?? 'Untitled opportunity',
          estimatedValue: opp.estimatedValue ?? 0,
          category: opp.category ?? 'general',
          confidence: opp.confidence ?? 0.5,
        }),
      ),
      autonomyMap: genomeIntelligence.autonomyMap ?? {},
      timestamp: new Date(),
    };

    await this.redis.setJson(cacheKey, enriched, this.GENOME_CONTEXT_TTL);

    this.logger.debug(
      `[getGenomeEnrichedContext] Built genome-enriched context: ${enriched.recommendations.length} recommendations, ${enriched.signals.length} signals, ${enriched.opportunities.length} opportunities`,
    );

    return enriched;
  }

  /**
   * Get genome-ranked recommendations mapped to the internal GenomeRecommendation shape.
   */
  async getRankedRecommendations(
    businessId: string,
    limit = 5,
  ): Promise<GenomeRecommendation[]> {
    if (!this.genomeBridgeService) {
      return [];
    }

    const bridgeRanked = await this.genomeBridgeService.getRankedRecommendations(
      businessId,
      limit,
    );

    return bridgeRanked.map((r: any) => ({
      id: r.id,
      title: r.title,
      description: r.recommendation ?? r.insight,
      impact: this.impactNumberToLevel(r.impact),
      category: r.domain,
      confidence: r.confidence,
      genomeScore: r.rankScore,
    }));
  }

  /**
   * Determine whether KEY should suggest a proactive action based on genome signals.
   */
  // D-235: no reader given is a reader without revenue read (fails closed).
  async shouldSuggestProactiveAction(businessId: string, readsRevenue = false): Promise<boolean> {
    if (!this.genomeBridgeService) {
      return false;
    }

    try {
      // FU-KEY-CHAT-GENOME-MONEY-SIGHT (minor 1): decided on the genome the reader may see.
      const fullContext = await this.getGenomeEnrichedContext(businessId);
      const genomeContext = genomeContextForReader(fullContext, readsRevenue);

      const hasCriticalSignals = genomeContext.signals.some(
        (s: GenomeSignal) => s.severity === 'critical' || s.severity === 'high',
      );
      if (hasCriticalSignals) {
        this.logger.debug(
          `[shouldSuggestProactiveAction] business=${businessId}: critical signals detected`,
        );
        return true;
      }

      const previousScores = await this.redis.getJson<Record<string, number>>(
        `genome:dna:previous:${businessId}`,
      );
      if (previousScores && genomeContext.dnaScores) {
        for (const [key, currentScore] of Object.entries(
          genomeContext.dnaScores,
        )) {
          const previousScore = previousScores[key];
          if (previousScore && currentScore < previousScore - 10) {
            this.logger.debug(
              `[shouldSuggestProactiveAction] business=${businessId}: DNA score ${key} declined`,
            );
            return true;
          }
        }
      }

      // D-235: the business-wide cache holds the whole DNA map (each reader compares only the keys it may see), so one
      // reader's projection never stands in for another's.
      await this.redis.setJson(
        `genome:dna:previous:${businessId}`,
        fullContext.dnaScores,
        3600,
      );

      const hasHighValueOpportunities = genomeContext.opportunities.some(
        (o: GenomeOpportunity) => o.confidence > 0.8 && o.estimatedValue > 5000,
      );
      if (hasHighValueOpportunities) {
        this.logger.debug(
          `[shouldSuggestProactiveAction] business=${businessId}: high-value opportunities detected`,
        );
        return true;
      }

      return false;
    } catch (err: any) {
      this.logger.warn(
        `[shouldSuggestProactiveAction] business=${businessId}: check failed — ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }

  /**
   * Get proactive suggestions based on genome intelligence.
   */
  async getProactiveSuggestions(
    businessId: string,
    integrationV2Enabled = false,
    // D-235: no reader given is a reader without revenue read (fails closed).
    readsRevenue = false,
  ): Promise<Suggestion[]> {
    if (!this.genomeBridgeService) {
      return [];
    }

    try {
      // FU-KEY-CHAT-GENOME-MONEY-SIGHT (MAJOR-1): suggestions, and the fallback, come from the genome the
      // reader may see, so all-finance recommendations do not hide the reader's other suggestions.
      const genomeContext = genomeContextForReader(await this.getGenomeEnrichedContext(businessId), readsRevenue);

      let v2Context: any = {};
      if (integrationV2Enabled && this.contextV2Service) {
        try {
          v2Context =
            (await this.contextV2Service.getFullContext(businessId)) ?? {};
        } catch {
          // Non-critical
        }
      }

      // Codex P2 on #217: filtered for the reader before the top rows are taken, so finance rows ranked first do not push
      // out a permitted one (a reader without revenue read is read with headroom).
      const rankedRecs = genomeRecommendationsForReader(
        (await this.genomeBridgeService.getRankedRecommendations(businessId, readsRevenue ? 5 : 50)).map((r: any) => ({ ...r, category: r.domain })),
        readsRevenue,
      ).slice(0, 5);

      const topRecs = rankedRecs
        .filter((r: any) => r.impact >= 0.7 || r.confidence > 0.7)
        .slice(0, 3);

      const suggestions: Suggestion[] = topRecs.map((rec: any) => ({
        id: rec.id ?? this.generateId(),
        title: rec.title,
        description: rec.recommendation ?? rec.insight,
        impact: this.impactNumberToLevel(rec.impact),
        category: rec.domain,
        source: 'genome',
        confidence: rec.confidence,
        action: `Consider ${rec.title.toLowerCase()} to improve ${rec.domain}`,
      }));

      if (suggestions.length === 0) {
        const urgentSignals = genomeContext.signals.filter(
          (s: GenomeSignal) =>
            s.severity === 'critical' || s.severity === 'high',
        );
        for (const signal of urgentSignals.slice(0, 3)) {
          suggestions.push({
            id: signal.id,
            title: `Action needed: ${signal.module}`,
            description: signal.message,
            impact:
              signal.severity === 'critical'
                ? 'high'
                : signal.severity === 'high'
                  ? 'high'
                  : 'medium',
            category: signal.module,
            source: 'genome',
            confidence: 0.9,
            action: `Address ${signal.type} in ${signal.module}: ${signal.message}`,
          });
        }
      }

      this.logger.debug(
        `[getProactiveSuggestions] business=${businessId}: generated ${suggestions.length} proactive suggestions`,
      );

      return suggestions;
    } catch (err: any) {
      this.logger.warn(
        `[getProactiveSuggestions] business=${businessId}: failed — ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    }
  }

  impactNumberToLevel(impact: number): 'high' | 'medium' | 'low' {
    if (impact >= 0.7) return 'high';
    if (impact >= 0.4) return 'medium';
    return 'low';
  }

  private generateId(): string {
    return `crtx_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }
}
