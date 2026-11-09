import { ForbiddenException, Inject, Injectable, Logger, Optional, forwardRef } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { TimelineService } from '../timeline/timeline.service';
import { ToolResult } from './key-tool-registry.service';
import { KeyToolRegistryService } from './key-tool-registry.service';
import { KeyCortexToolRegistryService } from '../key-cortex/key-cortex-tool-registry.service';
import { CommandService } from '../command/command.service';
import { AiOversightService } from './ai-oversight.service';
import { getToolByName } from './flow-tool-registry';
import { KeyAutonomySafetyService } from '../key-autonomy/key-autonomy-safety.service';
import { resolveCrmAccess, visibilityClause } from '../crm/crm-permissions.helper';
import { CANONICAL_MODULES, LEVEL_RANK, defaultScopesForRole, rankOf, type CanonicalModule } from '../../core/authority/module-vocabulary';
import type { KeyCommand, Prisma } from '@prisma/client';

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
 * What generateDoItForMe returns: the items it filed, and `dataWithheld` when
 * the caller's scope narrowed what it read (FOLLOW3-D9).
 */
export type DoItForMeOutcome = DoItForMeResult & { commandItemIds: string[]; dataWithheld?: true };

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
 * How 'ask' governs a read outside the FLOW_TOOLS catalogue, keyed by its
 * `module.tool` identity. Being listed here is what makes it read-only: tier 1
 * is not read-only in either registry (contacts.createCommandItem and
 * timeline.createReminder are tier-1 writes, and connect.scanDrive is a tier-1
 * Drive sync), so read-only is stated rather than inferred from a tier.
 *
 * - blockableAs: the module names a business can block it under. Oversight
 *   infers a module only from a snake_case FLOW name ('crm_', 'commerce_',
 *   'social_' is 'content'), never from a `module.tool` identity, so 'ask'
 *   applies blockedModules to these itself, and blockedTools to the bare tool
 *   name as well as the dotted one (SEC-V109-2).
 * - memberScope: the member module scope ModuleScopeGuard requires on the REST
 *   read of the same data. The asking member must hold read on it (SEC-V109-1).
 * - contactVisibility: it returns contacts. They are filtered by the asking
 *   member's CRM visibility (resolveCrmAccess + visibilityClause, as the
 *   contacts list route does) before they leave this service (SEC-V109-1).
 */
interface AskRead {
  blockableAs: readonly string[];
  memberScope?: CanonicalModule;
  contactVisibility?: true;
}

const ASK_READ_CAPABILITIES: ReadonlyMap<string, AskRead> = new Map<string, AskRead>([
  // The commerce invoice reads: RequireModuleScope('revenue', 'read').
  ['commerce.summarizeRevenue', { blockableAs: ['commerce'], memberScope: 'revenue' }],
  // GET crm/businesses/:b/contacts: RequireModuleScope('crm', 'read') + visibilityClause.
  ['contacts.recommendFollowUps', { blockableAs: ['crm', 'contacts'], memberScope: 'crm', contactVisibility: true }],
  // GET drive/businesses/:b/intake and communications/businesses/:b/message-intake
  // require membership only (AuthGuard + BusinessGuard), which the 'ask' route
  // already holds. Social engagements have no REST read.
  ['connect.listDriveIntake', { blockableAs: ['connect'] }],
  ['messages.listMessageIntake', { blockableAs: ['messages'] }],
  ['social.listRecentEngagement', { blockableAs: ['content', 'social'] }],
]);

/** The KeyCommand status of an 'ask', and the Activity ledger entry that says the same thing (SEC-V109-3). */
type AskStatus = 'EXECUTED' | 'PLANNED' | 'REJECTED' | 'FAILED';
const ASK_LEDGER: Record<AskStatus, { action: string; title: string; status: 'COMPLETED' | 'PENDING' | 'CANCELLED' | 'FAILED' }> = {
  EXECUTED: { action: 'command.executed', title: 'KEY command executed', status: 'COMPLETED' },
  PLANNED: { action: 'command.awaiting_approval', title: 'KEY command awaiting approval: nothing ran', status: 'PENDING' },
  REJECTED: { action: 'command.refused', title: 'KEY command refused: nothing ran', status: 'CANCELLED' },
  FAILED: { action: 'command.failed', title: 'KEY command failed', status: 'FAILED' },
};

