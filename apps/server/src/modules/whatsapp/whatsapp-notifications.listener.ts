import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Inject } from '@nestjs/common';
import { WhatsAppService } from './whatsapp.service';
import type { BookingCreatedPayload, InvoiceCreatedPayload, InvoicePaidPayload } from '../../core/event-bus/events.types';

/**
 * Auto-sends WhatsApp notifications when business-relevant events occur.
 * Requires the business to have WhatsApp configured (provider, credentials).
 */
@Injectable()
export class WhatsAppNotificationsListener {
  private readonly logger = new Logger(WhatsAppNotificationsListener.name);

  constructor(
    @Inject(WhatsAppService) private readonly whatsapp: WhatsAppService,
  ) {}

  @OnEvent('booking.created', { async: true })
  async onBookingCreated(payload: BookingCreatedPayload) {
    try {
      const { booking, contact, businessId } = payload;
      const phone = contact?.phone;
      if (!phone) return;

      const start = new Date(booking.startTime);
      const date = start.toLocaleDateString('en-GB');
      const time = start.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

      const result = await this.whatsapp.sendBookingConfirmation(
        businessId,
        phone,
        contact?.displayName ?? contact?.firstName ?? 'there',
        booking.notes ?? 'your appointment',
        date,
        time,
      );

      if (!result.success) {
        this.logger.warn(`WhatsApp booking confirmation failed: ${result.error}`);
      }
    } catch (err: any) {
      this.logger.error(`WhatsApp notification error (booking.created): ${(err as Error).message}`);
    }
  }

  @OnEvent('invoice.created', { async: true })
  async onInvoiceCreated(payload: InvoiceCreatedPayload) {
    try {
      const { invoice, businessId } = payload;
      // Only notify if invoice is sent (not draft)
      if (invoice.status !== 'SENT' && invoice.status !== 'OVERDUE') return;
      const phone = invoice.contact?.phone;
      if (!phone) return;

      const result = await this.whatsapp.sendInvoiceReminder(
        businessId,
        phone,
        invoice.contact?.displayName ?? invoice.contact?.firstName ?? 'there',
        invoice.invoiceNumber ?? invoice.id,
        invoice.total,
        invoice.currency ?? 'TTD',
      );

      if (!result.success) {
        this.logger.warn(`WhatsApp invoice reminder failed: ${result.error}`);
      }
    } catch (err: any) {
      this.logger.error(`WhatsApp notification error (invoice.created): ${(err as Error).message}`);
    }
  }

  @OnEvent('invoice.paid', { async: true })
  async onInvoicePaid(payload: InvoicePaidPayload) {
    try {
      const { invoice, businessId } = payload;
      const phone = invoice.contact?.phone;
      if (!phone) return;

      const body = `Hi ${invoice.contact?.displayName ?? invoice.contact?.firstName ?? 'there'}, thank you for your payment of ${invoice.currency ?? 'TTD'} ${invoice.total} for invoice *${invoice.invoiceNumber ?? invoice.id}*. Your receipt is available in your portal.`;
      const result = await this.whatsapp.sendMessage(businessId, {
        to: phone,
        body,
      });

      if (!result.success) {
        this.logger.warn(`WhatsApp payment confirmation failed: ${result.error}`);
      }
    } catch (err: any) {
      this.logger.error(`WhatsApp notification error (invoice.paid): ${(err as Error).message}`);
    }
  }
}
