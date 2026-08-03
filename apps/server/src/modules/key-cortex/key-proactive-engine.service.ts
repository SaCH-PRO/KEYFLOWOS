/**
 * KEY Proactive Engine Service — Phase 18D
 * Jarvis does not wait for commands.
 *
 * Scheduled intelligence: morning briefs, risk alerts, opportunity
 * alerts, missed task detection, revenue anomaly detection.
 * Connects to: Temporal Flow, Notifications, Command Center, KEY Inbox, Autonomy.
 */

import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../core/prisma/prisma.service';
import { InvoiceStatus } from '@prisma/client';
import { KeyCortexContextService } from './key-cortex-context.service';
import {
  ProactiveTrigger,
  ProactiveTriggerType,
} from './cortex-genome-contracts';
import { CortexContextSnapshot } from './key-cortex.types';
import { GenomeSignalService } from '../business-genome/key-genome/genome-signal.service';
import type { CreateGenomeSignalInput } from '../business-genome/key-genome/key-genome.types';
import {
  InvoiceOverdueWatcherService,
  BookingNoShowWatcherService,
  SentimentWatcherService,
} from './watchers';
import { KeyCortexDigestService } from './key-cortex-digest.service';
import { KeyCortexCircadianService } from './key-cortex-circadian.service';

interface SignalSummary {
  dnaTrend: 'improving' | 'stable' | 'declining';
  integrity: number; // 0-100
  autonomyTier: string;
  pendingInvoices: number;
  overdueTasks: number;
  unconvertedLeads: number;
  recentRevenue: number;
  anomalyScore: number; // 0-100, higher = more anomalous
}

@Injectable()
export class KeyProactiveEngineService {
  private readonly logger = new Logger(KeyProactiveEngineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly context: KeyCortexContextService,
    @Optional() private readonly signalService?: GenomeSignalService,
    @Optional() private readonly invoiceWatcher?: InvoiceOverdueWatcherService,
    @Optional() private readonly bookingWatcher?: BookingNoShowWatcherService,
    @Optional() private readonly sentimentWatcher?: SentimentWatcherService,
    @Optional() private readonly digestService?: KeyCortexDigestService,
    @Optional() private readonly circadian?: KeyCortexCircadianService,
  ) {}

  // ═══════════════════════════════════════════════════════════
  // Scheduled: Morning Brief (every day at 8 AM)
  // ═══════════════════════════════════════════════════════════

