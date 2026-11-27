import { ForbiddenException } from '@nestjs/common';
import { describe, it, expect, vi } from 'vitest';
import {
  CaseStudyService,
  hasRevenueMetrics,
  isMonetaryOrOrderHeadline,
  redactCaseStudyForNonRevenueReader,
  sanitizeHeadlineForNonRevenueReader,
  type CaseStudy,
  type CaseStudyMetrics,
} from './case-study.service';
import { sanitizeBusiness } from '../../core/security/sanitize-business';
import { PROFILE_PATCH_RESERVED_META_KEYS } from '../identity/identity.service';

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
  it('strips revenue and online-orders clauses while keeping booking growth in canonical headline', () => {
    const out = sanitizeHeadlineForNonRevenueReader(
      'Acme (Port of Spain, TT) grew online orders 100% and grew revenue 300% and grew bookings 50% in 60 days',
      baseMetrics,
    );
    expect(out).toBe('Acme (Port of Spain, TT) grew bookings 50% in 60 days');
  });

  it('falls back to booked appointments when canonical headline only had revenue/orders clauses and bookings exist', () => {
    const out = sanitizeHeadlineForNonRevenueReader(
      'Acme (Port of Spain, TT) grew online orders 100% and grew revenue 300% in 60 days',
      baseMetrics,
    );
    expect(out).toBe('Acme (Port of Spain, TT) booked 3 appointments in 60 days');
  });

  it('falls back to generic storefront activity when canonical headline only had revenue and there are zero bookings', () => {
    const out = sanitizeHeadlineForNonRevenueReader(
      'Acme grew revenue 150% in 60 days',
      { ...baseMetrics, recentBookings: 0, priorBookings: 0, bookingGrowthPct: null },
    );
    expect(out).toBe('Acme recorded storefront activity in 60 days');
  });

  it('leaves canonical non-revenue booking headlines untouched', () => {
    const original = 'Acme booked 5 appointments in 60 days';
    expect(sanitizeHeadlineForNonRevenueReader(original, baseMetrics)).toBe(original);
  });

  it('fails closed on custom/legacy/multi-line/monetary/sales/order headlines instead of returning regex-patched prose', () => {
    const leakyHeadlines = [
      'Acme earned $4,800 from 12 orders in 60 days',
      'Acme grew sales 200% in 60 days',
      'Acme made TTD 4,800 in 60 days',
      'Acme hit 9,200 USD gross income',
      'Acme grew revenue 12.5% in 60 days',
      'Acme grew revenue -10% in 60 days',
      'Acme\nearned £2,500 in 60 days',
      'Acme closed €1,900 paid turnover',
      'Acme hit 42.5% growth in 60 days',
    ];

    for (const headline of leakyHeadlines) {
      expect(
        hasRevenueMetrics(makeStudy({ headline, metrics: { ...baseMetrics } })),
        `hasRevenueMetrics should be true for: ${headline}`,
      ).toBe(true);

      const redacted = redactCaseStudyForNonRevenueReader(
        makeStudy({ headline, metrics: { ...baseMetrics } }),
      );
      expect(redacted.headline).toBe('Booking activity grew 50% over the last 60 days');
      expect(hasRevenueMetrics(redacted)).toBe(false);
    }

    // Zero booking growth -> falls back to appointment count, or neutral summary when 0 bookings
    const noGrowthMetrics: CaseStudyMetrics = {
      ...baseMetrics,
      bookingGrowthPct: null,
    };
    expect(
      sanitizeHeadlineForNonRevenueReader('Acme earned $4,800 from 12 orders in 60 days', noGrowthMetrics),
    ).toBe('Booked 3 appointments over the last 60 days');

    const zeroBookingMetrics: CaseStudyMetrics = {
      ...baseMetrics,
      recentBookings: 0,
      priorBookings: 0,
      bookingGrowthPct: null,
    };
    expect(
      sanitizeHeadlineForNonRevenueReader('Acme made TTD 4,800 in 60 days', zeroBookingMetrics),
    ).toBe('Business activity summary (last 60 days)');
  });

  it('fails closed when a custom non-monetary headline belongs to a study that carried revenue metrics', () => {
    const study = makeStudy({ headline: 'Big quarter for Acme' });
    const redacted = redactCaseStudyForNonRevenueReader(study);
    expect(redacted.headline).toBe('Booking activity grew 50% over the last 60 days');
    expect(hasRevenueMetrics(redacted)).toBe(false);
  });

  it('detects currency symbols, ISO currency codes, and monetary/order words cleanly', () => {
    expect(isMonetaryOrOrderHeadline('Acme earned $4,800')).toBe(true);
    expect(isMonetaryOrOrderHeadline('Acme made TTD 4,800')).toBe(true);
    expect(isMonetaryOrOrderHeadline('Acme made 4,800 XOF')).toBe(true);
    expect(isMonetaryOrOrderHeadline('Acme grew sales 200%')).toBe(true);
    expect(isMonetaryOrOrderHeadline('Acme booked 5 appointments in 60 days')).toBe(false);
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

  it('hasRevenueMetrics returns false for canonical booking-only drafts and true for revenue/custom-monetary studies', () => {
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

describe('CaseStudyService.publish() fail-closed delegation (R1 Hardening 3)', () => {
  function makeServiceWithRow(storedStudy: CaseStudy, membership: { role: string; permissionScopes: unknown } | null) {
    let writtenMeta: Record<string, unknown> | null = null;
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'biz_1' }]),
      business: {
        findFirst: vi.fn().mockResolvedValue({ metaData: { caseStudies: [storedStudy] } }),
        update: vi.fn().mockImplementation(async ({ data }: { data: { metaData: Record<string, unknown> } }) => {
          writtenMeta = data.metaData;
          return { id: 'biz_1', metaData: data.metaData };
        }),
      },
    };
    const prisma = {
      client: {
        membership: {
          findUnique: vi.fn().mockResolvedValue(membership),
        },
        $transaction: vi.fn().mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx)),
      },
    };
    return {
      svc: new CaseStudyService(prisma as never),
      tx,
      getWrittenMeta: () => writtenMeta,
    };
  }

  it('fails closed (403) when publish() is called without userId on a revenue-bearing draft', async () => {
    const { svc, tx } = makeServiceWithRow(makeStudy(), null);
    await expect(
      svc.publish('biz_1', 'cs_2026_9', { consent: true }),
    ).rejects.toThrow(ForbiddenException);
    expect(tx.business.update).not.toHaveBeenCalled();
  });

  it('fails closed (403) when publish() is called by a revenue:none member on a revenue-bearing draft', async () => {
    const { svc, tx } = makeServiceWithRow(makeStudy(), {
      role: 'STAFF',
      permissionScopes: { content: 'write', revenue: 'none' },
    });
    await expect(
      svc.publish('biz_1', 'cs_2026_9', { consent: true, userId: 'u_staff' }),
    ).rejects.toThrow(ForbiddenException);
    expect(tx.business.update).not.toHaveBeenCalled();
  });

  it('succeeds when publish() is called by an OWNER on a revenue-bearing draft', async () => {
    const { svc, getWrittenMeta } = makeServiceWithRow(makeStudy(), {
      role: 'OWNER',
      permissionScopes: null,
    });
    const res = await svc.publish('biz_1', 'cs_2026_9', { consent: true, userId: 'u_owner' });
    expect(res.status).toBe('published');
    expect(res.metrics.recentRevenue).toBe(4800);
    expect(getWrittenMeta()).not.toBeNull();
  });
});

