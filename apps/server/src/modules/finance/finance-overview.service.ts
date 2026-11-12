import { Inject, Injectable, Optional } from '@nestjs/common';
import type { Prisma, RevenueAction } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { RedisService } from '../../core/redis/redis.service';
import { CashPositionService, otherCurrencyCash, type CashPosition, type OtherCurrencyCash } from './cash-position.service';
import { FinancialAccountSeederService } from './financial-account-seeder.service';
import { D13_CURRENCIES } from './posting.service';
import { ReceivablesService } from './receivables.service';
import { CASH_NET_PAYMENT_WHERE } from '../commerce/invoice-workflow.service';
import { roundMoney } from '../commerce/money';
import { REVENUE_ACTION_SCAN_LIMIT, servedRevenueActions } from '../commerce/revenue-action.controller';
import { visibilityClause } from '../crm/crm-permissions.helper';
import type { TimelineViewer } from '../timeline/timeline-visibility';

/**
 * FIN5 — Compute the start of the current month in America/Port_of_Spain
 * (AST, UTC-4, no DST). All Finance month-to-date KPIs anchor on this so
 * boundary times don't flip the figure under the user's feet at midnight.
 */
function trinidadMonthStart(now: Date): Date {
  const offsetMs = 4 * 3600 * 1000;
  const trinidadNow = new Date(now.getTime() - offsetMs);
  return new Date(Date.UTC(
    trinidadNow.getUTCFullYear(),
    trinidadNow.getUTCMonth(),
    1,
    4, 0, 0, 0,
  ));
}

function trinidadMonthOffset(now: Date, monthsBack: number): Date {
  const offsetMs = 4 * 3600 * 1000;
  const trinidadNow = new Date(now.getTime() - offsetMs);
  return new Date(Date.UTC(
    trinidadNow.getUTCFullYear(),
    trinidadNow.getUTCMonth() - monthsBack,
    1,
    4, 0, 0, 0,
  ));
}

export interface FinanceOverviewActionItem {
  id: string;
  title: string;
  detail: string | null;
  amountAtRisk: number | null;
  status: string;
  type: string;
  createdAt: string;
}

export interface FinanceOverview {
  /**
   * The ledger cash position (CashPositionService), never FinancialAccount.currentBalance.
   * V1-37c: the business currency's cash only (labelled by `cashCurrency`).
   */
  cashBalance: number;
  /** V1-34: how cashBalance was derived. */
  cashBasis: 'ledger';
  /**
   * W9-FINANCE-OVERVIEW (CP-17, review CR-37c-01, D-13): the currency of cashBalance, the business
   * currency normalized (CashPosition.currency), as the OS command center labels it.
   */
  cashCurrency: string;
  /**
   * W9-FINANCE-OVERVIEW (CP-17, D-13): cash held in another currency, by currency, as safe-to-spend
   * and the OS command center report it (otherCurrencyCash); never added to cashBalance nor to the
   * runway. Empty when there is none.
   */
  otherCurrencyCash: OtherCurrencyCash[];
  cashAccountCount: number;
  revenueThisMonth: number;
  expensesThisMonth: number;
  netProfitThisMonth: number;
  outstandingInvoices: number;
  outstandingInvoiceCount: number;
  overdueInvoices: number;
  overdueInvoiceCount: number;
  billsDue: number;
  billsDueCount: number;
  taxReserved: number;
  cashRunwayMonths: number | null;
  /**
   * The PENDING revenue actions; for a member served the queue in part (TS-22g, D-63), those they
   * are served of the first REVENUE_ACTION_SCAN_LIMIT, as GET revenue-actions fills its page.
   */
  pendingActionCount: number;
  /** The 25 highest-risk PENDING revenue actions the member is served (TS-22g, D-63). */
  actions: FinanceOverviewActionItem[];
  /** The business currency, normalized (CP-17, D-13): every figure here is in it. */
  currency: string;
}

/** The overview's page of the queue: the highest-risk PENDING revenue actions, in this order. */
const OVERVIEW_ACTION_LIMIT = 25;
const OVERVIEW_ACTION_ORDER: Prisma.RevenueActionOrderByWithRelationInput[] = [
  { amountAtRisk: 'desc' },
  { priority: 'asc' },
  { createdAt: 'desc' },
];

