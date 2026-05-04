import { BadRequestException, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CommerceService } from '../commerce/commerce.service';
import { WiPayConnector } from '../../core/connectors/implementations/wipay.connector';
import { PayPalConnector } from '../../core/connectors/implementations/paypal.connector';
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
    @Optional() @Inject(WiPayConnector) private readonly wipayConnector?: WiPayConnector,
    @Optional() @Inject(PayPalConnector) private readonly paypalConnector?: PayPalConnector,
  ) {}

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

    const stripePub = meta.stripePublishableKey || process.env.STRIPE_PUBLISHABLE_KEY;
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
    if (invoice.status === 'PAID') throw new BadRequestException('Invoice is already paid');

    const meta = (invoice.business.metaData as Record<string, any>) || {};
    const secretKey = meta.stripeSecretKey || process.env.STRIPE_SECRET_KEY;
    if (!secretKey) throw new BadRequestException('Stripe is not configured for this business');

    const allowed = (process.env.PUBLIC_URL_ALLOWLIST || process.env.NEXT_PUBLIC_BASE_URL || process.env.REPLIT_DEV_DOMAIN || '')
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
  ): Promise<{ ok: true; received?: boolean }> {
    if (!rawPayload) throw new BadRequestException('Missing Stripe webhook payload');

    let event: { id?: string; type?: string; data?: { object?: any } };
    try {
      event = JSON.parse(rawPayload);
    } catch {
      throw new BadRequestException('Invalid Stripe webhook payload');
    }

    const obj = event.data?.object || {};
    const invoiceId: string | undefined =
      obj?.metadata?.invoiceId || obj?.client_reference_id;
    if (!invoiceId) {
      this.logger.warn('Stripe webhook missing invoiceId in metadata; ignoring');
      return { ok: true, received: false };
    }

    const invoice = await this.prisma.client.invoice.findUnique({
      where: { id: invoiceId },
      include: { business: { select: { id: true, metaData: true } } },
    });
    if (!invoice) throw new BadRequestException('Invoice not found for webhook');

    const meta = (invoice.business.metaData as Record<string, any>) || {};
    const webhookSecret =
      meta.stripeWebhookSecret || process.env.STRIPE_WEBHOOK_SECRET;

    if (!webhookSecret) {
      this.logger.error('Stripe webhook secret not configured; rejecting webhook');
      throw new BadRequestException('Stripe webhook secret not configured');
    }
    if (!signatureHeader || !this.verifyStripeSignature(rawPayload, signatureHeader, webhookSecret)) {
      this.logger.warn(`Stripe webhook signature verification failed for invoice ${invoiceId}`);
      throw new BadRequestException('Invalid Stripe webhook signature');
    }

    if (event.type !== 'checkout.session.completed') {
      return { ok: true, received: true };
    }

    if (invoice.status === 'PAID') {
      return { ok: true, received: true };
    }

    const providerPaymentId: string = obj.id || event.id || `stripe_${invoiceId}_${Date.now()}`;
    const existing = await this.prisma.client.payment.findUnique({
      where: { providerPaymentId },
    }).catch(() => null);
    if (existing) {
      return { ok: true, received: true };
    }
    const existingForInvoice = await this.prisma.client.payment.findFirst({
      where: { invoiceId, provider: 'stripe', status: 'SUCCESSFUL' },
    });
    if (existingForInvoice) {
      return { ok: true, received: true };
    }

    const amountMinor: number = obj.amount_total ?? obj.amount_received ?? 0;
    const amount = amountMinor / 100;
    const currency = (obj.currency || invoice.currency || 'USD').toUpperCase();
    const expectedAmount = Number(invoice.total);

    if (currency !== invoice.currency.toUpperCase()) {
      this.logger.warn(
        `Stripe webhook currency mismatch for invoice ${invoiceId}: got ${currency}, expected ${invoice.currency}`,
      );
      throw new BadRequestException('Stripe webhook currency mismatch');
    }
    if (Math.abs(amount - expectedAmount) > 0.01) {
      this.logger.warn(
        `Stripe webhook amount mismatch for invoice ${invoiceId}: got ${amount}, expected ${expectedAmount}`,
      );
      throw new BadRequestException('Stripe webhook amount mismatch');
    }

    await this.prisma.client.payment.create({
      data: {
        provider: 'stripe',
        providerPaymentId,
        amount,
        currency,
        status: 'SUCCESSFUL',
        invoiceId,
        businessId: invoice.businessId,
      },
    });
    await this.commerceService.markInvoicePaid(invoiceId);

    return { ok: true, received: true };
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
    if (invoice.status === 'PAID') throw new Error('Invoice is already paid');

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

    if (!invoice) {
      return { success: false, message: 'Invoice not found' };
    }

    if (hash && transaction_id && total) {
      const expectedHash = createHash('md5')
        .update(`${transaction_id}${order_id}${total}${status}`)
        .digest('hex');
      if (hash !== expectedHash) {
        this.logger.warn(`WiPay hash mismatch for order ${order_id}`);
      }
    }

    const isSuccessful = status === 'success' || status === '1';

    if (isSuccessful) {
      try {
        const existingPayment = await this.prisma.client.payment.findUnique({
          where: { providerPaymentId: transaction_id || `wipay_${order_id}_${Date.now()}` },
        });

        if (!existingPayment) {
          await this.prisma.client.payment.create({
            data: {
              provider: 'wipay',
              providerPaymentId: transaction_id || `wipay_${order_id}_${Date.now()}`,
              amount: parseFloat(total || String(invoice.total)),
              currency: invoice.currency,
              status: 'SUCCESSFUL',
              invoiceId: order_id,
              businessId: invoice.businessId,
            },
          });

          await this.commerceService.markInvoicePaid(order_id);

          this.wipayConnector?.emitPaymentReceived(invoice.businessId, {
            amount: parseFloat(total || String(invoice.total)),
            currency: invoice.currency,
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
      await this.prisma.client.payment.create({
        data: {
          provider: 'wipay',
          providerPaymentId: transaction_id || `wipay_fail_${order_id}_${Date.now()}`,
          amount: parseFloat(total || String(invoice.total)),
          currency: invoice.currency,
          status: 'FAILED',
          invoiceId: order_id,
          businessId: invoice.businessId,
        },
      });

      this.wipayConnector?.emitPaymentFailed(invoice.businessId, {
        amount: parseFloat(total || String(invoice.total)),
        currency: invoice.currency,
        error: `WiPay payment status: ${status}`,
        invoiceId: order_id,
        externalId: transaction_id,
      }).catch((e) => this.logger.warn(`WiPay connector event emission failed: ${e.message}`));
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
    if (invoice.status === 'PAID') throw new Error('Invoice is already paid');

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
      throw new Error('Failed to create PayPal order');
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
    if (invoice.status === 'PAID') throw new Error('Invoice is already paid');

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

        await this.commerceService.markInvoicePaid(invoiceId);

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

      throw new Error('Failed to capture PayPal order');
    }
  }
}
