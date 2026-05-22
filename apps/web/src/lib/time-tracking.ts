import { apiGet, apiPost, apiPatch, apiDelete } from "./api";

export interface TimeEntry {
  id: string;
  description: string | null;
  startTime: string;
  endTime: string | null;
  durationMinutes: number | null;
  billable: boolean;
  billed: boolean;
  hourlyRate: number | null;
  projectId: string | null;
  project: { id: string; name: string; color: string | null } | null;
  taskId: string | null;
  task: { id: string; title: string } | null;
  invoice: { id: string; invoiceNumber: string; status: string } | null;
  createdAt: string;
}

export interface TimeSummary {
  totalEntries: number;
  totalMinutes: number;
  totalHours: number;
  billableMinutes: number;
  billableHours: number;
  billedMinutes: number;
  billedHours: number;
  unbilledMinutes: number;
  unbilledHours: number;
}

export async function startTimer(businessId: string, data: {
  description?: string;
  projectId?: string;
  taskId?: string;
  billable?: boolean;
  hourlyRate?: number;
}) {
  return apiPost<TimeEntry>({
    path: `/time-entries/businesses/${businessId}/start`,
    body: data,
  });
}

export async function stopTimer(businessId: string, entryId: string) {
  return apiPost<TimeEntry>({
    path: `/time-entries/businesses/${businessId}/stop/${entryId}`,
    body: {},
  });
}

export async function getRunningTimer(businessId: string) {
  return apiGet<TimeEntry | null>(`/time-entries/businesses/${businessId}/running`);
}

export async function createTimeEntry(businessId: string, data: {
  description?: string;
  startTime: string;
  endTime?: string;
  projectId?: string;
  taskId?: string;
  billable?: boolean;
  hourlyRate?: number;
}) {
  return apiPost<TimeEntry>({
    path: `/time-entries/businesses/${businessId}`,
    body: data,
  });
}

export async function listTimeEntries(businessId: string, params?: {
  projectId?: string;
  startDate?: string;
  endDate?: string;
  billable?: boolean;
  billed?: boolean;
}) {
  const qs = new URLSearchParams();
  if (params?.projectId) qs.set("projectId", params.projectId);
  if (params?.startDate) qs.set("startDate", params.startDate);
  if (params?.endDate) qs.set("endDate", params.endDate);
  if (params?.billable !== undefined) qs.set("billable", String(params.billable));
  if (params?.billed !== undefined) qs.set("billed", String(params.billed));
  const query = qs.toString();
  return apiGet<TimeEntry[]>(`/time-entries/businesses/${businessId}${query ? "?" + query : ""}`);
}

export async function getTimeSummary(businessId: string, params?: {
  projectId?: string;
  startDate?: string;
  endDate?: string;
}) {
  const qs = new URLSearchParams();
  if (params?.projectId) qs.set("projectId", params.projectId);
  if (params?.startDate) qs.set("startDate", params.startDate);
  if (params?.endDate) qs.set("endDate", params.endDate);
  const query = qs.toString();
  return apiGet<TimeSummary>(`/time-entries/businesses/${businessId}/summary${query ? "?" + query : ""}`);
}

export async function updateTimeEntry(businessId: string, entryId: string, data: {
  description?: string;
  startTime?: string;
  endTime?: string;
  durationMinutes?: number;
  projectId?: string | null;
  taskId?: string | null;
  billable?: boolean;
  hourlyRate?: number;
}) {
  return apiPatch<TimeEntry>(`/time-entries/businesses/${businessId}/${entryId}`, data);
}

export async function deleteTimeEntry(businessId: string, entryId: string) {
  return apiDelete<{ deleted: boolean }>(`/time-entries/businesses/${businessId}/${entryId}`);
}

export async function billTimeEntries(businessId: string, timeEntryIds: string[], invoiceId: string) {
  return apiPost<{ billed: number }>({
    path: `/time-entries/businesses/${businessId}/bill`,
    body: { timeEntryIds, invoiceId },
  });
}
