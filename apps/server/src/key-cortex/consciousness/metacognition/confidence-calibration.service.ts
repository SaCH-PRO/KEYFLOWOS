import { Injectable, Logger } from '@nestjs/common';

/**
 * =============================================================================
 * Confidence Calibration — Accuracy Tracking
 * =============================================================================
 * Tracks historical accuracy of confidence predictions to detect and correct
 * overconfidence or underconfidence.  Uses a sliding window of recent
 * outcomes to compute calibration metrics.
 * =============================================================================
 */

interface OutcomeRecord {
  timestamp: number;
  predicted: boolean; // did we predict success?
  actual: boolean;    // did success actually occur?
  confidence: number; // confidence level at the time (0–1)
}

@Injectable()
export class ConfidenceCalibration {
  private readonly logger = new Logger(ConfidenceCalibration.name);

  /** Sliding window of recent outcomes. */
  private outcomes: OutcomeRecord[] = [];
  private readonly MAX_WINDOW = 200;

  /** Record a new outcome for calibration tracking. */
  async recordOutcome(success: boolean, confidence: number): Promise<void> {
    try {
      this.outcomes.push({
        timestamp: Date.now(),
        predicted: confidence > 0.5,
        actual: success,
        confidence,
      });

      // Trim window
      if (this.outcomes.length > this.MAX_WINDOW) {
        this.outcomes = this.outcomes.slice(-this.MAX_WINDOW);
      }
    } catch (err) {
      this.logger.warn(`Outcome recording failed: ${(err as Error).message}`);
    }
  }

  /** Get recent accuracy over the last N outcomes. */
  async getRecentAccuracy(windowSize: number = 50): Promise<number> {
    try {
      const recent = this.outcomes.slice(-windowSize);
      if (recent.length === 0) return 0.75; // default prior

      const correct = recent.filter(o => o.predicted === o.actual).length;
      const accuracy = correct / recent.length;

      this.logger.verbose(`Recent accuracy (${recent.length} samples): ${Math.round(accuracy * 100)}%`);
      return Math.round(accuracy * 100) / 100;
    } catch (err) {
      this.logger.warn(`Accuracy computation failed: ${(err as Error).message}`);
      return 0.75;
    }
  }

  /** Detect calibration drift — are we overconfident or underconfident? */
  async getCalibrationDrift(): Promise<{
    drift: number;       // positive = overconfident, negative = underconfident
    sampleSize: number;
    recommendation: string;
  }> {
    try {
      const recent = this.outcomes.slice(-50);
      if (recent.length < 10) {
        return { drift: 0, sampleSize: recent.length, recommendation: 'Insufficient data for calibration assessment' };
      }

      // Average predicted confidence vs actual accuracy
      const avgConfidence = recent.reduce((sum, o) => sum + o.confidence, 0) / recent.length;
      const correct = recent.filter(o => o.predicted === o.actual).length;
      const actualAccuracy = correct / recent.length;

      const drift = avgConfidence - actualAccuracy;

      let recommendation: string;
      if (drift > 0.15) {
        recommendation = 'System is overconfident. Recommend dampening confidence outputs by 10-15%.';
      } else if (drift < -0.15) {
        recommendation = 'System is underconfident. Recommend increasing confidence outputs by 10-15%.';
      } else {
        recommendation = 'Calibration is within acceptable bounds.';
      }

      return {
        drift: Math.round(drift * 100) / 100,
        sampleSize: recent.length,
        recommendation,
      };
    } catch (err) {
      this.logger.warn(`Calibration drift detection failed: ${(err as Error).message}`);
      return { drift: 0, sampleSize: 0, recommendation: 'Error in calibration assessment' };
    }
  }

  /** Apply calibration correction to a raw confidence score. */
  async calibrateConfidence(rawConfidence: number): Promise<number> {
    try {
      const { drift } = await this.getCalibrationDrift();
      const corrected = rawConfidence - drift * 0.5; // Apply half the drift correction
      return Math.round(Math.max(0.05, Math.min(0.95, corrected)) * 100) / 100;
    } catch (err) {
      this.logger.warn(`Confidence calibration failed: ${(err as Error).message}`);
      return rawConfidence;
    }
  }
}
