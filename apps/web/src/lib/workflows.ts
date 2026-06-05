import { apiGet, apiPost } from "./api";

export interface WorkflowTemplate {
  key: string;
  name: string;
  description: string;
  category: string;
  steps: Array<{
    order: number;
    toolName: string | null;
    module: string | null;
    action: string;
    description: string;
    riskTier: number;
    dependsOnOrders: number[];
    inputPayload: Record<string, unknown> | null;
    expectedBenefit: string;
  }>;
}

export async function listWorkflows(businessId: string) {
  return apiGet<WorkflowTemplate[]>(`/ai/businesses/${businessId}/ai/workflows`);
}

export async function instantiateWorkflow(
  businessId: string,
  templateKey: string,
  body?: { contactId?: string; projectId?: string; amount?: number }
) {
  return apiPost<{ planId: string; plan: unknown }>({
    path: `/ai/businesses/${businessId}/ai/workflows/${templateKey}/instantiate`,
    body: body ?? {},
  });
}
