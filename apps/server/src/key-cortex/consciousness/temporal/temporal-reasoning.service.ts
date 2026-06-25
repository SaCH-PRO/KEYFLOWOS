import { Injectable, Logger } from '@nestjs/common';

/**
 * =============================================================================
 * L8: Temporal Reasoning — Time-Series Analysis
 * =============================================================================
 * Analyses time-series data using simple linear regression to identify trends,
 * compute slopes, and generate forward predictions.
 *
 * Linear regression: y = mx + b
 *   m = Σ((x - x̄)(y - ȳ)) / Σ((x - x̄)²)
 *   b = ȳ - m·x̄
 * =============================================================================
 */

@Injectable()
export class TemporalReasoning {
  private readonly logger = new Logger(TemporalReasoning.name);

  /**
   * Analyse a time series to determine trend direction and predict the
   * next value.
   *
   * @param data — ordered sequence of measurements (oldest → newest)
   * @returns trend direction, next-value prediction, and confidence
   */
  async analyzeTimeSeries(data: number[]): Promise<{
    trend: string;
    prediction: number;
    confidence: number;
  }> {
    try {
      this.logger.debug(`Analysing time series with ${data.length} data points`);

      if (data.length < 2) {
        return {
          trend: 'insufficient-data',
          prediction: data[0] ?? 0,
          confidence: 0.1,
        };
      }

      // Build x-coordinates (0, 1, 2, ...)
      const x = data.map((_, i) => i);
      const { slope, intercept } = this.linearRegression(x, data);

      // Predict next value
      const nextX = data.length;
      const prediction = slope * nextX + intercept;

      // Compute R² as confidence proxy
      const rSquared = this.computeRSquared(x, data, slope, intercept);
      const confidence = Math.round(Math.max(0.1, Math.min(0.95, rSquared)) * 100) / 100;

      // Classify trend
      const trendMagnitude = Math.abs(slope);
      const trend = this.classifyTrend(slope, trendMagnitude, rSquared);

      this.logger.verbose(`Trend: ${trend}, slope=${slope.toFixed(4)}, prediction=${prediction.toFixed(2)}, R²=${rSquared.toFixed(3)}`);

      return {
        trend,
        prediction: Math.round(prediction * 100) / 100,
        confidence,
      };
    } catch (err) {
      this.logger.warn(`Time-series analysis failed: ${(err as Error).message}`);
      return {
        trend: 'error',
        prediction: data[data.length - 1] ?? 0,
        confidence: 0.1,
      };
    }
  }

  /**
   * Detect seasonality by comparing adjacent period differences.
   * Returns the dominant cycle length if detected.
   */
  async detectSeasonality(data: number[]): Promise<{
    hasSeasonality: boolean;
    cycleLength: number | null;
    seasonalStrength: number;
  }> {
    try {
      if (data.length < 8) {
        return { hasSeasonality: false, cycleLength: null, seasonalStrength: 0 };
      }

      // Try cycle lengths 2 through data.length / 2
      let bestCycle: number | null = null;
      let bestCorrelation = 0;

      for (let cycle = 2; cycle <= Math.floor(data.length / 2); cycle++) {
        const correlation = this.computeAutocorrelation(data, cycle);
        if (correlation > bestCorrelation) {
          bestCorrelation = correlation;
          bestCycle = cycle;
        }
      }

      const hasSeasonality = bestCorrelation > 0.5;
      const seasonalStrength = Math.round(bestCorrelation * 100) / 100;

      return {
        hasSeasonality,
        cycleLength: bestCycle,
        seasonalStrength,
      };
    } catch (err) {
      this.logger.warn(`Seasonality detection failed: ${(err as Error).message}`);
      return { hasSeasonality: false, cycleLength: null, seasonalStrength: 0 };
    }
  }

  /** Simple linear regression: returns slope (m) and intercept (b). */
  private linearRegression(x: number[], y: number[]): { slope: number; intercept: number } {
    const n = x.length;
    const xMean = x.reduce((sum, v) => sum + v, 0) / n;
    const yMean = y.reduce((sum, v) => sum + v, 0) / n;

    let numerator = 0;
    let denominator = 0;
    for (let i = 0; i < n; i++) {
      numerator += (x[i] - xMean) * (y[i] - yMean);
      denominator += (x[i] - xMean) ** 2;
    }

    const slope = denominator === 0 ? 0 : numerator / denominator;
    const intercept = yMean - slope * xMean;

    return { slope, intercept };
  }

  /** Compute R² (coefficient of determination). */
  private computeRSquared(x: number[], y: number[], slope: number, intercept: number): number {
    const yMean = y.reduce((sum, v) => sum + v, 0) / y.length;
    let ssTotal = 0;
    let ssResidual = 0;

    for (let i = 0; i < x.length; i++) {
      const predicted = slope * x[i] + intercept;
      ssTotal += (y[i] - yMean) ** 2;
      ssResidual += (y[i] - predicted) ** 2;
    }

    return ssTotal === 0 ? 1 : 1 - (ssResidual / ssTotal);
  }

  /** Classify the trend direction and strength. */
  private classifyTrend(slope: number, magnitude: number, rSquared: number): string {
    const isSignificant = rSquared > 0.3;

    if (!isSignificant) {
      return magnitude < 0.01 ? 'stable-noise' : 'uncertain';
    }

    if (slope > 0.1) return 'strong-upward';
    if (slope > 0.01) return 'moderate-upward';
    if (slope > 0) return 'weak-upward';
    if (slope < -0.1) return 'strong-downward';
    if (slope < -0.01) return 'moderate-downward';
    if (slope < 0) return 'weak-downward';
    return 'stable';
  }

  /** Compute autocorrelation at a given lag. */
  private computeAutocorrelation(data: number[], lag: number): number {
    const n = data.length;
    const mean = data.reduce((s, v) => s + v, 0) / n;

    let numerator = 0;
    let denominator = 0;

    for (let i = 0; i < n - lag; i++) {
      numerator += (data[i] - mean) * (data[i + lag] - mean);
    }
    for (let i = 0; i < n; i++) {
      denominator += (data[i] - mean) ** 2;
    }

    return denominator === 0 ? 0 : numerator / denominator;
  }
}
