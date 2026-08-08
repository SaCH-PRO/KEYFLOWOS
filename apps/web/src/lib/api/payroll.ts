import { apiGet, apiPost } from "@/lib/api";

export interface PayRate {
  id: string;
  assignmentId: string;
  staffName: string;
  amount: number;
  currency: string;
  periodType: "hourly" | "monthly" | string;
  effectiveFrom: string;
}

export interface PayrollRunListItem {
  id: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  totalGross: number;
  currency: string;
  itemCount: number;
}

export interface PayrollRunItem {
  id: string;
  assignmentId: string;
  staffName: string;
  hoursWorked: number | null;
  grossPay: number;
  currency: string;
  notes?: string | null;
}

export interface PayrollRun extends PayrollRunListItem {
  businessId: string;
  notes?: string | null;
  approvedAt?: string | null;
  approvedById?: string | null;
  paidAt?: string | null;
  createdAt: string;
  updatedAt: string;
  items: PayrollRunItem[];
}

export async function listRates(
  businessId: string,
): Promise<{ data: PayRate[] | null; error: string | null }> {
  return apiGet<PayRate[]>(`/payroll/businesses/${encodeURIComponent(businessId)}/rates`);
}

export async function listRuns(
  businessId: string,
  filters?: { status?: string; limit?: number },
): Promise<{ data: PayrollRunListItem[] | null; error: string | null }> {
  const params = new URLSearchParams();
  if (filters?.status) params.set("status", filters.status);
  if (filters?.limit !== undefined) params.set("limit", String(filters.limit));
  const qs = params.toString();
  return apiGet<PayrollRunListItem[]>(
    `/payroll/businesses/${encodeURIComponent(businessId)}/runs${qs ? `?${qs}` : ""}`,
  );
}

export async function getRun(
  businessId: string,
  runId: string,
): Promise<{ data: PayrollRun | null; error: string | null }> {
  return apiGet<PayrollRun>(
    `/payroll/businesses/${encodeURIComponent(businessId)}/runs/${encodeURIComponent(runId)}`,
  );
}

export async function approveRun(
  businessId: string,
  runId: string,
): Promise<{ data: PayrollRun | null; error: string | null }> {
  return apiPost<PayrollRun>({
    path: `/payroll/businesses/${encodeURIComponent(businessId)}/runs/${encodeURIComponent(runId)}/approve`,
    body: {},
  });
}

export async function markRunPaid(
  businessId: string,
  runId: string,
): Promise<{ data: PayrollRun | null; error: string | null }> {
  return apiPost<PayrollRun>({
    path: `/payroll/businesses/${encodeURIComponent(businessId)}/runs/${encodeURIComponent(runId)}/mark-paid`,
    body: {},
  });
}
