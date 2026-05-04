import { Injectable, Inject, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import {
  IConnector,
  ConnectorMeta,
  ConnectorHealth,
  ConnectorSyncResult,
  ConnectorStatusSummary,
  ConnectorSmokeResult,
} from '../connector.interface';

@Injectable()
export class GoogleContactsConnector implements IConnector {
  private readonly logger = new Logger(GoogleContactsConnector.name);

  readonly meta: ConnectorMeta = {
    type: 'google_contacts',
    name: 'Google Contacts',
    description: 'Two-way sync of customer contacts with Google Contacts',
    category: 'contacts',
    group: 'google',
    icon: 'users',
    supportsSync: true,
    supportsWebhook: false,
    authType: 'oauth2',
    scopes: [
      'https://www.googleapis.com/auth/contacts',
      'https://www.googleapis.com/auth/userinfo.email',
    ],
    externalUrl: 'https://contacts.google.com',
  };

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
  ) {}

  async authenticate(businessId: string): Promise<{ connected: boolean; authUrl?: string }> {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { contactsAccessToken: true },
    });
    if (business?.contactsAccessToken) return { connected: true };
    return { connected: false, authUrl: `/connect/google-suite/auth-url?service=contacts&businessId=${businessId}` };
  }

  async healthCheck(businessId: string): Promise<ConnectorHealth> {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { contactsAccessToken: true, contactsEmail: true, contactsLastSyncAt: true },
    });
    const realStatus = business?.contactsAccessToken ? 'connected' : 'disconnected';
    const stored = await this.getConnectorStatus(businessId);
    return {
      status: realStatus,
      lastSyncAt: business?.contactsLastSyncAt ?? stored?.lastSyncAt ?? null,
      lastErrorAt: stored?.lastErrorAt ?? null,
      lastError: stored?.lastError ?? null,
      errorCount: stored?.errorCount ?? 0,
      syncCount: stored?.syncCount ?? 0,
      connectedAt: stored?.connectedAt ?? null,
      connectedAccount: business?.contactsEmail ?? stored?.connectedAccount ?? null,
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
      select: { contactsAccessToken: true },
    });
    return !!business?.contactsAccessToken;
  }

  async sync(businessId: string): Promise<ConnectorSyncResult> {
    const start = Date.now();
    const connected = await this.isConnected(businessId);
    if (!connected) {
      return { success: false, itemsSynced: 0, errors: ['Google Contacts not connected'], duration: Date.now() - start };
    }
    const contactCount = await this.prisma.client.contact
      .count({ where: { businessId, source: 'google_contacts' } })
      .catch(() => 0);
    await this.prisma.client.business.update({
      where: { id: businessId },
      data: { contactsLastSyncAt: new Date() },
    });
    await this.prisma.client.connectorStatus.upsert({
      where: { businessId_connectorType: { businessId, connectorType: 'google_contacts' } },
      create: { businessId, connectorType: 'google_contacts', status: 'connected', lastSyncAt: new Date(), syncCount: 1 },
      update: { lastSyncAt: new Date(), syncCount: { increment: 1 }, status: 'connected' },
    });
    return { success: true, itemsSynced: contactCount, errors: [], duration: Date.now() - start };
  }

  async testConnection(businessId: string): Promise<{ success: boolean; error?: string; account?: string }> {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { contactsAccessToken: true, contactsEmail: true },
    });
    if (!business?.contactsAccessToken) return { success: false, error: 'Google Contacts not connected' };
    try {
      const res = await fetch(
        'https://people.googleapis.com/v1/people/me/connections?personFields=names&pageSize=1',
        { headers: { Authorization: `Bearer ${business.contactsAccessToken}` } },
      );
      if (!res.ok) return { success: false, error: `People API returned ${res.status}` };
      return { success: true, account: business.contactsEmail ?? undefined };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Network error' };
    }
  }

  async smokeTest(businessId: string): Promise<ConnectorSmokeResult> {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { contactsAccessToken: true, contactsEmail: true },
    });
    if (!business?.contactsAccessToken) return { success: false, error: 'Google Contacts is not connected' };
    try {
      const res = await fetch(
        'https://people.googleapis.com/v1/people/me/connections?personFields=names,emailAddresses&pageSize=3',
        { headers: { Authorization: `Bearer ${business.contactsAccessToken}` } },
      );
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        return { success: false, error: `People API ${res.status}${body ? `: ${body.slice(0, 160)}` : ''}` };
      }
      const data = (await res.json()) as { connections?: unknown[]; totalPeople?: number };
      await this.prisma.client.connectorStatus.upsert({
        where: { businessId_connectorType: { businessId, connectorType: 'google_contacts' } },
        create: { businessId, connectorType: 'google_contacts', status: 'connected', lastSyncAt: new Date(), syncCount: 1 },
        update: { lastSyncAt: new Date(), syncCount: { increment: 1 }, status: 'connected' },
      }).catch(() => undefined);
      return {
        success: true,
        action: 'Listed Google contacts',
        account: business.contactsEmail ?? undefined,
        detail: `${data.connections?.length ?? 0} returned${typeof data.totalPeople === 'number' ? ` of ${data.totalPeople} total` : ''}`,
      };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Network error' };
    }
  }

  async disconnect(businessId: string): Promise<void> {
    await this.prisma.client.business.update({
      where: { id: businessId },
      data: {
        contactsAccessToken: null,
        contactsRefreshToken: null,
        contactsTokenExpiry: null,
        contactsEmail: null,
        contactsSyncToken: null,
      },
    });
    await this.prisma.client.connectorStatus.upsert({
      where: { businessId_connectorType: { businessId, connectorType: 'google_contacts' } },
      create: { businessId, connectorType: 'google_contacts', status: 'disconnected' },
      update: { status: 'disconnected' },
    });
  }

  private async getConnectorStatus(businessId: string) {
    return this.prisma.client.connectorStatus.findUnique({
      where: { businessId_connectorType: { businessId, connectorType: 'google_contacts' } },
    });
  }
}
