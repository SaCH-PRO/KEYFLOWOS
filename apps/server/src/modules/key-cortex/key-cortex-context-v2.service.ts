/**
 * ============================================================================
 * KEY CORTEX CONTEXT v2 — The Omniscient Eye
 * ============================================================================
 * Assembles comprehensive context from ALL KeyFlowOS modules for AI consumption.
 * Every data point that matters, in one place, cached for speed.
 * ============================================================================
 */

import { Injectable, Logger } from '@nestjs/common';
// BookingStatus is an enum in the schema. Every status here was written as a
// lowercase string literal, which Prisma rejects at runtime — invisible while
// `prisma.client` was cast to `any`.
import { BookingStatus } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { RedisService } from '../../core/redis/redis.service';
import { InvoiceStatus } from '@prisma/client';
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

export interface DeviceContext {
  recentCaptures: Array<{
    id: string;
    mediaType: string;
    detectedType: string | null;
    status: string;
    createdAt: Date;
    publicUrl?: string | null;
  }>;
  pendingCaptures: number;
  highConfidenceContacts: Array<{
    id: string;
    entityType: string;
    proposedData: Record<string, unknown>;
    matchConfidence: number | null;
  }>;
  linkedCommandItems: Array<{
    id: string;
    title: string;
    category: string;
    status: string;
  }>;
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
  device: DeviceContext;
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

/**
 * Contact has no `name` column. Every caller that shows one selects the same
 * trio — displayName, firstName, lastName — so the fallback order is written
 * once here rather than at each of the six sites that needed it.
 */
function contactDisplayName(c: { displayName?: string | null; firstName?: string | null; lastName?: string | null } | null | undefined): string {
  if (!c) return 'Unknown';
  const full = [c.firstName, c.lastName].filter(Boolean).join(' ').trim();
  return c.displayName?.trim() || full || 'Unknown';
}

/* ─────────────────────────── Service ─────────────────────────── */

@Injectable()
export class KeyCortexContextV2Service {
  private readonly logger = new Logger(KeyCortexContextV2Service.name);
  private readonly CACHE_TTL = 120; // 2 minutes

  // Six services used to be injected here and none of them was ever called —
  // crm, commerce, bookings and autopilot were already dead; temporal and inbox
  // became dead when the calls to their non-existent methods were replaced with
  // real queries. This service reads Prisma directly and always has.
  //
  // They are not free. Each was an edge in the module graph, and this module is
  // one of the four cycles that made the server fail to boot on 2026-08-09.
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
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
      this.getDeviceContext(businessId),
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
      deviceCtx,
    ] = contexts;

