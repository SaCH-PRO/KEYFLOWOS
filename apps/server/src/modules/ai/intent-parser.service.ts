import { Injectable, Logger, Inject } from '@nestjs/common';
import { AiUsageService } from './ai-usage.service';
import { BusinessGraphService, BusinessGraphSnapshot } from './business-graph.service';

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

const INTENT_PARSE_SCHEMA = {
  type: 'object' as const,
  properties: {
    objective: { type: 'string', description: 'Clear, specific statement of what the user wants to accomplish' },
    urgency: { type: 'string', enum: ['low', 'normal', 'high', 'critical'], description: 'How urgent this request is based on language and business context' },
    scope: { type: 'array', items: { type: 'string' }, description: 'Business areas affected (e.g. "client relationships", "cash flow", "marketing reach")' },
    modules: { type: 'array', items: { type: 'string', enum: ['crm', 'commerce', 'bookings', 'marketing', 'content', 'projects', 'expenses', 'automations', 'storefront'] }, description: 'KeyFlowOS modules involved' },
    missingInfo: { type: 'array', items: { type: 'string' }, description: 'Information needed to fully execute this request that the user did not provide' },
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
};

const AVAILABLE_TOOLS = [
  'crm_search_contacts', 'crm_list_contacts', 'crm_create_contact', 'crm_update_contact',
  'crm_add_note', 'crm_add_task', 'crm_delete_contact',
  'commerce_list_invoices', 'commerce_create_invoice', 'commerce_mark_invoice_paid',
  'commerce_create_product', 'commerce_create_quote', 'commerce_delete_invoice',
  'bookings_list_bookings', 'bookings_list_services', 'bookings_create_booking',
  'bookings_reschedule_booking', 'bookings_cancel_booking',
  'marketing_list_campaigns', 'marketing_create_campaign', 'marketing_send_campaign',
  'social_list_posts', 'social_create_post', 'social_publish_post',
  'automations_list_playbooks', 'automations_create_playbook', 'automations_toggle_playbook',
];

@Injectable()
export class IntentParserService {
  private readonly logger = new Logger(IntentParserService.name);

  constructor(
    @Inject(AiUsageService) private readonly aiUsage: AiUsageService,
    @Inject(BusinessGraphService) private readonly businessGraph: BusinessGraphService,
  ) {}

  async parse(businessId: string, userInput: string): Promise<ParsedIntent> {
    const snapshot = await this.businessGraph.getSnapshot(businessId);
    const contextString = this.businessGraph.buildContextString(snapshot);

    const systemPrompt = `You are KeyFlow AI's intent parser. Your job is to analyze a user's natural-language request and decompose it into a structured intent object.

BUSINESS CONTEXT:
${contextString}

AVAILABLE TOOLS:
${AVAILABLE_TOOLS.join(', ')}

RISK TIERS:
- Tier 1: Safe read/organize actions (search, list, create drafts, tag, add notes/tasks)
- Tier 2: Moderate actions requiring quick confirmation (create invoices, reschedule, toggle automations)
- Tier 3: Significant changes requiring explicit approval (delete, cancel)
- Tier 4: High-impact external actions requiring admin approval (send campaigns, publish posts)

Parse the user's input and return a structured intent. Be specific about which tools would be needed. If the request is vague, note what clarification is needed.`;

    try {
      const result = await this.aiUsage.callAi({
        businessId,
        feature: 'intent_parse',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userInput },
        ],
        maxTokens: 800,
        temperature: 0.3,
        responseMode: 'structured_json',
      });

      const parsed = JSON.parse(result.content);
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
