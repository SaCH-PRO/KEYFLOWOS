import { apiGet } from "@/lib/api";

export interface PlatformOverview {
  totalUsers: number;
  totalBusinesses: number;
  businessesThisWeek: number;
  activeUsersToday: number;
  totalCommands: number;
  totalEvents: number;
  totalFeedback: number;
}

export interface ActivationFunnel {
  days: number;
  milestones: {
    contactCreated: number;
    productCreated: number;
    invoiceCreated: number;
    quoteCreated: number;
    paymentReceived: number;
    bookingCreated: number;
    storefrontPublished: number;
    keyCommandUsed: number;
    integrationConnected: number;
  };
}

export interface IntegrationHealth {
  totalConnections: number;
  needsAttention: number;
  healthy: number;
  totalProviders: number;
  recentSyncs: Array<{
    id: string;
    providerKey: string;
    status: string;
    startedAt: string;
    recordsRead: number;
    recordsCreated: number;
    error: string | null;
  }>;
}

export interface FeatureUsage {
  days: number;
  usage: Array<{
    id: string;
    day: string;
    module: string;
    featureKey: string;
    userCount: number;
    businessCount: number;
    eventCount: number;
  }>;
}

export interface KeyQuality {
  days: number;
  totalSignals: number;
  averageRating: number;
  byType: Array<{ type: string; count: number }>;
}

export interface FeedbackInbox {
  items: Array<{
    id: string;
    module: string | null;
    page: string | null;
    feedbackType: string;
    rating: number | null;
    message: string | null;
    status: string;
    createdAt: string;
  }>;
  total: number;
}

export async function fetchAdminOverview() {
  return apiGet<PlatformOverview>("/api/admin/analytics/overview");
}

export async function fetchAdminActivationFunnel(days?: number) {
  const qs = days ? `?days=${days}` : "";
  return apiGet<ActivationFunnel>(`/api/admin/analytics/activation-funnel${qs}`);
}

export async function fetchAdminIntegrationHealth() {
  return apiGet<IntegrationHealth>("/api/admin/analytics/integration-health");
}

export async function fetchAdminFeatureUsage(days?: number) {
  const qs = days ? `?days=${days}` : "";
  return apiGet<FeatureUsage>(`/api/admin/analytics/feature-usage${qs}`);
}

export async function fetchAdminKeyQuality(days?: number) {
  const qs = days ? `?days=${days}` : "";
  return apiGet<KeyQuality>(`/api/admin/analytics/key-quality${qs}`);
}

export async function fetchAdminFeedbackInbox(limit?: number, offset?: number) {
  const params = new URLSearchParams();
  if (limit) params.append("limit", String(limit));
  if (offset) params.append("offset", String(offset));
  const qs = params.toString() ? `?${params.toString()}` : "";
  return apiGet<FeedbackInbox>(`/api/admin/analytics/feedback-inbox${qs}`);
}

export async function fetchAdminRecentEvents(limit?: number) {
  const qs = limit ? `?limit=${limit}` : "";
  return apiGet<Array<{
    id: string;
    eventName: string;
    module: string | null;
    businessId: string | null;
    occurredAt: string;
  }>>(`/api/admin/analytics/recent-events${qs}`);
}
