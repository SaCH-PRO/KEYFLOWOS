import { apiGet, apiPost } from "@/lib/api";
import type {
  GenesisIdeaAnalysis,
  GenesisQuestion,
  GenesisProgress,
  GenesisReadinessScore,
  GenesisActionPlan,
  GenesisDocumentPackResult,
} from "@/lib/blueprint-types";

export function analyzeIdea(businessId: string, ideaText: string) {
  return apiPost<GenesisIdeaAnalysis>({
    path: `/business-genesis/businesses/${businessId}/analyze-idea`,
    body: { ideaText },
  });
}

export function getNextQuestions(businessId: string, limit = 3) {
  return apiGet<GenesisQuestion[]>(
    `/business-genesis/businesses/${businessId}/questions/next?limit=${limit}`,
  );
}

export function submitAnswers(businessId: string, answers: Record<string, unknown>) {
  return apiPost<GenesisProgress>({
    path: `/business-genesis/businesses/${businessId}/answers`,
    body: { answers },
  });
}

export function getReadiness(businessId: string) {
  return apiGet<GenesisReadinessScore>(
    `/business-genesis/businesses/${businessId}/readiness`,
  );
}

export function generateRoadmap(businessId: string) {
  return apiPost<GenesisActionPlan>({
    path: `/business-genesis/businesses/${businessId}/generate-roadmap`,
    body: {},
  });
}

export function generateDocumentPack(businessId: string) {
  return apiPost<GenesisDocumentPackResult>({
    path: `/business-genesis/businesses/${businessId}/generate-document-pack`,
    body: {},
  });
}

export function getDocumentPack(businessId: string) {
  return apiGet<GenesisDocumentPackResult>(
    `/business-genesis/businesses/${businessId}/document-pack`,
  );
}

export function generateRiskRegister(businessId: string) {
  return apiPost<unknown[]>({
    path: `/business-genesis/businesses/${businessId}/generate-risk-register`,
    body: {},
  });
}

export interface MarketStrategyResponse {
  strategy: {
    id: string;
    businessId: string;
    swot: { strengths: string[]; weaknesses: string[]; opportunities: string[]; threats: string[] };
    pestle: { political: string; economic: string; social: string; technological: string; legal: string; environmental: string };
    positioning: { tagline: string; valueProposition: string; keyMessages: string[]; differentiators: string[]; targetSegments: string[] };
    launchPlan: { summary: string; phases: { name: string; duration: string; actions: string[] }[] };
    analysisSummary: { marketOpportunityScore: number; keyInsight: string };
    generatedAt: string;
  } | null;
  competitors: {
    id: string;
    businessId: string;
    name: string;
    threatLevel: "LOW" | "MEDIUM" | "HIGH" | null;
    strengths: string[];
    weaknesses: string[];
    positioning: string | null;
  }[];
  documentInstanceId: string | null;
  readiness: GenesisReadinessScore;
}

export function generateMarketStrategy(businessId: string) {
  return apiPost<MarketStrategyResponse>({
    path: `/business-genesis/businesses/${businessId}/generate-market-strategy`,
    body: {},
  });
}

export function getMarketStrategy(businessId: string) {
  return apiGet<MarketStrategyResponse>(
    `/business-genesis/businesses/${businessId}/market-strategy`,
  );
}
