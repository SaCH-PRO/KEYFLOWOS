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
import { ModelGatewayService } from '../../ai/model-gateway.service';
import { AiUsageService } from '../../ai/ai-usage.service';
import { KeyCortexContextV2Service } from './key-cortex-context-v2.service';
import { startOfMonth, startOfWeek, startOfDay, subDays, subMonths, subWeeks, format, differenceInDays } from 'date-fns';

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

  /* ─────── 1. Find Profit Opportunities ─────── */

  async findProfitOpportunities(businessId: string): Promise<ProfitOpportunity[]> {
    this.logger.log(`[findProfitOpportunities] Analyzing ${businessId}`);
    const start = Date.now();
    const opportunities: ProfitOpportunity[] = [];

    try {
      // 1a. Overdue invoices = quick cash
      const overdueInvoices = await this.prisma.invoice.findMany({
        where: {
          businessId,
          status: { in: ['sent', 'pending'] },
          dueDate: { lt: new Date() },
        },
        include: {
          contact: { select: { id: true, name: true, email: true } },
          items: { select: { total: true } },
        },
        orderBy: { dueDate: 'asc' },
        take: 20,
      });

      overdueInvoices.forEach((inv) => {
        const amount = inv.total || 0;
        const daysOverdue = differenceInDays(new Date(), inv.dueDate);
        opportunities.push({
          id: `inv-${inv.id}`,
          type: 'overdue_invoice',
          title: `Collect $${amount.toLocaleString()} from ${inv.contact?.name || 'Unknown'}`,
          description: `Invoice ${inv.invoiceNumber || inv.id} is ${daysOverdue} days overdue. Follow up to collect payment.`,
          estimatedValue: amount,
          confidence: Math.min(0.9, 0.5 + daysOverdue * 0.01),
          recommendedAction: `Send payment reminder for invoice ${inv.invoiceNumber || inv.id}. Escalate to phone call if ${daysOverdue + 3} days.`,
          sourceData: { invoiceId: inv.id, daysOverdue, amount },
          priority: daysOverdue > 30 ? 'high' : 'medium',
          timeframe: 'immediate',
        });
      });

      // 1b. Stale leads = revenue waiting
      const staleLeads = await this.prisma.contact.findMany({
        where: {
          businessId,
          status: 'lead',
          lastActivityAt: { lt: subDays(new Date(), 14) },
          score: { gte: 50 },
        },
        orderBy: { score: 'desc' },
        take: 15,
        select: {
          id: true,
          name: true,
          email: true,
          score: true,
          lastActivityAt: true,
          stage: true,
          estimatedValue: true,
        },
      });

      staleLeads.forEach((lead) => {
        const daysStale = lead.lastActivityAt
          ? differenceInDays(new Date(), lead.lastActivityAt)
          : 30;
        const estValue = lead.estimatedValue || 500;
        opportunities.push({
          id: `lead-${lead.id}`,
          type: 'stale_lead',
          title: `Re-engage ${lead.name || 'lead'} (score: ${lead.score})`,
          description: `High-value lead hasn't been contacted in ${daysStale} days. Estimated deal value: $${estValue.toLocaleString()}.`,
          estimatedValue: estValue,
          confidence: Math.min(0.8, 0.4 + (lead.score || 0) * 0.005),
          recommendedAction: `Send personalized re-engagement email to ${lead.name}. Offer a time-sensitive incentive.`,
          sourceData: { contactId: lead.id, daysStale, score: lead.score },
          priority: (lead.score || 0) > 80 ? 'high' : 'medium',
          timeframe: 'this_week',
        });
      });

      // 1c. Underutilized products
      const underutilized = await this.prisma.product.findMany({
        where: {
          businessId,
          status: 'active',
        },
        include: {
          _count: { select: { invoiceItems: true } },
        },
        orderBy: { price: 'desc' },
        take: 10,
      });

      underutilized
        .filter((p) => p._count.invoiceItems < 3 && p.price > 100)
        .forEach((product) => {
          opportunities.push({
            id: `prod-${product.id}`,
            type: 'underutilized_product',
            title: `Promote "${product.name}" — only sold ${product._count.invoiceItems} times`,
            description: `Premium product at $${(product.price || 0).toLocaleString()} is underutilized. Create a targeted campaign.`,
            estimatedValue: (product.price || 0) * 10,
            confidence: 0.6,
            recommendedAction: `Feature ${product.name} in next email campaign. Create bundle with popular products.`,
            sourceData: { productId: product.id, salesCount: product._count.invoiceItems },
            priority: 'medium',
            timeframe: 'this_month',
          });
        });

      // 1d. Automation opportunities
      const manualTasks = await this.prisma.autopilotTask.count({
        where: {
          businessId,
          source: 'manual',
          createdAt: { gte: subDays(new Date(), 30) },
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

      // 1e. Upsell opportunities — customers with repeat purchases
      const repeatCustomers = await this.prisma.contact.findMany({
        where: {
          businessId,
          status: 'customer',
        },
        include: {
          _count: {
            select: { invoices: true },
          },
          invoices: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { total: true, createdAt: true },
          },
        },
        orderBy: { invoices: { _count: 'desc' } },
        take: 10,
      });

      repeatCustomers
        .filter((c) => c._count.invoices >= 2)
        .forEach((customer) => {
          const lastInvoice = customer.invoices[0];
          const daysSincePurchase = lastInvoice?.createdAt
            ? differenceInDays(new Date(), lastInvoice.createdAt)
            : 0;
          if (daysSincePurchase > 30 && daysSincePurchase < 90) {
            const avgValue = lastInvoice?.total || 500;
            opportunities.push({
              id: `upsell-${customer.id}`,
              type: 'upsell',
              title: `Upsell ${customer.name || 'customer'} — repeat buyer, ${daysSincePurchase}d since last purchase`,
              description: `Loyal customer with ${c._count.invoices} purchases. Last order: $${avgValue.toLocaleString()}. Ready for next purchase.`,
              estimatedValue: avgValue * 1.2,
              confidence: 0.7,
              recommendedAction: `Send personalized upsell offer to ${customer.name || 'customer'}. Recommend premium tier or bundle.`,
              sourceData: { contactId: customer.id, purchaseCount: c._count.invoices, daysSincePurchase },
              priority: 'medium',
              timeframe: 'this_week',
            });
          }
        });

      // Sort by estimated value * confidence
      opportunities.sort((a, b) => b.estimatedValue * b.confidence - a.estimatedValue * a.confidence);

      const elapsed = Date.now() - start;
      this.logger.log(`[findProfitOpportunities] Found ${opportunities.length} opportunities in ${elapsed}ms`);

      return opportunities;
    } catch (error) {
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

      const [currentInvoices, previousInvoices, topCustomersRaw] = await Promise.all([
        this.prisma.invoice.findMany({
          where: {
            businessId,
            createdAt: { gte: periodStart },
            status: { not: 'draft' },
          },
          include: {
            contact: { select: { id: true, name: true } },
            items: true,
          },
        }),
        this.prisma.invoice.findMany({
          where: {
            businessId,
            createdAt: { gte: previousStart, lt: periodStart },
            status: { not: 'draft' },
          },
          select: { total: true },
        }),
        this.prisma.invoice.groupBy({
          by: ['contactId'],
          where: {
            businessId,
            createdAt: { gte: periodStart },
            status: { not: 'draft' },
          },
          _sum: { total: true },
          _count: { id: true },
          orderBy: { _sum: { total: 'desc' } },
          take: 5,
        }),
      ]);

      const totalRevenue = currentInvoices.reduce((s, i) => s + (i.total || 0), 0);
      const previousRevenue = previousInvoices.reduce((s, i) => s + (i.total || 0), 0);
      const growthRate = previousRevenue > 0
        ? Math.round(((totalRevenue - previousRevenue) / previousRevenue) * 100)
        : 0;

      const invoiceCount = currentInvoices.length;
      const avgInvoiceValue = invoiceCount > 0 ? Math.round(totalRevenue / invoiceCount) : 0;

      // Top customers
      const contactIds = topCustomersRaw.map((c) => c.contactId).filter(Boolean);
      const contacts = contactIds.length
        ? await this.prisma.contact.findMany({
            where: { id: { in: contactIds } },
            select: { id: true, name: true },
          })
        : [];
      const contactMap = new Map(contacts.map((c) => [c.id, c.name]));

      const topCustomers = topCustomersRaw.map((c) => ({
        id: c.contactId || 'unknown',
        name: contactMap.get(c.contactId || '') || 'Unknown',
        revenue: c._sum.total || 0,
        invoices: c._count.id || 0,
        avgInvoice: c._count.id > 0 ? Math.round((c._sum.total || 0) / c._count.id) : 0,
      }));

      // Revenue by day
      const revenueByDayMap = new Map<string, number>();
      currentInvoices.forEach((inv) => {
        const day = format(new Date(inv.createdAt), 'yyyy-MM-dd');
        revenueByDayMap.set(day, (revenueByDayMap.get(day) || 0) + (inv.total || 0));
      });
      const revenueByDay = Array.from(revenueByDayMap.entries())
        .map(([date, amount]) => ({ date, amount }))
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
    } catch (error) {
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

      // Get all customers with engagement signals
      const customers = await this.prisma.contact.findMany({
        where: {
          businessId,
          status: { in: ['customer', 'active'] },
        },
        select: {
          id: true,
          name: true,
          email: true,
          lastActivityAt: true,
          createdAt: true,
        },
      });

      const risks: ChurnRisk[] = [];

      await Promise.all(
        customers.map(async (customer) => {
          const factors: string[] = [];
          let riskScore = 0;

          // Days since last interaction
          const daysSinceInteraction = customer.lastActivityAt
            ? differenceInDays(now, customer.lastActivityAt)
            : 999;
          if (daysSinceInteraction > 60) {
            riskScore += 40;
            factors.push(`No interaction in ${daysSinceInteraction} days`);
          } else if (daysSinceInteraction > 30) {
            riskScore += 25;
            factors.push(`No interaction in ${daysSinceInteraction} days`);
          }

          // Outstanding invoices
          const outstanding = await this.prisma.invoice.findMany({
            where: {
              contactId: customer.id,
              status: { in: ['sent', 'pending', 'partial'] },
            },
            select: { total: true, dueDate: true },
          });
          const outstandingBalance = outstanding.reduce((s, i) => s + (i.total || 0), 0);
          const overdueBalance = outstanding
            .filter((i) => i.dueDate && i.dueDate < now)
            .reduce((s, i) => s + (i.total || 0), 0);

          if (overdueBalance > 0) {
            riskScore += 30;
            factors.push(`$${overdueBalance.toLocaleString()} overdue balance`);
          }
          if (outstandingBalance > 0) {
            riskScore += 10;
          }

          // Cancelled bookings
          const cancelledBookings = await this.prisma.booking.count({
            where: {
              contactId: customer.id,
              status: 'cancelled',
              updatedAt: { gte: thirtyDaysAgo },
            },
          });
          if (cancelledBookings > 0) {
            riskScore += 20;
            factors.push(`${cancelledBookings} cancelled booking(s) recently`);
          }

          // No bookings at all recently
          const recentBookings = await this.prisma.booking.count({
            where: {
              contactId: customer.id,
              startTime: { gte: sixtyDaysAgo },
              status: { not: 'cancelled' },
            },
          });
          if (recentBookings === 0) {
            riskScore += 15;
            factors.push('No bookings in 60 days');
          }

          // Calculate recovery value
          const totalRevenue = await this.prisma.invoice.aggregate({
            where: {
              contactId: customer.id,
              status: { not: 'draft' },
            },
            _sum: { total: true },
          });
          const recoveryValue = (totalRevenue._sum.total || 0) * 0.3;

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
              contactName: customer.name || 'Unknown',
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

      risks.sort((a, b) => b.riskScore - a.riskScore);
      return risks;
    } catch (error) {
      this.logger.error(`[analyzeChurnRisk] Error for ${businessId}: ${error.message}`);
      return [];
    }
  }

  /* ─────── 4. Pipeline Analysis ─────── */

  async analyzePipeline(businessId: string): Promise<PipelineAnalysis> {
    try {
      // Get all leads grouped by stage
      const leadsByStage = await this.prisma.contact.groupBy({
        by: ['stage'],
        where: {
          businessId,
          status: 'lead',
        },
        _count: { stage: true },
      });

      // Get estimated values per stage
      const leadsWithValue = await this.prisma.contact.findMany({
        where: {
          businessId,
          status: 'lead',
        },
        select: {
          stage: true,
          estimatedValue: true,
          createdAt: true,
          lastActivityAt: true,
        },
      });

      const stageConfig = ['new', 'contacted', 'qualified', 'proposal', 'negotiation', 'closed_won', 'closed_lost'];
      const stageOrder = new Map(stageConfig.map((s, i) => [s, i]));

      // Build stage data
      const stages: PipelineAnalysis['stages'] = [];
      const funnel: PipelineAnalysis['funnel'] = [];

      for (const stageName of stageConfig) {
        const stageLeads = leadsWithValue.filter((l) => l.stage === stageName || (!l.stage && stageName === 'new'));
        const count = stageLeads.length;
        const value = stageLeads.reduce((s, l) => s + (l.estimatedValue || 0), 0);

        const avgDaysInStage = stageLeads.length > 0
          ? Math.round(
              stageLeads.reduce((sum, l) => {
                const lastActivity = l.lastActivityAt || l.createdAt || new Date();
                return sum + differenceInDays(new Date(), lastActivity);
              }, 0) / stageLeads.length,
            )
          : 0;

        // Conversion rate to next stage (simplified estimate)
        const stageIdx = stageOrder.get(stageName) || 0;
        const nextStageName = stageConfig[stageIdx + 1];
        const nextStageCount = leadsByStage.find((s) => s.stage === nextStageName)?._count.stage || 0;
        const conversionRate = count > 0 ? Math.round((nextStageCount / count) * 100) : 0;

        stages.push({
          name: stageName,
          count,
          value,
          avgDaysInStage,
          conversionRate,
        });

        if (count > 0 && stageName !== 'closed_lost') {
          const totalLeads = leadsWithValue.filter((l) => l.status === 'lead').length || 1;
          funnel.push({
            stage: stageName,
            count,
            percentage: Math.round((count / totalLeads) * 100),
          });
        }
      }

      const activeLeads = leadsWithValue.filter((l) => l.stage !== 'closed_won' && l.stage !== 'closed_lost');
      const totalPipelineValue = activeLeads.reduce((s, l) => s + (l.estimatedValue || 0), 0);
      const wonDeals = stages.find((s) => s.name === 'closed_won');
      const avgDealSize = wonDeals && wonDeals.count > 0 ? Math.round(wonDeals.value / wonDeals.count) : 0;

      // Calculate avg days to close
      const wonContacts = await this.prisma.contact.findMany({
        where: {
          businessId,
          status: 'customer',
        },
        select: {
          createdAt: true,
          lastActivityAt: true,
        },
        take: 50,
      });
      const avgDaysToClose = wonContacts.length > 0
        ? Math.round(
            wonContacts.reduce((sum, c) => {
              const created = c.createdAt || new Date();
              const closed = c.lastActivityAt || new Date();
              return sum + differenceInDays(closed, created);
            }, 0) / wonContacts.length,
          )
        : 0;

      // Identify bottlenecks
      const bottlenecks: string[] = [];
      stages.forEach((stage) => {
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
    } catch (error) {
      this.logger.error(`[analyzePipeline] Error for ${businessId}: ${error.message}`);
      return this.emptyPipelineAnalysis();
    }
  }

  /* ─────── 5. Cash Flow Analysis ─────── */

  async analyzeCashFlow(businessId: string): Promise<CashFlowAnalysis> {
    try {
      const now = new Date();
      const monthStart = startOfMonth(now);

      // Money in = paid invoices
      const paidInvoices = await this.prisma.invoice.findMany({
        where: {
          businessId,
          status: 'paid',
          updatedAt: { gte: monthStart },
        },
        select: { total: true },
      });
      const moneyIn = paidInvoices.reduce((s, i) => s + (i.total || 0), 0);

      // Money out = expenses (if tracked) or estimated from costs
      const expenses = await this.prisma.expense.findMany({
        where: {
          businessId,
          date: { gte: monthStart },
        },
        select: { amount: true },
      });
      const moneyOut = expenses.length > 0
        ? expenses.reduce((s, e) => s + (e.amount || 0), 0)
        : Math.round(moneyIn * 0.4); // Estimate 40% costs if no expense tracking

      const netFlow = moneyIn - moneyOut;

      // Days sales outstanding
      const outstandingInvoices = await this.prisma.invoice.findMany({
        where: {
          businessId,
          status: { in: ['sent', 'pending', 'partial'] },
        },
        select: { total: true, dueDate: true, createdAt: true },
      });
      const totalOutstanding = outstandingInvoices.reduce((s, i) => s + (i.total || 0), 0);
      const avgDaysOutstanding = outstandingInvoices.length > 0
        ? Math.round(
            outstandingInvoices.reduce((sum, i) => {
              const created = i.createdAt || new Date();
              return sum + differenceInDays(now, created);
            }, 0) / outstandingInvoices.length,
          )
        : 0;

      const collectionRate = (moneyIn + totalOutstanding) > 0
        ? Math.round((moneyIn / (moneyIn + totalOutstanding)) * 100)
        : 0;

      // Upcoming payments due
      const upcomingDue = await this.prisma.invoice.findMany({
        where: {
          businessId,
          status: { in: ['sent', 'pending', 'partial'] },
          dueDate: { gte: now, lte: subDays(now, -30) },
        },
        include: {
          contact: { select: { name: true } },
        },
        orderBy: { dueDate: 'asc' },
        take: 10,
      });

      const upcomingPaymentsDue = upcomingDue.map((inv) => ({
        id: inv.id,
        contactName: inv.contact?.name || 'Unknown',
        amount: inv.total || 0,
        dueDate: inv.dueDate || new Date(),
        daysUntilDue: differenceInDays(inv.dueDate || now, now),
      }));

      // Collection issues
      const collectionIssues: string[] = [];
      if (avgDaysOutstanding > 30) {
        collectionIssues.push(`Average collection time is ${avgDaysOutstanding} days`);
      }
      if (collectionRate < 60) {
        collectionIssues.push(`Collection rate is ${collectionRate}% — improve follow-up`);
      }

      // Simple forecast — project next 30 days
      const last30Days = await this.prisma.payment.findMany({
        where: {
          businessId,
          createdAt: { gte: subDays(now, 30) },
          status: 'completed',
        },
        select: { amount: true },
      });
      const avgDailyInflow = last30Days.length > 0
        ? last30Days.reduce((s, p) => s + (p.amount || 0), 0) / 30
        : moneyIn / 30;

      const projectedInflow = Math.round(avgDailyInflow * 30);
      const projectedOutflow = moneyOut; // Assume similar outflow
      const projectedNet = projectedInflow - projectedOutflow;

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
    } catch (error) {
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
    let narrative = '';
    try {
      const prompt = this.buildReportPrompt(scope, revenue, pipeline, cashFlow, churnRisks, opportunities, context);
      const aiResponse = await this.modelGateway.complete(prompt, {
        model: 'gpt-4o-mini',
        maxTokens: 800,
        temperature: 0.7,
      });
      narrative = aiResponse.text || this.generateFallbackNarrative(scope, revenue, cashFlow, context);

      // Track AI usage
      await this.aiUsage.track({
        businessId,
        model: 'gpt-4o-mini',
        tokensUsed: aiResponse.tokensUsed || 0,
        cost: aiResponse.cost || 0,
        feature: 'business_report',
      });
    } catch (aiError) {
      this.logger.warn(`[generateBusinessReport] AI generation failed, using fallback: ${aiError.message}`);
      narrative = this.generateFallbackNarrative(scope, revenue, cashFlow, context);
    }

    // Top priorities
    const topPriorities: string[] = [];
    if (context.commerce.outstandingInvoices.overdue > 0) {
      topPriorities.push(`Collect $${context.commerce.outstandingInvoices.overdueTotal.toLocaleString()} in overdue invoices (${context.commerce.outstandingInvoices.overdue} invoices)`);
    }
    if (churnRisks.length > 0) {
      const critical = churnRisks.filter((r) => r.riskLevel === 'critical').length;
      topPriorities.push(`Address ${critical} critical churn risk(s) — estimated $${churnRisks.filter((r) => r.riskLevel === 'critical').reduce((s, r) => s + r.estimatedRecoveryValue, 0).toLocaleString()} at risk`);
    }
    if (pipeline.bottlenecks.length > 0) {
      topPriorities.push(`Fix pipeline bottleneck: ${pipeline.bottlenecks[0]}`);
    }
    if (opportunities.length > 0) {
      const topOpps = opportunities.slice(0, 3);
      const oppValue = topOpps.reduce((s, o) => s + o.estimatedValue, 0);
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
        estimatedImpact: revenue.previousPeriodRevenue * 0.15,
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
        estimatedImpact: pipeline.totalPipelineValue * 0.25,
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
      const recoveryValue = churnRisks.reduce((s, r) => s + r.estimatedRecoveryValue, 0);
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
        estimatedImpact: context.bookings.todayBookings.totalValue * 0.15,
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
        estimatedImpact: opp.estimatedValue * opp.confidence,
        effort: opp.timeframe === 'immediate' ? 'quick' : 'medium',
        actionItems: [opp.recommendedAction],
        sourceInsights: ['profit_opportunities'],
        confidence: opp.confidence,
      });
    });

    // Sort by priority + impact
    const priorityWeight = { critical: 4, high: 3, medium: 2, low: 1 };
    recommendations.sort(
      (a, b) =>
        priorityWeight[b.priority] * b.estimatedImpact -
        priorityWeight[a.priority] * a.estimatedImpact,
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
- ${churnRisks.length} at-risk customers (${churnRisks.filter((r) => r.riskLevel === 'critical').length} critical)
- No-show rate: ${context.bookings.noShows.rate}%

OPPORTUNITIES:
${opportunities.slice(0, 3).map((o) => `- ${o.title} ($${o.estimatedValue.toLocaleString()} est. value)`).join('\n')}

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
}
