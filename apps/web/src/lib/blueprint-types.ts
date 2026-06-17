/**
 * Web-side mirror of the canonical Business Blueprint types defined on the
 * server at `apps/server/src/modules/blueprint/blueprint.types.ts`. Kept as a
 * separate file (instead of a cross-package import) because the web app and
 * server are not joined by a shared TS path. Update both files together when
 * the schema evolves; the server is the source of truth.
 */

export type BlueprintSectionKey =
  | "identity"
  | "operatingModel"
  | "goals"
  | "constraints"
  | "brand"
  | "customerModel"
  | "financials"
  | "intelligence"
  | "workflowModel"
  | "aiPreferences"
  // Genesis sections (Business Genesis Patch 1)
  | "founderProfile"
  | "legalProfile"
  | "registrationProfile"
  | "taxProfile"
  | "ownershipProfile"
  | "marketProfile"
  | "offerArchitecture"
  | "salesSystem"
  | "marketingSystem"
  | "operationsSystem"
  | "projectionProfile"
  | "riskProfile"
  | "complianceProfile"
  | "executionRoadmap"
  // Patch 2: Legal & Document Pack
  | "documentProfile";

export interface BlueprintIdentity {
  name?: string;
  archetype?: string;
  industry?: string;
  tagline?: string;
  oneLiner?: string;
  mission?: string;
  country?: string;
}

export interface BlueprintOperatingModel {
  revenueModel?: string;
  deliveryMode?: string;
  serviceArea?: string;
  channels?: string[];
  teamSize?: string;
  capacity?: string;
}

export interface BlueprintGoals {
  northStar?: string;
  ninetyDayGoals?: string[];
  twelveMonthGoals?: string[];
  priorities?: string[];
}

export interface BlueprintConstraints {
  budgetRange?: string;
  timeCommitment?: string;
  riskTolerance?: string;
  dealbreakers?: string[];
}

export interface BlueprintBrand {
  voice?: string;
  tone?: string;
  primaryColor?: string;
  secondaryColor?: string;
  logoUrl?: string;
  valueProps?: string[];
}

export interface BlueprintCustomerModel {
  idealCustomer?: string;
  segments?: string[];
  painPoints?: string[];
  jobsToBeDone?: string[];
}

export interface BlueprintFinancials {
  currency?: string;
  pricingModel?: string;
  avgTicket?: number;
  monthlyTarget?: number;
  costStructure?: string;
}

export interface BlueprintIntelligence {
  topProductCategories?: string[];
  topChannels?: string[];
  recentMomentumScore?: number;
  quoteConversionRate?: number;
  noShowRate?: number;
  expenseRatio?: number;
  seasonalPattern?: string;
  campaignOpenRate?: number;
  campaignClickRate?: number;
  inferredAt?: string;
}

export interface BlueprintWorkflowModel {
  primaryWorkflow?: string;
  appointmentBooking?: boolean;
  projectManagement?: boolean;
  retainerCycle?: boolean;
  walkInQueue?: boolean;
  ecommerceFulfillment?: boolean;
  customInquiryFlow?: boolean;
  quoteDrivenSales?: boolean;
  highNoShowRate?: boolean;
  seasonalBusiness?: boolean;
}

export interface BlueprintAiPreferences {
  autonomyLevel?: number;
  tone?: string;
  outreachStyle?: string;
  reportingCadence?: string;
  notifyOnRecommendations?: boolean;
  notifyOnAlerts?: boolean;
  approvedActions?: string[];
  voiceEnabled?: boolean;
}

// --- Genesis section types (Business Genesis Patch 1) ----------------------

export interface BlueprintFounderProfile {
  founderName?: string;
  background?: string;
  skills?: string[];
  weaknesses?: string[];
  riskTolerance?: string;
  weeklyAvailabilityHours?: number;
  visionStatement?: string;
}

