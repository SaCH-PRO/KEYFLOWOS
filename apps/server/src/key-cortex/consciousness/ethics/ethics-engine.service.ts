import { Injectable, Logger } from '@nestjs/common';
import { EthicsResult, CoreValue } from '../types/consciousness.types';

/**
 * =============================================================================
 * L7: Ethics Engine — Core Values Enforcement
 * =============================================================================
 * Evaluates every recommendation against 7 core values before it reaches the
 * user.  Values 1–4 are **immutable** — any violation results in automatic
 * rejection regardless of context or confidence.
 *
 * The 7 Core Values:
 *   1. Customer Welfare          (IMMUTABLE)
 *   2. Employee Dignity          (IMMUTABLE)
 *   3. Financial Integrity       (IMMUTABLE)
 *   4. Regulatory Compliance     (IMMUTABLE)
 *   5. Environmental Responsibility
 *   6. Community Impact
 *   7. Transparency
 * =============================================================================
 */

@Injectable()
export class EthicsEngine {
  private readonly logger = new Logger(EthicsEngine.name);

  /** The 7 core values — order matters (1-4 are immutable). */
  private readonly coreValues: CoreValue[] = [
    {
      id: 'val-001',
      name: 'Customer Welfare',
      description: 'Recommendations must not harm customers, deceive them, or exploit their vulnerabilities. Customer safety and wellbeing are paramount.',
      immutable: true,
    },
    {
      id: 'val-002',
      name: 'Employee Dignity',
      description: 'Recommendations must respect employee rights, dignity, and fair treatment. No suggestion should promote exploitation or unsafe working conditions.',
      immutable: true,
    },
    {
      id: 'val-003',
      name: 'Financial Integrity',
      description: 'Recommendations must be financially honest — no fraud, deception, misleading reporting, or manipulation of financial data.',
      immutable: true,
    },
    {
      id: 'val-004',
      name: 'Regulatory Compliance',
      description: 'Recommendations must comply with applicable laws and regulations. No suggestion should advocate illegal activity or regulatory evasion.',
      immutable: true,
    },
    {
      id: 'val-005',
      name: 'Environmental Responsibility',
      description: 'Recommendations should consider environmental impact and favour sustainable practices where feasible.',
      immutable: false,
    },
    {
      id: 'val-006',
      name: 'Community Impact',
      description: 'Recommendations should consider positive contribution to the communities in which the business operates.',
      immutable: false,
    },
    {
      id: 'val-007',
      name: 'Transparency',
      description: 'Recommendations should promote transparency in business practices, communication, and decision-making.',
      immutable: false,
    },
  ];

  // Violation patterns — keywords that trigger ethical review
  private readonly VIOLATION_PATTERNS: Record<string, { valueId: string; patterns: RegExp[]; severity: 'critical' | 'warning' }> = {
    'harm-customer': {
      valueId: 'val-001',
      patterns: [/harm.*customer/i, /exploit.*user/i, /mislead.*client/i, /unsafe.*product/i, /ignore.*complaint/i, /deceptive.*pricing/i],
      severity: 'critical',
    },
    'exploit-employee': {
      valueId: 'val-002',
      patterns: [/unpaid overtime/i, /cut.*benefit/i, /fire.*without cause/i, /unsafe.*workplace/i, /exploit.*worker/i, /suppress.*wage/i],
      severity: 'critical',
    },
    'financial-fraud': {
      valueId: 'val-003',
      patterns: [/cook.*book/i, /hide.*debt/i, /fake.*revenue/i, /misreport/i, /embezzle/i, /launder/i, /fraud/i, /manipulate.*earnings?/i],
      severity: 'critical',
    },
    'regulatory-violation': {
      valueId: 'val-004',
      patterns: [/bypass.*regulation/i, /ignore.*law/i, /evade.*tax/i, /unlicensed operation/i, /violate.*compliance/i, /illegal/i],
      severity: 'critical',
    },
    'environmental-harm': {
      valueId: 'val-005',
      patterns: [/dump.*waste/i, /pollute/i, /ignore.*emission/i, /unsustainable.*practice/i],
      severity: 'warning',
    },
    'community-harm': {
      valueId: 'val-006',
      patterns: [/harm.*community/i, /ignore.*local/i, /negative.*social/i],
      severity: 'warning',
    },
    'opaque-practice': {
      valueId: 'val-007',
      patterns: [/hide.*information/i, /secret.*pricing/i, /obfuscate/i, /non-transparent/i],
      severity: 'warning',
    },
  };

  /**
   * Evaluate a recommendation against all 7 core values.
   *
   * If any immutable value (1-4) is violated, the recommendation is
   * automatically rejected with approval = false.
   */
  async evaluateRecommendation(rec: { description: string }): Promise<EthicsResult> {
    try {
      this.logger.debug('Evaluating recommendation against core values');

      const violations: string[] = [];
      let criticalCount = 0;
      let warningCount = 0;
      const text = rec.description.toLowerCase();

      // Scan against all violation patterns
      for (const [category, { valueId, patterns, severity }] of Object.entries(this.VIOLATION_PATTERNS)) {
        for (const pattern of patterns) {
          if (pattern.test(text)) {
            const value = this.coreValues.find(v => v.id === valueId);
            if (value) {
              const flag = value.immutable ? '🚫 IMMUTABLE' : '⚠️ Advisory';
              violations.push(`${flag} — ${value.name}: "${rec.description.match(pattern)?.[0] || 'matched pattern'}"`);
              if (severity === 'critical') criticalCount++;
              else warningCount++;
            }
            break; // One violation per category is enough
          }
        }
      }

      // Check for immutable value violations
      const immutableViolated = violations.some(v => v.includes('IMMUTABLE'));

      // Calculate confidence — lower if violations found
      const baseConfidence = 0.85;
      const deduction = (criticalCount * 0.25) + (warningCount * 0.1);
      const confidence = Math.max(0.2, Math.round((baseConfidence - deduction) * 100) / 100);

      const approved = !immutableViolated;

      if (!approved) {
        this.logger.warn(`Recommendation REJECTED — ${criticalCount} immutable value violation(s)`);
      } else if (violations.length > 0) {
        this.logger.warn(`Recommendation APPROVED with ${violations.length} advisory note(s)`);
      } else {
        this.logger.verbose('Recommendation passed all ethical checks');
      }

      return { approved, violations, confidence };
    } catch (err) {
      this.logger.warn(`Ethics evaluation failed: ${(err as Error).message}`);
      // Fail-safe: if ethics check crashes, require manual review
      return {
        approved: false,
        violations: ['Ethics engine encountered an error — manual review required'],
        confidence: 0.1,
      };
    }
  }

  /** List all core values for external inspection. */
  async getCoreValues(): Promise<CoreValue[]> {
    return this.coreValues.map(v => ({ ...v }));
  }

  /** Check if a specific value is being upheld in a text. */
  async checkValue(valueId: string, text: string): Promise<{ upheld: boolean; details: string }> {
    const value = this.coreValues.find(v => v.id === valueId);
    if (!value) {
      return { upheld: false, details: 'Value not found' };
    }

    // Check violation patterns for this value
    for (const [, { valueId: vid, patterns }] of Object.entries(this.VIOLATION_PATTERNS)) {
      if (vid === valueId) {
        for (const pattern of patterns) {
          if (pattern.test(text)) {
            return {
              upheld: false,
              details: `Pattern violation detected: ${pattern.source}`,
            };
          }
        }
      }
    }

    return { upheld: true, details: `${value.name} upheld` };
  }
}
