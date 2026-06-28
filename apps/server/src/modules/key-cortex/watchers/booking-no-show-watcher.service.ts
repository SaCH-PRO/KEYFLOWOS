/**
 * Booking No-Show Watcher — Phase D.1
 *
 * Detects confirmed bookings whose start time has already passed but which
 * were never marked completed or cancelled. Emits proactive no-show events
 * so follow-up workflows (reschedule, charge no-show fee, outreach) can run.
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { KeyCortexEventBusService } from '../key-cortex-event-bus.service';

@Injectable()
export class BookingNoShowWatcherService {
  private readonly logger = new Logger(BookingNoShowWatcherService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: KeyCortexEventBusService,
  ) {}

  /**
   * Scan a single business for likely no-shows and emit one event per booking.
   * Returns the number of events emitted.
   */
  async scan(businessId: string): Promise<number> {
    const now = new Date();

    const bookings = await (this.prisma.client as any).booking.findMany({
      where: {
        businessId,
        status: 'CONFIRMED',
        startTime: { lt: now },
      },
      include: {
        contact: { select: { id: true, name: true, email: true, phone: true } },
        service: { select: { id: true, name: true, duration: true, price: true } },
        staff: { select: { id: true, name: true } },
      },
      orderBy: { startTime: 'asc' },
    });

    for (const booking of bookings) {
      const minutesLate = Math.floor(
        (now.getTime() - new Date(booking.startTime).getTime()) / (1000 * 60),
      );

      await this.eventBus.publish({
        source: 'proactive_watcher',
        type: 'proactive.booking_no_show',
        businessId,
        payload: {
          bookingId: booking.id,
          startTime: booking.startTime,
          endTime: booking.endTime,
          minutesLate,
          contact: booking.contact,
          service: booking.service,
          staff: booking.staff,
          notes: booking.notes,
        },
        metadata: {
          entityType: 'Booking',
          entityId: booking.id,
          importance: minutesLate > 60 ? 'high' : 'normal',
        },
      });
    }

    this.logger.debug(
      `[scan] ${businessId}: emitted ${bookings.length} no-show event(s)`,
    );
    return bookings.length;
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
