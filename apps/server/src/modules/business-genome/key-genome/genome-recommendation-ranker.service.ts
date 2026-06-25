import { Injectable } from '@nestjs/common';
import { GenomeCrossDomainService } from './genome-cross-domain.service';
import { GenomeMemoryService } from './genome-memory.service';
import { GenomeRecommendationService } from './genome-recommendation.service';
import type {
  GenomeCrossDomainDomainKey,
  GenomeCrossDomainRiskLevel,
  GenomeCrossDomainSnapshotData,
  GenomeRankedRecommendation,
  GenomeRecommendationCapacityGating,
  GenomeRecommendationData,
  GenomeRecommendationFinancialViability,
  GenomeRecommendationRankingOptions,
  GenomeRecommendationRankingResult,
  GenomeRecommendationRankScoreBreakdown,
} from './key-genome.types';

const RISK_WEIGHT: Record<GenomeCrossDomainRiskLevel, number> = {
  LOW: 0,
  MEDIUM: 0.4,
  HIGH: 0.7,
  CRITICAL: 1,
  UNKNOWN: 0.2,
};

const EFFORT_WEIGHT: Record<'LOW' | 'MEDIUM' | 'HIGH', number> = {
  LOW: 0,
  MEDIUM: 0.3,
  HIGH: 0.6,
};

const FINANCIAL_VIABILITY_SCORE: Record<
  GenomeRecommendationFinancialViability,
  number
> = {
  POOR: 0,
  FAIR: 0.33,
  GOOD: 0.66,
  STRONG: 1,
};

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

function effortValue(
  effortLevel: GenomeRecommendationData['effortLevel'],
): number {
  return EFFORT_WEIGHT[effortLevel] ?? 0;
}

function mapDomainToCrossDomainKey(
  domain: string,
): GenomeCrossDomainDomainKey | null {
  const d = domain.toUpperCase();
  if (d.includes('FINANCE')) return 'finance';
  if (d.includes('CUSTOMER') || d.includes('SALES') || d.includes('REVENUE')) {
    return 'customer_sales_revenue';
  }
  if (d.includes('OPERATION')) return 'operations_delivery';
  if (d.includes('MARKET')) return 'marketing_growth';
  return null;
}

function financialViabilityFromSnapshot(
  snapshot: GenomeCrossDomainSnapshotData | null,
): GenomeRecommendationFinancialViability {
  if (!snapshot) return 'POOR';
  const financeRisk = snapshot.domainRisks?.finance ?? 'UNKNOWN';
  if (financeRisk === 'CRITICAL' || snapshot.overallRiskLevel === 'CRITICAL') {
    return 'POOR';
  }
  if (financeRisk === 'HIGH' || snapshot.overallRiskLevel === 'HIGH') {
    return 'FAIR';
  }
  if (financeRisk === 'MEDIUM') return 'GOOD';
  return 'STRONG';
}

function capacityGatingFromSnapshot(
  snapshot: GenomeCrossDomainSnapshotData | null,
): GenomeRecommendationCapacityGating {
  if (!snapshot) return 'HARD_CONSTRAINT';
  const opsRisk = snapshot.domainRisks?.operations_delivery ?? 'UNKNOWN';
  if (opsRisk === 'CRITICAL' || opsRisk === 'HIGH') return 'HARD_CONSTRAINT';
  if (opsRisk === 'MEDIUM') return 'SOFT_CONSTRAINT';
  return 'NO_CONSTRAINT';
}

function buildRankReason(
  breakdown: GenomeRecommendationRankScoreBreakdown,
  capacity: GenomeRecommendationCapacityGating,
): string {
  const drivers: string[] = [];
  if (breakdown.expectedGain >= 0.65) drivers.push('high expected gain');
  if (breakdown.confidence >= 0.7) drivers.push('strong confidence');
  if (breakdown.readiness >= 0.7) drivers.push('good readiness');
  if (breakdown.crossDomainSynergy >= 0.1)
    drivers.push('cross-domain synergy');
  if (breakdown.financialViability >= 0.66)
    drivers.push('solid financial viability');

  const penalties: string[] = [];
  if (breakdown.riskPenalty >= 0.7) penalties.push('high risk');
  if (breakdown.effortPenalty >= 0.5) penalties.push('high effort');
  if (capacity === 'HARD_CONSTRAINT') penalties.push('capacity hard constraint');
  if (capacity === 'SOFT_CONSTRAINT') penalties.push('capacity soft constraint');

  if (drivers.length === 0) drivers.push('balanced profile');
  let reason = `Ranked for ${drivers.join(', ')}.`;
  if (penalties.length > 0) {
    reason += ` Watch ${penalties.join(', ')}.`;
  }
  return reason;
}

@Injectable()
export class GenomeRecommendationRankerService {
  constructor(
    private readonly recommendations: GenomeRecommendationService,
    private readonly crossDomain: GenomeCrossDomainService,
    private readonly memory: GenomeMemoryService,
  ) {}

