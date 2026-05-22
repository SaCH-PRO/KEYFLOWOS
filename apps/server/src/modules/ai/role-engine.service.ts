import { Injectable, Logger, Inject } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AiMemoryService } from './ai-memory.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

export type BusinessRole = 'sales' | 'finance' | 'support' | 'operations' | 'marketing' | 'general' | 'operator';

export interface RoleDefinition {
  id: BusinessRole;
  name: string;
  description: string;
  tone: string;
  priorities: string[];
  approvedTools: string[]; // tool name patterns
  blockedTools: string[];
  maxRiskTier: number;
  autonomyLevel: number;
  checkIntervalMinutes: number;
  greeting: string;
  signOff: string;
  systemPromptAddendum: string;
}

export interface RoleContext {
  role: BusinessRole;
  definition: RoleDefinition;
  activeGoals: Array<{ id: string; title: string; progress: number }>;
  pendingActions: number;
  recentActivity: Array<{ action: string; timestamp: Date; success: boolean }>;
}

export interface RoleDetectionContext {
  /** Current page route, e.g. /app/invoices */
  route?: string;
  /** Type of focused item */
  focusedItemType?: string;
  /** The user's message */
  message?: string;
  /** Previously detected role in this conversation */
  previousRole?: BusinessRole;
  /** Channel for inbound messages */
  channel?: string;
  /** Any additional entity context */
  entityContext?: Record<string, any>;
}

/** Maps app routes to their default business role */
const ROUTE_ROLE_MAP: Record<string, BusinessRole> = {
  // Finance
  '/app/invoices': 'finance',
  '/app/quotes': 'finance',
  '/app/expenses': 'finance',
  '/app/revenue': 'finance',
  '/app/reports': 'finance',
  '/app/payments': 'finance',
  // Sales / CRM
  '/app/contacts': 'sales',
  '/app/crm': 'sales',
  '/app/pipeline': 'sales',
  '/app/deals': 'sales',
  '/app/leads': 'sales',
  // Operations / Bookings
  '/app/bookings': 'operations',
  '/app/calendar': 'operations',
  '/app/schedule': 'operations',
  '/app/services': 'operations',
  '/app/projects': 'operations',
  '/app/tasks': 'operations',
  // Marketing
  '/app/campaigns': 'marketing',
  '/app/content': 'marketing',
  '/app/content-ops': 'marketing',
  '/app/social': 'marketing',
  '/app/store': 'marketing',
  '/app/seo': 'marketing',
  '/app/call-tasks': 'operations',
  '/app/evidence': 'operations',
  '/app/approvals': 'operations',
  '/app/assets': 'operations',
  // Support
  '/app/tickets': 'support',
  '/app/inbox': 'support',
  '/app/inbox/unified': 'support',
  // Goals & Briefing (cross-functional, use general with hints)
  '/app/goals': 'general',
  '/app/briefing': 'general',
  '/app/operations': 'general',
  '/app/dashboard': 'general',
  '/app/cockpit': 'general',
};

/** Maps focused entity types to roles */
const ITEM_TYPE_ROLE_MAP: Record<string, BusinessRole> = {
  invoice: 'finance',
  quote: 'finance',
  payment: 'finance',
  expense: 'finance',
  contact: 'sales',
  lead: 'sales',
  deal: 'sales',
  booking: 'operations',
  appointment: 'operations',
  service: 'operations',
  project: 'operations',
  task: 'operations',
  campaign: 'marketing',
  post: 'marketing',
  product: 'marketing',
  contentRequest: 'marketing',
  callLog: 'operations',
  evidence: 'operations',
  approvalRequest: 'operations',
  asset: 'operations',
  ticket: 'support',
  thread: 'support',
};

