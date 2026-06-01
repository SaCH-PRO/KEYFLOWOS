import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { ChartOfAccountsSeederService } from './chart-of-accounts-seeder.service';

export interface SafeToSpendDto {
  cashBalance: number;
  taxReserved: number;
  billsDueNext30Days: number;
  payrollReserved: number;
  debtPaymentsDue: number;
  operatingBuffer: number;
  otherReserves: number;
  safeToSpend: number;
  currency: string;
  explanation: string[];
}

@Injectable()
export class SafeToSpendService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ChartOfAccountsSeederService) private readonly coaSeeder: ChartOfAccountsSeederService,
  ) {}

  async calculate(businessId: string): Promise<SafeToSpendDto> {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { currency: true },
    });
    const currency = business?.currency ?? 'TTD';

    const now = new Date();
    const next30 = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const [cashAccounts, taxPayableAccount, billsDue, reserveBuckets] = await Promise.all([
      this.prisma.client.financialAccount.findMany({
        where: { businessId, isActive: true, type: { in: ['CASH', 'BANK', 'PAYMENT_PROCESSOR'] } },
        select: { currentBalance: true },
      }),
      this.coaSeeder.getBySystemKey(businessId, 'TAX_PAYABLE'),
      this.prisma.client.expense.findMany({
        where: {
          businessId,
          status: 'BILL',
          dueDate: { gte: now, lte: next30 },
        },
        select: { amount: true },
      }),
      this.prisma.client.cashReserveBucket.findMany({
        where: { businessId, status: 'ACTIVE' },
        select: { currentAmount: true, name: true },
      }),
    ]);

    const cashBalance = cashAccounts.reduce((sum, a) => sum + Number(a.currentBalance ?? 0), 0);

    let taxReserved = 0;
    if (taxPayableAccount) {
      const agg = await this.prisma.client.ledgerEntry.aggregate({
        where: { accountId: taxPayableAccount.id },
        _sum: { debit: true, credit: true },
      });
      taxReserved = Number(agg._sum.credit ?? 0) - Number(agg._sum.debit ?? 0);
    }

    const billsDueNext30Days = billsDue.reduce((sum, b) => sum + Number(b.amount ?? 0), 0);

    // Placeholder: payroll and debt not yet modeled
    const payrollReserved = 0;
    const debtPaymentsDue = 0;

    // Operating buffer: minimum 10% of cash or 500 currency units
    const operatingBuffer = Math.max(cashBalance * 0.1, 500);

    const otherReserves = reserveBuckets.reduce((sum, r) => sum + Number(r.currentAmount ?? 0), 0);

    const safeToSpend = Math.max(
      0,
      cashBalance - taxReserved - billsDueNext30Days - payrollReserved - debtPaymentsDue - operatingBuffer - otherReserves,
    );

    const explanation: string[] = [
      `Cash balance: ${currency} ${cashBalance.toFixed(2)}`,
      `Tax reserved: ${currency} ${taxReserved.toFixed(2)}`,
      `Bills due next 30 days: ${currency} ${billsDueNext30Days.toFixed(2)}`,
      `Operating buffer: ${currency} ${operatingBuffer.toFixed(2)}`,
    ];

    if (payrollReserved > 0) explanation.push(`Payroll reserved: ${currency} ${payrollReserved.toFixed(2)}`);
    if (debtPaymentsDue > 0) explanation.push(`Debt payments due: ${currency} ${debtPaymentsDue.toFixed(2)}`);
    if (otherReserves > 0) explanation.push(`Other reserves: ${currency} ${otherReserves.toFixed(2)}`);
    if (reserveBuckets.length > 0) {
      for (const rb of reserveBuckets) {
        explanation.push(`  - ${rb.name}: ${currency} ${Number(rb.currentAmount ?? 0).toFixed(2)}`);
      }
    }

    explanation.push(`Safe to spend: ${currency} ${safeToSpend.toFixed(2)}`);

    return {
      cashBalance,
      taxReserved,
      billsDueNext30Days,
      payrollReserved,
      debtPaymentsDue,
      operatingBuffer,
      otherReserves,
      safeToSpend,
      currency,
      explanation,
    };
  }
}
