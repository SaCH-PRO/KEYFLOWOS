export type ContextScopeType =
  | 'BUSINESS'
  | 'PROJECT'
  | 'PROGRAMME'
  | 'AGENT'
  | 'WORKFLOW'
  | 'USER';

export type ContextKind =
  | 'FACT'
  | 'PREFERENCE'
  | 'OBSERVATION'
  | 'EPISODE'
  | 'DECISION'
  | 'POLICY'
  | 'PROCEDURE'
  | 'HYPOTHESIS'
  | 'DERIVED_STATE'
  | 'LESSON'
  | 'CONSTRAINT';

export type ContextAuthorityClass =
  | 'USER_DECLARED'
  | 'USER_VERIFIED'
  | 'DOCUMENT_VERIFIED'
  | 'SYSTEM_OBSERVED'
  | 'AGENT_INFERRED'
  | 'DERIVED'
  | 'EXTERNAL_UNVERIFIED';

export type ContextVerificationStatus =
  | 'VERIFIED'
  | 'INFERRED'
  | 'UNVERIFIED'
  | 'STALE'
  | 'DISPUTED';

export type ContextRiskIfWrong = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface ContextScope {
  type: ContextScopeType;
  id: string;
}

export interface ContextTemporalWindow {
  /** Real-world validity time. */
  validFrom?: string | null;
  validTo?: string | null;
  /** Knowledge time: when KEYFLOWOS recorded this version. */
  recordedAt: string;
}

export interface ContextProvenance {
  sourceType: string;
  sourceId?: string | null;
  sourceUri?: string | null;
  sourceRevision?: string | null;
  sourceContentHash?: string | null;
  actorType?: string | null;
  actorId?: string | null;
  correlationId?: string | null;
  causationId?: string | null;
  runId?: string | null;
}

export interface ContextRecordBase {
  id: string;
  scope: ContextScope;
  kind: ContextKind;
  key: string;
  authorityClass: ContextAuthorityClass;
  verificationStatus: ContextVerificationStatus;
  confidence: number;
  riskIfWrong: ContextRiskIfWrong;
  temporal: ContextTemporalWindow;
  provenance: ContextProvenance;
  supersedesId?: string | null;
  supersededById?: string | null;
  expiresAt?: string | null;
  metadata?: Record<string, unknown>;
}

export interface ContextFact<T = unknown> extends ContextRecordBase {
  kind: 'FACT' | 'PREFERENCE' | 'OBSERVATION' | 'HYPOTHESIS' | 'DERIVED_STATE' | 'CONSTRAINT';
  value: T;
}

export interface ContextEvidence {
  id: string;
  scope: ContextScope;
  recordId?: string | null;
  summary: string;
  strength: number;
  occurredAt?: string | null;
  recordedAt: string;
  provenance: ContextProvenance;
}

export interface ContextDecision extends ContextRecordBase {
  kind: 'DECISION';
  decision: string;
  rationale: string;
  alternatives: string[];
  consequences: string[];
}

export interface ContextPolicyVersion extends ContextRecordBase {
  kind: 'POLICY' | 'PROCEDURE';
  version: number;
  content: unknown;
  changeNotes?: string | null;
}

export interface ContextEvent {
  id: string;
  scope: ContextScope;
  eventType: string;
  occurredAt: string;
  recordedAt: string;
  payload: unknown;
  provenance: ContextProvenance;
}

export interface ContextProjection<T = unknown> {
  scope: ContextScope;
  projectionType: string;
  generation: number;
  observedGeneration: number;
  state: T;
  computedAt: string;
  sourceRecordIds: string[];
}

export interface ContextReadiness {
  scope: ContextScope;
  capability: string;
  readinessScore: number;
  missingRequiredContext: string[];
  blockedReasons: string[];
  automationAllowed: boolean;
  computedAt: string;
}
