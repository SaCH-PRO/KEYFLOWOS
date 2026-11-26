/**
 * ============================================================================
 * KEY CORTEX INSIGHT ENGINE — The Profit Machine
 * ============================================================================
 * Transforms raw business data into actionable intelligence. Finds money,
 * predicts churn, analyzes pipelines, forecasts cash flow, and tells the
 * business owner exactly what to do next.
 * ============================================================================
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { ModelGatewayService } from '../ai/model-gateway.service';
import { AiUsageService } from '../ai/ai-usage.service';
import { KeyCortexContextV2Service } from './key-cortex-context-v2.service';
import { InvoiceMoney, readInvoiceMoney } from '../commerce/commerce-stats.service';
import { fromCents, remainingMoney, roundMoney, subtractMoney, sumMoney, toCents } from '../commerce/money';
import { normalizeCurrency } from '../finance/posting.service';
import { BookingStatus, DealStatus, InvoiceStatus, Prisma } from '@prisma/client';
import { CLIENT_STATUS, LEGACY_CLIENT_STATUS, LEGACY_DORMANT_STATUS } from '../crm/crm.constants';
import { addDays, startOfMonth, startOfWeek, startOfDay, subDays, subMonths, subWeeks, format, differenceInDays } from 'date-fns';

/* ─────────────────────────── Query vocabulary ───────────────────────────
 * W11-CORTEX-INSIGHT-QUERIES (review SEC-W11CRR-2). Every query below ran
 * through `(this.prisma.client as any)`, which hid from tsc that it selected
 * columns Contact does not have (name, score, stage, lastActivityAt,
 * estimatedValue), a Product `status` and an AutopilotTask `source` that do
 * not exist, and lower-case enum values Prisma refuses ('draft', 'paid',
 * 'cancelled'). Each method caught the throw and answered its empty payload,
 * so on a real business revenue read 0 and there were no opportunities,
 * risks or pipeline. The casts are gone: tsc now checks every query against
 * the schema, and the vocabulary is spelled once here.
 */

/** Contact has no `name` column: these are the columns a display name is made from. */
const CONTACT_NAME_SELECT = { displayName: true, firstName: true, lastName: true, companyName: true } as const;

/**
 * A contact's display name, in the order RevenueReportingService.contactDisplayName
 * uses: the explicit displayName, else first + last name, else the company name.
 */
