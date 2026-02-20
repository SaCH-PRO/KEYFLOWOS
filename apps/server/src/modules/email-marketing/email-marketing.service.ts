import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

@Injectable()
export class EmailMarketingService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async listCampaigns(businessId: string) {
    return this.prisma.client.emailCampaign.findMany({
      where: { businessId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { recipients: true } },
      },
    });
  }

  async getCampaign(businessId: string, id: string) {
    return this.prisma.client.emailCampaign.findFirst({
      where: { id, businessId, deletedAt: null },
      include: {
        recipients: true,
      },
    });
  }

  async createCampaign(input: {
    businessId: string;
    name: string;
    subject: string;
    body: string;
    segmentFilter?: any;
    scheduledAt?: string;
  }) {
    return this.prisma.client.emailCampaign.create({
      data: {
        businessId: input.businessId,
        name: input.name,
        subject: input.subject,
        body: input.body,
        segmentFilter: input.segmentFilter ?? null,
        scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
      },
    });
  }

  async updateCampaign(input: {
    businessId: string;
    id: string;
    name?: string;
    subject?: string;
    body?: string;
    segmentFilter?: any;
    scheduledAt?: string;
  }) {
    return this.prisma.client.emailCampaign.update({
      where: { id: input.id, businessId: input.businessId },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.subject !== undefined && { subject: input.subject }),
        ...(input.body !== undefined && { body: input.body }),
        ...(input.segmentFilter !== undefined && { segmentFilter: input.segmentFilter }),
        ...(input.scheduledAt !== undefined && { scheduledAt: new Date(input.scheduledAt) }),
      },
    });
  }

  async deleteCampaign(businessId: string, id: string) {
    return this.prisma.client.emailCampaign.update({
      where: { id, businessId },
      data: { deletedAt: new Date() },
    });
  }

  async sendCampaign(businessId: string, id: string) {
    const campaign = await this.prisma.client.emailCampaign.findFirst({
      where: { id, businessId, deletedAt: null },
    });

    if (!campaign) {
      throw new Error('Campaign not found');
    }

    const filter = campaign.segmentFilter as any;
    const contactWhere: any = { businessId, deletedAt: null, email: { not: null } };

    if (filter) {
      if (filter.tags && filter.tags.length > 0) {
        contactWhere.tags = { hasSome: filter.tags };
      }
      if (filter.status) {
        contactWhere.status = filter.status;
      }
    }

    const contacts = await this.prisma.client.contact.findMany({
      where: contactWhere,
      select: { id: true, email: true },
    });

    const recipientData = contacts
      .filter((c) => c.email)
      .map((c) => ({
        campaignId: id,
        contactId: c.id,
        email: c.email!,
        status: 'SENT',
        sentAt: new Date(),
        businessId,
      }));

    if (recipientData.length > 0) {
      await this.prisma.client.emailCampaignContact.createMany({
        data: recipientData,
        skipDuplicates: true,
      });
    }

    await this.prisma.client.emailCampaign.update({
      where: { id, businessId },
      data: {
        status: 'SENT',
        sentAt: new Date(),
        totalRecipients: recipientData.length,
        sentCount: recipientData.length,
      },
    });

    return { sent: recipientData.length };
  }

  async getCampaignStats(businessId: string, id: string) {
    const campaign = await this.prisma.client.emailCampaign.findFirst({
      where: { id, businessId, deletedAt: null },
      select: {
        id: true,
        name: true,
        status: true,
        totalRecipients: true,
        sentCount: true,
        openCount: true,
        clickCount: true,
        sentAt: true,
      },
    });

    if (!campaign) {
      throw new Error('Campaign not found');
    }

    return campaign;
  }
}
