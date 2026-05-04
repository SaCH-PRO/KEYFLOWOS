import { Injectable, Inject, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { ConnectorCredentialsService } from '../connector-credentials.service';
import type {
  IConnector,
  ConnectorMeta,
  ConnectorHealth,
  ConnectorSyncResult,
  ConnectorStatusSummary,
} from '../connector.interface';

/**
 * Google Maps connector. Unlike the OAuth-based Google services, this is keyed
 * via a Maps Platform API key. The key is stored in the unified encrypted
 * credentials store (`ConnectorStatus.metadata.encryptedCredentials`); the
 * legacy `Business.googleMapsApiKey` column is still honored as a fallback so
 * pre-existing businesses keep working until they re-save in the new dialog.
 */
@Injectable()
export class GoogleMapsConnector implements IConnector {
  private readonly logger = new Logger(GoogleMapsConnector.name);

  readonly meta: ConnectorMeta = {
    type: 'google_maps',
    name: 'Google Maps',
    description: 'Address autocomplete, place lookup, and embedded maps',
    category: 'maps',
    group: 'google',
    icon: 'map-pin',
    supportsSync: false,
    supportsWebhook: false,
    authType: 'api_key',
    connectMode: 'dialog',
    externalUrl: 'https://console.cloud.google.com/google/maps-apis',
    connectInstructions:
      'Create a Google Maps Platform API key in the Cloud Console (APIs & Services → Credentials), enable the Places API, and paste the key below. Restrict the key to your KEYFLOWOS domain for safety.',
    credentialFields: [
      {
        key: 'apiKey',
        label: 'Google Maps API key',
        type: 'password',
        required: true,
        secret: true,
        placeholder: 'AIza...',
        helpText: 'Needs the Places API enabled. We test the key live before marking the connector as connected.',
      },
    ],
  };

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
    @Inject(ConnectorCredentialsService) private readonly credentials: ConnectorCredentialsService,
  ) {}

  /** Resolve the active key from the credentials store, falling back to the legacy column. */
  async resolveApiKey(businessId: string): Promise<string | null> {
    const creds = await this.credentials.getCredentials(businessId, 'google_maps');
    if (creds?.apiKey?.trim()) return creds.apiKey.trim();
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { googleMapsApiKey: true },
    });
    return business?.googleMapsApiKey?.trim() || null;
  }

  async authenticate(businessId: string): Promise<{ connected: boolean; authUrl?: string }> {
    return { connected: !!(await this.resolveApiKey(businessId)) };
  }

  async healthCheck(businessId: string): Promise<ConnectorHealth> {
    const apiKey = await this.resolveApiKey(businessId);
    const stored = await this.getConnectorStatus(businessId);
    return {
      status: apiKey ? 'connected' : 'disconnected',
      lastSyncAt: stored?.lastSyncAt ?? null,
      lastErrorAt: stored?.lastErrorAt ?? null,
      lastError: stored?.lastError ?? null,
      errorCount: stored?.errorCount ?? 0,
      syncCount: stored?.syncCount ?? 0,
      connectedAt: stored?.connectedAt ?? null,
      connectedAccount: apiKey ? 'API key configured' : null,
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
    return !!(await this.resolveApiKey(businessId));
  }

  async sync(_businessId: string): Promise<ConnectorSyncResult> {
    return { success: true, itemsSynced: 0, errors: [], duration: 0 };
  }

  async testConnection(businessId: string): Promise<{ success: boolean; error?: string; account?: string }> {
    const apiKey = await this.resolveApiKey(businessId);
    if (!apiKey) return { success: false, error: 'No Google Maps API key configured' };
    try {
      // Cheap zero-result Places call to validate the key.
      const url = new URL('https://maps.googleapis.com/maps/api/place/findplacefromtext/json');
      url.searchParams.set('input', 'test');
      url.searchParams.set('inputtype', 'textquery');
      url.searchParams.set('key', apiKey);
      const res = await fetch(url.toString());
      const data = (await res.json()) as { status?: string; error_message?: string };
      if (data.status === 'REQUEST_DENIED' || data.status === 'INVALID_REQUEST') {
        return { success: false, error: data.error_message ?? data.status };
      }
      return { success: true, account: 'API key configured' };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Network error' };
    }
  }

  async disconnect(businessId: string): Promise<void> {
    // Clear both the legacy column and the encrypted credentials store.
    await this.prisma.client.business.update({
      where: { id: businessId },
      data: { googleMapsApiKey: null },
    });
    await this.credentials.clearCredentials(businessId, 'google_maps');
    await this.prisma.client.connectorStatus.upsert({
      where: { businessId_connectorType: { businessId, connectorType: 'google_maps' } },
      create: { businessId, connectorType: 'google_maps', status: 'disconnected' },
      update: { status: 'disconnected', connectedAccount: null },
    });
  }

  private async getConnectorStatus(businessId: string) {
    return this.prisma.client.connectorStatus.findUnique({
      where: { businessId_connectorType: { businessId, connectorType: 'google_maps' } },
    });
  }
}
