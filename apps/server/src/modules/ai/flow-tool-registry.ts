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
  /**
   * Path to the in-app screen where a human can perform the equivalent
   * action manually (no AI required). Required on every registered tool —
   * KEY surfaces this as a "Do it yourself" link so the AI is never the
   * only way to take an action. The CI check at
   * `apps/web/scripts/check-tool-routes.ts` enforces this; the runtime
   * helper `getManualEquivalentRoute(tool)` falls back to a family default
   * for forward-compat only.
   */
  manualEquivalentRoute: string;
}

const FAMILY_FALLBACK_ROUTE: Record<ToolFamily, string> = {
  read: '/app/keyflow-command',
  draft: '/app/marketing',
  organize: '/app/keyflow-command',
  execute: '/app/automations',
  crud: '/app/crm/contacts',
};

/**
 * Resolve the manual-equivalent route for any tool, even legacy ones added
 * before the field was required. Prefer the explicit field; otherwise infer
 * a sensible default from the tool family.
 */
export function getManualEquivalentRoute(tool: FlowTool): string {
  return tool.manualEquivalentRoute || FAMILY_FALLBACK_ROUTE[tool.family] || '/app/keyflow-command';
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
    manualEquivalentRoute: '/app/keyflow-command',
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
    manualEquivalentRoute: '/app/crm/contacts',
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
    manualEquivalentRoute: '/app/bookings',
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
    manualEquivalentRoute: '/app/commerce',
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
    manualEquivalentRoute: '/app/store',
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
    manualEquivalentRoute: '/app/projects',
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
    manualEquivalentRoute: '/app/expenses',
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
    manualEquivalentRoute: '/app/marketing',
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
    manualEquivalentRoute: '/app/marketing',
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
    manualEquivalentRoute: '/app/commerce',
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
    manualEquivalentRoute: '/app/store',
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
    manualEquivalentRoute: '/app/projects',
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
    manualEquivalentRoute: '/app/projects',
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
    manualEquivalentRoute: '/app/automations',
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
    manualEquivalentRoute: '/app/crm/contacts',
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
    manualEquivalentRoute: '/app/crm/contacts',
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

  // ================================================================
  //  EXECUTE FAMILY — Tier 3-4, high-impact state changes
  // ================================================================
  {
    name: 'queue_campaign',
    description: 'Queue an existing draft campaign for scheduled sending at a specified time.',
    family: 'execute',
    riskLevel: 'high',
    riskTier: 3 as RiskTier,
    manualEquivalentRoute: '/app/marketing',
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
    manualEquivalentRoute: '/app/marketing',
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
    manualEquivalentRoute: '/app/store',
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
    manualEquivalentRoute: '/app/automations',
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
    manualEquivalentRoute: '/app/crm/contacts',
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
    manualEquivalentRoute: '/app/crm/contacts',
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
    manualEquivalentRoute: '/app/crm/contacts',
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
    manualEquivalentRoute: '/app/crm/contacts',
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
    manualEquivalentRoute: '/app/crm/contacts',
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
    manualEquivalentRoute: '/app/crm/contacts',
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
    manualEquivalentRoute: '/app/crm/contacts',
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
    manualEquivalentRoute: '/app/crm/contacts',
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
  //  DEALS / PIPELINE
  // ================================================================
  //
  // The largest gap in the product until 2026-08-06: a full pipeline with
  // forecasting, health scoring and velocity services, a writable 356-line
  // screen, an entry in the main nav — and zero tools. A user worked their
  // pipeline daily and KEY could not see a single deal.
  //
  // Stage moves need a stageId, so deals_list_stages is not optional garnish:
  // without it the model cannot name a destination and every move fails.
  {
    name: 'deals_list',
    description: 'List and filter sales deals — by status, stage, owner, value range, expected close date or free text. Use this to see the pipeline, find deals closing soon, or spot the biggest open opportunities.',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/crm/deals',
    parameters: {
      type: 'object',
      properties: {
        // 'ALL' is accepted by CrmDealsService.listDeals alongside the three
        // DealStatus values; advertising it avoids the model inventing a filter.
        status: { type: 'string', description: 'Deal status filter', enum: ['OPEN', 'WON', 'LOST', 'ALL'] },
        stageIds: { type: 'array', description: 'Restrict to these pipeline stage ids', items: { type: 'string' } },
        contactId: { type: 'string', description: 'Only deals for this contact' },
        search: { type: 'string', description: 'Free text over title, company, description and notes' },
        minValue: { type: 'number', description: 'Minimum deal value' },
        maxValue: { type: 'number', description: 'Maximum deal value' },
        expectedCloseFrom: { type: 'string', description: 'Earliest expected close date (ISO)' },
        expectedCloseTo: { type: 'string', description: 'Latest expected close date (ISO)' },
        limit: { type: 'number', description: 'Maximum deals to return (default 50, max 200)' },
      },
      required: [],
    },
    outputSchema: { type: 'object', description: 'Deal list', fields: { deals: { type: 'array', description: 'Deal records with stage and contact' }, total: { type: 'number', description: 'Total matching' } } },
  },
  {
    name: 'deals_get',
    description: 'Get one deal in full, including its stage and the contact it belongs to.',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/crm/deals',
    parameters: {
      type: 'object',
      properties: { dealId: { type: 'string', description: 'Deal id' } },
      required: ['dealId'],
    },
    outputSchema: { type: 'object', description: 'Deal detail', fields: { deal: { type: 'object', description: 'Deal record' } } },
  },
  {
    name: 'deals_list_stages',
    description: 'List the pipeline stages for this business, in order, with their category (OPEN, WON or LOST). Call this before moving a deal so you have a real stage id.',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/crm/deals',
    parameters: { type: 'object', properties: {}, required: [] },
    outputSchema: { type: 'object', description: 'Pipeline stages', fields: { stages: { type: 'array', description: 'Stage records in position order' } } },
  },
  {
    name: 'deals_forecast',
    description: 'Weighted pipeline forecast — expected revenue over a window, based on deal value and stage win rates. Use this to answer "what is likely to close" rather than "what is open".',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/crm/deals',
    parameters: {
      type: 'object',
      properties: {
        windowDays: { type: 'number', description: 'Forecast horizon in days (default 90)' },
      },
      required: [],
    },
    outputSchema: { type: 'object', description: 'Forecast report', fields: { forecast: { type: 'object', description: 'Weighted pipeline projection' } } },
  },
  {
    name: 'deals_pipeline_velocity',
    description: 'How fast deals move — average time in each stage, and where deals are stalling. Use this to explain why the pipeline is slow, not just how big it is.',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/crm/deals',
    parameters: { type: 'object', properties: {}, required: [] },
    outputSchema: { type: 'object', description: 'Velocity report', fields: { report: { type: 'object', description: 'Stage timings and bottlenecks' } } },
  },
  {
    name: 'deals_create',
    description: 'Create a new deal against a contact. If no stage is given the first open stage is used.',
    family: 'crud',
    riskLevel: 'medium',
    riskTier: 2 as RiskTier,
    manualEquivalentRoute: '/app/crm/deals',
    changedEntities: ['deal'],
    parameters: {
      type: 'object',
      properties: {
        contactId: { type: 'string', description: 'Contact this deal belongs to' },
        title: { type: 'string', description: 'Deal title' },
        value: { type: 'number', description: 'Deal value' },
        currency: { type: 'string', description: 'Currency code (defaults to the business currency)' },
        stageId: { type: 'string', description: 'Pipeline stage id — omit to use the first open stage' },
        expectedCloseAt: { type: 'string', description: 'Expected close date (ISO)' },
        probability: { type: 'number', description: 'Win probability, 0-100' },
        description: { type: 'string', description: 'What the deal is for' },
        source: { type: 'string', description: 'Where the opportunity came from' },
        notes: { type: 'string', description: 'Internal notes' },
      },
      required: ['contactId', 'title'],
    },
    outputSchema: { type: 'object', description: 'Created deal', fields: { deal: { type: 'object', description: 'Deal record' } } },
  },
  {
    name: 'deals_update',
    description: 'Update a deal — value, title, expected close date, probability, owner or notes. To change the stage use deals_move_stage; to close it use deals_mark_won or deals_mark_lost.',
    family: 'crud',
    riskLevel: 'medium',
    riskTier: 2 as RiskTier,
    manualEquivalentRoute: '/app/crm/deals',
    changedEntities: ['deal'],
    parameters: {
      type: 'object',
      properties: {
        dealId: { type: 'string', description: 'Deal id' },
        title: { type: 'string', description: 'New title' },
        value: { type: 'number', description: 'New value' },
        expectedCloseAt: { type: 'string', description: 'New expected close date (ISO)' },
        probability: { type: 'number', description: 'Win probability, 0-100' },
        description: { type: 'string', description: 'New description' },
        notes: { type: 'string', description: 'New notes' },
      },
      required: ['dealId'],
    },
    outputSchema: { type: 'object', description: 'Updated deal', fields: { deal: { type: 'object', description: 'Deal record' } } },
  },
  {
    name: 'deals_move_stage',
    description: 'Move a deal to a different pipeline stage. Call deals_list_stages first to get a valid stage id. Moving into a WON or LOST stage closes the deal.',
    family: 'organize',
    riskLevel: 'medium',
    riskTier: 2 as RiskTier,
    manualEquivalentRoute: '/app/crm/deals',
    changedEntities: ['deal'],
    parameters: {
      type: 'object',
      properties: {
        dealId: { type: 'string', description: 'Deal id' },
        stageId: { type: 'string', description: 'Destination stage id from deals_list_stages' },
      },
      required: ['dealId', 'stageId'],
    },
    outputSchema: { type: 'object', description: 'Moved deal', fields: { deal: { type: 'object', description: 'Deal record with its new stage' } } },
  },
  {
    name: 'deals_mark_won',
    description: 'Mark a deal as won. Records the close date and the actual value. This is a real revenue event — confirm the amount before calling it.',
    family: 'execute',
    riskLevel: 'medium',
    riskTier: 2 as RiskTier,
    manualEquivalentRoute: '/app/crm/deals',
    changedEntities: ['deal'],
    parameters: {
      type: 'object',
      properties: {
        dealId: { type: 'string', description: 'Deal id' },
        actualValue: { type: 'number', description: 'Value actually closed, if it differs from the deal value' },
        reasonNotes: { type: 'string', description: 'Why it was won' },
      },
      required: ['dealId'],
    },
    outputSchema: { type: 'object', description: 'Won deal', fields: { deal: { type: 'object', description: 'Deal record' } } },
  },
  {
    name: 'deals_mark_lost',
    description: 'Mark a deal as lost, with the reason. Losing a deal is how the pipeline stays honest — record it rather than leaving it open.',
    family: 'execute',
    riskLevel: 'medium',
    riskTier: 2 as RiskTier,
    manualEquivalentRoute: '/app/crm/deals',
    changedEntities: ['deal'],
    parameters: {
      type: 'object',
      properties: {
        dealId: { type: 'string', description: 'Deal id' },
        lossReason: { type: 'string', description: 'Why the deal was lost' },
        reasonNotes: { type: 'string', description: 'Additional context' },
      },
      required: ['dealId'],
    },
    outputSchema: { type: 'object', description: 'Lost deal', fields: { deal: { type: 'object', description: 'Deal record' } } },
  },
  {
    name: 'deals_delete',
    description: 'Soft-delete a deal. Prefer deals_mark_lost — a lost deal is pipeline history worth keeping, a deleted one is not.',
    family: 'crud',
    riskLevel: 'high',
    riskTier: 3 as RiskTier,
    manualEquivalentRoute: '/app/crm/deals',
    changedEntities: ['deal'],
    parameters: {
      type: 'object',
      properties: { dealId: { type: 'string', description: 'Deal id' } },
      required: ['dealId'],
    },
    outputSchema: { type: 'object', description: 'Deletion result', fields: { success: { type: 'boolean', description: 'Whether the deal was deleted' } } },
  },

  // ================================================================
  //  INVENTORY & STOCK
  // ================================================================
  //
  // Ten models, ~19 continental-ops service methods, a full REST surface and a
  // 2,032-line command centre — and until 2026-08-07, zero tools and no nav
  // entry. The screen was a tab inside a dormant-flagged marketplace page,
  // behind a redirect to a commerce tab that did not exist, so nobody could
  // open it either.
  //
  // inventory_list_warehouses is the same shape of prerequisite as
  // deals_list_stages: a transfer needs two warehouse IDs, and without the
  // lookup the model invents them.
  {
    name: 'inventory_list_stock',
    description: 'List stock on hand — quantity per product per warehouse. Use this to answer "how many do we have" and "where is it".',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/inventory',
    parameters: {
      type: 'object',
      properties: {
        warehouseId: { type: 'string', description: 'Restrict to one warehouse' },
      },
      required: [],
    },
    outputSchema: { type: 'object', description: 'Stock levels', fields: { inventory: { type: 'array', description: 'Stock records with product and warehouse' } } },
  },
  {
    name: 'inventory_summary',
    description: 'Total stock value, unit counts and warehouse breakdown. The whole-inventory picture rather than a per-product one.',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/inventory',
    parameters: { type: 'object', properties: {}, required: [] },
    outputSchema: { type: 'object', description: 'Inventory summary', fields: { summary: { type: 'object', description: 'Totals and per-warehouse breakdown' } } },
  },
  {
    name: 'inventory_low_stock_alerts',
    description: 'Products at or below their reorder point, and what is at risk of going out of stock. Use this to decide what to buy.',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/inventory',
    parameters: { type: 'object', properties: {}, required: [] },
    outputSchema: { type: 'object', description: 'Stock alerts', fields: { alerts: { type: 'array', description: 'Products below reorder point' } } },
  },
  {
    name: 'inventory_list_movements',
    description: 'Recent stock movements — every adjustment, transfer and receipt with its reason code and note. This is the audit trail for "why did the count change".',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/inventory',
    parameters: {
      type: 'object',
      properties: { limit: { type: 'number', description: 'How many movements to return (default 100)' } },
      required: [],
    },
    outputSchema: { type: 'object', description: 'Movement history', fields: { movements: { type: 'array', description: 'Stock movement records' } } },
  },
  {
    name: 'inventory_list_warehouses',
    description: 'List active warehouses with their stock. Call this before a transfer so you have real warehouse ids.',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/inventory',
    parameters: { type: 'object', properties: {}, required: [] },
    outputSchema: { type: 'object', description: 'Warehouses', fields: { warehouses: { type: 'array', description: 'Warehouse records' } } },
  },
  {
    name: 'inventory_adjust_stock',
    description: 'Change the quantity of one stock record, with a reason. Positive adds, negative removes. Writes a StockMovement so the change is auditable — never adjust to "correct" a number without knowing why it moved.',
    family: 'organize',
    riskLevel: 'medium',
    riskTier: 2 as RiskTier,
    manualEquivalentRoute: '/app/inventory',
    changedEntities: ['inventoryStock', 'stockMovement'],
    parameters: {
      type: 'object',
      properties: {
        stockId: { type: 'string', description: 'Stock record id from inventory_list_stock' },
        quantityChange: { type: 'number', description: 'Signed change — positive adds, negative removes' },
        // Matches the six options the human form offers
        // (inventory-command-center.tsx:1861-1868). A seventh value here would
        // let KEY file a reason no person could pick.
        reasonCode: {
          type: 'string',
          description: 'Why the quantity changed',
          enum: ['COUNT_CORRECTION', 'DAMAGE', 'RETURN', 'THEFT_LOSS', 'MANUAL', 'INITIAL_COUNT'],
        },
        note: { type: 'string', description: 'Context for the adjustment. REQUIRED when reasonCode is MANUAL — the server rejects a manual adjustment without one.' },
      },
      required: ['stockId', 'quantityChange', 'reasonCode'],
    },
    outputSchema: { type: 'object', description: 'Adjusted stock', fields: { stock: { type: 'object', description: 'Updated stock record' } } },
  },
  {
    name: 'inventory_transfer_stock',
    description: 'Move stock of one product between two warehouses. Call inventory_list_warehouses first for the ids.',
    family: 'organize',
    riskLevel: 'medium',
    riskTier: 2 as RiskTier,
    manualEquivalentRoute: '/app/inventory',
    changedEntities: ['inventoryStock', 'stockMovement'],
    parameters: {
      type: 'object',
      properties: {
        productId: { type: 'string', description: 'Product to move' },
        fromWarehouseId: { type: 'string', description: 'Source warehouse id' },
        toWarehouseId: { type: 'string', description: 'Destination warehouse id — must differ from the source' },
        quantity: { type: 'number', description: 'Units to move; must be positive' },
        note: { type: 'string', description: 'Why the stock is moving' },
      },
      required: ['productId', 'fromWarehouseId', 'toWarehouseId', 'quantity'],
    },
    outputSchema: { type: 'object', description: 'Transfer result', fields: { transfer: { type: 'object', description: 'Updated source and destination stock' } } },
  },
  {
    name: 'inventory_list_purchase_orders',
    description: 'List purchase orders raised with suppliers, optionally by status. Use this to see what stock is on its way.',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/inventory',
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Filter by status', enum: ['DRAFT', 'SUBMITTED', 'ACKNOWLEDGED', 'SHIPPED', 'RECEIVED'] },
        limit: { type: 'number', description: 'Maximum to return (default 50)' },
      },
      required: [],
    },
    outputSchema: { type: 'object', description: 'Purchase orders', fields: { purchaseOrders: { type: 'array', description: 'PO records' }, total: { type: 'number', description: 'Total count' } } },
  },
  {
    name: 'inventory_create_purchase_order',
    description: 'Raise a purchase order with a supplier. Totals are computed from the line items.',
    family: 'crud',
    riskLevel: 'medium',
    riskTier: 2 as RiskTier,
    manualEquivalentRoute: '/app/inventory',
    changedEntities: ['purchaseOrder'],
    parameters: {
      type: 'object',
      properties: {
        supplierName: { type: 'string', description: 'Supplier name' },
        supplierEmail: { type: 'string', description: 'Supplier email' },
        items: {
          type: 'array',
          // The registry's parameter type allows only a scalar `items` shape,
          // so the line structure is described rather than schema'd. Totals are
          // computed server-side from quantity * unitPrice, so a line missing
          // unitPrice silently contributes zero — say so here rather than let
          // the model guess.
          description: 'Line items. Each is an object with { name, quantity, unitPrice } and optionally productId. unitPrice is required for the line to contribute to the order total.',
          items: { type: 'object' },
        },
        currency: { type: 'string', description: 'Currency code' },
        expectedDelivery: { type: 'string', description: 'Expected delivery date (ISO)' },
        notes: { type: 'string', description: 'Notes for the supplier' },
      },
      required: ['supplierName', 'items'],
    },
    outputSchema: { type: 'object', description: 'Created purchase order', fields: { purchaseOrder: { type: 'object', description: 'PO record with computed totals' } } },
  },
  {
    name: 'inventory_advance_purchase_order',
    description: 'Move a purchase order to its next state. RECEIVED is the one that matters — it is what brings the stock onto the books.',
    family: 'execute',
    riskLevel: 'medium',
    riskTier: 2 as RiskTier,
    manualEquivalentRoute: '/app/inventory',
    changedEntities: ['purchaseOrder', 'inventoryStock'],
    parameters: {
      type: 'object',
      properties: {
        purchaseOrderId: { type: 'string', description: 'Purchase order id' },
        // Exactly the four the controller accepts
        // (marketplace.controller.ts:306-313). DRAFT is absent deliberately:
        // advancing is forward-only.
        status: { type: 'string', description: 'New status', enum: ['SUBMITTED', 'ACKNOWLEDGED', 'SHIPPED', 'RECEIVED'] },
      },
      required: ['purchaseOrderId', 'status'],
    },
    outputSchema: { type: 'object', description: 'Advanced purchase order', fields: { purchaseOrder: { type: 'object', description: 'PO record in its new state' } } },
  },

  // ================================================================
  //  PAYMENTS
  // ================================================================
  //
  // A 792-line operations console over three gateways — transactions, payment
  // links, refunds — with zero tools and no nav entry until 2026-08-07. KEY
  // could raise an invoice and email it, and then had no idea whether the money
  // arrived, no way to send a link, and no way to refund.
  //
  // payments_list_gateways is the prerequisite here and it carries more weight
  // than the equivalents in deals or inventory: it reports not just WHICH
  // gateways exist but whether each one is connected and whether it supports
  // links and refunds at all. Calling a refund on a gateway that does not
  // support them is a BadRequest, not a no-op.
  {
    name: 'payments_list_gateways',
    description: 'List payment gateways, whether each is connected, and what each supports (transactions, payment links, refunds). Call this before creating a link or issuing a refund — gateways differ and an unconnected one will reject the call.',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/payments',
    parameters: { type: 'object', properties: {}, required: [] },
    outputSchema: { type: 'object', description: 'Gateway statuses', fields: { gateways: { type: 'array', description: 'Gateways with connected flag and capability matrix' } } },
  },
  {
    name: 'payments_list_transactions',
    description: 'List charges and refunds across every connected gateway, newest first. Use this to answer "did that payment come in".',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/payments',
    parameters: {
      type: 'object',
      properties: { limit: { type: 'number', description: 'Maximum transactions to return (default 50)' } },
      required: [],
    },
    outputSchema: { type: 'object', description: 'Transactions', fields: { transactions: { type: 'array', description: 'Charges and refunds with amount, customer and invoice link' } } },
  },
  {
    name: 'payments_search_transactions',
    description: 'Find a payment by customer name, email, amount, charge id or invoice id. Use this to locate the charge id a refund needs.',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/payments',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Text to match against customer, amount, charge id or invoice id' },
        limit: { type: 'number', description: 'Maximum to return (default 50)' },
      },
      required: ['query'],
    },
    outputSchema: { type: 'object', description: 'Matching transactions', fields: { transactions: { type: 'array', description: 'Transactions matching the query' } } },
  },
  {
    name: 'payments_list_links',
    description: 'List active payment links across connected gateways.',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/payments',
    parameters: { type: 'object', properties: {}, required: [] },
    outputSchema: { type: 'object', description: 'Payment links', fields: { links: { type: 'array', description: 'Link records with url and amount' } } },
  },
  {
    name: 'payments_create_link',
    description: 'Create a payment link a customer can pay through. This does not move money by itself — it creates a way for someone to send it.',
    family: 'crud',
    riskLevel: 'medium',
    riskTier: 2 as RiskTier,
    manualEquivalentRoute: '/app/payments',
    changedEntities: ['paymentLink'],
    parameters: {
      type: 'object',
      properties: {
        gateway: { type: 'string', description: 'Gateway to create the link on', enum: ['stripe', 'paypal', 'wipay'] },
        amount: { type: 'number', description: 'Amount to charge; must be greater than zero' },
        currency: { type: 'string', description: 'Currency code' },
        description: { type: 'string', description: 'What the payment is for — required, and shown to the customer' },
        customerEmail: { type: 'string', description: 'Send the link to this address' },
      },
      required: ['gateway', 'amount', 'currency', 'description'],
    },
    outputSchema: { type: 'object', description: 'Created link', fields: { link: { type: 'object', description: 'Payment link with its url' } } },
  },
  {
    name: 'payments_revoke_link',
    description: 'Revoke a payment link so it can no longer be paid.',
    family: 'organize',
    riskLevel: 'medium',
    riskTier: 2 as RiskTier,
    manualEquivalentRoute: '/app/payments',
    changedEntities: ['paymentLink'],
    parameters: {
      type: 'object',
      properties: {
        gateway: { type: 'string', description: 'Gateway the link belongs to', enum: ['stripe', 'paypal', 'wipay'] },
        linkId: { type: 'string', description: 'Payment link id from payments_list_links' },
      },
      required: ['gateway', 'linkId'],
    },
    outputSchema: { type: 'object', description: 'Revocation result', fields: { revoked: { type: 'boolean', description: 'Whether the link was revoked' } } },
  },
  {
    name: 'payments_refund_charge',
    description: 'Refund a charge, in full or in part. This sends money OUT of the business and cannot be undone by any other tool — confirm the charge id and the amount with the owner before calling it. Use payments_search_transactions to find the charge first.',
    family: 'execute',
    riskLevel: 'high',
    // Tier 3, the same tier as deleting a deal, and for a stronger reason: this
    // is the only tool in the arsenal that moves money out of the business to a
    // third party. There is no compensating action — a refund cannot be
    // un-refunded, only re-charged, which requires the customer to pay again.
    riskTier: 3 as RiskTier,
    manualEquivalentRoute: '/app/payments',
    changedEntities: ['payment'],
    parameters: {
      type: 'object',
      properties: {
        gateway: { type: 'string', description: 'Gateway holding the charge', enum: ['stripe', 'paypal', 'wipay'] },
        chargeId: { type: 'string', description: 'Charge id to refund, from payments_search_transactions' },
        amount: { type: 'number', description: 'Amount to refund. Omit to refund the charge in full.' },
        reason: { type: 'string', description: 'Why the refund is being issued — recorded against the payment' },
      },
      required: ['gateway', 'chargeId'],
    },
    outputSchema: { type: 'object', description: 'Refund result', fields: { refund: { type: 'object', description: 'Refund record with amount, currency and status' } } },
  },

  // ================================================================
  //  BANK RECONCILIATION
  // ================================================================
  //
  // The matching engine was already built — amount tolerance, date windows,
  // reference scoring, deterministic tie-breaks — and had no tool over it, so
  // KEY could read receivables and not tell you whether the bank agreed.
  //
  // On ingestion, the line is drawn at what actually exists. There is still no
  // bank feed for this market, so no tool claims to pull one. What does exist
  // is a Drive folder and a Gmail search, swept nightly — so KEY can connect a
  // source and run a sweep, and those tools are named for what they do rather
  // than for the bank feed they are not. `reconcile_sweep_statements` fetches
  // from Drive or Gmail; it never implies the bank was contacted.
  {
    name: 'reconcile_list_unmatched',
    description: 'List bank lines that have not been matched to a ledger entry yet, for one account. This is the "what still needs looking at" list after a statement import.',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/finance/reconciliation',
    parameters: {
      type: 'object',
      properties: {
        accountId: { type: 'string', description: 'Financial account id' },
        limit: { type: 'number', description: 'Maximum rows to return (default 50)' },
      },
      required: ['accountId'],
    },
    outputSchema: { type: 'object', description: 'Unmatched bank lines', fields: { transactions: { type: 'array', description: 'Bank rows still unmatched' } } },
  },
  {
    name: 'reconcile_run_auto_match',
    description: 'Run automatic matching for an account: pair imported bank lines against ledger entries by amount, date proximity and reference. Reports how many matched and how many are still open. Safe to run repeatedly.',
    family: 'organize',
    riskLevel: 'medium',
    riskTier: 2 as RiskTier,
    manualEquivalentRoute: '/app/finance/reconciliation',
    changedEntities: ['bankTransaction'],
    parameters: {
      type: 'object',
      properties: {
        accountId: { type: 'string', description: 'Financial account id' },
        sinceDate: { type: 'string', description: 'Only consider bank lines on or after this date (ISO)' },
      },
      required: ['accountId'],
    },
    outputSchema: { type: 'object', description: 'Match result', fields: { matched: { type: 'number', description: 'Lines newly matched' }, remaining: { type: 'number', description: 'Lines still unmatched' } } },
  },
  {
    name: 'reconcile_match_line',
    description: 'Match one specific bank line to one specific ledger transaction, when the automatic pass could not decide. Use reconcile_list_unmatched to get the bank line id first.',
    family: 'organize',
    riskLevel: 'medium',
    riskTier: 2 as RiskTier,
    manualEquivalentRoute: '/app/finance/reconciliation',
    changedEntities: ['bankTransaction'],
    parameters: {
      type: 'object',
      properties: {
        bankTransactionId: { type: 'string', description: 'The bank line, from reconcile_list_unmatched' },
        ledgerTransactionId: { type: 'string', description: 'The ledger entry it corresponds to' },
      },
      required: ['bankTransactionId', 'ledgerTransactionId'],
    },
    outputSchema: { type: 'object', description: 'Matched line', fields: { transaction: { type: 'object', description: 'The bank line, now matched' } } },
  },
  {
    name: 'reconcile_list_statement_sources',
    description: 'Show where each bank account gets its statements from automatically — a Google Drive folder, a Gmail search, or nothing — and when each was last swept. Use this to answer "is this account importing on its own yet?".',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/finance/reconciliation',
    parameters: { type: 'object', properties: {}, required: [] },
    outputSchema: { type: 'object', description: 'Per-account statement sources', fields: { accounts: { type: 'array', description: 'Accounts with their configured source, if any' }, configuredCount: { type: 'number', description: 'How many accounts import automatically' } } },
  },
  {
    name: 'reconcile_connect_statement_source',
    description: 'Point a bank account at a Google Drive folder or a Gmail search so its statements import themselves nightly. The folder id comes from the Drive URL; the Gmail query is ordinary Gmail search syntax such as "from:republicbank.com". Sets one account only — a source belongs to exactly one account, because guessing which account a statement belongs to would post it to the wrong ledger.',
    family: 'execute',
    riskLevel: 'medium',
    riskTier: 2 as RiskTier,
    manualEquivalentRoute: '/app/finance/reconciliation',
    changedEntities: ['financialAccount'],
    parameters: {
      type: 'object',
      properties: {
        accountId: { type: 'string', description: 'Financial account id the statements belong to' },
        driveFolderId: { type: 'string', description: 'Google Drive folder id. Pass an empty string to disconnect it.' },
        gmailQuery: { type: 'string', description: 'Gmail search, e.g. "from:republicbank.com subject:statement". has:attachment and a date bound are added automatically. Empty string disconnects.' },
      },
      required: ['accountId'],
    },
    outputSchema: { type: 'object', description: 'The saved configuration', fields: { driveFolderId: { type: 'string', description: 'Configured Drive folder, if any' }, gmailQuery: { type: 'string', description: 'Configured Gmail search, if any' } } },
  },
  {
    name: 'reconcile_sweep_statements',
    description: 'Fetch and import any new statements waiting in an account\'s configured Drive folder or Gmail search, without waiting for the nightly run. This reads Drive or Gmail — it does not contact the bank. Finding nothing is a normal result, not a failure.',
    family: 'execute',
    riskLevel: 'medium',
    riskTier: 2 as RiskTier,
    manualEquivalentRoute: '/app/finance/reconciliation',
    changedEntities: ['bankTransaction'],
    parameters: {
      type: 'object',
      properties: {
        accountId: { type: 'string', description: 'Financial account id' },
        source: { type: 'string', description: '"drive" or "gmail"' },
      },
      required: ['accountId', 'source'],
    },
    outputSchema: { type: 'object', description: 'Sweep result', fields: { imported: { type: 'number', description: 'Transactions actually inserted' }, filesConsidered: { type: 'number', description: 'Files or attachments looked at' }, skipped: { type: 'number', description: 'Files that were not statements' }, errors: { type: 'array', description: 'Per-file problems, if any' } } },
  },

  // ================================================================
  //  CONTRACTS
  // ================================================================
  //
  // 7 models, a 573-line service with 14 public methods, an 895-line screen
  // with full manual CRUD and AI term extraction, an entry in the main nav —
  // and zero tools until 2026-08-07. Renewal dates are the point of a contract
  // register, and KEY could not read one.
  {
    name: 'contracts_list',
    description: 'List contracts, filtered by status, free text, or how soon they expire. Use expiringWithinDays to answer "what renews soon" — that is what a contract register is for.',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/contracts',
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Contract status', enum: ['DRAFT', 'ACTIVE', 'RENEWAL_DUE', 'EXPIRED', 'TERMINATED', 'ARCHIVED'] },
        search: { type: 'string', description: 'Free text over title and counterparties' },
        expiringWithinDays: { type: 'number', description: 'Only contracts expiring within this many days' },
        limit: { type: 'number', description: 'Maximum to return (default 50, max 200)' },
      },
      required: [],
    },
    outputSchema: { type: 'object', description: 'Contract list', fields: { contracts: { type: 'array', description: 'Contract records' } } },
  },
  {
    name: 'contracts_get',
    description: 'Get one contract in full — parties, extracted terms, versions and alerts.',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/contracts',
    parameters: {
      type: 'object',
      properties: { contractId: { type: 'string', description: 'Contract id' } },
      required: ['contractId'],
    },
    outputSchema: { type: 'object', description: 'Contract detail', fields: { contract: { type: 'object', description: 'Contract record' } } },
  },
  {
    name: 'contracts_stats',
    description: 'Contract portfolio summary — counts by status, total value, and what is coming up for renewal.',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/contracts',
    parameters: { type: 'object', properties: {}, required: [] },
    outputSchema: { type: 'object', description: 'Contract stats', fields: { stats: { type: 'object', description: 'Counts, values and renewal pipeline' } } },
  },
  {
    name: 'contracts_create',
    description: 'Record a contract. Set expiryDate and renewalNoticeDays so the renewal alerts can fire — a contract with no dates is a document, not a register entry.',
    family: 'crud',
    riskLevel: 'medium',
    riskTier: 2 as RiskTier,
    manualEquivalentRoute: '/app/contracts',
    changedEntities: ['contract'],
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Contract title' },
        contractType: { type: 'string', description: 'Kind of agreement', enum: ['SERVICE_AGREEMENT', 'NDA', 'EMPLOYMENT', 'VENDOR', 'LEASE', 'LICENSE', 'RENTAL', 'SUBSCRIPTION', 'PARTNERSHIP', 'OTHER'] },
        status: { type: 'string', description: 'Initial status (defaults to DRAFT)', enum: ['DRAFT', 'ACTIVE', 'RENEWAL_DUE', 'EXPIRED', 'TERMINATED', 'ARCHIVED'] },
        effectiveDate: { type: 'string', description: 'When it starts (ISO)' },
        expiryDate: { type: 'string', description: 'When it ends (ISO)' },
        renewalDate: { type: 'string', description: 'When it renews (ISO)' },
        renewalNoticeDays: { type: 'number', description: 'Days of notice required before renewal' },
        contractValue: { type: 'number', description: 'Total contract value' },
        currency: { type: 'string', description: 'Currency code' },
        jurisdiction: { type: 'string', description: 'Governing jurisdiction' },
        notes: { type: 'string', description: 'Internal notes' },
      },
      required: ['title'],
    },
    outputSchema: { type: 'object', description: 'Created contract', fields: { contract: { type: 'object', description: 'Contract record' } } },
  },
  {
    name: 'contracts_update',
    description: 'Update a contract — status, dates, value or notes.',
    family: 'crud',
    riskLevel: 'medium',
    riskTier: 2 as RiskTier,
    manualEquivalentRoute: '/app/contracts',
    changedEntities: ['contract'],
    parameters: {
      type: 'object',
      properties: {
        contractId: { type: 'string', description: 'Contract id' },
        title: { type: 'string', description: 'New title' },
        status: { type: 'string', description: 'New status', enum: ['DRAFT', 'ACTIVE', 'RENEWAL_DUE', 'EXPIRED', 'TERMINATED', 'ARCHIVED'] },
        expiryDate: { type: 'string', description: 'New expiry date (ISO)' },
        renewalDate: { type: 'string', description: 'New renewal date (ISO)' },
        renewalNoticeDays: { type: 'number', description: 'Days of notice before renewal' },
        contractValue: { type: 'number', description: 'New value' },
        notes: { type: 'string', description: 'New notes' },
      },
      required: ['contractId'],
    },
    outputSchema: { type: 'object', description: 'Updated contract', fields: { contract: { type: 'object', description: 'Contract record' } } },
  },
  {
    name: 'contracts_acknowledge_alert',
    description: 'Acknowledge a contract renewal or expiry alert, so it stops being outstanding.',
    family: 'organize',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/contracts',
    changedEntities: ['contractAlert'],
    parameters: {
      type: 'object',
      properties: { alertId: { type: 'string', description: 'Alert id from contracts_get' } },
      required: ['alertId'],
    },
    outputSchema: { type: 'object', description: 'Acknowledged alert', fields: { alert: { type: 'object', description: 'Alert record' } } },
  },
  {
    name: 'contracts_delete',
    description: 'Delete a contract. Prefer contracts_update to TERMINATED or ARCHIVED — a contract that existed is a fact about the business, and the register is evidence.',
    family: 'crud',
    riskLevel: 'high',
    riskTier: 3 as RiskTier,
    manualEquivalentRoute: '/app/contracts',
    changedEntities: ['contract'],
    parameters: {
      type: 'object',
      properties: { contractId: { type: 'string', description: 'Contract id' } },
      required: ['contractId'],
    },
    outputSchema: { type: 'object', description: 'Deletion result', fields: { success: { type: 'boolean', description: 'Whether it was deleted' } } },
  },

  // ================================================================
  //  REPORTS
  // ================================================================
  {
    name: 'reports_generate',
    description: 'Generate a business report over a date range — executive summary, P&L, revenue, expenses or client portfolio. Returns the computed figures together with a written analysis.',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/reports',
    parameters: {
      type: 'object',
      properties: {
        // Exactly the five the service branches on (reports.service.ts:244-248).
        // A sixth would produce a report with no written analysis at all.
        type: { type: 'string', description: 'Report type', enum: ['executive', 'pnl', 'revenue', 'expenses', 'clients'] },
        startDate: { type: 'string', description: 'Period start (ISO). Defaults to the start of this month.' },
        endDate: { type: 'string', description: 'Period end (ISO). Defaults to today.' },
        compare: { type: 'boolean', description: 'Include comparison against the preceding period' },
      },
      required: ['type'],
    },
    outputSchema: { type: 'object', description: 'Report', fields: { report: { type: 'object', description: 'Figures and written analysis' } } },
  },

  // ================================================================
  //  GOALS
  // ================================================================
  //
  // executePlan is deliberately NOT exposed. It accepts skipApproval, so a tool
  // over it would let KEY run arbitrary plan steps with governance turned off —
  // a self-escalation surface, not a capability. Plans are proposed here and
  // executed by a human from /app/goals.
  {
    name: 'goals_list',
    description: 'List business goals, optionally by status.',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/goals',
    parameters: {
      type: 'object',
      properties: { status: { type: 'string', description: 'Filter by status, e.g. ACTIVE' } },
      required: [],
    },
    outputSchema: { type: 'object', description: 'Goals', fields: { goals: { type: 'array', description: 'Goal records by priority' } } },
  },
  {
    name: 'goals_get',
    description: 'Get one goal with the plans that have been built from it.',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/goals',
    parameters: {
      type: 'object',
      properties: { goalId: { type: 'string', description: 'Goal id' } },
      required: ['goalId'],
    },
    outputSchema: { type: 'object', description: 'Goal detail', fields: { goal: { type: 'object', description: 'Goal with its plans' } } },
  },
  {
    name: 'goals_create',
    description: 'Set a business goal. Give it a target date and a priority so it can be ranked against the others.',
    family: 'crud',
    riskLevel: 'medium',
    riskTier: 2 as RiskTier,
    manualEquivalentRoute: '/app/goals',
    changedEntities: ['aiGoal'],
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'What the goal is' },
        description: { type: 'string', description: 'Detail and success criteria' },
        priority: { type: 'number', description: 'Higher sorts first' },
        targetDate: { type: 'string', description: 'When it should be achieved (ISO)' },
      },
      required: ['title'],
    },
    outputSchema: { type: 'object', description: 'Created goal', fields: { goal: { type: 'object', description: 'Goal record' } } },
  },
  {
    name: 'goals_create_plan',
    description: 'Decompose a goal into a concrete plan of steps. This PROPOSES the plan — it does not run it. Executing a plan stays with a human on the goals screen.',
    family: 'organize',
    riskLevel: 'medium',
    riskTier: 2 as RiskTier,
    manualEquivalentRoute: '/app/goals',
    changedEntities: ['aiPlan'],
    parameters: {
      type: 'object',
      properties: { goalId: { type: 'string', description: 'Goal to plan for' } },
      required: ['goalId'],
    },
    outputSchema: { type: 'object', description: 'Created plan', fields: { plan: { type: 'object', description: 'Plan with its steps' } } },
  },
  {
    name: 'goals_delete',
    description: 'Delete a goal and the plans attached to it.',
    family: 'crud',
    riskLevel: 'medium',
    riskTier: 2 as RiskTier,
    manualEquivalentRoute: '/app/goals',
    changedEntities: ['aiGoal'],
    parameters: {
      type: 'object',
      properties: { goalId: { type: 'string', description: 'Goal id' } },
      required: ['goalId'],
    },
    outputSchema: { type: 'object', description: 'Deletion result', fields: { success: { type: 'boolean', description: 'Whether it was deleted' } } },
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
    manualEquivalentRoute: '/app/commerce',
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
    manualEquivalentRoute: '/app/commerce',
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
    manualEquivalentRoute: '/app/commerce',
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
    manualEquivalentRoute: '/app/commerce',
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
    manualEquivalentRoute: '/app/commerce',
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
    manualEquivalentRoute: '/app/commerce',
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
    description: 'Create a new booking/appointment for a contact. Requires confirmation before execution.',
    family: 'crud',
    riskLevel: 'medium',
    riskTier: 2 as RiskTier,
    manualEquivalentRoute: '/app/bookings',
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
    manualEquivalentRoute: '/app/bookings',
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
    manualEquivalentRoute: '/app/bookings',
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
    manualEquivalentRoute: '/app/bookings',
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
    manualEquivalentRoute: '/app/bookings',
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
    manualEquivalentRoute: '/app/marketing',
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
    manualEquivalentRoute: '/app/marketing',
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
    manualEquivalentRoute: '/app/marketing',
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
    manualEquivalentRoute: '/app/marketing',
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
    manualEquivalentRoute: '/app/marketing',
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
    manualEquivalentRoute: '/app/marketing',
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
    manualEquivalentRoute: '/app/automations',
    changedEntities: ['automation'],
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Playbook name' },
        triggerEvent: { type: 'string', description: 'The event that triggers this automation (e.g. contact_created, invoice_paid)' },
        condition: { type: 'string', description: 'Optional condition for when to run' },
        actions: {
          type: 'array',
          description: 'REQUIRED. What the automation does when it fires. Each item is an object with a "type" from add_tag, create_task, send_email, send_email_campaign, send_whatsapp, update_status, plus the fields that action needs. An automation with no actions fires forever and does nothing.',
          items: { type: 'object' },
        },
      },
      required: ['name', 'triggerEvent', 'actions'],
    },
    outputSchema: { type: 'object', description: 'Created playbook', fields: { playbook: { type: 'object', description: 'Playbook record' } } },
  },
  {
    name: 'automations_list_playbooks',
    description: 'List automation playbooks.',
    family: 'crud',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/automations',
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
    manualEquivalentRoute: '/app/automations',
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

  // ================================================================
  //  DELEGATION LOOPS — Autopilot governed delegation engine tools
  // ================================================================
  {
    name: 'delegation_payment_recovery',
    description: 'Scan overdue invoices and create escalating payment recovery tasks with reminders.',
    family: 'execute',
    riskLevel: 'medium',
    riskTier: 2 as RiskTier,
    manualEquivalentRoute: '/app/automations',
    changedEntities: ['autopilotTask', 'invoice'],
    parameters: {
      type: 'object',
      properties: {
        businessId: { type: 'string', description: 'The business ID' },
      },
      required: ['businessId'],
    },
    outputSchema: { type: 'object', description: 'Recovery run result', fields: { itemsMatched: { type: 'number', description: 'Overdue invoices found' }, actionsCreated: { type: 'number', description: 'Recovery tasks created' } } },
  },
  {
    name: 'delegation_lead_reactivation',
    description: 'Identify stale leads and create re-engagement tasks with lifecycle stage updates.',
    family: 'execute',
    riskLevel: 'medium',
    riskTier: 2 as RiskTier,
    manualEquivalentRoute: '/app/automations',
    changedEntities: ['autopilotTask', 'contact'],
    parameters: {
      type: 'object',
      properties: {
        businessId: { type: 'string', description: 'The business ID' },
      },
      required: ['businessId'],
    },
    outputSchema: { type: 'object', description: 'Reactivation run result', fields: { itemsMatched: { type: 'number', description: 'Stale leads found' }, actionsCreated: { type: 'number', description: 'Re-engagement tasks created' } } },
  },
  {
    name: 'delegation_post_purchase',
    description: 'Send thank-you messages, review requests, and cross-sell prompts after purchases.',
    family: 'execute',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/automations',
    changedEntities: ['autopilotTask'],
    parameters: {
      type: 'object',
      properties: {
        businessId: { type: 'string', description: 'The business ID' },
      },
      required: ['businessId'],
    },
    outputSchema: { type: 'object', description: 'Post-purchase run result', fields: { itemsMatched: { type: 'number', description: 'Recent purchases found' }, actionsCreated: { type: 'number', description: 'Follow-up tasks created' } } },
  },
  {
    name: 'delegation_booking_prep',
    description: 'Send preparation reminders before appointments and follow-up messages after completion.',
    family: 'execute',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/automations',
    changedEntities: ['autopilotTask'],
    parameters: {
      type: 'object',
      properties: {
        businessId: { type: 'string', description: 'The business ID' },
      },
      required: ['businessId'],
    },
    outputSchema: { type: 'object', description: 'Booking prep run result', fields: { itemsMatched: { type: 'number', description: 'Bookings needing prep/followup' }, actionsCreated: { type: 'number', description: 'Prep/follow-up tasks created' } } },
  },
  {
    name: 'delegation_weekly_hygiene',
    description: 'Clean up stale data, flag overdue items, incomplete profiles, and automation gaps.',
    family: 'organize',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/automations',
    changedEntities: ['autopilotTask'],
    parameters: {
      type: 'object',
      properties: {
        businessId: { type: 'string', description: 'The business ID' },
      },
      required: ['businessId'],
    },
    outputSchema: { type: 'object', description: 'Hygiene run result', fields: { itemsMatched: { type: 'number', description: 'Issues found' }, actionsCreated: { type: 'number', description: 'Cleanup tasks created' } } },
  },

  // ================================================================
  //  PROJECTS — read & manipulate projects + tasks
  // ================================================================
  {
    name: 'projects_list',
    description: 'List active projects with health, progress, and overdue counts.',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/projects',
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Optional status filter (e.g. "active")' },
        limit: { type: 'number', description: 'Max projects to return (default 25)' },
      },
      required: [],
    },
    outputSchema: { type: 'object', description: 'List of projects', fields: { projects: { type: 'array', description: 'Project summaries' } } },
  },
  {
    name: 'projects_list_tasks',
    description: 'List tasks for a project (or across projects) with due dates and completion state.',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/projects',
    parameters: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Optional project id to scope the list' },
        onlyOpen: { type: 'boolean', description: 'If true, only return tasks that are not completed' },
      },
      required: [],
    },
    outputSchema: { type: 'object', description: 'List of project tasks', fields: { tasks: { type: 'array', description: 'Task list' } } },
  },
  {
    name: 'projects_create_task',
    description: 'Create a new task on a project.',
    family: 'crud',
    riskLevel: 'low',
    riskTier: 2 as RiskTier,
    manualEquivalentRoute: '/app/projects',
    changedEntities: ['projectTask'],
    parameters: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Project id' },
        title: { type: 'string', description: 'Task title' },
        dueDate: { type: 'string', description: 'Optional ISO date for the deadline' },
        priority: { type: 'string', description: 'LOW | NORMAL | HIGH | URGENT', enum: ['LOW', 'NORMAL', 'HIGH', 'URGENT'] },
      },
      required: ['projectId', 'title'],
    },
    outputSchema: { type: 'object', description: 'Created task', fields: { task: { type: 'object', description: 'The created task' } } },
  },
  {
    name: 'projects_complete_task',
    description: 'Mark a project task as completed.',
    family: 'crud',
    riskLevel: 'low',
    riskTier: 2 as RiskTier,
    manualEquivalentRoute: '/app/projects',
    changedEntities: ['projectTask'],
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'Project task id' },
      },
      required: ['taskId'],
    },
    outputSchema: { type: 'object', description: 'Updated task', fields: { task: { type: 'object', description: 'The updated task' } } },
  },

  // ================================================================
  //  EXPENSES — extra read tools
  // ================================================================
  {
    name: 'expenses_list',
    description: 'List recent expenses with vendor, amount, and category.',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/expenses',
    parameters: {
      type: 'object',
      properties: {
        sinceDays: { type: 'number', description: 'Look back this many days (default 30)' },
        limit: { type: 'number', description: 'Max rows to return (default 25)' },
      },
      required: [],
    },
    outputSchema: { type: 'object', description: 'List of expenses', fields: { expenses: { type: 'array', description: 'Expense rows' } } },
  },
  {
    name: 'expenses_create',
    description: 'Record a new business expense.',
    family: 'crud',
    riskLevel: 'low',
    riskTier: 2 as RiskTier,
    manualEquivalentRoute: '/app/expenses',
    changedEntities: ['expense'],
    parameters: {
      type: 'object',
      properties: {
        amount: { type: 'number', description: 'Amount in TTD' },
        description: { type: 'string', description: 'What the expense is for' },
        date: { type: 'string', description: 'ISO date (defaults to today)' },
        vendor: { type: 'string', description: 'Vendor name (optional)' },
      },
      required: ['amount', 'description'],
    },
    outputSchema: { type: 'object', description: 'Created expense', fields: { expense: { type: 'object', description: 'The created expense' } } },
  },

  // ================================================================
  //  DOCUMENTS — read tools
  // ================================================================
  {
    name: 'documents_list',
    description: 'List recent documents (contracts, proposals, etc.) with status.',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/document-intelligence',
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Optional document status filter' },
        limit: { type: 'number', description: 'Max rows (default 25)' },
      },
      required: [],
    },
    outputSchema: { type: 'object', description: 'List of documents', fields: { documents: { type: 'array', description: 'Document rows' } } },
  },
  {
    name: 'documents_search',
    description: 'Search documents by title.',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/document-intelligence',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Free-form text search' },
      },
      required: ['query'],
    },
    outputSchema: { type: 'object', description: 'Matched documents', fields: { documents: { type: 'array', description: 'Document rows' } } },
  },

  // ================================================================
  //  COMMUNITY — read tools
  // ================================================================
  {
    name: 'community_list_posts',
    description: 'List recent community posts visible to this business.',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/community',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max posts (default 20)' },
      },
      required: [],
    },
    outputSchema: { type: 'object', description: 'Community posts', fields: { posts: { type: 'array', description: 'Post rows' } } },
  },

  // ================================================================
  //  MARKETPLACE — read tools
  // ================================================================
  {
    name: 'marketplace_list_listings',
    description: 'List this business’s marketplace listings with status, pricing, and stock.',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/marketplace',
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Optional status filter (e.g. "active")' },
        limit: { type: 'number', description: 'Max rows (default 25)' },
      },
      required: [],
    },
    outputSchema: { type: 'object', description: 'Listings', fields: { listings: { type: 'array', description: 'Listing rows' } } },
  },
  {
    name: 'marketplace_list_orders',
    description: 'List this business’s recent marketplace orders with totals and fulfilment state.',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/marketplace',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max rows (default 25)' },
      },
      required: [],
    },
    outputSchema: { type: 'object', description: 'Orders', fields: { orders: { type: 'array', description: 'Order rows' } } },
  },

  // ================================================================
  //  STORE — read tools
  // ================================================================
  {
    name: 'store_list_products',
    description: 'List products in the storefront/store with pricing and active status. Does NOT include stock levels — stock lives in InventoryStock and is not joined here.',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/store',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max products (default 25)' },
      },
      required: [],
    },
    outputSchema: { type: 'object', description: 'Products', fields: { products: { type: 'array', description: 'Product rows' } } },
  },
  {
    name: 'store_list_recent_orders',
    description: 'List recent storefront/commerce orders (paid invoices act as orders) with totals.',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/store',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max rows (default 25)' },
      },
      required: [],
    },
    outputSchema: { type: 'object', description: 'Recent orders', fields: { orders: { type: 'array', description: 'Order/invoice rows' } } },
  },

  // ================================================================
  //  KEYFLOW NOTES — universal note tool
  // ================================================================
  {
    name: 'keyflow_create_note',
    description: 'Attach a note to any module item (booking, contact, invoice, project, etc.) using its type and id. Useful when the operator says "add a note to X".',
    family: 'crud',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/keyflow-command',
    changedEntities: ['keyflowNote'],
    parameters: {
      type: 'object',
      properties: {
        targetType: { type: 'string', description: 'Type of item: booking, contact, invoice, project, project_task, contact_task, autopilot_task, expense, document, marketplace_listing, community_post, page' },
        targetId: { type: 'string', description: 'ID of the target item (use "page" for free-form notes)' },
        targetLabel: { type: 'string', description: 'Optional human-readable label for the item' },
        body: { type: 'string', description: 'The note body' },
        pinned: { type: 'boolean', description: 'Pin this note for quick access (default false)' },
      },
      required: ['targetType', 'targetId', 'body'],
    },
    outputSchema: { type: 'object', description: 'Created note', fields: { note: { type: 'object', description: 'The persisted note' } } },
  },

  // ================================================================
  //  SEO FAMILY — Phase 9 SEO Operations
  // ================================================================
  {
    name: 'fetch_seo_dashboard',
    description: 'Get the SEO dashboard: pages indexed, tracked keywords, ranking trends, open issues, top traffic, and revenue from organic search.',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/seo',
    parameters: { type: 'object', properties: { businessId: { type: 'string', description: 'The business ID' } }, required: ['businessId'] },
    outputSchema: {
      type: 'object',
      description: 'SEO health snapshot',
      fields: {
        score: { type: 'number', description: 'Overall SEO score 0-100' },
        overview: { type: 'object', description: 'Counts of pages, keywords, issues' },
        traffic: { type: 'object', description: 'Clicks, impressions, conversions, revenue' },
        topPages: { type: 'array', description: 'Top traffic pages' },
        topKeywords: { type: 'array', description: 'Top keywords by clicks' },
      },
    },
  },
  {
    name: 'fetch_seo_keywords',
    description: 'List tracked SEO keywords with current ranking, position changes, trend (improving/declining/stable), and clicks.',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/seo',
    parameters: {
      type: 'object',
      properties: {
        businessId: { type: 'string', description: 'The business ID' },
        trend: { type: 'string', description: 'Filter by trend', enum: ['improving', 'declining', 'stable'] },
      },
      required: ['businessId'],
    },
    outputSchema: { type: 'object', description: 'Keyword list', fields: { keywords: { type: 'array', description: 'Tracked keyword records' } } },
  },
  {
    name: 'fetch_seo_issues',
    description: 'Show open SEO issues — missing titles, missing meta descriptions, thin content, indexing problems — sorted by severity.',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/seo',
    parameters: {
      type: 'object',
      properties: {
        businessId: { type: 'string', description: 'The business ID' },
        severity: { type: 'string', description: 'Filter by severity', enum: ['critical', 'high', 'medium', 'low'] },
      },
      required: ['businessId'],
    },
    outputSchema: { type: 'object', description: 'Issue list', fields: { issues: { type: 'array', description: 'Open SEO issues' } } },
  },
  {
    name: 'fetch_content_gaps',
    description: 'Detect content gaps — keywords with high opportunity (no page targeting them, ranking on page 2-3, or high impressions with low CTR).',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/seo',
    parameters: { type: 'object', properties: { businessId: { type: 'string', description: 'The business ID' } }, required: ['businessId'] },
    outputSchema: { type: 'object', description: 'Content gap analysis', fields: { gaps: { type: 'array', description: 'Ranked content opportunities' } } },
  },
  {
    name: 'fetch_seo_revenue_attribution',
    description: 'Show revenue attributed to organic search traffic — top revenue pages, total organic sessions, conversion rate, and revenue.',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/seo',
    parameters: { type: 'object', properties: { businessId: { type: 'string', description: 'The business ID' } }, required: ['businessId'] },
    outputSchema: {
      type: 'object',
      description: 'Organic revenue attribution',
      fields: {
        totalOrganicSessions: { type: 'number', description: 'Total organic sessions' },
        totalRevenue: { type: 'number', description: 'Revenue from organic in TTD' },
        topRevenuePages: { type: 'array', description: 'Pages ranked by revenue' },
      },
    },
  },
  {
    name: 'sync_seo_pages',
    description: 'Crawl the storefront to refresh the SEO page inventory and re-detect issues. Safe and idempotent.',
    family: 'organize',
    riskLevel: 'low',
    riskTier: 2 as RiskTier,
    manualEquivalentRoute: '/app/seo',
    changedEntities: ['seoPage', 'seoIssue'],
    parameters: { type: 'object', properties: { businessId: { type: 'string', description: 'The business ID' } }, required: ['businessId'] },
    outputSchema: { type: 'object', description: 'Sync result', fields: { synced: { type: 'number', description: 'Pages synced' } } },
  },
  {
    name: 'seo_apply_remediation',
    description: 'Fix an open SEO issue: applies meta title/description/H1 updates to the affected page (LLM-drafted from page + keyword context when not supplied) and marks the issue resolved. Use fetch_seo_issues to find candidates.',
    family: 'organize',
    riskLevel: 'medium',
    riskTier: 2 as RiskTier,
    manualEquivalentRoute: '/app/seo',
    changedEntities: ['seoPage', 'seoIssue'],
    parameters: {
      type: 'object',
      properties: {
        issueId: { type: 'string', description: 'SEO issue ID to remediate' },
        resolution: { type: 'string', description: 'fixed (apply changes) or dismissed (no action needed)', enum: ['fixed', 'dismissed'] },
        metaTitle: { type: 'string', description: 'Optional explicit meta title to set on the page' },
        metaDescription: { type: 'string', description: 'Optional explicit meta description to set' },
        h1: { type: 'string', description: 'Optional explicit H1 to set' },
      },
      required: ['issueId'],
    },
    outputSchema: { type: 'object', description: 'Remediation result', fields: { issueId: { type: 'string', description: 'Issue ID' }, status: { type: 'string', description: 'New issue status' }, pageUpdated: { type: 'boolean', description: 'Whether the page record changed' }, applied: { type: 'object', description: 'Fields applied' } } },
  },
  {
    name: 'generate_content_brief',
    description: 'Generate an AI-powered SEO content brief for a target keyword — outline, meta tags, search intent, internal links.',
    family: 'draft',
    riskLevel: 'medium',
    riskTier: 2 as RiskTier,
    manualEquivalentRoute: '/app/seo',
    changedEntities: ['contentBrief'],
    followOnSuggestions: ['fetch_content_briefs'],
    parameters: {
      type: 'object',
      properties: {
        businessId: { type: 'string', description: 'The business ID' },
        targetKeyword: { type: 'string', description: 'Primary keyword to target' },
        contentType: { type: 'string', description: 'Type of content (article, landing_page, product_page, etc.)' },
        notes: { type: 'string', description: 'Additional context for the brief' },
      },
      required: ['businessId', 'targetKeyword'],
    },
    outputSchema: { type: 'object', description: 'Generated content brief', fields: { brief: { type: 'object', description: 'The content brief record' } } },
  },

  // ================================================================
  //  CONTENT OPS FAMILY — L3 Operator: content pipeline execution
  // ================================================================
  {
    name: 'content_list_requests',
    description: 'List content requests for the business with optional status filter. Returns pipeline items with status, priority, due date, and assignees.',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/content-ops',
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Filter by status', enum: ['DRAFT', 'SUBMITTED', 'ASSIGNED', 'IN_PRODUCTION', 'INTERNAL_REVIEW', 'USER_REVIEW', 'APPROVED', 'UPLOADED_TO_DRIVE', 'DELIVERED'] },
        limit: { type: 'number', description: 'Max results (default 25)' },
      },
      required: [],
    },
    outputSchema: { type: 'object', description: 'Content requests', fields: { items: { type: 'array', description: 'Content request rows' }, total: { type: 'number', description: 'Total count' } } },
  },
  {
    name: 'content_get_request',
    description: 'Get a single content request by ID with full details including status history, assigned team members, and delivery package.',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/content-ops',
    parameters: {
      type: 'object',
      properties: {
        requestId: { type: 'string', description: 'The content request ID' },
      },
      required: ['requestId'],
    },
    outputSchema: { type: 'object', description: 'Content request detail', fields: { request: { type: 'object', description: 'Full content request record' } } },
  },
  {
    name: 'content_create_request',
    description: 'Create a new content request — blog post, social content, email, video script, flyer, etc. Sets status to DRAFT.',
    family: 'crud',
    riskLevel: 'medium',
    riskTier: 2 as RiskTier,
    manualEquivalentRoute: '/app/content-ops',
    changedEntities: ['contentRequest'],
    parameters: {
      type: 'object',
      properties: {
        contentTypes: { type: 'array', description: 'Content types to create', items: { type: 'string' } },
        businessGoal: { type: 'string', description: 'Business goal for this content (e.g. "Drive holiday bookings")' },
        targetAudience: { type: 'string', description: 'Target audience description' },
        offer: { type: 'string', description: 'Product or offer being promoted' },
        tone: { type: 'string', description: 'Content tone', enum: ['professional', 'casual', 'urgent', 'playful', 'luxury'] },
        dueDate: { type: 'string', description: 'Due date in ISO format' },
        priority: { type: 'string', description: 'Priority', enum: ['LOW', 'NORMAL', 'HIGH', 'URGENT'] },
        approvalRequired: { type: 'boolean', description: 'Whether approval is required before delivery (default true)' },
      },
      required: ['contentTypes', 'businessGoal'],
    },
    outputSchema: { type: 'object', description: 'Created content request', fields: { id: { type: 'string', description: 'Request ID' }, status: { type: 'string', description: 'Initial status' } } },
  },
  {
    name: 'content_assign_request',
    description: 'Assign a content request to team members and transition status to ASSIGNED.',
    family: 'organize',
    riskLevel: 'medium',
    riskTier: 2 as RiskTier,
    manualEquivalentRoute: '/app/content-ops',
    changedEntities: ['contentRequest'],
    parameters: {
      type: 'object',
      properties: {
        requestId: { type: 'string', description: 'Content request ID' },
        teamMemberIds: { type: 'array', description: 'User IDs to assign', items: { type: 'string' } },
      },
      required: ['requestId', 'teamMemberIds'],
    },
    outputSchema: { type: 'object', description: 'Assignment result', fields: { requestId: { type: 'string', description: 'Request ID' }, assignedTo: { type: 'array', description: 'Assigned user IDs' } } },
  },
  {
    name: 'content_transition_status',
    description: 'Transition a content request to a new status (e.g. DRAFT → SUBMITTED → ASSIGNED → IN_PRODUCTION → INTERNAL_REVIEW → USER_REVIEW → APPROVED → UPLOADED_TO_DRIVE → DELIVERED).',
    family: 'organize',
    riskLevel: 'medium',
    riskTier: 2 as RiskTier,
    manualEquivalentRoute: '/app/content-ops',
    changedEntities: ['contentRequest'],
    parameters: {
      type: 'object',
      properties: {
        requestId: { type: 'string', description: 'Content request ID' },
        newStatus: { type: 'string', description: 'Target status', enum: ['SUBMITTED', 'ASSIGNED', 'IN_PRODUCTION', 'INTERNAL_REVIEW', 'USER_REVIEW', 'APPROVED', 'UPLOADED_TO_DRIVE', 'DELIVERED', 'CANCELLED'] },
        comment: { type: 'string', description: 'Optional transition comment' },
      },
      required: ['requestId', 'newStatus'],
    },
    outputSchema: { type: 'object', description: 'Transition result', fields: { requestId: { type: 'string', description: 'Request ID' }, newStatus: { type: 'string', description: 'New status' } } },
  },
  {
    name: 'content_submit_for_review',
    description: 'Submit a content request for internal review (transitions IN_PRODUCTION → INTERNAL_REVIEW).',
    family: 'organize',
    riskLevel: 'medium',
    riskTier: 2 as RiskTier,
    manualEquivalentRoute: '/app/content-ops',
    changedEntities: ['contentRequest'],
    parameters: {
      type: 'object',
      properties: {
        requestId: { type: 'string', description: 'Content request ID' },
        comment: { type: 'string', description: 'Optional comment for reviewers' },
      },
      required: ['requestId'],
    },
    outputSchema: { type: 'object', description: 'Submit result', fields: { requestId: { type: 'string', description: 'Request ID' }, status: { type: 'string', description: 'New status' } } },
  },
  {
    name: 'content_upload_deliverables',
    description: 'Upload deliverable file IDs to a content request (requires APPROVED status). Transitions to UPLOADED_TO_DRIVE.',
    family: 'execute',
    riskLevel: 'medium',
    riskTier: 3 as RiskTier,
    manualEquivalentRoute: '/app/content-ops',
    changedEntities: ['contentRequest', 'contentDeliveryPackage'],
    parameters: {
      type: 'object',
      properties: {
        requestId: { type: 'string', description: 'Content request ID' },
        fileIds: { type: 'array', description: 'Google Drive file IDs', items: { type: 'string' } },
        folderId: { type: 'string', description: 'Google Drive folder ID' },
      },
      required: ['requestId', 'fileIds', 'folderId'],
    },
    outputSchema: { type: 'object', description: 'Upload result', fields: { requestId: { type: 'string', description: 'Request ID' }, uploaded: { type: 'number', description: 'Files uploaded' } } },
  },
  {
    name: 'content_deliver_request',
    description: 'Mark a content request as delivered (requires UPLOADED_TO_DRIVE status). Final step in the pipeline.',
    family: 'execute',
    riskLevel: 'medium',
    riskTier: 3 as RiskTier,
    manualEquivalentRoute: '/app/content-ops',
    changedEntities: ['contentRequest', 'contentDeliveryPackage'],
    parameters: {
      type: 'object',
      properties: {
        requestId: { type: 'string', description: 'Content request ID' },
      },
      required: ['requestId'],
    },
    outputSchema: { type: 'object', description: 'Delivery result', fields: { requestId: { type: 'string', description: 'Request ID' }, status: { type: 'string', description: 'New status' } } },
  },

  // ================================================================
  //  CALL TASKS FAMILY — L3 Operator: call scheduling & logging
  // ================================================================
  {
    name: 'call_list_tasks',
    description: 'List call logs/tasks for the business with optional filters for status, caller, contact, and date range.',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/call-tasks',
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Filter by status', enum: ['scheduled', 'completed'] },
        callerId: { type: 'string', description: 'Filter by caller user ID' },
        contactId: { type: 'string', description: 'Filter by contact ID' },
        limit: { type: 'number', description: 'Max results (default 25)' },
      },
      required: [],
    },
    outputSchema: { type: 'object', description: 'Call logs', fields: { items: { type: 'array', description: 'Call log rows' }, total: { type: 'number', description: 'Total count' } } },
  },
  {
    name: 'call_create_task',
    description: 'Create a scheduled call task for a contact with script, notes, and optional link to an existing task.',
    family: 'crud',
    riskLevel: 'medium',
    riskTier: 2 as RiskTier,
    manualEquivalentRoute: '/app/call-tasks',
    changedEntities: ['callLog'],
    parameters: {
      type: 'object',
      properties: {
        contactId: { type: 'string', description: 'Contact ID to call' },
        callerId: { type: 'string', description: 'User ID who will make the call' },
        scheduledAt: { type: 'string', description: 'Scheduled date/time in ISO format' },
        script: { type: 'string', description: 'Call script or talking points' },
        notes: { type: 'string', description: 'Additional notes' },
      },
      required: ['contactId', 'callerId'],
    },
    outputSchema: { type: 'object', description: 'Created call task', fields: { id: { type: 'string', description: 'Call log ID' }, contactId: { type: 'string', description: 'Contact ID' } } },
  },
  {
    name: 'call_log_outcome',
    description: 'Log the outcome of a completed call — reached, no_answer, voicemail, wrong_number, callback_requested, not_interested.',
    family: 'crud',
    riskLevel: 'medium',
    riskTier: 2 as RiskTier,
    manualEquivalentRoute: '/app/call-tasks',
    changedEntities: ['callLog'],
    parameters: {
      type: 'object',
      properties: {
        callLogId: { type: 'string', description: 'Call log ID' },
        outcome: { type: 'string', description: 'Call outcome', enum: ['reached', 'no_answer', 'voicemail', 'wrong_number', 'callback_requested', 'not_interested'] },
        duration: { type: 'number', description: 'Call duration in seconds' },
        notes: { type: 'string', description: 'Additional notes' },
      },
      required: ['callLogId', 'outcome'],
    },
    outputSchema: { type: 'object', description: 'Outcome logged', fields: { callLogId: { type: 'string', description: 'Call log ID' }, outcome: { type: 'string', description: 'Recorded outcome' } } },
  },
  {
    name: 'call_generate_script',
    description: 'Generate an AI-powered call script for a contact/call log based on their deals, invoices, bookings, and recent activity.',
    family: 'draft',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/call-tasks',
    changedEntities: ['callLog'],
    parameters: {
      type: 'object',
      properties: {
        callLogId: { type: 'string', description: 'Call log ID to attach the script to' },
        contactId: { type: 'string', description: 'Contact ID to generate the script for' },
      },
      required: ['callLogId', 'contactId'],
    },
    outputSchema: {
      type: 'object',
      description: 'Generated call script',
      fields: {
        greeting: { type: 'string', description: 'Opening greeting' },
        talkingPoints: { type: 'array', description: 'Key talking points' },
        ask: { type: 'string', description: 'The ask/question' },
        close: { type: 'string', description: 'Closing statement' },
        durationEstimate: { type: 'number', description: 'Estimated call duration in minutes' },
      },
    },
  },
  {
    name: 'call_schedule_followup',
    description: 'Create a follow-up task from a completed call (e.g. callback_requested → schedule new call).',
    family: 'organize',
    riskLevel: 'medium',
    riskTier: 2 as RiskTier,
    manualEquivalentRoute: '/app/call-tasks',
    changedEntities: ['contactTask'],
    parameters: {
      type: 'object',
      properties: {
        callLogId: { type: 'string', description: 'Call log ID' },
        title: { type: 'string', description: 'Follow-up task title' },
        dueDate: { type: 'string', description: 'Due date in ISO format' },
        priority: { type: 'string', description: 'Priority', enum: ['LOW', 'NORMAL', 'HIGH'] },
        assigneeId: { type: 'string', description: 'User ID to assign follow-up to' },
      },
      required: ['callLogId', 'title'],
    },
    outputSchema: { type: 'object', description: 'Follow-up created', fields: { taskId: { type: 'string', description: 'Follow-up task ID' }, title: { type: 'string', description: 'Task title' } } },
  },

  // ================================================================
  //  EVIDENCE FAMILY — L3 Operator: evidence submission & verification
  // ================================================================
  {
    name: 'evidence_list',
    description: 'List evidence records for the business with optional type filter.',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/evidence',
    parameters: {
      type: 'object',
      properties: {
        evidenceType: { type: 'string', description: 'Filter by evidence type', enum: ['photo', 'file', 'signature', 'checklist', 'message', 'note', 'document'] },
        limit: { type: 'number', description: 'Max results (default 25)' },
      },
      required: [],
    },
    outputSchema: { type: 'object', description: 'Evidence records', fields: { items: { type: 'array', description: 'Evidence rows' }, total: { type: 'number', description: 'Total count' } } },
  },
  {
    name: 'evidence_submit',
    description: 'Submit evidence (photo, file, document, etc.) linked to a task, approval, or contact.',
    family: 'crud',
    riskLevel: 'medium',
    riskTier: 2 as RiskTier,
    manualEquivalentRoute: '/app/evidence',
    changedEntities: ['evidence'],
    parameters: {
      type: 'object',
      properties: {
        evidenceType: { type: 'string', description: 'Type of evidence', enum: ['photo', 'file', 'signature', 'checklist', 'message', 'note', 'document'] },
        url: { type: 'string', description: 'Public URL of the evidence file' },
        storageKey: { type: 'string', description: 'Storage key/path for the file' },
        linkedType: { type: 'string', description: 'What this evidence is for', enum: ['ContactTask', 'ProjectTask', 'ApprovalRequest', 'Contact', 'CallLog'] },
        linkedId: { type: 'string', description: 'ID of the linked item' },
        metadata: { type: 'object', description: 'Optional metadata' },
      },
      required: ['evidenceType', 'url', 'storageKey', 'linkedType', 'linkedId'],
    },
    outputSchema: { type: 'object', description: 'Submitted evidence', fields: { id: { type: 'string', description: 'Evidence ID' }, linkedType: { type: 'string', description: 'Linked item type' }, linkedId: { type: 'string', description: 'Linked item ID' } } },
  },
  {
    name: 'evidence_verify',
    description: 'Verify a submitted evidence record (mark as verified).',
    family: 'crud',
    riskLevel: 'medium',
    riskTier: 2 as RiskTier,
    manualEquivalentRoute: '/app/evidence',
    changedEntities: ['evidence'],
    parameters: {
      type: 'object',
      properties: {
        evidenceId: { type: 'string', description: 'Evidence ID to verify' },
      },
      required: ['evidenceId'],
    },
    outputSchema: { type: 'object', description: 'Verification result', fields: { evidenceId: { type: 'string', description: 'Evidence ID' }, verified: { type: 'boolean', description: 'Verification status' } } },
  },

  // ================================================================
  //  APPROVALS FAMILY — L3 Operator: approval workflow execution
  // ================================================================
  {
    name: 'approval_list',
    description: 'List approval requests for the business with optional status and type filters.',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/approvals',
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Filter by status', enum: ['pending', 'approved', 'rejected', 'escalated', 'delegated'] },
        requestType: { type: 'string', description: 'Filter by type', enum: ['quote_discount', 'expense', 'content_delivery', 'refund', 'po', 'time_off'] },
        limit: { type: 'number', description: 'Max results (default 25)' },
      },
      required: [],
    },
    outputSchema: { type: 'object', description: 'Approval requests', fields: { items: { type: 'array', description: 'Approval request rows' }, total: { type: 'number', description: 'Total count' } } },
  },
  {
    name: 'approval_create_request',
    description: 'Create an approval request (quote discount, expense, content delivery, refund, etc.) with multi-step approver chain.',
    family: 'crud',
    riskLevel: 'medium',
    riskTier: 2 as RiskTier,
    manualEquivalentRoute: '/app/approvals',
    changedEntities: ['approvalRequest'],
    parameters: {
      type: 'object',
      properties: {
        requestType: { type: 'string', description: 'Type of approval', enum: ['quote_discount', 'expense', 'content_delivery', 'refund', 'po', 'time_off'] },
        title: { type: 'string', description: 'Approval title' },
        description: { type: 'string', description: 'Detailed description' },
        payload: { type: 'object', description: 'Structured data (e.g. { amount: 500, quoteId: "..." })' },
        threshold: { type: 'number', description: 'Auto-approve if amount <= threshold' },
        steps: { type: 'array', description: 'Approver chain [{ stepOrder, approverId }]', items: { type: 'object' } },
      },
      required: ['requestType', 'title', 'steps'],
    },
    outputSchema: { type: 'object', description: 'Created approval', fields: { id: { type: 'string', description: 'Approval request ID' }, status: { type: 'string', description: 'Initial status' } } },
  },
  {
    name: 'approval_decide_step',
    description: 'Approve or reject the current step of an approval request. Advances to next step or finalizes the request.',
    family: 'execute',
    riskLevel: 'medium',
    riskTier: 3 as RiskTier,
    manualEquivalentRoute: '/app/approvals',
    changedEntities: ['approvalRequest', 'approvalStep'],
    parameters: {
      type: 'object',
      properties: {
        approvalRequestId: { type: 'string', description: 'Approval request ID' },
        decision: { type: 'string', description: 'Decision', enum: ['approve', 'reject'] },
        comment: { type: 'string', description: 'Optional comment' },
      },
      required: ['approvalRequestId', 'decision'],
    },
    outputSchema: { type: 'object', description: 'Decision result', fields: { approvalRequestId: { type: 'string', description: 'Request ID' }, decision: { type: 'string', description: 'Recorded decision' }, newStatus: { type: 'string', description: 'Request status after decision' } } },
  },

  // ================================================================
  //  DRIVE FAMILY — L3 Operator: Google Drive operations
  // ================================================================
  {
    name: 'drive_create_folder',
    description: 'Create a folder in Google Drive for the business. Returns the folder ID.',
    family: 'organize',
    riskLevel: 'medium',
    riskTier: 2 as RiskTier,
    manualEquivalentRoute: '/app/content-ops',
    changedEntities: [],
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Folder name' },
        parentId: { type: 'string', description: 'Optional parent folder ID' },
      },
      required: ['name'],
    },
    outputSchema: { type: 'object', description: 'Created folder', fields: { folderId: { type: 'string', description: 'Drive folder ID' }, name: { type: 'string', description: 'Folder name' } } },
  },
  {
    name: 'drive_create_document',
    description: 'Create a Google Doc in Drive for the business. Returns the document ID.',
    family: 'organize',
    riskLevel: 'medium',
    riskTier: 2 as RiskTier,
    manualEquivalentRoute: '/app/content-ops',
    changedEntities: [],
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Document title' },
        parentId: { type: 'string', description: 'Optional parent folder ID' },
      },
      required: ['title'],
    },
    outputSchema: { type: 'object', description: 'Created document', fields: { documentId: { type: 'string', description: 'Drive document ID' }, title: { type: 'string', description: 'Document title' } } },
  },

  // ================================================================
  //  CALENDAR FAMILY — L1 Read / L2 Organize: Calendar events
  // ================================================================
  {
    name: 'calendar_list_events',
    description: 'List calendar events for the business with optional date range, module, and status filters.',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/calendar',
    parameters: {
      type: 'object',
      properties: {
        startDate: { type: 'string', description: 'ISO start date (e.g. 2024-01-01)' },
        endDate: { type: 'string', description: 'ISO end date (e.g. 2024-01-31)' },
        module: { type: 'string', description: 'Filter by module: BOOKINGS, REVENUE, PROJECTS, MARKETING' },
        status: { type: 'string', description: 'Filter by status: SCHEDULED, CONFIRMED, COMPLETED, CANCELLED' },
        limit: { type: 'number', description: 'Max results (default 25)' },
      },
      required: [],
    },
    outputSchema: { type: 'object', description: 'Calendar events', fields: { events: { type: 'array', description: 'Event rows' }, count: { type: 'number', description: 'Total count' } } },
  },
  {
    name: 'calendar_create_event',
    description: 'Create a general calendar event (meeting, reminder, milestone, etc.).',
    family: 'crud',
    riskLevel: 'medium',
    riskTier: 2 as RiskTier,
    manualEquivalentRoute: '/app/calendar',
    changedEntities: ['calendarEvent'],
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Event title' },
        description: { type: 'string', description: 'Event description' },
        startAt: { type: 'string', description: 'ISO start datetime' },
        endAt: { type: 'string', description: 'ISO end datetime' },
        allDay: { type: 'boolean', description: 'All-day event' },
        type: { type: 'string', description: 'What kind of entry this is. FOLLOW_UP for a general reminder or meeting, CONTACT_TASK when it is about a specific customer, PROJECT_TASK when it belongs to a project.', enum: ['FOLLOW_UP', 'CONTACT_TASK', 'PROJECT_TASK'] },
        priority: { type: 'string', description: 'Priority: LOW, NORMAL, HIGH, URGENT', enum: ['LOW', 'NORMAL', 'HIGH', 'URGENT'] },
        color: { type: 'string', description: 'Optional color hex' },
      },
      required: ['title', 'startAt', 'type'],
    },
    outputSchema: { type: 'object', description: 'Created event', fields: { id: { type: 'string', description: 'Event ID' }, title: { type: 'string', description: 'Event title' }, startAt: { type: 'string', description: 'Start time' } } },
  },
  {
    name: 'calendar_check_conflicts',
    description: 'Check for scheduling conflicts in a given time range. Returns overlapping events if any.',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/calendar',
    parameters: {
      type: 'object',
      properties: {
        startAt: { type: 'string', description: 'ISO start datetime to check' },
        endAt: { type: 'string', description: 'ISO end datetime to check' },
      },
      required: ['startAt', 'endAt'],
    },
    outputSchema: { type: 'object', description: 'Conflict check result', fields: { hasConflict: { type: 'boolean', description: 'Whether there is a conflict' }, conflicts: { type: 'array', description: 'Overlapping events' } } },
  },

  // ================================================================
  //  TIME TRACKING FAMILY — L2 Organize / L3 Execute
  // ================================================================
  {
    name: 'time_start_timer',
    description: 'Start a time tracking timer for a task or project. Creates an open time entry.',
    family: 'organize',
    riskLevel: 'low',
    riskTier: 2 as RiskTier,
    manualEquivalentRoute: '/app/time-tracking',
    changedEntities: ['timeEntry'],
    parameters: {
      type: 'object',
      properties: {
        description: { type: 'string', description: 'What is being worked on' },
        projectId: { type: 'string', description: 'Optional project ID' },
        taskId: { type: 'string', description: 'Optional project task ID' },
        hourlyRate: { type: 'number', description: 'Optional hourly rate' },
      },
      required: ['description'],
    },
    outputSchema: { type: 'object', description: 'Started timer', fields: { id: { type: 'string', description: 'Time entry ID' }, startTime: { type: 'string', description: 'Start timestamp' } } },
  },
  {
    name: 'time_stop_timer',
    description: 'Stop the currently running timer and record the duration.',
    family: 'organize',
    riskLevel: 'low',
    riskTier: 2 as RiskTier,
    manualEquivalentRoute: '/app/time-tracking',
    changedEntities: ['timeEntry'],
    parameters: {
      type: 'object',
      properties: {
        timeEntryId: { type: 'string', description: 'Time entry ID to stop' },
      },
      required: ['timeEntryId'],
    },
    outputSchema: { type: 'object', description: 'Stopped timer', fields: { id: { type: 'string', description: 'Time entry ID' }, durationMinutes: { type: 'number', description: 'Recorded duration in minutes' } } },
  },
  {
    name: 'time_log_entry',
    description: 'Log a completed time entry manually (e.g. after-the-fact logging).',
    family: 'organize',
    riskLevel: 'low',
    riskTier: 2 as RiskTier,
    manualEquivalentRoute: '/app/time-tracking',
    changedEntities: ['timeEntry'],
    parameters: {
      type: 'object',
      properties: {
        description: { type: 'string', description: 'What was worked on' },
        startTime: { type: 'string', description: 'ISO start datetime' },
        endTime: { type: 'string', description: 'ISO end datetime' },
        durationMinutes: { type: 'number', description: 'Duration in minutes (optional, computed from start/end if omitted)' },
        projectId: { type: 'string', description: 'Optional project ID' },
        taskId: { type: 'string', description: 'Optional project task ID' },
        hourlyRate: { type: 'number', description: 'Optional hourly rate' },
        billable: { type: 'boolean', description: 'Whether billable (default true)' },
      },
      required: ['description', 'startTime', 'endTime'],
    },
    outputSchema: { type: 'object', description: 'Logged entry', fields: { id: { type: 'string', description: 'Time entry ID' }, durationMinutes: { type: 'number', description: 'Duration in minutes' } } },
  },

  // ================================================================
  //  HELPDESK FAMILY — L2 Organize / L3 Execute
  // ================================================================
  {
    name: 'helpdesk_list_tickets',
    description: 'List support tickets with optional status and priority filters.',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/helpdesk',
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Filter by status: OPEN, IN_PROGRESS, WAITING, RESOLVED, CLOSED' },
        priority: { type: 'string', description: 'Filter by priority: LOW, NORMAL, HIGH, URGENT' },
        limit: { type: 'number', description: 'Max results (default 25)' },
      },
      required: [],
    },
    outputSchema: { type: 'object', description: 'Support tickets', fields: { tickets: { type: 'array', description: 'Ticket rows' }, count: { type: 'number', description: 'Total count' } } },
  },
  {
    name: 'helpdesk_create_ticket',
    description: 'Create a support ticket for a contact or general issue.',
    family: 'crud',
    riskLevel: 'medium',
    riskTier: 2 as RiskTier,
    manualEquivalentRoute: '/app/helpdesk',
    changedEntities: ['supportTicket'],
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Ticket title' },
        description: { type: 'string', description: 'Ticket description' },
        contactId: { type: 'string', description: 'Optional contact ID' },
        priority: { type: 'string', description: 'Priority: LOW, NORMAL, HIGH, URGENT', enum: ['LOW', 'NORMAL', 'HIGH', 'URGENT'] },
        source: { type: 'string', description: 'Source: MANUAL, EMAIL, PORTAL, WHATSAPP', enum: ['MANUAL', 'EMAIL', 'PORTAL', 'WHATSAPP'] },
      },
      required: ['title'],
    },
    outputSchema: { type: 'object', description: 'Created ticket', fields: { id: { type: 'string', description: 'Ticket ID' }, title: { type: 'string', description: 'Ticket title' }, status: { type: 'string', description: 'Initial status' } } },
  },
  {
    name: 'helpdesk_update_ticket',
    description: 'Update a support ticket status, priority, or assignment.',
    family: 'crud',
    riskLevel: 'medium',
    riskTier: 2 as RiskTier,
    manualEquivalentRoute: '/app/helpdesk',
    changedEntities: ['supportTicket'],
    parameters: {
      type: 'object',
      properties: {
        ticketId: { type: 'string', description: 'Ticket ID' },
        status: { type: 'string', description: 'New status: OPEN, IN_PROGRESS, WAITING, RESOLVED, CLOSED' },
        priority: { type: 'string', description: 'New priority: LOW, NORMAL, HIGH, URGENT' },
        assignedToId: { type: 'string', description: 'User ID to assign' },
      },
      required: ['ticketId'],
    },
    outputSchema: { type: 'object', description: 'Updated ticket', fields: { id: { type: 'string', description: 'Ticket ID' }, status: { type: 'string', description: 'Updated status' } } },
  },

  // ================================================================
  //  FINANCE FAMILY — L1 Read / L2 Organize
  // ================================================================

  // ── The ledger's own reports ────────────────────────────────────────────
  //
  // LedgerReportingService exposes eight reports and KEY could reach two of
  // them — getArAging and getApAging, via finance_view_receivables and
  // finance_view_payables. The other six had no tool, so the most ordinary
  // questions an owner asks ("how did we do last quarter", "what's our cash
  // position", "how much tax do we owe") had no answer from the ledger.
  //
  // These wrap the service the Finance screens already read, rather than
  // recomputing anything. That is deliberate and it is the lesson from
  // finance_view_receivables, which used to reimplement AR aging inline and
  // therefore quoted KEY a figure derived differently from the one on screen,
  // with no way to notice when the two disagreed.
  //
  // All six are `read`/tier 1: they compute nothing and change nothing.
  {
    name: 'finance_profit_and_loss',
    description:
      'Profit & loss statement for a date range — income and expense totals by account, plus net profit. Uses the business\'s accounting basis.',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/finance/reports',
    parameters: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Start of the period, ISO date' },
        to: { type: 'string', description: 'End of the period, ISO date' },
        basis: { type: 'string', description: "'accrual' (default) or 'cash'" },
      },
      required: ['from', 'to'],
    },
    outputSchema: {
      type: 'object',
      description: 'P&L report',
      fields: {
        currency: { type: 'string', description: 'Reporting currency' },
        totalIncome: { type: 'number', description: 'Total income for the period' },
        totalExpenses: { type: 'number', description: 'Total expenses for the period' },
        netProfit: { type: 'number', description: 'Income minus expenses' },
        income: { type: 'array', description: 'Income lines by account' },
        expenses: { type: 'array', description: 'Expense lines by account' },
      },
    },
  },
  {
    name: 'finance_cashflow',
    description:
      'Cash flow for a date range — inflow, outflow and net movement, broken down by cash account.',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/finance/reports',
    parameters: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Start of the period, ISO date' },
        to: { type: 'string', description: 'End of the period, ISO date' },
        basis: { type: 'string', description: "'accrual' (default) or 'cash'" },
      },
      required: ['from', 'to'],
    },
    outputSchema: {
      type: 'object',
      description: 'Cash flow report',
      fields: {
        currency: { type: 'string', description: 'Reporting currency' },
        totalInflow: { type: 'number', description: 'Cash in' },
        totalOutflow: { type: 'number', description: 'Cash out' },
        netCashflow: { type: 'number', description: 'Net movement' },
        byAccount: { type: 'array', description: 'Per-account inflow/outflow/net' },
      },
    },
  },
  {
    name: 'finance_balance_sheet',
    description:
      'Balance sheet as at a date — assets, liabilities and equity with their account lines.',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/finance/reports',
    parameters: {
      type: 'object',
      properties: {
        asOfDate: { type: 'string', description: 'ISO date to report as at (default today)' },
      },
      required: [],
    },
    outputSchema: {
      type: 'object',
      description: 'Balance sheet',
      fields: {
        currency: { type: 'string', description: 'Reporting currency' },
        assets: { type: 'object', description: 'Total and lines' },
        liabilities: { type: 'object', description: 'Total and lines' },
        equity: { type: 'object', description: 'Total and lines' },
      },
    },
  },
  {
    name: 'finance_tax_summary',
    description:
      'Tax summary for a date range — taxable revenue, tax collected and tax paid on purchases, reconciled against invoice tax fields.',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/finance/reports',
    parameters: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Start of the period, ISO date' },
        to: { type: 'string', description: 'End of the period, ISO date' },
      },
      required: ['from', 'to'],
    },
    outputSchema: {
      type: 'object',
      description: 'Tax summary',
      fields: {
        currency: { type: 'string', description: 'Reporting currency' },
        netRevenue: { type: 'number', description: 'Taxable sales for the period' },
        taxCollected: { type: 'number', description: 'Tax collected on sales' },
        taxPaid: { type: 'number', description: 'Input tax on purchases' },
      },
    },
  },
  {
    name: 'finance_revenue_breakdown',
    description:
      'Revenue for a date range broken down by one dimension: customer, product, service or source.',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/finance/reports',
    parameters: {
      type: 'object',
      properties: {
        dimension: { type: 'string', description: "One of: customer, product, service, source" },
        from: { type: 'string', description: 'Start of the period, ISO date' },
        to: { type: 'string', description: 'End of the period, ISO date' },
      },
      required: ['dimension', 'from', 'to'],
    },
    outputSchema: {
      type: 'object',
      description: 'Revenue by dimension',
      fields: {
        dimension: { type: 'string', description: 'The dimension requested' },
        rows: { type: 'array', description: 'One row per member of the dimension, with its total' },
      },
    },
  },
  {
    name: 'finance_expense_breakdown',
    description:
      'Expenses for a date range broken down by one dimension: vendor, category or project.',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/finance/reports',
    parameters: {
      type: 'object',
      properties: {
        dimension: { type: 'string', description: 'One of: vendor, category, project' },
        from: { type: 'string', description: 'Start of the period, ISO date' },
        to: { type: 'string', description: 'End of the period, ISO date' },
      },
      required: ['dimension', 'from', 'to'],
    },
    outputSchema: {
      type: 'object',
      description: 'Expenses by dimension',
      fields: {
        dimension: { type: 'string', description: 'The dimension requested' },
        rows: { type: 'array', description: 'One row per member of the dimension, with its total' },
      },
    },
  },
  {
    name: 'finance_view_receivables',
    description: 'View accounts receivable aging report — outstanding invoices grouped by overdue buckets.',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/finance',
    parameters: {
      type: 'object',
      properties: {
        asOfDate: { type: 'string', description: 'Optional ISO date to calculate aging (default today)' },
      },
      required: [],
    },
    outputSchema: { type: 'object', description: 'AR aging report', fields: { totalOutstanding: { type: 'number', description: 'Total outstanding amount' }, current: { type: 'number', description: 'Not yet due' }, overdue1_30: { type: 'number', description: '1-30 days overdue' }, overdue31_60: { type: 'number', description: '31-60 days overdue' }, overdue61_90: { type: 'number', description: '61-90 days overdue' }, overdue90plus: { type: 'number', description: '90+ days overdue' }, invoices: { type: 'array', description: 'Invoice list' } } },
  },
  {
    name: 'finance_customer_balance',
    description: 'Get the balance for a specific customer (total paid, total invoiced, outstanding).',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/crm/contacts',
    parameters: {
      type: 'object',
      properties: {
        contactId: { type: 'string', description: 'Contact ID' },
      },
      required: ['contactId'],
    },
    outputSchema: { type: 'object', description: 'Customer balance', fields: { contactId: { type: 'string', description: 'Contact ID' }, totalInvoiced: { type: 'number', description: 'Total invoiced' }, totalPaid: { type: 'number', description: 'Total paid' }, outstanding: { type: 'number', description: 'Outstanding balance' }, invoiceCount: { type: 'number', description: 'Number of invoices' } } },
  },
  {
    name: 'finance_list_action_items',
    description: 'List finance action items (AI-detected anomalies, cashflow risks, missing receipts, etc.).',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/finance',
    parameters: {
      type: 'object',
      properties: {
        severity: { type: 'string', description: 'Filter by severity: INFO, WARNING, CRITICAL' },
        limit: { type: 'number', description: 'Max results (default 25)' },
      },
      required: [],
    },
    outputSchema: { type: 'object', description: 'Finance action items', fields: { items: { type: 'array', description: 'Action item rows' }, total: { type: 'number', description: 'Total count' } } },
  },

  // ================================================================
  //  FINANCE — BOOKKEEPING WRAPPERS (bank, COA, AP/bills, journal)
  // ================================================================
  {
    name: 'finance_list_bank_accounts',
    description: 'List connected financial/bank accounts with balances.',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/finance',
    parameters: { type: 'object', properties: {}, required: [] },
    outputSchema: { type: 'object', description: 'Bank accounts', fields: { accounts: { type: 'array', description: 'Account rows with balance info' } } },
  },
  {
    name: 'finance_auto_match_bank',
    description: 'Auto-match unmatched bank transactions against ledger entries (receipts/payments) for a bank account.',
    family: 'organize',
    riskLevel: 'medium',
    riskTier: 2 as RiskTier,
    manualEquivalentRoute: '/app/finance',
    changedEntities: ['bankTransaction'],
    parameters: {
      type: 'object',
      properties: {
        accountId: { type: 'string', description: 'Financial account ID to match transactions for' },
      },
      required: ['accountId'],
    },
    outputSchema: { type: 'object', description: 'Match summary', fields: { matched: { type: 'number', description: 'Transactions matched' }, reviewed: { type: 'number', description: 'Transactions needing review' } } },
  },
  {
    name: 'finance_list_coa',
    description: 'List the chart of accounts for the business.',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/finance',
    parameters: { type: 'object', properties: {}, required: [] },
    outputSchema: { type: 'object', description: 'Chart of accounts', fields: { accounts: { type: 'array', description: 'COA rows (code, name, type)' } } },
  },
  {
    name: 'finance_create_coa_account',
    description: 'Create a new account in the chart of accounts.',
    family: 'organize',
    riskLevel: 'medium',
    riskTier: 2 as RiskTier,
    manualEquivalentRoute: '/app/finance',
    changedEntities: ['chartOfAccount'],
    parameters: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Account code (e.g. 4000)' },
        name: { type: 'string', description: 'Account name' },
        type: { type: 'string', description: 'Account type: ASSET, LIABILITY, EQUITY, REVENUE, EXPENSE' },
        parentId: { type: 'string', description: 'Optional parent account ID' },
      },
      required: ['code', 'name', 'type'],
    },
    outputSchema: { type: 'object', description: 'Created account', fields: { id: { type: 'string', description: 'Account ID' }, code: { type: 'string', description: 'Account code' } } },
  },
  {
    name: 'finance_list_bills',
    description: 'List vendor bills (accounts payable) with status.',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/finance',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max results (default 50)' },
      },
      required: [],
    },
    outputSchema: { type: 'object', description: 'Bills list', fields: { bills: { type: 'array', description: 'Bill rows (vendor, amount, due date, status)' } } },
  },
  {
    name: 'finance_create_bill',
    description: 'Record a vendor bill (an expense to pay later).',
    family: 'organize',
    riskLevel: 'medium',
    riskTier: 2 as RiskTier,
    manualEquivalentRoute: '/app/finance',
    changedEntities: ['expense'],
    parameters: {
      type: 'object',
      properties: {
        description: { type: 'string', description: 'What the bill is for' },
        amount: { type: 'number', description: 'Bill amount' },
        currency: { type: 'string', description: 'Currency code (default business currency)' },
        dueDate: { type: 'string', description: 'Due date (ISO)' },
        vendor: { type: 'string', description: 'Vendor name' },
        notes: { type: 'string', description: 'Optional notes' },
        contactId: { type: 'string', description: 'Optional contact ID of the vendor' },
      },
      required: ['description', 'amount'],
    },
    outputSchema: { type: 'object', description: 'Created bill', fields: { id: { type: 'string', description: 'Bill ID' }, status: { type: 'string', description: 'Bill status' } } },
  },
  {
    name: 'finance_pay_bill',
    description: 'Mark a vendor bill as paid (records the payment).',
    family: 'execute',
    riskLevel: 'high',
    riskTier: 3 as RiskTier,
    manualEquivalentRoute: '/app/finance',
    changedEntities: ['expense', 'payment'],
    parameters: {
      type: 'object',
      properties: {
        billId: { type: 'string', description: 'Bill (expense) ID to pay' },
        paymentMethod: { type: 'string', description: 'Payment method note (e.g. bank transfer)' },
        paidAt: { type: 'string', description: 'Payment date (ISO, default now)' },
      },
      required: ['billId'],
    },
    outputSchema: { type: 'object', description: 'Paid bill', fields: { id: { type: 'string', description: 'Bill ID' }, status: { type: 'string', description: 'New status' } } },
  },
  {
    name: 'finance_view_payables',
    description: 'View accounts payable aging — outstanding bills grouped by overdue buckets, plus vendor balances.',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/finance',
    parameters: { type: 'object', properties: {}, required: [] },
    outputSchema: { type: 'object', description: 'AP aging + vendor balances', fields: { aging: { type: 'object', description: 'Aging buckets' }, vendors: { type: 'array', description: 'Vendor balance rows' } } },
  },
  {
    name: 'finance_post_journal_entry',
    description: 'Post a balanced double-entry journal entry (debits and credits must sum to the entry amount).',
    family: 'organize',
    riskLevel: 'high',
    riskTier: 3 as RiskTier,
    manualEquivalentRoute: '/app/finance',
    changedEntities: ['journalEntry', 'ledgerEntry'],
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Entry type: INCOME, EXPENSE, TRANSFER, REFUND, TAX, ADJUSTMENT, OPENING_BALANCE' },
        date: { type: 'string', description: 'Posting date (ISO)' },
        amount: { type: 'number', description: 'Total entry amount (each side)' },
        currency: { type: 'string', description: 'Currency code (optional)' },
        description: { type: 'string', description: 'Narration/memo' },
        entries: { type: 'array', description: 'Lines: [{ accountId, debit?, credit?, memo? }] — debits must equal credits' },
      },
      required: ['type', 'date', 'amount', 'entries'],
    },
    outputSchema: { type: 'object', description: 'Posted journal entry', fields: { id: { type: 'string', description: 'Journal entry ID' }, status: { type: 'string', description: 'Posting status' } } },
  },

  // ================================================================
  //  CONTRACTS / LEGAL — L1 Read / L2 Organize
  // ================================================================
  {
    name: 'contract_extract_terms',
    description: 'Run AI term extraction on a contract source document and apply the results to the contract record.',
    family: 'read',
    riskLevel: 'medium',
    riskTier: 2 as RiskTier,
    manualEquivalentRoute: '/app/contracts',
    changedEntities: ['contract'],
    parameters: {
      type: 'object',
      properties: {
        contractId: { type: 'string', description: 'Contract ID' },
        sourceAssetId: { type: 'string', description: 'Source business-asset ID (optional)' },
        sourceDocumentInstanceId: { type: 'string', description: 'Source document instance ID (optional)' },
        sourceDriveFileId: { type: 'string', description: 'Source Drive file ID (optional)' },
      },
      required: ['contractId'],
    },
    outputSchema: { type: 'object', description: 'Contract after extraction', fields: { contract: { type: 'object', description: 'Updated contract with extracted terms' } } },
  },
  {
    name: 'contract_list_tags',
    description: 'List contract tags/labels.',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/contracts',
    parameters: { type: 'object', properties: {}, required: [] },
    outputSchema: { type: 'object', description: 'Contract tags', fields: { tags: { type: 'array', description: 'Tag rows' } } },
  },
  {
    name: 'contract_create_tag',
    description: 'Create a contract tag/label.',
    family: 'organize',
    riskLevel: 'low',
    riskTier: 2 as RiskTier,
    manualEquivalentRoute: '/app/contracts',
    changedEntities: ['contractTag'],
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Tag name' },
        color: { type: 'string', description: 'Optional hex color' },
      },
      required: ['name'],
    },
    outputSchema: { type: 'object', description: 'Created tag', fields: { id: { type: 'string', description: 'Tag ID' }, name: { type: 'string', description: 'Tag name' } } },
  },

  // ================================================================
  //  SUPPORT & COMMS — L2 Organize / L3 Execute
  // ================================================================
  {
    name: 'helpdesk_reply_to_ticket',
    description: 'Reply to a customer on a support ticket (records the outbound message on the ticket thread).',
    family: 'organize',
    riskLevel: 'medium',
    riskTier: 2 as RiskTier,
    manualEquivalentRoute: '/app/helpdesk',
    changedEntities: ['supportTicketMessage', 'supportTicket'],
    parameters: {
      type: 'object',
      properties: {
        ticketId: { type: 'string', description: 'Ticket ID' },
        body: { type: 'string', description: 'Reply text to send the customer' },
        channel: { type: 'string', description: 'Channel: internal, email, whatsapp (default internal)' },
      },
      required: ['ticketId', 'body'],
    },
    outputSchema: { type: 'object', description: 'Recorded reply', fields: { id: { type: 'string', description: 'Message ID' }, ticketId: { type: 'string', description: 'Ticket ID' } } },
  },
  {
    name: 'helpdesk_draft_reply',
    description: 'Draft a suggested reply for a support ticket, grounded in the ticket details and thread history. Returns text for review ONLY — nothing is sent (use helpdesk_reply_to_ticket to send).',
    family: 'draft',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/helpdesk',
    parameters: {
      type: 'object',
      properties: {
        ticketId: { type: 'string', description: 'Ticket ID' },
        tone: { type: 'string', description: 'Tone: friendly, professional, apologetic (default professional)' },
      },
      required: ['ticketId'],
    },
    outputSchema: { type: 'object', description: 'Draft reply', fields: { body: { type: 'string', description: 'Suggested reply text' }, ticketTitle: { type: 'string', description: 'Ticket title' } } },
  },
  {
    name: 'helpdesk_delete_ticket',
    description: 'Soft-delete a support ticket (spam, test, or duplicate). The ticket disappears from all lists and counts. Irreversible from chat.',
    family: 'execute',
    riskLevel: 'high',
    riskTier: 3 as RiskTier,
    manualEquivalentRoute: '/app/helpdesk',
    changedEntities: ['supportTicket'],
    parameters: {
      type: 'object',
      properties: {
        ticketId: { type: 'string', description: 'Ticket ID' },
      },
      required: ['ticketId'],
    },
    outputSchema: { type: 'object', description: 'Deleted ticket', fields: { id: { type: 'string', description: 'Ticket ID' }, deleted: { type: 'boolean', description: 'Deletion confirmed' } } },
  },
  {
    name: 'comms_send_broadcast',
    description: 'Broadcast a message to a customer segment over email, WhatsApp, or SMS.',
    family: 'execute',
    riskLevel: 'high',
    riskTier: 3 as RiskTier,
    manualEquivalentRoute: '/app/marketing',
    changedEntities: ['message'],
    parameters: {
      type: 'object',
      properties: {
        segment: { type: 'string', description: 'Segment identifier (e.g. all, active_customers, overdue)' },
        channel: { type: 'string', description: 'Channel: email, whatsapp, sms' },
        body: { type: 'string', description: 'Message body' },
        templateId: { type: 'string', description: 'Optional template ID' },
      },
      required: ['segment', 'channel', 'body'],
    },
    outputSchema: { type: 'object', description: 'Broadcast result', fields: { sent: { type: 'number', description: 'Messages sent' }, failed: { type: 'number', description: 'Failures' } } },
  },
  {
    name: 'inbox_reply_thread',
    description: 'Send a reply inside an omnichannel inbox thread (WhatsApp/email/SMS) to the customer.',
    family: 'execute',
    riskLevel: 'high',
    riskTier: 3 as RiskTier,
    manualEquivalentRoute: '/app/key-inbox',
    changedEntities: ['keyInboxMessage'],
    parameters: {
      type: 'object',
      properties: {
        threadId: { type: 'string', description: 'Inbox thread ID' },
        body: { type: 'string', description: 'Reply text' },
      },
      required: ['threadId', 'body'],
    },
    outputSchema: { type: 'object', description: 'Reply result', fields: { sent: { type: 'boolean', description: 'Whether the reply was delivered' }, messageId: { type: 'string', description: 'Message ID' } } },
  },
  {
    name: 'inbox_update_thread_status',
    description: 'Update an inbox thread status or priority (triage, escalate, close).',
    family: 'organize',
    riskLevel: 'low',
    riskTier: 2 as RiskTier,
    manualEquivalentRoute: '/app/key-inbox',
    changedEntities: ['keyInboxThread'],
    parameters: {
      type: 'object',
      properties: {
        threadId: { type: 'string', description: 'Inbox thread ID' },
        status: { type: 'string', description: 'Status: OPEN, WAITING, DONE, ARCHIVED' },
        priority: { type: 'string', description: 'Priority: LOW, NORMAL, HIGH, URGENT' },
      },
      required: ['threadId'],
    },
    outputSchema: { type: 'object', description: 'Updated thread', fields: { id: { type: 'string', description: 'Thread ID' }, status: { type: 'string', description: 'New status' } } },
  },

  // ================================================================
  //  CRM / SALES & MISC — L1 Read / L2 Organize
  // ================================================================
  {
    name: 'crm_list_deals',
    description: 'List pipeline deals with stage and value.',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/crm/deals',
    parameters: {
      type: 'object',
      properties: {
        stageId: { type: 'string', description: 'Filter by pipeline stage ID' },
        limit: { type: 'number', description: 'Max results (default 25)' },
      },
      required: [],
    },
    outputSchema: { type: 'object', description: 'Deals list', fields: { deals: { type: 'array', description: 'Deal rows' } } },
  },
  {
    name: 'crm_update_deal',
    description: 'Update a deal (title, value, company, owner, description).',
    family: 'crud',
    riskLevel: 'medium',
    riskTier: 2 as RiskTier,
    manualEquivalentRoute: '/app/crm/deals',
    changedEntities: ['deal'],
    parameters: {
      type: 'object',
      properties: {
        dealId: { type: 'string', description: 'Deal ID' },
        title: { type: 'string', description: 'New title' },
        value: { type: 'number', description: 'Deal value' },
        companyName: { type: 'string', description: 'Company name' },
        ownerUserId: { type: 'string', description: 'Owner user ID' },
        description: { type: 'string', description: 'Description' },
      },
      required: ['dealId'],
    },
    outputSchema: { type: 'object', description: 'Updated deal', fields: { id: { type: 'string', description: 'Deal ID' }, title: { type: 'string', description: 'Deal title' } } },
  },
  {
    name: 'crm_move_deal_stage',
    description: 'Move a deal to a different pipeline stage.',
    family: 'organize',
    riskLevel: 'medium',
    riskTier: 2 as RiskTier,
    manualEquivalentRoute: '/app/crm/deals',
    changedEntities: ['deal'],
    parameters: {
      type: 'object',
      properties: {
        dealId: { type: 'string', description: 'Deal ID' },
        stageId: { type: 'string', description: 'Target stage ID' },
      },
      required: ['dealId', 'stageId'],
    },
    outputSchema: { type: 'object', description: 'Moved deal', fields: { id: { type: 'string', description: 'Deal ID' }, stageId: { type: 'string', description: 'New stage ID' } } },
  },
  {
    name: 'crm_find_duplicates',
    description: 'Find duplicate contact candidates in the CRM.',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/crm/duplicates',
    parameters: {
      type: 'object',
      properties: {
        minConfidence: { type: 'number', description: 'Minimum confidence 0-1 (default 0.6)' },
        limit: { type: 'number', description: 'Max pairs (default 20)' },
      },
      required: [],
    },
    outputSchema: { type: 'object', description: 'Duplicate pairs', fields: { pairs: { type: 'array', description: 'Duplicate candidate pairs' }, total: { type: 'number', description: 'Total found' } } },
  },
  {
    name: 'crm_merge_preview',
    description: 'Preview what merging a duplicate contact into a primary contact would move (before executing).',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/crm/duplicates',
    parameters: {
      type: 'object',
      properties: {
        primaryId: { type: 'string', description: 'Primary (surviving) contact ID' },
        duplicateId: { type: 'string', description: 'Duplicate contact ID' },
      },
      required: ['primaryId', 'duplicateId'],
    },
    outputSchema: { type: 'object', description: 'Merge preview', fields: { preview: { type: 'object', description: 'What the merge would affect' } } },
  },
  {
    name: 'crm_merge_execute',
    description: 'Execute a contact merge: consolidates tags, lead score, and linked records from the duplicate into the primary contact, then retires the duplicate. Irreversible — always run crm_merge_preview first and confirm with the user.',
    family: 'execute',
    riskLevel: 'high',
    riskTier: 3 as RiskTier,
    manualEquivalentRoute: '/app/crm/duplicates',
    changedEntities: ['contact'],
    parameters: {
      type: 'object',
      properties: {
        primaryId: { type: 'string', description: 'Primary (surviving) contact ID' },
        duplicateId: { type: 'string', description: 'Duplicate contact ID to merge in and retire' },
        fieldOverrides: { type: 'object', description: 'Optional per-field overrides applied to the surviving contact' },
      },
      required: ['primaryId', 'duplicateId'],
    },
    outputSchema: { type: 'object', description: 'Merge result', fields: { result: { type: 'object', description: 'Merge outcome from the CRM service' } } },
  },
  {
    name: 'social_get_analytics',
    description: 'Social media analytics overview: followers, engagement, and post performance across connected platforms.',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/marketing',
    parameters: { type: 'object', properties: {}, required: [] },
    outputSchema: { type: 'object', description: 'Social analytics overview', fields: { overview: { type: 'object', description: 'Aggregated metrics' } } },
  },
  {
    name: 'bookings_mark_no_show',
    description: 'Mark a booking as a no-show (customer did not arrive).',
    family: 'organize',
    riskLevel: 'medium',
    riskTier: 2 as RiskTier,
    manualEquivalentRoute: '/app/bookings',
    changedEntities: ['booking'],
    parameters: {
      type: 'object',
      properties: {
        bookingId: { type: 'string', description: 'Booking ID' },
      },
      required: ['bookingId'],
    },
    outputSchema: { type: 'object', description: 'No-show booking', fields: { id: { type: 'string', description: 'Booking ID' }, status: { type: 'string', description: 'New status' } } },
  },
  {
    name: 'projects_get_budget',
    description: 'Get a project budget vs actuals breakdown.',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/projects',
    parameters: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Project ID' },
      },
      required: ['projectId'],
    },
    outputSchema: { type: 'object', description: 'Project budget', fields: { budget: { type: 'object', description: 'Budget vs actuals' } } },
  },
  {
    name: 'projects_get_timeline',
    description: 'Get a project timeline with milestones.',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/projects',
    parameters: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Project ID' },
      },
      required: ['projectId'],
    },
    outputSchema: { type: 'object', description: 'Project timeline', fields: { timeline: { type: 'object', description: 'Timeline and milestones' } } },
  },
  {
    name: 'time_update_entry',
    description: 'Edit a logged time entry (duration, notes, billable).',
    family: 'crud',
    riskLevel: 'medium',
    riskTier: 2 as RiskTier,
    manualEquivalentRoute: '/app/time-tracking',
    changedEntities: ['timeEntry'],
    parameters: {
      type: 'object',
      properties: {
        entryId: { type: 'string', description: 'Time entry ID' },
        durationMinutes: { type: 'number', description: 'New duration in minutes' },
        notes: { type: 'string', description: 'New notes' },
        billable: { type: 'boolean', description: 'Mark billable or not' },
      },
      required: ['entryId'],
    },
    outputSchema: { type: 'object', description: 'Updated time entry', fields: { id: { type: 'string', description: 'Entry ID' } } },
  },
  {
    name: 'time_mark_billed',
    description: 'Mark time entries as billed (linked to an invoice).',
    family: 'organize',
    riskLevel: 'medium',
    riskTier: 2 as RiskTier,
    manualEquivalentRoute: '/app/time-tracking',
    changedEntities: ['timeEntry'],
    parameters: {
      type: 'object',
      properties: {
        entryIds: { type: 'array', description: 'Time entry IDs to mark billed' },
        invoiceId: { type: 'string', description: 'Invoice ID to link' },
      },
      required: ['entryIds', 'invoiceId'],
    },
    outputSchema: { type: 'object', description: 'Billed entries', fields: { updated: { type: 'number', description: 'Entries updated' } } },
  },
  {
    name: 'commerce_convert_quote',
    description: 'Convert an accepted quote into an invoice.',
    family: 'organize',
    riskLevel: 'medium',
    riskTier: 2 as RiskTier,
    manualEquivalentRoute: '/app/commerce',
    changedEntities: ['quote', 'invoice'],
    parameters: {
      type: 'object',
      properties: {
        quoteId: { type: 'string', description: 'Quote ID to convert' },
      },
      required: ['quoteId'],
    },
    outputSchema: { type: 'object', description: 'Created invoice', fields: { invoiceId: { type: 'string', description: 'New invoice ID' } } },
  },

  // ================================================================
  //  FALLBACK EXECUTOR — L3 Execute (approval-gated)
  // ================================================================
  {
    name: 'execute_custom_logic',
    description: 'Write and run a small JavaScript snippet to accomplish a task no dedicated tool covers (calculations, multi-step data transforms, one-off reports). The snippet runs in a sandbox with an `api` object: `await api.callTool(name, args)` calls any tier 1-2 KEY tool, `api.log(...)` prints output. Return the final answer as the snippet value. Max 10 tool calls, 15s limit.',
    family: 'execute',
    riskLevel: 'high',
    riskTier: 3 as RiskTier,
    manualEquivalentRoute: '/app/key/chat',
    changedEntities: [],
    parameters: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'JavaScript snippet body (async). Has `api.callTool` and `api.log`. Max 8000 chars.' },
        inputs: { type: 'object', description: 'Optional small input values for the snippet' },
      },
      required: ['code'],
    },
    outputSchema: { type: 'object', description: 'Execution result', fields: { ok: { type: 'boolean', description: 'Whether it ran' }, value: { type: 'string', description: 'Returned value' }, error: { type: 'string', description: 'Error if failed' }, logs: { type: 'array', description: 'Log lines' }, toolCalls: { type: 'number', description: 'Tool calls made' } } },
  },

  // ================================================================
  //  PAYROLL — L1 Read / L2 Organize / L3 Execute
  // ================================================================
  {
    name: 'payroll_list_rates',
    description: 'List current pay rates per staff position (latest effective rate per assignment).',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/structure',
    parameters: { type: 'object', properties: {}, required: [] },
    outputSchema: { type: 'object', description: 'Pay rates', fields: { rates: { type: 'array', description: 'Rate rows (staff, amount, currency, period type)' } } },
  },
  {
    name: 'payroll_set_rate',
    description: 'Set a staff member\'s pay rate (hourly or monthly salary).',
    family: 'organize',
    riskLevel: 'medium',
    riskTier: 2 as RiskTier,
    manualEquivalentRoute: '/app/payroll',
    changedEntities: ['payRate'],
    parameters: {
      type: 'object',
      properties: {
        assignmentId: { type: 'string', description: 'OrgAssignment (staff position) ID' },
        amount: { type: 'number', description: 'Rate amount (per hour if hourly, per month if monthly)' },
        currency: { type: 'string', description: 'Currency code (default business currency)' },
        periodType: { type: 'string', description: 'hourly or monthly (default hourly)' },
      },
      required: ['assignmentId', 'amount'],
    },
    outputSchema: { type: 'object', description: 'Created rate', fields: { id: { type: 'string', description: 'Rate ID' }, amount: { type: 'number', description: 'Rate amount' } } },
  },
  {
    name: 'payroll_generate_run',
    description: 'Generate a draft payroll run for a period: hourly staff get logged billable hours × rate, salaried staff get their monthly rate.',
    family: 'execute',
    riskLevel: 'high',
    riskTier: 3 as RiskTier,
    manualEquivalentRoute: '/app/payroll',
    changedEntities: ['payrollRun', 'payrollItem'],
    parameters: {
      type: 'object',
      properties: {
        periodStart: { type: 'string', description: 'Period start (ISO date)' },
        periodEnd: { type: 'string', description: 'Period end (ISO date)' },
        notes: { type: 'string', description: 'Optional notes for the run' },
      },
      required: ['periodStart', 'periodEnd'],
    },
    outputSchema: { type: 'object', description: 'Generated run', fields: { id: { type: 'string', description: 'Run ID' }, totalGross: { type: 'number', description: 'Total gross pay' }, itemCount: { type: 'number', description: 'Staff items' } } },
  },
  {
    name: 'payroll_list_runs',
    description: 'List payroll runs with status and totals.',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/finance',
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Filter: DRAFT, APPROVED, PAID, VOID' },
        limit: { type: 'number', description: 'Max results (default 20)' },
      },
      required: [],
    },
    outputSchema: { type: 'object', description: 'Payroll runs', fields: { runs: { type: 'array', description: 'Run rows' } } },
  },
  {
    name: 'payroll_get_run',
    description: 'Get a payroll run with per-staff line items (hours worked, gross pay).',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/finance',
    parameters: {
      type: 'object',
      properties: {
        runId: { type: 'string', description: 'Payroll run ID' },
      },
      required: ['runId'],
    },
    outputSchema: { type: 'object', description: 'Run detail', fields: { run: { type: 'object', description: 'Run with items' } } },
  },
  {
    name: 'payroll_approve_run',
    description: 'Approve a draft payroll run (locks it for payment).',
    family: 'execute',
    riskLevel: 'high',
    riskTier: 3 as RiskTier,
    manualEquivalentRoute: '/app/payroll',
    changedEntities: ['payrollRun'],
    parameters: {
      type: 'object',
      properties: {
        runId: { type: 'string', description: 'Payroll run ID' },
      },
      required: ['runId'],
    },
    outputSchema: { type: 'object', description: 'Approved run', fields: { id: { type: 'string', description: 'Run ID' }, status: { type: 'string', description: 'New status' } } },
  },
  {
    name: 'payroll_mark_paid',
    description: 'Mark an approved payroll run as paid.',
    family: 'execute',
    riskLevel: 'high',
    riskTier: 3 as RiskTier,
    manualEquivalentRoute: '/app/payroll',
    changedEntities: ['payrollRun'],
    parameters: {
      type: 'object',
      properties: {
        runId: { type: 'string', description: 'Payroll run ID' },
      },
      required: ['runId'],
    },
    outputSchema: { type: 'object', description: 'Paid run', fields: { id: { type: 'string', description: 'Run ID' }, status: { type: 'string', description: 'New status' } } },
  },

  // ================================================================
  //  STAFF PERFORMANCE — L1 Read / L2 Organize
  // ================================================================
  {
    name: 'performance_scorecard',
    description: 'Compute a staff member\'s performance scorecard for a period: on-time task completion, hours utilization, approval responsiveness, and an overall score (0-100).',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/structure',
    parameters: {
      type: 'object',
      properties: {
        assignmentId: { type: 'string', description: 'OrgAssignment (staff position) ID' },
        periodStart: { type: 'string', description: 'Period start (ISO)' },
        periodEnd: { type: 'string', description: 'Period end (ISO)' },
      },
      required: ['assignmentId', 'periodStart', 'periodEnd'],
    },
    outputSchema: { type: 'object', description: 'Performance scorecard', fields: { overallScore: { type: 'number', description: 'Overall score 0-100' }, utilizationPct: { type: 'number', description: 'Hours utilization %' } } },
  },
  {
    name: 'performance_team_summary',
    description: 'Performance scorecards for every active staff position over a period, ranked by overall score.',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/structure',
    parameters: {
      type: 'object',
      properties: {
        periodStart: { type: 'string', description: 'Period start (ISO)' },
        periodEnd: { type: 'string', description: 'Period end (ISO)' },
      },
      required: ['periodStart', 'periodEnd'],
    },
    outputSchema: { type: 'object', description: 'Team performance summary', fields: { cards: { type: 'array', description: 'Scorecards ranked by score' } } },
  },
  {
    name: 'performance_take_snapshot',
    description: 'Persist a performance snapshot for a staff member over a period (enables trend history).',
    family: 'organize',
    riskLevel: 'low',
    riskTier: 2 as RiskTier,
    manualEquivalentRoute: '/app/performance',
    changedEntities: ['staffPerformanceSnapshot'],
    parameters: {
      type: 'object',
      properties: {
        assignmentId: { type: 'string', description: 'OrgAssignment (staff position) ID' },
        periodStart: { type: 'string', description: 'Period start (ISO)' },
        periodEnd: { type: 'string', description: 'Period end (ISO)' },
      },
      required: ['assignmentId', 'periodStart', 'periodEnd'],
    },
    outputSchema: { type: 'object', description: 'Saved snapshot', fields: { id: { type: 'string', description: 'Snapshot ID' }, overallScore: { type: 'number', description: 'Overall score' } } },
  },
  {
    name: 'performance_trend',
    description: 'Get a staff member\'s performance trend from saved snapshots (recent periods first).',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/structure',
    parameters: {
      type: 'object',
      properties: {
        assignmentId: { type: 'string', description: 'OrgAssignment (staff position) ID' },
        limit: { type: 'number', description: 'Max periods (default 8)' },
      },
      required: ['assignmentId'],
    },
    outputSchema: { type: 'object', description: 'Performance trend', fields: { trend: { type: 'array', description: 'Period score rows' } } },
  },

  // ================================================================
  //  SEQUENCES / DUNNING — L1 Read / L2 Organize / L3 Execute
  // ================================================================
  {
    name: 'sequence_list',
    description: 'List outreach sequences (cadences) with enrollment counts.',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/crm/sequences',
    parameters: { type: 'object', properties: {}, required: [] },
    outputSchema: { type: 'object', description: 'Sequences list', fields: { sequences: { type: 'array', description: 'Sequence rows' } } },
  },
  {
    name: 'sequence_create',
    description: 'Create an outreach sequence (a cadence of timed steps: email, whatsapp, sms, call, or wait).',
    family: 'organize',
    riskLevel: 'medium',
    riskTier: 2 as RiskTier,
    manualEquivalentRoute: '/app/crm/sequences',
    changedEntities: ['crmSequence'],
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Sequence name' },
        description: { type: 'string', description: 'What this cadence is for' },
        status: { type: 'string', description: 'draft, active, or paused (default draft)' },
        steps: { type: 'array', description: 'Steps: [{stepNumber, type: email|whatsapp|sms|call|wait, delayDays, subject?, body?}]' },
      },
      required: ['name', 'steps'],
    },
    outputSchema: { type: 'object', description: 'Created sequence', fields: { id: { type: 'string', description: 'Sequence ID' }, name: { type: 'string', description: 'Sequence name' } } },
  },
  {
    name: 'sequence_enroll',
    description: 'Enroll contacts into a sequence (starts the cadence for them).',
    family: 'execute',
    riskLevel: 'high',
    riskTier: 3 as RiskTier,
    manualEquivalentRoute: '/app/crm/sequences',
    changedEntities: ['crmSequenceEnrollment'],
    parameters: {
      type: 'object',
      properties: {
        sequenceId: { type: 'string', description: 'Sequence ID' },
        contactIds: { type: 'array', description: 'Contact IDs to enroll' },
      },
      required: ['sequenceId', 'contactIds'],
    },
    outputSchema: { type: 'object', description: 'Enrollment result', fields: { enrolled: { type: 'number', description: 'Contacts enrolled' }, skipped: { type: 'number', description: 'Already enrolled' } } },
  },
  {
    name: 'sequence_enroll_overdue',
    description: 'Collections dunning: enroll every contact with an overdue invoice into a sequence.',
    family: 'execute',
    riskLevel: 'high',
    riskTier: 3 as RiskTier,
    manualEquivalentRoute: '/app/crm/sequences',
    changedEntities: ['crmSequenceEnrollment'],
    parameters: {
      type: 'object',
      properties: {
        sequenceId: { type: 'string', description: 'Dunning sequence ID' },
        minDaysOverdue: { type: 'number', description: 'Minimum days overdue (default 1)' },
        limit: { type: 'number', description: 'Max contacts (default 50)' },
      },
      required: ['sequenceId'],
    },
    outputSchema: { type: 'object', description: 'Dunning enrollment result', fields: { enrolled: { type: 'number', description: 'Contacts enrolled' } } },
  },
  {
    name: 'sequence_unenroll',
    description: 'Remove a contact from a sequence (stops their cadence).',
    family: 'organize',
    riskLevel: 'medium',
    riskTier: 2 as RiskTier,
    manualEquivalentRoute: '/app/crm/sequences',
    changedEntities: ['crmSequenceEnrollment'],
    parameters: {
      type: 'object',
      properties: {
        enrollmentId: { type: 'string', description: 'Enrollment ID to stop' },
      },
      required: ['enrollmentId'],
    },
    outputSchema: { type: 'object', description: 'Stopped enrollment', fields: { id: { type: 'string', description: 'Enrollment ID' } } },
  },
  {
    name: 'sequence_pause_resume',
    description: 'Pause or resume a sequence.',
    family: 'organize',
    riskLevel: 'medium',
    riskTier: 2 as RiskTier,
    manualEquivalentRoute: '/app/crm/sequences',
    changedEntities: ['crmSequence'],
    parameters: {
      type: 'object',
      properties: {
        sequenceId: { type: 'string', description: 'Sequence ID' },
        status: { type: 'string', description: 'active or paused' },
      },
      required: ['sequenceId', 'status'],
    },
    outputSchema: { type: 'object', description: 'Updated sequence', fields: { id: { type: 'string', description: 'Sequence ID' }, status: { type: 'string', description: 'New status' } } },
  },

  {
    name: 'contract_extract_clauses',
    description: 'Run a 41-label CUAD clause analysis on a contract\'s source document: which standard clauses are present (with summaries + source snippets) and which critical ones are missing.',
    family: 'read',
    riskLevel: 'medium',
    riskTier: 2 as RiskTier,
    manualEquivalentRoute: '/app/contracts',
    changedEntities: ['contract'],
    parameters: {
      type: 'object',
      properties: {
        contractId: { type: 'string', description: 'Contract ID' },
        url: { type: 'string', description: 'Optional document URL to analyze instead of the linked source' },
      },
      required: ['contractId'],
    },
    outputSchema: { type: 'object', description: 'Clause analysis', fields: { total: { type: 'number', description: 'Labels analyzed' }, present: { type: 'array', description: 'Present clauses' }, notableAbsent: { type: 'array', description: 'Critical missing clauses' } } },
  },

  // ================================================================
  //  PROJECT UPDATE/DELETE — L2 Organize / L3 Execute
  // ================================================================
  {
    name: 'projects_update_task',
    description: 'Update a project task title, due date, priority, completion status, or reassign it to a different user or staff member (e.g. to rebalance workload when someone is overloaded).',
    family: 'crud',
    riskLevel: 'medium',
    riskTier: 2 as RiskTier,
    manualEquivalentRoute: '/app/projects',
    changedEntities: ['projectTask', 'taskAssignment'],
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'Task ID' },
        title: { type: 'string', description: 'New title' },
        dueDate: { type: 'string', description: 'New due date (ISO)' },
        priority: { type: 'string', description: 'Priority: LOW, NORMAL, HIGH, URGENT' },
        isCompleted: { type: 'boolean', description: 'Mark as completed' },
        assigneeId: { type: 'string', description: 'User or StaffMember ID to reassign the task to. Pass an empty string to unassign.' },
      },
      required: ['taskId'],
    },
    outputSchema: { type: 'object', description: 'Updated task', fields: { id: { type: 'string', description: 'Task ID' }, title: { type: 'string', description: 'Task title' }, assigneeId: { type: 'string', description: 'New assignee ID' } } },
  },
  {
    name: 'projects_delete_task',
    description: 'Soft-delete a project task.',
    family: 'crud',
    riskLevel: 'medium',
    riskTier: 3 as RiskTier,
    manualEquivalentRoute: '/app/projects',
    changedEntities: ['projectTask'],
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'Task ID to delete' },
      },
      required: ['taskId'],
    },
    outputSchema: { type: 'object', description: 'Deleted task', fields: { success: { type: 'boolean', description: 'Success flag' }, deletedId: { type: 'string', description: 'Deleted task ID' } } },
  },

  // ================================================================
  //  COMMERCE UPDATE/DELETE — L2 Organize / L3 Execute
  // ================================================================
  {
    name: 'commerce_update_invoice',
    description: 'Update an existing invoice (status, due date, notes). Does NOT modify line items.',
    family: 'crud',
    riskLevel: 'medium',
    riskTier: 2 as RiskTier,
    manualEquivalentRoute: '/app/commerce',
    changedEntities: ['invoice'],
    parameters: {
      type: 'object',
      properties: {
        invoiceId: { type: 'string', description: 'Invoice ID' },
        status: { type: 'string', description: 'New status: DRAFT, SENT, PAID, OVERDUE, CANCELLED' },
        dueDate: { type: 'string', description: 'New due date (ISO)' },
        notes: { type: 'string', description: 'New notes' },
      },
      required: ['invoiceId'],
    },
    outputSchema: { type: 'object', description: 'Updated invoice', fields: { id: { type: 'string', description: 'Invoice ID' }, status: { type: 'string', description: 'Updated status' } } },
  },
  {
    name: 'commerce_update_product',
    description: 'Update a product name, price, description, category, or active status.',
    family: 'crud',
    riskLevel: 'medium',
    riskTier: 2 as RiskTier,
    manualEquivalentRoute: '/app/store',
    changedEntities: ['product'],
    parameters: {
      type: 'object',
      properties: {
        productId: { type: 'string', description: 'Product ID' },
        name: { type: 'string', description: 'New name' },
        price: { type: 'number', description: 'New price' },
        description: { type: 'string', description: 'New description' },
        category: { type: 'string', description: 'New category' },
        isActive: { type: 'boolean', description: 'Active status' },
      },
      required: ['productId'],
    },
    outputSchema: { type: 'object', description: 'Updated product', fields: { id: { type: 'string', description: 'Product ID' }, name: { type: 'string', description: 'Product name' }, fieldsUpdated: { type: 'array', description: 'Fields that were changed' } } },
  },
  {
    name: 'commerce_send_invoice',
    description: 'Send an invoice to the customer via email (marks status as SENT).',
    family: 'execute',
    riskLevel: 'high',
    riskTier: 3 as RiskTier,
    manualEquivalentRoute: '/app/commerce',
    changedEntities: ['invoice'],
    parameters: {
      type: 'object',
      properties: {
        invoiceId: { type: 'string', description: 'Invoice ID' },
        message: { type: 'string', description: 'Optional custom message' },
      },
      required: ['invoiceId'],
    },
    outputSchema: { type: 'object', description: 'Sent invoice', fields: { id: { type: 'string', description: 'Invoice ID' }, status: { type: 'string', description: 'Updated status' } } },
  },

  // ================================================================
  //  MARKETING/SOCIAL UPDATES — L2 Organize / L3 Execute
  // ================================================================
  {
    name: 'marketing_update_campaign',
    description: 'Update an email campaign name, subject, body, or scheduled send date.',
    family: 'crud',
    riskLevel: 'medium',
    riskTier: 2 as RiskTier,
    manualEquivalentRoute: '/app/marketing',
    changedEntities: ['emailCampaign'],
    parameters: {
      type: 'object',
      properties: {
        campaignId: { type: 'string', description: 'Campaign ID' },
        name: { type: 'string', description: 'New name' },
        subject: { type: 'string', description: 'New subject' },
        body: { type: 'string', description: 'New body' },
        scheduledAt: { type: 'string', description: 'New scheduled send date (ISO)' },
      },
      required: ['campaignId'],
    },
    outputSchema: { type: 'object', description: 'Updated campaign', fields: { id: { type: 'string', description: 'Campaign ID' }, name: { type: 'string', description: 'Campaign name' } } },
  },
  {
    name: 'social_update_post',
    description: 'Update a social post content or scheduled time.',
    family: 'crud',
    riskLevel: 'medium',
    riskTier: 2 as RiskTier,
    manualEquivalentRoute: '/app/marketing',
    changedEntities: ['socialPost'],
    parameters: {
      type: 'object',
      properties: {
        postId: { type: 'string', description: 'Post ID' },
        content: { type: 'string', description: 'New content' },
        scheduledFor: { type: 'string', description: 'New scheduled date (ISO)' },
      },
      required: ['postId'],
    },
    outputSchema: { type: 'object', description: 'Updated post', fields: { id: { type: 'string', description: 'Post ID' }, status: { type: 'string', description: 'Post status' } } },
  },
  {
    name: 'present_onboarding_card',
    description: 'Use this tool when the user is on the onboarding page and you want to show a structured, interactive card instead of asking open-ended questions. Pick the card that matches the next onboarding milestone: welcome, profile-identity, genesis-idea, operating-model, brand-goals, financials, ownership-legal, operations, market-strategy, risk-compliance-roadmap, genesis-questions, readiness-dashboard, template-picker, payments-storefront-contacts, or completion-gate. If unsure, use cardType "next" and the system will choose based on the business setup state.',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/onboarding',
    changedEntities: [],
    parameters: {
      type: 'object',
      properties: {
        cardType: {
          type: 'string',
          description: 'Which onboarding card to present. Use "next" to let the backend decide.',
          enum: ['next', 'welcome', 'profile-identity', 'genesis-idea', 'operating-model', 'brand-goals', 'financials', 'ownership-legal', 'operations', 'market-strategy', 'risk-compliance-roadmap', 'genesis-questions', 'readiness-dashboard', 'template-picker', 'payments-storefront-contacts', 'completion-gate'],
        },
        step: {
          type: 'string',
          description: 'Optional onboarding step hint (e.g. "intake", "genesis", "template", "configure", "complete").',
        },
      },
      required: ['cardType'],
    },
    outputSchema: { type: 'object', description: 'Card payload for the frontend onboarding renderer', fields: { type: { type: 'string', description: 'Card type' }, title: { type: 'string', description: 'Card title' }, data: { type: 'object', description: 'Optional card data' } } },
  },
  {
    name: 'save_onboarding_step',
    description: 'Persist the current onboarding milestone step on the server. Use this when the user has completed the work for a milestone and should advance.',
    family: 'organize',
    riskLevel: 'low',
    riskTier: 2 as RiskTier,
    manualEquivalentRoute: '/app/onboarding',
    changedEntities: ['business'],
    parameters: {
      type: 'object',
      properties: {
        step: {
          type: 'string',
          description: 'The onboarding step to save: welcome, intake, genesis, template, configure, genome, complete.',
        },
      },
      required: ['step'],
    },
    outputSchema: { type: 'object', description: 'Saved onboarding state', fields: { step: { type: 'string', description: 'Saved step' }, onboardingComplete: { type: 'boolean', description: 'Whether onboarding is marked complete' } } },
  },

  {
    name: 'update_business_blueprint',
    description: 'ALWAYS use this tool first when the user shares any business fact while the Business Genome is incomplete. Update the Business Blueprint (Business Genome) with structured facts learned during conversation. Wrap all section updates under a single "patch" key. Supported sections: identity (name, industry, archetype, country), operatingModel (revenueModel, deliveryMode, serviceArea, channels, teamSize, capacity), goals (northStar, ninetyDayGoals, twelveMonthGoals), constraints (budgetRange, timeCommitment, riskTolerance), brand (voice, tone, valueProps, doNotSay), customerModel (idealCustomer, segments, painPoints), financials (currency, pricingModel, avgTicket, monthlyTarget), projectionProfile (startupCapital, startupCosts, monthlyFixedCosts, variableCostPercent), legalProfile (country, recommendedEntityType, regulatedIndustry), registrationProfile (companiesRegistryStatus, birStatus, nisEmployerStatus, vatStatus, businessBankStatus), ownershipProfile (hasPartners, owners), marketProfile (targetGeography, marketCategory, marketStage, trends, barriersToEntry), offerArchitecture (coreOffer, offerLadder, pricingTiers, upsells), salesSystem (salesChannels, pipelineStages), marketingSystem (channels, contentPillars, launchPlan), operationsSystem (coreWorkflows, dailyChecklist, weeklyChecklist, fulfillmentProcess, customerSupportProcess, vendorProcess), riskProfile (financialRisks, legalRisks, marketRisks, operationalRisks, founderRisks, mitigationPlan), complianceProfile (complianceItems), executionRoadmap (today, sevenDayPlan, thirtyDayPlan), workflowModel, aiPreferences. Example call arguments: {"patch": {"identity": {"industry": "software"}, "operatingModel": {"revenueModel": "subscription"}}}.',
    family: 'crud',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/blueprint',
    changedEntities: ['businessBlueprint'],
    parameters: {
      type: 'object',
      properties: {
        patch: {
          type: 'object',
          description: 'Blueprint patch. Top-level keys are section names: identity, operatingModel, goals, constraints, brand, customerModel, financials, workflowModel, aiPreferences. Values are objects containing the fields to update.',
        },
      },
      required: ['patch'],
    },
    outputSchema: { type: 'object', description: 'Updated blueprint summary', fields: { completeness: { type: 'number', description: 'New completeness percentage 0-100' }, confidenceScores: { type: 'object', description: 'Per-section confidence scores' } } },
  },

  // ================================================================
  //  INBOX — bridged from the cortex organ registry
  // ================================================================
  //
  // See CORTEX_TOOL_BRIDGE below for why these are declared here rather than
  // being exposed directly under their dotted organ names.
  //
  // The gap these close: KEY could SEND (send_message_with_approval) and could
  // not READ. Running a support or sales inbox is the most common "be my staff"
  // request there is, and KEY could only ever talk into it.
  //
  // key_inbox.send_reply is deliberately NOT bridged — send_message_with_approval
  // already covers it on the flow side, and two tools for one action is how a
  // model ends up sending twice.
  {
    name: 'inbox_list_threads',
    description: 'List inbox threads across every connected channel, filtered by channel, status, priority or detected intent. Use this to see what has come in and what still needs an answer.',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/key-inbox',
    parameters: {
      type: 'object',
      properties: {
        channel: { type: 'string', description: 'Optional: restrict to one channel (email, whatsapp, sms, ...).' },
        status: { type: 'string', description: 'Optional: thread status, e.g. open or resolved.' },
        priority: { type: 'string', description: 'Optional: priority filter.' },
        intent: { type: 'string', description: 'Optional: detected intent filter.' },
        limit: { type: 'number', description: 'Maximum threads to return.' },
        offset: { type: 'number', description: 'Pagination offset.' },
      },
      required: [],
    },
    outputSchema: {
      type: 'object',
      description: 'Inbox threads',
      fields: { threads: { type: 'array', description: 'Matching threads with channel, status, priority and last activity' } },
    },
  },
  {
    name: 'inbox_read_thread',
    description: 'Read one inbox thread in full, including its messages. Use after inbox_list_threads to see what was actually said before replying or acting.',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/key-inbox',
    parameters: {
      type: 'object',
      properties: { threadId: { type: 'string', description: 'The thread to read.' } },
      required: ['threadId'],
    },
    outputSchema: {
      type: 'object',
      description: 'One thread and its messages',
      fields: { thread: { type: 'object', description: 'Thread with its message history' } },
    },
  },
  {
    name: 'inbox_brief',
    description: 'Generate an intelligence brief over the inbox — what is waiting, what looks urgent, and what patterns are showing up across threads.',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/key-inbox',
    parameters: { type: 'object', properties: {}, required: [] },
    outputSchema: {
      type: 'object',
      description: 'Inbox brief',
      fields: { brief: { type: 'object', description: 'Summary of what is waiting and what it means' } },
    },
  },
  {
    name: 'inbox_mark_resolved',
    description: 'Mark an inbox thread as done. Only after the underlying request has actually been handled.',
    family: 'organize',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    changedEntities: ['InboxThread'],
    manualEquivalentRoute: '/app/key-inbox',
    parameters: {
      type: 'object',
      properties: { threadId: { type: 'string', description: 'The thread to mark resolved.' } },
      required: ['threadId'],
    },
    outputSchema: {
      type: 'object',
      description: 'Resolution result',
      fields: { threadId: { type: 'string', description: 'The thread marked resolved' } },
    },
  },

  // ================================================================
  //  PEOPLE — the org, who works here, and delegating to a human
  // ================================================================
  //
  // KEY is meant to plug into any role, tier and level of staff, and until now
  // it had no concept of staff at all: five live Prisma models, three working
  // web pages, and zero tools. It could assign a task to itself and to nobody
  // else, which makes KEY a worker rather than a colleague.
  //
  // Read tools are tier 1. people_assign_task is tier 2 and 'execute' because
  // it puts an obligation on a named human — reversible, but it changes what
  // someone is expected to do, which is not a draft.
  //
  // No tool here returns pay. StaffMember.hourlyRate is one field away from
  // every row these assemble, and chat cannot establish whether the person
  // asking is entitled to a colleague's rate.
  {
    name: 'people_list',
    description: 'List the people who work in this business — accounts and bookable staff — with job role, org unit, who they report to, skills and weekly capacity. Use this before assigning work, or to answer questions about who does what. Does not include pay.',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/structure',
    parameters: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Optional: filter by name, email, job role, org unit or skill.' },
        limit: { type: 'number', description: 'Maximum people to return (default 50, max 200).' },
      },
      required: [],
    },
    outputSchema: {
      type: 'object',
      description: 'The people directory',
      fields: {
        people: { type: 'array', description: 'Each with id, kind ("account" or "staff"), name, email, accessLevel, approvalTier, jobRole, orgUnit, reportsTo, weeklyCapacityHours, skills' },
        total: { type: 'number', description: 'How many matched before the limit' },
        truncated: { type: 'boolean', description: 'True when more matched than were returned' },
      },
    },
  },
  {
    name: 'people_workload',
    description: 'See who is carrying what right now — open task counts per person against their weekly capacity, plus how many open tasks nobody owns. Use this to answer "who is free", "who is overloaded", or before deciding who should take on new work.',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/structure',
    parameters: { type: 'object', properties: {}, required: [] },
    outputSchema: {
      type: 'object',
      description: 'Current workload across the team',
      fields: {
        people: { type: 'array', description: 'Each with assignableType, assignableId, name, openTasks, weeklyCapacityHours — busiest first' },
        unassignedOpenTasks: { type: 'number', description: 'Open tasks with no owner' },
        truncated: { type: 'boolean', description: 'True when there were more open tasks than could be scanned' },
      },
    },
  },
  {
    name: 'people_org_chart',
    description: 'Get the organisational structure — units, job roles, reporting lines and active delegation rules. Use this to understand hierarchy, or to find who manages a team.',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/structure',
    parameters: { type: 'object', properties: {}, required: [] },
    outputSchema: {
      type: 'object',
      description: 'Org structure',
      fields: {
        tree: { type: 'array', description: 'Org units in hierarchy, each with name, type and children' },
        stats: { type: 'object', description: 'unitCount, roleCount, assignmentCount, delegationCount' },
      },
    },
  },
  {
    name: 'people_recommend_assignee',
    description: 'Rank who should take on a piece of work, scored on current workload, recent completion rate and skill match against their past tasks. Returns candidates with a stated reason. Recommends — it does not assign.',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/structure',
    parameters: {
      type: 'object',
      properties: {
        taskTitle: { type: 'string', description: 'What the work is. Used for skill matching against completed tasks; omitting it makes every candidate neutral on skill.' },
        taskType: { type: 'string', description: 'ContactTask, ProjectTask or AutopilotTask.', enum: ['ContactTask', 'ProjectTask', 'AutopilotTask'] },
      },
      required: ['taskTitle'],
    },
    outputSchema: {
      type: 'object',
      description: 'Ranked candidates',
      fields: {
        recommendations: { type: 'array', description: 'Up to 5, each with assignableType, assignableId, name, score 0-100 and reason' },
      },
    },
  },
  {
    name: 'people_assign_task',
    description: 'Assign an existing task to a person. Requires the exact assignableId from people_list or people_recommend_assignee — never guess it from a name. Replaces any current assignee on that task.',
    family: 'execute',
    riskLevel: 'medium',
    riskTier: 2 as RiskTier,
    changedEntities: ['TaskAssignment'],
    followOnSuggestions: ['people_workload'],
    manualEquivalentRoute: '/app/projects',
    parameters: {
      type: 'object',
      properties: {
        taskType: { type: 'string', description: 'Which kind of task is being assigned.', enum: ['ContactTask', 'ProjectTask', 'AutopilotTask'] },
        taskId: { type: 'string', description: 'The id of the task to assign.' },
        assignableType: { type: 'string', description: 'The id space assignableId belongs to. "account" people from people_list are User; "staff" people are StaffMember.', enum: ['User', 'StaffMember', 'Contractor', 'KeyflowStaff', 'KEY'] },
        assignableId: { type: 'string', description: 'The id of the person, exactly as returned by people_list or people_recommend_assignee.' },
        reason: { type: 'string', description: 'Why this person. Shown to them and kept on the record.' },
      },
      required: ['taskType', 'taskId', 'assignableType', 'assignableId'],
    },
    outputSchema: {
      type: 'object',
      description: 'The assignment that was made',
      fields: {
        assignmentId: { type: 'string', description: 'Id of the new assignment' },
        taskType: { type: 'string', description: 'Task type' },
        taskId: { type: 'string', description: 'Task id' },
        assignableType: { type: 'string', description: 'Assignee id space' },
        assignableId: { type: 'string', description: 'Assignee id' },
      },
    },
  },
  // ================================================================
  //  Union boundary. main contributed the inbox_*/people_* tools above,
  //  integration the procurement_*/structure_* tools below. Verified
  //  disjoint before unioning: 9 names against 21, zero overlap.
  //
  //  PROCUREMENT FAMILY — L1 Read / L2 Organize / L3 Execute
  //  Note: approving/rejecting a procurement request is intentionally
  //  NOT an AI tool — a business shouldn't let KEY approve its own
  //  spend requests. That step stays human-only via /app/procurement.
  // ================================================================
  {
    name: 'procurement_list_requests',
    description: 'List procurement requests for the business, most recent first.',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/procurement',
    parameters: { type: 'object', properties: {}, required: [] },
    outputSchema: { type: 'object', description: 'Procurement requests', fields: { requests: { type: 'array', description: 'Procurement request rows' }, count: { type: 'number', description: 'Total count' } } },
  },
  {
    name: 'procurement_get_request',
    description: 'Get full detail on a single procurement request, including its brief and recommended packages.',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/procurement',
    parameters: {
      type: 'object',
      properties: { requestId: { type: 'string', description: 'Procurement request ID' } },
      required: ['requestId'],
    },
    outputSchema: { type: 'object', description: 'Procurement request detail', fields: { request: { type: 'object', description: 'Full procurement request record' } } },
  },
  {
    name: 'procurement_list_suppliers',
    description: 'List active connected suppliers/vendors available to fulfill a procurement request.',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/procurement/suppliers',
    parameters: { type: 'object', properties: {}, required: [] },
    outputSchema: { type: 'object', description: 'Active suppliers', fields: { suppliers: { type: 'array', description: 'Supplier connection rows' } } },
  },
  {
    name: 'procurement_get_stats',
    description: 'Get procurement spend and pipeline stats: totals by status, priority, category, average and total budget, pending approvals.',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/procurement',
    parameters: { type: 'object', properties: {}, required: [] },
    outputSchema: { type: 'object', description: 'Procurement stats', fields: { total: { type: 'number', description: 'Total requests' }, byStatus: { type: 'object', description: 'Counts by status' }, pendingApprovals: { type: 'number', description: 'Requests awaiting approval' } } },
  },
  {
    name: 'procurement_create_request',
    description: 'Create a new procurement request describing a business need in plain language (e.g. "need a new POS printer", "want a branding refresh"). Generates an interpreted category and recommended packages.',
    family: 'crud',
    riskLevel: 'low',
    riskTier: 2 as RiskTier,
    manualEquivalentRoute: '/app/procurement/new',
    changedEntities: ['procurementRequest'],
    parameters: {
      type: 'object',
      properties: {
        userPrompt: { type: 'string', description: 'Plain-language description of the business need' },
        priority: { type: 'string', description: 'Priority: LOW, NORMAL, HIGH, URGENT' },
        estimatedBudget: { type: 'object', description: 'Optional budget range, e.g. { min: 200, max: 800 }' },
      },
      required: ['userPrompt'],
    },
    outputSchema: { type: 'object', description: 'Created procurement request', fields: { id: { type: 'string', description: 'Request ID' }, request: { type: 'object', description: 'Full request record' } } },
  },
  {
    name: 'procurement_update_request',
    description: 'Update a procurement request\'s priority, internal notes, or brief. Does not change approval status.',
    family: 'crud',
    riskLevel: 'medium',
    riskTier: 2 as RiskTier,
    manualEquivalentRoute: '/app/procurement',
    changedEntities: ['procurementRequest'],
    parameters: {
      type: 'object',
      properties: {
        requestId: { type: 'string', description: 'Procurement request ID' },
        priority: { type: 'string', description: 'New priority' },
        internalNotes: { type: 'string', description: 'New internal notes' },
      },
      required: ['requestId'],
    },
    outputSchema: { type: 'object', description: 'Updated request', fields: { id: { type: 'string', description: 'Request ID' } } },
  },
  {
    name: 'procurement_submit_for_review',
    description: 'Submit a draft procurement request for business-owner review and approval. Generates a summary brief. Does NOT approve it — a human must still approve or reject.',
    family: 'execute',
    riskLevel: 'medium',
    riskTier: 2 as RiskTier,
    manualEquivalentRoute: '/app/procurement',
    changedEntities: ['procurementRequest'],
    parameters: {
      type: 'object',
      properties: { requestId: { type: 'string', description: 'Procurement request ID' } },
      required: ['requestId'],
    },
    outputSchema: { type: 'object', description: 'Submitted request', fields: { id: { type: 'string', description: 'Request ID' }, status: { type: 'string', description: 'New status (SUBMITTED)' } } },
  },
  {
    name: 'procurement_select_vendor',
    description: 'Select which connected supplier/vendor will fulfill an approved procurement request.',
    family: 'crud',
    riskLevel: 'medium',
    riskTier: 2 as RiskTier,
    manualEquivalentRoute: '/app/procurement',
    changedEntities: ['procurementRequest'],
    parameters: {
      type: 'object',
      properties: {
        requestId: { type: 'string', description: 'Procurement request ID' },
        supplierConnectionId: { type: 'string', description: 'Supplier connection ID to assign' },
      },
      required: ['requestId', 'supplierConnectionId'],
    },
    outputSchema: { type: 'object', description: 'Updated request', fields: { id: { type: 'string', description: 'Request ID' }, supplierConnectionId: { type: 'string', description: 'Assigned supplier' } } },
  },
  {
    name: 'procurement_issue_po',
    description: 'Issue a purchase order to the selected vendor for an approved procurement request. This commits the business to the purchase — requires a vendor to already be selected.',
    family: 'execute',
    riskLevel: 'high',
    riskTier: 3 as RiskTier,
    manualEquivalentRoute: '/app/procurement',
    changedEntities: ['procurementRequest', 'purchaseOrder'],
    parameters: {
      type: 'object',
      properties: { requestId: { type: 'string', description: 'Procurement request ID (must have a vendor selected)' } },
      required: ['requestId'],
    },
    outputSchema: { type: 'object', description: 'Issued purchase order', fields: { id: { type: 'string', description: 'Request ID' }, purchaseOrder: { type: 'object', description: 'Created purchase order record' } } },
  },
  {
    name: 'procurement_acknowledge_vendor',
    description: 'Record that the vendor has acknowledged/confirmed the purchase order.',
    family: 'crud',
    riskLevel: 'medium',
    riskTier: 2 as RiskTier,
    manualEquivalentRoute: '/app/procurement',
    changedEntities: ['procurementRequest'],
    parameters: {
      type: 'object',
      properties: { requestId: { type: 'string', description: 'Procurement request ID' } },
      required: ['requestId'],
    },
    outputSchema: { type: 'object', description: 'Updated request', fields: { id: { type: 'string', description: 'Request ID' }, status: { type: 'string', description: 'New status (VENDOR_ACKNOWLEDGED)' } } },
  },
  {
    name: 'procurement_mark_fulfilled',
    description: 'Mark a procurement request as fulfilled once the order has arrived / the work is delivered.',
    family: 'crud',
    riskLevel: 'medium',
    riskTier: 2 as RiskTier,
    manualEquivalentRoute: '/app/procurement',
    changedEntities: ['procurementRequest'],
    parameters: {
      type: 'object',
      properties: { requestId: { type: 'string', description: 'Procurement request ID' } },
      required: ['requestId'],
    },
    outputSchema: { type: 'object', description: 'Updated request', fields: { id: { type: 'string', description: 'Request ID' }, status: { type: 'string', description: 'New status (FULFILLED)' } } },
  },
  {
    name: 'procurement_mark_invoiced',
    description: 'Mark a procurement request as invoiced once the supplier has sent their invoice.',
    family: 'crud',
    riskLevel: 'medium',
    riskTier: 2 as RiskTier,
    manualEquivalentRoute: '/app/procurement',
    changedEntities: ['procurementRequest'],
    parameters: {
      type: 'object',
      properties: { requestId: { type: 'string', description: 'Procurement request ID' } },
      required: ['requestId'],
    },
    outputSchema: { type: 'object', description: 'Updated request', fields: { id: { type: 'string', description: 'Request ID' }, status: { type: 'string', description: 'New status (INVOICED)' } } },
  },

  // ================================================================
  //  STRUCTURE FAMILY — L1 Read / L3 Execute (governance-sensitive writes)
  //  Note: ending an assignment or deleting an org unit/job role is
  //  intentionally NOT an AI tool in this round — those stay human-only
  //  via /app/structure. Delegation rule create/update ARE exposed, but
  //  gated at tier 3 since they grant one position authority to act on
  //  another's behalf.
  // ================================================================
  {
    name: 'structure_get_org_tree',
    description: 'Get the full org chart tree — org units/departments/branches with their hierarchy and active staff assignments.',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/structure',
    parameters: { type: 'object', properties: {}, required: [] },
    outputSchema: { type: 'object', description: 'Org chart tree', fields: { units: { type: 'array', description: 'All org units' }, rootUnits: { type: 'array', description: 'Top-level org units' } } },
  },
  {
    name: 'structure_list_org_units',
    description: 'List all org units (departments, branches, divisions, teams, warehouses) for the business.',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/structure',
    parameters: { type: 'object', properties: {}, required: [] },
    outputSchema: { type: 'object', description: 'Org units', fields: { units: { type: 'array', description: 'Org unit rows' }, count: { type: 'number', description: 'Total count' } } },
  },
  {
    name: 'structure_list_job_roles',
    description: 'List all job roles/positions defined for the business, including their hierarchy level and default approval tier.',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/structure',
    parameters: { type: 'object', properties: {}, required: [] },
    outputSchema: { type: 'object', description: 'Job roles', fields: { roles: { type: 'array', description: 'Job role rows' }, count: { type: 'number', description: 'Total count' } } },
  },
  {
    name: 'structure_list_assignments',
    description: 'List active staff assignments — who holds which position, in which org unit, and who they report to. Includes both full-account team members and contact-only staff.',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/structure',
    parameters: { type: 'object', properties: {}, required: [] },
    outputSchema: { type: 'object', description: 'Staff assignments', fields: { assignments: { type: 'array', description: 'Assignment rows' }, count: { type: 'number', description: 'Total count' } } },
  },
  {
    name: 'structure_find_person',
    description: 'Find who holds a specific position, works in a specific org unit, or look up a person by name — e.g. "who\'s the bookkeeper?", "who works in Marketing?", "who does Maria report to?". Provide at least one filter.',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/structure',
    parameters: {
      type: 'object',
      properties: {
        jobRoleName: { type: 'string', description: 'Job role/position name to search for, e.g. "bookkeeper"' },
        orgUnitName: { type: 'string', description: 'Org unit/branch/department name to search within' },
        personName: { type: 'string', description: 'Person\'s name to look up' },
      },
      required: [],
    },
    outputSchema: { type: 'object', description: 'Matching staff assignments', fields: { matches: { type: 'array', description: 'Matching assignment rows, with reporting chain' }, count: { type: 'number', description: 'Match count' } } },
  },
  {
    name: 'structure_list_delegation_rules',
    description: 'List active delegation rules — which positions have been granted authority to act/approve on behalf of another position.',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/structure',
    parameters: { type: 'object', properties: {}, required: [] },
    outputSchema: { type: 'object', description: 'Delegation rules', fields: { rules: { type: 'array', description: 'Delegation rule rows' }, count: { type: 'number', description: 'Total count' } } },
  },
  {
    name: 'structure_get_stats',
    description: 'Get org-structure stats: counts of org units, job roles, active assignments, and active delegation rules.',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/structure',
    parameters: { type: 'object', properties: {}, required: [] },
    outputSchema: { type: 'object', description: 'Structure stats', fields: { unitCount: { type: 'number', description: 'Org unit count' }, roleCount: { type: 'number', description: 'Job role count' }, assignmentCount: { type: 'number', description: 'Active assignment count' }, delegationCount: { type: 'number', description: 'Active delegation rule count' } } },
  },
  {
    name: 'structure_create_delegation_rule',
    description: 'Create a delegation rule granting one position (OrgAssignment) authority to approve/act on behalf of another for a scope of actions, up to a maximum risk tier. This is a governance-sensitive change and requires explicit human confirmation.',
    family: 'crud',
    riskLevel: 'high',
    riskTier: 3 as RiskTier,
    manualEquivalentRoute: '/app/structure',
    changedEntities: ['delegationRule'],
    parameters: {
      type: 'object',
      properties: {
        delegatorId: { type: 'string', description: 'OrgAssignment ID of the position being delegated FROM' },
        delegateId: { type: 'string', description: 'OrgAssignment ID of the position receiving authority' },
        scope: { type: 'string', description: 'Module name (e.g. "procurement", "commerce") or "ALL"' },
        maxTier: { type: 'number', description: 'Maximum risk tier (1-4) the delegate may act on' },
        activeUntil: { type: 'string', description: 'Optional ISO date when the rule expires' },
        reason: { type: 'string', description: 'Optional reason for the delegation' },
      },
      required: ['delegatorId', 'delegateId', 'scope', 'maxTier'],
    },
    outputSchema: { type: 'object', description: 'Created delegation rule', fields: { id: { type: 'string', description: 'Rule ID' }, rule: { type: 'object', description: 'Full rule record' } } },
  },
  {
    name: 'structure_update_delegation_rule',
    description: 'Update an existing delegation rule (scope, max tier, expiry, or active status). Governance-sensitive — requires explicit human confirmation.',
    family: 'crud',
    riskLevel: 'high',
    riskTier: 3 as RiskTier,
    manualEquivalentRoute: '/app/structure',
    changedEntities: ['delegationRule'],
    parameters: {
      type: 'object',
      properties: {
        ruleId: { type: 'string', description: 'Delegation rule ID' },
        scope: { type: 'string', description: 'New scope' },
        maxTier: { type: 'number', description: 'New max tier' },
        activeUntil: { type: 'string', description: 'New expiry date, ISO' },
        reason: { type: 'string', description: 'New reason' },
        isActive: { type: 'boolean', description: 'Whether the rule is active' },
      },
      required: ['ruleId'],
    },
    outputSchema: { type: 'object', description: 'Updated delegation rule', fields: { id: { type: 'string', description: 'Rule ID' }, rule: { type: 'object', description: 'Full rule record' } } },
  },

];

