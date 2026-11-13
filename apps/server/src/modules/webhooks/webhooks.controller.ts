import { Body, Controller, Delete, Get, Headers, Inject, Param, Post, Query, Req, UseGuards, Optional, Logger, BadRequestException } from '@nestjs/common';
import { Request } from 'express';
import Stripe from 'stripe';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { ModuleScopeGuard, RequireModuleScope } from '../../core/auth/module-scope.guard';
import { StripeConnector } from '../../core/connectors/implementations/stripe.connector';
import { PaymentsService, STRIPE_LEGACY_REFUSED_PROVIDER } from '../payments/payments.service';
import { WebhookDispatcherService } from './webhook-dispatcher.service';
import { randomBytes } from 'crypto';
import { checkWebhookUrl, WebhookUrlRefusedError } from './webhook-url';

/**
 * SWEEP-P0-SCOPES (BUG-001): the webhook fields a read answers. The signing secret is not one: it
 * is answered once, in the create answer, and never read back.
 */
const WEBHOOK_PUBLIC_FIELDS = {
  id: true,
  businessId: true,
  name: true,
  url: true,
  events: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** Every answer of the deprecated Stripe route names its replacement. */
const LEGACY_STRIPE_HINT = { deprecated: true, use: '/payments/stripe/webhook' } as const;

/**
 * The payment event types for which this route emits the Stripe connector's
 * 'payment.received' once the door has recorded them for an invoice (R0-20b
 * review CR-R020B-2). They are not a binding: the door binds every payment
 * event it is handed (R0-20d).
 */
const STRIPE_INVOICE_PAYMENT_EVENTS = new Set(['checkout.session.completed', 'charge.succeeded', 'payment_intent.succeeded']);

/** The fields of a Stripe session, charge or payment intent the connector event reads. */
type StripePaymentObject = {
  id?: string | null;
  metadata?: Record<string, string> | null;
  client_reference_id?: string | null;
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
    // after the signature check below, the verified bytes go to the same
    // Stripe ledger door POST /payments/stripe/webhook runs
    // (PaymentsService.handleStripeWebhook: the binding of a payment event to
    // the invoice or storefront order it names, provider-event dedupe, one
    // SUCCESSFUL provider 'stripe' payment posted with it, the reconcile). An
    // event the binding accepts is recorded once, whether it reaches this
    // endpoint, the door's own endpoint or both; one it refuses is recorded by
    // neither. R0-20d (W3-STRIPE-LEGACY-BINDING): the door's binding
    // (bindStripePaymentEvent, R0-20c) is this route's only one; the copy this
    // controller kept (bindLegacyStripeEvent) is gone. A refusal is still kept
    // under this route's label, stripe-legacy-refused (R0-20b review
    // SEC-R020B-3), which the route hands the door. The route used to call
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

    // Events the door ignores are acknowledged, as before; one its binding
    // refuses is a 400 (BadRequestException), with nothing recorded.
    const ack = await this.payments.handleStripeWebhook(rawBody.toString('utf8'), signature, {
      refusedProvider: STRIPE_LEGACY_REFUSED_PROVIDER,
    });
    // The door answers `processed` only for the first delivery of an event id
    // (its provider-event claim, shared with POST /payments/stripe/webhook).
    if (ack.processed && STRIPE_INVOICE_PAYMENT_EVENTS.has(event.type)) await this.emitStripePaymentReceived(event);
    return { ...ack, type: event.type, ...LEGACY_STRIPE_HINT };
  }

  /**
   * R0-20b review (CR-R020B-2): the Stripe connector's 'payment.received'
   * (the owner's in-app notification, the connector's activity), once, for
   * the payment the door just recorded for the invoice, with the amount and
   * currency it recorded. Never fails the delivery: the payment is committed.
   *
   * R0-20d: the invoice is the one the event names, read exactly as the door
   * reads it, and the recorded row must be that invoice's, in the business the
   * event names: the door's binding accepted the event only if that is the
   * invoice's business (a delivery of this route is platform-signed). A
   * storefront order's payment records no invoice row, so it emits nothing.
   */
  private async emitStripePaymentReceived(event: Stripe.Event): Promise<void> {
    if (!this.stripeConnector) return;
    const obj = (event.data?.object ?? {}) as StripePaymentObject;
    const invoiceId = obj.metadata?.invoiceId || obj.client_reference_id || obj.metadata?.invoice_id;
    // The door's provider payment id for this event (PaymentsService.processStripeChargeOrSession).
    const providerPaymentId = obj.id || event.id;
    if (!invoiceId || !providerPaymentId) return;
    try {
      const row = await this.prisma.client.payment.findUnique({
        where: { providerPaymentId },
        select: { invoiceId: true, businessId: true, provider: true, status: true, amount: true, currency: true },
      });
      if (
        !row ||
        row.provider !== 'stripe' ||
        row.status !== 'SUCCESSFUL' ||
        row.invoiceId !== invoiceId ||
        row.businessId !== obj.metadata?.businessId
      ) {
        return;
      }
      this.stripeConnector
        .emitPaymentReceived(row.businessId, {
          amount: Number(row.amount),
          currency: row.currency,
          invoiceId,
          externalId: providerPaymentId,
        })
        .catch((e: unknown) => this.logger.warn(`Stripe connector event emission failed: ${e instanceof Error ? e.message : String(e)}`));
    } catch (e: unknown) {
      this.logger.warn(`Stripe connector event for ${event.id} not emitted: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /**
   * SWEEP-P0-SCOPES (browser sweep BUG-001, blocker): webhook configuration is settings territory.
   * Every business route here ran AuthGuard and BusinessGuard only, so a STAFF member whose scope
   * map said settings 'none' listed every webhook WITH its signing secret and registered a webhook
   * sending invoice events to any URL. Now each route runs ModuleScopeGuard after BusinessGuard and
   * names the settings module on its handler (the guard reads handler metadata only): read to list
   * webhooks and read their delivery log, write to create, delete, enable/disable or test one. OWNER
   * and ADMIN hold settings admin by role default, STAFF none; an explicit map binds every role
   * (D-114, D-140).
   *
   * A signing secret is answered once, in the create answer, to the member who created the webhook;
   * no read answers it again, to anyone (WEBHOOK_PUBLIC_FIELDS). Before, every list answered every
   * secret to every reader, so the safer rule is kept.
   */
  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('settings', 'read')
  @Get('businesses/:businessId/webhooks')
  async list(@Param('businessId') businessId: string) {
    return this.prisma.client.webhook.findMany({
      where: { businessId },
      orderBy: { createdAt: 'desc' },
      select: WEBHOOK_PUBLIC_FIELDS,
    });
  }

  /**
   * SWEEP-P0-SCOPES (BUG-001): settings write; the URL goes through the outbound-address guard
   * (checkWebhookUrl: http(s) to a public address only), and a refused URL or an empty event list
   * is a 400 with nothing written (it was a 201 carrying an `error`). The answer is the only one
   * that carries the new webhook's signing secret.
   */
  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('settings', 'write')
  @Post('businesses/:businessId/webhooks')
  async create(
    @Param('businessId') businessId: string,
    @Body() body: { url: string; events: string[]; name?: string },
  ) {
    let checkedUrl: string;
    try {
      checkedUrl = (await checkWebhookUrl(body?.url)).url.toString();
    } catch (err) {
      if (err instanceof WebhookUrlRefusedError) throw new BadRequestException(err.message);
      throw err;
    }
    const events = Array.isArray(body?.events) ? body.events.filter((e): e is string => typeof e === 'string' && e.trim() !== '') : [];
    if (events.length === 0) {
      throw new BadRequestException('At least one event must be selected');
    }
    const secret = randomBytes(32).toString('hex');
    return this.prisma.client.webhook.create({
      data: {
        businessId,
        url: checkedUrl,
        events,
        name: typeof body?.name === 'string' && body.name.trim() ? body.name : 'Webhook',
        secret,
        isActive: true,
      },
    });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('settings', 'write')
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

  /** SWEEP-P0-SCOPES (BUG-001): settings write; the delivery is checked and pinned like every other (WebhookDispatcherService). */
  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('settings', 'write')
  @Post('businesses/:businessId/webhooks/:webhookId/test')
  async testWebhook(
    @Param('businessId') businessId: string,
    @Param('webhookId') webhookId: string,
  ) {
    const result = await this.dispatcher.sendTestEvent(webhookId, businessId);
    return result;
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('settings', 'read')
  @Get('businesses/:businessId/webhooks/:webhookId/deliveries')
  async deliveries(
    @Param('businessId') businessId: string,
    @Param('webhookId') webhookId: string,
    @Query('limit') limit?: string,
  ) {
    const parsedLimit = limit ? Math.min(parseInt(limit, 10) || 50, 100) : 50;
    return this.dispatcher.getDeliveryLogs(businessId, webhookId, parsedLimit);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('settings', 'write')
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
