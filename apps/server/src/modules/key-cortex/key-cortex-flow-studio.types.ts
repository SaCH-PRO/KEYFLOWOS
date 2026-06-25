// ============================================================
// KEY Flow Studio — Visual Automation Builder Type Definitions
// ============================================================
// Powers the drag-and-drop workflow engine for KEY Cortex.
// Every flow is a directed graph of nodes connected by edges,
// executed topologically with full context persistence.

// ─────────────────────────────────────────────────────────────
// 1. NODE TYPES
// ─────────────────────────────────────────────────────────────

export type FlowNodeType =
  | 'trigger'       // Event that starts the flow
  | 'action'        // Execute an action via KeyCortexConnector
  | 'condition'     // If/else branch evaluation
  | 'delay'         // Wait for a specified time
  | 'ai_decision'   // Let KEY AI make a routing decision
  | 'merge'         // Merge multiple parallel paths
  | 'split'         // Split into parallel execution paths
  | 'wait_for'      // Wait for an external event
  | 'loop'          // Repeat N times or until condition
  | 'error_handler' // Catch and handle errors
  | 'notification'  // Send in-app / push notification
  | 'transform'     // Transform / map data shape
  | 'filter';       // Filter items by criteria

// ─────────────────────────────────────────────────────────────
// 2. TRIGGER TYPES
// ─────────────────────────────────────────────────────────────

export type FlowTriggerType =
  | 'event'         // When a business event occurs
  | 'schedule'      // Cron-based time trigger
  | 'webhook'       // External HTTP webhook call
  | 'manual'        // Manually triggered by user
  | 'api'           // Programmatic API call
  | 'key_command';  // KEY natural language command

// ─────────────────────────────────────────────────────────────
// 3. NODE DATA (type-specific configuration)
// ─────────────────────────────────────────────────────────────

export interface FlowNodeData {
  // ── Base ──
  label: string;
  description?: string;
  config: Record<string, unknown>;

  // ── Action nodes ──
  module?: string;
  action?: string;
  parameters?: Record<string, unknown>;

  // ── Condition nodes ──
  condition?: string;
  operator?: 'eq' | 'ne' | 'gt' | 'lt' | 'gte' | 'lte' | 'contains' | 'exists' | 'in';
  value?: unknown;

  // ── Delay nodes ──
  delayMs?: number;
  delayUnit?: 'seconds' | 'minutes' | 'hours' | 'days';
  delayValue?: number;

  // ── Schedule triggers ──
  cronExpression?: string;
  timezone?: string;

  // ── AI decision nodes ──
  prompt?: string;
  options?: string[];

  // ── Loop nodes ──
  loopType?: 'count' | 'while' | 'for_each';
  loopCount?: number;
  loopCondition?: string;
  loopCollection?: string;

  // ── Transform nodes ──
  mapping?: Record<string, string>;
  transformScript?: string;

  // ── Filter nodes ──
  filterField?: string;
  filterOperator?: 'eq' | 'ne' | 'gt' | 'lt' | 'contains' | 'starts_with' | 'ends_with' | 'exists' | 'in';
  filterValue?: unknown;

  // ── Notification nodes ──
  notificationTitle?: string;
  notificationBody?: string;
  notificationChannel?: 'push' | 'email' | 'sms' | 'in_app';
  notificationPriority?: 'low' | 'normal' | 'high' | 'urgent';
  notificationRecipient?: string;

  // ── Wait-for nodes ──
  waitForEvent?: string;
  waitTimeoutMs?: number;

  // ── Error-handler nodes ──
  errorAction?: 'retry' | 'skip' | 'notify' | 'halt';
  maxRetries?: number;
  retryDelayMs?: number;
}

// ─────────────────────────────────────────────────────────────
// 4. FLOW NODE (graph vertex)
// ─────────────────────────────────────────────────────────────

export interface FlowNode {
  id: string;
  type: FlowNodeType;
  position: { x: number; y: number };
  data: FlowNodeData;
  inputs: string[];   // node IDs that connect TO this node
  outputs: string[];  // node IDs that this node connects TO
}

// ─────────────────────────────────────────────────────────────
// 5. FLOW EDGE (graph edge with optional condition label)
// ─────────────────────────────────────────────────────────────

export interface FlowEdge {
  id: string;
  source: string;     // source node ID
  target: string;     // target node ID
  label?: string;     // e.g. "true", "false", "yes", "no"
  condition?: string; // JavaScript-like expression for conditional edges
}

// ─────────────────────────────────────────────────────────────
// 6. FLOW TRIGGER
// ─────────────────────────────────────────────────────────────

export interface FlowTrigger {
  type: FlowTriggerType;
  config: Record<string, unknown>;
  eventName?: string;
  cronExpression?: string;
  webhookPath?: string;
  webhookMethod?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  apiEndpoint?: string;
  keyCommandPattern?: string;
}

// ─────────────────────────────────────────────────────────────
// 7. FLOW DEFINITION (the full automation blueprint)
// ─────────────────────────────────────────────────────────────

export interface FlowDefinition {
  id: string;
  businessId: string;
  name: string;
  description?: string;
  version: number;
  nodes: FlowNode[];
  edges: FlowEdge[];
  trigger: FlowTrigger;
  status: 'draft' | 'active' | 'paused' | 'archived';
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  executionCount: number;
  lastExecutionAt?: Date;
  lastExecutionStatus?: 'success' | 'error' | 'warning';
  tags: string[];
  category: string;
}

