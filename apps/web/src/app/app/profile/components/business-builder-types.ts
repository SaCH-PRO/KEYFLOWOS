export type ProgressKey =
  | "hasProfile" | "hasServices" | "hasStore" | "storeEnabled"
  | "hasDocs" | "hasContacts" | "hasBookings" | "hasInvoices"
  | "hasExpenses" | "hasProjects" | "hasSequences" | "hasRecurring"
  | "hasCampaigns" | "hasReports" | "hasAI" | "hasAutomations";

export interface PhaseAction {
  label: string;
  description: string;
  icon: React.ElementType;
  route: string;
  doneKey: ProgressKey;
}

export interface Phase {
  id: string;
  label: string;
  tagline: string;
  icon: React.ElementType;
  colorVar: string;
  actions: PhaseAction[];
}

export interface BusinessModelCanvas {
  valueProposition: string;
  customerSegments: string;
  channels: string;
  customerRelationships: string;
  revenueStreams: string;
  keyResources: string;
  keyActivities: string;
  keyPartnerships: string;
  costStructure: string;
}

export interface RoadmapPhase {
  phase: string;
  timeline: string;
  objectives: string[];
  milestones: string[];
  estimatedCost: string;
  dependencies?: string[];
  reviewPoints?: string[];
}

export interface ActionItem {
  priority: "HIGH" | "MEDIUM" | "LOW";
  action: string;
  category: string;
  timeframe: string;
  details: string;
  module?: string;
  canParallel?: boolean;
  requiresExternal?: boolean;
}

export interface Risk {
  risk: string;
  impact: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  likelihood?: "HIGH" | "MEDIUM" | "LOW";
  category?: string;
  mitigation: string;
  contingency?: string;
  owner?: string;
}

export interface FinancialOutlook {
  startupCosts: string;
  monthlyBurn: string;
  breakEvenTimeline: string;
  yearOneRevenue: string;
  keyMetrics: string[];
  fundingStrategy: string;
  cashFlowProjection: string;
  sensitivityAnalysis?: string;
}

export interface SwotAnalysis {
  strengths: string[];
  weaknesses: string[];
  opportunities: string[];
  threats: string[];
}

export interface CompetitiveAnalysis {
  swot: SwotAnalysis;
  competitorLandscape: string;
  differentiators: string[];
  marketEntry: string;
}

export interface UnitEconomics {
  customerAcquisitionCost: string;
  lifetimeValue: string;
  ltvCacRatio: string;
  averageRevenue: string;
  grossMargin: string;
  contributionMargin: string;
  paybackPeriod: string;
  breakEvenUnits: string;
}

export interface ExecutiveBrief {
  businessThesis: string;
  conceptSummary: string;
  opportunitySize: string;
  keyAssumptions: string[];
  validationNeeded: string[];
  expertReviewAreas: string[];
  confidenceLevel: string;
  confidenceRationale: string;
}

export interface AssumptionEntry {
  assumption: string;
  category: string;
  confidence: string;
  validationMethod: string;
  impactIfWrong: string;
}

export interface GovernanceFramework {
  operatingModel: string;
  reviewCadence: string;
  kpiFramework: string[];
  escalationPathways: string;
  decisionRights: string;
}

export interface QualityScore {
  logicalCoherence: number;
  comprehensiveness: number;
  contextSpecificity: number;
  commercialRelevance: number;
  actionability: number;
  financialSensibility: number;
  operationalFeasibility: number;
  riskIdentification: number;
  overallGrade: string;
  improvementAreas: string[];
}

export interface GeneratedModel {
  summary: string;
  executiveBrief: ExecutiveBrief;
  canvas: BusinessModelCanvas;
  competitiveAnalysis: CompetitiveAnalysis;
  unitEconomics: UnitEconomics;
  roadmap: RoadmapPhase[];
  actionPlan: ActionItem[];
  financialOutlook: FinancialOutlook;
  risks: Risk[];
  assumptionsRegister: AssumptionEntry[];
  governanceFramework: GovernanceFramework;
  qualityScore: QualityScore;
  recommendedDocuments: string[];
}

export interface IntakeForm {
  businessIdea: string;
  targetMarket: string;
  valueProposition: string;
  revenueModel: string;
  goals: string;
  stage: string;
  challenges: string;
  budget: string;
  timeline: string;
  teamSize: string;
  location: string;
  legalStructure: string;
  industry: string;
  problemSolved: string;
  assets: string;
  competitiveContext: string;
  interactionMode: string;
  salesApproach: string;
  marketingStrategy: string;
  peopleStrategy: string;
  technologyStack: string;
  partnerships: string;
  intellectualProperty: string;
}

export interface SavedVersion {
  id: string;
  versionNumber: number;
  label?: string;
  summary: string;
  modelData: GeneratedModel;
  createdAt: string;
}
