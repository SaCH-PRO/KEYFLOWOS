import { Injectable, Logger } from '@nestjs/common';
import { ReasoningInput, CognitiveModeResult } from '../types/consciousness.types';

/**
 * =============================================================================
 * L2e: Analogical Reasoning — Pattern Matching Across Domains
 * =============================================================================
 * Maps the current problem onto known patterns from other domains to generate
 * insights through structural similarity.
 * =============================================================================
 */

interface DomainAnalogy {
  sourceDomain: string;
  mapping: string;
  insight: string;
  relevance: number; // 0–1
}

@Injectable()
export class AnalogicalReasoning {
  private readonly logger = new Logger(AnalogicalReasoning.name);

  // Known analogy bases — source domain patterns
  private readonly ANALOGY_LIBRARY: { domain: string; structure: string[]; insight: string }[] = [
    { domain: 'Ecology', structure: ['ecosystem', 'balance', 'niche', 'competition', 'symbiosis'], insight: 'Businesses exist in ecosystems where symbiotic partnerships can be as valuable as competitive advantages.' },
    { domain: 'Biology/Evolution', structure: ['adapt', 'evolve', 'survive', 'selection', 'fitness', 'mutation'], insight: 'Adaptability and rapid iteration matter more than perfect initial positioning — evolutionary pressure favours the most responsive.' },
    { domain: 'Physics/Momentum', structure: ['momentum', 'inertia', 'force', 'acceleration', 'friction'], insight: 'Building momentum requires initial energy investment; once moving, maintain velocity by removing friction.' },
    { domain: 'Architecture', structure: ['foundation', 'structure', 'design', 'blueprint', 'scale', 'load'], insight: 'A solid foundation enables vertical scaling; architectural decisions made early constrain future possibilities.' },
    { domain: 'Games/Chess', structure: ['strategy', 'position', 'move', 'opponent', 'sacrifice', 'endgame'], insight: 'Short-term sacrifices can yield long-term positional advantages — think in terms of board position, not just immediate captures.' },
    { domain: 'Music/Orchestration', structure: ['harmony', 'rhythm', 'conductor', 'ensemble', 'composition'], insight: 'Great outcomes require orchestrating diverse talents in harmony; the conductor does not play every instrument.' },
    { domain: 'Cooking/Cuisine', structure: ['recipe', 'ingredients', 'flavour', 'balance', 'timing', 'presentation'], insight: 'Execution timing and ingredient quality often matter more than the recipe itself; presentation affects perception of taste.' },
    { domain: 'Immune System', structure: ['defence', 'attack', 'antibody', 'threat', 'adaptation'], insight: 'Build adaptive defences rather than static walls — the ability to learn from and respond to new threats is essential.' },
  ];

  async analyze(input: ReasoningInput): Promise<CognitiveModeResult> {
    try {
      this.logger.debug('Running analogical reasoning pattern matching');

      const analogies = this.findAnalogies(input.query, input.context);
      const structuralMapping = this.mapStructure(input.query, analogies);
      const confidence = this.assessAnalogicalConfidence(analogies);

      return {
        mode: 'analogical',
        analysis: this.buildReport(analogies, structuralMapping),
        confidence,
      };
    } catch (err) {
      this.logger.warn(`Analogical reasoning failed: ${(err as Error).message}`);
      return {
        mode: 'analogical',
        analysis: 'Analogical pattern matching encountered an error.',
        confidence: 0.3,
      };
    }
  }

  /** Find the strongest domain analogies for the given problem. */
  private findAnalogies(query: string, context: string): DomainAnalogy[] {
    const combined = `${query} ${context}`.toLowerCase();
    const scored = this.ANALOGY_LIBRARY.map(entry => {
      let matchCount = 0;
      for (const keyword of entry.structure) {
        if (combined.includes(keyword.toLowerCase())) {
          matchCount++;
        }
      }
      const relevance = matchCount / entry.structure.length;
      return {
        sourceDomain: entry.domain,
        mapping: `Problem elements map to ${entry.domain} concepts: ${entry.structure.slice(0, 3).join(', ')}`,
        insight: entry.insight,
        relevance,
      };
    });

    // Return top 3 by relevance
    scored.sort((a, b) => b.relevance - a.relevance);
    return scored.filter(a => a.relevance > 0).slice(0, 3);
  }

  /** Build structural mapping between source and target. */
  private mapStructure(query: string, analogies: DomainAnalogy[]): string[] {
    if (analogies.length === 0) {
      return ['No strong structural analogies detected. Consider reframing the problem using different vocabulary.'];
    }
    return analogies.map(a =>
      `${a.sourceDomain}: ${a.mapping}. Insight → ${a.insight}`,
    );
  }

  private assessAnalogicalConfidence(analogies: DomainAnalogy[]): number {
    const base = 0.45;
    if (analogies.length === 0) return base;
    const topRelevance = analogies[0].relevance;
    const bonus = topRelevance * 0.4;
    return Math.round((base + bonus) * 10) / 10;
  }

  private buildReport(analogies: DomainAnalogy[], mappings: string[]): string {
    if (analogies.length === 0) {
      return 'Analogical analysis found no strong cross-domain mappings. ' +
        'Try reframing the problem with different terminology to unlock pattern matches. ' +
        'Consider domains like ecology, architecture, or game theory as starting points.';
    }

    return `Analogical reasoning identified ${analogies.length} relevant domain mapping(s). ` +
      `Strongest: ${analogies[0].sourceDomain} (relevance: ${Math.round(analogies[0].relevance * 100)}%). ` +
      `Key insight: ${analogies[0].insight} ` +
      `Structural mappings: ${mappings.length}. ` +
      `Recommendation: ${analogies.length > 1 ? 'Compare insights across multiple analogies for robustness.' : 'Validate the analogy fit before transferring solutions.'}`;
  }
}
