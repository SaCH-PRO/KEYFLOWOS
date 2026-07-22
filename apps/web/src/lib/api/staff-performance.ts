import { apiGet, apiPost } from "@/lib/api";

export interface Scorecard {
  assignmentId: string;
  staffName: string;
  periodStart: string;
  periodEnd: string;
  tasksAssigned: number;
  tasksCompleted: number;
  tasksOnTime: number;
  tasksOverdueOpen: number;
  hoursWorked: number;
  expectedHours: number;
  utilizationPct: number;
  approvalsHandled: number;
  avgApprovalResponseHours: number | null;
  overallScore: number;
}

export interface TrendPoint {
  periodStart: string;
  periodEnd: string;
  overallScore: number;
  tasksOnTime: number;
  tasksAssigned: number;
  hoursWorked: number;
  utilizationPct: number;
}

export interface PeriodFilter {
  periodStart?: string;
  periodEnd?: string;
}

function periodQuery(period?: PeriodFilter): string {
  const params = new URLSearchParams();
  if (period?.periodStart) params.set("periodStart", period.periodStart);
  if (period?.periodEnd) params.set("periodEnd", period.periodEnd);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export async function teamSummary(
  businessId: string,
  period?: PeriodFilter,
): Promise<{ data: Scorecard[] | null; error: string | null }> {
  return apiGet<Scorecard[]>(
    `/staff-performance/businesses/${encodeURIComponent(businessId)}/team-summary${periodQuery(period)}`,
  );
}

export async function scorecard(
  businessId: string,
  assignmentId: string,
  period?: PeriodFilter,
): Promise<{ data: Scorecard | null; error: string | null }> {
  const params = new URLSearchParams({ assignmentId });
  if (period?.periodStart) params.set("periodStart", period.periodStart);
  if (period?.periodEnd) params.set("periodEnd", period.periodEnd);
  return apiGet<Scorecard>(
    `/staff-performance/businesses/${encodeURIComponent(businessId)}/scorecard?${params.toString()}`,
  );
}

export async function trend(
  businessId: string,
  assignmentId: string,
  limit?: number,
): Promise<{ data: TrendPoint[] | null; error: string | null }> {
  const params = new URLSearchParams({ assignmentId });
  if (limit !== undefined) params.set("limit", String(limit));
  return apiGet<TrendPoint[]>(
    `/staff-performance/businesses/${encodeURIComponent(businessId)}/trend?${params.toString()}`,
  );
}

export async function takeSnapshot(
  businessId: string,
  input: { assignmentId: string; periodStart: string; periodEnd: string },
): Promise<{ data: unknown | null; error: string | null }> {
  return apiPost<unknown>({
    path: `/staff-performance/businesses/${encodeURIComponent(businessId)}/snapshot`,
    body: input,
  });
}
