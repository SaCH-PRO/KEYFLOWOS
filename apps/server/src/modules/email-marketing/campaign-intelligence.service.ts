import { Inject, Injectable, Logger, Optional, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AiUsageService } from '../ai/ai-usage.service';
import { NotificationsService } from '../notifications/notifications.service';

interface CampaignMetrics {
  campaignId: string;
  campaignName: string;
  subject: string;
  sentAt: Date | null;
  totalRecipients: number;
  sentCount: number;
  openCount: number;
  clickCount: number;
  bouncedCount: number;
  deliveryRate: number;
  openRate: number;
  clickRate: number;
  bounceRate: number;
}

interface HistoricalAverages {
  avgOpenRate: number;
  avgClickRate: number;
  avgDeliveryRate: number;
  avgBounceRate: number;
  totalCampaignsSent: number;
}

interface PreSendWarning {
  severity: 'error' | 'warning' | 'info';
  category: string;
  message: string;
  detail?: string;
  count?: number;
}

interface PreSendValidationResult {
  valid: boolean;
  warnings: PreSendWarning[];
  audienceSummary: {
    totalTargeted: number;
    withEmail: number;
    withoutEmail: number;
    suppressed: number;
    inactive: number;
    healthy: number;
  };
}

interface ContactHealthScore {
  contactId: string;
  contactName: string;
  email: string | null;
  category: 'healthy' | 'at-risk' | 'disengaged';
  campaignsSent: number;
  lastSentAt: Date | null;
  engagementScore: number;
  recommendedAction: string;
}

interface AudienceHealthSummary {
  totalContacts: number;
  healthy: number;
  atRisk: number;
  disengaged: number;
  healthPercentage: number;
  recommendations: string[];
  contacts: ContactHealthScore[];
}

interface SendTimeRecommendation {
  dayOfWeek: string;
  dayIndex: number;
  timeSlot: string;
  score: number;
  campaignCount: number;
  avgOpenRate: number;
  recommendation: string;
  segment?: string;
}

interface SegmentSendTimeResult {
  overall: SendTimeRecommendation[];
  bySegment: Record<string, SendTimeRecommendation[]>;
}

@Injectable()
export class CampaignIntelligenceService {
  private readonly logger = new Logger(CampaignIntelligenceService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
    @Optional() @Inject(AiUsageService) private readonly aiUsage: AiUsageService | null,
    @Optional() @Inject(NotificationsService) private readonly notifications: NotificationsService | null,
  ) {}

  async getCampaignMetrics(businessId: string, campaignId: string): Promise<CampaignMetrics> {
    const campaign = await this.prisma.client.emailCampaign.findFirst({
      where: { id: campaignId, businessId, deletedAt: null },
      include: {
        recipients: {
          select: { status: true },
        },
      },
    });

    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }

    const bouncedCount = campaign.recipients.filter((r) => r.status === 'BOUNCED').length;
    const totalRecipients = campaign.totalRecipients || campaign.recipients.length;
    const sentCount = campaign.sentCount || campaign.recipients.filter((r) => r.status !== 'PENDING').length;

