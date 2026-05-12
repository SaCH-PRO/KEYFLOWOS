import { Inject, Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  BookingCreatedPayload,
  BookingConfirmedPayload,
  BookingCancelledPayload,
  BookingRescheduledPayload,
  ContactCreatedPayload,
  ContactDeletedPayload,
  ContactImportedPayload,
  ContactMergedPayload,
  ContactUpdatedPayload,
  InvoicePaidPayload,
  InvoiceStatusPayload,
  PaymentReceivedPayload,
  SequenceStepDuePayload,
  SequenceStepFailedPayload,
  ExpenseCreatedPayload,
} from '../../core/event-bus/events.types';
import { BookingsService } from '../bookings/bookings.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { FinancialCopilotService } from '../commerce/financial-copilot.service';
import { TransactionalEmailService } from '../notifications/transactional-email.service';

@Injectable()
export class FlowListener implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FlowListener.name);
  private reminderInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(BookingsService) private readonly bookingsService: BookingsService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(FinancialCopilotService) private readonly financialCopilot: FinancialCopilotService,
    @Inject(TransactionalEmailService) private readonly transactionalEmail: TransactionalEmailService,
  ) {
    this.logger.log(`FlowListener created, prisma=${!!this.prisma}`);
  }

  onModuleInit() {
    this.reminderInterval = setInterval(() => {
      this.handleBookingReminders().catch((e) =>
        this.logger.error(`Booking reminder cron failed: ${(e as Error).message}`),
      );
    }, 60 * 60 * 1000);
  }

  onModuleDestroy() {
    if (this.reminderInterval) {
      clearInterval(this.reminderInterval);
      this.reminderInterval = null;
    }
  }

  private async createNotification(input: {
    businessId: string;
    type: string;
    title: string;
    body?: string;
    data?: Record<string, unknown>;
  }) {
    return this.prisma.client.notification.create({
      data: {
        businessId: input.businessId,
        type: input.type,
        title: input.title,
        body: input.body,
        data: input.data ?? undefined,
      },
    });
  }

  @OnEvent('invoice.paid')
  async handleInvoicePaid(payload: InvoicePaidPayload) {
    this.logger.debug(`Flow observed invoice.paid for business=${payload.businessId}`);

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
      body: `Invoice ${payload.invoice.invoiceNumber ?? payload.invoice.id.slice(-6).toUpperCase()} has been paid.`,
      data: { invoiceId: payload.invoice.id, total: payload.invoice.total },
    }).catch((e) => this.logger.error('Failed to create notification', e));
  }

  @OnEvent('booking.created')
  async handleBookingCreated(payload: BookingCreatedPayload) {
    this.logger.debug(`booking.created received for business=${payload.businessId}`);

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
      this.logger.debug(`Notification created for booking=${payload.booking.id}`);
    } catch (e) {
      this.logger.error(`[NOTIF] Failed to create notification for booking ${payload.booking.id}`, (e as Error).stack);
    }
  }

  @OnEvent('booking.confirmed')
  async handleBookingConfirmed(payload: BookingConfirmedPayload) {
    this.logger.debug(`Flow observed booking.confirmed for business=${payload.businessId}`);

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
    this.logger.debug(`Flow observed invoice.overdue for business=${payload.businessId}`);

    await this.createNotification({
      businessId: payload.businessId,
      type: 'invoice.overdue',
      title: 'Invoice Overdue',
      body: `Invoice ${payload.invoice.invoiceNumber ?? payload.invoice.id.slice(-6).toUpperCase()} is overdue.`,
      data: { invoiceId: payload.invoice.id },
    }).catch((e) => this.logger.error('Failed to create notification', e));
  }

  @OnEvent('contact.created')
  async handleContactCreated(payload: ContactCreatedPayload) {
    this.logger.debug(`Flow observed contact.created for business=${payload.businessId}`);

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

    this.logger.debug(`Flow observed contact.updated (status change) for business=${payload.businessId}`);

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
    this.logger.debug(`Flow observed contact.merged for business=${payload.businessId}`);

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
    this.logger.debug(`Flow observed contact.deleted for business=${payload.businessId}`);

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
    this.logger.debug(`Flow observed contact.imported for business=${payload.businessId}`);

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
    this.logger.debug(`Flow observed sequence.step_due for business=${payload.businessId}`);

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

  @OnEvent('sequence.step_failed')
  async handleSequenceStepFailed(payload: SequenceStepFailedPayload) {
    this.logger.error(`Flow observed sequence.step_failed for business=${payload.businessId}`);

    await this.createNotification({
      businessId: payload.businessId,
      type: 'sequence.step_failed',
      title: 'Sequence Step Failed',
      body: `Sequence step failed for ${payload.contactName} after ${payload.retryCount} retries: ${payload.error}`,
      data: {
        contactId: payload.contactId,
        enrollmentId: payload.enrollmentId,
        sequenceId: payload.sequenceId,
        sequenceName: payload.sequenceName,
        stepType: payload.stepType,
        stepIndex: payload.stepIndex,
        error: payload.error,
        retryCount: payload.retryCount,
      },
    }).catch((e) => this.logger.error('Failed to create step_failed notification', e));
  }

  @OnEvent('invoice.paid')
  async handleInvoicePaidFinancial(payload: InvoicePaidPayload) {
    try {
      const milestone = await this.financialCopilot.checkRevenueMilestoneOnPayment(
        payload.businessId,
        payload.invoice.total,
      );
      if (milestone) {
        await this.createNotification({
          businessId: payload.businessId,
          type: 'financial.milestone',
          title: milestone.title,
          body: milestone.message,
          data: { amount: milestone.amount, type: milestone.type },
        });
      }
    } catch (e) {
      this.logger.error('Failed to check revenue milestone', (e as Error).stack);
    }
  }

  @OnEvent('expense.created')
  async handleExpenseCreated(payload: ExpenseCreatedPayload) {
    this.logger.debug(`Flow observed expense.created for business=${payload.businessId}`);

    try {
      const alert = await this.financialCopilot.checkExpenseAnomaly(
        payload.businessId,
        payload.expense.amount,
        payload.expense.categoryId ?? undefined,
      );
      if (alert) {
        await this.createNotification({
          businessId: payload.businessId,
          type: 'financial.expense_spike',
          title: alert.title,
          body: alert.message,
          data: { amount: alert.amount, percentChange: alert.percentChange, type: alert.type },
        });
      }
    } catch (e) {
      this.logger.error('Failed to check expense anomaly', (e as Error).stack);
    }
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

  private async sendCustomerNotification(
    businessId: string,
    type: 'booking_confirmed' | 'booking_reminder' | 'booking_rescheduled' | 'booking_cancelled' | 'invoice_sent' | 'payment_receipt',
    contact: { id?: string; firstName?: string | null; lastName?: string | null; email?: string | null } | undefined,
    templateData: Record<string, any>,
    dedupeKey?: string,
  ) {
    if (!contact?.email) return;
    const name = [contact.firstName, contact.lastName].filter(Boolean).join(' ') || 'Customer';
    try {
      await this.transactionalEmail.send({
        businessId,
        type,
        recipientEmail: contact.email,
        recipientName: name,
        contactId: contact.id,
        templateData,
        dedupeKey,
      });
    } catch (e) {
      this.logger.error(`Failed to send ${type} notification: ${(e as Error).message}`);
    }
  }

  @OnEvent('booking.confirmed')
  async handleBookingConfirmedCustomerNotif(payload: BookingConfirmedPayload) {
    const booking = payload.booking;
    const service = await this.prisma.client.service.findUnique({ where: { id: booking.serviceId } }).catch(() => null);
    const staff = booking.staffId
      ? await this.prisma.client.staffMember.findUnique({ where: { id: booking.staffId } }).catch(() => null)
      : null;
    await this.sendCustomerNotification(payload.businessId, 'booking_confirmed', payload.contact, {
      serviceName: service?.name ?? 'Appointment',
      startTime: booking.startTime,
      endTime: booking.endTime,
      staffName: staff?.name,
      bookingId: booking.id,
      location: (booking as any).location ?? null,
      locationPlaceId: (booking as any).locationPlaceId ?? null,
      locationLatLng: (booking as any).locationLatLng ?? null,
    });
  }

  @OnEvent('booking.cancelled')
  async handleBookingCancelledCustomerNotif(payload: BookingCancelledPayload) {
    const booking = payload.booking;
    const service = await this.prisma.client.service.findUnique({ where: { id: booking.serviceId } }).catch(() => null);
    await this.sendCustomerNotification(payload.businessId, 'booking_cancelled', payload.contact, {
      serviceName: service?.name ?? 'Appointment',
      startTime: booking.startTime,
    });
  }

  @OnEvent('booking.rescheduled')
  async handleBookingRescheduledCustomerNotif(payload: BookingRescheduledPayload) {
    const booking = payload.booking;
    const service = await this.prisma.client.service.findUnique({ where: { id: booking.serviceId } }).catch(() => null);
    const staff = booking.staffId
      ? await this.prisma.client.staffMember.findUnique({ where: { id: booking.staffId } }).catch(() => null)
      : null;
    await this.sendCustomerNotification(payload.businessId, 'booking_rescheduled', payload.contact, {
      serviceName: service?.name ?? 'Appointment',
      newStartTime: booking.startTime,
      newEndTime: booking.endTime,
      previousStartTime: payload.previousStartTime,
      staffName: staff?.name,
      location: (booking as any).location ?? null,
      locationPlaceId: (booking as any).locationPlaceId ?? null,
      locationLatLng: (booking as any).locationLatLng ?? null,
    });
  }

  @OnEvent('invoice.sent')
  async handleInvoiceSentCustomerNotif(payload: InvoiceStatusPayload) {
    const inv = payload.invoice;
    await this.sendCustomerNotification(payload.businessId, 'invoice_sent', inv.contact, {
      invoiceNumber: inv.invoiceNumber ?? inv.id.slice(-6).toUpperCase(),
      total: inv.total,
      currency: inv.currency,
      dueDate: inv.dueDate,
      items: inv.items,
    });
  }

  @OnEvent('invoice.paid')
  async handleInvoicePaidCustomerNotif(payload: InvoicePaidPayload) {
    const inv = payload.invoice;
    await this.sendCustomerNotification(
      payload.businessId,
      'payment_receipt',
      inv.contact,
      {
        invoiceNumber: inv.invoiceNumber ?? inv.id.slice(-6).toUpperCase(),
        total: inv.total,
        currency: inv.currency,
        paidAt: inv.paidAt ?? new Date(),
      },
      `receipt_invoice_${inv.id}`,
    );
  }

  /**
   * Connector-driven payment.received: covers partial-payment and
   * out-of-band reconciliation cases where invoice.paid may not have
   * fired. Uses the SAME dedupeKey as the invoice.paid handler
   * (`receipt_invoice_<invoiceId>`) so a customer never gets two
   * receipts when both events occur for the same invoice.
   */
  @OnEvent('payment.received')
  async handlePaymentReceivedCustomerReceipt(payload: PaymentReceivedPayload) {
    if (!payload.invoiceId) return;
    const inv = await this.prisma.client.invoice
      .findFirst({
        where: { id: payload.invoiceId, businessId: payload.businessId, deletedAt: null },
        include: { contact: { select: { id: true, firstName: true, lastName: true, email: true } } },
      })
      .catch(() => null);
    if (!inv?.contact?.email) return;
    await this.sendCustomerNotification(
      payload.businessId,
      'payment_receipt',
      inv.contact,
      {
        invoiceNumber: inv.invoiceNumber ?? inv.id.slice(-6).toUpperCase(),
        total: payload.amount ?? inv.total,
        currency: payload.currency ?? inv.currency,
        paidAt: new Date(),
      },
      `receipt_invoice_${inv.id}`,
    );
  }

  async handleBookingReminders() {
    try {
      const now = new Date();
      const reminderWindowStart = new Date(now.getTime() + 23 * 60 * 60 * 1000);
      const reminderWindowEnd = new Date(now.getTime() + 25 * 60 * 60 * 1000);

      const upcomingBookings = await this.prisma.client.booking.findMany({
        where: {
          status: { in: ['CONFIRMED', 'PENDING'] },
          deletedAt: null,
          startTime: { gte: reminderWindowStart, lt: reminderWindowEnd },
        },
        include: {
          contact: { select: { id: true, firstName: true, lastName: true, email: true } },
          service: { select: { name: true } },
          staff: { select: { name: true } },
        },
      });

      for (const booking of upcomingBookings) {
        const dedupeKey = `reminder_${booking.id}`;
        const alreadySent = await this.prisma.client.customerNotificationLog.findFirst({
          where: {
            businessId: booking.businessId,
            type: 'booking_reminder',
            messageId: dedupeKey,
            status: { in: ['SENT', 'QUEUED'] },
          },
        });
        if (alreadySent) continue;

        await this.sendCustomerNotification(booking.businessId, 'booking_reminder', booking.contact, {
          serviceName: booking.service?.name ?? 'Appointment',
          startTime: booking.startTime,
          endTime: booking.endTime,
          staffName: booking.staff?.name,
          bookingId: booking.id,
          location: (booking as any).location ?? null,
          locationPlaceId: (booking as any).locationPlaceId ?? null,
          locationLatLng: (booking as any).locationLatLng ?? null,
        }, dedupeKey);
      }

      if (upcomingBookings.length > 0) {
        this.logger.log(`Processed ${upcomingBookings.length} booking reminders`);
      }
    } catch (e) {
      this.logger.error(`Booking reminder cron failed: ${(e as Error).message}`);
    }
  }
}
