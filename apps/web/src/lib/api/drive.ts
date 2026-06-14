import { apiGet, apiPost } from "../api";

export interface DriveIntakeFile {
  id: string;
  driveFileId: string;
  name: string;
  mimeType: string;
  webViewLink: string | null;
  size: number | null;
  modifiedTime: string;
  status: "pending" | "extracted" | "reviewing" | "approved" | "rejected" | "error";
  confidence: number | null;
  documentType: string | null;
  extractedData: Record<string, unknown> | null;
  proposedActions: Record<string, unknown> | null;
  errorMessage: string | null;
  detectedAt: string;
  processedAt: string | null;
}

export async function syncGoogleDrive(businessId: string) {
  return apiPost<{ scanned: number; newFiles: number }>({
    path: `/drive/businesses/${encodeURIComponent(businessId)}/sync`,
    body: {},
  });
}

export async function fetchDriveIntake(businessId: string, status?: string, limit = 50) {
  const qs = new URLSearchParams();
  if (status) qs.set("status", status);
  qs.set("limit", String(limit));
  return apiGet<{ items: DriveIntakeFile[] }>(
    `/drive/businesses/${encodeURIComponent(businessId)}/intake?${qs.toString()}`
  );
}

export async function approveDriveIntake(businessId: string, intakeFileId: string) {
  return apiPost<{ success: boolean; results: Array<{ action: string; success: boolean; entityId?: string; error?: string }> }>({
    path: `/drive/businesses/${encodeURIComponent(businessId)}/intake/${encodeURIComponent(intakeFileId)}/approve`,
    body: {},
  });
}

export async function rejectDriveIntake(businessId: string, intakeFileId: string) {
  return apiPost<{ success: boolean }>({
    path: `/drive/businesses/${encodeURIComponent(businessId)}/intake/${encodeURIComponent(intakeFileId)}/reject`,
    body: {},
  });
}
