import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

interface FlowPhase {
  name: string;
  count: number;
  value: number;
  trend: 'up' | 'down' | 'stable';
}

interface FeedItem {
  id: string;
  icon: string;
  text: string;
  timestamp: string;
  tone?: 'success' | 'info' | 'warning' | 'error';
  actionType?: string;
  actionId?: string;
}

interface QuickAction {
  id: string;
  label: string;
  description: string;
  icon: string;
  href: string;
  priority: number;
}

interface PriorityItem {
  id: string;
  type: 'overdue_invoice' | 'unconfirmed_booking' | 'stale_lead' | 'draft_post' | 'follow_up' | 'unpaid_invoice';
  title: string;
  description: string;
  urgency: 'critical' | 'high' | 'medium' | 'low';
  actionLabel: string;
  actionHref: string;
  amount?: number;
  currency?: string;
  contactName?: string;
  daysSince?: number;
  whatsappLink?: string;
}

interface RevenueInsights {
  avgClientSpend: number;
  topService: { name: string; revenue: number; count: number } | null;
  leadConversionRate: number;
  clientRetentionRate: number;
  revenueGrowth: number;
  totalClients: number;
  repeatClients: number;
  avgInvoiceValue: number;
  collectionRate: number;
  monthlyTarget: number;
  monthlyProgress: number;
}

interface CockpitSummary {
  momentum: number;
  streaks: string[];
  phases: FlowPhase[];
  bottleneck: { phase: string; suggestion: string } | null;
  feed: FeedItem[];
  quickActions: QuickAction[];
  priorities: PriorityItem[];
  revenueInsights: RevenueInsights;
  stats: {
    totalContacts: number;
    activeLeads: number;
    pendingInvoices: number;
    overdueInvoices: number;
    upcomingBookings: number;
    monthlyRevenue: number;
    weeklyBookings: number;
    todayRevenue: number;
    todayBookings: number;
    completedBookingsToday: number;
    draftPosts: number;
    scheduledPosts: number;
  };
  highlights: {
    highPotential: { contactId: string; name: string; score: number }[];
    overdueReminders: { contactId: string; name: string; daysSince: number }[];
  };
}

