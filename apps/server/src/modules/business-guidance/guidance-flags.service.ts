import { Injectable, Logger } from '@nestjs/common';
import { ProfileData, GrowthData, OperationsData } from './guidance-scoring.service';
import { FinancialMetrics } from './guidance-financial.service';

export interface BusinessFlag {
  id: string;
  category: 'offer_clarity' | 'readiness' | 'profitability' | 'operations' | 'growth' | 'founder_dependency';
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  description: string;
  suggestedAction: string;
}

@Injectable()
export class GuidanceFlagsService {
  private readonly logger = new Logger(GuidanceFlagsService.name);

  detect(
    profile: ProfileData,
    operations: OperationsData,
    growth: GrowthData,
    metrics: FinancialMetrics,
  ): BusinessFlag[] {
    const flags: BusinessFlag[] = [];

    this.detectOfferClarity(profile, flags);
    this.detectReadiness(profile, flags);
    this.detectProfitability(profile, metrics, flags);
    this.detectOperations(profile, operations, flags);
    this.detectGrowth(growth, flags);
    this.detectFounderDependency(profile, flags);

    return flags;
  }

  private detectOfferClarity(p: ProfileData, flags: BusinessFlag[]): void {
    if (!p.offerDescription || p.offerDescription.trim().length < 10) {
      flags.push({
        id: 'offer_vague_description',
        category: 'offer_clarity',
        severity: 'high',
        title: 'Vague Offer Description',
        description: 'Your offer description is missing or too brief to communicate value to customers.',
        suggestedAction: 'Write a clear 2-3 sentence description of what you offer and the outcome customers get.',
      });
    }

    if (p.audienceSpecificity) {
      const lower = p.audienceSpecificity.trim().toLowerCase();
      const vagueTerms = ['everyone', 'anyone', 'all people', 'general public', 'everybody'];
      if (vagueTerms.some(t => lower.includes(t))) {
        flags.push({
          id: 'offer_broad_audience',
          category: 'offer_clarity',
          severity: 'medium',
          title: 'Audience Too Broad',
          description: 'Targeting "everyone" makes it harder to attract anyone. Narrow your focus.',
          suggestedAction: 'Define a specific ideal customer persona with demographics, needs, and pain points.',
        });
      }
    }

    if (!p.differentiator || p.differentiator.trim().length < 5) {
      flags.push({
        id: 'offer_no_differentiator',
        category: 'offer_clarity',
        severity: 'medium',
        title: 'No Differentiator',
        description: 'You haven\'t defined what makes you different from competitors.',
        suggestedAction: 'Identify 1-2 things you do differently or better than alternatives and document them.',
      });
    }
  }

  private detectReadiness(p: ProfileData, flags: BusinessFlag[]): void {
    if (p.isLaunched && !p.isRegistered) {
      flags.push({
        id: 'readiness_unregistered_launched',
        category: 'readiness',
        severity: 'critical',
        title: 'Operating Without Registration',
        description: 'Your business is launched but not formally registered, which may have legal implications.',
        suggestedAction: 'Register your business with the appropriate government authority as soon as possible.',
      });
    }

    if (p.collectsData && !p.hasPrivacyPolicy) {
      flags.push({
        id: 'readiness_no_privacy_policy',
        category: 'readiness',
        severity: 'critical',
        title: 'Collecting Data Without Privacy Policy',
        description: 'You collect customer data but have no privacy policy, which may violate data protection laws.',
        suggestedAction: 'Create and publish a privacy policy that explains what data you collect and how you use it.',
      });
    }

    if (p.hasRevenue && !p.hasTaxId) {
      flags.push({
        id: 'readiness_no_tax_id',
        category: 'readiness',
        severity: 'high',
        title: 'Earning Revenue Without Tax ID',
        description: 'You\'re generating revenue but haven\'t registered for taxes.',
        suggestedAction: 'Apply for a tax identification number and set up proper tax accounting.',
      });
    }
  }

