import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConnectorRegistryService } from './connector-registry.service';
import { ConnectorActivityService } from './connector-activity.service';
import { ConnectorType } from './connector.interface';

const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const STARTUP_DELAY_MS = 90 * 1000;
const TARGET_HOUR_UTC = 2;
const ELIGIBLE_STATUSES = ['connected', 'syncing'] as const;

export interface NightlyConnectorSyncResult {
  businesses: number;
  attempted: number;
  synced: number;
  skipped: number;
  failed: number;
}

/**
 * Walks every connector currently flagged as connected and runs its `sync()`
 * once per night. Each connector implementation already updates
 * `ConnectorStatus.lastSyncAt` and emits `connector.synced` / `connector.error`
 * events that the activity log + health monitor consume, so this scheduler
 * just needs to drive the registry and isolate per-connector failures so a
 * single bad integration cannot poison the rest of the run.
 */
@Injectable()
export class ConnectorSyncSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ConnectorSyncSchedulerService.name);
  private intervalRef: ReturnType<typeof setInterval> | null = null;
  private startupTimeout: ReturnType<typeof setTimeout> | null = null;
  private lastRunDateKey: string | null = null;
  private running = false;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ConnectorRegistryService) private readonly registry: ConnectorRegistryService,
    @Inject(ConnectorActivityService) private readonly activity: ConnectorActivityService,
  ) {}

  onModuleInit() {
    this.startupTimeout = setTimeout(() => {
      void this.tick();
      this.intervalRef = setInterval(() => void this.tick(), CHECK_INTERVAL_MS);
    }, STARTUP_DELAY_MS);
    this.logger.log(
      `Nightly connector sync scheduler armed for ${TARGET_HOUR_UTC.toString().padStart(2, '0')}:00 UTC (poll every ${CHECK_INTERVAL_MS / 60000} min)`,
    );
  }

  onModuleDestroy() {
    if (this.startupTimeout) {
      clearTimeout(this.startupTimeout);
      this.startupTimeout = null;
    }
    if (this.intervalRef) {
      clearInterval(this.intervalRef);
      this.intervalRef = null;
    }
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    const now = new Date();
    if (now.getUTCHours() !== TARGET_HOUR_UTC) return;
    const dateKey = now.toISOString().split('T')[0];
    if (this.lastRunDateKey === dateKey) return;
    this.lastRunDateKey = dateKey;
    this.running = true;
    try {
      const result = await this.runNightlySync();
      this.logger.log(
        `Nightly connector sync complete for ${dateKey}: ${result.synced} succeeded, ${result.skipped} skipped (unsupported), ${result.failed} failed across ${result.businesses} businesses (${result.attempted} attempts)`,
      );
    } catch (err: any) {
      this.logger.error(
        `Nightly connector sync run failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.running = false;
    }
  }

  /**
   * Iterate every (business, connector) pair currently flagged as connected /
   * syncing and run the registered connector's sync. Internal-only — not
   * exposed via any tenant-facing endpoint.
   */
  async runNightlySync(): Promise<NightlyConnectorSyncResult> {
    const rows = await this.prisma.client.connectorStatus.findMany({
      where: { status: { in: [...ELIGIBLE_STATUSES] } },
      select: { businessId: true, connectorType: true },
    });

    const businesses = new Set<string>();
    let attempted = 0;
    let synced = 0;
    let skipped = 0;
    let failed = 0;

    for (const row of rows) {
      businesses.add(row.businessId);
      const type = row.connectorType as ConnectorType;
      if (!this.registry.get(type)) continue;
      attempted += 1;

      try {
        const result = await this.registry.syncConnector(type, row.businessId);
        if (result.success) {
          synced += 1;
        } else if (result.unsupported) {
          // Expected: this connector does not support pull sync. Not a failure —
          // do not mark unhealthy, advance bookkeeping, or emit a nightly alert.
          skipped += 1;
        } else {
          failed += 1;
          await this.activity.record({
            businessId: row.businessId,
            connectorType: type,
            action: 'sync',
            status: 'failure',
            message:
              result.errors.length > 0
                ? result.errors.join('; ')
                : 'Sync returned success=false',
            durationMs: result.duration,
            metadata: { source: 'nightly_scheduler' },
          });
        }
      } catch (err: any) {
        failed += 1;
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `Nightly sync failed for ${type} (business ${row.businessId}): ${message}`,
        );
        // The registry's syncConnector emits `connector.error`, which the
        // ConnectorActivityService logs. Add an extra activity record tagged
        // with the scheduler so operators can trace failures back here.
        await this.activity.record({
          businessId: row.businessId,
          connectorType: type,
          action: 'error',
          status: 'failure',
          message,
          metadata: { source: 'nightly_scheduler' },
        });
      }
    }

    return { businesses: businesses.size, attempted, synced, skipped, failed };
  }
}
