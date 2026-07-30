export interface IntentParseContract {
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
}

export interface WorkflowPlanContract {
  steps: Array<{
    order: number;
    toolName: string | null;
    module: string | null;
    action: string;
    description: string;
    riskTier: number;
    dependsOnOrders: number[];
    inputPayload: Record<string, unknown> | null;
    expectedBenefit: string | null;
  }>;
}

export interface ReplyDraftContract {
  subject?: string;
  body: string;
  channel?: string;
  contactName?: string;
  tone?: string;
}

export interface ContentBriefContract {
  headline: string;
  description: string;
  tagline?: string;
  keywords?: string[];
  targetAudience?: string;
}

export interface LeadScoreExplanationContract {
  score: number;
  factors: Array<{
    name: string;
    impact: 'positive' | 'negative' | 'neutral';
    weight: number;
    detail: string;
  }>;
  recommendation: string;
}

export interface QuoteRecommendationContract {
  suggestedTotal: number;
  currency: string;
  lineItems: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
    total: number;
  }>;
  rationale: string;
  confidenceLevel: 'low' | 'medium' | 'high';
}

export interface BusinessModelContract {
  overview: string;
  valueProposition: string;
  revenueStreams: string[];
  targetMarket: string;
  keyActivities: string[];
  costStructure: string[];
  recommendations: string[];
}

export interface GenesisIdeaExtractionContract {
  summary: string;
  identity: {
    name?: string;
    archetype?: string;
    industry?: string;
    oneLiner?: string;
    country?: string;
  };
  operatingModel?: {
    revenueModel?: string;
    deliveryMode?: string;
    serviceArea?: string;
    teamSize?: string;
    channels?: string[];
  };
  legalProfile?: {
    recommendedEntityType?: string;
    entityTypeReason?: string;
    regulatedIndustry?: boolean;
    regulatedIndustryNotes?: string[];
  };
  customerModel?: {
    idealCustomer?: string;
    segments?: string[];
    painPoints?: string[];
  };
  marketProfile?: {
    targetGeography?: string;
    marketCategory?: string;
    marketStage?: string;
    demandSignals?: string[];
  };
  financials?: {
    pricingModel?: string;
    avgTicket?: number;
    currency?: string;
  };
  projectionProfile?: {
    startupCapital?: number;
    startupCosts?: number;
    monthlyFixedCosts?: number;
    expectedMonthlyUnits?: number;
    variableCostPercent?: number;
  };
  founderProfile?: {
    founderName?: string;
    background?: string;
    skills?: string[];
    weeklyAvailabilityHours?: number;
    riskTolerance?: string;
  };
  goals?: {
    northStar?: string;
  };
  constraints?: {
    budgetRange?: string;
    timeCommitment?: string;
    riskTolerance?: string;
  };
  riskProfile?: {
    legalRiskFlags?: string[];
    marketRiskFlags?: string[];
    operationalRiskFlags?: string[];
  };
}

export interface ChatResponseContract {
  reply: string;
  suggestedActions?: string[];
  dataReferences?: string[];
}

export interface DailyPlanContract {
  date: string;
  greeting: string;
  summary: string;
  topPriorities: Array<{
    title: string;
    why: string;
    kind: string;
    eventId?: string;
    suggestedTime?: string;
  }>;
  focusBlocks: Array<{
    startAt: string;
    endAt: string;
    label: string;
  }>;
  warnings: string[];
}

export interface WeeklyCapacityContract {
  weekStart: string;
  totalScheduledHours: number;
  byDay: Array<{
    date: string;
    hours: number;
    eventCount: number;
    capacityPct: number;
  }>;
  overloadedDays: string[];
  underutilizedDays: string[];
  recommendations: string[];
}

export interface PresenceInsightsContract {
  headline: string;
  narrative: string;
  categories: {
    money: string;
    time: string;
    people: string;
    services: string;
    goods: string;
  };
}

export interface GenesisSwotPestlePositioningResult {
  swot: {
    strengths: string[];
    weaknesses: string[];
    opportunities: string[];
    threats: string[];
  };
  pestle: {
    political: string;
    economic: string;
    social: string;
    technological: string;
    legal: string;
    environmental: string;
  };
  positioning: {
    tagline: string;
    valueProposition: string;
    keyMessages: string[];
    differentiators: string[];
    targetSegments: string[];
  };
  analysisSummary: {
    marketOpportunityScore: number;
    keyInsight: string;
  };
}

export interface GenesisCompetitorResult {
  name: string;
  threatLevel?: 'LOW' | 'MEDIUM' | 'HIGH' | null;
  strengths: string[];
  weaknesses: string[];
  positioning?: string | null;
}

export interface GenesisLaunchPlanResult {
  launchPlan: {
    summary: string;
    phases: Array<{
      name: string;
      duration: string;
      actions: string[];
    }>;
  };
}