@Injectable()
export class FlowService {
  private readonly logger = new Logger(FlowService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getCockpitSummary(businessId: string): Promise<CockpitSummary> {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfDay = new Date(startOfDay);
    endOfDay.setDate(endOfDay.getDate() + 1);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    startOfWeek.setHours(0, 0, 0, 0);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

    const [
      contacts,
      invoices,
      quotes,
      bookings,
      recentEvents,
      products,
      socialPosts,
      automations,
      lastMonthInvoices,
      allPaidInvoices,
      services,
    ] = await Promise.all([
      this.prisma.client.contact.findMany({
        where: { businessId, deletedAt: null },
        select: { id: true, firstName: true, lastName: true, displayName: true, email: true, phone: true, status: true, createdAt: true, custom: true, whatsappNumber: true },
        orderBy: { createdAt: 'desc' },
        take: 500,
      }),
      this.prisma.client.invoice.findMany({
        where: { businessId, deletedAt: null },
        include: { contact: { select: { firstName: true, lastName: true, displayName: true, email: true, phone: true, whatsappNumber: true } } },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
      this.prisma.client.quote.findMany({
        where: { businessId, deletedAt: null },
        include: { contact: { select: { firstName: true, lastName: true, displayName: true, email: true } } },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      this.prisma.client.booking.findMany({
        where: { businessId, deletedAt: null },
        include: {
          contact: { select: { firstName: true, lastName: true, displayName: true, phone: true, whatsappNumber: true } },
          service: { select: { name: true, price: true } },
          staff: { select: { name: true } },
        },
        orderBy: { startTime: 'desc' },
        take: 200,
      }),
      this.prisma.client.contactEvent.findMany({
        where: { businessId, createdAt: { gte: sevenDaysAgo } },
        include: { contact: { select: { firstName: true, lastName: true, displayName: true } } },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      this.prisma.client.product.findMany({
        where: { businessId, deletedAt: null, isActive: true },
        select: { id: true, name: true },
      }),
      this.prisma.client.socialPost.findMany({
        where: { businessId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 30,
      }),
      this.prisma.client.automation.findMany({
        where: { businessId, deletedAt: null },
        select: { id: true },
      }),
      this.prisma.client.invoice.findMany({
        where: { businessId, deletedAt: null, status: 'PAID', paidAt: { gte: startOfLastMonth, lt: startOfMonth } },
        select: { total: true },
      }),
      this.prisma.client.invoice.findMany({
        where: { businessId, deletedAt: null, status: 'PAID' },
        select: { total: true, contactId: true, paidAt: true },
      }),
      this.prisma.client.service.findMany({
        where: { businessId, deletedAt: null },
        select: { id: true, name: true, price: true },
        take: 50,
      }),
    ]);

    const leads = contacts.filter(c => c.status === 'LEAD');
    const activeLeads = leads.length;
    const totalContacts = contacts.length;
    const pendingInvoices = invoices.filter(i => i.status === 'SENT' || i.status === 'DRAFT').length;
    const overdueInvoices = invoices.filter(i => i.status === 'OVERDUE' || (i.status === 'SENT' && i.dueDate && new Date(i.dueDate) < now)).length;
    const upcomingBookings = bookings.filter(b => new Date(b.startTime) > now && b.status !== 'CANCELLED').length;

    const paidInvoicesThisMonth = invoices.filter(i => i.status === 'PAID' && i.paidAt && new Date(i.paidAt) >= startOfMonth);
    const monthlyRevenue = paidInvoicesThisMonth.reduce((sum, i) => sum + i.total, 0);

    const paidInvoicesToday = invoices.filter(i => i.status === 'PAID' && i.paidAt && new Date(i.paidAt) >= startOfDay && new Date(i.paidAt) < endOfDay);
    const todayRevenue = paidInvoicesToday.reduce((sum, i) => sum + i.total, 0);

    const weeklyBookings = bookings.filter(b => new Date(b.createdAt) >= startOfWeek).length;
    const todayBookings = bookings.filter(b => new Date(b.startTime) >= startOfDay && new Date(b.startTime) < endOfDay && b.status !== 'CANCELLED').length;
    const completedBookingsToday = bookings.filter(b => b.status === 'COMPLETED' && new Date(b.startTime) >= startOfDay && new Date(b.startTime) < endOfDay).length;
    const draftPosts = socialPosts.filter(p => p.status === 'DRAFT').length;
    const scheduledPosts = socialPosts.filter(p => p.status === 'SCHEDULED').length;

    const phases: FlowPhase[] = [
      { name: 'Leads', count: activeLeads, value: activeLeads * 100, trend: 'stable' },
      { name: 'Quotes Sent', count: quotes.filter(q => q.status === 'SENT').length, value: quotes.filter(q => q.status === 'SENT').reduce((s, q) => s + q.total, 0), trend: 'stable' },
      { name: 'Accepted', count: quotes.filter(q => q.status === 'ACCEPTED').length, value: quotes.filter(q => q.status === 'ACCEPTED').reduce((s, q) => s + q.total, 0), trend: 'up' },
      { name: 'Invoiced', count: invoices.filter(i => i.status === 'SENT').length, value: invoices.filter(i => i.status === 'SENT').reduce((s, i) => s + i.total, 0), trend: 'stable' },
      { name: 'Paid', count: paidInvoicesThisMonth.length, value: monthlyRevenue, trend: 'up' },
    ];

    let bottleneck: { phase: string; suggestion: string } | null = null;
    const sentQuotes = quotes.filter(q => q.status === 'SENT').length;
    const acceptedQuotes = quotes.filter(q => q.status === 'ACCEPTED').length;
    if (sentQuotes > 3 && acceptedQuotes === 0) {
      bottleneck = { phase: 'Quotes Sent', suggestion: 'Follow up on pending quotes to improve conversion rate' };
    } else if (pendingInvoices > 5) {
      bottleneck = { phase: 'Invoiced', suggestion: 'Send payment reminders for pending invoices' };
    } else if (activeLeads > 10 && sentQuotes < 2) {
      bottleneck = { phase: 'Leads', suggestion: 'Convert more leads by sending quotes' };
    }

    const feed: FeedItem[] = [];

    invoices.slice(0, 10).forEach(inv => {
      const contactName = inv.contact?.displayName || `${inv.contact?.firstName || ''} ${inv.contact?.lastName || ''}`.trim() || inv.contact?.email || 'Unknown';
      const icon = inv.status === 'PAID' ? '💸' : inv.status === 'OVERDUE' ? '⚠️' : '📄';
      const tone = inv.status === 'PAID' ? 'success' : inv.status === 'OVERDUE' ? 'warning' : undefined;
      feed.push({
        id: `inv-${inv.id}`,
        icon,
        text: `Invoice #${inv.invoiceNumber} ${inv.status.toLowerCase()} — ${contactName} ($${inv.total.toFixed(2)})`,
        timestamp: this.formatRelativeTime(inv.updatedAt),
        tone,
        actionType: 'invoice',
        actionId: inv.id,
      });
    });

    bookings.filter(b => new Date(b.startTime) > now).slice(0, 5).forEach(b => {
      const contactName = b.contact?.displayName || `${b.contact?.firstName || ''} ${b.contact?.lastName || ''}`.trim() || 'Customer';
      feed.push({
        id: `book-${b.id}`,
        icon: '🗓️',
        text: `Booking: ${b.service.name} with ${contactName} — ${this.formatDateTime(b.startTime)}`,
        timestamp: this.formatRelativeTime(b.createdAt),
        tone: 'info',
        actionType: 'booking',
        actionId: b.id,
      });
    });

    bookings.filter(b => b.status === 'COMPLETED').slice(0, 5).forEach(b => {
      const contactName = b.contact?.displayName || `${b.contact?.firstName || ''} ${b.contact?.lastName || ''}`.trim() || 'Customer';
      feed.push({
        id: `completed-${b.id}`,
        icon: '✅',
        text: `Completed: ${b.service.name} with ${contactName}`,
        timestamp: this.formatRelativeTime(b.startTime),
        tone: 'success',
        actionType: 'booking',
        actionId: b.id,
      });
    });

    socialPosts.filter(p => p.status === 'POSTED').slice(0, 3).forEach(p => {
      feed.push({
        id: `post-${p.id}`,
        icon: '📱',
        text: `Published: "${p.content.slice(0, 60)}${p.content.length > 60 ? '...' : ''}"`,
        timestamp: this.formatRelativeTime(p.postedAt ?? p.updatedAt),
        tone: 'success',
        actionType: 'social',
        actionId: p.id,
      });
    });

    recentEvents.slice(0, 10).forEach(event => {
      const contactName = event.contact?.displayName || `${event.contact?.firstName || ''} ${event.contact?.lastName || ''}`.trim() || 'Contact';
      feed.push({
        id: `event-${event.id}`,
        icon: '⚡',
        text: `${event.type}: ${contactName}`,
        timestamp: this.formatRelativeTime(event.createdAt),
        actionType: 'event',
        actionId: event.id,
      });
    });

    feed.sort((a, b) => this.parseRelativeTime(b.timestamp) - this.parseRelativeTime(a.timestamp));

    const priorities = this.buildPriorities(invoices, bookings, contacts, socialPosts, now, thirtyDaysAgo, sixtyDaysAgo);

    const quickActions: QuickAction[] = [];

    if (products.length === 0) {
      quickActions.push({ id: 'add-product', label: 'Add First Product', description: 'Create your first product or service', icon: 'Package', href: '/app/commerce?tab=products&action=new', priority: 1 });
    }
    if (totalContacts === 0) {
      quickActions.push({ id: 'add-contact', label: 'Add First Contact', description: 'Import or create your first customer', icon: 'UserPlus', href: '/app/crm/pipeline?action=new', priority: 1 });
    }
    if (overdueInvoices > 0) {
      quickActions.push({ id: 'overdue-invoices', label: 'Handle Overdue', description: `${overdueInvoices} overdue invoice${overdueInvoices > 1 ? 's' : ''} need attention`, icon: 'AlertTriangle', href: '/app/commerce?tab=invoices&status=OVERDUE', priority: 1 });
    }
    if (pendingInvoices > 0) {
      quickActions.push({ id: 'follow-up-invoices', label: 'Follow Up Invoices', description: `${pendingInvoices} invoice${pendingInvoices > 1 ? 's' : ''} awaiting payment`, icon: 'Send', href: '/app/commerce?tab=invoices&status=SENT', priority: 2 });
    }
    if (draftPosts > 0) {
      quickActions.push({ id: 'publish-drafts', label: 'Publish Draft Posts', description: `${draftPosts} post${draftPosts > 1 ? 's' : ''} ready to publish`, icon: 'Send', href: '/app/social', priority: 2 });
    }
    if (activeLeads > 5) {
      quickActions.push({ id: 'convert-leads', label: 'Convert Leads', description: `${activeLeads} leads ready for follow-up`, icon: 'TrendingUp', href: '/app/crm/pipeline?status=LEAD', priority: 2 });
    }
    if (services.length === 0) {
      quickActions.push({ id: 'add-service', label: 'Add a Service', description: 'Set up services for bookings', icon: 'Calendar', href: '/app/bookings?tab=services', priority: 2 });
    }
    if (automations.length === 0) {
      quickActions.push({ id: 'setup-automation', label: 'Setup Automation', description: 'Create your first automated workflow', icon: 'Zap', href: '/app/automations?action=new', priority: 3 });
    }

    quickActions.sort((a, b) => a.priority - b.priority);

    const revenueInsights = this.buildRevenueInsights(invoices, allPaidInvoices, contacts, bookings, lastMonthInvoices, monthlyRevenue, now);

    const highPotential = contacts
      .filter(c => {
        const custom = c.custom as Record<string, unknown> | null;
        return custom?.leadScore && (custom.leadScore as number) > 70;
      })
      .slice(0, 5)
      .map(c => ({
        contactId: c.id,
        name: c.displayName || `${c.firstName || ''} ${c.lastName || ''}`.trim() || c.email || 'Unknown',
        score: ((c.custom as Record<string, unknown>)?.leadScore as number) || 0,
      }));

    const overdueReminders = contacts
      .filter(c => {
        const daysSinceContact = Math.floor((now.getTime() - new Date(c.createdAt).getTime()) / (1000 * 60 * 60 * 24));
        return daysSinceContact > 30 && c.status === 'LEAD';
      })
      .slice(0, 5)
      .map(c => ({
        contactId: c.id,
        name: c.displayName || `${c.firstName || ''} ${c.lastName || ''}`.trim() || c.email || 'Unknown',
        daysSince: Math.floor((now.getTime() - new Date(c.createdAt).getTime()) / (1000 * 60 * 60 * 24)),
      }));

    const completedTasks = [
      products.length > 0,
      totalContacts > 0,
      invoices.length > 0,
      bookings.length > 0,
      socialPosts.length > 0,
      automations.length > 0,
    ];
    const momentum = completedTasks.filter(Boolean).length / completedTasks.length;

    const streaks: string[] = [];
    const recentPaidCount = invoices.filter(i => i.status === 'PAID' && i.paidAt && new Date(i.paidAt) >= sevenDaysAgo).length;
    if (recentPaidCount > 0) {
      streaks.push(`${recentPaidCount} invoice${recentPaidCount > 1 ? 's' : ''} paid this week`);
    }
    if (weeklyBookings > 0) {
      streaks.push(`${weeklyBookings} booking${weeklyBookings > 1 ? 's' : ''} this week`);
    }
    if (overdueInvoices === 0 && invoices.length > 0) {
      streaks.push('No overdue invoices');
    }

    return {
      momentum,
      streaks,
      phases,
      bottleneck,
      feed: feed.slice(0, 20),
      quickActions: quickActions.slice(0, 6),
      priorities: priorities.slice(0, 8),
      revenueInsights,
      stats: {
        totalContacts,
        activeLeads,
        pendingInvoices,
        overdueInvoices,
        upcomingBookings,
        monthlyRevenue,
        weeklyBookings,
        todayRevenue,
        todayBookings,
        completedBookingsToday,
        draftPosts,
        scheduledPosts,
      },
      highlights: {
        highPotential,
        overdueReminders,
      },
    };
  }

  private buildPriorities(invoices: any[], bookings: any[], contacts: any[], socialPosts: any[], now: Date, thirtyDaysAgo: Date, sixtyDaysAgo: Date): PriorityItem[] {
    const items: PriorityItem[] = [];

    const overdueInvs = invoices.filter(i => i.status === 'OVERDUE' || (i.status === 'SENT' && i.dueDate && new Date(i.dueDate) < now));
    overdueInvs.slice(0, 3).forEach(inv => {
      const contactName = inv.contact?.displayName || `${inv.contact?.firstName || ''} ${inv.contact?.lastName || ''}`.trim() || 'Client';
      const phone = inv.contact?.whatsappNumber || inv.contact?.phone;
      items.push({
        id: `overdue-${inv.id}`,
        type: 'overdue_invoice',
        title: `Invoice #${inv.invoiceNumber} overdue`,
        description: `${contactName} owes $${inv.total.toFixed(2)} ${inv.currency}`,
        urgency: 'critical',
        actionLabel: 'Send Reminder',
        actionHref: `/app/commerce?tab=invoices&highlight=${inv.id}`,
        amount: inv.total,
        currency: inv.currency,
        contactName,
        whatsappLink: phone ? this.buildWhatsAppLink(phone, `Hi ${contactName}, this is a friendly reminder about invoice #${inv.invoiceNumber} for $${inv.total.toFixed(2)} ${inv.currency}. Please let us know if you have any questions.`) : undefined,
      });
    });

    const unconfirmed = bookings.filter(b => b.status === 'PENDING' && new Date(b.startTime) > now);
    unconfirmed.slice(0, 3).forEach(b => {
      const contactName = b.contact?.displayName || `${b.contact?.firstName || ''} ${b.contact?.lastName || ''}`.trim() || 'Customer';
      const phone = b.contact?.whatsappNumber || b.contact?.phone;
      const hoursUntil = Math.floor((new Date(b.startTime).getTime() - now.getTime()) / (1000 * 60 * 60));
      items.push({
        id: `unconfirmed-${b.id}`,
        type: 'unconfirmed_booking',
        title: `Unconfirmed: ${b.service.name}`,
        description: `${contactName} — ${hoursUntil < 24 ? `in ${hoursUntil}h` : `${Math.floor(hoursUntil / 24)}d away`}`,
        urgency: hoursUntil < 24 ? 'critical' : 'high',
        actionLabel: 'Confirm',
        actionHref: `/app/bookings`,
        contactName,
        whatsappLink: phone ? this.buildWhatsAppLink(phone, `Hi ${contactName}, just confirming your ${b.service.name} appointment on ${this.formatDateTime(b.startTime)}. Reply YES to confirm!`) : undefined,
      });
    });

    const unpaidSent = invoices.filter(i => i.status === 'SENT' && (!i.dueDate || new Date(i.dueDate) >= now));
    unpaidSent.slice(0, 2).forEach(inv => {
      const contactName = inv.contact?.displayName || `${inv.contact?.firstName || ''} ${inv.contact?.lastName || ''}`.trim() || 'Client';
      const phone = inv.contact?.whatsappNumber || inv.contact?.phone;
      items.push({
        id: `unpaid-${inv.id}`,
        type: 'unpaid_invoice',
        title: `Awaiting payment: #${inv.invoiceNumber}`,
        description: `${contactName} — $${inv.total.toFixed(2)} ${inv.currency}`,
        urgency: 'medium',
        actionLabel: 'Follow Up',
        actionHref: `/app/commerce?tab=invoices&highlight=${inv.id}`,
        amount: inv.total,
        currency: inv.currency,
        contactName,
        whatsappLink: phone ? this.buildWhatsAppLink(phone, `Hi ${contactName}, hope you're well! Just following up on invoice #${inv.invoiceNumber}. Let me know if you need anything.`) : undefined,
      });
    });

    const staleLeads = contacts
      .filter(c => c.status === 'LEAD' && new Date(c.createdAt) < thirtyDaysAgo)
      .slice(0, 3);
    staleLeads.forEach(c => {
      const name = c.displayName || `${c.firstName || ''} ${c.lastName || ''}`.trim() || c.email || 'Lead';
      const daysSince = Math.floor((now.getTime() - new Date(c.createdAt).getTime()) / (1000 * 60 * 60 * 24));
      const phone = (c as any).whatsappNumber || c.phone;
      items.push({
        id: `stale-${c.id}`,
        type: 'stale_lead',
        title: `Stale lead: ${name}`,
        description: `No activity for ${daysSince} days`,
        urgency: daysSince > 60 ? 'high' : 'medium',
        actionLabel: 'Re-engage',
        actionHref: `/app/crm/pipeline?contact=${c.id}`,
        contactName: name,
        daysSince,
        whatsappLink: phone ? this.buildWhatsAppLink(phone, `Hi ${name}! Just checking in to see if you're still interested in our services. We'd love to help!`) : undefined,
      });
    });

    const drafts = socialPosts.filter(p => p.status === 'DRAFT');
    if (drafts.length > 0) {
      items.push({
        id: 'draft-posts',
        type: 'draft_post',
        title: `${drafts.length} draft post${drafts.length > 1 ? 's' : ''} ready`,
        description: 'Publish your content to grow your audience',
        urgency: 'low',
        actionLabel: 'Review & Publish',
        actionHref: '/app/social',
      });
    }

    items.sort((a, b) => {
      const urgencyOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      return (urgencyOrder[a.urgency] ?? 3) - (urgencyOrder[b.urgency] ?? 3);
    });

    return items;
  }

  private buildRevenueInsights(
    invoices: any[], allPaidInvoices: any[], contacts: any[], bookings: any[],
    lastMonthInvoices: any[], monthlyRevenue: number, now: Date,
  ): RevenueInsights {
    const totalPaidRevenue = allPaidInvoices.reduce((sum: number, i: any) => sum + i.total, 0);
    const uniquePaidClients = new Set(allPaidInvoices.map((i: any) => i.contactId).filter(Boolean));
    const avgClientSpend = uniquePaidClients.size > 0 ? totalPaidRevenue / uniquePaidClients.size : 0;

    const serviceRevenue: Record<string, { name: string; revenue: number; count: number }> = {};
    bookings.filter(b => b.status === 'COMPLETED').forEach(b => {
      const sName = b.service?.name || 'Unknown';
      const price = b.service?.price || 0;
      if (!serviceRevenue[sName]) serviceRevenue[sName] = { name: sName, revenue: 0, count: 0 };
      serviceRevenue[sName].revenue += price;
      serviceRevenue[sName].count += 1;
    });
    const topServiceArr = Object.values(serviceRevenue).sort((a, b) => b.revenue - a.revenue);
    const topService = topServiceArr.length > 0 ? topServiceArr[0] : null;

    const totalLeads = contacts.filter(c => c.status === 'LEAD').length;
    const totalClients = contacts.filter(c => c.status === 'CLIENT' || c.status === 'ACTIVE').length;
    const leadConversionRate = (totalLeads + totalClients) > 0 ? (totalClients / (totalLeads + totalClients)) * 100 : 0;

    const repeatClientIds = new Set<string>();
    const clientInvoiceCounts: Record<string, number> = {};
    allPaidInvoices.forEach((inv: any) => {
      if (inv.contactId) {
        clientInvoiceCounts[inv.contactId] = (clientInvoiceCounts[inv.contactId] || 0) + 1;
        if (clientInvoiceCounts[inv.contactId] > 1) repeatClientIds.add(inv.contactId);
      }
    });
    const repeatClients = repeatClientIds.size;
    const clientRetentionRate = uniquePaidClients.size > 0 ? (repeatClients / uniquePaidClients.size) * 100 : 0;

    const lastMonthRevenue = lastMonthInvoices.reduce((sum: number, i: any) => sum + i.total, 0);
    const revenueGrowth = lastMonthRevenue > 0 ? ((monthlyRevenue - lastMonthRevenue) / lastMonthRevenue) * 100 : 0;

    const avgInvoiceValue = allPaidInvoices.length > 0 ? totalPaidRevenue / allPaidInvoices.length : 0;

    const totalInvoiced = invoices.reduce((sum, i) => sum + i.total, 0);
    const collectionRate = totalInvoiced > 0 ? (totalPaidRevenue / totalInvoiced) * 100 : 0;

    const monthlyTarget = lastMonthRevenue > 0 ? lastMonthRevenue * 1.1 : monthlyRevenue > 0 ? monthlyRevenue * 1.2 : 5000;
    const monthlyProgress = monthlyTarget > 0 ? (monthlyRevenue / monthlyTarget) * 100 : 0;

    return {
      avgClientSpend,
      topService,
      leadConversionRate,
      clientRetentionRate,
      revenueGrowth,
      totalClients,
      repeatClients,
      avgInvoiceValue,
      collectionRate,
      monthlyTarget,
      monthlyProgress,
    };
  }

  private buildWhatsAppLink(phone: string, message: string): string {
    const cleaned = phone.replace(/[^0-9+]/g, '').replace(/^\+/, '');
    const num = cleaned.startsWith('1') || cleaned.length > 10 ? cleaned : `1868${cleaned}`;
    return `https://wa.me/${num}?text=${encodeURIComponent(message)}`;
  }

  private formatRelativeTime(date: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - new Date(date).getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return new Date(date).toLocaleDateString();
  }

  private formatDateTime(date: Date): string {
    return new Date(date).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  private parseRelativeTime(str: string): number {
    if (str === 'just now') return Date.now();
    const match = str.match(/(\d+)([mhd]) ago/);
    if (match) {
      const value = parseInt(match[1], 10);
      const unit = match[2];
      const multipliers: Record<string, number> = { m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 };
      return Date.now() - value * (multipliers[unit] || 0);
    }
    return 0;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  Automation / playbook persistence (used by AI/KEY tool loop)
  // ═══════════════════════════════════════════════════════════════════════════

  async createAutomation(input: {
    businessId: string;
    name: string;
    trigger: string;
    condition?: string | null;
  }) {
    return this.prisma.client.automation.create({
      data: {
        businessId: input.businessId,
        name: input.name,
        trigger: input.trigger,
        condition: input.condition ?? null,
        actionData: [],
        enabled: true,
      },
    });
  }

  async updateAutomation(
    businessId: string,
    automationId: string,
    data: { name?: string; trigger?: string; condition?: string | null; enabled?: boolean },
  ) {
    const updateData: Record<string, unknown> = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.trigger !== undefined) updateData.trigger = data.trigger;
    if (data.condition !== undefined) updateData.condition = data.condition;
    if (data.enabled !== undefined) updateData.enabled = data.enabled;

    return this.prisma.client.automation.update({
      where: { id: automationId, businessId },
      data: updateData,
    });
  }
}
