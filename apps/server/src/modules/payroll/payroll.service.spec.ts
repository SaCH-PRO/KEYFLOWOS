import { BadRequestException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { PayrollService } from './payroll.service';

/**
 * PR195-PORT (owner PR #195 part 2): marking a payroll run paid posts the
 * disbursement to the ledger, atomically with the run's APPROVED -> PAID move.
 *
 * Head rules the port keeps (docs/reconstruction/BUILD-MAP-001.md):
 *   - V1-15: the posting goes through the one ledger door (ExpensePostingService
 *     -> PostingService.post) inside the same transaction as the run update, so
 *     a refused posting (closed period, D-13 currency, cross-business COA)
 *     leaves the run APPROVED;
 *   - the posting names its actor: the member on REST; KEY's system actor with
 *     the member it ran for as initiatedBy on KEY (as commerce mark-paid does);
 *   - tenant: the run, the payment account and its chart row are all of the
 *     run's business; a foreign account is "not found in this business";
 *   - the money leaves a cash-class account (CASH, BANK, PAYMENT_PROCESSOR) in
 *     the run's currency (D-13: nothing is converted);
 *   - a second mark-paid (double click, KEY retry) posts nothing new: the door's
 *     idempotency key PayrollRun:<id>:paid answers the first posting.
 *
 * Stubbed hermetically here; test/payroll-financial-truth.integration.test.ts
 * proves the same contract on a real database.
 */

type RunRow = {
  id: string;
  businessId: string;
  status: string;
  totalGross: number;
  currency: string;
  periodStart: Date;
  periodEnd: Date;
  paidAt: Date | null;
  notes: string | null;
};

function makeStubs(opts: {
  status?: string;
  totalGross?: number;
  currency?: string;
  paidAt?: Date | null;
  account?: Record<string, unknown> | null;
  coa?: Record<string, unknown> | null;
  postingFails?: Error;
  withPosting?: boolean;
} = {}) {
  const state: { run: RunRow | null } = {
    run: {
      id: 'run_1',
      businessId: 'biz_1',
      status: opts.status ?? 'APPROVED',
      totalGross: opts.totalGross ?? 6400,
      currency: opts.currency ?? 'TTD',
      periodStart: new Date('2026-08-01T00:00:00Z'),
      periodEnd: new Date('2026-08-15T00:00:00Z'),
      paidAt: opts.paidAt ?? null,
      notes: 'Bi-weekly payroll',
    },
  };
  const account = opts.account === undefined
    ? { id: 'fa_bank_1', businessId: 'biz_1', type: 'BANK', chartOfAccountId: 'coa_bank', isActive: true, currency: 'TTD' }
    : opts.account;
  const coa = opts.coa === undefined ? { id: 'coa_bank', businessId: 'biz_1', systemKey: 'BANK' } : opts.coa;

  const tx = {
    payrollRun: {
      findFirst: vi.fn(async ({ where }: any) => {
        const r = state.run;
        if (!r || r.id !== where.id || r.businessId !== where.businessId) return null;
        return { ...r };
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const r = state.run;
        if (!r || r.id !== where.id || r.businessId !== where.businessId || r.status !== where.status) return { count: 0 };
        state.run = { ...r, ...data };
        return { count: 1 };
      }),
    },
    financialAccount: {
      findFirst: vi.fn(async ({ where }: any) =>
        account && account.id === where.id && account.businessId === where.businessId ? { ...account } : null,
      ),
    },
    chartOfAccount: {
      findFirst: vi.fn(async ({ where }: any) =>
        coa && coa.id === where.id && coa.businessId === where.businessId ? { ...coa } : null,
      ),
    },
  };
  const prisma = {
    client: {
      payrollRun: { findFirst: tx.payrollRun.findFirst },
      $transaction: vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => {
        const before = state.run ? { ...state.run } : null;
        try {
          return await cb(tx);
        } catch (err) {
          state.run = before; // rollback
          throw err;
        }
      }),
    },
  } as any;
  const expensePosting = {
    onPayrollRunPaid: vi.fn(async () => {
      if (opts.postingFails) throw opts.postingFails;
      return { transactionId: 'ftx_1', externalRef: 'PayrollRun:run_1:paid', alreadyPosted: false };
    }),
    resolvePaymentCoa: vi.fn(async (_b: string, method: string) => (method === 'cash' ? 'coa_cash' : method === 'stripe' ? 'coa_proc' : 'coa_bank')),
  } as any;
  const svc = opts.withPosting === false ? new PayrollService(prisma) : new PayrollService(prisma, expensePosting);
  return { svc, prisma, tx, expensePosting, state };
}

