import { Injectable, Logger, Inject } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { PlannerService } from './planner.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

export interface WorkflowTemplate {
  key: string;
  name: string;
  description: string;
  category: string;
  steps: WorkflowStep[];
}

export interface WorkflowStep {
  order: number;
  toolName: string | null;
  module: string | null;
  action: string;
  description: string;
  riskTier: number;
  dependsOnOrders: number[];
  inputPayload: Record<string, any> | null;
  expectedBenefit: string;
}

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    key: 'onboard_new_client',
    name: 'Onboard New Client',
    description: 'Complete client onboarding: contact, welcome, project, meeting, invoice',
    category: 'crm',
    steps: [
      { order: 1, toolName: 'crm_create_contact', module: 'crm', action: 'Create contact record', description: 'Add client to CRM', riskTier: 2, dependsOnOrders: [], inputPayload: {}, expectedBenefit: 'Client record exists' },
      { order: 2, toolName: 'draft_welcome_email', module: 'crm', action: 'Draft welcome email', description: 'Personalized welcome message', riskTier: 1, dependsOnOrders: [1], inputPayload: {}, expectedBenefit: 'Warm first impression' },
      { order: 3, toolName: 'projects_create_project', module: 'projects', action: 'Create project', description: 'Set up project with standard tasks', riskTier: 2, dependsOnOrders: [1], inputPayload: {}, expectedBenefit: 'Project tracking begins' },
      { order: 4, toolName: 'bookings_create_booking', module: 'bookings', action: 'Schedule kickoff meeting', description: 'Find available slot and book', riskTier: 2, dependsOnOrders: [1], inputPayload: {}, expectedBenefit: 'Meeting scheduled' },
      { order: 5, toolName: 'draft_calendar_invite', module: 'crm', action: 'Send calendar invite', description: 'Invite client to kickoff', riskTier: 2, dependsOnOrders: [4], inputPayload: {}, expectedBenefit: 'Client confirmed' },
      { order: 6, toolName: 'commerce_create_invoice', module: 'commerce', action: 'Create deposit invoice', description: 'Initial deposit for project start', riskTier: 2, dependsOnOrders: [1, 3], inputPayload: {}, expectedBenefit: 'Cashflow secured' },
      { order: 7, toolName: 'crm_update_contact_status', module: 'crm', action: 'Update CRM status', description: 'Mark as onboarded', riskTier: 1, dependsOnOrders: [1, 3, 6], inputPayload: { status: 'ONBOARDED' }, expectedBenefit: 'Pipeline updated' },
    ],
  },
  {
    key: 'month_end_close',
    name: 'End-of-Month Close',
    description: 'Generate invoices, bill overages, send reminders, compile reports',
    category: 'finance',
    steps: [
      { order: 1, toolName: 'commerce_generate_draft_invoices', module: 'commerce', action: 'Generate draft invoices', description: 'Create invoices for completed work', riskTier: 2, dependsOnOrders: [], inputPayload: {}, expectedBenefit: 'Revenue captured' },
      { order: 2, toolName: 'retainers_bill_overages', module: 'commerce', action: 'Bill retainer overages', description: 'Review and bill any overage hours', riskTier: 2, dependsOnOrders: [], inputPayload: {}, expectedBenefit: 'Retainer revenue captured' },
      { order: 3, toolName: 'draft_payment_reminder', module: 'commerce', action: 'Send invoice reminders', description: 'Remind clients of overdue invoices', riskTier: 2, dependsOnOrders: [], inputPayload: { daysOverdue: 15 }, expectedBenefit: 'Collections accelerated' },
      { order: 4, toolName: 'fetch_expense_report', module: 'expenses', action: 'Compile expense report', description: 'Monthly expense summary', riskTier: 1, dependsOnOrders: [], inputPayload: {}, expectedBenefit: 'Expenses tracked' },
      { order: 5, toolName: 'fetch_revenue_summary', module: 'commerce', action: 'Generate P&L summary', description: 'Profit and loss overview', riskTier: 1, dependsOnOrders: [1, 4], inputPayload: {}, expectedBenefit: 'Financial visibility' },
    ],
  },
  {
    key: 'reengage_cold_leads',
    name: 'Re-Engage Cold Leads',
    description: 'Identify dormant leads, draft messages, send approved, schedule follow-ups',
    category: 'crm',
    steps: [
      { order: 1, toolName: 'crm_search_contacts', module: 'crm', action: 'Identify cold leads', description: 'Find leads with no contact in 30+ days', riskTier: 1, dependsOnOrders: [], inputPayload: { filters: { lastContactDays: 30, status: 'LEAD' } }, expectedBenefit: 'Target list created' },
      { order: 2, toolName: 'draft_followup_message', module: 'crm', action: 'Draft re-engagement messages', description: 'Personalized messages for each lead', riskTier: 1, dependsOnOrders: [1], inputPayload: {}, expectedBenefit: 'Outreach prepared' },
      { order: 3, toolName: 'crm_send_message', module: 'crm', action: 'Send approved messages', description: 'Deliver re-engagement emails', riskTier: 2, dependsOnOrders: [2], inputPayload: {}, expectedBenefit: 'Leads reactivated' },
      { order: 4, toolName: 'create_task', module: 'crm', action: 'Schedule follow-up tasks', description: 'Create tasks for non-responders in 7 days', riskTier: 2, dependsOnOrders: [3], inputPayload: { dueDays: 7 }, expectedBenefit: 'No lead forgotten' },
    ],
  },
  {
    key: 'follow_up_overdue',
    name: 'Follow-Up Blitz',
    description: 'Handle all pending follow-ups: stale leads, overdue invoices, unconfirmed bookings',
    category: 'multi',
    steps: [
      { order: 1, toolName: 'crm_search_contacts', module: 'crm', action: 'Find stale leads', description: 'Leads not contacted in 14+ days', riskTier: 1, dependsOnOrders: [], inputPayload: { filters: { lastContactDays: 14 } }, expectedBenefit: 'Stale leads identified' },
      { order: 2, toolName: 'draft_followup_message', module: 'crm', action: 'Draft follow-ups', description: 'Personalized messages', riskTier: 1, dependsOnOrders: [1], inputPayload: {}, expectedBenefit: 'Messages ready' },
      { order: 3, toolName: 'fetch_overdue_invoices', module: 'commerce', action: 'Find overdue invoices', description: 'Invoices past due date', riskTier: 1, dependsOnOrders: [], inputPayload: {}, expectedBenefit: 'Collection targets identified' },
      { order: 4, toolName: 'draft_payment_reminder', module: 'commerce', action: 'Draft payment reminders', description: 'Polite reminder messages', riskTier: 1, dependsOnOrders: [3], inputPayload: {}, expectedBenefit: 'Reminders ready' },
      { order: 5, toolName: 'fetch_pending_bookings', module: 'bookings', action: 'Find pending bookings', description: 'Unconfirmed appointments', riskTier: 1, dependsOnOrders: [], inputPayload: {}, expectedBenefit: 'Booking gaps found' },
      { order: 6, toolName: 'draft_booking_confirmation', module: 'bookings', action: 'Draft confirmation requests', description: 'Ask clients to confirm', riskTier: 1, dependsOnOrders: [5], inputPayload: {}, expectedBenefit: 'Confirmations ready' },
    ],
  },
];

