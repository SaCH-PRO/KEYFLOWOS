/**
 * W11-TRANSIENT-CONFLICT (F-37): shared `isLostTransactionConflict` helper in
 * `core/prisma/transaction-conflict.ts`, re-exported from
 * `core/inventory/stock-lock-order.ts`.
 */
import { describe, expect, it } from 'vitest';
import { isLostTransactionConflict } from './transaction-conflict';
import { isLostTransactionConflict as reexportedFromStockLockOrder } from '../inventory/stock-lock-order';

describe('isLostTransactionConflict (W11-TRANSIENT-CONFLICT, F-37)', () => {
  it('returns true for Prisma P2034 write conflict / deadlock', () => {
    expect(isLostTransactionConflict({ code: 'P2034' })).toBe(true);
    expect(
      isLostTransactionConflict(
        Object.assign(new Error('Transaction failed due to a write conflict or a deadlock'), {
          code: 'P2034',
        }),
      ),
    ).toBe(true);
  });

  it('returns true for SQLSTATE code 40P01 or 40001 on err.code', () => {
    expect(isLostTransactionConflict({ code: '40P01' })).toBe(true);
    expect(isLostTransactionConflict({ code: '40001' })).toBe(true);
  });

  it('returns true for SQLSTATE 40P01 or 40001 on err.meta.code', () => {
    expect(isLostTransactionConflict({ meta: { code: '40P01' } })).toBe(true);
    expect(isLostTransactionConflict({ meta: { code: '40001' } })).toBe(true);
  });

  it('returns true for a no-code @prisma/adapter-pg PostgresError message with 40P01 or 40001 and its escaped variant', () => {
    expect(
      isLostTransactionConflict(
        new Error('ConnectorError { kind: QueryError(PostgresError { code: "40P01", severity: "ERROR" }) }'),
      ),
    ).toBe(true);
    expect(
      isLostTransactionConflict(
        new Error('ConnectorError { kind: QueryError(PostgresError { code: \\"40P01\\", severity: "ERROR" }) }'),
      ),
    ).toBe(true);
    expect(
      isLostTransactionConflict(
        new Error('ConnectorError { kind: QueryError(PostgresError { code: "40001", severity: "ERROR" }) }'),
      ),
    ).toBe(true);
    expect(
      isLostTransactionConflict(
        new Error('ConnectorError { kind: QueryError(PostgresError { code: \\"40001\\", severity: "ERROR" }) }'),
      ),
    ).toBe(true);
  });

  it('returns true for P2010 raw query failure wrapping 40001 or 40P01', () => {
    expect(
      isLostTransactionConflict(
        Object.assign(new Error('Raw query failed. Code: `40001`. Message: `serialization failure`'), {
          code: 'P2010',
        }),
      ),
    ).toBe(true);
    expect(
      isLostTransactionConflict(
        Object.assign(new Error('Raw query failed. Code: `40P01`. Message: `db error`'), {
          code: 'P2010',
        }),
      ),
    ).toBe(true);
  });

  it('returns true for deadlock detected and could not serialize access message text', () => {
    expect(isLostTransactionConflict(new Error('ERROR: deadlock detected'))).toBe(true);
    expect(isLostTransactionConflict(new Error('ERROR: could not serialize access due to concurrent update'))).toBe(
      true,
    );
  });

  it('returns false for P2002, P2025, P2028, P2024, non-conflict P2010, plain Error, and nullish values', () => {
    expect(isLostTransactionConflict({ code: 'P2002', message: 'Unique constraint failed' })).toBe(false);
    expect(isLostTransactionConflict({ code: 'P2025', message: 'Record not found' })).toBe(false);
    expect(isLostTransactionConflict({ code: 'P2028', message: 'Transaction already closed' })).toBe(false);
    expect(isLostTransactionConflict({ code: 'P2024', message: 'Timed out fetching a new connection' })).toBe(false);
    expect(
      isLostTransactionConflict({
        code: 'P2010',
        message: 'Raw query failed. Code: `22P02`. Message: invalid input syntax',
      }),
    ).toBe(false);
    expect(isLostTransactionConflict(new Error('Something went wrong'))).toBe(false);
    expect(isLostTransactionConflict(null)).toBe(false);
    expect(isLostTransactionConflict(undefined)).toBe(false);
    expect(isLostTransactionConflict({})).toBe(false);
  });

  it('is re-exported from core/inventory/stock-lock-order without breaking existing imports', () => {
    expect(reexportedFromStockLockOrder).toBe(isLostTransactionConflict);
  });
});
