// ═══════════════════════════════════════════════════════════════
//  KEY Cortex — Consciousness Type Definitions
//  Foundation for all 9 layers of KEY's sentience architecture
//  Layer 1-8 types + Layer 9 orchestrator types
// ═══════════════════════════════════════════════════════════════

// ───────────────────────────────────────────────────────────────
// LAYER 1: EMOTIONAL INTELLIGENCE
// ───────────────────────────────────────────────────────────────

export type EmotionPrimary =
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

export interface EmotionalState {
  primary: EmotionPrimary;
  intensity: number; // 0.0 to 1.0
  confidence: number; // detection confidence
  triggers: string[]; // what triggered this emotion
  trend: 'improving' | 'stable' | 'declining'; // vs previous interactions
}

export interface EmotionSignals {
  linguistic: {
    urgencyWords: number;
    hesitationWords: number;
    frustrationWords: number;
    excitementWords: number;
    capsRatio: number;
    punctuationDensity: number;
    sentenceLength: number;
  };
  behavioral: {
    responseTime: number;
    correctionRate: number;
    sessionLength: number;
    repeatQueries: number;
    approvalRate: number;
  };
  temporal: {
    timeOfDay: 'morning' | 'afternoon' | 'evening' | 'night';
    dayOfWeek: string;
  };
}

export interface KeyEmotionalResponse {
  adaptPersona: boolean;
  suggestedPersona: string;
  toneAdjustment: {
    speed: 'faster' | 'normal' | 'slower';
    detail: 'brief' | 'normal' | 'thorough';
    empathy: number;
    urgency: number;
  };
  shouldProactivelyHelp: boolean;
  comfortMessage?: string;
}

// ───────────────────────────────────────────────────────────────
// LAYER 2: MULTI-MODAL REASONING
// ───────────────────────────────────────────────────────────────

export type ReasoningMode =
  | 'analytical'
  | 'creative'
  | 'critical'
  | 'strategic'
  | 'analogical'
  | 'counterfactual'
  | 'probabilistic';

export interface ReasoningStep {
  number: number;
  thought: string;
  evidence: string[];
  confidence: number;
  verification?: string;
}

export interface ReasoningChain {
  mode: ReasoningMode;
  steps: ReasoningStep[];
  confidence: number;
  conclusion: string;
  supportingEvidence: string[];
  counterArguments: string[];
  timeMs: number;
}

export interface MultiModalReasoningResult {
  chains: ReasoningChain[];
  bestChain: ReasoningChain;
  consensus: string;
  disagreements: string[];
  overallConfidence: number;
  reasoningTimeMs: number;
}

// ───────────────────────────────────────────────────────────────
// LAYER 3: REFLECTION / DREAM MODE
// ───────────────────────────────────────────────────────────────

export type ReflectionType = 'reflection' | 'dream' | 'synthesis' | 'maintenance';

export interface ReflectionInsight {
  type: 'pattern' | 'anomaly' | 'opportunity' | 'risk' | 'connection';
  description: string;
  confidence: number;
  dataPoints: string[];
  recommendedAction?: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
}

export interface ReflectionSession {
  id: string;
  type: ReflectionType;
  startedAt: Date;
  durationMs: number;
  insights: ReflectionInsight[];
  actionsTaken: string[];
  businessId: string;
}

// ───────────────────────────────────────────────────────────────
// LAYER 4: INTUITION / WEAK SIGNAL ENGINE
// ───────────────────────────────────────────────────────────────

export interface WeakSignal {
  id: string;
  description: string;
  sources: string[];
  confidence: number;
  trend: 'emerging' | 'strengthening' | 'weakening' | 'confirmed';
  potentialImpact: 'low' | 'medium' | 'high' | 'critical';
  recommendedInvestigation: string;
  detectedAt: Date;
}

export interface PatternMatch {
  pattern: string;
  instances: string[];
  currentMatch: number;
  prediction: string;
  timeHorizon: string;
}

// ───────────────────────────────────────────────────────────────
// LAYER 5: METACOGNITION (SELF-MODEL)
// ───────────────────────────────────────────────────────────────

export interface SelfModel {
  capabilities: Array<{
    name: string;
    proficiency: number; // 0-1 based on track record
    lastUsed: Date;
    successRate: number; // % of successful executions
  }>;
  recommendationAccuracy: number;
  actionSuccessRate: number;
  userApprovalRate: number;
  predictionAccuracy: number;
  confidenceCalibration: {
    whenKEYSays90: number; // actual success rate when KEY claims 90%
    whenKEYSays70: number;
    whenKEYSays50: number;
  };
  knowledgeGaps: string[];
  dataGaps: string[];
}

