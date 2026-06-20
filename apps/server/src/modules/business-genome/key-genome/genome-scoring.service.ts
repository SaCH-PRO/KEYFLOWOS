import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { GenomeEvidenceService } from './genome-evidence.service';
import {
  KEY_GENOME_RISK_PENALTIES,
  KEY_GENOME_SCORING_WEIGHTS,
  KEY_GENOME_SECTION_WEIGHTS,
  KEY_GENOME_TOTAL_WEIGHT,
} from './key-genome.ontology';
import type {
  GenomeFactData,
  GenomeFactScore,
  KeyGenomeScore,
  RiskLevel,
  SectionGenomeScore,
  VerificationStatus,
} from './key-genome.types';

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function isEmptyValue(raw: unknown): boolean {
  if (raw === null || raw === undefined) return true;
  if (typeof raw === 'string' && raw.trim() === '') return true;
  if (Array.isArray(raw) && raw.length === 0) return true;
  if (typeof raw === 'object' && !Array.isArray(raw) && Object.keys(raw as Record<string, unknown>).length === 0) {
    return true;
  }
  return false;
}

function verificationBase(status: VerificationStatus): number {
  switch (status) {
    case 'USER_VERIFIED':
      return 1.0;
    case 'INFERRED':
      return 0.7;
    case 'UNVERIFIED_IMPORTED':
      return 0.5;
    case 'STALE':
      return 0.2;
    case 'DISPUTED':
      return 0.0;
    default:
      return 0.5;
  }
}

function computeCompleteness(fact: GenomeFactData): number {
  return isEmptyValue(fact.value.raw) ? 0 : 1;
}

function computeQuality(averageEvidenceStrength: number): number {
  return clamp(averageEvidenceStrength);
}

function computeConfidence(fact: GenomeFactData, averageEvidenceStrength: number): number {
  if (fact.verificationStatus === 'DISPUTED') return 0;
  const base = verificationBase(fact.verificationStatus);
  const boost = clamp(averageEvidenceStrength) * 0.1;
  return clamp(base + boost);
}

function computeFreshness(fact: GenomeFactData, now = Date.now()): number {
  if (fact.expiresAt && new Date(fact.expiresAt).getTime() < now) {
    return 0;
  }

  const updatedAt = new Date(fact.updatedAt).getTime();
  const ageMs = now - updatedAt;
  if (ageMs <= 0) return 1;

  // 30-day half-life exponential decay
  const halfLifeDays = 30;
  const halfLifeMs = halfLifeDays * 24 * 60 * 60 * 1000;
  return clamp(Math.pow(0.5, ageMs / halfLifeMs));
}

function computeOperationalReadiness(fact: GenomeFactData): number {
  return verificationBase(fact.verificationStatus);
}

function computeRiskPenalty(riskIfWrong: RiskLevel): number {
  return KEY_GENOME_RISK_PENALTIES[riskIfWrong] ?? 0;
}

function computeOverallScore(scores: Omit<GenomeFactScore, 'overall' | 'riskPenalty'>, riskIfWrong: RiskLevel): number {
  const weights = KEY_GENOME_SCORING_WEIGHTS;
  const base =
    scores.completeness * weights.completeness +
    scores.quality * weights.quality +
    scores.confidence * weights.confidence +
    scores.freshness * weights.freshness +
    scores.operationalReadiness * weights.operationalReadiness;
  const penalty = computeRiskPenalty(riskIfWrong);
  return clamp(base - penalty);
}

function emptyScore(): Omit<GenomeFactScore, 'overall' | 'riskPenalty'> {
  return {
    completeness: 0,
    quality: 0,
    confidence: 0,
    freshness: 0,
    operationalReadiness: 0,
  };
}

function averageScores(scores: GenomeFactScore[]): GenomeFactScore {
  if (scores.length === 0) {
    return { ...emptyScore(), riskPenalty: 0, overall: 0 };
  }

  const sum = scores.reduce(
    (acc, s) => ({
      completeness: acc.completeness + s.completeness,
      quality: acc.quality + s.quality,
      confidence: acc.confidence + s.confidence,
      freshness: acc.freshness + s.freshness,
      operationalReadiness: acc.operationalReadiness + s.operationalReadiness,
      riskPenalty: acc.riskPenalty + s.riskPenalty,
      overall: acc.overall + s.overall,
    }),
    { completeness: 0, quality: 0, confidence: 0, freshness: 0, operationalReadiness: 0, riskPenalty: 0, overall: 0 },
  );

  const count = scores.length;
  return {
    completeness: sum.completeness / count,
    quality: sum.quality / count,
    confidence: sum.confidence / count,
    freshness: sum.freshness / count,
    operationalReadiness: sum.operationalReadiness / count,
    riskPenalty: sum.riskPenalty / count,
    overall: sum.overall / count,
  };
}

