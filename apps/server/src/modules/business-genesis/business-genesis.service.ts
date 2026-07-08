import { Inject, Injectable, BadRequestException, Logger, Optional } from '@nestjs/common';
import { BlueprintService } from '../blueprint/blueprint.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import type {
  BlueprintData,
  BlueprintLegalProfile,
  BlueprintPatch,
  BlueprintRecommendedEntityType,
  BlueprintRiskItem,
} from '../blueprint/blueprint.types';
import { ModelGatewayService } from '../ai/model-gateway.service';
import { coerceToContract } from '../ai/ai-output-contracts';
import type { GenesisIdeaExtractionContract } from '../ai/ai-output-contracts';
import {
  GenesisActionPlan,
  GenesisIdeaAnalysis,
  GenesisProgress,
  GenesisQuestion,
  GenesisReadinessScore,
} from './business-genesis.types';
import { GENESIS_QUESTION_BANK } from './genesis-question-bank';
import { GenesisProjectionService } from './projection-engine.service';
import { GenesisReadinessScorer } from './readiness-scorer.service';
import { GenesisActionPlanBuilder } from './action-plan-builder.service';
import { GenesisDocumentPackService } from './genesis-document-pack.service';
import { GenesisRiskRegisterService } from './genesis-risk-register.service';
import { inferCompliance } from './trinidad-compliance-rules';
import { GenomeFactService } from '../business-genome/key-genome/genome-fact.service';
import { GenomeEvidenceService } from '../business-genome/key-genome/genome-evidence.service';
import type { BlueprintSectionKey } from '../blueprint/blueprint.types';
import { normalizeRecommendedEntityType } from '../blueprint/entity-type.helpers';

function isPopulated(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'boolean') return true;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'number') return !Number.isNaN(value);
  if (typeof value === 'object') return Object.keys(value as object).length > 0;
  return Boolean(value);
}

function compactSection<T extends Record<string, unknown>>(obj: T): T {
  const result = {} as T;
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      (result as Record<string, unknown>)[key] = value;
    }
  }
  return result;
}

function mergeSections(blueprint: BlueprintData, patch: BlueprintPatch): BlueprintData {
  const merged = { ...(blueprint as unknown as Record<string, unknown>) };
  for (const [section, data] of Object.entries(patch)) {
    if (data && typeof data === 'object') {
      merged[section] = {
        ...((merged[section] as Record<string, unknown>) || {}),
        ...(data as Record<string, unknown>),
      };
    }
  }
  return merged as unknown as BlueprintData;
}

function answersAffectCompliance(answers: Record<string, unknown>): boolean {
  for (const key of Object.keys(answers)) {
    if (
      key.startsWith('legalProfile.') ||
      key.startsWith('registrationProfile.') ||
      key.startsWith('taxProfile.')
    ) {
      return true;
    }
    if (
      [
        'country',
        'hasEmployees',
        'estimatedAnnualRevenue',
        'hasPhysicalLocation',
        'hasRegulatedActivity',
        'regulatedIndustry',
        'legalStructurePreference',
      ].includes(key)
    ) {
      return true;
    }
  }
  return false;
}

function answersAffectProjection(answers: Record<string, unknown>): boolean {
  for (const key of Object.keys(answers)) {
    if (key.startsWith('projectionProfile.') || key.startsWith('financials.')) {
      return true;
    }
    if (
      [
        'startupCapital',
        'startupCosts',
        'monthlyFixedCosts',
        'variableCostPercent',
        'expectedMonthlyUnits',
        'conservativeMonthlyUnits',
        'aggressiveMonthlyUnits',
        'avgTicket',
        'monthlyTarget',
        'pricingModel',
      ].includes(key)
    ) {
      return true;
    }
  }
  return false;
}

function coerceEntityType(value: unknown): BlueprintRecommendedEntityType {
  return normalizeRecommendedEntityType(value);
}

