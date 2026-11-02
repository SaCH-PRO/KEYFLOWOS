import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { roundMoney } from '../commerce/money';

/**
 * The chart-of-account system keys that hold cash: cash on hand, bank, and
 * processor clearing (money a processor holds for the business). CREDIT_CARD
 * is a liability, not cash, so it is not here (the cash-basis P&L reads it as
 * a cash-touching account; a cash position does not).
 */
export const CASH_POSITION_SYSTEM_KEYS = ['CASH', 'BANK', 'PAYMENT_PROCESSOR'] as const;

/**
 * Transaction statuses that are in the books, as the ledger reports read them
 * (ledger-reporting.service.ts BOOKED_TRANSACTION_STATUSES). PostingService
 * never edits an original: reverse() marks it REVERSED and posts a mirrored
 * REVERSAL, and the pair nets to zero only when both are read (V1-15 CR-1).
 */
const BOOKED_TRANSACTION_STATUSES = ['POSTED', 'REVERSED'];

export interface CashPositionAccount {
  /** ChartOfAccount.id */
  accountId: string;
  systemKey: string | null;
  name: string;
  /** Net debit - credit of the account's booked entries, rounded to cents. */
  balance: number;
}

export interface CashPosition {
  /** The business's cash: the sum of `accounts`, rounded to cents once. */
  cashBalance: number;
  /** Always 'ledger': derived from LedgerEntry rows, never from FinancialAccount.currentBalance. */
  basis: 'ledger';
  accounts: CashPositionAccount[];
}

const D = Prisma.Decimal;
const ZERO = new D(0);

/** A ledger Decimal (numeric(18,4)) as a cent-rounded number (D-13). */
function toMoney(value: Prisma.Decimal): number {
  return roundMoney(Number(value.toString()));
}

/**
 * V1-34-DM-CASH-POSITION (CF-41) — the business's cash, read from the ledger.
 *
 * FinancialAccount.currentBalance is an opening snapshot: FinanceAccountsService
 * writes it once at create and nothing updates it, so summing it as live cash
 * left the cockpit's cash unmoved by every payment, refund and expense. The
 * cash position is instead the net (debit - credit) of the business's booked
 * LedgerEntry rows on its CASH, BANK and PAYMENT_PROCESSOR chart-of-account
 * rows, every one of which was written through PostingService (the single
 * ledger door). A reversal nets its original to zero because both statuses are
 * read. Decimal sums are exact; the result is rounded to cents once.
 *
 * Tenant scope: the chart-of-account rows are selected by businessId and the
 * entries by businessId as well, so another tenant's entries are never summed,
 * whatever chart row a FinancialAccount points at.
 *
 * Every cockpit reader of cash (safe-to-spend, the OS command center and the
 * Finance overview) consumes this one figure.
 */
@Injectable()
export class CashPositionService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getCashPosition(businessId: string): Promise<CashPosition> {
    const cashAccounts = await this.prisma.client.chartOfAccount.findMany({
      where: { businessId, systemKey: { in: [...CASH_POSITION_SYSTEM_KEYS] } },
      select: { id: true, name: true, systemKey: true },
    });
    if (cashAccounts.length === 0) return { cashBalance: 0, basis: 'ledger', accounts: [] };

    const grouped = await this.prisma.client.ledgerEntry.groupBy({
      by: ['accountId'],
      where: {
        businessId,
        accountId: { in: cashAccounts.map((a) => a.id) },
        transaction: { status: { in: BOOKED_TRANSACTION_STATUSES } },
      },
      _sum: { debit: true, credit: true },
    });
    const netById = new Map<string, Prisma.Decimal>(
      grouped.map((g) => [
        g.accountId,
        new D(String(g._sum.debit ?? 0)).sub(new D(String(g._sum.credit ?? 0))),
      ]),
    );

    let total = ZERO;
    const accounts = cashAccounts.map((a): CashPositionAccount => {
      const net = netById.get(a.id) ?? ZERO;
      total = total.add(net);
      return { accountId: a.id, systemKey: a.systemKey ?? null, name: a.name, balance: toMoney(net) };
    });

    return { cashBalance: toMoney(total), basis: 'ledger', accounts };
  }
}
