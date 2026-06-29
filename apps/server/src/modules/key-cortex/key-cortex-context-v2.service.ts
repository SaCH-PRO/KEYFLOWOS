/**
 * ============================================================================
 * KEY CORTEX CONTEXT v2 — The Omniscient Eye
 * ============================================================================
 * Assembles comprehensive context from ALL KeyFlowOS modules for AI consumption.
 * Every data point that matters, in one place, cached for speed.
 * ============================================================================
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { RedisService } from '../../core/redis/redis.service';
import { CrmService } from '../crm/crm.service';
import { CommerceService } from '../commerce/commerce.service';
import { BookingsService } from '../bookings/bookings.service';
import { AutopilotService } from '../autopilot/autopilot.service';
import { TemporalFlowMemoryService } from '../temporal-flow/temporal-flow-memory.service';
import { KeyInboxIntelligenceService } from '../key-inbox/key-inbox-intelligence.service';
import { subDays, subWeeks, subMonths, startOfMonth, startOfWeek, startOfDay, endOfDay, format } from 'date-fns';

/* ─────────────────────────── Types ─────────────────────────── */

export interface CrmContext {
  totalContacts: number;
  newLeadsThisWeek: number;
  hotLeads: Array<{
    id: string;
    name: string;
    email: string;
    score: number;
    lastActivity: Date;
    stage: string;
  }>;
  overdueTasks: Array<{
    id: string;
    title: string;
    contactName: string;
    dueDate: Date;
    priority: string;
  }>;
  recentActivity: Array<{
    type: string;
    description: string;
    timestamp: Date;
    contactName: string;
  }>;
  leadStages: Record<string, number>;
  conversionRateThisMonth: number;
}

export interface CommerceContext {
  revenueThisMonth: number;
  revenueThisWeek: number;
  revenueToday: number;
  outstandingInvoices: {
    count: number;
    total: number;
    overdue: number;
    overdueTotal: number;
    invoices: Array<{
      id: string;
      contactName: string;
      amount: number;
      dueDate: Date;
      status: string;
      daysOverdue: number;
    }>;
  };
  recentPayments: Array<{
    id: string;
    contactName: string;
    amount: number;
    date: Date;
    method: string;
  }>;
  topProducts: Array<{
    id: string;
    name: string;
    totalSold: number;
    revenue: number;
  }>;
  collectionRate: number;
  averageInvoiceValue: number;
  totalInvoicesThisMonth: number;
}

export interface BookingsContext {
  upcomingAppointments: Array<{
    id: string;
    contactName: string;
    service: string;
    date: Date;
    duration: number;
    status: string;
  }>;
  todayBookings: {
    count: number;
    completed: number;
    remaining: number;
    totalValue: number;
  };
  completionRate: number;
  noShows: {
    thisWeek: number;
    thisMonth: number;
    rate: number;
  };
  availabilityToday: number;
  busiestDayThisWeek: string;
}

export interface CommunicationsContext {
  messagesSentThisWeek: number;
  messagesReceivedThisWeek: number;
  activeCampaigns: Array<{
    id: string;
    name: string;
    status: string;
    sent: number;
    opened: number;
    clicked: number;
    openRate: number;
    clickRate: number;
  }>;
  responseRates: {
    overall: number;
    byChannel: Record<string, number>;
  };
  recentConversations: number;
}

export interface AutopilotContext {
  activeTasks: Array<{
    id: string;
    title: string;
    status: string;
    assignee: string;
    priority: string;
    dueDate: Date;
  }>;
  delegationLoopStatus: {
    active: boolean;
    tasksDelegatedToday: number;
    tasksCompletedToday: number;
    efficiency: number;
  };
  automationRate: number;
  pendingApprovals: number;
  workflowsRunning: number;
}

export interface TemporalContext {
  recentMemories: Array<{
    id: string;
    content: string;
    type: string;
    importance: number;
    createdAt: Date;
  }>;
  patternsDetected: Array<{
    pattern: string;
    frequency: number;
    confidence: number;
    firstSeen: Date;
    lastSeen: Date;
  }>;
  contextWindow: number;
}

export interface InboxContext {
  unreadThreads: number;
  unreadMessages: number;
  urgentMessages: Array<{
    id: string;
    subject: string;
    sender: string;
    preview: string;
    receivedAt: Date;
    priority: string;
  }>;
  aiSummary: string;
  threadsRequiringAction: number;
  avgResponseTime: number;
}

export interface GenomeContext {
  dnaScores: Record<string, number>;
  currentStage: string;
  stageProgress: number;
  readinessScore: number;
  growthTrajectory: string;
  recommendations: string[];
  lastAssessment: Date;
}

export interface FullBusinessContext {
  businessId: string;
  timestamp: Date;
  crm: CrmContext;
  commerce: CommerceContext;
  bookings: BookingsContext;
  communications: CommunicationsContext;
  autopilot: AutopilotContext;
  temporal: TemporalContext;
  inbox: InboxContext;
  genome: GenomeContext;
  summary: {
    totalRevenueOutstanding: number;
    totalActiveTasks: number;
    totalUnreadMessages: number;
    healthScore: number;
    alerts: string[];
  };
}

export interface ContextDiff {
  businessId: string;
  since: Date;
  changes: Array<{
    module: string;
    type: 'added' | 'updated' | 'removed';
    description: string;
    severity: 'info' | 'warning' | 'critical';
    timestamp: Date;
  }>;
  summary: string;
  newLeads: number;
  newPayments: number;
  newTasks: number;
  newMessages: number;
  alertsTriggered: number;
}

/* ─────────────────────────── Service ─────────────────────────── */

