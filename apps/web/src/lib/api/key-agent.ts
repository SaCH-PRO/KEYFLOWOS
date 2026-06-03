import { apiGet, apiPut } from "@/lib/api";

export interface KeyAgentConfig {
  id: string;
  businessId: string;
  name: string;
  agentType: string;
  status: string;
  channels: unknown[];
  goals: unknown[];
  allowedTools: unknown[];
  approvalPolicy: Record<string, unknown>;
  memoryScope: string;
  knowledgeSources: unknown[];
  kpis: unknown[];
  createdAt: string;
  updatedAt: string;
}

export async function fetchAgentConfig(businessId: string) {
  return apiGet<KeyAgentConfig>(`/ai/businesses/${businessId}/agent-config`);
}

export async function updateAgentConfig(businessId: string, body: Partial<KeyAgentConfig>) {
  return apiPut<KeyAgentConfig>(`/ai/businesses/${businessId}/agent-config`, body);
}
