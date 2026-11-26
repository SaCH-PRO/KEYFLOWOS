import { Injectable, Inject, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CashPositionService } from '../finance/cash-position.service';
import { namedCashCurrency } from '../finance/finance-overview.service';
import { balanceOfStoredRows } from '../commerce/invoice-workflow.service';
import { sumMoney } from '../commerce/money';
// V1-38b (CR-1): a customer is Contact.status CLIENT, the one vocabulary; a
// row holding a legacy CLIENT spelling counts the same. V1-38c: those
// spellings are crm.constants.ts's. D-92: a row still holding the legacy
// DORMANT (stored before D-92, not migrated) is a CLIENT too, and a dormant
// customer only by its age, as any client.
import { CLIENT_STATUS, LEGACY_CLIENT_STATUS, LEGACY_DORMANT_STATUS } from '../crm/crm.constants';

export interface HealthAreaResult {
  area: string;
  score: number;
  status: 'HEALTHY' | 'ATTENTION' | 'AT_RISK' | 'CRITICAL';
  reasons: string[];
  /** Figures; W11-CASH-READERS-LEDGER adds the money area's cashCurrency (a code) beside cashBalance. */
  metrics: Record<string, number | string>;
}

/**
 * FU-HEALTH-MONEY-SCOPE (P101, owner rulings D-259, D-100, D-234):
 * Matches any money-area reason carrying numeric figures or cash/bills/overdue/tax status
 * that must be withheld from readers without `revenue:read`.
 */
const MONEY_REASON_LEAK_RE = /\d|cash balance|bills due|overdue invoices|tax due/i;

/**
 * Pure read-time projection of health areas for a caller's revenue scope.
 * Persisted snapshots always retain the full unredacted money metrics and reasons;
 * when `hasRevenueRead` is false, the `money` area keeps its `score` and `status`,
 * withholds all `metrics`, and filters amount/cash-disclosing `reasons`. Non-money
 * areas are returned unchanged.
 */
export function projectHealthForReader(
  results: HealthAreaResult[],
  hasRevenueRead: boolean,
): HealthAreaResult[] {
  if (hasRevenueRead) return results;
  return results.map((result) => {
    if (result.area !== 'money') return result;
    const reasons = Array.isArray(result.reasons)
      ? result.reasons.filter((r) => typeof r === 'string' && !MONEY_REASON_LEAK_RE.test(r))
      : [];
    return {
      area: result.area,
      score: result.score,
      status: result.status,
      reasons,
      metrics: {},
    };
  });
}

@Injectable()
export class HealthScoreService {
  private readonly logger = new Logger(HealthScoreService.name);

