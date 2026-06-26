import { Inject, Injectable, BadRequestException, Logger } from '@nestjs/common';
import { BlueprintService } from '../blueprint/blueprint.service';
import type {
  BlueprintData,
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

function isPopulated(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'number') return !Number.isNaN(value);
  if (typeof value === 'object') return Object.keys(value as object).length > 0;
  return Boolean(value);
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
  const allowed: BlueprintRecommendedEntityType[] = [
    'SOLE_TRADER',
    'PARTNERSHIP',
    'LIMITED_COMPANY',
    'NONPROFIT',
    'UNKNOWN',
  ];
  if (typeof value === 'string' && allowed.includes(value as BlueprintRecommendedEntityType)) {
    return value as BlueprintRecommendedEntityType;
  }
  return 'UNKNOWN';
}

function contractToBlueprintPatch(contract: GenesisIdeaExtractionContract): BlueprintPatch {
  const patch: BlueprintPatch = {};

  if (contract.identity && Object.keys(contract.identity).length) {
    patch.identity = { ...contract.identity };
  }

  if (contract.operatingModel && Object.keys(contract.operatingModel).length) {
    patch.operatingModel = { ...contract.operatingModel };
  }

  if (contract.customerModel && Object.keys(contract.customerModel).length) {
    patch.customerModel = { ...contract.customerModel };
  }

  if (contract.financials && Object.keys(contract.financials).length) {
    patch.financials = { ...contract.financials };
  }

  if (contract.legalProfile && Object.keys(contract.legalProfile).length) {
    const { recommendedEntityType, ...rest } = contract.legalProfile;
    patch.legalProfile = {
      ...rest,
      recommendedEntityType: recommendedEntityType
        ? coerceEntityType(recommendedEntityType)
        : undefined,
    };
  }

  if (contract.projectionProfile && Object.keys(contract.projectionProfile).length) {
    patch.projectionProfile = { ...contract.projectionProfile };
  }

  if (contract.riskProfile && Object.keys(contract.riskProfile).length) {
    const { legalRiskFlags, marketRiskFlags, operationalRiskFlags } = contract.riskProfile;
    patch.riskProfile = {
      legalRisks: Array.isArray(legalRiskFlags)
        ? legalRiskFlags.map(
            (description): BlueprintRiskItem => ({ description, likelihood: 'MEDIUM', impact: 'MEDIUM' }),
          )
        : undefined,
      marketRisks: Array.isArray(marketRiskFlags)
        ? marketRiskFlags.map(
            (description): BlueprintRiskItem => ({ description, likelihood: 'MEDIUM', impact: 'MEDIUM' }),
          )
        : undefined,
      operationalRisks: Array.isArray(operationalRiskFlags)
        ? operationalRiskFlags.map(
            (description): BlueprintRiskItem => ({ description, likelihood: 'MEDIUM', impact: 'MEDIUM' }),
          )
        : undefined,
    };
  }

  return patch;
}

@Injectable()
export class BusinessGenesisService {
  private readonly logger = new Logger(BusinessGenesisService.name);

  constructor(
    @Inject(BlueprintService) private readonly blueprint: BlueprintService,
    @Inject(ModelGatewayService) private readonly modelGateway: ModelGatewayService,
    @Inject(GenesisProjectionService) private readonly projection: GenesisProjectionService,
    @Inject(GenesisReadinessScorer) private readonly readiness: GenesisReadinessScorer,
    @Inject(GenesisActionPlanBuilder) private readonly actionPlanBuilder: GenesisActionPlanBuilder,
    @Inject(GenesisDocumentPackService) private readonly documentPack: GenesisDocumentPackService,
    @Inject(GenesisRiskRegisterService) private readonly riskRegister: GenesisRiskRegisterService,
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
  "operatingModel": { "revenueModel?", "deliveryMode?" },
  "legalProfile": { "recommendedEntityType?": "SOLE_TRADER" | "PARTNERSHIP" | "LIMITED_COMPANY" | "NONPROFIT" | "UNKNOWN", "entityTypeReason?", "regulatedIndustry?": boolean, "regulatedIndustryNotes?" },
  "customerModel": { "idealCustomer?" },
  "financials": { "pricingModel?", "avgTicket?": number, "currency?" },
  "projectionProfile": { "startupCapital?": number, "startupCosts?": number, "monthlyFixedCosts?": number, "expectedMonthlyUnits?": number, "variableCostPercent?": number },
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
      hasEmployees: previewBlueprint.registrationProfile?.nisEmployerStatus === 'NOT_STARTED',
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
    const patch: BlueprintPatch = {};

    if (answersAffectCompliance(answers)) {
      const complianceInput = {
        entityType: afterOnboarding.legalProfile?.recommendedEntityType,
        hasEmployees: afterOnboarding.registrationProfile?.nisEmployerStatus === 'NOT_STARTED',
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
}
