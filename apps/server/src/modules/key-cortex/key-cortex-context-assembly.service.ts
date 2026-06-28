import { Injectable, Logger } from '@nestjs/common';
import {
  ModuleName,
  ModuleContextSlice,
  FullBusinessContext,
} from './key-cortex-connector.types';
import {
  CrmAdapterService,
  CommerceAdapterService,
  BookingsAdapterService,
  CommunicationsAdapterService,
  ContentAdapterService,
  FlowAdapterService,
  AutopilotAdapterService,
  TemporalAdapterService,
  InboxAdapterService,
  NotificationsAdapterService,
  ProjectsAdapterService,
  ActivityAdapterService,
} from './adapters';

/**
 * Assembles the full business context snapshot consumed by KEY Cortex.
 *
 * v1 -- Extracted from KeyCortexConnectorService as part of Phase 0.7
 * god-service decomposition.  Gathers per-module slices from the typed
 * adapters and aggregates summary counters.
 */
@Injectable()
export class KeyCortexContextAssemblyService {
  private readonly logger = new Logger(KeyCortexContextAssemblyService.name);

  constructor(
    private readonly crm: CrmAdapterService,
    private readonly commerce: CommerceAdapterService,
    private readonly bookings: BookingsAdapterService,
    private readonly communications: CommunicationsAdapterService,
    private readonly content: ContentAdapterService,
    private readonly flow: FlowAdapterService,
    private readonly autopilot: AutopilotAdapterService,
    private readonly temporal: TemporalAdapterService,
    private readonly inbox: InboxAdapterService,
    private readonly notifications: NotificationsAdapterService,
    private readonly projects: ProjectsAdapterService,
    private readonly activity: ActivityAdapterService,
  ) {}

