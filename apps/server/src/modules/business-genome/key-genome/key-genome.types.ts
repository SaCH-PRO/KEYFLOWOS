/**
 * KEY Genome type contracts.
 *
 * These types define the shape of the central intelligence kernel:
 * facts, evidence, signals, readiness, recommendations, and experiments.
 * They are intentionally database-agnostic at this layer so the Prisma
 * schema and service implementations can evolve independently.
 */

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type VerificationStatus = 'INFERRED' | 'USER_VERIFIED' | 'UNVERIFIED_IMPORTED' | 'STALE' | 'DISPUTED';
export type SignalStatus = 'NEW' | 'REVIEWED' | 'ACCEPTED' | 'REJECTED' | 'MERGED';
export type RecommendationStatus = 'ACTIVE' | 'ACCEPTED' | 'DISMISSED' | 'APPLIED' | 'EXPIRED';
export type ExperimentStatus = 'PROPOSED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
export type FactValueType = 'STRING' | 'NUMBER' | 'BOOLEAN' | 'DATE' | 'JSON' | 'LIST';

export type GenomeSignalType =
  | 'NEW_FACT'
  | 'FACT_UPDATE'
  | 'FACT_CONFLICT'
  | 'MISSING_FACT'
  | 'STALE_FACT'
  | 'LOW_CONFIDENCE_FACT'
  | 'READINESS_BLOCKER'
  | 'CUSTOMER_PATTERN'
  | 'REVENUE_PATTERN'
  | 'OPERATIONS_PATTERN'
  | 'RISK_PATTERN'
  | 'MARKET_PATTERN';

export type GenomeSignalSourceModule =
  | 'temporal_flow'
  | 'key_inbox'
  | 'executive_mode'
  | 'command_center'
  | 'key_autonomy'
  | 'blueprint'
  | 'commerce'
  | 'crm'
  | 'finance'
  | 'marketing'
  | 'operations'
  | 'manual';

export interface GenomeFactValue {
  raw: unknown;
  type: FactValueType;
}

export interface GenomeFactScore {
  completeness: number;
  quality: number;
  confidence: number;
  freshness: number;
  operationalReadiness: number;
  riskPenalty: number;
  overall: number;
}

