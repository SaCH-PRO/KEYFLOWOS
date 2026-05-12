import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ActivityService } from './activity.service';
import {
  InvoiceCreatedPayload,
  InvoicePaidPayload,
  InvoiceStatusPayload,
  QuoteCreatedPayload,
  QuoteSentPayload,
  QuoteAcceptedPayload,
  QuoteRejectedPayload,
  QuoteConvertedPayload,
  BookingCreatedPayload,
  BookingConfirmedPayload,
  BookingCompletedPayload,
  BookingCancelledPayload,
  BookingRescheduledPayload,
  ContactCreatedPayload,
  ContactUpdatedPayload,
  ContactMergedPayload,
  ContactImportedPayload,
} from '../../core/event-bus/events.types';

function contactName(contact?: { firstName?: string | null; lastName?: string | null; email?: string | null } | null): string {
  if (!contact) return 'Someone';
  const name = [contact.firstName, contact.lastName].filter(Boolean).join(' ').trim();
  return name || contact.email || 'Someone';
}

@Injectable()
export class ActivityEventListener {
  private readonly logger = new Logger(ActivityEventListener.name);

  constructor(@Inject(ActivityService) private readonly activity: ActivityService) {}

  // -- Commerce: Invoices --

  @OnEvent('invoice.created')
  async onInvoiceCreated(payload: InvoiceCreatedPayload) {
    const inv = payload.invoice;
    await this.activity.log({
      businessId: payload.businessId,
      module: 'commerce',
      action: 'created',
      entityType: 'invoice',
      entityId: inv.id,
      title: `Invoice ${inv.invoiceNumber || inv.id.slice(-6).toUpperCase()} created`,
      detail: `For ${contactName(inv.contact)}${inv.total ? ` — ${inv.currency || 'TTD'} ${inv.total.toLocaleString()}` : ''}`,
      icon: 'file-text',
      tone: 'info',
      data: { invoiceId: inv.id, total: inv.total, currency: inv.currency, source: payload.source },
      contactId: inv.contactId || undefined,
    });
  }

  @OnEvent('invoice.paid')
  async onInvoicePaid(payload: InvoicePaidPayload) {
    const inv = payload.invoice;
    await this.activity.log({
      businessId: payload.businessId,
      module: 'commerce',
      action: 'paid',
      entityType: 'invoice',
      entityId: inv.id,
      title: `Payment received`,
      detail: `Invoice ${inv.invoiceNumber || inv.id.slice(-6).toUpperCase()}${inv.total ? ` — ${inv.currency || 'TTD'} ${inv.total.toLocaleString()}` : ''}`,
      icon: 'dollar-sign',
      tone: 'success',
      data: { invoiceId: inv.id, total: inv.total, currency: inv.currency },
      contactId: inv.contactId || undefined,
    });
  }

  @OnEvent('invoice.sent')
  async onInvoiceSent(payload: InvoiceStatusPayload) {
    const inv = payload.invoice;
    await this.activity.log({
      businessId: payload.businessId,
      module: 'commerce',
      action: 'sent',
      entityType: 'invoice',
      entityId: inv.id,
      title: `Invoice sent`,
      detail: `Invoice ${inv.invoiceNumber || inv.id.slice(-6).toUpperCase()} sent to ${contactName(inv.contact)}`,
      icon: 'mail',
      tone: 'info',
      data: { invoiceId: inv.id },
      contactId: inv.contactId || undefined,
    });
  }

  @OnEvent('invoice.overdue')
  async onInvoiceOverdue(payload: InvoiceStatusPayload) {
    const inv = payload.invoice;
    await this.activity.log({
      businessId: payload.businessId,
      module: 'commerce',
      action: 'overdue',
      entityType: 'invoice',
      entityId: inv.id,
      title: `Invoice overdue`,
      detail: `Invoice ${inv.invoiceNumber || inv.id.slice(-6).toUpperCase()} is now overdue`,
      icon: 'alert-triangle',
      tone: 'danger',
      data: { invoiceId: inv.id },
      contactId: inv.contactId || undefined,
    });
  }

  // -- Commerce: Quotes --