function toActionItem(a: RevenueAction): FinanceOverviewActionItem {
  return {
    id: a.id,
    title: a.title,
    detail: a.detail ?? null,
    amountAtRisk: a.amountAtRisk != null ? Number(a.amountAtRisk) : null,
    status: a.status,
    type: a.type,
    createdAt: a.createdAt.toISOString(),
  };
}

/**
 * W9-FINANCE-OVERVIEW (CP-17, D-13): the overview's cash labels, from the cash position read fresh
 * on every call, applied to a cached overview too, so a business currency stored un-normalized
 * ('ttd') is never served stale. (W10-LOW-RUNWAY, D-107: the cache is now also checked against the
 * other-currency cash, which the LOW_RUNWAY action's text lists; see sameOtherCurrencyCash.)
 */
function cashLabels(position: CashPosition): Pick<FinanceOverview, 'cashCurrency' | 'otherCurrencyCash' | 'currency'> {
  return { cashCurrency: position.currency, otherCurrencyCash: otherCurrencyCash(position), currency: position.currency };
}

/**
 * W10-LOW-RUNWAY (owner ruling D-107; review CR-37c-01, CP-18): whether a cached overview's
 * other-currency cash is the cash position's now. The LOW_RUNWAY action's text lists that cash, so a
 * cached overview whose other-currency figures moved is recomputed (the action upserted with them),
 * as one whose business-currency cash moved is; an entry cached without them is recomputed too.
 */
function sameOtherCurrencyCash(cached: OtherCurrencyCash[] | undefined, now: OtherCurrencyCash[]): boolean {
  return Array.isArray(cached)
    && cached.length === now.length
    && cached.every((o, i) => o?.currency === now[i].currency && o?.amount === now[i].amount);
}

/**
 * W10-LOW-RUNWAY review SEC-W10LR-1 (owner ruling D-107): a currency code the LOW_RUNWAY text may
 * name. FinancialAccount.currency is free text (create only normalizes it, PATCH stores it raw, and
 * the account routes check membership only), and the cash position bridges an unposted opening under
 * whatever label its row holds, so a label is named only when it is a three-letter code.
 */
const LOW_RUNWAY_CURRENCY_CODE = /^[A-Z]{3}$/;

/** SEC-W10LR-1 (D-107): the most other currencies the LOW_RUNWAY text names; the rest are counted. */
export const LOW_RUNWAY_LISTED_CURRENCY_LIMIT = 5;

/**
 * W10-LOW-RUNWAY (owner ruling D-107; review CR-37c-01, CP-18): the LOW_RUNWAY action's text. The
 * runway stays computed from the business currency's cash alone (cashBalance, `cashCurrency`); cash
 * held in another currency is never added to it nor converted (no exchange rate, D-13), and the
 * alarm is never silent beside it: the text lists each other currency's cash, unconverted, in code
 * order. With no other-currency cash the text is as it was. The action is served only to revenue
 * readers (the overview and GET revenue-actions need revenue read: D-63, D-100), who are served that
 * cash on the overview and safe-to-spend too, so no viewer it reaches has the figures withheld.
 *
 * Review SEC-W10LR-1 (D-107, CP-19): the text is the owner's priority-1 alarm, persisted, shown on
 * the Finance overview and the revenue-actions queue and put into the KEY chat prompt, and a member
 * can write an account currency label. So it names only cash held under a three-letter code, at most
 * LOW_RUNWAY_LISTED_CURRENCY_LIMIT of them (D-13's currencies first, then the others in code order;
 * listed in code order), and counts the rest: a label that is not a code is never echoed (its
 * amount is counted, never added to another), and the text stays bounded whatever the labels are.
 *
 * Review CR-W10LR-1 (D-107, never a silent alarm): every web reader shows this text on one
 * truncated line (the overview's action queue, the revenue-actions queue), so the figures come right
 * after the runway, before any explanation: "~1.5 months at current burn (TTD cash only). Not
 * counted: USD 625.00." The figures are in their own currency, never converted. Letting the line
 * wrap is a web follow-up outside this packet.
 */
