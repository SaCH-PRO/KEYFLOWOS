import { Body, Controller, Delete, Get, Headers, Inject, Param, Post, Query, Req, UseGuards, Optional, Logger, BadRequestException } from '@nestjs/common';
import { Request } from 'express';
import Stripe from 'stripe';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { StripeConnector } from '../../core/connectors/implementations/stripe.connector';
import { normalizeCurrency } from '../finance/posting.service';
import { PaymentsService } from '../payments/payments.service';
import { WebhookDispatcherService } from './webhook-dispatcher.service';
import { randomBytes } from 'crypto';

/** Every answer of the deprecated Stripe route names its replacement. */
const LEGACY_STRIPE_HINT = { deprecated: true, use: '/payments/stripe/webhook' } as const;

/** The event types the Stripe ledger door records as an invoice payment (PaymentsService.handleStripeWebhook). */
const STRIPE_INVOICE_PAYMENT_EVENTS = new Set(['checkout.session.completed', 'charge.succeeded', 'payment_intent.succeeded']);

/**
 * R0-20b review (SEC-R020B-3): the webhook_events provider under which a
 * refused legacy delivery is kept, one row per Stripe event id (a retry adds
 * none), with the business of the invoice or order it named and
 * `<event type>:<reason>` as its event type. It is not the door's dedupe claim
 * (provider 'stripe'), so the door still processes the event if it is
 * delivered to POST /payments/stripe/webhook.
 */
const LEGACY_STRIPE_REFUSED_PROVIDER = 'stripe-legacy-refused';

/** What a payment event of the legacy route names, once it is bound. */
type LegacyStripeTarget = { kind: 'invoice' | 'order'; id: string; businessId: string };

/** The fields of a Stripe session, charge or payment intent the binding reads. */
type StripePaymentObject = {
  id?: string | null;
  metadata?: Record<string, string> | null;
  client_reference_id?: string | null;
  amount_total?: number | null;
  amount_received?: number | null;
  amount?: number | null;
  currency?: string | null;
};

