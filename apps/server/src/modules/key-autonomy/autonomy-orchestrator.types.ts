/**
 * Shared types for the unified AutonomyOrchestratorService.
 *
 * The orchestrator is the single source of truth for whether KEY may execute
 * an action. It aggregates verdicts from multiple rule providers (AI oversight,
 * Genome autonomy gate, module readiness, authority grants, constitution) and
 * emits one canonical AutonomyVerdict.
 */

export type AutonomyTier = 'manual' | 'supervised' | 'full';

export interface AutonomyActionContext {
  /** Business tenant ID */
  businessId: string;
  /** Target module (e.g. "crm", "commerce") */
  module: string;
  /** Action name within the module (e.g. "create_invoice") */
  action: string;
  /** Fully-qualified action key, usually `${module}.${action}` */
  actionKey: string;
  /** Action payload / parameters */
  parameters?: Record<string, unknown>;
  /** User/entity proposing the action */
  proposedBy?: string | null;
  /** Optionally override affected Genome domains */
  affectedDomains?: string[];
  /** Optional user role for role-based filtering */
  role?: string;
  /** Canonical KeyActionProposal id, when known */
  proposalId?: string;
}

export interface AutonomyRuleTrace {
  /** Which rule provider contributed this trace entry */
  source: string;
  /** Human-readable rule name */
  rule: string;
  /** Outcome of this specific rule */
  result: 'allow' | 'block' | 'supervised' | 'skip';
  /** Human-readable explanation */
  reason?: string;
  /** Provider-specific details (safe to log) */
  metadata?: Record<string, unknown>;
}

export interface AutonomyVerdict {
  /** Whether the action may proceed at all */
  allowed: boolean;
  /** Whether human approval is required before execution */
  requiresApproval: boolean;
  /** Operating tier: manual = blocked, supervised = approval needed, full = execute */
  tier: AutonomyTier;
  /** Confidence in the verdict (0–1) */
  confidence: number;
  /** Primary human-readable reason */
  reason: string;
  /** Per-provider rule trace for transparency */
  ruleTrace: AutonomyRuleTrace[];
  /** Timestamp the verdict was produced */
  createdAt: Date;
  /** Optional ID if the orchestrator materialized a proposal/approval request */
  proposalId?: string;
}

/** Interface every autonomy rule provider must implement. */
export interface IAutonomyRuleProvider {
  readonly name: string;
  evaluate(context: AutonomyActionContext): Promise<AutonomyVerdict | null>;
}
