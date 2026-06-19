import { BadRequestException, Injectable } from '@nestjs/common';
import type {
  KeyActionRiskLevel,
  KeyExecutableActionType,
} from './key-action-proposal.types';

interface ActionPolicy {
  executable: boolean;
  requiresApproval: boolean;
  riskLevel: KeyActionRiskLevel;
}

const ACTION_POLICY: Record<KeyExecutableActionType, ActionPolicy> = {
  OPEN_GENOME: { executable: false, requiresApproval: false, riskLevel: 'LOW' },
  OPEN_TEMPORAL_FLOW: { executable: false, requiresApproval: false, riskLevel: 'LOW' },
  OPEN_INTELLIGENCE: { executable: false, requiresApproval: false, riskLevel: 'LOW' },
  REVIEW_EVOLUTION_PROPOSALS: { executable: false, requiresApproval: false, riskLevel: 'LOW' },
  REVIEW_ASSETS: { executable: false, requiresApproval: false, riskLevel: 'LOW' },
  OPEN_CONSTITUTION: { executable: false, requiresApproval: false, riskLevel: 'LOW' },
  OPEN_KEY_INBOX: { executable: false, requiresApproval: false, riskLevel: 'LOW' },
  CREATE_DOCUMENT: { executable: false, requiresApproval: false, riskLevel: 'LOW' },
  REQUEST_APPROVAL: { executable: false, requiresApproval: true, riskLevel: 'LOW' },

  CREATE_TASK: { executable: true, requiresApproval: true, riskLevel: 'LOW' },
  GENERATE_DOCUMENT_EXPORT: { executable: true, requiresApproval: true, riskLevel: 'LOW' },
  CREATE_GENOME_EVOLUTION_PROPOSAL: { executable: true, requiresApproval: true, riskLevel: 'MEDIUM' },
  GENERATE_CONSTITUTION_VERSION: { executable: true, requiresApproval: true, riskLevel: 'MEDIUM' },

  SCHEDULE_FOLLOWUP: { executable: true, requiresApproval: true, riskLevel: 'MEDIUM' },
  ESCALATE_THREAD: { executable: true, requiresApproval: true, riskLevel: 'MEDIUM' },
};

@Injectable()
export class KeyActionPolicyService {
  getPolicy(actionType: KeyExecutableActionType): ActionPolicy {
    const policy = ACTION_POLICY[actionType];
    if (!policy) {
      throw new BadRequestException(`Unsupported action type: ${actionType}`);
    }
    return policy;
  }

  isExecutable(actionType: KeyExecutableActionType): boolean {
    return this.getPolicy(actionType).executable;
  }

  requiresApproval(actionType: KeyExecutableActionType): boolean {
    return this.getPolicy(actionType).requiresApproval;
  }

  riskLevel(actionType: KeyExecutableActionType): KeyActionRiskLevel {
    return this.getPolicy(actionType).riskLevel;
  }
}
