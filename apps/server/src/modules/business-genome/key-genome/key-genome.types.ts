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

export type GenomeOutcome = 'SUCCESS' | 'FAILURE' | 'MIXED' | 'UNKNOWN';

export type GenomeMemorySourceType =
  | 'GENOME_RECOMMENDATION'
  | 'GENOME_EXPERIMENT'
  | 'GENOME_SIGNAL'
  | 'KEY_ACTION_PROPOSAL'
  | 'GENOME_FACT'
  | 'MODULE_READINESS'
  | 'GOVERNANCE_DECISION'
  | 'FINANCE_GENOME'
  | 'CUSTOMER_SALES_GENOME'
  | 'OPERATIONS_GENOME'
  | 'MARKETING_GROWTH_GENOME'
  | 'MANUAL';

export type GenomeMemoryEventType =
  | 'RECOMMENDATION_ACCEPTED'
  | 'RECOMMENDATION_DISMISSED'
  | 'RECOMMENDATION_APPLIED'
  | 'RECOMMENDATION_OUTCOME_TRACKED'
  | 'EXPERIMENT_STARTED'
  | 'EXPERIMENT_COMPLETED'
  | 'EXPERIMENT_FAILED'
  | 'EXPERIMENT_CANCELLED'
  | 'SIGNAL_REVIEWED'
  | 'SIGNAL_ACCEPTED'
  | 'SIGNAL_REJECTED'
  | 'SIGNAL_MERGED'
  | 'ACTION_PROPOSED'
  | 'ACTION_EXECUTED'
  | 'ACTION_BLOCKED'
  | 'READINESS_IMPROVED'
  | 'READINESS_DEGRADED'
  | 'FACT_CONFIDENCE_CHANGED'
  | 'FINANCE_SNAPSHOT_COMPUTED'
  | 'FINANCE_SIGNAL_GENERATED'
  | 'FINANCE_RECOMMENDATION_GENERATED'
  | 'FINANCE_METRIC_RECORDED'
  | 'FINANCE_RISK_DETECTED'
  | 'FINANCE_RISK_IMPROVED'
  | 'CUSTOMER_SALES_SNAPSHOT_COMPUTED'
  | 'CUSTOMER_SALES_SIGNAL_GENERATED'
  | 'CUSTOMER_SALES_RECOMMENDATION_GENERATED'
  | 'CUSTOMER_SALES_RISK_DETECTED'
  | 'CUSTOMER_SALES_SEGMENT_RECORDED'
  | 'CUSTOMER_SALES_MOTION_RECORDED'
  | 'OPERATIONS_PROCESS_RECORDED'
  | 'OPERATIONS_CAPABILITY_RECORDED'
  | 'OPERATIONS_SNAPSHOT_COMPUTED'
  | 'OPERATIONS_RISK_DETECTED'
  | 'OPERATIONS_RECOMMENDATION_GENERATED'
  | 'OPERATIONS_READINESS_IMPROVED'
  | 'OPERATIONS_READINESS_DEGRADED'
  | 'MARKETING_GROWTH_SNAPSHOT_COMPUTED'
  | 'MARKETING_GROWTH_SIGNAL_GENERATED'
  | 'MARKETING_GROWTH_RECOMMENDATION_GENERATED'
  | 'MARKETING_GROWTH_CHANNEL_RECORDED'
  | 'MARKETING_GROWTH_CONTENT_STRATEGY_RECORDED'
  | 'MARKETING_GROWTH_RISK_DETECTED'
  | 'MANUAL_LESSON';

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

export type GenomeRecommendationActionKind =
  | 'KEY_ACTION_PROPOSAL'
  | 'EXPERIMENT'
  | 'GENOME_REVIEW'
  | 'DOCUMENT_REQUEST'
  | 'CONSTITUTION_UPDATE'
  | 'MANUAL_TASK';

export interface GenomeRecommendationActionPreview {
  recommendationId: string;
  actionKind: GenomeRecommendationActionKind;
  title: string;
  summary: string;
  rationale: string;
  proposedActionType?: string;
  targetModule?: string | null;
  riskLevel: RiskLevel;
  requiresApproval: boolean;
  readinessWarning?: string | null;
  evidenceIds: string[];
  payload: Record<string, unknown>;
}

