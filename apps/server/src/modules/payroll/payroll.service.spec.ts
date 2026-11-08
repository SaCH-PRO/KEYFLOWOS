import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { PayrollService } from './payroll.service';

describe('PayrollService.markRunPaid', () => {
  function makeStubs(status = 'APPROVED', totalGross = 6400) {
    const runRow = {
      id: 'run_1',
      businessId: 'biz_1',
      status,
      totalGross,
      currency: 'TTD',
      periodStart: new Date('2026-08-01'),
      periodEnd: new Date('2026-08-15'),
      notes: 'Bi-weekly payroll',
      items: [],
    };
    const txPayrollUpdate = vi.fn(async ({ data }: any) => ({ ...runRow, ...data }));
    const tx = {
      payrollRun: { update: txPayrollUpdate },
    };
    const prisma = {
      client: {
        payrollRun: {
          findFirst: vi.fn(async () => runRow),
          update: txPayrollUpdate,
        },
        $transaction: vi.fn(async (cb: any) => cb(tx)),
      },
    } as any;
    const expensePosting = {
      onPayrollRunPaid: vi.fn(async () => ({ transactionId: 'tx_ledger_1' })),
    } as any;
    return {
      prisma,
      tx,
      txPayrollUpdate,
      expensePosting,
      svc: new PayrollService(prisma, expensePosting),
    };
  }

  it('updates status to PAID and posts Dr EXPENSE_PAYROLL / Cr BANK inside the same $transaction', async () => {
    const { svc, prisma, tx, txPayrollUpdate, expensePosting } = makeStubs('APPROVED', 6400);

    const updated = await svc.markRunPaid('biz_1', 'run_1', 'bank_transfer');

    expect(prisma.client.$transaction).toHaveBeenCalledOnce();
    expect(txPayrollUpdate).toHaveBeenCalledOnce();
    expect(updated.status).toBe('PAID');
    expect(expensePosting.onPayrollRunPaid).toHaveBeenCalledOnce();
    const [payload, txArg] = expensePosting.onPayrollRunPaid.mock.calls[0];
    expect(payload.id).toBe('run_1');
    expect(payload.businessId).toBe('biz_1');
    expect(payload.totalGross).toBe(6400);
    expect(payload.paymentMethod).toBe('bank_transfer');
    expect(txArg).toBe(tx);
  });

  it('rejects marking a DRAFT run as paid before approval', async () => {
    const { svc, expensePosting } = makeStubs('DRAFT', 6400);
    await expect(svc.markRunPaid('biz_1', 'run_1')).rejects.toThrow(BadRequestException);
    expect(expensePosting.onPayrollRunPaid).not.toHaveBeenCalled();
  });
});
