import { Injectable, Logger, Optional } from '@nestjs/common';
import { TaskCategory } from '../ai/model-gateway.service';
import { CortexQuery, CortexSession, CortexMessage } from './key-cortex.types';
import type { ModuleName } from './key-cortex-connector.types';
import { KeyCortexLearningService } from './key-cortex-learning.service';

export type QueryComplexity = 'simple' | 'moderate' | 'complex';
export type QueryDomain =
  | 'general'
  | 'finance'
  | 'ops'
  | 'sales'
  | 'marketing'
  | 'product'
  | 'people'
  | 'legal';
export type QueryUrgency = 'low' | 'medium' | 'high' | 'critical';
export type EmotionalWeight = 'low' | 'medium' | 'high';
export type TimeHorizon = 'immediate' | 'tactical' | 'strategic';
export type DataRequirement = 'none' | 'factual' | 'analytical' | 'predictive';
export type PromptVariant = 'concise' | 'standard' | 'deep';
export type ReasoningLayer =
  | 'emotion'
  | 'reasoning'
  | 'creativity'
  | 'temporal'
  | 'ethics'
  | 'actions';

export interface RouteDecision {
  taskCategory: TaskCategory;
  layers: ReasoningLayer[];
  promptVariant: PromptVariant;
  includeGenomeContext: boolean;
  includeMemoryContext: boolean;
  includeActions: boolean;
  moduleRoute?: ModuleName;
  temperatureOverride?: number;
  maxTokensOverride?: number;
  promptTemplate?: string;
  complexity: QueryComplexity;
  domain: QueryDomain;
  urgency: QueryUrgency;
  emotionalWeight: EmotionalWeight;
  timeHorizon: TimeHorizon;
  dataRequirement: DataRequirement;
}

export interface QueryDimensions {
  complexity: QueryComplexity;
  domain: QueryDomain;
  urgency: QueryUrgency;
  emotionalWeight: EmotionalWeight;
  timeHorizon: TimeHorizon;
  dataRequirement: DataRequirement;
}

/**
 * AdaptiveRouterService — lightweight rule-based query router for KEY Cortex.
 *
 * Classifies incoming queries across multiple dimensions and decides which
 * reasoning layers, prompt variant, and context sources to use. Keeps latency
 * low by avoiding an extra LLM call; classification is regex/keyword based.
 */
@Injectable()
export class AdaptiveRouterService {
  private readonly logger = new Logger(AdaptiveRouterService.name);

  constructor(
    @Optional()
    private readonly learning?: KeyCortexLearningService,
  ) {}

