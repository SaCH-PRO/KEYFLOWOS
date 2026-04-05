import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CommerceService } from '../commerce/commerce.service';
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

    return gateways;
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
        }

        return { success: true, invoiceId: order_id, message: 'Payment successful' };
      } catch (error: any) {
        this.logger.error(`Failed to process WiPay payment for order ${order_id}: ${error.message}`, error.stack);
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
    } catch (error: any) {
      this.logger.error(`Failed to record failed WiPay payment: ${error.message}`);
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
      }

      return {
        id: result.id,
        status: result.status,
        payer: result.payer,
      };
    } catch (error: any) {
      this.logger.error(`PayPal capture failed for order ${orderId}: ${error.message}`, error.stack);

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
      } catch (recordError: any) {
        this.logger.error(`Failed to record failed PayPal payment: ${recordError.message}`);
      }

      throw new Error('Failed to capture PayPal order');
    }
  }
}
