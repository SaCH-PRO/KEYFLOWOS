import { Injectable } from '@nestjs/common';
import type { MarketStrategy, Competitor } from '@prisma/client';
import type { MarketStrategyDto, CompetitorDto, MarketStrategyResponse, GenesisReadinessScore } from './business-genesis.types';

const SWOT_FALLBACK = { strengths: [], weaknesses: [], opportunities: [], threats: [] };
const PESTLE_FALLBACK = { political: '', economic: '', social: '', technological: '', legal: '', environmental: '' };
const POSITIONING_FALLBACK = { tagline: '', valueProposition: '', keyMessages: [], differentiators: [], targetSegments: [] };
const LAUNCH_PLAN_FALLBACK = { summary: '', phases: [] };
const ANALYSIS_SUMMARY_FALLBACK = { marketOpportunityScore: 0, keyInsight: '' };

@Injectable()
export class MarketStrategyMapper {
  toStrategyDto(strategy: MarketStrategy | null): MarketStrategyDto | null {
    if (!strategy) return null;
    return {
      id: strategy.id,
      businessId: strategy.businessId,
      swot: this.readJson(strategy.swot, SWOT_FALLBACK),
      pestle: this.readJson(strategy.pestle, PESTLE_FALLBACK),
      positioning: this.readJson(strategy.positioning, POSITIONING_FALLBACK),
      launchPlan: this.readJson(strategy.launchPlan, LAUNCH_PLAN_FALLBACK),
      analysisSummary: this.readJson(strategy.analysisSummary, ANALYSIS_SUMMARY_FALLBACK),
      generatedAt: strategy.generatedAt?.toISOString() ?? '',
    };
  }

  toCompetitorDtos(competitors: Competitor[]): CompetitorDto[] {
    return competitors.map((c) => ({
      id: c.id,
      businessId: c.businessId,
      name: c.name,
      threatLevel: this.normalizeThreatLevel(c.threatLevel),
      strengths: c.strengths ?? [],
      weaknesses: c.weaknesses ?? [],
      positioning: c.positioning ?? null,
    }));
  }

  toResponse(
    strategy: MarketStrategy | null,
    competitors: Competitor[],
    documentInstanceId: string | null,
    readiness: GenesisReadinessScore,
  ): MarketStrategyResponse {
    return {
      strategy: this.toStrategyDto(strategy),
      competitors: this.toCompetitorDtos(competitors),
      documentInstanceId,
      readiness,
    };
  }

  private readJson<T>(value: unknown, fallback: T): T {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return { ...fallback, ...(value as Record<string, unknown>) } as T;
    }
    return fallback;
  }

  private normalizeThreatLevel(value: string | null): 'LOW' | 'MEDIUM' | 'HIGH' | null {
    if (!value) return null;
    const upper = value.toUpperCase();
    if (upper === 'LOW' || upper === 'MEDIUM' || upper === 'HIGH') return upper;
    return null;
  }
}