/**
 * Flow tool name -> canonical cortex registry name.
 *
 * THE OTHER DIRECTION OF THE EFFERENT BRIDGE.
 *
 * KeyCortexEfferentBridgeService mirrors FLOW_TOOLS *into* the cortex registry,
 * so the deliberating brain can act. Nothing went the other way: the chat's
 * tool list is `getOpenAiToolDefinitions()`, which is FLOW_TOOLS and only
 * FLOW_TOOLS, so the 29 tools the organ adapters register were invisible to the
 * model that talks to the user. KEY could reason about the inbox and could not
 * open it.
 *
 * Three reasons this is an explicit table rather than "expose every cortex tool
 * dynamically", and each one is a bug that design would have shipped:
 *
 *  1. DOTS ARE ILLEGAL. OpenAI and Anthropic both constrain function names to
 *     [a-zA-Z0-9_-]{1,64}. Every organ tool is dotted (`key_inbox.list_threads`),
 *     so advertising them verbatim is a 400 from the provider on every request
 *     that carries one.
 *
 *  2. TIERS WOULD SILENTLY COLLAPSE TO 2. AiOversightService.getToolTier looks
 *     the name up in FLOW_TOOLS and returns 2 when it misses. A cortex tool at
 *     tier 4 — `cortex.query_database` is one — would be gated as if it were
 *     medium risk. Declaring the bridged tools as real FlowTools gives them a
 *     real tier, and the risk class is stated in the same file a reviewer reads.
 *
 *  3. COST. Tool definitions are sent on every single request. Bridging all 29
 *     indiscriminately would put ~29 unused schemas in the prompt of every chat
 *     turn forever, which is the opposite of what this system is being tuned
 *     for. Exposure is a judgement about value, so it is written down.
 *
 * Declaring them as FlowTools also means they inherit every gate that already
 * exists — role reachability, the manual-route CI check, oversight tiering —
 * rather than needing a parallel set of them.
 *
 * EXECUTION still goes through the cortex registry (see the dispatcher in
 * FlowOrchestratorService), so the organ's own handler, risk tier, idempotency
 * and safety gate are what actually run. This maps the name; it does not
 * reimplement the tool.
 *
 * To bridge another organ tool: add a FlowTool above and one line here.
 */
export const CORTEX_TOOL_BRIDGE: Record<string, string> = {
  inbox_list_threads: 'key_inbox.list_threads',
  inbox_read_thread: 'key_inbox.get_thread',
  inbox_brief: 'key_inbox.generate_brief',
  inbox_mark_resolved: 'key_inbox.mark_resolved',
};

export function isCortexBridgedTool(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(CORTEX_TOOL_BRIDGE, name);
}

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
