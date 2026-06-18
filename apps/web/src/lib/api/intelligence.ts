import { apiGet, apiPostSimple } from "@/lib/api";

export interface BusinessRule {
  id: string;
  businessId: string | null;
  name: string;
  description: string | null;
  module: string;
  triggerType: string;
  condition: Record<string, unknown>;
  action: Record<string, unknown>;
  severity: string;
  enabled: boolean;
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BusinessSignal {
  id: string;
  businessId: string;
  module: string;
  type: string;
  severity: string;
  title: string;
  description: string | null;
  entityType: string | null;
  entityId: string | null;
  contactId: string | null;
  score: number | null;
  value: string | null;
  currency: string | null;
  data: Record<string, unknown>;
  status: string;
  firstSeenAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
}

export interface HealthSnapshot {
  area: string;
  score: number;
  status: "HEALTHY" | "ATTENTION" | "AT_RISK" | "CRITICAL";
  reasons: string[];
  metrics: Record<string, number>;
}

export type IntelligencePriority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type IntelligenceDomain =
  | "EXECUTIVE"
  | "REVENUE"
  | "FINANCE"
  | "MARKETING"
  | "SALES"
  | "OPERATIONS"
  | "CLIENTS"
  | "RISK"
  | "GENOME"
  | "ASSETS"
  | "TEMPORAL_FLOW";

export interface BusinessIntelligenceRecommendedAction {
  label: string;
  actionType:
    | "OPEN_GENOME"
    | "OPEN_TEMPORAL_FLOW"
    | "REVIEW_EVOLUTION_PROPOSALS"
    | "REVIEW_ASSETS"
    | "CREATE_TASK"
    | "GENERATE_DOCUMENT"
    | "REVIEW_FINANCE";
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

export async function fetchRules(businessId: string, module?: string) {
  const params = module ? `?module=${encodeURIComponent(module)}` : "";
  return apiGet<BusinessRule[]>(`/intelligence/businesses/${businessId}/rules${params}`);
}

export async function seedRules(businessId: string) {
  return apiPostSimple<{ success: boolean }>(`/intelligence/businesses/${businessId}/rules/seed`, {});
}

export async function fetchSignals(businessId: string, opts?: { module?: string; status?: string; severity?: string }) {
  const params = new URLSearchParams();
  if (opts?.module) params.set("module", opts.module);
  if (opts?.status) params.set("status", opts.status);
  if (opts?.severity) params.set("severity", opts.severity);
  return apiGet<{ items: BusinessSignal[]; total: number }>(`/intelligence/businesses/${businessId}/signals?${params.toString()}`);
}

export async function resolveSignal(businessId: string, id: string) {
  return apiPostSimple<BusinessSignal>(`/intelligence/businesses/${businessId}/signals/${id}/resolve`, {});
}

export async function dismissSignal(businessId: string, id: string) {
  return apiPostSimple<BusinessSignal>(`/intelligence/businesses/${businessId}/signals/${id}/dismiss`, {});
}

export async function fetchHealth(businessId: string) {
  return apiGet<HealthSnapshot[]>(`/intelligence/businesses/${businessId}/health`);
}

export async function refreshHealth(businessId: string) {
  return apiPostSimple<HealthSnapshot[]>(`/intelligence/businesses/${businessId}/health/refresh`, {});
}

export async function runScan(businessId: string) {
  return apiPostSimple<{ success: boolean }>(`/intelligence/businesses/${businessId}/scan`, {});
}

export async function getExecutiveBrief(businessId: string) {
  return apiGet<BusinessExecutiveBrief>(`/intelligence/businesses/${businessId}/executive-brief`);
}
