import { BadRequestException, Injectable, NotFoundException, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { GenomeRecommendationService } from '../business-genome/key-genome/genome-recommendation.service';
import { GenomeExperimentService } from '../business-genome/key-genome/genome-experiment.service';
import { GenomeModuleReadinessService } from '../business-genome/key-genome/genome-module-readiness.service';
import type { KeyGenomeModuleName } from '../business-genome/key-genome/key-genome.ontology';
import { KeyActionProposalService } from './key-action-proposal.service';
import { KeyActionPolicyService } from './key-action-policy.service';
import type {
  BridgeGenomeRecommendationInput,
  BridgeGenomeRecommendationResult,
  GenomeRecommendationActionKind,
  GenomeRecommendationActionPreview,
  GenomeRecommendationData,
  RiskLevel,
} from '../business-genome/key-genome/key-genome.types';
import type { KeyExecutableActionType } from './key-action-proposal.types';

interface ActionPlanMapping {
  actionKind: GenomeRecommendationActionKind;
  proposedActionType?: KeyExecutableActionType;
  taskType?: string;
  targetModule?: string | null;
}

@Injectable()
export class GenomeRecommendationActionBridgeService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => GenomeRecommendationService))
    private readonly recommendations: GenomeRecommendationService,
    private readonly experiments: GenomeExperimentService,
    private readonly proposals: KeyActionProposalService,
    private readonly policy: KeyActionPolicyService,
    private readonly readiness: GenomeModuleReadinessService,
  ) {}

  async previewRecommendationAction(
    businessId: string,
    recommendationId: string,
  ): Promise<GenomeRecommendationActionPreview> {
    const recommendation = await this.recommendations.getRecommendation(businessId, recommendationId);

    if (!this.isBridgeableStatus(recommendation.status)) {
      throw new BadRequestException(
        `Recommendation must be ACTIVE or ACCEPTED to preview an action plan. Current status: ${recommendation.status}`,
      );
    }

    const mapping = this.resolveMapping(recommendation);
    const readinessWarning = await this.buildReadinessWarning(businessId, recommendation);

    return {
      recommendationId: recommendation.id,
      actionKind: mapping.actionKind,
      title: this.buildTitle(recommendation, mapping),
      summary: this.buildSummary(recommendation, mapping),
      rationale: this.buildRationale(recommendation, mapping),
      proposedActionType: mapping.proposedActionType,
      targetModule: mapping.targetModule,
      riskLevel: recommendation.riskLevel,
      requiresApproval: this.resolveRequiresApproval(mapping),
      readinessWarning,
      evidenceIds: recommendation.evidenceIds ?? [],
      payload: this.buildPayload(recommendation, mapping),
    };
  }

  async bridgeRecommendation(
    input: BridgeGenomeRecommendationInput,
  ): Promise<BridgeGenomeRecommendationResult> {
    const { businessId, recommendationId, actionKind: requestedKind, confirmBridge } = input;

    const recommendation = await this.recommendations.getRecommendation(businessId, recommendationId);

    if (recommendation.status === 'APPLIED') {
      const mapping = this.resolveMapping(recommendation);
      const existing = await this.findExistingBridgeOutput(businessId, recommendation, mapping);
      if (existing) {
        return {
          recommendationId: recommendation.id,
          actionKind: mapping.actionKind,
          createdEntityType: existing.createdEntityType,
          createdEntityId: existing.createdEntityId,
          status: 'ALREADY_EXISTS',
          message: 'Bridge output already exists for this applied recommendation.',
        };
      }
    }

    if (recommendation.status !== 'ACCEPTED') {
      throw new BadRequestException(
        `Recommendation must be ACCEPTED before bridging. Current status: ${recommendation.status}`,
      );
    }

    if (!confirmBridge) {
      throw new BadRequestException('Bridge requires explicit confirmation. Call preview first, then confirm.');
    }

    const preview = await this.previewRecommendationAction(businessId, recommendationId);
    const kind = requestedKind ?? preview.actionKind;

    if (kind === 'KEY_ACTION_PROPOSAL' || kind === 'GENOME_REVIEW' || kind === 'DOCUMENT_REQUEST' || kind === 'CONSTITUTION_UPDATE' || kind === 'MANUAL_TASK') {
      return this.bridgeToProposal(businessId, recommendation, preview, kind);
    }

    if (kind === 'EXPERIMENT') {
      return this.bridgeToExperiment(businessId, recommendation, preview);
    }

    throw new BadRequestException(`Unsupported bridge action kind: ${kind}`);
  }

  private async bridgeToProposal(
    businessId: string,
    recommendation: GenomeRecommendationData,
    preview: GenomeRecommendationActionPreview,
    kind: GenomeRecommendationActionKind,
  ): Promise<BridgeGenomeRecommendationResult> {
    const actionType = preview.proposedActionType ?? this.fallbackActionType(kind);

    const existing = await this.findExistingProposal(businessId, recommendation.id, actionType);
    if (existing) {
      await this.ensureRecommendationApplied(businessId, recommendation.id);
      return {
        recommendationId: recommendation.id,
        actionKind: kind,
        createdEntityType: 'key_action_proposal',
        createdEntityId: existing.id,
        status: 'ALREADY_EXISTS',
        message: 'An action proposal already exists for this recommendation.',
      };
    }

    const proposal = await this.proposals.create(businessId, {
      sourceType: 'GENOME_EVOLUTION',
      sourceId: recommendation.id,
      title: preview.title,
      summary: preview.summary,
      rationale: preview.rationale,
      evidence: [
        recommendation.insight,
        recommendation.diagnosis,
        recommendation.recommendation,
      ],
      actionType: actionType as KeyExecutableActionType,
      payload: {
        ...preview.payload,
        source: 'KEY_GENOME_RECOMMENDATION',
        recommendationId: recommendation.id,
        bridgeActionKind: kind,
      },
    });

    const applied = await this.recommendations.applyRecommendation(
      businessId,
      recommendation.id,
      undefined,
      'key_action_proposal',
      proposal.id,
    );

    return {
      recommendationId: applied.id,
      actionKind: kind,
      createdEntityType: 'key_action_proposal',
      createdEntityId: proposal.id,
      status: 'CREATED',
      message: 'Action proposal created from recommendation and marked as applied.',
    };
  }

  private async bridgeToExperiment(
    businessId: string,
    recommendation: GenomeRecommendationData,
    preview: GenomeRecommendationActionPreview,
  ): Promise<BridgeGenomeRecommendationResult> {
    if (recommendation.suggestedExperimentId) {
      await this.ensureRecommendationApplied(businessId, recommendation.id);
      return {
        recommendationId: recommendation.id,
        actionKind: 'EXPERIMENT',
        createdEntityType: 'genome_experiment',
        createdEntityId: recommendation.suggestedExperimentId,
        status: 'ALREADY_EXISTS',
        message: 'Experiment already exists for this recommendation.',
      };
    }

    const experiment = await this.experiments.createExperiment({
      businessId,
      hypothesis: preview.rationale,
      action: recommendation.recommendation,
      successMetric: 'Measure whether the recommendation improves the target business outcome.',
      baselineValue: null,
      targetValue: null,
      durationDays: 14,
      riskLevel: this.clampRiskLevel(recommendation.riskLevel, 'MEDIUM'),
    });

    await this.prisma.client.genomeRecommendation.update({
      where: { id: recommendation.id },
      data: { suggestedExperimentId: experiment.id },
    });

    const applied = await this.recommendations.applyRecommendation(
      businessId,
      recommendation.id,
      undefined,
      'genome_experiment',
      experiment.id,
    );

    return {
      recommendationId: applied.id,
      actionKind: 'EXPERIMENT',
      createdEntityType: 'genome_experiment',
      createdEntityId: experiment.id,
      status: 'CREATED',
      message: 'Experiment created from recommendation and marked as applied.',
    };
  }

  private resolveMapping(recommendation: GenomeRecommendationData): ActionPlanMapping {
    const source = this.detectSource(recommendation);

    if (source === 'READINESS_GAP') {
      return {
        actionKind: 'KEY_ACTION_PROPOSAL',
        proposedActionType: 'CREATE_TASK',
        taskType: 'COMPLETE_GENOME_FACT',
        targetModule: this.inferModuleFromTitle(recommendation.title),
      };
    }

    if (source === 'WEAK_SECTION') {
      return {
        actionKind: 'KEY_ACTION_PROPOSAL',
        proposedActionType: 'CREATE_TASK',
        taskType: 'STRENGTHEN_GENOME_SECTION',
        targetModule: recommendation.domain,
      };
    }

    if (source === 'SIGNAL') {
      const signalType = this.inferSignalType(recommendation.title);
      if (['CUSTOMER_PATTERN', 'REVENUE_PATTERN', 'MARKET_PATTERN'].includes(signalType)) {
        return {
          actionKind: 'EXPERIMENT',
          targetModule: recommendation.domain,
        };
      }

      if (['FACT_CONFLICT', 'READINESS_BLOCKER', 'RISK_PATTERN'].includes(signalType)) {
        return {
          actionKind: 'KEY_ACTION_PROPOSAL',
          proposedActionType: 'CREATE_TASK',
          taskType: 'REVIEW_GENOME_SIGNAL_RISK',
          targetModule: recommendation.domain,
        };
      }

      return {
        actionKind: 'KEY_ACTION_PROPOSAL',
        proposedActionType: 'CREATE_TASK',
        taskType: 'REVIEW_GENOME_SIGNAL',
        targetModule: recommendation.domain,
      };
    }

    if (this.isConstitutionRecommendation(recommendation)) {
      return {
        actionKind: 'KEY_ACTION_PROPOSAL',
        proposedActionType: 'GENERATE_CONSTITUTION_VERSION',
        targetModule: null,
      };
    }

    if (this.isDocumentRecommendation(recommendation)) {
      return {
        actionKind: 'KEY_ACTION_PROPOSAL',
        proposedActionType: 'GENERATE_DOCUMENT_EXPORT',
        targetModule: null,
      };
    }

    return {
      actionKind: 'KEY_ACTION_PROPOSAL',
      proposedActionType: 'CREATE_TASK',
      taskType: 'REVIEW_RECOMMENDATION',
      targetModule: recommendation.domain,
    };
  }

  private detectSource(recommendation: GenomeRecommendationData): string {
    if ((recommendation as any).source) {
      return (recommendation as any).source as string;
    }
    if (recommendation.title.toLowerCase().startsWith('provide ')) return 'READINESS_GAP';
    if (recommendation.title.toLowerCase().startsWith('strengthen ')) return 'WEAK_SECTION';
    return 'SIGNAL';
  }

  private inferSignalType(title: string): string {
    const lower = title.toLowerCase();
    if (lower.startsWith('fact conflict')) return 'FACT_CONFLICT';
    if (lower.startsWith('readiness blocker')) return 'READINESS_BLOCKER';
    if (lower.startsWith('risk pattern')) return 'RISK_PATTERN';
    if (lower.startsWith('customer pattern')) return 'CUSTOMER_PATTERN';
    if (lower.startsWith('revenue pattern')) return 'REVENUE_PATTERN';
    if (lower.startsWith('market pattern')) return 'MARKET_PATTERN';
    if (lower.startsWith('operations pattern')) return 'OPERATIONS_PATTERN';
    if (lower.startsWith('new fact')) return 'NEW_FACT';
    if (lower.startsWith('fact update')) return 'FACT_UPDATE';
    if (lower.startsWith('missing fact')) return 'MISSING_FACT';
    if (lower.startsWith('stale fact')) return 'STALE_FACT';
    if (lower.startsWith('low confidence fact')) return 'LOW_CONFIDENCE_FACT';
    return 'UNKNOWN';
  }

  private inferModuleFromTitle(title: string): string | null {
    const match = title.match(/(?:provide\s+\w+\s+fact:\s*)([a-z_]+)/i);
    if (match) {
      return match[1].toLowerCase();
    }
    return null;
  }

  private isConstitutionRecommendation(recommendation: GenomeRecommendationData): boolean {
    return recommendation.title.toLowerCase().includes('constitution');
  }

  private isDocumentRecommendation(recommendation: GenomeRecommendationData): boolean {
    return recommendation.title.toLowerCase().includes('document') || recommendation.title.toLowerCase().includes('export');
  }

  private buildTitle(recommendation: GenomeRecommendationData, mapping: ActionPlanMapping): string {
    if (mapping.actionKind === 'EXPERIMENT') {
      return `Experiment: ${recommendation.title}`;
    }
    if (mapping.proposedActionType === 'CREATE_TASK' && mapping.taskType) {
      return `${this.titleCase(mapping.taskType)}: ${recommendation.title}`;
    }
    return `Action plan: ${recommendation.title}`;
  }

  private buildSummary(recommendation: GenomeRecommendationData, mapping: ActionPlanMapping): string {
    if (mapping.actionKind === 'EXPERIMENT') {
      return `Validate the recommendation through a controlled 14-day experiment: ${recommendation.recommendation}`;
    }
    return `Controlled next step derived from KEY Genome recommendation: ${recommendation.recommendation}`;
  }

  private buildRationale(recommendation: GenomeRecommendationData, mapping: ActionPlanMapping): string {
    return `${recommendation.insight} ${recommendation.diagnosis}`.trim();
  }

  private buildPayload(recommendation: GenomeRecommendationData, mapping: ActionPlanMapping): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      source: 'KEY_GENOME_RECOMMENDATION',
      recommendationId: recommendation.id,
      domain: recommendation.domain,
      evidenceIds: recommendation.evidenceIds ?? [],
      bridgeActionKind: mapping.actionKind,
    };

    if (mapping.taskType) {
      payload.taskType = mapping.taskType;
    }

    if (mapping.targetModule) {
      payload.targetModule = mapping.targetModule;
    }

    if (mapping.actionKind === 'EXPERIMENT') {
      payload.durationDays = 14;
    }

    return payload;
  }

  private async buildReadinessWarning(
    businessId: string,
    recommendation: GenomeRecommendationData,
  ): Promise<string | null> {
    const module = this.mapDomainToModule(recommendation.domain);
    if (!module) return null;

    const readinessResult = await this.readiness.getReadiness(businessId, module);
    if (Array.isArray(readinessResult) || !readinessResult) {
      return `KEY has not yet computed readiness for the ${module} module. Run a Genome readiness scan before executing this recommendation.`;
    }

    const { readinessScore, automationAllowed, missingFacts, blockedReasons } = readinessResult;

    if (!automationAllowed) {
      const factList = missingFacts
        .filter((f) => f.impact === 'BLOCKING')
        .slice(0, 3)
        .map((f) => f.reason)
        .join('; ');
      return `Automation is blocked for ${module}. ${blockedReasons[0] ?? ''} ${factList ? `Missing facts: ${factList}.` : ''}`;
    }

    if (readinessScore < 70) {
      const factList = missingFacts
        .slice(0, 3)
        .map((f) => f.reason)
        .join('; ');
      return `${module} readiness is only ${readinessScore}%. ${factList ? `Consider gathering: ${factList}.` : 'More Genome evidence is recommended before executing.'}`;
    }

    return null;
  }

  private mapDomainToModule(domain?: string | null): KeyGenomeModuleName | null {
    if (!domain) return null;
    const d = domain.toLowerCase();
    if (d.includes('finance')) return 'finance';
    if (d.includes('customer') || d.includes('sales') || d.includes('crm') || d.includes('revenue')) return 'crm';
    if (d.includes('operations') || d.includes('delivery') || d.includes('sop')) return 'sop';
    if (d.includes('marketing') || d.includes('growth')) return 'marketing';
    if (d.includes('key_inbox') || d.includes('inbox')) return 'key_inbox';
    if (d.includes('commerce') || d.includes('invoice')) return 'commerce';
    if (d.includes('documents') || d.includes('document')) return 'documents';
    if (d.includes('command_center') || d.includes('command')) return 'command_center';
    return null;
  }

  private resolveRequiresApproval(mapping: ActionPlanMapping): boolean {
    if (mapping.actionKind === 'EXPERIMENT') return true;
    if (!mapping.proposedActionType) return true;
    return this.policy.requiresApproval(mapping.proposedActionType as KeyExecutableActionType);
  }

  private fallbackActionType(kind: GenomeRecommendationActionKind): KeyExecutableActionType {
    switch (kind) {
      case 'DOCUMENT_REQUEST':
        return 'GENERATE_DOCUMENT_EXPORT';
      case 'CONSTITUTION_UPDATE':
        return 'GENERATE_CONSTITUTION_VERSION';
      case 'GENOME_REVIEW':
        return 'REVIEW_EVOLUTION_PROPOSALS';
      case 'MANUAL_TASK':
      case 'KEY_ACTION_PROPOSAL':
      default:
        return 'CREATE_TASK';
    }
  }

  private async findExistingProposal(
    businessId: string,
    recommendationId: string,
    actionType: string,
  ): Promise<{ id: string } | null> {
    const rows = await this.prisma.client.keyActionProposal.findMany({
      where: {
        businessId,
        sourceType: 'GENOME_EVOLUTION',
        actionType,
      },
      select: { id: true, payload: true },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    const match = rows.find((row) => {
      const payload = (row.payload ?? {}) as Record<string, unknown>;
      return payload.source === 'KEY_GENOME_RECOMMENDATION' && payload.recommendationId === recommendationId;
    });

    return match ? { id: match.id } : null;
  }

  private async ensureRecommendationApplied(businessId: string, recommendationId: string): Promise<void> {
    const rec = await this.recommendations.getRecommendation(businessId, recommendationId);
    if (rec.status === 'ACCEPTED') {
      await this.recommendations.applyRecommendation(businessId, recommendationId);
    }
  }

  private isBridgeableStatus(status: string): boolean {
    return status === 'ACTIVE' || status === 'ACCEPTED';
  }

  private clampRiskLevel(recommendationRisk: RiskLevel, max: 'LOW' | 'MEDIUM' | 'HIGH'): RiskLevel {
    const order: RiskLevel[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
    const recIndex = order.indexOf(recommendationRisk);
    const maxIndex = order.indexOf(max);
    return order[Math.min(recIndex, maxIndex)];
  }

  private async findExistingBridgeOutput(
    businessId: string,
    recommendation: GenomeRecommendationData,
    mapping: ActionPlanMapping,
  ): Promise<{ createdEntityType: string; createdEntityId: string } | null> {
    if (mapping.actionKind === 'EXPERIMENT' && recommendation.suggestedExperimentId) {
      return {
        createdEntityType: 'genome_experiment',
        createdEntityId: recommendation.suggestedExperimentId,
      };
    }

    if (mapping.actionKind === 'KEY_ACTION_PROPOSAL' || mapping.proposedActionType) {
      const actionType = mapping.proposedActionType ?? this.fallbackActionType(mapping.actionKind);
      const proposal = await this.findExistingProposal(businessId, recommendation.id, actionType);
      if (proposal) {
        return {
          createdEntityType: 'key_action_proposal',
          createdEntityId: proposal.id,
        };
      }
    }

    return null;
  }

  private titleCase(value: string): string {
    return value
      .toLowerCase()
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }
}
