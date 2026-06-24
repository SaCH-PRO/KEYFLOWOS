import { Injectable, Logger, Inject, OnModuleInit, OnModuleDestroy, forwardRef } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { BusinessGraphService, BusinessGraphSnapshot } from './business-graph.service';
import { AiOversightService, type AutonomySettings } from './ai-oversight.service';
import { AiExecutionLogService } from './ai-execution-log.service';
import { FlowOrchestratorService } from './flow-orchestrator.service';

export type InsightSeverity = 'critical' | 'warning' | 'info' | 'opportunity';
export type InsightCategory =
  | 'stale_leads'
  | 'overdue_invoices'
  | 'delayed_projects'
  | 'cost_pressure'
  | 'booking_gaps'
  | 'content_stale'
  | 'automation_health'
  | 'revenue_trend'
  | 'client_risk'
  | 'storefront_health'
  | 'pending_bookings';

export interface ProAutoInsight {
  id: string;
  category: InsightCategory;
  severity: InsightSeverity;
  title: string;
  description: string;
  metric?: string;
  suggestedAction?: string;
  suggestedTool?: string;
  riskTier: number;
  module: string;
  timestamp: string;
  escalated?: boolean;
  autoExecuteResult?: { success: boolean; error?: string };
}

const SCAN_INTERVAL_MS = 15 * 60 * 1000;
const INSIGHT_CACHE_TTL_MS = 10 * 60 * 1000;
const BATCH_SIZE = 50;
const AUTO_EXEC_COOLDOWN_MS = 60 * 60 * 1000;

const AUTO_EXECUTABLE_READ_TOOLS = new Set([
  'fetch_business_summary',
  'fetch_storefront_quality',
  'fetch_project_status',
  'fetch_expense_pressure',
  'fetch_schedule_health',
  'fetch_client_health',
  'fetch_revenue_risk',
]);

const TIER1_TOOLS = new Set([
  ...AUTO_EXECUTABLE_READ_TOOLS,
  'draft_followup_message',
  'draft_payment_reminder',
]);

