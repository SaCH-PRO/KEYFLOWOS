import { describe, it, expect, vi } from 'vitest';
import { RevenuePostingService } from '../src/modules/finance/revenue-posting.service';

/**
 * FIN2 — end-to-end ledger flow:
 *   Invoice finalized -> partial payment -> partial payment -> refund.
 *
 * Drives the recipes through an in-memory ledger so we can assert net
 * balances on AR / Revenue / Cash after every step. The recipes are the
 * single owner of source-event -> ledger mapping; this test pins the
 * round-trip semantics that matter for accounting correctness.
 */

type Entry = { accountId: string; debit: number; credit: number };
type Txn = { id: string; status: 'POSTED' | 'REVERSED'; entries: Entry[]; externalRef: string };

const ACC = {
  AR: 'acc-ar',
  ACCOUNTS_RECEIVABLE: 'acc-ar',
  REVENUE: 'acc-rev',
  REVENUE_SERVICE: 'acc-rev-svc',
  REVENUE_PRODUCT: 'acc-rev-prod',
  CASH: 'acc-cash',
  BANK: 'acc-bank',
  PAYMENT_PROCESSOR: 'acc-pp',
  EXPENSE_BANK_FEES: 'acc-fee',
} as const;

function makeHarness(opts: {
  basis: 'CASH' | 'ACCRUAL';
  invoice: any;
  payments: Record<string, any>;
}) {
  const ledger: Txn[] = [];
  const byRef = new Map<string, Txn>();

  const posting = {
    post: vi.fn(async (input: any) => {
      const externalRef = `${input.sourceType}:${input.sourceId}:${input.kind}`;
      const existing = byRef.get(externalRef);
      if (existing) {
        return { transactionId: existing.id, externalRef, alreadyPosted: true };
      }
      const txn: Txn = {
        id: `txn-${ledger.length + 1}`,
        status: 'POSTED',
        externalRef,
        entries: input.entries.map((e: any) => ({
          accountId: e.accountId,
          debit: Number(e.debit ?? 0),
          credit: Number(e.credit ?? 0),
        })),
      };
      ledger.push(txn);
      byRef.set(externalRef, txn);
      return { transactionId: txn.id, externalRef, alreadyPosted: false };
    }),
    reverse: vi.fn(async (_b: string, transactionId: string) => {
      const orig = ledger.find((t) => t.id === transactionId);
      if (!orig || orig.status === 'REVERSED') {
        return { transactionId, externalRef: orig?.externalRef ?? null, alreadyPosted: true };
      }
      orig.status = 'REVERSED';
      const rev: Txn = {
        id: `rev-${ledger.length + 1}`,
        status: 'POSTED',
        externalRef: `${orig.externalRef}:reversal`,
        entries: orig.entries.map((e) => ({
          accountId: e.accountId,
          debit: e.credit,
          credit: e.debit,
        })),
      };
      ledger.push(rev);
      return { transactionId: rev.id, externalRef: rev.externalRef, alreadyPosted: false };
    }),
  };

  const prisma = {
    client: {
      business: {
        findUnique: vi.fn().mockResolvedValue({ accountingBasis: opts.basis }),
      },
      invoice: {
        findUnique: vi.fn().mockResolvedValue(opts.invoice),
      },
      payment: {
        findUnique: vi.fn(({ where }: any) => Promise.resolve(opts.payments[where.id] ?? null)),
      },
      financialTransaction: {
        findUnique: vi.fn(({ where }: any) => {
          const ref = where?.businessId_externalRef?.externalRef;
          const t = byRef.get(ref);
          return Promise.resolve(t ? { id: t.id, status: t.status } : null);
        }),
      },
    },
  };

  const coa = {
    getBySystemKey: vi.fn(async (_b: string, key: keyof typeof ACC) => ({ id: ACC[key] })),
  };

  const timeline = { recordEvent: vi.fn() };
  const svc = new RevenuePostingService(prisma as any, posting as any, coa as any, timeline as any);
  const balance = (accountId: string) => {
    let b = 0;
    for (const t of ledger) {
      for (const e of t.entries) if (e.accountId === accountId) b += e.debit - e.credit;
    }
    return +b.toFixed(2);
  };
  return { svc, ledger, balance };
}

