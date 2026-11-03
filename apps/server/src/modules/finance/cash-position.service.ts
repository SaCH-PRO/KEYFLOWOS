import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { roundMoney } from '../commerce/money';
import { normalizeCurrency } from './posting.service';

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

/** The currency a business with none recorded keeps (the column default). */
const DEFAULT_CURRENCY = 'TTD';

/**
 * V1-37b review RV37b-CR-01, as FinanceAccountsService.backfillOpeningBalances
 * applies it: before V1-37b account create stored this literal whenever no
 * currency was sent, so on a business that keeps another currency a legacy row
 * holding it is read as that default (the backfill posts it in the business
 * currency and corrects the row).
 */
const LEGACY_DEFAULT_ACCOUNT_CURRENCY = 'TTD';

export interface CashPositionAccount {
  /** ChartOfAccount.id */
  accountId: string;
  systemKey: string | null;
  name: string;
  /**
   * V1-37c: the normalized currency of `balance`. One row per (account,
   * currency); an account with no booked entries reads one zero row in the
   * business currency.
   */
  currency: string;
  /** Net debit - credit of the account's booked entries in `currency`, rounded to cents. */
  balance: number;
}

/** An opening balance recorded on an account that has not reached the ledger yet. */
export interface UnpostedOpeningBalance {
  /** FinancialAccount.id */
  financialAccountId: string;
  name: string;
  type: string;
  /** V1-37c: the currency the opening is bridged in (the one the backfill posts it in). */
  currency: string;
  /** FinancialAccount.openingBalance, rounded to cents. */
  amount: number;
}

export interface CashPosition {
  /**
   * The business's cash IN ITS OWN CURRENCY (`currency`): the `accounts` rows
   * plus the `unpostedOpeningBalances` in that currency, rounded to cents
   * once. V1-37c (D-13): cash held in another currency is never added to it;
   * it is in `byCurrency`.
   */
  cashBalance: number;
  /** V1-37c: the business currency (normalized), the currency of cashBalance. */
  currency: string;
  /**
   * V1-37c: the cash in each currency it is held in (normalized code -> cent-
   * rounded figure), the business currency always among them. No figure adds
   * two currencies; none is converted.
   */
  byCurrency: Record<string, number>;
  /**
   * Always 'ledger': derived from LedgerEntry rows (plus, until it is posted,
   * an account's recorded opening balance), never from FinancialAccount.currentBalance.
   */
  basis: 'ledger';
  accounts: CashPositionAccount[];
  /** Opening balances on active cash-class accounts not yet posted (bridged into their currency's figure). */
  unpostedOpeningBalances: UnpostedOpeningBalance[];
}

/** V1-37c: cash held in a currency other than the business currency (never part of cashBalance). */
export interface OtherCurrencyCash {
  currency: string;
  amount: number;
}

/**
 * V1-37c: the non-zero cash a position holds outside its business currency,
 * by currency code; what a reader of cashBalance says is held apart.
 */
export function otherCurrencyCash(position: Pick<CashPosition, 'currency' | 'byCurrency'>): OtherCurrencyCash[] {
  return Object.entries(position.byCurrency ?? {})
    .filter(([code, amount]) => code !== position.currency && amount !== 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, amount]) => ({ currency, amount }));
}

const D = Prisma.Decimal;
const ZERO = new D(0);

/** A ledger Decimal (numeric(18,4)) as a cent-rounded number (D-13). */
function toMoney(value: Prisma.Decimal): number {
  return roundMoney(Number(value.toString()));
}

/**
 * The currency an unposted opening is bridged in: the one
 * FinanceAccountsService.backfillOpeningBalances posts it in, so the backfill
 * never moves a figure. The row's normalized currency, except the pre-V1-37b
 * literal default on a business that keeps another currency (RV37b-CR-01).
 */