describe('PayrollService.markRunPaid posts the disbursement through the ledger door (PR195-PORT)', () => {
  it('PS-01 an APPROVED run paid from a bank account: PAID, and one posting from that account with the actor', async () => {
    const { svc, expensePosting, state, tx } = makeStubs();
    const run = await svc.markRunPaid('biz_1', 'run_1', { paymentAccountId: 'fa_bank_1', actorId: 'u_owner' });
    expect(run!.status).toBe('PAID');
    expect(state.run!.status).toBe('PAID');
    expect(state.run!.paidAt).toBeInstanceOf(Date);
    expect(tx.payrollRun.updateMany).toHaveBeenCalledWith({
      where: { id: 'run_1', businessId: 'biz_1', status: 'APPROVED' },
      data: { status: 'PAID', paidAt: expect.any(Date) },
    });
    expect(expensePosting.onPayrollRunPaid).toHaveBeenCalledOnce();
    const [input, txArg] = expensePosting.onPayrollRunPaid.mock.calls[0];
    expect(txArg).toBe(tx); // inside the run's transaction
    expect(input).toMatchObject({
      id: 'run_1',
      businessId: 'biz_1',
      totalGross: 6400,
      currency: 'TTD',
      paymentCoaId: 'coa_bank',
      paymentAccountId: 'fa_bank_1',
      actorId: 'u_owner',
      paidAt: state.run!.paidAt,
    });
  });

  it('PS-02 a payment method alone resolves the cash-class chart row for it', async () => {
    const { svc, expensePosting } = makeStubs();
    await svc.markRunPaid('biz_1', 'run_1', { paymentMethod: 'Cash', actorId: 'u_owner' });
    expect(expensePosting.resolvePaymentCoa).toHaveBeenCalledWith('biz_1', 'cash');
    expect(expensePosting.onPayrollRunPaid.mock.calls[0][0]).toMatchObject({ paymentCoaId: 'coa_cash', paymentAccountId: null });
  });

  it('PS-03 neither an account nor a method: 400, nothing written', async () => {
    const { svc, expensePosting, state, prisma } = makeStubs();
    await expect(svc.markRunPaid('biz_1', 'run_1', {})).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.markRunPaid('biz_1', 'run_1')).rejects.toThrow(/paymentAccountId.*paymentMethod/);
    expect(prisma.client.$transaction).not.toHaveBeenCalled();
    expect(expensePosting.onPayrollRunPaid).not.toHaveBeenCalled();
    expect(state.run!.status).toBe('APPROVED');
  });

  it.each(['credit_card', 'card', 'bitcoin'])('PS-04 a method that is not a cash-class disbursement (%s): 400', async (method) => {
    const { svc, expensePosting, state } = makeStubs();
    await expect(svc.markRunPaid('biz_1', 'run_1', { paymentMethod: method })).rejects.toBeInstanceOf(BadRequestException);
    expect(expensePosting.onPayrollRunPaid).not.toHaveBeenCalled();
    expect(state.run!.status).toBe('APPROVED');
  });

  it('PS-05 another business\'s payment account is not found in this business; the run stays APPROVED', async () => {
    const { svc, expensePosting, state } = makeStubs({
      account: { id: 'fa_other', businessId: 'biz_2', type: 'BANK', chartOfAccountId: 'coa_other', isActive: true, currency: 'TTD' },
    });
    await expect(svc.markRunPaid('biz_1', 'run_1', { paymentAccountId: 'fa_other', actorId: 'u_owner' }))
      .rejects.toThrow(/not found in this business/);
    expect(expensePosting.onPayrollRunPaid).not.toHaveBeenCalled();
    expect(state.run!.status).toBe('APPROVED');
    expect(state.run!.paidAt).toBeNull();
  });

  it('PS-06 an account linked to another business\'s chart row is refused', async () => {
    const { svc, expensePosting, state } = makeStubs({ coa: { id: 'coa_bank', businessId: 'biz_2', systemKey: 'BANK' } });
    await expect(svc.markRunPaid('biz_1', 'run_1', { paymentAccountId: 'fa_bank_1' })).rejects.toBeInstanceOf(BadRequestException);
    expect(expensePosting.onPayrollRunPaid).not.toHaveBeenCalled();
    expect(state.run!.status).toBe('APPROVED');
  });

  it.each([
    ['inactive', { isActive: false }],
    ['not cash-class (CREDIT_CARD)', { type: 'CREDIT_CARD' }],
    ['in another currency (D-13)', { currency: 'USD' }],
  ])('PS-07 an account that is %s is refused; the run stays APPROVED', async (_label, patch) => {
    const { svc, expensePosting, state } = makeStubs({
      account: { id: 'fa_bank_1', businessId: 'biz_1', type: 'BANK', chartOfAccountId: 'coa_bank', isActive: true, currency: 'TTD', ...patch },
    });
    await expect(svc.markRunPaid('biz_1', 'run_1', { paymentAccountId: 'fa_bank_1' })).rejects.toBeInstanceOf(BadRequestException);
    expect(expensePosting.onPayrollRunPaid).not.toHaveBeenCalled();
    expect(state.run!.status).toBe('APPROVED');
  });

  it('PS-08 an account whose chart row is not cash-class is refused', async () => {
    const { svc, expensePosting } = makeStubs({ coa: { id: 'coa_bank', businessId: 'biz_1', systemKey: 'EXPENSE_GENERAL' } });
    await expect(svc.markRunPaid('biz_1', 'run_1', { paymentAccountId: 'fa_bank_1' })).rejects.toBeInstanceOf(BadRequestException);
    expect(expensePosting.onPayrollRunPaid).not.toHaveBeenCalled();
  });

  it('PS-09 atomic: a refused posting (closed period, currency) rolls the run back to APPROVED', async () => {
    const { ConflictException } = await import('@nestjs/common');
    const { svc, state } = makeStubs({ postingFails: new ConflictException('Accounting period 2026-08 is closed') });
    await expect(svc.markRunPaid('biz_1', 'run_1', { paymentMethod: 'bank_transfer' })).rejects.toBeInstanceOf(ConflictException);
    expect(state.run!.status).toBe('APPROVED');
    expect(state.run!.paidAt).toBeNull();
  });

  it('PS-10 a DRAFT run is refused before anything is written', async () => {
    const { svc, expensePosting, tx } = makeStubs({ status: 'DRAFT' });
    await expect(svc.markRunPaid('biz_1', 'run_1', { paymentMethod: 'cash' })).rejects.toThrow(/must be APPROVED/);
    expect(tx.payrollRun.updateMany).not.toHaveBeenCalled();
    expect(expensePosting.onPayrollRunPaid).not.toHaveBeenCalled();
  });

  it('PS-11 another business\'s run is not found', async () => {
    const { svc, expensePosting } = makeStubs();
    await expect(svc.markRunPaid('biz_2', 'run_1', { paymentMethod: 'cash' })).rejects.toBeInstanceOf(NotFoundException);
    expect(expensePosting.onPayrollRunPaid).not.toHaveBeenCalled();
  });

  it('PS-12 an already PAID run (double click, KEY retry): no second transition; the posting is asked for again under the same key, dated the first paidAt', async () => {
    const paidAt = new Date('2026-08-16T10:00:00Z');
    const { svc, expensePosting, tx, state } = makeStubs({ status: 'PAID', paidAt });
    const run = await svc.markRunPaid('biz_1', 'run_1', { paymentMethod: 'bank_transfer', actorId: 'u_owner' });
    expect(run!.status).toBe('PAID');
    expect(tx.payrollRun.updateMany).not.toHaveBeenCalled();
    expect(state.run!.paidAt).toEqual(paidAt);
    expect(expensePosting.onPayrollRunPaid).toHaveBeenCalledOnce();
    expect(expensePosting.onPayrollRunPaid.mock.calls[0][0]).toMatchObject({ id: 'run_1', paidAt });
  });

  it('PS-13 KEY: the system actor with the member it ran for as initiatedBy', async () => {
    const { svc, expensePosting } = makeStubs();
    await svc.markRunPaid('biz_1', 'run_1', { paymentMethod: 'bank_transfer', actorId: 'key_ai', initiatedBy: 'u_admin' });
    expect(expensePosting.onPayrollRunPaid.mock.calls[0][0]).toMatchObject({ actorId: 'key_ai', initiatedBy: 'u_admin' });
  });

  it('PS-14 with no posting service wired, mark-paid refuses rather than paying without books', async () => {
    const { svc, state } = makeStubs({ withPosting: false });
    await expect(svc.markRunPaid('biz_1', 'run_1', { paymentMethod: 'cash' })).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(state.run!.status).toBe('APPROVED');
  });
});
