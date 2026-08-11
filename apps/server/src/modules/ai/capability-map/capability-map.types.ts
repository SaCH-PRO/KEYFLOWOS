/**
 * Types for the KEY capability model — the seed loaded by CapabilityModelService.
 *
 * The shape here MUST match exactly what `docs/architecture/capability-map/generate.js`
 * emits into `capability-map.seed.ts`. If you change the generator's output shape,
 * update these types and re-run the generator.
 */

/** Execution mode — derived from governance signals, never chosen. */
export type CapabilityMode = 'agentic' | 'assisted' | 'assisted_approval' | 'human_gated';

export type ToolFamily = 'read' | 'draft' | 'organize' | 'execute' | 'crud';
export type RiskTier = 1 | 2 | 3 | 4;

/** Whether a target capability is executable today, or declared-but-not-built. */
export type TargetStatus = 'active' | 'planned';

/** A governed flow tool that lives in a domain. */
export interface CapabilityTool {
  name: string;
  description: string;
  family: ToolFamily;
  riskTier: RiskTier;
  mode: CapabilityMode;
  /** Route prefix, e.g. `/app/crm`. */
  route: string;
  /** Full manual-equivalent route from the tool registry. */
  fullRoute: string;
}

/** A declared cortex module capability. */
export interface CapabilityCortexAction {
  name: string;
  description: string;
  module: string;
  requiresApproval: boolean;
  mode: CapabilityMode;
}

/**
 * A curated target capability a complete business OS should have.
 * `active` targets are covered by a real tool today; `planned` targets carry a
 * full build spec (mode, tier, what they compose from, UI surface, evaluator gate).
 */
export interface CapabilityTarget {
  label: string;
  status: TargetStatus;
  mode: CapabilityMode;
  /** Risk tier for planned targets; null for active (inherited from covering tool). */
  riskTier: RiskTier | null;
  /** App route the manual/assisted UI lives on; null for active targets. */
  uiSurface: string | null;
  /** Real existing tools a planned capability can be composed from. */
  requiredTools: string[];
  /** The deterministic gate a planned capability must pass before promotion; null for active. */
  evaluator: string | null;
  /** For active targets: the tool/capability that covers it. */
  coveredBy: string | null;
  why: string;
}

export interface CapabilityDomain {
  id: string;
  label: string;
  toolCount: number;
  capCount: number;
  modeCounts: Partial<Record<CapabilityMode, number>>;
  uiSurfaces: string[];
  targetsTotal: number;
  targetsActive: number;
  targetsPlanned: number;
  targets: CapabilityTarget[];
  tools: CapabilityTool[];
  capabilities: CapabilityCortexAction[];
}

export interface CapabilityModelSummary {
  domains: number;
  flowTools: number;
  cortexCapabilities: number;
  targetsTotal: number;
  targetsActive: number;
  targetsPlanned: number;
  /** Executable-today coverage: active / total. */
  activeCoveragePct: number;
  /** Always 100 — every target is declared in the model. */
  declaredCoveragePct: number;
  modeCounts: Partial<Record<CapabilityMode, number>>;
}

export interface CapabilityModel {
  domains: CapabilityDomain[];
  summary: CapabilityModelSummary;
}

/** A single scored hit from a coverage query. */
export interface CoverageMatch {
  domainId: string;
  domainLabel: string;
  kind: 'tool' | 'capability' | 'target';
  name: string;
  mode: CapabilityMode;
  status?: TargetStatus;
  score: number;
}

/**
 * Heuristic coverage answer for a goal. v0 uses keyword overlap only — the M2
 * capability resolver replaces this with embedding retrieval + LLM reranking.
 * There is deliberately no single "you can do X%" number: that requires
 * decomposing the goal into required capabilities, which is M2 work.
 */
export interface CoverageResult {
  goal: string;
  method: 'keyword-overlap-v0';
  matchCount: number;
  matched: CoverageMatch[];
  domainsTouched: Array<{ domainId: string; domainLabel: string; matches: number }>;
  modeMix: Partial<Record<CapabilityMode, number>>;
  /** Planned (not-yet-built) capabilities relevant to the goal — likely blockers. */
  relevantPlanned: Array<{ domainLabel: string; capability: string; mode: CapabilityMode }>;
  note: string;
}
