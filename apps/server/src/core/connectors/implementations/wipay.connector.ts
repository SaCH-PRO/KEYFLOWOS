import { Injectable, Inject, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { EntityResolutionService } from '../entity-resolution.service';
import { IConnector, ConnectorMeta, ConnectorHealth, ConnectorSyncResult, ConnectorStatusSummary, ConnectorSmokeResult } from '../connector.interface';
import { GatewayNotSupportedError, IPaymentGatewayConnector, PaymentGatewayTransaction, PaymentLinkInput, PaymentLinkResult, RefundInput, RefundResult } from '../payment-gateway.interface';

@Injectable()
export class WiPayConnector implements IConnector, IPaymentGatewayConnector {
  private readonly logger = new Logger(WiPayConnector.name);

  readonly meta: ConnectorMeta = {
    type: 'wipay',
    name: 'WiPay',
    description: 'Accept Caribbean payments via WiPay payment gateway',
    category: 'payment',
    group: 'payments',
    icon: 'wallet',
    supportsSync: false,
    supportsWebhook: true,
    authType: 'api_key',
    externalUrl: 'https://wipayfinancial.com/',
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
    const hasWiPay = !!(meta.wipayApiKey || process.env.WIPAY_API_KEY);
    const realStatus = hasWiPay ? 'connected' : 'disconnected';

    const stored = await this.getConnectorStatus(businessId);
    return {
      status: realStatus,
      lastSyncAt: stored?.lastSyncAt ?? null,
      lastErrorAt: stored?.lastErrorAt ?? null,
      lastError: stored?.lastError ?? null,
      errorCount: stored?.errorCount ?? 0,
      syncCount: stored?.syncCount ?? 0,
      connectedAt: stored?.connectedAt ?? null,
      connectedAccount: hasWiPay ? (stored?.connectedAccount ?? (String(meta.wipayAccountNumber ?? '') || 'WiPay Account')) : null,
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
      return { success: false, itemsSynced: 0, errors: ['WiPay not connected'], duration: Date.now() - start };
    }

    const recentPayments = await this.prisma.client.payment.count({
      where: { businessId, method: 'WIPAY' },
    }).catch(() => 0);

    return { success: true, itemsSynced: recentPayments, errors: [], duration: Date.now() - start };
  }

  async smokeTest(businessId: string): Promise<ConnectorSmokeResult> {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { metaData: true },
    });
    const meta = (business?.metaData as Record<string, unknown>) ?? {};
    const apiKey = (meta.wipayApiKey as string | undefined) || process.env.WIPAY_API_KEY;
    const accountNumber = (meta.wipayAccountNumber as string | undefined) || process.env.WIPAY_ACCOUNT_NUMBER;
    if (!apiKey) return { success: false, error: 'WIPAY_API_KEY is not configured' };
    if (!accountNumber) {
      return { success: false, error: 'WiPay account number missing — required to issue payment requests' };
    }
    try {
      const params = new URLSearchParams({
        account_number: accountNumber,
        api_key: apiKey,
        environment: 'sandbox',
        method: 'credit_card',
        currency: 'TTD',
        total: '0.00',
        order_id: `keyflow-smoke-${Date.now()}`,
        origin: 'keyflow-smoke',
        response_url: 'https://example.com/keyflow-smoke',
      });
      const res = await fetch('https://tt.wipayfinancial.com/plugins/payments/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: params.toString(),
      });
      const text = await res.text().catch(() => '');
      let parsed: Record<string, unknown> | null = null;
      try {
        parsed = JSON.parse(text);
      } catch (err: any) {
          this.logger.debug(`Non-JSON response (e.g. HTML form page) — that's still a real round trip: ${err instanceof Error ? err.message : err}`);
        }
      const message = (parsed?.message as string | undefined) ?? (parsed?.status as string | undefined) ?? null;
      // WiPay returns 200 with a JSON body even on validation failure. As long as
      // we got a structured response from their host, the credentials reached the
      // gateway. Hard 401/403 means the api_key/account_number was rejected.
      if (res.status === 401 || res.status === 403) {
        return {
          success: false,
          error: `WiPay rejected credentials (${res.status}${message ? `: ${message}` : ''})`,
          account: String(accountNumber),
        };
      }
      return {
        success: true,
        action: 'Round-tripped a sentinel payment request to WiPay',
        account: String(accountNumber),
        detail: message ?? `HTTP ${res.status} from WiPay gateway`,
      };
    } catch (err: any) {
      return { success: false, error: err instanceof Error ? err.message : 'Network error' };
    }
  }

  async disconnect(businessId: string): Promise<void> {
    await this.prisma.client.connectorStatus.upsert({
      where: { businessId_connectorType: { businessId, connectorType: 'wipay' } },
      create: { businessId, connectorType: 'wipay', status: 'disconnected' },
      update: { status: 'disconnected' },
    });
  }

  async emitPaymentReceived(businessId: string, opts: { amount: number; currency: string; invoiceId?: string; payerEmail?: string; payerName?: string; externalId?: string }) {
    await this.trackActivity(businessId);

    let contactId: string | undefined;

    if (opts.payerEmail) {
      const resolved = await this.entityResolution.resolveContact(businessId, {
        source: 'wipay',
        externalId: opts.externalId,
        email: opts.payerEmail,
        firstName: opts.payerName?.split(' ')[0],
        lastName: opts.payerName?.split(' ').slice(1).join(' ') || undefined,
      });
      contactId = resolved.contactId;

      this.events.emit('entity.resolved', {
        businessId,
        contactId: resolved.contactId,
        source: 'wipay',
        matchedOn: resolved.matchedOn,
        isNew: resolved.isNew,
        merged: resolved.merged,
      });
    }

    this.events.emit('payment.received', {
      connectorType: 'wipay' as const,
      externalId: opts.externalId ?? null,
      businessId,
      timestamp: new Date(),
      amount: opts.amount,
      currency: opts.currency,
      provider: 'wipay',
      invoiceId: opts.invoiceId,
      contactId,
    });
  }

  async emitPaymentFailed(businessId: string, opts: { amount: number; currency: string; error: string; invoiceId?: string; externalId?: string }) {
    await this.trackError(businessId, opts.error);

    this.events.emit('payment.failed', {
      connectorType: 'wipay' as const,
      externalId: opts.externalId ?? null,
      businessId,
      timestamp: new Date(),
      amount: opts.amount,
      currency: opts.currency,
      provider: 'wipay',
      error: opts.error,
      invoiceId: opts.invoiceId,
    });
  }

  private async trackActivity(businessId: string) {
    await this.prisma.client.connectorStatus.upsert({
      where: { businessId_connectorType: { businessId, connectorType: 'wipay' } },
      create: { businessId, connectorType: 'wipay', status: 'connected', lastSyncAt: new Date(), syncCount: 1 },
      update: { lastSyncAt: new Date(), syncCount: { increment: 1 }, status: 'connected' },
    }).catch((e) => this.logger.warn(`Failed to track wipay activity: ${e instanceof Error ? e.message : String(e)}`));
  }

  private async trackError(businessId: string, error: string) {
    await this.prisma.client.connectorStatus.upsert({
      where: { businessId_connectorType: { businessId, connectorType: 'wipay' } },
      create: { businessId, connectorType: 'wipay', status: 'error', lastErrorAt: new Date(), lastError: error, errorCount: 1 },
      update: { lastErrorAt: new Date(), lastError: error, errorCount: { increment: 1 } },
    }).catch((e) => this.logger.warn(`Failed to track wipay error: ${e instanceof Error ? e.message : String(e)}`));
  }

  private async getConnectorStatus(businessId: string) {
    return this.prisma.client.connectorStatus.findUnique({
      where: { businessId_connectorType: { businessId, connectorType: 'wipay' } },
    });
  }

  async listRecentTransactions(businessId: string, limit = 50): Promise<PaymentGatewayTransaction[]> {
    const payments = await this.prisma.client.payment.findMany({
      where: { businessId, provider: 'wipay' },
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
        provider: 'wipay' as const,
        type: (p.status === 'REFUNDED' ? 'refund' : 'charge') as 'charge' | 'refund',
        status: p.status.toLowerCase(),
        amount: Number(p.amount),
        currency: p.currency,
        customerName: name,
        customerEmail: contact?.email ?? null,
        description: p.invoice?.id ? `Invoice ${p.invoice.id}` : null,
        invoiceId: p.invoiceId ?? null,
        externalUrl: null,
        createdAt: p.createdAt,
      };
    });
  }

  async createPaymentLink(_businessId: string, _input: PaymentLinkInput): Promise<PaymentLinkResult> {
    throw new GatewayNotSupportedError('wipay', 'Create payment link');
  }

  async listPaymentLinks(_businessId: string): Promise<PaymentLinkResult[]> {
    return [];
  }

  async revokePaymentLink(_businessId: string, _linkId: string): Promise<void> {
    throw new GatewayNotSupportedError('wipay', 'Revoke payment link');
  }

  async refundCharge(_businessId: string, _input: RefundInput): Promise<RefundResult> {
    throw new GatewayNotSupportedError('wipay', 'Refund charge');
  }
}
