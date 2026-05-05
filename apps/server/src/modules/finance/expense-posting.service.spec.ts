import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ExpensePostingService, paymentMethodToCoaSystemKey } from './expense-posting.service';

/**
 * FIN3 — Hermetic stub-based tests for the expense-posting recipes.
 * Verify each recipe routes the right amounts to the right COA system
 * keys (the actual ledger write is owned by PostingService and is
 * covered by posting.service.integration.spec.ts).
 */

function makeStubs() {
  const coaByKey: Record<string, { id: string }> = {
    CASH: { id: 'coa_cash' },
    BANK: { id: 'coa_bank' },
    CREDIT_CARD: { id: 'coa_card' },
    PAYMENT_PROCESSOR: { id: 'coa_proc' },
    ACCOUNTS_PAYABLE: { id: 'coa_ap' },
    INVENTORY_ASSET: { id: 'coa_inv' },
    COGS: { id: 'coa_cogs' },
    EXPENSE_GENERAL: { id: 'coa_exp_gen' },
    EXPENSE_OTHER: { id: 'coa_exp_other' },
    EXPENSE_MARKETING: { id: 'coa_exp_mkt' },
  };
  const coa = {
    getBySystemKey: vi.fn(async (_b: string, key: string) => coaByKey[key] ?? null),
    ensureDefaults: vi.fn(async () => undefined),
  } as any;
  const posting = { post: vi.fn(async (input: any) => ({ transactionId: 'tx_1', externalRef: 'r', alreadyPosted: false, _input: input })) } as any;
  const prisma = {
    client: {
      expenseCategory: { findUnique: vi.fn(async () => ({ businessId: 'biz_1', chartOfAccountId: 'coa_exp_mkt' })) },
      inventoryStock: {
        findMany: vi.fn(async () => [
          { productId: 'p1', costPerUnit: 10, quantity: 5 },
          { productId: 'p1', costPerUnit: 14, quantity: 5 },
          { productId: 'p2', costPerUnit: null, quantity: 7 },
        ]),
      },
    },
  } as any;
  return { prisma, posting, coa, svc: new ExpensePostingService(prisma, posting, coa) };
}

const baseExpense = {
  id: 'exp_1',
  businessId: 'biz_1',
  amount: 100,
  currency: 'TTD',
  date: new Date('2026-05-01'),
  categoryId: 'cat_1',
  paymentMethod: 'cash',
  description: 'Office supplies',
  contactId: null as string | null,
  vendor: 'Acme Stationers',
};

describe('paymentMethodToCoaSystemKey', () => {
  it('maps common variants', () => {
    expect(paymentMethodToCoaSystemKey('cash')).toBe('CASH');
    expect(paymentMethodToCoaSystemKey('bank_transfer')).toBe('BANK');
    expect(paymentMethodToCoaSystemKey('cheque')).toBe('BANK');
    expect(paymentMethodToCoaSystemKey('credit_card')).toBe('CREDIT_CARD');
    expect(paymentMethodToCoaSystemKey('stripe')).toBe('PAYMENT_PROCESSOR');
    expect(paymentMethodToCoaSystemKey('  ')).toBe('CASH');
    expect(paymentMethodToCoaSystemKey(undefined)).toBe('CASH');
    expect(paymentMethodToCoaSystemKey('mystery')).toBe('CASH');
  });
});

describe('ExpensePostingService.onExpensePaid', () => {
  it('posts Dr Expense / Cr Cash for a paid expense', async () => {
    const { svc, posting } = makeStubs();
    await svc.onExpensePaid(baseExpense);
    expect(posting.post).toHaveBeenCalledOnce();
    const input = posting.post.mock.calls[0][0];
    expect(input.kind).toBe('paid');
    expect(input.sourceType).toBe('Expense');
    expect(input.entries).toHaveLength(2);
    const dr = input.entries.find((e: any) => e.debit);
    const cr = input.entries.find((e: any) => e.credit);
    expect(dr.accountId).toBe('coa_exp_mkt');
    expect(cr.accountId).toBe('coa_cash');
    expect(dr.debit).toBe(100);
    expect(cr.credit).toBe(100);
  });

  it('routes by paymentMethod -> BANK/CARD COAs', async () => {
    const { svc, posting } = makeStubs();
    await svc.onExpensePaid({ ...baseExpense, paymentMethod: 'credit_card' });
    expect(posting.post.mock.calls[0][0].entries.find((e: any) => e.credit).accountId).toBe('coa_card');
  });

  it('skips zero-amount expenses', async () => {
    const { svc, posting } = makeStubs();
    const r = await svc.onExpensePaid({ ...baseExpense, amount: 0 });
    expect(r).toBeNull();
    expect(posting.post).not.toHaveBeenCalled();
  });

  it('falls back to EXPENSE_OTHER when category has no COA link', async () => {
    const { svc, posting, prisma } = makeStubs();
    prisma.client.expenseCategory.findUnique = vi.fn(async () => ({ businessId: 'biz_1', chartOfAccountId: null }));
    await svc.onExpensePaid({ ...baseExpense, categoryId: 'cat_unmapped' });
    expect(posting.post.mock.calls[0][0].entries.find((e: any) => e.debit).accountId).toBe('coa_exp_other');
  });
});

