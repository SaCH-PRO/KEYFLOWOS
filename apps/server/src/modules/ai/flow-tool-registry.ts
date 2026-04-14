export type RiskLevel = 'low' | 'medium' | 'high';
export type RiskTier = 1 | 2 | 3 | 4;
export type ToolFamily = 'read' | 'draft' | 'organize' | 'execute' | 'crud';

export interface ToolParamSchema {
  type: 'object';
  properties: Record<string, {
    type: string;
    description: string;
    enum?: string[];
    items?: { type: string };
  }>;
  required: string[];
  [key: string]: unknown;
}

export interface ToolOutputSchema {
  type: 'object';
  description: string;
  fields: Record<string, { type: string; description: string }>;
}

export interface FlowTool {
  name: string;
  description: string;
  family: ToolFamily;
  riskLevel: RiskLevel;
  riskTier: RiskTier;
  changedEntities?: string[];
  followOnSuggestions?: string[];
  parameters: ToolParamSchema;
  outputSchema: ToolOutputSchema;
}

export interface ToolExecutionEnvelope<T = any> {
  result: T;
  changedEntities: string[];
  followOnSuggestions: string[];
  family: ToolFamily;
  riskTier: RiskTier;
}

export function wrapToolResult(toolName: string, result: any): ToolExecutionEnvelope {
  const tool = getToolByName(toolName);
  return {
    result,
    changedEntities: tool?.changedEntities ?? [],
    followOnSuggestions: tool?.followOnSuggestions ?? [],
    family: tool?.family ?? 'crud',
    riskTier: tool?.riskTier ?? (1 as RiskTier),
  };
}

