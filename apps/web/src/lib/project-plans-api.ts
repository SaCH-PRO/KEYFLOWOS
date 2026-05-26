import { apiPost, apiGet, apiPatch, apiDelete } from "./api";

export interface ProjectPlan {
  id: string;
  status: string;
  userIdea: string;
  strategySummary: string | null;
  estimatedTotalHours: number | null;
  estimatedBudget: number | null;
  estimatedPeople: number | null;
  estimatedDurationDays: number | null;
  riskAnalysis: Record<string, unknown> | null;
  swotAnalysis: Record<string, unknown> | null;
  goalId: string | null;
  goal: { id: string; title: string; category: string } | null;
  projectId: string | null;
  project: { id: string; name: string; status: string } | null;
  timelineEvents: ProjectPlanEvent[];
  createdAt: string;
  updatedAt: string;
}

export interface ProjectPlanEvent {
  id: string;
  sortOrder: number;
  eventType: string;
  title: string;
  description: string | null;
  executionContext: string;
  automationTool: string | null;
  toolPayload: Record<string, unknown> | null;
  autoExecute: boolean;
  requiresApproval: boolean;
  manualInstructions: string | null;
  manualEvidenceRequired: boolean;
  estimatedHours: number | null;
  estimatedStart: string | null;
  estimatedEnd: string | null;
  dependsOn: string[];
  requiredRoles: string[];
  estimatedCost: number | null;
  projectTaskId: string | null;
  projectMilestoneId: string | null;
  status: string;
  impactAnalysis: Record<string, unknown> | null;
}

export interface GeneratePlanInput {
  userIdea: string;
  goalId?: string;
  options?: {
    estimatedBudget?: number;
    estimatedDurationDays?: number;
    preferredModules?: string[];
  };
}

export async function generatePlan(businessId: string, input: GeneratePlanInput) {
  return apiPost<ProjectPlan>({
    path: `/projects/businesses/${encodeURIComponent(businessId)}/plans`,
    body: input,
  });
}

export async function fetchPlans(businessId: string) {
  return apiGet<ProjectPlan[]>(`/projects/businesses/${encodeURIComponent(businessId)}/plans`);
}

export async function fetchPlan(businessId: string, planId: string) {
  return apiGet<ProjectPlan>(`/projects/businesses/${encodeURIComponent(businessId)}/plans/${encodeURIComponent(planId)}`);
}

export async function approvePlan(businessId: string, planId: string) {
  return apiPost<ProjectPlan>({
    path: `/projects/businesses/${encodeURIComponent(businessId)}/plans/${encodeURIComponent(planId)}/approve`,
    body: {},
  });
}

export async function rejectPlan(businessId: string, planId: string) {
  return apiPost<ProjectPlan>({
    path: `/projects/businesses/${encodeURIComponent(businessId)}/plans/${encodeURIComponent(planId)}/reject`,
    body: {},
  });
}

export async function deletePlan(businessId: string, planId: string) {
  return apiDelete<ProjectPlan>(`/projects/businesses/${encodeURIComponent(businessId)}/plans/${encodeURIComponent(planId)}`);
}

export async function reorderPlanEvents(businessId: string, planId: string, updates: { eventId: string; sortOrder: number }[]) {
  return apiPost<ProjectPlan>({
    path: `/projects/businesses/${encodeURIComponent(businessId)}/plans/${encodeURIComponent(planId)}/events/reorder`,
    body: { updates },
  });
}

export async function analyzeImpact(businessId: string, planId: string, eventId: string, newSortOrder: number) {
  return apiPost<{
    canProceed: boolean;
    dependencyViolations: string[];
    timeDeltaDays: number;
    budgetDelta: number;
    peopleImpact: Array<{ role: string; impact: string; details: string }>;
    riskDelta: string;
    newRisks: Array<{ description: string; severity: string }>;
    pros: string[];
    cons: string[];
    recommendation: string;
  }>({
    path: `/projects/businesses/${encodeURIComponent(businessId)}/plans/${encodeURIComponent(planId)}/events/${encodeURIComponent(eventId)}/analyze-impact`,
    body: { newSortOrder },
  });
}

export async function executeInAppEvent(businessId: string, planId: string, eventId: string) {
  return apiPost<{ status: string; tool?: string }>({
    path: `/projects/businesses/${encodeURIComponent(businessId)}/plans/${encodeURIComponent(planId)}/events/${encodeURIComponent(eventId)}/execute`,
    body: {},
  });
}

export async function completeOutAppEvent(businessId: string, planId: string, eventId: string, evidence?: string) {
  return apiPost<{ status: string }>({
    path: `/projects/businesses/${encodeURIComponent(businessId)}/plans/${encodeURIComponent(planId)}/events/${encodeURIComponent(eventId)}/complete`,
    body: { evidence },
  });
}
