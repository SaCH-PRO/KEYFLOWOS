import { Injectable, Inject, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { EntityResolutionService } from '../entity-resolution.service';
import { IConnector, ConnectorMeta, ConnectorHealth, ConnectorSyncResult, ConnectorStatusSummary } from '../connector.interface';

const CONNECTOR_TYPE = 'mailchimp' as const;

@Injectable()
export class MailchimpConnector implements IConnector {
  private readonly logger = new Logger(MailchimpConnector.name);

  readonly meta: ConnectorMeta = {
    type: CONNECTOR_TYPE,
    name: 'Mailchimp',
    description: 'Sync audiences, campaigns, and engagement with Mailchimp',
    category: 'email_marketing',
    group: 'marketing',
    icon: 'mail',
    supportsSync: true,
    supportsWebhook: true,
    authType: 'api_key',
  };

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
    @Inject(EntityResolutionService) private readonly entityResolution: EntityResolutionService,
  ) {}

  async authenticate(businessId: string): Promise<{ connected: boolean; authUrl?: string }> {
    return { connected: await this.isConnected(businessId) };
  }

  async healthCheck(businessId: string): Promise<ConnectorHealth> {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { metaData: true },
    });
    const meta = (business?.metaData as Record<string, unknown>) ?? {};
    const apiKey = (meta.mailchimpApiKey as string | undefined) || process.env.MAILCHIMP_API_KEY;
    const stored = await this.getConnectorStatus(businessId);
    return {
      status: apiKey ? 'connected' : 'disconnected',
      lastSyncAt: stored?.lastSyncAt ?? null,
      lastErrorAt: stored?.lastErrorAt ?? null,
      lastError: stored?.lastError ?? null,
      errorCount: stored?.errorCount ?? 0,
      syncCount: stored?.syncCount ?? 0,
      connectedAt: stored?.connectedAt ?? null,
      connectedAccount: apiKey ? (stored?.connectedAccount ?? String(meta.mailchimpAccount ?? 'Mailchimp Account')) : null,
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
    return (await this.healthCheck(businessId)).status === 'connected';
  }

  async sync(businessId: string): Promise<ConnectorSyncResult> {
    const start = Date.now();
    const connected = await this.isConnected(businessId);
    if (!connected) return { success: false, itemsSynced: 0, errors: ['Mailchimp not connected'], duration: Date.now() - start };
    const campaigns = await this.prisma.client.emailCampaign.count({ where: { businessId, deletedAt: null } }).catch(() => 0);
    await this.trackActivity(businessId);
    return { success: true, itemsSynced: campaigns, errors: [], duration: Date.now() - start };
  }

  async disconnect(businessId: string): Promise<void> {
    await this.prisma.client.connectorStatus.upsert({
      where: { businessId_connectorType: { businessId, connectorType: CONNECTOR_TYPE } },
      create: { businessId, connectorType: CONNECTOR_TYPE, status: 'disconnected' },
      update: { status: 'disconnected' },
    });
  }

  async emitCampaignSent(businessId: string, opts: { campaignId: string; campaignName: string; recipientCount: number; externalId?: string }) {
    await this.trackActivity(businessId);
    this.events.emit('campaign.sent', {
      campaign: { id: opts.campaignId, name: opts.campaignName, externalSource: 'mailchimp', externalId: opts.externalId },
      businessId,
      recipientCount: opts.recipientCount,
    });
  }

  async emitSubscriberEvent(businessId: string, opts: { event: 'subscribed' | 'unsubscribed' | 'opened' | 'clicked' | 'bounced'; email: string; campaignId?: string; externalId?: string }) {
    await this.trackActivity(businessId);
    const resolved = await this.entityResolution.resolveContact(businessId, {
      source: 'mailchimp',
      email: opts.email,
      externalId: opts.externalId,
    });
    this.events.emit('entity.resolved', {
      businessId,
      contactId: resolved.contactId,
      source: 'mailchimp',
      matchedOn: resolved.matchedOn,
      isNew: resolved.isNew,
      merged: resolved.merged,
    });
    return { contactId: resolved.contactId, event: opts.event };
  }

  private async trackActivity(businessId: string) {
    await this.prisma.client.connectorStatus.upsert({
      where: { businessId_connectorType: { businessId, connectorType: CONNECTOR_TYPE } },
      create: { businessId, connectorType: CONNECTOR_TYPE, status: 'connected', lastSyncAt: new Date(), syncCount: 1 },
      update: { lastSyncAt: new Date(), syncCount: { increment: 1 }, status: 'connected' },
    }).catch((e) => this.logger.warn(`Mailchimp activity failed: ${e instanceof Error ? e.message : String(e)}`));
  }

  private async getConnectorStatus(businessId: string) {
    return this.prisma.client.connectorStatus.findUnique({
      where: { businessId_connectorType: { businessId, connectorType: CONNECTOR_TYPE } },
    });
  }
}
