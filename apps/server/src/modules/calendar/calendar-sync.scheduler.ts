import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { CalendarSyncService } from './calendar-sync.service';
import { safeInterval } from '../../core/scheduling/safe-interval';

const TICK_INTERVAL_MS = 60 * 60 * 1000; // hourly
const STARTUP_DELAY_MS = 90 * 1000;
const PER_BUSINESS_GAP_MS = 750;
const MAX_CONSECUTIVE_ERRORS_BEFORE_BACKOFF = 5;

/**
 * Hourly Google Calendar resync. Walks every connected business and runs a
 * push + (optional) pull cycle. Gated by KF_DISABLE_SCHEDULERS=1 so test
 * environments don't hit Google. Per-business backoff: skip the tick when
 * the last cycle failed N+ times in a row (still attempted on the manual
 * resync from the UI).
 */
@Injectable()
export class CalendarSyncScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CalendarSyncScheduler.name);
  private startupTimer: ReturnType<typeof setTimeout> | null = null;
  private intervalRef: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(@Inject(CalendarSyncService) private readonly sync: CalendarSyncService) {}

  onModuleInit(): void {
    if (process.env.KF_DISABLE_SCHEDULERS === '1' || process.env.KF_DISABLE_SCHEDULERS === 'true') {
      this.logger.log('Calendar sync scheduler disabled via KF_DISABLE_SCHEDULERS');
      return;
    }
    this.startupTimer = setTimeout(() => {
      void this.tick();
      this.intervalRef = safeInterval('CalendarSyncScheduler', TICK_INTERVAL_MS, () => this.tick(), this.logger);
    }, STARTUP_DELAY_MS);
  }

  onModuleDestroy(): void {
    if (this.startupTimer) clearTimeout(this.startupTimer);
    if (this.intervalRef) clearInterval(this.intervalRef);
    this.startupTimer = null;
    this.intervalRef = null;
  }

  async tick(): Promise<void> {
    if (this.running) {
      this.logger.warn('Skipping calendar sync tick: previous run still in progress');
      return;
    }
    this.running = true;
    try {
      const ids = await this.sync.listConnectedBusinessIds();
      if (ids.length === 0) return;
      this.logger.log(`Running hourly calendar resync for ${ids.length} businesses`);
      for (const id of ids) {
        try {
          const settings = await this.sync.getSettings(id);
          if (settings.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS_BEFORE_BACKOFF) {
            this.logger.warn(`Skipping ${id} due to ${settings.consecutiveErrors} consecutive errors`);
            continue;
          }
          await this.sync.runResyncCycle(id);
        } catch (err: any) {
          this.logger.warn(`Calendar resync failed for ${id}: ${(err as Error).message}`);
        }
        if (PER_BUSINESS_GAP_MS > 0) {
          await new Promise((r) => setTimeout(r, PER_BUSINESS_GAP_MS));
        }
      }
    } catch (err: any) {
      this.logger.error(`Calendar resync tick errored: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
