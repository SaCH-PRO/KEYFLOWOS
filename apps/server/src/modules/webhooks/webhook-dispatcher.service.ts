import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../core/prisma/prisma.service';
import { createHmac } from 'crypto';
import { CheckedAddress, PinnedDispatcher } from '../../core/security/outbound-address';
import { checkWebhookUrl, WebhookUrlRefusedError } from './webhook-url';
import { projectWebhookPayload } from './webhook-payload';
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

  /**
   * Every family's records are delivered through dispatch(), which projects the whole payload
   * (webhook-payload.ts; round 1 class repair, CLASS A): a contact, wherever it sits (the contact.*
   * subject, a booking's or an invoice's contact), is delivered as the fixed person view, a row of a
   * module the subscriber was not checked for as its id, and no credential or private CRM field at
   * any depth. The handlers below hand the payload's records over as the emitters read them.
   */
  @OnEvent('contact.created')
  async onContactCreated(payload: ContactCreatedPayload) {
    await this.dispatch('contact.created', payload.businessId, {
      contact: payload.contact ?? null,
    });
  }

  @OnEvent('contact.updated')
  async onContactUpdated(payload: ContactUpdatedPayload) {
    await this.dispatch('contact.updated', payload.businessId, {
      contact: payload.contact ?? null,
      fromStatus: payload.fromStatus ?? null,
      toStatus: payload.toStatus ?? null,
    });
  }

  @OnEvent('contact.merged')
  async onContactMerged(payload: ContactMergedPayload) {
    await this.dispatch('contact.merged', payload.businessId, {
      contact: payload.contact ?? null,
      mergedContactId: payload.duplicateId,
    });
  }

  /**
   * SWEEP-P0-SCOPES second review repair (finding SV-1): BookingsService emits the booking read with
   * include { contact: true }, and the whole Contact row went out (a PRIVATE contact's visibility,
   * owner, internal note and money signals; D-100) to a bookings-read member. dispatch() delivers it
   * as the fixed person view, at data.contact and at data.booking.contact.
   */
  @OnEvent('booking.created')
  async onBookingCreated(payload: BookingCreatedPayload) {
    await this.dispatch('booking.created', payload.businessId, {
      booking: payload.booking,
      contact: payload.contact ?? null,
    });
  }

  @OnEvent('booking.confirmed')
  async onBookingConfirmed(payload: BookingConfirmedPayload) {
    await this.dispatch('booking.confirmed', payload.businessId, {
      booking: payload.booking,
      contact: payload.contact ?? null,
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

  /**
   * FOLLOW3-A9: a refund's D-14 reopen (PAID / PARTIALLY_PAID -> SENT). Owner
   * ruling D-58: a webhook subscribed to invoice.paid also receives it (else
   * that integration keeps a refunded invoice paid), as does one subscribed to
   * invoice.reopened; each such webhook gets one delivery.
   */
  @OnEvent('invoice.reopened')
  async onInvoiceReopened(payload: InvoiceStatusPayload & { previousStatus?: string }) {
    await this.dispatch(
      'invoice.reopened',
      payload.businessId,
      {
        invoice: payload.invoice,
        status: payload.status,
        previousStatus: payload.previousStatus ?? null,
      },
      ['invoice.reopened', 'invoice.paid'],
    );
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

  /**
   * W9-STORE-PAID-LISTENERS (V18-T2, SEC-V18-3; D-18): a store_order.paid is
   * delivered only for an order stored PAID in the event's business. PATCH
   * .../orders/:id/status 'paid' with no payment emits it for a STANDARD order
   * stored UNPAID, and a queued or forged copy can name an unpaid order or
   * another business's order; each went to the business's endpoints as a paid
   * order. Nothing is sent otherwise.
   *
   * Still open (it.todo in storefront-paid-event.integration.test.ts): the
   * stored PAID read here is itself written with no payment and no revenue
   * write by PATCH .../status paymentStatus PAID or the fulfil mark_paid action
   * on a STANDARD order (V18-T2c, review STL-SEC-1: needs an owner ruling); the
   * other store_order.paid listeners do not read it (V18-T2b).
   */
  @OnEvent('store_order.paid')
  async onStoreOrderPaid(payload: StoreOrderPaidPayload) {
    if (!(await this.isStoredOrderPaid(payload))) return;
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

  /**
   * `subscribedVia` lists the subscriptions that receive `event` (default: the
   * event itself); a webhook subscribed to several of them gets one delivery.
   *
   * Round 1 class repair (CLASS A; RC-1): the one door every delivery goes through. The data is
   * projected here, whatever the family (projectWebhookPayload, webhook-payload.ts): person rows as
   * the fixed person view, rows of a module the subscriber was not checked for as their id, no
   * credential or contact-private key at any depth. invoice.* delivered the invoice's whole Contact
   * row (InvoiceWorkflowService reads it with include { contact: true, booking: true }) after the
   * SV-1 repair had projected booking.* only.
   */
  private async dispatch(
    event: string,
    businessId: string,
    data: Record<string, unknown>,
    subscribedVia: string[] = [event],
  ) {
    try {
      const webhooks = await this.prisma.client.webhook.findMany({
        where: {
          businessId,
          isActive: true,
          events: { hasSome: subscribedVia },
        },
      });

      if (webhooks.length === 0) return;

      const payload = {
        event,
        timestamp: new Date().toISOString(),
        businessId,
        data: projectWebhookPayload(event, data),
      };

      const body = JSON.stringify(payload);

      await Promise.allSettled(
        webhooks.map((wh: WebhookRecord) => this.sendWithLogging(wh, event, payload.timestamp, body, businessId)),
      );
    } catch (err: any) {
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

  /**
   * SWEEP-P0-SCOPES (browser sweep BUG-001): every delivery goes through the outbound-address guard
   * first (checkWebhookUrl, the rule the create route applies): a URL whose host is not public (a
   * row stored before the create check, or a name that now resolves to a private address) is
   * logged failed and never connected to, and is not retried. A delivery connects only to the
   * addresses that check answered (PinnedDispatcher: no second DNS answer is used) and does not
   * follow a redirect (redirect 'manual': a 3xx is a failed delivery), so it cannot be bounced onto
   * an address the check never saw.
   */
  private async sendWithLogging(webhook: WebhookRecord, event: string, timestamp: string, body: string, businessId: string): Promise<WebhookDeliveryLog> {
    const startTime = Date.now();
    let target: CheckedAddress;
    try {
      target = (await checkWebhookUrl(webhook.url)).target;
    } catch (err) {
      const reason = err instanceof WebhookUrlRefusedError ? err.message : `Webhook URL check failed: ${(err as Error).message}`;
      this.logger.warn(`Webhook ${webhook.id} not delivered for ${event}: ${reason}`);
      const refused: WebhookDeliveryLog = {
        id: `del-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        webhookId: webhook.id,
        businessId,
        event,
        url: webhook.url,
        status: 'failed',
        statusCode: null,
        attempts: 0,
        duration: Date.now() - startTime,
        error: reason,
        timestamp: new Date().toISOString(),
      };
      this.addLog(refused);
      return refused;
    }
    const signature = createHmac('sha256', webhook.secret).update(body).digest('hex');
    let lastStatusCode: number | null = null;
    let lastError: string | null = null;
    for (let attempt = 1; attempt <= WebhookDispatcherService.MAX_RETRIES; attempt++) {
      const pinned = new PinnedDispatcher(target);
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
          redirect: 'manual',
          dispatcher: pinned,
        } as RequestInit);

        clearTimeout(timeout);
        lastStatusCode = response.status;
        await response.body?.cancel().catch(() => undefined);

        if (response.ok) {
          if (attempt > 1) {
            this.logger.log(`Webhook ${webhook.id} succeeded on attempt ${attempt}`);
          }
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
      } catch (err: any) {
        lastError = (err as Error).message;
        this.logger.warn(
          `Webhook ${webhook.id} failed (attempt ${attempt}/${WebhookDispatcherService.MAX_RETRIES}): ${lastError}`,
        );
      } finally {
        // close() lets the request in flight finish, then ends the pinned connection.
        pinned.close().catch(() => undefined);
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

  /** W9-STORE-PAID-LISTENERS (V18-T2; D-18): the order the paid event names, read in its business, is stored PAID. */
  private async isStoredOrderPaid(payload: StoreOrderPaidPayload): Promise<boolean> {
    const orderId = (payload?.order as { id?: unknown } | undefined)?.id;
    if (typeof orderId !== 'string' || !orderId || !payload?.businessId) return false;
    try {
      const stored = await this.prisma.client.marketplaceOrder.findFirst({
        where: { id: orderId, businessId: payload.businessId },
        select: { paymentStatus: true },
      });
      if ((stored?.paymentStatus ?? '').toUpperCase() === 'PAID') return true;
      this.logger.warn(
        `store_order.paid for order ${orderId} not stored PAID in business ${payload.businessId} (${stored ? stored.paymentStatus : 'not found'}); no webhook sent`,
      );
      return false;
    } catch (err) {
      this.logger.error(`store_order.paid stored-order read failed for ${orderId}: ${(err as Error).message}`);
      return false;
    }
  }

}
