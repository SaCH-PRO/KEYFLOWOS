import { Injectable, Logger, Inject } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { BusinessGraphService, BusinessGraphSnapshot } from './business-graph.service';

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
  | 'client_risk';

export interface ProAutoInsight {
  id: string;
  category: InsightCategory;
  severity: InsightSeverity;
  title: string;
  description: string;
  metric?: string;
  suggestedAction?: string;
  suggestedTool?: string;
  module: string;
  timestamp: string;
}

@Injectable()
export class ProAutoMonitorService {
  private readonly logger = new Logger(ProAutoMonitorService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BusinessGraphService) private readonly businessGraph: BusinessGraphService,
  ) {}

  async scanInsights(businessId: string): Promise<ProAutoInsight[]> {
    const insights: ProAutoInsight[] = [];
    const now = new Date();

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

      await this.checkClientRisk(businessId, now, insights);
    } catch (err) {
      this.logger.error(`Monitoring scan failed for ${businessId}: ${(err as Error).message}`);
    }

    insights.sort((a, b) => {
      const order: Record<InsightSeverity, number> = { critical: 0, warning: 1, opportunity: 2, info: 3 };
      return order[a.severity] - order[b.severity];
    });

    return insights;
  }

  private checkStaleLeads(snap: BusinessGraphSnapshot, out: ProAutoInsight[]) {
    const count = snap.contacts.staleLeadCount;
    if (count === 0) return;

    const severity: InsightSeverity = count > 10 ? 'critical' : count > 3 ? 'warning' : 'info';
    out.push({
      id: `stale_leads_${Date.now()}`,
      category: 'stale_leads',
      severity,
      title: `${count} stale lead${count !== 1 ? 's' : ''} need attention`,
      description: `${count} lead${count !== 1 ? 's have' : ' has'} had no activity in 7+ days. Follow up to prevent them from going cold.`,
      metric: `${count} leads`,
      suggestedAction: 'Send a follow-up message or schedule a call',
      suggestedTool: 'draft_followup_message',
      module: 'crm',
      timestamp: new Date().toISOString(),
    });
  }

  private checkOverdueInvoices(snap: BusinessGraphSnapshot, out: ProAutoInsight[]) {
    const { overdueCount, overdueAmount } = snap.revenue;
    if (overdueCount === 0) return;

    const severity: InsightSeverity = overdueAmount > 5000 ? 'critical' : overdueCount > 3 ? 'warning' : 'info';
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
      module: 'revenue',
      timestamp: new Date().toISOString(),
    });
  }

  private checkDelayedProjects(snap: BusinessGraphSnapshot, out: ProAutoInsight[]) {
    const { overdueTaskCount, activeCount } = snap.projects;
    if (overdueTaskCount === 0) return;

    const ratio = activeCount > 0 ? overdueTaskCount / activeCount : 0;
    const severity: InsightSeverity = ratio > 1 ? 'critical' : overdueTaskCount > 5 ? 'warning' : 'info';
    out.push({
      id: `delayed_projects_${Date.now()}`,
      category: 'delayed_projects',
      severity,
      title: `${overdueTaskCount} overdue project task${overdueTaskCount !== 1 ? 's' : ''}`,
      description: `${overdueTaskCount} task${overdueTaskCount !== 1 ? 's are' : ' is'} past due across ${activeCount} active project${activeCount !== 1 ? 's' : ''}. Review and reprioritize to keep delivery on track.`,
      metric: `${overdueTaskCount} tasks`,
      suggestedAction: 'Review overdue tasks and update timelines',
      suggestedTool: 'fetch_project_status',
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
        suggestedTool: 'enable_flow',
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
        module: 'cockpit',
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
        c => c.contactId && !activeClientIds.has(c.contactId)
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
          module: 'crm',
          timestamp: new Date().toISOString(),
        });
      }
    } catch (err) {
      this.logger.warn(`Client risk check failed: ${(err as Error).message}`);
    }
  }
}