export interface BridgeGenomeRecommendationInput {
  businessId: string;
  recommendationId: string;
  actionKind?: GenomeRecommendationActionKind;
  confirmBridge?: boolean;
}

export interface BridgeGenomeRecommendationResult {
  recommendationId: string;
  actionKind: GenomeRecommendationActionKind;
  createdEntityType: string;
  createdEntityId: string;
  status: 'CREATED' | 'ALREADY_EXISTS' | 'BLOCKED';
  message: string;
}

export interface GenomeMemoryLesson {
  lesson: string;
  confidence?: number;
  appliesTo?: string[];
}

export interface GenomeMemoryEventData {
  id: string;
  businessId: string;
  sourceType: GenomeMemorySourceType | string;
  sourceEntityId?: string | null;
  eventType: GenomeMemoryEventType | string;
  domain?: string | null;
  section?: string | null;
  title: string;
  summary: string;
  outcome?: GenomeOutcome | null;
  impactScore: number;
  confidenceDelta: number;
  evidence: Array<Record<string, unknown>>;
  lessons: GenomeMemoryLesson[];
  metadata: Record<string, unknown>;
  occurredAt?: string | null;
  createdAt: string;
}

export interface CreateGenomeMemoryEventInput {
  businessId: string;
  sourceType: GenomeMemorySourceType | string;
  sourceEntityId?: string | null;
  eventType: GenomeMemoryEventType | string;
  domain?: string | null;
  section?: string | null;
  title: string;
  summary: string;
  outcome?: GenomeOutcome | null;
  impactScore?: number;
  confidenceDelta?: number;
  evidence?: Array<Record<string, unknown>>;
  lessons?: GenomeMemoryLesson[];
  metadata?: Record<string, unknown>;
  occurredAt?: string | null;
}

export interface ListGenomeMemoryEventsQuery {
  sourceType?: string;
  eventType?: string;
  domain?: string;
  section?: string;
  outcome?: string;
  minImpactScore?: number;
  limit?: number;
}

export interface GenomeLearningSummary {
  businessId: string;
  generatedAt: string;
  totalMemoryEvents: number;
  successCount: number;
  failureCount: number;
  mixedCount: number;
  unknownCount: number;
  averageImpactScore: number;
  averageConfidenceDelta: number;
  topLessons: Array<{
    lesson: string;
    count: number;
    averageImpactScore: number;
  }>;
  strongestDomains: Array<{
    domain: string;
    successCount: number;
    averageImpactScore: number;
  }>;
  weakestDomains: Array<{
    domain: string;
    failureCount: number;
    averageImpactScore: number;
  }>;
  recentMemory: GenomeMemoryEventData[];
}

export type KeyGenomeGovernanceItemType =
  | 'SIGNAL'
  | 'RECOMMENDATION'
  | 'EXPERIMENT'
  | 'READINESS_BLOCKER'
  | 'AUTONOMY_BLOCK'
  | 'WEAK_SECTION';

export type KeyGenomeGovernanceActionType =
  | 'REVIEW'
  | 'ACCEPT'
  | 'REJECT'
  | 'MERGE'
  | 'DISMISS'
  | 'APPLY'
  | 'START'
  | 'COMPLETE'
  | 'CANCEL'
  | 'OPEN'
  | 'BRIDGE';

export interface KeyGenomeGovernanceItemAction {
  label: string;
  actionType: KeyGenomeGovernanceActionType;
  href?: string;
}

export interface KeyGenomeGovernanceItem {
  id: string;
  type: KeyGenomeGovernanceItemType;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  title: string;
  summary: string;
  source: string;
  sourceId?: string | null;
  createdAt?: string | null;
  actions: KeyGenomeGovernanceItemAction[];
}

