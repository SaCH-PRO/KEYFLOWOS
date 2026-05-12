import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import {
  BlueprintBrand,
  BlueprintConstraints,
  BlueprintCustomerModel,
  BlueprintData,
  BlueprintFinancials,
  BlueprintGoals,
  BlueprintIdentity,
  BlueprintIntelligence,
  BlueprintOperatingModel,
  BlueprintPatch,
  BlueprintSectionKey,
  RecommendedSetupStep,
} from './blueprint.types';

const SCHEMA_VERSION = 1;

const SECTION_KEYS: BlueprintSectionKey[] = [
  'identity',
  'operatingModel',
  'goals',
  'constraints',
  'brand',
  'customerModel',
  'financials',
  'intelligence',
  'workflowModel',
  'aiPreferences',
];

/**
 * Per-section weighted fields used to compute the 0-100 completeness score.
 * Each field carries equal weight inside its section, every section carries
 * equal weight in the overall total. Adjust here in one place when the
 * blueprint shape evolves.
 */
const COMPLETENESS_FIELDS: Record<BlueprintSectionKey, string[]> = {
  identity: ['name', 'archetype', 'industry', 'tagline', 'oneLiner', 'mission'],
  operatingModel: ['revenueModel', 'deliveryMode', 'serviceArea', 'channels', 'teamSize'],
  goals: ['northStar', 'ninetyDayGoals', 'twelveMonthGoals'],
  constraints: ['budgetRange', 'timeCommitment', 'riskTolerance'],
  brand: ['voice', 'tone', 'primaryColor', 'valueProps'],
  customerModel: ['idealCustomer', 'segments', 'painPoints'],
  financials: ['currency', 'pricingModel', 'avgTicket', 'monthlyTarget'],
  intelligence: ['topChannels', 'recentMomentumScore'],
  workflowModel: ['primaryWorkflow'],
  aiPreferences: ['autonomyLevel', 'tone'],
};

function isPopulated(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'number') return !Number.isNaN(value);
  if (typeof value === 'object') return Object.keys(value as object).length > 0;
  return Boolean(value);
}

function readObject(raw: Prisma.JsonValue | null | undefined): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

