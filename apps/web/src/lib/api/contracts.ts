import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api";

export interface ContractParty {
  id: string;
  role: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  notes?: string | null;
  contactId?: string | null;
}

export interface ContractTerm {
  id: string;
  termKey: string;
  termValue: string;
  sourceText?: string | null;
  confidence: number;
  extractedAt: string;
}

export interface ContractVersion {
  id: string;
  versionNumber: number;
  changeSummary?: string | null;
  fileName?: string | null;
  fileUrl?: string | null;
  fileAssetId?: string | null;
  createdBy?: string | null;
  createdAt: string;
}

export interface ContractAlert {
  id: string;
  alertType: string;
  dueDate: string;
  acknowledgedAt?: string | null;
  acknowledgedBy?: string | null;
  createdAt: string;
}

export interface ContractTag {
  id: string;
  name: string;
  color?: string | null;
}

export interface ContractTagMapping {
  tag: ContractTag;
}

export interface Contract {
  id: string;
  businessId: string;
  title: string;
  contractType?: string | null;
  status: string;
  effectiveDate?: string | null;
  expiryDate?: string | null;
  renewalDate?: string | null;
  renewalType?: string | null;
  renewalNoticeDays?: number | null;
  contractValue?: number | null;
  currency?: string | null;
  jurisdiction?: string | null;
  retentionPolicy?: string | null;
  retentionUntil?: string | null;
  notes?: string | null;
  sourceAssetId?: string | null;
  sourceBusinessAssetId?: string | null;
  sourceDocumentInstanceId?: string | null;
  sourceDriveFileId?: string | null;
  parties: ContractParty[];
  terms: ContractTerm[];
  versions: ContractVersion[];
  alerts: ContractAlert[];
  tags: ContractTagMapping[];
  createdAt: string;
  updatedAt: string;
}

export interface ContractListItem extends Omit<Contract, "terms" | "versions" | "alerts"> {
  _count: { alerts: number; terms: number; versions: number };
}

export interface ContractListResponse {
  items: ContractListItem[];
  nextCursor?: string;
  total: number;
}

export interface ContractStats {
  total: number;
  byStatus: Record<string, number>;
  expiringSoon: number;
  renewalDue: number;
  expired: number;
  alertCount: number;
}

export interface ContractFilters {
  status?: string;
  search?: string;
  tagIds?: string[];
  expiringWithinDays?: number;
  sourceType?: "asset" | "business_asset" | "document_instance" | "drive";
  cursor?: string;
  limit?: number;
}

export interface CreateContractInput {
  title: string;
  contractType?: string;
  status?: string;
  effectiveDate?: string;
  expiryDate?: string;
  renewalDate?: string;
  renewalType?: string;
  renewalNoticeDays?: number;
  contractValue?: number;
  currency?: string;
  jurisdiction?: string;
  retentionPolicy?: string;
  retentionUntil?: string;
  notes?: string;
  sourceAssetId?: string;
  sourceBusinessAssetId?: string;
  sourceDocumentInstanceId?: string;
  sourceDriveFileId?: string;
  parties?: Array<{
    role: string;
    name: string;
    email?: string;
    phone?: string;
    address?: string;
    notes?: string;
    contactId?: string;
  }>;
  tagIds?: string[];
}

export type UpdateContractInput = Partial<CreateContractInput>;

/** A single party as accepted by create/update. Fields beyond role+name are optional. */
export type ContractPartyInput = NonNullable<CreateContractInput["parties"]>[number];

/** Source descriptor for {@link extractContractTerms}. */
export interface ExtractContractTermsInput {
  sourceAssetId?: string;
  sourceDocumentInstanceId?: string;
  sourceDriveFileId?: string;
  url?: string;
  base64Content?: string;
  filename?: string;
  mimeType?: string;
}

