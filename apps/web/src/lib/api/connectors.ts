import { apiGet, apiPost } from "@/lib/api";

export interface ConnectorStatusSummary {
  type: string;
  name: string;
  category: string;
  status: "connected" | "disconnected" | "error" | "expired" | "syncing";
  connectedAccount: string | null;
}

export interface ConnectorActivityLogEntry {
  id: string;
  businessId: string;
  connectorType: string;
  action: string;
  status: "success" | "failure" | "pending";
  message: string | null;
  itemsAffected: number | null;
  durationMs: number | null;
  metadata: unknown;
  createdAt: string;
}

export interface NeedsAttentionResponse {
  count: number;
  items: Array<{
    connectorType: string;
    status: string;
    lastError: string | null;
    lastErrorAt: string | null;
  }>;
}

export interface RunHealthCheckResponse {
  checked: number;
  alerts: number;
}

export async function fetchConnectorStatuses(businessId: string) {
  return apiGet<ConnectorStatusSummary[]>(`/connectors/businesses/${businessId}/statuses`);
}

export async function fetchConnectorActivity(businessId: string, limit = 20) {
  return apiGet<ConnectorActivityLogEntry[]>(
    `/connectors/businesses/${businessId}/activity?limit=${limit}`,
  );
}

export async function fetchNeedsAttention(businessId: string) {
  return apiGet<NeedsAttentionResponse>(`/connectors/businesses/${businessId}/needs-attention`);
}

export async function runHealthCheck(businessId: string) {
  return apiPost<RunHealthCheckResponse>({
    path: `/connectors/businesses/${businessId}/health-check/run`,
    body: {},
  });
}