  /**
   * Route a query to the appropriate reasoning configuration.
   */
  async route(
    query: CortexQuery,
    session?: CortexSession | null,
    recentMessages?: CortexMessage[],
  ): Promise<RouteDecision> {
    const text = query.text;
    const lower = text.toLowerCase();
    const dimensions = this.classifyDimensions(lower, query, recentMessages);
    const taskCategory = this.resolveTaskCategory(lower, query, dimensions);
    const layers = this.resolveLayers(dimensions, query);
    let promptVariant = this.resolvePromptVariant(dimensions);
    let promptTemplate: string | undefined;

    if (this.learning && query.businessId) {
      try {
        const variant = await this.learning.selectVariant(query.businessId, promptVariant);
        if (variant) {
          promptVariant = variant.variantKey as PromptVariant;
          promptTemplate = variant.promptTemplate;
        }
      } catch (err: unknown) {
        this.logger.warn(
          `[route] Variant selection failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    const includeGenomeContext = this.shouldIncludeGenomeContext(dimensions);
    const includeMemoryContext = this.shouldIncludeMemoryContext(dimensions);
    const includeActions =
      query.enableActions === true && layers.includes('actions');
    const moduleRoute = this.resolveModuleRoute(text, dimensions, taskCategory);

    const decision: RouteDecision = {
      ...dimensions,
      taskCategory,
      layers,
      promptVariant,
      includeGenomeContext,
      includeMemoryContext,
      includeActions,
      moduleRoute,
      promptTemplate,
      temperatureOverride: this.resolveTemperature(dimensions, promptVariant),
      maxTokensOverride: this.resolveMaxTokens(dimensions, promptVariant),
    };

    this.logger.debug(
      `[route] ${taskCategory} | complexity=${decision.complexity} | layers=[${decision.layers.join(',')}] | prompt=${decision.promptVariant}`,
    );
    return decision;
  }

  /**
   * Classify a query across all dimensions.
   */
  classifyDimensions(
    lower?: string,
    query?: CortexQuery,
    _recentMessages?: CortexMessage[],
  ): QueryDimensions {
    const text = lower ?? query?.text.toLowerCase() ?? '';
    const domain = this.classifyDomain(text);

    return {
      complexity: this.classifyComplexity(text),
      domain,
      urgency: this.classifyUrgency(text, query?.mood),
      emotionalWeight: this.classifyEmotionalWeight(text, query?.mood),
      timeHorizon: this.classifyTimeHorizon(text),
      dataRequirement: this.classifyDataRequirement(text, domain),
    };
  }

  private classifyComplexity(text: string): QueryComplexity {
    const complexMarkers =
      /\b(strategy|plan|roadmap|forecast|model|scenario|compare|evaluate|assess|why|how should|what if|trade-off|risk analysis|due diligence|comprehensive|deep dive|multi-step|action plan)\b/;
    // Deliberative decisions. Measured against real phrasing, the list above
    // missed every one of them: "should we take the series a term sheet",
    // "should we hire or outsource" and "is it worth raising prices" all came
    // back `moderate`, because it carries "how should" but not "should we".
    // These are the queries most worth thinking hard about, so a router that
    // under-rates them under-rates exactly the wrong thing.
    const decisionMarkers =
      /\b(should (we|i)|do we (need|have to)|is it worth|worth (it|doing)|which (option|one) should|or should we|better to|pros and cons)\b/;
    const simpleMarkers =
      /\b(hello|hi|hey|what is|who is|when is|where is|define|yes|no|ok|thanks|thank you|goodbye|bye)\b/;

    if (complexMarkers.test(text) || decisionMarkers.test(text)) return 'complex';
    // Checked AFTER the complex markers on purpose: simpleMarkers contains
    // "what is", so "what is the right way to structure this deal" would
    // otherwise be graded simple on its first two words.
    if (simpleMarkers.test(text)) return 'simple';
    return 'moderate';
  }

  private classifyDomain(text: string): QueryDomain {
    if (/\b(revenue|profit|margin|cash flow|expense|budget|invoice|payment|pricing|cost|financial|p&l|roi)\b/.test(text))
      return 'finance';
    if (/\b(task|workflow|automation|process|operations|inventory|supply|logistics|delivery|fulfillment)\b/.test(text))
      return 'ops';
    if (/\b(lead|deal|pipeline|crm|customer|client|prospect|sale|contract|opportunity)\b/.test(text))
      return 'sales';
    if (/\b(campaign|ad|marketing|seo|content|social|email|conversion|funnel|brand|audience)\b/.test(text))
      return 'marketing';
    if (/\b(product|feature|roadmap|release|bug|user story|requirements|spec)\b/.test(text))
      return 'product';
    if (/\b(team|hire|employee|hr|payroll|benefit|performance|review|people|culture)\b/.test(text))
      return 'people';
    if (/\b(legal|contract|compliance|regulation|gdpr|privacy|terms|liability|ip)\b/.test(text))
      return 'legal';
    return 'general';
  }

  private classifyUrgency(text: string, mood?: string): QueryUrgency {
    const critical =
      /\b(urgent|asap|immediately|critical|down|outage|breach|emergency|panic|deadline today|deadline tomorrow)\b/;
    const high =
      /\b(urgent|deadline|due soon|blocked|stuck|need to|important|priority)\b/;

    if (critical.test(text) || mood === 'urgent') return 'critical';
    if (high.test(text)) return 'high';
    if (/\b(when|soon|upcoming|next week|next month)\b/.test(text)) return 'medium';
    return 'low';
  }

  private classifyEmotionalWeight(text: string, mood?: string): EmotionalWeight {
    const high =
      /\b(frustrated|angry|stressed|worried|anxious|disappointed|upset|annoyed|furious|panic|afraid)\b/;
    const medium =
      /\b(excited|happy|concerned|unsure|confused|curious|hopeful|nervous)\b/;

    if (high.test(text) || mood === 'urgent') return 'high';
    if (medium.test(text)) return 'medium';
    return 'low';
  }

  private classifyTimeHorizon(text: string): TimeHorizon {
    if (/\b(today|now|right now|immediately|asap|this hour|within the hour)\b/.test(text))
      return 'immediate';
    if (
      /\b(strategy|long term|long-term|vision|3 year|5 year|yearly|annual|future|roadmap|next year|next \d+ months?|in \d+ months?)\b/.test(text)
    )
      return 'strategic';
    return 'tactical';
  }

  private classifyDataRequirement(text: string, domain?: QueryDomain): DataRequirement {
    if (/\b(forecast|predict|projection|trend|next month|next quarter|what if|scenario)\b/.test(text))
      return 'predictive';
    if (
      domain === 'finance' ||
      /\b(kpi|metric|report|number|data|analysis|analytics|performance|revenue|conversion|margin|profit|expense)\b/.test(text)
    )
      return 'analytical';
    if (/\b(what is|who is|when is|where is|how many|list|show me|find|lookup)\b/.test(text))
      return 'factual';
    return 'none';
  }

  private resolveTaskCategory(
    text: string,
    query: CortexQuery | undefined,
    dimensions: QueryDimensions,
  ): TaskCategory {
    // Action/tool-calling takes precedence when enabled
    if (
      query?.enableActions &&
      /\b(create|make|schedule|send|update|delete|run|execute|build|generate|draft)\b/.test(text)
    ) {
      return 'tool-calling';
    }

    // Code and creative are strong signals
    if (/\b(code|function|typescript|javascript|python|script|api|endpoint|bug|debug)\b/.test(text))
      return 'code';
    if (/\b(forecast|predict|projection|trend|seasonality|next month|next quarter)\b/.test(text))
      return 'forecasting';
    if (/\b(emotion|feel|tone|sentiment|subtext|urgent|stressed|frustrated|excited)\b/.test(text))
      return 'emotion-analysis';
    if (/\b(idea|creative|brainstorm|write|draft|campaign|slogan|content|story)\b/.test(text))
      return 'creative';

    // Data-driven analytical tasks
    if (dimensions.dataRequirement === 'analytical' || dimensions.domain === 'finance')
      return 'analysis';

    // Extraction / summarization / classification
    if (/\b(extract|pull|parse|get the|retrieve)\b/.test(text)) return 'extraction';
    if (/\b(summarize|summary|tl;dr|recap)\b/.test(text)) return 'summarization';
    if (/\b(classify|categorize|tag|label|sort into)\b/.test(text)) return 'classification';

    // Reasoning / strategy
    if (
      /\b(analyze|reason|think|why|how does|explain|compare|evaluate|assess|strategy|recommend|should i|what if)\b/.test(text) ||
      dimensions.complexity === 'complex'
    ) {
      return 'reasoning';
    }

    // Content generation for moderate creative tasks
    if (/\b(draft|write|compose|message|email|response|proposal)\b/.test(text))
      return 'content-generation';

    return 'general';
  }

  private resolveLayers(
    dimensions: QueryDimensions,
    query: CortexQuery | undefined,
  ): ReasoningLayer[] {
    const layers: Set<ReasoningLayer> = new Set(['ethics']);

    // Emotion layer for emotional or urgent queries
    if (dimensions.emotionalWeight !== 'low' || dimensions.urgency === 'critical') {
      layers.add('emotion');
    }

    // Reasoning layer for moderate+ complexity or analytical/predictive needs
    if (
      dimensions.complexity !== 'simple' ||
      dimensions.dataRequirement === 'analytical' ||
      dimensions.dataRequirement === 'predictive'
    ) {
      layers.add('reasoning');
    }

    // Temporal layer for time-sensitive or strategic queries
    if (dimensions.timeHorizon === 'strategic' || dimensions.dataRequirement === 'predictive') {
      layers.add('temporal');
    }

    // Creativity layer for creative/domain tasks
    if (
      /\b(idea|creative|brainstorm|write|draft|campaign|slogan|content|story|proposal)\b/.test(
        query?.text.toLowerCase() ?? '',
      )
    ) {
      layers.add('creativity');
    }

    // Actions layer when actions are enabled and query implies action
    if (
      query?.enableActions &&
      /\b(create|make|schedule|send|update|delete|run|execute|build|generate|draft)\b/.test(
        query?.text.toLowerCase() ?? '',
      )
    ) {
      layers.add('actions');
    }

    return Array.from(layers);
  }

  private resolvePromptVariant(dimensions: QueryDimensions): PromptVariant {
    if (dimensions.complexity === 'simple' && dimensions.dataRequirement === 'none')
      return 'concise';
    if (dimensions.complexity === 'complex' || dimensions.dataRequirement === 'predictive')
      return 'deep';
    return 'standard';
  }

  private shouldIncludeGenomeContext(dimensions: QueryDimensions): boolean {
    // Genome context helps for strategic, analytical, or domain-specific queries
    return (
      dimensions.complexity !== 'simple' ||
      dimensions.dataRequirement !== 'none' ||
      dimensions.timeHorizon === 'strategic' ||
      dimensions.domain !== 'general'
    );
  }

  /**
   * Decide whether the unified memory layer should contribute context.
   * Memory is useful for almost everything except the simplest greetings.
   */
  private shouldIncludeMemoryContext(dimensions: QueryDimensions): boolean {
    return !(
      dimensions.complexity === 'simple' &&
      dimensions.dataRequirement === 'none' &&
      dimensions.domain === 'general'
    );
  }

  /**
   * Map a query to the most relevant KeyFlowOS module/organ.
   */
  resolveModuleRoute(
    text: string,
    _dimensions: QueryDimensions,
    _taskCategory: TaskCategory,
  ): ModuleName | undefined {
    const lower = text.toLowerCase();

    if (/\b(revenue|profit|margin|cash flow|expense|budget|invoice|invoices|payment|payments|pricing|cost|p&l|roi|financials)\b/.test(lower))
      return 'commerce';
    if (/\b(lead|leads|deal|deals|pipeline|crm|contact|contacts|client|clients|prospect|prospects|opportunity|opportunities)\b/.test(lower))
      return 'crm';
    if (/\b(calendar|booking|bookings|appointment|appointments|reservation|schedule|scheduled|availability)\b/.test(lower))
      return 'bookings';
    if (/\b(content|blog|post|posts|article|articles|campaign|campaigns|social|social media|seo|landing page|newsletter)\b/.test(lower))
      return 'content';
    if (/\b(email|sms|whatsapp|message|messages|communication|communications|notification|notifications|broadcast)\b/.test(lower))
      return 'communications';
    if (/\b(workflow|workflows|automation|automations|flow|flows|trigger|triggers)\b/.test(lower))
      return 'flow';
    if (/\b(task|tasks|project|projects|milestone|milestones|board|sprint|backlog)\b/.test(lower))
      return 'projects';

    return undefined;
  }

  private resolveTemperature(
    dimensions: QueryDimensions,
    variant: PromptVariant,
  ): number | undefined {
    if (variant === 'concise') return 0.3;
    if (dimensions.emotionalWeight === 'high') return 0.75;
    if (dimensions.complexity === 'complex') return 0.7;
    return 0.6;
  }

  private resolveMaxTokens(
    dimensions: QueryDimensions,
    variant: PromptVariant,
  ): number | undefined {
    if (variant === 'concise') return 512;
    if (variant === 'deep' || dimensions.complexity === 'complex') return 2048;
    return 1024;
  }
}