  async rankRecommendations(
    businessId: string,
    options: GenomeRecommendationRankingOptions = {},
  ): Promise<GenomeRecommendationRankingResult> {
    const snapshot = await this.ensureSnapshot(businessId);
    const recs = await this.recommendations.listRecommendations(businessId, {
      status: options.status ?? 'ACTIVE',
      limit: 200,
    });

    let ranked = recs.map((rec) => this.scoreRecommendation(rec, snapshot));

    if (options.minConfidence !== undefined) {
      ranked = ranked.filter((r) => r.confidence >= options.minConfidence!);
    }

    if (options.maxEffortLevel !== undefined) {
      ranked = ranked.filter(
        (r) =>
          effortValue(r.effortLevel) <= effortValue(options.maxEffortLevel!),
      );
    }

    ranked.sort((a, b) => b.rankScore - a.rankScore);

    const limited = options.limit ? ranked.slice(0, options.limit) : ranked;

    const nextSafeActions = limited.filter((r) => this.isSafeAction(r));
    const blockedActions = limited.filter((r) => !this.isSafeAction(r));

    await this.memory.createMemoryEvent({
      businessId,
      sourceType: 'CROSS_DOMAIN_GENOME',
      eventType: 'CROSS_DOMAIN_RECOMMENDATIONS_RANKED',
      domain: 'CROSS_DOMAIN',
      section: 'CROSS_DOMAIN',
      title: 'Cross-domain recommendations ranked',
      summary: `${limited.length} recommendation(s) ranked; ${nextSafeActions.length} safe action(s), ${blockedActions.length} blocked.`,
      outcome:
        blockedActions.length > limited.length / 2 ? 'MIXED' : 'SUCCESS',
      impactScore: snapshot ? snapshot.overallHealthScore / 100 : 0.5,
      confidenceDelta: 0,
      metadata: {
        rankedCount: limited.length,
        safeCount: nextSafeActions.length,
        blockedCount: blockedActions.length,
        snapshotId: snapshot?.id ?? null,
      },
      occurredAt: new Date().toISOString(),
    });

    return {
      businessId,
      generatedAt: new Date().toISOString(),
      snapshotId: snapshot?.id ?? null,
      overallHealthScore: snapshot?.overallHealthScore ?? 0,
      overallRiskLevel: snapshot?.overallRiskLevel ?? 'UNKNOWN',
      rankedRecommendations: limited,
      nextSafeActions,
      blockedActions,
    };
  }

  async generateAndRankRecommendations(
    businessId: string,
    options: GenomeRecommendationRankingOptions = {},
  ): Promise<GenomeRecommendationRankingResult> {
    await this.recommendations.generateRecommendations({
      businessId,
      sources: options.sources?.length
        ? options.sources
        : ['READINESS_GAP', 'SIGNAL', 'WEAK_SECTION'],
      maxRecommendations: options.limit ?? 10,
    });

    return this.rankRecommendations(businessId, {
      ...options,
      status: 'ACTIVE',
    });
  }

  private isSafeAction(ranked: GenomeRankedRecommendation): boolean {
    return (
      ranked.capacityGating !== 'HARD_CONSTRAINT' &&
      ranked.financialViability !== 'POOR' &&
      ranked.readinessGating.blockingDomains.length === 0 &&
      ranked.rankScore >= 40
    );
  }

  private scoreRecommendation(
    rec: GenomeRecommendationData,
    snapshot: GenomeCrossDomainSnapshotData | null,
  ): GenomeRankedRecommendation {
    const domainKey = mapDomainToCrossDomainKey(rec.domain);
    const domainScore = domainKey
      ? snapshot?.domainScores.find((d) => d.domain === domainKey) ?? null
      : null;

    const affectedDomains: GenomeCrossDomainDomainKey[] = domainKey
      ? [domainKey]
      : [];

    const readinessValue = domainScore
      ? clamp(domainScore.healthScore) / 100
      : snapshot
        ? snapshot.overallHealthScore / 100
        : 0.5;

    const readinessBlocking: GenomeCrossDomainDomainKey[] = [];
    const readinessReady: GenomeCrossDomainDomainKey[] = [];
    if (domainKey) {
      if (
        (domainScore?.healthScore ?? 0) < 50 ||
        domainScore?.riskLevel === 'HIGH' ||
        domainScore?.riskLevel === 'CRITICAL'
      ) {
        readinessBlocking.push(domainKey);
      } else {
        readinessReady.push(domainKey);
      }
    }

    const weakestDomain = snapshot
      ? [...snapshot.domainScores].sort((a, b) => a.healthScore - b.healthScore)[0]
      : null;
    const crossDomainSynergy =
      domainKey && weakestDomain && domainKey === weakestDomain.domain ? 0.15 : 0.05;

    const riskPenalty = RISK_WEIGHT[rec.riskLevel] ?? 0;
    const effortPenalty = effortValue(rec.effortLevel);
    const financial = financialViabilityFromSnapshot(snapshot);
    const financialValue = FINANCIAL_VIABILITY_SCORE[financial];
    const capacity = capacityGatingFromSnapshot(snapshot);

    const rawScore =
      (clamp(rec.expectedGainScore) / 100) * 0.3 +
      rec.confidence * 0.2 +
      readinessValue * 0.15 +
      crossDomainSynergy +
      financialValue * 0.1 -
      riskPenalty * 0.15 -
      effortPenalty * 0.05;

    const rankScore = clamp(Math.round(rawScore * 100));

    const breakdown: GenomeRecommendationRankScoreBreakdown = {
      expectedGain: clamp(rec.expectedGainScore) / 100,
      confidence: rec.confidence,
      readiness: readinessValue,
      crossDomainSynergy,
      financialViability: financialValue,
      riskPenalty,
      effortPenalty,
    };

    return {
      ...rec,
      rankScore,
      rankReason: buildRankReason(breakdown, capacity),
      affectedDomains,
      readinessGating: {
        blockingDomains: readinessBlocking,
        readyDomains: readinessReady,
      },
      financialViability: financial,
      capacityGating: capacity,
      scoreBreakdown: breakdown,
    };
  }

  private async ensureSnapshot(
    businessId: string,
  ): Promise<GenomeCrossDomainSnapshotData | null> {
    const latest = await this.crossDomain.getLatestCrossDomainSnapshot(businessId);
    if (latest) return latest;
    try {
      return await this.crossDomain.computeCrossDomainSnapshot(businessId);
    } catch {
      return null;
    }
  }
}
