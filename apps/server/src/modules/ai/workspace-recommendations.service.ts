import { Injectable, Logger, Inject } from '@nestjs/common';
import { BusinessGraphService, BusinessGraphSnapshot } from './business-graph.service';
import { PrismaService } from '../../core/prisma/prisma.service';

export interface WorkspaceRecommendation {
  id: string;
  type: 'action' | 'insight' | 'risk' | 'opportunity';
  priority: 'high' | 'medium' | 'low';
  title: string;
  description: string;
  explanation?: string;
  sourceModule: string;
  targetModule: string;
  actionLabel?: string;
  actionRoute?: string;
  severity: number;
}

type WorkspaceModule = 'crm' | 'revenue' | 'bookings' | 'marketing' | 'projects' | 'expenses' | 'automations';

interface CrossModuleLinksResult {
  invoices: Array<{ id: string; number: string; status: string; amount: number }>;
  bookings: Array<{ id: string; date: string; service: string; status: string }>;
  projects: Array<{ id: string; name: string; status: string }>;
}

@Injectable()
export class WorkspaceRecommendationsService {
  private readonly logger = new Logger(WorkspaceRecommendationsService.name);

  constructor(
    @Inject(BusinessGraphService) private readonly graphService: BusinessGraphService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async getRecommendations(businessId: string, module: WorkspaceModule): Promise<WorkspaceRecommendation[]> {
    const snapshot = await this.graphService.getSnapshot(businessId);
    const recs: WorkspaceRecommendation[] = [];

    const crossModuleRecs = this.generateCrossModuleRecommendations(snapshot);
    const moduleSpecificRecs = this.generateModuleRecommendations(snapshot, module);

    recs.push(...moduleSpecificRecs, ...crossModuleRecs.filter(r => r.targetModule === module || r.sourceModule === module));

    recs.sort((a, b) => b.severity - a.severity);
    return recs.slice(0, 8);
  }

  async getAutomationCoverage(businessId: string): Promise<{
    overallPct: number;
    modules: Array<{ module: string; coveragePct: number; automatedCount: number; totalProcesses: number }>;
  }> {
    const snapshot = await this.graphService.getSnapshot(businessId);
    const { activeCount, disabledCount } = snapshot.automations;
    const totalFlows = activeCount + disabledCount;

    const moduleProcessCounts: Record<string, number> = {
      crm: 4,
      revenue: 5,
      bookings: 3,
      marketing: 4,
      projects: 3,
      expenses: 2,
      automations: 3,
    };

    const modules = Object.entries(moduleProcessCounts).map(([mod, total]) => {
      const estimated = totalFlows > 0 ? Math.min(Math.round(activeCount / Object.keys(moduleProcessCounts).length), total) : 0;
      return {
        module: mod,
        coveragePct: total > 0 ? Math.round((estimated / total) * 100) : 0,
        automatedCount: estimated,
        totalProcesses: total,
      };
    });

    const overallPct = modules.length > 0
      ? Math.round(modules.reduce((sum, m) => sum + m.coveragePct, 0) / modules.length)
      : 0;

    return { overallPct, modules };
  }

  async getCrossModuleLinks(businessId: string, entityType: string, entityId: string): Promise<CrossModuleLinksResult> {
    const result: CrossModuleLinksResult = { invoices: [], bookings: [], projects: [] };

    if (entityType !== 'contact') return result;

    try {
      const [invoices, bookings, projects] = await Promise.all([
        this.prisma.client.invoice.findMany({
          where: { contactId: entityId, businessId },
          select: { id: true, invoiceNumber: true, status: true, total: true },
          take: 5,
          orderBy: { createdAt: 'desc' },
        }).catch(() => [] as Array<{ id: string; invoiceNumber: string | null; status: string; total: number | null }>),
        this.prisma.client.booking.findMany({
          where: { contactId: entityId, businessId },
          select: { id: true, startTime: true, status: true, service: { select: { name: true } } },
          take: 5,
          orderBy: { startTime: 'desc' },
        }).catch(() => [] as Array<{ id: string; startTime: Date; status: string; service: { name: string } | null }>),
        this.prisma.client.project.findMany({
          where: { contactId: entityId, businessId },
          select: { id: true, name: true, status: true },
          take: 5,
          orderBy: { createdAt: 'desc' },
        }).catch(() => [] as Array<{ id: string; name: string; status: string }>),
      ]);

      result.invoices = invoices.map((inv) => ({
        id: inv.id,
        number: inv.invoiceNumber || 'Draft',
        status: inv.status,
        amount: Number(inv.total || 0),
      }));

      result.bookings = bookings.map((b) => ({
        id: b.id,
        date: b.startTime?.toISOString?.() ?? '',
        service: b.service?.name || 'Service',
        status: b.status,
      }));

      result.projects = projects.map((p) => ({
        id: p.id,
        name: p.name || 'Untitled',
        status: p.status,
      }));
    } catch (e) {
      this.logger.warn(`Failed to fetch cross-module links: ${e}`);
    }

    return result;
  }

  private generateCrossModuleRecommendations(s: BusinessGraphSnapshot): WorkspaceRecommendation[] {
    const recs: WorkspaceRecommendation[] = [];

    if (s.revenue.overdueCount > 0 && s.contacts.total > 0) {
      recs.push({
        id: 'cross-overdue-followup',
        type: 'action',
        priority: 'high',
        title: 'Follow up on overdue invoices',
        description: `${s.revenue.overdueCount} invoice${s.revenue.overdueCount > 1 ? 's' : ''} overdue (TTD ${s.revenue.overdueAmount.toLocaleString()}) — send payment reminders to affected clients.`,
        explanation: 'Overdue invoices directly impact cash flow. Automated follow-ups can recover 30-50% of overdue amounts.',
        sourceModule: 'revenue',
        targetModule: 'crm',
        actionLabel: 'View overdue',
        actionRoute: '/app/commerce?tab=invoices&status=OVERDUE',
        severity: 90,
      });
    }

    if (s.bookings.upcomingCount > 0 && s.revenue.outstandingCount > 0) {
      recs.push({
        id: 'cross-booking-invoice',
        type: 'insight',
        priority: 'medium',
        title: 'Clients with bookings & outstanding invoices',
        description: `You have ${s.bookings.upcomingCount} upcoming booking${s.bookings.upcomingCount > 1 ? 's' : ''} and ${s.revenue.outstandingCount} outstanding invoice${s.revenue.outstandingCount > 1 ? 's' : ''}.`,
        explanation: 'Consider collecting payment before or at the next appointment to improve cash flow.',
        sourceModule: 'bookings',
        targetModule: 'revenue',
        actionLabel: 'View bookings',
        actionRoute: '/app/bookings',
        severity: 60,
      });
    }

    if (s.projects.overdueTaskCount > 0) {
      recs.push({
        id: 'cross-project-overdue',
        type: 'risk',
        priority: 'high',
        title: 'Overdue project tasks',
        description: `${s.projects.overdueTaskCount} task${s.projects.overdueTaskCount > 1 ? 's are' : ' is'} overdue across active projects — this may delay client deliverables.`,
        explanation: 'Overdue tasks can cascade into missed deadlines and affect client satisfaction.',
        sourceModule: 'projects',
        targetModule: 'projects',
        actionLabel: 'View projects',
        actionRoute: '/app/projects',
        severity: 85,
      });
    }

    if (s.contacts.staleLeadCount > 3) {
      recs.push({
        id: 'cross-stale-nurture',
        type: 'action',
        priority: 'medium',
        title: 'Nurture stale leads with a campaign',
        description: `${s.contacts.staleLeadCount} leads haven't been contacted recently — create a re-engagement email campaign.`,
        explanation: 'Stale leads represent potential lost revenue. A simple follow-up can revive 10-20% of cold leads.',
        sourceModule: 'crm',
        targetModule: 'marketing',
        actionLabel: 'Create campaign',
        actionRoute: '/app/marketing?tab=create',
        severity: 55,
      });
    }

    if (s.content.draftCampaignCount > 2) {
      recs.push({
        id: 'cross-draft-send',
        type: 'opportunity',
        priority: 'low',
        title: 'Draft campaigns waiting to send',
        description: `${s.content.draftCampaignCount} draft campaign${s.content.draftCampaignCount > 1 ? 's are' : ' is'} ready — schedule or send them to engage your audience.`,
        sourceModule: 'marketing',
        targetModule: 'marketing',
        actionLabel: 'Open campaigns',
        actionRoute: '/app/marketing?tab=create&submode=campaigns',
        severity: 40,
      });
    }

    if (s.expenses.budgetUtilization > 90) {
      recs.push({
        id: 'cross-budget-alert',
        type: 'risk',
        priority: 'high',
        title: 'Budget nearly exhausted',
        description: `Budget utilization is at ${Math.round(s.expenses.budgetUtilization)}% — review spending to avoid overshoot.`,
        explanation: 'Consider reallocating or pausing non-essential spend until the next budget period.',
        sourceModule: 'expenses',
        targetModule: 'expenses',
        actionLabel: 'Review budgets',
        actionRoute: '/app/expenses?tab=budgets',
        severity: 80,
      });
    }

    if (s.automations.activeCount === 0 && s.contacts.total > 5) {
      recs.push({
        id: 'cross-no-automations',
        type: 'opportunity',
        priority: 'medium',
        title: 'No active automations',
        description: 'You have no active automations — set up flows to automatically follow up with new leads, send reminders, or trigger tasks.',
        explanation: 'Even one automation can save hours per week and prevent leads from slipping through the cracks.',
        sourceModule: 'automations',
        targetModule: 'automations',
        actionLabel: 'Set up flows',
        actionRoute: '/app/automations',
        severity: 50,
      });
    }

    return recs;
  }

  private generateModuleRecommendations(s: BusinessGraphSnapshot, module: WorkspaceModule): WorkspaceRecommendation[] {
    const recs: WorkspaceRecommendation[] = [];

    switch (module) {
      case 'crm': {
        const leadPct = s.contacts.total > 0 ? Math.round((s.contacts.byStatus['LEAD'] || 0) / s.contacts.total * 100) : 0;
        if (leadPct > 50) {
          recs.push({
            id: 'crm-high-lead-ratio',
            type: 'insight',
            priority: 'medium',
            title: 'High lead-to-client ratio',
            description: `${leadPct}% of your contacts are still leads — consider qualifying and converting them.`,
            sourceModule: 'crm',
            targetModule: 'crm',
            actionLabel: 'Filter leads',
            actionRoute: '/app/crm/pipeline?status=LEAD',
            severity: 50,
          });
        }
        if (s.contacts.topClients.length > 0) {
          const topClient = s.contacts.topClients[0];
          recs.push({
            id: 'crm-top-client',
            type: 'opportunity',
            priority: 'low',
            title: `Top client: ${topClient.name}`,
            description: `${topClient.name} has generated TTD ${topClient.revenue.toLocaleString()} — consider an upsell or loyalty gesture.`,
            sourceModule: 'crm',
            targetModule: 'crm',
            severity: 35,
          });
        }
        break;
      }
      case 'revenue': {
        if (s.revenue.averageInvoiceValue > 0 && s.revenue.monthlyRevenue < s.revenue.averageInvoiceValue * 3) {
          recs.push({
            id: 'revenue-low-monthly',
            type: 'risk',
            priority: 'medium',
            title: 'Monthly revenue below target',
            description: `Monthly revenue (TTD ${s.revenue.monthlyRevenue.toLocaleString()}) is below expected — focus on closing pending quotes.`,
            sourceModule: 'revenue',
            targetModule: 'revenue',
            actionLabel: 'View quotes',
            actionRoute: '/app/commerce?tab=quotes',
            severity: 65,
          });
        }
        break;
      }
      case 'bookings': {
        if (s.bookings.utilizationRate < 40 && s.bookings.upcomingCount > 0) {
          recs.push({
            id: 'bookings-low-util',
            type: 'insight',
            priority: 'medium',
            title: 'Low booking utilization',
            description: `Utilization is at ${Math.round(s.bookings.utilizationRate)}% — consider promoting availability or adjusting pricing.`,
            sourceModule: 'bookings',
            targetModule: 'bookings',
            actionLabel: 'View performance',
            actionRoute: '/app/bookings?tab=performance',
            severity: 50,
          });
        }
        if (s.bookings.cancelledThisMonth > 2) {
          recs.push({
            id: 'bookings-cancellations',
            type: 'risk',
            priority: 'medium',
            title: 'Rising cancellations',
            description: `${s.bookings.cancelledThisMonth} booking${s.bookings.cancelledThisMonth > 1 ? 's' : ''} cancelled this month — review reasons and consider a deposit policy.`,
            sourceModule: 'bookings',
            targetModule: 'bookings',
            severity: 55,
          });
        }
        break;
      }
      case 'marketing': {
        if (s.content.scheduledPostCount === 0 && s.content.draftPostCount > 0) {
          recs.push({
            id: 'marketing-no-scheduled',
            type: 'action',
            priority: 'medium',
            title: 'No scheduled content',
            description: `You have ${s.content.draftPostCount} draft${s.content.draftPostCount > 1 ? 's' : ''} but nothing scheduled — schedule posts to maintain consistent presence.`,
            sourceModule: 'marketing',
            targetModule: 'marketing',
            actionLabel: 'Schedule content',
            actionRoute: '/app/marketing?tab=calendar',
            severity: 50,
          });
        }
        break;
      }
      case 'projects': {
        if (s.projects.activeCount > 0 && s.projects.completionRate < 50) {
          recs.push({
            id: 'projects-low-completion',
            type: 'risk',
            priority: 'medium',
            title: 'Low task completion rate',
            description: `Only ${Math.round(s.projects.completionRate)}% of tasks completed across active projects — review task assignments and deadlines.`,
            sourceModule: 'projects',
            targetModule: 'projects',
            severity: 60,
          });
        }
        break;
      }
      case 'expenses': {
        if (s.expenses.topCategories.length > 0) {
          const top = s.expenses.topCategories[0];
          const totalSpend = s.expenses.totalThisMonth;
          const pct = totalSpend > 0 ? Math.round((top.amount / totalSpend) * 100) : 0;
          if (pct > 50) {
            recs.push({
              id: 'expenses-concentration',
              type: 'insight',
              priority: 'low',
              title: `Spending concentrated in ${top.name}`,
              description: `${pct}% of monthly spend (TTD ${top.amount.toLocaleString()}) is in "${top.name}" — ensure this is intentional.`,
              sourceModule: 'expenses',
              targetModule: 'expenses',
              severity: 40,
            });
          }
        }
        if (s.revenue.monthlyRevenue > 0 && s.expenses.totalThisMonth > s.revenue.monthlyRevenue * 0.7) {
          recs.push({
            id: 'expenses-margin-pressure',
            type: 'risk',
            priority: 'high',
            title: 'Margin pressure detected',
            description: `Expenses (TTD ${s.expenses.totalThisMonth.toLocaleString()}) are ${Math.round((s.expenses.totalThisMonth / s.revenue.monthlyRevenue) * 100)}% of revenue — margins may be too thin.`,
            sourceModule: 'expenses',
            targetModule: 'revenue',
            actionLabel: 'Analyze profitability',
            actionRoute: '/app/expenses?tab=insights',
            severity: 75,
          });
        }
        break;
      }
    }

    return recs;
  }
}
