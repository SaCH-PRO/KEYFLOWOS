export type ConnectorType =
  | 'gmail'
  | 'google_calendar'
  | 'google_drive'
  | 'whatsapp'
  | 'meta_social'
  | 'paypal'
  | 'wipay'
  | 'stripe';

export type ConnectorCategory = 'communication' | 'calendar' | 'storage' | 'payment' | 'social';

export const CONNECTOR_STATUSES = ['connected', 'disconnected', 'error', 'expired', 'syncing'] as const;
export type ConnectorStatus = (typeof CONNECTOR_STATUSES)[number];

export function toConnectorStatus(raw: string): ConnectorStatus {
  if (CONNECTOR_STATUSES.includes(raw as ConnectorStatus)) {
    return raw as ConnectorStatus;
  }
  return 'disconnected';
}

export interface ConnectorHealth {
  status: ConnectorStatus;
  lastSyncAt: Date | null;
  lastErrorAt: Date | null;
  lastError: string | null;
  errorCount: number;
  syncCount: number;
  connectedAt: Date | null;
  connectedAccount: string | null;
}

export interface ConnectorStatusSummary {
  type: ConnectorType;
  name: string;
  category: ConnectorCategory;
  status: ConnectorStatus;
  connectedAccount: string | null;
}

export interface ConnectorMeta {
  type: ConnectorType;
  name: string;
  description: string;
  category: ConnectorCategory;
  icon: string;
  supportsSync: boolean;
  supportsWebhook: boolean;
  authType: 'oauth2' | 'api_key' | 'credentials' | 'none';
}

export interface ConnectorSyncResult {
  success: boolean;
  itemsSynced: number;
  errors: string[];
  duration: number;
}

export interface IConnector {
  readonly meta: ConnectorMeta;

  authenticate(businessId: string): Promise<{ connected: boolean; authUrl?: string }>;

  healthCheck(businessId: string): Promise<ConnectorHealth>;

  getStatus(businessId: string): Promise<ConnectorStatusSummary>;

  isConnected(businessId: string): Promise<boolean>;

  sync(businessId: string): Promise<ConnectorSyncResult>;

  disconnect(businessId: string): Promise<void>;

  getAuthUrl?(businessId: string): Promise<string>;
}

export interface ConnectorEvent<T = Record<string, unknown>> {
  connectorType: ConnectorType;
  externalId: string | null;
  businessId: string;
  timestamp: Date;
  eventType: string;
  payload: T;
}
