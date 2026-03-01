import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { contactWhereWithId } from './crm.helpers';

type HealthMetrics = {
  engagement: number;
  payment: number;
  responsiveness: number;
  relationship: number;
};

type JourneyMilestone = {
  id: string;
  type: 'first_contact' | 'call' | 'quote_sent' | 'quote_accepted' | 'payment' | 'booking' | 'completed' | 'milestone' | 'note';
  title: string;
  description?: string;
  date: string;
  value?: number;
  isNext?: boolean;
};

type ConversationContext = {
  lastDiscussed?: string;
  concerns?: string[];
  preferences?: string[];
  decisionMaker?: string;
  budgetRange?: { min: number; max: number };
  suggestedOpening?: string;
  sentiment?: 'positive' | 'neutral' | 'negative';
  engagementLevel?: 'high' | 'medium' | 'low';
};

type AiInsight = {
  summary: string;
  nextBestAction: string;
  reasoning?: string;
  confidence: number;
  suggestedMessage?: string;
  tags?: string[];
};

@Injectable()
export class CrmJourneyService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  private contactName(c: { firstName?: string | null; lastName?: string | null }): string {
    return `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim() || 'Unknown';
  }

  async getContactHealthMetrics(businessId: string, contactId: string): Promise<HealthMetrics> {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [contact, recentEvents, paidInvoices, totalInvoices, recentNotes] = await Promise.all([
      this.db.contact.findFirst({
        where: contactWhereWithId(businessId, contactId),
      }),
      this.db.contactEvent.count({
        where: { contactId, createdAt: { gte: thirtyDaysAgo } },
      }),
      this.db.invoice.count({
        where: { contactId, status: 'PAID' },
      }),
      this.db.invoice.count({
        where: { contactId },
      }),
      this.db.contactNote.count({
        where: { contactId, createdAt: { gte: thirtyDaysAgo } },
      }),
    ]);

    const engagement = Math.min(100, recentEvents * 10 + recentNotes * 5);
    const payment = totalInvoices > 0 ? Math.round((paidInvoices / totalInvoices) * 100) : 100;
    const responsiveness = Math.min(100, 50 + recentEvents * 5);
    const relationship = contact?.updatedAt && (now.getTime() - new Date(contact.updatedAt).getTime()) < 14 * 24 * 60 * 60 * 1000
      ? 80
      : 50;

    return {
      engagement: Math.max(0, Math.min(100, engagement)),
      payment: Math.max(0, Math.min(100, payment)),
      responsiveness: Math.max(0, Math.min(100, responsiveness)),
      relationship: Math.max(0, Math.min(100, relationship)),
    };
  }

  async getContactJourney(businessId: string, contactId: string): Promise<JourneyMilestone[]> {
    const [contact, events, invoices, quotes, bookings] = await Promise.all([
      this.db.contact.findFirst({
        where: contactWhereWithId(businessId, contactId),
        select: { createdAt: true, firstName: true },
      }),
      this.db.contactEvent.findMany({
        where: { contactId },
        orderBy: { createdAt: 'asc' },
        take: 20,
      }),
      this.db.invoice.findMany({
        where: { contactId, status: 'PAID' },
        orderBy: { paidAt: 'asc' },
        take: 5,
      }),
      this.db.quote.findMany({
        where: { contactId },
        orderBy: { createdAt: 'asc' },
        take: 5,
      }),
      this.db.booking.findMany({
        where: { contactId },
        orderBy: { startTime: 'asc' },
        take: 5,
      }),
    ]);

    const milestones: JourneyMilestone[] = [];

    if (contact) {
      milestones.push({
        id: 'first_contact',
        type: 'first_contact',
        title: 'First Contact',
        description: `${contact.firstName || 'Contact'} was added`,
        date: contact.createdAt.toISOString(),
      });
    }

    for (const quote of quotes) {
      milestones.push({
        id: `quote_${quote.id}`,
        type: quote.status === 'ACCEPTED' ? 'quote_accepted' : 'quote_sent',
        title: quote.status === 'ACCEPTED' ? 'Quote Accepted' : 'Quote Sent',
        description: quote.quoteNumber || undefined,
        date: quote.createdAt.toISOString(),
        value: typeof quote.total === 'object' && quote.total !== null && 'toNumber' in quote.total ? (quote.total as any).toNumber() : Number(quote.total ?? 0),
      });
    }

    for (const invoice of invoices) {
      milestones.push({
        id: `payment_${invoice.id}`,
        type: 'payment',
        title: 'Payment Received',
        description: invoice.invoiceNumber || undefined,
        date: (invoice.paidAt || invoice.createdAt).toISOString(),
        value: typeof invoice.total === 'object' && invoice.total !== null && 'toNumber' in invoice.total ? (invoice.total as any).toNumber() : Number(invoice.total ?? 0),
      });
    }

    for (const booking of bookings) {
      const isUpcoming = new Date(booking.startTime) > new Date();
      milestones.push({
        id: `booking_${booking.id}`,
        type: isUpcoming ? 'milestone' : 'booking',
        title: isUpcoming ? 'Upcoming Booking' : 'Booking Completed',
        date: booking.startTime.toISOString(),
        isNext: isUpcoming,
      });
    }

    return milestones.sort((a, b) => {
      if (a.isNext && !b.isNext) return 1;
      if (!a.isNext && b.isNext) return -1;
      return new Date(a.date).getTime() - new Date(b.date).getTime();
    });
  }

  async getConversationContext(businessId: string, contactId: string): Promise<ConversationContext> {
    const [contact, recentNotes, recentEvents] = await Promise.all([
      this.db.contact.findFirst({
        where: contactWhereWithId(businessId, contactId),
      }),
      this.db.contactNote.findMany({
        where: { contactId },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
      this.db.contactEvent.findMany({
        where: { contactId },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
    ]);

    if (!contact) {
      return {};
    }

    const lastDiscussed = recentNotes.length > 0
      ? recentNotes[0].body.substring(0, 100) + (recentNotes[0].body.length > 100 ? '...' : '')
      : undefined;

    const engagementLevel: 'high' | 'medium' | 'low' = recentEvents.length >= 5
      ? 'high'
      : recentEvents.length >= 2
      ? 'medium'
      : 'low';

    const firstName = contact.firstName || 'there';
    const suggestedOpening = contact.status === 'LEAD'
      ? `Hi ${firstName}! I wanted to follow up and see how I can help you today.`
      : contact.status === 'PROSPECT'
      ? `Hi ${firstName}! Just checking in to see if you had any questions about our services.`
      : `Hi ${firstName}! Hope you're doing well. Just wanted to touch base.`;