export type ContractType =
  | 'intent_parse'
  | 'workflow_plan'
  | 'reply_draft'
  | 'content_brief'
  | 'lead_score'
  | 'quote_recommendation'
  | 'business_model'
  | 'genesis_idea_extraction'
  | 'chat_response'
  | 'daily_plan'
  | 'weekly_capacity'
  | 'presence_insights'
  | 'genesis_swot_pestle_positioning'
  | 'genesis_competitors'
  | 'genesis_launch_plan';

interface ValidationResult {
  valid: boolean;
  errors: string[];
}

function validateRequiredFields(data: Record<string, unknown>, fields: string[]): string[] {
  const errors: string[] = [];
  for (const field of fields) {
    if (data[field] === undefined || data[field] === null) {
      errors.push(`Missing required field: ${field}`);
    }
  }
  return errors;
}

function validateArrayField(data: Record<string, unknown>, field: string): string[] {
  if (data[field] !== undefined && !Array.isArray(data[field])) {
    return [`Field "${field}" must be an array`];
  }
  return [];
}

function validateStringField(data: Record<string, unknown>, field: string): string[] {
  if (data[field] !== undefined && typeof data[field] !== 'string') {
    return [`Field "${field}" must be a string`];
  }
  return [];
}

function validateObjectField(data: Record<string, unknown>, field: string): string[] {
  if (data[field] !== undefined && (typeof data[field] !== 'object' || data[field] === null || Array.isArray(data[field]))) {
    return [`Field "${field}" must be an object`];
  }
  return [];
}

