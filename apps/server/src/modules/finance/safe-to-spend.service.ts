import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { fromCents, toCents } from '../commerce/money';
import { CashPositionService, otherCurrencyCash, type OtherCurrencyCash } from './cash-position.service';
import { ChartOfAccountsSeederService } from './chart-of-accounts-seeder.service';
import { normalizeCurrency } from './posting.service';

export interface SafeToSpendDto {
  /**
   * The ledger cash position (CashPositionService), never FinancialAccount.currentBalance.
   * V1-37c: the business currency's cash only (labelled by `currency`).
   */
  cashBalance: number;
  /** V1-34: how cashBalance was derived. */
  cashBasis: 'ledger';
  /**
   * V1-37c (D-13): cash held in another currency, by currency. It is never
   * added to cashBalance nor counted in safeToSpend; empty when there is none.
   */
  otherCurrencyCash: OtherCurrencyCash[];
  /**
   * PR195-PORT (D-13): committed payroll (DRAFT and APPROVED runs) in another
   * currency, by currency. Never added to payrollReserved nor counted in
   * safeToSpend; empty when there is none.
   */
  otherCurrencyPayroll: OtherCurrencyCash[];
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
    const now = new Date();
    const next30 = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    // V1-34 (CF-41): cash is the ledger's. FinancialAccount.currentBalance is
    // an opening snapshot that no payment, refund or expense ever moves.
    const [cashPosition, taxPayableAccount, billsDue, reserveBuckets, committedRuns] = await Promise.all([
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
      // PR195-PORT (owner PR #195 part 1): committed payroll, the runs approved or
      // about to be and not yet paid. A PAID run's money has already left the
      // ledger cash through its posting (mark-paid), so it is not reserved twice.
      this.prisma.client.payrollRun.findMany({
        where: { businessId, status: { in: ['DRAFT', 'APPROVED'] } },
        select: { totalGross: true, currency: true, status: true },
        orderBy: { periodStart: 'asc' },
      }),
    ]);

    // V1-37c (D-13): every figure below is in the business currency, the one
    // the cash position labels its cashBalance with (normalized); cash in any
    // other currency is reported apart and never added.
    const currency = cashPosition.currency;
    const cashBalance = cashPosition.cashBalance;
    const otherCash = otherCurrencyCash(cashPosition);

    let taxReserved = 0;
    if (taxPayableAccount) {
      const agg = await this.prisma.client.ledgerEntry.aggregate({
        where: { accountId: taxPayableAccount.id },
        _sum: { debit: true, credit: true },
      });
      taxReserved = Number(agg._sum.credit ?? 0) - Number(agg._sum.debit ?? 0);
    }

    const billsDueNext30Days = billsDue.reduce((sum, b) => sum + Number(b.amount ?? 0), 0);

    // PR195-PORT (owner PR #195 part 1): the committed payroll reserve, in the
    // business currency (integer cents, D-13). A run in another currency is
    // named apart (otherCurrencyPayroll), never added or converted (D-13,
    // V1-37c), as other-currency cash is. Debt schedules are not yet modeled;
    // reserved as 0 and said so, so the KPI is not overstated.
    const payrollCentsByCurrency = new Map<string, number>();
    const payrollRunsByCurrency = new Map<string, number>();
    // Review CR-P195-3: the DRAFT runs among them, in the business currency, named apart in the explanation
    // (a draft is reserved but not yet approved; nothing voids one today, an owner question).
    let draftCents = 0;
    let draftRuns = 0;
    for (const run of committedRuns) {
      const code = normalizeCurrency(run.currency) || currency;
      const cents = toCents(Number(run.totalGross ?? 0));
      payrollCentsByCurrency.set(code, (payrollCentsByCurrency.get(code) ?? 0) + cents);
      payrollRunsByCurrency.set(code, (payrollRunsByCurrency.get(code) ?? 0) + 1);
      if (code === currency && run.status === 'DRAFT') {
        draftCents += cents;
        draftRuns += 1;
      }
    }
    const payrollReserved = fromCents(payrollCentsByCurrency.get(currency) ?? 0);
    const payrollRuns = payrollRunsByCurrency.get(currency) ?? 0;
    const otherPayroll: OtherCurrencyCash[] = [...payrollCentsByCurrency.entries()]
      .filter(([code, cents]) => code !== currency && cents !== 0)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([code, cents]) => ({ currency: code, amount: fromCents(cents) }));
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

    // V1-34 review CR-34-01: say so when an account opening balance that has
    // not been posted yet is part of a cash figure; V1-37c: under the figure
    // of its own currency.
    const unpostedIn = (code: string) => cashPosition.unpostedOpeningBalances
      .filter((o) => o.currency === code)
      .map((o) => `  - includes ${o.name} opening balance not yet posted: ${o.currency} ${o.amount.toFixed(2)}`);
    const explanation: string[] = [
      `Cash balance: ${currency} ${cashBalance.toFixed(2)} (ledger)`,
      ...unpostedIn(currency),
      // V1-37c (D-13): cash in another currency is said, never added or converted.
      ...otherCash.flatMap((o) => [
        `Cash in ${o.currency}, not included (never added to ${currency}): ${o.currency} ${o.amount.toFixed(2)} (ledger)`,
        ...unpostedIn(o.currency),
      ]),
      `Tax reserved: ${currency} ${taxReserved.toFixed(2)}`,
      `Bills due next 30 days: ${currency} ${billsDueNext30Days.toFixed(2)}`,
      `Operating buffer: ${currency} ${operatingBuffer.toFixed(2)}`,
    ];

    explanation.push(
      payrollRuns > 0
        ? `Payroll reserved: ${currency} ${payrollReserved.toFixed(2)} (${payrollRuns} committed run${payrollRuns === 1 ? '' : 's'})`
        : `Payroll reserved: ${currency} ${payrollReserved.toFixed(2)} (no unpaid runs)`,
    );
    if (draftRuns > 0) {
      explanation.push(
        `  - includes ${draftRuns} draft run${draftRuns === 1 ? '' : 's'} not yet approved: ${currency} ${fromCents(draftCents).toFixed(2)}`,
      );
    }
    for (const o of otherPayroll) {
      const runs = payrollRunsByCurrency.get(o.currency) ?? 0;
      explanation.push(
        `Payroll committed in ${o.currency}, not included (never added to ${currency}): ${o.currency} ${o.amount.toFixed(2)} (${runs} run${runs === 1 ? '' : 's'})`,
      );
    }
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
      otherCurrencyCash: otherCash,
      otherCurrencyPayroll: otherPayroll,
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
