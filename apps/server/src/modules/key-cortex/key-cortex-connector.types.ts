/**
 * KEY Universal Connector — Type System
 * --------------------------------------
 * Defines the complete type contract for the integration layer that connects
 * KEY's AI reasoning engine to all 19 KeyFlowOS functional modules.
 *
 * Every type is fully specified — no `any` anywhere.
 */

// ═══════════════════════════════════════════════════════════════════════════════
//  MODULE IDENTIFIERS
// ═══════════════════════════════════════════════════════════════════════════════

export type ModuleName =
  | 'crm'
  | 'commerce'
  | 'bookings'
  | 'content'
  | 'communications'
  | 'flow'
  | 'autopilot'
  | 'temporal'
  | 'inbox'
  | 'genome'
  | 'intelligence'
  | 'notifications'
  | 'projects'
  | 'social'
  | 'analytics'
  | 'finance'
  | 'settings'
  | 'activity'
  | 'keystore';

// ═══════════════════════════════════════════════════════════════════════════════
//  CAPABILITY DESCRIPTOR TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Describes a single parameter accepted by an action or query.
 */
export interface ActionParameter {
  /** Machine-readable parameter key (e.g. "contactId"). */
  name: string;

  /** Runtime type used for coercion and validation. */
  type: 'string' | 'number' | 'boolean' | 'date' | 'enum' | 'id' | 'array' | 'object';

  /** Human-readable description shown in AI prompts. */
  description: string;

  /** Whether the parameter must be present for the call to succeed. */
  required: boolean;

  /** Allowed values when `type === 'enum'`. */
  enumValues?: string[];

  /** Static default used when the parameter is omitted. */
  default?: unknown;

  /** Nested schema when `type === 'object'` or item schema when `type === 'array'`. */
  schema?: ActionParameter[];
}

/**
 * An action = a side-effectful operation that a module can perform.
 * Actions mutate state (create, update, delete, send, trigger, …).
 */
export interface ModuleAction {
  /** Machine-safe action key (snake_case). */
  name: string;

  /** One-line description for AI context windows. */
  description: string;

  /** Ordered parameter definitions. */
  parameters: ActionParameter[];

  /** If true, KEY must ask the user for explicit confirmation before executing. */
  requiresApproval: boolean;

  /** Natural-language utterances that should map to this action. */
  examples: string[];
}

/**
 * A query = a read-only operation that returns data without mutating state.
 */
export interface ModuleQuery {
  /** Machine-safe query key (snake_case). */
  name: string;

  /** One-line description for AI context windows. */
  description: string;

  /** Accepted filter / selector parameters. */
  parameters: ActionParameter[];

  /** Human-readable description of the return shape (e.g. "Contact[]"). */
  returns: string;

  /** Natural-language utterances that should map to this query. */
  examples: string[];
}

/**
 * Bundles every callable surface of a single KeyFlowOS module.
 */
export interface ModuleCapability {
  module: ModuleName;
  actions: ModuleAction[];
  queries: ModuleQuery[];
  description: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  COMMAND & RESULT TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Immutable command emitted by the AI reasoning layer and routed by the
 * Universal Connector to the correct module service.
 */
export interface ConnectorCommand {
  /** Target module. */
  module: ModuleName;

  /** Action or query name (must exist in the module's capability registry). */
  action: string;

  /** Coerced key-value bag built by the command parser. */
  parameters: Record<string, unknown>;

  /** Business / tenant scope. */
  businessId: string;

  /** Authenticated user who initiated the request. */
  userId: string;

  /** Always 'key_cortex' — used for audit trails. */
  source: 'key_cortex';

  /** UTC timestamp at which the command was created. */
  timestamp: Date;

  /** Correlation ID that links the command to the parent conversation turn. */
  correlationId: string;
}

/**
 * Uniform result envelope returned by every module adapter.
 */
export interface ConnectorResult {
  /** Whether the underlying service call succeeded. */
  success: boolean;

  /** Payload returned by the service (undefined on failure). */
  data?: unknown;

  /** Human-readable error message (undefined on success). */
  error?: string;

  /** Wall-clock execution time in milliseconds. */
  executionTimeMs: number;

  /** The original command that produced this result. */
  command: ConnectorCommand;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  INTENT PARSING TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Output of the NL → structured command parser.
 * Represents a single intent extracted from a user's message.
 */
export interface ParsedIntent {
  /** Same as `action` — kept for downstream convenience. */
  intent: string;

  /** Model confidence in the [0, 1] range. */
  confidence: number;

  /** Target module inferred from the utterance. */
  module: ModuleName;

  /** Target action or query name. */
  action: string;

