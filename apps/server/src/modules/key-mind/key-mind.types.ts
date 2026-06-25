/**
 * =============================================================================
 * KEY Mind — Type Definitions
 * =============================================================================
 * All type contracts for the Role Intelligence Engine.
 * Defines 12 business functions, 7 worker tiers, 84 role archetypes,
 * and the consciousness frame that captures KEY's thinking state.
 *
 * @module      key-mind.types
 * @version     1.0.0
 * @copyright   KEY Flow OS, Inc.
 * =============================================================================
 */

// ── Business Function Enum (12 functions) ──────────────────────────────────

/**
 * The twelve core business functions that every organisation needs.
 * Used to route incoming queries to the correct functional expertise.
 */
export type BusinessFunction =
  | 'strategy'
  | 'operations'
  | 'finance'
  | 'sales'
  | 'marketing'
  | 'customer_success'
  | 'product'
  | 'people'
  | 'legal_risk'
  | 'analytics'
  | 'technology'
  | 'admin';

/** Canonical list of all business functions (deterministic ordering). */
export const ALL_BUSINESS_FUNCTIONS: BusinessFunction[] = [
  'strategy',
  'operations',
  'finance',
  'sales',
  'marketing',
  'customer_success',
  'product',
  'people',
  'legal_risk',
  'analytics',
  'technology',
  'admin',
];

// ── Worker Tier Enum (7 tiers) ─────────────────────────────────────────────

/**
 * The seven tiers of the organisational hierarchy.
 * Determines seniority, scope of responsibility, and decision authority.
 */
export type WorkerTier =
  | 'intern'
  | 'assistant'
  | 'specialist'
  | 'manager'
  | 'director'
  | 'executive'
  | 'founder_partner';

/** Canonical list of all worker tiers (bottom → top). */
export const ALL_WORKER_TIERS: WorkerTier[] = [
  'intern',
  'assistant',
  'specialist',
  'manager',
  'director',
  'executive',
  'founder_partner',
];

// ── KeyRoleBrain — A complete role archetype definition ────────────────────

/**
 * A fully-qualified intelligence archetype.
 * Every role in the taxonomy is a `KeyRoleBrain` — it tells KEY exactly how
 * to think, what to question, which frameworks to apply, and what "good"
 * looks like for that role.
 *
 * @example
 * ```ts
 * const role = getRoleById('strategy-executive');
 * console.log(role.coreQuestions[0]); // "What is our 3-year strategic vision?"
 * ```
 */
export interface KeyRoleBrain {
  /** Globally-unique role identifier (e.g. `'strategy-executive'`). */
  id: string;

  /** Human-readable role name (e.g. `'Chief Executive Officer'`). */
  name: string;

  /** The business function this role belongs to. */
  functionArea: BusinessFunction;

  /** The organisational tier of this role. */
  tier: WorkerTier;

  /** One-sentence mission statement for the role. */
  mission: string;

  /** Priority questions this role should always ask. */
  coreQuestions: string[];

  /** Named frameworks, models and methodologies the role uses. */
  frameworks: string[];

  /** Types of evidence this role requires before making a decision. */
  evidenceStandards: string[];

  /** Document / artifact formats this role produces. */
  outputFormats: string[];

  /** Risk categories this role must check before finalising output. */
  riskChecks: string[];

  /** KPIs and metrics this role is measured by. */
  successMetrics: string[];

  /**
   * Cognitive disposition — how the role approaches problems.
   * @example "first-principles", "creative", "risk-aware", "empathetic"
   */
  thinkingStyle: string;

  /**
   * Communication disposition — how the role expresses itself.
   * @example "visionary-concise", "diplomatic", "data-driven"
   */
  communicationStyle: string;

  /**
   * Typical planning horizon for this role's decisions.
   * @example "days" | "weeks" | "quarters" | "years"
   */
  decisionHorizon: string;

