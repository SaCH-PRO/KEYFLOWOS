/**
 * Expertise lenses — the professional discipline KEY adopts for a task.
 *
 * This is a distinct axis from persona (tone of voice, a user preference) and
 * from ReasoningMode (inference style). A lens carries a discipline's framing,
 * vocabulary and standard checks, and it selects how the answer is presented.
 *
 * IMPORTANT: a lens changes how KEY thinks and presents. It grants no access.
 * JobRole.permissions, JobRole.defaultApprovalTier and Membership.maxApprovalTier
 * remain the sole authority for what a caller may see or do. Adopting the
 * `finance` lens must never widen what the caller can reach.
 */

/** Baseline disciplines available to every business. */
export type ExpertiseLensKey =
  | 'finance'
  | 'sales'
  | 'marketing'
  | 'operations'
  | 'people'
  | 'legal'
  | 'support'
  | 'strategy'
  | 'technical'
  | 'generalist';

/**
 * How an answer should be shaped. Chosen by the lens together with the task,
 * because the same discipline answers differently depending on what was asked.
 */
export type OutputFormat =
  | 'table' // reconciliation, variance, line-by-line comparison
  | 'options' // a decision with tradeoffs
  | 'checklist' // procedural or operational steps
  | 'findings' // diagnostic: what was observed, with evidence
  | 'narrative'; // default conversational prose

export interface ExpertiseLens {
  key: ExpertiseLensKey;
  /** Display name. Derived from the business's own JobRole when one matches. */
  label: string;
  /** Framing injected into the prompt: how this discipline approaches a task. */
  framing: string;
  /** Checks this discipline habitually applies; surfaced as prompt guidance. */
  standardChecks: string[];
  /** Presentation this lens defaults to when the task gives no stronger signal. */
  defaultFormat: OutputFormat;
}

export interface LensSelection {
  lens: ExpertiseLens;
  format: OutputFormat;
  /** 0..1. Low confidence means the task was ambiguous and generalist was used. */
  confidence: number;
  /** Why this lens was chosen — surfaced to the user and useful in tests. */
  rationale: string;
  /**
   * Set when the business has a JobRole whose name matched the chosen lens, so
   * the label reflects that business's own vocabulary rather than ours.
   */
  matchedJobRole?: string;
}
