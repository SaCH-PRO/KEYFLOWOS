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

interface CockpitSummary {
  momentum: number;
  streaks: string[];
  phases: FlowPhase[];
  bottleneck: { phase: string; suggestion: string } | null;
  feed: FeedItem[];
  quickActions: QuickAction[];
  stats: {
    totalContacts: number;
    activeLeads: number;
    pendingInvoices: number;
    overdueInvoices: number;
    upcomingBookings: number;
    monthlyRevenue: number;
    weeklyBookings: number;
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
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    startOfWeek.setHours(0, 0, 0, 0);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [
      contacts,
      invoices,
      quotes,
      bookings,
      recentEvents,
      products,
      socialPosts,
      automations,
    ] = await Promise.all([
      this.prisma.client.contact.findMany({
        where: { businessId, deletedAt: null },
        select: { id: true, firstName: true, lastName: true, displayName: true, email: true, status: true, createdAt: true, custom: true },
        orderBy: { createdAt: 'desc' },
        take: 500,
      }),
      this.prisma.client.invoice.findMany({
        where: { businessId, deletedAt: null },
        include: { contact: { select: { firstName: true, lastName: true, displayName: true, email: true } } },
        orderBy: { createdAt: 'desc' },
        take: 100,
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
          contact: { select: { firstName: true, lastName: true, displayName: true } },
          service: { select: { name: true } },
          staff: { select: { name: true } },
        },
        orderBy: { startTime: 'desc' },
        take: 100,
      }),
      this.prisma.client.contactEvent.findMany({
        where: { businessId, createdAt: { gte: sevenDaysAgo } },
        include: { contact: { select: { firstName: true, lastName: true, displayName: true } } },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      this.prisma.client.product.findMany({
        where: { businessId, deletedAt: null, isActive: true },
        select: { id: true },
      }),
      this.prisma.client.socialPost.findMany({
        where: { businessId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      this.prisma.client.automation.findMany({
        where: { businessId, deletedAt: null },
        select: { id: true },
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

    const weeklyBookings = bookings.filter(b => new Date(b.createdAt) >= startOfWeek).length;

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
      const contactName = inv.contact.displayName || `${inv.contact.firstName || ''} ${inv.contact.lastName || ''}`.trim() || inv.contact.email || 'Unknown';
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
      const contactName = b.contact.displayName || `${b.contact.firstName || ''} ${b.contact.lastName || ''}`.trim() || 'Customer';
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

    const quickActions: QuickAction[] = [];

    if (products.length === 0) {
      quickActions.push({
        id: 'add-product',
        label: 'Add First Product',
        description: 'Create your first product or service to start selling',
        icon: 'Package',
        href: '/app/commerce?tab=products&action=new',
        priority: 1,
      });
    }

    if (totalContacts === 0) {
      quickActions.push({
        id: 'add-contact',
        label: 'Add First Contact',
        description: 'Import or create your first customer contact',
        icon: 'UserPlus',
        href: '/app/crm/pipeline?action=new',
        priority: 1,
      });
    }

    if (pendingInvoices > 0) {
      quickActions.push({
        id: 'follow-up-invoices',
        label: 'Follow Up Invoices',
        description: `${pendingInvoices} invoice${pendingInvoices > 1 ? 's' : ''} awaiting payment`,
        icon: 'Send',
        href: '/app/commerce?tab=invoices&status=SENT',
        priority: 2,
      });
    }

    if (overdueInvoices > 0) {
      quickActions.push({
        id: 'overdue-invoices',
        label: 'Handle Overdue',
        description: `${overdueInvoices} overdue invoice${overdueInvoices > 1 ? 's' : ''} need attention`,
        icon: 'AlertTriangle',
        href: '/app/commerce?tab=invoices&status=OVERDUE',
        priority: 1,
      });
    }

    if (activeLeads > 5) {
      quickActions.push({
        id: 'convert-leads',
        label: 'Convert Leads',
        description: `${activeLeads} leads ready for follow-up`,
        icon: 'TrendingUp',
        href: '/app/crm/pipeline?status=LEAD',
        priority: 2,
      });
    }

    if (automations.length === 0) {
      quickActions.push({
        id: 'setup-automation',
        label: 'Setup Automation',
        description: 'Create your first automated workflow',
        icon: 'Zap',
        href: '/app/automations?action=new',
        priority: 3,
      });
    }

    quickActions.sort((a, b) => a.priority - b.priority);

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
      quickActions: quickActions.slice(0, 5),
      stats: {
        totalContacts,
        activeLeads,
        pendingInvoices,
        overdueInvoices,
        upcomingBookings,
        monthlyRevenue,
        weeklyBookings,
      },
      highlights: {
        highPotential,
        overdueReminders,
      },
    };
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
}
