import { Injectable, Inject, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

@Injectable()
export class GrowthIntelligenceService {
  private readonly logger = new Logger(GrowthIntelligenceService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async generateInsights(businessId: string) {
    const snapshot = await this.prisma.client.businessSnapshot.findFirst({
      where: { businessId },
      orderBy: { snapshotDate: 'desc' },
    });

    if (!snapshot) {
      return { generated: 0 };
    }

    const insights: Array<{
      insightType: string;
      category: string;
      severity: string;
      title: string;
      description: string;
      suggestion?: string;
      suggestedAction?: string;
      expectedOutcome?: string;
      evidence: Record<string, unknown>;
    }> = [];

    // Revenue insights
    if (snapshot.collectionRate !== null && snapshot.collectionRate < 70) {
      insights.push({
        insightType: 'risk',
        category: 'revenue',
        severity: 'critical',
        title: 'Collection rate is below industry average',
        description: `Your collection rate is ${snapshot.collectionRate}%. Industry average is 85%. Consider automated invoice reminders.`,
        suggestion: 'Enable overdue invoice automation flow',
        suggestedAction: 'Enable overdue invoice automation flow',
        expectedOutcome: 'Increase collection rate to 80%+ within 30 days',
        evidence: { collectionRate: snapshot.collectionRate, overdueCount: snapshot.overdueInvoiceCount },
      });
    }

    if (snapshot.growthRate !== null && snapshot.growthRate > 20) {
      insights.push({
        insightType: 'opportunity',
        category: 'revenue',
        severity: 'opportunity',
        title: 'Strong revenue growth detected',
        description: `Revenue grew ${snapshot.growthRate}% this period. Consider increasing marketing spend to capture momentum.`,
        suggestion: 'Launch a targeted campaign to new leads',
        suggestedAction: 'Launch a targeted campaign to new leads',
        expectedOutcome: 'Sustain 15%+ growth rate',
        evidence: { growthRate: snapshot.growthRate, totalRevenue: snapshot.totalRevenue },
      });
    }

    // Customer insights
    if (snapshot.leadConversionRate !== null && snapshot.leadConversionRate < 10) {
      insights.push({
        insightType: 'recommendation',
        category: 'customer_success',
        severity: 'warning',
        title: 'Lead conversion rate needs attention',
        description: `Only ${snapshot.leadConversionRate}% of leads convert. Review your follow-up sequence and response time.`,
        suggestion: 'Implement automated lead nurture flow',
        suggestedAction: 'Implement automated lead nurture flow',
        expectedOutcome: 'Increase conversion to 15%+',
        evidence: { leadConversionRate: snapshot.leadConversionRate, activeLeads: snapshot.activeLeads },
      });
    }

    // Automation insights
    if (snapshot.activeFlows !== null && snapshot.activeFlows === 0) {
      insights.push({
        insightType: 'opportunity',
        category: 'automation',
        severity: 'opportunity',
        title: 'No active automation flows',
        description: 'You have no automation flows running. Businesses with 3+ flows save 8+ hours per week.',
        suggestion: 'Activate the missed-call text-back template',
        suggestedAction: 'Activate the missed-call text-back template',
        expectedOutcome: 'Capture 20%+ more inbound leads',
        evidence: { activeFlows: snapshot.activeFlows },
      });
    }

    // Engagement insights
    if (snapshot.responseRate !== null && snapshot.responseRate < 50) {
      insights.push({
        insightType: 'recommendation',
        category: 'operations',
        severity: 'warning',
        title: 'Customer response rate is low',
        description: `Your response rate is ${snapshot.responseRate}%. Faster responses correlate with higher conversion.`,
        suggestion: 'Set up auto-responses for common inquiries',
        suggestedAction: 'Set up auto-responses for common inquiries',
        expectedOutcome: 'Improve response rate to 70%+',
        evidence: { responseRate: snapshot.responseRate, messagesReceived: snapshot.messagesReceived },
      });
    }

    // Booking insights
    if (snapshot.noShowRate !== null && snapshot.noShowRate > 15) {
      insights.push({
        insightType: 'risk',
        category: 'operations',
        severity: 'critical',
        title: 'High no-show rate detected',
        description: `${snapshot.noShowRate}% of bookings are no-shows. Reminder flows can reduce this by 40%.`,
        suggestion: 'Enable booking reminder automation',
        suggestedAction: 'Enable booking reminder automation',
        expectedOutcome: 'Reduce no-shows to under 10%',
        evidence: { noShowRate: snapshot.noShowRate, totalBookings: snapshot.totalBookings },
      });
    }

    // Storefront insights
    if (snapshot.storefrontVisits !== null && snapshot.storefrontVisits > 100 && snapshot.ordersReceived !== null && snapshot.ordersReceived < 5) {
      insights.push({
        insightType: 'opportunity',
        category: 'marketing',
        severity: 'opportunity',
        title: 'Storefront traffic not converting',
        description: `You have ${snapshot.storefrontVisits} visits but only ${snapshot.ordersReceived} orders. Review your checkout flow.`,
        suggestion: 'Add testimonials and simplify checkout',
        suggestedAction: 'Add testimonials and simplify checkout',
        expectedOutcome: 'Increase conversion rate to 2%+',
        evidence: { visits: snapshot.storefrontVisits, orders: snapshot.ordersReceived },
      });
    }

    // Store insights
    let created = 0;
    for (const insight of insights) {
      const existing = await this.prisma.client.growthInsight.findFirst({
        where: {
          businessId,
          insightType: insight.insightType,
          category: insight.category,
          title: insight.title,
          createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
        },
      });

      if (!existing) {
        await this.prisma.client.growthInsight.create({
          data: {
            businessId,
            ...insight,
          },
        });
        created++;
      }
    }

    return { generated: created, total: insights.length };
  }

  async getInsights(businessId: string, filters: {
    insightType?: string;
    category?: string;
    status?: string;
    limit?: number;
    offset?: number;
  }) {
    const where: Record<string, unknown> = { businessId };
    if (filters.insightType) where.insightType = filters.insightType;
    if (filters.category) where.category = filters.category;
    if (filters.status !== undefined) where.status = filters.status;

    const [items, total] = await Promise.all([
      this.prisma.client.growthInsight.findMany({
        where,
        orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
        take: filters.limit ?? 25,
        skip: filters.offset ?? 0,
      }),
      this.prisma.client.growthInsight.count({ where }),
    ]);

    return { items, total };
  }

  async markInsightRead(id: string) {
    return this.prisma.client.growthInsight.update({
      where: { id },
      data: { status: 'acknowledged', acknowledgedAt: new Date() },
    });
  }

  async dismissInsight(id: string) {
    return this.prisma.client.growthInsight.update({
      where: { id },
      data: { status: 'dismissed' },
    });
  }
}
