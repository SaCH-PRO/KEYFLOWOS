import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { GenomeMemoryService } from './genome-memory.service';
import type {
  GenomeExperimentData,
  GenomeLearningSummary,
  GenomeMemoryEventData,
  GenomeOutcome,
  GenomeRecommendationData,
  GenomeSignalData,
  RecommendationOutcome,
} from './key-genome.types';

@Injectable()
export class OutcomeLearningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly memory: GenomeMemoryService,
  ) {}

  async recordRecommendationAccepted(
    businessId: string,
    rec: GenomeRecommendationData,
  ): Promise<GenomeMemoryEventData> {
    return this.memory.createMemoryEvent({
      businessId,
      sourceType: 'GENOME_RECOMMENDATION',
      sourceEntityId: rec.id,
      eventType: 'RECOMMENDATION_ACCEPTED',
      domain: rec.domain,
      title: `Recommendation accepted: ${rec.title}`,
      summary: rec.insight,
      outcome: 'UNKNOWN',
      impactScore: 0.5,
      confidenceDelta: 0,
      metadata: {
        expectedGainScore: rec.expectedGainScore,
        riskLevel: rec.riskLevel,
      },
    });
  }

  async recordRecommendationDismissed(
    businessId: string,
    rec: GenomeRecommendationData,
  ): Promise<GenomeMemoryEventData> {
    return this.memory.createMemoryEvent({
      businessId,
      sourceType: 'GENOME_RECOMMENDATION',
      sourceEntityId: rec.id,
      eventType: 'RECOMMENDATION_DISMISSED',
      domain: rec.domain,
      title: `Recommendation dismissed: ${rec.title}`,
      summary: rec.insight,
      outcome: 'UNKNOWN',
      impactScore: 0.25,
      confidenceDelta: -0.02,
      metadata: {
        expectedGainScore: rec.expectedGainScore,
        riskLevel: rec.riskLevel,
      },
    });
  }

  async recordRecommendationApplied(
    businessId: string,
    rec: GenomeRecommendationData,
  ): Promise<GenomeMemoryEventData> {
    return this.memory.createMemoryEvent({
      businessId,
      sourceType: 'GENOME_RECOMMENDATION',
      sourceEntityId: rec.id,
      eventType: 'RECOMMENDATION_APPLIED',
      domain: rec.domain,
      title: `Recommendation applied: ${rec.title}`,
      summary: rec.recommendation,
      outcome: 'UNKNOWN',
      impactScore: 0.5,
      confidenceDelta: 0,
      metadata: {
        expectedGainScore: rec.expectedGainScore,
        riskLevel: rec.riskLevel,
      },
    });
  }

  async recordRecommendationOutcome(
    businessId: string,
    rec: GenomeRecommendationData,
    outcome: RecommendationOutcome,
  ): Promise<GenomeMemoryEventData> {
    const interpretation = this.interpretRecommendationOutcome(outcome);

    return this.memory.createMemoryEvent({
      businessId,
      sourceType: 'GENOME_RECOMMENDATION',
      sourceEntityId: rec.id,
      eventType: 'RECOMMENDATION_OUTCOME_TRACKED',
      domain: rec.domain,
      title: `Recommendation outcome: ${rec.title}`,
      summary: outcome.notes ?? `Outcome recorded for ${rec.title}`,
      outcome: interpretation.outcome,
      impactScore: interpretation.impactScore,
      confidenceDelta: interpretation.confidenceDelta,
      lessons: interpretation.lessons,
      metadata: {
        measuredValue: outcome.measuredValue,
        expectedGainScore: rec.expectedGainScore,
        riskLevel: rec.riskLevel,
      },
    });
  }

  async recordExperimentStarted(
    businessId: string,
    exp: GenomeExperimentData,
  ): Promise<GenomeMemoryEventData> {
    return this.memory.createMemoryEvent({
      businessId,
      sourceType: 'GENOME_EXPERIMENT',
      sourceEntityId: exp.id,
      eventType: 'EXPERIMENT_STARTED',
      domain: 'experiment',
      title: `Experiment started: ${exp.hypothesis}`,
      summary: exp.action,
      outcome: 'UNKNOWN',
      impactScore: 0.5,
      confidenceDelta: 0,
      metadata: {
        durationDays: exp.durationDays,
        riskLevel: exp.riskLevel,
      },
    });
  }

  async recordExperimentCompleted(
    businessId: string,
    exp: GenomeExperimentData,
    outcome?: RecommendationOutcome,
  ): Promise<GenomeMemoryEventData> {
    const interpretation = this.interpretExperimentResult('COMPLETED', outcome);

    return this.memory.createMemoryEvent({
      businessId,
      sourceType: 'GENOME_EXPERIMENT',
      sourceEntityId: exp.id,
      eventType: 'EXPERIMENT_COMPLETED',
      domain: 'experiment',
      title: `Experiment completed: ${exp.hypothesis}`,
      summary: outcome?.notes ?? exp.action,
      outcome: interpretation.outcome,
      impactScore: interpretation.impactScore,
      confidenceDelta: interpretation.confidenceDelta,
      lessons: interpretation.lessons,
      metadata: {
        durationDays: exp.durationDays,
        measuredValue: outcome?.measuredValue,
        riskLevel: exp.riskLevel,
      },
    });
  }

  async recordExperimentFailed(
    businessId: string,
    exp: GenomeExperimentData,
    outcome?: RecommendationOutcome,
  ): Promise<GenomeMemoryEventData> {
    const interpretation = this.interpretExperimentResult('FAILED', outcome);

    return this.memory.createMemoryEvent({
      businessId,
      sourceType: 'GENOME_EXPERIMENT',
      sourceEntityId: exp.id,
      eventType: 'EXPERIMENT_FAILED',
      domain: 'experiment',
      title: `Experiment failed: ${exp.hypothesis}`,
      summary: outcome?.notes ?? exp.action,
      outcome: interpretation.outcome,
      impactScore: interpretation.impactScore,
      confidenceDelta: interpretation.confidenceDelta,
      lessons: interpretation.lessons,
      metadata: {
        durationDays: exp.durationDays,
        measuredValue: outcome?.measuredValue,
        riskLevel: exp.riskLevel,
      },
    });
  }

  async recordExperimentCancelled(
    businessId: string,
    exp: GenomeExperimentData,
  ): Promise<GenomeMemoryEventData> {
    return this.memory.createMemoryEvent({
      businessId,
      sourceType: 'GENOME_EXPERIMENT',
      sourceEntityId: exp.id,
      eventType: 'EXPERIMENT_CANCELLED',
      domain: 'experiment',
      title: `Experiment cancelled: ${exp.hypothesis}`,
      summary: exp.action,
      outcome: 'UNKNOWN',
      impactScore: 0.25,
      confidenceDelta: -0.05,
      lessons: [
        {
          lesson: 'Experiments cancelled before completion reduce learning velocity.',
        },
      ],
      metadata: {
        durationDays: exp.durationDays,
        riskLevel: exp.riskLevel,
      },
    });
  }

  async recordSignalReviewed(
    businessId: string,
    signal: GenomeSignalData,
  ): Promise<GenomeMemoryEventData> {
    return this.memory.createMemoryEvent({
      businessId,
      sourceType: 'GENOME_SIGNAL',
      sourceEntityId: signal.id,
      eventType: 'SIGNAL_REVIEWED',
      domain: signal.domain,
      section: signal.section,
      title: `Signal reviewed: ${signal.signalType}`,
      summary: signal.reason,
      outcome: 'UNKNOWN',
      impactScore: 0.5,
      confidenceDelta: 0,
      metadata: {
        signalType: signal.signalType,
        confidence: signal.confidence,
      },
    });
  }

  async recordSignalAccepted(
    businessId: string,
    signal: GenomeSignalData,
  ): Promise<GenomeMemoryEventData> {
    return this.memory.createMemoryEvent({
      businessId,
      sourceType: 'GENOME_SIGNAL',
      sourceEntityId: signal.id,
      eventType: 'SIGNAL_ACCEPTED',
      domain: signal.domain,
      section: signal.section,
      title: `Signal accepted: ${signal.signalType}`,
      summary: signal.reason,
      outcome: 'UNKNOWN',
      impactScore: 0.5,
      confidenceDelta: 0.05,
      lessons: [
        {
          lesson: `Accepted ${signal.signalType} signals in ${signal.domain} are treated as credible evidence.`,
        },
      ],
      metadata: {
        signalType: signal.signalType,
        confidence: signal.confidence,
      },
    });
  }

  async recordSignalRejected(
    businessId: string,
    signal: GenomeSignalData,
  ): Promise<GenomeMemoryEventData> {
    return this.memory.createMemoryEvent({
      businessId,
      sourceType: 'GENOME_SIGNAL',
      sourceEntityId: signal.id,
      eventType: 'SIGNAL_REJECTED',
      domain: signal.domain,
      section: signal.section,
      title: `Signal rejected: ${signal.signalType}`,
      summary: signal.reason,
      outcome: 'UNKNOWN',
      impactScore: 0.25,
      confidenceDelta: -0.05,
      lessons: [
        {
          lesson: `Rejected ${signal.signalType} signals in ${signal.domain} lower confidence in similar future signals.`,
        },
      ],
      metadata: {
        signalType: signal.signalType,
        confidence: signal.confidence,
      },
    });
  }

  async recordSignalMerged(
    businessId: string,
    signal: GenomeSignalData,
  ): Promise<GenomeMemoryEventData> {
    return this.memory.createMemoryEvent({
      businessId,
      sourceType: 'GENOME_SIGNAL',
      sourceEntityId: signal.id,
      eventType: 'SIGNAL_MERGED',
      domain: signal.domain,
      section: signal.section,
      title: `Signal merged into Genome: ${signal.signalType}`,
      summary: signal.reason,
      outcome: 'SUCCESS',
      impactScore: 0.7,
      confidenceDelta: 0.1,
      lessons: [
        {
          lesson: `Merged ${signal.signalType} signals in ${signal.domain} into the Business Genome as verified insight.`,
        },
      ],
      metadata: {
        signalType: signal.signalType,
        confidence: signal.confidence,
      },
    });
  }

  async recordActionOutcome(
    businessId: string,
    proposalId: string,
    status: 'EXECUTED' | 'FAILED' | 'BLOCKED',
    executionResult?: Record<string, unknown> | null,
  ): Promise<GenomeMemoryEventData> {
    const row = await this.prisma.client.keyActionProposal.findFirst({
      where: { id: proposalId, businessId },
    });

    const title = row?.title ?? 'KEY action proposal';
    const actionType = row?.actionType ?? 'UNKNOWN';

    if (status === 'EXECUTED') {
      const success = executionResult && executionResult.success === true;
      return this.memory.createMemoryEvent({
        businessId,
        sourceType: 'KEY_ACTION_PROPOSAL',
        sourceEntityId: proposalId,
        eventType: 'ACTION_EXECUTED',
        title: `Action executed: ${title}`,
        summary: `KEY action ${actionType} was executed.`,
        outcome: success ? 'SUCCESS' : 'UNKNOWN',
        impactScore: success ? 0.75 : 0.5,
        confidenceDelta: success ? 0.1 : 0,
        lessons: [
          {
            lesson: success
              ? `Executed ${actionType} actions produced a successful result.`
              : `Executed ${actionType} actions completed without a clear success signal.`,
          },
        ],
        metadata: { actionType, executionResult },
      });
    }

    if (status === 'FAILED') {
      return this.memory.createMemoryEvent({
        businessId,
        sourceType: 'KEY_ACTION_PROPOSAL',
        sourceEntityId: proposalId,
        eventType: 'ACTION_BLOCKED',
        title: `Action failed: ${title}`,
        summary: `KEY action ${actionType} failed during execution.`,
        outcome: 'FAILURE',
        impactScore: 0.25,
        confidenceDelta: -0.1,
        lessons: [
          {
            lesson: `Failed ${actionType} actions indicate execution risk or readiness gaps.`,
          },
        ],
        metadata: { actionType, executionResult },
      });
    }

    return this.memory.createMemoryEvent({
      businessId,
      sourceType: 'KEY_ACTION_PROPOSAL',
      sourceEntityId: proposalId,
      eventType: 'ACTION_BLOCKED',
      title: `Action blocked: ${title}`,
      summary: `KEY action ${actionType} was blocked by Genome policy.`,
      outcome: 'UNKNOWN',
      impactScore: 0.25,
      confidenceDelta: -0.05,
      lessons: [
        {
          lesson: `Blocked ${actionType} actions often point to missing Genome facts or low readiness.`,
        },
      ],
      metadata: { actionType, executionResult },
    });
  }

  async computeLearningSummary(businessId: string): Promise<GenomeLearningSummary> {
    return this.memory.summarizeMemory(businessId);
  }

  async computeDomainMemoryConfidenceAdjustment(
    businessId: string,
    domain: string,
  ): Promise<number> {
    const similar = await this.memory.findSimilarMemory(businessId, {
      domain,
      limit: 50,
    });

    let adjustment = 0;
    for (const event of similar) {
      if (event.outcome === 'SUCCESS') adjustment += 0.05;
      if (event.outcome === 'FAILURE') adjustment -= 0.05;
      if (event.outcome === 'MIXED') adjustment += 0.02;
    }
    return Math.max(-0.2, Math.min(0.2, adjustment));
  }

  private interpretRecommendationOutcome(outcome: RecommendationOutcome): {
    outcome: GenomeOutcome;
    impactScore: number;
    confidenceDelta: number;
    lessons: Array<{ lesson: string; confidence?: number; appliesTo?: string[] }>;
  } {
    if (outcome.success === true) {
      const impactScore =
        outcome.measuredValue !== undefined ? this.normalizeMeasuredValue(outcome.measuredValue) : 0.75;
      return {
        outcome: 'SUCCESS',
        impactScore,
        confidenceDelta: 0.15,
        lessons: [
          {
            lesson: 'This recommendation pattern produced a positive outcome.',
            confidence: 0.8,
          },
        ],
      };
    }

    if (outcome.success === false) {
      const impactScore =
        outcome.measuredValue !== undefined ? this.normalizeMeasuredValue(outcome.measuredValue) : 0.25;
      return {
        outcome: 'FAILURE',
        impactScore,
        confidenceDelta: -0.15,
        lessons: [
          {
            lesson: 'This recommendation pattern underperformed.',
            confidence: 0.6,
          },
        ],
      };
    }

    return {
      outcome: 'UNKNOWN',
      impactScore: 0.5,
      confidenceDelta: 0,
      lessons: [
        {
          lesson: 'Outcome was tracked but not conclusive.',
        },
      ],
    };
  }

  private interpretExperimentResult(
    status: 'COMPLETED' | 'FAILED',
    outcome?: RecommendationOutcome,
  ): {
    outcome: GenomeOutcome;
    impactScore: number;
    confidenceDelta: number;
    lessons: Array<{ lesson: string; confidence?: number; appliesTo?: string[] }>;
  } {
    if (status === 'FAILED') {
      return {
        outcome: 'FAILURE',
        impactScore: 0.25,
        confidenceDelta: -0.15,
        lessons: [
          {
            lesson: 'The experiment failed to validate the hypothesis.',
          },
        ],
      };
    }

    if (outcome?.success === true) {
      return {
        outcome: 'SUCCESS',
        impactScore: outcome.measuredValue !== undefined ? this.normalizeMeasuredValue(outcome.measuredValue) : 0.75,
        confidenceDelta: 0.15,
        lessons: [
          {
            lesson: 'The experiment validated the hypothesis.',
          },
        ],
      };
    }

    if (outcome?.success === false) {
      return {
        outcome: 'MIXED',
        impactScore: outcome.measuredValue !== undefined ? this.normalizeMeasuredValue(outcome.measuredValue) : 0.4,
        confidenceDelta: -0.05,
        lessons: [
          {
            lesson: 'The experiment completed but did not produce a clear success.',
          },
        ],
      };
    }

    return {
      outcome: 'UNKNOWN',
      impactScore: 0.5,
      confidenceDelta: 0,
      lessons: [
        {
          lesson: 'Experiment completed without a recorded outcome.',
        },
      ],
    };
  }

  private normalizeMeasuredValue(value: number): number {
    if (value >= 0 && value <= 1) return value;
    if (value >= 0 && value <= 100) return value / 100;
    return Math.max(0, Math.min(1, value / 100));
  }
}
