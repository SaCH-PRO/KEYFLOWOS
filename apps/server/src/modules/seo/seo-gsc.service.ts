import { Injectable, Inject, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { lockBusinessMeta } from '../../core/prisma/business-meta';
import { SeoService } from './seo.service';

@Injectable()
export class SeoGoogleSearchConsoleService {
  private readonly logger = new Logger(SeoGoogleSearchConsoleService.name);

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
    const gsc = meta.gsc ?? {};

    return {
      connected: Boolean(gsc.siteUrl && gsc.refreshToken),
      siteUrl: gsc.siteUrl ?? null,
      lastSync: gsc.lastSync ?? null,
    };
  }

  /**
   * FOLLOW3-D13 (review D12-ST-2: metaData.gsc holds the Google OAuth tokens):
   * the connection save, the disconnect and the sync's lastSync stamp read and
   * write metaData under the business row lock (lockBusinessMeta), so none of
   * them writes back a copy that undoes another metaData write (a disconnect,
   * an owner's cleared payment secret) committed meanwhile.
   */
  async saveConnection(businessId: string, data: {
    siteUrl: string;
    accessToken?: string;
    refreshToken?: string;
  }) {
    await this.prisma.client.$transaction(async (tx) => {
      const business = await lockBusinessMeta(tx, businessId, { live: true });
      if (!business) throw new Error('Business not found');

      const meta = (business.metaData as Record<string, any>) ?? {};
      const gsc = {
        ...(meta.gsc ?? {}),
        siteUrl: data.siteUrl,
        ...(data.accessToken ? { accessToken: data.accessToken } : {}),
        ...(data.refreshToken ? { refreshToken: data.refreshToken } : {}),
        connectedAt: new Date().toISOString(),
      };

      await tx.business.update({
        where: { id: businessId },
        data: { metaData: { ...meta, gsc } },
      });
    });

    return { connected: true, siteUrl: data.siteUrl };
  }

  async disconnectGsc(businessId: string) {
    await this.prisma.client.$transaction(async (tx) => {
      const business = await lockBusinessMeta(tx, businessId, { live: true });
      if (!business) return;

      const meta = (business.metaData as Record<string, any>) ?? {};
      delete meta.gsc;

      await tx.business.update({
        where: { id: businessId },
        data: { metaData: meta },
      });
    });

    return { disconnected: true };
  }

  async syncSearchData(businessId: string, days = 28) {
    const status = await this.getConnectionStatus(businessId);
    if (!status.connected) {
      return {
        synced: false,
        reason: 'Google Search Console is not connected. Please connect your account first.',
      };
    }

    const business = await this.prisma.client.business.findFirst({
      where: { id: businessId, deletedAt: null },
      select: { metaData: true },
    });
    const meta = (business?.metaData as Record<string, any>) ?? {};
    const gsc = meta.gsc ?? {};

    if (!gsc.accessToken) {
      return {
        synced: false,
        reason: 'No access token available. Please reconnect Google Search Console.',
      };
    }

    try {
      const queryRows = await this.fetchSearchAnalytics(gsc.accessToken, gsc.siteUrl, 'query', days);
      const pageRows = await this.fetchSearchAnalytics(gsc.accessToken, gsc.siteUrl, 'page', days);

      const queryResult = await this.seo.ingestSearchConsoleData(businessId, {
        rows: queryRows,
        dimension: 'query',
      });
      const pageResult = await this.seo.ingestSearchConsoleData(businessId, {
        rows: pageRows,
        dimension: 'page',
      });

      // FOLLOW3-D13: the copy read above is stale after the Google fetches (no
      // lock is held across them). Stamp lastSync on the metaData read under
      // the row lock now, and only while Search Console is still connected: a
      // disconnect that committed meanwhile stays disconnected (its tokens are
      // not restored).
      await this.prisma.client.$transaction(async (tx) => {
        const current = await lockBusinessMeta(tx, businessId, { live: true });
        const fresh = (current?.metaData as Record<string, unknown> | null) ?? {};
        const connected = fresh.gsc as Record<string, unknown> | undefined;
        if (!current || !connected) return;
        await tx.business.update({
          where: { id: businessId },
          data: {
            metaData: {
              ...fresh,
              gsc: { ...connected, lastSync: new Date().toISOString() },
            } as Prisma.InputJsonValue,
          },
        });
      });

      return {
        synced: true,
        queriesUpdated: queryResult.updated,
        pagesUpdated: pageResult.updated,
      };
    } catch (err: any) {
      this.logger.error(`GSC sync failed: ${(err as Error).message}`);
      return {
        synced: false,
        reason: `Sync failed: ${(err as Error).message}`,
      };
    }
  }

  private async fetchSearchAnalytics(
    accessToken: string,
    siteUrl: string,
    dimension: 'query' | 'page',
    days: number,
  ): Promise<Array<{ keys: string[]; clicks: number; impressions: number; ctr: number; position: number }>> {
    const endDate = new Date().toISOString().slice(0, 10);
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        startDate,
        endDate,
        dimensions: [dimension],
        rowLimit: 200,
      }),
    });

    if (!res.ok) {
      throw new Error(`GSC API error: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    return data.rows ?? [];
  }
}
