import { Injectable, Logger, Inject } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { RoleEngineService, BusinessRole } from './role-engine.service';

export interface GoalAction {
  id: string;
  title: string;
  toolName: string;
  args: Record<string, any>;
  role: BusinessRole;
  priority: number;
  executed: boolean;
  executedAt?: Date;
}

export interface GoalProgress {
  current: number;
  target: number;
  percent: number;
  daysRemaining: number;
  dailyTarget: number;
  onTrack: boolean;
}

@Injectable()
export class GoalTrackerService {
  private readonly logger = new Logger(GoalTrackerService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
    @Inject(RoleEngineService) private readonly roleEngine: RoleEngineService,
  ) {}

  async createGoal(businessId: string, data: {
    title: string;
    description?: string;
    category: string;
    targetValue?: number;
    unit?: string;
    deadline?: Date;
    role?: BusinessRole;
    autoActions?: boolean;
  }): Promise<any> {
    const goal = await this.prisma.client.businessGoal.create({
      data: {
        businessId,
        title: data.title,
        description: data.description ?? null,
        category: data.category,
        targetValue: data.targetValue ?? null,
        unit: data.unit ?? null,
        deadline: data.deadline ?? null,
        role: data.role ?? null,
        autoActions: data.autoActions ?? true,
        currentValue: 0,
        status: 'active',
        actions: [],
      },
    });

    this.events.emit('goal.created', { businessId, goalId: goal.id });
    return goal;
  }

  async getGoals(businessId: string, filters?: { status?: string; category?: string; role?: string }): Promise<any[]> {
    const where: any = { businessId };
    if (filters?.status) where.status = filters.status;
    if (filters?.category) where.category = filters.category;
    if (filters?.role) where.role = filters.role;

    const goals = await this.prisma.client.businessGoal.findMany({
      where,
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
    });

    return goals.map((g) => ({
      ...g,
      progress: this.calculateProgress(g.currentValue, g.targetValue, g.deadline),
    }));
  }

  async getGoal(businessId: string, goalId: string): Promise<any | null> {
    const goal = await this.prisma.client.businessGoal.findFirst({
      where: { id: goalId, businessId },
    });
    if (!goal) return null;

    return {
      ...goal,
      progress: this.calculateProgress(goal.currentValue, goal.targetValue, goal.deadline),
    };
  }

  async updateGoal(businessId: string, goalId: string, data: Partial<{
    title: string;
    description: string;
    targetValue: number;
    unit: string;
    deadline: Date;
    status: string;
    priority: number;
    role: string;
    autoActions: boolean;
  }>): Promise<any> {
    const goal = await this.prisma.client.businessGoal.update({
      where: { id: goalId },
      data: data as any,
    });

    this.events.emit('goal.updated', { businessId, goalId });
    return goal;
  }

  async deleteGoal(businessId: string, goalId: string): Promise<void> {
    await this.prisma.client.businessGoal.deleteMany({
      where: { id: goalId, businessId },
    });
    this.events.emit('goal.deleted', { businessId, goalId });
  }

  async updateProgress(businessId: string, goalId: string): Promise<any> {
    const goal = await this.prisma.client.businessGoal.findFirst({
      where: { id: goalId, businessId },
    });
    if (!goal) return null;

    let currentValue = goal.currentValue ?? 0;

    // Recalculate based on category
    switch (goal.category) {
      case 'revenue': {
        const startOfPeriod = this.getPeriodStart(goal.deadline);
        const revenue = await this.prisma.client.invoice.aggregate({
          where: {
            businessId,
            status: { in: ['PAID', 'SENT'] },
            createdAt: { gte: startOfPeriod },
          },
          _sum: { total: true },
        });
        currentValue = revenue._sum.total ?? 0;
        break;
      }
      case 'leads': {
        const startOfPeriod = this.getPeriodStart(goal.deadline);
        const count = await this.prisma.client.contact.count({
          where: {
            businessId,
            status: 'LEAD',
            createdAt: { gte: startOfPeriod },
          },
        });
        currentValue = count;
        break;
      }
      case 'retention': {
        // Rebooking rate: contacts with 2+ bookings in period
        const startOfPeriod = this.getPeriodStart(goal.deadline);
        const bookings = await this.prisma.client.booking.groupBy({
          by: ['contactId'],
          where: {
            businessId,
            startTime: { gte: startOfPeriod },
            status: { not: 'CANCELLED' },
          },
          _count: { contactId: true },
        });
        const repeaters = bookings.filter((b) => b._count.contactId >= 2).length;
        const total = bookings.length;
        currentValue = total > 0 ? Math.round((repeaters / total) * 100) : 0;
        break;
      }
    }

    const updated = await this.prisma.client.businessGoal.update({
      where: { id: goalId },
      data: { currentValue },
    });

    // Auto-mark as achieved if target reached
    if (goal.targetValue && currentValue >= goal.targetValue && goal.status === 'active') {
      await this.prisma.client.businessGoal.update({
        where: { id: goalId },
        data: { status: 'achieved' },
      });
      this.events.emit('goal.achieved', { businessId, goalId });
    }

    return { ...updated, progress: this.calculateProgress(currentValue, goal.targetValue, goal.deadline) };
  }

