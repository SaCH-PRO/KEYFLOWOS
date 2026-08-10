import { apiGet, apiPost, apiPatch, apiDelete } from "../api";

export interface CommandItem {
  id: string;
  businessId: string;
  sourceModule: string;
  sourceType: string | null;
  sourceId: string | null;
  title: string;
  description: string | null;
  category: string;
  actionType: string;
  status: string;
  priority: number;
  urgency: number;
  impactScore: number;
  expectedValue: string | null;
  currency: string | null;
  riskTier: number;
  requiresApproval: boolean;
  executableByKey: boolean;
  executionTool: string | null;
  executionPayload: Record<string, unknown> | null;
  recommendedBy: string | null;
  ownerType: string | null;
  ownerId: string | null;
  dueAt: string | null;
  snoozedUntil: string | null;
  completedAt: string | null;
  dismissedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CommandItemListResponse {
  items: CommandItem[];
  total: number;
}

/**
 * An obligation is a CommandItem the business OWES someone by a date, as
 * opposed to a SUGGESTION, which is something KEY thinks would be a good idea.
 * Same table, same screen, same verbs — separated by `kind` so that "what do I
 * owe this week" is never padded with advice.
 */
export interface DueObligation extends CommandItem {
  kind: string;
  owedToType: string | null;
  owedToId: string | null;
  owedToLabel: string | null;
  seriesId: string | null;
  dischargedAt: string | null;
  dischargeRef: string | null;
  /** Computed server-side against `now`, not stored — there is no sweep flipping rows. */
  overdue: boolean;
  daysUntilDue: number | null;
}

export interface DueObligationsResponse {
  window: { from: string; to: string; days: number };
  total: number;
  overdueCount: number;
  items: DueObligation[];
}

export interface CommandSummary {
  open: number;
  waitingApproval: number;
  executableByKey: number;
  byCategory: Array<{ category: string; count: number }>;
}

export async function fetchCommandItems(
  businessId: string,
  filters?: { status?: string; category?: string; sourceModule?: string; ownerId?: string; ownerType?: string; limit?: number; offset?: number }
): Promise<{ data: CommandItemListResponse | null; error: string | null }> {
  const params = new URLSearchParams();
  if (filters?.status) params.set("status", filters.status);
  if (filters?.category) params.set("category", filters.category);
  if (filters?.sourceModule) params.set("sourceModule", filters.sourceModule);
  if (filters?.ownerId) params.set("ownerId", filters.ownerId);
  if (filters?.ownerType) params.set("ownerType", filters.ownerType);
  if (filters?.limit) params.set("limit", String(filters.limit));
  if (filters?.offset) params.set("offset", String(filters.offset));
  const query = params.toString() ? `?${params.toString()}` : "";
  return apiGet<CommandItemListResponse>(`/command/businesses/${businessId}/items${query}`);
}

/**
 * What the business owes, and by when.
 *
 * Ordered by due date, oldest first — `fetchCommandItems` sorts by
 * priority/urgency because it answers "what should I look at", and this answers
 * a question about time. Overdue rows are included by default: a due list that
 * hides what was due last week is worse than useless, because those are the
 * ones that cost money.
 */
export async function fetchDueObligations(
  businessId: string,
  filters?: { windowDays?: number; includeOverdue?: boolean; limit?: number },
): Promise<{ data: DueObligationsResponse | null; error: string | null }> {
  const params = new URLSearchParams();
  if (filters?.windowDays !== undefined) params.set("windowDays", String(filters.windowDays));
  if (filters?.includeOverdue !== undefined) {
    params.set("includeOverdue", String(filters.includeOverdue));
  }
  if (filters?.limit !== undefined) params.set("limit", String(filters.limit));
  const query = params.toString() ? `?${params.toString()}` : "";
  return apiGet<DueObligationsResponse>(
    `/command/businesses/${businessId}/items/due${query}`,
  );
}

/**
 * Record that an obligation was met. The manual equivalent of KEY's
 * `command_discharge_obligation` — anything KEY can do, a person must be able
 * to do from a screen.
 */
export async function dischargeObligation(
  businessId: string,
  id: string,
  dischargeRef?: string,
) {
  return apiPost<CommandItem>({
    path: `/command/businesses/${businessId}/items/${id}/discharge`,
    body: { dischargeRef: dischargeRef ?? "manual" },
  });
}

export async function fetchCommandItem(businessId: string, id: string) {
  return apiGet<CommandItem>(`/command/businesses/${businessId}/items/${id}`);
}

export async function createCommandItem(businessId: string, body: Partial<CommandItem>) {
  return apiPost<CommandItem>({ path: `/command/businesses/${businessId}/items`, body });
}

export async function updateCommandItem(businessId: string, id: string, body: Partial<CommandItem>) {
  return apiPatch<CommandItem>(`/command/businesses/${businessId}/items/${id}`, body);
}

export async function dismissCommandItem(businessId: string, id: string) {
  return apiPost<CommandItem>({ path: `/command/businesses/${businessId}/items/${id}/dismiss`, body: {} });
}

export async function snoozeCommandItem(businessId: string, id: string, until: string) {
  return apiPost<CommandItem>({ path: `/command/businesses/${businessId}/items/${id}/snooze`, body: { until } });
}

export async function approveCommandItem(businessId: string, id: string) {
  return apiPost<CommandItem>({ path: `/command/businesses/${businessId}/items/${id}/approve`, body: {} });
}

export async function executeCommandItem(businessId: string, id: string, result?: Record<string, unknown>) {
  return apiPost<CommandItem>({ path: `/command/businesses/${businessId}/items/${id}/execute`, body: { result } });
}

export async function completeCommandItem(businessId: string, id: string) {
  return apiPost<CommandItem>({ path: `/command/businesses/${businessId}/items/${id}/complete`, body: {} });
}

export async function assignCommandItem(businessId: string, id: string, ownerType: string, ownerId: string) {
  return apiPost<CommandItem>({ path: `/command/businesses/${businessId}/items/${id}/assign`, body: { ownerType, ownerId } });
}

export async function reopenCommandItem(businessId: string, id: string) {
  return apiPost<CommandItem>({ path: `/command/businesses/${businessId}/items/${id}/reopen`, body: {} });
}

export async function deleteCommandItem(businessId: string, id: string) {
  return apiDelete<CommandItem>(`/command/businesses/${businessId}/items/${id}`);
}

export async function generateCommandItems(businessId: string) {
  return apiPost<{ created: number; skipped: number; total: number }>({
    path: `/command/businesses/${businessId}/generate`,
    body: {},
  });
}

export async function fetchCommandSummary(businessId: string) {
  return apiGet<CommandSummary>(`/command/businesses/${businessId}/summary`);
}

export async function fetchLastScan(businessId: string) {
  return apiGet<{ lastScan: string | null; shouldAutoScan: boolean }>(`/command/businesses/${businessId}/last-scan`);
}

export async function autoScanCommandItems(businessId: string) {
  return apiPost<{ scanned: boolean; reason?: string; result?: { created: number; skipped: number; total: number } }>({
    path: `/command/businesses/${businessId}/auto-scan`,
    body: {},
  });
}

export async function bulkCompleteCommands(businessId: string, ids: string[]) {
  return apiPost<{ count: number }>({
    path: `/command/businesses/${businessId}/items/bulk/complete`,
    body: { ids },
  });
}

export async function bulkDismissCommands(businessId: string, ids: string[]) {
  return apiPost<{ count: number }>({
    path: `/command/businesses/${businessId}/items/bulk/dismiss`,
    body: { ids },
  });
}

export async function bulkDeleteCommands(businessId: string, ids: string[]) {
  return apiPost<{ count: number }>({
    path: `/command/businesses/${businessId}/items/bulk/delete`,
    body: { ids },
  });
}
