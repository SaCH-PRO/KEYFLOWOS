/**
 * KEY Universal Connector Service — Keystore Integration Edition
 * ----------------------------------------------------------------
 * The single integration backbone that routes AI-generated commands to every
 * KeyFlowOS module.  Now 19 modules with 150+ actions and 90+ queries.
 * 
 * v2 — Keystore Integration: Added Keystore module (service marketplace)
 *       as the 19th connected module with 7 actions and 5 queries.
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
  //  CONSTRUCTOR — Inject all 14 KeyFlowOS module services
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
  //  1. CAPABILITY REGISTRY — 19 modules × (5-12 actions + 3-5 queries)
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
          examples: ['Move John to customer', 'Change status of abc123 to prospect'],
        },
        {
          name: 'log_event',
          description: 'Log a custom event against a contact timeline.',
          parameters: [
            { name: 'contactId', type: 'id', description: 'UUID of the contact', required: true },
            { name: 'eventType', type: 'string', description: 'Machine event key', required: true },
            { name: 'metadata', type: 'object', description: 'Arbitrary event payload', required: false },
          ],
          requiresApproval: false,
          examples: ['Log page_view event for contact abc123', 'Record purchase event for John'],
        },
        {
          name: 'merge_contacts',
          description: 'Merge two duplicate contacts into one master record.',
          parameters: [
            { name: 'masterContactId', type: 'id', description: 'UUID to keep', required: true },
            { name: 'duplicateContactId', type: 'id', description: 'UUID to merge in', required: true },
          ],
          requiresApproval: true,
          examples: ['Merge contact abc into def', 'Combine duplicate John Smith records'],
        },
      ],
      queries: [
        {
          name: 'get_contact_timeline',
          description: 'Retrieve chronological activity timeline for a contact.',
          parameters: [
            { name: 'contactId', type: 'id', description: 'UUID of the contact', required: true },
            { name: 'limit', type: 'number', description: 'Events to fetch', required: false, default: 50 },
          ],
          returns: 'TimelineEvent[]',
          examples: ['Show timeline for contact abc123', 'What happened with John last week?'],
        },
        {
          name: 'count_contacts',
          description: 'Count contacts matching a filter.',
          parameters: [
            { name: 'status', type: 'enum', description: 'Filter by status', enumValues: ['lead', 'prospect', 'customer', 'churned', 'partner'], required: false },
            { name: 'tag', type: 'string', description: 'Filter by tag', required: false },
          ],
          returns: 'number',
          examples: ['How many customers do we have?', 'Count leads tagged VIP'],
        },
        {
          name: 'get_tasks',
          description: 'List open tasks for a contact or across the business.',
          parameters: [
            { name: 'contactId', type: 'id', description: 'UUID of the contact (omit for all)', required: false },
            { name: 'assignedTo', type: 'id', description: 'Filter by assignee', required: false },
            { name: 'priority', type: 'enum', description: 'Filter by priority', enumValues: ['low', 'medium', 'high', 'urgent'], required: false },
            { name: 'status', type: 'enum', description: 'Task status', enumValues: ['open', 'completed', 'overdue'], required: false, default: 'open' },
          ],
          returns: 'Task[]',
          examples: ['What tasks are due today?', 'List open tasks for John'],
        },
        {
          name: 'get_recent_contacts',
          description: 'Fetch contacts created or updated recently.',
          parameters: [
            { name: 'since', type: 'date', description: 'ISO date cutoff', required: false },
            { name: 'limit', type: 'number', description: 'Max results', required: false, default: 20 },
          ],
          returns: 'Contact[]',
          examples: ['Show recently added contacts', 'Who signed up this week?'],
        },
        {
          name: 'search_contacts',
          description: 'Full-text search across contact fields.',
          parameters: [
            { name: 'query', type: 'string', description: 'Search string', required: true },
            { name: 'limit', type: 'number', description: 'Max results', required: false, default: 20 },
          ],
          returns: 'Contact[]',
          examples: ['Find contacts named Acme', 'Search for anyone with gmail'],
        },
      ],
    },

    // ── 2. COMMERCE ─────────────────────────────────────────────────────────
    {
      module: 'commerce',
      description: 'Invoicing, products, orders, quotes, payments, and revenue tracking.',
      actions: [
        {
          name: 'create_invoice',
          description: 'Generate a new invoice for a contact.',
          parameters: [
            { name: 'contactId', type: 'id', description: 'UUID of the billed contact', required: true },
            { name: 'items', type: 'array', description: 'Line items', required: true },
            { name: 'dueDate', type: 'date', description: 'Payment due date', required: false },
            { name: 'notes', type: 'string', description: 'Invoice notes', required: false },
            { name: 'sendImmediately', type: 'boolean', description: 'Auto-send after creation', required: false, default: false },
          ],
          requiresApproval: false,
          examples: ['Invoice John $500 for consulting', 'Create invoice with 3 line items for Acme Corp'],
        },
        {
          name: 'send_invoice',
          description: 'Deliver an existing invoice via email.',
          parameters: [
            { name: 'invoiceId', type: 'id', description: 'UUID of the invoice', required: true },
            { name: 'message', type: 'string', description: 'Custom email body', required: false },
          ],
          requiresApproval: false,
          examples: ['Send invoice INV-001 to John', 'Email the latest invoice'],
        },
        {
          name: 'get_invoice',
          description: 'Retrieve a single invoice by ID.',
          parameters: [
            { name: 'invoiceId', type: 'id', description: 'UUID of the invoice', required: true },
          ],
          requiresApproval: false,
          examples: ['Show invoice INV-001', 'Get invoice details for abc123'],
        },
        {
          name: 'list_invoices',
          description: 'List invoices with optional filters.',
          parameters: [
            { name: 'contactId', type: 'id', description: 'Filter by contact', required: false },
            { name: 'status', type: 'enum', description: 'Invoice status', enumValues: ['draft', 'sent', 'paid', 'overdue', 'cancelled'], required: false },
            { name: 'limit', type: 'number', description: 'Page size', required: false, default: 50 },
          ],
          requiresApproval: false,
          examples: ['List overdue invoices', 'Show all invoices for John', 'Get last 10 invoices'],
        },
        {
          name: 'create_product',
          description: 'Add a new product or service to the catalog.',
          parameters: [
            { name: 'name', type: 'string', description: 'Product name', required: true },
            { name: 'description', type: 'string', description: 'Product description', required: false },
            { name: 'price', type: 'number', description: 'Unit price', required: true },
            { name: 'sku', type: 'string', description: 'Stock-keeping unit', required: false },
            { name: 'taxable', type: 'boolean', description: 'Subject to tax', required: false, default: true },
          ],
          requiresApproval: false,
          examples: ['Add product "Premium Plan" at $99/mo', 'Create service "Consulting Hour"'],
        },
        {
          name: 'get_product',
          description: 'Fetch a product by ID or SKU.',
          parameters: [
            { name: 'productId', type: 'id', description: 'UUID of the product', required: false },
            { name: 'sku', type: 'string', description: 'SKU code', required: false },
          ],
          requiresApproval: false,
          examples: ['Get product abc123', 'Look up SKU PREMIUM-001'],
        },
        {
          name: 'create_order',
          description: 'Create a new sales order.',
          parameters: [
            { name: 'contactId', type: 'id', description: 'UUID of the buyer', required: true },
            { name: 'items', type: 'array', description: 'Line items with productId + qty', required: true },
            { name: 'notes', type: 'string', description: 'Order notes', required: false },
          ],
          requiresApproval: false,
          examples: ['Create order for John with 2x Premium Plan'],
        },
        {
          name: 'process_payment',
          description: 'Record or process a payment against an invoice.',
          parameters: [
            { name: 'invoiceId', type: 'id', description: 'UUID of the invoice', required: true },
            { name: 'amount', type: 'number', description: 'Payment amount', required: true },
            { name: 'method', type: 'enum', description: 'Payment method', enumValues: ['card', 'bank_transfer', 'cash', 'check', 'other'], required: true },
            { name: 'reference', type: 'string', description: 'Transaction reference', required: false },
          ],
          requiresApproval: true,
          examples: ['Record $500 payment on invoice INV-001', 'Process payment for invoice abc'],
        },
        {
          name: 'create_quote',
          description: 'Generate a price quote for a prospect.',
          parameters: [
            { name: 'contactId', type: 'id', description: 'UUID of the prospect', required: true },
            { name: 'items', type: 'array', description: 'Line items', required: true },
            { name: 'validUntil', type: 'date', description: 'Quote expiry date', required: false },
            { name: 'notes', type: 'string', description: 'Quote notes', required: false },
          ],
          requiresApproval: false,
          examples: ['Create a quote for John: 10 hrs at $150/hr'],
        },
        {
          name: 'send_quote',
          description: 'Email a quote to the prospect.',
          parameters: [
            { name: 'quoteId', type: 'id', description: 'UUID of the quote', required: true },
            { name: 'message', type: 'string', description: 'Email body', required: false },
          ],
          requiresApproval: false,
          examples: ['Send quote Q-001 to John', 'Email the quote we prepared'],
        },
      ],
      queries: [
        {
          name: 'get_revenue_summary',
          description: 'Aggregate revenue for a date range.',
          parameters: [
            { name: 'from', type: 'date', description: 'Start date (inclusive)', required: true },
            { name: 'to', type: 'date', description: 'End date (inclusive)', required: true },
          ],
          returns: 'RevenueSummary',
          examples: ['What was our revenue this month?', 'Show revenue for Q1'],
        },
        {
          name: 'get_outstanding_invoices',
          description: 'Fetch unpaid or overdue invoices.',
          parameters: [
            { name: 'contactId', type: 'id', description: 'Filter by contact', required: false },
            { name: 'overdueOnly', type: 'boolean', description: 'Only overdue', required: false, default: false },
          ],
          returns: 'Invoice[]',
          examples: ['What invoices are overdue?', 'Show unpaid invoices for John'],
        },
        {
          name: 'get_product_catalog',
          description: 'List all active products and services.',
          parameters: [
            { name: 'search', type: 'string', description: 'Name filter', required: false },
          ],
          returns: 'Product[]',
          examples: ['List all products', 'What services do we offer?'],
        },
        {
          name: 'get_payment_history',
          description: 'Retrieve recorded payments for a contact or invoice.',
          parameters: [
            { name: 'contactId', type: 'id', description: 'Filter by contact', required: false },
            { name: 'invoiceId', type: 'id', description: 'Filter by invoice', required: false },
            { name: 'limit', type: 'number', description: 'Max results', required: false, default: 50 },
          ],
          returns: 'Payment[]',
          examples: ['Show payment history for John', 'List payments on invoice INV-001'],
        },
        {
          name: 'get_quote_status',
          description: 'Check the status of a quote.',
          parameters: [
            { name: 'quoteId', type: 'id', description: 'UUID of the quote', required: true },
          ],
          returns: 'Quote',
          examples: ['Has quote Q-001 been viewed?', 'Status of our proposal'],
        },
      ],
    },

    // ── 3. BOOKINGS ─────────────────────────────────────────────────────────
    {
      module: 'bookings',
      description: 'Appointment scheduling, availability management, and service catalog.',
      actions: [
        {
          name: 'create_booking',
          description: 'Schedule a new appointment.',
          parameters: [
            { name: 'contactId', type: 'id', description: 'UUID of the client', required: true },
            { name: 'serviceId', type: 'id', description: 'UUID of the service', required: true },
            { name: 'startTime', type: 'date', description: 'ISO start datetime', required: true },
            { name: 'endTime', type: 'date', description: 'ISO end datetime', required: false },
            { name: 'staffId', type: 'id', description: 'Assigned staff member', required: false },
            { name: 'notes', type: 'string', description: 'Booking notes', required: false },
          ],
          requiresApproval: false,
          examples: ['Book John for a haircut tomorrow at 2pm', 'Schedule consultation with Jane on Friday'],
        },
        {
          name: 'cancel_booking',
          description: 'Cancel an existing appointment.',
          parameters: [
            { name: 'bookingId', type: 'id', description: 'UUID of the booking', required: true },
            { name: 'reason', type: 'string', description: 'Cancellation reason', required: false },
            { name: 'notifyClient', type: 'boolean', description: 'Send cancellation notice', required: false, default: true },
          ],
          requiresApproval: false,
          examples: ['Cancel booking abc123', 'Cancel my 3pm appointment'],
        },
        {
          name: 'reschedule_booking',
          description: 'Move an appointment to a new time slot.',
          parameters: [
            { name: 'bookingId', type: 'id', description: 'UUID of the booking', required: true },
            { name: 'newStartTime', type: 'date', description: 'New ISO start datetime', required: true },
            { name: 'newEndTime', type: 'date', description: 'New ISO end datetime', required: false },
            { name: 'notifyClient', type: 'boolean', description: 'Notify client of change', required: false, default: true },
          ],
          requiresApproval: false,
          examples: ['Reschedule booking abc to Thursday 10am', 'Move my appointment to next week'],
        },
        {
          name: 'confirm_booking',
          description: 'Confirm a pending booking.',
          parameters: [
            { name: 'bookingId', type: 'id', description: 'UUID of the booking', required: true },
            { name: 'sendConfirmation', type: 'boolean', description: 'Email confirmation', required: false, default: true },
          ],
          requiresApproval: false,
          examples: ['Confirm booking abc123', 'Approve the pending appointment'],
        },
        {
          name: 'add_service',
          description: 'Add a new bookable service.',
          parameters: [
            { name: 'name', type: 'string', description: 'Service name', required: true },
            { name: 'duration', type: 'number', description: 'Duration in minutes', required: true },
            { name: 'price', type: 'number', description: 'Service price', required: false },
            { name: 'description', type: 'string', description: 'Service description', required: false },
            { name: 'buffer', type: 'number', description: 'Buffer time in minutes', required: false, default: 0 },
          ],
          requiresApproval: false,
          examples: ['Add service "Deep Tissue Massage" 60 min', 'Create 30-min consultation service'],
        },
        {
          name: 'update_service',
          description: 'Modify an existing service.',
          parameters: [
            { name: 'serviceId', type: 'id', description: 'UUID of the service', required: true },
            { name: 'name', type: 'string', description: 'New name', required: false },
            { name: 'duration', type: 'number', description: 'New duration (min)', required: false },
            { name: 'price', type: 'number', description: 'New price', required: false },
            { name: 'active', type: 'boolean', description: 'Enable/disable', required: false },
          ],
          requiresApproval: false,
          examples: ['Update service abc123 price to $75', 'Change massage duration to 90 min'],
        },
        {
          name: 'set_availability',
          description: 'Define when a staff member or resource is available.',
          parameters: [
            { name: 'staffId', type: 'id', description: 'UUID of staff member', required: true },
            { name: 'dayOfWeek', type: 'enum', description: 'Day', enumValues: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'], required: true },
            { name: 'startTime', type: 'string', description: 'HH:MM open time', required: true },
            { name: 'endTime', type: 'string', description: 'HH:MM close time', required: true },
          ],
          requiresApproval: false,
          examples: ['Set Dr. Smith availability Mon-Fri 9-5'],
        },
        {
          name: 'block_time',
          description: 'Block out time (break, time-off, buffer).',
          parameters: [
            { name: 'staffId', type: 'id', description: 'UUID of staff member', required: true },
            { name: 'startTime', type: 'date', description: 'ISO start', required: true },
            { name: 'endTime', type: 'date', description: 'ISO end', required: true },
            { name: 'reason', type: 'string', description: 'Block reason', required: false },
          ],
          requiresApproval: false,
          examples: ['Block lunch break 12-1pm for Dr. Smith'],
        },
      ],
      queries: [
        {
          name: 'get_availability',
          description: 'Find open appointment slots for a service and date range.',
          parameters: [
            { name: 'serviceId', type: 'id', description: 'UUID of the service', required: true },
            { name: 'from', type: 'date', description: 'Start date', required: true },
            { name: 'to', type: 'date', description: 'End date', required: true },
            { name: 'staffId', type: 'id', description: 'Preferred staff (optional)', required: false },
          ],
          returns: 'AvailabilitySlot[]',
          examples: ['When is Dr. Smith free next week?', 'Show availability for haircuts on Friday'],
        },
        {
          name: 'get_upcoming_bookings',
          description: 'List confirmed bookings in a date range.',
          parameters: [
            { name: 'from', type: 'date', description: 'Start date', required: false },
            { name: 'to', type: 'date', description: 'End date', required: false },
            { name: 'contactId', type: 'id', description: 'Filter by client', required: false },
            { name: 'staffId', type: 'id', description: 'Filter by staff', required: false },
            { name: 'limit', type: 'number', description: 'Max results', required: false, default: 50 },
          ],
          returns: 'Booking[]',
          examples: ['What appointments do we have today?', 'Show bookings for John'],
        },
        {
          name: 'get_services',
          description: 'List all bookable services.',
          parameters: [
            { name: 'activeOnly', type: 'boolean', description: 'Only active services', required: false, default: true },
          ],
          returns: 'Service[]',
          examples: ['What services do we offer?', 'List all active services'],
        },
        {
          name: 'get_staff_schedule',
          description: 'Retrieve schedule for a staff member.',
          parameters: [
            { name: 'staffId', type: 'id', description: 'UUID of staff', required: true },
            { name: 'date', type: 'date', description: 'Date to retrieve', required: true },
          ],
          returns: 'ScheduleEntry[]',
          examples: ['What does Dr. Smith schedule look like today?'],
        },
      ],
    },

    // ── 4. CONTENT ──────────────────────────────────────────────────────────
    {
      module: 'content',
      description: 'Blog posts, social publishing, email campaigns, SEO, and content calendars.',
      actions: [
        {
          name: 'create_post',
          description: 'Create a new content post or article.',
          parameters: [
            { name: 'title', type: 'string', description: 'Post title', required: true },
            { name: 'body', type: 'string', description: 'Post body (Markdown/HTML)', required: true },
            { name: 'platform', type: 'enum', description: 'Target platform', enumValues: ['blog', 'facebook', 'instagram', 'linkedin', 'twitter'], required: false, default: 'blog' },
            { name: 'status', type: 'enum', description: 'Publication status', enumValues: ['draft', 'scheduled', 'published'], required: false, default: 'draft' },
            { name: 'scheduledAt', type: 'date', description: 'Publish date-time', required: false },
            { name: 'tags', type: 'array', description: 'Content tags', required: false },
            { name: 'seoTitle', type: 'string', description: 'SEO meta title', required: false },
            { name: 'seoDescription', type: 'string', description: 'SEO meta description', required: false },
          ],
          requiresApproval: false,
          examples: ['Write a blog post about productivity tips', 'Create a Facebook post announcing our sale'],
        },
        {
          name: 'schedule_post',
          description: 'Schedule an existing draft post for future publication.',
          parameters: [
            { name: 'postId', type: 'id', description: 'UUID of the post', required: true },
            { name: 'scheduledAt', type: 'date', description: 'ISO publish datetime', required: true },
            { name: 'platform', type: 'enum', description: 'Override platform', enumValues: ['blog', 'facebook', 'instagram', 'linkedin', 'twitter'], required: false },
          ],
          requiresApproval: false,
          examples: ['Schedule post abc123 for Friday 9am', 'Publish the draft tomorrow morning'],
        },
        {
          name: 'publish_post',
          description: 'Immediately publish a draft post.',
          parameters: [
            { name: 'postId', type: 'id', description: 'UUID of the post', required: true },
          ],
          requiresApproval: false,
          examples: ['Publish post abc123 now', 'Go live with the announcement'],
        },
        {
          name: 'create_campaign',
          description: 'Create an email marketing campaign.',
          parameters: [
            { name: 'name', type: 'string', description: 'Campaign name', required: true },
            { name: 'subject', type: 'string', description: 'Email subject line', required: true },
            { name: 'body', type: 'string', description: 'Email HTML body', required: true },
            { name: 'segment', type: 'string', description: 'Target segment/tag', required: false },
            { name: 'scheduledAt', type: 'date', description: 'Send date-time', required: false },
          ],
          requiresApproval: false,
          examples: ['Create campaign "Summer Sale"', 'Build newsletter for this week'],
        },
        {
          name: 'send_campaign',
          description: 'Dispatch an email campaign to its segment.',
          parameters: [
            { name: 'campaignId', type: 'id', description: 'UUID of the campaign', required: true },
            { name: 'testOnly', type: 'boolean', description: 'Send test to preview list', required: false, default: false },
          ],
          requiresApproval: true,
          examples: ['Send campaign abc123', 'Launch the summer sale email'],
        },
        {
          name: 'generate_content',
          description: 'Use AI to generate a content draft.',
          parameters: [
            { name: 'topic', type: 'string', description: 'Content topic or prompt', required: true },
            { name: 'platform', type: 'enum', description: 'Target platform', enumValues: ['blog', 'facebook', 'instagram', 'linkedin', 'twitter', 'email'], required: true },
            { name: 'tone', type: 'enum', description: 'Writing tone', enumValues: ['professional', 'casual', 'witty', 'persuasive', 'educational'], required: false, default: 'professional' },
            { name: 'length', type: 'enum', description: 'Approximate length', enumValues: ['short', 'medium', 'long'], required: false, default: 'medium' },
          ],
          requiresApproval: false,
          examples: ['Generate a blog post about AI in small business', 'Write a casual Instagram caption about our launch'],
        },
        {
          name: 'update_post',
          description: 'Edit an existing post.',
          parameters: [
            { name: 'postId', type: 'id', description: 'UUID of the post', required: true },
            { name: 'title', type: 'string', description: 'New title', required: false },
            { name: 'body', type: 'string', description: 'New body', required: false },
            { name: 'status', type: 'enum', description: 'New status', enumValues: ['draft', 'scheduled', 'published'], required: false },
          ],
          requiresApproval: false,
          examples: ['Update post abc123 title', 'Edit the blog draft'],
        },
        {
          name: 'delete_post',
          description: 'Remove a post permanently.',
          parameters: [
            { name: 'postId', type: 'id', description: 'UUID of the post', required: true },
          ],
          requiresApproval: true,
          examples: ['Delete post abc123'],
        },
      ],
      queries: [
        {
          name: 'get_content_calendar',
          description: 'Retrieve scheduled posts for a date range.',
          parameters: [
            { name: 'from', type: 'date', description: 'Start date', required: true },
            { name: 'to', type: 'date', description: 'End date', required: true },
            { name: 'platform', type: 'enum', description: 'Filter by platform', enumValues: ['blog', 'facebook', 'instagram', 'linkedin', 'twitter'], required: false },
          ],
          returns: 'Post[]',
          examples: ['What content is scheduled this week?', 'Show me the social calendar'],
        },
        {
          name: 'get_campaign_performance',
          description: 'Fetch open/click metrics for a campaign.',
          parameters: [
            { name: 'campaignId', type: 'id', description: 'UUID of the campaign', required: true },
          ],
          returns: 'CampaignMetrics',
          examples: ['How did the summer sale campaign perform?', 'Show campaign stats'],
        },
        {
          name: 'get_recent_posts',
          description: 'List recently created or published posts.',
          parameters: [
            { name: 'status', type: 'enum', description: 'Filter by status', enumValues: ['draft', 'scheduled', 'published'], required: false },
            { name: 'platform', type: 'enum', description: 'Filter by platform', enumValues: ['blog', 'facebook', 'instagram', 'linkedin', 'twitter'], required: false },
            { name: 'limit', type: 'number', description: 'Max results', required: false, default: 20 },
          ],
          returns: 'Post[]',
          examples: ['Show recent blog posts', 'List published Instagram posts'],
        },
        {
          name: 'get_drafts',
          description: 'List all unpublished draft posts.',
          parameters: [
            { name: 'platform', type: 'enum', description: 'Filter by platform', enumValues: ['blog', 'facebook', 'instagram', 'linkedin', 'twitter'], required: false },
            { name: 'limit', type: 'number', description: 'Max results', required: false, default: 50 },
          ],
          returns: 'Post[]',
          examples: ['Show my drafts', 'List unfinished blog posts'],
        },
      ],
    },

    // ── 5. COMMUNICATIONS ───────────────────────────────────────────────────
    {
      module: 'communications',
      description: 'SMS, email, WhatsApp, templates, conversations, and delivery tracking.',
      actions: [
        {
          name: 'send_message',
          description: 'Send a message via the chosen channel.',
          parameters: [
            { name: 'contactId', type: 'id', description: 'UUID of the recipient', required: true },
            { name: 'channel', type: 'enum', description: 'Delivery channel', enumValues: ['sms', 'email', 'whatsapp'], required: true },
            { name: 'body', type: 'string', description: 'Message body', required: true },
            { name: 'templateId', type: 'id', description: 'Template to use', required: false },
            { name: 'attachments', type: 'array', description: 'File URLs', required: false },
            { name: 'scheduledAt', type: 'date', description: 'Deferred send time', required: false },
          ],
          requiresApproval: false,
          examples: ['Send SMS to John: Your appointment is confirmed', 'Email Jane the invoice'],
        },
        {
          name: 'send_whatsapp',
          description: 'Send a WhatsApp message to a contact.',
          parameters: [
            { name: 'contactId', type: 'id', description: 'UUID of the recipient', required: true },
            { name: 'body', type: 'string', description: 'Message text', required: true },
            { name: 'templateId', type: 'id', description: 'WhatsApp template ID', required: false },
          ],
          requiresApproval: false,
          examples: ['WhatsApp John his tracking number', 'Send Jane a reminder on WhatsApp'],
        },
        {
          name: 'send_email',
          description: 'Send an email to a contact.',
          parameters: [
            { name: 'contactId', type: 'id', description: 'UUID of the recipient', required: true },
            { name: 'subject', type: 'string', description: 'Email subject', required: true },
            { name: 'body', type: 'string', description: 'Email HTML/text body', required: true },
            { name: 'attachments', type: 'array', description: 'File URLs', required: false },
          ],
          requiresApproval: false,
          examples: ['Email John the proposal', 'Send welcome email to Jane'],
        },
        {
          name: 'create_template',
          description: 'Create a reusable message template.',
          parameters: [
            { name: 'name', type: 'string', description: 'Template name', required: true },
            { name: 'channel', type: 'enum', description: 'Channel', enumValues: ['sms', 'email', 'whatsapp'], required: true },
            { name: 'subject', type: 'string', description: 'Subject line (email only)', required: false },
            { name: 'body', type: 'string', description: 'Template body with {{placeholders}}', required: true },
            { name: 'variables', type: 'array', description: 'Variable names used', required: false },
          ],
          requiresApproval: false,
          examples: ['Create SMS template "appointment_reminder"', 'Build email template for invoices'],
        },
        {
          name: 'get_conversation',
          description: 'Retrieve message thread with a contact.',
          parameters: [
            { name: 'contactId', type: 'id', description: 'UUID of the contact', required: true },
            { name: 'channel', type: 'enum', description: 'Filter by channel', enumValues: ['sms', 'email', 'whatsapp', 'all'], required: false, default: 'all' },
            { name: 'limit', type: 'number', description: 'Messages to fetch', required: false, default: 50 },
          ],
          requiresApproval: false,
          examples: ['Show conversation with John', 'Get WhatsApp history with Jane'],
        },
        {
          name: 'send_broadcast',
          description: 'Send a message to a segment or tag group.',
          parameters: [
            { name: 'segment', type: 'string', description: 'Tag or segment name', required: true },
            { name: 'channel', type: 'enum', description: 'Channel', enumValues: ['sms', 'email', 'whatsapp'], required: true },
            { name: 'body', type: 'string', description: 'Message body', required: true },
            { name: 'templateId', type: 'id', description: 'Template', required: false },
          ],
          requiresApproval: true,
          examples: ['Broadcast sale announcement to all customers', 'Send reminder SMS to VIP tag'],
        },
        {
          name: 'mark_read',
          description: 'Mark conversation messages as read.',
          parameters: [
            { name: 'conversationId', type: 'id', description: 'UUID of the conversation', required: true },
          ],
          requiresApproval: false,
          examples: ['Mark conversation abc123 as read'],
        },
        {
          name: 'archive_conversation',
          description: 'Archive a completed conversation.',
          parameters: [
            { name: 'conversationId', type: 'id', description: 'UUID of the conversation', required: true },
          ],
          requiresApproval: false,
          examples: ['Archive conversation with John'],
        },
        {
          name: 'send_reply',
          description: 'Reply within an existing conversation thread.',
          parameters: [
            { name: 'conversationId', type: 'id', description: 'UUID of the conversation', required: true },
            { name: 'body', type: 'string', description: 'Reply text', required: true },
            { name: 'attachments', type: 'array', description: 'File URLs', required: false },
          ],
          requiresApproval: false,
          examples: ['Reply to conversation abc123: Sounds great!', 'Respond to John in thread'],
        },
        {
          name: 'delete_template',
          description: 'Remove a message template.',
          parameters: [
            { name: 'templateId', type: 'id', description: 'UUID of the template', required: true },
          ],
          requiresApproval: true,
          examples: ['Delete template abc123'],
        },
      ],
      queries: [
        {
          name: 'get_unread_count',
          description: 'Count unread messages across all conversations.',
          parameters: [
            { name: 'channel', type: 'enum', description: 'Filter by channel', enumValues: ['sms', 'email', 'whatsapp', 'all'], required: false, default: 'all' },
          ],
          returns: 'number',
          examples: ['How many unread messages?', 'Count unread WhatsApp messages'],
        },
        {
          name: 'get_recent_conversations',
          description: 'List recently active conversations.',
          parameters: [
            { name: 'channel', type: 'enum', description: 'Filter by channel', enumValues: ['sms', 'email', 'whatsapp', 'all'], required: false, default: 'all' },
            { name: 'limit', type: 'number', description: 'Max results', required: false, default: 20 },
            { name: 'unreadOnly', type: 'boolean', description: 'Only unread', required: false, default: false },
          ],
          returns: 'Conversation[]',
          examples: ['Show recent conversations', 'List unread message threads'],
        },
        {
          name: 'get_templates',
          description: 'List saved message templates.',
          parameters: [
            { name: 'channel', type: 'enum', description: 'Filter by channel', enumValues: ['sms', 'email', 'whatsapp'], required: false },
            { name: 'search', type: 'string', description: 'Name search', required: false },
          ],
          returns: 'Template[]',
          examples: ['List all SMS templates', 'Show email templates'],
        },
        {
          name: 'get_delivery_status',
          description: 'Check delivery/read receipts for a message.',
          parameters: [
            { name: 'messageId', type: 'id', description: 'UUID of the message', required: true },
          ],
          returns: 'DeliveryStatus',
          examples: ['Was the message delivered?', 'Check status of message abc123'],
        },
        {
          name: 'get_conversation_analytics',
          description: 'Aggregate conversation metrics for a period.',
          parameters: [
            { name: 'from', type: 'date', description: 'Start date', required: true },
            { name: 'to', type: 'date', description: 'End date', required: true },
          ],
          returns: 'ConversationAnalytics',
          examples: ['How many conversations this month?', 'Show messaging stats'],
        },
      ],
    },

    // ── 6. FLOW ─────────────────────────────────────────────────────────────
    {
      module: 'flow',
      description: 'Visual automation builder — triggers, conditions, actions, and flow orchestration.',
      actions: [
        {
          name: 'create_automation',
          description: 'Build a new automation flow.',
          parameters: [
            { name: 'name', type: 'string', description: 'Flow name', required: true },
            { name: 'trigger', type: 'enum', description: 'Trigger type', enumValues: ['contact_created', 'contact_tagged', 'invoice_paid', 'booking_confirmed', 'form_submitted', 'timer', 'webhook', 'manual'], required: true },
            { name: 'actions', type: 'array', description: 'Sequence of actions', required: true },
            { name: 'conditions', type: 'array', description: 'Conditional branches', required: false },
            { name: 'active', type: 'boolean', description: 'Enable immediately', required: false, default: false },
          ],
          requiresApproval: false,
          examples: ['Create automation: when contact tagged VIP, send welcome email'],
        },
        {
          name: 'enable_automation',
          description: 'Activate a paused automation.',
          parameters: [
            { name: 'flowId', type: 'id', description: 'UUID of the flow', required: true },
          ],
          requiresApproval: false,
          examples: ['Enable flow abc123', 'Turn on the welcome automation'],
        },
        {
          name: 'disable_automation',
          description: 'Pause an active automation.',
          parameters: [
            { name: 'flowId', type: 'id', description: 'UUID of the flow', required: true },
          ],
          requiresApproval: false,
          examples: ['Disable flow abc123', 'Pause the follow-up automation'],
        },
        {
          name: 'trigger_flow',
          description: 'Manually fire a flow for a given contact.',
          parameters: [
            { name: 'flowId', type: 'id', description: 'UUID of the flow', required: true },
            { name: 'contactId', type: 'id', description: 'UUID of the contact', required: true },
            { name: 'payload', type: 'object', description: 'Extra trigger payload', required: false },
          ],
          requiresApproval: false,
          examples: ['Run flow abc123 for contact def456', 'Manually trigger welcome flow for John'],
        },
        {
          name: 'delete_automation',
          description: 'Permanently remove an automation.',
          parameters: [
            { name: 'flowId', type: 'id', description: 'UUID of the flow', required: true },
          ],
          requiresApproval: true,
          examples: ['Delete flow abc123'],
        },
        {
          name: 'update_automation',
          description: 'Edit an existing automation.',
          parameters: [
            { name: 'flowId', type: 'id', description: 'UUID of the flow', required: true },
            { name: 'name', type: 'string', description: 'New name', required: false },
            { name: 'actions', type: 'array', description: 'Replace action sequence', required: false },
            { name: 'conditions', type: 'array', description: 'Replace conditions', required: false },
            { name: 'active', type: 'boolean', description: 'Enable/disable', required: false },
          ],
          requiresApproval: false,
          examples: ['Update flow abc123 actions', 'Rename automation to "Post-Sale Followup"'],
        },
        {
          name: 'clone_automation',
          description: 'Duplicate an automation as a starting point.',
          parameters: [
            { name: 'flowId', type: 'id', description: 'UUID of the source flow', required: true },
            { name: 'newName', type: 'string', description: 'Name for the clone', required: true },
          ],
          requiresApproval: false,
          examples: ['Clone flow abc123 as "Summer Variant"'],
        },
        {
          name: 'run_test',
          description: 'Execute a dry-run of a flow for validation.',
          parameters: [
            { name: 'flowId', type: 'id', description: 'UUID of the flow', required: true },
            { name: 'contactId', type: 'id', description: 'Test contact UUID', required: true },
          ],
          requiresApproval: false,
          examples: ['Test flow abc123 with contact def456'],
        },
      ],
      queries: [
        {
          name: 'get_flow_status',
          description: 'Check whether a flow is active and get run stats.',
          parameters: [
            { name: 'flowId', type: 'id', description: 'UUID of the flow', required: true },
          ],
          returns: 'FlowStatus',
          examples: ['Is flow abc123 active?', 'Show flow stats'],
        },
        {
          name: 'get_flow_runs',
          description: 'List recent executions of a flow.',
          parameters: [
            { name: 'flowId', type: 'id', description: 'UUID of the flow', required: true },
            { name: 'limit', type: 'number', description: 'Max results', required: false, default: 20 },
          ],
          returns: 'FlowRun[]',
          examples: ['Show recent runs of welcome flow', 'List executions of flow abc123'],
        },
        {
          name: 'get_flow_analytics',
          description: 'Aggregate performance metrics for flows.',
          parameters: [
            { name: 'from', type: 'date', description: 'Start date', required: true },
            { name: 'to', type: 'date', description: 'End date', required: true },
          ],
          returns: 'FlowAnalytics',
          examples: ['How many flows ran this month?', 'Show automation stats'],
        },
        {
          name: 'list_automations',
          description: 'List all automations with their status.',
          parameters: [
            { name: 'activeOnly', type: 'boolean', description: 'Only active flows', required: false, default: false },
          ],
          returns: 'Flow[]',
          examples: ['List all automations', 'Show active flows'],
        },
        {
          name: 'get_flow_logs',
          description: 'Retrieve detailed execution logs for a flow.',
          parameters: [
            { name: 'flowId', type: 'id', description: 'UUID of the flow', required: true },
            { name: 'runId', type: 'id', description: 'Specific run ID', required: false },
          ],
          returns: 'FlowLog[]',
          examples: ['Show logs for flow abc123', 'Debug the welcome flow'],
        },
      ],
    },

    // ── 7. AUTOPILOT ────────────────────────────────────────────────────────
    {
      module: 'autopilot',
      description: 'Autonomous AI workflows that run without human intervention — follow-ups, reminders, data entry.',
      actions: [
        {
          name: 'start_autopilot',
          description: 'Activate an autonomous AI workflow.',
          parameters: [
            { name: 'workflowId', type: 'id', description: 'UUID of the workflow definition', required: true },
            { name: 'context', type: 'object', description: 'Initial context variables', required: false },
          ],
          requiresApproval: false,
          examples: ['Start autopilot workflow abc123', 'Run the lead nurture AI'],
        },
        {
          name: 'stop_autopilot',
          description: 'Halt a running autonomous workflow.',
          parameters: [
            { name: 'runId', type: 'id', description: 'UUID of the active run', required: true },
          ],
          requiresApproval: false,
          examples: ['Stop autopilot run abc123', 'Halt the AI workflow'],
        },
        {
          name: 'create_workflow',
          description: 'Define a new autonomous workflow.',
          parameters: [
            { name: 'name', type: 'string', description: 'Workflow name', required: true },
            { name: 'description', type: 'string', description: 'What the workflow does', required: false },
            { name: 'steps', type: 'array', description: 'Ordered step definitions', required: true },
            { name: 'trigger', type: 'enum', description: 'Activation trigger', enumValues: ['manual', 'scheduled', 'event'], required: true },
          ],
          requiresApproval: false,
          examples: ['Create autopilot workflow for lead follow-up'],
        },
        {
          name: 'update_workflow',
          description: 'Modify an existing workflow definition.',
          parameters: [
            { name: 'workflowId', type: 'id', description: 'UUID of the workflow', required: true },
            { name: 'name', type: 'string', description: 'New name', required: false },
            { name: 'steps', type: 'array', description: 'Replace steps', required: false },
            { name: 'active', type: 'boolean', description: 'Enable/disable', required: false },
          ],
          requiresApproval: false,
          examples: ['Update autopilot workflow abc123 steps'],
        },
        {
          name: 'delete_workflow',
          description: 'Remove a workflow definition.',
          parameters: [
            { name: 'workflowId', type: 'id', description: 'UUID of the workflow', required: true },
          ],
          requiresApproval: true,
          examples: ['Delete autopilot workflow abc123'],
        },
      ],
      queries: [
        {
          name: 'get_active_runs',
          description: 'List currently running autopilot workflows.',
          parameters: [
            { name: 'workflowId', type: 'id', description: 'Filter by workflow', required: false },
            { name: 'limit', type: 'number', description: 'Max results', required: false, default: 20 },
          ],
          returns: 'AutopilotRun[]',
          examples: ['What autopilot workflows are running?', 'Show active AI runs'],
        },
        {
          name: 'get_run_history',
          description: 'Fetch completed autopilot runs.',
          parameters: [
            { name: 'workflowId', type: 'id', description: 'Filter by workflow', required: false },
            { name: 'from', type: 'date', description: 'Start date', required: false },
            { name: 'to', type: 'date', description: 'End date', required: false },
            { name: 'limit', type: 'number', description: 'Max results', required: false, default: 20 },
          ],
          returns: 'AutopilotRun[]',
          examples: ['Show completed autopilot runs', 'List recent AI workflow executions'],
        },
        {
          name: 'get_run_status',
          description: 'Check the status of a specific autopilot run.',
          parameters: [
            { name: 'runId', type: 'id', description: 'UUID of the run', required: true },
          ],
          returns: 'AutopilotRun',
          examples: ['Is autopilot run abc123 still running?', 'Check status of AI workflow'],
        },
        {
          name: 'list_workflows',
          description: 'List all autopilot workflow definitions.',
          parameters: [
            { name: 'activeOnly', type: 'boolean', description: 'Only active workflows', required: false, default: false },
          ],
          returns: 'Workflow[]',
          examples: ['List all autopilot workflows', 'Show AI workflow definitions'],
        },
      ],
    },

    // ── 8. TEMPORAL-FLOW (MEMORY) ───────────────────────────────────────────
    {
      module: 'temporal',
      description: 'Conversation state memory, cross-session continuity, context recall, and time-aware reasoning.',
      actions: [
        {
          name: 'store_memory',
          description: 'Persist a key-value memory for later recall.',
          parameters: [
            { name: 'key', type: 'string', description: 'Memory key', required: true },
            { name: 'value', type: 'string', description: 'Memory value', required: true },
            { name: 'scope', type: 'enum', description: 'Memory scope', enumValues: ['contact', 'business', 'global'], required: false, default: 'contact' },
            { name: 'contactId', type: 'id', description: 'Contact scope ID', required: false },
            { name: 'ttl', type: 'number', description: 'Time-to-live in hours', required: false },
          ],
          requiresApproval: false,
          examples: ['Remember that John prefers email', 'Store that Acme Corp uses Slack'],
        },
        {
          name: 'recall_memory',
          description: 'Retrieve a stored memory by key.',
          parameters: [
            { name: 'key', type: 'string', description: 'Memory key', required: true },
            { name: 'scope', type: 'enum', description: 'Memory scope', enumValues: ['contact', 'business', 'global'], required: false, default: 'contact' },
            { name: 'contactId', type: 'id', description: 'Contact scope ID', required: false },
          ],
          requiresApproval: false,
          examples: ['What did John prefer?', 'Recall the Slack info for Acme'],
        },
        {
          name: 'forget_memory',
          description: 'Delete a stored memory.',
          parameters: [
            { name: 'key', type: 'string', description: 'Memory key', required: true },
            { name: 'scope', type: 'enum', description: 'Memory scope', enumValues: ['contact', 'business', 'global'], required: false, default: 'contact' },
            { name: 'contactId', type: 'id', description: 'Contact scope ID', required: false },
          ],
          requiresApproval: false,
          examples: ['Forget that John prefers email', 'Delete memory about Acme'],
        },
        {
          name: 'store_context',
          description: 'Store rich context about a conversation or decision.',
          parameters: [
            { name: 'contextType', type: 'string', description: 'Context category', required: true },
            { name: 'data', type: 'object', description: 'Context payload', required: true },
            { name: 'contactId', type: 'id', description: 'Associated contact', required: false },
          ],
          requiresApproval: false,
          examples: ['Store context: John is interested in Premium Plan'],
        },
        {
          name: 'get_context_history',
          description: 'Retrieve chronological context history.',
          parameters: [
            { name: 'contactId', type: 'id', description: 'Filter by contact', required: false },
            { name: 'contextType', type: 'string', description: 'Filter by type', required: false },
            { name: 'limit', type: 'number', description: 'Max results', required: false, default: 20 },
          ],
          requiresApproval: false,
          examples: ['Show context history for John', 'List recent decisions'],
        },
        {
          name: 'set_reminder',
          description: 'Set a time-aware reminder.',
          parameters: [
            { name: 'title', type: 'string', description: 'Reminder text', required: true },
            { name: 'dueAt', type: 'date', description: 'ISO due datetime', required: true },
            { name: 'contactId', type: 'id', description: 'Associated contact', required: false },
            { name: 'recurring', type: 'boolean', description: 'Repeat reminder', required: false, default: false },
          ],
          requiresApproval: false,
          examples: ['Remind me to follow up with John next Monday', 'Set reminder for Q1 review'],
        },
        {
          name: 'complete_reminder',
          description: 'Mark a reminder as completed.',
          parameters: [
            { name: 'reminderId', type: 'id', description: 'UUID of the reminder', required: true },
          ],
          requiresApproval: false,
          examples: ['Complete reminder abc123', 'Mark the follow-up as done'],
        },
      ],
      queries: [
        {
          name: 'get_active_reminders',
          description: 'List pending reminders.',
          parameters: [
            { name: 'contactId', type: 'id', description: 'Filter by contact', required: false },
            { name: 'overdueOnly', type: 'boolean', description: 'Only overdue', required: false, default: false },
          ],
          returns: 'Reminder[]',
          examples: ['What reminders are pending?', 'Show overdue reminders'],
        },
        {
          name: 'search_memories',
          description: 'Search stored memories by key pattern.',
          parameters: [
            { name: 'query', type: 'string', description: 'Key search pattern', required: true },
            { name: 'scope', type: 'enum', description: 'Memory scope', enumValues: ['contact', 'business', 'global'], required: false, default: 'contact' },
          ],
          returns: 'Memory[]',
          examples: ['Search memories for "preference"', 'Find all Slack-related memories'],
        },
        {
          name: 'get_memory_summary',
          description: 'Get a summary of all memories for a contact.',
          parameters: [
            { name: 'contactId', type: 'id', description: 'UUID of the contact', required: true },
          ],
          returns: 'MemorySummary',
          examples: ['Summarize what we know about John', 'Memory overview for contact abc123'],
        },
        {
          name: 'get_context_summary',
          description: 'Aggregate context entries for analysis.',
          parameters: [
            { name: 'from', type: 'date', description: 'Start date', required: false },
            { name: 'to', type: 'date', description: 'End date', required: false },
            { name: 'contactId', type: 'id', description: 'Filter by contact', required: false },
          ],
          returns: 'ContextSummary',
          examples: ['Summarize recent context', 'Show context for last week'],
        },
        {
          name: 'get_reminder_analytics',
          description: 'Analyze reminder completion rates.',
          parameters: [
            { name: 'from', type: 'date', description: 'Start date', required: true },
            { name: 'to', type: 'date', description: 'End date', required: true },
          ],
          returns: 'ReminderAnalytics',
          examples: ['How are we doing on reminders?', 'Reminder completion stats'],
        },
      ],
    },

    // ── 9. KEY-INBOX ────────────────────────────────────────────────────────
    {
      module: 'inbox',
      description: 'Unified inbox — emails, SMS, WhatsApp, social DMs, support tickets, and internal notes.',
      actions: [
        {
          name: 'archive_item',
          description: 'Archive an inbox item.',
          parameters: [
            { name: 'itemId', type: 'id', description: 'UUID of the inbox item', required: true },
          ],
          requiresApproval: false,
          examples: ['Archive inbox item abc123', 'Archive this email'],
        },
        {
          name: 'mark_important',
          description: 'Flag an inbox item as important.',
          parameters: [
            { name: 'itemId', type: 'id', description: 'UUID of the inbox item', required: true },
          ],
          requiresApproval: false,
          examples: ['Mark inbox item abc123 as important', 'Flag this message'],
        },
        {
          name: 'assign_item',
          description: 'Assign an inbox item to a team member.',
          parameters: [
            { name: 'itemId', type: 'id', description: 'UUID of the inbox item', required: true },
            { name: 'userId', type: 'id', description: 'Assignee user ID', required: true },
          ],
          requiresApproval: false,
          examples: ['Assign inbox item abc123 to Jane', 'Give this to John'],
        },
        {
          name: 'add_internal_note',
          description: 'Add an internal note to an inbox item.',
          parameters: [
            { name: 'itemId', type: 'id', description: 'UUID of the inbox item', required: true },
            { name: 'body', type: 'string', description: 'Note text', required: true },
          ],
          requiresApproval: false,
          examples: ['Add note to inbox item abc123: Check with billing', 'Internal note: VIP client'],
        },
        {
          name: 'create_ticket',
          description: 'Create a support ticket from an inbox item.',
          parameters: [
            { name: 'itemId', type: 'id', description: 'UUID of the inbox item', required: true },
            { name: 'priority', type: 'enum', description: 'Ticket priority', enumValues: ['low', 'medium', 'high', 'urgent'], required: false, default: 'medium' },
            { name: 'category', type: 'string', description: 'Ticket category', required: false },
          ],
          requiresApproval: false,
          examples: ['Create ticket from inbox item abc123', 'Turn this into a support ticket'],
        },
        {
          name: 'resolve_ticket',
          description: 'Mark a support ticket as resolved.',
          parameters: [
            { name: 'ticketId', type: 'id', description: 'UUID of the ticket', required: true },
            { name: 'resolution', type: 'string', description: 'Resolution notes', required: false },
          ],
          requiresApproval: false,
          examples: ['Resolve ticket abc123', 'Close this support case'],
        },
        {
          name: 'escalate_ticket',
          description: 'Escalate a ticket to a higher tier.',
          parameters: [
            { name: 'ticketId', type: 'id', description: 'UUID of the ticket', required: true },
            { name: 'reason', type: 'string', description: 'Escalation reason', required: false },
          ],
          requiresApproval: false,
          examples: ['Escalate ticket abc123', 'Bump this to tier 2'],
        },
      ],
      queries: [
        {
          name: 'get_inbox_items',
          description: 'List inbox items with optional filters.',
          parameters: [
            { name: 'channel', type: 'enum', description: 'Filter by channel', enumValues: ['email', 'sms', 'whatsapp', 'social', 'ticket', 'note'], required: false },
            { name: 'status', type: 'enum', description: 'Filter by status', enumValues: ['unread', 'read', 'archived', 'starred'], required: false },
            { name: 'assignedTo', type: 'id', description: 'Filter by assignee', required: false },
            { name: 'limit', type: 'number', description: 'Max results', required: false, default: 50 },
          ],
          returns: 'InboxItem[]',
          examples: ['Show my inbox', 'List unread emails', 'Get support tickets'],
        },
        {
          name: 'get_unread_count',
          description: 'Count unread inbox items.',
          parameters: [
            { name: 'channel', type: 'enum', description: 'Filter by channel', enumValues: ['email', 'sms', 'whatsapp', 'social', 'ticket', 'note', 'all'], required: false, default: 'all' },
          ],
          returns: 'number',
          examples: ['How many unread messages?', 'Count unread emails'],
        },
        {
          name: 'get_ticket_queue',
          description: 'List support tickets with filtering.',
          parameters: [
            { name: 'status', type: 'enum', description: 'Ticket status', enumValues: ['open', 'pending', 'resolved', 'escalated'], required: false },
            { name: 'priority', type: 'enum', description: 'Filter by priority', enumValues: ['low', 'medium', 'high', 'urgent'], required: false },
            { name: 'limit', type: 'number', description: 'Max results', required: false, default: 50 },
          ],
          returns: 'Ticket[]',
          examples: ['Show open tickets', 'List high-priority support cases'],
        },
        {
          name: 'get_item_thread',
          description: 'Fetch the full thread for an inbox item.',
          parameters: [
            { name: 'itemId', type: 'id', description: 'UUID of the inbox item', required: true },
          ],
          returns: 'InboxItem[]',
          examples: ['Show the full thread for inbox item abc123', 'Get conversation history'],
        },
        {
          name: 'get_inbox_analytics',
          description: 'Aggregate inbox metrics for a period.',
          parameters: [
            { name: 'from', type: 'date', description: 'Start date', required: true },
            { name: 'to', type: 'date', description: 'End date', required: true },
          ],
          returns: 'InboxAnalytics',
          examples: ['How many messages this month?', 'Show inbox stats'],
        },
      ],
    },

    // ── 10. NOTIFICATIONS ───────────────────────────────────────────────────
    {
      module: 'notifications',
      description: 'Push notifications, in-app alerts, notification preferences, and delivery tracking.',
      actions: [
        {
          name: 'send_push',
          description: 'Send a push notification to a user or device.',
          parameters: [
            { name: 'userId', type: 'id', description: 'Target user ID', required: true },
            { name: 'title', type: 'string', description: 'Notification title', required: true },
            { name: 'body', type: 'string', description: 'Notification body', required: true },
            { name: 'deepLink', type: 'string', description: 'App deep link', required: false },
            { name: 'data', type: 'object', description: 'Payload data', required: false },
          ],
          requiresApproval: false,
          examples: ['Send push to John: New message received', 'Notify Jane about invoice'],
        },
        {
          name: 'send_in_app',
          description: 'Send an in-app notification.',
          parameters: [
            { name: 'userId', type: 'id', description: 'Target user ID', required: true },
            { name: 'title', type: 'string', description: 'Notification title', required: true },
            { name: 'body', type: 'string', description: 'Notification body', required: true },
            { name: 'type', type: 'enum', description: 'Notification type', enumValues: ['info', 'success', 'warning', 'error'], required: false, default: 'info' },
          ],
          requiresApproval: false,
          examples: ['Send in-app notification: Welcome!', 'Alert user about new feature'],
        },
        {
          name: 'update_preferences',
          description: 'Update notification preferences for a user.',
          parameters: [
            { name: 'userId', type: 'id', description: 'Target user ID', required: true },
            { name: 'channel', type: 'enum', description: 'Channel to configure', enumValues: ['push', 'email', 'sms', 'in_app'], required: true },
            { name: 'enabled', type: 'boolean', description: 'Enable/disable', required: true },
            { name: 'category', type: 'string', description: 'Notification category', required: false },
          ],
          requiresApproval: false,
          examples: ['Enable push notifications for John', 'Turn off SMS alerts for Jane'],
        },
        {
          name: 'create_notification_rule',
          description: 'Create a rule for automated notifications.',
          parameters: [
            { name: 'name', type: 'string', description: 'Rule name', required: true },
            { name: 'trigger', type: 'enum', description: 'Trigger event', enumValues: ['contact_created', 'invoice_paid', 'booking_confirmed', 'task_due', 'message_received'], required: true },
            { name: 'channel', type: 'enum', description: 'Delivery channel', enumValues: ['push', 'email', 'sms', 'in_app'], required: true },
            { name: 'template', type: 'string', description: 'Message template', required: true },
          ],
          requiresApproval: false,
          examples: ['Create rule: notify on new booking'],
        },
      ],
      queries: [
        {
          name: 'get_notification_log',
          description: 'List sent notifications for a user.',
          parameters: [
            { name: 'userId', type: 'id', description: 'Target user ID', required: true },
            { name: 'limit', type: 'number', description: 'Max results', required: false, default: 50 },
          ],
          returns: 'Notification[]',
          examples: ['Show notification history for John', 'List recent notifications'],
        },
        {
          name: 'get_preferences',
          description: 'Get notification preferences for a user.',
          parameters: [
            { name: 'userId', type: 'id', description: 'Target user ID', required: true },
          ],
          returns: 'NotificationPreferences',
          examples: ['What are John notification preferences?', 'Show notification settings'],
        },
        {
          name: 'get_delivery_stats',
          description: 'Aggregate notification delivery statistics.',
          parameters: [
            { name: 'from', type: 'date', description: 'Start date', required: true },
            { name: 'to', type: 'date', description: 'End date', required: true },
          ],
          returns: 'DeliveryStats',
          examples: ['Show notification delivery stats', 'How many pushes delivered?'],
        },
        {
          name: 'get_pending_notifications',
          description: 'List queued notifications waiting to be sent.',
          parameters: [
            { name: 'limit', type: 'number', description: 'Max results', required: false, default: 50 },
          ],
          returns: 'Notification[]',
          examples: ['What notifications are queued?', 'Show pending alerts'],
        },
        {
          name: 'get_notification_rules',
          description: 'List automated notification rules.',
          parameters: [
            { name: 'activeOnly', type: 'boolean', description: 'Only active rules', required: false, default: false },
          ],
          returns: 'NotificationRule[]',
          examples: ['List notification rules', 'Show automated alerts'],
        },
      ],
    },

    // ── 11. PROJECTS ────────────────────────────────────────────────────────
    {
      module: 'projects',
      description: 'Project management — tasks, milestones, timelines, team assignments, and progress tracking.',
      actions: [
        {
          name: 'create_project',
          description: 'Create a new project.',
          parameters: [
            { name: 'name', type: 'string', description: 'Project name', required: true },
            { name: 'description', type: 'string', description: 'Project description', required: false },
            { name: 'ownerId', type: 'id', description: 'Project owner user ID', required: false },
            { name: 'dueDate', type: 'date', description: 'Project due date', required: false },
            { name: 'status', type: 'enum', description: 'Initial status', enumValues: ['planning', 'active', 'on_hold', 'completed'], required: false, default: 'planning' },
          ],
          requiresApproval: false,
          examples: ['Create project "Website Redesign"', 'Start new project for Acme Corp'],
        },
        {
          name: 'create_task',
          description: 'Add a task to a project.',
          parameters: [
            { name: 'projectId', type: 'id', description: 'UUID of the project', required: true },
            { name: 'title', type: 'string', description: 'Task name', required: true },
            { name: 'description', type: 'string', description: 'Task description', required: false },
            { name: 'assignedTo', type: 'id', description: 'Assignee user ID', required: false },
            { name: 'dueDate', type: 'date', description: 'Task due date', required: false },
            { name: 'priority', type: 'enum', description: 'Priority', enumValues: ['low', 'medium', 'high', 'urgent'], required: false, default: 'medium' },
          ],
          requiresApproval: false,
          examples: ['Add task "Design homepage" to project abc123', 'Create task for John'],
        },
        {
          name: 'update_task',
          description: 'Modify a project task.',
          parameters: [
            { name: 'taskId', type: 'id', description: 'UUID of the task', required: true },
            { name: 'title', type: 'string', description: 'New title', required: false },
            { name: 'status', type: 'enum', description: 'New status', enumValues: ['todo', 'in_progress', 'review', 'done', 'blocked'], required: false },
            { name: 'assignedTo', type: 'id', description: 'New assignee', required: false },
          ],
          requiresApproval: false,
          examples: ['Update task abc123 status to in_progress', 'Reassign task to Jane'],
        },
        {
          name: 'complete_task',
          description: 'Mark a project task as complete.',
          parameters: [
            { name: 'taskId', type: 'id', description: 'UUID of the task', required: true },
            { name: 'notes', type: 'string', description: 'Completion notes', required: false },
          ],
          requiresApproval: false,
          examples: ['Complete task abc123', 'Mark task as done'],
        },
        {
          name: 'add_milestone',
          description: 'Add a milestone to a project.',
          parameters: [
            { name: 'projectId', type: 'id', description: 'UUID of the project', required: true },
            { name: 'name', type: 'string', description: 'Milestone name', required: true },
            { name: 'dueDate', type: 'date', description: 'Milestone due date', required: false },
          ],
          requiresApproval: false,
          examples: ['Add milestone "Phase 1 Complete" to project abc123'],
        },
        {
          name: 'complete_milestone',
          description: 'Mark a milestone as achieved.',
          parameters: [
            { name: 'milestoneId', type: 'id', description: 'UUID of the milestone', required: true },
          ],
          requiresApproval: false,
          examples: ['Complete milestone abc123', 'Mark Phase 1 as done'],
        },
        {
          name: 'archive_project',
          description: 'Archive a completed project.',
          parameters: [
            { name: 'projectId', type: 'id', description: 'UUID of the project', required: true },
          ],
          requiresApproval: false,
          examples: ['Archive project abc123', 'Close the website redesign project'],
        },
        {
          name: 'add_comment',
          description: 'Add a comment to a project or task.',
          parameters: [
            { name: 'targetId', type: 'id', description: 'UUID of project or task', required: true },
            { name: 'body', type: 'string', description: 'Comment text', required: true },
          ],
          requiresApproval: false,
          examples: ['Add comment to project abc123: Great progress!', 'Comment on task'],
        },
      ],
      queries: [
        {
          name: 'get_project_board',
          description: 'Get the kanban board for a project.',
          parameters: [
            { name: 'projectId', type: 'id', description: 'UUID of the project', required: true },
          ],
          returns: 'ProjectBoard',
          examples: ['Show project abc123 board', 'Get kanban for website redesign'],
        },
        {
          name: 'get_project_tasks',
          description: 'List tasks for a project.',
          parameters: [
            { name: 'projectId', type: 'id', description: 'UUID of the project', required: true },
            { name: 'status', type: 'enum', description: 'Filter by status', enumValues: ['todo', 'in_progress', 'review', 'done', 'blocked'], required: false },
            { name: 'assignedTo', type: 'id', description: 'Filter by assignee', required: false },
          ],
          returns: 'Task[]',
          examples: ['List tasks for project abc123', 'Show open tasks for John'],
        },
        {
          name: 'get_user_tasks',
          description: 'List tasks assigned to a user across all projects.',
          parameters: [
            { name: 'userId', type: 'id', description: 'UUID of the user', required: true },
            { name: 'status', type: 'enum', description: 'Filter by status', enumValues: ['todo', 'in_progress', 'review', 'done', 'blocked'], required: false },
          ],
          returns: 'Task[]',
          examples: ['What tasks does John have?', 'Show my open tasks'],
        },
        {
          name: 'get_project_timeline',
          description: 'Get project timeline with milestones.',
          parameters: [
            { name: 'projectId', type: 'id', description: 'UUID of the project', required: true },
          ],
          returns: 'Timeline',
          examples: ['Show timeline for project abc123', 'Project schedule'],
        },
        {
          name: 'get_project_summary',
          description: 'Get summary statistics for a project.',
          parameters: [
            { name: 'projectId', type: 'id', description: 'UUID of the project', required: true },
          ],
          returns: 'ProjectSummary',
          examples: ['Summarize project abc123', 'Project status overview'],
        },
      ],
    },

    // ── 12. ACTIVITY ────────────────────────────────────────────────────────
    {
      module: 'activity',
      description: 'Activity feeds, event logs, audit trails, and system-wide activity tracking.',
      actions: [
        {
          name: 'log_activity',
          description: 'Log a custom activity event.',
          parameters: [
            { name: 'entityType', type: 'string', description: 'Entity type', required: true },
            { name: 'entityId', type: 'id', description: 'Entity UUID', required: true },
            { name: 'action', type: 'string', description: 'Action performed', required: true },
            { name: 'actorId', type: 'id', description: 'User who performed action', required: false },
            { name: 'metadata', type: 'object', description: 'Additional context', required: false },
          ],
          requiresApproval: false,
          examples: ['Log activity: contact abc123 created by John'],
        },
        {
          name: 'create_activity_feed',
          description: 'Create a custom activity feed view.',
          parameters: [
            { name: 'name', type: 'string', description: 'Feed name', required: true },
            { name: 'filters', type: 'object', description: 'Feed filters', required: false },
          ],
          requiresApproval: false,
          examples: ['Create activity feed for sales team'],
        },
      ],
      queries: [
        {
          name: 'get_activity_feed',
          description: 'Retrieve activity feed for a business or entity.',
          parameters: [
            { name: 'entityType', type: 'string', description: 'Entity type filter', required: false },
            { name: 'entityId', type: 'id', description: 'Entity UUID filter', required: false },
            { name: 'limit', type: 'number', description: 'Max results', required: false, default: 50 },
          ],
          returns: 'Activity[]',
          examples: ['Show recent activity', 'Get activity for contact abc123'],
        },
        {
          name: 'get_audit_log',
          description: 'Retrieve audit trail for compliance.',
          parameters: [
            { name: 'from', type: 'date', description: 'Start date', required: true },
            { name: 'to', type: 'date', description: 'End date', required: true },
            { name: 'entityType', type: 'string', description: 'Entity type filter', required: false },
            { name: 'actorId', type: 'id', description: 'Filter by user', required: false },
          ],
          returns: 'AuditEntry[]',
          examples: ['Show audit log for last week', 'Get compliance trail'],
        },
        {
          name: 'get_recent_events',
          description: 'List recent system events.',
          parameters: [
            { name: 'limit', type: 'number', description: 'Max results', required: false, default: 20 },
          ],
          returns: 'Event[]',
          examples: ['Show recent events', 'List latest system events'],
        },
        {
          name: 'get_activity_summary',
          description: 'Aggregate activity metrics for a period.',
          parameters: [
            { name: 'from', type: 'date', description: 'Start date', required: true },
            { name: 'to', type: 'date', description: 'End date', required: true },
          ],
          returns: 'ActivitySummary',
          examples: ['Summarize activity for this month', 'Activity overview for Q1'],
        },
        {
          name: 'get_user_activity',
          description: 'List activity for a specific user.',
          parameters: [
            { name: 'userId', type: 'id', description: 'UUID of the user', required: true },
            { name: 'limit', type: 'number', description: 'Max results', required: false, default: 50 },
          ],
          returns: 'Activity[]',
          examples: ['Show activity for John', 'What did Jane do today?'],
        },
      ],
    },

    // ── 13. KEYSTORE (Service Marketplace) ──────────────────────────────────
    {
      module: 'keystore',
      description: 'Service marketplace for human-powered deliverables — content, design, development, marketing, consulting. Users request services, KeyFlowOS company fulfills them.',
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
  ]; // END MODULE_CAPABILITIES

  // ═══════════════════════════════════════════════════════════════════════════
  //  2. COMMAND ROUTER — execute() switch dispatches to module adapters
  // ═══════════════════════════════════════════════════════════════════════════

  async execute(command: ConnectorCommand): Promise<ConnectorResult> {
    const start = Date.now();
    this.logger.log(`[Connector] ${command.module}.${command.action} — correlation=${command.correlationId}`);

    try {
      switch (command.module as ModuleName) {
        case 'crm':
          return await this.executeCrmAction(command);
        case 'commerce':
          return await this.executeCommerceAction(command);
        case 'bookings':
          return await this.executeBookingsAction(command);
        case 'content':
          return await this.executeContentAction(command);
        case 'communications':
          return await this.executeCommunicationsAction(command);
        case 'flow':
          return await this.executeFlowAction(command);
        case 'autopilot':
          return await this.executeAutopilotAction(command);
        case 'temporal':
          return await this.executeTemporalAction(command);
        case 'inbox':
          return await this.executeInboxAction(command);
        case 'notifications':
          return await this.executeNotificationsAction(command);
        case 'projects':
          return await this.executeProjectsAction(command);
        case 'activity':
          return await this.executeActivityAction(command);
        case 'keystore':
          return await this.keystoreAdapter.execute(command);
        default:
          return this.fail(command, start, `Unknown module: ${(command as ConnectorCommand).module}`);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`[Connector] ${command.module}.${command.action} failed: ${msg}`);
      return this.fail(command, start, msg);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  3. MODULE ADAPTERS — Each adapter maps connector commands to real service calls
  // ═══════════════════════════════════════════════════════════════════════════

  // ── 1. CRM ────────────────────────────────────────────────────────────────
  private async executeCrmAction(command: ConnectorCommand): Promise<ConnectorResult> {
    const start = Date.now();
    switch (command.action) {
      case 'create_contact':
        return this.ok(command, start, await this.crm.createContact({
          firstName: command.parameters.firstName as string,
          lastName: command.parameters.lastName as string,
          email: command.parameters.email as string,
          phone: command.parameters.phone as string,
          company: command.parameters.company as string,
          tags: command.parameters.tags as string[],
          status: (command.parameters.status as string) ?? 'lead',
        }, command.businessId));
      case 'get_contact':
        return this.ok(command, start, await this.crm.getContact(command.parameters.contactId as string, command.businessId));
      case 'update_contact':
        return this.ok(command, start, await this.crm.updateContact(command.parameters.contactId as string, {
          firstName: command.parameters.firstName as string,
          lastName: command.parameters.lastName as string,
          email: command.parameters.email as string,
          phone: command.parameters.phone as string,
          status: command.parameters.status as string,
          tags: command.parameters.tags as string[],
        }, command.businessId));
      case 'delete_contact':
        return this.ok(command, start, await this.crm.deleteContact(command.parameters.contactId as string, command.businessId));
      case 'list_contacts':
        return this.ok(command, start, await this.crm.listContacts(command.businessId, {
          status: command.parameters.status as string,
          tag: command.parameters.tag as string,
          search: command.parameters.search as string,
          limit: (command.parameters.limit as number) ?? 50,
          offset: (command.parameters.offset as number) ?? 0,
        }));
      case 'add_task':
        return this.ok(command, start, await this.crm.addTask(command.parameters.contactId as string, {
          title: command.parameters.title as string,
          priority: (command.parameters.priority as string) ?? 'medium',
          dueDate: command.parameters.dueDate as string,
          assignedTo: command.parameters.assignedTo as string,
        }, command.businessId));
      case 'complete_task':
        return this.ok(command, start, await this.crm.completeTask(command.parameters.taskId as string, command.parameters.contactId as string, {
          notes: command.parameters.notes as string,
        }, command.businessId));
      case 'add_note':
        return this.ok(command, start, await this.crm.addNote(command.parameters.contactId as string, {
          body: command.parameters.body as string,
          type: (command.parameters.type as string) ?? 'general',
        }, command.businessId));
      case 'add_tag':
        return this.ok(command, start, await this.crm.addTags(command.parameters.contactId as string, command.parameters.tags as string[], command.businessId));
      case 'update_status':
        return this.ok(command, start, await this.crm.updateStatus(command.parameters.contactId as string, command.parameters.status as string, command.parameters.reason as string, command.businessId));
      case 'log_event':
        return this.ok(command, start, await this.crm.logEvent(command.parameters.contactId as string, command.parameters.eventType as string, command.parameters.metadata as Record<string, unknown>, command.businessId));
      case 'merge_contacts':
        return this.ok(command, start, await this.crm.mergeContacts(command.parameters.masterContactId as string, command.parameters.duplicateContactId as string, command.businessId));
      default:
        return this.fail(command, start, `Unknown CRM action: ${command.action}`);
    }
  }

  // ── 2. COMMERCE ───────────────────────────────────────────────────────────
  private async executeCommerceAction(command: ConnectorCommand): Promise<ConnectorResult> {
    const start = Date.now();
    switch (command.action) {
      case 'create_invoice':
        return this.ok(command, start, await this.commerce.createInvoice(command.parameters.contactId as string, command.parameters.items as Array<Record<string, unknown>>, {
          dueDate: command.parameters.dueDate as string,
          notes: command.parameters.notes as string,
          sendImmediately: (command.parameters.sendImmediately as boolean) ?? false,
        }, command.businessId));
      case 'send_invoice':
        return this.ok(command, start, await this.commerce.sendInvoice(command.parameters.invoiceId as string, command.parameters.message as string, command.businessId));
      case 'get_invoice':
        return this.ok(command, start, await this.commerce.getInvoice(command.parameters.invoiceId as string, command.businessId));
      case 'list_invoices':
        return this.ok(command, start, await this.commerce.listInvoices(command.businessId, {
          contactId: command.parameters.contactId as string,
          status: command.parameters.status as string,
          limit: (command.parameters.limit as number) ?? 50,
        }));
      case 'create_product':
        return this.ok(command, start, await this.commerce.createProduct({
          name: command.parameters.name as string,
          description: command.parameters.description as string,
          price: command.parameters.price as number,
          sku: command.parameters.sku as string,
          taxable: (command.parameters.taxable as boolean) ?? true,
        }, command.businessId));
      case 'get_product':
        return this.ok(command, start, await this.commerce.getProduct(command.parameters.productId as string, command.parameters.sku as string, command.businessId));
      case 'create_order':
        return this.ok(command, start, await this.commerce.createOrder(command.parameters.contactId as string, command.parameters.items as Array<Record<string, unknown>>, command.parameters.notes as string, command.businessId));
      case 'process_payment':
        return this.ok(command, start, await this.commerce.processPayment(command.parameters.invoiceId as string, command.parameters.amount as number, command.parameters.method as string, command.parameters.reference as string, command.businessId));
      case 'create_quote':
        return this.ok(command, start, await this.commerce.createQuote(command.parameters.contactId as string, command.parameters.items as Array<Record<string, unknown>>, command.parameters.validUntil as string, command.parameters.notes as string, command.businessId));
      case 'send_quote':
        return this.ok(command, start, await this.commerce.sendQuote(command.parameters.quoteId as string, command.parameters.message as string, command.businessId));
      default:
        return this.fail(command, start, `Unknown commerce action: ${command.action}`);
    }
  }

  // ── 3. BOOKINGS ───────────────────────────────────────────────────────────
  private async executeBookingsAction(command: ConnectorCommand): Promise<ConnectorResult> {
    const start = Date.now();
    switch (command.action) {
      case 'create_booking':
        return this.ok(command, start, await this.bookings.createBooking({
          contactId: command.parameters.contactId as string,
          serviceId: command.parameters.serviceId as string,
          startTime: command.parameters.startTime as string,
          endTime: command.parameters.endTime as string,
          staffId: command.parameters.staffId as string,
          notes: command.parameters.notes as string,
        }, command.businessId));
      case 'cancel_booking':
        return this.ok(command, start, await this.bookings.cancelBooking(command.parameters.bookingId as string, {
          reason: command.parameters.reason as string,
          notifyClient: (command.parameters.notifyClient as boolean) ?? true,
        }, command.businessId));
      case 'reschedule_booking':
        return this.ok(command, start, await this.bookings.rescheduleBooking(command.parameters.bookingId as string, {
          newStartTime: command.parameters.newStartTime as string,
          newEndTime: command.parameters.newEndTime as string,
          notifyClient: (command.parameters.notifyClient as boolean) ?? true,
        }, command.businessId));
      case 'confirm_booking':
        return this.ok(command, start, await this.bookings.confirmBooking(command.parameters.bookingId as string, {
          sendConfirmation: (command.parameters.sendConfirmation as boolean) ?? true,
        }, command.businessId));
      case 'add_service':
        return this.ok(command, start, await this.bookings.addService({
          name: command.parameters.name as string,
          duration: command.parameters.duration as number,
          price: command.parameters.price as number,
          description: command.parameters.description as string,
          buffer: (command.parameters.buffer as number) ?? 0,
        }, command.businessId));
      case 'update_service':
        return this.ok(command, start, await this.bookings.updateService(command.parameters.serviceId as string, {
          name: command.parameters.name as string,
          duration: command.parameters.duration as number,
          price: command.parameters.price as number,
          active: command.parameters.active as boolean,
        }, command.businessId));
      case 'set_availability':
        return this.ok(command, start, await this.bookings.setAvailability(command.parameters.staffId as string, {
          dayOfWeek: command.parameters.dayOfWeek as string,
          startTime: command.parameters.startTime as string,
          endTime: command.parameters.endTime as string,
        }, command.businessId));
      case 'block_time':
        return this.ok(command, start, await this.bookings.blockTime(command.parameters.staffId as string, {
          startTime: command.parameters.startTime as string,
          endTime: command.parameters.endTime as string,
          reason: command.parameters.reason as string,
        }, command.businessId));
      default:
        return this.fail(command, start, `Unknown bookings action: ${command.action}`);
    }
  }

  // ── 4. CONTENT ────────────────────────────────────────────────────────────
  private async executeContentAction(command: ConnectorCommand): Promise<ConnectorResult> {
    const start = Date.now();
    switch (command.action) {
      case 'create_post':
        return this.ok(command, start, await this.content.createPost({
          title: command.parameters.title as string,
          body: command.parameters.body as string,
          platform: (command.parameters.platform as string) ?? 'blog',
          status: (command.parameters.status as string) ?? 'draft',
          scheduledAt: command.parameters.scheduledAt as string,
          tags: command.parameters.tags as string[],
          seoTitle: command.parameters.seoTitle as string,
          seoDescription: command.parameters.seoDescription as string,
        }, command.businessId));
      case 'schedule_post':
        return this.ok(command, start, await this.content.schedulePost(command.parameters.postId as string, command.parameters.scheduledAt as string, command.parameters.platform as string, command.businessId));
      case 'publish_post':
        return this.ok(command, start, await this.content.publishPost(command.parameters.postId as string, command.businessId));
      case 'create_campaign':
        return this.ok(command, start, await this.content.createCampaign({
          name: command.parameters.name as string,
          subject: command.parameters.subject as string,
          body: command.parameters.body as string,
          segment: command.parameters.segment as string,
          scheduledAt: command.parameters.scheduledAt as string,
        }, command.businessId));
      case 'send_campaign':
        return this.ok(command, start, await this.content.sendCampaign(command.parameters.campaignId as string, {
          testOnly: (command.parameters.testOnly as boolean) ?? false,
        }, command.businessId));
      case 'generate_content':
        return this.ok(command, start, await this.content.generateContent(command.parameters.topic as string, command.parameters.platform as string, {
          tone: (command.parameters.tone as string) ?? 'professional',
          length: (command.parameters.length as string) ?? 'medium',
        }, command.businessId));
      case 'update_post':
        return this.ok(command, start, await this.content.updatePost(command.parameters.postId as string, {
          title: command.parameters.title as string,
          body: command.parameters.body as string,
          status: command.parameters.status as string,
        }, command.businessId));
      case 'delete_post':
        return this.ok(command, start, await this.content.deletePost(command.parameters.postId as string, command.businessId));
      default:
        return this.fail(command, start, `Unknown content action: ${command.action}`);
    }
  }

  // ── 5. COMMUNICATIONS ─────────────────────────────────────────────────────
  private async executeCommunicationsAction(command: ConnectorCommand): Promise<ConnectorResult> {
    const start = Date.now();
    switch (command.action) {
      case 'send_message':
        return this.ok(command, start, await this.communications.sendMessage(command.parameters.contactId as string, command.parameters.channel as string, command.parameters.body as string, {
          templateId: command.parameters.templateId as string,
          attachments: command.parameters.attachments as string[],
          scheduledAt: command.parameters.scheduledAt as string,
        }, command.businessId));
      case 'send_whatsapp':
        return this.ok(command, start, await this.communications.sendWhatsApp(command.parameters.contactId as string, command.parameters.body as string, command.parameters.templateId as string, command.businessId));
      case 'send_email':
        return this.ok(command, start, await this.communications.sendEmail(command.parameters.contactId as string, command.parameters.subject as string, command.parameters.body as string, command.parameters.attachments as string[], command.businessId));
      case 'create_template':
        return this.ok(command, start, await this.communications.createTemplate({
          name: command.parameters.name as string,
          channel: command.parameters.channel as string,
          subject: command.parameters.subject as string,
          body: command.parameters.body as string,
          variables: command.parameters.variables as string[],
        }, command.businessId));
      case 'get_conversation':
        return this.ok(command, start, await this.communications.getConversation(command.parameters.contactId as string, command.parameters.channel as string, {
          limit: (command.parameters.limit as number) ?? 50,
        }, command.businessId));
      case 'send_broadcast':
        return this.ok(command, start, await this.communications.sendBroadcast(command.parameters.segment as string, command.parameters.channel as string, command.parameters.body as string, command.parameters.templateId as string, command.businessId));
      case 'mark_read':
        return this.ok(command, start, await this.communications.markRead(command.parameters.conversationId as string, command.businessId));
      case 'archive_conversation':
        return this.ok(command, start, await this.communications.archiveConversation(command.parameters.conversationId as string, command.businessId));
      case 'send_reply':
        return this.ok(command, start, await this.communications.sendReply(command.parameters.conversationId as string, command.parameters.body as string, command.parameters.attachments as string[], command.businessId));
      case 'delete_template':
        return this.ok(command, start, await this.communications.deleteTemplate(command.parameters.templateId as string, command.businessId));
      default:
        return this.fail(command, start, `Unknown communications action: ${command.action}`);
    }
  }

  // ── 6. FLOW ───────────────────────────────────────────────────────────────
  private async executeFlowAction(command: ConnectorCommand): Promise<ConnectorResult> {
    const start = Date.now();
    switch (command.action) {
      case 'create_automation':
        return this.ok(command, start, await this.flow.createAutomation({
          name: command.parameters.name as string,
          trigger: command.parameters.trigger as string,
          actions: command.parameters.actions as Array<Record<string, unknown>>,
          conditions: command.parameters.conditions as Array<Record<string, unknown>>,
          active: (command.parameters.active as boolean) ?? false,
        }, command.businessId));
      case 'enable_automation':
        return this.ok(command, start, await this.flow.enableAutomation(command.parameters.flowId as string, command.businessId));
      case 'disable_automation':
        return this.ok(command, start, await this.flow.disableAutomation(command.parameters.flowId as string, command.businessId));
      case 'trigger_flow':
        return this.ok(command, start, await this.flow.triggerFlow(command.parameters.flowId as string, command.parameters.contactId as string, command.parameters.payload as Record<string, unknown>, command.businessId));
      case 'delete_automation':
        return this.ok(command, start, await this.flow.deleteAutomation(command.parameters.flowId as string, command.businessId));
      case 'update_automation':
        return this.ok(command, start, await this.flow.updateAutomation(command.parameters.flowId as string, {
          name: command.parameters.name as string,
          actions: command.parameters.actions as Array<Record<string, unknown>>,
          conditions: command.parameters.conditions as Array<Record<string, unknown>>,
          active: command.parameters.active as boolean,
        }, command.businessId));
      case 'clone_automation':
        return this.ok(command, start, await this.flow.cloneAutomation(command.parameters.flowId as string, command.parameters.newName as string, command.businessId));
      case 'run_test':
        return this.ok(command, start, await this.flow.runTest(command.parameters.flowId as string, command.parameters.contactId as string, command.businessId));
      default:
        return this.fail(command, start, `Unknown flow action: ${command.action}`);
    }
  }

  // ── 7. AUTOPILOT ──────────────────────────────────────────────────────────
  private async executeAutopilotAction(command: ConnectorCommand): Promise<ConnectorResult> {
    const start = Date.now();
    switch (command.action) {
      case 'start_autopilot':
        return this.ok(command, start, await this.autopilot.startAutopilot(command.parameters.workflowId as string, command.parameters.context as Record<string, unknown>, command.businessId));
      case 'stop_autopilot':
        return this.ok(command, start, await this.autopilot.stopAutopilot(command.parameters.runId as string, command.businessId));
      case 'create_workflow':
        return this.ok(command, start, await this.autopilot.createWorkflow({
          name: command.parameters.name as string,
          description: command.parameters.description as string,
          steps: command.parameters.steps as Array<Record<string, unknown>>,
          trigger: command.parameters.trigger as string,
        }, command.businessId));
      case 'update_workflow':
        return this.ok(command, start, await this.autopilot.updateWorkflow(command.parameters.workflowId as string, {
          name: command.parameters.name as string,
          steps: command.parameters.steps as Array<Record<string, unknown>>,
          active: command.parameters.active as boolean,
        }, command.businessId));
      case 'delete_workflow':
        return this.ok(command, start, await this.autopilot.deleteWorkflow(command.parameters.workflowId as string, command.businessId));
      default:
        return this.fail(command, start, `Unknown autopilot action: ${command.action}`);
    }
  }

  // ── 8. TEMPORAL ───────────────────────────────────────────────────────────
  private async executeTemporalAction(command: ConnectorCommand): Promise<ConnectorResult> {
    const start = Date.now();
    switch (command.action) {
      case 'store_memory':
        return this.ok(command, start, await this.temporal.storeMemory(command.parameters.key as string, command.parameters.value as string, {
          scope: (command.parameters.scope as string) ?? 'contact',
          contactId: command.parameters.contactId as string,
          ttl: command.parameters.ttl as number,
        }, command.businessId));
      case 'recall_memory':
        return this.ok(command, start, await this.temporal.recallMemory(command.parameters.key as string, {
          scope: (command.parameters.scope as string) ?? 'contact',
          contactId: command.parameters.contactId as string,
        }, command.businessId));
      case 'forget_memory':
        return this.ok(command, start, await this.temporal.forgetMemory(command.parameters.key as string, {
          scope: (command.parameters.scope as string) ?? 'contact',
          contactId: command.parameters.contactId as string,
        }, command.businessId));
      case 'store_context':
        return this.ok(command, start, await this.temporal.storeContext(command.parameters.contextType as string, command.parameters.data as Record<string, unknown>, command.parameters.contactId as string, command.businessId));
      case 'get_context_history':
        return this.ok(command, start, await this.temporal.getContextHistory(command.businessId, {
          contactId: command.parameters.contactId as string,
          contextType: command.parameters.contextType as string,
          limit: (command.parameters.limit as number) ?? 20,
        }));
      case 'set_reminder':
        return this.ok(command, start, await this.temporal.setReminder({
          title: command.parameters.title as string,
          dueAt: command.parameters.dueAt as string,
          contactId: command.parameters.contactId as string,
          recurring: (command.parameters.recurring as boolean) ?? false,
        }, command.businessId));
      case 'complete_reminder':
        return this.ok(command, start, await this.temporal.completeReminder(command.parameters.reminderId as string, command.businessId));
      default:
        return this.fail(command, start, `Unknown temporal action: ${command.action}`);
    }
  }

  // ── 9. INBOX ──────────────────────────────────────────────────────────────
  private async executeInboxAction(command: ConnectorCommand): Promise<ConnectorResult> {
    const start = Date.now();
    switch (command.action) {
      case 'archive_item':
        return this.ok(command, start, await this.inbox.archiveItem(command.parameters.itemId as string, command.businessId));
      case 'mark_important':
        return this.ok(command, start, await this.inbox.markImportant(command.parameters.itemId as string, command.businessId));
      case 'assign_item':
        return this.ok(command, start, await this.inbox.assignItem(command.parameters.itemId as string, command.parameters.userId as string, command.businessId));
      case 'add_internal_note':
        return this.ok(command, start, await this.inbox.addInternalNote(command.parameters.itemId as string, command.parameters.body as string, command.businessId));
      case 'create_ticket':
        return this.ok(command, start, await this.inbox.createTicket(command.parameters.itemId as string, {
          priority: (command.parameters.priority as string) ?? 'medium',
          category: command.parameters.category as string,
        }, command.businessId));
      case 'resolve_ticket':
        return this.ok(command, start, await this.inbox.resolveTicket(command.parameters.ticketId as string, command.parameters.resolution as string, command.businessId));
      case 'escalate_ticket':
        return this.ok(command, start, await this.inbox.escalateTicket(command.parameters.ticketId as string, command.parameters.reason as string, command.businessId));
      default:
        return this.fail(command, start, `Unknown inbox action: ${command.action}`);
    }
  }

  // ── 10. NOTIFICATIONS ─────────────────────────────────────────────────────
  private async executeNotificationsAction(command: ConnectorCommand): Promise<ConnectorResult> {
    const start = Date.now();
    switch (command.action) {
      case 'send_push':
        return this.ok(command, start, await this.notifications.sendPush(command.parameters.userId as string, command.parameters.title as string, command.parameters.body as string, {
          deepLink: command.parameters.deepLink as string,
          data: command.parameters.data as Record<string, unknown>,
        }, command.businessId));
      case 'send_in_app':
        return this.ok(command, start, await this.notifications.sendInApp(command.parameters.userId as string, command.parameters.title as string, command.parameters.body as string, {
          type: (command.parameters.type as string) ?? 'info',
        }, command.businessId));
      case 'update_preferences':
        return this.ok(command, start, await this.notifications.updatePreferences(command.parameters.userId as string, command.parameters.channel as string, command.parameters.enabled as boolean, {
          category: command.parameters.category as string,
        }, command.businessId));
      case 'create_notification_rule':
        return this.ok(command, start, await this.notifications.createNotificationRule({
          name: command.parameters.name as string,
          trigger: command.parameters.trigger as string,
          channel: command.parameters.channel as string,
          template: command.parameters.template as string,
        }, command.businessId));
      default:
        return this.fail(command, start, `Unknown notifications action: ${command.action}`);
    }
  }

  // ── 11. PROJECTS ──────────────────────────────────────────────────────────
  private async executeProjectsAction(command: ConnectorCommand): Promise<ConnectorResult> {
    const start = Date.now();
    switch (command.action) {
      case 'create_project':
        return this.ok(command, start, await this.projects.createProject({
          name: command.parameters.name as string,
          description: command.parameters.description as string,
          ownerId: command.parameters.ownerId as string,
          dueDate: command.parameters.dueDate as string,
          status: (command.parameters.status as string) ?? 'planning',
        }, command.businessId));
      case 'create_task':
        return this.ok(command, start, await this.projects.createTask(command.parameters.projectId as string, {
          title: command.parameters.title as string,
          description: command.parameters.description as string,
          assignedTo: command.parameters.assignedTo as string,
          dueDate: command.parameters.dueDate as string,
          priority: (command.parameters.priority as string) ?? 'medium',
        }, command.businessId));
      case 'update_task':
        return this.ok(command, start, await this.projects.updateTask(command.parameters.taskId as string, {
          title: command.parameters.title as string,
          status: command.parameters.status as string,
          assignedTo: command.parameters.assignedTo as string,
        }, command.businessId));
      case 'complete_task':
        return this.ok(command, start, await this.projects.completeTask(command.parameters.taskId as string, command.parameters.notes as string, command.businessId));
      case 'add_milestone':
        return this.ok(command, start, await this.projects.addMilestone(command.parameters.projectId as string, {
          name: command.parameters.name as string,
          dueDate: command.parameters.dueDate as string,
        }, command.businessId));
      case 'complete_milestone':
        return this.ok(command, start, await this.projects.completeMilestone(command.parameters.milestoneId as string, command.businessId));
      case 'archive_project':
        return this.ok(command, start, await this.projects.archiveProject(command.parameters.projectId as string, command.businessId));
      case 'add_comment':
        return this.ok(command, start, await this.projects.addComment(command.parameters.targetId as string, command.parameters.body as string, command.businessId));
      default:
        return this.fail(command, start, `Unknown projects action: ${command.action}`);
    }
  }

  // ── 12. ACTIVITY ──────────────────────────────────────────────────────────
  private async executeActivityAction(command: ConnectorCommand): Promise<ConnectorResult> {
    const start = Date.now();
    switch (command.action) {
      case 'log_activity':
        return this.ok(command, start, await this.activity.logActivity(command.parameters.entityType as string, command.parameters.entityId as string, command.parameters.action as string, {
          actorId: command.parameters.actorId as string,
          metadata: command.parameters.metadata as Record<string, unknown>,
        }, command.businessId));
      case 'create_activity_feed':
        return this.ok(command, start, await this.activity.createActivityFeed(command.parameters.name as string, command.parameters.filters as Record<string, unknown>, command.businessId));
      default:
        return this.fail(command, start, `Unknown activity action: ${command.action}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  4. HELPER METHODS
  // ═══════════════════════════════════════════════════════════════════════════

  private ok(command: ConnectorCommand, start: number, data: unknown): ConnectorResult {
    return { success: true, data, executionTimeMs: Date.now() - start, command };
  }

  private fail(command: ConnectorCommand, start: number, error: string): ConnectorResult {
    return { success: false, error, executionTimeMs: Date.now() - start, command };
  }

  getCapabilityRegistry(): ModuleCapability[] {
    return this.MODULE_CAPABILITIES;
  }

  getModuleCapability(module: ModuleName): ModuleCapability | undefined {
    return this.MODULE_CAPABILITIES.find((c) => c.module === module);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  5. CONTEXT BUILDERS — assemble per-module context for the AI reasoning engine
  // ═══════════════════════════════════════════════════════════════════════════

  async getFullContext(businessId: string): Promise<FullBusinessContext> {
    const gatheredAt = new Date();

    // Gather context from each module in parallel
    const [
      crmContext,
      commerceContext,
      bookingsContext,
      communicationsContext,
      projectsContext,
      notificationsContext,
      keystoreContext,
    ] = await Promise.all([
      this.buildCrmContext(businessId),
      this.buildCommerceContext(businessId),
      this.buildBookingsContext(businessId),
      this.buildCommunicationsContext(businessId),
      this.buildProjectsContext(businessId),
      this.buildNotificationsContext(businessId),
      this.buildKeystoreContext(businessId),
    ]);

    const activeAlerts =
      (crmContext.urgentItems?.length ?? 0) +
      (commerceContext.urgentItems?.length ?? 0) +
      (notificationsContext.urgentItems?.length ?? 0) +
      (keystoreContext.urgentItems?.length ?? 0);

    const pendingTasks =
      (crmContext.data?.openTasks as number) ?? 0 +
      (projectsContext.data?.openTasks as number) ?? 0 +
      (keystoreContext.data?.pendingQuote as number) ?? 0;

    const recentRevenue = (commerceContext.data?.recentRevenue as number) ?? 0;
    const openConversations = (communicationsContext.data?.openConversations as number) ?? 0;

    return {
      businessId,
      gatheredAt,
      modules: {
        crm: crmContext,
        commerce: commerceContext,
        bookings: bookingsContext,
        communications: communicationsContext,
        projects: projectsContext,
        notifications: notificationsContext,
        keystore: keystoreContext,
      },
      activeAlerts,
      pendingTasks,
      recentRevenue,
      openConversations,
    };
  }

  // ── CRM Context ───────────────────────────────────────────────────────────
  private async buildCrmContext(businessId: string): Promise<ModuleContextSlice> {
    try {
      const contacts = await this.crm.listContacts(businessId, { limit: 1 });
      const totalContacts = contacts?.total ?? 0;
      const urgentItems: string[] = [];

      // Check for overdue tasks
      const overdueTasks = await this.crm.getTasks(businessId, { status: 'overdue' });
      if (overdueTasks && overdueTasks.length > 0) {
        urgentItems.push(`${overdueTasks.length} overdue CRM tasks`);
      }

      return {
        module: 'crm',
        summary: `${totalContacts} contacts`,
        recordCount: totalContacts,
        urgentItems,
        data: { totalContacts, overdueTasks: overdueTasks?.length ?? 0 },
      };
    } catch {
      return { module: 'crm', summary: 'CRM data unavailable', recordCount: 0, urgentItems: [], data: {} };
    }
  }

  // ── Commerce Context ──────────────────────────────────────────────────────
  private async buildCommerceContext(businessId: string): Promise<ModuleContextSlice> {
    try {
      const outstanding = await this.commerce.getOutstandingInvoices(businessId);
      const totalOutstanding = outstanding?.length ?? 0;
      const urgentItems: string[] = [];

      if (totalOutstanding > 0) {
        urgentItems.push(`${totalOutstanding} outstanding invoices`);
      }

      return {
        module: 'commerce',
        summary: `${totalOutstanding} outstanding invoices`,
        recordCount: totalOutstanding,
        urgentItems,
        data: { outstandingInvoices: totalOutstanding },
      };
    } catch {
      return { module: 'commerce', summary: 'Commerce data unavailable', recordCount: 0, urgentItems: [], data: {} };
    }
  }

  // ── Bookings Context ──────────────────────────────────────────────────────
  private async buildBookingsContext(businessId: string): Promise<ModuleContextSlice> {
    try {
      const upcoming = await this.bookings.getUpcomingBookings(businessId, {});
      const totalBookings = upcoming?.length ?? 0;
      return {
        module: 'bookings',
        summary: `${totalBookings} upcoming bookings`,
        recordCount: totalBookings,
        urgentItems: [],
        data: { upcomingBookings: totalBookings },
      };
    } catch {
      return { module: 'bookings', summary: 'Bookings data unavailable', recordCount: 0, urgentItems: [], data: {} };
    }
  }

  // ── Communications Context ────────────────────────────────────────────────
  private async buildCommunicationsContext(businessId: string): Promise<ModuleContextSlice> {
    try {
      const unread = await this.communications.getUnreadCount(businessId);
      const urgentItems: string[] = [];
      if (unread > 0) {
        urgentItems.push(`${unread} unread messages`);
      }
      return {
        module: 'communications',
        summary: `${unread} unread messages`,
        recordCount: unread,
        urgentItems,
        data: { unreadMessages: unread, openConversations: unread },
      };
    } catch {
      return { module: 'communications', summary: 'Communications data unavailable', recordCount: 0, urgentItems: [], data: {} };
    }
  }

  // ── Projects Context ──────────────────────────────────────────────────────
  private async buildProjectsContext(businessId: string): Promise<ModuleContextSlice> {
    try {
      const tasks = await this.projects.getUserTasks(command.userId, { status: 'todo' });
      const openTasks = tasks?.length ?? 0;
      return {
        module: 'projects',
        summary: `${openTasks} open tasks`,
        recordCount: openTasks,
        urgentItems: [],
        data: { openTasks },
      };
    } catch {
      return { module: 'projects', summary: 'Projects data unavailable', recordCount: 0, urgentItems: [], data: {} };
    }
  }

  // ── Notifications Context ─────────────────────────────────────────────────
  private async buildNotificationsContext(businessId: string): Promise<ModuleContextSlice> {
    try {
      const pending = await this.notifications.getPendingNotifications(businessId);
      const totalPending = pending?.length ?? 0;
      const urgentItems: string[] = [];
      if (totalPending > 0) {
        urgentItems.push(`${totalPending} pending notifications`);
      }
      return {
        module: 'notifications',
        summary: `${totalPending} pending notifications`,
        recordCount: totalPending,
        urgentItems,
        data: { pendingNotifications: totalPending },
      };
    } catch {
      return { module: 'notifications', summary: 'Notifications data unavailable', recordCount: 0, urgentItems: [], data: {} };
    }
  }

  // ── KEYSTORE Context ──────────────────────────────────────────────────────
  private async buildKeystoreContext(businessId: string): Promise<ModuleContextSlice> {
    try {
      const stats = await this.keystore.getOrderStats(businessId);
      const urgentItems: string[] = [];
      if (stats.pendingQuote > 0) {
        urgentItems.push(`${stats.pendingQuote} orders awaiting quote`);
      }
      if (stats.inProgress > 0) {
        urgentItems.push(`${stats.inProgress} orders in progress`);
      }
      return {
        module: 'keystore',
        summary: `${stats.totalOrders} orders (${stats.delivered} delivered)`,
        recordCount: stats.totalOrders,
        urgentItems,
        data: stats,
      };
    } catch {
      return { module: 'keystore', summary: 'Keystore data unavailable', recordCount: 0, urgentItems: [], data: {} };
    }
  }
}
