import { describe, expect, it, vi } from 'vitest';
import { RevenuePostingService } from './revenue-posting.service';

describe('RevenuePostingService.depositSystemKey', () => {
  it('routes cash provider/method to CASH', () => {
    expect(RevenuePostingService.depositSystemKey('cash', 'cash')).toBe('CASH');
    expect(RevenuePostingService.depositSystemKey(null, 'cash')).toBe('CASH');
  });

  it('routes bank/check to BANK', () => {
    expect(RevenuePostingService.depositSystemKey('bank_transfer', null)).toBe('BANK');
    expect(RevenuePostingService.depositSystemKey('check', null)).toBe('BANK');
    expect(RevenuePostingService.depositSystemKey(null, 'check')).toBe('BANK');
  });

  it('routes card processors to PAYMENT_PROCESSOR', () => {
    for (const p of ['stripe', 'paypal', 'wipay', 'card']) {
      expect(RevenuePostingService.depositSystemKey(p, null)).toBe('PAYMENT_PROCESSOR');
    }
    expect(RevenuePostingService.depositSystemKey(null, 'google_pay')).toBe('PAYMENT_PROCESSOR');
  });

  it('falls back to CASH for unknown providers', () => {
    expect(RevenuePostingService.depositSystemKey('mystery', 'unknown')).toBe('CASH');
    expect(RevenuePostingService.depositSystemKey(null, null)).toBe('CASH');
  });
});

