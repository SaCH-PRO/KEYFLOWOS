import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { BookingConfirmedPayload, InvoicePaidPayload, InvoiceStatusPayload } from '../../core/event-bus/events.types';
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

    // Emit browser event via console log marker to let frontend append to feed (simple telemetry)
    this.logger.log(
      JSON.stringify({
        event: 'invoice.paid',
        invoiceId: payload.invoice.id,
        total: payload.invoice.total,
        currency: payload.invoice.currency,
        contactId: payload.invoice.contact?.id,
      }),
    );
  }

  @OnEvent('booking.created')
  handleBookingCreated(payload: unknown) {
    this.logger.debug(`Flow observed booking.created`, payload as any);
  }

  @OnEvent('booking.confirmed')
  handleBookingConfirmed(payload: BookingConfirmedPayload) {
    this.logger.debug(`Flow observed booking.confirmed`, payload as any);
  }

  @OnEvent('invoice.overdue')
  handleInvoiceOverdue(payload: InvoiceStatusPayload) {
    this.logger.debug(`Flow observed invoice.overdue`, payload as any);
  }

  @OnEvent('contact.created')
  handleContactCreated(payload: unknown) {
    this.logger.debug(`Flow observed contact.created`, payload as any);
  }
}
