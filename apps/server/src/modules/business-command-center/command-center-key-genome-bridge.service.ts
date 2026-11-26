import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { GenomeAutonomyGateService } from '../business-genome/key-genome/genome-autonomy-gate.service';
import { GenomeCrossDomainService } from '../business-genome/key-genome/genome-cross-domain.service';
import { GenomeOpportunityDetectorService } from '../business-genome/key-genome/genome-opportunity-detector.service';
import { GenomeRecommendationRankerService } from '../business-genome/key-genome/genome-recommendation-ranker.service';
import { GenomeSignalService } from '../business-genome/key-genome/genome-signal.service';
import type {
  GenomeCrossDomainDomainKey,
  GenomeRankedRecommendation,
  ModuleReadinessData,
} from '../business-genome/key-genome/key-genome.types';
import type { CommandCenterKeyGenomeCrossDomain } from './business-command-center.types';
import {
  isFinanceSignal,
  isMoneyLabel,
} from '../business-genome/key-genome/genome-finance-scope';
import {
  isMoneyFact,
  moduleReadinessForReader,
} from '../business-genome/key-genome/genome-composites-for-reader';

const UNSAFE_BLOCK_LIMIT = 3;

@Injectable()
export class CommandCenterKeyGenomeBridgeService {
  constructor(
    @Inject(forwardRef(() => GenomeCrossDomainService))
    private readonly crossDomain: GenomeCrossDomainService,
    private readonly ranker: GenomeRecommendationRankerService,
    private readonly opportunityDetector: GenomeOpportunityDetectorService,
    private readonly autonomyGate: GenomeAutonomyGateService,
    private readonly signalService: GenomeSignalService,
  ) {}

  async buildCrossDomainBrief(
    businessId: string,
    moduleReadiness: ModuleReadinessData[],
    options: { readsRevenue?: boolean; writesRevenue?: boolean } = {},
  ): Promise<CommandCenterKeyGenomeCrossDomain> {
    const readsRevenue = options.readsRevenue !== false;
    const writesRevenue = options.writesRevenue ?? readsRevenue;

    const latestSnapshot = await this.crossDomain.getLatestCrossDomainSnapshot(businessId);
    const snapshot =
      latestSnapshot ??
      (readsRevenue && writesRevenue
        ? await this.crossDomain.computeCrossDomainSnapshot(businessId).catch(() => null)
        : null);

    // W11-GENOME-RECS-DOMAIN (D-128/D-100): ranker, opportunityDetector, and
    // autonomyGate read snapshot.domainRisks.finance / overallRiskLevel (exposing
    // financialViability, money-weighted rankScore/rankReason/order, and finance
    // risk blocks) and persist CROSS_DOMAIN_GENOME memory events or recompute the
    // cross-domain snapshot. Without revenue:read, never invoke them; non-finance
    // recommendations remain served via BusinessCommandCenterService's
    // listRecommendationsForReader mapper.
    const [ranked, opportunities, staleFacts, lowConfidenceFacts] = await Promise.all([
      readsRevenue && snapshot !== null
        ? this.ranker.rankRecommendations(businessId, { limit: 5 }).catch(() => null)
        : Promise.resolve(null),
      readsRevenue && snapshot !== null
        ? this.opportunityDetector.detectOpportunities(businessId, { limit: 5 }).catch(() => null)
        : Promise.resolve(null),
      this.signalService
        .listSignals(businessId, { signalType: 'STALE_FACT', status: 'NEW', limit: 100 })
        .catch(() => []),
      this.signalService
        .listSignals(businessId, { signalType: 'LOW_CONFIDENCE_FACT', status: 'NEW', limit: 100 })
        .catch(() => []),
    ]);

    const topRecommendations = readsRevenue ? (ranked?.rankedRecommendations ?? []) : [];

    const unsafeBlocks =
      readsRevenue && snapshot !== null
        ? await this.evaluateUnsafeBlocks(
            businessId,
            (ranked?.blockedActions ?? []).slice(0, UNSAFE_BLOCK_LIMIT),
          )
        : [];

    const domainHealth: Record<string, number> = {};
    const domainReadiness: Record<string, number> = {};
    const visibleDomainScores: number[] = [];
    if (snapshot) {
      for (const score of snapshot.domainScores) {
        if (!readsRevenue && isMoneyLabel(score.domain)) continue;
        domainHealth[score.domain] = score.healthScore;
        domainReadiness[score.domain] = score.healthScore;
        visibleDomainScores.push(score.healthScore);
      }
    }

    const totalFacts = snapshot?.evidenceSummary?.totalFacts ?? 0;
    const highConfidenceFacts = snapshot?.evidenceSummary?.highConfidenceFacts ?? 0;
    const confidenceScore =
      readsRevenue && totalFacts > 0 ? Math.round((highConfidenceFacts / totalFacts) * 100) : 0;

    const visibleModuleReadiness = moduleReadinessForReader(moduleReadiness, readsRevenue);

    const criticalMissingFactCount = visibleModuleReadiness.reduce(
      (count, module) =>
        count +
        module.missingFacts.filter(
          (fact) => fact.impact === 'BLOCKING' && (readsRevenue || !isMoneyFact(fact)),
        ).length,
      0,
    );

    const visibleStale = readsRevenue ? staleFacts : staleFacts.filter((s) => !isFinanceSignal(s));
    const visibleLowConf = readsRevenue
      ? lowConfidenceFacts
      : lowConfidenceFacts.filter((s) => !isFinanceSignal(s));

    const healthScore = readsRevenue
      ? (snapshot?.overallHealthScore ?? 0)
      : visibleDomainScores.length > 0
        ? Math.round(visibleDomainScores.reduce((a, b) => a + b, 0) / visibleDomainScores.length)
        : 0;

    const readinessScore = readsRevenue
      ? (snapshot?.readinessSummary?.averageReadinessScore ?? 0)
      : visibleModuleReadiness.length > 0
        ? Math.round(
            visibleModuleReadiness.reduce((a, m) => a + (m.readinessScore ?? 0), 0) /
              visibleModuleReadiness.length,
          )
        : 0;

    return {
      healthScore,
      readinessScore,
      confidenceScore,
      overallRiskLevel: readsRevenue ? (snapshot?.overallRiskLevel ?? 'UNKNOWN') : 'UNKNOWN',
      domainHealth,
      domainReadiness,
      topRecommendations,
      topOpportunities: readsRevenue ? (opportunities?.prioritizedOpportunities ?? []) : [],
      unsafeAutomationBlocks: unsafeBlocks,
      staleFactCount: visibleStale.length + visibleLowConf.length,
      criticalMissingFactCount,
    };
  }

  private async evaluateUnsafeBlocks(
    businessId: string,
    blockedRecommendations: GenomeRankedRecommendation[],
  ) {
    if (blockedRecommendations.length === 0) {
      return [];
    }

    const results = await Promise.all(
      blockedRecommendations.map((rec) =>
        this.autonomyGate
          .checkGate({
            businessId,
            actionType: rec.title,
            affectedDomains: rec.affectedDomains as GenomeCrossDomainDomainKey[],
            payload: { recommendationId: rec.id },
          })
          .catch(() => null),
      ),
    );

    return results.filter((result) => result !== null);
  }
}
