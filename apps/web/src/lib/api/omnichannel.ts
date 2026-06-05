import { apiGet, apiPost, apiPatch } from "@/lib/api";

export interface IntentItem {
  id: string;
  intentType: string;
  confidence: number;
  riskLevel: string;
  recommendedAction: string | null;
  createdAt: string;
  contact?: { firstName: string | null; lastName: string | null; email: string | null; phone: string | null } | null;
}

export interface DraftItem {
  id: string;
  channel: string;
  purpose: string;
  body: string;
  tone: string | null;
  status: string;
  requiresApproval: boolean;
  riskTier: number;
  createdAt: string;
  sentAt: string | null;
}

export interface ConsentResult {
  canContact: boolean;
  canRecordCall: boolean;
  canSendMarketing: boolean;
  channel: string;
  status: string;
  evidence?: string;
  grantedAt?: string;
  revokedAt?: string;
}

export interface TriggerItem {
  id: string;
  name: string;
  channel: string | null;
  eventType: string;
  enabled: boolean;
  isSystem: boolean;
  createdAt: string;
}

export interface UnifiedInbox {
  threads: { items: unknown[]; total: number };
  drafts: { items: DraftItem[]; total: number };
  intents: { items: IntentItem[]; total: number };
}

// ─── Channel Accounts ───

export async function fetchChannelAccounts(businessId: string) {
  return apiGet<{ items: unknown[] }>(`/api/communications/businesses/${businessId}/channel-accounts`);
}

// ─── Intents ───

export async function fetchIntents(
  businessId: string,
  params?: { status?: string; intentType?: string; limit?: number; offset?: number },
) {
  const search = new URLSearchParams();
  if (params?.status) search.set("status", params.status);
  if (params?.intentType) search.set("intentType", params.intentType);
  if (params?.limit) search.set("limit", String(params.limit));
  if (params?.offset) search.set("offset", String(params.offset));
  return apiGet<{ items: IntentItem[]; total: number }>(
    `/api/communications/businesses/${businessId}/intents?${search.toString()}`,
  );
}

export async function scoreIntent(businessId: string, intentId: string) {
  return apiPost<unknown>({
    path: `/api/communications/businesses/${businessId}/intents/${intentId}/score`,
    body: {},
  });
}

// ─── Drafts ───

export async function fetchDrafts(
  businessId: string,
  params?: { status?: string; channel?: string; riskTier?: string; limit?: number; offset?: number },
) {
  const search = new URLSearchParams();
  if (params?.status) search.set("status", params.status);
  if (params?.channel) search.set("channel", params.channel);
  if (params?.riskTier) search.set("riskTier", params.riskTier);
  if (params?.limit) search.set("limit", String(params.limit));
  if (params?.offset) search.set("offset", String(params.offset));
  return apiGet<{ items: DraftItem[]; total: number }>(
    `/api/communications/businesses/${businessId}/drafts?${search.toString()}`,
  );
}

export async function approveDraft(businessId: string, draftId: string) {
  return apiPost<DraftItem>({
    path: `/api/communications/businesses/${businessId}/drafts/${draftId}/approve`,
    body: {},
  });
}

export async function rejectDraft(businessId: string, draftId: string, reason: string) {
  return apiPost<DraftItem>({
    path: `/api/communications/businesses/${businessId}/drafts/${draftId}/reject`,
    body: { reason },
  });
}

export async function markDraftSent(businessId: string, draftId: string) {
  return apiPost<DraftItem>({
    path: `/api/communications/businesses/${businessId}/drafts/${draftId}/sent`,
    body: {},
  });
}

export async function sendDraft(businessId: string, draftId: string) {
  return apiPost<DraftItem>({
    path: `/api/communications/businesses/${businessId}/drafts/${draftId}/send`,
    body: {},
  });
}

// ─── Consent ───

export async function checkConsent(
  businessId: string,
  contactId: string,
  channel: string,
  type?: string,
) {
  const search = new URLSearchParams();
  search.set("channel", channel);
  if (type) search.set("type", type);
  return apiGet<ConsentResult>(
    `/api/communications/businesses/${businessId}/consent/${contactId}?${search.toString()}`,
  );
}

export async function recordConsent(
  businessId: string,
  body: {
    contactId: string;
    channel: string;
    consentType: string;
    status: string;
    source: string;
    evidence?: string;
  },
) {
  return apiPost<unknown>({
    path: `/api/communications/businesses/${businessId}/consent`,
    body,
  });
}

// ─── Triggers ───

export async function fetchTriggers(
  businessId: string,
  params?: { enabled?: boolean; channel?: string },
) {
  const search = new URLSearchParams();
  if (params?.enabled !== undefined) search.set("enabled", String(params.enabled));
  if (params?.channel) search.set("channel", params.channel);
  return apiGet<TriggerItem[]>(
    `/api/communications/businesses/${businessId}/triggers?${search.toString()}`,
  );
}

export async function createTrigger(
  businessId: string,
  body: { channel: string; eventType: string; name: string; condition: Record<string, unknown>; actions: Record<string, unknown>[]; enabled?: boolean },
) {
  return apiPost<TriggerItem>({
    path: `/api/communications/businesses/${businessId}/triggers`,
    body,
  });
}

export async function toggleTrigger(triggerId: string, enabled: boolean) {
  return apiPatch<TriggerItem>(
    `/api/communications/triggers/${triggerId}/toggle`,
    { enabled },
  );
}

export async function seedTriggers(businessId: string) {
  return apiPost<{ ok: boolean }>({
    path: `/api/communications/businesses/${businessId}/triggers/seed`,
    body: {},
  });
}

// ─── Unified Inbox ───

export async function fetchUnifiedInbox(
  businessId: string,
  params?: { limit?: number; offset?: number },
) {
  const search = new URLSearchParams();
  if (params?.limit) search.set("limit", String(params.limit));
  if (params?.offset) search.set("offset", String(params.offset));
  return apiGet<UnifiedInbox>(
    `/api/communications/businesses/${businessId}/unified-inbox?${search.toString()}`,
  );
}
