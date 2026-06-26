/**
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║                   KEY EXTERNAL CONNECTOR FRAMEWORK                        ║
 * ║           Universal Plugin System for KeyFlowOS Integrations             ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * Core type definitions for the external connector ecosystem.
 * Supports 20+ pre-built services + custom user-defined connectors.
 *
 * @module key-cortex-external-connector
 * @version 1.0.0
 */

// ─────────────────────────────────────────────────────────────────────────────
// SUPPORTED EXTERNAL SERVICES
// ─────────────────────────────────────────────────────────────────────────────

/** All supported external service integrations */
export type ExternalService =
  // Communication
  | 'slack' | 'microsoft_teams' | 'discord' | 'twilio'
  // E-commerce
  | 'shopify'
  // CRM
  | 'salesforce' | 'hubspot'
  // Marketing
  | 'mailchimp' | 'convertkit' | 'aweber' | 'klaviyo'
  // Productivity
  | 'notion' | 'airtable' | 'trello' | 'asana' | 'monday' | 'google_sheets'
  // Payment
  | 'stripe'
  // Automation
  | 'zapier'
  // Email
  | 'sendgrid'
  // Custom
  | 'custom'; // User-defined connector

/** Service category classification */
export type ServiceCategory =
  | 'communication'
  | 'ecommerce'
  | 'crm'
  | 'marketing'
  | 'productivity'
  | 'payment'
  | 'automation'
  | 'custom';

/** Authentication mechanism used by the connector */
export type AuthType = 'oauth2' | 'api_key' | 'basic' | 'webhook' | 'bearer' | 'none';

/** HTTP methods supported for actions */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

/** Connector operational status */
export type ConnectorStatus = 'connected' | 'disconnected' | 'error' | 'pending';

/** Webhook registration status */
export type WebhookStatus = 'active' | 'inactive' | 'pending';

// ─────────────────────────────────────────────────────────────────────────────
// CONNECTOR DEFINITION (static metadata for each service)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Static definition of an external service connector.
 * Contains metadata, actions, triggers, and configuration schema.
 */
export interface ExternalConnectorDefinition {
  /** Unique service identifier */
  id: ExternalService;
  /** Human-readable service name */
  name: string;
  /** Short description of the service */
  description: string;
  /** Service category for grouping */
  category: ServiceCategory;
  /** Authentication mechanism required */
  authType: AuthType;
  /** URL to service logo icon */
  logoUrl?: string;
  /** Official service website */
  website: string;
  /** API documentation URL */
  docsUrl?: string;
  /** Base URL for API requests */
  baseUrl?: string;
  /** Available actions this connector can perform */
  actions: ExternalAction[];
  /** Available triggers (webhook events) */
  triggers: ExternalTrigger[];
  /** Configuration schema for connector setup */
  configSchema: ConfigField[];
  /** Rate limit configuration */
  rateLimit?: RateLimitConfig;
  /** Hardened rate-limit flag or detailed per-window config */
  rateLimitHardened?: boolean | {
    requestsPerSecond: number;
    requestsPerMinute: number;
    requestsPerHour: number;
    burstAllowance: number;
  };
  /** Required OAuth scopes */
  requiredScopes?: string[];
  /** Request timeout configuration */
  timeoutConfig?: { requestMs?: number; requestTimeoutMs?: number; connectTimeoutMs?: number; uploadTimeoutMs?: number };
  /** Retry configuration */
  retryConfig?: Partial<RetryConfig>;
  /** Webhook security settings */
  webhookSecurity?: any;
  /** Health check configuration */
  healthCheck?: { path?: string; intervalMs?: number; endpoint?: string; method?: string; expectedStatus?: number; expectedResponse?: Record<string, unknown> };
  /** Sandbox endpoint overrides */
  sandboxEndpoints?: Record<string, string>;
  /** Whether the connector supports OAuth2 */
  supportsOAuth: boolean;
  /** OAuth2 scopes required (if applicable) */
  oauthScopes?: string[];
  /** Custom headers required for all requests */
  defaultHeaders?: Record<string, string>;
}

