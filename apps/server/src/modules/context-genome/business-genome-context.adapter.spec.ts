import { describe, expect, it } from 'vitest';
import { businessGenomeFactToContextFact } from './business-genome-context.adapter';

describe('Business Genome Context Genome adapter', () => {
  it('preserves current business fact semantics while adding generic scope/provenance', () => {
    const out = businessGenomeFactToContextFact({
      id: 'gf_1',
      businessId: 'biz_1',
      section: 'BUSINESS_IDENTITY',
      domain: 'identity',
      field: 'industry',
      value: 'healthcare',
      sourceModule: 'business-genesis',
      sourceType: 'USER_INPUT',
      sourceEntityType: 'answer',
      sourceEntityId: 'answer_1',
      score: {
        completeness: 1,
        quality: 0.9,
        confidence: 0.95,
        freshness: 1,
        operationalReadiness: 0.8,
        riskPenalty: 0,
        overall: 0.93,
      },
      verificationStatus: 'USER_VERIFIED',
      riskIfWrong: 'HIGH',
      lastVerifiedAt: '2026-09-30T10:00:00Z',
      expiresAt: null,
      createdAt: '2026-09-30T09:00:00Z',
      updatedAt: '2026-09-30T10:00:00Z',
    });

    expect(out.scope).toEqual({ type: 'BUSINESS', id: 'biz_1' });
    expect(out.kind).toBe('FACT');
    expect(out.key).toBe('BUSINESS_IDENTITY.identity.industry');
    expect(out.authorityClass).toBe('USER_VERIFIED');
    expect(out.verificationStatus).toBe('VERIFIED');
    expect(out.confidence).toBe(0.95);
    expect(out.provenance.sourceId).toBe('answer_1');
    expect(out.temporal.validFrom).toBe('2026-09-30T10:00:00Z');
  });
});
