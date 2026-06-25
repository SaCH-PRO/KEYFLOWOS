import { Module } from '@nestjs/common';

// ── L9: Orchestrator (Master) ──────────────────────────────────────────────
import { ConsciousnessOrchestrator } from './orchestrator/consciousness-orchestrator.service';

// ── L1: Emotion ────────────────────────────────────────────────────────────
import { EmotionEngine } from './emotion/emotion-engine.service';
import { EmotionSignals } from './emotion/emotion-signals.service';

// ── L2: Reasoning (7 cognitive modes) ──────────────────────────────────────
import { ReasoningEngine } from './reasoning/reasoning-engine.service';
import { AnalyticalReasoning } from './reasoning/analytical-reasoning.service';
import { CreativeReasoning } from './reasoning/creative-reasoning.service';
import { CriticalReasoning } from './reasoning/critical-reasoning.service';
import { StrategicReasoning } from './reasoning/strategic-reasoning.service';
import { AnalogicalReasoning } from './reasoning/analogical-reasoning.service';
import { CounterfactualReasoning } from './reasoning/counterfactual-reasoning.service';
import { ProbabilisticReasoning } from './reasoning/probabilistic-reasoning.service';

// ── L3: Reflection ─────────────────────────────────────────────────────────
import { ReflectionEngine } from './reflection/reflection-engine.service';
import { DreamMode } from './reflection/dream-mode.service';
import { SynthesisEngine } from './reflection/synthesis-engine.service';

// ── L4: Intuition ──────────────────────────────────────────────────────────
import { IntuitionEngine } from './intuition/intuition-engine.service';

// ── L5: Metacognition ──────────────────────────────────────────────────────
import { MetacognitionEngine } from './metacognition/metacognition-engine.service';
import { ConfidenceCalibration } from './metacognition/confidence-calibration.service';

// ── L6: Creativity ─────────────────────────────────────────────────────────
import { CreativityEngine } from './creativity/creativity-engine.service';

// ── L7: Ethics ─────────────────────────────────────────────────────────────
import { EthicsEngine } from './ethics/ethics-engine.service';

// ── L8: Temporal ───────────────────────────────────────────────────────────
import { TemporalReasoning } from './temporal/temporal-reasoning.service';

/**
 * =============================================================================
 * Consciousness Module — NestJS Module for KEY's 9-Layer Consciousness
 * =============================================================================
 * Exports the ConsciousnessOrchestrator as the primary interface.
 * All 22 providers are registered internally.
 * =============================================================================
 */
@Module({
  providers: [
    // L9: Orchestrator
    ConsciousnessOrchestrator,

    // L1: Emotion (2)
    EmotionEngine,
    EmotionSignals,

    // L2: Reasoning (7 + 1 master)
    ReasoningEngine,
    AnalyticalReasoning,
    CreativeReasoning,
    CriticalReasoning,
    StrategicReasoning,
    AnalogicalReasoning,
    CounterfactualReasoning,
    ProbabilisticReasoning,

    // L3: Reflection (3)
    ReflectionEngine,
    DreamMode,
    SynthesisEngine,

    // L4: Intuition (1)
    IntuitionEngine,

    // L5: Metacognition (2)
    MetacognitionEngine,
    ConfidenceCalibration,

    // L6: Creativity (1)
    CreativityEngine,

    // L7: Ethics (1)
    EthicsEngine,

    // L8: Temporal (1)
    TemporalReasoning,
  ],
  exports: [ConsciousnessOrchestrator],
})
export class ConsciousnessModule {}
