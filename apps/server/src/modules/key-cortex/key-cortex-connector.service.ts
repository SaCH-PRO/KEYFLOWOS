import { Injectable, Logger, Optional, Inject } from '@nestjs/common';

// ─── Connector Types ─────────────────────────────────────────────────────────
import {
  ConnectorCommand,
  ConnectorCommandResult,
  ConnectorDataRequest,
  ConnectorDataResult,
  ConnectorActionDefinition,
  ConnectorQueryDefinition,
  ModuleCapability,
  ModuleName,
} from './key-cortex-connector.types';

// ─── KeyFlowOS module services (12 injected adapters) ──────────────────────────
import { ToolRegistryService } from './tool-registry.service';
import { CrmService } from '../crm/crm.service';
import { CommerceService } from '../commerce/commerce.service';
import { BookingsService } from '../bookings/bookings.service';
import { ContentService } from '../content/content.service';
import { CommunicationsService } from '../communications/communications.service';
import { FlowService } from '../flow/flow.service';
import { AutopilotService } from '../autopilot/autopilot.service';
import { TemporalFlowMemoryService } from '../temporal/temporal-flow-memory.service';
import { KeyInboxService } from '../key-inbox/key-inbox.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ProjectsService } from '../projects/projects.service';
import { ActivityService } from '../activity/activity.service';
import { KeystoreService } from '../keystore/keystore.service';

// ─── Shared Types ─────────────────────────────────────────────────────────────
import { UnifiedEvent } from '../../shared/types';

// ─── Module Action/Query Registry ─────────────────────────────────────────────
/**
 * Static registry of all capabilities across every KeyFlowOS module.
 * Each entry defines what actions and queries a module supports.
 */
