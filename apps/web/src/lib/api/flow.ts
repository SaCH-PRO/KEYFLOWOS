import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api";

export interface FlowTemplate {
  id: string;
  key: string;
  name: string;
  description: string | null;
  category: string;
  businessTypes: string[];
  nodes: unknown;
  edges: unknown;
  requiredConnectors: string[];
  estimatedImpact: string | null;
  riskTier: number;
  isSystem: boolean;
}

export interface AutomationFlow {
  id: string;
  businessId: string;
  name: string;
  description: string | null;
  category: string;
  status: string;
  goal: string | null;
  triggerSummary: string | null;
  riskTier: number;
  createdBy: string | null;
  blueprintTags: string[];
  metrics: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface FlowVersion {
  id: string;
  flowId: string;
  version: number;
  nodes: unknown;
  edges: unknown;
  settings: Record<string, unknown>;
  status: string;
  publishedAt: string | null;
  createdAt: string;
}

export interface FlowRun {
  id: string;
  businessId: string;
  flowId: string;
  flowVersionId: string;
  sourceEventId: string | null;
  contactId: string | null;
  status: string;
  startedAt: string;
  completedAt: string | null;
  currentNodeId: string | null;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  error: string | null;
  metrics: Record<string, unknown>;
}

export async function listFlowTemplates(businessId: string) {
  return apiGet<{ items: FlowTemplate[]; total: number }>(
    `/api/flows/businesses/${businessId}/templates`,
  );
}

export async function cloneFlowTemplate(businessId: string, templateId: string) {
  return apiPost<AutomationFlow>({
    path: `/api/flows/businesses/${businessId}/templates/${templateId}/clone`,
    body: {},
  });
}

export async function listFlows(
  businessId: string,
  params?: { status?: string; category?: string; limit?: number; offset?: number },
) {
  const search = new URLSearchParams();
  if (params?.status) search.set("status", params.status);
  if (params?.category) search.set("category", params.category);
  if (params?.limit) search.set("limit", String(params.limit));
  if (params?.offset) search.set("offset", String(params.offset));
  return apiGet<{ items: AutomationFlow[]; total: number }>(
    `/api/flows/businesses/${businessId}/flows?${search.toString()}`,
  );
}

export async function getFlow(businessId: string, flowId: string) {
  return apiGet<AutomationFlow & { versions: FlowVersion[] }>(
    `/api/flows/businesses/${businessId}/flows/${flowId}`,
  );
}

export async function createFlow(
  businessId: string,
  body: { name: string; description?: string; category?: string; goal?: string },
) {
  return apiPost<AutomationFlow>({
    path: `/api/flows/businesses/${businessId}/flows`,
    body,
  });
}

export async function updateFlow(
  businessId: string,
  flowId: string,
  body: Partial<{ name: string; description: string; category: string; goal: string; status: string }>,
) {
  return apiPatch<AutomationFlow>(
    `/api/flows/businesses/${businessId}/flows/${flowId}`,
    body,
  );
}

export async function publishFlow(businessId: string, flowId: string) {
  return apiPost<AutomationFlow>({
    path: `/api/flows/businesses/${businessId}/flows/${flowId}/publish`,
    body: {},
  });
}

export async function testFlow(
  businessId: string,
  flowId: string,
  body: { payload?: Record<string, unknown>; contactId?: string; sourceEventId?: string },
) {
  return apiPost<FlowRun>({
    path: `/api/flows/businesses/${businessId}/flows/${flowId}/test`,
    body,
  });
}

export async function deleteFlow(businessId: string, flowId: string) {
  return apiDelete<{ success: boolean }>(
    `/api/flows/businesses/${businessId}/flows/${flowId}`,
  );
}

export async function listFlowRuns(
  businessId: string,
  flowId: string,
  params?: { status?: string; limit?: number; offset?: number },
) {
  const search = new URLSearchParams();
  if (params?.status) search.set("status", params.status);
  if (params?.limit) search.set("limit", String(params.limit));
  if (params?.offset) search.set("offset", String(params.offset));
  return apiGet<{ items: FlowRun[]; total: number }>(
    `/api/flows/businesses/${businessId}/flows/${flowId}/runs?${search.toString()}`,
  );
}
