import { apiGet, apiPost, apiPatch, apiDelete } from "./api";

export interface PortalAccess {
  id: string;
  contactId: string;
  token: string;
  expiresAt: string;
  enabled: boolean;
  settings: Record<string, boolean>;
  lastAccessedAt: string | null;
  accessCount: number;
  createdAt: string;
}

export async function listPortalAccess(businessId: string) {
  return apiGet<PortalAccess[]>(`/portal/businesses/${businessId}/access`);
}

export async function createPortalAccess(businessId: string, contactId: string, settings?: Record<string, boolean>) {
  return apiPost<PortalAccess>({ path: `/portal/businesses/${businessId}/access`, body: { contactId, settings } });
}

export async function updatePortalSettings(businessId: string, id: string, settings: Record<string, boolean>) {
  return apiPatch<PortalAccess>(`/portal/businesses/${businessId}/access/${id}`, { settings });
}

export async function revokePortalAccess(businessId: string, id: string) {
  return apiDelete<PortalAccess>(`/portal/businesses/${businessId}/access/${id}`);
}
