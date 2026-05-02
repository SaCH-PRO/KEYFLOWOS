/**
 * Shared shapes for LLM/AI tool result payloads rendered by the in-app
 * chat surfaces (CRM, commerce, marketing, store, bookings). These describe
 * the JSON the backend tool handlers emit. Fields are mostly optional because
 * different tools/models return slightly different subsets.
 */

export type Sentiment = "positive" | "neutral" | "negative" | "at_risk";
export type RelationshipHealth = "strong" | "good" | "neutral" | "weak" | "critical";
export type Priority = "high" | "medium" | "low";
export type Severity = "high" | "medium" | "low" | "critical";
export type Impact = "positive" | "negative" | "neutral";
export type Direction = "up" | "down" | "stable";

/* ------------------------------------------------------------------ */
/* CRM tool result shapes                                              */
/* ------------------------------------------------------------------ */

export interface CrmSummaryResult {
  sentiment?: Sentiment | string;
  relationshipHealth?: RelationshipHealth | string;
  summary?: string;
  keyInsights?: string[];
  recommendedAction?: string;
}

export interface CrmLeadScoreFactor {
  factor: string;
  impact?: Impact | string;
  weight?: number;
}

export interface CrmLeadScoreResult {
  score: number;
  label: string;
  reasoning?: string;
  factors?: CrmLeadScoreFactor[];
}

export interface CrmPrepBriefResult {
  relationshipHealth?: RelationshipHealth | string;
  keyInfo?: string[];
  talkingPoints?: string[];
  icebreakers?: string[];
  thingsToAvoid?: string[];
}

export interface CrmTagSuggestion {
  tag: string;
  reason?: string;
  confidence: number;
}

export interface CrmTagSuggestionsResult {
  suggestedTags?: CrmTagSuggestion[];
}

export interface CrmAtRiskContact {
  name: string;
  riskLevel?: string;
  probability?: number;
  reasons?: string[];
}

export interface CrmChurnDetectionResult {
  summary?: string;
  estimatedRevenueLoss?: number;
  atRiskContacts?: CrmAtRiskContact[];
}

export interface CrmAnalysisAction {
  title?: string;
  description?: string;
}

export interface CrmAnalysisResult {
  analysis?: string;
  suggestedActions?: CrmAnalysisAction[];
  guidelines?: string[];
}

export interface CrmFieldBreakdown {
  field: string;
  missing?: number;
  percentage: number;
}

export interface CrmContactIssue {
  contactName: string;
  completeness: number;
  missingFields: string[];
}

export interface CrmDataQualityResult {
  averageCompleteness?: number;
  totalContacts?: number;
  contactsWithIssues?: number;
  fieldBreakdown?: CrmFieldBreakdown[];
  topIssues?: CrmContactIssue[];
}

export interface CrmDuplicateContact {
  name: string;
  email?: string;
}

export interface CrmDuplicateCluster {
  reason?: string;
  confidence?: number;
  contacts?: CrmDuplicateContact[];
}

export interface CrmDuplicateFinderResult {
  duplicateClusters?: CrmDuplicateCluster[];
  estimatedDuplicates?: number;
}

export interface CrmReengagementSuggestion {
  contactName: string;
  urgency?: string;
  daysSinceLastInteraction?: number | null;
  recommendedAction?: string;
  suggestedSequence?: string;
}

export interface CrmReengagementResult {
  totalStale?: number;
  suggestions?: CrmReengagementSuggestion[];
}

export interface CrmRevenueOpportunity {
  contactName: string;
  estimatedValue?: number;
  opportunityType?: string;
  company?: string;
  totalRevenue?: number;
}

export interface CrmRevenueOpportunitiesResult {
  totalEstimatedRevenue?: number;
  contactsAnalyzed?: number;
  opportunities?: CrmRevenueOpportunity[];
}

export interface CrmFollowUpMessage {
  channel?: string;
  tone?: string;
  subject?: string;
  body?: string;
}

export interface CrmFollowUpDraftResult {
  contactName?: string;
  context?: string;
  messages?: CrmFollowUpMessage[];
  bestTime?: string;
}

/* ------------------------------------------------------------------ */
/* Store tool result shapes                                            */
/* ------------------------------------------------------------------ */

export interface StoreRecommendation {
  title: string;
  description: string;
  priority?: Priority | string;
  expectedImpact?: string;
}

export interface StoreFrictionPoint {
  title?: string;
  description?: string;
  severity?: Severity | string;
  step?: string;
  impact?: string;
}

export interface StoreOptimizerResult {
  summary: string;
  score: number;
  totalItems: number;
  testimonialCount: number;
  recommendations: StoreRecommendation[];
}

export interface StoreConversionResult {
  summary?: string;
  score?: number;
  frictionPoints: StoreFrictionPoint[];
  recommendations: StoreRecommendation[];
}

/* ------------------------------------------------------------------ */
/* Marketing tool result shapes (generic NL search row)                */
/* ------------------------------------------------------------------ */

export interface MarketingSearchRow {
  name?: string;
  subject?: string;
  status?: string;
  isActive?: boolean;
  [key: string]: unknown;
}

/* ------------------------------------------------------------------ */
/* Misc form/state shapes                                              */
/* ------------------------------------------------------------------ */

export type GenericRecord = Record<string, unknown>;
