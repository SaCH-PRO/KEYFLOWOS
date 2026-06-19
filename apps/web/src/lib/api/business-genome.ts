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
  | "technology"
  | "risk";

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
  executiveReadinessScore: number;
  readinessBreakdown: Record<string, number>;
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
  executiveReadinessScore: number;
  readinessBreakdown: Record<string, number>;
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

export type GenomeEvolutionProposalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'EDITED';

export interface GenomeEvolutionProposal {
  id: string;
  businessId: string;
  section: DnaSectionKey;
  proposedPatch: Record<string, unknown>;
  reason: string;
  evidence: string[];
  confidence: number;
  status: GenomeEvolutionProposalStatus;
  createdBy: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  sourceEventIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface SendGenomeMessageResult {
  message: GenomeChatMessage;
  proposedUpdates: ProposedGenomeUpdate | null;
}

export type ConstitutionVersionStatus = 'DRAFT' | 'ACTIVE' | 'ARCHIVED';

export interface ConstitutionVersion {
  id: string;
  businessId: string;
  version: number;
  title: string;
  status: ConstitutionVersionStatus;
  content: Record<string, unknown>;
  summary?: string | null;
  changeNotes?: string | null;
  sourceGenomeIntegrity?: number | null;
  sourceExecutiveReadiness?: number | null;
  sourceGenomeStage?: string | null;
  sourceDnaScores?: Record<string, number> | null;
  sourceDnaConfidence?: Record<string, number> | null;
  generatedBy?: string | null;
  generatedAt: string;
  createdAt: string;
}

export interface ConstitutionStaleness {
  stale: boolean;
  reason: string;
  currentGenomeIntegrity: number;
  constitutionGenomeIntegrity: number | null;
  currentExecutiveReadiness?: number;
  constitutionExecutiveReadiness?: number | null;
  currentGenomeStage?: string;
  constitutionGenomeStage?: string | null;
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

export async function getGenomeEvolutionProposals(
  businessId: string,
  filters?: { status?: string; section?: string },
) {
  const params = new URLSearchParams();
  if (filters?.status) params.set('status', filters.status);
  if (filters?.section) params.set('section', filters.section);
  const query = params.toString();
  return apiGet<GenomeEvolutionProposal[]>(
    `/business-genome/businesses/${businessId}/evolution-proposals${query ? `?${query}` : ''}`,
  );
}

export async function generateGenomeEvolutionProposals(businessId: string) {
  return apiPost<GenomeEvolutionProposal[]>({
    path: `/business-genome/businesses/${businessId}/evolution-proposals/generate-from-temporal-flow`,
    body: {},
  });
}

export async function approveGenomeEvolutionProposal(businessId: string, proposalId: string) {
  return apiPost<{ proposal: GenomeEvolutionProposal; genome: GenomeIntegrityResult }>({
    path: `/business-genome/businesses/${businessId}/evolution-proposals/${proposalId}/approve`,
    body: {},
  });
}

export async function rejectGenomeEvolutionProposal(businessId: string, proposalId: string) {
  return apiPost<GenomeEvolutionProposal>({
    path: `/business-genome/businesses/${businessId}/evolution-proposals/${proposalId}/reject`,
    body: {},
  });
}

export async function editGenomeEvolutionProposal(
  businessId: string,
  proposalId: string,
  patch: Partial<Omit<GenomeEvolutionProposal, 'id' | 'businessId' | 'status' | 'createdAt' | 'updatedAt'>>,
) {
  return apiPatch<GenomeEvolutionProposal>(
    `/business-genome/businesses/${businessId}/evolution-proposals/${proposalId}`,
    patch,
  );
}

export async function getLatestConstitutionVersion(businessId: string) {
  return apiGet<ConstitutionVersion | null>(`/business-genome/businesses/${businessId}/constitution/latest`);
}

export async function getConstitutionVersions(businessId: string) {
  return apiGet<ConstitutionVersion[]>(`/business-genome/businesses/${businessId}/constitution/versions`);
}

export async function generateConstitutionVersion(businessId: string, input: { changeNotes?: string } = {}) {
  return apiPost<ConstitutionVersion>({
    path: `/business-genome/businesses/${businessId}/constitution/generate`,
    body: input,
  });
}

export async function getConstitutionStaleness(businessId: string) {
  return apiGet<ConstitutionStaleness>(`/business-genome/businesses/${businessId}/constitution/staleness`);
}

export async function archiveConstitutionVersion(businessId: string, version: number) {
  return apiPost<ConstitutionVersion>({
    path: `/business-genome/businesses/${businessId}/constitution/versions/${version}/archive`,
    body: {},
  });
}

export type DocumentPackArtifact = 'executive-brief' | 'constitution' | 'dna-report';

export function getDocumentPackExportUrl(
  businessId: string,
  artifact: DocumentPackArtifact,
  format: 'pdf' | 'docx',
  version?: number,
): string {
  const params = new URLSearchParams({ format });
  if (version !== undefined) params.set('version', String(version));
  return `/business-genome/businesses/${businessId}/document-pack/${artifact}/export?${params.toString()}`;
}
