export type ConnectorType =
  | 'gmail'
  | 'google_calendar'
  | 'google_drive'
  | 'google_forms'
  | 'google_contacts'
  | 'google_business_profile'
  | 'google_maps'
  | 'whatsapp'
  | 'meta_social'
  | 'paypal'
  | 'wipay'
  | 'stripe';

export type ConnectorCategory =
  | 'communication'
  | 'calendar'
  | 'storage'
  | 'payment'
  | 'social'
  | 'forms'
  | 'contacts'
  | 'profile'
  | 'maps'
  | 'messaging'
  | 'other';

export type ConnectorGroup = 'google' | 'social' | 'payments' | 'messaging' | 'other';

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
  /**
   * Top-level grouping in KeyFlow Connect hub (Google, Social, Payments, Messaging, Other).
   */
  group?: ConnectorGroup;
  icon: string;
  supportsSync: boolean;
  supportsWebhook: boolean;
  authType: 'oauth2' | 'api_key' | 'credentials' | 'none';
  /**
   * OAuth scopes (for oauth2 connectors) used to display what permissions were granted
   * and to compute the union for unified Google sign-in.
   */
  scopes?: string[];
  /**
   * Deep-link URL pattern to open this service in its native Google UI.
   */
  externalUrl?: string;
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

  /**
   * Optional: perform a real, cheap round-trip API call to verify the connection works.
   */
  testConnection?(businessId: string): Promise<{ success: boolean; error?: string; account?: string }>;

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
