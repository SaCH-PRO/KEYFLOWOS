import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  BookingCancelledPayload,
  BookingRescheduledPayload,
} from '../../core/event-bus/events.types';
import { BookingWaitlistService } from './booking-waitlist.service';

/**
 * When a booking is cancelled or rescheduled, the old slot becomes free.
 * Offer that slot to the first matching waitlist entry, if any.
 *
 * This listener is intentionally simple: it matches ONE entry per freed slot.
 * If multiple entries match, the oldest wins. A future improvement could offer
 * the same slot to several entries and let the first to convert win.
 */
@Injectable()
export class BookingWaitlistListener {
  private readonly logger = new Logger(BookingWaitlistListener.name);

  constructor(
    @Inject(BookingWaitlistService) private readonly waitlist: BookingWaitlistService,
  ) {}

  @OnEvent('booking.cancelled', { async: true })
  async onCancelled(payload: BookingCancelledPayload) {
    await this.handleFreedSlot(payload.businessId, payload.booking);
  }

  @OnEvent('booking.rescheduled', { async: true })
  async onRescheduled(payload: BookingRescheduledPayload) {
    await this.handleFreedSlot(payload.businessId, {
      ...payload.booking,
      startTime: payload.previousStartTime,
      endTime: payload.previousEndTime,
    });
  }

  private async handleFreedSlot(
    businessId: string,
    booking: { startTime: Date; endTime: Date; serviceId: string; staffId?: string | null },
  ) {
    try {
      const matches = await this.waitlist.findWaitlistMatchesForSlot(
        businessId,
        {
          startTime: new Date(booking.startTime),
          endTime: new Date(booking.endTime),
          serviceId: booking.serviceId,
          staffId: booking.staffId ?? null,
        },
        { limit: 1 },
      );

      if (matches.length === 0) return;

      const entry = matches[0];
      const result = await this.waitlist.offerSlot(entry.id, {
        startTime: new Date(booking.startTime),
        endTime: new Date(booking.endTime),
        serviceId: booking.serviceId,
        staffId: booking.staffId ?? null,
      });

      this.logger.log(
        `Offered freed slot ${booking.startTime.toISOString()} to waitlist entry ${entry.id} as booking ${result.booking.id}`,
      );
    } catch (err) {
      // A listener must never take the request down. Log the tuple that
      // identifies the freed slot so a human can retry manually if needed.
      this.logger.error(
        `Failed to offer freed slot to waitlist for business ${businessId}, booking ${booking.startTime.toISOString()}: ${(err as Error).message}`,
      );
    }
  }
}