  /**
   * Percentage allocation of time across activities (0-100 each).
   * Keys are activity names, values are percentages.
   * Total should ideally equal 100.
   */
  timeAllocation: Record<string, number>;
}

// ── KeyConsciousnessFrame — KEY's current thinking state ───────────────────

/**
 * The real-time cognitive state of the KEY engine.
 * Captures what KEY is thinking about right now: which roles are active,
 * what signals have been detected, and what output mode is most appropriate.
 */
export interface KeyConsciousnessFrame {
  /** The user's original intent / query, normalised. */
  userIntent: string;

  /** The business function KEY has identified as most relevant. */
  businessFunction: BusinessFunction;

  /** The worker tier KEY is operating at for this interaction. */
  workerTier: WorkerTier;

  /** IDs of the roles currently activated in KEY's reasoning pipeline. */
  activatedRoles: string[];

  /** Signals detected from the user's input or surrounding context. */
  detectedSignals: BusinessSignal[];

  /** Hidden risks that may not be obvious to the user. */
  hiddenRisks: string[];

  /** Opportunities surfaced by the intelligence engine. */
  opportunities: string[];

  /** Named reasoning frameworks currently in use. */
  reasoningFrameworks: string[];

  /** Recommended output mode for this interaction. */
  recommendedOutputMode: OutputMode;

  /** Confidence score (0.0 – 1.0) in the current classification. */
  confidence: number;

  /** Ordered log of reasoning steps taken so far. */
  thinkingTrace: string[];
}

// ── Business Signal — A detected business issue/opportunity ────────────────

/**
 * An automatically-detected business event surfaced by the Signal Detection
 * Layer. Signals drive role activation and prioritisation.
 */
export interface BusinessSignal {
  /** The category of signal detected. */
  type: 'risk' | 'opportunity' | 'anomaly' | 'pattern';

  /** Where the signal originated (e.g. `'user_query'`, `'crm_pipeline'`). */
  source: string;

  /** Human-readable description of the signal. */
  description: string;

  /** Severity level — drives escalation behaviour. */
  severity: 'low' | 'medium' | 'high' | 'critical';

  /** Which business function should own the response. */
  recommendedFunction: BusinessFunction;

  /** Confidence (0.0 – 1.0) that this signal is real and actionable. */
  confidence: number;
}

// ── Output Mode ── How KEY should respond ─────────────────────────────────

/**
 * The eight output modalities KEY can adopt.
 * The Consciousness Frame selects the most appropriate mode for every
 * interaction based on user intent and detected signals.
 */
export type OutputMode =
  | 'diagnostic'      // Analyse and identify the problem
  | 'recommendation'  // Suggest specific actions
  | 'plan'            // Create a step-by-step plan
  | 'execution'       // Execute directly (if autonomy enabled)
  | 'teaching'        // Explain the concept/framework
  | 'creative'        // Brainstorm ideas
  | 'review'          // Review / critique existing work
  | 'forecast';       // Predict future outcomes

// ── Quality Check Result ───────────────────────────────────────────────────

/**
 * The result of running KEY's quality assurance layer over a piece of output.
 * Every deliverable should pass role-specific quality checks before being
 * returned to the user.
 */
export interface QualityCheckResult {
  /** Whether the deliverable passed all mandatory checks. */
  passed: boolean;

  /** Aggregated quality score (0 – 100). */
  score: number;

  /** Individual criterion-level results. */
  checks: {
    criterion: string;
    passed: boolean;
    notes: string;
  }[];

  /** Human-readable overall verdict. */
  overallVerdict: string;
}

// ── Learning Entry ── What KEY learned from an outcome ─────────────────────

/**
 * A single learning event captured by the Feedback & Learning Loop.
 * KEY uses these entries to refine future reasoning and improve accuracy.
 */
export interface LearningEntry {
  /** Unique learning entry identifier (UUID). */
  id: string;

  /** The role ID that produced the output being evaluated. */
  roleId: string;

  /** Context / situation in which the action was taken. */
  context: string;

  /** The action or recommendation KEY made. */
  action: string;

