import { Inject, Injectable, NotFoundException } from '@nestjs/common';
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

type CrossJourneyItem = {
  id: string;
  module: 'crm' | 'bookings' | 'commerce' | 'marketing';
  type: string;
  title: string;
  description?: string;
  timestamp: string;
  value?: number;
  currency?: string;
  status?: string;
  entityId?: string;
  ctaLabel?: string;
  ctaModule?: string;
};

type CrossJourneySummary = {
  bookingsCount: number;
  totalRevenue: number;
  lastInteractionAt: string | null;
  momentum: number;
  engagementLevel: 'high' | 'medium' | 'low';
  moduleCounts: { crm: number; bookings: number; commerce: number; marketing: number };
};

type CrossJourneyResponse = {
  timeline: CrossJourneyItem[];
  summary: CrossJourneySummary;
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

function toNum(val: unknown): number {
  if (typeof val === 'number') return val;
  if (val !== null && val !== undefined && typeof val === 'object' && 'toNumber' in val) {
    const decimal = val as { toNumber: () => number };
    return decimal.toNumber();
  }
  return Number(val ?? 0);
}

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

  private async assertContact(businessId: string, contactId: string) {
    const contact = await this.db.contact.findFirst({
      where: contactWhereWithId(businessId, contactId),
    });
    if (!contact) throw new NotFoundException('Contact not found');
    return contact;
  }

  async getContactHealthMetrics(businessId: string, contactId: string): Promise<HealthMetrics> {
    await this.assertContact(businessId, contactId);
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [contact, recentEvents, paidInvoices, totalInvoices, recentNotes] = await Promise.all([
      this.db.contact.findFirst({
        where: contactWhereWithId(businessId, contactId),
      }),
      this.db.contactEvent.count({
        where: { businessId, contactId, createdAt: { gte: thirtyDaysAgo } },
      }),
      this.db.invoice.count({
        where: { businessId, contactId, status: 'PAID' },
      }),
      this.db.invoice.count({
        where: { businessId, contactId },
      }),
      this.db.contactNote.count({
        where: { businessId, contactId, createdAt: { gte: thirtyDaysAgo } },
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
        where: { businessId, contactId },
        orderBy: { createdAt: 'asc' },
        take: 20,
      }),
      this.db.invoice.findMany({
        where: { businessId, contactId, status: 'PAID' },
        orderBy: { paidAt: 'asc' },
        take: 5,
      }),
      this.db.quote.findMany({
        where: { businessId, contactId },
        orderBy: { createdAt: 'asc' },
        take: 5,
      }),
      this.db.booking.findMany({
        where: { businessId, contactId },
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
        value: toNum(quote.total),
      });
    }

    for (const invoice of invoices) {
      milestones.push({
        id: `payment_${invoice.id}`,
        type: 'payment',
        title: 'Payment Received',
        description: invoice.invoiceNumber || undefined,
        date: (invoice.paidAt || invoice.createdAt).toISOString(),
        value: toNum(invoice.total),
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

  async getContactCrossJourney(businessId: string, contactId: string): Promise<CrossJourneyResponse> {
    const contact = await this.assertContact(businessId, contactId);
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [events, notes, tasks, invoices, quotes, bookings, recentEventCount] = await Promise.all([
      this.db.contactEvent.findMany({
        where: { businessId, contactId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      this.db.contactNote.findMany({
        where: { businessId, contactId },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      this.db.contactTask.findMany({
        where: { businessId, contactId },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      this.db.invoice.findMany({
        where: { businessId, contactId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { id: true, status: true, total: true, currency: true, invoiceNumber: true, createdAt: true, paidAt: true, issueDate: true, dueDate: true },
      }),
      this.db.quote.findMany({
        where: { businessId, contactId },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { id: true, status: true, total: true, currency: true, quoteNumber: true, createdAt: true },
      }),
      this.db.booking.findMany({
        where: { businessId, contactId, deletedAt: null },
        orderBy: { startTime: 'desc' },
        take: 20,
        select: { id: true, status: true, startTime: true, endTime: true, createdAt: true },
      }),
      this.db.contactEvent.count({
        where: { businessId, contactId, createdAt: { gte: thirtyDaysAgo } },
      }),
    ]);

    const timeline: CrossJourneyItem[] = [];
    const trackedEventEntityIds = new Set<string>();

    timeline.push({
      id: 'first_contact',
      module: 'crm',
      type: 'contact.created',
      title: 'Contact created',
      description: `${contact.firstName || 'Contact'} was added`,
      timestamp: contact.createdAt.toISOString(),
    });

    for (const ev of events) {
      const data = ev.data as Record<string, unknown> | null;
      let module: CrossJourneyItem['module'] = 'crm';
      if (ev.type.startsWith('invoice.') || ev.type.startsWith('quote.') || ev.type.startsWith('payment.')) module = 'commerce';
      else if (ev.type.startsWith('booking.')) module = 'bookings';
      else if (ev.type.startsWith('campaign.') || ev.type.startsWith('email.') || ev.type.startsWith('lead_form.') || ev.type.startsWith('form.')) module = 'marketing';

      let description: string | undefined;
      if ((ev.type === 'status.changed' || ev.type === 'STATUS_CHANGED') && data?.from && data?.to) {
        description = `${data.from} → ${data.to}`;
      } else if (ev.type === 'invoice.paid' && data?.amount) {
        description = `TTD ${Number(data.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
      } else if (ev.type === 'note.created' && data?.noteId) {
        const note = notes.find(n => n.id === data.noteId);
        if (note) description = note.body.length > 80 ? note.body.slice(0, 80) + '...' : note.body;
      } else if ((ev.type === 'task.created' || ev.type === 'task.completed') && data?.title) {
        description = String(data.title);
      }

      let entityId: string | undefined;
      let ctaLabel: string | undefined;
      let ctaModule: string | undefined;
      if (data?.invoiceId) {
        entityId = String(data.invoiceId);
        ctaLabel = 'View Invoice';
        ctaModule = 'commerce';
        trackedEventEntityIds.add(entityId);
      } else if (data?.bookingId) {
        entityId = String(data.bookingId);
        ctaLabel = 'View Booking';
        ctaModule = 'bookings';
        trackedEventEntityIds.add(entityId);
      } else if (data?.campaignId) {
        entityId = String(data.campaignId);
        ctaLabel = 'View Campaign';
        ctaModule = 'marketing';
      } else if (data?.noteId) {
        entityId = String(data.noteId);
        trackedEventEntityIds.add(`note_${entityId}`);
      } else if (data?.taskId) {
        entityId = String(data.taskId);
        trackedEventEntityIds.add(`task_${entityId}`);
      }

      const title = this.getEventTitle(ev.type);

      timeline.push({
        id: ev.id,
        module,
        type: ev.type,
        title,
        description,
        timestamp: ev.createdAt.toISOString(),
        value: typeof data?.amount === 'number' ? data.amount : undefined,
        currency: typeof data?.currency === 'string' ? data.currency : undefined,
        entityId,
        ctaLabel,
        ctaModule,
      });
    }

    for (const note of notes) {
      if (trackedEventEntityIds.has(`note_${note.id}`)) continue;
      timeline.push({
        id: `note_${note.id}`,
        module: 'crm',
        type: 'note.created',
        title: 'Note added',
        description: note.body.length > 80 ? note.body.slice(0, 80) + '...' : note.body,
        timestamp: note.createdAt.toISOString(),
      });
    }

    for (const task of tasks) {
      if (trackedEventEntityIds.has(`task_${task.id}`)) continue;
      const isCompleted = task.status === 'DONE';
      timeline.push({
        id: `task_${task.id}`,
        module: 'crm',
        type: isCompleted ? 'task.completed' : 'task.created',
        title: isCompleted ? 'Task completed' : 'Task created',
        description: task.title,
        timestamp: ((isCompleted ? task.completedAt : task.createdAt) || task.createdAt || now).toISOString(),
      });
    }

    for (const inv of invoices) {
      if (trackedEventEntityIds.has(inv.id)) continue;
      const total = toNum(inv.total);
      const isPaid = inv.status === 'PAID';
      const isOverdue = inv.status === 'OVERDUE';
      timeline.push({
        id: `inv_${inv.id}`,
        module: 'commerce',
        type: isPaid ? 'invoice.paid' : isOverdue ? 'invoice.overdue' : 'invoice.created',
        title: isPaid ? 'Payment received' : isOverdue ? 'Invoice overdue' : `Invoice ${(inv.status || '').toLowerCase()}`,
        description: total > 0 ? `TTD ${total.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : inv.invoiceNumber || undefined,
        timestamp: (isPaid && inv.paidAt ? inv.paidAt : inv.createdAt).toISOString(),
        value: total,
        currency: inv.currency || 'TTD',
        status: inv.status,
        entityId: inv.id,
        ctaLabel: 'View Invoice',
        ctaModule: 'commerce',
      });
    }

    for (const q of quotes) {
      if (trackedEventEntityIds.has(q.id)) continue;
      const total = toNum(q.total);
      timeline.push({
        id: `quote_${q.id}`,
        module: 'commerce',
        type: q.status === 'ACCEPTED' ? 'quote.accepted' : 'quote.created',
        title: q.status === 'ACCEPTED' ? 'Quote accepted' : 'Quote sent',
        description: q.quoteNumber || (total > 0 ? `TTD ${total.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : undefined),
        timestamp: q.createdAt.toISOString(),
        value: total,
        currency: q.currency || 'TTD',
        status: q.status || undefined,
        entityId: q.id,
        ctaLabel: 'View Quote',
        ctaModule: 'commerce',
      });
    }

    for (const bk of bookings) {
      if (trackedEventEntityIds.has(bk.id)) continue;
      const isCompleted = bk.status === 'COMPLETED';
      const isCancelled = bk.status === 'CANCELLED';
      timeline.push({
        id: `bk_${bk.id}`,
        module: 'bookings',
        type: isCompleted ? 'booking.completed' : isCancelled ? 'booking.cancelled' : 'booking.created',
        title: isCompleted ? 'Service completed' : isCancelled ? 'Booking cancelled' : 'Appointment scheduled',
        timestamp: bk.startTime.toISOString(),
        status: bk.status,
        entityId: bk.id,
        ctaLabel: 'View Booking',
        ctaModule: 'bookings',
      });
    }

    timeline.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    const moduleCounts = { crm: 0, bookings: 0, commerce: 0, marketing: 0 };
    for (const item of timeline) moduleCounts[item.module]++;

    const paidRevenue = invoices
      .filter(i => i.status === 'PAID')
      .reduce((sum, i) => sum + toNum(i.total), 0);

    const allTimestamps = timeline.map(t => new Date(t.timestamp).getTime());
    const lastInteractionAt = allTimestamps.length > 0
      ? new Date(Math.max(...allTimestamps)).toISOString()
      : null;

    const daysSinceLastInteraction = lastInteractionAt
      ? Math.floor((now.getTime() - new Date(lastInteractionAt).getTime()) / (1000 * 60 * 60 * 24))
      : 999;

    const activityScore = Math.min(40, events.length * 4);
    const bookingScore = Math.min(20, bookings.length * 10);
    const revenueScore = paidRevenue > 0 ? Math.min(20, Math.log10(paidRevenue + 1) * 5) : 0;
    const recencyScore = daysSinceLastInteraction <= 7 ? 20 : daysSinceLastInteraction <= 30 ? 10 : daysSinceLastInteraction <= 90 ? 5 : 0;
    const momentum = Math.round(Math.min(100, activityScore + bookingScore + revenueScore + recencyScore));

    const engagementLevel: 'high' | 'medium' | 'low' =
      recentEventCount >= 5 ? 'high' : recentEventCount >= 2 ? 'medium' : 'low';

    return {
      timeline,
      summary: {
        bookingsCount: bookings.length,
        totalRevenue: paidRevenue,
        lastInteractionAt,
        momentum,
        engagementLevel,
        moduleCounts,
      },
    };
  }

  private getEventTitle(type: string): string {
    const titleMap: Record<string, string> = {
      'contact.created': 'Contact created',
      'status.changed': 'Status changed',
      'STATUS_CHANGED': 'Status changed',
      'note.created': 'Note added',
      'note.updated': 'Note updated',
      'note.deleted': 'Note deleted',
      'task.created': 'Task created',
      'task.completed': 'Task completed',
      'task.updated': 'Task updated',
      'task.reopened': 'Task reopened',
      'invoice.created': 'Invoice created',
      'invoice.sent': 'Invoice sent',
      'invoice.paid': 'Payment received',
      'invoice.overdue': 'Invoice overdue',
      'booking.created': 'Booking scheduled',
      'booking.confirmed': 'Booking confirmed',
      'booking.completed': 'Service completed',
      'booking.cancelled': 'Booking cancelled',
      'quote.created': 'Quote sent',
      'quote.accepted': 'Quote accepted',
      'quote.rejected': 'Quote rejected',
      'campaign.sent': 'Campaign sent',
      'campaign.opened': 'Campaign opened',
      'lead_form.submitted': 'Form submitted',
      'email.sent': 'Email sent',
      'whatsapp.sent': 'WhatsApp sent',
      'communication.call': 'Call logged',
      'communication.email': 'Email logged',
      'communication.whatsapp': 'WhatsApp logged',
      'communication.meeting': 'Meeting logged',
      'automation.executed': 'Automation ran',
      'autopilot.approved': 'Autopilot action approved',
      'autopilot.denied': 'Autopilot action denied',
    };
    return titleMap[type] || type.replace(/[._]/g, ' ').replace(/^\w/, c => c.toUpperCase());
  }

  async getConversationContext(businessId: string, contactId: string): Promise<ConversationContext> {
    const [contact, recentNotes, recentEvents] = await Promise.all([
      this.db.contact.findFirst({
        where: contactWhereWithId(businessId, contactId),
      }),
      this.db.contactNote.findMany({
        where: { businessId, contactId },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
      this.db.contactEvent.findMany({
        where: { businessId, contactId },
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
      this.db.contactEvent.count({ where: { businessId, contactId } }),
      this.db.contactNote.count({ where: { businessId, contactId } }),
      this.db.invoice.findMany({
        where: { businessId, contactId },
        select: { status: true, total: true },
      }),
      this.db.contactTask.findMany({
        where: { businessId, contactId, status: { not: 'DONE' } },
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
    const totalRevenue = paidInvoices.reduce((sum, i) => sum + toNum(i.total), 0);
    
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
