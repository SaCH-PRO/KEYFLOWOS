import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

export interface BusinessMetricSnapshot {
  businessId: string;
  businessName: string;
  contactCount: number;
  totalRevenue: number;
  invoiceCount: number;
  paidInvoiceCount: number;
  overdueInvoiceCount: number;
  totalOverdueAmount: number;
  bookingCount: number;
  upcomingBookingCount: number;
  quoteCount: number;
  sentQuoteCount: number;
  openDealCount: number;
  dealValue: number;
  contentRequestCount: number;
  contentDeliveredCount: number;
  taskCount: number;
  completedTaskCount: number;
  callCount: number;
  completedCallCount: number;
  avgInvoiceValue: number;
  avgDealValue: number;
  collectionRate: number; // % of invoices paid
}

export interface CrossBusinessBenchmark {
  metric: string;
  userAvg: number;
  userMax: number;
  userMin: number;
  userMedian: number;
  peerAvg?: number;
  topPercentile?: number;
}

export interface CrossBusinessIntelligenceResult {
  businesses: BusinessMetricSnapshot[];
  benchmarks: CrossBusinessBenchmark[];
  aggregated: {
    totalRevenue: number;
    totalContacts: number;
    totalDeals: number;
    totalBookings: number;
    totalContentDelivered: number;
    avgCollectionRate: number;
    avgDealSize: number;
  };
  insights: string[];
}

@Injectable()
export class CrossBusinessIntelligenceService {
  private readonly logger = new Logger(CrossBusinessIntelligenceService.name);

  constructor(private readonly prisma: PrismaService) {}

  async aggregateForUser(userId: string): Promise<CrossBusinessIntelligenceResult> {
    const memberships = await this.prisma.client.membership.findMany({
      where: { userId },
      include: { business: { select: { id: true, name: true } } },
    });

    const businessIds = memberships.map((m) => m.businessId);
    const snapshots: BusinessMetricSnapshot[] = [];

    for (const businessId of businessIds) {
      const snap = await this.snapshotBusiness(businessId);
      snapshots.push(snap);
    }

    const benchmarks = this.computeBenchmarks(snapshots);
    const aggregated = this.computeAggregated(snapshots);
    const insights = this.generateInsights(snapshots, aggregated);

    return { businesses: snapshots, benchmarks, aggregated, insights };
  }

  private async snapshotBusiness(businessId: string): Promise<BusinessMetricSnapshot> {
    const [
      contactCount,
      invoiceAgg,
      invoiceCounts,
      bookingCount,
      upcomingBookings,
      quoteCounts,
      dealAgg,
      contentCounts,
      taskCounts,
      callCounts,
      businessName,
    ] = await Promise.all([
      this.prisma.client.contact.count({ where: { businessId, deletedAt: null } }),
      this.prisma.client.invoice.aggregate({
        where: { businessId, deletedAt: null },
        _sum: { total: true },
        _avg: { total: true },
      }),
      this.prisma.client.invoice.groupBy({
        by: ['status'],
        where: { businessId, deletedAt: null },
        _count: { id: true },
        _sum: { total: true },
      }),
      this.prisma.client.booking.count({ where: { businessId, deletedAt: null } }),
      this.prisma.client.booking.count({
        where: { businessId, deletedAt: null, startTime: { gte: new Date() }, status: { not: 'CANCELLED' } },
      }),
      this.prisma.client.quote.groupBy({
        by: ['status'],
        where: { businessId, deletedAt: null },
        _count: { id: true },
      }),
      this.prisma.client.deal.aggregate({
        where: { businessId, deletedAt: null, status: 'OPEN' },
        _sum: { value: true },
        _avg: { value: true },
        _count: { id: true },
      }),
      this.prisma.client.contentRequest.groupBy({
        by: ['status'],
        where: { businessId },
        _count: { id: true },
      }),
      this.prisma.client.contactTask.groupBy({
        by: ['status'],
        where: { businessId },
        _count: { id: true },
      }),
      this.prisma.client.callLog.groupBy({
        by: ['completedAt'],
        where: { businessId },
        _count: { id: true },
      }),
      this.prisma.client.business.findUnique({ where: { id: businessId }, select: { name: true } }),
    ]);

    const paidInvoices = invoiceCounts.find((c) => c.status === 'PAID');
    const overdueInvoices = invoiceCounts.find((c) => c.status === 'OVERDUE');
    const sentQuotes = quoteCounts.find((c) => c.status === 'SENT');
    const deliveredContent = contentCounts.find((c) => c.status === 'DELIVERED');
    const completedTasks = taskCounts.find((c) => c.status === 'COMPLETED');

    const totalInvoices = invoiceCounts.reduce((s, c) => s + c._count.id, 0);
    const collectionRate = totalInvoices > 0 && paidInvoices ? paidInvoices._count.id / totalInvoices : 0;

    return {
      businessId,
      businessName: businessName?.name || businessId,
      contactCount,
      totalRevenue: Number(invoiceAgg._sum.total ?? 0),
      invoiceCount: totalInvoices,
      paidInvoiceCount: paidInvoices?._count.id ?? 0,
      overdueInvoiceCount: overdueInvoices?._count.id ?? 0,
      totalOverdueAmount: Number(overdueInvoices?._sum.total ?? 0),
      bookingCount,
      upcomingBookingCount: upcomingBookings,
      quoteCount: quoteCounts.reduce((s, c) => s + c._count.id, 0),
      sentQuoteCount: sentQuotes?._count.id ?? 0,
      openDealCount: dealAgg._count.id,
      dealValue: Number(dealAgg._sum.value ?? 0),
      contentRequestCount: contentCounts.reduce((s, c) => s + c._count.id, 0),
      contentDeliveredCount: deliveredContent?._count.id ?? 0,
      taskCount: taskCounts.reduce((s, c) => s + c._count.id, 0),
      completedTaskCount: completedTasks?._count.id ?? 0,
      callCount: callCounts.reduce((s, c) => s + c._count.id, 0),
      completedCallCount: callCounts.filter((c) => c.completedAt !== null).reduce((s, c) => s + c._count.id, 0),
      avgInvoiceValue: Number(invoiceAgg._avg.total ?? 0),
      avgDealValue: Number(dealAgg._avg.value ?? 0),
      collectionRate,
    };
  }