    const crm = (crmCtx ?? this.emptyCrmContext()) as CrmContext;
    const commerce = (commerceCtx ?? this.emptyCommerceContext()) as CommerceContext;
    const bookings = (bookingsCtx ?? this.emptyBookingsContext()) as BookingsContext;
    const communications = (communicationsCtx ?? this.emptyCommunicationsContext()) as CommunicationsContext;
    const autopilot = (autopilotCtx ?? this.emptyAutopilotContext()) as AutopilotContext;
    const temporal = (temporalCtx ?? this.emptyTemporalContext()) as TemporalContext;
    const inbox = (inboxCtx ?? this.emptyInboxContext()) as InboxContext;
    const genome = (genomeCtx ?? this.emptyGenomeContext()) as GenomeContext;
    const device = (deviceCtx ?? this.emptyDeviceContext()) as DeviceContext;

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
      device,
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
          this.prisma.client.contact.count({ where: { businessId } }),
          this.prisma.client.contact.count({
            where: { businessId, createdAt: { gte: weekStart } },
          }),
          this.prisma.client.contact.findMany({
            where: {
              businessId,
              status: 'lead',
              leadScore: { gte: 70 },
            },
            orderBy: { leadScore: 'desc' },
            take: 10,
            // Contact has no `name`, `score` or `stage`. The real fields are
            // firstName/lastName/displayName, leadScore and pipelineStage —
            // the trio is what every other caller selects (calendar.service,
            // accounting.controller, revenue-reporting).
            select: {
              id: true,
              firstName: true,
              lastName: true,
              displayName: true,
              email: true,
              leadScore: true,
              lastInteractionAt: true,
              pipelineStage: true,
            },
          }),
          this.prisma.client.crmTask.findMany({
            where: {
              businessId,
              dueDate: { lt: new Date() },
              status: { notIn: ['completed', 'cancelled'] },
            },
            orderBy: { dueDate: 'asc' },
            take: 10,
            include: {
              contact: { select: { firstName: true, lastName: true, displayName: true } },
            },
          }),
          this.prisma.client.crmActivity.findMany({
            where: { businessId },
            orderBy: { createdAt: 'desc' },
            take: 10,
            include: {
              contact: { select: { firstName: true, lastName: true, displayName: true } },
            },
          }),
          // `stage` is not a Contact field; the pipeline column is pipelineStage.
          this.prisma.client.contact.groupBy({
            by: ['pipelineStage'],
            where: { businessId, status: 'lead' },
            _count: { pipelineStage: true },
          }),
        ]);

      // Calculate conversion rate
      const convertedThisMonth = await this.prisma.client.contact.count({
        where: {
          businessId,
          status: 'customer',
          createdAt: { gte: monthStart },
        },
      });
      const leadsCreatedThisMonth = await this.prisma.client.contact.count({
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
        // The OUTPUT shape (name/score/stage) is the contract these callers
        // read; only the source columns change.
        hotLeads: hotLeadsRaw.map((l: any) => ({
          id: l.id,
          name: contactDisplayName(l),
          email: l.email || '',
          score: l.leadScore ?? 0,
          lastActivity: l.lastInteractionAt || new Date(),
          stage: l.pipelineStage || 'new',
        })),
        overdueTasks: overdueTasksRaw.map((t: any) => ({
          id: t.id,
          title: t.title,
          contactName: contactDisplayName(t.contact),
          dueDate: t.dueDate,
          priority: t.priority || 'medium',
        })),
        recentActivity: recentActivityRaw.map((a: any) => ({
          type: a.type,
          description: a.description || '',
          timestamp: a.createdAt,
          contactName: contactDisplayName(a.contact),
        })),
        leadStages: leadStages.reduce((acc: any, s: any) => {
          acc[s.pipelineStage || 'unknown'] = s._count.pipelineStage;
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
        this.prisma.client.invoice.findMany({
          where: {
            businessId,
            createdAt: { gte: monthStart },
          },
          select: { total: true },
        }),
        this.prisma.client.invoice.findMany({
          where: {
            businessId,
            createdAt: { gte: weekStart },
          },
          select: { total: true },
        }),
        this.prisma.client.invoice.findMany({
          where: {
            businessId,
            createdAt: { gte: today },
          },
          select: { total: true },
        }),
        this.prisma.client.invoice.findMany({
          where: {
            businessId,
            status: { in: [InvoiceStatus.SENT, InvoiceStatus.PENDING, InvoiceStatus.PARTIAL] },
          },
          include: {
            contact: { select: { firstName: true, lastName: true, displayName: true } },
          },
          orderBy: { dueDate: 'asc' },
        }),
        this.prisma.client.payment.findMany({
          where: {
            businessId,
            createdAt: { gte: subDays(new Date(), 7) },
          },
          // Payment's only relation is `invoice`; the contact hangs off that.
          include: {
            invoice: {
              select: { contact: { select: { firstName: true, lastName: true, displayName: true } } },
            },
          },
          orderBy: { createdAt: 'desc' },
          take: 10,
        }),
        this.prisma.client.invoiceItem.groupBy({
          by: ['productId'],
          where: {
            invoice: { businessId, createdAt: { gte: monthStart } },
          },
          _sum: { quantity: true, total: true },
          orderBy: { _sum: { total: 'desc' } },
          take: 5,
        }),
        this.prisma.client.payment.aggregate({
          where: { businessId, status: 'completed' },
          _sum: { amount: true },
        }),
        this.prisma.client.invoice.aggregate({
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
        ? await this.prisma.client.product.findMany({
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
            contactName: contactDisplayName(i.contact),
            amount: i.total || 0,
            dueDate: i.dueDate || new Date(),
            status: i.status,
            daysOverdue: Math.max(0, Math.floor((Date.now() - new Date(i.dueDate).getTime()) / 86400000)),
          })),
        },
        recentPayments: recentPayments.map((p: any) => ({
          id: p.id,
          contactName: contactDisplayName(p.invoice?.contact),
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
          this.prisma.client.booking.findMany({
            where: {
              businessId,
              startTime: { gte: now },
              status: { notIn: [BookingStatus.CANCELLED, BookingStatus.NO_SHOW] },
            },
            orderBy: { startTime: 'asc' },
            take: 10,
            include: {
              contact: { select: { firstName: true, lastName: true, displayName: true } },
              service: { select: { name: true, duration: true, price: true } },
            },
          }),
          this.prisma.client.booking.findMany({
            where: {
              businessId,
              startTime: { gte: todayStart, lte: todayEnd },
            },
            include: {
              contact: { select: { firstName: true, lastName: true, displayName: true } },
              service: { select: { name: true, duration: true, price: true } },
            },
          }),
          this.prisma.client.booking.findMany({
            where: {
              businessId,
              startTime: { gte: weekStart },
            },
            include: {
              service: { select: { price: true } },
            },
          }),
          this.prisma.client.booking.count({
            where: {
              businessId,
              startTime: { gte: weekStart },
              status: BookingStatus.COMPLETED,
            },
          }),
          this.prisma.client.booking.count({
            where: {
              businessId,
              startTime: { gte: weekStart },
              status: BookingStatus.NO_SHOW,
            },
          }),
          this.prisma.client.booking.count({
            where: {
              businessId,
              startTime: { gte: startOfMonth(now) },
              status: BookingStatus.NO_SHOW,
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
          contactName: contactDisplayName(a.contact),
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
        this.prisma.client.message.count({
          where: { businessId, direction: 'outbound', createdAt: { gte: weekStart } },
        }),
        this.prisma.client.message.count({
          where: { businessId, direction: 'inbound', createdAt: { gte: weekStart } },
        }),
        this.prisma.client.campaign.findMany({
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
        // Conversation is a business-to-business thread: both participants are
        // Businesses, so there is no businessId column to filter on.
        this.prisma.client.conversation.count({
          where: {
            OR: [{ participantAId: businessId }, { participantBId: businessId }],
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
      const responded = await this.prisma.client.message.count({
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
          this.prisma.client.autopilotTask.findMany({
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
              executedBy: true,
              priority: true,
              dueDate: true,
            },
          }),
          this.prisma.client.autopilotTask.count({
            where: {
              businessId,
              category: 'delegation_loop',
              createdAt: { gte: todayStart },
            },
          }),
          this.prisma.client.autopilotTask.count({
            where: {
              businessId,
              status: 'completed',
              executedAt: { gte: todayStart },
            },
          }),
          this.prisma.client.autopilotTask.count({
            where: {
              businessId,
              status: 'awaiting_approval',
            },
          }),
          this.prisma.client.workflow.findMany({
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
      const automatedTasks = await this.prisma.client.autopilotTask.count({
        where: {
          businessId,
          category: { in: ['workflow', 'automation', 'delegation_loop'] },
          createdAt: { gte: subDays(new Date(), 30) },
        },
      });
      const totalTasksMonth = await this.prisma.client.autopilotTask.count({
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
          assignee: t.executedBy || 'Unassigned',
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
      // TemporalFlowMemoryService has no getRecentMemories or getDetectedPatterns
      // — those names belong to TemporalAdapterService and to nothing at all
      // respectively. Read the model directly, as the rest of this file does.
      //
      // "Patterns" were never stored; they are derived here by grouping memories
      // on `type`, which is what a detected pattern actually is in this schema:
      // a recurring kind of memory, with a count, an average confidence and a
      // first/last sighting.
      const [memories, patterns] = await Promise.all([
        this.prisma.client.temporalFlowMemory.findMany({
          where: { businessId },
          orderBy: { createdAt: 'desc' },
          take: 20,
          select: { id: true, content: true, type: true, confidence: true, createdAt: true },
        }),
        this.prisma.client.temporalFlowMemory.groupBy({
          by: ['type'],
          where: { businessId },
          _count: { type: true },
          _avg: { confidence: true },
          _min: { createdAt: true },
          _max: { createdAt: true },
          orderBy: { _count: { type: 'desc' } },
          take: 10,
        }),
      ]);

      return {
        recentMemories: memories.map((m) => ({
          id: m.id,
          content: m.content ?? '',
          type: m.type ?? 'memory',
          importance: m.confidence ?? 0,
          createdAt: m.createdAt,
        })),
        patternsDetected: patterns.map((p) => ({
          pattern: p.type ?? '',
          frequency: p._count.type,
          confidence: p._avg.confidence ?? 0,
          firstSeen: p._min.createdAt ?? new Date(),
          lastSeen: p._max.createdAt ?? new Date(),
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
      // KeyInboxIntelligenceService is a REPORTING service — generateReport,
      // listReports, getLatestReport. None of the six methods called here have
      // ever existed on it. Read the inbox models directly.
      //
      // "Unread" is not a column in this schema. The honest equivalents:
      //   unreadThreads          threads still OPEN
      //   unreadMessages         inbound messages on those OPEN threads
      //   threadsRequiringAction threads WAITING, i.e. waiting on us
      const [openThreads, waitingThreads, inboundOnOpen, urgent, forResponse] = await Promise.all([
        this.prisma.client.keyInboxThread.count({ where: { businessId, status: 'OPEN' } }),
        this.prisma.client.keyInboxThread.count({ where: { businessId, status: 'WAITING' } }),
        this.prisma.client.keyInboxMessage.count({
          where: { businessId, direction: 'INBOUND', thread: { status: 'OPEN' } },
        }),
        this.prisma.client.keyInboxThread.findMany({
          where: { businessId, status: { not: 'DONE' }, aiUrgency: { in: ['high', 'urgent', 'critical'] } },
          orderBy: { lastMessageAt: 'desc' },
          take: 5,
          select: {
            id: true, subject: true, channel: true, aiSummary: true,
            aiUrgency: true, priority: true, lastMessageAt: true, createdAt: true,
          },
        }),
        this.prisma.client.keyInboxThread.findMany({
          where: { businessId, lastInboundAt: { not: null }, lastOutboundAt: { not: null } },
          orderBy: { lastMessageAt: 'desc' },
          take: 100,
          select: { lastInboundAt: true, lastOutboundAt: true },
        }),
      ]);

      // Average reply latency in minutes, over threads we have actually answered.
      const gaps = forResponse
        .map((t) => (t.lastOutboundAt!.getTime() - t.lastInboundAt!.getTime()) / 60000)
        .filter((mins) => mins > 0);
      const avgResponse = gaps.length ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length) : 0;

      return {
        unreadThreads: openThreads,
        unreadMessages: inboundOnOpen,
        urgentMessages: urgent.map((t) => ({
          id: t.id,
          subject: t.subject || 'No subject',
          sender: t.channel || 'Unknown',
          preview: (t.aiSummary || '').slice(0, 160),
          receivedAt: t.lastMessageAt ?? t.createdAt,
          priority: t.aiUrgency || String(t.priority ?? 'medium'),
        })),
        aiSummary: urgent[0]?.aiSummary
          ? `${urgent.length} urgent thread(s). Most recent: ${urgent[0].aiSummary}`
          : `${openThreads} open, ${waitingThreads} awaiting reply.`,
        threadsRequiringAction: waitingThreads,
        avgResponseTime: avgResponse,
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
      const genome = await this.prisma.client.businessGenome.findUnique({
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

  /* ─────── Device Context ─────── */

  async getDeviceContext(businessId: string): Promise<DeviceContext> {
    try {
      const since = subDays(new Date(), 7);

      const [assets, pendingCount, entities, commands] = await Promise.all([
        // This used to `include: { visualIntake: true }`, which Prisma rejects:
        // MediaAsset declares no relations at all, and VisualIntake links back
        // by a plain mediaAssetId string. The intent was right and the mechanism
        // was impossible, so the join is done below with a second query.
        this.prisma.client.mediaAsset.findMany({
          where: { businessId, createdAt: { gte: since } },
          orderBy: { createdAt: 'desc' },
          take: 10,
        }),
        this.prisma.client.visualIntake.count({
          where: { businessId, status: { in: ['PENDING', 'PROCESSED'] } },
        }),
        this.prisma.client.extractedEntity.findMany({
          where: {
            businessId,
            entityType: { in: ['business_card', 'contact'] },
            matchConfidence: { gte: 70 },
          },
          orderBy: { createdAt: 'desc' },
          take: 10,
        }),
        this.prisma.client.commandItem.findMany({
          where: {
            businessId,
            sourceModule: 'DEVICE',
            status: { in: ['OPEN', 'PENDING'] },
          },
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: { id: true, title: true, category: true, status: true },
        }),
      ]);

      // The join Prisma could not express: VisualIntake carries detectedType and
      // points at MediaAsset by a plain string id.
      const intakes = assets.length
        ? await this.prisma.client.visualIntake.findMany({
            where: { businessId, mediaAssetId: { in: assets.map((a) => a.id) } },
            select: { mediaAssetId: true, detectedType: true },
          })
        : [];
      const detectedTypeByAsset = new Map(
        intakes.filter((i) => i.mediaAssetId).map((i) => [i.mediaAssetId as string, i.detectedType]),
      );

      return {
        recentCaptures: (assets || []).map((a: any) => ({
          id: a.id,
          mediaType: a.mediaType ?? 'unknown',
          detectedType: detectedTypeByAsset.get(a.id) ?? a.linkedEntityType ?? null,
          status: a.status ?? 'unknown',
          createdAt: a.createdAt,
          publicUrl: a.publicUrl ?? null,
        })),
        pendingCaptures: pendingCount ?? 0,
        highConfidenceContacts: (entities || []).map((e: any) => ({
          id: e.id,
          entityType: e.entityType ?? 'unknown',
          proposedData: (e.proposedData as Record<string, unknown>) ?? {},
          matchConfidence: e.matchConfidence ?? null,
        })),
        linkedCommandItems: (commands || []).map((c: any) => ({
          id: c.id,
          title: c.title ?? 'Untitled',
          category: c.category ?? 'WORK',
          status: c.status ?? 'OPEN',
        })),
      };
    } catch (error: any) {
      this.logger.error(`[getDeviceContext] Error for ${businessId}: ${error.message}`);
      return this.emptyDeviceContext();
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

    // ── Device captures ──
    sections.push(`--- DEVICE CAPTURES ---`);
    sections.push(`Recent captures: ${context.device.recentCaptures.length} | Pending review: ${context.device.pendingCaptures}`);
    if (context.device.highConfidenceContacts.length) {
      sections.push(`High-confidence extracted contacts: ${context.device.highConfidenceContacts.length}`);
    }
    if (context.device.linkedCommandItems.length) {
      sections.push(`Linked command items: ${context.device.linkedCommandItems.map((c) => c.title).slice(0, 3).join(', ')}`);
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
      newLeads += await this.prisma.client.contact.count({
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
      const payments = await this.prisma.client.payment.findMany({
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
      newTasks += await this.prisma.client.autopilotTask.count({
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
      newMessages += await this.prisma.client.message.count({
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
      const newlyOverdue = await this.prisma.client.invoice.count({
        where: {
          businessId,
          dueDate: { gte: since, lt: new Date() },
          status: { in: [InvoiceStatus.SENT, InvoiceStatus.PENDING] },
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
      const newBookings = await this.prisma.client.booking.count({
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
      const cancelledBookings = await this.prisma.client.booking.count({
        where: {
          businessId,
          updatedAt: { gte: since },
          status: BookingStatus.CANCELLED,
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

  private emptyDeviceContext(): DeviceContext {
    return {
      recentCaptures: [],
      pendingCaptures: 0,
      highConfidenceContacts: [],
      linkedCommandItems: [],
    };
  }
}
