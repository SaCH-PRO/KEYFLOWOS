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
  // L3/L4 Manager triggers
  {
    name: 'Deal Stalled >7 Days → Call Task',
    eventPattern: 'deal.updated',
    condition: { 'payload.daysInStage': { op: 'gte', value: 7 } },
    objective: 'Create a follow-up call task for stalled deals to re-engage the prospect',
    autoExecute: true,
    maxRiskTier: 2,
  },
  {
    name: 'No Social Posts >14 Days → Content Request',
    eventPattern: 'content_calendar.gap_detected',
    condition: { 'payload.daysSinceLastPost': { op: 'gte', value: 14 } },
    objective: 'Auto-create a content request for social media engagement to fill the gap',
    autoExecute: true,
    maxRiskTier: 2,
  },
  {
    name: 'New Product → Launch Content Request',
    eventPattern: 'product.created',
    objective: 'Create a content request for product launch materials (social, email, storefront copy)',
    autoExecute: true,
    maxRiskTier: 2,
  },
  {
    name: 'Content Approved → Upload to Drive',
    eventPattern: 'content_request.approved',
    objective: 'Create Drive folder for deliverables and notify assigned team to upload files',
    autoExecute: true,
    maxRiskTier: 2,
  },
  {
    name: 'Call Outcome: Callback Requested → Follow-up Task',
    eventPattern: 'call_log.completed',
    condition: { 'payload.outcome': { op: 'eq', value: 'callback_requested' } },
    objective: 'Schedule a follow-up call task for the requested callback time',
    autoExecute: true,
    maxRiskTier: 1,
  },
  {
    name: 'Team Member Overloaded → Rebalance Alert',
    eventPattern: 'manager.overload_detected',
    objective: 'Suggest task redistribution to underutilized team members with matching skills',
    autoExecute: false,
    maxRiskTier: 2,
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
          'content_create_request',
          'content_assign_request',
          'call_create_task',
          'call_log_outcome',
          'evidence_submit',
          'approval_create_request',
          'drive_create_folder',
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