  @OnEvent('quote.created')
  async onQuoteCreated(payload: QuoteCreatedPayload) {
    const q = payload.quote;
    await this.activity.log({
      businessId: payload.businessId,
      module: 'commerce',
      action: 'created',
      entityType: 'quote',
      entityId: q.id,
      title: `Quote created`,
      detail: `For ${contactName(q.contact)}${q.total ? ` — ${q.currency || 'TTD'} ${q.total.toLocaleString()}` : ''}`,
      icon: 'file-text',
      tone: 'info',
      data: { quoteId: q.id, total: q.total, currency: q.currency },
      contactId: q.contactId || undefined,
    });
  }

  @OnEvent('quote.sent')
  async onQuoteSent(payload: QuoteSentPayload) {
    const q = payload.quote;
    await this.activity.log({
      businessId: payload.businessId,
      module: 'commerce',
      action: 'sent',
      entityType: 'quote',
      entityId: q.id,
      title: `Quote sent`,
      detail: `Quote sent to ${contactName(q.contact)}`,
      icon: 'mail',
      tone: 'info',
      data: { quoteId: q.id },
      contactId: q.contactId || undefined,
    });
  }

  @OnEvent('quote.accepted')
  async onQuoteAccepted(payload: QuoteAcceptedPayload) {
    const q = payload.quote;
    await this.activity.log({
      businessId: payload.businessId,
      module: 'commerce',
      action: 'accepted',
      entityType: 'quote',
      entityId: q.id,
      title: `Quote accepted`,
      detail: `${contactName(q.contact)} accepted the quote`,
      icon: 'check-circle',
      tone: 'success',
      data: { quoteId: q.id },
      contactId: q.contactId || undefined,
    });
  }

  @OnEvent('quote.rejected')
  async onQuoteRejected(payload: QuoteRejectedPayload) {
    const q = payload.quote;
    await this.activity.log({
      businessId: payload.businessId,
      module: 'commerce',
      action: 'rejected',
      entityType: 'quote',
      entityId: q.id,
      title: `Quote rejected`,
      detail: `${contactName(q.contact)} rejected the quote${payload.reason ? `: ${payload.reason}` : ''}`,
      icon: 'x-circle',
      tone: 'danger',
      data: { quoteId: q.id, reason: payload.reason },
      contactId: q.contactId || undefined,
    });
  }

  @OnEvent('quote.converted')
  async onQuoteConverted(payload: QuoteConvertedPayload) {
    const q = payload.quote;
    const inv = payload.invoice;
    await this.activity.log({
      businessId: payload.businessId,
      module: 'commerce',
      action: 'converted',
      entityType: 'quote',
      entityId: q.id,
      title: `Quote converted to invoice`,
      detail: `Invoice ${inv.invoiceNumber || inv.id.slice(-6).toUpperCase()} created from quote`,
      icon: 'refresh-cw',
      tone: 'success',
      data: { quoteId: q.id, invoiceId: inv.id },
      contactId: q.contactId || undefined,
    });
  }

  // -- Bookings --

  @OnEvent('booking.created')
  async onBookingCreated(payload: BookingCreatedPayload) {
    const bk = payload.booking;
    await this.activity.log({
      businessId: payload.businessId,
      module: 'bookings',
      action: 'created',
      entityType: 'booking',
      entityId: bk.id,
      title: `New booking`,
      detail: `${contactName(payload.contact)} booked ${(bk as any).service?.name || 'an appointment'}`,
      icon: 'calendar',
      tone: 'info',
      data: { bookingId: bk.id, serviceId: bk.serviceId, startTime: bk.startTime },
      contactId: bk.contactId || undefined,
    });
  }

  @OnEvent('booking.confirmed')
  async onBookingConfirmed(payload: BookingConfirmedPayload) {
    const bk = payload.booking;
    await this.activity.log({
      businessId: payload.businessId,
      module: 'bookings',
      action: 'confirmed',
      entityType: 'booking',
      entityId: bk.id,
      title: `Booking confirmed`,
      detail: `${(bk as any).service?.name || 'Appointment'} confirmed`,
      icon: 'check-circle',
      tone: 'success',
      data: { bookingId: bk.id },
      contactId: bk.contactId || undefined,
    });
  }

