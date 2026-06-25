import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Logger,
  Param,
  Post,
  Query,
  RawBodyRequest,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from '../../../core/auth/auth.guard';
import { BusinessGuard } from '../../../core/auth/business.guard';
import { ModuleScopeGuard, RequireModuleScope } from '../../../core/auth/module-scope.guard';
import { PaymentOrchestrator, CheckoutOptions, PaymentFilters, SupportedCurrency } from '../services/payment-orchestrator.service';

/**
 * PaymentController — REST API endpoints for Stripe payment management.
 *
 * Provides:
 *  - Checkout session creation for invoices (with optional payment plans)
 *  - Payment status lookup
 *  - Refund processing
 *  - Payment listing with filters
 *  - Stripe webhook handler (also available via /webhooks/stripe)
 */
@Controller('finance/payments')
export class PaymentController {
  private readonly logger = new Logger(PaymentController.name);

  constructor(
    @Inject(PaymentOrchestrator) private readonly orchestrator: PaymentOrchestrator,
  ) {}

  // ──────────────────────────────────────────────────────────────────────────
  // Public endpoint: Create a Stripe Checkout Session for an invoice
  // ──────────────────────────────────────────────────────────────────────────

  @Post('checkout')
  @HttpCode(200)
  async createCheckout(@Body() body: {
    invoiceId: string;
    customerEmail: string;
    amount: number;
    currency: string;
    description: string;
    successUrl?: string;
    cancelUrl?: string;
    metadata?: Record<string, string>;
    businessId: string;
    paymentPlan?: {
      enabled: boolean;
      installments: number;
      interval: 'weekly' | 'monthly';
    };
  }): Promise<{ success: boolean; paymentId?: string; checkoutUrl?: string; error?: string }> {
    const currency = this.validateCurrency(body.currency);
    const options: CheckoutOptions = {
      invoiceId: body.invoiceId,
      customerEmail: body.customerEmail,
      amount: body.amount,
      currency,
      description: body.description,
      successUrl: body.successUrl,
      cancelUrl: body.cancelUrl,
      metadata: body.metadata,
      businessId: body.businessId,
      paymentPlan: body.paymentPlan,
    };
    return this.orchestrator.createCheckoutSession(options);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Payment status
  // ──────────────────────────────────────────────────────────────────────────

  @Get(':id/status')
  async getPaymentStatus(@Param('id') paymentId: string) {
    return this.orchestrator.getPaymentStatus(paymentId);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Refund
  // ──────────────────────────────────────────────────────────────────────────

  @Post(':id/refund')
  @HttpCode(200)
  async refundPayment(
    @Param('id') paymentId: string,
    @Body() body: { amount?: number },
  ): Promise<{ success: boolean; paymentId?: string; error?: string }> {
    return this.orchestrator.refund(paymentId, body.amount);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // List payments (scoped to business)
  // ──────────────────────────────────────────────────────────────────────────

  @Get('businesses/:businessId')
  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('revenue', 'read')
  async listPayments(
    @Param('businessId') businessId: string,
    @Query('status') status?: string,
    @Query('currency') currency?: string,
    @Query('invoiceId') invoiceId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const filters: PaymentFilters = {};
    if (status) filters.status = status;
    if (currency) filters.currency = currency;
    if (invoiceId) filters.invoiceId = invoiceId;
    if (startDate) filters.startDate = new Date(startDate);
    if (endDate) filters.endDate = new Date(endDate);
    if (limit) filters.limit = parseInt(limit, 10);
    if (offset) filters.offset = parseInt(offset, 10);

    return this.orchestrator.listPayments(businessId, filters);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Sync payment with Stripe
  // ──────────────────────────────────────────────────────────────────────────

  @Post(':id/sync')
  @HttpCode(200)
  async syncPayment(@Param('id') paymentId: string): Promise<{ success: boolean }> {
    await this.orchestrator.syncWithStripe(paymentId);
    return { success: true };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Stripe webhook handler (alternate path for /webhooks/stripe)
  // ──────────────────────────────────────────────────────────────────────────

  @Post('stripe/webhook')
  @HttpCode(200)
  async handleStripeWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string | undefined,
  ): Promise<{ received: boolean }> {
    const raw = req.rawBody?.toString('utf8') || '';

    if (!raw || !signature) {
      throw new BadRequestException('Missing webhook body or signature');
    }

    await this.orchestrator.processWebhook(raw, signature);
    return { received: true };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────────────────────────────────

  private validateCurrency(currency: string): SupportedCurrency {
    const normalized = currency.toLowerCase() as SupportedCurrency;
    if (!['ttd', 'usd', 'cad'].includes(normalized)) {
      throw new BadRequestException(`Unsupported currency: ${currency}. Supported: TTD, USD, CAD`);
    }
    return normalized;
  }
}
