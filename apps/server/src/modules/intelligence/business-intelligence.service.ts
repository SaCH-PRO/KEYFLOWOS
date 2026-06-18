import { Inject, Injectable, Logger } from '@nestjs/common';
import { BlueprintService } from '../blueprint/blueprint.service';
import { TemporalFlowService } from '../temporal-flow/temporal-flow.service';
import { GenomeEvolutionService } from '../business-genome/genome-evolution.service';
import { BusinessAssetsService } from '../business-assets/business-assets.service';
import type {
  BusinessExecutiveBrief,
  BusinessIntelligenceInsight,
  IntelligenceDomain,
  IntelligencePriority,
} from './business-intelligence.types';

@Injectable()
export class BusinessIntelligenceService {
  private readonly logger = new Logger(BusinessIntelligenceService.name);

  constructor(
    @Inject(BlueprintService) private readonly blueprint: BlueprintService,
    @Inject(TemporalFlowService) private readonly temporal: TemporalFlowService,
    @Inject(GenomeEvolutionService) private readonly genomeEvolution: GenomeEvolutionService,
    @Inject(BusinessAssetsService) private readonly businessAssets: BusinessAssetsService,
  ) {}

  async generateExecutiveBrief(businessId: string): Promise<BusinessExecutiveBrief> {
    const [blueprint, proposals, temporalAnalysis, assets] = await Promise.all([
      this.blueprint.getBlueprint(businessId),
      this.genomeEvolution.list(businessId, { status: 'PENDING' }),
      this.temporal.analyze(businessId),
      this.businessAssets.list(businessId),
    ]);

    const genomeIntegrity = blueprint.genomeIntegrity ?? 0;
    const executiveReadinessScore = blueprint.executiveReadinessScore ?? 0;
    const genomeStage = blueprint.genomeStage ?? 'CONCEPT';
    const dnaScores = blueprint.genomeDnaScores ?? {};

    const insights: BusinessIntelligenceInsight[] = [];

    insights.push(this.buildReadinessInsight(executiveReadinessScore));
    insights.push(this.buildIntegrityInsight(genomeIntegrity));

    for (const [section, score] of Object.entries(dnaScores)) {
      if (typeof score === 'number' && score < 50) {
        insights.push({
          id: `genome-gap-${section}`,
          domain: 'GENOME',
          priority: score < 30 ? 'HIGH' : 'MEDIUM',
          title: `${this.titleCase(section)} DNA section is underdeveloped`,
          finding: `The ${section} section scores ${score}%, which limits how well KEY can reason about this area of the business.`,
          evidence: [`${section} integrity: ${score}%`],
          confidence: 0.9,
          recommendedAction: {
            label: 'Open Business Genome',
            actionType: 'OPEN_GENOME',
            href: `/app/profile?tab=business-genome&section=dna-sections`,
          },
        });
      }
    }

    if (proposals.length > 0) {
      insights.push({
        id: 'pending-evolution-proposals',
        domain: 'GENOME',
        priority: proposals.length > 3 ? 'HIGH' : 'MEDIUM',
        title: `${proposals.length} pending Genome Evolution proposal${proposals.length === 1 ? '' : 's'}`,
        finding: 'Temporal Flow generated proposal(s) that can improve the Business Genome once reviewed.',
        evidence: proposals.map((p) => `${p.section}: ${p.reason}`),
        confidence: Math.max(0.5, Math.min(0.95, 0.5 + proposals.length * 0.05)),
        recommendedAction: {
          label: 'Review proposals',
          actionType: 'REVIEW_EVOLUTION_PROPOSALS',
          href: `/app/profile?tab=business-genome&section=evolution-proposals`,
        },
      });
    }

    const now = Date.now();
    const riskyAssets = assets
      .filter((a) => a.expiresAt)
      .map((a) => ({
        asset: a,
        days: Math.ceil((new Date(a.expiresAt!).getTime() - now) / (1000 * 60 * 60 * 24)),
      }))
      .filter((item) => item.days <= 30);

    if (riskyAssets.length > 0) {
      const expired = riskyAssets.filter((item) => item.days < 0);
      const expiringSoon = riskyAssets.filter((item) => item.days >= 0);
      let priority: IntelligencePriority = 'MEDIUM';
      if (expired.length > 0) priority = 'CRITICAL';
      else if (expiringSoon.some((item) => item.days <= 7)) priority = 'HIGH';

      insights.push({
        id: 'asset-expiry-risk',
        domain: 'ASSETS',
        priority,
        title: expired.length > 0 ? `${expired.length} asset(s) expired` : `${expiringSoon.length} asset(s) expiring within 30 days`,
        finding: 'Business assets with expiry dates require renewal or replacement to avoid operational/legal interruption.',
        evidence: riskyAssets.slice(0, 5).map((item) => `${item.asset.name} expires in ${item.days} day(s)`),
        confidence: 0.95,
        recommendedAction: {
          label: 'Review assets',
          actionType: 'REVIEW_ASSETS',
          href: `/app/profile?tab=business-genome&section=assets`,
        },
      });
    }

    for (const item of temporalAnalysis.urgentItems ?? []) {
      insights.push({
        id: `temporal-urgent-${this.slug(item.title)}`,
        domain: 'TEMPORAL_FLOW',
        priority: 'HIGH',
        title: item.title,
        finding: item.reason ?? item.title,
        evidence: item.reason ? [item.reason] : [],
        confidence: 0.85,
        recommendedAction: {
          label: 'View Temporal Flow',
          actionType: 'OPEN_TEMPORAL_FLOW',
          href: item.eventId ? `/app/temporal-flow?eventId=${item.eventId}` : '/app/temporal-flow',
        },
      });
    }

    for (const risk of temporalAnalysis.risks ?? []) {
      insights.push({
        id: `temporal-risk-${this.slug(risk.title)}`,
        domain: 'RISK',
        priority: this.mapSeverity(risk.severity),
        title: risk.title,
        finding: risk.title,
        evidence: risk.evidence,
        confidence: 0.8,
        recommendedAction: {
          label: 'View Temporal Flow',
          actionType: 'OPEN_TEMPORAL_FLOW',
          href: '/app/temporal-flow',
        },
      });
    }

    for (const opp of temporalAnalysis.opportunities ?? []) {
      insights.push({
        id: `temporal-opportunity-${this.slug(opp.title)}`,
        domain: 'OPERATIONS',
        priority: 'MEDIUM',
        title: opp.title,
        finding: opp.title,
        evidence: opp.evidence,
        confidence: 0.75,
        recommendedAction: {
          label: 'View Temporal Flow',
          actionType: 'OPEN_TEMPORAL_FLOW',
          href: '/app/temporal-flow',
        },
      });
    }

    const sorted = insights.sort((a, b) => {
      const rankDiff = this.priorityRank(b.priority) - this.priorityRank(a.priority);
      if (rankDiff !== 0) return rankDiff;
      return b.confidence - a.confidence;
    });

    const topPriorities = sorted.slice(0, 5);

    return {
      businessId,
      generatedAt: new Date().toISOString(),
      summary: this.buildSummary({
        readiness: executiveReadinessScore,
        integrity: genomeIntegrity,
        highPriorityCount: insights.filter((i) => i.priority === 'HIGH' || i.priority === 'CRITICAL').length,
        proposalCount: proposals.length,
        riskCount: insights.filter((i) => i.domain === 'RISK' || i.domain === 'ASSETS').length,
      }),
      genomeIntegrity,
      executiveReadinessScore,
      genomeStage,
      insights: sorted,
      topPriorities,
    };
  }

