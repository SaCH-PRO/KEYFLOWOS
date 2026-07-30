import { Injectable } from '@nestjs/common';
import { BlueprintService } from '../blueprint/blueprint.service';
import { ConstitutionVersionService } from '../business-genome/constitution-version.service';

export interface ValueConflictCheck {
  conflict: boolean;
  severity: 'block' | 'supervised' | 'none';
  reason: string;
  matchedTerms: string[];
}

/**
 * Checks an action against the business's Blueprint values and Constitution.
 *
 * This is intentionally lightweight: keyword/score based scanning of
 * dealbreakers, brand "do not say", and constitution content. More
 * sophisticated semantic value alignment can be layered in later.
 */
@Injectable()
export class ConstitutionValuesService {
  constructor(
    private readonly blueprint: BlueprintService,
    private readonly constitution: ConstitutionVersionService,
  ) {}

  async checkAction(
    businessId: string,
    actionKey: string,
    parameters?: Record<string, unknown>,
  ): Promise<ValueConflictCheck> {
    const [blueprint, constitution] = await Promise.all([
      this.blueprint.getBlueprint(businessId).catch(() => null),
      this.constitution.latest(businessId).catch(() => null),
    ]);

    const text = this.flattenText(actionKey, parameters);
    const terms: string[] = [];

    const dealbreakers = blueprint?.constraints?.dealbreakers ?? [];
    for (const term of dealbreakers) {
      if (term && this.matches(text, term)) {
        terms.push(term);
      }
    }

    const doNotSay = blueprint?.brand?.doNotSay ?? [];
    for (const term of doNotSay) {
      if (term && this.matches(text, term)) {
        terms.push(term);
      }
    }

    const constitutionText = this.constitutionText(constitution?.content);
    if (constitutionText) {
      const negativeSignals = ['never', 'prohibited', 'must not', 'do not', 'forbidden', 'unacceptable'];
      for (const signal of negativeSignals) {
        if (text.toLowerCase().includes(signal)) {
          terms.push(signal);
        }
      }
    }

    if (terms.length === 0) {
      return { conflict: false, severity: 'none', reason: 'No value conflict detected', matchedTerms: [] };
    }

    const uniqueTerms = Array.from(new Set(terms));
    const severity = dealbreakers.some((d) => uniqueTerms.includes(d)) ? 'block' : 'supervised';
    return {
      conflict: true,
      severity,
      reason: `Action may conflict with business values/constitution: ${uniqueTerms.join(', ')}`,
      matchedTerms: uniqueTerms,
    };
  }

  private flattenText(actionKey: string, parameters?: Record<string, unknown>): string {
    const parts = [actionKey];
    if (parameters) {
      parts.push(JSON.stringify(parameters));
    }
    return parts.join(' ').toLowerCase();
  }

  private matches(text: string, term: string): boolean {
    return text.includes(term.toLowerCase());
  }

  private constitutionText(content: unknown): string {
    if (!content) return '';
    try {
      return JSON.stringify(content).toLowerCase();
    } catch {
      return '';
    }
  }
}
