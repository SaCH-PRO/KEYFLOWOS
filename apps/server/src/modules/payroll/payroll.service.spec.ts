import { BadRequestException, ForbiddenException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { PayrollService } from './payroll.service';
import { KEY_SYSTEM_ACTOR_ID } from '../../core/auth/system-actor';

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
  /** The business's currency (Business.currency); TTD unless said. */
  businessCurrency?: string;
  /** The currencies of the run's items; each the run's currency unless said. */
  itemCurrencies?: string[];
  /** Memberships by `${businessId}|${userId}`; the defaults below unless said. */
  members?: Record<string, { role: string; permissionScopes: unknown }>;
  /** Platform roles (User.role) by user id; USER unless said. */
  userRoles?: Record<string, string>;
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
  const members: Record<string, { role: string; permissionScopes: unknown }> = opts.members ?? {
    'biz_1|u_owner': { role: 'OWNER', permissionScopes: null },
    'biz_1|u_admin': { role: 'ADMIN', permissionScopes: null },
    'biz_2|u_owner2': { role: 'OWNER', permissionScopes: null },
  };
  const userRoles = opts.userRoles ?? {};
  const businessRow = { currency: opts.businessCurrency ?? 'TTD' };
  const business = {
    findUnique: vi.fn(async () => ({ ...businessRow })),
    findFirst: vi.fn(async () => ({ ...businessRow })),
  };

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
    business,
    payrollItem: {
      findMany: vi.fn(async () => (opts.itemCurrencies ?? [state.run?.currency ?? 'TTD']).map((currency) => ({ currency }))),
    },
  };
  const membership = {
    findUnique: vi.fn(async ({ where }: any) => {
      const key = `${where.userId_businessId.businessId}|${where.userId_businessId.userId}`;
      return members[key] ? { ...members[key] } : null;
    }),
  };
  const user = { findUnique: vi.fn(async ({ where }: any) => ({ id: where.id, role: userRoles[where.id] ?? 'USER' })) };
  const prisma = {
    client: {
      payrollRun: { findFirst: tx.payrollRun.findFirst },
      membership,
      user,
      business,
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
  return { svc, prisma, tx, expensePosting, state, membership };
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
    await expect(svc.markRunPaid('biz_1', 'run_1', { actorId: 'u_owner' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.markRunPaid('biz_1', 'run_1', { actorId: 'u_owner' })).rejects.toThrow(/paymentAccountId.*paymentMethod/);
    expect(prisma.client.$transaction).not.toHaveBeenCalled();
    expect(expensePosting.onPayrollRunPaid).not.toHaveBeenCalled();
    expect(state.run!.status).toBe('APPROVED');
  });

  it.each(['credit_card', 'card', 'bitcoin'])('PS-04 a method that is not a cash-class disbursement (%s): 400', async (method) => {
    const { svc, expensePosting, state } = makeStubs();
    await expect(svc.markRunPaid('biz_1', 'run_1', { paymentMethod: method, actorId: 'u_owner' })).rejects.toBeInstanceOf(BadRequestException);
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
    await expect(svc.markRunPaid('biz_1', 'run_1', { paymentAccountId: 'fa_bank_1', actorId: 'u_owner' })).rejects.toBeInstanceOf(BadRequestException);
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
    await expect(svc.markRunPaid('biz_1', 'run_1', { paymentAccountId: 'fa_bank_1', actorId: 'u_owner' })).rejects.toBeInstanceOf(BadRequestException);
    expect(expensePosting.onPayrollRunPaid).not.toHaveBeenCalled();
    expect(state.run!.status).toBe('APPROVED');
  });

  it('PS-08 an account whose chart row is not cash-class is refused', async () => {
    const { svc, expensePosting } = makeStubs({ coa: { id: 'coa_bank', businessId: 'biz_1', systemKey: 'EXPENSE_GENERAL' } });
    await expect(svc.markRunPaid('biz_1', 'run_1', { paymentAccountId: 'fa_bank_1', actorId: 'u_owner' })).rejects.toBeInstanceOf(BadRequestException);
    expect(expensePosting.onPayrollRunPaid).not.toHaveBeenCalled();
  });

  it('PS-09 atomic: a refused posting (closed period, currency) rolls the run back to APPROVED', async () => {
    const { ConflictException } = await import('@nestjs/common');
    const { svc, state } = makeStubs({ postingFails: new ConflictException('Accounting period 2026-08 is closed') });
    await expect(svc.markRunPaid('biz_1', 'run_1', { paymentMethod: 'bank_transfer', actorId: 'u_owner' })).rejects.toBeInstanceOf(ConflictException);
    expect(state.run!.status).toBe('APPROVED');
    expect(state.run!.paidAt).toBeNull();
  });

  it('PS-10 a DRAFT run is refused before anything is written', async () => {
    const { svc, expensePosting, tx } = makeStubs({ status: 'DRAFT' });
    await expect(svc.markRunPaid('biz_1', 'run_1', { paymentMethod: 'cash', actorId: 'u_owner' })).rejects.toThrow(/must be APPROVED/);
    expect(tx.payrollRun.updateMany).not.toHaveBeenCalled();
    expect(expensePosting.onPayrollRunPaid).not.toHaveBeenCalled();
  });

  it('PS-11 another business\'s run is not found', async () => {
    const { svc, expensePosting } = makeStubs();
    // u_owner2 is a member of biz_2 (the authority check passes there); the run is biz_1's.
    await expect(svc.markRunPaid('biz_2', 'run_1', { paymentMethod: 'cash', actorId: 'u_owner2' })).rejects.toBeInstanceOf(NotFoundException);
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
    await expect(svc.markRunPaid('biz_1', 'run_1', { paymentMethod: 'cash', actorId: 'u_owner' })).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(state.run!.status).toBe('APPROVED');
  });
});