@Injectable()
export class WorkflowTemplateService {
  private readonly logger = new Logger(WorkflowTemplateService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PlannerService) private readonly planner: PlannerService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
  ) {}

  getTemplates(): WorkflowTemplate[] {
    return WORKFLOW_TEMPLATES;
  }

  getTemplate(key: string): WorkflowTemplate | undefined {
    return WORKFLOW_TEMPLATES.find(t => t.key === key);
  }

  /**
   * Instantiate a workflow template as an AiPlan.
   * Returns the created plan ID.
   */
  async instantiateWorkflow(
    businessId: string,
    templateKey: string,
    userId: string | undefined,
    overrides?: { contactId?: string; projectId?: string; amount?: number },
  ): Promise<{ planId: string; plan: any }> {
    const template = this.getTemplate(templateKey);
    if (!template) throw new Error(`Workflow template '${templateKey}' not found`);

    // Resolve dependencies: convert dependsOnOrders (1-based) to step IDs
    const stepsWithDeps = template.steps.map((step, idx) => ({
      ...step,
      dependsOn: [] as string[], // Will be populated after creation
    }));

    // Build input payloads with overrides
    const resolvedSteps = stepsWithDeps.map(step => {
      const payload = { ...step.inputPayload };
      if (overrides?.contactId) payload.contactId = overrides.contactId;
      if (overrides?.projectId) payload.projectId = overrides.projectId;
      if (overrides?.amount) payload.amount = overrides.amount;
      return { ...step, inputPayload: payload };
    });

    const maxRiskTier = resolvedSteps.reduce((max, s) => Math.max(max, s.riskTier), 1);

    const plan = await this.prisma.client.aiPlan.create({
      data: {
        businessId,
        userId: userId ?? null,
        objective: template.name,
        rawInput: `Workflow: ${template.description}`,
        urgency: 'normal',
        scope: [template.category],
        modules: [...new Set(resolvedSteps.map(s => s.module).filter(Boolean))],
        maxRiskTier,
        status: 'draft',
        role: template.category === 'multi' ? 'operator' : template.category,
        steps: {
          create: resolvedSteps.map(s => ({
            order: s.order,
            toolName: s.toolName ?? undefined,
            module: s.module ?? undefined,
            action: s.action,
            description: s.description,
            riskTier: s.riskTier,
            requiresApproval: s.riskTier >= 2,
            dependsOn: [],
            inputPayload: s.inputPayload ? (s.inputPayload as any) : undefined,
            expectedBenefit: s.expectedBenefit,
            status: 'pending',
            role: template.category === 'multi' ? 'operator' : template.category,
          })),
        },
      },
      include: { steps: { orderBy: { order: 'asc' } } },
    });

    // Resolve dependsOnOrders → step IDs
    const orderToId = new Map<number, string>();
    for (const s of plan.steps) {
      orderToId.set(s.order, s.id);
    }

    for (const step of plan.steps) {
      const templateStep = template.steps.find(s => s.order === step.order);
      if (templateStep && templateStep.dependsOnOrders.length > 0) {
        const depIds = templateStep.dependsOnOrders
          .map(o => orderToId.get(o))
          .filter((id): id is string => id !== undefined);
        if (depIds.length > 0) {
          await this.prisma.client.aiPlanStep.update({
            where: { id: step.id },
            data: { dependsOn: depIds },
          });
        }
      }
    }

    this.logger.log(`Instantiated workflow '${templateKey}' as plan ${plan.id}`);

    return { planId: plan.id, plan };
  }
}