/** The asking member's contact visibility; null sees every contact of the business. */
type ContactScope = Prisma.ContactWhereInput | null;

/**
 * Who is reading KeyCommand rows through GET key/commands, and what of their
 * data they may read (SEC-V109-1, V1-09b).
 */
interface CommandViewer {
  /** OWNER, ADMIN or SUPER_ADMIN read every member's rows; anyone else only their own. */
  seesAllRows: boolean;
  /** Module read as ModuleScopeGuard computes it (SUPER_ADMIN reads every module). */
  reads: (module: CanonicalModule) => boolean;
  /**
   * Module write as ModuleScopeGuard computes it (SUPER_ADMIN writes every
   * module; a Business.ownerId without a membership writes none, as
   * ModuleScopeGuard refuses a non-member on every scoped route).
   */
  writes: (module: CanonicalModule) => boolean;
  /** The contacts list route's clause; null sees every contact of the business. */
  contactScope: ContactScope;
  /** Nothing to withhold: every contact, and read on every module but connect. */
  unrestricted: boolean;
}

/**
 * SUPER_ADMIN, and a Business.ownerId BusinessGuard admits without a
 * Membership (CR-V109b-1): every row, every module, every contact. The
 * latter writes no module (commandViewer), as ModuleScopeGuard refuses it.
 */
const EVERY_ROW_EVERY_READ: CommandViewer = { seesAllRows: true, reads: () => true, writes: () => true, contactScope: null, unrestricted: true };

/** A KeyCommand row as GET key/commands lists it; `dataWithheld` marks another member's withheld text (SEC-V109b-1). */
export type ListedKeyCommand = KeyCommand & { dataWithheld?: true };

/** A 'do'/'draft' result as one caller may read it (SEC-V109b-2); findings are absent when withheld. */
export type ProjectedDoItForMe = Omit<DoItForMeResult, 'findings'> & {
  findings?: string[];
  commandItemIds: string[];
  dataWithheld?: true;
};

/** The module read each groundIntent figure needs; null is not business data. Any other key is withheld. */
const GROUNDED_READS: Readonly<Record<string, CanonicalModule | null>> = {
  businessId: null,
  contactCount: 'crm',
  openTasks: 'crm',
  totalRevenue: 'revenue',
  pendingQuotes: 'revenue',
  bookingCount: 'bookings',
};

/**
 * The module reads a 'do'/'draft' SuggestedAction needs, by actionType. Every
 * action names a contact (crm); a reminder states an invoice amount, a booking
 * confirmation a booking. An unknown actionType is withheld.
 */
const ACTION_READS: Readonly<Record<string, readonly CanonicalModule[]>> = {
  follow_up: ['crm'],
  review_request: ['crm'],
  custom: ['crm'],
  invoice_reminder: ['crm', 'revenue'],
  booking_confirm: ['crm', 'bookings'],
};

/** 'do'/'draft' findings summarise contacts, invoices, quotes and bookings at once. */
const FINDINGS_READS: readonly CanonicalModule[] = ['crm', 'revenue', 'bookings'];

/**
 * executionResult keys that state an outcome, not business data, in the shapes
 * KEY writes ('ask', 'do'/'draft', a Cortex turn). Kept for every reader of
 * the row; outputs, actions and findings are projected; anything else (a
 * Cortex responseText, free text KEY cannot classify) is withheld.
 */
const OUTCOME_KEYS: ReadonlySet<string> = new Set([
  'success', 'error', 'mode', 'goal', 'commandItemIds', 'actionsExecuted', 'actionsFailed', 'autonomyApproved', 'dataWithheld',
]);

type JsonObject = Record<string, unknown>;
const isJsonObject = (v: unknown): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);

type ResolvedCapability = {
  registry: 'canonical' | 'legacy';
  /** The identity it resolved under: a bare FLOW_TOOLS name or `module.tool`. */
  name: string;
  riskTier: number;
  requiresApproval: boolean;
};

