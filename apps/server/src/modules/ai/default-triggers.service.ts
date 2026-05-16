import { Injectable, Logger, Inject } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

export const DEFAULT_AGENT_TRIGGERS = [
  {
    name: 'Booking Completion → Invoice & Follow-up',
    eventPattern: 'booking.completed',
    objective: 'Create invoice for completed booking and send follow-up review request to customer',
    autoExecute: true,
    maxRiskTier: 2,
  },
  {
    name: 'Overdue Invoice → Payment Reminder',
    eventPattern: 'invoice.overdue',
    objective: 'Send payment reminder to customer with overdue invoice and create collection task',
    autoExecute: true,
    maxRiskTier: 2,
  },
  {
    name: 'New Lead → Qualification & Assignment',
    eventPattern: 'contact.created',
    condition: { 'payload.status': { op: 'eq', value: 'LEAD' } },
    objective: 'Qualify new lead, add welcome tag, create follow-up task for sales team',
    autoExecute: true,
    maxRiskTier: 1,
  },
  {
    name: 'Quote Accepted → Convert to Invoice',
    eventPattern: 'quote.accepted',
    objective: 'Convert accepted quote to invoice and send to customer',
    autoExecute: true,
    maxRiskTier: 2,
  },
  {
    name: 'Support Ticket Created → Assignment',
    eventPattern: 'supportTicket.created',
    objective: 'Assign support ticket to appropriate team member based on org unit and priority',
    autoExecute: true,
    maxRiskTier: 2,
  },
  {
    name: 'Inventory Low → Reorder Alert',
    eventPattern: 'inventory.low',
    objective: 'Create procurement request for low stock items and notify purchasing manager',
    autoExecute: true,
    maxRiskTier: 2,
  },
  {
    name: 'Booking No-Show → Reschedule Task',
    eventPattern: 'booking.no_show',
    objective: 'Create task to contact customer for reschedule and flag account',
    autoExecute: true,
    maxRiskTier: 2,
  },
  {
    name: 'Payment Received → Thank You',
    eventPattern: 'invoice.paid',
    objective: 'Send thank you message to customer and update contact health score',
    autoExecute: true,
    maxRiskTier: 1,
  },
  {
    name: 'Stale Quote → Follow-up Reminder',
    eventPattern: 'quote.stale',
    objective: 'Send follow-up email for stale quote and create sales task',
    autoExecute: true,
    maxRiskTier: 2,
  },
  {
    name: 'Recurring Invoice Due → Send Invoice',
    eventPattern: 'recurring_invoice.due',
    objective: 'Send recurring invoice to customer and update next billing date',
    autoExecute: true,
    maxRiskTier: 2,
  },
  {
    name: 'High-Value Lead → Priority Alert',
    eventPattern: 'contact.created',
    condition: { 'payload.leadScore': { op: 'gte', value: 80 } },
    objective: 'Flag high-value lead, notify sales manager, and schedule priority follow-up',
    autoExecute: true,
    maxRiskTier: 1,
  },
  {
    name: 'Customer Complaint → Escalation',
    eventPattern: 'supportTicket.created',
    condition: { 'payload.priority': { op: 'eq', value: 'URGENT' } },
    objective: 'Escalate urgent support ticket to manager and create immediate response task',
    autoExecute: true,
    maxRiskTier: 2,
  },
  {
    name: 'Form Submission → Lead Capture',
    eventPattern: 'lead_form.submitted',
    objective: 'Process form submission, create or update contact, and trigger welcome sequence',
    autoExecute: true,
    maxRiskTier: 1,
  },
  {
    name: 'Abandoned Cart → Recovery Email',
    eventPattern: 'store_order.abandoned',
    objective: 'Send abandoned cart recovery email with discount incentive',
    autoExecute: true,
    maxRiskTier: 2,
  },
  {
    name: 'Project Milestone → Client Update',
    eventPattern: 'project_task.completed',
    condition: { 'payload.isMilestone': { op: 'eq', value: true } },
    objective: 'Notify client of project milestone completion and send progress update',
    autoExecute: true,
    maxRiskTier: 1,
  },
];

@Injectable()
export class DefaultTriggersService {
  private readonly logger = new Logger(DefaultTriggersService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async seedForBusiness(businessId: string): Promise<number> {
    const existing = await this.prisma.client.agentTrigger.count({
      where: { businessId },
    });

    if (existing > 0) {
      this.logger.log(`Business ${businessId} already has ${existing} triggers — skipping seed`);
      return 0;
    }

    let created = 0;
    for (const trigger of DEFAULT_AGENT_TRIGGERS) {
      try {
        await this.prisma.client.agentTrigger.create({
          data: {
            businessId,
            name: trigger.name,
            eventPattern: trigger.eventPattern,
            condition: trigger.condition ? trigger.condition as any : undefined,
            objective: trigger.objective,
            autoExecute: trigger.autoExecute,
            maxRiskTier: trigger.maxRiskTier,
            enabled: true,
          },
        });
        created++;
      } catch (err) {
        this.logger.error(`Failed to seed trigger "${trigger.name}": ${(err as Error).message}`);
      }
    }

    // Also seed autopilot settings with sensible defaults
    await this.prisma.client.autopilotSettings.upsert({
      where: { businessId },
      create: {
        businessId,
        autonomyLevel: 2,
        approvedTools: [
          'crm_create_contact',
          'crm_add_task',
          'crm_add_note',
          'commerce_create_invoice',
          'fetch_business_summary',
          'fetch_client_health',
        ],
        blockedTools: [],
        maxDailyAutoActions: 50,
        approvalTimeoutHours: 24,
        notifyOnAutoAction: true,
        learningEnabled: true,
      },
      update: {},
    }).catch(() => {});

    this.logger.log(`Seeded ${created} default triggers + autopilot settings for business ${businessId}`);
    return created;
  }
}
