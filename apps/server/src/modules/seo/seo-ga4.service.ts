import { Injectable, Inject, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { SeoService } from './seo.service';

@Injectable()
export class SeoGoogleAnalyticsService {
  private readonly logger = new Logger(SeoGoogleAnalyticsService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SeoService) private readonly seo: SeoService,
  ) {}

  async getConnectionStatus(businessId: string) {
    const business = await this.prisma.client.business.findFirst({
      where: { id: businessId, deletedAt: null },
      select: { metaData: true },
    });
    const meta = (business?.metaData as Record<string, any>) ?? {};
    const ga4 = meta.ga4 ?? {};

    return {
      connected: Boolean(ga4.propertyId && ga4.refreshToken),
      propertyId: ga4.propertyId ?? null,
      lastSync: ga4.lastSync ?? null,
    };
  }

  async saveConnection(businessId: string, data: {
    propertyId: string;
    accessToken?: string;
    refreshToken?: string;
  }) {
    const business = await this.prisma.client.business.findFirst({
      where: { id: businessId, deletedAt: null },
      select: { metaData: true },
    });
    if (!business) throw new Error('Business not found');

    const meta = (business.metaData as Record<string, any>) ?? {};
    const ga4 = {
      ...(meta.ga4 ?? {}),
      propertyId: data.propertyId,
      ...(data.accessToken ? { accessToken: data.accessToken } : {}),
      ...(data.refreshToken ? { refreshToken: data.refreshToken } : {}),
      connectedAt: new Date().toISOString(),
    };

    await this.prisma.client.business.update({
      where: { id: businessId },
      data: { metaData: { ...meta, ga4 } },
    });

    return { connected: true, propertyId: data.propertyId };
  }

  async disconnectGa4(businessId: string) {
    const business = await this.prisma.client.business.findFirst({
      where: { id: businessId, deletedAt: null },
      select: { metaData: true },
    });
    if (!business) return { disconnected: true };

    const meta = (business.metaData as Record<string, any>) ?? {};
    delete meta.ga4;

    await this.prisma.client.business.update({
      where: { id: businessId },
      data: { metaData: meta },
    });

    return { disconnected: true };
  }

  async syncAnalyticsData(businessId: string, days = 28) {
    const status = await this.getConnectionStatus(businessId);
    if (!status.connected) {
      return {
        synced: false,
        reason: 'Google Analytics 4 is not connected. Please connect your account first.',
      };
    }

    const business = await this.prisma.client.business.findFirst({
      where: { id: businessId, deletedAt: null },
      select: { metaData: true },
    });
    const meta = (business?.metaData as Record<string, any>) ?? {};
    const ga4 = meta.ga4 ?? {};

    if (!ga4.accessToken) {
      return {
        synced: false,
        reason: 'No access token available. Please reconnect Google Analytics.',
      };
    }

    try {
      const rows = await this.fetchAnalyticsData(ga4.accessToken, ga4.propertyId, days);

      const result = await this.seo.ingestAnalyticsData(businessId, { rows });

      await this.prisma.client.business.update({
        where: { id: businessId },
        data: {
          metaData: {
            ...meta,
            ga4: { ...ga4, lastSync: new Date().toISOString() },
          },
        },
      });

      return {
        synced: true,
        pagesUpdated: result.updated,
      };
    } catch (err) {
      this.logger.error(`GA4 sync failed: ${(err as Error).message}`);
      return {
        synced: false,
        reason: `Sync failed: ${(err as Error).message}`,
      };
    }
  }

  private async fetchAnalyticsData(
    accessToken: string,
    propertyId: string,
    days: number,
  ): Promise<Array<{
    pagePath: string;
    sessions: number;
    bounceRate: number;
    avgSessionDuration: number;
    conversions: number;
    revenue: number;
  }>> {
    const url = `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'today' }],
        dimensions: [{ name: 'pagePath' }],
        metrics: [
          { name: 'sessions' },
          { name: 'bounceRate' },
          { name: 'averageSessionDuration' },
          { name: 'conversions' },
          { name: 'totalRevenue' },
        ],
        dimensionFilter: {
          filter: {
            fieldName: 'sessionDefaultChannelGroup',
            stringFilter: { value: 'Organic Search' },
          },
        },
        limit: 200,
      }),
    });

    if (!res.ok) {
      throw new Error(`GA4 API error: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    const rows = data.rows ?? [];

    return rows.map((r: any) => ({
      pagePath: r.dimensionValues?.[0]?.value ?? '',
      sessions: parseInt(r.metricValues?.[0]?.value ?? '0', 10),
      bounceRate: parseFloat(r.metricValues?.[1]?.value ?? '0'),
      avgSessionDuration: parseFloat(r.metricValues?.[2]?.value ?? '0'),
      conversions: parseInt(r.metricValues?.[3]?.value ?? '0', 10),
      revenue: parseFloat(r.metricValues?.[4]?.value ?? '0'),
    }));
  }
}
