import { apiGet, apiPost, apiPatch, apiDelete } from "./api";

export interface ChangeOrder {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  originalScope: string | null;
  newScope: string | null;
  additionalAmount: number | null;
  additionalHours: number | null;
  status: string;
  approvedBy: string | null;
  approvedAt: string | null;
  invoiceId: string | null;
  createdAt: string;
}

export async function listChangeOrders(businessId: string) {
  return apiGet<ChangeOrder[]>(`/change-orders/businesses/${businessId}`);
}

export async function listProjectChangeOrders(businessId: string, projectId: string) {
  return apiGet<ChangeOrder[]>(`/change-orders/businesses/${businessId}/projects/${projectId}`);
}

export async function createChangeOrder(businessId: string, body: {
  projectId: string;
  title: string;
  description?: string;
  originalScope?: string;
  newScope?: string;
  additionalAmount?: number;
  additionalHours?: number;
}) {
  return apiPost<ChangeOrder>({ path: `/change-orders/businesses/${businessId}`, body });
}

export async function updateChangeOrder(businessId: string, id: string, body: Partial<{
  title: string;
  description: string;
  originalScope: string;
  newScope: string;
  additionalAmount: number;
  additionalHours: number;
  status: string;
  approvedBy: string;
  approvedAt: string;
  invoiceId: string;
}>) {
  return apiPatch<ChangeOrder>(`/change-orders/businesses/${businessId}/${id}`, body);
}

export async function deleteChangeOrder(businessId: string, id: string) {
  return apiDelete<{ deleted: boolean }>(`/change-orders/businesses/${businessId}/${id}`);
}
