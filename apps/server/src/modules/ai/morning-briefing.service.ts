import { Injectable, Logger, Inject, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CronSchedulerService } from './cron-scheduler.service';
import { PlannerService } from './planner.service';
import { RoleEngineService, BusinessRole } from './role-engine.service';
import { GovernanceService } from './governance.service';

export interface BriefingCard {
  stepOrder: number;
  title: string;
  impact: 'HIGH' | 'MEDIUM' | 'LOW';
  impactScore: number;
  role: BusinessRole;
  suggestedAction: string;
  toolName: string;
  args: Record<string, any>;
  oneClickApprove: boolean;
  module: string;
}

export interface BriefingResult {
  planId: string;
  date: string;
  totalCards: number;
  highImpactCards: number;
  totalAtStake: number;
  cards: BriefingCard[];
}

@Injectable()
export class MorningBriefingService implements OnModuleInit {
  private readonly logger = new Logger(MorningBriefingService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
    @Inject(CronSchedulerService) private readonly cron: CronSchedulerService,
    @Inject(PlannerService) private readonly planner: PlannerService,
    @Inject(RoleEngineService) private readonly roleEngine: RoleEngineService,
    @Inject(GovernanceService) private readonly governance: GovernanceService,
  ) {}

  onModuleInit() {
    this.logger.log('Morning Briefing Service initialized');
    // Briefing cron is managed per-business via AutopilotSettings
    // A separate scheduler would register them; for now, we provide manual generation
  }

  async generateBriefing(businessId: string): Promise<BriefingResult | null> {
    const settings = await this.prisma.client.autopilotSettings.findUnique({ where: { businessId } });
    if (settings && !settings.briefingEnabled) {
      this.logger.log(`Briefing disabled for business ${businessId}`);
      return null;
    }

    const today = new Date().toISOString().split('T')[0];
    const briefingModules = settings?.briefingModules ?? ['commerce', 'crm', 'bookings', 'projects'];

    // Check if briefing already exists for today
    const existing = await this.prisma.client.aiPlan.findFirst({
      where: { businessId, objective: { startsWith: `Daily Briefing — ${today}` } },
      include: { steps: true },
    });
    if (existing) {
      return this.formatBriefingResult(existing);
    }

    const cards: BriefingCard[] = [];

    // Parallel scan of all modules
    const scanResults = await Promise.allSettled([
      briefingModules.includes('commerce') ? this.scanCommerce(businessId) : [],
      briefingModules.includes('crm') ? this.scanCRM(businessId) : [],
      briefingModules.includes('bookings') ? this.scanBookings(businessId) : [],
      briefingModules.includes('projects') ? this.scanProjects(businessId) : [],
      this.scanPendingApprovals(businessId),
      this.scanFailedActions(businessId),
    ]);

    for (const result of scanResults) {
      if (result.status === 'fulfilled') {
        cards.push(...result.value);
      }
    }

    // Sort by impact score descending
    cards.sort((a, b) => b.impactScore - a.impactScore);

    // Take top 10
    const topCards = cards.slice(0, 10);

    if (topCards.length === 0) {
      this.logger.log(`No briefing cards generated for business ${businessId}`);
      return null;
    }

    // Create plan with briefing cards as steps
    const plan = await this.prisma.client.aiPlan.create({
      data: {
        businessId,
        objective: `Daily Briefing — ${today}`,
        rawInput: 'Morning briefing auto-generated scan',
        urgency: 'normal',
        scope: ['briefing'],
        modules: [...new Set(topCards.map((c) => c.module))],
        maxRiskTier: Math.max(...topCards.map((c) => this.governance.getToolTier(c.toolName))),
        status: 'approved', // Briefings are pre-approved as plans
        steps: {
          create: topCards.map((card, idx) => ({
            order: idx + 1,
            status: 'pending',
            toolName: card.toolName,
            module: card.module,
            action: card.title,
            description: card.title,
            riskTier: this.governance.getToolTier(card.toolName),
            requiresApproval: !card.oneClickApprove,
            dependsOn: [],
            inputPayload: card.args as any,
            role: card.role,
          })),
        },
      },
      include: { steps: true },
    });

    const result: BriefingResult = {
      planId: plan.id,
      date: today,
      totalCards: topCards.length,
      highImpactCards: topCards.filter((c) => c.impact === 'HIGH').length,
      totalAtStake: topCards.reduce((sum, c) => sum + (c.args?.amount ?? 0), 0),
      cards: topCards,
    };

    this.events.emit('briefing.generated', {
      businessId,
      planId: plan.id,
      cardCount: topCards.length,
    });

    return result;
  }

