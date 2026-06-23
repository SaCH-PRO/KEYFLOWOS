export type TemporalFlowSource =
  | 'APP'
  | 'KEY'
  | 'GOOGLE_CALENDAR'
  | 'WHATSAPP'
  | 'EMAIL'
  | 'META'
  | 'FACEBOOK'
  | 'INSTAGRAM'
  | 'SHOPIFY'
  | 'SLACK'
  | 'WEBHOOK'
  | 'MANUAL';

export const TEMPORAL_FLOW_SOURCES: TemporalFlowSource[] = [
  'APP',
  'KEY',
  'GOOGLE_CALENDAR',
  'WHATSAPP',
  'EMAIL',
  'META',
  'FACEBOOK',
  'INSTAGRAM',
  'SHOPIFY',
  'SLACK',
  'WEBHOOK',
  'MANUAL',
];

export type TemporalFlowStatus = 'RECORDED' | 'ACTION_REQUIRED' | 'RESOLVED' | 'DISMISSED';
export type TemporalFlowImportance = 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL';
export type TemporalFlowVisibility = 'USER' | 'SYSTEM' | 'HIDDEN';

export interface TemporalFlowEventInput {
  businessId: string;
  userId?: string;

  source: TemporalFlowSource | string;
  type: string;
  module?: string;
  entityType?: string;
  entityId?: string;

  title: string;
  summary?: string;
  description?: string;

  startsAt?: Date;
  endsAt?: Date;
  occurredAt?: Date;

  status?: TemporalFlowStatus;
  importance?: TemporalFlowImportance;
  visibility?: TemporalFlowVisibility;

  payload?: Record<string, unknown>;
  signals?: Record<string, unknown>;
  tags?: string[];

  reminderAt?: Date;
  genomeImpactPotential?: boolean;
  keyAnalysisStatus?: 'PENDING' | 'ANALYZED' | 'IGNORED';

  threadId?: string;
  messageId?: string;
  contactId?: string;
  memoryEmbeddingId?: string;

  externalId?: string;
  externalUrl?: string;
}

export interface TemporalFlowAnalysisItem {
  title: string;
  reason?: string;
  eventId?: string;
}

export interface TemporalFlowOpportunity {
  title: string;
  evidence: string[];
}

export interface TemporalFlowRisk {
  title: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  evidence: string[];
}

export interface TemporalFlowGenomeCandidate {
  section: string;
  reason: string;
  evidence: string[];
  eventIds?: string[];
}

export interface TemporalFlowMemoryInsight {
  title: string;
  reason: string;
  evidence?: string[];
  memoryId?: string;
}

export interface TemporalFlowAnalysis {
  summary: string;
  urgentItems: TemporalFlowAnalysisItem[];
  opportunities: TemporalFlowOpportunity[];
  risks: TemporalFlowRisk[];
  genomeProposalCandidates: TemporalFlowGenomeCandidate[];
  memoryInsights?: TemporalFlowMemoryInsight[];
}

export interface TemporalConnectorNormalizer<TPayload = unknown> {
  source: string;
  normalize(businessId: string, payload: TPayload): TemporalFlowEventInput[];
}
