import { Injectable } from '@nestjs/common';
import { GenomeModuleReadinessService } from '../business-genome/key-genome/genome-module-readiness.service';
import type { KeyGenomeModuleName } from '../business-genome/key-genome/key-genome.ontology';
import type { ModuleReadinessData } from '../business-genome/key-genome/key-genome.types';
import type { KeyActionProposalData, KeyExecutableActionType } from './key-action-proposal.types';

export interface GenomeActionPolicyDecision {
  allowed: boolean;
  requiresExtraConfirmation: boolean;
  module: string | null;
  readinessScore: number | null;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | null;
  automationAllowed: boolean | null;
  blockedReasons: string[];
  missingFacts: Array<{
    section: string;
    domain: string;
    field: string;
    reason: string;
    impact: 'BLOCKING' | 'DEGRADED' | 'OPTIONAL';
  }>;
  recommendedSetupActions: string[];
  message: string;
}

const ACTION_MODULE_MAP: Partial<Record<KeyExecutableActionType, KeyGenomeModuleName>> = {
  CREATE_TASK: 'sop',
  CREATE_GENOME_EVOLUTION_PROPOSAL: 'command_center',
  GENERATE_CONSTITUTION_VERSION: 'command_center',
  GENERATE_DOCUMENT_EXPORT: 'documents',
  SCHEDULE_FOLLOWUP: 'key_inbox',
  ESCALATE_THREAD: 'key_inbox',
};

@Injectable()
export class KeyActionGenomePolicyService {
  constructor(private readonly genomeReadiness: GenomeModuleReadinessService) {}

  async evaluateExecution(
    businessId: string,
    proposal: Pick<KeyActionProposalData, 'actionType'>,
  ): Promise<GenomeActionPolicyDecision> {
    const module = ACTION_MODULE_MAP[proposal.actionType];

    if (!module) {
      return {
        allowed: true,
        requiresExtraConfirmation: false,
        module: null,
        readinessScore: null,
        riskLevel: null,
        automationAllowed: null,
        blockedReasons: [],
        missingFacts: [],
        recommendedSetupActions: [],
        message: 'No KEY Genome module gate applies to this action.',
      };
    }

    const readiness = await this.genomeReadiness.getReadiness(businessId, module);

    if (!readiness || Array.isArray(readiness)) {
      return this.blocked(
        module,
        'KEY Genome readiness has not been computed for this module.',
        undefined,
        ['Run KEY Genome backfill and module readiness computation.'],
      );
    }

    if (!readiness.automationAllowed) {
      return this.blocked(
        module,
        `KEY cannot execute this action because ${module} automation is blocked by missing Genome facts.`,
        readiness,
      );
    }

    if (readiness.riskLevel === 'CRITICAL') {
      return this.blocked(
        module,
        `KEY cannot execute this action because ${module} readiness risk is critical.`,
        readiness,
      );
    }

    if (readiness.readinessScore < 50) {
      return this.blocked(
        module,
        `KEY cannot execute this action because ${module} readiness is only ${readiness.readinessScore}%.`,
        readiness,
      );
    }

    const requiresExtraConfirmation = readiness.readinessScore < 70 || readiness.riskLevel === 'HIGH';

    return {
      allowed: true,
      requiresExtraConfirmation,
      module,
      readinessScore: readiness.readinessScore,
      riskLevel: readiness.riskLevel,
      automationAllowed: readiness.automationAllowed,
      blockedReasons: readiness.blockedReasons,
      missingFacts: readiness.missingFacts,
      recommendedSetupActions: readiness.recommendedSetupActions,
      message: requiresExtraConfirmation
        ? `KEY can execute this action, but ${module} readiness is only ${readiness.readinessScore}% and requires confirmation.`
        : `KEY Genome readiness permits this action.`,
    };
  }

  private blocked(
    module: string,
    message: string,
    readiness?: ModuleReadinessData,
    recommendedSetupActions?: string[],
  ): GenomeActionPolicyDecision {
    return {
      allowed: false,
      requiresExtraConfirmation: false,
      module,
      readinessScore: readiness?.readinessScore ?? null,
      riskLevel: readiness?.riskLevel ?? null,
      automationAllowed: readiness?.automationAllowed ?? null,
      blockedReasons: readiness?.blockedReasons ?? [],
      missingFacts: readiness?.missingFacts ?? [],
      recommendedSetupActions: recommendedSetupActions ?? readiness?.recommendedSetupActions ?? [],
      message,
    };
  }
}
