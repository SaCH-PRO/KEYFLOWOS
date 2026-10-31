import { Body, Controller, Get, Headers, Inject, Logger, Param, Post, Query, RawBodyRequest, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { PaymentsService } from './payments.service';
import { PublicRateLimitGuard, PublicRateLimit } from '../../core/guards/public-rate-limit.guard';

/**
 * V1-46b-TOKEN-PAY-COMPLETE (M34, review ST-1; D-07, ruled 2026-10-31: token
 * links only). Every payment route the customer pay page (/pay/link/[token])
 * calls is keyed by the pay-link token and resolves the invoice ONLY through
 * an active, unexpired PaymentLink of the invoice's own tenant, so a revoked
 * or expired link stops the status poll, the gateway list, the provider
 * checkouts and the PayPal capture as it stops the pay read and the intent:
 *
 *   GET  public/invoice-link/:token/status                   five keys (20/min)
 *   GET  public/invoice-link/:token/gateways                 the tenant's gateways (20/min)
 *   POST public/invoice-link/:token/checkout                 { gateway: stripe | wipay | paypal, ... } (5/min)
 *   POST public/invoice-link/:token/paypal/capture/:orderId  captured against the token's invoice (5/min)
 *
 * They replace the bare-id per-provider routes (POST invoice/:invoiceId/
 * {stripe, wipay, paypal/create-order} and POST paypal/capture/:orderId with
 * the invoice id in the body), which are retired. The bare-id status, the
 * gateway list and the generic checkout stay (KF-REVENUE-AUTH-PROJECTION-001
 * and release0-journey pin them) and answer an unknown-id 404 once every link
 * of the invoice is revoked or expired. Provider webhooks and the WiPay
 * callback are keyed by the provider's own event and are unchanged. What
 * stands in for a guard on the token routes: the token IS the credential
 * (24 crypto-random bytes, V1-48; every refusal is one 404) plus the rate
 * limit. The public-surface ledger stays at 11: four token routes in, four
 * bare-id routes out.
 */
@Controller('payments')
@UseGuards(PublicRateLimitGuard)
export class PaymentsController {
  private readonly logger = new Logger(PaymentsController.name);

  constructor(
    @Inject(PaymentsService) private readonly payments: PaymentsService,
  ) {}

  // V1-46b: unknown and closed ids answer one 404 (it was a plain Error, 500, for an unknown id).
  @PublicRateLimit(20, 60_000)
  @Get('invoice/:invoiceId/gateways')
  async getGateways(@Param('invoiceId') invoiceId: string) {
    return this.payments.getGatewaysForInvoice(invoiceId);
  }

  @PublicRateLimit(20, 60_000)
  @Get('public/invoice-link/:token/gateways')
  async getGatewaysByToken(@Param('token') token: string) {
    return this.payments.getGatewaysByToken(token);
  }

  @PublicRateLimit(5, 60_000)
  @Post('public/invoice-link/:token/checkout')
  async createCheckoutByToken(
    @Param('token') token: string,
    @Body() body: { gateway: 'stripe' | 'paypal' | 'wipay'; returnUrl?: string; successUrl?: string; cancelUrl?: string },
  ) {
    return this.payments.createCheckoutByToken(token, {
      gateway: body?.gateway,
      returnUrl: body?.returnUrl,
      successUrl: body?.successUrl,
      cancelUrl: body?.cancelUrl,
    });
  }

  @PublicRateLimit(20, 60_000)
  @Get('wipay/callback')
  async handleWipayCallback(@Query() queryParams: Record<string, string>) {
    return this.payments.handleWipayCallback(queryParams);
  }

  @PublicRateLimit(5, 60_000)
  @Post('public/invoice-link/:token/paypal/capture/:orderId')
  async capturePaypalOrderByToken(
    @Param('token') token: string,
    @Param('orderId') orderId: string,
  ) {
    return this.payments.capturePaypalOrderByToken(token, orderId);
  }

  @Get('paypal/setup')
  async getPaypalSetup() {
    return this.payments.getPaypalClientToken();
  }

  // KF-REVENUE-AUTH-PROJECTION-001 (G5): public and previously unthrottled —
  // without a decorator the class-level guard returns true. Now limited like
  // the sibling gateways route, and the service answers with a projection
  // instead of raw Payment rows. V1-46b: closed (404) once every link of the
  // invoice is revoked or expired; the pay page polls the token route below.
  @PublicRateLimit(20, 60_000)
  @Get('invoice/:invoiceId/status')
  async getInvoicePaymentStatus(@Param('invoiceId') invoiceId: string) {
    return this.payments.getInvoicePaymentStatus(invoiceId);
  }

  @PublicRateLimit(20, 60_000)
  @Get('public/invoice-link/:token/status')
  async getPaymentStatusByToken(@Param('token') token: string) {
    return this.payments.getInvoicePaymentStatusByToken(token);
  }

  @PublicRateLimit(5, 60_000)
  @Post('create-checkout')
  async createCheckout(
    @Body()
    body: {
      payableType: 'invoice' | 'storefront_order' | 'event_ticket' | 'mass_comm';
      payableId: string;
      gateway: 'stripe' | 'paypal' | 'wipay';
      returnUrl?: string;
      successUrl?: string;
      cancelUrl?: string;
    },
  ) {
    return this.payments.createGenericCheckout(body);
  }

  @PublicRateLimit(60, 60_000)
  @Post('stripe/webhook')
  async handleStripeWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature?: string,
  ) {
    const raw = req.rawBody?.toString('utf8') || '';
    return this.payments.handleStripeWebhook(raw, signature);
  }

  @PublicRateLimit(60, 60_000)
  @Post('paypal/webhook')
  async handlePaypalWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('paypal-transmission-id') transmissionId?: string,
    @Headers('paypal-transmission-time') transmissionTime?: string,
    @Headers('paypal-transmission-sig') transmissionSig?: string,
    @Headers('paypal-cert-url') certUrl?: string,
    @Headers('paypal-auth-algo') authAlgo?: string,
  ) {
    const raw = req.rawBody?.toString('utf8') || '';
    return this.payments.handlePaypalWebhook(raw, {
      'paypal-transmission-id': transmissionId,
      'paypal-transmission-time': transmissionTime,
      'paypal-transmission-sig': transmissionSig,
      'paypal-cert-url': certUrl,
      'paypal-auth-algo': authAlgo,
    });
  }
}
