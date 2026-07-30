import { Injectable, Logger, Inject, Optional, OnModuleInit, OnModuleDestroy, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AiOversightService } from '../ai/ai-oversight.service';
import { AiMemoryService } from '../ai/ai-memory.service';
import { AiExecutionLogService } from '../ai/ai-execution-log.service';
import { TransactionalEmailService } from '../notifications/transactional-email.service';
import { ClientMomentumService } from '../momentum/client-momentum.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CrmTimelineService } from '../crm/crm-timeline.service';
import { CONTACT_EVENT } from '@keyflow/shared';

const MOMENTUM_SWEEP_HOUR = 6;

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

interface LoopRecord {
  id: string;
  businessId: string;
  loopType: string;
  config: Record<string, unknown> | null;
  intervalMin: number;
  riskTier: number;
}

interface ScanResult {
  itemsScanned: number;
  itemsMatched: number;
  actionsCreated: number;
  actionsBlocked: number;
  results: Array<Record<string, unknown>>;
}

const LOOP_DEFINITIONS: LoopDefinition[] = [
  {
    loopType: 'payment_recovery',
    name: 'Payment Recovery',
    description: 'Automatically follows up on overdue invoices with 3/7/14-day escalating cadence, marks invoices overdue, and creates recovery tasks.',
    riskTier: 2,
    defaultIntervalMin: 360,
    defaultConfig: { graceDays: 3, maxReminders: 3, escalateAfterDays: 14 },
  },
  {
    loopType: 'lead_reactivation',
    name: 'Lead Reactivation',
    description: 'Re-engages stale leads who haven\'t interacted in a configurable window, updates lifecycle stage, and creates outreach tasks.',
    riskTier: 2,
    defaultIntervalMin: 1440,
    defaultConfig: { staleDays: 30, maxPerRun: 10, excludeTags: ['do-not-contact'] },
  },
  {
    loopType: 'post_purchase',
    name: 'Post-Purchase Follow-up',
    description: 'Sends thank-you messages (2h), review requests (7d), and cross-sell prompts (14d) after completed purchases.',
    riskTier: 1,
    defaultIntervalMin: 720,
    defaultConfig: { thankYouDelayHours: 2, reviewRequestDelayDays: 7, crossSellDelayDays: 14 },
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
    description: 'Scans overdue items, stale leads, incomplete profiles, stale drafts, automation gaps, and summarizes weekly patterns.',
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
  private readonly momentumSweepTracker = new Map<string, string>();

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AiOversightService) private readonly governance: AiOversightService,
    @Inject(AiMemoryService) private readonly memory: AiMemoryService,
    @Inject(AiExecutionLogService) private readonly executionLog: AiExecutionLogService,
    @Inject(TransactionalEmailService) private readonly emailService: TransactionalEmailService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
    @Inject(CrmTimelineService) private readonly timeline: CrmTimelineService,
    @Optional() @Inject(ClientMomentumService) private readonly momentumService: ClientMomentumService | null,
  ) {}

  onModuleInit() {
    this.intervalRef = setInterval(() => {
      this.processDueLoops().catch(err =>
        this.logger.error(`Loop processing failed: ${(err as Error).message}`),
      );
      this.processMomentumSweeps().catch(err =>
        this.logger.error(`Momentum sweep check failed: ${(err as Error).message}`),
      );
    }, LOOP_CHECK_INTERVAL_MS);

    setTimeout(() => {
      this.processMomentumSweeps().catch(err =>
        this.logger.error(`Initial momentum sweep check failed: ${(err as Error).message}`),
      );
    }, 10_000);

    this.logger.log('Delegation loop scheduler started (5min check interval, includes momentum sweeps)');
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
    if (updates.config) data.config = { ...((loop.config as Record<string, unknown>) || {}), ...updates.config };
    if (typeof updates.intervalMin === 'number') data.intervalMin = updates.intervalMin;

    if (updates.enabled && !loop.nextRunAt) {
      data.nextRunAt = new Date(Date.now() + 60_000);
    }

    return this.prisma.client.delegationLoop.update({
      where: { id: loopId },
      data,
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

    return this.executeLoop({
      id: loop.id,
      businessId: loop.businessId,
      loopType: loop.loopType,
      config: loop.config as Record<string, unknown> | null,
      intervalMin: loop.intervalMin,
      riskTier: loop.riskTier,
    });
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
        await this.executeLoop({
          id: loop.id,
          businessId: loop.businessId,
          loopType: loop.loopType,
          config: loop.config as Record<string, unknown> | null,
          intervalMin: loop.intervalMin,
          riskTier: loop.riskTier,
        });
      } catch (err: any) {
        this.logger.error(`Loop ${loop.loopType} failed for business ${loop.businessId}: ${(err as Error).message}`);
      }
    }
  }

  private getLocalHourAndDate(tz: string): { hour: number; dateKey: string } {
    try {
      const now = new Date();
      const hourFormatter = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hour12: false });
      const dateFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
      return { hour: parseInt(hourFormatter.format(now), 10), dateKey: dateFormatter.format(now) };
    } catch {
      const now = new Date();
      return { hour: now.getHours(), dateKey: now.toISOString().split('T')[0] };
    }
  }

  private async processMomentumSweeps() {
    if (!this.momentumService) return;

    const businesses = await this.prisma.client.business.findMany({
      select: { id: true, timezone: true },
    });

    for (const business of businesses) {
      const tz = business.timezone || 'America/Port_of_Spain';
      const { hour: localHour, dateKey } = this.getLocalHourAndDate(tz);

      if (localHour !== MOMENTUM_SWEEP_HOUR) continue;

      const trackerKey = `${business.id}:${dateKey}`;
      if (this.momentumSweepTracker.has(trackerKey)) continue;

      this.momentumSweepTracker.set(trackerKey, 'running');

      try {
        this.logger.log(`[Autopilot] Running momentum sweep for business ${business.id} (tz: ${tz})`);
        const sweepResult = await this.momentumService.runDailySweep(business.id);
        this.momentumSweepTracker.set(trackerKey, 'done');
        this.logger.log(`[Autopilot] Momentum sweep complete for ${business.id}: ${sweepResult.contactsProcessed} contacts, ${sweepResult.recommendationsGenerated} recs`);
      } catch (err: any) {
        this.momentumSweepTracker.set(trackerKey, 'failed');
        this.logger.error(`[Autopilot] Momentum sweep failed for ${business.id}: ${(err as Error).message}`);
      }
    }

    const todayUtc = new Date().toISOString().split('T')[0];
    for (const [key] of this.momentumSweepTracker) {
      const parts = key.split(':');
      const keyDate = parts.slice(1).join(':');
      if (keyDate < todayUtc) {
        this.momentumSweepTracker.delete(key);
      }
    }
  }

  private async executeLoop(loop: LoopRecord) {
    const startTime = Date.now();
    const run = await this.prisma.client.delegationLoopRun.create({
      data: {
        loopId: loop.id,
        businessId: loop.businessId,
        status: 'running',
      },
    });

    const result: ScanResult = { itemsScanned: 0, itemsMatched: 0, actionsCreated: 0, actionsBlocked: 0, results: [] };

    try {
      const toolName = `delegation_${loop.loopType}`;
      const decision = await this.governance.evaluate(loop.businessId, toolName);

      this.events.emit('delegation_loop.started', {
        businessId: loop.businessId,
        loopType: loop.loopType,
        runId: run.id,
        governanceTier: decision.tier,
        allowed: decision.allowed,
      });

      if (!decision.allowed) {
        result.results.push({ blocked: true, reason: decision.reason });
        result.actionsBlocked++;

        this.events.emit('delegation_loop.blocked', {
          businessId: loop.businessId,
          loopType: loop.loopType,
          runId: run.id,
          reason: decision.reason,
          tier: decision.tier,
        });
      } else if (decision.requiresFormalApproval || decision.requiresAdminApproval) {
        await this.governance.createApprovalItem(loop.businessId, {
          toolName,
          title: `Run delegation loop: ${loop.loopType}`,
          description: `Autopilot wants to run the "${loop.loopType}" delegation loop. ${decision.reason}`,
          rationale: `Scheduled delegation loop execution (tier ${decision.tier})`,
          module: 'autopilot',
        });
        result.actionsBlocked++;
        result.results.push({ requiresApproval: true, tier: decision.tier, reason: decision.reason });

        this.events.emit('delegation_loop.approval_required', {
          businessId: loop.businessId,
          loopType: loop.loopType,
          runId: run.id,
          tier: decision.tier,
        });
      } else {
        const config = (loop.config || {}) as Record<string, unknown>;
        const requiresConfirm = !!decision.requiresQuickConfirm;

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
          results: result.results,
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

      this.events.emit('delegation_loop.completed', {
        businessId: loop.businessId,
        loopType: loop.loopType,
        runId: run.id,
        itemsScanned: result.itemsScanned,
        itemsMatched: result.itemsMatched,
        actionsCreated: result.actionsCreated,
        actionsBlocked: result.actionsBlocked,
      });

      const durationMs = Date.now() - startTime;

      await this.executionLog.log({
        businessId: loop.businessId,
        action: `delegation_loop.${loop.loopType}`,
        toolName: toolName,
        module: 'autopilot',
        riskTier: loop.riskTier,
        mode: 'autonomous',
        actor: 'system',
        rationale: `Scheduled delegation loop execution: ${loop.loopType}`,
        inputSummary: { loopId: loop.id, loopType: loop.loopType, config: loop.config },
        outputSummary: { runId: run.id, itemsScanned: result.itemsScanned, itemsMatched: result.itemsMatched, actionsCreated: result.actionsCreated, actionsBlocked: result.actionsBlocked },
        success: true,
        durationMs,
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

      await this.adaptGovernanceFromHistory(loop.businessId, loop.loopType).catch(() => {});

      return { runId: run.id, status: 'completed', itemsMatched: result.itemsMatched, actionsCreated: result.actionsCreated };
    } catch (err: any) {
      const durationMs = Date.now() - startTime;

      await this.prisma.client.delegationLoopRun.update({
        where: { id: run.id },
        data: {
          status: 'failed',
          completedAt: new Date(),
          error: (err as Error).message,
        },
      });

      await this.executionLog.log({
        businessId: loop.businessId,
        action: `delegation_loop.${loop.loopType}`,
        toolName: `delegation_${loop.loopType}`,
        module: 'autopilot',
        riskTier: loop.riskTier,
        mode: 'autonomous',
        actor: 'system',
        rationale: `Scheduled delegation loop execution: ${loop.loopType}`,
        inputSummary: { loopId: loop.id, loopType: loop.loopType },
        success: false,
        errorMessage: (err as Error).message,
        durationMs,
      }).catch(() => {});

      this.events.emit('delegation_loop.failed', {
        businessId: loop.businessId,
        loopType: loop.loopType,
        runId: run.id,
        error: (err as Error).message,
      });

      throw err;
    }
  }

  private async runPaymentRecovery(
    businessId: string,
    config: Record<string, unknown>,
    result: ScanResult,
    requiresConfirm: boolean,
  ) {
    const graceDays = (config.graceDays as number) || 3;
    const escalateAfterDays = (config.escalateAfterDays as number) || 14;
    const milestones = [graceDays, 7, escalateAfterDays];

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

      const currentMilestone = milestones.filter(m => daysPastDue >= m).pop();
      if (!currentMilestone) continue;

      const existingForMilestone = await this.prisma.client.autopilotTask.findFirst({
        where: {
          businessId,
          relatedType: 'INVOICE',
          relatedId: invoice.id,
          category: 'PAYMENT_RECOVERY',
          aiContext: { path: ['milestone'], equals: currentMilestone },
        },
      });
      if (existingForMilestone) continue;

      if (invoice.status === 'SENT' && daysPastDue >= graceDays) {
        await this.prisma.client.invoice.update({
          where: { id: invoice.id },
          data: { status: 'OVERDUE' },
        });

        this.events.emit('invoice.overdue', {
          businessId,
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          daysPastDue,
          source: 'delegation_loop',
        });
      }

      result.itemsMatched++;

      let cadenceLabel: string;
      let priority: string;
      if (currentMilestone >= escalateAfterDays) {
        cadenceLabel = `Final escalation (${escalateAfterDays}d)`;
        priority = 'URGENT';
      } else if (currentMilestone >= 7) {
        cadenceLabel = 'Second reminder (7d)';
        priority = 'HIGH';
      } else {
        cadenceLabel = `First reminder (${graceDays}d)`;
        priority = 'NORMAL';
      }

      const contactName = [invoice.contact.firstName, invoice.contact.lastName].filter(Boolean).join(' ') || 'Customer';
      const needsApproval = requiresConfirm || priority === 'URGENT';

      const task = await this.prisma.client.autopilotTask.create({
        data: {
          businessId,
          title: `Payment reminder: ${invoice.invoiceNumber} — TTD ${Number(invoice.total).toFixed(2)}`,
          description: `${cadenceLabel}: Invoice ${invoice.invoiceNumber} is ${daysPastDue} days overdue for ${contactName}. Total: TTD ${Number(invoice.total).toFixed(2)}. Re-send invoice with payment link.`,
          category: 'PAYMENT_RECOVERY',
          priority,
          autoExecutable: !needsApproval,
          requiresApproval: needsApproval,
          relatedType: 'INVOICE',
          relatedId: invoice.id,
          aiContext: {
            loopType: 'payment_recovery',
            cadence: cadenceLabel,
            milestone: currentMilestone,
            contactId: invoice.contact.id,
            contactName,
            contactEmail: invoice.contact.email,
            invoiceNumber: invoice.invoiceNumber,
            total: Number(invoice.total),
            daysPastDue,
            escalateAfterDays,
          },
        },
      });

      await this.timeline.logEvent(
        businessId,
        invoice.contact.id,
        CONTACT_EVENT.AUTOPILOT_PAYMENT_RECOVERY,
        { description: `${cadenceLabel} created for invoice ${invoice.invoiceNumber} (${daysPastDue} days overdue)`, taskId: task.id, invoiceId: invoice.id, daysPastDue, cadence: cadenceLabel, milestone: currentMilestone },
        { source: 'delegation_loop' },
      );

      this.events.emit('autopilot.task.created', {
        businessId,
        taskId: task.id,
        category: 'PAYMENT_RECOVERY',
        loopType: 'payment_recovery',
        relatedId: invoice.id,
        priority,
      });

      if (!needsApproval && invoice.contact.email) {
        try {
          const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:5000';
          const invoiceUrl = `${appUrl}/pay/${invoice.id}`;

          await this.emailService.send({
            businessId,
            type: 'invoice_sent',
            recipientEmail: invoice.contact.email,
            recipientName: contactName,
            contactId: invoice.contact.id,
            templateData: {
              invoiceNumber: invoice.invoiceNumber,
              total: Number(invoice.total).toFixed(2),
              currency: 'TTD',
              daysPastDue,
              cadence: cadenceLabel,
              isPaymentReminder: true,
              invoiceUrl,
            },
            dedupeKey: `payment_recovery_${invoice.id}_${currentMilestone}`,
          });

          await this.prisma.client.autopilotTask.update({
            where: { id: task.id },
            data: { status: 'AUTO_EXECUTED', executedAt: new Date(), executedBy: 'AI' },
          });

          this.events.emit('autopilot.task.auto_executed', {
            businessId,
            taskId: task.id,
            category: 'PAYMENT_RECOVERY',
            action: 'email_sent',
          });
        } catch (emailErr) {
          this.logger.warn(`Failed to auto-send payment reminder email for invoice ${invoice.invoiceNumber}: ${(emailErr as Error).message}`);
        }
      }

      result.actionsCreated++;
      result.results.push({
        type: 'payment_reminder',
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        contactName,
        daysPastDue,
        milestone: currentMilestone,
        cadence: cadenceLabel,
        priority,
        autoExecuted: !needsApproval && !!invoice.contact.email,
      });
    }
  }

  private async runLeadReactivation(
    businessId: string,
    config: Record<string, unknown>,
    result: ScanResult,
    requiresConfirm: boolean,
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
      select: { id: true, firstName: true, lastName: true, email: true, phone: true, updatedAt: true, leadScore: true, lifecycleStage: true },
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

      if (lead.lifecycleStage !== 'STALE' && lead.lifecycleStage !== 'LOST') {
        await this.prisma.client.contact.update({
          where: { id: lead.id },
          data: { lifecycleStage: 'STALE' },
        });

        this.events.emit('contact.lifecycle_updated', {
          businessId,
          contactId: lead.id,
          previousStage: lead.lifecycleStage,
          newStage: 'STALE',
          source: 'delegation_loop',
        });
      }

      const task = await this.prisma.client.autopilotTask.create({
        data: {
          businessId,
          title: `Re-engage: ${contactName}`,
          description: `${contactName} hasn't interacted in ${daysSince} days. Score: ${lead.leadScore ?? 'unscored'}. Send a personalized re-engagement message.`,
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
            contactEmail: lead.email,
            daysSinceLastActivity: daysSince,
            leadScore: lead.leadScore,
            hasEmail: !!lead.email,
            hasPhone: !!lead.phone,
            previousLifecycleStage: lead.lifecycleStage,
          },
        },
      });

      await this.timeline.logEvent(
        businessId,
        lead.id,
        CONTACT_EVENT.AUTOPILOT_LEAD_REACTIVATION,
        { description: `Re-engagement task created — ${daysSince} days inactive, score: ${lead.leadScore ?? 'unscored'}`, taskId: task.id, daysSince, leadScore: lead.leadScore },
        { source: 'delegation_loop' },
      );

      this.events.emit('autopilot.task.created', {
        businessId,
        taskId: task.id,
        category: 'LEAD_REACTIVATION',
        loopType: 'lead_reactivation',
        relatedId: lead.id,
      });

      result.actionsCreated++;
      created++;
      result.results.push({
        type: 'lead_reactivation',
        contactId: lead.id,
        contactName,
        daysSince,
        leadScore: lead.leadScore,
      });
    }
  }

  private async runPostPurchase(
    businessId: string,
    config: Record<string, unknown>,
    result: ScanResult,
    requiresConfirm: boolean,
  ) {
    const thankYouDelayHours = (config.thankYouDelayHours as number) || 2;
    const reviewRequestDelayDays = (config.reviewRequestDelayDays as number) || 7;
    const crossSellDelayDays = (config.crossSellDelayDays as number) || 14;

    const thankYouWindowStart = new Date(Date.now() - (thankYouDelayHours + 4) * 60 * 60 * 1000);
    const thankYouWindowEnd = new Date(Date.now() - thankYouDelayHours * 60 * 60 * 1000);

    const recentPaidForThankYou = await this.prisma.client.invoice.findMany({
      where: {
        businessId,
        status: 'PAID',
        paidAt: { gte: thankYouWindowStart, lt: thankYouWindowEnd },
        deletedAt: null,
      },
      include: {
        contact: { select: { id: true, firstName: true, lastName: true, email: true, doNotContact: true } },
      },
      take: 30,
    });

    result.itemsScanned += recentPaidForThankYou.length;

    for (const invoice of recentPaidForThankYou) {
      if (!invoice.contact || invoice.contact.doNotContact) continue;

      const existing = await this.prisma.client.autopilotTask.findFirst({
        where: {
          businessId,
          relatedType: 'INVOICE',
          relatedId: invoice.id,
          category: 'POST_PURCHASE',
          aiContext: { path: ['subType'], equals: 'thank_you' },
        },
      });
      if (existing) continue;

      result.itemsMatched++;
      const contactName = [invoice.contact.firstName, invoice.contact.lastName].filter(Boolean).join(' ') || 'Customer';

      const task = await this.prisma.client.autopilotTask.create({
        data: {
          businessId,
          title: `Thank-you: ${contactName}`,
          description: `${contactName} just paid invoice ${invoice.invoiceNumber} (TTD ${Number(invoice.total).toFixed(2)}). Send a personalized thank-you message.`,
          category: 'POST_PURCHASE',
          priority: 'NORMAL',
          autoExecutable: !requiresConfirm,
          requiresApproval: requiresConfirm,
          relatedType: 'INVOICE',
          relatedId: invoice.id,
          aiContext: {
            loopType: 'post_purchase',
            subType: 'thank_you',
            contactId: invoice.contact.id,
            contactName,
            invoiceNumber: invoice.invoiceNumber,
            paidAt: invoice.paidAt?.toISOString(),
            total: Number(invoice.total),
          },
        },
      });

      this.events.emit('autopilot.task.created', {
        businessId,
        taskId: task.id,
        category: 'POST_PURCHASE',
        loopType: 'post_purchase',
        subType: 'thank_you',
        relatedId: invoice.id,
      });

      result.actionsCreated++;
      result.results.push({ type: 'thank_you', contactName, invoiceId: invoice.id });
    }

    const reviewCutoffStart = new Date();
    reviewCutoffStart.setDate(reviewCutoffStart.getDate() - reviewRequestDelayDays - 1);
    const reviewCutoffEnd = new Date();
    reviewCutoffEnd.setDate(reviewCutoffEnd.getDate() - reviewRequestDelayDays);

    const reviewInvoices = await this.prisma.client.invoice.findMany({
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

    result.itemsScanned += reviewInvoices.length;

    for (const invoice of reviewInvoices) {
      if (!invoice.contact || invoice.contact.doNotContact) continue;

      const existing = await this.prisma.client.autopilotTask.findFirst({
        where: {
          businessId,
          relatedType: 'INVOICE',
          relatedId: invoice.id,
          category: 'POST_PURCHASE',
          aiContext: { path: ['subType'], equals: 'review_request' },
        },
      });
      if (existing) continue;

      result.itemsMatched++;
      const contactName = [invoice.contact.firstName, invoice.contact.lastName].filter(Boolean).join(' ') || 'Customer';

      const task = await this.prisma.client.autopilotTask.create({
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
            subType: 'review_request',
            contactId: invoice.contact.id,
            contactName,
            invoiceNumber: invoice.invoiceNumber,
            paidAt: invoice.paidAt?.toISOString(),
            total: Number(invoice.total),
          },
        },
      });

      this.events.emit('autopilot.task.created', {
        businessId,
        taskId: task.id,
        category: 'POST_PURCHASE',
        loopType: 'post_purchase',
        subType: 'review_request',
        relatedId: invoice.id,
      });

      result.actionsCreated++;
      result.results.push({ type: 'review_request', contactName, invoiceId: invoice.id });
    }

    const crossSellCutoffStart = new Date();
    crossSellCutoffStart.setDate(crossSellCutoffStart.getDate() - crossSellDelayDays - 1);
    const crossSellCutoffEnd = new Date();
    crossSellCutoffEnd.setDate(crossSellCutoffEnd.getDate() - crossSellDelayDays);

    const crossSellInvoices = await this.prisma.client.invoice.findMany({
      where: {
        businessId,
        status: 'PAID',
        paidAt: { gte: crossSellCutoffStart, lt: crossSellCutoffEnd },
        deletedAt: null,
      },
      include: {
        contact: { select: { id: true, firstName: true, lastName: true, email: true, doNotContact: true } },
      },
      take: 20,
    });

    result.itemsScanned += crossSellInvoices.length;

    for (const invoice of crossSellInvoices) {
      if (!invoice.contact || invoice.contact.doNotContact) continue;

      const existing = await this.prisma.client.autopilotTask.findFirst({
        where: {
          businessId,
          relatedType: 'INVOICE',
          relatedId: invoice.id,
          category: 'POST_PURCHASE',
          aiContext: { path: ['subType'], equals: 'cross_sell' },
        },
      });
      if (existing) continue;

      result.itemsMatched++;
      const contactName = [invoice.contact.firstName, invoice.contact.lastName].filter(Boolean).join(' ') || 'Customer';

      const task = await this.prisma.client.autopilotTask.create({
        data: {
          businessId,
          title: `Cross-sell: ${contactName}`,
          description: `${contactName} purchased ${crossSellDelayDays} days ago. Suggest complementary services or products based on their purchase history.`,
          category: 'POST_PURCHASE',
          priority: 'LOW',
          autoExecutable: !requiresConfirm,
          requiresApproval: requiresConfirm,
          relatedType: 'INVOICE',
          relatedId: invoice.id,
          aiContext: {
            loopType: 'post_purchase',
            subType: 'cross_sell',
            contactId: invoice.contact.id,
            contactName,
            invoiceNumber: invoice.invoiceNumber,
            paidAt: invoice.paidAt?.toISOString(),
            total: Number(invoice.total),
          },
        },
      });

      this.events.emit('autopilot.task.created', {
        businessId,
        taskId: task.id,
        category: 'POST_PURCHASE',
        loopType: 'post_purchase',
        subType: 'cross_sell',
        relatedId: invoice.id,
      });

      result.actionsCreated++;
      result.results.push({ type: 'cross_sell', contactName, invoiceId: invoice.id });
    }
  }

  private async runBookingPrep(
    businessId: string,
    config: Record<string, unknown>,
    result: ScanResult,
    requiresConfirm: boolean,
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
        service: { select: { name: true } },
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
      const serviceName = booking.service?.name || null;

      const task = await this.prisma.client.autopilotTask.create({
        data: {
          businessId,
          title: `Prep reminder: ${contactName} — ${startFormatted}`,
          description: `Upcoming ${serviceName ? serviceName + ' ' : ''}appointment for ${contactName} at ${startFormatted}. Send preparation details and confirmation.`,
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
            contactEmail: booking.contact.email,
            bookingId: booking.id,
            startTime: booking.startTime.toISOString(),
            serviceName,
          },
        },
      });

      this.events.emit('autopilot.task.created', {
        businessId,
        taskId: task.id,
        category: 'BOOKING_PREP',
        loopType: 'booking_prep',
        relatedId: booking.id,
      });

      result.actionsCreated++;
      result.results.push({ type: 'booking_prep', contactName, bookingId: booking.id, startTime: booking.startTime.toISOString() });
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
        service: { select: { name: true } },
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
      const serviceName = booking.service?.name || null;

      const task = await this.prisma.client.autopilotTask.create({
        data: {
          businessId,
          title: `Follow up: ${contactName} — session completed`,
          description: `${contactName}'s ${serviceName ? serviceName + ' ' : ''}appointment has completed. Send a thank-you and feedback request.`,
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
            contactEmail: booking.contact.email,
            bookingId: booking.id,
            serviceName,
          },
        },
      });

      this.events.emit('autopilot.task.created', {
        businessId,
        taskId: task.id,
        category: 'BOOKING_FOLLOWUP',
        loopType: 'booking_prep',
        subType: 'follow_up',
        relatedId: booking.id,
      });

      result.actionsCreated++;
      result.results.push({ type: 'booking_followup', contactName, bookingId: booking.id });
    }
  }

  private async runWeeklyHygiene(
    businessId: string,
    config: Record<string, unknown>,
    result: ScanResult,
  ) {
    const now = new Date();
    const ttNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/Port_of_Spain' }));
    if (ttNow.getDay() !== 1) {
      result.results.push({ type: 'skipped', reason: 'Weekly hygiene only runs on Mondays (Trinidad time)' });
      return;
    }

    const archiveDraftsDays = (config.archiveDraftsDays as number) || 30;
    const summarizePatterns = (config.summarizePatterns as boolean) !== false;

    const staleDrafts = await this.prisma.client.invoice.count({
      where: {
        businessId,
        status: 'DRAFT',
        updatedAt: { lt: new Date(Date.now() - archiveDraftsDays * 24 * 60 * 60 * 1000) },
        deletedAt: null,
      },
    });
    result.itemsScanned += staleDrafts;

    if (staleDrafts > 0) {
      result.itemsMatched++;
      const task = await this.prisma.client.autopilotTask.create({
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
      this.events.emit('autopilot.task.created', { businessId, taskId: task.id, category: 'WEEKLY_HYGIENE', loopType: 'weekly_hygiene', subType: 'stale_drafts' });
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
      const task = await this.prisma.client.autopilotTask.create({
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
      this.events.emit('autopilot.task.created', { businessId, taskId: task.id, category: 'WEEKLY_HYGIENE', loopType: 'weekly_hygiene', subType: 'stale_tasks' });
      result.actionsCreated++;
      result.results.push({ type: 'stale_tasks', count: staleTaskCount });
    }

    const overdueInvoiceCount = await this.prisma.client.invoice.count({
      where: {
        businessId,
        status: 'OVERDUE',
        deletedAt: null,
      },
    });
    result.itemsScanned += overdueInvoiceCount;

    if (overdueInvoiceCount > 0) {
      result.itemsMatched++;
      const task = await this.prisma.client.autopilotTask.create({
        data: {
          businessId,
          title: `${overdueInvoiceCount} overdue invoice${overdueInvoiceCount > 1 ? 's' : ''} need attention`,
          description: `You have ${overdueInvoiceCount} overdue invoice${overdueInvoiceCount > 1 ? 's' : ''}. Review and follow up or enable Payment Recovery loop.`,
          category: 'WEEKLY_HYGIENE',
          priority: 'NORMAL',
          autoExecutable: false,
          requiresApproval: false,
          relatedType: 'SYSTEM',
          aiContext: { loopType: 'weekly_hygiene', subType: 'overdue_invoices', count: overdueInvoiceCount },
        },
      });
      this.events.emit('autopilot.task.created', { businessId, taskId: task.id, category: 'WEEKLY_HYGIENE', loopType: 'weekly_hygiene', subType: 'overdue_invoices' });
      result.actionsCreated++;
      result.results.push({ type: 'overdue_invoices', count: overdueInvoiceCount });
    }

    const staleLeadCount = await this.prisma.client.contact.count({
      where: {
        businessId,
        status: 'LEAD',
        deletedAt: null,
        updatedAt: { lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      },
    });
    result.itemsScanned += staleLeadCount;

    if (staleLeadCount > 0) {
      result.itemsMatched++;
      const task = await this.prisma.client.autopilotTask.create({
        data: {
          businessId,
          title: `${staleLeadCount} stale lead${staleLeadCount > 1 ? 's' : ''} detected`,
          description: `${staleLeadCount} lead${staleLeadCount > 1 ? 's have' : ' has'} gone 30+ days without interaction. Enable Lead Reactivation loop or manually review.`,
          category: 'WEEKLY_HYGIENE',
          priority: 'NORMAL',
          autoExecutable: false,
          requiresApproval: false,
          relatedType: 'SYSTEM',
          aiContext: { loopType: 'weekly_hygiene', subType: 'stale_leads', count: staleLeadCount },
        },
      });
      this.events.emit('autopilot.task.created', { businessId, taskId: task.id, category: 'WEEKLY_HYGIENE', loopType: 'weekly_hygiene', subType: 'stale_leads' });
      result.actionsCreated++;
      result.results.push({ type: 'stale_leads', count: staleLeadCount });
    }

    const incompleteProfileCount = await this.prisma.client.contact.count({
      where: {
        businessId,
        deletedAt: null,
        OR: [
          { email: null },
          { email: '' },
          { phone: null },
          { phone: '' },
        ],
      },
    });
    result.itemsScanned += incompleteProfileCount;

    if (incompleteProfileCount >= 5) {
      result.itemsMatched++;
      const task = await this.prisma.client.autopilotTask.create({
        data: {
          businessId,
          title: `${incompleteProfileCount} contact${incompleteProfileCount > 1 ? 's' : ''} with incomplete profiles`,
          description: `${incompleteProfileCount} contact${incompleteProfileCount > 1 ? 's are' : ' is'} missing email or phone. Complete their profiles to improve communication reach.`,
          category: 'WEEKLY_HYGIENE',
          priority: 'LOW',
          autoExecutable: false,
          requiresApproval: false,
          relatedType: 'SYSTEM',
          aiContext: { loopType: 'weekly_hygiene', subType: 'incomplete_profiles', count: incompleteProfileCount },
        },
      });
      this.events.emit('autopilot.task.created', { businessId, taskId: task.id, category: 'WEEKLY_HYGIENE', loopType: 'weekly_hygiene', subType: 'incomplete_profiles' });
      result.actionsCreated++;
      result.results.push({ type: 'incomplete_profiles', count: incompleteProfileCount });
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

  private async adaptGovernanceFromHistory(businessId: string, loopType: string) {
    const recentTasks = await this.prisma.client.autopilotTask.findMany({
      where: {
        businessId,
        aiContext: { path: ['loopType'], equals: loopType },
        status: { in: ['COMPLETED', 'AUTO_EXECUTED', 'SKIPPED', 'REJECTED'] },
        updatedAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      },
      select: { status: true },
      take: 100,
    });

    if (recentTasks.length < 10) return;

    const approved = recentTasks.filter((t: { status: string }) => t.status === 'COMPLETED' || t.status === 'AUTO_EXECUTED').length;
    const rejected = recentTasks.filter((t: { status: string }) => t.status === 'REJECTED' || t.status === 'SKIPPED').length;
    const total = approved + rejected;
    if (total === 0) return;

    const approvalRate = approved / total;
    const toolName = `delegation_${loopType}`;
    const currentSettings = await this.governance.getAutonomySettings(businessId);

    if (approvalRate >= 0.9 && total >= 15) {
      const currentToolTier = this.governance.getToolTier(toolName);
      if (currentToolTier > currentSettings.maxAutoTier && currentToolTier <= 2) {
        await this.governance.updateAutonomySettings(businessId, {
          maxAutoTier: currentToolTier as 1 | 2 | 3,
        });
        this.logger.log(`Governance auto-promoted maxAutoTier to ${currentToolTier} for business ${businessId} based on ${loopType} approval rate`);
      }

      await this.memory.upsert(businessId, {
        category: 'patterns',
        key: `${toolName}_trust_signal`,
        value: `Loop "${loopType}" has a ${Math.round(approvalRate * 100)}% approval rate over ${total} actions. Auto-execute tier promoted.`,
        confidence: Math.min(approvalRate, 0.95),
        source: 'pattern_analysis',
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });

      this.events.emit('delegation_loop.trust_elevated', {
        businessId,
        loopType,
        approvalRate,
        totalActions: total,
        recommendation: 'promote_to_auto',
        tierAdjusted: true,
      });

      this.logger.log(`Loop ${loopType} trust elevated for business ${businessId}: ${Math.round(approvalRate * 100)}% approval over ${total} actions`);
    } else if (approvalRate < 0.5 && total >= 10) {
      if (currentSettings.maxAutoTier > 1) {
        const demotedTier = Math.max(1, currentSettings.maxAutoTier - 1) as 1 | 2 | 3;
        await this.governance.updateAutonomySettings(businessId, {
          maxAutoTier: demotedTier,
        });
        this.logger.log(`Governance auto-demoted maxAutoTier to ${demotedTier} for business ${businessId} based on ${loopType} rejection rate`);
      }

      await this.memory.upsert(businessId, {
        category: 'patterns',
        key: `${toolName}_distrust_signal`,
        value: `Loop "${loopType}" has a ${Math.round(approvalRate * 100)}% approval rate over ${total} actions. Auto-execute tier demoted.`,
        confidence: Math.min(1 - approvalRate, 0.9),
        source: 'pattern_analysis',
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });

      this.events.emit('delegation_loop.trust_degraded', {
        businessId,
        loopType,
        approvalRate,
        totalActions: total,
        recommendation: 'require_approval',
        tierAdjusted: true,
      });

      this.logger.log(`Loop ${loopType} trust degraded for business ${businessId}: ${Math.round(approvalRate * 100)}% approval over ${total} actions`);
    }
  }
}