function contractToBlueprintPatch(contract: GenesisIdeaExtractionContract): BlueprintPatch {
  const patch: BlueprintPatch = {};

  if (contract.identity && Object.keys(contract.identity).length) {
    const compacted = compactSection({ ...contract.identity });
    if (Object.keys(compacted).length) patch.identity = compacted;
  }

  if (contract.operatingModel && Object.keys(contract.operatingModel).length) {
    const compacted = compactSection({ ...contract.operatingModel });
    if (Object.keys(compacted).length) patch.operatingModel = compacted;
  }

  if (contract.customerModel && Object.keys(contract.customerModel).length) {
    const compacted = compactSection({ ...contract.customerModel });
    if (Object.keys(compacted).length) patch.customerModel = compacted;
  }

  if (contract.marketProfile && Object.keys(contract.marketProfile).length) {
    const compacted = compactSection({ ...contract.marketProfile });
    if (Object.keys(compacted).length) patch.marketProfile = compacted;
  }

  if (contract.founderProfile && Object.keys(contract.founderProfile).length) {
    const compacted = compactSection({ ...contract.founderProfile });
    if (Object.keys(compacted).length) patch.founderProfile = compacted;
  }

  if (contract.goals && Object.keys(contract.goals).length) {
    const compacted = compactSection({ ...contract.goals });
    if (Object.keys(compacted).length) patch.goals = compacted;
  }

  if (contract.constraints && Object.keys(contract.constraints).length) {
    const compacted = compactSection({ ...contract.constraints });
    if (Object.keys(compacted).length) patch.constraints = compacted;
  }

  if (contract.financials && Object.keys(contract.financials).length) {
    const compacted = compactSection({ ...contract.financials });
    if (Object.keys(compacted).length) patch.financials = compacted;
  }

  if (contract.legalProfile && Object.keys(contract.legalProfile).length) {
    const { recommendedEntityType, ...rest } = contract.legalProfile;
    const legalProfileInput: Record<string, unknown> = { ...rest };
    if (recommendedEntityType !== undefined) {
      legalProfileInput.recommendedEntityType = coerceEntityType(recommendedEntityType);
    }
    const compacted = compactSection(legalProfileInput);
    if (Object.keys(compacted).length) patch.legalProfile = compacted as Partial<BlueprintLegalProfile>;
  }

  if (contract.projectionProfile && Object.keys(contract.projectionProfile).length) {
    const compacted = compactSection({ ...contract.projectionProfile });
    if (Object.keys(compacted).length) patch.projectionProfile = compacted;
  }

  if (contract.riskProfile && Object.keys(contract.riskProfile).length) {
    const { legalRiskFlags, marketRiskFlags, operationalRiskFlags } = contract.riskProfile;
    const compacted: typeof patch.riskProfile = {};
    if (Array.isArray(legalRiskFlags)) {
      compacted.legalRisks = legalRiskFlags
        .filter((description): description is string => typeof description === 'string')
        .map((description): BlueprintRiskItem => ({ description, likelihood: 'MEDIUM', impact: 'MEDIUM' }));
    }
    if (Array.isArray(marketRiskFlags)) {
      compacted.marketRisks = marketRiskFlags
        .filter((description): description is string => typeof description === 'string')
        .map((description): BlueprintRiskItem => ({ description, likelihood: 'MEDIUM', impact: 'MEDIUM' }));
    }
    if (Array.isArray(operationalRiskFlags)) {
      compacted.operationalRisks = operationalRiskFlags
        .filter((description): description is string => typeof description === 'string')
        .map((description): BlueprintRiskItem => ({ description, likelihood: 'MEDIUM', impact: 'MEDIUM' }));
    }
    if (Object.keys(compacted).length) patch.riskProfile = compacted;
  }

  return patch;
}

@Injectable()
export class BusinessGenesisService {
  private readonly logger = new Logger(BusinessGenesisService.name);

