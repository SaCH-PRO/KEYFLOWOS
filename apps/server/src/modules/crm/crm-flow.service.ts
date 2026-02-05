import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

type FlowIntelligenceData = {
  totalContacts: number;
  leads: number;
  prospects: number;
  clients: number;
  lost: number;
  newThisWeek: number;
  conversionsThisWeek: number;
  contactsGoingCold: number;
  contactsReadyToAdvance: number;
  weeklyChange: number;
};

type NextAction = {
  id: string;
  type: 'follow_up' | 'send_quote' | 'call' | 'email' | 'payment_reminder' | 'task';
  contactId: string;
  contactName: string;
  description: string;
  aiDraft?: string;
  estimatedTime: number;
  priority: 'urgent' | 'high' | 'medium' | 'low';
  dueDate?: string;
  value?: number;
};

type AutopilotAction = {
  id: string;
  type: 'follow_up' | 'birthday' | 'payment_reminder' | 'check_in' | 'offer';
  status: 'completed' | 'pending' | 'needs_approval';
  contactName: string;
  contactId: string;
  description: string;
  scheduledAt?: string;
  completedAt?: string;
};

type RevenueData = {
  fromActivePipeline: number;
  fromRecurringClients: number;
  fromColdLeads: number;
  expiringQuotes: { count: number; value: number };
  overdueInvoices: { count: number; value: number };
};

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
export class CrmFlowService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  async getFlowIntelligence(businessId: string): Promise<FlowIntelligenceData> {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [allContacts, statusCounts, newThisWeek, newLastWeek, conversions, coldContacts, readyContacts] = await Promise.all([
      this.db.contact.count({
        where: { businessId, deletedAt: null },
      }),
      this.db.contact.groupBy({
        by: ['status'],
        where: { businessId, deletedAt: null },
        _count: true,
      }),
      this.db.contact.count({
        where: { businessId, deletedAt: null, createdAt: { gte: weekAgo } },
      }),
      this.db.contact.count({
        where: { businessId, deletedAt: null, createdAt: { gte: twoWeeksAgo, lt: weekAgo } },
      }),
      this.db.contactEvent.count({
        where: {
          contact: { businessId, deletedAt: null },
          type: 'STATUS_CHANGED',
          createdAt: { gte: weekAgo },
        },
      }),
      this.db.contact.count({
        where: {
          businessId,
          deletedAt: null,
          status: { in: ['LEAD', 'PROSPECT'] },
          updatedAt: { lt: thirtyDaysAgo },
        },
      }),
      this.db.contact.count({
        where: {
          businessId,
          deletedAt: null,
          status: 'LEAD',
          updatedAt: { gte: weekAgo },
        },
      }),
    ]);

    const statusMap = statusCounts.reduce((acc, { status, _count }) => {
      acc[status || 'LEAD'] = _count;
      return acc;
    }, {} as Record<string, number>);

    const weeklyChange = newLastWeek > 0 
      ? Math.round(((newThisWeek - newLastWeek) / newLastWeek) * 100)
      : newThisWeek > 0 ? 100 : 0;

