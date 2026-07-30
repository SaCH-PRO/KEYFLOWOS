import { Injectable, Inject, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { createHmac, timingSafeEqual } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { EntityResolutionService } from '../entity-resolution.service';
import { IConnector, ConnectorMeta, ConnectorHealth, ConnectorSyncResult, ConnectorStatusSummary, ConnectorSmokeResult, IngestionItemInput } from '../connector.interface';

interface MetaSocialWebhookBody {
  type?: string;
  platform?: string;
  object?: string;
  from?: { id?: string; name?: string };
  message?: string;
  externalId?: string;
  entry?: Array<{
    id?: string;
    time?: number;
    messaging?: Array<{
      sender?: { id?: string };
      recipient?: { id?: string };
      timestamp?: number;
      message?: {
        mid?: string;
        text?: string;
        attachments?: Array<{ type?: string; payload?: { url?: string } }>;
      };
    }>;
  }>;
}

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
    externalUrl: 'https://business.facebook.com',
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
    return {
      connected: false,
      authUrl: `/social/businesses/${businessId}/connections/FACEBOOK/oauth/start`,
    };
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

  async sync(_businessId: string): Promise<ConnectorSyncResult> {
    // Meta (Facebook/Instagram) does not support pull synchronization: inbound
    // DMs/engagement arrive via the Meta webhook and outbound content is
    // published. Return an explicit unsupported result rather than reporting a
    // local post count as a successful provider sync.
    return {
      success: false,
      itemsSynced: 0,
      unsupported: true,
      code: 'PULL_SYNC_UNSUPPORTED',
      errors: ['Pull sync is not supported for Meta; inbound arrives via webhook and outbound is published.'],
      duration: 0,
    };
  }

  parseInbound(payload: unknown, _businessId: string): IngestionItemInput[] {
    const body = payload as MetaSocialWebhookBody;

    // Legacy simplified shape used by tests/older integrations.
    if (
      typeof body.type === 'string' &&
      body.type.toUpperCase() === 'DM' &&
      typeof body.from?.id === 'string'
    ) {
      const text = body.message ?? '';
      const platform = (body.platform ?? '').toLowerCase();
      return [
        {
          sourceType: platform === 'instagram' ? 'instagram' : 'messenger',
          sourceConnectorType: 'meta_social',
          externalId: body.externalId ?? body.from.id,
          receivedAt: new Date(),
          from: { id: body.from.id, name: body.from.name },
          subject: text ? text.slice(0, 100) : 'Direct message',
          body: text,
          rawPayload: payload as Record<string, unknown>,
        },
      ];
    }

    // Real Meta Graph webhook shape (page / instagram).
    if (Array.isArray(body.entry) && body.entry.length > 0) {
      const object = (body.object ?? '').toLowerCase();
      const event = body.entry[0]?.messaging?.[0];
      const message = event?.message;
      if (event?.sender?.id && message) {
        const text = message.text ?? '';
        return [
          {
            sourceType: object === 'instagram' ? 'instagram' : 'messenger',
            sourceConnectorType: 'meta_social',
            externalId: message.mid ?? event.sender.id,
            receivedAt: event.timestamp ? new Date(event.timestamp) : new Date(),
            from: { id: event.sender.id, name: event.sender.id },
            subject: text ? text.slice(0, 100) : 'Direct message',
            body: text,
            rawPayload: payload as Record<string, unknown>,
          },
        ];
      }
    }

    return [];
  }

  verifyWebhook(payload: unknown, signature: string | undefined, secret: string): boolean {
    if (!signature || !signature.startsWith('sha256=')) {
      return false;
    }
    let raw: Buffer;
    if (Buffer.isBuffer(payload)) {
      raw = payload;
    } else if (typeof payload === 'string') {
      raw = Buffer.from(payload, 'utf8');
    } else {
      return false;
    }
    const expected = createHmac('sha256', secret).update(raw).digest('hex');
    const provided = signature.slice('sha256='.length);
    try {
      return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(provided, 'hex'));
    } catch {
      return false;
    }
  }

  async smokeTest(businessId: string): Promise<ConnectorSmokeResult> {
    const conn = await this.prisma.client.socialConnection.findFirst({
      where: { businessId, platform: { in: ['FACEBOOK', 'INSTAGRAM'] }, status: 'CONNECTED' },
    });
    if (!conn?.token) return { success: false, error: 'No connected Meta account' };
    try {
      const res = await fetch('https://graph.facebook.com/v21.0/me?fields=id,name', {
        headers: { Authorization: `Bearer ${conn.token}` },
      });
      if (!res.ok) {
        return { success: false, error: `Meta Graph API ${res.status}` };
      }
      const data = (await res.json()) as { id?: string; name?: string };
      await this.trackActivity(businessId);
      return {
        success: true,
        action: `Verified ${conn.platform} access token`,
        account: data.name ?? conn.accountName ?? undefined,
        detail: data.id ? `Account ID ${data.id}` : undefined,
      };
    } catch (err: any) {
      return { success: false, error: err instanceof Error ? err.message : 'Network error' };
    }
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