  /** Extracted and coerced parameter bag. */
  parameters: Record<string, unknown>;

  /** Whether user confirmation is required before execution. */
  requiresApproval: boolean;

  /** The original natural-language request (for logging & replay). */
  naturalLanguage: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  CONTEXT TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Per-module context slice returned by `getFullContext()`.
 */
export interface ModuleContextSlice {
  module: ModuleName;
  summary: string;
  recordCount: number;
  lastActivityAt?: Date;
  urgentItems: string[];
  data: Record<string, unknown>;
}

/**
 * Aggregated business context that the reasoning engine consumes.
 */
export interface FullBusinessContext {
  businessId: string;
  gatheredAt: Date;
  modules: Partial<Record<ModuleName, ModuleContextSlice>>;
  genome?: {
    stage: string;
    readinessScore: number;
    dnaProfile: Record<string, unknown>;
  };
  activeAlerts: number;
  pendingTasks: number;
  recentRevenue: number;
  openConversations: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  UTILITY / HELPER TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/** Approval gate metadata attached to commands that require user confirmation. */
export interface ApprovalGate {
  command: ConnectorCommand;
  reason: string;
  requestedAt: Date;
  expiresAt: Date;
  approved: boolean | null;
  approvedBy?: string;
  approvedAt?: Date;
}

/** Audit-log entry written after every command execution. */
export interface ExecutionAuditEntry {
  correlationId: string;
  businessId: string;
  userId: string;
  module: ModuleName;
  action: string;
  parameters: Record<string, unknown>;
  success: boolean;
  error?: string;
  executionTimeMs: number;
  executedAt: Date;
}

/** Options passed to the executor for batch or transactional runs. */
export interface ExecuteOptions {
  /** If true, all mutations are validated but not persisted (dry-run). */
  dryRun?: boolean;

  /** If true, the executor halts the batch on the first failure. */
  stopOnError?: boolean;

  /** Timeout per command in milliseconds (default: 30000). */
  timeoutMs?: number;

  /** If true, results are streamed back as they complete. */
  streaming?: boolean;
}

/** Batch execution envelope. */
export interface BatchExecutionResult {
  results: ConnectorResult[];
  totalTimeMs: number;
  succeeded: number;
  failed: number;
  rolledBack: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  MODULE-SPECIFIC PARAMETER SHAPE HELPERS (type-safe narrowers)
// ═══════════════════════════════════════════════════════════════════════════════

/** Parameter bag for CRM create_contact action. */
export interface CrmCreateContactParams {
  firstName: string;
  lastName?: string;
  email?: string;
  phone?: string;
  company?: string;
  tags?: string[];
  status?: 'lead' | 'prospect' | 'customer' | 'churned' | 'partner';
}

/** Parameter bag for Commerce create_invoice action. */
export interface CommerceCreateInvoiceParams {
  contactId: string;
  items: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
    taxRate?: number;
  }>;
  dueDate?: string;
  notes?: string;
  sendImmediately?: boolean;
}

/** Parameter bag for Bookings create_booking action. */
export interface BookingsCreateBookingParams {
  contactId: string;
  serviceId: string;
  startTime: string;
  endTime?: string;
  staffId?: string;
  notes?: string;
}

/** Parameter bag for Content create_post action. */
export interface ContentCreatePostParams {
  title: string;
  body: string;
  platform?: 'blog' | 'facebook' | 'instagram' | 'linkedin' | 'twitter';
  status?: 'draft' | 'scheduled' | 'published';
  scheduledAt?: string;
  tags?: string[];
}

/** Parameter bag for Communications send_message action. */
export interface CommunicationsSendMessageParams {
  contactId: string;
  channel: 'sms' | 'email' | 'whatsapp';
  body: string;
  templateId?: string;
  attachments?: string[];
}

/** Parameter bag for Flow create_automation action. */
export interface FlowCreateAutomationParams {
  name: string;
  trigger: string;
  actions: Array<Record<string, unknown>>;
  conditions?: Array<Record<string, unknown>>;
  active?: boolean;
}

/** Parameter bag for Projects create_project action. */
export interface ProjectsCreateProjectParams {
  name: string;
  description?: string;
  contactId?: string;
  dueDate?: string;
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  assigneeId?: string;
}

/** Parameter bag for Keystore create_service_order action. */
export interface KeystoreCreateOrderParams {
  listingId: string;
  pricingTier: string;
  briefAnswers?: Array<{ questionId: string; question: string; answer: string | string[] }>;
  selectedAddons?: Array<{ addonName: string; price: number }>;
  notes?: string;
  contactId?: string;
}
