import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { BookingCreatedPayload, BookingConfirmedPayload, InvoicePaidPayload, InvoiceStatusPayload } from '../../core/event-bus/events.types';
import { BookingsService } from '../bookings/bookings.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class FlowListener {
  private readonly logger = new Logger(FlowListener.name);

  constructor(
    private readonly bookingsService: BookingsService,
    private readonly notifications: NotificationsService,
  ) {}

  @OnEvent('invoice.paid')
  async handleInvoicePaid(payload: InvoicePaidPayload) {
    this.logger.debug(`Flow observed invoice.paid`, payload as any);

    if (payload.invoice.bookingId) {
      await this.bookingsService.confirmBooking(payload.invoice.bookingId);
      this.logger.debug(`Booking ${payload.invoice.bookingId} confirmed via invoice.paid`);
    }

    this.logger.log(
      JSON.stringify({
        event: 'invoice.paid',
        invoiceId: payload.invoice.id,
        total: payload.invoice.total,
        currency: payload.invoice.currency,
        contactId: payload.invoice.contact?.id,
      }),
    );

    await this.notifications.create({
      businessId: payload.businessId,
      type: 'invoice.paid',
      title: 'Invoice Paid',
      body: `Invoice ${(payload.invoice as any).invoiceNumber ?? payload.invoice.id.slice(-6).toUpperCase()} has been paid.`,
      data: { invoiceId: payload.invoice.id, total: payload.invoice.total },
    }).catch((e) => this.logger.error('Failed to create notification', e));
  }

  @OnEvent('booking.created')
  async handleBookingCreated(payload: BookingCreatedPayload) {
    this.logger.debug(`Flow observed booking.created`, payload as any);

    const contactName = payload.contact
      ? [payload.contact.firstName, payload.contact.lastName].filter(Boolean).join(' ') || payload.contact.email || 'A customer'
      : 'A customer';

    await this.notifications.create({
      businessId: payload.businessId,
      type: 'booking.created',
      title: 'New Booking',
      body: `${contactName} booked an appointment.`,
      data: {
        bookingId: payload.booking.id,
        contactId: payload.contact?.id,
        serviceId: payload.booking.serviceId,
        startTime: payload.booking.startTime,
      },
    }).catch((e) => this.logger.error('Failed to create notification', e));
  }

  @OnEvent('booking.confirmed')
  async handleBookingConfirmed(payload: BookingConfirmedPayload) {
    this.logger.debug(`Flow observed booking.confirmed`, payload as any);

    await this.notifications.create({
      businessId: payload.businessId,
      type: 'booking.confirmed',
      title: 'Booking Confirmed',
      body: `A booking has been confirmed.`,
      data: { bookingId: payload.booking.id },
    }).catch((e) => this.logger.error('Failed to create notification', e));
  }

  @OnEvent('invoice.overdue')
  async handleInvoiceOverdue(payload: InvoiceStatusPayload) {
    this.logger.debug(`Flow observed invoice.overdue`, payload as any);

    await this.notifications.create({
      businessId: payload.businessId,
      type: 'invoice.overdue',
      title: 'Invoice Overdue',
      body: `Invoice ${(payload.invoice as any).invoiceNumber ?? payload.invoice.id.slice(-6).toUpperCase()} is overdue.`,
      data: { invoiceId: payload.invoice.id },
    }).catch((e) => this.logger.error('Failed to create notification', e));
  }

  @OnEvent('contact.created')
  handleContactCreated(payload: unknown) {
    this.logger.debug(`Flow observed contact.created`, payload as any);
  }
}
