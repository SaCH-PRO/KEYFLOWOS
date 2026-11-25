import { Inject, Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CashPositionService, otherCurrencyCash } from './cash-position.service';
import { notCountedCashNote, notCountedExpenseNote, splitExpensesByCurrency } from './finance-overview.service';

export interface MoneyMoveDto {
  id: string;
  type: string;
  title: string;
  summary: string;
  expectedImpact: number | null;
  currency: string;
  confidence: number;
  riskTier: number;
  effort: 'LOW' | 'MEDIUM' | 'HIGH';
  timeToImpactDays: number | null;
  linkedEntities: Array<{ type: string; id: string; name: string }>;
  recommendedActions: Array<{
    sourceModule: string;
    actionType: string;
    title: string;
    description?: string;
  }>;
}

@Injectable()
export class MoneyMovesService {
  private readonly cashPosition: CashPositionService;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    // W11-RUNWAY-LEDGER-CASH: optional as on FinanceOverviewService, so hand-built instances keep
    // working; it needs only Prisma.
    @Optional() @Inject(CashPositionService) cashPosition?: CashPositionService | null,
  ) {
    this.cashPosition = cashPosition ?? new CashPositionService(prisma);
  }

  async generate(businessId: string): Promise<MoneyMoveDto[]> {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { currency: true },
    });
    const currency = business?.currency ?? 'TTD';

    const now = new Date();
    const moves: MoneyMoveDto[] = [];

    // 1. Collect overdue invoices
    const overdueInvoices = await this.prisma.client.invoice.findMany({
      where: { businessId, deletedAt: null, status: 'OVERDUE' },
      orderBy: [{ total: 'desc' }],
      take: 5,
      select: { id: true, total: true, invoiceNumber: true, contactId: true },
    });
    if (overdueInvoices.length > 0) {
      const total = overdueInvoices.reduce((s, i) => s + Number(i.total ?? 0), 0);
      moves.push({
        id: `mm-collect-${businessId}`,
        type: 'COLLECT_RECEIVABLE',
        title: `Collect ${overdueInvoices.length} overdue invoice${overdueInvoices.length > 1 ? 's' : ''}`,
        summary: `Chasing these invoices could add ${currency} ${total.toFixed(2)} to cash.`,
        expectedImpact: total,
        currency,
        confidence: 75,
        riskTier: 1,
        effort: 'LOW',
        timeToImpactDays: 7,
        linkedEntities: overdueInvoices.map((i) => ({ type: 'invoice', id: i.id, name: i.invoiceNumber ?? 'Invoice' })),
        recommendedActions: [{
          sourceModule: 'finance',
          actionType: 'COLLECT_RECEIVABLE',
          title: 'Send payment reminders',
          description: 'Draft and send reminders for overdue invoices.',
        }],
      });
    }

    // 2. Follow up stale quotes
    const staleDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const staleQuotes = await this.prisma.client.quote.findMany({
      where: { businessId, status: 'SENT', sentAt: { lt: staleDate } },
      orderBy: [{ total: 'desc' }],
      take: 5,
      select: { id: true, total: true, quoteNumber: true },
    });
    if (staleQuotes.length > 0) {
      const total = staleQuotes.reduce((s, q) => s + Number(q.total ?? 0), 0);
      moves.push({
        id: `mm-quotes-${businessId}`,
        type: 'FOLLOW_UP_QUOTE',
        title: `Follow up ${staleQuotes.length} pending quote${staleQuotes.length > 1 ? 's' : ''}`,
        summary: `Converting these quotes could bring in ${currency} ${total.toFixed(2)}.`,
        expectedImpact: total,
        currency,
        confidence: 60,
        riskTier: 1,
        effort: 'LOW',
        timeToImpactDays: 14,
        linkedEntities: staleQuotes.map((q) => ({ type: 'quote', id: q.id, name: q.quoteNumber ?? 'Quote' })),
        recommendedActions: [{
          sourceModule: 'sales',
          actionType: 'FOLLOW_UP_QUOTE',
          title: 'Draft quote follow-ups',
        }],
      });
    }

    // 3. Tax reserve gap
    const openTax = await this.prisma.client.taxLiability.findFirst({
      where: { businessId, status: 'OPEN' },
      orderBy: { periodEnd: 'asc' },
      select: { amountDue: true, periodEnd: true },
    });
    if (openTax && openTax.amountDue) {
      moves.push({
        id: `mm-tax-${businessId}`,
        type: 'RESERVE_TAX',
        title: 'Reserve cash for upcoming tax',
        summary: `Tax liability of ${currency} ${Number(openTax.amountDue).toFixed(2)} is due ${openTax.periodEnd?.toISOString().slice(0, 10)}.`,
        expectedImpact: Number(openTax.amountDue),
        currency,
        confidence: 95,
        riskTier: 1,
        effort: 'LOW',
        timeToImpactDays: openTax.periodEnd ? Math.max(0, Math.ceil((openTax.periodEnd.getTime() - now.getTime()) / (24 * 60 * 60 * 1000))) : 30,
        linkedEntities: [{ type: 'taxLiability', id: 'tax', name: 'Tax Liability' }],
        recommendedActions: [{
          sourceModule: 'finance',
          actionType: 'RESERVE_TAX',
          title: 'Set aside tax reserve',
        }],
      });
    }

    // 4. Low cash runway
    // W11-RUNWAY-LEDGER-CASH (owner ruling D-135, extending D-107; CP-21): the cash is the ledger
    // cash position in the business currency (CashPositionService), never the sum of the accounts'
    // currentBalance, an opening snapshot nothing posts to (CF-41) that was summed across
    // currencies. Cash held in another currency is never added nor converted (D-13); the summary
    // names it, unconverted, under the LOW_RUNWAY text's rules (notCountedCashNote: codes only,
    // bounded, a label never echoed). The move is labelled with the cash position's currency. It is
    // served to revenue readers (GET money-moves), who read that cash on the overview too. The
    // burn's currency and window are W11-RUNWAY-BURN-CURRENCY.
    const position = await this.cashPosition.getCashPosition(businessId);
    const cashBalance = position.cashBalance;
    const otherCashNote = notCountedCashNote(position.currency, otherCurrencyCash(position));
    const sixMonthExpenseGroups = await this.prisma.client.expense.groupBy({
      by: ['currency'],
      where: {
        businessId,
        deletedAt: null,
        date: { gte: new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000), lt: now },
      },
      _sum: { amount: true },
    });
    const { businessTotal: sixMonthBusinessBurn, otherExpenses } = splitExpensesByCurrency(
      sixMonthExpenseGroups,
      position.currency,
    );
    const otherExpenseNote = notCountedExpenseNote(position.currency, otherExpenses);
    const avgMonthlyBurn = sixMonthBusinessBurn / 6;
    const runwayMonths = avgMonthlyBurn > 0 ? cashBalance / avgMonthlyBurn : null;
    if (runwayMonths != null && runwayMonths < 3) {
      // Acceptance review C1 (CP-23): the ledger cash can be negative. The runway shown is never
      // below zero and the expected impact is zero for a shortfall, never negative.
      const shownMonths = Math.max(0, runwayMonths);
      const notes = [otherCashNote, otherExpenseNote].filter(Boolean);
      moves.push({
        id: `mm-runway-${businessId}`,
        type: 'CUT_EXPENSE',
        title: 'Protect cash runway',
        summary: `Runway is ~${shownMonths.toFixed(1)} months. Reducing burn or increasing collections is urgent.${notes.length > 0 ? ` ${notes.join(' ')}` : ''}`,
        expectedImpact: Math.max(0, cashBalance * 0.2),
        currency: position.currency,
        confidence: 80,
        riskTier: 2,
        effort: 'MEDIUM',
        timeToImpactDays: 30,
        linkedEntities: [],
        recommendedActions: [{
          sourceModule: 'finance',
          actionType: 'CUT_EXPENSE',
          title: 'Review recurring expenses',
        }],
      });
    }

    // 5. Reactivate dormant customers
    const dormantDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    const dormantCustomers = await this.prisma.client.contact.findMany({
      where: {
        businessId,
        deletedAt: null,
        status: 'CLIENT',
        lastContactedAt: { lt: dormantDate },
      },
      take: 10,
      select: { id: true, firstName: true, lastName: true },
    });
    if (dormantCustomers.length > 0) {
      moves.push({
        id: `mm-reactivate-${businessId}`,
        type: 'REACTIVATE_CUSTOMERS',
        title: `Reactivate ${dormantCustomers.length} dormant customers`,
        summary: 'These customers have not been contacted in 90+ days. A targeted offer may bring them back.',
        expectedImpact: null,
        currency,
        confidence: 50,
        riskTier: 1,
        effort: 'MEDIUM',
        timeToImpactDays: 21,
        linkedEntities: dormantCustomers.map((c) => ({ type: 'contact', id: c.id, name: `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim() })),
        recommendedActions: [{
          sourceModule: 'marketing',
          actionType: 'REACTIVATE_CUSTOMERS',
          title: 'Draft reactivation campaign',
        }],
      });
    }

    return moves;
  }
}
