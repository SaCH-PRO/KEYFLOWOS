import { apiGet, apiPost } from "@/lib/api";

export interface AiApprovalItem {
  id: string;
  businessId: string;
  status: string;
  riskTier: number;
  toolName: string;
  module: string | null;
  title: string;
  description: string | null;
  rationale: string | null;
  expectedBenefit: string | null;
  risks: string | null;
  inputPayload: Record<string, unknown>;
  affectedEntities: Array<Record<string, unknown>>;
  planId: string | null;
  planStepId: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolution: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AiApprovalStats {
  pending: number;
  approvedToday: number;
  rejectedToday: number;
  escalated: number;
  byModule: Array<{ module: string; count: number }>;
}

export interface AiApprovalListResponse {
  items: AiApprovalItem[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface AiApprovalFilters {
  status?: "pending" | "approved" | "rejected" | "escalated" | "deferred";
  module?: string;
  search?: string;
  cursor?: string;
  limit?: number;
}

function buildQueryString(filters?: AiApprovalFilters): string {
  const params = new URLSearchParams();
  if (!filters) return "";
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null && value !== "") {
      params.set(key, String(value));
    }
  }
  return params.toString() ? `?${params.toString()}` : "";
}

export async function fetchAiApprovals(
  businessId: string,
  filters?: AiApprovalFilters,
): Promise<{ data: AiApprovalListResponse | null; error: string | null }> {
  return apiGet<AiApprovalListResponse>(
    `/ai-approvals/businesses/${encodeURIComponent(businessId)}/items${buildQueryString(filters)}`,
  );
}

export async function fetchAiApproval(
  businessId: string,
  itemId: string,
): Promise<{ data: AiApprovalItem | null; error: string | null }> {
  return apiGet<AiApprovalItem>(
    `/ai-approvals/businesses/${encodeURIComponent(businessId)}/items/${encodeURIComponent(itemId)}`,
  );
}

export async function resolveAiApproval(
  businessId: string,
  itemId: string,
  resolution: "approved" | "rejected" | "deferred",
): Promise<{ data: AiApprovalItem | null; error: string | null }> {
  return apiPost<AiApprovalItem>({
    path: `/ai-approvals/businesses/${encodeURIComponent(businessId)}/items/${encodeURIComponent(itemId)}/resolve`,
    body: { resolution },
  });
}

export async function bulkResolveAiApprovals(
  businessId: string,
  ids: string[],
  resolution: "approved" | "rejected" | "deferred",
): Promise<{ data: { succeeded: number; failed: number; total: number } | null; error: string | null }> {
  return apiPost<{ succeeded: number; failed: number; total: number }>({
    path: `/ai-approvals/businesses/${encodeURIComponent(businessId)}/items/bulk-resolve`,
    body: { ids, resolution },
  });
}

export async function fetchAiApprovalStats(
  businessId: string,
): Promise<{ data: AiApprovalStats | null; error: string | null }> {
  return apiGet<AiApprovalStats>(`/ai-approvals/businesses/${encodeURIComponent(businessId)}/stats`);
}
