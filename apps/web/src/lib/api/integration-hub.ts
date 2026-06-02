import { apiGet, apiPost, apiDelete } from "@/lib/api";

export interface IntegrationProvider {
  id: string;
  key: string;
  name: string;
  category: string;
  description: string | null;
  logoUrl: string | null;
  authType: string;
  capabilities: string[];
  scopes: string[];
  status: string;
}

export interface IntegrationConnection {
  id: string;
  businessId: string;
  providerKey: string;
  status: string;
  scopes: string[];
  settings: Record<string, unknown>;
  lastSyncAt: string | null;
  lastError: string | null;
  createdAt: string;
}

export interface IntegrationSyncRun {
  id: string;
  businessId: string;
  connectionId: string;
  providerKey: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  recordsRead: number;
  recordsCreated: number;
  recordsUpdated: number;
  error: string | null;
}

export interface IntegrationDashboard {
  entries: Array<{ provider: IntegrationProvider; connection: IntegrationConnection | null }>;
  stats: { total: number; connected: number; needsAttention: number; disconnected: number };
  recentSyncs: IntegrationSyncRun[];
}

export async function fetchIntegrationProviders(category?: string) {
  const qs = category ? `?category=${encodeURIComponent(category)}` : "";
  return apiGet<IntegrationProvider[]>(`/integration-hub/businesses/me/providers${qs}`);
}

export async function fetchIntegrationDashboard(businessId: string) {
  return apiGet<IntegrationDashboard>(
    `/integration-hub/businesses/${encodeURIComponent(businessId)}/dashboard`,
  );
}

export async function createIntegrationConnection(
  businessId: string,
  providerKey: string,
  data: { authDataRef?: string; scopes?: string[]; settings?: Record<string, unknown> },
) {
  return apiPost<IntegrationConnection>({
    path: `/integration-hub/businesses/${encodeURIComponent(businessId)}/connections/${encodeURIComponent(providerKey)}`,
    body: data,
  });
}

export async function disconnectIntegration(businessId: string, providerKey: string) {
  return apiDelete<IntegrationConnection>(
    `/integration-hub/businesses/${encodeURIComponent(businessId)}/connections/${encodeURIComponent(providerKey)}`,
  );
}

export async function fetchIntegrationSyncRuns(
  businessId: string,
  providerKey?: string,
  limit?: number,
) {
  const params = new URLSearchParams();
  if (providerKey) params.append("providerKey", providerKey);
  if (limit) params.append("limit", String(limit));
  const qs = params.toString() ? `?${params.toString()}` : "";
  return apiGet<IntegrationSyncRun[]>(
    `/integration-hub/businesses/${encodeURIComponent(businessId)}/sync-runs${qs}`,
  );
}
