/**
 * =============================================================================
 * KEY Cortex — Public Type Exports
 * =============================================================================
 * Re-exports consciousness types plus cortex-layer-specific types for
 * consumers of the key-cortex module.
 * =============================================================================
 */

// ── Re-export all consciousness types ───────────────────────────────────────
export {
  Emotion,
  EmotionState,
  EmotionInput,
  CognitiveMode,
  CognitiveModeResult,
  ReasoningInput,
  ReasoningResult,
  ReflectionType,
  Hypothesis,
  ReflectionResult,
  WeakSignal,
  SelfModel,
  CoreValue,
  EthicsResult,
  ConsciousnessInput,
  ConsciousnessOutput,
} from '../consciousness/types/consciousness.types';

// ── Conversation types ──────────────────────────────────────────────────────
export {
  ConversationSession,
  ConversationMessage,
} from '../services/key-cortex-conversation.service';

// ── Action types ────────────────────────────────────────────────────────────
export {
  ActionType,
  ActionRequest,
  ActionResult,
} from '../services/key-cortex-action.service';

// ── Model gateway types ─────────────────────────────────────────────────────
export {
  ModelProvider,
  ModelRequest,
  ModelResponse,
} from '../services/model-gateway.service';

// ── Cortex-level types ──────────────────────────────────────────────────────

/** Input for a complete KEY interaction. */
export interface CortexInput {
  query: string;
  userId: string;
  businessId: string;
  sessionId?: string;
  conversationHistory?: string[];
  priority?: 'speed' | 'depth' | 'creativity';
}

/** Complete KEY response with all metadata. */
export interface CortexOutput {
  response: string;
  confidence: number;
  layersUsed: string[];
  emotionalContext?: {
    primary: string;
    intensity: number;
  };
  ethicalApproved: boolean;
  latencyMs: number;
}

/** Health status for the cortex module. */
export interface CortexHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  module: string;
  layers: number;
  activeProviders: string[];
  uptimeMs: number;
  lastError?: string;
}

/** Configuration for the key-cortex module. */
export interface CortexConfig {
  /** Maximum number of ReAct iterations. */
  maxReasoningIterations: number;
  /** Context window size in messages. */
  contextWindowSize: number;
  /** Session TTL in minutes. */
  sessionTtlMinutes: number;
  /** Default AI provider. */
  defaultProvider: ModelProvider;
  /** Enable dream mode processing. */
  dreamModeEnabled: boolean;
  /** Enable ethics review on all outputs. */
  ethicsReviewEnabled: boolean;
}
