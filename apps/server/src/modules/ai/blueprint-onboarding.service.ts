import { Inject, Injectable, Logger } from '@nestjs/common';
import { BlueprintService } from '../blueprint/blueprint.service';
import { ModelGatewayService, GatewayMessage } from './model-gateway.service';
import { AiUsageService } from './ai-usage.service';
import {
  BlueprintData,
  BlueprintPatch,
  BlueprintSectionKey,
  DnaSectionKey,
} from '../blueprint/blueprint.types';

export interface OnboardingMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface OnboardingExtraction {
  section: BlueprintSectionKey;
  field: string;
  value: unknown;
  confidence: number;
}

export interface BlueprintOnboardingState {
  messages: OnboardingMessage[];
  completedSections: BlueprintSectionKey[];
  currentSection: BlueprintSectionKey | null;
  currentQuestion: string | null;
}

interface OnboardingChatResult {
  reply: string;
  blueprint: BlueprintData;
  completeness: number;
  threePillarMinimumMet: boolean;
  confidenceScores: Record<string, number>;
  extracted: OnboardingExtraction[];
  nextSection: BlueprintSectionKey | null;
}

const SECTION_ORDER: BlueprintSectionKey[] = [
  'identity',
  'founderProfile',
  'operatingModel',
  'marketProfile',
  'constraints',
  'goals',
  'brand',
  'customerModel',
  'financials',
  'workflowModel',
  'aiPreferences',
];
// Note: 'intelligence' is intentionally excluded from onboarding; it is inferred from events.

const SECTION_FOCUS: Partial<Record<BlueprintSectionKey, { label: string; goal: string; fields: string[] }>> = {
  identity: {
    label: 'Business Identity',
    goal: 'what the business is, who it serves, and what it stands for',
    fields: ['name', 'archetype', 'industry', 'tagline', 'oneLiner', 'mission'],
  },
  operatingModel: {
    label: 'Operating Model',
    goal: 'how the business makes money and delivers value',
    fields: ['revenueModel', 'deliveryMode', 'serviceArea', 'channels', 'teamSize'],
  },
  constraints: {
    label: 'Constraints',
    goal: 'budget, time, and risk boundaries',
    fields: ['budgetRange', 'timeCommitment', 'riskTolerance'],
  },
  goals: {
    label: 'Goals',
    goal: 'what the founder is working toward and their current priorities',
    fields: ['northStar', 'ninetyDayGoals', 'twelveMonthGoals', 'priorities'],
  },
  brand: {
    label: 'Brand',
    goal: 'how the business sounds and feels',
    fields: ['voice', 'tone', 'valueProps'],
  },
  customerModel: {
    label: 'Customer Model',
    goal: 'who the ideal customer is and what they need',
    fields: ['idealCustomer', 'segments', 'painPoints'],
  },
  financials: {
    label: 'Financials',
    goal: 'pricing, targets, and cost structure',
    fields: ['currency', 'pricingModel', 'avgTicket', 'monthlyTarget'],
  },
  workflowModel: {
    label: 'Workflow Model',
    goal: 'how work moves through the business',
    fields: ['primaryWorkflow'],
  },
  aiPreferences: {
    label: 'AI Preferences',
    goal: 'how KEY should behave, communicate, and report back',
    fields: ['autonomyLevel', 'tone', 'outreachStyle', 'reportingCadence'],
  },
  founderProfile: {
    label: 'Founder Profile',
    goal: 'who is building the business, their background, skills, and availability',
    fields: ['founderName', 'background', 'skills', 'weeklyAvailabilityHours', 'riskTolerance', 'visionStatement'],
  },
  marketProfile: {
    label: 'Market Profile',
    goal: 'where the business competes, the target market, and demand signals',
    fields: ['targetGeography', 'marketCategory', 'marketStage', 'demandSignals', 'trends', 'barriersToEntry'],
  },
  intelligence: {
    label: 'Intelligence',
    goal: 'inferred patterns from business activity',
    fields: [],
  },
};

