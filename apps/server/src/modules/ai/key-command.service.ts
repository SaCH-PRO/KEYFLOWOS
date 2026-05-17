import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { TimelineService } from '../timeline/timeline.service';
import { ToolResult } from './key-tool.registry';

export enum KeyMode {
  ASK = 'ask',
  DO = 'do',
  PLAN = 'plan',
  AUTO = 'auto',
}

export enum KeyAutonomyLevel {
  READ_ONLY = 0,
  DRAFT = 1,
  INTERNAL_EXEC = 2,
  EXTERNAL_APPROVAL = 3,
  TRUSTED_AUTOPILOT = 4,
}

export interface KeyCommandPlan {
  summary: string;
  steps: Array<{
    tool: string;
    module: string;
    input: Record<string, unknown>;
    riskTier: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    requiresApproval: boolean;
  }>;
}

export interface SuggestedAction {
  id: string;
  contactName: string;
  contactId: string;
  reason: string;
  suggestedMessage?: string;
  expectedValue?: number;
  actionType: 'follow_up' | 'invoice_reminder' | 'booking_confirm' | 'review_request' | 'custom';
}

export interface DoItForMeResult {
  goal: string;
  findings: string[];
  actions: SuggestedAction[];
}

@Injectable()
export class KeyCommandService {
  private readonly logger = new Logger(KeyCommandService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TimelineService) private readonly timeline: TimelineService,
  ) {}

  async receiveCommand(
    businessId: string,
    userId: string | undefined,
    rawInput: string,
    inputMode: 'TEXT' | 'VOICE' = 'TEXT',
    mode: KeyMode = KeyMode.DO,
  ) {
    return (this.prisma.client as any).keyCommand.create({
      data: {
        businessId,
        userId: userId ?? null,
        rawInput,
        inputMode,
        mode,
        status: 'RECEIVED',
      },
    });
  }

  async interpretIntent(commandId: string): Promise<Record<string, unknown>> {
    const cmd = await (this.prisma.client as any).keyCommand.findUnique({ where: { id: commandId } });
    if (!cmd) throw new Error('Command not found');

    const raw = cmd.rawInput.toLowerCase();
    let intent: Record<string, unknown> = { domain: 'general', action: 'unknown', mode: cmd.mode || KeyMode.DO };

    if (raw.includes('follow up') || raw.includes('follow-up') || raw.includes('followup')) {
      intent = { domain: 'contacts', action: 'follow_up', mode: cmd.mode || KeyMode.DO };
    } else if (raw.includes('invoice') || raw.includes('remind') || raw.includes('payment')) {
      intent = { domain: 'commerce', action: 'invoice_reminder', mode: cmd.mode || KeyMode.DO };
    } else if (raw.includes('booking') || raw.includes('appointment') || raw.includes('confirm')) {
      intent = { domain: 'bookings', action: 'booking_confirm', mode: cmd.mode || KeyMode.DO };
    } else if (raw.includes('review') || raw.includes('feedback') || raw.includes('testimonial')) {
      intent = { domain: 'contacts', action: 'review_request', mode: cmd.mode || KeyMode.DO };
    } else if (raw.includes('contact') || raw.includes('customer') || raw.includes('lead')) {
      intent = { domain: 'contacts', action: 'contact_query', mode: cmd.mode || KeyMode.ASK };
    } else if (raw.includes('revenue') || raw.includes('money') || raw.includes('sales')) {
      intent = { domain: 'commerce', action: 'revenue_summary', mode: cmd.mode || KeyMode.ASK };
    } else if (raw.includes('storefront') || raw.includes('website')) {
      intent = { domain: 'storefront', action: 'storefront_audit', mode: cmd.mode || KeyMode.ASK };
    } else if (raw.includes('clean up') || raw.includes('cleanup') || raw.includes('handle tasks')) {
      intent = { domain: 'multi', action: 'cleanup_tasks', mode: cmd.mode || KeyMode.DO };
    } else if (raw.includes('execute all') || raw.includes('approve all')) {
      intent = { domain: 'multi', action: 'execute_all', mode: KeyMode.AUTO };
    }

    await (this.prisma.client as any).keyCommand.update({
      where: { id: commandId },
      data: { intent: intent as any, status: 'PLANNED' },
    });

    return intent;
  }

  async groundIntent(commandId: string, businessId: string): Promise<Record<string, unknown>> {
    const [contacts, invoices, bookings, quotes, tasks] = await Promise.all([
      (this.prisma.client as any).contact.count({ where: { businessId, deletedAt: null } }),
      (this.prisma.client as any).invoice.aggregate({
        where: { businessId, deletedAt: null, status: 'PAID' },
        _sum: { total: true },
      }),
      (this.prisma.client as any).booking.count({ where: { businessId, deletedAt: null } }),
      (this.prisma.client as any).quote.count({ where: { businessId, deletedAt: null, status: 'SENT' } }),
      (this.prisma.client as any).contactTask.count({ where: { businessId, status: 'OPEN' } }),
    ]);

    const grounded = {
      contactCount: contacts,
      totalRevenue: Number(invoices._sum.total ?? 0),
      bookingCount: bookings,
      pendingQuotes: quotes,
      openTasks: tasks,
      businessId,
    };

    await (this.prisma.client as any).keyCommand.update({
      where: { id: commandId },
      data: { groundedData: grounded as any },
    });

    return grounded;
  }

  async planActions(commandId: string, intent: Record<string, unknown>): Promise<KeyCommandPlan> {
    const domain = intent.domain as string;
    const action = intent.action as string;

    const plan: KeyCommandPlan = { summary: `Plan for ${domain}.${action}`, steps: [] };

    if (domain === 'commerce' && action === 'revenue_summary') {
      plan.steps.push({ tool: 'summarizeRevenue', module: 'commerce', input: {}, riskTier: 'LOW', requiresApproval: false });
    } else if (domain === 'contacts' && action === 'follow_up') {
      plan.steps.push({ tool: 'recommendFollowUps', module: 'contacts', input: {}, riskTier: 'LOW', requiresApproval: false });
    } else if (domain === 'storefront' && action === 'storefront_audit') {
      plan.steps.push({ tool: 'auditStorefront', module: 'storefront', input: {}, riskTier: 'LOW', requiresApproval: false });
    } else {
      plan.steps.push({ tool: 'searchContacts', module: 'contacts', input: { query: action }, riskTier: 'LOW', requiresApproval: false });
    }

    await (this.prisma.client as any).keyCommand.update({
      where: { id: commandId },
      data: { planSummary: plan.summary, status: 'PLANNED' },
    });

    return plan;
  }

  classifyRisk(plan: KeyCommandPlan): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
    const maxRisk = plan.steps.reduce((max, s) => {
      const order = { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };
      return order[s.riskTier] > order[max] ? s.riskTier : max;
    }, 'LOW' as 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL');
    return maxRisk;
  }

  async executeApprovedPlan(commandId: string, plan: KeyCommandPlan, businessId: string): Promise<ToolResult[]> {
    const results: ToolResult[] = [];

    for (const step of plan.steps) {
      const toolFn = (await import('./key-tool.registry')).keyToolRegistry[step.module]?.[step.tool];
      if (!toolFn) {
        results.push({ success: false, error: `Tool ${step.module}.${step.tool} not found` });
        continue;
      }
      try {
        const result = await toolFn(businessId, step.input, this.prisma.client);
        results.push(result);
      } catch (e) {
        results.push({ success: false, error: (e as Error).message });
      }
    }

    const allSuccess = results.every((r) => r.success);
    await (this.prisma.client as any).keyCommand.update({
      where: { id: commandId },
      data: {
        status: allSuccess ? 'EXECUTED' : 'FAILED',
        executionResult: { success: allSuccess, outputs: results } as any,
      },
    });

    // Write to unified Activity ledger (Wave 1)
    this.timeline.recordEvent({
      businessId,
      module: 'key-ai',
      action: allSuccess ? 'command.executed' : 'command.failed',
      entityType: 'key_command',
      entityId: commandId,
      title: allSuccess ? 'KEY command executed' : 'KEY command failed',
      detail: `${plan.steps.length} steps, ${results.filter((r) => r.success).length} succeeded`,
      category: 'AI',
      actorType: 'AI',
      status: allSuccess ? 'COMPLETED' : 'FAILED',
      data: { planSummary: plan.summary, results: results.map((r) => ({ success: r.success, error: r.error })) },
      occurredAt: new Date(),
    }).catch((err) => {
      this.logger.warn(`[UnifiedLedger] failed to record key command activity: ${(err as Error).message}`);
    });

    return results;
  }

  // ── Do It For Me: real business intelligence ───────────────────────────

  async generateDoItForMe(businessId: string, rawInput: string): Promise<DoItForMeResult> {
    const findings: string[] = [];
    const actions: SuggestedAction[] = [];
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000);
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 86400000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000);

    const raw = rawInput.toLowerCase();
    const isFollowUp = raw.includes('follow') || raw.includes('cleanup') || raw.includes('clean up') || raw.includes('handle');
    const isInvoice = raw.includes('invoice') || raw.includes('remind') || raw.includes('payment');
    const isBooking = raw.includes('booking') || raw.includes('confirm') || raw.includes('appointment');
    const isReview = raw.includes('review') || raw.includes('feedback');
    const isAll = raw.includes('all') || raw.includes('everything') || raw.includes('handle tasks');

    // Fetch real data in parallel
    const [
      staleContacts,
      overdueInvoices,
      pendingBookings,
      sentQuotes,
      recentCustomers,
      openTasks,
    ] = await Promise.all([
      // Stale contacts: no interaction in 14 days, not dormant
      (this.prisma.client as any).contact.findMany({
        where: {
          businessId,
          deletedAt: null,
          lastInteractionAt: { lt: fourteenDaysAgo },
          status: { not: 'DORMANT' },
        },
        select: { id: true, firstName: true, lastName: true, email: true, status: true, lastInteractionAt: true, leadScore: true },
        orderBy: { lastInteractionAt: 'asc' },
        take: 10,
      }),
      // Overdue invoices
      (this.prisma.client as any).invoice.findMany({
        where: {
          businessId,
          deletedAt: null,
          status: { in: ['SENT', 'OVERDUE'] },
          dueDate: { lt: now },
        },
        select: {
          id: true,
          total: true,
          currency: true,
          dueDate: true,
          contact: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
        orderBy: { dueDate: 'asc' },
        take: 10,
      }),
      // Pending bookings (last 7 days, not confirmed)
      (this.prisma.client as any).booking.findMany({
        where: {
          businessId,
          deletedAt: null,
          status: 'PENDING',
          startTime: { gte: now },
        },
        select: {
          id: true,
          startTime: true,
          contact: { select: { id: true, firstName: true, lastName: true, email: true } },
          service: { select: { name: true, price: true } },
        },
        orderBy: { startTime: 'asc' },
        take: 10,
      }),
      // Sent quotes not yet accepted/rejected
      (this.prisma.client as any).quote.findMany({
        where: {
          businessId,
          deletedAt: null,
          status: 'SENT',
          issueDate: { gte: thirtyDaysAgo },
        },
        select: {
          id: true,
          total: true,
          currency: true,
          contact: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
        orderBy: { issueDate: 'asc' },
        take: 10,
      }),
      // Recent customers for review requests
      (this.prisma.client as any).contact.findMany({
        where: {
          businessId,
          deletedAt: null,
          status: 'CUSTOMER',
          updatedAt: { gte: thirtyDaysAgo },
        },
        select: { id: true, firstName: true, lastName: true, email: true },
        orderBy: { updatedAt: 'desc' },
        take: 10,
      }),
      // Open tasks
      (this.prisma.client as any).contactTask.findMany({
        where: { businessId, status: 'OPEN' },
        select: {
          id: true,
          title: true,
          dueDate: true,
          contact: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: { dueDate: 'asc' },
        take: 10,
      }),
    ]);

    // Build findings
    if (staleContacts.length > 0) {
      findings.push(`${staleContacts.length} contact${staleContacts.length > 1 ? 's' : ''} haven't been reached in 2+ weeks`);
    }
    if (overdueInvoices.length > 0) {
      const total = overdueInvoices.reduce((s: number, inv: any) => s + Number(inv.total), 0);
      findings.push(`${overdueInvoices.length} overdue invoice${overdueInvoices.length > 1 ? 's' : ''} totaling ${this.fmtMoney(total, overdueInvoices[0]?.currency || 'USD')}`);
    }
    if (pendingBookings.length > 0) {
      findings.push(`${pendingBookings.length} booking${pendingBookings.length > 1 ? 's' : ''} awaiting confirmation`);
    }
    if (sentQuotes.length > 0) {
      findings.push(`${sentQuotes.length} sent quote${sentQuotes.length > 1 ? 's' : ''} without response`);
    }
    if (openTasks.length > 0) {
      findings.push(`${openTasks.length} open task${openTasks.length > 1 ? 's' : ''} pending`);
    }

    // Build actions based on intent
    if ((isFollowUp || isAll) && staleContacts.length > 0) {
      for (const contact of staleContacts.slice(0, 5)) {
        const days = contact.lastInteractionAt
          ? Math.floor((now.getTime() - new Date(contact.lastInteractionAt).getTime()) / 86400000)
          : 30;
        actions.push({
          id: `follow-up-${contact.id}`,
          contactName: this.contactName(contact),
          contactId: contact.id,
          reason: `No contact in ${days} days`,
          suggestedMessage: `Hi ${contact.firstName || 'there'}, just checking in to see how things are going. Let me know if there's anything I can help with!`,
          expectedValue: contact.leadScore ? contact.leadScore * 10 : undefined,
          actionType: 'follow_up',
        });
      }
    }

    if ((isInvoice || isAll) && overdueInvoices.length > 0) {
      for (const inv of overdueInvoices.slice(0, 5)) {
        const daysOverdue = inv.dueDate
          ? Math.floor((now.getTime() - new Date(inv.dueDate).getTime()) / 86400000)
          : 7;
        actions.push({
          id: `invoice-${inv.id}`,
          contactName: this.contactName(inv.contact),
          contactId: inv.contact?.id,
          reason: `Invoice ${daysOverdue} days overdue`,
          suggestedMessage: `Hi ${inv.contact?.firstName || 'there'}, just a friendly reminder that invoice ${inv.id.slice(0, 8)} for ${this.fmtMoney(Number(inv.total), inv.currency)} is now ${daysOverdue} days overdue. Please let me know if you need anything.`,
          expectedValue: Number(inv.total),
          actionType: 'invoice_reminder',
        });
      }
    }

    if ((isBooking || isAll) && pendingBookings.length > 0) {
      for (const booking of pendingBookings.slice(0, 5)) {
        const dateStr = new Date(booking.startTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        actions.push({
          id: `booking-${booking.id}`,
          contactName: this.contactName(booking.contact),
          contactId: booking.contact?.id,
          reason: `Booking on ${dateStr} awaiting confirmation`,
          suggestedMessage: `Hi ${booking.contact?.firstName || 'there'}, your ${booking.service?.name || 'appointment'} on ${dateStr} is pending. Please confirm so we can reserve your spot!`,
          expectedValue: booking.service?.price ? Number(booking.service.price) : undefined,
          actionType: 'booking_confirm',
        });
      }
    }

    if ((isReview || isAll) && recentCustomers.length > 0) {
      for (const contact of recentCustomers.slice(0, 3)) {
        actions.push({
          id: `review-${contact.id}`,
          contactName: this.contactName(contact),
          contactId: contact.id,
          reason: 'Recent customer — request review',
          suggestedMessage: `Hi ${contact.firstName || 'there'}, thank you for choosing us! If you have a moment, we'd love to hear about your experience. Your feedback helps us grow.`,
          actionType: 'review_request',
        });
      }
    }

    // If no specific intent matched but we have open tasks, suggest those
    if (actions.length === 0 && openTasks.length > 0) {
      for (const task of openTasks.slice(0, 5)) {
        actions.push({
          id: `task-${task.id}`,
          contactName: this.contactName(task.contact) || 'General',
          contactId: task.contact?.id,
          reason: `Open task: ${task.title}`,
          suggestedMessage: task.dueDate
            ? `Task "${task.title}" is due ${new Date(task.dueDate).toLocaleDateString()}.`
            : `Complete task: ${task.title}`,
          actionType: 'custom',
        });
      }
    }

    const goal = this.inferGoal(rawInput, actions);

    return { goal, findings, actions };
  }

  private contactName(contact: any): string {
    if (!contact) return 'Unknown';
    const parts = [contact.firstName, contact.lastName].filter(Boolean);
    return parts.length > 0 ? parts.join(' ') : contact.email || 'Unknown';
  }

  private fmtMoney(n: number, currency = 'USD'): string {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(n);
  }

  private inferGoal(rawInput: string, actions: SuggestedAction[]): string {
    if (actions.length === 0) return 'Reviewed your business — all caught up!';
    const raw = rawInput.toLowerCase();
    if (raw.includes('follow')) return `Follow up with ${actions.length} contact${actions.length > 1 ? 's' : ''}`;
    if (raw.includes('invoice')) return `Send ${actions.length} invoice reminder${actions.length > 1 ? 's' : ''}`;
    if (raw.includes('booking')) return `Confirm ${actions.length} pending booking${actions.length > 1 ? 's' : ''}`;
    if (raw.includes('review')) return `Request ${actions.length} review${actions.length > 1 ? 's' : ''}`;
    if (raw.includes('clean') || raw.includes('handle')) return `Handle ${actions.length} pending item${actions.length > 1 ? 's' : ''}`;
    return `${actions.length} recommended action${actions.length > 1 ? 's' : ''}`;
  }

  async logResult(commandId: string, result: ToolResult[]) {
    this.logger.debug(`Command ${commandId} executed with ${result.length} steps`);
  }
}
