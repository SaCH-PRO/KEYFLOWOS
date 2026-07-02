import { apiGet, apiPost } from "@/lib/api";

export interface IngestionAttachment {
  externalId?: string | null;
  name: string;
  mimeType: string;
  url?: string | null;
  sizeBytes?: number | null;
}

export interface IngestionItem {
  id: string;
  businessId: string;
  sourceType: string;
  sourceConnectorType: string;
  externalId?: string | null;
  contactId?: string | null;
  status: string;
  rawPayload: Record<string, unknown>;
  summary?: string | null;
  subject?: string | null;
  body?: string | null;
  toDestination?: string | null;
  receivedAt?: string | null;
  attachments: IngestionAttachment[];
  fromName?: string | null;
  fromEmail?: string | null;
  fromPhone?: string | null;
  fromExternalId?: string | null;
  intentType?: string | null;
  confidence?: number | null;
  extractedData: Record<string, unknown>;
  proposedActions: Record<string, unknown>[];
  userFeedback: Record<string, unknown> | null;
  executedResults: Record<string, unknown> | null;
  errorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface IngestionItemFilters {
  status?: string;
  sourceType?: string;
  intentType?: string;
  search?: string;
  sortBy?: "createdAt" | "updatedAt" | "confidence";
  sortOrder?: "asc" | "desc";
  cursor?: string;
  limit?: number;
}

export interface IngestionItemListResponse {
  items: IngestionItem[];
  nextCursor: string | null;
  hasMore: boolean;
}

function buildQueryString(filters?: IngestionItemFilters): string {
  const params = new URLSearchParams();
  if (!filters) return "";
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null && value !== "") {
      params.set(key, String(value));
    }
  }
  return params.toString() ? `?${params.toString()}` : "";
}

export async function fetchIngestionItems(
  businessId: string,
  filters?: IngestionItemFilters,
): Promise<{ data: IngestionItemListResponse | null; error: string | null }> {
  return apiGet<IngestionItemListResponse>(
    `/data-inbox/businesses/${encodeURIComponent(businessId)}/items${buildQueryString(filters)}`,
  );
}

export async function fetchIngestionItem(
  businessId: string,
  itemId: string,
): Promise<{ data: IngestionItem | null; error: string | null }> {
  return apiGet<IngestionItem>(
    `/data-inbox/businesses/${encodeURIComponent(businessId)}/items/${encodeURIComponent(itemId)}`,
  );
}

export async function approveIngestionItem(
  businessId: string,
  itemId: string,
): Promise<{ data: IngestionItem | null; error: string | null }> {
  return apiPost<IngestionItem>({
    path: `/data-inbox/businesses/${encodeURIComponent(businessId)}/items/${encodeURIComponent(itemId)}/approve`,
    body: {},
  });
}

export async function rejectIngestionItem(
  businessId: string,
  itemId: string,
  reason?: string,
): Promise<{ data: IngestionItem | null; error: string | null }> {
  return apiPost<IngestionItem>({
    path: `/data-inbox/businesses/${encodeURIComponent(businessId)}/items/${encodeURIComponent(itemId)}/reject`,
    body: { reason },
  });
}

export async function correctIngestionItem(
  businessId: string,
  itemId: string,
  correctedActions: Record<string, unknown>[],
  note?: string,
): Promise<{ data: IngestionItem | null; error: string | null }> {
  return apiPost<IngestionItem>({
    path: `/data-inbox/businesses/${encodeURIComponent(businessId)}/items/${encodeURIComponent(itemId)}/correct`,
    body: { correctedActions, note },
  });
}
