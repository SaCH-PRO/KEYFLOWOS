/**
 * ============================================================================
 * KEY CORTEX — LAYER 8: TEMPORAL INTELLIGENCE ENGINE
 * ============================================================================
 * KEY truly understands time — cycles, seasons, trends, and forecasting.
 *
 * Temporal Capabilities:
 *   - "This time last year" comparisons with percentage changes
 *   - Seasonal pattern detection ("Revenue always drops in December")
 *   - Day-of-week effects ("Mondays have 40% fewer bookings")
 *   - Trend extrapolation with widening confidence intervals
 *   - Anomaly detection vs. historical baseline
 *   - Cycle decomposition (weekly + monthly + yearly components)
 *   - Natural language temporal summaries for AI prompts
 *
 * This service queries historical business data, computes temporal patterns,
 * generates forecasts, and produces natural-language temporal context that
 * feeds into KEY's overall reasoning process.
 * ============================================================================
 */

import {
  Injectable,
  Logger,
  Inject,
} from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { KeyCortexContextV2Service } from './key-cortex-context-v2.service';
import {
  subDays,
  subWeeks,
  subMonths,
  subQuarters,
  subYears,
  startOfDay,
  startOfWeek,
  startOfMonth,
  startOfQuarter,
  startOfYear,
  endOfDay,
  endOfWeek,
  endOfMonth,
  endOfQuarter,
  format,
  differenceInDays,
  isSameDay,
} from 'date-fns';

/* ─────────────────────────── Type Definitions ─────────────────────────── */

export interface TemporalTimeframe {
  period: string; // "this week", "last month", "Q2 2024"
  metrics: Record<string, number>;
  comparison: 'better' | 'worse' | 'same';
  delta: number; // percentage change
}

export interface Cycle {
  name: string; // "weekly revenue cycle"
  type: 'weekly' | 'monthly' | 'yearly';
  period: string; // "7 days"
  peakDay: string; // "Thursday"
  troughDay: string; // "Sunday"
  strength: number; // 0-1 how strong is this cycle
  peakValue: number;
  troughValue: number;
  dataPoints: Array<{ label: string; value: number }>;
}

export interface Forecast {
  period: string; // "2024-01-15"
  predictedValue: number;
  confidenceInterval: [number, number]; // [low, high]
  confidence: number; // 0-1
}

export interface Anomaly {
  date: Date;
  metric: string;
  expected: number;
  actual: number;
  severity: 'low' | 'medium' | 'high';
  explanation?: string;
}

export interface TemporalAnalysis {
  metric: string;
  businessId: string;
  generatedAt: Date;
  timeframes: TemporalTimeframe[];
  cycles: Cycle[];
  forecast: Forecast[];
  anomalies: Anomaly[];
  summary: string;
}

export interface PeriodComparison {
  period1: number;
  period2: number;
  delta: number;
  deltaPercent: number;
  significant: boolean;
}

/** Supported metrics that can be temporally analyzed */
export type TemporalMetric =
  | 'revenue'
  | 'leads'
  | 'conversions'
  | 'bookings'
  | 'invoices'
  | 'payments'
  | 'messages'
  | 'tasks_completed'
  | 'expenses';

/* ─────────────────────────── Service ─────────────────────────── */

@Injectable()
export class KeyCortexTemporalReasoningService {
  private readonly logger = new Logger(KeyCortexTemporalReasoningService.name);

  /** Minimum data points required for meaningful temporal analysis */
  private readonly MIN_DATA_POINTS = 7;

  /** Z-score threshold for anomaly detection */
  private readonly ANOMALY_Z_THRESHOLD = 2.0;

