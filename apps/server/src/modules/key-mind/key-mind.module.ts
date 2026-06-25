import { Module } from '@nestjs/common';
import { KeyMindController } from './key-mind.controller';
import { KeyRoleClassifier } from './key-role-classifier.service';
import { KeyExpertBrain } from './key-expert-brain.service';
import { KeyFrameworkEngine } from './key-framework-engine.service';
import { KeySignalDetector } from './key-signal-detector.service';
import { KeyBusinessStandard } from './key-business-standard.service';
import { KeyOutputOrchestrator } from './key-output-orchestrator.service';
import { KeyLearningLoop } from './key-learning-loop.service';

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