@Injectable()
export class BlueprintService {
  private readonly logger = new Logger(BlueprintService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Read the blueprint for a business, lazily creating one (seeded from the
   * existing Business profile + onboarding metaData) on first access. This
   * keeps the rest of the codebase able to assume a row always exists.
   */
  async getBlueprint(businessId: string): Promise<BlueprintData> {
    const existing = await this.prisma.client.businessBlueprint.findUnique({
      where: { businessId },
    });
    if (existing) return this.serialize(existing);

    return this.serialize(await this.seedFromBusiness(businessId));
  }

  /**
   * Merge a partial patch into the blueprint, recompute completeness, and
   * persist. Each section is shallow-merged so callers can update a single
   * field without clobbering the rest.
   */
  async updateBlueprint(businessId: string, patch: BlueprintPatch): Promise<BlueprintData> {
    const current = await this.getBlueprintRecord(businessId);

    const next: Record<BlueprintSectionKey, Record<string, unknown>> = {
      identity: readObject(current.identity),
      operatingModel: readObject(current.operatingModel),
      goals: readObject(current.goals),
      constraints: readObject(current.constraints),
      brand: readObject(current.brand),
      customerModel: readObject(current.customerModel),
      financials: readObject(current.financials),
      intelligence: readObject(current.intelligence),
      workflowModel: readObject(current.workflowModel),
      aiPreferences: readObject(current.aiPreferences),
    };

    for (const key of SECTION_KEYS) {
      const sectionPatch = patch[key];
      if (sectionPatch && typeof sectionPatch === 'object') {
        next[key] = { ...next[key], ...(sectionPatch as Record<string, unknown>) };
      }
    }

    const completeness = this.calculateCompleteness(next);

    const confidenceScores = this.calculateConfidenceScores(next);

    const updated = await this.prisma.client.businessBlueprint.update({
      where: { businessId },
      data: {
        identity: next.identity as Prisma.InputJsonValue,
        operatingModel: next.operatingModel as Prisma.InputJsonValue,
        goals: next.goals as Prisma.InputJsonValue,
        constraints: next.constraints as Prisma.InputJsonValue,
        brand: next.brand as Prisma.InputJsonValue,
        customerModel: next.customerModel as Prisma.InputJsonValue,
        financials: next.financials as Prisma.InputJsonValue,
        intelligence: next.intelligence as Prisma.InputJsonValue,
        workflowModel: next.workflowModel as Prisma.InputJsonValue,
        aiPreferences: next.aiPreferences as Prisma.InputJsonValue,
        confidenceScores: confidenceScores as unknown as Prisma.InputJsonValue,
        completeness,
        lastAnalyzedAt: new Date(),
      },
    });

    return this.serialize(updated);
  }

  /**
   * Map onboarding-concierge answers into the relevant blueprint sections.
   * Called from the onboarding flow whenever a step is submitted.
   */
  async inferFromOnboarding(
    businessId: string,
    answers: Record<string, unknown>,
  ): Promise<BlueprintData> {
    const patch: BlueprintPatch = {};

    const identity: Partial<BlueprintIdentity> = {};
    if (typeof answers.businessName === 'string') identity.name = answers.businessName;
    if (typeof answers.businessIntent === 'string') identity.oneLiner = answers.businessIntent;
    if (typeof answers.archetype === 'string') identity.archetype = answers.archetype;
    if (typeof answers.industry === 'string') identity.industry = answers.industry;
    if (typeof answers.tagline === 'string') identity.tagline = answers.tagline;
    if (typeof answers.country === 'string') identity.country = answers.country;
    if (Object.keys(identity).length) patch.identity = identity;

    const operating: Partial<BlueprintOperatingModel> = {};
    if (typeof answers.revenueModel === 'string') operating.revenueModel = answers.revenueModel;
    if (typeof answers.deliveryMode === 'string') operating.deliveryMode = answers.deliveryMode;
    if (typeof answers.serviceArea === 'string') operating.serviceArea = answers.serviceArea;
    if (typeof answers.teamSize === 'string') operating.teamSize = answers.teamSize;
    if (Array.isArray(answers.channels)) {
      operating.channels = answers.channels.filter((c): c is string => typeof c === 'string');
    }
    if (Object.keys(operating).length) patch.operatingModel = operating;

    const constraints: Partial<BlueprintConstraints> = {};
    if (typeof answers.budgetRange === 'string') constraints.budgetRange = answers.budgetRange;
    if (typeof answers.timeCommitment === 'string') constraints.timeCommitment = answers.timeCommitment;
    if (typeof answers.riskTolerance === 'string') constraints.riskTolerance = answers.riskTolerance;
    if (Object.keys(constraints).length) patch.constraints = constraints;

    const goals: Partial<BlueprintGoals> = {};
    if (typeof answers.northStar === 'string') goals.northStar = answers.northStar;
    if (Array.isArray(answers.ninetyDayGoals)) {
      goals.ninetyDayGoals = answers.ninetyDayGoals.filter((g): g is string => typeof g === 'string');
    }
    if (Array.isArray(answers.twelveMonthGoals)) {
      goals.twelveMonthGoals = answers.twelveMonthGoals.filter((g): g is string => typeof g === 'string');
    }
    if (Object.keys(goals).length) patch.goals = goals;

    const brand: Partial<BlueprintBrand> = {};
    if (typeof answers.brandVoice === 'string') brand.voice = answers.brandVoice;
    if (typeof answers.brandTone === 'string') brand.tone = answers.brandTone;
    if (typeof answers.primaryColor === 'string') brand.primaryColor = answers.primaryColor;
    if (typeof answers.secondaryColor === 'string') brand.secondaryColor = answers.secondaryColor;
    if (typeof answers.logoUrl === 'string') brand.logoUrl = answers.logoUrl;
    if (Array.isArray(answers.valueProps)) {
      brand.valueProps = answers.valueProps.filter((v): v is string => typeof v === 'string');
    }
    if (Object.keys(brand).length) patch.brand = brand;

    const customer: Partial<BlueprintCustomerModel> = {};
    if (typeof answers.idealCustomer === 'string') customer.idealCustomer = answers.idealCustomer;
    if (Array.isArray(answers.segments)) {
      customer.segments = answers.segments.filter((s): s is string => typeof s === 'string');
    }
    if (Array.isArray(answers.painPoints)) {
      customer.painPoints = answers.painPoints.filter((s): s is string => typeof s === 'string');
    }
    if (Object.keys(customer).length) patch.customerModel = customer;

    const financials: Partial<BlueprintFinancials> = {};
    if (typeof answers.currency === 'string') financials.currency = answers.currency;
    if (typeof answers.pricingModel === 'string') financials.pricingModel = answers.pricingModel;
    if (typeof answers.avgTicket === 'number') financials.avgTicket = answers.avgTicket;
    if (typeof answers.monthlyTarget === 'number') financials.monthlyTarget = answers.monthlyTarget;
    if (Object.keys(financials).length) patch.financials = financials;

    return this.updateBlueprint(businessId, patch);
  }

  /**
   * Infer blueprint signals from business events and data patterns.
   */
  async inferFromEvents(businessId: string): Promise<BlueprintData> {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    const [
      productCategories,
      monthlyRevenue,
      bookingCount,
      cancelledBookingCount,
      projectCount,
      quoteTotal,
      quoteAccepted,
      ecommerceOrders,
      walkInCount,
      retainerInvoices,
      topChannels,
      activityCount,
      monthlyExpenses,
      bookingsByDay,
      campaignMetrics,
    ] = await Promise.all([
      this.prisma.client.product.groupBy({
        by: ['category'],
        where: { businessId, deletedAt: null, category: { not: null } } as unknown as Prisma.ProductWhereInput,
        _count: { _all: true },
        orderBy: { _count: { category: 'desc' } },
        take: 3,
      }) as Promise<Array<{ category: string | null }>>,
      this.prisma.client.invoice
        .aggregate({
          where: { businessId, deletedAt: null, status: 'PAID', paidAt: { gte: thirtyDaysAgo } },
          _sum: { total: true },
        })
        .catch(() => null),
      this.prisma.client.booking.count({ where: { businessId, deletedAt: null } }),
      this.prisma.client.booking.count({ where: { businessId, deletedAt: null, status: 'CANCELLED' } }),
      this.prisma.client.project.count({ where: { businessId, deletedAt: null } }),
      this.prisma.client.quote.count({ where: { businessId, deletedAt: null, status: { in: ['SENT', 'ACCEPTED', 'REJECTED'] } } }).catch(() => 0),
      this.prisma.client.quote.count({ where: { businessId, deletedAt: null, status: 'ACCEPTED' } }).catch(() => 0),
      this.prisma.client.invoice.count({
        where: { businessId, deletedAt: null },
      }).catch(() => 0),
      Promise.resolve(0),
      this.prisma.client.invoice.count({
        where: { businessId, deletedAt: null, status: 'PAID', recurringInvoiceId: { not: null } },
      }).catch(() => 0),
      this.prisma.client.activity.groupBy({
        by: ['module'],
        where: { businessId, occurredAt: { gte: thirtyDaysAgo } },
        _count: { _all: true },
        orderBy: { _count: { module: 'desc' } },
        take: 3,
      }).catch(() => [] as any),
      this.prisma.client.activity.count({
        where: { businessId, occurredAt: { gte: thirtyDaysAgo } },
      }).catch(() => 0),
      this.prisma.client.expense.aggregate({
        where: { businessId, deletedAt: null, date: { gte: thirtyDaysAgo } },
        _sum: { amount: true },
      }).catch(() => null),
      this.prisma.client.booking.findMany({
        where: { businessId, deletedAt: null, startTime: { gte: ninetyDaysAgo } },
        select: { startTime: true },
      }).catch(() => []),
      this.prisma.client.emailCampaign.aggregate({
        where: { businessId, deletedAt: null, status: 'SENT' },
        _sum: { openCount: true, clickCount: true, totalRecipients: true },
      }).catch(() => null),
    ]);

    const noShowRate = bookingCount > 0 ? Math.round((cancelledBookingCount / bookingCount) * 1000) / 10 : 0;
    const quoteConversionRate = quoteTotal > 0 ? Math.round((quoteAccepted / quoteTotal) * 1000) / 10 : 0;
    const expenseRatio = (monthlyRevenue?._sum?.total && monthlyExpenses?._sum?.amount)
      ? Math.round((Number(monthlyExpenses._sum.amount) / Number(monthlyRevenue._sum.total)) * 1000) / 10
      : 0;

    // Seasonal pattern: count bookings by day of week
    const dayCounts = [0, 0, 0, 0, 0, 0, 0];
    for (const b of bookingsByDay as Array<{ startTime: Date }>) {
      dayCounts[new Date(b.startTime).getDay()]++;
    }
    const peakDayIndex = dayCounts.indexOf(Math.max(...dayCounts));
    const peakDayLabel = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][peakDayIndex] ?? 'Unknown';
    const seasonalPattern = peakDayLabel;

    const campaignOpenRate = campaignMetrics?._sum?.totalRecipients
      ? Math.round((Number(campaignMetrics._sum.openCount) / Number(campaignMetrics._sum.totalRecipients)) * 1000) / 10
      : 0;
    const campaignClickRate = campaignMetrics?._sum?.totalRecipients
      ? Math.round((Number(campaignMetrics._sum.clickCount) / Number(campaignMetrics._sum.totalRecipients)) * 1000) / 10
      : 0;

    const intelligence: Partial<BlueprintIntelligence> = {
      topProductCategories: productCategories
        .map((p) => p.category)
        .filter((c): c is string => typeof c === 'string'),
      topChannels: (topChannels as any[])
        ?.map((c: any) => c.module)
        ?.filter((m: string) => typeof m === 'string') ?? [],
      recentMomentumScore: monthlyRevenue?._sum?.total
        ? Math.min(100, Math.round(Number(monthlyRevenue._sum.total) / 100))
        : activityCount > 0 ? Math.min(100, Math.round(activityCount * 2)) : 0,
      quoteConversionRate,
      noShowRate,
      expenseRatio,
      seasonalPattern,
      campaignOpenRate,
      campaignClickRate,
      inferredAt: new Date().toISOString(),
    };

    // Infer workflow model from data patterns
    const workflowModel: Partial<any> = {};
    if (bookingCount > 0) workflowModel.appointmentBooking = true;
    if (projectCount > 0) workflowModel.projectManagement = true;
    if (retainerInvoices > 0) workflowModel.retainerCycle = true;
    if (walkInCount > 0) workflowModel.walkInQueue = true;
    if (ecommerceOrders > 0) workflowModel.ecommerceFulfillment = true;
    if (quoteTotal > 0) workflowModel.quoteDrivenSales = true;
    if (noShowRate > 15) workflowModel.highNoShowRate = true;
    if (seasonalPattern && dayCounts.some((c) => c > 0)) workflowModel.seasonalBusiness = true;
    if (bookingCount === 0 && projectCount === 0 && ecommerceOrders === 0) {
      workflowModel.customInquiryFlow = true;
    }

    return this.updateBlueprint(businessId, { intelligence, workflowModel: workflowModel as any });
  }

