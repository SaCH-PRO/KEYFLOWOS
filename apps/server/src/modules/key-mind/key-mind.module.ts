import { Module } from '@nestjs/common';
import { KeyMindController } from './key-mind.controller';
import { KeyRoleClassifier } from './key-role-classifier.service';
import { KeyExpertBrain } from './key-expert-brain.service';
import { KeyFrameworkEngine } from './key-framework-engine.service';
import { KeySignalDetector } from './key-signal-detector.service';
import { KeyBusinessStandard } from './key-business-standard.service';
import { KeyOutputOrchestrator } from './key-output-orchestrator.service';
import { KeyLearningLoop } from './key-learning-loop.service';

/**
 * =============================================================================
 * KeyMindModule — KEY Role Intelligence Engine
 * =============================================================================
 * 84 business role archetypes across 12 functions x 7 tiers.
 * Detects what role KEY should think as, loads expert brains,
 * applies frameworks, detects signals, checks quality, learns.
 *
 * Providers: 7 services + 1 controller
 * Exports: KeyOutputOrchestrator, KeyRoleClassifier, KeyExpertBrain
 * =============================================================================
 */
@Module({
  controllers: [KeyMindController],
  providers: [
    KeyRoleClassifier,
    KeyExpertBrain,
    KeyFrameworkEngine,
    KeySignalDetector,
    KeyBusinessStandard,
    KeyOutputOrchestrator,
    KeyLearningLoop,
  ],
  exports: [KeyOutputOrchestrator, KeyRoleClassifier, KeyExpertBrain],
})
export class KeyMindModule {}
