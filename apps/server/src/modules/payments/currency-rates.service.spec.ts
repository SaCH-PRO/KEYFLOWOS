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

  it('uses live rates derived from EUR base after a successful refresh', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      okJson({
        amount: 1,
        base: 'EUR',
        date: '2026-05-04',
        rates: { TTD: 7.5, USD: 1.1, GBP: 0.85 },
      }),
    );
    const svc = new CurrencyRatesService(fetchImpl);

    const usd = await svc.toTtd(100, 'usd');
    // 1 USD = (EUR->TTD)/(EUR->USD) = 7.5/1.1 ≈ 6.818181 TTD ; 100 USD ≈ 681.82
    expect(usd).toBeCloseTo(681.82, 2);

    const eur = await svc.toTtd(10, 'EUR');
    expect(eur).toBeCloseTo(75, 2);

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
      .mockResolvedValueOnce(okJson({ rates: { TTD: 7.5, USD: 1.1 } }))
      .mockRejectedValueOnce(new Error('boom'));
    const svc = new CurrencyRatesService(fetchImpl);
    await svc.refreshNow();
    expect(svc.getSnapshot().source).toBe('live');
    await svc.refreshNow().catch(() => undefined);
    // Still serves the previously cached live rate.
    const usd = await svc.toTtd(100, 'USD');
    expect(usd).toBeCloseTo(681.82, 2);
  });

  it('treats a non-200 response as a failure and falls back', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
    const svc = new CurrencyRatesService(fetchImpl);
    const usd = await svc.toTtd(100, 'USD');
    expect(usd).toBeCloseTo(678, 0);
    expect(svc.getSnapshot().source).toBe('fallback');
  });

  it('rejects responses missing the TTD rate', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okJson({ rates: { USD: 1.1 } }));
    const svc = new CurrencyRatesService(fetchImpl);
    await svc.toTtd(1, 'USD');
    expect(svc.getSnapshot().source).toBe('fallback');
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
