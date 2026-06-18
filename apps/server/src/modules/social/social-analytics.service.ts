import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { SocialConnectionsService } from './social-connections.service';

export interface PlatformMetrics {
  platform: string;
  likes: number;
  comments: number;
  shares: number;
  reach: number;
  impressions: number;
  saves?: number;
  views?: number;
  clicks?: number;
  followers?: number;
  engagementRate?: number;
}

export interface PostEngagement {
  postId: string;
  platformPostId: string;
  platform: string;
  likes: number;
  comments: number;
  shares: number;
  reach: number;
  impressions: number;
  saves?: number;
  views?: number;
  fetchedAt: string;
}

export interface AnalyticsOverview {
  totalLikes: number;
  totalComments: number;
  totalShares: number;
  totalReach: number;
  totalImpressions: number;
  platformBreakdown: PlatformMetrics[];
  postEngagements: PostEngagement[];
  connectedPlatforms: string[];
  lastUpdated: string;
}

@Injectable()
export class SocialAnalyticsService {
  private readonly logger = new Logger(SocialAnalyticsService.name);
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SocialConnectionsService) private readonly connections: SocialConnectionsService,
  ) {}

  async getAnalyticsOverview(businessId: string): Promise<AnalyticsOverview> {
    const allConnections = await this.connections.listConnections(businessId);
    const activeConnections = allConnections.filter((c: any) => c.status === 'CONNECTED');

    const posts = await this.prisma.client.socialPost.findMany({
      where: {
        businessId,
        status: 'POSTED',
        deletedAt: null,
        publishResults: { not: null as any },
      },
      orderBy: { postedAt: 'desc' },
      take: 50,
    });

    const postEngagements: PostEngagement[] = [];
    const platformTotals: Record<string, PlatformMetrics> = {};

    for (const conn of activeConnections) {
      const platform = conn.platform as string;
      if (!platformTotals[platform]) {
        platformTotals[platform] = {
          platform,
          likes: 0, comments: 0, shares: 0, reach: 0, impressions: 0, saves: 0, views: 0,
        };
      }
    }

    for (const post of posts) {
      const results = post.publishResults as any;
      if (!results || !Array.isArray(results)) continue;

      for (const result of results) {
        if (!result.success || !result.platformPostId) continue;

        const platform = result.platform;
        const conn = activeConnections.find((c: any) => c.platform === platform);
        if (!conn) continue;

        try {
          const engagement = await this.fetchPostEngagement(
            platform,
            result.platformPostId,
            (conn as any).token,
            (conn as any).platformId,
          );

          if (engagement) {
            const pe: PostEngagement = {
              postId: post.id,
              platformPostId: result.platformPostId,
              platform,
              ...engagement,
              fetchedAt: new Date().toISOString(),
            };
            postEngagements.push(pe);

            if (!platformTotals[platform]) {
              platformTotals[platform] = {
                platform,
                likes: 0, comments: 0, shares: 0, reach: 0, impressions: 0, saves: 0, views: 0,
              };
            }
            platformTotals[platform].likes += engagement.likes;
            platformTotals[platform].comments += engagement.comments;
            platformTotals[platform].shares += engagement.shares;
            platformTotals[platform].reach += engagement.reach;
            platformTotals[platform].impressions += engagement.impressions;
            if (engagement.saves) platformTotals[platform].saves = (platformTotals[platform].saves || 0) + engagement.saves;
            if (engagement.views) platformTotals[platform].views = (platformTotals[platform].views || 0) + engagement.views;
          }
        } catch (err) {
            this.logger.warn(`Silently skip failed engagement fetches: ${err instanceof Error ? err.message : err}`);
          }
      }
    }

    const breakdown = Object.values(platformTotals);
    const totalLikes = breakdown.reduce((s, p) => s + p.likes, 0);
    const totalComments = breakdown.reduce((s, p) => s + p.comments, 0);
    const totalShares = breakdown.reduce((s, p) => s + p.shares, 0);
    const totalReach = breakdown.reduce((s, p) => s + p.reach, 0);
    const totalImpressions = breakdown.reduce((s, p) => s + p.impressions, 0);

    for (const p of breakdown) {
      if (p.impressions > 0) {
        p.engagementRate = parseFloat(
          (((p.likes + p.comments + p.shares) / p.impressions) * 100).toFixed(2),
        );
      }
    }

    return {
      totalLikes,
      totalComments,
      totalShares,
      totalReach,
      totalImpressions,
      platformBreakdown: breakdown,
      postEngagements,
      connectedPlatforms: activeConnections.map((c: any) => c.platform),
      lastUpdated: new Date().toISOString(),
    };
  }

  private async fetchPostEngagement(
    platform: string,
    platformPostId: string,
    token: string,
    platformUserId?: string,
  ): Promise<{ likes: number; comments: number; shares: number; reach: number; impressions: number; saves?: number; views?: number } | null> {
    switch (platform) {
      case 'FACEBOOK':
        return this.fetchFacebookEngagement(platformPostId, token);
      case 'INSTAGRAM':
        return this.fetchInstagramEngagement(platformPostId, token);
      case 'LINKEDIN':
        return this.fetchLinkedInEngagement(platformPostId, token);
      case 'TWITTER':
        return this.fetchTwitterEngagement(platformPostId, token);
      case 'TIKTOK':
        return this.fetchTikTokEngagement(platformPostId, token);
      default:
        return null;
    }
  }

  private async fetchFacebookEngagement(postId: string, token: string) {
    try {
      const [postRes, insightsRes] = await Promise.all([
        fetch(`https://graph.facebook.com/v19.0/${postId}?fields=likes.summary(true),comments.summary(true),shares&access_token=${token}`),
        fetch(`https://graph.facebook.com/v19.0/${postId}/insights?metric=post_impressions,post_reach,post_engaged_users&access_token=${token}`),
      ]);

      const postData = await postRes.json() as any;
      const insightsData = await insightsRes.json() as any;

      const likes = postData.likes?.summary?.total_count || 0;
      const comments = postData.comments?.summary?.total_count || 0;
      const shares = postData.shares?.count || 0;

      let reach = 0;
      let impressions = 0;
      if (insightsData.data) {
        for (const metric of insightsData.data) {
          if (metric.name === 'post_reach') reach = metric.values?.[0]?.value || 0;
          if (metric.name === 'post_impressions') impressions = metric.values?.[0]?.value || 0;
        }
      }

      return { likes, comments, shares, reach, impressions };
    } catch {
      return { likes: 0, comments: 0, shares: 0, reach: 0, impressions: 0 };
    }
  }

  private async fetchInstagramEngagement(mediaId: string, token: string) {
    try {
      const [mediaRes, insightsRes] = await Promise.all([
        fetch(`https://graph.facebook.com/v19.0/${mediaId}?fields=like_count,comments_count&access_token=${token}`),
        fetch(`https://graph.facebook.com/v19.0/${mediaId}/insights?metric=impressions,reach,saved,shares&access_token=${token}`),
      ]);

      const mediaData = await mediaRes.json() as any;
      const insightsData = await insightsRes.json() as any;

      const likes = mediaData.like_count || 0;
      const comments = mediaData.comments_count || 0;

      let reach = 0;
      let impressions = 0;
      let saves = 0;
      let shares = 0;
      if (insightsData.data) {
        for (const metric of insightsData.data) {
          if (metric.name === 'reach') reach = metric.values?.[0]?.value || 0;
          if (metric.name === 'impressions') impressions = metric.values?.[0]?.value || 0;
          if (metric.name === 'saved') saves = metric.values?.[0]?.value || 0;
          if (metric.name === 'shares') shares = metric.values?.[0]?.value || 0;
        }
      }

      return { likes, comments, shares, reach, impressions, saves };
    } catch {
      return { likes: 0, comments: 0, shares: 0, reach: 0, impressions: 0 };
    }
  }

  private async fetchLinkedInEngagement(postUrn: string, token: string) {
    try {
      const encodedUrn = encodeURIComponent(postUrn);
      const response = await fetch(
        `https://api.linkedin.com/rest/socialActions/${encodedUrn}?fields=likes,comments`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'LinkedIn-Version': '202401',
            'X-Restli-Protocol-Version': '2.0.0',
          },
        },
      );

      const data = await response.json() as any;

      const likes = data.likesSummary?.totalLikes || data.likes?.paging?.total || 0;
      const comments = data.commentsSummary?.totalFirstLevelComments || data.comments?.paging?.total || 0;

      return { likes, comments, shares: 0, reach: 0, impressions: 0 };
    } catch {
      return { likes: 0, comments: 0, shares: 0, reach: 0, impressions: 0 };
    }
  }

  private async fetchTwitterEngagement(tweetId: string, token: string) {
    try {
      const response = await fetch(
        `https://api.twitter.com/2/tweets/${tweetId}?tweet.fields=public_metrics`,
        {
          headers: { 'Authorization': `Bearer ${token}` },
        },
      );

      const data = await response.json() as any;
      const metrics = data.data?.public_metrics;

      if (!metrics) return { likes: 0, comments: 0, shares: 0, reach: 0, impressions: 0 };

      return {
        likes: metrics.like_count || 0,
        comments: metrics.reply_count || 0,
        shares: metrics.retweet_count + (metrics.quote_count || 0),
        reach: 0,
        impressions: metrics.impression_count || 0,
        views: metrics.impression_count || 0,
      };
    } catch {
      return { likes: 0, comments: 0, shares: 0, reach: 0, impressions: 0 };
    }
  }

  private async fetchTikTokEngagement(publishId: string, token: string) {
    try {
      const response = await fetch(
        'https://open.tiktokapis.com/v2/video/query/?fields=like_count,comment_count,share_count,view_count',
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            filters: { video_ids: [publishId] },
          }),
        },
      );

      const data = await response.json() as any;
      const video = data.data?.videos?.[0];

      if (!video) return { likes: 0, comments: 0, shares: 0, reach: 0, impressions: 0 };

      return {
        likes: video.like_count || 0,
        comments: video.comment_count || 0,
        shares: video.share_count || 0,
        reach: 0,
        impressions: video.view_count || 0,
        views: video.view_count || 0,
      };
    } catch {
      return { likes: 0, comments: 0, shares: 0, reach: 0, impressions: 0 };
    }
  }

  async getAccountMetrics(businessId: string): Promise<PlatformMetrics[]> {
    const allConnections = await this.connections.listConnections(businessId);
    const activeConnections = allConnections.filter((c: any) => c.status === 'CONNECTED');
    const metrics: PlatformMetrics[] = [];

    for (const conn of activeConnections) {
      const platform = conn.platform as string;
      try {
        const m = await this.fetchAccountMetrics(platform, (conn as any).token, (conn as any).platformId);
        if (m) metrics.push({ platform, ...m });
      } catch {
        metrics.push({
          platform,
          likes: 0, comments: 0, shares: 0, reach: 0, impressions: 0,
        });
      }
    }

    return metrics;
  }

  private async fetchAccountMetrics(
    platform: string,
    token: string,
    platformId?: string,
  ): Promise<Omit<PlatformMetrics, 'platform'> | null> {
    switch (platform) {
      case 'FACEBOOK': {
        try {
          if (!platformId) return null;
          const res = await fetch(
            `https://graph.facebook.com/v19.0/${platformId}/insights?metric=page_impressions,page_engaged_users,page_fans&period=day&since=${this.daysAgo(7)}&access_token=${token}`,
          );
          const data = await res.json() as any;
          let impressions = 0;
          let reach = 0;
          let followers = 0;
          if (data.data) {
            for (const metric of data.data) {
              if (metric.name === 'page_impressions') {
                impressions = metric.values?.reduce((s: number, v: any) => s + (v.value || 0), 0) || 0;
              }
              if (metric.name === 'page_engaged_users') {
                reach = metric.values?.reduce((s: number, v: any) => s + (v.value || 0), 0) || 0;
              }
              if (metric.name === 'page_fans') {
                followers = metric.values?.[metric.values.length - 1]?.value || 0;
              }
            }
          }
          return { likes: 0, comments: 0, shares: 0, reach, impressions, followers };
        } catch {
          return null;
        }
      }
      case 'INSTAGRAM': {
        try {
          if (!platformId) return null;
          const res = await fetch(
            `https://graph.facebook.com/v19.0/${platformId}/insights?metric=impressions,reach,follower_count&period=day&since=${this.daysAgo(7)}&access_token=${token}`,
          );
          const data = await res.json() as any;
          let impressions = 0;
          let reach = 0;
          let followers = 0;
          if (data.data) {
            for (const metric of data.data) {
              if (metric.name === 'impressions') {
                impressions = metric.values?.reduce((s: number, v: any) => s + (v.value || 0), 0) || 0;
              }
              if (metric.name === 'reach') {
                reach = metric.values?.reduce((s: number, v: any) => s + (v.value || 0), 0) || 0;
              }
              if (metric.name === 'follower_count') {
                followers = metric.values?.[metric.values.length - 1]?.value || 0;
              }
            }
          }
          return { likes: 0, comments: 0, shares: 0, reach, impressions, followers };
        } catch {
          return null;
        }
      }
      default:
        return { likes: 0, comments: 0, shares: 0, reach: 0, impressions: 0 };
    }
  }

  async getPlatformAnalytics(
    _businessId: string,
    platform: string,
  ): Promise<PlatformMetrics> {
    return {
      platform,
      likes: 0,
      comments: 0,
      shares: 0,
      reach: 0,
      impressions: 0,
    };
  }

  private daysAgo(days: number): string {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString().split('T')[0];
  }
}