/**
 * PR195-PORT review repair. Mark-paid is a ledger writer since the port, so it is
 * held to the head's Books-write rule and to D-13:
 *   - SEC-P195-1 (FinanceController.ensureAccess, FOLLOW3-A5 / PF-03; D-46; D-73):
 *     the person the posting is for (the signed-in member on REST, the member KEY
 *     ran for on KEY) must hold a Membership of the business. A platform
 *     SUPER_ADMIN who is not a member, a KEY run for no member, and a call naming
 *     no one are refused 403 before anything is read or written.
 *   - SEC-P195-3 (restrictive pick, owner question): that member also needs
 *     expenses write (the scope bills/:id/pay needs), read as ModuleScopeGuard
 *     reads a membership; a SUPER_ADMIN who is a member passes, as the guard
 *     lets one through.
 *   - CR-P195-1 (D-13): a run whose currency, or an item's, is not the business
 *     currency is refused 400 before anything is written; rates set with no
 *     currency take the business currency, and so does the run made of them.
 */
describe('PayrollService.markRunPaid: who may post payroll, and in which currency (PR195-PORT repair)', () => {
  it('PS-15 (SEC-P195-1) a platform SUPER_ADMIN with no Membership is refused 403 on REST and on KEY; nothing is read or written', async () => {
    const { svc, expensePosting, prisma, state } = makeStubs({ userRoles: { u_sa: 'SUPER_ADMIN' } });
    await expect(svc.markRunPaid('biz_1', 'run_1', { paymentMethod: 'bank_transfer', actorId: 'u_sa' }))
      .rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      svc.markRunPaid('biz_1', 'run_1', { paymentMethod: 'bank_transfer', actorId: KEY_SYSTEM_ACTOR_ID, initiatedBy: 'u_sa' }),
    ).rejects.toThrow(/Not a member of this business/);
    expect(prisma.client.$transaction).not.toHaveBeenCalled();
    expect(expensePosting.onPayrollRunPaid).not.toHaveBeenCalled();
    expect(state.run!.status).toBe('APPROVED');
    expect(state.run!.paidAt).toBeNull();
  });

  it('PS-16 (SEC-P195-1, D-73) a KEY run for no member, and a call naming no one, are refused 403', async () => {
    const { svc, expensePosting, prisma } = makeStubs();
    await expect(svc.markRunPaid('biz_1', 'run_1', { paymentMethod: 'cash', actorId: KEY_SYSTEM_ACTOR_ID, initiatedBy: null }))
      .rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.markRunPaid('biz_1', 'run_1', { paymentMethod: 'cash' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.markRunPaid('biz_1', 'run_1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.client.$transaction).not.toHaveBeenCalled();
    expect(expensePosting.onPayrollRunPaid).not.toHaveBeenCalled();
  });

  it('PS-17 (SEC-P195-1) a member of another business only is refused here', async () => {
    const { svc, expensePosting } = makeStubs();
    await expect(svc.markRunPaid('biz_1', 'run_1', { paymentMethod: 'cash', actorId: 'u_owner2' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(expensePosting.onPayrollRunPaid).not.toHaveBeenCalled();
  });

  it.each([
    ['operations write, expenses read', { operations: 'write', expenses: 'read' }],
    ['operations write, no expenses key', { operations: 'write' }],
    ['an explicit map stored as an empty array (every module none)', []],
  ])('PS-18 (SEC-P195-3) a member with %s is refused 403; nothing is written', async (_label, permissionScopes) => {
    const { svc, expensePosting, prisma, state } = makeStubs({
      members: { 'biz_1|u_ops': { role: 'STAFF', permissionScopes } },
    });
    await expect(svc.markRunPaid('biz_1', 'run_1', { paymentMethod: 'cash', actorId: 'u_ops' }))
      .rejects.toThrow(/expenses requires write access/);
    await expect(svc.markRunPaid('biz_1', 'run_1', { paymentMethod: 'cash', actorId: KEY_SYSTEM_ACTOR_ID, initiatedBy: 'u_ops' }))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.client.$transaction).not.toHaveBeenCalled();
    expect(expensePosting.onPayrollRunPaid).not.toHaveBeenCalled();
    expect(state.run!.status).toBe('APPROVED');
  });

  it('PS-19 (SEC-P195-3) expenses write passes; a SUPER_ADMIN who is a member passes as ModuleScopeGuard lets one through', async () => {
    const withWrite = makeStubs({ members: { 'biz_1|u_ops': { role: 'STAFF', permissionScopes: { operations: 'write', expenses: 'write' } } } });
    await withWrite.svc.markRunPaid('biz_1', 'run_1', { paymentMethod: 'cash', actorId: 'u_ops' });
    expect(withWrite.expensePosting.onPayrollRunPaid).toHaveBeenCalledOnce();

    const memberSa = makeStubs({
      members: { 'biz_1|u_sa': { role: 'STAFF', permissionScopes: { expenses: 'none' } } },
      userRoles: { u_sa: 'SUPER_ADMIN' },
    });
    await memberSa.svc.markRunPaid('biz_1', 'run_1', { paymentMethod: 'cash', actorId: 'u_sa' });
    expect(memberSa.expensePosting.onPayrollRunPaid).toHaveBeenCalledOnce();
  });

  it('PS-20 (CR-P195-1, D-13) a run not in the business currency is refused 400; nothing is claimed or posted', async () => {
    const { svc, expensePosting, tx, state } = makeStubs({ businessCurrency: 'USD', currency: 'TTD' });
    await expect(svc.markRunPaid('biz_1', 'run_1', { paymentMethod: 'bank_transfer', actorId: 'u_owner' }))
      .rejects.toThrow(/business currency is USD/);
    expect(tx.payrollRun.updateMany).not.toHaveBeenCalled();
    expect(expensePosting.onPayrollRunPaid).not.toHaveBeenCalled();
    expect(state.run!.status).toBe('APPROVED');
    expect(state.run!.paidAt).toBeNull();
  });

  it('PS-21 (CR-P195-1, D-13) a run in the business currency with an item in another is refused 400', async () => {
    const { svc, expensePosting, tx } = makeStubs({ businessCurrency: 'USD', currency: 'USD', itemCurrencies: ['USD', 'TTD'] });
    await expect(svc.markRunPaid('biz_1', 'run_1', { paymentMethod: 'bank_transfer', actorId: 'u_owner' }))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(tx.payrollRun.updateMany).not.toHaveBeenCalled();
    expect(expensePosting.onPayrollRunPaid).not.toHaveBeenCalled();
  });

  it('PS-22 (CR-P195-1) a USD business\'s USD run posts in USD', async () => {
    const { svc, expensePosting } = makeStubs({
      businessCurrency: 'usd',
      currency: 'USD',
      account: { id: 'fa_bank_1', businessId: 'biz_1', type: 'BANK', chartOfAccountId: 'coa_bank', isActive: true, currency: 'USD' },
    });
    await svc.markRunPaid('biz_1', 'run_1', { paymentAccountId: 'fa_bank_1', actorId: 'u_owner' });
    expect(expensePosting.onPayrollRunPaid.mock.calls[0][0]).toMatchObject({ currency: 'USD' });
  });
});

/** Rates and run generation (head code the port turned into ledger money; CR-P195-1). */
function makeRateStubs(opts: { businessCurrency?: string; rates?: Array<{ currency: string; amount: number; periodType?: string }> } = {}) {
  const created: { rate?: any; run?: any } = {};
  const rates = (opts.rates ?? []).map((r, i) => ({
    id: `rate_${i}`,
    businessId: 'biz_1',
    assignmentId: `asg_${i}`,
    amount: r.amount,
    currency: r.currency,
    periodType: r.periodType ?? 'monthly',
    effectiveFrom: new Date('2026-01-01T00:00:00Z'),
    assignment: { contactName: `Staff ${i}`, contactEmail: null, userId: null },
  }));
  const prisma = {
    client: {
      business: {
        findUnique: vi.fn(async () => ({ currency: opts.businessCurrency ?? 'TTD' })),
        findFirst: vi.fn(async () => ({ currency: opts.businessCurrency ?? 'TTD' })),
      },
      orgAssignment: { findFirst: vi.fn(async ({ where }: any) => ({ id: where.id, businessId: 'biz_1', userId: null })) },
      payRate: {
        create: vi.fn(async ({ data }: any) => {
          created.rate = data;
          return { id: 'rate_new', ...data };
        }),
        findMany: vi.fn(async () => rates),
      },
      payrollRun: {
        findFirst: vi.fn(async () => null),
        create: vi.fn(async ({ data }: any) => {
          created.run = data;
          return { id: 'run_new', ...data, items: [] };
        }),
      },
      timeEntry: { aggregate: vi.fn(async () => ({ _sum: { durationMinutes: 0 } })) },
    },
  } as any;
  return { svc: new PayrollService(prisma, {} as any), prisma, created };
}

describe('PayrollService rates and runs take the business currency (PR195-PORT repair CR-P195-1, D-13)', () => {
  it('PS-23 a rate set with no currency is stored in the business currency, not the literal TTD', async () => {
    const { svc, created } = makeRateStubs({ businessCurrency: 'USD' });
    await svc.setRate('biz_1', { assignmentId: 'asg_0', amount: 1_000, periodType: 'monthly' });
    expect(created.rate.currency).toBe('USD');
  });

  it('PS-24 a rate set with a currency keeps it, normalized', async () => {
    const { svc, created } = makeRateStubs({ businessCurrency: 'USD' });
    await svc.setRate('biz_1', { assignmentId: 'asg_0', amount: 1_000, currency: ' usd ', periodType: 'monthly' });
    expect(created.rate.currency).toBe('USD');
  });

  it('PS-25 a run made of business-currency rates is labelled with the business currency', async () => {
    const { svc, created } = makeRateStubs({ businessCurrency: 'USD', rates: [{ currency: 'USD', amount: 1_000 }, { currency: 'usd', amount: 500 }] });
    await svc.generateRun('biz_1', new Date('2026-09-01T00:00:00Z'), new Date('2026-09-30T00:00:00Z'));
    expect(created.run.currency).toBe('USD');
    expect(created.run.totalGross).toBe(1_500);
  });

  it('PS-26 rates in two currencies are refused 400 (nothing converted, nothing summed across currencies); no run is created', async () => {
    const { svc, prisma } = makeRateStubs({ businessCurrency: 'USD', rates: [{ currency: 'USD', amount: 1_000 }, { currency: 'TTD', amount: 500 }] });
    await expect(svc.generateRun('biz_1', new Date('2026-09-01T00:00:00Z'), new Date('2026-09-30T00:00:00Z')))
      .rejects.toThrow(/more than one currency/);
    expect(prisma.client.payrollRun.create).not.toHaveBeenCalled();
  });
});
