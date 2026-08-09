import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { GenomeCrossDomainService } from './genome-cross-domain.service';
import { GenomeMemoryService } from './genome-memory.service';
import { GenomeRecommendationService } from './genome-recommendation.service';
import type {
  GenomeCrossDomainDomainKey,
  GenomeCrossDomainOpportunityCandidate,
  GenomeCrossDomainRiskLevel,
  GenomeCrossDomainSnapshotData,
  GenomeOpportunityDetectionOptions,
  GenomeOpportunityDetectionResult,
  GenomeRecommendationData,
} from './key-genome.types';

function riskToNumber(risk: GenomeCrossDomainRiskLevel): number {
  switch (risk) {
    case 'LOW':
      return 1;
    case 'MEDIUM':
      return 2;
    case 'HIGH':
      return 3;
    case 'CRITICAL':
      return 4;
    default:
      return 2;
  }
}

function domainScore(
  snapshot: GenomeCrossDomainSnapshotData | null,
  domain: GenomeCrossDomainDomainKey,
): number {
  if (!snapshot) return 0;
  return snapshot.domainScores.find((d) => d.domain === domain)?.healthScore ?? 0;
}

function domainRisk(
  snapshot: GenomeCrossDomainSnapshotData | null,
  domain: GenomeCrossDomainDomainKey,
): GenomeCrossDomainRiskLevel {
  if (!snapshot) return 'UNKNOWN';
  return snapshot.domainRisks[domain] ?? 'UNKNOWN';
}

function isHealthyEnough(risk: GenomeCrossDomainRiskLevel): boolean {
  return risk === 'LOW' || risk === 'MEDIUM';
}

@Injectable()
export class GenomeOpportunityDetectorService {
  constructor(
    @Inject(forwardRef(() => GenomeCrossDomainService))
    private readonly crossDomain: GenomeCrossDomainService,
    @Inject(forwardRef(() => GenomeRecommendationService))
    private readonly recommendations: GenomeRecommendationService,
    private readonly memory: GenomeMemoryService,
  ) {}

