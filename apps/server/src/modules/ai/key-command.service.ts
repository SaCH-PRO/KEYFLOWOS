import { Inject, Injectable, Logger, Optional, forwardRef } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { TimelineService } from '../timeline/timeline.service';
import { ToolResult } from './key-tool-registry.service';
import { KeyToolRegistryService } from './key-tool-registry.service';
import { KeyCortexToolRegistryService } from '../key-cortex/key-cortex-tool-registry.service';
import { CommandService } from '../command/command.service';
import { AiOversightService } from './ai-oversight.service';
import { getToolByName } from './flow-tool-registry';
import { KeyAutonomySafetyService } from '../key-autonomy/key-autonomy-safety.service';

export enum KeyMode {
  ASK = 'ask',
  DO = 'do',
  PLAN = 'plan',
  DRAFT = 'draft',
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

/**
 * One step's outcome. `notExecuted` means nothing ran: the step was refused or
 * is awaiting approval (the same flag KeyCortexToolResult uses for it).
 */
export interface KeyCommandStepResult extends ToolResult {
  tool?: string;
  notExecuted?: boolean;
  requiresApproval?: boolean;
}

/**
 * The capabilities outside the FLOW_TOOLS catalogue that 'ask' may run, by
 * their `module.tool` identity: each one only reads. Tier 1 is not read-only in
 * either registry (contacts.createCommandItem and timeline.createReminder are
 * tier-1 writes, and connect.scanDrive is a tier-1 Drive sync), so read-only
 * is stated here rather than inferred from a tier.
 */
const ASK_READ_CAPABILITIES: ReadonlySet<string> = new Set([
  'commerce.summarizeRevenue',
  'contacts.recommendFollowUps',
  'connect.listDriveIntake',
  'messages.listMessageIntake',
  'social.listRecentEngagement',
]);

type ResolvedCapability = {
  registry: 'canonical' | 'legacy';
  /** The identity it resolved under: a bare FLOW_TOOLS name or `module.tool`. */
  name: string;
  riskTier: number;
  requiresApproval: boolean;
};

@Injectable()
export class KeyCommandService {
  private readonly logger = new Logger(KeyCommandService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TimelineService) private readonly timeline: TimelineService,
    @Optional()
    @Inject(forwardRef(() => KeyToolRegistryService))
    private readonly toolRegistry: KeyToolRegistryService | undefined,
    @Inject(forwardRef(() => CommandService)) private readonly commandService: CommandService,
    @Optional()
    @Inject(forwardRef(() => KeyCortexToolRegistryService))
    private readonly keyCortexToolRegistry?: KeyCortexToolRegistryService,
    // V1-09. Appended, never inserted: specs construct this positionally. Not
    // @Optional: Nest refuses to boot without them, and executeApprovedPlan
    // fails closed if a hand-built instance lacks them.
    @Inject(forwardRef(() => AiOversightService))
    private readonly oversight?: AiOversightService,
    @Inject(forwardRef(() => KeyAutonomySafetyService))
    private readonly safety?: KeyAutonomySafetyService,
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
    } else if (raw.includes('scan drive') || raw.includes('sync drive') || raw.includes('check drive')) {
      intent = { domain: 'connect', action: 'scan_drive', mode: KeyMode.DO };
    } else if (raw.includes('what did key find') || raw.includes('what did you find') || raw.includes('drive findings') || raw.includes('drive intake')) {
      intent = { domain: 'connect', action: 'drive_findings', mode: KeyMode.ASK };
    } else if (raw.includes('check messages') || raw.includes('message intake') || raw.includes('unread messages') || raw.includes('my inbox')) {
      intent = { domain: 'messages', action: 'message_intake', mode: KeyMode.ASK };
    } else if (raw.includes('social') || raw.includes('facebook') || raw.includes('instagram') || raw.includes('recent engagement')) {
      intent = { domain: 'social', action: 'recent_engagement', mode: KeyMode.ASK };
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
    } else if (domain === 'connect' && action === 'scan_drive') {
      // Not a read: syncGoogleDrive calls the Drive API and writes intake rows.
      // The legacy registry declares it tier 1, so the plan states the risk.
      plan.steps.push({ tool: 'scanDrive', module: 'connect', input: {}, riskTier: 'MEDIUM', requiresApproval: true });
    } else if (domain === 'connect' && action === 'drive_findings') {
      plan.steps.push({ tool: 'listDriveIntake', module: 'connect', input: { status: 'reviewing', limit: 20 }, riskTier: 'LOW', requiresApproval: false });
    } else if (domain === 'messages' && action === 'message_intake') {
      plan.steps.push({ tool: 'listMessageIntake', module: 'messages', input: { status: 'reviewing', limit: 20 }, riskTier: 'LOW', requiresApproval: false });
    } else if (domain === 'social' && action === 'recent_engagement') {
      plan.steps.push({ tool: 'listRecentEngagement', module: 'social', input: { limit: 20 }, riskTier: 'LOW', requiresApproval: false });
    } else {
      // Was contacts.searchContacts with the action name as the query: a tool
      // no registry serves, searched for the word "unknown".
      plan.summary = `KEY has no capability for ${domain}.${action}: nothing was planned and nothing will run.`;
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

  /**
   * The 'ask' executor (POST /key/command with mode 'ask' is its only caller).
   *
   * 'ask' is read-only and governed: a step runs only when it is a read-tier
   * capability (LOW in the plan, tier 1 without approval in the registry that
   * serves it, and read-only by the FLOW_TOOLS catalogue or
   * ASK_READ_CAPABILITIES), the autonomy kill switch is off, and
   * AiOversightService clears it. Both checks fail closed. Anything else is
   * returned as not executed, so nothing here files a proposal or writes.
   */
  async executeApprovedPlan(commandId: string, plan: KeyCommandPlan, businessId: string, userId?: string): Promise<KeyCommandStepResult[]> {
    const results: KeyCommandStepResult[] = [];

    for (const step of plan.steps) {
      const gate = await this.governAskStep(step, businessId);
      if (!gate.cleared) {
        results.push(gate.result);
        continue;
      }
      const capability = gate.capability;
      // INTERNAL_EXEC is what both registries require for a tier-1 tool; it is
      // granted only to a read that the checks above cleared.
      const ctx = { businessId, userId: userId ?? undefined, commandId, autonomyLevel: KeyAutonomyLevel.INTERNAL_EXEC };
      let result: KeyCommandStepResult;
      try {
        result = capability.registry === 'canonical'
          ? await this.keyCortexToolRegistry!.execute(capability.name, ctx, step.input)
          : await this.toolRegistry!.execute(step.module, step.tool, ctx, step.input);
      } catch (err) {
        result = { success: false, error: (err as Error).message };
      }
      results.push({ ...result, tool: capability.name });
    }

    const allSuccess = results.length > 0 && results.every((r) => r.success);
    const nothingRan = results.every((r) => r.notExecuted);
    // An empty plan or an all-refused one ran nothing and is not EXECUTED.
    const status = allSuccess
      ? 'EXECUTED'
      : nothingRan && results.some((r) => r.requiresApproval)
        ? 'PLANNED'
        : nothingRan
          ? 'REJECTED'
          : 'FAILED';
    await (this.prisma.client as any).keyCommand.update({
      where: { id: commandId },
      data: {
        status,
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

  /**
   * Which registry serves a step, and under which identity. FLOW_TOOLS are
   * bridged into the canonical registry under their BARE names; organ tools
   * there are dotted. So: the bare canonical name, then the dotted canonical
   * name, then the legacy registry (#160, the @@ -200 hunk only).
   */
  private resolveCapability(step: KeyCommandPlan['steps'][number]): ResolvedCapability | undefined {
    const dotted = `${step.module}.${step.tool}`;
    for (const name of [step.tool, dotted]) {
      const tool = this.keyCortexToolRegistry?.getTool(name);
      if (tool) return { registry: 'canonical', name, riskTier: tool.riskTier, requiresApproval: tool.requiresApproval };
    }
    const legacy = this.toolRegistry?.getTool(step.module, step.tool);
    if (legacy) return { registry: 'legacy', name: dotted, riskTier: legacy.riskTier, requiresApproval: legacy.requiresApproval };
    return undefined;
  }

  /** Read-only by the FLOW_TOOLS catalogue when it lists the name, else by ASK_READ_CAPABILITIES. */
  private isReadCapability(name: string): boolean {
    const flow = getToolByName(name);
    if (flow) {
      return flow.riskTier === 1 && (flow.family === 'read' || (flow.family === 'crud' && !flow.changedEntities?.length));
    }
    return ASK_READ_CAPABILITIES.has(name);
  }

  private async governAskStep(
    step: KeyCommandPlan['steps'][number],
    businessId: string,
  ): Promise<{ cleared: true; capability: ResolvedCapability } | { cleared: false; result: KeyCommandStepResult }> {
    const refuse = (tool: string, error: string, requiresApproval = false) =>
      ({ cleared: false as const, result: { success: false, notExecuted: true, requiresApproval, tool, error } });
    const planned = `${step.module}.${step.tool}`;

    if (step.requiresApproval || step.riskTier !== 'LOW') {
      return refuse(planned, `${planned} is ${step.riskTier} risk and requires approval; 'ask' only reads`, true);
    }

    const capability = this.resolveCapability(step);
    if (!capability) {
      return refuse(planned, `${planned} is not registered in any KEY tool registry; nothing was run`);
    }
    const { name } = capability;
    if (capability.riskTier !== 1 || capability.requiresApproval || !this.isReadCapability(name)) {
      return refuse(name, `${name} is not a read-only capability; 'ask' does not change the business`, true);
    }

    if (!this.safety) return refuse(name, 'The autonomy kill switch could not be checked; nothing was run');
    try {
      const safety = await this.safety.check({ businessId, toolName: name, riskTier: 1, mode: 'manual' });
      if (!safety.allowed) {
        return refuse(name, safety.reason ?? 'Blocked by the autonomy safety gate', !!safety.requiresApproval);
      }
    } catch (err) {
      this.logger.error(`[ask] kill switch check failed for ${businessId}: ${(err as Error).message}`);
      return refuse(name, 'The autonomy kill switch could not be checked; nothing was run');
    }

    if (!this.oversight) return refuse(name, 'KEY oversight is unavailable; nothing was run');
    try {
      const decision = await this.oversight.evaluate(businessId, name);
      if (!decision.allowed) return refuse(name, decision.reason);
      // Oversight tiers a tool by the FLOW_TOOLS catalogue, and gives any other
      // name a placeholder tier 2. For a catalogued tool its confirm verdict
      // stands ('ask' has no confirmation step). For the rest, the read-only
      // check above is the tier verdict; oversight still rules on mode,
      // blocklists and its own fail-closed state through `allowed`.
      const needsHuman = decision.requiresQuickConfirm || decision.requiresFormalApproval || decision.requiresAdminApproval;
      if (needsHuman && getToolByName(name)) return refuse(name, decision.reason, true);
    } catch (err) {
      this.logger.error(`[ask] oversight check failed for ${businessId}: ${(err as Error).message}`);
      return refuse(name, 'KEY oversight could not be checked; nothing was run');
    }

    return { cleared: true, capability };
  }

  // ── Do It For Me: real business intelligence ───────────────────────────

  async generateDoItForMe(businessId: string, rawInput: string, userId?: string, keyCommandId?: string): Promise<DoItForMeResult & { commandItemIds: string[] }> {
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

    // Create CommandItems for high-value actions
    const commandItemIds: string[] = [];
    for (const action of actions) {
      try {
        const categoryMap: Record<string, string> = {
          follow_up: 'PEOPLE',
          invoice_reminder: 'MONEY',
          booking_confirm: 'TIME',
          review_request: 'MARKETING',
          custom: 'WORK',
        };
        const cmdItem = await this.commandService.create(businessId, {
          title: `${action.actionType === 'invoice_reminder' ? 'Collect' : action.actionType === 'follow_up' ? 'Follow up' : action.actionType === 'booking_confirm' ? 'Confirm' : action.actionType === 'review_request' ? 'Request review' : 'Handle'}: ${action.contactName}`,
          description: `${action.reason}\n\nSuggested: ${action.suggestedMessage || 'No message draft'}`,
          category: categoryMap[action.actionType] || 'WORK',
          actionType: action.actionType,
          sourceModule: 'KEY_AI',
          sourceType: 'do_it_for_me',
          sourceId: keyCommandId,
          ownerId: action.contactId,
          ownerType: action.contactId ? 'CONTACT' : undefined,
          expectedValue: action.expectedValue ? String(action.expectedValue) : undefined,
          currency: 'TTD',
          priority: action.expectedValue && action.expectedValue > 5000 ? 80 : 60,
          urgency: action.actionType === 'invoice_reminder' ? 80 : 50,
          recommendedBy: 'KEY',
          executableByKey: true,
        });
        commandItemIds.push(cmdItem.id);
      } catch (err: any) {
        this.logger.warn(`Failed to create CommandItem for action ${action.id}: ${(err as Error).message}`);
      }
    }

    return { goal, findings, actions, commandItemIds };
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

  /**
   * Queue an async background job for execution by KEY workers.
   * Minimal stub: writes a keyCommand audit row and returns queued id.
   */
  async enqueue(job: { type: string; payload: Record<string, unknown> }): Promise<{ id: string; type: string; status: string }> {
    const id = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.logger.log(`[enqueue] ${job.type} ${id}`);
    return { id, type: job.type, status: 'queued' };
  }

  /**
   * Execute an ad-hoc command synchronously.
   * Minimal stub: returns the payload as result.
   */
  async execute(command: { type: string; payload: Record<string, unknown> }): Promise<Record<string, unknown>> {
    this.logger.log(`[execute] ${command.type}`);
    return { success: true, type: command.type, result: command.payload };
  }
}
