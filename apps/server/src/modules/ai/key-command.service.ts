import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { keyToolRegistry, ToolResult } from './key-tool.registry';

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

@Injectable()
export class KeyCommandService {
  private readonly logger = new Logger(KeyCommandService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async receiveCommand(businessId: string, userId: string | undefined, rawInput: string, inputMode: 'TEXT' | 'VOICE' = 'TEXT') {
    return (this.prisma.client as any).keyCommand.create({
      data: {
        businessId,
        userId: userId ?? null,
        rawInput,
        inputMode,
        status: 'RECEIVED',
      },
    });
  }

  async interpretIntent(commandId: string): Promise<Record<string, unknown>> {
    const cmd = await (this.prisma.client as any).keyCommand.findUnique({ where: { id: commandId } });
    if (!cmd) throw new Error('Command not found');

    // Simple rule-based intent parsing (replace with LLM call when quota available)
    const raw = cmd.rawInput.toLowerCase();
    let intent: Record<string, unknown> = { domain: 'general', action: 'unknown' };

    if (raw.includes('invoice')) intent = { domain: 'commerce', action: 'invoice_query', entities: {} };
    else if (raw.includes('quote')) intent = { domain: 'commerce', action: 'quote_query', entities: {} };
    else if (raw.includes('contact') || raw.includes('customer') || raw.includes('lead')) intent = { domain: 'contacts', action: 'contact_query', entities: {} };
    else if (raw.includes('booking') || raw.includes('appointment')) intent = { domain: 'bookings', action: 'booking_query', entities: {} };
    else if (raw.includes('storefront') || raw.includes('website')) intent = { domain: 'storefront', action: 'storefront_audit', entities: {} };
    else if (raw.includes('revenue') || raw.includes('money') || raw.includes('sales')) intent = { domain: 'commerce', action: 'revenue_summary', entities: {} };
    else if (raw.includes('follow up') || raw.includes('follow-up')) intent = { domain: 'contacts', action: 'follow_up', entities: {} };

    await (this.prisma.client as any).keyCommand.update({
      where: { id: commandId },
      data: { intent: intent as any, status: 'PLANNED' },
    });

    return intent;
  }

  async groundIntent(commandId: string, businessId: string): Promise<Record<string, unknown>> {
    // Fetch relevant business context
    const [contacts, invoices, bookings] = await Promise.all([
      (this.prisma.client as any).contact.count({ where: { businessId, deletedAt: null } }),
      (this.prisma.client as any).invoice.aggregate({ where: { businessId, deletedAt: null, status: 'PAID' }, _sum: { total: true } }),
      (this.prisma.client as any).booking.count({ where: { businessId, deletedAt: null } }),
    ]);

    const grounded = {
      contactCount: contacts,
      totalRevenue: Number(invoices._sum.total ?? 0),
      bookingCount: bookings,
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
      const toolFn = keyToolRegistry[step.module]?.[step.tool];
      if (!toolFn) {
        results.push({ success: false, error: `Tool ${step.module}.${step.tool} not found` });
        continue;
      }
      try {
        const result = await toolFn(businessId, step.input);
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

    return results;
  }

  async logResult(commandId: string, result: ToolResult[]) {
    // Already logged in executeApprovedPlan
    this.logger.debug(`Command ${commandId} executed with ${result.length} steps`);
  }
}
