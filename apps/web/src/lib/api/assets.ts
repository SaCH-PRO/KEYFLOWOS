import { apiGet as apiGetSimple, apiPostSimple, apiPatch, apiDelete } from "../api";

export interface Asset {
  id: string;
  businessId: string;
  name: string;
  type: string;
  url: string;
  storageKey: string;
  mimeType?: string | null;
  sizeBytes?: number | null;
  tags: string[];
  folder: string;
  permissions: string;
  uploadedBy: string;
  usageCount: number;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export async function fetchAssets(
  businessId: string,
  opts?: { type?: string; folder?: string; tag?: string; search?: string }
) {
  const params = new URLSearchParams();
  if (opts?.type) params.set("type", opts.type);
  if (opts?.folder) params.set("folder", opts.folder);
  if (opts?.tag) params.set("tag", opts.tag);
  if (opts?.search) params.set("search", opts.search);
  return apiGetSimple<{ items: Asset[]; total: number; offset: number; limit: number }>(
    `/businesses/${encodeURIComponent(businessId)}/assets?${params.toString()}`
  );
}

export async function fetchAssetFolders(businessId: string) {
  return apiGetSimple<string[]>(
    `/businesses/${encodeURIComponent(businessId)}/assets/folders/list`
  );
}

export async function fetchAsset(businessId: string, assetId: string) {
  return apiGetSimple<Asset>(`/businesses/${encodeURIComponent(businessId)}/assets/${encodeURIComponent(assetId)}`);
}

export async function updateAsset(
  businessId: string,
  assetId: string,
  data: { name?: string; folder?: string; permissions?: string; tags?: string[]; type?: string }
) {
  return apiPatch<Asset>(`/businesses/${encodeURIComponent(businessId)}/assets/${encodeURIComponent(assetId)}`, data);
}

export async function tagAsset(businessId: string, assetId: string, tag: string) {
  return apiPostSimple<Asset>(`/businesses/${encodeURIComponent(businessId)}/assets/${encodeURIComponent(assetId)}/tag`, { tags: [tag] });
}

export async function untagAsset(businessId: string, assetId: string, tag: string) {
  return apiPostSimple<Asset>(`/businesses/${encodeURIComponent(businessId)}/assets/${encodeURIComponent(assetId)}/untag`, { tags: [tag] });
}

export async function trackAssetUsage(
  businessId: string,
  assetId: string,
  data: { usedInType: string; usedInId: string }
) {
  return apiPostSimple<Asset>(`/businesses/${encodeURIComponent(businessId)}/assets/${encodeURIComponent(assetId)}/track-usage`, data);
}

export async function deleteAsset(businessId: string, assetId: string) {
  return apiDelete<Asset>(`/businesses/${encodeURIComponent(businessId)}/assets/${encodeURIComponent(assetId)}`);
}

export async function fetchAssetById(businessId: string, assetId: string) {
  return fetchAsset(businessId, assetId);
}

export async function createAsset(
  businessId: string,
  data: {
    name: string;
    type: string;
    url: string;
    storageKey: string;
    mimeType?: string;
    sizeBytes?: number;
    folder?: string;
    tags?: string[];
  }
) {
  return apiPostSimple<Asset>(
    `/businesses/${encodeURIComponent(businessId)}/assets`,
    data
  );
}

// ─── Evidence ────────────────────────────────────────────────────────────────

