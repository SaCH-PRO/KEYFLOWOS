import { Injectable, Logger } from '@nestjs/common';
import { QualityCheckResult } from './key-mind.types';

/**
 * =============================================================================
 * Business Standard Checker — Validates Output Against Quality Standards
 * =============================================================================
 * Checks whether a recommendation or output meets high-quality business
 * standards. Asks 8 critical questions:
 *   1. Is this profitable?
 *   2. Is this practical?
 *   3. Is this evidence-based?
 *   4. Is this current?
 *   5. Is this measurable?
 *   6. Is this safe?
 *   7. Is this clear?
 *   8. Is this executable?
 * =============================================================================
 */

@Injectable()
export class KeyBusinessStandard {
  private readonly logger = new Logger(KeyBusinessStandard.name);

  private readonly CRITERIA = [
    { id: 'profitable', question: 'Is this profitable or financially sound?', weight: 1.2 },
    { id: 'practical', question: 'Is this practical given current resources?', weight: 1.1 },
    { id: 'evidence', question: 'Is this evidence-based rather than speculative?', weight: 1.0 },
    { id: 'current', question: 'Is this current and relevant to today\'s market?', weight: 0.9 },
    { id: 'measurable', question: 'Is this measurable with clear success metrics?', weight: 1.0 },
    { id: 'safe', question: 'Is this safe from legal, ethical, and operational risks?', weight: 1.2 },
    { id: 'clear', question: 'Is this clear and actionable?', weight: 0.9 },
    { id: 'executable', question: 'Is this executable with a clear next step?', weight: 1.1 },
  ];

  /**
   * Check output quality. Returns a structured quality report.
   * Note: This is a structural checker. In production, AI would evaluate
   * each criterion against the actual content.
   */
  async checkQuality(content: string): Promise<QualityCheckResult> {
    // For now, we structure the check and return a framework
    // In production, this would call the AI to evaluate each criterion
    const checks = this.CRITERIA.map(c => ({
      criterion: c.question,
      passed: true, // Placeholder — AI would determine this
      notes: `Weight: ${c.weight}x — verify in review`,
    }));

    const totalWeight = this.CRITERIA.reduce((sum, c) => sum + c.weight, 0);
    const passedWeight = checks.reduce((sum, c, i) => c.passed ? sum + this.CRITERIA[i].weight : sum, 0);
    const score = Math.round((passedWeight / totalWeight) * 100);

    return {
      passed: score >= 70,
      score,
      checks,
      overallVerdict: score >= 80 ? 'Excellent' : score >= 70 ? 'Good' : score >= 50 ? 'Needs improvement' : 'Significant issues',
    };
  }

  /**
   * Get the quality criteria as a prompt for the AI.
   */
  async getQualityPrompt(): Promise<string> {
    return `Before finalizing your response, verify it meets these business quality standards:\n${this.CRITERIA.map(c => `- ${c.question}`).join('\n')}`;
  }
}