export type BlueprintRecommendedEntityType =
  | "SOLE_TRADER"
  | "PARTNERSHIP"
  | "LIMITED_COMPANY"
  | "NONPROFIT"
  | "UNKNOWN";

export interface BlueprintLegalProfile {
  country?: string;
  jurisdiction?: string;
  hasPhysicalLocation?: boolean;
  recommendedEntityType?: BlueprintRecommendedEntityType;
  entityTypeReason?: string;
  regulatedIndustry?: boolean;
  regulatedIndustryNotes?: string[];
  legalRiskFlags?: string[];
  disclaimerAcceptedAt?: string;
}

export interface BlueprintRegistrationProfile {
  businessNameStatus?: string;
  companiesRegistryStatus?: string;
  birStatus?: string;
  nisEmployerStatus?: string;
  vatStatus?: string;
  businessBankStatus?: string;
  requiredLicenses?: string[];
  missingRegistrationSteps?: string[];
}

export interface BlueprintTaxProfile {
  country?: string;
  taxIdStatus?: string;
  vatThresholdWatch?: boolean;
  estimatedAnnualRevenue?: number;
  payrollExpected?: boolean;
  contractorPaymentsExpected?: boolean;
  taxReadinessScore?: number;
}

export interface BlueprintOwner {
  name?: string;
  sharePct?: number;
  role?: string;
}

export interface BlueprintOwnershipProfile {
  hasPartners?: boolean;
  owners?: BlueprintOwner[];
  needsShareholderAgreement?: boolean;
  unresolvedOwnershipRisks?: string[];
}

export interface BlueprintMarketProfile {
  targetGeography?: string;
  marketCategory?: string;
  marketStage?: string;
  trends?: string[];
  barriersToEntry?: string[];
  demandSignals?: string[];
  marketOpportunityScore?: number;
  marketStrategyGeneratedAt?: string;
  competitorCount?: number;
}

export interface BlueprintOffer {
  name?: string;
  description?: string;
  price?: number;
  recurring?: boolean;
}

export interface BlueprintOfferArchitecture {
  coreOffer?: BlueprintOffer;
  offerLadder?: BlueprintOffer[];
  pricingTiers?: BlueprintOffer[];
  upsells?: BlueprintOffer[];
  recurringRevenueOpportunities?: string[];
}

export interface BlueprintSalesChannel {
  channel?: string;
  priority?: "LOW" | "MEDIUM" | "HIGH";
  notes?: string;
}

export interface BlueprintPipelineStage {
  name?: string;
  probability?: number;
}

export interface BlueprintConversionAssumptions {
  leadToConversationRate?: number;
  conversationToQuoteRate?: number;
  quoteToCloseRate?: number;
  avgSalesCycleDays?: number;
}

export interface BlueprintFollowUpStep {
  day?: number;
  channel?: string;
  messageTemplate?: string;
}

export interface BlueprintSalesSystem {
  salesChannels?: BlueprintSalesChannel[];
  pipelineStages?: BlueprintPipelineStage[];
  leadSources?: string[];
  conversionAssumptions?: BlueprintConversionAssumptions;
  followUpCadence?: BlueprintFollowUpStep[];
}

export interface BlueprintMarketingChannel {
  channel?: string;
  purpose?: string;
  priority?: "LOW" | "MEDIUM" | "HIGH";
}

export interface BlueprintMarketingSystem {
  channels?: BlueprintMarketingChannel[];
  contentPillars?: string[];
  campaignIdeas?: string[];
  brandNarrative?: string;
  launchPlan?: string[];
}

export interface BlueprintWorkflowStep {
  name?: string;
  owner?: string;
  tools?: string[];
  durationMin?: number;
}

export interface BlueprintOperationsSystem {
  coreWorkflows?: BlueprintWorkflowStep[];
  dailyChecklist?: string[];
  weeklyChecklist?: string[];
  fulfillmentProcess?: BlueprintWorkflowStep[];
  customerSupportProcess?: BlueprintWorkflowStep[];
  vendorProcess?: BlueprintWorkflowStep[];
}

