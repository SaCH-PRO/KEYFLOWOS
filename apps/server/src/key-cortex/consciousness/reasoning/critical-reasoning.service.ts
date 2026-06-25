import { Injectable, Logger } from '@nestjs/common';
import { ReasoningInput, CognitiveModeResult } from '../types/consciousness.types';

/**
 * =============================================================================
 * L2c: Critical Reasoning — Bias Detection & Fallacy Identification
 * =============================================================================
 * Systematically examines reasoning for cognitive biases, logical fallacies,
 * unstated assumptions, and evidentiary gaps.
 * =============================================================================
 */

@Injectable()
export class CriticalReasoning {
  private readonly logger = new Logger(CriticalReasoning.name);

  // Common logical fallacies to detect
  private readonly FALLACY_PATTERNS: { name: string; patterns: RegExp[] }[] = [
    {
      name: 'Appeal to Authority',
      patterns: [/everyone knows/i, /experts say/i, /industry standard/i],
    },
    {
      name: 'False Dichotomy',
      patterns: [/either.*or/i, /only two options/i, /black and white/i],
    },
    {
      name: 'Hasty Generalisation',
      patterns: [/always/i, /never/i, /every time/i, /all \w+ are/i],
    },
    {
      name: 'Sunk Cost Fallacy',
      patterns: [/already invested/i, /spent so much/i, /cannot abandon/i],
    },
    {
      name: 'Confirmation Bias',
      patterns: [/obviously/i, /clearly/i, /of course/i, /everyone agrees/i],
    },
  ];

  // Cognitive bias indicators
  private readonly BIAS_INDICATORS: { name: string; phrases: string[] }[] = [
    { name: 'Anchoring Bias', phrases: ['starting with', 'based on the initial', 'first figure'] },
    { name: 'Availability Heuristic', phrases: ['recent example', 'last time', 'just happened'] },
    { name: 'Groupthink', phrases: ['team decided', 'we all agree', 'consensus is'] },
    { name: 'Overconfidence', phrases: ['definitely will', 'guaranteed', 'certainly', 'no doubt'] },
  ];

  async analyze(input: ReasoningInput): Promise<CognitiveModeResult> {
    try {
      this.logger.debug('Running critical reasoning examination');

      const fallacies = this.detectFallacies(input.query);
      const biases = this.detectBiases(input.query, input.context);
      const assumptions = this.identifyAssumptions(input.query);
      const confidence = this.assessQuality(fallacies, biases, assumptions);

      return {
        mode: 'critical',
        analysis: this.buildReport(fallacies, biases, assumptions),
        confidence,
      };
    } catch (err) {
      this.logger.warn(`Critical reasoning failed: ${(err as Error).message}`);
      return {
        mode: 'critical',
        analysis: 'Critical examination encountered an error.',
        confidence: 0.3,
      };
    }
  }

  /** Scan for logical fallacy patterns. */
  private detectFallacies(text: string): string[] {
    const found: string[] = [];
    for (const { name, patterns } of this.FALLACY_PATTERNS) {
      for (const pattern of patterns) {
        if (pattern.test(text)) {
          found.push(`Possible ${name}: phrase matching "${pattern.source}" detected`);
          break;
        }
      }
    }
    return found;
  }

  /** Detect cognitive bias indicators. */
  private detectBiases(query: string, context: string): string[] {
    const combined = `${query} ${context}`.toLowerCase();
    const found: string[] = [];
    for (const { name, phrases } of this.BIAS_INDICATORS) {
      for (const phrase of phrases) {
        if (combined.includes(phrase)) {
          found.push(`${name}: "${phrase}" detected in reasoning chain`);
          break;
        }
      }
    }
    return found;
  }

  /** Identify unstated assumptions. */
  private identifyAssumptions(query: string): string[] {
    const assumptions: string[] = [];
    const lower = query.toLowerCase();

    if (/\b(should|must|need to)\b/i.test(lower)) {
      assumptions.push('Assumes the proposed action is feasible within current constraints');
    }
    if (/\b(better|best|optimal)\b/i.test(lower)) {
      assumptions.push('Assumes comparison criteria are agreed upon and measurable');
    }
    if (/\b(customers?|users?|clients?)\b/i.test(lower)) {
      assumptions.push('Assumes customer preferences are stable and accurately known');
    }
    if (/\b(revenue|profit|cost|price)\b/i.test(lower)) {
      assumptions.push('Assumes financial variables can be predicted with reasonable accuracy');
    }

    if (assumptions.length === 0) {
      assumptions.push('Assumes stated problem is the root cause, not a symptom');
    }

    return assumptions;
  }

  /** Higher confidence when fewer fallacies/biases are detected. */
  private assessQuality(fallacies: string[], biases: string[], assumptions: string[]): number {
    const base = 0.7;
    const deduction = (fallacies.length * 0.08) + (biases.length * 0.06);
    return Math.max(0.3, Math.round((base - deduction) * 10) / 10);
  }

  private buildReport(fallacies: string[], biases: string[], assumptions: string[]): string {
    const parts: string[] = [];

    if (fallacies.length > 0) {
      parts.push(`Detected ${fallacies.length} potential fallacy pattern(s): ${fallacies.slice(0, 2).join('; ')}.`);
    } else {
      parts.push('No obvious logical fallacy patterns detected.');
    }

    if (biases.length > 0) {
      parts.push(`Bias indicators: ${biases.slice(0, 2).join('; ')}.`);
    } else {
      parts.push('No strong cognitive bias indicators found.');
    }

    parts.push(`Unstated assumptions (${assumptions.length}): ${assumptions.slice(0, 2).join('; ')}.`);
    parts.push('Recommendation: Examine assumptions before committing to the conclusion.');

    return parts.join(' ');
  }
}
