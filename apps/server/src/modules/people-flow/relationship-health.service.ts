import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

export interface RelationshipHealth {
  contactId: string;
  contactName: string;
  overallScore: number; // 0-100
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  label: string;
  factors: {
    recency: number; // 0-100, higher = more recent interaction
    payment: number; // 0-100, higher = better payment behavior
    engagement: number; // 0-100, higher = more engagement
    responsiveness: number; // 0-100, higher = responds well
  };
  signals: string[];
  lifetimeValue: number;
  outstandingBalance: number;
  currency: string;
  lastInteractionDays: number;
  openInvoiceCount: number;
  totalBookingCount: number;
  totalInvoiceCount: number;
}

export interface PeopleSegment {
  id: string;
  name: string;
  criteria: string;
  count: number;
  contacts: Array<{ id: string; name: string; email: string | null; healthScore: number }>;
}

@Injectable()
export class RelationshipHealthService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async computeHealth(businessId: string, contactId: string): Promise<RelationshipHealth | null> {
    const contact = await (this.prisma.client as any).contact.findUnique({
      where: { id: contactId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        status: true,
        lastInteractionAt: true,
        createdAt: true,
      },
    });
    if (!contact || contact.businessId !== businessId) return null;

    const now = new Date();
    const [
      invoices,
      bookings,
      tasks,
      notes,
      deals,
    ] = await Promise.all([
      (this.prisma.client as any).invoice.findMany({
        where: { businessId, contactId, deletedAt: null },
        select: { status: true, total: true, currency: true, dueDate: true, paidAt: true, createdAt: true },
      }),
      (this.prisma.client as any).booking.findMany({
        where: { businessId, contactId, deletedAt: null },
        select: { status: true, startTime: true, createdAt: true },
      }),
      (this.prisma.client as any).contactTask.findMany({
        where: { businessId, contactId },
        select: { status: true, dueDate: true, createdAt: true },
      }),
      (this.prisma.client as any).contactNote.findMany({
        where: { businessId, contactId },
        select: { createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 1,
      }),
      (this.prisma.client as any).deal.findMany({
        where: { businessId, contactId, deletedAt: null },
        select: { value: true, status: true },
      }),
    ]);

    const currency = invoices[0]?.currency ?? 'TTD';
    const totalRevenue = invoices
      .filter((i: any) => i.status === 'PAID')
      .reduce((s: number, i: any) => s + Number(i.total ?? 0), 0);
    const outstandingBalance = invoices
      .filter((i: any) => ['SENT', 'OVERDUE'].includes(i.status))
      .reduce((s: number, i: any) => s + Number(i.total ?? 0), 0);
    const openInvoiceCount = invoices.filter((i: any) => ['SENT', 'OVERDUE'].includes(i.status)).length;
    const overdueInvoiceCount = invoices.filter((i: any) => i.status === 'OVERDUE').length;

    // Recency score: 100 if interacted today, decays over 90 days
    const lastInteraction = contact.lastInteractionAt ? new Date(contact.lastInteractionAt) : null;
    const lastNote = notes[0]?.createdAt ? new Date(notes[0].createdAt) : null;
    const lastEngagement = lastInteraction && lastNote
      ? new Date(Math.max(lastInteraction.getTime(), lastNote.getTime()))
      : (lastInteraction ?? lastNote);
    const daysSinceInteraction = lastEngagement
      ? Math.floor((now.getTime() - lastEngagement.getTime()) / 86400000)
      : 999;
    const recency = Math.max(0, 100 - (daysSinceInteraction / 90) * 100);

    // Payment score: 100 if no outstanding, penalized by overdue ratio
    const totalInvoiceAmount = invoices.reduce((s: number, i: any) => s + Number(i.total ?? 0), 0);
    const payment = totalInvoiceAmount > 0
      ? Math.max(0, 100 - (outstandingBalance / totalInvoiceAmount) * 100 - overdueInvoiceCount * 15)
      : 75; // neutral if no invoice history

    // Engagement score: based on booking and task frequency
    const bookingsLast90 = bookings.filter((b: any) => b.createdAt && new Date(b.createdAt) > new Date(now.getTime() - 90 * 86400000)).length;
    const tasksCompleted = tasks.filter((t: any) => t.status === 'DONE').length;
    const engagement = Math.min(100, bookingsLast90 * 20 + tasksCompleted * 10 + 20);

    // Responsiveness: do they respond to outreach (proxy: do they have follow-up tasks that get done)
    const tasksTotal = tasks.length;
    const responsiveness = tasksTotal > 0
      ? Math.min(100, (tasksCompleted / tasksTotal) * 100 + 20)
      : 50;

    // Overall score
    const overallScore = Math.round((recency * 0.25 + payment * 0.30 + engagement * 0.25 + responsiveness * 0.20));

    // Grade
    const grade = overallScore >= 80 ? 'A' : overallScore >= 60 ? 'B' : overallScore >= 40 ? 'C' : overallScore >= 20 ? 'D' : 'F';
    const label = overallScore >= 80 ? 'Excellent' : overallScore >= 60 ? 'Healthy' : overallScore >= 40 ? 'Needs Attention' : overallScore >= 20 ? 'At Risk' : 'Dormant';

    // Signals
    const signals: string[] = [];
    if (daysSinceInteraction > 30) signals.push(`No interaction in ${daysSinceInteraction} days`);
    if (overdueInvoiceCount > 0) signals.push(`${overdueInvoiceCount} overdue invoice${overdueInvoiceCount > 1 ? 's' : ''}`);
    if (outstandingBalance > 0) signals.push(`${currency} ${outstandingBalance.toLocaleString()} outstanding`);
    if (bookingsLast90 === 0 && contact.status === 'CUSTOMER') signals.push('No bookings in 90 days');
    if (deals.some((d: any) => d.status === 'OPEN')) signals.push('Active deal in pipeline');

    return {
      contactId: contact.id,
      contactName: [contact.firstName, contact.lastName].filter(Boolean).join(' ') || contact.email || 'Unknown',
      overallScore,
      grade,
      label,
      factors: { recency: Math.round(recency), payment: Math.round(payment), engagement: Math.round(engagement), responsiveness: Math.round(responsiveness) },
      signals,
      lifetimeValue: totalRevenue,
      outstandingBalance,
      currency,
      lastInteractionDays: daysSinceInteraction,
      openInvoiceCount,
      totalBookingCount: bookings.length,
      totalInvoiceCount: invoices.length,
    };
  }

