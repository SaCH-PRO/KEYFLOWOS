import { Injectable, Inject, forwardRef, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { SafeToSpendService } from '../finance/safe-to-spend.service';
import { CashflowForecastService } from '../finance/cashflow-forecast.service';
import { MoneyMovesService } from '../finance/money-moves.service';
import { ReceivablesService } from '../finance/receivables.service';
import { FinanceOverviewService } from '../finance/finance-overview.service';
import { CommandService } from '../command/command.service';
import { TimelineService } from '../timeline/timeline.service';
import { ConnectorIntelligenceService } from './connector-intelligence.service';
import { AiExecutionLogService } from './ai-execution-log.service';

export interface ToolResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  logs?: string[];
}

export interface KeyToolContext {
  businessId: string;
  userId?: string | null;
  commandId?: string;
  autonomyLevel: number;
}

export type RiskTier = 1 | 2 | 3 | 4;

export interface KeyToolDefinition<I = Record<string, unknown>, O = unknown> {
  name: string;
  module: string;
  description: string;
  riskTier: RiskTier;
  requiresApproval: boolean;
  examples?: string[];
  validateInput: (input: Record<string, unknown>) => { valid: true; parsed: I } | { valid: false; error: string };
  execute: (ctx: KeyToolContext, input: I, deps: ToolDependencies) => Promise<ToolResult<O>>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
 type AnyTool = KeyToolDefinition<any, any>;

export interface ToolDependencies {
  prisma: PrismaService;
  safeToSpend: SafeToSpendService;
  cashflowForecast: CashflowForecastService;
  moneyMoves: MoneyMovesService;
  receivables: ReceivablesService;
  financeOverview: FinanceOverviewService;
  commandService: CommandService;
  timeline: TimelineService;
  connectorIntelligence: ConnectorIntelligenceService;
}

function str(input: Record<string, unknown>, key: string, fallback?: string): string | undefined {
  const v = input[key];
  if (v === undefined || v === null) return fallback;
  return String(v);
}

function num(input: Record<string, unknown>, key: string, fallback?: number): number | undefined {
  const v = input[key];
  if (v === undefined || v === null) return fallback;
  const n = Number(v);
  return Number.isNaN(n) ? fallback : n;
}

function bool(input: Record<string, unknown>, key: string, fallback = false): boolean {
  const v = input[key];
  if (v === undefined || v === null) return fallback;
  return Boolean(v);
}

// ── Tool definitions ────────────────────────────────────────────────────────

const financeSummarizeCashPosition: KeyToolDefinition<
  Record<string, never>,
  { cashBalance: number; currency: string; accountCount: number }
> = {
  name: 'summarizeCashPosition',
  module: 'finance',
  description: 'Get current cash position across all financial accounts',
  riskTier: 1,
  requiresApproval: false,
  validateInput: () => ({ valid: true, parsed: {} as Record<string, never> }),
  execute: async (ctx, _input, deps) => {
    const accounts = await (deps.prisma.client as any).financialAccount.findMany({
      where: { businessId: ctx.businessId, deletedAt: null },
      select: { balance: true, currency: true },
    });
    const cashBalance = accounts.reduce((s: number, a: any) => s + Number(a.balance ?? 0), 0);
    const currency = accounts[0]?.currency ?? 'TTD';
    return { success: true, data: { cashBalance, currency, accountCount: accounts.length } };
  },
};

const financeCalculateSafeToSpend: KeyToolDefinition<
  Record<string, never>,
  Awaited<ReturnType<SafeToSpendService['calculate']>>
> = {
  name: 'calculateSafeToSpend',
  module: 'finance',
  description: 'Calculate how much cash is truly available to spend after reserves and obligations',
  riskTier: 1,
  requiresApproval: false,
  validateInput: () => ({ valid: true, parsed: {} as Record<string, never> }),
  execute: async (ctx, _input, deps) => {
    const result = await deps.safeToSpend.calculate(ctx.businessId);
    return { success: true, data: result };
  },
};

const financeListOverdueInvoices: KeyToolDefinition<
  { limit?: number },
  { invoices: Array<{ id: string; total: number; currency: string; dueDate: string; contactName: string; daysOverdue: number }>; total: number }
> = {
  name: 'listOverdueInvoices',
  module: 'finance',
  description: 'List overdue invoices with balances and customer info',
  riskTier: 1,
  requiresApproval: false,
  validateInput: (input) => {
    const limit = num(input, 'limit', 10) ?? 10;
    return { valid: true, parsed: { limit } };
  },
  execute: async (ctx, input, deps) => {
    const aging = await deps.receivables.getAging(ctx.businessId);
    const allInvoices = (aging as any).totals?.flatMap((b: any) => b.invoices || []) || (aging as any).invoices || [];
    const invoices = allInvoices
      .filter((inv: any) => (inv.daysOverdue ?? 0) > 0)
      .sort((a: any, b: any) => (b.daysOverdue ?? 0) - (a.daysOverdue ?? 0))
      .slice(0, input.limit)
      .map((inv: any) => ({
        id: inv.id,
        total: inv.balanceDue ?? inv.total ?? 0,
        currency: inv.currency ?? 'TTD',
        dueDate: inv.dueDate,
        contactName: inv.contactName ?? inv.contact?.firstName ?? 'Unknown',
        daysOverdue: inv.daysOverdue ?? 0,
      }));
    return { success: true, data: { invoices, total: aging.totalOverdue } };
  },
};

const financeGenerateMoneyMoves: KeyToolDefinition<
  Record<string, never>,
  Awaited<ReturnType<MoneyMovesService['generate']>>
> = {
  name: 'generateMoneyMoves',
  module: 'finance',
  description: 'Generate actionable money moves to improve cashflow',
  riskTier: 1,
  requiresApproval: false,
  validateInput: () => ({ valid: true, parsed: {} as Record<string, never> }),
  execute: async (ctx, _input, deps) => {
    const moves = await deps.moneyMoves.generate(ctx.businessId);
    return { success: true, data: moves };
  },
};

const financeCashflowForecast: KeyToolDefinition<
  { horizonDays?: number },
  Awaited<ReturnType<CashflowForecastService['forecast']>>
> = {
  name: 'cashflowForecast',
  module: 'finance',
  description: 'Project future cash position with scenarios and danger dates',
  riskTier: 1,
  requiresApproval: false,
  validateInput: (input) => {
    const horizonDays = num(input, 'horizonDays', 90) ?? 90;
    return { valid: true, parsed: { horizonDays } };
  },
  execute: async (ctx, input, deps) => {
    const forecast = await deps.cashflowForecast.forecast(ctx.businessId, input.horizonDays);
    return { success: true, data: forecast };
  },
};

const financeCreateInvoiceReminderDraft: KeyToolDefinition<
  { invoiceId: string; tone: 'friendly' | 'firm' | 'urgent' },
  { draft: string; invoiceId: string }
> = {
  name: 'createInvoiceReminderDraft',
  module: 'finance',
  description: 'Draft a payment reminder message for an overdue invoice',
  riskTier: 2,
  requiresApproval: false,
  validateInput: (input) => {
    const invoiceId = str(input, 'invoiceId');
    if (!invoiceId) return { valid: false, error: 'invoiceId is required' };
    const tone = (str(input, 'tone', 'friendly') || 'friendly') as 'friendly' | 'firm' | 'urgent';
    return { valid: true, parsed: { invoiceId, tone } };
  },
  execute: async (ctx, input, deps) => {
    const invoice = await deps.prisma.client.invoice.findUnique({
      where: { id: input.invoiceId },
      include: { contact: { select: { firstName: true, lastName: true, email: true } } },
    });
    if (!invoice || invoice.businessId !== ctx.businessId) {
      return { success: false, error: 'Invoice not found' };
    }
    const name = invoice.contact?.firstName || 'there';
    const amount = Number(invoice.total);
    const currency = invoice.currency;
    const daysOverdue = invoice.dueDate
      ? Math.max(0, Math.floor((Date.now() - new Date(invoice.dueDate).getTime()) / 86400000))
      : 0;

    const templates: Record<string, string> = {
      friendly: `Hi ${name}, just a friendly reminder that invoice ${(invoice as any).invoiceNumber} for ${currency} ${amount.toLocaleString()} is ${daysOverdue > 0 ? `${daysOverdue} days overdue` : 'due soon'}. Please let me know if you need anything.`,
      firm: `Hi ${name}, this is a follow-up regarding invoice ${(invoice as any).invoiceNumber} for ${currency} ${amount.toLocaleString()}, which is now ${daysOverdue} days overdue. Please arrange payment at your earliest convenience.`,
      urgent: `Hi ${name}, invoice ${(invoice as any).invoiceNumber} for ${currency} ${amount.toLocaleString()} is ${daysOverdue} days overdue and requires immediate attention. Please contact us to arrange payment.`,
    };
    return { success: true, data: { draft: templates[input.tone] ?? templates.friendly, invoiceId: input.invoiceId } };
  },
};

const contactsRecommendFollowUps: KeyToolDefinition<
  { daysStale: number; limit: number },
  { contacts: Array<{ id: string; name: string; email: string; daysSinceContact: number; status: string }>; count: number }
> = {
  name: 'recommendFollowUps',
  module: 'contacts',
  description: 'Find contacts who have not been reached recently',
  riskTier: 1,
  requiresApproval: false,
  validateInput: (input) => {
    const daysStale = num(input, 'daysStale', 14) ?? 14;
    const limit = num(input, 'limit', 10) ?? 10;
    return { valid: true, parsed: { daysStale, limit } };
  },
  execute: async (ctx, input, deps) => {
    const cutoff = new Date(Date.now() - input.daysStale * 86400000);
    const contacts = await deps.prisma.client.contact.findMany({
      where: {
        businessId: ctx.businessId,
        deletedAt: null,
        lastInteractionAt: { lt: cutoff },
        status: { not: 'DORMANT' },
      },
      orderBy: { lastInteractionAt: 'asc' },
      take: input.limit,
      select: { id: true, firstName: true, lastName: true, email: true, status: true, lastInteractionAt: true },
    });
    const mapped = contacts.map((c: any) => ({
      id: c.id,
      name: [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email || 'Unknown',
      email: c.email || '',
      daysSinceContact: c.lastInteractionAt
        ? Math.floor((Date.now() - new Date(c.lastInteractionAt).getTime()) / 86400000)
        : 999,
      status: c.status,
    }));
    return { success: true, data: { contacts: mapped, count: mapped.length } };
  },
};

const contactsCreateCommandItem: KeyToolDefinition<
  { title: string; description: string | undefined; category: string; contactId: string | undefined; dueAt: string | undefined },
  { commandItemId: string }
> = {
  name: 'createCommandItem',
  module: 'contacts',
  description: 'Create a command item in the universal queue',
  riskTier: 1,
  requiresApproval: false,
  validateInput: (input) => {
    const title = str(input, 'title');
    if (!title) return { valid: false, error: 'title is required' };
    const category = str(input, 'category', 'PEOPLE') || 'PEOPLE';
    const validCategories = ['MONEY', 'TIME', 'PEOPLE', 'WORK', 'SALES', 'MARKETING', 'GOVERNANCE', 'STRATEGY', 'SYSTEM'];
    if (!validCategories.includes(category)) return { valid: false, error: `category must be one of: ${validCategories.join(', ')}` };
    return { valid: true, parsed: { title, description: str(input, 'description'), category, contactId: str(input, 'contactId'), dueAt: str(input, 'dueAt') } };
  },
  execute: async (ctx, input, deps) => {
    const item = await deps.commandService.create(ctx.businessId, {
      title: input.title,
      description: input.description,
      category: input.category as any,
      actionType: 'KEY_CREATED',
      sourceModule: 'KEY_AI',
      sourceType: 'command',
      sourceId: ctx.commandId,
      ownerId: input.contactId,
      ownerType: input.contactId ? 'CONTACT' : undefined,
      dueAt: input.dueAt ? new Date(input.dueAt) : undefined,
    });
    return { success: true, data: { commandItemId: item.id } };
  },
};

const commerceSummarizeRevenue: KeyToolDefinition<
  Record<string, never>,
  { totalRevenue: number; paidInvoiceCount: number; currency: string }
> = {
  name: 'summarizeRevenue',
  module: 'commerce',
  description: 'Summarize total paid revenue and invoice count',
  riskTier: 1,
  requiresApproval: false,
  validateInput: () => ({ valid: true, parsed: {} as Record<string, never> }),
  execute: async (ctx, _input, deps) => {
    const agg = await deps.prisma.client.invoice.aggregate({
      where: { businessId: ctx.businessId, deletedAt: null, status: 'PAID' },
      _sum: { total: true },
    });
    const count = await deps.prisma.client.invoice.count({ where: { businessId: ctx.businessId, deletedAt: null, status: 'PAID' } });
    const sample = await deps.prisma.client.invoice.findFirst({ where: { businessId: ctx.businessId }, select: { currency: true } });
    return { success: true, data: { totalRevenue: Number(agg._sum.total ?? 0), paidInvoiceCount: count, currency: sample?.currency ?? 'TTD' } };
  },
};

const timelineCreateReminder: KeyToolDefinition<
  { title: string; contactId: string | undefined; dueDate: string | undefined },
  { reminderId: string }
> = {
  name: 'createReminder',
  module: 'timeline',
  description: 'Create a reminder or follow-up task',
  riskTier: 1,
  requiresApproval: false,
  validateInput: (input) => {
    const title = str(input, 'title');
    if (!title) return { valid: false, error: 'title is required' };
    return { valid: true, parsed: { title, contactId: str(input, 'contactId'), dueDate: str(input, 'dueDate') } };
  },
  execute: async (ctx, input, deps) => {
    const task = await (deps.prisma.client as any).contactTask.create({
      data: {
        businessId: ctx.businessId,
        contactId: input.contactId || undefined,
        title: input.title,
        status: 'OPEN',
        dueDate: input.dueDate ? new Date(input.dueDate) : undefined,
      },
    });
    return { success: true, data: { reminderId: task.id } };
  },
};

const connectScanDrive: KeyToolDefinition<
  Record<string, never>,
  { scanned: number; newFiles: number }
> = {
  name: 'scanDrive',
  module: 'connect',
  description: 'Scan connected Google Drive for new business documents',
  riskTier: 1,
  requiresApproval: false,
  validateInput: () => ({ valid: true, parsed: {} as Record<string, never> }),
  execute: async (ctx, _input, deps) => {
    const result = await deps.connectorIntelligence.syncGoogleDrive(ctx.businessId);
    return { success: true, data: result };
  },
};

const connectListDriveIntake: KeyToolDefinition<
  { status?: string; limit?: number },
  { items: Array<Record<string, unknown>>; count: number }
> = {
  name: 'listDriveIntake',
  module: 'connect',
  description: 'List detected Drive intake items waiting for review',
  riskTier: 1,
  requiresApproval: false,
  validateInput: (input) => {
    const status = str(input, 'status');
    const limit = num(input, 'limit', 20) ?? 20;
    return { valid: true, parsed: { status, limit } };
  },
  execute: async (ctx, input, deps) => {
    const where: Record<string, unknown> = { businessId: ctx.businessId };
    if (input.status) where.status = input.status;
    const items = await (deps.prisma.client as any).driveIntakeFile.findMany({
      where,
      orderBy: { modifiedTime: 'desc' },
      take: input.limit,
    });
    return { success: true, data: { items, count: items.length } };
  },
};

const messagesListMessageIntake: KeyToolDefinition<
  { status?: string; sourceChannel?: string; limit?: number },
  { items: Array<Record<string, unknown>>; count: number }
> = {
  name: 'listMessageIntake',
  module: 'messages',
  description: 'List message intake items waiting for approval across WhatsApp, email, SMS, Facebook and Instagram',
  riskTier: 1,
  requiresApproval: false,
  validateInput: (input) => {
    const status = str(input, 'status');
    const sourceChannel = str(input, 'sourceChannel');
    const limit = num(input, 'limit', 20) ?? 20;
    return { valid: true, parsed: { status, sourceChannel, limit } };
  },
  execute: async (ctx, input, deps) => {
    const where: Record<string, unknown> = { businessId: ctx.businessId };
    if (input.status) where.status = input.status;
    if (input.sourceChannel) where.sourceChannel = input.sourceChannel;
    const items = await (deps.prisma.client as any).messageIntake.findMany({
      where,
      orderBy: { detectedAt: 'desc' },
      take: input.limit,
      include: { contact: { select: { firstName: true, lastName: true, email: true, phone: true } } },
    });
    return { success: true, data: { items, count: items.length } };
  },
};

const socialListRecentEngagement: KeyToolDefinition<
  { limit?: number },
  { engagements: Array<Record<string, unknown>>; count: number }
> = {
  name: 'listRecentEngagement',
  module: 'social',
  description: 'List recent social engagements (comments, DMs, mentions) from Facebook and Instagram',
  riskTier: 1,
  requiresApproval: false,
  validateInput: (input) => {
    const limit = num(input, 'limit', 20) ?? 20;
    return { valid: true, parsed: { limit } };
  },
  execute: async (ctx, input, deps) => {
    const items = await (deps.prisma.client as any).socialEngagement.findMany({
      where: { businessId: ctx.businessId },
      orderBy: { createdAt: 'desc' },
      take: input.limit,
    });
    return { success: true, data: { engagements: items, count: items.length } };
  },
};

// ── Registry ────────────────────────────────────────────────────────────────

@Injectable()
export class KeyToolRegistryService {
  private readonly logger = new Logger(KeyToolRegistryService.name);
  private readonly tools = new Map<string, KeyToolDefinition>();

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(forwardRef(() => SafeToSpendService)) private readonly safeToSpend: SafeToSpendService,
    @Inject(forwardRef(() => CashflowForecastService)) private readonly cashflowForecast: CashflowForecastService,
    @Inject(forwardRef(() => MoneyMovesService)) private readonly moneyMoves: MoneyMovesService,
    @Inject(forwardRef(() => ReceivablesService)) private readonly receivables: ReceivablesService,
    @Inject(forwardRef(() => FinanceOverviewService)) private readonly financeOverview: FinanceOverviewService,
    @Inject(forwardRef(() => CommandService)) private readonly commandService: CommandService,
    @Inject(TimelineService) private readonly timeline: TimelineService,
    @Inject(ConnectorIntelligenceService) private readonly connectorIntelligence: ConnectorIntelligenceService,
    @Inject(AiExecutionLogService) private readonly auditLog: AiExecutionLogService,
  ) {
    this.register(financeSummarizeCashPosition);
    this.register(financeCalculateSafeToSpend);
    this.register(financeListOverdueInvoices);
    this.register(financeGenerateMoneyMoves);
    this.register(financeCashflowForecast);
    this.register(financeCreateInvoiceReminderDraft);
    this.register(contactsRecommendFollowUps);
    this.register(contactsCreateCommandItem);
    this.register(commerceSummarizeRevenue);
    this.register(timelineCreateReminder);
    this.register(connectScanDrive);
    this.register(connectListDriveIntake);
    this.register(messagesListMessageIntake);
    this.register(socialListRecentEngagement);
  }

  private register(tool: AnyTool) {
    const key = `${tool.module}.${tool.name}`;
    this.tools.set(key, tool);
  }

  getTool(module: string, name: string): AnyTool | undefined {
    return this.tools.get(`${module}.${name}`);
  }

  listTools(): Array<{ key: string; description: string; riskTier: RiskTier; requiresApproval: boolean }> {
    return Array.from(this.tools.entries()).map(([key, t]) => ({
      key,
      description: t.description,
      riskTier: t.riskTier,
      requiresApproval: t.requiresApproval,
    }));
  }

  canExecute(tool: AnyTool, autonomyLevel: number): { allowed: boolean; reason?: string } {
    // Risk tier rules:
    // Tier 1 (LOW): auto-allowed if autonomy >= 2 (INTERNAL_EXEC)
    // Tier 2 (MEDIUM): auto-allowed if autonomy >= 4 (TRUSTED_AUTOPILOT), otherwise approval
    // Tier 3 (HIGH): always requires approval
    // Tier 4 (CRITICAL): always blocked from AI execution
    if (tool.riskTier === 4) {
      return { allowed: false, reason: 'CRITICAL risk actions cannot be executed by AI' };
    }
    if (tool.riskTier === 3) {
      return { allowed: false, reason: 'HIGH risk actions require explicit user approval' };
    }
    if (tool.riskTier === 2 && autonomyLevel < 4) {
      return { allowed: false, reason: 'MEDIUM risk actions require TRUSTED_AUTOPILOT autonomy' };
    }
    if (tool.riskTier === 1 && autonomyLevel < 2) {
      return { allowed: false, reason: 'LOW risk actions require INTERNAL_EXEC autonomy or higher' };
    }
    return { allowed: true };
  }

  async executeTool(
    toolName: string,
    rawInput: Record<string, unknown>,
    businessIdOrCtx: string | KeyToolContext,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<ToolResult<any>> {
    const [module, name] = toolName.includes('.') ? toolName.split('.') : ['general', toolName];
    const ctx: KeyToolContext = typeof businessIdOrCtx === 'string'
      ? { businessId: businessIdOrCtx, autonomyLevel: 4 }
      : businessIdOrCtx;
    return this.execute(module, name, ctx, rawInput);
  }

  async execute(
    module: string,
    name: string,
    ctx: KeyToolContext,
    rawInput: Record<string, unknown>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<ToolResult<any>> {
    const tool = this.getTool(module, name);
    if (!tool) {
      return { success: false, error: `Tool ${module}.${name} not found in registry` };
    }

    // Validate input
    const validation = tool.validateInput(rawInput);
    if (!validation.valid) {
      return { success: false, error: `Input validation failed: ${validation.error}` };
    }

    // Check autonomy / risk
    const permission = this.canExecute(tool, ctx.autonomyLevel);
    if (!permission.allowed) {
      return { success: false, error: `Risk check failed: ${permission.reason}` };
    }

    const deps: ToolDependencies = {
      prisma: this.prisma,
      safeToSpend: this.safeToSpend,
      cashflowForecast: this.cashflowForecast,
      moneyMoves: this.moneyMoves,
      receivables: this.receivables,
      financeOverview: this.financeOverview,
      commandService: this.commandService,
      timeline: this.timeline,
      connectorIntelligence: this.connectorIntelligence,
    };

    const startMs = Date.now();
    try {
      const result = await tool.execute(ctx, validation.parsed, deps);
      const durationMs = Date.now() - startMs;

      // Audit log
      this.auditLog.logToolExecution(
        ctx.businessId,
        `${module}.${name}`,
        validation.parsed as Record<string, unknown>,
        result.data,
        result.success,
        durationMs,
        {
          riskTier: tool.riskTier,
          mode: 'key',
          planId: ctx.commandId,
          role: ctx.autonomyLevel >= 4 ? 'autopilot' : ctx.autonomyLevel >= 2 ? 'executor' : 'draft',
        },
      ).catch((err) => this.logger.warn(`Audit log failed: ${(err as Error).message}`));

      return result;
    } catch (e) {
      const err = e as Error;
      const durationMs = Date.now() - startMs;
      this.logger.error(`Tool ${module}.${name} failed: ${err.message}`, err.stack);

      this.auditLog.logToolExecution(
        ctx.businessId,
        `${module}.${name}`,
        validation.parsed as Record<string, unknown>,
        { error: err.message },
        false,
        durationMs,
        {
          riskTier: tool.riskTier,
          mode: 'key',
          planId: ctx.commandId,
          role: ctx.autonomyLevel >= 4 ? 'autopilot' : ctx.autonomyLevel >= 2 ? 'executor' : 'draft',
        },
      ).catch((auditErr) => this.logger.warn(`Audit log failed: ${(auditErr as Error).message}`));

      return { success: false, error: err.message };
    }
  }
}
