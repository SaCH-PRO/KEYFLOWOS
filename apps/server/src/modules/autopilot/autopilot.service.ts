import { Injectable, Inject } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CrmTimelineService } from '../crm/crm-timeline.service';
import { CONTACT_EVENT } from '@keyflow/shared';

interface AutopilotTaskInput {
  businessId: string;
  title: string;
  description?: string;
  category: string;
  priority?: string;
  autoExecutable?: boolean;
  requiresApproval?: boolean;
  approvalData?: Record<string, unknown>;
  scheduledFor?: Date;
  dueDate?: Date;
  relatedType?: string;
  relatedId?: string;
  aiContext?: Record<string, unknown>;
}

interface TaskTemplate {
  title: string;
  description: string;
  category: string;
  priority: string;
  autoExecutable: boolean;
  requiresApproval: boolean;
}

const SETUP_TASKS: Record<string, TaskTemplate[]> = {
  LOCAL_SERVICE: [
    { title: 'Add your first service offering', description: 'Create at least one service with pricing', category: 'SETUP', priority: 'HIGH', autoExecutable: false, requiresApproval: false },
    { title: 'Set up business hours', description: 'Define when customers can book appointments', category: 'SETUP', priority: 'NORMAL', autoExecutable: false, requiresApproval: false },
    { title: 'Add service area', description: 'Define the locations where you provide service', category: 'SETUP', priority: 'NORMAL', autoExecutable: false, requiresApproval: false },
  ],
  DIGITAL_PRODUCT: [
    { title: 'Create your first digital product', description: 'Add a course, template, or digital download', category: 'SETUP', priority: 'HIGH', autoExecutable: false, requiresApproval: false },
    { title: 'Set up payment processing', description: 'Connect payment gateway to accept payments', category: 'SETUP', priority: 'HIGH', autoExecutable: false, requiresApproval: false },
    { title: 'Create a landing page', description: 'Build a page to showcase your product', category: 'MARKETING', priority: 'NORMAL', autoExecutable: false, requiresApproval: false },
  ],
  AGENCY: [
    { title: 'Define your service packages', description: 'Create tiered service offerings for clients', category: 'SETUP', priority: 'HIGH', autoExecutable: false, requiresApproval: false },
    { title: 'Set up client onboarding flow', description: 'Create a playbook for new client intake', category: 'OPERATIONS', priority: 'NORMAL', autoExecutable: false, requiresApproval: false },
    { title: 'Create proposal template', description: 'Build a reusable quote template', category: 'SALES', priority: 'NORMAL', autoExecutable: false, requiresApproval: false },
  ],
  CLINIC: [
    { title: 'Add your services', description: 'Define the services/treatments you offer', category: 'SETUP', priority: 'HIGH', autoExecutable: false, requiresApproval: false },
    { title: 'Set up appointment scheduling', description: 'Configure booking calendar and availability', category: 'SETUP', priority: 'HIGH', autoExecutable: false, requiresApproval: false },
    { title: 'Add staff members', description: 'Add practitioners who will see patients', category: 'SETUP', priority: 'NORMAL', autoExecutable: false, requiresApproval: false },
  ],
  ECOMMERCE: [
    { title: 'Add your first product', description: 'Create a product listing with photos and pricing', category: 'SETUP', priority: 'HIGH', autoExecutable: false, requiresApproval: false },
    { title: 'Set up shipping options', description: 'Configure delivery methods and rates', category: 'SETUP', priority: 'HIGH', autoExecutable: false, requiresApproval: false },
    { title: 'Connect payment gateway', description: 'Enable customers to pay online', category: 'SETUP', priority: 'HIGH', autoExecutable: false, requiresApproval: false },
  ],
};

