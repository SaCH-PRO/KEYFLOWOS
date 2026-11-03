import { Body, Controller, Delete, Get, Headers, Inject, Param, Post, Query, Req, UseGuards, Logger, BadRequestException } from '@nestjs/common';
import { Request } from 'express';
import Stripe from 'stripe';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { PaymentsService } from '../payments/payments.service';
import { WebhookDispatcherService } from './webhook-dispatcher.service';
import { randomBytes } from 'crypto';

/** Every answer of the deprecated Stripe route names its replacement. */
const LEGACY_STRIPE_HINT = { deprecated: true, use: '/payments/stripe/webhook' } as const;

/** The event types the Stripe ledger door records as an invoice payment (PaymentsService.handleStripeWebhook). */
const STRIPE_INVOICE_PAYMENT_EVENTS = new Set(['checkout.session.completed', 'charge.succeeded', 'payment_intent.succeeded']);

@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);
  private readonly stripe: Stripe | null = null;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PaymentsService) private readonly payments: PaymentsService,
    @Inject(WebhookDispatcherService) private readonly dispatcher: WebhookDispatcherService,
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
    // (PaymentsService.handleStripeWebhook: provider-event dedupe, one
    // SUCCESSFUL provider 'stripe' payment posted with it, the reconcile), so a
    // delivery to either endpoint, or to both, is recorded once. It used to
    // call CommerceService.markInvoicePaid(invoiceId) with no actor and no
    // tenant, which recorded a 'manual' receipt for the remaining balance
    // (posted Dr CASH), checked nothing the session carried, and deduped only
    // by the invoice already being PAID.
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

    await this.assertBoundToInvoice(event);
    // Events the door ignores are acknowledged, as before.
    const ack = await this.payments.handleStripeWebhook(rawBody.toString('utf8'), signature);
    return { ...ack, type: event.type, ...LEGACY_STRIPE_HINT };
  }

  /**
   * R0-20b: a verified event the door would record as a payment of invoice X
   * must be the payment KeyFlow's checkout asked for (createStripeCheckout):
   * it names X's own business in metadata.businessId, and carries X's
   * currency and an amount equal to X's total in minor units. Anything else is
   * refused before the door runs, so nothing is written and no dedupe claim is
   * taken. The amount recorded is always the one the event carries (D-05: the
   * remaining-balance rule is operator mark-paid's, never a webhook's). The
   * invoice id is read exactly as the door reads it; an id that is not an
   * invoice (a storefront order) is left to the door.
   */
  private async assertBoundToInvoice(event: Stripe.Event): Promise<void> {
    if (!STRIPE_INVOICE_PAYMENT_EVENTS.has(event.type)) return;
    const obj = (event.data?.object ?? {}) as {
      metadata?: Record<string, string> | null;
      client_reference_id?: string | null;
      amount_total?: number | null;
      amount_received?: number | null;
      amount?: number | null;
      currency?: string | null;
    };
    const invoiceId = obj.metadata?.invoiceId || obj.client_reference_id || obj.metadata?.invoice_id;
    if (!invoiceId) return;
    const invoice = await this.prisma.client.invoice.findUnique({
      where: { id: invoiceId },
      select: { businessId: true, total: true, currency: true },
    });
    if (!invoice) return;

    const amountMinor = obj.amount_total ?? obj.amount_received ?? obj.amount;
    const reason =
      obj.metadata?.businessId !== invoice.businessId
        ? 'business'
        : typeof obj.currency !== 'string' || obj.currency.toUpperCase() !== invoice.currency.toUpperCase()
          ? 'currency'
          : typeof amountMinor !== 'number' || amountMinor <= 0 || amountMinor !== Math.round(Number(invoice.total) * 100)
            ? 'amount'
            : null;
    if (reason) {
      this.logger.warn(`Legacy Stripe ${event.type} ${event.id} refused: its ${reason} does not match invoice ${invoiceId}`);
      throw new BadRequestException('Stripe event does not match the invoice');
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