@Injectable()
export class GenomeScoringService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly evidenceService: GenomeEvidenceService,
  ) {}

  scoreFact(fact: GenomeFactData, averageEvidenceStrength = 0): GenomeFactScore {
    const quality = computeQuality(averageEvidenceStrength);
    const scores = {
      completeness: computeCompleteness(fact),
      quality,
      confidence: computeConfidence(fact, averageEvidenceStrength),
      freshness: computeFreshness(fact),
      operationalReadiness: computeOperationalReadiness(fact),
    };
    const riskPenalty = computeRiskPenalty(fact.riskIfWrong);
    const overall = computeOverallScore(scores, fact.riskIfWrong);
    return { ...scores, riskPenalty, overall };
  }

  async computeFactScores(businessId: string): Promise<GenomeFactData[]> {
    const rows = await this.prisma.client.genomeFact.findMany({
      where: { businessId },
    });

    const facts = await Promise.all(
      rows.map(async (row) => {
        const summary = await this.evidenceService.evidenceSummary(businessId, row.id);
        const fact: GenomeFactData = this.rowToDomain(row);
        const score = this.scoreFact(fact, summary.averageStrength);

        await this.prisma.client.genomeFact.update({
          where: { id: row.id },
          data: {
            completenessScore: score.completeness,
            qualityScore: score.quality,
            confidenceScore: score.confidence,
            freshnessScore: score.freshness,
            operationalReadinessScore: score.operationalReadiness,
          },
        });

        return { ...fact, score };
      }),
    );

    return facts;
  }

  computeSectionScores(facts: GenomeFactData[]): SectionGenomeScore[] {
    const factsBySection = new Map<string, GenomeFactData[]>();
    for (const fact of facts) {
      const list = factsBySection.get(fact.section) ?? [];
      list.push(fact);
      factsBySection.set(fact.section, list);
    }

    return Array.from(factsBySection.entries()).map(([section, sectionFacts]) => ({
      section,
      weight: KEY_GENOME_SECTION_WEIGHTS[section as keyof typeof KEY_GENOME_SECTION_WEIGHTS] ?? 0,
      score: averageScores(sectionFacts.map((f) => f.score)),
    }));
  }

  computeBusinessScore(businessId: string, facts?: GenomeFactData[]): KeyGenomeScore {
    const sourceFacts = facts ?? [];
    const sectionScores = this.computeSectionScores(sourceFacts);

    if (sectionScores.length === 0) {
      return {
        businessId,
        overall: 0,
        integrity: 0,
        readiness: 0,
        confidence: 0,
        sections: [],
        computedAt: new Date().toISOString(),
      };
    }

    const weightedOverall =
      sectionScores.reduce((sum, s) => sum + s.score.overall * s.weight, 0) / KEY_GENOME_TOTAL_WEIGHT;

    const averaged = averageScores(sectionScores.map((s) => s.score));

    return {
      businessId,
      overall: clamp(weightedOverall),
      integrity: averaged.completeness,
      readiness: averaged.operationalReadiness,
      confidence: averaged.confidence,
      sections: sectionScores,
      computedAt: new Date().toISOString(),
    };
  }

  private rowToDomain(row: {
    id: string;
    businessId: string;
    section: string;
    domain: string;
    field: string;
    value: unknown;
    valueType: string;
    sourceModule: string | null;
    sourceType: string;
    sourceEntityType: string | null;
    sourceEntityId: string | null;
    completenessScore: number;
    qualityScore: number;
    confidenceScore: number;
    freshnessScore: number;
    operationalReadinessScore: number;
    verificationStatus: string;
    riskIfWrong: string;
    lastVerifiedAt: Date | null;
    expiresAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): GenomeFactData {
    const riskPenalty = computeRiskPenalty(row.riskIfWrong as RiskLevel);
    const score = {
      completeness: row.completenessScore,
      quality: row.qualityScore,
      confidence: row.confidenceScore,
      freshness: row.freshnessScore,
      operationalReadiness: row.operationalReadinessScore,
      riskPenalty,
      overall: computeOverallScore(
        {
          completeness: row.completenessScore,
          quality: row.qualityScore,
          confidence: row.confidenceScore,
          freshness: row.freshnessScore,
          operationalReadiness: row.operationalReadinessScore,
        },
        row.riskIfWrong as RiskLevel,
      ),
    };

    return {
      id: row.id,
      businessId: row.businessId,
      section: row.section,
      domain: row.domain,
      field: row.field,
      value: { raw: row.value, type: row.valueType as GenomeFactData['value']['type'] },
      sourceModule: row.sourceModule,
      sourceType: row.sourceType,
      sourceEntityType: row.sourceEntityType,
      sourceEntityId: row.sourceEntityId,
      score,
      verificationStatus: row.verificationStatus as VerificationStatus,
      riskIfWrong: row.riskIfWrong as RiskLevel,
      lastVerifiedAt: row.lastVerifiedAt?.toISOString() ?? null,
      expiresAt: row.expiresAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
