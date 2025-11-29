import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InvoicePaidPayload } from '../../core/event-bus/events.types';
import { BookingsService } from '../bookings/bookings.service';

@Injectable()
export class FlowListener {
  private readonly logger = new Logger(FlowListener.name);

  constructor(private readonly bookingsService: BookingsService) {}

  @OnEvent('invoice.paid')
  async handleInvoicePaid(payload: InvoicePaidPayload) {
    this.logger.debug(`Flow observed invoice.paid`, payload as any);

    if (payload.invoice.bookingId) {
      await this.bookingsService.confirmBooking(payload.invoice.bookingId);
      this.logger.debug(`Booking ${payload.invoice.bookingId} confirmed via invoice.paid`);
    }
  }

  @OnEvent('booking.created')
  handleBookingCreated(payload: unknown) {
    this.logger.debug(`Flow observed booking.created`, payload as any);
  }
}