export interface KeyGenomeGovernanceSummary {
  businessId: string;
  generatedAt: string;
  counts: {
    newSignals: number;
    acceptedSignals: number;
    activeRecommendations: number;
    acceptedRecommendations: number;
    runningExperiments: number;
    proposedExperiments: number;
    blockedModules: number;
    lowReadinessModules: number;
    autonomyBlockedActions: number;
    memoryEventsLast7Days: number;
    failedOutcomesLast30Days: number;
    blockedDepartments: number;
    weakDepartments: number;
  };
  urgentReviewItems: KeyGenomeGovernanceItem[];
  signalReviewQueue: KeyGenomeGovernanceItem[];
  recommendationQueue: KeyGenomeGovernanceItem[];
  experimentQueue: KeyGenomeGovernanceItem[];
  readinessBlockers: KeyGenomeGovernanceItem[];
  autonomyBlocks: KeyGenomeGovernanceItem[];
  departmentBlockers: KeyGenomeGovernanceItem[];
  genomeHealth: {
    overall: number;
    confidence: number;
    readiness: number;
    weakestSections: Array<{
      section: string;
      overall: number;
      confidence: number;
      freshness: number;
    }>;
  };
}

export type GenomeDepartmentCode =
  | 'CEO_STRATEGY'
  | 'COO_OPERATIONS'
  | 'CFO_FINANCE'
  | 'CMO_MARKETING'
  | 'SALES'
  | 'CUSTOMER_SUCCESS'
  | 'PRODUCT_SERVICE'
  | 'LEGAL_COMPLIANCE'
  | 'RISK'
  | 'TECH_DATA'
  | 'HR_STAFFING'
  | 'VENDOR_PROCUREMENT'
  | 'EXECUTIVE_ASSISTANT';

export type GenomeDepartmentGapType =
  | 'MISSING_FACT'
  | 'LOW_CONFIDENCE'
  | 'READINESS_BLOCKER'
  | 'WEAK_SECTION'
  | 'RISK';

export interface GenomeDepartmentGap {
  type: GenomeDepartmentGapType;
  section?: string;
  domain?: string;
  field?: string;
  reason: string;
  impact: 'BLOCKING' | 'DEGRADED' | 'OPTIONAL';
}

export interface GenomeDepartmentRecommendedAction {
  label: string;
  reason: string;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

export interface GenomeDepartmentData {
  id: string;
  businessId: string;
  code: GenomeDepartmentCode | string;
  name: string;
  description?: string | null;
  primarySections: string[];
  supportingSections: string[];
  impactedModules: string[];
  coreCapabilities: string[];
  maturityScore: number;
  readinessScore: number;
  confidenceScore: number;
  riskLevel: RiskLevel;
  autonomySensitive: boolean;
  automationAllowed: boolean;
  gapSummary: GenomeDepartmentGap[];
  recommendedActions: GenomeDepartmentRecommendedAction[];
  lastComputedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DepartmentGenomeSummary {
  businessId: string;
  generatedAt: string;
  departments: GenomeDepartmentData[];
  strongestDepartments: GenomeDepartmentData[];
  weakestDepartments: GenomeDepartmentData[];
  blockedDepartments: GenomeDepartmentData[];
  automationReadyDepartments: GenomeDepartmentData[];
  overallDepartmentMaturity: number;
  overallDepartmentReadiness: number;
}

export interface ListGenomeDepartmentsQuery {
  riskLevel?: RiskLevel;
  automationAllowed?: boolean;
  minReadinessScore?: number;
  limit?: number;
}


// ---------------------------------------------------------------------------
// Phase 13 — Finance Genome
// ---------------------------------------------------------------------------

export type GenomeFinancialMetricType =
  | 'REVENUE'
  | 'GROSS_PROFIT'
  | 'NET_PROFIT'
  | 'CASH_ON_HAND'
  | 'MONTHLY_EXPENSE'
  | 'PAYROLL_COST'
  | 'MARKETING_SPEND'
  | 'CUSTOMER_ACQUISITION_COST'
  | 'AVERAGE_ORDER_VALUE'
  | 'LIFETIME_VALUE'
  | 'GROSS_MARGIN_PERCENT'
  | 'NET_MARGIN_PERCENT'
  | 'RUNWAY_MONTHS'
  | 'ACCOUNTS_RECEIVABLE'
  | 'ACCOUNTS_PAYABLE'
  | 'TAX_RESERVE'
  | 'REFUND_RATE'
  | 'DEBT_PAYMENT'
  | 'OWNER_DRAW'
  | 'INVENTORY_VALUE';

export type GenomeFinanceRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | 'UNKNOWN';

export interface GenomeFinancialMetricData {
  id: string;
  businessId: string;
  metricType: GenomeFinancialMetricType | string;
  period?: string | null;
  value: number;
  currency: string;
  sourceModule?: string | null;
  sourceEntityType?: string | null;
  sourceEntityId?: string | null;
  confidence: number;
  notes?: string | null;
  occurredAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GenomeFinanceWarning {
  code: string;
  message: string;
  severity: GenomeFinanceRiskLevel;
}

export interface GenomeFinanceRecommendation {
  title: string;
  reason: string;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  suggestedAction?: string;
}

export interface GenomeFinanceSnapshotData {
  id: string;
  businessId: string;
  period?: string | null;
  currency: string;

