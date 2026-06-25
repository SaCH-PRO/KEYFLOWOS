import { Injectable, Logger } from '@nestjs/common';
import { ReasoningInput, CognitiveModeResult } from '../types/consciousness.types';

/**
 * =============================================================================
 * L2d: Strategic Reasoning — Long-Term Planning & Game Theory
 * =============================================================================
 * Evaluates multi-step consequences, stakeholder incentives, competitive
 * dynamics, and long-term positioning.
 * =============================================================================
 */

interface Stakeholder {
  name: string;
  incentives: string[];
  power: 'high' | 'medium' | 'low';
}

@Injectable()
export class StrategicReasoning {
  private readonly logger = new Logger(StrategicReasoning.name);

  async analyze(input: ReasoningInput): Promise<CognitiveModeResult> {
    try {
      this.logger.debug('Running strategic reasoning analysis');

      const stakeholders = this.identifyStakeholders(input.query, input.context);
      const moves = this.evaluateStrategicMoves(input.query, stakeholders);
      const consequences = this.traceConsequences(input.query, moves);
      const confidence = this.assessStrategicConfidence(stakeholders, moves);

      return {
        mode: 'strategic',
        analysis: this.buildReport(stakeholders, moves, consequences),
        confidence,
      };
    } catch (err) {
      this.logger.warn(`Strategic reasoning failed: ${(err as Error).message}`);
      return {
        mode: 'strategic',
        analysis: 'Strategic analysis encountered an error.',
        confidence: 0.3,
      };
    }
  }

  /** Identify key stakeholders and their incentives. */
  private identifyStakeholders(query: string, context: string): Stakeholder[] {
    const combined = `${query} ${context}`.toLowerCase();
    const stakeholders: Stakeholder[] = [];

    const patterns: { keywords: string[]; name: string; incentives: string[]; power: 'high' | 'medium' | 'low' }[] = [
      { keywords: ['customer', 'client', 'user', 'buyer'], name: 'Customers', incentives: ['value for money', 'quality', 'convenience'], power: 'high' },
      { keywords: ['employee', 'team', 'staff', 'workforce'], name: 'Employees', incentives: ['job security', 'growth', 'compensation'], power: 'medium' },
      { keywords: ['investor', 'shareholder', 'stakeholder', 'vc'], name: 'Investors', incentives: ['ROI', 'growth', 'risk mitigation'], power: 'high' },
      { keywords: ['competitor', 'rival', 'market', 'industry'], name: 'Competitors', incentives: ['market share', 'differentiation', 'pricing power'], power: 'high' },
      { keywords: ['regulator', 'government', 'compliance', 'legal'], name: 'Regulators', incentives: ['compliance', 'public interest', 'stability'], power: 'high' },
      { keywords: ['supplier', 'vendor', 'partner'], name: 'Partners/Suppliers', incentives: ['stable demand', 'fair terms', 'long-term contracts'], power: 'medium' },
    ];

    for (const { keywords, name, incentives, power } of patterns) {
      if (keywords.some(kw => combined.includes(kw))) {
        stakeholders.push({ name, incentives, power });
      }
    }

    // Always include at least the user / business
    if (stakeholders.length === 0) {
      stakeholders.push({ name: 'Business', incentives: ['sustainability', 'growth'], power: 'high' });
    }

    return stakeholders;
  }

  /** Generate possible strategic moves. */
  private evaluateStrategicMoves(query: string, stakeholders: Stakeholder[]): string[] {
    const moves: string[] = [];

    moves.push('First-mover advantage: Act before competitors can respond');
    moves.push('Defensive positioning: Strengthen core capabilities');

    if (stakeholders.some(s => s.name === 'Competitors')) {
      moves.push('Differentiation: Create unique value competitors cannot replicate easily');
    }

    if (stakeholders.some(s => s.name === 'Customers')) {
      moves.push('Customer lock-in: Increase switching costs through value-added services');
    }

    moves.push('Alliance building: Partner with complementary players to expand reach');
    moves.push('Resource focus: Concentrate resources on highest-ROI initiatives');

    return moves;
  }

  /** Trace 2nd and 3rd order consequences. */
  private traceConsequences(query: string, moves: string[]): string[] {
    return [
      '2nd-order: Competitors may respond with price cuts or feature matching within 2-3 quarters',
      '3rd-order: Market consolidation possible if responses strain smaller players',
      '2nd-order: Customer expectations may shift, requiring continuous investment',
      'Long-term: Position established creates compounding advantages over 12-24 months',
    ];
  }

  private assessStrategicConfidence(stakeholders: Stakeholder[], moves: string[]): number {
    const base = 0.55;
    const stakeholderBonus = Math.min(0.2, stakeholders.length * 0.04);
    const moveBonus = Math.min(0.2, moves.length * 0.03);
    return Math.round((base + stakeholderBonus + moveBonus) * 10) / 10;
  }

  private buildReport(stakeholders: Stakeholder[], moves: string[], consequences: string[]): string {
    const powerMap = stakeholders.filter(s => s.power === 'high').map(s => s.name);
    return `Strategic analysis identified ${stakeholders.length} stakeholders ` +
      `(high-power: ${powerMap.join(', ') || 'none'}). ` +
      `Evaluated ${moves.length} strategic moves. ` +
      `Top move: ${moves[0]}. ` +
      `Key consequence: ${consequences[0]}. ` +
      `Recommendation: Consider stakeholder reactions and 2nd-order effects before executing.`;
  }
}
