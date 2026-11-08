import { BadRequestException, ConflictException, InternalServerErrorException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { PayrollService } from './payroll.service';

describe('PayrollService.markRunPaid & generateRun', () => {
  function makeStubs(opts?: {
    status?: string;
    totalGross?: number;
    currency?: string;
    account?: any;
    updateManyCount?: number;
    postingShouldFail?: boolean;
  }) {
    const status = opts?.status ?? 'APPROVED';
    const totalGross = opts?.totalGross ?? 6400;
    const currency = opts?.currency ?? 'TTD';
    let currentStatus = status;

    const runRow = {
      id: 'run_1',
      businessId: 'biz_1',
      status: currentStatus,
      totalGross,
      currency,
      periodStart: new Date('2026-08-01'),
      periodEnd: new Date('2026-08-15'),
      notes: 'Bi-weekly payroll',
      items: [],
    };

    const defaultAccount =
      opts?.account !== undefined
        ? opts.account
        : {
            id: 'fa_bank_1',
            businessId: 'biz_1',
            type: 'BANK',
            subtype: 'checking',
            chartOfAccountId: 'coa_bank_1',
            isActive: true,
            currency: 'TTD',
          };

    const txPayrollUpdateMany = vi.fn(async ({ data }: any) => {
      if (opts?.updateManyCount !== undefined) {
        return { count: opts.updateManyCount };
      }
      if (currentStatus !== 'APPROVED') {
        return { count: 0 };
      }
      currentStatus = data.status;
      return { count: 1 };
    });

    const txPayrollFindFirst = vi.fn(async () => ({ ...runRow, status: currentStatus }));

    const tx = {
      payrollRun: {
        findFirst: txPayrollFindFirst,
        updateMany: txPayrollUpdateMany,
      },
      financialAccount: {
        findUnique: vi.fn(async () => defaultAccount),
        findFirst: vi.fn(async () => defaultAccount),
      },
    };

    const prisma = {
      client: {
        payrollRun: {
          findFirst: txPayrollFindFirst,
          updateMany: txPayrollUpdateMany,
        },
        financialAccount: tx.financialAccount,
        $transaction: vi.fn(async (cb: any) => {
          const snapshotStatus = currentStatus;
          try {
            return await cb(tx);
          } catch (err) {
            currentStatus = snapshotStatus;
            throw err;
          }
        }),
      },
    } as any;

    const expensePosting = {
      onPayrollRunPaid: vi.fn(async () => {
        if (opts?.postingShouldFail) {
          throw new Error('Ledger write failed');
        }
        return { transactionId: 'tx_ledger_1', externalRef: 'PayrollRun:run_1:paid', alreadyPosted: false };
      }),
    } as any;

    return {
      prisma,
      tx,
      txPayrollUpdateMany,
      expensePosting,
      getStatus: () => currentStatus,
      svc: new PayrollService(prisma, expensePosting),
    };
  }

  it('updates status to PAID and posts Dr EXPENSE_PAYROLL / Cr BANK inside the same $transaction when paymentMethod is provided', async () => {
    const { svc, prisma, tx, txPayrollUpdateMany, expensePosting } = makeStubs({ status: 'APPROVED', totalGross: 6400 });

    const updated = await svc.markRunPaid('biz_1', 'run_1', 'bank_transfer');

    expect(prisma.client.$transaction).toHaveBeenCalledOnce();
    expect(txPayrollUpdateMany).toHaveBeenCalledOnce();
    expect(updated.status).toBe('PAID');
    expect(expensePosting.onPayrollRunPaid).toHaveBeenCalledOnce();
    const [payload, txArg] = expensePosting.onPayrollRunPaid.mock.calls[0];
    expect(payload.id).toBe('run_1');
    expect(payload.businessId).toBe('biz_1');
    expect(payload.totalGross).toBe(6400);
    expect(payload.paymentMethod).toBe('bank_transfer');
    expect(txArg).toBe(tx);
  });

  it('validates explicit paymentAccountId and forwards its chartOfAccountId and accountId to ExpensePostingService', async () => {
    const { svc, expensePosting } = makeStubs({ status: 'APPROVED', totalGross: 6400 });
    const updated = await svc.markRunPaid('biz_1', 'run_1', { paymentAccountId: 'fa_bank_1' });
    expect(updated.status).toBe('PAID');
    const [payload] = expensePosting.onPayrollRunPaid.mock.calls[0];
    expect(payload.paymentAccountId).toBe('fa_bank_1');
    expect(payload.paymentCoaId).toBe('coa_bank_1');
    expect(payload.paymentMethod).toBe('bank_transfer');
  });

  it('rejects markRunPaid when neither paymentAccountId nor paymentMethod is provided', async () => {
    const { svc, expensePosting } = makeStubs({ status: 'APPROVED', totalGross: 6400 });
    await expect(svc.markRunPaid('biz_1', 'run_1')).rejects.toThrow(BadRequestException);
    await expect(svc.markRunPaid('biz_1', 'run_1', {})).rejects.toThrow(BadRequestException);
    expect(expensePosting.onPayrollRunPaid).not.toHaveBeenCalled();
  });

  it('rejects cross-business paymentAccountId access', async () => {
    const { svc, expensePosting } = makeStubs({
      status: 'APPROVED',
      account: {
        id: 'fa_foreign',
        businessId: 'biz_other',
        type: 'BANK',
        chartOfAccountId: 'coa_foreign',
        isActive: true,
        currency: 'TTD',
      },
    });
    await expect(
      svc.markRunPaid('biz_1', 'run_1', { paymentAccountId: 'fa_foreign' }),
    ).rejects.toThrow(/Cross-business payment account access blocked/);
    expect(expensePosting.onPayrollRunPaid).not.toHaveBeenCalled();
  });

  it('rejects non-disbursement account types (e.g. CREDIT_CARD) or inactive accounts', async () => {
    const { svc: svcCard, expensePosting: epCard } = makeStubs({
      status: 'APPROVED',
      account: {
        id: 'fa_card',
        businessId: 'biz_1',
        type: 'CREDIT_CARD',
        chartOfAccountId: 'coa_card',
        isActive: true,
        currency: 'TTD',
      },
    });
    await expect(
      svcCard.markRunPaid('biz_1', 'run_1', { paymentAccountId: 'fa_card' }),
    ).rejects.toThrow(/Invalid payment account type/);
    expect(epCard.onPayrollRunPaid).not.toHaveBeenCalled();

    const { svc: svcInactive } = makeStubs({
      status: 'APPROVED',
      account: {
        id: 'fa_inactive',
        businessId: 'biz_1',
        type: 'BANK',
        chartOfAccountId: 'coa_bank',
        isActive: false,
        currency: 'TTD',
      },
    });
    await expect(
      svcInactive.markRunPaid('biz_1', 'run_1', { paymentAccountId: 'fa_inactive' }),
    ).rejects.toThrow(/inactive/);
  });

  it('handles repeated payment requests idempotently without double-updating status', async () => {
    const { svc, txPayrollUpdateMany, expensePosting } = makeStubs({ status: 'APPROVED', totalGross: 6400 });
    const first = await svc.markRunPaid('biz_1', 'run_1', { paymentAccountId: 'fa_bank_1' });
    expect(first.status).toBe('PAID');
    expect(txPayrollUpdateMany).toHaveBeenCalledTimes(1);

    // Second request sees status === 'PAID' and does not call updateMany a second time
    const second = await svc.markRunPaid('biz_1', 'run_1', { paymentAccountId: 'fa_bank_1' });
    expect(second.status).toBe('PAID');
    expect(txPayrollUpdateMany).toHaveBeenCalledTimes(1);
    expect(expensePosting.onPayrollRunPaid).toHaveBeenCalledTimes(2);
  });

  it('rejects concurrent payment race with ConflictException when atomic updateMany claims 0 rows', async () => {
    const { svc, expensePosting } = makeStubs({
      status: 'APPROVED',
      updateManyCount: 0,
    });
    await expect(
      svc.markRunPaid('biz_1', 'run_1', { paymentMethod: 'bank_transfer' }),
    ).rejects.toThrow(ConflictException);
    expect(expensePosting.onPayrollRunPaid).not.toHaveBeenCalled();
  });

  it('rolls back run status to APPROVED if ledger posting throws inside the transaction', async () => {
    const { svc, getStatus } = makeStubs({
      status: 'APPROVED',
      postingShouldFail: true,
    });
    await expect(
      svc.markRunPaid('biz_1', 'run_1', { paymentMethod: 'bank_transfer' }),
    ).rejects.toThrow(/Ledger write failed/);
    expect(getStatus()).toBe('APPROVED');
  });

  it('fails closed if ExpensePostingService is not wired', async () => {
    const { prisma } = makeStubs({ status: 'APPROVED' });
    const svcWithoutPosting = new PayrollService(prisma, undefined);
    await expect(
      svcWithoutPosting.markRunPaid('biz_1', 'run_1', { paymentMethod: 'bank_transfer' }),
    ).rejects.toThrow(InternalServerErrorException);
  });

  it('rejects marking a DRAFT run as paid before approval', async () => {
    const { svc, expensePosting } = makeStubs({ status: 'DRAFT', totalGross: 6400 });
    await expect(svc.markRunPaid('biz_1', 'run_1', 'bank_transfer')).rejects.toThrow(BadRequestException);
    expect(expensePosting.onPayrollRunPaid).not.toHaveBeenCalled();
  });

  it('normalizes mixed-currency staff pay rates in generateRun when an exchange rate exists and fails closed when missing', async () => {
    const createdRuns: any[] = [];
    const makeGenClient = (exchangeRates: Array<{ fromCurrency: string; toCurrency: string; rate: number }>) =>
      ({
        client: {
          business: { findUnique: vi.fn(async () => ({ currency: 'TTD' })) },
          payrollRun: {
            findFirst: vi.fn(async () => null),
            create: vi.fn(async ({ data }: any) => {
              createdRuns.push(data);
              return { id: 'run_gen_1', ...data };
            }),
          },
          payRate: {
            findMany: vi.fn(async () => [
              {
                id: 'r1',
                assignmentId: 'a1',
                amount: 10_000,
                currency: 'TTD',
                periodType: 'monthly',
                effectiveFrom: new Date('2026-01-01'),
                assignment: { contactName: 'Alice', contactEmail: null, userId: 'u1' },
              },
              {
                id: 'r2',
                assignmentId: 'a2',
                amount: 1_000,
                currency: 'USD',
                periodType: 'monthly',
                effectiveFrom: new Date('2026-01-01'),
                assignment: { contactName: 'Bob', contactEmail: null, userId: 'u2' },
              },
            ]),
          },
          orgAssignment: {
            findFirst: vi.fn(async ({ where }: any) => ({ id: where.id, userId: 'u1' })),
          },
          exchangeRate: {
            findMany: vi.fn(async () => exchangeRates),
          },
        },
      }) as any;

    // Missing exchange rate -> fails closed
    const svcNoRate = new PayrollService(makeGenClient([]));
    await expect(
      svcNoRate.generateRun('biz_1', new Date('2026-08-01'), new Date('2026-08-31')),
    ).rejects.toThrow(/missing exchange rate from USD to TTD/);

    // Configured exchange rate (1 USD = 6.8 TTD) -> converts 1,000 USD to 6,800 TTD (totalGross = 16,800 TTD)
    const svcWithRate = new PayrollService(
      makeGenClient([{ fromCurrency: 'USD', toCurrency: 'TTD', rate: 6.8 }]),
    );
    const run = await svcWithRate.generateRun('biz_1', new Date('2026-08-01'), new Date('2026-08-31'));
    expect(run.currency).toBe('TTD');
    expect(run.totalGross).toBe(16_800);
  });
});
