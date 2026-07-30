import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { RevenueReportingService } from './revenue-reporting.service';

const TICK_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class RevenueReportingRollupScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RevenueReportingRollupScheduler.name);
  private intervalRef: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RevenueReportingService) private readonly reporting: RevenueReportingService,
  ) {}

  onModuleInit(): void {
    if (process.env.DISABLE_SCHEDULERS === '1' || process.env.NODE_ENV === 'test') {
      this.logger.log('[RevenueReportingRollup] Scheduler disabled via env');
      return;
    }
    this.logger.log('[RevenueReportingRollup] Starting daily rollup');
    this.intervalRef = setInterval(() => {
      void this.runAll().catch((err) =>
        this.logger.error(`rollup tick failed: ${(err as Error).message}`),
      );
    }, TICK_MS);
  }

  onModuleDestroy(): void {
    if (this.intervalRef) clearInterval(this.intervalRef);
    this.intervalRef = null;
  }

  async runAll(): Promise<void> {
    const businesses = await this.prisma.client.business.findMany({ select: { id: true } });
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    let ok = 0;
    let failed = 0;
    for (const b of businesses) {
      try {
        await this.reporting.refreshRollup(b.id, { start, end: now });
        ok += 1;
      } catch (err: any) {
        failed += 1;
        this.logger.error(`rollup for business ${b.id} failed: ${(err as Error).message}`);
      }
    }
    this.logger.log(`[RevenueReportingRollup] Completed: ${ok} ok, ${failed} failed`);
  }
}
