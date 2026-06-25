import { Injectable, Logger } from '@nestjs/common';
import { WeakSignal } from '../types/consciousness.types';

/**
 * =============================================================================
 * L4: Intuition Engine — Weak Signal Detection via Z-Score Anomaly Detection
 * =============================================================================
 * Scans simulated business metrics for statistically anomalous deviations
 * using z-score analysis.  A weak signal is a metric that deviates more
 * than 2σ from its historical mean — potentially indicating an emerging
 * trend before it becomes obvious.
 *
 * Z-score formula: z = (x - μ) / σ
 *   where μ = mean, σ = standard deviation
 * =============================================================================
 */

interface MetricSeries {
  source: string;
  metric: string;
  values: number[]; // historical values
}

@Injectable()
export class IntuitionEngine {
  private readonly logger = new Logger(IntuitionEngine.name);

  /** Z-score threshold for flagging a weak signal. */
  private readonly Z_THRESHOLD = 2.0;

  // Simulated metric series — in production this would read from a time-series DB
  private readonly metricSeries: MetricSeries[] = [
    { source: 'customer-support', metric: 'response-time-minutes', values: [5, 6, 5, 7, 6, 5, 6, 15, 5, 6, 5, 7, 6, 5, 20] },
    { source: 'sales-pipeline', metric: 'conversion-rate-percent', values: [12, 13, 12, 14, 13, 12, 13, 12, 11, 10, 9, 8, 12, 13] },
    { source: 'employee-engagement', metric: 'sentiment-score', values: [7.2, 7.3, 7.1, 7.4, 7.2, 7.3, 6.1, 7.2, 7.3, 7.1, 7.0, 5.8, 7.2, 7.3] },
    { source: 'cash-flow', metric: 'daily-variance-k', values: [10, -5, 8, -3, 12, -8, 45, 5, -7, 9, -4, 50, 6, -6] },
    { source: 'website-traffic', metric: 'bounce-rate-percent', values: [45, 46, 44, 45, 46, 47, 48, 62, 45, 46, 47, 65, 44, 45] },
    { source: 'product-quality', metric: 'defect-rate-per-1000', values: [2, 3, 2, 3, 2, 8, 2, 3, 2, 9, 2, 3, 2, 2] },
    { source: 'competitive-intel', metric: 'price-index-relative', values: [1.0, 1.0, 1.01, 1.0, 0.99, 1.0, 1.0, 0.85, 1.0, 1.0, 0.82, 1.0, 1.0, 1.0] },
  ];

  /** Scan all metric series for anomalous weak signals. */
  async scanForWeakSignals(): Promise<WeakSignal[]> {
    try {
      this.logger.debug('Scanning for weak signals across metric series');

      const signals: WeakSignal[] = [];

      for (const series of this.metricSeries) {
        const { mean, stdDev } = this.computeStats(series.values);
        const latest = series.values[series.values.length - 1];
        const zScore = stdDev === 0 ? 0 : (latest - mean) / stdDev;

        if (Math.abs(zScore) > this.Z_THRESHOLD) {
          const direction = zScore > 0 ? 'above' : 'below';
          signals.push({
            source: series.source,
            metric: series.metric,
            deviation: Math.round(zScore * 100) / 100,
            description: `Latest value (${latest}) is ${Math.abs(zScore).toFixed(1)}σ ${direction} historical mean (${mean.toFixed(1)}). ` +
              `This may indicate an emerging trend in ${series.source}.`,
          });
        }
      }

      this.logger.verbose(`Weak signal scan complete: ${signals.length} anomalies detected`);
      return signals;
    } catch (err) {
      this.logger.warn(`Weak signal scan failed: ${(err as Error).message}`);
      return [];
    }
  }

  /** Compute mean and standard deviation of a number series. */
  private computeStats(values: number[]): { mean: number; stdDev: number } {
    const n = values.length;
    const mean = values.reduce((sum, v) => sum + v, 0) / n;
    const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / n;
    const stdDev = Math.sqrt(variance);
    return { mean, stdDev };
  }

  /** Get a summary of the current intuition state. */
  async getIntuitionState(): Promise<{
    seriesScanned: number;
    anomaliesDetected: number;
    highestDeviation: number;
  }> {
    const signals = await this.scanForWeakSignals();
    const highestDeviation = signals.length > 0
      ? Math.max(...signals.map(s => Math.abs(s.deviation)))
      : 0;

    return {
      seriesScanned: this.metricSeries.length,
      anomaliesDetected: signals.length,
      highestDeviation,
    };
  }
}