describe('FIN2 ledger flow — invoice → payment → partial payment → refund', () => {
  it('ACCRUAL: AR clears as payments arrive; refund re-opens AR', async () => {
    const invoiceId = 'inv1';
    const businessId = 'b1';
    const invoice = {
      id: invoiceId,
      businessId,
      contactId: 'c1',
      currency: 'USD',
      total: 200,
      issueDate: new Date('2026-01-01'),
      invoiceNumber: 'INV-1',
      status: 'SENT',
      deletedAt: null,
      items: [
        { total: 120, product: { category: 'SERVICE' } },
        { total: 80, product: { category: 'PRODUCT' } },
      ],
    };
    const p1 = {
      id: 'pay1',
      amount: 80,
      currency: 'USD',
      status: 'SUCCESSFUL',
      provider: 'cash',
      method: 'cash',
      businessId,
      invoiceId,
      processorFee: 0,
      createdAt: new Date('2026-01-02'),
      invoice: { contactId: 'c1', invoiceNumber: 'INV-1' },
    };
    const p2 = {
      id: 'pay2',
      amount: 120,
      currency: 'USD',
      status: 'SUCCESSFUL',
      provider: 'stripe',
      method: 'card',
      businessId,
      invoiceId,
      processorFee: 4,
      createdAt: new Date('2026-01-05'),
      invoice: { contactId: 'c1', invoiceNumber: 'INV-1' },
    };
    const { svc, ledger, balance } = makeHarness({
      basis: 'ACCRUAL',
      invoice,
      payments: { pay1: p1, pay2: p2 },
    });

    await svc.onInvoiceFinalized(invoiceId);
    expect(balance(ACC.AR)).toBe(200);
    expect(balance(ACC.REVENUE_SERVICE)).toBe(-120);
    expect(balance(ACC.REVENUE_PRODUCT)).toBe(-80);

    await svc.onPaymentRecorded('pay1');
    expect(balance(ACC.AR)).toBe(120);
    expect(balance(ACC.CASH)).toBe(80);

    await svc.onPaymentRecorded('pay2');
    expect(balance(ACC.AR)).toBe(0);
    expect(balance(ACC.PAYMENT_PROCESSOR)).toBe(116);
    expect(balance(ACC.EXPENSE_BANK_FEES)).toBe(4);
    expect(balance(ACC.REVENUE_SERVICE) + balance(ACC.REVENUE_PRODUCT)).toBe(-200);

    await svc.onPaymentRefunded('pay2');
    expect(balance(ACC.AR)).toBe(120);
    expect(balance(ACC.PAYMENT_PROCESSOR)).toBe(0);
    expect(balance(ACC.EXPENSE_BANK_FEES)).toBe(0);
  });

  it('CASH: revenue posts only on payment; refund reverses revenue', async () => {
    const invoiceId = 'inv2';
    const businessId = 'b2';
    const invoice = {
      id: invoiceId,
      businessId,
      contactId: 'c2',
      currency: 'USD',
      total: 100,
      issueDate: new Date('2026-02-01'),
      invoiceNumber: 'INV-2',
      status: 'SENT',
      deletedAt: null,
      items: [{ total: 100, product: { category: 'SERVICE' } }],
    };
    const pay = {
      id: 'pay3',
      amount: 100,
      currency: 'USD',
      status: 'SUCCESSFUL',
      provider: 'cash',
      method: 'cash',
      businessId,
      invoiceId,
      processorFee: 0,
      createdAt: new Date('2026-02-02'),
      invoice: { contactId: 'c2', invoiceNumber: 'INV-2' },
    };
    const { svc, balance } = makeHarness({
      basis: 'CASH',
      invoice,
      payments: { pay3: pay },
    });

    await svc.onInvoiceFinalized(invoiceId);
    expect(balance(ACC.AR)).toBe(0);
    expect(balance(ACC.REVENUE)).toBe(0);

    await svc.onPaymentRecorded('pay3');
    expect(balance(ACC.CASH)).toBe(100);
    expect(balance(ACC.REVENUE)).toBe(-100);

    await svc.onPaymentRefunded('pay3');
    expect(balance(ACC.CASH)).toBe(0);
    expect(balance(ACC.REVENUE)).toBe(0);
  });
});