  revenue?: number | null;
  grossProfit?: number | null;
  netProfit?: number | null;
  monthlyExpenses?: number | null;
  cashOnHand?: number | null;
  accountsReceivable?: number | null;
  accountsPayable?: number | null;
  taxReserve?: number | null;

  grossMarginPercent?: number | null;
  netMarginPercent?: number | null;
  runwayMonths?: number | null;
  averageTicket?: number | null;

  healthScore: number;
  cashFlowRisk: GenomeFinanceRiskLevel;
  marginRisk: GenomeFinanceRiskLevel;
  pricingRisk: GenomeFinanceRiskLevel;
  taxRisk: GenomeFinanceRiskLevel;
  overallRisk: GenomeFinanceRiskLevel;

  missingInputs: string[];
  warnings: GenomeFinanceWarning[];
  recommendations: GenomeFinanceRecommendation[];

  computedAt: string;
}

export interface UpsertGenomeFinancialMetricInput {
  businessId: string;
  metricType: GenomeFinancialMetricType | string;
  period?: string | null;
  value: number;
  currency?: string;
  sourceModule?: string | null;
  sourceEntityType?: string | null;
  sourceEntityId?: string | null;
  confidence?: number;
  notes?: string | null;
  occurredAt?: string | null;
}

export interface ListGenomeFinancialMetricsQuery {
  metricType?: string;
  period?: string;
  currency?: string;
  minConfidence?: number;
  limit?: number;
}

export interface ListGenomeFinanceSnapshotsQuery {
  period?: string;
  riskLevel?: string;
  limit?: number;
}

// ---------------------------------------------------------------------------
// Phase 14 — Customer / Sales / Revenue Genome
// ---------------------------------------------------------------------------

export type GenomeCustomerSalesRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | 'UNKNOWN';

export type GenomeCustomerSegmentType =
  | 'HIGH_VALUE'
  | 'LOW_MARGIN'
  | 'NEW'
  | 'AT_RISK'
  | 'LOYAL'
  | 'CHURNED'
  | 'PROSPECT'
  | 'CUSTOM';

export interface GenomeCustomerSegmentData {
  id: string;
  businessId: string;
  name: string;
  description?: string | null;
  segmentType: GenomeCustomerSegmentType | string;
  estimatedSize?: number | null;
  averageRevenue?: number | null;
  averageCost?: number | null;
  lifetimeValue?: number | null;
  acquisitionCost?: number | null;
  churnRate?: number | null;
  conversionRate?: number | null;
  channel?: string | null;
  tags: string[];
  confidence: number;
  sourceModule?: string | null;
  sourceEntityType?: string | null;
  sourceEntityId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type GenomeSalesMotionType =
  | 'INBOUND'
  | 'OUTBOUND'
  | 'REFERRAL'
  | 'PARTNERSHIP'
  | 'SELF_SERVICE'
  | 'EVENT'
  | 'CUSTOM';

export type GenomeSalesMotionStage =
  | 'AWARENESS'
  | 'INTEREST'
  | 'CONSIDERATION'
  | 'INTENT'
  | 'PURCHASE'
  | 'RETENTION'
  | 'ADVOCACY';

export interface GenomeSalesMotionData {
  id: string;
  businessId: string;
  name: string;
  description?: string | null;
  motionType: GenomeSalesMotionType | string;
  stage?: GenomeSalesMotionStage | string | null;
  conversionRate?: number | null;
  averageDealSize?: number | null;
  cycleDays?: number | null;
  volume?: number | null;
  channel?: string | null;
  revenueContribution?: number | null;
  costPerLead?: number | null;
  isActive: boolean;
  confidence: number;
  sourceModule?: string | null;
  sourceEntityType?: string | null;
  sourceEntityId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GenomeCustomerSalesWarning {
  code: string;
  message: string;
  severity: GenomeCustomerSalesRiskLevel;
}

export interface GenomeCustomerSalesRecommendation {
  title: string;
  reason: string;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  suggestedAction?: string;
}

export interface GenomeCustomerSalesSnapshotData {
  id: string;
  businessId: string;
  period?: string | null;
  currency: string;

