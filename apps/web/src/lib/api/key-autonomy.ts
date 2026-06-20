import { apiGet, apiPost } from "@/lib/api";

export type KeyActionProposalStatus =
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "EXECUTING"
  | "EXECUTED"
  | "FAILED"
  | "BLOCKED"
  | "CANCELLED";

export type KeyActionRiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type KeyActionSourceType =
  | "EXECUTIVE_MODE"
  | "EXECUTIVE_BRIEF"
  | "TEMPORAL_FLOW"
  | "GENOME_EVOLUTION"
  | "MANUAL";

export type KeyExecutableActionType =
  | "OPEN_GENOME"
  | "OPEN_TEMPORAL_FLOW"
  | "OPEN_INTELLIGENCE"
  | "REVIEW_EVOLUTION_PROPOSALS"
  | "REVIEW_ASSETS"
  | "OPEN_CONSTITUTION"
  | "CREATE_TASK"
  | "CREATE_DOCUMENT"
  | "OPEN_KEY_INBOX"
  | "REQUEST_APPROVAL"
  | "GENERATE_CONSTITUTION_VERSION"
  | "GENERATE_DOCUMENT_EXPORT"
  | "CREATE_GENOME_EVOLUTION_PROPOSAL"
  | "SCHEDULE_FOLLOWUP"
  | "ESCALATE_THREAD";

export interface KeyActionProposal {
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

export interface GenomeActionPolicyDecision {
  allowed: boolean;
  requiresExtraConfirmation: boolean;
  module: string | null;
  readinessScore: number | null;
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | null;
  blockedReasons: string[];
  missingFacts: {
    section: string;
    domain: string;
    field: string;
    reason: string;
    impact: "BLOCKING" | "DEGRADED" | "OPTIONAL";
  }[];
  recommendedSetupActions: string[];
  message: string;
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
  status?: KeyActionProposalStatus;
  sourceType?: KeyActionSourceType;
  actionType?: KeyExecutableActionType;
}

export async function listKeyActionProposals(
  businessId: string,
  query: ListKeyActionProposalsQuery = {},
) {
  const params = new URLSearchParams();
  if (query.status) params.set("status", query.status);
  if (query.sourceType) params.set("sourceType", query.sourceType);
  if (query.actionType) params.set("actionType", query.actionType);
  const qs = params.toString();
  return apiGet<KeyActionProposal[]>(
    `/key-autonomy/businesses/${businessId}/actions/proposals${qs ? `?${qs}` : ""}`,
  );
}

export async function getKeyActionProposal(
  businessId: string,
  proposalId: string,
) {
  return apiGet<KeyActionProposal>(
    `/key-autonomy/businesses/${businessId}/actions/proposals/${proposalId}`,
  );
}

export async function createKeyActionProposal(
  businessId: string,
  input: CreateKeyActionProposalInput,
) {
  return apiPost<KeyActionProposal>({
    path: `/key-autonomy/businesses/${businessId}/actions/proposals`,
    body: input,
  });
}

export async function approveKeyActionProposal(
  businessId: string,
  proposalId: string,
) {
  return apiPost<KeyActionProposal>({
    path: `/key-autonomy/businesses/${businessId}/actions/proposals/${proposalId}/approve`,
    body: {},
  });
}

export async function rejectKeyActionProposal(
  businessId: string,
  proposalId: string,
  reason?: string,
) {
  return apiPost<KeyActionProposal>({
    path: `/key-autonomy/businesses/${businessId}/actions/proposals/${proposalId}/reject`,
    body: { reason },
  });
}

export async function cancelKeyActionProposal(
  businessId: string,
  proposalId: string,
) {
  return apiPost<KeyActionProposal>({
    path: `/key-autonomy/businesses/${businessId}/actions/proposals/${proposalId}/cancel`,
    body: {},
  });
}

export async function executeKeyActionProposal(
  businessId: string,
  proposalId: string,
  confirm?: boolean,
  confirmGenomeRisk?: boolean,
) {
  return apiPost<KeyActionProposal>({
    path: `/key-autonomy/businesses/${businessId}/actions/proposals/${proposalId}/execute`,
    body: { confirm, confirmGenomeRisk },
  });
}