type AskGate =
  | { cleared: true; capability: ResolvedCapability; contactScope: ContactScope }
  | { cleared: false; result: KeyCommandStepResult };

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
   * ASK_READ_CAPABILITIES), the autonomy kill switch is off, AiOversightService
   * clears it and the business has not blocked it, and the asking member may
   * read that data. Every check fails closed. Anything else is returned as not
   * executed, so nothing here files a proposal or writes.
   *
   * Advisory mode refuses these reads, as oversight rules (CR-V109-1): the
   * governance screen labels "Read data / Fetch records" Suggest Only under
   * advisory, and flow chat refuses read tools there too.
   */
  async executeApprovedPlan(commandId: string, plan: KeyCommandPlan, businessId: string, userId?: string): Promise<KeyCommandStepResult[]> {
    const results: KeyCommandStepResult[] = [];

    for (const step of plan.steps) {
      const gate = await this.governAskStep(step, businessId, userId);
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
        if (gate.contactScope) result = await this.scopeContacts(result, businessId, gate.contactScope);
      } catch (err) {
        result = { success: false, error: (err as Error).message };
      }
      results.push({ ...result, tool: capability.name });
    }

    const allSuccess = results.length > 0 && results.every((r) => r.success);
    const nothingRan = results.every((r) => r.notExecuted);
    // An empty plan or an all-refused one ran nothing and is not EXECUTED.
    const status: AskStatus = allSuccess
      ? 'EXECUTED'
      : nothingRan && results.some((r) => r.requiresApproval)
        ? 'PLANNED'
        : nothingRan
          ? 'REJECTED'
          : 'FAILED';
    await this.prisma.client.keyCommand.update({
      where: { id: commandId },
      data: {
        status,
        // An OWNER or ADMIN lists every member's rows through GET key/commands,
        // so what one member was allowed to read is not kept here for the
        // others (SEC-V109-1); listCommands projects what is kept per reader.
        executionResult: { success: allSuccess, outputs: results.map((r) => this.persistableOutput(r)) } as unknown as Prisma.InputJsonObject,
      },
    });

    // The unified Activity ledger says what the KeyCommand row says, and names
    // the member who asked (SEC-V109-3).
    const ledger = ASK_LEDGER[status];
    const ran = results.filter((r) => !r.notExecuted).length;
    this.timeline.recordEvent({
      businessId,
      module: 'key-ai',
      action: ledger.action,
      entityType: 'key_command',
      entityId: commandId,
      title: ledger.title,
      detail: `${plan.steps.length} steps, ${ran} ran, ${results.filter((r) => r.success).length} succeeded`,
      category: 'AI',
      actorType: 'AI',
      actorId: userId ?? undefined,
      status: ledger.status,
      data: {
        planSummary: plan.summary,
        commandStatus: status,
        requestedBy: userId ?? null,
        results: results.map((r) => ({
          tool: r.tool,
          success: r.success,
          notExecuted: !!r.notExecuted,
          requiresApproval: !!r.requiresApproval,
          error: r.error,
        })),
      },
      occurredAt: new Date(),
    }).catch((err) => {
      this.logger.warn(`[UnifiedLedger] failed to record key command activity: ${(err as Error).message}`);
    });

    return results;
  }

  /**
   * What an output keeps on the KeyCommand row. Data is kept only for a read
   * of business-wide data that any member may read; a member-scoped read (or
   * one 'ask' does not classify) keeps its outcome without its data.
   */
  private persistableOutput(r: KeyCommandStepResult): KeyCommandStepResult & { dataWithheld?: true } {
    const read = r.tool ? ASK_READ_CAPABILITIES.get(r.tool) : undefined;
    const businessWide = !!read && !read.memberScope && !read.contactVisibility;
    if (businessWide || r.data === undefined) return r;
    const outcome: KeyCommandStepResult & { dataWithheld?: true } = { ...r, dataWithheld: true };
    delete outcome.data;
    return outcome;
  }

  /**
   * SEC-V109-1: keep only the contacts the asking member may see. The read ran
   * business-wide in the legacy registry; the filter is the contacts list
   * route's own clause (resolveCrmAccess + visibilityClause), applied before
   * the rows leave this service. A result it cannot filter is not returned.
   */
  private async scopeContacts(result: KeyCommandStepResult, businessId: string, scope: Prisma.ContactWhereInput): Promise<KeyCommandStepResult> {
    if (!result.success) return result;
    const data = result.data as { contacts?: unknown } | undefined;
    if (!data || !Array.isArray(data.contacts)) {
      return { success: false, error: 'Contact visibility could not be applied to this answer; nothing was returned' };
    }
    const contacts = data.contacts as Array<{ id?: unknown }>;
    const ids = contacts.map((c) => c.id).filter((id): id is string => typeof id === 'string');
    const visible = ids.length
      ? await this.prisma.client.contact.findMany({ where: { businessId, id: { in: ids }, AND: [scope] }, select: { id: true } })
      : [];
    const keep = new Set(visible.map((v) => v.id));
    const scoped = contacts.filter((c) => typeof c.id === 'string' && keep.has(c.id));
    return { ...result, data: { ...data, contacts: scoped, count: scoped.length } };
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
    userId?: string,
  ): Promise<AskGate> {
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
    const read = ASK_READ_CAPABILITIES.get(name);
    try {
      const decision = await this.oversight.evaluate(businessId, name);
      if (!decision.allowed) return refuse(name, decision.reason);
      // Oversight tiers a tool by the FLOW_TOOLS catalogue, and gives any other
      // name a placeholder tier 2. For a catalogued tool its confirm verdict
      // stands ('ask' has no confirmation step). For the rest, the read-only
      // check above is the tier verdict; oversight still rules on mode,
      // exact-name blocks and its own fail-closed state through `allowed`.
      const needsHuman = decision.requiresQuickConfirm || decision.requiresFormalApproval || decision.requiresAdminApproval;
      if (needsHuman && getToolByName(name)) return refuse(name, decision.reason, true);
      // ...but not on module blocks, nor on a block of the bare tool name: it
      // infers a module only from snake_case FLOW names (SEC-V109-2).
      if (read) {
        const blocked = await this.businessBlock(businessId, step.tool, name, read);
        if (blocked) return refuse(name, blocked);
      }
    } catch (err) {
      this.logger.error(`[ask] oversight check failed for ${businessId}: ${(err as Error).message}`);
      return refuse(name, 'KEY oversight could not be checked; nothing was run');
    }

    let contactScope: ContactScope = null;
    if (read && (read.memberScope || read.contactVisibility)) {
      const actor = await this.bindAskActor(businessId, userId, name, read);
      if (!actor.allowed) return refuse(name, actor.reason);
      contactScope = actor.contactScope;
    }

    return { cleared: true, capability, contactScope };
  }

  /**
   * The business's own block on a dotted 'ask' read, from the policy oversight
   * reads (AiOversightService.getAutonomySettings). A policy that could not be
   * read blocks, as oversight's own fail-closed state does. Null when clear.
   */
  private async businessBlock(businessId: string, tool: string, name: string, read: AskRead): Promise<string | null> {
    const settings = await this.oversight!.getAutonomySettings(businessId);
    if (settings.degraded) return 'KEY oversight could not read this business\'s AI policy; nothing was run';
    const tools = settings.blockedTools ?? [];
    const toolBlock = [name, tool].find((t) => tools.includes(t));
    if (toolBlock) return `Tool "${toolBlock}" is blocked by business settings`;
    const modules = settings.blockedModules ?? [];
    const moduleBlock = read.blockableAs.find((m) => modules.includes(m));
    if (moduleBlock) return `Module "${moduleBlock}" is blocked by business settings`;
    return null;
  }

  /**
   * SEC-V109-1: the asking member may read this data only as the REST read of
   * it would let them. Module scope as ModuleScopeGuard computes it (SUPER_ADMIN
   * passes; else the membership's explicit scope map or its role defaults),
   * and for contacts the list route's visibility clause. Fails closed: no
   * member, or a lookup that fails, runs nothing.
   */
  private async bindAskActor(
    businessId: string,
    userId: string | undefined,
    name: string,
    read: AskRead,
  ): Promise<{ allowed: true; contactScope: ContactScope } | { allowed: false; reason: string }> {
    if (!userId) return { allowed: false, reason: `${name} reads member-scoped data and no member is named; nothing was run` };
    try {
      // Throws for an unknown user or a non-member (SUPER_ADMIN excepted).
      const crm = await resolveCrmAccess(this.prisma, businessId, userId);
      if (read.memberScope && !crm.isSuperAdmin) {
        const membership = await this.memberScopes(businessId, userId);
        if (!membership) return { allowed: false, reason: `${name}: not a member of this business; nothing was run` };
        const level = membership.scopes[read.memberScope] || 'none';
        if (rankOf(level) < LEVEL_RANK.read) {
          return {
            allowed: false,
            reason: `${name} reads ${read.memberScope} data, which requires ${read.memberScope} read access (you have ${level}); nothing was run`,
          };
        }
      }
      const contactScope = read.contactVisibility ? (visibilityClause(crm, userId) as ContactScope) : null;
      return { allowed: true, contactScope };
    } catch (err) {
      this.logger.warn(`[ask] member scope for ${name} could not be resolved in ${businessId}: ${(err as Error).message}`);
      return { allowed: false, reason: `${name}: this member's access could not be confirmed; nothing was run` };
    }
  }

  /**
   * The membership's module scope map as ModuleScopeGuard reads it: its
   * explicit map, else its role's defaults. Null for a non-member.
   */
  private async memberScopes(businessId: string, userId: string): Promise<{ role: string; scopes: Record<string, string> } | null> {
    const membership = await this.prisma.client.membership.findUnique({
      where: { userId_businessId: { userId, businessId } },
      select: { role: true, permissionScopes: true },
    });
    if (!membership) return null;
    const scopes: Record<string, string> =
      membership.permissionScopes && typeof membership.permissionScopes === 'object'
        ? (membership.permissionScopes as Record<string, string>)
        : defaultScopesForRole(membership.role);
    return { role: membership.role, scopes };
  }

  // ── GET key/commands: the caller's rows, projected to what they may read ──

  /**
   * SEC-V109-1 (V1-09b). A member lists only the rows they created; an OWNER,
   * ADMIN or SUPER_ADMIN lists every row of the business. Every caller, OWNER
   * and ADMIN included, gets each row's data only as their own module scopes
   * and contact visibility allow (the safer of the two readings): grounded
   * revenue and quotes need revenue read, contact names crm read plus the
   * contacts list route's visibility clause, bookings bookings read. Free
   * text KEY cannot classify (a Cortex responseText, executionLogs) is kept
   * only for a caller with nothing to withhold, and so is another member's
   * typed text (rawInput, a Cortex chat message) with its Cortex identity
   * thread (sessionId, correlationId): such a row reads `rawInput: ''` and is
   * marked `dataWithheld: true` (SEC-V109b-1); a caller keeps their own.
   * Withheld data is marked `dataWithheld: true`. Fails closed: an unknown
   * user or a non-member is refused; the Business.ownerId BusinessGuard
   * admits without a membership reads every row (CR-V109b-1).
   */
  async listCommands(businessId: string, userId: string | undefined, take = 50): Promise<ListedKeyCommand[]> {
    if (!userId) throw new ForbiddenException('Authentication required');
    const viewer = await this.commandViewer(businessId, userId);
    const rows = await this.prisma.client.keyCommand.findMany({
      where: viewer.seesAllRows ? { businessId } : { businessId, userId },
      orderBy: { createdAt: 'desc' },
      take,
    });
    if (viewer.unrestricted) return rows;
    const visibleContacts = await this.visibleActionContacts(businessId, rows.map((r) => r.executionResult), viewer);
    return rows.map((row): ListedKeyCommand => {
      const projected = {
        ...row,
        groundedData: this.projectGrounded(row.groundedData, viewer),
        executionResult: this.projectExecutionResult(row.executionResult, viewer, visibleContacts),
        executionLogs: null,
      };
      if (row.userId === userId) return projected;
      // SEC-V109b-1: free text KEY cannot classify; it can name a contact or an amount this reader may not read.
      return { ...projected, rawInput: '', sessionId: null, correlationId: null, dataWithheld: true };
    });
  }

  /**
   * SEC-V109b-2. The POST key/command 'do'/'auto'/'draft' response, projected
   * exactly as listCommands projects the executionResult that POST wrote, so a
   * member cannot read by POSTing what GET key/commands withholds from them.
   * Since FOLLOW3-D9 generateDoItForMe reads only what the caller may read, so
   * the row holds no more than this projection lets its author see.
   */
  async projectDoItForMe(
    businessId: string,
    userId: string | undefined,
    result: DoItForMeOutcome,
  ): Promise<ProjectedDoItForMe> {
    if (!userId) throw new ForbiddenException('Authentication required');
    const viewer = await this.commandViewer(businessId, userId);
    if (viewer.unrestricted) return result;
    const asRow = result as unknown as Prisma.JsonObject;
    const visibleContacts = await this.visibleActionContacts(businessId, [asRow], viewer);
    return this.projectExecutionResult(asRow, viewer, visibleContacts) as unknown as ProjectedDoItForMe;
  }

  private async commandViewer(businessId: string, userId: string): Promise<CommandViewer> {
    const user = await this.prisma.client.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (!user) throw new ForbiddenException('User not found');
    // resolveCrmAccess and ModuleScopeGuard pass SUPER_ADMIN on every module and contact.
    if (user.role === 'SUPER_ADMIN') return EVERY_ROW_EVERY_READ;
    const member = await this.memberScopes(businessId, userId);
    if (!member) {
      // CR-V109b-1: BusinessGuard (userCanAccessBusiness) also admits the
      // Business.ownerId without a Membership row (businesses created before
      // the founding OWNER membership was written with them). That owner
      // listed every row before V1-09b and still does. Anyone else is refused.
      const owned = await this.prisma.client.business.findFirst({ where: { id: businessId, ownerId: userId }, select: { id: true } });
      if (owned) return { ...EVERY_ROW_EVERY_READ, writes: () => false };
      throw new ForbiddenException('Not a member of this business');
    }
    const crm = await resolveCrmAccess(this.prisma, businessId, userId);
    const reads = (module: CanonicalModule) => rankOf(member.scopes[module] || 'none') >= LEVEL_RANK.read;
    const writes = (module: CanonicalModule) => rankOf(member.scopes[module] || 'none') >= LEVEL_RANK.write;
    const contactScope = visibilityClause(crm, userId) as ContactScope;
    return {
      seesAllRows: member.role === 'OWNER' || member.role === 'ADMIN',
      reads,
      writes,
      contactScope,
      // connect is NONE for every role by default; the connect data KEY rows
      // keep (drive intake) needs membership only.
      unrestricted: contactScope === null && CANONICAL_MODULES.every((m) => m === 'connect' || reads(m)),
    };
  }

  /** The contacts named by 'do'/'draft' actions that this viewer may see; null is every contact. */
  private async visibleActionContacts(
    businessId: string,
    results: readonly Prisma.JsonValue[],
    viewer: CommandViewer,
  ): Promise<ReadonlySet<string> | null> {
    if (!viewer.reads('crm')) return new Set();
    if (!viewer.contactScope) return null;
    const ids = new Set<string>();
    for (const result of results) {
      const actions = isJsonObject(result) ? result.actions : undefined;
      if (!Array.isArray(actions)) continue;
      for (const a of actions) if (isJsonObject(a) && typeof a.contactId === 'string') ids.add(a.contactId);
    }
    if (!ids.size) return new Set();
    const visible = await this.prisma.client.contact.findMany({
      where: { businessId, id: { in: [...ids] }, AND: [viewer.contactScope] },
      select: { id: true },
    });
    return new Set(visible.map((c) => c.id));
  }

  private projectGrounded(grounded: Prisma.JsonValue, viewer: CommandViewer): Prisma.JsonValue {
    if (grounded === null) return null;
    if (!isJsonObject(grounded)) return { dataWithheld: true };
    const out: Record<string, Prisma.JsonValue> = {};
    let withheld = false;
    for (const [key, value] of Object.entries(grounded)) {
      const module = Object.prototype.hasOwnProperty.call(GROUNDED_READS, key) ? GROUNDED_READS[key] : undefined;
      if (module === null || (module !== undefined && viewer.reads(module))) out[key] = value as Prisma.JsonValue;
      else withheld = true;
    }
    if (withheld) out.dataWithheld = true;
    return out;
  }

  private projectExecutionResult(
    result: Prisma.JsonValue,
    viewer: CommandViewer,
    visibleContacts: ReadonlySet<string> | null,
  ): Prisma.JsonValue {
    if (result === null) return null;
    if (!isJsonObject(result)) return { dataWithheld: true };
    const out: Record<string, unknown> = {};
    let withheld = false;
    for (const [key, value] of Object.entries(result)) {
      if (OUTCOME_KEYS.has(key)) {
        out[key] = value;
      } else if (key === 'outputs' && Array.isArray(value)) {
        // 'ask': the rule executeApprovedPlan persists by, applied again for rows written before it.
        out.outputs = value.map((o) => (isJsonObject(o) ? this.persistableOutput(o as unknown as KeyCommandStepResult) : { dataWithheld: true }));
      } else if (key === 'actions' && Array.isArray(value)) {
        const kept: JsonObject[] = [];
        for (const action of value) {
          const projected = this.projectAction(action, viewer, visibleContacts);
          if (projected !== action) withheld = true;
          if (projected) kept.push(projected);
        }
        out.actions = kept;
      } else if (key === 'findings' && FINDINGS_READS.every((m) => viewer.reads(m))) {
        out.findings = value;
      } else {
        withheld = true;
      }
    }
    if (withheld) out.dataWithheld = true;
    return out as Prisma.JsonObject;
  }

  /** The action itself when the viewer may read all of it; a copy without expectedValue; or null. */
  private projectAction(action: unknown, viewer: CommandViewer, visibleContacts: ReadonlySet<string> | null): JsonObject | null {
    if (!isJsonObject(action)) return null;
    const needs = typeof action.actionType === 'string' && Object.prototype.hasOwnProperty.call(ACTION_READS, action.actionType)
      ? ACTION_READS[action.actionType]
      : undefined;
    if (!needs || !needs.every((m) => viewer.reads(m))) return null;
    if (typeof action.contactId === 'string' && visibleContacts && !visibleContacts.has(action.contactId)) return null;
    if (action.expectedValue === undefined || viewer.reads('revenue')) return action;
    const copy = { ...action };
    delete copy.expectedValue;
    return copy;
  }

  // ── Do It For Me: real business intelligence ───────────────────────────

  /**
   * FOLLOW3-D9 (V1-09b review SEC-V109b-2 residual, R0-13g review SEC-R013g-3).
   * Reads only what the caller may read, decided before anything is read by
   * the rule GET key/commands projects by (commandViewer): contacts and their
   * tasks with crm read, invoices and quotes with revenue read, bookings with
   * bookings read, each limited to the contacts the contacts list route shows
   * the caller (visibilityClause). An action is built only when the caller
   * reads every module it names (ACTION_READS), and states an amount only with
   * revenue read. So the KeyCommand row the controller writes from this result
   * holds nothing its author may not read, and `dataWithheld` says the answer
   * was narrowed. CommandItems are filed only for a caller with operations
   * write, the level ModuleScopeGuard requires on POST command items (D-40).
   * Fails closed: no caller, an unknown user or a non-member reads nothing.
   */
  async generateDoItForMe(businessId: string, rawInput: string, userId?: string, keyCommandId?: string): Promise<DoItForMeOutcome> {
    if (!userId) throw new ForbiddenException('Authentication required');
    const viewer = await this.commandViewer(businessId, userId);
    const scope = viewer.contactScope;
    // The contacts the caller may open, as a Contact where and as the relation filter of a row that names one.
    const visibleContact = scope ? { AND: [scope] } : {};
    const ofVisibleContact = scope ? { contact: scope } : {};
    const readsCrm = viewer.reads('crm');
    const readsRevenue = viewer.reads('revenue');
    const readsBookings = viewer.reads('bookings');
    const mayBuild = (actionType: SuggestedAction['actionType']) => ACTION_READS[actionType].every((m) => viewer.reads(m));
    const amount = (value: number | undefined) => (readsRevenue ? value : undefined);
    const nothing = Promise.resolve([]);

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
      // Stale contacts: no interaction in 14 days, not lost. (CF-49: 'DORMANT'
      // is a relationshipHealth value, never a Contact.status; the old filter
      // excluded nothing.)
      !readsCrm ? nothing : (this.prisma.client as any).contact.findMany({
        where: {
          businessId,
          deletedAt: null,
          lastInteractionAt: { lt: fourteenDaysAgo },
          status: { not: 'LOST' },
          ...visibleContact,
        },
        select: { id: true, firstName: true, lastName: true, email: true, status: true, lastInteractionAt: true, leadScore: true },
        orderBy: { lastInteractionAt: 'asc' },
        take: 10,
      }),
      // Overdue invoices
      !readsRevenue ? nothing : (this.prisma.client as any).invoice.findMany({
        where: {
          businessId,
          deletedAt: null,
          status: { in: ['SENT', 'OVERDUE'] },
          dueDate: { lt: now },
          ...ofVisibleContact,
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
      !readsBookings ? nothing : (this.prisma.client as any).booking.findMany({
        where: {
          businessId,
          deletedAt: null,
          status: 'PENDING',
          startTime: { gte: now },
          ...ofVisibleContact,
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
      !readsRevenue ? nothing : (this.prisma.client as any).quote.findMany({
        where: {
          businessId,
          deletedAt: null,
          status: 'SENT',
          issueDate: { gte: thirtyDaysAgo },
          ...ofVisibleContact,
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
      // Recent clients for review requests (CF-49: CLIENT is the canonical
      // status; 'CUSTOMER' is not one the CRM admits).
      !readsCrm ? nothing : (this.prisma.client as any).contact.findMany({
        where: {
          businessId,
          deletedAt: null,
          status: 'CLIENT',
          updatedAt: { gte: thirtyDaysAgo },
          ...visibleContact,
        },
        select: { id: true, firstName: true, lastName: true, email: true },
        orderBy: { updatedAt: 'desc' },
        take: 10,
      }),
      // Open tasks (GET crm/businesses/:b/tasks requires crm read)
      !readsCrm ? nothing : (this.prisma.client as any).contactTask.findMany({
        where: { businessId, status: 'OPEN', ...ofVisibleContact },
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
    if ((isFollowUp || isAll) && staleContacts.length > 0 && mayBuild('follow_up')) {
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
          expectedValue: amount(contact.leadScore ? contact.leadScore * 10 : undefined),
          actionType: 'follow_up',
        });
      }
    }

    if ((isInvoice || isAll) && overdueInvoices.length > 0 && mayBuild('invoice_reminder')) {
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

    if ((isBooking || isAll) && pendingBookings.length > 0 && mayBuild('booking_confirm')) {
      for (const booking of pendingBookings.slice(0, 5)) {
        const dateStr = new Date(booking.startTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        actions.push({
          id: `booking-${booking.id}`,
          contactName: this.contactName(booking.contact),
          contactId: booking.contact?.id,
          reason: `Booking on ${dateStr} awaiting confirmation`,
          suggestedMessage: `Hi ${booking.contact?.firstName || 'there'}, your ${booking.service?.name || 'appointment'} on ${dateStr} is pending. Please confirm so we can reserve your spot!`,
          expectedValue: amount(booking.service?.price ? Number(booking.service.price) : undefined),
          actionType: 'booking_confirm',
        });
      }
    }

    if ((isReview || isAll) && recentCustomers.length > 0 && mayBuild('review_request')) {
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
    if (actions.length === 0 && openTasks.length > 0 && mayBuild('custom')) {
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

    // Create CommandItems for high-value actions, only for a caller who may
    // create them by hand: POST command/businesses/:b/items requires
    // operations write (D-40, ModuleScopeGuard).
    const commandItemIds: string[] = [];
    for (const action of viewer.writes('operations') ? actions : []) {
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

    // The answer was narrowed whenever the caller does not see every contact or
    // cannot read one of the modules it summarises.
    const narrowed = scope !== null || FINDINGS_READS.some((m) => !viewer.reads(m));
    return { goal, findings, actions, commandItemIds, ...(narrowed ? { dataWithheld: true as const } : {}) };
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
