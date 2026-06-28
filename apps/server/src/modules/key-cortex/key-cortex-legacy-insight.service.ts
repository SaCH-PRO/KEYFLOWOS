import { Injectable, Logger, Optional, Inject } from '@nestjs/common';
import { ModelGatewayService } from '../ai/model-gateway.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { KeyCortexContextService } from './key-cortex-context.service';
import { KeyCortexInsightService } from './key-cortex-insight.service';
import {
  CortexInsight,
  CortexProfitOpportunity,
} from './key-cortex.types';

/**
 * KeyCortexLegacyInsightService
 *
 * Legacy fallback implementations for insight generation and profit opportunity
 * discovery. Delegates to KeyCortexInsightService when available.
 */
@Injectable()
export class KeyCortexLegacyInsightService {
  private readonly logger = new Logger(KeyCortexLegacyInsightService.name);

  constructor(
    @Inject(ModelGatewayService)
    private readonly modelGateway: ModelGatewayService,
    private readonly prisma: PrismaService,
    private readonly contextService: KeyCortexContextService,
    @Optional()
    @Inject(KeyCortexInsightService)
    private readonly insightService?: KeyCortexInsightService,
  ) {}

  /**
   * Generate AI-powered business insights.
   */
  async generateInsights(
    businessId: string,
    query: string,
  ): Promise<CortexInsight[]> {
    this.logger.log(`[generateInsights] business=${businessId}`);

    if (this.insightService) {
      try {
        this.logger.log('[generateInsights] Delegating to v2 InsightService');
        const recommendations =
          await (this.insightService as any).generateRecommendations(businessId);
        return recommendations.map((rec: any) => ({
          type: (rec.type ?? 'suggestion') as CortexInsight['type'],
          title: rec.title,
          description: rec.description,
          confidence: rec.confidence ?? 0.7,
          estimatedValue: rec.estimatedValue,
          recommendedAction: rec.recommendedAction,
          dataSource: rec.dataSource ?? 'insight_service',
        }));
      } catch (err: any) {
        this.logger.warn(
          `[generateInsights] v2 delegation failed, using legacy: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    try {
      const contextSnapshot =
        await this.contextService.buildContextSnapshot(businessId);

      const insightsPrompt = `You are KEY Cortex, an elite AI business intelligence engine.
Analyze the following business context and user query. Generate 3-5 actionable insights.

=== BUSINESS CONTEXT ===
Genome Stage: ${contextSnapshot.genomeStage}
Executive Readiness: ${contextSnapshot.executiveReadiness}%
DNA Scores: ${JSON.stringify(contextSnapshot.genomeDna)}
Active Projects: ${contextSnapshot.activeProjects.join(', ')}
Pending Invoices: ${contextSnapshot.pendingInvoices}
Unread Messages: ${contextSnapshot.unreadMessages}
Recent Tasks: ${contextSnapshot.recentTasks.slice(0, 5).join(', ')}
Key Metrics: ${JSON.stringify(contextSnapshot.keyMetrics)}
========================

User Query: "${query}"

Generate insights in this JSON format:
[
  {
    "type": "opportunity|risk|trend|anomaly|suggestion",
    "title": "Short title",
    "description": "Detailed description with specifics",
    "confidence": 0.85,
    "estimatedValue": "Optional $ value or time savings",
    "recommendedAction": "What to do next",
    "dataSource": "Which data source this came from"
  }
]`;

      const result = await (this.modelGateway as any).complete({
        messages: [{ role: 'user', content: insightsPrompt }],
        model: 'gpt-4o-mini',
        temperature: 0.7,
        maxTokens: 2000,
      });

      const jsonMatch = result.content.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        this.logger.warn('[generateInsights] No JSON array found in response');
        return [];
      }

      const insights: CortexInsight[] = JSON.parse(jsonMatch[0]);

      return insights
        .filter(
          (i: any) =>
            i.type && i.title && i.description && typeof i.confidence === 'number',
        )
        .map((i: any) => ({
          ...i,
          confidence: Math.min(Math.max(i.confidence, 0), 1),
        }));
    } catch (error: any) {
      this.logger.error(
        `[generateInsights] Failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  /**
   * Find profit opportunities across business data.
   */
  async findProfitOpportunities(
    businessId: string,
  ): Promise<CortexProfitOpportunity[]> {
    this.logger.log(`[findProfitOpportunities] business=${businessId}`);

    if (this.insightService) {
      try {
        this.logger.log(
          '[findProfitOpportunities] Delegating to v2 InsightService',
        );
        return await (this.insightService as any).findProfitOpportunities(
          businessId,
        );
      } catch (err: any) {
        this.logger.warn(
          `[findProfitOpportunities] v2 delegation failed, using legacy: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    try {
      const [invoices, leads, tasks, projects, contextSnapshot] =
        await Promise.all([
          (this.prisma.client as any).invoice.findMany({
            where: { businessId },
            orderBy: { createdAt: 'desc' },
            take: 50,
            select: {
              id: true,
              total: true,
              status: true,
              clientName: true,
              createdAt: true,
              dueDate: true,
            },
          }),
          (this.prisma.client as any).lead.findMany({
            where: { businessId },
            orderBy: { createdAt: 'desc' },
            take: 50,
            select: {
              id: true,
              status: true,
              estimatedValue: true,
              source: true,
              createdAt: true,
            },
          }),
          (this.prisma.client as any).task.findMany({
            where: { businessId },
            orderBy: { createdAt: 'desc' },
            take: 50,
            select: {
              id: true,
              status: true,
              priority: true,
              title: true,
              dueDate: true,
              completedAt: true,
            },
          }),
          (this.prisma.client as any).project.findMany({
            where: { businessId },
            orderBy: { updatedAt: 'desc' },
            take: 30,
            select: {
              id: true,
              status: true,
              budget: true,
              spent: true,
              name: true,
            },
          }),
          this.contextService.buildContextSnapshot(businessId),
        ]);

      const totalInvoiceValue = invoices
        .filter((i: any) => i.status === 'sent' || i.status === 'paid')
        .reduce((sum: any, i: any) => sum + (i.total || 0), 0);

      const overdueInvoices = invoices.filter(
        (i: any) =>
          i.status === 'sent' && i.dueDate && new Date(i.dueDate) < new Date(),
      );

      const overdueValue = overdueInvoices.reduce(
        (sum: any, i: any) => sum + (i.total || 0),
        0,
      );

      const unconvertedLeads = leads.filter(
        (l: any) => l.status === 'new' || l.status === 'contacted',
      );
      const totalLeadValue = unconvertedLeads.reduce(
        (sum: any, l: any) => sum + (l.estimatedValue || 0),
        0,
      );

      const stuckTasks = tasks.filter(
        (t: any) =>
          t.status !== 'completed' &&
          t.dueDate &&
          new Date(t.dueDate) < new Date(),
      );

      const projectsOverBudget = projects.filter(
        (p: any) => p.budget && p.spent && p.spent > p.budget,
      );

      const profitPrompt = `You are KEY Cortex -- the world's most aggressive profit-focused AI business engine.
Analyze the following business data and identify EVERY revenue opportunity, cost saving, and automation potential.
Think like a ruthless CFO meets growth hacker. Nothing is off-limits.

=== BUSINESS DATA ===
Genome Stage: ${contextSnapshot.genomeStage}
Executive Readiness: ${contextSnapshot.executiveReadiness}%
DNA Scores: ${JSON.stringify(contextSnapshot.genomeDna)}

INVOICES:
- Total outstanding value: $${totalInvoiceValue.toFixed(2)}
- Overdue invoices: ${overdueInvoices.length} (value: $${overdueValue.toFixed(2)})
- Total invoices analyzed: ${invoices.length}

LEADS:
- Unconverted leads: ${unconvertedLeads.length}
- Total estimated value of unconverted leads: $${totalLeadValue.toFixed(2)}
- Lead sources: ${[...new Set(leads.map((l: any) => l.source).filter(Boolean))].join(', ')}

TASKS:
- Stuck/overdue tasks: ${stuckTasks.length}
- Total active tasks: ${tasks.filter((t: any) => t.status !== 'completed').length}

PROJECTS:
- Projects over budget: ${projectsOverBudget.length}
- Active projects: ${projects.filter((p: any) => p.status === 'active').length}
- Budget at risk: $${projectsOverBudget.reduce((s: any, p: any) => s + ((p.spent || 0) - (p.budget || 0)), 0).toFixed(2)}

KEY METRICS:
${JSON.stringify(contextSnapshot.keyMetrics, null, 2)}
========================

Generate profit opportunities in this JSON format. Be SPECIFIC with dollar amounts and percentages.
Rank by estimated revenue impact (highest first).

[
  {
    "id": "po_1",
    "title": "Specific, actionable title",
    "description": "Detailed explanation with specific numbers from the data",
    "estimatedRevenue": 15000,
    "estimatedEffort": "low|medium|high",
    "confidence": 0.9,
    "category": "automation|upsell|cost_reduction|new_revenue|retention",
    "actionSteps": ["Step 1", "Step 2", "Step 3"],
    "dataSources": ["invoices", "leads", "tasks", "projects", "genome"]
  }
]`;

      const result = await (this.modelGateway as any).complete({
        messages: [{ role: 'user', content: profitPrompt }],
        model: 'gpt-4o',
        temperature: 0.8,
        maxTokens: 4000,
      });

      const jsonMatch = result.content.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        this.logger.warn(
          '[findProfitOpportunities] No JSON array found in response',
        );
        return this.buildFallbackProfitOpportunities({
          overdueValue,
          unconvertedLeadCount: unconvertedLeads.length,
          totalLeadValue,
          stuckTaskCount: stuckTasks.length,
          projectsOverBudgetCount: projectsOverBudget.length,
        });
      }

      const opportunities: CortexProfitOpportunity[] = JSON.parse(jsonMatch[0]);

      const validated = opportunities
        .filter(
          (o: any) =>
            o.id &&
            o.title &&
            o.description &&
            typeof o.estimatedRevenue === 'number' &&
            o.confidence &&
            o.category,
        )
        .map((o: any) => ({
          ...o,
          estimatedRevenue: Math.max(0, o.estimatedRevenue),
          confidence: Math.min(Math.max(o.confidence, 0), 1),
          estimatedEffort: (o.estimatedEffort ?? 'medium') as
            | 'low'
            | 'medium'
            | 'high',
          actionSteps: o.actionSteps ?? [],
          dataSources: o.dataSources ?? [],
        }));

      validated.sort(
        (a: any, b: any) =>
          b.estimatedRevenue * b.confidence -
          a.estimatedRevenue * a.confidence,
      );

      this.logger.log(
        `[findProfitOpportunities] Found ${validated.length} opportunities for business=${businessId}`,
      );

      return validated;
    } catch (error: any) {
      this.logger.error(
        `[findProfitOpportunities] Failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return this.buildFallbackProfitOpportunities({});
    }
  }

  buildFallbackProfitOpportunities(metrics: {
    overdueValue?: number;
    unconvertedLeadCount?: number;
    totalLeadValue?: number;
    stuckTaskCount?: number;
    projectsOverBudgetCount?: number;
  }): CortexProfitOpportunity[] {
    const ops: CortexProfitOpportunity[] = [];

    if ((metrics.overdueValue ?? 0) > 0) {
      ops.push({
        id: 'po_fallback_1',
        title: 'Collect overdue invoices',
        description: `You have $${(metrics.overdueValue ?? 0).toFixed(2)} in overdue invoices. Follow up immediately to recover this revenue.`,
        estimatedRevenue: metrics.overdueValue ?? 0,
        estimatedEffort: 'low',
        confidence: 0.95,
        category: 'retention',
        actionSteps: [
          'Send reminder emails for all overdue invoices',
          'Call high-value clients personally',
          'Offer early payment discounts',
        ],
        dataSources: ['invoices'],
      });
    }

    if ((metrics.unconvertedLeadCount ?? 0) > 0) {
      ops.push({
        id: 'po_fallback_2',
        title: 'Convert dormant leads',
        description: `You have ${metrics.unconvertedLeadCount} unconverted leads worth $${(metrics.totalLeadValue ?? 0).toFixed(2)}. Re-engage them with targeted outreach.`,
        estimatedRevenue: (metrics.totalLeadValue ?? 0) * 0.2,
        estimatedEffort: 'medium',
        confidence: 0.75,
        category: 'new_revenue',
        actionSteps: [
          'Segment leads by source and value',
          'Send personalized re-engagement emails',
          'Schedule follow-up calls for high-value leads',
        ],
        dataSources: ['leads'],
      });
    }

    if ((metrics.stuckTaskCount ?? 0) > 0) {
      ops.push({
        id: 'po_fallback_3',
        title: 'Unblock stuck tasks',
        description: `${metrics.stuckTaskCount} tasks are past their due date. Clearing these bottlenecks will improve team velocity and client satisfaction.`,
        estimatedRevenue: 5000,
        estimatedEffort: 'medium',
        confidence: 0.7,
        category: 'automation',
        actionSteps: [
          'Review all overdue tasks with the team',
          'Identify blockers and reassign if needed',
          'Automate recurring task types',
        ],
        dataSources: ['tasks'],
      });
    }

    if ((metrics.projectsOverBudgetCount ?? 0) > 0) {
      ops.push({
        id: 'po_fallback_4',
        title: 'Control project budget overruns',
        description: `${metrics.projectsOverBudgetCount} projects are over budget. Immediate cost control measures can prevent further losses.`,
        estimatedRevenue: 10000,
        estimatedEffort: 'high',
        confidence: 0.8,
        category: 'cost_reduction',
        actionSteps: [
          'Audit all active project budgets',
          'Implement weekly spend tracking',
          'Renegotiate vendor contracts',
        ],
        dataSources: ['projects'],
      });
    }

    return ops.sort(
      (a: any, b: any) =>
        b.estimatedRevenue * b.confidence -
        a.estimatedRevenue * a.confidence,
    );
  }
}
