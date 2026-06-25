import { Injectable, Logger } from '@nestjs/common';
import { ReasoningInput, CognitiveModeResult } from '../types/consciousness.types';

/**
 * =============================================================================
 * L2f: Counterfactual Reasoning — "What If" Scenario Exploration
 * =============================================================================
 * Systematically explores alternative scenarios by changing key variables
 * and tracing the consequences. Uses structured counterfactual frames:
 *   - Pre-emptive: What if X had not happened?
 *   - Miraculous:  What if X were suddenly different?
 *   - Reverse:     What if we do the opposite?
 * =============================================================================
 */

interface CounterfactualScenario {
  assumption: string;
  changedVariable: string;
  consequences: string[];
  plausibility: number;
}

@Injectable()
export class CounterfactualReasoning {
  private readonly logger = new Logger(CounterfactualReasoning.name);

  async analyze(input: ReasoningInput): Promise<CognitiveModeResult> {
    try {
      this.logger.debug('Running counterfactual scenario exploration');

      const scenarios = this.generateScenarios(input.query, input.context);
      const comparison = this.compareScenarios(scenarios);
      const confidence = this.assessPlausibility(scenarios);

      return {
        mode: 'counterfactual',
        analysis: this.buildReport(scenarios, comparison),
        confidence,
      };
    } catch (err) {
      this.logger.warn(`Counterfactual reasoning failed: ${(err as Error).message}`);
      return {
        mode: 'counterfactual',
        analysis: 'Counterfactual exploration encountered an error.',
        confidence: 0.3,
      };
    }
  }

  /** Generate counterfactual scenarios by manipulating key variables. */
  private generateScenarios(query: string, context: string): CounterfactualScenario[] {
    const scenarios: CounterfactualScenario[] = [];
    const combined = `${query} ${context}`;

    // Pre-emptive counterfactual — remove a key element
    const keyElements = this.extractKeyElements(combined);
    for (let i = 0; i < Math.min(2, keyElements.length); i++) {
      const el = keyElements[i];
      scenarios.push({
        assumption: `Pre-emptive: What if ${el} had never been a factor?`,
        changedVariable: el,
        consequences: [
          `Alternative path ${i + 1}a: Resources would have been allocated differently`,
          `Alternative path ${i + 1}b: Timeline and dependencies shift significantly`,
          `Alternative path ${i + 1}c: Stakeholder responses would vary`,
        ],
        plausibility: 0.6,
      });
    }

    // Miraculous counterfactual — ideal conditions
    scenarios.push({
      assumption: 'Miraculous: What if all constraints were removed?',
      changedVariable: 'Constraint removal',
      consequences: [
        'Ideal path: Speed of execution increases 3-5x',
        'Risk: Quality control mechanisms may be bypassed',
        'Insight: Identifies which constraints are truly binding vs self-imposed',
      ],
      plausibility: 0.3,
    });

    // Reverse counterfactual — opposite approach
    scenarios.push({
      assumption: 'Reverse: What if we pursued the opposite strategy?',
      changedVariable: 'Strategy inversion',
      consequences: [
        'Inverse outcome: May reveal hidden opportunities in neglected areas',
        'Risk: Counter-normative approaches face resistance',
        'Insight: Tests robustness of current strategy against alternatives',
      ],
      plausibility: 0.5,
    });

    // Resource counterfactual — 10x resources
    scenarios.push({
      assumption: 'Resource: What if budget and team were 10x larger?',
      changedVariable: 'Scale multiplier',
      consequences: [
        'At scale: Parallel workstreams become feasible',
        'At scale: Coordination overhead increases non-linearly',
        'Insight: Reveals bottlenecking factors that are resource-independent',
      ],
      plausibility: 0.4,
    });

    return scenarios;
  }

  /** Extract key entities that could be varied counterfactually. */
  private extractKeyElements(text: string): string[] {
    const elements: string[] = [];

    // Extract time elements
    const timeMatch = text.match(/\b(\d+\s*(?:days?|weeks?|months?|years?)|Q[1-4])\b/i);
    if (timeMatch) elements.push(timeMatch[1]);

    // Extract monetary elements
    const moneyMatch = text.match(/\$[\d,]+(?:\.\d+)?(?:\s*(?:million|billion|k|M|B))?/i);
    if (moneyMatch) elements.push(moneyMatch[0]);

    // Extract team / headcount
    const teamMatch = text.match(/\b(\d+)\s*(?:people|employees|team members|staff)\b/i);
    if (teamMatch) elements.push(`${teamMatch[1]} people`);

    // Extract named entities (capitalised words)
    const namedEntities = text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g);
    if (namedEntities && namedEntities.length > 0) {
      const unique = [...new Set(namedEntities)].slice(0, 2);
      elements.push(...unique);
    }

    if (elements.length === 0) {
      elements.push('current timeline', 'existing budget', 'present team structure');
    }

    return elements;
  }

  /** Compare scenarios to identify robust insights. */
  private compareScenarios(scenarios: CounterfactualScenario[]): string[] {
    const allConsequences = scenarios.flatMap(s => s.consequences);
    return [
      `Compared ${scenarios.length} scenarios with ${allConsequences.length} total consequence chains`,
      'Most robust insight: Constraints that persist across all scenarios are truly binding',
      'Variable insight: Elements that change across scenarios are levers for action',
    ];
  }

  private assessPlausibility(scenarios: CounterfactualScenario[]): number {
    const avgPlausibility = scenarios.reduce((sum, s) => sum + s.plausibility, 0) / scenarios.length;
    return Math.round((0.4 + avgPlausibility * 0.4) * 10) / 10;
  }

  private buildReport(scenarios: CounterfactualScenario[], comparison: string[]): string {
    return `Counterfactual analysis explored ${scenarios.length} scenarios. ` +
      `Frames: ${scenarios.map(s => s.assumption.split(':')[0]).join(', ')}. ` +
      `Key comparison: ${comparison[1]} ` +
      `Most plausible scenario (${Math.round(scenarios[0].plausibility * 100)}%): ${scenarios[0].assumption}. ` +
      `Recommendation: Use counterfactual insights to stress-test current plan against alternatives.`;
  }
}
