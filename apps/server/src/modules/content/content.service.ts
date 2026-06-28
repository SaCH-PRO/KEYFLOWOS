import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

export interface CreatePostInput {
  businessId: string;
  title?: string;
  body?: string;
  platform?: string;
  status?: string;
  scheduledAt?: string;
  tags?: string[];
  seoTitle?: string;
  seoDescription?: string;
}

export interface SchedulePostInput {
  businessId: string;
  postId: string;
  scheduledAt: string;
  platform?: string;
}

export interface PublishPostInput {
  businessId: string;
  postId: string;
}

export interface UpdatePostInput {
  businessId: string;
  postId: string;
  title?: string;
  body?: string;
  status?: string;
}

export interface DeletePostInput {
  businessId: string;
  postId: string;
}

export interface CreateCampaignInput {
  businessId: string;
  name: string;
  subject?: string;
  body?: string;
  segment?: string;
  scheduledAt?: string;
}

export interface SendCampaignInput {
  businessId: string;
  campaignId: string;
  testOnly?: boolean;
}

export interface GenerateContentInput {
  businessId: string;
  topic: string;
  platform?: string;
  tone?: string;
  length?: string;
}

export interface SocialAccountInput {
  businessId: string;
  platform: string;
  handle?: string;
  accessToken?: string;
}

export interface SocialAccountReferenceInput {
  businessId: string;
  accountId: string;
}

export interface ScheduleSocialPostInput {
  businessId: string;
  accountId: string;
  body: string;
  mediaUrls?: string[];
  scheduledAt?: string;
}

export interface PublishSocialNowInput {
  businessId: string;
  accountId: string;
  body: string;
  mediaUrls?: string[];
}

export interface ReplyToSocialCommentInput {
  businessId: string;
  accountId: string;
  postId: string;
  commentId: string;
  reply: string;
}

export interface DeleteSocialPostInput {
  businessId: string;
  accountId: string;
  postId: string;
}

@Injectable()
export class ContentService {
  private readonly logger = new Logger(ContentService.name);
  constructor(private readonly prisma: PrismaService) {}

  // ═══════════════════════════════════════════════════════════════════════════
  //  Posts
  // ═══════════════════════════════════════════════════════════════════════════

  async createPost(input: CreatePostInput) {
    const contentType = this.inferContentType(input.platform);
    const status = input.status ? this.normalizeStatus(input.status) : 'Draft';
    return this.prisma.client.outboundContent.create({
      data: {
        businessId: input.businessId,
        contentType,
        subject: input.title,
        body: input.body,
        status,
        scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
        contentMeta: {
          platform: input.platform ?? 'blog',
          tags: input.tags ?? [],
          seoTitle: input.seoTitle,
          seoDescription: input.seoDescription,
        },
      },
    });
  }

  async schedulePost(input: SchedulePostInput) {
    return this.prisma.client.outboundContent.update({
      where: { id: input.postId },
      data: {
        scheduledAt: new Date(input.scheduledAt),
        status: 'Scheduled',
      },
    });
  }

  async publishPost(input: PublishPostInput) {
    return this.prisma.client.outboundContent.update({
      where: { id: input.postId },
      data: {
        status: 'Sent',
        publishedAt: new Date(),
      },
    });
  }

  async updatePost(input: UpdatePostInput) {
    const data: Record<string, unknown> = {};
    if (input.title !== undefined) data.subject = input.title;
    if (input.body !== undefined) data.body = input.body;
    if (input.status !== undefined) data.status = this.normalizeStatus(input.status);
    return this.prisma.client.outboundContent.update({
      where: { id: input.postId },
      data,
    });
  }

  async deletePost(input: DeletePostInput) {
    await this.prisma.client.outboundContent.delete({ where: { id: input.postId } });
    return { deleted: true };
  }

  async getPosts(businessId: string, limit = 50) {
    return this.prisma.client.outboundContent.findMany({
      where: { businessId },
      take: limit,
      orderBy: { createdAt: 'desc' },
    });
  }

  async getPost(businessId: string, id: string) {
    return this.prisma.client.outboundContent.findFirst({ where: { id, businessId } });
  }

  async getDrafts(input: { businessId: string; limit?: number }) {
    return this.prisma.client.outboundContent.findMany({
      where: { businessId: input.businessId, status: 'Draft' },
      take: input.limit ?? 10,
      orderBy: { createdAt: 'desc' },
    });
  }

