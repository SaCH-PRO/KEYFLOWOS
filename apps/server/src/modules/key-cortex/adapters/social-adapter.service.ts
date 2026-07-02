import { Injectable } from '@nestjs/common';
import { ConnectorCommand, ConnectorResult } from '../key-cortex-connector.types';
import { connectorOk, connectorFail } from '../key-cortex-connector.utils';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { SocialService } from '../../social/social.service';
import { SocialConnectionsService } from '../../social/social-connections.service';
import { SocialPublishingService } from '../../social/social-publishing.service';
import { SocialAnalyticsService } from '../../social/social-analytics.service';

/**
 * Typed adapter that exposes the social-media methods expected by
 * KeyCortexConnectorService. Delegates to SocialService, SocialConnectionsService,
 * SocialPublishingService, and SocialAnalyticsService.
 */
@Injectable()
export class SocialAdapterService {
  constructor(
    private readonly social: SocialService,
    private readonly connections: SocialConnectionsService,
    private readonly publishing: SocialPublishingService,
    private readonly analytics: SocialAnalyticsService,
    private readonly prisma: PrismaService,
  ) {}

  async connectAccount(input: {
    businessId: string;
    platform: string;
    handle: string;
    accessToken: string;
  }) {
    return this.connections.upsertConnection(input.businessId, {
      platform: input.platform,
      accountName: input.handle,
      token: input.accessToken,
    });
  }

  async disconnectAccount(input: { businessId: string; accountId: string }) {
    const conn = await this.prisma.client.socialConnection.findFirst({
      where: { id: input.accountId, businessId: input.businessId },
    });
    if (!conn) {
      return { disconnected: false, reason: 'Account not found' };
    }
    await this.connections.deleteConnection(input.businessId, conn.platform, conn.platformId ?? undefined);
    return { disconnected: true, accountId: input.accountId };
  }

  async scheduleSocialPost(input: {
    businessId: string;
    accountId: string;
    body: string;
    mediaUrls?: string[];
    scheduledAt: string;
  }) {
    return this.social.createDraft(
      input.businessId,
      input.body,
      input.mediaUrls ?? [],
      input.scheduledAt,
      input.accountId ? [input.accountId] : undefined,
    );
  }

  async publishNow(input: {
    businessId: string;
    accountId: string;
    body: string;
    mediaUrls?: string[];
  }) {
    const draft = await this.social.createDraft(
      input.businessId,
      input.body,
      input.mediaUrls ?? [],
      undefined,
      input.accountId ? [input.accountId] : undefined,
    );
    const postId = (draft as { id: string }).id;
    return this.social.publishPost(input.businessId, postId, input.accountId ? [input.accountId] : undefined);
  }

  async replyToComment(input: {
    businessId: string;
    accountId: string;
    postId: string;
    commentId: string;
    reply: string;
  }) {
    const conn = await this.prisma.client.socialConnection.findFirst({
      where: { id: input.accountId, businessId: input.businessId },
    });
    return this.prisma.client.socialEngagement.create({
      data: {
        businessId: input.businessId,
        platform: conn?.platform ?? 'UNKNOWN',
        type: 'COMMENT',
        postId: input.postId,
        externalId: input.commentId,
        content: input.reply,
        aiHandled: true,
        aiResponse: input.reply,
      },
    });
  }

  async deleteSocialPost(input: { businessId: string; accountId: string; postId: string }) {
    return this.social.deletePost(input.businessId, input.postId);
  }

  async getConnectedAccounts(input: { businessId: string; platform?: string }) {
    if (input.platform) {
      const conn = await this.connections.getConnection(input.businessId, input.platform);
      return conn ? [conn] : [];
    }
    return this.connections.listConnections(input.businessId);
  }

  async getScheduledPosts(input: {
    businessId: string;
    accountId?: string;
    from?: string;
    to?: string;
  }) {
    const from = input.from ? new Date(input.from) : new Date();
    const to = input.to ? new Date(input.to) : undefined;
    const where: any = {
      businessId: input.businessId,
      status: 'SCHEDULED',
      deletedAt: null,
      scheduledAt: { gte: from },
    };
    if (to) where.scheduledAt.lte = to;
    if (input.accountId) where.channelIds = { has: input.accountId };
    return this.prisma.client.socialPost.findMany({ where, orderBy: { scheduledAt: 'asc' } });
  }

