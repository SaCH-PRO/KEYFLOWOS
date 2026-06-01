import { apiGet, apiPost, apiPatch, apiDelete } from "../api";

export interface ReserveBucket {
  id: string;
  name: string;
  purpose: string;
  targetAmount: number | null;
  currentAmount: number;
  currency: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export async function fetchReserveBuckets(businessId: string) {
  return apiGet<ReserveBucket[]>(`/finance/businesses/${businessId}/reserves`);
}

export async function createReserveBucket(businessId: string, body: { name: string; purpose: string; targetAmount?: number; currentAmount?: number; currency?: string }) {
  return apiPost<ReserveBucket>({ path: `/finance/businesses/${businessId}/reserves`, body });
}

export async function updateReserveBucket(businessId: string, id: string, body: Partial<{ name: string; purpose: string; targetAmount: number; currentAmount: number; status: string }>) {
  return apiPatch<ReserveBucket>(`/finance/businesses/${businessId}/reserves/${id}`, body);
}

export async function deleteReserveBucket(businessId: string, id: string) {
  return apiDelete<void>(`/finance/businesses/${businessId}/reserves/${id}`);
}
