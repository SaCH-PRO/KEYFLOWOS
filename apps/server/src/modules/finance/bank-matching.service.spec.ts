import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { BankMatchingService, descriptionOverlap, tokenize } from './bank-matching.service';

describe('tokenize', () => {
  it('lowercases and strips punctuation, drops short tokens', () => {
    const t = tokenize('ACH Deposit: ACME-CORP #123');
    expect(t.has('ach')).toBe(true);
    expect(t.has('deposit')).toBe(true);
    expect(t.has('acme')).toBe(true);
    expect(t.has('corp')).toBe(true);
    expect(t.has('123')).toBe(true);
    expect(t.has('to')).toBe(false);
  });
});

describe('descriptionOverlap', () => {
  it('returns 1.0 for identical token sets', () => {
    expect(descriptionOverlap('ACH ACME 500', 'ACH ACME 500')).toBeCloseTo(1, 5);
  });

  it('returns 0 for disjoint descriptions', () => {
    expect(descriptionOverlap('ACH ACME', 'Wire Vendor')).toBe(0);
  });

  it('exceeds the 0.5 threshold for typical bank vs ledger pairs', () => {
    // Bank: "ACH DEPOSIT ACME CORP"; Ledger: "Payment from Acme Corp invoice #123"
    const score = descriptionOverlap('ACH DEPOSIT ACME CORP', 'Payment from Acme Corp invoice 123');
    expect(score).toBeGreaterThanOrEqual(0.5);
  });

  it('returns 1.0 when one description is a strict subset of the other', () => {
    expect(descriptionOverlap('Acme Corp', 'Payment Acme Corp invoice 123')).toBe(1);
  });

  it('returns 0 when either description is empty', () => {
    expect(descriptionOverlap('', 'foo bar baz')).toBe(0);
    expect(descriptionOverlap('foo bar baz', '')).toBe(0);
  });
});

describe('manualMatch — same-account integrity', () => {
  it('rejects when the target ledger transaction does not post to the bank account COA', async () => {
    const bank = { id: 'b1', businessId: 'biz1', accountId: 'acc1', status: 'UNMATCHED' as const, matchedTransactionId: null };
    const account = { chartOfAccountId: 'coa-bank-1' };
    const txn = { id: 't1', status: 'POSTED' as const };
    const prisma = {
      client: {
        bankTransaction: {
          findFirst: vi.fn().mockResolvedValueOnce(bank).mockResolvedValueOnce(null),
          update: vi.fn(),
        },
        financialTransaction: {
          findFirst: vi.fn().mockResolvedValue(txn),
        },
        financialAccount: {
          findFirst: vi.fn().mockResolvedValue(account),
        },
        ledgerEntry: {
          // Crucially: no entry for this txn on the bank's COA.
          findFirst: vi.fn().mockResolvedValue(null),
        },
      },
    };
    const audit = { log: vi.fn() };
    const bankRules = { applyRulesToAccount: vi.fn() };
    const svc = new BankMatchingService(prisma as never, audit as never, bankRules as never);
    await expect(svc.manualMatch('biz1', 'b1', 't1', 'user1')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.client.bankTransaction.update).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });
});
