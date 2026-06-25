
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
          name: 'list_automations',
          description: 'List all automations with optional filter.',
          parameters: [
            { name: 'active', type: 'boolean', description: 'Filter by active state', required: false },
            { name: 'trigger', type: 'enum', description: 'Filter by trigger', enumValues: ['contact_created', 'contact_tagged', 'invoice_paid', 'booking_confirmed', 'form_submitted', 'timer', 'webhook', 'manual'], required: false },
            { name: 'limit', type: 'number', description: 'Max results', required: false, default: 50 },
          ],
          returns: 'Automation[]',
          examples: ['List all active automations', 'Show timer-based flows'],
        },
        {
          name: 'get_flow_runs',
          description: 'Retrieve execution history for a flow.',
          parameters: [
            { name: 'flowId', type: 'id', description: 'UUID of the flow', required: true },
            { name: 'limit', type: 'number', description: 'Max results', required: false, default: 20 },
          ],
          returns: 'FlowRun[]',
          examples: ['Show recent runs of flow abc123', 'Get execution history'],
        },
        {
          name: 'get_flow_analytics',
          description: 'Aggregate analytics across all flows.',
          parameters: [
            { name: 'from', type: 'date', description: 'Start date', required: true },
            { name: 'to', type: 'date', description: 'End date', required: true },
          ],
          returns: 'FlowAnalytics',
          examples: ['How are our automations performing?', 'Show flow analytics for this month'],
        },
      ],
    },

    // ── 7. AUTOPILOT ────────────────────────────────────────────────────────
    {
      module: 'autopilot',
      description: 'Autonomous task delegation, recurring loops, governance, and approval chains.',
      actions: [
        {
          name: 'get_tasks',
          description: 'List autopilot-managed tasks.',
          parameters: [
            { name: 'status', type: 'enum', description: 'Task status', enumValues: ['pending', 'in_progress', 'completed', 'failed'], required: false },
            { name: 'assignedTo', type: 'id', description: 'Filter by assignee', required: false },
            { name: 'limit', type: 'number', description: 'Max results', required: false, default: 50 },
          ],
          requiresApproval: false,
          examples: ['What autopilot tasks are pending?', 'Show failed tasks'],
        },
        {
          name: 'create_task',
          description: 'Create a new autopilot task.',
          parameters: [
            { name: 'title', type: 'string', description: 'Task title', required: true },
            { name: 'description', type: 'string', description: 'Task details', required: false },
            { name: 'assignedTo', type: 'id', description: 'Assignee user ID', required: false },
            { name: 'priority', type: 'enum', description: 'Priority', enumValues: ['low', 'medium', 'high', 'urgent'], required: false, default: 'medium' },
            { name: 'dueDate', type: 'date', description: 'Due date', required: false },
            { name: 'automationId', type: 'id', description: 'Parent automation', required: false },
          ],
          requiresApproval: false,
          examples: ['Create task: Review Q3 expenses', 'Add high-priority task for Jane'],
        },
        {
          name: 'approve_task',
          description: 'Approve a pending autopilot task.',
          parameters: [
            { name: 'taskId', type: 'id', description: 'UUID of the task', required: true },
            { name: 'notes', type: 'string', description: 'Approval notes', required: false },
          ],
          requiresApproval: false,
          examples: ['Approve task abc123', 'Sign off on the expense report'],
        },
        {
          name: 'reject_task',
          description: 'Reject a pending autopilot task.',
          parameters: [
            { name: 'taskId', type: 'id', description: 'UUID of the task', required: true },
            { name: 'reason', type: 'string', description: 'Rejection reason', required: false },
          ],
          requiresApproval: false,
          examples: ['Reject task abc123: insufficient data'],
        },
        {
          name: 'enable_loop',
          description: 'Activate a recurring autopilot loop.',
          parameters: [
            { name: 'loopId', type: 'id', description: 'UUID of the loop', required: true },
          ],
          requiresApproval: false,
          examples: ['Enable loop abc123', 'Turn on the weekly report loop'],
        },
        {
          name: 'disable_loop',
          description: 'Pause a recurring autopilot loop.',
          parameters: [
            { name: 'loopId', type: 'id', description: 'UUID of the loop', required: true },
          ],
          requiresApproval: false,
          examples: ['Disable loop abc123', 'Pause the daily check-in loop'],
        },
        {
          name: 'complete_task',
          description: 'Mark an autopilot task as finished.',
          parameters: [
            { name: 'taskId', type: 'id', description: 'UUID of the task', required: true },
            { name: 'outcome', type: 'string', description: 'Result summary', required: false },
          ],
          requiresApproval: false,
          examples: ['Complete task abc123', 'Finish the onboarding task'],
        },
        {
          name: 'create_loop',
          description: 'Create a recurring autopilot loop.',
          parameters: [
            { name: 'name', type: 'string', description: 'Loop name', required: true },
            { name: 'frequency', type: 'enum', description: 'Recurrence', enumValues: ['hourly', 'daily', 'weekly', 'monthly'], required: true },
            { name: 'taskTemplate', type: 'object', description: 'Task template', required: true },
            { name: 'conditions', type: 'array', description: 'Conditions to trigger', required: false },
            { name: 'active', type: 'boolean', description: 'Enable immediately', required: false, default: false },
          ],
          requiresApproval: false,
          examples: ['Create daily loop: check overdue invoices'],
        },
      ],
      queries: [
        {
          name: 'get_loop_status',
          description: 'Check loop health and next run.',
          parameters: [
            { name: 'loopId', type: 'id', description: 'UUID of the loop', required: true },
          ],
          returns: 'LoopStatus',
          examples: ['Show loop abc123 status', 'When does the weekly loop run next?'],
        },
        {
          name: 'get_task_history',
          description: 'Historical autopilot task outcomes.',
          parameters: [
            { name: 'loopId', type: 'id', description: 'Filter by loop', required: false },
            { name: 'status', type: 'enum', description: 'Filter by status', enumValues: ['pending', 'in_progress', 'completed', 'failed'], required: false },
            { name: 'limit', type: 'number', description: 'Max results', required: false, default: 50 },
          ],
          returns: 'Task[]',
          examples: ['Show completed autopilot tasks', 'List failed tasks'],
        },
        {
          name: 'get_governance_report',
          description: 'Audit trail of autopilot decisions.',
          parameters: [
            { name: 'from', type: 'date', description: 'Start date', required: true },
            { name: 'to', type: 'date', description: 'End date', required: true },
          ],
          returns: 'GovernanceEntry[]',
          examples: ['Show autopilot audit log', 'What decisions were made this week?'],
        },
        {
          name: 'get_approval_queue',
          description: 'List tasks awaiting human approval.',
          parameters: [
            { name: 'limit', type: 'number', description: 'Max results', required: false, default: 20 },
          ],
          returns: 'Task[]',
          examples: ['What needs approval?', 'Show pending approvals'],
        },
      ],
    },

    // ── 8. TEMPORAL / MEMORY ────────────────────────────────────────────────
    {
      module: 'temporal',
      description: 'Memory system — store, recall, consolidate, and expire business facts and context.',
      actions: [
        {
          name: 'store_memory',
          description: 'Save a fact or context item to the memory system.',
          parameters: [
            { name: 'key', type: 'string', description: 'Unique memory key', required: true },
            { name: 'value', type: 'object', description: 'Memory payload', required: true },
            { name: 'ttlDays', type: 'number', description: 'Expiration in days (0=never)', required: false, default: 0 },
            { name: 'tags', type: 'array', description: 'Search tags', required: false },
            { name: 'importance', type: 'enum', description: 'Priority', enumValues: ['low', 'medium', 'high', 'critical'], required: false, default: 'medium' },
          ],
          requiresApproval: false,
          examples: ['Remember that John prefers email', 'Store Q3 revenue as $450K'],
        },
        {
          name: 'recall_memory',
          description: 'Retrieve a stored memory by key.',
          parameters: [
            { name: 'key', type: 'string', description: 'Memory key', required: true },
          ],
          requiresApproval: false,
          examples: ['What do we know about John?', 'Recall Q3 revenue figure'],
        },
        {
          name: 'delete_memory',
          description: 'Remove a memory entry.',
          parameters: [
            { name: 'memoryId', type: 'id', description: 'UUID of the memory', required: true },
          ],
          requiresApproval: false,
          examples: ['Delete memory abc123'],
        },
        {
          name: 'update_memory',
          description: 'Update an existing memory.',
          parameters: [
            { name: 'memoryId', type: 'id', description: 'UUID of the memory', required: true },
            { name: 'value', type: 'object', description: 'New payload', required: false },
            { name: 'importance', type: 'enum', description: 'New priority', enumValues: ['low', 'medium', 'high', 'critical'], required: false },
          ],
          requiresApproval: false,
          examples: ['Update memory abc123 value'],
        },
        {
          name: 'tag_memory',
          description: 'Add tags to a memory entry.',
          parameters: [
            { name: 'memoryId', type: 'id', description: 'UUID of the memory', required: true },
            { name: 'tags', type: 'array', description: 'Tags to add', required: true },
          ],
          requiresApproval: false,
          examples: ['Tag memory abc123 as priority'],
        },
        {
          name: 'consolidate_memories',
          description: 'Merge related memories into a summary.',
          parameters: [
            { name: 'keys', type: 'array', description: 'Memory keys to merge', required: true },
            { name: 'summaryKey', type: 'string', description: 'New consolidated key', required: true },
          ],
          requiresApproval: false,
          examples: ['Consolidate memories about John into a profile'],
        },
      ],
      queries: [
        {
          name: 'search_memories',
          description: 'Search memories by key pattern or tags.',
          parameters: [
            { name: 'query', type: 'string', description: 'Search string', required: false },
            { name: 'tags', type: 'array', description: 'Filter by tags', required: false },
            { name: 'limit', type: 'number', description: 'Max results', required: false, default: 20 },
          ],
          returns: 'MemoryEntry[]',
          examples: ['Search memories about revenue', 'Find memories tagged priority'],
        },
        {
          name: 'get_memory_stats',
          description: 'Memory usage statistics.',
          parameters: [],
          returns: 'MemoryStats',
          examples: ['Show memory usage', 'How many memories are stored?'],
        },
        {
          name: 'get_expiring_memories',
          description: 'List memories nearing expiration.',
          parameters: [
            { name: 'withinDays', type: 'number', description: 'Expiration window', required: false, default: 7 },
          ],
          returns: 'MemoryEntry[]',
          examples: ['What memories expire soon?', 'Show expiring memories'],
        },
      ],
    },

    // ── 9. INBOX ────────────────────────────────────────────────────────────
    {
      module: 'inbox',
      description: 'Unified inbox — threads, classification, assignment, snooze, and intelligence.',
      actions: [
        {
          name: 'get_threads',
          description: 'List conversation threads.',
          parameters: [
            { name: 'status', type: 'enum', description: 'Thread status', enumValues: ['open', 'closed', 'snoozed', 'all'], required: false, default: 'open' },
            { name: 'priority', type: 'enum', description: 'Filter priority', enumValues: ['low', 'medium', 'high', 'urgent'], required: false },
            { name: 'assignedTo', type: 'id', description: 'Filter assignee', required: false },
            { name: 'limit', type: 'number', description: 'Max results', required: false, default: 50 },
          ],
          requiresApproval: false,
          examples: ['Show open threads', 'List high-priority inbox items'],
        },
        {
          name: 'send_reply',
          description: 'Reply to a thread.',
          parameters: [
            { name: 'threadId', type: 'id', description: 'UUID of the thread', required: true },
            { name: 'body', type: 'string', description: 'Reply text', required: true },
            { name: 'channel', type: 'enum', description: 'Reply channel', enumValues: ['sms', 'email', 'whatsapp'], required: false },
            { name: 'attachments', type: 'array', description: 'File URLs', required: false },
          ],
          requiresApproval: false,
          examples: ['Reply to thread abc123', 'Respond to the customer inquiry'],
        },
        {
          name: 'classify_message',
          description: 'Classify a message by intent and priority.',
          parameters: [
            { name: 'threadId', type: 'id', description: 'UUID of the thread', required: true },
            { name: 'intent', type: 'string', description: 'Detected intent', required: false },
            { name: 'priority', type: 'enum', description: 'Assigned priority', enumValues: ['low', 'medium', 'high', 'urgent'], required: false },
            { name: 'assignTo', type: 'id', description: 'User to assign', required: false },
          ],
          requiresApproval: false,
          examples: ['Classify thread abc123', 'Auto-sort the new message'],
        },
        {
          name: 'close_thread',
          description: 'Close a resolved thread.',
          parameters: [
            { name: 'threadId', type: 'id', description: 'UUID of the thread', required: true },
            { name: 'resolution', type: 'string', description: 'Resolution notes', required: false },
          ],
          requiresApproval: false,
          examples: ['Close thread abc123', 'Resolve the customer issue'],
        },
        {
          name: 'snooze_thread',
          description: 'Snooze a thread for later.',
          parameters: [
            { name: 'threadId', type: 'id', description: 'UUID of the thread', required: true },
            { name: 'until', type: 'date', description: 'Snooze until', required: true },
            { name: 'reason', type: 'string', description: 'Snooze reason', required: false },
          ],
          requiresApproval: false,
          examples: ['Snooze thread abc123 until tomorrow', 'Remind me about this later'],
        },
        {
          name: 'assign_thread',
          description: 'Assign a thread to a team member.',
          parameters: [
            { name: 'threadId', type: 'id', description: 'UUID of the thread', required: true },
            { name: 'userId', type: 'id', description: 'Assignee', required: true },
          ],
          requiresApproval: false,
          examples: ['Assign thread abc123 to Jane', 'Route to support team'],
        },
        {
          name: 'get_intelligence_report',
          description: 'Get AI analysis of a thread.',
          parameters: [
            { name: 'threadId', type: 'id', description: 'UUID of the thread', required: true },
          ],
          requiresApproval: false,
          examples: ['Analyze thread abc123', 'Get AI insights on this conversation'],
        },
        {
          name: 'merge_threads',
          description: 'Merge duplicate threads.',
          parameters: [
            { name: 'masterThreadId', type: 'id', description: 'Thread to keep', required: true },
            { name: 'duplicateThreadId', type: 'id', description: 'Thread to merge', required: true },
          ],
          requiresApproval: false,
          examples: ['Merge thread abc into def', 'Combine duplicate conversations'],
        },
      ],
      queries: [
        {
          name: 'get_thread_count',
          description: 'Count threads by status.',
          parameters: [
            { name: 'status', type: 'enum', description: 'Thread status', enumValues: ['open', 'closed', 'snoozed', 'all'], required: false, default: 'open' },
          ],
          returns: 'number',
          examples: ['How many open threads?', 'Count snoozed items'],
        },
        {
          name: 'get_unassigned_threads',
          description: 'List threads awaiting assignment.',
          parameters: [
            { name: 'limit', type: 'number', description: 'Max results', required: false, default: 20 },
          ],
          returns: 'Thread[]',
          examples: ['What needs to be assigned?', 'Show unassigned threads'],
        },
        {
          name: 'get_thread_analytics',
          description: 'Inbox analytics for a period.',
          parameters: [
            { name: 'from', type: 'date', description: 'Start date', required: true },
            { name: 'to', type: 'date', description: 'End date', required: true },
          ],
          returns: 'InboxAnalytics',
          examples: ['Show inbox analytics', 'How are we performing?'],
        },
      ],
    },

    // ── 10. GENOME ──────────────────────────────────────────────────────────
    {
      module: 'genome',
      description: 'Business Genome — DNA scoring, growth stage mapping, and readiness assessment.',
      actions: [
        {
          name: 'get_dna',
          description: 'Retrieve the full Business Genome DNA profile.',
          parameters: [
            { name: 'recalculate', type: 'boolean', description: 'Force recalculation', required: false, default: false },
          ],
          requiresApproval: false,
          examples: ['Show our business DNA', 'Get genome profile'],
        },
        {
          name: 'get_stage',
          description: 'Determine the business growth stage.',
          parameters: [
            { name: 'detailed', type: 'boolean', description: 'Include detailed breakdown', required: false, default: false },
          ],
          requiresApproval: false,
          examples: ['What stage is our business?', 'Show growth stage details'],
        },
        {
          name: 'get_readiness',
          description: 'Check readiness for a growth initiative.',
          parameters: [
            { name: 'initiative', type: 'string', description: 'Initiative name', required: true },
          ],
          requiresApproval: false,
          examples: ['Are we ready to scale?', 'Check readiness for expansion'],
        },
        {
          name: 'update_dna',
          description: 'Manually update a DNA dimension score.',
          parameters: [
            { name: 'dimension', type: 'enum', description: 'DNA dimension', enumValues: ['revenue', 'operations', 'marketing', 'product', 'team', 'finance', 'customer_success'], required: true },
            { name: 'score', type: 'number', description: 'New score 0-100', required: true },
            { name: 'reason', type: 'string', description: 'Update reason', required: false },
          ],
          requiresApproval: false,
          examples: ['Update revenue DNA to 85', 'Set team score to 70'],
        },
        {
          name: 'trigger_assessment',
          description: 'Run a full genome assessment.',
          parameters: [
            { name: 'notify', type: 'boolean', description: 'Notify team on completion', required: false, default: true },
          ],
          requiresApproval: false,
          examples: ['Run genome assessment', 'Reassess our business DNA'],
        },
      ],
      queries: [
        {
          name: 'get_dna_history',
          description: 'Historical DNA score changes.',
          parameters: [
            { name: 'dimension', type: 'enum', description: 'Filter dimension', enumValues: ['revenue', 'operations', 'marketing', 'product', 'team', 'finance', 'customer_success'], required: false },
            { name: 'from', type: 'date', description: 'Start date', required: false },
          ],
          returns: 'DnaSnapshot[]',
          examples: ['Show DNA history', 'How has revenue DNA changed?'],
        },
        {
          name: 'get_benchmark',
          description: 'Compare DNA against industry benchmarks.',
          parameters: [
            { name: 'industry', type: 'string', description: 'Industry vertical', required: false },
          ],
          returns: 'BenchmarkComparison',
          examples: ['How do we compare to industry peers?', 'Show benchmark data'],
        },
        {
          name: 'get_recommendations',
          description: 'Get strategic recommendations based on DNA.',
          parameters: [
            { name: 'dimension', type: 'enum', description: 'Focus dimension', enumValues: ['revenue', 'operations', 'marketing', 'product', 'team', 'finance', 'customer_success'], required: false },
            { name: 'limit', type: 'number', description: 'Max recommendations', required: false, default: 5 },
          ],
          returns: 'Recommendation[]',
          examples: ['What should we focus on?', 'Get strategic recommendations'],
        },
        {
          name: 'get_growth_trajectory',
          description: 'Projected growth path based on current DNA.',
          parameters: [
            { name: 'monthsAhead', type: 'number', description: 'Projection horizon', required: false, default: 6 },
          ],
          returns: 'GrowthProjection',
          examples: ['Where will we be in 6 months?', 'Show growth trajectory'],
        },
        {
          name: 'get_dna_breakdown',
          description: 'Detailed per-dimension breakdown with gaps.',
          parameters: [],
          returns: 'DnaBreakdown',
          examples: ['Show DNA breakdown', 'What are our weakest areas?'],
        },
      ],
    },

    // ── 11. INTELLIGENCE ────────────────────────────────────────────────────
    {
      module: 'intelligence',
      description: 'AI-powered insights — churn risk, sentiment analysis, opportunity detection, and forecasting.',
      actions: [
        {
          name: 'analyze_sentiment',
          description: 'Run sentiment analysis on a conversation or text.',
          parameters: [
            { name: 'text', type: 'string', description: 'Text to analyze', required: false },
            { name: 'threadId', type: 'id', description: 'Thread to analyze', required: false },
            { name: 'contactId', type: 'id', description: 'Contact scope', required: false },
          ],
          requiresApproval: false,
          examples: ['Analyze sentiment of thread abc123', 'What is the mood of this conversation?'],
        },
        {
          name: 'detect_opportunities',
          description: 'Scan contacts for revenue opportunities.',
          parameters: [
            { name: 'segment', type: 'string', description: 'Target segment/tag', required: false },
            { name: 'minConfidence', type: 'number', description: 'Minimum confidence 0-1', required: false, default: 0.7 },
            { name: 'limit', type: 'number', description: 'Max results', required: false, default: 20 },
          ],
          requiresApproval: false,
          examples: ['Find upsell opportunities', 'Detect opportunities in VIP segment'],
        },
        {
          name: 'generate_forecast',
          description: 'Predict future metric values.',
          parameters: [
            { name: 'metric', type: 'enum', description: 'Metric to forecast', enumValues: ['revenue', 'contacts', 'bookings', 'churn', 'conversion'], required: true },
            { name: 'horizon', type: 'enum', description: 'Forecast horizon', enumValues: ['1_week', '2_weeks', '1_month', '3_months', '6_months', '1_year'], required: true },
          ],
          requiresApproval: false,
          examples: ['Forecast revenue for next quarter', 'Predict bookings next month'],
        },
        {
          name: 'run_comprehensive_analysis',
          description: 'Run a full business intelligence analysis.',
          parameters: [
            { name: 'scope', type: 'enum', description: 'Analysis scope', enumValues: ['full', 'sales', 'marketing', 'operations', 'financial'], required: false, default: 'full' },
            { name: 'depth', type: 'enum', description: 'Analysis depth', enumValues: ['summary', 'detailed', 'exhaustive'], required: false, default: 'detailed' },
          ],
          requiresApproval: false,
          examples: ['Run full business analysis', 'Deep dive on sales'],
        },
      ],
      queries: [
        {
          name: 'get_churn_risk',
          description: 'Identify contacts at risk of churning.',
          parameters: [
            { name: 'threshold', type: 'number', description: 'Risk score threshold 0-1', required: false, default: 0.6 },
            { name: 'limit', type: 'number', description: 'Max results', required: false, default: 20 },
          ],
          returns: 'ChurnRiskContact[]',
          examples: ['Who is at risk of churning?', 'Show high churn risk contacts'],
        },
        {
          name: 'get_opportunity_pipeline',
          description: 'View current opportunity pipeline with confidence scores.',
          parameters: [
            { name: 'stage', type: 'enum', description: 'Filter by stage', enumValues: ['early', 'qualified', 'proposal', 'negotiation', 'closing'], required: false },
            { name: 'minValue', type: 'number', description: 'Minimum deal value', required: false },
          ],
          returns: 'Opportunity[]',
          examples: ['Show opportunity pipeline', 'List qualified opportunities'],
        },
        {
          name: 'get_sentiment_trends',
          description: 'Track sentiment trends over time.',
          parameters: [
            { name: 'from', type: 'date', description: 'Start date', required: true },
            { name: 'to', type: 'date', description: 'End date', required: true },
            { name: 'channel', type: 'enum', description: 'Filter channel', enumValues: ['sms', 'email', 'whatsapp', 'all'], required: false, default: 'all' },
          ],
          returns: 'SentimentTrend[]',
          examples: ['How has sentiment changed this month?', 'Track sentiment trends'],
        },
        {
          name: 'get_forecast_accuracy',
          description: 'Compare past forecasts to actuals.',
          parameters: [
            { name: 'metric', type: 'enum', description: 'Metric', enumValues: ['revenue', 'contacts', 'bookings', 'churn', 'conversion'], required: true },
          ],
          returns: 'ForecastAccuracy',
          examples: ['How accurate were our forecasts?', 'Check forecast accuracy'],
        },
      ],
    },

    // ── 12. NOTIFICATIONS ───────────────────────────────────────────────────
    {
      module: 'notifications',
      description: 'Push notifications, alerts, email digests, and notification preferences.',
      actions: [
        {
          name: 'send_notification',
          description: 'Send an in-app push notification.',
          parameters: [
            { name: 'userId', type: 'id', description: 'Target user', required: true },
            { name: 'title', type: 'string', description: 'Notification title', required: true },
            { name: 'body', type: 'string', description: 'Notification body', required: true },
            { name: 'actionUrl', type: 'string', description: 'Deep link URL', required: false },
            { name: 'priority', type: 'enum', description: 'Priority', enumValues: ['low', 'normal', 'high', 'urgent'], required: false, default: 'normal' },
          ],
          requiresApproval: false,
          examples: ['Notify Jane about the new lead', 'Send urgent notification about overdue invoice'],
        },
        {
          name: 'create_alert',
          description: 'Create a persistent alert or reminder.',
          parameters: [
            { name: 'title', type: 'string', description: 'Alert title', required: true },
            { name: 'description', type: 'string', description: 'Alert details', required: false },
            { name: 'severity', type: 'enum', description: 'Alert severity', enumValues: ['info', 'warning', 'critical'], required: false, default: 'info' },
            { name: 'entityType', type: 'string', description: 'Related entity type', required: false },
            { name: 'entityId', type: 'id', description: 'Related entity ID', required: false },
          ],
          requiresApproval: false,
          examples: ['Create alert: 3 invoices overdue', 'Set warning alert for low inventory'],
        },
        {
          name: 'dismiss_alert',
          description: 'Mark an alert as acknowledged.',
          parameters: [
            { name: 'alertId', type: 'id', description: 'UUID of the alert', required: true },
            { name: 'notes', type: 'string', description: 'Dismissal notes', required: false },
          ],
          requiresApproval: false,
          examples: ['Dismiss alert abc123', 'Acknowledge the warning'],
        },
        {
          name: 'send_digest',
          description: 'Send a summary digest email to users.',
          parameters: [
            { name: 'userId', type: 'id', description: 'Target user', required: false },
            { name: 'period', type: 'enum', description: 'Digest period', enumValues: ['daily', 'weekly', 'monthly'], required: true },
            { name: 'sections', type: 'array', description: 'Sections to include', required: false },
          ],
          requiresApproval: false,
          examples: ['Send daily digest to Jane', 'Email weekly summary'],
        },
        {
          name: 'update_preferences',
          description: 'Update notification channel preferences.',
          parameters: [
            { name: 'userId', type: 'id', description: 'Target user', required: true },
            { name: 'channel', type: 'enum', description: 'Channel', enumValues: ['push', 'email', 'sms', 'in_app'], required: true },
            { name: 'enabled', type: 'boolean', description: 'Enable/disable', required: true },
            { name: 'categories', type: 'array', description: 'Categories affected', required: false },
          ],
          requiresApproval: false,
          examples: ['Enable email notifications for Jane', 'Turn off SMS alerts'],
        },
        {
          name: 'broadcast_alert',
          description: 'Send an alert to all business users.',
          parameters: [
            { name: 'title', type: 'string', description: 'Alert title', required: true },
            { name: 'body', type: 'string', description: 'Alert body', required: true },
            { name: 'severity', type: 'enum', description: 'Severity', enumValues: ['info', 'warning', 'critical'], required: false, default: 'info' },
          ],
          requiresApproval: true,
          examples: ['Broadcast critical alert: System maintenance tonight'],
        },
      ],
      queries: [
        {
          name: 'get_alerts',
          description: 'List active alerts with optional filtering.',
          parameters: [
            { name: 'severity', type: 'enum', description: 'Filter severity', enumValues: ['info', 'warning', 'critical'], required: false },
            { name: 'acknowledged', type: 'boolean', description: 'Include dismissed', required: false, default: false },
            { name: 'limit', type: 'number', description: 'Max results', required: false, default: 50 },
          ],
          returns: 'Alert[]',
          examples: ['Show active alerts', 'List critical alerts'],
        },
        {
          name: 'get_notification_history',
          description: 'Retrieve past notifications sent.',
          parameters: [
            { name: 'userId', type: 'id', description: 'Filter by user', required: false },
            { name: 'from', type: 'date', description: 'Start date', required: false },
            { name: 'limit', type: 'number', description: 'Max results', required: false, default: 50 },
          ],
          returns: 'Notification[]',
          examples: ['Show notification history', 'List recent notifications'],
        },
        {
          name: 'get_user_preferences',
          description: 'Fetch notification preferences for a user.',
          parameters: [
            { name: 'userId', type: 'id', description: 'User ID', required: true },
          ],
          returns: 'NotificationPreferences',
          examples: ['Get Jane notification preferences'],
        },
        {
          name: 'get_alert_stats',
          description: 'Alert volume and resolution statistics.',
          parameters: [
            { name: 'from', type: 'date', description: 'Start date', required: true },
            { name: 'to', type: 'date', description: 'End date', required: true },
          ],
          returns: 'AlertStats',
          examples: ['How many alerts this week?', 'Show alert statistics'],
        },
      ],
    },

    // ── 13. PROJECTS ────────────────────────────────────────────────────────
    {
      module: 'projects',
      description: 'Project management — projects, milestones, tasks, timelines, and resource allocation.',
      actions: [
        {
          name: 'create_project',
          description: 'Create a new project.',
          parameters: [
            { name: 'name', type: 'string', description: 'Project name', required: true },
            { name: 'description', type: 'string', description: 'Project description', required: false },
            { name: 'contactId', type: 'id', description: 'Related client', required: false },
            { name: 'dueDate', type: 'date', description: 'Target completion date', required: false },
            { name: 'priority', type: 'enum', description: 'Priority', enumValues: ['low', 'medium', 'high', 'urgent'], required: false, default: 'medium' },
            { name: 'assigneeId', type: 'id', description: 'Project owner', required: false },
          ],
          requiresApproval: false,
          examples: ['Create project "Website Redesign"', 'Start project for Acme Corp'],
        },
        {
          name: 'add_task',
          description: 'Add a task to a project.',
          parameters: [
            { name: 'projectId', type: 'id', description: 'UUID of the project', required: true },
            { name: 'title', type: 'string', description: 'Task title', required: true },
            { name: 'description', type: 'string', description: 'Task details', required: false },
            { name: 'assigneeId', type: 'id', description: 'Assigned user', required: false },
            { name: 'dueDate', type: 'date', description: 'Due date', required: false },
            { name: 'priority', type: 'enum', description: 'Priority', enumValues: ['low', 'medium', 'high', 'urgent'], required: false, default: 'medium' },
          ],
          requiresApproval: false,
          examples: ['Add task "Design homepage" to project abc', 'Create task for John in website project'],
        },
        {
          name: 'update_task',
          description: 'Edit a project task.',
          parameters: [
            { name: 'projectId', type: 'id', description: 'UUID of the project', required: true },
            { name: 'taskId', type: 'id', description: 'UUID of the task', required: true },
            { name: 'title', type: 'string', description: 'New title', required: false },
            { name: 'status', type: 'enum', description: 'New status', enumValues: ['todo', 'in_progress', 'review', 'done', 'blocked'], required: false },
            { name: 'assigneeId', type: 'id', description: 'Reassign', required: false },
            { name: 'dueDate', type: 'date', description: 'New due date', required: false },
          ],
          requiresApproval: false,
          examples: ['Update task abc to in_progress', 'Reassign task to Jane'],
        },
        {
          name: 'complete_task',
          description: 'Mark a project task as done.',
          parameters: [
            { name: 'projectId', type: 'id', description: 'UUID of the project', required: true },
            { name: 'taskId', type: 'id', description: 'UUID of the task', required: true },
            { name: 'notes', type: 'string', description: 'Completion notes', required: false },
          ],
          requiresApproval: false,
          examples: ['Mark task abc as complete', 'Finish the homepage design task'],
        },
        {
          name: 'delete_project',
          description: 'Remove a project and its tasks.',
          parameters: [
            { name: 'projectId', type: 'id', description: 'UUID of the project', required: true },
          ],
          requiresApproval: true,
          examples: ['Delete project abc123'],
        },
        {
          name: 'add_milestone',
          description: 'Add a milestone to a project timeline.',
          parameters: [
            { name: 'projectId', type: 'id', description: 'UUID of the project', required: true },
            { name: 'name', type: 'string', description: 'Milestone name', required: true },
            { name: 'dueDate', type: 'date', description: 'Target date', required: true },
            { name: 'description', type: 'string', description: 'Milestone details', required: false },
          ],
          requiresApproval: false,
          examples: ['Add milestone "Beta Launch" to project abc'],
        },
        {
          name: 'complete_milestone',
          description: 'Mark a milestone as achieved.',
          parameters: [
            { name: 'projectId', type: 'id', description: 'UUID of the project', required: true },
            { name: 'milestoneId', type: 'id', description: 'UUID of the milestone', required: true },
            { name: 'notes', type: 'string', description: 'Completion notes', required: false },
          ],
          requiresApproval: false,
          examples: ['Complete milestone abc in project def'],
        },
        {
          name: 'archive_project',
          description: 'Archive a completed project.',
          parameters: [
            { name: 'projectId', type: 'id', description: 'UUID of the project', required: true },
          ],
          requiresApproval: false,
          examples: ['Archive project abc123'],
        },
      ],
      queries: [
        {
          name: 'get_projects',
          description: 'List projects with optional filters.',
          parameters: [
            { name: 'status', type: 'enum', description: 'Filter status', enumValues: ['active', 'completed', 'archived', 'all'], required: false, default: 'active' },
            { name: 'priority', type: 'enum', description: 'Filter priority', enumValues: ['low', 'medium', 'high', 'urgent'], required: false },
            { name: 'assigneeId', type: 'id', description: 'Filter by owner', required: false },
            { name: 'limit', type: 'number', description: 'Max results', required: false, default: 50 },
          ],
          returns: 'Project[]',
          examples: ['List active projects', 'Show high-priority projects'],
        },
        {
          name: 'get_project_details',
          description: 'Fetch full project with tasks and milestones.',
          parameters: [
            { name: 'projectId', type: 'id', description: 'UUID of the project', required: true },
          ],
          returns: 'ProjectDetails',
          examples: ['Show project abc123 details', 'Get project overview'],
        },
        {
          name: 'get_overdue_tasks',
          description: 'List overdue tasks across projects.',
          parameters: [
            { name: 'projectId', type: 'id', description: 'Filter by project', required: false },
            { name: 'assigneeId', type: 'id', description: 'Filter by assignee', required: false },
            { name: 'limit', type: 'number', description: 'Max results', required: false, default: 50 },
          ],
          returns: 'Task[]',
          examples: ['What tasks are overdue?', 'Show overdue items for John'],
        },
        {
          name: 'get_project_timeline',
          description: 'Visual timeline of project milestones and tasks.',
          parameters: [
            { name: 'projectId', type: 'id', description: 'UUID of the project', required: true },
          ],
          returns: 'TimelineEntry[]',
          examples: ['Show timeline for project abc', 'What is the project schedule?'],
        },
      ],
    },

    // ── 14. SOCIAL ──────────────────────────────────────────────────────────
    {
      module: 'social',
      description: 'Social media management — accounts, posts, engagement, and audience analytics.',
      actions: [
        {
          name: 'connect_account',
          description: 'Link a social media account.',
          parameters: [
            { name: 'platform', type: 'enum', description: 'Social platform', enumValues: ['facebook', 'instagram', 'twitter', 'linkedin', 'tiktok', 'youtube'], required: true },
            { name: 'handle', type: 'string', description: 'Account handle', required: true },
            { name: 'accessToken', type: 'string', description: 'OAuth token', required: true },
          ],
          requiresApproval: false,
          examples: ['Connect Facebook page @acme', 'Link Instagram account'],
        },
        {
          name: 'disconnect_account',
          description: 'Unlink a connected social account.',
          parameters: [
            { name: 'accountId', type: 'id', description: 'UUID of the connected account', required: true },
          ],
          requiresApproval: false,
          examples: ['Disconnect account abc123'],
        },
        {
          name: 'schedule_social_post',
          description: 'Queue a post for a social platform.',
          parameters: [
            { name: 'accountId', type: 'id', description: 'UUID of the social account', required: true },
            { name: 'body', type: 'string', description: 'Post content', required: true },
            { name: 'mediaUrls', type: 'array', description: 'Attached media', required: false },
            { name: 'scheduledAt', type: 'date', description: 'Publish time', required: true },
          ],
          requiresApproval: false,
          examples: ['Schedule Instagram post for tomorrow 10am'],
        },
        {
          name: 'publish_now',
          description: 'Immediately publish to a social platform.',
          parameters: [
            { name: 'accountId', type: 'id', description: 'UUID of the social account', required: true },
            { name: 'body', type: 'string', description: 'Post content', required: true },
            { name: 'mediaUrls', type: 'array', description: 'Attached media', required: false },
          ],
          requiresApproval: false,
          examples: ['Post to Facebook now', 'Tweet this message'],
        },
        {
          name: 'reply_to_comment',
          description: 'Respond to a comment on a social post.',
          parameters: [
            { name: 'accountId', type: 'id', description: 'UUID of the social account', required: true },
            { name: 'postId', type: 'string', description: 'Platform post ID', required: true },
            { name: 'commentId', type: 'string', description: 'Platform comment ID', required: true },
            { name: 'reply', type: 'string', description: 'Reply text', required: true },
          ],
          requiresApproval: false,
          examples: ['Reply to comment on Facebook post'],
        },
        {
          name: 'delete_social_post',
          description: 'Remove a published social post.',
          parameters: [
            { name: 'accountId', type: 'id', description: 'UUID of the social account', required: true },
            { name: 'postId', type: 'string', description: 'Platform post ID', required: true },
          ],
          requiresApproval: true,
          examples: ['Delete the Facebook post'],
        },
      ],
      queries: [
        {
          name: 'get_connected_accounts',
          description: 'List linked social media accounts.',
          parameters: [
            { name: 'platform', type: 'enum', description: 'Filter by platform', enumValues: ['facebook', 'instagram', 'twitter', 'linkedin', 'tiktok', 'youtube'], required: false },
          ],
          returns: 'SocialAccount[]',
          examples: ['List connected social accounts', 'Show Facebook pages'],
        },
        {
          name: 'get_scheduled_posts',
          description: 'View upcoming scheduled social posts.',
          parameters: [
            { name: 'accountId', type: 'id', description: 'Filter by account', required: false },
            { name: 'from', type: 'date', description: 'Start date', required: false },
            { name: 'to', type: 'date', description: 'End date', required: false },
          ],
          returns: 'ScheduledPost[]',
          examples: ['Show scheduled posts', 'What is posting this week?'],
        },
        {
          name: 'get_engagement_stats',
          description: 'Aggregate engagement metrics.',
          parameters: [
            { name: 'accountId', type: 'id', description: 'Filter by account', required: false },
            { name: 'from', type: 'date', description: 'Start date', required: true },
            { name: 'to', type: 'date', description: 'End date', required: true },
          ],
          returns: 'EngagementStats',
          examples: ['Show engagement stats', 'How are our posts performing?'],
        },
        {
          name: 'get_follower_growth',
          description: 'Track follower/subscriber growth over time.',
          parameters: [
            { name: 'accountId', type: 'id', description: 'Filter by account', required: false },
            { name: 'from', type: 'date', description: 'Start date', required: true },
            { name: 'to', type: 'date', description: 'End date', required: true },
          ],
          returns: 'FollowerGrowth[]',
          examples: ['Show follower growth', 'How many new followers this month?'],
        },
      ],
    },

    // ── 15. ANALYTICS ───────────────────────────────────────────────────────
    {
      module: 'analytics',
      description: 'Business analytics — dashboards, reports, funnels, cohorts, and custom metrics.',
      actions: [
        {
          name: 'create_dashboard',
          description: 'Build a custom analytics dashboard.',
          parameters: [
            { name: 'name', type: 'string', description: 'Dashboard name', required: true },
            { name: 'widgets', type: 'array', description: 'Widget configurations', required: true },
            { name: 'shared', type: 'boolean', description: 'Share with team', required: false, default: false },
          ],
          requiresApproval: false,
          examples: ['Create dashboard "Sales Overview"'],
        },
        {
          name: 'create_report',
          description: 'Generate a one-time or recurring report.',
          parameters: [
            { name: 'name', type: 'string', description: 'Report name', required: true },
            { name: 'type', type: 'enum', description: 'Report type', enumValues: ['revenue', 'contacts', 'engagement', 'custom'], required: true },
            { name: 'from', type: 'date', description: 'Start date', required: true },
            { name: 'to', type: 'date', description: 'End date', required: true },
            { name: 'schedule', type: 'enum', description: 'Recurrence', enumValues: ['once', 'daily', 'weekly', 'monthly'], required: false, default: 'once' },
          ],
          requiresApproval: false,
          examples: ['Create weekly revenue report'],
        },
        {
          name: 'create_funnel',
          description: 'Define a conversion funnel.',
          parameters: [
            { name: 'name', type: 'string', description: 'Funnel name', required: true },
            { name: 'steps', type: 'array', description: 'Ordered step definitions', required: true },
          ],
          requiresApproval: false,
          examples: ['Create funnel "Lead to Customer"'],
        },
        {
          name: 'track_event',
          description: 'Record a custom analytics event.',
          parameters: [
            { name: 'eventName', type: 'string', description: 'Event key', required: true },
            { name: 'contactId', type: 'id', description: 'Associated contact', required: false },
            { name: 'properties', type: 'object', description: 'Event properties', required: false },
          ],
          requiresApproval: false,
          examples: ['Track event "pricing_page_view"'],
        },
        {
          name: 'export_report',
          description: 'Export a report to CSV/PDF.',
          parameters: [
            { name: 'reportId', type: 'id', description: 'UUID of the report', required: true },
            { name: 'format', type: 'enum', description: 'Export format', enumValues: ['csv', 'pdf', 'xlsx'], required: false, default: 'csv' },
          ],
          requiresApproval: false,
          examples: ['Export report abc123 as CSV'],
        },
      ],
      queries: [
        {
          name: 'get_dashboard',
          description: 'Fetch a dashboard with current data.',
          parameters: [
            { name: 'dashboardId', type: 'id', description: 'UUID of the dashboard', required: true },
          ],
          returns: 'Dashboard',
          examples: ['Show dashboard abc123', 'Open the sales dashboard'],
        },
        {
          name: 'get_funnel_conversion',
          description: 'Compute conversion rate for a funnel.',
          parameters: [
            { name: 'funnelId', type: 'id', description: 'UUID of the funnel', required: true },
            { name: 'from', type: 'date', description: 'Start date', required: false },
            { name: 'to', type: 'date', description: 'End date', required: false },
          ],
          returns: 'FunnelConversion',
          examples: ['What is our lead-to-customer conversion?', 'Show funnel stats'],
        },
        {
          name: 'get_cohort_retention',
          description: 'Calculate cohort retention matrix.',
          parameters: [
            { name: 'cohortType', type: 'enum', description: 'Cohort dimension', enumValues: ['signup_date', 'first_purchase', 'first_booking'], required: true },
            { name: 'periods', type: 'number', description: 'Number of periods', required: false, default: 6 },
          ],
          returns: 'CohortMatrix',
          examples: ['Show customer retention cohorts', 'Get signup cohort analysis'],
        },
        {
          name: 'get_kpis',
          description: 'Fetch core business KPIs.',
          parameters: [
            { name: 'from', type: 'date', description: 'Start date', required: false },
            { name: 'to', type: 'date', description: 'End date', required: false },
          ],
          returns: 'KpiSet',
          examples: ['What are our KPIs?', 'Show core metrics'],
        },
        {
          name: 'get_trend',
          description: 'Time-series trend for a specific metric.',
          parameters: [
            { name: 'metric', type: 'enum', description: 'Metric name', enumValues: ['revenue', 'contacts', 'bookings', 'conversations', 'conversion_rate', 'response_time'], required: true },
            { name: 'granularity', type: 'enum', description: 'Time bucket', enumValues: ['hourly', 'daily', 'weekly', 'monthly'], required: false, default: 'daily' },
            { name: 'from', type: 'date', description: 'Start date', required: true },
            { name: 'to', type: 'date', description: 'End date', required: true },
          ],
          returns: 'TrendPoint[]',
          examples: ['Show revenue trend this month', 'Plot contact growth'],
        },
      ],
    },

    // ── 16. FINANCE ─────────────────────────────────────────────────────────
    {
      module: 'finance',
      description: 'Financial management — expenses, budgets, tax categories, and financial reporting.',
      actions: [
        {
          name: 'record_expense',
          description: 'Log a business expense.',
          parameters: [
            { name: 'description', type: 'string', description: 'Expense description', required: true },
            { name: 'amount', type: 'number', description: 'Expense amount', required: true },
            { name: 'category', type: 'enum', description: 'Expense category', enumValues: ['office', 'travel', 'marketing', 'software', 'salaries', 'utilities', 'other'], required: true },
            { name: 'date', type: 'date', description: 'Expense date', required: false },
            { name: 'receiptUrl', type: 'string', description: 'Receipt image URL', required: false },
          ],
          requiresApproval: false,
          examples: ['Record $50 office supplies expense'],
        },
        {
          name: 'create_budget',
          description: 'Set a spending budget for a category.',
          parameters: [
            { name: 'category', type: 'enum', description: 'Budget category', enumValues: ['office', 'travel', 'marketing', 'software', 'salaries', 'utilities', 'other', 'overall'], required: true },
            { name: 'amount', type: 'number', description: 'Budget limit', required: true },
            { name: 'period', type: 'enum', description: 'Budget period', enumValues: ['weekly', 'monthly', 'quarterly', 'yearly'], required: true },
            { name: 'startDate', type: 'date', description: 'Budget start', required: true },
          ],
          requiresApproval: false,
          examples: ['Set monthly marketing budget to $2000'],
        },
        {
          name: 'update_budget',
          description: 'Modify an existing budget.',
          parameters: [
            { name: 'budgetId', type: 'id', description: 'UUID of the budget', required: true },
            { name: 'amount', type: 'number', description: 'New limit', required: false },
            { name: 'active', type: 'boolean', description: 'Enable/disable', required: false },
          ],
          requiresApproval: false,
          examples: ['Update budget abc123 to $3000'],
        },
        {
          name: 'delete_expense',
          description: 'Remove an expense record.',
          parameters: [
            { name: 'expenseId', type: 'id', description: 'UUID of the expense', required: true },
          ],
          requiresApproval: false,
          examples: ['Delete expense abc123'],
        },
        {
          name: 'categorize_transaction',
          description: 'Assign a category to an uncategorized transaction.',
          parameters: [
            { name: 'transactionId', type: 'id', description: 'UUID of the transaction', required: true },
            { name: 'category', type: 'enum', description: 'Category', enumValues: ['office', 'travel', 'marketing', 'software', 'salaries', 'utilities', 'other'], required: true },
          ],
          requiresApproval: false,
          examples: ['Categorize transaction abc as marketing'],
        },
        {
          name: 'generate_pnl',
          description: 'Generate a profit and loss statement.',
          parameters: [
            { name: 'from', type: 'date', description: 'Start date', required: true },
            { name: 'to', type: 'date', description: 'End date', required: true },
            { name: 'format', type: 'enum', description: 'Output format', enumValues: ['summary', 'detailed'], required: false, default: 'summary' },
          ],
          requiresApproval: false,
          examples: ['Generate P&L for this quarter'],
        },
      ],
      queries: [
        {
          name: 'get_expense_summary',
          description: 'Aggregate expenses by category for a period.',
          parameters: [
            { name: 'from', type: 'date', description: 'Start date', required: true },
            { name: 'to', type: 'date', description: 'End date', required: true },
          ],
          returns: 'ExpenseSummary',
          examples: ['Show expense summary for this month', 'How much did we spend?'],
        },
        {
          name: 'get_budget_status',
          description: 'Check budget utilization vs limits.',
          parameters: [
            { name: 'category', type: 'enum', description: 'Filter by category', enumValues: ['office', 'travel', 'marketing', 'software', 'salaries', 'utilities', 'other', 'overall'], required: false },
          ],
          returns: 'BudgetStatus[]',
          examples: ['Are we within budget?', 'Show budget status'],
        },
        {
          name: 'get_cashflow',
          description: 'Cash flow projection and history.',
          parameters: [
            { name: 'from', type: 'date', description: 'Start date', required: true },
            { name: 'to', type: 'date', description: 'End date', required: true },
          ],
          returns: 'CashFlow',
          examples: ['Show cash flow', 'What is our cash position?'],
        },
        {
          name: 'get_financial_health',
          description: 'Overall financial health score and metrics.',
          parameters: [],
          returns: 'FinancialHealth',
          examples: ['How is our financial health?', 'Show financial overview'],
        },
      ],
    },

    // ── 17. SETTINGS ────────────────────────────────────────────────────────
    {
      module: 'settings',
      description: 'Business settings — profile, branding, integrations, team, and permissions.',
      actions: [
        {
          name: 'update_business_profile',
          description: 'Update core business information.',
          parameters: [
            { name: 'name', type: 'string', description: 'Business name', required: false },
            { name: 'timezone', type: 'string', description: 'IANA timezone', required: false },
            { name: 'currency', type: 'string', description: 'ISO currency code', required: false },
            { name: 'industry', type: 'string', description: 'Industry vertical', required: false },
          ],
          requiresApproval: false,
          examples: ['Update business timezone to America/New_York'],
        },
        {
          name: 'update_branding',
          description: 'Update brand colors, logo, and email templates.',
          parameters: [
            { name: 'primaryColor', type: 'string', description: 'Hex primary color', required: false },
            { name: 'logoUrl', type: 'string', description: 'Logo image URL', required: false },
            { name: 'emailSignature', type: 'string', description: 'Default email signature', required: false },
          ],
          requiresApproval: false,
          examples: ['Update primary color to #FF5733'],
        },
        {
          name: 'add_team_member',
          description: 'Invite a new user to the business.',
          parameters: [
            { name: 'email', type: 'string', description: 'User email', required: true },
            { name: 'role', type: 'enum', description: 'Permission role', enumValues: ['owner', 'admin', 'manager', 'member', 'viewer'], required: true },
            { name: 'firstName', type: 'string', description: 'First name', required: false },
            { name: 'lastName', type: 'string', description: 'Last name', required: false },
          ],
          requiresApproval: false,
          examples: ['Invite john@example.com as admin'],
        },
        {
          name: 'remove_team_member',
          description: "Revoke a user's access.",
          parameters: [
            { name: 'userId', type: 'id', description: 'UUID of the user', required: true },
          ],
          requiresApproval: true,
          examples: ['Remove user abc123 from team'],
        },
        {
          name: 'update_role',
          description: "Change a team member's permission role.",
          parameters: [
            { name: 'userId', type: 'id', description: 'UUID of the user', required: true },
            { name: 'role', type: 'enum', description: 'New role', enumValues: ['owner', 'admin', 'manager', 'member', 'viewer'], required: true },
          ],
          requiresApproval: true,
          examples: ['Change user abc123 role to manager'],
        },
        {
          name: 'configure_integration',
          description: 'Enable or configure a third-party integration.',
          parameters: [
            { name: 'integration', type: 'enum', description: 'Integration key', enumValues: ['stripe', 'paypal', 'twilio', 'sendgrid', 'mailchimp', 'google_calendar', 'zoom', 'slack', 'zapier'], required: true },
            { name: 'config', type: 'object', description: 'Integration-specific config', required: true },
            { name: 'enabled', type: 'boolean', description: 'Enable/disable', required: false, default: true },
          ],
          requiresApproval: false,
          examples: ['Configure Stripe integration', 'Enable Google Calendar sync'],
        },
      ],
      queries: [
        {
          name: 'get_business_profile',
          description: 'Fetch current business profile settings.',
          parameters: [],
          returns: 'BusinessProfile',
          examples: ['Show business profile', 'What is our business info?'],
        },
        {
          name: 'get_team_members',
          description: 'List all team members and their roles.',
          parameters: [
            { name: 'role', type: 'enum', description: 'Filter by role', enumValues: ['owner', 'admin', 'manager', 'member', 'viewer'], required: false },
            { name: 'activeOnly', type: 'boolean', description: 'Only active users', required: false, default: true },
          ],
          returns: 'TeamMember[]',
          examples: ['List team members', 'Who has admin access?'],
        },
        {
          name: 'get_integrations',
          description: 'List configured third-party integrations.',
          parameters: [
            { name: 'enabledOnly', type: 'boolean', description: 'Only active', required: false, default: true },
          ],
          returns: 'Integration[]',
          examples: ['What integrations are connected?', 'List active integrations'],
        },
        {
          name: 'get_permissions',
          description: 'Get role-based permission matrix.',
          parameters: [],
          returns: 'PermissionMatrix',
          examples: ['Show permission matrix', 'What can managers do?'],
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
          examples: ['Log that invoice abc was sent', 'Record contact creation event'],
        },
        {
          name: 'log_bulk_activity',
          description: 'Record multiple activity events at once.',
          parameters: [
            { name: 'events', type: 'array', description: 'Array of activity events', required: true },
          ],
          requiresApproval: false,
          examples: ['Log batch of campaign send events'],
        },
        {
          name: 'create_audit_note',
          description: 'Attach a manual audit note to an entity.',
          parameters: [
            { name: 'entityType', type: 'enum', description: 'Entity type', enumValues: ['contact', 'invoice', 'booking', 'project', 'task', 'automation', 'user'], required: true },
            { name: 'entityId', type: 'id', description: 'Entity UUID', required: true },
            { name: 'note', type: 'string', description: 'Audit note text', required: true },
          ],
          requiresApproval: false,
          examples: ['Add audit note to contact abc123'],
        },
        {
          name: 'export_audit_log',
          description: 'Export audit trail for compliance.',
          parameters: [
            { name: 'from', type: 'date', description: 'Start date', required: true },
            { name: 'to', type: 'date', description: 'End date', required: true },
            { name: 'entityType', type: 'enum', description: 'Filter by entity', enumValues: ['contact', 'invoice', 'booking', 'project', 'task', 'automation', 'user'], required: false },
            { name: 'format', type: 'enum', description: 'Export format', enumValues: ['csv', 'pdf', 'json'], required: false, default: 'csv' },
          ],
          requiresApproval: false,
          examples: ['Export audit log for January'],
        },
        {
          name: 'delete_old_logs',
          description: 'Purge activity logs older than a retention threshold.',
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