  async executeBriefingCard(businessId: string, planId: string, stepId: string): Promise<{ success: boolean; error?: string }> {
    const step = await this.prisma.client.aiPlanStep.findFirst({
      where: { id: stepId, planId },
    });
    if (!step || step.status !== 'pending') {
      return { success: false, error: 'Step not found or not pending' };
    }

    if (!step.toolName) {
      await this.planner.updateStepStatus(stepId, 'completed', { note: 'No tool to execute' });
      return { success: true };
    }

    // Import FlowOrchestrator dynamically to avoid circular deps at module level
    const { FlowOrchestratorService } = await import('./flow-orchestrator.service');
    // Actually, we can't easily instantiate it here. Let's use a simpler approach:
    // The briefing plan is a normal AiPlan that gets executed by the existing plan execution pipeline.
    // This method is just a convenience to trigger execution of a single step.

    // For now, mark as approved and let the plan executor pick it up
    await this.prisma.client.aiPlanStep.update({
      where: { id: stepId },
      data: { status: 'approved' },
    });

    return { success: true };
  }

  async executeAllBriefingCards(businessId: string, planId: string): Promise<{ executed: number; failed: number }> {
    const steps = await this.prisma.client.aiPlanStep.findMany({
      where: { planId, status: 'pending' },
    });

    let executed = 0;
    let failed = 0;
    for (const step of steps) {
      const result = await this.executeBriefingCard(businessId, planId, step.id);
      if (result.success) executed++;
      else failed++;
    }

    return { executed, failed };
  }

  async skipBriefing(businessId: string, planId: string): Promise<void> {
    await this.prisma.client.aiPlan.update({
      where: { id: planId },
      data: { status: 'completed' },
    });
    await this.prisma.client.aiPlanStep.updateMany({
      where: { planId },
      data: { status: 'skipped' },
    });
  }

  async getTodayBriefing(businessId: string): Promise<BriefingResult | null> {
    const today = new Date().toISOString().split('T')[0];
    const plan = await this.prisma.client.aiPlan.findFirst({
      where: { businessId, objective: { startsWith: `Daily Briefing — ${today}` } },
      include: { steps: true },
    });
    if (!plan) return null;
    return this.formatBriefingResult(plan);
  }

  private formatBriefingResult(plan: any): BriefingResult {
    const cards: BriefingCard[] = plan.steps.map((step: any, idx: number) => ({
      stepOrder: step.order,
      title: step.action,
      impact: step.riskTier >= 2 ? 'HIGH' : step.riskTier === 1 ? 'MEDIUM' : 'LOW',
      impactScore: (step.riskTier * 10) + (step.inputPayload?.amount ? Math.min(step.inputPayload.amount / 100, 50) : 0),
      role: (step.role ?? 'general') as BusinessRole,
      suggestedAction: step.action,
      toolName: step.toolName ?? '',
      args: (step.inputPayload as Record<string, any>) ?? {},
      oneClickApprove: step.riskTier <= 2,
      module: step.module ?? 'system',
    }));

    return {
      planId: plan.id,
      date: plan.objective.replace('Daily Briefing — ', ''),
      totalCards: cards.length,
      highImpactCards: cards.filter((c) => c.impact === 'HIGH').length,
      totalAtStake: cards.reduce((sum, c) => sum + (c.args?.amount ?? 0), 0),
      cards,
    };
  }

  // --- Module Scanners ---

