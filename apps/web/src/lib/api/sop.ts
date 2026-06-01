import { apiGet, apiPost, apiPatch, apiDelete } from "../api";

export interface SopDocument {
  id: string;
  title: string;
  department: string;
  body: string;
  status: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export async function fetchSops(businessId: string) {
  return apiGet<SopDocument[]>(`/sop/businesses/${businessId}/sops`);
}

export async function createSop(businessId: string, body: { title: string; department?: string; body: string }) {
  return apiPost<SopDocument>({ path: `/sop/businesses/${businessId}/sops`, body });
}

export async function updateSop(businessId: string, id: string, body: Partial<{ title: string; department: string; body: string; status: string }>) {
  return apiPatch<SopDocument>(`/sop/businesses/${businessId}/sops/${id}`, body);
}

export async function deleteSop(businessId: string, id: string) {
  return apiDelete<void>(`/sop/businesses/${businessId}/sops/${id}`);
}