  private buildReadinessInsight(readiness: number): BusinessIntelligenceInsight {
    const priority: IntelligencePriority = readiness < 30 ? 'CRITICAL' : readiness < 50 ? 'HIGH' : readiness < 70 ? 'MEDIUM' : 'LOW';
    return {
      id: 'executive-readiness',
      domain: 'EXECUTIVE',
      priority,
      title: `Executive Readiness is ${readiness}%`,
      finding:
        readiness < 50
          ? 'The Business Genome is not yet ready for autonomous executive operations. More DNA context is needed.'
          : readiness < 75
            ? 'The business has moderate executive readiness; several DNA sections still need attention.'
            : 'Executive readiness is strong. KEY can operate with high confidence.',
      evidence: [`Executive Readiness Score: ${readiness}%`],
      confidence: 0.95,
      recommendedAction: {
        label: 'Open Business Genome',
        actionType: 'OPEN_GENOME',
        href: '/app/profile?tab=business-genome',
      },
    };
  }

  private buildIntegrityInsight(integrity: number): BusinessIntelligenceInsight {
    const priority: IntelligencePriority = integrity < 30 ? 'CRITICAL' : integrity < 50 ? 'HIGH' : integrity < 70 ? 'MEDIUM' : 'LOW';
    return {
      id: 'genome-integrity',
      domain: 'GENOME',
      priority,
      title: `Genome Integrity is ${integrity}%`,
      finding:
        integrity < 50
          ? 'The Business Genome has significant gaps that limit decision quality.'
          : integrity < 75
            ? 'The Business Genome is partially complete; completing remaining sections will improve intelligence.'
            : 'The Business Genome is well-formed and supports reliable analysis.',
      evidence: [`Genome Integrity: ${integrity}%`],
      confidence: 0.95,
      recommendedAction: {
        label: 'Open Business Genome',
        actionType: 'OPEN_GENOME',
        href: '/app/profile?tab=business-genome&section=dna-sections',
      },
    };
  }

  private mapSeverity(severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'): IntelligencePriority {
    switch (severity) {
      case 'CRITICAL':
        return 'CRITICAL';
      case 'HIGH':
        return 'HIGH';
      case 'LOW':
        return 'LOW';
      default:
        return 'MEDIUM';
    }
  }

  private priorityRank(priority: IntelligencePriority): number {
    switch (priority) {
      case 'CRITICAL':
        return 4;
      case 'HIGH':
        return 3;
      case 'MEDIUM':
        return 2;
      case 'LOW':
        return 1;
    }
  }

  private buildSummary(input: {
    readiness: number;
    integrity: number;
    highPriorityCount: number;
    proposalCount: number;
    riskCount: number;
  }): string {
    const parts: string[] = [];
    if (input.highPriorityCount > 0) {
      parts.push(`${input.highPriorityCount} high-priority issue${input.highPriorityCount === 1 ? '' : 's'} need${input.highPriorityCount === 1 ? 's' : ''} attention.`);
    }
    if (input.proposalCount > 0) {
      parts.push(`${input.proposalCount} Genome Evolution proposal${input.proposalCount === 1 ? '' : 's'} pending review.`);
    }
    if (input.riskCount > 0) {
      parts.push(`${input.riskCount} operational or asset risk${input.riskCount === 1 ? '' : 's'} detected.`);
    }
    if (input.readiness < 50) {
      parts.push('Executive Readiness is low; completing the Business Genome is the top priority.');
    }
    if (parts.length === 0) {
      parts.push('Business health is stable. Continue monitoring Temporal Flow and Genome Evolution proposals.');
    }
    return `Executive Readiness ${input.readiness}%, Genome Integrity ${input.integrity}%. ${parts.join(' ')}`;
  }

  private titleCase(value: string): string {
    return value
      .replace(/([A-Z])/g, ' $1')
      .replace(/_/g, ' ')
      .trim()
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  private slug(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40);
  }
}
