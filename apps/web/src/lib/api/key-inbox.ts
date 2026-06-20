import { apiGet, apiPost, apiPatch } from "@/lib/api";

export interface KeyInboxSuggestedAction {
  type: string;
  label: string;
  confidence: number;
  payload?: Record<string, unknown>;
}

export interface KeyInboxMessage {
  id: string;
  businessId: string;
  threadId: string;
  channel: string;
  direction: "INBOUND" | "OUTBOUND";
  senderName?: string | null;
  senderHandle?: string | null;
  senderEmail?: string | null;
  senderPhone?: string | null;
  contentText?: string | null;
  contentHtml?: string | null;
  attachments: Array<{ type: string; url: string }>;
  externalMessageId?: string | null;
  receivedAt?: string | null;
  sentAt?: string | null;
  aiAnalysis?: Record<string, unknown> | null;
  extractedEntities?: Record<string, unknown> | null;
  suggestedActions: KeyInboxSuggestedAction[];
  aiConfidence?: number | null;
  sendStatus?: "DRAFT" | "QUEUED" | "SENT" | "FAILED" | "NOT_SUPPORTED" | null;
  providerMessageId?: string | null;
  sendError?: string | null;
  sentByUserId?: string | null;
  sentVia?: string | null;
  createdAt: string;
}

export interface KeyInboxThread {
  id: string;
  businessId: string;
  channel: string;
  externalThreadId?: string | null;
  contactId?: string | null;
  subject?: string | null;
  status: "OPEN" | "WAITING" | "DONE" | "ARCHIVED";
  priority: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  lastMessageAt?: string | null;
  lastInboundAt?: string | null;
  lastOutboundAt?: string | null;
  aiSummary?: string | null;
  aiIntent?: string | null;
  aiSentiment?: string | null;
  aiUrgency?: string | null;
  aiTags: string[];
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  messages?: KeyInboxMessage[];
}

export interface KeyInboxInsight {
  id: string;
  businessId: string;
  scope: "DAILY" | "WEEKLY" | "MONTHLY" | "CUSTOM";
  periodStart: string;
  periodEnd: string;
  summary: string;
  keyFindings: string[];
  recommendations: string[];
  taskSuggestions: string[];
  metrics: Record<string, number>;
  createdAt: string;
}

export interface MetricTrend {
  current: number;
  previous: number;
  delta: number;
  deltaPercent: number | null;
  direction: "up" | "down" | "flat";
}

export interface KeyInboxIntelligenceInsight {
  type: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  title: string;
  description: string;
  evidence: string[];
  relatedThreadIds?: string[];
  relatedMessageIds?: string[];
  suggestedAction?: {
    type: string;
    label: string;
    payload?: Record<string, unknown>;
  };
}

export interface GenomeSignalPreview {
  signalType: string;
  section: string;
  domain: string;
  title: string;
  reason: string;
  confidence: number;
  evidence: Array<{
    threadId?: string;
    messageId?: string;
    channel?: string;
    excerpt?: string;
  }>;
}

export interface KeyInboxIntelligenceReport extends KeyInboxInsight {
  executiveSummary: string;
  trends: Record<string, MetricTrend>;
  insights: KeyInboxIntelligenceInsight[];
  genomeSignals: GenomeSignalPreview[];
  channelBreakdown: Record<string, number>;
  generatedBy?: string;
  reportVersion: number;
}

export interface ThreadFilters {
  channel?: string;
  status?: string;
  priority?: string;
  intent?: string;
  urgency?: string;
  sentiment?: string;
  sendStatus?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface ActionExecutionResult {
  type: string;
  success: boolean;
  message: string;
  redirectUrl?: string;
  entityId?: string;
  entityType?: string;
}

function buildQueryString(filters?: ThreadFilters): string {
  const params = new URLSearchParams();
  if (!filters) return "";
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null && value !== "") {
      params.set(key, String(value));
    }
  }
  return params.toString() ? `?${params.toString()}` : "";
}

export async function fetchThreads(
  businessId: string,
  filters?: ThreadFilters,
): Promise<{ data: KeyInboxThread[] | null; error: string | null }> {
  return apiGet<KeyInboxThread[]>(
    `/key-inbox/businesses/${encodeURIComponent(businessId)}/threads${buildQueryString(filters)}`,
  );
}

export async function fetchThread(
  businessId: string,
  threadId: string,
): Promise<{ data: KeyInboxThread | null; error: string | null }> {
  return apiGet<KeyInboxThread>(
    `/key-inbox/businesses/${encodeURIComponent(businessId)}/threads/${encodeURIComponent(threadId)}`,
  );
}

export async function updateThread(
  businessId: string,
  threadId: string,
  patch: { subject?: string; status?: string; priority?: string },
): Promise<{ data: KeyInboxThread | null; error: string | null }> {
  return apiPatch<KeyInboxThread>(
    `/key-inbox/businesses/${encodeURIComponent(businessId)}/threads/${encodeURIComponent(threadId)}`,
    patch,
  );
}