export function validateOutputContract(
  data: unknown,
  contractType: ContractType,
): ValidationResult {
  if (!data || typeof data !== 'object') {
    return { valid: false, errors: ['Response is not an object'] };
  }

  const obj = data as Record<string, unknown>;
  const errors: string[] = [];

  switch (contractType) {
    case 'intent_parse':
      errors.push(...validateRequiredFields(obj, ['objective', 'urgency', 'modules']));
      errors.push(...validateArrayField(obj, 'scope'));
      errors.push(...validateArrayField(obj, 'modules'));
      errors.push(...validateArrayField(obj, 'actionCandidates'));
      if (obj.urgency && !['low', 'normal', 'high', 'critical'].includes(obj.urgency as string)) {
        errors.push('Invalid urgency value');
      }
      break;

    case 'workflow_plan':
      errors.push(...validateRequiredFields(obj, ['steps']));
      errors.push(...validateArrayField(obj, 'steps'));
      if (Array.isArray(obj.steps)) {
        for (const step of obj.steps as Record<string, unknown>[]) {
          if (!step.action && !step.description) {
            errors.push('Each step must have an action or description');
          }
        }
      }
      break;

    case 'reply_draft':
      errors.push(...validateRequiredFields(obj, ['body']));
      if (typeof obj.body !== 'string' || (obj.body as string).length < 10) {
        errors.push('Reply body must be a string of at least 10 characters');
      }
      break;

    case 'content_brief':
      errors.push(...validateRequiredFields(obj, ['headline', 'description']));
      break;

    case 'lead_score':
      errors.push(...validateRequiredFields(obj, ['score', 'recommendation']));
      if (typeof obj.score === 'number' && (obj.score < 0 || obj.score > 100)) {
        errors.push('Score must be between 0 and 100');
      }
      errors.push(...validateArrayField(obj, 'factors'));
      break;

    case 'quote_recommendation':
      errors.push(...validateRequiredFields(obj, ['suggestedTotal', 'rationale']));
      errors.push(...validateArrayField(obj, 'lineItems'));
      break;

    case 'business_model':
      errors.push(...validateRequiredFields(obj, ['overview', 'valueProposition']));
      break;

    case 'genesis_idea_extraction':
      errors.push(...validateRequiredFields(obj, ['summary', 'identity']));
      if (obj.identity && typeof obj.identity !== 'object') {
        errors.push('identity must be an object');
      }
      break;

    case 'chat_response':
      errors.push(...validateRequiredFields(obj, ['reply']));
      break;

    case 'daily_plan':
      errors.push(
        ...validateRequiredFields(obj, [
          'date',
          'greeting',
          'summary',
          'topPriorities',
          'focusBlocks',
          'warnings',
        ]),
      );
      errors.push(...validateArrayField(obj, 'topPriorities'));
      errors.push(...validateArrayField(obj, 'focusBlocks'));
      errors.push(...validateArrayField(obj, 'warnings'));
      if (Array.isArray(obj.topPriorities)) {
        for (const p of obj.topPriorities as Record<string, unknown>[]) {
          if (!p.title || typeof p.title !== 'string') {
            errors.push('Each priority must have a title');
            break;
          }
        }
      }
      break;

    case 'presence_insights':
      errors.push(...validateRequiredFields(obj, ['headline', 'narrative', 'categories']));
      if (obj.categories && typeof obj.categories === 'object') {
        const cats = obj.categories as Record<string, unknown>;
        for (const k of ['money', 'time', 'people', 'services', 'goods']) {
          if (typeof cats[k] !== 'string' || (cats[k] as string).length === 0) {
            errors.push(`categories.${k} must be a non-empty string`);
          }
        }
      } else {
        errors.push('categories must be an object');
      }
      break;

    case 'weekly_capacity':
      errors.push(
        ...validateRequiredFields(obj, [
          'weekStart',
          'totalScheduledHours',
          'byDay',
          'overloadedDays',
          'underutilizedDays',
          'recommendations',
        ]),
      );
      errors.push(...validateArrayField(obj, 'byDay'));
      errors.push(...validateArrayField(obj, 'overloadedDays'));
      errors.push(...validateArrayField(obj, 'underutilizedDays'));
      errors.push(...validateArrayField(obj, 'recommendations'));
      break;

    case 'genesis_swot_pestle_positioning':
      errors.push(...validateRequiredFields(obj, ['swot', 'pestle', 'positioning', 'analysisSummary']));
      errors.push(...validateObjectField(obj, 'swot'));
      errors.push(...validateObjectField(obj, 'pestle'));
      errors.push(...validateObjectField(obj, 'positioning'));
      errors.push(...validateObjectField(obj, 'analysisSummary'));
      if (typeof obj.swot === 'object' && obj.swot !== null && !Array.isArray(obj.swot)) {
        const swot = obj.swot as Record<string, unknown>;
        errors.push(...validateArrayField(swot, 'strengths'));
        errors.push(...validateArrayField(swot, 'weaknesses'));
        errors.push(...validateArrayField(swot, 'opportunities'));
        errors.push(...validateArrayField(swot, 'threats'));
      }
      if (typeof obj.pestle === 'object' && obj.pestle !== null && !Array.isArray(obj.pestle)) {
        const pestle = obj.pestle as Record<string, unknown>;
        for (const k of ['political', 'economic', 'social', 'technological', 'legal', 'environmental']) {
          errors.push(...validateStringField(pestle, k));
        }
      }
      if (typeof obj.positioning === 'object' && obj.positioning !== null && !Array.isArray(obj.positioning)) {
        const pos = obj.positioning as Record<string, unknown>;
        errors.push(...validateStringField(pos, 'tagline'));
        errors.push(...validateStringField(pos, 'valueProposition'));
        errors.push(...validateArrayField(pos, 'keyMessages'));
        errors.push(...validateArrayField(pos, 'differentiators'));
        errors.push(...validateArrayField(pos, 'targetSegments'));
      }
      if (typeof obj.analysisSummary === 'object' && obj.analysisSummary !== null && !Array.isArray(obj.analysisSummary)) {
        const summary = obj.analysisSummary as Record<string, unknown>;
        if (typeof summary.marketOpportunityScore !== 'number') {
          errors.push('analysisSummary.marketOpportunityScore must be a number');
        }
      }
      break;

    case 'genesis_competitors':
      errors.push(...validateRequiredFields(obj, ['competitors']));
      errors.push(...validateArrayField(obj, 'competitors'));
      if (Array.isArray(obj.competitors)) {
        for (const c of obj.competitors as Record<string, unknown>[]) {
          if (typeof c.name !== 'string') {
            errors.push('Each competitor must have a name string');
          }
          errors.push(...validateArrayField(c, 'strengths'));
          errors.push(...validateArrayField(c, 'weaknesses'));
        }
      }
      break;

    case 'genesis_launch_plan':
      errors.push(...validateRequiredFields(obj, ['launchPlan']));
      errors.push(...validateObjectField(obj, 'launchPlan'));
      if (typeof obj.launchPlan === 'object' && obj.launchPlan !== null && !Array.isArray(obj.launchPlan)) {
        const lp = obj.launchPlan as Record<string, unknown>;
        errors.push(...validateStringField(lp, 'summary'));
        errors.push(...validateArrayField(lp, 'phases'));
        if (Array.isArray(lp.phases)) {
          for (const phase of lp.phases as Record<string, unknown>[]) {
            errors.push(...validateStringField(phase, 'name'));
            errors.push(...validateStringField(phase, 'duration'));
            errors.push(...validateArrayField(phase, 'actions'));
          }
        }
      }
      break;
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function coerceToContract<T>(
  data: unknown,
  contractType: ContractType,
  fallback: T,
): T {
  const validation = validateOutputContract(data, contractType);
  if (validation.valid) {
    return data as T;
  }
  return fallback;
}
