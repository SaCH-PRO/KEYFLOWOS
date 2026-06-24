import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { GenomeGrowthChannelService } from './genome-growth-channel.service';
import { GenomeContentStrategyService } from './genome-content-strategy.service';
import { GenomeSignalService } from './genome-signal.service';
import { GenomeRecommendationService } from './genome-recommendation.service';
import { GenomeMemoryService } from './genome-memory.service';
import { DepartmentReadinessService } from './department-readiness.service';
import type {
  CreateGenomeRecommendationInput,
  CreateGenomeSignalInput,
  GenomeContentStrategyData,
  GenomeGrowthChannelData,
  GenomeMarketingGrowthChannelMixItem,
  GenomeMarketingGrowthRecommendation,
  GenomeMarketingGrowthRiskLevel,
  GenomeMarketingGrowthSnapshotData,
  GenomeMarketingGrowthWarning,
  ListGenomeMarketingGrowthSnapshotsQuery,
  RiskLevel,
} from './key-genome.types';

function asJsonValue<T>(value: T): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue;
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

function isActiveChannel(channel: GenomeGrowthChannelData): boolean {
  return channel.status === 'ACTIVE' || channel.status === 'TESTING';
}

function computeChannelMix(
  channels: GenomeGrowthChannelData[],
): GenomeMarketingGrowthChannelMixItem[] {
  const active = channels.filter(isActiveChannel);
  if (active.length === 0) return [];

  const totalBudget = active.reduce(
    (sum, c) => sum + (c.monthlyBudget ?? 0),
    0,
  );
  const useBudget = totalBudget > 0;

  return active.map((channel) => {
    let sharePercent = 0;
    if (useBudget) {
      sharePercent = totalBudget > 0 && (channel.monthlyBudget ?? 0) > 0
        ? ((channel.monthlyBudget ?? 0) / totalBudget) * 100
        : 0;
    } else {
      sharePercent = 100 / active.length;
    }
    return {
      channelKey: channel.key,
      label: channel.label,
      channelType: channel.channelType,
      sharePercent: Math.round(sharePercent * 100) / 100,
      status: channel.status,
    };
  });
}

function normalizeShare(items: GenomeMarketingGrowthChannelMixItem[]): void {
  const total = items.reduce((sum, i) => sum + i.sharePercent, 0);
  if (items.length > 0 && Math.abs(total - 100) > 0.01) {
    const adjustment = (100 - total) / items.length;
    items.forEach((i) => {
      i.sharePercent = Math.round((i.sharePercent + adjustment) * 100) / 100;
    });
  }
}

function maxChannelShare(mix: GenomeMarketingGrowthChannelMixItem[]): number {
  if (mix.length === 0) return 0;
  return Math.max(...mix.map((m) => m.sharePercent)) / 100;
}

function maxChannelTypeShare(mix: GenomeMarketingGrowthChannelMixItem[]): number {
  if (mix.length === 0) return 0;
  const typeTotals: Record<string, number> = {};
  for (const item of mix) {
    typeTotals[item.channelType] = (typeTotals[item.channelType] ?? 0) + item.sharePercent;
  }
  return Math.max(...Object.values(typeTotals)) / 100;
}

function computeDiversificationScore(
  mix: GenomeMarketingGrowthChannelMixItem[],
): number {
  if (mix.length === 0) return 0;
  let score = 100;
  const channelShare = maxChannelShare(mix);
  if (channelShare > 0.8) score -= 30;
  else if (channelShare > 0.6) score -= 20;

  const typeShare = maxChannelTypeShare(mix);
  if (typeShare > 0.8) score -= 20;
  else if (typeShare > 0.6) score -= 10;

  return clamp(score);
}

function computeContentConsistencyScore(
  strategies: GenomeContentStrategyData[],
): number {
  if (strategies.length === 0) return 0;
  const strategy = strategies[0];
  let score = 0;
  if (strategy.pillars.length > 0) score += 40;
  if (strategy.formats.length > 0) score += 30;
  if (strategy.cadence) score += 20;
  if (strategy.distributionChannels.length > 0) score += 10;
  return clamp(score);
}

