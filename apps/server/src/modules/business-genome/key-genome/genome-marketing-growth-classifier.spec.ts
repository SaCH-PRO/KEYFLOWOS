/**
 * FU-GENOME-SURFACES-REVENUE round 3 (both reviews; D-234, D-100). The marketing-growth snapshot withholds what its
 * budget shares, CAC targets and conversion targets produce (the channel concentration warning, the diversification
 * score, the overall risk, the missing CAC and conversion inputs). The rows MarketingGenomeService files from the same
 * snapshot must be classified the same way, or they serve it back through GET signals, recommendations and memory:
 *
 *   MGC-01  a signal filed from the snapshot (sourceEntityType MARKETING_GROWTH_GENOME) is money unless its field is a
 *           content or channel-count warning type (an allow-list: fails closed); the missing-inputs signal is money
 *   MGC-02  a MARKETING_GROWTH recommendation whose title, insight, diagnosis, recommendation or expected gain speaks of
 *           acquisition cost, budget or conversion (DIVERSIFY_CHANNELS: "CAC risk"; COMPLETE_MARKETING_INPUTS:
 *           "target_cac") is money; a content recommendation is not
 *   MGC-03  the MARKETING_GROWTH_SNAPSHOT_COMPUTED memory event (its summary, outcome, impact score and metadata state
 *           the overall risk and diversification) is money; the signal-generated count event is not
 */
import { describe, expect, it } from 'vitest';
import { isFinanceRecommendation, isFinanceSignal, isMoneyMemoryEvent } from './genome-finance-scope';

const signal = (field: string) => ({
  sourceModule: 'marketing',
  sourceEntityType: 'MARKETING_GROWTH_GENOME',
  signalType: 'RISK_PATTERN',
  section: 'MARKETING_GROWTH',
  domain: 'marketing_growth',
  field,
});

describe('FU-GENOME-SURFACES-REVENUE round 3: marketing-growth rows are classified as the snapshot is', () => {
  it('MGC-01 snapshot signals: money unless a content or channel-count type', () => {
    for (const field of ['CHANNEL_CONCENTRATION', 'missing_inputs', 'HIGH_TARGET_CAC', 'SOMETHING_NEW']) {
      expect(isFinanceSignal(signal(field)), field).toBe(true);
    }
    for (const field of ['NO_CONTENT_STRATEGY', 'MISSING_CONTENT_PILLARS', 'MISSING_CONTENT_CADENCE']) {
      expect(isFinanceSignal(signal(field)), field).toBe(false);
    }
    // A marketing signal from another writer is classified as before.
    expect(
      isFinanceSignal({
        sourceModule: 'marketing',
        section: 'MARKETING_GROWTH',
        domain: 'marketing_growth',
        field: 'cadence',
      }),
    ).toBe(false);
  });

  it('MGC-02 marketing-growth recommendations whose text speaks of CAC, budget or conversion are money', () => {
    expect(
      isFinanceRecommendation({
        domain: 'MARKETING_GROWTH',
        title: 'Diversify growth channels',
        insight: 'Channel concentration increases volatility and CAC risk.',
      } as any),
    ).toBe(true);
    expect(
      isFinanceRecommendation({
        domain: 'MARKETING_GROWTH',
        title: 'Complete missing marketing/growth inputs',
        diagnosis: 'Missing inputs: channel_target_cac, channel_target_conversion_rate.',
      } as any),
    ).toBe(true);
    expect(
      isFinanceRecommendation({
        domain: 'MARKETING_GROWTH',
        title: 'Set a content cadence',
        insight: 'Consistency builds trust.',
        diagnosis: 'No cadence.',
        recommendation: 'Publish weekly.',
      } as any),
    ).toBe(false);
  });

  it('MGC-03 the snapshot-computed memory event is money', () => {
    expect(
      isMoneyMemoryEvent({
        sourceType: 'MARKETING_GROWTH_GENOME',
        eventType: 'MARKETING_GROWTH_SNAPSHOT_COMPUTED',
        domain: 'MARKETING_GROWTH',
        section: 'MARKETING_GROWTH',
      }),
    ).toBe(true);
    expect(
      isMoneyMemoryEvent({
        sourceType: 'MARKETING_GROWTH_GENOME',
        eventType: 'MARKETING_GROWTH_SIGNAL_GENERATED',
        domain: 'MARKETING_GROWTH',
        section: 'MARKETING_GROWTH',
      }),
    ).toBe(false);
  });
});
