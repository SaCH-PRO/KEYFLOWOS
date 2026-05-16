import { Injectable, Logger, Inject } from '@nestjs/common';
import { BusinessGraphService } from './business-graph.service';
import { AiMemoryService } from './ai-memory.service';
import { ModelGatewayService, GatewayMessage } from './model-gateway.service';
import { AiUsageService } from './ai-usage.service';

export interface ParsedIntent {
  objective: string;
  urgency: 'low' | 'normal' | 'high' | 'critical';
  scope: string[];
  modules: string[];
  missingInfo: string[];
  actionCandidates: Array<{
    toolName: string;
    description: string;
    confidence: number;
    riskTier: number;
  }>;
  clarificationNeeded: boolean;
  clarificationQuestion?: string;
  rawInput: string;
}

const PARSE_INTENT_FUNCTION = {
  type: 'function' as const,
  function: {
    name: 'parse_intent',
    description: 'Parse user input into a structured intent for the KeyFlowOS AI pipeline',
    parameters: {
      type: 'object',
      properties: {
        objective: { type: 'string', description: 'Clear, specific statement of what the user wants to accomplish' },
        urgency: { type: 'string', enum: ['low', 'normal', 'high', 'critical'], description: 'How urgent this request is based on language and business context' },
        scope: {
          type: 'array',
          items: { type: 'string' },
          description: 'Business areas affected (e.g. "client relationships", "cash flow", "marketing reach")',
        },
        modules: {
          type: 'array',
          items: { type: 'string', enum: ['crm', 'commerce', 'bookings', 'marketing', 'social', 'content', 'projects', 'expenses', 'automations', 'storefront', 'seo', 'documents', 'community', 'marketplace', 'store', 'finance'] },
          description: 'KeyFlowOS modules involved',
        },
        missingInfo: {
          type: 'array',
          items: { type: 'string' },
          description: 'Information needed to fully execute this request that the user did not provide',
        },
        actionCandidates: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              toolName: { type: 'string', description: 'The tool name from the available tool registry' },
              description: { type: 'string', description: 'What this action would do in this context' },
              confidence: { type: 'number', description: 'Confidence this action is needed (0-1)' },
              riskTier: { type: 'number', description: 'Risk level 1-4' },
            },
            required: ['toolName', 'description', 'confidence', 'riskTier'],
          },
        },
        clarificationNeeded: { type: 'boolean', description: 'Whether additional info is needed before planning' },
        clarificationQuestion: { type: 'string', description: 'If clarification needed, the question to ask' },
      },
      required: ['objective', 'urgency', 'scope', 'modules', 'missingInfo', 'actionCandidates', 'clarificationNeeded'],
    },
  },
};

const AVAILABLE_TOOLS = [
  // Read family — business intelligence
  'fetch_business_summary', 'fetch_client_health', 'fetch_schedule_health', 'fetch_revenue_risk',
  'fetch_storefront_quality', 'fetch_project_status', 'fetch_expense_pressure',
  'fetch_seo_dashboard', 'fetch_seo_keywords', 'fetch_seo_issues', 'fetch_content_gaps',
  'fetch_seo_revenue_attribution',
  // Draft family — AI-generated content
  'draft_followup_message', 'draft_campaign_bundle', 'draft_payment_reminder',
  'draft_storefront_copy', 'draft_project_update', 'generate_content_brief',
  // Organize family — internal actions
  'create_task', 'create_followup_queue', 'tag_contact', 'segment_contacts',
  'schedule_action', 'sync_seo_pages', 'keyflow_create_note',
  // Execute family — significant actions
  'queue_campaign', 'send_message_with_approval', 'apply_storefront_recommendation',
  'enable_flow_with_approval', 'update_status_with_confirmation',
  // Delegation loops — autonomous workflows
  'delegation_payment_recovery', 'delegation_lead_reactivation', 'delegation_post_purchase',
  'delegation_booking_prep', 'delegation_weekly_hygiene',
  // CRUD family — CRM
  'crm_search_contacts', 'crm_list_contacts', 'crm_create_contact', 'crm_update_contact',
  'crm_add_note', 'crm_add_task', 'crm_delete_contact',
  // CRUD family — Commerce
  'commerce_list_invoices', 'commerce_create_invoice', 'commerce_mark_invoice_paid',
  'commerce_create_product', 'commerce_create_quote', 'commerce_delete_invoice',
  // CRUD family — Bookings
  'bookings_list_bookings', 'bookings_list_services', 'bookings_create_booking',
  'bookings_reschedule_booking', 'bookings_cancel_booking',
  // CRUD family — Marketing
  'marketing_list_campaigns', 'marketing_create_campaign', 'marketing_send_campaign',
  // CRUD family — Social
  'social_list_posts', 'social_create_post', 'social_publish_post',
  // CRUD family — Automations
  'automations_list_playbooks', 'automations_create_playbook', 'automations_toggle_playbook',
  // CRUD family — Projects
  'projects_list', 'projects_list_tasks', 'projects_create_task', 'projects_complete_task',
  // CRUD family — Expenses
  'expenses_list', 'expenses_create',
  // CRUD family — Documents
  'documents_list', 'documents_search',
  // CRUD family — Community
  'community_list_posts',
  // CRUD family — Marketplace
  'marketplace_list_listings', 'marketplace_list_orders',
  // CRUD family — Store
  'store_list_products', 'store_list_recent_orders',
];