export const FLOW_TOOLS: FlowTool[] = [
  // ================================================================
  //  READ FAMILY — Tier 1, safe read-only intelligence queries
  // ================================================================
  {
    name: 'fetch_business_summary',
    description: 'Get an overall business health snapshot including revenue, contacts, bookings, expenses, and momentum score.',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
    outputSchema: {
      type: 'object',
      description: 'Business health snapshot',
      fields: {
        businessName: { type: 'string', description: 'Business name' },
        industry: { type: 'string', description: 'Business industry' },
        momentumScore: { type: 'number', description: 'Momentum score 0-100' },
        contacts: { type: 'object', description: 'Contact stats (total, byStatus, staleLeadCount)' },
        revenue: { type: 'object', description: 'Revenue stats (totalCollected, monthlyRevenue, outstandingAmount)' },
        bookings: { type: 'object', description: 'Booking stats (upcomingCount, completedThisMonth)' },
        expenses: { type: 'object', description: 'Expense stats (totalThisMonth)' },
      },
    },
  },
  {
    name: 'fetch_client_health',
    description: 'Analyze client engagement health — stale leads, at-risk clients, top spenders, and engagement gaps.',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    parameters: {
      type: 'object',
      properties: {
        contactId: { type: 'string', description: 'Optional: analyze a specific contact. Omit for portfolio-wide health.' },
      },
      required: [],
    },
    outputSchema: {
      type: 'object',
      description: 'Client health analysis',
      fields: {
        totalContacts: { type: 'number', description: 'Total contact count' },
        staleLeads: { type: 'number', description: 'Leads with no activity in 14+ days' },
        atRiskClients: { type: 'number', description: 'Clients with no activity in 30+ days' },
        topSpenders: { type: 'array', description: 'Top 5 spenders with name and totalSpend' },
        healthScore: { type: 'number', description: 'Client health score 0-100' },
      },
    },
  },
  {
    name: 'fetch_schedule_health',
    description: 'Analyze calendar utilization — upcoming gaps, overbookings, no-show risk, and capacity metrics.',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    parameters: {
      type: 'object',
      properties: {
        days: { type: 'number', description: 'Number of days ahead to analyze (default 7)' },
      },
      required: [],
    },
    outputSchema: {
      type: 'object',
      description: 'Schedule health analysis',
      fields: {
        totalUpcoming: { type: 'number', description: 'Total upcoming bookings' },
        bookingsByDay: { type: 'object', description: 'Booking counts by date string' },
        emptyDays: { type: 'array', description: 'Dates with no bookings' },
        cancelledLast7Days: { type: 'number', description: 'Cancellations in last 7 days' },
        utilizationPct: { type: 'number', description: 'Calendar utilization percentage' },
      },
    },
  },
  {
    name: 'fetch_revenue_risk',
    description: 'Identify revenue risk indicators — overdue invoices, declining trends, concentration risk, and cash flow alerts.',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
    outputSchema: {
      type: 'object',
      description: 'Revenue risk indicators',
      fields: {
        overdueCount: { type: 'number', description: 'Number of overdue invoices' },
        overdueTotal: { type: 'number', description: 'Total overdue amount (TTD)' },
        revenueThisMonth: { type: 'number', description: 'Revenue collected this month' },
        revenueTrend: { type: 'number', description: 'Month-over-month revenue change %' },
        trendLabel: { type: 'string', description: 'growing | declining | stable' },
        topClientConcentration: { type: 'number', description: 'Top client revenue concentration %' },
        concentrationRisk: { type: 'string', description: 'high | medium | low' },
      },
    },
  },
  {
    name: 'fetch_storefront_quality',
    description: 'Assess public storefront readiness — product completeness, missing descriptions, pricing gaps, and SEO signals.',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
    outputSchema: {
      type: 'object',
      description: 'Storefront quality assessment',
      fields: {
        totalProducts: { type: 'number', description: 'Total product count' },
        activeProducts: { type: 'number', description: 'Active product count' },
        qualityScore: { type: 'number', description: 'Quality score 0-100' },
        issues: { type: 'array', description: 'List of quality issues' },
        productsNeedingWork: { type: 'array', description: 'Products with specific issues' },
      },
    },
  },
  {
    name: 'fetch_project_status',
    description: 'Get delivery status across all projects — health scores, overdue milestones, at-risk deliverables.',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    parameters: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Optional: get status for a specific project. Omit for all projects.' },
      },
      required: [],
    },
    outputSchema: {
      type: 'object',
      description: 'Project delivery status',
      fields: {
        projects: { type: 'array', description: 'Project summaries with health, progress, task counts' },
        totalProjects: { type: 'number', description: 'Total project count' },
      },
    },
  },
  {
    name: 'fetch_expense_pressure',
    description: 'Analyze expense trends — month-over-month growth, category breakdown, budget pressure, and savings opportunities.',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
    outputSchema: {
      type: 'object',
      description: 'Expense pressure analysis',
      fields: {
        currentMonthTotal: { type: 'number', description: 'Current month expenses (TTD)' },
        lastMonthTotal: { type: 'number', description: 'Last month expenses (TTD)' },
        monthOverMonthChange: { type: 'number', description: 'Month-over-month change %' },
        expenseToRevenueRatio: { type: 'number', description: 'Expense-to-revenue ratio %' },
        pressure: { type: 'string', description: 'high | moderate | low' },
        topCategories: { type: 'array', description: 'Top expense categories with totals' },
      },
    },
  },

  // ================================================================
  //  DRAFT FAMILY — Tier 1, AI-generated content (no side effects)
  // ================================================================
  {
    name: 'draft_followup_message',
    description: 'Draft a follow-up message for a contact based on their history and engagement status.',
    family: 'draft',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    parameters: {
      type: 'object',
      properties: {
        contactId: { type: 'string', description: 'The contact to draft a follow-up for' },
        channel: { type: 'string', description: 'Message channel', enum: ['email', 'whatsapp', 'sms'] },
        tone: { type: 'string', description: 'Message tone', enum: ['friendly', 'professional', 'urgent'] },
      },
      required: ['contactId'],
    },
    outputSchema: {
      type: 'object',
      description: 'Drafted follow-up message',
      fields: {
        subject: { type: 'string', description: 'Message subject line' },
        body: { type: 'string', description: 'Message body content' },
        channel: { type: 'string', description: 'Selected channel' },
        contactName: { type: 'string', description: 'Contact name' },
      },
    },
  },
  {
    name: 'draft_campaign_bundle',
    description: 'Draft a complete campaign bundle — subject line, email body, and CTA — for a given objective.',
    family: 'draft',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    parameters: {
      type: 'object',
      properties: {
        objective: { type: 'string', description: 'Campaign goal (e.g. "re-engage dormant clients", "announce holiday sale")' },
        audience: { type: 'string', description: 'Target audience description' },
        tone: { type: 'string', description: 'Campaign tone', enum: ['casual', 'professional', 'festive', 'urgent'] },
      },
      required: ['objective'],
    },
    outputSchema: {
      type: 'object',
      description: 'Drafted campaign bundle',
      fields: {
        subject: { type: 'string', description: 'Email subject line' },
        body: { type: 'string', description: 'Email body HTML' },
        cta: { type: 'string', description: 'Call-to-action text' },
        audience: { type: 'string', description: 'Target audience description' },
      },
    },
  },
  {
    name: 'draft_payment_reminder',
    description: 'Draft a payment reminder message for an overdue or upcoming invoice.',
    family: 'draft',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    parameters: {
      type: 'object',
      properties: {
        invoiceId: { type: 'string', description: 'The invoice to draft a reminder for' },
        urgency: { type: 'string', description: 'Reminder urgency level', enum: ['gentle', 'firm', 'final'] },
      },
      required: ['invoiceId'],
    },
    outputSchema: {
      type: 'object',
      description: 'Drafted payment reminder',
      fields: {
        subject: { type: 'string', description: 'Reminder subject line' },
        body: { type: 'string', description: 'Reminder body content' },
        invoiceNumber: { type: 'string', description: 'Invoice reference' },
        amountDue: { type: 'number', description: 'Amount due (TTD)' },
      },
    },
  },
  {
    name: 'draft_storefront_copy',
    description: 'Draft compelling storefront product/service description copy.',
    family: 'draft',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    parameters: {
      type: 'object',
      properties: {
        productId: { type: 'string', description: 'The product to write copy for' },
        style: { type: 'string', description: 'Copy style', enum: ['concise', 'storytelling', 'benefit-focused', 'luxury'] },
      },
      required: ['productId'],
    },
    outputSchema: {
      type: 'object',
      description: 'Drafted storefront copy',
      fields: {
        productName: { type: 'string', description: 'Product name' },
        description: { type: 'string', description: 'Generated product description' },
        tagline: { type: 'string', description: 'Short tagline' },
      },
    },
  },
  {
    name: 'draft_project_update',
    description: 'Draft a project status update message suitable for sharing with the client.',
    family: 'draft',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    parameters: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'The project to draft an update for' },
        includeTimeline: { type: 'boolean', description: 'Include timeline/milestone details (default true)' },
      },
      required: ['projectId'],
    },
    outputSchema: {
      type: 'object',
      description: 'Drafted project update',
      fields: {
        subject: { type: 'string', description: 'Update subject line' },
        body: { type: 'string', description: 'Update body content' },
        projectName: { type: 'string', description: 'Project name' },
        progress: { type: 'number', description: 'Project progress percentage' },
      },
    },
  },

  // ================================================================
  //  ORGANIZE FAMILY — Tier 2, structural mutations (low risk)
  // ================================================================
  {
    name: 'create_task',
    description: 'Create a task for a contact. Use this for follow-up tasks, reminders, or action items.',
    family: 'organize',
    riskLevel: 'medium',
    riskTier: 2 as RiskTier,
    changedEntities: ['contactTask'],
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Task title' },
        contactId: { type: 'string', description: 'Contact to associate the task with' },
        dueDate: { type: 'string', description: 'Due date in ISO format' },
        priority: { type: 'string', description: 'Task priority', enum: ['LOW', 'MEDIUM', 'HIGH'] },
      },
      required: ['title', 'contactId'],
    },
    outputSchema: {
      type: 'object',
      description: 'Created task',
      fields: {
        id: { type: 'string', description: 'Created task ID' },
        title: { type: 'string', description: 'Task title' },
        contactId: { type: 'string', description: 'Associated contact ID' },
      },
    },
  },
  {
    name: 'create_followup_queue',
    description: 'Bulk-create follow-up tasks for all stale contacts (leads with no activity in N days).',
    family: 'organize',
    riskLevel: 'medium',
    riskTier: 2 as RiskTier,
    changedEntities: ['contactTask'],
    followOnSuggestions: ['fetch_client_health'],
    parameters: {
      type: 'object',
      properties: {
        staleDays: { type: 'number', description: 'Number of days with no activity to consider stale (default 14)' },
        maxContacts: { type: 'number', description: 'Maximum contacts to create tasks for (default 20)' },
        taskTitle: { type: 'string', description: 'Title template for follow-up tasks (default "Follow up with {name}")' },
      },
      required: [],
    },
    outputSchema: {
      type: 'object',
      description: 'Follow-up queue result',
      fields: {
        created: { type: 'number', description: 'Number of tasks created' },
        contacts: { type: 'array', description: 'Contacts queued for follow-up' },
      },
    },
  },
  {
    name: 'tag_contact',
    description: 'Add one or more tags to a contact for segmentation purposes.',
    family: 'organize',
    riskLevel: 'medium',
    riskTier: 2 as RiskTier,
    changedEntities: ['contact'],
    parameters: {
      type: 'object',
      properties: {
        contactId: { type: 'string', description: 'The contact ID to tag' },
        tags: { type: 'array', description: 'Tags to add', items: { type: 'string' } },
      },
      required: ['contactId', 'tags'],
    },
    outputSchema: {
      type: 'object',
      description: 'Tag result',
      fields: {
        contactId: { type: 'string', description: 'Tagged contact ID' },
        tags: { type: 'array', description: 'Updated tags list' },
      },
    },
  },
  {
    name: 'segment_contacts',
    description: 'Filter contacts into a named segment based on status, tag, or spending criteria. Returns matching contacts for the segment.',
    family: 'organize',
    riskLevel: 'medium',
    riskTier: 2 as RiskTier,
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Segment name' },
        criteria: { type: 'string', description: 'Segment criteria description (e.g. "clients who spent over $5000 TTD")' },
        status: { type: 'string', description: 'Filter by contact status', enum: ['LEAD', 'PROSPECT', 'CLIENT', 'INACTIVE'] },
        tag: { type: 'string', description: 'Filter by tag' },
        minSpend: { type: 'number', description: 'Minimum total spend in TTD' },
      },
      required: ['name'],
    },
    outputSchema: {
      type: 'object',
      description: 'Created segment',
      fields: {
        segmentName: { type: 'string', description: 'Segment name' },
        matchedCount: { type: 'number', description: 'Number of matching contacts' },
        contacts: { type: 'array', description: 'Matched contacts (limited to 50)' },
      },
    },
  },
  {
    name: 'schedule_action',
    description: 'Schedule a future action (e.g. send a reminder, create a task, follow up) to execute at a specific time.',
    family: 'organize',
    riskLevel: 'medium',
    riskTier: 2 as RiskTier,
    changedEntities: ['scheduledAction'],
    parameters: {
      type: 'object',
      properties: {
        actionType: { type: 'string', description: 'Type of action to schedule', enum: ['send_reminder', 'create_task', 'follow_up', 'status_change'] },
        scheduledFor: { type: 'string', description: 'When to execute (ISO date)' },
        targetId: { type: 'string', description: 'Target entity ID (contact, invoice, etc.)' },
        payload: { type: 'string', description: 'JSON string of action-specific parameters' },
        description: { type: 'string', description: 'Human-readable description of the scheduled action' },
      },
      required: ['actionType', 'scheduledFor', 'description'],
    },
    outputSchema: {
      type: 'object',
      description: 'Scheduled action',
      fields: {
        id: { type: 'string', description: 'Scheduled action ID' },
        actionType: { type: 'string', description: 'Type of scheduled action' },
        scheduledFor: { type: 'string', description: 'Scheduled execution time' },
      },
    },
  },

  // ================================================================
  //  EXECUTE FAMILY — Tier 3-4, high-impact state changes
  // ================================================================
  {
    name: 'queue_campaign',
    description: 'Queue an existing draft campaign for scheduled sending at a specified time.',
    family: 'execute',
    riskLevel: 'high',
    riskTier: 3 as RiskTier,
    changedEntities: ['emailCampaign'],
    followOnSuggestions: ['marketing_list_campaigns'],
    parameters: {
      type: 'object',
      properties: {
        campaignId: { type: 'string', description: 'The campaign ID to queue' },
        scheduledAt: { type: 'string', description: 'Send time in ISO format' },
      },
      required: ['campaignId', 'scheduledAt'],
    },
    outputSchema: {
      type: 'object',
      description: 'Queued campaign',
      fields: {
        id: { type: 'string', description: 'Campaign ID' },
        name: { type: 'string', description: 'Campaign name' },
        status: { type: 'string', description: 'Updated status (SCHEDULED)' },
        scheduledAt: { type: 'string', description: 'Scheduled send time' },
      },
    },
  },
  {
    name: 'send_message_with_approval',
    description: 'Send a message to a contact (email/WhatsApp). Requires approval for Tier 3+.',
    family: 'execute',
    riskLevel: 'high',
    riskTier: 3 as RiskTier,
    changedEntities: ['contactNote', 'activity'],
    parameters: {
      type: 'object',
      properties: {
        contactId: { type: 'string', description: 'Recipient contact ID' },
        channel: { type: 'string', description: 'Message channel', enum: ['email', 'whatsapp'] },
        subject: { type: 'string', description: 'Message subject (email only)' },
        body: { type: 'string', description: 'Message body content' },
      },
      required: ['contactId', 'channel', 'body'],
    },
    outputSchema: {
      type: 'object',
      description: 'Queued message (pending governance approval)',
      fields: {
        id: { type: 'string', description: 'Activity/message ID' },
        contactName: { type: 'string', description: 'Recipient name' },
        channel: { type: 'string', description: 'Message channel' },
        status: { type: 'string', description: 'queued_for_review' },
      },
    },
  },
  {
    name: 'apply_storefront_recommendation',
    description: 'Apply AI-generated recommendations to storefront products (update descriptions, prices, categories).',
    family: 'execute',
    riskLevel: 'high',
    riskTier: 3 as RiskTier,
    changedEntities: ['product'],
    followOnSuggestions: ['fetch_storefront_quality'],
    parameters: {
      type: 'object',
      properties: {
        productId: { type: 'string', description: 'Product to update' },
        description: { type: 'string', description: 'New product description' },
        price: { type: 'number', description: 'New price (TTD)' },
        category: { type: 'string', description: 'New category' },
      },
      required: ['productId'],
    },
    outputSchema: {
      type: 'object',
      description: 'Updated product',
      fields: {
        id: { type: 'string', description: 'Product ID' },
        name: { type: 'string', description: 'Product name' },
        fieldsUpdated: { type: 'array', description: 'Fields that were updated' },
      },
    },
  },
  {
    name: 'enable_flow_with_approval',
    description: 'Enable an automation flow/playbook. Requires approval as it activates automated actions.',
    family: 'execute',
    riskLevel: 'high',
    riskTier: 4 as RiskTier,
    changedEntities: ['automation'],
    parameters: {
      type: 'object',
      properties: {
        playbookId: { type: 'string', description: 'The automation playbook ID to enable' },
      },
      required: ['playbookId'],
    },
    outputSchema: {
      type: 'object',
      description: 'Enabled automation',
      fields: {
        id: { type: 'string', description: 'Playbook ID' },
        name: { type: 'string', description: 'Playbook name' },
        status: { type: 'string', description: 'Updated status (ACTIVE)' },
      },
    },
  },
  {
    name: 'update_status_with_confirmation',
    description: 'Bulk-update statuses for contacts or invoices. Requires confirmation due to broad impact.',
    family: 'execute',
    riskLevel: 'high',
    riskTier: 3 as RiskTier,
    changedEntities: ['contact', 'invoice'],
    parameters: {
      type: 'object',
      properties: {
        entityType: { type: 'string', description: 'Entity type to update', enum: ['contact', 'invoice'] },
        ids: { type: 'array', description: 'IDs of entities to update', items: { type: 'string' } },
        newStatus: { type: 'string', description: 'New status value' },
      },
      required: ['entityType', 'ids', 'newStatus'],
    },
    outputSchema: {
      type: 'object',
      description: 'Bulk status update result',
      fields: {
        entityType: { type: 'string', description: 'Entity type updated' },
        updatedCount: { type: 'number', description: 'Number of entities updated' },
        newStatus: { type: 'string', description: 'Applied status' },
      },
    },
  },

  // ================================================================
  //  CRUD — CRM (existing tools, tagged with family)
  // ================================================================
  {
    name: 'crm_search_contacts',
    description: 'Search for contacts by name, email, or phone number.',
    family: 'crud',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search term (name, email, or phone)' },
      },
      required: ['query'],
    },
    outputSchema: { type: 'object', description: 'Search results', fields: { contacts: { type: 'array', description: 'Matching contacts' } } },
  },
  {
    name: 'crm_create_contact',
    description: 'Create a new contact in the CRM.',
    family: 'crud',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    changedEntities: ['contact'],
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
    outputSchema: { type: 'object', description: 'Created contact', fields: { contact: { type: 'object', description: 'Contact record' } } },
  },
  {
    name: 'crm_update_contact',
    description: 'Update an existing contact\'s information.',
    family: 'crud',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    changedEntities: ['contact'],
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
    outputSchema: { type: 'object', description: 'Updated contact', fields: { contact: { type: 'object', description: 'Updated contact record' } } },
  },
  {
    name: 'crm_add_note',
    description: 'Add a note to a contact\'s timeline.',
    family: 'crud',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    changedEntities: ['contactNote'],
    parameters: {
      type: 'object',
      properties: {
        contactId: { type: 'string', description: 'The contact ID to add the note to' },
        body: { type: 'string', description: 'The note content' },
      },
      required: ['contactId', 'body'],
    },
    outputSchema: { type: 'object', description: 'Created note', fields: { note: { type: 'object', description: 'Note record' } } },
  },
  {
    name: 'crm_add_task',
    description: 'Add a task for a contact.',
    family: 'crud',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    changedEntities: ['contactTask'],
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
    outputSchema: { type: 'object', description: 'Created task', fields: { task: { type: 'object', description: 'Task record' }, id: { type: 'string', description: 'Task ID' } } },
  },
  {
    name: 'crm_delete_contact',
    description: 'Delete (soft-delete) a contact from the CRM.',
    family: 'crud',
    riskLevel: 'high',
    riskTier: 3 as RiskTier,
    changedEntities: ['contact'],
    parameters: {
      type: 'object',
      properties: {
        contactId: { type: 'string', description: 'The ID of the contact to delete' },
      },
      required: ['contactId'],
    },
    outputSchema: { type: 'object', description: 'Deletion result', fields: { success: { type: 'boolean', description: 'Whether deletion succeeded' } } },
  },
  {
    name: 'crm_list_contacts',
    description: 'List contacts with optional filters.',
    family: 'crud',
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
    outputSchema: { type: 'object', description: 'Contact list', fields: { contacts: { type: 'array', description: 'Contact records' }, total: { type: 'number', description: 'Total count' } } },
  },

  // ================================================================
  //  CRUD — COMMERCE (existing tools, tagged with family)
  // ================================================================
  {
    name: 'commerce_create_invoice',
    description: 'Create a new invoice for a contact.',
    family: 'crud',
    riskLevel: 'medium',
    riskTier: 2 as RiskTier,
    changedEntities: ['invoice'],
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
    outputSchema: { type: 'object', description: 'Created invoice', fields: { invoiceNumber: { type: 'string', description: 'Invoice number' }, id: { type: 'string', description: 'Invoice ID' } } },
  },
  {
    name: 'commerce_list_invoices',
    description: 'List invoices with optional status filter.',
    family: 'crud',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Maximum number of invoices to return (default 10)' },
      },
      required: [],
    },
    outputSchema: { type: 'object', description: 'Invoice list', fields: { invoices: { type: 'array', description: 'Invoice records' } } },
  },
  {
    name: 'commerce_mark_invoice_paid',
    description: 'Mark an invoice as paid.',
    family: 'crud',
    riskLevel: 'medium',
    riskTier: 2 as RiskTier,
    changedEntities: ['invoice'],
    parameters: {
      type: 'object',
      properties: {
        invoiceId: { type: 'string', description: 'The invoice ID to mark as paid' },
      },
      required: ['invoiceId'],
    },
    outputSchema: { type: 'object', description: 'Updated invoice', fields: { invoice: { type: 'object', description: 'Updated invoice record' } } },
  },
  {
    name: 'commerce_create_product',
    description: 'Create a new product or service in the catalog.',
    family: 'crud',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    changedEntities: ['product'],
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
    outputSchema: { type: 'object', description: 'Created product', fields: { product: { type: 'object', description: 'Product record' } } },
  },
  {
    name: 'commerce_create_quote',
    description: 'Create a quote for a contact.',
    family: 'crud',
    riskLevel: 'medium',
    riskTier: 2 as RiskTier,
    changedEntities: ['quote'],
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
    outputSchema: { type: 'object', description: 'Created quote', fields: { quote: { type: 'object', description: 'Quote record' } } },
  },
  {
    name: 'commerce_delete_invoice',
    description: 'Delete an invoice.',
    family: 'crud',
    riskLevel: 'high',
    riskTier: 3 as RiskTier,
    changedEntities: ['invoice'],
    parameters: {
      type: 'object',
      properties: {
        invoiceId: { type: 'string', description: 'The invoice ID to delete' },
      },
      required: ['invoiceId'],
    },
    outputSchema: { type: 'object', description: 'Deletion result', fields: { success: { type: 'boolean', description: 'Whether deletion succeeded' } } },
  },

  // ================================================================
  //  CRUD — BOOKINGS (existing tools, tagged with family)
  // ================================================================
  {
    name: 'bookings_create_booking',
    description: 'Create a new booking/appointment for a contact.',
    family: 'crud',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    changedEntities: ['booking'],
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
    outputSchema: { type: 'object', description: 'Created booking', fields: { id: { type: 'string', description: 'Booking ID' }, startTime: { type: 'string', description: 'Booking start time' } } },
  },
  {
    name: 'bookings_list_bookings',
    description: 'List upcoming bookings.',
    family: 'crud',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Maximum number of bookings to return (default 10)' },
      },
      required: [],
    },
    outputSchema: { type: 'object', description: 'Booking list', fields: { bookings: { type: 'array', description: 'Booking records' } } },
  },
  {
    name: 'bookings_reschedule_booking',
    description: 'Reschedule an existing booking to a new time.',
    family: 'crud',
    riskLevel: 'medium',
    riskTier: 2 as RiskTier,
    changedEntities: ['booking'],
    parameters: {
      type: 'object',
      properties: {
        bookingId: { type: 'string', description: 'The booking ID to reschedule' },
        startTime: { type: 'string', description: 'New start time in ISO format' },
      },
      required: ['bookingId', 'startTime'],
    },
    outputSchema: { type: 'object', description: 'Rescheduled booking', fields: { booking: { type: 'object', description: 'Updated booking record' } } },
  },
  {
    name: 'bookings_cancel_booking',
    description: 'Cancel an existing booking.',
    family: 'crud',
    riskLevel: 'high',
    riskTier: 3 as RiskTier,
    changedEntities: ['booking'],
    parameters: {
      type: 'object',
      properties: {
        bookingId: { type: 'string', description: 'The booking ID to cancel' },
      },
      required: ['bookingId'],
    },
    outputSchema: { type: 'object', description: 'Cancellation result', fields: { success: { type: 'boolean', description: 'Whether cancellation succeeded' } } },
  },
  {
    name: 'bookings_list_services',
    description: 'List all available services for booking.',
    family: 'crud',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
    outputSchema: { type: 'object', description: 'Service list', fields: { services: { type: 'array', description: 'Available services' } } },
  },

  // ================================================================
  //  CRUD — MARKETING (existing tools, tagged with family)
  // ================================================================
  {
    name: 'marketing_create_campaign',
    description: 'Create a new email marketing campaign (draft).',
    family: 'crud',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    changedEntities: ['emailCampaign'],
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
    outputSchema: { type: 'object', description: 'Created campaign', fields: { campaign: { type: 'object', description: 'Campaign record' } } },
  },
  {
    name: 'marketing_send_campaign',
    description: 'Send an existing email campaign to contacts.',
    family: 'execute',
    riskLevel: 'high',
    riskTier: 4 as RiskTier,
    changedEntities: ['emailCampaign'],
    parameters: {
      type: 'object',
      properties: {
        campaignId: { type: 'string', description: 'The campaign ID to send' },
      },
      required: ['campaignId'],
    },
    outputSchema: { type: 'object', description: 'Send result', fields: { success: { type: 'boolean', description: 'Whether send was initiated' } } },
  },
  {
    name: 'marketing_list_campaigns',
    description: 'List email marketing campaigns.',
    family: 'crud',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
    outputSchema: { type: 'object', description: 'Campaign list', fields: { campaigns: { type: 'array', description: 'Campaign records' } } },
  },

  // ================================================================
  //  CRUD — SOCIAL (existing tools, tagged with family)
  // ================================================================
  {
    name: 'social_create_post',
    description: 'Create a new social media post (draft or scheduled).',
    family: 'crud',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    changedEntities: ['socialPost'],
    parameters: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'The post content/caption' },
        scheduledFor: { type: 'string', description: 'Optional schedule date in ISO format' },
      },
      required: ['content'],
    },
    outputSchema: { type: 'object', description: 'Created post', fields: { post: { type: 'object', description: 'Post record' } } },
  },
  {
    name: 'social_publish_post',
    description: 'Publish a social media post immediately.',
    family: 'execute',
    riskLevel: 'high',
    riskTier: 4 as RiskTier,
    changedEntities: ['socialPost'],
    parameters: {
      type: 'object',
      properties: {
        postId: { type: 'string', description: 'The post ID to publish' },
      },
      required: ['postId'],
    },
    outputSchema: { type: 'object', description: 'Publish result', fields: { success: { type: 'boolean', description: 'Whether post was published' } } },
  },
  {
    name: 'social_list_posts',
    description: 'List social media posts.',
    family: 'crud',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
    outputSchema: { type: 'object', description: 'Post list', fields: { posts: { type: 'array', description: 'Post records' } } },
  },

  // ================================================================
  //  CRUD — AUTOMATIONS (existing tools, tagged with family)
  // ================================================================
  {
    name: 'automations_create_playbook',
    description: 'Create a new automation playbook.',
    family: 'crud',
    riskLevel: 'medium',
    riskTier: 2 as RiskTier,
    changedEntities: ['automation'],
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Playbook name' },
        triggerEvent: { type: 'string', description: 'The event that triggers this automation (e.g. contact_created, invoice_paid)' },
        condition: { type: 'string', description: 'Optional condition for when to run' },
      },
      required: ['name', 'triggerEvent'],
    },
    outputSchema: { type: 'object', description: 'Created playbook', fields: { playbook: { type: 'object', description: 'Playbook record' } } },
  },
  {
    name: 'automations_list_playbooks',
    description: 'List automation playbooks.',
    family: 'crud',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
    outputSchema: { type: 'object', description: 'Playbook list', fields: { playbooks: { type: 'array', description: 'Playbook records' } } },
  },
  {
    name: 'automations_toggle_playbook',
    description: 'Enable or disable an automation playbook.',
    family: 'crud',
    riskLevel: 'medium',
    riskTier: 2 as RiskTier,
    changedEntities: ['automation'],
    parameters: {
      type: 'object',
      properties: {
        playbookId: { type: 'string', description: 'The playbook ID to toggle' },
        enabled: { type: 'boolean', description: 'Whether to enable (true) or disable (false) the playbook' },
      },
      required: ['playbookId', 'enabled'],
    },
    outputSchema: { type: 'object', description: 'Toggle result', fields: { playbook: { type: 'object', description: 'Updated playbook' }, enabled: { type: 'boolean', description: 'New enabled state' } } },
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

export function getToolsByFamily(family: ToolFamily): FlowTool[] {
  return FLOW_TOOLS.filter((t) => t.family === family);
}

export function getToolFamilies(): Record<ToolFamily, FlowTool[]> {
  return {
    read: getToolsByFamily('read'),
    draft: getToolsByFamily('draft'),
    organize: getToolsByFamily('organize'),
    execute: getToolsByFamily('execute'),
    crud: getToolsByFamily('crud'),
  };
}

export function getToolCount(): { total: number; byFamily: Record<ToolFamily, number> } {
  const families = getToolFamilies();
  return {
    total: FLOW_TOOLS.length,
    byFamily: {
      read: families.read.length,
      draft: families.draft.length,
      organize: families.organize.length,
      execute: families.execute.length,
      crud: families.crud.length,
    },
  };
}
