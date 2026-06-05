import { apiGet, apiPost } from "./api";

export interface PlanStep {
  id: string;
  order: number;
  status: string;
  toolName: string | null;
  module: string | null;
  action: string;
  description: string;
  riskTier: number;
  requiresApproval: boolean;
  dependsOn: string[];
  inputPayload: Record<string, unknown> | null;
  outputResult: Record<string, unknown> | null;
  errorMessage: string | null;
  expectedBenefit: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface AiPlan {
  id: string;
  status: string;
  objective: string;
  urgency: string;
  modules: string[];
  maxRiskTier: number;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  steps: PlanStep[];
}

export async function getPlan(businessId: string, planId: string) {
  return apiGet<AiPlan>(`/ai/businesses/${businessId}/ai/plans/${planId}`);
}

export async function listPlans(businessId: string, status?: string, limit = 20) {
  const qs = status ? `?status=${status}&limit=${limit}` : `?limit=${limit}`;
  return apiGet<AiPlan[]>(`/ai/businesses/${businessId}/ai/plans${qs}`);
}

export async function approvePlan(businessId: string, planId: string) {
  return apiPost<AiPlan>({ path: `/ai/businesses/${businessId}/ai/plans/${planId}/approve`, body: {} });
}

export async function undoPlanStep(businessId: string, planId: string, stepId: string, undoId?: string) {
  return apiPost<{ success: boolean; message: string }>({
    path: `/ai/businesses/${businessId}/ai/plans/${planId}/steps/${stepId}/undo`,
    body: undoId ? { undoId } : {},
  });
}
