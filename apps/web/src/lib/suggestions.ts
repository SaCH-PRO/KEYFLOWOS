import { apiGet, apiPost } from "./api";

export interface ChatSuggestion {
  id: string;
  category: string;
  title: string;
  message: string;
  actions: Array<{
    label: string;
    value: string;
    toolName?: string;
    args?: Record<string, unknown>;
  }>;
  severity: 'critical' | 'warning' | 'opportunity' | 'info';
  metric?: string;
  createdAt: string;
}

export async function getSuggestions(businessId: string) {
  return apiGet<ChatSuggestion[]>(`/ai/businesses/${businessId}/ai/suggestions`);
}

export async function refreshSuggestions(businessId: string) {
  return apiPost<{ suggestions: ChatSuggestion[]; count: number }>({
    path: `/ai/businesses/${businessId}/ai/suggestions/refresh`,
    body: {},
  });
}

export async function dismissSuggestion(businessId: string, suggestionId: string) {
  return apiPost<{ dismissed: boolean }>({
    path: `/ai/businesses/${businessId}/ai/suggestions/${suggestionId}/dismiss`,
    body: {},
  });
}

export async function blockSuggestionCategory(businessId: string, category: string) {
  return apiPost<{ blocked: boolean }>({
    path: `/ai/businesses/${businessId}/ai/suggestions/${category}/block`,
    body: {},
  });
}
