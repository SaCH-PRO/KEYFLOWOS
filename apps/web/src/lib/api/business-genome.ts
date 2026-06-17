import { apiGet, apiPatch, apiPost } from "@/lib/api";

export type DnaSectionKey =
  | "founder"
  | "vision"
  | "business"
  | "market"
  | "financial"
  | "legal"
  | "operations"
  | "sales"
  | "marketing"
  | "growth"
  | "technology";

export type GenomeStage =
  | "CONCEPT"
  | "VALIDATED_CONCEPT"
  | "REGISTERED_ENTITY"
  | "REVENUE_ENGINE"
  | "OPERATING_BUSINESS"
  | "GROWTH_BUSINESS"
  | "ENTERPRISE_READY";

export interface DnaSectionScore {
  key: DnaSectionKey;
  label: string;
  integrity: number;
  confidence: number;
  summary: string;
  fieldsCaptured: number;
  fieldsTotal: number;
  missingFields: string[];
  recommendation: string;
}

export interface GenomeIntegrityResult {
  genomeIntegrity: number;
  genomeDnaScores: Record<DnaSectionKey, number>;
  genomeDnaConfidence: Record<DnaSectionKey, number>;
  genomeStage: GenomeStage;
  threePillarMinimumMet: boolean;
  dnaSections: DnaSectionScore[];
}

export interface GenomeRecommendation {
  id: string;
  section: DnaSectionKey;
  title: string;
  reason: string;
  href?: string;
}

export interface GenomeIntegritySummary {
  genomeIntegrity: number;
  genomeDnaScores: Record<DnaSectionKey, number>;
  genomeDnaConfidence: Record<DnaSectionKey, number>;
  genomeStage: GenomeStage;
  threePillarMinimumMet: boolean;
}

export interface ThreePillarStatus {
  met: boolean;
  founder: number;
  business: number;
  market: number;
}

export interface GenomeRecommendationsResponse {
  recommendations: GenomeRecommendation[];
}

export interface GenomeChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface ProposedGenomeUpdate {
  section: DnaSectionKey;
  data: Record<string, unknown>;
  summary: string;
}

export interface SendGenomeMessageResult {
  message: GenomeChatMessage;
  proposedUpdates: ProposedGenomeUpdate | null;
}

export async function getGenome(businessId: string) {
  return apiGet<GenomeIntegrityResult>(`/blueprint/businesses/${businessId}/genome`);
}

export async function getGenomeIntegrity(businessId: string) {
  return apiGet<GenomeIntegritySummary>(`/blueprint/businesses/${businessId}/genome/integrity`);
}

export async function getThreePillarStatus(businessId: string) {
  return apiGet<ThreePillarStatus>(`/blueprint/businesses/${businessId}/genome/three-pillar-status`);
}

export async function getGenomeRecommendations(businessId: string) {
  return apiGet<GenomeRecommendationsResponse>(`/blueprint/businesses/${businessId}/genome/recommendations`);
}

export async function getConstitution(businessId: string) {
  return apiGet<Record<string, unknown>>(`/blueprint/businesses/${businessId}/genome/constitution`);
}

export async function updateDnaSection(businessId: string, section: DnaSectionKey, data: Record<string, unknown>) {
  return apiPatch<GenomeIntegrityResult>(`/blueprint/businesses/${businessId}/genome/dna/${section}`, { data });
}

export async function getGenomeMessages(businessId: string) {
  return apiGet<GenomeChatMessage[]>(`/genome-chat/businesses/${businessId}/messages`);
}

export async function sendGenomeMessage(businessId: string, message: string) {
  return apiPost<SendGenomeMessageResult>({
    path: `/genome-chat/businesses/${businessId}/messages`,
    body: { message },
  });
}

export async function applyGenomeUpdates(
  businessId: string,
  section: DnaSectionKey,
  data: Record<string, unknown>,
) {
  return apiPost<GenomeIntegrityResult>({
    path: `/genome-chat/businesses/${businessId}/apply-updates`,
    body: { section, data },
  });
}
