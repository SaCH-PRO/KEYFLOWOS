import { Injectable, Logger } from '@nestjs/common';
import { ReasoningInput, CognitiveModeResult } from '../types/consciousness.types';

/**
 * =============================================================================
 * L2a: Analytical Reasoning — Systematic Decomposition
 * =============================================================================
 * Breaks problems into components, identifies key variables, evaluates
 * constraints, and produces a structured analytical assessment.
 * =============================================================================
 */

@Injectable()
export class AnalyticalReasoning {
  private readonly logger = new Logger(AnalyticalReasoning.name);

  async analyze(input: ReasoningInput): Promise<CognitiveModeResult> {
    try {
      this.logger.debug('Running analytical reasoning decomposition');

      const components = this.decompose(input.query, input.context);
      const variableAnalysis = this.identifyVariables(components, input.constraints || []);
      const confidence = this.assessConfidence(components, variableAnalysis);

      const analysis = this.buildAnalysisReport(components, variableAnalysis);

      return {
        mode: 'analytical',
        analysis,
        confidence,
      };
    } catch (err) {
      this.logger.warn(`Analytical reasoning failed: ${(err as Error).message}`);
      return {
        mode: 'analytical',
        analysis: 'Analytical decomposition encountered an error; falling back to surface-level analysis.',
        confidence: 0.3,
      };
    }
  }

  /** Decompose the query into structured problem components. */
  private decompose(query: string, context: string): string[] {
    const components: string[] = [];

    // Extract key phrases (nouns and noun phrases after verbs)
    const actionPattern = /\b(how|what|when|where|why|should|can|need)\s+\w+\s+(.+?)(?:\?|$|\b(?:is|are|will|should)\b)/i;
    const match = query.match(actionPattern);
    if (match) {
      components.push(`Core action: ${match[2].trim()}`);
    }

    // Identify goals (text after "to" or "for")
    const goalPattern = /\bto\b\s+(.+?)(?:\?|$|\.)/i;
    const goalMatch = query.match(goalPattern);
    if (goalMatch) {
      components.push(`Goal: ${goalMatch[1].trim()}`);
    }

    // Identify constraints from input
    if (context.length > 0) {
      components.push(`Context: ${context.substring(0, 200)}`);
    }

    // Extract numerical entities
    const numbers = query.match(/\$?[\d,]+(?:\.\d+)?%?\s*(?:USD|EUR|GBP|dollars?|€|£)?/gi);
    if (numbers) {
      components.push(`Quantified entities: ${numbers.join(', ')}`);
    }

    // Extract time references
    const timeRefs = query.match(/\b(?:Q[1-4]|\d{4}|January|February|March|April|May|June|July|August|September|October|November|December|weekly|monthly|quarterly|annual|year|month|week|day)\b/gi);
    if (timeRefs) {
      components.push(`Temporal references: ${timeRefs.join(', ')}`);
    }

    if (components.length === 0) {
      components.push(`Direct query: ${query}`);
    }

    return components;
  }

  /** Identify key variables and their relationships. */
  private identifyVariables(components: string[], constraints: string[]): string[] {
    const variables: string[] = [];

    for (const component of components) {
      // Extract potential decision variables (nouns after "between", "vs", "or")
      const decisionPattern = /\b(between|vs\.?|versus|or|compare|choose)\b\s+(\w+)/gi;
      let m: RegExpExecArray | null;
      while ((m = decisionPattern.exec(component)) !== null) {
        variables.push(`Decision variable: ${m[2]}`);
      }
    }

    // Add constraints as bounded variables
    for (const constraint of constraints) {
      variables.push(`Constraint: ${constraint}`);
    }

    if (variables.length === 0) {
      variables.push('Primary variable: outcome optimization');
    }

    return variables;
  }

  /** Assess confidence based on decomposition completeness. */
  private assessConfidence(components: string[], variables: string[]): number {
    const base = 0.5;
    const componentBonus = Math.min(0.2, components.length * 0.04);
    const variableBonus = Math.min(0.2, variables.length * 0.05);
    return Math.round((base + componentBonus + variableBonus) * 10) / 10;
  }

  private buildAnalysisReport(components: string[], variables: string[]): string {
    return `Analytical decomposition: ${components.length} components identified. ` +
      `Key components: ${components.slice(0, 3).join('; ')}. ` +
      `Variables: ${variables.slice(0, 4).join(', ')}. ` +
      `Analysis: Systematic evaluation of ${components.length > 2 ? 'multi-faceted' : 'focused'} problem ` +
      `with ${variables.length} decision variables. Recommend structured evaluation of each component.`;
  }
}