  /**
   * Gather context slices from ALL modules to build a comprehensive
   * business snapshot for the AI reasoning engine.
   */
  async getFullContext(businessId: string): Promise<FullBusinessContext> {
    const gatheredAt = new Date();
    const modules: Partial<Record<ModuleName, ModuleContextSlice>> = {};
    let activeAlerts = 0;
    let pendingTasks = 0;
    let recentRevenue = 0;
    let openConversations = 0;

    // CRM context
    try {
      const contacts = await this.crm.listContacts({ businessId, limit: 5 });
      const tasks = await this.crm.getOpenTasks({ businessId });
      pendingTasks += tasks.length;
      modules.crm = {
        module: 'crm',
        summary: `${contacts.length} recent contacts, ${tasks.length} open tasks`,
        recordCount: contacts.length,
        urgentItems: tasks.filter((t: Record<string, unknown>) => (t.priority === 'high' || t.priority === 'urgent')).map((t: Record<string, unknown>) => t.title as string),
        data: { recentContacts: contacts, openTasks: tasks },
      };
    } catch (e) {
      this.logger.warn(`CRM context failed: ${(e as Error).message}`);
    }

    // Commerce context
    try {
      const invoices = await this.commerce.listInvoices({ businessId, status: 'overdue' });
      const revenue = await this.commerce.getRevenueSummary({ businessId, period: 'this_month' });
      recentRevenue = revenue.total || 0;
      modules.commerce = {
        module: 'commerce',
        summary: `${invoices.length} overdue invoices, $${recentRevenue} revenue this month`,
        recordCount: invoices.length,
        urgentItems: invoices.length > 0 ? [`${invoices.length} overdue invoices`] : [],
        data: { overdueInvoices: invoices, revenueSummary: revenue },
      };
    } catch (e) {
      this.logger.warn(`Commerce context failed: ${(e as Error).message}`);
    }

    // Bookings context
    try {
      const todayBookings = await this.bookings.getUpcomingBookings({ businessId, from: new Date().toISOString(), limit: 10 });
      modules.bookings = {
        module: 'bookings',
        summary: `${todayBookings.length} upcoming bookings`,
        recordCount: todayBookings.length,
        urgentItems: [],
        data: { upcoming: todayBookings },
      };
    } catch (e) {
      this.logger.warn(`Bookings context failed: ${(e as Error).message}`);
    }

    // Communications context
    try {
      const unreadConversations = await this.communications.getUnreadConversations({ businessId });
      openConversations = unreadConversations.length;
      modules.communications = {
        module: 'communications',
        summary: `${unreadConversations.length} unread conversations`,
        recordCount: unreadConversations.length,
        urgentItems: unreadConversations.length > 5 ? [`${unreadConversations.length} unread messages`] : [],
        data: { unreadConversations },
      };
    } catch (e) {
      this.logger.warn(`Communications context failed: ${(e as Error).message}`);
    }

    // Content context
    try {
      const drafts = await this.content.getDrafts({ businessId, limit: 5 });
      const scheduled = await this.content.getScheduledPosts({ businessId, from: new Date().toISOString(), limit: 5 });
      modules.content = {
        module: 'content',
        summary: `${drafts.length} drafts, ${scheduled.length} scheduled posts`,
        recordCount: drafts.length + scheduled.length,
        urgentItems: scheduled.length > 0 ? [`${scheduled.length} posts scheduled`] : [],
        data: { drafts, scheduled },
      };
    } catch (e) {
      this.logger.warn(`Content context failed: ${(e as Error).message}`);
    }

    // Flow context
    try {
      const activeFlows = await this.flow.listAutomations({ businessId, active: true });
      modules.flow = {
        module: 'flow',
        summary: `${activeFlows.length} active automations`,
        recordCount: activeFlows.length,
        urgentItems: [],
        data: { activeAutomations: activeFlows },
      };
    } catch (e) {
      this.logger.warn(`Flow context failed: ${(e as Error).message}`);
    }

    // Autopilot context
    try {
      const autopilotTasks = await this.autopilot.getTasks({ businessId, status: 'pending' });
      const loops = await this.autopilot.listLoops({ businessId, active: true });
      pendingTasks += autopilotTasks.length;
      modules.autopilot = {
        module: 'autopilot',
        summary: `${autopilotTasks.length} pending tasks, ${loops.length} active loops`,
        recordCount: autopilotTasks.length + loops.length,
        urgentItems: autopilotTasks.filter((t: Record<string, unknown>) => (t.priority === 'high' || t.priority === 'urgent')).map((t: Record<string, unknown>) => t.title as string),
        data: { pendingTasks: autopilotTasks, activeLoops: loops },
      };
    } catch (e) {
      this.logger.warn(`Autopilot context failed: ${(e as Error).message}`);
    }

    // Temporal / Memory context
    try {
      const recentMemories = await this.temporal.getRecentMemories({ businessId, limit: 10 });
      modules.temporal = {
        module: 'temporal',
        summary: `${recentMemories.length} recent memories stored`,
        recordCount: recentMemories.length,
        urgentItems: [],
        data: { recentMemories },
      };
    } catch (e) {
      this.logger.warn(`Temporal context failed: ${(e as Error).message}`);
    }

    // Inbox context
    try {
      const inboxThreads = await this.inbox.getThreads({ businessId, status: 'open', limit: 10 });
      modules.inbox = {
        module: 'inbox',
        summary: `${inboxThreads.length} open inbox threads`,
        recordCount: inboxThreads.length,
        urgentItems: inboxThreads.filter((t: Record<string, unknown>) => t.priority === 'urgent').map((t: Record<string, unknown>) => t.subject as string),
        data: { openThreads: inboxThreads },
      };
    } catch (e) {
      this.logger.warn(`Inbox context failed: ${(e as Error).message}`);
    }

    // Notifications / Alerts
    try {
      const alerts = await this.notifications.getAlerts({ businessId, acknowledged: false });
      activeAlerts = alerts.length;
      modules.notifications = {
        module: 'notifications',
        summary: `${alerts.length} active alerts`,
        recordCount: alerts.length,
        urgentItems: alerts.filter((a: Record<string, unknown>) => (a.severity === 'critical' || a.severity === 'warning')).map((a: Record<string, unknown>) => a.title as string),
        data: { activeAlerts: alerts },
      };
    } catch (e) {
      this.logger.warn(`Notifications context failed: ${(e as Error).message}`);
    }

    // Projects context
    try {
      const activeProjects = await this.projects.getProjects({ businessId, status: 'active' });
      const overdueProjectTasks = await this.projects.getOverdueTasks({ businessId });
      modules.projects = {
        module: 'projects',
        summary: `${activeProjects.length} active projects, ${overdueProjectTasks.length} overdue tasks`,
        recordCount: activeProjects.length,
        urgentItems: overdueProjectTasks.length > 0 ? [`${overdueProjectTasks.length} overdue project tasks`] : [],
        data: { activeProjects, overdueTasks: overdueProjectTasks },
      };
    } catch (e) {
      this.logger.warn(`Projects context failed: ${(e as Error).message}`);
    }

    // Activity context
    try {
      const recentActivity = await this.activity.getRecent({ businessId, limit: 20 });
      modules.activity = {
        module: 'activity',
        summary: `${recentActivity.length} recent activity entries`,
        recordCount: recentActivity.length,
        urgentItems: [],
        data: { recentActivity },
      };
    } catch (e) {
      this.logger.warn(`Activity context failed: ${(e as Error).message}`);
    }

    return {
      businessId,
      gatheredAt,
      modules,
      activeAlerts,
      pendingTasks,
      recentRevenue,
      openConversations,
    };
  }
}
