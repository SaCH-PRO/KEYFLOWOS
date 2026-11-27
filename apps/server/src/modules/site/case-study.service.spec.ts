import { describe, it, expect } from 'vitest';
import {
  hasRevenueMetrics,
  redactCaseStudyForNonRevenueReader,
  sanitizeHeadlineForNonRevenueReader,
  type CaseStudy,
  type CaseStudyMetrics,
} from './case-study.service';

const baseMetrics: CaseStudyMetrics = {
  windowDays: 60,
  currency: 'TTD',
  recentBookings: 3,
  priorBookings: 2,
  bookingGrowthPct: 50,
  topService: 'Facial',
};

const makeStudy = (overrides: Partial<CaseStudy> = {}): CaseStudy => ({
  id: 'cs_2026_9',
  businessId: 'biz_1',
  headline: 'Acme (Port of Spain, TT) grew online orders 100% and grew revenue 300% and grew bookings 50% in 60 days',
  location: 'Port of Spain, TT',
  industry: 'Beauty',
  metrics: {
    ...baseMetrics,
    recentOrders: 2,
    priorOrders: 1,
    recentRevenue: 4800,
    priorRevenue: 1200,
    orderGrowthPct: 100,
    revenueGrowthPct: 300,
    topProduct: 'Serum',
  },
  status: 'draft',
  consent: false,
  consentedAt: null,
  consentedBy: null,
  generatedAt: '2026-11-27T00:00:00.000Z',
  publishedAt: null,
  ...overrides,
});

describe('CaseStudyService revenue redaction helpers (FU-CASE-STUDY-REVENUE)', () => {
  it('strips revenue and online-orders clauses while keeping booking growth in headline', () => {
    const out = sanitizeHeadlineForNonRevenueReader(
      'Acme (Port of Spain, TT) grew online orders 100% and grew revenue 300% and grew bookings 50% in 60 days',
      baseMetrics,
    );
    expect(out).toBe('Acme (Port of Spain, TT) grew bookings 50% in 60 days');
  });

  it('falls back to booked appointments when headline only had revenue/orders clauses and bookings exist', () => {
    const out = sanitizeHeadlineForNonRevenueReader(
      'Acme (Port of Spain, TT) grew online orders 100% and grew revenue 300% in 60 days',
      baseMetrics,
    );
    expect(out).toBe('Acme (Port of Spain, TT) booked 3 appointments in 60 days');
  });

  it('falls back to generic storefront activity when headline only had revenue and there are zero bookings', () => {
    const out = sanitizeHeadlineForNonRevenueReader(
      'Acme grew revenue 150% in 60 days',
      { ...baseMetrics, recentBookings: 0, priorBookings: 0, bookingGrowthPct: null },
    );
    expect(out).toBe('Acme recorded storefront activity in 60 days');
  });

  it('leaves non-revenue booking headlines untouched', () => {
    const original = 'Acme booked 5 appointments in 60 days';
    expect(sanitizeHeadlineForNonRevenueReader(original, baseMetrics)).toBe(original);
  });

  it('allow-list redacts metrics so all revenue/paid-order keys are absent while currency and bookings stay', () => {
    const redacted = redactCaseStudyForNonRevenueReader(makeStudy());
    for (const k of [
      'recentRevenue',
      'priorRevenue',
      'revenueGrowthPct',
      'recentOrders',
      'priorOrders',
      'orderGrowthPct',
      'topProduct',
    ]) {
      expect(Object.prototype.hasOwnProperty.call(redacted.metrics, k)).toBe(false);
    }
    expect(redacted.metrics).toEqual(baseMetrics);
    expect(hasRevenueMetrics(redacted)).toBe(false);
  });

  it('hasRevenueMetrics detects revenue/paid-order fields or headline mentions, and returns false for booking-only drafts', () => {
    expect(hasRevenueMetrics(makeStudy())).toBe(true);
    expect(
      hasRevenueMetrics(
        makeStudy({
          headline: 'Acme booked 3 appointments in 60 days',
          metrics: { ...baseMetrics },
        }),
      ),
    ).toBe(false);
    expect(
      hasRevenueMetrics(
        makeStudy({
          headline: 'Acme grew revenue 10% in 60 days',
          metrics: { ...baseMetrics },
        }),
      ),
    ).toBe(true);
  });
});
