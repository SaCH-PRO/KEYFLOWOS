export const KEY_ACTION_PROPOSAL_STATUSES: KeyActionProposalStatus[] = [
  'PENDING',
  'APPROVED',
  'REJECTED',
  'EXECUTING',
  'EXECUTED',
  'FAILED',
  'CANCELLED',
];

export type KeyActionProposalStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'EXECUTING'
  | 'EXECUTED'
  | 'FAILED'
  | 'CANCELLED';

export const KEY_ACTION_RISK_LEVELS: KeyActionRiskLevel[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

export type KeyActionRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export const KEY_ACTION_SOURCE_TYPES: KeyActionSourceType[] = [
  'EXECUTIVE_MODE',
  'EXECUTIVE_BRIEF',
  'TEMPORAL_FLOW',
  'GENOME_EVOLUTION',
  'MANUAL',
];

export type KeyActionSourceType =
  | 'EXECUTIVE_MODE'
  | 'EXECUTIVE_BRIEF'
  | 'TEMPORAL_FLOW'
  | 'GENOME_EVOLUTION'
  | 'MANUAL';

export const KEY_EXECUTABLE_ACTION_TYPES: KeyExecutableActionType[] = [
  'OPEN_GENOME',
  'OPEN_TEMPORAL_FLOW',
  'OPEN_INTELLIGENCE',
  'REVIEW_EVOLUTION_PROPOSALS',
  'REVIEW_ASSETS',
  'OPEN_CONSTITUTION',
  'CREATE_TASK',
  'CREATE_DOCUMENT',
  'OPEN_KEY_INBOX',
  'REQUEST_APPROVAL',
  'GENERATE_CONSTITUTION_VERSION',
  'GENERATE_DOCUMENT_EXPORT',
  'CREATE_GENOME_EVOLUTION_PROPOSAL',
  'SCHEDULE_FOLLOWUP',
  'ESCALATE_THREAD',
];

export type KeyExecutableActionType =
  | 'OPEN_GENOME'
  | 'OPEN_TEMPORAL_FLOW'
  | 'OPEN_INTELLIGENCE'
  | 'REVIEW_EVOLUTION_PROPOSALS'
  | 'REVIEW_ASSETS'
  | 'OPEN_CONSTITUTION'
  | 'CREATE_TASK'
  | 'CREATE_DOCUMENT'
  | 'OPEN_KEY_INBOX'
  | 'REQUEST_APPROVAL'
  | 'GENERATE_CONSTITUTION_VERSION'
  | 'GENERATE_DOCUMENT_EXPORT'
  | 'CREATE_GENOME_EVOLUTION_PROPOSAL'
  | 'SCHEDULE_FOLLOWUP'
  | 'ESCALATE_THREAD';

export interface KeyActionProposalData {
  id: string;
  businessId: string;
  userId?: string | null;
  sourceType: KeyActionSourceType;
  sourceId?: string | null;
  sourceMode?: string | null;
  title: string;
  summary?: string | null;
  rationale?: string | null;
  evidence: string[];
  actionType: KeyExecutableActionType;
  payload: Record<string, unknown>;
  riskLevel: KeyActionRiskLevel;
  status: KeyActionProposalStatus;
  requiresApproval: boolean;
  approvedBy?: string | null;
  approvedAt?: string | null;
  rejectedBy?: string | null;
  rejectedAt?: string | null;
  rejectionReason?: string | null;
  executedBy?: string | null;
  executedAt?: string | null;
  executionResult?: Record<string, unknown> | null;
  failureReason?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateKeyActionProposalInput {
  sourceType: KeyActionSourceType;
  sourceId?: string;
  sourceMode?: string;
  title: string;
  summary?: string;
  rationale?: string;
  evidence?: string[];
  actionType: KeyExecutableActionType;
  payload?: Record<string, unknown>;
}

export interface ListKeyActionProposalsQuery {
  status?: string;
  sourceType?: string;
  actionType?: string;
}