// ─────────────────────────────────────────────────────────────
// 8. FLOW EXECUTION (runtime state)
// ─────────────────────────────────────────────────────────────

export interface FlowExecution {
  id: string;
  flowId: string;
  businessId: string;
  status: 'pending' | 'running' | 'completed' | 'error' | 'paused' | 'waiting';
  startedAt: Date;
  completedAt?: Date;
  currentNodeId?: string;
  context: Record<string, unknown>;
  results: FlowNodeResult[];
  error?: string;
  parentExecutionId?: string; // for sub-flow / loop iterations
  iterationIndex?: number;    // for loop tracking
}

// ─────────────────────────────────────────────────────────────
// 9. NODE EXECUTION RESULT
// ─────────────────────────────────────────────────────────────

export interface FlowNodeResult {
  nodeId: string;
  nodeType: FlowNodeType;
  status: 'success' | 'error' | 'skipped' | 'pending';
  startedAt: Date;
  completedAt?: Date;
  output?: unknown;
  error?: string;
  executionTimeMs: number;
  retryCount?: number;
}

// ─────────────────────────────────────────────────────────────
// 10. FLOW TEMPLATE (pre-built starting point)
// ─────────────────────────────────────────────────────────────

export interface FlowTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
  trigger: FlowTrigger;
  tags: string[];
  estimatedSetupTime: string;
  difficulty?: 'beginner' | 'intermediate' | 'advanced';
  icon?: string;
}

// ─────────────────────────────────────────────────────────────
// 11. AI FLOW GENERATION REQUEST
// ─────────────────────────────────────────────────────────────

export interface FlowGenerationRequest {
  description: string;
  businessId: string;
  category?: string;
  triggerHint?: string;
  modulePreferences?: string[];
  maxNodes?: number;
}

// ─────────────────────────────────────────────────────────────
// 12. VALIDATION RESULT
// ─────────────────────────────────────────────────────────────

export interface FlowValidationResult {
  valid: boolean;
  errors: FlowValidationError[];
  warnings: FlowValidationWarning[];
}

export interface FlowValidationError {
  code: string;
  message: string;
  nodeId?: string;
  edgeId?: string;
}

export interface FlowValidationWarning {
  code: string;
  message: string;
  nodeId?: string;
  edgeId?: string;
}

// ─────────────────────────────────────────────────────────────
// 13. NODE REGISTRY ENTRY (metadata for the visual builder)
// ─────────────────────────────────────────────────────────────

export interface NodeRegistryEntry {
  type: FlowNodeType;
  name: string;
  description: string;
  category: string;
  icon: string;
  color: string;
  configSchema: NodeConfigSchemaField[];
  inputPorts: NodePort[];
  outputPorts: NodePort[];
  defaultData: Partial<FlowNodeData>;
}

export interface NodeConfigSchemaField {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'select' | 'json' | 'expression' | 'code';
  label: string;
  description?: string;
  required: boolean;
  defaultValue?: unknown;
  options?: string[];          // for 'select' type
  placeholder?: string;
}

export interface NodePort {
  id: string;
  label: string;
  description?: string;
  required: boolean;
  maxConnections?: number;
}

// ─────────────────────────────────────────────────────────────
// 14. FLOW EXECUTION EVENTS (for EventEmitter2)
// ─────────────────────────────────────────────────────────────

export const FLOW_EVENTS = {
  EXECUTION_STARTED: 'flow.execution.started',
  EXECUTION_COMPLETED: 'flow.execution.completed',
  EXECUTION_ERROR: 'flow.execution.error',
  EXECUTION_PAUSED: 'flow.execution.paused',
  NODE_STARTED: 'flow.node.started',
  NODE_COMPLETED: 'flow.node.completed',
  NODE_ERROR: 'flow.node.error',
  NODE_RETRYING: 'flow.node.retrying',
  FLOW_CREATED: 'flow.created',
  FLOW_UPDATED: 'flow.updated',
  FLOW_DELETED: 'flow.deleted',
  FLOW_ACTIVATED: 'flow.activated',
  FLOW_PAUSED: 'flow.paused',
  TEMPLATE_APPLIED: 'flow.template.applied',
  AI_FLOW_GENERATED: 'flow.ai.generated',
} as const;

// ─────────────────────────────────────────────────────────────
// 15. EXECUTION OPTIONS
// ─────────────────────────────────────────────────────────────

export interface FlowExecutionOptions {
  dryRun?: boolean;
  maxExecutionTimeMs?: number;
  maxNodes?: number;
  traceEnabled?: boolean;
  contextOverrides?: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────
// 16. FLOW STATISTICS
// ─────────────────────────────────────────────────────────────

export interface FlowStatistics {
  flowId: string;
  totalExecutions: number;
  successRate: number;
  averageExecutionTimeMs: number;
  last7Days: DayStat[];
  topErrors: { message: string; count: number }[];
  nodePerformance: NodePerformanceStat[];
}

export interface DayStat {
  date: string;
  executions: number;
  successes: number;
  errors: number;
}

export interface NodePerformanceStat {
  nodeId: string;
  nodeType: FlowNodeType;
  avgExecutionTimeMs: number;
  errorRate: number;
  totalExecutions: number;
}