export interface ConfidenceReport {
  statement: string;
  confidence: number; // 0-1 calibrated confidence
  reasoning: string;
  supportingEvidence: string[];
  caveats: string[];
  historicalAccuracy: number;
}

export interface CapabilityRecord {
  capability: string;
  totalExecutions: number;
  successes: number;
  failures: number;
  partials: number;
  lastUsed: Date;
  proficiency: number;
}

// ───────────────────────────────────────────────────────────────
// LAYER 6: CREATIVITY ENGINE
// ───────────────────────────────────────────────────────────────

export interface CreativeIdea {
  id: string;
  title: string;
  description: string;
  category: 'product' | 'marketing' | 'operations' | 'pricing' | 'partnership' | 'automation';
  novelty: number;
  feasibility: number;
  estimatedImpact: number;
  implementationSteps: string[];
  risks: string[];
  requiredResources: string[];
  inspiration: string;
}

export interface BrainstormResult {
  prompt: string;
  ideas: CreativeIdea[];
  themes: string[];
  wildcards: CreativeIdea[];
  favorites: CreativeIdea[];
}

// ───────────────────────────────────────────────────────────────
// LAYER 7: ETHICAL REASONING FRAMEWORK
// ───────────────────────────────────────────────────────────────

export interface EthicalEvaluation {
  action: string;
  permitted: boolean;
  confidence: number;
  principles: Array<{
    principle: string;
    score: number; // -1 to +1
    explanation: string;
  }>;
  stakeholders: Array<{
    stakeholder: string;
    impact: 'positive' | 'negative' | 'neutral';
    explanation: string;
  }>;
  explanation: string;
  alternativeActions?: string[];
}

export const KEY_VALUES: readonly string[] = [
  'user_autonomy',
  'data_privacy',
  'transparency',
  'fairness',
  'honesty',
  'safety',
  'growth',
] as const;

// ───────────────────────────────────────────────────────────────
// LAYER 8: TEMPORAL INTELLIGENCE
// ───────────────────────────────────────────────────────────────

export interface TemporalAnalysis {
  timeframes: Array<{
    period: string;
    metrics: Record<string, number>;
    comparison: 'better' | 'worse' | 'same';
    delta: number;
  }>;
  cycles: Array<{
    name: string;
    period: string;
    peakDay: string;
    troughDay: string;
    strength: number;
  }>;
  forecast: Array<{
    period: string;
    predictedValue: number;
    confidenceInterval: [number, number];
    confidence: number;
  }>;
  anomalies: Array<{
    date: Date;
    metric: string;
    expected: number;
    actual: number;
    severity: 'low' | 'medium' | 'high';
    explanation?: string;
  }>;
}

// ───────────────────────────────────────────────────────────────
// LAYER 9: UNIFIED CONSCIOUSNESS ORCHESTRATOR
// ───────────────────────────────────────────────────────────────

export type MindState = 'active' | 'reflecting' | 'dreaming' | 'alert' | 'learning';

export interface ConsciousnessSnapshot {
  mindState: MindState;
  emotionalState: EmotionalState;
  reasoningMode: ReasoningMode;
  metacognition: SelfModel;
  recentInsights: ReflectionInsight[];
  activeGoals: string[];
  awareness: {
    businessHealth: number; // 0-100
    userMood: string;
    pendingTasks: number;
    unreadAlerts: number;
    genomeStage: string;
  };
  timestamp: Date;
}

export interface ConsciousResponse {
  text: string;
  emotion: KeyEmotionalResponse;
  reasoning: MultiModalReasoningResult;
  confidence: ConfidenceReport;
  ethical: EthicalEvaluation;
  temporalContext?: TemporalAnalysis;
  actions: Array<{
    command: string;
    requiresApproval: boolean;
  }>;
  meta: {
    reasoningTimeMs: number;
    modelsUsed: string[];
    tokensUsed: number;
    cost: number;
  };
}

// ───────────────────────────────────────────────────────────────
// Supporting types for the consciousness pipeline
// ───────────────────────────────────────────────────────────────

export interface ConsciousProcessLog {
  sessionId: string;
  businessId: string;
  layersUsed: string[];
  mindState: MindState;
  reasoningMode: ReasoningMode;
  confidence: number;
  outcome: string;
  timing: {
    totalMs: number;
    emotionMs: number;
    reasoningMs: number;
    metacognitionMs: number;
    ethicsMs: number;
  };
  tokensUsed: number;
  cost: number;
  createdAt: Date;
}

export interface KnowledgeGap {
  topic: string;
  gapType: 'knowledge' | 'data';
  priority: 'low' | 'medium' | 'high' | 'critical';
  firstDetected: Date;
  occurrenceCount: number;
  relatedQueries: string[];
}