  private computeBenchmarks(snapshots: BusinessMetricSnapshot[]): CrossBusinessBenchmark[] {
    const metrics = [
      { key: 'totalRevenue', label: 'Total Revenue' },
      { key: 'contactCount', label: 'Contacts' },
      { key: 'avgInvoiceValue', label: 'Avg Invoice Value' },
      { key: 'avgDealValue', label: 'Avg Deal Value' },
      { key: 'collectionRate', label: 'Collection Rate' },
      { key: 'contentDeliveredCount', label: 'Content Delivered' },
    ] as const;

    return metrics.map((m) => {
      const values = snapshots.map((s) => s[m.key as keyof BusinessMetricSnapshot] as number).filter((v) => !isNaN(v));
      values.sort((a, b) => a - b);
      const sum = values.reduce((a, b) => a + b, 0);
      const avg = values.length > 0 ? sum / values.length : 0;
      const median = values.length > 0 ? values[Math.floor(values.length / 2)] : 0;
      return {
        metric: m.label,
        userAvg: Math.round(avg * 100) / 100,
        userMax: values.length > 0 ? Math.max(...values) : 0,
        userMin: values.length > 0 ? Math.min(...values) : 0,
        userMedian: Math.round(median * 100) / 100,
      };
    });
  }

  private computeAggregated(snapshots: BusinessMetricSnapshot[]) {
    const totalRevenue = snapshots.reduce((s, b) => s + b.totalRevenue, 0);
    const totalContacts = snapshots.reduce((s, b) => s + b.contactCount, 0);
    const totalDeals = snapshots.reduce((s, b) => s + b.openDealCount, 0);
    const totalBookings = snapshots.reduce((s, b) => s + b.bookingCount, 0);
    const totalContentDelivered = snapshots.reduce((s, b) => s + b.contentDeliveredCount, 0);
    const avgCollectionRate = snapshots.length > 0 ? snapshots.reduce((s, b) => s + b.collectionRate, 0) / snapshots.length : 0;
    const avgDealSize = snapshots.length > 0 ? snapshots.reduce((s, b) => s + b.avgDealValue, 0) / snapshots.length : 0;

    return { totalRevenue, totalContacts, totalDeals, totalBookings, totalContentDelivered, avgCollectionRate, avgDealSize };
  }

  private generateInsights(snapshots: BusinessMetricSnapshot[], aggregated: any): string[] {
    const insights: string[] = [];

    if (snapshots.length > 1) {
      const bestRevenue = snapshots.reduce((a, b) => (a.totalRevenue > b.totalRevenue ? a : b));
      insights.push(`${bestRevenue.businessName} is your top revenue business at $${bestRevenue.totalRevenue.toLocaleString()}.`);
    }

    const lowCollection = snapshots.filter((s) => s.collectionRate < 0.5 && s.invoiceCount > 0);
    if (lowCollection.length > 0) {
      insights.push(`${lowCollection.length} business${lowCollection.length > 1 ? 'es' : ''} have a collection rate below 50%. Consider tightening payment terms.`);
    }

    const highOverdue = snapshots.filter((s) => s.totalOverdueAmount > 1000);
    if (highOverdue.length > 0) {
      insights.push(`${highOverdue.length} business${highOverdue.length > 1 ? 'es' : ''} have over $1,000 in overdue invoices.`);
    }

    const noContent = snapshots.filter((s) => s.contentRequestCount === 0);
    if (noContent.length > 0) {
      insights.push(`${noContent.length} business${noContent.length > 1 ? 'es' : ''} have no content requests. Content marketing can drive engagement.`);
    }

    if (aggregated.avgCollectionRate > 0.9) {
      insights.push('Excellent collection rate across your portfolio — keep it up!');
    }

    return insights;
  }
}
