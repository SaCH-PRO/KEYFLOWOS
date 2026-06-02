import { apiGet, apiPost } from "@/lib/api";

export interface UserFeedback {
  id: string;
  userId: string | null;
  businessId: string | null;
  module: string | null;
  page: string | null;
  feedbackType: string;
  rating: number | null;
  message: string | null;
  status: string;
  createdAt: string;
}

export interface ActivationFunnel {
  days: number;
  businessId: string;
  milestones: {
    contactCreated: number;
    productCreated: number;
    invoiceCreated: number;
    quoteCreated: number;
    paymentReceived: number;
    storefrontPublished: number;
    keyCommandUsed: number;
    integrationConnected: number;
  };
}

export async function ingestProductEvent(
  businessId: string,
  event: {
    eventName: string;
    userId?: string;
    sessionId?: string;
    module?: string;
    entityType?: string;
    entityId?: string;
    properties?: Record<string, unknown>;
  },
) {
  return apiPost<{ id: string }>({
    path: `/analytics/businesses/${encodeURIComponent(businessId)}/events`,
    body: event,
  });
}

export async function createUserFeedback(
  businessId: string,
  feedback: {
    userId?: string;
    module?: string;
    page?: string;
    feedbackType: string;
    rating?: number;
    message?: string;
    context?: Record<string, unknown>;
  },
) {
  return apiPost<UserFeedback>({
    path: `/analytics/businesses/${encodeURIComponent(businessId)}/feedback`,
    body: feedback,
  });
}

export async function fetchUserFeedback(
  businessId: string,
  filters?: {
    module?: string;
    feedbackType?: string;
    status?: string;
    limit?: number;
    offset?: number;
  },
) {
  const params = new URLSearchParams();
  if (filters?.module) params.append("module", filters.module);
  if (filters?.feedbackType) params.append("feedbackType", filters.feedbackType);
  if (filters?.status) params.append("status", filters.status);
  if (filters?.limit) params.append("limit", String(filters.limit));
  if (filters?.offset) params.append("offset", String(filters.offset));
  const qs = params.toString() ? `?${params.toString()}` : "";
  return apiGet<{ items: UserFeedback[]; total: number }>(
    `/analytics/businesses/${encodeURIComponent(businessId)}/feedback${qs}`,
  );
}

export async function createAiQualitySignal(
  businessId: string,
  signal: {
    userId?: string;
    commandId?: string;
    module?: string;
    signalType: string;
    rating?: number;
    comment?: string;
    context?: Record<string, unknown>;
  },
) {
  return apiPost<{ id: string }>({
    path: `/analytics/businesses/${encodeURIComponent(businessId)}/ai-quality`,
    body: signal,
  });
}

export async function fetchActivationFunnel(businessId: string, days?: number) {
  const qs = days ? `?days=${days}` : "";
  return apiGet<ActivationFunnel>(
    `/analytics/businesses/${encodeURIComponent(businessId)}/activation-funnel${qs}`,
  );
}
