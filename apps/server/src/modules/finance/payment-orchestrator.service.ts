import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { createHmac, timingSafeEqual } from 'crypto';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { InvoiceWorkflowService } from '../../commerce/invoice-workflow.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

/**
 * Supported currencies for Stripe Checkout.
 * TTD = Trinidad & Tobago Dollar (local primary)
 * USD = US Dollar (global default)
 * CAD = Canadian Dollar (North American)
 *
 * Note: Stripe does not natively support TTD for Checkout. When TTD is
 * requested, we convert to USD at a fixed approximate rate (0.147 USD/TTD)
 * and pass USD to Stripe. This is handled transparently in the orchestrator.
 */
export type SupportedCurrency = 'ttd' | 'usd' | 'cad';

const STRIPE_CURRENCY_MAP: Record<SupportedCurrency, { code: string; stripeCode: string; multiplier: number }> = {
  ttd: { code: 'TTD', stripeCode: 'usd', multiplier: 0.147 },
  usd: { code: 'USD', stripeCode: 'usd', multiplier: 1 },
  cad: { code: 'CAD', stripeCode: 'cad', multiplier: 1 },
};

/** Approximate TTD->USD conversion for Stripe Checkout (TTD not natively supported) */
export function convertToStripeCurrency(amount: number, currency: SupportedCurrency): { amount: number; currency: string } {
  const config = STRIPE_CURRENCY_MAP[currency];
  return {
    amount: Math.round(amount * config.multiplier),
    currency: config.stripeCode,
  };
}

export interface CheckoutOptions {
  invoiceId: string;
  customerEmail: string;
  amount: number; // in cents/smallest currency unit
  currency: SupportedCurrency;
  description: string;
  successUrl?: string;
  cancelUrl?: string;
  metadata?: Record<string, string>;
  businessId: string;
  /** Payment plan options for installment billing via Stripe Subscription */
  paymentPlan?: {
    enabled: boolean;
    installments: number;
    interval: 'weekly' | 'monthly';
  };
}

export interface PaymentResult {
  success: boolean;
  paymentId?: string;
  checkoutUrl?: string;
  error?: string;
}

export interface PaymentStatus {
  id: string;
  status: string;
  amount: number;
  currency: string;
  provider: string;
  providerPaymentId: string;
  invoiceId: string;
  businessId: string;
  createdAt: Date;
  succeededAt: Date | null;
  failedAt: Date | null;
  refundedAt: Date | null;
  refundAmount: number | null;
  failReason: string | null;
}

export interface PaymentFilters {
  status?: string;
  currency?: string;
  invoiceId?: string;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}

/** Stripe Checkout Session response shape */
interface StripeCheckoutSession {
  id: string;
  url: string;
  status: string;
  payment_intent?: string | null;
  customer?: string | null;
  subscription?: string | null;
  amount_total?: number;
  currency?: string;
  metadata?: Record<string, string>;
  client_reference_id?: string;
}

/** Stripe PaymentIntent shape */
interface StripePaymentIntent {
  id: string;
  status: string;
  amount: number;
  currency: string;
  last_payment_error?: { message?: string; code?: string; decline_code?: string } | null;
  charges?: { data: Array<{ id: string; amount: number; refunded: boolean; amount_refunded: number; refunds?: { data: Array<{ id: string; amount: number; status: string }> } }> };
}

/** Stripe Subscription shape */
interface StripeSubscription {
  id: string;
  status: string;
  current_period_start: number;
  current_period_end: number;
  items: { data: Array<{ id: string; price: { id: string; unit_amount: number } }> };
}

/** Stripe Event shape */
interface StripeEvent {
  id: string;
  type: string;
  data: { object: unknown };
}

/** Stripe Refund shape */
interface StripeRefund {
  id: string;
  status: string;
  amount: number;
  currency: string;
  charge: string;
  payment_intent?: string | null;
}

/**
 * PaymentOrchestrator — Central Stripe payment collection engine.
 *
 * Handles the full lifecycle of Stripe payments:
 *  - Checkout Session creation for invoices
 *  - Webhook processing with signature verification and idempotency
 *  - Payment success/failure handling
 *  - Refund processing
 *  - Payment status queries and listing
 *  - Stripe state synchronization
 *  - Multi-currency support (TTD via USD conversion, USD, CAD)
 *  - Payment plans via Stripe Subscription with phased billing
 */
@Injectable()
export class PaymentOrchestrator {
  private readonly logger = new Logger(PaymentOrchestrator.name);

  constructor(
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(InvoiceWorkflowService) private readonly invoiceWorkflow: InvoiceWorkflowService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
  ) {}

  // ──────────────────────────────────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────────────────────────────────