  constructor(
    @Inject(BlueprintService) private readonly blueprint: BlueprintService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ModelGatewayService) private readonly modelGateway: ModelGatewayService,
    @Inject(GenesisProjectionService) private readonly projection: GenesisProjectionService,
    @Inject(GenesisReadinessScorer) private readonly readiness: GenesisReadinessScorer,
    @Inject(GenesisActionPlanBuilder) private readonly actionPlanBuilder: GenesisActionPlanBuilder,
    @Inject(GenesisDocumentPackService) private readonly documentPack: GenesisDocumentPackService,
    @Inject(GenesisRiskRegisterService) private readonly riskRegister: GenesisRiskRegisterService,
    @Optional()
    @Inject(GenomeFactService)
    private readonly genomeFactService?: GenomeFactService,
    @Optional()
    @Inject(GenomeEvidenceService)
    private readonly genomeEvidenceService?: GenomeEvidenceService,
  ) {}

  async analyzeIdea(businessId: string, ideaText: string): Promise<GenesisIdeaAnalysis> {
    if (!ideaText || ideaText.length < 10 || ideaText.length > 4000) {
      throw new BadRequestException('Idea text must be between 10 and 4000 characters.');
    }

    const blueprint = await this.blueprint.getBlueprint(businessId);

    const systemPrompt = `You are the Business Genesis engine for KEYFLOWOS. Analyze the user's business idea and extract a structured summary.

Current blueprint context:
- Business name: ${blueprint.identity.name || 'unknown'}
- Country: ${blueprint.identity.country || 'unknown'}
- One-liner: ${blueprint.identity.oneLiner || 'unknown'}
- Revenue model: ${blueprint.operatingModel.revenueModel || 'unknown'}
- Existing ideal customer: ${blueprint.customerModel.idealCustomer || 'unknown'}

Return ONLY a JSON object matching the genesis_idea_extraction contract:
{
  "summary": "<2-3 sentence summary of the idea>",
  "identity": { "name?", "archetype?", "industry?", "oneLiner?", "country?" },
  "operatingModel": { "revenueModel?", "deliveryMode?", "serviceArea?", "teamSize?", "channels?": string[] },
  "legalProfile": { "recommendedEntityType?": "SOLE_TRADER" | "PARTNERSHIP" | "LIMITED_COMPANY" | "NONPROFIT" | "UNKNOWN", "entityTypeReason?", "regulatedIndustry?": boolean, "regulatedIndustryNotes?" },
  "customerModel": { "idealCustomer?", "segments?": string[], "painPoints?": string[] },
  "marketProfile": { "targetGeography?", "marketCategory?", "marketStage?", "demandSignals?": string[] },
  "financials": { "pricingModel?", "avgTicket?": number, "currency?" },
  "projectionProfile": { "startupCapital?": number, "startupCosts?": number, "monthlyFixedCosts?": number, "expectedMonthlyUnits?": number, "variableCostPercent?": number },
  "founderProfile": { "founderName?", "background?", "skills?": string[], "weeklyAvailabilityHours?": number, "riskTolerance?": "low" | "medium" | "high" },
  "goals": { "northStar?": string },
  "constraints": { "budgetRange?": string, "timeCommitment?": string, "riskTolerance?": "low" | "medium" | "high" },
  "riskProfile": { "legalRiskFlags?": string[], "marketRiskFlags?": string[], "operationalRiskFlags?": string[] }
}

Use null or omit fields when unknown. Keep the summary concrete and actionable.`;

    let raw: unknown;
    try {
      const response = await this.modelGateway.complete({
        businessId,
        taskCategory: 'extraction',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: ideaText },
        ],
        expectedContract: 'genesis_idea_extraction',
        maxTokens: 1200,
        temperature: 0.4,
      });
      raw = response.content ? JSON.parse(response.content) : {};
    } catch (err: any) {
      this.logger.warn(
        `analyzeIdea model call failed for ${businessId}: ${(err as Error).message}`,
      );
      raw = {};
    }

    const fallback: GenesisIdeaExtractionContract = {
      summary: ideaText.slice(0, 200),
      identity: {},
    };
    const contract = coerceToContract<GenesisIdeaExtractionContract>(
      raw,
      'genesis_idea_extraction',
      fallback,
    );

    const extracted = contractToBlueprintPatch(contract) as Partial<BlueprintData>;
    const suggestedEntityType = coerceEntityType(contract.legalProfile?.recommendedEntityType);

    // Merge extracted preview into a temporary blueprint view for question selection.
    const previewBlueprint = await this.buildPreviewBlueprint(businessId, extracted);

    // Compute a non-persistent compliance preview for T&T and other jurisdictions.
    const complianceInput = {
      entityType: previewBlueprint.legalProfile?.recommendedEntityType,
      hasEmployees: (() => {
        const explicit = previewBlueprint.registrationProfile?.hasEmployees;
        if (typeof explicit === 'boolean') return explicit;
        const status = previewBlueprint.registrationProfile?.nisEmployerStatus;
        return status !== undefined && status !== 'NOT_NEEDED';
      })(),
      estimatedAnnualRevenue: previewBlueprint.taxProfile?.estimatedAnnualRevenue,
      industry: previewBlueprint.identity.industry,
      regulatedIndustry: previewBlueprint.legalProfile?.regulatedIndustry,
      hasPhysicalLocation: previewBlueprint.legalProfile?.hasPhysicalLocation,
    };
    const complianceItems = inferCompliance(previewBlueprint.identity.country, complianceInput);
    previewBlueprint.complianceProfile = {
      ...(previewBlueprint.complianceProfile || {}),
      complianceItems,
      complianceScore: this.readiness.calculateComplianceScore(complianceItems),
    };

    const readiness = this.readiness.calculate(previewBlueprint);
    const nextQuestions = this.getNextQuestionsFromBlueprint(previewBlueprint, 3);

    return {
      summary: contract.summary || fallback.summary,
      extracted,
      readiness,
      suggestedEntityType,
      nextQuestions,
    };
  }

  async getNextQuestions(businessId: string, limit = 3): Promise<GenesisQuestion[]> {
    const blueprint = await this.blueprint.getBlueprint(businessId);
    return this.getNextQuestionsFromBlueprint(blueprint, limit);
  }

  private getNextQuestionsFromBlueprint(
    blueprint: BlueprintData,
    limit: number,
  ): GenesisQuestion[] {
    const missing = GENESIS_QUESTION_BANK.filter((q) => {
      const section = blueprint[q.section] as Record<string, unknown> | undefined;
      if (!section) return true;
      return !isPopulated(section[q.field]);
    });

    missing.sort((a, b) => b.priority - a.priority);
    return missing.slice(0, limit);
  }

  private async buildPreviewBlueprint(
    businessId: string,
    patch: BlueprintPatch,
  ): Promise<BlueprintData> {
    // Avoid persisting: merge patch into current blueprint manually.
    const current = await this.blueprint.getBlueprint(businessId);
    const merged = { ...(current as unknown as Record<string, unknown>) };
    for (const [section, data] of Object.entries(patch)) {
      if (data && typeof data === 'object') {
        merged[section] = {
          ...(merged[section] as Record<string, unknown>),
          ...(data as Record<string, unknown>),
        };
      }
    }
    return merged as unknown as BlueprintData;
  }

  async submitAnswers(
    businessId: string,
    answers: Record<string, unknown>,
  ): Promise<GenesisProgress> {
    const afterOnboarding = await this.blueprint.inferFromOnboarding(businessId, answers);

    // Sync top-level business fields so setup status and storefront work immediately.
    const businessUpdate: Record<string, unknown> = {};
    if (typeof answers.businessName === 'string') businessUpdate.name = answers.businessName.trim();
    if (typeof answers.businessIntent === 'string') businessUpdate.businessIntent = answers.businessIntent.trim();
    if (typeof answers.country === 'string') businessUpdate.country = answers.country.trim();
    if (typeof answers.currency === 'string') businessUpdate.currency = answers.currency.trim();
    if (Object.keys(businessUpdate).length) {
      await this.prisma.client.business.update({
        where: { id: businessId },
        data: businessUpdate,
      });
    }

    const patch: BlueprintPatch = {};

    if (answersAffectCompliance(answers)) {
      const complianceInput = {
        entityType: afterOnboarding.legalProfile?.recommendedEntityType,
        hasEmployees: (() => {
          const explicit = afterOnboarding.registrationProfile?.hasEmployees;
          if (typeof explicit === 'boolean') return explicit;
          const status = afterOnboarding.registrationProfile?.nisEmployerStatus;
          return status !== undefined && status !== 'NOT_NEEDED';
        })(),
        estimatedAnnualRevenue: afterOnboarding.taxProfile?.estimatedAnnualRevenue,
        industry: afterOnboarding.identity.industry,
        regulatedIndustry: afterOnboarding.legalProfile?.regulatedIndustry,
        hasPhysicalLocation: afterOnboarding.legalProfile?.hasPhysicalLocation,
      };
      const complianceItems = inferCompliance(afterOnboarding.identity.country, complianceInput);
      patch.complianceProfile = {
        complianceItems,
        complianceScore: this.readiness.calculateComplianceScore(complianceItems),
      };
    }

    if (answersAffectProjection(answers)) {
      patch.projectionProfile = this.projection.calculate(
        afterOnboarding.projectionProfile || {},
        afterOnboarding.financials || {},
      );
    }

    const readiness = this.readiness.calculate(mergeSections(afterOnboarding, patch));
    patch.readinessScore = readiness.overall;

    const blueprint = Object.keys(patch).length
      ? await this.blueprint.updateBlueprint(businessId, patch)
      : afterOnboarding;

    const finalReadiness = this.readiness.calculate(blueprint);
    const nextQuestions = this.getNextQuestionsFromBlueprint(blueprint, 3);

    // Close Genesis -> Genome fact loop: every answered field becomes a fact
    // with evidence pointing back to the blueprint answer.
    await this.syncAnswersToGenomeFacts(businessId, answers, blueprint).catch((err: unknown) => {
      this.logger.warn(`Genome fact sync failed for ${businessId}: ${err instanceof Error ? err.message : String(err)}`);
    });

    return {
      blueprint,
      readiness: finalReadiness,
      nextQuestions,
      complianceItems: blueprint.complianceProfile?.complianceItems || [],
    };
  }

  async getReadinessScore(businessId: string): Promise<GenesisReadinessScore> {
    const blueprint = await this.blueprint.getBlueprint(businessId);
    return this.readiness.calculate(blueprint);
  }

  async generateRoadmap(businessId: string): Promise<GenesisActionPlan> {
    const blueprint = await this.blueprint.getBlueprint(businessId);
    const readiness = this.readiness.calculate(blueprint);
    const plan = this.actionPlanBuilder.build(blueprint, readiness);

    if (plan.executionRoadmap) {
      await this.blueprint.updateBlueprint(businessId, {
        executionRoadmap: plan.executionRoadmap,
      });
    }

    return plan;
  }

  async generateDocumentPack(businessId: string) {
    return this.documentPack.generatePack(businessId);
  }

  async getDocumentPack(businessId: string) {
    return this.documentPack.getPack(businessId);
  }

  async generateRiskRegister(businessId: string) {
    return this.riskRegister.generateRisks(businessId);
  }

  /**
   * Sync Genesis answers into the Business Genome as facts with evidence.
   *
   * Each answered field becomes a GenomeFact with sourceType BUSINESS_GENESIS.
   * Evidence is attached pointing back to the blueprint answer so the fact
   * can be audited and reverted later if needed.
   */
  private async syncAnswersToGenomeFacts(
    businessId: string,
    answers: Record<string, unknown>,
    blueprint: { id?: string; updatedAt?: string | Date },
  ): Promise<void> {
    if (!this.genomeFactService || !this.genomeEvidenceService) {
      this.logger.debug(`Genome fact/evidence services unavailable; skipping Genesis fact sync`);
      return;
    }

    for (const [key, rawValue] of Object.entries(answers)) {
      if (!isPopulated(rawValue)) continue;

      const mapping = this.inferGenomeFactTarget(key, rawValue);
      if (!mapping) continue;

      const { section, domain, field, value } = mapping;
      const confidence = this.scoreAnswerConfidence(rawValue, answers);
      const verified = rawValue && typeof rawValue === 'object' && (rawValue as Record<string, unknown>).confirmed === true;

      const fact = await this.genomeFactService.upsertFact({
        businessId,
        section,
        domain,
        field,
        value: { raw: value, type: 'JSON' },
        sourceModule: 'business_genesis',
        sourceType: 'BUSINESS_GENESIS',
        sourceEntityType: 'BusinessBlueprint',
        sourceEntityId: (blueprint as any)?.businessId ?? businessId,
        verificationStatus: verified ? 'USER_VERIFIED' : 'INFERRED',
        confidenceScore: confidence,
      });

      await this.genomeEvidenceService.attachEvidence({
        businessId,
        factId: fact.id,
        sourceModule: 'business_genesis',
        sourceEntityType: 'BusinessBlueprint',
        sourceEntityId: (blueprint as any)?.businessId ?? businessId,
        summary: `Genesis answer for ${section}.${field}: ${JSON.stringify(value).slice(0, 200)}`,
        evidenceStrength: confidence,
        occurredAt: typeof blueprint.updatedAt === 'string' ? blueprint.updatedAt : (blueprint.updatedAt as Date)?.toISOString(),
      });
    }
  }

  private inferGenomeFactTarget(
    key: string,
    value: unknown,
  ): { section: string; domain: string; field: string; value: unknown } | null {
    if (key.includes('.')) {
      const [section, ...rest] = key.split('.');
      const field = rest.join('.');
      if (!field) return null;
      return { section, domain: section, field, value };
    }

    // Map legacy flat onboarding keys to their inferred blueprint section.
    const flatMap: Record<string, { section: BlueprintSectionKey; field: string }> = {
      businessName: { section: 'identity', field: 'name' },
      businessIntent: { section: 'identity', field: 'oneLiner' },
      archetype: { section: 'identity', field: 'archetype' },
      industry: { section: 'identity', field: 'industry' },
      tagline: { section: 'identity', field: 'tagline' },
      country: { section: 'identity', field: 'country' },
      revenueModel: { section: 'operatingModel', field: 'revenueModel' },
      deliveryMode: { section: 'operatingModel', field: 'deliveryMode' },
      serviceArea: { section: 'operatingModel', field: 'serviceArea' },
      teamSize: { section: 'operatingModel', field: 'teamSize' },
      channels: { section: 'operatingModel', field: 'channels' },
      budgetRange: { section: 'constraints', field: 'budgetRange' },
      timeCommitment: { section: 'constraints', field: 'timeCommitment' },
      riskTolerance: { section: 'constraints', field: 'riskTolerance' },
      northStar: { section: 'goals', field: 'northStar' },
      ninetyDayGoals: { section: 'goals', field: 'ninetyDayGoals' },
      twelveMonthGoals: { section: 'goals', field: 'twelveMonthGoals' },
      idealCustomer: { section: 'customerModel', field: 'idealCustomer' },
      targetCustomer: { section: 'customerModel', field: 'idealCustomer' },
      segments: { section: 'customerModel', field: 'segments' },
      painPoints: { section: 'customerModel', field: 'painPoints' },
      jobsToBeDone: { section: 'customerModel', field: 'jobsToBeDone' },
      currency: { section: 'financials', field: 'currency' },
      pricingModel: { section: 'financials', field: 'pricingModel' },
      avgTicket: { section: 'financials', field: 'avgTicket' },
      monthlyTarget: { section: 'financials', field: 'monthlyTarget' },
    };

    const mapped = flatMap[key];
    if (!mapped) return null;
    return { section: mapped.section, domain: mapped.section, field: mapped.field, value };
  }

  private scoreAnswerConfidence(value: unknown, _answers: Record<string, unknown>): number {
    if (value && typeof value === 'object' && (value as Record<string, unknown>).confirmed === true) {
      return 1;
    }
    if (typeof value === 'string') {
      return value.trim().length > 0 ? 0.9 : 0.3;
    }
    if (typeof value === 'number') {
      return Number.isFinite(value) ? 0.95 : 0.3;
    }
    if (typeof value === 'boolean') {
      return 0.95;
    }
    if (Array.isArray(value)) {
      return value.length > 0 ? 0.8 : 0.3;
    }
    return 0.5;
  }
}