@Injectable()
export class ProAutoMonitorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProAutoMonitorService.name);
  private intervalRef: ReturnType<typeof setInterval> | null = null;
  private readonly insightCache = new Map<string, { insights: ProAutoInsight[]; expiresAt: number }>();
  private readonly autoExecCooldowns = new Map<string, number>();
  private lastCursorId: string | null = null;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BusinessGraphService) private readonly businessGraph: BusinessGraphService,
    @Inject(AiOversightService) private readonly governance: AiOversightService,
    @Inject(AiExecutionLogService) private readonly executionLog: AiExecutionLogService,
    @Inject(forwardRef(() => FlowOrchestratorService)) private readonly orchestrator: FlowOrchestratorService,
  ) {}

  onModuleInit() {
    this.intervalRef = setInterval(() => {
      this.runPeriodicScan().catch(err =>
        this.logger.error(`Periodic monitoring scan failed: ${(err as Error).message}`),
      );
    }, SCAN_INTERVAL_MS);
    this.logger.log(`Pro Auto monitoring scheduler started (${SCAN_INTERVAL_MS / 60000}min interval)`);
  }

  onModuleDestroy() {
    if (this.intervalRef) {
      clearInterval(this.intervalRef);
      this.intervalRef = null;
    }
  }

  private async runPeriodicScan() {
    const whereClause: any = { deletedAt: null };
    if (this.lastCursorId) {
      whereClause.id = { gt: this.lastCursorId };
    }

    const businesses = await this.prisma.client.business.findMany({
      where: whereClause,
      select: { id: true },
      take: BATCH_SIZE,
      orderBy: { id: 'asc' },
    });

    if (businesses.length === 0) {
      this.lastCursorId = null;
      return;
    }

    this.lastCursorId = businesses[businesses.length - 1].id;

    if (businesses.length < BATCH_SIZE) {
      this.lastCursorId = null;
    }

    for (const biz of businesses) {
      try {
        const settings = await this.governance.getAutonomySettings(biz.id);
        if (settings.mode === 'restricted' || settings.mode === 'advisory') continue;

        const insights = await this.scanInsights(biz.id);
        await this.escalateInsights(biz.id, insights, settings);
      } catch (err) {
        this.logger.warn(`Scan failed for business ${biz.id}: ${(err as Error).message}`);
      }
    }
  }

  async scanInsights(businessId: string): Promise<ProAutoInsight[]> {
    const cached = this.insightCache.get(businessId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.insights;
    }

    const insights: ProAutoInsight[] = [];

    try {
      const snapshot = await this.businessGraph.getSnapshot(businessId, true);

      this.checkStaleLeads(snapshot, insights);
      this.checkOverdueInvoices(snapshot, insights);
      this.checkDelayedProjects(snapshot, insights);
      this.checkCostPressure(snapshot, insights);
      this.checkBookingGaps(snapshot, insights);
      this.checkContentStaleness(snapshot, insights);
      this.checkAutomationHealth(snapshot, insights);
      this.checkRevenueTrend(snapshot, insights);
      this.checkStorefrontHealth(snapshot, insights);

      await this.checkClientRisk(businessId, new Date(), insights);
    } catch (err) {
      this.logger.error(`Monitoring scan failed for ${businessId}: ${(err as Error).message}`);
    }

    insights.sort((a, b) => {
      const order: Record<InsightSeverity, number> = { critical: 0, warning: 1, opportunity: 2, info: 3 };
      return order[a.severity] - order[b.severity];
    });

    this.insightCache.set(businessId, { insights, expiresAt: Date.now() + INSIGHT_CACHE_TTL_MS });

    return insights;
  }

  async escalateInsights(businessId: string, insights: ProAutoInsight[], settings: AutonomySettings): Promise<void> {
    const actionableInsights = insights.filter(i =>
      i.severity === 'critical' || i.severity === 'warning',
    );

    if (actionableInsights.length === 0) return;

    const recentApprovals = await this.prisma.client.aiApprovalItem.findMany({
      where: {
        businessId,
        status: 'pending',
        module: 'monitoring',
        createdAt: { gte: new Date(Date.now() - 4 * 60 * 60 * 1000) },
      },
      select: { toolName: true },
    });
    const existingTools = new Set(recentApprovals.map(a => a.toolName));

    for (const insight of actionableInsights) {
      const toolKey = `monitoring_${insight.category}`;
      if (existingTools.has(toolKey)) continue;

      if (insight.riskTier <= settings.maxAutoTier && settings.mode === 'pro_auto') {
        if (insight.suggestedTool && TIER1_TOOLS.has(insight.suggestedTool)) {
          const cooldownKey = `${businessId}:${insight.suggestedTool}:${insight.category}`;
          const lastExec = this.autoExecCooldowns.get(cooldownKey) || 0;
          if (Date.now() - lastExec < AUTO_EXEC_COOLDOWN_MS) {
            this.logger.debug(`Skipping ${insight.suggestedTool} for ${businessId} (cooldown active)`);
            continue;
          }
          const args = await this.buildAutoExecArgs(businessId, insight);
          if (args) {
            try {
              const result = await this.orchestrator.autoExecuteToolForMonitoring(
                businessId,
                insight.suggestedTool,
                args,
              );
              if (result.blocked) {
                this.logger.log(`Tool ${insight.suggestedTool} blocked by governance for ${businessId}, creating approval item`);
              } else if (result.success) {
                insight.escalated = true;
                insight.autoExecuteResult = result;
                this.autoExecCooldowns.set(cooldownKey, Date.now());
                this.logger.log(`Auto-executed ${insight.suggestedTool} for ${businessId}: success`);
                continue;
              } else {
                this.logger.warn(`Auto-execution of ${insight.suggestedTool} returned error for ${businessId}: ${result.error}`);
              }
            } catch (err) {
              this.logger.warn(`Auto-execution of ${insight.suggestedTool} failed for ${businessId}: ${(err as Error).message}`);
            }
          }
        } else if (!insight.suggestedTool) {
          insight.escalated = true;
          this.executionLog.logToolExecution(businessId, toolKey, {}, { acknowledged: true }, true, 0, {
            riskTier: insight.riskTier,
            mode: 'pro_auto',
            rationale: `Monitoring insight acknowledged: ${insight.title}`,
          }).catch(() => {});
          continue;
        }
      }

      await this.prisma.client.aiApprovalItem.create({
        data: {
          businessId,
          riskTier: insight.riskTier,
          toolName: toolKey,
          module: 'monitoring',
          title: insight.title,
          description: insight.description,
          rationale: insight.suggestedAction || 'Proactive monitoring detected an issue requiring attention',
          expectedBenefit: insight.suggestedAction,
          risks: insight.severity === 'critical' ? 'Inaction may lead to revenue loss or operational disruption' : undefined,
        },
      });
      existingTools.add(toolKey);
    }
  }

  private async buildAutoExecArgs(businessId: string, insight: ProAutoInsight): Promise<Record<string, any> | null> {
    const tool = insight.suggestedTool;
    if (!tool) return null;

    if (AUTO_EXECUTABLE_READ_TOOLS.has(tool)) {
      return { businessId };
    }

    if (tool === 'draft_followup_message') {
      const staleContact = await this.prisma.client.contact.findFirst({
        where: { businessId, deletedAt: null, status: 'LEAD' },
        orderBy: { updatedAt: 'asc' },
        select: { id: true },
      });
      if (!staleContact) return null;
      return { contactId: staleContact.id, channel: 'email', tone: 'friendly' };
    }

    if (tool === 'draft_payment_reminder') {
      const overdueInvoice = await this.prisma.client.invoice.findFirst({
        where: { businessId, deletedAt: null, status: 'OVERDUE' },
        orderBy: { dueDate: 'asc' },
        select: { id: true },
      });
      if (!overdueInvoice) return null;
      return { invoiceId: overdueInvoice.id, urgency: 'gentle' };
    }

    return null;
  }

  private checkStaleLeads(snap: BusinessGraphSnapshot, out: ProAutoInsight[]) {
    const count = snap.contacts.staleLeadCount;
    if (count === 0) return;

    const severity: InsightSeverity = count > 10 ? 'critical' : count > 3 ? 'warning' : 'info';
    const riskTier = severity === 'critical' ? 2 : 1;
    out.push({
      id: `stale_leads_${Date.now()}`,
      category: 'stale_leads',
      severity,
      title: `${count} stale lead${count !== 1 ? 's' : ''} need attention`,
      description: `${count} lead${count !== 1 ? 's have' : ' has'} had no activity in 7+ days. Follow up to prevent them from going cold.`,
      metric: `${count} leads`,
      suggestedAction: 'Send a follow-up message or schedule a call',
      suggestedTool: 'draft_followup_message',
      riskTier,
      module: 'crm',
      timestamp: new Date().toISOString(),
    });
  }

  private checkOverdueInvoices(snap: BusinessGraphSnapshot, out: ProAutoInsight[]) {
    const { overdueCount, overdueAmount } = snap.revenue;
    if (overdueCount === 0) return;

    const severity: InsightSeverity = overdueAmount > 5000 ? 'critical' : overdueCount > 3 ? 'warning' : 'info';
    const riskTier = severity === 'critical' ? 3 : 2;
    const currency = snap.business.currency || 'TTD';
    out.push({
      id: `overdue_invoices_${Date.now()}`,
      category: 'overdue_invoices',
      severity,
      title: `${overdueCount} overdue invoice${overdueCount !== 1 ? 's' : ''} ($${overdueAmount.toLocaleString()} ${currency})`,
      description: `You have ${overdueCount} past-due invoice${overdueCount !== 1 ? 's' : ''} totaling $${overdueAmount.toLocaleString()} ${currency}. Send payment reminders to recover this revenue.`,
      metric: `$${overdueAmount.toLocaleString()}`,
      suggestedAction: 'Send payment reminders to overdue clients',
      suggestedTool: 'draft_payment_reminder',
      riskTier,
      module: 'revenue',
      timestamp: new Date().toISOString(),
    });
  }

  private checkDelayedProjects(snap: BusinessGraphSnapshot, out: ProAutoInsight[]) {
    const { overdueTaskCount, activeCount } = snap.projects;
    if (overdueTaskCount === 0) return;

    const ratio = activeCount > 0 ? overdueTaskCount / activeCount : 0;
    const severity: InsightSeverity = ratio > 1 ? 'critical' : overdueTaskCount > 5 ? 'warning' : 'info';
    const riskTier = severity === 'critical' ? 2 : 1;
    out.push({
      id: `delayed_projects_${Date.now()}`,
      category: 'delayed_projects',
      severity,
      title: `${overdueTaskCount} overdue project task${overdueTaskCount !== 1 ? 's' : ''}`,
      description: `${overdueTaskCount} task${overdueTaskCount !== 1 ? 's are' : ' is'} past due across ${activeCount} active project${activeCount !== 1 ? 's' : ''}. Review and reprioritize to keep delivery on track.`,
      metric: `${overdueTaskCount} tasks`,
      suggestedAction: 'Review overdue tasks and update timelines',
      suggestedTool: 'fetch_project_status',
      riskTier,
      module: 'projects',
      timestamp: new Date().toISOString(),
    });
  }

  private checkCostPressure(snap: BusinessGraphSnapshot, out: ProAutoInsight[]) {
    const { totalThisMonth, budgetUtilization } = snap.expenses;
    const { monthlyRevenue } = snap.revenue;

    if (monthlyRevenue > 0 && totalThisMonth > monthlyRevenue * 0.85) {
      const ratio = Math.round((totalThisMonth / monthlyRevenue) * 100);
      const severity: InsightSeverity = totalThisMonth > monthlyRevenue ? 'critical' : 'warning';
      out.push({
        id: `cost_pressure_revenue_${Date.now()}`,
        category: 'cost_pressure',
        severity,
        title: `Expenses at ${ratio}% of monthly revenue`,
        description: `This month's expenses ($${totalThisMonth.toLocaleString()}) are consuming ${ratio}% of revenue ($${monthlyRevenue.toLocaleString()}). Review spending to protect margins.`,
        metric: `${ratio}%`,
        suggestedAction: 'Review expense categories and identify savings',
        suggestedTool: 'fetch_expense_pressure',
        riskTier: 2,
        module: 'expenses',
        timestamp: new Date().toISOString(),
      });
    }

    if (budgetUtilization > 85) {
      const severity: InsightSeverity = budgetUtilization > 100 ? 'critical' : 'warning';
      out.push({
        id: `cost_pressure_budget_${Date.now()}`,
        category: 'cost_pressure',
        severity,
        title: `Budget ${budgetUtilization > 100 ? 'exceeded' : 'nearing limit'} at ${budgetUtilization.toFixed(0)}%`,
        description: `You've used ${budgetUtilization.toFixed(0)}% of your monthly budget. ${budgetUtilization > 100 ? 'Immediate review needed.' : 'Monitor closely for the rest of the month.'}`,
        metric: `${budgetUtilization.toFixed(0)}%`,
        suggestedAction: 'Review budget allocations',
        riskTier: budgetUtilization > 100 ? 3 : 2,
        module: 'expenses',
        timestamp: new Date().toISOString(),
      });
    }
  }

  private checkBookingGaps(snap: BusinessGraphSnapshot, out: ProAutoInsight[]) {
    const { upcomingCount, cancelledThisMonth, completedThisMonth } = snap.bookings;

    if (upcomingCount === 0 && completedThisMonth > 0) {
      out.push({
        id: `booking_gaps_${Date.now()}`,
        category: 'booking_gaps',
        severity: 'warning',
        title: 'No upcoming bookings scheduled',
        description: `You had ${completedThisMonth} completed booking${completedThisMonth !== 1 ? 's' : ''} this month but nothing upcoming. Consider outreach to fill your calendar.`,
        metric: '0 upcoming',
        suggestedAction: 'Send booking reminders to recent clients',
        suggestedTool: 'draft_followup_message',
        riskTier: 1,
        module: 'calendar',
        timestamp: new Date().toISOString(),
      });
    }

    if (cancelledThisMonth > 2) {
      const totalMonth = completedThisMonth + cancelledThisMonth + upcomingCount;
      const cancelRate = totalMonth > 0 ? Math.round((cancelledThisMonth / totalMonth) * 100) : 0;
      if (cancelRate > 15) {
        out.push({
          id: `booking_cancellations_${Date.now()}`,
          category: 'booking_gaps',
          severity: 'warning',
          title: `High cancellation rate: ${cancelRate}%`,
          description: `${cancelledThisMonth} booking${cancelledThisMonth !== 1 ? 's' : ''} cancelled this month (${cancelRate}% rate). Investigate causes and consider deposit policies.`,
          metric: `${cancelRate}%`,
          riskTier: 1,
          module: 'calendar',
          timestamp: new Date().toISOString(),
        });
      }
    }
  }

  private checkContentStaleness(snap: BusinessGraphSnapshot, out: ProAutoInsight[]) {
    const { draftPostCount, scheduledPostCount, draftCampaignCount } = snap.content;

    if (draftPostCount > 5 && scheduledPostCount === 0) {
      out.push({
        id: `content_stale_${Date.now()}`,
        category: 'content_stale',
        severity: 'info',
        title: `${draftPostCount} draft posts sitting idle`,
        description: `You have ${draftPostCount} draft posts but nothing scheduled. Review and publish to maintain your online presence.`,
        metric: `${draftPostCount} drafts`,
        suggestedAction: 'Schedule your best draft posts',
        riskTier: 1,
        module: 'content',
        timestamp: new Date().toISOString(),
      });
    }

    if (draftCampaignCount > 2) {
      out.push({
        id: `campaign_stale_${Date.now()}`,
        category: 'content_stale',
        severity: 'info',
        title: `${draftCampaignCount} draft campaign${draftCampaignCount !== 1 ? 's' : ''} pending`,
        description: `${draftCampaignCount} email campaign${draftCampaignCount !== 1 ? 's are' : ' is'} in draft. Finalize and send to engage your audience.`,
        metric: `${draftCampaignCount} drafts`,
        riskTier: 1,
        module: 'content',
        timestamp: new Date().toISOString(),
      });
    }
  }

  private checkAutomationHealth(snap: BusinessGraphSnapshot, out: ProAutoInsight[]) {
    const { activeCount, disabledCount } = snap.automations;

    if (disabledCount > 0 && activeCount === 0) {
      out.push({
        id: `automation_disabled_${Date.now()}`,
        category: 'automation_health',
        severity: 'warning',
        title: `All ${disabledCount} automation${disabledCount !== 1 ? 's' : ''} disabled`,
        description: 'None of your automations are currently active. Re-enable flows to maintain automated operations.',
        metric: `${disabledCount} disabled`,
        suggestedAction: 'Review and re-enable automations',
        suggestedTool: 'enable_flow_with_approval',
        riskTier: 2,
        module: 'flows',
        timestamp: new Date().toISOString(),
      });
    } else if (disabledCount > activeCount && disabledCount > 2) {
      out.push({
        id: `automation_mostly_disabled_${Date.now()}`,
        category: 'automation_health',
        severity: 'info',
        title: `${disabledCount} of ${activeCount + disabledCount} automations disabled`,
        description: 'Most of your automations are turned off. Review if any should be reactivated.',
        metric: `${disabledCount} disabled`,
        riskTier: 1,
        module: 'flows',
        timestamp: new Date().toISOString(),
      });
    }
  }

  private checkRevenueTrend(snap: BusinessGraphSnapshot, out: ProAutoInsight[]) {
    const { monthlyRevenue, outstandingAmount, outstandingCount } = snap.revenue;

    if (outstandingAmount > monthlyRevenue * 1.5 && outstandingCount > 3) {
      out.push({
        id: `revenue_outstanding_${Date.now()}`,
        category: 'revenue_trend',
        severity: 'warning',
        title: `$${outstandingAmount.toLocaleString()} outstanding across ${outstandingCount} invoices`,
        description: `Outstanding invoices exceed 1.5x your monthly revenue. Prioritize collections to improve cash flow.`,
        metric: `$${outstandingAmount.toLocaleString()}`,
        suggestedAction: 'Follow up on outstanding invoices',
        suggestedTool: 'draft_payment_reminder',
        riskTier: 2,
        module: 'revenue',
        timestamp: new Date().toISOString(),
      });
    }

    if (snap.momentumScore < 40) {
      out.push({
        id: `momentum_low_${Date.now()}`,
        category: 'revenue_trend',
        severity: 'warning',
        title: `Business momentum score: ${snap.momentumScore}/100`,
        description: 'Your overall business momentum is low. Focus on key activities to build operational rhythm.',
        metric: `${snap.momentumScore}/100`,
        suggestedAction: 'Review your business priorities',
        suggestedTool: 'fetch_business_summary',
        riskTier: 1,
        module: 'cockpit',
        timestamp: new Date().toISOString(),
      });
    }
  }

  private checkStorefrontHealth(snap: BusinessGraphSnapshot, out: ProAutoInsight[]) {
    const { activeProductCount, averagePrice } = snap.storefront;

    if (activeProductCount === 0) {
      out.push({
        id: `storefront_empty_${Date.now()}`,
        category: 'storefront_health',
        severity: 'warning',
        title: 'Storefront has no active products',
        description: 'Your public storefront has zero active products. Add products or services to start accepting orders online.',
        metric: '0 products',
        suggestedAction: 'Add products to your storefront',
        suggestedTool: 'fetch_storefront_quality',
        riskTier: 1,
        module: 'store',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    if (activeProductCount < 3) {
      out.push({
        id: `storefront_sparse_${Date.now()}`,
        category: 'storefront_health',
        severity: 'info',
        title: `Only ${activeProductCount} product${activeProductCount !== 1 ? 's' : ''} on storefront`,
        description: `A sparse storefront may reduce conversions. Consider adding more products or service packages to give customers more options.`,
        metric: `${activeProductCount} products`,
        suggestedAction: 'Expand your product catalog',
        suggestedTool: 'fetch_storefront_quality',
        riskTier: 1,
        module: 'store',
        timestamp: new Date().toISOString(),
      });
    }

    if (averagePrice === 0 && activeProductCount > 0) {
      out.push({
        id: `storefront_pricing_${Date.now()}`,
        category: 'storefront_health',
        severity: 'warning',
        title: 'Products listed with $0 pricing',
        description: 'Some of your storefront products have zero pricing. Update pricing to enable online purchasing.',
        metric: '$0 avg price',
        suggestedAction: 'Review and update product pricing',
        suggestedTool: 'fetch_storefront_quality',
        riskTier: 1,
        module: 'store',
        timestamp: new Date().toISOString(),
      });
    }
  }

  private async checkClientRisk(businessId: string, now: Date, out: ProAutoInsight[]) {
    try {
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const db = this.prisma.client;

      const topClients = await db.invoice.groupBy({
        by: ['contactId'],
        where: { businessId, deletedAt: null, status: 'PAID' },
        _sum: { total: true },
        _count: true,
        orderBy: { _sum: { total: 'desc' } },
        take: 5,
      });

      if (topClients.length === 0) return;

      const topClientIds = topClients.filter(c => c.contactId).map(c => c.contactId!);
      if (topClientIds.length === 0) return;

      const recentActivity = await db.invoice.findMany({
        where: {
          businessId,
          deletedAt: null,
          contactId: { in: topClientIds },
          createdAt: { gte: thirtyDaysAgo },
        },
        select: { contactId: true },
      });

      const activeClientIds = new Set(recentActivity.map(r => r.contactId));
      const atRiskClients = topClients.filter(
        c => c.contactId && !activeClientIds.has(c.contactId),
      );

      if (atRiskClients.length > 0) {
        const totalAtRisk = atRiskClients.reduce((s, c) => s + Number(c._sum.total ?? 0), 0);
        out.push({
          id: `client_risk_${Date.now()}`,
          category: 'client_risk',
          severity: atRiskClients.length >= 3 ? 'warning' : 'info',
          title: `${atRiskClients.length} top client${atRiskClients.length !== 1 ? 's' : ''} going quiet`,
          description: `${atRiskClients.length} of your highest-value clients (representing $${totalAtRisk.toLocaleString()} in revenue) have had no invoicing activity in the last 30 days.`,
          metric: `$${totalAtRisk.toLocaleString()} at risk`,
          suggestedAction: 'Reach out to re-engage these clients',
          suggestedTool: 'draft_followup_message',
          riskTier: 2,
          module: 'crm',
          timestamp: new Date().toISOString(),
        });
      }
    } catch (err) {
      this.logger.warn(`Client risk check failed: ${(err as Error).message}`);
    }
  }
}
