import { Injectable, Logger } from '@nestjs/common';
import { SelfModel } from '../types/consciousness.types';
import { ConfidenceCalibration } from './confidence-calibration.service';

/**
 * =============================================================================
 * L5: Metacognition Engine — Self-Awareness & Capability Tracking
 * =============================================================================
 * Maintains a self-model of KEY's own capabilities, tracking proficiency
 * across 9 capability dimensions.  The self-model is used by the
 * orchestrator to calibrate overall output confidence.
 *
 * 9 Tracked Capabilities:
 *   1. Emotion Detection       6. Creative Generation
 *   2. Multi-Mode Reasoning    7. Ethical Evaluation
 *   3. Reflective Cognition    8. Temporal Analysis
 *   4. Intuitive Signalling    9. Orchestration & Synthesis
 *   5. Metacognitive Awareness
 * =============================================================================
 */

@Injectable()
export class MetacognitionEngine {
  private readonly logger = new Logger(MetacognitionEngine.name);

  /** Self-model state — persisted in-memory (production: database). */
  private selfModel: SelfModel;

  constructor(private readonly calibration: ConfidenceCalibration) {
    // Initialise with baseline proficiency scores
    this.selfModel = {
      capabilities: [
        { name: 'emotion-detection', proficiency: 0.72 },
        { name: 'multi-mode-reasoning', proficiency: 0.85 },
        { name: 'reflective-cognition', proficiency: 0.68 },
        { name: 'intuitive-signalling', proficiency: 0.65 },
        { name: 'metacognitive-awareness', proficiency: 0.70 },
        { name: 'creative-generation', proficiency: 0.78 },
        { name: 'ethical-evaluation', proficiency: 0.82 },
        { name: 'temporal-analysis', proficiency: 0.60 },
        { name: 'orchestration-synthesis', proficiency: 0.80 },
      ],
      overallConfidence: 0.76,
      recentAccuracy: 0.74,
    };
  }

  /** Return the current self-model for confidence calibration. */
  async getSelfModel(): Promise<SelfModel> {
    try {
      this.logger.debug('Retrieving self-model');

      // Update accuracy from calibration service
      this.selfModel.recentAccuracy = await this.calibration.getRecentAccuracy();

      // Recalculate overall confidence from capability proficiencies
      const avgProficiency = this.selfModel.capabilities.reduce((sum, c) => sum + c.proficiency, 0)
        / this.selfModel.capabilities.length;
      this.selfModel.overallConfidence = Math.round(avgProficiency * 100) / 100;

      return { ...this.selfModel };
    } catch (err) {
      this.logger.warn(`Self-model retrieval failed: ${(err as Error).message}`);
      // Return last-known-good self-model
      return { ...this.selfModel };
    }
  }

  /** Report the outcome of a capability execution for learning. */
  async reportCapabilityOutcome(
    capabilityName: string,
    success: boolean,
    confidenceDelta: number,
  ): Promise<void> {
    try {
      this.logger.debug(`Capability outcome: ${capabilityName} success=${success} delta=${confidenceDelta}`);

      const capability = this.selfModel.capabilities.find(c => c.name === capabilityName);
      if (!capability) {
        this.logger.warn(`Unknown capability: ${capabilityName}`);
        return;
      }

      // Update proficiency with exponential moving average
      const alpha = 0.1; // learning rate
      const target = success ? Math.min(1, capability.proficiency + confidenceDelta)
        : Math.max(0.1, capability.proficiency - confidenceDelta);
      capability.proficiency = Math.round((capability.proficiency * (1 - alpha) + target * alpha) * 100) / 100;

      // Update calibration
      await this.calibration.recordOutcome(success, confidenceDelta);

      this.logger.verbose(`Updated ${capabilityName} proficiency to ${capability.proficiency}`);
    } catch (err) {
      this.logger.warn(`Capability outcome reporting failed: ${(err as Error).message}`);
    }
  }

  /** Get a capability-specific proficiency score. */
  async getCapabilityProficiency(capabilityName: string): Promise<number> {
    const capability = this.selfModel.capabilities.find(c => c.name === capabilityName);
    return capability?.proficiency ?? 0.5;
  }

  /** List all capabilities with their current status. */
  async listCapabilities(): Promise<{ name: string; proficiency: number; status: 'operational' | 'degraded' | 'offline' }[]> {
    return this.selfModel.capabilities.map(c => ({
      name: c.name,
      proficiency: c.proficiency,
      status: c.proficiency > 0.5 ? 'operational' : c.proficiency > 0.2 ? 'degraded' : 'offline',
    }));
  }
}