  private detectProfitability(
    p: ProfileData,
    m: FinancialMetrics,
    flags: BusinessFlag[],
  ): void {
    if (m.contributionMarginPerUnit <= 0 && m.monthlyRevenueEstimate > 0) {
      flags.push({
        id: 'profit_negative_margin',
        category: 'profitability',
        severity: 'critical',
        title: 'Negative Contribution Margin',
        description: 'Your variable costs per unit exceed your price — you lose money on every sale.',
        suggestedAction: 'Either raise your prices or find ways to reduce your variable costs per unit.',
      });
    }

    if (
      m.breakEvenFlag === 'Break-even volume exceeds projected monthly volume'
    ) {
      flags.push({
        id: 'profit_breakeven_above_projection',
        category: 'profitability',
        severity: 'high',
        title: 'Break-Even Above Projected Volume',
        description: 'You need to sell more units than your projection to break even.',
        suggestedAction: 'Review your cost structure and pricing to lower the break-even point, or increase your sales projection.',
      });
    }

    if (
      m.totalMonthlyOperatingCosts > 0 &&
      m.monthlyRevenueEstimate > 0 &&
      m.totalMonthlyOperatingCosts / m.monthlyRevenueEstimate > 0.8
    ) {
      flags.push({
        id: 'profit_high_cost_burden',
        category: 'profitability',
        severity: 'high',
        title: 'High Cost Burden',
        description: 'Operating costs consume more than 80% of your revenue, leaving little profit margin.',
        suggestedAction: 'Review each cost category for reduction opportunities. Consider which costs can be deferred or eliminated.',
      });
    }
  }

  private detectOperations(
    p: ProfileData,
    o: OperationsData,
    flags: BusinessFlag[],
  ): void {
    const isService = p.businessType?.toUpperCase() === 'SERVICE' ||
      p.businessType?.toUpperCase() === 'CONSULTING' ||
      p.businessType?.toUpperCase() === 'AGENCY' ||
      p.businessType?.toUpperCase() === 'LOCAL_SERVICE';

    if (isService && !o.hasOnboarding) {
      flags.push({
        id: 'ops_no_onboarding',
        category: 'operations',
        severity: 'medium',
        title: 'No Client Onboarding Process',
        description: 'Service businesses benefit from a defined onboarding process to set expectations.',
        suggestedAction: 'Create a simple onboarding checklist or welcome sequence for new clients.',
      });
    }

    const hasTeam = p.teamSize && p.teamSize !== 'SOLO';
    if (hasTeam && !o.hasWorkflowDocs) {
      flags.push({
        id: 'ops_no_workflow_docs',
        category: 'operations',
        severity: 'medium',
        title: 'No Workflow Documentation',
        description: 'You have a team but no documented workflows, which can lead to inconsistency.',
        suggestedAction: 'Document your core delivery workflow so team members can follow a standard process.',
      });
    }
  }

  private detectGrowth(g: GrowthData, flags: BusinessFlag[]): void {
    if ((g.channelCount ?? 0) === 0 && !g.hasLeadSource) {
      flags.push({
        id: 'growth_no_channels',
        category: 'growth',
        severity: 'high',
        title: 'No Marketing Channels',
        description: 'You have no defined channels to attract leads or customers.',
        suggestedAction: 'Choose 1-2 marketing channels that match your audience (social media, search, referrals, etc.).',
      });
    }

    if (!g.hasConversionTracking) {
      flags.push({
        id: 'growth_no_conversion_tracking',
        category: 'growth',
        severity: 'medium',
        title: 'No Conversion Tracking',
        description: 'You\'re not tracking how leads become customers, making it hard to optimize.',
        suggestedAction: 'Set up basic conversion tracking — even a simple spreadsheet can help measure lead-to-customer rates.',
      });
    }

    if (!g.hasRetentionStrategy) {
      flags.push({
        id: 'growth_no_retention',
        category: 'growth',
        severity: 'medium',
        title: 'No Retention Strategy',
        description: 'Without a retention strategy, you rely entirely on new customer acquisition.',
        suggestedAction: 'Implement a follow-up system for existing customers (email sequences, loyalty offers, check-ins).',
      });
    }
  }

  private detectFounderDependency(p: ProfileData, flags: BusinessFlag[]): void {
    if (
      (p.teamSize === 'SOLO' || !p.teamSize) &&
      (p.founderDeliveryLoad === 'HIGH' || p.founderDeliveryLoad === 'CRITICAL')
    ) {
      flags.push({
        id: 'founder_dependency',
        category: 'founder_dependency',
        severity: 'high',
        title: 'High Founder Dependency',
        description: 'You\'re solo with heavy delivery dependence — the business can\'t operate without you.',
        suggestedAction: 'Document your processes, consider hiring or outsourcing, and build systems that reduce your involvement in delivery.',
      });
    }
  }
}