export interface ProjectionMonth {
  month?: string;
  revenue?: number;
  units?: number;
  expenses?: number;
  netProfit?: number;
}

export interface BlueprintProjectionProfile {
  startupCapital?: number;
  startupCosts?: number;
  monthlyFixedCosts?: number;
  variableCostPercent?: number;
  avgTicket?: number;
  expectedMonthlyUnits?: number;
  conservativeMonthlyUnits?: number;
  aggressiveMonthlyUnits?: number;
  breakEvenUnits?: number;
  breakEvenRevenue?: number;
  runwayMonths?: number;
  monthByMonth?: ProjectionMonth[];
}

export interface BlueprintRiskItem {
  description?: string;
  likelihood?: "LOW" | "MEDIUM" | "HIGH";
  impact?: "LOW" | "MEDIUM" | "HIGH";
  mitigation?: string;
}

export interface BlueprintRiskProfile {
  financialRisks?: BlueprintRiskItem[];
  legalRisks?: BlueprintRiskItem[];
  marketRisks?: BlueprintRiskItem[];
  operationalRisks?: BlueprintRiskItem[];
  founderRisks?: BlueprintRiskItem[];
  riskScore?: number;
  mitigationPlan?: string[];
}

export type ComplianceItemStatus =
  | "NOT_STARTED"
  | "IN_PROGRESS"
  | "DONE"
  | "NOT_APPLICABLE";

export type ComplianceItemPriority =
  | "LOW"
  | "MEDIUM"
  | "HIGH"
  | "CRITICAL";

export interface ComplianceItem {
  id?: string;
  label?: string;
  authority?: string;
  status?: ComplianceItemStatus;
  priority?: ComplianceItemPriority;
  notes?: string;
}

export interface BlueprintComplianceProfile {
  complianceItems?: ComplianceItem[];
  complianceScore?: number;
}

export interface BlueprintExecutionRoadmap {
  today?: string[];
  sevenDayPlan?: string[];
  thirtyDayPlan?: string[];
  ninetyDayPlan?: string[];
  twelveMonthMilestones?: string[];
}

export interface BlueprintGeneratedDocument {
  instanceId: string;
  documentTypeSlug: string;
  title: string;
  generatedAt: string;
}

export interface BlueprintDocumentProfile {
  generatedDocuments?: BlueprintGeneratedDocument[];
  missingDocuments?: string[];
  recommendedDocuments?: string[];
  lastGeneratedAt?: string;
}

export interface BlueprintConfidenceScores {
  identity?: number;
  operatingModel?: number;
  goals?: number;
  constraints?: number;
  brand?: number;
  customerModel?: number;
  financials?: number;
  intelligence?: number;
  workflowModel?: number;
  aiPreferences?: number;
  // Genesis section confidence scores
  founderProfile?: number;
  legalProfile?: number;
  registrationProfile?: number;
  taxProfile?: number;
  ownershipProfile?: number;
  marketProfile?: number;
  offerArchitecture?: number;
  salesSystem?: number;
  marketingSystem?: number;
  operationsSystem?: number;
  projectionProfile?: number;
  riskProfile?: number;
  complianceProfile?: number;
  executionRoadmap?: number;
  documentProfile?: number;
}

