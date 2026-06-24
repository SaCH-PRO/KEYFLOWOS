import { apiGet as apiGetSimple, apiPostSimple } from "../api";

export interface Evidence {
  id: string;
  businessId: string;
  evidenceType: string;
  url: string;
  storageKey: string;
  checksum?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  submittedBy: string;
  submittedAt: string;
  verifiedBy?: string | null;
  verifiedAt?: string | null;
  linkedType: string;
  linkedId: string;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export async function fetchEvidence(
  businessId: string,
  opts?: { evidenceType?: string; linkedType?: string; linkedId?: string }
) {
  const params = new URLSearchParams();
  if (opts?.evidenceType) params.set("evidenceType", opts.evidenceType);
  if (opts?.linkedType) params.set("linkedType", opts.linkedType);
  if (opts?.linkedId) params.set("linkedId", opts.linkedId);
  return apiGetSimple<Evidence[]>(
    `/businesses/${encodeURIComponent(businessId)}/evidence?${params.toString()}`
  );
}

export async function fetchEvidenceItem(evidenceId: string) {
  return apiGetSimple<Evidence>(`/evidence/${encodeURIComponent(evidenceId)}`);
}

export async function fetchEvidenceById(_businessId: string, evidenceId: string) {
  return fetchEvidenceItem(evidenceId);
}

export async function submitEvidence(
  businessId: string,
  data: {
    evidenceType: string;
    linkedType: string;
    linkedId: string;
    url: string;
    storageKey: string;
    checksum?: string;
    mimeType?: string;
    sizeBytes?: number;
    metadata?: Record<string, unknown>;
  }
) {
  return apiPostSimple<Evidence>(
    `/businesses/${encodeURIComponent(businessId)}/evidence`,
    data
  );
}

export async function verifyEvidence(
  evidenceId: string,
  data: { verifierId: string }
) {
  return apiPostSimple<Evidence>(
    `/evidence/${encodeURIComponent(evidenceId)}/verify`,
    data
  );
}

export async function checkTaskEvidence(linkedType: string, linkedId: string) {
  return apiGetSimple<{ hasEvidence: boolean; evidence: Evidence[] }>(
    `/evidence/check?linkedType=${encodeURIComponent(linkedType)}&linkedId=${encodeURIComponent(linkedId)}`
  );
}

// ─── Call Tasks ──────────────────────────────────────────────────────────────