function computeBlendedCac(
  channels: GenomeGrowthChannelData[],
): number | null {
  const active = channels.filter(isActiveChannel);
  const withCac = active.filter((c) => c.targetCac != null && c.targetCac > 0);
  if (withCac.length === 0) return null;

  const totalBudget = active.reduce(
    (sum, c) => sum + (c.monthlyBudget ?? 0),
    0,
  );
  const useBudget = totalBudget > 0 && withCac.some((c) => (c.monthlyBudget ?? 0) > 0);

  if (useBudget) {
    const weighted = withCac.reduce(
      (sum, c) => sum + (c.targetCac ?? 0) * (c.monthlyBudget ?? 0),
      0,
    );
    const weightTotal = withCac.reduce(
      (sum, c) => sum + (c.monthlyBudget ?? 0),
      0,
    );
    return weightTotal > 0 ? weighted / weightTotal : null;
  }

  return withCac.reduce((sum, c) => sum + (c.targetCac ?? 0), 0) / withCac.length;
}

function computeLeadVolumeEstimate(
  channels: GenomeGrowthChannelData[],
): number | null {
  const active = channels.filter(isActiveChannel);
  const eligible = active.filter(
    (c) => (c.monthlyBudget ?? 0) > 0 && (c.targetCac ?? 0) > 0,
  );
  if (eligible.length === 0) return null;
  return eligible.reduce(
    (sum, c) => sum + (c.monthlyBudget ?? 0) / (c.targetCac ?? 1),
    0,
  );
}

function computeFunnelConversionEstimate(
  channels: GenomeGrowthChannelData[],
): number | null {
  const active = channels.filter(isActiveChannel);
  const withRate = active.filter((c) => c.targetConversionRate != null);
  if (withRate.length === 0) return null;
  return (
    withRate.reduce((sum, c) => sum + (c.targetConversionRate ?? 0), 0) /
    withRate.length
  );
}

function channelConcentrationRisk(
  mix: GenomeMarketingGrowthChannelMixItem[],
): GenomeMarketingGrowthRiskLevel {
  if (mix.length === 0) return 'HIGH';
  const channelShare = maxChannelShare(mix);
  const typeShare = maxChannelTypeShare(mix);
  if (channelShare > 0.8 || typeShare > 0.8) return 'HIGH';
  if (channelShare > 0.6 || typeShare > 0.6) return 'MEDIUM';
  return 'LOW';
}

function contentStrategyRisk(
  strategies: GenomeContentStrategyData[],
): GenomeMarketingGrowthRiskLevel {
  if (strategies.length === 0) return 'MEDIUM';
  const strategy = strategies[0];
  if (
    strategy.pillars.length === 0 ||
    strategy.formats.length === 0 ||
    !strategy.cadence
  ) {
    return 'MEDIUM';
  }
  return 'LOW';
}

function cacRisk(blendedCac: number | null): GenomeMarketingGrowthRiskLevel {
  if (blendedCac === null) return 'UNKNOWN';
  if (blendedCac > 500) return 'HIGH';
  if (blendedCac > 250) return 'MEDIUM';
  return 'LOW';
}

function overallRisk(
  risks: GenomeMarketingGrowthRiskLevel[],
): GenomeMarketingGrowthRiskLevel {
  if (risks.includes('CRITICAL')) return 'CRITICAL';
  if (risks.includes('HIGH')) return 'HIGH';
  if (risks.includes('MEDIUM')) return 'MEDIUM';
  if (risks.includes('LOW')) return 'LOW';
  return 'UNKNOWN';
}

const CAC_WARNING_THRESHOLD = 500;

function toRecommendationRiskLevel(
  risk: GenomeMarketingGrowthRiskLevel,
): RiskLevel {
  if (risk === 'LOW' || risk === 'MEDIUM' || risk === 'HIGH' || risk === 'CRITICAL') {
    return risk;
  }
  return 'MEDIUM';
}