  async suggestActions(businessId: string, goalId: string): Promise<GoalAction[]> {
    const goal = await this.getGoal(businessId, goalId);
    if (!goal) return [];

    const progress = goal.progress as GoalProgress;
    if (!progress || progress.onTrack) return [];

    const actions: GoalAction[] = [];

    switch (goal.category) {
      case 'revenue': {
        const dailyShortfall = Math.max(0, progress.dailyTarget - (progress.current / Math.max(1, progress.daysRemaining)));
        if (dailyShortfall > 0) {
          actions.push({
            id: `goal-${goalId}-action-1`,
            title: `Send ${Math.ceil(dailyShortfall / 500)} quote(s) to close revenue gap`,
            toolName: 'commerce_create_quote',
            args: { urgency: 'high' },
            role: 'sales',
            priority: 1,
            executed: false,
          });
          actions.push({
            id: `goal-${goalId}-action-2`,
            title: 'Upsell 1 existing client with add-on service',
            toolName: 'crm_search_contacts',
            args: { status: 'CLIENT', limit: 5 },
            role: 'sales',
            priority: 2,
            executed: false,
          });
        }
        break;
      }
      case 'leads': {
        actions.push({
          id: `goal-${goalId}-action-1`,
          title: 'Launch lead capture campaign',
          toolName: 'draft_campaign_bundle',
          args: { campaignType: 'lead_generation', targetAudience: 'new' },
          role: 'marketing',
          priority: 1,
          executed: false,
        });
        actions.push({
          id: `goal-${goalId}-action-2`,
          title: 'Send referral request to 5 best clients',
          toolName: 'send_message_with_approval',
          args: { channel: 'email', purpose: 'referral_request' },
          role: 'sales',
          priority: 2,
          executed: false,
        });
        break;
      }
      case 'retention': {
        actions.push({
          id: `goal-${goalId}-action-1`,
          title: 'Send rebooking offer to recent clients',
          toolName: 'send_message_with_approval',
          args: { channel: 'email', purpose: 'rebooking' },
          role: 'sales',
          priority: 1,
          executed: false,
        });
        break;
      }
    }

    // Store suggested actions
    await this.prisma.client.businessGoal.update({
      where: { id: goalId },
      data: { actions: actions as any },
    });

    return actions;
  }

  async getActiveGoalsWithActions(businessId: string): Promise<any[]> {
    const goals = await this.getGoals(businessId, { status: 'active' });
    const result = [];

    for (const goal of goals) {
      const progress = goal.progress as GoalProgress;
      if (!progress?.onTrack && goal.autoActions) {
        const actions = await this.suggestActions(businessId, goal.id);
        result.push({ ...goal, suggestedActions: actions });
      } else {
        result.push(goal);
      }
    }

    return result;
  }

  private calculateProgress(currentValue: number | null, targetValue: number | null, deadline: Date | null): GoalProgress {
    const current = currentValue ?? 0;
    const target = targetValue ?? 1;
    const percent = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;

    if (!deadline) {
      return { current, target, percent, daysRemaining: 0, dailyTarget: 0, onTrack: true };
    }

    const now = new Date();
    const daysRemaining = Math.max(0, Math.ceil((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
    const dailyTarget = daysRemaining > 0 ? Math.ceil((target - current) / daysRemaining) : 0;
    const onTrack = daysRemaining === 0 ? current >= target : dailyTarget <= (target / Math.max(1, Math.ceil((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))));

    return { current, target, percent, daysRemaining, dailyTarget, onTrack: percent >= 50 || onTrack };
  }

  private getPeriodStart(deadline: Date | null): Date {
    const now = new Date();
    if (!deadline) return new Date(now.getFullYear(), now.getMonth(), 1);

    const diffMs = deadline.getTime() - now.getTime();
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays <= 7) return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    if (diffDays <= 31) return new Date(now.getFullYear(), now.getMonth(), 1);
    if (diffDays <= 90) return new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
    return new Date(now.getFullYear(), 0, 1);
  }
}