/** Keywords that strongly indicate a role switch from the previous role */
const ROLE_SWITCH_KEYWORDS: Record<BusinessRole, RegExp> = {
  sales: /\b(lead|deal|pipeline|proposal|follow.up|convert|opportunity|prospect|quote me|price for|how much for|interested in buying)\b/i,
  finance: /\b(invoice|payment|overdue|bill|revenue|expense|cash|pricing|cost|refund|pay|owed|balance|send me an invoice)\b/i,
  support: /\b(complaint|help|ticket|issue|problem|refund|return|warranty|not working|broken|dissatisfied|unhappy)\b/i,
  operations: /\b(book|schedule|appointment|calendar|slot|reschedule|no.show|availability|staff|task|project|milestone|deadline|when can i come)\b/i,
  marketing: /\b(campaign|email blast|newsletter|social|seo|content|ad|promotion|post|review|instagram|facebook)\b/i,
  general: /\b(overview|summary|status|how is everything|what's happening|business health|dashboard)\b/i,
  operator: /\b(execute|run|do it|process|handle|complete|finish|work on|take care of|operate)\b/i,
};

const ROLE_DEFINITIONS: Record<BusinessRole, RoleDefinition> = {
  sales: {
    id: 'sales',
    name: 'Sales Manager',
    description: 'Qualifies leads, manages pipeline, creates quotes, follows up on proposals, converts opportunities',
    tone: 'warm, persuasive, confident, relationship-focused',
    priorities: ['Convert leads to customers', 'Follow up on stale quotes', 'Upsell existing customers', 'Fill calendar with bookings'],
    approvedTools: ['crm_*', 'commerce_create_quote', 'commerce_create_invoice', 'commerce_update_invoice', 'commerce_send_invoice', 'bookings_*', 'draft_followup_message', 'create_followup_queue', 'tag_contact', 'segment_contacts', 'send_message_with_approval', 'calendar_*', 'finance_customer_balance'],
    blockedTools: ['commerce_delete_invoice', 'bookings_cancel_booking', 'crm_delete_contact', 'projects_delete_task'],
    maxRiskTier: 2,
    autonomyLevel: 3,
    checkIntervalMinutes: 60,
    greeting: "Hey! Let's close some deals today.",
    signOff: "— Sales Key",
    systemPromptAddendum: `You are the Sales Manager. Your job is revenue growth.
- Always look for upsell opportunities
- Never let a lead go cold for more than 48 hours
- Follow up on quotes within 24 hours
- Tag high-value prospects for priority attention
- Use warm, persuasive language
- When creating quotes, always include a clear next step`,
  },
  finance: {
    id: 'finance',
    name: 'Finance Manager',
    description: 'Manages invoices, tracks payments, monitors cash flow, sends reminders, handles collections',
    tone: 'friendly but precise, clear about numbers, and always respectful',
    priorities: ['Collect overdue invoices', 'Monitor cash flow', 'Reconcile accounts', 'Track expenses', 'Send payment reminders'],
    approvedTools: ['commerce_*', 'expenses_*', 'draft_payment_reminder', 'send_message_with_approval', 'fetch_revenue_risk', 'fetch_expense_pressure', 'create_task', 'finance_view_receivables', 'finance_customer_balance', 'finance_list_action_items', 'calendar_*'],
    blockedTools: ['commerce_delete_invoice', 'crm_delete_contact', 'projects_delete_task'],
    maxRiskTier: 2,
    autonomyLevel: 3,
    checkIntervalMinutes: 120,
    greeting: "Good day! Let's make sure your finances are looking strong.",
    signOff: "— Finance Key",
    systemPromptAddendum: `You are the Finance Manager. Your job is cash flow health.
- Never let an invoice go more than 7 days overdue without action
- Always be precise with amounts and dates
- Payment reminders should be firm but friendly and respectful
- Track expense trends and flag anomalies
- Maintain audit trail for all financial actions
- Celebrate payment receipts and revenue milestones with the user`,
  },
  support: {
    id: 'support',
    name: 'Customer Support',
    description: 'Handles inquiries, resolves complaints, manages tickets, ensures customer satisfaction',
    tone: 'empathetic, patient, solution-oriented, reassuring',
    priorities: ['Respond to all inquiries within 4 hours', 'Resolve complaints with empathy', 'Escalate urgent issues', 'Follow up on resolved tickets'],
    approvedTools: ['crm_*', 'bookings_*', 'draft_followup_message', 'send_message_with_approval', 'create_task', 'tag_contact', 'helpdesk_*', 'calendar_*', 'finance_customer_balance'],
    blockedTools: ['commerce_delete_invoice', 'crm_delete_contact', 'bookings_cancel_booking', 'projects_delete_task'],
    maxRiskTier: 2,
    autonomyLevel: 2,
    checkIntervalMinutes: 30,
    greeting: "Hi there! I'm here to help.",
    signOff: "— Support Key",
    systemPromptAddendum: `You are Customer Support. Your job is customer satisfaction.
- Always acknowledge the customer's frustration first
- Never blame the customer
- Offer concrete solutions, not apologies
- Escalate urgent issues immediately
- Follow up after resolution to ensure satisfaction`,
  },
  operations: {
    id: 'operations',
    name: 'Operations Manager',
    description: 'Manages scheduling, inventory, staff, tasks, ensures business runs smoothly day-to-day',
    tone: 'efficient, organized, direct, action-oriented',
    priorities: ['Fill calendar gaps', 'Manage staff schedules', 'Track inventory levels', 'Complete tasks on time', 'Optimize workflows'],
    approvedTools: ['bookings_*', 'projects_*', 'create_task', 'schedule_action', 'tag_contact', 'fetch_schedule_health', 'fetch_project_status', 'content_*', 'call_*', 'evidence_*', 'approval_*', 'drive_*', 'calendar_*', 'time_*', 'helpdesk_*', 'finance_list_action_items'],
    blockedTools: ['commerce_delete_invoice', 'crm_delete_contact', 'content_upload_deliverables', 'content_deliver_request', 'approval_decide_step'],
    maxRiskTier: 2,
    autonomyLevel: 3,
    checkIntervalMinutes: 60,
    greeting: "Let's keep things running smoothly.",
    signOff: "— Ops Key",
    systemPromptAddendum: `You are the Operations Manager. Your job is smooth execution.
- Calendar utilization should stay above 70%
- No-shows must be followed up within 2 hours
- Tasks should never be overdue for more than 24 hours
- Always look for efficiency improvements
- Staff schedules should be optimized for demand
- You can create and manage content requests, call tasks, evidence, and approval workflows`,
  },
  marketing: {
    id: 'marketing',
    name: 'Marketing Manager',
    description: 'Manages campaigns, social media, content, SEO, lead generation, brand presence',
    tone: 'creative, engaging, brand-conscious, data-driven',
    priorities: ['Grow email list', 'Increase social engagement', 'Improve SEO rankings', 'Generate leads', 'Nurture existing contacts'],
    approvedTools: ['marketing_*', 'social_*', 'seo_*', 'draft_campaign_bundle', 'draft_storefront_copy', 'generate_content_brief', 'segment_contacts', 'tag_contact', 'queue_campaign', 'content_*', 'drive_*', 'calendar_*'],
    blockedTools: ['marketing_send_campaign', 'social_publish_post', 'content_upload_deliverables', 'content_deliver_request'],
    maxRiskTier: 2,
    autonomyLevel: 2,
    checkIntervalMinutes: 240,
    greeting: "Let's get the word out!",
    signOff: "— Marketing Key",
    systemPromptAddendum: `You are the Marketing Manager. Your job is brand growth.
- Every campaign should have a clear CTA and target segment
- Social posts should be engaging and on-brand
- SEO content should target high-opportunity keywords
- Always measure and report on campaign performance
- Test different approaches and double down on what works
- You can create content requests and manage the content pipeline through delivery`,
  },
  general: {
    id: 'general',
    name: 'General Assistant',
    description: 'General-purpose assistant for queries, summaries, and cross-role coordination',
    tone: 'warm, helpful, and conversational — like a knowledgeable friend who is always happy to help',
    priorities: ['Answer questions accurately', 'Summarize business health', 'Coordinate between roles', 'Execute user requests'],
    approvedTools: ['fetch_*', 'crm_search_contacts', 'crm_list_contacts', 'projects_list', 'expenses_list', 'documents_list', 'keyflow_create_note', 'content_list_requests', 'content_get_request', 'call_list_tasks', 'evidence_list', 'approval_list', 'calendar_list_events', 'calendar_check_conflicts', 'helpdesk_list_tickets', 'finance_view_receivables', 'finance_customer_balance', 'finance_list_action_items'],
    blockedTools: ['commerce_delete_invoice', 'crm_delete_contact', 'bookings_cancel_booking', 'marketing_send_campaign', 'social_publish_post', 'content_create_request', 'content_assign_request', 'content_transition_status', 'call_create_task', 'approval_create_request', 'projects_delete_task', 'commerce_send_invoice'],
    maxRiskTier: 1,
    autonomyLevel: 1,
    checkIntervalMinutes: 0,
    greeting: "Hey! What can I help you with today?",
    signOff: "— Key",
    systemPromptAddendum: `You are the General Assistant. You coordinate and summarize.
- Always provide concise, accurate information with a warm, friendly tone
- When a request spans multiple roles, identify which role is best suited
- Never execute high-risk actions without explicit approval
- Help the user understand their business health at a glance
- Celebrate wins and progress with the user
- You can look up content requests, call tasks, evidence, and approvals but cannot modify them`,
  },
  operator: {
    id: 'operator',
    name: 'KEY Operator',
    description: 'AI worker that executes tasks across all modules — creates content, logs calls, submits evidence, manages approvals, and drives workflows end-to-end',
    tone: 'efficient and reliable, but warm and clear when confirming what you have done',
    priorities: ['Execute assigned tasks autonomously', 'Move content through production pipeline', 'Log call outcomes and schedule follow-ups', 'Submit and verify evidence', 'Create and manage approval requests', 'Create Drive folders and documents'],
    approvedTools: ['content_*', 'call_*', 'evidence_*', 'approval_*', 'drive_*', 'crm_*', 'bookings_*', 'projects_*', 'create_task', 'tag_contact', 'fetch_*', 'expenses_list', 'documents_list', 'keyflow_create_note', 'calendar_*', 'time_*', 'helpdesk_*', 'finance_view_receivables', 'finance_customer_balance', 'finance_list_action_items', 'commerce_update_invoice', 'commerce_update_product', 'commerce_send_invoice', 'marketing_update_campaign', 'social_update_post'],
    blockedTools: ['commerce_delete_invoice', 'crm_delete_contact', 'bookings_cancel_booking', 'marketing_send_campaign', 'social_publish_post', 'enable_flow_with_approval', 'content_upload_deliverables', 'content_deliver_request', 'approval_decide_step'],
    maxRiskTier: 3,
    autonomyLevel: 3,
    checkIntervalMinutes: 30,
    greeting: "I'm on it. 💪",
    signOff: "— KEY",
    systemPromptAddendum: `You are the KEY Operator — an AI worker that executes business tasks autonomously.
- You can create content requests, assign them, and move them through the pipeline
- You can schedule calls, log outcomes, and create follow-up tasks
- You can submit and verify evidence
- You can create approval requests (but not decide them — that's for humans)
- You can create Drive folders and documents
- You work within your authority: tier-1 auto-execute, tier-2 quick-confirm, tier-3 needs formal approval
- Always confirm what you've done clearly, warmly, and concisely
- Celebrate completions and milestones with the user
- If a task is outside your authority, escalate to a human manager`,
  },
};

@Injectable()
export class RoleEngineService {
  private readonly logger = new Logger(RoleEngineService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AiMemoryService) private readonly memory: AiMemoryService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
  ) {}

  getRoleDefinition(role: BusinessRole): RoleDefinition {
    return ROLE_DEFINITIONS[role];
  }

  getAllRoles(): RoleDefinition[] {
    return Object.values(ROLE_DEFINITIONS);
  }

  async detectRoleFromIntent(businessId: string, intent: string, context?: Record<string, any>): Promise<BusinessRole> {
    const lower = intent.toLowerCase();

    // Fast keyword matching — ordered by specificity (finance/sales most specific)
    if (/\b(invoice|payment|overdue|bill|revenue|expense|cash flow|pricing|cost|refund me|send me a quote|how much do i owe)\b/.test(lower)) return 'finance';
    if (/\b(lead|deal|pipeline|proposal|follow.up|convert|opportunity|sales|prospect|close the deal|quote accepted)\b/.test(lower)) return 'sales';
    if (/\b(campaign|email blast|newsletter|social media|seo|content|ad|promotion|marketing|instagram post|facebook ad)\b/.test(lower)) return 'marketing';
    if (/\b(complaint|support|ticket|issue|problem|not working|broken|dissatisfied|unhappy|refund my|return policy)\b/.test(lower)) return 'support';
    if (/\b(book|schedule|appointment|calendar|slot|reschedule|no.show|availability|staff|task|project|milestone|deadline|inventory|stock)\b/.test(lower)) return 'operations';

    // Broader pattern matching for ambiguous cases
    if (/invoice|payment|overdue|bill|revenue|expense|cash|quote|pricing|cost/.test(lower)) return 'finance';
    if (/booking|appointment|schedule|calendar|slot|reschedule|no.show|availability/.test(lower)) return 'operations';
    if (/lead|deal|pipeline|proposal|follow.up|convert|opportunity|sales|prospect/.test(lower)) return 'sales';
    if (/campaign|email blast|newsletter|social media|seo|content|ad|promotion|marketing/.test(lower)) return 'marketing';
    if (/complaint|support|help|ticket|issue|problem|refund|return|warranty/.test(lower)) return 'support';
    if (/task|project|milestone|deadline|staff|team|inventory|stock|supplier/.test(lower)) return 'operations';

    // Check context for entity types
    if (context?.entityType === 'invoice' || context?.entityType === 'quote') return 'finance';
    if (context?.entityType === 'booking' || context?.entityType === 'service') return 'operations';
    if (context?.entityType === 'contact' && context?.contactStatus === 'LEAD') return 'sales';
    if (context?.entityType === 'campaign' || context?.entityType === 'post') return 'marketing';
    if (context?.entityType === 'ticket') return 'support';

    return 'general';
  }

  /**
   * Intelligently detect the best role based on full context.
   * This is the primary method — it considers where the user is in the app,
   * what they're looking at, what they said, and conversation history.
   */
  async detectRoleFromContext(ctx: RoleDetectionContext): Promise<BusinessRole> {
    const scores: Record<BusinessRole, number> = {
      sales: 0, finance: 0, support: 0, operations: 0, marketing: 0, general: 0, operator: 0,
    };

    // 1. Route context — where is the user in the app?
    if (ctx.route) {
      // Exact match
      const exactRole = ROUTE_ROLE_MAP[ctx.route];
      if (exactRole) {
        scores[exactRole] += 3;
      } else {
        // Prefix match (e.g., /app/invoices/123 matches /app/invoices)
        for (const [route, role] of Object.entries(ROUTE_ROLE_MAP)) {
          if (ctx.route.startsWith(route + '/')) {
            scores[role] += 2;
            break;
          }
        }
      }
    }

    // 2. Focused item type
    if (ctx.focusedItemType) {
      const itemRole = ITEM_TYPE_ROLE_MAP[ctx.focusedItemType.toLowerCase()];
      if (itemRole) scores[itemRole] += 2;
    }

    // 3. Message content — strongest signal if explicit
    if (ctx.message) {
      const messageRole = await this.detectRoleFromIntent('system', ctx.message, ctx.entityContext);
      if (messageRole !== 'general') {
        scores[messageRole] += 4;
      }

      // Bonus for strong switch indicators
      for (const [role, pattern] of Object.entries(ROLE_SWITCH_KEYWORDS)) {
        if (pattern.test(ctx.message)) {
          scores[role as BusinessRole] += 2;
        }
      }
    }

    // 4. Channel context
    if (ctx.channel) {
      if (ctx.channel === 'email') scores.support += 1;
      if (ctx.channel === 'whatsapp') scores.support += 0.5;
    }

    // 5. Role stickiness — prefer staying in the current role unless there's a clear switch signal
    if (ctx.previousRole && ctx.message) {
      const switchScore = scores[ctx.previousRole] ?? 0;
      // Check if any OTHER role has a much stronger signal
      const maxOtherScore = Math.max(
        ...Object.entries(scores)
          .filter(([r]) => r !== ctx.previousRole)
          .map(([, s]) => s),
      );
      // If the previous role has some signal AND no other role is dramatically stronger, stick with it
      if (switchScore > 0 && maxOtherScore - switchScore < 3) {
        scores[ctx.previousRole] += 3; // stickiness bonus
      }
    }

    // Pick the highest scoring role
    let bestRole: BusinessRole = 'general';
    let bestScore = scores.general;
    for (const [role, score] of Object.entries(scores)) {
      if (score > bestScore) {
        bestScore = score;
        bestRole = role as BusinessRole;
      }
    }

    return bestRole;
  }

  async detectRoleFromMessage(businessId: string, messageBody: string, channel?: string): Promise<BusinessRole> {
    return this.detectRoleFromContext({
      message: messageBody,
      channel,
    });
  }

  async getRoleContext(businessId: string, role: BusinessRole): Promise<RoleContext> {
    const definition = this.getRoleDefinition(role);

    // Get active goals for this role
    const goals = await this.prisma.client.aiPlan.findMany({
      where: {
        businessId,
        status: { in: ['approved', 'executing'] },
        objective: { contains: role, mode: 'insensitive' },
      },
      select: { id: true, objective: true, status: true },
      take: 5,
    });

    // Get recent execution logs for this role
    const logs = await this.prisma.client.aiExecutionLog.findMany({
      where: {
        businessId,
        action: { contains: role, mode: 'insensitive' },
        createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      },
      select: { action: true, createdAt: true, success: true },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    // Count pending approvals relevant to this role
    const pendingApprovals = await this.prisma.client.aiApprovalItem.count({
      where: {
        businessId,
        status: 'pending',
        toolName: { in: definition.approvedTools.map((t) => t.replace('*', '%')) },
      },
    });

    return {
      role,
      definition,
      activeGoals: goals.map((g) => ({ id: g.id, title: g.objective, progress: g.status === 'executing' ? 50 : 0 })),
      pendingActions: pendingApprovals,
      recentActivity: logs.map((l) => ({ action: l.action, timestamp: l.createdAt, success: l.success })),
    };
  }

  isToolAllowed(role: BusinessRole, toolName: string): boolean {
    const def = ROLE_DEFINITIONS[role];

    // Check blocked first
    for (const blocked of def.blockedTools) {
      if (blocked.includes('*')) {
        const prefix = blocked.replace('*', '');
        if (toolName.startsWith(prefix)) return false;
      } else if (toolName === blocked) {
        return false;
      }
    }

    // Check approved
    for (const approved of def.approvedTools) {
      if (approved.includes('*')) {
        const prefix = approved.replace('*', '');
        if (toolName.startsWith(prefix)) return true;
      } else if (toolName === approved) {
        return true;
      }
    }

    // General role can use read/organize tools by default
    if (role === 'general' && (toolName.startsWith('fetch_') || toolName.startsWith('crm_search') || toolName.startsWith('crm_list'))) {
      return true;
    }

    return false;
  }

  getSystemPromptForRole(role: BusinessRole, businessContext: string): string {
    const def = ROLE_DEFINITIONS[role];
    return `You are ${def.name}. ${def.description}

TONE: ${def.tone}

PRIORITIES:
${def.priorities.map((p) => `- ${p}`).join('\n')}

${def.systemPromptAddendum}

BUSINESS CONTEXT:
${businessContext}

RULES:
1. Only use tools in your approved list
2. Max risk tier: ${def.maxRiskTier}
3. Autonomy level: ${def.autonomyLevel}
4. Always greet with: "${def.greeting}"
5. Always sign off with: "${def.signOff}"`;
  }

  async recordRoleAction(businessId: string, role: BusinessRole, action: string, success: boolean): Promise<void> {
    await this.memory.upsert(businessId, {
      category: 'role_activity',
      key: `${role}:${action}`,
      value: JSON.stringify({ action, success, timestamp: new Date().toISOString() }),
      confidence: 1.0,
      source: 'role_engine',
    }).catch(() => {});

    this.events.emit('role.action_executed', {
      businessId,
      role,
      action,
      success,
    });
  }
}
