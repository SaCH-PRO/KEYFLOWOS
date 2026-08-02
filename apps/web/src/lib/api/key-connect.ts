import { apiGet, apiPost, apiPatch } from "@/lib/api";

export interface ConnectorStatusSummary {
  type: string;
  name: string;
  category: string;
  status: "connected" | "disconnected" | "error" | "expired" | "syncing";
  connectedAccount: string | null;
}

export interface ConnectorInboxConfig {
  intakeEnabled: boolean;
  autoApproveThreshold: number | null;
  createContactsAutomatically: boolean;
}

export interface ConnectorAuthResponse {
  connected: boolean;
  authUrl?: string;
}

export async function fetchConnectorStatuses(businessId: string) {
  return apiGet<ConnectorStatusSummary[]>(
    `/connectors/businesses/${encodeURIComponent(businessId)}/statuses`,
  );
}

export async function authenticateConnector(businessId: string, type: string) {
  return apiPost<ConnectorAuthResponse>({
    path: `/connectors/businesses/${encodeURIComponent(businessId)}/authenticate/${encodeURIComponent(type)}`,
    body: {},
  });
}

export async function disconnectConnector(businessId: string, type: string) {
  return apiPost<{ success: boolean }>({
    path: `/connectors/businesses/${encodeURIComponent(businessId)}/disconnect/${encodeURIComponent(type)}`,
    body: {},
  });
}

/**
 * Trigger a provider sync.
 *
 * The server answers HTTP 200 even when the connector has no pull-sync
 * implementation — correctly, since the REQUEST succeeded; it is the operation
 * that did not. The result body is the authority:
 *
 *   success: false, unsupported: true  -> nothing was fetched
 *
 * Callers must branch on `data.success`, never on `error`. Branching on `error`
 * treats "the server told me it did nothing" as "it worked".
 */
export async function syncConnector(businessId: string, type: string) {
  return apiPost<{
    success: boolean;
    itemsSynced?: number;
    /** Set when this connector has no provider-pull implementation. */
    unsupported?: boolean;
    code?: string;
    errors?: string[];
  }>({
    path: `/connectors/businesses/${encodeURIComponent(businessId)}/sync/${encodeURIComponent(type)}`,
    body: {},
  });
}

export async function testConnector(businessId: string, type: string) {
  return apiPost<{ success: boolean; error?: string; account?: string }>({
    path: `/connectors/businesses/${encodeURIComponent(businessId)}/test/${encodeURIComponent(type)}`,
    body: {},
  });
}

export async function fetchConnectorInboxConfig(businessId: string, type: string) {
  return apiGet<ConnectorInboxConfig>(
    `/connectors/businesses/${encodeURIComponent(businessId)}/inbox-config/${encodeURIComponent(type)}`,
  );
}

export async function updateConnectorInboxConfig(
  businessId: string,
  type: string,
  config: Partial<ConnectorInboxConfig>,
) {
  return apiPatch<ConnectorInboxConfig>(
    `/connectors/businesses/${encodeURIComponent(businessId)}/inbox-config/${encodeURIComponent(type)}`,
    config,
  );
}

export async function fetchDriveAuthUrl(businessId: string) {
  return apiGet<{ url: string }>(
    `/drive/businesses/${encodeURIComponent(businessId)}/auth-url`,
  );
}

export async function syncGoogleDrive(businessId: string) {
  return apiPost<{ success: boolean; scanned?: number; newFiles?: number }>({
    path: `/drive/businesses/${encodeURIComponent(businessId)}/sync`,
    body: {},
  });
}
