import { Injectable, Inject, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { EntityResolutionService } from '../entity-resolution.service';
import { IConnector, ConnectorMeta, ConnectorHealth, ConnectorSyncResult, ConnectorStatusSummary } from '../connector.interface';

@Injectable()
export class WhatsAppConnector implements IConnector {
  private readonly logger = new Logger(WhatsAppConnector.name);

  readonly meta: ConnectorMeta = {
    type: 'whatsapp',
    name: 'WhatsApp Business',
    description: 'Send template messages and media via WhatsApp Business API',
    category: 'communication',
    icon: 'message-circle',
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
    const connection = await this.prisma.client.channelConnection.findFirst({
      where: { businessId, provider: 'WHATSAPP' },
      orderBy: { createdAt: 'desc' },
    }).catch(() => null);
    const hasBusinessConfig = !!connection;
    const hasGlobalToken = !!process.env.WHATSAPP_ACCESS_TOKEN;
    const realStatus = (hasBusinessConfig || hasGlobalToken) ? 'connected' : 'disconnected';

    const stored = await this.getConnectorStatus(businessId);
    return {
      status: realStatus,
      lastSyncAt: stored?.lastSyncAt ?? null,
      lastErrorAt: stored?.lastErrorAt ?? null,
      lastError: stored?.lastError ?? null,
      errorCount: stored?.errorCount ?? 0,
      syncCount: stored?.syncCount ?? 0,
      connectedAt: stored?.connectedAt ?? connection?.createdAt ?? null,
      connectedAccount: stored?.connectedAccount ?? process.env.WHATSAPP_PHONE_NUMBER_ID ?? null,
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
      return { success: false, itemsSynced: 0, errors: ['WhatsApp not connected'], duration: Date.now() - start };
    }
    return { success: true, itemsSynced: 0, errors: [], duration: Date.now() - start };
  }

  async disconnect(businessId: string): Promise<void> {
    await this.prisma.client.connectorStatus.upsert({
      where: { businessId_connectorType: { businessId, connectorType: 'whatsapp' } },
      create: { businessId, connectorType: 'whatsapp', status: 'disconnected' },
      update: { status: 'disconnected' },
    });
  }

  async emitMessageReceived(businessId: string, opts: { from: string; body?: string; externalId?: string; senderName?: string }) {
    await this.trackActivity(businessId);

    const resolved = await this.entityResolution.resolveContact(businessId, {
      source: 'whatsapp',
      phone: opts.from,
      firstName: opts.senderName?.split(' ')[0],
      lastName: opts.senderName?.split(' ').slice(1).join(' ') || undefined,
    });

    this.events.emit('entity.resolved', {
      businessId,
      contactId: resolved.contactId,
      source: 'whatsapp',
      matchedOn: resolved.matchedOn,
      isNew: resolved.isNew,
      merged: resolved.merged,
    });

    this.events.emit('message.received', {
      connectorType: 'whatsapp' as const,
      externalId: opts.externalId ?? null,
      businessId,
      timestamp: new Date(),
      channel: 'whatsapp',
      from: opts.from,
      body: opts.body,
      contactId: resolved.contactId,
    });

    return resolved;
  }

  async emitMessageSent(businessId: string, opts: { to: string; contactId?: string; externalId?: string }) {
    await this.trackActivity(businessId);

    this.events.emit('message.sent', {
      connectorType: 'whatsapp' as const,
      externalId: opts.externalId ?? null,
      businessId,
      timestamp: new Date(),
      channel: 'whatsapp',
      to: opts.to,
      contactId: opts.contactId,
    });
  }

  private async trackActivity(businessId: string) {
    await this.prisma.client.connectorStatus.upsert({
      where: { businessId_connectorType: { businessId, connectorType: 'whatsapp' } },
      create: { businessId, connectorType: 'whatsapp', status: 'connected', lastSyncAt: new Date(), syncCount: 1 },
      update: { lastSyncAt: new Date(), syncCount: { increment: 1 }, status: 'connected' },
    }).catch((e) => this.logger.warn(`Failed to track whatsapp activity: ${e instanceof Error ? e.message : String(e)}`));
  }

  private async getConnectorStatus(businessId: string) {
    return this.prisma.client.connectorStatus.findUnique({
      where: { businessId_connectorType: { businessId, connectorType: 'whatsapp' } },
    });
  }
}
