import type { GenomeFactData, VerificationStatus } from '../business-genome/key-genome/key-genome.types';
import type {
  ContextAuthorityClass,
  ContextFact,
  ContextVerificationStatus,
} from './context-genome.types';

function verification(status: VerificationStatus): ContextVerificationStatus {
  if (status === 'USER_VERIFIED') return 'VERIFIED';
  if (status === 'STALE') return 'STALE';
  if (status === 'DISPUTED') return 'DISPUTED';
  if (status === 'UNVERIFIED_IMPORTED') return 'UNVERIFIED';
  return 'INFERRED';
}

function authority(fact: GenomeFactData): ContextAuthorityClass {
  if (fact.verificationStatus === 'USER_VERIFIED') return 'USER_VERIFIED';
  if (fact.verificationStatus === 'UNVERIFIED_IMPORTED') return 'EXTERNAL_UNVERIFIED';
  const source = String(fact.sourceType || '').toUpperCase();
  if (source.includes('USER')) return 'USER_DECLARED';
  if (source.includes('DOCUMENT')) return 'DOCUMENT_VERIFIED';
  if (source.includes('SYSTEM') || source.includes('EVENT')) return 'SYSTEM_OBSERVED';
  return 'AGENT_INFERRED';
}

export function businessGenomeFactToContextFact(fact: GenomeFactData): ContextFact {
  return {
    id: fact.id,
    scope: { type: 'BUSINESS', id: fact.businessId },
    kind: 'FACT',
    key: [fact.section, fact.domain, fact.field].join('.'),
    value: fact.value,
    authorityClass: authority(fact),
    verificationStatus: verification(fact.verificationStatus),
    confidence: fact.score.confidence,
    riskIfWrong: fact.riskIfWrong,
    temporal: {
      validFrom: fact.lastVerifiedAt ?? fact.createdAt,
      validTo: null,
      recordedAt: fact.createdAt,
    },
    provenance: {
      sourceType: fact.sourceType,
      sourceId: fact.sourceEntityId ?? null,
      actorType: fact.sourceModule ?? null,
    },
    expiresAt: fact.expiresAt ?? null,
    metadata: {
      section: fact.section,
      domain: fact.domain,
      field: fact.field,
      originalVerificationStatus: fact.verificationStatus,
      score: fact.score,
      sourceEntityType: fact.sourceEntityType ?? null,
      updatedAt: fact.updatedAt,
    },
  };
}
