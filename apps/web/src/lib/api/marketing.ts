import { apiGet, apiPost, apiPatch, apiDelete } from "../api";

export interface CampaignPlan {
  id: string;
  name: string;
  goal: string;
  audience: string | null;
  offer: string | null;
  channel: string | null;
  status: string;
  budget: number | null;
  expectedRevenue: number | null;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function fetchCampaignPlans(businessId: string) {
  return apiGet<CampaignPlan[]>(`/marketing/businesses/${businessId}/campaigns`);
}

export async function createCampaignPlan(businessId: string, body: { name: string; goal?: string; audience?: string; offer?: string; channel?: string; budget?: number; expectedRevenue?: number; startsAt?: string; endsAt?: string }) {
  return apiPost<CampaignPlan>({ path: `/marketing/businesses/${businessId}/campaigns`, body });
}

export async function updateCampaignPlan(businessId: string, id: string, body: Partial<{ name: string; goal: string; audience: string; offer: string; channel: string; status: string; budget: number; expectedRevenue: number; startsAt: string; endsAt: string }>) {
  return apiPatch<CampaignPlan>(`/marketing/businesses/${businessId}/campaigns/${id}`, body);
}

export async function deleteCampaignPlan(businessId: string, id: string) {
  return apiDelete<void>(`/marketing/businesses/${businessId}/campaigns/${id}`);
}