export function lowRunwayDetail(runwayMonths: number, cashCurrency: string, other: OtherCurrencyCash[]): string {
  const runway = `~${runwayMonths.toFixed(1)} months at current burn`;
  if (other.length === 0) return runway;
  const coded = other.filter((o) => LOW_RUNWAY_CURRENCY_CODE.test(o.currency));
  const named = new Set([
    ...coded.filter((o) => D13_CURRENCIES.includes(o.currency)),
    ...coded.filter((o) => !D13_CURRENCIES.includes(o.currency)),
  ].slice(0, LOW_RUNWAY_LISTED_CURRENCY_LIMIT));
  const parts: string[] = [];
  const listed = coded.filter((o) => named.has(o)).map((o) => `${o.currency} ${o.amount.toFixed(2)}`);
  if (listed.length > 0) parts.push(listed.join(', '));
  const unlisted = coded.length - named.size;
  if (unlisted > 0) parts.push(`${unlisted} more ${unlisted === 1 ? 'currency' : 'currencies'} (not listed)`);
  const unlabelled = other.length - coded.length;
  if (unlabelled > 0) {
    parts.push(unlabelled === 1
      ? '1 amount held under a label that is not a currency code (label not shown)'
      : `${unlabelled} amounts held under labels that are not currency codes (labels not shown)`);
  }
  // The business currency is normalized Business.currency: named only when it is a code too.
  const from = LOW_RUNWAY_CURRENCY_CODE.test(cashCurrency) ? `${cashCurrency} cash` : 'business-currency cash';
  // CR-W10LR-1: the figures first, so a one-line (truncated) reader still shows them.
  return `${runway} (${from} only). Not counted: ${parts.join('; ')}.`;
}

/**
 * Whether the member opens every contact of the business (crm read, and visibilityClause does not
 * restrict them): the revenue-actions routes' own test (revenue-action.controller.ts
 * opensEveryContact), under which servedRevenueActions withholds nothing.
 */
function opensEveryContact(viewer: TimelineViewer): boolean {
  return viewer.readable.has('crm') && !visibilityClause(viewer.crmAccess, viewer.userId);
}

/**
 * FIN5 — Aggregates the headline numbers for the Finance Overview tab.
 * Cash is the ledger cash position (V1-34, CashPositionService: the booked
 * entries on the CASH, BANK and PAYMENT_PROCESSOR chart rows, plus account
 * opening balances not yet posted), the figure safe-to-spend and the OS command
 * center serve too, read fresh even when the rest is cached; FinancialAccount
 * rows only give the account count. Invoice/Payment/Expense tables feed the rest,
 * and the Tax Payable holding account is read from the ledger so the figure
 * shown matches what the accountant sees in Reports.
 *
 * W9-FINANCE-OVERVIEW (CP-17, review CR-37c-01, D-13): cashBalance is the
 * business currency's cash, labelled cashCurrency; cash in another currency is
 * reported apart (otherCurrencyCash), as safe-to-spend and the OS command
 * center report it, never added. (TS-22g, D-63): the revenue actions are served
 * to the member as GET revenue-actions serves them (getOverview's viewer).
 */