  @OnEvent('booking.completed')
  async onBookingCompleted(payload: BookingCompletedPayload) {
    const bk = payload.booking;
    await this.activity.log({
      businessId: payload.businessId,
      module: 'bookings',
      action: 'completed',
      entityType: 'booking',
      entityId: bk.id,
      title: `Service completed`,
      detail: `${(bk as any).service?.name || 'Appointment'} marked complete`,
      icon: 'star',
      tone: 'success',
      data: { bookingId: bk.id },
      contactId: bk.contactId || undefined,
    });
  }

  @OnEvent('booking.cancelled')
  async onBookingCancelled(payload: BookingCancelledPayload) {
    const bk = payload.booking;
    await this.activity.log({
      businessId: payload.businessId,
      module: 'bookings',
      action: 'cancelled',
      entityType: 'booking',
      entityId: bk.id,
      title: `Booking cancelled`,
      detail: `${(bk as any).service?.name || 'Appointment'} was cancelled`,
      icon: 'alert-triangle',
      tone: 'danger',
      data: { bookingId: bk.id },
      contactId: bk.contactId || undefined,
    });
  }

  @OnEvent('booking.rescheduled')
  async onBookingRescheduled(payload: BookingRescheduledPayload) {
    const bk = payload.booking;
    await this.activity.log({
      businessId: payload.businessId,
      module: 'bookings',
      action: 'rescheduled',
      entityType: 'booking',
      entityId: bk.id,
      title: `Booking rescheduled`,
      detail: `${(bk as any).service?.name || 'Appointment'} moved to new time`,
      icon: 'clock',
      tone: 'warning',
      data: { bookingId: bk.id, startTime: bk.startTime },
      contactId: bk.contactId || undefined,
    });
  }

  // -- CRM --

  @OnEvent('contact.created')
  async onContactCreated(payload: ContactCreatedPayload) {
    const c = payload.contact;
    await this.activity.log({
      businessId: payload.businessId,
      module: 'crm',
      action: 'created',
      entityType: 'contact',
      entityId: c.id,
      title: `New contact`,
      detail: `${contactName(c)} added to CRM`,
      icon: 'user-plus',
      tone: 'info',
      data: { contactId: c.id },
      contactId: c.id,
    });
  }

  @OnEvent('contact.updated')
  async onContactUpdated(payload: ContactUpdatedPayload) {
    if (!payload.fromStatus || !payload.toStatus || payload.fromStatus === payload.toStatus) return;
    const c = payload.contact;
    await this.activity.log({
      businessId: payload.businessId,
      module: 'crm',
      action: 'updated',
      entityType: 'contact',
      entityId: c.id,
      title: `Status changed`,
      detail: `${contactName(c)}: ${payload.fromStatus} → ${payload.toStatus}`,
      icon: 'sparkles',
      tone: 'info',
      data: { contactId: c.id, from: payload.fromStatus, to: payload.toStatus },
      contactId: c.id,
    });
  }

  @OnEvent('contact.merged')
  async onContactMerged(payload: ContactMergedPayload) {
    const c = payload.contact;
    await this.activity.log({
      businessId: payload.businessId,
      module: 'crm',
      action: 'merged',
      entityType: 'contact',
      entityId: c.id,
      title: `Contacts merged`,
      detail: `${contactName(c)} merged with duplicate`,
      icon: 'git-merge',
      tone: 'warning',
      data: { contactId: c.id, duplicateId: payload.duplicateId },
      contactId: c.id,
    });
  }

  @OnEvent('contact.imported')
  async onContactImported(payload: ContactImportedPayload) {
    await this.activity.log({
      businessId: payload.businessId,
      module: 'crm',
      action: 'imported',
      entityType: 'contact',
      title: `Contacts imported`,
      detail: `${payload.count} contact${payload.count === 1 ? '' : 's'} imported from ${payload.source}`,
      icon: 'download',
      tone: 'info',
      data: { count: payload.count, source: payload.source },
    });
  }
}