    return {
      campaignId: campaign.id,
      campaignName: campaign.name,
      subject: campaign.subject,
      sentAt: campaign.sentAt,
      totalRecipients,
      sentCount,
      openCount: campaign.openCount,
      clickCount: campaign.clickCount,
      bouncedCount,
      deliveryRate: totalRecipients > 0 ? ((sentCount - bouncedCount) / totalRecipients) * 100 : 0,
      openRate: sentCount > 0 ? (campaign.openCount / sentCount) * 100 : 0,
      clickRate: sentCount > 0 ? (campaign.clickCount / sentCount) * 100 : 0,
      bounceRate: sentCount > 0 ? (bouncedCount / sentCount) * 100 : 0,
    };
  }

  async getHistoricalAverages(businessId: string, excludeCampaignId?: string): Promise<HistoricalAverages> {
    const sentCampaigns = await this.prisma.client.emailCampaign.findMany({
      where: {
        businessId,
        status: 'SENT',
        deletedAt: null,
        ...(excludeCampaignId ? { id: { not: excludeCampaignId } } : {}),
      },
      select: {
        sentCount: true,
        openCount: true,
        clickCount: true,
        recipients: {
          where: { status: 'BOUNCED' },
          select: { id: true },
        },
      },
    });

    if (sentCampaigns.length === 0) {
      return { avgOpenRate: 0, avgClickRate: 0, avgDeliveryRate: 100, avgBounceRate: 0, totalCampaignsSent: 0 };
    }

    const totalSent = sentCampaigns.reduce((sum, c) => sum + c.sentCount, 0);
    const totalOpens = sentCampaigns.reduce((sum, c) => sum + c.openCount, 0);
    const totalClicks = sentCampaigns.reduce((sum, c) => sum + c.clickCount, 0);
    const totalBounced = sentCampaigns.reduce((sum, c) => sum + c.recipients.length, 0);

    return {
      avgOpenRate: totalSent > 0 ? (totalOpens / totalSent) * 100 : 0,
      avgClickRate: totalSent > 0 ? (totalClicks / totalSent) * 100 : 0,
      avgDeliveryRate: totalSent > 0 ? ((totalSent - totalBounced) / totalSent) * 100 : 100,
      avgBounceRate: totalSent > 0 ? (totalBounced / totalSent) * 100 : 0,
      totalCampaignsSent: sentCampaigns.length,
    };
  }

  async generateBriefing(businessId: string, campaignId: string) {
    const existing = await this.prisma.client.campaignBriefing.findUnique({
      where: { campaignId },
    });
    if (existing) return existing;

    const [metrics, averages, campaignDetail] = await Promise.all([
      this.getCampaignMetrics(businessId, campaignId),
      this.getHistoricalAverages(businessId, campaignId),
      this.prisma.client.emailCampaign.findFirst({
        where: { id: campaignId, businessId },
        select: { sentAt: true, segmentFilter: true },
      }),
    ]);

    const openRateDiff = averages.totalCampaignsSent > 0
      ? metrics.openRate - averages.avgOpenRate
      : 0;
    const performanceVsAvg = openRateDiff > 5 ? 'above_average' :
      openRateDiff < -5 ? 'below_average' : 'average';

    const insights: string[] = [];
    if (metrics.openRate > averages.avgOpenRate && averages.totalCampaignsSent > 0) {
      insights.push(`Open rate of ${metrics.openRate.toFixed(1)}% exceeded your average of ${averages.avgOpenRate.toFixed(1)}%`);
    } else if (averages.totalCampaignsSent > 0) {
      insights.push(`Open rate of ${metrics.openRate.toFixed(1)}% was below your average of ${averages.avgOpenRate.toFixed(1)}%`);
    }
    if (metrics.bounceRate > 5) {
      insights.push(`High bounce rate of ${metrics.bounceRate.toFixed(1)}% — consider cleaning your contact list`);
    }
    if (metrics.clickRate > 0) {
      insights.push(`${metrics.clickRate.toFixed(1)}% click rate shows engaged recipients`);
    }

    const recommendations: string[] = [];
    if (metrics.openRate < 15) {
      recommendations.push('Consider testing different subject line styles — urgency, personalization, or questions tend to improve open rates');
    }
    if (metrics.bounceRate > 3) {
      recommendations.push('Review and clean contacts with bounced emails to improve deliverability');
    }
    if (metrics.clickRate === 0 && metrics.openRate > 0) {
      recommendations.push('Emails are being opened but not clicked — improve call-to-action placement and clarity');
    }

    const sentDate = campaignDetail?.sentAt ? new Date(campaignDetail.sentAt) : null;
    const segFilter = campaignDetail?.segmentFilter as Record<string, unknown> | null;
    const segmentLabel = this.deriveSegmentLabel(segFilter);

    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const timingInfo = sentDate
      ? `Sent on: ${dayNames[sentDate.getDay()]} at ${sentDate.getHours()}:${String(sentDate.getMinutes()).padStart(2, '0')}`
      : '';
    const segmentInfo = segFilter
      ? `Audience Segment: ${segmentLabel || 'Custom filter'}`
      : 'Audience Segment: All contacts';

    let aiBriefing: string | null = null;
    if (this.aiUsage) {
      try {
        const prompt = `Analyze this email campaign performance and provide a brief, actionable performance briefing (3-5 sentences).

Campaign: "${metrics.campaignName}"
Subject Line: "${metrics.subject}"
Sent: ${metrics.sentCount} recipients
${timingInfo}
${segmentInfo}
Open Rate: ${metrics.openRate.toFixed(1)}% (business average: ${averages.avgOpenRate.toFixed(1)}%)
Click Rate: ${metrics.clickRate.toFixed(1)}% (business average: ${averages.avgClickRate.toFixed(1)}%)
Bounce Rate: ${metrics.bounceRate.toFixed(1)}%
Delivery Rate: ${metrics.deliveryRate.toFixed(1)}%

Provide specific, actionable insights about what worked and what to improve. Comment on the send timing and whether this audience segment performed well. Compare to the business's historical averages. Be concise and practical.`;

        const result = await this.aiUsage.callAi({
          businessId,
          feature: 'campaign_intelligence',
          messages: [
            { role: 'system', content: 'You are a marketing analytics expert. Provide concise, actionable campaign performance briefings.' },
            { role: 'user', content: prompt },
          ],
          maxTokens: 300,
          temperature: 0.5,
          outputCategory: 'reports',
        });
        aiBriefing = result.content;
      } catch (err) {
        this.logger.warn(`AI briefing generation failed: ${err}`);
      }
    }

    const briefing = await this.prisma.client.campaignBriefing.create({
      data: {
        businessId,
        campaignId,
        deliveryRate: Math.round(metrics.deliveryRate * 100) / 100,
        openRate: Math.round(metrics.openRate * 100) / 100,
        clickRate: Math.round(metrics.clickRate * 100) / 100,
        bounceRate: Math.round(metrics.bounceRate * 100) / 100,
        historicalAvgOpenRate: Math.round(averages.avgOpenRate * 100) / 100,
        historicalAvgClickRate: Math.round(averages.avgClickRate * 100) / 100,
        performanceVsAvg,
        insights,
        recommendations,
        aiBriefing,
        sendTimeAnalysis: sentDate ? {
          dayOfWeek: sentDate.getDay(),
          hour: sentDate.getHours(),
          sentAt: sentDate.toISOString(),
          segment: segmentLabel,
        } : undefined,
      },
    });

    this.events.emit('campaign.briefing_generated', {
      briefingId: briefing.id,
      campaignId,
      businessId,
      performanceVsAvg,
    });

    if (this.notifications) {
      try {
        const emoji = performanceVsAvg === 'above_average' ? '🎯' : performanceVsAvg === 'below_average' ? '📉' : '📊';
        await this.notifications.create({
          businessId,
          type: 'campaign_briefing',
          title: `${emoji} Campaign Briefing: ${metrics.campaignName}`,
          body: aiBriefing || `${metrics.openRate.toFixed(1)}% open rate (avg: ${averages.avgOpenRate.toFixed(1)}%)`,
          data: { campaignId, briefingId: briefing.id, performanceVsAvg },
        });
      } catch (err) {
        this.logger.warn(`Failed to create briefing notification: ${err}`);
      }
    }

    return briefing;
  }

  async getBriefings(businessId: string) {
    return this.prisma.client.campaignBriefing.findMany({
      where: { businessId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: {
        campaign: {
          select: { id: true, name: true, subject: true, sentAt: true, status: true, totalRecipients: true },
        },
      },
    });
  }

  async getBriefingForCampaign(businessId: string, campaignId: string) {
    let briefing = await this.prisma.client.campaignBriefing.findUnique({
      where: { campaignId },
      include: {
        campaign: {
          select: { id: true, name: true, subject: true, sentAt: true, status: true, totalRecipients: true, businessId: true },
        },
      },
    });

    if (briefing && briefing.campaign.businessId !== businessId) {
      throw new NotFoundException('Campaign not found');
    }

    if (!briefing) {
      const campaign = await this.prisma.client.emailCampaign.findFirst({
        where: { id: campaignId, businessId, status: 'SENT', deletedAt: null },
      });
      if (campaign) {
        await this.generateBriefing(businessId, campaignId);
        briefing = await this.prisma.client.campaignBriefing.findUnique({
          where: { campaignId },
          include: {
            campaign: {
              select: { id: true, name: true, subject: true, sentAt: true, status: true, totalRecipients: true, businessId: true },
            },
          },
        });
      }
    }

    return briefing;
  }

  async preSendValidation(businessId: string, campaignId: string): Promise<PreSendValidationResult> {
    const campaign = await this.prisma.client.emailCampaign.findFirst({
      where: { id: campaignId, businessId, deletedAt: null },
    });

    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }

    const filter = campaign.segmentFilter as Record<string, unknown> | null;
    const contactWhere: Prisma.ContactWhereInput = { businessId, deletedAt: null };

    if (filter) {
      if (filter.tags && Array.isArray(filter.tags) && filter.tags.length > 0) {
        contactWhere.tags = { hasSome: filter.tags as string[] };
      }
      if (filter.status && typeof filter.status === 'string') {
        contactWhere.status = filter.status;
      }
    }

    const contacts = await this.prisma.client.contact.findMany({
      where: contactWhere,
      select: {
        id: true,
        email: true,
        doNotContact: true,
        marketingOptIn: true,
        lastInteractionAt: true,
        createdAt: true,
      },
    });

    const withEmail = contacts.filter((c) => c.email);
    const withoutEmail = contacts.filter((c) => !c.email);
    const suppressed = contacts.filter((c) => c.doNotContact === true || c.marketingOptIn === false);
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    const inactive = contacts.filter((c) => {
      if (c.doNotContact || c.marketingOptIn === false) return false;
      if (!c.lastInteractionAt) return false;
      return new Date(c.lastInteractionAt) < ninetyDaysAgo;
    });
    const healthy = contacts.length - withoutEmail.length - suppressed.length - inactive.length;

    const warnings: PreSendWarning[] = [];

    if (withoutEmail.length > 0) {
      warnings.push({
        severity: withoutEmail.length > contacts.length * 0.2 ? 'warning' : 'info',
        category: 'missing_email',
        message: `${withoutEmail.length} of ${contacts.length} targeted contacts have no email address`,
        count: withoutEmail.length,
      });
    }

    if (suppressed.length > 0) {
      warnings.push({
        severity: 'warning',
        category: 'suppressed',
        message: `${suppressed.length} contacts are suppressed (unsubscribed or opted out)`,
        detail: 'These contacts will be excluded from sending',
        count: suppressed.length,
      });
    }

    if (inactive.length > 0) {
      warnings.push({
        severity: inactive.length > contacts.length * 0.3 ? 'warning' : 'info',
        category: 'inactive',
        message: `${inactive.length} contacts haven't engaged in 90+ days`,
        detail: 'Consider a re-engagement campaign for these contacts',
        count: inactive.length,
      });
    }

    if (withEmail.length === 0) {
      warnings.push({
        severity: 'error',
        category: 'no_recipients',
        message: 'No contacts with valid email addresses in this audience',
      });
    }

    if (contacts.length === 0) {
      warnings.push({
        severity: 'error',
        category: 'empty_audience',
        message: 'No contacts match the campaign audience filter',
      });
    }

    if (!campaign.subject || campaign.subject.trim().length === 0) {
      warnings.push({
        severity: 'error',
        category: 'missing_subject',
        message: 'Campaign has no subject line',
      });
    }

    if (!campaign.body || campaign.body.trim().length === 0) {
      warnings.push({
        severity: 'error',
        category: 'missing_body',
        message: 'Campaign has no email body content',
      });
    }

    const hasErrors = warnings.some((w) => w.severity === 'error');

    return {
      valid: !hasErrors,
      warnings,
      audienceSummary: {
        totalTargeted: contacts.length,
        withEmail: withEmail.length,
        withoutEmail: withoutEmail.length,
        suppressed: suppressed.length,
        inactive: inactive.length,
        healthy: Math.max(0, healthy),
      },
    };
  }

  async getAudienceHealth(businessId: string): Promise<AudienceHealthSummary> {
    const contacts = await this.prisma.client.contact.findMany({
      where: { businessId, deletedAt: null, email: { not: null } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        doNotContact: true,
        marketingOptIn: true,
        lastInteractionAt: true,
        createdAt: true,
      },
    });

    const campaignContacts = await this.prisma.client.emailCampaignContact.findMany({
      where: { businessId },
      select: {
        contactId: true,
        status: true,
        sentAt: true,
      },
    });

    const contactEngagement = new Map<string, { sent: number; opened: number; lastSentAt: Date | null }>();
    for (const cc of campaignContacts) {
      const existing = contactEngagement.get(cc.contactId) || { sent: 0, opened: 0, lastSentAt: null };
      existing.sent++;
      if (cc.status === 'OPENED' || cc.status === 'CLICKED') existing.opened++;
      if (cc.sentAt && (!existing.lastSentAt || cc.sentAt > existing.lastSentAt)) {
        existing.lastSentAt = cc.sentAt;
      }
      contactEngagement.set(cc.contactId, existing);
    }

    const scored: ContactHealthScore[] = contacts.map((c) => {
      const engagement = contactEngagement.get(c.id);
      const name = [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email || 'Unknown';

      if (c.doNotContact || c.marketingOptIn === false) {
        return {
          contactId: c.id,
          contactName: name,
          email: c.email,
          category: 'disengaged' as const,
          campaignsSent: engagement?.sent ?? 0,
          lastSentAt: engagement?.lastSentAt ?? null,
          engagementScore: 0,
          recommendedAction: 'Suppressed — do not send. Consider removing from active lists.',
        };
      }

      const sent = engagement?.sent ?? 0;
      const opened = engagement?.opened ?? 0;

      if (sent === 0) {
        return {
          contactId: c.id,
          contactName: name,
          email: c.email,
          category: 'healthy' as const,
          campaignsSent: 0,
          lastSentAt: null,
          engagementScore: 50,
          recommendedAction: 'New contact — include in next campaign.',
        };
      }

      const engagementRate = sent > 0 ? (opened / sent) * 100 : 0;
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
      const isRecent = engagement?.lastSentAt && engagement.lastSentAt > ninetyDaysAgo;

      let category: 'healthy' | 'at-risk' | 'disengaged';
      let score: number;
      let action: string;

      if (engagementRate >= 20 && isRecent) {
        category = 'healthy';
        score = Math.min(100, 50 + engagementRate);
        action = 'Engaged contact — keep in regular campaigns.';
      } else if (engagementRate > 0 || isRecent) {
        category = 'at-risk';
        score = Math.max(10, engagementRate + (isRecent ? 20 : 0));
        action = 'Low engagement — try a re-engagement campaign with a compelling offer.';
      } else {
        category = 'disengaged';
        score = Math.max(0, engagementRate);
        action = 'No engagement detected — consider archiving or running a win-back sequence.';
      }

      return {
        contactId: c.id,
        contactName: name,
        email: c.email,
        category,
        campaignsSent: sent,
        lastSentAt: engagement?.lastSentAt ?? null,
        engagementScore: Math.round(score),
        recommendedAction: action,
      };
    });

    const healthy = scored.filter((c) => c.category === 'healthy').length;
    const atRisk = scored.filter((c) => c.category === 'at-risk').length;
    const disengaged = scored.filter((c) => c.category === 'disengaged').length;

    const recommendations: string[] = [];
    if (disengaged > scored.length * 0.3) {
      recommendations.push(`${disengaged} contacts (${Math.round((disengaged / scored.length) * 100)}%) are disengaged — consider a list cleanup`);
    }
    if (atRisk > scored.length * 0.2) {
      recommendations.push(`${atRisk} contacts are at risk — run a re-engagement campaign before they disengage`);
    }
    if (healthy < scored.length * 0.5) {
      recommendations.push('Less than half your audience is actively engaged — focus on content quality and send frequency');
    }
    if (recommendations.length === 0 && scored.length > 0) {
      recommendations.push('Your audience health looks good! Keep maintaining consistent engagement.');
    }

    return {
      totalContacts: scored.length,
      healthy,
      atRisk,
      disengaged,
      healthPercentage: scored.length > 0 ? Math.round((healthy / scored.length) * 100) : 100,
      recommendations,
      contacts: scored.sort((a, b) => a.engagementScore - b.engagementScore).slice(0, 50),
    };
  }

  async getSendTimeRecommendations(businessId: string): Promise<SegmentSendTimeResult> {
    const campaigns = await this.prisma.client.emailCampaign.findMany({
      where: { businessId, status: 'SENT', deletedAt: null, sentAt: { not: null } },
      select: {
        id: true,
        sentAt: true,
        sentCount: true,
        openCount: true,
        clickCount: true,
        segmentFilter: true,
      },
    });

    if (campaigns.length === 0) {
      return { overall: this.getDefaultRecommendations(), bySegment: {} };
    }

    const overall = this.computeTimeSlotScores(campaigns);
    const segmentGroups = new Map<string, typeof campaigns>();
    for (const campaign of campaigns) {
      const filter = campaign.segmentFilter as Record<string, unknown> | null;
      const segmentLabel = this.deriveSegmentLabel(filter);
      if (segmentLabel) {
        const group = segmentGroups.get(segmentLabel) || [];
        group.push(campaign);
        segmentGroups.set(segmentLabel, group);
      }
    }

    const bySegment: Record<string, SendTimeRecommendation[]> = {};
    for (const [segmentLabel, segCampaigns] of segmentGroups.entries()) {
      if (segCampaigns.length >= 2) {
        bySegment[segmentLabel] = this.computeTimeSlotScores(segCampaigns, segmentLabel);
      }
    }

    return { overall, bySegment };
  }

  private deriveSegmentLabel(filter: Record<string, unknown> | null): string | null {
    if (!filter) return null;
    if (filter.tags && Array.isArray(filter.tags) && filter.tags.length > 0) {
      return `tags:${(filter.tags as string[]).sort().join(',')}`;
    }
    if (filter.status && typeof filter.status === 'string') {
      return `status:${filter.status}`;
    }
    return null;
  }

  private computeTimeSlotScores(
    campaigns: { sentAt: Date | null; sentCount: number; openCount: number; clickCount: number }[],
    segment?: string,
  ): SendTimeRecommendation[] {
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const slots = new Map<string, { count: number; totalOpenRate: number; totalClickRate: number }>();

    for (const campaign of campaigns) {
      if (!campaign.sentAt) continue;
      const date = new Date(campaign.sentAt);
      const dayIndex = date.getDay();
      const hour = date.getHours();
      const timeSlot = hour < 9 ? 'Early Morning (6-9 AM)' :
        hour < 12 ? 'Morning (9 AM-12 PM)' :
        hour < 15 ? 'Early Afternoon (12-3 PM)' :
        hour < 18 ? 'Late Afternoon (3-6 PM)' :
        'Evening (6-9 PM)';

      const key = `${dayIndex}|${timeSlot}`;
      const existing = slots.get(key) || { count: 0, totalOpenRate: 0, totalClickRate: 0 };
      existing.count++;
      const openRate = campaign.sentCount > 0 ? (campaign.openCount / campaign.sentCount) * 100 : 0;
      const clickRate = campaign.sentCount > 0 ? (campaign.clickCount / campaign.sentCount) * 100 : 0;
      existing.totalOpenRate += openRate;
      existing.totalClickRate += clickRate;
      slots.set(key, existing);
    }

    const recommendations: SendTimeRecommendation[] = [];
    for (const [key, data] of slots.entries()) {
      const [dayIndexStr, timeSlot] = key.split('|');
      const dayIndex = parseInt(dayIndexStr, 10);
      const avgOpenRate = data.totalOpenRate / data.count;
      const avgClickRate = data.totalClickRate / data.count;
      const score = (avgOpenRate * 0.7 + avgClickRate * 0.3) * Math.min(data.count / 2, 1);

      recommendations.push({
        dayOfWeek: dayNames[dayIndex],
        dayIndex,
        timeSlot,
        score: Math.round(score * 100) / 100,
        campaignCount: data.count,
        avgOpenRate: Math.round(avgOpenRate * 100) / 100,
        recommendation: score > 30 ? 'Highly recommended' : score > 15 ? 'Good option' : 'Try other times',
        ...(segment ? { segment } : {}),
      });
    }

    recommendations.sort((a, b) => b.score - a.score);

    if (recommendations.length === 0) {
      return this.getDefaultRecommendations();
    }

    return recommendations.slice(0, 10);
  }

  private getDefaultRecommendations(): SendTimeRecommendation[] {
    return [
      { dayOfWeek: 'Tuesday', dayIndex: 2, timeSlot: 'Morning (9 AM-12 PM)', score: 0, campaignCount: 0, avgOpenRate: 0, recommendation: 'Industry best practice — try this time slot first' },
      { dayOfWeek: 'Wednesday', dayIndex: 3, timeSlot: 'Morning (9 AM-12 PM)', score: 0, campaignCount: 0, avgOpenRate: 0, recommendation: 'Mid-week mornings typically perform well' },
      { dayOfWeek: 'Thursday', dayIndex: 4, timeSlot: 'Early Afternoon (12-3 PM)', score: 0, campaignCount: 0, avgOpenRate: 0, recommendation: 'Thursday afternoons are a good alternative' },
    ];
  }

  async checkAndGenerateBriefings(businessId?: string): Promise<number> {
    const fortyEightHoursAgo = new Date();
    fortyEightHoursAgo.setHours(fortyEightHoursAgo.getHours() - 48);

    const where: Prisma.EmailCampaignWhereInput = {
      status: 'SENT',
      deletedAt: null,
      sentAt: {
        lte: fortyEightHoursAgo,
      },
      briefing: null,
      ...(businessId ? { businessId } : {}),
    };

    const campaigns = await this.prisma.client.emailCampaign.findMany({
      where,
      select: { id: true, businessId: true, name: true },
    });

    let generated = 0;
    for (const campaign of campaigns) {
      try {
        await this.generateBriefing(campaign.businessId, campaign.id);
        generated++;
        this.logger.log(`Generated briefing for campaign ${campaign.id} (${campaign.name})`);
      } catch (err) {
        this.logger.error(`Failed to generate briefing for campaign ${campaign.id}`, err);
      }
    }

    return generated;
  }
}
