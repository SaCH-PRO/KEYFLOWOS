import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@keyflow/db';
import { PrismaService } from '../../core/prisma/prisma.service';
import { GoogleTokenHelper } from './google-token.helper';

export interface ScheduledGbpPost {
  id: string;
  location: string;
  summary: string;
  callToAction?: { actionType: string; url: string };
  scheduledFor: string; // ISO
  status: 'scheduled' | 'published' | 'failed' | 'cancelled';
  createdAt: string;
  publishedAt?: string;
  error?: string;
  externalName?: string;
}

interface SchedulerMetadata {
  scheduledPosts?: ScheduledGbpPost[];
}

@Injectable()
export class GoogleBusinessProfileService {
  private readonly logger = new Logger(GoogleBusinessProfileService.name);
  private readonly tokens: GoogleTokenHelper;

  constructor(private readonly prisma: PrismaService) {
    this.tokens = new GoogleTokenHelper(prisma);
  }

  private async accessToken(businessId: string): Promise<string> {
    return this.tokens.getValidAccessToken(
      businessId,
      { access: 'bpAccessToken', refresh: 'bpRefreshToken', expiry: 'bpTokenExpiry' },
      'Google Business Profile',
    );
  }

  async listAccounts(businessId: string) {
    const token = await this.accessToken(businessId);
    const res = await fetch('https://mybusinessaccountmanagement.googleapis.com/v1/accounts', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new BadRequestException(`Business Profile API error ${res.status}`);
    return res.json();
  }

  async listLocations(businessId: string, accountId?: string) {
    const token = await this.accessToken(businessId);
    let account = accountId;
    if (!account) {
      const business = await this.prisma.client.business.findUnique({
        where: { id: businessId },
        select: { bpAccountId: true },
      });
      account = business?.bpAccountId ?? undefined;
    }
    if (!account) {
      const accounts = (await this.listAccounts(businessId)) as {
        accounts?: Array<{ name: string }>;
      };
      account = accounts.accounts?.[0]?.name?.replace('accounts/', '') ?? undefined;
    }
    if (!account) throw new BadRequestException('No Business Profile account found');

    const res = await fetch(
      `https://mybusinessbusinessinformation.googleapis.com/v1/accounts/${encodeURIComponent(account)}/locations?readMask=name,title,storefrontAddress,websiteUri,phoneNumbers,categories`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) throw new BadRequestException(`Business Profile API error ${res.status}`);
    return res.json();
  }

  async setActiveLocation(businessId: string, accountId: string, locationId: string) {
    await this.prisma.client.business.update({
      where: { id: businessId },
      data: { bpAccountId: accountId, bpLocationId: locationId },
    });
    return { accountId, locationId };
  }

  async getLocation(businessId: string, locationName: string) {
    const token = await this.accessToken(businessId);
    const res = await fetch(
      `https://mybusinessbusinessinformation.googleapis.com/v1/${locationName}?readMask=name,title,storefrontAddress,websiteUri,phoneNumbers,categories,regularHours,profile`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) throw new BadRequestException(`Business Profile API error ${res.status}`);
    return res.json();
  }

  async listPosts(businessId: string, locationName: string) {
    const token = await this.accessToken(businessId);
    const res = await fetch(
      `https://mybusiness.googleapis.com/v4/${locationName}/localPosts`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) throw new BadRequestException(`Business Profile API error ${res.status}`);
    return res.json();
  }

  async createPost(
    businessId: string,
    locationName: string,
    post: { summary: string; callToAction?: { actionType: string; url: string } },
  ) {
    const token = await this.accessToken(businessId);
    const res = await fetch(
      `https://mybusiness.googleapis.com/v4/${locationName}/localPosts`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          languageCode: 'en',
          summary: post.summary,
          ...(post.callToAction ? { callToAction: post.callToAction } : {}),
          topicType: 'STANDARD',
        }),
      },
    );
    if (!res.ok) throw new BadRequestException(`Business Profile API error ${res.status}`);
    return res.json();
  }

  async listReviews(businessId: string, locationName: string) {
    const token = await this.accessToken(businessId);
    const res = await fetch(
      `https://mybusiness.googleapis.com/v4/${locationName}/reviews`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) throw new BadRequestException(`Business Profile API error ${res.status}`);
    return res.json();
  }

  async replyToReview(
    businessId: string,
    reviewName: string,
    comment: string,
  ) {
    const token = await this.accessToken(businessId);
    const res = await fetch(
      `https://mybusiness.googleapis.com/v4/${reviewName}/reply`,
      {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment }),
      },
    );
    if (!res.ok) throw new BadRequestException(`Business Profile API error ${res.status}`);
    return res.json();
  }

  /**
   * Pulls performance metrics for a location from the Business Profile
   * Performance API. Returns the raw multiDailyMetricsTimeSeries response so the UI
   * can render charts. Falls back to a friendly message if the API rejects.
   */
  async getInsights(
    businessId: string,
    locationName: string,
    days = 30,
  ): Promise<{
    locationName: string;
    rangeDays: number;
    metrics: Array<{ metric: string; total: number; daily: Array<{ date: string; value: number }> }>;
    generatedAt: string;
  }> {
    const token = await this.accessToken(businessId);
    const end = new Date();
    const start = new Date(end.getTime() - days * 86400000);
    const fmt = (d: Date) => ({
      year: d.getUTCFullYear(),
      month: d.getUTCMonth() + 1,
      day: d.getUTCDate(),
    });
    const params = new URLSearchParams();
    const metrics = [
      'BUSINESS_IMPRESSIONS_DESKTOP_MAPS',
      'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH',
      'BUSINESS_IMPRESSIONS_MOBILE_MAPS',
      'BUSINESS_IMPRESSIONS_MOBILE_SEARCH',
      'BUSINESS_DIRECTION_REQUESTS',
      'CALL_CLICKS',
      'WEBSITE_CLICKS',
      'BUSINESS_CONVERSATIONS',
    ];
    for (const m of metrics) params.append('dailyMetrics', m);
    const s = fmt(start);
    const e = fmt(end);
    params.set('dailyRange.startDate.year', String(s.year));
    params.set('dailyRange.startDate.month', String(s.month));
    params.set('dailyRange.startDate.day', String(s.day));
    params.set('dailyRange.endDate.year', String(e.year));
    params.set('dailyRange.endDate.month', String(e.month));
    params.set('dailyRange.endDate.day', String(e.day));

    const url = `https://businessprofileperformance.googleapis.com/v1/${locationName}:fetchMultiDailyMetricsTimeSeries?${params.toString()}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new BadRequestException(
        `Performance API ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`,
      );
    }
    const data = (await res.json()) as {
      multiDailyMetricTimeSeries?: Array<{
        dailyMetricTimeSeries?: Array<{
          dailyMetric?: string;
          timeSeries?: { datedValues?: Array<{ date?: { year?: number; month?: number; day?: number }; value?: string }> };
        }>;
      }>;
    };

    const out: Array<{ metric: string; total: number; daily: Array<{ date: string; value: number }> }> = [];
    for (const block of data.multiDailyMetricTimeSeries ?? []) {
      for (const series of block.dailyMetricTimeSeries ?? []) {
        const metric = series.dailyMetric ?? 'UNKNOWN';
        const daily: Array<{ date: string; value: number }> = [];
        let total = 0;
        for (const dv of series.timeSeries?.datedValues ?? []) {
          const d = dv.date ?? {};
          const iso = `${d.year ?? 1970}-${String(d.month ?? 1).padStart(2, '0')}-${String(d.day ?? 1).padStart(2, '0')}`;
          const v = Number(dv.value ?? 0) || 0;
          daily.push({ date: iso, value: v });
          total += v;
        }
        out.push({ metric, total, daily });
      }
    }
    return {
      locationName,
      rangeDays: days,
      metrics: out,
      generatedAt: new Date().toISOString(),
    };
  }

  // ---------- Scheduled posts ----------

  private async readMetadata(businessId: string): Promise<SchedulerMetadata> {
    const row = await this.prisma.client.connectorStatus.findUnique({
      where: { businessId_connectorType: { businessId, connectorType: 'google_business_profile' } },
      select: { metadata: true },
    });
    return ((row?.metadata as SchedulerMetadata | null | undefined) ?? {}) as SchedulerMetadata;
  }

  private async writeScheduledPosts(businessId: string, posts: ScheduledGbpPost[]) {
    const existing = await this.prisma.client.connectorStatus.findUnique({
      where: { businessId_connectorType: { businessId, connectorType: 'google_business_profile' } },
      select: { metadata: true },
    });
    const meta = ((existing?.metadata ?? {}) as Record<string, unknown>);
    const merged = { ...meta, scheduledPosts: posts };
    await this.prisma.client.connectorStatus.upsert({
      where: { businessId_connectorType: { businessId, connectorType: 'google_business_profile' } },
      create: {
        businessId,
        connectorType: 'google_business_profile',
        status: 'disconnected',
        metadata: merged as unknown as Prisma.InputJsonValue,
      },
      update: { metadata: merged as unknown as Prisma.InputJsonValue },
    });
  }

  async listScheduledPosts(businessId: string): Promise<ScheduledGbpPost[]> {
    // Opportunistically publish any due posts before returning the list.
    await this.publishDueScheduledPosts(businessId).catch((e) =>
      this.logger.warn(`publishDueScheduledPosts failed: ${(e as Error).message}`),
    );
    const meta = await this.readMetadata(businessId);
    const posts = Array.isArray(meta.scheduledPosts) ? meta.scheduledPosts : [];
    return posts.sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor));
  }

  async schedulePost(
    businessId: string,
    input: {
      location: string;
      summary: string;
      callToAction?: { actionType: string; url: string };
      scheduledFor: string;
    },
  ): Promise<ScheduledGbpPost> {
    if (!input.location) throw new BadRequestException('location required');
    if (!input.summary?.trim()) throw new BadRequestException('summary required');
    const when = new Date(input.scheduledFor);
    if (Number.isNaN(when.getTime())) throw new BadRequestException('Invalid scheduledFor date');
    const id = `sched_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const post: ScheduledGbpPost = {
      id,
      location: input.location,
      summary: input.summary.trim(),
      callToAction: input.callToAction,
      scheduledFor: when.toISOString(),
      status: 'scheduled',
      createdAt: new Date().toISOString(),
    };
    const list = await this.listScheduledPosts(businessId);
    list.push(post);
    await this.writeScheduledPosts(businessId, list);
    return post;
  }

  async cancelScheduledPost(businessId: string, id: string): Promise<{ success: boolean }> {
    const list = await this.listScheduledPosts(businessId);
    const idx = list.findIndex((p) => p.id === id);
    if (idx < 0) throw new NotFoundException('Scheduled post not found');
    if (list[idx].status === 'published') {
      throw new BadRequestException('Cannot cancel a post that already published');
    }
    list[idx] = { ...list[idx], status: 'cancelled' };
    await this.writeScheduledPosts(businessId, list);
    return { success: true };
  }

  /** Publish any scheduled posts whose `scheduledFor` is in the past. */
  async publishDueScheduledPosts(businessId: string): Promise<{ published: number; failed: number }> {
    const meta = await this.readMetadata(businessId);
    const list = Array.isArray(meta.scheduledPosts) ? meta.scheduledPosts : [];
    const now = Date.now();
    let published = 0;
    let failed = 0;
    let mutated = false;
    for (let i = 0; i < list.length; i += 1) {
      const p = list[i];
      if (p.status !== 'scheduled') continue;
      const due = new Date(p.scheduledFor).getTime();
      if (Number.isNaN(due) || due > now) continue;
      try {
        const result = (await this.createPost(businessId, p.location, {
          summary: p.summary,
          callToAction: p.callToAction,
        })) as { name?: string };
        list[i] = {
          ...p,
          status: 'published',
          publishedAt: new Date().toISOString(),
          externalName: result?.name,
        };
        published += 1;
        mutated = true;
      } catch (err: any) {
        list[i] = {
          ...p,
          status: 'failed',
          error: err instanceof Error ? err.message : String(err),
        };
        failed += 1;
        mutated = true;
      }
    }
    if (mutated) await this.writeScheduledPosts(businessId, list);
    return { published, failed };
  }
}