const MODULE_CAPABILITIES: Record<ModuleName, Omit<ModuleCapability, 'module'>> = {
  crm: {
    description:
      'CRM — Manage contacts, leads, pipelines, follow-ups, notes, tasks, and deal stages.',
    actions: [
      {
        name: 'create_contact',
        description: 'Create a new contact with name, email, phone, tags, and custom fields.',
        parameters: [
          { name: 'name', type: 'string', required: true, description: 'Contact full name' },
          { name: 'email', type: 'string', required: false, description: 'Contact email address' },
          { name: 'phone', type: 'string', required: false, description: 'Phone number' },
          { name: 'tags', type: 'string[]', required: false, description: 'Tags to assign' },
          { name: 'source', type: 'string', required: false, description: 'Lead source' },
          { name: 'notes', type: 'string', required: false, description: 'Initial notes' },
        ],
        examples: [
          'Create contact John Smith with email john@example.com',
          'Add lead Sarah Johnson from website, tag as VIP',
        ],
      },
      {
        name: 'update_contact',
        description: 'Update an existing contact by ID or email.',
        parameters: [
          { name: 'contactId', type: 'string', required: true, description: 'Contact ID or email' },
          { name: 'fields', type: 'object', required: true, description: 'Fields to update' },
        ],
        examples: [
          'Update contact john@example.com — set phone to +1-555-0100',
          'Change Sarah Johnson status to qualified',
        ],
      },
      {
        name: 'delete_contact',
        description: 'Delete (soft-delete) a contact by ID or email.',
        parameters: [
          { name: 'contactId', type: 'string', required: true, description: 'Contact ID or email' },
        ],
        examples: ['Delete contact john@example.com'],
      },
      {
        name: 'add_note',
        description: 'Add a note/timeline entry to a contact.',
        parameters: [
          { name: 'contactId', type: 'string', required: true, description: 'Contact ID' },
          { name: 'content', type: 'string', required: true, description: 'Note content' },
        ],
        examples: ['Add note to Sarah: Had discovery call, interested in Pro plan'],
      },
      {
        name: 'create_task',
        description: 'Create a CRM follow-up task tied to a contact.',
        parameters: [
          { name: 'contactId', type: 'string', required: true, description: 'Contact ID' },
          { name: 'title', type: 'string', required: true, description: 'Task title' },
          { name: 'dueDate', type: 'string', required: false, description: 'Due date (ISO 8601)' },
          { name: 'priority', type: 'string', required: false, description: 'low | medium | high' },
        ],
        examples: ['Create follow-up task for Sarah Johnson due Friday'],
      },
      {
        name: 'move_pipeline_stage',
        description: 'Move a lead/deal to a different pipeline stage.',
        parameters: [
          { name: 'leadId', type: 'string', required: true, description: 'Lead ID' },
          { name: 'stage', type: 'string', required: true, description: 'Target stage name' },
        ],
        examples: ['Move lead Sarah Johnson to Negotiation stage'],
      },
      {
        name: 'schedule_follow_up',
        description: 'Schedule an automated follow-up for a contact.',
        parameters: [
          { name: 'contactId', type: 'string', required: true, description: 'Contact ID' },
          { name: 'date', type: 'string', required: true, description: 'Follow-up date (ISO 8601)' },
          { name: 'method', type: 'string', required: false, description: 'email | call | sms' },
        ],
        examples: ['Schedule email follow-up for John Smith next Monday'],
      },
    ],
    queries: [
      {
        name: 'list_contacts',
        description: 'List contacts with optional filters.',
        parameters: [
          { name: 'limit', type: 'number', required: false, description: 'Max results (default 50)' },
          { name: 'offset', type: 'number', required: false, description: 'Pagination offset' },
          { name: 'status', type: 'string', required: false, description: 'Filter by status' },
          { name: 'tag', type: 'string', required: false, description: 'Filter by tag' },
          { name: 'search', type: 'string', required: false, description: 'Search by name/email' },
          { name: 'source', type: 'string', required: false, description: 'Filter by lead source' },
          { name: 'sortBy', type: 'string', required: false, description: 'Field to sort by' },
          { name: 'sortOrder', type: 'string', required: false, description: 'asc | desc' },
        ],
      },
      {
        name: 'get_contact',
        description: 'Get a single contact with full timeline.',
        parameters: [
          { name: 'contactId', type: 'string', required: true, description: 'Contact ID or email' },
        ],
      },
      {
        name: 'get_pipeline',
        description: 'Get the full pipeline with stage counts.',
        parameters: [
          { name: 'pipelineId', type: 'string', required: false, description: 'Optional pipeline ID' },
        ],
      },
      {
        name: 'get_lead_sources',
        description: 'Get aggregate counts by lead source.',
        parameters: [],
      },
      {
        name: 'get_follow_up_summary',
        description: 'Get a summary of upcoming follow-ups and overdue tasks.',
        parameters: [
          { name: 'days', type: 'number', required: false, description: 'Look-ahead days (default 7)' },
        ],
      },
    ],
  },
  commerce: {
    description:
      'Commerce — Invoicing, quotes, orders, products, subscriptions, payment links, and revenue tracking.',
    actions: [
      {
        name: 'create_invoice',
        description: 'Create and send an invoice to a client.',
        parameters: [
          { name: 'clientId', type: 'string', required: true, description: 'Client contact ID' },
          { name: 'items', type: 'array', required: true, description: 'Line items [{name, quantity, unitPrice, description?}]' },
          { name: 'dueDate', type: 'string', required: false, description: 'Due date (ISO 8601, default +30d)' },
          { name: 'notes', type: 'string', required: false, description: 'Invoice notes / terms' },
          { name: 'currency', type: 'string', required: false, description: 'Currency code (default USD)' },
          { name: 'sendEmail', type: 'boolean', required: false, description: 'Send via email immediately' },
        ],
        examples: [
          'Create invoice for John Smith — Consulting: $2,000, Design: $1,500, due in 14 days',
          'Invoice Sarah Johnson $500 for monthly retainer',
        ],
      },
      {
        name: 'create_quote',
        description: 'Create a quote/estimate for a client.',
        parameters: [
          { name: 'clientId', type: 'string', required: true, description: 'Client contact ID' },
          { name: 'items', type: 'array', required: true, description: 'Line items' },
          { name: 'validUntil', type: 'string', required: false, description: 'Quote expiry date' },
          { name: 'notes', type: 'string', required: false, description: 'Quote notes / terms' },
        ],
        examples: ['Create quote for ABC Corp — Logo design $3,000 valid until Dec 31'],
      },
      {
        name: 'convert_quote_to_invoice',
        description: 'Convert an approved quote into an invoice.',
        parameters: [
          { name: 'quoteId', type: 'string', required: true, description: 'Quote ID' },
        ],
        examples: ['Convert quote QT-001 to invoice'],
      },
      {
        name: 'record_payment',
        description: 'Record a payment received against an invoice.',
        parameters: [
          { name: 'invoiceId', type: 'string', required: true, description: 'Invoice ID' },
          { name: 'amount', type: 'number', required: true, description: 'Payment amount' },
          { name: 'method', type: 'string', required: false, description: 'bank_transfer | credit_card | cash | check | other' },
          { name: 'date', type: 'string', required: false, description: 'Payment date (ISO 8601)' },
          { name: 'reference', type: 'string', required: false, description: 'Transaction reference / note' },
        ],
        examples: ['Record $1,000 payment on invoice INV-001 via bank transfer'],
      },
      {
        name: 'create_product',
        description: 'Add a new product or service to the catalog.',
        parameters: [
          { name: 'name', type: 'string', required: true, description: 'Product name' },
          { name: 'price', type: 'number', required: true, description: 'Unit price' },
          { name: 'description', type: 'string', required: false, description: 'Product description' },
          { name: 'category', type: 'string', required: false, description: 'Category' },
          { name: 'sku', type: 'string', required: false, description: 'SKU code' },
          { name: 'taxable', type: 'boolean', required: false, description: 'Whether product is taxable' },
        ],
        examples: ['Add product "Premium Logo Design" priced at $2,500'],
      },
      {
        name: 'send_payment_reminder',
        description: 'Send a payment reminder email for an invoice.',
        parameters: [
          { name: 'invoiceId', type: 'string', required: true, description: 'Invoice ID' },
          { name: 'message', type: 'string', required: false, description: 'Custom reminder message' },
        ],
        examples: ['Send payment reminder for invoice INV-001 — "Friendly reminder, your invoice is due"'],
      },
      {
        name: 'create_subscription',
        description: 'Create a recurring subscription for a client.',
        parameters: [
          { name: 'clientId', type: 'string', required: true, description: 'Client contact ID' },
          { name: 'productId', type: 'string', required: true, description: 'Product ID' },
          { name: 'frequency', type: 'string', required: true, description: 'monthly | quarterly | yearly' },
          { name: 'startDate', type: 'string', required: false, description: 'Start date (ISO 8601)' },
          { name: 'endDate', type: 'string', required: false, description: 'End date (ISO 8601, optional)' },
        ],
        examples: ['Create monthly subscription for John Smith on Premium Plan starting next month'],
      },
    ],
    queries: [
      {
        name: 'list_invoices',
        description: 'List invoices with optional filters.',
        parameters: [
          { name: 'limit', type: 'number', required: false, description: 'Max results (default 50)' },
          { name: 'status', type: 'string', required: false, description: 'draft | sent | paid | overdue | cancelled' },
          { name: 'clientId', type: 'string', required: false, description: 'Filter by client' },
          { name: 'dateFrom', type: 'string', required: false, description: 'Start date (ISO 8601)' },
          { name: 'dateTo', type: 'string', required: false, description: 'End date (ISO 8601)' },
          { name: 'minAmount', type: 'number', required: false, description: 'Minimum amount' },
          { name: 'maxAmount', type: 'number', required: false, description: 'Maximum amount' },
          { name: 'sortBy', type: 'string', required: false, description: 'Field to sort by' },
          { name: 'sortOrder', type: 'string', required: false, description: 'asc | desc' },
        ],
      },
      {
        name: 'get_invoice',
        description: 'Get a single invoice with all details.',
        parameters: [
          { name: 'invoiceId', type: 'string', required: true, description: 'Invoice ID' },
        ],
      },
      {
        name: 'get_revenue_summary',
        description: 'Get revenue totals grouped by period.',
        parameters: [
          { name: 'period', type: 'string', required: false, description: 'day | week | month | quarter | year' },
          { name: 'dateFrom', type: 'string', required: false, description: 'Start date' },
          { name: 'dateTo', type: 'string', required: false, description: 'End date' },
          { name: 'clientId', type: 'string', required: false, description: 'Filter by client' },
        ],
      },
      {
        name: 'get_aging_report',
        description: 'Get invoice aging report (overdue buckets).',
        parameters: [
          { name: 'asOfDate', type: 'string', required: false, description: 'Report date (default today)' },
        ],
      },
      {
        name: 'list_products',
        description: 'List products/services in the catalog.',
        parameters: [
          { name: 'limit', type: 'number', required: false, description: 'Max results (default 50)' },
          { name: 'category', type: 'string', required: false, description: 'Filter by category' },
          { name: 'search', type: 'string', required: false, description: 'Search by name' },
        ],
      },
    ],
  },
  bookings: {
    description:
      'Bookings — Appointment scheduling, availability management, calendar sync, buffer times, and booking pages.',
    actions: [
      {
        name: 'create_booking',
        description: 'Create a new appointment/booking.',
        parameters: [
          { name: 'clientId', type: 'string', required: true, description: 'Client contact ID' },
          { name: 'title', type: 'string', required: true, description: 'Booking title' },
          { name: 'startTime', type: 'string', required: true, description: 'Start time (ISO 8601)' },
          { name: 'endTime', type: 'string', required: true, description: 'End time (ISO 8601)' },
          { name: 'location', type: 'string', required: false, description: 'Physical address or video link' },
          { name: 'notes', type: 'string', required: false, description: 'Booking notes' },
          { name: 'sendConfirmation', type: 'boolean', required: false, description: 'Send confirmation email' },
        ],
        examples: [
          'Book 1-hour strategy call with Sarah Johnson tomorrow at 2 PM',
          'Schedule onboarding session for John Smith next Monday 10-11 AM',
        ],
      },
      {
        name: 'cancel_booking',
        description: 'Cancel an existing booking and optionally notify the client.',
        parameters: [
          { name: 'bookingId', type: 'string', required: true, description: 'Booking ID' },
          { name: 'reason', type: 'string', required: false, description: 'Cancellation reason' },
          { name: 'notifyClient', type: 'boolean', required: false, description: 'Send cancellation notification' },
        ],
        examples: ['Cancel booking BK-001 and notify the client'],
      },
      {
        name: 'reschedule_booking',
        description: 'Reschedule an existing booking to a new time.',
        parameters: [
          { name: 'bookingId', type: 'string', required: true, description: 'Booking ID' },
          { name: 'newStartTime', type: 'string', required: true, description: 'New start time (ISO 8601)' },
          { name: 'newEndTime', type: 'string', required: true, description: 'New end time (ISO 8601)' },
          { name: 'notifyClient', type: 'boolean', required: false, description: 'Send reschedule notification' },
        ],
        examples: ['Reschedule booking BK-001 to Wednesday 3 PM'],
      },
      {
        name: 'check_availability',
        description: 'Check available time slots for a given date range.',
        parameters: [
          { name: 'date', type: 'string', required: true, description: 'Date to check (ISO 8601)' },
          { name: 'durationMinutes', type: 'number', required: true, description: 'Required duration in minutes' },
          { name: 'bufferMinutes', type: 'number', required: false, description: 'Buffer time between bookings' },
        ],
        examples: ['Check availability for 1-hour meetings next Tuesday'],
      },
      {
        name: 'block_time',
        description: 'Block out time on the calendar (personal time, travel, focus time).',
        parameters: [
          { name: 'startTime', type: 'string', required: true, description: 'Start time (ISO 8601)' },
          { name: 'endTime', type: 'string', required: true, description: 'End time (ISO 8601)' },
          { name: 'reason', type: 'string', required: false, description: 'Block reason' },
        ],
        examples: ['Block Friday afternoon 1-5 PM for deep work'],
      },
    ],
    queries: [
      {
        name: 'list_bookings',
        description: 'List bookings with optional date/status filters.',
        parameters: [
          { name: 'limit', type: 'number', required: false, description: 'Max results (default 50)' },
          { name: 'status', type: 'string', required: false, description: 'confirmed | pending | cancelled | completed' },
          { name: 'dateFrom', type: 'string', required: false, description: 'Start date (ISO 8601)' },
          { name: 'dateTo', type: 'string', required: false, description: 'End date (ISO 8601)' },
          { name: 'clientId', type: 'string', required: false, description: 'Filter by client' },
        ],
      },
      {
        name: 'get_booking',
        description: 'Get a single booking with full details.',
        parameters: [
          { name: 'bookingId', type: 'string', required: true, description: 'Booking ID' },
        ],
      },
      {
        name: 'get_upcoming_bookings',
        description: 'Get upcoming bookings for the next N days.',
        parameters: [
          { name: 'days', type: 'number', required: false, description: 'Look-ahead days (default 7)' },
        ],
      },
      {
        name: 'get_availability_slots',
        description: 'Get available time slots for a specific date.',
        parameters: [
          { name: 'date', type: 'string', required: true, description: 'Date (ISO 8601)' },
          { name: 'durationMinutes', type: 'number', required: true, description: 'Required duration' },
        ],
      },
      {
        name: 'get_booking_stats',
        description: 'Get booking statistics for a date range.',
        parameters: [
          { name: 'dateFrom', type: 'string', required: false, description: 'Start date' },
          { name: 'dateTo', type: 'string', required: false, description: 'End date' },
        ],
      },
    ],
  },
  content: {
    description:
      'Content — Blog posts, landing pages, social media content, SEO optimization, and content calendars.',
    actions: [
      {
        name: 'create_blog_post',
        description: 'Create a new blog post / article.',
        parameters: [
          { name: 'title', type: 'string', required: true, description: 'Post title' },
          { name: 'content', type: 'string', required: true, description: 'Post body (markdown)' },
          { name: 'excerpt', type: 'string', required: false, description: 'Short excerpt / meta description' },
          { name: 'tags', type: 'string[]', required: false, description: 'Tags / categories' },
          { name: 'status', type: 'string', required: false, description: 'draft | published | scheduled' },
          { name: 'publishAt', type: 'string', required: false, description: 'Publish date (ISO 8601)' },
          { name: 'seoTitle', type: 'string', required: false, description: 'SEO title' },
          { name: 'seoDescription', type: 'string', required: false, description: 'SEO meta description' },
        ],
        examples: [
          'Create blog post "10 Ways to Automate Your Business" with full content',
        ],
      },
      {
        name: 'create_landing_page',
        description: 'Create a landing page.',
        parameters: [
          { name: 'title', type: 'string', required: true, description: 'Page title' },
          { name: 'slug', type: 'string', required: true, description: 'URL slug' },
          { name: 'sections', type: 'array', required: true, description: 'Page sections' },
          { name: 'meta', type: 'object', required: false, description: 'SEO meta data' },
        ],
        examples: ['Create landing page for new product launch'],
      },
      {
        name: 'schedule_social_post',
        description: 'Schedule a social media post.',
        parameters: [
          { name: 'platform', type: 'string', required: true, description: 'twitter | facebook | linkedin | instagram' },
          { name: 'content', type: 'string', required: true, description: 'Post content' },
          { name: 'scheduledAt', type: 'string', required: true, description: 'Schedule time (ISO 8601)' },
          { name: 'mediaUrls', type: 'string[]', required: false, description: 'Attached media URLs' },
        ],
        examples: ['Schedule Twitter post: "Excited to announce our new feature!" for tomorrow 9 AM'],
      },
      {
        name: 'optimize_seo',
        description: 'Run SEO analysis and optimization on content.',
        parameters: [
          { name: 'contentId', type: 'string', required: true, description: 'Content ID' },
          { name: 'targetKeywords', type: 'string[]', required: true, description: 'Target keywords' },
        ],
        examples: ['Optimize SEO for blog post targeting "workflow automation" and "AI CRM"'],
      },
    ],
    queries: [
      {
        name: 'list_posts',
        description: 'List blog posts / articles.',
        parameters: [
          { name: 'limit', type: 'number', required: false, description: 'Max results (default 50)' },
          { name: 'status', type: 'string', required: false, description: 'draft | published | scheduled' },
          { name: 'tag', type: 'string', required: false, description: 'Filter by tag' },
        ],
      },
      {
        name: 'list_social_posts',
        description: 'List scheduled/published social media posts.',
        parameters: [
          { name: 'limit', type: 'number', required: false, description: 'Max results' },
          { name: 'platform', type: 'string', required: false, description: 'Filter by platform' },
        ],
      },
      {
        name: 'get_seo_score',
        description: 'Get SEO score for a piece of content.',
        parameters: [
          { name: 'contentId', type: 'string', required: true, description: 'Content ID' },
        ],
      },
      {
        name: 'get_content_analytics',
        description: 'Get content performance analytics.',
        parameters: [
          { name: 'dateFrom', type: 'string', required: false, description: 'Start date' },
          { name: 'dateTo', type: 'string', required: false, description: 'End date' },
        ],
      },
    ],
  },
  communications: {
    description:
      'Communications — Email campaigns, SMS, sequence automation, templates, and deliverability analytics.',
    actions: [
      {
        name: 'send_email',
        description: 'Send a single email to a contact or list.',
        parameters: [
          { name: 'to', type: 'string[]', required: true, description: 'Recipient email(s)' },
          { name: 'subject', type: 'string', required: true, description: 'Email subject' },
          { name: 'body', type: 'string', required: true, description: 'Email body (HTML or markdown)' },
          { name: 'fromName', type: 'string', required: false, description: 'Sender name' },
          { name: 'templateId', type: 'string', required: false, description: 'Template ID to use' },
          { name: 'attachments', type: 'array', required: false, description: 'Attachment metadata' },
          { name: 'trackOpens', type: 'boolean', required: false, description: 'Enable open tracking' },
          { name: 'trackClicks', type: 'boolean', required: false, description: 'Enable click tracking' },
        ],
        examples: [
          'Send email to john@example.com: Subject "Your invoice is ready" Body "Hi John, your invoice..."',
          'Send monthly newsletter to VIP list using template TPL-001',
        ],
      },
      {
        name: 'send_sms',
        description: 'Send an SMS to a contact.',
        parameters: [
          { name: 'to', type: 'string', required: true, description: 'Phone number' },
          { name: 'body', type: 'string', required: true, description: 'SMS text' },
        ],
        examples: ['Send SMS to +1-555-0100: "Your appointment is confirmed for tomorrow 2 PM"'],
      },
      {
        name: 'create_email_sequence',
        description: 'Create an automated email sequence / drip campaign.',
        parameters: [
          { name: 'name', type: 'string', required: true, description: 'Sequence name' },
          { name: 'steps', type: 'array', required: true, description: 'Email steps [{templateId, delayDays, subject?}]' },
          { name: 'trigger', type: 'string', required: false, description: 'Trigger condition (tag_added, form_submitted, etc.)' },
        ],
        examples: [
          'Create email sequence "New Lead Nurture" with 5 emails over 14 days',
        ],
      },
      {
        name: 'create_template',
        description: 'Create an email/SMS template.',
        parameters: [
          { name: 'name', type: 'string', required: true, description: 'Template name' },
          { name: 'subject', type: 'string', required: true, description: 'Email subject' },
          { name: 'body', type: 'string', required: true, description: 'Template body (HTML or markdown)' },
          { name: 'type', type: 'string', required: true, description: 'email | sms' },
          { name: 'variables', type: 'string[]', required: false, description: 'Template variables' },
        ],
        examples: ['Create email template "Welcome" with subject "Welcome to {{companyName}}!"'],
      },
      {
        name: 'create_campaign',
        description: 'Create and launch an email campaign.',
        parameters: [
          { name: 'name', type: 'string', required: true, description: 'Campaign name' },
          { name: 'templateId', type: 'string', required: true, description: 'Template ID' },
          { name: 'recipientListId', type: 'string', required: true, description: 'Recipient list ID' },
          { name: 'scheduledAt', type: 'string', required: false, description: 'Launch time (ISO 8601)' },
        ],
        examples: ['Create campaign "Summer Sale" using template TPL-001 for VIP list'],
      },
    ],
    queries: [
      {
        name: 'list_sequences',
        description: 'List email sequences / drip campaigns.',
        parameters: [
          { name: 'limit', type: 'number', required: false, description: 'Max results (default 50)' },
          { name: 'status', type: 'string', required: false, description: 'active | paused | draft | archived' },
        ],
      },
      {
        name: 'list_templates',
        description: 'List email/SMS templates.',
        parameters: [
          { name: 'limit', type: 'number', required: false, description: 'Max results' },
          { name: 'type', type: 'string', required: false, description: 'email | sms' },
        ],
      },
      {
        name: 'get_campaign_analytics',
        description: 'Get email campaign analytics (opens, clicks, bounces).',
        parameters: [
          { name: 'campaignId', type: 'string', required: true, description: 'Campaign ID' },
        ],
      },
      {
        name: 'get_email_stats',
        description: 'Get aggregate email statistics for a date range.',
        parameters: [
          { name: 'dateFrom', type: 'string', required: false, description: 'Start date' },
          { name: 'dateTo', type: 'string', required: false, description: 'End date' },
        ],
      },
    ],
  },
  flow: {
    description:
      'Flow — Workflow automation, triggers, conditions, multi-step automations, and integration webhooks.',
    actions: [
      {
        name: 'create_flow',
        description: 'Create a new workflow / automation flow.',
        parameters: [
          { name: 'name', type: 'string', required: true, description: 'Flow name' },
          { name: 'trigger', type: 'object', required: true, description: 'Trigger config {type, config}' },
          { name: 'steps', type: 'array', required: true, description: 'Flow steps [{type, config, conditions?}]' },
          { name: 'description', type: 'string', required: false, description: 'Flow description' },
          { name: 'isActive', type: 'boolean', required: false, description: 'Activate immediately' },
        ],
        examples: [
          'Create flow "New Lead → Welcome Email → Task" triggered when lead tag "VIP" is added',
        ],
      },
      {
        name: 'run_flow',
        description: 'Manually trigger/run a workflow.',
        parameters: [
          { name: 'flowId', type: 'string', required: true, description: 'Flow ID' },
          { name: 'context', type: 'object', required: false, description: 'Runtime context data' },
        ],
        examples: ['Run flow FL-001 with context {contactId: "123"}'],
      },
      {
        name: 'toggle_flow',
        description: 'Enable or disable a workflow.',
        parameters: [
          { name: 'flowId', type: 'string', required: true, description: 'Flow ID' },
          { name: 'active', type: 'boolean', required: true, description: 'true to enable, false to disable' },
        ],
        examples: ['Enable flow FL-001', 'Pause flow FL-002'],
      },
      {
        name: 'create_webhook',
        description: 'Create an incoming webhook for a workflow.',
        parameters: [
          { name: 'name', type: 'string', required: true, description: 'Webhook name' },
          { name: 'flowId', type: 'string', required: true, description: 'Flow ID to trigger' },
          { name: 'secret', type: 'string', required: false, description: 'Optional secret for verification' },
        ],
        examples: ['Create webhook for Flow FL-001 named "Zapier Integration"'],
      },
    ],
    queries: [
      {
        name: 'list_flows',
        description: 'List workflows / automations.',
        parameters: [
          { name: 'limit', type: 'number', required: false, description: 'Max results (default 50)' },
          { name: 'status', type: 'string', required: false, description: 'active | paused | draft | archived' },
        ],
      },
      {
        name: 'get_flow',
        description: 'Get a single workflow with full step details.',
        parameters: [
          { name: 'flowId', type: 'string', required: true, description: 'Flow ID' },
        ],
      },
      {
        name: 'get_flow_execution_log',
        description: 'Get execution history for a workflow.',
        parameters: [
          { name: 'flowId', type: 'string', required: true, description: 'Flow ID' },
          { name: 'limit', type: 'number', required: false, description: 'Max results' },
        ],
      },
    ],
  },
  autopilot: {
    description:
      'Autopilot — Background task automation, loops (persistent workflows), monitoring agents, and execution logs.',
    actions: [
      {
        name: 'create_loop',
        description: 'Create a persistent loop (background task automation).',
        parameters: [
          { name: 'name', type: 'string', required: true, description: 'Loop name' },
          { name: 'frequency', type: 'string', required: true, description: 'hourly | daily | weekly | custom' },
          { name: 'actions', type: 'array', required: true, description: 'Actions to run each iteration' },
          { name: 'conditions', type: 'array', required: false, description: 'Guard conditions' },
          { name: 'maxIterations', type: 'number', required: false, description: 'Max runs (default: unlimited)' },
          { name: 'startImmediately', type: 'boolean', required: false, description: 'Start right away' },
        ],
        examples: [
          'Create loop "Daily Invoice Reminder" — every day at 9 AM, send payment reminders for overdue invoices',
        ],
      },
      {
        name: 'run_loop',
        description: 'Manually execute a loop iteration.',
        parameters: [
          { name: 'loopId', type: 'string', required: true, description: 'Loop ID' },
        ],
        examples: ['Run loop LP-001 now'],
      },
      {
        name: 'pause_loop',
        description: 'Pause a running loop.',
        parameters: [
          { name: 'loopId', type: 'string', required: true, description: 'Loop ID' },
        ],
        examples: ['Pause loop LP-001'],
      },
      {
        name: 'resume_loop',
        description: 'Resume a paused loop.',
        parameters: [
          { name: 'loopId', type: 'string', required: true, description: 'Loop ID' },
        ],
        examples: ['Resume loop LP-001'],
      },
      {
        name: 'stop_loop',
        description: 'Permanently stop a loop.',
        parameters: [
          { name: 'loopId', type: 'string', required: true, description: 'Loop ID' },
        ],
        examples: ['Stop loop LP-001'],
      },
      {
        name: 'create_monitor',
        description: 'Create a monitoring agent that watches for specific conditions.',
        parameters: [
          { name: 'name', type: 'string', required: true, description: 'Monitor name' },
          { name: 'watchType', type: 'string', required: true, description: 'invoice_overdue | lead_inactive | low_inventory | custom' },
          { name: 'threshold', type: 'object', required: true, description: 'Threshold config' },
          { name: 'alertChannels', type: 'string[]', required: false, description: 'email | sms | slack | in_app' },
        ],
        examples: ['Create monitor "Overdue Invoice Alert" for invoices > 7 days overdue'],
      },
    ],
    queries: [
      {
        name: 'list_loops',
        description: 'List all loops (persistent automations).',
        parameters: [
          { name: 'limit', type: 'number', required: false, description: 'Max results (default 50)' },
          { name: 'status', type: 'string', required: false, description: 'running | paused | stopped | error' },
        ],
      },
      {
        name: 'get_loop',
        description: 'Get loop details with execution history.',
        parameters: [
          { name: 'loopId', type: 'string', required: true, description: 'Loop ID' },
        ],
      },
      {
        name: 'list_monitors',
        description: 'List monitoring agents.',
        parameters: [
          { name: 'limit', type: 'number', required: false, description: 'Max results' },
          { name: 'status', type: 'string', required: false, description: 'active | paused | triggered' },
        ],
      },
      {
        name: 'get_execution_log',
        description: 'Get autopilot execution log entries.',
        parameters: [
          { name: 'limit', type: 'number', required: false, description: 'Max results' },
          { name: 'entityType', type: 'string', required: false, description: 'loop | monitor | task' },
          { name: 'status', type: 'string', required: false, description: 'success | error | warning' },
        ],
      },
    ],
  },
  temporal: {
    description:
      'Temporal — Business memory and long-term persistence for workflows. This is the system\'s "enterprise hippocampus."',
    actions: [
      {
        name: 'store_memory',
        description: 'Store a business memory / long-term fact.',
        parameters: [
          { name: 'key', type: 'string', required: true, description: 'Memory key / topic' },
          { name: 'value', type: 'string', required: true, description: 'Memory content' },
          { name: 'category', type: 'string', required: false, description: 'Memory category' },
          { name: 'importance', type: 'number', required: false, description: 'Importance score 1-10' },
          { name: 'ttlDays', type: 'number', required: false, description: 'Time-to-live in days' },
        ],
        examples: [
          'Store memory: key="Client Preference — ABC Corp", value="Prefers email over calls, quarterly invoicing"',
        ],
      },
      {
        name: 'recall_memory',
        description: 'Recall stored memories by key or semantic search.',
        parameters: [
          { name: 'query', type: 'string', required: true, description: 'Search query / memory key' },
          { name: 'limit', type: 'number', required: false, description: 'Max results (default 10)' },
        ],
        examples: ['Recall memories about "ABC Corp preferences"'],
      },
      {
        name: 'delete_memory',
        description: 'Delete a stored memory by key.',
        parameters: [
          { name: 'key', type: 'string', required: true, description: 'Memory key' },
        ],
        examples: ['Delete memory "Old Vendor — XYZ Suppliers"'],
      },
      {
        name: 'create_document_set',
        description: 'Create a set of documents for RAG / knowledge retrieval.',
        parameters: [
          { name: 'name', type: 'string', required: true, description: 'Document set name' },
          { name: 'documents', type: 'array', required: true, description: 'Documents [{title, content, metadata?}]' },
        ],
        examples: ['Create document set "Standard Operating Procedures" with all company SOPs'],
      },
    ],
    queries: [
      {
        name: 'search_memories',
        description: 'Search memories with full-text or semantic search.',
        parameters: [
          { name: 'query', type: 'string', required: true, description: 'Search query' },
          { name: 'limit', type: 'number', required: false, description: 'Max results (default 10)' },
          { name: 'category', type: 'string', required: false, description: 'Filter by category' },
        ],
      },
      {
        name: 'get_memory_categories',
        description: 'Get all memory categories with counts.',
        parameters: [],
      },
      {
        name: 'rag_query',
        description: 'Query a document set using RAG (Retrieval-Augmented Generation).',
        parameters: [
          { name: 'documentSetId', type: 'string', required: true, description: 'Document set ID' },
          { name: 'question', type: 'string', required: true, description: 'Question to answer' },
          { name: 'limit', type: 'number', required: false, description: 'Max source chunks (default 5)' },
        ],
      },
    ],
  },
  inbox: {
    description:
      'Inbox — Unified message inbox, note-taking, @mentions, conversation threading, and team collaboration.',
    actions: [
      {
        name: 'create_note',
        description: 'Create a note in the unified inbox.',
        parameters: [
          { name: 'content', type: 'string', required: true, description: 'Note content' },
          { name: 'title', type: 'string', required: false, description: 'Note title' },
          { name: 'tags', type: 'string[]', required: false, description: 'Tags' },
          { name: 'mentions', type: 'string[]', required: false, description: '@mentioned user IDs' },
          { name: 'linkedEntityType', type: 'string', required: false, description: 'crm_contact | booking | invoice | project' },
          { name: 'linkedEntityId', type: 'string', required: false, description: 'Linked entity ID' },
        ],
        examples: [
          'Create note: "Call Sarah about proposal — she prefers mornings" and link to her contact',
        ],
      },
      {
        name: 'reply_to_thread',
        description: 'Reply to an existing conversation thread.',
        parameters: [
          { name: 'threadId', type: 'string', required: true, description: 'Thread ID' },
          { name: 'content', type: 'string', required: true, description: 'Reply content' },
        ],
        examples: ['Reply to thread TH-001: "Thanks for the update, let\'s proceed"'],
      },
      {
        name: 'mark_read',
        description: 'Mark a message or thread as read.',
        parameters: [
          { name: 'messageId', type: 'string', required: true, description: 'Message ID' },
        ],
        examples: ['Mark message MSG-001 as read'],
      },
      {
        name: 'pin_note',
        description: 'Pin a note to the top of the inbox.',
        parameters: [
          { name: 'noteId', type: 'string', required: true, description: 'Note ID' },
        ],
        examples: ['Pin note NT-001'],
      },
      {
        name: 'create_task_from_note',
        description: 'Convert a note into an autopilot task.',
        parameters: [
          { name: 'noteId', type: 'string', required: true, description: 'Note ID' },
          { name: 'dueDate', type: 'string', required: false, description: 'Due date (ISO 8601)' },
          { name: 'assignee', type: 'string', required: false, description: 'Assignee user ID' },
        ],
        examples: ['Convert note NT-001 to a task due Friday'],
      },
    ],
    queries: [
      {
        name: 'get_inbox',
        description: 'Get the unified inbox with messages, notes, and threads.',
        parameters: [
          { name: 'limit', type: 'number', required: false, description: 'Max results (default 50)' },
          { name: 'type', type: 'string', required: false, description: 'note | message | mention | all' },
          { name: 'unreadOnly', type: 'boolean', required: false, description: 'Only unread items' },
        ],
      },
      {
        name: 'get_thread',
        description: 'Get a conversation thread with all messages.',
        parameters: [
          { name: 'threadId', type: 'string', required: true, description: 'Thread ID' },
        ],
      },
      {
        name: 'search_notes',
        description: 'Search notes by content or tags.',
        parameters: [
          { name: 'query', type: 'string', required: true, description: 'Search query' },
          { name: 'limit', type: 'number', required: false, description: 'Max results' },
        ],
      },
      {
        name: 'get_unread_count',
        description: 'Get count of unread inbox items.',
        parameters: [],
      },
    ],
  },
  notifications: {
    description:
      'Notifications — In-app notifications, push notifications, notification preferences, and digest scheduling.',
    actions: [
      {
        name: 'send_notification',
        description: 'Send an in-app notification to a user.',
        parameters: [
          { name: 'userId', type: 'string', required: true, description: 'Target user ID' },
          { name: 'title', type: 'string', required: true, description: 'Notification title' },
          { name: 'body', type: 'string', required: true, description: 'Notification body' },
          { name: 'type', type: 'string', required: false, description: 'info | warning | success | error' },
          { name: 'actionUrl', type: 'string', required: false, description: 'Deep link URL' },
          { name: 'data', type: 'object', required: false, description: 'Additional payload data' },
        ],
        examples: ['Send notification to user U-001: "Invoice INV-001 is overdue" type=warning'],
      },
      {
        name: 'mark_all_read',
        description: 'Mark all notifications as read for a user.',
        parameters: [
          { name: 'userId', type: 'string', required: true, description: 'User ID' },
        ],
        examples: ['Mark all notifications as read for user U-001'],
      },
      {
        name: 'configure_digest',
        description: 'Configure a daily/weekly notification digest.',
        parameters: [
          { name: 'userId', type: 'string', required: true, description: 'User ID' },
          { name: 'frequency', type: 'string', required: true, description: 'daily | weekly | off' },
          { name: 'time', type: 'string', required: false, description: 'Delivery time (HH:MM)' },
          { name: 'categories', type: 'string[]', required: false, description: 'Categories to include' },
        ],
        examples: ['Set daily digest for user U-001 at 9 AM including invoices,tasks'],
      },
    ],
    queries: [
      {
        name: 'list_notifications',
        description: 'List notifications for a user.',
        parameters: [
          { name: 'userId', type: 'string', required: true, description: 'User ID' },
          { name: 'limit', type: 'number', required: false, description: 'Max results (default 50)' },
          { name: 'unreadOnly', type: 'boolean', required: false, description: 'Only unread' },
        ],
      },
      {
        name: 'get_notification_preferences',
        description: 'Get notification preferences for a user.',
        parameters: [
          { name: 'userId', type: 'string', required: true, description: 'User ID' },
        ],
      },
      {
        name: 'get_unread_count',
        description: 'Get unread notification count for a user.',
        parameters: [
          { name: 'userId', type: 'string', required: true, description: 'User ID' },
        ],
      },
    ],
  },
  projects: {
    description:
      'Projects — Project management, task boards, timelines, resource allocation, and progress tracking.',
    actions: [
      {
        name: 'create_project',
        description: 'Create a new project.',
        parameters: [
          { name: 'name', type: 'string', required: true, description: 'Project name' },
          { name: 'description', type: 'string', required: false, description: 'Project description' },
          { name: 'status', type: 'string', required: false, description: 'not_started | planning | active | on_hold | completed | cancelled' },
          { name: 'startDate', type: 'string', required: false, description: 'Start date (ISO 8601)' },
          { name: 'endDate', type: 'string', required: false, description: 'Target end date (ISO 8601)' },
          { name: 'budget', type: 'number', required: false, description: 'Project budget' },
          { name: 'team', type: 'string[]', required: false, description: 'Team member user IDs' },
          { name: 'clientId', type: 'string', required: false, description: 'Associated client contact ID' },
        ],
        examples: ['Create project "Website Redesign" with budget $15,000, due Dec 31'],
      },
      {
        name: 'create_project_task',
        description: 'Add a task to a project.',
        parameters: [
          { name: 'projectId', type: 'string', required: true, description: 'Project ID' },
          { name: 'title', type: 'string', required: true, description: 'Task title' },
          { name: 'description', type: 'string', required: false, description: 'Task description' },
          { name: 'assignee', type: 'string', required: false, description: 'Assignee user ID' },
          { name: 'dueDate', type: 'string', required: false, description: 'Due date (ISO 8601)' },
          { name: 'priority', type: 'string', required: false, description: 'low | medium | high | critical' },
          { name: 'status', type: 'string', required: false, description: 'todo | in_progress | review | done' },
        ],
        examples: ['Add task "Design homepage mockup" to project PRJ-001, assign to designer'],
      },
      {
        name: 'update_project_status',
        description: 'Update a project\'s overall status.',
        parameters: [
          { name: 'projectId', type: 'string', required: true, description: 'Project ID' },
          { name: 'status', type: 'string', required: true, description: 'New status' },
          { name: 'note', type: 'string', required: false, description: 'Status change note' },
        ],
        examples: ['Update project PRJ-001 status to active'],
      },
      {
        name: 'add_milestone',
        description: 'Add a milestone to a project.',
        parameters: [
          { name: 'projectId', type: 'string', required: true, description: 'Project ID' },
          { name: 'name', type: 'string', required: true, description: 'Milestone name' },
          { name: 'targetDate', type: 'string', required: true, description: 'Target date (ISO 8601)' },
          { name: 'description', type: 'string', required: false, description: 'Milestone description' },
        ],
        examples: ['Add milestone "Design Complete" to project PRJ-001, target Dec 15'],
      },
    ],
    queries: [
      {
        name: 'list_projects',
        description: 'List projects with optional filters.',
        parameters: [
          { name: 'limit', type: 'number', required: false, description: 'Max results (default 50)' },
          { name: 'status', type: 'string', required: false, description: 'Filter by status' },
          { name: 'clientId', type: 'string', required: false, description: 'Filter by client' },
        ],
      },
      {
        name: 'get_project',
        description: 'Get a project with tasks, milestones, and team.',
        parameters: [
          { name: 'projectId', type: 'string', required: true, description: 'Project ID' },
        ],
      },
      {
        name: 'get_project_tasks',
        description: 'Get tasks for a project.',
        parameters: [
          { name: 'projectId', type: 'string', required: true, description: 'Project ID' },
          { name: 'status', type: 'string', required: false, description: 'Filter by task status' },
        ],
      },
      {
        name: 'get_project_timeline',
        description: 'Get project timeline with milestones and task deadlines.',
        parameters: [
          { name: 'projectId', type: 'string', required: true, description: 'Project ID' },
        ],
      },
    ],
  },
  activity: {
    description:
      'Activity — Activity feed, audit log, timeline events, and interaction history across all modules.',
    actions: [
      {
        name: 'log_activity',
        description: 'Log a custom activity / audit event.',
        parameters: [
          { name: 'action', type: 'string', required: true, description: 'Action description' },
          { name: 'entityType', type: 'string', required: false, description: 'contact | invoice | booking | task | project | other' },
          { name: 'entityId', type: 'string', required: false, description: 'Entity ID' },
          { name: 'metadata', type: 'object', required: false, description: 'Additional event metadata' },
        ],
        examples: ['Log activity: "User created invoice INV-001 for $5,000"'],
      },
    ],
    queries: [
      {
        name: 'get_activity_feed',
        description: 'Get the activity feed with recent events.',
        parameters: [
          { name: 'limit', type: 'number', required: false, description: 'Max results (default 50)' },
          { name: 'entityType', type: 'string', required: false, description: 'Filter by entity type' },
          { name: 'entityId', type: 'string', required: false, description: 'Filter by entity ID' },
          { name: 'dateFrom', type: 'string', required: false, description: 'Start date' },
          { name: 'dateTo', type: 'string', required: false, description: 'End date' },
        ],
      },
      {
        name: 'get_audit_log',
        description: 'Get the full audit log for compliance.',
        parameters: [
          { name: 'limit', type: 'number', required: false, description: 'Max results (default 200)' },
          { name: 'userId', type: 'string', required: false, description: 'Filter by user' },
          { name: 'actionType', type: 'string', required: false, description: 'Filter by action type' },
          { name: 'dateFrom', type: 'string', required: false, description: 'Start date' },
          { name: 'dateTo', type: 'string', required: false, description: 'End date' },
        ],
      },
      {
        name: 'get_entity_timeline',
        description: 'Get the full timeline for a specific entity.',
        parameters: [
          { name: 'entityType', type: 'string', required: true, description: 'Entity type' },
          { name: 'entityId', type: 'string', required: true, description: 'Entity ID' },
        ],
      },
    ],
  },
};