  totalCustomers?: number | null;
  activeCustomers?: number | null;
  newCustomers?: number | null;
  churnedCustomers?: number | null;
  retentionRate?: number | null;
  conversionRate?: number | null;
  averageRevenuePerCustomer?: number | null;
  lifetimeValue?: number | null;
  customerAcquisitionCost?: number | null;
  ltvCacRatio?: number | null;

  revenueQualityScore: number;
  revenueConcentrationRisk: GenomeCustomerSalesRiskLevel;
  cacRisk: GenomeCustomerSalesRiskLevel;
  ltvRisk: GenomeCustomerSalesRiskLevel;
  churnRisk: GenomeCustomerSalesRiskLevel;
  conversionRisk: GenomeCustomerSalesRiskLevel;
  overallRisk: GenomeCustomerSalesRiskLevel;

  missingInputs: string[];
  warnings: GenomeCustomerSalesWarning[];
  recommendations: GenomeCustomerSalesRecommendation[];

  computedAt: string;
}

export interface UpsertGenomeCustomerSegmentInput {
  businessId: string;
  name: string;
  description?: string | null;
  segmentType: GenomeCustomerSegmentType | string;
  estimatedSize?: number | null;
  averageRevenue?: number | null;
  averageCost?: number | null;
  lifetimeValue?: number | null;
  acquisitionCost?: number | null;
  churnRate?: number | null;
  conversionRate?: number | null;
  channel?: string | null;
  tags?: string[];
  confidence?: number;
  sourceModule?: string | null;
  sourceEntityType?: string | null;
  sourceEntityId?: string | null;
}

export interface UpsertGenomeSalesMotionInput {
  businessId: string;
  name: string;
  description?: string | null;
  motionType: GenomeSalesMotionType | string;
  stage?: GenomeSalesMotionStage | string | null;
  conversionRate?: number | null;
  averageDealSize?: number | null;
  cycleDays?: number | null;
  volume?: number | null;
  channel?: string | null;
  revenueContribution?: number | null;
  costPerLead?: number | null;
  isActive?: boolean;
  confidence?: number;
  sourceModule?: string | null;
  sourceEntityType?: string | null;
  sourceEntityId?: string | null;
}

export interface ListGenomeCustomerSegmentsQuery {
  segmentType?: string;
  channel?: string;
  minConfidence?: number;
  limit?: number;
}

export interface ListGenomeSalesMotionsQuery {
  motionType?: string;
  stage?: string;
  channel?: string;
  isActive?: boolean;
  minConfidence?: number;
  limit?: number;
}

export interface ListGenomeCustomerSalesSnapshotsQuery {
  period?: string;
  riskLevel?: string;
  limit?: number;
}

// ---------------------------------------------------------------------------
// Phase 15 — Operations / Delivery Genome
// ---------------------------------------------------------------------------

export type GenomeOperationsRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | 'UNKNOWN';

export type GenomeOperationalProcessType =
  | 'DELIVERY'
  | 'SUPPORT'
  | 'FULFILLMENT'
  | 'ADMIN'
  | 'QUALITY'
  | 'ONBOARDING'
  | 'CUSTOM';

export type GenomeDeliveryCapabilityType =
  | 'SERVICE'
  | 'PRODUCT'
  | 'SUPPORT'
  | 'FULFILLMENT'
  | 'CONSULTING'
  | 'CUSTOM';

export interface GenomeOperationalProcessBottleneck {
  label: string;
  reason?: string;
  severity?: GenomeOperationsRiskLevel;
}

export interface GenomeOperationalProcessRecommendation {
  title: string;
  reason: string;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  suggestedAction?: string;
}

export interface GenomeOperationalProcessData {
  id: string;
  businessId: string;
  name: string;
  description?: string | null;
  processType: GenomeOperationalProcessType | string;
  ownerRole?: string | null;
  frequency?: string | null;
  documented: boolean;
  hasSop: boolean;
  averageCycleTimeHours?: number | null;
  failureRate?: number | null;
  reworkRate?: number | null;
  handoffCount?: number | null;
  automationCandidate: boolean;
  autonomySensitive: boolean;
  maturityScore: number;
  riskLevel: GenomeOperationsRiskLevel;
  confidence: number;
  bottlenecks: GenomeOperationalProcessBottleneck[];
  missingInputs: string[];
  recommendations: GenomeOperationalProcessRecommendation[];
  sourceModule?: string | null;
  sourceEntityType?: string | null;
  sourceEntityId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GenomeDeliveryCapabilityConstraint {
  label: string;
  reason?: string;
  severity?: GenomeOperationsRiskLevel;
}

export interface GenomeDeliveryCapabilityDependency {
  label: string;
  type?: string;
  risk?: GenomeOperationsRiskLevel;
}

export interface GenomeDeliveryCapabilityRecommendation {
  title: string;
  reason: string;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  suggestedAction?: string;
}

export interface GenomeDeliveryCapabilityData {
  id: string;
  businessId: string;
  name: string;
  description?: string | null;
  capabilityType: GenomeDeliveryCapabilityType | string;
  currentCapacity?: number | null;
  maxCapacity?: number | null;
  capacityUnit?: string | null;
  utilizationRate?: number | null;
  backlogVolume?: number | null;
  averageLeadTimeDays?: number | null;
  qualityScore?: number | null;
  reliabilityScore?: number | null;
  riskLevel: GenomeOperationsRiskLevel;
  confidence: number;
  constraints: GenomeDeliveryCapabilityConstraint[];
  dependencies: GenomeDeliveryCapabilityDependency[];
  recommendations: GenomeDeliveryCapabilityRecommendation[];
  sourceModule?: string | null;
  sourceEntityType?: string | null;
  sourceEntityId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GenomeOperationsWarning {
  code: string;
  message: string;
  severity: GenomeOperationsRiskLevel;
}

export interface GenomeOperationsRecommendation {
  title: string;
  reason: string;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  suggestedAction?: string;
}

export interface GenomeOperationsSnapshotData {
  id: string;
  businessId: string;
  period?: string | null;