  /**
   * Hourly, acting on the businesses for which it is locally 8AM.
   *
   * This was `EVERY_DAY_AT_8AM`, which is 8AM on the SERVER. Business.timezone
   * has existed all along, defaulting to America/Port_of_Spain, and nothing
   * scheduling a rhythm read it — so on a UTC host the "morning" briefing
   * arrived at 4am local. Not an error, just KEY not knowing what time it is
   * where you are.
   *
   * The hour advances once per hour in every timezone, so each business still
   * matches exactly once per day. No scheduling state to keep.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async generateMorningBriefs(): Promise<void> {
    const due = this.circadian ? await this.circadian.businessesAtLocalHour(8) : [];
    if (this.circadian && due.length === 0) return;

    this.logger.log(`[morningBrief] Generating morning briefs for ${due.length} business(es)...`);

    try {
      await this.invoiceWatcher?.scanAll();
      await this.sentimentWatcher?.scanAll();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[morningBrief] watcher scan failed: ${msg}`);
    }

    // Without the circadian clock this degrades to the previous behaviour
    // rather than silently briefing nobody.
    const activeBusinesses = this.circadian
      ? due.map((b) => b.id)
      : await this.getActiveBusinesses();
    for (const businessId of activeBusinesses) {
      try {
        const trigger = await this.createTrigger(
          businessId,
          'morning_brief',
          'medium',
        );
        this.logger.debug(`[morningBrief] created for business=${businessId}`);
        await this.digestService?.deliverDailyDigest(businessId, 'email');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`[morningBrief] failed for ${businessId}: ${msg}`);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Scheduled: Weekly Report (every Monday at 9 AM)
  // ═══════════════════════════════════════════════════════════

  /** Hourly; acts where it is locally Monday 9AM. */
  @Cron(CronExpression.EVERY_HOUR)
  async generateWeeklyDigests(): Promise<void> {
    const due = this.circadian ? await this.circadian.businessesAtLocalTime(9, 1) : [];
    if (this.circadian && due.length === 0) return;

    this.logger.log(`[weeklyDigest] Generating weekly digests for ${due.length} business(es)...`);

    const activeBusinesses = this.circadian
      ? due.map((b) => b.id)
      : await this.getActiveBusinesses();
    for (const businessId of activeBusinesses) {
      try {
        await this.digestService?.deliverWeeklyDigest(businessId, 'email');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`[weeklyDigest] failed for ${businessId}: ${msg}`);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Scheduled: End of Day Report (every day at 6 PM)
  // ═══════════════════════════════════════════════════════════

  /** Hourly; acts where it is locally 6PM. */
  @Cron(CronExpression.EVERY_HOUR)
  async generateEndOfDayReports(): Promise<void> {
    const dueEod = this.circadian ? await this.circadian.businessesAtLocalHour(18) : [];
    if (this.circadian && dueEod.length === 0) return;

    this.logger.log('[endOfDay] Generating EOD reports...');

    try {
      await this.bookingWatcher?.scanAll();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[endOfDay] watcher scan failed: ${msg}`);
    }

    const activeBusinesses = this.circadian
      ? dueEod.map((b) => b.id)
      : await this.getActiveBusinesses();
    for (const businessId of activeBusinesses) {
      try {
        await this.createTrigger(businessId, 'end_of_day_report', 'medium');
        await this.digestService?.deliverDailyDigest(businessId, 'email');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`[endOfDay] failed for ${businessId}: ${msg}`);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Scheduled: Signal Monitor (every 15 minutes)
  // ═══════════════════════════════════════════════════════════

  @Cron('*/15 * * * *')
  async evaluateProactiveActions(): Promise<ProactiveTrigger[]> {
    this.logger.debug('[proactive] Evaluating signals...');

    const activeBusinesses = await this.getActiveBusinesses();
    const allTriggers: ProactiveTrigger[] = [];

    for (const businessId of activeBusinesses) {
      try {
        const signals = await this.gatherSignals(businessId);
        const triggers = await this.decideActions(businessId, signals);
        allTriggers.push(...triggers);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`[proactive] failed for ${businessId}: ${msg}`);
      }
    }

    if (allTriggers.length > 0) {
      this.logger.log(`[proactive] ${allTriggers.length} triggers created`);
    }

    try {
      await Promise.all([
        this.invoiceWatcher?.scanAll(),
        this.sentimentWatcher?.scanAll(),
        this.bookingWatcher?.scanAll(),
      ]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[proactive] watcher scan failed: ${msg}`);
    }

    return allTriggers;
  }

  // ═══════════════════════════════════════════════════════════
  // Signal Gathering
  // ═══════════════════════════════════════════════════════════

  async gatherSignals(businessId: string): Promise<SignalSummary> {
    const context = await this.context.buildContextSnapshot(businessId);

    const [overdueTasks, unconvertedLeads, recentRevenue] = await Promise.all([
      this.countOverdueTasks(businessId),
      this.countUnconvertedLeads(businessId),
      this.getRecentRevenue(businessId),
    ]);

    const dnaValues = Object.values(context.genomeDna);
    const avgDna = dnaValues.reduce((s, v) => s + v, 0) / (dnaValues.length || 1);

    return {
      dnaTrend: this.calculateDnaTrend(context.genomeDna),
      integrity: Math.round(avgDna),
      autonomyTier: this.mapReadinessToTier(context.executiveReadiness),
      pendingInvoices: context.pendingInvoices,
      overdueTasks,
      unconvertedLeads,
      recentRevenue,
      anomalyScore: this.calculateAnomaly(context, recentRevenue),
    };
  }

  // ═══════════════════════════════════════════════════════════
  // Decision Engine
  // ═══════════════════════════════════════════════════════════

  private async decideActions(
    businessId: string,
    signals: SignalSummary,
  ): Promise<ProactiveTrigger[]> {
    const triggers: ProactiveTrigger[] = [];

    // Risk alerts
    if (signals.pendingInvoices > 5) {
      const trigger = await this.createTrigger(
        businessId, 'invoice_overdue', 'high',
        { count: signals.pendingInvoices },
      );
      triggers.push(trigger);
      await this.persistSignal(trigger, signals);
    }

    if (signals.overdueTasks > 3) {
      const trigger = await this.createTrigger(
        businessId, 'missed_task', 'high',
        { count: signals.overdueTasks },
      );
      triggers.push(trigger);
      await this.persistSignal(trigger, signals);
    }

    // Revenue anomaly
    if (signals.anomalyScore > 70) {
      const trigger = await this.createTrigger(
        businessId, 'revenue_anomaly', 'high',
        { score: signals.anomalyScore },
      );
      triggers.push(trigger);
      await this.persistSignal(trigger, signals);
    }

    // Genome weakness
    if (signals.integrity < 40) {
      const trigger = await this.createTrigger(
        businessId, 'genome_weakness', 'medium',
        { integrity: signals.integrity },
      );
      triggers.push(trigger);
      await this.persistSignal(trigger, signals);
    }

    // Opportunity: unconverted leads
    if (signals.unconvertedLeads > 5) {
      const trigger = await this.createTrigger(
        businessId, 'lead_dormant', 'medium',
        { count: signals.unconvertedLeads },
      );
      triggers.push(trigger);
      await this.persistSignal(trigger, signals);
    }

    return triggers;
  }

  // ═══════════════════════════════════════════════════════════
  // Trigger Creation
  // ═══════════════════════════════════════════════════════════

  private async createTrigger(
    businessId: string,
    type: ProactiveTriggerType,
    priority: 'low' | 'medium' | 'high' | 'urgent',
    data?: Record<string, unknown>,
  ): Promise<ProactiveTrigger> {
    const trigger: ProactiveTrigger = {
      id: `trig_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      type,
      businessId,
      scheduledAt: new Date(),
      priority,
      data: data ?? {},
    };

    // Store in Prisma for delivery pipeline
    // In production: write to notification queue
    this.logger.debug(`[trigger] ${type} [${priority}] for ${businessId}`);

    return trigger;
  }

  // ═══════════════════════════════════════════════════════════
  // Genome Signal Persistence
  // ═══════════════════════════════════════════════════════════

  private async persistSignal(
    trigger: ProactiveTrigger,
    signals: SignalSummary,
  ): Promise<void> {
    if (!this.signalService) {
      return;
    }

    const input = this.buildGenomeSignalInput(trigger, signals);
    if (!input) {
      return;
    }

    try {
      await this.signalService.createSignal(input);
      this.logger.debug(
        `[persistSignal] Created genome signal for ${trigger.type} (${trigger.businessId})`,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `[persistSignal] Failed to create genome signal for ${trigger.type}: ${msg}`,
      );
    }
  }

  private buildGenomeSignalInput(
    trigger: ProactiveTrigger,
    signals: SignalSummary,
  ): CreateGenomeSignalInput | null {
    const base: Omit<CreateGenomeSignalInput, 'section' | 'domain' | 'signalType' | 'reason'> = {
      businessId: trigger.businessId,
      sourceModule: 'key_autonomy',
      sourceEntityType: 'PROACTIVE_TRIGGER',
      sourceEntityId: trigger.id,
      proposedValue: trigger.data,
      confidence: this.mapPriorityToConfidence(trigger.priority),
      evidence: [
        {
          sourceModule: 'key_autonomy',
          sourceEntityType: 'PROACTIVE_TRIGGER',
          sourceEntityId: trigger.id,
          summary: `Proactive scan detected ${trigger.type}`,
          evidenceStrength: this.mapPriorityToConfidence(trigger.priority),
          occurredAt: new Date().toISOString(),
        },
      ],
    };

    switch (trigger.type) {
      case 'invoice_overdue':
        return {
          ...base,
          section: 'FINANCE',
          domain: 'cashflow',
          signalType: 'RISK_PATTERN',
          reason: `${signals.pendingInvoices} pending/overdue invoices require attention`,
        };
      case 'missed_task':
        return {
          ...base,
          section: 'OPERATIONS',
          domain: 'tasks',
          signalType: 'OPERATIONS_PATTERN',
          reason: `${signals.overdueTasks} overdue tasks detected`,
        };
      case 'revenue_anomaly':
        return {
          ...base,
          section: 'FINANCE',
          domain: 'revenue',
          signalType: 'REVENUE_PATTERN',
          reason: `Revenue anomaly score ${signals.anomalyScore} / 100`,
        };
      case 'genome_weakness':
        return {
          ...base,
          section: 'GENOME',
          domain: 'integrity',
          signalType: 'READINESS_BLOCKER',
          reason: `Genome integrity is low (${signals.integrity} / 100)`,
        };
      case 'lead_dormant':
        return {
          ...base,
          section: 'SALES',
          domain: 'leads',
          signalType: 'CUSTOMER_PATTERN',
          reason: `${signals.unconvertedLeads} dormant leads identified`,
        };
      default:
        return null;
    }
  }

  private mapPriorityToConfidence(
    priority: ProactiveTrigger['priority'],
  ): number {
    switch (priority) {
      case 'urgent':
        return 0.95;
      case 'high':
        return 0.85;
      case 'medium':
        return 0.7;
      case 'low':
      default:
        return 0.55;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Private helpers
  // ═══════════════════════════════════════════════════════════

  private async getActiveBusinesses(): Promise<string[]> {
    // Active businesses = autopilot enabled AND (active subscription OR recent Cortex/AI activity).
    // We cap at 500 per scan to avoid saturating the scheduler.
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    try {
      const businesses = await this.prisma.client.business.findMany({
        where: {
          autopilotEnabled: true,
          OR: [
            {
              subscriptions: {
                some: {
                  status: { in: ['ACTIVE', 'TRIALING'] },
                },
              },
            },
            {
              cortexSessions: {
                some: {
                  updatedAt: { gte: sevenDaysAgo },
                },
              },
            },
            {
              aiUsageLogs: {
                some: {
                  createdAt: { gte: sevenDaysAgo },
                },
              },
            },
          ],
        },
        select: { id: true },
        take: 500,
        distinct: ['id'],
      });

      return businesses.map((b) => b.id);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[getActiveBusinesses] Failed to query active businesses: ${msg}`);
      return [];
    }
  }

