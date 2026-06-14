export type ConnectorType =
  | 'gmail'
  | 'google_calendar'
  | 'google_drive'
  | 'google_forms'
  | 'google_contacts'
  | 'outlook_contacts'
  | 'google_business_profile'
  | 'whatsapp'
  | 'meta_social'
  | 'paypal'
  | 'wipay'
  | 'stripe'
  | 'quickbooks'
  | 'xero'
  | 'mailchimp'
  | 'klaviyo'
  | 'linkedin'
  | 'tiktok'
  | 'twitter'
  | 'typeform'
  | 'jotform'
  | 'webhook_form'
  | 'shopify';

export type ConnectorCategory =
  | 'communication'
  | 'calendar'
  | 'storage'
  | 'payment'
  | 'social'
  | 'forms'
  | 'contacts'
  | 'profile'
  | 'messaging'
  | 'accounting'
  | 'email_marketing'
  | 'other';

export type ConnectorGroup = 'google' | 'social' | 'payments' | 'messaging' | 'accounting' | 'marketing' | 'forms' | 'other';

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
  /**
   * Connector-specific health details surfaced on the Connect hub card
   * (e.g. open calendar conflicts, oauth scope warnings).
   */
  metadata?: Record<string, unknown>;
}

export interface ConnectorStatusSummary {
  type: ConnectorType;
  name: string;
  category: ConnectorCategory;
  status: ConnectorStatus;
  connectedAccount: string | null;
}

/**
 * Single field in a connector's credential form (rendered by the connect dialog).
 * `secret: true` means the value is masked once stored and never returned in plaintext
 * to the client — the connector framework only ever returns a "•••• <last4>" preview.
 */
export interface ConnectorCredentialField {
  key: string;
  label: string;
  type: 'text' | 'password' | 'textarea';
  placeholder?: string;
  helpText?: string;
  required?: boolean;
  secret?: boolean;
}

/**
 * How the "Connect account" button behaves on the frontend.
 *  - `dialog`  → open the credential dialog and POST to the credentials endpoint
 *  - `oauth`   → open `oauthStartPath` in a new tab / redirect (real OAuth flow)
 *  - `webhook` → show the auto-generated per-business webhook URL
 *  - `external`→ open `externalUrl` in a new tab (rare)
 */
export type ConnectorConnectMode = 'dialog' | 'oauth' | 'webhook' | 'external';

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
  /**
   * UX hint for the frontend "Connect" button. Defaults to `oauth` for oauth2 + `dialog`
   * for api_key / credentials. Webhook-only connectors use `webhook`.
   */
  connectMode?: ConnectorConnectMode;
  /**
   * Schema for the connect-account credential dialog.
   * Empty / omitted means "no manual credentials needed" (e.g. OAuth-only).
   */
  credentialFields?: ConnectorCredentialField[];
  /**
   * For `connectMode: 'oauth'` connectors that delegate to another module's OAuth flow
   * (e.g. social platforms reuse `/social/.../oauth/start`).
   */
  oauthStartPath?: string;
  /**
   * Short user-facing instructions rendered above the credential form
   * ("Where do I get this?" copy).
   */
  connectInstructions?: string;
}

export interface ConnectorSyncResult {
  success: boolean;
  itemsSynced: number;
  errors: string[];
  duration: number;
}

export interface IngestionItemInput {
  sourceType: 'email' | 'whatsapp' | 'sms' | 'instagram' | 'messenger' | 'google_drive' | 'manual';
  sourceConnectorType?: string;
  externalId?: string;
  receivedAt?: Date;
  from: {
    id?: string;
    name?: string;
    email?: string;
    phone?: string;
  };
  to?: string;
  subject?: string;
  body?: string;
  rawPayload: Record<string, unknown>;
  attachments?: IngestionAttachment[];
}

export interface IngestionAttachment {
  externalId?: string;
  name: string;
  mimeType: string;
  url?: string;
  sizeBytes?: number;
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

  /**
   * Optional: perform a real round-trip "Try it live" call against the provider — heavier than
   * `testConnection` (e.g. send a self test email, create+delete a calendar event, hit a real
   * provider /me endpoint with the stored token). Returns a human-readable `action` describing
   * what was attempted plus an optional `detail` shown in the connector card.
   */
  smokeTest?(businessId: string): Promise<ConnectorSmokeResult>;

  getAuthUrl?(businessId: string): Promise<string>;

  /**
   * Poll the provider for new items and return normalized inputs.
   * Invoked by ConnectorIntelligenceService (5-minute poll) for polling connectors.
   */
  syncToIngestion?(businessId: string): Promise<IngestionItemInput[]>;

  /**
   * Parse a provider webhook payload into normalized inputs.
   * Invoked by webhook controllers after signature verification.
   */
  parseInbound?(
    payload: unknown,
    businessId: string,
  ): IngestionItemInput[] | Promise<IngestionItemInput[]>;

  /**
   * Verify a provider webhook signature. Return true if valid.
   * Called by webhook controllers before parseInbound.
   */
  verifyWebhook?(
    payload: unknown,
    signature: string | undefined,
    secret: string,
  ): boolean | Promise<boolean>;
}

export interface ConnectorSmokeResult {
  success: boolean;
  /** Short past-tense description of what was attempted (e.g. "Sent self test email"). */
  action?: string;
  /** Account / identity returned by the provider (email, page name, realm, …). */
  account?: string;
  /** Optional secondary detail line (e.g. "Created and deleted draft event '…'"). */
  detail?: string;
  error?: string;
}

export interface ConnectorEvent<T = Record<string, unknown>> {
  connectorType: ConnectorType;
  externalId: string | null;
  businessId: string;
  timestamp: Date;
  eventType: string;
  payload: T;
}
