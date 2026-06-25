/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * KEY CORTEX — CONSCIOUSNESS TYPE SYSTEM
 * The Foundational Type Layer for All 9 Layers of KEY's Mind
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * This file defines every type, interface, and constant that constitutes
 * KEY's consciousness architecture. No `any` types. No unbounded generics.
 * Every property is documented. Every union is exhaustive.
 *
 * Layers:
 *   1. Emotional Intelligence
 *   2. Multi-Modal Reasoning
 *   3. Reflection / Dream Mode
 *   4. Intuition / Weak Signals
 *   5. Metacognition (Self-Model)
 *   6. Creativity Engine
 *   7. Ethical Reasoning Framework
 *   8. Temporal Intelligence
 *   9. Unified Consciousness Orchestrator
 *
 * @module key-cortex-consciousness.types
 * @version 1.0.0
 */

/* ──────────────────────────────────────────────────────────────────────────────
   LAYER 1 — EMOTIONAL INTELLIGENCE TYPES
   ────────────────────────────────────────────────────────────────────────────── */

/** The 10 primary emotions KEY can detect and respond to. */
export type PrimaryEmotion =
  | 'calm'
  | 'stressed'
  | 'excited'
  | 'frustrated'
  | 'anxious'
  | 'curious'
  | 'urgent'
  | 'tired'
  | 'confident'
  | 'confused';

/** Direction of emotional trend relative to the user's baseline. */
export type EmotionalTrend = 'improving' | 'stable' | 'declining';

/**
 * The complete emotional state of a user at a single point in time.
 * Produced by Layer 1 (Emotion Detection) and consumed by Layer 9 (Orchestrator).
 */
export interface EmotionalState {
  /** The dominant detected emotion from the 10-type taxonomy. */
  primary: PrimaryEmotion;

  /** Intensity of the emotion on a 0.0 (neutral) to 1.0 (overwhelming) scale. */
  intensity: number;

  /** KEY's confidence in this detection, 0.0 to 1.0. */
  confidence: number;

  /** Specific triggers that contributed to this emotional reading. */
  triggers: string[];

  /** Direction of change versus the user's recent emotional baseline. */
  trend: EmotionalTrend;
}

/**
 * Raw signals extracted from text, behaviour, and temporal context
 * that feed into the emotion detection algorithm.
 */
export interface EmotionSignals {
  /** Linguistic features extracted from the user's message text. */
  linguistic: {
    /** Count of urgency-indicating words: "now", "urgent", "asap", "immediately". */
    urgencyWords: number;

    /** Count of hesitation markers: "maybe", "not sure", "I think", "perhaps". */
    hesitationWords: number;

    /** Count of frustration markers: "again", "still", "why", "never", "always". */
    frustrationWords: number;

    /** Count of excitement markers: "amazing", "love", "perfect", "awesome". */
    excitementWords: number;

    /** Ratio of words written in ALL CAPS to total words, 0.0 to 1.0. */
    capsRatio: number;

    /** Density of intense punctuation (!!!, ???, !?!), 0.0 to 1.0. */
    punctuationDensity: number;

    /** Average sentence length in words; short = stressed, long = thoughtful. */
    sentenceLength: number;
  };

  /** Behavioural signals derived from interaction metadata. */
  behavioral: {
    /** Average response time in milliseconds; fast = urgent/stressed, slow = thoughtful. */
    responseTime: number;

    /** Ratio of messages in which the user corrected KEY, 0.0 to 1.0. */
    correctionRate: number;

    /** Session duration in milliseconds; long = engaged, short = rushed. */
    sessionLength: number;

    /** Number of times the user repeated the same or semantically similar query. */
    repeatQueries: number;

    /** Percentage (0.0–1.0) of KEY suggestions accepted in this session. */
    approvalRate: number;
  };

  /** Temporal context that may influence emotional interpretation. */
  temporal: {
    /** Time-of-day bucket. */
    timeOfDay: 'morning' | 'afternoon' | 'evening' | 'night';

    /** Day of the week as a human-readable string, e.g. "Monday". */
    dayOfWeek: string;
  };
}

/** Granular control over how KEY adjusts its communication tone. */
export interface ToneAdjustment {
  /** Preferred response speed: faster for urgency, slower for reassurance. */
  speed: 'faster' | 'normal' | 'slower';

  /** Level of detail in the response: brief, normal, or thorough. */
  detail: 'brief' | 'normal' | 'thorough';