@Injectable()
export class MarketingGenomeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly channels: GenomeGrowthChannelService,
    private readonly contentStrategies: GenomeContentStrategyService,
    private readonly signals: GenomeSignalService,
    private readonly recommendations: GenomeRecommendationService,
    private readonly memory: GenomeMemoryService,
    private readonly departmentReadiness: DepartmentReadinessService,
  ) {}

  async computeMarketingGrowthSnapshot(
    businessId: string,
    period?: string,
  ): Promise<GenomeMarketingGrowthSnapshotData> {
    const [channels, strategies] = await Promise.all([
      this.channels.findMany(businessId),
      this.contentStrategies.findMany(businessId),
    ]);

    const mix = computeChannelMix(channels);
    normalizeShare(mix);

    const activeChannels = channels.filter(isActiveChannel);
    const channelDiversificationScore = computeDiversificationScore(mix);
    const contentConsistencyScore = computeContentConsistencyScore(strategies);
    const blendedCac = computeBlendedCac(channels);
    const leadVolumeEstimate = computeLeadVolumeEstimate(channels);
    const funnelConversionEstimate = computeFunnelConversionEstimate(channels);

    const missingInputs: string[] = [];
    if (activeChannels.length === 0) missingInputs.push('growth_channels');
    if (strategies.length === 0) missingInputs.push('content_strategy');
    if (blendedCac === null) missingInputs.push('channel_target_cac');
    if (funnelConversionEstimate === null) {
      missingInputs.push('channel_target_conversion_rate');
    }
    if (strategies.length > 0 && !strategies[0].cadence) {
      missingInputs.push('content_cadence');
    }

    const warnings: GenomeMarketingGrowthWarning[] = [];
    const recs: GenomeMarketingGrowthRecommendation[] = [];

    const concentrationRisk = channelConcentrationRisk(mix);
    if (concentrationRisk === 'HIGH' || concentrationRisk === 'MEDIUM') {
      const topChannel = mix.reduce<GenomeMarketingGrowthChannelMixItem | null>(
        (best, item) => (!best || item.sharePercent > best.sharePercent ? item : best),
        null,
      );
      warnings.push({
        type: 'CHANNEL_CONCENTRATION',
        message:
          concentrationRisk === 'HIGH'
            ? 'Growth is concentrated in a single channel or channel type.'
            : 'Growth relies heavily on one channel or channel type.',
        severity: concentrationRisk,
        channelKey: topChannel?.channelKey ?? null,
      });
      recs.push({
        type: 'DIVERSIFY_CHANNELS',
        title: 'Diversify growth channels',
        insight: 'Channel concentration increases volatility and CAC risk.',
        diagnosis:
          'A single channel or channel type represents the majority of active growth effort.',
        recommendation:
          'Add or test additional channels (owned, earned, paid) to reduce dependency.',
        expectedGain: 'Reduce concentration risk and improve acquisition resilience.',
        riskLevel: concentrationRisk,
        effortLevel: concentrationRisk === 'HIGH' ? 'HIGH' : 'MEDIUM',
        channelKey: topChannel?.channelKey ?? null,
      });
    }

    if (strategies.length === 0) {
      warnings.push({
        type: 'NO_CONTENT_STRATEGY',
        message: 'No content strategy is recorded.',
        severity: 'MEDIUM',
      });
      recs.push({
        type: 'CREATE_CONTENT_STRATEGY',
        title: 'Create a content strategy',
        insight: 'Consistent content is required for sustainable organic growth.',
        diagnosis: 'No content strategy exists for the business.',
        recommendation:
          'Define content pillars, formats, cadence, and distribution channels.',
        expectedGain: 'Improve content consistency and audience trust.',
        riskLevel: 'MEDIUM',
        effortLevel: 'MEDIUM',
      });
    } else {
      const strategy = strategies[0];
      if (strategy.pillars.length === 0) {
        warnings.push({
          type: 'MISSING_CONTENT_PILLARS',
          message: 'Content strategy has no defined pillars.',
          severity: 'MEDIUM',
        });
        recs.push({
          type: 'ADD_CONTENT_PILLARS',
          title: 'Define content pillars',
          insight: 'Pillars make content repeatable and aligned to positioning.',
          diagnosis: 'The content strategy lacks pillars.',
          recommendation: 'Add 3-5 pillars that map to customer problems and offers.',
          expectedGain: 'Increase relevance and reduce planning friction.',
          riskLevel: 'MEDIUM',
          effortLevel: 'LOW',
        });
      }
      if (!strategy.cadence) {
        warnings.push({
          type: 'MISSING_CONTENT_CADENCE',
          message: 'Content strategy has no publishing cadence.',
          severity: 'MEDIUM',
        });
        recs.push({
          type: 'SET_CONTENT_CADENCE',
          title: 'Set a publishing cadence',
          insight: 'Cadence drives consistency and audience expectation.',
          diagnosis: 'The content strategy does not define cadence.',
          recommendation: 'Choose a realistic weekly or monthly cadence and assign ownership.',
          expectedGain: 'Improve consistency score and organic reach.',
          riskLevel: 'MEDIUM',
          effortLevel: 'LOW',
        });
      }
    }

    for (const channel of activeChannels) {
      if ((channel.targetCac ?? 0) > CAC_WARNING_THRESHOLD) {
        warnings.push({
          type: 'HIGH_TARGET_CAC',
          message: `Target CAC for ${channel.label} is high (${channel.targetCac}).`,
          severity: 'MEDIUM',
          channelKey: channel.key,
        });
        recs.push({
          type: 'REDUCE_CAC',
          title: `Reduce target CAC for ${channel.label}`,
          insight: 'High target CAC can erode unit economics.',
          diagnosis: `Target CAC for ${channel.label} exceeds healthy thresholds.`,
          recommendation:
            'Audit funnel conversion, creative quality, and audience targeting for this channel.',
          expectedGain: 'Improve blended CAC and LTV/CAC ratio.',
          riskLevel: 'MEDIUM',
          effortLevel: 'MEDIUM',
          channelKey: channel.key,
        });
      }
    }

    if (activeChannels.length < 2) {
      recs.push({
        type: 'ADD_CHANNELS',
        title: 'Add active growth channels',
        insight: 'A single active channel creates fragility.',
        diagnosis: 'Fewer than two active growth channels are recorded.',
        recommendation:
          'Identify and activate at least one additional owned, earned, or paid channel.',
        expectedGain: 'Improve diversification and reduce acquisition risk.',
        riskLevel: activeChannels.length === 0 ? 'HIGH' : 'MEDIUM',
        effortLevel: 'MEDIUM',
      });
    }

    if (missingInputs.length > 0) {
      recs.push({
        type: 'COMPLETE_MARKETING_INPUTS',
        title: 'Complete missing marketing/growth inputs',
        insight: 'Missing inputs reduce confidence and actionability.',
        diagnosis: `Missing inputs: ${missingInputs.join(', ')}.`,
        recommendation:
          'Record growth channels, content strategy, target CAC, and conversion rates.',
        expectedGain: 'Increase marketing genome confidence and readiness.',
        riskLevel: 'MEDIUM',
        effortLevel: 'LOW',
      });
    }

    const cacRiskLevel = cacRisk(blendedCac);
    const strategyRiskLevel = contentStrategyRisk(strategies);
    const overall = overallRisk([
      concentrationRisk,
      cacRiskLevel,
      strategyRiskLevel,
    ]);

    const snapshotRow = await this.prisma.client.genomeMarketingSnapshot.create({
      data: {
        businessId,
        period: period ?? null,
        channelMix: asJsonValue(mix),
        leadVolumeEstimate: leadVolumeEstimate ?? null,
        blendedCac: blendedCac ?? null,
        contentConsistencyScore,
        channelDiversificationScore,
        funnelConversionEstimate: funnelConversionEstimate ?? null,
        overallRisk: overall,
        missingInputs: asJsonValue(missingInputs),
        warnings: asJsonValue(warnings),
        recommendations: asJsonValue(recs),
        computedAt: new Date(),
      },
    });

    await this.memory.createMemoryEvent({
      businessId,
      sourceType: 'MARKETING_GROWTH_GENOME',
      eventType: 'MARKETING_GROWTH_SNAPSHOT_COMPUTED',
      domain: 'MARKETING_GROWTH',
      section: 'MARKETING_GROWTH',
      title: 'Marketing/growth snapshot computed',
      summary: `Overall risk ${overall}, diversification ${channelDiversificationScore.toFixed(
        0,
      )}, consistency ${contentConsistencyScore.toFixed(0)}. ${warnings.length} warning(s), ${missingInputs.length} missing input(s).`,
      outcome: overall === 'CRITICAL' || overall === 'HIGH' ? 'MIXED' : 'SUCCESS',
      impactScore:
        (channelDiversificationScore + contentConsistencyScore) / 2 / 100,
      confidenceDelta: 0,
      metadata: {
        period: period ?? null,
        channelDiversificationScore,
        contentConsistencyScore,
        overallRisk: overall,
      },
      occurredAt: new Date().toISOString(),
    });

    await Promise.all([
      this.departmentReadiness.computeOneDepartment(businessId, 'CMO_MARKETING'),
      this.departmentReadiness.computeOneDepartment(businessId, 'SALES'),
    ]);

    return this.toSnapshotDomain(snapshotRow);
  }

  async getLatestMarketingGrowthSnapshot(
    businessId: string,
  ): Promise<GenomeMarketingGrowthSnapshotData | null> {
    const row = await this.prisma.client.genomeMarketingSnapshot.findFirst({
      where: { businessId },
      orderBy: { computedAt: 'desc' },
    });
    return row ? this.toSnapshotDomain(row) : null;
  }

  async listMarketingGrowthSnapshots(
    businessId: string,
    filters: ListGenomeMarketingGrowthSnapshotsQuery = {},
  ): Promise<GenomeMarketingGrowthSnapshotData[]> {
    const rows = await this.prisma.client.genomeMarketingSnapshot.findMany({
      where: {
        businessId,
        ...(filters.period !== undefined ? { period: filters.period } : {}),
        ...(filters.riskLevel ? { overallRisk: filters.riskLevel } : {}),
      },
      orderBy: { computedAt: 'desc' },
      take: filters.limit,
    });
    return rows.map((r) => this.toSnapshotDomain(r));
  }

  async generateMarketingGrowthSignals(
    businessId: string,
  ): Promise<import('./key-genome.types').GenomeSignalData[]> {
    const snapshot = await this.getLatestMarketingGrowthSnapshot(businessId);
    if (!snapshot) {
      return [];
    }

    const inputs: CreateGenomeSignalInput[] = [];

    for (const warning of snapshot.warnings) {
      let signalType: string;
      switch (warning.type) {
        case 'CHANNEL_CONCENTRATION':
          signalType = 'MARKET_PATTERN';
          break;
        case 'NO_CONTENT_STRATEGY':
        case 'MISSING_CONTENT_PILLARS':
        case 'MISSING_CONTENT_CADENCE':
          signalType = 'MISSING_FACT';
          break;
        case 'HIGH_TARGET_CAC':
          signalType = 'RISK_PATTERN';
          break;
        default:
          signalType = 'RISK_PATTERN';
      }

      inputs.push({
        businessId,
        sourceModule: 'marketing',
        sourceEntityType: 'MARKETING_GROWTH_GENOME',
        signalType,
        section: 'MARKETING_GROWTH',
        domain: 'marketing_growth',
        field: warning.type,
        reason: warning.message,
        confidence:
          warning.severity === 'CRITICAL'
            ? 0.95
            : warning.severity === 'HIGH'
              ? 0.85
              : 0.7,
      });
    }

    if (snapshot.missingInputs.length > 0) {
      inputs.push({
        businessId,
        sourceModule: 'marketing',
        sourceEntityType: 'MARKETING_GROWTH_GENOME',
        signalType: 'MISSING_FACT',
        section: 'MARKETING_GROWTH',
        domain: 'marketing_growth',
        field: 'missing_inputs',
        reason: `Missing marketing/growth inputs: ${snapshot.missingInputs.join(', ')}`,
        confidence: 0.75,
      });
    }

    const signals = await this.signals.createSignals(inputs);

    if (signals.length > 0) {
      await this.prisma.client.genomeMarketingSnapshot.update({
        where: { id: snapshot.id },
        data: { signalsGeneratedAt: new Date() },
      });

      await this.memory.createMemoryEvent({
        businessId,
        sourceType: 'MARKETING_GROWTH_GENOME',
        eventType: 'MARKETING_GROWTH_SIGNAL_GENERATED',
        domain: 'MARKETING_GROWTH',
        section: 'MARKETING_GROWTH',
        title: 'Marketing/growth signals generated',
        summary: `${signals.length} marketing/growth signal(s) generated from latest snapshot.`,
        outcome: 'SUCCESS',
        impactScore: 0.5,
        confidenceDelta: 0,
        metadata: { count: signals.length },
        occurredAt: new Date().toISOString(),
      });
    }

    return signals;
  }

  async generateMarketingGrowthRecommendations(
    businessId: string,
  ): Promise<import('./key-genome.types').GenomeRecommendationData[]> {
    const snapshot = await this.getLatestMarketingGrowthSnapshot(businessId);
    if (!snapshot) {
      return [];
    }

    const created: Promise<import('./key-genome.types').GenomeRecommendationData>[] = [];
    for (const rec of snapshot.recommendations) {
      const input: CreateGenomeRecommendationInput = {
        businessId,
        domain: 'MARKETING_GROWTH',
        title: rec.title,
        insight: rec.insight,
        diagnosis: rec.diagnosis,
        recommendation: rec.recommendation,
        expectedGain: rec.expectedGain ?? 'Improve marketing/growth performance and reduce risk.',
        expectedGainScore:
          rec.riskLevel === 'CRITICAL'
            ? 90
            : rec.riskLevel === 'HIGH'
              ? 70
              : rec.riskLevel === 'MEDIUM'
                ? 50
                : 30,
        riskLevel: toRecommendationRiskLevel(rec.riskLevel),
        effortLevel: rec.effortLevel,
        confidence: 0.75,
        source: 'READINESS_GAP',
      };
      created.push(this.recommendations.createRecommendation(input));
    }

    const recommendations = await Promise.all(created);

    if (recommendations.length > 0) {
      await this.prisma.client.genomeMarketingSnapshot.update({
        where: { id: snapshot.id },
        data: { recommendationsGeneratedAt: new Date() },
      });

      await this.memory.createMemoryEvent({
        businessId,
        sourceType: 'MARKETING_GROWTH_GENOME',
        eventType: 'MARKETING_GROWTH_RECOMMENDATION_GENERATED',
        domain: 'MARKETING_GROWTH',
        section: 'MARKETING_GROWTH',
        title: 'Marketing/growth recommendations generated',
        summary: `${recommendations.length} marketing/growth recommendation(s) created.`,
        outcome: 'SUCCESS',
        impactScore: 0.5,
        confidenceDelta: 0,
        metadata: { count: recommendations.length },
        occurredAt: new Date().toISOString(),
      });
    }

    return recommendations;
  }

  private toSnapshotDomain(row: {
    id: string;
    businessId: string;
    period: string | null;
    channelMix: unknown;
    leadVolumeEstimate: number | null;
    blendedCac: number | null;
    contentConsistencyScore: number;
    channelDiversificationScore: number;
    funnelConversionEstimate: number | null;
    overallRisk: string;
    missingInputs: unknown;
    warnings: unknown;
    recommendations: unknown;
    computedAt: Date;
  }): GenomeMarketingGrowthSnapshotData {
    return {
      id: row.id,
      businessId: row.businessId,
      period: row.period ?? null,
      channelMix: Array.isArray(row.channelMix)
        ? (row.channelMix as GenomeMarketingGrowthChannelMixItem[])
        : [],
      leadVolumeEstimate: row.leadVolumeEstimate,
      blendedCac: row.blendedCac,
      contentConsistencyScore: row.contentConsistencyScore,
      channelDiversificationScore: row.channelDiversificationScore,
      funnelConversionEstimate: row.funnelConversionEstimate,
      overallRisk: row.overallRisk as GenomeMarketingGrowthRiskLevel,
      missingInputs: Array.isArray(row.missingInputs) ? (row.missingInputs as string[]) : [],
      warnings: Array.isArray(row.warnings)
        ? (row.warnings as GenomeMarketingGrowthWarning[])
        : [],
      recommendations: Array.isArray(row.recommendations)
        ? (row.recommendations as GenomeMarketingGrowthRecommendation[])
        : [],
      computedAt: row.computedAt.toISOString(),
    };
  }
}
