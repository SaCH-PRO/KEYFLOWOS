import { apiGet, apiPost, apiPatch, apiDelete } from "./api";

export interface RetainerAgreement {
  id: string;
  contactId: string;
  name: string;
  monthlyAmount: number;
  startDate: string;
  endDate: string | null;
  includedHours: number | null;
  rolloverHours: boolean;
  rolloverCap: number | null;
  status: string;
  periods: RetainerPeriod[];
  createdAt: string;
}

export interface RetainerPeriod {
  id: string;
  periodStart: string;
  periodEnd: string;
  hoursUsed: number;
  hoursBilled: number;
  amountBilled: number;
  status: string;
  invoiceId: string | null;
}

export async function listRetainers(businessId: string) {
  return apiGet<RetainerAgreement[]>(`/retainers/businesses/${businessId}`);
}

export async function getRetainerSummary(businessId: string) {
  return apiGet<{ total: number; active: number; totalRevenue: number }>(`/retainers/businesses/${businessId}/summary`);
}

export async function createRetainer(businessId: string, body: {
  contactId: string;
  name: string;
  monthlyAmount: number;
  startDate: string;
  endDate?: string;
  includedHours?: number;
  rolloverHours?: boolean;
  rolloverCap?: number;
}) {
  return apiPost<RetainerAgreement>({ path: `/retainers/businesses/${businessId}`, body });
}

export async function updateRetainer(businessId: string, id: string, body: Partial<{
  name: string;
  monthlyAmount: number;
  startDate: string;
  endDate: string | null;
  includedHours: number | null;
  rolloverHours: boolean;
  rolloverCap: number | null;
  status: string;
}>) {
  return apiPatch<RetainerAgreement>(`/retainers/businesses/${businessId}/${id}`, body);
}

export async function deleteRetainer(businessId: string, id: string) {
  return apiDelete<{ deleted: boolean }>(`/retainers/businesses/${businessId}/${id}`);
}