@Injectable()
export class BlueprintOnboardingService {
  private readonly logger = new Logger(BlueprintOnboardingService.name);
  private readonly stateCache = new Map<string, BlueprintOnboardingState>();

  constructor(
    @Inject(BlueprintService) private readonly blueprint: BlueprintService,
    @Inject(ModelGatewayService) private readonly gateway: ModelGatewayService,
    @Inject(AiUsageService) private readonly aiUsage: AiUsageService,
  ) {}

  async chat(
    businessId: string,
    userMessage: string,
    history: OnboardingMessage[] = [],
  ): Promise<OnboardingChatResult> {
    const blueprint = await this.blueprint.getBlueprint(businessId);
    const state = await this.getState(businessId, history);

    state.messages.push({ role: 'user', content: userMessage });

    const systemPrompt = this.buildSystemPrompt(blueprint, state);
    const gatewayMessages: GatewayMessage[] = [
      { role: 'system', content: systemPrompt },
      ...state.messages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    ];

    try {
      const completion = await this.aiUsage.trackAndComplete(
        businessId,
        undefined,
        'blueprint_onboarding',
        {
          messages: gatewayMessages,
          temperature: 0.7,
          maxTokens: 1200,
        },
      );

      const rawReply = completion.content || "Let's keep building your Business Genome. What else should I know?";
      const { reply, extractions } = this.parseExtractions(rawReply);

      state.messages.push({ role: 'assistant', content: reply });

      const patch = this.buildPatchFromExtractions(extractions);
      const updatedBlueprint = Object.keys(patch).length > 0
        ? await this.blueprint.updateBlueprint(businessId, patch)
        : blueprint;

      const nextSection = this.chooseNextSection(updatedBlueprint, state);
      state.currentSection = nextSection;
      state.currentQuestion = nextSection ? this.firstQuestionForSection(nextSection) : null;
      this.stateCache.set(businessId, state);

      return {
        reply,
        blueprint: updatedBlueprint,
        completeness: updatedBlueprint.completeness,
        threePillarMinimumMet: this.blueprint.checkThreePillarMinimum(
          (updatedBlueprint.genomeDnaScores ?? {}) as Record<DnaSectionKey, number>,
        ),
        confidenceScores: updatedBlueprint.confidenceScores as Record<string, number>,
        extracted: extractions,
        nextSection,
      };
    } catch (err: any) {
      this.logger.error(`Blueprint onboarding chat failed: ${(err as Error).message}`);
      const fallback = "I'm having trouble thinking that through. Could you tell me a bit more about your business?";
      state.messages.push({ role: 'assistant', content: fallback });
      return {
        reply: fallback,
        blueprint,
        completeness: blueprint.completeness,
        threePillarMinimumMet: this.blueprint.checkThreePillarMinimum(
          (blueprint.genomeDnaScores ?? {}) as Record<DnaSectionKey, number>,
        ),
        confidenceScores: blueprint.confidenceScores as Record<string, number>,
        extracted: [],
        nextSection: state.currentSection,
      };
    }
  }

  async getState(businessId: string, history?: OnboardingMessage[]): Promise<BlueprintOnboardingState> {
    const cached = this.stateCache.get(businessId);
    if (cached) return cached;

    const blueprint = await this.blueprint.getBlueprint(businessId);
    const completedSections = this.getCompletedSections(blueprint);
    const nextSection = this.chooseNextSection(blueprint, { completedSections, currentSection: null } as BlueprintOnboardingState);

    const state: BlueprintOnboardingState = {
      messages: history || [],
      completedSections,
      currentSection: nextSection,
      currentQuestion: nextSection ? this.firstQuestionForSection(nextSection) : null,
    };

    this.stateCache.set(businessId, state);
    return state;
  }

  reset(businessId: string): void {
    this.stateCache.delete(businessId);
  }

