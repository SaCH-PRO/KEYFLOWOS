import type { ContextFact } from './context-genome.types';

function millis(value?: string | null): number | null {
  if (!value) return null;
  const n = Date.parse(value);
  return Number.isFinite(n) ? n : null;
}

export function isContextRecordActiveAt(
  record: Pick<ContextFact, 'temporal'>,
  at: string | Date = new Date(),
): boolean {
  const when = at instanceof Date ? at.getTime() : Date.parse(at);
  if (!Number.isFinite(when)) return false;
  const from = millis(record.temporal.validFrom);
  const to = millis(record.temporal.validTo);
  if (from !== null && when < from) return false;
  if (to !== null && when >= to) return false;
  return true;
}

export function supersedeContextFact<T>(
  current: ContextFact<T>,
  replacement: Omit<ContextFact<T>, 'supersedesId' | 'supersededById'>,
  at: string,
): { closed: ContextFact<T>; replacement: ContextFact<T> } {
  if (current.id === replacement.id) {
    throw new Error('CONTEXT_SUPERSESSION_SELF');
  }
  const closeAt = Date.parse(at);
  if (!Number.isFinite(closeAt)) {
    throw new Error('CONTEXT_SUPERSESSION_TIME_INVALID');
  }
  const currentFrom = millis(current.temporal.validFrom);
  if (currentFrom !== null && closeAt < currentFrom) {
    throw new Error('CONTEXT_SUPERSESSION_BEFORE_VALID_FROM');
  }

  const closed: ContextFact<T> = {
    ...current,
    temporal: {
      ...current.temporal,
      validTo: at,
    },
    supersededById: replacement.id,
  };

  const next: ContextFact<T> = {
    ...replacement,
    supersedesId: current.id,
    supersededById: null,
    temporal: {
      ...replacement.temporal,
      validFrom: replacement.temporal.validFrom ?? at,
    },
  };

  return { closed, replacement: next };
}

export function assertSingleActiveVersion<T>(records: ContextFact<T>[], at: string | Date = new Date()): ContextFact<T> | null {
  const active = records.filter((record) => isContextRecordActiveAt(record, at));
  if (active.length > 1) {
    throw new Error('CONTEXT_MULTIPLE_ACTIVE_VERSIONS');
  }
  return active[0] ?? null;
}
