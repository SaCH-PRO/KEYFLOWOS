import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { CalendarProjectionService } from '../calendar-projection.service';
import { mapBooking, SourceBooking, SourceContact } from '../projection-mappers';

interface BookingEventPayload {
  businessId: string;
  booking: SourceBooking;
  contact?: SourceContact | null;
}

interface BookingDeletedPayload {
  businessId: string;
  bookingId: string;
}

@Injectable()
export class CalendarBookingsListener {
  private readonly logger = new Logger(CalendarBookingsListener.name);

  constructor(
    @Inject(CalendarProjectionService)
    private readonly projection: CalendarProjectionService,
  ) {}

  @OnEvent('booking.created', { async: true })
  @OnEvent('booking.confirmed', { async: true })
  @OnEvent('booking.completed', { async: true })
  @OnEvent('booking.cancelled', { async: true })
  @OnEvent('booking.rescheduled', { async: true })
  async onBookingChanged(payload: BookingEventPayload): Promise<void> {
    const businessId = payload?.businessId;
    const booking = payload?.booking;
    if (!businessId || !booking) return;
    const enriched: SourceBooking = {
      ...booking,
      contact: payload.contact ?? booking.contact ?? null,
    };
    const input = mapBooking(enriched, businessId);
    if (!input) return;
    try {
      await this.projection.upsertFromSource(input);
    } catch (err) {
      this.logger.warn(
        `booking projection failed booking=${booking.id}: ${(err as Error).message}`,
      );
    }
  }

  @OnEvent('booking.deleted', { async: true })
  async onBookingDeleted(payload: BookingDeletedPayload): Promise<void> {
    if (!payload?.businessId || !payload?.bookingId) return;
    try {
      await this.projection.removeForSource({
        businessId: payload.businessId,
        sourceType: 'booking',
        sourceId: payload.bookingId,
      });
    } catch (err) {
      this.logger.warn(
        `booking projection delete failed booking=${payload.bookingId}: ${(err as Error).message}`,
      );
    }
  }
}