  private readonly cashPosition: CashPositionService;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    // W11-CASH-READERS-LEDGER: optional with a Prisma-only fallback, as on FinanceOverviewService,
    // so IntelligenceModule needs no FinanceModule import and hand-built instances keep working.
    @Optional() @Inject(CashPositionService) cashPosition?: CashPositionService | null,
  ) {
    this.cashPosition = cashPosition ?? new CashPositionService(prisma);
  }

  projectHealthForReader(results: HealthAreaResult[], hasRevenueRead: boolean): HealthAreaResult[] {
    return projectHealthForReader(results, hasRevenueRead);
  }

  async calculateAll(businessId: string): Promise<HealthAreaResult[]> {
    const [money, time, people, sales, storefront, operations, risk] = await Promise.all([
      this.calculateMoneyHealth(businessId),
      this.calculateTimeHealth(businessId),
      this.calculatePeopleHealth(businessId),
      this.calculateSalesHealth(businessId),
      this.calculateStorefrontHealth(businessId),
      this.calculateOperationsHealth(businessId),
      this.calculateRiskHealth(businessId),
    ]);
    return [money, time, people, sales, storefront, operations, risk];
  }

  async saveSnapshot(businessId: string, result: HealthAreaResult) {
    return this.prisma.client.businessHealthSnapshot.create({
      data: {
        businessId,
        area: result.area,
        score: result.score,
        status: result.status,
        reasons: result.reasons as any,
        metrics: result.metrics as any,
      },
    });
  }

  async getLatestSnapshots(businessId: string): Promise<HealthAreaResult[]> {
    const areas = ['money', 'time', 'people', 'sales', 'storefront', 'operations', 'risk'];
    const snapshots = await Promise.all(
      areas.map(async (area) => {
        const snap = await this.prisma.client.businessHealthSnapshot.findFirst({
          where: { businessId, area },
          orderBy: { calculatedAt: 'desc' },
        });
        if (snap) {
          return {
            area: snap.area,
            score: snap.score,
            status: snap.status as HealthAreaResult['status'],
            reasons: (snap.reasons as any) ?? [],
            metrics: (snap.metrics as any) ?? {},
          };
        }
        return null;
      }),
    );
    return snapshots.filter(Boolean) as HealthAreaResult[];
  }

  private async calculateMoneyHealth(businessId: string): Promise<HealthAreaResult> {
    const now = new Date();
    const reasons: string[] = [];
    const metrics: Record<string, number | string> = {};

    const [position, overdueInvoices, upcomingBills, uncategorizedExpenses, taxLiabilities] = await Promise.all([
      this.cashPosition.getCashPosition(businessId),
      this.prisma.client.invoice.findMany({
        where: { businessId, status: 'SENT', deletedAt: null, dueDate: { lt: now } },
        // V1-41c: this tenant's own rows (M31), read by the balance contract below.
        select: { id: true, total: true, currency: true, payments: { where: { businessId }, select: { amount: true, status: true } } },
      }),
      this.prisma.client.expense.findMany({ where: { businessId, status: 'BILL', dueDate: { gte: now, lte: new Date(now.getTime() + 30 * 86400000) } }, select: { amount: true } }),
      this.prisma.client.expense.findMany({ where: { businessId, categoryId: null, deletedAt: null }, select: { id: true } }),
      this.prisma.client.taxLiability.findMany({ where: { businessId, status: { in: ['OPEN', 'FILED'] } }, select: { amountDue: true, dueDate: true } }),
    ]);

    // W11-CASH-READERS-LEDGER (owner ruling D-135; CF-41): the ledger cash position in the business
    // currency (CashPositionService: CASH, BANK and PAYMENT_PROCESSOR), never the CASH and BANK
    // accounts' currentBalance, an opening snapshot nothing posts to, summed across currencies.
    // Cash in another currency is never added (D-13); cashCurrency labels the figure, named only
    // when the business currency is a three-letter code (review SEC-W11RL-1: Business.currency is
    // free text, and this area is served under settings read and persisted in its snapshots).
    const cashBalance = position.cashBalance;
    // V1-41c-MONEY-ROW-COUNTERS: what is left on each overdue invoice is the
    // V1-36 balance contract (balanceOfStoredRows: SUCCESSFUL in, refunds
    // out, integer cents) over the invoice's own-tenant rows. The status-blind
    // sum of every row read a customer's PENDING intent, an extracted amount
    // awaiting a member, a FAILED attempt and a CONFIRMED extracted row (kept
    // beside the payment recorded from it) as money received.
    const overdueReceivables = sumMoney(
      overdueInvoices.map((inv) => balanceOfStoredRows(Number(inv.total ?? 0), inv.payments, inv.currency).remaining),
    );
    const billsDue30 = upcomingBills.reduce((s, b) => s + Number(b.amount ?? 0), 0);
    const taxDueSoon = taxLiabilities.filter(t => t.dueDate && (new Date(t.dueDate).getTime() - now.getTime()) <= 14 * 86400000);
    const taxDueAmount = taxDueSoon.reduce((s, t) => s + Number(t.amountDue ?? 0), 0);

    metrics.cashBalance = cashBalance;
    const cashCurrency = namedCashCurrency(position.currency);
    if (cashCurrency) metrics.cashCurrency = cashCurrency;
    metrics.overdueReceivables = overdueReceivables;
    metrics.billsDue30 = billsDue30;
    metrics.uncategorizedExpenses = uncategorizedExpenses.length;
    metrics.taxDueSoon = taxDueAmount;

    let score = 100;
    if (overdueReceivables > 0) { score -= 15; reasons.push(`${uncategorizedExpenses.length} overdue invoices totaling ${overdueReceivables.toFixed(2)}`); }
    if (billsDue30 > cashBalance * 0.5) { score -= 15; reasons.push('Bills due exceed 50% of cash balance'); }
    if (uncategorizedExpenses.length > 0) { score -= 10; reasons.push(`${uncategorizedExpenses.length} uncategorized expenses`); }
    if (taxDueAmount > 0) { score -= 10; reasons.push(`Tax due soon: ${taxDueAmount.toFixed(2)}`); }
    if (cashBalance < 0) { score -= 30; reasons.push('Negative cash balance'); }

    score = Math.max(0, Math.min(100, score));
    return { area: 'money', score, status: this.scoreToStatus(score), reasons, metrics };
  }

  private async calculateTimeHealth(businessId: string): Promise<HealthAreaResult> {
    const now = new Date();
    const reasons: string[] = [];
    const metrics: Record<string, number> = {};

    const [overdueContactTasks, overdueProjectTasks, upcomingBookings, unconfirmedBookings, totalBookings7d] = await Promise.all([
      this.prisma.client.contactTask.count({ where: { businessId, status: { not: 'COMPLETED' }, dueDate: { lt: now } } }),
      this.prisma.client.projectTask.count({ where: { businessId, status: { notIn: ['DONE', 'BLOCKED'] }, dueDate: { lt: now } } }),
      this.prisma.client.booking.count({ where: { businessId, startTime: { gte: now, lte: new Date(now.getTime() + 7 * 86400000) } } }),
      this.prisma.client.booking.count({ where: { businessId, status: 'PENDING' } }),
      this.prisma.client.booking.count({ where: { businessId, startTime: { gte: now, lte: new Date(now.getTime() + 7 * 86400000) } } }),
    ]);
    const overdueTasks = overdueContactTasks + overdueProjectTasks;

    metrics.overdueTasks = overdueTasks;
    metrics.upcomingBookings = upcomingBookings;
    metrics.unconfirmedBookings = unconfirmedBookings;

    let score = 100;
    if (overdueTasks > 0) { score -= 20; reasons.push(`${overdueTasks} overdue tasks`); }
    if (unconfirmedBookings > 0) { score -= 15; reasons.push(`${unconfirmedBookings} unconfirmed bookings`); }
    if (totalBookings7d === 0) { score -= 10; reasons.push('No bookings in next 7 days'); }

    score = Math.max(0, Math.min(100, score));
    return { area: 'time', score, status: this.scoreToStatus(score), reasons, metrics };
  }

  private async calculatePeopleHealth(businessId: string): Promise<HealthAreaResult> {
    const now = new Date();
    const reasons: string[] = [];
    const metrics: Record<string, number> = {};

    const [totalContacts, staleLeads, dormantCustomers, missingInfo] = await Promise.all([
      this.prisma.client.contact.count({ where: { businessId, deletedAt: null } }),
      this.prisma.client.contact.count({ where: { businessId, deletedAt: null, status: 'LEAD', updatedAt: { lt: new Date(now.getTime() - 14 * 86400000) } } }),
      this.prisma.client.contact.count({ where: { businessId, deletedAt: null, status: { in: [CLIENT_STATUS, LEGACY_CLIENT_STATUS, LEGACY_DORMANT_STATUS] }, updatedAt: { lt: new Date(now.getTime() - 60 * 86400000) } } }),
      this.prisma.client.contact.count({ where: { businessId, deletedAt: null, OR: [{ email: null }, { phone: null }] } }),
    ]);

    metrics.totalContacts = totalContacts;
    metrics.staleLeads = staleLeads;
    metrics.dormantCustomers = dormantCustomers;
    metrics.missingInfo = missingInfo;

    let score = 100;
    if (staleLeads > 0) { score -= 15; reasons.push(`${staleLeads} stale leads`); }
    if (dormantCustomers > 0) { score -= 15; reasons.push(`${dormantCustomers} dormant customers`); }
    if (missingInfo > 0) { score -= 10; reasons.push(`${missingInfo} contacts missing email or phone`); }
    if (totalContacts === 0) { score -= 30; reasons.push('No contacts in CRM'); }

    score = Math.max(0, Math.min(100, score));
    return { area: 'people', score, status: this.scoreToStatus(score), reasons, metrics };
  }

  private async calculateSalesHealth(businessId: string): Promise<HealthAreaResult> {
    const reasons: string[] = [];
    const metrics: Record<string, number> = {};

    const [quotesSent, quotesConverted, pendingQuotes, invoicesSent] = await Promise.all([
      this.prisma.client.quote.count({ where: { businessId, status: { not: 'DRAFT' } } }),
      this.prisma.client.invoice.count({ where: { businessId, quoteId: { not: null } } }),
      this.prisma.client.quote.count({ where: { businessId, status: 'SENT' } }),
      this.prisma.client.invoice.count({ where: { businessId, status: 'SENT' } }),
    ]);

    const conversionRate = quotesSent > 0 ? (quotesConverted / quotesSent) * 100 : 0;
    metrics.quotesSent = quotesSent;
    metrics.quotesConverted = quotesConverted;
    metrics.pendingQuotes = pendingQuotes;
    metrics.conversionRate = Math.round(conversionRate);

    let score = 100;
    if (conversionRate < 20) { score -= 20; reasons.push(`Quote conversion rate is ${conversionRate.toFixed(1)}%`); }
    if (pendingQuotes > 3) { score -= 15; reasons.push(`${pendingQuotes} quotes pending follow-up`); }
    if (quotesSent === 0) { score -= 30; reasons.push('No quotes sent recently'); }

    score = Math.max(0, Math.min(100, score));
    return { area: 'sales', score, status: this.scoreToStatus(score), reasons, metrics };
  }

  private async calculateStorefrontHealth(businessId: string): Promise<HealthAreaResult> {
    const reasons: string[] = [];
    const metrics: Record<string, number> = {};

    const [activeProducts, sites] = await Promise.all([
      this.prisma.client.product.count({ where: { businessId, isActive: true } }),
      this.prisma.client.site.count({ where: { businessId, deletedAt: null } }),
    ]);

    metrics.activeProducts = activeProducts;
    metrics.siteCount = sites;

    let score = 100;
    if (activeProducts === 0) { score -= 30; reasons.push('No active products or services'); }
    if (activeProducts < 3) { score -= 15; reasons.push('Fewer than 3 active products'); }
    if (sites === 0) { score -= 20; reasons.push('No storefront created'); }

    score = Math.max(0, Math.min(100, score));
    return { area: 'storefront', score, status: this.scoreToStatus(score), reasons, metrics };
  }

  private async calculateOperationsHealth(businessId: string): Promise<HealthAreaResult> {
    const now = new Date();
    const reasons: string[] = [];
    const metrics: Record<string, number> = {};

    const [activeProjects, blockedTasks, overdueProjectTasks, sops] = await Promise.all([
      this.prisma.client.project.count({ where: { businessId, status: { not: 'ARCHIVED' }, deletedAt: null } }),
      this.prisma.client.projectTask.count({ where: { businessId, status: 'BLOCKED' } }),
      this.prisma.client.projectTask.count({ where: { businessId, status: { notIn: ['DONE'] }, dueDate: { lt: now } } }),
      this.prisma.client.sopDocument.count({ where: { businessId } }),
    ]);

    metrics.activeProjects = activeProjects;
    metrics.blockedTasks = blockedTasks;
    metrics.overdueProjectTasks = overdueProjectTasks;
    metrics.sops = sops;

    let score = 100;
    if (blockedTasks > 0) { score -= 20; reasons.push(`${blockedTasks} blocked tasks`); }
    if (overdueProjectTasks > 0) { score -= 15; reasons.push(`${overdueProjectTasks} overdue project tasks`); }
    if (sops === 0) { score -= 10; reasons.push('No SOPs documented'); }

    score = Math.max(0, Math.min(100, score));
    return { area: 'operations', score, status: this.scoreToStatus(score), reasons, metrics };
  }

  private async calculateRiskHealth(businessId: string): Promise<HealthAreaResult> {
    const reasons: string[] = [];
    const metrics: Record<string, number> = {};

    const [pendingApprovals, highRiskCommands, openSignals, incompleteBlueprint] = await Promise.all([
      this.prisma.client.commandItem.count({ where: { businessId, status: 'WAITING_APPROVAL' } }),
      this.prisma.client.commandItem.count({ where: { businessId, status: { in: ['OPEN', 'IN_PROGRESS'] }, riskTier: { gte: 3 } } }),
      this.prisma.client.businessSignal.count({ where: { businessId, status: 'ACTIVE', severity: { in: ['WARN', 'CRITICAL'] } } }),
      this.prisma.client.business.findUnique({ where: { id: businessId }, select: { profileCompleteness: true } }),
    ]);

    metrics.pendingApprovals = pendingApprovals;
    metrics.highRiskCommands = highRiskCommands;
    metrics.openSignals = openSignals;
    metrics.profileCompleteness = incompleteBlueprint?.profileCompleteness ?? 0;

    let score = 100;
    if (pendingApprovals > 0) { score -= 15; reasons.push(`${pendingApprovals} pending approvals`); }
    if (highRiskCommands > 0) { score -= 20; reasons.push(`${highRiskCommands} high-risk open commands`); }
    if (openSignals > 0) { score -= 15; reasons.push(`${openSignals} active warning signals`); }
    if ((incompleteBlueprint?.profileCompleteness ?? 0) < 50) { score -= 10; reasons.push('Business profile is incomplete'); }

    score = Math.max(0, Math.min(100, score));
    return { area: 'risk', score, status: this.scoreToStatus(score), reasons, metrics };
  }

  private scoreToStatus(score: number): HealthAreaResult['status'] {
    if (score >= 80) return 'HEALTHY';
    if (score >= 60) return 'ATTENTION';
    if (score >= 40) return 'AT_RISK';
    return 'CRITICAL';
  }
}
