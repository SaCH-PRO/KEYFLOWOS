import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api";

export type BusinessAssetType =
  | "DOMAIN"
  | "WEBSITE"
  | "SOCIAL"
  | "BANK"
  | "PAYMENT_PROCESSOR"
  | "LICENSE"
  | "EQUIPMENT"
  | "CONTRACT"
  | "BRAND_ASSET"
  | "SOFTWARE";

export type BusinessAssetStatus = "ACTIVE" | "PENDING" | "EXPIRED" | "ARCHIVED";

export interface BusinessAsset {
  id: string;
  businessId: string;
  type: BusinessAssetType;
  name: string;
  status: BusinessAssetStatus;
  provider?: string;
  url?: string;
  identifier?: string;
  owner?: string;
  metadata?: Record<string, unknown>;
  verifiedAt?: string;
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BusinessAssetSummary {
  total: number;
  byType: Record<string, number>;
  risks: string[];
}

export interface CreateBusinessAssetInput {
  type: BusinessAssetType;
  name: string;
  status?: BusinessAssetStatus;
  provider?: string;
  url?: string;
  identifier?: string;
  owner?: string;
  expiresAt?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateBusinessAssetInput {
  type?: BusinessAssetType;
  name?: string;
  status?: BusinessAssetStatus;
  provider?: string;
  url?: string;
  identifier?: string;
  owner?: string;
  expiresAt?: string;
  metadata?: Record<string, unknown>;
}

export async function getBusinessAssets(businessId: string) {
  return apiGet<BusinessAsset[]>(`/businesses/${businessId}/business-assets`);
}

export async function getBusinessAssetSummary(businessId: string) {
  return apiGet<BusinessAssetSummary>(`/businesses/${businessId}/business-assets/summary`);
}

export async function createBusinessAsset(businessId: string, input: CreateBusinessAssetInput) {
  return apiPost<BusinessAsset>({
    path: `/businesses/${businessId}/business-assets`,
    body: input,
  });
}

export async function updateBusinessAsset(
  businessId: string,
  assetId: string,
  input: UpdateBusinessAssetInput,
) {
  return apiPatch<BusinessAsset>(`/businesses/${businessId}/business-assets/${assetId}`, input);
}

export async function deleteBusinessAsset(businessId: string, assetId: string) {
  return apiDelete<{ deleted: boolean }>(`/businesses/${businessId}/business-assets/${assetId}`);
}
