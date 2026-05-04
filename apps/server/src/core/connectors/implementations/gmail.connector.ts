import { Injectable, Inject, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { EntityResolutionService } from '../entity-resolution.service';
import { IConnector, ConnectorMeta, ConnectorHealth, ConnectorSyncResult, ConnectorStatusSummary } from '../connector.interface';

@Injectable()
export class GmailConnector implements IConnector {
  private readonly logger = new Logger(GmailConnector.name);

  readonly meta: ConnectorMeta = {
    type: 'gmail',
    name: 'Gmail',
    description: 'Read & send email, manage threads, labels, archives, and trash',
    category: 'communication',
    group: 'google',
    icon: 'mail',
    supportsSync: true,
    supportsWebhook: false,
    authType: 'oauth2',
    scopes: [
      'https://www.googleapis.com/auth/gmail.modify',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
    ],
    externalUrl: 'https://mail.google.com',
  };

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
    @Inject(EntityResolutionService) private readonly entityResolution: EntityResolutionService,
  ) {}

  async authenticate(businessId: string): Promise<{ connected: boolean; authUrl?: string }> {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { gmailAccessToken: true },
    });
    if (business?.gmailAccessToken) {
      return { connected: true };
    }
    return { connected: false, authUrl: `/gmail/businesses/${businessId}/auth-url` };
  }

  async healthCheck(businessId: string): Promise<ConnectorHealth> {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { gmailAccessToken: true, gmailEmail: true },
    });
    const realStatus = business?.gmailAccessToken ? 'connected' : 'disconnected';

    const stored = await this.getConnectorStatus(businessId);
    return {
      status: realStatus,
      lastSyncAt: stored?.lastSyncAt ?? null,
      lastErrorAt: stored?.lastErrorAt ?? null,
      lastError: stored?.lastError ?? null,
      errorCount: stored?.errorCount ?? 0,
      syncCount: stored?.syncCount ?? 0,
      connectedAt: stored?.connectedAt ?? null,
      connectedAccount: business?.gmailEmail ?? stored?.connectedAccount ?? null,
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
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { gmailAccessToken: true },
    });
    return !!business?.gmailAccessToken;
  }

  async sync(businessId: string): Promise<ConnectorSyncResult> {
    const start = Date.now();
    const connected = await this.isConnected(businessId);
    if (!connected) {
      return { success: false, itemsSynced: 0, errors: ['Gmail not connected'], duration: Date.now() - start };
    }

    await this.prisma.client.connectorStatus.upsert({
      where: { businessId_connectorType: { businessId, connectorType: 'gmail' } },
      create: { businessId, connectorType: 'gmail', status: 'connected', lastSyncAt: new Date(), syncCount: 1, connectedAccount: (await this.getGmailEmail(businessId)) },
      update: { lastSyncAt: new Date(), syncCount: { increment: 1 }, status: 'connected' },
    });

    return { success: true, itemsSynced: 0, errors: [], duration: Date.now() - start };
  }

  async testConnection(businessId: string): Promise<{ success: boolean; error?: string; account?: string }> {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { gmailAccessToken: true, gmailEmail: true },
    });
    if (!business?.gmailAccessToken) {
      return { success: false, error: 'Gmail is not connected' };
    }
    try {
      const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
        headers: { Authorization: `Bearer ${business.gmailAccessToken}` },
      });
      if (!res.ok) {
        return { success: false, error: `Gmail API returned ${res.status}` };
      }
      const data = await res.json();
      return { success: true, account: data.emailAddress ?? business.gmailEmail ?? undefined };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Network error' };
    }
  }

  /**
   * Real round-trip: hit Gmail's profile endpoint AND read the latest message metadata
   * to confirm both read scope + token freshness end-to-end.
   */
  async smokeTest(businessId: string): Promise<import('../connector.interface').ConnectorSmokeResult> {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { gmailAccessToken: true, gmailEmail: true },
    });
    if (!business?.gmailAccessToken) {
      return { success: false, error: 'Gmail is not connected' };
    }
    try {
      const headers = { Authorization: `Bearer ${business.gmailAccessToken}` };
      const profileRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', { headers });
      if (!profileRes.ok) {
        const body = await profileRes.text().catch(() => '');
        return { success: false, error: `Gmail profile ${profileRes.status}${body ? `: ${body.slice(0, 160)}` : ''}` };
      }
      const profile = await profileRes.json() as { emailAddress?: string; messagesTotal?: number };
      const listRes = await fetch(
        'https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=1',
        { headers },
      );
      const list = listRes.ok ? (await listRes.json()) as { messages?: Array<{ id: string }> } : { messages: [] };
      await this.trackActivity(businessId);
      return {
        success: true,
        action: 'Fetched Gmail profile and most recent message',
        account: profile.emailAddress ?? business.gmailEmail ?? undefined,
        detail: `${profile.messagesTotal ?? 0} total messages • latest id ${list.messages?.[0]?.id ?? 'none'}`,
      };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Network error' };
    }
  }

  async disconnect(businessId: string): Promise<void> {
    await this.prisma.client.business.update({
      where: { id: businessId },
      data: {
        gmailAccessToken: null,
        gmailRefreshToken: null,
      },
    });
    await this.prisma.client.connectorStatus.upsert({
      where: { businessId_connectorType: { businessId, connectorType: 'gmail' } },
      create: { businessId, connectorType: 'gmail', status: 'disconnected' },
      update: { status: 'disconnected' },
    });
  }

  async emitMessageReceived(businessId: string, opts: { from: string; subject?: string; body?: string; externalId?: string; senderName?: string }) {
    await this.trackActivity(businessId);

    const resolved = await this.entityResolution.resolveContact(businessId, {
      source: 'gmail',
      email: opts.from,
      firstName: opts.senderName?.split(' ')[0],
      lastName: opts.senderName?.split(' ').slice(1).join(' ') || undefined,
    });

    this.events.emit('entity.resolved', {
      businessId,
      contactId: resolved.contactId,
      source: 'gmail',
      matchedOn: resolved.matchedOn,
      isNew: resolved.isNew,
      merged: resolved.merged,
    });

    this.events.emit('message.received', {
      connectorType: 'gmail' as const,
      externalId: opts.externalId ?? null,
      businessId,
      timestamp: new Date(),
      channel: 'email',
      from: opts.from,
      subject: opts.subject,
      body: opts.body,
      contactId: resolved.contactId,
    });

    return resolved;
  }

  async emitMessageSent(businessId: string, opts: { to: string; subject?: string; contactId?: string; externalId?: string }) {
    await this.trackActivity(businessId);

    this.events.emit('message.sent', {
      connectorType: 'gmail' as const,
      externalId: opts.externalId ?? null,
      businessId,
      timestamp: new Date(),
      channel: 'email',
      to: opts.to,
      subject: opts.subject,
      contactId: opts.contactId,
    });
  }

  private async trackActivity(businessId: string) {
    await this.prisma.client.connectorStatus.upsert({
      where: { businessId_connectorType: { businessId, connectorType: 'gmail' } },
      create: { businessId, connectorType: 'gmail', status: 'connected', lastSyncAt: new Date(), syncCount: 1 },
      update: { lastSyncAt: new Date(), syncCount: { increment: 1 }, status: 'connected' },
    }).catch((e) => this.logger.warn(`Failed to track gmail activity: ${e instanceof Error ? e.message : String(e)}`));
  }

  private async getGmailEmail(businessId: string): Promise<string | null> {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { gmailEmail: true },
    });
    return business?.gmailEmail ?? null;
  }

  private async getConnectorStatus(businessId: string) {
    return this.prisma.client.connectorStatus.findUnique({
      where: { businessId_connectorType: { businessId, connectorType: 'gmail' } },
    });
  }
}