  /** Observed outcome of the action. */
  outcome: 'success' | 'failure' | 'partial';

  /** Extracted lessons — what to do (or not do) next time. */
  lessons: string[];

  /** Change in confidence for this role (+/-). */
  confidenceDelta: number;

  /** When the learning entry was recorded. */
  createdAt: Date;
}

// ── Role Classification Result ─────────────────────────────────────────────

/**
 * The structured result produced by the Intent Classification Layer when
 * it determines which roles should handle a given user query.
 */
export interface RoleClassificationResult {
  /** The primary business function identified. */
  primaryFunction: BusinessFunction;

  /** The primary worker tier identified. */
  primaryTier: WorkerTier;

  /** Fully-resolved role objects activated for this query. */
  activatedRoles: KeyRoleBrain[];

  /** Confidence (0.0 – 1.0) in the classification. */
  confidence: number;

  /** Human-readable explanation of how the classification was reached. */
  reasoning: string;
}

// ── Interaction Record — Audit trail for every KEY interaction ─────────────

/**
 * Immutable audit record of a single KEY interaction.
 * Used for compliance, debugging, and learning-loop analytics.
 */
export interface KeyInteractionRecord {
  /** Unique interaction identifier (UUID v4). */
  id: string;

  /** Timestamp when the interaction started. */
  startedAt: Date;

  /** Timestamp when the interaction completed (if finished). */
  completedAt?: Date;

  /** The original user query / prompt. */
  userQuery: string;

  /** Normalised intent extracted from the query. */
  normalisedIntent: string;

  /** Classification result from the Intent Classification Layer. */
  classification: RoleClassificationResult;

  /** Consciousness frames captured during the interaction. */
  consciousnessFrames: KeyConsciousnessFrame[];

  /** Business signals detected during the interaction. */
  signals: BusinessSignal[];

  /** Roles that contributed to the final output. */
  contributingRoles: string[];

  /** Quality check results for the final deliverable. */
  qualityCheck: QualityCheckResult;

  /** The final output delivered to the user (or error message). */
  finalOutput: string;

  /** Whether the user explicitly approved the output. */
  userApproved?: boolean;

  /** User feedback score (-1 to +1), if provided. */
  userFeedbackScore?: number;

  /** Free-text user feedback, if provided. */
  userFeedbackText?: string;

  /** Any learning entries generated from this interaction. */
  learningEntries: LearningEntry[];

  /** Performance metrics for this interaction. */
  performance: {
    classificationMs: number;
    reasoningMs: number;
    outputMs: number;
    totalMs: number;
    tokensIn: number;
    tokensOut: number;
  };
}

// ── Mind Engine Configuration ──────────────────────────────────────────────

/**
 * Runtime configuration for the KEY Mind Engine.
 * Controls autonomy levels, confidence thresholds, and feature flags.
 */
export interface MindEngineConfig {
  /** Minimum confidence (0.0 – 1.0) required before auto-executing. */
  autoExecuteConfidenceThreshold: number;

  /** Whether autonomous execution mode is enabled at all. */
  autonomyEnabled: boolean;

  /** Number of alternative roles to consider before finalising. */
  maxAlternativeRoles: number;

  /** Whether the learning loop is active (records outcomes). */
  learningLoopEnabled: boolean;

  /** Whether quality checks are enforced before returning output. */
  qualityChecksEnabled: boolean;

  /** Default output mode when classification is ambiguous. */
  fallbackOutputMode: OutputMode;

  /** How many previous interactions to include as context. */
  contextWindowSize: number;

  /** Whether to include user feedback in the reasoning chain. */
  includeUserFeedback: boolean;

  /** Whether to surface hidden risks and opportunities automatically. */
  proactiveInsightsEnabled: boolean;

  /** Minimum signal confidence before escalating to the user. */
  signalEscalationThreshold: number;

  /** Maximum time (ms) allowed for a single interaction. */
  interactionTimeoutMs: number;
}
