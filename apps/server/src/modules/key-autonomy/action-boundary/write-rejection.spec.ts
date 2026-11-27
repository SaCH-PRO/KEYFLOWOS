/**
 * W11-TRANSIENT-CONFLICT (F-37): unit spec for `isDeterministicWriteRejection`
 * in `KeyActionBoundaryService`.
 */
import { describe, expect, it } from 'vitest';
import { isDeterministicWriteRejection } from './key-action-boundary.service';

describe('isDeterministicWriteRejection (W11-TRANSIENT-CONFLICT, F-37)', () => {
  it('returns false for P2010 wrapping 40P01 or 40001 (transient conflict, not deterministic rejection)', () => {
    expect(
      isDeterministicWriteRejection(
        Object.assign(new Error('Raw query failed. Code: `40P01`. Message: `deadlock detected`'), {
          code: 'P2010',
        }),
      ),
    ).toBe(false);
    expect(
      isDeterministicWriteRejection(
        Object.assign(new Error('Raw query failed. Code: `40001`. Message: `could not serialize access`'), {
          code: 'P2010',
        }),
      ),
    ).toBe(false);
  });

  it('returns false for transient Prisma codes P2024, P2028, and P2034', () => {
    expect(isDeterministicWriteRejection({ code: 'P2024' })).toBe(false);
    expect(isDeterministicWriteRejection({ code: 'P2028' })).toBe(false);
    expect(isDeterministicWriteRejection({ code: 'P2034' })).toBe(false);
  });

  it('returns false for no-code deadlock, plain Error, and nullish values', () => {
    expect(
      isDeterministicWriteRejection(
        new Error('ConnectorError { kind: QueryError(PostgresError { code: "40P01", message: "deadlock detected" }) }'),
      ),
    ).toBe(false);
    expect(isDeterministicWriteRejection(new Error('connection dropped'))).toBe(false);
    expect(isDeterministicWriteRejection(null)).toBe(false);
    expect(isDeterministicWriteRejection(undefined)).toBe(false);
    expect(isDeterministicWriteRejection({})).toBe(false);
  });

  it('returns true for deterministic Prisma P2xxx rejections such as P2003, P2002, P2025, and non-conflict P2010', () => {
    expect(isDeterministicWriteRejection({ code: 'P2003', message: 'Foreign key constraint failed' })).toBe(true);
    expect(isDeterministicWriteRejection({ code: 'P2002', message: 'Unique constraint failed' })).toBe(true);
    expect(isDeterministicWriteRejection({ code: 'P2025', message: 'Record not found' })).toBe(true);
    expect(
      isDeterministicWriteRejection({
        code: 'P2010',
        message: 'Raw query failed. Code: `22P02`. Message: invalid input syntax',
      }),
    ).toBe(true);
  });
});
