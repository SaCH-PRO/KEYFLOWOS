import { apiGet, apiPost } from "../api";

export interface MessageIntakeItem {
  id: string;
  connectorType: string;
  sourceChannel: "whatsapp" | "email" | "sms" | "instagram" | "messenger";
  externalId: string | null;
  from: string;
  fromName: string | null;
  to: string | null;
  subject: string | null;
  body: string;
  status: "pending" | "extracted" | "reviewing" | "approved" | "rejected" | "error";
  confidence: number | null;
  intentType: string | null;
  extractedData: Record<string, unknown> | null;
  proposedActions: Record<string, unknown> | null;
  errorMessage: string | null;
  detectedAt: string;
  processedAt: string | null;
  contact: {
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    phone: string | null;
  } | null;
}

export async function fetchMessageIntake(
  businessId: string,
  filters: { status?: string; sourceChannel?: string; limit?: number } = {}
) {
  const qs = new URLSearchParams();
  if (filters.status) qs.set("status", filters.status);
  if (filters.sourceChannel) qs.set("sourceChannel", filters.sourceChannel);
  if (filters.limit) qs.set("limit", String(filters.limit));
  return apiGet<{ items: MessageIntakeItem[] }>(
    `/communications/businesses/${encodeURIComponent(businessId)}/message-intake?${qs.toString()}`
  );
}

export async function approveMessageIntake(businessId: string, intakeId: string) {
  return apiPost<{
    success: boolean;
    results: Array<{ action: string; success: boolean; entityId?: string; error?: string }>;
  }>({
    path: `/communications/businesses/${encodeURIComponent(businessId)}/message-intake/${encodeURIComponent(intakeId)}/approve`,
    body: {},
  });
}

export async function rejectMessageIntake(businessId: string, intakeId: string) {
  return apiPost<{ success: boolean }>({
    path: `/communications/businesses/${encodeURIComponent(businessId)}/message-intake/${encodeURIComponent(intakeId)}/reject`,
    body: {},
  });
}