@Injectable()
export class FinanceOverviewService {
  private readonly cashPosition: CashPositionService;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Optional() @Inject(FinancialAccountSeederService) private readonly accountSeeder: FinancialAccountSeederService | null,
    @Optional() @Inject(ReceivablesService) private readonly receivables: ReceivablesService | null,
    @Optional() @Inject(RedisService) private readonly redis: RedisService | null,
    // Optional like its siblings so hand-built instances keep working; it needs only Prisma.
    @Optional() @Inject(CashPositionService) cashPosition?: CashPositionService | null,
  ) {
    this.cashPosition = cashPosition ?? new CashPositionService(prisma);
  }

  private cacheKey(businessId: string) {
    return `finance:overview:${businessId}`;
  }

  async invalidateCache(businessId: string) {
    if (this.redis) {
      await this.redis.del(this.cacheKey(businessId)).catch(() => {});
    }
  }

  /**
   * W9-FINANCE-OVERVIEW (TS-22g; review SEC-W8RA-4, CR-W8RA-2; owner ruling D-63): `viewer` is the
   * member the route serves. The overview computed and cached is the business's (every PENDING
   * action, as KEYFLOW Today / R3 share it); a member who may not open every contact is then served
   * only the actions GET revenue-actions serves them (servedForViewer). Without a viewer (an
   * internal reader), the business's overview is returned.
   */
  async getOverview(businessId: string, viewer?: TimelineViewer | null): Promise<FinanceOverview> {
    return this.servedForViewer(businessId, await this.businessOverview(businessId), viewer ?? null);
  }

  /**
   * TS-22g (D-63): the overview as `viewer` may be served it. A member who opens every contact is
   * served the business's overview as it is. Any other member is served, from the PENDING queue
   * read fresh (never the cached actions, which are the business's), the actions
   * servedRevenueActions (revenue-action.controller.ts) serves them, in the overview's order,
   * filled past the ones withheld to its 25 within the first REVENUE_ACTION_SCAN_LIMIT, as GET
   * revenue-actions fills its page; pendingActionCount counts what they are served there.
   */
  private async servedForViewer(businessId: string, overview: FinanceOverview, viewer: TimelineViewer | null): Promise<FinanceOverview> {
    if (!viewer || opensEveryContact(viewer)) return overview;
    const scanned = await this.prisma.client.revenueAction.findMany({
      where: { businessId, status: 'PENDING' },
      orderBy: OVERVIEW_ACTION_ORDER,
      take: REVENUE_ACTION_SCAN_LIMIT,
    });
    const served = await servedRevenueActions(this.prisma, viewer, scanned);
    return {
      ...overview,
      actions: served.slice(0, OVERVIEW_ACTION_LIMIT).map(toActionItem),
      pendingActionCount: served.length,
    };
  }

  /** The business's overview (every PENDING action), from the 60s cache when its cash still holds. */
  private async businessOverview(businessId: string): Promise<FinanceOverview> {
    const cacheKey = this.cacheKey(businessId);
    // V1-34 review (V34-SEC-01 / CR-34-02): the cash position is read fresh on
    // every call, outside the 60s cache. Nothing invalidates the cache when the
    // ledger posts, so a cached overview is served only while its cash equals
    // the ledger's now; otherwise it is recomputed (cash, runway and the
    // low-runway action together) and re-cached. Safe-to-spend, the OS command
    // center and this overview therefore never serve different cash.
    // W10-LOW-RUNWAY (D-107, CP-18): nor while other-currency cash moved, which the low-runway
    // action's text lists (sameOtherCurrencyCash).
    const cashPosition = await this.cashPosition.getCashPosition(businessId);
    const otherCash = otherCurrencyCash(cashPosition);
    if (this.redis) {
      const cached = await this.redis.getJson<FinanceOverview>(cacheKey).catch(() => null);
      if (
        cached
        && cached.cashBasis === cashPosition.basis
        && cached.cashBalance === cashPosition.cashBalance
        && sameOtherCurrencyCash(cached.otherCurrencyCash, otherCash)
      ) {
        return { ...cached, ...cashLabels(cashPosition) };
      }
    }

    // First read of the surface seeds the default Cash + Bank accounts +
    // system COA so the numbers below are never zero on a clean install.
    if (this.accountSeeder) {
      await this.accountSeeder.ensureDefaults(businessId);
    }

    const now = new Date();
    const monthStart = trinidadMonthStart(now);
    const sixMonthsAgo = trinidadMonthOffset(now, 6);

    const [
      cashAccounts,
      paidInvoices,
      monthExpenses,
      outstandingAgg,
      overdueAgg,
      pendingActionItems,
      taxPayable,
      lastSixExpenses,
      billsDueAgg,
      uncategorisedExpenses,
      missingReceiptExpenses,
      overdueInvoiceList,
      recurringBills,
      receivablesAging,
    ] = await Promise.all([
      // The account count only: currentBalance is an opening snapshot (V1-34, CF-41).
      this.prisma.client.financialAccount.findMany({
        where: { businessId, isActive: true, type: { in: ['CASH', 'BANK', 'PAYMENT_PROCESSOR'] } },
        select: { id: true },
      }),
      // V1-36 (CF-17): cash received this month net of refunds (CASH_NET_PAYMENT_WHERE,
      // the database form of computeBalance); SUCCESSFUL rows alone counted refunded money.
      this.prisma.client.payment.aggregate({
        where: { businessId, createdAt: { gte: monthStart }, ...CASH_NET_PAYMENT_WHERE },
        _sum: { amount: true },
      }),
      this.prisma.client.expense.aggregate({
        where: { businessId, date: { gte: monthStart } },
        _sum: { amount: true },
      }),
      this.prisma.client.invoice.aggregate({
        where: { businessId, deletedAt: null, status: { in: ['SENT', 'OVERDUE', 'PARTIALLY_PAID'] } },
        _sum: { total: true },
        _count: true,
      }),
      this.prisma.client.invoice.aggregate({
        where: { businessId, deletedAt: null, status: 'OVERDUE' },
        _sum: { total: true },
        _count: true,
      }),
      // pendingActions count superseded by post-upsert read below
      this.prisma.client.revenueAction.findMany({
        where: { businessId, status: 'PENDING' },
        orderBy: [{ amountAtRisk: 'desc' }, { createdAt: 'desc' }],
        take: 10,
      }),
      this.prisma.client.chartOfAccount.findFirst({
        where: { businessId, systemKey: 'TAX_PAYABLE' },
        select: { id: true },
      }),
      this.prisma.client.expense.aggregate({
        where: {
          businessId,
          date: { gte: sixMonthsAgo, lt: monthStart },
        },
        _sum: { amount: true },
      }),
      this.prisma.client.expense.aggregate({
        where: {
          businessId,
          isRecurring: true,
          date: { gte: monthStart },
        },
        _sum: { amount: true },
        _count: true,
      }),
      // FIN5 action-queue inputs: synthesise non-revenue finance actions
      // (categorisation, receipts, overdue invoices, bills due) so the
      // queue isn't only commerce-driven.
      this.prisma.client.expense.findMany({
        where: { businessId, categoryId: null },
        orderBy: [{ amount: 'desc' }],
        take: 5,
        select: { id: true, amount: true, vendor: true, date: true },
      }),
      this.prisma.client.expense.findMany({
        where: { businessId, receiptUrl: null, amount: { gte: 100 } },
        orderBy: [{ amount: 'desc' }],
        take: 5,
        select: { id: true, amount: true, vendor: true, date: true },
      }),
      this.prisma.client.invoice.findMany({
        where: { businessId, deletedAt: null, status: 'OVERDUE' },
        orderBy: [{ total: 'desc' }],
        take: 5,
        select: { id: true, total: true, invoiceNumber: true, dueDate: true },
      }),
      this.prisma.client.expense.findMany({
        where: { businessId, isRecurring: true, date: { gte: monthStart } },
        orderBy: [{ amount: 'desc' }],
        take: 5,
        select: { id: true, amount: true, vendor: true, description: true, date: true },
      }),
      this.receivables ? this.receivables.getAging(businessId) : Promise.resolve(null),
    ]);

    const cashBalance = cashPosition.cashBalance;

    let taxReserved = 0;
    if (taxPayable) {
      const agg = await this.prisma.client.ledgerEntry.aggregate({
        where: { accountId: taxPayable.id },
        _sum: { debit: true, credit: true },
      });
      // Liability accounts: positive = credit > debit.
      taxReserved = Number(agg._sum.credit ?? 0) - Number(agg._sum.debit ?? 0);
    }

    const revenueThisMonth = roundMoney(Number(paidInvoices._sum.amount ?? 0));
    const expensesThisMonth = Number(monthExpenses._sum.amount ?? 0);
    const netProfitThisMonth = revenueThisMonth - expensesThisMonth;

    // Cash runway = cashBalance / (avg monthly burn over last 6 months).
    const sixMonthBurn = Number(lastSixExpenses._sum.amount ?? 0);
    const avgMonthlyBurn = sixMonthBurn > 0 ? sixMonthBurn / 6 : 0;
    const cashRunwayMonths = avgMonthlyBurn > 0 ? cashBalance / avgMonthlyBurn : null;

    // FIN5 — Upsert finance-wide synthetic actions into RevenueAction so
    // they propagate to KEYFLOW Today / R3 (single source of truth). Keyed
    // on the unique constraint (businessId, type, relatedType, relatedId)
    // so repeated overview loads are idempotent.
    type SyntheticSpec = {
      type: string;
      relatedType: string;
      relatedId: string;
      title: string;
      detail: string | null;
      amountAtRisk: number;
      priority: number;
    };
    const specs: SyntheticSpec[] = [
      ...overdueInvoiceList.map<SyntheticSpec>((inv) => ({
        type: 'OVERDUE_INVOICE',
        relatedType: 'invoice',
        relatedId: inv.id,
        title: `Chase overdue invoice ${inv.invoiceNumber ?? ''}`.trim(),
        detail: inv.dueDate ? `Due ${inv.dueDate.toISOString().slice(0, 10)}` : null,
        amountAtRisk: Number(inv.total ?? 0),
        priority: 1,
      })),
      ...uncategorisedExpenses.map<SyntheticSpec>((e) => ({
        type: 'UNCATEGORISED_EXPENSE',
        relatedType: 'expense',
        relatedId: e.id,
        title: 'Categorise expense',
        detail: `${e.vendor ?? 'Unknown vendor'} · ${e.date.toISOString().slice(0, 10)}`,
        amountAtRisk: Number(e.amount ?? 0),
        priority: 3,
      })),
      ...missingReceiptExpenses.map<SyntheticSpec>((e) => ({
        type: 'MISSING_RECEIPT',
        relatedType: 'expense',
        relatedId: e.id,
        title: 'Attach receipt',
        detail: `${e.vendor ?? 'Unknown vendor'} · ${e.date.toISOString().slice(0, 10)}`,
        amountAtRisk: Number(e.amount ?? 0),
        priority: 3,
      })),
      ...recurringBills.map<SyntheticSpec>((b) => ({
        type: 'BILL_DUE',
        relatedType: 'expense',
        relatedId: b.id,
        title: `Bill due: ${b.description ?? b.vendor ?? 'Recurring expense'}`,
        detail: b.vendor ?? null,
        amountAtRisk: Number(b.amount ?? 0),
        priority: 2,
      })),
    ];
    // W10-LOW-RUNWAY (D-107, CP-18): computed from business-currency cash; the text lists the cash
    // held in every other currency, unconverted (lowRunwayDetail): only three-letter codes, at most
    // five, the rest counted, never a label echoed (review SEC-W10LR-1, CP-19).
    if (cashRunwayMonths != null && cashRunwayMonths < 2) {
      specs.push({
        type: 'LOW_RUNWAY',
        relatedType: 'business',
        relatedId: businessId,
        title: 'Low cash runway',
        detail: lowRunwayDetail(cashRunwayMonths, cashPosition.currency, otherCash),
        amountAtRisk: cashBalance,
        priority: 1,
      });
    }
    if (specs.length > 0) {
      await Promise.all(specs.map((s) =>
        this.prisma.client.revenueAction.upsert({
          where: {
            businessId_type_relatedType_relatedId: {
              businessId,
              type: s.type,
              relatedType: s.relatedType,
              relatedId: s.relatedId,
            },
          },
          create: {
            businessId,
            type: s.type,
            relatedType: s.relatedType,
            relatedId: s.relatedId,
            title: s.title,
            detail: s.detail,
            amountAtRisk: s.amountAtRisk,
            priority: s.priority,
            status: 'PENDING',
          },
          update: {
            title: s.title,
            detail: s.detail,
            amountAtRisk: s.amountAtRisk,
            // Don't reopen actions that the user has dismissed/completed.
          },
        }),
      ));
    }

    // Re-read after upserts so the response and KEYFLOW Today / R3 share
    // the same row set. Cap at 25 highest-risk pending items.
    const blendedItems = await this.prisma.client.revenueAction.findMany({
      where: { businessId, status: 'PENDING' },
      orderBy: OVERVIEW_ACTION_ORDER,
      take: OVERVIEW_ACTION_LIMIT,
    });
    const blendedCount = await this.prisma.client.revenueAction.count({
      where: { businessId, status: 'PENDING' },
    });

    const actions: FinanceOverviewActionItem[] = blendedItems.map(toActionItem);
    void pendingActionItems; // initial sample superseded by post-upsert read

    const result: FinanceOverview = {
      cashBalance,
      cashBasis: cashPosition.basis,
      ...cashLabels(cashPosition),
      cashAccountCount: cashAccounts.length,
      revenueThisMonth,
      expensesThisMonth,
      netProfitThisMonth,
      outstandingInvoices: receivablesAging ? receivablesAging.totalOutstanding : Number(outstandingAgg._sum.total ?? 0),
      outstandingInvoiceCount: outstandingAgg._count,
      overdueInvoices: receivablesAging ? receivablesAging.totalOverdue : Number(overdueAgg._sum.total ?? 0),
      overdueInvoiceCount: overdueAgg._count,
      billsDue: Number(billsDueAgg._sum.amount ?? 0),
      billsDueCount: billsDueAgg._count,
      taxReserved,
      cashRunwayMonths: cashRunwayMonths != null ? Math.round(cashRunwayMonths * 10) / 10 : null,
      pendingActionCount: blendedCount,
      actions,
    };

    if (this.redis) {
      await this.redis.setJson(cacheKey, result, 60).catch(() => {});
    }

    return result;
  }
}
