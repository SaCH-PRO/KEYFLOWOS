import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { ConnectorCommand, ConnectorResult } from '../key-cortex-connector.types';
import { connectorOk, connectorFail } from '../key-cortex-connector.utils';
import { BusinessIntelligenceService } from '../../intelligence/business-intelligence.service';
import { GrowthIntelligenceService } from '../../growth-intelligence/growth-intelligence.service';
import { BusinessCommandCenterService } from '../../business-command-center/business-command-center.service';
import { AnalyticsEngineService } from '../../analytics/analytics-engine.service';

@Injectable()
export class IntelligenceAdapterService {
  constructor(
    private readonly businessIntelligence: BusinessIntelligenceService,
    private readonly growth: GrowthIntelligenceService,
    @Inject(forwardRef(() => BusinessCommandCenterService)) private readonly commandCenter: BusinessCommandCenterService,
    private readonly analytics: AnalyticsEngineService,
  ) {}

  async execute(command: ConnectorCommand): Promise<ConnectorResult> {
    const start = Date.now();
    try {
      switch (command.action) {
        case 'analyze_sentiment': {
          const sentiment = await this.analyzeSentiment({
            businessId: command.businessId,
            text: command.parameters.text as string,
          });
          return connectorOk(command, start, sentiment);
        }
        case 'detect_opportunities': {
          const opportunities = await this.detectOpportunities({
            businessId: command.businessId,
            segment: command.parameters.segment as string | undefined,
            minConfidence: (command.parameters.minConfidence as number) || 0.7,
            limit: (command.parameters.limit as number) || 20,
          });
          return connectorOk(command, start, opportunities);
        }
        case 'generate_forecast': {
          const forecast = await this.generateForecast({
            businessId: command.businessId,
            metric: command.parameters.metric as string,
            horizon: command.parameters.horizon as string,
          });
          return connectorOk(command, start, forecast);
        }
        case 'run_comprehensive_analysis': {
          const analysis = await this.runComprehensiveAnalysis(command.businessId);
          return connectorOk(command, start, analysis);
        }
        default:
          return connectorFail(command, start, `Unknown intelligence action: ${command.action}`);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return connectorFail(command, start, message);
    }
  }

  async getSnapshot(businessId: string) {
    return this.commandCenter.snapshot(businessId);
  }

  private async analyzeSentiment(input: { businessId: string; text?: string }) {
    const text = (input.text ?? '').toLowerCase();
    const positive = ['good', 'great', 'excellent', 'happy', 'love', 'best', 'amazing', 'win', 'winning'];
    const negative = ['bad', 'terrible', 'awful', 'hate', 'worst', 'angry', 'frustrated', 'poor', 'fail'];
    let score = 0;
    positive.forEach((word) => { if (text.includes(word)) score += 1; });
    negative.forEach((word) => { if (text.includes(word)) score -= 1; });
    let sentiment: 'positive' | 'negative' | 'neutral' = 'neutral';
    if (score > 0) sentiment = 'positive';
    if (score < 0) sentiment = 'negative';
    const confidence = Math.min(0.5 + Math.abs(score) * 0.1, 0.95);
    return { businessId: input.businessId, text: input.text, sentiment, confidence, score };
  }

  private async detectOpportunities(input: {
    businessId: string;
    segment?: string;
    minConfidence: number;
    limit: number;
  }) {
    await this.growth.generateInsights(input.businessId);
    const insights = await this.growth.listInsights(input.businessId, { limit: input.limit });
    const opportunities = (insights as Array<Record<string, unknown>>)
      .filter((i) => {
        const confidence = Number(i.confidence ?? 0);
        const type = String(i.type ?? '').toLowerCase();
        if (confidence < input.minConfidence) return false;
        if (input.segment && type !== input.segment.toLowerCase()) return false;
        return true;
      })
      .slice(0, input.limit);
    return { businessId: input.businessId, opportunities, count: opportunities.length };
  }

  private async generateForecast(input: { businessId: string; metric: string; horizon: string }) {
    const horizonDays = this.parseHorizon(input.horizon);
    const days = Math.max(horizonDays, 7) + 14;
    const points = await this.analytics.getTrends(input.businessId, input.metric, days);
    const values = (points as Array<{ value?: number }>).map((p) => Number(p.value ?? 0));
    const forecast = this.linearForecast(values, horizonDays);
    return {
      businessId: input.businessId,
      metric: input.metric,
      horizon: input.horizon,
      horizonDays,
      forecast,
      generatedAt: new Date(),
    };
  }

  private async runComprehensiveAnalysis(businessId: string) {
    const [brief, dashboard, snapshot] = await Promise.all([
      this.businessIntelligence.generateExecutiveBrief(businessId),
      this.growth.getDashboard(businessId),
      this.commandCenter.snapshot(businessId),
    ]);
    return { businessId, executiveBrief: brief, growthDashboard: dashboard, commandCenterSnapshot: snapshot };
  }

  private parseHorizon(horizon: string): number {
    const match = String(horizon).match(/^(\d+)\s*(d|day|days|w|week|weeks|m|month|months)?$/i);
    if (!match) return 30;
    const value = Number(match[1]);
    const unit = (match[2] || 'd').toLowerCase();
    if (unit.startsWith('w')) return value * 7;
    if (unit.startsWith('m')) return value * 30;
    return value;
  }

  private linearForecast(values: number[], steps: number): number[] {
    const n = values.length;
    if (n < 2) return Array(steps).fill(values[0] ?? 0);
    const sumX = (n * (n - 1)) / 2;
    const sumY = values.reduce((a, b) => a + b, 0);
    const sumXY = values.reduce((acc, y, x) => acc + x * y, 0);
    const sumXX = (n * (n - 1) * (2 * n - 1)) / 6;
    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;
    const lastX = n - 1;
    return Array.from({ length: steps }, (_, i) => {
      const x = lastX + i + 1;
      const v = slope * x + intercept;
      return Math.max(0, Number(v.toFixed(2)));
    });
  }
}
