import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../core/prisma/prisma.service';
import { createHmac } from 'crypto';
import type {
  ContactCreatedPayload,
  ContactUpdatedPayload,
  ContactMergedPayload,
  BookingCreatedPayload,
  BookingConfirmedPayload,
  BookingCompletedPayload,
  InvoicePaidPayload,
  InvoiceStatusPayload,
  PostPublishedPayload,
} from '../../core/event-bus/events.types';

interface WebhookRecord {
  id: string;
  url: string;
  secret: string;
  events: string[];
  isActive: boolean;
}

@Injectable()
export class WebhookDispatcherService {
  private readonly logger = new Logger(WebhookDispatcherService.name);

  constructor(private readonly prisma: PrismaService) {}

  @OnEvent('contact.created')
  async onContactCreated(payload: ContactCreatedPayload) {
    await this.dispatch('contact.created', payload.businessId, {
      contact: this.sanitizeContact(payload.contact),
    });
  }

  @OnEvent('contact.updated')
  async onContactUpdated(payload: ContactUpdatedPayload) {
    await this.dispatch('contact.updated', payload.businessId, {
      contact: this.sanitizeContact(payload.contact),
      fromStatus: payload.fromStatus ?? null,
      toStatus: payload.toStatus ?? null,
    });
  }

  @OnEvent('contact.merged')
  async onContactMerged(payload: ContactMergedPayload) {
    await this.dispatch('contact.merged', payload.businessId, {
      contact: this.sanitizeContact(payload.contact),
      mergedContactId: payload.duplicateId,
    });
  }

  @OnEvent('booking.created')
  async onBookingCreated(payload: BookingCreatedPayload) {
    await this.dispatch('booking.created', payload.businessId, {
      booking: payload.booking,
      contact: payload.contact ? this.sanitizeContact(payload.contact) : null,
    });
  }

  @OnEvent('booking.confirmed')
  async onBookingConfirmed(payload: BookingConfirmedPayload) {
    await this.dispatch('booking.confirmed', payload.businessId, {
      booking: payload.booking,
      contact: payload.contact ? this.sanitizeContact(payload.contact) : null,
    });
  }

  @OnEvent('booking.completed')
  async onBookingCompleted(payload: BookingCompletedPayload) {
    await this.dispatch('booking.completed', payload.businessId, {
      booking: payload.booking,
    });
  }

  @OnEvent('invoice.paid')
  async onInvoicePaid(payload: InvoicePaidPayload) {
    await this.dispatch('invoice.paid', payload.businessId, {
      invoice: payload.invoice,
    });
  }

  @OnEvent('invoice.sent')
  async onInvoiceSent(payload: InvoiceStatusPayload) {
    await this.dispatch('invoice.sent', payload.businessId, {
      invoice: payload.invoice,
      status: payload.status,
    });
  }

  @OnEvent('invoice.overdue')
  async onInvoiceOverdue(payload: InvoiceStatusPayload) {
    await this.dispatch('invoice.overdue', payload.businessId, {
      invoice: payload.invoice,
      status: payload.status,
    });
  }

  @OnEvent('post.published')
  async onPostPublished(payload: PostPublishedPayload) {
    await this.dispatch('post.published', payload.businessId, {
      post: payload.post,
    });
  }

  private async dispatch(event: string, businessId: string, data: Record<string, unknown>) {
    try {
      const webhooks = await this.prisma.client.webhook.findMany({
        where: {
          businessId,
          isActive: true,
          events: { has: event },
        },
      });

      if (webhooks.length === 0) return;

      const payload = {
        event,
        timestamp: new Date().toISOString(),
        businessId,
        data,
      };

      const body = JSON.stringify(payload);

      await Promise.allSettled(
        webhooks.map((wh: WebhookRecord) => this.send(wh, event, payload.timestamp, body)),
      );
    } catch (err) {
      this.logger.error(`Webhook dispatch error for ${event}: ${(err as Error).message}`);
    }
  }

  private async send(webhook: WebhookRecord, event: string, timestamp: string, body: string) {
    const signature = createHmac('sha256', webhook.secret).update(body).digest('hex');

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-KeyFlow-Event': event,
          'X-KeyFlow-Signature': signature,
          'X-KeyFlow-Timestamp': timestamp,
          'User-Agent': 'KeyFlowOS-Webhooks/1.0',
        },
        body,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        this.logger.warn(`Webhook ${webhook.id} returned ${response.status} for ${webhook.url}`);
      }
    } catch (err) {
      this.logger.warn(`Webhook ${webhook.id} failed: ${(err as Error).message}`);
    }
  }

  private sanitizeContact(contact: any) {
    if (!contact) return null;
    const { businessId: _b, ...rest } = contact;
    return rest;
  }
}