// ─── Capability compilation helper ────────────────────────────────────────────

/**
 * Compile static capability registry into an array.
 */
function compileCapabilities(): ModuleCapability[] {
  return (Object.entries(MODULE_CAPABILITIES) as [ModuleName, Omit<ModuleCapability, 'module'>][]).map(
    ([module, caps]) => ({ module, ...caps }),
  );
}

// ─── Service ─────────────────────────────────────────────────────────────────

/**
 * KeyCortexConnectorService — The Universal Bridge between KEY Cortex and every KeyFlowOS module.
 *
 * Responsibilities:
 * 1. Execute commands on any module (Crm, Commerce, Bookings, Content, Communications, Flow, Autopilot, Temporal, Inbox, Notifications, Projects, Activity)
 * 2. Query data from any module
 * 3. Publish events to the unified event bus
 * 4. Provide a capability registry that describes what each module can do (used by AI prompt building)
 * 5. v4: Merge with tool registry for AI tool-based capabilities
 *
 * This is a plain injectable service (not a WebSocket gateway). It exposes
 * commands, queries, and events as async methods for the AI reasoning layer
 * and for direct HTTP/WebSocket use.
 */
@Injectable()
export class KeyCortexConnectorService {
  private readonly logger = new Logger(KeyCortexConnectorService.name);