export interface GenomeFactData {
  id: string;
  businessId: string;
  section: string;
  domain: string;
  field: string;
  value: GenomeFactValue;
  sourceModule?: string | null;
  sourceType: string;
  sourceEntityType?: string | null;
  sourceEntityId?: string | null;
  score: GenomeFactScore;
  verificationStatus: VerificationStatus;
  riskIfWrong: RiskLevel;
  lastVerifiedAt?: string | null;
  expiresAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GenomeEvidenceData {
  id: string;
  businessId: string;
  factId?: string | null;
  sourceModule: string;
  sourceEntityType: string;
  sourceEntityId?: string | null;
  summary: string;
  evidenceStrength: number;
  occurredAt?: string | null;
  createdAt: string;
}

export interface GenomeSignalData {
  id: string;
  businessId: string;
  sourceModule: string;
  sourceEntityType?: string | null;
  sourceEntityId?: string | null;
  signalType: string;
  section: string;
  domain: string;
  field?: string | null;
  proposedValue?: unknown;
  reason: string;
  evidence: GenomeEvidenceData[];
  confidence: number;
  status: SignalStatus;
  createdAt: string;
  reviewedAt?: string | null;
}

export interface MissingGenomeFact {
  section: string;
  domain: string;
  field: string;
  reason: string;
  impact: 'BLOCKING' | 'DEGRADED' | 'OPTIONAL';
}

export interface ModuleReadinessData {
  businessId: string;
  module: string;
  readinessScore: number;
  requiredFacts: MissingGenomeFact[];
  missingFacts: MissingGenomeFact[];
  optionalFacts: MissingGenomeFact[];
  blockedReasons: string[];
  recommendedSetupActions: string[];
  automationAllowed: boolean;
  riskLevel: RiskLevel;
  lastComputedAt: string;
}

export interface GenomeRecommendationData {
  id: string;
  businessId: string;
  domain: string;
  title: string;
  insight: string;
  diagnosis: string;
  recommendation: string;
  expectedGain?: string | null;
  expectedGainScore: number;
  riskLevel: RiskLevel;
  effortLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  confidence: number;
  evidenceIds: string[];
  suggestedExperimentId?: string | null;
  status: RecommendationStatus;
  createdAt: string;
  reviewedAt?: string | null;
  outcomeTrackedAt?: string | null;
}

export interface GenomeExperimentData {
  id: string;
  businessId: string;
  hypothesis: string;
  action: string;
  successMetric: string;
  baselineValue?: number | null;
  targetValue?: number | null;
  durationDays: number;
  riskLevel: RiskLevel;
  status: ExperimentStatus;
  result?: Record<string, unknown> | null;
  createdAt: string;
  startedAt?: string | null;
  endedAt?: string | null;
}

export interface SectionGenomeScore {
  section: string;
  weight: number;
  score: GenomeFactScore;
}

export interface KeyGenomeScore {
  businessId: string;
  overall: number;
  integrity: number;
  readiness: number;
  confidence: number;
  sections: SectionGenomeScore[];
  computedAt: string;
}

export interface UpsertGenomeFactInput {
  businessId: string;
  section: string;
  domain: string;
  field: string;
  value: GenomeFactValue;
  sourceModule?: string;
  sourceType: string;
  sourceEntityType?: string;
  sourceEntityId?: string;
}

export interface AttachGenomeEvidenceInput {
  businessId: string;
  factId?: string;
  sourceModule: string;
  sourceEntityType: string;
  sourceEntityId?: string;
  summary: string;
  evidenceStrength?: number;
  occurredAt?: string;
}

export interface GenomeSignalEvidenceInput {
  sourceModule: string;
  sourceEntityType: string;
  sourceEntityId?: string | null;
  summary: string;
  evidenceStrength?: number;
  occurredAt?: string | null;
}

export interface CreateGenomeSignalInput {
  businessId: string;
  sourceModule: GenomeSignalSourceModule | string;
  sourceEntityType?: string | null;
  sourceEntityId?: string | null;
  signalType: GenomeSignalType | string;
  section: string;
  domain: string;
  field?: string | null;
  proposedValue?: unknown;
  reason: string;
  evidence?: GenomeSignalEvidenceInput[];
  confidence?: number;
}

/** @deprecated use CreateGenomeSignalInput */
export type EmitGenomeSignalInput = CreateGenomeSignalInput;

export interface ListGenomeSignalsQuery {
  status?: SignalStatus | string;
  sourceModule?: string;
  section?: string;
  signalType?: string;
  minConfidence?: number;
  limit?: number;
}

export interface GenomeSignalCluster {
  section: string;
  domain: string;
  field?: string | null;
  signalCount: number;
  averageConfidence: number;
  latestSignalAt: string;
  suggestedAction: 'UPDATE_FACT' | 'CREATE_PROPOSAL' | 'CREATE_RECOMMENDATION' | 'REQUEST_REVIEW';
}

export interface RecommendationOutcome {
  success: boolean;
  notes?: string;
  measuredValue?: number;
}

export interface GenomePolicyBlock {
  module: string;
  actionType: string;
  reason: string;
  missingFacts: MissingGenomeFact[];
  riskLevel: RiskLevel;
}

export type GenomeRecommendationSource =
  | 'READINESS_GAP'
  | 'SIGNAL'
  | 'WEAK_SECTION'
  | 'MANUAL';

export interface CreateGenomeRecommendationInput {
  businessId: string;
  domain: string;
  title: string;
  insight: string;
  diagnosis: string;
  recommendation: string;
  expectedGain?: string | null;
  expectedGainScore?: number;
  riskLevel?: RiskLevel;
  effortLevel?: 'LOW' | 'MEDIUM' | 'HIGH';
  confidence?: number;
  evidenceIds?: string[];
  suggestedExperimentId?: string | null;
  source?: GenomeRecommendationSource;
}

export interface ListGenomeRecommendationsQuery {
  status?: RecommendationStatus | string;
  domain?: string;
  source?: GenomeRecommendationSource | string;
  minExpectedGainScore?: number;
  limit?: number;
}

export interface GenerateGenomeRecommendationsInput {
  businessId: string;
  sources?: GenomeRecommendationSource[];
  maxRecommendations?: number;
}

export interface CreateGenomeExperimentInput {
  businessId: string;
  recommendationId?: string | null;
  hypothesis: string;
  action: string;
  successMetric: string;
  baselineValue?: number | null;
  targetValue?: number | null;
  durationDays?: number;
  riskLevel?: RiskLevel;
}

export interface ListGenomeExperimentsQuery {
  status?: ExperimentStatus | string;
  recommendationId?: string;
  limit?: number;
}

