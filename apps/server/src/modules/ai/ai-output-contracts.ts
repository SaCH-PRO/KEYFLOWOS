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

export type ContractType =
  | 'intent_parse'
  | 'workflow_plan'
  | 'reply_draft'
  | 'content_brief'
  | 'lead_score'
  | 'quote_recommendation'
  | 'business_model'
  | 'chat_response'
  | 'daily_plan'
  | 'weekly_capacity';

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
