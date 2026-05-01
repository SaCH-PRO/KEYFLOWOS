import { Injectable, Inject, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { EntityResolutionService } from '../entity-resolution.service';
import { IConnector, ConnectorMeta, ConnectorHealth, ConnectorSyncResult, ConnectorStatusSummary } from '../connector.interface';

@Injectable()
export class MetaSocialConnector implements IConnector {
  private readonly logger = new Logger(MetaSocialConnector.name);

  readonly meta: ConnectorMeta = {
    type: 'meta_social',
    name: 'Meta (Facebook & Instagram)',
    description: 'Publish posts and track engagement on Facebook and Instagram',
    category: 'social',
    group: 'social',
    icon: 'share-2',
    supportsSync: true,
    supportsWebhook: true,
    authType: 'oauth2',
  };

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
    @Inject(EntityResolutionService) private readonly entityResolution: EntityResolutionService,
  ) {}

  async authenticate(businessId: string): Promise<{ connected: boolean; authUrl?: string }> {
    const connected = await this.isConnected(businessId);
    if (connected) {
      return { connected: true };
    }
    return { connected: false, authUrl: `/social/businesses/${businessId}/connect` };
  }

  async healthCheck(businessId: string): Promise<ConnectorHealth> {
    const connections = await this.prisma.client.socialConnection.findMany({
      where: {
        businessId,
        platform: { in: ['FACEBOOK', 'INSTAGRAM'] },
      },
    });
    const isConnected = connections.some((c) => c.status === 'CONNECTED');
    const isExpired = connections.some((c) => c.status === 'EXPIRED');
    const realStatus = isConnected ? 'connected' : isExpired ? 'expired' : 'disconnected';
    const accountNames = connections
      .filter((c) => c.accountName)
      .map((c) => c.accountName)
      .join(', ');

    const stored = await this.getConnectorStatus(businessId);
    return {
      status: realStatus,
      lastSyncAt: stored?.lastSyncAt ?? null,
      lastErrorAt: stored?.lastErrorAt ?? null,
      lastError: stored?.lastError ?? null,
      errorCount: stored?.errorCount ?? 0,
      syncCount: stored?.syncCount ?? 0,
      connectedAt: stored?.connectedAt ?? connections[0]?.createdAt ?? null,
      connectedAccount: accountNames || stored?.connectedAccount || null,
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
    const connection = await this.prisma.client.socialConnection.findFirst({
      where: {
        businessId,
        platform: { in: ['FACEBOOK', 'INSTAGRAM'] },
        status: 'CONNECTED',
      },
    });
    return !!connection;
  }

  async sync(businessId: string): Promise<ConnectorSyncResult> {
    const start = Date.now();
    const connected = await this.isConnected(businessId);
    if (!connected) {
      return { success: false, itemsSynced: 0, errors: ['Meta social not connected'], duration: Date.now() - start };
    }

    const postCount = await this.prisma.client.socialPost.count({
      where: { businessId, status: 'POSTED', deletedAt: null },
    });

    await this.prisma.client.connectorStatus.upsert({
      where: { businessId_connectorType: { businessId, connectorType: 'meta_social' } },
      create: { businessId, connectorType: 'meta_social', status: 'connected', lastSyncAt: new Date(), syncCount: 1 },
      update: { lastSyncAt: new Date(), syncCount: { increment: 1 }, status: 'connected' },
    });

    return { success: true, itemsSynced: postCount, errors: [], duration: Date.now() - start };
  }

  async disconnect(businessId: string): Promise<void> {
    await this.prisma.client.socialConnection.deleteMany({
      where: {
        businessId,
        platform: { in: ['FACEBOOK', 'INSTAGRAM'] },
      },
    });
    await this.prisma.client.connectorStatus.upsert({
      where: { businessId_connectorType: { businessId, connectorType: 'meta_social' } },
      create: { businessId, connectorType: 'meta_social', status: 'disconnected' },
      update: { status: 'disconnected' },
    });
  }

  async emitPostPublished(businessId: string, opts: { platform: string; postId?: string; url?: string; externalId?: string }) {
    await this.trackActivity(businessId);

    this.events.emit('social_post.published', {
      connectorType: 'meta_social' as const,
      externalId: opts.externalId ?? null,
      businessId,
      timestamp: new Date(),
      platform: opts.platform,
      postId: opts.postId,
      url: opts.url,
    });
  }

  async emitEngagementReceived(businessId: string, opts: { platform: string; type: string; postId?: string; externalId?: string }) {
    await this.trackActivity(businessId);

    this.events.emit('social.engagement_received', {
      connectorType: 'meta_social' as const,
      externalId: opts.externalId ?? null,
      businessId,
      timestamp: new Date(),
      platform: opts.platform,
      type: opts.type,
      postId: opts.postId,
    });
  }

  async resolveEngagementContact(businessId: string, externalId: string, name?: string) {
    const [firstName, ...rest] = (name ?? '').split(' ');
    const resolved = await this.entityResolution.resolveContact(businessId, {
      source: 'meta',
      externalId,
      firstName: firstName || undefined,
      lastName: rest.join(' ') || undefined,
    });

    this.events.emit('entity.resolved', {
      businessId,
      contactId: resolved.contactId,
      source: 'meta',
      matchedOn: resolved.matchedOn,
      isNew: resolved.isNew,
      merged: resolved.merged,
    });

    return resolved;
  }

  private async trackActivity(businessId: string) {
    await this.prisma.client.connectorStatus.upsert({
      where: { businessId_connectorType: { businessId, connectorType: 'meta_social' } },
      create: { businessId, connectorType: 'meta_social', status: 'connected', lastSyncAt: new Date(), syncCount: 1 },
      update: { lastSyncAt: new Date(), syncCount: { increment: 1 }, status: 'connected' },
    }).catch((e) => this.logger.warn(`Failed to track meta activity: ${e instanceof Error ? e.message : String(e)}`));
  }

  private async getConnectorStatus(businessId: string) {
    return this.prisma.client.connectorStatus.findUnique({
      where: { businessId_connectorType: { businessId, connectorType: 'meta_social' } },
    });
  }
}
