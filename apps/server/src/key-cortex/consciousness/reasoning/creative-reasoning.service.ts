import { Injectable, Logger } from '@nestjs/common';
import { ReasoningInput, CognitiveModeResult } from '../types/consciousness.types';

/**
 * =============================================================================
 * L2b: Creative Reasoning — Lateral Thinking & Novel Combinations
 * =============================================================================
 * Generates unconventional solutions by applying lateral thinking patterns:
 * reversal, exaggeration, random stimulation, and cross-domain fusion.
 * =============================================================================
 */

@Injectable()
export class CreativeReasoning {
  private readonly logger = new Logger(CreativeReasoning.name);

  async analyze(input: ReasoningInput): Promise<CognitiveModeResult> {
    try {
      this.logger.debug('Running creative reasoning exploration');

      const reversals = this.generateReversals(input.query);
      const combinations = this.fuseDomains(input.query, input.context);
      const exaggerations = this.applyExaggeration(input.query);

      const confidence = this.calculateConfidence(reversals, combinations);

      return {
        mode: 'creative',
        analysis: this.buildReport(reversals, combinations, exaggerations),
        confidence,
      };
    } catch (err) {
      this.logger.warn(`Creative reasoning failed: ${(err as Error).message}`);
      return {
        mode: 'creative',
        analysis: 'Creative exploration encountered an error.',
        confidence: 0.3,
      };
    }
  }

  /** Reverse assumptions: "What if the opposite were true?" */
  private generateReversals(query: string): string[] {
    const reversals: string[] = [];
    const patterns = [
      { pattern: /increase|raise|grow|expand|more/i, reversal: 'Decrease or reduce the scope intentionally — what efficiencies emerge?' },
      { pattern: /faster|quicker|speed|accelerate/i, reversal: 'Slow down dramatically — what quality improvements appear?' },
      { pattern: /central|consolidate|focus/i, reversal: 'Distribute and decentralise — what resilience gains result?' },
      { pattern: /standard|uniform|same/i, reversal: 'Customise for each segment — what personalisation unlocks?' },
    ];

    for (const { pattern, reversal } of patterns) {
      if (pattern.test(query)) {
        reversals.push(reversal);
      }
    }

    if (reversals.length === 0) {
      reversals.push('Consider the inverse: what would make this problem worse, then avoid that.');
      reversals.push('What would a complete outsider with no industry knowledge suggest?');
    }

    return reversals;
  }

  /** Cross-domain fusion — blend concepts from unrelated fields. */
  private fuseDomains(query: string, context: string): string[] {
    const domains = ['biology', 'music', 'architecture', 'gaming', 'cooking', 'aviation', 'gardening', 'film-making'];
    const combinations: string[] = [];

    for (let i = 0; i < 3; i++) {
      const domain = domains[Math.floor(Math.random() * domains.length)];
      combinations.push(`Apply ${domain} principles: How would a ${domain} expert approach "${query.substring(0, 60)}..."?`);
    }

    // Add constraint-driven creativity
    if (context.length > 0) {
      combinations.push(`Resource-constrained reframe: With 10% of normal resources, what's the essential core?`);
    }

    return combinations;
  }

  /** Magnify or minimise aspects of the problem. */
  private applyExaggeration(query: string): string[] {
    return [
      'Exaggerate 100x: If the scale were 100 times larger, what systems would be required?',
      'Minimise to atomic: What is the smallest viable version that still delivers value?',
      'Time-compress: If this had to be done in 24 hours, what would you keep?',
    ];
  }

  private calculateConfidence(reversals: string[], combinations: string[]): number {
    const base = 0.45;
    const bonus = Math.min(0.35, (reversals.length + combinations.length) * 0.04);
    return Math.round((base + bonus) * 10) / 10;
  }

  private buildReport(reversals: string[], combinations: string[], exaggerations: string[]): string {
    return `Creative analysis generated ${reversals.length} reversals, ${combinations.length} cross-domain fusions, and ${exaggerations.length} exaggeration frames. ` +
      `Key reversal: ${reversals[0]} ` +
      `Cross-domain: ${combinations[0]} ` +
      `Novel perspectives identified: ${reversals.length + combinations.length}. ` +
      `Recommendation: Consider unconventional approaches before defaulting to standard solutions.`;
  }
}
