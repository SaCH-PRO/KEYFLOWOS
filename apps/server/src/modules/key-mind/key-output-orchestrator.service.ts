import { Injectable, Logger } from '@nestjs/common';
import { ConsciousnessInput, ConsciousnessOutput } from '../key-cortex/consciousness/types/consciousness.types';
import { KeyConsciousnessFrame, OutputMode, KeyRoleBrain } from './key-mind.types';
import { KeyRoleClassifier } from './key-role-classifier.service';
import { KeyExpertBrain } from './key-expert-brain.service';
import { KeyFrameworkEngine } from './key-framework-engine.service';
import { KeySignalDetector } from './key-signal-detector.service';
import { KeyBusinessStandard } from './key-business-standard.service';
import { KeyLearningLoop } from './key-learning-loop.service';

/**
 * =============================================================================
 * Output Orchestrator — The Master Service for KEY Mind
 * =============================================================================
 * This is the main entry point. It coordinates ALL other services to:
 *   1. Classify the query (function + tier)
 *   2. Load expert brains
 *   3. Detect hidden signals
 *   4. Select frameworks
 *   5. Check quality standards
 *   6. Build the consciousness frame
 *   7. Produce the final output
 * =============================================================================
 */

@Injectable()
export class KeyOutputOrchestrator {
  private readonly logger = new Logger(KeyOutputOrchestrator.name);

  constructor(
    private readonly classifier: KeyRoleClassifier,
    private readonly expertBrain: KeyExpertBrain,
    private readonly frameworkEngine: KeyFrameworkEngine,
    private readonly signalDetector: KeySignalDetector,
    private readonly qualityStandard: KeyBusinessStandard,
    private readonly learningLoop: KeyLearningLoop,
  ) {}

  /**
   * Main entry: process a user query through the full Role Intelligence pipeline.
   */
  async process(query: string, userId: string, businessId: string): Promise<KeyConsciousnessFrame> {
    const startTime = Date.now();
    const thinkingTrace: string[] = [];

    this.logger.log(`[OutputOrchestrator] Processing: "${query.substring(0, 60)}..."`);

    // Step 1: Classify role
    thinkingTrace.push('1. Classifying business function and worker tier...');
    const classification = await this.classifier.classify(query);
    thinkingTrace.push(`   → ${classification.primaryFunction} / ${classification.primaryTier} (${(classification.confidence * 100).toFixed(0)}% confidence)`);

    // Step 2: Load expert brains
    thinkingTrace.push('2. Loading expert brain configurations...');
    const brains = await this.expertBrain.loadBrain(classification.primaryFunction, classification.primaryTier);
    thinkingTrace.push(`   → ${brains.length} brain(s) loaded: ${brains.map(b => b.name).join(', ')}`);

    // Step 3: Detect signals
    thinkingTrace.push('3. Scanning for hidden business signals...');
    const signals = await this.signalDetector.detectSignals(query);
    thinkingTrace.push(`   → ${signals.length} signal(s) detected: ${signals.map(s => s.description.substring(0, 50)).join('; ')}`);

    // Step 4: Infer hidden risks
    thinkingTrace.push('4. Inferring hidden risks...');
    const hiddenRisks = await this.signalDetector.inferHiddenRisks(query, classification.primaryFunction);
    thinkingTrace.push(`   → ${hiddenRisks.length} risk(s) inferred`);

    // Step 5: Select framework
    thinkingTrace.push('5. Selecting reasoning framework...');
    const framework = await this.frameworkEngine.selectFramework(classification.primaryFunction, query);
    thinkingTrace.push(framework ? `   → ${framework.name}` : '   → No specific framework (general reasoning)');

    // Step 6: Determine output mode
    thinkingTrace.push('6. Determining output mode...');
    const outputMode = this.determineOutputMode(query, signals);
    thinkingTrace.push(`   → ${outputMode}`);

    // Step 7: Build consciousness frame
    const frame: KeyConsciousnessFrame = {
      userIntent: query,
      businessFunction: classification.primaryFunction,
      workerTier: classification.primaryTier,
      activatedRoles: brains.map(b => b.id),
      detectedSignals: signals,
      hiddenRisks,
      opportunities: signals.filter(s => s.type === 'opportunity').map(s => s.description),
      reasoningFrameworks: framework ? [framework.name] : [],
      recommendedOutputMode: outputMode,
      confidence: classification.confidence,
      thinkingTrace,
    };

    const duration = Date.now() - startTime;
    this.logger.log(`[OutputOrchestrator] Frame built in ${duration}ms: ${frame.activatedRoles.length} roles, ${frame.detectedSignals.length} signals, ${frame.hiddenRisks.length} risks`);

    return frame;
  }

  /**
   * Determine the best output mode based on query and signals.
   */
  private determineOutputMode(query: string, signals: { type: string }[]): OutputMode {
    const lowerQuery = query.toLowerCase();

    if (lowerQuery.includes('how do i') || lowerQuery.includes('how to') || lowerQuery.includes('how can')) {
      return 'plan';
    }
    if (lowerQuery.includes('why') || lowerQuery.includes('what is') || lowerQuery.includes('explain')) {
      return 'teaching';
    }
    if (lowerQuery.includes('idea') || lowerQuery.includes('brainstorm') || lowerQuery.includes('creative')) {
      return 'creative';
    }
    if (signals.some(s => s.type === 'risk')) {
      return 'diagnostic';
    }
    if (lowerQuery.includes('fix') || lowerQuery.includes('problem') || lowerQuery.includes('issue')) {
      return 'diagnostic';
    }
    return 'recommendation';
  }
}
