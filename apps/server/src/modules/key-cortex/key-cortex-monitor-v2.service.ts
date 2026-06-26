// ============================================================
// KEY Cortex — Monitor Integration v2
// Connects KEY to the Autopilot/Delegation-Loop system.
// KEY can create, modify, monitor, and report on autonomous
// delegation loops that run background business operations.
// ============================================================

import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../core/prisma/prisma.service';
import { DelegationLoopService } from '../autopilot/delegation-loop.service';
import { AutopilotService } from '../autopilot/autopilot.service';

// ─────────────────────────────────────────────────────────────
// Monitor DTOs / Return Types
// ─────────────────────────────────────────────────────────────

export interface MonitorInfo {
  id: string;
  loopType: string;
  name: string;
  description: string;
  enabled: boolean;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
  intervalMin: number;
  riskTier: number;
  stats: {
    totalRuns: number;
    totalActionsCreated: number;
    totalItemsMatched: number;
  } | null;
  recentRunStatus: string | null;
}

export interface MonitorStatus {
  id: string;
  loopType: string;
  name: string;
  enabled: boolean;
  config: Record<string, unknown> | null;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
  intervalMin: number;
  riskTier: number;
  stats: Record<string, unknown> | null;
  recentRuns: MonitorRunInfo[];
  currentAlerts: MonitorAlert[];
}

export interface MonitorRunInfo {
  id: string;
  status: string;
  startedAt: Date;
  completedAt: Date | null;
  itemsScanned: number;
  itemsMatched: number;
  actionsCreated: number;
  actionsBlocked: number;
  error: string | null;
}

export interface MonitorAlert {
  id: string;
  type: string;
  severity: 'CRITICAL' | 'WARNING' | 'INFO';
  message: string;
  action?: string;
  createdAt: Date;
  resolved: boolean;
}

export interface MonitorConfigInput {
  loopType: string;
  intervalMin?: number;
  config?: Record<string, unknown>;
  enabled?: boolean;
}

export interface MonitorReport {
  businessId: string;
  generatedAt: Date;
  summary: {
    totalMonitors: number;
    activeMonitors: number;
    pausedMonitors: number;
    totalRunsThisWeek: number;
    totalActionsCreated: number;
    automationRate: number;
  };
  monitors: MonitorInfo[];
  recentAlerts: MonitorAlert[];
  effectiveness: {
    mostEffectiveLoop: string | null;
    leastEffectiveLoop: string | null;
    avgActionsPerRun: number;
    approvalRequiredRate: number;
  };
  recommendations: string[];
}

// ─────────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────────

@Injectable()
export class KeyCortexMonitorV2Service {
  private readonly logger = new Logger(KeyCortexMonitorV2Service.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly delegationLoop: DelegationLoopService,
    private readonly autopilot: AutopilotService,
    private readonly events: EventEmitter2,
  ) {}

  // ── 1. Get Active Monitors ────────────────────────────────