describe('ExpensePostingService.onBillCreated / onBillPaid', () => {
  it('bill_created posts Dr Expense / Cr AP', async () => {
    const { svc, posting } = makeStubs();
    await svc.onBillCreated(baseExpense);
    const input = posting.post.mock.calls[0][0];
    expect(input.kind).toBe('bill_created');
    expect(input.entries.find((e: any) => e.debit).accountId).toBe('coa_exp_mkt');
    expect(input.entries.find((e: any) => e.credit).accountId).toBe('coa_ap');
  });

  it('bill_paid posts Dr AP / Cr Cash and is independent from bill_created', async () => {
    const { svc, posting } = makeStubs();
    await svc.onBillPaid({
      ...baseExpense,
      paidAt: new Date('2026-05-15'),
      paymentMethod: 'bank_transfer',
    });
    const input = posting.post.mock.calls[0][0];
    expect(input.kind).toBe('bill_paid');
    expect(input.entries.find((e: any) => e.debit).accountId).toBe('coa_ap');
    expect(input.entries.find((e: any) => e.credit).accountId).toBe('coa_bank');
  });
});

describe('ExpensePostingService.onPurchaseOrderReceived', () => {
  it('credits AP when PO is unpaid', async () => {
    const { svc, posting } = makeStubs();
    await svc.onPurchaseOrderReceived({
      id: 'po_1',
      businessId: 'biz_1',
      total: 500,
      currency: 'TTD',
      receivedAt: new Date(),
      paymentStatus: 'UNPAID',
      paymentMethod: null,
      supplierName: 'Acme',
      poNumber: 'PO-001',
    });
    const input = posting.post.mock.calls[0][0];
    expect(input.entries.find((e: any) => e.debit).accountId).toBe('coa_inv');
    expect(input.entries.find((e: any) => e.credit).accountId).toBe('coa_ap');
  });

  it('credits Cash/Bank when PO is paid', async () => {
    const { svc, posting } = makeStubs();
    await svc.onPurchaseOrderReceived({
      id: 'po_2',
      businessId: 'biz_1',
      total: 250,
      currency: 'TTD',
      receivedAt: new Date(),
      paymentStatus: 'PAID',
      paymentMethod: 'bank_transfer',
      supplierName: 'Acme',
      poNumber: 'PO-002',
    });
    expect(posting.post.mock.calls[0][0].entries.find((e: any) => e.credit).accountId).toBe('coa_bank');
  });
});

describe('ExpensePostingService.onProductSold', () => {
  it('posts Dr COGS / Cr Inventory using weighted-average cost across warehouses', async () => {
    const { svc, posting } = makeStubs();
    // p1: avg = (5*10 + 5*14) / 10 = 12, qty=2 -> 24. p2: no cost -> skipped.
    const r = await svc.onProductSold({
      businessId: 'biz_1',
      sourceType: 'Invoice',
      sourceId: 'inv_99',
      date: new Date(),
      currency: 'TTD',
      items: [
        { productId: 'p1', quantity: 2 },
        { productId: 'p2', quantity: 5 },
      ],
    });
    expect(r).not.toBeNull();
    const input = posting.post.mock.calls[0][0];
    expect(input.kind).toBe('cogs');
    const dr = input.entries.find((e: any) => e.debit);
    const cr = input.entries.find((e: any) => e.credit);
    expect(dr.accountId).toBe('coa_cogs');
    expect(cr.accountId).toBe('coa_inv');
    expect(dr.debit).toBeCloseTo(24, 4);
    expect(cr.credit).toBeCloseTo(24, 4);
  });

  it('skips silently when no priced inventory exists', async () => {
    const { svc, posting, prisma } = makeStubs();
    prisma.client.inventoryStock.findMany = vi.fn(async () => []);
    const r = await svc.onProductSold({
      businessId: 'biz_1',
      sourceType: 'Invoice',
      sourceId: 'inv_100',
      date: new Date(),
      currency: 'TTD',
      items: [{ productId: 'pX', quantity: 1 }],
    });
    expect(r).toBeNull();
    expect(posting.post).not.toHaveBeenCalled();
  });
});