  processCount: number;
  documentedCount: number;
  sopCoverageRate?: number | null;

  averageProcessMaturity?: number | null;
  averageUtilizationRate?: number | null;
  averageLeadTimeDays?: number | null;

  bottleneckCount: number;
  highRiskProcessCount: number;
  overloadedCapabilityCount: number;

  deliveryReadinessScore: number;
  qualityRisk: GenomeOperationsRiskLevel;
  capacityRisk: GenomeOperationsRiskLevel;
  sopRisk: GenomeOperationsRiskLevel;
  overallRisk: GenomeOperationsRiskLevel;

  missingInputs: string[];
  warnings: GenomeOperationsWarning[];
  recommendations: GenomeOperationsRecommendation[];

  computedAt: string;
}

export interface UpsertGenomeOperationalProcessInput {
  businessId: string;
  name: string;
  description?: string | null;
  processType: GenomeOperationalProcessType | string;
  ownerRole?: string | null;
  frequency?: string | null;
  documented?: boolean;
  hasSop?: boolean;
  averageCycleTimeHours?: number | null;
  failureRate?: number | null;
  reworkRate?: number | null;
  handoffCount?: number | null;
  automationCandidate?: boolean;
  autonomySensitive?: boolean;
  confidence?: number;
  sourceModule?: string | null;
  sourceEntityType?: string | null;
  sourceEntityId?: string | null;
}

export interface UpsertGenomeDeliveryCapabilityInput {
  businessId: string;
  name: string;
  description?: string | null;
  capabilityType: GenomeDeliveryCapabilityType | string;
  currentCapacity?: number | null;
  maxCapacity?: number | null;
  capacityUnit?: string | null;
  utilizationRate?: number | null;
  backlogVolume?: number | null;
  averageLeadTimeDays?: number | null;
  qualityScore?: number | null;
  reliabilityScore?: number | null;
  confidence?: number;
  sourceModule?: string | null;
  sourceEntityType?: string | null;
  sourceEntityId?: string | null;
}

export interface ListGenomeOperationalProcessesQuery {
  processType?: string;
  ownerRole?: string;
  hasSop?: boolean;
  minConfidence?: number;
  limit?: number;
}

export interface ListGenomeDeliveryCapabilitiesQuery {
  capabilityType?: string;
  minConfidence?: number;
  limit?: number;
}

export interface ListGenomeOperationsSnapshotsQuery {
  period?: string;
  riskLevel?: string;
  limit?: number;
}

export type GenomeMarketingGrowthRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | 'UNKNOWN';

export interface GenomeMarketingGrowthWarning {
  type: string;
  message: string;
  severity: GenomeMarketingGrowthRiskLevel;
  channelKey?: string | null;
}

export interface GenomeMarketingGrowthRecommendation {
  type: string;
  title: string;
  insight: string;
  diagnosis: string;
  recommendation: string;
  expectedGain?: string | null;
  riskLevel: GenomeMarketingGrowthRiskLevel;
  effortLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  channelKey?: string | null;
}

export interface GenomeGrowthChannelData {
  id: string;
  businessId: string;
  key: string;
  label: string;
  channelType: 'owned' | 'earned' | 'paid';
  status: 'ACTIVE' | 'TESTING' | 'PAUSED' | 'DEPRECATED';
  monthlyBudget?: number | null;
  currency: string;
  targetCac?: number | null;
  targetConversionRate?: number | null;
  assumptions: Record<string, unknown>;
  evidenceIds: string[];
  confidence: number;
  sourceModule?: string | null;
  sourceEntityType?: string | null;
  sourceEntityId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GenomeContentStrategyData {
  id: string;
  businessId: string;
  pillars: string[];
  cadence?: string | null;
  formats: string[];
  distributionChannels: string[];
  contentGoals: Record<string, unknown>;
  confidence: number;
  sourceModule?: string | null;
  sourceEntityType?: string | null;
  sourceEntityId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GenomeMarketingGrowthChannelMixItem {
  channelKey: string;
  label: string;
  channelType: 'owned' | 'earned' | 'paid';
  sharePercent: number;
  status: 'ACTIVE' | 'TESTING' | 'PAUSED' | 'DEPRECATED';
}

export interface GenomeMarketingGrowthSnapshotData {
  id: string;
  businessId: string;
  period?: string | null;
  channelMix: GenomeMarketingGrowthChannelMixItem[];
  leadVolumeEstimate?: number | null;
  blendedCac?: number | null;
  contentConsistencyScore: number;
  channelDiversificationScore: number;
  funnelConversionEstimate?: number | null;
  overallRisk: GenomeMarketingGrowthRiskLevel;
  missingInputs: string[];
  warnings: GenomeMarketingGrowthWarning[];
  recommendations: GenomeMarketingGrowthRecommendation[];
  signalsGeneratedAt?: string | null;
  recommendationsGeneratedAt?: string | null;
  computedAt: string;
}

export interface CreateGenomeGrowthChannelInput {
  key: string;
  label: string;
  channelType: 'owned' | 'earned' | 'paid';
  status?: 'ACTIVE' | 'TESTING' | 'PAUSED' | 'DEPRECATED';
  monthlyBudget?: number | null;
  currency?: string;
  targetCac?: number | null;
  targetConversionRate?: number | null;
  assumptions?: Record<string, unknown>;
  evidenceIds?: string[];
  confidence?: number;
  sourceModule?: string;
  sourceEntityType?: string;
  sourceEntityId?: string;
}

export interface UpdateGenomeGrowthChannelInput {
  label?: string;
  channelType?: 'owned' | 'earned' | 'paid';
  status?: 'ACTIVE' | 'TESTING' | 'PAUSED' | 'DEPRECATED';
  monthlyBudget?: number | null;
  currency?: string;
  targetCac?: number | null;
  targetConversionRate?: number | null;
  assumptions?: Record<string, unknown>;
  evidenceIds?: string[];
  confidence?: number;
}

export interface CreateGenomeContentStrategyInput {
  pillars: string[];
  cadence?: string;
  formats: string[];
  distributionChannels?: string[];
  contentGoals?: Record<string, unknown>;
  confidence?: number;
  sourceModule?: string;
  sourceEntityType?: string;
  sourceEntityId?: string;
}

export interface UpdateGenomeContentStrategyInput {
  pillars?: string[];
  cadence?: string | null;
  formats?: string[];
  distributionChannels?: string[];
  contentGoals?: Record<string, unknown>;
  confidence?: number;
}

export interface ListGenomeMarketingGrowthSnapshotsQuery {
  period?: string;
  riskLevel?: string;
  limit?: number;
}

// ---------------------------------------------------------------------------
// Phase 17B — Cross-Domain Genome Intelligence
// ---------------------------------------------------------------------------

export type GenomeCrossDomainRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | 'UNKNOWN';

export type GenomeCrossDomainDomainKey =
  | 'finance'
  | 'customer_sales_revenue'
  | 'operations_delivery'
  | 'marketing_growth';

export interface GenomeCrossDomainDomainScore {
  domain: GenomeCrossDomainDomainKey;
  healthScore: number;
  riskLevel: GenomeCrossDomainRiskLevel;
  snapshotId?: string | null;
  computedAt?: string | null;
}

export interface GenomeCrossDomainReadinessSummary {
  averageReadinessScore: number;
  departmentCount: number;
  readyDepartments: string[];
  atRiskDepartments: string[];
}

export interface GenomeCrossDomainEvidenceSummary {
  totalFacts: number;
  highConfidenceFacts: number;
  totalEvidence: number;
  verifiedEvidence: number;
}

export interface GenomeCrossDomainBottleneck {
  domain: GenomeCrossDomainDomainKey;
  label: string;
  severity: GenomeCrossDomainRiskLevel;
  reason?: string;
}

export interface GenomeCrossDomainOpportunity {
  domain: GenomeCrossDomainDomainKey;
  label: string;
  potentialImpact: 'LOW' | 'MEDIUM' | 'HIGH';
  reason?: string;
}

export interface GenomeCrossDomainRecommendedFocus {
  domain: GenomeCrossDomainDomainKey;
  priority: number;
  label: string;
  reason: string;
}

export interface GenomeCrossDomainSnapshotData {
  id: string;
  businessId: string;
  period?: string | null;

  overallHealthScore: number;
  overallRiskLevel: GenomeCrossDomainRiskLevel;

  domainScores: GenomeCrossDomainDomainScore[];
  domainRisks: Record<GenomeCrossDomainDomainKey, GenomeCrossDomainRiskLevel>;
  readinessSummary: GenomeCrossDomainReadinessSummary;
  evidenceSummary: GenomeCrossDomainEvidenceSummary;

  bottlenecks: GenomeCrossDomainBottleneck[];
  opportunities: GenomeCrossDomainOpportunity[];
  recommendedFocus: GenomeCrossDomainRecommendedFocus[];

  computedAt: string;
}

export interface ListGenomeCrossDomainSnapshotsQuery {
  period?: string;
  riskLevel?: string;
  limit?: number;
}
