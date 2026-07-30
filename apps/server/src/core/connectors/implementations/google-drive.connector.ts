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
    } catch (err: any) {
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
      const token = business.driveAccessToken;
      const stamp = new Date().toISOString();
      const boundary = `keyflow-${Date.now().toString(36)}`;
      const metadata = {
        name: `keyflow-smoke-${stamp}.txt`,
        description: 'Automated Keyflow Drive smoke test — safe to delete.',
      };
      const body =
        `--${boundary}\r\n` +
        `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
        `${JSON.stringify(metadata)}\r\n` +
        `--${boundary}\r\n` +
        `Content-Type: text/plain\r\n\r\n` +
        `Keyflow smoke test at ${stamp}\r\n` +
        `--${boundary}--`;
      const createRes = await fetch(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': `multipart/related; boundary=${boundary}`,
          },
          body,
        },
      );
      if (!createRes.ok) {
        const body = await createRes.text().catch(() => '');
        return { success: false, error: `Drive create ${createRes.status}${body ? `: ${body}` : ''}` };
      }
      const file = (await createRes.json()) as { id?: string; webViewLink?: string };
      if (file.id) {
        const trashRes = await fetch(
          `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}`,
          {
            method: 'PATCH',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ trashed: true }),
          },
        );
        if (!trashRes.ok) {
          const body = await trashRes.text().catch(() => '');
          return {
            success: false,
            error: `Created file ${file.id} but trash failed (${trashRes.status})${body ? `: ${body}` : ''} — please remove manually`,
            account: business.driveEmail ?? undefined,
          };
        }
      }
      return {
        success: true,
        action: 'Created and trashed a tiny .txt file on Drive',
        account: business.driveEmail ?? undefined,
        detail: file.webViewLink ?? undefined,
      };
    } catch (err: any) {
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