  private async countOverdueTasks(businessId: string): Promise<number> {
    try {
      return this.prisma.client.task.count({
        where: {
          businessId,
          status: { in: ['todo', 'in_progress'] },
          dueDate: { lt: new Date() },
        },
      });
    } catch {
      return 0;
    }
  }

  private async countUnconvertedLeads(businessId: string): Promise<number> {
    try {
      return this.prisma.client.lead.count({
        where: {
          businessId,
          status: { in: ['new', 'contacted'] },
          updatedAt: { lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
        },
      });
    } catch {
      return 0;
    }
  }

  private async getRecentRevenue(businessId: string): Promise<number> {
    try {
      const result = await this.prisma.client.invoice.aggregate({
        where: {
          businessId,
          status: InvoiceStatus.PAID,
          createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
        },
        _sum: { total: true },
      });
      return result._sum?.total ?? 0;
    } catch {
      return 0;
    }
  }

  private calculateDnaTrend(dna: Record<string, number>): 'improving' | 'stable' | 'declining' {
    const values = Object.values(dna);
    if (values.length < 2) return 'stable';
    const avg = values.reduce((s, v) => s + v, 0) / values.length;
    if (avg > 65) return 'improving';
    if (avg < 35) return 'declining';
    return 'stable';
  }

  private mapReadinessToTier(readiness: number): string {
    if (readiness >= 80) return 'full';
    if (readiness >= 50) return 'semi';
    if (readiness >= 20) return 'assisted';
    return 'none';
  }

  private calculateAnomaly(
    context: CortexContextSnapshot,
    _recentRevenue: number,
  ): number {
    // Simple anomaly: high pending invoices + low readiness = anomaly
    const base = context.pendingInvoices * 10;
    const readinessPenalty = (100 - context.executiveReadiness) * 0.5;
    return Math.min(100, Math.round(base + readinessPenalty));
  }
}