  /** Resolve the Stripe secret key: prefer per-business override, fall back to env. */
  private async getSecretKey(businessId: string): Promise<string> {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { metaData: true },
    });
    const meta = (business?.metaData as Record<string, unknown>) ?? {};
    const key = (meta.stripeSecretKey as string | undefined) || this.config.get<string>('STRIPE_SECRET_KEY') || process.env.STRIPE_SECRET_KEY;
    if (!key) throw new BadRequestException('Stripe is not configured for this business');
    return key;
  }

  /** Make an authenticated request to the Stripe REST API. */
  private async stripeRequest(
    key: string,
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: URLSearchParams,
  ): Promise<unknown> {
    const url = `https://api.stripe.com/v1${path}`;
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      },
      body: body?.toString(),
    });
    const text = await res.text();
    let parsed: unknown;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
    if (!res.ok) {
      const msg = (parsed as { error?: { message?: string } } | null)?.error?.message || text || `HTTP ${res.status}`;
      throw new Error(`Stripe API error: ${msg}`);
    }
    return parsed;
  }

  /**
   * Verify Stripe webhook signature using the official scheme.
   * Format: t=<timestamp>,v1=<signature>
   */
  verifyStripeSignature(rawPayload: string, signatureHeader: string, secret: string): boolean {
    if (!signatureHeader || !secret) return false;
    const parts = signatureHeader.split(',').reduce<Record<string, string>>((acc, part) => {
      const [k, v] = part.split('=');
      if (k && v) acc[k.trim()] = (acc[k.trim()] ? acc[k.trim()] + ',' : '') + v.trim();
      return acc;
    }, {});
    const timestamp = parts.t;
    const provided = parts.v1;
    if (!timestamp || !provided) return false;

    // Timing-safe signature comparison
    const expected = createHmac('sha256', secret)
      .update(`${timestamp}.${rawPayload}`)
      .digest('hex');

    const expectedBuf = Buffer.from(expected, 'utf8');
    const candidates = provided.split(',').map((s) => Buffer.from(s, 'utf8'));
    return candidates.some(
      (c) => c.length === expectedBuf.length && timingSafeEqual(c, expectedBuf),
    );
  }

  /** Canonical helper to assert that an invoice is in a payable state. */
  private assertInvoicePayable(invoiceStatus: string, invoiceId: string): void {
    const allowed = new Set(['SENT', 'OVERDUE', 'PARTIALLY_PAID', 'PENDING']);
    if (allowed.has(invoiceStatus)) return;
    if (invoiceStatus === 'PAID') throw new BadRequestException('Invoice is already paid');
    if (invoiceStatus === 'VOID') throw new BadRequestException('Invoice is void');
    if (invoiceStatus === 'DRAFT') {
      throw new BadRequestException(
        `Invoice ${invoiceId} is still a draft — send it before collecting payment`,
      );
    }
    throw new BadRequestException(`Invoice ${invoiceId} is not in a payable state (${invoiceStatus})`);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 1. createCheckoutSession — Create a Stripe Checkout Session for an invoice
  // ──────────────────────────────────────────────────────────────────────────

  async createCheckoutSession(options: CheckoutOptions): Promise<PaymentResult> {
    const {
      invoiceId,
      customerEmail,
      amount,
      currency,
      description,
      successUrl,
      cancelUrl,
      metadata = {},
      businessId,
      paymentPlan,
    } = options;

    // 1a. Validate invoice exists and is payable
    const invoice = await this.prisma.client.invoice.findUnique({
      where: { id: invoiceId },
      include: { business: { select: { id: true, name: true, metaData: true } } },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    this.assertInvoicePayable(invoice.status, invoiceId);

    // 1b. Resolve Stripe key
    const secretKey = await this.getSecretKey(businessId);

    // 1c. Currency conversion for Stripe (TTD -> USD)
    const { amount: stripeAmount, currency: stripeCurrency } = convertToStripeCurrency(amount, currency);

    // 1d. Determine mode: subscription for payment plans, payment for one-time
    const mode = paymentPlan?.enabled ? 'subscription' : 'payment';

    // 1e. Build success/cancel URLs
    const finalSuccessUrl = successUrl || this.config.get('STRIPE_SUCCESS_URL') || `${this.config.get('APP_URL') || process.env.APP_URL}/payment/success`;
    const finalCancelUrl = cancelUrl || this.config.get('STRIPE_CANCEL_URL') || `${this.config.get('APP_URL') || process.env.APP_URL}/payment/cancel`;

    // 1f. Create Payment record first (status: PENDING)
    const paymentRecord = await this.prisma.client.payment.create({
      data: {
        businessId,
        invoiceId,
        amount: amount / 100, // Convert cents to dollars
        currency: currency.toUpperCase(),
        status: 'PENDING',
        provider: 'stripe',
        method: paymentPlan?.enabled ? 'subscription' : 'card',
        providerPaymentId: `pending_${invoiceId}_${Date.now()}`, // Temporary; updated after session creation
        reference: null,
        notes: description,
      },
    });

    try {
      let session: StripeCheckoutSession;

      if (mode === 'subscription' && paymentPlan?.enabled) {
        // ── Payment Plan: Stripe Subscription with phased billing ──
        session = await this.createSubscriptionCheckout(
          secretKey,
          stripeAmount,
          stripeCurrency,
          description,
          customerEmail,
          finalSuccessUrl,
          finalCancelUrl,
          invoiceId,
          businessId,
          metadata,
          paymentPlan.installments,
          paymentPlan.interval,
        );
      } else {
        // ── Standard one-time payment ──
        session = await this.createOneTimeCheckout(
          secretKey,
          stripeAmount,
          stripeCurrency,
          description,
          customerEmail,
          finalSuccessUrl,
          finalCancelUrl,
          invoiceId,
          businessId,
          metadata,
        );
      }

      // Update Payment record with the real Stripe session ID
      await this.prisma.client.payment.update({
        where: { id: paymentRecord.id },
        data: {
          providerPaymentId: session.id,
          reference: session.payment_intent || session.subscription || null,
        },
      });

      this.logger.log(`Stripe Checkout Session created: ${session.id} for invoice ${invoiceId} (${mode} mode)`);

      return {
        success: true,
        paymentId: paymentRecord.id,
        checkoutUrl: session.url,
      };
    } catch (error) {
      // Mark payment as failed
      const errMsg = error instanceof Error ? error.message : String(error);
      await this.prisma.client.payment.update({
        where: { id: paymentRecord.id },
        data: {
          status: 'FAILED',
          notes: `Checkout creation failed: ${errMsg}`,
        },
      });
      this.logger.error(`Failed to create Stripe checkout for invoice ${invoiceId}: ${errMsg}`);
      return { success: false, error: errMsg };
    }
  }

  private async createOneTimeCheckout(
    secretKey: string,
    amount: number,
    currency: string,
    description: string,
    customerEmail: string,
    successUrl: string,
    cancelUrl: string,
    invoiceId: string,
    businessId: string,
    metadata: Record<string, string>,
  ): Promise<StripeCheckoutSession> {
    const body = new URLSearchParams();
    body.append('mode', 'payment');
    body.append('success_url', successUrl);
    body.append('cancel_url', cancelUrl);
    body.append('client_reference_id', invoiceId);
    body.append('metadata[invoiceId]', invoiceId);
    body.append('metadata[businessId]', businessId);
    body.append('metadata[paymentOrchestrator]', 'true');
    if (customerEmail) body.append('customer_email', customerEmail);
    body.append('line_items[0][quantity]', '1');
    body.append('line_items[0][price_data][currency]', currency);
    body.append('line_items[0][price_data][unit_amount]', String(amount));
    body.append('line_items[0][price_data][product_data][name]', description.slice(0, 250));

    // Forward caller metadata
    for (const [k, v] of Object.entries(metadata)) {
      if (k && v !== undefined) body.append(`metadata[${k}]`, String(v).slice(0, 500));
    }

    return this.stripeRequest(secretKey, 'POST', '/checkout/sessions', body) as Promise<StripeCheckoutSession>;
  }

  private async createSubscriptionCheckout(
    secretKey: string,
    amount: number,
    currency: string,
    description: string,
    customerEmail: string,
    successUrl: string,
    cancelUrl: string,
    invoiceId: string,
    businessId: string,
    metadata: Record<string, string>,
    installments: number,
    interval: 'weekly' | 'monthly',
  ): Promise<StripeCheckoutSession> {
    // 1. Create a product for the installment plan
    const productBody = new URLSearchParams();
    productBody.append('name', `${description} (Installment Plan)`);
    productBody.append('metadata[invoiceId]', invoiceId);
    const product = (await this.stripeRequest(secretKey, 'POST', '/products', productBody)) as { id: string };

    // 2. Create a recurring price for the installment plan
    // Divide total by number of installments
    const installmentAmount = Math.round(amount / installments);
    const priceBody = new URLSearchParams();
    priceBody.append('product', product.id);
    priceBody.append('currency', currency);
    priceBody.append('unit_amount', String(installmentAmount));
    priceBody.append('recurring[interval]', interval === 'weekly' ? 'week' : 'month');
    // Set the number of billing periods
    const intervalCount = interval === 'weekly' ? installments : installments;
    if (intervalCount > 1) {
      priceBody.append('recurring[interval_count]', '1');
    }
    const price = (await this.stripeRequest(secretKey, 'POST', '/prices', priceBody)) as { id: string };

    // 3. Create the checkout session in subscription mode
    const body = new URLSearchParams();
    body.append('mode', 'subscription');
    body.append('success_url', successUrl);
    body.append('cancel_url', cancelUrl);
    body.append('client_reference_id', invoiceId);
    body.append('metadata[invoiceId]', invoiceId);
    body.append('metadata[businessId]', businessId);
    body.append('metadata[paymentOrchestrator]', 'true');
    body.append('metadata[paymentPlan]', 'true');
    body.append('metadata[installments]', String(installments));
    if (customerEmail) body.append('customer_email', customerEmail);
    body.append('line_items[0][price]', price.id);
    body.append('line_items[0][quantity]', '1');

    // Forward caller metadata
    for (const [k, v] of Object.entries(metadata)) {
      if (k && v !== undefined) body.append(`metadata[${k}]`, String(v).slice(0, 500));
    }

    // Set subscription metadata for cancellation after N payments
    body.append('subscription_data[metadata[invoiceId]]', invoiceId);
    body.append('subscription_data[metadata[installments]]', String(installments));

    const session = await this.stripeRequest(secretKey, 'POST', '/checkout/sessions', body) as StripeCheckoutSession;

    this.logger.log(
      `Created subscription checkout ${session.id} for invoice ${invoiceId}: ` +
      `${installments} ${interval} payments of ${(installmentAmount / 100).toFixed(2)} ${currency.toUpperCase()}`,
    );

    return session;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 2. processWebhook — Main webhook entry point with signature verification
  // ──────────────────────────────────────────────────────────────────────────

  async processWebhook(rawPayload: string, signatureHeader: string): Promise<void> {
    if (!rawPayload) throw new BadRequestException('Missing Stripe webhook payload');

    let event: StripeEvent;
    try {
      event = JSON.parse(rawPayload) as StripeEvent;
    } catch {
      throw new BadRequestException('Invalid Stripe webhook payload');
    }

    const eventType = event.type || '';
    const obj = event.data?.object as Record<string, unknown> || {};

    // 2a. Verify signature: prefer env secret; fall back to per-business secret
    const envSecret = this.config.get<string>('STRIPE_WEBHOOK_SECRET') || process.env.STRIPE_WEBHOOK_SECRET;
    const candidateInvoiceId = this.extractInvoiceId(obj);

    let signatureOk = false;
    if (envSecret && signatureHeader && this.verifyStripeSignature(rawPayload, signatureHeader, envSecret)) {
      signatureOk = true;
    } else if (candidateInvoiceId) {
      const inv = await this.prisma.client.invoice.findUnique({
        where: { id: candidateInvoiceId },
        include: { business: { select: { metaData: true } } },
      }).catch(() => null);
      const businessSecret = (inv?.business?.metaData as Record<string, unknown> | null)?.stripeWebhookSecret as string | undefined;
      if (businessSecret && signatureHeader && this.verifyStripeSignature(rawPayload, signatureHeader, businessSecret)) {
        signatureOk = true;
      }
    }

    if (!signatureOk) {
      this.logger.warn(`Stripe webhook signature verification failed (event=${eventType})`);
      throw new BadRequestException('Invalid Stripe webhook signature');
    }

    // 2b. Idempotency: check WebhookEvent table
    const fresh = await this.assertNewProviderEvent('stripe', event.id, eventType);
    if (!fresh) {
      this.logger.debug(`Stripe event ${event.id} (${eventType}) already processed; skipping`);
      return;
    }

    // 2c. Dispatch by event type
    this.logger.log(`Processing Stripe webhook: ${eventType} (event=${event.id})`);

    switch (eventType) {
      case 'checkout.session.completed':
        await this.handleCheckoutSessionCompleted(obj as StripeCheckoutSession);
        break;
      case 'checkout.session.expired':
        await this.handleCheckoutSessionExpired(obj as StripeCheckoutSession);
        break;
      case 'payment_intent.payment_failed':
        await this.handlePaymentIntentFailed(obj as StripePaymentIntent);
        break;
      case 'payment_intent.succeeded':
        await this.handlePaymentIntentSucceeded(obj as StripePaymentIntent);
        break;
      case 'charge.succeeded':
        await this.handleChargeSucceeded(obj as Record<string, unknown>);
        break;
      case 'charge.refunded':
        await this.handleChargeRefunded(obj as Record<string, unknown>);
        break;
      case 'refund.created':
        await this.handleRefundCreated(obj as StripeRefund);
        break;
      case 'invoice.payment_succeeded':
        // Subscription installment payment succeeded
        await this.handleSubscriptionPaymentSucceeded(obj as Record<string, unknown>);
        break;
      case 'invoice.payment_failed':
        // Subscription installment payment failed
        await this.handleSubscriptionPaymentFailed(obj as Record<string, unknown>);
        break;
      default:
        this.logger.debug(`Unhandled Stripe event type: ${eventType}`);
    }
  }

  /** Extract invoiceId from any Stripe object via known metadata paths. */
  private extractInvoiceId(obj: Record<string, unknown>): string | undefined {
    const metadata = obj?.metadata as Record<string, string> | undefined;
    return metadata?.invoiceId || metadata?.invoice_id || (obj?.client_reference_id as string) || undefined;
  }

  /** Idempotency check: returns true only if this provider event has not been processed before. */
  private async assertNewProviderEvent(provider: string, eventId: string | undefined, eventType: string): Promise<boolean> {
    if (!eventId) return true; // No event ID means we can't deduplicate; process it
    const existing = await this.prisma.client.webhookEvent.findUnique({
      where: { provider_providerEventId: { provider, providerEventId: eventId } },
    }).catch(() => null);
    if (existing) return false;
    await this.prisma.client.webhookEvent.create({
      data: { provider, providerEventId: eventId, eventType },
    }).catch(() => {}); // Best-effort; if it fails, we still process
    return true;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 3. handlePaymentSuccess — checkout.session.completed
  // ──────────────────────────────────────────────────────────────────────────

  async handleCheckoutSessionCompleted(session: StripeCheckoutSession): Promise<void> {
    const invoiceId = this.extractInvoiceId(session as unknown as Record<string, unknown>);
    if (!invoiceId) {
      this.logger.warn(`checkout.session.completed ${session.id} has no invoiceId; skipping`);
      return;
    }

    const payment = await this.prisma.client.payment.findFirst({
      where: { providerPaymentId: session.id },
      include: { invoice: true },
    });

    if (!payment) {
      this.logger.warn(`No local Payment found for checkout session ${session.id}`);
      return;
    }

    // Idempotency: skip if already succeeded
    if (payment.status === 'SUCCESSFUL') {
      this.logger.debug(`Payment ${payment.id} already marked SUCCESSFUL; idempotent no-op`);
      return;
    }

    // Update payment status to succeeded
    await this.prisma.client.payment.update({
      where: { id: payment.id },
      data: {
        status: 'SUCCESSFUL',
        reference: session.payment_intent || session.subscription || payment.reference,
        notes: payment.notes || `Stripe checkout succeeded (${session.id})`,
      },
    });

    // Update invoice status via workflow
    await this.invoiceWorkflow.reconcileFromPayments(invoiceId).catch((e) => {
      this.logger.warn(`Invoice reconciliation failed for ${invoiceId}: ${e instanceof Error ? e.message : e}`);
    });

    // Emit genome memory event
    this.events.emit('payment.received', {
      connectorType: 'stripe',
      externalId: session.payment_intent || session.id,
      businessId: payment.businessId,
      timestamp: new Date(),
      amount: payment.amount,
      currency: payment.currency,
      provider: 'stripe',
      invoiceId,
      paymentId: payment.id,
    });

    this.logger.log(`Payment ${payment.id} succeeded for invoice ${invoiceId} via checkout.session ${session.id}`);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Handle checkout.session.expired
  // ──────────────────────────────────────────────────────────────────────────

  async handleCheckoutSessionExpired(session: StripeCheckoutSession): Promise<void> {
    const payment = await this.prisma.client.payment.findFirst({
      where: { providerPaymentId: session.id },
    });
    if (!payment) return;
    if (payment.status !== 'PENDING') return; // Idempotent: only update from PENDING

    await this.prisma.client.payment.update({
      where: { id: payment.id },
      data: {
        status: 'FAILED',
        notes: 'Checkout session expired',
      },
    });

    this.logger.log(`Payment ${payment.id} failed: checkout session ${session.id} expired`);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 4. handlePaymentFailure — payment_intent.payment_failed
  // ──────────────────────────────────────────────────────────────────────────

  async handlePaymentIntentFailed(paymentIntent: StripePaymentIntent): Promise<void> {
    // Find the payment by payment intent ID (stored in reference)
    const payment = await this.prisma.client.payment.findFirst({
      where: {
        OR: [
          { reference: paymentIntent.id },
          { providerPaymentId: paymentIntent.id },
        ],
      },
    });

    if (!payment) {
      this.logger.warn(`No local Payment found for failed payment intent ${paymentIntent.id}`);
      return;
    }

    if (payment.status === 'FAILED') {
      this.logger.debug(`Payment ${payment.id} already marked FAILED; idempotent no-op`);
      return;
    }

    const failReason = paymentIntent.last_payment_error?.message
      || paymentIntent.last_payment_error?.code
      || 'Payment failed';

    await this.prisma.client.payment.update({
      where: { id: payment.id },
      data: {
        status: 'FAILED',
        notes: failReason,
      },
    });

    this.logger.log(`Payment ${payment.id} failed: ${failReason}`);

    // Emit payment failure event
    this.events.emit('payment.failed', {
      connectorType: 'stripe',
      externalId: paymentIntent.id,
      businessId: payment.businessId,
      timestamp: new Date(),
      amount: payment.amount,
      currency: payment.currency,
      provider: 'stripe',
      error: failReason,
      invoiceId: payment.invoiceId,
    });
  }

  /** Handle payment_intent.succeeded as a fallback path. */
  async handlePaymentIntentSucceeded(paymentIntent: StripePaymentIntent): Promise<void> {
    const payment = await this.prisma.client.payment.findFirst({
      where: {
        OR: [
          { reference: paymentIntent.id },
          { providerPaymentId: paymentIntent.id },
        ],
      },
      include: { invoice: true },
    });

    if (!payment) return;
    if (payment.status === 'SUCCESSFUL') return; // Idempotent

    await this.prisma.client.payment.update({
      where: { id: payment.id },
      data: { status: 'SUCCESSFUL' },
    });

    if (payment.invoiceId) {
      await this.invoiceWorkflow.reconcileFromPayments(payment.invoiceId).catch(() => {});
    }

    this.logger.log(`Payment ${payment.id} succeeded via payment_intent.succeeded`);
  }

  /** Handle charge.succeeded as an additional confirmation path. */
  async handleChargeSucceeded(charge: Record<string, unknown>): Promise<void> {
    const paymentIntentId = charge.payment_intent as string | undefined;
    if (!paymentIntentId) return;

    const payment = await this.prisma.client.payment.findFirst({
      where: { reference: paymentIntentId },
    });

    if (!payment || payment.status === 'SUCCESSFUL') return;

    await this.prisma.client.payment.update({
      where: { id: payment.id },
      data: { status: 'SUCCESSFUL' },
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Subscription installment handlers
  // ──────────────────────────────────────────────────────────────────────────

  async handleSubscriptionPaymentSucceeded(stripeInvoice: Record<string, unknown>): Promise<void> {
    const subscriptionId = stripeInvoice.subscription as string | undefined;
    const lines = stripeInvoice.lines as { data: Array<{ metadata?: Record<string, string> }> } | undefined;
    const metadata = stripeInvoice.metadata as Record<string, string> | undefined;
    const invoiceId = metadata?.invoiceId || lines?.data?.[0]?.metadata?.invoiceId;

    if (!invoiceId || !subscriptionId) return;

    // Find existing payment for this subscription
    const payment = await this.prisma.client.payment.findFirst({
      where: {
        OR: [
          { reference: subscriptionId },
          { providerPaymentId: subscriptionId },
        ],
      },
    });

    if (!payment) return;

    // Update to SUCCESSFUL if it's still pending
    if (payment.status === 'PENDING') {
      await this.prisma.client.payment.update({
        where: { id: payment.id },
        data: { status: 'SUCCESSFUL' },
      });
    }

    await this.invoiceWorkflow.reconcileFromPayments(invoiceId).catch(() => {});
  }

  async handleSubscriptionPaymentFailed(stripeInvoice: Record<string, unknown>): Promise<void> {
    const subscriptionId = stripeInvoice.subscription as string | undefined;
    const metadata = stripeInvoice.metadata as Record<string, string> | undefined;
    const invoiceId = metadata?.invoiceId;

    if (!subscriptionId) return;

    const payment = await this.prisma.client.payment.findFirst({
      where: {
        OR: [
          { reference: subscriptionId },
          { providerPaymentId: subscriptionId },
        ],
      },
    });

    if (!payment) return;

    await this.prisma.client.payment.update({
      where: { id: payment.id },
      data: { status: 'FAILED', notes: 'Subscription payment failed' },
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 5. refund — Process a refund for a payment
  // ──────────────────────────────────────────────────────────────────────────

  async refund(paymentId: string, amount?: number): Promise<PaymentResult> {
    // Find the payment
    const payment = await this.prisma.client.payment.findUnique({
      where: { id: paymentId },
      include: { invoice: true },
    });

    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.status !== 'SUCCESSFUL') {
      throw new BadRequestException('Only successful payments can be refunded');
    }
    if (payment.provider !== 'stripe') {
      throw new BadRequestException('Refund only supported for Stripe payments');
    }

    const secretKey = await this.getSecretKey(payment.businessId);

    // Determine the charge to refund
    const chargeId = payment.reference;
    if (!chargeId || !chargeId.startsWith('ch_')) {
      // If reference is a payment intent, look up the charge
      if (chargeId?.startsWith('pi_')) {
        const pi = await this.stripeRequest(secretKey, 'GET', `/payment_intents/${chargeId}`) as StripePaymentIntent;
        const charge = pi.charges?.data?.[0];
        if (!charge) throw new BadRequestException('No charge found for this payment intent');
        payment.reference = charge.id;
      } else {
        throw new BadRequestException('Cannot determine charge to refund');
      }
    }

    try {
      // Create refund via Stripe API
      const refundBody = new URLSearchParams();
      refundBody.append('charge', payment.reference!);
      if (amount !== undefined) {
        // Convert dollars to cents
        refundBody.append('amount', String(Math.round(amount * 100)));
      }
      refundBody.append('reason', 'requested_by_customer');

      const refund = await this.stripeRequest(secretKey, 'POST', '/refunds', refundBody) as StripeRefund;

      // Update payment status to REFUNDED
      const refundAmount = amount !== undefined ? amount : payment.amount;
      await this.prisma.client.payment.update({
        where: { id: payment.id },
        data: {
          status: 'REFUNDED',
          amount: -Math.abs(refundAmount), // Negative amount for refunds
          notes: `Refunded: ${refund.status} (${refund.id})`,
        },
      });

      // Create a new refund payment record
      await this.prisma.client.payment.create({
        data: {
          businessId: payment.businessId,
          invoiceId: payment.invoiceId,
          amount: -Math.abs(refundAmount),
          currency: payment.currency,
          status: 'REFUNDED',
          provider: 'stripe',
          method: 'card',
          providerPaymentId: refund.id,
          reference: payment.reference,
          notes: `Refund of payment ${payment.id}`,
        },
      });

      // Reconcile invoice status
      if (payment.invoiceId) {
        await this.invoiceWorkflow.reconcileFromPayments(payment.invoiceId).catch((e) => {
          this.logger.warn(`Refund reconciliation failed for invoice ${payment.invoiceId}: ${e instanceof Error ? e.message : e}`);
        });
      }

      this.logger.log(`Refund ${refund.id} created for payment ${payment.id}, amount: ${refundAmount}`);

      return {
        success: true,
        paymentId: refund.id,
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Refund failed for payment ${payment.id}: ${errMsg}`);
      return { success: false, error: errMsg };
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // handleChargeRefunded — charge.refunded webhook
  // ──────────────────────────────────────────────────────────────────────────

  async handleChargeRefunded(charge: Record<string, unknown>): Promise<void> {
    const chargeId = charge.id as string;
    const paymentIntentId = charge.payment_intent as string | undefined;
    const refunds = (charge.refunds as { data: Array<{ id: string; amount: number; status: string; currency: string }> } | undefined)?.data || [];

    if (refunds.length === 0) {
      // Fallback: synthesize from amount_refunded
      const amountRefunded = charge.amount_refunded as number | undefined;
      if (amountRefunded) {
        refunds.push({
          id: `re_synth_${chargeId}`,
          amount: amountRefunded,
          status: 'succeeded',
          currency: (charge.currency as string) || 'usd',
        });
      }
    }

    for (const refund of refunds) {
      if (!refund.id) continue;

      // Idempotent: skip if already recorded
      const existing = await this.prisma.client.payment.findUnique({
        where: { providerPaymentId: refund.id },
      }).catch(() => null);
      if (existing) continue;

      // Find original payment
      const lookupIds = [chargeId, paymentIntentId].filter((v): v is string => !!v);
      const original = await this.prisma.client.payment.findFirst({
        where: {
          provider: 'stripe',
          OR: [
            { providerPaymentId: { in: lookupIds } },
            { reference: { in: lookupIds } },
          ],
        },
        include: { invoice: true },
      }).catch(() => null);

      if (!original) {
        this.logger.warn(`Cannot find original payment for charge ${chargeId}`);
        continue;
      }

      // Create refund payment record
      try {
        await this.prisma.client.payment.create({
          data: {
            businessId: original.businessId,
            invoiceId: original.invoiceId,
            amount: -(refund.amount / 100),
            currency: (refund.currency || original.currency || 'USD').toUpperCase(),
            status: 'REFUNDED',
            provider: 'stripe',
            method: 'card',
            providerPaymentId: refund.id,
            reference: chargeId,
            notes: `Stripe refund: ${refund.status}`,
          },
        });

        // Update original payment to REFUNDED
        await this.prisma.client.payment.update({
          where: { id: original.id },
          data: { status: 'REFUNDED' },
        });

        // Reconcile invoice
        if (original.invoiceId) {
          await this.invoiceWorkflow.reconcileFromPayments(original.invoiceId).catch(() => {});
        }

        this.logger.log(`Recorded Stripe refund ${refund.id} for payment ${original.id}`);
      } catch (e) {
        this.logger.warn(`Failed to persist Stripe refund ${refund.id}: ${e instanceof Error ? e.message : e}`);
      }
    }
  }

  /** Handle refund.created webhook */
  async handleRefundCreated(refund: StripeRefund): Promise<void> {
    // This is handled similarly to charge.refunded; the charge.refunded
    // event is the primary handler. We process refund.created as a backup.
    const existing = await this.prisma.client.payment.findUnique({
      where: { providerPaymentId: refund.id },
    }).catch(() => null);
    if (existing) return;

    const lookupIds = [refund.charge, refund.payment_intent].filter((v): v is string => !!v);
    const original = await this.prisma.client.payment.findFirst({
      where: {
        provider: 'stripe',
        OR: [
          { providerPaymentId: { in: lookupIds } },
          { reference: { in: lookupIds } },
        ],
      },
      include: { invoice: true },
    }).catch(() => null);

    if (!original) return;

    await this.prisma.client.payment.create({
      data: {
        businessId: original.businessId,
        invoiceId: original.invoiceId,
        amount: -(refund.amount / 100),
        currency: (refund.currency || original.currency).toUpperCase(),
        status: 'REFUNDED',
        provider: 'stripe',
        method: 'card',
        providerPaymentId: refund.id,
        reference: refund.charge,
        notes: `Stripe refund created: ${refund.status}`,
      },
    });

    await this.prisma.client.payment.update({
      where: { id: original.id },
      data: { status: 'REFUNDED' },
    });

    if (original.invoiceId) {
      await this.invoiceWorkflow.reconcileFromPayments(original.invoiceId).catch(() => {});
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 6. getPaymentStatus — Get the status of a payment
  // ──────────────────────────────────────────────────────────────────────────

  async getPaymentStatus(paymentId: string): Promise<PaymentStatus> {
    const payment = await this.prisma.client.payment.findUnique({
      where: { id: paymentId },
    });

    if (!payment) throw new NotFoundException('Payment not found');

    return {
      id: payment.id,
      status: payment.status,
      amount: payment.amount,
      currency: payment.currency,
      provider: payment.provider,
      providerPaymentId: payment.providerPaymentId,
      invoiceId: payment.invoiceId,
      businessId: payment.businessId,
      createdAt: payment.createdAt,
      succeededAt: payment.status === 'SUCCESSFUL' ? payment.createdAt : null,
      failedAt: payment.status === 'FAILED' ? payment.createdAt : null,
      refundedAt: payment.status === 'REFUNDED' ? payment.createdAt : null,
      refundAmount: payment.status === 'REFUNDED' ? Math.abs(payment.amount) : null,
      failReason: payment.notes?.startsWith('Checkout creation failed') || payment.notes?.startsWith('Payment failed') ? payment.notes : null,
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 7. listPayments — List payments for a business with optional filters
  // ──────────────────────────────────────────────────────────────────────────

  async listPayments(businessId: string, filters: PaymentFilters = {}): Promise<PaymentStatus[]> {
    const {
      status,
      currency,
      invoiceId,
      startDate,
      endDate,
      limit = 50,
      offset = 0,
    } = filters;

    const where: Prisma.PaymentWhereInput = { businessId };
    if (status) where.status = status;
    if (currency) where.currency = currency.toUpperCase();
    if (invoiceId) where.invoiceId = invoiceId;
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) (where.createdAt as Prisma.DateTimeFilter).gte = startDate;
      if (endDate) (where.createdAt as Prisma.DateTimeFilter).lte = endDate;
    }

    const payments = await this.prisma.client.payment.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 100),
      skip: offset,
    });

    return payments.map((payment) => ({
      id: payment.id,
      status: payment.status,
      amount: payment.amount,
      currency: payment.currency,
      provider: payment.provider,
      providerPaymentId: payment.providerPaymentId,
      invoiceId: payment.invoiceId,
      businessId: payment.businessId,
      createdAt: payment.createdAt,
      succeededAt: payment.status === 'SUCCESSFUL' ? payment.createdAt : null,
      failedAt: payment.status === 'FAILED' ? payment.createdAt : null,
      refundedAt: payment.status === 'REFUNDED' ? payment.createdAt : null,
      refundAmount: payment.status === 'REFUNDED' ? Math.abs(payment.amount) : null,
      failReason: null,
    }));
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 8. syncWithStripe — Reconcile local payment state with Stripe state
  // ──────────────────────────────────────────────────────────────────────────

  async syncWithStripe(paymentId: string): Promise<void> {
    const payment = await this.prisma.client.payment.findUnique({
      where: { id: paymentId },
      include: { invoice: true },
    });

    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.provider !== 'stripe') throw new BadRequestException('Sync only supported for Stripe payments');

    const secretKey = await this.getSecretKey(payment.businessId);

    try {
      // Resolve the Stripe object to query
      let stripeObjectId = payment.providerPaymentId;
      let stripeStatus: string | undefined;
      let stripePaymentIntentId: string | undefined;

      if (stripeObjectId.startsWith('cs_')) {
        // It's a checkout session
        const session = await this.stripeRequest(secretKey, 'GET', `/checkout/sessions/${stripeObjectId}?expand[]=payment_intent`) as StripeCheckoutSession & { payment_intent: StripePaymentIntent | null };
        stripeStatus = session.status;
        stripePaymentIntentId = session.payment_intent?.id || undefined;

        // Map Stripe status to local status
        const mappedStatus = this.mapStripeStatus(stripeStatus);
        if (mappedStatus && mappedStatus !== payment.status) {
          await this.prisma.client.payment.update({
            where: { id: payment.id },
            data: {
              status: mappedStatus,
              reference: stripePaymentIntentId || payment.reference,
            },
          });

          if (mappedStatus === 'SUCCESSFUL' && payment.invoiceId) {
            await this.invoiceWorkflow.reconcileFromPayments(payment.invoiceId).catch(() => {});
          }
        }
      } else if (stripeObjectId.startsWith('pi_')) {
        // It's a payment intent
        const pi = await this.stripeRequest(secretKey, 'GET', `/payment_intents/${stripeObjectId}`) as StripePaymentIntent;
        stripeStatus = pi.status;

        const mappedStatus = this.mapStripeStatus(stripeStatus);
        if (mappedStatus && mappedStatus !== payment.status) {
          await this.prisma.client.payment.update({
            where: { id: payment.id },
            data: { status: mappedStatus },
          });
        }
      } else if (stripeObjectId.startsWith('sub_')) {
        // It's a subscription
        const sub = await this.stripeRequest(secretKey, 'GET', `/subscriptions/${stripeObjectId}`) as { status: string };
        stripeStatus = sub.status;

        const mappedStatus = this.mapStripeStatus(stripeStatus);
        if (mappedStatus && mappedStatus !== payment.status) {
          await this.prisma.client.payment.update({
            where: { id: payment.id },
            data: { status: mappedStatus },
          });
        }
      }

      this.logger.log(`Synced payment ${payment.id} with Stripe: status=${stripeStatus}`);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to sync payment ${payment.id} with Stripe: ${errMsg}`);
      throw new BadRequestException(`Stripe sync failed: ${errMsg}`);
    }
  }

  /** Map Stripe object status to local Payment status. */
  private mapStripeStatus(stripeStatus?: string): string | null {
    switch (stripeStatus) {
      case 'complete':
      case 'succeeded':
      case 'active':
      case 'paid':
        return 'SUCCESSFUL';
      case 'open':
      case 'requires_payment_method':
      case 'requires_confirmation':
      case 'requires_action':
      case 'processing':
      case 'trialing':
        return 'PENDING';
      case 'expired':
      case 'canceled':
      case 'payment_failed':
      case 'incomplete':
      case 'incomplete_expired':
      case 'unpaid':
      case 'past_due':
        return 'FAILED';
      default:
        return null;
    }
  }
}
