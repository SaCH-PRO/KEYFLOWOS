import { describe, expect, it } from 'vitest';
import { parseBankAmount, parseBankCsv, parseBankDate } from './bank-import.service';

describe('parseBankDate', () => {
  it('parses ISO yyyy-mm-dd', () => {
    expect(parseBankDate('2026-01-15')?.toISOString().slice(0, 10)).toBe('2026-01-15');
  });
  it('parses dd/mm/yyyy day-first', () => {
    expect(parseBankDate('15/01/2026')?.toISOString().slice(0, 10)).toBe('2026-01-15');
  });
  it('parses dd-mm-yy', () => {
    expect(parseBankDate('15-01-26')?.toISOString().slice(0, 10)).toBe('2026-01-15');
  });
  it('returns null for garbage', () => {
    expect(parseBankDate('hello')).toBeNull();
    expect(parseBankDate('')).toBeNull();
  });
});

describe('parseBankAmount', () => {
  it('handles plain numbers', () => {
    expect(parseBankAmount('123.45')?.toString()).toBe('123.45');
  });
  it('strips currency symbols and commas', () => {
    expect(parseBankAmount('TT$1,234.56')?.toString()).toBe('1234.56');
  });
  it('handles parenthesised negatives', () => {
    expect(parseBankAmount('(50.00)')?.toString()).toBe('-50');
  });
  it('handles leading minus', () => {
    expect(parseBankAmount('-12.50')?.toString()).toBe('-12.5');
  });
  it('returns null for blank/garbage', () => {
    expect(parseBankAmount('')).toBeNull();
    expect(parseBankAmount('--')).toBeNull();
  });
});

describe('parseBankCsv', () => {
  it('parses a standard 4-column file', () => {
    const csv = `Date,Description,Amount,Reference
2026-01-15,ACH Deposit ACME,500.00,REF123
2026-01-16,Wire to Vendor,-200.00,
`;
    const { rows, errors } = parseBankCsv(csv);
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows[0].description).toBe('ACH Deposit ACME');
    expect(rows[0].amount.toString()).toBe('500');
    expect(rows[0].reference).toBe('REF123');
    expect(rows[1].amount.toString()).toBe('-200');
    expect(rows[1].reference).toBeNull();
  });

  it('falls back to Debit/Credit columns when Amount is missing', () => {
    const csv = `Posting Date,Narrative,Debit,Credit
2026-01-15,Payment,0,500.00
2026-01-16,Cheque,200.00,0
`;
    const { rows } = parseBankCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0].amount.toString()).toBe('500');
    expect(rows[1].amount.toString()).toBe('-200');
  });

  it('records errors for invalid rows but keeps going', () => {
    const csv = `Date,Description,Amount
not-a-date,Foo,100
2026-01-16,Bar,abc
2026-01-17,Baz,50
`;
    const { rows, errors } = parseBankCsv(csv);
    expect(rows).toHaveLength(1);
    expect(errors.length).toBe(2);
  });

  it('throws when required columns are missing', () => {
    expect(() => parseBankCsv(`Foo,Bar\n1,2\n`)).toThrow(/Date column/);
  });

  it('produces stable parses for re-import idempotency under description variation', () => {
    // Two CSVs with identical (date, amount, reference) but different
    // memo formatting must parse to rows that share a dedupe key. The key
    // is built from those four fields by the service.
    const a = parseBankCsv('Date,Description,Amount,Reference\n2026-01-15,ACME #1,100,REF1\n').rows[0];
    const b = parseBankCsv('Date,Description,Amount,Reference\n2026-01-15,ACME Inc - Invoice 1,100,REF1\n').rows[0];
    const key = (r: { date: Date; amount: { toString(): string }; reference: string | null }) =>
      `${r.date.toISOString().slice(0, 10)}|${r.amount.toString()}|${r.reference}`;
    expect(key(a)).toBe(key(b));
  });
});