  async getEngagementStats(input: { businessId: string; from: string; to: string }) {
    const overview = await this.analytics.getAnalyticsOverview(input.businessId);
    return {
      totalLikes: overview.totalLikes,
      totalComments: overview.totalComments,
      totalShares: overview.totalShares,
      totalReach: overview.totalReach,
      totalImpressions: overview.totalImpressions,
      platformBreakdown: overview.platformBreakdown,
      period: { from: input.from, to: input.to },
    };
  }

  async getFollowerGrowth(input: { businessId: string; from: string; to: string }) {
    const metrics = await this.analytics.getAccountMetrics(input.businessId);
    return metrics.map((m) => ({
      platform: m.platform,
      followers: m.followers ?? 0,
      engagementRate: m.engagementRate ?? 0,
    }));
  }

  async execute(command: ConnectorCommand): Promise<ConnectorResult> {
    const start = Date.now();
    switch (command.action) {
      case 'connect_account': {
        const connected = await this.connectAccount({
          businessId: command.businessId,
          platform: command.parameters.platform as string,
          handle: command.parameters.handle as string,
          accessToken: command.parameters.accessToken as string,
        });
        return connectorOk(command, start, connected);
      }
      case 'disconnect_account': {
        const disconnected = await this.disconnectAccount({
          businessId: command.businessId,
          accountId: command.parameters.accountId as string,
        });
        return connectorOk(command, start, disconnected);
      }
      case 'schedule_social_post': {
        const scheduled = await this.scheduleSocialPost({
          businessId: command.businessId,
          accountId: command.parameters.accountId as string,
          body: command.parameters.body as string,
          mediaUrls: command.parameters.mediaUrls as string[],
          scheduledAt: command.parameters.scheduledAt as string,
        });
        return connectorOk(command, start, scheduled);
      }
      case 'publish_now': {
        const published = await this.publishNow({
          businessId: command.businessId,
          accountId: command.parameters.accountId as string,
          body: command.parameters.body as string,
          mediaUrls: command.parameters.mediaUrls as string[],
        });
        return connectorOk(command, start, published);
      }
      case 'reply_to_comment': {
        const reply = await this.replyToComment({
          businessId: command.businessId,
          accountId: command.parameters.accountId as string,
          postId: command.parameters.postId as string,
          commentId: command.parameters.commentId as string,
          reply: command.parameters.reply as string,
        });
        return connectorOk(command, start, reply);
      }
      case 'delete_social_post': {
        const deleted = await this.deleteSocialPost({
          businessId: command.businessId,
          accountId: command.parameters.accountId as string,
          postId: command.parameters.postId as string,
        });
        return connectorOk(command, start, deleted);
      }
      case 'get_connected_accounts': {
        const accounts = await this.getConnectedAccounts({
          businessId: command.businessId,
          platform: command.parameters.platform as string,
        });
        return connectorOk(command, start, accounts);
      }
      case 'get_scheduled_posts': {
        const posts = await this.getScheduledPosts({
          businessId: command.businessId,
          accountId: command.parameters.accountId as string,
          from: command.parameters.from as string,
          to: command.parameters.to as string,
        });
        return connectorOk(command, start, posts);
      }
      case 'get_engagement_stats': {
        const stats = await this.getEngagementStats({
          businessId: command.businessId,
          from: command.parameters.from as string,
          to: command.parameters.to as string,
        });
        return connectorOk(command, start, stats);
      }
      case 'get_follower_growth': {
        const growth = await this.getFollowerGrowth({
          businessId: command.businessId,
          from: command.parameters.from as string,
          to: command.parameters.to as string,
        });
        return connectorOk(command, start, growth);
      }
      default:
        return connectorFail(command, start, `Unknown social action: ${command.action}`);
    }
  }
}