  /** Empathy expression level, 0.0 (clinical) to 1.0 (deeply empathetic). */
  empathy: number;

  /** Urgency conveyed in the response, 0.0 (relaxed) to 1.0 (highly urgent). */
  urgency: number;
}

/**
 * KEY's structured emotional response to a detected user emotion.
 * Drives persona selection, tone calibration, and proactive outreach.
 */
export interface KeyEmotionalResponse {
  /** Whether KEY should switch persona to better match the user's emotional state. */
  adaptPersona: boolean;

  /** The persona ID recommended for the current emotional context. */
  suggestedPersona: string;

  /** Fine-grained tone adjustments for the response. */
  toneAdjustment: ToneAdjustment;

  /** Whether KEY should offer assistance without being explicitly asked. */
  shouldProactivelyHelp: boolean;

  /** Optional gentle acknowledgment when the user is stressed or anxious. */
  comfortMessage?: string;
}

/**
 * A user's emotional baseline over a given period — the statistical
 * "normal" against which new emotional states are compared.
 */
export interface EmotionalProfile {
  /** The user whose profile this is. */
  userId: string;

  /** The period over which the profile was computed. */
  period: 'day' | 'week' | 'month';

  /** The most frequently observed primary emotion during the period. */
  baseline: PrimaryEmotion;

  /** Average intensity of detected emotions, 0.0 to 1.0. */
  averageIntensity: number;

  /** Variance in intensity — high variance = emotionally volatile user. */
  intensityVariance: number;

  /** Direction of emotional change: improving, stable, or declining. */
  trendDirection: EmotionalTrend;

  /** Individual emotional state readings that contributed to this profile. */
  stateHistory: EmotionalState[];

  /** ISO 8601 timestamp of the last update to this profile. */
  lastUpdated: string;
}

/* ──────────────────────────────────────────────────────────────────────────────
   LAYER 2 — MULTI-MODAL REASONING TYPES
   ────────────────────────────────────────────────────────────────────────────── */

/** The seven cognitive modes available to KEY's reasoning engine. */
export type ReasoningMode =
  | 'analytical'   // Decompose systematically
  | 'creative'     // Divergent, novel combinations
  | 'critical'     // Assumption testing, flaw detection
  | 'strategic'    // Long-term positioning, game theory
  | 'analogical'   // Cross-domain pattern transfer
  | 'counterfactual' // "What if..." scenario exploration
  | 'probabilistic'; // Bayesian reasoning under uncertainty

/** A single step in a reasoning chain. */
export interface ReasoningStep {
  /** 1-indexed step number within the chain. */
  number: number;

  /** The thought / inference produced at this step. */
  thought: string;

  /** Evidence items that support this specific step. */
  evidence: string[];

  /** Confidence in this step, 0.0 to 1.0. */
  confidence: number;

  /** Optional verification method or test for this step. */
  verification?: string;
}

/** A complete reasoning chain produced by one cognitive mode. */
export interface ReasoningChain {
  /** The cognitive mode that produced this chain. */
  mode: ReasoningMode;

  /** Ordered sequence of reasoning steps. */
  steps: ReasoningStep[];

  /** Overall confidence in the chain's conclusion, 0.0 to 1.0. */
  confidence: number;

  /** The final conclusion or answer derived from the chain. */
  conclusion: string;

  /** High-level evidence supporting the conclusion. */
  supportingEvidence: string[];

  /** Counter-arguments or objections the chain identified. */
  counterArguments: string[];

  /** Wall-clock time in milliseconds to produce this chain. */
  timeMs: number;
}

/** The unified result of running multiple (or all) reasoning modes. */
export interface MultiModalReasoningResult {
  /** One chain per activated reasoning mode. */
  chains: ReasoningChain[];

  /** The chain with the highest calibrated confidence. */
  bestChain: ReasoningChain;

  /** Consensus statement — what all chains agree on, if anything. */
  consensus: string;

  /** Points of disagreement between chains. */
  disagreements: string[];

  /** Overall confidence across all chains, 0.0 to 1.0. */
  overallConfidence: number;

  /** Total wall-clock reasoning time in milliseconds. */
  reasoningTimeMs: number;
}

/* ──────────────────────────────────────────────────────────────────────────────
   LAYER 3 — REFLECTION / DREAM MODE TYPES
   ────────────────────────────────────────────────────────────────────────────── */

