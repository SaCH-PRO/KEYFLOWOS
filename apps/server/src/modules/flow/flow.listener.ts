import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  BookingCreatedPayload,
  BookingConfirmedPayload,
  ContactCreatedPayload,
  ContactDeletedPayload,
  ContactImportedPayload,
  ContactMergedPayload,
  ContactUpdatedPayload,
  InvoicePaidPayload,
  InvoiceStatusPayload,
  SequenceStepDuePayload,
} from '../../core/event-bus/events.types';
import { BookingsService } from '../bookings/bookings.service';
import { PrismaService } from '../../core/prisma/prisma.service';

@Injectable()
export class FlowListener {
  private readonly logger = new Logger(FlowListener.name);

  constructor(
    @Inject(BookingsService) private readonly bookingsService: BookingsService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {
    this.logger.log(`FlowListener created, prisma=${!!this.prisma}`);
  }

  private async createNotification(input: {
    businessId: string;
    type: string;
    title: string;
    body?: string;
    data?: Record<string, unknown>;
  }) {
    return (this.prisma.client as any).notification.create({
      data: {
        businessId: input.businessId,
        type: input.type,
        title: input.title,
        body: input.body,
        data: input.data as any,
      },
    });
  }

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

    await this.createNotification({
      businessId: payload.businessId,
      type: 'invoice.paid',
      title: 'Invoice Paid',
      body: `Invoice ${(payload.invoice as any).invoiceNumber ?? payload.invoice.id.slice(-6).toUpperCase()} has been paid.`,
      data: { invoiceId: payload.invoice.id, total: payload.invoice.total },
    }).catch((e) => this.logger.error('Failed to create notification', e));
  }

  @OnEvent('booking.created')
  async handleBookingCreated(payload: BookingCreatedPayload) {
    this.logger.log(`[NOTIF] booking.created event received for business ${payload.businessId}`);

    const contactName = payload.contact
      ? [payload.contact.firstName, payload.contact.lastName].filter(Boolean).join(' ') || payload.contact.email || 'A customer'
      : 'A customer';

    try {
      await this.createNotification({
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
      });
      this.logger.log(`[NOTIF] Notification created for booking ${payload.booking.id}`);
    } catch (e) {
      this.logger.error(`[NOTIF] Failed to create notification for booking ${payload.booking.id}`, (e as Error).stack);
    }
  }

  @OnEvent('booking.confirmed')
  async handleBookingConfirmed(payload: BookingConfirmedPayload) {
    this.logger.debug(`Flow observed booking.confirmed`, payload as any);

    await this.createNotification({
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

    await this.createNotification({
      businessId: payload.businessId,
      type: 'invoice.overdue',
      title: 'Invoice Overdue',
      body: `Invoice ${(payload.invoice as any).invoiceNumber ?? payload.invoice.id.slice(-6).toUpperCase()} is overdue.`,
      data: { invoiceId: payload.invoice.id },
    }).catch((e) => this.logger.error('Failed to create notification', e));
  }

  @OnEvent('contact.created')
  async handleContactCreated(payload: ContactCreatedPayload) {
    this.logger.debug(`Flow observed contact.created`, payload as any);

    const contactName = this.formatContactName(payload.contact);

    await this.createNotification({
      businessId: payload.businessId,
      type: 'contact.created',
      title: 'New Contact',
      body: `${contactName} has been added to your CRM.`,
      data: { contactId: payload.contact.id },
    }).catch((e) => this.logger.error('Failed to create notification', e));
  }

  @OnEvent('contact.updated')
  async handleContactUpdated(payload: ContactUpdatedPayload) {
    if (!payload.fromStatus || !payload.toStatus || payload.fromStatus === payload.toStatus) {
      return;
    }

    this.logger.debug(`Flow observed contact.updated (status change)`, payload as any);

    const contactName = this.formatContactName(payload.contact);

    await this.createNotification({
      businessId: payload.businessId,
      type: 'contact.updated',
      title: 'Contact Status Changed',
      body: `Contact ${contactName} status changed to ${payload.toStatus}.`,
      data: { contactId: payload.contact.id, fromStatus: payload.fromStatus, toStatus: payload.toStatus },
    }).catch((e) => this.logger.error('Failed to create notification', e));
  }

  @OnEvent('contact.merged')
  async handleContactMerged(payload: ContactMergedPayload) {
    this.logger.debug(`Flow observed contact.merged`, payload as any);

    const keptName = this.formatContactName(payload.contact);

    await this.createNotification({
      businessId: payload.businessId,
      type: 'contact.merged',
      title: 'Contacts Merged',
      body: `Contacts merged: kept ${keptName}, removed duplicate.`,
      data: { contactId: payload.contact.id, duplicateId: payload.duplicateId },
    }).catch((e) => this.logger.error('Failed to create notification', e));
  }

  @OnEvent('contact.deleted')
  async handleContactDeleted(payload: ContactDeletedPayload) {
    this.logger.debug(`Flow observed contact.deleted`, payload as any);

    const contactName = this.formatContactName(payload.contact);

    await this.createNotification({
      businessId: payload.businessId,
      type: 'contact.deleted',
      title: 'Contact Archived',
      body: `Contact ${contactName} archived.`,
      data: { contactId: payload.contact.id },
    }).catch((e) => this.logger.error('Failed to create notification', e));
  }

  @OnEvent('contact.imported')
  async handleContactImported(payload: ContactImportedPayload) {
    this.logger.debug(`Flow observed contact.imported`, payload as any);

    await this.createNotification({
      businessId: payload.businessId,
      type: 'contact.imported',
      title: 'Contacts Imported',
      body: `${payload.count} contacts imported from ${payload.source}.`,
      data: { source: payload.source, count: payload.count },
    }).catch((e) => this.logger.error('Failed to create notification', e));
  }

  @OnEvent('sequence.step_due')
  async handleSequenceStepDue(payload: SequenceStepDuePayload) {
    this.logger.debug(`Flow observed sequence.step_due`, payload as any);

    await this.createNotification({
      businessId: payload.businessId,
      type: 'sequence.step_due',
      title: 'Sequence Step Due',
      body: `Sequence step due: ${payload.stepType} for ${payload.contactName}.`,
      data: {
        contactId: payload.contactId,
        sequenceName: payload.sequenceName,
        stepType: payload.stepType,
        stepIndex: payload.stepIndex,
      },
    }).catch((e) => this.logger.error('Failed to create notification', e));
  }

  private formatContactName(contact: {
    displayName?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
  }) {
    if (contact.displayName && contact.displayName.trim()) return contact.displayName.trim();
    const full = `${contact.firstName ?? ''} ${contact.lastName ?? ''}`.trim();
    if (full) return full;
    if (contact.email) return contact.email;
    return 'Unknown';
  }
}