  /** Z-score threshold for statistical significance in period comparison */
  private readonly SIGNIFICANCE_Z_THRESHOLD = 1.96; // 95% confidence

  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(KeyCortexContextV2Service)
    private readonly contextV2: KeyCortexContextV2Service,
  ) {}

  /* ─────────────────────────── Core Analysis ─────────────────────────── */

  /**
   * Comprehensive temporal analysis of a business metric.
   *
   * Combines historical comparison, cycle detection, forecasting,
   * and anomaly detection into a single unified analysis.
   *
   * @param businessId The business to analyze
   * @param metric     The metric to analyze (revenue, leads, bookings, etc.)
   * @param period     The primary analysis period
   */
  async analyzeTimeSeries(
    businessId: string,
    metric: string,
    period: 'week' | 'month' | 'quarter' | 'year',
  ): Promise<TemporalAnalysis> {
    const startTime = Date.now();
    this.logger.log(
      `[analyzeTimeSeries] Analyzing ${metric} for ${businessId} over ${period}`,
    );

    try {
      // 1. Build timeframe comparisons (current, previous, year-ago)
      const timeframes = await this.buildTimeframes(businessId, metric, period);

      // 2. Detect cycles (weekly, monthly, yearly patterns)
      const cycles = await this.detectCycles(businessId, metric);

      // 3. Generate forecast
      const forecastHorizon =
        period === 'week' ? 7 : period === 'month' ? 30 : period === 'quarter' ? 90 : 365;
      const forecastUnit: 'days' | 'weeks' | 'months' =
        period === 'week' ? 'days' : period === 'month' ? 'days' : 'days';
      const forecast = await this.forecast(
        businessId,
        metric,
        forecastHorizon,
        forecastUnit,
      );

      // 4. Detect anomalies
      const lookbackDays =
        period === 'week' ? 30 : period === 'month' ? 90 : period === 'quarter' ? 180 : 365;
      const anomalies = await this.detectAnomalies(businessId, metric, lookbackDays);

      // 5. Build natural language summary
      const summary = this.buildAnalysisSummary(
        metric,
        timeframes,
        cycles,
        forecast,
        anomalies,
      );

      const elapsed = Date.now() - startTime;
      this.logger.log(
        `[analyzeTimeSeries] Completed ${metric} analysis in ${elapsed}ms. ` +
          `${timeframes.length} timeframes, ${cycles.length} cycles, ` +
          `${forecast.length} forecast points, ${anomalies.length} anomalies`,
      );

      return {
        metric,
        businessId,
        generatedAt: new Date(),
        timeframes,
        cycles,
        forecast,
        anomalies,
        summary,
      };
    } catch (error) {
      this.logger.error(
        `[analyzeTimeSeries] Failed for ${metric}: ${error instanceof Error ? error.message : String(error)}`,
      );
      // Return a graceful fallback
      return {
        metric,
        businessId,
        generatedAt: new Date(),
        timeframes: [],
        cycles: [],
        forecast: [],
        anomalies: [],
        summary: `Temporal analysis for ${metric} could not be completed due to insufficient data.`,
      };
    }
  }

  /**
   * Detect repeating cycles in historical data.
   *
   * Analyzes for:
   *   - Weekly cycles (day-of-week effects)
   *   - Monthly cycles (day-of-month or week-of-month patterns)
   *   - Yearly cycles (seasonal patterns)
   *
   * Returns each cycle with strength score (0-1), peak and trough identification.
   */
  async detectCycles(
    businessId: string,
    metric: string,
  ): Promise<Cycle[]> {
    const cycles: Cycle[] = [];

    try {
      // ── Weekly Cycle Detection ──
      const weeklyCycle = await this.detectWeeklyCycle(businessId, metric);
      if (weeklyCycle) cycles.push(weeklyCycle);

      // ── Monthly Cycle Detection ──
      const monthlyCycle = await this.detectMonthlyCycle(businessId, metric);
      if (monthlyCycle) cycles.push(monthlyCycle);

      // ── Yearly Cycle Detection ──
      const yearlyCycle = await this.detectYearlyCycle(businessId, metric);
      if (yearlyCycle) cycles.push(yearlyCycle);
    } catch (error) {
      this.logger.warn(
        `[detectCycles] Error for ${metric}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return cycles;
  }

  /**
   * Generate forecasts for a business metric.
   *
   * Uses historical data + detected cycles to produce point forecasts
   * with confidence intervals that widen as the horizon increases.
   *
   * @param businessId The business
   * @param metric     The metric to forecast
   * @param horizon    Number of periods to forecast
   * @param unit       Time unit for each forecast period
   */
  async forecast(
    businessId: string,
    metric: string,
    horizon: number,
    unit: 'days' | 'weeks' | 'months',
  ): Promise<Forecast[]> {
    try {
      // Get historical daily data
      const historyDays = unit === 'days' ? 90 : unit === 'weeks' ? 180 : 365;
      const dailyData = await this.getDailyMetricValues(
        businessId,
        metric,
        historyDays,
      );

      if (dailyData.length < this.MIN_DATA_POINTS) {
        this.logger.warn(
          `[forecast] Insufficient data for ${metric}: ${dailyData.length} points`,
        );
        return [];
      }

      // Aggregate based on unit
      const aggregatedData = this.aggregateByUnit(dailyData, unit);

      // Apply simple exponential smoothing + trend
      const { level, trend } = this.computeHoltLinearTrend(aggregatedData);

      // Detect weekly cycle component
      const cycles = await this.detectCycles(businessId, metric);
      const weeklyCycle = cycles.find((c) => c.type === 'weekly');

      // Generate forecasts
      const forecasts: Forecast[] = [];
      const alpha = 0.3; // Smoothing parameter for level
      const beta = 0.1; // Smoothing parameter for trend

      const currentLevel = level;
      const currentTrend = trend;
      const historicalStd = this.computeStdDev(aggregatedData.map((d) => d.value));

      for (let i = 1; i <= horizon; i++) {
        // Base forecast: level + (i * trend)
        let predicted = currentLevel + i * currentTrend;

        // Apply cycle adjustment if available
        if (weeklyCycle && unit === 'days') {
          const dayOfWeek = (new Date().getDay() + i) % 7;
          const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
          const dayLabel = dayNames[dayOfWeek];
          const dayData = weeklyCycle.dataPoints.find((d) => d.label === dayLabel);
          if (dayData) {
            const avgValue =
              weeklyCycle.dataPoints.reduce((s, d) => s + d.value, 0) /
              weeklyCycle.dataPoints.length;
            const adjustment = dayData.value / Math.max(avgValue, 1);
            predicted *= adjustment;
          }
        }

        predicted = Math.max(0, predicted); // Business metrics are non-negative

        // Confidence interval widens with horizon
        const confidenceDecay = Math.sqrt(i);
        const ciWidth = this.ANOMALY_Z_THRESHOLD * historicalStd * confidenceDecay;
        const confidence = Math.max(0.1, 1 - (i - 1) / (horizon * 1.5));

        // Determine period label
        const forecastDate = new Date();
        if (unit === 'days') forecastDate.setDate(forecastDate.getDate() + i);
        else if (unit === 'weeks') forecastDate.setDate(forecastDate.getDate() + i * 7);
        else forecastDate.setMonth(forecastDate.getMonth() + i);

        forecasts.push({
          period: format(forecastDate, 'yyyy-MM-dd'),
          predictedValue: Math.round(predicted * 100) / 100,
          confidenceInterval: [
            Math.round(Math.max(0, predicted - ciWidth) * 100) / 100,
            Math.round((predicted + ciWidth) * 100) / 100,
          ],
          confidence: Math.round(confidence * 100) / 100,
        });
      }

      return forecasts;
    } catch (error) {
      this.logger.error(
        `[forecast] Failed for ${metric}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  /**
   * Detect anomalies in recent metric data.
   *
   * Uses z-score method: flag data points >2 standard deviations
   * from the historical mean. Returns sorted by severity.
   *
   * @param businessId  The business
   * @param metric      The metric to check
   * @param lookbackDays How far back to establish the baseline
   */
  async detectAnomalies(
    businessId: string,
    metric: string,
    lookbackDays: number,
  ): Promise<Anomaly[]> {
    try {
      const dailyData = await this.getDailyMetricValues(
        businessId,
        metric,
        lookbackDays,
      );

      if (dailyData.length < this.MIN_DATA_POINTS) {
        return [];
      }

      const values = dailyData.map((d) => d.value);
      const mean = this.computeMean(values);
      const stdDev = this.computeStdDev(values);

      if (stdDev === 0) return []; // No variation = no anomalies

      const anomalies: Anomaly[] = [];

      // Check the most recent data points (last 20% of lookback)
      const recentCutoff = Math.floor(dailyData.length * 0.8);
      for (let i = recentCutoff; i < dailyData.length; i++) {
        const point = dailyData[i];
        const zScore = Math.abs((point.value - mean) / stdDev);

        if (zScore > this.ANOMALY_Z_THRESHOLD) {
          const severity: Anomaly['severity'] =
            zScore > 3.5 ? 'high' : zScore > 2.5 ? 'medium' : 'low';

          anomalies.push({
            date: point.date,
            metric,
            expected: Math.round(mean * 100) / 100,
            actual: Math.round(point.value * 100) / 100,
            severity,
            explanation: `${metric} was ${point.value > mean ? 'above' : 'below'} expected range (${Math.round(zScore * 10) / 10} standard deviations from mean of ${Math.round(mean)})`,
          });
        }
      }

      // Sort by severity (high -> low) then by recency
      return anomalies.sort((a, b) => {
        const severityOrder = { high: 3, medium: 2, low: 1 };
        if (severityOrder[a.severity] !== severityOrder[b.severity]) {
          return severityOrder[b.severity] - severityOrder[a.severity];
        }
        return b.date.getTime() - a.date.getTime();
      });
    } catch (error) {
      this.logger.warn(
        `[detectAnomalies] Error for ${metric}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  /**
   * Generate natural language temporal context for AI prompts.
   *
   * Produces human-readable temporal intelligence like:
   *   "This time last month, revenue was $X. Now it's $Y (+Z%)."
   *   "Your busiest day is typically Thursday."
   *   "Revenue tends to drop 20% in December based on 3 years of data."
   *
   * @param businessId The business
   */
  async getTemporalContext(businessId: string): Promise<string> {
    try {
      const sections: string[] = [];
      sections.push('=== TEMPORAL INTELLIGENCE ===');
      sections.push('');

      // ── Revenue temporal summary ──
      const revenueContext = await this.buildMetricTemporalContext(
        businessId,
        'revenue',
        'Revenue',
      );
      if (revenueContext) sections.push(revenueContext);

      // ── Leads temporal summary ──
      const leadsContext = await this.buildMetricTemporalContext(
        businessId,
        'leads',
        'Leads',
      );
      if (leadsContext) sections.push(leadsContext);

      // ── Bookings temporal summary ──
      const bookingsContext = await this.buildMetricTemporalContext(
        businessId,
        'bookings',
        'Bookings',
      );
      if (bookingsContext) sections.push(bookingsContext);

      // ── Cycle patterns ──
      const cycles = await this.detectCycles(businessId, 'revenue');
      for (const cycle of cycles) {
        if (cycle.strength > 0.3) {
          sections.push(
            `- **${cycle.name}**: Strongest on ${cycle.peakDay} (peak: ${Math.round(cycle.peakValue)}), weakest on ${cycle.troughDay} (trough: ${Math.round(cycle.troughValue)}). Cycle strength: ${Math.round(cycle.strength * 100)}%.`,
          );
        }
      }

      // ── Upcoming forecast snapshot ──
      const forecast = await this.forecast(businessId, 'revenue', 7, 'days');
      if (forecast.length > 0) {
        sections.push('');
        sections.push('--- Upcoming 7-Day Revenue Forecast ---');
        const totalForecast = forecast.reduce((s, f) => s + f.predictedValue, 0);
        const avgConfidence =
          forecast.reduce((s, f) => s + f.confidence, 0) / forecast.length;
        sections.push(
          `Predicted total: $${Math.round(totalForecast).toLocaleString()} (avg confidence: ${Math.round(avgConfidence * 100)}%)`,
        );
        forecast.slice(0, 3).forEach((f) => {
          sections.push(
            `  ${f.period}: $${Math.round(f.predictedValue).toLocaleString()} [${Math.round(f.confidenceInterval[0]).toLocaleString()} - ${Math.round(f.confidenceInterval[1]).toLocaleString()}]`,
          );
        });
      }

      // ── Anomalies alert ──
      const recentAnomalies = await this.detectAnomalies(businessId, 'revenue', 30);
      if (recentAnomalies.length > 0) {
        sections.push('');
        sections.push('--- Recent Anomalies ---');
        recentAnomalies.slice(0, 3).forEach((a) => {
          const emoji = a.severity === 'high' ? '🔴' : a.severity === 'medium' ? '🟡' : '🟢';
          sections.push(
            `${emoji} ${format(a.date, 'MMM d')}: ${a.metric} was ${a.actual} vs expected ~${a.expected} (${a.severity})`,
          );
        });
      }

      sections.push('');
      sections.push('=== END TEMPORAL INTELLIGENCE ===');

      return sections.join('\n');
    } catch (error) {
      this.logger.warn(
        `[getTemporalContext] Error: ${error instanceof Error ? error.message : String(error)}`,
      );
      return 'Temporal context temporarily unavailable.';
    }
  }

  /**
   * Compare two time periods for a given metric.
   *
   * Calculates delta, percentage change, and statistical significance.
   *
   * @param businessId The business
   * @param metric     The metric to compare
   * @param period1    First period (start and end dates)
   * @param period2    Second period (start and end dates)
   */
  async comparePeriods(
    businessId: string,
    metric: string,
    period1: { start: Date; end: Date },
    period2: { start: Date; end: Date },
  ): Promise<PeriodComparison> {
    try {
      const val1 = await this.aggregateMetricInRange(
        businessId,
        metric,
        period1.start,
        period1.end,
      );
      const val2 = await this.aggregateMetricInRange(
        businessId,
        metric,
        period2.start,
        period2.end,
      );

      const delta = val2 - val1;
      const deltaPercent = val1 !== 0 ? (delta / val1) * 100 : 0;

      // Statistical significance: use daily variance within periods
      const daily1 = await this.getDailyMetricValuesInRange(
        businessId,
        metric,
        period1.start,
        period1.end,
      );
      const daily2 = await this.getDailyMetricValuesInRange(
        businessId,
        metric,
        period2.start,
        period2.end,
      );

      const significant = this.isSignificantDifference(daily1, daily2);

      return {
        period1: Math.round(val1 * 100) / 100,
        period2: Math.round(val2 * 100) / 100,
        delta: Math.round(delta * 100) / 100,
        deltaPercent: Math.round(deltaPercent * 100) / 100,
        significant,
      };
    } catch (error) {
      this.logger.error(
        `[comparePeriods] Failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { period1: 0, period2: 0, delta: 0, deltaPercent: 0, significant: false };
    }
  }

  /* ─────────────────────────── Cycle Detection Implementations ─────────────────────────── */

  /**
   * Detect weekly (day-of-week) cycles in metric data.
   */
  private async detectWeeklyCycle(
    businessId: string,
    metric: string,
  ): Promise<Cycle | null> {
    const dailyData = await this.getDailyMetricValues(businessId, metric, 84); // 12 weeks
    if (dailyData.length < 28) return null; // Need at least 4 weeks

    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayTotals: number[] = new Array(7).fill(0);
    const dayCounts: number[] = new Array(7).fill(0);

    for (const point of dailyData) {
      const day = point.date.getDay();
      dayTotals[day] += point.value;
      dayCounts[day]++;
    }

    const dayAverages = dayTotals.map((total, i) =>
      dayCounts[i] > 0 ? total / dayCounts[i] : 0,
    );

    const overallAvg =
      dayAverages.reduce((s, v) => s + v, 0) / dayAverages.filter((v) => v > 0).length || 1;

    // Find peak and trough
    let peakIdx = 0;
    let troughIdx = 0;
    for (let i = 1; i < 7; i++) {
      if (dayAverages[i] > dayAverages[peakIdx]) peakIdx = i;
      if (dayAverages[i] < dayAverages[troughIdx]) troughIdx = i;
    }

    // Calculate cycle strength (coefficient of variation)
    const stdDev = this.computeStdDev(dayAverages);
    const strength = Math.min(1, stdDev / Math.max(overallAvg * 0.5, 1));

    if (strength < 0.1) return null; // Too weak to be meaningful

    const dataPoints = dayNames.map((name, i) => ({
      label: name,
      value: Math.round(dayAverages[i] * 100) / 100,
    }));

    return {
      name: 'weekly cycle',
      type: 'weekly',
      period: '7 days',
      peakDay: dayNames[peakIdx],
      troughDay: dayNames[troughIdx],
      strength: Math.round(strength * 100) / 100,
      peakValue: Math.round(dayAverages[peakIdx] * 100) / 100,
      troughValue: Math.round(dayAverages[troughIdx] * 100) / 100,
      dataPoints,
    };
  }

  /**
   * Detect monthly cycles in metric data.
   */
  private async detectMonthlyCycle(
    businessId: string,
    metric: string,
  ): Promise<Cycle | null> {
    const dailyData = await this.getDailyMetricValues(businessId, metric, 180); // ~6 months
    if (dailyData.length < 60) return null;

    // Group by week of month (weeks 1-4)
    const weekTotals: number[] = [0, 0, 0, 0];
    const weekCounts: number[] = [0, 0, 0, 0];

    for (const point of dailyData) {
      const dayOfMonth = point.date.getDate();
      const weekOfMonth = Math.min(3, Math.floor((dayOfMonth - 1) / 7));
      weekTotals[weekOfMonth] += point.value;
      weekCounts[weekOfMonth]++;
    }

    const weekAverages = weekTotals.map((total, i) =>
      weekCounts[i] > 0 ? total / weekCounts[i] : 0,
    );

    const overallAvg =
      weekAverages.reduce((s, v) => s + v, 0) / weekAverages.filter((v) => v > 0).length || 1;

    let peakIdx = 0;
    let troughIdx = 0;
    for (let i = 1; i < 4; i++) {
      if (weekAverages[i] > weekAverages[peakIdx]) peakIdx = i;
      if (weekAverages[i] < weekAverages[troughIdx]) troughIdx = i;
    }

    const stdDev = this.computeStdDev(weekAverages);
    const strength = Math.min(1, stdDev / Math.max(overallAvg * 0.5, 1));

    if (strength < 0.1) return null;

    const weekLabels = ['Week 1', 'Week 2', 'Week 3', 'Week 4+'];

    return {
      name: 'monthly cycle',
      type: 'monthly',
      period: '4 weeks',
      peakDay: weekLabels[peakIdx],
      troughDay: weekLabels[troughIdx],
      strength: Math.round(strength * 100) / 100,
      peakValue: Math.round(weekAverages[peakIdx] * 100) / 100,
      troughValue: Math.round(weekAverages[troughIdx] * 100) / 100,
      dataPoints: weekLabels.map((name, i) => ({
        label: name,
        value: Math.round(weekAverages[i] * 100) / 100,
      })),
    };
  }

  /**
   * Detect yearly (seasonal) cycles in metric data.
   */
  private async detectYearlyCycle(
    businessId: string,
    metric: string,
  ): Promise<Cycle | null> {
    // Need at least 9 months of data to detect yearly patterns
    const dailyData = await this.getDailyMetricValues(businessId, metric, 275);
    if (dailyData.length < 180) return null;

    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ];
    const monthTotals: number[] = new Array(12).fill(0);
    const monthCounts: number[] = new Array(12).fill(0);

    for (const point of dailyData) {
      const month = point.date.getMonth();
      monthTotals[month] += point.value;
      monthCounts[month]++;
    }

    const monthAverages = monthTotals.map((total, i) =>
      monthCounts[i] > 0 ? total / monthCounts[i] : 0,
    );

    const overallAvg =
      monthAverages.reduce((s, v) => s + v, 0) / monthAverages.filter((v) => v > 0).length || 1;

    let peakIdx = 0;
    let troughIdx = 0;
    for (let i = 1; i < 12; i++) {
      if (monthAverages[i] > monthAverages[peakIdx]) peakIdx = i;
      if (monthAverages[i] < monthAverages[troughIdx]) troughIdx = i;
    }

    const stdDev = this.computeStdDev(monthAverages);
    const strength = Math.min(1, stdDev / Math.max(overallAvg * 0.4, 1));

    if (strength < 0.1) return null;

    return {
      name: 'yearly (seasonal) cycle',
      type: 'yearly',
      period: '12 months',
      peakDay: monthNames[peakIdx],
      troughDay: monthNames[troughIdx],
      strength: Math.round(strength * 100) / 100,
      peakValue: Math.round(monthAverages[peakIdx] * 100) / 100,
      troughValue: Math.round(monthAverages[troughIdx] * 100) / 100,
      dataPoints: monthNames.map((name, i) => ({
        label: name,
        value: Math.round(monthAverages[i] * 100) / 100,
      })),
    };
  }

  /* ─────────────────────────── Timeframe Building ─────────────────────────── */

  /**
   * Build timeframe comparisons: current period, previous period, year-ago period.
   */
  private async buildTimeframes(
    businessId: string,
    metric: string,
    period: 'week' | 'month' | 'quarter' | 'year',
  ): Promise<TemporalTimeframe[]> {
    const now = new Date();
    const timeframes: TemporalTimeframe[] = [];

    // Define period boundaries
    let currentStart: Date;
    let currentEnd: Date;
    let prevStart: Date;
    let prevEnd: Date;
    let yoyStart: Date;
    let yoyEnd: Date;

    switch (period) {
      case 'week':
        currentStart = startOfWeek(now, { weekStartsOn: 1 });
        currentEnd = now;
        prevStart = startOfWeek(subWeeks(now, 1), { weekStartsOn: 1 });
        prevEnd = subWeeks(now, 1);
        yoyStart = startOfWeek(subYears(now, 1), { weekStartsOn: 1 });
        yoyEnd = subYears(now, 1);
        break;
      case 'month':
        currentStart = startOfMonth(now);
        currentEnd = now;
        prevStart = startOfMonth(subMonths(now, 1));
        prevEnd = subMonths(now, 1);
        yoyStart = startOfMonth(subYears(now, 1));
        yoyEnd = subYears(now, 1);
        break;
      case 'quarter':
        currentStart = startOfQuarter(now);
        currentEnd = now;
        prevStart = startOfQuarter(subQuarters(now, 1));
        prevEnd = subQuarters(now, 1);
        yoyStart = startOfQuarter(subYears(now, 1));
        yoyEnd = subYears(now, 1);
        break;
      case 'year':
        currentStart = startOfYear(now);
        currentEnd = now;
        prevStart = startOfYear(subYears(now, 1));
        prevEnd = subYears(now, 1);
        yoyStart = startOfYear(subYears(now, 2));
        yoyEnd = subYears(now, 2);
        break;
    }

    // Current period
    const currentValue = await this.aggregateMetricInRange(
      businessId,
      metric,
      currentStart!,
      currentEnd,
    );
    timeframes.push({
      period: `this ${period}`,
      metrics: { total: Math.round(currentValue * 100) / 100 },
      comparison: 'same',
      delta: 0,
    });

    // Previous period
    const prevValue = await this.aggregateMetricInRange(
      businessId,
      metric,
      prevStart!,
      prevEnd,
    );
    const prevDelta =
      prevValue !== 0 ? ((currentValue - prevValue) / prevValue) * 100 : 0;
    timeframes.push({
      period: `last ${period}`,
      metrics: { total: Math.round(prevValue * 100) / 100 },
      comparison: this.classifyDelta(prevDelta),
      delta: Math.round(prevDelta * 100) / 100,
    });

    // Year-over-year
    const yoyValue = await this.aggregateMetricInRange(
      businessId,
      metric,
      yoyStart!,
      yoyEnd,
    );
    const yoyDelta =
      yoyValue !== 0 ? ((currentValue - yoyValue) / yoyValue) * 100 : 0;
    timeframes.push({
      period: `same ${period} last year`,
      metrics: { total: Math.round(yoyValue * 100) / 100 },
      comparison: this.classifyDelta(yoyDelta),
      delta: Math.round(yoyDelta * 100) / 100,
    });

    return timeframes;
  }

  /**
   * Build natural language temporal context for a single metric.
   */
  private async buildMetricTemporalContext(
    businessId: string,
    metric: string,
    label: string,
  ): Promise<string | null> {
    const timeframes = await this.buildTimeframes(businessId, metric, 'month');
    if (timeframes.length < 2) return null;

    const current = timeframes[0].metrics.total;
    const prev = timeframes[1].metrics.total;
    const yoy = timeframes[2]?.metrics.total;
    const yoyDelta = timeframes[2]?.delta ?? 0;

    const lines: string[] = [];
    lines.push(`**${label}:**`);
    lines.push(
      `- This month: $${Math.round(current).toLocaleString()}`,
    );
    if (prev > 0) {
      const momDelta = ((current - prev) / prev) * 100;
      const emoji = momDelta > 0 ? '📈' : momDelta < 0 ? '📉' : '➡️';
      lines.push(
        `- vs last month: $${Math.round(prev).toLocaleString()} (${emoji} ${momDelta > 0 ? '+' : ''}${Math.round(momDelta * 10) / 10}%)`,
      );
    }
    if (yoy && yoy > 0) {
      const emoji = yoyDelta > 0 ? '📈' : yoyDelta < 0 ? '📉' : '➡️';
      lines.push(
        `- vs same month last year: $${Math.round(yoy).toLocaleString()} (${emoji} ${yoyDelta > 0 ? '+' : ''}${Math.round(yoyDelta * 10) / 10}%)`,
      );
    }

    return lines.join('\n');
  }

  /**
   * Build a natural language summary of the full temporal analysis.
   */
  private buildAnalysisSummary(
    metric: string,
    timeframes: TemporalTimeframe[],
    cycles: Cycle[],
    forecast: Forecast[],
    anomalies: Anomaly[],
  ): string {
    const parts: string[] = [];

    // Timeframe summary
    if (timeframes.length > 0) {
      const current = timeframes[0];
      const prev = timeframes[1];
      if (prev) {
        const direction = current.delta > 0 ? 'up' : current.delta < 0 ? 'down' : 'flat';
        parts.push(
          `${metric} is ${direction} ${Math.abs(Math.round(current.delta * 10) / 10)}% compared to ${prev.period}.`,
        );
      }
    }

    // Cycle summary
    for (const cycle of cycles) {
      if (cycle.strength > 0.4) {
        parts.push(
          `Strong ${cycle.name}: peaks on ${cycle.peakDay}, troughs on ${cycle.troughDay}.`,
        );
      }
    }

    // Forecast summary
    if (forecast.length > 0) {
      const avgPredicted =
        forecast.reduce((s, f) => s + f.predictedValue, 0) / forecast.length;
      parts.push(
        `Forecasted average ${metric}: ${Math.round(avgPredicted).toLocaleString()} (confidence: ${Math.round((forecast[0]?.confidence || 0) * 100)}%).`,
      );
    }

    // Anomaly summary
    if (anomalies.length > 0) {
      const highSeverity = anomalies.filter((a) => a.severity === 'high').length;
      if (highSeverity > 0) {
        parts.push(`${highSeverity} high-severity anomaly(ies) detected in recent ${metric} data.`);
      } else {
        parts.push(`${anomalies.length} minor anomaly(ies) detected — likely normal variation.`);
      }
    }

    return parts.join(' ') || `Temporal analysis for ${metric} completed.`;
  }

  /* ─────────────────────────── Data Access Layer ─────────────────────────── */

  /**
   * Get daily metric values from the database.
   *
   * This is the central data access method that maps metric names to the
   * appropriate Prisma queries. It returns a time series of (date, value) pairs.
   */
  private async getDailyMetricValues(
    businessId: string,
    metric: string,
    lookbackDays: number,
  ): Promise<Array<{ date: Date; value: number }>> {
    const startDate = subDays(new Date(), lookbackDays);
    const data: Array<{ date: Date; value: number }> = [];

    try {
      switch (metric) {
        case 'revenue': {
          const invoices = await this.prisma.client.invoice.findMany({
            where: {
              businessId,
              createdAt: { gte: startDate },
              status: { not: 'DRAFT' },
            },
            select: { createdAt: true, total: true },
          });
          const grouped = this.groupByDay(invoices, 'createdAt', 'total');
          data.push(...grouped);
          break;
        }

        case 'leads': {
          const contacts = await this.prisma.client.contact.findMany({
            where: {
              businessId,
              status: 'lead',
              createdAt: { gte: startDate },
            },
            select: { createdAt: true },
          });
          const grouped = this.groupCountByDay(contacts, 'createdAt');
          data.push(...grouped);
          break;
        }

        case 'conversions': {
          const converted = await this.prisma.client.contact.findMany({
            where: {
              businessId,
              status: 'customer',
              createdAt: { gte: startDate },
            },
            select: { createdAt: true },
          });
          const grouped = this.groupCountByDay(converted, 'createdAt');
          data.push(...grouped);
          break;
        }

        case 'bookings': {
          const bookings = await this.prisma.client.booking.findMany({
            where: {
              businessId,
              startTime: { gte: startDate },
              status: { notIn: ['CANCELLED', 'NO_SHOW'] },
            },
            select: { startTime: true },
          });
          const grouped = this.groupCountByDay(
            bookings.map((b) => ({ createdAt: b.startTime })),
            'createdAt',
          );
          data.push(...grouped);
          break;
        }

        case 'invoices': {
          const invoices = await this.prisma.client.invoice.findMany({
            where: {
              businessId,
              createdAt: { gte: startDate },
            },
            select: { createdAt: true },
          });
          const grouped = this.groupCountByDay(invoices, 'createdAt');
          data.push(...grouped);
          break;
        }

        case 'payments': {
          const payments = await this.prisma.client.payment.findMany({
            where: {
              businessId,
              status: 'completed',
              createdAt: { gte: startDate },
            },
            select: { createdAt: true, amount: true },
          });
          const grouped = this.groupByDay(payments, 'createdAt', 'amount');
          data.push(...grouped);
          break;
        }

        case 'messages': {
          const messages = await this.prisma.client.message.findMany({
            where: {
              businessId,
              createdAt: { gte: startDate },
            },
            select: { createdAt: true },
          });
          const grouped = this.groupCountByDay(messages, 'createdAt');
          data.push(...grouped);
          break;
        }

        case 'tasks_completed': {
          const tasks = await this.prisma.client.autopilotTask.findMany({
            where: {
              businessId,
              status: 'COMPLETED',
          updatedAt: { gte: startDate },
            },
            select: { updatedAt: true },
          });
          const grouped = this.groupCountByDay(
            tasks.map((t) => ({ createdAt: t.updatedAt })),
            'createdAt',
          );
          data.push(...grouped);
          break;
        }

        case 'expenses': {
          // Fallback: return zero-filled series
          for (let i = 0; i < lookbackDays; i++) {
            data.push({ date: subDays(new Date(), i), value: 0 });
          }
          break;
        }

        default: {
          // Generic fallback: try to find any timestamped records
          this.logger.warn(
            `[getDailyMetricValues] Unknown metric "${metric}", returning empty series`,
          );
          return [];
        }
      }
    } catch (error) {
      this.logger.error(
        `[getDailyMetricValues] Error fetching ${metric}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // Sort by date ascending and fill gaps with zeros
    return this.fillDateGaps(data, lookbackDays);
  }

  /**
   * Get daily metric values within a specific date range.
   */
  private async getDailyMetricValuesInRange(
    businessId: string,
    metric: string,
    start: Date,
    end: Date,
  ): Promise<Array<{ date: Date; value: number }>> {
    const allData = await this.getDailyMetricValues(
      businessId,
      metric,
      differenceInDays(new Date(), start) + 1,
    );
    return allData.filter((d) => d.date >= start && d.date <= end);
  }

  /**
   * Aggregate a metric over a date range.
   */
  private async aggregateMetricInRange(
    businessId: string,
    metric: string,
    start: Date,
    end: Date,
  ): Promise<number> {
    const dailyData = await this.getDailyMetricValuesInRange(
      businessId,
      metric,
      start,
      end,
    );
    return dailyData.reduce((sum, d) => sum + d.value, 0);
  }

  /* ─────────────────────────── Data Transformation ─────────────────────────── */

  /**
   * Group records by day, summing a numeric field.
   */
  private groupByDay<T extends Record<string, unknown>>(
    records: T[],
    dateField: string,
    valueField: string,
  ): Array<{ date: Date; value: number }> {
    const grouped = new Map<string, number>();

    for (const record of records) {
      const dateVal = record[dateField];
      if (!dateVal) continue;

      const date = new Date(dateVal as string | number | Date);
      const key = format(startOfDay(date), 'yyyy-MM-dd');
      const value = Number(record[valueField]) || 0;

      grouped.set(key, (grouped.get(key) || 0) + value);
    }

    return Array.from(grouped.entries())
      .map(([key, value]) => ({
        date: new Date(key + 'T00:00:00Z'),
        value: Math.round(value * 100) / 100,
      }))
      .sort((a, b) => a.date.getTime() - b.date.getTime());
  }

  /**
   * Group records by day, counting occurrences.
   */
  private groupCountByDay<T extends Record<string, unknown>>(
    records: T[],
    dateField: string,
  ): Array<{ date: Date; value: number }> {
    const grouped = new Map<string, number>();

    for (const record of records) {
      const dateVal = record[dateField];
      if (!dateVal) continue;

      const date = new Date(dateVal as string | number | Date);
      const key = format(startOfDay(date), 'yyyy-MM-dd');

      grouped.set(key, (grouped.get(key) || 0) + 1);
    }

    return Array.from(grouped.entries())
      .map(([key, value]) => ({
        date: new Date(key + 'T00:00:00Z'),
        value,
      }))
      .sort((a, b) => a.date.getTime() - b.date.getTime());
  }

  /**
   * Fill gaps in a daily time series with zero values.
   */
  private fillDateGaps(
    data: Array<{ date: Date; value: number }>,
    lookbackDays: number,
  ): Array<{ date: Date; value: number }> {
    const filled: Array<{ date: Date; value: number }> = [];
    const valueMap = new Map<string, number>();

    for (const point of data) {
      const key = format(startOfDay(point.date), 'yyyy-MM-dd');
      valueMap.set(key, (valueMap.get(key) || 0) + point.value);
    }

    const today = startOfDay(new Date());
    for (let i = lookbackDays - 1; i >= 0; i--) {
      const date = subDays(today, i);
      const key = format(date, 'yyyy-MM-dd');
      filled.push({
        date: new Date(key + 'T00:00:00Z'),
        value: valueMap.get(key) || 0,
      });
    }

    return filled;
  }

  /**
   * Aggregate daily data by week or month.
   */
  private aggregateByUnit(
    dailyData: Array<{ date: Date; value: number }>,
    unit: 'days' | 'weeks' | 'months',
  ): Array<{ date: Date; value: number }> {
    if (unit === 'days') return dailyData;

    const grouped = new Map<string, number>();

    for (const point of dailyData) {
      let key: string;
      if (unit === 'weeks') {
        key = format(startOfWeek(point.date, { weekStartsOn: 1 }), 'yyyy-MM-dd');
      } else {
        key = format(startOfMonth(point.date), 'yyyy-MM-dd');
      }
      grouped.set(key, (grouped.get(key) || 0) + point.value);
    }

    return Array.from(grouped.entries())
      .map(([key, value]) => ({
        date: new Date(key + 'T00:00:00Z'),
        value: Math.round(value * 100) / 100,
      }))
      .sort((a, b) => a.date.getTime() - b.date.getTime());
  }

  /* ─────────────────────────── Statistical Utilities ─────────────────────────── */

  /**
   * Compute simple mean.
   */
  private computeMean(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((s, v) => s + v, 0) / values.length;
  }

  /**
   * Compute standard deviation.
   */
  private computeStdDev(values: number[]): number {
    if (values.length < 2) return 0;
    const mean = this.computeMean(values);
    const variance =
      values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / values.length;
    return Math.sqrt(variance);
  }

  /**
   * Compute Holt's Linear Trend (simple exponential smoothing with trend).
   */
  private computeHoltLinearTrend(
    data: Array<{ date: Date; value: number }>,
  ): { level: number; trend: number } {
    if (data.length === 0) return { level: 0, trend: 0 };
    if (data.length === 1) return { level: data[0].value, trend: 0 };

    const alpha = 0.3;
    const beta = 0.1;

    let level = data[0].value;
    let trend = data[1].value - data[0].value;

    for (let i = 1; i < data.length; i++) {
      const value = data[i].value;
      const prevLevel = level;
      level = alpha * value + (1 - alpha) * (level + trend);
      trend = beta * (level - prevLevel) + (1 - beta) * trend;
    }

    return { level: Math.round(level * 100) / 100, trend: Math.round(trend * 100) / 100 };
  }

  /**
   * Classify a delta percentage as better/worse/same.
   */
  private classifyDelta(delta: number): 'better' | 'worse' | 'same' {
    if (delta > 2) return 'better';
    if (delta < -2) return 'worse';
    return 'same';
  }

  /**
   * Test if the difference between two periods is statistically significant
   * using a simple z-test approximation.
   */
  private isSignificantDifference(
    daily1: Array<{ date: Date; value: number }>,
    daily2: Array<{ date: Date; value: number }>,
  ): boolean {
    if (daily1.length < 3 || daily2.length < 3) return false;

    const values1 = daily1.map((d) => d.value);
    const values2 = daily2.map((d) => d.value);

    const mean1 = this.computeMean(values1);
    const mean2 = this.computeMean(values2);
    const std1 = this.computeStdDev(values1);
    const std2 = this.computeStdDev(values2);

    if (std1 === 0 && std2 === 0) return mean1 !== mean2;

    const se = Math.sqrt(
      (std1 * std1) / values1.length + (std2 * std2) / values2.length,
    );
    if (se === 0) return false;

    const zScore = Math.abs((mean1 - mean2) / se);
    return zScore > this.SIGNIFICANCE_Z_THRESHOLD;
  }
}
