import type { DnaSectionKey } from '../blueprint/blueprint.types';

export type GenomeEvolutionProposalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'EDITED';

export interface GenomeEvolutionProposalInput {
  section: DnaSectionKey;
  proposedPatch: Record<string, unknown>;
  reason: string;
  evidence?: string[];
  confidence?: number;
  createdBy?: string;
  sourceEventIds?: string[];
}

export interface GenomeEvolutionProposalData {
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
