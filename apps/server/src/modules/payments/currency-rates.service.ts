import { Injectable, Logger, Inject, Optional } from '@nestjs/common';

/**
 * Hardcoded snapshot of TTD exchange rates used as the seed cache and as the
 * last-resort fallback when the live FX provider is unreachable on a cold
 * boot. These rates are intentionally conservative; once the service has
 * fetched a live snapshot, the in-memory cache supersedes them.
 */
const FALLBACK_FX_TO_TTD: Record<string, number> = {
  TTD: 1,
  USD: 6.78,
  EUR: 7.4,
  GBP: 8.6,
  CAD: 5.0,
  AUD: 4.5,
  JMD: 0.043,
  BBD: 3.39,
  XCD: 2.51,
  GYD: 0.032,
};

const SUPPORTED_CURRENCIES = Object.keys(FALLBACK_FX_TO_TTD);
const REFRESH_TTL_MS = 24 * 60 * 60 * 1000;
const FAILURE_BACKOFF_MS = 15 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5_000;
const PROVIDER_URL = 'https://api.frankfurter.app/latest';

export interface FxRatesSnapshot {
  rates: Record<string, number>;
  fetchedAt: Date;
  source: 'live' | 'fallback';
}

type FetchFn = (
  url: string,
  init?: { signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

/**
 * Provides currency -> TTD exchange rates. Rates are pulled from
 * frankfurter.app (an open ECB-backed FX API that needs no credentials),
 * cached in-memory for 24h, and fall back to the last successful snapshot —
 * or a hardcoded baseline — whenever the provider is unavailable.
 *
 * The conversion path is `from -> EUR -> TTD` because frankfurter quotes
 * everything against a single base. We request rates with `base=EUR` and
 * include both the source currency and TTD in the symbol list, then divide.
 */
@Injectable()
export class CurrencyRatesService {
  private readonly logger = new Logger(CurrencyRatesService.name);
  private snapshot: FxRatesSnapshot;
  private inflight: Promise<FxRatesSnapshot> | null = null;
  private lastAttemptAt = 0;
  private readonly fetchImpl: FetchFn;

  constructor(@Optional() @Inject('CURRENCY_RATES_FETCH_IMPL') fetchImpl?: FetchFn) {
    this.fetchImpl =
      fetchImpl ??
      ((url, init) =>
        fetch(url, init as RequestInit).then((r) => ({
          ok: r.ok,
          status: r.status,
          json: () => r.json(),
        })));
    this.snapshot = {
      rates: { ...FALLBACK_FX_TO_TTD },
      fetchedAt: new Date(0),
      source: 'fallback',
    };
  }

  getSnapshot(): FxRatesSnapshot {
    return { ...this.snapshot, rates: { ...this.snapshot.rates } };
  }

  /**
   * Convert `amount` in `currency` to TTD, refreshing the cached rate table
   * lazily if it is stale. Returns null when the currency is not supported
   * by either the live snapshot or the fallback table.
   */
  async toTtd(amount: number, currency: string): Promise<number | null> {
    const code = currency?.toUpperCase();
    if (!code) return null;
    await this.ensureFresh();
    const rate = this.snapshot.rates[code];
    if (rate == null || !Number.isFinite(rate)) return null;
    return Math.round(amount * rate * 100) / 100;
  }

  /** Force a refresh attempt regardless of TTL. Safe to call from a scheduler. */
  async refreshNow(): Promise<FxRatesSnapshot> {
    return this.refresh();
  }

  private async ensureFresh(): Promise<void> {
    const now = Date.now();
    const age = now - this.snapshot.fetchedAt.getTime();
    if (this.snapshot.source === 'live' && age < REFRESH_TTL_MS) return;
    // Back off after a recent failed attempt so a provider outage cannot
    // trigger a network call on every request while we serve fallback rates.
    if (this.lastAttemptAt && now - this.lastAttemptAt < FAILURE_BACKOFF_MS) return;
    try {
      await this.refresh();
    } catch (err: any) {
      this.logger.warn(
        `FX refresh failed, continuing with ${this.snapshot.source} rates from ${this.snapshot.fetchedAt.toISOString()}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  private async refresh(): Promise<FxRatesSnapshot> {
    if (this.inflight) return this.inflight;
    this.lastAttemptAt = Date.now();
    this.inflight = this.fetchLive()
      .then((next) => {
        this.snapshot = next;
        return next;
      })
      .finally(() => {
        this.inflight = null;
      });
    return this.inflight;
  }

  private async fetchLive(): Promise<FxRatesSnapshot> {
    const symbols = SUPPORTED_CURRENCIES.filter((c) => c !== 'EUR').join(',');
    const url = `${PROVIDER_URL}?from=EUR&to=${symbols}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await this.fetchImpl(url, { signal: controller.signal });
      if (!res.ok) {
        throw new Error(`FX provider returned HTTP ${res.status}`);
      }
      const body = (await res.json()) as { rates?: Record<string, unknown> };
      const raw = body?.rates;
      if (!raw || typeof raw !== 'object') {
        throw new Error('FX provider response missing `rates` map');
      }
      const eurToTtdRaw = raw['TTD'];
      const eurToTtd = typeof eurToTtdRaw === 'number' && Number.isFinite(eurToTtdRaw) ? eurToTtdRaw : null;
      if (eurToTtd == null || eurToTtd <= 0) {
        throw new Error('FX provider response missing TTD rate');
      }

      const rates: Record<string, number> = { TTD: 1, EUR: eurToTtd };
      for (const code of SUPPORTED_CURRENCIES) {
        if (code === 'TTD' || code === 'EUR') continue;
        const value = raw[code];
        if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
          // value = EUR -> code, so 1 unit of `code` in TTD = (EUR->TTD) / (EUR->code)
          rates[code] = Math.round((eurToTtd / value) * 1_000_000) / 1_000_000;
        } else {
          // Provider didn't quote this currency — keep last known value, else fallback baseline.
          const previous = this.snapshot.rates[code] ?? FALLBACK_FX_TO_TTD[code];
          if (previous != null) rates[code] = previous;
        }
      }
      return { rates, fetchedAt: new Date(), source: 'live' };
    } finally {
      clearTimeout(timeout);
    }
  }
}
