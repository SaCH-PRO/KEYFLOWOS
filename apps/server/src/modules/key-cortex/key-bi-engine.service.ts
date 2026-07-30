/**
 * KEY Business Intelligence Engine — Phase D.2
 * Real-time Business Mental Model
 *
 * Refreshes every 15 minutes per active business:
 * - Health score
 * - Top risks
 * - Top opportunities
 * - Key trends
 * - Attention-required items
 *
 * Results are cached in Redis (15-min TTL) and persisted to
 * BusinessHealthSnapshot for historical tracking.
 */

import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../core/prisma/prisma.service';
import { RedisService } from '../../core/redis/redis.service';
import { InvoiceStatus, DealStatus } from '@prisma/client';
import { subDays, startOfMonth, subMonths } from 'date-fns';

export interface BusinessRiskItem {
  type: 'cashflow' | 'churn' | 'pipeline' | 'operations' | 'genome';
  title: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  score: number; // 0-100
  reason: string;
}

export interface BusinessOpportunityItem {
  type: 'revenue' | 'lead' | 'deal' | 'automation';
  title: string;
  estimatedValue: number;
  confidence: number; // 0-1
  reason: string;
}

export interface AttentionItem {
  type: string;
  title: string;
  count: number;
  priority: 'low' | 'medium' | 'high' | 'urgent';
}

export interface BusinessMetrics {
  pendingInvoices: number;
  overdueInvoices: number;
  overdueInvoiceTotal: number;
  overdueTasks: number;
  activeLeads: number;
  activeDeals: number;
  activeDealValue: number;
  monthlyRevenue: number;
  previousMonthRevenue: number;
  revenueTrend: 'up' | 'down' | 'flat';
  genomeIntegrity: number;
}

export interface BusinessMentalModel {
  businessId: string;
  generatedAt: Date;
  healthScore: number;
  healthStatus: 'excellent' | 'good' | 'fair' | 'poor' | 'critical';
  topRisks: BusinessRiskItem[];
  topOpportunities: BusinessOpportunityItem[];
  keyTrends: string[];
  attentionItems: AttentionItem[];
  metrics: BusinessMetrics;
}

const CACHE_PREFIX = 'key-bi-engine:mental-model';
const CACHE_TTL_SECONDS = 15 * 60; // 15 minutes
const ACTIVE_BUSINESS_LIMIT = 500;

@Injectable()
export class KeyBiEngineService {
  private readonly logger = new Logger(KeyBiEngineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  // ═══════════════════════════════════════════════════════════
  // Scheduled refresh (every 15 minutes)
  // ═══════════════════════════════════════════════════════════

  @Cron('*/15 * * * *')
  async refreshAll(): Promise<void> {
    this.logger.log('[refreshAll] Refreshing business mental models...');

    const businessIds = await this.getActiveBusinesses();
    let refreshed = 0;
    let failed = 0;

    for (const businessId of businessIds) {
      try {
        await this.refreshBusiness(businessId);
        refreshed++;
      } catch (err: unknown) {
        failed++;
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`[refreshAll] Failed for ${businessId}: ${msg}`);
      }
    }

    this.logger.log(`[refreshAll] Complete: ${refreshed} refreshed, ${failed} failed`);
  }

  // ═══════════════════════════════════════════════════════════
  // Public API
  // ═══════════════════════════════════════════════════════════

