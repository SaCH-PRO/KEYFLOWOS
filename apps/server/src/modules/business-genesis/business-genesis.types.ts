import type {
  BlueprintData,
  BlueprintExecutionRoadmap,
  BlueprintRecommendedEntityType,
  BlueprintSectionKey,
  ComplianceItem,
} from '../blueprint/blueprint.types';

export type GenesisQuestionType =
  | 'text'
  | 'number'
  | 'boolean'
  | 'currency'
  | 'textarea'
  | 'select'
  | 'multi_select';

export interface GenesisQuestion {
  id: string;
  section: BlueprintSectionKey;
  field: string;
  label: string;
  helper?: string;
  type: GenesisQuestionType;
  options?: string[];
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

export interface MarketStrategyDto {
  id: string;
  businessId: string;
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
  launchPlan: {
    summary: string;
    phases: Array<{
      name: string;
      duration: string;
      actions: string[];
    }>;
  };
  analysisSummary: {
    marketOpportunityScore: number;
    keyInsight: string;
  };
  generatedAt: string;
}

export interface CompetitorDto {
  id: string;
  businessId: string;
  name: string;
  threatLevel: 'LOW' | 'MEDIUM' | 'HIGH' | null;
  strengths: string[];
  weaknesses: string[];
  positioning: string | null;
}

export interface MarketStrategyResponse {
  strategy: MarketStrategyDto | null;
  competitors: CompetitorDto[];
  documentInstanceId: string | null;
  readiness: GenesisReadinessScore;
}
