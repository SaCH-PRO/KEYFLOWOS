import { Inject, Injectable, Logger } from '@nestjs/common';
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
  StoreOrderCreatedPayload,
  StoreOrderPaidPayload,
  StoreOrderShippedPayload,
  StoreOrderDeliveredPayload,
  StoreOrderCancelledPayload,
} from '../../core/event-bus/events.types';

interface WebhookRecord {
  id: string;
  name: string;
  url: string;
  secret: string;
  events: string[];
  isActive: boolean;
}

export interface WebhookDeliveryLog {
  id: string;
  webhookId: string;
  businessId: string;
  event: string;
  url: string;
  status: 'success' | 'failed';
  statusCode: number | null;
  attempts: number;
  duration: number;
  error: string | null;
  timestamp: string;
}

@Injectable()
export class WebhookDispatcherService {
  private readonly logger = new Logger(WebhookDispatcherService.name);
  private readonly deliveryLogs: WebhookDeliveryLog[] = [];
  private static readonly MAX_LOG_SIZE = 200;

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  getDeliveryLogs(businessId: string, webhookId?: string, limit = 50): WebhookDeliveryLog[] {
    let logs = this.deliveryLogs.filter((l) => l.businessId === businessId);
    if (webhookId) {
      logs = logs.filter((l) => l.webhookId === webhookId);
    }
    return logs.slice(-limit).reverse();
  }

  async sendTestEvent(webhookId: string, businessId: string): Promise<WebhookDeliveryLog> {
    const webhook = await this.prisma.client.webhook.findFirst({
      where: { id: webhookId, businessId, isActive: true },
    });

    if (!webhook) {
      return {
        id: `test-${Date.now()}`,
        webhookId,
        businessId,
        event: 'test.ping',
        url: '',
        status: 'failed',
        statusCode: null,
        attempts: 0,
        duration: 0,
        error: 'Webhook not found or inactive',
        timestamp: new Date().toISOString(),
      };
    }

    const testPayload = {
      event: 'test.ping',
      timestamp: new Date().toISOString(),
      businessId,
      data: {
        message: 'This is a test webhook delivery from KeyFlowOS',
        webhookId: webhook.id,
        webhookName: webhook.name || 'Webhook',
      },
    };

    const body = JSON.stringify(testPayload);
    const wh: WebhookRecord = {
      id: webhook.id,
      name: webhook.name,
      url: webhook.url,
      secret: webhook.secret,
      events: webhook.events,
      isActive: webhook.isActive,
    };
    const logEntry = await this.sendWithLogging(
      wh,
      'test.ping',
      testPayload.timestamp,
      body,
      businessId,
    );
    return logEntry;
  }

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

  @OnEvent('store_order.created')
  async onStoreOrderCreated(payload: StoreOrderCreatedPayload) {
    await this.dispatch('store_order.created', payload.businessId, {
      order: payload.order,
    });
  }

  @OnEvent('store_order.paid')
  async onStoreOrderPaid(payload: StoreOrderPaidPayload) {
    await this.dispatch('store_order.paid', payload.businessId, {
      order: payload.order,
    });
  }

  @OnEvent('store_order.shipped')
  async onStoreOrderShipped(payload: StoreOrderShippedPayload) {
    await this.dispatch('store_order.shipped', payload.businessId, {
      order: payload.order,
    });
  }

  @OnEvent('store_order.delivered')
  async onStoreOrderDelivered(payload: StoreOrderDeliveredPayload) {
    await this.dispatch('store_order.delivered', payload.businessId, {
      order: payload.order,
    });
  }

  @OnEvent('store_order.cancelled')
  async onStoreOrderCancelled(payload: StoreOrderCancelledPayload) {
    await this.dispatch('store_order.cancelled', payload.businessId, {
      order: payload.order,
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
        webhooks.map((wh: WebhookRecord) => this.sendWithLogging(wh, event, payload.timestamp, body, businessId)),
      );
    } catch (err) {
      this.logger.error(`Webhook dispatch error for ${event}: ${(err as Error).message}`);
    }
  }

  private static readonly MAX_RETRIES = 3;
  private static readonly BACKOFF_BASE_MS = 1000;

  private addLog(log: WebhookDeliveryLog) {
    this.deliveryLogs.push(log);
    if (this.deliveryLogs.length > WebhookDispatcherService.MAX_LOG_SIZE) {
      this.deliveryLogs.splice(0, this.deliveryLogs.length - WebhookDispatcherService.MAX_LOG_SIZE);
    }
  }

  private async sendWithLogging(webhook: WebhookRecord, event: string, timestamp: string, body: string, businessId: string): Promise<WebhookDeliveryLog> {
    const startTime = Date.now();
    const signature = createHmac('sha256', webhook.secret).update(body).digest('hex');
    let lastStatusCode: number | null = null;
    let lastError: string | null = null;
    let succeeded = false;

    for (let attempt = 1; attempt <= WebhookDispatcherService.MAX_RETRIES; attempt++) {
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
        lastStatusCode = response.status;

        if (response.ok) {
          if (attempt > 1) {
            this.logger.log(`Webhook ${webhook.id} succeeded on attempt ${attempt}`);
          }
          succeeded = true;
          const log: WebhookDeliveryLog = {
            id: `del-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            webhookId: webhook.id,
            businessId,
            event,
            url: webhook.url,
            status: 'success',
            statusCode: lastStatusCode,
            attempts: attempt,
            duration: Date.now() - startTime,
            error: null,
            timestamp: new Date().toISOString(),
          };
          this.addLog(log);
          return log;
        }

        lastError = `HTTP ${response.status}`;
        this.logger.warn(
          `Webhook ${webhook.id} returned ${response.status} (attempt ${attempt}/${WebhookDispatcherService.MAX_RETRIES})`,
        );
      } catch (err) {
        lastError = (err as Error).message;
        this.logger.warn(
          `Webhook ${webhook.id} failed (attempt ${attempt}/${WebhookDispatcherService.MAX_RETRIES}): ${lastError}`,
        );
      }

      if (attempt < WebhookDispatcherService.MAX_RETRIES) {
        const delay = WebhookDispatcherService.BACKOFF_BASE_MS * Math.pow(4, attempt - 1);
        await new Promise((r) => setTimeout(r, delay));
      }
    }

    this.logger.error(
      `Webhook ${webhook.id} delivery failed after ${WebhookDispatcherService.MAX_RETRIES} attempts for ${event} → ${webhook.url}`,
    );

    const log: WebhookDeliveryLog = {
      id: `del-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      webhookId: webhook.id,
      businessId,
      event,
      url: webhook.url,
      status: 'failed',
      statusCode: lastStatusCode,
      attempts: WebhookDispatcherService.MAX_RETRIES,
      duration: Date.now() - startTime,
      error: lastError,
      timestamp: new Date().toISOString(),
    };
    this.addLog(log);
    return log;
  }

  private sanitizeContact(contact: any) {
    if (!contact) return null;
    const { businessId: _b, ...rest } = contact;
    return rest;
  }
}
