import { Injectable, Inject, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { EntityResolutionService } from '../entity-resolution.service';
import { IConnector, ConnectorMeta, ConnectorHealth, ConnectorSyncResult, ConnectorStatusSummary } from '../connector.interface';

@Injectable()
export class StripeConnector implements IConnector {
  private readonly logger = new Logger(StripeConnector.name);

  readonly meta: ConnectorMeta = {
    type: 'stripe',
    name: 'Stripe',
    description: 'Accept global card payments and manage subscriptions via Stripe',
    category: 'payment',
    icon: 'credit-card',
    supportsSync: false,
    supportsWebhook: true,
    authType: 'api_key',
  };

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
    @Inject(EntityResolutionService) private readonly entityResolution: EntityResolutionService,
  ) {}

  async authenticate(_businessId: string): Promise<{ connected: boolean; authUrl?: string }> {
    return { connected: !!process.env.STRIPE_SECRET_KEY };
  }

  async healthCheck(businessId: string): Promise<ConnectorHealth> {
    const hasStripe = !!process.env.STRIPE_SECRET_KEY;
    const realStatus = hasStripe ? 'connected' : 'disconnected';

    const stored = await this.getConnectorStatus(businessId);
    return {
      status: realStatus,
      lastSyncAt: stored?.lastSyncAt ?? null,
      lastErrorAt: stored?.lastErrorAt ?? null,
      lastError: stored?.lastError ?? null,
      errorCount: stored?.errorCount ?? 0,
      syncCount: stored?.syncCount ?? 0,
      connectedAt: stored?.connectedAt ?? null,
      connectedAccount: hasStripe ? (stored?.connectedAccount ?? 'Stripe Account') : null,
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

  async isConnected(_businessId: string): Promise<boolean> {
    return !!process.env.STRIPE_SECRET_KEY;
  }

  async sync(businessId: string): Promise<ConnectorSyncResult> {
    const start = Date.now();
    const connected = await this.isConnected(businessId);
    if (!connected) {
      return { success: false, itemsSynced: 0, errors: ['Stripe not connected'], duration: Date.now() - start };
    }

    const recentPayments = await this.prisma.client.payment.count({
      where: { businessId, method: 'STRIPE' },
    }).catch(() => 0);

    return { success: true, itemsSynced: recentPayments, errors: [], duration: Date.now() - start };
  }

  async disconnect(businessId: string): Promise<void> {
    await this.prisma.client.connectorStatus.upsert({
      where: { businessId_connectorType: { businessId, connectorType: 'stripe' } },
      create: { businessId, connectorType: 'stripe', status: 'disconnected' },
      update: { status: 'disconnected' },
    });
  }

  async emitPaymentReceived(businessId: string, opts: { amount: number; currency: string; invoiceId?: string; customerEmail?: string; customerName?: string; stripeCustomerId?: string; externalId?: string }) {
    await this.trackActivity(businessId);

    let contactId: string | undefined;

    if (opts.customerEmail) {
      const resolved = await this.entityResolution.resolveContact(businessId, {
        source: 'stripe',
        externalId: opts.stripeCustomerId,
        email: opts.customerEmail,
        firstName: opts.customerName?.split(' ')[0],
        lastName: opts.customerName?.split(' ').slice(1).join(' ') || undefined,
      });
      contactId = resolved.contactId;

      this.events.emit('entity.resolved', {
        businessId,
        contactId: resolved.contactId,
        source: 'stripe',
        matchedOn: resolved.matchedOn,
        isNew: resolved.isNew,
        merged: resolved.merged,
      });
    }

    this.events.emit('payment.received', {
      connectorType: 'stripe' as const,
      externalId: opts.externalId ?? null,
      businessId,
      timestamp: new Date(),
      amount: opts.amount,
      currency: opts.currency,
      provider: 'stripe',
      invoiceId: opts.invoiceId,
      contactId,
    });
  }

  async emitPaymentFailed(businessId: string, opts: { amount: number; currency: string; error: string; invoiceId?: string; externalId?: string }) {
    await this.trackError(businessId, opts.error);

    this.events.emit('payment.failed', {
      connectorType: 'stripe' as const,
      externalId: opts.externalId ?? null,
      businessId,
      timestamp: new Date(),
      amount: opts.amount,
      currency: opts.currency,
      provider: 'stripe',
      error: opts.error,
      invoiceId: opts.invoiceId,
    });
  }

  private async trackActivity(businessId: string) {
    await this.prisma.client.connectorStatus.upsert({
      where: { businessId_connectorType: { businessId, connectorType: 'stripe' } },
      create: { businessId, connectorType: 'stripe', status: 'connected', lastSyncAt: new Date(), syncCount: 1 },
      update: { lastSyncAt: new Date(), syncCount: { increment: 1 }, status: 'connected' },
    }).catch((e) => this.logger.warn(`Failed to track stripe activity: ${e instanceof Error ? e.message : String(e)}`));
  }

  private async trackError(businessId: string, error: string) {
    await this.prisma.client.connectorStatus.upsert({
      where: { businessId_connectorType: { businessId, connectorType: 'stripe' } },
      create: { businessId, connectorType: 'stripe', status: 'error', lastErrorAt: new Date(), lastError: error, errorCount: 1 },
      update: { lastErrorAt: new Date(), lastError: error, errorCount: { increment: 1 } },
    }).catch((e) => this.logger.warn(`Failed to track stripe error: ${e instanceof Error ? e.message : String(e)}`));
  }

  private async getConnectorStatus(businessId: string) {
    return this.prisma.client.connectorStatus.findUnique({
      where: { businessId_connectorType: { businessId, connectorType: 'stripe' } },
    });
  }
}
