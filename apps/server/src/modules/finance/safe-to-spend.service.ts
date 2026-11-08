import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { ChartOfAccountsSeederService } from './chart-of-accounts-seeder.service';
import {
  computeNormalizedCashBalance,
  convertToBaseOrThrow,
  fetchAllPages,
  loadCashLedgerMovements,
  loadLatestExchangeRates,
  normalizeCurrencyCode,
} from './finance-accounting.util';

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
    const currency = normalizeCurrencyCode(business?.currency, 'TTD');

    const now = new Date();
    const next30 = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const [
      cashAccounts,
      taxPayableAccount,
      billsDue,
      reserveBuckets,
      committedPayrollRuns,
      exchangeRates,
    ] = await Promise.all([
      fetchAllPages(({ skip, take }) =>
        this.prisma.client.financialAccount.findMany({
          where: { businessId, isActive: true, type: { in: ['CASH', 'BANK', 'PAYMENT_PROCESSOR'] } },
          select: {
            id: true,
            chartOfAccountId: true,
            openingBalance: true,
            currentBalance: true,
            currency: true,
          },
          ...(skip > 0 ? { skip, take } : {}),
        }),
      ),
      this.coaSeeder.getBySystemKey(businessId, 'TAX_PAYABLE'),
      fetchAllPages(({ skip, take }) =>
        this.prisma.client.expense.findMany({
          where: {
            businessId,
            status: 'BILL',
            dueDate: { gte: now, lte: next30 },
          },
          select: { amount: true, currency: true },
          ...(skip > 0 ? { skip, take } : {}),
        }),
      ),
      fetchAllPages(({ skip, take }) =>
        this.prisma.client.cashReserveBucket.findMany({
          where: { businessId, status: 'ACTIVE' },
          select: { currentAmount: true, currency: true, name: true },
          ...(skip > 0 ? { skip, take } : {}),
        }),
      ),
      this.prisma.client.payrollRun?.findMany
        ? fetchAllPages(({ skip, take }) =>
            this.prisma.client.payrollRun.findMany({
              where: {
                businessId,
                status: { in: ['DRAFT', 'APPROVED'] },
              },
              select: { totalGross: true, currency: true, status: true },
              ...(skip > 0 ? { skip, take } : {}),
            }),
          )
        : Promise.resolve([]),
      loadLatestExchangeRates(this.prisma.client.exchangeRate, businessId),
    ]);

    const linkedCoaIds = Array.from(
      new Set(
        cashAccounts
          .map((a: { chartOfAccountId?: string | null }) => a.chartOfAccountId)
          .filter(Boolean) as string[],
      ),
    );

    const cashLedgerMovements = await loadCashLedgerMovements(
      this.prisma.client.ledgerEntry,
      businessId,
      linkedCoaIds,
    );

    const cashBalance = computeNormalizedCashBalance({
      accounts: cashAccounts,
      ledgerMovements: cashLedgerMovements,
      baseCurrency: currency,
      rates: exchangeRates,
      failClosedOnMissingRate: true,
    });

    let taxReserved = 0;
    if (taxPayableAccount) {
      const agg = await this.prisma.client.ledgerEntry.aggregate({
        where: { accountId: taxPayableAccount.id },
        _sum: { debit: true, credit: true },
      });
      taxReserved = Number(agg._sum.credit ?? 0) - Number(agg._sum.debit ?? 0);
    }

    const billsDueNext30Days = billsDue.reduce(
      (sum, b: { amount?: number | null; currency?: string | null }) =>
        sum +
        convertToBaseOrThrow(
          Number(b.amount ?? 0),
          b.currency,
          currency,
          exchangeRates,
          'safe-to-spend bills due',
        ),
      0,
    );

    // Reserve committed (DRAFT + APPROVED) payroll runs that have not yet been disbursed.
    const payrollReserved = committedPayrollRuns.reduce(
      (sum, r: { totalGross?: unknown; currency?: string | null }) =>
        sum +
        convertToBaseOrThrow(
          Number(r.totalGross ?? 0),
          r.currency,
          currency,
          exchangeRates,
          'safe-to-spend payroll reserve',
        ),
      0,
    );
    const debtPaymentsDue = 0;

    // Operating buffer: minimum 10% of cash or 500 currency units
    const operatingBuffer = Math.max(cashBalance * 0.1, 500);

    const otherReserves = reserveBuckets.reduce(
      (sum, r: { currentAmount?: unknown; currency?: string | null }) =>
        sum +
        convertToBaseOrThrow(
          Number(r.currentAmount ?? 0),
          r.currency,
          currency,
          exchangeRates,
          'safe-to-spend reserve bucket',
        ),
      0,
    );

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

    explanation.push(
      committedPayrollRuns.length > 0
        ? `Payroll reserved: ${currency} ${payrollReserved.toFixed(2)} (${committedPayrollRuns.length} committed run${committedPayrollRuns.length === 1 ? '' : 's'})`
        : `Payroll reserved: ${currency} ${payrollReserved.toFixed(2)} (no unpaid runs)`,
    );
    explanation.push(`Debt payments due: ${currency} ${debtPaymentsDue.toFixed(2)} (not yet modeled)`);
    if (otherReserves > 0) explanation.push(`Other reserves: ${currency} ${otherReserves.toFixed(2)}`);
    if (reserveBuckets.length > 0) {
      for (const rb of reserveBuckets) {
        const rbAmt = convertToBaseOrThrow(
          Number(rb.currentAmount ?? 0),
          (rb as { currency?: string | null }).currency,
          currency,
          exchangeRates,
          'safe-to-spend reserve bucket',
        );
        explanation.push(`  - ${rb.name}: ${currency} ${rbAmt.toFixed(2)}`);
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