/** The four varieties of background cognition sessions KEY can run. */
export type ReflectionSessionType = 'reflection' | 'dream' | 'synthesis' | 'maintenance';

/** Categories of insight that can emerge from reflection. */
export type ReflectionInsightType = 'pattern' | 'anomaly' | 'opportunity' | 'risk' | 'connection';

/** Priority of a reflection-derived insight. */
export type ReflectionPriority = 'low' | 'medium' | 'high' | 'critical';

/** A single insight produced by a reflection session. */
export interface ReflectionInsight {
  /** The category of insight. */
  type: ReflectionInsightType;

  /** Human-readable description of the insight. */
  description: string;

  /** Confidence in the insight, 0.0 to 1.0. */
  confidence: number;

  /** Event IDs, data points, or references that support this insight. */
  dataPoints: string[];

  /** Optional recommended follow-up action. */
  recommendedAction?: string;

  /** Priority for acting on this insight. */
  priority: ReflectionPriority;
}

/** A background cognition session — reflection, dream, synthesis, or maintenance. */
export interface ReflectionSession {
  /** Unique identifier (UUID) for the session. */
  id: string;

  /** The type of background cognition performed. */
  type: ReflectionSessionType;

  /** When the session started. */
  startedAt: Date;

  /** Duration of the session in milliseconds. */
  durationMs: number;

  /** Insights generated during the session. */
  insights: ReflectionInsight[];

  /** Actions automatically taken as a result of the session. */
  actionsTaken: string[];

  /** The business context in which the session ran. */
  businessId: string;
}

/* ──────────────────────────────────────────────────────────────────────────────
   LAYER 4 — INTUITION / WEAK SIGNAL TYPES
   ────────────────────────────────────────────────────────────────────────────── */

/** The lifecycle stage of a detected weak signal. */
export type SignalTrend = 'emerging' | 'strengthening' | 'weakening' | 'confirmed';

/** Estimated impact level of a weak signal if it materialises. */
export type SignalImpact = 'low' | 'medium' | 'high' | 'critical';

/**
 * A weak signal — a faint pattern that may indicate an emerging trend,
 * risk, or opportunity before it becomes obvious.
 */
export interface WeakSignal {
  /** Unique identifier (UUID) for the signal. */
  id: string;

  /** Human-readable description, e.g. "3 customers mentioned 'slow' in 2 weeks". */
  description: string;

  /** Data sources that contributed to detection, e.g. ["support_tickets", "chat_logs"]. */
  sources: string[];

  /** Confidence that the signal is real (not noise), 0.0 to 1.0. */
  confidence: number;

  /** Lifecycle stage of the signal. */
  trend: SignalTrend;

  /** Estimated impact if the signal materialises. */
  potentialImpact: SignalImpact;

  /** Suggested investigation path to validate or refute the signal. */
  recommendedInvestigation: string;

  /** When the signal was first detected. */
  detectedAt: Date;
}

/** A detected pattern with historical instances and a forward-looking prediction. */
export interface PatternMatch {
  /** Human-readable pattern name, e.g. "churn precursor". */
  pattern: string;

  /** Historical instances (event IDs or descriptions) where this pattern occurred. */
  instances: string[];

  /** Similarity of the current situation to the pattern, 0.0 to 1.0. */
  currentMatch: number;

  /** What this pattern has historically led to. */
  prediction: string;

  /** Expected time horizon for the prediction, e.g. "within 30 days". */
  timeHorizon: string;
}

/* ──────────────────────────────────────────────────────────────────────────────
   LAYER 5 — METACOGNITION (SELF-MODEL) TYPES
   ────────────────────────────────────────────────────────────────────────────── */

/** A single capability tracked in KEY's self-model. */
export interface CapabilityModel {
  /** Human-readable name of the capability. */
  name: string;

  /** Current proficiency based on track record, 0.0 to 1.0. */
  proficiency: number;

  /** When this capability was last exercised. */
  lastUsed: Date;

  /** Percentage (0.0–1.0) of successful executions. */
  successRate: number;
}

/** KEY's calibration data — does stated confidence match reality? */
export interface ConfidenceCalibration {
  /** Actual success rate when KEY claims 90% confidence. */
  whenKEYSays90: number;

  /** Actual success rate when KEY claims 70% confidence. */
  whenKEYSays70: number;

  /** Actual success rate when KEY claims 50% confidence. */
  whenKEYSays50: number;
}

