import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

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
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

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
    const cashAccounts = await this.prisma.client.financialAccount.findMany({
      where: { businessId, isActive: true, type: { in: ['CASH', 'BANK', 'PAYMENT_PROCESSOR'] } },
      select: { currentBalance: true },
    });
    const cashBalance = cashAccounts.reduce((s, a) => s + Number(a.currentBalance ?? 0), 0);
    const sixMonthExpenses = await this.prisma.client.expense.aggregate({
      where: { businessId, date: { gte: new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000) } },
      _sum: { amount: true },
    });
    const avgMonthlyBurn = Number(sixMonthExpenses._sum.amount ?? 0) / 6;
    const runwayMonths = avgMonthlyBurn > 0 ? cashBalance / avgMonthlyBurn : null;
    if (runwayMonths != null && runwayMonths < 3) {
      moves.push({
        id: `mm-runway-${businessId}`,
        type: 'CUT_EXPENSE',
        title: 'Protect cash runway',
        summary: `Runway is ~${runwayMonths.toFixed(1)} months. Reducing burn or increasing collections is urgent.`,
        expectedImpact: cashBalance * 0.2,
        currency,
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
