/**
 * Invoice Overdue Watcher — Phase D.1
 *
 * Scans a business for invoices that are past their due date and still
 * unpaid, then emits normalized proactive events on the KEY Cortex event
 * bus so subscribers can trigger reminders, escalation, or autonomous
 * collection workflows.
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { KeyCortexEventBusService } from '../key-cortex-event-bus.service';

@Injectable()
export class InvoiceOverdueWatcherService {
  private readonly logger = new Logger(InvoiceOverdueWatcherService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: KeyCortexEventBusService,
  ) {}

  /**
   * Scan a single business for overdue invoices and emit one event per invoice.
   * Returns the number of events emitted.
   */
  async scan(businessId: string): Promise<number> {
    const now = new Date();

    const invoices = await (this.prisma.client as any).invoice.findMany({
      where: {
        businessId,
        status: { in: ['SENT', 'OVERDUE', 'PENDING'] },
        dueDate: { lt: now },
      },
      include: {
        contact: { select: { id: true, name: true, email: true } },
      },
      orderBy: { dueDate: 'asc' },
    });

    for (const invoice of invoices) {
      const daysOverdue = invoice.dueDate
        ? Math.floor((now.getTime() - new Date(invoice.dueDate).getTime()) / (1000 * 60 * 60 * 24))
        : 0;

      await this.eventBus.publish({
        source: 'proactive_watcher',
        type: 'proactive.invoice_overdue',
        businessId,
        payload: {
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          dueDate: invoice.dueDate,
          total: invoice.total,
          currency: invoice.currency,
          daysOverdue,
          contact: invoice.contact,
        },
        metadata: {
          entityType: 'Invoice',
          entityId: invoice.id,
          importance: daysOverdue > 30 ? 'critical' : 'high',
        },
      });
    }

    this.logger.debug(
      `[scan] ${businessId}: emitted ${invoices.length} overdue invoice event(s)`,
    );
    return invoices.length;
  }

  /**
   * Scan all active businesses and return the total number of events emitted.
   */
  async scanAll(): Promise<number> {
    const businessIds = await this.getActiveBusinesses();
    let total = 0;

    for (const businessId of businessIds) {
      try {
        total += await this.scan(businessId);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`[scanAll] failed for ${businessId}: ${msg}`);
      }
    }

    return total;
  }

  private async getActiveBusinesses(): Promise<string[]> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    try {
      const businesses = await (this.prisma.client as any).business.findMany({
        where: {
          autopilotEnabled: true,
          OR: [
            {
              subscriptions: {
                some: {
                  status: { in: ['ACTIVE', 'TRIALING'] },
                },
              },
            },
            {
              cortexSessions: {
                some: {
                  updatedAt: { gte: sevenDaysAgo },
                },
              },
            },
            {
              aiUsageLogs: {
                some: {
                  createdAt: { gte: sevenDaysAgo },
                },
              },
            },
          ],
        },
        select: { id: true },
        take: 500,
        distinct: ['id'],
      });

      return businesses.map((b: { id: string }) => b.id);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[getActiveBusinesses] Failed: ${msg}`);
      return [];
    }
  }
}
