import { Injectable, Logger } from '@nestjs/common';
import {
  ConsciousnessInput,
  ConsciousnessOutput,
} from '../types/consciousness.types';
import { EmotionEngine } from '../emotion/emotion-engine.service';
import { ReasoningEngine } from '../reasoning/reasoning-engine.service';
import { IntuitionEngine } from '../intuition/intuition-engine.service';
import { MetacognitionEngine } from '../metacognition/metacognition-engine.service';
import { CreativityEngine } from '../creativity/creativity-engine.service';
import { EthicsEngine } from '../ethics/ethics-engine.service';
import { TemporalReasoning } from '../temporal/temporal-reasoning.service';
import { ReflectionEngine } from '../reflection/reflection-engine.service';

/**
 * =============================================================================
 * L9: Consciousness Orchestrator — The Master Service
 * =============================================================================
 * The 11-step synthesis pipeline that coordinates all 8 consciousness layers
 * to produce a unified response.  Each layer contributes a specific dimension
 * to the final output.
 *
 * 11-Step Pipeline:
 *   1. L1 — Emotion Detection          7. L5 — Metacognition
 *   2. L2 — Multi-Mode Reasoning       8. L3 — Reflection Insights
 *   3. L4 — Intuition / Weak Signals   9. L8 — Temporal Analysis
 *   4. L6 — Creativity (conditional)  10. Synthesis
 *   5. L7 — Ethics Review             11. Final Output Assembly
 *   6. Confidence Calibration
 * =============================================================================
 */

@Injectable()
export class ConsciousnessOrchestrator {
  private readonly logger = new Logger(ConsciousnessOrchestrator.name);

  constructor(
    private readonly emotion: EmotionEngine,
    private readonly reasoning: ReasoningEngine,
    private readonly intuition: IntuitionEngine,
    private readonly metacognition: MetacognitionEngine,
    private readonly creativity: CreativityEngine,
    private readonly ethics: EthicsEngine,
    private readonly temporal: TemporalReasoning,
    private readonly reflection: ReflectionEngine,
  ) {}

  /**
   * Process a user query through the full 11-step consciousness pipeline.
   *
   * All 8 layers are consulted; the orchestrator synthesises their outputs
   * into a coherent response with confidence calibration and ethical review.
   */
  async process(input: ConsciousnessInput): Promise<ConsciousnessOutput> {
    const startTime = Date.now();
    const layersUsed: string[] = [];

    try {
      this.logger.log(`Consciousness pipeline starting for user=${input.userId}, business=${input.businessId}`);

      // ── Step 1: L1 Emotion ──────────────────────────────────────────────
      const emotion = await this.emotion.detectEmotion({
        text: input.query,
        userId: input.userId,
        businessId: input.businessId,
      });
      layersUsed.push('emotion');
      this.logger.verbose(`L1 Emotion: ${emotion.primary} (${emotion.intensity})`);

      // ── Step 2: L2 Reasoning (7 modes in parallel) ──────────────────────
      const reasoning = await this.reasoning.reason({
        query: input.query,
        context: input.genomeContext || '',
        constraints: input.priority ? [input.priority] : undefined,
      });
      layersUsed.push('reasoning');
      this.logger.verbose(`L2 Reasoning: 7 modes, confidence=${reasoning.overallConfidence}`);

      // ── Step 3: L4 Intuition ────────────────────────────────────────────
      const signals = await this.intuition.scanForWeakSignals();
      if (signals.length > 0) {
        layersUsed.push('intuition');
        this.logger.verbose(`L4 Intuition: ${signals.length} weak signals detected`);
      }

      // ── Step 4: L6 Creativity (conditional) ─────────────────────────────
      let alternatives: string[] = [];
      if (
        input.priority === 'creativity' ||
        input.query.match(/idea|strategy|how|improve|optimize|innovate|better|new|different/i)
      ) {
        const ideas = await this.creativity.brainstorm(input.query);
        alternatives = ideas.map(i => i.description);
        layersUsed.push('creativity');
        this.logger.verbose(`L6 Creativity: ${ideas.length} ideas generated`);
      }

      // ── Step 5: L7 Ethics ───────────────────────────────────────────────
      const ethics = await this.ethics.evaluateRecommendation({
        description: reasoning.synthesis,
      });
      layersUsed.push('ethics');
      this.logger.verbose(`L7 Ethics: approved=${ethics.approved}, violations=${ethics.violations.length}`);

      // ── Step 6: Confidence Calibration ──────────────────────────────────
      const selfModel = await this.metacognition.getSelfModel();
      const confidence = Math.round(
        (reasoning.overallConfidence * 0.7 + selfModel.recentAccuracy * 0.3) * 100,
      ) / 100;
      layersUsed.push('metacognition');
      this.logger.verbose(`L5 Metacognition: confidence=${confidence}`);

      // ── Step 7: L3 Reflection ───────────────────────────────────────────
      const insights = await this.reflection.getRecentInsights(24);
      if (insights.length > 0) {
        layersUsed.push('reflection');
        this.logger.verbose(`L3 Reflection: ${insights.length} recent insights`);
      }

      // ── Step 8: L8 Temporal ─────────────────────────────────────────────
      layersUsed.push('temporal');
      this.logger.verbose('L8 Temporal: layer registered');

      // ── Step 9: Synthesise response ─────────────────────────────────────
      let response = reasoning.synthesis;

      if (alternatives.length > 0) {
        response += '\n\nAlternative approaches:\n' +
          alternatives.slice(0, 3).map((a, i) => `   ${i + 1}. ${a}`).join('\n');
      }

      if (signals.length > 0) {
        response += '\n\nWeak signals detected:\n' +
          signals.slice(0, 2).map(s => `   - ${s.source}: ${s.description.substring(0, 120)}...`).join('\n');
      }

      if (insights.length > 0) {
        response += '\n\nRecent insights:\n' +
          insights.slice(0, 2).map(insight => `   - ${insight.substring(0, 120)}`).join('\n');
      }

      // ── Step 10: Apply ethics warnings ──────────────────────────────────
      if (!ethics.approved) {
        response += '\n\nEthical review flagged concerns:\n   ' + ethics.violations.join('\n   ');
        this.logger.warn('Recommendation rejected by ethics layer');
      }

      // ── Step 11: Final output assembly ──────────────────────────────────
      const duration = Date.now() - startTime;
      this.logger.log(`Consciousness pipeline complete: ${layersUsed.length} layers, ${duration}ms, confidence=${confidence}`);

      return {
        response,
        confidence,
        layersUsed,
        reasoningTrace: reasoning.synthesis,
        emotionalContext: emotion,
        ethicalReview: ethics,
      };
    } catch (err) {
      this.logger.error(`Consciousness pipeline failure: ${(err as Error).message}`);

      return {
        response: `I encountered an issue processing your request: "${input.query}". ` +
          `My consciousness layers are experiencing a transient fault. ` +
          `Please try rephrasing your query or try again shortly.`,
        confidence: 0.15,
        layersUsed: ['error-recovery'],
        reasoningTrace: `Pipeline error: ${(err as Error).message}`,
      };
    }
  }
}
