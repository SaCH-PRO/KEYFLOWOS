import { Injectable, Inject, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { IConnector, ConnectorMeta, ConnectorHealth, ConnectorSyncResult, ConnectorStatusSummary, ConnectorSmokeResult } from '../connector.interface';

@Injectable()
export class GoogleDriveConnector implements IConnector {
  private readonly logger = new Logger(GoogleDriveConnector.name);

  readonly meta: ConnectorMeta = {
    type: 'google_drive',
    name: 'Google Drive',
    description: 'Browse, upload, edit, and delete files; create Docs and Sheets',
    category: 'storage',
    group: 'google',
    icon: 'hard-drive',
    supportsSync: true,
    supportsWebhook: false,
    authType: 'oauth2',
    scopes: [
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/documents',
      'https://www.googleapis.com/auth/userinfo.email',
    ],
    externalUrl: 'https://drive.google.com',
  };

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
  ) {}

  async authenticate(businessId: string): Promise<{ connected: boolean; authUrl?: string }> {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { driveAccessToken: true },
    });
    if (business?.driveAccessToken) {
      return { connected: true };
    }
    return { connected: false, authUrl: `/drive/businesses/${businessId}/auth-url` };
  }

  async healthCheck(businessId: string): Promise<ConnectorHealth> {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { driveAccessToken: true, driveEmail: true },
    });
    const realStatus = business?.driveAccessToken ? 'connected' : 'disconnected';

    const stored = await this.getConnectorStatus(businessId);
    return {
      status: realStatus,
      lastSyncAt: stored?.lastSyncAt ?? null,
      lastErrorAt: stored?.lastErrorAt ?? null,
      lastError: stored?.lastError ?? null,
      errorCount: stored?.errorCount ?? 0,
      syncCount: stored?.syncCount ?? 0,
      connectedAt: stored?.connectedAt ?? null,
      connectedAccount: business?.driveEmail ?? stored?.connectedAccount ?? null,
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
      select: { driveAccessToken: true },
    });
    return !!business?.driveAccessToken;
  }

  async sync(businessId: string): Promise<ConnectorSyncResult> {
    const start = Date.now();
    const connected = await this.isConnected(businessId);
    if (!connected) {
      return { success: false, itemsSynced: 0, errors: ['Google Drive not connected'], duration: Date.now() - start };
    }

    const docCount = await this.prisma.client.documentInstance.count({
      where: { businessId },
    }).catch(() => 0);

    await this.prisma.client.connectorStatus.upsert({
      where: { businessId_connectorType: { businessId, connectorType: 'google_drive' } },
      create: { businessId, connectorType: 'google_drive', status: 'connected', lastSyncAt: new Date(), syncCount: 1 },
      update: { lastSyncAt: new Date(), syncCount: { increment: 1 }, status: 'connected' },
    });

    return { success: true, itemsSynced: docCount, errors: [], duration: Date.now() - start };
  }

  async testConnection(businessId: string): Promise<{ success: boolean; error?: string; account?: string }> {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { driveAccessToken: true, driveEmail: true },
    });
    if (!business?.driveAccessToken) {
      return { success: false, error: 'Google Drive is not connected' };
    }
    try {
      const res = await fetch('https://www.googleapis.com/drive/v3/about?fields=user', {
        headers: { Authorization: `Bearer ${business.driveAccessToken}` },
      });
      if (!res.ok) {
        return { success: false, error: `Drive API returned ${res.status}` };
      }
      const data = await res.json();
      return { success: true, account: data.user?.emailAddress ?? business.driveEmail ?? undefined };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Network error' };
    }
  }

  async smokeTest(businessId: string): Promise<ConnectorSmokeResult> {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { driveAccessToken: true, driveEmail: true },
    });
    if (!business?.driveAccessToken) return { success: false, error: 'Google Drive is not connected' };
    try {
      const res = await fetch(
        'https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,displayName),storageQuota(limit,usage)',
        { headers: { Authorization: `Bearer ${business.driveAccessToken}` } },
      );
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        return { success: false, error: `Drive API ${res.status}${body ? `: ${body.slice(0, 160)}` : ''}` };
      }
      const data = (await res.json()) as { user?: { emailAddress?: string }; storageQuota?: { usage?: string; limit?: string } };
      await this.trackActivity(businessId);
      const usageGb = data.storageQuota?.usage ? (Number(data.storageQuota.usage) / 1e9).toFixed(2) : null;
      return {
        success: true,
        action: 'Fetched Drive account info',
        account: data.user?.emailAddress ?? business.driveEmail ?? undefined,
        detail: usageGb ? `Using ${usageGb} GB` : undefined,
      };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Network error' };
    }
  }

  async disconnect(businessId: string): Promise<void> {
    await this.prisma.client.business.update({
      where: { id: businessId },
      data: {
        driveEmail: null,
        driveAccessToken: null,
        driveRefreshToken: null,
        driveTokenExpiry: null,
      },
    });
    await this.prisma.client.connectorStatus.upsert({
      where: { businessId_connectorType: { businessId, connectorType: 'google_drive' } },
      create: { businessId, connectorType: 'google_drive', status: 'disconnected' },
      update: { status: 'disconnected' },
    });
  }

  async emitFileUploaded(businessId: string, opts: { fileName: string; mimeType: string; size?: number; url?: string; externalId?: string }) {
    await this.trackActivity(businessId);

    this.events.emit('file.uploaded', {
      connectorType: 'google_drive' as const,
      externalId: opts.externalId ?? null,
      businessId,
      timestamp: new Date(),
      fileName: opts.fileName,
      mimeType: opts.mimeType,
      size: opts.size,
      url: opts.url,
    });
  }

  async emitFileSynced(businessId: string, fileCount: number) {
    await this.trackActivity(businessId);

    this.events.emit('file.synced', {
      connectorType: 'google_drive' as const,
      externalId: null,
      businessId,
      timestamp: new Date(),
      fileCount,
    });
  }

  private async trackActivity(businessId: string) {
    await this.prisma.client.connectorStatus.upsert({
      where: { businessId_connectorType: { businessId, connectorType: 'google_drive' } },
      create: { businessId, connectorType: 'google_drive', status: 'connected', lastSyncAt: new Date(), syncCount: 1 },
      update: { lastSyncAt: new Date(), syncCount: { increment: 1 }, status: 'connected' },
    }).catch((e) => this.logger.warn(`Failed to track drive activity: ${e instanceof Error ? e.message : String(e)}`));
  }

  private async getConnectorStatus(businessId: string) {
    return this.prisma.client.connectorStatus.findUnique({
      where: { businessId_connectorType: { businessId, connectorType: 'google_drive' } },
    });
  }
}