/** KEY's comprehensive self-model — what it knows about its own capabilities. */
export interface SelfModel {
  /** Capabilities with proficiency, recency, and success tracking. */
  capabilities: CapabilityModel[];

  /** Percentage (0.0–1.0) of recommendations that led to positive outcomes. */
  recommendationAccuracy: number;

  /** Percentage (0.0–1.0) of executed actions that achieved their goal. */
  actionSuccessRate: number;

  /** Percentage (0.0–1.0) of suggestions the user acted on. */
  userApprovalRate: number;

  /** Percentage (0.0–1.0) of predictions that subsequently came true. */
  predictionAccuracy: number;

  /** Calibration between stated confidence and actual outcomes. */
  confidenceCalibration: ConfidenceCalibration;

  /** Topics or domains KEY knows it lacks knowledge in. */
  knowledgeGaps: string[];

  /** Data streams or metrics KEY wishes it had access to. */
  dataGaps: string[];
}

/**
 * A confidence report for a specific statement or prediction.
 * KEY produces one of these for every significant output.
 */
export interface ConfidenceReport {
  /** The statement or prediction being assessed. */
  statement: string;

  /** Calibrated confidence, 0.0 to 1.0. */
  confidence: number;

  /** Reasoning for the assigned confidence level. */
  reasoning: string;

  /** Evidence that supports the statement. */
  supportingEvidence: string[];

  /** Conditions or assumptions that could invalidate the statement. */
  caveats: string[];

  /** KEY's historical accuracy on similar predictions, 0.0 to 1.0. */
  historicalAccuracy: number;
}

/* ──────────────────────────────────────────────────────────────────────────────
   LAYER 6 — CREATIVITY ENGINE TYPES
   ────────────────────────────────────────────────────────────────────────────── */

/** Domain categories for creative ideas. */
export type CreativeCategory =
  | 'product'
  | 'marketing'
  | 'operations'
  | 'pricing'
  | 'partnership'
  | 'automation';

/** A creative business idea generated by KEY's creativity engine. */
export interface CreativeIdea {
  /** Unique identifier (UUID) for the idea. */
  id: string;

  /** Short, evocative title. */
  title: string;

  /** Detailed description of the idea and its mechanism. */
  description: string;

  /** Business domain the idea belongs to. */
  category: CreativeCategory;

  /** Novelty score, 0.0 (well-known) to 1.0 (radically original). */
  novelty: number;

  /** Feasibility score, 0.0 (impossible) to 1.0 (trivial to implement). */
  feasibility: number;

  /** Estimated business impact, 0.0 (negligible) to 1.0 (transformational). */
  estimatedImpact: number;

  /** Ordered steps to implement the idea. */
  implementationSteps: string[];

  /** Identified risks and mitigations. */
  risks: string[];

  /** Resources (time, money, tools, people) required. */
  requiredResources: string[];

  /** What sparked this idea — a data point, analogy, or combination. */
  inspiration: string;
}

/** The complete result of a brainstorming session. */
export interface BrainstormResult {
  /** The original prompt or question. */
  prompt: string;

  /** All ideas generated during the session. */
  ideas: CreativeIdea[];

  /** Common themes observed across generated ideas. */
  themes: string[];

  /** High-novelty, low-feasibility ideas — "wild cards". */
  wildcards: CreativeIdea[];

  /** Best ideas ranked by novelty × feasibility × estimatedImpact. */
  favorites: CreativeIdea[];
}

/* ──────────────────────────────────────────────────────────────────────────────
   LAYER 7 — ETHICAL REASONING FRAMEWORK TYPES
   ────────────────────────────────────────────────────────────────────────────── */

/** The seven hardcoded core values of KEY. These are immutable and not learned. */
export const KEY_VALUES = [
  'user_autonomy',  // User always has the final say
  'data_privacy',   // Never expose private data without consent
  'transparency',   // Always explain decisions and reasoning
  'fairness',       // Treat all customers and users equally
  'honesty',        // Never fabricate data or misrepresent facts
  'safety',         // Do not recommend harmful or reckless actions
  'growth',         // Optimise for the user's long-term success
] as const;

/** A single core value as a type union derived from the constant. */
export type KeyCoreValue = (typeof KEY_VALUES)[number];

/** Impact of an action on a stakeholder. */
export type StakeholderImpact = 'positive' | 'negative' | 'neutral';