export async function replyToThread(
  businessId: string,
  threadId: string,
  contentText: string,
  mode: "draft" | "send" = "draft",
): Promise<{ data: { thread: KeyInboxThread; message: KeyInboxMessage; sendResult?: { success: boolean; status: string; error?: string } } | null; error: string | null }> {
  return apiPost<{ thread: KeyInboxThread; message: KeyInboxMessage; sendResult?: { success: boolean; status: string; error?: string } }>({
    path: `/key-inbox/businesses/${encodeURIComponent(businessId)}/threads/${encodeURIComponent(threadId)}/reply`,
    body: { contentText, mode },
  });
}

export async function analyzeThread(
  businessId: string,
  threadId: string,
): Promise<{ data: KeyInboxThread | null; error: string | null }> {
  return apiPost<KeyInboxThread>({
    path: `/key-inbox/businesses/${encodeURIComponent(businessId)}/threads/${encodeURIComponent(threadId)}/analyze`,
    body: {},
  });
}

export async function executeThreadAction(
  businessId: string,
  threadId: string,
  actionIndex: number,
  messageId?: string,
  payloadOverride?: Record<string, unknown>,
): Promise<{ data: ActionExecutionResult | null; error: string | null }> {
  return apiPost<ActionExecutionResult>({
    path: `/key-inbox/businesses/${encodeURIComponent(businessId)}/threads/${encodeURIComponent(threadId)}/actions/${actionIndex}/execute`,
    body: { messageId, confirmed: true, payloadOverride },
  });
}

export async function fetchThreadTimeline(
  businessId: string,
  threadId: string,
): Promise<{ data: Array<Record<string, unknown>> | null; error: string | null }> {
  return apiGet<Array<Record<string, unknown>>>(
    `/key-inbox/businesses/${encodeURIComponent(businessId)}/threads/${encodeURIComponent(threadId)}/timeline`,
  );
}

export async function fetchBrief(
  businessId: string,
  scope: "DAILY" | "WEEKLY" | "CUSTOM" = "DAILY",
  start?: string,
  end?: string,
): Promise<{ data: KeyInboxInsight | null; error: string | null }> {
  const params = new URLSearchParams();
  params.set("scope", scope);
  if (start) params.set("start", start);
  if (end) params.set("end", end);
  return apiGet<KeyInboxInsight>(
    `/key-inbox/businesses/${encodeURIComponent(businessId)}/brief?${params.toString()}`,
  );
}

export async function generateBrief(
  businessId: string,
  scope: "DAILY" | "WEEKLY" | "CUSTOM" = "DAILY",
  start?: string,
  end?: string,
): Promise<{ data: KeyInboxInsight | null; error: string | null }> {
  return apiPost<KeyInboxInsight>({
    path: `/key-inbox/businesses/${encodeURIComponent(businessId)}/brief/generate`,
    body: { scope, start, end },
  });
}

export type IntelligenceScope = "DAILY" | "WEEKLY" | "MONTHLY" | "CUSTOM";

export async function generateInboxIntelligence(
  businessId: string,
  scope: IntelligenceScope,
  start?: string,
  end?: string,
): Promise<{ data: KeyInboxIntelligenceReport | null; error: string | null }> {
  return apiPost<KeyInboxIntelligenceReport>({
    path: `/key-inbox/businesses/${encodeURIComponent(businessId)}/intelligence/generate`,
    body: { scope, start, end },
  });
}

export async function fetchLatestInboxIntelligence(
  businessId: string,
  scope: IntelligenceScope = "WEEKLY",
): Promise<{ data: KeyInboxIntelligenceReport | null; error: string | null }> {
  return apiGet<KeyInboxIntelligenceReport>(
    `/key-inbox/businesses/${encodeURIComponent(businessId)}/intelligence/latest?scope=${encodeURIComponent(scope)}`,
  );
}

export async function fetchInboxIntelligenceReports(
  businessId: string,
  scope?: IntelligenceScope,
  limit?: number,
): Promise<{ data: KeyInboxIntelligenceReport[] | null; error: string | null }> {
  const params = new URLSearchParams();
  if (scope) params.set("scope", scope);
  if (limit !== undefined) params.set("limit", String(limit));
  return apiGet<KeyInboxIntelligenceReport[]>(
    `/key-inbox/businesses/${encodeURIComponent(businessId)}/intelligence?${params.toString()}`,
  );
}

export async function fetchInboxIntelligenceReport(
  businessId: string,
  insightId: string,
): Promise<{ data: KeyInboxIntelligenceReport | null; error: string | null }> {
  return apiGet<KeyInboxIntelligenceReport>(
    `/key-inbox/businesses/${encodeURIComponent(businessId)}/intelligence/${encodeURIComponent(insightId)}`,
  );
}

// Legacy ingestion-item exports removed; they are no longer used by the KEYInbox backend.
