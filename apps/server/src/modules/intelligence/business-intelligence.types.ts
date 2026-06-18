export type IntelligencePriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type IntelligenceDomain =
  | 'EXECUTIVE'
  | 'REVENUE'
  | 'FINANCE'
  | 'MARKETING'
  | 'SALES'
  | 'OPERATIONS'
  | 'CLIENTS'
  | 'RISK'
  | 'GENOME'
  | 'ASSETS'
  | 'TEMPORAL_FLOW';

export interface BusinessIntelligenceRecommendedAction {
  label: string;
  actionType:
    | 'OPEN_GENOME'
    | 'OPEN_TEMPORAL_FLOW'
    | 'REVIEW_EVOLUTION_PROPOSALS'
    | 'REVIEW_ASSETS'
    | 'CREATE_TASK'
    | 'GENERATE_DOCUMENT'
    | 'REVIEW_FINANCE';
  href?: string;
  payload?: Record<string, unknown>;
}

export interface BusinessIntelligenceInsight {
  id: string;
  domain: IntelligenceDomain;
  priority: IntelligencePriority;
  title: string;
  finding: string;
  evidence: string[];
  confidence: number;
  recommendedAction?: BusinessIntelligenceRecommendedAction;
}

export interface BusinessExecutiveBrief {
  businessId: string;
  generatedAt: string;
  summary: string;
  genomeIntegrity: number;
  executiveReadinessScore: number;
  genomeStage: string;
  insights: BusinessIntelligenceInsight[];
  topPriorities: BusinessIntelligenceInsight[];
}
