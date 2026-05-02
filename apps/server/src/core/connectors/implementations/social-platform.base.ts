import { Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { EntityResolutionService } from '../entity-resolution.service';
import { IConnector, ConnectorMeta, ConnectorHealth, ConnectorSyncResult, ConnectorStatusSummary, ConnectorType } from '../connector.interface';

/**
 * Shared base for the expanded social platform connectors (LinkedIn / TikTok / Twitter).
 * Each platform has scheduling + analytics + DM ingestion semantics — modelled here on top
 * of the existing SocialConnection table so we reuse OAuth state.
 */
export abstract class SocialPlatformConnector implements IConnector {
  protected readonly logger: Logger;

  abstract readonly meta: ConnectorMeta;
  protected abstract readonly platformKey: string; // SocialConnection.platform value (uppercase)

  constructor(
    protected readonly prisma: PrismaService,
    protected readonly events: EventEmitter2,
    protected readonly entityResolution: EntityResolutionService,
  ) {
    this.logger = new Logger(this.constructor.name);
  }

  protected get connectorType(): ConnectorType {
    return this.meta.type;
  }

  async authenticate(businessId: string): Promise<{ connected: boolean; authUrl?: string }> {
    if (await this.isConnected(businessId)) return { connected: true };
    return { connected: false, authUrl: `/social/businesses/${businessId}/connect/${this.platformKey.toLowerCase()}` };
  }

  async healthCheck(businessId: string): Promise<ConnectorHealth> {
    const conn = await this.prisma.client.socialConnection.findFirst({
      where: { businessId, platform: this.platformKey },
    });
    const realStatus = conn?.status === 'CONNECTED'
      ? 'connected'
      : conn?.status === 'EXPIRED' ? 'expired' : 'disconnected';

    const stored = await this.getConnectorStatus(businessId);
    return {
      status: realStatus,
      lastSyncAt: stored?.lastSyncAt ?? null,
      lastErrorAt: stored?.lastErrorAt ?? null,
      lastError: stored?.lastError ?? null,
      errorCount: stored?.errorCount ?? 0,
      syncCount: stored?.syncCount ?? 0,
      connectedAt: stored?.connectedAt ?? conn?.createdAt ?? null,
      connectedAccount: conn?.accountName ?? stored?.connectedAccount ?? null,
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
    if (!(await this.isConnected(businessId))) {
      return { success: false, itemsSynced: 0, errors: [`${this.meta.name} not connected`], duration: Date.now() - start };
    }
    const posts = await this.prisma.client.socialPost.count({
      where: { businessId, status: 'POSTED', deletedAt: null },
    }).catch(() => 0);
    await this.trackActivity(businessId);
    return { success: true, itemsSynced: posts, errors: [], duration: Date.now() - start };
  }

  async disconnect(businessId: string): Promise<void> {
    await this.prisma.client.socialConnection.deleteMany({
      where: { businessId, platform: this.platformKey },
    });
    await this.prisma.client.connectorStatus.upsert({
      where: { businessId_connectorType: { businessId, connectorType: this.connectorType } },
      create: { businessId, connectorType: this.connectorType, status: 'disconnected' },
      update: { status: 'disconnected' },
    });
  }

  async emitPostPublished(businessId: string, opts: { postId?: string; url?: string; externalId?: string }) {
    await this.trackActivity(businessId);
    this.events.emit('social_post.published', {
      connectorType: this.connectorType,
      externalId: opts.externalId ?? null,
      businessId,
      timestamp: new Date(),
      platform: this.platformKey,
      postId: opts.postId,
      url: opts.url,
    });
  }

  async emitEngagementReceived(businessId: string, opts: { type: string; postId?: string; externalId?: string; from?: { name?: string; externalId?: string } }) {
    await this.trackActivity(businessId);
    let resolvedContactId: string | undefined;
    if (opts.from?.externalId) {
      const resolved = await this.entityResolution.resolveContact(businessId, {
        source: this.platformKey.toLowerCase(),
        externalId: opts.from.externalId,
        firstName: opts.from.name?.split(' ')[0],
        lastName: opts.from.name?.split(' ').slice(1).join(' ') || undefined,
      });
      resolvedContactId = resolved.contactId;
      this.events.emit('entity.resolved', {
        businessId,
        contactId: resolved.contactId,
        source: this.platformKey.toLowerCase(),
        matchedOn: resolved.matchedOn,
        isNew: resolved.isNew,
        merged: resolved.merged,
      });
    }
    this.events.emit('social.engagement_received', {
      connectorType: this.connectorType,
      externalId: opts.externalId ?? null,
      businessId,
      timestamp: new Date(),
      platform: this.platformKey,
      type: opts.type,
      postId: opts.postId,
      // Include resolved contactId so per-contact downstream listeners (journey
      // timeline, attribution) can attribute the engagement reliably.
      contactId: resolvedContactId,
    });
  }

  /**
   * Direct message ingestion routed through the standardized message.received event so
   * downstream listeners (CRM, AI listener, journey aggregator) react uniformly.
   */
  async emitDirectMessage(businessId: string, opts: { from: { externalId: string; name?: string }; body: string; externalId?: string }) {
    await this.trackActivity(businessId);
    const resolved = await this.entityResolution.resolveContact(businessId, {
      source: this.platformKey.toLowerCase(),
      externalId: opts.from.externalId,
      firstName: opts.from.name?.split(' ')[0],
      lastName: opts.from.name?.split(' ').slice(1).join(' ') || undefined,
    });
    this.events.emit('entity.resolved', {
      businessId,
      contactId: resolved.contactId,
      source: this.platformKey.toLowerCase(),
      matchedOn: resolved.matchedOn,
      isNew: resolved.isNew,
      merged: resolved.merged,
    });
    this.events.emit('message.received', {
      connectorType: this.connectorType,
      externalId: opts.externalId ?? null,
      businessId,
      timestamp: new Date(),
      channel: this.platformKey.toLowerCase(),
      from: opts.from.externalId,
      body: opts.body,
      contactId: resolved.contactId,
    });
    return { contactId: resolved.contactId };
  }

  protected async trackActivity(businessId: string) {
    await this.prisma.client.connectorStatus.upsert({
      where: { businessId_connectorType: { businessId, connectorType: this.connectorType } },
      create: { businessId, connectorType: this.connectorType, status: 'connected', lastSyncAt: new Date(), syncCount: 1 },
      update: { lastSyncAt: new Date(), syncCount: { increment: 1 }, status: 'connected' },
    }).catch((e) => this.logger.warn(`${this.meta.name} activity failed: ${e instanceof Error ? e.message : String(e)}`));
  }

  protected async getConnectorStatus(businessId: string) {
    return this.prisma.client.connectorStatus.findUnique({
      where: { businessId_connectorType: { businessId, connectorType: this.connectorType } },
    });
  }
}
