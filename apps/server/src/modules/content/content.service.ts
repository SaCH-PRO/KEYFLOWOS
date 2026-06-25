import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

@Injectable()
export class ContentService {
  private readonly logger = new Logger(ContentService.name);
  constructor(private readonly prisma: PrismaService) {}

  // Posts
  async createPost(businessId: string, data: any) { return this.prisma.client.outboundContent.create({ data: { ...data, businessId } }); }
  async getPosts(businessId: string, limit = 50) { return this.prisma.client.outboundContent.findMany({ where: { businessId }, take: limit, orderBy: { createdAt: 'desc' } }); }
  async getPost(businessId: string, id: string) { return this.prisma.client.outboundContent.findFirst({ where: { id, businessId } }); }

  // Campaigns
  async createCampaign(businessId: string, data: any) { return this.prisma.client.outboundCampaign.create({ data: { ...data, businessId } }); }
  async getCampaigns(businessId: string, limit = 50) { return this.prisma.client.outboundCampaign.findMany({ where: { businessId }, take: limit, orderBy: { createdAt: 'desc' } }); }
  async getCampaign(businessId: string, id: string) { return this.prisma.client.outboundCampaign.findFirst({ where: { id, businessId } }); }
  async getCampaignPerformance(businessId: string, campaignId: string) {
    const campaign = await this.prisma.client.outboundCampaign.findFirst({ where: { id: campaignId, businessId }, include: { contents: true } });
    if (!campaign) return null;
    return { sent: campaign.contents.length, opened: 0, clicked: 0, status: campaign.status };
 }

  // Scheduling
  async schedulePost(businessId: string, postId: string, scheduledAt: Date) {
    return this.prisma.client.outboundContent.update({ where: { id: postId }, data: { scheduledAt, status: 'scheduled' } });
  }
  async publishPost(businessId: string, postId: string) {
    return this.prisma.client.outboundContent.update({ where: { id: postId }, data: { status: 'published', publishedAt: new Date() } });
  }

  // Analytics
  async getContentStats(businessId: string) {
    const total = await this.prisma.client.outboundContent.count({ where: { businessId } });
    const published = await this.prisma.client.outboundContent.count({ where: { businessId, status: 'published' } });
    const scheduled = await this.prisma.client.outboundContent.count({ where: { businessId, status: 'scheduled' } });
    return { total, published, scheduled };
  }
}
