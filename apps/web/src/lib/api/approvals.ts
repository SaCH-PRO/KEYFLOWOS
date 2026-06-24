import { apiGet as apiGetSimple, apiPostSimple, apiDelete } from "../api";
import { DEFAULT_BUSINESS_ID } from "./_defaults";
import { getStoredBusinessId } from "../workspace";

export interface ApprovalRequest {
  id: string;
  businessId: string;
  requestType: string;
  requesterId: string;
  title: string;
  description?: string;
  payload?: Record<string, unknown> | null;
  status: string;
  threshold?: number | null;
  currentStep: number;
  createdAt: string;
  resolvedAt?: string | null;
  resolution?: string | null;
  steps?: ApprovalStep[];
}

export interface ApprovalStep {
  id: string;
  approvalRequestId: string;
  stepOrder: number;
  approverId: string;
  status: string;
  delegatedTo?: string | null;
  decidedAt?: string | null;
  decision?: string | null;
  comment?: string | null;
}

export async function fetchApprovalRequests(
  businessId: string,
  opts?: { status?: string; limit?: number; offset?: number }
) {
  const params = new URLSearchParams();
  if (opts?.status) params.set("status", opts.status);
  if (opts?.limit) params.set("limit", String(opts.limit));
  if (opts?.offset) params.set("offset", String(opts.offset));
  return apiGetSimple<{ items: ApprovalRequest[]; total: number; offset: number; limit: number }>(
    `/businesses/${encodeURIComponent(businessId)}/approvals?${params.toString()}`
  );
}

export async function fetchPendingApprovalsForMe(businessId: string) {
  return apiGetSimple<ApprovalRequest[]>(
    `/businesses/${encodeURIComponent(businessId)}/approvals/pending-for-me`
  );
}

export async function fetchApprovalRequest(businessId: string, approvalId: string) {
  return apiGetSimple<ApprovalRequest>(
    `/businesses/${encodeURIComponent(businessId)}/approvals/${encodeURIComponent(approvalId)}`
  );
}

export async function createApprovalRequest(
  businessId: string,
  data: {
    requestType: string;
    title: string;
    description?: string;
    payload?: Record<string, unknown>;
    threshold?: number;
    steps: { stepOrder: number; approverId: string }[];
  }
) {
  return apiPostSimple<ApprovalRequest>(
    `/businesses/${encodeURIComponent(businessId)}/approvals`,
    data
  );
}

export async function approveRequest(
  businessId: string,
  approvalId: string,
  comment?: string
) {
  return apiPostSimple<ApprovalRequest>(
    `/businesses/${encodeURIComponent(businessId)}/approvals/${encodeURIComponent(approvalId)}/approve`,
    { comment }
  );
}

export async function rejectRequest(
  businessId: string,
  approvalId: string,
  reason?: string
) {
  return apiPostSimple<ApprovalRequest>(
    `/businesses/${encodeURIComponent(businessId)}/approvals/${encodeURIComponent(approvalId)}/reject`,
    { reason }
  );
}

export async function delegateApproval(
  businessId: string,
  approvalId: string,
  delegateTo: string
) {
  return apiPostSimple<ApprovalRequest>(
    `/businesses/${encodeURIComponent(businessId)}/approvals/${encodeURIComponent(approvalId)}/delegate`,
    { delegateTo }
  );
}

export async function escalateApproval(businessId: string, approvalId: string) {
  return apiPostSimple<ApprovalRequest>(
    `/businesses/${encodeURIComponent(businessId)}/approvals/${encodeURIComponent(approvalId)}/escalate`,
    {}
  );
}

export async function deleteApprovalRequest(businessId: string, approvalId: string) {
  return apiDelete<ApprovalRequest>(
    `/businesses/${encodeURIComponent(businessId)}/approvals/${encodeURIComponent(approvalId)}`
  );
}

export async function cancelApprovalRequest(businessId: string, approvalId: string) {
  return apiDelete<ApprovalRequest>(
    `/businesses/${encodeURIComponent(businessId)}/approvals/${encodeURIComponent(approvalId)}/cancel`
  );
}

export async function approveApprovalRequest(id: string, _approverId: string) {
  const businessId = getStoredBusinessId() ?? DEFAULT_BUSINESS_ID;
  return approveRequest(businessId, id);
}

export async function rejectApprovalRequest(id: string, _approverId: string) {
  const businessId = getStoredBusinessId() ?? DEFAULT_BUSINESS_ID;
  return rejectRequest(businessId, id);
}

// ─── Assets ──────────────────────────────────────────────────────────────────

