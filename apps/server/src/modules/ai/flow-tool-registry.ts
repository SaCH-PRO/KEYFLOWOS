export type RiskLevel = 'low' | 'medium' | 'high';
export type RiskTier = 1 | 2 | 3 | 4;

export interface FlowTool {
  name: string;
  description: string;
  riskLevel: RiskLevel;
  riskTier: RiskTier;
  parameters: {
    type: 'object';
    properties: Record<string, {
      type: string;
      description: string;
      enum?: string[];
      items?: { type: string };
    }>;
    required: string[];
  };
}

export const FLOW_TOOLS: FlowTool[] = [
  // ========== CRM ==========
  {
    name: 'crm_search_contacts',
    description: 'Search for contacts by name, email, or phone number.',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search term (name, email, or phone)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'crm_create_contact',
    description: 'Create a new contact in the CRM.',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    parameters: {
      type: 'object',
      properties: {
        firstName: { type: 'string', description: 'First name of the contact' },
        lastName: { type: 'string', description: 'Last name of the contact' },
        email: { type: 'string', description: 'Email address' },
        phone: { type: 'string', description: 'Phone number' },
        companyName: { type: 'string', description: 'Company or organization name' },
        status: { type: 'string', description: 'Contact status', enum: ['LEAD', 'PROSPECT', 'CLIENT', 'INACTIVE'] },
      },
      required: [],
    },
  },
  {
    name: 'crm_update_contact',
    description: 'Update an existing contact\'s information.',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    parameters: {
      type: 'object',
      properties: {
        contactId: { type: 'string', description: 'The ID of the contact to update' },
        firstName: { type: 'string', description: 'Updated first name' },
        lastName: { type: 'string', description: 'Updated last name' },
        email: { type: 'string', description: 'Updated email address' },
        phone: { type: 'string', description: 'Updated phone number' },
        status: { type: 'string', description: 'Updated status', enum: ['LEAD', 'PROSPECT', 'CLIENT', 'INACTIVE'] },
        companyName: { type: 'string', description: 'Updated company name' },
      },
      required: ['contactId'],
    },
  },
  {
    name: 'crm_add_note',
    description: 'Add a note to a contact\'s timeline.',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    parameters: {
      type: 'object',
      properties: {
        contactId: { type: 'string', description: 'The contact ID to add the note to' },
        body: { type: 'string', description: 'The note content' },
      },
      required: ['contactId', 'body'],
    },
  },
  {
    name: 'crm_add_task',
    description: 'Add a task for a contact.',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    parameters: {
      type: 'object',
      properties: {
        contactId: { type: 'string', description: 'The contact ID to add the task to' },
        title: { type: 'string', description: 'Task title or description' },
        dueDate: { type: 'string', description: 'Due date in ISO format (e.g. 2026-04-15T14:00:00Z)' },
        priority: { type: 'string', description: 'Task priority', enum: ['LOW', 'MEDIUM', 'HIGH'] },
      },
      required: ['contactId', 'title'],
    },
  },
  {
    name: 'crm_delete_contact',
    description: 'Delete (soft-delete) a contact from the CRM.',
    riskLevel: 'high',
    riskTier: 3 as RiskTier,
    parameters: {
      type: 'object',
      properties: {
        contactId: { type: 'string', description: 'The ID of the contact to delete' },
      },
      required: ['contactId'],
    },
  },
  {
    name: 'crm_list_contacts',
    description: 'List contacts with optional filters.',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Filter by status (LEAD, PROSPECT, CLIENT, INACTIVE)' },
        limit: { type: 'number', description: 'Maximum number of contacts to return (default 10)' },
      },
      required: [],
    },
  },

  // ========== COMMERCE ==========
  {
    name: 'commerce_create_invoice',
    description: 'Create a new invoice for a contact.',
    riskLevel: 'medium',
    riskTier: 2 as RiskTier,
    parameters: {
      type: 'object',
      properties: {
        contactId: { type: 'string', description: 'The contact ID to create the invoice for' },
        items: {
          type: 'array',
          description: 'Invoice line items',
          items: { type: 'object' },
        },
        currency: { type: 'string', description: 'Currency code (default TTD)' },
        dueDate: { type: 'string', description: 'Due date in ISO format' },
        notes: { type: 'string', description: 'Additional notes on the invoice' },
      },
      required: ['items'],
    },
  },
  {
    name: 'commerce_list_invoices',
    description: 'List invoices with optional status filter.',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Maximum number of invoices to return (default 10)' },
      },
      required: [],
    },
  },
  {
    name: 'commerce_mark_invoice_paid',
    description: 'Mark an invoice as paid.',
    riskLevel: 'medium',
    riskTier: 2 as RiskTier,
    parameters: {
      type: 'object',
      properties: {
        invoiceId: { type: 'string', description: 'The invoice ID to mark as paid' },
      },
      required: ['invoiceId'],
    },
  },
  {
    name: 'commerce_create_product',
    description: 'Create a new product or service in the catalog.',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Product name' },
        price: { type: 'number', description: 'Product price' },
        currency: { type: 'string', description: 'Currency code (default TTD)' },
        description: { type: 'string', description: 'Product description' },
        category: { type: 'string', description: 'Product category', enum: ['PRODUCT', 'SERVICE', 'SUBSCRIPTION'] },
      },
      required: ['name', 'price'],
    },
  },
  {
    name: 'commerce_create_quote',
    description: 'Create a quote for a contact.',
    riskLevel: 'medium',
    riskTier: 2 as RiskTier,
    parameters: {
      type: 'object',
      properties: {
        contactId: { type: 'string', description: 'The contact ID for the quote' },
        items: {
          type: 'array',
          description: 'Quote line items',
          items: { type: 'object' },
        },
        currency: { type: 'string', description: 'Currency code (default TTD)' },
        expiryDate: { type: 'string', description: 'Expiry date in ISO format' },
      },
      required: ['contactId', 'items'],
    },
  },
  {
    name: 'commerce_delete_invoice',
    description: 'Delete an invoice.',
    riskLevel: 'high',
    riskTier: 3 as RiskTier,
    parameters: {
      type: 'object',
      properties: {
        invoiceId: { type: 'string', description: 'The invoice ID to delete' },
      },
      required: ['invoiceId'],
    },
  },

  // ========== BOOKINGS ==========
  {
    name: 'bookings_create_booking',
    description: 'Create a new booking/appointment for a contact.',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    parameters: {
      type: 'object',
      properties: {
        contactId: { type: 'string', description: 'The contact ID for the booking' },
        serviceId: { type: 'string', description: 'The service ID to book' },
        staffId: { type: 'string', description: 'The staff member ID (optional)' },
        startTime: { type: 'string', description: 'Start time in ISO format (e.g. 2026-04-15T14:00:00Z)' },
        endTime: { type: 'string', description: 'End time in ISO format' },
        notes: { type: 'string', description: 'Booking notes' },
      },
      required: ['contactId', 'startTime', 'endTime'],
    },
  },
  {
    name: 'bookings_list_bookings',
    description: 'List upcoming bookings.',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Maximum number of bookings to return (default 10)' },
      },
      required: [],
    },
  },
  {
    name: 'bookings_reschedule_booking',
    description: 'Reschedule an existing booking to a new time.',
    riskLevel: 'medium',
    riskTier: 2 as RiskTier,
    parameters: {
      type: 'object',
      properties: {
        bookingId: { type: 'string', description: 'The booking ID to reschedule' },
        startTime: { type: 'string', description: 'New start time in ISO format' },
      },
      required: ['bookingId', 'startTime'],
    },
  },
  {
    name: 'bookings_cancel_booking',
    description: 'Cancel an existing booking.',
    riskLevel: 'high',
    riskTier: 3 as RiskTier,
    parameters: {
      type: 'object',
      properties: {
        bookingId: { type: 'string', description: 'The booking ID to cancel' },
      },
      required: ['bookingId'],
    },
  },
  {
    name: 'bookings_list_services',
    description: 'List all available services for booking.',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },

  // ========== MARKETING ==========
  {
    name: 'marketing_create_campaign',
    description: 'Create a new email marketing campaign (draft).',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Campaign name' },
        subject: { type: 'string', description: 'Email subject line' },
        body: { type: 'string', description: 'Email body content (HTML or plain text)' },
        scheduledAt: { type: 'string', description: 'Optional schedule date in ISO format' },
      },
      required: ['name', 'subject', 'body'],
    },
  },
  {
    name: 'marketing_send_campaign',
    description: 'Send an existing email campaign to contacts.',
    riskLevel: 'high',
    riskTier: 4 as RiskTier,
    parameters: {
      type: 'object',
      properties: {
        campaignId: { type: 'string', description: 'The campaign ID to send' },
      },
      required: ['campaignId'],
    },
  },
  {
    name: 'marketing_list_campaigns',
    description: 'List email marketing campaigns.',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },

  // ========== SOCIAL ==========
  {
    name: 'social_create_post',
    description: 'Create a new social media post (draft or scheduled).',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    parameters: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'The post content/caption' },
        scheduledFor: { type: 'string', description: 'Optional schedule date in ISO format' },
      },
      required: ['content'],
    },
  },
  {
    name: 'social_publish_post',
    description: 'Publish a social media post immediately.',
    riskLevel: 'high',
    riskTier: 3 as RiskTier,
    parameters: {
      type: 'object',
      properties: {
        postId: { type: 'string', description: 'The post ID to publish' },
      },
      required: ['postId'],
    },
  },
  {
    name: 'social_list_posts',
    description: 'List social media posts.',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },

  // ========== AUTOMATIONS ==========
  {
    name: 'automations_create_playbook',
    description: 'Create a new automation playbook.',
    riskLevel: 'medium',
    riskTier: 2 as RiskTier,
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Playbook name' },
        triggerEvent: { type: 'string', description: 'The event that triggers this automation (e.g. contact_created, invoice_paid)' },
        condition: { type: 'string', description: 'Optional condition for when to run' },
      },
      required: ['name', 'triggerEvent'],
    },
  },
  {
    name: 'automations_list_playbooks',
    description: 'List automation playbooks.',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'automations_toggle_playbook',
    description: 'Enable or disable an automation playbook.',
    riskLevel: 'medium',
    riskTier: 2 as RiskTier,
    parameters: {
      type: 'object',
      properties: {
        playbookId: { type: 'string', description: 'The playbook ID to toggle' },
        enabled: { type: 'boolean', description: 'Whether to enable (true) or disable (false) the playbook' },
      },
      required: ['playbookId', 'enabled'],
    },
  },
];

export function getOpenAiToolDefinitions() {
  return FLOW_TOOLS.map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

export function getToolByName(name: string): FlowTool | undefined {
  return FLOW_TOOLS.find((t) => t.name === name);
}
