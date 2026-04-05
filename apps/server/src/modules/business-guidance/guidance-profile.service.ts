import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

const VALID_STEPS = [
  'identity',
  'founder',
  'offer',
  'customer',
  'revenue',
  'finance',
  'operations',
  'compliance',
  'growth',
  'goals',
] as const;

type StepId = (typeof VALID_STEPS)[number];

interface StepSaveResult {
  guidanceProfileId: string;
}

@Injectable()
export class GuidanceProfileService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async startProfile(businessId: string) {
    const existing = await this.prisma.client.businessGuidanceProfile.findUnique({
      where: { businessId },
    });

    if (existing) {
      return this.getFullProfile(existing.id);
    }

    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
    });
    if (!business) throw new NotFoundException('Business not found');

    const profile = await this.prisma.client.businessGuidanceProfile.create({
      data: {
        businessId,
        status: 'DRAFT',
        currentStep: 'identity',
      },
    });

    await this.prePopulateFromBusiness(profile.id, business);

    return this.getFullProfile(profile.id);
  }

  async getProfile(businessId: string) {
    const profile = await this.prisma.client.businessGuidanceProfile.findUnique({
      where: { businessId },
    });

    if (!profile) throw new NotFoundException('Guidance profile not found. Start one first.');

    return this.getFullProfile(profile.id);
  }

  async saveStep(businessId: string, stepId: string, data: Record<string, unknown>) {
    if (!VALID_STEPS.includes(stepId as StepId)) {
      throw new BadRequestException(`Invalid step: ${stepId}. Valid steps: ${VALID_STEPS.join(', ')}`);
    }

    const profile = await this.prisma.client.businessGuidanceProfile.findUnique({
      where: { businessId },
    });
    if (!profile) throw new NotFoundException('Guidance profile not found. Start one first.');

    if (profile.status === 'SUBMITTED' || profile.status === 'ASSESSED') {
      throw new BadRequestException('Cannot modify a submitted profile. Use reanalyze instead.');
    }

    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { businessStage: true },
    });

    const step = stepId as StepId;
    const sanitized = this.sanitizeStepData(step, data);

    const stage = business?.businessStage ?? undefined;
    this.validateRequiredFieldsByStage(step, sanitized, stage);

    await this.upsertStepData(profile.id, step, sanitized);

    const completedSteps = new Set(profile.completedSteps);
    completedSteps.add(stepId);

    const nextStepIndex = VALID_STEPS.indexOf(step) + 1;
    const nextStep = nextStepIndex < VALID_STEPS.length ? VALID_STEPS[nextStepIndex] : null;

    await this.prisma.client.businessGuidanceProfile.update({
      where: { id: profile.id },
      data: {
        completedSteps: Array.from(completedSteps),
        currentStep: nextStep ?? profile.currentStep,
        status: 'IN_PROGRESS',
      },
    });

    return this.getFullProfile(profile.id);
  }

  async submitProfile(businessId: string) {
    const profile = await this.prisma.client.businessGuidanceProfile.findUnique({
      where: { businessId },
    });
    if (!profile) throw new NotFoundException('Guidance profile not found.');

    if (profile.status === 'SUBMITTED' || profile.status === 'ASSESSED') {
      throw new BadRequestException('Profile is already submitted.');
    }

    await this.prisma.client.businessGuidanceProfile.update({
      where: { id: profile.id },
      data: {
        status: 'SUBMITTED',
        submittedAt: new Date(),
      },
    });

    return this.getFullProfile(profile.id);
  }

  async getCompletionStatus(businessId: string) {
    const profile = await this.prisma.client.businessGuidanceProfile.findUnique({
      where: { businessId },
      include: {
        identity: { select: { id: true } },
        founder: { select: { id: true } },
        offer: { select: { id: true } },
        customer: { select: { id: true } },
        revenue: { select: { id: true } },
        finance: { select: { id: true } },
        operations: { select: { id: true } },
        compliance: { select: { id: true } },
        growth: { select: { id: true } },
        goals: { select: { id: true } },
      },
    });

    if (!profile) throw new NotFoundException('Guidance profile not found.');

    const stepCompletionMap: Record<StepId, boolean> = {
      identity: !!profile.identity,
      founder: !!profile.founder,
      offer: !!profile.offer,
      customer: !!profile.customer,
      revenue: !!profile.revenue,
      finance: !!profile.finance,
      operations: !!profile.operations,
      compliance: !!profile.compliance,
      growth: !!profile.growth,
      goals: !!profile.goals,
    };

    const steps = VALID_STEPS.map((step) => ({
      step,
      completed: stepCompletionMap[step],
    }));

    const completedCount = steps.filter((s) => s.completed).length;

    return {
      status: profile.status,
      currentStep: profile.currentStep,
      steps,
      completedCount,
      totalSteps: VALID_STEPS.length,
      completionPercent: Math.round((completedCount / VALID_STEPS.length) * 100),
    };
  }

  async resetForReanalysis(businessId: string) {
    const profile = await this.prisma.client.businessGuidanceProfile.findUnique({
      where: { businessId },
    });
    if (!profile) throw new NotFoundException('Guidance profile not found.');

    await this.prisma.client.businessGuidanceProfile.update({
      where: { id: profile.id },
      data: {
        status: 'IN_PROGRESS',
        submittedAt: null,
      },
    });

    return this.getFullProfile(profile.id);
  }

  private async prePopulateFromBusiness(
    profileId: string,
    business: {
      teamSize: string | null;
      revenueModel: string | null;
      businessIntent: string | null;
      tagline: string | null;
    },
  ) {
    if (business.businessIntent || business.tagline) {
      await this.prisma.client.businessIdentityProfile.create({
        data: {
          guidanceProfileId: profileId,
          missionStatement: business.businessIntent ?? undefined,
          targetMarket: undefined,
        },
      });
    }

    if (business.revenueModel) {
      await this.prisma.client.revenueProfile.create({
        data: {
          guidanceProfileId: profileId,
          revenueStreams: business.revenueModel ? [business.revenueModel] : [],
        },
      });
    }

    if (business.teamSize) {
      const teamSizeMap: Record<string, number> = {
        SOLO: 1,
        SMALL_TEAM: 5,
        GROWING: 15,
      };
      const size = teamSizeMap[business.teamSize];
      if (size !== undefined) {
        await this.prisma.client.operationsProfile.create({
          data: {
            guidanceProfileId: profileId,
            teamSize: size,
          },
        });
      }
    }
  }

  private async getFullProfile(profileId: string) {
    return this.prisma.client.businessGuidanceProfile.findUnique({
      where: { id: profileId },
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
  }

  private async upsertStepData(profileId: string, step: StepId, data: Record<string, unknown>): Promise<StepSaveResult> {
    switch (step) {
      case 'identity':
        return this.upsertIdentity(profileId, data);
      case 'founder':
        return this.upsertFounder(profileId, data);
      case 'offer':
        return this.upsertOffer(profileId, data);
      case 'customer':
        return this.upsertCustomer(profileId, data);
      case 'revenue':
        return this.upsertRevenue(profileId, data);
      case 'finance':
        return this.upsertFinance(profileId, data);
      case 'operations':
        return this.upsertOperations(profileId, data);
      case 'compliance':
        return this.upsertCompliance(profileId, data);
      case 'growth':
        return this.upsertGrowth(profileId, data);
      case 'goals':
        return this.upsertGoals(profileId, data);
    }
  }

  private async upsertIdentity(profileId: string, data: Record<string, unknown>): Promise<StepSaveResult> {
    const existing = await this.prisma.client.businessIdentityProfile.findUnique({ where: { guidanceProfileId: profileId } });
    if (existing) {
      await this.prisma.client.businessIdentityProfile.update({ where: { guidanceProfileId: profileId }, data });
    } else {
      await this.prisma.client.businessIdentityProfile.create({ data: { guidanceProfileId: profileId, ...data } });
    }
    return { guidanceProfileId: profileId };
  }

  private async upsertFounder(profileId: string, data: Record<string, unknown>): Promise<StepSaveResult> {
    const existing = await this.prisma.client.founderProfile.findUnique({ where: { guidanceProfileId: profileId } });
    if (existing) {
      await this.prisma.client.founderProfile.update({ where: { guidanceProfileId: profileId }, data });
    } else {
      await this.prisma.client.founderProfile.create({ data: { guidanceProfileId: profileId, ...data } });
    }
    return { guidanceProfileId: profileId };
  }

  private async upsertOffer(profileId: string, data: Record<string, unknown>): Promise<StepSaveResult> {
    const existing = await this.prisma.client.offerProfile.findUnique({ where: { guidanceProfileId: profileId } });
    if (existing) {
      await this.prisma.client.offerProfile.update({ where: { guidanceProfileId: profileId }, data });
    } else {
      await this.prisma.client.offerProfile.create({ data: { guidanceProfileId: profileId, ...data } });
    }
    return { guidanceProfileId: profileId };
  }

  private async upsertCustomer(profileId: string, data: Record<string, unknown>): Promise<StepSaveResult> {
    const existing = await this.prisma.client.customerProfile.findUnique({ where: { guidanceProfileId: profileId } });
    if (existing) {
      await this.prisma.client.customerProfile.update({ where: { guidanceProfileId: profileId }, data });
    } else {
      await this.prisma.client.customerProfile.create({ data: { guidanceProfileId: profileId, ...data } });
    }
    return { guidanceProfileId: profileId };
  }

  private async upsertRevenue(profileId: string, data: Record<string, unknown>): Promise<StepSaveResult> {
    const existing = await this.prisma.client.revenueProfile.findUnique({ where: { guidanceProfileId: profileId } });
    if (existing) {
      await this.prisma.client.revenueProfile.update({ where: { guidanceProfileId: profileId }, data });
    } else {
      await this.prisma.client.revenueProfile.create({ data: { guidanceProfileId: profileId, ...data } });
    }
    return { guidanceProfileId: profileId };
  }

  private async upsertFinance(profileId: string, data: Record<string, unknown>): Promise<StepSaveResult> {
    const existing = await this.prisma.client.financeProfile.findUnique({ where: { guidanceProfileId: profileId } });
    if (existing) {
      await this.prisma.client.financeProfile.update({ where: { guidanceProfileId: profileId }, data });
    } else {
      await this.prisma.client.financeProfile.create({ data: { guidanceProfileId: profileId, ...data } });
    }
    return { guidanceProfileId: profileId };
  }

  private async upsertOperations(profileId: string, data: Record<string, unknown>): Promise<StepSaveResult> {
    const existing = await this.prisma.client.operationsProfile.findUnique({ where: { guidanceProfileId: profileId } });
    if (existing) {
      await this.prisma.client.operationsProfile.update({ where: { guidanceProfileId: profileId }, data });
    } else {
      await this.prisma.client.operationsProfile.create({ data: { guidanceProfileId: profileId, ...data } });
    }
    return { guidanceProfileId: profileId };
  }

  private async upsertCompliance(profileId: string, data: Record<string, unknown>): Promise<StepSaveResult> {
    const existing = await this.prisma.client.complianceGuidanceProfile.findUnique({ where: { guidanceProfileId: profileId } });
    if (existing) {
      await this.prisma.client.complianceGuidanceProfile.update({ where: { guidanceProfileId: profileId }, data });
    } else {
      await this.prisma.client.complianceGuidanceProfile.create({ data: { guidanceProfileId: profileId, ...data } });
    }
    return { guidanceProfileId: profileId };
  }

  private async upsertGrowth(profileId: string, data: Record<string, unknown>): Promise<StepSaveResult> {
    const existing = await this.prisma.client.growthProfile.findUnique({ where: { guidanceProfileId: profileId } });
    if (existing) {
      await this.prisma.client.growthProfile.update({ where: { guidanceProfileId: profileId }, data });
    } else {
      await this.prisma.client.growthProfile.create({ data: { guidanceProfileId: profileId, ...data } });
    }
    return { guidanceProfileId: profileId };
  }

  private async upsertGoals(profileId: string, data: Record<string, unknown>): Promise<StepSaveResult> {
    const existing = await this.prisma.client.goalsProfile.findUnique({ where: { guidanceProfileId: profileId } });
    if (existing) {
      await this.prisma.client.goalsProfile.update({ where: { guidanceProfileId: profileId }, data });
    } else {
      await this.prisma.client.goalsProfile.create({ data: { guidanceProfileId: profileId, ...data } });
    }
    return { guidanceProfileId: profileId };
  }

  private sanitizeStepData(step: StepId, data: Record<string, unknown>): Record<string, unknown> {
    const sanitized: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(data)) {
      if (key === 'id' || key === 'guidanceProfileId' || key === 'createdAt' || key === 'updatedAt') {
        continue;
      }
      if (this.isCurrencyField(key) && typeof value === 'number' && value < 0) {
        throw new BadRequestException(`${key} must be non-negative`);
      }
      if (this.isPercentField(key) && typeof value === 'number' && (value < 0 || value > 100)) {
        throw new BadRequestException(`${key} must be between 0 and 100`);
      }
      sanitized[key] = value;
    }

    return sanitized;
  }

  private validateRequiredFieldsByStage(step: StepId, data: Record<string, unknown>, stage?: string) {
    if (!stage) return;

    const normalizedStage = stage.toUpperCase();

    const stageRequirements: Record<string, Partial<Record<StepId, string[]>>> = {
      IDEA: {
        identity: ['missionStatement'],
        offer: ['primaryOffer'],
        customer: ['targetDemographic'],
      },
      STARTUP: {
        identity: ['missionStatement'],
        offer: ['primaryOffer', 'offerType'],
        customer: ['targetDemographic'],
        revenue: ['revenueStreams'],
        finance: ['startupCapital'],
      },
      GROWTH: {
        identity: ['missionStatement', 'uniqueSellingPoint'],
        offer: ['primaryOffer', 'offerType', 'valueProposition'],
        customer: ['targetDemographic', 'acquisitionChannels'],
        revenue: ['monthlyRevenue', 'revenueStreams'],
        finance: ['monthlyBurnRate', 'currentCashReserve'],
        operations: ['teamSize'],
        growth: ['marketingChannels'],
      },
      ESTABLISHED: {
        identity: ['missionStatement', 'uniqueSellingPoint'],
        offer: ['primaryOffer', 'offerType', 'valueProposition'],
        customer: ['targetDemographic', 'acquisitionChannels'],
        revenue: ['monthlyRevenue', 'annualRevenue', 'revenueStreams'],
        finance: ['monthlyBurnRate', 'currentCashReserve', 'profitMarginPercent'],
        operations: ['teamSize', 'fullTimeEmployees'],
        growth: ['marketingChannels', 'competitorCount'],
      },
      SCALING: {
        identity: ['missionStatement', 'uniqueSellingPoint', 'coreValues'],
        offer: ['primaryOffer', 'offerType', 'valueProposition'],
        customer: ['targetDemographic', 'acquisitionChannels', 'customerLifetimeValue'],
        revenue: ['monthlyRevenue', 'annualRevenue', 'revenueStreams', 'recurringPercent'],
        finance: ['monthlyBurnRate', 'currentCashReserve', 'profitMarginPercent', 'runwayMonths'],
        operations: ['teamSize', 'fullTimeEmployees'],
        growth: ['marketingChannels', 'competitorCount', 'customerAcquisitionCost'],
        goals: ['revenueTarget12m'],
      },
    };

    const requirements = stageRequirements[normalizedStage];
    if (!requirements) return;

    const requiredForStep = requirements[step];
    if (!requiredForStep) return;

    const missing = requiredForStep.filter((field) => {
      const value = data[field];
      return value === undefined || value === null || value === '';
    });

    if (missing.length > 0) {
      throw new BadRequestException(
        `For ${normalizedStage} stage, the following fields are required for ${step}: ${missing.join(', ')}`,
      );
    }
  }

  private isCurrencyField(key: string): boolean {
    const currencyFields = [
      'startupCapital', 'currentCashReserve', 'monthlyBurnRate', 'monthlyFixedCosts',
      'monthlyVariableCosts', 'debtTotal', 'fundingRaised', 'monthlyRevenue', 'annualRevenue',
      'averageOrderValue', 'targetMonthlyRevenue', 'productionCost', 'priceRangeLow',
      'priceRangeHigh', 'customerLifetimeValue', 'marketingBudget', 'customerAcquisitionCost',
      'revenueTarget12m',
    ];
    return currencyFields.includes(key);
  }

  private isPercentField(key: string): boolean {
    const percentFields = [
      'profitMarginPercent', 'recurringPercent', 'churnRatePercent', 'marginPercent',
      'marketSharePercent', 'revenueGrowthRate',
    ];
    return percentFields.includes(key);
  }
}
