/**
 * FU-GENOME-REVENUE-CLASSIFIER (owner rulings D-233, D-234; D-128, D-100): the genome rows and DNA
 * scores a reader without revenue read is not served, classified by provenance and meaning. Each case
 * is the shape a real writer files (see the packet's inventory).
 */
import { describe, it, expect } from 'vitest';
import { dnaScoresForReader, isFinanceRecommendation, isFinanceSignal, isMoneyMemoryEvent } from './genome-finance-scope';

describe('signals (D-234: by provenance, ambiguous fails closed)', () => {
  it.each([
    ['FinanceGenomeService', { sourceModule: 'finance', section: 'FINANCIAL', domain: 'finance' }],
    ['CustomerSalesGenomeService', { sourceModule: 'crm', section: 'SALES', domain: 'customer_sales' }],
    ['TemporalFlowGenomeBridge collections', { sourceModule: 'temporal_flow', section: 'sales', domain: 'collections' }],
    ['TemporalFlowGenomeBridge invoice complaints', { sourceModule: 'temporal_flow', section: 'risk', domain: 'revenue' }],
    ['KeyInboxService invoice request', { sourceModule: 'key_inbox', section: 'sales', domain: 'requests' }],
    ['KeyProactiveEngine cashflow', { sourceModule: 'key_autonomy', section: 'FINANCE', domain: 'cashflow' }],
    ['KeyProactiveEngine leads', { sourceModule: 'key_autonomy', section: 'SALES', domain: 'leads' }],
    ['ConversationGenomeExtractor', { sourceModule: 'key-chat', section: 'FINANCIAL', domain: 'stated_fact' }],
    ['a revenue pattern under any label', { sourceModule: 'key_inbox', section: 'operations', domain: 'inbox', signalType: 'REVENUE_PATTERN' }],
    ['unclassifiable (bridge createSignal default)', { sourceModule: 'key_cortex', section: 'general', domain: 'general' }],
    ['no section or domain', { sourceModule: 'device' }],
  ])('%s is revenue-sensitive', (_w, row) => {
    expect(isFinanceSignal(row as any)).toBe(true);
  });

  it.each([
    ['OperationsGenomeService', { sourceModule: 'operations', section: 'OPERATIONS_DELIVERY', domain: 'operations' }],
    ['DeviceService contact fact', { sourceModule: 'device', section: 'customerModel', domain: 'contacts' }],
    ['KeyInboxService bookings', { sourceModule: 'key_inbox', section: 'operations', domain: 'bookings' }],
    ['KeyProactiveEngine tasks', { sourceModule: 'key_autonomy', section: 'OPERATIONS', domain: 'tasks' }],
  ])('%s is not', (_w, row) => {
    expect(isFinanceSignal(row as any)).toBe(false);
  });
});

describe('recommendations and memory events (D-234)', () => {
  it('SALES and FINANCIAL recommendations and one with no domain are revenue-sensitive; OPERATIONS is not', () => {
    expect(isFinanceRecommendation({ domain: 'SALES' })).toBe(true);
    expect(isFinanceRecommendation({ domain: 'FINANCIAL' })).toBe(true);
    expect(isFinanceRecommendation({ domain: null })).toBe(true);
    expect(isFinanceRecommendation({ domain: 'OPERATIONS' })).toBe(false);
  });

  it('customer-sales events, outcome events copied from a SALES row and events with nothing to classify are money; an operations event is not', () => {
    expect(isMoneyMemoryEvent({ sourceType: 'CUSTOMER_SALES_GENOME', eventType: 'CUSTOMER_SALES_SIGNAL_GENERATED', domain: 'SALES', section: 'SALES' })).toBe(true);
    expect(isMoneyMemoryEvent({ sourceType: 'GENOME_RECOMMENDATION', eventType: 'RECOMMENDATION_ACCEPTED', domain: 'SALES' })).toBe(true);
    // PROVISIONAL (D-234 read against D-226): a proposal outcome with nothing to classify stays a business-wide proposal record.
    expect(isMoneyMemoryEvent({ sourceType: 'KEY_ACTION_PROPOSAL', eventType: 'ACTION_EXECUTED', domain: null, section: null })).toBe(false);
    expect(isMoneyMemoryEvent({ sourceType: 'GENOME_EXPERIMENT', eventType: 'EXPERIMENT_STARTED', domain: null, section: null })).toBe(true);
    expect(isMoneyMemoryEvent({ sourceType: 'OPERATIONS_GENOME', eventType: 'OPERATIONS_SNAPSHOT_COMPUTED', domain: 'OPERATIONS', section: 'OPERATIONS' })).toBe(false);
  });
});

