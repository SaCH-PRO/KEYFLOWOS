/**
 * KEY Proactive Engine Service — Phase 18D
 * Jarvis does not wait for commands.
 *
 * Scheduled intelligence: morning briefs, risk alerts, opportunity
 * alerts, missed task detection, revenue anomaly detection.
 * Connects to: Temporal Flow, Notifications, Command Center, KEY Inbox, Autonomy.
 */

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../core/prisma/prisma.service';
import { InvoiceStatus } from '@prisma/client';
import { KeyCortexContextService } from './key-cortex-context.service';
import {
  ProactiveTrigger,
  ProactiveTriggerType,
} from './cortex-genome-contracts';
import { CortexContextSnapshot } from './key-cortex.types';

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
  ) {}

  // ═══════════════════════════════════════════════════════════
  // Scheduled: Morning Brief (every day at 8 AM)
  // ═══════════════════════════════════════════════════════════

  @Cron(CronExpression.EVERY_DAY_AT_8AM)
  async generateMorningBriefs(): Promise<void> {
    this.logger.log('[morningBrief] Generating morning briefs...');

    const activeBusinesses = await this.getActiveBusinesses();
    for (const businessId of activeBusinesses) {
      try {
        const trigger = await this.createTrigger(
          businessId,
          'morning_brief',
          'medium',
        );
        this.logger.debug(`[morningBrief] created for business=${businessId}`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`[morningBrief] failed for ${businessId}: ${msg}`);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Scheduled: End of Day Report (every day at 6 PM)
  // ═══════════════════════════════════════════════════════════

  @Cron(CronExpression.EVERY_DAY_AT_6PM)
  async generateEndOfDayReports(): Promise<void> {
    this.logger.log('[endOfDay] Generating EOD reports...');

    const activeBusinesses = await this.getActiveBusinesses();
    for (const businessId of activeBusinesses) {
      try {
        await this.createTrigger(businessId, 'end_of_day_report', 'medium');
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
      triggers.push(await this.createTrigger(
        businessId, 'invoice_overdue', 'high',
        { count: signals.pendingInvoices },
      ));
    }

    if (signals.overdueTasks > 3) {
      triggers.push(await this.createTrigger(
        businessId, 'missed_task', 'high',
        { count: signals.overdueTasks },
      ));
    }

    // Revenue anomaly
    if (signals.anomalyScore > 70) {
      triggers.push(await this.createTrigger(
        businessId, 'revenue_anomaly', 'high',
        { score: signals.anomalyScore },
      ));
    }

    // Genome weakness
    if (signals.integrity < 40) {
      triggers.push(await this.createTrigger(
        businessId, 'genome_weakness', 'medium',
        { integrity: signals.integrity },
      ));
    }

    // Opportunity: unconverted leads
    if (signals.unconvertedLeads > 5) {
      triggers.push(await this.createTrigger(
        businessId, 'lead_dormant', 'medium',
        { count: signals.unconvertedLeads },
      ));
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
  // Private helpers
  // ═══════════════════════════════════════════════════════════

  private async getActiveBusinesses(): Promise<string[]> {
    // Get businesses active in last 7 days
    // In production: query Prisma for active subscriptions
    return ['demo-business']; // placeholder
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