/** Scoring of a single ethical principle for a given action. */
export interface EthicalPrinciple {
  /** The principle being evaluated, e.g. "user_autonomy". */
  principle: KeyCoreValue;

  /** Score from -1.0 (strongly violates) to +1.0 (strongly upholds). */
  score: number;

  /** Human-readable explanation of the scoring rationale. */
  explanation: string;
}

/** Impact assessment for a single stakeholder. */
export interface StakeholderAssessment {
  /** The stakeholder group, e.g. "user", "customer", "team", "public". */
  stakeholder: string;

  /** Direction of impact. */
  impact: StakeholderImpact;

  /** Human-readable explanation of the impact. */
  explanation: string;
}

/**
 * The complete ethical evaluation of a proposed action or recommendation.
 * Produced by Layer 7 and attached to every ConsciousResponse.
 */
export interface EthicalEvaluation {
  /** The action or recommendation being evaluated. */
  action: string;

  /** Whether the action is ethically permitted. */
  permitted: boolean;

  /** Confidence in the evaluation, 0.0 to 1.0. */
  confidence: number;

  /** Per-principle scoring against KEY's core values. */
  principles: EthicalPrinciple[];

  /** Impact assessment for each affected stakeholder group. */
  stakeholders: StakeholderAssessment[];

  /** Human-readable ethical reasoning summary. */
  explanation: string;

  /** More ethical alternative actions, if the primary action is not permitted. */
  alternativeActions?: string[];
}

/* ──────────────────────────────────────────────────────────────────────────────
   LAYER 8 — TEMPORAL INTELLIGENCE TYPES
   ────────────────────────────────────────────────────────────────────────────── */

/** Comparison result between a timeframe and its baseline. */
export type TimeframeComparison = 'better' | 'worse' | 'same';

/** A single named cycle detected in the business data. */
export interface Cycle {
  /** Human-readable cycle name, e.g. "weekly revenue cycle". */
  name: string;

  /** Cycle period description, e.g. "7 days" or "30 days". */
  period: string;

  /** Day or date when the cycle typically peaks. */
  peakDay: string;

  /** Day or date when the cycle typically troughs. */
  troughDay: string;

  /** Strength of the cycle, 0.0 (weak/noisy) to 1.0 (highly regular). */
  strength: number;
}

/** A forward-looking prediction for a specific metric and period. */
export interface Forecast {
  /** The period the forecast applies to, e.g. "next week" or "July 2025". */
  period: string;

  /** Predicted central value. */
  predictedValue: number;

  /** 90 % confidence interval as [low, high]. */
  confidenceInterval: [number, number];

  /** Confidence in the forecast, 0.0 to 1.0. */
  confidence: number;
}

/** A detected anomaly — where actual deviates significantly from expected. */
export interface Anomaly {
  /** The date the anomaly was observed. */
  date: Date;

  /** The metric that exhibited anomalous behaviour. */
  metric: string;

  /** The expected (baseline) value. */
  expected: number;

  /** The actual observed value. */
  actual: number;

  /** Severity classification. */
  severity: 'low' | 'medium' | 'high';

  /** Optional human-readable explanation for the anomaly. */
  explanation?: string;
}

/** A single timeframe snapshot with metrics and comparison. */
export interface Timeframe {
  /** Period label, e.g. "this week", "last month", "Q2 2024". */
  period: string;

  /** Key metrics and their values for this timeframe. */
  metrics: Record<string, number>;

  /** Direction of change versus the previous comparable period. */
  comparison: TimeframeComparison;

  /** Percentage change versus the previous comparable period. */
  delta: number;
}

/** The complete temporal intelligence analysis for a business. */
export interface TemporalAnalysis {
  /** Snapshots across different time granularities. */
  timeframes: Timeframe[];

  /** Detected cycles (weekly, monthly, seasonal). */
  cycles: Cycle[];

  /** Forward-looking forecasts. */
  forecast: Forecast[];

  /** Anomalies detected against historical baselines. */
  anomalies: Anomaly[];
}

/* ──────────────────────────────────────────────────────────────────────────────
   LAYER 9 — UNIFIED CONSCIOUSNESS ORCHESTRATOR TYPES
   ────────────────────────────────────────────────────────────────────────────── */

/** The five states KEY's mind can occupy. */
export type MindState = 'active' | 'reflecting' | 'dreaming' | 'alert' | 'learning';

