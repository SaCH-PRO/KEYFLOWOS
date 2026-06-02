import { apiGet, apiPost, apiPatch } from "@/lib/api";

export interface CaptureInput {
  objectPath: string;
  publicUrl?: string;
  fileName?: string;
  contentType: string;
  sizeBytes?: number;
  mediaType: "image" | "video" | "audio" | "document";
  source?: string;
  captureMode?: string;
  extractedText?: string;
  linkedEntityType?: string;
  linkedEntityId?: string;
  contactId?: string;
}

export interface CaptureResult {
  asset: {
    id: string;
    objectPath: string;
    publicUrl: string | null;
    fileName: string | null;
    mediaType: string;
    status: string;
    createdAt: string;
  };
  intake: {
    id: string;
    detectedType: string | null;
    summary: string | null;
    confidenceScore: number | null;
    status: string;
    recommendedActions: unknown[];
  } | null;
  classification: {
    detectedType: string;
    confidenceScore: number;
    summary: string;
    extractedData: Record<string, unknown>;
    recommendedActions: Record<string, unknown>[];
  } | null;
}

export async function createCapture(businessId: string, input: CaptureInput) {
  return apiPost<CaptureResult>({
    path: `/api/device/businesses/${businessId}/captures`,
    body: input,
  });
}

export async function listCaptures(
  businessId: string,
  params?: { mediaType?: string; status?: string; limit?: number; offset?: number },
) {
  const search = new URLSearchParams();
  if (params?.mediaType) search.set("mediaType", params.mediaType);
  if (params?.status) search.set("status", params.status);
  if (params?.limit) search.set("limit", String(params.limit));
  if (params?.offset) search.set("offset", String(params.offset));
  return apiGet<{ items: unknown[]; total: number }>(
    `/api/device/businesses/${businessId}/captures?${search.toString()}`,
  );
}

export async function getCapture(businessId: string, id: string) {
  return apiGet<CaptureResult>(`/api/device/businesses/${businessId}/captures/${id}`);
}

export async function createContactFromCard(
  businessId: string,
  input: {
    visualIntakeId: string;
    name?: string;
    phone?: string;
    email?: string;
    company?: string;
    title?: string;
    website?: string;
  },
) {
  return apiPost<unknown>({
    path: `/api/device/businesses/${businessId}/contacts-from-card`,
    body: input,
  });
}

export async function listVisualIntakes(
  businessId: string,
  params?: { detectedType?: string; status?: string; limit?: number; offset?: number },
) {
  const search = new URLSearchParams();
  if (params?.detectedType) search.set("detectedType", params.detectedType);
  if (params?.status) search.set("status", params.status);
  if (params?.limit) search.set("limit", String(params.limit));
  if (params?.offset) search.set("offset", String(params.offset));
  return apiGet<{ items: unknown[]; total: number }>(
    `/api/device/businesses/${businessId}/intakes?${search.toString()}`,
  );
}

export async function approveIntake(businessId: string, intakeId: string) {
  return apiPatch<unknown>(
    `/api/device/businesses/${businessId}/intakes/${intakeId}/approve`,
    {},
  );
}

export async function rejectIntake(businessId: string, intakeId: string) {
  return apiPatch<unknown>(
    `/api/device/businesses/${businessId}/intakes/${intakeId}/reject`,
    {},
  );
}
