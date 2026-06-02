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
  const qs = new URLSearchParams();
  if (limit) qs.set("limit", String(limit));
  if (offset) qs.set("offset", String(offset));
  return apiGet<FeedbackInbox>(`/api/admin/analytics/feedback-inbox?${qs.toString()}`);
}

export async function fetchAdminRecentEvents(limit?: number) {
  const qs = limit ? `?limit=${limit}` : "";
  return apiGet<Array<{ id: string; eventName: string; module: string | null; businessId: string | null; occurredAt: string }>>(
    `/api/admin/analytics/recent-events${qs}`,
  );
}

// ── Admin Platform APIs ──

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: string;
  avatarUrl: string | null;
  businessCount: number;
}

export interface AdminUserList {
  items: AdminUser[];
  total: number;
}

export async function fetchAdminUsers(search?: string, limit = 50, offset = 0) {
  const qs = new URLSearchParams();
  if (search) qs.set("search", search);
  qs.set("limit", String(limit));
  qs.set("offset", String(offset));
  return apiGet<AdminUserList>(`/api/admin/users?${qs.toString()}`);
}

export interface AdminBusiness {
  id: string;
  name: string;
  slug: string | null;
  currency: string;
  timezone: string;
  owner: { id: string; email: string; name: string | null };
  memberCount: number;
  contactCount: number;
  invoiceCount: number;
}

export interface AdminBusinessList {
  items: AdminBusiness[];
  total: number;
}

export async function fetchAdminBusinesses(search?: string, limit = 50, offset = 0) {
  const qs = new URLSearchParams();
  if (search) qs.set("search", search);
  qs.set("limit", String(limit));
  qs.set("offset", String(offset));
  return apiGet<AdminBusinessList>(`/api/admin/businesses?${qs.toString()}`);
}

export interface AdminEvent {
  id: string;
  type: string;
  action: string;
  actorType: string;
  actorId: string;
  subjectType: string;
  subjectId: string;
  source: string;
  riskScore: number | null;
  businessName: string | null;
  createdAt: string;
}

export interface AdminEventList {
  items: AdminEvent[];
  total: number;
}

export async function fetchAdminEvents(eventType?: string, limit = 50, offset = 0) {
  const qs = new URLSearchParams();
  if (eventType) qs.set("eventType", eventType);
  qs.set("limit", String(limit));
  qs.set("offset", String(offset));
  return apiGet<AdminEventList>(`/api/admin/events?${qs.toString()}`);
}
