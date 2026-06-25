import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { GenomeCrossDomainService } from './genome-cross-domain.service';
import type {
  CloseGenomeRecommendationObservationInput,
  GenomeRecommendationDecision,
  GenomeRecommendationExecutionStatus,
  GenomeRecommendationOutcomeData,
  GenomeRecommendationOutcomeSummary,
  GenomeOutcomeLearningWindowData,
  ListGenomeRecommendationOutcomesQuery,
  RecordGenomeRecommendationOutcomeInput,
  SetGenomeOutcomeLearningWindowInput,
  UpdateGenomeRecommendationOutcomeObservationInput,
} from './key-genome.types';

const DECISION_VALUES: GenomeRecommendationDecision[] = [
  'ACTIVE',
  'ACCEPTED',
  'DISMISSED',
  'APPLIED',
  'IGNORED',
  'ESCALATED',
];

function isValidDecision(value: string): value is GenomeRecommendationDecision {
  return DECISION_VALUES.includes(value as GenomeRecommendationDecision);
}

function toOutcomeData(row: {
  id: string;
  businessId: string;
  recommendationId: string;
  domain: string;
  actionType: string;
  decision: string;
  decidedBy: string | null;
  decidedAt: Date;
  dismissalReason: string | null;
  preHealthScore: number | null;
  preReadinessScore: number | null;
  preConfidence: number | null;
  preRiskLevel: string | null;
  postHealthScore: number | null;
  postReadinessScore: number | null;
  postConfidence: number | null;
  postRiskLevel: string | null;
  observedAt: Date | null;
  impactScore: number | null;
  impactEvidence: string[];
  linkedActionType: string | null;
  linkedActionId: string | null;
  createdAt: Date;
  updatedAt: Date;
}): GenomeRecommendationOutcomeData {
  return {
    id: row.id,
    businessId: row.businessId,
    recommendationId: row.recommendationId,
    domain: row.domain,
    actionType: row.actionType,
    decision: row.decision as GenomeRecommendationDecision,
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt.toISOString(),
    dismissalReason: row.dismissalReason,
    preHealthScore: row.preHealthScore,
    preReadinessScore: row.preReadinessScore,
    preConfidence: row.preConfidence,
    preRiskLevel: row.preRiskLevel,
    postHealthScore: row.postHealthScore,
    postReadinessScore: row.postReadinessScore,
    postConfidence: row.postConfidence,
    postRiskLevel: row.postRiskLevel,
    observedAt: row.observedAt ? row.observedAt.toISOString() : null,
    impactScore: row.impactScore,
    impactEvidence: row.impactEvidence,
    linkedActionType: row.linkedActionType,
    linkedActionId: row.linkedActionId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class GenomeRecommendationOutcomeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crossDomain: GenomeCrossDomainService,
  ) {}

  async recordOutcome(
    input: RecordGenomeRecommendationOutcomeInput,
  ): Promise<GenomeRecommendationOutcomeData> {
    if (!isValidDecision(input.decision)) {
      throw new Error(`Invalid recommendation decision: ${input.decision}`);
    }

    const recommendation = await this.prisma.client.genomeRecommendation.findFirst({
      where: { id: input.recommendationId, businessId: input.businessId },
    });

    if (!recommendation) {
      throw new NotFoundException(
        `Recommendation ${input.recommendationId} not found for business ${input.businessId}`,
      );
    }

    const existing = await this.prisma.client.genomeRecommendationOutcome.findFirst({
      where: {
        recommendationId: input.recommendationId,
        businessId: input.businessId,
      },
      orderBy: { decidedAt: 'desc' },
    });

    const row = await this.prisma.client.genomeRecommendationOutcome.upsert({
      where: { id: existing?.id ?? '' },
      create: {
        businessId: input.businessId,
        recommendationId: input.recommendationId,
        domain: recommendation.domain,
        actionType: recommendation.title,
        decision: input.decision,
        decidedBy: input.decidedBy ?? null,
        dismissalReason: input.dismissalReason ?? null,
        linkedActionType: input.linkedActionType ?? null,
        linkedActionId: input.linkedActionId ?? null,
      },
      update: {
        decision: input.decision,
        decidedBy: input.decidedBy ?? null,
        dismissalReason: input.dismissalReason ?? null,
        linkedActionType: input.linkedActionType ?? null,
        linkedActionId: input.linkedActionId ?? null,
        decidedAt: new Date(),
      },
    });

    await this.capturePreSnapshot(row.id, input.businessId, recommendation.domain).catch(() => null);

    const updated = await this.prisma.client.genomeRecommendationOutcome.findUniqueOrThrow({
      where: { id: row.id },
    });

    return toOutcomeData(updated);
  }

  async listOutcomes(
    businessId: string,
    query: ListGenomeRecommendationOutcomesQuery = {},
  ): Promise<GenomeRecommendationOutcomeData[]> {
    const rows = await this.prisma.client.genomeRecommendationOutcome.findMany({
      where: {
        businessId,
        ...(query.domain ? { domain: query.domain } : {}),
        ...(query.decision ? { decision: query.decision } : {}),
        ...(query.recommendationId ? { recommendationId: query.recommendationId } : {}),
      },
      orderBy: { decidedAt: 'desc' },
      take: query.limit,
      skip: query.offset,
    });

    return rows.map(toOutcomeData);
  }

  async getOutcomeByRecommendation(
    businessId: string,
    recommendationId: string,
  ): Promise<GenomeRecommendationOutcomeData | null> {
    const row = await this.prisma.client.genomeRecommendationOutcome.findFirst({
      where: { businessId, recommendationId },
      orderBy: { decidedAt: 'desc' },
    });

    return row ? toOutcomeData(row) : null;
  }

  async updateObservation(
    input: UpdateGenomeRecommendationOutcomeObservationInput,
  ): Promise<GenomeRecommendationOutcomeData> {
    const row = await this.prisma.client.genomeRecommendationOutcome.findFirst({
      where: { id: input.outcomeId, businessId: input.businessId },
    });

    if (!row) {
      throw new NotFoundException(
        `Outcome ${input.outcomeId} not found for business ${input.businessId}`,
      );
    }

    const updated = await this.prisma.client.genomeRecommendationOutcome.update({
      where: { id: input.outcomeId },
      data: {
        postHealthScore: input.postHealthScore ?? null,
        postReadinessScore: input.postReadinessScore ?? null,
        postConfidence: input.postConfidence ?? null,
        postRiskLevel: input.postRiskLevel ?? null,
        impactScore: input.impactScore ?? null,
        impactEvidence: input.impactEvidence ?? [],
        observedAt: input.observedAt ? new Date(input.observedAt) : new Date(),
      },
    });

    return toOutcomeData(updated);
  }

  async getSummary(businessId: string): Promise<GenomeRecommendationOutcomeSummary> {
    const outcomes = await this.prisma.client.genomeRecommendationOutcome.findMany({
      where: { businessId },
    });

    let accepted = 0;
    let dismissed = 0;
    let applied = 0;
    let ignored = 0;
    let escalated = 0;
    let positive = 0;
    let negative = 0;
    let awaitingObservation = 0;

    for (const o of outcomes) {
      if (o.decision === 'ACCEPTED') accepted++;
      if (o.decision === 'DISMISSED') dismissed++;
      if (o.decision === 'APPLIED') applied++;
      if (o.decision === 'IGNORED') ignored++;
      if (o.decision === 'ESCALATED') escalated++;

      if (o.decision === 'APPLIED' || o.decision === 'ACCEPTED') {
        if (o.observedAt) {
          if ((o.impactScore ?? 0) > 0) positive++;
          if ((o.impactScore ?? 0) < 0) negative++;
        } else {
          awaitingObservation++;
        }
      }
    }

    const decided = accepted + applied + dismissed + ignored + escalated;
    const winRate = decided > 0 ? positive / decided : 0;
    const executionRate = accepted + applied > 0 ? applied / (accepted + applied) : 0;

    return {
      businessId,
      total: outcomes.length,
      accepted,
      dismissed,
      applied,
      ignored,
      escalated,
      awaitingObservation,
      winRate,
      executionRate,
    };
  }

  async getLearningWindow(
    businessId: string,
    domain: string,
  ): Promise<GenomeOutcomeLearningWindowData> {
    const row = await this.prisma.client.genomeOutcomeLearningWindow.upsert({
      where: { businessId_domain: { businessId, domain } },
      create: { businessId, domain, windowDays: 14 },
      update: {},
    });

    return {
      id: row.id,
      businessId: row.businessId,
      domain: row.domain,
      windowDays: row.windowDays,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async setLearningWindow(
    input: SetGenomeOutcomeLearningWindowInput,
  ): Promise<GenomeOutcomeLearningWindowData> {
    const row = await this.prisma.client.genomeOutcomeLearningWindow.upsert({
      where: { businessId_domain: { businessId: input.businessId, domain: input.domain } },
      create: { businessId: input.businessId, domain: input.domain, windowDays: input.windowDays },
      update: { windowDays: input.windowDays },
    });

    return {
      id: row.id,
      businessId: row.businessId,
      domain: row.domain,
      windowDays: row.windowDays,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private async capturePreSnapshot(
    outcomeId: string,
    businessId: string,
    domain: string,
  ): Promise<void> {
    const outcome = await this.prisma.client.genomeRecommendationOutcome.findUnique({
      where: { id: outcomeId },
    });
    if (!outcome || outcome.preHealthScore !== null) return;

    const snapshot = await this.crossDomain
      .getLatestCrossDomainSnapshot(businessId)
      .catch(() => null);
    if (!snapshot) return;

    const domainScore = snapshot.domainScores.find((d) => d.domain === domain);
    const healthScore = domainScore?.healthScore ?? snapshot.overallHealthScore;
    const readinessScore = snapshot.readinessSummary.averageReadinessScore;
    const confidenceScore =
      snapshot.evidenceSummary.totalFacts > 0
        ? Math.round(
            (snapshot.evidenceSummary.highConfidenceFacts /
              snapshot.evidenceSummary.totalFacts) *
              100,
          )
        : 0;

    await this.prisma.client.genomeRecommendationOutcome.update({
      where: { id: outcomeId },
      data: {
        preHealthScore: healthScore,
        preReadinessScore: readinessScore,
        preConfidence: confidenceScore,
        preRiskLevel: snapshot.overallRiskLevel,
      },
    });
  }

  async closeObservationWindow(
    input: CloseGenomeRecommendationObservationInput,
  ): Promise<GenomeRecommendationOutcomeData> {
    const outcome = await this.prisma.client.genomeRecommendationOutcome.findFirst({
      where: { id: input.outcomeId, businessId: input.businessId },
    });

    if (!outcome) {
      throw new NotFoundException(
        `Outcome ${input.outcomeId} not found for business ${input.businessId}`,
      );
    }

    const snapshot = await this.crossDomain.computeCrossDomainSnapshot(input.businessId).catch(() => null);
    if (!snapshot) {
      throw new Error(`Unable to compute cross-domain snapshot for business ${input.businessId}`);
    }

    const domainScore = snapshot.domainScores.find((d) => d.domain === outcome.domain);
    const postHealthScore = domainScore?.healthScore ?? snapshot.overallHealthScore;
    const postReadinessScore = snapshot.readinessSummary.averageReadinessScore;
    const postConfidence =
      snapshot.evidenceSummary.totalFacts > 0
        ? Math.round(
            (snapshot.evidenceSummary.highConfidenceFacts /
              snapshot.evidenceSummary.totalFacts) *
              100,
          )
        : 0;

    const impactScore = this.computeImpactScore(
      {
        healthScore: outcome.preHealthScore ?? postHealthScore,
        readinessScore: outcome.preReadinessScore ?? postReadinessScore,
        confidence: outcome.preConfidence ?? postConfidence,
        riskLevel: outcome.preRiskLevel ?? snapshot.overallRiskLevel,
      },
      {
        healthScore: postHealthScore,
        readinessScore: postReadinessScore,
        confidence: postConfidence,
        riskLevel: snapshot.overallRiskLevel,
      },
    );

    const evidence: string[] = [];
    if (impactScore > 0) evidence.push('Cross-domain health/readiness/confidence improved.');
    if (impactScore < 0) evidence.push('Cross-domain health/readiness/confidence declined.');
    if (impactScore === 0) evidence.push('No measurable cross-domain change.');

    const updated = await this.prisma.client.genomeRecommendationOutcome.update({
      where: { id: input.outcomeId },
      data: {
        postHealthScore,
        postReadinessScore,
        postConfidence,
        postRiskLevel: snapshot.overallRiskLevel,
        observedAt: new Date(),
        impactScore,
        impactEvidence: evidence,
      },
    });

    return toOutcomeData(updated);
  }

  private computeImpactScore(
    before: {
      healthScore: number;
      readinessScore: number;
      confidence: number;
      riskLevel: string;
    },
    after: {
      healthScore: number;
      readinessScore: number;
      confidence: number;
      riskLevel: string;
    },
  ): number {
    const healthDelta = after.healthScore - before.healthScore;
    const readinessDelta = after.readinessScore - before.readinessScore;
    const confidenceDelta = after.confidence - before.confidence;

    const riskRank: Record<string, number> = {
      LOW: 1,
      MEDIUM: 2,
      HIGH: 3,
      CRITICAL: 4,
      UNKNOWN: 0,
    };
    const riskDelta =
      (riskRank[before.riskLevel] ?? 0) - (riskRank[after.riskLevel] ?? 0);

    const raw =
      healthDelta * 0.35 +
      readinessDelta * 0.35 +
      confidenceDelta * 0.2 +
      riskDelta * 10;

    // Normalize to [-1, 1] assuming max plausible swing is ±50 points
    return Math.max(-1, Math.min(1, raw / 50));
  }

  async getExecutionStatus(
    businessId: string,
    recommendationId: string,
  ): Promise<GenomeRecommendationExecutionStatus | null> {
    const outcome = await this.prisma.client.genomeRecommendationOutcome.findFirst({
      where: { businessId, recommendationId },
      orderBy: { decidedAt: 'desc' },
    });

    if (!outcome) return null;

    const { linkedActionType, linkedActionId } = outcome;
    if (!linkedActionType || !linkedActionId) {
      return {
        recommendationId,
        linkedActionType: null,
        linkedActionId: null,
        status: outcome.decision,
        checkedAt: new Date().toISOString(),
      };
    }

    let status = 'UNKNOWN';
    let executedAt: string | null = null;
    let executedBy: string | null = null;
    let executionResult: string | null = null;
    let failureReason: string | null = null;

    if (linkedActionType === 'key_action_proposal') {
      const proposal = await this.prisma.client.keyActionProposal.findFirst({
        where: { id: linkedActionId, businessId },
      });
      if (proposal) {
        status = proposal.status;
        executedAt = proposal.executedAt?.toISOString() ?? null;
        executedBy = proposal.executedBy ?? null;
        executionResult = proposal.executionResult ? JSON.stringify(proposal.executionResult) : null;
        failureReason = proposal.failureReason ?? null;
      }
    } else if (linkedActionType === 'genome_experiment') {
      const experiment = await this.prisma.client.genomeExperiment.findFirst({
        where: { id: linkedActionId, businessId },
      });
      if (experiment) {
        status = experiment.status;
        executedAt = experiment.endedAt?.toISOString() ?? null;
        executionResult = experiment.result ? JSON.stringify(experiment.result) : null;
      }
    }

    return {
      recommendationId,
      linkedActionType,
      linkedActionId,
      status,
      executedAt,
      executedBy,
      executionResult,
      failureReason,
      checkedAt: new Date().toISOString(),
    };
  }
}
