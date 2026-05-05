import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { CrmRelationshipHealthService } from './crm-relationship-health.service';

const TICK_INTERVAL_MS = 60 * 60 * 1000; // re-check the wall clock once per hour
const DEFAULT_TARGET_HOUR_UTC = 3; // run the daily sweep at 03:00 UTC

/**
 * Daily scheduler for `CrmRelationshipHealthService.recomputeAll`. Uses the
 * same self-managed `setInterval` pattern as `ConnectorSyncSchedulerService`
 * and `CrmSequenceSchedulerService` (no external dependency on
 * `@nestjs/schedule`). Runs once per UTC day, the first time the hourly tick
 * fires at or after the configured target hour.
 */
@Injectable()
export class CrmRelationshipHealthSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CrmRelationshipHealthSchedulerService.name);
  private intervalRef: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private lastRunDay: string | null = null;
  private readonly targetHourUtc: number;

  constructor(
    @Inject(CrmRelationshipHealthService)
    private readonly health: CrmRelationshipHealthService,
  ) {
    const env = Number(process.env.CRM_HEALTH_SCHEDULER_HOUR_UTC ?? '');
    this.targetHourUtc = Number.isFinite(env) && env >= 0 && env < 24 ? Math.floor(env) : DEFAULT_TARGET_HOUR_UTC;
  }

  onModuleInit() {
    if (process.env.CRM_HEALTH_SCHEDULER_DISABLED === '1') {
      this.logger.log('Relationship-health scheduler disabled via env');
      return;
    }
    this.intervalRef = setInterval(() => {
      this.tick().catch((err) => this.logger.error('Tick failed', err));
    }, TICK_INTERVAL_MS);
    this.logger.log(
      `Relationship-health scheduler started (daily at ${this.targetHourUtc}:00 UTC)`,
    );
  }

  onModuleDestroy() {
    if (this.intervalRef) {
      clearInterval(this.intervalRef);
      this.intervalRef = null;
    }
  }

  /** Exposed for tests + manual triggering. */
  async tick(now: Date = new Date()): Promise<{ ran: boolean }> {
    if (this.running) return { ran: false };
    if (now.getUTCHours() < this.targetHourUtc) return { ran: false };
    const day = now.toISOString().slice(0, 10);
    if (this.lastRunDay === day) return { ran: false };
    this.running = true;
    this.lastRunDay = day;
    try {
      const result = await this.health.recomputeAll();
      this.logger.log(
        `Daily recompute done: businesses=${result.businesses} updated=${result.totalUpdated} skipped=${result.totalSkipped}`,
      );
      return { ran: true };
    } finally {
      this.running = false;
    }
  }
}
