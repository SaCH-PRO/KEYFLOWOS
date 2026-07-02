import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import type {
  BlueprintSectionKey,
  DnaSectionKey,
  DnaSectionScore,
  GenomeIntegrityResult,
  GenomeStage,
} from '../../blueprint/blueprint.types';
import { GenomeModuleReadinessService } from './genome-module-readiness.service';
import { GenomeScoringService } from './genome-scoring.service';
import { type KeyGenomeModuleName, type KeyGenomeSection } from './key-genome.ontology';
import type {
  GenomeFactData,
  KeyGenomeScore,
  ModuleReadinessData,
} from './key-genome.types';

/**
 * Maps each Business DNA section to the KEY Genome section that supplies its
 * fact-based score. This is the single source of truth for the Blueprint -
 * Genome reconciliation; when facts exist for a mapped KEY Genome section,
 * they override the blueprint field-count score for that DNA section.
 */
export const DNA_TO_KEY_GENOME_SECTION: Record<DnaSectionKey, KeyGenomeSection> = {
  founder: 'FOUNDER_LEADERSHIP',
  vision: 'VISION_IDENTITY',
  business: 'BUSINESS_MODEL',
  market: 'CUSTOMER_MARKET',
  financial: 'FINANCIAL',
  legal: 'LEGAL_GOVERNANCE_COMPLIANCE',
  operations: 'OPERATIONS_DELIVERY',
  sales: 'SALES',
  marketing: 'MARKETING_GROWTH',
  growth: 'MARKETING_GROWTH',
  technology: 'TECH_DATA_INTELLIGENCE',
  risk: 'RISK_RESILIENCE',
};

/**
 * Weights used to roll up Blueprint-derived DNA section scores into a single
 * genome integrity value when no KEY Genome facts are available yet.
 */
export const DNA_SECTION_WEIGHTS: Record<DnaSectionKey, number> = {
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
  risk: 0,
};

/**
 * Blueprint source columns and fields that back each DNA section. This drives
 * the fallback Blueprint-derived scoring and the DNA section editor mapping.
 */
export const DNA_SECTION_CONFIG: Record<
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
  risk: {
    sources: ['riskProfile'],
    fields: ['financialRisks', 'legalRisks', 'marketRisks', 'operationalRisks', 'founderRisks', 'mitigationPlan'],
    label: 'Risk DNA',
  },
};

/**
 * Weights used to compute the executive readiness score from DNA section scores.
 */
export const EXECUTIVE_READINESS_WEIGHTS: Record<string, number> = {
  legal: 15,
  financial: 20,
  market: 15,
  operations: 15,
  sales: 10,
  marketing: 10,
  risk: 15,
};

export function isPopulated(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'boolean') return true;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'number') return !Number.isNaN(value);
  if (typeof value === 'object') return Object.keys(value as object).length > 0;
  return Boolean(value);
}

