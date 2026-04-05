import { Injectable, Logger } from '@nestjs/common';
import { FinancialMetrics } from './guidance-financial.service';

export interface ProfileData {
  offerDescription?: string | null;
  problemSolved?: string | null;
  idealCustomer?: string | null;
  audienceSpecificity?: string | null;
  differentiator?: string | null;
  revenueModel?: string | null;
  pricingModel?: string | null;
  valueProposition?: string | null;

  isRegistered?: boolean;
  businessStructure?: string | null;
  hasTaxId?: boolean;
  hasBankAccount?: boolean;
  hasLicenses?: boolean;
  hasInsurance?: boolean;
  hasBookkeeping?: boolean;
  hasContracts?: boolean;
  hasPrivacyPolicy?: boolean;
  hasTerms?: boolean;
  hasSecurityControls?: boolean;

  isLaunched?: boolean;
  collectsData?: boolean;
  hasRevenue?: boolean;
  businessType?: string | null;
  teamSize?: string | null;
  founderDeliveryLoad?: string | null;
}

export interface OperationsData {
  hasDeliverySteps?: boolean;
  hasDefinedRoles?: boolean;
  hasOnboarding?: boolean;
  hasSupportProcess?: boolean;
  hasRetentionProcess?: boolean;
  hasWorkflowDocs?: boolean;
  hasBottleneckAwareness?: boolean;
  hasTools?: boolean;
}

export interface GrowthData {
  hasLeadSource?: boolean;
  channelCount?: number;
  channels?: string[];
  hasCrm?: boolean;
  hasPipeline?: boolean;
  hasConversionTracking?: boolean;
  hasReferralProgram?: boolean;
  hasRetentionStrategy?: boolean;
}

export interface FinanceProfileData {
  pricePerUnit?: number | null;
  variableCostPerUnit?: number | null;
  fixedMonthlyCosts?: number | null;
  monthlyTargetRevenue?: number | null;
  monthlyTargetVolume?: number | null;
}

export interface DimensionScores {
  clarity: number;
  readiness: number;
  profitability: number;
  operations: number;
  growth: number;
  risk: number;
  safety: number;
  overall: number;
}

export interface ScoreBreakdown {
  clarity: Record<string, number>;
  readiness: Record<string, number>;
  profitability: Record<string, number>;
  operations: Record<string, number>;
  growth: Record<string, number>;
  risk: Record<string, number>;
}

const HEALTH_WEIGHTS = {
  clarity: 0.20,
  readiness: 0.20,
  profitability: 0.20,
  operations: 0.15,
  growth: 0.15,
  safety: 0.10,
};

@Injectable()
export class GuidanceScoringService {
  private readonly logger = new Logger(GuidanceScoringService.name);

  score(
    profile: ProfileData,
    finance: FinanceProfileData,
    operations: OperationsData,
    growth: GrowthData,
    metrics: FinancialMetrics,
  ): { scores: DimensionScores; breakdown: ScoreBreakdown } {
    const clarityBreakdown = this.scoreClarityComponents(profile);
    const readinessBreakdown = this.scoreReadinessComponents(profile);
    const profitabilityBreakdown = this.scoreProfitabilityComponents(finance, metrics);
    const operationsBreakdown = this.scoreOperationsComponents(operations);
    const growthBreakdown = this.scoreGrowthComponents(growth);
    const riskBreakdown = this.scoreRiskComponents(profile, growth, metrics);

    const clarity = this.clampScore(this.sumValues(clarityBreakdown));
    const readiness = this.clampScore(this.sumValues(readinessBreakdown));
    const profitability = this.clampScore(this.sumValues(profitabilityBreakdown));
    const ops = this.clampScore(this.sumValues(operationsBreakdown));
    const growthScore = this.clampScore(this.sumValues(growthBreakdown));
    const risk = this.clampScore(this.sumValues(riskBreakdown));
    const safety = 100 - risk;

    const overall = Math.round(
      clarity * HEALTH_WEIGHTS.clarity +
      readiness * HEALTH_WEIGHTS.readiness +
      profitability * HEALTH_WEIGHTS.profitability +
      ops * HEALTH_WEIGHTS.operations +
      growthScore * HEALTH_WEIGHTS.growth +
      safety * HEALTH_WEIGHTS.safety
    );

    return {
      scores: {
        clarity,
        readiness,
        profitability,
        operations: ops,
        growth: growthScore,
        risk,
        safety,
        overall: this.clampScore(overall),
      },
      breakdown: {
        clarity: clarityBreakdown,
        readiness: readinessBreakdown,
        profitability: profitabilityBreakdown,
        operations: operationsBreakdown,
        growth: growthBreakdown,
        risk: riskBreakdown,
      },
    };
  }

  private scoreClarityComponents(p: ProfileData): Record<string, number> {
    return {
      offerDescription: this.textScore(p.offerDescription, 15),
      problemSolved: this.textScore(p.problemSolved, 15),
      idealCustomer: this.textScore(p.idealCustomer, 12),
      audienceSpecificity: this.specificityScore(p.audienceSpecificity, 12),
      differentiator: this.textScore(p.differentiator, 14),
      revenueModel: this.presentScore(p.revenueModel, 12),
      pricingModel: this.presentScore(p.pricingModel, 10),
      valueProposition: this.textScore(p.valueProposition, 10),
    };
  }