describe('review repairs (MAJOR-2, MINOR-2)', () => {
  it('MAJOR-2: a recommendation GenomeRecommendationService made from a money signal is money, though its domain is the signal section (risk)', () => {
    expect(isFinanceRecommendation({
      domain: 'risk',
      title: 'Risk Pattern in revenue',
      diagnosis: 'A Risk Pattern signal was detected in revenue.repeated_invoice_complaints with 90% confidence.',
    } as any)).toBe(true);
    expect(isFinanceRecommendation({
      domain: 'operations',
      title: 'Operations Pattern in inbox',
      diagnosis: 'A Operations Pattern signal was detected in inbox with 80% confidence.',
    } as any)).toBe(false);
  });

  it.each(['cac_payback', 'ltv_cac', 'sale_closed', 'unit_cost'])('MINOR-2: the snake_case money value %s is money', (domain) => {
    expect(isFinanceSignal({ sourceModule: 'key-chat', section: 'MARKETING', domain })).toBe(true);
  });
});

describe('security review repairs (MAJOR-4, MAJOR-5)', () => {
  it('MAJOR-4: a marketing signal whose field is the acquisition-cost target, and the REDUCE_CAC recommendation, are money', () => {
    expect(isFinanceSignal({ sourceModule: 'marketing', section: 'MARKETING_GROWTH', domain: 'marketing_growth', field: 'HIGH_TARGET_CAC' } as any)).toBe(true);
    expect(isFinanceRecommendation({ domain: 'MARKETING_GROWTH', title: 'Reduce target CAC for Paid social', insight: 'High target CAC can erode unit economics.' } as any)).toBe(true);
    expect(isFinanceSignal({ sourceModule: 'marketing', section: 'MARKETING_GROWTH', domain: 'marketing_growth', field: 'NO_CONTENT_PLAN' } as any)).toBe(false);
  });

  it.each(['first_sale', 'customer_ltv', 'target_cac', 'average_cost', 'conversion_rate', 'deal_size', 'order_volume', 'sales_pipeline', 'revenue_forecast', 'mrr', 'churn_rate', 'expense_ratio', 'roi', 'unit_economics', 'CrossDomain'])(
    'MAJOR-5: the value %s is money',
    (domain) => expect(isFinanceSignal({ sourceModule: 'key-chat', section: 'CUSTOMER_MARKET', domain })).toBe(true),
  );

  it('MAJOR-5: a fact KEY extracted from chat under BUSINESS_MODEL (revenue model, pricing) fails closed whatever domain the model chose', () => {
    expect(isFinanceSignal({ sourceModule: 'key-chat', section: 'BUSINESS_MODEL', domain: 'model' })).toBe(true);
    expect(isFinanceRecommendation({ domain: 'BUSINESS_MODEL' })).toBe(true);
  });
});

describe('DNA scores (D-233: a finance or sales score is finance; unknown keys fail closed)', () => {
  const dna = { execution: 50, strategy: 60, finance: 40, financial: 41, sales: 70, revenue: 71, cost: 72, marketing: 55, operations: 65, send_invoice: 30, founder: 80 };
  it('a reader without revenue read keeps only the listed non-money dimensions', () => {
    expect(dnaScoresForReader(dna, false)).toEqual({ execution: 50, strategy: 60, marketing: 55, operations: 65, founder: 80 });
  });
  it('a revenue reader keeps every score, unchanged', () => {
    expect(dnaScoresForReader(dna, true)).toBe(dna);
  });
  it('no scores stays no scores', () => {
    expect(dnaScoresForReader(undefined, false)).toEqual({});
  });
});