  /**
   * Build the lightweight blueprint context object that the KEY orchestrator
   * (and any other AI surface) folds into its system prompt. Returns null
   * when the business has no blueprint yet so callers can no-op cleanly.
   */
  async getBlueprintContext(businessId: string): Promise<{
    completeness: number;
    summary: string;
    identity: BlueprintIdentity;
    operatingModel: BlueprintOperatingModel;
    goals: BlueprintGoals;
    constraints: BlueprintConstraints;
    brand: BlueprintBrand;
    customerModel: BlueprintCustomerModel;
    financials: BlueprintFinancials;
  } | null> {
    try {
      const bp = await this.getBlueprint(businessId);
      const summaryParts: string[] = [];
      if (bp.identity.name) summaryParts.push(bp.identity.name);
      if (bp.identity.archetype) summaryParts.push(`(${bp.identity.archetype})`);
      if (bp.identity.oneLiner) summaryParts.push(`— ${bp.identity.oneLiner}`);
      if (bp.operatingModel.revenueModel) summaryParts.push(`revenue: ${bp.operatingModel.revenueModel}`);
      if (bp.goals.northStar) summaryParts.push(`north star: ${bp.goals.northStar}`);

      return {
        completeness: bp.completeness,
        summary: summaryParts.join(' ').trim() || 'Blueprint is empty — recommendations will be generic.',
        identity: bp.identity,
        operatingModel: bp.operatingModel,
        goals: bp.goals,
        constraints: bp.constraints,
        brand: bp.brand,
        customerModel: bp.customerModel,
        financials: bp.financials,
      };
    } catch (err) {
      this.logger.debug(`getBlueprintContext failed for ${businessId}: ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * Suggest the next sections to fill, ordered by impact-on-completeness.
   * Used by the Cockpit widget and the blueprint page itself.
   */
  async getRecommendedSetupSteps(businessId: string): Promise<RecommendedSetupStep[]> {
    const bp = await this.getBlueprint(businessId);
    const steps: RecommendedSetupStep[] = [];

    const SECTION_LABELS: Record<BlueprintSectionKey, { title: string; reason: string }> = {
      identity: {
        title: 'Tell us who you are',
        reason: 'KEY needs your name, archetype, and one-liner to ground every recommendation.',
      },
      operatingModel: {
        title: 'Describe how you operate',
        reason: 'Revenue model, delivery mode, and channels shape every playbook we suggest.',
      },
      goals: {
        title: 'Set your north star and 90-day goals',
        reason: 'Without goals, the AI cannot prioritise tasks or measure progress.',
      },
      constraints: {
        title: 'Share your budget, time, and risk constraints',
        reason: 'Lets KEY recommend tactics that actually fit your week and wallet.',
      },
      brand: {
        title: 'Define your brand voice',
        reason: 'Generated content (emails, posts, quotes) will sound like you, not a template.',
      },
      customerModel: {
        title: 'Sketch your ideal customer',
        reason: 'Storefront copy, lead scoring, and outreach all reference this segment.',
      },
      financials: {
        title: 'Set pricing and revenue targets',
        reason: 'Required for forecasting, profitability advice, and quote generation.',
      },
      intelligence: {
        title: 'Connect data sources',
        reason: 'Inferred signals come from events; the more we see, the smarter KEY gets.',
      },
      workflowModel: {
        title: 'Define your workflow model',
        reason: 'Appointment, project, retainer, or ecommerce — KEY needs to know how you deliver.',
      },
      aiPreferences: {
        title: 'Set your AI preferences',
        reason: 'Autonomy level, tone, and notifications let KEY work the way you want.',
      },
    };

    for (const key of SECTION_KEYS) {
      const fields = COMPLETENESS_FIELDS[key];
      const section = (bp[key] as unknown as Record<string, unknown>) || {};
      const filled = fields.filter((f) => isPopulated(section[f])).length;
      if (filled < Math.ceil(fields.length / 2)) {
        steps.push({
          id: key,
          section: key,
          title: SECTION_LABELS[key].title,
          reason: SECTION_LABELS[key].reason,
          href: `/app/blueprint#${key}`,
        });
      }
    }

    return steps;
  }

  // -- internals -----------------------------------------------------------

  private async getBlueprintRecord(businessId: string) {
    const existing = await this.prisma.client.businessBlueprint.findUnique({
      where: { businessId },
    });
    if (existing) return existing;
    return this.seedFromBusiness(businessId);
  }

  /**
   * Build a baseline blueprint by mining the existing Business row + meta.
   * Idempotent: only runs when no blueprint row exists.
   */
  async seedFromBusiness(businessId: string) {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
    });
    if (!business) {
      throw new NotFoundException(`Business ${businessId} not found`);
    }

    const meta = readObject(business.metaData);

    const identity: BlueprintIdentity = {
      name: business.name || undefined,
      archetype: business.archetype || undefined,
      industry: business.industry || undefined,
      tagline: business.tagline || undefined,
      oneLiner: business.businessIntent || undefined,
      mission: undefined,
      country: business.country || undefined,
    };

    const operatingModel: BlueprintOperatingModel = {
      revenueModel: business.revenueModel || undefined,
      teamSize: business.teamSize || undefined,
      capacity: business.currentCapacity || undefined,
      channels: undefined,
    };

    const constraints: BlueprintConstraints = {
      budgetRange: business.budgetRange || undefined,
      timeCommitment: business.timeCommitment || undefined,
    };

    const brand: BlueprintBrand = {
      primaryColor: business.primaryColor || undefined,
      secondaryColor: business.secondaryColor || undefined,
      logoUrl: business.logoUrl || undefined,
    };

    const financials: BlueprintFinancials = {
      currency: business.currency || 'TTD',
    };

    const customerModel: BlueprintCustomerModel = {
      idealCustomer: typeof meta.idealCustomer === 'string' ? meta.idealCustomer : undefined,
    };

    const goals: BlueprintGoals = {};
    const intelligence: BlueprintIntelligence = {};
    const workflowModel: any = {};
    const aiPreferences: any = {};

    const seed = {
      identity,
      operatingModel,
      goals,
      constraints,
      brand,
      customerModel,
      financials,
      intelligence,
      workflowModel,
      aiPreferences,
    };

    const completeness = this.calculateCompleteness(seed as any);
    const confidenceScores = this.calculateConfidenceScores(seed as any);

    return this.prisma.client.businessBlueprint.upsert({
      where: { businessId },
      create: {
        businessId,
        schemaVersion: SCHEMA_VERSION,
        identity: identity as unknown as Prisma.InputJsonValue,
        operatingModel: operatingModel as unknown as Prisma.InputJsonValue,
        goals: goals as unknown as Prisma.InputJsonValue,
        constraints: constraints as unknown as Prisma.InputJsonValue,
        brand: brand as unknown as Prisma.InputJsonValue,
        customerModel: customerModel as unknown as Prisma.InputJsonValue,
        financials: financials as unknown as Prisma.InputJsonValue,
        intelligence: intelligence as unknown as Prisma.InputJsonValue,
        workflowModel: workflowModel as unknown as Prisma.InputJsonValue,
        aiPreferences: aiPreferences as unknown as Prisma.InputJsonValue,
        confidenceScores: confidenceScores as unknown as Prisma.InputJsonValue,
        completeness,
      },
      update: {},
    });
  }

  private calculateCompleteness(sections: Record<BlueprintSectionKey, Record<string, unknown>>): number {
    const sectionScores: number[] = [];
    for (const key of SECTION_KEYS) {
      const fields = COMPLETENESS_FIELDS[key];
      if (!fields.length) continue;
      const section = sections[key] || {};
      const filled = fields.filter((f) => isPopulated(section[f])).length;
      sectionScores.push(filled / fields.length);
    }
    if (!sectionScores.length) return 0;
    const avg = sectionScores.reduce((a, b) => a + b, 0) / sectionScores.length;
    return Math.round(avg * 100);
  }

  private calculateConfidenceScores(sections: Record<BlueprintSectionKey, Record<string, unknown>>): Record<string, number> {
    const scores: Record<string, number> = {};
    for (const key of SECTION_KEYS) {
      const fields = COMPLETENESS_FIELDS[key];
      if (!fields.length) { scores[key] = 0; continue; }
      const section = sections[key] || {};
      const filled = fields.filter((f) => isPopulated(section[f])).length;
      scores[key] = Math.round((filled / fields.length) * 100);
    }
    return scores;
  }

  private serialize(row: {
    schemaVersion: number;
    identity: Prisma.JsonValue;
    operatingModel: Prisma.JsonValue;
    goals: Prisma.JsonValue;
    constraints: Prisma.JsonValue;
    brand: Prisma.JsonValue;
    customerModel: Prisma.JsonValue;
    financials: Prisma.JsonValue;
    intelligence: Prisma.JsonValue;
    workflowModel: Prisma.JsonValue;
    aiPreferences: Prisma.JsonValue;
    confidenceScores: Prisma.JsonValue;
    completeness: number;
    lastAnalyzedAt: Date | null;
    updatedAt: Date;
  }): BlueprintData {
    return {
      schemaVersion: row.schemaVersion,
      identity: readObject(row.identity) as BlueprintIdentity,
      operatingModel: readObject(row.operatingModel) as BlueprintOperatingModel,
      goals: readObject(row.goals) as BlueprintGoals,
      constraints: readObject(row.constraints) as BlueprintConstraints,
      brand: readObject(row.brand) as BlueprintBrand,
      customerModel: readObject(row.customerModel) as BlueprintCustomerModel,
      financials: readObject(row.financials) as BlueprintFinancials,
      intelligence: readObject(row.intelligence) as BlueprintIntelligence,
      workflowModel: readObject(row.workflowModel) as any,
      aiPreferences: readObject(row.aiPreferences) as any,
      confidenceScores: readObject(row.confidenceScores) as any,
      completeness: row.completeness,
      lastAnalyzedAt: row.lastAnalyzedAt?.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
