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

  /**
   * THE PROVIDER HAS NEVER QUOTED TTD, AND THIS DEMANDED IT.
   *
   * frankfurter.app serves ECB reference rates — about thirty major
   * currencies. TTD is not among them, and neither are JMD, BBD, XCD or GYD.
   * Measured directly against the provider:
   *
   *   GET /latest?from=EUR&to=TTD,JMD,BBD,XCD,GYD,USD
   *   -> {"rates":{"USD":1.1643}}
   *
   * The old code read `rates['TTD']`, found nothing, and threw
   * "FX provider response missing TTD rate" — discarding the rates the
   * provider HAD returned. So the refresh could never succeed, not once, and
   * every currency silently stayed on the hardcoded baseline while the
   * scheduler retried every fifteen minutes forever and logged an error each
   * time. Observed in the boot log before it was traced.
   *
   * That is not a provider outage waiting to clear. The base currency of this
   * product is one this provider does not carry, which no amount of retrying
   * fixes.
   *
   * SO THE TABLE IS ANCHORED ON USD INSTEAD. TTD is a managed rate against the
   * US dollar, not a free float, so one anchor plus live cross-rates is both
   * more accurate and more honest than pretending the whole table is live:
   *
   *   rates[code] = (TTD per USD) x (USD per EUR) / (code per EUR)
   *
   * Every currency the provider quotes is now live — USD, EUR, GBP, CAD, AUD
   * today — where previously none of them were. The Caribbean currencies it
   * does not quote keep their baseline, which is what they had anyway, and
   * they are pegged or managed so a baseline is defensible for them in a way
   * it is not for a floating major.
   *
   * The anchor is overridable with TTD_PER_USD so a rate move can be corrected
   * without a deploy. It is a number a human has to maintain, and pretending
   * otherwise is what produced this bug.
   */
  private ttdPerUsd(): number {
    const override = Number(process.env.TTD_PER_USD);
    if (Number.isFinite(override) && override > 0) return override;
    return FALLBACK_FX_TO_TTD.USD;
  }

  private async fetchLive(): Promise<FxRatesSnapshot> {
    const symbols = SUPPORTED_CURRENCIES.filter((c) => c !== 'EUR' && c !== 'TTD').join(',');
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

      const quoted = (code: string): number | null => {
        const v = raw[code];
        return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
      };

      // USD is the anchor, so its absence IS a failure — unlike TTD, this one
      // the provider does quote, and without it there is nothing to convert
      // through.
      const eurToUsd = quoted('USD');
      if (eurToUsd == null) {
        throw new Error('FX provider response missing USD rate');
      }

      const ttdPerUsd = this.ttdPerUsd();
      const rates: Record<string, number> = {
        TTD: 1,
        USD: ttdPerUsd,
        // 1 EUR buys eurToUsd dollars, each worth ttdPerUsd.
        EUR: Math.round(ttdPerUsd * eurToUsd * 1_000_000) / 1_000_000,
      };

      for (const code of SUPPORTED_CURRENCIES) {
        if (code === 'TTD' || code === 'USD' || code === 'EUR') continue;
        const eurToCode = quoted(code);
        if (eurToCode != null) {
          // (TTD per USD) x (USD per EUR) / (code per EUR) = TTD per code.
          rates[code] = Math.round((ttdPerUsd * eurToUsd / eurToCode) * 1_000_000) / 1_000_000;
        } else {
          // Not quoted — keep what we had, else the baseline. Expected for the
          // Caribbean currencies, and not an error.
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