function contactDisplayName(
  c: { displayName?: string | null; firstName?: string | null; lastName?: string | null; companyName?: string | null } | null | undefined,
): string {
  if (!c) return 'Unknown';
  const explicit = c.displayName?.trim();
  if (explicit) return explicit;
  const composed = `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim();
  if (composed) return composed;
  return c.companyName?.trim() || 'Unknown';
}

/**
 * An invoice that counts as revenue: issued (not a draft), not voided, not
 * soft-deleted. The db client's soft-delete extension filters findMany and
 * count, but not groupBy, aggregate or a relation include, so it is spelled
 * here for all of them.
 */
const NON_REVENUE_STATUSES: ReadonlySet<string> = new Set([
  InvoiceStatus.DRAFT,
  InvoiceStatus.VOID,
  InvoiceStatus.FAILED,
  InvoiceStatus.FULLY_CREDITED,
]);

const REVENUE_INVOICE: Prisma.InvoiceWhereInput = {
  status: { notIn: [InvoiceStatus.DRAFT, InvoiceStatus.VOID, InvoiceStatus.FAILED, InvoiceStatus.FULLY_CREDITED] },
  deletedAt: null,
};

/**
 * P119 (FU-CORTEX-INSIGHT-CASH-TRUTH, D-14, D-250): canonical remaining balance
 * and overdue state from `readInvoiceMoney`, also covering legacy `PARTIAL` rows
 * (e.g. Shopify sync) with the same cents-safe net-payment and owedCap arithmetic.
 */
function invoiceOwed(inv: InvoiceMoney, now: Date): { remaining: number; overdue: boolean } {
  if (inv.status !== InvoiceStatus.PARTIAL) {
    return { remaining: inv.remaining, overdue: inv.overdue };
  }
  const net = sumMoney(inv.cash.map((c) => c.amount));
  const owedCap = Math.max(0, toCents(inv.total));
  const remaining = fromCents(Math.min(toCents(remainingMoney(inv.total, Math.max(0, net))), owedCap));
  const overdue = remaining > 0 && !!inv.dueDate && new Date(inv.dueDate) < now;
  return { remaining, overdue };
}

/**
 * Contact.status vocabulary (crm.constants): a lead is LEAD; a customer is
 * CLIENT or a legacy spelling isClientStatus reads as CLIENT.
 */
const LEAD_STATUS = 'LEAD';
const CLIENT_STATUSES = [CLIENT_STATUS, LEGACY_CLIENT_STATUS, LEGACY_DORMANT_STATUS];

/**
 * AutopilotTask has no `source`. A task an automation created carries one of
 * these categories (the split KeyCortexContextV2Service's automation rate
 * reads); every other task was made by hand.
 */
const AUTOMATED_TASK_CATEGORIES = ['workflow', 'automation', 'delegation_loop'];

/** A contact's open deals (tenant-scoped; currency-checked against home currency per D-13/D-251). */
const openDealSelect = (businessId: string) =>
  ({
    where: { businessId, status: DealStatus.OPEN, deletedAt: null },
    select: { value: true, currency: true },
  }) as const;

const openDealValue = (
  deals: Array<{ value: number | null; currency?: string | null }>,
  homeCurrency: string,
): number =>
  sumMoney(
    deals
      .filter((d) => (normalizeCurrency(d.currency) || homeCurrency) === homeCurrency)
      .map((d) => d.value ?? 0),
  );

/* ─────────────────────────── Types ─────────────────────────── */

export interface ProfitOpportunity {
  id: string;
  type: 'overdue_invoice' | 'stale_lead' | 'underutilized_product' | 'automation_gap' | 'churn_prevention' | 'upsell';
  title: string;
  description: string;
  estimatedValue: number;
  confidence: number;
  recommendedAction: string;
  sourceData: Record<string, unknown>;
  priority: 'high' | 'medium' | 'low';
  timeframe: 'immediate' | 'this_week' | 'this_month';
}

export interface RevenueAnalysis {
  period: string;
  totalRevenue: number;
  previousPeriodRevenue: number;
  growthRate: number;
  growthDirection: 'up' | 'down' | 'flat';
  averageInvoiceValue: number;
  invoiceCount: number;
  topCustomers: Array<{
    id: string;
    name: string;
    revenue: number;
    invoices: number;
    avgInvoice: number;
  }>;
  revenueByDay: Array<{ date: string; amount: number }>;
  trends: string[];
}

export interface ChurnRisk {
  contactId: string;
  contactName: string;
  email: string;
  riskScore: number;
  riskLevel: 'critical' | 'high' | 'medium' | 'low';
  factors: string[];
  daysSinceLastInteraction: number;
  outstandingBalance: number;
  cancelledBookings: number;
  recommendedAction: string;
  estimatedRecoveryValue: number;
}

export interface PipelineAnalysis {
  stages: Array<{
    name: string;
    count: number;
    value: number;
    avgDaysInStage: number;
    conversionRate: number;
  }>;
  totalLeads: number;
  totalPipelineValue: number;
  avgDealSize: number;
  avgDaysToClose: number;
  bottlenecks: string[];
  recommendations: string[];
  funnel: Array<{ stage: string; count: number; percentage: number }>;
}

export interface CashFlowAnalysis {
  period: string;
  moneyIn: number;
  moneyOut: number;
  netFlow: number;
  runway: number;
  collectionRate: number;
  daysSalesOutstanding: number;
  upcomingPaymentsDue: Array<{
    id: string;
    contactName: string;
    amount: number;
    dueDate: Date;
    daysUntilDue: number;
  }>;
  collectionIssues: string[];
  forecast: {
    projectedInflow: number;
    projectedOutflow: number;
    projectedNet: number;
    riskLevel: 'low' | 'medium' | 'high';
  };
}

export interface BusinessReport {
  scope: 'daily' | 'weekly' | 'monthly';
  generatedAt: Date;
  period: string;
  narrative: string;
  revenue: RevenueAnalysis;
  pipeline: PipelineAnalysis;
  cashFlow: CashFlowAnalysis;
  churnRisks: ChurnRisk[];
  opportunities: ProfitOpportunity[];
  keyMetrics: Record<string, number | string>;
  topPriorities: string[];
  score: number;
}

export interface Recommendation {
  id: string;
  title: string;
  description: string;
  category: 'revenue' | 'operations' | 'retention' | 'automation' | 'communication';
  priority: 'critical' | 'high' | 'medium' | 'low';
  estimatedImpact: number;
  effort: 'quick' | 'medium' | 'large';
  actionItems: string[];
  sourceInsights: string[];
  confidence: number;
}

/* ─────────────────────────── Service ─────────────────────────── */

@Injectable()
export class KeyCortexInsightService {
  private readonly logger = new Logger(KeyCortexInsightService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly modelGateway: ModelGatewayService,
    private readonly aiUsage: AiUsageService,
    private readonly contextService: KeyCortexContextV2Service,
  ) {}

  /** Resolve the business's normalized home currency (D-13 / D-251; defaults to TTD). */
  private async getHomeCurrency(businessId: string): Promise<string> {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { currency: true },
    });
    return normalizeCurrency(business?.currency) || 'TTD';
  }

  /** Own-tenant APPLIED credit-note sums for PARTIALLY_CREDITED invoices (D-75 / SEC-V44-6). */
  private async appliedCreditsByInvoice(businessId: string, creditedIds: string[]): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    if (creditedIds.length === 0) return map;
    const rows = await this.prisma.client.creditNote.groupBy({
      by: ['invoiceId'],
      where: { businessId, status: 'APPLIED', invoiceId: { in: creditedIds } },
      _sum: { amount: true },
    });
    for (const r of rows) {
      map.set(r.invoiceId, Number(r._sum.amount ?? 0) || 0);
    }
    return map;
  }

  /* ─────── 1. Find Profit Opportunities ─────── */

  async findProfitOpportunities(businessId: string): Promise<ProfitOpportunity[]> {
    this.logger.log(`[findProfitOpportunities] Analyzing ${businessId}`);
    const start = Date.now();
    const opportunities: ProfitOpportunity[] = [];

    try {
      const now = new Date();
      const [homeCurrency, allInvoiceMoney] = await Promise.all([
        this.getHomeCurrency(businessId),
        readInvoiceMoney(this.prisma.client, businessId, now),
      ]);

      // 1a. Overdue invoices = quick cash (remaining balance on home-currency open receivables, D-14/D-13/D-75)
      const overdueItems = allInvoiceMoney
        .filter((inv) => inv.currency === homeCurrency)
        .map((inv) => ({ inv, ...invoiceOwed(inv, now) }))
        .filter((item) => item.remaining > 0 && item.overdue)
        .sort((a, b) => {
          const at = a.inv.dueDate ? new Date(a.inv.dueDate).getTime() : Number.POSITIVE_INFINITY;
          const bt = b.inv.dueDate ? new Date(b.inv.dueDate).getTime() : Number.POSITIVE_INFINITY;
          return at - bt;
        })
        .slice(0, 20);

      const overdueContactIds = [
        ...new Set(overdueItems.map((x) => x.inv.contactId).filter((id): id is string => Boolean(id))),
      ];
      const overdueContacts = overdueContactIds.length
        ? await this.prisma.client.contact.findMany({
            where: { businessId, id: { in: overdueContactIds } },
            select: { id: true, email: true, ...CONTACT_NAME_SELECT },
          })
        : [];
      const overdueContactMap = new Map(overdueContacts.map((c) => [c.id, c]));

      overdueItems.forEach(({ inv, remaining }) => {
        const amount = remaining;
        const daysOverdue = differenceInDays(now, inv.dueDate ?? now);
        const contact = inv.contactId ? overdueContactMap.get(inv.contactId) : undefined;
        opportunities.push({
          id: `inv-${inv.id}`,
          type: 'overdue_invoice',
          title: `Collect $${amount.toLocaleString()} from ${contactDisplayName(contact)}`,
          description: `Invoice ${inv.invoiceNumber || inv.id} is ${daysOverdue} days overdue. Follow up to collect payment.`,
          estimatedValue: amount,
          confidence: Math.min(0.9, 0.5 + daysOverdue * 0.01),
          recommendedAction: `Send payment reminder for invoice ${inv.invoiceNumber || inv.id}. Escalate to phone call if ${daysOverdue + 3} days.`,
          sourceData: { invoiceId: inv.id, daysOverdue, amount },
          priority: daysOverdue > 30 ? 'high' : 'medium',
          timeframe: 'immediate',
        });
      });

      // 1b. Stale leads = revenue waiting (Contact: leadScore, lastInteractionAt, pipelineStage)
      const staleLeads = await this.prisma.client.contact.findMany({
        where: {
          businessId,
          deletedAt: null,
          status: LEAD_STATUS,
          lastInteractionAt: { lt: subDays(now, 14) },
          leadScore: { gte: 50 },
        },
        orderBy: { leadScore: 'desc' },
        take: 15,
        select: {
          id: true,
          email: true,
          ...CONTACT_NAME_SELECT,
          leadScore: true,
          lastInteractionAt: true,
          pipelineStage: true,
          deals: openDealSelect(businessId),
        },
      });

      staleLeads.forEach((lead) => {
        const name = contactDisplayName(lead);
        const score = lead.leadScore ?? 0;
        const daysStale = lead.lastInteractionAt
          ? differenceInDays(now, lead.lastInteractionAt)
          : 30;
        // The lead's open deals in home currency are its value; a lead with none has no invented figure.
        const estValue = openDealValue(lead.deals, homeCurrency);
        opportunities.push({
          id: `lead-${lead.id}`,
          type: 'stale_lead',
          title: `Re-engage ${name} (score: ${score})`,
          description: estValue > 0
            ? `High-value lead hasn't been contacted in ${daysStale} days. Open deal value: $${estValue.toLocaleString()}.`
            : `High-value lead hasn't been contacted in ${daysStale} days.`,
          estimatedValue: estValue,
          confidence: Math.min(0.8, 0.4 + score * 0.005),
          recommendedAction: `Send personalized re-engagement email to ${name}. Offer a time-sensitive incentive.`,
          sourceData: { contactId: lead.id, daysStale, score },
          priority: score > 80 ? 'high' : 'medium',
          timeframe: 'this_week',
        });
      });

      // 1c. Underutilized products (Product has isActive, not a status; home currency only)
      const underutilized = await this.prisma.client.product.findMany({
        where: {
          businessId,
          deletedAt: null,
          isActive: true,
        },
        include: {
          // Sold = on an issued invoice of this business (not a draft, void or deleted one).
          _count: { select: { invoiceItems: { where: { invoice: { ...REVENUE_INVOICE, businessId } } } } },
        },
        orderBy: { price: 'desc' },
        take: 10,
      });

      underutilized
        .filter((p) => (normalizeCurrency(p.currency) || homeCurrency) === homeCurrency && p._count.invoiceItems < 3 && p.price > 100)
        .forEach((product) => {
          opportunities.push({
            id: `prod-${product.id}`,
            type: 'underutilized_product',
            title: `Promote "${product.name}" — only sold ${product._count.invoiceItems} times`,
            description: `Premium product at $${(product.price || 0).toLocaleString()} is underutilized. Create a targeted campaign.`,
            estimatedValue: roundMoney((product.price || 0) * 10),
            confidence: 0.6,
            recommendedAction: `Feature ${product.name} in next email campaign. Create bundle with popular products.`,
            sourceData: { productId: product.id, salesCount: product._count.invoiceItems },
            priority: 'medium',
            timeframe: 'this_month',
          });
        });

      // 1d. Automation opportunities (AutopilotTask has no source: a task outside the automation categories was made by hand)
      const manualTasks = await this.prisma.client.autopilotTask.count({
        where: {
          businessId,
          category: { notIn: AUTOMATED_TASK_CATEGORIES },
          createdAt: { gte: subDays(now, 30) },
        },
      });

      if (manualTasks > 20) {
        opportunities.push({
          id: `auto-${businessId}`,
          type: 'automation_gap',
          title: `Automate ${manualTasks} recurring manual tasks`,
          description: `${manualTasks} manual tasks created in the last 30 days. Workflow automation could save hours per week.`,
          estimatedValue: manualTasks * 25, // $25/hr saved
          confidence: 0.85,
          recommendedAction: `Review top 5 repeated manual tasks and create autopilot workflows.`,
          sourceData: { manualTaskCount: manualTasks },
          priority: 'medium',
          timeframe: 'this_month',
        });
      }

      // 1e. Upsell opportunities — customers (CLIENT, or a legacy spelling of it) with repeat purchases
      const repeatCustomers = await this.prisma.client.contact.findMany({
        where: {
          businessId,
          deletedAt: null,
          status: { in: CLIENT_STATUSES },
        },
        select: {
          id: true,
          ...CONTACT_NAME_SELECT,
          // A purchase is an issued invoice of this business (relation reads are not soft-delete filtered).
          _count: {
            select: { invoices: { where: { ...REVENUE_INVOICE, businessId } } },
          },
          invoices: {
            where: { ...REVENUE_INVOICE, businessId },
            orderBy: { createdAt: 'desc' },
            take: 10,
            select: { total: true, createdAt: true, currency: true },
          },
        },
        orderBy: { invoices: { _count: 'desc' } },
        take: 10,
      });

      repeatCustomers
        .filter((c) => c._count.invoices >= 2)
        .forEach((customer) => {
          const name = contactDisplayName(customer);
          const homeCustomerInvoices = customer.invoices.filter(
            (i) => (normalizeCurrency(i.currency) || homeCurrency) === homeCurrency,
          );
          const lastInvoice = homeCustomerInvoices[0];
          if (!lastInvoice) return;
          const daysSincePurchase = lastInvoice.createdAt
            ? differenceInDays(now, lastInvoice.createdAt)
            : 0;
          if (daysSincePurchase > 30 && daysSincePurchase < 90) {
            const avgValue = lastInvoice.total || 500;
            opportunities.push({
              id: `upsell-${customer.id}`,
              type: 'upsell',
              title: `Upsell ${name} — repeat buyer, ${daysSincePurchase}d since last purchase`,
              description: `Loyal customer with ${customer._count.invoices} purchases. Last order: $${avgValue.toLocaleString()}. Ready for next purchase.`,
              estimatedValue: roundMoney(avgValue * 1.2),
              confidence: 0.7,
              recommendedAction: `Send personalized upsell offer to ${name}. Recommend premium tier or bundle.`,
              sourceData: { contactId: customer.id, purchaseCount: customer._count.invoices, daysSincePurchase },
              priority: 'medium',
              timeframe: 'this_week',
            });
          }
        });

      // Sort by estimated value * confidence
      opportunities.sort((a: any, b: any) => b.estimatedValue * b.confidence - a.estimatedValue * a.confidence);

      const elapsed = Date.now() - start;
      this.logger.log(`[findProfitOpportunities] Found ${opportunities.length} opportunities in ${elapsed}ms`);

      return opportunities;
    } catch (error: any) {
      this.logger.error(`[findProfitOpportunities] Error for ${businessId}: ${error.message}`);
      return [];
    }
  }

  /* ─────── 2. Revenue Analysis ─────── */

  async analyzeRevenue(businessId: string, period?: string): Promise<RevenueAnalysis> {
    try {
      const now = new Date();
      let periodStart: Date;
      let previousStart: Date;
      let periodLabel: string;

      switch (period) {
        case 'week':
          periodStart = startOfWeek(now, { weekStartsOn: 1 });
          previousStart = subWeeks(periodStart, 1);
          periodLabel = 'This Week';
          break;
        case 'today':
          periodStart = startOfDay(now);
          previousStart = subDays(periodStart, 1);
          periodLabel = 'Today';
          break;
        default:
          periodStart = startOfMonth(now);
          previousStart = subMonths(periodStart, 1);
          periodLabel = 'This Month';
      }

      // Revenue = issued invoices in home currency (D-13/D-251): not drafts, voids, failed, fully credited or deleted.
      const [homeCurrency, currentInvoicesRaw, previousInvoicesRaw] = await Promise.all([
        this.getHomeCurrency(businessId),
        this.prisma.client.invoice.findMany({
          where: {
            businessId,
            createdAt: { gte: periodStart },
            ...REVENUE_INVOICE,
          },
          select: { id: true, total: true, status: true, currency: true, createdAt: true, contactId: true },
        }),
        this.prisma.client.invoice.findMany({
          where: {
            businessId,
            createdAt: { gte: previousStart, lt: periodStart },
            ...REVENUE_INVOICE,
          },
          select: { id: true, total: true, status: true, currency: true },
        }),
      ]);

      const currentInvoices = currentInvoicesRaw.filter((i) => normalizeCurrency(i.currency) === homeCurrency);
      const previousInvoices = previousInvoicesRaw.filter((i) => normalizeCurrency(i.currency) === homeCurrency);

      const creditedIds = [...currentInvoices, ...previousInvoices]
        .filter((i) => i.status === InvoiceStatus.PARTIALLY_CREDITED)
        .map((i) => i.id);
      const creditedOf = await this.appliedCreditsByInvoice(businessId, creditedIds);
      const billedOf = (inv: { id: string; total: number | null; status: InvoiceStatus }): number => {
        const total = inv.total || 0;
        if (inv.status !== InvoiceStatus.PARTIALLY_CREDITED) return roundMoney(total);
        return fromCents(Math.max(0, toCents(total) - toCents(creditedOf.get(inv.id) ?? 0)));
      };

      const totalRevenue = sumMoney(currentInvoices.map(billedOf));
      const previousRevenue = sumMoney(previousInvoices.map(billedOf));
      const growthRate = previousRevenue > 0
        ? Math.round(((totalRevenue - previousRevenue) / previousRevenue) * 100)
        : 0;

      const invoiceCount = currentInvoices.length;
      const avgInvoiceValue = invoiceCount > 0 ? Math.round(totalRevenue / invoiceCount) : 0;

      // Top customers (home currency, cents-safe)
      const byContact = new Map<string, { amounts: number[]; count: number }>();
      for (const inv of currentInvoices) {
        if (!inv.contactId) continue;
        const entry = byContact.get(inv.contactId) ?? { amounts: [], count: 0 };
        entry.amounts.push(billedOf(inv));
        entry.count += 1;
        byContact.set(inv.contactId, entry);
      }
      const topCustomerEntries = Array.from(byContact.entries())
        .map(([contactId, data]) => ({
          contactId,
          revenue: sumMoney(data.amounts),
          invoices: data.count,
        }))
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 5);

      const contactIds = topCustomerEntries.map((c) => c.contactId);
      const contacts = contactIds.length
        ? await this.prisma.client.contact.findMany({
            where: { businessId, id: { in: contactIds } },
            select: { id: true, ...CONTACT_NAME_SELECT },
          })
        : [];
      const contactMap = new Map(contacts.map((c) => [c.id, contactDisplayName(c)]));

      const topCustomers = topCustomerEntries.map((c) => ({
        id: c.contactId || 'unknown',
        name: contactMap.get(c.contactId) || 'Unknown',
        revenue: c.revenue,
        invoices: c.invoices,
        avgInvoice: c.invoices > 0 ? Math.round(c.revenue / c.invoices) : 0,
      }));

      // Revenue by day (home currency, cents-safe)
      const revenueByDayMap = new Map<string, number[]>();
      currentInvoices.forEach((inv) => {
        const day = format(new Date(inv.createdAt), 'yyyy-MM-dd');
        const list = revenueByDayMap.get(day) ?? [];
        list.push(billedOf(inv));
        revenueByDayMap.set(day, list);
      });
      const revenueByDay = Array.from(revenueByDayMap.entries())
        .map(([date, amounts]) => ({ date, amount: sumMoney(amounts) }))
        .sort((a, b) => a.date.localeCompare(b.date));

      // Trends
      const trends: string[] = [];
      if (growthRate > 20) trends.push('Strong growth — accelerating revenue');
      else if (growthRate > 5) trends.push('Steady growth');
      else if (growthRate < -10) trends.push('Revenue declining — investigate causes');
      else if (growthRate < 0) trends.push('Slight revenue dip');

      if (avgInvoiceValue > 500) trends.push('High average transaction value');
      if (invoiceCount > 20) trends.push('High transaction volume');

      return {
        period: periodLabel,
        totalRevenue,
        previousPeriodRevenue: previousRevenue,
        growthRate,
        growthDirection: growthRate > 3 ? 'up' : growthRate < -3 ? 'down' : 'flat',
        averageInvoiceValue: avgInvoiceValue,
        invoiceCount,
        topCustomers,
        revenueByDay,
        trends,
      };
    } catch (error: any) {
      this.logger.error(`[analyzeRevenue] Error for ${businessId}: ${error.message}`);
      return this.emptyRevenueAnalysis(period || 'month');
    }
  }

  /* ─────── 3. Churn Risk Analysis ─────── */

  async analyzeChurnRisk(businessId: string): Promise<ChurnRisk[]> {
    try {
      const now = new Date();
      const thirtyDaysAgo = subDays(now, 30);
      const sixtyDaysAgo = subDays(now, 60);

      // Load home currency, canonical invoice money (remaining balances, D-14/D-75/D-13), and customers once
      const [homeCurrency, allInvoiceMoney, customers] = await Promise.all([
        this.getHomeCurrency(businessId),
        readInvoiceMoney(this.prisma.client, businessId, now),
        this.prisma.client.contact.findMany({
          where: {
            businessId,
            deletedAt: null,
            status: { in: CLIENT_STATUSES },
          },
          select: {
            id: true,
            ...CONTACT_NAME_SELECT,
            email: true,
            lastInteractionAt: true,
            createdAt: true,
          },
        }),
      ]);

      const homeInvoices = allInvoiceMoney.filter((inv) => inv.currency === homeCurrency);
      const creditedIds = homeInvoices
        .filter((inv) => inv.status === InvoiceStatus.PARTIALLY_CREDITED)
        .map((inv) => inv.id);
      const creditedOf = await this.appliedCreditsByInvoice(businessId, creditedIds);

      const invoicesByContact = new Map<string, InvoiceMoney[]>();
      for (const inv of homeInvoices) {
        if (!inv.contactId) continue;
        const list = invoicesByContact.get(inv.contactId) ?? [];
        list.push(inv);
        invoicesByContact.set(inv.contactId, list);
      }

      const risks: ChurnRisk[] = [];

      await Promise.all(
        customers.map(async (customer) => {
          const factors: string[] = [];
          let riskScore = 0;

          // Days since last interaction
          const daysSinceInteraction = customer.lastInteractionAt
            ? differenceInDays(now, customer.lastInteractionAt)
            : 999;
          if (daysSinceInteraction > 60) {
            riskScore += 40;
            factors.push(`No interaction in ${daysSinceInteraction} days`);
          } else if (daysSinceInteraction > 30) {
            riskScore += 25;
            factors.push(`No interaction in ${daysSinceInteraction} days`);
          }

          // Outstanding / overdue balances from canonical remaining-balance arithmetic (D-14, D-13/D-251, D-75)
          const custInvoices = invoicesByContact.get(customer.id) ?? [];
          const owedList = custInvoices
            .map((inv) => ({ inv, ...invoiceOwed(inv, now) }))
            .filter((x) => x.remaining > 0);
          const outstandingBalance = sumMoney(owedList.map((x) => x.remaining));
          const overdueBalance = sumMoney(owedList.filter((x) => x.overdue).map((x) => x.remaining));

          if (overdueBalance > 0) {
            riskScore += 30;
            factors.push(`$${overdueBalance.toLocaleString()} overdue balance`);
          }
          if (outstandingBalance > 0) {
            riskScore += 10;
          }

          // Cancelled bookings
          const cancelledBookings = await this.prisma.client.booking.count({
            where: {
              businessId,
              contactId: customer.id,
              status: BookingStatus.CANCELLED,
              updatedAt: { gte: thirtyDaysAgo },
            },
          });
          if (cancelledBookings > 0) {
            riskScore += 20;
            factors.push(`${cancelledBookings} cancelled booking(s) recently`);
          }

          // No bookings at all recently
          const recentBookings = await this.prisma.client.booking.count({
            where: {
              businessId,
              contactId: customer.id,
              startTime: { gte: sixtyDaysAgo },
              status: { not: BookingStatus.CANCELLED },
            },
          });
          if (recentBookings === 0) {
            riskScore += 15;
            factors.push('No bookings in 60 days');
          }

          // Recovery value: 30% of customer's home-currency net billed revenue
          const custTotalRevenue = sumMoney(
            custInvoices
              .filter((inv) => !NON_REVENUE_STATUSES.has(inv.status))
              .map((inv) =>
                inv.status === InvoiceStatus.PARTIALLY_CREDITED
                  ? fromCents(Math.max(0, toCents(inv.total) - toCents(creditedOf.get(inv.id) ?? 0)))
                  : inv.total,
              ),
          );
          const recoveryValue = roundMoney(custTotalRevenue * 0.3);

          if (riskScore >= 40) {
            let riskLevel: ChurnRisk['riskLevel'] = 'low';
            if (riskScore >= 70) riskLevel = 'critical';
            else if (riskScore >= 50) riskLevel = 'high';
            else if (riskScore >= 40) riskLevel = 'medium';

            let action = 'Send check-in message';
            if (riskScore >= 70) action = 'Personal outreach call + retention offer';
            else if (riskScore >= 50) action = 'Send personalized retention email with special offer';

            risks.push({
              contactId: customer.id,
              contactName: contactDisplayName(customer),
              email: customer.email || '',
              riskScore,
              riskLevel,
              factors,
              daysSinceLastInteraction: daysSinceInteraction,
              outstandingBalance,
              cancelledBookings,
              recommendedAction: action,
              estimatedRecoveryValue: recoveryValue,
            });
          }
        }),
      );

      risks.sort((a: any, b: any) => b.riskScore - a.riskScore);
      return risks;
    } catch (error: any) {
      this.logger.error(`[analyzeChurnRisk] Error for ${businessId}: ${error.message}`);
      return [];
    }
  }

  /* ─────── 4. Pipeline Analysis ─────── */

  async analyzePipeline(businessId: string): Promise<PipelineAnalysis> {
    try {
      // Get home currency, leads by stage, and leads with home-currency open deal values
      const [homeCurrency, leadsByStage, leads] = await Promise.all([
        this.getHomeCurrency(businessId),
        this.prisma.client.contact.groupBy({
          by: ['pipelineStage'],
          where: {
            businessId,
            deletedAt: null,
            status: LEAD_STATUS,
          },
          _count: { pipelineStage: true },
        }),
        this.prisma.client.contact.findMany({
          where: {
            businessId,
            deletedAt: null,
            status: LEAD_STATUS,
          },
          select: {
            pipelineStage: true,
            createdAt: true,
            lastInteractionAt: true,
            deals: openDealSelect(businessId),
          },
        }),
      ]);
      const leadsWithValue = leads.map((l) => ({
        stage: l.pipelineStage,
        value: openDealValue(l.deals, homeCurrency),
        createdAt: l.createdAt,
        lastInteractionAt: l.lastInteractionAt,
      }));

      const stageConfig = ['new', 'contacted', 'qualified', 'proposal', 'negotiation', 'closed_won', 'closed_lost'];
      const stageOrder = new Map(stageConfig.map((s, i) => [s, i]));

      // Build stage data
      const stages: PipelineAnalysis['stages'] = [];
      const funnel: PipelineAnalysis['funnel'] = [];

      for (const stageName of stageConfig) {
        const stageLeads = leadsWithValue.filter((l) => l.stage === stageName || (!l.stage && stageName === 'new'));
        const count = stageLeads.length;
        const value = sumMoney(stageLeads.map((l) => l.value));

        const avgDaysInStage = stageLeads.length > 0
          ? Math.round(
              stageLeads.reduce((sum, l) => {
                const lastActivity = l.lastInteractionAt || l.createdAt || new Date();
                return sum + differenceInDays(new Date(), lastActivity);
              }, 0) / stageLeads.length,
            )
          : 0;

        // Conversion rate to next stage (simplified estimate)
        const stageIdx = stageOrder.get(stageName) || 0;
        const nextStageName = stageConfig[stageIdx + 1];
        const nextStageCount = leadsByStage.find((s) => s.pipelineStage === nextStageName)?._count.pipelineStage || 0;
        const conversionRate = count > 0 ? Math.round((nextStageCount / count) * 100) : 0;

        stages.push({
          name: stageName,
          count,
          value,
          avgDaysInStage,
          conversionRate,
        });

        if (count > 0 && stageName !== 'closed_lost') {
          // Every row here is a lead (the query selects no status; filtering on one counted none).
          const totalLeads = leadsWithValue.length || 1;
          funnel.push({
            stage: stageName,
            count,
            percentage: Math.round((count / totalLeads) * 100),
          });
        }
      }

      const activeLeads = leadsWithValue.filter((l) => l.stage !== 'closed_won' && l.stage !== 'closed_lost');
      const totalPipelineValue = sumMoney(activeLeads.map((l) => l.value));
      const wonDeals = stages.find((s) => s.name === 'closed_won');
      const avgDealSize = wonDeals && wonDeals.count > 0 ? Math.round(wonDeals.value / wonDeals.count) : 0;

      // Calculate avg days to close
      const wonContacts = await this.prisma.client.contact.findMany({
        where: {
          businessId,
          deletedAt: null,
          status: { in: CLIENT_STATUSES },
        },
        select: {
          createdAt: true,
          lastInteractionAt: true,
        },
        take: 50,
      });
      const avgDaysToClose = wonContacts.length > 0
        ? Math.round(
            wonContacts.reduce((sum, c) => {
              const created = c.createdAt || new Date();
              const closed = c.lastInteractionAt || new Date();
              return sum + differenceInDays(closed, created);
            }, 0) / wonContacts.length,
          )
        : 0;

      // Identify bottlenecks
      const bottlenecks: string[] = [];
      stages.forEach((stage: any) => {
        if (stage.avgDaysInStage > 14) {
          bottlenecks.push(`${stage.name}: leads stuck for ${stage.avgDaysInStage} days avg`);
        }
        if (stage.conversionRate < 20 && stage.count > 5) {
          bottlenecks.push(`${stage.name}: low conversion (${stage.conversionRate}%)`);
        }
      });

      const recommendations: string[] = [];
      if (bottlenecks.length > 0) {
        recommendations.push('Address pipeline bottlenecks to accelerate deal flow');
      }
      if (stages.find((s) => s.name === 'new')?.count === 0) {
        recommendations.push('No new leads — increase marketing activity');
      }
      if (avgDaysToClose > 30) {
        recommendations.push('Long sales cycle — implement follow-up automation');
      }

      return {
        stages,
        totalLeads: leadsWithValue.length,
        totalPipelineValue,
        avgDealSize,
        avgDaysToClose,
        bottlenecks,
        recommendations,
        funnel,
      };
    } catch (error: any) {
      this.logger.error(`[analyzePipeline] Error for ${businessId}: ${error.message}`);
      return this.emptyPipelineAnalysis();
    }
  }

  /* ─────── 5. Cash Flow Analysis ─────── */

  async analyzeCashFlow(businessId: string): Promise<CashFlowAnalysis> {
    try {
      const now = new Date();
      const monthStart = startOfMonth(now);
      const thirtyDaysAgo = subDays(now, 30);
      const thirtyDaysAhead = addDays(now, 30);

      // P119 (FU-CORTEX-INSIGHT-CASH-TRUTH, D-14, D-13/D-251, D-75):
      // Read cash-in strictly from canonical payment rows by transaction date (and paidAt for
      // rowless PAID invoices per D-249/D-250, never updatedAt), and outstanding/upcoming
      // balances from canonical remaining balance (readInvoiceMoney + invoiceOwed), scoped to
      // the business's home currency and own live invoices/payments.
      const [homeCurrency, allInvoiceMoney, expenses] = await Promise.all([
        this.getHomeCurrency(businessId),
        readInvoiceMoney(this.prisma.client, businessId, now),
        this.prisma.client.expense.findMany({
          where: {
            businessId,
            deletedAt: null,
            status: 'PAID',
            date: { gte: monthStart },
          },
          select: { amount: true, currency: true },
        }),
      ]);

      const homeInvoices = allInvoiceMoney.filter((inv) => inv.currency === homeCurrency);
      const homeCash = homeInvoices.flatMap((inv) => inv.cash);

      // Money in = net home-currency cash received this month (SUCCESSFUL + negative REFUNDED, D-14)
      const moneyIn = sumMoney(
        homeCash
          .filter((row) => !!row.at && new Date(row.at) >= monthStart)
          .map((row) => row.amount),
      );

      // Money out = paid, non-deleted home-currency expenses (if tracked) or estimated from positive cash-in
      const homeExpenses = expenses.filter((e) => (normalizeCurrency(e.currency) || homeCurrency) === homeCurrency);
      const moneyOut = homeExpenses.length > 0
        ? sumMoney(homeExpenses.map((e) => e.amount || 0))
        : Math.round(Math.max(0, moneyIn) * 0.4); // Estimate 40% costs if no expense tracking

      const netFlow = subtractMoney(moneyIn, moneyOut);

      // Outstanding & DSO from canonical remaining balances (excludes paid-off / deleted / other currencies)
      const openOwed = homeInvoices
        .map((inv) => ({ inv, ...invoiceOwed(inv, now) }))
        .filter((x) => x.remaining > 0);
      const totalOutstanding = sumMoney(openOwed.map((x) => x.remaining));

      const openIds = openOwed.map((x) => x.inv.id);
      const openMetaRows = openIds.length
        ? await this.prisma.client.invoice.findMany({
            where: { businessId, deletedAt: null, id: { in: openIds } },
            select: { id: true, createdAt: true, contact: { select: CONTACT_NAME_SELECT } },
          })
        : [];
      const openMetaMap = new Map(openMetaRows.map((row) => [row.id, row]));

      const avgDaysOutstanding = openOwed.length > 0
        ? Math.round(
            openOwed.reduce((sum, x) => {
              const created = openMetaMap.get(x.inv.id)?.createdAt || now;
              return sum + differenceInDays(now, created);
            }, 0) / openOwed.length,
          )
        : 0;

      const collectedPositive = Math.max(0, moneyIn);
      const collectionRate = (collectedPositive + totalOutstanding) > 0
        ? Math.round((collectedPositive / (collectedPositive + totalOutstanding)) * 100)
        : 0;

      // Upcoming payments due (next 30 days, remaining balance in home currency)
      const upcomingPaymentsDue = openOwed
        .filter((x) => x.inv.dueDate && new Date(x.inv.dueDate) >= now && new Date(x.inv.dueDate) <= thirtyDaysAhead)
        .sort((a, b) => new Date(a.inv.dueDate!).getTime() - new Date(b.inv.dueDate!).getTime())
        .slice(0, 10)
        .map((x) => {
          const meta = openMetaMap.get(x.inv.id);
          const dueDate = x.inv.dueDate ? new Date(x.inv.dueDate) : now;
          return {
            id: x.inv.id,
            contactName: contactDisplayName(meta?.contact),
            amount: x.remaining,
            dueDate,
            daysUntilDue: differenceInDays(dueDate, now),
          };
        });

      // Collection issues
      const collectionIssues: string[] = [];
      if (avgDaysOutstanding > 30) {
        collectionIssues.push(`Average collection time is ${avgDaysOutstanding} days`);
      }
      if (collectionRate < 60) {
        collectionIssues.push(`Collection rate is ${collectionRate}% — improve follow-up`);
      }

      // Simple forecast — project next 30 days from net home-currency cash received in the last 30
      // over live own-tenant invoices (readInvoiceMoney cash rows match CASH_NET_PAYMENT_WHERE / D-14).
      const last30Cash = homeCash.filter((row) => !!row.at && new Date(row.at) >= thirtyDaysAgo);
      const avgDailyInflow = last30Cash.length > 0
        ? sumMoney(last30Cash.map((row) => row.amount)) / 30
        : moneyIn / 30;

      const projectedInflow = Math.round(avgDailyInflow * 30);
      const projectedOutflow = moneyOut; // Assume similar outflow
      const projectedNet = subtractMoney(projectedInflow, projectedOutflow);

      // Runway (months at current burn rate)
      const monthlyBurn = moneyOut || 1;
      const runway = moneyIn > 0 ? Math.round((moneyIn / monthlyBurn) * 10) / 10 : 0;

      return {
        period: 'This Month',
        moneyIn,
        moneyOut,
        netFlow,
        runway,
        collectionRate,
        daysSalesOutstanding: avgDaysOutstanding,
        upcomingPaymentsDue,
        collectionIssues,
        forecast: {
          projectedInflow,
          projectedOutflow,
          projectedNet,
          riskLevel: projectedNet < 0 ? 'high' : projectedNet < moneyIn * 0.2 ? 'medium' : 'low',
        },
      };
    } catch (error: any) {
      this.logger.error(`[analyzeCashFlow] Error for ${businessId}: ${error.message}`);
      return this.emptyCashFlowAnalysis();
    }
  }

  /* ─────── 6. Generate Business Report ─────── */

  async generateBusinessReport(
    businessId: string,
    scope: 'daily' | 'weekly' | 'monthly',
  ): Promise<BusinessReport> {
    this.logger.log(`[generateBusinessReport] Generating ${scope} report for ${businessId}`);
    const start = Date.now();

    const [revenue, pipeline, cashFlow, churnRisks, opportunities, context] = await Promise.all([
      this.analyzeRevenue(
        businessId,
        scope === 'daily' ? 'today' : scope === 'weekly' ? 'week' : 'month',
      ),
      this.analyzePipeline(businessId),
      this.analyzeCashFlow(businessId),
      this.analyzeChurnRisk(businessId),
      this.findProfitOpportunities(businessId),
      this.contextService.getFullContext(businessId),
    ]);

    // Build report key metrics
    const keyMetrics: Record<string, number | string> = {
      totalRevenue: revenue.totalRevenue,
      growthRate: `${revenue.growthRate}%`,
      outstandingInvoices: context.commerce.outstandingInvoices.total,
      overdueInvoices: context.commerce.outstandingInvoices.overdueTotal,
      activeLeads: pipeline.totalLeads,
      pipelineValue: pipeline.totalPipelineValue,
      completionRate: `${context.bookings.completionRate}%`,
      noShowRate: `${context.bookings.noShows.rate}%`,
      unreadMessages: context.inbox.unreadMessages,
      healthScore: context.summary.healthScore,
      automationRate: `${context.autopilot.automationRate}%`,
    };

    // Score calculation
    let score = context.summary.healthScore;
    if (cashFlow.forecast.riskLevel === 'high') score -= 15;
    if (churnRisks.some((r) => r.riskLevel === 'critical')) score -= 10;
    if (revenue.growthDirection === 'up') score += 5;
    score = Math.max(0, Math.min(100, score));

    // Generate narrative via AI
    let narrative: string;
    try {
      const prompt = this.buildReportPrompt(scope, revenue, pipeline, cashFlow, churnRisks, opportunities, context);
      const aiResponse = await (this.modelGateway as any).complete(prompt, {
        model: 'gpt-4o-mini',
        maxTokens: 800,
        temperature: 0.7,
      });
      narrative = (aiResponse as any).text || this.generateFallbackNarrative(scope, revenue, cashFlow, context);

      // Track AI usage
      await (this.aiUsage as any).track({
        businessId,
        model: 'gpt-4o-mini',
        tokensUsed: (aiResponse as any).tokensUsed || 0,
        cost: (aiResponse as any).cost || 0,
        feature: 'business_report',
      });
    } catch (aiError: any) {
      this.logger.warn(`[generateBusinessReport] AI generation failed, using fallback: ${aiError.message}`);
      narrative = this.generateFallbackNarrative(scope, revenue, cashFlow, context);
    }

    // Top priorities
    const topPriorities: string[] = [];
    if (context.commerce.outstandingInvoices.overdue > 0) {
      topPriorities.push(`Collect $${context.commerce.outstandingInvoices.overdueTotal.toLocaleString()} in overdue invoices (${context.commerce.outstandingInvoices.overdue} invoices)`);
    }
    if (churnRisks.length > 0) {
      const criticalList = churnRisks.filter((r) => r.riskLevel === 'critical');
      const criticalValue = sumMoney(criticalList.map((r) => r.estimatedRecoveryValue));
      topPriorities.push(`Address ${criticalList.length} critical churn risk(s) — estimated $${criticalValue.toLocaleString()} at risk`);
    }
    if (pipeline.bottlenecks.length > 0) {
      topPriorities.push(`Fix pipeline bottleneck: ${pipeline.bottlenecks[0]}`);
    }
    if (opportunities.length > 0) {
      const topOpps = opportunities.slice(0, 3);
      const oppValue = sumMoney(topOpps.map((o) => o.estimatedValue));
      topPriorities.push(`Pursue top ${topOpps.length} profit opportunities (est. $${oppValue.toLocaleString()})`);
    }

    const periodLabel = scope === 'daily'
      ? format(new Date(), 'EEEE, MMM d')
      : scope === 'weekly'
        ? `Week of ${format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'MMM d')}`
        : format(new Date(), 'MMMM yyyy');

    const elapsed = Date.now() - start;
    this.logger.log(`[generateBusinessReport] Generated ${scope} report in ${elapsed}ms`);

    return {
      scope,
      generatedAt: new Date(),
      period: periodLabel,
      narrative,
      revenue,
      pipeline,
      cashFlow,
      churnRisks: churnRisks.slice(0, 10),
      opportunities: opportunities.slice(0, 10),
      keyMetrics,
      topPriorities,
      score,
    };
  }

  /* ─────── 7. Generate Recommendations ─────── */

  async generateRecommendations(businessId: string): Promise<Recommendation[]> {
    this.logger.log(`[generateRecommendations] Cross-referencing insights for ${businessId}`);

    const [revenue, pipeline, cashFlow, churnRisks, opportunities, context] = await Promise.all([
      this.analyzeRevenue(businessId, 'month'),
      this.analyzePipeline(businessId),
      this.analyzeCashFlow(businessId),
      this.analyzeChurnRisk(businessId),
      this.findProfitOpportunities(businessId),
      this.contextService.getFullContext(businessId),
    ]);

    const recommendations: Recommendation[] = [];

    // ── Revenue recommendations ──
    if (revenue.growthDirection === 'down') {
      recommendations.push({
        id: `rec-rev-1`,
        title: 'Reverse revenue decline',
        description: `Revenue is down ${Math.abs(revenue.growthRate)}% vs last period. Focus on converting existing pipeline and re-engaging past customers.`,
        category: 'revenue',
        priority: 'critical',
        estimatedImpact: roundMoney(revenue.previousPeriodRevenue * 0.15),
        effort: 'medium',
        actionItems: [
          'Call top 5 at-risk customers',
          'Launch limited-time promotion to existing customers',
          'Accelerate deals in negotiation stage',
        ],
        sourceInsights: ['revenue_analysis', 'churn_risk'],
        confidence: 0.8,
      });
    }

    if (context.commerce.outstandingInvoices.overdue > 0) {
      recommendations.push({
        id: `rec-rev-2`,
        title: `Collect $${context.commerce.outstandingInvoices.overdueTotal.toLocaleString()} in overdue invoices`,
        description: `${context.commerce.outstandingInvoices.overdue} overdue invoices are tying up cash. Immediate collection effort needed.`,
        category: 'revenue',
        priority: 'critical',
        estimatedImpact: context.commerce.outstandingInvoices.overdueTotal,
        effort: 'quick',
        actionItems: [
          `Send automated payment reminders to ${context.commerce.outstandingInvoices.overdue} overdue accounts`,
          'Call largest overdue accounts personally',
          'Offer payment plans for accounts >60 days overdue',
        ],
        sourceInsights: ['cash_flow', 'profit_opportunities'],
        confidence: 0.9,
      });
    }

    if (pipeline.totalLeads > 0 && pipeline.bottlenecks.length > 0) {
      recommendations.push({
        id: `rec-rev-3`,
        title: 'Unblock sales pipeline',
        description: `${pipeline.totalLeads} leads worth $${pipeline.totalPipelineValue.toLocaleString()} are stuck. Address bottlenecks to accelerate revenue.`,
        category: 'revenue',
        priority: 'high',
        estimatedImpact: roundMoney(pipeline.totalPipelineValue * 0.25),
        effort: 'medium',
        actionItems: [
          `Fix bottleneck: ${pipeline.bottlenecks[0]}`,
          'Set up automated follow-up sequences for stalled leads',
          'Review and optimize proposal templates',
        ],
        sourceInsights: ['pipeline_analysis'],
        confidence: 0.75,
      });
    }

    // ── Retention recommendations ──
    if (churnRisks.length > 0) {
      const criticalRisks = churnRisks.filter((r) => r.riskLevel === 'critical');
      const recoveryValue = sumMoney(churnRisks.map((r) => r.estimatedRecoveryValue));
      recommendations.push({
        id: `rec-ret-1`,
        title: `Save ${criticalRisks.length} critical customer(s) from churning`,
        description: `${churnRisks.length} customers show churn signals. Estimated $${recoveryValue.toLocaleString()} in annual revenue at risk.`,
        category: 'retention',
        priority: criticalRisks.length > 0 ? 'critical' : 'high',
        estimatedImpact: recoveryValue,
        effort: 'medium',
        actionItems: [
          `Call ${criticalRisks[0]?.contactName || 'top at-risk customer'} personally`,
          'Send retention offers to high-risk customers',
          'Review recent negative feedback or complaints',
        ],
        sourceInsights: ['churn_risk'],
        confidence: 0.7,
      });
    }

    // ── Operations recommendations ──
    if (context.autopilot.automationRate < 30) {
      recommendations.push({
        id: `rec-ops-1`,
        title: 'Increase automation rate',
        description: `Automation rate is ${context.autopilot.automationRate}%. Increasing to 60%+ could save 10+ hours per week on manual tasks.`,
        category: 'operations',
        priority: 'medium',
        estimatedImpact: 1000,
        effort: 'medium',
        actionItems: [
          'Audit top 10 recurring manual tasks',
          'Set up autopilot workflow for lead follow-up',
          'Automate invoice reminders',
        ],
        sourceInsights: ['autopilot_context', 'profit_opportunities'],
        confidence: 0.85,
      });
    }

    if (context.bookings.noShows.rate > 10) {
      recommendations.push({
        id: `rec-ops-2`,
        title: 'Reduce no-show rate',
        description: `No-show rate is ${context.bookings.noShows.rate}%. Each no-show wastes time and revenue.`,
        category: 'operations',
        priority: 'high',
        estimatedImpact: roundMoney(context.bookings.todayBookings.totalValue * 0.15),
        effort: 'quick',
        actionItems: [
          'Enable SMS reminders 24h and 1h before appointments',
          'Require deposit for bookings',
          'Implement waitlist to backfill cancellations',
        ],
        sourceInsights: ['bookings_context'],
        confidence: 0.8,
      });
    }

    // ── Communication recommendations ──
    if (context.inbox.unreadMessages > 5) {
      recommendations.push({
        id: `rec-com-1`,
        title: 'Clear message backlog',
        description: `${context.inbox.unreadMessages} unread messages. Slow response times hurt customer satisfaction and conversions.`,
        category: 'communication',
        priority: 'medium',
        estimatedImpact: 500,
        effort: 'quick',
        actionItems: [
          'Set aside 30 minutes to respond to all unread messages',
          'Set up auto-responder for after-hours',
          'Enable KEY inbox intelligence for smart prioritization',
        ],
        sourceInsights: ['inbox_context'],
        confidence: 0.75,
      });
    }

    // Profit opportunities as recommendations
    opportunities.slice(0, 3).forEach((opp, idx) => {
      recommendations.push({
        id: `rec-opp-${idx}`,
        title: opp.title,
        description: opp.description,
        category: opp.type === 'stale_lead' || opp.type === 'upsell' ? 'revenue' : 'operations',
        priority: opp.priority === 'high' ? 'high' : 'medium',
        estimatedImpact: roundMoney(opp.estimatedValue * opp.confidence),
        effort: opp.timeframe === 'immediate' ? 'quick' : 'medium',
        actionItems: [opp.recommendedAction],
        sourceInsights: ['profit_opportunities'],
        confidence: opp.confidence,
      });
    });

    // Sort by priority + impact
    const priorityWeight = { critical: 4, high: 3, medium: 2, low: 1 };
    recommendations.sort((a: any, b: any) =>
        priorityWeight[b.priority as keyof typeof priorityWeight] * b.estimatedImpact -
        priorityWeight[a.priority as keyof typeof priorityWeight] * a.estimatedImpact,
    );

    this.logger.log(`[generateRecommendations] Generated ${recommendations.length} recommendations for ${businessId}`);
    return recommendations;
  }

  /* ─────── Helper: Build AI Report Prompt ─────── */

  private buildReportPrompt(
    scope: string,
    revenue: RevenueAnalysis,
    pipeline: PipelineAnalysis,
    cashFlow: CashFlowAnalysis,
    churnRisks: ChurnRisk[],
    opportunities: ProfitOpportunity[],
    context: any,
  ): string {
    return `
You are KEY, the AI business intelligence engine for KeyFlowOS.
Generate a concise ${scope} business report narrative for the business owner.

FINANCIAL SNAPSHOT:
- Revenue ${revenue.period}: $${revenue.totalRevenue.toLocaleString()} (${revenue.growthRate > 0 ? '+' : ''}${revenue.growthRate}% vs last period)
- Outstanding: $${context.commerce.outstandingInvoices.total.toLocaleString()} (${context.commerce.outstandingInvoices.overdue} overdue)
- Collection rate: ${context.commerce.collectionRate}%
- Cash flow: $${cashFlow.netFlow.toLocaleString()} net (${cashFlow.forecast.riskLevel} risk)

PIPELINE:
- ${pipeline.totalLeads} active leads, $${pipeline.totalPipelineValue.toLocaleString()} pipeline value
- Avg deal size: $${pipeline.avgDealSize.toLocaleString()}
${pipeline.bottlenecks.length > 0 ? `- Bottlenecks: ${pipeline.bottlenecks.join(', ')}` : ''}

CUSTOMER HEALTH:
- ${churnRisks.length} at-risk customers (${churnRisks.filter((r: any) => r.riskLevel === 'critical').length} critical)
- No-show rate: ${context.bookings.noShows.rate}%

OPPORTUNITIES:
${opportunities.slice(0, 3).map((o: any) => `- ${o.title} ($${o.estimatedValue.toLocaleString()} est. value)`).join('\n')}

Write 3-4 paragraphs: (1) headline summary, (2) what's working, (3) what needs attention, (4) top 2-3 actions. Keep it conversational and action-oriented. No fluff.
`.trim();
  }

  /* ─────── Helper: Fallback Narrative ─────── */

  private generateFallbackNarrative(
    scope: string,
    revenue: RevenueAnalysis,
    cashFlow: CashFlowAnalysis,
    context: any,
  ): string {
    const parts: string[] = [];
    const periodLabel = scope === 'daily' ? 'Today' : scope === 'weekly' ? 'This week' : 'This month';

    // Headline
    if (revenue.growthDirection === 'up') {
      parts.push(`${periodLabel} shows positive momentum with revenue at $${revenue.totalRevenue.toLocaleString()} (up ${revenue.growthRate}%).`);
    } else if (revenue.growthDirection === 'down') {
      parts.push(`${periodLabel} needs attention — revenue at $${revenue.totalRevenue.toLocaleString()} (down ${Math.abs(revenue.growthRate)}%).`);
    } else {
      parts.push(`${periodLabel} revenue held steady at $${revenue.totalRevenue.toLocaleString()}.`);
    }

    // Cash flow
    if (cashFlow.forecast.riskLevel === 'high') {
      parts.push(`Cash flow is a concern with net flow at $${cashFlow.netFlow.toLocaleString()}. Outstanding invoices total $${context.commerce.outstandingInvoices.total.toLocaleString()} with $${context.commerce.outstandingInvoices.overdueTotal.toLocaleString()} overdue — prioritize collections.`);
    } else {
      parts.push(`Cash flow looks healthy at $${cashFlow.netFlow.toLocaleString()} net. Collection rate is ${context.commerce.collectionRate}%.`);
    }

    // Operations
    parts.push(`Operations: ${context.bookings.todayBookings.count} appointments today with ${context.bookings.completionRate}% completion rate. ${context.autopilot.activeTasks.length} active tasks in autopilot.`);

    // Action items
    const actions: string[] = [];
    if (context.commerce.outstandingInvoices.overdue > 0) {
      actions.push(`collect $${context.commerce.outstandingInvoices.overdueTotal.toLocaleString()} in overdue invoices`);
    }
    if (context.inbox.unreadMessages > 5) {
      actions.push(`clear ${context.inbox.unreadMessages} unread messages`);
    }
    if (actions.length > 0) {
      parts.push(`Priority actions: ${actions.join(', ')}.`);
    }

    return parts.join(' ');
  }

  /* ─────── Empty Result Helpers ─────── */

  private emptyRevenueAnalysis(period: string): RevenueAnalysis {
    return {
      period,
      totalRevenue: 0,
      previousPeriodRevenue: 0,
      growthRate: 0,
      growthDirection: 'flat',
      averageInvoiceValue: 0,
      invoiceCount: 0,
      topCustomers: [],
      revenueByDay: [],
      trends: ['No revenue data available'],
    };
  }

  private emptyPipelineAnalysis(): PipelineAnalysis {
    return {
      stages: [],
      totalLeads: 0,
      totalPipelineValue: 0,
      avgDealSize: 0,
      avgDaysToClose: 0,
      bottlenecks: [],
      recommendations: ['No pipeline data available'],
      funnel: [],
    };
  }

  private emptyCashFlowAnalysis(): CashFlowAnalysis {
    return {
      period: 'N/A',
      moneyIn: 0,
      moneyOut: 0,
      netFlow: 0,
      runway: 0,
      collectionRate: 0,
      daysSalesOutstanding: 0,
      upcomingPaymentsDue: [],
      collectionIssues: [],
      forecast: {
        projectedInflow: 0,
        projectedOutflow: 0,
        projectedNet: 0,
        riskLevel: 'low',
      },
    };
  }

  /**
   * Return businessIds that currently have real-time listeners.
   * Stub: returns an empty array.
   */
  async getActiveBusinessIds(): Promise<string[]> {
    return [];
  }

  /**
   * Compute a lightweight health snapshot for a business.
   * Stub: returns a neutral health object.
   */
  async getBusinessHealth(businessId: string): Promise<{
    score: number;
    trends: Array<{ label: string; value: number; direction: 'up' | 'down' | 'flat' }>;
    alerts: Array<{ severity: 'low' | 'medium' | 'high'; message: string }>;
  } | null> {
    this.logger.debug(`[getBusinessHealth] ${businessId}`);
    return {
      score: 75,
      trends: [],
      alerts: [],
    };
  }
}
