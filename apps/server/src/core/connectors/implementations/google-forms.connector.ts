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
export class GoogleFormsConnector implements IConnector {
  private readonly logger = new Logger(GoogleFormsConnector.name);

  readonly meta: ConnectorMeta = {
    type: 'google_forms',
    name: 'Google Forms',
    description: 'Create forms, capture submissions, and pull responses',
    category: 'forms',
    group: 'google',
    icon: 'clipboard-list',
    supportsSync: true,
    supportsWebhook: false,
    authType: 'oauth2',
    scopes: [
      'https://www.googleapis.com/auth/forms.body',
      'https://www.googleapis.com/auth/forms.responses.readonly',
      'https://www.googleapis.com/auth/userinfo.email',
    ],
    externalUrl: 'https://docs.google.com/forms',
  };

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
  ) {}

  async authenticate(businessId: string): Promise<{ connected: boolean; authUrl?: string }> {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { formsAccessToken: true },
    });
    if (business?.formsAccessToken) return { connected: true };
    return { connected: false, authUrl: `/connect/google-suite/auth-url?service=forms&businessId=${businessId}` };
  }

  async healthCheck(businessId: string): Promise<ConnectorHealth> {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { formsAccessToken: true, formsEmail: true },
    });
    const realStatus = business?.formsAccessToken ? 'connected' : 'disconnected';
    const stored = await this.getConnectorStatus(businessId);
    return {
      status: realStatus,
      lastSyncAt: stored?.lastSyncAt ?? null,
      lastErrorAt: stored?.lastErrorAt ?? null,
      lastError: stored?.lastError ?? null,
      errorCount: stored?.errorCount ?? 0,
      syncCount: stored?.syncCount ?? 0,
      connectedAt: stored?.connectedAt ?? null,
      connectedAccount: business?.formsEmail ?? stored?.connectedAccount ?? null,
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
      select: { formsAccessToken: true },
    });
    return !!business?.formsAccessToken;
  }

  async sync(businessId: string): Promise<ConnectorSyncResult> {
    const start = Date.now();
    const connected = await this.isConnected(businessId);
    if (!connected) {
      return { success: false, itemsSynced: 0, errors: ['Google Forms not connected'], duration: Date.now() - start };
    }
    await this.prisma.client.connectorStatus.upsert({
      where: { businessId_connectorType: { businessId, connectorType: 'google_forms' } },
      create: { businessId, connectorType: 'google_forms', status: 'connected', lastSyncAt: new Date(), syncCount: 1 },
      update: { lastSyncAt: new Date(), syncCount: { increment: 1 }, status: 'connected' },
    });
    return { success: true, itemsSynced: 0, errors: [], duration: Date.now() - start };
  }

  async testConnection(businessId: string): Promise<{ success: boolean; error?: string; account?: string }> {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { formsAccessToken: true, formsEmail: true },
    });
    if (!business?.formsAccessToken) return { success: false, error: 'Google Forms not connected' };
    try {
      const res = await fetch('https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=' + business.formsAccessToken);
      if (!res.ok) return { success: false, error: `Token check returned ${res.status}` };
      return { success: true, account: business.formsEmail ?? undefined };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Network error' };
    }
  }

  async smokeTest(businessId: string): Promise<ConnectorSmokeResult> {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { formsAccessToken: true, formsEmail: true },
    });
    if (!business?.formsAccessToken) return { success: false, error: 'Google Forms is not connected' };
    try {
      // Forms-owned files live in Drive; list mimeType=application/vnd.google-apps.form
      // using the user's drive scope (granted alongside the Forms OAuth in this app).
      const res = await fetch(
        "https://www.googleapis.com/drive/v3/files?q=" +
          encodeURIComponent("mimeType='application/vnd.google-apps.form' and trashed=false") +
          '&pageSize=10&fields=files(id,name)',
        { headers: { Authorization: `Bearer ${business.formsAccessToken}` } },
      );
      if (!res.ok) {
        return { success: false, error: `Drive listing for forms ${res.status}` };
      }
      const data = (await res.json()) as { files?: Array<{ id: string; name?: string }> };
      const count = data.files?.length ?? 0;
      return {
        success: true,
        action: 'Listed Google Forms via Drive',
        account: business.formsEmail ?? undefined,
        detail: count
          ? `${count} form(s)${data.files?.[0]?.name ? ` • latest: "${data.files[0].name.slice(0, 40)}"` : ''}`
          : 'No forms found in this account',
      };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Network error' };
    }
  }

  async disconnect(businessId: string): Promise<void> {
    await this.prisma.client.business.update({
      where: { id: businessId },
      data: { formsAccessToken: null, formsRefreshToken: null, formsTokenExpiry: null, formsEmail: null },
    });
    await this.prisma.client.connectorStatus.upsert({
      where: { businessId_connectorType: { businessId, connectorType: 'google_forms' } },
      create: { businessId, connectorType: 'google_forms', status: 'disconnected' },
      update: { status: 'disconnected' },
    });
  }

  private async getConnectorStatus(businessId: string) {
    return this.prisma.client.connectorStatus.findUnique({
      where: { businessId_connectorType: { businessId, connectorType: 'google_forms' } },
    });
  }
}
