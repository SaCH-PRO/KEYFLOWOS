/**
 * KEY Universal Connector Service
 * --------------------------------
 * The single integration backbone that routes AI-generated commands to every
 * KeyFlowOS module.  Maintains a hard-coded registry of 18 modules, 140+
 * actions and 80+ queries.  Zero stubs — every action calls a real injected
 * NestJS service with correctly typed parameters.
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  ModuleName,
  ModuleCapability,
  ConnectorCommand,
  ConnectorResult,
  FullBusinessContext,
  ModuleContextSlice,
} from './key-cortex-connector.types';

// ── KeyFlowOS module services (13 injected adapters) ──────────────────────────
import { CrmService } from '../crm/crm.service';
import { CommerceService } from '../commerce/commerce.service';
import { BookingsService } from '../bookings/bookings.service';
import { ContentService } from '../content/content.service';
import { CommunicationsService } from '../communications/communications.service';
import { FlowService } from '../flow/flow.service';
import { AutopilotService } from '../autopilot/autopilot.service';
import { TemporalFlowMemoryService } from '../temporal-flow/temporal-flow-memory.service';
import { KeyInboxService } from '../key-inbox/key-inbox.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ProjectsService } from '../projects/projects.service';
import { ActivityService } from '../activity/activity.service';
import { KeystoreService } from '../keystore/keystore.service';
import { KeyCortexKeystoreAdapterService } from './key-cortex-keystore-adapter.service';

@Injectable()
export class KeyCortexConnectorService {
  private readonly logger = new Logger(KeyCortexConnectorService.name);

  // ═══════════════════════════════════════════════════════════════════════════
  //  CONSTRUCTOR — Inject all 12 KeyFlowOS module services
  // ═══════════════════════════════════════════════════════════════════════════

  constructor(
    private readonly crm: CrmService,
    private readonly commerce: CommerceService,
    private readonly bookings: BookingsService,
    private readonly content: ContentService,
    private readonly communications: CommunicationsService,
    private readonly flow: FlowService,
    private readonly autopilot: AutopilotService,
    private readonly temporal: TemporalFlowMemoryService,
    private readonly inbox: KeyInboxService,
    private readonly notifications: NotificationsService,
    private readonly projects: ProjectsService,
    private readonly activity: ActivityService,
    private readonly keystore: KeystoreService,
    private readonly keystoreAdapter: KeyCortexKeystoreAdapterService,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════════
  //  1. CAPABILITY REGISTRY — 18 modules × (5-12 actions + 3-5 queries)
  // ═══════════════════════════════════════════════════════════════════════════

  private readonly MODULE_CAPABILITIES: ModuleCapability[] = [
    // ── 1. CRM ──────────────────────────────────────────────────────────────
    {
      module: 'crm',
      description: 'Contact relationship management — contacts, leads, tasks, notes, tags, timeline.',
      actions: [
        {
          name: 'create_contact',
          description: 'Create a new contact (lead, prospect, or customer).',
          parameters: [
            { name: 'firstName', type: 'string', description: 'First name', required: true },
            { name: 'lastName', type: 'string', description: 'Last name', required: false },
            { name: 'email', type: 'string', description: 'Email address', required: false },
            { name: 'phone', type: 'string', description: 'Phone number', required: false },
            { name: 'company', type: 'string', description: 'Company name', required: false },
            { name: 'tags', type: 'array', description: 'Tags to attach', required: false },
            { name: 'status', type: 'enum', description: 'Contact status', enumValues: ['lead', 'prospect', 'customer', 'churned', 'partner'], required: false, default: 'lead' },
          ],
          requiresApproval: false,
          examples: ['Add a new lead named John Smith', 'Create contact for john@acme.com', 'Add customer Jane Doe from Acme Inc'],
        },
        {
          name: 'get_contact',
          description: 'Retrieve full details of a single contact by ID.',
          parameters: [
            { name: 'contactId', type: 'id', description: 'UUID of the contact', required: true },
          ],
          requiresApproval: false,
          examples: ['Show me contact #abc123', 'Get details for contact abc-123', 'What do we know about John Smith?'],
        },
        {
          name: 'update_contact',
          description: 'Update fields on an existing contact.',
          parameters: [
            { name: 'contactId', type: 'id', description: 'UUID of the contact', required: true },
            { name: 'firstName', type: 'string', description: 'New first name', required: false },
            { name: 'lastName', type: 'string', description: 'New last name', required: false },
            { name: 'email', type: 'string', description: 'New email', required: false },
            { name: 'phone', type: 'string', description: 'New phone', required: false },
            { name: 'status', type: 'enum', description: 'Updated status', enumValues: ['lead', 'prospect', 'customer', 'churned', 'partner'], required: false },
            { name: 'tags', type: 'array', description: 'Replace tags', required: false },
          ],
          requiresApproval: false,
          examples: ['Update contact abc123 phone to 555-0199', 'Change John Smith status to customer'],
        },
        {
          name: 'delete_contact',
          description: 'Permanently delete a contact and associated data.',
          parameters: [
            { name: 'contactId', type: 'id', description: 'UUID of the contact', required: true },
          ],
          requiresApproval: true,
          examples: ['Delete contact abc123', 'Remove John Smith from CRM'],
        },
        {
          name: 'list_contacts',
          description: 'List contacts with optional filtering.',
          parameters: [
            { name: 'status', type: 'enum', description: 'Filter by status', enumValues: ['lead', 'prospect', 'customer', 'churned', 'partner'], required: false },
            { name: 'tag', type: 'string', description: 'Filter by tag', required: false },
            { name: 'search', type: 'string', description: 'Full-text search query', required: false },
            { name: 'limit', type: 'number', description: 'Page size', required: false, default: 50 },
            { name: 'offset', type: 'number', description: 'Page offset', required: false, default: 0 },
          ],
          requiresApproval: false,
          examples: ['List all customers', 'Show me leads tagged VIP', 'Search contacts named John'],
        },
        {
          name: 'add_task',
          description: 'Add a task to a contact record.',
          parameters: [
            { name: 'contactId', type: 'id', description: 'UUID of the contact', required: true },
            { name: 'title', type: 'string', description: 'Task description', required: true },
            { name: 'priority', type: 'enum', description: 'Priority level', enumValues: ['low', 'medium', 'high', 'urgent'], required: false, default: 'medium' },
            { name: 'dueDate', type: 'date', description: 'ISO due date', required: false },
            { name: 'assignedTo', type: 'id', description: 'User ID to assign', required: false },
          ],
          requiresApproval: false,
          examples: ['Add task "Follow up" to contact abc123', 'Remind me to call John tomorrow'],
        },
        {
          name: 'complete_task',
          description: 'Mark a task as completed.',
          parameters: [
            { name: 'taskId', type: 'id', description: 'UUID of the task', required: true },
            { name: 'contactId', type: 'id', description: 'UUID of the contact', required: true },
            { name: 'notes', type: 'string', description: 'Completion notes', required: false },
          ],
          requiresApproval: false,
          examples: ['Mark task xyz as done', 'Complete the follow-up task for John'],
        },
        {
          name: 'add_note',
          description: 'Append a note to a contact timeline.',
          parameters: [
            { name: 'contactId', type: 'id', description: 'UUID of the contact', required: true },
            { name: 'body', type: 'string', description: 'Note text', required: true },
            { name: 'type', type: 'enum', description: 'Note category', enumValues: ['general', 'call', 'meeting', 'email', 'sms'], required: false, default: 'general' },
          ],
          requiresApproval: false,
          examples: ['Add note to contact abc123: Had a great call', 'Log that John is interested'],
        },
        {
          name: 'add_tag',
          description: 'Attach one or more tags to a contact.',
          parameters: [
            { name: 'contactId', type: 'id', description: 'UUID of the contact', required: true },
            { name: 'tags', type: 'array', description: 'Tag strings', required: true },
          ],
          requiresApproval: false,
          examples: ['Tag contact abc123 as VIP', 'Add hot-lead tag to John'],
        },
        {
          name: 'update_status',
          description: 'Change the pipeline status of a contact.',
          parameters: [
            { name: 'contactId', type: 'id', description: 'UUID of the contact', required: true },
            { name: 'status', type: 'enum', description: 'New status', enumValues: ['lead', 'prospect', 'customer', 'churned', 'partner'], required: true },
            { name: 'reason', type: 'string', description: 'Reason for change', required: false },
          ],
          requiresApproval: false,
          examples: ['Move John Smith to customer', 'Mark abc123 as churned — no response'],
        },
        {
          name: 'schedule_follow_up',
          description: 'Schedule a follow-up activity for a contact.',
          parameters: [
            { name: 'contactId', type: 'id', description: 'UUID of the contact', required: true },
            { name: 'date', type: 'date', description: 'Follow-up date (ISO 8601)', required: true },
            { name: 'type', type: 'enum', description: 'Activity type', enumValues: ['call', 'email', 'meeting', 'sms'], required: false, default: 'call' },
            { name: 'notes', type: 'string', description: 'Context / script', required: false },
          ],
          requiresApproval: false,
          examples: ['Schedule a follow-up call with John for next Tuesday', 'Remind me to email Sarah on Friday'],
        },
        {
          name: 'merge_contacts',
          description: 'Merge two duplicate contacts into one.',
          parameters: [
            { name: 'sourceId', type: 'id', description: 'UUID to merge from', required: true },
            { name: 'targetId', type: 'id', description: 'UUID to keep', required: true },
          ],
          requiresApproval: true,
          examples: ['Merge contact dup-456 into abc123'],
        },
      ],
      queries: [
        {
          name: 'get_contact',
          description: 'Full details, timeline, and tasks for one contact.',
          parameters: [
            { name: 'contactId', type: 'id', description: 'UUID of the contact', required: true },
          ],
          returns: 'Contact with timeline',
          examples: ['Show contact abc123', 'Tell me about John Smith'],
        },
        {
          name: 'list_contacts',
          description: 'Paginated contact list with optional filters.',
          parameters: [
            { name: 'status', type: 'enum', description: 'Filter by status', enumValues: ['lead', 'prospect', 'customer', 'churned', 'partner'], required: false },
            { name: 'tag', type: 'string', description: 'Filter by tag', required: false },
            { name: 'search', type: 'string', description: 'Full-text search', required: false },
            { name: 'limit', type: 'number', description: 'Page size', required: false, default: 50 },
            { name: 'offset', type: 'number', description: 'Page offset', required: false, default: 0 },
          ],
          returns: 'Contact[]',
          examples: ['List all leads', 'Show VIP contacts'],
        },
        {
          name: 'get_pipeline_summary',
          description: 'Get a breakdown of contacts by pipeline stage.',
          parameters: [
            { name: 'status', type: 'enum', description: 'Focus stage', enumValues: ['lead', 'prospect', 'customer', 'churned', 'partner'], required: false },
          ],
          returns: 'PipelineSummary',
          examples: ['How many leads do we have?', 'Show the pipeline breakdown'],
        },
        {
          name: 'get_activity_timeline',
          description: 'Fetch recent activity (notes, tasks, status changes) for a contact.',
          parameters: [
            { name: 'contactId', type: 'id', description: 'UUID of the contact', required: true },
            { name: 'limit', type: 'number', description: 'Max entries', required: false, default: 20 },
          ],
          returns: 'TimelineEntry[]',
          examples: ['What happened with contact abc123?', 'Show recent activity for John'],
        },
        {
          name: 'get_task_overview',
          description: 'Count and list open, overdue, and completed tasks for a contact.',
          parameters: [
            { name: 'contactId', type: 'id', description: 'UUID of the contact', required: true },
          ],
          returns: 'TaskOverview',
          examples: ['What tasks are open for John?', 'Show task overview for abc123'],
        },
      ],
    },
    // ── 2. COMMERCE ─────────────────────────────────────────────────────────
    {
      module: 'commerce',
      description: 'Invoicing, quotes, payment links, product catalog, subscriptions, revenue tracking.',
      actions: [
        {
          name: 'create_invoice',
          description: 'Create and send an invoice to a client.',
          parameters: [
            { name: 'clientId', type: 'id', description: 'Client contact UUID', required: true },
            { name: 'items', type: 'array', description: 'Line items [{name, quantity, unitPrice, description?}]', required: true },
            { name: 'dueDate', type: 'date', description: 'Due date (ISO 8601, default +30d)', required: false },
            { name: 'notes', type: 'string', description: 'Invoice notes / terms', required: false },
            { name: 'currency', type: 'string', description: 'Currency code (default USD)', required: false },
            { name: 'sendEmail', type: 'boolean', description: 'Send via email immediately', required: false },
          ],
          requiresApproval: false,
          examples: ['Create invoice for Acme Corp — Consulting $2,000 + Design $1,500, due 2024-02-01', 'Invoice Sarah for the logo design'],
        },
        {
          name: 'create_quote',
          description: 'Create a quote / estimate for a client.',
          parameters: [
            { name: 'clientId', type: 'id', description: 'Client contact UUID', required: true },
            { name: 'items', type: 'array', description: 'Line items', required: true },
            { name: 'validUntil', type: 'date', description: 'Quote expiry date', required: false },
            { name: 'notes', type: 'string', description: 'Quote notes / terms', required: false },
          ],
          requiresApproval: false,
          examples: ['Create quote for John — Website $5,000 valid until Dec 31'],
        },
        {
          name: 'convert_quote_to_invoice',
          description: 'Convert an approved quote into an invoice.',
          parameters: [
            { name: 'quoteId', type: 'id', description: 'UUID of the quote', required: true },
          ],
          requiresApproval: false,
          examples: ['Convert quote QT-001 to invoice'],
        },
        {
          name: 'record_payment',
          description: 'Record a payment received against an invoice.',
          parameters: [
            { name: 'invoiceId', type: 'id', description: 'UUID of the invoice', required: true },
            { name: 'amount', type: 'number', description: 'Payment amount', required: true },
            { name: 'method', type: 'enum', description: 'Payment method', enumValues: ['bank_transfer', 'credit_card', 'cash', 'check', 'other'], required: false },
            { name: 'date', type: 'date', description: 'Payment date (ISO 8601)', required: false },
            { name: 'reference', type: 'string', description: 'Transaction reference / note', required: false },
          ],
          requiresApproval: false,
          examples: ['Record $1,000 payment on invoice INV-001 via bank transfer'],
        },
        {
          name: 'create_product',
          description: 'Add a new product or service to the catalog.',
          parameters: [
            { name: 'name', type: 'string', description: 'Product name', required: true },
            { name: 'price', type: 'number', description: 'Unit price', required: true },
            { name: 'description', type: 'string', description: 'Product description', required: false },
            { name: 'category', type: 'string', description: 'Category', required: false },
            { name: 'sku', type: 'string', description: 'SKU code', required: false },
            { name: 'taxable', type: 'boolean', description: 'Whether product is taxable', required: false },
          ],
          requiresApproval: false,
          examples: ['Add product "Premium Logo Design" at $2,500'],
        },
        {
          name: 'send_payment_reminder',
          description: 'Send a payment reminder email for an invoice.',
          parameters: [
            { name: 'invoiceId', type: 'id', description: 'UUID of the invoice', required: true },
            { name: 'message', type: 'string', description: 'Custom reminder message', required: false },
          ],
          requiresApproval: false,
          examples: ['Send payment reminder for invoice INV-001'],
        },
        {
          name: 'create_subscription',
          description: 'Create a recurring subscription for a client.',
          parameters: [
            { name: 'clientId', type: 'id', description: 'Client contact UUID', required: true },
            { name: 'productId', type: 'id', description: 'Product UUID', required: true },
            { name: 'frequency', type: 'enum', description: 'Billing frequency', enumValues: ['weekly', 'monthly', 'quarterly', 'yearly'], required: true },
            { name: 'startDate', type: 'date', description: 'Start date (ISO 8601)', required: false },
            { name: 'endDate', type: 'date', description: 'End date (optional)', required: false },
          ],
          requiresApproval: false,
          examples: ['Create monthly subscription for John on Premium Plan starting next month'],
        },
        {
          name: 'refund_payment',
          description: 'Process a refund for a recorded payment.',
          parameters: [
            { name: 'paymentId', type: 'id', description: 'UUID of the payment', required: true },
            { name: 'amount', type: 'number', description: 'Refund amount (partial or full)', required: true },
            { name: 'reason', type: 'string', description: 'Reason for refund', required: false },
          ],
          requiresApproval: true,
          examples: ['Refund $500 from payment PAY-001 — client unhappy'],
        },
        {
          name: 'cancel_subscription',
          description: 'Cancel an active subscription.',
          parameters: [
            { name: 'subscriptionId', type: 'id', description: 'UUID of the subscription', required: true },
            { name: 'reason', type: 'string', description: 'Cancellation reason', required: false },
            { name: 'immediate', type: 'boolean', description: 'Cancel immediately vs end of period', required: false },
          ],
          requiresApproval: false,
          examples: ['Cancel subscription SUB-001 at end of period'],
        },
      ],
      queries: [
        {
          name: 'get_invoice',
          description: 'Full invoice details with line items and payment history.',
          parameters: [
            { name: 'invoiceId', type: 'id', description: 'UUID of the invoice', required: true },
          ],
          returns: 'Invoice with payments',
          examples: ['Show invoice INV-001'],
        },
        {
          name: 'list_invoices',
          description: 'Paginated invoice list with optional filters.',
          parameters: [
            { name: 'clientId', type: 'id', description: 'Filter by client', required: false },
            { name: 'status', type: 'enum', description: 'Invoice status', enumValues: ['draft', 'sent', 'paid', 'overdue', 'cancelled'], required: false },
            { name: 'dateFrom', type: 'date', description: 'Start date', required: false },
            { name: 'dateTo', type: 'date', description: 'End date', required: false },
            { name: 'limit', type: 'number', description: 'Page size', required: false, default: 50 },
            { name: 'offset', type: 'number', description: 'Page offset', required: false, default: 0 },
          ],
          returns: 'Invoice[]',
          examples: ['List all overdue invoices', 'Show invoices for client abc123'],
        },
        {
          name: 'get_revenue_summary',
          description: 'Aggregated revenue totals grouped by period.',
          parameters: [
            { name: 'period', type: 'enum', description: 'Grouping', enumValues: ['day', 'week', 'month', 'quarter', 'year'], required: false, default: 'month' },
            { name: 'dateFrom', type: 'date', description: 'Start date', required: false },
            { name: 'dateTo', type: 'date', description: 'End date', required: false },
          ],
          returns: 'RevenueSummary',
          examples: ['Show revenue this month', 'Get quarterly revenue breakdown'],
        },
        {
          name: 'get_aging_report',
          description: 'Invoice aging report showing overdue buckets.',
          parameters: [
            { name: 'asOfDate', type: 'date', description: 'Report date', required: false },
          ],
          returns: 'AgingReport',
          examples: ['Show aging report', 'How much is overdue?'],
        },
        {
          name: 'list_products',
          description: 'Paginated product catalog.',
          parameters: [
            { name: 'category', type: 'string', description: 'Filter by category', required: false },
            { name: 'search', type: 'string', description: 'Search by name', required: false },
            { name: 'limit', type: 'number', description: 'Page size', required: false, default: 50 },
            { name: 'offset', type: 'number', description: 'Page offset', required: false, default: 0 },
          ],
          returns: 'Product[]',
          examples: ['List all products', 'Show design services'],
        },
        {
          name: 'list_subscriptions',
          description: 'List all subscriptions with optional filters.',
          parameters: [
            { name: 'clientId', type: 'id', description: 'Filter by client', required: false },
            { name: 'status', type: 'enum', description: 'Subscription status', enumValues: ['active', 'paused', 'cancelled', 'expired'], required: false },
            { name: 'limit', type: 'number', description: 'Page size', required: false, default: 50 },
            { name: 'offset', type: 'number', description: 'Page offset', required: false, default: 0 },
          ],
          returns: 'Subscription[]',
          examples: ['List active subscriptions', 'Show subscriptions for John'],
        },
      ],
    },
    // ── 3. BOOKINGS ─────────────────────────────────────────────────────────
    {
      module: 'bookings',
      description: 'Appointment scheduling, availability management, calendar sync, buffer times.',
      actions: [
        {
          name: 'create_booking',
          description: 'Create a new appointment / booking.',
          parameters: [
            { name: 'clientId', type: 'id', description: 'Client contact UUID', required: true },
            { name: 'title', type: 'string', description: 'Booking title', required: true },
            { name: 'startTime', type: 'datetime', description: 'Start (ISO 8601)', required: true },
            { name: 'endTime', type: 'datetime', description: 'End (ISO 8601)', required: true },
            { name: 'location', type: 'string', description: 'Physical address or video link', required: false },
            { name: 'notes', type: 'string', description: 'Booking notes', required: false },
            { name: 'staffId', type: 'id', description: 'Assigned staff UUID', required: false },
            { name: 'sendConfirmation', type: 'boolean', description: 'Send confirmation email', required: false },
          ],
          requiresApproval: false,
          examples: ['Book a 1-hour strategy call with Sarah for tomorrow 2 PM', 'Schedule onboarding for John next Monday 10 AM'],
        },
        {
          name: 'cancel_booking',
          description: 'Cancel an existing booking and optionally notify the client.',
          parameters: [
            { name: 'bookingId', type: 'id', description: 'UUID of the booking', required: true },
            { name: 'reason', type: 'string', description: 'Cancellation reason', required: false },
            { name: 'notifyClient', type: 'boolean', description: 'Send cancellation notification', required: false },
          ],
          requiresApproval: false,
          examples: ['Cancel booking BK-001 and notify the client'],
        },
        {
          name: 'reschedule_booking',
          description: 'Reschedule an existing booking to a new time.',
          parameters: [
            { name: 'bookingId', type: 'id', description: 'UUID of the booking', required: true },
            { name: 'newStartTime', type: 'datetime', description: 'New start (ISO 8601)', required: true },
            { name: 'newEndTime', type: 'datetime', description: 'New end (ISO 8601)', required: true },
            { name: 'notifyClient', type: 'boolean', description: 'Send reschedule notification', required: false },
          ],
          requiresApproval: false,
          examples: ['Reschedule booking BK-001 to Wednesday 3 PM'],
        },
        {
          name: 'check_availability',
          description: 'Check available time slots for a given date range.',
          parameters: [
            { name: 'date', type: 'date', description: 'Date to check', required: true },
            { name: 'durationMinutes', type: 'number', description: 'Required slot length in minutes', required: true },
            { name: 'staffId', type: 'id', description: 'Specific staff member', required: false },
          ],
          requiresApproval: false,
          examples: ['Check availability for 30-minute slots next Tuesday'],
        },
        {
          name: 'block_time',
          description: 'Block out time on the calendar.',
          parameters: [
            { name: 'startTime', type: 'datetime', description: 'Start (ISO 8601)', required: true },
            { name: 'endTime', type: 'datetime', description: 'End (ISO 8601)', required: true },
            { name: 'reason', type: 'string', description: 'Block reason', required: false },
            { name: 'staffId', type: 'id', description: 'Staff member UUID', required: false },
          ],
          requiresApproval: false,
          examples: ['Block Friday afternoon for deep work'],
        },
        {
          name: 'set_availability',
          description: 'Define recurring weekly availability for a staff member.',
          parameters: [
            { name: 'staffId', type: 'id', description: 'Staff member UUID', required: true },
            { name: 'dayOfWeek', type: 'enum', description: 'Day of week', enumValues: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'], required: true },
            { name: 'startTime', type: 'string', description: 'Start time (HH:MM)', required: true },
            { name: 'endTime', type: 'string', description: 'End time (HH:MM)', required: true },
            { name: 'timezone', type: 'string', description: 'Timezone', required: false },
          ],
          requiresApproval: false,
          examples: ['Set availability for staff-001 Mon-Fri 9 AM-5 PM EST'],
        },
        {
          name: 'create_booking_link',
          description: 'Generate a public booking link for a service.',
          parameters: [
            { name: 'serviceName', type: 'string', description: 'Service being offered', required: true },
            { name: 'durationMinutes', type: 'number', description: 'Slot length', required: true },
            { name: 'staffId', type: 'id', description: 'Staff UUID (optional — round-robin if omitted)', required: false },
            { name: 'bufferMinutes', type: 'number', description: 'Buffer between bookings', required: false, default: 0 },
          ],
          requiresApproval: false,
          examples: ['Create booking link for "30-min Consultation"'],
        },
        {
          name: 'sync_calendar',
          description: 'Sync bookings with an external calendar (Google, Outlook).',
          parameters: [
            { name: 'provider', type: 'enum', description: 'Calendar provider', enumValues: ['google', 'outlook', 'apple'], required: true },
            { name: 'calendarId', type: 'string', description: 'Calendar identifier', required: true },
            { name: 'direction', type: 'enum', description: 'Sync direction', enumValues: ['import', 'export', 'bidirectional'], required: false, default: 'bidirectional' },
          ],
          requiresApproval: false,
          examples: ['Sync with Google Calendar primary'],
        },
      ],
      queries: [
        {
          name: 'get_booking',
          description: 'Full booking details.',
          parameters: [
            { name: 'bookingId', type: 'id', description: 'UUID of the booking', required: true },
          ],
          returns: 'Booking',
          examples: ['Show booking BK-001'],
        },
        {
          name: 'list_bookings',
          description: 'Paginated booking list with optional date/status filters.',
          parameters: [
            { name: 'clientId', type: 'id', description: 'Filter by client', required: false },
            { name: 'status', type: 'enum', description: 'Booking status', enumValues: ['confirmed', 'pending', 'cancelled', 'completed', 'no_show'], required: false },
            { name: 'dateFrom', type: 'date', description: 'Start date', required: false },
            { name: 'dateTo', type: 'date', description: 'End date', required: false },
            { name: 'limit', type: 'number', description: 'Page size', required: false, default: 50 },
            { name: 'offset', type: 'number', description: 'Page offset', required: false, default: 0 },
          ],
          returns: 'Booking[]',
          examples: ['List bookings for next week', 'Show cancelled bookings'],
        },
        {
          name: 'get_availability',
          description: 'Get available slots for a specific date and duration.',
          parameters: [
            { name: 'date', type: 'date', description: 'Date to check', required: true },
            { name: 'durationMinutes', type: 'number', description: 'Slot length', required: true },
            { name: 'staffId', type: 'id', description: 'Specific staff', required: false },
          ],
          returns: 'TimeSlot[]',
          examples: ['What slots are free next Tuesday?', 'Show 1-hour slots for Dr. Smith'],
        },
        {
          name: 'get_upcoming_bookings',
          description: 'Get bookings scheduled within the next N days.',
          parameters: [
            { name: 'days', type: 'number', description: 'Look-ahead window', required: false, default: 7 },
          ],
          returns: 'Booking[]',
          examples: ['What appointments are coming up?', 'Show bookings for the next 3 days'],
        },
        {
          name: 'get_booking_stats',
          description: 'Booking statistics for a date range.',
          parameters: [
            { name: 'dateFrom', type: 'date', description: 'Start date', required: false },
            { name: 'dateTo', type: 'date', description: 'End date', required: false },
          ],
          returns: 'BookingStats',
          examples: ['Show booking stats for January', 'How many bookings this month?'],
        },
      ],
    },
    // ── 4. CONTENT ──────────────────────────────────────────────────────────
    {
      module: 'content',
      description: 'Blog posts, landing pages, social media, email campaigns, SEO tools.',
      actions: [
        {
          name: 'create_blog_post',
          description: 'Create a new blog post / article.',
          parameters: [
            { name: 'title', type: 'string', description: 'Post title', required: true },
            { name: 'content', type: 'string', description: 'Body (markdown / HTML)', required: true },
            { name: 'excerpt', type: 'string', description: 'Short summary', required: false },
            { name: 'tags', type: 'array', description: 'Tags / categories', required: false },
            { name: 'status', type: 'enum', description: 'Publication status', enumValues: ['draft', 'published', 'scheduled'], required: false, default: 'draft' },
            { name: 'publishAt', type: 'datetime', description: 'Schedule date (ISO 8601)', required: false },
            { name: 'seoTitle', type: 'string', description: 'SEO title', required: false },
            { name: 'seoDescription', type: 'string', description: 'SEO meta description', required: false },
          ],
          requiresApproval: false,
          examples: ['Create blog post "10 Ways to Automate Your Business"'],
        },
        {
          name: 'create_landing_page',
          description: 'Create a landing page.',
          parameters: [
            { name: 'title', type: 'string', description: 'Page title', required: true },
            { name: 'slug', type: 'string', description: 'URL slug', required: true },
            { name: 'sections', type: 'array', description: 'Page sections', required: true },
            { name: 'meta', type: 'object', description: 'SEO metadata', required: false },
          ],
          requiresApproval: false,
          examples: ['Create landing page for new product launch'],
        },
        {
          name: 'schedule_social_post',
          description: 'Schedule a social media post.',
          parameters: [
            { name: 'platform', type: 'enum', description: 'Social platform', enumValues: ['twitter', 'facebook', 'linkedin', 'instagram', 'tiktok'], required: true },
            { name: 'content', type: 'string', description: 'Post content', required: true },
            { name: 'scheduledAt', type: 'datetime', description: 'Schedule time (ISO 8601)', required: true },
            { name: 'mediaUrls', type: 'array', description: 'Attached media URLs', required: false },
          ],
          requiresApproval: false,
          examples: ['Schedule Twitter post: "Excited to announce our new feature!" for tomorrow 9 AM'],
        },
        {
          name: 'create_email_campaign',
          description: 'Create and send an email campaign to a contact list.',
          parameters: [
            { name: 'name', type: 'string', description: 'Campaign name', required: true },
            { name: 'subject', type: 'string', description: 'Email subject line', required: true },
            { name: 'body', type: 'string', description: 'Email body (HTML)', required: true },
            { name: 'recipientListId', type: 'id', description: 'Contact list UUID', required: true },
            { name: 'scheduledAt', type: 'datetime', description: 'Send time (ISO 8601)', required: false },
            { name: 'fromName', type: 'string', description: 'Sender name', required: false },
            { name: 'fromEmail', type: 'string', description: 'Sender email', required: false },
          ],
          requiresApproval: false,
          examples: ['Create email campaign "Summer Sale" to VIP list'],
        },
        {
          name: 'optimize_seo',
          description: 'Run SEO analysis and optimization on a piece of content.',
          parameters: [
            { name: 'contentId', type: 'id', description: 'UUID of the content', required: true },
            { name: 'targetKeywords', type: 'array', description: 'Keywords to optimize for', required: true },
          ],
          requiresApproval: false,
          examples: ['Optimize SEO for blog post targeting "workflow automation"'],
        },
        {
          name: 'publish_content',
          description: 'Publish a draft piece of content immediately.',
          parameters: [
            { name: 'contentId', type: 'id', description: 'UUID of the content', required: true },
          ],
          requiresApproval: false,
          examples: ['Publish blog post draft BP-001 now'],
        },
        {
          name: 'unpublish_content',
          description: 'Unpublish a live piece of content.',
          parameters: [
            { name: 'contentId', type: 'id', description: 'UUID of the content', required: true },
          ],
          requiresApproval: false,
          examples: ['Unpublish blog post BP-001'],
        },
        {
          name: 'create_content_template',
          description: 'Create a reusable content template.',
          parameters: [
            { name: 'name', type: 'string', description: 'Template name', required: true },
            { name: 'type', type: 'enum', description: 'Content type', enumValues: ['blog', 'social', 'email', 'landing'], required: true },
            { name: 'body', type: 'string', description: 'Template body with placeholders', required: true },
            { name: 'variables', type: 'array', description: 'Variable names used in template', required: false },
          ],
          requiresApproval: false,
          examples: ['Create email template "Welcome Series — Email 1"'],
        },
      ],
      queries: [
        {
          name: 'get_content',
          description: 'Full content details including SEO metadata.',
          parameters: [
            { name: 'contentId', type: 'id', description: 'UUID of the content', required: true },
          ],
          returns: 'Content with SEO',
          examples: ['Show blog post BP-001'],
        },
        {
          name: 'list_content',
          description: 'Paginated content list with optional type/status filters.',
          parameters: [
            { name: 'type', type: 'enum', description: 'Content type', enumValues: ['blog', 'social', 'email', 'landing'], required: false },
            { name: 'status', type: 'enum', description: 'Publication status', enumValues: ['draft', 'published', 'scheduled'], required: false },
            { name: 'tag', type: 'string', description: 'Filter by tag', required: false },
            { name: 'limit', type: 'number', description: 'Page size', required: false, default: 50 },
            { name: 'offset', type: 'number', description: 'Page offset', required: false, default: 0 },
          ],
          returns: 'Content[]',
          examples: ['List all published blog posts', 'Show scheduled social posts'],
        },
        {
          name: 'get_seo_score',
          description: 'SEO score and recommendations for a content piece.',
          parameters: [
            { name: 'contentId', type: 'id', description: 'UUID of the content', required: true },
          ],
          returns: 'SeoReport',
          examples: ['Get SEO score for BP-001'],
        },
        {
          name: 'get_content_analytics',
          description: 'Performance metrics for content (views, clicks, engagement).',
          parameters: [
            { name: 'contentId', type: 'id', description: 'UUID of the content', required: false },
            { name: 'dateFrom', type: 'date', description: 'Start date', required: false },
            { name: 'dateTo', type: 'date', description: 'End date', required: false },
          ],
          returns: 'ContentAnalytics',
          examples: ['How is blog post BP-001 performing?', 'Show content analytics for January'],
        },
        {
          name: 'get_social_schedule',
          description: 'Upcoming scheduled social posts.',
          parameters: [
            { name: 'platform', type: 'enum', description: 'Filter by platform', enumValues: ['twitter', 'facebook', 'linkedin', 'instagram', 'tiktok'], required: false },
            { name: 'limit', type: 'number', description: 'Max posts', required: false, default: 20 },
          ],
          returns: 'ScheduledPost[]',
          examples: ['What social posts are scheduled?', 'Show upcoming Twitter posts'],
        },
      ],
    },
    // ── 5. COMMUNICATIONS ───────────────────────────────────────────────────
    {
      module: 'communications',
      description: 'Email, SMS, WhatsApp, sequences, templates, deliverability analytics.',
      actions: [
        {
          name: 'send_email',
          description: 'Send a single email to one or more contacts.',
          parameters: [
            { name: 'to', type: 'array', description: 'Recipient contact UUIDs or email addresses', required: true },
            { name: 'subject', type: 'string', description: 'Email subject line', required: true },
            { name: 'body', type: 'string', description: 'Email body (HTML or markdown)', required: true },
            { name: 'fromName', type: 'string', description: 'Sender display name', required: false },
            { name: 'templateId', type: 'id', description: 'Use a saved template', required: false },
            { name: 'attachments', type: 'array', description: 'File attachments', required: false },
            { name: 'trackOpens', type: 'boolean', description: 'Enable open tracking', required: false },
            { name: 'trackClicks', type: 'boolean', description: 'Enable click tracking', required: false },
          ],
          requiresApproval: false,
          examples: ['Send email to john@example.com: Subject "Your invoice is ready"', 'Email Sarah the proposal'],
        },
        {
          name: 'send_sms',
          description: 'Send an SMS to a contact.',
          parameters: [
            { name: 'to', type: 'id', description: 'Contact UUID', required: true },
            { name: 'body', type: 'string', description: 'SMS text (max 1600 chars)', required: true },
          ],
          requiresApproval: false,
          examples: ['Send SMS to John: "Your appointment is confirmed for tomorrow 2 PM"'],
        },
        {
          name: 'send_whatsapp',
          description: 'Send a WhatsApp message to a contact.',
          parameters: [
            { name: 'to', type: 'id', description: 'Contact UUID', required: true },
            { name: 'body', type: 'string', description: 'Message text', required: true },
            { name: 'templateId', type: 'id', description: 'WhatsApp template UUID', required: false },
          ],
          requiresApproval: false,
          examples: ['Send WhatsApp to Sarah: "Your order has shipped!"'],
        },
        {
          name: 'create_sequence',
          description: 'Create an automated email or SMS sequence (drip campaign).',
          parameters: [
            { name: 'name', type: 'string', description: 'Sequence name', required: true },
            { name: 'steps', type: 'array', description: 'Steps [{templateId, delayDays, channel?}]', required: true },
            { name: 'trigger', type: 'enum', description: 'Trigger condition', enumValues: ['tag_added', 'status_changed', 'form_submitted', 'manual'], required: false, default: 'manual' },
          ],
          requiresApproval: false,
          examples: ['Create email sequence "Welcome Series" with 5 emails over 14 days'],
        },
        {
          name: 'create_template',
          description: 'Create a reusable message template.',
          parameters: [
            { name: 'name', type: 'string', description: 'Template name', required: true },
            { name: 'subject', type: 'string', description: 'Subject line (email only)', required: false },
            { name: 'body', type: 'string', description: 'Template body', required: true },
            { name: 'type', type: 'enum', description: 'Channel', enumValues: ['email', 'sms', 'whatsapp'], required: true },
            { name: 'variables', type: 'array', description: 'Template variables', required: false },
          ],
          requiresApproval: false,
          examples: ['Create email template "Invoice Reminder"'],
        },
        {
          name: 'create_list',
          description: 'Create a contact list for targeted messaging.',
          parameters: [
            { name: 'name', type: 'string', description: 'List name', required: true },
            { name: 'criteria', type: 'object', description: 'Filter criteria to auto-populate', required: false },
          ],
          requiresApproval: false,
          examples: ['Create list "VIP Clients" from contacts tagged VIP'],
        },
        {
          name: 'add_to_sequence',
          description: 'Add a contact to an existing sequence.',
          parameters: [
            { name: 'contactId', type: 'id', description: 'Contact UUID', required: true },
            { name: 'sequenceId', type: 'id', description: 'Sequence UUID', required: true },
          ],
          requiresApproval: false,
          examples: ['Add contact abc123 to Welcome Series'],
        },
        {
          name: 'remove_from_sequence',
          description: 'Remove a contact from a sequence.',
          parameters: [
            { name: 'contactId', type: 'id', description: 'Contact UUID', required: true },
            { name: 'sequenceId', type: 'id', description: 'Sequence UUID', required: true },
          ],
          requiresApproval: false,
          examples: ['Remove John from the drip campaign'],
        },
        {
          name: 'mark_conversation_resolved',
          description: 'Mark a conversation thread as resolved.',
          parameters: [
            { name: 'threadId', type: 'id', description: 'UUID of the conversation thread', required: true },
            { name: 'resolutionNotes', type: 'string', description: 'Resolution notes', required: false },
          ],
          requiresApproval: false,
          examples: ['Mark conversation TC-001 as resolved'],
        },
      ],
      queries: [
        {
          name: 'get_conversation',
          description: 'Full conversation thread with messages.',
          parameters: [
            { name: 'threadId', type: 'id', description: 'UUID of the conversation thread', required: true },
          ],
          returns: 'Conversation with messages',
          examples: ['Show conversation TC-001'],
        },
        {
          name: 'list_conversations',
          description: 'Paginated conversation list with optional filters.',
          parameters: [
            { name: 'status', type: 'enum', description: 'Conversation status', enumValues: ['open', 'resolved', 'snoozed', 'spam'], required: false },
            { name: 'contactId', type: 'id', description: 'Filter by contact', required: false },
            { name: 'channel', type: 'enum', description: 'Communication channel', enumValues: ['email', 'sms', 'whatsapp', 'chat'], required: false },
            { name: 'limit', type: 'number', description: 'Page size', required: false, default: 50 },
            { name: 'offset', type: 'number', description: 'Page offset', required: false, default: 0 },
          ],
          returns: 'Conversation[]',
          examples: ['List open conversations', 'Show email threads for John'],
        },
        {
          name: 'get_sequence_status',
          description: 'Status of a contact within a sequence (current step, next send).',
          parameters: [
            { name: 'contactId', type: 'id', description: 'Contact UUID', required: true },
            { name: 'sequenceId', type: 'id', description: 'Sequence UUID', required: true },
          ],
          returns: 'SequenceStatus',
          examples: ['Where is John in the Welcome Series?'],
        },
        {
          name: 'get_deliverability_stats',
          description: 'Aggregate deliverability metrics (open rate, click rate, bounce rate).',
          parameters: [
            { name: 'dateFrom', type: 'date', description: 'Start date', required: false },
            { name: 'dateTo', type: 'date', description: 'End date', required: false },
            { name: 'channel', type: 'enum', description: 'Channel filter', enumValues: ['email', 'sms', 'whatsapp'], required: false },
          ],
          returns: 'DeliverabilityStats',
          examples: ['Show email stats for last month', 'What is our open rate?'],
        },
        {
          name: 'get_template_usage',
          description: 'How many times a template has been used and its performance.',
          parameters: [
            { name: 'templateId', type: 'id', description: 'Template UUID', required: true },
            { name: 'dateFrom', type: 'date', description: 'Start date', required: false },
            { name: 'dateTo', type: 'date', description: 'End date', required: false },
          ],
          returns: 'TemplateUsage',
          examples: ['How is the Welcome template performing?'],
        },
      ],
    },
    // ── 6. FLOW ─────────────────────────────────────────────────────────────
    {
      module: 'flow',
      description: 'Workflow automation — triggers, conditions, branching, webhooks, third-party integrations.',
      actions: [
        {
          name: 'create_flow',
          description: 'Create a new workflow / automation.',
          parameters: [
            { name: 'name', type: 'string', description: 'Flow name', required: true },
            { name: 'trigger', type: 'object', description: 'Trigger config {type, config}', required: true },
            { name: 'steps', type: 'array', description: 'Steps [{type, config, conditions?}]', required: true },
            { name: 'description', type: 'string', description: 'Description', required: false },
            { name: 'isActive', type: 'boolean', description: 'Activate immediately', required: false, default: false },
          ],
          requiresApproval: false,
          examples: ['Create flow "New Lead → Welcome Email → Task" triggered on tag_added'],
        },
        {
          name: 'run_flow',
          description: 'Manually trigger a workflow.',
          parameters: [
            { name: 'flowId', type: 'id', description: 'UUID of the flow', required: true },
            { name: 'context', type: 'object', description: 'Runtime context data', required: false },
          ],
          requiresApproval: false,
          examples: ['Run flow FL-001'],
        },
        {
          name: 'toggle_flow',
          description: 'Enable or disable a workflow.',
          parameters: [
            { name: 'flowId', type: 'id', description: 'UUID of the flow', required: true },
            { name: 'active', type: 'boolean', description: 'true = enable, false = disable', required: true },
          ],
          requiresApproval: false,
          examples: ['Enable flow FL-001', 'Pause flow FL-002'],
        },
        {
          name: 'create_webhook',
          description: 'Create an incoming webhook for a workflow.',
          parameters: [
            { name: 'name', type: 'string', description: 'Webhook name', required: true },
            { name: 'flowId', type: 'id', description: 'Flow UUID to trigger', required: true },
            { name: 'secret', type: 'string', description: 'Secret for signature verification', required: false },
          ],
          requiresApproval: false,
          examples: ['Create webhook for Flow FL-001'],
        },
        {
          name: 'create_branch',
          description: 'Add a conditional branch to a workflow.',
          parameters: [
            { name: 'flowId', type: 'id', description: 'Flow UUID', required: true },
            { name: 'condition', type: 'object', description: 'Condition config {field, operator, value}', required: true },
            { name: 'trueSteps', type: 'array', description: 'Steps if condition is true', required: true },
            { name: 'falseSteps', type: 'array', description: 'Steps if condition is false', required: true },
          ],
          requiresApproval: false,
          examples: ['Add branch to FL-001: if contact.status == "customer" then send VIP email'],
        },
        {
          name: 'create_delay_step',
          description: 'Add a wait/delay step to a workflow.',
          parameters: [
            { name: 'flowId', type: 'id', description: 'Flow UUID', required: true },
            { name: 'delayMinutes', type: 'number', description: 'Minutes to wait', required: true },
            { name: 'delayUntil', type: 'datetime', description: 'Wait until specific time', required: false },
          ],
          requiresApproval: false,
          examples: ['Add 24-hour delay to FL-001'],
        },
        {
          name: 'create_api_step',
          description: 'Add an external API call step to a workflow.',
          parameters: [
            { name: 'flowId', type: 'id', description: 'Flow UUID', required: true },
            { name: 'endpoint', type: 'string', description: 'API endpoint URL', required: true },
            { name: 'method', type: 'enum', description: 'HTTP method', enumValues: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], required: true },
            { name: 'headers', type: 'object', description: 'HTTP headers', required: false },
            { name: 'body', type: 'object', description: 'Request body', required: false },
          ],
          requiresApproval: false,
          examples: ['Add API step to FL-001: POST https://api.example.com/webhook'],
        },
      ],
      queries: [
        {
          name: 'get_flow',
          description: 'Full workflow with steps, branches, and execution history.',
          parameters: [
            { name: 'flowId', type: 'id', description: 'UUID of the flow', required: true },
          ],
          returns: 'Flow with history',
          examples: ['Show flow FL-001'],
        },
        {
          name: 'list_flows',
          description: 'Paginated workflow list with optional status filter.',
          parameters: [
            { name: 'status', type: 'enum', description: 'Filter by status', enumValues: ['active', 'paused', 'draft', 'archived'], required: false },
            { name: 'limit', type: 'number', description: 'Page size', required: false, default: 50 },
            { name: 'offset', type: 'number', description: 'Page offset', required: false, default: 0 },
          ],
          returns: 'Flow[]',
          examples: ['List active flows', 'Show all workflows'],
        },
        {
          name: 'get_flow_execution_log',
          description: 'Execution history for a workflow (who ran, when, result).',
          parameters: [
            { name: 'flowId', type: 'id', description: 'UUID of the flow', required: true },
            { name: 'limit', type: 'number', description: 'Max entries', required: false, default: 50 },
          ],
          returns: 'ExecutionLog',
          examples: ['Show execution history for FL-001'],
        },
        {
          name: 'get_webhook_calls',
          description: 'Recent webhook calls for a workflow.',
          parameters: [
            { name: 'flowId', type: 'id', description: 'UUID of the flow', required: true },
            { name: 'limit', type: 'number', description: 'Max entries', required: false, default: 20 },
          ],
          returns: 'WebhookCall[]',
          examples: ['Show recent webhook calls for FL-001'],
        },
        {
          name: 'get_trigger_types',
          description: 'List available workflow trigger types.',
          parameters: [],
          returns: 'TriggerType[]',
          examples: ['What triggers are available?', 'List trigger types'],
        },
      ],
    },
    // ── 7. AUTOPILOT ────────────────────────────────────────────────────────
    {
      module: 'autopilot',
      description: 'Background automation loops, recurring tasks, monitoring agents.',
      actions: [
        {
          name: 'create_loop',
          description: 'Create a persistent background loop (recurring automation).',
          parameters: [
            { name: 'name', type: 'string', description: 'Loop name', required: true },
            { name: 'frequency', type: 'enum', description: 'Run frequency', enumValues: ['hourly', 'daily', 'weekly', 'monthly', 'custom'], required: true },
            { name: 'actions', type: 'array', description: 'Actions to execute each iteration', required: true },
            { name: 'conditions', type: 'array', description: 'Guard conditions', required: false },
            { name: 'maxIterations', type: 'number', description: 'Max runs (0 = unlimited)', required: false, default: 0 },
            { name: 'startImmediately', type: 'boolean', description: 'Run first iteration immediately', required: false, default: true },
          ],
          requiresApproval: false,
          examples: ['Create loop "Daily Invoice Reminder" — every day at 9 AM'],
        },
        {
          name: 'run_loop',
          description: 'Manually execute a loop iteration.',
          parameters: [
            { name: 'loopId', type: 'id', description: 'UUID of the loop', required: true },
          ],
          requiresApproval: false,
          examples: ['Run loop LP-001 now'],
        },
        {
          name: 'pause_loop',
          description: 'Pause a running loop.',
          parameters: [
            { name: 'loopId', type: 'id', description: 'UUID of the loop', required: true },
          ],
          requiresApproval: false,
          examples: ['Pause loop LP-001'],
        },
        {
          name: 'resume_loop',
          description: 'Resume a paused loop.',
          parameters: [
            { name: 'loopId', type: 'id', description: 'UUID of the loop', required: true },
          ],
          requiresApproval: false,
          examples: ['Resume loop LP-001'],
        },
        {
          name: 'stop_loop',
          description: 'Permanently stop a loop.',
          parameters: [
            { name: 'loopId', type: 'id', description: 'UUID of the loop', required: true },
          ],
          requiresApproval: false,
          examples: ['Stop loop LP-001'],
        },
        {
          name: 'create_monitor',
          description: 'Create a monitoring agent that watches for conditions.',
          parameters: [
            { name: 'name', type: 'string', description: 'Monitor name', required: true },
            { name: 'watchType', type: 'enum', description: 'What to watch', enumValues: ['invoice_overdue', 'lead_inactive', 'low_inventory', 'high_support_volume', 'custom'], required: true },
            { name: 'threshold', type: 'object', description: 'Threshold config {field, operator, value}', required: true },
            { name: 'alertChannels', type: 'array', description: 'Alert destinations (email, sms, slack)', required: false },
          ],
          requiresApproval: false,
          examples: ['Create monitor "Overdue Invoice Alert" for invoices > 7 days'],
        },
        {
          name: 'create_recurring_task',
          description: 'Create a task that repeats on a schedule.',
          parameters: [
            { name: 'title', type: 'string', description: 'Task title', required: true },
            { name: 'description', type: 'string', description: 'Task description', required: false },
            { name: 'frequency', type: 'enum', description: 'Repeat frequency', enumValues: ['daily', 'weekly', 'monthly'], required: true },
            { name: 'assignee', type: 'id', description: 'User UUID to assign', required: false },
            { name: 'dueTime', type: 'string', description: 'Due time (HH:MM)', required: false },
          ],
          requiresApproval: false,
          examples: ['Create recurring task "Weekly Report" every Monday'],
        },
      ],
      queries: [
        {
          name: 'get_loop',
          description: 'Loop details with execution history.',
          parameters: [
            { name: 'loopId', type: 'id', description: 'UUID of the loop', required: true },
          ],
          returns: 'Loop with history',
          examples: ['Show loop LP-001'],
        },
        {
          name: 'list_loops',
          description: 'Paginated loop list with optional status filter.',
          parameters: [
            { name: 'status', type: 'enum', description: 'Loop status', enumValues: ['running', 'paused', 'stopped', 'error'], required: false },
            { name: 'limit', type: 'number', description: 'Page size', required: false, default: 50 },
            { name: 'offset', type: 'number', description: 'Page offset', required: false, default: 0 },
          ],
          returns: 'Loop[]',
          examples: ['List running loops', 'Show all background automations'],
        },
        {
          name: 'list_monitors',
          description: 'Paginated monitor list with optional status filter.',
          parameters: [
            { name: 'status', type: 'enum', description: 'Monitor status', enumValues: ['active', 'paused', 'triggered', 'error'], required: false },
            { name: 'limit', type: 'number', description: 'Page size', required: false, default: 50 },
            { name: 'offset', type: 'number', description: 'Page offset', required: false, default: 0 },
          ],
          returns: 'Monitor[]',
          examples: ['List active monitors', 'Show triggered monitors'],
        },
        {
          name: 'get_execution_log',
          description: 'Execution log for a loop or monitor.',
          parameters: [
            { name: 'entityId', type: 'id', description: 'Loop or monitor UUID', required: true },
            { name: 'entityType', type: 'enum', description: 'Entity type', enumValues: ['loop', 'monitor'], required: true },
            { name: 'limit', type: 'number', description: 'Max entries', required: false, default: 50 },
          ],
          returns: 'ExecutionEntry[]',
          examples: ['Show execution log for LP-001'],
        },
        {
          name: 'get_autopilot_stats',
          description: 'Aggregate autopilot statistics (loops run, tasks completed, errors).',
          parameters: [
            { name: 'dateFrom', type: 'date', description: 'Start date', required: false },
            { name: 'dateTo', type: 'date', description: 'End date', required: false },
          ],
          returns: 'AutopilotStats',
          examples: ['Show autopilot stats for this week'],
        },
      ],
    },
    // ── 8. TEMPORAL ─────────────────────────────────────────────────────────
    {
      module: 'temporal',
      description: 'Business memory, long-term persistence, document RAG, semantic search.',
      actions: [
        {
          name: 'store_memory',
          description: 'Store a long-term business memory / fact.',
          parameters: [
            { name: 'key', type: 'string', description: 'Memory key / topic', required: true },
            { name: 'value', type: 'string', description: 'Memory content', required: true },
            { name: 'category', type: 'string', description: 'Category tag', required: false },
            { name: 'importance', type: 'number', description: 'Importance score 1-10', required: false },
            { name: 'ttlDays', type: 'number', description: 'Auto-expiry in days (0 = never)', required: false, default: 0 },
          ],
          requiresApproval: false,
          examples: ['Store memory "Client Preference — Acme Corp: prefers email over calls"'],
        },
        {
          name: 'recall_memory',
          description: 'Recall stored memories by key or semantic search.',
          parameters: [
            { name: 'query', type: 'string', description: 'Search query or exact key', required: true },
            { name: 'limit', type: 'number', description: 'Max results', required: false, default: 10 },
          ],
          requiresApproval: false,
          examples: ['Recall memories about Acme Corp'],
        },
        {
          name: 'delete_memory',
          description: 'Delete a stored memory.',
          parameters: [
            { name: 'key', type: 'string', description: 'Memory key', required: true },
          ],
          requiresApproval: false,
          examples: ['Delete memory "Old Vendor — XYZ Suppliers"'],
        },
        {
          name: 'create_document_set',
          description: 'Create a document set for RAG / knowledge retrieval.',
          parameters: [
            { name: 'name', type: 'string', description: 'Document set name', required: true },
            { name: 'documents', type: 'array', description: 'Documents [{title, content, metadata?}]', required: true },
          ],
          requiresApproval: false,
          examples: ['Create document set "Standard Operating Procedures"'],
        },
        {
          name: 'add_to_document_set',
          description: 'Add a document to an existing set.',
          parameters: [
            { name: 'setId', type: 'id', description: 'Document set UUID', required: true },
            { name: 'title', type: 'string', description: 'Document title', required: true },
            { name: 'content', type: 'string', description: 'Document content', required: true },
            { name: 'metadata', type: 'object', description: 'Optional metadata', required: false },
          ],
          requiresApproval: false,
          examples: ['Add document to SOP set'],
        },
        {
          name: 'query_document_set',
          description: 'Query a document set using RAG (retrieval-augmented generation).',
          parameters: [
            { name: 'setId', type: 'id', description: 'Document set UUID', required: true },
            { name: 'question', type: 'string', description: 'Question to answer', required: true },
            { name: 'limit', type: 'number', description: 'Max source chunks', required: false, default: 5 },
          ],
          requiresApproval: false,
          examples: ['Query SOP document set: "What is the refund policy?"'],
        },
        {
          name: 'consolidate_memories',
          description: 'Merge and summarize related memories into a single entry.',
          parameters: [
            { name: 'keys', type: 'array', description: 'Memory keys to consolidate', required: true },
            { name: 'summaryKey', type: 'string', description: 'New key for consolidated memory', required: true },
          ],
          requiresApproval: false,
          examples: ['Consolidate all "Acme Corp" memories into a single summary'],
        },
      ],
      queries: [
        {
          name: 'search_memories',
          description: 'Full-text or semantic search over stored memories.',
          parameters: [
            { name: 'query', type: 'string', description: 'Search query', required: true },
            { name: 'limit', type: 'number', description: 'Max results', required: false, default: 10 },
            { name: 'category', type: 'string', description: 'Filter by category', required: false },
          ],
          returns: 'Memory[]',
          examples: ['Search memories about "pricing strategy"'],
        },
        {
          name: 'get_memory_categories',
          description: 'List all memory categories with counts.',
          parameters: [],
          returns: 'CategoryCount[]',
          examples: ['What memory categories do we have?'],
        },
        {
          name: 'rag_query',
          description: 'RAG query across all document sets or a specific one.',
          parameters: [
            { name: 'question', type: 'string', description: 'Question to answer', required: true },
            { name: 'setId', type: 'id', description: 'Specific document set (optional)', required: false },
            { name: 'limit', type: 'number', description: 'Max source chunks', required: false, default: 5 },
          ],
          returns: 'RagResult',
          examples: ['What is our refund policy?', 'Query knowledge base about onboarding'],
        },
        {
          name: 'get_document_set',
          description: 'Full document set with all documents.',
          parameters: [
            { name: 'setId', type: 'id', description: 'Document set UUID', required: true },
          ],
          returns: 'DocumentSet',
          examples: ['Show document set DS-001'],
        },
        {
          name: 'get_memory_stats',
          description: 'Memory statistics (total memories, by category, by importance).',
          parameters: [
            { name: 'dateFrom', type: 'date', description: 'Start date', required: false },
            { name: 'dateTo', type: 'date', description: 'End date', required: false },
          ],
          returns: 'MemoryStats',
          examples: ['Show memory stats'],
        },
      ],
    },
    // ── 9. INBOX ────────────────────────────────────────────────────────────
    {
      module: 'inbox',
      description: 'Unified inbox, conversation threads, notes, @mentions, team collaboration.',
      actions: [
        {
          name: 'create_note',
          description: 'Create a note in the unified inbox.',
          parameters: [
            { name: 'content', type: 'string', description: 'Note body', required: true },
            { name: 'title', type: 'string', description: 'Note title', required: false },
            { name: 'tags', type: 'array', description: 'Tags', required: false },
            { name: 'mentions', type: 'array', description: '@mentioned user UUIDs', required: false },
            { name: 'linkedEntityType', type: 'enum', description: 'Linked entity type', enumValues: ['contact', 'invoice', 'booking', 'project'], required: false },
            { name: 'linkedEntityId', type: 'id', description: 'Linked entity UUID', required: false },
          ],
          requiresApproval: false,
          examples: ['Create note: "Call Sarah about proposal — prefers mornings"'],
        },
        {
          name: 'reply_to_thread',
          description: 'Reply to an existing conversation thread.',
          parameters: [
            { name: 'threadId', type: 'id', description: 'UUID of the thread', required: true },
            { name: 'content', type: 'string', description: 'Reply text', required: true },
            { name: 'attachments', type: 'array', description: 'File attachments', required: false },
          ],
          requiresApproval: false,
          examples: ['Reply to thread TH-001: "Thanks for the update, let\'s proceed"'],
        },
        {
          name: 'mark_read',
          description: 'Mark a message or thread as read.',
          parameters: [
            { name: 'messageId', type: 'id', description: 'UUID of the message', required: true },
          ],
          requiresApproval: false,
          examples: ['Mark message MSG-001 as read'],
        },
        {
          name: 'mark_unread',
          description: 'Mark a message or thread as unread.',
          parameters: [
            { name: 'messageId', type: 'id', description: 'UUID of the message', required: true },
          ],
          requiresApproval: false,
          examples: ['Mark message MSG-001 as unread'],
        },
        {
          name: 'pin_note',
          description: 'Pin a note to the top of the inbox.',
          parameters: [
            { name: 'noteId', type: 'id', description: 'UUID of the note', required: true },
          ],
          requiresApproval: false,
          examples: ['Pin note NT-001'],
        },
        {
          name: 'create_task_from_note',
          description: 'Convert a note into a task.',
          parameters: [
            { name: 'noteId', type: 'id', description: 'UUID of the note', required: true },
            { name: 'dueDate', type: 'date', description: 'Due date (ISO 8601)', required: false },
            { name: 'assignee', type: 'id', description: 'User UUID to assign', required: false },
          ],
          requiresApproval: false,
          examples: ['Convert note NT-001 to a task due Friday'],
        },
        {
          name: 'assign_thread',
          description: 'Assign a conversation thread to a team member.',
          parameters: [
            { name: 'threadId', type: 'id', description: 'UUID of the thread', required: true },
            { name: 'userId', type: 'id', description: 'Assignee user ID', required: true },
          ],
          requiresApproval: false,
          examples: ['Assign thread TH-001 to Jane'],
        },
        {
          name: 'snooze_thread',
          description: 'Snooze a conversation thread until a later time.',
          parameters: [
            { name: 'threadId', type: 'id', description: 'UUID of the thread', required: true },
            { name: 'until', type: 'datetime', description: 'Snooze until (ISO 8601)', required: true },
            { name: 'reason', type: 'string', description: 'Why snoozed', required: false },
          ],
          requiresApproval: false,
          examples: ['Snooze thread TH-001 until tomorrow 9 AM'],
        },
      ],
      queries: [
        {
          name: 'get_inbox',
          description: 'Unified inbox with notes, messages, and threads.',
          parameters: [
            { name: 'type', type: 'enum', description: 'Filter by type', enumValues: ['note', 'message', 'mention', 'all'], required: false, default: 'all' },
            { name: 'unreadOnly', type: 'boolean', description: 'Only unread items', required: false },
            { name: 'limit', type: 'number', description: 'Page size', required: false, default: 50 },
            { name: 'offset', type: 'number', description: 'Page offset', required: false, default: 0 },
          ],
          returns: 'InboxItem[]',
          examples: ['Show my inbox', 'List unread messages'],
        },
        {
          name: 'get_thread',
          description: 'Full conversation thread with all messages.',
          parameters: [
            { name: 'threadId', type: 'id', description: 'UUID of the thread', required: true },
          ],
          returns: 'Thread with messages',
          examples: ['Show thread TH-001'],
        },
        {
          name: 'search_notes',
          description: 'Search notes by content or tags.',
          parameters: [
            { name: 'query', type: 'string', description: 'Search query', required: true },
            { name: 'limit', type: 'number', description: 'Max results', required: false, default: 20 },
          ],
          returns: 'Note[]',
          examples: ['Search notes about "refund"'],
        },
        {
          name: 'get_unread_count',
          description: 'Count of unread inbox items.',
          parameters: [],
          returns: 'number',
          examples: ['How many unread messages do I have?'],
        },
        {
          name: 'get_team_activity',
          description: 'Recent team activity in the inbox.',
          parameters: [
            { name: 'limit', type: 'number', description: 'Max entries', required: false, default: 20 },
            { name: 'dateFrom', type: 'date', description: 'Start date', required: false },
          ],
          returns: 'ActivityEntry[]',
          examples: ['What has the team been working on?'],
        },
      ],
    },
    // ── 10. GENOME ──────────────────────────────────────────────────────────
    {
      module: 'genome',
      description: 'Business DNA — 7-dimension health scoring, stage detection, readiness assessment.',
      actions: [
        {
          name: 'get_dna',
          description: 'Get the current business DNA scorecard (7 dimensions).',
          parameters: [
            { name: 'businessId', type: 'id', description: 'Business UUID', required: true },
            { name: 'recalculate', type: 'boolean', description: 'Force recalculation', required: false, default: false },
          ],
          requiresApproval: false,
          examples: ['Get DNA scorecard', 'Show business health'],
        },
        {
          name: 'get_stage',
          description: 'Determine the business growth stage.',
          parameters: [
            { name: 'businessId', type: 'id', description: 'Business UUID', required: true },
            { name: 'detailed', type: 'boolean', description: 'Include dimension breakdown', required: false, default: false },
          ],
          requiresApproval: false,
          examples: ['What stage is this business in?', 'Show growth stage details'],
        },
        {
          name: 'get_readiness',
          description: 'Assess readiness for a specific initiative.',
          parameters: [
            { name: 'businessId', type: 'id', description: 'Business UUID', required: true },
            { name: 'initiative', type: 'string', description: 'Initiative name (e.g. "launch_product", "scale_team")', required: true },
          ],
          requiresApproval: false,
          examples: ['Is the business ready to launch a product?', 'Assess scaling readiness'],
        },
        {
          name: 'update_dna',
          description: 'Update a specific DNA dimension score.',
          parameters: [
            { name: 'businessId', type: 'id', description: 'Business UUID', required: true },
            { name: 'dimension', type: 'enum', description: 'Dimension to update', enumValues: ['revenue', 'operations', 'marketing', 'product', 'team', 'finance', 'customer_success'], required: true },
            { name: 'score', type: 'number', description: 'New score 0-100', required: true },
            { name: 'reason', type: 'string', description: 'Reason for update', required: false },
          ],
          requiresApproval: true,
          examples: ['Update marketing DNA score to 85 — campaign performed well'],
        },
        {
          name: 'trigger_assessment',
          description: 'Trigger a full DNA reassessment.',
          parameters: [
            { name: 'businessId', type: 'id', description: 'Business UUID', required: true },
            { name: 'notify', type: 'boolean', description: 'Notify stakeholders', required: false, default: true },
          ],
          requiresApproval: false,
          examples: ['Run full DNA assessment', 'Trigger business health check'],
        },
      ],
      queries: [
        {
          name: 'get_dna',
          description: 'Full DNA scorecard with historical trends.',
          parameters: [
            { name: 'businessId', type: 'id', description: 'Business UUID', required: true },
            { name: 'recalculate', type: 'boolean', description: 'Force recalculation', required: false, default: false },
          ],
          returns: 'DnaScorecard',
          examples: ['Show DNA scorecard', 'Get business health report'],
        },
        {
          name: 'get_stage',
          description: 'Business growth stage with confidence score.',
          parameters: [
            { name: 'businessId', type: 'id', description: 'Business UUID', required: true },
          ],
          returns: 'GrowthStage',
          examples: ['What stage is this business?'],
        },
        {
          name: 'get_readiness',
          description: 'Readiness report for a specific initiative.',
          parameters: [
            { name: 'businessId', type: 'id', description: 'Business UUID', required: true },
            { name: 'initiative', type: 'string', description: 'Initiative name', required: true },
          ],
          returns: 'ReadinessReport',
          examples: ['Is the business ready to scale?'],
        },
        {
          name: 'get_dna_history',
          description: 'Historical DNA score changes.',
          parameters: [
            { name: 'businessId', type: 'id', description: 'Business UUID', required: true },
            { name: 'dimension', type: 'enum', description: 'Filter dimension', enumValues: ['revenue', 'operations', 'marketing', 'product', 'team', 'finance', 'customer_success'], required: false },
            { name: 'from', type: 'date', description: 'Start date', required: false },
          ],
          returns: 'DnaSnapshot[]',
          examples: ['Show DNA history', 'How has revenue DNA changed?'],
        },
      ],
    },
    // ── 11. INTELLIGENCE ────────────────────────────────────────────────────
    {
      module: 'intelligence',
      description: 'AI-powered insights — sentiment analysis, opportunity detection, predictive forecasting.',
      actions: [
        {
          name: 'analyze_sentiment',
          description: 'Analyze sentiment of text or conversation.',
          parameters: [
            { name: 'text', type: 'string', description: 'Text to analyze', required: true },
            { name: 'context', type: 'string', description: 'Additional context', required: false },
          ],
          requiresApproval: false,
          examples: ['Analyze sentiment of "I love this product but shipping was slow"'],
        },
        {
          name: 'detect_opportunities',
          description: 'Scan contacts and conversations for business opportunities.',
          parameters: [
            { name: 'contactIds', type: 'array', description: 'Specific contacts to scan (empty = all)', required: false },
            { name: 'minConfidence', type: 'number', description: 'Minimum confidence threshold 0-1', required: false, default: 0.7 },
            { name: 'types', type: 'array', description: 'Opportunity types to look for', required: false },
          ],
          requiresApproval: false,
          examples: ['Find upsell opportunities among customers', 'Detect churn risk signals'],
        },
        {
          name: 'generate_forecast',
          description: 'Generate a predictive forecast for a business metric.',
          parameters: [
            { name: 'metric', type: 'enum', description: 'Metric to forecast', enumValues: ['revenue', 'churn', 'conversion', 'support_volume', 'pipeline'], required: true },
            { name: 'horizon', type: 'enum', description: 'Forecast horizon', enumValues: ['7d', '30d', '90d', '1y'], required: true },
            { name: 'businessId', type: 'id', description: 'Business UUID', required: true },
          ],
          requiresApproval: false,
          examples: ['Forecast revenue for next 30 days', 'Predict churn risk for Q2'],
        },
        {
          name: 'run_comprehensive_analysis',
          description: 'Run a full business intelligence analysis across all dimensions.',
          parameters: [
            { name: 'businessId', type: 'id', description: 'Business UUID', required: true },
            { name: 'scope', type: 'enum', description: 'Analysis scope', enumValues: ['full', 'financial', 'operational', 'customer', 'growth'], required: false, default: 'full' },
          ],
          requiresApproval: false,
          examples: ['Run full business analysis', 'Analyze customer health'],
        },
      ],
      queries: [
        {
          name: 'get_sentiment_trend',
          description: 'Sentiment trend over time.',
          parameters: [
            { name: 'dateFrom', type: 'date', description: 'Start date', required: false },
            { name: 'dateTo', type: 'date', description: 'End date', required: false },
            { name: 'entityType', type: 'enum', description: 'Filter by entity', enumValues: ['contact', 'conversation', 'review'], required: false },
          ],
          returns: 'SentimentTrend',
          examples: ['Show sentiment trend this month'],
        },
        {
          name: 'get_opportunities',
          description: 'List detected opportunities with confidence scores.',
          parameters: [
            { name: 'minConfidence', type: 'number', description: 'Min confidence 0-1', required: false, default: 0.7 },
            { name: 'status', type: 'enum', description: 'Opportunity status', enumValues: ['new', 'in_progress', 'won', 'lost', 'dismissed'], required: false },
            { name: 'limit', type: 'number', description: 'Max results', required: false, default: 20 },
          ],
          returns: 'Opportunity[]',
          examples: ['Show top opportunities', 'List high-confidence upsells'],
        },
        {
          name: 'get_forecast',
          description: 'Latest forecast for a business metric.',
          parameters: [
            { name: 'metric', type: 'enum', description: 'Metric', enumValues: ['revenue', 'churn', 'conversion', 'support_volume', 'pipeline'], required: true },
            { name: 'horizon', type: 'enum', description: 'Horizon', enumValues: ['7d', '30d', '90d', '1y'], required: true },
            { name: 'businessId', type: 'id', description: 'Business UUID', required: true },
          ],
          returns: 'Forecast',
          examples: ['Show revenue forecast', 'Get churn prediction'],
        },
        {
          name: 'get_insights',
          description: 'Curated AI insights and recommendations.',
          parameters: [
            { name: 'businessId', type: 'id', description: 'Business UUID', required: true },
            { name: 'category', type: 'enum', description: 'Insight category', enumValues: ['revenue', 'churn', 'growth', 'efficiency', 'risk'], required: false },
            { name: 'limit', type: 'number', description: 'Max results', required: false, default: 10 },
          ],
          returns: 'Insight[]',
          examples: ['Show AI insights', 'Get growth recommendations'],
        },
      ],
    },
    // ── 12. NOTIFICATIONS ───────────────────────────────────────────────────
    {
      module: 'notifications',
      description: 'In-app, push, email, and SMS notifications with preference management.',
      actions: [
        {
          name: 'send_notification',
          description: 'Send a notification to a user.',
          parameters: [
            { name: 'userId', type: 'id', description: 'User UUID', required: true },
            { name: 'title', type: 'string', description: 'Notification title', required: true },
            { name: 'body', type: 'string', description: 'Notification body', required: true },
            { name: 'type', type: 'enum', description: 'Notification type', enumValues: ['info', 'success', 'warning', 'error'], required: false, default: 'info' },
            { name: 'channel', type: 'enum', description: 'Delivery channel', enumValues: ['in_app', 'push', 'email', 'sms'], required: false, default: 'in_app' },
            { name: 'actionUrl', type: 'string', description: 'Deep link URL', required: false },
            { name: 'data', type: 'object', description: 'Additional payload', required: false },
          ],
          requiresApproval: false,
          examples: ['Send notification to Jane: "Invoice INV-001 is overdue"'],
        },
        {
          name: 'mark_all_read',
          description: 'Mark all notifications as read for a user.',
          parameters: [
            { name: 'userId', type: 'id', description: 'User UUID', required: true },
          ],
          requiresApproval: false,
          examples: ['Mark all notifications as read for Jane'],
        },
        {
          name: 'configure_digest',
          description: 'Configure a daily or weekly notification digest.',
          parameters: [
            { name: 'userId', type: 'id', description: 'User UUID', required: true },
            { name: 'frequency', type: 'enum', description: 'Digest frequency', enumValues: ['daily', 'weekly', 'off'], required: true },
            { name: 'time', type: 'string', description: 'Delivery time (HH:MM)', required: false },
            { name: 'categories', type: 'array', description: 'Categories to include', required: false },
          ],
          requiresApproval: false,
          examples: ['Set daily digest for Jane at 9 AM'],
        },
        {
          name: 'create_notification_rule',
          description: 'Create a rule that auto-sends notifications on events.',
          parameters: [
            { name: 'name', type: 'string', description: 'Rule name', required: true },
            { name: 'eventType', type: 'enum', description: 'Trigger event', enumValues: ['invoice_overdue', 'booking_created', 'contact_status_changed', 'task_completed', 'custom'], required: true },
            { name: 'conditions', type: 'object', description: 'Rule conditions', required: false },
            { name: 'recipients', type: 'array', description: 'Recipient user IDs', required: true },
            { name: 'template', type: 'object', description: 'Notification template', required: true },
          ],
          requiresApproval: false,
          examples: ['Create rule: notify manager when invoice goes overdue'],
        },
      ],
      queries: [
        {
          name: 'get_notifications',
          description: 'List notifications for a user.',
          parameters: [
            { name: 'userId', type: 'id', description: 'User UUID', required: true },
            { name: 'unreadOnly', type: 'boolean', description: 'Only unread', required: false },
            { name: 'limit', type: 'number', description: 'Page size', required: false, default: 50 },
            { name: 'offset', type: 'number', description: 'Page offset', required: false, default: 0 },
          ],
          returns: 'Notification[]',
          examples: ['Show my notifications', 'List unread notifications'],
        },
        {
          name: 'get_preferences',
          description: 'Get notification preferences for a user.',
          parameters: [
            { name: 'userId', type: 'id', description: 'User UUID', required: true },
          ],
          returns: 'NotificationPreferences',
          examples: ['What are Jane\'s notification preferences?'],
        },
        {
          name: 'get_unread_count',
          description: 'Unread notification count for a user.',
          parameters: [
            { name: 'userId', type: 'id', description: 'User UUID', required: true },
          ],
          returns: 'number',
          examples: ['How many unread notifications for Jane?'],
        },
        {
          name: 'get_notification_stats',
          description: 'Aggregate notification statistics.',
          parameters: [
            { name: 'dateFrom', type: 'date', description: 'Start date', required: false },
            { name: 'dateTo', type: 'date', description: 'End date', required: false },
            { name: 'userId', type: 'id', description: 'Filter by user', required: false },
          ],
          returns: 'NotificationStats',
          examples: ['Show notification stats for this week'],
        },
      ],
    },
    // ── 13. PROJECTS ────────────────────────────────────────────────────────
    {
      module: 'projects',
      description: 'Project management, milestones, tasks, Gantt charts, resource allocation.',
      actions: [
        {
          name: 'create_project',
          description: 'Create a new project.',
          parameters: [
            { name: 'name', type: 'string', description: 'Project name', required: true },
            { name: 'description', type: 'string', description: 'Description', required: false },
            { name: 'clientId', type: 'id', description: 'Client contact UUID', required: false },
            { name: 'startDate', type: 'date', description: 'Start date (ISO 8601)', required: false },
            { name: 'endDate', type: 'date', description: 'Target end date', required: false },
            { name: 'budget', type: 'number', description: 'Budget amount', required: false },
            { name: 'status', type: 'enum', description: 'Initial status', enumValues: ['planning', 'active', 'on_hold', 'completed', 'cancelled'], required: false, default: 'planning' },
          ],
          requiresApproval: false,
          examples: ['Create project "Website Redesign" for Acme Corp'],
        },
        {
          name: 'add_milestone',
          description: 'Add a milestone to a project.',
          parameters: [
            { name: 'projectId', type: 'id', description: 'Project UUID', required: true },
            { name: 'name', type: 'string', description: 'Milestone name', required: true },
            { name: 'dueDate', type: 'date', description: 'Due date (ISO 8601)', required: true },
            { name: 'description', type: 'string', description: 'Description', required: false },
          ],
          requiresApproval: false,
          examples: ['Add milestone "Design Complete" to project PRJ-001'],
        },
        {
          name: 'add_task',
          description: 'Add a task to a project.',
          parameters: [
            { name: 'projectId', type: 'id', description: 'Project UUID', required: true },
            { name: 'title', type: 'string', description: 'Task title', required: true },
            { name: 'description', type: 'string', description: 'Description', required: false },
            { name: 'assignee', type: 'id', description: 'User UUID', required: false },
            { name: 'dueDate', type: 'date', description: 'Due date', required: false },
            { name: 'priority', type: 'enum', description: 'Priority', enumValues: ['low', 'medium', 'high', 'critical'], required: false, default: 'medium' },
          ],
          requiresApproval: false,
          examples: ['Add task "Design homepage" to PRJ-001'],
        },
        {
          name: 'update_task_status',
          description: 'Change the status of a project task.',
          parameters: [
            { name: 'taskId', type: 'id', description: 'Task UUID', required: true },
            { name: 'status', type: 'enum', description: 'New status', enumValues: ['todo', 'in_progress', 'review', 'done', 'blocked'], required: true },
          ],
          requiresApproval: false,
          examples: ['Mark task TK-001 as done'],
        },
        {
          name: 'update_project_status',
          description: 'Change the overall status of a project.',
          parameters: [
            { name: 'projectId', type: 'id', description: 'Project UUID', required: true },
            { name: 'status', type: 'enum', description: 'New status', enumValues: ['planning', 'active', 'on_hold', 'completed', 'cancelled'], required: true },
          ],
          requiresApproval: false,
          examples: ['Mark project PRJ-001 as active'],
        },
        {
          name: 'complete_milestone',
          description: 'Mark a project milestone as completed.',
          parameters: [
            { name: 'milestoneId', type: 'id', description: 'Milestone UUID', required: true },
            { name: 'notes', type: 'string', description: 'Completion notes', required: false },
          ],
          requiresApproval: false,
          examples: ['Complete milestone MS-001'],
        },
        {
          name: 'archive_project',
          description: 'Archive a completed or cancelled project.',
          parameters: [
            { name: 'projectId', type: 'id', description: 'Project UUID', required: true },
          ],
          requiresApproval: false,
          examples: ['Archive project PRJ-001'],
        },
      ],
      queries: [
        {
          name: 'get_project',
          description: 'Full project with milestones, tasks, and team.',
          parameters: [
            { name: 'projectId', type: 'id', description: 'Project UUID', required: true },
          ],
          returns: 'Project with details',
          examples: ['Show project PRJ-001'],
        },
        {
          name: 'list_projects',
          description: 'Paginated project list with optional filters.',
          parameters: [
            { name: 'status', type: 'enum', description: 'Filter by status', enumValues: ['planning', 'active', 'on_hold', 'completed', 'cancelled'], required: false },
            { name: 'clientId', type: 'id', description: 'Filter by client', required: false },
            { name: 'limit', type: 'number', description: 'Page size', required: false, default: 50 },
            { name: 'offset', type: 'number', description: 'Page offset', required: false, default: 0 },
          ],
          returns: 'Project[]',
          examples: ['List active projects', 'Show projects for Acme Corp'],
        },
        {
          name: 'get_task_board',
          description: 'Kanban board view of tasks for a project.',
          parameters: [
            { name: 'projectId', type: 'id', description: 'Project UUID', required: true },
          ],
          returns: 'TaskBoard',
          examples: ['Show task board for PRJ-001'],
        },
        {
          name: 'get_gantt_chart',
          description: 'Gantt chart timeline for a project.',
          parameters: [
            { name: 'projectId', type: 'id', description: 'Project UUID', required: true },
          ],
          returns: 'GanttChart',
          examples: ['Show Gantt chart for PRJ-001'],
        },
        {
          name: 'get_project_stats',
          description: 'Project statistics (completion %, budget burn, risk).',
          parameters: [
            { name: 'projectId', type: 'id', description: 'Project UUID', required: true },
          ],
          returns: 'ProjectStats',
          examples: ['How is PRJ-001 doing?', 'Show project health'],
        },
      ],
    },
    // ── 14. SOCIAL ──────────────────────────────────────────────────────────
    {
      module: 'social',
      description: 'Social media management — scheduling, publishing, engagement, analytics.',
      actions: [
        {
          name: 'schedule_post',
          description: 'Schedule a social media post.',
          parameters: [
            { name: 'platform', type: 'enum', description: 'Social platform', enumValues: ['twitter', 'facebook', 'linkedin', 'instagram', 'tiktok'], required: true },
            { name: 'content', type: 'string', description: 'Post content', required: true },
            { name: 'scheduledAt', type: 'datetime', description: 'Schedule time (ISO 8601)', required: true },
            { name: 'mediaUrls', type: 'array', description: 'Media attachments', required: false },
          ],
          requiresApproval: false,
          examples: ['Schedule Twitter post for tomorrow 9 AM'],
        },
        {
          name: 'publish_now',
          description: 'Publish a social media post immediately.',
          parameters: [
            { name: 'platform', type: 'enum', description: 'Social platform', enumValues: ['twitter', 'facebook', 'linkedin', 'instagram', 'tiktok'], required: true },
            { name: 'content', type: 'string', description: 'Post content', required: true },
            { name: 'mediaUrls', type: 'array', description: 'Media attachments', required: false },
          ],
          requiresApproval: false,
          examples: ['Post to Twitter now'],
        },
        {
          name: 'reply_to_comment',
          description: 'Reply to a comment on a social media post.',
          parameters: [
            { name: 'postId', type: 'id', description: 'Post UUID', required: true },
            { name: 'commentId', type: 'id', description: 'Comment UUID', required: true },
            { name: 'reply', type: 'string', description: 'Reply text', required: true },
          ],
          requiresApproval: false,
          examples: ['Reply to comment on post SP-001'],
        },
        {
          name: 'delete_post',
          description: 'Delete a published or scheduled social media post.',
          parameters: [
            { name: 'postId', type: 'id', description: 'Post UUID', required: true },
          ],
          requiresApproval: false,
          examples: ['Delete post SP-001'],
        },
        {
          name: 'connect_account',
          description: 'Connect a social media account.',
          parameters: [
            { name: 'platform', type: 'enum', description: 'Social platform', enumValues: ['twitter', 'facebook', 'linkedin', 'instagram', 'tiktok'], required: true },
            { name: 'handle', type: 'string', description: 'Account handle', required: true },
            { name: 'accessToken', type: 'string', description: 'OAuth access token', required: true },
          ],
          requiresApproval: false,
          examples: ['Connect Twitter account @acme'],
        },
        {
          name: 'disconnect_account',
          description: 'Disconnect a social media account.',
          parameters: [
            { name: 'accountId', type: 'id', description: 'Account UUID', required: true },
          ],
          requiresApproval: false,
          examples: ['Disconnect Twitter account ACC-001'],
        },
      ],
      queries: [
        {
          name: 'get_scheduled_posts',
          description: 'Upcoming scheduled social posts.',
          parameters: [
            { name: 'platform', type: 'enum', description: 'Filter by platform', enumValues: ['twitter', 'facebook', 'linkedin', 'instagram', 'tiktok'], required: false },
            { name: 'limit', type: 'number', description: 'Max posts', required: false, default: 20 },
          ],
          returns: 'ScheduledPost[]',
          examples: ['Show scheduled posts', 'What is posting to Twitter soon?'],
        },
        {
          name: 'get_social_analytics',
          description: 'Social media performance metrics.',
          parameters: [
            { name: 'platform', type: 'enum', description: 'Filter by platform', enumValues: ['twitter', 'facebook', 'linkedin', 'instagram', 'tiktok'], required: false },
            { name: 'dateFrom', type: 'date', description: 'Start date', required: false },
            { name: 'dateTo', type: 'date', description: 'End date', required: false },
          ],
          returns: 'SocialAnalytics',
          examples: ['Show social analytics for last month'],
        },
        {
          name: 'get_engagement_stats',
          description: 'Engagement rate, reach, impressions per platform.',
          parameters: [
            { name: 'platform', type: 'enum', description: 'Filter by platform', enumValues: ['twitter', 'facebook', 'linkedin', 'instagram', 'tiktok'], required: false },
            { name: 'dateFrom', type: 'date', description: 'Start date', required: false },
            { name: 'dateTo', type: 'date', description: 'End date', required: false },
          ],
          returns: 'EngagementStats',
          examples: ['Show engagement stats', 'What is our reach on Twitter?'],
        },
        {
          name: 'get_follower_growth',
          description: 'Follower growth over time.',
          parameters: [
            { name: 'platform', type: 'enum', description: 'Filter by platform', enumValues: ['twitter', 'facebook', 'linkedin', 'instagram', 'tiktok'], required: false },
            { name: 'dateFrom', type: 'date', description: 'Start date', required: false },
            { name: 'dateTo', type: 'date', description: 'End date', required: false },
          ],
          returns: 'FollowerGrowth',
          examples: ['Show follower growth', 'How many new followers this month?'],
        },
      ],
    },
    // ── 15. ANALYTICS ───────────────────────────────────────────────────────
    {
      module: 'analytics',
      description: 'Dashboards, reports, funnels, event tracking, data exports.',
      actions: [
        {
          name: 'create_dashboard',
          description: 'Create a custom analytics dashboard.',
          parameters: [
            { name: 'name', type: 'string', description: 'Dashboard name', required: true },
            { name: 'widgets', type: 'array', description: 'Widget configs', required: true },
            { name: 'shared', type: 'boolean', description: 'Share with team', required: false, default: false },
          ],
          requiresApproval: false,
          examples: ['Create dashboard "Q1 Performance"'],
        },
        {
          name: 'create_report',
          description: 'Generate an analytics report.',
          parameters: [
            { name: 'name', type: 'string', description: 'Report name', required: true },
            { name: 'type', type: 'enum', description: 'Report type', enumValues: ['revenue', 'pipeline', 'engagement', 'custom'], required: true },
            { name: 'dateFrom', type: 'date', description: 'Start date', required: true },
            { name: 'dateTo', type: 'date', description: 'End date', required: true },
            { name: 'schedule', type: 'enum', description: 'Schedule', enumValues: ['once', 'daily', 'weekly', 'monthly'], required: false, default: 'once' },
          ],
          requiresApproval: false,
          examples: ['Create report "January Revenue"'],
        },
        {
          name: 'create_funnel',
          description: 'Create a conversion funnel.',
          parameters: [
            { name: 'name', type: 'string', description: 'Funnel name', required: true },
            { name: 'steps', type: 'array', description: 'Funnel steps [{name, event, filter?}]', required: true },
          ],
          requiresApproval: false,
          examples: ['Create funnel "Lead to Customer"'],
        },
        {
          name: 'track_event',
          description: 'Track a custom analytics event.',
          parameters: [
            { name: 'eventName', type: 'string', description: 'Event name', required: true },
            { name: 'properties', type: 'object', description: 'Event properties', required: false },
            { name: 'contactId', type: 'id', description: 'Associated contact UUID', required: false },
          ],
          requiresApproval: false,
          examples: ['Track event "button_clicked" with properties {button: "signup"}'],
        },
        {
          name: 'export_data',
          description: 'Export analytics data to CSV or JSON.',
          parameters: [
            { name: 'reportId', type: 'id', description: 'Report UUID', required: true },
            { name: 'format', type: 'enum', description: 'Export format', enumValues: ['csv', 'json', 'xlsx'], required: false, default: 'csv' },
          ],
          requiresApproval: false,
          examples: ['Export report RPT-001 to CSV'],
        },
      ],
      queries: [
        {
          name: 'get_dashboard',
          description: 'Full dashboard with all widgets and data.',
          parameters: [
            { name: 'dashboardId', type: 'id', description: 'Dashboard UUID', required: true },
          ],
          returns: 'Dashboard',
          examples: ['Show dashboard DB-001'],
        },
        {
          name: 'get_report',
          description: 'Generated report with data.',
          parameters: [
            { name: 'reportId', type: 'id', description: 'Report UUID', required: true },
          ],
          returns: 'Report',
          examples: ['Show report RPT-001'],
        },
        {
          name: 'get_funnel',
          description: 'Funnel with conversion rates at each step.',
          parameters: [
            { name: 'funnelId', type: 'id', description: 'Funnel UUID', required: true },
          ],
          returns: 'Funnel',
          examples: ['Show funnel FN-001'],
        },
        {
          name: 'get_event_volume',
          description: 'Event counts over time.',
          parameters: [
            { name: 'eventName', type: 'string', description: 'Event name', required: false },
            { name: 'dateFrom', type: 'date', description: 'Start date', required: false },
            { name: 'dateTo', type: 'date', description: 'End date', required: false },
          ],
          returns: 'EventVolume[]',
          examples: ['How many signups this week?'],
        },
        {
          name: 'list_dashboards',
          description: 'List available dashboards.',
          parameters: [],
          returns: 'Dashboard[]',
          examples: ['What dashboards are available?'],
        },
      ],
    },
    // ── 16. FINANCE ─────────────────────────────────────────────────────────
    {
      module: 'finance',
      description: 'Expense tracking, budgeting, P&L, transaction categorization.',
      actions: [
        {
          name: 'record_expense',
          description: 'Record a business expense.',
          parameters: [
            { name: 'amount', type: 'number', description: 'Expense amount', required: true },
            { name: 'category', type: 'enum', description: 'Expense category', enumValues: ['office', 'travel', 'software', 'marketing', 'payroll', 'utilities', 'other'], required: true },
            { name: 'description', type: 'string', description: 'Description', required: true },
            { name: 'date', type: 'date', description: 'Expense date (ISO 8601)', required: false },
            { name: 'receiptUrl', type: 'string', description: 'Receipt image URL', required: false },
          ],
          requiresApproval: false,
          examples: ['Record $500 software expense'],
        },
        {
          name: 'create_budget',
          description: 'Create a budget for a category or period.',
          parameters: [
            { name: 'name', type: 'string', description: 'Budget name', required: true },
            { name: 'amount', type: 'number', description: 'Budget limit', required: true },
            { name: 'category', type: 'enum', description: 'Category', enumValues: ['office', 'travel', 'software', 'marketing', 'payroll', 'utilities', 'other'], required: false },
            { name: 'period', type: 'enum', description: 'Budget period', enumValues: ['weekly', 'monthly', 'quarterly', 'yearly'], required: false, default: 'monthly' },
            { name: 'startDate', type: 'date', description: 'Start date', required: false },
            { name: 'endDate', type: 'date', description: 'End date', required: false },
          ],
          requiresApproval: false,
          examples: ['Create monthly marketing budget of $5,000'],
        },
        {
          name: 'update_budget',
          description: 'Update a budget (amount, period, status).',
          parameters: [
            { name: 'budgetId', type: 'id', description: 'Budget UUID', required: true },
            { name: 'amount', type: 'number', description: 'New amount', required: false },
            { name: 'period', type: 'enum', description: 'New period', enumValues: ['weekly', 'monthly', 'quarterly', 'yearly'], required: false },
            { name: 'isActive', type: 'boolean', description: 'Active status', required: false },
          ],
          requiresApproval: false,
          examples: ['Increase marketing budget to $7,000'],
        },
        {
          name: 'delete_expense',
          description: 'Delete a recorded expense.',
          parameters: [
            { name: 'expenseId', type: 'id', description: 'Expense UUID', required: true },
          ],
          requiresApproval: false,
          examples: ['Delete expense EXP-001'],
        },
        {
          name: 'categorize_transaction',
          description: 'Auto-categorize or manually categorize a transaction.',
          parameters: [
            { name: 'transactionId', type: 'id', description: 'Transaction UUID', required: true },
            { name: 'category', type: 'enum', description: 'Category', enumValues: ['office', 'travel', 'software', 'marketing', 'payroll', 'utilities', 'other'], required: true },
          ],
          requiresApproval: false,
          examples: ['Categorize transaction TXN-001 as software'],
        },
        {
          name: 'generate_pnl',
          description: 'Generate a Profit & Loss statement.',
          parameters: [
            { name: 'dateFrom', type: 'date', description: 'Start date', required: true },
            { name: 'dateTo', type: 'date', description: 'End date', required: true },
            { name: 'format', type: 'enum', description: 'Output format', enumValues: ['summary', 'detailed'], required: false, default: 'summary' },
          ],
          requiresApproval: false,
          examples: ['Generate P&L for Q1 2024'],
        },
      ],
      queries: [
        {
          name: 'get_expenses',
          description: 'List expenses with optional filters.',
          parameters: [
            { name: 'category', type: 'enum', description: 'Filter by category', enumValues: ['office', 'travel', 'software', 'marketing', 'payroll', 'utilities', 'other'], required: false },
            { name: 'dateFrom', type: 'date', description: 'Start date', required: false },
            { name: 'dateTo', type: 'date', description: 'End date', required: false },
            { name: 'limit', type: 'number', description: 'Page size', required: false, default: 50 },
            { name: 'offset', type: 'number', description: 'Page offset', required: false, default: 0 },
          ],
          returns: 'Expense[]',
          examples: ['List expenses for January', 'Show travel expenses'],
        },
        {
          name: 'get_budgets',
          description: 'List budgets with utilization.',
          parameters: [
            { name: 'category', type: 'enum', description: 'Filter by category', enumValues: ['office', 'travel', 'software', 'marketing', 'payroll', 'utilities', 'other'], required: false },
            { name: 'isActive', type: 'boolean', description: 'Only active', required: false },
            { name: 'limit', type: 'number', description: 'Page size', required: false, default: 50 },
            { name: 'offset', type: 'number', description: 'Page offset', required: false, default: 0 },
          ],
          returns: 'Budget[]',
          examples: ['List active budgets', 'Show marketing budget'],
        },
        {
          name: 'get_pnl',
          description: 'Latest P&L statement.',
          parameters: [
            { name: 'dateFrom', type: 'date', description: 'Start date', required: false },
            { name: 'dateTo', type: 'date', description: 'End date', required: false },
            { name: 'format', type: 'enum', description: 'Format', enumValues: ['summary', 'detailed'], required: false, default: 'summary' },
          ],
          returns: 'PnLStatement',
          examples: ['Show P&L for last month'],
        },
        {
          name: 'get_cash_flow',
          description: 'Cash flow summary (inflows, outflows, net).',
          parameters: [
            { name: 'dateFrom', type: 'date', description: 'Start date', required: false },
            { name: 'dateTo', type: 'date', description: 'End date', required: false },
          ],
          returns: 'CashFlow',
          examples: ['Show cash flow for Q1'],
        },
        {
          name: 'get_spending_by_category',
          description: 'Spending breakdown by category.',
          parameters: [
            { name: 'dateFrom', type: 'date', description: 'Start date', required: false },
            { name: 'dateTo', type: 'date', description: 'End date', required: false },
          ],
          returns: 'CategorySpending[]',
          examples: ['Show spending by category'],
        },
      ],
    },
    // ── 17. SETTINGS ────────────────────────────────────────────────────────
    {
      module: 'settings',
      description: 'Business configuration — profile, branding, team, integrations.',
      actions: [
        {
          name: 'update_profile',
          description: 'Update business profile information.',
          parameters: [
            { name: 'name', type: 'string', description: 'Business name', required: false },
            { name: 'timezone', type: 'string', description: 'Timezone', required: false },
            { name: 'currency', type: 'string', description: 'Currency code', required: false },
            { name: 'language', type: 'string', description: 'Language', required: false },
            { name: 'industry', type: 'string', description: 'Industry', required: false },
          ],
          requiresApproval: false,
          examples: ['Update business timezone to America/New_York'],
        },
        {
          name: 'update_branding',
          description: 'Update business branding (logo, colors, fonts).',
          parameters: [
            { name: 'primaryColor', type: 'string', description: 'Primary brand color (hex)', required: false },
            { name: 'logoUrl', type: 'string', description: 'Logo image URL', required: false },
            { name: 'faviconUrl', type: 'string', description: 'Favicon URL', required: false },
          ],
          requiresApproval: false,
          examples: ['Update primary color to #FF5733'],
        },
        {
          name: 'add_team_member',
          description: 'Add a team member to the business.',
          parameters: [
            { name: 'email', type: 'string', description: 'Email address', required: true },
            { name: 'role', type: 'enum', description: 'Role', enumValues: ['admin', 'manager', 'editor', 'viewer'], required: true },
            { name: 'firstName', type: 'string', description: 'First name', required: false },
            { name: 'lastName', type: 'string', description: 'Last name', required: false },
          ],
          requiresApproval: false,
          examples: ['Add jane@example.com as manager'],
        },
        {
          name: 'remove_team_member',
          description: 'Remove a team member.',
          parameters: [
            { name: 'userId', type: 'id', description: 'User UUID', required: true },
          ],
          requiresApproval: true,
          examples: ['Remove user USR-001 from team'],
        },
        {
          name: 'update_role',
          description: 'Update a team member role.',
          parameters: [
            { name: 'userId', type: 'id', description: 'User UUID', required: true },
            { name: 'role', type: 'enum', description: 'New role', enumValues: ['admin', 'manager', 'editor', 'viewer'], required: true },
          ],
          requiresApproval: false,
          examples: ['Change Jane to admin'],
        },
        {
          name: 'configure_integration',
          description: 'Configure a third-party integration.',
          parameters: [
            { name: 'integration', type: 'enum', description: 'Integration name', enumValues: ['stripe', 'paypal', 'zapier', 'slack', 'google', 'hubspot', 'salesforce'], required: true },
            { name: 'config', type: 'object', description: 'Integration config', required: true },
            { name: 'enabled', type: 'boolean', description: 'Enable/disable', required: false, default: true },
          ],
          requiresApproval: false,
          examples: ['Configure Stripe integration with API key'],
        },
      ],
      queries: [
        {
          name: 'get_profile',
          description: 'Business profile information.',
          parameters: [],
          returns: 'BusinessProfile',
          examples: ['Show business profile'],
        },
        {
          name: 'get_team',
          description: 'List team members with roles.',
          parameters: [],
          returns: 'TeamMember[]',
          examples: ['Show team members'],
        },
        {
          name: 'get_integrations',
          description: 'List configured integrations.',
          parameters: [],
          returns: 'Integration[]',
          examples: ['What integrations are configured?'],
        },
        {
          name: 'get_audit_log',
          description: 'Business-level audit log.',
          parameters: [
            { name: 'dateFrom', type: 'date', description: 'Start date', required: false },
            { name: 'dateTo', type: 'date', description: 'End date', required: false },
            { name: 'userId', type: 'id', description: 'Filter by user', required: false },
            { name: 'action', type: 'string', description: 'Filter by action', required: false },
            { name: 'limit', type: 'number', description: 'Page size', required: false, default: 50 },
          ],
          returns: 'AuditEntry[]',
          examples: ['Show audit log', 'What did Jane do yesterday?'],
        },
        {
          name: 'get_usage_stats',
          description: 'Business usage statistics (API calls, storage, seats).',
          parameters: [],
          returns: 'UsageStats',
          examples: ['Show usage stats'],
        },
      ],
    },
    // ── 19. KEYSTORE ────────────────────────────────────────────────────────
    {
      module: 'keystore',
      description: 'Service marketplace for human-powered deliverables — content, design, development, marketing, consulting.',
      actions: [
        {
          name: 'create_service_order',
          description: 'Request a service from the KeyFlowOS marketplace.',
          parameters: [
            { name: 'listingId', type: 'id', description: 'UUID of the service listing', required: true },
            { name: 'pricingTier', type: 'string', description: 'Selected pricing tier name', required: true },
            { name: 'briefAnswers', type: 'array', description: 'Answers to service brief questions', required: false },
            { name: 'selectedAddons', type: 'array', description: 'Selected addon services', required: false },
            { name: 'notes', type: 'string', description: 'Additional notes', required: false },
            { name: 'contactId', type: 'id', description: 'Associated contact UUID', required: false },
          ],
          requiresApproval: false,
          examples: ['Order a blog post from the content creation service', 'Request logo design from the marketplace'],
        },
        {
          name: 'cancel_service_order',
          description: 'Cancel a pending service order.',
          parameters: [
            { name: 'orderId', type: 'id', description: 'UUID of the order', required: true },
            { name: 'reason', type: 'string', description: 'Cancellation reason', required: false },
          ],
          requiresApproval: false,
          examples: ['Cancel my blog post order', 'Withdraw the design request'],
        },
        {
          name: 'accept_service_quote',
          description: 'Accept a quoted price for a service order.',
          parameters: [
            { name: 'orderId', type: 'id', description: 'UUID of the order', required: true },
            { name: 'notes', type: 'string', description: 'Optional notes', required: false },
          ],
          requiresApproval: false,
          examples: ['Accept the quote for my website project', 'Approve the content creation price'],
        },
        {
          name: 'rate_service_order',
          description: 'Rate a completed service delivery.',
          parameters: [
            { name: 'orderId', type: 'id', description: 'UUID of the order', required: true },
            { name: 'rating', type: 'number', description: 'Rating 1-5', required: true },
            { name: 'review', type: 'string', description: 'Written review', required: false },
          ],
          requiresApproval: false,
          examples: ['Rate my blog post delivery 5 stars', 'Leave a review for the logo design'],
        },
        {
          name: 'send_order_message',
          description: 'Send a message on a service order thread.',
          parameters: [
            { name: 'orderId', type: 'id', description: 'UUID of the order', required: true },
            { name: 'message', type: 'string', description: 'Message text', required: true },
            { name: 'attachments', type: 'array', description: 'File attachments', required: false },
          ],
          requiresApproval: false,
          examples: ['Send a message on order abc123', 'Ask about the delivery timeline'],
        },
        {
          name: 'list_service_listings',
          description: 'Browse available service listings.',
          parameters: [
            { name: 'categoryId', type: 'id', description: 'Filter by category', required: false },
          ],
          requiresApproval: false,
          examples: ['What services are available?', 'Show me content creation services'],
        },
        {
          name: 'get_service_categories',
          description: 'List all service categories.',
          parameters: [],
          requiresApproval: false,
          examples: ['What service categories do you have?', 'Show marketplace categories'],
        },
      ],
      queries: [
        {
          name: 'get_user_orders',
          description: 'List service orders for the current user.',
          parameters: [],
          returns: 'KeystoreServiceOrder[]',
          examples: ['Show my orders', 'What services have I requested?'],
        },
        {
          name: 'get_order_details',
          description: 'Get detailed information about a service order.',
          parameters: [
            { name: 'orderId', type: 'id', description: 'UUID of the order', required: true },
          ],
          returns: 'KeystoreServiceOrder with messages',
          examples: ['Show details of order abc123', 'What is the status of my blog post order?'],
        },
        {
          name: 'get_order_stats',
          description: 'Get marketplace statistics.',
          parameters: [],
          returns: 'OrderStats',
          examples: ['Show marketplace stats', 'How many orders have been placed?'],
        },
        {
          name: 'get_service_categories',
          description: 'List all active service categories.',
          parameters: [],
          returns: 'KeystoreServiceCategory[]',
          examples: ['What categories are available?', 'List service categories'],
        },
        {
          name: 'list_service_listings',
          description: 'Browse available service listings.',
          parameters: [
            { name: 'categoryId', type: 'id', description: 'Filter by category', required: false },
          ],
          returns: 'KeystoreServiceListing[]',
          examples: ['What services are offered?', 'Show design services'],
        },
      ],
    },

    // ── 18. ACTIVITY ────────────────────────────────────────────────────────
    {
      module: 'activity',
      description: 'Activity logging, audit trails, recent actions, and system events.',
      actions: [
        {
          name: 'log_activity',
          description: 'Record a custom activity event.',
          parameters: [
            { name: 'entityType', type: 'enum', description: 'Entity type', enumValues: ['contact', 'invoice', 'booking', 'project', 'task', 'automation', 'user'], required: true },
            { name: 'entityId', type: 'id', description: 'Entity UUID', required: true },
            { name: 'action', type: 'string', description: 'Action verb', required: true },
            { name: 'description', type: 'string', description: 'Human-readable description', required: false },
            { name: 'metadata', type: 'object', description: 'Extra context', required: false },
          ],
          requiresApproval: false,
          examples: ['Log that invoice INV-001 was paid'],
        },
        {
          name: 'log_bulk_activity',
          description: 'Record multiple activity events in a batch.',
          parameters: [
            { name: 'events', type: 'array', description: 'Activity events [{entityType, entityId, action, description?}]', required: true },
          ],
          requiresApproval: false,
          examples: ['Bulk log 50 contact imports'],
        },
        {
          name: 'create_audit_note',
          description: 'Add a manual audit note to an entity timeline.',
          parameters: [
            { name: 'entityType', type: 'enum', description: 'Entity type', enumValues: ['contact', 'invoice', 'booking', 'project', 'task', 'automation', 'user'], required: true },
            { name: 'entityId', type: 'id', description: 'Entity UUID', required: true },
            { name: 'note', type: 'string', description: 'Audit note text', required: true },
            { name: 'importance', type: 'enum', description: 'Importance level', enumValues: ['low', 'medium', 'high', 'critical'], required: false, default: 'medium' },
          ],
          requiresApproval: false,
          examples: ['Add audit note: manual data correction performed'],
        },
        {
          name: 'export_audit_log',
          description: 'Export the audit log to CSV or JSON.',
          parameters: [
            { name: 'dateFrom', type: 'date', description: 'Start date', required: true },
            { name: 'dateTo', type: 'date', description: 'End date', required: true },
            { name: 'entityType', type: 'enum', description: 'Filter by entity', enumValues: ['contact', 'invoice', 'booking', 'project', 'task', 'automation', 'user'], required: false },
            { name: 'format', type: 'enum', description: 'Export format', enumValues: ['csv', 'json'], required: false, default: 'csv' },
          ],
          requiresApproval: false,
          examples: ['Export audit log for January to CSV'],
        },
        {
          name: 'delete_old_logs',
          description: 'Purge activity logs older than a retention period.',
          parameters: [
            { name: 'olderThanDays', type: 'number', description: 'Retention in days', required: true },
            { name: 'entityType', type: 'enum', description: 'Filter by entity', enumValues: ['contact', 'invoice', 'booking', 'project', 'task', 'automation', 'user'], required: false },
          ],
          requiresApproval: true,
          examples: ['Delete logs older than 365 days'],
        },
      ],
      queries: [
        {
          name: 'get_activity',
          description: 'Query activity log with filters.',
          parameters: [
            { name: 'entityType', type: 'enum', description: 'Filter by entity', enumValues: ['contact', 'invoice', 'booking', 'project', 'task', 'automation', 'user'], required: false },
            { name: 'entityId', type: 'id', description: 'Filter by entity ID', required: false },
            { name: 'userId', type: 'id', description: 'Filter by actor', required: false },
            { name: 'from', type: 'date', description: 'Start date', required: false },
            { name: 'to', type: 'date', description: 'End date', required: false },
            { name: 'limit', type: 'number', description: 'Max results', required: false, default: 50 },
          ],
          returns: 'ActivityEntry[]',
          examples: ['Show activity log', 'What happened with contact abc?'],
        },
        {
          name: 'get_recent',
          description: 'Fetch the most recent activity across the business.',
          parameters: [
            { name: 'limit', type: 'number', description: 'Max results', required: false, default: 20 },
            { name: 'entityType', type: 'enum', description: 'Filter by entity', enumValues: ['contact', 'invoice', 'booking', 'project', 'task', 'automation', 'user'], required: false },
          ],
          returns: 'ActivityEntry[]',
          examples: ['What happened recently?', 'Show recent activity'],
        },
        {
          name: 'get_activity_stats',
          description: 'Aggregate activity statistics.',
          parameters: [
            { name: 'from', type: 'date', description: 'Start date', required: true },
            { name: 'to', type: 'date', description: 'End date', required: true },
            { name: 'groupBy', type: 'enum', description: 'Grouping', enumValues: ['hour', 'day', 'week', 'month'], required: false, default: 'day' },
          ],
          returns: 'ActivityStats',
          examples: ['Show activity stats', 'How active was the team this week?'],
        },
        {
          name: 'get_user_activity',
          description: 'Activity performed by a specific user.',
          parameters: [
            { name: 'userId', type: 'id', description: 'User UUID', required: true },
            { name: 'from', type: 'date', description: 'Start date', required: false },
            { name: 'to', type: 'date', description: 'End date', required: false },
            { name: 'limit', type: 'number', description: 'Max results', required: false, default: 50 },
          ],
          returns: 'ActivityEntry[]',
          examples: ['What did Jane do today?', 'Show user activity'],
        },
      ],
    },
  ];

  // ═══════════════════════════════════════════════════════════════════════════
  //  2. PUBLIC API — Capabilities
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Return every registered capability across all 18 modules.
   */
  getAllCapabilities(): ModuleCapability[] {
    return this.MODULE_CAPABILITIES;
  }

  /**
   * Return capabilities for a subset of modules.
   */
  getCapabilities(modules: ModuleName[]): ModuleCapability[] {
    return this.MODULE_CAPABILITIES.filter((c) => modules.includes(c.module));
  }

  /**
   * Format the full capability registry as a human-readable text block
   * suitable for injection into an AI system-prompt context window.
   */
  formatCapabilitiesForPrompt(): string {
    const lines: string[] = [];
    lines.push('=== KeyFlowOS Module Capabilities ===');
    lines.push('');

    for (const cap of this.MODULE_CAPABILITIES) {