import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PresenceStatsService } from './presence-stats.service';

const TICK_MS = 60 * 60 * 1000; // hourly probe; only runs at the configured UTC hour
const AGG_HOUR_UTC = parseInt(process.env.PRESENCE_AGG_HOUR_UTC ?? '2', 10);
const RETENTION_DAYS = parseInt(process.env.PRESENCE_RAW_RETENTION_DAYS ?? '90', 10);

/**
 * Nightly job that:
 *   1. Re-aggregates yesterday's PublicEvent rows into PresenceDailyStat.
 *   2. Deletes raw events older than RETENTION_DAYS.
 *
 * Hourly tick is intentional — the worker only acts when the UTC hour
 * matches AGG_HOUR_UTC, but staggered restarts can't miss the window.
 */
@Injectable()
export class PresenceAggregatorScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PresenceAggregatorScheduler.name);
  private intervalRef: ReturnType<typeof setInterval> | null = null;
  private lastRunDay: string | null = null;

  constructor(@Inject(PresenceStatsService) private readonly stats: PresenceStatsService) {}

  onModuleInit() {
    if (process.env.DISABLE_SCHEDULERS === '1' || process.env.NODE_ENV === 'test') {
      this.logger.log('[PresenceAggregatorScheduler] Disabled via env');
      return;
    }
    this.logger.log(`[PresenceAggregatorScheduler] Starting — agg @ ${AGG_HOUR_UTC}:00 UTC, retention ${RETENTION_DAYS}d`);
    this.intervalRef = setInterval(() => {
      void this.maybeRun().catch((e) =>
        this.logger.error(`Tick failed: ${(e as Error).message}`),
      );
    }, TICK_MS);
  }

  onModuleDestroy() {
    if (this.intervalRef) clearInterval(this.intervalRef);
    this.intervalRef = null;
  }

  private async maybeRun() {
    const now = new Date();
    if (now.getUTCHours() !== AGG_HOUR_UTC) return;
    const todayKey = now.toISOString().slice(0, 10);
    if (this.lastRunDay === todayKey) return;
    this.lastRunDay = todayKey;

    const agg = await this.stats.aggregateYesterdayAllBusinesses();
    const cleanup = await this.stats.cleanupRawEvents(RETENTION_DAYS);
    this.logger.log(
      `[PresenceAggregatorScheduler] aggregated businesses=${agg.businesses} rows=${agg.rows} | cleaned=${cleanup.deleted}`,
    );
  }
}
