import { Injectable, Inject, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { GuidanceFinancialService, FinanceData, FinancialMetrics } from './guidance-financial.service';
import { GuidanceScoringService, ProfileData, OperationsData, GrowthData, FinanceProfileData, DimensionScores, ScoreBreakdown } from './guidance-scoring.service';
import { GuidanceFlagsService, BusinessFlag } from './guidance-flags.service';

interface AssessmentOutput {
  scores: DimensionScores;
  financialMetrics: FinancialMetrics;
  flags: BusinessFlag[];
  strongestArea: string;
  weakestArea: string;
  scoreBreakdown: ScoreBreakdown;
}

const DIMENSION_LABELS: Record<string, string> = {
  clarity: 'Business Clarity',
  readiness: 'Readiness',
  profitability: 'Profitability',
  operations: 'Operational Maturity',
  growth: 'Growth',
  safety: 'Safety',
};

@Injectable()
export class GuidanceAssessmentService {
  private readonly logger = new Logger(GuidanceAssessmentService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(GuidanceFinancialService) private readonly financialService: GuidanceFinancialService,
    @Inject(GuidanceScoringService) private readonly scoringService: GuidanceScoringService,
    @Inject(GuidanceFlagsService) private readonly flagsService: GuidanceFlagsService,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  async runAnalysis(businessId: string): Promise<AssessmentOutput> {
    const guidanceProfile = await this.db.businessGuidanceProfile.findUnique({
      where: { businessId },
      include: {
        identity: true,
        founder: true,
        offer: true,
        customer: true,
        revenue: true,
        finance: true,
        operations: true,
        compliance: true,
        growth: true,
        goals: true,
      },
    });

    const profileData = this.normalizeProfileData(guidanceProfile);
    const financeData = this.normalizeFinanceData(guidanceProfile);
    const opsData = this.normalizeOperationsData(guidanceProfile);
    const growthData = this.normalizeGrowthData(guidanceProfile);
    const financeProfileData: FinanceProfileData = {
      pricePerUnit: guidanceProfile?.offer?.priceRangeLow ?? undefined,
      variableCostPerUnit: guidanceProfile?.offer?.productionCost ?? undefined,
      fixedMonthlyCosts: guidanceProfile?.finance?.monthlyFixedCosts ?? undefined,
      monthlyTargetRevenue: guidanceProfile?.revenue?.targetMonthlyRevenue ?? undefined,
      monthlyTargetVolume: undefined,
    };

    const financialMetrics = this.financialService.calculate(financeData);

    const { scores, breakdown } = this.scoringService.score(
      profileData,
      financeProfileData,
      opsData,
      growthData,
      financialMetrics,
    );

    const flags = this.flagsService.detect(profileData, opsData, growthData, financialMetrics);

    const dimensionMap: Record<string, number> = {
      clarity: scores.clarity,
      readiness: scores.readiness,
      profitability: scores.profitability,
      operations: scores.operations,
      growth: scores.growth,
      safety: scores.safety,
    };

    let strongestKey = 'clarity';
    let weakestKey = 'clarity';
    for (const [key, val] of Object.entries(dimensionMap)) {
      if (val > dimensionMap[strongestKey]) strongestKey = key;
      if (val < dimensionMap[weakestKey]) weakestKey = key;
    }

    const result: AssessmentOutput = {
      scores,
      financialMetrics,
      flags,
      strongestArea: DIMENSION_LABELS[strongestKey] || strongestKey,
      weakestArea: DIMENSION_LABELS[weakestKey] || weakestKey,
      scoreBreakdown: breakdown,
    };

    await this.persistResult(businessId, guidanceProfile?.id ?? null, result);

    return result;
  }

  private normalizeProfileData(gp: any): ProfileData {
    if (!gp) return {};

    return {
      offerDescription: gp.offer?.primaryOffer ?? null,
      problemSolved: gp.identity?.missionStatement ?? null,
      idealCustomer: gp.customer?.targetDemographic ?? null,
      audienceSpecificity: gp.customer?.targetDemographic ?? null,
      differentiator: gp.identity?.uniqueSellingPoint ?? gp.offer?.differentiators?.join(', ') ?? null,
      revenueModel: gp.revenue?.revenueStreams?.join(', ') ?? null,
      pricingModel: gp.offer?.pricingModel ?? null,
      valueProposition: gp.offer?.valueProposition ?? null,
      isRegistered: gp.compliance?.businessRegistered ?? false,
      businessStructure: gp.compliance?.registrationType ?? null,
      hasTaxId: !!(gp.compliance?.taxIdNumber),
      hasBankAccount: false,
      hasLicenses: (gp.compliance?.licensesHeld?.length ?? 0) > 0,
      hasInsurance: gp.compliance?.hasBusinessInsurance ?? false,
      hasBookkeeping: gp.finance?.hasBookkeeper ?? gp.finance?.hasAccountant ?? false,
      hasContracts: false,
      hasPrivacyPolicy: gp.compliance?.dataProtectionCompliant ?? false,
      hasTerms: false,
      hasSecurityControls: false,
      isLaunched: gp.status === 'SUBMITTED' || gp.status === 'ASSESSED',
      collectsData: gp.customer?.currentCustomerCount != null && gp.customer.currentCustomerCount > 0,
      hasRevenue: (gp.revenue?.monthlyRevenue ?? 0) > 0,
      businessType: gp.offer?.offerType ?? null,
      teamSize: this.normalizeTeamSize(gp.operations),
      founderDeliveryLoad: this.normalizeFounderLoad(gp.founder),
    };
  }

  private normalizeFinanceData(gp: any): FinanceData {
    if (!gp) return {};

    return {
      pricePerUnit: gp.offer?.priceRangeLow ?? null,
      variableCostPerUnit: gp.offer?.productionCost ?? null,
      fixedMonthlyCosts: gp.finance?.monthlyFixedCosts ?? null,
      taxRate: null,
      cashOnHand: gp.finance?.currentCashReserve ?? null,
      actualMonthlyRevenue: gp.revenue?.monthlyRevenue ?? null,
      projectedMonthlyVolume: null,
      projectedPrice: gp.offer?.priceRangeHigh ?? gp.offer?.priceRangeLow ?? null,
      monthlyTargetRevenue: gp.revenue?.targetMonthlyRevenue ?? null,
      monthlyTargetVolume: null,
      repeatCustomerPct: null,
      leadCount: gp.customer?.monthlyNewCustomers ?? null,
      conversionRate: null,
    };
  }

  private normalizeOperationsData(gp: any): OperationsData {
    if (!gp?.operations) return {};

    const ops = gp.operations;
    return {
      hasDeliverySteps: (ops.keyProcesses?.length ?? 0) > 0,
      hasDefinedRoles: (ops.fullTimeEmployees ?? 0) > 0 || (ops.partTimeEmployees ?? 0) > 0,
      hasOnboarding: false,
      hasSupportProcess: !!(ops.qualityControlProcess),
      hasRetentionProcess: !!(gp.customer?.retentionStrategy),
      hasWorkflowDocs: (ops.keyProcesses?.length ?? 0) > 2,
      hasBottleneckAwareness: (ops.bottlenecks?.length ?? 0) > 0,
      hasTools: (ops.toolsUsed?.length ?? 0) > 0,
    };
  }

  private normalizeGrowthData(gp: any): GrowthData {
    if (!gp?.growth) return {};

    const g = gp.growth;
    const channels = g.marketingChannels ?? [];
    return {
      hasLeadSource: channels.length > 0,
      channelCount: channels.length,
      channels,
      hasCrm: false,
      hasPipeline: false,
      hasConversionTracking: false,
      hasReferralProgram: g.referralProgram ?? false,
      hasRetentionStrategy: !!(gp.customer?.retentionStrategy),
    };
  }

  private normalizeTeamSize(ops: any): string | null {
    if (!ops) return 'SOLO';
    const total = (ops.teamSize ?? 0) + (ops.fullTimeEmployees ?? 0) + (ops.partTimeEmployees ?? 0) + (ops.contractors ?? 0);
    if (total <= 1) return 'SOLO';
    if (total <= 5) return 'SMALL_TEAM';
    return 'GROWING';
  }

  private normalizeFounderLoad(founder: any): string | null {
    if (!founder) return null;
    const hours = founder.weeklyHoursAvailable ?? 0;
    if (hours >= 50) return 'CRITICAL';
    if (hours >= 40) return 'HIGH';
    if (hours >= 20) return 'MEDIUM';
    return 'LOW';
  }

  private async persistResult(businessId: string, guidanceProfileId: string | null, output: AssessmentOutput): Promise<void> {
    await this.db.$transaction(async (tx) => {
      if (guidanceProfileId) {
        const existingResult = await tx.assessmentResult.findFirst({
          where: { guidanceProfileId },
          orderBy: { createdAt: 'desc' },
        });

        if (existingResult) {
          await tx.progressSnapshot.create({
            data: {
              guidanceProfileId,
              overallScore: existingResult.overallScore,
              categoryScores: existingResult.categoryScores ?? undefined,
              snapshotDate: new Date(),
            },
          });
        }

        await tx.assessmentResult.create({
          data: {
            guidanceProfileId,
            overallScore: output.scores.overall,
            categoryScores: {
              clarity: output.scores.clarity,
              readiness: output.scores.readiness,
              profitability: output.scores.profitability,
              operations: output.scores.operations,
              growth: output.scores.growth,
              risk: output.scores.risk,
              safety: output.scores.safety,
            },
            strengths: [output.strongestArea],
            weaknesses: [output.weakestArea],
            risks: output.flags.filter(f => f.severity === 'critical').map(f => f.title),
            opportunities: [],
            metrics: output.financialMetrics as unknown as Record<string, unknown>,
            flags: output.flags.map(f => f.id),
          },
        });

        await tx.businessGuidanceProfile.update({
          where: { id: guidanceProfileId },
          data: { status: 'ASSESSED' },
        });
      }
    });

    this.logger.log(`Assessment persisted for business ${businessId}: overall=${output.scores.overall}`);
  }

  async getAssessment(businessId: string) {
    const profile = await this.db.businessGuidanceProfile.findUnique({
      where: { businessId },
    });

    if (!profile) {
      throw new NotFoundException('Guidance profile not found.');
    }

    const latest = await this.db.assessmentResult.findFirst({
      where: { guidanceProfileId: profile.id },
      orderBy: { createdAt: 'desc' },
    });

    return { assessment: latest ?? null, profileStatus: profile.status };
  }

  async getDashboard(businessId: string) {
    const profile = await this.db.businessGuidanceProfile.findUnique({
      where: { businessId },
      include: {
        assessmentResults: { orderBy: { createdAt: 'desc' }, take: 1 },
        recommendations: { where: { status: { not: 'DISMISSED' } }, orderBy: { priority: 'desc' }, take: 5 },
        roadmapItems: { where: { status: { not: 'SKIPPED' } }, orderBy: { sequenceOrder: 'asc' }, take: 5 },
        progressSnapshots: { orderBy: { snapshotDate: 'desc' }, take: 10 },
      },
    });

    if (!profile) {
      return {
        status: 'NOT_STARTED',
        latestAssessment: null,
        topRecommendations: [],
        nextRoadmapItems: [],
        progressHistory: [],
      };
    }

    return {
      status: profile.status,
      latestAssessment: profile.assessmentResults[0] ?? null,
      topRecommendations: profile.recommendations,
      nextRoadmapItems: profile.roadmapItems,
      progressHistory: profile.progressSnapshots,
    };
  }

  async getProgress(businessId: string) {
    const profile = await this.db.businessGuidanceProfile.findUnique({
      where: { businessId },
    });

    if (!profile) {
      throw new NotFoundException('Guidance profile not found.');
    }

    const snapshots = await this.db.progressSnapshot.findMany({
      where: { guidanceProfileId: profile.id },
      orderBy: { snapshotDate: 'desc' },
      take: 30,
    });

    const [recommendations, roadmapItems] = await Promise.all([
      this.db.guidanceRecommendation.groupBy({
        by: ['status'],
        where: { guidanceProfileId: profile.id },
        _count: true,
      }),
      this.db.roadmapItem.groupBy({
        by: ['status'],
        where: { guidanceProfileId: profile.id },
        _count: true,
      }),
    ]);

    return {
      snapshots,
      recommendationsByStatus: recommendations.map((r) => ({ status: r.status, count: r._count })),
      roadmapByStatus: roadmapItems.map((r) => ({ status: r.status, count: r._count })),
    };
  }
}