@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);
  private readonly stripe: Stripe | null = null;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PaymentsService) private readonly payments: PaymentsService,
    @Inject(WebhookDispatcherService) private readonly dispatcher: WebhookDispatcherService,
    // R0-20b review (CR-R020B-2): the connector event 'payment.received' the route emitted before R0-20b.
    @Optional() @Inject(StripeConnector) private readonly stripeConnector?: StripeConnector,
  ) {
    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (secretKey) {
      this.stripe = new Stripe(secretKey, { apiVersion: '2025-08-27.basil' });
    }
  }

  @Get('health')
  health() {
    return { status: 'ok', module: 'webhooks' };
  }

  @Post('stripe')
  async handleStripeWebhook(
    @Req() req: Request,
    @Headers('stripe-signature') signature: string,
  ) {
    // ─── DEPRECATED — consolidated into /payments/stripe/webhook ────────────
    // The legacy /webhooks/stripe endpoint has been superseded by
    // /payments/stripe/webhook. It stays live for Stripe Dashboard
    // configurations that still point here.
    //
    // R0-20b-LEGACY-STRIPE-WEBHOOK-DOOR (D-05, ruled 2026-11-02; RA-G16-01):
    // after the signature check below, a payment event is bound to the
    // invoice or storefront order it names (bindLegacyStripeEvent) and the
    // verified bytes go to the same Stripe ledger door POST
    // /payments/stripe/webhook runs (PaymentsService.handleStripeWebhook:
    // provider-event dedupe, one SUCCESSFUL provider 'stripe' payment posted
    // with it, the reconcile). An event the binding accepts is recorded once,
    // whether it reaches this endpoint, the door's own endpoint or both; one it
    // refuses is never recorded by this route. The binding holds on this route
    // only: the door's own endpoint does not apply it (R0-20b review
    // SEC-R020B-2, a follow-up outside this write set). The route used to call
    // CommerceService.markInvoicePaid(invoiceId) with no actor and no tenant,
    // which recorded a 'manual' receipt for the remaining balance (posted Dr
    // CASH), checked nothing the session carried, and deduped only by the
    // invoice already being PAID.
    this.logger.warn(
      'Legacy /webhooks/stripe called — migrate Stripe Dashboard webhook URL to /payments/stripe/webhook',
    );

    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      this.logger.error('STRIPE_WEBHOOK_SECRET is not configured');
      throw new BadRequestException('Webhook secret not configured');
    }

    if (!signature) {
      this.logger.warn('Stripe webhook received without signature header');
      throw new BadRequestException('Missing stripe-signature header');
    }

    const rawBody = (req as { rawBody?: Buffer }).rawBody;
    if (!rawBody) {
      this.logger.error('Stripe webhook called but rawBody is not available');
      throw new BadRequestException('Webhook payload unreadable');
    }

    let event: Stripe.Event;
    try {
      event = this.stripe!.webhooks.constructEvent(rawBody, signature, webhookSecret);
    } catch (err: unknown) {
      this.logger.warn(`Stripe webhook signature verification failed: ${err instanceof Error ? err.message : String(err)}`);
      throw new BadRequestException(`Webhook signature verification failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    this.logger.debug(`Stripe webhook received: ${event.type}`);

    const target = await this.bindLegacyStripeEvent(event);
    // Events the door ignores are acknowledged, as before.
    const ack = await this.payments.handleStripeWebhook(rawBody.toString('utf8'), signature);
    // The door answers `processed` only for the first delivery of an event id
    // (its provider-event claim, shared with POST /payments/stripe/webhook).
    if (ack.processed && target?.kind === 'invoice') await this.emitStripePaymentReceived(event, target);
    return { ...ack, type: event.type, ...LEGACY_STRIPE_HINT };
  }

  /**
   * R0-20b: a verified event the door would record as a payment of an invoice
   * or a storefront order must be one KeyFlow's checkout made for it. The id
   * is read exactly as the door reads it.
   *
   * Invoice X (createStripeCheckout): metadata.businessId is X's business and
   * the currency is X's; the amount must be a positive number of minor units.
   * The amount recorded is always the one the event carries (D-05: the
   * remaining-balance rule is operator mark-paid's, never a webhook's), so a
   * session paid after X's total was edited is recorded for what Stripe took
   * (R0-20b review CR-R020B-1), as the door does on its own endpoint.
   *
   * Storefront order O (createStorePayment, review SEC-R020B-1): the door
   * settles O for its whole total, so the session must name O in
   * metadata.orderId and O's business in metadata.businessId and carry exactly
   * O's total in O's currency. A Payment Link session of another business that
   * a payer pointed at O through client_reference_id is refused.
   *
   * Anything else is refused (400) before the door runs, so nothing is
   * written and no dedupe claim is taken; the refusal is kept as one
   * webhook_events row (SEC-R020B-3). An id that is neither is left to the
   * door, which records nothing for it.
   */
  private async bindLegacyStripeEvent(event: Stripe.Event): Promise<LegacyStripeTarget | null> {
    if (!STRIPE_INVOICE_PAYMENT_EVENTS.has(event.type)) return null;
    const obj = (event.data?.object ?? {}) as StripePaymentObject;
    const id = obj.metadata?.invoiceId || obj.client_reference_id || obj.metadata?.invoice_id;
    if (!id) return null;
    const amountMinor = obj.amount_total ?? obj.amount_received ?? obj.amount;
    const positiveAmount = typeof amountMinor === 'number' && Number.isFinite(amountMinor) && amountMinor > 0;
    const currency = normalizeCurrency(obj.currency);

    const invoice = await this.prisma.client.invoice.findUnique({
      where: { id },
      select: { businessId: true, currency: true },
    });
    if (invoice) {
      const target: LegacyStripeTarget = { kind: 'invoice', id, businessId: invoice.businessId };
      const reason =
        obj.metadata?.businessId !== invoice.businessId
          ? 'business'
          : currency === '' || currency !== normalizeCurrency(invoice.currency)
            ? 'currency'
            : !positiveAmount
              ? 'amount'
              : null;
      if (reason) await this.refuseLegacyStripeEvent(event, target, reason);
      return target;
    }

    const order = await this.prisma.client.marketplaceOrder.findUnique({
      where: { id },
      select: { id: true, businessId: true, total: true, currency: true },
    });
    if (!order) return null;
    const target: LegacyStripeTarget = { kind: 'order', id, businessId: order.businessId };
    const reason =
      obj.metadata?.orderId !== order.id
        ? 'order'
        : obj.metadata?.businessId !== order.businessId
          ? 'business'
          : currency === '' || currency !== normalizeCurrency(order.currency)
            ? 'currency'
            : !positiveAmount || amountMinor !== Math.round(Number(order.total) * 100)
              ? 'amount'
              : null;
    if (reason) await this.refuseLegacyStripeEvent(event, target, reason);
    return target;
  }

  /** Keeps the refusal (SEC-R020B-3), then refuses the delivery: 400, nothing recorded. */
  private async refuseLegacyStripeEvent(event: Stripe.Event, target: LegacyStripeTarget, reason: string): Promise<never> {
    this.logger.warn(`Legacy Stripe ${event.type} ${event.id} refused: its ${reason} does not match ${target.kind} ${target.id}`);
    if (event.id) {
      await this.prisma.client.webhookEvent
        .create({
          data: {
            provider: LEGACY_STRIPE_REFUSED_PROVIDER,
            providerEventId: event.id,
            eventType: `${event.type}:${reason}`,
            businessId: target.businessId,
          },
        })
        .catch((e: unknown) => {
          // A retry of an event already kept (unique provider + event id) adds nothing.
          if ((e as { code?: string } | null)?.code !== 'P2002') {
            this.logger.error(`Legacy Stripe refusal of ${event.id} could not be kept: ${e instanceof Error ? e.message : String(e)}`);
          }
        });
    }
    throw new BadRequestException(`Stripe event does not match the ${target.kind}`);
  }

  /**
   * R0-20b review (CR-R020B-2): the Stripe connector's 'payment.received'
   * (the owner's in-app notification, the connector's activity), once, for
   * the payment the door just recorded for the invoice, with the amount and
   * currency it recorded. Never fails the delivery: the payment is committed.
   */
  private async emitStripePaymentReceived(event: Stripe.Event, target: LegacyStripeTarget): Promise<void> {
    if (!this.stripeConnector) return;
    const obj = (event.data?.object ?? {}) as StripePaymentObject;
    // The door's provider payment id for this event (PaymentsService.processStripeChargeOrSession).
    const providerPaymentId = obj.id || event.id;
    if (!providerPaymentId) return;
    try {
      const row = await this.prisma.client.payment.findUnique({
        where: { providerPaymentId },
        select: { invoiceId: true, businessId: true, provider: true, status: true, amount: true, currency: true },
      });
      if (!row || row.provider !== 'stripe' || row.status !== 'SUCCESSFUL' || row.invoiceId !== target.id || row.businessId !== target.businessId) {
        return;
      }
      this.stripeConnector
        .emitPaymentReceived(row.businessId, {
          amount: Number(row.amount),
          currency: row.currency,
          invoiceId: target.id,
          externalId: providerPaymentId,
        })
        .catch((e: unknown) => this.logger.warn(`Stripe connector event emission failed: ${e instanceof Error ? e.message : String(e)}`));
    } catch (e: unknown) {
      this.logger.warn(`Stripe connector event for ${event.id} not emitted: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/webhooks')
  async list(@Param('businessId') businessId: string) {
    return this.prisma.client.webhook.findMany({
      where: { businessId },
      orderBy: { createdAt: 'desc' },
    });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/webhooks')
  async create(
    @Param('businessId') businessId: string,
    @Body() body: { url: string; events: string[]; name?: string },
  ) {
    if (!body.url || !body.url.startsWith('http')) {
      return { error: 'A valid URL starting with http:// or https:// is required' };
    }
    if (!body.events || body.events.length === 0) {
      return { error: 'At least one event must be selected' };
    }
    const secret = randomBytes(32).toString('hex');
    return this.prisma.client.webhook.create({
      data: {
        businessId,
        url: body.url,
        events: body.events,
        name: body.name || 'Webhook',
        secret,
        isActive: true,
      },
    });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Delete('businesses/:businessId/webhooks/:webhookId')
  async remove(
    @Param('businessId') businessId: string,
    @Param('webhookId') webhookId: string,
  ) {
    const deleted = await this.prisma.client.webhook.deleteMany({
      where: { id: webhookId, businessId },
    });
    if (deleted.count === 0) {
      return { error: 'Webhook not found or not owned by this business' };
    }
    return { success: true };
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/webhooks/:webhookId/test')
  async testWebhook(
    @Param('businessId') businessId: string,
    @Param('webhookId') webhookId: string,
  ) {
    const result = await this.dispatcher.sendTestEvent(webhookId, businessId);
    return result;
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/webhooks/:webhookId/deliveries')
  async deliveries(
    @Param('businessId') businessId: string,
    @Param('webhookId') webhookId: string,
    @Query('limit') limit?: string,
  ) {
    const parsedLimit = limit ? Math.min(parseInt(limit, 10) || 50, 100) : 50;
    return this.dispatcher.getDeliveryLogs(businessId, webhookId, parsedLimit);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/webhooks/:webhookId/toggle')
  async toggleWebhook(
    @Param('businessId') businessId: string,
    @Param('webhookId') webhookId: string,
    @Body() body: { isActive: boolean },
  ) {
    const updated = await this.prisma.client.webhook.updateMany({
      where: { id: webhookId, businessId },
      data: { isActive: body.isActive },
    });
    if (updated.count === 0) {
      return { error: 'Webhook not found or not owned by this business' };
    }
    return { success: true, isActive: body.isActive };
  }
}
