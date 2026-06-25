/**
 * Key Connector — Frontend TypeScript Types
 * Mirrors the backend tRPC keyConnector router types.
 */

// ────────────────────────────────────────────
// Provider
// ────────────────────────────────────────────

export type ProviderStatus = 'connected' | 'disconnected' | 'error' | 'syncing';

export type ProviderCategory =
  | 'crm'
  | 'marketing'
  | 'finance'
  | 'communication'
  | 'storage'
  | 'analytics'
  | 'ai'
  | 'ecommerce'
  | 'social'
  | 'other';

export interface ConfigSchemaField {
  key: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'select' | 'password' | 'url';
  required: boolean;
  placeholder?: string;
  options?: { label: string; value: string }[];
  description?: string;
}

export interface Provider {
  id: string;
  key: string;
  name: string;
  description: string;
  category: ProviderCategory;
  icon?: string; // URL or Lucide icon name
  status: ProviderStatus;
  healthScore: number; // 0–100
  lastSyncAt: string | null; // ISO date
  configSchema: ConfigSchemaField[];
  scopes?: string[];
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

// ────────────────────────────────────────────
// Connection
// ────────────────────────────────────────────

export interface ConnectionCredential {
  [key: string]: string | number | boolean;
}

export interface Connection {
  id: string;
  providerKey: string;
  providerName: string;
  status: ProviderStatus;
  healthScore: number;
  credentials: ConnectionCredential;
  scopes: string[];
  settings?: Record<string, unknown>;
  lastSyncAt: string | null;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

// ────────────────────────────────────────────
// Sync Job
// ────────────────────────────────────────────

export type SyncDirection = 'inbound' | 'outbound' | 'bidirectional';
export type SyncStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface SyncRecordCounts {
  read: number;
  created: number;
  updated: number;
  deleted: number;
  failed: number;
  skipped: number;
}

export interface SyncJob {
  id: string;
  providerKey: string;
  providerName: string;
  direction: SyncDirection;
  status: SyncStatus;
  counts: SyncRecordCounts;
  startedAt: string;
  completedAt: string | null;
  errorMessage?: string;
  errorDetails?: string;
  triggeredBy: 'manual' | 'scheduled' | 'webhook' | 'system';
}

// ────────────────────────────────────────────
// Health Check
// ────────────────────────────────────────────

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';

export interface HealthCheck {
  id: string;
  providerKey: string;
  providerName: string;
  status: HealthStatus;
  score: number; // 0–100
  latencyMs: number;
  message?: string;
  checkedAt: string;
}

export interface OverallHealth {
  score: number;
  status: HealthStatus;
  totalProviders: number;
  healthyCount: number;
  degradedCount: number;
  unhealthyCount: number;
  checks: HealthCheck[];
}

// ────────────────────────────────────────────
// AI Command
// ────────────────────────────────────────────

export interface AiCommandMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface AiCommand {
  id: string;
  command: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  messages: AiCommandMessage[];
  result?: {
    action?: string;
    data?: unknown;
    summary: string;
  };
  createdAt: string;
  completedAt?: string;
}

// ────────────────────────────────────────────
// Audit Log
// ────────────────────────────────────────────

export type AuditAction =
  | 'provider_connected'
  | 'provider_disconnected'
  | 'sync_triggered'
  | 'sync_completed'
  | 'sync_failed'
  | 'health_check'
  | 'ai_command'
  | 'settings_updated'
  | 'credentials_rotated';

export interface AuditLogEntry {
  id: string;
  action: AuditAction;
  providerKey?: string;
  providerName?: string;
  userId?: string;
  userName?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
  createdAt: string;
}

// ────────────────────────────────────────────
// Wizard State
// ────────────────────────────────────────────

export type WizardStep = 1 | 2 | 3 | 4;

export interface WizardState {
  step: WizardStep;
  selectedProvider: Provider | null;
  credentials: Record<string, string | number | boolean>;
  scopes: string[];
  settings: Record<string, unknown>;
  isConnecting: boolean;
  error: string | null;
}

// ────────────────────────────────────────────
// Stats
// ────────────────────────────────────────────

export interface ConnectorStats {
  totalProviders: number;
  connectedCount: number;
  healthyCount: number;
  syncingCount: number;
  errorCount: number;
  lastSyncAt: string | null;
}
