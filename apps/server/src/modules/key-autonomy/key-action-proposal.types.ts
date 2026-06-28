export const KEY_ACTION_PROPOSAL_STATUSES: KeyActionProposalStatus[] = [
  'PENDING',
  'APPROVED',
  'REJECTED',
  'EXECUTING',
  'EXECUTED',
  'FAILED',
  'BLOCKED',
  'CANCELLED',
];

export type KeyActionProposalStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'EXECUTING'
  | 'EXECUTED'
  | 'FAILED'
  | 'BLOCKED'
  | 'CANCELLED';

export const KEY_ACTION_RISK_LEVELS: KeyActionRiskLevel[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

export type KeyActionRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export const KEY_ACTION_SOURCE_TYPES: KeyActionSourceType[] = [
  'EXECUTIVE_MODE',
  'EXECUTIVE_BRIEF',
  'TEMPORAL_FLOW',
  'GENOME_EVOLUTION',
  'AI_PLAN',
  'KEY_CORTEX',
  'MANUAL',
  'AI_LEGACY',
  'HUMAN_WORKFLOW',
  'PLAN_STEP',
  'AUTONOMY_REVIEW',
];

export type KeyActionSourceType =
  | 'EXECUTIVE_MODE'
  | 'EXECUTIVE_BRIEF'
  | 'TEMPORAL_FLOW'
  | 'GENOME_EVOLUTION'
  | 'AI_PLAN'
  | 'KEY_CORTEX'
  | 'MANUAL'
  | 'AI_LEGACY'
  | 'HUMAN_WORKFLOW'
  | 'PLAN_STEP'
  | 'AUTONOMY_REVIEW';

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
  'EXECUTE_TOOL',
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
  | 'ESCALATE_THREAD'
  | 'EXECUTE_TOOL';

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

  // Phase 0 unified governance fields
  toolName?: string | null;
  module?: string | null;
  description?: string | null;
  expectedBenefit?: string | null;
  risks?: string | null;
  inputPayload?: Record<string, unknown> | null;
  affectedEntities?: Record<string, unknown> | null;
  resolvedByUserId?: string | null;
  resolution?: Record<string, unknown> | null;
  multiStepParentId?: string | null;

  // Identity thread
  planId?: string | null;
  planStepId?: string | null;
  correlationId?: string | null;
  commandId?: string | null;
  sessionId?: string | null;
  businessEventId?: string | null;

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

  // Phase 0 unified governance fields
  toolName?: string;
  module?: string;
  description?: string;
  expectedBenefit?: string;
  risks?: string;
  inputPayload?: Record<string, unknown>;
  affectedEntities?: Record<string, unknown>;
  resolvedByUserId?: string;
  resolution?: Record<string, unknown>;
  multiStepParentId?: string;

  // Identity thread
  planId?: string;
  planStepId?: string;
  correlationId?: string;
  commandId?: string;
  sessionId?: string;
  businessEventId?: string;
}

export interface ListKeyActionProposalsQuery {
  status?: string;
  sourceType?: string;
  actionType?: string;
}
