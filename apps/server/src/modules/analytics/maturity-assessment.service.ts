import { Injectable, Inject, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

interface DimensionScore {
  dimension: string;
  score: number;
  maxScore: number;
}

@Injectable()
export class MaturityAssessmentService {
  private readonly logger = new Logger(MaturityAssessmentService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async assessBusiness(businessId: string) {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      include: {
        invoices: { where: { deletedAt: null }, select: { status: true, total: true, paidAt: true, dueDate: true } },
        contacts: { where: { deletedAt: null }, select: { status: true, createdAt: true } },
        bookings: { where: { deletedAt: null }, select: { status: true, startTime: true } },
        products: { where: { deletedAt: null }, select: { id: true } },
        services: { where: { deletedAt: null }, select: { id: true } },
        members: { select: { id: true, role: true } },
        channelConnections: { select: { provider: true, healthState: true } },
        _count: {
          select: {
            invoices: true,
            contacts: true,
            bookings: true,
            products: true,
            services: true,
          },
        },
      },
    });

    if (!business) throw new Error('Business not found');

    const dimensions: DimensionScore[] = [
      this.scoreRevenueMaturity(business),
      this.scoreCustomerMaturity(business),
      this.scoreOperationsMaturity(business),
      this.scoreMarketingMaturity(business),
      this.scoreAutomationMaturity(business),
      this.scoreFinancialMaturity(business),
      this.scoreTeamMaturity(business),
      this.scoreDataMaturity(business),
    ];

    const overallScore = Math.round(
      dimensions.reduce((sum, d) => sum + d.score, 0) / dimensions.length
    );

    const stage = this.determineStage(overallScore);
    const gaps = dimensions
      .filter((d) => d.score < 40)
      .map((d) => d.dimension);
    const strengths = dimensions
      .filter((d) => d.score >= 70)
      .map((d) => d.dimension);

    const recommendations = this.generateRecommendations(dimensions);

    // Calculate percentile (simplified)
    const allScores = await this.prisma.client.maturityScore.findMany({
      select: { overallScore: true },
      orderBy: { overallScore: 'desc' },
    });
    const percentile = allScores.length > 0
      ? Math.round(
          ((allScores.filter((s) => s.overallScore < overallScore).length) /
            allScores.length) *
            100
        )
      : 50;

    const assessment = await this.prisma.client.maturityScore.create({
      data: {
        businessId,
        assessmentDate: new Date(),
        revenueMaturity: dimensions[0].score,
        customerMaturity: dimensions[1].score,
        operationsMaturity: dimensions[2].score,
        marketingMaturity: dimensions[3].score,
        automationMaturity: dimensions[4].score,
        financialMaturity: dimensions[5].score,
        teamMaturity: dimensions[6].score,
        dataMaturity: dimensions[7].score,
        overallScore,
        percentile,
        stage,
        gaps: gaps as any,
        strengths: strengths as any,
        recommendations: recommendations as any,
      },
    });

    return { assessment, dimensions, percentile };
  }

  async getLatestAssessment(businessId: string) {
    return this.prisma.client.maturityScore.findFirst({
      where: { businessId },
      orderBy: { assessmentDate: 'desc' },
    });
  }

  async getAssessmentHistory(businessId: string) {
    return this.prisma.client.maturityScore.findMany({
      where: { businessId },
      orderBy: { assessmentDate: 'desc' },
      take: 12,
    });
  }

  private scoreRevenueMaturity(business: any): DimensionScore {
    const invoiceCount = business._count.invoices;
    const totalRevenue = business.invoices.reduce(
      (sum: number, inv: any) => sum + Number(inv.total ?? 0),
      0
    );
    const paidCount = business.invoices.filter(
      (inv: any) => inv.status === 'PAID'
    ).length;
    const collectionRate = invoiceCount > 0 ? (paidCount / invoiceCount) * 100 : 0;

    let score = 0;
    if (totalRevenue > 100000) score += 40;
    else if (totalRevenue > 50000) score += 30;
    else if (totalRevenue > 10000) score += 20;
    else if (totalRevenue > 0) score += 10;

    if (collectionRate > 90) score += 30;
    else if (collectionRate > 70) score += 20;
    else if (collectionRate > 50) score += 10;

    if (invoiceCount > 50) score += 30;
    else if (invoiceCount > 20) score += 20;
    else if (invoiceCount > 5) score += 10;

    return { dimension: 'Revenue', score: Math.min(score, 100), maxScore: 100 };
  }

  private scoreCustomerMaturity(business: any): DimensionScore {
    const contactCount = business._count.contacts;
    const leads = business.contacts.filter(
      (c: any) => c.status === 'LEAD'
    ).length;
    const customers = business.contacts.filter(
      (c: any) => c.status === 'CUSTOMER'
    ).length;

    let score = 0;
    if (contactCount > 500) score += 40;
    else if (contactCount > 200) score += 30;
    else if (contactCount > 50) score += 20;
    else if (contactCount > 10) score += 10;

    if (customers > 100) score += 30;
    else if (customers > 50) score += 20;
    else if (customers > 10) score += 10;

    if (leads > 50) score += 30;
    else if (leads > 20) score += 20;
    else if (leads > 5) score += 10;

    return { dimension: 'Customer', score: Math.min(score, 100), maxScore: 100 };
  }

  private scoreOperationsMaturity(business: any): DimensionScore {
    const bookingCount = business._count.bookings;
    const productCount = business._count.products;
    const serviceCount = business._count.services;
    const hasCalendar = business.channelConnections.some(
      (i: any) => i.provider === 'GOOGLE_CALENDAR'
    );

    let score = 0;
    if (bookingCount > 100) score += 35;
    else if (bookingCount > 50) score += 25;
    else if (bookingCount > 10) score += 15;
    else if (bookingCount > 0) score += 5;

    if (productCount + serviceCount > 20) score += 35;
    else if (productCount + serviceCount > 10) score += 25;
    else if (productCount + serviceCount > 3) score += 15;
    else if (productCount + serviceCount > 0) score += 5;

    if (hasCalendar) score += 30;

    return { dimension: 'Operations', score: Math.min(score, 100), maxScore: 100 };
  }

  private scoreMarketingMaturity(business: any): DimensionScore {
    const hasStorefront = business._count.products > 0 || business._count.services > 0;
    const integrations = business.channelConnections.length;

    let score = 0;
    if (hasStorefront) score += 40;
    if (integrations > 3) score += 30;
    else if (integrations > 1) score += 20;
    else if (integrations > 0) score += 10;
    if (business.contacts.length > 100) score += 30;
    else if (business.contacts.length > 50) score += 20;
    else if (business.contacts.length > 10) score += 10;

    return { dimension: 'Marketing', score: Math.min(score, 100), maxScore: 100 };
  }

  private scoreAutomationMaturity(business: any): DimensionScore {
    const activeIntegrations = business.channelConnections.filter(
      (i: any) => i.healthState === 'Connected'
    ).length;
    const hasWhatsApp = business.channelConnections.some(
      (i: any) => i.provider === 'WHATSAPP'
    );

    let score = 0;
    if (activeIntegrations > 4) score += 40;
    else if (activeIntegrations > 2) score += 30;
    else if (activeIntegrations > 0) score += 15;

    if (hasWhatsApp) score += 35;
    if (business._count.invoices > 0 && business._count.bookings > 0) score += 25;

    return { dimension: 'Automation', score: Math.min(score, 100), maxScore: 100 };
  }

  private scoreFinancialMaturity(business: any): DimensionScore {
    const invoices = business.invoices;
    const hasPaid = invoices.some((i: any) => i.status === 'PAID');
    const hasOverdue = invoices.some((i: any) => i.status === 'OVERDUE');

    let score = 0;
    if (invoices.length > 20) score += 40;
    else if (invoices.length > 10) score += 30;
    else if (invoices.length > 5) score += 20;
    else if (invoices.length > 0) score += 10;

    if (!hasOverdue && hasPaid) score += 30;
    else if (hasOverdue) score += 15;

    if (business.channelConnections.some((i: any) => i.provider === 'STRIPE')) score += 30;

    return { dimension: 'Financial', score: Math.min(score, 100), maxScore: 100 };
  }

  private scoreTeamMaturity(business: any): DimensionScore {
    const userCount = business.members.length;
    const hasAdmin = business.members.some((u: any) => u.role === 'ADMIN');

    let score = 0;
    if (userCount > 5) score += 50;
    else if (userCount > 2) score += 35;
    else if (userCount > 1) score += 20;
    else score += 10;

    if (hasAdmin) score += 30;
    if (business.channelConnections.some((i: any) => i.provider === 'SLACK')) score += 20;

    return { dimension: 'Team', score: Math.min(score, 100), maxScore: 100 };
  }

  private scoreDataMaturity(business: any): DimensionScore {
    let score = 0;
    const dataPoints =
      business._count.invoices +
      business._count.contacts +
      business._count.bookings;

    if (dataPoints > 200) score += 50;
    else if (dataPoints > 100) score += 35;
    else if (dataPoints > 50) score += 25;
    else if (dataPoints > 10) score += 15;
    else score += 5;

    if (business.channelConnections.some((i: any) => i.provider === 'ANALYTICS')) score += 30;
    if (business.channelConnections.some((i: any) => i.provider === 'GOOGLE_SHEETS')) score += 20;

    return { dimension: 'Data', score: Math.min(score, 100), maxScore: 100 };
  }

  private determineStage(score: number): string {
    if (score >= 90) return 'mastery';
    if (score >= 70) return 'advanced';
    if (score >= 50) return 'established';
    if (score >= 30) return 'emerging';
    return 'beginner';
  }

  private generateRecommendations(dimensions: DimensionScore[]) {
    const recs: Array<{
      dimension: string;
      score: number;
      action: string;
      priority: string;
    }> = [];

    for (const dim of dimensions) {
      if (dim.score < 30) {
        recs.push({
          dimension: dim.dimension,
          score: dim.score,
          action: `Set up basic ${dim.dimension.toLowerCase()} infrastructure`,
          priority: 'critical',
        });
      } else if (dim.score < 50) {
        recs.push({
          dimension: dim.dimension,
          score: dim.score,
          action: `Expand ${dim.dimension.toLowerCase()} capabilities`,
          priority: 'high',
        });
      } else if (dim.score < 70) {
        recs.push({
          dimension: dim.dimension,
          score: dim.score,
          action: `Optimize ${dim.dimension.toLowerCase()} workflows`,
          priority: 'medium',
        });
      }
    }

    return recs.sort((a, b) => a.score - b.score).slice(0, 5);
  }
}