  async listSegments(businessId: string): Promise<PeopleSegment[]> {
    const contacts = await (this.prisma.client as any).contact.findMany({
      where: { businessId, deletedAt: null },
      select: { id: true, firstName: true, lastName: true, email: true, status: true, lastInteractionAt: true, leadScore: true },
    });

    const now = new Date();
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 86400000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000);
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 86400000);

    const segments: PeopleSegment[] = [
      {
        id: 'hot-leads',
        name: 'Hot Leads',
        criteria: 'Lead score >= 70 or status LEAD with recent interaction',
        count: 0,
        contacts: [],
      },
      {
        id: 'stale-leads',
        name: 'Stale Leads',
        criteria: 'No interaction in 14+ days, not dormant',
        count: 0,
        contacts: [],
      },
      {
        id: 'high-value',
        name: 'High-Value Customers',
        criteria: 'Status CUSTOMER with high engagement',
        count: 0,
        contacts: [],
      },
      {
        id: 'at-risk',
        name: 'At Risk',
        criteria: 'No interaction in 30+ days or status AT_RISK',
        count: 0,
        contacts: [],
      },
      {
        id: 'dormant',
        name: 'Dormant',
        criteria: 'Status DORMANT or no interaction in 90+ days',
        count: 0,
        contacts: [],
      },
    ];

    for (const contact of contacts) {
      const name = [contact.firstName, contact.lastName].filter(Boolean).join(' ') || contact.email || 'Unknown';
      const lastInteraction = contact.lastInteractionAt ? new Date(contact.lastInteractionAt) : null;
      const daysSince = lastInteraction ? Math.floor((now.getTime() - lastInteraction.getTime()) / 86400000) : 999;
      const healthScore = contact.leadScore ?? 50;

      // Hot leads
      if (contact.status === 'LEAD' && (contact.leadScore ?? 0) >= 70) {
        segments[0].contacts.push({ id: contact.id, name, email: contact.email, healthScore });
      }
      // Stale leads
      if ((contact.status === 'LEAD' || contact.status === 'PROSPECT') && daysSince >= 14 && contact.status !== 'DORMANT') {
        segments[1].contacts.push({ id: contact.id, name, email: contact.email, healthScore });
      }
      // High-value customers
      if (contact.status === 'CUSTOMER' && daysSince < 30) {
        segments[2].contacts.push({ id: contact.id, name, email: contact.email, healthScore });
      }
      // At risk
      if (daysSince >= 30 && contact.status !== 'DORMANT') {
        segments[3].contacts.push({ id: contact.id, name, email: contact.email, healthScore });
      }
      // Dormant
      if (contact.status === 'DORMANT' || daysSince >= 90) {
        segments[4].contacts.push({ id: contact.id, name, email: contact.email, healthScore });
      }
    }

    for (const seg of segments) {
      seg.count = seg.contacts.length;
      seg.contacts = seg.contacts.slice(0, 10);
    }

    return segments.filter((s) => s.count > 0);
  }
}
