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
  // V1-65 review COR-FO-1: a caller that passes a signal gets its own request, never one joined to an identical read
  // already in flight (lib/api coalesces unsignalled GETs), so a re-read after a change sees the change.
  opts?: { signal?: AbortSignal },
): Promise<{ data: PayrollRunListItem[] | null; error: string | null; status?: number }> {
  const params = new URLSearchParams();
  if (filters?.status) params.set("status", filters.status);
  if (filters?.limit !== undefined) params.set("limit", String(filters.limit));
  const qs = params.toString();
  return apiGet<PayrollRunListItem[]>(
    `/payroll/businesses/${encodeURIComponent(businessId)}/runs${qs ? `?${qs}` : ""}`,
    opts,
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
  input: { paymentAccountId?: string; paymentMethod?: string },
): Promise<{ data: PayrollRun | null; error: string | null }> {
  return apiPost<PayrollRun>({
    path: `/payroll/businesses/${encodeURIComponent(businessId)}/runs/${encodeURIComponent(runId)}/mark-paid`,
    body: input,
  });
}

/**
 * V1-65 (TOF-PAYROLL-DISCARD, D-144): discard a payroll run, so safe-to-spend stops reserving it.
 * POST /payroll/businesses/:b/runs/:r/discard needs operations write; the server records the signed-in member as the
 * actor and the reason (trimmed, at most 500 characters), and answers the run as VOID. It answers 409 for a PAID,
 * VOID or posted run, and for an APPROVED run in the business currency (only an unposted DRAFT run, or an unposted
 * DRAFT/APPROVED run in another currency, is discarded). The answer's `status` lets a screen say a refusal as one.
 */
export async function discardRun(
  businessId: string,
  runId: string,
  reason: string,
): Promise<{ data: PayrollRun | null; error: string | null; status?: number }> {
  return apiPost<PayrollRun>({
    path: `/payroll/businesses/${encodeURIComponent(businessId)}/runs/${encodeURIComponent(runId)}/discard`,
    body: { reason },
  });
}