  /** Compiled static capability registry. */
  private readonly MODULE_CAPABILITIES: ModuleCapability[] = compileCapabilities();

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

    // ── v4: Tool Registry (optional — graceful degradation) ──
    @Optional()
    @Inject(ToolRegistryService)
    private readonly toolRegistry?: ToolRegistryService,
  ) {}

  // ==========================================================================
  // Command Execution — maps abstract connector commands to real module calls
  // ==========================================================================

  /**
   * Execute a single command on a KeyFlowOS module.
   * Routes `ConnectorCommand` to the correct module service via a switch.
   * Returns `{ success, data?, error? }`.
   */
  async execute(
    command: ConnectorCommand,
    context: { businessId: string; userId: string },
  ): Promise<ConnectorCommandResult> {
    const start = Date.now();
    this.logger.debug(
      `[execute] ${command.module}.${command.action} biz=${context.businessId}`,
    );

    try {
      switch (command.module) {
        case 'crm': {
          const crmResult = await this.executeCrmCommand(command, context);
          return this.wrapResult(crmResult, Date.now() - start);
        }
        case 'commerce': {
          const commerceResult = await this.executeCommerceCommand(
            command,
            context,
          );
          return this.wrapResult(commerceResult, Date.now() - start);
        }
        case 'bookings': {
          const bookingsResult = await this.executeBookingsCommand(
            command,
            context,
          );
          return this.wrapResult(bookingsResult, Date.now() - start);
        }
        case 'content': {
          const contentResult = await this.executeContentCommand(
            command,
            context,
          );
          return this.wrapResult(contentResult, Date.now() - start);
        }
        case 'communications': {
          const commsResult = await this.executeCommunicationsCommand(
            command,
            context,
          );
          return this.wrapResult(commsResult, Date.now() - start);
        }
        case 'flow': {
          const flowResult = await this.executeFlowCommand(command, context);
          return this.wrapResult(flowResult, Date.now() - start);
        }
        case 'autopilot': {
          const apResult = await this.executeAutopilotCommand(
            command,
            context,
          );
          return this.wrapResult(apResult, Date.now() - start);
        }
        case 'temporal': {
          const temporalResult = await this.executeTemporalCommand(
            command,
            context,
          );
          return this.wrapResult(temporalResult, Date.now() - start);
        }
        case 'inbox': {
          const inboxResult = await this.executeInboxCommand(
            command,
            context,
          );
          return this.wrapResult(inboxResult, Date.now() - start);
        }
        case 'notifications': {
          const notifResult = await this.executeNotificationsCommand(
            command,
            context,
          );
          return this.wrapResult(notifResult, Date.now() - start);
        }
        case 'projects': {
          const projectsResult = await this.executeProjectsCommand(
            command,
            context,
          );
          return this.wrapResult(projectsResult, Date.now() - start);
        }
        case 'activity': {
          const activityResult = await this.executeActivityCommand(
            command,
            context,
          );
          return this.wrapResult(activityResult, Date.now() - start);
        }
        case 'keystore': {
          const keystoreResult = await this.executeKeystoreCommand(command, context);
          return this.wrapResult(keystoreResult, Date.now() - start);
        }
        default: {
          // Exhaustiveness check: the switch should cover every ModuleName
          const unknownModule: never = command.module;
          return {
            success: false,
            error: `Unknown module: ${String(unknownModule)}`,
            latencyMs: Date.now() - start,
          };
        }
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `[execute] ${command.module}.${command.action} FAILED: ${message}`,
        error instanceof Error ? error.stack : undefined,
      );
      return { success: false, error: message, latencyMs: Date.now() - start };
    }
  }

  /**
   * Execute a batch of commands sequentially.
   * Stops on first failure if `stopOnError` is true (default: false).
   */
  async executeBatch(
    commands: ConnectorCommand[],
    context: { businessId: string; userId: string },
    options: { stopOnError?: boolean } = {},
  ): Promise<ConnectorCommandResult[]> {
    const results: ConnectorCommandResult[] = [];
    for (const command of commands) {
      const result = await this.execute(command, context);
      results.push(result);
      if (options.stopOnError && !result.success) break;
    }
    return results;
  }

  // ==========================================================================
  // Data Query — maps abstract connector queries to real module calls
  // ==========================================================================

  /**
   * Query data from a KeyFlowOS module.
   * Returns `{ success, data?, error? }`.
   */
  async query(
    module: ModuleName,
    queryName: string,
    params: Record<string, unknown>,
  ): Promise<ConnectorDataResult> {
    const start = Date.now();
    this.logger.debug(`[query] ${module}.${queryName}`);

    try {
      switch (module) {
        case 'crm':
          return await this.queryCrm(queryName, params);
        case 'commerce':
          return await this.queryCommerce(queryName, params);
        case 'bookings':
          return await this.queryBookings(queryName, params);
        case 'content':
          return await this.queryContent(queryName, params);
        case 'communications':
          return await this.queryCommunications(queryName, params);
        case 'flow':
          return await this.queryFlow(queryName, params);
        case 'autopilot':
          return await this.queryAutopilot(queryName, params);
        case 'temporal':
          return await this.queryTemporal(queryName, params);
        case 'inbox':
          return await this.queryInbox(queryName, params);
        case 'notifications':
          return await this.queryNotifications(queryName, params);
        case 'projects':
          return await this.queryProjects(queryName, params);
        case 'activity':
          return await this.queryActivity(queryName, params);
        case 'keystore':
          return await this.queryKeystore(queryName, params);
        default: {
          const unknownModule: never = module;
          return {
            success: false,
            error: `Unknown module: ${String(unknownModule)}`,
            latencyMs: Date.now() - start,
          };
        }
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      return { success: false, error: message, latencyMs: Date.now() - start };
    }
  }

  // ==========================================================================
  // Event Publishing — push to unified event bus
  // ==========================================================================

  /**
   * Publish a UnifiedEvent to the event bus.
   * Each module subscribes to its own events for reactive workflows.
   */
  async publishEvent(event: UnifiedEvent): Promise<{ success: boolean }> {
    this.logger.debug(`[publishEvent] ${event.type} from ${event.source}`);
    try {
      // Placeholder: publish via event bus, Redis pub/sub, or message queue.
      // In a real implementation this would be:
      //   await this.eventBus.publish(event);
      // For now, return success.
      return { success: true };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`[publishEvent] Failed: ${message}`);
      return { success: false };
    }
  }

  // ==========================================================================
  // Capability Registry — describes what every module can do
  // ==========================================================================

  /**
   * Return all module capabilities (actions + queries + descriptions).
   * Used by the AI reasoning layer to build the system prompt.
   *
   * v4: Merges with tool registry capabilities when available.
   */
  getAllCapabilities(): ModuleCapability[] {
    const capabilities = [...this.MODULE_CAPABILITIES];

    // v4: Merge with tool registry if available
    if (this.toolRegistry) {
      try {
        const tools = this.toolRegistry.getAllTools();
        const toolCapability: ModuleCapability = {
          module: 'tools' as ModuleName,
          description: `Registered AI tools — ${tools.length} tools available for execution via the tool registry.`,
          actions: tools.map((tool) => ({
            name: tool.id.replace('.', '_'),
            description: `${tool.name}: ${tool.description} [${tool.category}]`,
            parameters: Object.entries(tool.parameters).map(([name, type]) => ({
              name,
              type: type as string,
              description: `${name} parameter`,
              required: !type.toString().endsWith('?'),
            })),
            requiresApproval: tool.requiresApproval,
            examples: [`Execute ${tool.name} via tool registry`],
          })),
          queries: [],
        };
        capabilities.push(toolCapability);
      } catch (err) {
        this.logger.warn(`[getAllCapabilities] Tool registry merge failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return capabilities;
  }

  /**
   * Format the full capability registry as a prompt-ready string.
   * Used when building the AI system prompt in KeyCortexReasoningService.
   */
  formatCapabilitiesForPrompt(): string {
    const capabilities = this.getAllCapabilities();
    const lines: string[] = [];

    lines.push('=== AVAILABLE MODULES & ACTIONS ===');
    lines.push(`Total modules: ${capabilities.length}\n`);

    for (const cap of capabilities) {
      lines.push(`MODULE: ${cap.module}`);
      lines.push(`Description: ${cap.description}`);

      if (cap.actions.length > 0) {
        lines.push('Actions:');
        for (const action of cap.actions) {
          const paramList = action.parameters
            .map((p) => `${p.name}${p.required ? '*' : ''}(${p.type})`)
            .join(', ');
          lines.push(
            `  - ${action.name}(${paramList}): ${action.description}`,
          );
        }
      }

      if (cap.queries.length > 0) {
        lines.push('Queries:');
        for (const query of cap.queries) {
          const paramList = query.parameters
            .map((p) => `${p.name}${p.required ? '*' : ''}(${p.type})`)
            .join(', ');
          lines.push(`  - ${query.name}(${paramList}): ${query.description}`);
        }
      }

      lines.push('');
    }

    lines.push('=== END MODULES ===');
    return lines.join('\n');
  }

  // ==========================================================================
  // Per-Module Command Handlers
  // ==========================================================================

  // ── CRM ────────────────────────────────────────────────────────────────────
  private async executeCrmCommand(
    command: ConnectorCommand,
    context: { businessId: string; userId: string },
  ): Promise<ConnectorCommandResult> {
    switch (command.action) {
      case 'create_contact': {
        const contact = await this.crm.createContact(context.businessId, {
          name: command.parameters.name as string,
          email: command.parameters.email as string | undefined,
          phone: command.parameters.phone as string | undefined,
          tags: command.parameters.tags as string[] | undefined,
          source: command.parameters.source as string | undefined,
          notes: command.parameters.notes as string | undefined,
        });
        return { success: true, data: contact };
      }

      case 'update_contact': {
        const updated = await this.crm.updateContact(
          context.businessId,
          command.parameters.contactId as string,
          command.parameters.fields as Record<string, unknown>,
        );
        return { success: true, data: updated };
      }

      case 'delete_contact': {
        await this.crm.deleteContact(
          context.businessId,
          command.parameters.contactId as string,
        );
        return { success: true, data: { deleted: true } };
      }

      case 'add_note': {
        const note = await this.crm.addNote(
          context.businessId,
          command.parameters.contactId as string,
          command.parameters.content as string,
        );
        return { success: true, data: note };
      }

      case 'create_task': {
        const task = await this.crm.createTask(
          context.businessId,
          command.parameters.contactId as string,
          {
            title: command.parameters.title as string,
            dueDate: command.parameters.dueDate as string | undefined,
            priority: command.parameters.priority as string | undefined,
          },
        );
        return { success: true, data: task };
      }

      case 'move_pipeline_stage': {
        const lead = await this.crm.movePipelineStage(
          context.businessId,
          command.parameters.leadId as string,
          command.parameters.stage as string,
        );
        return { success: true, data: lead };
      }

      case 'schedule_follow_up': {
        const followUp = await this.crm.scheduleFollowUp(
          context.businessId,
          command.parameters.contactId as string,
          new Date(command.parameters.date as string),
          command.parameters.method as string | undefined,
        );
        return { success: true, data: followUp };
      }

      default: {
        return {
          success: false,
          error: `Unknown CRM action: ${command.action}`,
        };
      }
    }
  }

  // ── Commerce ───────────────────────────────────────────────────────────────
  private async executeCommerceCommand(
    command: ConnectorCommand,
    context: { businessId: string; userId: string },
  ): Promise<ConnectorCommandResult> {
    switch (command.action) {
      case 'create_invoice': {
        const invoice = await this.commerce.createInvoice(
          context.businessId,
          {
            clientId: command.parameters.clientId as string,
            items: command.parameters.items as Array<{
              name: string;
              quantity: number;
              unitPrice: number;
              description?: string;
            }>,
            dueDate: command.parameters.dueDate as string | undefined,
            notes: command.parameters.notes as string | undefined,
            currency: command.parameters.currency as string | undefined,
            sendEmail: command.parameters.sendEmail as boolean | undefined,
          },
        );
        return { success: true, data: invoice };
      }

      case 'create_quote': {
        const quote = await this.commerce.createQuote(context.businessId, {
          clientId: command.parameters.clientId as string,
          items: command.parameters.items as Array<{
            name: string;
            quantity: number;
            unitPrice: number;
          }>,
          validUntil: command.parameters.validUntil as string | undefined,
          notes: command.parameters.notes as string | undefined,
        });
        return { success: true, data: quote };
      }

      case 'convert_quote_to_invoice': {
        const invoice = await this.commerce.convertQuoteToInvoice(
          context.businessId,
          command.parameters.quoteId as string,
        );
        return { success: true, data: invoice };
      }

      case 'record_payment': {
        const payment = await this.commerce.recordPayment(
          context.businessId,
          command.parameters.invoiceId as string,
          {
            amount: command.parameters.amount as number,
            method: command.parameters.method as string | undefined,
            date: command.parameters.date as string | undefined,
            reference: command.parameters.reference as string | undefined,
          },
        );
        return { success: true, data: payment };
      }

      case 'create_product': {
        const product = await this.commerce.createProduct(
          context.businessId,
          {
            name: command.parameters.name as string,
            price: command.parameters.price as number,
            description: command.parameters.description as string | undefined,
            category: command.parameters.category as string | undefined,
            sku: command.parameters.sku as string | undefined,
            taxable: command.parameters.taxable as boolean | undefined,
          },
        );
        return { success: true, data: product };
      }

      case 'send_payment_reminder': {
        await this.commerce.sendPaymentReminder(
          context.businessId,
          command.parameters.invoiceId as string,
          command.parameters.message as string | undefined,
        );
        return { success: true, data: { sent: true } };
      }

      case 'create_subscription': {
        const subscription = await this.commerce.createSubscription(
          context.businessId,
          {
            clientId: command.parameters.clientId as string,
            productId: command.parameters.productId as string,
            frequency: command.parameters.frequency as string,
            startDate: command.parameters.startDate as string | undefined,
            endDate: command.parameters.endDate as string | undefined,
          },
        );
        return { success: true, data: subscription };
      }

      default: {
        return {
          success: false,
          error: `Unknown Commerce action: ${command.action}`,
        };
      }
    }
  }

  // ── Bookings ───────────────────────────────────────────────────────────────
  private async executeBookingsCommand(
    command: ConnectorCommand,
    context: { businessId: string; userId: string },
  ): Promise<ConnectorCommandResult> {
    switch (command.action) {
      case 'create_booking': {
        const booking = await this.bookings.createBooking(
          context.businessId,
          {
            clientId: command.parameters.clientId as string,
            title: command.parameters.title as string,
            startTime: new Date(command.parameters.startTime as string),
            endTime: new Date(command.parameters.endTime as string),
            location: command.parameters.location as string | undefined,
            notes: command.parameters.notes as string | undefined,
            sendConfirmation: command.parameters
              .sendConfirmation as boolean | undefined,
          },
        );
        return { success: true, data: booking };
      }

      case 'cancel_booking': {
        await this.bookings.cancelBooking(
          context.businessId,
          command.parameters.bookingId as string,
          {
            reason: command.parameters.reason as string | undefined,
            notifyClient: command.parameters.notifyClient as boolean | undefined,
          },
        );
        return { success: true, data: { cancelled: true } };
      }

      case 'reschedule_booking': {
        const booking = await this.bookings.rescheduleBooking(
          context.businessId,
          command.parameters.bookingId as string,
          {
            newStartTime: new Date(
              command.parameters.newStartTime as string,
            ),
            newEndTime: new Date(command.parameters.newEndTime as string),
            notifyClient: command.parameters.notifyClient as
              | boolean
              | undefined,
          },
        );
        return { success: true, data: booking };
      }

      case 'check_availability': {
        const slots = await this.bookings.checkAvailability(
          context.businessId,
          new Date(command.parameters.date as string),
          command.parameters.durationMinutes as number,
          command.parameters.bufferMinutes as number | undefined,
        );
        return { success: true, data: slots };
      }

      case 'block_time': {
        const block = await this.bookings.blockTime(context.businessId, {
          startTime: new Date(command.parameters.startTime as string),
          endTime: new Date(command.parameters.endTime as string),
          reason: command.parameters.reason as string | undefined,
        });
        return { success: true, data: block };
      }

      default: {
        return {
          success: false,
          error: `Unknown Bookings action: ${command.action}`,
        };
      }
    }
  }

  // ── Content ────────────────────────────────────────────────────────────────
  private async executeContentCommand(
    command: ConnectorCommand,
    context: { businessId: string; userId: string },
  ): Promise<ConnectorCommandResult> {
    switch (command.action) {
      case 'create_blog_post': {
        const post = await this.content.createBlogPost(context.businessId, {
          title: command.parameters.title as string,
          content: command.parameters.content as string,
          excerpt: command.parameters.excerpt as string | undefined,
          tags: command.parameters.tags as string[] | undefined,
          status: (command.parameters.status as string) ?? 'draft',
          publishAt: command.parameters.publishAt
            ? new Date(command.parameters.publishAt as string)
            : undefined,
          seoTitle: command.parameters.seoTitle as string | undefined,
          seoDescription: command.parameters.seoDescription as
            | string
            | undefined,
        });
        return { success: true, data: post };
      }

      case 'create_landing_page': {
        const page = await this.content.createLandingPage(
          context.businessId,
          {
            title: command.parameters.title as string,
            slug: command.parameters.slug as string,
            sections: command.parameters.sections as Array<Record<string, unknown>>,
            meta: command.parameters.meta as
              | Record<string, unknown>
              | undefined,
          },
        );
        return { success: true, data: page };
      }

      case 'schedule_social_post': {
        const post = await this.content.scheduleSocialPost(
          context.businessId,
          {
            platform: command.parameters.platform as string,
            content: command.parameters.content as string,
            scheduledAt: new Date(command.parameters.scheduledAt as string),
            mediaUrls: command.parameters.mediaUrls as string[] | undefined,
          },
        );
        return { success: true, data: post };
      }

      case 'optimize_seo': {
        const result = await this.content.optimizeSeo(
          context.businessId,
          command.parameters.contentId as string,
          command.parameters.targetKeywords as string[],
        );
        return { success: true, data: result };
      }

      default: {
        return {
          success: false,
          error: `Unknown Content action: ${command.action}`,
        };
      }
    }
  }

  // ── Communications ─────────────────────────────────────────────────────────
  private async executeCommunicationsCommand(
    command: ConnectorCommand,
    context: { businessId: string; userId: string },
  ): Promise<ConnectorCommandResult> {
    switch (command.action) {
      case 'send_email': {
        await this.communications.sendEmail(context.businessId, {
          to: command.parameters.to as string[],
          subject: command.parameters.subject as string,
          body: command.parameters.body as string,
          fromName: command.parameters.fromName as string | undefined,
          templateId: command.parameters.templateId as string | undefined,
          attachments: command.parameters.attachments as
            | Array<Record<string, unknown>>
            | undefined,
          trackOpens: command.parameters.trackOpens as boolean | undefined,
          trackClicks: command.parameters.trackClicks as boolean | undefined,
        });
        return { success: true, data: { sent: true } };
      }

      case 'send_sms': {
        await this.communications.sendSms(context.businessId, {
          to: command.parameters.to as string,
          body: command.parameters.body as string,
        });
        return { success: true, data: { sent: true } };
      }

      case 'create_email_sequence': {
        const sequence = await this.communications.createEmailSequence(
          context.businessId,
          {
            name: command.parameters.name as string,
            steps: command.parameters.steps as Array<Record<string, unknown>>,
            trigger: command.parameters.trigger as string | undefined,
          },
        );
        return { success: true, data: sequence };
      }

      case 'create_template': {
        const template = await this.communications.createTemplate(
          context.businessId,
          {
            name: command.parameters.name as string,
            subject: command.parameters.subject as string,
            body: command.parameters.body as string,
            type: command.parameters.type as string,
            variables: command.parameters.variables as string[] | undefined,
          },
        );
        return { success: true, data: template };
      }

      case 'create_campaign': {
        const campaign = await this.communications.createCampaign(
          context.businessId,
          {
            name: command.parameters.name as string,
            templateId: command.parameters.templateId as string,
            recipientListId: command.parameters.recipientListId as string,
            scheduledAt: command.parameters.scheduledAt
              ? new Date(command.parameters.scheduledAt as string)
              : undefined,
          },
        );
        return { success: true, data: campaign };
      }

      default: {
        return {
          success: false,
          error: `Unknown Communications action: ${command.action}`,
        };
      }
    }
  }

  // ── Flow ───────────────────────────────────────────────────────────────────
  private async executeFlowCommand(
    command: ConnectorCommand,
    context: { businessId: string; userId: string },
  ): Promise<ConnectorCommandResult> {
    switch (command.action) {
      case 'create_flow': {
        const flow = await this.flow.createFlow(context.businessId, {
          name: command.parameters.name as string,
          trigger: command.parameters.trigger as {
            type: string;
            config: Record<string, unknown>;
          },
          steps: command.parameters.steps as Array<{
            type: string;
            config: Record<string, unknown>;
            conditions?: Record<string, unknown>;
          }>,
          description: command.parameters.description as string | undefined,
          isActive: command.parameters.isActive as boolean | undefined,
        });
        return { success: true, data: flow };
      }

      case 'run_flow': {
        const result = await this.flow.runFlow(
          context.businessId,
          command.parameters.flowId as string,
          command.parameters.context as Record<string, unknown> | undefined,
        );
        return { success: true, data: result };
      }

      case 'toggle_flow': {
        const flow = await this.flow.toggleFlow(
          context.businessId,
          command.parameters.flowId as string,
          command.parameters.active as boolean,
        );
        return { success: true, data: flow };
      }

      case 'create_webhook': {
        const webhook = await this.flow.createWebhook(context.businessId, {
          name: command.parameters.name as string,
          flowId: command.parameters.flowId as string,
          secret: command.parameters.secret as string | undefined,
        });
        return { success: true, data: webhook };
      }

      default: {
        return {
          success: false,
          error: `Unknown Flow action: ${command.action}`,
        };
      }
    }
  }

  // ── Autopilot ──────────────────────────────────────────────────────────────
  private async executeAutopilotCommand(
    command: ConnectorCommand,
    context: { businessId: string; userId: string },
  ): Promise<ConnectorCommandResult> {
    switch (command.action) {
      case 'create_loop': {
        const loop = await this.autopilot.createLoop(context.businessId, {
          name: command.parameters.name as string,
          frequency: command.parameters.frequency as string,
          actions: command.parameters.actions as Array<Record<string, unknown>>,
          conditions: command.parameters.conditions as
            | Array<Record<string, unknown>>
            | undefined,
          maxIterations: command.parameters.maxIterations as
            | number
            | undefined,
          startImmediately: command.parameters
            .startImmediately as boolean | undefined,
        });
        return { success: true, data: loop };
      }

      case 'run_loop': {
        const result = await this.autopilot.runLoop(
          context.businessId,
          command.parameters.loopId as string,
        );
        return { success: true, data: result };
      }

      case 'pause_loop': {
        const loop = await this.autopilot.pauseLoop(
          context.businessId,
          command.parameters.loopId as string,
        );
        return { success: true, data: loop };
      }

      case 'resume_loop': {
        const loop = await this.autopilot.resumeLoop(
          context.businessId,
          command.parameters.loopId as string,
        );
        return { success: true, data: loop };
      }

      case 'stop_loop': {
        await this.autopilot.stopLoop(
          context.businessId,
          command.parameters.loopId as string,
        );
        return { success: true, data: { stopped: true } };
      }

      case 'create_monitor': {
        const monitor = await this.autopilot.createMonitor(
          context.businessId,
          {
            name: command.parameters.name as string,
            watchType: command.parameters.watchType as string,
            threshold: command.parameters.threshold as Record<string, unknown>,
            alertChannels: command.parameters.alertChannels as
              | string[]
              | undefined,
          },
        );
        return { success: true, data: monitor };
      }

      default: {
        return {
          success: false,
          error: `Unknown Autopilot action: ${command.action}`,
        };
      }
    }
  }

  // ── Temporal ───────────────────────────────────────────────────────────────
  private async executeTemporalCommand(
    command: ConnectorCommand,
    context: { businessId: string; userId: string },
  ): Promise<ConnectorCommandResult> {
    switch (command.action) {
      case 'store_memory': {
        await this.temporal.storeMemory(context.businessId, {
          key: command.parameters.key as string,
          value: command.parameters.value as string,
          category: command.parameters.category as string | undefined,
          importance: command.parameters.importance as number | undefined,
          ttlDays: command.parameters.ttlDays as number | undefined,
        });
        return { success: true, data: { stored: true } };
      }

      case 'recall_memory': {
        const memories = await this.temporal.recallMemory(
          context.businessId,
          command.parameters.query as string,
          command.parameters.limit as number | undefined,
        );
        return { success: true, data: memories };
      }

      case 'delete_memory': {
        await this.temporal.deleteMemory(
          context.businessId,
          command.parameters.key as string,
        );
        return { success: true, data: { deleted: true } };
      }

      case 'create_document_set': {
        const docSet = await this.temporal.createDocumentSet(
          context.businessId,
          {
            name: command.parameters.name as string,
            documents: command.parameters.documents as Array<{
              title: string;
              content: string;
              metadata?: Record<string, unknown>;
            }>,
          },
        );
        return { success: true, data: docSet };
      }

      default: {
        return {
          success: false,
          error: `Unknown Temporal action: ${command.action}`,
        };
      }
    }
  }

  // ── Inbox ──────────────────────────────────────────────────────────────────
  private async executeInboxCommand(
    command: ConnectorCommand,
    context: { businessId: string; userId: string },
  ): Promise<ConnectorCommandResult> {
    switch (command.action) {
      case 'create_note': {
        const note = await this.inbox.createNote(context.businessId, {
          content: command.parameters.content as string,
          title: command.parameters.title as string | undefined,
          tags: command.parameters.tags as string[] | undefined,
          mentions: command.parameters.mentions as string[] | undefined,
          linkedEntityType: command.parameters.linkedEntityType as
            | string
            | undefined,
          linkedEntityId: command.parameters.linkedEntityId as
            | string
            | undefined,
        });
        return { success: true, data: note };
      }

      case 'reply_to_thread': {
        const reply = await this.inbox.replyToThread(
