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
  contactPhone?: string;
  contactEmail?: string;
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

  private contactName(c: { firstName?: string | null; lastName?: string | null }): string {
    return `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim() || 'Unknown';
  }

  private daysBetween(from: Date, to: Date): number {
    return Math.floor((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000));
  }

  private toNum(v: any): number {
    return v?.toNumber?.() ?? v ?? 0;
  }

  async getNextActions(businessId: string): Promise<NextAction[]> {
    const now = new Date();
    const actions: NextAction[] = [];
    const seen = new Set<string>();

    const push = (a: NextAction) => {
      const dedup = `${a.type}_${a.contactId}_${a.id}`;
      if (!seen.has(dedup)) {
        seen.add(dedup);
        actions.push(a);
      }
    };

    const DAY = 24 * 60 * 60 * 1000;
    const threeDaysAgo = new Date(now.getTime() - 3 * DAY);
    const sevenDaysAgo = new Date(now.getTime() - 7 * DAY);
    const fourteenDaysAgo = new Date(now.getTime() - 14 * DAY);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * DAY);
    const twentyFourHoursFromNow = new Date(now.getTime() + DAY);
    const fortyEightHoursFromNow = new Date(now.getTime() + 2 * DAY);

    const [
      overdueTasks,
      upcomingTasks,
      pendingQuotes,
      expiringQuotes,
      unpaidInvoices,
      allContacts,
      recentEvents,
      upcomingBookings,
      acceptedQuotesNoInvoice,
      recentPayments,
    ] = await Promise.all([
      this.db.contactTask.findMany({
        where: {
          contact: { businessId, deletedAt: null },
          status: { not: 'DONE' },
          dueDate: { lt: now },
        },
        include: { contact: true },
        take: 8,
        orderBy: { dueDate: 'asc' },
      }),
      this.db.contactTask.findMany({
        where: {
          contact: { businessId, deletedAt: null },
          status: { not: 'DONE' },
          dueDate: { gte: now, lte: fortyEightHoursFromNow },
        },
        include: { contact: true },
        take: 8,
        orderBy: { dueDate: 'asc' },
      }),
      this.db.quote.findMany({
        where: {
          businessId,
          status: 'SENT',
          expiryDate: { gt: now },
        },
        include: { contact: true },
        take: 8,
        orderBy: { createdAt: 'asc' },
      }),
      this.db.quote.findMany({
        where: {
          businessId,
          status: 'SENT',
          expiryDate: { gt: now, lte: new Date(now.getTime() + 3 * DAY) },
        },
        include: { contact: true },
        take: 5,
        orderBy: { expiryDate: 'asc' },
      }),
      this.db.invoice.findMany({
        where: {
          businessId,
          status: { in: ['SENT', 'OVERDUE'] },
        },
        include: { contact: true },
        take: 8,
        orderBy: { dueDate: 'asc' },
      }),
      this.db.contact.findMany({
        where: { businessId, deletedAt: null },
        select: {
          id: true, firstName: true, lastName: true, status: true,
          createdAt: true, updatedAt: true, leadScore: true,
          lastInteractionAt: true,
          tags: true, lifecycleStage: true, email: true, phone: true,
        },
        orderBy: { updatedAt: 'asc' },
        take: 200,
      }),
      this.db.contactEvent.findMany({
        where: {
          contact: { businessId, deletedAt: null },
          createdAt: { gte: thirtyDaysAgo },
        },
        select: { contactId: true, type: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.db.booking.findMany({
        where: {
          contact: { businessId, deletedAt: null },
          startTime: { gte: now, lte: fortyEightHoursFromNow },
          status: { in: ['PENDING', 'CONFIRMED'] },
        },
        include: { contact: true },
        take: 5,
        orderBy: { startTime: 'asc' },
      }),
      this.db.quote.findMany({
        where: {
          businessId,
          status: 'ACCEPTED',
          createdAt: { gte: thirtyDaysAgo },
        },
        include: { contact: true },
        take: 5,
      }),
      this.db.invoice.findMany({
        where: {
          businessId,
          status: 'PAID',
          paidAt: { gte: sevenDaysAgo },
        },
        include: { contact: true },
        take: 5,
        orderBy: { paidAt: 'desc' },
      }),
    ]);

    const eventsByContact = new Map<string, { type: string; createdAt: Date }[]>();
    for (const e of recentEvents) {
      const list = eventsByContact.get(e.contactId) || [];
      list.push(e);
      eventsByContact.set(e.contactId, list);
    }

    const invoiceContactIds = new Set(
      unpaidInvoices.map(i => i.contactId).filter(Boolean) as string[]
    );

    const contactsWithTaskActions = new Set<string>();
    for (const t of overdueTasks) contactsWithTaskActions.add(t.contactId);
    for (const t of upcomingTasks) contactsWithTaskActions.add(t.contactId);

    for (const task of overdueTasks) {
      const daysOverdue = this.daysBetween(new Date(task.dueDate!), now);
      push({
        id: `task_${task.id}`,
        type: 'task',
        contactId: task.contactId,
        contactName: this.contactName(task.contact || {}),
        description: `Overdue: ${task.title}${daysOverdue > 1 ? ` (${daysOverdue}d late)` : ''}`,
        estimatedTime: 30,
        priority: daysOverdue > 3 ? 'urgent' : 'high',
        dueDate: task.dueDate?.toISOString(),
      });
    }

    for (const task of upcomingTasks) {
      push({
        id: `scheduled_${task.id}`,
        type: 'task',
        contactId: task.contactId,
        contactName: this.contactName(task.contact || {}),
        description: `Due soon: ${task.title}`,
        estimatedTime: 30,
        priority: 'high',
        dueDate: task.dueDate?.toISOString(),
      });
    }

    for (const booking of upcomingBookings) {
      if (!booking.contact) continue;
      const hoursUntil = Math.round((new Date(booking.startTime).getTime() - now.getTime()) / (60 * 60 * 1000));
      push({
        id: `booking_${booking.id}`,
        type: 'call',
        contactId: booking.contactId!,
        contactName: this.contactName(booking.contact),
        description: `Upcoming booking in ${hoursUntil < 24 ? `${hoursUntil}h` : `${Math.round(hoursUntil / 24)}d`} — prepare`,
        estimatedTime: 15,
        priority: hoursUntil < 4 ? 'urgent' : 'high',
        dueDate: booking.startTime.toISOString(),
      });
    }

    for (const invoice of unpaidInvoices) {
      const isOverdue = invoice.status === 'OVERDUE';
      const daysPast = invoice.dueDate ? this.daysBetween(new Date(invoice.dueDate), now) : 0;
      push({
        id: `invoice_${invoice.id}`,
        type: 'payment_reminder',
        contactId: invoice.contactId || '',
        contactName: this.contactName(invoice.contact || {}),
        description: isOverdue
          ? `Payment ${daysPast}d overdue — ${invoice.invoiceNumber}`
          : `Payment reminder for ${invoice.invoiceNumber}`,
        estimatedTime: 15,
        priority: isOverdue && daysPast > 7 ? 'urgent' : isOverdue ? 'high' : 'medium',
        value: this.toNum(invoice.total),
        dueDate: invoice.dueDate?.toISOString(),
      });
    }

    for (const quote of expiringQuotes) {
      if (!quote.contact) continue;
      const hoursToExpiry = Math.round((new Date(quote.expiryDate!).getTime() - now.getTime()) / (60 * 60 * 1000));
      push({
        id: `expiring_${quote.id}`,
        type: 'follow_up',
        contactId: quote.contactId || '',
        contactName: this.contactName(quote.contact),
        description: `Quote ${quote.quoteNumber} expires in ${hoursToExpiry < 24 ? `${hoursToExpiry}h` : `${Math.round(hoursToExpiry / 24)}d`}`,
        aiDraft: `Hi ${quote.contact.firstName || 'there'}! Just a heads up — the quote I sent you is expiring soon. Want to chat before it does?`,
        estimatedTime: 15,
        priority: hoursToExpiry < 24 ? 'urgent' : 'high',
        value: this.toNum(quote.total),
        dueDate: quote.expiryDate?.toISOString(),
      });
    }

    for (const quote of pendingQuotes) {
      if (actions.some(a => a.id === `expiring_${quote.id}`)) continue;
      if (!quote.contact) continue;
      const daysSinceSent = this.daysBetween(new Date(quote.createdAt), now);
      if (daysSinceSent < 3) continue;
      push({
        id: `quote_${quote.id}`,
        type: 'follow_up',
        contactId: quote.contactId || '',
        contactName: this.contactName(quote.contact),
        description: `Follow up on quote ${quote.quoteNumber} — sent ${daysSinceSent}d ago`,
        aiDraft: `Hi ${quote.contact.firstName || 'there'}! I wanted to follow up on the quote I sent over. Do you have any questions?`,
        estimatedTime: 20,
        priority: daysSinceSent > 7 ? 'high' : 'medium',
        value: this.toNum(quote.total),
      });
    }

    const acceptedQuoteInvoiceCheck = await Promise.all(
      acceptedQuotesNoInvoice.map(async q => {
        const hasInvoice = await this.db.invoice.findFirst({
          where: { quoteId: q.id },
          select: { id: true },
        });
        return hasInvoice ? null : q;
      })
    );
    for (const quote of acceptedQuoteInvoiceCheck) {
      if (!quote || !quote.contact) continue;
      push({
        id: `convert_${quote.id}`,
        type: 'send_quote',
        contactId: quote.contactId || '',
        contactName: this.contactName(quote.contact),
        description: `Quote ${quote.quoteNumber} accepted — create invoice`,
        estimatedTime: 10,
        priority: 'high',
        value: this.toNum(quote.total),
      });
    }

    for (const payment of recentPayments) {
      if (!payment.contact) continue;
      const daysSince = this.daysBetween(new Date(payment.paidAt!), now);
      if (daysSince > 3) continue;
      push({
        id: `thankyou_${payment.id}`,
        type: 'email',
        contactId: payment.contactId || '',
        contactName: this.contactName(payment.contact),
        description: `Thank ${payment.contact.firstName || 'client'} for payment — ${payment.invoiceNumber}`,
        aiDraft: `Hi ${payment.contact.firstName || 'there'}! Thank you so much for your payment. It's a pleasure working with you!`,
        estimatedTime: 5,
        priority: 'low',
        value: this.toNum(payment.total),
      });
    }

    for (const contact of allContacts) {
      if (contactsWithTaskActions.has(contact.id)) continue;

      const lastTouch = contact.lastInteractionAt || contact.updatedAt;
      const daysSinceTouch = this.daysBetween(new Date(lastTouch), now);
      const daysSinceCreated = this.daysBetween(new Date(contact.createdAt), now);
      const contactEvents = eventsByContact.get(contact.id) || [];
      const hasRecentEvent = contactEvents.some(e => this.daysBetween(new Date(e.createdAt), now) < 7);
      const firstName = contact.firstName || 'there';
      const name = this.contactName(contact);
      const hasInvoice = invoiceContactIds.has(contact.id);

      if (contact.status === 'LEAD') {
        if (daysSinceCreated <= 1 && !hasRecentEvent) {
          push({
            id: `newlead_${contact.id}`,
            type: 'call',
            contactId: contact.id,
            contactName: name,
            description: 'New lead — make first contact',
            aiDraft: `Hi ${firstName}! I saw you recently connected with us. I'd love to learn how I can help you.`,
            estimatedTime: 30,
            priority: 'high',
          });
        } else if (daysSinceCreated > 1 && daysSinceCreated <= 3 && !hasRecentEvent) {
          push({
            id: `warmup_${contact.id}`,
            type: 'email',
            contactId: contact.id,
            contactName: name,
            description: `New lead (${daysSinceCreated}d ago) — send intro email`,
            aiDraft: `Hi ${firstName}! Just wanted to follow up and introduce myself properly. I'd love to chat about how we can work together.`,
            estimatedTime: 15,
            priority: 'high',
          });
        } else if (daysSinceTouch > 7 && daysSinceTouch <= 14 && !hasRecentEvent) {
          push({
            id: `leadnurture_${contact.id}`,
            type: 'follow_up',
            contactId: contact.id,
            contactName: name,
            description: `Lead quiet for ${daysSinceTouch}d — send value content`,
            aiDraft: `Hi ${firstName}! I thought you might find this useful — would love to share some insights relevant to your needs.`,
            estimatedTime: 15,
            priority: 'medium',
          });
        } else if (daysSinceTouch > 14 && !hasInvoice) {
          push({
            id: `cold_${contact.id}`,
            type: 'follow_up',
            contactId: contact.id,
            contactName: name,
            description: `No interaction in ${daysSinceTouch}d — re-engage or archive`,
            aiDraft: `Hi ${firstName}! It's been a while since we last connected. I wanted to check in — are you still looking for help?`,
            estimatedTime: 15,
            priority: daysSinceTouch > 30 ? 'high' : 'medium',
          });
        }

        if ((contact.leadScore ?? 0) >= 70 && contactEvents.length >= 3) {
          push({
            id: `hotlead_${contact.id}`,
            type: 'call',
            contactId: contact.id,
            contactName: name,
            description: `Hot lead (score ${contact.leadScore}) — schedule discovery call`,
            estimatedTime: 30,
            priority: 'high',
          });
        }
      }

      if (contact.status === 'PROSPECT') {
        const hasQuote = pendingQuotes.some(q => q.contactId === contact.id) ||
          acceptedQuotesNoInvoice.some(q => q?.contactId === contact.id);

        if (!hasQuote && daysSinceCreated > 5 && !hasInvoice) {
          push({
            id: `sendquote_${contact.id}`,
            type: 'send_quote',
            contactId: contact.id,
            contactName: name,
            description: `Prospect for ${daysSinceCreated}d with no quote — prepare proposal`,
            estimatedTime: 45,
            priority: daysSinceCreated > 14 ? 'high' : 'medium',
          });
        }

        if (daysSinceCreated > 30 && daysSinceTouch > 14) {
          push({
            id: `stale_${contact.id}`,
            type: 'follow_up',
            contactId: contact.id,
            contactName: name,
            description: `Prospect stalling — ${daysSinceCreated}d in pipeline, ${daysSinceTouch}d silent`,
            aiDraft: `Hi ${firstName}! I wanted to follow up on our previous conversations. Is there anything holding things back that I can help with?`,
            estimatedTime: 30,
            priority: daysSinceCreated > 60 ? 'urgent' : 'high',
          });
        }
      }

      if (contact.status === 'CLIENT') {
        if (daysSinceTouch > 30 && !hasInvoice) {
          push({
            id: `clientcheckin_${contact.id}`,
            type: 'follow_up',
            contactId: contact.id,
            contactName: name,
            description: `Client quiet for ${daysSinceTouch}d — check satisfaction`,
            aiDraft: `Hi ${firstName}! Hope everything's going well. Just wanted to touch base and see if there's anything else I can help with.`,
            estimatedTime: 15,
            priority: daysSinceTouch > 60 ? 'high' : 'medium',
          });
        }

        if (daysSinceTouch > 60 && hasInvoice) {
          push({
            id: `upsell_${contact.id}`,
            type: 'call',
            contactId: contact.id,
            contactName: name,
            description: `Client with invoice history dormant ${daysSinceTouch}d — explore upsell`,
            estimatedTime: 30,
            priority: 'medium',
          });
        }
      }

      if (contact.status === 'LOST' && daysSinceTouch > 30 && daysSinceTouch <= 90) {
        push({
          id: `winback_${contact.id}`,
          type: 'email',
          contactId: contact.id,
          contactName: name,
          description: `Lost ${daysSinceTouch}d ago — consider win-back attempt`,
          aiDraft: `Hi ${firstName}! I know we didn't get to work together before, but I wanted to reach out — things may have changed and I'd love to reconnect.`,
          estimatedTime: 10,
          priority: 'low',
        });
      }
    }

    const dueCallEnrollments = await this.db.crmSequenceEnrollment.findMany({
      where: {
        status: 'active',
        nextStepAt: { lte: now },
        sequence: { businessId },
      },
      include: {
        contact: true,
        sequence: true,
      },
      take: 10,
      orderBy: { nextStepAt: 'asc' },
    });

    for (const enrollment of dueCallEnrollments) {
      if (!enrollment.contact || !enrollment.sequence) continue;
      const steps = Array.isArray(enrollment.sequence.steps) ? enrollment.sequence.steps as any[] : [];
      const currentStep = steps[enrollment.currentStep];
      if (!currentStep || currentStep.type !== 'call') continue;

      const callDesc = currentStep.notes || currentStep.subject || `Step ${enrollment.currentStep + 1}`;
      push({
        id: `seq_call_${enrollment.id}`,
        type: 'call',
        contactId: enrollment.contactId,
        contactName: this.contactName(enrollment.contact),
        description: `[Sequence: ${enrollment.sequence.name}] ${callDesc}`,
        estimatedTime: 30,
        priority: 'high',
        dueDate: enrollment.nextStepAt?.toISOString(),
      });
    }

    return actions.sort((a, b) => {
      const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3 };
      const pDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (pDiff !== 0) return pDiff;
      if (a.dueDate && b.dueDate) return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
      if (a.dueDate) return -1;
      if (b.dueDate) return 1;
      return 0;
    }).slice(0, 20);
  }

  async getAutopilotActions(businessId: string): Promise<AutopilotAction[]> {
    const now = new Date();
    const actions: AutopilotAction[] = [];
    const seen = new Set<string>();

    const push = (a: AutopilotAction) => {
      const dedup = `${a.type}_${a.contactId}`;
      if (!seen.has(dedup)) {
        seen.add(dedup);
        actions.push(a);
      }
    };

    const DAY = 24 * 60 * 60 * 1000;
    const oneDayAgo = new Date(now.getTime() - DAY);
    const sevenDaysAgo = new Date(now.getTime() - 7 * DAY);
    const fourteenDaysAgo = new Date(now.getTime() - 14 * DAY);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * DAY);
    const fortyEightHoursFromNow = new Date(now.getTime() + 2 * DAY);

    const [
      completedTasks,
      scheduledTasks,
      overdueInvoices,
      inactiveClients,
      coldLeads,
      completedBookings,
      newLeadsNoEvent,
      staleProspects,
    ] = await Promise.all([
      this.db.contactTask.findMany({
        where: {
          contact: { businessId, deletedAt: null },
          completedAt: { gte: oneDayAgo },
        },
        include: { contact: true },
        take: 6,
        orderBy: { completedAt: 'desc' },
      }),
      this.db.contactTask.findMany({
        where: {
          contact: { businessId, deletedAt: null },
          status: { not: 'DONE' },
          dueDate: { gte: now, lt: fortyEightHoursFromNow },
        },
        include: { contact: true },
        take: 6,
        orderBy: { dueDate: 'asc' },
      }),
      this.db.invoice.findMany({
        where: {
          businessId,
          status: 'OVERDUE',
          dueDate: { lt: sevenDaysAgo },
        },
        include: { contact: true },
        take: 6,
        orderBy: { dueDate: 'asc' },
      }),
      this.db.contact.findMany({
        where: {
          businessId,
          deletedAt: null,
          status: 'CLIENT',
          updatedAt: { lt: thirtyDaysAgo },
        },
        take: 6,
        orderBy: { updatedAt: 'asc' },
      }),
      this.db.contact.findMany({
        where: {
          businessId,
          deletedAt: null,
          status: 'LEAD',
          updatedAt: { lt: fourteenDaysAgo },
        },
        take: 5,
        orderBy: { updatedAt: 'asc' },
      }),
      this.db.booking.findMany({
        where: {
          contact: { businessId, deletedAt: null },
          status: 'COMPLETED',
          endTime: { gte: oneDayAgo, lte: now },
        },
        include: { contact: true },
        take: 5,
        orderBy: { endTime: 'desc' },
      }),
      this.db.contact.findMany({
        where: {
          businessId,
          deletedAt: null,
          status: 'LEAD',
          createdAt: { gte: new Date(now.getTime() - 2 * DAY) },
        },
        take: 5,
        orderBy: { createdAt: 'desc' },
      }),
      this.db.contact.findMany({
        where: {
          businessId,
          deletedAt: null,
          status: 'PROSPECT',
          updatedAt: { lt: thirtyDaysAgo },
        },
        take: 5,
        orderBy: { updatedAt: 'asc' },
      }),
    ]);

    for (const task of completedTasks) {
      push({
        id: `auto_${task.id}`,
        type: 'follow_up',
        status: 'completed',
        contactId: task.contactId,
        contactName: this.contactName(task.contact || {}),
        description: `Completed: ${task.title}`,
        completedAt: task.completedAt?.toISOString(),
      });
    }

    for (const task of scheduledTasks) {
      push({
        id: `pending_${task.id}`,
        type: 'check_in',
        status: 'pending',
        contactId: task.contactId,
        contactName: this.contactName(task.contact || {}),
        description: task.title,
        scheduledAt: task.dueDate?.toISOString(),
      });
    }

    for (const invoice of overdueInvoices) {
      const daysPastDue = this.daysBetween(new Date(invoice.dueDate!), now);
      push({
        id: `overdue_inv_${invoice.id}`,
        type: 'payment_reminder',
        status: 'needs_approval',
        contactId: invoice.contactId || '',
        contactName: this.contactName(invoice.contact || {}),
        contactPhone: (invoice.contact as any)?.phone || undefined,
        contactEmail: (invoice.contact as any)?.email || undefined,
        description: `Auto-send payment reminder for ${invoice.invoiceNumber} — ${daysPastDue}d overdue`,
        scheduledAt: now.toISOString(),
      });
    }

    for (const contact of inactiveClients) {
      const daysSince = this.daysBetween(new Date(contact.updatedAt), now);
      push({
        id: `checkin_${contact.id}`,
        type: 'check_in',
        status: 'needs_approval',
        contactId: contact.id,
        contactName: this.contactName(contact),
        contactPhone: contact.phone || undefined,
        contactEmail: contact.email || undefined,
        description: `Auto check-in with client — ${daysSince}d since last activity`,
        scheduledAt: now.toISOString(),
      });
    }

    for (const contact of coldLeads) {
      const daysSince = this.daysBetween(new Date(contact.updatedAt), now);
      push({
        id: `nudge_${contact.id}`,
        type: 'follow_up',
        status: 'needs_approval',
        contactId: contact.id,
        contactName: this.contactName(contact),
        contactPhone: contact.phone || undefined,
        contactEmail: contact.email || undefined,
        description: `Auto-send nurture email — lead cold for ${daysSince}d`,
        scheduledAt: now.toISOString(),
      });
    }

    for (const booking of completedBookings) {
      if (!booking.contact || !booking.contactId) continue;
      push({
        id: `postbooking_${booking.id}`,
        type: 'follow_up',
        status: 'needs_approval',
        contactId: booking.contactId,
        contactName: this.contactName(booking.contact),
        contactPhone: (booking.contact as any)?.phone || undefined,
        contactEmail: (booking.contact as any)?.email || undefined,
        description: `Send post-session follow-up after booking`,
        scheduledAt: now.toISOString(),
      });
    }

    for (const lead of newLeadsNoEvent) {
      const events = await this.db.contactEvent.count({ where: { contactId: lead.id } });
      if (events === 0) {
        push({
          id: `autowelcome_${lead.id}`,
          type: 'follow_up',
          status: 'needs_approval',
          contactId: lead.id,
          contactName: this.contactName(lead),
          contactPhone: lead.phone || undefined,
          contactEmail: lead.email || undefined,
          description: `Auto-send welcome message to new lead`,
          scheduledAt: now.toISOString(),
        });
      }
    }

    for (const contact of staleProspects) {
      const daysSince = this.daysBetween(new Date(contact.updatedAt), now);
      push({
        id: `stalenudge_${contact.id}`,
        type: 'offer',
        status: 'needs_approval',
        contactId: contact.id,
        contactName: this.contactName(contact),
        contactPhone: contact.phone || undefined,
        contactEmail: contact.email || undefined,
        description: `Prospect stalled ${daysSince}d — auto-send incentive offer`,
        scheduledAt: now.toISOString(),
      });
    }

    const dueEnrollments = await this.db.crmSequenceEnrollment.findMany({
      where: {
        status: 'active',
        nextStepAt: { lte: now },
        sequence: { businessId },
      },
      include: {
        contact: true,
        sequence: true,
      },
      take: 15,
      orderBy: { nextStepAt: 'asc' },
    });

    for (const enrollment of dueEnrollments) {
      if (!enrollment.contact || !enrollment.sequence) continue;
      const steps = Array.isArray(enrollment.sequence.steps) ? enrollment.sequence.steps as any[] : [];
      const currentStep = steps[enrollment.currentStep];
      if (!currentStep) continue;

      const stepType = currentStep.type as string;
      const actionType: AutopilotAction['type'] =
        stepType === 'call' ? 'check_in' :
        stepType === 'email' || stepType === 'whatsapp' ? 'follow_up' : 'follow_up';

      const stepDesc = currentStep.subject || currentStep.template || currentStep.notes || `Step ${enrollment.currentStep + 1}`;
      const truncatedDesc = typeof stepDesc === 'string' && stepDesc.length > 80
        ? stepDesc.slice(0, 80) + '…'
        : stepDesc;

      push({
        id: `seq_${enrollment.id}_step${enrollment.currentStep}`,
        type: actionType,
        status: 'needs_approval',
        contactId: enrollment.contactId,
        contactName: this.contactName(enrollment.contact),
        contactPhone: enrollment.contact.phone || undefined,
        contactEmail: enrollment.contact.email || undefined,
        description: `[Sequence: ${enrollment.sequence.name}] ${stepType} — ${truncatedDesc}`,
        scheduledAt: enrollment.nextStepAt?.toISOString(),
      });
    }

    return actions.slice(0, 15);
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
          expiryDate: { lte: sevenDaysFromNow, gte: now },
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
      const val = typeof q.total === 'object' && q.total !== null && 'toNumber' in q.total ? (q.total as any).toNumber() : Number(q.total ?? 0);
      return sum + val;
    }, 0);

    const fromRecurringClients = recurringClients.length * 1500;

    const expiringValue = expiringQuotes.reduce((sum, q) => {
      const val = typeof q.total === 'object' && q.total !== null && 'toNumber' in q.total ? (q.total as any).toNumber() : Number(q.total ?? 0);
      return sum + val;
    }, 0);

    const overdueValue = overdueInvoices.reduce((sum, inv) => {
      const val = typeof inv.total === 'object' && inv.total !== null && 'toNumber' in inv.total ? (inv.total as any).toNumber() : Number(inv.total ?? 0);
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

    const [type, ...rest] = parts;
    const id = rest.join('_');

    try {
      const taskTypes = ['task', 'scheduled', 'pending'];
      if (taskTypes.includes(type)) {
        const task = await this.db.contactTask.findFirst({
          where: { id, contact: { businessId, deletedAt: null } },
        });
        if (!task) return { success: false, message: 'Task not found' };
        await this.db.contactTask.update({
          where: { id },
          data: { status: 'DONE', completedAt: new Date() },
        });
        await this.db.contactEvent.create({
          data: {
            businessId,
            contactId: task.contactId,
            type: 'TASK_COMPLETED',
            data: { source: 'engage', taskId: id, actionType: type },
            source: 'system',
          },
        });
        return { success: true, message: 'Task completed' };
      }

      const contactActionTypes = [
        'cold', 'stale', 'leadnurture', 'warmup', 'newlead',
        'hotlead', 'sendquote', 'clientcheckin', 'upsell', 'winback',
        'nextsched',
      ];
      if (contactActionTypes.includes(type)) {
        const contact = await this.db.contact.findFirst({
          where: { id, businessId, deletedAt: null },
        });
        if (!contact) return { success: false, message: 'Contact not found' };
        await this.db.contactEvent.create({
          data: {
            businessId,
            contactId: id,
            type: 'ACTION_COMPLETED',
            data: { source: 'engage', actionType: type },
            source: 'system',
          },
        });
        await this.db.contact.update({
          where: { id },
          data: { lastInteractionAt: new Date(), updatedAt: new Date() },
        });
        return { success: true, message: 'Action marked complete' };
      }

      if (type === 'quote' || type === 'expiring') {
        const quote = await this.db.quote.findFirst({
          where: { id, businessId },
        });
        if (!quote) return { success: false, message: 'Quote not found' };
        if (quote.contactId) {
          await this.db.contactEvent.create({
            data: {
              businessId,
              contactId: quote.contactId,
              type: 'ACTION_COMPLETED',
              data: { source: 'engage', actionType: `${type}_follow_up`, quoteId: id },
              source: 'system',
            },
          });
          await this.db.contact.update({
            where: { id: quote.contactId },
            data: { lastInteractionAt: new Date(), updatedAt: new Date() },
          });
        }
        return { success: true, message: 'Quote follow-up marked complete' };
      }

      if (type === 'invoice') {
        const invoice = await this.db.invoice.findFirst({
          where: { id, businessId },
        });
        if (!invoice) return { success: false, message: 'Invoice not found' };
        if (invoice.contactId) {
          await this.db.contactEvent.create({
            data: {
              businessId,
              contactId: invoice.contactId,
              type: 'ACTION_COMPLETED',
              data: { source: 'engage', actionType: 'payment_reminder', invoiceId: id },
              source: 'system',
            },
          });
        }
        return { success: true, message: 'Payment reminder marked complete' };
      }

      if (type === 'convert') {
        const quote = await this.db.quote.findFirst({
          where: { id, businessId },
        });
        if (!quote) return { success: false, message: 'Quote not found' };
        return { success: true, message: 'Quote conversion action marked complete' };
      }

      if (type === 'booking') {
        const booking = await this.db.booking.findFirst({
          where: { id, contact: { businessId, deletedAt: null } },
          select: { contactId: true },
        });
        if (!booking) return { success: false, message: 'Booking not found' };
        if (booking.contactId) {
          await this.db.contactEvent.create({
            data: {
              businessId,
              contactId: booking.contactId,
              type: 'ACTION_COMPLETED',
              data: { source: 'engage', actionType: 'booking_prep' },
              source: 'system',
            },
          });
        }
        return { success: true, message: 'Booking prep marked complete' };
      }

      if (type === 'thankyou') {
        const invoice = await this.db.invoice.findFirst({
          where: { id, businessId },
        });
        if (!invoice) return { success: false, message: 'Invoice not found' };
        if (invoice.contactId) {
          await this.db.contactEvent.create({
            data: {
              businessId,
              contactId: invoice.contactId,
              type: 'ACTION_COMPLETED',
              data: { source: 'engage', actionType: 'thank_you_sent' },
              source: 'system',
            },
          });
        }
        return { success: true, message: 'Thank you marked complete' };
      }

      return { success: true, message: 'Action marked complete' };
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
