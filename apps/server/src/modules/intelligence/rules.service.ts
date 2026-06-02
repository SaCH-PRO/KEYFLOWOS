import { Injectable, Inject, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

export interface RuleCondition {
  field: string;
  operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'contains' | 'exists';
  value?: unknown;
}

export interface RuleAction {
  type: 'CREATE_SIGNAL' | 'CREATE_COMMAND' | 'LOG';
  payload: Record<string, unknown>;
}

export interface SystemRule {
  key: string;
  name: string;
  description: string;
  module: string;
  triggerType: string;
  condition: RuleCondition;
  action: RuleAction;
  severity: 'INFO' | 'WARN' | 'CRITICAL';
}

export const SYSTEM_RULES: SystemRule[] = [
  {
    key: 'invoice_overdue',
    name: 'Overdue Invoice',
    description: 'Invoice is past due date and not fully paid',
    module: 'commerce',
    triggerType: 'scheduled',
    condition: { field: 'invoice.status', operator: 'eq', value: 'SENT' },
    action: { type: 'CREATE_COMMAND', payload: { category: 'MONEY', actionType: 'COLLECT_PAYMENT', title: 'Collect overdue invoice' } },
    severity: 'WARN',
  },
  {
    key: 'stale_lead',
    name: 'Stale Lead',
    description: 'Lead has had no activity in 14+ days',
    module: 'crm',
    triggerType: 'scheduled',
    condition: { field: 'contact.lastContactedAt', operator: 'lt', value: '14d' },
    action: { type: 'CREATE_COMMAND', payload: { category: 'PEOPLE', actionType: 'FOLLOW_UP', title: 'Follow up stale lead' } },
    severity: 'INFO',
  },
  {
    key: 'quote_pending_followup',
    name: 'Quote Pending Follow-up',
    description: 'Quote sent but not followed up within 3 days',
    module: 'commerce',
    triggerType: 'scheduled',
    condition: { field: 'quote.status', operator: 'eq', value: 'SENT' },
    action: { type: 'CREATE_COMMAND', payload: { category: 'MONEY', actionType: 'FOLLOW_UP_QUOTE', title: 'Follow up on quote' } },
    severity: 'INFO',
  },
  {
    key: 'uncategorized_expense',
    name: 'Uncategorized Expense',
    description: 'Expense lacks a category assignment',
    module: 'finance',
    triggerType: 'scheduled',
    condition: { field: 'expense.categoryId', operator: 'exists', value: false },
    action: { type: 'CREATE_COMMAND', payload: { category: 'MONEY', actionType: 'CATEGORIZE_EXPENSE', title: 'Categorize expense' } },
    severity: 'INFO',
  },
  {
    key: 'low_safe_to_spend',
    name: 'Low Safe-to-Spend',
    description: 'Safe-to-spend cash is below operating buffer',
    module: 'finance',
    triggerType: 'scheduled',
    condition: { field: 'safeToSpend.amount', operator: 'lt', value: 0 },
    action: { type: 'CREATE_SIGNAL', payload: { type: 'CASH_RISK', title: 'Safe-to-spend is negative' } },
    severity: 'CRITICAL',
  },
  {
    key: 'booking_unconfirmed',
    name: 'Unconfirmed Booking',
    description: 'Booking request has not been confirmed',
    module: 'bookings',
    triggerType: 'scheduled',
    condition: { field: 'booking.status', operator: 'eq', value: 'PENDING' },
    action: { type: 'CREATE_COMMAND', payload: { category: 'TIME', actionType: 'CONFIRM_BOOKING', title: 'Confirm pending booking' } },
    severity: 'INFO',
  },
  {
    key: 'overdue_task',
    name: 'Overdue Task',
    description: 'Project or contact task is past due',
    module: 'projects',
    triggerType: 'scheduled',
    condition: { field: 'task.dueDate', operator: 'lt', value: 'now' },
    action: { type: 'CREATE_COMMAND', payload: { category: 'WORK', actionType: 'COMPLETE_TASK', title: 'Complete overdue task' } },
    severity: 'WARN',
  },
  {
    key: 'storefront_no_products',
    name: 'Storefront Missing Products',
    description: 'No active products or services in storefront',
    module: 'storefront',
    triggerType: 'scheduled',
    condition: { field: 'product.count', operator: 'eq', value: 0 },
    action: { type: 'CREATE_COMMAND', payload: { category: 'SALES', actionType: 'ADD_PRODUCT', title: 'Add products to storefront' } },
    severity: 'WARN',
  },
  {
    key: 'blueprint_incomplete',
    name: 'Incomplete Blueprint',
    description: 'Business blueprint is less than 80% complete',
    module: 'system',
    triggerType: 'scheduled',
    condition: { field: 'blueprint.completeness', operator: 'lt', value: 80 },
    action: { type: 'CREATE_COMMAND', payload: { category: 'SYSTEM', actionType: 'COMPLETE_SETUP', title: 'Complete business blueprint' } },
    severity: 'INFO',
  },
  {
    key: 'tax_period_due_soon',
    name: 'Tax Period Due Soon',
    description: 'Tax liability due within 14 days',
    module: 'finance',
    triggerType: 'scheduled',
    condition: { field: 'taxLiability.dueDate', operator: 'lte', value: '14d' },
    action: { type: 'CREATE_COMMAND', payload: { category: 'MONEY', actionType: 'FILE_TAX', title: 'File upcoming tax return' } },
    severity: 'WARN',
  },
];

@Injectable()
export class RulesService {
  private readonly logger = new Logger(RulesService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async listRules(businessId: string, opts?: { module?: string; enabled?: boolean }) {
    const where: Record<string, unknown> = { OR: [{ businessId }, { isSystem: true }] };
    if (opts?.module) where.module = opts.module;
    if (opts?.enabled !== undefined) where.enabled = opts.enabled;
    return this.prisma.client.businessRule.findMany({ where, orderBy: { createdAt: 'desc' } });
  }

  async createRule(businessId: string, input: { name: string; description?: string; module: string; triggerType: string; condition: unknown; action: unknown; severity?: string; enabled?: boolean }) {
    return this.prisma.client.businessRule.create({
      data: {
        businessId,
        name: input.name,
        description: input.description,
        module: input.module,
        triggerType: input.triggerType,
        condition: input.condition as any,
        action: input.action as any,
        severity: input.severity ?? 'INFO',
        enabled: input.enabled ?? true,
        isSystem: false,
      },
    });
  }

  async updateRule(businessId: string, id: string, input: Partial<{ name: string; description?: string; module: string; triggerType: string; condition: unknown; action: unknown; severity?: string; enabled?: boolean }>) {
    const existing = await this.prisma.client.businessRule.findFirst({ where: { id, businessId } });
    if (!existing) throw new Error('Rule not found');
    return this.prisma.client.businessRule.update({
      where: { id },
      data: {
        name: input.name,
        description: input.description,
        module: input.module,
        triggerType: input.triggerType,
        condition: input.condition as any,
        action: input.action as any,
        severity: input.severity,
        enabled: input.enabled,
      },
    });
  }

  async deleteRule(businessId: string, id: string) {
    const existing = await this.prisma.client.businessRule.findFirst({ where: { id, businessId } });
    if (!existing) throw new Error('Rule not found');
    if (existing.isSystem) throw new Error('Cannot delete system rules');
    return this.prisma.client.businessRule.delete({ where: { id } });
  }

  async seedSystemRules(businessId: string) {
    for (const rule of SYSTEM_RULES) {
      await this.prisma.client.businessRule.upsert({
        where: { id: `system_${rule.key}_${businessId}` },
        update: {},
        create: {
          id: `system_${rule.key}_${businessId}`,
          businessId,
          name: rule.name,
          description: rule.description,
          module: rule.module,
          triggerType: rule.triggerType,
          condition: rule.condition as any,
          action: rule.action as any,
          severity: rule.severity,
          enabled: true,
          isSystem: true,
        },
      });
    }
  }

  getSystemRules(): SystemRule[] {
    return SYSTEM_RULES;
  }
}