  /**
   * Return all delegation loops for a business with their status,
   * run statistics, and recent activity.
   */
  async getActiveMonitors(businessId: string): Promise<MonitorInfo[]> {
    this.logger.log(`[getActiveMonitors] business=${businessId}`);

    try {
      const loops = await this.delegationLoop.getLoops(businessId);

      return loops.map((loop: any) => {
        const stats = loop.stats as Record<string, number> | null;
        const lastRun = loop.runs?.[0] as
          | { status: string; startedAt: Date }
          | undefined;

        return {
          id: loop.id,
          loopType: loop.loopType,
          name: loop.name || loop.loopType,
          description: loop.description || '',
          enabled: loop.enabled ?? false,
          lastRunAt: loop.lastRunAt,
          nextRunAt: loop.nextRunAt,
          intervalMin: loop.intervalMin,
          riskTier: loop.riskTier,
          stats: stats
            ? {
                totalRuns: stats.totalRuns ?? 0,
                totalActionsCreated: stats.totalActionsCreated ?? 0,
                totalItemsMatched: stats.totalItemsMatched ?? 0,
              }
            : null,
          recentRunStatus: lastRun?.status ?? null,
        };
      });
    } catch (error: any) {
      this.logger.error(
        `[getActiveMonitors] Failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  // ── 2. Create Monitor ─────────────────────────────────────

  /**
   * Parse a natural-language description into a delegation-loop
   * configuration and create the loop entry.
   *
   * Example description:
   *   "Monitor overdue invoices every 6 hours and escalate
   *    after 14 days with 3 reminders."
   */
  async createMonitor(
    businessId: string,
    description: string,
    config: MonitorConfigInput,
  ): Promise<MonitorInfo> {
    this.logger.log(
      `[createMonitor] business=${businessId} type=${config.loopType}`,
    );

    // Validate the loop type against known definitions
    const definitions = this.delegationLoop.getLoopDefinitions();
    const def = definitions.find((d) => d.loopType === config.loopType);
    if (!def) {
      const validTypes = definitions.map((d) => d.loopType).join(', ');
      throw new NotFoundException(
        `Unknown loop type "${config.loopType}". Valid types: ${validTypes}`,
      );
    }

    // Merge user config with defaults
    const mergedConfig = {
      ...def.defaultConfig,
      ...(config.config || {}),
      _description: description,
      _createdBy: 'key_cortex',
    };

    const intervalMin = config.intervalMin ?? def.defaultIntervalMin;

    // Persist via Prisma directly — the DelegationLoopService will pick
    // it up on the next check cycle.
    const loop = await (this.prisma.client as any).delegationLoop.create({
      data: {
        businessId,
        loopType: config.loopType,
        name: def.name,
        description: `${description}\n\n[Auto-generated by KEY Cortex]`,
        riskTier: def.riskTier,
        intervalMin,
        config: mergedConfig,
        enabled: config.enabled ?? false,
      },
    });

    this.events.emit('cortex.monitor.created', {
      businessId,
      monitorId: loop.id,
      loopType: config.loopType,
      source: 'key_cortex',
    });

    this.logger.log(`[createMonitor] Created monitor id=${loop.id}`);

    return {
      id: loop.id,
      loopType: loop.loopType,
      name: loop.name,
      description: loop.description || '',
      enabled: loop.enabled ?? false,
      lastRunAt: null,
      nextRunAt: null,
      intervalMin: loop.intervalMin,
      riskTier: loop.riskTier,
      stats: null,
      recentRunStatus: null,
    };
  }

  // ── 3. Update Monitor ─────────────────────────────────────

  /**
   * Update an existing monitor's configuration.
   * Validates the change set and persists the update.
   */
  async updateMonitor(
    businessId: string,
    monitorId: string,
    updates: {
      description?: string;
      intervalMin?: number;
      config?: Record<string, unknown>;
    },
  ): Promise<MonitorInfo> {
    this.logger.log(`[updateMonitor] business=${businessId} monitor=${monitorId}`);

    // Verify ownership
    const existing = await (this.prisma.client as any).delegationLoop.findFirst({
      where: { id: monitorId, businessId },
    });
    if (!existing) {
      throw new NotFoundException('Monitor not found');
    }

    // Validate interval
    if (
      updates.intervalMin !== undefined &&
      (updates.intervalMin < 5 || updates.intervalMin > 525600)
    ) {
      throw new ForbiddenException(
        'Interval must be between 5 minutes and 1 year (525600 min).',
      );
    }

    const updateData: Record<string, unknown> = {};
    if (updates.description) {
      updateData.description = `${updates.description}\n\n[Updated by KEY Cortex]`;
    }
    if (updates.intervalMin !== undefined) {
      updateData.intervalMin = updates.intervalMin;
    }
    if (updates.config) {
      const currentConfig = (existing.config as Record<string, unknown>) || {};
      updateData.config = { ...currentConfig, ...updates.config };
    }

    const loop = await (this.prisma.client as any).delegationLoop.update({
      where: { id: monitorId },
      data: updateData,
    });

    this.events.emit('cortex.monitor.updated', {
      businessId,
      monitorId,
      source: 'key_cortex',
    });

    return {
      id: loop.id,
      loopType: loop.loopType,
      name: loop.name || loop.loopType,
      description: loop.description || '',
      enabled: loop.enabled ?? false,
      lastRunAt: loop.lastRunAt,
      nextRunAt: loop.nextRunAt,
      intervalMin: loop.intervalMin,
      riskTier: loop.riskTier,
      stats: (loop.stats as Record<string, number> | null)
        ? {
            totalRuns: ((loop.stats as any)?.totalRuns as number) ?? 0,
            totalActionsCreated:
              ((loop.stats as any)?.totalActionsCreated as number) ?? 0,
            totalItemsMatched:
              ((loop.stats as any)?.totalItemsMatched as number) ?? 0,
          }
        : null,
      recentRunStatus: null,
    };
  }

  // ── 4. Set Monitor Active (Enable / Disable) ──────────────

  /**
   * Enable or disable a delegation loop.
   */
  async setMonitorActive(
    businessId: string,
    monitorId: string,
    active: boolean,
  ): Promise<void> {
    this.logger.log(
      `[setMonitorActive] business=${businessId} monitor=${monitorId} active=${active}`,
    );

    await this.delegationLoop.updateLoop(businessId, monitorId, {
      enabled: active,
    });

    this.events.emit('cortex.monitor.toggled', {
      businessId,
      monitorId,
      active,
      source: 'key_cortex',
    });
  }

  // ── 5. Get Monitor Status ─────────────────────────────────

  /**
   * Return detailed status for a single monitor including recent
   * run history and any active alerts.
   */
  async getMonitorStatus(
    businessId: string,
    monitorId: string,
  ): Promise<MonitorStatus> {
    this.logger.log(
      `[getMonitorStatus] business=${businessId} monitor=${monitorId}`,
    );

    const loop = await (this.prisma.client as any).delegationLoop.findFirst({
      where: { id: monitorId, businessId },
      include: {
        runs: {
          orderBy: { startedAt: 'desc' },
          take: 10,
        },
      },
    });

    if (!loop) {
      throw new NotFoundException('Monitor not found');
    }

    const recentRuns: MonitorRunInfo[] = (loop.runs ?? []).map((run: any) => ({
      id: run.id,
      status: run.status,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      itemsScanned: run.itemsScanned ?? 0,
      itemsMatched: run.itemsMatched ?? 0,
      actionsCreated: run.actionsCreated ?? 0,
      actionsBlocked: run.actionsBlocked ?? 0,
      error: run.error,
    }));

    // Derive alerts from recent run failures or blocked actions
    const currentAlerts: MonitorAlert[] = [];

    if (recentRuns.length > 0 && recentRuns[0].status === 'failed') {
      currentAlerts.push({
        id: `alert_${monitorId}_fail`,
        type: 'RUN_FAILURE',
        severity: 'CRITICAL',
        message: `Last run failed: ${recentRuns[0].error ?? 'Unknown error'}`,
        createdAt: recentRuns[0].startedAt,
        resolved: false,
      });
    }

    if (recentRuns.length > 0 && recentRuns[0].actionsBlocked > 0) {
      currentAlerts.push({
        id: `alert_${monitorId}_blocked`,
        type: 'ACTIONS_BLOCKED',
        severity: 'WARNING',
        message: `${recentRuns[0].actionsBlocked} action(s) blocked by governance in last run.`,
        action: 'Review autopilot approval settings.',
        createdAt: recentRuns[0].startedAt,
        resolved: false,
      });
    }

    return {
      id: loop.id,
      loopType: loop.loopType,
      name: loop.name || loop.loopType,
      enabled: loop.enabled ?? false,
      config: (loop.config as Record<string, unknown> | null) ?? {},
      lastRunAt: loop.lastRunAt,
      nextRunAt: loop.nextRunAt,
      intervalMin: loop.intervalMin,
      riskTier: loop.riskTier,
      stats: (loop.stats as Record<string, unknown> | null) ?? {},
      recentRuns,
      currentAlerts,
    };
  }

  // ── 6. Get Recent Alerts ──────────────────────────────────

  /**
   * Query recent autopilot tasks and notifications to surface
   * alerts and actions taken across all monitors.
   */
  async getRecentAlerts(
    businessId: string,
    limit = 20,
  ): Promise<MonitorAlert[]> {
    this.logger.log(`[getRecentAlerts] business=${businessId} limit=${limit}`);

    const [recentRuns, pendingTasks, criticalAlerts] = await Promise.all([
      // Recent failed or blocked runs
      (this.prisma.client as any).delegationLoopRun.findMany({
        where: {
          businessId,
          OR: [{ status: 'failed' }, { actionsBlocked: { gt: 0 } }],
        },
        orderBy: { startedAt: 'desc' },
        take: limit,
        include: {
          loop: { select: { loopType: true, name: true } },
        },
      }),

      // High-priority pending tasks created by delegation loops
      (this.prisma.client as any).autopilotTask.findMany({
        where: {
          businessId,
          priority: { in: ['URGENT', 'HIGH'] },
          status: { in: ['PENDING', 'AWAITING_APPROVAL'] },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),

      // Autopilot critical alerts
      this.autopilot.getCriticalAlerts(businessId),
    ]);

    const alerts: MonitorAlert[] = [];

    // Convert failed/blocked runs to alerts
    for (const run of recentRuns) {
      if (run.status === 'failed') {
        alerts.push({
          id: `run_${run.id}`,
          type: 'RUN_FAILURE',
          severity: 'CRITICAL',
          message: `Monitor "${run.loop?.name ?? run.loopType}" failed: ${run.error ?? 'Unknown'}`,
          createdAt: run.startedAt,
          resolved: false,
        });
      }
      if ((run.actionsBlocked ?? 0) > 0) {
        alerts.push({
          id: `blocked_${run.id}`,
          type: 'ACTIONS_BLOCKED',
          severity: 'WARNING',
          message: `${run.actionsBlocked} action(s) blocked in "${run.loop?.name ?? run.loopType}".`,
          action: 'Check governance approval settings.',
          createdAt: run.startedAt,
          resolved: false,
        });
      }
    }

    // Convert urgent/high tasks to alerts
    for (const task of pendingTasks) {
      const severity =
        task.priority === 'URGENT' ? 'CRITICAL' : 'WARNING';
      alerts.push({
        id: `task_${task.id}`,
        type: 'PENDING_TASK',
        severity,
        message: `[${task.category}] ${task.title}`,
        action: 'Review in autopilot dashboard.',
        createdAt: task.createdAt,
        resolved: false,
      });
    }

    // Merge autopilot critical alerts
    for (const alert of criticalAlerts) {
      alerts.push({
        id: `ap_${alert.type}_${businessId}`,
        type: alert.type,
        severity: alert.severity as 'CRITICAL' | 'WARNING' | 'INFO',
        message: alert.message,
        action: alert.action,
        createdAt: new Date(),
        resolved: false,
      });
    }

    // Sort by severity then recency
    const severityOrder = { CRITICAL: 0, WARNING: 1, INFO: 2 };
    alerts.sort(
      (a, b) =>
        severityOrder[a.severity] - severityOrder[b.severity] ||
        b.createdAt.getTime() - a.createdAt.getTime(),
    );

    return alerts.slice(0, limit);
  }

  // ── 7. Generate Monitor Report ────────────────────────────

  /**
   * Produce a comprehensive report covering all monitors,
   * actions taken, and effectiveness metrics.
   */
  async generateMonitorReport(
    businessId: string,
  ): Promise<MonitorReport> {
    this.logger.log(`[generateMonitorReport] business=${businessId}`);

    const monitors = await this.getActiveMonitors(businessId);

    // Aggregate stats across all loops
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);

    const [weekRuns, allTimeRuns, taskStats] = await Promise.all([
      (this.prisma.client as any).delegationLoopRun.aggregate({
        where: { businessId, startedAt: { gte: weekAgo } },
        _count: true,
        _sum: { actionsCreated: true, itemsMatched: true },
      }),
      (this.prisma.client as any).delegationLoopRun.aggregate({
        where: { businessId },
        _count: true,
        _sum: { actionsCreated: true, itemsMatched: true },
      }),
      this.autopilot.getTaskStats(businessId),
    ]);

    const totalRunsThisWeek = weekRuns._count ?? 0;
    const totalActionsCreated = allTimeRuns._sum.actionsCreated ?? 0;
    const totalItemsMatched = allTimeRuns._sum.itemsMatched ?? 0;

    // Calculate automation rate
    const automationRate =
      taskStats.total > 0
        ? (taskStats.autoExecuted / taskStats.total) * 100
        : 0;

    // Approval-required rate
    const approvalRequiredRuns =
      await (this.prisma.client as any).delegationLoopRun.aggregate({
        where: { businessId },
        _sum: { actionsBlocked: true },
      });
    const approvalRequiredRate =
      (allTimeRuns._count ?? 0) > 0
        ? ((approvalRequiredRuns._sum.actionsBlocked ?? 0) /
            (allTimeRuns._count ?? 0)) *
          100
        : 0;

    // Effectiveness: find most/least effective loops
    let mostEffectiveLoop: string | null = null;
    let leastEffectiveLoop: string | null = null;
    let maxAvg = -1;
    let minAvg = Infinity;

    for (const monitor of monitors) {
      if (!monitor.stats || monitor.stats.totalRuns === 0) continue;
      const avg =
        monitor.stats.totalActionsCreated / monitor.stats.totalRuns;
      if (avg > maxAvg) {
        maxAvg = avg;
        mostEffectiveLoop = monitor.name;
      }
      if (avg < minAvg) {
        minAvg = avg;
        leastEffectiveLoop = monitor.name;
      }
    }

    // Avg actions per run (global)
    const avgActionsPerRun =
      (allTimeRuns._count ?? 0) > 0
        ? (allTimeRuns._sum.actionsCreated ?? 0) /
          (allTimeRuns._count ?? 0)
        : 0;

    // Build recommendations
    const recommendations: string[] = [];

    if (monitors.every((m) => !m.enabled)) {
      recommendations.push(
        'All monitors are currently disabled. Enable at least the Payment Recovery loop to capture overdue revenue.',
      );
    }

    const disabledPaymentRecovery = monitors.find(
      (m) => m.loopType === 'payment_recovery' && !m.enabled,
    );
    if (disabledPaymentRecovery) {
      recommendations.push(
        'Payment Recovery is disabled — you may be leaving revenue on the table. Consider enabling it.',
      );
    }

    if (approvalRequiredRate > 30) {
      recommendations.push(
        `${Math.round(approvalRequiredRate)}% of actions require approval. Review your governance settings to increase automation trust.`,
      );
    }

    if (taskStats.pending > 20) {
      recommendations.push(
        `You have ${taskStats.pending} pending autopilot tasks. Review and resolve them to keep the system running smoothly.`,
      );
    }

    const recentAlerts = await this.getRecentAlerts(businessId, 10);

    return {
      businessId,
      generatedAt: new Date(),
      summary: {
        totalMonitors: monitors.length,
        activeMonitors: monitors.filter((m) => m.enabled).length,
        pausedMonitors: monitors.filter((m) => !m.enabled).length,
        totalRunsThisWeek,
        totalActionsCreated,
        automationRate: Math.round(automationRate * 100) / 100,
      },
      monitors,
      recentAlerts,
      effectiveness: {
        mostEffectiveLoop,
        leastEffectiveLoop,
        avgActionsPerRun: Math.round(avgActionsPerRun * 100) / 100,
        approvalRequiredRate: Math.round(approvalRequiredRate * 100) / 100,
      },
      recommendations,
    };
  }

  // ── 8. Trigger Manual Run ─────────────────────────────────

  /**
   * Manually trigger a monitor (delegation loop) run.
   */
  async triggerManualRun(
    businessId: string,
    monitorId: string,
  ): Promise<{ runId: string; status: string; itemsMatched: number; actionsCreated: number }> {
    this.logger.log(
      `[triggerManualRun] business=${businessId} monitor=${monitorId}`,
    );

    const result = await this.delegationLoop.runLoop(businessId, monitorId);

    this.events.emit('cortex.monitor.manual_run', {
      businessId,
      monitorId,
      runId: result.runId,
      source: 'key_cortex',
    });

    return result;
  }

  // ── 9. Get Available Loop Types ───────────────────────────

  /**
   * Return the set of delegation-loop types that can be created.
   */
  getAvailableLoopTypes(): Array<{
    loopType: string;
    name: string;
    description: string;
    riskTier: number;
    defaultIntervalMin: number;
  }> {
    return this.delegationLoop.getLoopDefinitions().map((d) => ({
      loopType: d.loopType,
      name: d.name,
      description: d.description,
      riskTier: d.riskTier,
      defaultIntervalMin: d.defaultIntervalMin,
    }));
  }

  // ── 10. Parse Natural Language to Config ──────────────────

  /**
   * Heuristic parser that converts a natural-language monitor
   * description into a structured config object.
   *
   * This is a rule-based parser; in production it can be
   * replaced with an AI-powered parser via KeyCortexCommandService.
   */
  parseDescriptionToConfig(
    description: string,
    loopType: string,
  ): Record<string, unknown> {
    const lower = description.toLowerCase();
    const config: Record<string, unknown> = {};

    // Extract numeric values with units
    const hourMatches = lower.match(/(\d+)\s*(?:hour|hr)/g);
    const dayMatches = lower.match(/(\d+)\s*(?:day|days)/g);
    const maxMatches = lower.match(/(?:max|maximum|up to)\s+(\d+)/i);
    const reminderMatches = lower.match(/(\d+)\s*(?:reminder|follow-up)/i);

    // Loop-type-specific parsing
    switch (loopType) {
      case 'payment_recovery': {
        if (dayMatches) {
          const days = dayMatches.map((m) => parseInt(m.match(/(\d+)/)![1], 10));
          if (days.length >= 1) config.graceDays = days[0];
          if (days.length >= 2) config.escalateAfterDays = days[1];
        }
        if (reminderMatches) {
          config.maxReminders = parseInt(reminderMatches[1], 10);
        }
        break;
      }

      case 'lead_reactivation': {
        if (dayMatches) {
          config.staleDays = parseInt(
            dayMatches[0].match(/(\d+)/)![1],
            10,
          );
        }
        if (maxMatches) {
          config.maxPerRun = parseInt(maxMatches[1], 10);
        }
        break;
      }

      case 'post_purchase': {
        const delays = lower.match(/(\d+)\s*(?:hour|hr|day|days)/g);
        if (delays) {
          const nums = delays.map((m) => parseInt(m.match(/(\d+)/)![1], 10));
          // Heuristic: first small number = hours, second = days
          const hourVals = nums.filter((n) => n < 24);
          const dayVals = nums.filter((n) => n >= 1);
          if (hourVals.length > 0) config.thankYouDelayHours = hourVals[0];
          if (dayVals.length > 0) config.reviewRequestDelayDays = dayVals[0];
          if (dayVals.length > 1) config.crossSellDelayDays = dayVals[1];
        }
        break;
      }

      case 'booking_prep': {
        if (hourMatches) {
          config.reminderHoursBefore = parseInt(
            hourMatches[0].match(/(\d+)/)![1],
            10,
          );
        }
        const followUpMatch = lower.match(/follow[- ]?up\s+(\d+)/i);
        if (followUpMatch) {
          config.followUpDelayHours = parseInt(followUpMatch[1], 10);
        }
        break;
      }

      case 'weekly_hygiene': {
        const draftMatch = lower.match(/(\d+)\s*(?:day|days).{0,20}draft/i);
        if (draftMatch) {
          config.archiveDraftsDays = parseInt(draftMatch[1], 10);
        }
        config.flagDuplicates = lower.includes('duplicate');
        config.summarizePatterns = lower.includes('pattern') || lower.includes('summarize');
        break;
      }
    }

    return config;
  }
}
