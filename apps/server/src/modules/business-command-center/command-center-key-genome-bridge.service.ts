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
  ): Promise<CommandCenterKeyGenomeCrossDomain> {
    const snapshot =
      (await this.crossDomain.getLatestCrossDomainSnapshot(businessId)) ??
      (await this.crossDomain.computeCrossDomainSnapshot(businessId).catch(() => null));

    const [ranked, opportunities, staleFacts, lowConfidenceFacts] = await Promise.all([
      this.ranker.rankRecommendations(businessId, { limit: 5 }).catch(() => null),
      this.opportunityDetector.detectOpportunities(businessId, { limit: 5 }).catch(() => null),
      this.signalService
        .listSignals(businessId, { signalType: 'STALE_FACT', status: 'NEW', limit: 100 })
        .catch(() => []),
      this.signalService
        .listSignals(businessId, { signalType: 'LOW_CONFIDENCE_FACT', status: 'NEW', limit: 100 })
        .catch(() => []),
    ]);

    const blockedActions = ranked?.blockedActions ?? [];
    const unsafeBlocks = await this.evaluateUnsafeBlocks(
      businessId,
      blockedActions.slice(0, UNSAFE_BLOCK_LIMIT),
    );

    const domainHealth: Record<string, number> = {};
    const domainReadiness: Record<string, number> = {};
    if (snapshot) {
      for (const score of snapshot.domainScores) {
        domainHealth[score.domain] = score.healthScore;
        domainReadiness[score.domain] = score.healthScore;
      }
    }

    const totalFacts = snapshot?.evidenceSummary?.totalFacts ?? 0;
    const highConfidenceFacts = snapshot?.evidenceSummary?.highConfidenceFacts ?? 0;
    const confidenceScore = totalFacts > 0 ? Math.round((highConfidenceFacts / totalFacts) * 100) : 0;

    const criticalMissingFactCount = moduleReadiness.reduce(
      (count, module) => count + module.missingFacts.filter((fact) => fact.impact === 'BLOCKING').length,
      0,
    );

    return {
      healthScore: snapshot?.overallHealthScore ?? 0,
      readinessScore: snapshot?.readinessSummary?.averageReadinessScore ?? 0,
      confidenceScore,
      overallRiskLevel: snapshot?.overallRiskLevel ?? 'UNKNOWN',
      domainHealth,
      domainReadiness,
      topRecommendations: ranked?.rankedRecommendations ?? [],
      topOpportunities: opportunities?.prioritizedOpportunities ?? [],
      unsafeAutomationBlocks: unsafeBlocks,
      staleFactCount: staleFacts.length + lowConfidenceFacts.length,
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
