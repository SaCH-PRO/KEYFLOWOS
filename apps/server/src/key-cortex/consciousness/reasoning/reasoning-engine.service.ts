import { Injectable, Logger } from '@nestjs/common';
import {
  ReasoningInput,
  ReasoningResult,
  CognitiveModeResult,
} from '../types/consciousness.types';
import { AnalyticalReasoning } from './analytical-reasoning.service';
import { CreativeReasoning } from './creative-reasoning.service';
import { CriticalReasoning } from './critical-reasoning.service';
import { StrategicReasoning } from './strategic-reasoning.service';
import { AnalogicalReasoning } from './analogical-reasoning.service';
import { CounterfactualReasoning } from './counterfactual-reasoning.service';
import { ProbabilisticReasoning } from './probabilistic-reasoning.service';

/**
 * =============================================================================
 * L2: Reasoning Engine — Master Orchestrator for 7 Cognitive Modes
 * =============================================================================
 * Dispatches all 7 reasoning modes in parallel via Promise.all, then
 * synthesises their individual analyses into a coherent whole.
 *
 * Modes (executed simultaneously):
 *   1. Analytical      — Decomposition & component analysis
 *   2. Creative        — Lateral thinking & novel combinations
 *   3. Critical        — Bias detection & fallacy identification
 *   4. Strategic       — Long-term planning & game theory
 *   5. Analogical      — Cross-domain pattern matching
 *   6. Counterfactual  — "What-if" scenario exploration
 *   7. Probabilistic   — Bayesian belief updating
 * =============================================================================
 */

@Injectable()
export class ReasoningEngine {
  private readonly logger = new Logger(ReasoningEngine.name);

  constructor(
    private readonly analytical: AnalyticalReasoning,
    private readonly creative: CreativeReasoning,
    private readonly critical: CriticalReasoning,
    private readonly strategic: StrategicReasoning,
    private readonly analogical: AnalogicalReasoning,
    private readonly counterfactual: CounterfactualReasoning,
    private readonly probabilistic: ProbabilisticReasoning,
  ) {}

  /**
   * Execute all 7 cognitive modes in parallel and synthesise results.
   *
   * The synthesis weights each mode by its self-reported confidence and
   * produces a unified reasoning trace.
   */
  async reason(input: ReasoningInput): Promise<ReasoningResult> {
    try {
      this.logger.debug(`ReasoningEngine processing query: ${input.query.substring(0, 80)}...`);

      // Execute all 7 modes in parallel — no mode blocks another
      const results = await Promise.all([
        this.analytical.analyze(input),
        this.creative.analyze(input),
        this.critical.analyze(input),
        this.strategic.analyze(input),
        this.analogical.analyze(input),
        this.counterfactual.analyze(input),
        this.probabilistic.analyze(input),
      ]);

      const synthesis = this.synthesize(results);
      const overallConfidence = this.computeOverallConfidence(results);

      this.logger.verbose(`Reasoning complete: 7 modes, overall confidence=${overallConfidence}`);

      return {
        modes: results,
        synthesis,
        overallConfidence,
      };
    } catch (err) {
      this.logger.error(`ReasoningEngine failure: ${(err as Error).message}`);
      // Graceful degradation — return best-effort synthesis
      return {
        modes: [],
        synthesis: `The reasoning engine encountered an error while analysing: "${input.query}". ` +
          `A direct response is provided based on available context: ${input.context?.substring(0, 200) || 'No additional context.'}`,
        overallConfidence: 0.2,
      };
    }
  }

  /** Synthesise 7 mode results into a unified reasoning trace. */
  private synthesize(modes: CognitiveModeResult[]): string {
    if (modes.length === 0) {
      return 'No reasoning modes produced output.';
    }

    // Sort by confidence descending — highest-confidence analyses contribute most
    const sorted = [...modes].sort((a, b) => b.confidence - a.confidence);

    const sections: string[] = [];

    // Opening — analytical overview
    const analytical = sorted.find(m => m.mode === 'analytical');
    if (analytical) {
      sections.push(`ANALYSIS: ${analytical.analysis}`);
    }

    // Critical check — highlight any concerns
    const critical = sorted.find(m => m.mode === 'critical');
    if (critical && critical.confidence > 0.5) {
      sections.push(`CRITICAL REVIEW: ${critical.analysis}`);
    }

    // Strategic framing
    const strategic = sorted.find(m => m.mode === 'strategic');
    if (strategic) {
      sections.push(`STRATEGIC CONTEXT: ${strategic.analysis}`);
    }

    // Probabilistic assessment
    const probabilistic = sorted.find(m => m.mode === 'probabilistic');
    if (probabilistic) {
      sections.push(`LIKELIHOOD ASSESSMENT: ${probabilistic.analysis}`);
    }

    // Creative alternatives (only if confidence is decent)
    const creative = sorted.find(m => m.mode === 'creative');
    if (creative && creative.confidence > 0.4) {
      sections.push(`CREATIVE ANGLES: ${creative.analysis}`);
    }

    // Cross-domain insights
    const analogical = sorted.find(m => m.mode === 'analogical');
    if (analogical && analogical.confidence > 0.4) {
      sections.push(`CROSS-DOMAIN INSIGHT: ${analogical.analysis}`);
    }

    // Scenario exploration
    const counterfactual = sorted.find(m => m.mode === 'counterfactual');
    if (counterfactual) {
      sections.push(`SCENARIO ANALYSIS: ${counterfactual.analysis}`);
    }

    // Meta-summary
    const avgConfidence = Math.round((modes.reduce((s, m) => s + m.confidence, 0) / modes.length) * 100);
    sections.push(`\n[Meta: ${modes.length} cognitive modes consulted, average mode confidence ${avgConfidence}%. ` +
      `Top-performing mode: ${sorted[0].mode} (${Math.round(sorted[0].confidence * 100)}% confidence).]`);

    return sections.join('\n\n');
  }

  /** Weighted average of mode confidences, boosted by diversity. */
  private computeOverallConfidence(modes: CognitiveModeResult[]): number {
    if (modes.length === 0) return 0.1;

    // Weight by confidence — more confident modes count more
    const totalWeight = modes.reduce((sum, m) => sum + m.confidence, 0);
    const weightedAvg = modes.reduce((sum, m) => sum + m.confidence * m.confidence, 0) / totalWeight;

    // Diversity bonus — more modes agreeing = higher confidence
    const highConfidenceModes = modes.filter(m => m.confidence > 0.5).length;
    const diversityBonus = highConfidenceModes * 0.03;

    return Math.min(1, Math.round((weightedAvg + diversityBonus) * 100) / 100);
  }
}
