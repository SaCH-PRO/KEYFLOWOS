import { describe, expect, it } from 'vitest';
import type { ContextFact } from './context-genome.types';
import { assertSingleActiveVersion, isContextRecordActiveAt, supersedeContextFact } from './context-lineage';

const fact = (id: string, from: string, to: string | null = null): ContextFact<string> => ({
  id,
  scope: { type: 'PROJECT', id: 'KEYFLOWOS' },
  kind: 'FACT',
  key: 'architecture.control-plane.mode',
  value: id,
  authorityClass: 'USER_VERIFIED',
  verificationStatus: 'VERIFIED',
  confidence: 1,
  riskIfWrong: 'HIGH',
  temporal: {
    validFrom: from,
    validTo: to,
    recordedAt: from,
  },
  provenance: { sourceType: 'test' },
});

describe('Context Genome temporal lineage', () => {
  it('distinguishes current validity from historical versions', () => {
    const old = fact('v1', '2026-01-01T00:00:00Z', '2026-06-01T00:00:00Z');
    const current = fact('v2', '2026-06-01T00:00:00Z');
    expect(isContextRecordActiveAt(old, '2026-05-01T00:00:00Z')).toBe(true);
    expect(isContextRecordActiveAt(old, '2026-07-01T00:00:00Z')).toBe(false);
    expect(isContextRecordActiveAt(current, '2026-07-01T00:00:00Z')).toBe(true);
  });

  it('supersedes without destructive overwrite', () => {
    const current = fact('v1', '2026-01-01T00:00:00Z');
    const replacement = fact('v2', '2026-09-30T12:00:00Z');
    const out = supersedeContextFact(current, replacement, '2026-09-30T12:00:00Z');

    expect(out.closed.id).toBe('v1');
    expect(out.closed.temporal.validTo).toBe('2026-09-30T12:00:00Z');
    expect(out.closed.supersededById).toBe('v2');
    expect(out.replacement.supersedesId).toBe('v1');
    expect(out.replacement.temporal.validFrom).toBe('2026-09-30T12:00:00Z');
  });

  it('rejects overlapping active versions', () => {
    expect(() =>
      assertSingleActiveVersion([
        fact('v1', '2026-01-01T00:00:00Z'),
        fact('v2', '2026-02-01T00:00:00Z'),
      ], '2026-03-01T00:00:00Z'),
    ).toThrow('CONTEXT_MULTIPLE_ACTIVE_VERSIONS');
  });

  it('rejects self-supersession', () => {
    expect(() =>
      supersedeContextFact(
        fact('same', '2026-01-01T00:00:00Z'),
        fact('same', '2026-09-30T00:00:00Z'),
        '2026-09-30T00:00:00Z',
      ),
    ).toThrow('CONTEXT_SUPERSESSION_SELF');
  });
});
