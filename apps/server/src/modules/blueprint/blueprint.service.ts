import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import {
  BlueprintBrand,
  BlueprintComplianceProfile,
  BlueprintConstraints,
  BlueprintConversionAssumptions,
  BlueprintCustomerModel,
  BlueprintData,
  BlueprintDocumentProfile,
  BlueprintExecutionRoadmap,
  BlueprintFinancials,
  BlueprintFollowUpStep,
  BlueprintFounderProfile,
  BlueprintGeneratedDocument,
  BlueprintGoals,
  BlueprintIdentity,
  BlueprintIntelligence,
  BlueprintLegalProfile,
  BlueprintMarketProfile,
  BlueprintMarketingChannel,
  BlueprintMarketingSystem,
  BlueprintOffer,
  BlueprintOfferArchitecture,
  BlueprintOwner,
  BlueprintOperatingModel,
  BlueprintOperationsSystem,
  BlueprintOwnershipProfile,
  BlueprintPatch,
  BlueprintPipelineStage,
  BlueprintProjectionProfile,
  BlueprintRecommendedEntityType,
  BlueprintRegistrationProfile,
  BlueprintRiskItem,
  BlueprintRiskProfile,
  BlueprintSalesChannel,
  BlueprintSalesSystem,
  BlueprintSectionKey,
  BlueprintTaxProfile,
  BlueprintWorkflowStep,
  ComplianceItem,
  DnaSectionKey,
  DnaSectionScore,
  GenomeIntegrityResult,
  GenomeRecommendation,
  GenomeStage,
  RecommendedSetupStep,
  SetupStep,
} from './blueprint.types';

const SCHEMA_VERSION = 2;

/**
 * Original 10 blueprint sections that drive the onboarding completeness
 * guard. Do not change this set without reviewing onboarding gating logic.
 */