export interface BlueprintData {
  schemaVersion: number;
  identity: BlueprintIdentity;
  operatingModel: BlueprintOperatingModel;
  goals: BlueprintGoals;
  constraints: BlueprintConstraints;
  brand: BlueprintBrand;
  customerModel: BlueprintCustomerModel;
  financials: BlueprintFinancials;
  intelligence: BlueprintIntelligence;
  workflowModel: BlueprintWorkflowModel;
  aiPreferences: BlueprintAiPreferences;
  // Genesis sections
  founderProfile?: BlueprintFounderProfile;
  legalProfile?: BlueprintLegalProfile;
  registrationProfile?: BlueprintRegistrationProfile;
  taxProfile?: BlueprintTaxProfile;
  ownershipProfile?: BlueprintOwnershipProfile;
  marketProfile?: BlueprintMarketProfile;
  offerArchitecture?: BlueprintOfferArchitecture;
  salesSystem?: BlueprintSalesSystem;
  marketingSystem?: BlueprintMarketingSystem;
  operationsSystem?: BlueprintOperationsSystem;
  projectionProfile?: BlueprintProjectionProfile;
  riskProfile?: BlueprintRiskProfile;
  complianceProfile?: BlueprintComplianceProfile;
  executionRoadmap?: BlueprintExecutionRoadmap;
  documentProfile?: BlueprintDocumentProfile;
  confidenceScores: BlueprintConfidenceScores;
  completeness: number;
  readinessScore?: number;
  lastAnalyzedAt?: string;
  updatedAt: string;
}

export type BlueprintSectionDataMap = {
  identity: BlueprintIdentity;
  operatingModel: BlueprintOperatingModel;
  goals: BlueprintGoals;
  constraints: BlueprintConstraints;
  brand: BlueprintBrand;
  customerModel: BlueprintCustomerModel;
  financials: BlueprintFinancials;
  intelligence: BlueprintIntelligence;
  workflowModel: BlueprintWorkflowModel;
  aiPreferences: BlueprintAiPreferences;
  // Genesis sections
  founderProfile: BlueprintFounderProfile;
  legalProfile: BlueprintLegalProfile;
  registrationProfile: BlueprintRegistrationProfile;
  taxProfile: BlueprintTaxProfile;
  ownershipProfile: BlueprintOwnershipProfile;
  marketProfile: BlueprintMarketProfile;
  offerArchitecture: BlueprintOfferArchitecture;
  salesSystem: BlueprintSalesSystem;
  marketingSystem: BlueprintMarketingSystem;
  operationsSystem: BlueprintOperationsSystem;
  projectionProfile: BlueprintProjectionProfile;
  riskProfile: BlueprintRiskProfile;
  complianceProfile: BlueprintComplianceProfile;
  executionRoadmap: BlueprintExecutionRoadmap;
  documentProfile: BlueprintDocumentProfile;
};

// --- Genesis API types (Business Genesis Patch 1) ---------------------------

export type GenesisQuestionType =
  | "text"
  | "number"
  | "boolean"
  | "currency"
  | "textarea"
  | "select"
  | "multi_select";

export interface GenesisQuestion {
  id: string;
  section: BlueprintSectionKey;
  field: string;
  label: string;
  helper?: string;
  type: GenesisQuestionType;
  options?: string[] | Array<{ label: string; value: string }>;
  priority: number;
}

export interface GenesisReadinessScore {
  overall: number;
  legal: number;
  finance: number;
  market: number;
  operations: number;
  compliance: number;
  blockers: string[];
}

export interface GenesisIdeaAnalysis {
  summary: string;
  extracted: Partial<BlueprintData>;
  readiness: GenesisReadinessScore;
  suggestedEntityType: BlueprintRecommendedEntityType | string;
  nextQuestions: GenesisQuestion[];
}

export interface GenesisProgress {
  blueprint: BlueprintData;
  readiness: GenesisReadinessScore;
  nextQuestions: GenesisQuestion[];
  complianceItems: ComplianceItem[];
}

export interface GenesisActionPlan {
  roadmap: string[];
  executionRoadmap?: BlueprintExecutionRoadmap;
  complianceItems: ComplianceItem[];
  nextActions: string[];
  projectedRunwayMonths?: number;
  breakEvenRevenue?: number;
}

export interface GeneratedDoc {
  instanceId: string;
  documentTypeSlug: string;
  title: string;
  status: string;
  createdAt: string;
}

export interface GenesisDocumentPackResult {
  generated: GeneratedDoc[];
  missing: string[];
}
