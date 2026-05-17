import { Injectable, Inject, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { EntityResolutionService } from '../entity-resolution.service';
import { IConnector, ConnectorMeta, ConnectorHealth, ConnectorSyncResult, ConnectorStatusSummary, ConnectorSmokeResult } from '../connector.interface';
import { GatewayNotSupportedError, IPaymentGatewayConnector, PaymentGatewayTransaction, PaymentLinkInput, PaymentLinkResult, RefundInput, RefundResult } from '../payment-gateway.interface';

@Injectable()
export class PayPalConnector implements IConnector, IPaymentGatewayConnector {
  private readonly logger = new Logger(PayPalConnector.name);

  readonly meta: ConnectorMeta = {
    type: 'paypal',
    name: 'PayPal',
    description: 'Accept international card payments via PayPal',
    category: 'payment',
    group: 'payments',
    icon: 'credit-card',
    supportsSync: false,
    supportsWebhook: true,
    authType: 'credentials',
    externalUrl: 'https://www.paypal.com/businessmanage/account/aboutBusiness',
  };

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
    @Inject(EntityResolutionService) private readonly entityResolution: EntityResolutionService,
  ) {}

  async authenticate(businessId: string): Promise<{ connected: boolean; authUrl?: string }> {
    const connected = await this.isConnected(businessId);
    return { connected };
  }

  async healthCheck(businessId: string): Promise<ConnectorHealth> {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { metaData: true },
    });
    const meta = (business?.metaData as Record<string, unknown>) ?? {};
    const hasPayPal = !!(meta.paypalClientId || process.env.PAYPAL_CLIENT_ID) &&
                      !!(meta.paypalClientSecret || process.env.PAYPAL_CLIENT_SECRET);
    const realStatus = hasPayPal ? 'connected' : 'disconnected';

    const stored = await this.getConnectorStatus(businessId);
    return {
      status: realStatus,
      lastSyncAt: stored?.lastSyncAt ?? null,
      lastErrorAt: stored?.lastErrorAt ?? null,
      lastError: stored?.lastError ?? null,
      errorCount: stored?.errorCount ?? 0,
      syncCount: stored?.syncCount ?? 0,
      connectedAt: stored?.connectedAt ?? null,
      connectedAccount: hasPayPal ? (stored?.connectedAccount ?? 'PayPal Business') : null,
    };
  }

  async getStatus(businessId: string): Promise<ConnectorStatusSummary> {
    const health = await this.healthCheck(businessId);
    return {
      type: this.meta.type,
      name: this.meta.name,
      category: this.meta.category,
      status: health.status,
      connectedAccount: health.connectedAccount,
    };
  }

  async isConnected(businessId: string): Promise<boolean> {
    const health = await this.healthCheck(businessId);
    return health.status === 'connected';
  }

  async sync(businessId: string): Promise<ConnectorSyncResult> {
    const start = Date.now();
    const connected = await this.isConnected(businessId);
    if (!connected) {
      return { success: false, itemsSynced: 0, errors: ['PayPal not connected'], duration: Date.now() - start };
    }

    const recentPayments = await this.prisma.client.payment.count({
      where: { businessId, method: 'PAYPAL' },
    }).catch(() => 0);

    return { success: true, itemsSynced: recentPayments, errors: [], duration: Date.now() - start };
  }

  async smokeTest(businessId: string): Promise<ConnectorSmokeResult> {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { metaData: true },
    });
    const meta = (business?.metaData as Record<string, unknown>) ?? {};
    const clientId = (meta.paypalClientId as string | undefined) || process.env.PAYPAL_CLIENT_ID;
    const clientSecret = (meta.paypalClientSecret as string | undefined) || process.env.PAYPAL_CLIENT_SECRET;
    if (!clientId || !clientSecret) return { success: false, error: 'PayPal client ID/secret not configured' };
    const isSandbox = !!(meta.paypalSandbox ?? process.env.PAYPAL_SANDBOX);
    const base = isSandbox ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';
    try {
      const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
      const tokenRes = await fetch(`${base}/v1/oauth2/token`, {
        method: 'POST',
        headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=client_credentials',
      });
      if (!tokenRes.ok) {
        const body = await tokenRes.text().catch(() => '');
        return { success: false, error: `PayPal /v1/oauth2/token ${tokenRes.status}${body ? `: ${body}` : ''}` };
      }
      const token = (await tokenRes.json()) as { access_token?: string; app_id?: string; expires_in?: number };
      if (!token.access_token) return { success: false, error: 'PayPal returned no access token' };
      const userRes = await fetch(`${base}/v1/identity/oauth2/userinfo?schema=paypalv1.1`, {
        headers: { Authorization: `Bearer ${token.access_token}`, Accept: 'application/json' },
      });
      if (!userRes.ok) {
        const body = await userRes.text().catch(() => '');
        return { success: false, error: `PayPal /v1/identity/oauth2/userinfo ${userRes.status}${body ? `: ${body}` : ''}` };
      }
      const user = (await userRes.json()) as { name?: string; email?: string; payer_id?: string };
      await this.trackActivity(businessId);
      return {
        success: true,
        action: 'Fetched PayPal account profile',
        account: user.email ?? user.name ?? user.payer_id ?? token.app_id ?? clientId,
        detail: `${isSandbox ? 'Sandbox' : 'Live'}${user.payer_id ? ` • payer ${user.payer_id}` : ''}`,
      };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Network error' };
    }
  }

  async disconnect(businessId: string): Promise<void> {
    await this.prisma.client.connectorStatus.upsert({
      where: { businessId_connectorType: { businessId, connectorType: 'paypal' } },
      create: { businessId, connectorType: 'paypal', status: 'disconnected' },
      update: { status: 'disconnected' },
    });
  }

  async emitPaymentReceived(businessId: string, opts: { amount: number; currency: string; invoiceId?: string; payerEmail?: string; payerName?: string; externalId?: string }) {
    await this.trackActivity(businessId);

    let contactId: string | undefined;

    if (opts.payerEmail) {
      const resolved = await this.entityResolution.resolveContact(businessId, {
        source: 'paypal',
        externalId: opts.externalId,
        email: opts.payerEmail,
        firstName: opts.payerName?.split(' ')[0],
        lastName: opts.payerName?.split(' ').slice(1).join(' ') || undefined,
      });
      contactId = resolved.contactId;

      this.events.emit('entity.resolved', {
        businessId,
        contactId: resolved.contactId,
        source: 'paypal',
        matchedOn: resolved.matchedOn,
        isNew: resolved.isNew,
        merged: resolved.merged,
      });
    }

    this.events.emit('payment.received', {
      connectorType: 'paypal' as const,
      externalId: opts.externalId ?? null,
      businessId,
      timestamp: new Date(),
      amount: opts.amount,
      currency: opts.currency,
      provider: 'paypal',
      invoiceId: opts.invoiceId,
      contactId,
    });
  }

  async emitPaymentFailed(businessId: string, opts: { amount: number; currency: string; error: string; invoiceId?: string; externalId?: string }) {
    await this.trackError(businessId, opts.error);

    this.events.emit('payment.failed', {
      connectorType: 'paypal' as const,
      externalId: opts.externalId ?? null,
      businessId,
      timestamp: new Date(),
      amount: opts.amount,
      currency: opts.currency,
      provider: 'paypal',
      error: opts.error,
      invoiceId: opts.invoiceId,
    });
  }

  private async trackActivity(businessId: string) {
    await this.prisma.client.connectorStatus.upsert({
      where: { businessId_connectorType: { businessId, connectorType: 'paypal' } },
      create: { businessId, connectorType: 'paypal', status: 'connected', lastSyncAt: new Date(), syncCount: 1 },
      update: { lastSyncAt: new Date(), syncCount: { increment: 1 }, status: 'connected' },
    }).catch((e) => this.logger.warn(`Failed to track paypal activity: ${e instanceof Error ? e.message : String(e)}`));
  }

  private async trackError(businessId: string, error: string) {
    await this.prisma.client.connectorStatus.upsert({
      where: { businessId_connectorType: { businessId, connectorType: 'paypal' } },
      create: { businessId, connectorType: 'paypal', status: 'error', lastErrorAt: new Date(), lastError: error, errorCount: 1 },
      update: { lastErrorAt: new Date(), lastError: error, errorCount: { increment: 1 } },
    }).catch((e) => this.logger.warn(`Failed to track paypal error: ${e instanceof Error ? e.message : String(e)}`));
  }

  private async getConnectorStatus(businessId: string) {
    return this.prisma.client.connectorStatus.findUnique({
      where: { businessId_connectorType: { businessId, connectorType: 'paypal' } },
    });
  }

  private async getCreds(businessId: string): Promise<{ clientId: string; clientSecret: string; sandbox: boolean }> {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { metaData: true },
    });
    const meta = (business?.metaData as Record<string, unknown>) ?? {};
    const clientId = (meta.paypalClientId as string | undefined) || process.env.PAYPAL_CLIENT_ID;
    const clientSecret = (meta.paypalClientSecret as string | undefined) || process.env.PAYPAL_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new Error('PayPal is not configured for this business');
    const sandbox = !!(meta.paypalSandbox ?? process.env.PAYPAL_SANDBOX);
    return { clientId, clientSecret, sandbox };
  }

  private async getAccessToken(creds: { clientId: string; clientSecret: string; sandbox: boolean }): Promise<string> {
    const base = creds.sandbox ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';
    const auth = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64');
    const res = await fetch(`${base}/v1/oauth2/token`, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`PayPal auth failed: ${res.status}${text ? `: ${text.slice(0, 160)}` : ''}`);
    }
    const data = (await res.json()) as { access_token?: string };
    if (!data.access_token) throw new Error('PayPal returned no access token');
    return data.access_token;
  }

  async listRecentTransactions(businessId: string, limit = 50): Promise<PaymentGatewayTransaction[]> {
    const payments = await this.prisma.client.payment.findMany({
      where: { businessId, provider: 'paypal' },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 100),
      include: { invoice: { select: { id: true, contact: { select: { firstName: true, lastName: true, email: true } } } } },
    }).catch(() => [] as Array<{
      id: string; amount: number; currency: string; status: string; provider: string;
      providerPaymentId: string; createdAt: Date; invoiceId: string;
      invoice: { id: string; contact: { firstName: string | null; lastName: string | null; email: string | null } | null } | null;
    }>);
    return payments.map((p) => {
      const contact = p.invoice?.contact;
      const name = contact ? `${contact.firstName ?? ''} ${contact.lastName ?? ''}`.trim() || null : null;
      return {
        id: p.providerPaymentId || p.id,
        provider: 'paypal' as const,
        type: (p.status === 'REFUNDED' ? 'refund' : 'charge') as 'charge' | 'refund',
        status: p.status.toLowerCase(),
        amount: Number(p.amount),
        currency: p.currency,
        customerName: name,
        customerEmail: contact?.email ?? null,
        description: p.invoice?.id ? `Invoice ${p.invoice.id}` : null,
        invoiceId: p.invoiceId ?? null,
        externalUrl: 'https://www.paypal.com/activity/payment/' + (p.providerPaymentId || ''),
        createdAt: p.createdAt,
      };
    });
  }

  async createPaymentLink(businessId: string, input: PaymentLinkInput): Promise<PaymentLinkResult> {
    const creds = await this.getCreds(businessId);
    const token = await this.getAccessToken(creds);
    const base = creds.sandbox ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';
    const res = await fetch(`${base}/v2/checkout/orders`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [
          {
            description: input.description.slice(0, 127),
            amount: { currency_code: input.currency.toUpperCase(), value: input.amount.toFixed(2) },
          },
        ],
        application_context: {
          brand_name: 'Keyflow',
          user_action: 'PAY_NOW',
        },
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`PayPal order creation failed: ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`);
    }
    const order = (await res.json()) as {
      id: string; status: string;
      links?: Array<{ href: string; rel: string }>;
    };
    const approve = order.links?.find((l) => l.rel === 'approve' || l.rel === 'payer-action');
    if (!approve?.href) throw new Error('PayPal did not return an approval URL');
    await this.trackActivity(businessId);
    return {
      id: order.id,
      url: approve.href,
      provider: 'paypal',
      amount: input.amount,
      currency: input.currency.toUpperCase(),
      description: input.description,
      active: order.status === 'CREATED' || order.status === 'PAYER_ACTION_REQUIRED',
      createdAt: new Date(),
    };
  }

  async listPaymentLinks(_businessId: string): Promise<PaymentLinkResult[]> {
    // PayPal Orders API doesn't offer a list endpoint for app-created orders.
    return [];
  }

  async revokePaymentLink(_businessId: string, _linkId: string): Promise<void> {
    throw new GatewayNotSupportedError('paypal', 'Revoke payment link');
  }

  async refundCharge(businessId: string, input: RefundInput): Promise<RefundResult> {
    const creds = await this.getCreds(businessId);
    const token = await this.getAccessToken(creds);
    const base = creds.sandbox ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';
    const body: Record<string, unknown> = {};
    if (input.amount !== undefined) {
      let captureCurrency = 'USD';
      try {
        const capRes = await fetch(`${base}/v2/payments/captures/${input.chargeId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (capRes.ok) {
          const cap = (await capRes.json()) as { amount?: { currency_code?: string } };
          if (cap.amount?.currency_code) captureCurrency = cap.amount.currency_code.toUpperCase();
        }
      } catch (err) {
          this.logger.debug(`Fall back to USD if capture lookup fails: ${err instanceof Error ? err.message : err}`);
        }
      body.amount = { value: input.amount.toFixed(2), currency_code: captureCurrency };
    }
    if (input.reason) body.note_to_payer = input.reason.slice(0, 250);
    const res = await fetch(`${base}/v2/payments/captures/${input.chargeId}/refund`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`PayPal refund failed: ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`);
    }
    const refund = (await res.json()) as {
      id: string; status: string; amount?: { value?: string; currency_code?: string };
      create_time?: string;
    };
    await this.trackActivity(businessId);
    return {
      id: refund.id,
      chargeId: input.chargeId,
      amount: Number(refund.amount?.value ?? input.amount ?? 0),
      currency: (refund.amount?.currency_code ?? 'USD').toUpperCase(),
      status: refund.status.toLowerCase(),
      provider: 'paypal',
      createdAt: refund.create_time ? new Date(refund.create_time) : new Date(),
    };
  }
}