  async getMentalModel(businessId: string): Promise<BusinessMentalModel | null> {
    const cached = await this.getCachedModel(businessId);
    if (cached) {
      return cached;
    }

    try {
      return await this.refreshBusiness(businessId);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[getMentalModel] Failed to compute model for ${businessId}: ${msg}`);
      return null;
    }
  }

  async refreshBusiness(businessId: string): Promise<BusinessMentalModel> {
    const model = await this.computeMentalModel(businessId);
    await Promise.all([
      this.cacheModel(businessId, model),
      this.persistSnapshot(businessId, model),
    ]);
    return model;
  }

  // ═══════════════════════════════════════════════════════════
  // Computation
  // ═══════════════════════════════════════════════════════════

  async computeMentalModel(businessId: string): Promise<BusinessMentalModel> {
    const [
      genome,
      invoiceSummary,
      overdueTasks,
      leadSummary,
      dealSummary,
      revenueSummary,
    ] = await Promise.all([
      this.getGenomeData(businessId),
      this.getInvoiceSummary(businessId),
      this.countOverdueTasks(businessId),
      this.getLeadSummary(businessId),
      this.getDealSummary(businessId),
      this.getRevenueSummary(businessId),
    ]);

    const metrics: BusinessMetrics = {
      pendingInvoices: invoiceSummary.pending,
      overdueInvoices: invoiceSummary.overdue,
      overdueInvoiceTotal: invoiceSummary.overdueTotal,
      overdueTasks,
      activeLeads: leadSummary.active,
      activeDeals: dealSummary.active,
      activeDealValue: dealSummary.value,
      monthlyRevenue: revenueSummary.current,
      previousMonthRevenue: revenueSummary.previous,
      revenueTrend: revenueSummary.trend,
      genomeIntegrity: genome.integrity,
    };

    const { healthScore, healthStatus } = this.calculateHealth(metrics);
    const topRisks = this.deriveRisks(metrics, genome);
    const topOpportunities = this.deriveOpportunities(metrics, invoiceSummary);
    const keyTrends = this.deriveTrends(metrics);
    const attentionItems = this.deriveAttentionItems(metrics);

    return {
      businessId,
      generatedAt: new Date(),
      healthScore,
      healthStatus,
      topRisks,
      topOpportunities,
      keyTrends,
      attentionItems,
      metrics,
    };
  }

  // ═══════════════════════════════════════════════════════════
  // Data gathering
  // ═══════════════════════════════════════════════════════════

  private async getGenomeData(
    businessId: string,
  ): Promise<{ integrity: number; stage: string }> {
    try {
      const genome = await (this.prisma.client as any).businessGenome.findUnique({
        where: { businessId },
      });

      if (!genome) {
        return { integrity: 0, stage: 'unknown' };
      }

      const dnaScores = (genome.dnaScores as Record<string, number>) ?? {};
      const values = Object.values(dnaScores);
      const integrity = values.length
        ? Math.round(values.reduce((s, v) => s + v, 0) / values.length)
        : 0;

      return {
        integrity,
        stage: (genome.stage as string) ?? 'unknown',
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[getGenomeData] ${businessId}: ${msg}`);
      return { integrity: 0, stage: 'unknown' };
    }
  }

  private async getInvoiceSummary(
    businessId: string,
  ): Promise<{ pending: number; overdue: number; overdueTotal: number }> {
    try {
      const [pending, overdueAgg] = await Promise.all([
        (this.prisma.client as any).invoice.count({
          where: {
            businessId,
            status: { in: [InvoiceStatus.SENT, InvoiceStatus.PENDING] },
          },
        }),
        (this.prisma.client as any).invoice.aggregate({
          where: {
            businessId,
            status: { in: [InvoiceStatus.SENT, InvoiceStatus.PENDING] },
            dueDate: { lt: new Date() },
          },
          _sum: { total: true },
          _count: { id: true },
        }),
      ]);

      return {
        pending,
        overdue: overdueAgg._count?.id ?? 0,
        overdueTotal: overdueAgg._sum?.total ?? 0,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[getInvoiceSummary] ${businessId}: ${msg}`);
      return { pending: 0, overdue: 0, overdueTotal: 0 };
    }
  }

  private async countOverdueTasks(businessId: string): Promise<number> {
    try {
      return (this.prisma.client as any).task.count({
        where: {
          businessId,
          status: { in: ['todo', 'in_progress'] },
          dueDate: { lt: new Date() },
        },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[countOverdueTasks] ${businessId}: ${msg}`);
      return 0;
    }
  }

  private async getLeadSummary(businessId: string): Promise<{ active: number }> {
    try {
      const active = await (this.prisma.client as any).lead.count({
        where: {
          businessId,
          status: { in: ['new', 'contacted', 'qualified'] },
        },
      });
      return { active };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[getLeadSummary] ${businessId}: ${msg}`);
      return { active: 0 };
    }
  }

  private async getDealSummary(
    businessId: string,
  ): Promise<{ active: number; value: number }> {
    try {
      const result = await (this.prisma.client as any).deal.aggregate({
        where: {
          businessId,
          status: { notIn: [DealStatus.WON, DealStatus.LOST] },
        },
        _sum: { value: true },
        _count: { id: true },
      });
      return {
        active: result._count?.id ?? 0,
        value: result._sum?.value ?? 0,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[getDealSummary] ${businessId}: ${msg}`);
      return { active: 0, value: 0 };
    }
  }

  private async getRevenueSummary(
    businessId: string,
  ): Promise<{ current: number; previous: number; trend: 'up' | 'down' | 'flat' }> {
    try {
      const now = new Date();
      const currentStart = startOfMonth(now);
      const previousStart = startOfMonth(subMonths(now, 1));

      const [currentAgg, previousAgg] = await Promise.all([
        (this.prisma.client as any).invoice.aggregate({
          where: {
            businessId,
            status: InvoiceStatus.PAID,
            createdAt: { gte: currentStart, lt: now },
          },
          _sum: { total: true },
        }),
        (this.prisma.client as any).invoice.aggregate({
          where: {
            businessId,
            status: InvoiceStatus.PAID,
            createdAt: { gte: previousStart, lt: currentStart },
          },
          _sum: { total: true },
        }),
      ]);

      const current = currentAgg._sum?.total ?? 0;
      const previous = previousAgg._sum?.total ?? 0;

      let trend: 'up' | 'down' | 'flat' = 'flat';
      if (previous > 0) {
        const change = (current - previous) / previous;
        if (change > 0.1) trend = 'up';
        else if (change < -0.1) trend = 'down';
      }

      return { current, previous, trend };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[getRevenueSummary] ${businessId}: ${msg}`);
      return { current: 0, previous: 0, trend: 'flat' };
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Derivation
  // ═══════════════════════════════════════════════════════════

  private calculateHealth(
    metrics: BusinessMetrics,
  ): { healthScore: number; healthStatus: BusinessMentalModel['healthStatus'] } {
    let score = 100;

    // Cashflow penalties
    score -= Math.min(30, metrics.overdueInvoices * 5);
    if (metrics.monthlyRevenue > 0 && metrics.overdueInvoiceTotal > metrics.monthlyRevenue) {
      score -= 20;
    }

    // Operations penalties
    score -= Math.min(25, metrics.overdueTasks * 3);

    // Pipeline penalty
    if (metrics.activeDeals === 0 && metrics.activeLeads === 0) {
      score -= 15;
    }

    // Revenue trend
    if (metrics.revenueTrend === 'down') {
      score -= 15;
    }

    // Genome integrity
    if (metrics.genomeIntegrity <= 40) {
      score -= 15;
    } else if (metrics.genomeIntegrity <= 60) {
      score -= 5;
    }

    const healthScore = Math.max(0, Math.min(100, Math.round(score)));
    const healthStatus = this.scoreToStatus(healthScore);

    return { healthScore, healthStatus };
  }

  private scoreToStatus(
    score: number,
  ): BusinessMentalModel['healthStatus'] {
    if (score >= 85) return 'excellent';
    if (score >= 70) return 'good';
    if (score >= 50) return 'fair';
    if (score >= 30) return 'poor';
    return 'critical';
  }

  private deriveRisks(
    metrics: BusinessMetrics,
    genome: { integrity: number; stage: string },
  ): BusinessRiskItem[] {
    const risks: BusinessRiskItem[] = [];

    if (metrics.overdueInvoices > 0) {
      const severity = metrics.overdueInvoiceTotal > metrics.monthlyRevenue ? 'critical' : 'high';
      risks.push({
        type: 'cashflow',
        title: 'Overdue invoices',
        severity,
        score: Math.min(100, 50 + metrics.overdueInvoices * 10),
        reason: `${metrics.overdueInvoices} overdue invoices totaling $${metrics.overdueInvoiceTotal.toLocaleString()}`,
      });
    }

    if (metrics.overdueTasks > 3) {
      risks.push({
        type: 'operations',
        title: 'Overdue tasks',
        severity: metrics.overdueTasks > 10 ? 'high' : 'medium',
        score: Math.min(100, 40 + metrics.overdueTasks * 5),
        reason: `${metrics.overdueTasks} tasks are past due`,
      });
    }

    if (metrics.activeDeals === 0 && metrics.activeLeads === 0) {
      risks.push({
        type: 'pipeline',
        title: 'Empty pipeline',
        severity: 'high',
        score: 75,
        reason: 'No active deals or leads in the pipeline',
      });
    }

    if (genome.integrity <= 40) {
      risks.push({
        type: 'genome',
        title: 'Genome integrity low',
        severity: 'medium',
        score: 70,
        reason: `Genome integrity is ${genome.integrity}/100 (${genome.stage})`,
      });
    }

    return risks
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
  }

  private deriveOpportunities(
    metrics: BusinessMetrics,
    invoiceSummary: { overdueTotal: number },
  ): BusinessOpportunityItem[] {
    const opportunities: BusinessOpportunityItem[] = [];

    if (invoiceSummary.overdueTotal > 0) {
      opportunities.push({
        type: 'revenue',
        title: 'Collect overdue invoices',
        estimatedValue: invoiceSummary.overdueTotal,
        confidence: 0.9,
        reason: 'Quick cash recovery from existing customers',
      });
    }

    if (metrics.activeLeads > 0) {
      opportunities.push({
        type: 'lead',
        title: 'Re-engage active leads',
        estimatedValue: metrics.activeLeads * 500,
        confidence: 0.6,
        reason: `${metrics.activeLeads} leads need follow-up`,
      });
    }

    if (metrics.activeDeals > 0) {
      opportunities.push({
        type: 'deal',
        title: 'Close active deals',
        estimatedValue: metrics.activeDealValue,
        confidence: 0.5,
        reason: `${metrics.activeDeals} open deals worth $${metrics.activeDealValue.toLocaleString()}`,
      });
    }

    return opportunities
      .sort((a, b) => b.estimatedValue - a.estimatedValue)
      .slice(0, 5);
  }

  private deriveTrends(metrics: BusinessMetrics): string[] {
    const trends: string[] = [];

    if (metrics.revenueTrend === 'up') {
      trends.push('Revenue trending up vs last month');
    } else if (metrics.revenueTrend === 'down') {
      trends.push('Revenue trending down vs last month');
    } else {
      trends.push('Revenue flat vs last month');
    }

    if (metrics.activeLeads > 5) {
      trends.push('Healthy lead flow');
    } else if (metrics.activeLeads === 0) {
      trends.push('No active leads — marketing attention needed');
    }

    if (metrics.overdueTasks > 5) {
      trends.push('Task backlog growing');
    }

    return trends.slice(0, 5);
  }

  private deriveAttentionItems(metrics: BusinessMetrics): AttentionItem[] {
    const items: AttentionItem[] = [];

    if (metrics.overdueInvoices > 0) {
      items.push({
        type: 'overdue_invoice',
        title: 'Overdue invoices need collection',
        count: metrics.overdueInvoices,
        priority: 'high',
      });
    }

    if (metrics.overdueTasks > 0) {
      items.push({
        type: 'overdue_task',
        title: 'Tasks are past due',
        count: metrics.overdueTasks,
        priority: metrics.overdueTasks > 5 ? 'urgent' : 'medium',
      });
    }

    if (metrics.pendingInvoices > 0) {
      items.push({
        type: 'pending_invoice',
        title: 'Pending invoices awaiting payment',
        count: metrics.pendingInvoices,
        priority: 'medium',
      });
    }

    if (metrics.activeLeads > 0) {
      items.push({
        type: 'active_lead',
        title: 'Leads need follow-up',
        count: metrics.activeLeads,
        priority: 'medium',
      });
    }

    return items.slice(0, 5);
  }

  // ═══════════════════════════════════════════════════════════
  // Active business discovery (shared semantics with proactive engine)
  // ═══════════════════════════════════════════════════════════

  private async getActiveBusinesses(): Promise<string[]> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    try {
      const businesses = await (this.prisma.client as any).business.findMany({
        where: {
          autopilotEnabled: true,
          OR: [
            {
              subscriptions: {
                some: {
                  status: { in: ['ACTIVE', 'TRIALING'] },
                },
              },
            },
            {
              cortexSessions: {
                some: {
                  updatedAt: { gte: sevenDaysAgo },
                },
              },
            },
            {
              aiUsageLogs: {
                some: {
                  createdAt: { gte: sevenDaysAgo },
                },
              },
            },
          ],
        },
        select: { id: true },
        take: ACTIVE_BUSINESS_LIMIT,
        distinct: ['id'],
      });

      return businesses.map((b: { id: string }) => b.id);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[getActiveBusinesses] Failed: ${msg}`);
      return [];
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Cache & persistence
  // ═══════════════════════════════════════════════════════════

  private cacheKey(businessId: string): string {
    return `${CACHE_PREFIX}:${businessId}`;
  }

  private async getCachedModel(
    businessId: string,
  ): Promise<BusinessMentalModel | null> {
    return this.redis.getJson<BusinessMentalModel>(this.cacheKey(businessId));
  }

  private async cacheModel(
    businessId: string,
    model: BusinessMentalModel,
  ): Promise<void> {
    await this.redis.setJson(this.cacheKey(businessId), model, CACHE_TTL_SECONDS);
  }

  private async persistSnapshot(
    businessId: string,
    model: BusinessMentalModel,
  ): Promise<void> {
    try {
      await (this.prisma.client as any).businessHealthSnapshot.create({
        data: {
          businessId,
          area: 'MENTAL_MODEL',
          score: model.healthScore,
          status: model.healthStatus,
          reasons: model.topRisks.map((r) => r.title),
          metrics: {
            healthScore: model.healthScore,
            overdueInvoices: model.metrics.overdueInvoices,
            overdueTasks: model.metrics.overdueTasks,
            activeLeads: model.metrics.activeLeads,
            activeDeals: model.metrics.activeDeals,
            monthlyRevenue: model.metrics.monthlyRevenue,
            revenueTrend: model.metrics.revenueTrend,
            genomeIntegrity: model.metrics.genomeIntegrity,
          },
        },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[persistSnapshot] ${businessId}: ${msg}`);
    }
  }
}