  private buildSystemPrompt(blueprint: BlueprintData, state: BlueprintOnboardingState): string {
    const completed = state.completedSections;
    const remaining = SECTION_ORDER.filter(s => !completed.includes(s));
    const current = state.currentSection || remaining[0] || null;

    const blueprintSummary = [
      `Business: ${blueprint.identity.name || 'unknown'}`,
      blueprint.identity.industry ? `Industry: ${blueprint.identity.industry}` : null,
      blueprint.operatingModel.revenueModel ? `Revenue model: ${blueprint.operatingModel.revenueModel}` : null,
      blueprint.goals.northStar ? `North star: ${blueprint.goals.northStar}` : null,
      blueprint.customerModel.idealCustomer ? `Ideal customer: ${blueprint.customerModel.idealCustomer}` : null,
      `Completeness: ${blueprint.completeness}%`,
    ].filter(Boolean).join('\n');

    return `You are KEY, the AI co-founder inside KeyFlowOS. You are conducting a friendly, focused onboarding interview to build the user's Business Genome — a structured blueprint that lets KEY operate as a digital executive for their business.

CURRENT BUSINESS CONTEXT:
${blueprintSummary}

SECTIONS ALREADY COVERED: ${completed.length > 0 ? completed.map(s => SECTION_FOCUS[s]?.label ?? s).join(', ') : 'None yet'}

SECTIONS STILL TO COVER: ${remaining.length > 0 ? remaining.map(s => SECTION_FOCUS[s]?.label ?? s).join(', ') : 'All core sections covered'}

CURRENT FOCUS SECTION: ${current ? SECTION_FOCUS[current]?.label ?? current : 'None — summarizing'}

GOAL OF CURRENT SECTION: ${current ? SECTION_FOCUS[current]?.goal ?? 'N/A' : 'N/A'}

IMPORTANT INSTRUCTIONS:
1. Be warm, concise, and conversational. Ask ONE clear question at a time.
2. Do not read like a survey. Flow naturally from what the user says.
3. Always acknowledge what the user shared before moving on.
4. If the user shares multiple useful facts in one message, extract them all.
5. When you have enough to fill the current section, celebrate briefly and move to the next section naturally.
6. If the user is vague, ask a gentle follow-up. If they are detailed, move forward.
7. Never ask for sensitive data like passwords, API keys, or bank details.
8. Keep total reply under 3 short paragraphs.

When you extract structured facts, include them in a JSON block at the END of your response:

\`\`\`extract
[
  {"section": "identity", "field": "name", "value": "Acme Consulting", "confidence": 0.95},
  {"section": "operatingModel", "field": "revenueModel", "value": "consulting retainers", "confidence": 0.9}
]
\`\`\`

Valid sections and fields:
${Object.entries(SECTION_FOCUS).map(([key, meta]) => `- ${key}: ${meta.fields.join(', ')}`).join('\n')}

For array fields (e.g., channels, ninetyDayGoals, segments, painPoints, valueProps), return value as a JSON array of strings.
For autonomyLevel, return an integer 1-5 where 1 = always ask first, 5 = act autonomously.
For numeric fields, return a number.
Confidence: 0.6 for inferred, 0.85 for stated clearly, 1.0 for explicitly confirmed.`;
  }

  private parseExtractions(rawReply: string): { reply: string; extractions: OnboardingExtraction[] } {
    const extractMatch = rawReply.match(/```extract\s*\n([\s\S]*?)\n```/);
    const reply = rawReply.replace(/```extract\s*\n[\s\S]*?\n```/g, '').trim();
    const extractions: OnboardingExtraction[] = [];

    if (extractMatch) {
      try {
        const parsed = JSON.parse(extractMatch[1]) as Array<{
          section?: string;
          field?: string;
          value?: unknown;
          confidence?: number;
        }>;
        for (const item of parsed) {
          if (!item.section || !item.field || item.value === undefined) continue;
          if (!SECTION_ORDER.includes(item.section as BlueprintSectionKey)) continue;
          extractions.push({
            section: item.section as BlueprintSectionKey,
            field: item.field,
            value: item.value,
            confidence: typeof item.confidence === 'number' ? Math.min(item.confidence, 1) : 0.8,
          });
        }
      } catch (err: any) {
        this.logger.warn(`Failed to parse onboarding extraction block: ${(err as Error).message}`);
      }
    }

    return { reply, extractions };
  }

