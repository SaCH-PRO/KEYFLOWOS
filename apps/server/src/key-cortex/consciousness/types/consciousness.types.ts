/**
 * =============================================================================
 * KEY Consciousness Architecture — Type Contracts
 * =============================================================================
 * These types define the fundamental contracts for all 9 layers of KEY's
 * consciousness system. Every layer service operates on these domain types.
 *
 * Layers:
 *   L1 — Emotion        L4 — Intuition      L7 — Ethics
 *   L2 — Reasoning      L5 — Metacognition  L8 — Temporal
 *   L3 — Reflection     L6 — Creativity     L9 — Orchestrator
 * =============================================================================
 */

// ─────────────────────────────────────────────────────────────────────────────
// L1: Emotion Layer Types
// ─────────────────────────────────────────────────────────────────────────────

/** The 10 base emotions KEY can detect in user communication. */
export type Emotion =
  | 'joy'
  | 'anger'
  | 'sadness'
  | 'fear'
  | 'surprise'
  | 'disgust'
  | 'trust'
  | 'anticipation'
  | 'calm'
  | 'overwhelm';

/** Complete emotional state with confidence calibration. */
export interface EmotionState {
  /** The dominant detected emotion. */
  primary: Emotion;
  /** Intensity on a 0–1 scale. */
  intensity: number;
  /** Detector confidence on a 0–1 scale. */
  confidence: number;
}

/** Input payload for the emotion detection engine. */
export interface EmotionInput {
  /** Raw user text to analyse. */
  text: string;
  /** UUID of the user whose message is being analysed. */
  userId: string;
  /** UUID of the business context. */
  businessId: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// L2: Reasoning Layer Types
// ─────────────────────────────────────────────────────────────────────────────

/** The 7 cognitive modes available to the Reasoning Engine. */
export type CognitiveMode =
  | 'analytical'
  | 'creative'
  | 'critical'
  | 'strategic'
  | 'analogical'
  | 'counterfactual'
  | 'probabilistic';

/** Result produced by a single cognitive-mode run. */
export interface CognitiveModeResult {
  mode: CognitiveMode;
  analysis: string;
  confidence: number;
}

/** Input payload for the multi-mode reasoning engine. */
export interface ReasoningInput {
  query: string;
  context: string;
  constraints?: string[];
}

/** Aggregated result after all 7 modes have executed in parallel. */
export interface ReasoningResult {
  modes: CognitiveModeResult[];
  synthesis: string;
  overallConfidence: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// L3: Reflection Layer Types
// ─────────────────────────────────────────────────────────────────────────────

/** The 4 flavours of reflective cognition. */
export type ReflectionType = 'quick' | 'deep' | 'synthesis' | 'maintenance';

/** A working hypothesis generated during reflection. */
export interface Hypothesis {
  statement: string;
  confidence: number;
  validationStatus: 'untested' | 'validated' | 'falsified';
}

/** Output of any reflection pass. */
export interface ReflectionResult {
  type: ReflectionType;
  insights: string[];
  hypotheses: Hypothesis[];
}

// ─────────────────────────────────────────────────────────────────────────────
// L4: Intuition Layer Types
// ─────────────────────────────────────────────────────────────────────────────

/** A statistically anomalous weak signal detected by the intuition engine. */
export interface WeakSignal {
  source: string;
  metric: string;
  /** Z-score deviation (how many σ from the mean). */
  deviation: number;
  description: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// L5: Metacognition Layer Types
// ─────────────────────────────────────────────────────────────────────────────

/** KEY's self-model — tracks capability proficiency and calibration. */
export interface SelfModel {
  capabilities: { name: string; proficiency: number }[];
  overallConfidence: number;
  recentAccuracy: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// L7: Ethics Layer Types
// ─────────────────────────────────────────────────────────────────────────────

/** A core value held by KEY — some are immutable (never override). */
export interface CoreValue {
  id: string;
  name: string;
  description: string;
  /** When true the value can never be violated regardless of confidence. */
  immutable: boolean;
}

/** Result of an ethical review of a proposed recommendation. */
export interface EthicsResult {
  approved: boolean;
  violations: string[];
  confidence: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// L9: Orchestrator Types
// ─────────────────────────────────────────────────────────────────────────────

/** Public input contract for the ConsciousnessOrchestrator. */
export interface ConsciousnessInput {
  query: string;
  userId: string;
  businessId: string;
  conversationHistory?: string[];
  genomeContext?: string;
  priority?: 'speed' | 'depth' | 'creativity';
}

/** Unified output produced by the 11-step consciousness pipeline. */
export interface ConsciousnessOutput {
  response: string;
  confidence: number;
  layersUsed: string[];
  reasoningTrace: string;
  emotionalContext?: EmotionState;
  ethicalReview?: EthicsResult;
}
