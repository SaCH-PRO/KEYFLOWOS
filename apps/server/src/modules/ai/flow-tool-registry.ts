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
  crud: '/app/crm/pipeline',
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
    manualEquivalentRoute: '/app/crm/pipeline',
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
    manualEquivalentRoute: '/app/crm/pipeline',
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
    manualEquivalentRoute: '/app/crm/pipeline',
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
    manualEquivalentRoute: '/app/automations',
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
    manualEquivalentRoute: '/app/crm/pipeline',
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
    manualEquivalentRoute: '/app/crm/pipeline',
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
    manualEquivalentRoute: '/app/crm/pipeline',
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
    manualEquivalentRoute: '/app/crm/pipeline',
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
    manualEquivalentRoute: '/app/crm/pipeline',
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
    manualEquivalentRoute: '/app/crm/pipeline',
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
    manualEquivalentRoute: '/app/crm/pipeline',
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
    manualEquivalentRoute: '/app/crm/pipeline',
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
    manualEquivalentRoute: '/app/profile',
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
    manualEquivalentRoute: '/app/profile',
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
    description: 'List products in the storefront/store with pricing and stock.',
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
    manualEquivalentRoute: '/app/marketing/seo',
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
    manualEquivalentRoute: '/app/marketing/seo',
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
    manualEquivalentRoute: '/app/marketing/seo',
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
    manualEquivalentRoute: '/app/marketing/seo',
    parameters: { type: 'object', properties: { businessId: { type: 'string', description: 'The business ID' } }, required: ['businessId'] },
    outputSchema: { type: 'object', description: 'Content gap analysis', fields: { gaps: { type: 'array', description: 'Ranked content opportunities' } } },
  },
  {
    name: 'fetch_seo_revenue_attribution',
    description: 'Show revenue attributed to organic search traffic — top revenue pages, total organic sessions, conversion rate, and revenue.',
    family: 'read',
    riskLevel: 'low',
    riskTier: 1 as RiskTier,
    manualEquivalentRoute: '/app/marketing/seo',
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
    manualEquivalentRoute: '/app/marketing/seo',
    changedEntities: ['seoPage', 'seoIssue'],
    parameters: { type: 'object', properties: { businessId: { type: 'string', description: 'The business ID' } }, required: ['businessId'] },
    outputSchema: { type: 'object', description: 'Sync result', fields: { synced: { type: 'number', description: 'Pages synced' } } },
  },
  {
    name: 'generate_content_brief',
    description: 'Generate an AI-powered SEO content brief for a target keyword — outline, meta tags, search intent, internal links.',
    family: 'draft',
    riskLevel: 'medium',
    riskTier: 2 as RiskTier,
    manualEquivalentRoute: '/app/marketing/seo',
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
        type: { type: 'string', description: 'Event type: MEETING, REMINDER, MILESTONE, DEADLINE, OTHER', enum: ['MEETING', 'REMINDER', 'MILESTONE', 'DEADLINE', 'OTHER'] },
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
    manualEquivalentRoute: '/app/projects',
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
    manualEquivalentRoute: '/app/projects',
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
    manualEquivalentRoute: '/app/projects',
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
    manualEquivalentRoute: '/app/support',
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
    manualEquivalentRoute: '/app/support',
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
    manualEquivalentRoute: '/app/support',
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
    manualEquivalentRoute: '/app/crm/pipeline',
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
  //  PROJECT UPDATE/DELETE — L2 Organize / L3 Execute
  // ================================================================
  {
    name: 'projects_update_task',
    description: 'Update a project task title, due date, priority, or completion status.',
    family: 'crud',
    riskLevel: 'medium',
    riskTier: 2 as RiskTier,
    manualEquivalentRoute: '/app/projects',
    changedEntities: ['projectTask'],
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'Task ID' },
        title: { type: 'string', description: 'New title' },
        dueDate: { type: 'string', description: 'New due date (ISO)' },
        priority: { type: 'string', description: 'Priority: LOW, NORMAL, HIGH, URGENT' },
        isCompleted: { type: 'boolean', description: 'Mark as completed' },
      },
      required: ['taskId'],
    },
    outputSchema: { type: 'object', description: 'Updated task', fields: { id: { type: 'string', description: 'Task ID' }, title: { type: 'string', description: 'Task title' } } },
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
    manualEquivalentRoute: '/app/invoices',
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
    manualEquivalentRoute: '/app/catalog',
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
    manualEquivalentRoute: '/app/invoices',
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
    manualEquivalentRoute: '/app/work/projects',
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