  private async scanCommerce(businessId: string): Promise<BriefingCard[]> {
    const cards: BriefingCard[] = [];

    // Overdue invoices
    const overdueInvoices = await this.prisma.client.invoice.findMany({
      where: { businessId, status: 'OVERDUE', deletedAt: null },
      select: { id: true, invoiceNumber: true, contactId: true, total: true, dueDate: true },
      orderBy: { dueDate: 'asc' },
      take: 5,
    });

    for (const inv of overdueInvoices) {
      const daysOverdue = inv.dueDate ? Math.floor((Date.now() - inv.dueDate.getTime()) / (1000 * 60 * 60 * 24)) : 0;
      cards.push({
        stepOrder: cards.length + 1,
        title: `Invoice ${inv.invoiceNumber} is ${daysOverdue} days overdue (${inv.total})`,
        impact: daysOverdue > 14 ? 'HIGH' : 'MEDIUM',
        impactScore: 50 + daysOverdue + (inv.total ? inv.total / 100 : 0),
        role: 'finance',
        suggestedAction: 'Send payment reminder',
        toolName: 'send_message_with_approval',
        args: {
          contactId: inv.contactId,
          channel: 'email',
          subject: `Payment Reminder — Invoice ${inv.invoiceNumber}`,
          body: `Your invoice for ${inv.total} is ${daysOverdue} days overdue. Please arrange payment.`,
        },
        oneClickApprove: true,
        module: 'commerce',
      });
    }

    // Stale quotes
    const staleCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const staleQuotes = await this.prisma.client.quote.findMany({
      where: { businessId, status: 'SENT', sentAt: { lt: staleCutoff }, deletedAt: null },
      select: { id: true, quoteNumber: true, contactId: true, total: true },
      orderBy: { sentAt: 'asc' },
      take: 3,
    });

    for (const quote of staleQuotes) {
      cards.push({
        stepOrder: cards.length + 1,
        title: `Quote ${quote.quoteNumber} has been stale for 7+ days (${quote.total})`,
        impact: 'MEDIUM',
        impactScore: 30 + (quote.total ? quote.total / 100 : 0),
        role: 'sales',
        suggestedAction: 'Send follow-up',
        toolName: 'send_message_with_approval',
        args: {
          contactId: quote.contactId,
          channel: 'email',
          subject: 'Following up on your quote',
          body: 'Just checking in on the quote we sent you. Any questions?',
        },
        oneClickApprove: true,
        module: 'commerce',
      });
    }

    return cards;
  }

  private async scanCRM(businessId: string): Promise<BriefingCard[]> {
    const cards: BriefingCard[] = [];

    // Uncontacted leads
    const leadCutoff = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const staleLeads = await this.prisma.client.contact.findMany({
      where: {
        businessId,
        status: 'LEAD',
        deletedAt: null,
        OR: [
          { lastContactedAt: { lt: leadCutoff } },
          { lastContactedAt: null },
        ],
      },
      select: { id: true, firstName: true, lastName: true, email: true, leadScore: true },
      orderBy: { leadScore: 'desc' },
      take: 5,
    });

    for (const lead of staleLeads) {
      cards.push({
        stepOrder: cards.length + 1,
        title: `Lead ${lead.firstName ?? ''} ${lead.lastName ?? ''} hasn't been contacted in 48h`,
        impact: (lead.leadScore ?? 0) > 70 ? 'HIGH' : 'MEDIUM',
        impactScore: 25 + (lead.leadScore ?? 0),
        role: 'sales',
        suggestedAction: 'Send follow-up message',
        toolName: 'send_message_with_approval',
        args: {
          contactId: lead.id,
          channel: 'email',
          subject: 'Quick check-in',
          body: `Hi ${lead.firstName ?? 'there'}, just wanted to follow up and see if you have any questions about our services.`,
        },
        oneClickApprove: true,
        module: 'crm',
      });
    }

    return cards;
  }

