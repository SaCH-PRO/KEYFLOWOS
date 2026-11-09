import { Injectable, Inject, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { lockBusinessMeta } from '../../core/prisma/business-meta';
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

  /**
   * FOLLOW3-D13 (review D12-ST-2: metaData.ga4 holds the Google OAuth tokens):
   * the connection save, the disconnect and the sync's lastSync stamp read and
   * write metaData under the business row lock (lockBusinessMeta), so none of
   * them writes back a copy that undoes another metaData write (a disconnect,
   * an owner's cleared payment secret) committed meanwhile.
   */
  async saveConnection(businessId: string, data: {
    propertyId: string;
    accessToken?: string;
    refreshToken?: string;
  }) {
    await this.prisma.client.$transaction(async (tx) => {
      const business = await lockBusinessMeta(tx, businessId, { live: true });
      if (!business) throw new Error('Business not found');

      const meta = (business.metaData as Record<string, any>) ?? {};
      const ga4 = {
        ...(meta.ga4 ?? {}),
        propertyId: data.propertyId,
        ...(data.accessToken ? { accessToken: data.accessToken } : {}),
        ...(data.refreshToken ? { refreshToken: data.refreshToken } : {}),
        connectedAt: new Date().toISOString(),
      };

      await tx.business.update({
        where: { id: businessId },
        data: { metaData: { ...meta, ga4 } },
      });
    });

    return { connected: true, propertyId: data.propertyId };
  }

  async disconnectGa4(businessId: string) {
    await this.prisma.client.$transaction(async (tx) => {
      const business = await lockBusinessMeta(tx, businessId, { live: true });
      if (!business) return;

      const meta = (business.metaData as Record<string, any>) ?? {};
      delete meta.ga4;

      await tx.business.update({
        where: { id: businessId },
        data: { metaData: meta },
      });
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

      // FOLLOW3-D13: the copy read above is stale after the Google fetch (no
      // lock is held across it). Stamp lastSync on the metaData read under the
      // row lock now, and only while GA4 is still connected: a disconnect that
      // committed meanwhile stays disconnected (its tokens are not restored).
      await this.prisma.client.$transaction(async (tx) => {
        const current = await lockBusinessMeta(tx, businessId, { live: true });
        const fresh = (current?.metaData as Record<string, unknown> | null) ?? {};
        const connected = fresh.ga4 as Record<string, unknown> | undefined;
        if (!current || !connected) return;
        await tx.business.update({
          where: { id: businessId },
          data: {
            metaData: {
              ...fresh,
              ga4: { ...connected, lastSync: new Date().toISOString() },
            } as Prisma.InputJsonValue,
          },
        });
      });

      return {
        synced: true,
        pagesUpdated: result.updated,
      };
    } catch (err: any) {
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
