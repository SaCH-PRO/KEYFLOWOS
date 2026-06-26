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
export class GoogleBusinessProfileConnector implements IConnector {
  private readonly logger = new Logger(GoogleBusinessProfileConnector.name);

  readonly meta: ConnectorMeta = {
    type: 'google_business_profile',
    name: 'Google Business Profile',
    description: 'Manage business locations, posts, and reviews on Google',
    category: 'profile',
    group: 'google',
    icon: 'store',
    supportsSync: true,
    supportsWebhook: false,
    authType: 'oauth2',
    scopes: [
      'https://www.googleapis.com/auth/business.manage',
      'https://www.googleapis.com/auth/userinfo.email',
    ],
    externalUrl: 'https://business.google.com',
  };

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
  ) {}

  async authenticate(businessId: string): Promise<{ connected: boolean; authUrl?: string }> {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { bpAccessToken: true },
    });
    if (business?.bpAccessToken) return { connected: true };
    return {
      connected: false,
      authUrl: `/connect/google-suite/auth-url?service=business_profile&businessId=${businessId}`,
    };
  }

  async healthCheck(businessId: string): Promise<ConnectorHealth> {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { bpAccessToken: true, bpEmail: true },
    });
    const realStatus = business?.bpAccessToken ? 'connected' : 'disconnected';
    const stored = await this.getConnectorStatus(businessId);
    return {
      status: realStatus,
      lastSyncAt: stored?.lastSyncAt ?? null,
      lastErrorAt: stored?.lastErrorAt ?? null,
      lastError: stored?.lastError ?? null,
      errorCount: stored?.errorCount ?? 0,
      syncCount: stored?.syncCount ?? 0,
      connectedAt: stored?.connectedAt ?? null,
      connectedAccount: business?.bpEmail ?? stored?.connectedAccount ?? null,
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
      select: { bpAccessToken: true },
    });
    return !!business?.bpAccessToken;
  }

  async sync(businessId: string): Promise<ConnectorSyncResult> {
    const start = Date.now();
    const connected = await this.isConnected(businessId);
    if (!connected) {
      return { success: false, itemsSynced: 0, errors: ['Business Profile not connected'], duration: Date.now() - start };
    }
    await this.prisma.client.connectorStatus.upsert({
      where: { businessId_connectorType: { businessId, connectorType: 'google_business_profile' } },
      create: { businessId, connectorType: 'google_business_profile', status: 'connected', lastSyncAt: new Date(), syncCount: 1 },
      update: { lastSyncAt: new Date(), syncCount: { increment: 1 }, status: 'connected' },
    });
    return { success: true, itemsSynced: 0, errors: [], duration: Date.now() - start };
  }

  async testConnection(businessId: string): Promise<{ success: boolean; error?: string; account?: string }> {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { bpAccessToken: true, bpEmail: true },
    });
    if (!business?.bpAccessToken) return { success: false, error: 'Business Profile not connected' };
    try {
      const res = await fetch('https://mybusinessaccountmanagement.googleapis.com/v1/accounts', {
        headers: { Authorization: `Bearer ${business.bpAccessToken}` },
      });
      if (!res.ok) return { success: false, error: `Business Profile API returned ${res.status}` };
      return { success: true, account: business.bpEmail ?? undefined };
    } catch (err: any) {
      return { success: false, error: err instanceof Error ? err.message : 'Network error' };
    }
  }

  async smokeTest(businessId: string): Promise<ConnectorSmokeResult> {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { bpAccessToken: true, bpEmail: true, bpAccountId: true },
    });
    if (!business?.bpAccessToken) return { success: false, error: 'Business Profile is not connected' };
    try {
      const headers = { Authorization: `Bearer ${business.bpAccessToken}` };
      let accountResource = business.bpAccountId ? `accounts/${business.bpAccountId}` : null;
      if (!accountResource) {
        const accRes = await fetch('https://mybusinessaccountmanagement.googleapis.com/v1/accounts', { headers });
        if (!accRes.ok) {
          const body = await accRes.text().catch(() => '');
          return { success: false, error: `Business Profile accounts ${accRes.status}${body ? `: ${body}` : ''}` };
        }
        const accData = (await accRes.json()) as { accounts?: Array<{ name?: string }> };
        accountResource = accData.accounts?.[0]?.name ?? null;
      }
      if (!accountResource) {
        return {
          success: false,
          error: 'No Business Profile accounts found for this token',
          account: business.bpEmail ?? undefined,
        };
      }
      const locRes = await fetch(
        `https://mybusinessbusinessinformation.googleapis.com/v1/${accountResource}/locations?pageSize=1&readMask=name,title,storeCode`,
        { headers },
      );
      if (!locRes.ok) {
        const body = await locRes.text().catch(() => '');
        return {
          success: false,
          error: `Business Profile locations ${locRes.status}${body ? `: ${body}` : ''}`,
          account: business.bpEmail ?? undefined,
        };
      }
      const locData = (await locRes.json()) as {
        locations?: Array<{ name?: string; title?: string; storeCode?: string }>;
      };
      const loc = locData.locations?.[0];
      return {
        success: true,
        action: 'Fetched first active Business Profile location',
        account: business.bpEmail ?? undefined,
        detail: loc?.title
          ? `Location: "${loc.title}"${loc.storeCode ? ` (${loc.storeCode})` : ''}`
          : 'Account is reachable but has no published locations',
      };
    } catch (err: any) {
      return { success: false, error: err instanceof Error ? err.message : 'Network error' };
    }
  }

  async disconnect(businessId: string): Promise<void> {
    await this.prisma.client.business.update({
      where: { id: businessId },
      data: {
        bpAccessToken: null,
        bpRefreshToken: null,
        bpTokenExpiry: null,
        bpEmail: null,
        bpAccountId: null,
        bpLocationId: null,
      },
    });
    await this.prisma.client.connectorStatus.upsert({
      where: { businessId_connectorType: { businessId, connectorType: 'google_business_profile' } },
      create: { businessId, connectorType: 'google_business_profile', status: 'disconnected' },
      update: { status: 'disconnected' },
    });
  }

  private async getConnectorStatus(businessId: string) {
    return this.prisma.client.connectorStatus.findUnique({
      where: { businessId_connectorType: { businessId, connectorType: 'google_business_profile' } },
    });
  }
}
