import { BusinessRole } from './role-engine.service';

export interface JourneyStep {
  role: BusinessRole;
  toolName: string;
  description: string;
  condition?: (payload: Record<string, any>, previousResults: Record<string, any>[]) => boolean;
  inputMapping: (payload: Record<string, any>, previousResults: Record<string, any>[]) => Record<string, any>;
  delayMinutes?: number;
}

export interface JourneyTemplate {
  key: string;
  name: string;
  description: string;
  triggerEvent: string;
  steps: JourneyStep[];
}

export const JOURNEY_TEMPLATES: JourneyTemplate[] = [
  {
    key: 'post-booking',
    name: 'Post-Booking Journey',
    description: 'After a booking is completed, create invoice, update CRM, schedule follow-up, and request review',
    triggerEvent: 'booking.completed',
    steps: [
      {
        role: 'finance',
        toolName: 'commerce_create_invoice',
        description: 'Create invoice from completed booking',
        inputMapping: (payload) => ({
          contactId: payload.contactId,
          items: [{ description: payload.serviceName ?? 'Service', amount: payload.amount ?? 0 }],
          dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          notes: `Invoice for booking ${payload.bookingId}`,
        }),
      },
      {
        role: 'sales',
        toolName: 'crm_update_contact',
        description: 'Update contact status to CLIENT after booking',
        inputMapping: (payload) => ({
          id: payload.contactId,
          status: 'CLIENT',
        }),
      },
      {
        role: 'sales',
        toolName: 'create_task',
        description: 'Schedule follow-up task 3 days after booking',
        delayMinutes: 3 * 24 * 60,
        inputMapping: (payload) => ({
          title: `Follow up with ${payload.contactName ?? 'client'} after service`,
          description: `Check satisfaction after booking ${payload.bookingId}`,
          dueDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
          contactId: payload.contactId,
        }),
      },
      {
        role: 'marketing',
        toolName: 'send_message_with_approval',
        description: 'Request review from customer',
        delayMinutes: 7 * 24 * 60,
        condition: (payload) => (payload.amount ?? 0) > 50,
        inputMapping: (payload) => ({
          contactId: payload.contactId,
          channel: 'email',
          subject: 'How was your experience?',
          body: `Hi ${payload.contactName ?? 'there'}, we hope you enjoyed your recent service with us. We'd love to hear your feedback — it helps us improve and helps others discover our business.`,
        }),
      },
    ],
  },
  {
    key: 'new-lead',
    name: 'New Lead Journey',
    description: 'When a new lead is created, qualify, add to sequence, create follow-up task, send welcome',
    triggerEvent: 'contact.created',
    steps: [
      {
        role: 'sales',
        toolName: 'tag_contact',
        description: 'Tag new lead as "New Lead"',
        condition: (payload) => payload.status === 'LEAD',
        inputMapping: (payload) => ({
          contactId: payload.contactId,
          tag: 'New Lead',
        }),
      },
      {
        role: 'sales',
        toolName: 'create_followup_queue',
        description: 'Create follow-up queue for new lead',
        condition: (payload) => payload.status === 'LEAD',
        inputMapping: (payload) => ({
          contactId: payload.contactId,
          steps: [
            { delayDays: 1, action: 'Send welcome email', channel: 'email' },
            { delayDays: 3, action: 'Check interest', channel: 'email' },
            { delayDays: 7, action: 'Offer consultation', channel: 'email' },
          ],
        }),
      },
      {
        role: 'sales',
        toolName: 'create_task',
        description: 'Create qualification task for sales team',
        condition: (payload) => payload.status === 'LEAD',
        inputMapping: (payload) => ({
          title: `Qualify lead: ${payload.contactName ?? 'New lead'}`,
          description: `Review lead details and determine next steps. Source: ${payload.source ?? 'unknown'}`,
          contactId: payload.contactId,
          dueDate: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000).toISOString(),
        }),
      },
    ],
  },
  {
    key: 'quote-accepted',
    name: 'Quote Accepted Journey',
    description: 'When a quote is accepted, convert to invoice, notify sales, update deal stage',
    triggerEvent: 'quote.accepted',
    steps: [
      {
        role: 'finance',
        toolName: 'commerce_create_invoice',
        description: 'Convert accepted quote to invoice',
        inputMapping: (payload) => ({
          contactId: payload.contactId,
          quoteId: payload.quoteId,
          notes: `Invoice from accepted quote ${payload.quoteId}`,
        }),
      },
      {
        role: 'sales',
        toolName: 'crm_add_note',
        description: 'Log quote acceptance in CRM',
        inputMapping: (payload) => ({
          contactId: payload.contactId,
          content: `Quote ${payload.quoteId} accepted on ${new Date().toISOString().split('T')[0]}`,
        }),
      },
    ],
  },
  {
    key: 'invoice-overdue',
    name: 'Invoice Overdue Journey',
    description: 'When an invoice becomes overdue, send reminder, create collection task, flag contact',
    triggerEvent: 'invoice.overdue',
    steps: [
      {
        role: 'finance',
        toolName: 'draft_payment_reminder',
        description: 'Draft payment reminder for overdue invoice',
        inputMapping: (payload) => ({
          contactId: payload.contactId,
          invoiceId: payload.invoiceId,
          amount: payload.amount,
          daysOverdue: payload.daysOverdue ?? 7,
        }),
      },
      {
        role: 'finance',
        toolName: 'send_message_with_approval',
        description: 'Send payment reminder',
        inputMapping: (payload, prev) => ({
          contactId: payload.contactId,
          channel: 'email',
          subject: `Payment Reminder — Invoice ${payload.invoiceNumber ?? payload.invoiceId}`,
          body: prev[0]?.draft ?? `Your invoice for ${payload.amount} is overdue. Please arrange payment at your earliest convenience.`,
        }),
      },
      {
        role: 'finance',
        toolName: 'create_task',
        description: 'Create collection follow-up task',
        inputMapping: (payload) => ({
          title: `Follow up on overdue invoice ${payload.invoiceNumber ?? payload.invoiceId}`,
          description: `Invoice amount: ${payload.amount}. Days overdue: ${payload.daysOverdue ?? 7}`,
          contactId: payload.contactId,
          dueDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
        }),
      },
      {
        role: 'sales',
        toolName: 'tag_contact',
        description: 'Flag contact as slow payer if >30 days overdue',
        condition: (payload) => (payload.daysOverdue ?? 0) > 30,
        inputMapping: (payload) => ({
          contactId: payload.contactId,
          tag: 'Slow Payer',
        }),
      },
    ],
  },
  {
    key: 'payment-received',
    name: 'Payment Received Journey',
    description: 'When payment is received, send receipt, update CRM, request review',
    triggerEvent: 'invoice.paid',
    steps: [
      {
        role: 'finance',
        toolName: 'send_message_with_approval',
        description: 'Send payment receipt',
        inputMapping: (payload) => ({
          contactId: payload.contactId,
          channel: 'email',
          subject: 'Payment Received — Thank You!',
          body: `Thank you for your payment of ${payload.amount} for invoice ${payload.invoiceNumber ?? payload.invoiceId}. We have received your payment and appreciate your business.`,
        }),
      },
      {
        role: 'sales',
        toolName: 'crm_add_note',
        description: 'Log payment in CRM',
        inputMapping: (payload) => ({
          contactId: payload.contactId,
          content: `Payment received: ${payload.amount} for invoice ${payload.invoiceNumber ?? payload.invoiceId}`,
        }),
      },
    ],
  },
  {
    key: 'booking-no-show',
    name: 'No-Show Journey',
    description: 'When a booking is missed, send rebooking message, create recovery task, offer discount',
    triggerEvent: 'booking.no_show',
    steps: [
      {
        role: 'support',
        toolName: 'send_message_with_approval',
        description: 'Send rebooking offer to no-show customer',
        inputMapping: (payload) => ({
          contactId: payload.contactId,
          channel: payload.channel ?? 'email',
          subject: 'We missed you — reschedule?',
          body: `We noticed you missed your appointment today. No worries — things happen! Would you like to reschedule? Reply to this message and we'll find a new time that works for you.`,
        }),
      },
      {
        role: 'sales',
        toolName: 'create_task',
        description: 'Create recovery task for no-show',
        inputMapping: (payload) => ({
          title: `Rebook no-show: ${payload.contactName ?? 'Customer'}`,
          description: `Booking ${payload.bookingId} was missed. Follow up to reschedule.`,
          contactId: payload.contactId,
          dueDate: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000).toISOString(),
        }),
      },
      {
        role: 'sales',
        toolName: 'tag_contact',
        description: 'Tag as no-show for tracking',
        inputMapping: (payload) => ({
          contactId: payload.contactId,
          tag: 'No-Show',
        }),
      },
    ],
  },
  {
    key: 'new-order',
    name: 'New Order Journey',
    description: 'When a new store order is placed, confirm, update inventory, create fulfillment task',
    triggerEvent: 'store_order.created',
    steps: [
      {
        role: 'support',
        toolName: 'send_message_with_approval',
        description: 'Send order confirmation to customer',
        inputMapping: (payload) => ({
          contactId: payload.contactId,
          channel: 'email',
          subject: `Order Confirmation — ${payload.orderNumber ?? 'New Order'}`,
          body: `Thank you for your order! We've received it and are preparing it for fulfillment. Order total: ${payload.total}. We'll notify you when it ships.`,
        }),
      },
      {
        role: 'operations',
        toolName: 'create_task',
        description: 'Create fulfillment task',
        inputMapping: (payload) => ({
          title: `Fulfill order ${payload.orderNumber ?? payload.orderId}`,
          description: `Pack and ship order. Items: ${payload.itemCount ?? 'N/A'}. Total: ${payload.total}`,
          dueDate: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000).toISOString(),
        }),
      },
    ],
  },
  {
    key: 'stale-quote',
    name: 'Stale Quote Journey',
    description: 'When a quote goes stale, send follow-up, create task, update deal stage',
    triggerEvent: 'quote.stale',
    steps: [
      {
        role: 'sales',
        toolName: 'draft_followup_message',
        description: 'Draft follow-up for stale quote',
        inputMapping: (payload) => ({
          contactId: payload.contactId,
          context: `Quote ${payload.quoteId} has been pending for ${payload.daysStale ?? 7} days`,
        }),
      },
      {
        role: 'sales',
        toolName: 'send_message_with_approval',
        description: 'Send follow-up message',
        inputMapping: (payload, prev) => ({
          contactId: payload.contactId,
          channel: 'email',
          subject: 'Following up on your quote',
          body: prev[0]?.draft ?? `Just checking in on the quote we sent you. Let us know if you have any questions!`,
        }),
      },
      {
        role: 'sales',
        toolName: 'create_task',
        description: 'Create follow-up task for stale quote',
        inputMapping: (payload) => ({
          title: `Follow up on stale quote ${payload.quoteId}`,
          description: `Quote has been stale for ${payload.daysStale ?? 7} days. Value: ${payload.amount ?? 'N/A'}`,
          contactId: payload.contactId,
          dueDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
        }),
      },
    ],
  },
  {
    key: 'new-booking',
    name: 'New Booking Journey',
    description: 'When a new booking is created, send confirmation, check for upsell',
    triggerEvent: 'booking.created',
    steps: [
      {
        role: 'operations',
        toolName: 'send_message_with_approval',
        description: 'Send booking confirmation',
        inputMapping: (payload) => ({
          contactId: payload.contactId,
          channel: payload.channel ?? 'email',
          subject: 'Booking Confirmed',
          body: `Your booking for ${payload.serviceName ?? 'our service'} on ${payload.date ?? 'the scheduled date'} has been confirmed. We look forward to seeing you!`,
        }),
      },
      {
        role: 'sales',
        toolName: 'crm_add_note',
        description: 'Log booking in CRM',
        inputMapping: (payload) => ({
          contactId: payload.contactId,
          content: `Booking created: ${payload.serviceName ?? 'Service'} on ${payload.date ?? 'N/A'}`,
        }),
      },
    ],
  },
  {
    key: 'weekly-hygiene',
    name: 'Weekly Hygiene Journey',
    description: 'Weekly scan for overdue tasks, stale quotes, low inventory, calendar gaps',
    triggerEvent: 'cron.weekly_hygiene',
    steps: [
      {
        role: 'finance',
        toolName: 'fetch_revenue_risk',
        description: 'Check revenue risk indicators',
        inputMapping: () => ({}),
      },
      {
        role: 'operations',
        toolName: 'fetch_schedule_health',
        description: 'Check calendar utilization',
        inputMapping: () => ({}),
      },
      {
        role: 'sales',
        toolName: 'fetch_project_status',
        description: 'Check project health',
        inputMapping: () => ({}),
      },
      {
        role: 'marketing',
        toolName: 'generate_content_brief',
        description: 'Generate weekly content brief',
        condition: (_payload, prev) => {
          const scheduleHealth = prev.find((r) => r.toolName === 'fetch_schedule_health');
          return !scheduleHealth || scheduleHealth.result?.utilization < 70;
        },
        inputMapping: () => ({
          topic: 'Weekly business update and promotions',
          targetAudience: 'existing customers',
        }),
      },
    ],
  },
];

export function getJourneyTemplate(key: string): JourneyTemplate | undefined {
  return JOURNEY_TEMPLATES.find((t) => t.key === key);
}

export function getTemplatesForEvent(eventName: string): JourneyTemplate[] {
  return JOURNEY_TEMPLATES.filter((t) => t.triggerEvent === eventName);
}
