export type ConstitutionVersionStatus = 'DRAFT' | 'ACTIVE' | 'ARCHIVED';

export interface ConstitutionVersionData {
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

export interface GenerateConstitutionVersionInput {
  changeNotes?: string;
  status?: ConstitutionVersionStatus;
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