describe('RevenuePostingService recipe semantics', () => {
  // Lightweight mock harness — the recipes are pure given the inputs the
  // service loads, so we exercise them through a hand-rolled prisma stub
  // and assert which entries land on which account, not what the DB does
  // about it.
  type Posted = {
    kind?: string | null;
    sourceType?: string | null;
    sourceId?: string | null;
    entries: Array<{ accountId: string; debit?: unknown; credit?: unknown }>;
    amount: unknown;
  };
  type ReverseCall = { businessId: string; transactionId: string };

  const ACCOUNTS = {
    CASH: 'acc-cash',
    BANK: 'acc-bank',
    PAYMENT_PROCESSOR: 'acc-pp',
    ACCOUNTS_RECEIVABLE: 'acc-ar',
    REVENUE: 'acc-rev',
    EXPENSE_BANK_FEES: 'acc-fee',
  } as const;

  function make({
    basis,
    invoice,
    payment,
    existingFinancialTx,
  }: {
    basis: 'CASH' | 'ACCRUAL';
    invoice?: any;
    payment?: any;
    existingFinancialTx?: any;
  }) {
    const posted: Posted[] = [];
    const reversed: ReverseCall[] = [];
    const prisma = {
      client: {
        business: {
          findUnique: vi.fn().mockResolvedValue({ accountingBasis: basis }),
        },
        invoice: {
          findUnique: vi.fn().mockResolvedValue(invoice ?? null),
        },
        payment: {
          findUnique: vi.fn().mockResolvedValue(payment ?? null),
        },
        financialTransaction: {
          findUnique: vi.fn().mockResolvedValue(existingFinancialTx ?? null),
        },
      },
    };
    const posting = {
      post: vi.fn(async (input: Posted) => {
        posted.push(input);
        return { transactionId: `txn-${posted.length}`, externalRef: null, alreadyPosted: false };
      }),
      reverse: vi.fn(async (businessId: string, transactionId: string) => {
        reversed.push({ businessId, transactionId });
        return { transactionId: `rev-${reversed.length}`, externalRef: null, alreadyPosted: false };
      }),
    };
    const coa = {
      getBySystemKey: vi.fn(async (_b: string, key: keyof typeof ACCOUNTS) => ({
        id: ACCOUNTS[key],
      })),
    };
    const timeline = { recordEvent: vi.fn() };
    const svc = new RevenuePostingService(prisma as any, posting as any, coa as any, timeline as any);
    return { svc, posted, reversed, posting };
  }

  it('cash basis: invoice finalize is a no-op', async () => {
    const { svc, posted } = make({
      basis: 'CASH',
      invoice: {
        id: 'inv1',
        businessId: 'b1',
        contactId: null,
        currency: 'USD',
        total: 100,
        issueDate: new Date(),
        invoiceNumber: 'INV-1',
        status: 'SENT',
        deletedAt: null,
      },
    });
    const res = await svc.onInvoiceFinalized('inv1');
    expect(res).toBeNull();
    expect(posted).toHaveLength(0);
  });

  it('accrual basis: invoice finalize posts Dr AR / Cr Revenue', async () => {
    const { svc, posted } = make({
      basis: 'ACCRUAL',
      invoice: {
        id: 'inv1',
        businessId: 'b1',
        contactId: null,
        currency: 'USD',
        total: 250,
        issueDate: new Date(),
        invoiceNumber: 'INV-1',
        status: 'SENT',
        deletedAt: null,
      },
    });
    await svc.onInvoiceFinalized('inv1');
    expect(posted).toHaveLength(1);
    const e = posted[0]!.entries;
    expect(e).toEqual([
      expect.objectContaining({ accountId: ACCOUNTS.ACCOUNTS_RECEIVABLE, debit: 250 }),
      expect.objectContaining({ accountId: ACCOUNTS.REVENUE, credit: 250 }),
    ]);
    expect(posted[0]!.kind).toBe('invoice_finalized');
  });

  it('cash basis: payment recorded posts Dr Cash / Cr Revenue', async () => {
    const { svc, posted } = make({
      basis: 'CASH',
      payment: {
        id: 'p1',
        amount: 100,
        currency: 'USD',
        status: 'SUCCESSFUL',
        provider: 'cash',
        method: 'cash',
        businessId: 'b1',
        invoiceId: 'inv1',
        createdAt: new Date(),
        processorFee: 0,
        invoice: { contactId: null, invoiceNumber: 'INV-1' },
      },
    });
    await svc.onPaymentRecorded('p1');
    const e = posted[0]!.entries;
    expect(e).toEqual([
      expect.objectContaining({ accountId: ACCOUNTS.CASH, debit: 100 }),
      expect.objectContaining({ accountId: ACCOUNTS.REVENUE, credit: 100 }),
    ]);
  });

  it('accrual basis: payment recorded posts Dr Processor / Cr AR', async () => {
    const { svc, posted } = make({
      basis: 'ACCRUAL',
      payment: {
        id: 'p1',
        amount: 100,
        currency: 'USD',
        status: 'SUCCESSFUL',
        provider: 'stripe',
        method: 'card',
        businessId: 'b1',
        invoiceId: 'inv1',
        createdAt: new Date(),
        processorFee: 0,
        invoice: { contactId: null, invoiceNumber: 'INV-1' },
      },
    });
    await svc.onPaymentRecorded('p1');
    const e = posted[0]!.entries;
    expect(e).toEqual([
      expect.objectContaining({ accountId: ACCOUNTS.PAYMENT_PROCESSOR, debit: 100 }),
      expect.objectContaining({ accountId: ACCOUNTS.ACCOUNTS_RECEIVABLE, credit: 100 }),
    ]);
  });

  it('processor fee: net debit on deposit + fee debit on expense', async () => {
    const { svc, posted } = make({
      basis: 'CASH',
      payment: {
        id: 'p1',
        amount: 100,
        currency: 'USD',
        status: 'SUCCESSFUL',
        provider: 'stripe',
        method: 'card',
        businessId: 'b1',
        invoiceId: 'inv1',
        createdAt: new Date(),
        processorFee: 3,
        invoice: { contactId: null, invoiceNumber: 'INV-1' },
      },
    });
    await svc.onPaymentRecorded('p1');
    const e = posted[0]!.entries;
    expect(e).toHaveLength(3);
    expect(e[0]).toEqual(
      expect.objectContaining({ accountId: ACCOUNTS.PAYMENT_PROCESSOR, debit: 97 }),
    );
    expect(e[1]).toEqual(
      expect.objectContaining({ accountId: ACCOUNTS.EXPENSE_BANK_FEES, debit: 3 }),
    );
    expect(e[2]).toEqual(expect.objectContaining({ accountId: ACCOUNTS.REVENUE, credit: 100 }));
  });

  it('payment refund reverses the original payment posting', async () => {
    const { svc, reversed, posting } = make({
      basis: 'CASH',
      payment: { id: 'p1', businessId: 'b1' },
      existingFinancialTx: { id: 'txn-orig', status: 'POSTED' },
    });
    await svc.onPaymentRefunded('p1');
    expect(posting.reverse).toHaveBeenCalledTimes(1);
    expect(reversed[0]).toEqual({ businessId: 'b1', transactionId: 'txn-orig' });
  });

  it('refund replay against an already-reversed txn is a no-op', async () => {
    const { svc, reversed, posting } = make({
      basis: 'CASH',
      payment: { id: 'p1', businessId: 'b1' },
      existingFinancialTx: { id: 'txn-orig', status: 'REVERSED' },
    });
    const res = await svc.onPaymentRefunded('p1');
    expect((res as { alreadyPosted?: boolean })?.alreadyPosted).toBe(true);
    expect(posting.reverse).not.toHaveBeenCalled();
    expect(reversed).toHaveLength(0);
  });

  it('invoice void reverses the finalized accrual posting', async () => {
    const { svc, reversed, posting } = make({
      basis: 'ACCRUAL',
      invoice: { id: 'inv1', businessId: 'b1' },
      existingFinancialTx: { id: 'txn-fin', status: 'POSTED' },
    });
    await svc.onInvoiceVoided('inv1');
    expect(posting.reverse).toHaveBeenCalledTimes(1);
    expect(reversed[0]).toEqual({ businessId: 'b1', transactionId: 'txn-fin' });
  });
});