export function readObject(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

@Injectable()
export class KeyGenomeService {
  private readonly logger = new Logger(KeyGenomeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scoring: GenomeScoringService,
    private readonly moduleReadiness: GenomeModuleReadinessService,
  ) {}

  /**
   * Single source of truth for the full Business Genome integrity result.
   *
   * When KEY Genome facts exist, fact-based scoring is canonical and Blueprint-
   * derived field counts are used only as a fallback for DNA sections without
   * matching facts. When no facts exist, the calculation falls back to the
   * Blueprint-derived weighted average.
   */
  async getGenomeIntegrity(businessId: string): Promise<GenomeIntegrityResult> {
    return this.calculateIntegrity(businessId);
  }

  async calculateIntegrity(businessId: string): Promise<GenomeIntegrityResult> {
    const row = await this.loadBlueprintRow(businessId);
    const facts = await this.scoring.computeFactScores(businessId);
    const sections = this.extractSections(row);
    return this.buildIntegrityResult(businessId, sections, facts);
  }

  /**
   * Recompute the complete genome score ecosystem from a single entry point.
   * Returns the integrity result, the underlying KEY Genome score, module
   * readiness, and department readiness snapshots.
   */
  async recomputeScores(businessId: string): Promise<{
    integrity: GenomeIntegrityResult;
    keyGenomeScore: KeyGenomeScore;
    readiness: ModuleReadinessData[];
  }> {
    const row = await this.loadBlueprintRow(businessId);
    const facts = await this.scoring.computeFactScores(businessId);
    const sections = this.extractSections(row);
    const integrity = this.buildIntegrityResult(businessId, sections, facts);
    const keyGenomeScore = this.scoring.computeBusinessScore(businessId, facts);

    const readiness = await this.moduleReadiness.computeReadiness(businessId, facts).catch((err) => {
      this.logger.warn(`Module readiness recomputation failed for ${businessId}: ${(err as Error).message}`);
      return [] as ModuleReadinessData[];
    });

    return { integrity, keyGenomeScore, readiness };
  }

  async getReadiness(
    businessId: string,
    module?: string,
  ): Promise<ModuleReadinessData | ModuleReadinessData[] | null> {
    return this.moduleReadiness.getReadiness(businessId, module as KeyGenomeModuleName | undefined);
  }

  buildIntegrityResult(
    businessId: string,
    sections: Record<BlueprintSectionKey, Record<string, unknown>>,
    facts?: GenomeFactData[],
  ): GenomeIntegrityResult {
    const factInput = facts ?? [];
    const factScore = factInput.length > 0 ? this.scoring.computeBusinessScore(businessId, factInput) : null;
    const factSectionMap = new Map(
      (factScore?.sections ?? []).map((s) => [s.section, s.score] as const),
    );

    const rawDnaSections = (Object.keys(DNA_SECTION_CONFIG) as DnaSectionKey[]).map((key) =>
      this.buildSectionScore(key, sections),
    );

    const dnaSections = rawDnaSections.map((section) => {
      const keyGenomeSection = DNA_TO_KEY_GENOME_SECTION[section.key];
      const factSectionScore = keyGenomeSection ? factSectionMap.get(keyGenomeSection) : undefined;
      if (!factSectionScore) {
        return section;
      }
      return {
        ...section,
        integrity: Math.round(factSectionScore.overall * 100),
        confidence: Math.round(factSectionScore.confidence * 100),
      };
    });

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
      risk: 0,
    };
    for (const section of dnaSections) {
      genomeDnaScores[section.key] = section.integrity;
    }

    const genomeDnaConfidence: Record<DnaSectionKey, number> = {
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
      risk: 0,
    };
    for (const section of dnaSections) {
      genomeDnaConfidence[section.key] = section.confidence;
    }

    let genomeIntegrity: number;
    if (factScore) {
      genomeIntegrity = Math.round(factScore.overall * 100);
    } else {
      const totalWeight = Object.values(DNA_SECTION_WEIGHTS).reduce((a, b) => a + b, 0);
      const weightedSum = dnaSections.reduce(
        (sum, section) => sum + section.integrity * (DNA_SECTION_WEIGHTS[section.key] ?? 0),
        0,
      );
      genomeIntegrity = totalWeight ? Math.round(weightedSum / totalWeight) : 0;
    }

    const readinessBreakdown: Record<string, number> = {};
    let readinessWeightedSum = 0;
    let readinessTotalWeight = 0;
    for (const [key, weight] of Object.entries(EXECUTIVE_READINESS_WEIGHTS)) {
      const score = genomeDnaScores[key as DnaSectionKey] ?? 0;
      readinessBreakdown[key] = score;
      readinessWeightedSum += score * weight;
      readinessTotalWeight += weight;
    }
    const executiveReadinessScore = readinessTotalWeight
      ? Math.round(readinessWeightedSum / readinessTotalWeight)
      : 0;

    const threePillarMinimumMet = this.checkThreePillarMinimum(genomeDnaScores);
    const genomeStage = this.determineGenomeStage(genomeIntegrity, genomeDnaScores);

    return {
      genomeIntegrity,
      genomeDnaScores,
      genomeDnaConfidence,
      genomeStage,
      threePillarMinimumMet,
      dnaSections,
      executiveReadinessScore,
      readinessBreakdown,
    };
  }

  buildSectionScore(
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

  checkThreePillarMinimum(scores: Record<DnaSectionKey, number>): boolean {
    return scores.founder >= 50 && scores.business >= 50 && scores.market >= 50;
  }

  determineGenomeStage(integrity: number, scores: Record<DnaSectionKey, number>): GenomeStage {
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

  private buildSectionSummary(key: DnaSectionKey, integrity: number, missingFields: string[]): string {
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

  private async loadBlueprintRow(businessId: string): Promise<Record<string, unknown>> {
    const row = await this.prisma.client.businessBlueprint.findUnique({
      where: { businessId },
    });
    return row ?? {};
  }

  private extractSections(row: Record<string, unknown>): Record<BlueprintSectionKey, Record<string, unknown>> {
    const sections: Record<BlueprintSectionKey, Record<string, unknown>> = {
      identity: {},
      operatingModel: {},
      goals: {},
      constraints: {},
      brand: {},
      customerModel: {},
      financials: {},
      intelligence: {},
      workflowModel: {},
      aiPreferences: {},
      founderProfile: {},
      legalProfile: {},
      registrationProfile: {},
      taxProfile: {},
      ownershipProfile: {},
      marketProfile: {},
      offerArchitecture: {},
      salesSystem: {},
      marketingSystem: {},
      operationsSystem: {},
      projectionProfile: {},
      riskProfile: {},
      complianceProfile: {},
      executionRoadmap: {},
      documentProfile: {},
    };
    for (const key of Object.keys(sections) as BlueprintSectionKey[]) {
      sections[key] = readObject(row[key]);
    }
    return sections;
  }
}
