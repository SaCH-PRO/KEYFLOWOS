import { BadRequestException, Inject, Injectable, Logger, Optional, forwardRef } from '@nestjs/common';
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CommerceService } from '../commerce/commerce.service';
import { InvoiceWorkflowService } from '../commerce/invoice-workflow.service';
import { RevenuePostingService } from '../finance/revenue-posting.service';
import { WiPayConnector } from '../../core/connectors/implementations/wipay.connector';
import { PayPalConnector } from '../../core/connectors/implementations/paypal.connector';
import { StoreOrderService } from '../site/store-order.service';
import { CheckoutPaymentIntent, Client, Environment, LogLevel, OrdersController } from '@paypal/paypal-server-sdk';

interface WipayCallbackParams {
  transaction_id?: string;
  order_id?: string;
  status?: string;
  total?: string;
  hash?: string;
}

interface GatewayInfo {
  id: string;
  name: string;
  currencies: string[];
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CommerceService) private readonly commerceService: CommerceService,
    @Inject(InvoiceWorkflowService) private readonly invoiceWorkflow: InvoiceWorkflowService,
    @Inject(RevenuePostingService) private readonly revenuePosting: RevenuePostingService,
    @Optional() @Inject(WiPayConnector) private readonly wipayConnector?: WiPayConnector,
    @Optional() @Inject(PayPalConnector) private readonly paypalConnector?: PayPalConnector,
    @Optional() @Inject(forwardRef(() => StoreOrderService)) private readonly storeOrderService?: StoreOrderService,
  ) {}

  /**
   * FIN2 — single tx wrapper for SUCCESSFUL provider payments. Persists
   * the Payment row and posts the deposit-side ledger entries together;
   * returns the created row so callers can keep their existing logging.
   * Idempotency on (Payment, id, payment_recorded) means replay is safe.
   */
  private async createPaymentWithPosting(data: Prisma.PaymentUncheckedCreateInput) {
    return this.prisma.client.$transaction(async (tx) => {
      const created = await tx.payment.create({ data });
      if (created.status === 'SUCCESSFUL') {
        await this.revenuePosting.onPaymentRecorded(created.id, {
          tx: tx as unknown as Prisma.TransactionClient,
        });
      }
      return created;
    });
  }

  /**
   * FIN2 — single tx wrapper for provider refunds. Records the negative
   * Payment row tagged REFUNDED and reverses the original posting (looked
   * up by externalRef) in one commit.
   */
  private async createRefundWithPosting(
    originalPaymentProviderId: string,
    data: Prisma.PaymentUncheckedCreateInput,
  ) {
    return this.prisma.client.$transaction(async (tx) => {
      const created = await tx.payment.create({ data });
      const original = await tx.payment.findUnique({
        where: { providerPaymentId: originalPaymentProviderId },
        select: { id: true },
      });
      if (original) {
        await this.revenuePosting.onPaymentRefunded(original.id, {
          tx: tx as unknown as Prisma.TransactionClient,
        });
      }
      return created;
    });
  }

  /**
   * Refund variant used when the original capture id is unavailable (e.g.
   * a PayPal refund webhook with no `supplementary_data.related_ids`). We
   * still need to reverse the original payment's ledger posting, so we
   * resolve it by invoiceId — picking the most recent SUCCESSFUL payment
   * on that invoice and reversing its posting in the same commit.
   */
  private async createRefundWithPostingByInvoice(
    invoiceId: string,
    data: Prisma.PaymentUncheckedCreateInput,
  ) {
    return this.prisma.client.$transaction(async (tx) => {
      const created = await tx.payment.create({ data });
      const original = await tx.payment.findFirst({
        where: { invoiceId, status: 'SUCCESSFUL' },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      if (original) {
        await this.revenuePosting.onPaymentRefunded(original.id, {
          tx: tx as unknown as Prisma.TransactionClient,
        });
      }
      return created;
    });
  }

  /**
   * When a payment webhook references an ID that is not an Invoice, it may
   * be a MarketplaceOrder (storefront checkout). If so, call
   * StoreOrderService to complete the checkout lifecycle atomically.
   */
  private async maybeCompleteStorefrontOrder(
    orderId: string,
    providerPaymentId: string,
  ): Promise<boolean> {
    if (!this.storeOrderService) return false;
    const order = await this.prisma.client.marketplaceOrder.findUnique({
      where: { id: orderId },
      select: { id: true, paymentStatus: true },
    });
    if (!order) return false;
    if (order.paymentStatus === 'PAID') {
      this.logger.debug(`Storefront order ${orderId} already PAID; idempotent no-op`);
      return true;
    }
    await this.storeOrderService.updatePaymentStatus(order.id, 'PAID', providerPaymentId);
    return true;
  }

  private getPaypalClient(clientId?: string, clientSecret?: string): { client: Client; ordersController: OrdersController } | null {
    const id = clientId || process.env.PAYPAL_CLIENT_ID;
    const secret = clientSecret || process.env.PAYPAL_CLIENT_SECRET;
    if (!id || !secret) return null;

    const isProduction = process.env.PAYPAL_ENVIRONMENT === 'production';
    const client = new Client({
      clientCredentialsAuthCredentials: {
        oAuthClientId: id,
        oAuthClientSecret: secret,
      },
      environment: isProduction ? Environment.Production : Environment.Sandbox,
      logging: {
        logLevel: LogLevel.Error,
        logRequest: { logBody: false },
        logResponse: { logBody: false },
      },
    });

    const ordersController = new OrdersController(client);
    return { client, ordersController };
  }

  async getAvailableGateways(businessId: string): Promise<GatewayInfo[]> {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { metaData: true },
    });

    const gateways: GatewayInfo[] = [];
    const meta = (business?.metaData as Record<string, any>) || {};

    const wipayKey = meta.wipayApiKey || process.env.WIPAY_API_KEY;
    const wipayAccount = meta.wipayAccountNumber || process.env.WIPAY_ACCOUNT_NUMBER;
    if (wipayKey || wipayAccount) {
      gateways.push({
        id: 'wipay',
        name: 'WiPay',
        currencies: ['TTD', 'JMD', 'BBD', 'GYD', 'XCD'],
      });
    }

    const paypalId = meta.paypalClientId || process.env.PAYPAL_CLIENT_ID;
    const paypalSecret = meta.paypalClientSecret || process.env.PAYPAL_CLIENT_SECRET;
    if (paypalId && paypalSecret) {
      gateways.push({
        id: 'paypal',
        name: 'PayPal',
        currencies: ['USD'],
      });
    }

    const stripePub = meta.stripePublishableKey || process.env.STRIPE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    const stripeSecret = meta.stripeSecretKey || process.env.STRIPE_SECRET_KEY;
    const stripeWh = meta.stripeWebhookSecret || process.env.STRIPE_WEBHOOK_SECRET;
    if (stripePub && stripeSecret && stripeWh) {
      gateways.push({
        id: 'stripe',
        name: 'Stripe',
        currencies: ['USD', 'EUR', 'GBP', 'CAD', 'AUD'],
      });
    }

    return gateways;
  }

  /**
   * Centralised payment-eligibility gate. Checkout/order/redirect endpoints
   * must call this before creating an external session — DRAFT invoices
   * MUST NOT be paid (they have no commitment), and PAID/VOID/FAILED are
   * terminal. Allowed states: SENT, OVERDUE, PARTIALLY_PAID, PENDING.
   */
  private assertInvoicePayable(status: string, invoiceId: string): void {
    const allowed = new Set(['SENT', 'OVERDUE', 'PARTIALLY_PAID', 'PENDING']);
    if (allowed.has(status)) return;
    if (status === 'PAID') throw new BadRequestException('Invoice is already paid');
    if (status === 'VOID') throw new BadRequestException('Invoice is void');
    if (status === 'DRAFT') {
      throw new BadRequestException(
        `Invoice ${invoiceId} is still a draft — send it before collecting payment`,
      );
    }
    throw new BadRequestException(`Invoice ${invoiceId} is not in a payable state (${status})`);
  }

  async createStripeCheckout(
    invoiceId: string,
    successUrl: string,
    cancelUrl: string,
  ): Promise<{ redirectUrl: string }> {
    const invoice = await this.prisma.client.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        contact: { select: { email: true } },
        business: { select: { id: true, name: true, metaData: true } },
      },
    });
    if (!invoice) throw new BadRequestException('Invoice not found');
    this.assertInvoicePayable(invoice.status, invoiceId);

    const meta = (invoice.business.metaData as Record<string, any>) || {};
    const secretKey = meta.stripeSecretKey || process.env.STRIPE_SECRET_KEY;
    if (!secretKey) throw new BadRequestException('Stripe is not configured for this business');

    const allowed = (process.env.PUBLIC_URL_ALLOWLIST || process.env.NEXT_PUBLIC_BASE_URL || '')
      .split(',').map((s) => s.trim()).filter(Boolean)
      .map((s) => s.startsWith('http') ? s : `https://${s}`);
    if (allowed.length === 0) {
      this.logger.error('No PUBLIC_URL_ALLOWLIST configured; rejecting Stripe checkout for safety');
      throw new BadRequestException('Server misconfigured: no allowed return-URL origins set');
    }
    const isAllowedUrl = (u: string): boolean => {
      try {
        const parsed = new URL(u);
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
        return allowed.some((a) => {
          try { return new URL(a).origin === parsed.origin; } catch { return false; }
        });
      } catch { return false; }
    };
    if (!isAllowedUrl(successUrl) || !isAllowedUrl(cancelUrl)) {
      throw new BadRequestException('Invalid success/cancel URL');
    }

    const currency = (invoice.currency || 'USD').toLowerCase();
    const amount = Math.round(Number(invoice.total) * 100);
    const description = `Invoice ${invoice.invoiceNumber || invoice.id} — ${invoice.business.name || ''}`.trim();

    const body = new URLSearchParams();
    body.append('mode', 'payment');
    body.append('success_url', successUrl);
    body.append('cancel_url', cancelUrl);
    body.append('client_reference_id', invoiceId);
    body.append('metadata[invoiceId]', invoiceId);
    body.append('metadata[businessId]', invoice.business.id);
    if (invoice.contact?.email) body.append('customer_email', invoice.contact.email);
    body.append('line_items[0][quantity]', '1');
    body.append('line_items[0][price_data][currency]', currency);
    body.append('line_items[0][price_data][unit_amount]', String(amount));
    body.append('line_items[0][price_data][product_data][name]', description);

    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    if (!res.ok) {
      const text = await res.text();
      this.logger.error(`Stripe checkout creation failed: ${text}`);
      throw new BadRequestException('Failed to create Stripe checkout session');
    }

    const session = (await res.json()) as { id: string; url: string };
    return { redirectUrl: session.url };
  }

  private verifyStripeSignature(rawPayload: string, signatureHeader: string, secret: string): boolean {
    if (!signatureHeader || !secret) return false;
    const parts = signatureHeader.split(',').reduce<Record<string, string>>((acc, part) => {
      const [k, v] = part.split('=');
      if (k && v) acc[k.trim()] = (acc[k.trim()] ? acc[k.trim()] + ',' : '') + v.trim();
      return acc;
    }, {});
    const timestamp = parts.t;
    const provided = parts.v1;
    if (!timestamp || !provided) return false;
    const expected = createHmac('sha256', secret)
      .update(`${timestamp}.${rawPayload}`)
      .digest('hex');
    const a = Buffer.from(expected, 'utf8');
    const candidates = provided.split(',').map((s) => Buffer.from(s, 'utf8'));
    return candidates.some((b) => b.length === a.length && timingSafeEqual(a, b));
  }

  async handleStripeWebhook(
    rawPayload: string,
    signatureHeader: string | undefined,
  ): Promise<{ ok: true; received?: boolean; processed?: string }> {
    if (!rawPayload) throw new BadRequestException('Missing Stripe webhook payload');

    let event: { id?: string; type?: string; data?: { object?: any } };
    try {
      event = JSON.parse(rawPayload);
    } catch {
      throw new BadRequestException('Invalid Stripe webhook payload');
    }

    const obj = event.data?.object || {};
    const eventType = event.type || '';

    // Verify signature using a webhook endpoint secret. Prefer the global env
    // secret (one shared Stripe webhook endpoint per deployment); fall back to
    // a per-business secret stored in business.metaData.stripeWebhookSecret
    // when an invoice can be resolved from the event.
    const candidateInvoiceId: string | undefined =
      obj?.metadata?.invoiceId ||
      obj?.client_reference_id ||
      obj?.metadata?.invoice_id;

    const envSecret = process.env.STRIPE_WEBHOOK_SECRET;
    let signatureOk = false;
    if (envSecret && signatureHeader && this.verifyStripeSignature(rawPayload, signatureHeader, envSecret)) {
      signatureOk = true;
    } else if (candidateInvoiceId) {
      const inv = await this.prisma.client.invoice.findUnique({
        where: { id: candidateInvoiceId },
        include: { business: { select: { metaData: true } } },
      }).catch(() => null);
      const businessSecret = (inv?.business.metaData as Record<string, any> | null)?.stripeWebhookSecret as string | undefined;
      if (businessSecret && signatureHeader && this.verifyStripeSignature(rawPayload, signatureHeader, businessSecret)) {
        signatureOk = true;
      }
    }

    if (!signatureOk) {
      if (!envSecret) {
        this.logger.error('Stripe webhook secret not configured; rejecting webhook');
      } else {
        this.logger.warn(`Stripe webhook signature verification failed (event=${eventType})`);
      }
      throw new BadRequestException('Invalid Stripe webhook signature');
    }

    // Provider-event-id idempotency: if Stripe re-delivers this `evt_...`,
    // ack it as received but skip all side-effects. Belt-and-suspenders with
    // the per-Payment.providerPaymentId unique constraint downstream.
    const fresh = await this.invoiceWorkflow.assertNewProviderEvent(
      'stripe',
      event.id,
      eventType,
      undefined,
    );
    if (!fresh) {
      return { ok: true, received: true };
    }

    // Dispatch by event type. Unknown event types are acked but ignored so
    // Stripe doesn't keep retrying them.
    switch (eventType) {
      case 'checkout.session.completed':
        // Note: Stripe Payment Links surface as `checkout.session.completed`
        // events with `payment_link` set on the session — there is no
        // separate `payment_link.completed` event in the Stripe API.
        await this.processStripeChargeOrSession(eventType, obj, event.id);
        return { ok: true, received: true, processed: eventType };
      case 'charge.succeeded':
      case 'payment_intent.succeeded':
        await this.processStripeChargeOrSession(eventType, obj, event.id);
        return { ok: true, received: true, processed: eventType };
      case 'charge.refunded':
      case 'refund.created':
      case 'charge.refund.updated':
        await this.processStripeRefund(eventType, obj);
        return { ok: true, received: true, processed: eventType };
      default:
        return { ok: true, received: true };
    }
  }

  private async processStripeChargeOrSession(
    eventType: string,
    obj: any,
    eventId: string | undefined,
  ): Promise<void> {
    // checkout.session.completed: invoiceId comes from session metadata or
    // client_reference_id. payment_intent.succeeded / charge.succeeded:
    // invoiceId is on the payment_intent / charge metadata if it was set
    // during checkout.session creation (see createStripeCheckout above).
    const invoiceId: string | undefined =
      obj?.metadata?.invoiceId ||
      obj?.client_reference_id ||
      obj?.metadata?.invoice_id;
    if (!invoiceId) {
      this.logger.warn(`Stripe ${eventType} has no invoiceId in metadata; ignoring`);
      return;
    }

    const providerPaymentId: string = obj.id || eventId || `stripe_${invoiceId}_${Date.now()}`;

    const invoice = await this.prisma.client.invoice.findUnique({
      where: { id: invoiceId },
    });
    if (!invoice) {
      const completed = await this.maybeCompleteStorefrontOrder(invoiceId, providerPaymentId);
      if (completed) return;
      this.logger.warn(`Stripe ${eventType} references unknown invoice ${invoiceId}`);
      return;
    }
    const existing = await this.prisma.client.payment.findUnique({
      where: { providerPaymentId },
    }).catch(() => null);
    if (existing) return;

    // NOTE: We deliberately do NOT block subsequent successful payments for
    // the same invoice — partial payments must accumulate. The dedup above
    // (providerPaymentId @unique + the WebhookEvent table) already guards
    // against double-counting the same Stripe event/charge.

    const amountMinor: number =
      obj.amount_total ?? obj.amount_received ?? obj.amount ?? 0;
    const amount = amountMinor / 100;
    const currency = (obj.currency || invoice.currency || 'USD').toUpperCase();

    if (currency !== invoice.currency.toUpperCase()) {
      this.logger.warn(
        `Stripe ${eventType} currency mismatch for invoice ${invoiceId}: got ${currency}, expected ${invoice.currency}`,
      );
      throw new BadRequestException('Stripe webhook currency mismatch');
    }
    // Allow over- and under-payments (partials). Workflow reconciliation
    // decides whether the invoice flips PARTIALLY_PAID or PAID.
    const expectedAmount = Number(invoice.total);
    if (amount > expectedAmount + 0.01) {
      this.logger.warn(
        `Stripe ${eventType} overpayment for invoice ${invoiceId}: got ${amount}, expected ${expectedAmount}`,
      );
    }

    // Stash the related payment_intent / charge id in `reference` so that
    // later refund events (which arrive keyed by charge id and contain the
    // payment_intent) can correlate back to this row. Without this, a
    // `checkout.session.completed` row stored as `cs_...` would be
    // un-linkable from a `charge.refunded` event for the same payment.
    const reference: string | null =
      obj.payment_intent ||
      obj.charge ||
      (typeof obj.latest_charge === 'string' ? obj.latest_charge : null) ||
      null;

    await this.createPaymentWithPosting({
      provider: 'stripe',
      providerPaymentId,
      amount: amount > 0 ? amount : expectedAmount,
      currency,
      status: 'SUCCESSFUL',
      invoiceId,
      businessId: invoice.businessId,
      reference,
    });
    // Workflow recomputes the invoice balance from ALL payment rows and
    // decides PARTIALLY_PAID vs PAID. Single source of truth for state.
    await this.invoiceWorkflow.reconcileFromPayments(invoiceId).catch((e) => {
      this.logger.warn(`Stripe reconcile failed for invoice ${invoiceId}: ${e instanceof Error ? e.message : e}`);
    });
  }

  private async processStripeRefund(eventType: string, obj: any): Promise<void> {
    // For charge.refunded the object is a Charge with refunds.data[]. For
    // refund.created / charge.refund.updated the object is a Refund itself.
    const refunds: Array<{
      id?: string;
      amount?: number;
      currency?: string;
      charge?: string;
      paymentIntent?: string | null;
      status?: string;
      reason?: string | null;
    }> = [];

    if (eventType === 'charge.refunded') {
      const list: any[] = obj?.refunds?.data ?? [];
      for (const r of list) {
        refunds.push({
          id: r.id,
          amount: r.amount,
          currency: r.currency,
          charge: r.charge ?? obj.id,
          paymentIntent: r.payment_intent ?? obj.payment_intent ?? null,
          status: r.status,
          reason: r.reason,
        });
      }
      // If refunds.data is empty (older events) synthesize from amount_refunded
      if (refunds.length === 0 && typeof obj.amount_refunded === 'number') {
        refunds.push({
          id: `re_synth_${obj.id}`,
          amount: obj.amount_refunded,
          currency: obj.currency,
          charge: obj.id,
          paymentIntent: obj.payment_intent ?? null,
          status: 'succeeded',
        });
      }
    } else {
      refunds.push({
        id: obj.id,
        amount: obj.amount,
        currency: obj.currency,
        charge: obj.charge,
        paymentIntent: obj.payment_intent ?? null,
        status: obj.status,
        reason: obj.reason,
      });
    }

    for (const refund of refunds) {
      if (!refund.id || !refund.charge) continue;
      // Idempotent: skip if we already recorded this refund.
      const existing = await this.prisma.client.payment.findUnique({
        where: { providerPaymentId: refund.id },
      }).catch(() => null);
      if (existing) continue;

      // Locate the original payment row to get invoiceId/businessId. The
      // original may have been stored as: the charge id (charge.succeeded
      // path), the session id with payment_intent stashed in reference
      // (checkout.session.completed path), or the payment_intent id
      // (payment_intent.succeeded path). Try every linkable identifier.
      const lookupIds = [refund.charge, refund.paymentIntent].filter((v): v is string => !!v);
      const original = await this.prisma.client.payment.findFirst({
        where: {
          provider: 'stripe',
          OR: [
            { providerPaymentId: { in: lookupIds } },
            { reference: { in: lookupIds } },
          ],
        },
      }).catch(() => null);

      if (!original) {
        this.logger.warn(
          `Stripe ${eventType} could not locate original payment for charge ${refund.charge} (pi=${refund.paymentIntent ?? 'none'}); skipping`,
        );
        continue;
      }

      const persisted = await this.createRefundWithPosting(original.providerPaymentId, {
        provider: 'stripe',
        providerPaymentId: refund.id,
        amount: -Math.abs((refund.amount ?? 0) / 100),
        currency: (refund.currency || original.currency || 'USD').toUpperCase(),
        status: 'REFUNDED',
        invoiceId: original.invoiceId,
        businessId: original.businessId,
        reference: refund.charge,
        notes: refund.reason ?? null,
      }).catch((e) => {
        this.logger.warn(`Failed to persist Stripe refund ${refund.id}: ${e instanceof Error ? e.message : e}`);
        return null;
      });
      // Reopen the invoice if the refund moves the balance below total.
      if (persisted) {
        await this.invoiceWorkflow.reconcileFromPayments(original.invoiceId).catch((e) => {
          this.logger.warn(`Stripe refund reconcile failed for invoice ${original.invoiceId}: ${e instanceof Error ? e.message : e}`);
        });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // PayPal webhook
  // ---------------------------------------------------------------------------

  private async verifyPaypalSignature(
    headers: Record<string, string | undefined>,
    rawPayload: string,
    sandbox: boolean,
    creds?: { clientId?: string | null; clientSecret?: string | null; webhookId?: string | null },
  ): Promise<boolean> {
    const webhookId = creds?.webhookId || process.env.PAYPAL_WEBHOOK_ID;
    if (!webhookId) {
      this.logger.error('PAYPAL_WEBHOOK_ID is not configured; cannot verify PayPal webhooks');
      return false;
    }
    const clientId = creds?.clientId || process.env.PAYPAL_CLIENT_ID;
    const clientSecret = creds?.clientSecret || process.env.PAYPAL_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      this.logger.error('PayPal client credentials not configured; cannot verify PayPal webhooks');
      return false;
    }
    const required = [
      'paypal-transmission-id',
      'paypal-transmission-time',
      'paypal-transmission-sig',
      'paypal-cert-url',
      'paypal-auth-algo',
    ] as const;
    for (const h of required) {
      if (!headers[h]) {
        this.logger.warn(`PayPal webhook missing required header: ${h}`);
        return false;
      }
    }
    const base = sandbox ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';
    let token: string;
    try {
      const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
      const tokenRes = await fetch(`${base}/v1/oauth2/token`, {
        method: 'POST',
        headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=client_credentials',
      });
      if (!tokenRes.ok) {
        this.logger.warn(`PayPal token fetch for webhook verify failed: ${tokenRes.status}`);
        return false;
      }
      const data = (await tokenRes.json()) as { access_token?: string };
      if (!data.access_token) return false;
      token = data.access_token;
    } catch (e) {
      this.logger.warn(`PayPal token fetch error: ${e instanceof Error ? e.message : e}`);
      return false;
    }

    let webhookEvent: unknown;
    try {
      webhookEvent = JSON.parse(rawPayload);
    } catch {
      return false;
    }

    try {
      const verifyRes = await fetch(`${base}/v1/notifications/verify-webhook-signature`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          auth_algo: headers['paypal-auth-algo'],
          cert_url: headers['paypal-cert-url'],
          transmission_id: headers['paypal-transmission-id'],
          transmission_sig: headers['paypal-transmission-sig'],
          transmission_time: headers['paypal-transmission-time'],
          webhook_id: webhookId,
          webhook_event: webhookEvent,
        }),
      });
      if (!verifyRes.ok) {
        const body = await verifyRes.text().catch(() => '');
        this.logger.warn(`PayPal verify-webhook-signature returned ${verifyRes.status}${body ? `: ${body.slice(0, 160)}` : ''}`);
        return false;
      }
      const result = (await verifyRes.json()) as { verification_status?: string };
      return result.verification_status === 'SUCCESS';
    } catch (e) {
      this.logger.warn(`PayPal verify-webhook-signature error: ${e instanceof Error ? e.message : e}`);
      return false;
    }
  }

  async handlePaypalWebhook(
    rawPayload: string,
    headers: Record<string, string | undefined>,
  ): Promise<{ ok: true; received?: boolean; processed?: string }> {
    if (!rawPayload) throw new BadRequestException('Missing PayPal webhook payload');

    let event: { id?: string; event_type?: string; resource?: any };
    try {
      event = JSON.parse(rawPayload);
    } catch {
      throw new BadRequestException('Invalid PayPal webhook payload');
    }

    const sandbox = process.env.PAYPAL_ENVIRONMENT !== 'production';

    // Resolve per-business PayPal credentials before verifying signature, so
    // multi-tenant deployments where each business has its own PayPal app
    // (with its own webhook id) work correctly. We try to identify the
    // business via custom_id/invoice_id/related order; if none match, fall
    // back to env-level credentials.
    const businessCreds = await this.resolvePaypalBusinessCreds(event.resource || {});
    const verified = await this.verifyPaypalSignature(headers, rawPayload, sandbox, businessCreds ?? undefined);
    if (!verified) {
      throw new BadRequestException('Invalid PayPal webhook signature');
    }

    const fresh = await this.invoiceWorkflow.assertNewProviderEvent(
      'paypal',
      event.id,
      event.event_type,
      undefined,
    );
    if (!fresh) {
      return { ok: true, received: true };
    }

    const eventType = event.event_type || '';
    const resource = event.resource || {};

    switch (eventType) {
      case 'PAYMENT.CAPTURE.COMPLETED':
        await this.processPaypalCaptureCompleted(resource);
        return { ok: true, received: true, processed: eventType };
      case 'CHECKOUT.ORDER.COMPLETED':
        // For ORDER.COMPLETED, resource.id is the *order* id, not the
        // capture id. Captures live under purchase_units[].payments.captures.
        // Persist a Payment row per capture so refund linkage (which keys on
        // capture id) keeps working, and idempotency stays intact even if
        // PAYMENT.CAPTURE.COMPLETED also arrives for the same capture.
        await this.processPaypalOrderCompleted(resource);
        return { ok: true, received: true, processed: eventType };
      case 'PAYMENT.CAPTURE.REFUNDED':
      case 'PAYMENT.CAPTURE.REVERSED':
        await this.processPaypalRefund(resource);
        return { ok: true, received: true, processed: eventType };
      default:
        return { ok: true, received: true };
    }
  }

  /**
   * Look up the business behind a PayPal webhook resource (via the linked
   * invoice) and return its PayPal app credentials, falling back to env.
   * Returns null when no business can be resolved — the caller will then use
   * env-level credentials only.
   */
  private async resolvePaypalBusinessCreds(
    resource: any,
  ): Promise<{ clientId: string | null; clientSecret: string | null; webhookId: string | null } | null> {
    const link = await this.resolvePaypalInvoiceId(resource).catch(() => null);
    if (!link) return null;
    const business = await this.prisma.client.business.findUnique({
      where: { id: link.businessId },
      select: { metaData: true },
    }).catch(() => null);
    const meta = (business?.metaData as Record<string, any> | null) ?? {};
    const clientId = (meta.paypalClientId as string | undefined) ?? null;
    const clientSecret = (meta.paypalClientSecret as string | undefined) ?? null;
    const webhookId = (meta.paypalWebhookId as string | undefined) ?? null;
    if (!clientId && !clientSecret && !webhookId) return null;
    return { clientId, clientSecret, webhookId };
  }

  /**
   * Walk an ORDER.COMPLETED resource and persist a payment row for each
   * embedded capture. This is the only safe way to handle this event:
   * resource.id is the order id (not a capture id), so persisting it
   * directly would create a row that refund events cannot link to.
   */
  private async processPaypalOrderCompleted(resource: any): Promise<void> {
    const orderId: string | undefined = resource?.id;
    const purchaseUnits: any[] = Array.isArray(resource?.purchase_units) ? resource.purchase_units : [];
    const captures: any[] = [];
    for (const pu of purchaseUnits) {
      const capList: any[] = pu?.payments?.captures ?? [];
      for (const cap of capList) {
        captures.push({
          ...cap,
          custom_id: cap?.custom_id ?? pu?.custom_id ?? resource?.custom_id,
          invoice_id: cap?.invoice_id ?? pu?.invoice_id ?? resource?.invoice_id,
          supplementary_data: {
            related_ids: { order_id: orderId, ...(cap?.supplementary_data?.related_ids ?? {}) },
          },
        });
      }
    }
    if (captures.length === 0) {
      this.logger.log(
        `PayPal order ${orderId ?? '<unknown>'} completed but no captures present; awaiting PAYMENT.CAPTURE.COMPLETED`,
      );
      return;
    }
    for (const cap of captures) {
      await this.processPaypalCaptureCompleted(cap);
    }
  }

  /**
   * Resolve the local invoiceId for a PayPal resource. PayPal does not echo
   * purchase_units back on capture events, so we rely on `custom_id` /
   * `invoice_id` (set when the order was created) and fall back to looking up
   * an existing payment row by the related order id.
   */
  private async resolvePaypalInvoiceId(resource: any): Promise<{ invoiceId: string; businessId: string } | null> {
    const candidate: string | undefined =
      resource?.custom_id ||
      resource?.invoice_id ||
      resource?.purchase_units?.[0]?.reference_id ||
      resource?.purchase_units?.[0]?.custom_id;
    if (candidate) {
      const inv = await this.prisma.client.invoice.findUnique({
        where: { id: candidate },
        select: { id: true, businessId: true },
      }).catch(() => null);
      if (inv) return { invoiceId: inv.id, businessId: inv.businessId };
    }
    const orderId: string | undefined = resource?.supplementary_data?.related_ids?.order_id;
    if (orderId) {
      const existing = await this.prisma.client.payment.findFirst({
        where: { provider: 'paypal', OR: [{ providerPaymentId: orderId }, { reference: orderId }] },
        select: { invoiceId: true, businessId: true },
      });
      if (existing) return { invoiceId: existing.invoiceId, businessId: existing.businessId };
    }
    return null;
  }

  private async processPaypalCaptureCompleted(resource: any): Promise<void> {
    const captureId: string | undefined = resource?.id;
    if (!captureId) {
      this.logger.warn('PayPal capture completed event missing capture id');
      return;
    }
    const existing = await this.prisma.client.payment.findUnique({
      where: { providerPaymentId: captureId },
    }).catch(() => null);
    if (existing) return;

    const link = await this.resolvePaypalInvoiceId(resource);
    if (!link) {
      const orderId: string | undefined =
        resource?.custom_id ||
        resource?.invoice_id ||
        resource?.purchase_units?.[0]?.custom_id ||
        resource?.purchase_units?.[0]?.reference_id;
      if (orderId) {
        const completed = await this.maybeCompleteStorefrontOrder(orderId, captureId);
        if (completed) return;
      }
      this.logger.warn(`PayPal capture ${captureId} could not be linked to a local invoice or storefront order; skipping persist`);
      return;
    }

    const invoice = await this.prisma.client.invoice.findUnique({
      where: { id: link.invoiceId },
    });
    if (!invoice) {
      const completed = await this.maybeCompleteStorefrontOrder(link.invoiceId, captureId);
      if (completed) return;
      return;
    }

    const amount = Number(resource?.amount?.value ?? invoice.total);
    const currency = (resource?.amount?.currency_code || invoice.currency || 'USD').toUpperCase();

    await this.createPaymentWithPosting({
      provider: 'paypal',
      providerPaymentId: captureId,
      amount,
      currency,
      status: 'SUCCESSFUL',
      invoiceId: invoice.id,
      businessId: invoice.businessId,
      reference: resource?.supplementary_data?.related_ids?.order_id ?? null,
    });

    await this.invoiceWorkflow.reconcileFromPayments(invoice.id).catch((e) => {
      this.logger.warn(`PayPal reconcile failed for invoice ${invoice.id}: ${e instanceof Error ? e.message : e}`);
    });

    const payer = resource?.payer as { email_address?: string; name?: { given_name?: string; surname?: string } } | undefined;
    this.paypalConnector?.emitPaymentReceived(invoice.businessId, {
      amount,
      currency,
      invoiceId: invoice.id,
      payerEmail: payer?.email_address,
      payerName: payer?.name ? `${payer.name.given_name ?? ''} ${payer.name.surname ?? ''}`.trim() : undefined,
      externalId: captureId,
    }).catch((e) => this.logger.warn(`PayPal connector event emission failed: ${e.message}`));
  }

  private async processPaypalRefund(resource: any): Promise<void> {
    const refundId: string | undefined = resource?.id;
    if (!refundId) {
      this.logger.warn('PayPal refund event missing refund id');
      return;
    }
    const existing = await this.prisma.client.payment.findUnique({
      where: { providerPaymentId: refundId },
    }).catch(() => null);
    if (existing) return;

    // The original capture id is in supplementary_data.related_ids.capture_id
    const captureId: string | undefined =
      resource?.supplementary_data?.related_ids?.capture_id ||
      resource?.links?.find?.((l: any) => l.rel === 'up')?.href?.split('/').pop();

    let original: { invoiceId: string; businessId: string; currency: string } | null = null;
    if (captureId) {
      original = await this.prisma.client.payment.findUnique({
        where: { providerPaymentId: captureId },
        select: { invoiceId: true, businessId: true, currency: true },
      }).catch(() => null);
    }
    if (!original) {
      const link = await this.resolvePaypalInvoiceId(resource);
      if (link) {
        const inv = await this.prisma.client.invoice.findUnique({
          where: { id: link.invoiceId },
          select: { id: true, businessId: true, currency: true },
        });
        if (inv) original = { invoiceId: inv.id, businessId: inv.businessId, currency: inv.currency };
      }
    }
    if (!original) {
      this.logger.warn(`PayPal refund ${refundId} could not be linked to a local payment; skipping`);
      return;
    }

    const amount = Number(resource?.amount?.value ?? 0);
    const refundData = {
      provider: 'paypal',
      providerPaymentId: refundId,
      amount: -Math.abs(amount),
      currency: (resource?.amount?.currency_code || original.currency || 'USD').toUpperCase(),
      status: 'REFUNDED',
      invoiceId: original.invoiceId,
      businessId: original.businessId,
      reference: captureId ?? null,
      notes: resource?.note_to_payer ?? null,
    };
    const persisted = await (captureId
      ? this.createRefundWithPosting(captureId, refundData)
      : this.createRefundWithPostingByInvoice(original.invoiceId, refundData)
    ).catch((e) => {
      this.logger.warn(`Failed to persist PayPal refund ${refundId}: ${e instanceof Error ? e.message : e}`);
      return null;
    });
    if (persisted) {
      await this.invoiceWorkflow.reconcileFromPayments(original.invoiceId).catch((e) => {
        this.logger.warn(`PayPal refund reconcile failed for invoice ${original.invoiceId}: ${e instanceof Error ? e.message : e}`);
      });
    }
  }

  async getInvoicePaymentStatus(invoiceId: string) {
    return this.prisma.client.payment.findMany({
      where: { invoiceId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createWipayCheckout(invoiceId: string, returnUrl: string): Promise<{ redirectUrl: string }> {
    const invoice = await this.prisma.client.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        contact: { select: { firstName: true, lastName: true, email: true, phone: true } },
        business: { select: { id: true, metaData: true } },
      },
    });

    if (!invoice) throw new Error('Invoice not found');
    this.assertInvoicePayable(invoice.status, invoiceId);

    const meta = (invoice.business.metaData as Record<string, any>) || {};
    const developerId = meta.wipayApiKey || process.env.WIPAY_API_KEY || '1';
    const isSandbox = !meta.wipayApiKey && !process.env.WIPAY_API_KEY;

    const apiUrl = isSandbox
      ? 'https://sandbox.wipayfinancial.com/v1/gateway'
      : 'https://tt.wipayfinancial.com/v1/gateway_live';

    const contactName = invoice.contact
      ? `${invoice.contact.firstName || ''} ${invoice.contact.lastName || ''}`.trim()
      : 'Customer';
    const contactEmail = invoice.contact?.email || 'customer@example.com';
    const contactPhone = invoice.contact?.phone || '0000000000';

    const params = new URLSearchParams();
    params.append('total', invoice.total.toFixed(2));
    params.append('phone', contactPhone);
    params.append('email', contactEmail);
    params.append('name', contactName);
    params.append('order_id', invoiceId);
    params.append('return_url', returnUrl);
    params.append('developer_id', developerId);
    params.append('environment', isSandbox ? 'sandbox' : 'live');

    const accountNumber = meta.wipayAccountNumber || process.env.WIPAY_ACCOUNT_NUMBER;
    if (accountNumber) {
      params.append('account_number', accountNumber);
    }

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
      redirect: 'manual',
    });

    const locationHeader = response.headers.get('location');
    if (locationHeader) {
      return { redirectUrl: locationHeader };
    }

    const body = await response.text();

    const urlMatch = body.match(/https?:\/\/[^\s"'<>]+/);
    if (urlMatch) {
      return { redirectUrl: urlMatch[0] };
    }

    if (response.ok) {
      return { redirectUrl: `${apiUrl}?${params.toString()}` };
    }

    this.logger.error(`WiPay checkout creation failed: ${response.status} - ${body}`);
    throw new Error('Failed to create WiPay checkout');
  }

  async handleWipayCallback(queryParams: WipayCallbackParams): Promise<{ success: boolean; invoiceId?: string; message: string }> {
    const { transaction_id, order_id, status, total, hash } = queryParams;

    if (!order_id || !status) {
      return { success: false, message: 'Missing required callback parameters' };
    }

    const invoice = await this.prisma.client.invoice.findUnique({
      where: { id: order_id },
      include: { business: { select: { metaData: true } } },
    });

    let order: { id: string; businessId: string; currency: string; total: number; paymentStatus: string } | null = null;
    if (!invoice) {
      order = await this.prisma.client.marketplaceOrder.findUnique({
        where: { id: order_id },
        select: { id: true, businessId: true, currency: true, total: true, paymentStatus: true },
      });
      if (!order) {
        return { success: false, message: 'Invoice not found' };
      }
    }

    const businessId = invoice?.businessId ?? order!.businessId;

    // Signature verification is mandatory — a callback with no hash, or
    // missing the fields needed to compute one, is treated as forged. This
    // closes the previous loophole where hash was only checked when present.
    const isSuccessfulStatus = status === 'success' || status === '1';
    if (isSuccessfulStatus) {
      if (!hash || !transaction_id || !total) {
        this.logger.error(`WiPay callback missing signature fields for order ${order_id} — rejecting`);
        throw new BadRequestException('Invalid WiPay callback signature');
      }
      const expectedHash = createHash('md5')
        .update(`${transaction_id}${order_id}${total}${status}`)
        .digest('hex');
      if (hash !== expectedHash) {
        this.logger.error(`WiPay hash mismatch for order ${order_id} — rejecting callback`);
        throw new BadRequestException('Invalid WiPay callback signature');
      }
    } else if (hash && transaction_id && total) {
      // Failure callbacks: still verify when WiPay supplies the fields.
      const expectedHash = createHash('md5')
        .update(`${transaction_id}${order_id}${total}${status}`)
        .digest('hex');
      if (hash !== expectedHash) {
        this.logger.error(`WiPay hash mismatch on failure callback for order ${order_id} — rejecting`);
        throw new BadRequestException('Invalid WiPay callback signature');
      }
    }

    // Provider-event-id idempotency. WiPay's transaction_id uniquely
    // identifies a callback delivery; re-deliveries become no-ops. Failure
    // callbacks that arrive without a transaction_id are deduplicated by
    // order id so replayed failure notifications cannot accumulate junk rows.
    const wipayEventId = transaction_id || `wipay_fail_${order_id}`;
    const fresh = await this.invoiceWorkflow.assertNewProviderEvent(
      'wipay',
      wipayEventId,
      status,
      businessId,
    );
    if (!fresh) {
      return { success: true, invoiceId: order_id, message: 'Duplicate callback ignored' };
    }

    const isSuccessful = status === 'success' || status === '1';

    if (isSuccessful) {
      try {
        if (order) {
          // Storefront checkout path
          if (order.paymentStatus !== 'PAID' && this.storeOrderService) {
            await this.storeOrderService.updatePaymentStatus(order.id, 'PAID', transaction_id);
          }
          return { success: true, invoiceId: order_id, message: 'Payment successful' };
        }

        const existingPayment = await this.prisma.client.payment.findUnique({
          where: { providerPaymentId: transaction_id || `wipay_${order_id}_${Date.now()}` },
        });

        if (!existingPayment) {
          await this.createPaymentWithPosting({
            provider: 'wipay',
            providerPaymentId: transaction_id || `wipay_${order_id}_${Date.now()}`,
            amount: parseFloat(total || String(invoice!.total)),
            currency: invoice!.currency,
            status: 'SUCCESSFUL',
            invoiceId: order_id,
            businessId: invoice!.businessId,
          });

          await this.invoiceWorkflow.reconcileFromPayments(order_id).catch((e) => {
            this.logger.warn(`WiPay reconcile failed for invoice ${order_id}: ${e instanceof Error ? e.message : e}`);
          });

          this.wipayConnector?.emitPaymentReceived(invoice!.businessId, {
            amount: parseFloat(total || String(invoice!.total)),
            currency: invoice!.currency,
            invoiceId: order_id,
            externalId: transaction_id,
          }).catch((e) => this.logger.warn(`WiPay connector event emission failed: ${e.message}`));
        }

        return { success: true, invoiceId: order_id, message: 'Payment successful' };
      } catch (error: unknown) {
        const errMsg = error instanceof Error ? error.message : 'Unknown error';
        this.logger.error(`Failed to process WiPay payment for order ${order_id}: ${errMsg}`);
        return { success: false, invoiceId: order_id, message: 'Payment processing error' };
      }
    }

    try {
      if (order) {
        if (order.paymentStatus !== 'FAILED' && this.storeOrderService) {
          await this.storeOrderService.updatePaymentStatus(order.id, 'FAILED', transaction_id);
        }
      } else {
        await this.prisma.client.payment.create({
          data: {
            provider: 'wipay',
            providerPaymentId: transaction_id || `wipay_fail_${order_id}_${Date.now()}`,
            amount: parseFloat(total || String(invoice!.total)),
            currency: invoice!.currency,
            status: 'FAILED',
            invoiceId: order_id,
            businessId: invoice!.businessId,
          },
        });

        this.wipayConnector?.emitPaymentFailed(invoice!.businessId, {
          amount: parseFloat(total || String(invoice!.total)),
          currency: invoice!.currency,
          error: `WiPay payment status: ${status}`,
          invoiceId: order_id,
          externalId: transaction_id,
        }).catch((e) => this.logger.warn(`WiPay connector event emission failed: ${e.message}`));
      }
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to record failed WiPay payment: ${errMsg}`);
    }

    return { success: false, invoiceId: order_id, message: 'Payment was not successful' };
  }

  async getPaypalClientToken(): Promise<{ clientToken: string }> {
    const clientId = process.env.PAYPAL_CLIENT_ID;
    if (!clientId) {
      throw new Error('PayPal is not configured');
    }
    return { clientToken: clientId };
  }

  async createPaypalOrder(invoiceId: string): Promise<{ orderId: string }> {
    const invoice = await this.prisma.client.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        business: { select: { id: true, metaData: true, name: true } },
        items: true,
      },
    });

    if (!invoice) throw new Error('Invoice not found');
    this.assertInvoicePayable(invoice.status, invoiceId);

    const meta = (invoice.business.metaData as Record<string, any>) || {};
    const paypalClientId = meta.paypalClientId || process.env.PAYPAL_CLIENT_ID;
    const paypalClientSecret = meta.paypalClientSecret || process.env.PAYPAL_CLIENT_SECRET;

    const paypal = this.getPaypalClient(paypalClientId, paypalClientSecret);
    if (!paypal) throw new Error('PayPal is not configured');

    try {
      const { result } = await paypal.ordersController.createOrder({
        body: {
          intent: CheckoutPaymentIntent.Capture,
          purchaseUnits: [
            {
              referenceId: invoiceId,
              customId: invoiceId,
              description: `Invoice ${invoice.invoiceNumber} - ${invoice.business.name}`,
              amount: {
                currencyCode: invoice.currency === 'USD' ? 'USD' : 'USD',
                value: invoice.total.toFixed(2),
              },
            },
          ],
        },
        prefer: 'return=representation',
      });

      if (!result.id) throw new Error('PayPal order creation returned no ID');

      return { orderId: result.id };
    } catch (error: any) {
      this.logger.error(`PayPal order creation failed: ${error.message}`, error.stack);
      throw new Error('Failed to create PayPal order', { cause: error });
    }
  }

  async createStorePayment(input: {
    orderId: string;
    amount: number;
    currency: string;
    method: string;
    businessId: string;
    returnUrl?: string;
  }): Promise<{ paymentId?: string; redirectUrl?: string; status: string }> {
    if (input.method === 'CASH' || input.method === 'MANUAL') {
      const payment = await this.prisma.client.payment.create({
        data: {
          provider: 'manual',
          providerPaymentId: `manual_${input.orderId}_${Date.now()}`,
          amount: input.amount,
          currency: input.currency,
          status: 'PENDING',
          method: input.method.toLowerCase(),
          invoiceId: input.orderId,
          businessId: input.businessId,
        },
      });
      return { paymentId: payment.id, status: 'PENDING_PAYMENT' };
    }

    if (input.method === 'WIPAY') {
      const business = await this.prisma.client.business.findUnique({
        where: { id: input.businessId },
        select: { metaData: true },
      });
      const meta = (business?.metaData as Record<string, any>) || {};
      const developerId = meta.wipayApiKey || process.env.WIPAY_API_KEY || '1';
      const isSandbox = !meta.wipayApiKey && !process.env.WIPAY_API_KEY;
      const apiUrl = isSandbox
        ? 'https://sandbox.wipayfinancial.com/v1/gateway'
        : 'https://tt.wipayfinancial.com/v1/gateway_live';

      const params = new URLSearchParams();
      params.append('total', input.amount.toFixed(2));
      params.append('phone', '0000000000');
      params.append('email', 'customer@store.com');
      params.append('name', 'Store Customer');
      params.append('order_id', input.orderId);
      params.append('return_url', input.returnUrl || '');
      params.append('developer_id', developerId);
      params.append('environment', isSandbox ? 'sandbox' : 'live');

      const accountNumber = meta.wipayAccountNumber || process.env.WIPAY_ACCOUNT_NUMBER;
      if (accountNumber) params.append('account_number', accountNumber);

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
        redirect: 'manual',
      });

      const locationHeader = response.headers.get('location');
      if (locationHeader) {
        return { status: 'REDIRECT', redirectUrl: locationHeader };
      }

      const body = await response.text();
      const urlMatch = body.match(/https?:\/\/[^\s"'<>]+/);
      if (urlMatch) {
        return { status: 'REDIRECT', redirectUrl: urlMatch[0] };
      }

      if (response.ok) {
        return { status: 'REDIRECT', redirectUrl: `${apiUrl}?${params.toString()}` };
      }

      this.logger.error(`WiPay store checkout failed: ${response.status} - ${body}`);
      throw new Error('Failed to create WiPay checkout');
    }

    if (input.method === 'STRIPE') {
      const business = await this.prisma.client.business.findUnique({
        where: { id: input.businessId },
        select: { id: true, name: true, metaData: true },
      });
      if (!business) throw new BadRequestException('Business not found');

      const meta = (business.metaData as Record<string, any>) || {};
      const secretKey = meta.stripeSecretKey || process.env.STRIPE_SECRET_KEY;
      if (!secretKey) throw new BadRequestException('Stripe is not configured for this business');

      const allowed = (process.env.PUBLIC_URL_ALLOWLIST || process.env.NEXT_PUBLIC_BASE_URL || '')
        .split(',').map((s) => s.trim()).filter(Boolean)
        .map((s) => s.startsWith('http') ? s : `https://${s}`);
      if (allowed.length === 0) {
        this.logger.error('No PUBLIC_URL_ALLOWLIST configured; rejecting Stripe store checkout for safety');
        throw new BadRequestException('Server misconfigured: no allowed return-URL origins set');
      }
      const isAllowedUrl = (u: string): boolean => {
        try {
          const parsed = new URL(u);
          if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
          return allowed.some((a) => {
            try { return new URL(a).origin === parsed.origin; } catch { return false; }
          });
        } catch { return false; }
      };
      if (input.returnUrl && !isAllowedUrl(input.returnUrl)) {
        throw new BadRequestException('Invalid return URL');
      }

      const currency = (input.currency || 'USD').toLowerCase();
      const amountCents = Math.round(input.amount * 100);

      const body = new URLSearchParams();
      body.append('mode', 'payment');
      body.append('client_reference_id', input.orderId);
      body.append('metadata[orderId]', input.orderId);
      body.append('metadata[businessId]', business.id);
      body.append('line_items[0][quantity]', '1');
      body.append('line_items[0][price_data][currency]', currency);
      body.append('line_items[0][price_data][unit_amount]', String(amountCents));
      body.append('line_items[0][price_data][product_data][name]', `Store Order — ${business.name || ''}`.trim());
      if (input.returnUrl) {
        body.append('success_url', input.returnUrl);
        body.append('cancel_url', input.returnUrl);
      }

      const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${secretKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      });

      const json = await res.json().catch(() => ({ error: { message: 'Invalid Stripe response' } }));
      if (!res.ok) {
        this.logger.error(`Stripe store checkout failed: ${json.error?.message || res.statusText}`);
        throw new BadRequestException(json.error?.message || 'Stripe checkout creation failed');
      }
      if (!json.url) {
        this.logger.error('Stripe store checkout returned no redirect URL');
        throw new BadRequestException('Stripe checkout creation failed: no redirect URL');
      }

      await this.prisma.client.payment.create({
        data: {
          provider: 'stripe',
          providerPaymentId: json.id,
          amount: input.amount,
          currency: input.currency,
          status: 'PENDING',
          method: 'stripe',
          invoiceId: input.orderId,
          businessId: input.businessId,
        },
      });

      return { paymentId: json.id, status: 'REDIRECT', redirectUrl: json.url };
    }

    if (input.method === 'PAYPAL') {
      const business = await this.prisma.client.business.findUnique({
        where: { id: input.businessId },
        select: { metaData: true, name: true },
      });
      const meta = (business?.metaData as Record<string, any>) || {};
      const paypalClientId = meta.paypalClientId || process.env.PAYPAL_CLIENT_ID;
      const paypalClientSecret = meta.paypalClientSecret || process.env.PAYPAL_CLIENT_SECRET;
      const paypal = this.getPaypalClient(paypalClientId, paypalClientSecret);
      if (!paypal) throw new Error('PayPal is not configured');

      const { result } = await paypal.ordersController.createOrder({
        body: {
          intent: CheckoutPaymentIntent.Capture,
          purchaseUnits: [
            {
              referenceId: input.orderId,
              customId: input.orderId,
              description: `Store Order - ${business?.name ?? 'Store'}`,
              amount: {
                currencyCode: input.currency === 'USD' ? 'USD' : 'USD',
                value: input.amount.toFixed(2),
              },
            },
          ],
        },
        prefer: 'return=representation',
      });

      if (!result.id) throw new Error('PayPal order creation returned no ID');

      const links = result.links as Array<{ href: string; rel: string; method?: string }> | undefined;
      const approveLink = links?.find(
        (l) => l.rel === 'approve' || l.rel === 'payer-action',
      );
      if (approveLink?.href) {
        return { paymentId: result.id, status: 'REDIRECT', redirectUrl: approveLink.href };
      }

      return { paymentId: result.id, status: 'PAYPAL_AWAITING_APPROVAL' };
    }

    throw new BadRequestException(`Unsupported payment method: ${input.method}`);
  }

  async capturePaypalOrder(orderId: string, invoiceId: string): Promise<any> {
    const invoice = await this.prisma.client.invoice.findUnique({
      where: { id: invoiceId },
      include: { business: { select: { id: true, metaData: true } } },
    });

    if (!invoice) throw new Error('Invoice not found');
    this.assertInvoicePayable(invoice.status, invoiceId);

    const meta = (invoice.business.metaData as Record<string, any>) || {};
    const paypalClientId = meta.paypalClientId || process.env.PAYPAL_CLIENT_ID;
    const paypalClientSecret = meta.paypalClientSecret || process.env.PAYPAL_CLIENT_SECRET;

    const paypal = this.getPaypalClient(paypalClientId, paypalClientSecret);
    if (!paypal) throw new Error('PayPal is not configured');

    try {
      const { result } = await paypal.ordersController.captureOrder({
        id: orderId,
        prefer: 'return=representation',
      });

      if (result.status === 'COMPLETED') {
        const captureId = result.purchaseUnits?.[0]?.payments?.captures?.[0]?.id || orderId;

        await this.prisma.client.payment.create({
          data: {
            provider: 'paypal',
            providerPaymentId: captureId,
            amount: invoice.total,
            currency: invoice.currency,
            status: 'SUCCESSFUL',
            invoiceId,
            businessId: invoice.businessId,
          },
        });

        await this.invoiceWorkflow.reconcileFromPayments(invoiceId).catch((e) => {
          this.logger.warn(`PayPal capture reconcile failed for invoice ${invoiceId}: ${e instanceof Error ? e.message : e}`);
        });

        const payer = result.payer as { emailAddress?: string; name?: { givenName?: string; surname?: string } } | undefined;
        this.paypalConnector?.emitPaymentReceived(invoice.businessId, {
          amount: Number(invoice.total),
          currency: invoice.currency,
          invoiceId,
          payerEmail: payer?.emailAddress,
          payerName: payer?.name ? `${payer.name.givenName ?? ''} ${payer.name.surname ?? ''}`.trim() : undefined,
          externalId: captureId,
        }).catch((e) => this.logger.warn(`PayPal connector event emission failed: ${e.message}`));
      }

      return {
        id: result.id,
        status: result.status,
        payer: result.payer,
      };
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`PayPal capture failed for order ${orderId}: ${errMsg}`);

      try {
        await this.prisma.client.payment.create({
          data: {
            provider: 'paypal',
            providerPaymentId: `paypal_fail_${orderId}_${Date.now()}`,
            amount: invoice.total,
            currency: invoice.currency,
            status: 'FAILED',
            invoiceId,
            businessId: invoice.businessId,
          },
        });

        this.paypalConnector?.emitPaymentFailed(invoice.businessId, {
          amount: Number(invoice.total),
          currency: invoice.currency,
          error: errMsg,
          invoiceId,
          externalId: orderId,
        }).catch((e) => this.logger.warn(`PayPal connector event emission failed: ${e.message}`));
      } catch (recordError: unknown) {
        const recErrMsg = recordError instanceof Error ? recordError.message : 'Unknown error';
        this.logger.error(`Failed to record failed PayPal payment: ${recErrMsg}`);
      }

      throw new Error('Failed to capture PayPal order', { cause: error });
    }
  }

  private async createInvoiceCheckout(
    invoiceId: string,
    gateway: 'stripe' | 'paypal' | 'wipay',
    returnUrl?: string,
    successUrl?: string,
    cancelUrl?: string,
  ): Promise<{ type: 'redirect'; redirectUrl: string } | { type: 'paypal_order'; orderId: string }> {
    if (gateway === 'stripe') {
      if (!successUrl || !cancelUrl) {
        throw new BadRequestException('Stripe checkout requires successUrl and cancelUrl');
      }
      const { redirectUrl } = await this.createStripeCheckout(invoiceId, successUrl, cancelUrl);
      return { type: 'redirect', redirectUrl };
    }
    if (gateway === 'wipay') {
      if (!returnUrl) {
        throw new BadRequestException('WiPay checkout requires returnUrl');
      }
      const { redirectUrl } = await this.createWipayCheckout(invoiceId, returnUrl);
      return { type: 'redirect', redirectUrl };
    }
    if (gateway === 'paypal') {
      const { orderId } = await this.createPaypalOrder(invoiceId);
      return { type: 'paypal_order', orderId };
    }
    throw new BadRequestException(`Unsupported gateway: ${gateway}`);
  }

  private async resolveMassCommInvoiceId(invoiceId: string): Promise<string> {
    const invoice = await this.prisma.client.invoice.findUnique({
      where: { id: invoiceId },
      select: { status: true, campaignId: true },
    });
    if (!invoice) throw new BadRequestException('Mass-communication invoice not found');
    if (!invoice.campaignId) {
      throw new BadRequestException('Invoice is not linked to a mass-communication campaign');
    }
    this.assertInvoicePayable(invoice.status, invoiceId);
    return invoiceId;
  }

  /**
   * Unified checkout entry-point for any supported payable.
   * Supports invoices, storefront orders, event tickets (via their linked
   * invoice), and mass-communication campaign invoices.
   */
  async createGenericCheckout(input: {
    payableType: 'invoice' | 'storefront_order' | 'event_ticket' | 'mass_comm';
    payableId: string;
    gateway: 'stripe' | 'paypal' | 'wipay';
    returnUrl?: string;
    successUrl?: string;
    cancelUrl?: string;
  }): Promise<{ type: 'redirect'; redirectUrl: string } | { type: 'paypal_order'; orderId: string }> {
    if (input.payableType === 'invoice' || input.payableType === 'mass_comm') {
      const invoiceId =
        input.payableType === 'mass_comm'
          ? await this.resolveMassCommInvoiceId(input.payableId)
          : input.payableId;
      return this.createInvoiceCheckout(
        invoiceId,
        input.gateway,
        input.returnUrl,
        input.successUrl,
        input.cancelUrl,
      );
    }

    if (input.payableType === 'storefront_order') {
      const order = await this.prisma.client.marketplaceOrder.findUnique({
        where: { id: input.payableId },
        select: { id: true, businessId: true, total: true, currency: true, paymentStatus: true, status: true },
      });
      if (!order) throw new BadRequestException('Storefront order not found');
      if (order.paymentStatus === 'PAID' || order.status === 'CANCELLED') {
        throw new BadRequestException('Storefront order is already paid or cancelled');
      }
      const result = await this.createStorePayment({
        orderId: order.id,
        amount: order.total,
        currency: order.currency,
        method: input.gateway.toUpperCase(),
        businessId: order.businessId,
        returnUrl: input.returnUrl || input.successUrl,
      });
      if (result.redirectUrl) {
        return { type: 'redirect', redirectUrl: result.redirectUrl };
      }
      if (input.gateway === 'paypal' && result.paymentId) {
        return { type: 'paypal_order', orderId: result.paymentId };
      }
      throw new BadRequestException('Unable to create storefront checkout');
    }

    if (input.payableType === 'event_ticket') {
      const attendee = await this.prisma.client.eventAttendee.findUnique({
        where: { id: input.payableId },
        include: { ticketType: true },
      });
      if (!attendee) throw new BadRequestException('Event attendee not found');
      if (!attendee.paymentId) {
        throw new BadRequestException('Attendee does not have a payable invoice');
      }
      return this.createInvoiceCheckout(
        attendee.paymentId,
        input.gateway,
        input.returnUrl,
        input.successUrl,
        input.cancelUrl,
      );
    }

    throw new BadRequestException(`Unsupported payable type: ${input.payableType}`);
  }
}