    return {
      totalContacts: allContacts,
      leads: statusMap['LEAD'] || 0,
      prospects: statusMap['PROSPECT'] || 0,
      clients: statusMap['CLIENT'] || 0,
      lost: statusMap['LOST'] || 0,
      newThisWeek,
      conversionsThisWeek: conversions,
      contactsGoingCold: coldContacts,
      contactsReadyToAdvance: readyContacts,
      weeklyChange,
    };
  }

  async getNextActions(businessId: string): Promise<NextAction[]> {
    const now = new Date();
    const actions: NextAction[] = [];

    const [overdueTasks, pendingQuotes, unpaidInvoices, recentLeads] = await Promise.all([
      this.db.contactTask.findMany({
        where: {
          contact: { businessId, deletedAt: null },
          status: { not: 'DONE' },
          dueDate: { lt: now },
        },
        include: { contact: true },
        take: 5,
        orderBy: { dueDate: 'asc' },
      }),
      this.db.quote.findMany({
        where: {
          businessId,
          status: 'SENT',
          expiresAt: { gt: now },
        },
        include: { contact: true },
        take: 5,
        orderBy: { expiresAt: 'asc' },
      }),
      this.db.invoice.findMany({
        where: {
          businessId,
          status: { in: ['SENT', 'OVERDUE'] },
        },
        include: { contact: true },
        take: 5,
        orderBy: { dueDate: 'asc' },
      }),
      this.db.contact.findMany({
        where: {
          businessId,
          deletedAt: null,
          status: 'LEAD',
          createdAt: { gte: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000) },
        },
        take: 5,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    for (const task of overdueTasks) {
      actions.push({
        id: `task_${task.id}`,
        type: 'task',
        contactId: task.contactId,
        contactName: `${task.contact?.firstName ?? ''} ${task.contact?.lastName ?? ''}`.trim() || 'Unknown',
        description: task.title,
        estimatedTime: 60,
        priority: 'urgent',
        dueDate: task.dueDate?.toISOString(),
      });
    }

    for (const quote of pendingQuotes) {
      actions.push({
        id: `quote_${quote.id}`,
        type: 'follow_up',
        contactId: quote.contactId || '',
        contactName: `${quote.contact?.firstName ?? ''} ${quote.contact?.lastName ?? ''}`.trim() || 'Unknown',
        description: `Follow up on quote ${quote.quoteNumber}`,
        estimatedTime: 30,
        priority: 'high',
        value: quote.total?.toNumber?.() ?? quote.total,
      });
    }

    for (const invoice of unpaidInvoices) {
      const isOverdue = invoice.status === 'OVERDUE';
      actions.push({
        id: `invoice_${invoice.id}`,
        type: 'payment_reminder',
        contactId: invoice.contactId || '',
        contactName: `${invoice.contact?.firstName ?? ''} ${invoice.contact?.lastName ?? ''}`.trim() || 'Unknown',
        description: `Payment reminder for ${invoice.invoiceNumber}`,
        estimatedTime: 30,
        priority: isOverdue ? 'urgent' : 'medium',
        value: invoice.total?.toNumber?.() ?? invoice.total,
      });
    }

    for (const lead of recentLeads) {
      actions.push({
        id: `lead_${lead.id}`,
        type: 'call',
        contactId: lead.id,
        contactName: `${lead.firstName ?? ''} ${lead.lastName ?? ''}`.trim() || 'Unknown',
        description: 'Initial call to new lead',
        aiDraft: `Hi ${lead.firstName || 'there'}! I wanted to reach out and learn more about how I can help you.`,
        estimatedTime: 45,
        priority: 'high',
      });
    }

    return actions.sort((a, b) => {
      const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    }).slice(0, 10);
  }

  async getAutopilotActions(businessId: string): Promise<AutopilotAction[]> {
    const now = new Date();
    const actions: AutopilotAction[] = [];

    const recentTasks = await this.db.contactTask.findMany({
      where: {
        contact: { businessId, deletedAt: null },
        completedAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
      },
      include: { contact: true },
      take: 5,
    });

    for (const task of recentTasks) {
      actions.push({
        id: `auto_${task.id}`,
        type: 'follow_up',
        status: 'completed',
        contactId: task.contactId,
        contactName: `${task.contact?.firstName ?? ''} ${task.contact?.lastName ?? ''}`.trim() || 'Unknown',
        description: `Completed: ${task.title}`,
        completedAt: task.completedAt?.toISOString(),
      });
    }

    const pendingTasks = await this.db.contactTask.findMany({
      where: {
        contact: { businessId, deletedAt: null },
        status: { not: 'DONE' },
        dueDate: { gte: now, lt: new Date(now.getTime() + 24 * 60 * 60 * 1000) },
      },
      include: { contact: true },
      take: 5,
    });

    for (const task of pendingTasks) {
      actions.push({
        id: `pending_${task.id}`,
        type: 'check_in',
        status: 'pending',
        contactId: task.contactId,
        contactName: `${task.contact?.firstName ?? ''} ${task.contact?.lastName ?? ''}`.trim() || 'Unknown',
        description: task.title,
        scheduledAt: task.dueDate?.toISOString(),
      });
    }

    return actions;
  }

  async getPredictiveRevenue(businessId: string): Promise<RevenueData> {
    const now = new Date();
    const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const [activeQuotes, overdueInvoices, expiringQuotes, recurringClients] = await Promise.all([
      this.db.quote.findMany({
        where: {
          businessId,
          status: { in: ['SENT', 'ACCEPTED'] },
        },
        select: { total: true },
      }),
      this.db.invoice.findMany({
        where: {
          businessId,
          status: 'OVERDUE',
        },
        select: { total: true },
      }),
      this.db.quote.findMany({
        where: {
          businessId,
          status: 'SENT',
          expiresAt: { lte: sevenDaysFromNow, gte: now },
        },
        select: { total: true },
      }),
      this.db.contact.findMany({
        where: {
          businessId,
          deletedAt: null,
          status: 'CLIENT',
        },
        select: { id: true },
      }),
    ]);

    const fromActivePipeline = activeQuotes.reduce((sum, q) => {
      const val = q.total?.toNumber?.() ?? q.total ?? 0;
      return sum + val;
    }, 0);

    const fromRecurringClients = recurringClients.length * 1500;

    const expiringValue = expiringQuotes.reduce((sum, q) => {
      const val = q.total?.toNumber?.() ?? q.total ?? 0;
      return sum + val;
    }, 0);

    const overdueValue = overdueInvoices.reduce((sum, inv) => {
      const val = inv.total?.toNumber?.() ?? inv.total ?? 0;
      return sum + val;
    }, 0);

    return {
      fromActivePipeline,
      fromRecurringClients,
      fromColdLeads: Math.round(fromActivePipeline * 0.1),
      expiringQuotes: { count: expiringQuotes.length, value: expiringValue },
      overdueInvoices: { count: overdueInvoices.length, value: overdueValue },
    };
  }

  async getContactHealthMetrics(businessId: string, contactId: string): Promise<HealthMetrics> {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [contact, recentEvents, paidInvoices, totalInvoices, recentNotes] = await Promise.all([
      this.db.contact.findFirst({
        where: { id: contactId, businessId, deletedAt: null },
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
        where: { id: contactId, businessId, deletedAt: null },
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
        value: quote.total?.toNumber?.() ?? quote.total,
      });
    }

    for (const invoice of invoices) {
      milestones.push({
        id: `payment_${invoice.id}`,
        type: 'payment',
        title: 'Payment Received',
        description: invoice.invoiceNumber || undefined,
        date: (invoice.paidAt || invoice.createdAt).toISOString(),
        value: invoice.total?.toNumber?.() ?? invoice.total,
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
        where: { id: contactId, businessId, deletedAt: null },
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

  async completeNextAction(businessId: string, actionId: string): Promise<{ success: boolean; message: string }> {
    const parts = actionId.split('_');
    if (parts.length < 2) {
      return { success: false, message: 'Invalid action ID format' };
    }
    
    const [type, id] = [parts[0], parts.slice(1).join('_')];
    
    try {
      switch (type) {
        case 'task': {
          const task = await this.db.contactTask.findFirst({
            where: { id, contact: { businessId, deletedAt: null } },
          });
          if (!task) {
            return { success: false, message: 'Task not found or not authorized' };
          }
          await this.db.contactTask.update({
            where: { id },
            data: { status: 'DONE', completedAt: new Date() },
          });
          return { success: true, message: 'Task completed' };
        }
        case 'quote': {
          const quote = await this.db.quote.findFirst({
            where: { id, businessId },
          });
          if (!quote) {
            return { success: false, message: 'Quote not found or not authorized' };
          }
          return { success: true, message: 'Quote follow-up marked complete' };
        }
        case 'invoice': {
          const invoice = await this.db.invoice.findFirst({
            where: { id, businessId },
          });
          if (!invoice) {
            return { success: false, message: 'Invoice not found or not authorized' };
          }
          return { success: true, message: 'Payment reminder marked complete' };
        }
        case 'lead': {
          const lead = await this.db.contact.findFirst({
            where: { id, businessId, deletedAt: null },
          });
          if (!lead) {
            return { success: false, message: 'Lead not found or not authorized' };
          }
          return { success: true, message: 'Lead call marked complete' };
        }
        case 'pending': {
          const task = await this.db.contactTask.findFirst({
            where: { id, contact: { businessId, deletedAt: null } },
          });
          if (!task) {
            return { success: false, message: 'Pending task not found or not authorized' };
          }
          await this.db.contactTask.update({
            where: { id },
            data: { status: 'DONE', completedAt: new Date() },
          });
          return { success: true, message: 'Task completed' };
        }
        default:
          return { success: false, message: `Unknown action type: ${type}` };
      }
    } catch (error) {
      console.error('Error completing action:', error);
      return { success: false, message: 'Failed to complete action' };
    }
  }

  async generateAiInsight(businessId: string, contactId: string): Promise<AiInsight> {
    const [contact, events, notes, invoices, tasks] = await Promise.all([
      this.db.contact.findFirst({
        where: { id: contactId, businessId, deletedAt: null },
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
    const totalRevenue = paidInvoices.reduce((sum, i) => sum + (i.total?.toNumber?.() ?? i.total ?? 0), 0);
    
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
