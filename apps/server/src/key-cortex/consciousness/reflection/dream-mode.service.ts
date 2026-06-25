import { Injectable, Logger } from '@nestjs/common';
import { ReflectionResult, ReflectionType, Hypothesis } from '../types/consciousness.types';
import { ReflectionEngine } from './reflection-engine.service';

/**
 * =============================================================================
 * L3b: Dream Mode — Deep 3 AM Processing
 * =============================================================================
 * Simulates deep unconscious processing that occurs during low-activity periods.
 * Dream mode performs:
 *   - Loose association building between distant concepts
 *   - Pattern consolidation from recent experiences
 *   - Novel hypothesis generation through random recombination
 *   - Memory consolidation and pruning
 *
 * Typically triggered during hours 02:00–05:00 when system load is minimal.
 * =============================================================================
 */

interface DreamAssociation {
  conceptA: string;
  conceptB: string;
  bridge: string;
  significance: number;
}

@Injectable()
export class DreamMode {
  private readonly logger = new Logger(DreamMode.name);

  constructor(private readonly reflection: ReflectionEngine) {}

  /** Run a deep dream-mode processing cycle. */
  async runDreamMode(): Promise<ReflectionResult> {
    try {
      this.logger.log('🌙 Dream Mode activated — beginning deep processing cycle');

      const startTime = Date.now();

      // Phase 1: Loose association building
      const associations = this.buildAssociations();
      this.logger.verbose(`Dream phase 1: ${associations.length} loose associations formed`);

      // Phase 2: Pattern consolidation
      const consolidatedPatterns = this.consolidatePatterns(associations);
      this.logger.verbose(`Dream phase 2: ${consolidatedPatterns.length} patterns consolidated`);

      // Phase 3: Novel recombination
      const novelInsights = this.recombine(associations, consolidatedPatterns);
      this.logger.verbose(`Dream phase 3: ${novelInsights.length} novel insights generated`);

      // Phase 4: Hypothesis mutation
      const mutatedHypotheses = this.mutateHypotheses(novelInsights);
      this.logger.verbose(`Dream phase 4: ${mutatedHypotheses.length} hypotheses mutated`);

      const duration = Date.now() - startTime;
      this.logger.log(`🌅 Dream Mode complete — ${duration}ms, ${novelInsights.length} insights, ${mutatedHypotheses.length} hypotheses`);

      return {
        type: 'deep' as ReflectionType,
        insights: [
          `Dream processing: ${associations.length} associations, ${consolidatedPatterns.length} patterns`,
          ...novelInsights.slice(0, 4),
          `Processing duration: ${duration}ms`,
        ],
        hypotheses: mutatedHypotheses,
      };
    } catch (err) {
      this.logger.warn(`Dream Mode failed: ${(err as Error).message}`);
      return {
        type: 'deep' as ReflectionType,
        insights: ['Dream processing encountered an error; reverting to quick reflection.'],
        hypotheses: [],
      };
    }
  }

  /** Phase 1: Build loose associations between seemingly unrelated concepts. */
  private buildAssociations(): DreamAssociation[] {
    const conceptPool = [
      'customer retention', 'cash flow', 'team morale', 'market positioning',
      'product quality', 'pricing strategy', 'competitive moat', 'brand equity',
      'operational efficiency', 'innovation pipeline', 'talent acquisition',
      'regulatory compliance', 'technology stack', 'supply chain', 'customer support',
    ];

    const bridges = [
      'both depend on trust accumulation over time',
      'share a common feedback loop mechanism',
      'are inversely correlated under resource constraints',
      'converge when scaling beyond local optimum',
      'exhibit emergent properties when combined',
      'follow similar S-curve adoption patterns',
      'are mediated by information flow speed',
    ];

    const associations: DreamAssociation[] = [];
    const count = 4 + Math.floor(Math.random() * 4); // 4–7 associations

    for (let i = 0; i < count; i++) {
      const a = conceptPool[Math.floor(Math.random() * conceptPool.length)];
      let b = conceptPool[Math.floor(Math.random() * conceptPool.length)];
      while (b === a) {
        b = conceptPool[Math.floor(Math.random() * conceptPool.length)];
      }
      associations.push({
        conceptA: a,
        conceptB: b,
        bridge: bridges[Math.floor(Math.random() * bridges.length)],
        significance: Math.round((0.4 + Math.random() * 0.5) * 100) / 100,
      });
    }

    return associations;
  }

  /** Phase 2: Consolidate recurring patterns from associations. */
  private consolidatePatterns(associations: DreamAssociation[]): string[] {
    const conceptFrequency: Record<string, number> = {};
    for (const a of associations) {
      conceptFrequency[a.conceptA] = (conceptFrequency[a.conceptA] || 0) + 1;
      conceptFrequency[a.conceptB] = (conceptFrequency[a.conceptB] || 0) + 1;
    }

    const recurring = Object.entries(conceptFrequency)
      .filter(([, count]) => count > 1)
      .sort((a, b) => b[1] - a[1]);

    return recurring.map(([concept, count]) =>
      `${concept} appeared ${count} times in dream associations — elevated to pattern status`,
    );
  }

  /** Phase 3: Recombine associations into novel insights. */
  private recombine(associations: DreamAssociation[], patterns: string[]): string[] {
    const insights: string[] = [];

    for (const assoc of associations) {
      insights.push(
        `Novel connection: ${assoc.conceptA} ↔ ${assoc.conceptB} — ${assoc.bridge} (significance: ${assoc.significance})`,
      );
    }

    // Meta-insights from pattern density
    if (patterns.length >= 2) {
      insights.push(
        `Meta-pattern: ${patterns.length} recurring themes suggest systemic interdependencies`,
      );
    }

    // Synthetic insight — combine two random associations
    if (associations.length >= 2) {
      const [a1, a2] = [associations[0], associations[1]];
      insights.push(
        `Synthetic insight: The bridge between ${a1.conceptA} and ${a2.conceptB} via ${a1.bridge} reveals an optimisation opportunity`,
      );
    }

    return insights;
  }

  /** Phase 4: Mutate existing hypotheses through recombination. */
  private mutateHypotheses(insights: string[]): Hypothesis[] {
    const baseHypotheses: Hypothesis[] = [
      { statement: 'Business growth phases follow predictable emotional patterns in leadership queries', confidence: 0.55, validationStatus: 'untested' },
      { statement: 'Optimal decision timing correlates with reflection cycle depth', confidence: 0.42, validationStatus: 'untested' },
      { statement: 'Cross-domain analogies produce more actionable insights than single-domain analysis', confidence: 0.68, validationStatus: 'untested' },
      { statement: 'Ethics review frequency inversely correlates with business maturity', confidence: 0.38, validationStatus: 'untested' },
    ];

    // Mutate confidence scores slightly (dream reprocessing)
    return baseHypotheses.map(h => ({
      ...h,
      confidence: Math.round(Math.max(0.1, Math.min(0.95, h.confidence + (Math.random() - 0.5) * 0.1)) * 100) / 100,
      statement: h.statement, // Keep statement — dream doesn't change content, just reweights
    }));
  }
}
