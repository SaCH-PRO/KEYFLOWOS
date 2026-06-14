import { apiGet, apiPost } from "@/lib/api";

export interface ProposedAction {
  id: string;
  type: string;
  title: string;
  description?: string;
  payload: Record<string, unknown>;
}

export interface IngestionItem {
  id: string;
  sourceType: string;
  sourceConnectorType: string;
  status: string;
  summary?: string | null;
  intentType?: string | null;
  confidence?: number | null;
  fromName?: string | null;
  fromEmail?: string | null;
  fromPhone?: string | null;
  subject?: string | null;
  createdAt: string;
  proposedActionsCount: number;
}

export interface IngestionItemDetail extends IngestionItem {
  body?: string | null;
  rawPayload: Record<string, unknown>;
  extractedData?: Record<string, unknown> | null;
  proposedActions?: ProposedAction[];
  executedResults?: Record<string, unknown> | null;
  userFeedback?: Record<string, unknown> | null;
  errorMessage?: string | null;
  riskTier?: number | null;
  contact?: {
    id: string;
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
    phone?: string | null;
  } | null;
}

export interface IngestionItemListResponse {
  items: IngestionItem[];
  nextCursor: string | null;
  hasMore: boolean;
}

export async function fetchIngestionItems(
  businessId: string,
  opts?: {
    status?: string;
    sourceType?: string;
    search?: string;
    intentType?: string;
    sortBy?: string;
    sortOrder?: string;
    cursor?: string;
    limit?: number;
  },
): Promise<{ data: IngestionItemListResponse | null; error: string | null }> {
  const params = new URLSearchParams();
  if (opts?.status) params.set("status", opts.status);
  if (opts?.sourceType) params.set("sourceType", opts.sourceType);
  if (opts?.search) params.set("search", opts.search);
  if (opts?.intentType) params.set("intentType", opts.intentType);
  if (opts?.sortBy) params.set("sortBy", opts.sortBy);
  if (opts?.sortOrder) params.set("sortOrder", opts.sortOrder);
  if (opts?.cursor) params.set("cursor", opts.cursor);
  if (opts?.limit) params.set("limit", String(opts.limit));
  const qs = params.toString() ? `?${params.toString()}` : "";
  return apiGet<IngestionItemListResponse>(`/key-inbox/businesses/${encodeURIComponent(businessId)}/items${qs}`);
}

export async function fetchIngestionItem(
  businessId: string,
  itemId: string,
): Promise<{ data: IngestionItemDetail | null; error: string | null }> {
  return apiGet<IngestionItemDetail>(
    `/key-inbox/businesses/${encodeURIComponent(businessId)}/items/${encodeURIComponent(itemId)}`,
  );
}

export async function approveIngestionItem(businessId: string, itemId: string) {
  return apiPost<{ id: string; status: string }>({
    path: `/key-inbox/businesses/${encodeURIComponent(businessId)}/items/${encodeURIComponent(itemId)}/approve`,
    body: {},
  });
}

export async function rejectIngestionItem(businessId: string, itemId: string, reason?: string) {
  return apiPost<{ id: string; status: string }>({
    path: `/key-inbox/businesses/${encodeURIComponent(businessId)}/items/${encodeURIComponent(itemId)}/reject`,
    body: { reason },
  });
}

export async function correctIngestionItem(
  businessId: string,
  itemId: string,
  correctedActions: ProposedAction[],
  note?: string,
) {
  return apiPost<{ id: string; status: string }>({
    path: `/key-inbox/businesses/${encodeURIComponent(businessId)}/items/${encodeURIComponent(itemId)}/correct`,
    body: { correctedActions, note },
  });
}
