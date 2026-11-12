import { describe, expect, it, vi } from 'vitest';
import { RevenuePostingService } from './revenue-posting.service';
import { KEY_SYSTEM_ACTOR_ID } from '../../core/auth/system-actor';

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
    REVENUE_SERVICE: 'acc-rev-svc',
    REVENUE_PRODUCT: 'acc-rev-prod',
    REVENUE_PACKAGE: 'acc-rev-pkg',
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

  it('W11-KEY-REFUND-INITIATED-BY (D-90, SEC-W7KMP-1): a refund KEY records (createdById KEY_SYSTEM_ACTOR_ID) keeps the member who asked as data.initiatedBy on its payment_refunded row, KEY staying the refunder (SYSTEM) on the posting and the row', async () => {
    // The refund door's shape (PaymentsService.createRefundWithPosting for refundCharge): the row, in the transaction.
    const inTx = make({ basis: 'CASH', payment: PAYMENT, existingFinancialTx: RECORDING });
    await inTx.svc.onPaymentRefunded('p1', {
      refund: { paymentId: 'r1', amount: 40 },
      auditInTransaction: true,
      createdById: KEY_SYSTEM_ACTOR_ID,
      initiatedBy: 'member-m',
    });
    expect(inTx.posting.post).toHaveBeenCalledTimes(1);
    expect(inTx.posting.post.mock.calls[0]![0]).toMatchObject({ type: 'REFUND', createdById: KEY_SYSTEM_ACTOR_ID });
    expect(inTx.prisma.client.activity.create).toHaveBeenCalledTimes(1);
    const row = inTx.prisma.client.activity.create.mock.calls[0]![0].data;
    expect(row).toMatchObject({ module: 'FINANCE', action: 'payment_refunded', actorType: 'SYSTEM', actorId: KEY_SYSTEM_ACTOR_ID });
    expect(row.data).toMatchObject({ amount: 40, refundedBy: KEY_SYSTEM_ACTOR_ID, initiatedBy: 'member-m' });

    // The best-effort row (no auditInTransaction): the same, on the reversal of what is left.
    const best = make({ basis: 'CASH', payment: PAYMENT, existingFinancialTx: RECORDING });
    await best.svc.onPaymentRefunded('p1', { createdById: KEY_SYSTEM_ACTOR_ID, initiatedBy: 'member-m' });
    expect(best.reversed).toEqual([{ businessId: 'b1', transactionId: 'txn-orig' }]);
    const entry = best.timeline.recordEvent.mock.calls[0]![0];
    expect(entry).toMatchObject({ actorType: 'SYSTEM', actorId: KEY_SYSTEM_ACTOR_ID });
    expect(entry.data).toMatchObject({ refundedBy: KEY_SYSTEM_ACTOR_ID, initiatedBy: 'member-m' });
  });

  it('W11-KEY-REFUND-INITIATED-BY (D-90, SEC-W7KMP-1): initiatedBy is ignored beside a person refunder, and dropped when empty or a system actor itself', async () => {
    // A person (the owner's refund): USER, and initiatedBy is never kept beside a person.
    const person = make({ basis: 'CASH', payment: PAYMENT, existingFinancialTx: RECORDING });
    await person.svc.onPaymentRefunded('p1', {
      refund: { paymentId: 'r1', amount: 40 },
      auditInTransaction: true,
      createdById: 'u1',
      initiatedBy: 'member-m',
    });
    const personRow = person.prisma.client.activity.create.mock.calls[0]![0].data;
    expect(personRow).toMatchObject({ actorType: 'USER', actorId: 'u1' });
    expect(personRow.data).toMatchObject({ refundedBy: 'u1' });
    expect(personRow.data).not.toHaveProperty('initiatedBy');

    // KEY with no member, an empty one, or a system actor id (KEY itself or its aliases) as initiatedBy: none kept.
    for (const initiatedBy of [undefined, null, '', KEY_SYSTEM_ACTOR_ID, 'key_cortex', 'key-cortex']) {
      const key = make({ basis: 'CASH', payment: PAYMENT, existingFinancialTx: RECORDING });
      await key.svc.onPaymentRefunded('p1', {
        refund: { paymentId: 'r1', amount: 40 },
        auditInTransaction: true,
        createdById: KEY_SYSTEM_ACTOR_ID,
        initiatedBy,
      });
      const row = key.prisma.client.activity.create.mock.calls[0]![0].data;
      expect(row, String(initiatedBy)).toMatchObject({ actorType: 'SYSTEM', actorId: KEY_SYSTEM_ACTOR_ID });
      expect(row.data, String(initiatedBy)).not.toHaveProperty('initiatedBy');
    }

    // No refunder at all (a provider event): nobody is named, initiatedBy included.
    const provider = make({ basis: 'CASH', payment: PAYMENT, existingFinancialTx: RECORDING });
    await provider.svc.onPaymentRefunded('p1', { refund: { paymentId: 'r1', amount: 40 }, initiatedBy: 'member-m' });
    const providerEntry = provider.timeline.recordEvent.mock.calls[0]![0];
    expect(providerEntry.actorId).toBeUndefined();
    expect(providerEntry.data).not.toHaveProperty('initiatedBy');
  });

  describe('V1-82 (FOLLOW3-B3): accrual recognition splits revenue by category; a net discount is apportioned, never a negative leg', () => {
    type Item = { total: number; product: { category: string } | null };
    const SVC = (total: number): Item => ({ total, product: { category: 'SERVICE' } });
    const GOODS = (total: number): Item => ({ total, product: { category: 'PRODUCT' } });
    const PKG = (total: number): Item => ({ total, product: { category: 'PACKAGE' } });

    async function finalize(total: number, items: Item[]) {
      const h = make({
        basis: 'ACCRUAL',
        invoice: {
          id: 'inv1',
          businessId: 'b1',
          contactId: null,
          currency: 'TTD',
          total,
          issueDate: new Date(),
          invoiceNumber: 'INV-1',
          status: 'SENT',
          deletedAt: null,
          items,
        },
      });
      await h.svc.onInvoiceFinalized('inv1');
      expect(h.posted).toHaveLength(1);
      return h.posted[0]!.entries.map((e): [string, number, number] => [e.accountId, Number(e.debit ?? 0), Number(e.credit ?? 0)]);
    }

    /** Every leg non-negative with one side set; debits and credits each equal the total, in integer cents. */
    function expectLegRules(rows: Array<[string, number, number]>, total: number) {
      for (const [acc, dr, cr] of rows) {
        expect(dr, `${acc} debit`).toBeGreaterThanOrEqual(0);
        expect(cr, `${acc} credit`).toBeGreaterThanOrEqual(0);
        expect((dr > 0) !== (cr > 0), `${acc}: one side`).toBe(true);
        expect(Math.round(cr * 100) / 100, `${acc} credit is a cent value`).toBe(cr);
      }
      const c = (v: number) => Math.round(v * 100);
      expect(rows.reduce((s, r) => s + c(r[1]), 0)).toBe(c(total));
      expect(rows.reduce((s, r) => s + c(r[2]), 0)).toBe(c(total));
    }

    it('RS-01 shape: svc 10 + goods 10 at PERCENT 60 (total 8) -> AR Dr 8, service Cr 4, product Cr 4 (was service Cr -2, product Cr 10)', async () => {
      const e = await finalize(8, [SVC(10), GOODS(10)]);
      expect(e).toEqual([
        [ACCOUNTS.ACCOUNTS_RECEIVABLE, 8, 0],
        [ACCOUNTS.REVENUE_SERVICE, 0, 4],
        [ACCOUNTS.REVENUE_PRODUCT, 0, 4],
      ]);
      expectLegRules(e, 8);
    });

    it('RS-03 shape: svc 10 + goods 5 with FIXED 12 (total 3) -> credits 2 and 1, pro rata', async () => {
      const e = await finalize(3, [SVC(10), GOODS(5)]);
      expect(e).toEqual([
        [ACCOUNTS.ACCOUNTS_RECEIVABLE, 3, 0],
        [ACCOUNTS.REVENUE_SERVICE, 0, 2],
        [ACCOUNTS.REVENUE_PRODUCT, 0, 1],
      ]);
      expectLegRules(e, 3);
    });

    it('RS-04 shape: svc 1 + goods 1 + package 1 with FIXED 2 (total 1) -> 0.34 / 0.33 / 0.33: the leftover cent to the largest remainder, ties by split order', async () => {
      const e = await finalize(1, [SVC(1), GOODS(1), PKG(1)]);
      expect(e).toEqual([
        [ACCOUNTS.ACCOUNTS_RECEIVABLE, 1, 0],
        [ACCOUNTS.REVENUE_SERVICE, 0, 0.34],
        [ACCOUNTS.REVENUE_PRODUCT, 0, 0.33],
        [ACCOUNTS.REVENUE_PACKAGE, 0, 0.33],
      ]);
      expectLegRules(e, 1);
      // Split order decides a tie: the first split takes the cent.
      const reordered = await finalize(1, [PKG(1), SVC(1), GOODS(1)]);
      expect(reordered).toEqual([
        [ACCOUNTS.ACCOUNTS_RECEIVABLE, 1, 0],
        [ACCOUNTS.REVENUE_PACKAGE, 0, 0.34],
        [ACCOUNTS.REVENUE_SERVICE, 0, 0.33],
        [ACCOUNTS.REVENUE_PRODUCT, 0, 0.33],
      ]);
    });

    it('largest remainder: the leftover cents go to the largest fractional shares, not the largest split', async () => {
      // Total 0.55 over svc 0.40 / goods 0.35 / pkg 0.25: exact shares 22 / 19.25 / 13.75 cents -> floors 22 / 19 / 13
      // (54 cents); the one cent left goes to pkg (remainder .75), not to svc, the largest split.
      const e = await finalize(0.55, [SVC(0.4), GOODS(0.35), PKG(0.25)]);
      expect(e).toEqual([
        [ACCOUNTS.ACCOUNTS_RECEIVABLE, 0.55, 0],
        [ACCOUNTS.REVENUE_SERVICE, 0, 0.22],
        [ACCOUNTS.REVENUE_PRODUCT, 0, 0.19],
        [ACCOUNTS.REVENUE_PACKAGE, 0, 0.14],
      ]);
      expectLegRules(e, 0.55);
    });

    it('a split whose apportioned share is zero cents posts no leg (a zero leg is refused by validatePosting)', async () => {
      // svc 100 + goods 0.01 at PERCENT 99 (total 1.00): goods' exact share is 0.0099 cents.
      const e = await finalize(1, [SVC(100), GOODS(0.01)]);
      expect(e).toEqual([
        [ACCOUNTS.ACCOUNTS_RECEIVABLE, 1, 0],
        [ACCOUNTS.REVENUE_SERVICE, 0, 1],
      ]);
      expectLegRules(e, 1);
    });

    it('property: 200 seeded discounted invoices of 1-3 categories post non-negative legs whose credits sum to the total in cents', async () => {
      let seed = 82;
      const rand = () => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed / 2147483648;
      };
      const makers = [SVC, GOODS, PKG];
      for (let n = 0; n < 200; n += 1) {
        const items: Item[] = [];
        const lines = 1 + Math.floor(rand() * 4);
        for (let i = 0; i < lines; i += 1) items.push(makers[Math.floor(rand() * 3)]!(1 + Math.floor(rand() * 100000) / 100));
        const subtotalCents = items.reduce((s, it) => s + Math.round(it.total * 100), 0);
        const totalCents = 1 + Math.floor(rand() * (subtotalCents - 1));
        const e = await finalize(totalCents / 100, items);
        expectLegRules(e, totalCents / 100);
      }
    });

    it('RS-05 control: one category at PERCENT 60 (svc 10 + svc 10, total 8) posts one credit equal to the total', async () => {
      const e = await finalize(8, [SVC(10), SVC(10)]);
      expect(e).toEqual([
        [ACCOUNTS.ACCOUNTS_RECEIVABLE, 8, 0],
        [ACCOUNTS.REVENUE_SERVICE, 0, 8],
      ]);
    });

    it('RS-05 control: two categories with no discount post 120 / 80', async () => {
      const e = await finalize(200, [SVC(120), GOODS(80)]);
      expect(e).toEqual([
        [ACCOUNTS.ACCOUNTS_RECEIVABLE, 200, 0],
        [ACCOUNTS.REVENUE_SERVICE, 0, 120],
        [ACCOUNTS.REVENUE_PRODUCT, 0, 80],
      ]);
    });

    it('RS-05 control: a positive drift (10% tax: svc 100, goods 50, total 165) stays on the largest split (svc 115, goods 50)', async () => {
      const e = await finalize(165, [SVC(100), GOODS(50)]);
      expect(e).toEqual([
        [ACCOUNTS.ACCOUNTS_RECEIVABLE, 165, 0],
        [ACCOUNTS.REVENUE_SERVICE, 0, 115],
        [ACCOUNTS.REVENUE_PRODUCT, 0, 50],
      ]);
    });
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
