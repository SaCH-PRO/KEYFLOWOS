import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { createHmac } from 'crypto';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CampaignCreatedPayload, CampaignSentPayload } from '../../core/event-bus/events.types';
import { GmailService } from '../commerce/gmail.service';
import { apiLink } from '../../core/config/runtime-urls';

@Injectable()
export class EmailMarketingService {
  private readonly logger = new Logger(EmailMarketingService.name);
  private readonly statsCache = new Map<string, { data: any; expiresAt: number }>();
  private readonly STATS_TTL = 5 * 60 * 1000;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
    @Optional() @Inject(GmailService) private readonly gmail: GmailService | null,
  ) {}

  private invalidateStatsCache(businessId: string) {
    this.statsCache.delete(`stats:${businessId}`);
  }

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
    const campaign = await this.prisma.client.emailCampaign.create({
      data: {
        businessId: input.businessId,
        name: input.name,
        subject: input.subject,
        body: input.body,
        segmentFilter: input.segmentFilter ?? null,
        scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
      },
    });
    this.events.emit('campaign.created', { campaign, businessId: input.businessId } as CampaignCreatedPayload);
    this.invalidateStatsCache(input.businessId);
    return campaign;
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
    const result = await this.prisma.client.emailCampaign.update({
      where: { id, businessId },
      data: { deletedAt: new Date() },
    });
    this.invalidateStatsCache(businessId);
    return result;
  }

  private get hmacSecret(): string {
    const secret = process.env.GOOGLE_STATE_SECRET || process.env.SUPABASE_JWT_SECRET;
    if (!secret) {
      this.logger.error('HMAC secret not configured — set GOOGLE_STATE_SECRET or SUPABASE_JWT_SECRET environment variable');
      throw new Error('Server misconfiguration: unsubscribe token secret is not set');
    }
    return secret;
  }

  private signPayload(payload: string): string {
    return createHmac('sha256', this.hmacSecret).update(payload).digest('base64url');
  }

  buildUnsubscribeToken(contactId: string, businessId: string, campaignId: string): string {
    const payload = JSON.stringify({ contactId, businessId, campaignId });
    const data = Buffer.from(payload).toString('base64url');
    const sig = this.signPayload(data);
    return `${data}.${sig}`;
  }

  decodeUnsubscribeToken(token: string): { contactId: string; businessId: string; campaignId: string } | null {
    try {
      const [data, sig] = token.split('.');
      if (!data || !sig) return null;
      const expectedSig = this.signPayload(data);
      if (sig !== expectedSig) {
        this.logger.warn('Invalid unsubscribe token signature');
        return null;
      }
      const decoded = Buffer.from(data, 'base64url').toString('utf-8');
      const parsed = JSON.parse(decoded);
      if (parsed.contactId && parsed.businessId) {
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  }

  buildUnsubscribeFooter(contactId: string, businessId: string, campaignId: string): string {
    const token = this.buildUnsubscribeToken(contactId, businessId, campaignId);
    const url = apiLink(`/marketing/unsubscribe/${token}`);
    return `<div style="margin-top:32px;padding-top:16px;border-top:1px solid #e2e8f0;font-size:11px;color:#64748b;text-align:center;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">You're receiving this email because you're a contact of this business. <a href="${url}" style="color:#64748b;text-decoration:underline">Unsubscribe</a> from future emails.</div>`;
  }

  buildTrackingToken(campaignId: string, contactId: string, kind: 'open' | 'click', extra = ''): string {
    const payload = `${kind}:${campaignId}:${contactId}:${extra}`;
    return createHmac('sha256', this.hmacSecret).update(payload).digest('base64url').slice(0, 24);
  }

  verifyTrackingToken(
    token: string,
    campaignId: string,
    contactId: string,
    kind: 'open' | 'click',
    extra = '',
  ): boolean {
    try {
      const expected = this.buildTrackingToken(campaignId, contactId, kind, extra);
      if (token.length !== expected.length) return false;
      let result = 0;
      for (let i = 0; i < expected.length; i++) {
        result |= token.charCodeAt(i) ^ expected.charCodeAt(i);
      }
      return result === 0;
    } catch {
      return false;
    }
  }

  private injectTrackingAndFooter(
    htmlBody: string,
    campaignId: string,
    contactId: string,
    businessId: string,
  ): string {
    const footer = this.buildUnsubscribeFooter(contactId, businessId, campaignId);
    const openToken = this.buildTrackingToken(campaignId, contactId, 'open');
    const openUrl = apiLink(
      `/marketing/track/open/${campaignId}/${contactId}/${openToken}.gif`,
    );
    const pixel = `<img src="${openUrl}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;outline:none" />`;

    let body = htmlBody.replace(
      /href="(https?:\/\/[^"]+)"/gi,
      (_match: string, url: string) => {
        const clickToken = this.buildTrackingToken(campaignId, contactId, 'click', url);
        const wrapped = apiLink(
          `/marketing/track/click/${campaignId}/${contactId}/${clickToken}?r=${encodeURIComponent(url)}`,
        );
        return `href="${wrapped}"`;
      },
    );
    body += footer + pixel;
    return body;
  }

  async recordOpen(campaignId: string, contactId: string) {
    const recipient = await this.prisma.client.emailCampaignContact.findFirst({
      where: { campaignId, contactId },
      select: { id: true, businessId: true, openedAt: true },
    });
    if (!recipient) return;
    if (recipient.openedAt) return;
    await this.prisma.client.emailCampaignContact.update({
      where: { id: recipient.id },
      data: { openedAt: new Date(), status: 'OPENED' },
    });
    await this.prisma.client.emailCampaign.update({
      where: { id: campaignId },
      data: { openCount: { increment: 1 } },
    });
    this.invalidateStatsCache(recipient.businessId);
  }

  async recordClick(campaignId: string, contactId: string) {
    const existing = await this.prisma.client.emailCampaignContact.findFirst({
      where: { campaignId, contactId },
      select: { id: true, businessId: true, clickedAt: true, openedAt: true },
    });
    if (!existing) return;
    const data: { clickedAt?: Date; openedAt?: Date; status?: string } = {};
    let incrementClick = false;
    let incrementOpen = false;
    if (!existing.clickedAt) {
      data.clickedAt = new Date();
      data.status = 'CLICKED';
      incrementClick = true;
    }
    if (!existing.openedAt) {
      data.openedAt = new Date();
      incrementOpen = true;
    }
    if (Object.keys(data).length > 0) {
      await this.prisma.client.emailCampaignContact.update({
        where: { id: existing.id },
        data,
      });
      const counts: { openCount?: { increment: number }; clickCount?: { increment: number } } = {};
      if (incrementOpen) counts.openCount = { increment: 1 };
      if (incrementClick) counts.clickCount = { increment: 1 };
      if (incrementOpen || incrementClick) {
        await this.prisma.client.emailCampaign.update({
          where: { id: campaignId },
          data: counts,
        });
        this.invalidateStatsCache(existing.businessId);
      }
    }
  }

  async getCampaignRecipients(businessId: string, campaignId: string) {
    const recipients = await this.prisma.client.emailCampaignContact.findMany({
      where: { businessId, campaignId },
      orderBy: [{ clickedAt: 'desc' }, { openedAt: 'desc' }, { sentAt: 'desc' }],
      select: {
        id: true,
        contactId: true,
        email: true,
        status: true,
        sentAt: true,
        openedAt: true,
        clickedAt: true,
        bouncedAt: true,
      },
      take: 500,
    });
    const summary = {
      total: recipients.length,
      sent: recipients.filter((r) => r.sentAt).length,
      opened: recipients.filter((r) => r.openedAt).length,
      clicked: recipients.filter((r) => r.clickedAt).length,
      bounced: recipients.filter((r) => r.bouncedAt).length,
    };
    return { recipients, summary };
  }

  async unsubscribeContact(businessId: string, contactId: string) {
    return this.prisma.client.contact.update({
      where: { id: contactId, businessId },
      data: { doNotContact: true },
    });
  }

  async handleUnsubscribeToken(token: string): Promise<{ success: boolean; message: string }> {
    const decoded = this.decodeUnsubscribeToken(token);
    if (!decoded) {
      return { success: false, message: 'Invalid unsubscribe link' };
    }
    try {
      await this.prisma.client.contact.update({
        where: { id: decoded.contactId, businessId: decoded.businessId },
        data: { doNotContact: true },
      });
      return { success: true, message: 'You have been successfully unsubscribed.' };
    } catch (e) {
      this.logger.warn(`Failed to unsubscribe contact ${decoded.contactId}: ${e}`);
      return { success: false, message: 'Unable to process unsubscribe request.' };
    }
  }

  async getSuppressionCount(businessId: string) {
    const count = await this.prisma.client.contact.count({
      where: {
        businessId,
        deletedAt: null,
        OR: [
          { doNotContact: true },
          { marketingOptIn: false },
        ],
      },
    });
    return count;
  }

  async sendCampaign(businessId: string, id: string) {
    const claimed = await this.prisma.client.emailCampaign.updateMany({
      where: {
        id,
        businessId,
        deletedAt: null,
        status: { in: ['DRAFT', 'SCHEDULED'] },
      },
      data: { status: 'SENDING' },
    });

    if (claimed.count === 0) {
      const existing = await this.prisma.client.emailCampaign.findFirst({
        where: { id, businessId, deletedAt: null },
        select: { status: true },
      });
      if (!existing) throw new Error('Campaign not found');
      if (existing.status === 'SENDING') throw new Error('Campaign is already being sent');
      if (existing.status === 'SENT') throw new Error('Campaign has already been sent');
      throw new Error(`Campaign cannot be sent (status: ${existing.status})`);
    }

    try {
      const campaign = await this.prisma.client.emailCampaign.findFirst({
        where: { id, businessId, deletedAt: null },
      });

      if (!campaign) {
        throw new Error('Campaign not found');
      }

      const filter = campaign.segmentFilter as any;
      const contactWhere: any = { businessId, deletedAt: null, email: { not: null } };

      if (filter) {
        if (filter.tags && Array.isArray(filter.tags) && filter.tags.length > 0) {
          contactWhere.tags = { hasSome: filter.tags };
        }
        if (filter.status && typeof filter.status === 'string') {
          contactWhere.status = filter.status;
        }
      }

      const allContacts = await this.prisma.client.contact.findMany({
        where: contactWhere,
        select: { id: true, email: true, doNotContact: true, marketingOptIn: true },
      });

      const suppressed = allContacts.filter(
        (c) => c.doNotContact === true || c.marketingOptIn === false,
      );
      const contacts = allContacts.filter(
        (c) => c.doNotContact !== true && c.marketingOptIn !== false,
      );

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

      let gmailDelivered = 0;
      let gmailFailed = 0;
      let gmailConnected = false;

      if (this.gmail && recipientData.length > 0) {
        try {
          const business = await this.prisma.client.business.findUnique({
            where: { id: businessId },
            select: { gmailEmail: true, gmailAccessToken: true },
          });
          gmailConnected = !!(business?.gmailEmail && business?.gmailAccessToken);

          if (gmailConnected) {
            for (const recipient of recipientData) {
              try {
                const htmlBody = this.injectTrackingAndFooter(
                  campaign.body,
                  id,
                  recipient.contactId,
                  businessId,
                );
                await this.gmail.sendEmail({
                  businessId,
                  to: recipient.email,
                  subject: campaign.subject,
                  htmlBody,
                });
                gmailDelivered++;
                await new Promise((r) => setTimeout(r, 200));
              } catch (err) {
                gmailFailed++;
                this.logger.warn(`Failed to send email to ${recipient.email}: ${err}`);
                await this.prisma.client.emailCampaignContact.updateMany({
                  where: { campaignId: id, contactId: recipient.contactId },
                  data: { status: 'BOUNCED', bouncedAt: new Date() },
                });
              }
            }
          }
        } catch (err) {
          this.logger.warn(`Gmail check failed: ${err}`);
        }
      }

      const updatedCampaign = await this.prisma.client.emailCampaign.update({
        where: { id, businessId },
        data: {
          status: 'SENT',
          sentAt: new Date(),
          totalRecipients: recipientData.length,
          sentCount: recipientData.length,
        },
      });
      this.events.emit('campaign.sent', { campaign: updatedCampaign, businessId, recipientCount: recipientData.length } as CampaignSentPayload);
      this.invalidateStatsCache(businessId);

      const warning = !gmailConnected && recipientData.length > 0
        ? 'Campaign recorded but emails not delivered. Connect Gmail to send real emails.'
        : undefined;

      return {
        sent: recipientData.length,
        suppressed: suppressed.length,
        gmailDelivered,
        gmailFailed,
        warning,
      };
    } catch (err) {
      this.logger.error(`sendCampaign failed for ${id}, reverting to DRAFT`, err);
      await this.prisma.client.emailCampaign.updateMany({
        where: { id, status: 'SENDING' },
        data: { status: 'DRAFT' },
      }).catch(() => {});
      throw err;
    }
  }

  async scheduleCampaign(businessId: string, id: string, scheduledAt: string) {
    const campaign = await this.prisma.client.emailCampaign.findFirst({
      where: { id, businessId, deletedAt: null },
    });

    if (!campaign) {
      throw new Error('Campaign not found');
    }

    const scheduleDate = new Date(scheduledAt);
    if (scheduleDate <= new Date()) {
      throw new Error('Scheduled date must be in the future');
    }

    const result = await this.prisma.client.emailCampaign.update({
      where: { id, businessId },
      data: {
        status: 'SCHEDULED',
        scheduledAt: scheduleDate,
      },
    });
    this.invalidateStatsCache(businessId);
    return result;
  }

  async cancelSchedule(businessId: string, id: string) {
    const campaign = await this.prisma.client.emailCampaign.findFirst({
      where: { id, businessId, deletedAt: null, status: 'SCHEDULED' },
    });

    if (!campaign) {
      throw new Error('Scheduled campaign not found');
    }

    return this.prisma.client.emailCampaign.update({
      where: { id, businessId },
      data: {
        status: 'DRAFT',
        scheduledAt: null,
      },
    });
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

  async getMarketingStats(businessId: string) {
    const cacheKey = `stats:${businessId}`;
    const cached = this.statsCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }

    const [campaigns, forms, totalLeads] = await Promise.all([
      this.prisma.client.emailCampaign.findMany({
        where: { businessId, deletedAt: null },
        select: {
          id: true,
          status: true,
          sentCount: true,
          openCount: true,
          clickCount: true,
        },
      }),
      this.prisma.client.leadForm.findMany({
        where: { businessId, deletedAt: null },
        select: {
          id: true,
          isActive: true,
          _count: { select: { submissions: true } },
        },
      }),
      this.prisma.client.leadFormSubmission.count({
        where: { businessId },
      }),
    ]);

    const totalCampaigns = campaigns.length;
    const sentCampaigns = campaigns.filter((c) => c.status === 'SENT');
    const sentCount = sentCampaigns.reduce((sum, c) => sum + (c.sentCount ?? 0), 0);

    const totalOpens = sentCampaigns.reduce((sum, c) => sum + (c.openCount ?? 0), 0);
    const totalClicks = sentCampaigns.reduce((sum, c) => sum + (c.clickCount ?? 0), 0);
    const avgOpenRate = sentCount > 0 ? Math.round((totalOpens / sentCount) * 10000) / 100 : 0;
    const avgClickRate = sentCount > 0 ? Math.round((totalClicks / sentCount) * 10000) / 100 : 0;

    const activeFormsCount = forms.filter((f) => f.isActive).length;
    const totalFormSubmissions = forms.reduce((sum, f) => sum + f._count.submissions, 0);
    const formConversionRate = totalLeads > 0 && totalFormSubmissions > 0
      ? Math.round((totalFormSubmissions / totalLeads) * 10000) / 100
      : 0;

    const stats = {
      totalCampaigns,
      sentCount,
      avgOpenRate,
      avgClickRate,
      totalLeads,
      formConversionRate,
      activeFormsCount,
    };

    this.statsCache.set(cacheKey, { data: stats, expiresAt: Date.now() + this.STATS_TTL });
    return stats;
  }
}
