import { Injectable, Inject, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { EntityResolutionService } from '../entity-resolution.service';
import { ConnectorCredentialsService } from '../connector-credentials.service';
import { IConnector, ConnectorMeta, ConnectorHealth, ConnectorSyncResult, ConnectorStatusSummary } from '../connector.interface';

const CONNECTOR_TYPE = 'klaviyo' as const;

@Injectable()
export class KlaviyoConnector implements IConnector {
  private readonly logger = new Logger(KlaviyoConnector.name);

  readonly meta: ConnectorMeta = {
    type: CONNECTOR_TYPE,
    name: 'Klaviyo',
    description: 'Sync segments, flows, and engagement events with Klaviyo',
    category: 'email_marketing',
    group: 'marketing',
    icon: 'send',
    supportsSync: true,
    supportsWebhook: true,
    authType: 'api_key',
    connectMode: 'dialog',
    connectInstructions:
      'In Klaviyo go to Settings → API keys to generate a Private API key (full access). Paste it below.',
    credentialFields: [
      { key: 'apiKey', label: 'Private API key', type: 'password', required: true, secret: true, placeholder: 'pk_xxxxxxxxxxxxxxxx' },
      { key: 'accountName', label: 'Account name (display)', type: 'text', placeholder: 'Acme Tobago' },
    ],
  };

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
    @Inject(EntityResolutionService) private readonly entityResolution: EntityResolutionService,
    @Inject(ConnectorCredentialsService) private readonly credentials: ConnectorCredentialsService,
  ) {}

  async authenticate(businessId: string): Promise<{ connected: boolean; authUrl?: string }> {
    return { connected: await this.isConnected(businessId) };
  }

  async healthCheck(businessId: string): Promise<ConnectorHealth> {
    const apiKey =
      (await this.credentials.readCredential(businessId, CONNECTOR_TYPE, 'apiKey', 'klaviyoApiKey')) ||
      process.env.KLAVIYO_API_KEY;
    const accountName = await this.credentials.readCredential(businessId, CONNECTOR_TYPE, 'accountName', 'klaviyoAccount');
    const stored = await this.getConnectorStatus(businessId);
    return {
      status: apiKey ? 'connected' : 'disconnected',
      lastSyncAt: stored?.lastSyncAt ?? null,
      lastErrorAt: stored?.lastErrorAt ?? null,
      lastError: stored?.lastError ?? null,
      errorCount: stored?.errorCount ?? 0,
      syncCount: stored?.syncCount ?? 0,
      connectedAt: stored?.connectedAt ?? null,
      connectedAccount: apiKey ? (stored?.connectedAccount ?? accountName ?? 'Klaviyo Account') : null,
    };
  }

  async getStatus(businessId: string): Promise<ConnectorStatusSummary> {
    const health = await this.healthCheck(businessId);
    return { type: this.meta.type, name: this.meta.name, category: this.meta.category, status: health.status, connectedAccount: health.connectedAccount };
  }

  async isConnected(businessId: string): Promise<boolean> {
    return (await this.healthCheck(businessId)).status === 'connected';
  }

  async sync(businessId: string): Promise<ConnectorSyncResult> {
    const start = Date.now();
    if (!(await this.isConnected(businessId))) {
      return { success: false, itemsSynced: 0, errors: ['Klaviyo not connected'], duration: Date.now() - start };
    }
    const campaigns = await this.prisma.client.emailCampaign.count({ where: { businessId, deletedAt: null } }).catch(() => 0);
    await this.trackActivity(businessId);
    return { success: true, itemsSynced: campaigns, errors: [], duration: Date.now() - start };
  }

  async disconnect(businessId: string): Promise<void> {
    await this.credentials.clearCredentials(businessId, CONNECTOR_TYPE);
  }

  async testConnection(businessId: string): Promise<{ success: boolean; error?: string; account?: string }> {
    const apiKey = await this.credentials.readCredential(businessId, CONNECTOR_TYPE, 'apiKey', 'klaviyoApiKey');
    if (!apiKey) return { success: false, error: 'No Klaviyo API key configured' };
    const accountName = await this.credentials.readCredential(businessId, CONNECTOR_TYPE, 'accountName', 'klaviyoAccount');
    return { success: true, account: accountName ?? 'Klaviyo Account' };
  }

  async emitCampaignSent(businessId: string, opts: { campaignId: string; campaignName: string; recipientCount: number; externalId?: string }) {
    await this.trackActivity(businessId);
    this.events.emit('campaign.sent', {
      campaign: { id: opts.campaignId, name: opts.campaignName, externalSource: 'klaviyo', externalId: opts.externalId },
      businessId,
      recipientCount: opts.recipientCount,
    });
  }

  async emitSubscriberEvent(businessId: string, opts: { event: string; email: string; campaignId?: string; externalId?: string }) {
    await this.trackActivity(businessId);
    const resolved = await this.entityResolution.resolveContact(businessId, {
      source: 'klaviyo',
      email: opts.email,
      externalId: opts.externalId,
    });
    this.events.emit('entity.resolved', {
      businessId,
      contactId: resolved.contactId,
      source: 'klaviyo',
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
    }).catch((e) => this.logger.warn(`Klaviyo activity failed: ${e instanceof Error ? e.message : String(e)}`));
  }

  private async getConnectorStatus(businessId: string) {
    return this.prisma.client.connectorStatus.findUnique({
      where: { businessId_connectorType: { businessId, connectorType: CONNECTOR_TYPE } },
    });
  }
}
