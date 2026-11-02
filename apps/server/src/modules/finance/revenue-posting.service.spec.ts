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
    type?: string;
    metadata?: unknown;
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
    partialRefunds = [],
    linkedRefund,
    linkedRows = [],
  }: {
    basis: 'CASH' | 'ACCRUAL';
    invoice?: any;
    payment?: any;
    existingFinancialTx?: any;
    /** V1-29c: earlier partial refund postings of the payment (Payment:<id>:payment_refunded:<n>, n = 1, 2, ...). */
    partialRefunds?: Array<{ id: string; amount: number; refundPaymentId: string }>;
    /** V1-29c: the newest refund row linked to the payment (what the manual refund wrote). */
    linkedRefund?: { id: string; amount: number };
    /** V1-29c review (CRR-V29C-1): every refund row linked to the payment, posted or not (negative amounts). */
    linkedRows?: Array<{ amount: number }>;
  }) {
    const posted: Posted[] = [];
    const reversed: ReverseCall[] = [];
    // Answers by key: the recording / finalized posting, or the n-th partial refund posting.
    const findTransaction = vi.fn(async ({ where }: any) => {
      const ref: string = where?.businessId_externalRef?.externalRef ?? '';
      const partial = /:payment_refunded:(\d+)$/.exec(ref);
      if (partial) {
        const p = partialRefunds[Number(partial[1]) - 1];
        return p ? { id: p.id, amount: p.amount, metadata: { refundPaymentId: p.refundPaymentId } } : null;
      }
      return existingFinancialTx ?? null;
    });
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
          findFirst: vi.fn().mockResolvedValue(linkedRefund ?? null),
          findMany: vi.fn().mockResolvedValue(linkedRows),
        },
        financialTransaction: {
          findUnique: findTransaction,
        },
        activity: {
          create: vi.fn(async ({ data }: any) => data),
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
    const timeline = { recordEvent: vi.fn().mockResolvedValue(undefined) };
    const svc = new RevenuePostingService(prisma as any, posting as any, coa as any, timeline as any);
    return { svc, posted, reversed, posting, prisma, timeline };
  }

  /** A cash-basis recording of a 100 Stripe payment with a 3 fee: Dr processor 97, Dr fee 3, Cr revenue 100. */
  const RECORDING = {
    id: 'txn-orig',
    status: 'POSTED',
    entries: [
      { accountId: ACCOUNTS.PAYMENT_PROCESSOR, debit: 97, credit: 0, account: { systemKey: 'PAYMENT_PROCESSOR' } },
      { accountId: ACCOUNTS.EXPENSE_BANK_FEES, debit: 3, credit: 0, account: { systemKey: 'EXPENSE_BANK_FEES' } },
      { accountId: ACCOUNTS.REVENUE, debit: 0, credit: 100, account: { systemKey: 'REVENUE' } },
    ],
  };
  const PAYMENT = {
    id: 'p1',
    businessId: 'b1',
    invoiceId: 'inv1',
    amount: 100,
    currency: 'TTD',
    provider: 'stripe',
    method: 'card',
    providerPaymentId: 'pi_1',
    invoice: { contactId: null, invoiceNumber: 'INV-1' },
  };

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

  it('V1-29c (BR-07): a partial refund posts a REFUND of the amount refunded (Dr the recording\'s credit account / Cr its deposit account); the recording is not reversed', async () => {
    const { svc, posted, posting } = make({ basis: 'CASH', payment: PAYMENT, existingFinancialTx: RECORDING });
    await svc.onPaymentRefunded('p1', { refund: { paymentId: 'r1', amount: 40 } });
    expect(posting.reverse).not.toHaveBeenCalled();
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ type: 'REFUND', amount: 40, sourceType: 'Payment', sourceId: 'p1', kind: 'payment_refunded:1', metadata: { refundPaymentId: 'r1' } });
    expect(posted[0]!.entries).toEqual([
      expect.objectContaining({ accountId: ACCOUNTS.REVENUE, debit: 40 }),
      expect.objectContaining({ accountId: ACCOUNTS.PAYMENT_PROCESSOR, credit: 40 }),
    ]);
  });

  it('V1-29c (BR-07): the second partial refund is numbered after the first; the refund that leaves nothing reverses the recording once and reverses each partial refund posting (review CRR-V29C-2: no ADJUSTMENT folding them back)', async () => {
    const second = make({ basis: 'CASH', payment: PAYMENT, existingFinancialTx: RECORDING, partialRefunds: [{ id: 'rf-1', amount: 30, refundPaymentId: 'r1' }] });
    await second.svc.onPaymentRefunded('p1', { refund: { paymentId: 'r2', amount: 20 } });
    expect(second.posted.map((p) => [p.type, p.kind, p.amount])).toEqual([['REFUND', 'payment_refunded:2', 20]]);

    const last = make({
      basis: 'CASH',
      payment: PAYMENT,
      existingFinancialTx: RECORDING,
      partialRefunds: [{ id: 'rf-1', amount: 30, refundPaymentId: 'r1' }, { id: 'rf-2', amount: 20, refundPaymentId: 'r2' }],
    });
    await last.svc.onPaymentRefunded('p1', { refund: { paymentId: 'r3', amount: 50 } });
    expect(last.reversed).toEqual([
      { businessId: 'b1', transactionId: 'txn-orig' },
      { businessId: 'b1', transactionId: 'rf-1' },
      { businessId: 'b1', transactionId: 'rf-2' },
    ]);
    expect(last.posted).toHaveLength(0);
    const audit = last.timeline.recordEvent.mock.calls[0]![0];
    expect(audit.data).toMatchObject({ amount: 50, ledgerReversed: true, ledgerPartialRefundsReversed: 2 });
  });

  it('V1-29c review (CRR-V29C-1): whether a refund completes the payment is read from its linked refund rows, posted or not: after an unposted -30 row (payments-ops refundCharge), the refund of 70 reverses the recording instead of posting a partial', async () => {
    const { svc, posted, reversed, prisma } = make({
      basis: 'CASH',
      payment: PAYMENT,
      existingFinancialTx: RECORDING,
      linkedRows: [{ amount: -30 }, { amount: -70 }],
    });
    await svc.onPaymentRefunded('p1', { refund: { paymentId: 'r2', amount: 70 } });
    expect(posted).toHaveLength(0);
    expect(reversed).toEqual([{ businessId: 'b1', transactionId: 'txn-orig' }]);
    expect(prisma.client.payment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ businessId: 'b1', invoiceId: 'inv1', reference: 'pi_1', status: 'REFUNDED', amount: { lt: 0 } }),
      }),
    );

    // Linked rows below the payment: a partial is posted for this refund's amount only.
    const partial = make({ basis: 'CASH', payment: PAYMENT, existingFinancialTx: RECORDING, linkedRows: [{ amount: -30 }, { amount: -20 }] });
    await partial.svc.onPaymentRefunded('p1', { refund: { paymentId: 'r2', amount: 20 } });
    expect(partial.reversed).toHaveLength(0);
    expect(partial.posted.map((p) => [p.type, p.kind, p.amount])).toEqual([['REFUND', 'payment_refunded:1', 20]]);
  });

  it('V1-29c: a refund already posted under its refund row is not posted again', async () => {
    const { svc, posted, posting } = make({ basis: 'CASH', payment: PAYMENT, existingFinancialTx: RECORDING, partialRefunds: [{ id: 'rf-1', amount: 30, refundPaymentId: 'r1' }] });
    const res = await svc.onPaymentRefunded('p1', { refund: { paymentId: 'r1', amount: 30 } });
    expect(res).toMatchObject({ transactionId: 'rf-1', alreadyPosted: true });
    expect(posted).toHaveLength(0);
    expect(posting.reverse).not.toHaveBeenCalled();
  });

  it('V1-29c: a call that names no refund refunds all that is left: the recording reversed and the partials reversed', async () => {
    const { svc, posted, reversed } = make({ basis: 'CASH', payment: PAYMENT, existingFinancialTx: RECORDING, partialRefunds: [{ id: 'rf-1', amount: 40, refundPaymentId: 'r1' }] });
    await svc.onPaymentRefunded('p1');
    expect(reversed.map((r) => r.transactionId)).toEqual(['txn-orig', 'rf-1']);
    expect(posted).toHaveLength(0);
  });

  it('V1-29c (SEC-V29-2): the manual refund (auditInTransaction) posts and audits the refund row it wrote: amount 60 of a 100 payment after a posted partial of 40 completes it', async () => {
    const { svc, prisma, reversed, posted } = make({
      basis: 'CASH',
      payment: PAYMENT,
      existingFinancialTx: RECORDING,
      partialRefunds: [{ id: 'rf-1', amount: 40, refundPaymentId: 'r1' }],
      linkedRefund: { id: 'r-manual', amount: -60 },
    });
    await svc.onPaymentRefunded('p1', { auditInTransaction: true, createdById: 'u1' });
    expect(reversed.map((r) => r.transactionId)).toEqual(['txn-orig', 'rf-1']);
    expect(posted).toHaveLength(0);
    expect(prisma.client.payment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ reference: 'pi_1', status: 'REFUNDED', amount: { lt: 0 } }) }),
    );
    const audit = prisma.client.activity.create.mock.calls[0]![0].data;
    expect(audit.data).toMatchObject({ amount: 60, paymentAmount: 100, refundPaymentId: 'r-manual', ledgerReversed: true, ledgerPartialRefundsReversed: 1, refundedBy: 'u1' });
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
