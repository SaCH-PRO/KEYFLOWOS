import { Body, Controller, Get, Headers, Inject, Logger, Param, Post, Query, RawBodyRequest, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { PaymentsService } from './payments.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { PublicRateLimitGuard, PublicRateLimit } from '../../core/guards/public-rate-limit.guard';

@Controller('payments')
@UseGuards(PublicRateLimitGuard)
export class PaymentsController {
  private readonly logger = new Logger(PaymentsController.name);

  constructor(
    @Inject(PaymentsService) private readonly payments: PaymentsService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  @PublicRateLimit(20, 60_000)
  @Get('invoice/:invoiceId/gateways')
  async getGateways(@Param('invoiceId') invoiceId: string) {
    const invoice = await this.prisma.client.invoice.findUnique({
      where: { id: invoiceId },
      select: { businessId: true },
    });
    if (!invoice) throw new Error('Invoice not found');
    return this.payments.getAvailableGateways(invoice.businessId);
  }

  @PublicRateLimit(5, 60_000)
  @Post('invoice/:invoiceId/wipay')
  async createWipayCheckout(
    @Param('invoiceId') invoiceId: string,
    @Body() body: { returnUrl: string },
  ) {
    return this.payments.createWipayCheckout(invoiceId, body.returnUrl);
  }

  @PublicRateLimit(20, 60_000)
  @Get('wipay/callback')
  async handleWipayCallback(@Query() queryParams: Record<string, string>) {
    return this.payments.handleWipayCallback(queryParams);
  }

  @PublicRateLimit(5, 60_000)
  @Post('invoice/:invoiceId/paypal/create-order')
  async createPaypalOrder(@Param('invoiceId') invoiceId: string) {
    return this.payments.createPaypalOrder(invoiceId);
  }

  @PublicRateLimit(5, 60_000)
  @Post('paypal/capture/:orderId')
  async capturePaypalOrder(
    @Param('orderId') orderId: string,
    @Body() body: { invoiceId: string },
  ) {
    return this.payments.capturePaypalOrder(orderId, body.invoiceId);
  }

  @Get('paypal/setup')
  async getPaypalSetup() {
    return this.payments.getPaypalClientToken();
  }

  @Get('invoice/:invoiceId/status')
  async getInvoicePaymentStatus(@Param('invoiceId') invoiceId: string) {
    return this.payments.getInvoicePaymentStatus(invoiceId);
  }

  @PublicRateLimit(5, 60_000)
  @Post('invoice/:invoiceId/stripe')
  async createStripeCheckout(
    @Param('invoiceId') invoiceId: string,
    @Body() body: { successUrl: string; cancelUrl: string },
  ) {
    return this.payments.createStripeCheckout(invoiceId, body.successUrl, body.cancelUrl);
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
}