function openingCurrency(stored: string | null | undefined, businessCurrency: string): string {
  const code = normalizeCurrency(stored);
  if (code === LEGACY_DEFAULT_ACCOUNT_CURRENCY && businessCurrency !== LEGACY_DEFAULT_ACCOUNT_CURRENCY) return businessCurrency;
  return code || businessCurrency;
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
 *
 * V1-37c-CURRENCY-NORMALIZE-CASH (VL-05; D-13: one currency per business, no
 * heterogeneous sums): the entries were grouped by account only, so a TTD
 * business's USD cash was added to its TTD cash into one unlabelled figure
 * (TTD 100 + USD 550 read 650). The entries are now grouped by account and
 * currency, each code normalized (trimmed, upper-case: a legacy 'ttd' row is
 * TTD), and each unposted opening is bridged in its own currency. cashBalance
 * is the business currency's figure, labelled by `currency`; every currency's
 * figure is in `byCurrency`; nothing is summed across currencies or converted.
 * Safe-to-spend and the OS command center report the other currencies apart
 * (otherCurrencyCash). The Finance overview (finance-overview.service.ts, outside
 * V1-37c) serves cashBalance only and does not yet (review CR-37c-01; it.todo
 * CP-17 and CP-18 in test/cash-position.integration.test.ts).
 */
@Injectable()
export class CashPositionService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getCashPosition(businessId: string): Promise<CashPosition> {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { currency: true },
    });
    const currency = normalizeCurrency(business?.currency) || DEFAULT_CURRENCY;
    const [ledgerAccounts, unposted] = await Promise.all([
      this.ledgerAccounts(businessId, currency),
      this.unpostedOpenings(businessId, currency),
    ]);

    // Per currency, never across currencies; the business currency always present.
    const totals = new Map<string, Prisma.Decimal>([[currency, ZERO]]);
    const add = (code: string, amount: Prisma.Decimal) => totals.set(code, (totals.get(code) ?? ZERO).add(amount));
    for (const a of ledgerAccounts) add(a.currency, a.net);
    for (const o of unposted) add(o.currency, o.amount);
    const byCurrency: Record<string, number> = {};
    for (const code of [...totals.keys()].sort()) byCurrency[code] = toMoney(totals.get(code) ?? ZERO);

    return {
      cashBalance: byCurrency[currency],
      currency,
      byCurrency,
      basis: 'ledger',
      accounts: ledgerAccounts.map((a) => ({
        accountId: a.accountId,
        systemKey: a.systemKey,
        name: a.name,
        currency: a.currency,
        balance: toMoney(a.net),
      })),
      unpostedOpeningBalances: unposted.map((o) => ({
        financialAccountId: o.financialAccountId,
        name: o.name,
        type: o.type,
        currency: o.currency,
        amount: toMoney(o.amount),
      })),
    };
  }

  /**
   * The booked net (debit - credit) of each of the business's cash-class chart
   * rows, per normalized currency (V1-37c). An idle row reads one zero in the
   * business currency.
   */
  private async ledgerAccounts(businessId: string, businessCurrency: string) {
    const cashAccounts = await this.prisma.client.chartOfAccount.findMany({
      where: { businessId, systemKey: { in: [...CASH_POSITION_SYSTEM_KEYS] } },
      select: { id: true, name: true, systemKey: true },
    });
    if (cashAccounts.length === 0) return [];

    const grouped = await this.prisma.client.ledgerEntry.groupBy({
      by: ['accountId', 'currency'],
      where: {
        businessId,
        accountId: { in: cashAccounts.map((a) => a.id) },
        transaction: { status: { in: BOOKED_TRANSACTION_STATUSES } },
      },
      _sum: { debit: true, credit: true },
    });
    // account -> normalized currency -> net: 'ttd' and 'TTD' groups fold into one.
    const netById = new Map<string, Map<string, Prisma.Decimal>>();
    for (const g of grouped) {
      const code = normalizeCurrency(g.currency) || businessCurrency;
      const perAccount = netById.get(g.accountId) ?? new Map<string, Prisma.Decimal>();
      const net = new D(String(g._sum.debit ?? 0)).sub(new D(String(g._sum.credit ?? 0)));
      perAccount.set(code, (perAccount.get(code) ?? ZERO).add(net));
      netById.set(g.accountId, perAccount);
    }

    return cashAccounts.flatMap((a) => {
      const nets = [...(netById.get(a.id)?.entries() ?? [])].sort(([x], [y]) => x.localeCompare(y));
      return (nets.length > 0 ? nets : [[businessCurrency, ZERO] as const]).map(([code, net]) => ({
        accountId: a.id,
        systemKey: a.systemKey ?? null,
        name: a.name,
        currency: code,
        net,
      }));
    });
  }

  /** Opening balances on the business's active cash-class accounts with no booked opening posting. */
  private async unpostedOpenings(businessId: string, businessCurrency: string) {
    const rows = await this.prisma.client.financialAccount.findMany({
      where: {
        businessId,
        isActive: true,
        type: { in: [...CASH_POSITION_ACCOUNT_TYPES] },
        openingBalance: { not: 0 },
      },
      select: { id: true, name: true, type: true, currency: true, openingBalance: true },
    });
    const withOpening = rows
      .map((r) => ({
        financialAccountId: r.id,
        name: r.name,
        type: r.type,
        // V1-37c: bridged in the currency the backfill posts it in.
        currency: openingCurrency(r.currency, businessCurrency),
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
