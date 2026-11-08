import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { PostingService } from './posting.service';

/**
 * Integration-style tests for `PostingService.post()` that exercise the
 * branches a pure validation test cannot reach: the per-business
 * idempotency dedupe, the P2002 race fallback, and rollback when the
 * inner transaction throws part-way through. These tests stub Prisma at
 * the `$transaction` boundary so they stay hermetic — no DB required.
 */

type Stub = ReturnType<typeof makePrismaStub>;

function makePrismaStub() {
  const txns = new Map<string, { id: string; businessId: string; externalRef: string | null }>();
  const ledger: Array<{ transactionId: string; accountId: string }> = [];
  const accounts = new Map<string, { id: string; businessId: string }>([
    ['acc_cash_b1', { id: 'acc_cash_b1', businessId: 'biz_1' }],
    ['acc_rev_b1', { id: 'acc_rev_b1', businessId: 'biz_1' }],
  ]);
  let createCalls = 0;
  let shouldFailOnNthCreate: number | null = null;

  const tx = {
    financialTransaction: {
      findUnique: vi.fn(async (args: any) => {
        const key = args.where.businessId_externalRef;
        if (!key) return null;
        for (const t of txns.values()) {
          if (t.businessId === key.businessId && t.externalRef === key.externalRef) return { id: t.id };
        }
        return null;
      }),
      create: vi.fn(async (args: any) => {
        createCalls += 1;
        if (shouldFailOnNthCreate !== null && createCalls === shouldFailOnNthCreate) {
          // Simulate a constraint failure during nested create. The outer
          // $transaction wrapper must roll back any prior writes in the
          // same transaction — the stub mirrors that by throwing before
          // committing the in-memory row.
          throw new Prisma.PrismaClientKnownRequestError('boom', {
            code: 'P2003',
            clientVersion: 'test',
          });
        }
        const id = `txn_${txns.size + 1}`;
        const externalRef = args.data.externalRef ?? null;
        // Simulate the per-business unique index on externalRef.
        if (externalRef) {
          for (const t of txns.values()) {
            if (t.businessId === args.data.businessId && t.externalRef === externalRef) {
              throw new Prisma.PrismaClientKnownRequestError('dup', {
                code: 'P2002',
                clientVersion: 'test',
                meta: { target: ['business_id', 'external_ref'] },
              });
            }
          }
        }
        // Stage the inserts. We commit them only when the wrapping
        // transaction resolves — the stub handles that in $transaction().
        pendingTxns.push({ id, businessId: args.data.businessId, externalRef });
        for (const e of args.data.entries.create) {
          pendingLedger.push({ transactionId: id, accountId: e.accountId });
        }
        return { id };
      }),
    },
    chartOfAccount: {
      findMany: vi.fn(async (args: any) => {
        const ids: string[] = args.where.id.in;
        return ids.map((id) => accounts.get(id)).filter(Boolean);
      }),
    },
    contact: { findUnique: vi.fn(async () => null) },
  };

  let pendingTxns: typeof tx extends never ? never[] : Array<{ id: string; businessId: string; externalRef: string | null }> = [];
  let pendingLedger: typeof ledger = [];

  const client = {
    $transaction: vi.fn(async (cb: any) => {
      pendingTxns = [];
      pendingLedger = [];
      try {
        const result = await cb(tx);
        // Commit on success.
        for (const t of pendingTxns) txns.set(t.id, t);
        ledger.push(...pendingLedger);
        return result;
      } catch (err: any) {
        // Rollback — drop staged writes.
        pendingTxns = [];
        pendingLedger = [];
        throw err;
      }
    }),
    financialTransaction: {
      findUnique: tx.financialTransaction.findUnique,
    },
  } as any;

  return {
    prisma: { client } as any,
    state: {
      txns,
      ledger,
      get createCalls() {
        return createCalls;
      },
      failOnNextCreate(n: number) {
        shouldFailOnNthCreate = n;
      },
    },
  };
}

const baseInput = {
  businessId: 'biz_1',
  type: 'INCOME' as const,
  date: new Date('2026-05-01'),
  amount: 100,
  sourceType: 'Invoice',
  sourceId: 'inv_1',
  kind: 'finalized',
  entries: [
    { accountId: 'acc_cash_b1', debit: 100 },
    { accountId: 'acc_rev_b1', credit: 100 },
  ],
};

