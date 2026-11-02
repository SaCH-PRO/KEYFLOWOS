import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { fromCents, toCents } from '../commerce/money';
import { CashPositionService } from './cash-position.service';
import { ChartOfAccountsSeederService } from './chart-of-accounts-seeder.service';

export interface SafeToSpendDto {
  /** The ledger cash position (CashPositionService), never FinancialAccount.currentBalance. */
  cashBalance: number;
  /** V1-34: how cashBalance was derived. */
  cashBasis: 'ledger';
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
    @Inject(CashPositionService) private readonly cashPosition: CashPositionService,
  ) {}

  async calculate(businessId: string): Promise<SafeToSpendDto> {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { currency: true },
    });
    const currency = business?.currency ?? 'TTD';

    const now = new Date();
    const next30 = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    // V1-34 (CF-41): cash is the ledger's. FinancialAccount.currentBalance is
    // an opening snapshot that no payment, refund or expense ever moves.
    const [cashPosition, taxPayableAccount, billsDue, reserveBuckets] = await Promise.all([
      this.cashPosition.getCashPosition(businessId),
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

    const cashBalance = cashPosition.cashBalance;

    let taxReserved = 0;
    if (taxPayableAccount) {
      const agg = await this.prisma.client.ledgerEntry.aggregate({
        where: { accountId: taxPayableAccount.id },
        _sum: { debit: true, credit: true },
      });
      taxReserved = Number(agg._sum.credit ?? 0) - Number(agg._sum.debit ?? 0);
    }

    const billsDueNext30Days = billsDue.reduce((sum, b) => sum + Number(b.amount ?? 0), 0);

    // Payroll and debt schedules are not yet modeled; reserve these as 0 and
    // surface that fact in the explanation so the KPI is not overstated.
    const payrollReserved = 0;
    const debtPaymentsDue = 0;

    // Operating buffer: minimum 10% of cash or 500 currency units (in cents, D-13).
    const operatingBuffer = fromCents(Math.max(Math.round(toCents(cashBalance) / 10), toCents(500)));

    const otherReserves = reserveBuckets.reduce((sum, r) => sum + Number(r.currentAmount ?? 0), 0);

    // Integer cents (D-13), so the figure never carries float residue.
    const safeToSpend = fromCents(Math.max(
      0,
      toCents(cashBalance)
        - toCents(taxReserved)
        - toCents(billsDueNext30Days)
        - toCents(payrollReserved)
        - toCents(debtPaymentsDue)
        - toCents(operatingBuffer)
        - toCents(otherReserves),
    ));

    const explanation: string[] = [
      `Cash balance: ${currency} ${cashBalance.toFixed(2)} (ledger)`,
      `Tax reserved: ${currency} ${taxReserved.toFixed(2)}`,
      `Bills due next 30 days: ${currency} ${billsDueNext30Days.toFixed(2)}`,
      `Operating buffer: ${currency} ${operatingBuffer.toFixed(2)}`,
    ];

    explanation.push(`Payroll reserved: ${currency} ${payrollReserved.toFixed(2)} (not yet modeled)`);
    explanation.push(`Debt payments due: ${currency} ${debtPaymentsDue.toFixed(2)} (not yet modeled)`);
    if (otherReserves > 0) explanation.push(`Other reserves: ${currency} ${otherReserves.toFixed(2)}`);
    if (reserveBuckets.length > 0) {
      for (const rb of reserveBuckets) {
        explanation.push(`  - ${rb.name}: ${currency} ${Number(rb.currentAmount ?? 0).toFixed(2)}`);
      }
    }

    explanation.push(`Safe to spend: ${currency} ${safeToSpend.toFixed(2)}`);

    return {
      cashBalance,
      cashBasis: cashPosition.basis,
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