  private scoreReadinessComponents(p: ProfileData): Record<string, number> {
    return {
      registration: p.isRegistered ? 12 : 0,
      businessStructure: this.presentScore(p.businessStructure, 8),
      taxId: p.hasTaxId ? 10 : 0,
      bankAccount: p.hasBankAccount ? 10 : 0,
      licenses: p.hasLicenses ? 8 : 0,
      insurance: p.hasInsurance ? 8 : 0,
      bookkeeping: p.hasBookkeeping ? 10 : 0,
      contracts: p.hasContracts ? 10 : 0,
      privacyPolicy: p.hasPrivacyPolicy ? 10 : 0,
      terms: p.hasTerms ? 8 : 0,
      securityControls: p.hasSecurityControls ? 6 : 0,
    };
  }

  private scoreProfitabilityComponents(
    f: FinanceProfileData,
    m: FinancialMetrics,
  ): Record<string, number> {
    const hasPricing = (f.pricePerUnit ?? 0) > 0 ? 18 : 0;
    const hasCosts = ((f.variableCostPerUnit ?? 0) > 0 || (f.fixedMonthlyCosts ?? 0) > 0) ? 16 : 0;
    const positiveMargin = m.contributionMarginPerUnit > 0 ? 20 : 0;
    const positiveGrossProfit = m.grossProfit > 0 ? 18 : 0;
    const breakEvenComputed = m.breakEvenVolume != null ? 14 : 0;
    const hasTargets = ((f.monthlyTargetRevenue ?? 0) > 0 || (f.monthlyTargetVolume ?? 0) > 0) ? 14 : 0;

    return {
      pricing: hasPricing,
      costs: hasCosts,
      contributionMargin: positiveMargin,
      grossProfit: positiveGrossProfit,
      breakEven: breakEvenComputed,
      targets: hasTargets,
    };
  }

  private scoreOperationsComponents(o: OperationsData): Record<string, number> {
    return {
      deliverySteps: o.hasDeliverySteps ? 15 : 0,
      roles: o.hasDefinedRoles ? 12 : 0,
      onboarding: o.hasOnboarding ? 14 : 0,
      support: o.hasSupportProcess ? 12 : 0,
      retention: o.hasRetentionProcess ? 12 : 0,
      workflowDocs: o.hasWorkflowDocs ? 12 : 0,
      bottleneckAwareness: o.hasBottleneckAwareness ? 11 : 0,
      tools: o.hasTools ? 12 : 0,
    };
  }

  private scoreGrowthComponents(g: GrowthData): Record<string, number> {
    const channelScore = Math.min(18, (g.channelCount ?? 0) * 6);
    return {
      leadSource: g.hasLeadSource ? 16 : 0,
      channels: channelScore,
      crm: g.hasCrm ? 14 : 0,
      pipeline: g.hasPipeline ? 14 : 0,
      conversion: g.hasConversionTracking ? 14 : 0,
      referrals: g.hasReferralProgram ? 12 : 0,
      retentionStrategy: g.hasRetentionStrategy ? 12 : 0,
    };
  }

  private scoreRiskComponents(
    p: ProfileData,
    g: GrowthData,
    m: FinancialMetrics,
  ): Record<string, number> {
    let founderDep = 0;
    if (
      (p.teamSize === 'SOLO' || !p.teamSize) &&
      (p.founderDeliveryLoad === 'HIGH' || p.founderDeliveryLoad === 'CRITICAL')
    ) {
      founderDep = 20;
    } else if (p.founderDeliveryLoad === 'HIGH') {
      founderDep = 12;
    }

    const missingLegal =
      (!p.isRegistered ? 5 : 0) +
      (!p.hasContracts ? 5 : 0) +
      (!p.hasTerms ? 3 : 0) +
      (!p.hasLicenses ? 3 : 0);

    const poorMargin = m.contributionMarginPerUnit <= 0 ? 18 : m.contributionMarginPct < 20 ? 10 : 0;

    let weakRunway = 0;
    if (m.runwayStatus === 'critical') weakRunway = 18;
    else if (m.runwayStatus === 'limited' && m.runwayMonths != null && m.runwayMonths <= 6) weakRunway = 10;

    const complianceGaps =
      (p.isLaunched && !p.isRegistered ? 5 : 0) +
      (p.hasRevenue && !p.hasTaxId ? 5 : 0);

    const privacyGaps = p.collectsData && !p.hasPrivacyPolicy ? 8 : 0;

    const singleChannel = (g.channelCount ?? 0) <= 1 && g.hasLeadSource ? 10 : 0;

    return {
      founderDependency: founderDep,
      missingLegal: Math.min(missingLegal, 16),
      poorMargin,
      weakRunway,
      complianceGaps: Math.min(complianceGaps, 10),
      privacyGaps,
      singleChannelReliance: singleChannel,
    };
  }

  private textScore(val: string | null | undefined, maxPoints: number): number {
    if (!val || val.trim().length === 0) return 0;
    const len = val.trim().length;
    if (len >= 30) return maxPoints;
    if (len >= 10) return Math.round(maxPoints * 0.6);
    return Math.round(maxPoints * 0.3);
  }

  private specificityScore(val: string | null | undefined, maxPoints: number): number {
    if (!val || val.trim().length === 0) return 0;
    const lower = val.trim().toLowerCase();
    const vagueTerms = ['everyone', 'anyone', 'all people', 'general public', 'everybody'];
    if (vagueTerms.some(t => lower.includes(t))) return Math.round(maxPoints * 0.2);
    if (lower.length >= 20) return maxPoints;
    return Math.round(maxPoints * 0.5);
  }

  private presentScore(val: string | null | undefined, maxPoints: number): number {
    return val && val.trim().length > 0 ? maxPoints : 0;
  }

  private sumValues(obj: Record<string, number>): number {
    return Object.values(obj).reduce((sum, v) => sum + v, 0);
  }

  private clampScore(score: number): number {
    return Math.max(0, Math.min(100, Math.round(score)));
  }
}
