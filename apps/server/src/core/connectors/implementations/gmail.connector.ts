import { Injectable, Inject, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { EntityResolutionService } from '../entity-resolution.service';
import { IConnector, ConnectorMeta, ConnectorHealth, ConnectorSyncResult, ConnectorStatusSummary } from '../connector.interface';
import { GmailIngestionService } from './gmail-ingestion.service';

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
    @Inject(GmailIngestionService) private readonly ingestion: GmailIngestionService,
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
    const connected = await this.isConnected(businessId);
    if (!connected) {
      return { success: false, itemsSynced: 0, errors: ['Gmail not connected'], duration: 0 };
    }

    return this.ingestion.syncInbox(businessId);
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
        return { success: false, error: `Gmail profile ${profileRes.status}${body ? `: ${body}` : ''}` };
      }
      const profile = (await profileRes.json()) as { emailAddress?: string };
      const address = profile.emailAddress ?? business.gmailEmail;
      if (!address) {
        return { success: false, error: 'Gmail account has no email address' };
      }
      const stamp = new Date().toISOString();
      const subject = `Keyflow connection test — ${stamp}`;
      const rfc822 =
        `From: ${address}\r\n` +
        `To: ${address}\r\n` +
        `Subject: ${subject}\r\n` +
        `X-Keyflow-Smoke-Test: 1\r\n` +
        `Content-Type: text/plain; charset="UTF-8"\r\n` +
        `\r\n` +
        `This is an automated Keyflow connector smoke test sent at ${stamp}. Safe to delete.\r\n`;
      // Gmail API expects base64url-encoded RFC 822 message
      const raw = Buffer.from(rfc822, 'utf8')
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
      const sendRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw }),
      });
      if (!sendRes.ok) {
        const body = await sendRes.text().catch(() => '');
        return { success: false, error: `Gmail send ${sendRes.status}${body ? `: ${body}` : ''}` };
      }
      const sent = (await sendRes.json()) as { id?: string };
      return {
        success: true,
        action: 'Sent a marked self-test email',
        account: address,
        detail: `Delivered to ${address} • id ${sent.id ?? 'unknown'}`,
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
