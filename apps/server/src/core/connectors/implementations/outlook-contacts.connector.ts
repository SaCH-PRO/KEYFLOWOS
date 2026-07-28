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
export class OutlookContactsConnector implements IConnector {
  private readonly logger = new Logger(OutlookContactsConnector.name);

  readonly meta: ConnectorMeta = {
    type: 'outlook_contacts',
    name: 'Outlook Contacts',
    description: 'Two-way sync of customer contacts with Outlook / Microsoft 365',
    category: 'contacts',
    group: 'other',
    icon: 'users',
    supportsSync: true,
    supportsWebhook: false,
    authType: 'oauth2',
    scopes: [
      'Contacts.ReadWrite',
      'User.Read',
      'offline_access',
    ],
    externalUrl: 'https://outlook.office.com/people/',
    connectMode: 'oauth',
    oauthStartPath: '/connect/microsoft/auth-url',
  };

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
  ) {}

  async authenticate(businessId: string): Promise<{ connected: boolean; authUrl?: string }> {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { msContactsAccessToken: true },
    });
    if (business?.msContactsAccessToken) return { connected: true };
    return {
      connected: false,
      authUrl: `/connect/microsoft/auth-url?businessId=${businessId}`,
    };
  }

  async healthCheck(businessId: string): Promise<ConnectorHealth> {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { msContactsAccessToken: true, msContactsEmail: true, msContactsLastSyncAt: true },
    });
    const realStatus = business?.msContactsAccessToken ? 'connected' : 'disconnected';
    const stored = await this.getConnectorStatus(businessId);
    return {
      status: realStatus,
      lastSyncAt: business?.msContactsLastSyncAt ?? stored?.lastSyncAt ?? null,
      lastErrorAt: stored?.lastErrorAt ?? null,
      lastError: stored?.lastError ?? null,
      errorCount: stored?.errorCount ?? 0,
      syncCount: stored?.syncCount ?? 0,
      connectedAt: stored?.connectedAt ?? null,
      connectedAccount: business?.msContactsEmail ?? stored?.connectedAccount ?? null,
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
      select: { msContactsAccessToken: true },
    });
    return !!business?.msContactsAccessToken;
  }

  async sync(_businessId: string): Promise<ConnectorSyncResult> {
    // Provider pull sync is not yet implemented for this connector. It previously
    // counted local rows and returned success:true, misrepresenting a no-op as a
    // successful provider sync. Real pull sync is future work per connector.
    return {
      success: false,
      itemsSynced: 0,
      unsupported: true,
      code: 'PULL_SYNC_NOT_IMPLEMENTED',
      errors: ['Provider pull sync is not implemented for this connector.'],
      duration: 0,
    };
  }

  async testConnection(
    businessId: string,
  ): Promise<{ success: boolean; error?: string; account?: string }> {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { msContactsAccessToken: true, msContactsEmail: true },
    });
    if (!business?.msContactsAccessToken) {
      return { success: false, error: 'Outlook Contacts not connected' };
    }
    try {
      const res = await fetch('https://graph.microsoft.com/v1.0/me/contacts?$top=1', {
        headers: { Authorization: `Bearer ${business.msContactsAccessToken}` },
      });
      if (!res.ok) return { success: false, error: `Graph API returned ${res.status}` };
      return { success: true, account: business.msContactsEmail ?? undefined };
    } catch (err: any) {
      return { success: false, error: err instanceof Error ? err.message : 'Network error' };
    }
  }

  async smokeTest(businessId: string): Promise<ConnectorSmokeResult> {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { msContactsAccessToken: true, msContactsEmail: true },
    });
    if (!business?.msContactsAccessToken) {
      return { success: false, error: 'Outlook Contacts is not connected' };
    }
    try {
      const res = await fetch('https://graph.microsoft.com/v1.0/me/contacts?$top=3', {
        headers: { Authorization: `Bearer ${business.msContactsAccessToken}` },
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        return {
          success: false,
          error: `Graph API ${res.status}${body ? `: ${body.slice(0, 160)}` : ''}`,
        };
      }
      const data = (await res.json()) as { value?: unknown[] };
      return {
        success: true,
        action: 'Listed Outlook contacts',
        account: business.msContactsEmail ?? undefined,
        detail: `${data.value?.length ?? 0} returned`,
      };
    } catch (err: any) {
      return { success: false, error: err instanceof Error ? err.message : 'Network error' };
    }
  }

  async disconnect(businessId: string): Promise<void> {
    await this.prisma.client.business.update({
      where: { id: businessId },
      data: {
        msContactsAccessToken: null,
        msContactsRefreshToken: null,
        msContactsTokenExpiry: null,
        msContactsEmail: null,
        msContactsDeltaLink: null,
      },
    });
    await this.prisma.client.connectorStatus.upsert({
      where: {
        businessId_connectorType: { businessId, connectorType: 'outlook_contacts' },
      },
      create: { businessId, connectorType: 'outlook_contacts', status: 'disconnected' },
      update: { status: 'disconnected' },
    });
  }

  private async getConnectorStatus(businessId: string) {
    return this.prisma.client.connectorStatus.findUnique({
      where: {
        businessId_connectorType: { businessId, connectorType: 'outlook_contacts' },
      },
    });
  }
}
