import { Injectable, Logger, Inject, OnModuleInit, OnModuleDestroy, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { GovernanceService } from '../ai/governance.service';
import { AiMemoryService } from '../ai/ai-memory.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

export type LoopType =
  | 'payment_recovery'
  | 'lead_reactivation'
  | 'post_purchase'
  | 'booking_prep'
  | 'weekly_hygiene';

interface LoopDefinition {
  loopType: LoopType;
  name: string;
  description: string;
  riskTier: number;
  defaultIntervalMin: number;
  defaultConfig: Record<string, unknown>;
}

const LOOP_DEFINITIONS: LoopDefinition[] = [
  {
    loopType: 'payment_recovery',
    name: 'Payment Recovery',
    description: 'Automatically follows up on overdue invoices with escalating reminders and payment link re-sends.',
    riskTier: 2,
    defaultIntervalMin: 360,
    defaultConfig: { graceDays: 3, maxReminders: 3, escalateAfterDays: 14 },
  },
  {
    loopType: 'lead_reactivation',
    name: 'Lead Reactivation',
    description: 'Re-engages stale leads who haven\'t interacted in a configurable window with personalized outreach.',
    riskTier: 2,
    defaultIntervalMin: 1440,
    defaultConfig: { staleDays: 30, maxPerRun: 10, excludeTags: ['do-not-contact'] },
  },
  {
    loopType: 'post_purchase',
    name: 'Post-Purchase Follow-up',
    description: 'Sends thank-you messages, review requests, and reorder prompts after completed purchases.',
    riskTier: 1,
    defaultIntervalMin: 720,
    defaultConfig: { thankYouDelayHours: 2, reviewRequestDelayDays: 7, reorderPromptDays: 30 },
  },
  {
    loopType: 'booking_prep',
    name: 'Booking Prep & Follow-up',
    description: 'Sends preparation reminders before appointments and follow-up messages after completion.',
    riskTier: 1,
    defaultIntervalMin: 360,
    defaultConfig: { reminderHoursBefore: 24, followUpDelayHours: 2 },
  },
  {
    loopType: 'weekly_hygiene',
    name: 'Weekly Hygiene',
    description: 'Cleans up stale data, archives old drafts, flags duplicate contacts, and summarizes weekly patterns.',
    riskTier: 1,
    defaultIntervalMin: 10080,
    defaultConfig: { archiveDraftsDays: 30, flagDuplicates: true, summarizePatterns: true },
  },
];

const LOOP_CHECK_INTERVAL_MS = 5 * 60 * 1000;

@Injectable()
export class DelegationLoopService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DelegationLoopService.name);
  private intervalRef: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(GovernanceService) private readonly governance: GovernanceService,
    @Inject(AiMemoryService) private readonly memory: AiMemoryService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
  ) {}

  onModuleInit() {
    this.intervalRef = setInterval(() => {
      this.processDueLoops().catch(err =>
        this.logger.error(`Loop processing failed: ${(err as Error).message}`),
      );
    }, LOOP_CHECK_INTERVAL_MS);
    this.logger.log('Delegation loop scheduler started (5min check interval)');
  }

  onModuleDestroy() {
    if (this.intervalRef) {
      clearInterval(this.intervalRef);
      this.intervalRef = null;
    }
  }

  getLoopDefinitions(): LoopDefinition[] {
    return LOOP_DEFINITIONS;
  }

  async ensureLoopsForBusiness(businessId: string) {
    const existing = await this.prisma.client.delegationLoop.findMany({
      where: { businessId },
      select: { loopType: true },
    });
    const existingTypes = new Set(existing.map((l: { loopType: string }) => l.loopType));

    for (const def of LOOP_DEFINITIONS) {
      if (!existingTypes.has(def.loopType)) {
        await this.prisma.client.delegationLoop.create({
          data: {
            businessId,
            loopType: def.loopType,
            name: def.name,
            description: def.description,
            riskTier: def.riskTier,
            intervalMin: def.defaultIntervalMin,
            config: def.defaultConfig,
            enabled: false,
          },
        });
      }
    }
  }

  async getLoops(businessId: string) {
    await this.ensureLoopsForBusiness(businessId);
    return this.prisma.client.delegationLoop.findMany({
      where: { businessId },
      orderBy: { createdAt: 'asc' },
      include: {
        runs: {
          orderBy: { startedAt: 'desc' },
          take: 1,
        },
      },
    });
  }

  async updateLoop(businessId: string, loopId: string, updates: { enabled?: boolean; config?: Record<string, unknown>; intervalMin?: number }) {
    const loop = await this.prisma.client.delegationLoop.findFirst({
      where: { id: loopId, businessId },
    });
    if (!loop) throw new NotFoundException('Delegation loop not found');

    const data: Record<string, unknown> = {};
    if (typeof updates.enabled === 'boolean') data.enabled = updates.enabled;
    if (updates.config) data.config = { ...(loop.config as Record<string, unknown> || {}), ...updates.config };
    if (typeof updates.intervalMin === 'number') data.intervalMin = updates.intervalMin;

    if (updates.enabled && !loop.nextRunAt) {
      data.nextRunAt = new Date(Date.now() + 60_000);
    }

    return this.prisma.client.delegationLoop.update({
      where: { id: loopId },
      data: data as any,
    });
  }

  async getRunHistory(businessId: string, loopId: string, limit = 20) {
    return this.prisma.client.delegationLoopRun.findMany({
      where: { loopId, businessId },
      orderBy: { startedAt: 'desc' },
      take: limit,
    });
  }

  async runLoop(businessId: string, loopId: string): Promise<{ runId: string; status: string; itemsMatched: number; actionsCreated: number }> {
    const loop = await this.prisma.client.delegationLoop.findFirst({
      where: { id: loopId, businessId },
    });
    if (!loop) throw new NotFoundException('Delegation loop not found');

    return this.executeLoop(loop as any);
  }

  private async processDueLoops() {
    const now = new Date();
    const dueLoops = await this.prisma.client.delegationLoop.findMany({
      where: {
        enabled: true,
        nextRunAt: { lte: now },
      },
    });

    if (dueLoops.length === 0) return;

    this.logger.log(`Processing ${dueLoops.length} due delegation loop(s)`);

    for (const loop of dueLoops) {
      try {
        await this.executeLoop(loop as any);
      } catch (err) {
        this.logger.error(`Loop ${loop.loopType} failed for business ${loop.businessId}: ${(err as Error).message}`);
      }
    }
  }

  private async executeLoop(loop: {
    id: string;
    businessId: string;
    loopType: string;
    config: Record<string, unknown> | null;
    intervalMin: number;
    riskTier: number;
  }) {
    const run = await this.prisma.client.delegationLoopRun.create({
      data: {
        loopId: loop.id,
        businessId: loop.businessId,
        status: 'running',
      },
    });

    const result = { itemsScanned: 0, itemsMatched: 0, actionsCreated: 0, actionsBlocked: 0, results: [] as unknown[] };

    try {
      const decision = await this.governance.evaluate(loop.businessId, `delegation_${loop.loopType}`);

      if (!decision.allowed) {
        result.results.push({ blocked: true, reason: decision.reason });
        result.actionsBlocked++;
      } else if (decision.requiresFormalApproval || decision.requiresAdminApproval) {
        await this.governance.createApprovalItem(loop.businessId, {
          toolName: `delegation_${loop.loopType}`,
          title: `Run delegation loop: ${loop.loopType}`,
          description: `Autopilot wants to run the "${loop.loopType}" delegation loop. ${decision.reason}`,
          rationale: `Scheduled delegation loop execution (tier ${decision.tier})`,
          module: 'autopilot',
        });
        result.actionsBlocked++;
        result.results.push({ requiresApproval: true, tier: decision.tier, reason: decision.reason });
      } else {
        const config = (loop.config || {}) as Record<string, unknown>;
        const requiresConfirm = decision.requiresQuickConfirm;

        switch (loop.loopType) {
          case 'payment_recovery':
            await this.runPaymentRecovery(loop.businessId, config, result, requiresConfirm);
            break;
          case 'lead_reactivation':
            await this.runLeadReactivation(loop.businessId, config, result, requiresConfirm);
            break;
          case 'post_purchase':
            await this.runPostPurchase(loop.businessId, config, result, requiresConfirm);
            break;
          case 'booking_prep':
            await this.runBookingPrep(loop.businessId, config, result, requiresConfirm);
            break;
          case 'weekly_hygiene':
            await this.runWeeklyHygiene(loop.businessId, config, result);
            break;
        }
      }

      await this.prisma.client.delegationLoopRun.update({
        where: { id: run.id },
        data: {
          status: 'completed',
          completedAt: new Date(),
          itemsScanned: result.itemsScanned,
          itemsMatched: result.itemsMatched,
          actionsCreated: result.actionsCreated,
          actionsBlocked: result.actionsBlocked,
          results: result.results as any,
        },
      });

      const nextRunAt = new Date(Date.now() + loop.intervalMin * 60 * 1000);
      const statsRaw = await this.prisma.client.delegationLoopRun.aggregate({
        where: { loopId: loop.id, status: 'completed' },
        _count: true,
        _sum: { actionsCreated: true, itemsMatched: true },
      });
      await this.prisma.client.delegationLoop.update({
        where: { id: loop.id },
        data: {
          lastRunAt: new Date(),
          nextRunAt,
          stats: {
            totalRuns: statsRaw._count,
            totalActionsCreated: statsRaw._sum.actionsCreated || 0,
            totalItemsMatched: statsRaw._sum.itemsMatched || 0,
          },
        },
      });

      if (result.actionsCreated > 0) {
        this.memory.upsert(loop.businessId, {
          category: 'patterns',
          key: `delegation_${loop.loopType}_activity`,
          value: `Delegation loop "${loop.loopType}" created ${result.actionsCreated} actions from ${result.itemsMatched} matches on ${new Date().toISOString()}`,
          confidence: 0.9,
          source: 'pattern_analysis',
          expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        }).catch(() => {});
      }

      return { runId: run.id, status: 'completed', itemsMatched: result.itemsMatched, actionsCreated: result.actionsCreated };
    } catch (err) {
      await this.prisma.client.delegationLoopRun.update({
        where: { id: run.id },
        data: {
          status: 'failed',
          completedAt: new Date(),
          error: (err as Error).message,
        },
      });

      throw err;
    }
  }

  private async runPaymentRecovery(
    businessId: string,
    config: Record<string, unknown>,
    result: { itemsScanned: number; itemsMatched: number; actionsCreated: number; actionsBlocked: number; results: unknown[] },
    requiresConfirm = false,
  ) {
    const graceDays = (config.graceDays as number) || 3;
    const maxReminders = (config.maxReminders as number) || 3;
    const escalateAfterDays = (config.escalateAfterDays as number) || 14;

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - graceDays);

    const overdueInvoices = await this.prisma.client.invoice.findMany({
      where: {
        businessId,
        status: { in: ['SENT', 'OVERDUE'] },
        dueDate: { lt: cutoff },
        deletedAt: null,
      },
      include: {
        contact: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, doNotContact: true } },
      },
      take: 50,
    });

    result.itemsScanned = overdueInvoices.length;

    for (const invoice of overdueInvoices) {
      if (!invoice.contact || invoice.contact.doNotContact) continue;

      const daysPastDue = Math.ceil((Date.now() - new Date(invoice.dueDate!).getTime()) / (24 * 60 * 60 * 1000));
      const existingReminders = await this.prisma.client.autopilotTask.count({
        where: {
          businessId,
          relatedType: 'INVOICE',
          relatedId: invoice.id,
          category: 'PAYMENT_RECOVERY',
        },
      });

      if (existingReminders >= maxReminders) continue;

      result.itemsMatched++;

      const priority = daysPastDue >= escalateAfterDays ? 'URGENT' : daysPastDue >= 7 ? 'HIGH' : 'NORMAL';
      const contactName = [invoice.contact.firstName, invoice.contact.lastName].filter(Boolean).join(' ') || 'Customer';
      const needsApproval = requiresConfirm || priority === 'URGENT';

      await this.prisma.client.autopilotTask.create({
        data: {
          businessId,
          title: `Payment reminder: ${invoice.invoiceNumber} — TTD ${Number(invoice.total).toFixed(2)}`,
          description: `Invoice ${invoice.invoiceNumber} is ${daysPastDue} days overdue for ${contactName}. Total: TTD ${Number(invoice.total).toFixed(2)}.`,
          category: 'PAYMENT_RECOVERY',
          priority,
          autoExecutable: !needsApproval,
          requiresApproval: needsApproval,
          relatedType: 'INVOICE',
          relatedId: invoice.id,
          aiContext: {
            loopType: 'payment_recovery',
            contactId: invoice.contact.id,
            contactName,
            invoiceNumber: invoice.invoiceNumber,
            total: Number(invoice.total),
            daysPastDue,
            reminderCount: existingReminders + 1,
          },
        },
      });

      result.actionsCreated++;
      result.results.push({
        type: 'payment_reminder',
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        contactName,
        daysPastDue,
        priority,
      });
    }
  }

  private async runLeadReactivation(
    businessId: string,
    config: Record<string, unknown>,
    result: { itemsScanned: number; itemsMatched: number; actionsCreated: number; actionsBlocked: number; results: unknown[] },
    requiresConfirm = false,
  ) {
    const staleDays = (config.staleDays as number) || 30;
    const maxPerRun = (config.maxPerRun as number) || 10;
    const excludeTags = (config.excludeTags as string[]) || ['do-not-contact'];

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - staleDays);

    const staleLeads = await this.prisma.client.contact.findMany({
      where: {
        businessId,
        status: 'LEAD',
        deletedAt: null,
        doNotContact: { not: true },
        updatedAt: { lt: cutoff },
        NOT: {
          tags: { hasSome: excludeTags },
        },
      },
      select: { id: true, firstName: true, lastName: true, email: true, phone: true, updatedAt: true, leadScore: true },
      orderBy: { leadScore: 'desc' },
      take: maxPerRun + 20,
    });

    result.itemsScanned = staleLeads.length;

    let created = 0;
    for (const lead of staleLeads) {
      if (created >= maxPerRun) break;

      const existing = await this.prisma.client.autopilotTask.findFirst({
        where: {
          businessId,
          relatedType: 'CONTACT',
          relatedId: lead.id,
          category: 'LEAD_REACTIVATION',
          status: { in: ['PENDING', 'IN_PROGRESS', 'AWAITING_APPROVAL'] },
        },
      });
      if (existing) continue;

      result.itemsMatched++;

      const contactName = [lead.firstName, lead.lastName].filter(Boolean).join(' ') || lead.email || 'Lead';
      const daysSince = Math.ceil((Date.now() - new Date(lead.updatedAt).getTime()) / (24 * 60 * 60 * 1000));

      await this.prisma.client.autopilotTask.create({
        data: {
          businessId,
          title: `Re-engage: ${contactName}`,
          description: `${contactName} hasn't interacted in ${daysSince} days. Score: ${lead.leadScore ?? 'unscored'}.`,
          category: 'LEAD_REACTIVATION',
          priority: (lead.leadScore ?? 0) >= 70 ? 'HIGH' : 'NORMAL',
          autoExecutable: !requiresConfirm,
          requiresApproval: requiresConfirm,
          relatedType: 'CONTACT',
          relatedId: lead.id,
          aiContext: {
            loopType: 'lead_reactivation',
            contactId: lead.id,
            contactName,
            daysSinceLastActivity: daysSince,
            leadScore: lead.leadScore,
            hasEmail: !!lead.email,
            hasPhone: !!lead.phone,
          },
        },
      });

      result.actionsCreated++;
      created++;
      result.results.push({
        type: 'lead_reactivation',
        contactId: lead.id,
        contactName,
        daysSince,
      });
    }
  }

  private async runPostPurchase(
    businessId: string,
    config: Record<string, unknown>,
    result: { itemsScanned: number; itemsMatched: number; actionsCreated: number; actionsBlocked: number; results: unknown[] },
    requiresConfirm = false,
  ) {
    const reviewRequestDelayDays = (config.reviewRequestDelayDays as number) || 7;

    const reviewCutoffStart = new Date();
    reviewCutoffStart.setDate(reviewCutoffStart.getDate() - reviewRequestDelayDays - 1);
    const reviewCutoffEnd = new Date();
    reviewCutoffEnd.setDate(reviewCutoffEnd.getDate() - reviewRequestDelayDays);

    const recentlyPaidInvoices = await this.prisma.client.invoice.findMany({
      where: {
        businessId,
        status: 'PAID',
        paidAt: { gte: reviewCutoffStart, lt: reviewCutoffEnd },
        deletedAt: null,
      },
      include: {
        contact: { select: { id: true, firstName: true, lastName: true, email: true, doNotContact: true } },
      },
      take: 30,
    });

    result.itemsScanned = recentlyPaidInvoices.length;

    for (const invoice of recentlyPaidInvoices) {
      if (!invoice.contact || invoice.contact.doNotContact) continue;

      const existing = await this.prisma.client.autopilotTask.findFirst({
        where: {
          businessId,
          relatedType: 'INVOICE',
          relatedId: invoice.id,
          category: 'POST_PURCHASE',
        },
      });
      if (existing) continue;

      result.itemsMatched++;

      const contactName = [invoice.contact.firstName, invoice.contact.lastName].filter(Boolean).join(' ') || 'Customer';

      await this.prisma.client.autopilotTask.create({
        data: {
          businessId,
          title: `Review request: ${contactName}`,
          description: `${contactName} paid invoice ${invoice.invoiceNumber} ${reviewRequestDelayDays} days ago. Send a review/feedback request.`,
          category: 'POST_PURCHASE',
          priority: 'NORMAL',
          autoExecutable: !requiresConfirm,
          requiresApproval: requiresConfirm,
          relatedType: 'INVOICE',
          relatedId: invoice.id,
          aiContext: {
            loopType: 'post_purchase',
            contactId: invoice.contact.id,
            contactName,
            invoiceNumber: invoice.invoiceNumber,
            paidAt: invoice.paidAt?.toISOString(),
            total: Number(invoice.total),
          },
        },
      });

      result.actionsCreated++;
      result.results.push({ type: 'review_request', contactName, invoiceId: invoice.id });
    }
  }

  private async runBookingPrep(
    businessId: string,
    config: Record<string, unknown>,
    result: { itemsScanned: number; itemsMatched: number; actionsCreated: number; actionsBlocked: number; results: unknown[] },
    requiresConfirm = false,
  ) {
    const reminderHoursBefore = (config.reminderHoursBefore as number) || 24;
    const followUpDelayHours = (config.followUpDelayHours as number) || 2;

    const reminderWindow = new Date(Date.now() + reminderHoursBefore * 60 * 60 * 1000);
    const now = new Date();

    const upcomingBookings = await this.prisma.client.booking.findMany({
      where: {
        businessId,
        status: { in: ['CONFIRMED', 'PENDING'] },
        startTime: { gt: now, lte: reminderWindow },
        deletedAt: null,
      },
      include: {
        contact: { select: { id: true, firstName: true, lastName: true, email: true, doNotContact: true } },
      },
      take: 50,
    });

    result.itemsScanned += upcomingBookings.length;

    for (const booking of upcomingBookings) {
      if (!booking.contact || booking.contact.doNotContact) continue;

      const existing = await this.prisma.client.autopilotTask.findFirst({
        where: {
          businessId,
          relatedType: 'BOOKING',
          relatedId: booking.id,
          category: 'BOOKING_PREP',
          status: { in: ['PENDING', 'IN_PROGRESS'] },
        },
      });
      if (existing) continue;

      result.itemsMatched++;

      const contactName = [booking.contact.firstName, booking.contact.lastName].filter(Boolean).join(' ') || 'Client';
      const startFormatted = new Date(booking.startTime).toLocaleString('en-TT', { timeZone: 'America/Port_of_Spain' });

      await this.prisma.client.autopilotTask.create({
        data: {
          businessId,
          title: `Prep reminder: ${contactName} — ${startFormatted}`,
          description: `Upcoming appointment for ${contactName} at ${startFormatted}. Send preparation details.`,
          category: 'BOOKING_PREP',
          priority: 'HIGH',
          autoExecutable: !requiresConfirm,
          requiresApproval: requiresConfirm,
          relatedType: 'BOOKING',
          relatedId: booking.id,
          aiContext: {
            loopType: 'booking_prep',
            contactId: booking.contact.id,
            contactName,
            bookingId: booking.id,
            startTime: booking.startTime.toISOString(),
            serviceName: (booking as any).serviceName || null,
          },
        },
      });

      result.actionsCreated++;
      result.results.push({ type: 'booking_prep', contactName, bookingId: booking.id, startTime: booking.startTime });
    }

    const followUpWindow = new Date(Date.now() - followUpDelayHours * 60 * 60 * 1000);
    const followUpCutoff = new Date(Date.now() - (followUpDelayHours + 6) * 60 * 60 * 1000);

    const completedBookings = await this.prisma.client.booking.findMany({
      where: {
        businessId,
        status: 'COMPLETED',
        endTime: { gte: followUpCutoff, lte: followUpWindow },
        deletedAt: null,
      },
      include: {
        contact: { select: { id: true, firstName: true, lastName: true, email: true, doNotContact: true } },
      },
      take: 30,
    });

    result.itemsScanned += completedBookings.length;

    for (const booking of completedBookings) {
      if (!booking.contact || booking.contact.doNotContact) continue;

      const existing = await this.prisma.client.autopilotTask.findFirst({
        where: {
          businessId,
          relatedType: 'BOOKING',
          relatedId: booking.id,
          category: 'BOOKING_FOLLOWUP',
        },
      });
      if (existing) continue;

      result.itemsMatched++;

      const contactName = [booking.contact.firstName, booking.contact.lastName].filter(Boolean).join(' ') || 'Client';

      await this.prisma.client.autopilotTask.create({
        data: {
          businessId,
          title: `Follow up: ${contactName} — session completed`,
          description: `${contactName}'s appointment has completed. Send a thank-you and feedback request.`,
          category: 'BOOKING_FOLLOWUP',
          priority: 'NORMAL',
          autoExecutable: !requiresConfirm,
          requiresApproval: requiresConfirm,
          relatedType: 'BOOKING',
          relatedId: booking.id,
          aiContext: {
            loopType: 'booking_prep',
            subType: 'follow_up',
            contactId: booking.contact.id,
            contactName,
            bookingId: booking.id,
          },
        },
      });

      result.actionsCreated++;
      result.results.push({ type: 'booking_followup', contactName, bookingId: booking.id });
    }
  }

  private async runWeeklyHygiene(
    businessId: string,
    config: Record<string, unknown>,
    result: { itemsScanned: number; itemsMatched: number; actionsCreated: number; actionsBlocked: number; results: unknown[] },
  ) {
    const archiveDraftsDays = (config.archiveDraftsDays as number) || 30;
    const summarizePatterns = (config.summarizePatterns as boolean) !== false;

    const draftCutoff = new Date();
    draftCutoff.setDate(draftCutoff.getDate() - archiveDraftsDays);

    const staleDrafts = await this.prisma.client.invoice.count({
      where: {
        businessId,
        status: 'DRAFT',
        updatedAt: { lt: draftCutoff },
        deletedAt: null,
      },
    });
    result.itemsScanned += staleDrafts;

    if (staleDrafts > 0) {
      result.itemsMatched++;
      await this.prisma.client.autopilotTask.create({
        data: {
          businessId,
          title: `Archive ${staleDrafts} stale draft invoice${staleDrafts > 1 ? 's' : ''}`,
          description: `${staleDrafts} draft invoice${staleDrafts > 1 ? 's haven\'t' : ' hasn\'t'} been updated in ${archiveDraftsDays}+ days. Review and archive or delete.`,
          category: 'WEEKLY_HYGIENE',
          priority: 'LOW',
          autoExecutable: false,
          requiresApproval: false,
          relatedType: 'SYSTEM',
          aiContext: { loopType: 'weekly_hygiene', subType: 'stale_drafts', count: staleDrafts },
        },
      });
      result.actionsCreated++;
      result.results.push({ type: 'stale_drafts', count: staleDrafts });
    }

    const staleTaskCount = await this.prisma.client.autopilotTask.count({
      where: {
        businessId,
        status: 'PENDING',
        createdAt: { lt: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) },
      },
    });
    result.itemsScanned += staleTaskCount;

    if (staleTaskCount > 0) {
      result.itemsMatched++;
      await this.prisma.client.autopilotTask.create({
        data: {
          businessId,
          title: `Review ${staleTaskCount} stale autopilot task${staleTaskCount > 1 ? 's' : ''}`,
          description: `${staleTaskCount} autopilot task${staleTaskCount > 1 ? 's have' : ' has'} been pending for 14+ days. Consider completing or skipping them.`,
          category: 'WEEKLY_HYGIENE',
          priority: 'LOW',
          autoExecutable: false,
          requiresApproval: false,
          relatedType: 'SYSTEM',
          aiContext: { loopType: 'weekly_hygiene', subType: 'stale_tasks', count: staleTaskCount },
        },
      });
      result.actionsCreated++;
      result.results.push({ type: 'stale_tasks', count: staleTaskCount });
    }

    if (summarizePatterns) {
      try {
        const patterns = await this.memory.summarizePatterns(businessId);
        if (patterns.length > 0) {
          result.results.push({ type: 'patterns_summarized', count: patterns.length });
        }
      } catch {
        this.logger.warn(`Pattern summarization failed for business ${businessId}`);
      }
    }
  }
}