/** Rate limit configuration */
export interface RateLimitConfig {
  /** Requests per time window */
  requestsPerWindow: number;
  /** Time window in seconds */
  windowSeconds: number;
  /** Burst allowance */
  burstLimit?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// EXTERNAL ACTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Defines a callable action on an external service.
 * Maps to an HTTP request template with parameterization.
 */
export interface ExternalAction {
  /** Unique action name (snake_case) */
  name: string;
  /** Human-readable action description */
  description: string;
  /** Internal endpoint reference / path template */
  endpoint: string;
  /** HTTP method */
  method: HttpMethod;
  /** Input parameters for the action */
  parameters: ActionParameter[];
  /** JSONPath or description of return value */
  returns: string;
  /** Category for grouping actions */
  category?: string;
  /** Whether this action requires a specific scope */
  requiredScope?: string;
  /** Example request body (for documentation) */
  examplePayload?: Record<string, unknown>;
}

/** Parameter definition for an action */
export interface ActionParameter {
  /** Parameter name */
  name: string;
  /** Parameter type */
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'file' | 'json' | 'textarea' | 'url';
  /** Human-readable label */
  label: string;
  /** Parameter description */
  description: string;
  /** Whether the parameter is required */
  required: boolean;
  /** Default value if not provided */
  defaultValue?: unknown;
  /** Validation pattern (regex) */
  pattern?: string;
  /** Available options for enum-like parameters */
  options?: Array<{ label: string; value: string | number | boolean }>;
  /** Whether this parameter goes in the query string */
  inQuery?: boolean;
  /** Whether this parameter goes in the request body */
  inBody?: boolean;
  /** Whether this parameter goes in the URL path */
  inPath?: boolean;
  /** Whether this parameter goes in headers */
  inHeader?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// EXTERNAL TRIGGER (WEBHOOK EVENTS)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Defines a webhook trigger that an external service can emit.
 */
export interface ExternalTrigger {
  /** Unique trigger name (snake_case) */
  name: string;
  /** Human-readable trigger description */
  description: string;
  /** External service event type identifier */
  eventType: string;
  /** Schema of the webhook payload (field name -> type) */
  payloadSchema: Record<string, string>;
  /** Whether this trigger is available in all plans */
  isPremium?: boolean;
  /** Example payload for documentation */
  examplePayload?: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURATION FIELD
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Schema field for connector configuration/credentials.
 * Used to render setup forms and validate user input.
 */
export interface ConfigField {
  /** Field name (key in config object) */
  name: string;
  /** Field type for rendering */
  type: 'string' | 'number' | 'boolean' | 'password' | 'url' | 'select' | 'multiselect' | 'textarea' | 'json';
  /** Human-readable label */
  label: string;
  /** Field description/help text */
  description: string;
  /** Whether the field is required */
  required: boolean;
  /** Placeholder text for input */
  placeholder?: string;
  /** Options for select/multiselect fields */
  options?: Array<{ label: string; value: string }>;
  /** Default value */
  defaultValue?: string | number | boolean;
  /** Whether the value should be encrypted at rest */
  secret?: boolean;
  /** Validation regex pattern */
  validationPattern?: string;
  /** Help tooltip content */
  tooltip?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONNECTOR INSTANCE (configured connection)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Represents a configured connection to an external service.
 * Stored per-business with encrypted credentials.
 */
export interface ExternalConnectorInstance {
  /** Unique instance ID (UUID) */
  id: string;
  /** Owning business ID */
  businessId: string;
  /** Reference to connector definition */
  definitionId: ExternalService;
  /** User-given name for this connection */
  name: string;
  /** Encrypted credentials/configuration */
  config: Record<string, string>;
  /** Current connection status */
  status: ConnectorStatus;
  /** Last successful usage timestamp */
  lastUsedAt?: Date;
  /** Creation timestamp */
  createdAt: Date;
  /** Last update timestamp */
  updatedAt?: Date;
  /** Arbitrary metadata */
  metadata?: Record<string, unknown>;
  /** Error message if status is 'error' */
  errorMessage?: string;
  /** Number of successful executions */
  executionCount?: number;
  /** Number of failed executions */
  failureCount?: number;
  /** OAuth2 token data (if applicable) */
  oauthToken?: OAuthTokenData;
}

/** OAuth2 token information */
export interface OAuthTokenData {
  accessToken: string;
  refreshToken?: string;
  expiresAt: Date;
  tokenType: string;
  scope?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// EXECUTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Request to execute an action on a configured connector.
 */
export interface ExternalExecutionRequest {
  /** Connector instance ID */
  connectorId: string;
  /** Action name to execute */
  action: string;
  /** Action parameters */
  parameters: Record<string, unknown>;
  /** Business ID for authorization */
  businessId: string;
  /** Request ID for tracing */
  requestId?: string;
  /** Timeout in milliseconds */
  timeoutMs?: number;
  /** Whether to queue for async execution */
  async?: boolean;
  /** Callback URL for async completion */
  callbackUrl?: string;
}

/**
 * Result of an action execution.
 */
export interface ExternalExecutionResult {
  /** Whether the execution succeeded */
  success: boolean;
  /** Response data from external service */
  data?: unknown;
  /** HTTP status code */
  statusCode?: number;
  /** Error information (if failed) */
  error?: ExecutionError;
  /** Execution duration in milliseconds */
  durationMs: number;
  /** Request ID for tracing */
  requestId: string;
  /** Timestamp of execution */
  executedAt: Date;
  /** Number of retry attempts made */
  retryCount?: number;
  /** Raw response headers */
  responseHeaders?: Record<string, string>;
}

/** Execution error details */
export interface ExecutionError {
  /** Error code */
  code: string;
  /** Human-readable error message */
  message: string;
  /** External service error code (if available) */
  externalCode?: string;
  /** External service error message */
  externalMessage?: string;
  /** Whether the error is retryable */
  retryable: boolean;
  /** Suggested retry delay in milliseconds */
  retryAfterMs?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// WEBHOOK REGISTRATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Represents a registered webhook with an external service.
 */
export interface WebhookRegistration {
  /** Unique webhook registration ID */
  id: string;
  /** Connector instance ID */
  connectorId: string;
  /** External service event type */
  eventType: string;
  /** Callback URL for webhook delivery */
  url: string;
  /** Secret for HMAC signature verification */
  secret: string;
  /** Registration status */
  status: WebhookStatus;
  /** Creation timestamp */
  createdAt: Date;
  /** Last delivery timestamp */
  lastDeliveredAt?: Date;
  /** Number of successful deliveries */
  deliveryCount?: number;
  /** Number of failed deliveries */
  failureCount?: number;
  /** Last error message */
  lastError?: string;
  /** Additional metadata from external service */
  externalWebhookId?: string;
  /** Webhook signature header name */
  signatureHeader?: string;
  /** Custom headers to include in responses */
  customHeaders?: Record<string, string>;
}

/** Incoming webhook payload structure */
export interface WebhookPayload {
  /** Webhook registration ID */
  webhookId: string;
  /** External service event type */
  eventType: string;
  /** Raw payload body */
  body: Record<string, unknown>;
  /** HTTP headers from delivery */
  headers: Record<string, string>;
  /** HMAC signature (if present) */
  signature?: string;
  /** Delivery timestamp */
  deliveredAt: Date;
  /** Delivery attempt number */
  attemptNumber?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// CUSTOM CONNECTOR
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A user-defined custom connector configuration.
 * Allows businesses to connect to any REST API.
 */
export interface CustomConnector {
  /** Unique custom connector ID */
  id: string;
  /** Owning business ID */
  businessId: string;
  /** Human-readable name */
  name: string;
  /** Description of the connector */
  description: string;
  /** Base URL for all requests */
  baseUrl: string;
  /** Authentication configuration */
  authConfig: CustomAuthConfig;
  /** Defined actions for this connector */
  actions: ExternalAction[];
  /** Default headers for all requests */
  headers: Record<string, string>;
  /** Creation timestamp */
  createdAt: Date;
  /** Last update timestamp */
  updatedAt?: Date;
  /** Request timeout in milliseconds */
  timeoutMs?: number;
  /** Retry configuration */
  retryConfig?: RetryConfig;
}

/** Authentication configuration for custom connectors */
export interface CustomAuthConfig {
  /** Authentication type */
  type: AuthType;
  /** Header name for auth (e.g., 'Authorization', 'X-API-Key') */
  headerName?: string;
  /** Header prefix (e.g., 'Bearer', 'Basic') */
  headerPrefix?: string;
  /** Credentials (encrypted at rest) */
  credentials: Record<string, string>;
  /** Token endpoint for OAuth2 */
  tokenEndpoint?: string;
  /** OAuth2 client ID */
  clientId?: string;
  /** OAuth2 scopes */
  scopes?: string[];
}

/** Retry configuration */
export interface RetryConfig {
  /** Maximum number of retries */
  maxRetries: number;
  /** Base delay in milliseconds */
  baseDelayMs: number;
  /** Maximum delay in milliseconds */
  maxDelayMs: number;
  /** Backoff multiplier (exponential) */
  backoffMultiplier: number;
  /** HTTP status codes that trigger a retry */
  retryableStatusCodes?: number[];
  /** Error codes that trigger a retry */
  retryableErrors?: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// EVENTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Event emitted when a connector's status changes.
 */
export interface ConnectorStatusChangeEvent {
  /** Connector instance ID */
  connectorId: string;
  /** Business ID */
  businessId: string;
  /** Previous status */
  previousStatus: ConnectorStatus;
  /** New status */
  currentStatus: ConnectorStatus;
  /** Timestamp */
  changedAt: Date;
  /** Reason for status change */
  reason?: string;
  /** Error details (if status is 'error') */
  error?: ExecutionError;
}

/**
 * Event emitted when a webhook is received.
 */
export interface WebhookReceivedEvent {
  /** Webhook registration ID */
  webhookId: string;
  /** Connector instance ID */
  connectorId: string;
  /** Business ID */
  businessId: string;
  /** External service event type */
  eventType: string;
  /** Parsed payload */
  payload: Record<string, unknown>;
  /** Raw request headers */
  headers: Record<string, string>;
  /** Timestamp */
  receivedAt: Date;
}

// ─────────────────────────────────────────────────────────────────────────────
// DTOs / INPUT TYPES
// ─────────────────────────────────────────────────────────────────────────────

/** Input for creating a connector connection */
export interface ConnectInput {
  /** Connector definition ID */
  definitionId: ExternalService;
  /** Business ID */
  businessId: string;
  /** User-given name */
  name: string;
  /** Configuration/credentials */
  config: Record<string, string>;
  /** Optional metadata */
  metadata?: Record<string, unknown>;
}

/** Input for registering a webhook */
export interface RegisterWebhookInput {
  /** Connector instance ID */
  connectorId: string;
  /** Event type to subscribe to */
  eventType: string;
  /** Callback URL */
  callbackUrl: string;
  /** Business ID */
  businessId: string;
}

/** Input for creating a custom connector */
export interface CreateCustomConnectorInput {
  /** Business ID */
  businessId: string;
  /** Connector name */
  name: string;
  /** Description */
  description: string;
  /** Base URL */
  baseUrl: string;
  /** Auth configuration */
  authConfig: CustomAuthConfig;
  /** Defined actions */
  actions: ExternalAction[];
  /** Default headers */
  headers?: Record<string, string>;
  /** Timeout in milliseconds */
  timeoutMs?: number;
  /** Retry configuration */
  retryConfig?: RetryConfig;
}

/** Input for executing an action */
export interface ExecuteActionInput {
  /** Connector instance ID */
  connectorId: string;
  /** Action name */
  action: string;
  /** Action parameters */
  parameters?: Record<string, unknown>;
  /** Timeout override */
  timeoutMs?: number;
  /** Async execution flag */
  async?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

/** Default retry configuration */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  retryableStatusCodes: [408, 429, 500, 502, 503, 504],
};

/** Default request timeout in milliseconds */
export const DEFAULT_TIMEOUT_MS = 30000;

/** Maximum request timeout in milliseconds */
export const MAX_TIMEOUT_MS = 120000;

/** Cache TTL for connector definitions in seconds */
export const CONNECTOR_DEF_CACHE_TTL = 3600;

/** Cache key prefix for connector instances */
export const CONNECTOR_INSTANCE_CACHE_PREFIX = 'key:cortex:connector:instance:';

/** Cache key prefix for connector definitions */
export const CONNECTOR_DEF_CACHE_PREFIX = 'key:cortex:connector:definition:';

/** Event name for connector status changes */
export const CONNECTOR_STATUS_CHANGE_EVENT = 'key.cortex.connector.status.changed';

/** Event name for webhook received */
export const WEBHOOK_RECEIVED_EVENT = 'key.cortex.webhook.received';

/** Event name for action executed */
export const ACTION_EXECUTED_EVENT = 'key.cortex.action.executed';

// ─────────────────────────────────────────────────────────────────────────────
// ERROR CODES
// ─────────────────────────────────────────────────────────────────────────────

export const ErrorCodes = {
  CONNECTOR_NOT_FOUND: 'CONNECTOR_NOT_FOUND',
  CONNECTOR_DEFINITION_NOT_FOUND: 'CONNECTOR_DEFINITION_NOT_FOUND',
  ACTION_NOT_FOUND: 'ACTION_NOT_FOUND',
  INVALID_CONFIG: 'INVALID_CONFIG',
  AUTHENTICATION_FAILED: 'AUTHENTICATION_FAILED',
  AUTHORIZATION_FAILED: 'AUTHORIZATION_FAILED',
  EXECUTION_FAILED: 'EXECUTION_FAILED',
  RATE_LIMITED: 'RATE_LIMITED',
  WEBHOOK_VERIFICATION_FAILED: 'WEBHOOK_VERIFICATION_FAILED',
  WEBHOOK_NOT_FOUND: 'WEBHOOK_NOT_FOUND',
  CUSTOM_CONNECTOR_INVALID: 'CUSTOM_CONNECTOR_INVALID',
  NETWORK_ERROR: 'NETWORK_ERROR',
  TIMEOUT_ERROR: 'TIMEOUT_ERROR',
  ENCRYPTION_ERROR: 'ENCRYPTION_ERROR',
  DECRYPTION_ERROR: 'DECRYPTION_ERROR',
  OAUTH_TOKEN_EXPIRED: 'OAUTH_TOKEN_EXPIRED',
  OAUTH_REFRESH_FAILED: 'OAUTH_REFRESH_FAILED',
  CIRCUIT_BREAKER_OPEN: 'CIRCUIT_BREAKER_OPEN',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
