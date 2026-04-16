import { Injectable, Inject, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { IConnector, ConnectorMeta, ConnectorHealth, ConnectorSyncResult, ConnectorStatusSummary } from '../connector.interface';

@Injectable()
export class GoogleDriveConnector implements IConnector {
  private readonly logger = new Logger(GoogleDriveConnector.name);

  readonly meta: ConnectorMeta = {
    type: 'google_drive',
    name: 'Google Drive',
    description: 'Store documents and sync spreadsheets with Google Drive',
    category: 'storage',
    icon: 'hard-drive',
    supportsSync: true,
    supportsWebhook: false,
    authType: 'oauth2',
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
