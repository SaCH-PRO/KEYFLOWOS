import { Injectable, Logger } from '@nestjs/common';
import { BusinessSignal, BusinessFunction } from './key-mind.types';

/**
 * =============================================================================
 * Signal Detector — Detects Hidden Business Signals from User Input
 * =============================================================================
 * Analyzes user queries for hidden business signals that the user may not
 * explicitly state. Maps symptoms to underlying business problems.
 *
 * Examples:
 *   "My ads are not converting" → Marketing function, conversion issue
 *   "I have too many overdue invoices" → Finance function, cash flow risk
 *   "My team is always busy but revenue is flat" → Operations + Strategy
 * =============================================================================
 */

@Injectable()
export class KeySignalDetector {
  private readonly logger = new Logger(KeySignalDetector.name);

  // Symptom → Signal mapping
  private readonly SIGNAL_PATTERNS: SignalPattern[] = [
    {
      keywords: ['not converting', 'low conversion', 'ads not working', 'CTR', 'click', 'traffic no sales'],
      signal: { type: 'anomaly', source: 'user_query', description: 'Conversion rate problem detected', severity: 'high', recommendedFunction: 'marketing', confidence: 0.85 },
    },
    {
      keywords: ['no leads', 'lead', 'pipeline', 'prospect', 'follow up', 'follow-up'],
      signal: { type: 'risk', source: 'user_query', description: 'Lead generation or pipeline gap', severity: 'high', recommendedFunction: 'sales', confidence: 0.9 },
    },
    {
      keywords: ['cash flow', 'overdue invoice', 'not getting paid', 'runway', 'broke', 'no money', 'expense'],
      signal: { type: 'risk', source: 'user_query', description: 'Cash flow or financial health risk', severity: 'critical', recommendedFunction: 'finance', confidence: 0.95 },
    },
    {
      keywords: ['too busy', 'overwhelmed', 'capacity', 'bottleneck', 'can\'t keep up', 'backlog'],
      signal: { type: 'risk', source: 'user_query', description: 'Operations capacity constraint', severity: 'high', recommendedFunction: 'operations', confidence: 0.88 },
    },
    {
      keywords: ['churn', 'leaving', 'cancel', 'retention', 'customer leaving', 'not coming back'],
      signal: { type: 'risk', source: 'user_query', description: 'Customer retention problem', severity: 'critical', recommendedFunction: 'customer_success', confidence: 0.92 },
    },
    {
      keywords: ['hiring', 'team', 'staff', 'employee', 'talent', 'recruit'],
      signal: { type: 'opportunity', source: 'user_query', description: 'Team growth or HR optimization opportunity', severity: 'medium', recommendedFunction: 'people', confidence: 0.8 },
    },
    {
      keywords: ['competitor', 'competition', 'market share', 'losing to', 'differentiate'],
      signal: { type: 'risk', source: 'user_query', description: 'Competitive threat detected', severity: 'high', recommendedFunction: 'strategy', confidence: 0.87 },
    },
    {
      keywords: ['price', 'pricing', 'cost', 'expensive', 'cheap', 'discount', 'margin'],
      signal: { type: 'anomaly', source: 'user_query', description: 'Pricing or margin issue', severity: 'medium', recommendedFunction: 'finance', confidence: 0.82 },
    },
    {
      keywords: ['brand', 'positioning', 'reputation', 'awareness', 'perception'],
      signal: { type: 'opportunity', source: 'user_query', description: 'Brand or positioning opportunity', severity: 'medium', recommendedFunction: 'marketing', confidence: 0.78 },
    },
    {
      keywords: ['legal', 'contract', 'compliance', 'GDPR', 'policy', 'regulation'],
      signal: { type: 'risk', source: 'user_query', description: 'Legal or compliance consideration', severity: 'high', recommendedFunction: 'legal_risk', confidence: 0.9 },
    },
    {
      keywords: ['data', 'KPI', 'metric', 'dashboard', 'measure', 'track', 'analytics'],
      signal: { type: 'opportunity', source: 'user_query', description: 'Analytics or measurement improvement', severity: 'low', recommendedFunction: 'analytics', confidence: 0.75 },
    },
    {
      keywords: ['system', 'automation', 'software', 'tool', 'integrate', 'tech', 'platform'],
      signal: { type: 'opportunity', source: 'user_query', description: 'Technology or automation opportunity', severity: 'medium', recommendedFunction: 'technology', confidence: 0.8 },
    },
    {
      keywords: ['schedule', 'meeting', 'calendar', 'inbox', 'organized', 'time'],
      signal: { type: 'anomaly', source: 'user_query', description: 'Administrative or scheduling issue', severity: 'low', recommendedFunction: 'admin', confidence: 0.7 },
    },
    // ADD MORE: product, strategy patterns
  ];

  /**
   * Detect business signals from a user query.
   */
  async detectSignals(query: string): Promise<BusinessSignal[]> {
    const lowerQuery = query.toLowerCase();
    const signals: BusinessSignal[] = [];

    for (const pattern of this.SIGNAL_PATTERNS) {
      const matches = pattern.keywords.some(kw => lowerQuery.includes(kw.toLowerCase()));
      if (matches) {
        signals.push({ ...pattern.signal, description: `${pattern.signal.description}: "${query.substring(0, 80)}..."` });
      }
    }

    if (signals.length > 0) {
      this.logger.log(`[SignalDetector] Found ${signals.length} signal(s) in query`);
    }

    return signals;
  }

  /**
   * Infer hidden risks that the user hasn't mentioned.
   */
  async inferHiddenRisks(query: string, detectedFunction: BusinessFunction): Promise<string[]> {
    const risks: string[] = [];
    const lowerQuery = query.toLowerCase();

    // Cross-functional risk inference
    if (detectedFunction === 'sales' && !lowerQuery.includes('cash')) {
      risks.push('Sales activity without cash flow monitoring could lead to working capital issues');
    }
    if (detectedFunction === 'marketing' && !lowerQuery.includes('conversion')) {
      risks.push('Marketing spend without conversion tracking may waste budget');
    }
    if (detectedFunction === 'operations' && !lowerQuery.includes('quality')) {
      risks.push('Scaling operations without quality controls risks customer satisfaction');
    }
    if (detectedFunction === 'finance' && !lowerQuery.includes('tax')) {
      risks.push('Financial decisions should consider tax implications');
    }

    return risks;
  }
}

interface SignalPattern {
  keywords: string[];
  signal: BusinessSignal;
}
