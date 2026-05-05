import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { InvoiceWorkflowService } from './invoice-workflow.service';

const TICK_MS = 15 * 60 * 1000; // 15 minutes — overdue detection isn't latency-sensitive
const BATCH_SIZE = 200;

/**
 * Periodically flips SENT invoices whose `dueDate` has passed (and that are
 * not already PAID/VOID/PARTIALLY_PAID-and-covered) to OVERDUE, emitting
 * `invoice.overdue` via the workflow service so the FlowListener notifier
 * fires. Disabled outside production-style runtimes via DISABLE_SCHEDULERS=1.
 */
@Injectable()
export class InvoiceOverdueScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(InvoiceOverdueScheduler.name);
  private intervalRef: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(InvoiceWorkflowService) private readonly workflow: InvoiceWorkflowService,
  ) {}

  onModuleInit() {
    if (process.env.DISABLE_SCHEDULERS === '1' || process.env.NODE_ENV === 'test') {
      this.logger.log('[InvoiceOverdueScheduler] Disabled via env');
      return;
    }
    this.logger.log(`[InvoiceOverdueScheduler] Starting — every ${TICK_MS / 60000}m`);
    this.intervalRef = setInterval(() => {
      void this.runOnce().catch((e) => this.logger.error(`Tick failed: ${(e as Error).message}`));
    }, TICK_MS);
  }

  onModuleDestroy() {
    if (this.intervalRef) clearInterval(this.intervalRef);
    this.intervalRef = null;
  }

  /** Public for the verify-revenue.sh smoke script + tests. */
  async runOnce(): Promise<{ flipped: number; scanned: number }> {
    const now = new Date();
    const candidates = await this.prisma.client.invoice.findMany({
      where: {
        status: 'SENT',
        deletedAt: null,
        dueDate: { not: null, lt: now },
      },
      select: { id: true },
      take: BATCH_SIZE,
    });
    let flipped = 0;
    for (const inv of candidates) {
      try {
        await this.workflow.transition(inv.id, 'OVERDUE');
        flipped++;
      } catch (e) {
        this.logger.warn(`Could not flip invoice ${inv.id} to OVERDUE: ${(e as Error).message}`);
      }
    }
    if (flipped > 0) {
      this.logger.log(`[InvoiceOverdueScheduler] Flipped ${flipped}/${candidates.length} invoices to OVERDUE`);
    }
    return { flipped, scanned: candidates.length };
  }
}
