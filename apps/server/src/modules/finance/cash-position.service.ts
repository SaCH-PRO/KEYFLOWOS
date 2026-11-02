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
 * The FinancialAccount types whose opening balance is cash (the same three
 * classes, as FinancialAccount.type spells them). The cockpit summed exactly
 * these, active only, before V1-34.
 */
export const CASH_POSITION_ACCOUNT_TYPES = ['CASH', 'BANK', 'PAYMENT_PROCESSOR'] as const;

/**
 * How an account's opening balance is recognised as posted: a booked
 * FinancialTransaction of this type whose (sourceType, sourceId) is
 * ('FinancialAccount', the account's id). A follow-up that posts the opening
 * at FinanceAccountsService.create (and backfills older accounts) must post it
 * this way; the bridge below then stops contributing for that account.
 */
export const OPENING_BALANCE_POSTING = { type: 'OPENING_BALANCE', sourceType: 'FinancialAccount' } as const;

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

/** An opening balance recorded on an account that has not reached the ledger yet. */
export interface UnpostedOpeningBalance {
  /** FinancialAccount.id */
  financialAccountId: string;
  name: string;
  type: string;
  /** FinancialAccount.openingBalance, rounded to cents. */
  amount: number;
}

export interface CashPosition {
  /**
   * The business's cash: the sum of `accounts` plus `unpostedOpeningBalances`,
   * rounded to cents once.
   */
  cashBalance: number;
  /**
   * Always 'ledger': derived from LedgerEntry rows (plus, until it is posted,
   * an account's recorded opening balance), never from FinancialAccount.currentBalance.
   */
  basis: 'ledger';
  accounts: CashPositionAccount[];
  /** Opening balances on active cash-class accounts not yet posted (bridged into cashBalance). */
  unpostedOpeningBalances: UnpostedOpeningBalance[];
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
 * Opening-balance bridge (V1-34 review CR-34-01): FinanceAccountsService.create
 * (the Books > Accounts 'Opening balance' field) records the opening on the
 * account row only and posts nothing. So that such an opening is not dropped
 * from the cockpit, the recorded openingBalance of each active CASH, BANK or
 * PAYMENT_PROCESSOR FinancialAccount is added until a booked OPENING_BALANCE
 * posting sourced from that account (OPENING_BALANCE_POSTING) exists; from
 * then on the ledger carries it, so it is never counted twice. currentBalance
 * is never read.
 *
 * Tenant scope: the chart-of-account rows, the entries, the FinancialAccount
 * rows and the opening postings are all selected by businessId, so another
 * tenant's entries or postings are never summed or matched, whatever chart row
 * a FinancialAccount points at.
 *
 * Every cockpit reader of cash (safe-to-spend, the OS command center and the
 * Finance overview) consumes this one figure.
 */
@Injectable()
export class CashPositionService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getCashPosition(businessId: string): Promise<CashPosition> {
    const [ledgerAccounts, unposted] = await Promise.all([
      this.ledgerAccounts(businessId),
      this.unpostedOpenings(businessId),
    ]);

    let total = ZERO;
    for (const a of ledgerAccounts) total = total.add(a.net);
    for (const o of unposted) total = total.add(o.amount);

    return {
      cashBalance: toMoney(total),
      basis: 'ledger',
      accounts: ledgerAccounts.map((a) => ({
        accountId: a.accountId,
        systemKey: a.systemKey,
        name: a.name,
        balance: toMoney(a.net),
      })),
      unpostedOpeningBalances: unposted.map((o) => ({
        financialAccountId: o.financialAccountId,
        name: o.name,
        type: o.type,
        amount: toMoney(o.amount),
      })),
    };
  }

  /** The booked net (debit - credit) of each of the business's cash-class chart rows. */
  private async ledgerAccounts(businessId: string) {
    const cashAccounts = await this.prisma.client.chartOfAccount.findMany({
      where: { businessId, systemKey: { in: [...CASH_POSITION_SYSTEM_KEYS] } },
      select: { id: true, name: true, systemKey: true },
    });
    if (cashAccounts.length === 0) return [];

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

    return cashAccounts.map((a) => ({
      accountId: a.id,
      systemKey: a.systemKey ?? null,
      name: a.name,
      net: netById.get(a.id) ?? ZERO,
    }));
  }

  /** Opening balances on the business's active cash-class accounts with no booked opening posting. */
  private async unpostedOpenings(businessId: string) {
    const rows = await this.prisma.client.financialAccount.findMany({
      where: {
        businessId,
        isActive: true,
        type: { in: [...CASH_POSITION_ACCOUNT_TYPES] },
        openingBalance: { not: 0 },
      },
      select: { id: true, name: true, type: true, openingBalance: true },
    });
    const withOpening = rows
      .map((r) => ({
        financialAccountId: r.id,
        name: r.name,
        type: r.type,
        amount: new D(String(r.openingBalance ?? 0)),
      }))
      .filter((r) => r.financialAccountId && !r.amount.isZero());
    if (withOpening.length === 0) return [];

    const posted = await this.prisma.client.financialTransaction.findMany({
      where: {
        businessId,
        type: OPENING_BALANCE_POSTING.type,
        sourceType: OPENING_BALANCE_POSTING.sourceType,
        sourceId: { in: withOpening.map((r) => r.financialAccountId) },
        status: { in: BOOKED_TRANSACTION_STATUSES },
      },
      select: { sourceId: true },
    });
    const postedIds = new Set(posted.map((t) => t.sourceId));
    return withOpening.filter((r) => !postedIds.has(r.financialAccountId));
  }
}