  async getScheduledPosts(input: { businessId: string; from?: string; limit?: number }) {
    const from = input.from ? new Date(input.from) : new Date();
    return this.prisma.client.outboundContent.findMany({
      where: {
        businessId: input.businessId,
        status: 'Scheduled',
        scheduledAt: { gte: from },
      },
      take: input.limit ?? 10,
      orderBy: { scheduledAt: 'asc' },
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  Campaigns
  // ═══════════════════════════════════════════════════════════════════════════

  async createCampaign(input: CreateCampaignInput) {
    return this.prisma.client.outboundCampaign.create({
      data: {
        businessId: input.businessId,
        name: input.name,
        description: input.subject,
        metadata: {
          body: input.body,
          segment: input.segment,
          scheduledAt: input.scheduledAt,
        },
      },
    });
  }

  async getCampaigns(businessId: string, limit = 50) {
    return this.prisma.client.outboundCampaign.findMany({
      where: { businessId },
      take: limit,
      orderBy: { createdAt: 'desc' },
    });
  }

  async getCampaign(businessId: string, id: string) {
    return this.prisma.client.outboundCampaign.findFirst({ where: { id, businessId } });
  }

  async sendCampaign(input: SendCampaignInput) {
    const campaign = await this.prisma.client.outboundCampaign.update({
      where: { id: input.campaignId },
      data: { status: input.testOnly ? 'draft' : 'sent' },
    });
    return { campaignId: campaign.id, status: campaign.status, testOnly: input.testOnly ?? false };
  }

  async getCampaignPerformance(businessId: string, campaignId: string) {
    const campaign = await this.prisma.client.outboundCampaign.findFirst({
      where: { id: campaignId, businessId },
      include: { contents: true },
    });
    if (!campaign) return null;
    return { sent: campaign.contents.length, opened: 0, clicked: 0, status: campaign.status };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  AI content generation (foundation / Phase-2 bridge)
  // ═══════════════════════════════════════════════════════════════════════════

  async generateContent(input: GenerateContentInput) {
    const platform = input.platform ?? 'blog';
    const tone = input.tone ?? 'professional';
    const length = input.length ?? 'medium';
    return {
      businessId: input.businessId,
      topic: input.topic,
      platform,
      tone,
      length,
      draft: `[${tone}] ${length} content draft about "${input.topic}" for ${platform}.`,
      generatedAt: new Date().toISOString(),
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  Social bridge
  // ═══════════════════════════════════════════════════════════════════════════

  async connectSocialAccount(input: SocialAccountInput) {
    const existing = await this.prisma.client.socialConnection.findFirst({
      where: { businessId: input.businessId, platform: input.platform },
    });
    if (existing) {
      return this.prisma.client.socialConnection.update({
        where: { id: existing.id },
        data: {
          accountName: input.handle,
          token: input.accessToken ?? existing.token,
          status: 'CONNECTED',
        },
      });
    }
    return this.prisma.client.socialConnection.create({
      data: {
        businessId: input.businessId,
        platform: input.platform,
        accountName: input.handle,
        token: input.accessToken ?? 'placeholder-token',
        status: 'CONNECTED',
      },
    });
  }

  async disconnectSocialAccount(input: SocialAccountReferenceInput) {
    await this.prisma.client.socialConnection.delete({ where: { id: input.accountId } });
    return { disconnected: true };
  }

  async scheduleSocialPost(input: ScheduleSocialPostInput) {
    return this.prisma.client.socialPost.create({
      data: {
        businessId: input.businessId,
        content: input.body,
        mediaUrls: input.mediaUrls ?? [],
        status: 'SCHEDULED',
        scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
        channelIds: [input.accountId],
      },
    });
  }

  async publishSocialNow(input: PublishSocialNowInput) {
    return this.prisma.client.socialPost.create({
      data: {
        businessId: input.businessId,
        content: input.body,
        mediaUrls: input.mediaUrls ?? [],
        status: 'POSTED',
        postedAt: new Date(),
        channelIds: [input.accountId],
      },
    });
  }

  async replyToSocialComment(input: ReplyToSocialCommentInput) {
    return this.prisma.client.socialEngagement.create({
      data: {
        businessId: input.businessId,
        platform: 'UNKNOWN',
        type: 'COMMENT',
        postId: input.postId,
        externalId: input.commentId,
        content: input.reply,
        aiHandled: true,
        aiResponse: input.reply,
      },
    });
  }

  async deleteSocialPost(input: DeleteSocialPostInput) {
    await this.prisma.client.socialPost.update({
      where: { id: input.postId },
      data: { deletedAt: new Date() },
    });
    return { deleted: true };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  Analytics
  // ═══════════════════════════════════════════════════════════════════════════

  async getContentStats(businessId: string) {
    const total = await this.prisma.client.outboundContent.count({ where: { businessId } });
    const published = await this.prisma.client.outboundContent.count({
      where: { businessId, status: 'Sent' },
    });
    const scheduled = await this.prisma.client.outboundContent.count({
      where: { businessId, status: 'Scheduled' },
    });
    return { total, published, scheduled };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  Helpers
  // ═══════════════════════════════════════════════════════════════════════════

  private inferContentType(platform?: string): string {
    switch (platform?.toLowerCase()) {
      case 'email':
      case 'newsletter':
        return 'campaign_email';
      case 'sms':
      case 'whatsapp':
        return 'direct_message';
      case 'social':
      case 'facebook':
      case 'instagram':
      case 'linkedin':
      case 'twitter':
      default:
        return 'social_post';
    }
  }

  private normalizeStatus(status: string): string {
    const map: Record<string, string> = {
      draft: 'Draft',
      scheduled: 'Scheduled',
      queued: 'Queued',
      sending: 'Sending',
      sent: 'Sent',
      published: 'Sent',
      active: 'Sending',
      partiallyfailed: 'PartiallyFailed',
      failed: 'Failed',
      cancelled: 'Cancelled',
    };
    return map[status.toLowerCase()] ?? 'Draft';
  }
}