@Injectable()
export class KeyCortexContextV2Service {
  private readonly logger = new Logger(KeyCortexContextV2Service.name);
  private readonly CACHE_TTL = 120; // 2 minutes

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly crm: CrmService,
    private readonly commerce: CommerceService,
    private readonly bookings: BookingsService,
    private readonly autopilot: AutopilotService,
    private readonly temporal: TemporalFlowMemoryService,
    private readonly inbox: KeyInboxIntelligenceService,
  ) {}

  /* ─────── Full Context Assembly ─────── */

  async getFullContext(businessId: string): Promise<FullBusinessContext> {
    const cacheKey = `key_cortex:context:${businessId}`;
    try {
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        this.logger.debug(`[getFullContext] Cache hit for ${businessId}`);
        return JSON.parse(cached) as FullBusinessContext;
      }
    } catch {
      // ignore cache errors, proceed to fetch fresh data
    }

    this.logger.log(`[getFullContext] Assembling full context for ${businessId}`);
    const start = Date.now();

    const results = await Promise.allSettled([
      this.getCrmContext(businessId),
      this.getCommerceContext(businessId),
      this.getBookingsContext(businessId),
      this.getCommunicationsContext(businessId),
      this.getAutopilotContext(businessId),
      this.getTemporalContext(businessId),
      this.getInboxContext(businessId),
      this.getGenomeContext(businessId),
    ]);

    const contexts = results.map((r: any) => r.status === 'fulfilled' ? r.value : null);
    const [
      crmCtx,
      commerceCtx,
      bookingsCtx,
      communicationsCtx,
      autopilotCtx,
      temporalCtx,
      inboxCtx,
      genomeCtx,
    ] = contexts;

    const crm = (crmCtx ?? this.emptyCrmContext()) as CrmContext;
    const commerce = (commerceCtx ?? this.emptyCommerceContext()) as CommerceContext;
    const bookings = (bookingsCtx ?? this.emptyBookingsContext()) as BookingsContext;
    const communications = (communicationsCtx ?? this.emptyCommunicationsContext()) as CommunicationsContext;
    const autopilot = (autopilotCtx ?? this.emptyAutopilotContext()) as AutopilotContext;
    const temporal = (temporalCtx ?? this.emptyTemporalContext()) as TemporalContext;
    const inbox = (inboxCtx ?? this.emptyInboxContext()) as InboxContext;
    const genome = (genomeCtx ?? this.emptyGenomeContext()) as GenomeContext;

    const context: FullBusinessContext = {
      businessId,
      timestamp: new Date(),
      crm,
      commerce,
      bookings,
      communications,
      autopilot,
      temporal,
      inbox,
      genome,
      summary: {
        totalRevenueOutstanding: commerce.outstandingInvoices.total,
        totalActiveTasks: autopilot.activeTasks.length + autopilot.pendingApprovals,
        totalUnreadMessages: inbox.unreadMessages,
        healthScore: this.calculateHealthScore({ crm, commerce, bookings, inbox, genome }),
        alerts: this.generateAlerts({ crm, commerce, bookings, inbox, genome }),
      },
    };

    const elapsed = Date.now() - start;
    this.logger.log(`[getFullContext] Assembled in ${elapsed}ms for ${businessId}`);

    try {
      await this.redis.set(cacheKey, JSON.stringify(context), this.CACHE_TTL);
      await this.redis.set(`key_cortex:context:last:${businessId}`, JSON.stringify(context), 86400);
    } catch {
      // ignore cache write errors
    }

    return context;
  }

  /* ─────── CRM Context ─────── */

  async getCrmContext(businessId: string): Promise<CrmContext> {
    try {
      const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
      const monthStart = startOfMonth(new Date());

      const [totalContacts, newLeads, hotLeadsRaw, overdueTasksRaw, recentActivityRaw, leadStages] =
        await Promise.all([
          (this.prisma.client as any).contact.count({ where: { businessId } }),
          (this.prisma.client as any).contact.count({
            where: { businessId, createdAt: { gte: weekStart } },
          }),
          (this.prisma.client as any).contact.findMany({
            where: {
              businessId,
              status: 'lead',
              score: { gte: 70 },
            },
            orderBy: { score: 'desc' },
            take: 10,
            select: {
              id: true,
              name: true,
              email: true,
              score: true,
              lastActivityAt: true,
              stage: true,
            },
          }),
          (this.prisma.client as any).crmTask.findMany({
            where: {
              businessId,
              dueDate: { lt: new Date() },
              status: { notIn: ['completed', 'cancelled'] },
            },
            orderBy: { dueDate: 'asc' },
            take: 10,
            include: {
              contact: { select: { name: true } },
            },
          }),
          (this.prisma.client as any).crmActivity.findMany({
            where: { businessId },
            orderBy: { createdAt: 'desc' },
            take: 10,
            include: {
              contact: { select: { name: true } },
            },
          }),
          (this.prisma.client as any).contact.groupBy({
            by: ['stage'],
            where: { businessId, status: 'lead' },
            _count: { stage: true },
          }),
        ]);

      // Calculate conversion rate
      const convertedThisMonth = await (this.prisma.client as any).contact.count({
        where: {
          businessId,
          status: 'customer',
          createdAt: { gte: monthStart },
        },
      });
      const leadsCreatedThisMonth = await (this.prisma.client as any).contact.count({
        where: {
          businessId,
          status: 'lead',
          createdAt: { gte: monthStart },
        },
      });
      const conversionRate = leadsCreatedThisMonth > 0
        ? Math.round((convertedThisMonth / leadsCreatedThisMonth) * 100)
        : 0;

      return {
        totalContacts,
        newLeadsThisWeek: newLeads,
        hotLeads: hotLeadsRaw.map((l: any) => ({
          id: l.id,
          name: l.name || 'Unknown',
          email: l.email || '',
          score: l.score || 0,
          lastActivity: l.lastActivityAt || new Date(),
          stage: l.stage || 'new',
        })),
        overdueTasks: overdueTasksRaw.map((t: any) => ({
          id: t.id,
          title: t.title,
          contactName: t.contact?.name || 'Unknown',
          dueDate: t.dueDate,
          priority: t.priority || 'medium',
        })),
        recentActivity: recentActivityRaw.map((a: any) => ({
          type: a.type,
          description: a.description || '',
          timestamp: a.createdAt,
          contactName: a.contact?.name || 'Unknown',
        })),
        leadStages: leadStages.reduce((acc: any, s: any) => {
          acc[s.stage || 'unknown'] = s._count.stage;
          return acc;
        }, {} as Record<string, number>),
        conversionRateThisMonth: conversionRate,
      };
    } catch (error: any) {
      this.logger.error(`[getCrmContext] Error for ${businessId}: ${error.message}`);
      return this.emptyCrmContext();
    }
  }

  /* ─────── Commerce Context ─────── */

  async getCommerceContext(businessId: string): Promise<CommerceContext> {
    try {
      const monthStart = startOfMonth(new Date());
      const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
      const today = startOfDay(new Date());

      const [
        invoicesThisMonth,
        invoicesThisWeek,
        invoicesToday,
        outstandingInvoices,
        recentPayments,
        topProducts,
        totalPaid,
        totalBilled,
      ] = await Promise.all([
        (this.prisma.client as any).invoice.findMany({
          where: {
            businessId,
            createdAt: { gte: monthStart },
          },
          select: { total: true },
        }),
        (this.prisma.client as any).invoice.findMany({
          where: {
            businessId,
            createdAt: { gte: weekStart },
          },
          select: { total: true },
        }),
        (this.prisma.client as any).invoice.findMany({
          where: {
            businessId,
            createdAt: { gte: today },
          },
          select: { total: true },
        }),
        (this.prisma.client as any).invoice.findMany({
          where: {
            businessId,
            status: { in: ['sent', 'pending', 'partial'] },
          },
          include: {
            contact: { select: { name: true } },
          },
          orderBy: { dueDate: 'asc' },
        }),
        (this.prisma.client as any).payment.findMany({
          where: {
            businessId,
            createdAt: { gte: subDays(new Date(), 7) },
          },
          include: {
            contact: { select: { name: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 10,
        }),
        (this.prisma.client as any).invoiceItem.groupBy({
          by: ['productId'],
          where: {
            invoice: { businessId, createdAt: { gte: monthStart } },
          },
          _sum: { quantity: true, total: true },
          orderBy: { _sum: { total: 'desc' } },
          take: 5,
        }),
        (this.prisma.client as any).payment.aggregate({
          where: { businessId, status: 'completed' },
          _sum: { amount: true },
        }),
        (this.prisma.client as any).invoice.aggregate({
          where: { businessId },
          _sum: { total: true },
        }),
      ]);

      const revenueThisMonth = invoicesThisMonth.reduce((s: any, i: any) => s + (i.total || 0), 0);
      const revenueThisWeek = invoicesThisWeek.reduce((s: any, i: any) => s + (i.total || 0), 0);
      const revenueToday = invoicesToday.reduce((s: any, i: any) => s + (i.total || 0), 0);

      const overdueInvoices = outstandingInvoices.filter(
        (i: any) => i.dueDate && i.dueDate < new Date(),
      );
      const totalOutstanding = outstandingInvoices.reduce((s: any, i: any) => s + (i.total || 0), 0);
      const overdueTotal = overdueInvoices.reduce((s: any, i: any) => s + (i.total || 0), 0);

      const collectionRate = (totalBilled._sum.total || 0) > 0
        ? Math.round(((totalPaid._sum.amount || 0) / (totalBilled._sum.total || 1)) * 100)
        : 0;

      const avgInvoiceValue = invoicesThisMonth.length > 0
        ? Math.round(revenueThisMonth / invoicesThisMonth.length)
        : 0;

      // Resolve top product names
      const productIds = topProducts.map((p: any) => p.productId).filter(Boolean);
      const products = productIds.length
        ? await (this.prisma.client as any).product.findMany({
            where: { id: { in: productIds } },
            select: { id: true, name: true },
          })
        : [];
      const productMap = new Map(products.map((p: any) => [p.id, p.name]));

      return {
        revenueThisMonth,
        revenueThisWeek,
        revenueToday,
        outstandingInvoices: {
          count: outstandingInvoices.length,
          total: totalOutstanding,
          overdue: overdueInvoices.length,
          overdueTotal,
          invoices: overdueInvoices.slice(0, 10).map((i: any) => ({
            id: i.id,
            contactName: i.contact?.name || 'Unknown',
            amount: i.total || 0,
            dueDate: i.dueDate || new Date(),
            status: i.status,
            daysOverdue: Math.max(0, Math.floor((Date.now() - new Date(i.dueDate).getTime()) / 86400000)),
          })),
        },
        recentPayments: recentPayments.map((p: any) => ({
          id: p.id,
          contactName: p.contact?.name || 'Unknown',
          amount: p.amount || 0,
          date: p.createdAt,
          method: p.method || 'unknown',
        })),
        topProducts: topProducts.map((p: any) => ({
          id: p.productId || 'unknown',
          name: productMap.get(p.productId || '') || 'Unknown Product',
          totalSold: p._sum.quantity || 0,
          revenue: p._sum.total || 0,
        })),
        collectionRate,
        averageInvoiceValue: avgInvoiceValue,
        totalInvoicesThisMonth: invoicesThisMonth.length,
      };
    } catch (error: any) {
      this.logger.error(`[getCommerceContext] Error for ${businessId}: ${error.message}`);
      return this.emptyCommerceContext();
    }
  }

  /* ─────── Bookings Context ─────── */

  async getBookingsContext(businessId: string): Promise<BookingsContext> {
    try {
      const now = new Date();
      const todayStart = startOfDay(now);
      const todayEnd = endOfDay(now);
      const weekStart = startOfWeek(now, { weekStartsOn: 1 });

      const [upcomingAppointments, todayAppts, weekAppts, completedWeek, noShowsWeek, noShowsMonth] =
        await Promise.all([
          (this.prisma.client as any).booking.findMany({
            where: {
              businessId,
              startTime: { gte: now },
              status: { notIn: ['cancelled', 'no_show'] },
            },
            orderBy: { startTime: 'asc' },
            take: 10,
            include: {
              contact: { select: { name: true } },
              service: { select: { name: true, duration: true, price: true } },
            },
          }),
          (this.prisma.client as any).booking.findMany({
            where: {
              businessId,
              startTime: { gte: todayStart, lte: todayEnd },
            },
            include: {
              contact: { select: { name: true } },
              service: { select: { name: true, duration: true, price: true } },
            },
          }),
          (this.prisma.client as any).booking.findMany({
            where: {
              businessId,
              startTime: { gte: weekStart },
            },
            include: {
              service: { select: { price: true } },
            },
          }),
          (this.prisma.client as any).booking.count({
            where: {
              businessId,
              startTime: { gte: weekStart },
              status: 'completed',
            },
          }),
          (this.prisma.client as any).booking.count({
            where: {
              businessId,
              startTime: { gte: weekStart },
              status: 'no_show',
            },
          }),
          (this.prisma.client as any).booking.count({
            where: {
              businessId,
              startTime: { gte: startOfMonth(now) },
              status: 'no_show',
            },
          }),
        ]);

      const todayCompleted = todayAppts.filter((a: any) => a.status === 'completed').length;
      const todayRemaining = todayAppts.filter(
        (a: any) => a.status === 'confirmed' || a.status === 'pending',
      ).length;
      const todayValue = todayAppts.reduce((s: any, a: any) => s + (a.service?.price || 0), 0);

      const totalWeek = weekAppts.length;
      const completionRate = totalWeek > 0 ? Math.round((completedWeek / totalWeek) * 100) : 0;

      // Busiest day this week
      const dayCounts: Record<string, number> = {};
      weekAppts.forEach((a: any) => {
        const day = format(new Date(a.startTime), 'EEEE');
        dayCounts[day] = (dayCounts[day] || 0) + 1;
      });
      const busiestDay = Object.entries(dayCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'N/A';

      return {
        upcomingAppointments: upcomingAppointments.map((a: any) => ({
          id: a.id,
          contactName: a.contact?.name || 'Unknown',
          service: a.service?.name || 'Unknown',
          date: a.startTime,
          duration: a.service?.duration || 0,
          status: a.status,
        })),
        todayBookings: {
          count: todayAppts.length,
          completed: todayCompleted,
          remaining: todayRemaining,
          totalValue: todayValue,
        },
        completionRate,
        noShows: {
          thisWeek: noShowsWeek,
          thisMonth: noShowsMonth,
          rate: totalWeek > 0 ? Math.round((noShowsWeek / totalWeek) * 100) : 0,
        },
        availabilityToday: Math.max(0, 8 - todayRemaining),
        busiestDayThisWeek: busiestDay,
      };
    } catch (error: any) {
      this.logger.error(`[getBookingsContext] Error for ${businessId}: ${error.message}`);
      return this.emptyBookingsContext();
    }
  }

  /* ─────── Communications Context ─────── */

  async getCommunicationsContext(businessId: string): Promise<CommunicationsContext> {
    try {
      const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });

      const [sent, received, campaigns, conversations] = await Promise.all([
        (this.prisma.client as any).message.count({
          where: { businessId, direction: 'outbound', createdAt: { gte: weekStart } },
        }),
        (this.prisma.client as any).message.count({
          where: { businessId, direction: 'inbound', createdAt: { gte: weekStart } },
        }),
        (this.prisma.client as any).campaign.findMany({
          where: {
            businessId,
            status: { in: ['running', 'scheduled'] },
          },
          take: 5,
          select: {
            id: true,
            name: true,
            status: true,
            sentCount: true,
            openCount: true,
            clickCount: true,
          },
        }),
        (this.prisma.client as any).conversation.count({
          where: {
            businessId,
            updatedAt: { gte: subDays(new Date(), 1) },
          },
        }),
      ]);

      const campaignStats = campaigns.map((c: any) => {
        const openRate = (c.sentCount || 0) > 0 ? Math.round(((c.openCount || 0) / c.sentCount) * 100) : 0;
        const clickRate = (c.sentCount || 0) > 0 ? Math.round(((c.clickCount || 0) / c.sentCount) * 100) : 0;
        return {
          id: c.id,
          name: c.name,
          status: c.status,
          sent: c.sentCount || 0,
          opened: c.openCount || 0,
          clicked: c.clickCount || 0,
          openRate,
          clickRate,
        };
      });

      const totalSent = sent || 1;
      const responded = await (this.prisma.client as any).message.count({
        where: {
          businessId,
          direction: 'inbound',
          createdAt: { gte: weekStart },
        },
      });

      return {
        messagesSentThisWeek: sent,
        messagesReceivedThisWeek: received,
        activeCampaigns: campaignStats,
        responseRates: {
          overall: Math.round((responded / totalSent) * 100),
          byChannel: { sms: 0, email: 0, whatsapp: 0 },
        },
        recentConversations: conversations,
      };
    } catch (error: any) {
      this.logger.error(`[getCommunicationsContext] Error for ${businessId}: ${error.message}`);
      return this.emptyCommunicationsContext();
    }
  }

  /* ─────── Autopilot Context ─────── */

  async getAutopilotContext(businessId: string): Promise<AutopilotContext> {
    try {
      const todayStart = startOfDay(new Date());

      const [activeTasks, delegatedToday, completedToday, pendingApprovals, workflows] =
        await Promise.all([
          (this.prisma.client as any).autopilotTask.findMany({
            where: {
              businessId,
              status: { in: ['pending', 'in_progress'] },
            },
            orderBy: { priority: 'asc' },
            take: 10,
            select: {
              id: true,
              title: true,
              status: true,
              assignee: true,
              priority: true,
              dueDate: true,
            },
          }),
          (this.prisma.client as any).autopilotTask.count({
            where: {
              businessId,
              source: 'delegation_loop',
              createdAt: { gte: todayStart },
            },
          }),
          (this.prisma.client as any).autopilotTask.count({
            where: {
              businessId,
              status: 'completed',
              completedAt: { gte: todayStart },
            },
          }),
          (this.prisma.client as any).autopilotTask.count({
            where: {
              businessId,
              status: 'awaiting_approval',
            },
          }),
          (this.prisma.client as any).workflow.findMany({
            where: {
              businessId,
              status: 'active',
            },
            select: { id: true },
          }),
        ]);

      const totalTasks = activeTasks.length + completedToday || 1;
      const efficiency = Math.round((completedToday / totalTasks) * 100);

      // Automation rate = tasks created by automation vs manually
      const automatedTasks = await (this.prisma.client as any).autopilotTask.count({
        where: {
          businessId,
          source: { in: ['workflow', 'automation', 'delegation_loop'] },
          createdAt: { gte: subDays(new Date(), 30) },
        },
      });
      const totalTasksMonth = await (this.prisma.client as any).autopilotTask.count({
        where: {
          businessId,
          createdAt: { gte: subDays(new Date(), 30) },
        },
      });

      return {
        activeTasks: activeTasks.map((t: any) => ({
          id: t.id,
          title: t.title,
          status: t.status,
          assignee: t.assignee || 'Unassigned',
          priority: t.priority || 'medium',
          dueDate: t.dueDate || new Date(),
        })),
        delegationLoopStatus: {
          active: delegatedToday > 0 || completedToday > 0,
          tasksDelegatedToday: delegatedToday,
          tasksCompletedToday: completedToday,
          efficiency,
        },
        automationRate: totalTasksMonth > 0 ? Math.round((automatedTasks / totalTasksMonth) * 100) : 0,
        pendingApprovals,
        workflowsRunning: workflows.length,
      };
    } catch (error: any) {
      this.logger.error(`[getAutopilotContext] Error for ${businessId}: ${error.message}`);
      return this.emptyAutopilotContext();
    }
  }

  /* ─────── Temporal/Memory Context ─────── */

  async getTemporalContext(businessId: string): Promise<TemporalContext> {
    try {
      const [memories, patterns] = await Promise.all([
        (this.temporal as any).getRecentMemories(businessId, 20),
        (this.temporal as any).getDetectedPatterns(businessId, 10),
      ]);

      return {
        recentMemories: (memories || []).map((m: Record<string, unknown>) => ({
          id: (m.id as string) || '',
          content: (m.content as string) || '',
          type: (m.type as string) || 'memory',
          importance: (m.importance as number) || 0,
          createdAt: new Date((m.createdAt as string) || Date.now()),
        })),
        patternsDetected: (patterns || []).map((p: Record<string, unknown>) => ({
          pattern: (p.pattern as string) || '',
          frequency: (p.frequency as number) || 0,
          confidence: (p.confidence as number) || 0,
          firstSeen: new Date((p.firstSeen as string) || Date.now()),
          lastSeen: new Date((p.lastSeen as string) || Date.now()),
        })),
        contextWindow: 20,
      };
    } catch (error: any) {
      this.logger.error(`[getTemporalContext] Error for ${businessId}: ${error.message}`);
      return { recentMemories: [], patternsDetected: [], contextWindow: 0 };
    }
  }

  /* ─────── Inbox Context ─────── */

  async getInboxContext(businessId: string): Promise<InboxContext> {
    try {
      const [unreadThreads, unreadMsgs, urgentMsgs, threadsNeedingAction, avgResponse] =
        await Promise.all([
          (this.inbox as any).getUnreadThreadCount(businessId),
          (this.inbox as any).getUnreadMessageCount(businessId),
          (this.inbox as any).getUrgentMessages(businessId, 5),
          (this.inbox as any).getThreadsRequiringAction(businessId),
          (this.inbox as any).getAverageResponseTime(businessId),
        ]);

      const aiSummary = await (this.inbox as any).getAiSummary(businessId);

      return {
        unreadThreads: unreadThreads || 0,
        unreadMessages: unreadMsgs || 0,
        urgentMessages: (urgentMsgs || []).map((m: Record<string, unknown>) => ({
          id: (m.id as string) || '',
          subject: (m.subject as string) || 'No subject',
          sender: (m.sender as string) || 'Unknown',
          preview: (m.preview as string) || '',
          receivedAt: new Date((m.receivedAt as string) || Date.now()),
          priority: (m.priority as string) || 'medium',
        })),
        aiSummary: aiSummary || 'No summary available',
        threadsRequiringAction: threadsNeedingAction || 0,
        avgResponseTime: avgResponse || 0,
      };
    } catch (error: any) {
      this.logger.error(`[getInboxContext] Error for ${businessId}: ${error.message}`);
      return {
        unreadThreads: 0,
        unreadMessages: 0,
        urgentMessages: [],
        aiSummary: 'Inbox unavailable',
        threadsRequiringAction: 0,
        avgResponseTime: 0,
      };
    }
  }

  /* ─────── Genome Context ─────── */

  async getGenomeContext(businessId: string): Promise<GenomeContext> {
    try {
      const genome = await (this.prisma.client as any).businessGenome.findUnique({
        where: { businessId },
      });

      if (!genome) {
        return {
          dnaScores: {},
          currentStage: 'unknown',
          stageProgress: 0,
          readinessScore: 0,
          growthTrajectory: 'unknown',
          recommendations: ['Complete business genome assessment'],
          lastAssessment: new Date(),
        };
      }

      return {
        dnaScores: (genome.dnaScores as Record<string, number>) || {},
        currentStage: genome.currentStage || 'seed',
        stageProgress: genome.stageProgress || 0,
        readinessScore: genome.readinessScore || 0,
        growthTrajectory: genome.growthTrajectory || 'stable',
        recommendations: (genome.recommendations as string[]) || [],
        lastAssessment: genome.updatedAt || new Date(),
      };
    } catch (error: any) {
      this.logger.error(`[getGenomeContext] Error for ${businessId}: ${error.message}`);
      return {
        dnaScores: {},
        currentStage: 'unknown',
        stageProgress: 0,
        readinessScore: 0,
        growthTrajectory: 'unknown',
        recommendations: [],
        lastAssessment: new Date(),
      };
    }
  }

  /* ─────── Format Context for AI Prompt ─────── */

  formatContextForPrompt(context: FullBusinessContext): string {
    const sections: string[] = [];

    sections.push(`=== KEYFLOWOS BUSINESS CONTEXT ===`);
    sections.push(`Business: ${context.businessId} | Assembled: ${context.timestamp.toISOString()}`);
    sections.push(`Health Score: ${context.summary.healthScore}/100 | Alerts: ${context.summary.alerts.length}`);
    sections.push('');

    // ── CRM ──
    sections.push(`--- CRM ---`);
    sections.push(`Contacts: ${context.crm.totalContacts} | New leads this week: ${context.crm.newLeadsThisWeek}`);
    sections.push(`Conversion rate: ${context.crm.conversionRateThisMonth}%`);
    if (context.crm.hotLeads.length) {
      sections.push(`Hot leads (${context.crm.hotLeads.length}):`);
      context.crm.hotLeads.slice(0, 5).forEach((l) => {
        sections.push(`  - ${l.name} (score: ${l.score}, stage: ${l.stage})`);
      });
    }
    if (context.crm.overdueTasks.length) {
      sections.push(`Overdue tasks (${context.crm.overdueTasks.length}):`);
      context.crm.overdueTasks.slice(0, 3).forEach((t) => {
        sections.push(`  - ${t.title} (${t.contactName}, ${t.priority})`);
      });
    }
    sections.push('');

    // ── Commerce ──
    sections.push(`--- COMMERCE ---`);
    sections.push(`Revenue: $${context.commerce.revenueThisMonth.toLocaleString()} this month | $${context.commerce.revenueThisWeek.toLocaleString()} this week`);
    sections.push(`Outstanding: $${context.commerce.outstandingInvoices.total.toLocaleString()} (${context.commerce.outstandingInvoices.count} invoices)`);
    sections.push(`Overdue: $${context.commerce.outstandingInvoices.overdueTotal.toLocaleString()} (${context.commerce.outstandingInvoices.overdue} invoices) | Collection rate: ${context.commerce.collectionRate}%`);
    sections.push(`Avg invoice: $${context.commerce.averageInvoiceValue.toLocaleString()} | Invoices this month: ${context.commerce.totalInvoicesThisMonth}`);
    if (context.commerce.topProducts.length) {
      sections.push(`Top products:`);
      context.commerce.topProducts.slice(0, 3).forEach((p) => {
        sections.push(`  - ${p.name}: $${p.revenue.toLocaleString()} (${p.totalSold} sold)`);
      });
    }
    sections.push('');

    // ── Bookings ──
    sections.push(`--- BOOKINGS ---`);
    sections.push(`Today: ${context.bookings.todayBookings.count} appts (${context.bookings.todayBookings.completed} done, ${context.bookings.todayBookings.remaining} remaining)`);
    sections.push(`Completion rate: ${context.bookings.completionRate}% | No-shows: ${context.bookings.noShows.thisWeek} this week`);
    sections.push(`Busiest day: ${context.bookings.busiestDayThisWeek}`);
    if (context.bookings.upcomingAppointments.length) {
      sections.push(`Upcoming:`);
      context.bookings.upcomingAppointments.slice(0, 3).forEach((a) => {
        sections.push(`  - ${a.contactName}: ${a.service} at ${format(new Date(a.date), 'MMM d h:mm a')}`);
      });
    }
    sections.push('');

    // ── Communications ──
    sections.push(`--- COMMUNICATIONS ---`);
    sections.push(`Messages: ${context.communications.messagesSentThisWeek} sent / ${context.communications.messagesReceivedThisWeek} received this week`);
    sections.push(`Response rate: ${context.communications.responseRates.overall}%`);
    if (context.communications.activeCampaigns.length) {
      sections.push(`Active campaigns:`);
      context.communications.activeCampaigns.forEach((c) => {
        sections.push(`  - ${c.name}: ${c.openRate}% open, ${c.clickRate}% click`);
      });
    }
    sections.push('');

    // ── Autopilot ──
    sections.push(`--- AUTOPILOT ---`);
    sections.push(`Active tasks: ${context.autopilot.activeTasks.length} | Pending approvals: ${context.autopilot.pendingApprovals}`);
    sections.push(`Workflows running: ${context.autopilot.workflowsRunning} | Automation rate: ${context.autopilot.automationRate}%`);
    sections.push(`Delegation loop: ${context.autopilot.delegationLoopStatus.efficiency}% efficiency (${context.autopilot.delegationLoopStatus.tasksCompletedToday}/${context.autopilot.delegationLoopStatus.tasksDelegatedToday} today)`);
    sections.push('');

    // ── Inbox ──
    sections.push(`--- INBOX ---`);
    sections.push(`Unread: ${context.inbox.unreadMessages} messages in ${context.inbox.unreadThreads} threads`);
    sections.push(`Action required: ${context.inbox.threadsRequiringAction} | Avg response: ${context.inbox.avgResponseTime}h`);
    if (context.inbox.urgentMessages.length) {
      sections.push(`Urgent:`);
      context.inbox.urgentMessages.slice(0, 3).forEach((m) => {
        sections.push(`  - ${m.sender}: ${m.preview.substring(0, 60)}...`);
      });
    }
    sections.push('');

    // ── Genome ──
    sections.push(`--- GENOME ---`);
    sections.push(`Stage: ${context.genome.currentStage} (${context.genome.stageProgress}% progress) | Readiness: ${context.genome.readinessScore}/100`);
    sections.push(`Trajectory: ${context.genome.growthTrajectory}`);
    if (context.genome.recommendations.length) {
      sections.push(`Recommendations:`);
      context.genome.recommendations.slice(0, 3).forEach((r) => {
        sections.push(`  - ${r}`);
      });
    }
    sections.push('');

    // ── Alerts ──
    if (context.summary.alerts.length) {
      sections.push(`=== ALERTS (${context.summary.alerts.length}) ===`);
      context.summary.alerts.forEach((a) => sections.push(`! ${a}`));
    }

    sections.push('=== END CONTEXT ===');

    const prompt = sections.join('\n');

    // Rough token estimation (1 token ~ 4 chars for English)
    if (prompt.length > 16000) {
      return prompt.substring(0, 16000) + '\n[Context truncated for token limit]';
    }
    return prompt;
  }

  /* ─────── Context Diff ─────── */

  async getContextDiff(businessId: string, since: Date): Promise<ContextDiff> {
    const cacheKey = `key_cortex:diff:${businessId}:${since.getTime()}`;
    try {
      const cached = await this.redis.get(cacheKey);
      if (cached) return JSON.parse(cached) as ContextDiff;
    } catch {
      // ignore
    }

    const changes: ContextDiff['changes'] = [];
    let newLeads = 0;
    let newPayments = 0;
    let newTasks = 0;
    let newMessages = 0;

    // Use += so the initial 0 is read before any reassignment (avoids no-useless-assignment lint rule)

    try {
      // New leads since
      newLeads += await (this.prisma.client as any).contact.count({
        where: { businessId, createdAt: { gte: since }, status: 'lead' },
      });
      if (newLeads > 0) {
        changes.push({
          module: 'crm',
          type: 'added',
          description: `${newLeads} new lead${newLeads > 1 ? 's' : ''} created`,
          severity: newLeads >= 5 ? 'warning' : 'info',
          timestamp: new Date(),
        });
      }

      // New payments since
      const payments = await (this.prisma.client as any).payment.findMany({
        where: { businessId, createdAt: { gte: since }, status: 'completed' },
        select: { amount: true },
      });
      newPayments += payments.length;
      const paymentTotal = payments.reduce((s: any, p: any) => s + (p.amount || 0), 0);
      if (newPayments > 0) {
        changes.push({
          module: 'commerce',
          type: 'added',
          description: `$${paymentTotal.toLocaleString()} received in ${newPayments} payment${newPayments > 1 ? 's' : ''}`,
          severity: 'info',
          timestamp: new Date(),
        });
      }

      // New tasks since
      newTasks += await (this.prisma.client as any).autopilotTask.count({
        where: { businessId, createdAt: { gte: since } },
      });
      if (newTasks > 0) {
        changes.push({
          module: 'autopilot',
          type: 'added',
          description: `${newTasks} new task${newTasks > 1 ? 's' : ''} created`,
          severity: 'info',
          timestamp: new Date(),
        });
      }

      // New messages since
      newMessages += await (this.prisma.client as any).message.count({
        where: { businessId, createdAt: { gte: since } },
      });
      if (newMessages > 0) {
        changes.push({
          module: 'inbox',
          type: 'added',
          description: `${newMessages} new message${newMessages > 1 ? 's' : ''}`,
          severity: 'info',
          timestamp: new Date(),
        });
      }

      // Overdue invoices check
      const newlyOverdue = await (this.prisma.client as any).invoice.count({
        where: {
          businessId,
          dueDate: { gte: since, lt: new Date() },
          status: { in: ['sent', 'pending'] },
        },
      });
      if (newlyOverdue > 0) {
        changes.push({
          module: 'commerce',
          type: 'updated',
          description: `${newlyOverdue} invoice${newlyOverdue > 1 ? 's' : ''} became overdue`,
          severity: 'critical',
          timestamp: new Date(),
        });
      }

      // New bookings since
      const newBookings = await (this.prisma.client as any).booking.count({
        where: { businessId, createdAt: { gte: since } },
      });
      if (newBookings > 0) {
        changes.push({
          module: 'bookings',
          type: 'added',
          description: `${newBookings} new booking${newBookings > 1 ? 's' : ''}`,
          severity: 'info',
          timestamp: new Date(),
        });
      }

      // Cancelled bookings since
      const cancelledBookings = await (this.prisma.client as any).booking.count({
        where: {
          businessId,
          updatedAt: { gte: since },
          status: 'cancelled',
        },
      });
      if (cancelledBookings > 0) {
        changes.push({
          module: 'bookings',
          type: 'updated',
          description: `${cancelledBookings} booking${cancelledBookings > 1 ? 's' : ''} cancelled`,
          severity: 'warning',
          timestamp: new Date(),
        });
      }

      const diff: ContextDiff = {
        businessId,
        since,
        changes,
        summary: `Since ${since.toISOString()}: ${newLeads} new leads, ${newPayments} payments, ${newTasks} tasks, ${newMessages} messages`,
        newLeads,
        newPayments,
        newTasks,
        newMessages,
        alertsTriggered: changes.filter((c: any) => c.severity === 'critical' || c.severity === 'warning').length,
      };

      await this.redis.set(cacheKey, JSON.stringify(diff), 300);
      return diff;
    } catch (error: any) {
      this.logger.error(`[getContextDiff] Error for ${businessId}: ${error.message}`);
      return {
        businessId,
        since,
        changes: [],
        summary: 'Error computing diff',
        newLeads: 0,
        newPayments: 0,
        newTasks: 0,
        newMessages: 0,
        alertsTriggered: 0,
      };
    }
  }

  /* ─────── Cache Invalidation ─────── */

  async invalidateCache(businessId: string): Promise<void> {
    const cacheKey = `key_cortex:context:${businessId}`;
    try {
      await this.redis.del(cacheKey);
      this.logger.debug(`[invalidateCache] Cleared context cache for ${businessId}`);
    } catch (error: any) {
      this.logger.error(`[invalidateCache] Error for ${businessId}: ${error.message}`);
    }
  }

  /* ─────── Health Score ─────── */

  private calculateHealthScore(inputs: {
    crm: CrmContext;
    commerce: CommerceContext;
    bookings: BookingsContext;
    inbox: InboxContext;
    genome: GenomeContext;
  }): number {
    let score = 70; // Base score

    // Deduct for overdue tasks
    score -= Math.min(15, inputs.crm.overdueTasks.length * 3);

    // Deduct for overdue invoices
    score -= Math.min(15, inputs.commerce.outstandingInvoices.overdue * 5);

    // Deduct for unread messages
    score -= Math.min(10, Math.floor(inputs.inbox.unreadMessages / 5));

    // Boost for good collection rate
    if (inputs.commerce.collectionRate > 80) score += 10;
    else if (inputs.commerce.collectionRate < 50) score -= 10;

    // Boost for high completion rate
    if (inputs.bookings.completionRate > 85) score += 5;

    // Genome readiness
    score += Math.floor(inputs.genome.readinessScore / 20);

    return Math.max(0, Math.min(100, score));
  }

  /* ─────── Alert Generation ─────── */

  private generateAlerts(inputs: {
    crm: CrmContext;
    commerce: CommerceContext;
    bookings: BookingsContext;
    inbox: InboxContext;
    genome: GenomeContext;
  }): string[] {
    const alerts: string[] = [];

    if (inputs.commerce.outstandingInvoices.overdue > 0) {
      alerts.push(`${inputs.commerce.outstandingInvoices.overdue} overdue invoice(s) totaling $${inputs.commerce.outstandingInvoices.overdueTotal.toLocaleString()}`);
    }
    if (inputs.crm.overdueTasks.length > 0) {
      alerts.push(`${inputs.crm.overdueTasks.length} overdue task(s) need attention`);
    }
    if (inputs.inbox.unreadMessages > 10) {
      alerts.push(`${inputs.inbox.unreadMessages} unread messages piling up`);
    }
    if (inputs.bookings.noShows.rate > 15) {
      alerts.push(`No-show rate is high (${inputs.bookings.noShows.rate}%)`);
    }
    if (inputs.commerce.collectionRate < 60) {
      alerts.push(`Collection rate is low (${inputs.commerce.collectionRate}%)`);
    }
    if (inputs.crm.newLeadsThisWeek === 0 && inputs.crm.totalContacts > 0) {
      alerts.push(`No new leads this week`);
    }

    return alerts;
  }

  /* ─────── Empty Context Helpers ─────── */

  private emptyCrmContext(): CrmContext {
    return {
      totalContacts: 0,
      newLeadsThisWeek: 0,
      hotLeads: [],
      overdueTasks: [],
      recentActivity: [],
      leadStages: {},
      conversionRateThisMonth: 0,
    };
  }

  private emptyCommerceContext(): CommerceContext {
    return {
      revenueThisMonth: 0,
      revenueThisWeek: 0,
      revenueToday: 0,
      outstandingInvoices: { count: 0, total: 0, overdue: 0, overdueTotal: 0, invoices: [] },
      recentPayments: [],
      topProducts: [],
      collectionRate: 0,
      averageInvoiceValue: 0,
      totalInvoicesThisMonth: 0,
    };
  }

  private emptyBookingsContext(): BookingsContext {
    return {
      upcomingAppointments: [],
      todayBookings: { count: 0, completed: 0, remaining: 0, totalValue: 0 },
      completionRate: 0,
      noShows: { thisWeek: 0, thisMonth: 0, rate: 0 },
      availabilityToday: 0,
      busiestDayThisWeek: 'N/A',
    };
  }

  private emptyCommunicationsContext(): CommunicationsContext {
    return {
      messagesSentThisWeek: 0,
      messagesReceivedThisWeek: 0,
      activeCampaigns: [],
      responseRates: { overall: 0, byChannel: {} },
      recentConversations: 0,
    };
  }

  private emptyAutopilotContext(): AutopilotContext {
    return {
      activeTasks: [],
      delegationLoopStatus: { active: false, tasksDelegatedToday: 0, tasksCompletedToday: 0, efficiency: 0 },
      automationRate: 0,
      pendingApprovals: 0,
      workflowsRunning: 0,
    };
  }

  private emptyTemporalContext(): TemporalContext {
    return {
      recentMemories: [],
      patternsDetected: [],
      contextWindow: 0,
    };
  }

  private emptyInboxContext(): InboxContext {
    return {
      unreadThreads: 0,
      unreadMessages: 0,
      urgentMessages: [],
      aiSummary: '',
      threadsRequiringAction: 0,
      avgResponseTime: 0,
    };
  }

  private emptyGenomeContext(): GenomeContext {
    return {
      dnaScores: {},
      currentStage: '',
      stageProgress: 0,
      readinessScore: 0,
      growthTrajectory: '',
      recommendations: [],
      lastAssessment: new Date(),
    };
  }
}