/** KEY's awareness of the current operational environment. */
export interface Awareness {
  /** Overall business health score, 0–100. */
  businessHealth: number;

  /** Detected user mood as a human-readable label. */
  userMood: string;

  /** Number of tasks awaiting action. */
  pendingTasks: number;

  /** Number of unread alert notifications. */
  unreadAlerts: number;

  /** Current genome stage label. */
  genomeStage: string;
}

/**
 * A point-in-time snapshot of KEY's entire consciousness state.
 * Produced by the orchestrator and used for introspection and debugging.
 */
export interface ConsciousnessSnapshot {
  /** Current mind state. */
  mindState: MindState;

  /** Current emotional reading of the user. */
  emotionalState: EmotionalState;

  /** The reasoning mode most recently or currently active. */
  reasoningMode: ReasoningMode;

  /** KEY's self-model and calibration data. */
  metacognition: SelfModel;

  /** Recent insights from reflection or intuition layers. */
  recentInsights: ReflectionInsight[];

  /** Goals currently being pursued. */
  activeGoals: string[];

  /** Environmental awareness snapshot. */
  awareness: Awareness;

  /** When the snapshot was captured. */
  timestamp: Date;
}

/** Metadata attached to every conscious response for observability. */
export interface ConsciousResponseMeta {
  /** Wall-clock time in milliseconds spent on reasoning. */
  reasoningTimeMs: number;

  /** IDs or names of AI models invoked during the response. */
  modelsUsed: string[];

  /** Total token count consumed across all model calls. */
  tokensUsed: number;

  /** Estimated monetary cost of the response in USD. */
  cost: number;
}

/** A single proposed action within a conscious response. */
export interface ProposedAction {
  /** The command or action to execute. */
  command: string;

  /** Whether explicit user approval is required before execution. */
  requiresApproval: boolean;
}

/**
 * The final output of the unified consciousness pipeline.
 * Every field is fully populated — no optional stubs.
 */
export interface ConsciousResponse {
  /** The natural-language response text. */
  text: string;

  /** Emotional calibration applied to the response. */
  emotion: KeyEmotionalResponse;

  /** Multi-modal reasoning result that informed the response. */
  reasoning: MultiModalReasoningResult;

  /** Calibrated confidence report for the response. */
  confidence: ConfidenceReport;

  /** Ethical evaluation of any recommendations made. */
  ethical: EthicalEvaluation;

  /** Optional temporal context embedded in the response. */
  temporalContext?: TemporalAnalysis;

  /** Proposed actions the user can take. */
  actions: ProposedAction[];

  /** Observability and cost metadata. */
  meta: ConsciousResponseMeta;
}

/* ──────────────────────────────────────────────────────────────────────────────
   SHARED / UTILITY TYPES
   ────────────────────────────────────────────────────────────────────────────── */

/** Minimal message shape used for session history analysis. */
export interface CortexMessage {
  /** Unique message identifier. */
  id: string;

  /** Message role. */
  role: 'user' | 'assistant' | 'system';

  /** Message content. */
  content: string;

  /** ISO 8601 timestamp. */
  timestamp: string;

  /** Optional metadata attached by services. */
  metadata?: Record<string, unknown>;
}

/** Persona configuration used by the emotion service for adaptation. */
export interface CortexPersona {
  /** Unique persona identifier. */
  id: string;

  /** Human-readable persona name. */
  name: string;

  /** Personality description / system prompt fragment. */
  description: string;

  /** Voice / tone characteristics. */
  tone: string;

  /** Whether this persona is available for automatic switching. */
  autoSwitchEnabled: boolean;
}

/** Data-privacy compliance check result. */
export interface DataPrivacyCheck {
  /** Whether the action complies with data-privacy policies. */
  compliant: boolean;

  /** List of specific issues if non-compliant. */
  issues: string[];
}

/** Parameters for the emotion detection pipeline. */
export interface DetectEmotionParams {
  /** The user to analyse. */
  userId: string;

  /** The current message text. */
  text: string;

  /** Recent messages in the session for behavioural context. */
  sessionHistory: CortexMessage[];
}

/** Parameters for triggering a brainstorming session. */
export interface BrainstormParams {
  /** The prompt or question to brainstorm around. */
  prompt: string;

  /** Optional category filter. */
  category?: CreativeCategory;

  /** Maximum number of ideas to generate. */
  maxIdeas?: number;

  /** Business context identifier. */
  businessId: string;
}