  private async scanBookings(businessId: string): Promise<BriefingCard[]> {
    const cards: BriefingCard[] = [];

    // Upcoming bookings today
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const todayBookings = await this.prisma.client.booking.count({
      where: {
        businessId,
        startTime: { gte: todayStart, lte: todayEnd },
        status: { not: 'CANCELLED' },
      },
    });

    // Check calendar utilization for the week
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);

    const weekBookings = await this.prisma.client.booking.count({
      where: {
        businessId,
        startTime: { gte: weekStart, lte: weekEnd },
        status: { not: 'CANCELLED' },
      },
    });

    // Rough utilization estimate: assume 5 slots/day * 7 days = 35 slots/week
    const utilization = Math.min(100, Math.round((weekBookings / 35) * 100));

    if (utilization < 50) {
      cards.push({
        stepOrder: cards.length + 1,
        title: `Calendar utilization is only ${utilization}% this week`,
        impact: 'HIGH',
        impactScore: 40,
        role: 'operations',
        suggestedAction: 'Run promotion to fill slots',
        toolName: 'draft_campaign_bundle',
        args: {
          campaignType: 'promotion',
          targetAudience: 'existing customers',
          objective: 'Fill calendar gaps',
        },
        oneClickApprove: true,
        module: 'bookings',
      });
    }

    return cards;
  }

  private async scanProjects(businessId: string): Promise<BriefingCard[]> {
    const cards: BriefingCard[] = [];

    const overdueTasks = await this.prisma.client.projectTask.findMany({
      where: {
        businessId,
        isCompleted: false,
        dueDate: { lt: new Date(), not: null },
        deletedAt: null,
      },
      select: { id: true, title: true, dueDate: true, projectId: true },
      orderBy: { dueDate: 'asc' },
      take: 5,
    });

    for (const task of overdueTasks) {
      const daysOverdue = task.dueDate ? Math.floor((Date.now() - task.dueDate.getTime()) / (1000 * 60 * 60 * 24)) : 0;
      cards.push({
        stepOrder: cards.length + 1,
        title: `Task "${task.title}" is ${daysOverdue} days overdue`,
        impact: daysOverdue > 7 ? 'HIGH' : 'MEDIUM',
        impactScore: 20 + daysOverdue * 2,
        role: 'operations',
        suggestedAction: 'Complete or reschedule task',
        toolName: 'create_task',
        args: {
          title: `URGENT: ${task.title}`,
          description: `This task is ${daysOverdue} days overdue. Please prioritize or reschedule.`,
          dueDate: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000).toISOString(),
        },
        oneClickApprove: true,
        module: 'projects',
      });
    }

    return cards;
  }

  private async scanPendingApprovals(businessId: string): Promise<BriefingCard[]> {
    const cards: BriefingCard[] = [];

    const pendingCount = await this.prisma.client.aiApprovalItem.count({
      where: { businessId, status: 'pending' },
    });

    if (pendingCount > 0) {
      cards.push({
        stepOrder: cards.length + 1,
        title: `${pendingCount} AI action${pendingCount > 1 ? 's' : ''} awaiting your approval`,
        impact: 'HIGH',
        impactScore: 35,
        role: 'general',
        suggestedAction: 'Review approval queue',
        toolName: 'fetch_business_summary',
        args: {},
        oneClickApprove: false,
        module: 'system',
      });
    }

    return cards;
  }

  private async scanFailedActions(businessId: string): Promise<BriefingCard[]> {
    const cards: BriefingCard[] = [];

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const failedCount = await this.prisma.client.aiExecutionLog.count({
      where: { businessId, success: false, createdAt: { gte: today } },
    });

    if (failedCount > 0) {
      cards.push({
        stepOrder: cards.length + 1,
        title: `${failedCount} AI action${failedCount > 1 ? 's' : ''} failed today`,
        impact: 'MEDIUM',
        impactScore: 25,
        role: 'general',
        suggestedAction: 'Review failed actions',
        toolName: 'fetch_business_summary',
        args: {},
        oneClickApprove: false,
        module: 'system',
      });
    }

    return cards;
  }
}