    return {
      lastDiscussed,
      preferences: contact.preferredChannel ? [contact.preferredChannel] : undefined,
      decisionMaker: `${contact.firstName ?? ''} ${contact.lastName ?? ''}`.trim() || undefined,
      suggestedOpening,
      sentiment: 'neutral',
      engagementLevel,
    };
  }

  async generateAiInsight(businessId: string, contactId: string): Promise<AiInsight> {
    const [contact, events, notes, invoices, tasks] = await Promise.all([
      this.db.contact.findFirst({
        where: contactWhereWithId(businessId, contactId),
      }),
      this.db.contactEvent.count({ where: { contactId } }),
      this.db.contactNote.count({ where: { contactId } }),
      this.db.invoice.findMany({
        where: { contactId },
        select: { status: true, total: true },
      }),
      this.db.contactTask.findMany({
        where: { contactId, status: { not: 'DONE' } },
        select: { title: true, dueDate: true },
      }),
    ]);

    if (!contact) {
      return {
        summary: 'Contact not found',
        nextBestAction: 'Verify contact details',
        confidence: 0,
      };
    }

    const firstName = contact.firstName || 'This contact';
    const status = contact.status || 'LEAD';
    const paidInvoices = invoices.filter(i => i.status === 'PAID');
    const totalRevenue = paidInvoices.reduce((sum, i) => sum + (typeof i.total === 'object' && i.total !== null && 'toNumber' in i.total ? (i.total as any).toNumber() : Number(i.total ?? 0)), 0);
    
    const summary = `${firstName} is a ${status.toLowerCase()} with ${events} interactions and ${notes} notes. ` +
      (paidInvoices.length > 0 
        ? `They've made ${paidInvoices.length} payments totaling TTD ${totalRevenue.toLocaleString()}.`
        : 'No payments recorded yet.');

    let nextBestAction: string;
    let suggestedMessage: string | undefined;
    let confidence = 70;

    if (status === 'LEAD') {
      nextBestAction = 'Schedule a discovery call to understand their needs';
      suggestedMessage = `Hi ${firstName}! I'd love to learn more about what you're looking for. Would you have time for a quick call this week?`;
      confidence = 80;
    } else if (status === 'PROSPECT') {
      if (tasks.length > 0) {
        nextBestAction = `Complete pending task: ${tasks[0].title}`;
      } else {
        nextBestAction = 'Send a personalized quote based on their requirements';
        suggestedMessage = `Hi ${firstName}! Based on our conversations, I've put together a proposal I think you'll love. When's a good time to walk through it?`;
      }
      confidence = 75;
    } else if (status === 'CLIENT') {
      nextBestAction = 'Check in to ensure satisfaction and explore upsell opportunities';
      suggestedMessage = `Hi ${firstName}! Hope everything is going great. I wanted to check in and see if there's anything else I can help with.`;
      confidence = 85;
    } else {
      nextBestAction = 'Review contact status and determine re-engagement strategy';
      confidence = 50;
    }

    const tags = [status.toLowerCase()];
    if (totalRevenue > 5000) tags.push('high-value');
    if (events > 10) tags.push('engaged');
    if (tasks.length > 0) tags.push('has-tasks');

    return {
      summary,
      nextBestAction,
      reasoning: `Based on ${events} interactions, ${notes} notes, and ${status} status`,
      confidence,
      suggestedMessage,
      tags,
    };
  }
}