const CORE_SECTION_KEYS: BlueprintSectionKey[] = [
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
 * Genesis sections added by Business Genesis Patch 1. They extend the
 * blueprint but do not affect the legacy onboarding completeness score.
 */
const GENESIS_SECTION_KEYS: BlueprintSectionKey[] = [
  'founderProfile',
  'legalProfile',
  'registrationProfile',
  'taxProfile',
  'ownershipProfile',
  'marketProfile',
  'offerArchitecture',
  'salesSystem',
  'marketingSystem',
  'operationsSystem',
  'projectionProfile',
  'riskProfile',
  'complianceProfile',
  'executionRoadmap',
  'documentProfile',
];

const SECTION_KEYS: BlueprintSectionKey[] = [...CORE_SECTION_KEYS, ...GENESIS_SECTION_KEYS];

/**
 * Per-section weighted fields used to compute the 0-100 completeness score.
 * Each field carries equal weight inside its section, every section carries
 * equal weight in the overall total. Adjust here in one place when the
 * blueprint shape evolves.
 *
 * NOTE: completeness is computed from CORE_SECTION_KEYS only so the existing
 * onboarding guard is not affected by the Genesis expansion.
 */
const COMPLETENESS_FIELDS: Record<BlueprintSectionKey, string[]> = {
  identity: ['name', 'archetype', 'industry', 'tagline', 'oneLiner', 'mission'],
  operatingModel: ['revenueModel', 'deliveryMode', 'serviceArea', 'channels', 'teamSize'],
  goals: ['northStar', 'ninetyDayGoals', 'twelveMonthGoals', 'priorities'],
  constraints: ['budgetRange', 'timeCommitment', 'riskTolerance'],
  brand: ['voice', 'tone', 'primaryColor', 'valueProps'],
  customerModel: ['idealCustomer', 'segments', 'painPoints'],
  financials: ['currency', 'pricingModel', 'avgTicket', 'monthlyTarget'],
  intelligence: ['topChannels', 'recentMomentumScore'],
  workflowModel: ['primaryWorkflow'],
  aiPreferences: ['autonomyLevel', 'tone', 'outreachStyle', 'reportingCadence'],
  // Genesis completeness fields (not used by core onboarding score yet)
  founderProfile: ['founderName', 'background', 'skills', 'weeklyAvailabilityHours'],
  legalProfile: ['country', 'recommendedEntityType', 'regulatedIndustry'],
  registrationProfile: ['businessNameStatus', 'companiesRegistryStatus', 'vatStatus'],
  taxProfile: ['country', 'taxIdStatus', 'taxReadinessScore'],
  ownershipProfile: ['hasPartners', 'owners'],
  marketProfile: ['targetGeography', 'marketCategory', 'demandSignals'],
  offerArchitecture: ['coreOffer', 'offerLadder'],
  salesSystem: ['salesChannels', 'pipelineStages'],
  marketingSystem: ['channels', 'launchPlan'],
  operationsSystem: ['coreWorkflows', 'fulfillmentProcess'],
  projectionProfile: ['startupCapital', 'monthlyFixedCosts', 'avgTicket'],
  riskProfile: ['financialRisks', 'legalRisks', 'riskScore'],
  complianceProfile: ['complianceItems', 'complianceScore'],
  executionRoadmap: ['today', 'sevenDayPlan', 'thirtyDayPlan'],
  documentProfile: ['generatedDocuments'],
};

// --- Business Genome DNA mapping ------------------------------------------------

const DNA_SECTION_WEIGHTS: Record<DnaSectionKey, number> = {
  founder: 10,
  vision: 5,
  business: 15,
  market: 15,
  financial: 15,
  legal: 10,
  operations: 10,
  sales: 5,
  marketing: 5,
  growth: 5,
  technology: 5,
};

const DNA_SECTION_CONFIG: Record<
  DnaSectionKey,
  { sources: BlueprintSectionKey[]; fields: string[]; label: string }
> = {
  founder: {
    sources: ['founderProfile'],
    fields: ['founderName', 'background', 'skills', 'weeklyAvailabilityHours'],
    label: 'Founder DNA',
  },
  vision: {
    sources: ['identity', 'brand'],
    fields: ['mission', 'vision', 'values', 'voice', 'tone', 'valueProps'],
    label: 'Vision DNA',
  },
  business: {
    sources: ['identity', 'operatingModel', 'brand', 'goals', 'constraints', 'workflowModel', 'aiPreferences'],
    fields: [
      'name',
      'archetype',
      'industry',
      'revenueModel',
      'deliveryMode',
      'serviceArea',
      'teamSize',
      'northStar',
      'budgetRange',
      'timeCommitment',
      'riskTolerance',
      'primaryWorkflow',
      'autonomyLevel',
      'reportingCadence',
    ],
    label: 'Business DNA',
  },
  market: {
    sources: ['customerModel', 'marketProfile'],
    fields: ['idealCustomer', 'segments', 'painPoints', 'targetGeography', 'marketCategory', 'demandSignals'],
    label: 'Market DNA',
  },
  financial: {
    sources: ['financials', 'projectionProfile'],
    fields: [
      'currency',
      'pricingModel',
      'avgTicket',
      'monthlyTarget',
      'startupCapital',
      'monthlyFixedCosts',
      'variableCostPercent',
    ],
    label: 'Financial DNA',
  },
  legal: {
    sources: ['legalProfile', 'registrationProfile', 'taxProfile', 'ownershipProfile', 'complianceProfile'],
    fields: [
      'country',
      'recommendedEntityType',
      'regulatedIndustry',
      'businessNameStatus',
      'companiesRegistryStatus',
      'vatStatus',
      'taxIdStatus',
      'hasPartners',
      'owners',
      'complianceItems',
    ],
    label: 'Legal DNA',
  },
  operations: {
    sources: ['operationsSystem'],
    fields: ['coreWorkflows', 'fulfillmentProcess'],
    label: 'Operations DNA',
  },
  sales: {
    sources: ['salesSystem'],
    fields: ['salesChannels', 'pipelineStages'],
    label: 'Sales DNA',
  },
  marketing: {
    sources: ['marketingSystem'],
    fields: ['channels', 'launchPlan'],
    label: 'Marketing DNA',
  },
  growth: {
    sources: ['executionRoadmap'],
    fields: ['today', 'sevenDayPlan', 'thirtyDayPlan'],
    label: 'Growth DNA',
  },
  technology: {
    sources: ['workflowModel', 'aiPreferences'],
    fields: ['primaryWorkflow', 'autonomyLevel', 'outreachStyle', 'reportingCadence'],
    label: 'Technology DNA',
  },
};

function isPopulated(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'boolean') return true;
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
      founderProfile: readObject(current.founderProfile),
      legalProfile: readObject(current.legalProfile),
      registrationProfile: readObject(current.registrationProfile),
      taxProfile: readObject(current.taxProfile),
      ownershipProfile: readObject(current.ownershipProfile),
      marketProfile: readObject(current.marketProfile),
      offerArchitecture: readObject(current.offerArchitecture),
      salesSystem: readObject(current.salesSystem),
      marketingSystem: readObject(current.marketingSystem),
      operationsSystem: readObject(current.operationsSystem),
      projectionProfile: readObject(current.projectionProfile),
      riskProfile: readObject(current.riskProfile),
      complianceProfile: readObject(current.complianceProfile),
      executionRoadmap: readObject(current.executionRoadmap),
      documentProfile: readObject(current.documentProfile),
    };

    for (const key of SECTION_KEYS) {
      const sectionPatch = patch[key];
      if (sectionPatch && typeof sectionPatch === 'object') {
        next[key] = { ...next[key], ...(sectionPatch as Record<string, unknown>) };
      }
    }

    const completeness = this.calculateCompleteness(next);

    const confidenceScores = this.calculateConfidenceScores(next);

    const genomeResult = this.buildGenomeIntegrityResult({
      identity: next.identity as Prisma.JsonValue,
      operatingModel: next.operatingModel as Prisma.JsonValue,
      goals: next.goals as Prisma.JsonValue,
      constraints: next.constraints as Prisma.JsonValue,
      brand: next.brand as Prisma.JsonValue,
      customerModel: next.customerModel as Prisma.JsonValue,
      financials: next.financials as Prisma.JsonValue,
      intelligence: next.intelligence as Prisma.JsonValue,
      workflowModel: next.workflowModel as Prisma.JsonValue,
      aiPreferences: next.aiPreferences as Prisma.JsonValue,
      founderProfile: next.founderProfile as Prisma.JsonValue,
      legalProfile: next.legalProfile as Prisma.JsonValue,
      registrationProfile: next.registrationProfile as Prisma.JsonValue,
      taxProfile: next.taxProfile as Prisma.JsonValue,
      ownershipProfile: next.ownershipProfile as Prisma.JsonValue,
      marketProfile: next.marketProfile as Prisma.JsonValue,
      offerArchitecture: next.offerArchitecture as Prisma.JsonValue,
      salesSystem: next.salesSystem as Prisma.JsonValue,
      marketingSystem: next.marketingSystem as Prisma.JsonValue,
      operationsSystem: next.operationsSystem as Prisma.JsonValue,
      projectionProfile: next.projectionProfile as Prisma.JsonValue,
      riskProfile: next.riskProfile as Prisma.JsonValue,
      complianceProfile: next.complianceProfile as Prisma.JsonValue,
      executionRoadmap: next.executionRoadmap as Prisma.JsonValue,
      documentProfile: next.documentProfile as Prisma.JsonValue,
    });

    const updateData: Prisma.BusinessBlueprintUpdateInput = {
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
      founderProfile: next.founderProfile as Prisma.InputJsonValue,
      legalProfile: next.legalProfile as Prisma.InputJsonValue,
      registrationProfile: next.registrationProfile as Prisma.InputJsonValue,
      taxProfile: next.taxProfile as Prisma.InputJsonValue,
      ownershipProfile: next.ownershipProfile as Prisma.InputJsonValue,
      marketProfile: next.marketProfile as Prisma.InputJsonValue,
      offerArchitecture: next.offerArchitecture as Prisma.InputJsonValue,
      salesSystem: next.salesSystem as Prisma.InputJsonValue,
      marketingSystem: next.marketingSystem as Prisma.InputJsonValue,
      operationsSystem: next.operationsSystem as Prisma.InputJsonValue,
      projectionProfile: next.projectionProfile as Prisma.InputJsonValue,
      riskProfile: next.riskProfile as Prisma.InputJsonValue,
      complianceProfile: next.complianceProfile as Prisma.InputJsonValue,
      executionRoadmap: next.executionRoadmap as Prisma.InputJsonValue,
      documentProfile: next.documentProfile as Prisma.InputJsonValue,
      confidenceScores: confidenceScores as unknown as Prisma.InputJsonValue,
      completeness,
      lastAnalyzedAt: new Date(),
      genomeIntegrity: genomeResult.genomeIntegrity,
      genomeDnaScores: genomeResult.genomeDnaScores as unknown as Prisma.InputJsonValue,
      genomeDnaConfidence: genomeResult.genomeDnaConfidence as unknown as Prisma.InputJsonValue,
      genomeStage: genomeResult.genomeStage,
      genesisCompleted:
        current.genesisCompleted != null ? current.genesisCompleted : genomeResult.threePillarMinimumMet,
    };

    if (typeof patch.readinessScore === 'number') {
      updateData.readinessScore = Math.max(0, Math.min(100, patch.readinessScore));
    }

    const updated = await this.prisma.client.businessBlueprint.update({
      where: { businessId },
      data: updateData,
    });

    return this.serialize(updated);
  }

  /**
   * Compute the full Business Genome integrity result for a business.
   */
  async calculateGenomeIntegrity(businessId: string): Promise<GenomeIntegrityResult> {
    const row = await this.getBlueprintRecord(businessId);
    return this.buildGenomeIntegrityResult(row);
  }

  /**
   * Check whether the Three-Pillar Minimum is satisfied.
   */
  checkThreePillarMinimum(scores: Record<DnaSectionKey, number>): boolean {
    return scores.founder >= 50 && scores.business >= 50 && scores.market >= 50;
  }

  /**
   * Determine the business lifecycle stage from integrity and DNA scores.
   */
  determineGenomeStage(
    integrity: number,
    scores: Record<DnaSectionKey, number>,
  ): GenomeStage {
    if (integrity >= 95) return 'ENTERPRISE_READY';
    if (integrity >= 85 && scores.growth >= 60) return 'GROWTH_BUSINESS';
    if (integrity >= 75 && scores.operations >= 60) return 'OPERATING_BUSINESS';
    if (integrity >= 60 && scores.sales >= 50 && scores.marketing >= 50) return 'REVENUE_ENGINE';
    if (
      scores.founder >= 50 &&
      scores.business >= 50 &&
      scores.market >= 50 &&
      scores.legal >= 60 &&
      scores.financial >= 40
    ) {
      return 'REGISTERED_ENTITY';
    }
    if (this.checkThreePillarMinimum(scores)) return 'VALIDATED_CONCEPT';
    return 'CONCEPT';
  }

  /**
   * Return rule-based DNA recommendations for the next highest-value action.
   */
  async getRecommendations(businessId: string): Promise<GenomeRecommendation[]> {
    const { dnaSections, threePillarMinimumMet } = await this.calculateGenomeIntegrity(businessId);

    const recommendations: GenomeRecommendation[] = [];

    if (!threePillarMinimumMet) {
      const pillars: DnaSectionKey[] = ['founder', 'business', 'market'];
      for (const key of pillars) {
        const section = dnaSections.find((s) => s.key === key);
        if (section && section.integrity < 50) {
          recommendations.push({
            id: `complete-${key}`,
            section: key,
            title: `Complete ${section.label}`,
            reason: `The Three-Pillar Minimum requires ${section.label} to be at least 50%. It is currently ${section.integrity}%.`,
            href: `/app/profile?tab=business-genome&section=dna-sections`,
          });
        }
      }
      return recommendations;
    }

    const weakest = [...dnaSections]
      .filter((s) => s.integrity < 100)
      .sort((a, b) => a.integrity - b.integrity)[0];

    if (weakest) {
      recommendations.push({
        id: `improve-${weakest.key}`,
        section: weakest.key,
        title: `Improve ${weakest.label}`,
        reason: `Your ${weakest.label} is the lowest-scoring section at ${weakest.integrity}%. ${weakest.recommendation}`,
        href: `/app/profile?tab=business-genome&section=dna-sections`,
      });
    }

    return recommendations;
  }

  /**
   * Update a single DNA section by distributing fields to their underlying
   * `BusinessBlueprint` JSONB source columns and recomputing scores.
   */
  async updateDnaSection(
    businessId: string,
    sectionKey: DnaSectionKey,
    data: Record<string, unknown>,
  ): Promise<BlueprintData> {
    const config = DNA_SECTION_CONFIG[sectionKey];
    if (!config) {
      throw new Error(`Unknown DNA section: ${sectionKey}`);
    }

    // Build a reverse lookup: field -> first source section that contains it.
    const fieldToSource: Record<string, BlueprintSectionKey> = {};
    for (const source of config.sources) {
      const sourceFields = COMPLETENESS_FIELDS[source] || [];
      for (const field of sourceFields) {
        if (fieldToSource[field] === undefined) {
          fieldToSource[field] = source;
        }
      }
    }

    const patch: BlueprintPatch = {};
    for (const [field, value] of Object.entries(data)) {
      const source = fieldToSource[field];
      if (!source) continue;
      (patch as Record<string, Record<string, unknown>>)[source] =
        (patch as Record<string, Record<string, unknown>>)[source] || {};
      (patch as Record<string, Record<string, unknown>>)[source][field] = value;
    }

    return this.updateBlueprint(businessId, patch);
  }

  /**
   * Generate a read-only Business Constitution assembled from the Genome.
   */
  async generateConstitution(businessId: string): Promise<Record<string, unknown>> {
    const genome = await this.calculateGenomeIntegrity(businessId);
    const sections = genome.dnaSections;
    const sectionMap = new Map(sections.map((s) => [s.key, s] as const));

    const byKey = (key: string) => sectionMap.get(key as DnaSectionKey);

    return {
      businessId,
      generatedAt: new Date().toISOString(),
      version: 1,
      genomeIntegrity: genome.genomeIntegrity,
      genomeStage: genome.genomeStage,
      sections: {
        executiveSummary: {
          title: 'Executive Summary',
          sourceDna: ['business', 'vision'],
          strength: Math.round(((byKey('business')?.integrity ?? 0) + (byKey('vision')?.integrity ?? 0)) / 2),
          content: 'Generated from Business DNA and Vision DNA.',
        },
        businessModel: {
          title: 'Business Model',
          sourceDna: ['business'],
          strength: byKey('business')?.integrity ?? 0,
          content: 'Generated from Business DNA.',
        },
        governanceFramework: {
          title: 'Governance Framework',
          sourceDna: ['legal'],
          strength: byKey('legal')?.integrity ?? 0,
          content: 'Generated from Legal DNA.',
        },
        legalFramework: {
          title: 'Legal Framework',
          sourceDna: ['legal'],
          strength: byKey('legal')?.integrity ?? 0,
          content: 'Generated from Legal DNA.',
        },
        financialStrategy: {
          title: 'Financial Strategy',
          sourceDna: ['financial'],
          strength: byKey('financial')?.integrity ?? 0,
          content: 'Generated from Financial DNA.',
        },
        marketingStrategy: {
          title: 'Marketing Strategy',
          sourceDna: ['marketing', 'market'],
          strength: Math.round(((byKey('marketing')?.integrity ?? 0) + (byKey('market')?.integrity ?? 0)) / 2),
          content: 'Generated from Marketing DNA and Market DNA.',
        },
        salesStrategy: {
          title: 'Sales Strategy',
          sourceDna: ['sales'],
          strength: byKey('sales')?.integrity ?? 0,
          content: 'Generated from Sales DNA.',
        },
        operationsStrategy: {
          title: 'Operations Strategy',
          sourceDna: ['operations', 'technology'],
          strength: Math.round(((byKey('operations')?.integrity ?? 0) + (byKey('technology')?.integrity ?? 0)) / 2),
          content: 'Generated from Operations DNA and Technology DNA.',
        },
        growthRoadmap: {
          title: 'Growth Roadmap',
          sourceDna: ['growth'],
          strength: byKey('growth')?.integrity ?? 0,
          content: 'Generated from Growth DNA.',
        },
        riskRegister: {
          title: 'Risk Register',
          sourceDna: ['legal', 'financial', 'operations'],
          strength: Math.round(
            ((byKey('legal')?.integrity ?? 0) + (byKey('financial')?.integrity ?? 0) + (byKey('operations')?.integrity ?? 0)) / 3,
          ),
          content: 'Generated from Legal, Financial, and Operations DNA.',
        },
      },
    };
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

    // Support nested keys like legalProfile.hasPhysicalLocation by splitting on '.'
    for (const [key, value] of Object.entries(answers)) {
      if (!key.includes('.') || value === undefined || value === null) continue;
      const [section, ...rest] = key.split('.');
      if (!SECTION_KEYS.includes(section as BlueprintSectionKey)) continue;
      const field = rest.join('.');
      if (!field) continue;
      (patch as Record<string, Record<string, unknown>>)[section] =
        (patch as Record<string, Record<string, unknown>>)[section] || {};
      (patch as Record<string, Record<string, unknown>>)[section][field] = value;
    }

    const identity: Partial<BlueprintIdentity> = (patch.identity as any) || {};
    if (typeof answers.businessName === 'string') identity.name = answers.businessName;
    if (typeof answers.businessIntent === 'string') identity.oneLiner = answers.businessIntent;
    if (typeof answers.archetype === 'string') identity.archetype = answers.archetype;
    if (typeof answers.industry === 'string') identity.industry = answers.industry;
    if (typeof answers.tagline === 'string') identity.tagline = answers.tagline;
    if (typeof answers.country === 'string') identity.country = answers.country;
    if (Object.keys(identity).length) patch.identity = identity;

    const operating: Partial<BlueprintOperatingModel> = (patch.operatingModel as any) || {};
    if (typeof answers.revenueModel === 'string') operating.revenueModel = answers.revenueModel;
    if (typeof answers.deliveryMode === 'string') operating.deliveryMode = answers.deliveryMode;
    if (typeof answers.serviceArea === 'string') operating.serviceArea = answers.serviceArea;
    if (typeof answers.teamSize === 'string') operating.teamSize = answers.teamSize;
    if (Array.isArray(answers.channels)) {
      operating.channels = answers.channels.filter((c): c is string => typeof c === 'string');
    }
    if (Object.keys(operating).length) patch.operatingModel = operating;

    const constraints: Partial<BlueprintConstraints> = (patch.constraints as any) || {};
    if (typeof answers.budgetRange === 'string') constraints.budgetRange = answers.budgetRange;
    if (typeof answers.timeCommitment === 'string') constraints.timeCommitment = answers.timeCommitment;
    if (typeof answers.riskTolerance === 'string') constraints.riskTolerance = answers.riskTolerance;
    if (Object.keys(constraints).length) patch.constraints = constraints;

    const goals: Partial<BlueprintGoals> = (patch.goals as any) || {};
    if (typeof answers.northStar === 'string') goals.northStar = answers.northStar;
    if (Array.isArray(answers.ninetyDayGoals)) {
      goals.ninetyDayGoals = answers.ninetyDayGoals.filter((g): g is string => typeof g === 'string');
    }
    if (Array.isArray(answers.twelveMonthGoals)) {
      goals.twelveMonthGoals = answers.twelveMonthGoals.filter((g): g is string => typeof g === 'string');
    }
    if (Object.keys(goals).length) patch.goals = goals;

    const brand: Partial<BlueprintBrand> = (patch.brand as any) || {};
    if (typeof answers.brandVoice === 'string') brand.voice = answers.brandVoice;
    if (typeof answers.brandTone === 'string') brand.tone = answers.brandTone;
    if (typeof answers.primaryColor === 'string') brand.primaryColor = answers.primaryColor;
    if (typeof answers.secondaryColor === 'string') brand.secondaryColor = answers.secondaryColor;
    if (typeof answers.logoUrl === 'string') brand.logoUrl = answers.logoUrl;
    if (Array.isArray(answers.valueProps)) {
      brand.valueProps = answers.valueProps.filter((v): v is string => typeof v === 'string');
    }
    if (Object.keys(brand).length) patch.brand = brand;

    const customer: Partial<BlueprintCustomerModel> = (patch.customerModel as any) || {};
    if (typeof answers.idealCustomer === 'string') customer.idealCustomer = answers.idealCustomer;
    if (typeof answers.targetCustomer === 'string') customer.idealCustomer = answers.targetCustomer;
    if (Array.isArray(answers.segments)) {
      customer.segments = answers.segments.filter((s): s is string => typeof s === 'string');
    }
    if (Array.isArray(answers.painPoints)) {
      customer.painPoints = answers.painPoints.filter((s): s is string => typeof s === 'string');
    }
    if (Array.isArray(answers.jobsToBeDone)) {
      customer.jobsToBeDone = answers.jobsToBeDone.filter((s): s is string => typeof s === 'string');
    }
    if (Object.keys(customer).length) patch.customerModel = customer;

    const financials: Partial<BlueprintFinancials> = (patch.financials as any) || {};
    if (typeof answers.currency === 'string') financials.currency = answers.currency;
    if (typeof answers.pricingModel === 'string') financials.pricingModel = answers.pricingModel;
    if (typeof answers.avgTicket === 'number') financials.avgTicket = answers.avgTicket;
    if (typeof answers.monthlyTarget === 'number') financials.monthlyTarget = answers.monthlyTarget;
    if (Object.keys(financials).length) patch.financials = financials;

    // Genesis section mappings
    const founderProfile: Partial<BlueprintFounderProfile> = (patch.founderProfile as any) || {};
    if (typeof answers.founderName === 'string') founderProfile.founderName = answers.founderName;
    if (typeof answers.background === 'string') founderProfile.background = answers.background;
    if (Array.isArray(answers.skills)) {
      founderProfile.skills = answers.skills.filter((s): s is string => typeof s === 'string');
    }
    if (Array.isArray(answers.weaknesses)) {
      founderProfile.weaknesses = answers.weaknesses.filter((s): s is string => typeof s === 'string');
    }
    if (typeof answers.riskTolerance === 'string') founderProfile.riskTolerance = answers.riskTolerance;
    if (typeof answers.weeklyAvailabilityHours === 'number') {
      founderProfile.weeklyAvailabilityHours = answers.weeklyAvailabilityHours;
    }
    if (typeof answers.visionStatement === 'string') founderProfile.visionStatement = answers.visionStatement;
    if (Object.keys(founderProfile).length) patch.founderProfile = founderProfile;

    const legalProfile: Partial<BlueprintLegalProfile> = (patch.legalProfile as any) || {};
    if (typeof answers.hasPhysicalLocation === 'boolean') {
      legalProfile.hasPhysicalLocation = answers.hasPhysicalLocation;
    }
    if (typeof answers.hasRegulatedActivity === 'boolean') {
      legalProfile.regulatedIndustry = answers.hasRegulatedActivity;
    }
    if (typeof answers.regulatedIndustry === 'boolean') {
      legalProfile.regulatedIndustry = answers.regulatedIndustry;
    }
    if (typeof answers.legalStructurePreference === 'string') {
      const allowed: BlueprintRecommendedEntityType[] = [
        'SOLE_TRADER',
        'PARTNERSHIP',
        'LIMITED_COMPANY',
        'NONPROFIT',
        'UNKNOWN',
      ];
      legalProfile.recommendedEntityType = allowed.includes(
        answers.legalStructurePreference as BlueprintRecommendedEntityType,
      )
        ? (answers.legalStructurePreference as BlueprintRecommendedEntityType)
        : 'UNKNOWN';
    }
    if (typeof answers.entityTypeReason === 'string') {
      legalProfile.entityTypeReason = answers.entityTypeReason;
    }
    if (Array.isArray(answers.regulatedIndustryNotes)) {
      legalProfile.regulatedIndustryNotes = answers.regulatedIndustryNotes.filter(
        (n): n is string => typeof n === 'string',
      );
    }
    if (Object.keys(legalProfile).length) patch.legalProfile = legalProfile;

    const registrationProfile: Partial<BlueprintRegistrationProfile> =
      (patch.registrationProfile as any) || {};
    if (typeof answers.registrationStatus === 'string') {
      registrationProfile.businessNameStatus = answers.registrationStatus;
    }
    if (typeof answers.hasEmployees === 'boolean') {
      registrationProfile.nisEmployerStatus = answers.hasEmployees ? 'NOT_STARTED' : 'NOT_NEEDED';
    }
    if (typeof answers.estimatedAnnualRevenue === 'number') {
      registrationProfile.vatStatus = answers.estimatedAnnualRevenue > 500000 ? 'REQUIRED' : 'NOT_REQUIRED';
    }
    if (Object.keys(registrationProfile).length) patch.registrationProfile = registrationProfile;

    const taxProfile: Partial<BlueprintTaxProfile> = (patch.taxProfile as any) || {};
    if (typeof answers.country === 'string') taxProfile.country = answers.country;
    if (typeof answers.estimatedAnnualRevenue === 'number') {
      taxProfile.estimatedAnnualRevenue = answers.estimatedAnnualRevenue;
    }
    if (typeof answers.payrollExpected === 'boolean') taxProfile.payrollExpected = answers.payrollExpected;
    if (typeof answers.contractorPaymentsExpected === 'boolean') {
      taxProfile.contractorPaymentsExpected = answers.contractorPaymentsExpected;
    }
    if (Object.keys(taxProfile).length) patch.taxProfile = taxProfile;

    const ownershipProfile: Partial<BlueprintOwnershipProfile> = (patch.ownershipProfile as any) || {};
    if (typeof answers.hasPartners === 'boolean') ownershipProfile.hasPartners = answers.hasPartners;
    if (Array.isArray(answers.owners)) ownershipProfile.owners = answers.owners as BlueprintOwner[];
    if (Object.keys(ownershipProfile).length) patch.ownershipProfile = ownershipProfile;

    const marketProfile: Partial<BlueprintMarketProfile> = (patch.marketProfile as any) || {};
    if (typeof answers.targetGeography === 'string') marketProfile.targetGeography = answers.targetGeography;
    if (typeof answers.marketCategory === 'string') marketProfile.marketCategory = answers.marketCategory;
    if (typeof answers.marketStage === 'string') marketProfile.marketStage = answers.marketStage;
    if (Array.isArray(answers.trends)) {
      marketProfile.trends = answers.trends.filter((s): s is string => typeof s === 'string');
    }
    if (Array.isArray(answers.barriersToEntry)) {
      marketProfile.barriersToEntry = answers.barriersToEntry.filter(
        (s): s is string => typeof s === 'string',
      );
    }
    if (Array.isArray(answers.demandSignals)) {
      marketProfile.demandSignals = answers.demandSignals.filter(
        (s): s is string => typeof s === 'string',
      );
    }
    if (Object.keys(marketProfile).length) patch.marketProfile = marketProfile;

    const offerArchitecture: Partial<BlueprintOfferArchitecture> = (patch.offerArchitecture as any) || {};
    if (answers.coreOffer && typeof answers.coreOffer === 'object') {
      offerArchitecture.coreOffer = answers.coreOffer as BlueprintOffer;
    }
    if (Array.isArray(answers.offerLadder)) {
      offerArchitecture.offerLadder = answers.offerLadder as BlueprintOffer[];
    }
    if (Array.isArray(answers.pricingTiers)) {
      offerArchitecture.pricingTiers = answers.pricingTiers as BlueprintOffer[];
    }
    if (Array.isArray(answers.upsells)) {
      offerArchitecture.upsells = answers.upsells as BlueprintOffer[];
    }
    if (Array.isArray(answers.recurringRevenueOpportunities)) {
      offerArchitecture.recurringRevenueOpportunities =
        answers.recurringRevenueOpportunities.filter((s): s is string => typeof s === 'string');
    }
    if (Object.keys(offerArchitecture).length) patch.offerArchitecture = offerArchitecture;

    const salesSystem: Partial<BlueprintSalesSystem> = (patch.salesSystem as any) || {};
    if (Array.isArray(answers.salesChannels)) {
      salesSystem.salesChannels = answers.salesChannels.map((c) => {
        if (typeof c === 'string') return { channel: c, priority: 'MEDIUM' as const };
        return c as BlueprintSalesChannel;
      });
    }
    if (Array.isArray(answers.pipelineStages)) {
      salesSystem.pipelineStages = answers.pipelineStages as BlueprintPipelineStage[];
    }
    if (Array.isArray(answers.leadSources)) {
      salesSystem.leadSources = answers.leadSources.filter((s): s is string => typeof s === 'string');
    }
    if (answers.conversionAssumptions && typeof answers.conversionAssumptions === 'object') {
      salesSystem.conversionAssumptions = answers.conversionAssumptions as BlueprintConversionAssumptions;
    }
    if (Array.isArray(answers.followUpCadence)) {
      salesSystem.followUpCadence = answers.followUpCadence as BlueprintFollowUpStep[];
    }
    if (Object.keys(salesSystem).length) patch.salesSystem = salesSystem;

    const marketingSystem: Partial<BlueprintMarketingSystem> = (patch.marketingSystem as any) || {};
    if (Array.isArray(answers.channels)) {
      marketingSystem.channels = answers.channels.map((c) => {
        if (typeof c === 'string') return { channel: c, priority: 'MEDIUM' as const };
        return c as BlueprintMarketingChannel;
      });
    }
    if (Array.isArray(answers.contentPillars)) {
      marketingSystem.contentPillars = answers.contentPillars.filter(
        (s): s is string => typeof s === 'string',
      );
    }
    if (Array.isArray(answers.campaignIdeas)) {
      marketingSystem.campaignIdeas = answers.campaignIdeas.filter(
        (s): s is string => typeof s === 'string',
      );
    }
    if (typeof answers.brandNarrative === 'string') {
      marketingSystem.brandNarrative = answers.brandNarrative;
    }
    if (Array.isArray(answers.launchPlan)) {
      marketingSystem.launchPlan = answers.launchPlan.filter((s): s is string => typeof s === 'string');
    }
    if (Object.keys(marketingSystem).length) patch.marketingSystem = marketingSystem;

    const operationsSystem: Partial<BlueprintOperationsSystem> = (patch.operationsSystem as any) || {};
    if (Array.isArray(answers.coreWorkflows)) {
      operationsSystem.coreWorkflows = answers.coreWorkflows as BlueprintWorkflowStep[];
    }
    if (Array.isArray(answers.dailyChecklist)) {
      operationsSystem.dailyChecklist = answers.dailyChecklist.filter(
        (s): s is string => typeof s === 'string',
      );
    }
    if (Array.isArray(answers.weeklyChecklist)) {
      operationsSystem.weeklyChecklist = answers.weeklyChecklist.filter(
        (s): s is string => typeof s === 'string',
      );
    }
    if (Array.isArray(answers.fulfillmentProcess)) {
      operationsSystem.fulfillmentProcess = answers.fulfillmentProcess as BlueprintWorkflowStep[];
    }
    if (Array.isArray(answers.customerSupportProcess)) {
      operationsSystem.customerSupportProcess = answers.customerSupportProcess as BlueprintWorkflowStep[];
    }
    if (Array.isArray(answers.vendorProcess)) {
      operationsSystem.vendorProcess = answers.vendorProcess as BlueprintWorkflowStep[];
    }
    if (Object.keys(operationsSystem).length) patch.operationsSystem = operationsSystem;

    const projectionProfile: Partial<BlueprintProjectionProfile> = (patch.projectionProfile as any) || {};
    if (typeof answers.startupCapital === 'number') projectionProfile.startupCapital = answers.startupCapital;
    if (typeof answers.startupCosts === 'number') projectionProfile.startupCosts = answers.startupCosts;
    if (typeof answers.monthlyFixedCosts === 'number') {
      projectionProfile.monthlyFixedCosts = answers.monthlyFixedCosts;
    }
    if (typeof answers.variableCostPercent === 'number') {
      projectionProfile.variableCostPercent = answers.variableCostPercent;
    }
    if (typeof answers.expectedMonthlyUnits === 'number') {
      projectionProfile.expectedMonthlyUnits = answers.expectedMonthlyUnits;
    }
    if (typeof answers.conservativeMonthlyUnits === 'number') {
      projectionProfile.conservativeMonthlyUnits = answers.conservativeMonthlyUnits;
    }
    if (typeof answers.aggressiveMonthlyUnits === 'number') {
      projectionProfile.aggressiveMonthlyUnits = answers.aggressiveMonthlyUnits;
    }
    if (Object.keys(projectionProfile).length) patch.projectionProfile = projectionProfile;

    const riskProfile: Partial<BlueprintRiskProfile> = (patch.riskProfile as any) || {};
    if (Array.isArray(answers.financialRisks)) {
      riskProfile.financialRisks = answers.financialRisks as BlueprintRiskItem[];
    }
    if (Array.isArray(answers.legalRisks)) {
      riskProfile.legalRisks = answers.legalRisks as BlueprintRiskItem[];
    }
    if (Array.isArray(answers.marketRisks)) {
      riskProfile.marketRisks = answers.marketRisks as BlueprintRiskItem[];
    }
    if (Array.isArray(answers.operationalRisks)) {
      riskProfile.operationalRisks = answers.operationalRisks as BlueprintRiskItem[];
    }
    if (Array.isArray(answers.founderRisks)) {
      riskProfile.founderRisks = answers.founderRisks as BlueprintRiskItem[];
    }
    if (Array.isArray(answers.mitigationPlan)) {
      riskProfile.mitigationPlan = answers.mitigationPlan.filter((s): s is string => typeof s === 'string');
    }
    if (Object.keys(riskProfile).length) patch.riskProfile = riskProfile;

    const complianceProfile: Partial<BlueprintComplianceProfile> = (patch.complianceProfile as any) || {};
    if (Array.isArray(answers.complianceItems)) {
      complianceProfile.complianceItems = answers.complianceItems as ComplianceItem[];
    }
    if (typeof answers.complianceScore === 'number') {
      complianceProfile.complianceScore = answers.complianceScore;
    }
    if (Object.keys(complianceProfile).length) patch.complianceProfile = complianceProfile;

    const executionRoadmap: Partial<BlueprintExecutionRoadmap> = (patch.executionRoadmap as any) || {};
    if (Array.isArray(answers.today)) {
      executionRoadmap.today = answers.today.filter((s): s is string => typeof s === 'string');
    }
    if (Array.isArray(answers.sevenDayPlan)) {
      executionRoadmap.sevenDayPlan = answers.sevenDayPlan.filter((s): s is string => typeof s === 'string');
    }
    if (Array.isArray(answers.thirtyDayPlan)) {
      executionRoadmap.thirtyDayPlan = answers.thirtyDayPlan.filter((s): s is string => typeof s === 'string');
    }
    if (Array.isArray(answers.ninetyDayPlan)) {
      executionRoadmap.ninetyDayPlan = answers.ninetyDayPlan.filter(
        (s): s is string => typeof s === 'string',
      );
    }
    if (Array.isArray(answers.twelveMonthMilestones)) {
      executionRoadmap.twelveMonthMilestones = answers.twelveMonthMilestones.filter(
        (s): s is string => typeof s === 'string',
      );
    }
    if (Object.keys(executionRoadmap).length) patch.executionRoadmap = executionRoadmap;

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
    readinessScore?: number;
    summary: string;
    identity: BlueprintIdentity;
    operatingModel: BlueprintOperatingModel;
    goals: BlueprintGoals;
    constraints: BlueprintConstraints;
    brand: BlueprintBrand;
    customerModel: BlueprintCustomerModel;
    financials: BlueprintFinancials;
    founderProfile?: BlueprintFounderProfile;
    legalProfile?: BlueprintLegalProfile;
    registrationProfile?: BlueprintRegistrationProfile;
    taxProfile?: BlueprintTaxProfile;
    marketProfile?: BlueprintMarketProfile;
    offerArchitecture?: BlueprintOfferArchitecture;
    salesSystem?: BlueprintSalesSystem;
    marketingSystem?: BlueprintMarketingSystem;
    operationsSystem?: BlueprintOperationsSystem;
    projectionProfile?: BlueprintProjectionProfile;
    riskProfile?: BlueprintRiskProfile;
    complianceProfile?: BlueprintComplianceProfile;
    executionRoadmap?: BlueprintExecutionRoadmap;
    documentProfile?: BlueprintDocumentProfile;
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
        readinessScore: bp.readinessScore,
        summary: summaryParts.join(' ').trim() || 'Blueprint is empty — recommendations will be generic.',
        identity: bp.identity,
        operatingModel: bp.operatingModel,
        goals: bp.goals,
        constraints: bp.constraints,
        brand: bp.brand,
        customerModel: bp.customerModel,
        financials: bp.financials,
        founderProfile: bp.founderProfile,
        legalProfile: bp.legalProfile,
        registrationProfile: bp.registrationProfile,
        taxProfile: bp.taxProfile,
        marketProfile: bp.marketProfile,
        offerArchitecture: bp.offerArchitecture,
        salesSystem: bp.salesSystem,
        marketingSystem: bp.marketingSystem,
        operationsSystem: bp.operationsSystem,
        projectionProfile: bp.projectionProfile,
        riskProfile: bp.riskProfile,
        complianceProfile: bp.complianceProfile,
        executionRoadmap: bp.executionRoadmap,
        documentProfile: bp.documentProfile,
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
      founderProfile: {
        title: 'Document the founder profile',
        reason: 'Background, availability, and skills determine what KEY can safely automate.',
      },
      legalProfile: {
        title: 'Clarify legal structure',
        reason: 'Entity type and jurisdiction shape compliance and contract recommendations.',
      },
      registrationProfile: {
        title: 'Track business registrations',
        reason: 'Licences, tax IDs, and bank accounts must be in place before trading.',
      },
      taxProfile: {
        title: 'Set up the tax profile',
        reason: 'Payroll, VAT, and contractor expectations drive finance workflows.',
      },
      ownershipProfile: {
        title: 'Confirm ownership structure',
        reason: 'Partners and shareholder agreements affect authority and risk routing.',
      },
      marketProfile: {
        title: 'Map the market opportunity',
        reason: 'Trends, barriers, and demand signals focus go-to-market planning.',
      },
      offerArchitecture: {
        title: 'Design your offer architecture',
        reason: 'Core offer, tiers, and upsells determine pricing and revenue playbooks.',
      },
      salesSystem: {
        title: 'Build the sales system',
        reason: 'Channels, pipeline stages, and cadence turn leads into customers.',
      },
      marketingSystem: {
        title: 'Build the marketing system',
        reason: 'Channels, content pillars, and launch plan generate repeatable reach.',
      },
      operationsSystem: {
        title: 'Document operating workflows',
        reason: 'Daily, weekly, and fulfilment processes keep delivery predictable.',
      },
      projectionProfile: {
        title: 'Create financial projections',
        reason: 'Runway, break-even, and month-by-month forecasts guide capital decisions.',
      },
      riskProfile: {
        title: 'Review business risks',
        reason: 'Financial, legal, market, and operational risks need mitigation plans.',
      },
      complianceProfile: {
        title: 'Track compliance obligations',
        reason: 'Licences, filings, and regulator deadlines keep the business legal.',
      },
      executionRoadmap: {
        title: 'Plan the execution roadmap',
        reason: '7-day, 30-day, 90-day, and 12-month milestones turn strategy into action.',
      },
      documentProfile: {
        title: 'Generate your legal document pack',
        reason: 'The document pack creates the core legal, privacy, and HR documents for your business.',
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

  /**
   * Return a flat checklist of all blueprint sections with done status.
   * Used by the Cockpit widget to show progress at a glance.
   */
  async getSetupSteps(businessId: string): Promise<SetupStep[]> {
    const bp = await this.getBlueprint(businessId);

    const SECTION_LABELS: Record<BlueprintSectionKey, string> = {
      identity: 'Identity',
      operatingModel: 'Operating Model',
      goals: 'Goals',
      constraints: 'Constraints',
      brand: 'Brand',
      customerModel: 'Customer Model',
      financials: 'Financials',
      intelligence: 'Intelligence',
      workflowModel: 'Workflow Model',
      aiPreferences: 'AI Preferences',
      founderProfile: 'Founder Profile',
      legalProfile: 'Legal Profile',
      registrationProfile: 'Registration Profile',
      taxProfile: 'Tax Profile',
      ownershipProfile: 'Ownership Profile',
      marketProfile: 'Market Profile',
      offerArchitecture: 'Offer Architecture',
      salesSystem: 'Sales System',
      marketingSystem: 'Marketing System',
      operationsSystem: 'Operations System',
      projectionProfile: 'Projection Profile',
      riskProfile: 'Risk Profile',
      complianceProfile: 'Compliance Profile',
      executionRoadmap: 'Execution Roadmap',
      documentProfile: 'Legal Document Pack',
    };

    return SECTION_KEYS.map((key) => {
      const fields = COMPLETENESS_FIELDS[key];
      const section = (bp[key] as unknown as Record<string, unknown>) || {};
      const filled = fields.filter((f) => isPopulated(section[f])).length;
      return {
        id: key,
        label: SECTION_LABELS[key],
        done: filled >= Math.ceil(fields.length / 2),
      };
    });
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

    // Genesis sections are seeded as empty objects until the operator or an
    // inference engine fills them in.
    const founderProfile: BlueprintFounderProfile = {};
    const legalProfile: BlueprintLegalProfile = {};
    const registrationProfile: BlueprintRegistrationProfile = {};
    const taxProfile: BlueprintTaxProfile = {};
    const ownershipProfile: BlueprintOwnershipProfile = {};
    const marketProfile: BlueprintMarketProfile = {};
    const offerArchitecture: BlueprintOfferArchitecture = {};
    const salesSystem: BlueprintSalesSystem = {};
    const marketingSystem: BlueprintMarketingSystem = {};
    const operationsSystem: BlueprintOperationsSystem = {};
    const projectionProfile: BlueprintProjectionProfile = {};
    const riskProfile: BlueprintRiskProfile = {};
    const complianceProfile: BlueprintComplianceProfile = {};
    const executionRoadmap: BlueprintExecutionRoadmap = {};
    const documentProfile: BlueprintDocumentProfile = {};

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
      founderProfile,
      legalProfile,
      registrationProfile,
      taxProfile,
      ownershipProfile,
      marketProfile,
      offerArchitecture,
      salesSystem,
      marketingSystem,
      operationsSystem,
      projectionProfile,
      riskProfile,
      complianceProfile,
      executionRoadmap,
      documentProfile,
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
        founderProfile: founderProfile as unknown as Prisma.InputJsonValue,
        legalProfile: legalProfile as unknown as Prisma.InputJsonValue,
        registrationProfile: registrationProfile as unknown as Prisma.InputJsonValue,
        taxProfile: taxProfile as unknown as Prisma.InputJsonValue,
        ownershipProfile: ownershipProfile as unknown as Prisma.InputJsonValue,
        marketProfile: marketProfile as unknown as Prisma.InputJsonValue,
        offerArchitecture: offerArchitecture as unknown as Prisma.InputJsonValue,
        salesSystem: salesSystem as unknown as Prisma.InputJsonValue,
        marketingSystem: marketingSystem as unknown as Prisma.InputJsonValue,
        operationsSystem: operationsSystem as unknown as Prisma.InputJsonValue,
        projectionProfile: projectionProfile as unknown as Prisma.InputJsonValue,
        riskProfile: riskProfile as unknown as Prisma.InputJsonValue,
        complianceProfile: complianceProfile as unknown as Prisma.InputJsonValue,
        executionRoadmap: executionRoadmap as unknown as Prisma.InputJsonValue,
        documentProfile: documentProfile as unknown as Prisma.InputJsonValue,
        readinessScore: 0,
        confidenceScores: confidenceScores as unknown as Prisma.InputJsonValue,
        completeness,
      },
      update: {},
      // documentProfile is intentionally left empty on seed; it is populated
      // by GenesisDocumentPackService once the legal disclaimer is accepted.
    });
  }

  private calculateCompleteness(sections: Record<BlueprintSectionKey, Record<string, unknown>>): number {
    const sectionScores: number[] = [];
    for (const key of CORE_SECTION_KEYS) {
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

  private buildGenomeIntegrityResult(
    row: {
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
      founderProfile: Prisma.JsonValue;
      legalProfile: Prisma.JsonValue;
      registrationProfile: Prisma.JsonValue;
      taxProfile: Prisma.JsonValue;
      ownershipProfile: Prisma.JsonValue;
      marketProfile: Prisma.JsonValue;
      offerArchitecture: Prisma.JsonValue;
      salesSystem: Prisma.JsonValue;
      marketingSystem: Prisma.JsonValue;
      operationsSystem: Prisma.JsonValue;
      projectionProfile: Prisma.JsonValue;
      riskProfile: Prisma.JsonValue;
      complianceProfile: Prisma.JsonValue;
      executionRoadmap: Prisma.JsonValue;
      documentProfile: Prisma.JsonValue;
    },
  ): GenomeIntegrityResult {
    const sections: Record<BlueprintSectionKey, Record<string, unknown>> = {
      identity: readObject(row.identity),
      operatingModel: readObject(row.operatingModel),
      goals: readObject(row.goals),
      constraints: readObject(row.constraints),
      brand: readObject(row.brand),
      customerModel: readObject(row.customerModel),
      financials: readObject(row.financials),
      intelligence: readObject(row.intelligence),
      workflowModel: readObject(row.workflowModel),
      aiPreferences: readObject(row.aiPreferences),
      founderProfile: readObject(row.founderProfile),
      legalProfile: readObject(row.legalProfile),
      registrationProfile: readObject(row.registrationProfile),
      taxProfile: readObject(row.taxProfile),
      ownershipProfile: readObject(row.ownershipProfile),
      marketProfile: readObject(row.marketProfile),
      offerArchitecture: readObject(row.offerArchitecture),
      salesSystem: readObject(row.salesSystem),
      marketingSystem: readObject(row.marketingSystem),
      operationsSystem: readObject(row.operationsSystem),
      projectionProfile: readObject(row.projectionProfile),
      riskProfile: readObject(row.riskProfile),
      complianceProfile: readObject(row.complianceProfile),
      executionRoadmap: readObject(row.executionRoadmap),
      documentProfile: readObject(row.documentProfile),
    };

    const dnaSections = (Object.keys(DNA_SECTION_CONFIG) as DnaSectionKey[]).map((key) =>
      this.buildDnaSectionScore(key, sections),
    );

    const genomeDnaScores: Record<DnaSectionKey, number> = {
      founder: 0,
      vision: 0,
      business: 0,
      market: 0,
      financial: 0,
      legal: 0,
      operations: 0,
      sales: 0,
      marketing: 0,
      growth: 0,
      technology: 0,
    };
    for (const section of dnaSections) {
      genomeDnaScores[section.key] = section.integrity;
    }

    const totalWeight = Object.values(DNA_SECTION_WEIGHTS).reduce((a, b) => a + b, 0);
    const weightedSum = dnaSections.reduce(
      (sum, section) => sum + section.integrity * DNA_SECTION_WEIGHTS[section.key],
      0,
    );
    const genomeIntegrity = totalWeight ? Math.round(weightedSum / totalWeight) : 0;

    const threePillarMinimumMet = this.checkThreePillarMinimum(genomeDnaScores);
    const genomeStage = this.determineGenomeStage(genomeIntegrity, genomeDnaScores);

    return {
      genomeIntegrity,
      genomeDnaScores,
      genomeDnaConfidence: { ...genomeDnaScores },
      genomeStage,
      threePillarMinimumMet,
      dnaSections,
    };
  }

  private buildDnaSectionScore(
    key: DnaSectionKey,
    sections: Record<BlueprintSectionKey, Record<string, unknown>>,
  ): DnaSectionScore {
    const config = DNA_SECTION_CONFIG[key];
    const populatedFields: string[] = [];
    const missingFields: string[] = [];

    for (const field of config.fields) {
      let value: unknown;
      for (const source of config.sources) {
        const section = sections[source] || {};
        if (field in section) {
          value = section[field];
          break;
        }
      }
      if (isPopulated(value)) {
        populatedFields.push(field);
      } else {
        missingFields.push(field);
      }
    }

    const fieldsTotal = config.fields.length;
    const integrity = fieldsTotal ? Math.round((populatedFields.length / fieldsTotal) * 100) : 0;

    return {
      key,
      label: config.label,
      integrity,
      confidence: integrity,
      summary: this.buildSectionSummary(key, integrity, missingFields),
      fieldsCaptured: populatedFields.length,
      fieldsTotal,
      missingFields,
      recommendation: this.buildSectionRecommendation(key, missingFields),
    };
  }

  private buildSectionSummary(
    key: DnaSectionKey,
    integrity: number,
    missingFields: string[],
  ): string {
    if (integrity === 100) return `${DNA_SECTION_CONFIG[key].label} is complete.`;
    if (integrity === 0) return `${DNA_SECTION_CONFIG[key].label} has not been started.`;
    const firstMissing = missingFields.slice(0, 3).join(', ');
    return `${DNA_SECTION_CONFIG[key].label} is partially complete. Missing: ${firstMissing}${missingFields.length > 3 ? '...' : ''}`;
  }

  private buildSectionRecommendation(key: DnaSectionKey, missingFields: string[]): string {
    if (!missingFields.length) return 'No further fields required.';
    const next = missingFields[0];
    const readable = next.replace(/([A-Z])/g, ' $1').toLowerCase();
    return `Add ${readable} to strengthen ${DNA_SECTION_CONFIG[key].label}.`;
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
    founderProfile: Prisma.JsonValue;
    legalProfile: Prisma.JsonValue;
    registrationProfile: Prisma.JsonValue;
    taxProfile: Prisma.JsonValue;
    ownershipProfile: Prisma.JsonValue;
    marketProfile: Prisma.JsonValue;
    offerArchitecture: Prisma.JsonValue;
    salesSystem: Prisma.JsonValue;
    marketingSystem: Prisma.JsonValue;
    operationsSystem: Prisma.JsonValue;
    projectionProfile: Prisma.JsonValue;
    riskProfile: Prisma.JsonValue;
    complianceProfile: Prisma.JsonValue;
    executionRoadmap: Prisma.JsonValue;
    documentProfile: Prisma.JsonValue;
    readinessScore: number;
    confidenceScores: Prisma.JsonValue;
    completeness: number;
    lastAnalyzedAt: Date | null;
    updatedAt: Date;
    genomeIntegrity?: number | null;
    genomeDnaScores?: Prisma.JsonValue;
    genomeDnaConfidence?: Prisma.JsonValue;
    genomeStage?: string | null;
    genesisCompleted?: boolean | null;
    constitutionVersion?: number | null;
    constitutionGeneratedAt?: Date | null;
    lastGenomeSyncAt?: Date | null;
    businessAssets?: Prisma.JsonValue;
    executiveReadinessScore?: number | null;
  }): BlueprintData {
    const result: BlueprintData = {
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
      founderProfile: readObject(row.founderProfile) as BlueprintFounderProfile,
      legalProfile: readObject(row.legalProfile) as BlueprintLegalProfile,
      registrationProfile: readObject(row.registrationProfile) as BlueprintRegistrationProfile,
      taxProfile: readObject(row.taxProfile) as BlueprintTaxProfile,
      ownershipProfile: readObject(row.ownershipProfile) as BlueprintOwnershipProfile,
      marketProfile: readObject(row.marketProfile) as BlueprintMarketProfile,
      offerArchitecture: readObject(row.offerArchitecture) as BlueprintOfferArchitecture,
      salesSystem: readObject(row.salesSystem) as BlueprintSalesSystem,
      marketingSystem: readObject(row.marketingSystem) as BlueprintMarketingSystem,
      operationsSystem: readObject(row.operationsSystem) as BlueprintOperationsSystem,
      projectionProfile: readObject(row.projectionProfile) as BlueprintProjectionProfile,
      riskProfile: readObject(row.riskProfile) as BlueprintRiskProfile,
      complianceProfile: readObject(row.complianceProfile) as BlueprintComplianceProfile,
      executionRoadmap: readObject(row.executionRoadmap) as BlueprintExecutionRoadmap,
      documentProfile: readObject(row.documentProfile) as BlueprintDocumentProfile,
      readinessScore: row.readinessScore,
      confidenceScores: readObject(row.confidenceScores) as any,
      completeness: row.completeness,
      lastAnalyzedAt: row.lastAnalyzedAt?.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };

    if (row.genomeIntegrity != null) result.genomeIntegrity = row.genomeIntegrity;
    if (row.genomeDnaScores) result.genomeDnaScores = readObject(row.genomeDnaScores) as Record<DnaSectionKey, number>;
    if (row.genomeDnaConfidence) {
      result.genomeDnaConfidence = readObject(row.genomeDnaConfidence) as Record<DnaSectionKey, number>;
    }
    if (row.genomeStage) result.genomeStage = row.genomeStage as GenomeStage;
    if (row.genesisCompleted != null) result.genesisCompleted = row.genesisCompleted;
    if (row.constitutionVersion != null) result.constitutionVersion = row.constitutionVersion;
    if (row.constitutionGeneratedAt) {
      result.constitutionGeneratedAt = row.constitutionGeneratedAt.toISOString();
    }
    if (row.lastGenomeSyncAt) result.lastGenomeSyncAt = row.lastGenomeSyncAt.toISOString();
    if (row.businessAssets) result.businessAssets = readObject(row.businessAssets) as Record<string, unknown>;
    if (row.executiveReadinessScore != null) result.executiveReadinessScore = row.executiveReadinessScore;

    return result;
  }
}
