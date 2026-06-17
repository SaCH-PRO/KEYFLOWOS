/**
 * Canonical Business Blueprint section types.
 *
 * These types are the source of truth for the shape of every JSON column on
 * the `BusinessBlueprint` Prisma model. They are imported by both the Nest
 * service/controller (server-side) and mirrored in the web app
 * (`apps/web/src/lib/blueprint-types.ts`) so the editor page has compile-time
 * field-name guarantees.
 *
 * IMPORTANT: every field is optional. The blueprint is a *living* document
 * that fills in over time as the operator answers onboarding questions and
 * the system infers signals from events. A missing field must always be
 * tolerated — completeness is computed separately in the service.
 */

export type BlueprintSectionKey =
  | 'identity'
  | 'operatingModel'
  | 'goals'
  | 'constraints'
  | 'brand'
  | 'customerModel'
  | 'financials'
  | 'intelligence'
  | 'workflowModel'
  | 'aiPreferences'
  // Genesis sections (Business Genesis Patch 1)
  | 'founderProfile'
  | 'legalProfile'
  | 'registrationProfile'
  | 'taxProfile'
  | 'ownershipProfile'
  | 'marketProfile'
  | 'offerArchitecture'
  | 'salesSystem'
  | 'marketingSystem'
  | 'operationsSystem'
  | 'projectionProfile'
  | 'riskProfile'
  | 'complianceProfile'
  | 'executionRoadmap'
  // Patch 2: Legal & Document Pack
  | 'documentProfile';

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
  | 'SOLE_TRADER'
  | 'PARTNERSHIP'
  | 'LIMITED_COMPANY'
  | 'NONPROFIT'
  | 'UNKNOWN';

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
  priority?: 'LOW' | 'MEDIUM' | 'HIGH';
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
  priority?: 'LOW' | 'MEDIUM' | 'HIGH';
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
  baseMonthlyRevenue?: number;
  conservativeMonthlyRevenue?: number;
  aggressiveMonthlyRevenue?: number;
  breakEvenUnits?: number;
  breakEvenRevenue?: number;
  runwayMonths?: number;
  monthByMonth?: ProjectionMonth[];
}

export interface BlueprintRiskItem {
  description?: string;
  likelihood?: 'LOW' | 'MEDIUM' | 'HIGH';
  impact?: 'LOW' | 'MEDIUM' | 'HIGH';
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
  | 'NOT_STARTED'
  | 'IN_PROGRESS'
  | 'DONE'
  | 'NOT_APPLICABLE';

export type ComplianceItemPriority =
  | 'LOW'
  | 'MEDIUM'
  | 'HIGH'
  | 'CRITICAL';

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
}

export type DnaSectionKey =
  | 'founder'
  | 'vision'
  | 'business'
  | 'market'
  | 'financial'
  | 'legal'
  | 'operations'
  | 'sales'
  | 'marketing'
  | 'growth'
  | 'technology';

export type GenomeStage =
  | 'CONCEPT'
  | 'VALIDATED_CONCEPT'
  | 'REGISTERED_ENTITY'
  | 'REVENUE_ENGINE'
  | 'OPERATING_BUSINESS'
  | 'GROWTH_BUSINESS'
  | 'ENTERPRISE_READY';

export interface DnaSectionScore {
  key: DnaSectionKey;
  label: string;
  integrity: number;
  confidence: number;
  summary: string;
  fieldsCaptured: number;
  fieldsTotal: number;
  missingFields: string[];
  recommendation: string;
}

export interface GenomeIntegrityResult {
  genomeIntegrity: number;
  genomeDnaScores: Record<DnaSectionKey, number>;
  genomeDnaConfidence: Record<DnaSectionKey, number>;
  genomeStage: GenomeStage;
  threePillarMinimumMet: boolean;
  dnaSections: DnaSectionScore[];
}

export interface GenomeRecommendation {
  id: string;
  section: DnaSectionKey;
  title: string;
  reason: string;
  href?: string;
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

  // Business Genome Phase 1 cache/state fields
  genomeIntegrity?: number;
  genomeDnaScores?: Record<DnaSectionKey, number>;
  genomeDnaConfidence?: Record<DnaSectionKey, number>;
  genomeStage?: GenomeStage;
  genesisCompleted?: boolean;
  constitutionVersion?: number;
  constitutionGeneratedAt?: string;

  // Phase 2+ architecture hooks
  lastGenomeSyncAt?: string;
  businessAssets?: Record<string, unknown>;
  executiveReadinessScore?: number;

  updatedAt: string;
}

/**
 * Patch shape accepted by `BlueprintService.updateBlueprint`. Each section is
 * shallow-merged. Pass `null` for a field to clear it; `undefined` is treated
 * as "leave as-is".
 */
export interface BlueprintPatch {
  identity?: Partial<BlueprintIdentity>;
  operatingModel?: Partial<BlueprintOperatingModel>;
  goals?: Partial<BlueprintGoals>;
  constraints?: Partial<BlueprintConstraints>;
  brand?: Partial<BlueprintBrand>;
  customerModel?: Partial<BlueprintCustomerModel>;
  financials?: Partial<BlueprintFinancials>;
  intelligence?: Partial<BlueprintIntelligence>;
  workflowModel?: Partial<BlueprintWorkflowModel>;
  aiPreferences?: Partial<BlueprintAiPreferences>;
  // Genesis sections
  founderProfile?: Partial<BlueprintFounderProfile>;
  legalProfile?: Partial<BlueprintLegalProfile>;
  registrationProfile?: Partial<BlueprintRegistrationProfile>;
  taxProfile?: Partial<BlueprintTaxProfile>;
  ownershipProfile?: Partial<BlueprintOwnershipProfile>;
  marketProfile?: Partial<BlueprintMarketProfile>;
  offerArchitecture?: Partial<BlueprintOfferArchitecture>;
  salesSystem?: Partial<BlueprintSalesSystem>;
  marketingSystem?: Partial<BlueprintMarketingSystem>;
  operationsSystem?: Partial<BlueprintOperationsSystem>;
  projectionProfile?: Partial<BlueprintProjectionProfile>;
  riskProfile?: Partial<BlueprintRiskProfile>;
  complianceProfile?: Partial<BlueprintComplianceProfile>;
  executionRoadmap?: Partial<BlueprintExecutionRoadmap>;
  documentProfile?: Partial<BlueprintDocumentProfile>;
  confidenceScores?: Partial<BlueprintConfidenceScores>;
  readinessScore?: number;
  lastAnalyzedAt?: string;
}

export interface RecommendedSetupStep {
  id: string;
  section: BlueprintSectionKey;
  title: string;
  reason: string;
  href?: string;
}

export interface SetupStep {
  id: BlueprintSectionKey;
  label: string;
  done: boolean;
}
