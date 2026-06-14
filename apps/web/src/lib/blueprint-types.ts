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
  | "aiPreferences";

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
  confidenceScores: BlueprintConfidenceScores;
  completeness: number;
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
};