function buildQueryString(filters?: ContractFilters): string {
  const params = new URLSearchParams();
  if (!filters) return "";
  if (filters.status) params.set("status", filters.status);
  if (filters.search) params.set("search", filters.search);
  if (filters.tagIds?.length) params.set("tagIds", filters.tagIds.join(","));
  if (filters.expiringWithinDays !== undefined) params.set("expiringWithinDays", String(filters.expiringWithinDays));
  if (filters.sourceType) params.set("sourceType", filters.sourceType);
  if (filters.cursor) params.set("cursor", filters.cursor);
  if (filters.limit) params.set("limit", String(filters.limit));
  return params.toString() ? `?${params.toString()}` : "";
}

export async function fetchContracts(
  businessId: string,
  filters?: ContractFilters,
): Promise<{ data: ContractListResponse | null; error: string | null }> {
  return apiGet<ContractListResponse>(
    `/contracts/businesses/${encodeURIComponent(businessId)}${buildQueryString(filters)}`,
  );
}

export async function fetchContractStats(
  businessId: string,
): Promise<{ data: ContractStats | null; error: string | null }> {
  return apiGet<ContractStats>(`/contracts/businesses/${encodeURIComponent(businessId)}/stats`);
}

export async function fetchContract(
  businessId: string,
  contractId: string,
): Promise<{ data: Contract | null; error: string | null }> {
  return apiGet<Contract>(
    `/contracts/businesses/${encodeURIComponent(businessId)}/${encodeURIComponent(contractId)}`,
  );
}

export async function createContract(
  businessId: string,
  input: CreateContractInput,
): Promise<{ data: Contract | null; error: string | null }> {
  return apiPost<Contract>({
    path: `/contracts/businesses/${encodeURIComponent(businessId)}`,
    body: input,
  });
}

export async function updateContract(
  businessId: string,
  contractId: string,
  input: UpdateContractInput,
): Promise<{ data: Contract | null; error: string | null }> {
  return apiPatch<Contract>(
    `/contracts/businesses/${encodeURIComponent(businessId)}/${encodeURIComponent(contractId)}`,
    input,
  );
}

export async function deleteContract(
  businessId: string,
  contractId: string,
): Promise<{ data: { deleted: boolean } | null; error: string | null }> {
  return apiDelete<{ deleted: boolean }>(
    `/contracts/businesses/${encodeURIComponent(businessId)}/${encodeURIComponent(contractId)}`,
  );
}

export async function extractContractTerms(
  businessId: string,
  contractId: string,
  input: ExtractContractTermsInput,
): Promise<{ data: Contract | null; error: string | null }> {
  return apiPost<Contract>({
    path: `/contracts/businesses/${encodeURIComponent(businessId)}/${encodeURIComponent(contractId)}/extract`,
    body: input,
  });
}

export async function acknowledgeContractAlert(
  businessId: string,
  contractId: string,
  alertId: string,
): Promise<{ data: ContractAlert | null; error: string | null }> {
  return apiPost<ContractAlert>({
    path: `/contracts/businesses/${encodeURIComponent(businessId)}/${encodeURIComponent(contractId)}/acknowledge-alert/${encodeURIComponent(alertId)}`,
    body: {},
  });
}

export async function fetchContractTags(
  businessId: string,
): Promise<{ data: ContractTag[] | null; error: string | null }> {
  return apiGet<ContractTag[]>(`/contracts/businesses/${encodeURIComponent(businessId)}/tags`);
}

export async function createContractTag(
  businessId: string,
  input: { name: string; color?: string },
): Promise<{ data: ContractTag | null; error: string | null }> {
  return apiPost<ContractTag>({
    path: `/contracts/businesses/${encodeURIComponent(businessId)}/tags`,
    body: input,
  });
}

export async function deleteContractTag(
  businessId: string,
  tagId: string,
): Promise<{ data: { deleted: boolean } | null; error: string | null }> {
  return apiDelete<{ deleted: boolean }>(
    `/contracts/businesses/${encodeURIComponent(businessId)}/tags/${encodeURIComponent(tagId)}`,
  );
}