describe('sanitizeBusiness / maskMetaData strips metaData.caseStudies (R1 BLOCKER 1)', () => {
  it('omits metaData.caseStudies while preserving other metaData keys and leaving the input object unmutated', () => {
    const input = {
      id: 'biz_1',
      name: 'Acme',
      gmailAccessToken: 'secret-token',
      metaData: {
        theme: 'dark',
        caseStudies: [makeStudy()],
        whatsapp: { phoneNumberId: 'pn_1', accessToken: 'enc' },
      },
    };

    const sanitized = sanitizeBusiness(input);
    const meta = sanitized.metaData as Record<string, unknown>;

    expect(Object.prototype.hasOwnProperty.call(meta, 'caseStudies')).toBe(false);
    expect(JSON.stringify(sanitized)).not.toContain('4800');
    expect(JSON.stringify(sanitized)).not.toContain('grew revenue');
    expect(meta.theme).toBe('dark');
    expect(meta.whatsapp).toEqual({ configured: true });
    // Input must remain unmutated
    expect(input.metaData.caseStudies).toHaveLength(1);
  });

  it('reserves caseStudies in PROFILE_PATCH_RESERVED_META_KEYS', () => {
    expect(PROFILE_PATCH_RESERVED_META_KEYS).toContain('caseStudies');
  });
});
