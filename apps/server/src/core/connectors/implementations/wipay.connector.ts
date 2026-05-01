import { Injectable, Inject, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { EntityResolutionService } from '../entity-resolution.service';
import { IConnector, ConnectorMeta, ConnectorHealth, ConnectorSyncResult, ConnectorStatusSummary } from '../connector.interface';

@Injectable()
export class WiPayConnector implements IConnector {
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
}
