import { Inject, Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { FinanceIntelligenceService } from './finance-intelligence.service';

const TICK_MS = 15 * 60 * 1000;

/**
 * FIN8 — 15-minute scheduler that runs the eight finance detectors for
 * every business with at least one finance signal worth scanning.
 * On-demand scans happen via the controller; this scheduler is the
 * always-on fallback so the action queue stays fresh between visits.
 */
@Injectable()
export class FinanceIntelligenceSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FinanceIntelligenceSchedulerService.name);
  private intervalRef: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(FinanceIntelligenceService) private readonly intel: FinanceIntelligenceService,
  ) {}

  onModuleInit() {
    if (process.env.DISABLE_SCHEDULERS === '1' || process.env.NODE_ENV === 'test') {
      this.logger.log('[FIN8] scheduler disabled via env');
      return;
    }
    this.logger.log(`[FIN8] scheduler starting — every ${TICK_MS / 60000}m`);
    this.intervalRef = setInterval(() => {
      void this.tick().catch((e) => this.logger.error(`tick failed: ${(e as Error).message}`));
    }, TICK_MS);
  }

  onModuleDestroy() {
    if (this.intervalRef) clearInterval(this.intervalRef);
    this.intervalRef = null;
  }

  async tick(): Promise<void> {
    const businesses = await this.prisma.client.business.findMany({
      where: {
        deletedAt: null,
        OR: [
          { invoices: { some: { deletedAt: null } } },
          { expenses: { some: { deletedAt: null } } },
        ],
      },
      select: { id: true },
      take: 500,
    });
    let totalCreated = 0;
    for (const b of businesses) {
      try {
        const r = await this.intel.scan(b.id);
        totalCreated += r.created;
      } catch (e) {
        this.logger.warn(`scan failed for ${b.id}: ${(e as Error).message}`);
      }
    }
    if (totalCreated > 0) {
      this.logger.log(`[FIN8] tick scanned ${businesses.length} businesses, ${totalCreated} new actions`);
    }
  }
}