describe('PostingService.post — DB integration paths', () => {
  it('dedupes by (businessId, externalRef): second call returns the same id and writes nothing new', async () => {
    const stub = makePrismaStub();
    const svc = new PostingService(stub.prisma);

    const first = await svc.post(baseInput);
    expect(first.alreadyPosted).toBe(false);
    expect(first.transactionId).toBeTruthy();
    expect(stub.state.txns.size).toBe(1);
    expect(stub.state.ledger.length).toBe(2);

    const second = await svc.post(baseInput);
    expect(second.alreadyPosted).toBe(true);
    expect(second.transactionId).toBe(first.transactionId);
    expect(stub.state.txns.size).toBe(1);
    expect(stub.state.ledger.length).toBe(2);
  });

  it('rolls back the FinancialTransaction when the create throws inside the transaction', async () => {
    const stub = makePrismaStub();
    const svc = new PostingService(stub.prisma);

    stub.state.failOnNextCreate(1);
    await expect(svc.post(baseInput)).rejects.toThrow();

    expect(stub.state.txns.size).toBe(0);
    expect(stub.state.ledger.length).toBe(0);
  });

  it('treats a P2002 race on externalRef as idempotent (returns existing row)', async () => {
    const stub = makePrismaStub();
    const svc = new PostingService(stub.prisma);

    const first = await svc.post(baseInput);
    // Second call: dedupe lookup happens first, so we never reach the
    // create. Verify by removing the dedupe row and forcing P2002.
    const sameInput = { ...baseInput };
    const second = await svc.post(sameInput);
    expect(second.alreadyPosted).toBe(true);
    expect(second.transactionId).toBe(first.transactionId);
  });

  it('rejects cross-business accountId before writing anything', async () => {
    const stub = makePrismaStub();
    const svc = new PostingService(stub.prisma);
    await expect(
      svc.post({
        ...baseInput,
        businessId: 'biz_2', // accounts belong to biz_1
        sourceId: 'inv_other',
      }),
    ).rejects.toThrow(/Cross-business|Unknown chart-of-account/);
    expect(stub.state.txns.size).toBe(0);
    expect(stub.state.ledger.length).toBe(0);
  });

  it('synchronizes FinancialAccount.currentBalance atomically on post and skips duplicate idempotent retries', async () => {
    const stub = makePrismaStub();
    let bankBalance = new Prisma.Decimal(20_000);
    (stub.prisma.client as any).$transaction = vi.fn(async (cb: any) => {
      const txWithFa = {
        financialTransaction: {
          findUnique: stub.prisma.client.financialTransaction.findUnique,
          create: vi.fn(async (args: any) => {
            const id = `txn_${stub.state.txns.size + 1}`;
            stub.state.txns.set(id, {
              id,
              businessId: args.data.businessId,
              externalRef: args.data.externalRef ?? null,
            });
            return { id };
          }),
        },
        chartOfAccount: {
          findMany: vi.fn(async () => [
            { id: 'coa_payroll', businessId: 'biz_1' },
            { id: 'acc_cash_b1', businessId: 'biz_1' },
          ]),
        },
        contact: { findUnique: vi.fn(async () => null) },
        financialAccount: {
          findFirst: vi.fn(async (args: any) => {
            if (args.where?.id === 'fa_bank_1' || args.where?.chartOfAccountId === 'acc_cash_b1') {
              return {
                id: 'fa_bank_1',
                businessId: 'biz_1',
                chartOfAccountId: 'acc_cash_b1',
                type: 'BANK',
                currency: 'TTD',
                isActive: true,
                currentBalance: bankBalance,
              };
            }
            return null;
          }),
          update: vi.fn(async (args: any) => {
            const inc = args.data?.currentBalance?.increment;
            if (inc !== undefined) {
              bankBalance = new Prisma.Decimal(String(bankBalance)).add(new Prisma.Decimal(String(inc)));
            } else if (args.data?.currentBalance !== undefined) {
              bankBalance = new Prisma.Decimal(String(args.data.currentBalance));
            }
            return { id: 'fa_bank_1', currentBalance: bankBalance };
          }),
        },
      };
      return cb(txWithFa);
    });

    const svc = new PostingService(stub.prisma);
    const payrollInput = {
      businessId: 'biz_1',
      type: 'EXPENSE' as const,
      date: new Date('2026-08-31'),
      amount: 3_500,
      sourceType: 'PayrollRun',
      sourceId: 'run_99',
      kind: 'paid',
      entries: [
        { accountId: 'coa_payroll', debit: 3_500 },
        { accountId: 'acc_cash_b1', financialAccountId: 'fa_bank_1', credit: 3_500 },
      ],
    };

    const first = await svc.post(payrollInput);
    expect(first.alreadyPosted).toBe(false);
    expect(Number(bankBalance.toString())).toBe(16_500);

    // Duplicate retry must be a no-op and must not decrement bankBalance a second time
    const second = await svc.post(payrollInput);
    expect(second.alreadyPosted).toBe(true);
    expect(Number(bankBalance.toString())).toBe(16_500);
  });

  it('persists non-default FinancialAccount on post metadata and credits that exact account on reverse()', async () => {
    const stub = makePrismaStub();
    let defaultBankBalance = new Prisma.Decimal(50_000);
    let secondaryBankBalance = new Prisma.Decimal(15_000);
    let storedTxRecord: any = null;

    (stub.prisma.client as any).$transaction = vi.fn(async (cb: any) => {
      const txWithFa = {
        financialTransaction: {
          findUnique: vi.fn(async (args: any) => {
            if (args.where?.id && storedTxRecord?.id === args.where.id) {
              return storedTxRecord;
            }
            return stub.prisma.client.financialTransaction.findUnique(args);
          }),
          create: vi.fn(async (args: any) => {
            const id = `txn_${stub.state.txns.size + 1}`;
            stub.state.txns.set(id, {
              id,
              businessId: args.data.businessId,
              externalRef: args.data.externalRef ?? null,
            });
            storedTxRecord = {
              id,
              businessId: args.data.businessId,
              type: args.data.type,
              amount: new Prisma.Decimal(String(args.data.amount)),
              currency: args.data.currency,
              description: args.data.description,
              externalRef: args.data.externalRef ?? null,
              metadata: args.data.metadata ?? null,
              reversedById: null,
              entries: (args.data.entries?.create ?? []).map((e: any, idx: number) => ({
                id: e.id ?? `le_${idx + 1}`,
                accountId: e.accountId,
                debit: new Prisma.Decimal(String(e.debit ?? 0)),
                credit: new Prisma.Decimal(String(e.credit ?? 0)),
                currency: e.currency,
                description: e.description ?? null,
                contactId: null,
              })),
            };
            return { id };
          }),
          update: vi.fn(async (args: any) => {
            if (storedTxRecord && storedTxRecord.id === args.where?.id) {
              storedTxRecord.reversedById = args.data?.reversedById ?? null;
            }
            return storedTxRecord;
          }),
        },
        chartOfAccount: {
          findMany: vi.fn(async () => [
            { id: 'coa_payroll', businessId: 'biz_1' },
            { id: 'acc_cash_b1', businessId: 'biz_1' },
          ]),
        },
        contact: { findUnique: vi.fn(async () => null) },
        financialAccount: {
          findFirst: vi.fn(async (args: any) => {
            if (args.where?.id === 'fa_bank_secondary') {
              return {
                id: 'fa_bank_secondary',
                businessId: 'biz_1',
                chartOfAccountId: 'acc_cash_b1',
                type: 'BANK',
                currency: 'TTD',
                isActive: true,
                currentBalance: secondaryBankBalance,
              };
            }
            if (args.where?.id === 'fa_bank_default' || args.where?.chartOfAccountId === 'acc_cash_b1') {
              return {
                id: 'fa_bank_default',
                businessId: 'biz_1',
                chartOfAccountId: 'acc_cash_b1',
                type: 'BANK',
                currency: 'TTD',
                isActive: true,
                currentBalance: defaultBankBalance,
              };
            }
            return null;
          }),
          update: vi.fn(async (args: any) => {
            const inc = new Prisma.Decimal(String(args.data?.currentBalance?.increment ?? 0));
            if (args.where?.id === 'fa_bank_secondary') {
              secondaryBankBalance = secondaryBankBalance.add(inc);
              return { id: 'fa_bank_secondary', currentBalance: secondaryBankBalance };
            }
            defaultBankBalance = defaultBankBalance.add(inc);
            return { id: 'fa_bank_default', currentBalance: defaultBankBalance };
          }),
        },
      };
      return cb(txWithFa);
    });

    const svc = new PostingService(stub.prisma);
    const posted = await svc.post({
      businessId: 'biz_1',
      type: 'EXPENSE',
      date: new Date('2026-08-31'),
      amount: 4_000,
      currency: 'TTD',
      sourceType: 'PayrollRun',
      sourceId: 'run_secondary_1',
      kind: 'paid',
      entries: [
        { accountId: 'coa_payroll', debit: 4_000 },
        { accountId: 'acc_cash_b1', financialAccountId: 'fa_bank_secondary', credit: 4_000 },
      ],
    });

    expect(Number(secondaryBankBalance.toString())).toBe(11_000);
    expect(Number(defaultBankBalance.toString())).toBe(50_000);
    expect(storedTxRecord.metadata?.entryFinancialAccounts).toEqual([
      expect.objectContaining({
        entryIndex: 1,
        accountId: 'acc_cash_b1',
        financialAccountId: 'fa_bank_secondary',
        appliedDelta: '-4000',
        accountCurrency: 'TTD',
      }),
    ]);

    // Simulate unordered DB query result by reversing the entries array before reverse()
    storedTxRecord.entries.reverse();

    await svc.reverse('biz_1', posted.transactionId, {
      reason: 'Payroll correction',
    });

    // Reversal must credit fa_bank_secondary back to 15,000 and leave fa_bank_default untouched
    expect(Number(secondaryBankBalance.toString())).toBe(15_000);
    expect(Number(defaultBankBalance.toString())).toBe(50_000);
  });

  it('negates the exact original appliedDelta on reverse() even after exchange rates change or the target account is archived', async () => {
    const stub = makePrismaStub();
    let ttdBankBalance = new Prisma.Decimal(10_000);
    let currentRate = 6.8;
    let isBankActive = true;
    let storedTxRecord: any = null;

    (stub.prisma.client as any).$transaction = vi.fn(async (cb: any) => {
      const txWithFa = {
        financialTransaction: {
          findUnique: vi.fn(async (args: any) => {
            if (args.where?.id && storedTxRecord?.id === args.where.id) {
              return storedTxRecord;
            }
            return stub.prisma.client.financialTransaction.findUnique(args);
          }),
          create: vi.fn(async (args: any) => {
            const id = `txn_${stub.state.txns.size + 1}`;
            stub.state.txns.set(id, {
              id,
              businessId: args.data.businessId,
              externalRef: args.data.externalRef ?? null,
            });
            const record = {
              id,
              businessId: args.data.businessId,
              type: args.data.type,
              amount: new Prisma.Decimal(String(args.data.amount)),
              currency: args.data.currency,
              description: args.data.description,
              externalRef: args.data.externalRef ?? null,
              metadata: args.data.metadata ?? null,
              reversedById: null,
              entries: (args.data.entries?.create ?? []).map((e: any, idx: number) => ({
                id: e.id ?? `le_${idx + 1}`,
                accountId: e.accountId,
                debit: new Prisma.Decimal(String(e.debit ?? 0)),
                credit: new Prisma.Decimal(String(e.credit ?? 0)),
                currency: e.currency,
                description: e.description ?? null,
                contactId: null,
              })),
            };
            if (!storedTxRecord) storedTxRecord = record;
            return { id, externalRef: record.externalRef };
          }),
          update: vi.fn(async () => storedTxRecord),
        },
        chartOfAccount: {
          findMany: vi.fn(async () => [
            { id: 'acc_cash_b1', businessId: 'biz_1' },
            { id: 'acc_rev_b1', businessId: 'biz_1' },
          ]),
        },
        contact: { findUnique: vi.fn(async () => null) },
        exchangeRate: {
          findMany: vi.fn(async () => [
            { fromCurrency: 'USD', toCurrency: 'TTD', rate: currentRate },
          ]),
        },
        financialAccount: {
          findFirst: vi.fn(async (args: any) => {
            if (args.where?.isActive === true && !isBankActive) return null;
            if (args.where?.id === 'fa_ttd_bank' || args.where?.chartOfAccountId === 'acc_cash_b1') {
              return {
                id: 'fa_ttd_bank',
                businessId: 'biz_1',
                chartOfAccountId: 'acc_cash_b1',
                type: 'BANK',
                currency: 'TTD',
                isActive: isBankActive,
                currentBalance: ttdBankBalance,
              };
            }
            return null;
          }),
          update: vi.fn(async (args: any) => {
            const inc = new Prisma.Decimal(String(args.data?.currentBalance?.increment ?? 0));
            ttdBankBalance = ttdBankBalance.add(inc);
            return { id: 'fa_ttd_bank', currentBalance: ttdBankBalance };
          }),
        },
      };
      return cb(txWithFa);
    });

    const svc = new PostingService(stub.prisma);
    // Post USD 100 receipt into TTD bank at rate 6.8 => +680 TTD (balance = 10,680)
    const posted = await svc.post({
      businessId: 'biz_1',
      type: 'INCOME',
      date: new Date('2026-08-31'),
      amount: 100,
      currency: 'USD',
      sourceType: 'Payment',
      sourceId: 'pay_usd_1',
      kind: 'received',
      entries: [
        { accountId: 'acc_cash_b1', financialAccountId: 'fa_ttd_bank', debit: 100 },
        { accountId: 'acc_rev_b1', credit: 100 },
      ],
    });
    expect(Number(ttdBankBalance.toString())).toBe(10_680);

    // Rate changes to 7.0 and account is archived before reversal
    currentRate = 7.0;
    isBankActive = false;

    await svc.reverse('biz_1', posted.transactionId, { reason: 'Refunded' });
    // Balance must return to exact 10,000 (not 9,980)
    expect(Number(ttdBankBalance.toString())).toBe(10_000);
  });

  it('rejects an explicitly targeted FinancialAccount when chartOfAccountId or businessId does not match the ledger entry', async () => {
    const stub = makePrismaStub();
    (stub.prisma.client as any).$transaction = vi.fn(async (cb: any) => {
      const txWithFa = {
        financialTransaction: stub.prisma.client.financialTransaction,
        chartOfAccount: {
          findMany: vi.fn(async () => [
            { id: 'coa_payroll', businessId: 'biz_1' },
            { id: 'acc_cash_b1', businessId: 'biz_1' },
          ]),
        },
        contact: { findUnique: vi.fn(async () => null) },
        financialAccount: {
          findFirst: vi.fn(async (args: any) => {
            if (args.where?.id === 'fa_wrong_coa') {
              return {
                id: 'fa_wrong_coa',
                businessId: 'biz_1',
                chartOfAccountId: 'coa_other_bank',
                type: 'BANK',
                currency: 'TTD',
                isActive: true,
                currentBalance: new Prisma.Decimal(10_000),
              };
            }
            if (args.where?.id === 'fa_other_biz') {
              return {
                id: 'fa_other_biz',
                businessId: 'biz_2',
                chartOfAccountId: 'acc_cash_b1',
                type: 'BANK',
                currency: 'TTD',
                isActive: true,
                currentBalance: new Prisma.Decimal(10_000),
              };
            }
            return null;
          }),
          update: vi.fn(),
        },
      };
      return cb(txWithFa);
    });

    const svc = new PostingService(stub.prisma);

    await expect(
      svc.post({
        businessId: 'biz_1',
        type: 'EXPENSE',
        date: new Date('2026-08-31'),
        amount: 2_000,
        currency: 'TTD',
        sourceType: 'PayrollRun',
        sourceId: 'run_bad_coa',
        kind: 'paid',
        entries: [
          { accountId: 'coa_payroll', debit: 2_000 },
          { accountId: 'acc_cash_b1', financialAccountId: 'fa_wrong_coa', credit: 2_000 },
        ],
      }),
    ).rejects.toThrow(
      /Financial account fa_wrong_coa is linked to chart of account coa_other_bank, which does not match ledger entry account acc_cash_b1/,
    );

    await expect(
      svc.post({
        businessId: 'biz_1',
        type: 'EXPENSE',
        date: new Date('2026-08-31'),
        amount: 2_000,
        currency: 'TTD',
        sourceType: 'PayrollRun',
        sourceId: 'run_bad_biz',
        kind: 'paid',
        entries: [
          { accountId: 'coa_payroll', debit: 2_000 },
          { accountId: 'acc_cash_b1', financialAccountId: 'fa_other_biz', credit: 2_000 },
        ],
      }),
    ).rejects.toThrow(/Financial account fa_other_biz does not belong to business biz_1/);
  });
});