  async detectOpportunities(
    businessId: string,
    options: GenomeOpportunityDetectionOptions = {},
  ): Promise<GenomeOpportunityDetectionResult> {
    const snapshot = await this.ensureSnapshot(businessId);
    const activeRecommendations = await this.recommendations.listRecommendations(
      businessId,
      { status: 'ACTIVE', limit: 100 },
    );

    const opportunities = this.buildOpportunities(snapshot, activeRecommendations);

    if (options.includeRiskMitigation !== false) {
      opportunities.push(
        ...this.buildRiskMitigationOpportunities(snapshot, activeRecommendations),
      );
    }

    const prioritized = this.prioritizeOpportunities(
      opportunities,
      options.minPotentialImpact,
    );

    const limited = options.limit
      ? prioritized.slice(0, options.limit)
      : prioritized;

    await this.memory.createMemoryEvent({
      businessId,
      sourceType: 'CROSS_DOMAIN_GENOME',
      eventType: 'CROSS_DOMAIN_OPPORTUNITIES_DETECTED',
      domain: 'CROSS_DOMAIN',
      section: 'CROSS_DOMAIN',
      title: 'Cross-domain opportunities detected',
      summary: `${opportunities.length} opportunity(ies) detected; top ${limited.length} prioritized.`,
      outcome:
        opportunities.length > 0 && snapshot && snapshot.overallRiskLevel !== 'CRITICAL'
          ? 'SUCCESS'
          : 'MIXED',
      impactScore: snapshot ? snapshot.overallHealthScore / 100 : 0.5,
      confidenceDelta: 0,
      metadata: {
        opportunityCount: opportunities.length,
        prioritizedCount: limited.length,
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
      opportunities,
      prioritizedOpportunities: limited,
    };
  }

  private buildOpportunities(
    snapshot: GenomeCrossDomainSnapshotData | null,
    recommendations: GenomeRecommendationData[],
  ): GenomeCrossDomainOpportunityCandidate[] {
    const opportunities: GenomeCrossDomainOpportunityCandidate[] = [];
    if (!snapshot) return opportunities;

    const financeScore = domainScore(snapshot, 'finance');
    const financeRisk = domainRisk(snapshot, 'finance');
    const customerScore = domainScore(snapshot, 'customer_sales_revenue');
    const customerRisk = domainRisk(snapshot, 'customer_sales_revenue');
    const opsScore = domainScore(snapshot, 'operations_delivery');
    const opsRisk = domainRisk(snapshot, 'operations_delivery');
    const marketingScore = domainScore(snapshot, 'marketing_growth');
    const marketingRisk = domainRisk(snapshot, 'marketing_growth');

    const recsByDomain = this.groupRecommendationsByDomain(recommendations);

    if (
      financeScore >= 65 &&
      isHealthyEnough(financeRisk) &&
      isHealthyEnough(opsRisk) &&
      marketingScore >= 60 &&
      customerScore >= 60
    ) {
      opportunities.push({
        id: 'opp-scale-paid-acquisition',
        label: 'Scale paid acquisition across healthy domains',
        affectedDomains: [
          'finance',
          'customer_sales_revenue',
          'operations_delivery',
          'marketing_growth',
        ],
        requiredConditions: [
          'Finance health score >= 65',
          'Operations not constrained',
          'Marketing and customer/sales domains healthy',
        ],
        evidence: recsByDomain.marketing_growth.map((r) => r.title).slice(0, 3),
        potentialImpact: 'HIGH',
        confidence: 0.75,
        suggestedAction:
          'Increase paid-channel test budget while monitoring operations capacity and CAC payback.',
        estimatedValueScore: Math.round(
          (financeScore + marketingScore + customerScore + opsScore) / 4,
        ),
      });
    }

    if (financeScore >= 70 && isHealthyEnough(financeRisk)) {
      opportunities.push({
        id: 'opp-reinvest-cash',
        label: 'Reinvest healthy cash position',
        affectedDomains: ['finance', 'operations_delivery', 'marketing_growth'],
        requiredConditions: [
          'Finance health score >= 70',
          'Finance risk is LOW or MEDIUM',
        ],
        evidence: recsByDomain.finance.map((r) => r.title).slice(0, 3),
        potentialImpact: 'MEDIUM',
        confidence: 0.7,
        suggestedAction:
          'Allocate surplus cash to the highest-ranked growth or efficiency recommendation.',
        estimatedValueScore: financeScore,
      });
    }

    if (opsScore >= 70 && isHealthyEnough(opsRisk) && financeScore >= 50) {
      opportunities.push({
        id: 'opp-automate-delivery',
        label: 'Automate documented delivery processes',
        affectedDomains: ['operations_delivery', 'finance'],
        requiredConditions: [
          'Operations readiness >= 70',
          'Operations risk is LOW or MEDIUM',
          'Finance baseline is stable',
        ],
        evidence: recsByDomain.operations_delivery.map((r) => r.title).slice(0, 3),
        potentialImpact: 'MEDIUM',
        confidence: 0.65,
        suggestedAction:
          'Introduce automation for mature processes and measure cost-per-task improvement.',
        estimatedValueScore: opsScore,
      });
    }

    if (marketingScore >= 70 && financeScore >= 60 && isHealthyEnough(opsRisk)) {
      opportunities.push({
        id: 'opp-increase-channel-investment',
        label: 'Increase channel investment',
        affectedDomains: ['marketing_growth', 'finance', 'operations_delivery'],
        requiredConditions: [
          'Marketing health >= 70',
          'Finance health >= 60',
          'Operations capacity not constrained',
        ],
        evidence: recsByDomain.marketing_growth.map((r) => r.title).slice(0, 3),
        potentialImpact: 'MEDIUM',
        confidence: 0.65,
        suggestedAction:
          'Expand budget on best-performing channels and track incremental LTV/CAC.',
        estimatedValueScore: Math.round((marketingScore + financeScore) / 2),
      });
    }

    if (customerScore >= 65 && marketingScore >= 60) {
      opportunities.push({
        id: 'opp-ltv-campaign',
        label: 'Launch high-LTV customer campaign',
        affectedDomains: ['customer_sales_revenue', 'marketing_growth'],
        requiredConditions: [
          'Customer/sales health >= 65',
          'Marketing health >= 60',
        ],
        evidence: recsByDomain.customer_sales_revenue.map((r) => r.title).slice(0, 3),
        potentialImpact: 'HIGH',
        confidence: 0.7,
        suggestedAction:
          'Create targeted campaigns for the highest-value customer segments.',
        estimatedValueScore: Math.round((customerScore + marketingScore) / 2),
      });
    }

    return opportunities;
  }

  private buildRiskMitigationOpportunities(
    snapshot: GenomeCrossDomainSnapshotData | null,
    recommendations: GenomeRecommendationData[],
  ): GenomeCrossDomainOpportunityCandidate[] {
    const opportunities: GenomeCrossDomainOpportunityCandidate[] = [];
    if (!snapshot) return opportunities;

    const recsByDomain = this.groupRecommendationsByDomain(recommendations);

    if (domainRisk(snapshot, 'finance') === 'HIGH' || domainRisk(snapshot, 'finance') === 'CRITICAL') {
      opportunities.push({
        id: 'opp-strengthen-finance-controls',
        label: 'Strengthen finance controls before scaling',
        affectedDomains: ['finance', 'operations_delivery'],
        requiredConditions: [
          'Finance risk is HIGH or CRITICAL',
          'Active finance recommendations exist',
        ],
        evidence: recsByDomain.finance.map((r) => r.title).slice(0, 3),
        potentialImpact: 'HIGH',
        confidence: 0.6,
        suggestedAction:
          'Resolve top finance warnings and validate cash/runway assumptions before new spend.',
        estimatedValueScore: 100 - domainScore(snapshot, 'finance'),
      });
    }

    if (domainRisk(snapshot, 'operations_delivery') === 'HIGH' || domainRisk(snapshot, 'operations_delivery') === 'CRITICAL') {
      opportunities.push({
        id: 'opp-relieve-operations-bottleneck',
        label: 'Relieve operations bottleneck',
        affectedDomains: ['operations_delivery', 'customer_sales_revenue', 'marketing_growth'],
        requiredConditions: [
          'Operations risk is HIGH or CRITICAL',
        ],
        evidence: recsByDomain.operations_delivery.map((r) => r.title).slice(0, 3),
        potentialImpact: 'HIGH',
        confidence: 0.6,
        suggestedAction:
          'Prioritize capacity or process improvements before pushing more leads or sales.',
        estimatedValueScore: 100 - domainScore(snapshot, 'operations_delivery'),
      });
    }

    return opportunities;
  }

  private groupRecommendationsByDomain(
    recommendations: GenomeRecommendationData[],
  ): Record<GenomeCrossDomainDomainKey, GenomeRecommendationData[]> {
    const groups: Record<GenomeCrossDomainDomainKey, GenomeRecommendationData[]> = {
      finance: [],
      customer_sales_revenue: [],
      operations_delivery: [],
      marketing_growth: [],
    };

    for (const rec of recommendations) {
      const d = rec.domain.toUpperCase();
      if (d.includes('FINANCE')) groups.finance.push(rec);
      else if (d.includes('CUSTOMER') || d.includes('SALES') || d.includes('REVENUE'))
        groups.customer_sales_revenue.push(rec);
      else if (d.includes('OPERATION')) groups.operations_delivery.push(rec);
      else if (d.includes('MARKET')) groups.marketing_growth.push(rec);
    }

    return groups;
  }

  private prioritizeOpportunities(
    opportunities: GenomeCrossDomainOpportunityCandidate[],
    minPotentialImpact?: 'LOW' | 'MEDIUM' | 'HIGH',
  ): GenomeCrossDomainOpportunityCandidate[] {
    const impactRank: Record<'LOW' | 'MEDIUM' | 'HIGH', number> = {
      LOW: 1,
      MEDIUM: 2,
      HIGH: 3,
    };

    let filtered = opportunities;
    if (minPotentialImpact) {
      filtered = opportunities.filter(
        (o) => impactRank[o.potentialImpact] >= impactRank[minPotentialImpact],
      );
    }

    return [...filtered].sort((a, b) => {
      const impactDiff =
        impactRank[b.potentialImpact] - impactRank[a.potentialImpact];
      if (impactDiff !== 0) return impactDiff;
      return b.estimatedValueScore - a.estimatedValueScore;
    });
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
