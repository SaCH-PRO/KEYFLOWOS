import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { GenomeSignalService } from './genome-signal.service';
import { GenomeModuleReadinessService } from './genome-module-readiness.service';
import { GenomeScoringService } from './genome-scoring.service';
import { GenomeExperimentService } from './genome-experiment.service';
import { GenomeMemoryService } from './genome-memory.service';
import { OutcomeLearningService } from './outcome-learning.service';
import {
  KEY_GENOME_SECTION_CONFIG,
  type KeyGenomeSection,
} from './key-genome.ontology';
import type {
  CreateGenomeExperimentInput,
  CreateGenomeRecommendationInput,
  GenerateGenomeRecommendationsInput,
  GenomeRecommendationData,
  GenomeRecommendationSource,
  GenomeSignalData,
  ListGenomeRecommendationsQuery,
  ModuleReadinessData,
  RecommendationOutcome,
  RecommendationStatus,
  RiskLevel,
} from './key-genome.types';

function asJsonValue<T>(value: T): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue;
}

function titleCase(value: string): string {
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function signalTypeLabel(type: string): string {
  return titleCase(type);
}

function riskFromSignalType(signalType: string): RiskLevel {
  switch (signalType) {
    case 'RISK_PATTERN':
    case 'FACT_CONFLICT':
    case 'READINESS_BLOCKER':
      return 'HIGH';
    case 'OPERATIONS_PATTERN':
    case 'MISSING_FACT':
    case 'STALE_FACT':
      return 'MEDIUM';
    case 'CUSTOMER_PATTERN':
    case 'REVENUE_PATTERN':
    case 'MARKET_PATTERN':
    default:
      return 'LOW';
  }
}

function effortFromSignalType(signalType: string): 'LOW' | 'MEDIUM' | 'HIGH' {
  switch (signalType) {
    case 'FACT_CONFLICT':
    case 'READINESS_BLOCKER':
      return 'HIGH';
    case 'OPERATIONS_PATTERN':
    case 'RISK_PATTERN':
      return 'MEDIUM';
    default:
      return 'LOW';
  }
}

function toDomain(row: {
  id: string;
  businessId: string;
  domain: string;
  title: string;
  insight: string;
  diagnosis: string;
  recommendation: string;
  expectedGain: string | null;
  expectedGainScore: number;
  riskLevel: string;
  effortLevel: string;
  confidence: number;
  evidenceIds: string[];
  suggestedExperimentId: string | null;
  status: string;
  createdAt: Date;
  reviewedAt: Date | null;
  outcomeTrackedAt: Date | null;
}): GenomeRecommendationData {
  const createdAt = row.createdAt.toISOString();
  return {
    id: row.id,
    businessId: row.businessId,
    domain: row.domain,
    title: row.title,
    insight: row.insight,
    diagnosis: row.diagnosis,
    recommendation: row.recommendation,
    expectedGain: row.expectedGain,
    expectedGainScore: row.expectedGainScore,
    riskLevel: row.riskLevel as RiskLevel,
    effortLevel: row.effortLevel as GenomeRecommendationData['effortLevel'],
    confidence: row.confidence,
    evidenceIds: row.evidenceIds ?? [],
    suggestedExperimentId: row.suggestedExperimentId,
    status: row.status as RecommendationStatus,
    createdAt,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    outcomeTrackedAt: row.outcomeTrackedAt?.toISOString() ?? null,
  };
}

interface CandidateRecommendation {
  source: GenomeRecommendationSource;
  domain: string;
  title: string;
  insight: string;
  diagnosis: string;
  recommendation: string;
  expectedGain?: string | null;
  expectedGainScore: number;
  riskLevel: RiskLevel;
  effortLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  confidence: number;
  evidenceIds: string[];
  suggestedExperimentInput?: CreateGenomeExperimentInput | null;
  urgency: number;
  readinessImpact: number;
}

@Injectable()
export class GenomeRecommendationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly signalService: GenomeSignalService,
    private readonly readiness: GenomeModuleReadinessService,
    private readonly scoring: GenomeScoringService,
    private readonly experimentService: GenomeExperimentService,
    private readonly memory: GenomeMemoryService,
    private readonly outcomeLearning: OutcomeLearningService,
  ) {}

  async createRecommendation(
    input: CreateGenomeRecommendationInput,
  ): Promise<GenomeRecommendationData> {
    const existing = await this.prisma.client.genomeRecommendation.findFirst({
      where: {
        businessId: input.businessId,
        domain: input.domain,
        title: input.title,
        status: { in: ['ACTIVE', 'ACCEPTED'] },
      },
    });

    if (existing) {
      return toDomain(existing);
    }

    const created = await this.prisma.client.genomeRecommendation.create({
      data: {
        businessId: input.businessId,
        domain: input.domain,
        title: input.title,
        insight: input.insight,
        diagnosis: input.diagnosis,
        recommendation: input.recommendation,
        expectedGain: input.expectedGain ?? null,
        expectedGainScore: input.expectedGainScore ?? 50,
        riskLevel: input.riskLevel ?? 'MEDIUM',
        effortLevel: input.effortLevel ?? 'MEDIUM',
        confidence: input.confidence ?? 0.5,
        evidenceIds: input.evidenceIds ?? [],
        suggestedExperimentId: input.suggestedExperimentId ?? null,
        status: 'ACTIVE',
      },
    });

    return toDomain(created);
  }

  async listRecommendations(
    businessId: string,
    filters: ListGenomeRecommendationsQuery = {},
  ): Promise<GenomeRecommendationData[]> {
    const rows = await this.prisma.client.genomeRecommendation.findMany({
      where: {
        businessId,
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.domain ? { domain: filters.domain } : {}),
        ...(filters.minExpectedGainScore !== undefined
          ? { expectedGainScore: { gte: filters.minExpectedGainScore } }
          : {}),
      },
      orderBy: [{ expectedGainScore: 'desc' }, { createdAt: 'desc' }],
      take: filters.limit,
    });

    return rows.map(toDomain);
  }

  async getRecommendation(
    businessId: string,
    recommendationId: string,
  ): Promise<GenomeRecommendationData> {
    const row = await this.prisma.client.genomeRecommendation.findUnique({
      where: { id: recommendationId },
    });

    if (!row || row.businessId !== businessId) {
      throw new NotFoundException('Genome recommendation not found');
    }

    return toDomain(row);
  }

  async acceptRecommendation(
    businessId: string,
    recommendationId: string,
  ): Promise<GenomeRecommendationData> {
    await this.getRecommendation(businessId, recommendationId);

    const updated = await this.prisma.client.genomeRecommendation.update({
      where: { id: recommendationId },
      data: { status: 'ACCEPTED' as RecommendationStatus, reviewedAt: new Date() },
    });

    await this.outcomeLearning.recordRecommendationAccepted(businessId, toDomain(updated));

    return toDomain(updated);
  }

  async dismissRecommendation(
    businessId: string,
    recommendationId: string,
  ): Promise<GenomeRecommendationData> {
    await this.getRecommendation(businessId, recommendationId);

    const updated = await this.prisma.client.genomeRecommendation.update({
      where: { id: recommendationId },
      data: { status: 'DISMISSED' as RecommendationStatus, reviewedAt: new Date() },
    });

    await this.outcomeLearning.recordRecommendationDismissed(businessId, toDomain(updated));

    return toDomain(updated);
  }

  async applyRecommendation(
    businessId: string,
    recommendationId: string,
  ): Promise<GenomeRecommendationData> {
    await this.getRecommendation(businessId, recommendationId);

    const updated = await this.prisma.client.genomeRecommendation.update({
      where: { id: recommendationId },
      data: {
        status: 'APPLIED' as RecommendationStatus,
        reviewedAt: new Date(),
        outcomeTrackedAt: new Date(),
      },
    });

    await this.outcomeLearning.recordRecommendationApplied(businessId, toDomain(updated));

    return toDomain(updated);
  }

  async trackOutcome(
    businessId: string,
    recommendationId: string,
    outcome: RecommendationOutcome,
  ): Promise<GenomeRecommendationData> {
    await this.getRecommendation(businessId, recommendationId);

    const updated = await this.prisma.client.genomeRecommendation.update({
      where: { id: recommendationId },
      data: {
        outcomeTrackedAt: new Date(),
        expectedGainScore: outcome.measuredValue ?? undefined,
      },
    });

    await this.outcomeLearning.recordRecommendationOutcome(businessId, toDomain(updated), outcome);

    return toDomain(updated);
  }

  async generateRecommendations(
    input: GenerateGenomeRecommendationsInput,
  ): Promise<GenomeRecommendationData[]> {
    const allSources: GenomeRecommendationSource[] = [
      'READINESS_GAP',
      'SIGNAL',
      'WEAK_SECTION',
    ];
    const sources = input.sources ?? allSources;
    const maxRecommendations = input.maxRecommendations ?? 10;

    const existing = await this.listRecommendations(input.businessId, {
      status: 'ACTIVE',
      limit: 200,
    });
    const existingKeys = new Set(existing.map((r) => `${r.domain}|${r.title}`));

    const candidates: CandidateRecommendation[] = [];

    if (sources.includes('READINESS_GAP')) {
      const readinessList = (await this.readiness.getReadiness(
        input.businessId,
      )) as ModuleReadinessData[];
      candidates.push(...this.buildReadinessGapCandidates(readinessList));
    }

    if (sources.includes('SIGNAL')) {
      const signals = await this.signalService.listSignals(input.businessId, {
        status: 'NEW',
        minConfidence: 0.6,
        limit: 50,
      });
      candidates.push(...this.buildSignalCandidates(signals));
    }

    if (sources.includes('WEAK_SECTION')) {
      const facts = await this.scoring.computeFactScores(input.businessId);
      const score = this.scoring.computeBusinessScore(input.businessId, facts);
      candidates.push(...this.buildWeakSectionCandidates(score));
    }

    const adjusted = await this.applyMemoryConfidenceAdjustment(input.businessId, candidates);
    const ranked = this.rankCandidates(adjusted).slice(0, maxRecommendations);
    const created: GenomeRecommendationData[] = [];

    for (const candidate of ranked) {
      const key = `${candidate.domain}|${candidate.title}`;
      if (existingKeys.has(key)) continue;
      existingKeys.add(key);

      let suggestedExperimentId: string | null = null;
      if (candidate.suggestedExperimentInput) {
        const experiment = await this.experimentService.createExperiment(
          candidate.suggestedExperimentInput,
        );
        suggestedExperimentId = experiment.id;
      }

      const rec = await this.createRecommendation({
        businessId: input.businessId,
        domain: candidate.domain,
        title: candidate.title,
        insight: candidate.insight,
        diagnosis: candidate.diagnosis,
        recommendation: candidate.recommendation,
        expectedGain: candidate.expectedGain,
        expectedGainScore: candidate.expectedGainScore,
        riskLevel: candidate.riskLevel,
        effortLevel: candidate.effortLevel,
        confidence: candidate.confidence,
        evidenceIds: candidate.evidenceIds,
        suggestedExperimentId,
        source: candidate.source,
      });

      created.push(rec);
    }

    return created;
  }

  private buildReadinessGapCandidates(
    readinessList: ModuleReadinessData[],
  ): CandidateRecommendation[] {
    const candidates: CandidateRecommendation[] = [];

    for (const module of readinessList) {
      if (module.automationAllowed && module.readinessScore >= 90) continue;

      for (const missing of module.missingFacts) {
        if (missing.impact === 'OPTIONAL') continue;

        const domain = missing.section;
        const title = `Provide ${missing.impact.toLowerCase()} fact: ${missing.domain}.${missing.field}`;
        const expectedGainScore = missing.impact === 'BLOCKING' ? 85 : 60;
        const urgency = missing.impact === 'BLOCKING' ? 1 : 0.7;
        const readinessImpact = (100 - module.readinessScore) / 100;

        candidates.push({
          source: 'READINESS_GAP',
          domain,
          title,
          insight: `${module.module} readiness is ${module.readinessScore}% because ${missing.domain}.${missing.field} is missing.`,
          diagnosis: missing.reason,
          recommendation: `Capture the ${missing.domain}.${missing.field} fact in the Business Genome to unlock ${module.module} operations.`,
          expectedGain: `Improves ${module.module} readiness and enables automation.`,
          expectedGainScore,
          riskLevel: missing.impact === 'BLOCKING' ? 'HIGH' : 'MEDIUM',
          effortLevel: 'LOW',
          confidence: 0.75,
          evidenceIds: [],
          urgency,
          readinessImpact,
        });
      }
    }

    return candidates;
  }

  private buildSignalCandidates(signals: GenomeSignalData[]): CandidateRecommendation[] {
    const candidates: CandidateRecommendation[] = [];

    for (const signal of signals) {
      if (signal.status === 'REJECTED' || signal.status === 'MERGED') continue;
      if (signal.confidence < 0.7) continue;

      const riskLevel = riskFromSignalType(signal.signalType);
      const effortLevel = effortFromSignalType(signal.signalType);
      const expectedGainScore =
        signal.signalType === 'CUSTOMER_PATTERN' ||
        signal.signalType === 'REVENUE_PATTERN' ||
        signal.signalType === 'MARKET_PATTERN'
          ? 80
          : signal.signalType === 'RISK_PATTERN' || signal.signalType === 'READINESS_BLOCKER'
            ? 70
            : 55;
      const urgency =
        signal.signalType === 'RISK_PATTERN' || signal.signalType === 'READINESS_BLOCKER'
          ? 1
          : signal.signalType === 'FACT_CONFLICT'
            ? 0.9
            : 0.6;

      const candidate: CandidateRecommendation = {
        source: 'SIGNAL',
        domain: signal.section,
        title: `${signalTypeLabel(signal.signalType)} in ${signal.domain}`,
        insight: signal.reason,
        diagnosis: `A ${signalTypeLabel(signal.signalType)} signal was detected in ${signal.domain}${signal.field ? `.${signal.field}` : ''} with ${Math.round(signal.confidence * 100)}% confidence.`,
        recommendation: `Review the signal evidence and decide whether to merge it into the Business Genome or run a controlled experiment.`,
        expectedGain: `Keeps the Business Genome accurate and surfaces an actionable pattern.`,
        expectedGainScore,
        riskLevel,
        effortLevel,
        confidence: signal.confidence,
        evidenceIds: signal.evidence.map((e) => e.id).filter(Boolean),
        urgency,
        readinessImpact: 0.3,
      };

      candidate.suggestedExperimentInput = this.buildSignalExperimentInput(
        signal,
        candidate,
      );

      candidates.push(candidate);
    }

    return candidates;
  }

  private buildSignalExperimentInput(
    signal: GenomeSignalData,
    candidate: CandidateRecommendation,
  ): CreateGenomeExperimentInput | null {
    const experimentSignalTypes = ['CUSTOMER_PATTERN', 'REVENUE_PATTERN', 'MARKET_PATTERN'];
    if (!experimentSignalTypes.includes(signal.signalType)) return null;
    if (candidate.riskLevel !== 'LOW' && candidate.riskLevel !== 'MEDIUM') return null;

    return {
      businessId: signal.businessId,
      recommendationId: undefined,
      hypothesis: `Validating ${signalTypeLabel(signal.signalType).toLowerCase()} may improve business outcomes.`,
      action: candidate.recommendation,
      successMetric: 'Confirm pattern impact and measure lift',
      baselineValue: null,
      targetValue: null,
      durationDays: 14,
      riskLevel: 'LOW',
    };
  }

  private buildWeakSectionCandidates(score: {
    sections: { section: string; weight: number; score: { overall: number; confidence: number; freshness: number } }[];
  }): CandidateRecommendation[] {
    const candidates: CandidateRecommendation[] = [];

    for (const section of score.sections) {
      if (section.score.overall >= 0.55 && section.score.confidence >= 0.4) continue;

      const config = KEY_GENOME_SECTION_CONFIG[section.section as KeyGenomeSection];
      const label = config?.label ?? titleCase(section.section);
      const domain = section.section;
      const title = `Strengthen ${label} Genome section`;

      candidates.push({
        source: 'WEAK_SECTION',
        domain,
        title,
        insight: `${label} is one of the weakest areas of the Business Genome.`,
        diagnosis: `Overall ${Math.round(section.score.overall * 100)}%, confidence ${Math.round(section.score.confidence * 100)}%, freshness ${Math.round(section.score.freshness * 100)}%.`,
        recommendation: `Review missing facts in ${label} and capture the core business truths needed to raise its score.`,
        expectedGain: `Raises overall Genome integrity and unlocks more autonomous operations.`,
        expectedGainScore: Math.round((1 - section.score.overall) * 100 * (section.weight / 20)),
        riskLevel: section.score.overall < 0.4 ? 'HIGH' : 'MEDIUM',
        effortLevel: 'MEDIUM',
        confidence: section.score.confidence,
        evidenceIds: [],
        urgency: section.score.overall < 0.4 ? 1 : 0.6,
        readinessImpact: 1 - section.score.overall,
      });
    }

    return candidates;
  }

  private rankCandidates(candidates: CandidateRecommendation[]): CandidateRecommendation[] {
    return [...candidates].sort((a, b) => this.candidateScore(b) - this.candidateScore(a));
  }

  private async applyMemoryConfidenceAdjustment(
    businessId: string,
    candidates: CandidateRecommendation[],
  ): Promise<CandidateRecommendation[]> {
    const memoryEvents = await this.memory.listMemoryEvents(businessId, { limit: 1000 });
    const domainAdjustments = new Map<string, number>();

    for (const event of memoryEvents) {
      if (!event.domain) continue;
      const current = domainAdjustments.get(event.domain) ?? 0;
      if (event.outcome === 'SUCCESS') domainAdjustments.set(event.domain, current + 0.05);
      if (event.outcome === 'FAILURE') domainAdjustments.set(event.domain, current - 0.05);
      if (event.outcome === 'MIXED') domainAdjustments.set(event.domain, current + 0.02);
    }

    return candidates.map((candidate) => {
      const adjustment = domainAdjustments.get(candidate.domain) ?? 0;
      if (adjustment === 0) return candidate;
      return {
        ...candidate,
        confidence: Math.max(0, Math.min(1, candidate.confidence + adjustment)),
      };
    });
  }

  private candidateScore(candidate: CandidateRecommendation): number {
    const normalizedGain = candidate.expectedGainScore / 100;
    const riskPenalty =
      candidate.riskLevel === 'CRITICAL' ? 1 : candidate.riskLevel === 'HIGH' ? 0.7 : candidate.riskLevel === 'MEDIUM' ? 0.4 : 0;
    const effortPenalty =
      candidate.effortLevel === 'HIGH' ? 1 : candidate.effortLevel === 'MEDIUM' ? 0.5 : 0;

    return (
      normalizedGain * 0.35 +
      candidate.confidence * 0.25 +
      candidate.urgency * 0.2 +
      candidate.readinessImpact * 0.1 -
      riskPenalty * 0.05 -
      effortPenalty * 0.05
    );
  }
}
