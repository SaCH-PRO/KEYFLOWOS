import { Controller, Post, Body, Get } from '@nestjs/common';
import { KeyOutputOrchestrator } from './key-output-orchestrator.service';
import { KeyRoleClassifier } from './key-role-classifier.service';
import { KeyExpertBrain } from './key-expert-brain.service';
import { KeySignalDetector } from './key-signal-detector.service';
import { KeyLearningLoop } from './key-learning-loop.service';
import { KEY_ROLE_TAXONOMY } from './key-role-taxonomy';

/**
 * =============================================================================
 * KeyMindController — REST API for Role Intelligence
 * =============================================================================
 * Endpoints:
 *   POST /key-mind/process        — Full role intelligence pipeline
 *   POST /key-mind/classify       — Classify query into function+tier
 *   POST /key-mind/detect-signals — Detect hidden business signals
 *   GET  /key-mind/taxonomy       — List all 84 role archetypes
 *   GET  /key-mind/learning-stats — Learning loop statistics
 *   GET  /key-mind/health         — Health check
 * =============================================================================
 */
@Controller('key-mind')
export class KeyMindController {
  constructor(
    private readonly orchestrator: KeyOutputOrchestrator,
    private readonly classifier: KeyRoleClassifier,
    private readonly expertBrain: KeyExpertBrain,
    private readonly signalDetector: KeySignalDetector,
    private readonly learningLoop: KeyLearningLoop,
  ) {}

  @Post('process')
  async process(@Body() body: { query: string; userId: string; businessId: string }) {
    const start = Date.now();
    const frame = await this.orchestrator.process(body.query, body.userId, body.businessId);
    return { ...frame, latencyMs: Date.now() - start };
  }

  @Post('classify')
  async classify(@Body() body: { query: string }) {
    return this.classifier.classify(body.query);
  }

  @Post('detect-signals')
  async detectSignals(@Body() body: { query: string }) {
    return this.signalDetector.detectSignals(body.query);
  }

  @Get('taxonomy')
  getTaxonomy() {
    return {
      totalRoles: KEY_ROLE_TAXONOMY.length,
      functions: [...new Set(KEY_ROLE_TAXONOMY.map(r => r.functionArea))],
      tiers: [...new Set(KEY_ROLE_TAXONOMY.map(r => r.tier))],
      roles: KEY_ROLE_TAXONOMY.map(r => ({ id: r.id, name: r.name, function: r.functionArea, tier: r.tier })),
    };
  }

  @Get('learning-stats')
  async getLearningStats() {
    return this.learningLoop.getStats();
  }

  @Get('health')
  health() {
    return { status: 'ok', module: 'key-mind', version: '1.0.0' };
  }
}