  private buildPatchFromExtractions(extractions: OnboardingExtraction[]): BlueprintPatch {
    const patch: BlueprintPatch = {};
    const bySection = new Map<BlueprintSectionKey, Record<string, unknown>>();

    for (const ext of extractions) {
      if (!bySection.has(ext.section)) {
        bySection.set(ext.section, {});
      }
      bySection.get(ext.section)![ext.field] = ext.value;
    }

    for (const [section, fields] of bySection.entries()) {
      (patch as Record<BlueprintSectionKey, Record<string, unknown>>)[section] = fields;
    }

    return patch;
  }

  private getCompletedSections(blueprint: BlueprintData): BlueprintSectionKey[] {
    return SECTION_ORDER.filter(section => {
      const focus = SECTION_FOCUS[section];
      if (!focus) return false;
      const data = blueprint[section] as Record<string, unknown>;
      const filled = focus.fields.filter(f => this.isPopulated(data?.[f])).length;
      return filled >= Math.ceil(focus.fields.length * 0.6);
    });
  }

  private chooseNextSection(
    blueprint: BlueprintData,
    state: Pick<BlueprintOnboardingState, 'completedSections' | 'currentSection'>,
  ): BlueprintSectionKey | null {
    const completed = state.completedSections;
    const incomplete = SECTION_ORDER.filter(s => !completed.includes(s));

    if (incomplete.length === 0) return null;

    // Prefer current section if not yet complete
    if (state.currentSection && incomplete.includes(state.currentSection)) {
      return state.currentSection;
    }

    // Choose the least-filled incomplete section
    return incomplete.sort((a, b) => {
      const scoreA = this.sectionFillScore(blueprint, a);
      const scoreB = this.sectionFillScore(blueprint, b);
      return scoreA - scoreB;
    })[0];
  }

  private sectionFillScore(blueprint: BlueprintData, section: BlueprintSectionKey): number {
    const focus = SECTION_FOCUS[section];
    if (!focus) return 0;
    const data = blueprint[section] as Record<string, unknown>;
    const filled = focus.fields.filter(f => this.isPopulated(data?.[f])).length;
    return filled / focus.fields.length;
  }

  private firstQuestionForSection(section: BlueprintSectionKey): string {
    const questions: Partial<Record<BlueprintSectionKey, string | undefined>> = {
      identity: "To get started, what's your business name and what do you do in one sentence?",
      operatingModel: 'How does your business make money today?',
      constraints: "What's your approximate monthly budget for growth tools and marketing?",
      goals: "What's the single most important outcome you want in the next 90 days?",
      brand: 'How would you describe your brand voice — professional, playful, bold, calm?',
      customerModel: 'Who is your ideal customer? Describe them as specifically as you can.',
      financials: "What's your average transaction or project value?",
      workflowModel: 'How do customers typically move from first contact to delivered outcome?',
      aiPreferences: 'On a scale of 1-5, how much should KEY act on its own versus ask you first?',
      intelligence: undefined,
    };
    return questions[section] || "Tell me more about your business.";
  }

  private isPopulated(value: unknown): boolean {
    if (value === null || value === undefined) return false;
    if (typeof value === 'string') return value.trim().length > 0;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'number') return !Number.isNaN(value);
    if (typeof value === 'object') return Object.keys(value as object).length > 0;
    return Boolean(value);
  }
}
