import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { CurrencyRatesService } from './currency-rates.service';
import { safeInterval } from '../../core/scheduling/safe-interval';

const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
const STARTUP_DELAY_MS = 30 * 1000;

/**
 * Drives the daily refresh of FX rates so the in-memory cache in
 * `CurrencyRatesService` stays current even when traffic is sparse. The
 * service itself is the source of truth for caching/fallback; this just
 * pokes it on a schedule and on boot.
 */
@Injectable()
export class CurrencyRatesScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CurrencyRatesScheduler.name);
  private startupTimeout: ReturnType<typeof setTimeout> | null = null;
  private intervalRef: ReturnType<typeof setInterval> | null = null;

  constructor(@Inject(CurrencyRatesService) private readonly fx: CurrencyRatesService) {}

  onModuleInit(): void {
    this.startupTimeout = setTimeout(() => {
      void this.refresh();
      this.intervalRef = safeInterval('CurrencyRatesScheduler', REFRESH_INTERVAL_MS, () => this.refresh(), this.logger);
    }, STARTUP_DELAY_MS);
  }

  onModuleDestroy(): void {
    if (this.startupTimeout) {
      clearTimeout(this.startupTimeout);
      this.startupTimeout = null;
    }
    if (this.intervalRef) {
      clearInterval(this.intervalRef);
      this.intervalRef = null;
    }
  }

  private async refresh(): Promise<void> {
    try {
      const snap = await this.fx.refreshNow();
      this.logger.log(
        `FX rates refreshed (source=${snap.source}, fetchedAt=${snap.fetchedAt.toISOString()})`,
      );
    } catch (err: any) {
      this.logger.warn(
        `FX rate refresh failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
