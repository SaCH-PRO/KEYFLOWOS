/**
 * W11-TRANSIENT-CONFLICT (F-37): unit spec for `isTransientPaymentAbort` used
 * by `PaymentsService`'s PayPal capture recording retry loop.
 */
import { describe, expect, it } from 'vitest';
import { isTransientPaymentAbort } from './payments.service';

describe('isTransientPaymentAbort (W11-TRANSIENT-CONFLICT, F-37)', () => {
  it('returns true for P2028 and P2034', () => {
    expect(isTransientPaymentAbort({ code: 'P2028', message: 'Transaction already closed' })).toBe(true);
    expect(isTransientPaymentAbort({ code: 'P2034', message: 'Transaction failed due to a write conflict' })).toBe(
      true,
    );
  });

  it('returns true for a no-code @prisma/adapter-pg 40P01 deadlock and its escaped variant', () => {
    expect(
      isTransientPaymentAbort(
        new Error('ConnectorError { kind: QueryError(PostgresError { code: "40P01", message: "deadlock detected" }) }'),
      ),
    ).toBe(true);
    expect(
      isTransientPaymentAbort(
        new Error('ConnectorError { kind: QueryError(PostgresError { code: \\"40P01\\", severity: "ERROR" }) }'),
      ),
    ).toBe(true);
  });

  it('returns true for P2010 raw query failure wrapping 40P01 or 40001', () => {
    expect(
      isTransientPaymentAbort(
        Object.assign(new Error('Raw query failed. Code: `40P01`. Message: `deadlock detected`'), {
          code: 'P2010',
        }),
      ),
    ).toBe(true);
    expect(
      isTransientPaymentAbort(
        Object.assign(new Error('Raw query failed. Code: `40001`. Message: `serialization failure`'), {
          code: 'P2010',
        }),
      ),
    ).toBe(true);
  });

  it('returns true for SQLSTATE 40P01 or 40001 on code or meta.code', () => {
    expect(isTransientPaymentAbort({ code: '40P01' })).toBe(true);
    expect(isTransientPaymentAbort({ code: '40001' })).toBe(true);
    expect(isTransientPaymentAbort({ meta: { code: '40P01' } })).toBe(true);
    expect(isTransientPaymentAbort({ meta: { code: '40001' } })).toBe(true);
  });

  it('returns false for P2002, P2025, P2024 (unchanged TRANSIENT_TX_ABORTS), non-conflict P2010, plain Error, and nullish values', () => {
    expect(isTransientPaymentAbort({ code: 'P2002', message: 'Unique constraint failed' })).toBe(false);
    expect(isTransientPaymentAbort({ code: 'P2025', message: 'Record not found' })).toBe(false);
    expect(isTransientPaymentAbort({ code: 'P2024', message: 'Timed out fetching a new connection' })).toBe(false);
    expect(
      isTransientPaymentAbort({
        code: 'P2010',
        message: 'Raw query failed. Code: `22P02`. Message: invalid input syntax',
      }),
    ).toBe(false);
    expect(isTransientPaymentAbort(new Error('provider recording failed'))).toBe(false);
    expect(isTransientPaymentAbort(null)).toBe(false);
    expect(isTransientPaymentAbort(undefined)).toBe(false);
  });
});
