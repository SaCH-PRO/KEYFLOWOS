import { apiGet, apiPatch, apiPost } from "@/lib/api";

export interface TemporalFlowEvent {
  id: string;
  businessId: string;
  userId?: string;
  source: string;
  type: string;
  module?: string;
  entityType?: string;
  entityId?: string;
  title: string;
  summary?: string;
  description?: string;
  startsAt?: string;
  endsAt?: string;
  occurredAt: string;
  status: string;
  importance: string;
  visibility: string;
  payload?: Record<string, unknown>;
  signals?: Record<string, unknown>;
  tags: string[];
  reminderAt?: string;
  genomeImpactPotential: boolean;
  externalId?: string;
  externalUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TemporalFlowAnalysisItem {
  title: string;
  reason?: string;
  eventId?: string;
}

export interface TemporalFlowOpportunity {
  title: string;
  evidence: string[];
}

export interface TemporalFlowRisk {
  title: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  evidence: string[];
}

export interface TemporalFlowGenomeCandidate {
  section: string;
  reason: string;
  evidence: string[];
}

export interface TemporalFlowMemoryInsight {
  title: string;
  reason: string;
  evidence?: string[];
  memoryId?: string;
}

export interface TemporalFlowAnalysis {
  summary: string;
  urgentItems: TemporalFlowAnalysisItem[];
  opportunities: TemporalFlowOpportunity[];
  risks: TemporalFlowRisk[];
  genomeProposalCandidates: TemporalFlowGenomeCandidate[];
  memoryInsights?: TemporalFlowMemoryInsight[];
}

export interface TemporalFlowMemory {
  id: string;
  businessId: string;
  entityType: string;
  entityId: string | null;
  type: string;
  content: string;
  sourceEventIds: string[];
  sourceModule: string;
  metadata: Record<string, unknown> | null;
  confidence: number;
  createdAt: string;
  updatedAt: string;
}

export interface TemporalFlowListParams {
  source?: string;
  type?: string;
  module?: string;
  status?: string;
  importance?: string;
  genomeImpactPotential?: boolean;
  from?: string;
  to?: string;
  limit?: number;
}

export function buildTemporalFlowQuery(params: TemporalFlowListParams): string {
  const qs = new URLSearchParams();
  if (params.source) qs.set("source", params.source);
  if (params.type) qs.set("type", params.type);
  if (params.module) qs.set("module", params.module);
  if (params.status) qs.set("status", params.status);
  if (params.importance) qs.set("importance", params.importance);
  if (params.genomeImpactPotential != null) qs.set("genomeImpactPotential", String(params.genomeImpactPotential));
  if (params.from) qs.set("from", params.from);
  if (params.to) qs.set("to", params.to);
  if (params.limit) qs.set("limit", String(params.limit));
  const query = qs.toString();
  return query ? `?${query}` : "";
}

export function getTemporalFlowEvents(businessId: string, params: TemporalFlowListParams = {}) {
  return apiGet<TemporalFlowEvent[]>(
    `/temporal-flow/businesses/${businessId}${buildTemporalFlowQuery(params)}`,
  );
}

export function getTemporalFlowCalendar(businessId: string, from: string, to: string) {
  return apiGet<TemporalFlowEvent[]>(
    `/temporal-flow/businesses/${businessId}/calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
  );
}

export function getTemporalFlowReminders(businessId: string) {
  return apiGet<TemporalFlowEvent[]>(`/temporal-flow/businesses/${businessId}/reminders`);
}

export function createTemporalFlowEvent(
  businessId: string,
  body: Partial<TemporalFlowEvent>,
) {
  return apiPost<TemporalFlowEvent>({
    path: `/temporal-flow/businesses/${businessId}`,
    body,
  });
}

export function resolveTemporalFlowEvent(businessId: string, eventId: string) {
  return apiPatch(`/temporal-flow/businesses/${businessId}/${eventId}/resolve`, {});
}

export function analyzeTemporalFlow(businessId: string) {
  return apiPost<TemporalFlowAnalysis>({
    path: `/temporal-flow/businesses/${businessId}/analyze`,
    body: {},
  });
}

export function syncGoogleCalendarToTemporalFlow(businessId: string) {
  return apiPost<{ synced: number; skipped: number }>({
    path: `/calendar/businesses/${businessId}/sync/google/temporal-flow`,
    body: {},
  });
}

export function getTemporalFlowMemory(
  businessId: string,
  params: {
    entityType?: string;
    entityId?: string;
    type?: string;
    limit?: number;
  } = {},
) {
  const qs = new URLSearchParams();
  if (params.entityType) qs.set("entityType", params.entityType);
  if (params.entityId) qs.set("entityId", params.entityId);
  if (params.type) qs.set("type", params.type);
  if (params.limit) qs.set("limit", String(params.limit));
  const query = qs.toString();
  return apiGet<TemporalFlowMemory[]>(
    `/temporal-flow/businesses/${businessId}/memory${query ? `?${query}` : ""}`,
  );
}

export function searchTemporalFlowMemory(businessId: string, query: string, limit = 10) {
  return apiGet<
    Array<{ id: string; content: string; sourceType: string; sourceId: string; similarity: number }>
  >(
    `/temporal-flow/businesses/${businessId}/memory/search?q=${encodeURIComponent(query)}&limit=${limit}`,
  );
}

export function compactTemporalFlowMemory(businessId: string) {
  return apiPost<{ id: string }>({
    path: `/temporal-flow/businesses/${businessId}/memory/compact`,
    body: {},
  });
}

export function detectTemporalFlowPatterns(businessId: string) {
  return apiPost<{ id: string }>({
    path: `/temporal-flow/businesses/${businessId}/memory/detect-patterns`,
    body: {},
  });
}