@Injectable()
export class AutopilotService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CrmTimelineService) private readonly timeline: CrmTimelineService,
  ) {}

  async getTodaysTasks(businessId: string, limit: number = 3) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    return this.prisma.client.autopilotTask.findMany({
      where: {
        businessId,
        status: { in: ['PENDING', 'IN_PROGRESS', 'AWAITING_APPROVAL'] },
        OR: [
          { scheduledFor: { gte: today, lt: tomorrow } },
          { scheduledFor: null },
        ],
      },
      orderBy: [
        { priority: 'desc' },
        { createdAt: 'asc' },
      ],
      take: limit,
    });
  }

  async getAllTasks(businessId: string, status?: string) {
    return this.prisma.client.autopilotTask.findMany({
      where: {
        businessId,
        ...(status ? { status } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async countTasksForDate(businessId: string, date: Date): Promise<number> {
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    return this.prisma.client.autopilotTask.count({
      where: {
        businessId,
        status: { in: ['PENDING', 'IN_PROGRESS', 'AWAITING_APPROVAL'] },
        OR: [
          { scheduledFor: { gte: dayStart, lt: dayEnd } },
          { scheduledFor: null, createdAt: { gte: dayStart, lt: dayEnd } },
        ],
      },
    });
  }

  async createTask(input: AutopilotTaskInput) {
    const scheduleDate = input.scheduledFor || new Date();
    const existingCount = await this.countTasksForDate(input.businessId, scheduleDate);
    
    if (existingCount >= 3) {
      throw new Error('Daily task limit reached (max 3 tasks per day). Task will be scheduled for tomorrow.');
    }

    return this.prisma.client.autopilotTask.create({
      data: {
        businessId: input.businessId,
        title: input.title,
        description: input.description,
        category: input.category,
        priority: input.priority || 'NORMAL',
        autoExecutable: input.autoExecutable || false,
        requiresApproval: input.requiresApproval || false,
        approvalData: input.approvalData as Prisma.InputJsonValue | undefined,
        scheduledFor: input.scheduledFor,
        dueDate: input.dueDate,
        relatedType: input.relatedType,
        relatedId: input.relatedId,
        aiContext: input.aiContext as Prisma.InputJsonValue | undefined,
      },
    });
  }

  async updateTaskStatus(taskId: string, businessId: string, status: string, executedBy?: string) {
    const task = await this.prisma.client.autopilotTask.findUnique({
      where: { id: taskId, businessId },
    });

    if (!task) {
      throw new Error('Task not found');
    }

    if (status === 'COMPLETED' && task.requiresApproval && !task.approvedAt) {
      throw new Error('This task requires approval before it can be marked as completed');
    }

    return this.prisma.client.autopilotTask.update({
      where: { id: taskId, businessId },
      data: {
        status,
        ...(status === 'COMPLETED' || status === 'AUTO_EXECUTED' ? { executedAt: new Date(), executedBy } : {}),
      },
    });
  }

  async approveTask(taskId: string, businessId: string, approvedBy: string) {
    const task = await this.prisma.client.autopilotTask.findUnique({
      where: { id: taskId, businessId },
    });

    if (!task || !task.requiresApproval) {
      return null;
    }

    return this.prisma.client.autopilotTask.update({
      where: { id: taskId },
      data: {
        status: 'COMPLETED',
        approvedAt: new Date(),
        approvedBy,
        executedAt: new Date(),
        executedBy: 'SYSTEM',
      },
    });
  }

  async denyTask(taskId: string, businessId: string) {
    return this.prisma.client.autopilotTask.update({
      where: { id: taskId, businessId },
      data: { status: 'SKIPPED' },
    });
  }

  async generateSetupTasks(businessId: string) {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { archetype: true, autopilotStage: true },
    });

    if (!business?.archetype) return [];

    const archetype = business.archetype as keyof typeof SETUP_TASKS;
    const templates = SETUP_TASKS[archetype] || SETUP_TASKS.LOCAL_SERVICE;

    const existingTasks = await this.prisma.client.autopilotTask.findMany({
      where: { businessId, category: 'SETUP' },
      select: { title: true },
    });
    const existingTitles = new Set(existingTasks.map((t: { title: string }) => t.title));

    const newTasks = templates.filter(t => !existingTitles.has(t.title));

    const todayTaskCount = await this.countTasksForDate(businessId, new Date());
    const slotsToday = Math.max(0, 3 - todayTaskCount);

    const created: Array<unknown> = [];
    let dayOffset = 0;
    let slotsInCurrentDay = slotsToday;

    for (const template of newTasks) {
      if (slotsInCurrentDay <= 0) {
        dayOffset++;
        slotsInCurrentDay = 3;
      }

      const scheduledFor = new Date();
      scheduledFor.setDate(scheduledFor.getDate() + dayOffset);
      scheduledFor.setHours(9, 0, 0, 0);

      const task = await this.prisma.client.autopilotTask.create({
        data: {
          businessId,
          title: template.title,
          description: template.description,
          category: template.category,
          priority: template.priority,
          autoExecutable: template.autoExecutable,
          requiresApproval: template.requiresApproval,
          scheduledFor,
        },
      });
      created.push(task);
      slotsInCurrentDay--;
    }

    return created;
  }

  async getTaskStats(businessId: string) {
    const [pending, completed, autoExecuted] = await Promise.all([
      this.prisma.client.autopilotTask.count({ where: { businessId, status: 'PENDING' } }),
      this.prisma.client.autopilotTask.count({ where: { businessId, status: 'COMPLETED' } }),
      this.prisma.client.autopilotTask.count({ where: { businessId, status: 'AUTO_EXECUTED' } }),
    ]);

    return {
      pending,
      completed,
      autoExecuted,
      total: pending + completed + autoExecuted,
      automationRate: (autoExecuted / (completed + autoExecuted)) * 100 || 0,
    };
  }

  async getCriticalAlerts(businessId: string) {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { complianceStatus: true, lastHealthCheck: true },
    });

    const alerts: Array<{ type: string; severity: string; message: string; action?: string }> = [];

    if (business?.complianceStatus === 'RED') {
      alerts.push({
        type: 'COMPLIANCE',
        severity: 'CRITICAL',
        message: 'Urgent compliance action required',
        action: '/app/settings/compliance',
      });
    } else if (business?.complianceStatus === 'YELLOW') {
      alerts.push({
        type: 'COMPLIANCE',
        severity: 'WARNING',
        message: 'Compliance items need attention soon',
        action: '/app/settings/compliance',
      });
    }

    const overdueInvoices = await this.prisma.client.invoice.count({
      where: {
        businessId,
        status: 'SENT',
        dueDate: { lt: new Date() },
      },
    });

    if (overdueInvoices > 0) {
      alerts.push({
        type: 'PAYMENT',
        severity: 'WARNING',
        message: `${overdueInvoices} invoice${overdueInvoices > 1 ? 's' : ''} overdue`,
        action: '/app/commerce?tab=invoices&filter=overdue',
      });
    }

    const awaitingApproval = await this.prisma.client.autopilotTask.count({
      where: { businessId, status: 'AWAITING_APPROVAL' },
    });

    if (awaitingApproval > 0) {
      alerts.push({
        type: 'APPROVAL',
        severity: 'INFO',
        message: `${awaitingApproval} item${awaitingApproval > 1 ? 's' : ''} awaiting your approval`,
      });
    }

    return alerts;
  }

  async getSettings(businessId: string) {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { metaData: true, autopilotEnabled: true },
    });

    const meta = (business?.metaData as Record<string, unknown>) || {};
    const autopilot = (meta.autopilot as Record<string, unknown>) || {};

    return {
      enabled: business?.autopilotEnabled ?? false,
      pausedUntil: autopilot.pausedUntil ?? null,
      triggers: {
        follow_up: autopilot.trigger_follow_up !== false,
        birthday: autopilot.trigger_birthday !== false,
        payment_reminder: autopilot.trigger_payment_reminder !== false,
        check_in: autopilot.trigger_check_in !== false,
        offer: autopilot.trigger_offer !== false,
      },
      autoApproveTypes: (autopilot.autoApproveTypes as string[]) || [],
      quietHoursStart: autopilot.quietHoursStart ?? '22:00',
      quietHoursEnd: autopilot.quietHoursEnd ?? '07:00',
    };
  }

  async updateSettings(businessId: string, settings: Record<string, unknown>) {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { metaData: true },
    });

    const meta = (business?.metaData as Record<string, unknown>) || {};
    const existingAutopilot = (meta.autopilot as Record<string, unknown>) || {};

    const triggers = settings.triggers as Record<string, boolean> | undefined;
    const updatedAutopilot = {
      ...existingAutopilot,
      ...(settings.pausedUntil !== undefined ? { pausedUntil: settings.pausedUntil } : {}),
      ...(triggers ? {
        trigger_follow_up: triggers.follow_up,
        trigger_birthday: triggers.birthday,
        trigger_payment_reminder: triggers.payment_reminder,
        trigger_check_in: triggers.check_in,
        trigger_offer: triggers.offer,
      } : {}),
      ...(settings.autoApproveTypes !== undefined ? { autoApproveTypes: settings.autoApproveTypes } : {}),
      ...(settings.quietHoursStart !== undefined ? { quietHoursStart: settings.quietHoursStart } : {}),
      ...(settings.quietHoursEnd !== undefined ? { quietHoursEnd: settings.quietHoursEnd } : {}),
    };

    const updateData: Record<string, unknown> = {
      metaData: { ...meta, autopilot: updatedAutopilot },
    };

    if (settings.enabled !== undefined) {
      updateData.autopilotEnabled = settings.enabled;
    }

    await this.prisma.client.business.update({
      where: { id: businessId },
      data: updateData as any,
    });

    return this.getSettings(businessId);
  }

  async executeAction(
    businessId: string,
    actionId: string,
    contactId: string,
    channel: string,
    message: string,
  ) {
    const eventData: Record<string, unknown> = {
      actionId,
      channel,
      message: message.slice(0, 500),
      executedAt: new Date().toISOString(),
      source: 'autopilot',
    };

    if (contactId) {
      await this.timeline.logEvent(
        businessId,
        contactId,
        channel === 'whatsapp' ? CONTACT_EVENT.WHATSAPP_SENT : channel === 'email' ? CONTACT_EVENT.EMAIL_SENT : CONTACT_EVENT.AUTOPILOT_EXECUTED,
        { ...eventData as any, description: `Autopilot: ${message.slice(0, 200)}` },
        { actorType: 'AI', actorId: 'autopilot', source: 'autopilot' },
      );
    }

    const realTaskId = actionId.replace(/^(auto_|pending_|overdue_inv_|checkin_|nudge_|postbooking_|autowelcome_|stalenudge_)/, '');
    try {
      await this.updateTaskStatus(realTaskId, businessId, 'AUTO_EXECUTED', 'autopilot');
    } catch {
      // Action may not correspond to an AutopilotTask (CRM flow actions use synthetic IDs)
    }

    return { success: true, eventLogged: !!contactId };
  }
}