@Injectable()
export class IntentParserService {
  private readonly logger = new Logger(IntentParserService.name);

  constructor(
    @Inject(BusinessGraphService) private readonly businessGraph: BusinessGraphService,
    @Inject(AiMemoryService) private readonly memory: AiMemoryService,
    @Inject(ModelGatewayService) private readonly gateway: ModelGatewayService,
    @Inject(AiUsageService) private readonly aiUsage: AiUsageService,
  ) {}

  async parse(businessId: string, userInput: string): Promise<ParsedIntent> {
    const snapshot = await this.businessGraph.getSnapshot(businessId);
    const contextString = this.businessGraph.buildContextString(snapshot);

    const memoryCtx = await this.memory.buildContextBlock(businessId);
    const memorySection = this.memory.buildPromptSection(memoryCtx);

    const systemPrompt = `You are KeyFlow AI's intent parser. Your job is to analyze a user's natural-language request and call the parse_intent function with a structured intent object.

BUSINESS CONTEXT:
${contextString}${memorySection}

AVAILABLE TOOLS:
${AVAILABLE_TOOLS.join(', ')}

RISK TIERS:
- Tier 1: Safe read/organize actions (search, list, create drafts, tag, add notes/tasks)
- Tier 2: Moderate actions requiring quick confirmation (create invoices, reschedule, toggle automations)
- Tier 3: Significant changes requiring explicit approval (delete, cancel)
- Tier 4: High-impact external actions requiring admin approval (send campaigns, publish posts)

Parse the user's input and call parse_intent with the structured result. Be specific about which tools would be needed. If the request is vague, note what clarification is needed.`;

    try {
      const messages: GatewayMessage[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userInput },
      ];

      const response = await this.aiUsage.trackAndComplete(
        businessId,
        undefined,
        'intent_parse',
        {
          messages,
          tools: [PARSE_INTENT_FUNCTION],
          toolChoice: { type: 'function', function: { name: 'parse_intent' } },
          maxTokens: 800,
          temperature: 0.3,
          expectedContract: 'intent_parse',
        },
      );

      const toolCall = response.toolCalls?.[0];
      if (!toolCall) {
        this.logger.warn('Gateway did not return expected function call, falling back');
        return this.fallbackParse(userInput);
      }

      const parsed = JSON.parse(toolCall.function.arguments);
      return {
        objective: parsed.objective || userInput,
        urgency: parsed.urgency || 'normal',
        scope: parsed.scope || [],
        modules: parsed.modules || [],
        missingInfo: parsed.missingInfo || [],
        actionCandidates: (parsed.actionCandidates || []).map((ac: any) => ({
          toolName: ac.toolName,
          description: ac.description,
          confidence: typeof ac.confidence === 'number' ? ac.confidence : 0.5,
          riskTier: typeof ac.riskTier === 'number' ? ac.riskTier : 2,
        })),
        clarificationNeeded: parsed.clarificationNeeded ?? false,
        clarificationQuestion: parsed.clarificationQuestion,
        rawInput: userInput,
      };
    } catch (err) {
      this.logger.warn(`Intent parse fallback for: ${userInput.slice(0, 100)}... Error: ${(err as Error).message}`);
      return this.fallbackParse(userInput);
    }
  }

  private fallbackParse(userInput: string): ParsedIntent {
    const lower = userInput.toLowerCase();
    const modules: string[] = [];
    const actionCandidates: ParsedIntent['actionCandidates'] = [];

    if (lower.includes('contact') || lower.includes('client') || lower.includes('lead') || lower.includes('customer')) {
      modules.push('crm');
    }
    if (lower.includes('invoice') || lower.includes('payment') || lower.includes('quote') || lower.includes('product')) {
      modules.push('commerce');
    }
    if (lower.includes('booking') || lower.includes('appointment') || lower.includes('schedule')) {
      modules.push('bookings');
    }
    if (lower.includes('campaign') || lower.includes('email') || lower.includes('newsletter')) {
      modules.push('marketing');
    }
    if (lower.includes('post') || lower.includes('social') || lower.includes('content')) {
      modules.push('content');
    }
    if (lower.includes('project') || lower.includes('task') || lower.includes('milestone')) {
      modules.push('projects');
    }
    if (lower.includes('expense') || lower.includes('budget') || lower.includes('spending')) {
      modules.push('expenses');
    }
    if (lower.includes('automation') || lower.includes('flow') || lower.includes('playbook')) {
      modules.push('automations');
    }

    let urgency: ParsedIntent['urgency'] = 'normal';
    if (lower.includes('urgent') || lower.includes('asap') || lower.includes('immediately') || lower.includes('right now')) {
      urgency = 'high';
    }
    if (lower.includes('critical') || lower.includes('emergency')) {
      urgency = 'critical';
    }

    return {
      objective: userInput,
      urgency,
      scope: modules,
      modules,
      missingInfo: [],
      actionCandidates,
      clarificationNeeded: modules.length === 0,
      clarificationQuestion: modules.length === 0 ? 'Could you be more specific about what you\'d like me to help with?' : undefined,
      rawInput: userInput,
    };
  }
}
