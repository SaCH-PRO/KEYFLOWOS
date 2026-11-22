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
    expect(isMoneyMemoryEvent({ sourceType: 'KEY_ACTION_PROPOSAL', eventType: 'ACTION_EXECUTED', domain: null, section: null })).toBe(true);
    expect(isMoneyMemoryEvent({ sourceType: 'OPERATIONS_GENOME', eventType: 'OPERATIONS_SNAPSHOT_COMPUTED', domain: 'OPERATIONS', section: 'OPERATIONS' })).toBe(false);
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
