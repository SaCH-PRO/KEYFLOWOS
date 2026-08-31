import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CurrencyRatesService } from './currency-rates.service';

type FetchResponse = { ok: boolean; status: number; json: () => Promise<unknown> };
type FetchMock = (url: string, init?: { signal?: AbortSignal }) => Promise<FetchResponse>;

function okJson(body: unknown): FetchResponse {
  return { ok: true, status: 200, json: async () => body };
}

describe('CurrencyRatesService', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('falls back to seed rates before any refresh succeeds', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network down'));
    const svc = new CurrencyRatesService(fetchImpl);
    const result = await svc.toTtd(100, 'USD');
    expect(result).toBeCloseTo(678, 0);
    expect(svc.getSnapshot().source).toBe('fallback');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('derives live cross-rates from the USD anchor after a refresh', async () => {
    // The provider does NOT quote TTD, so the fixture no longer pretends it
    // does. TTD comes from the anchor; everything else is live and crossed
    // through USD.
    const fetchImpl = vi.fn().mockResolvedValue(
      okJson({
        amount: 1,
        base: 'EUR',
        date: '2026-05-04',
        rates: { USD: 1.1, GBP: 0.85 },
      }),
    );
    const svc = new CurrencyRatesService(fetchImpl);

    const usd = await svc.toTtd(100, 'usd');
    // The anchor itself: 100 USD = 100 x 6.78 TTD.
    expect(usd).toBeCloseTo(678, 2);

    // 1 EUR buys 1.1 USD, each worth 6.78 TTD -> 7.458 ; 10 EUR = 74.58
    const eur = await svc.toTtd(10, 'EUR');
    expect(eur).toBeCloseTo(74.58, 2);

    // 1 GBP = (6.78 x 1.1) / 0.85 = 8.7727 ; 10 GBP = 87.73
    const gbp = await svc.toTtd(10, 'GBP');
    expect(gbp).toBeCloseTo(87.73, 1);

    const ttd = await svc.toTtd(50, 'TTD');
    expect(ttd).toBe(50);

    expect(svc.getSnapshot().source).toBe('live');
    // Cached: a second conversion should not hit the network again.
    await svc.toTtd(1, 'USD');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('returns null for unknown currencies', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      okJson({ rates: { TTD: 7.5, USD: 1.1 } }),
    );
    const svc = new CurrencyRatesService(fetchImpl);
    expect(await svc.toTtd(10, 'XYZ')).toBeNull();
  });

  it('keeps the last successful snapshot when a later refresh fails', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(okJson({ rates: { USD: 1.1 } }))
      .mockRejectedValueOnce(new Error('boom'));
    const svc = new CurrencyRatesService(fetchImpl);
    await svc.refreshNow();
    expect(svc.getSnapshot().source).toBe('live');
    await svc.refreshNow().catch(() => undefined);
    // Still serves the previously cached live rate.
    const usd = await svc.toTtd(100, 'USD');
    expect(usd).toBeCloseTo(678, 2);
  });

  it('treats a non-200 response as a failure and falls back', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
    const svc = new CurrencyRatesService(fetchImpl);
    const usd = await svc.toTtd(100, 'USD');
    expect(usd).toBeCloseTo(678, 0);
    expect(svc.getSnapshot().source).toBe('fallback');
  });

  it('accepts a response with no TTD rate, because the provider never sends one', async () => {
    // THIS TEST USED TO ASSERT THE BUG. It required the refresh to FAIL when
    // TTD was absent, and TTD is absent from every real response
    // frankfurter.app has ever returned — ECB reference rates do not include
    // it. So the behaviour it pinned was "never refresh, ever", and it passed
    // for exactly that reason.
    //
    //   GET /latest?from=EUR&to=TTD,JMD,BBD,XCD,GYD,USD
    //   -> {"rates":{"USD":1.1643}}
    const fetchImpl = vi.fn().mockResolvedValue(okJson({ rates: { USD: 1.1 } }));
    const svc = new CurrencyRatesService(fetchImpl);
    await svc.toTtd(1, 'USD');
    expect(svc.getSnapshot().source).toBe('live');
  });

  it('still fails when the USD anchor is missing', async () => {
    // USD is the one the provider DOES quote and the one everything crosses
    // through, so its absence is a real failure rather than an expected gap.
    const fetchImpl = vi.fn().mockResolvedValue(okJson({ rates: { GBP: 0.85 } }));
    const svc = new CurrencyRatesService(fetchImpl);
    await svc.toTtd(1, 'USD');
    expect(svc.getSnapshot().source).toBe('fallback');
  });

  it('keeps a baseline for currencies the provider does not quote', async () => {
    // JMD, BBD, XCD and GYD are never quoted. They must not vanish, and their
    // absence must not fail the refresh for everyone else.
    const fetchImpl = vi.fn().mockResolvedValue(okJson({ rates: { USD: 1.1 } }));
    const svc = new CurrencyRatesService(fetchImpl);
    await svc.refreshNow();
    expect(svc.getSnapshot().source).toBe('live');
    expect(await svc.toTtd(100, 'JMD')).toBeCloseTo(4.3, 1);
  });

  it('the TTD anchor can be corrected without a deploy', async () => {
    process.env.TTD_PER_USD = '7.00';
    try {
      const fetchImpl = vi.fn().mockResolvedValue(okJson({ rates: { USD: 1.1 } }));
      const svc = new CurrencyRatesService(fetchImpl);
      expect(await svc.toTtd(100, 'USD')).toBeCloseTo(700, 2);
    } finally {
      delete process.env.TTD_PER_USD;
    }
  });

  it('coalesces concurrent refreshes into a single fetch', async () => {
    let resolveFetch!: (value: FetchResponse) => void;
    const fetchImpl: FetchMock = vi.fn().mockImplementation(
      () =>
        new Promise<FetchResponse>((res) => {
          resolveFetch = res;
        }),
    );
    const svc = new CurrencyRatesService(fetchImpl);
    const p1 = svc.toTtd(1, 'USD');
    const p2 = svc.toTtd(2, 'USD');
    resolveFetch(okJson({ rates: { TTD: 7.5, USD: 1.1 } }));
    await Promise.all([p1, p2]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('backs off subsequent refresh attempts after a fallback failure', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network down'));
    const svc = new CurrencyRatesService(fetchImpl);
    await svc.toTtd(1, 'USD');
    await svc.toTtd(1, 'USD');
    await svc.toTtd(1, 'USD');
    // Second + third calls hit the backoff window, so only one fetch attempt.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
