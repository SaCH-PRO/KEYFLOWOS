/**
 * ── KeyConnector Core Types ────────────────────────────────────────────
 * Unified type definitions for the KeyFlowOS universal connector module.
 * Covers providers, connections, sync jobs, health checks, AI gateway,
 * and audit trails.
 * ───────────────────────────────────────────────────────────────────────
 */

// ═══════════════════════════════════════════════════════════════════════
// Provider Types
// ═══════════════════════════════════════════════════════════════════════

export type ProviderCategory =
  | 'google'
  | 'microsoft'
  | 'payment'
  | 'communication'
  | 'marketing'
  | 'social'
  | 'automation'
  | 'form'
  | 'internal';

export type AuthType = 'oauth2' | 'api_key' | 'webhook' | 'internal' | 'none';

export type ConnectionStatus =
  | 'connected'
  | 'disconnected'
  | 'error'
  | 'syncing'
  | 'pending_auth';

export type SyncStatus = 'idle' | 'running' | 'success' | 'error' | 'scheduled';

/**
 * Definition of a single provider (external or internal) in the unified registry.
 */
export interface KeyConnectorProviderDef {
  /** Unique provider key, e.g. "google_contacts", "crm" */
  key: string;
  /** Human-readable name */
  name: string;
  /** Category for grouping */
  category: ProviderCategory;
  /** Short description of what this provider does */
  description: string;
  /** Authentication mechanism required */
  authType: AuthType;
  /** Optional icon URL or identifier */
  icon?: string;
  /** Capabilities this provider exposes */
  capabilities: ProviderCapability[];
  /** OAuth scopes or permission identifiers */
  scopes?: string[];
  /** UI configuration schema for provider setup */
  configSchema?: ProviderConfigField[];
  /** Whether this is an internal KeyFlowOS module */
  isInternal?: boolean;
}

/**
 * A capability that a provider exposes to the platform.
 */
export interface ProviderCapability {
  /** Type of capability */
  type: 'read' | 'write' | 'sync' | 'webhook' | 'ai_action' | 'ai_query';
  /** Resource name this capability operates on */
  resource: string;
  /** Human-readable description */
  description: string;
}

/**
 * A configuration field shown in the provider setup UI.
 */
export interface ProviderConfigField {
  /** Field key */
  key: string;
  /** Human-readable label */
  label: string;
  /** Input type */
  type: 'string' | 'number' | 'boolean' | 'select' | 'secret';
  /** Whether the field is required */
  required: boolean;
  /** Options for select-type fields */
  options?: string[];
  /** Placeholder text for the input */
  placeholder?: string;
}

// ═══════════════════════════════════════════════════════════════════════
// Connection Types
// ═══════════════════════════════════════════════════════════════════════

/**
 * An active (or inactive) connection between a business and a provider.
 */
export interface KeyConnectorConnection {
  id: string;
  businessId: string;
  providerKey: string;
  status: ConnectionStatus;
  displayName: string;
  authData?: Record<string, unknown>;
  settings?: Record<string, unknown>;
  lastSyncAt?: Date;
  lastError?: string;
  healthScore: number;
  createdAt: Date;
  updatedAt: Date;
}

// ═══════════════════════════════════════════════════════════════════════
// Sync Types
// ═══════════════════════════════════════════════════════════════════════

/**
 * A single sync job execution record.
 */
export interface SyncJob {
  id: string;
  connectionId: string;
  providerKey: string;
  businessId: string;
  status: SyncStatus;
  direction: 'inbound' | 'outbound' | 'bidirectional';
  recordsRead: number;
  recordsCreated: number;
  recordsUpdated: number;
  recordsFailed: number;
  error?: string;
  meta?: Record<string, unknown>;
  startedAt: Date;
  completedAt?: Date;
}

// ═══════════════════════════════════════════════════════════════════════
// Health Types
// ═══════════════════════════════════════════════════════════════════════

/**
 * Result of a health check against a provider or connection.
 */
export interface HealthCheckResult {
  providerKey: string;
  connectionId?: string;
  status: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
  latencyMs: number;
  message?: string;
  checkedAt: Date;
}

// ═══════════════════════════════════════════════════════════════════════
// AI Gateway Types
// ═══════════════════════════════════════════════════════════════════════

/**
 * A parsed AI command ready for routing to a module or provider.
 */
export interface AiGatewayCommand {
  intent: string;
  module?: string;
  action?: string;
  provider?: string;
  parameters: Record<string, unknown>;
  businessId: string;
  userId: string;
}

/**
 * Result of executing an AI-gateway command.
 */
export interface AiGatewayResult {
  success: boolean;
  data?: unknown;
  error?: string;
  routedTo?: string;
  executionTimeMs: number;
}

// ═══════════════════════════════════════════════════════════════════════
// Audit Types
// ═══════════════════════════════════════════════════════════════════════

/**
 * A single audit log entry for connector activity.
 */
export interface ConnectorAuditEntry {
  id: string;
  businessId: string;
  userId?: string;
  providerKey?: string;
  connectionId?: string;
  action: string;
  status: 'success' | 'error' | 'warning';
  details?: Record<string, unknown>;
  createdAt: Date;
}
