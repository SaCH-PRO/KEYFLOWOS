import { Injectable, Inject, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import {
  IConnector,
  ConnectorMeta,
  ConnectorHealth,
  ConnectorSyncResult,
  ConnectorStatusSummary,
} from '../connector.interface';

/**
 * Google Maps connector. Unlike the OAuth-based Google services, this is keyed
 * via a Maps Platform API key stored on the Business record.
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
    externalUrl: 'https://console.cloud.google.com/google/maps-apis',
  };

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
  ) {}

  async authenticate(businessId: string): Promise<{ connected: boolean; authUrl?: string }> {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { googleMapsApiKey: true },
    });
    return { connected: !!business?.googleMapsApiKey };
  }

  async healthCheck(businessId: string): Promise<ConnectorHealth> {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { googleMapsApiKey: true },
    });
    const realStatus = business?.googleMapsApiKey ? 'connected' : 'disconnected';
    const stored = await this.getConnectorStatus(businessId);
    return {
      status: realStatus,
      lastSyncAt: stored?.lastSyncAt ?? null,
      lastErrorAt: stored?.lastErrorAt ?? null,
      lastError: stored?.lastError ?? null,
      errorCount: stored?.errorCount ?? 0,
      syncCount: stored?.syncCount ?? 0,
      connectedAt: stored?.connectedAt ?? null,
      connectedAccount: business?.googleMapsApiKey ? 'API key configured' : null,
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
      select: { googleMapsApiKey: true },
    });
    return !!business?.googleMapsApiKey;
  }

  async sync(_businessId: string): Promise<ConnectorSyncResult> {
    return { success: true, itemsSynced: 0, errors: [], duration: 0 };
  }

  async testConnection(businessId: string): Promise<{ success: boolean; error?: string; account?: string }> {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { googleMapsApiKey: true },
    });
    if (!business?.googleMapsApiKey) return { success: false, error: 'No Google Maps API key configured' };
    try {
      // Cheap zero-result Places call to validate the key.
      const url = new URL('https://maps.googleapis.com/maps/api/place/findplacefromtext/json');
      url.searchParams.set('input', 'test');
      url.searchParams.set('inputtype', 'textquery');
      url.searchParams.set('key', business.googleMapsApiKey);
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
    await this.prisma.client.business.update({
      where: { id: businessId },
      data: { googleMapsApiKey: null },
    });
    await this.prisma.client.connectorStatus.upsert({
      where: { businessId_connectorType: { businessId, connectorType: 'google_maps' } },
      create: { businessId, connectorType: 'google_maps', status: 'disconnected' },
      update: { status: 'disconnected' },
    });
  }

  private async getConnectorStatus(businessId: string) {
    return this.prisma.client.connectorStatus.findUnique({
      where: { businessId_connectorType: { businessId, connectorType: 'google_maps' } },
    });
  }
}
