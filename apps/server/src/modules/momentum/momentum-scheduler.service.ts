import { Inject, Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { ClientMomentumService } from './client-momentum.service';

const SWEEP_CHECK_INTERVAL_MS = 60 * 1000;
const TARGET_SWEEP_HOUR = 6;

@Injectable()
export class MomentumSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MomentumSchedulerService.name);
  private intervalRef: ReturnType<typeof setInterval> | null = null;
  private readonly sweepTracker = new Map<string, string>();

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ClientMomentumService) private readonly momentumService: ClientMomentumService,
  ) {}

  onModuleInit() {
    this.logger.log('[MomentumScheduler] Starting scheduler — checking every 60s');
    this.intervalRef = setInterval(() => {
      void this.checkAndRunSweeps();
    }, SWEEP_CHECK_INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.intervalRef) {
      clearInterval(this.intervalRef);
      this.intervalRef = null;
    }
    this.logger.log('[MomentumScheduler] Scheduler stopped');
  }

  private getLocalHourAndDate(tz: string): { hour: number; dateKey: string } {
    try {
      const now = new Date();
      const hourFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hour: 'numeric',
        hour12: false,
      });
      const dateFormatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
      return {
        hour: parseInt(hourFormatter.format(now), 10),
        dateKey: dateFormatter.format(now),
      };
    } catch {
      const now = new Date();
      return {
        hour: now.getHours(),
        dateKey: now.toISOString().split('T')[0],
      };
    }
  }

  private async checkAndRunSweeps() {
    try {
      const businesses = await this.prisma.client.business.findMany({
        select: { id: true, timezone: true },
      });

      for (const business of businesses) {
        const tz = business.timezone || 'America/Port_of_Spain';
        const { hour: localHour, dateKey } = this.getLocalHourAndDate(tz);

        if (localHour !== TARGET_SWEEP_HOUR) continue;

        const trackerKey = `${business.id}:${dateKey}`;
        if (this.sweepTracker.has(trackerKey)) continue;

        this.sweepTracker.set(trackerKey, 'running');

        try {
          this.logger.log(`[MomentumScheduler] Running scheduled sweep for business ${business.id} (tz: ${tz}, local hour: ${localHour})`);
          const result = await this.momentumService.runDailySweep(business.id);
          this.sweepTracker.set(trackerKey, 'done');
          this.logger.log(`[MomentumScheduler] Sweep complete for ${business.id}: ${result.contactsProcessed} contacts, ${result.recommendationsGenerated} recs, ${result.snapshotsSaved} snapshots`);
        } catch (err: any) {
          this.sweepTracker.set(trackerKey, 'failed');
          this.logger.error(`[MomentumScheduler] Sweep failed for ${business.id}: ${(err as Error).message}`);
        }
      }

      const now = new Date();
      const todayUtc = now.toISOString().split('T')[0];
      for (const [key] of this.sweepTracker) {
        const keyDate = key.split(':')[1];
        if (keyDate < todayUtc) {
          this.sweepTracker.delete(key);
        }
      }
    } catch (err: any) {
      this.logger.error(`[MomentumScheduler] Check failed: ${(err as Error).message}`);
    }
  }
}
