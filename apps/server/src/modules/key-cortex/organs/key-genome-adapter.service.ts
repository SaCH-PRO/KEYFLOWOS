/**
 * KeyGenome Organ Adapter
 *
 * Plugs business DNA, genome signals, recommendations, and facts
 * into KEY's peripheral nervous system.
 */

import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { BlueprintService } from '../../blueprint/blueprint.service';
import { DnaSectionKey } from '../../blueprint/blueprint.types';
import { GenomeSignalService } from '../../business-genome/key-genome/genome-signal.service';
import { GenomeRecommendationService } from '../../business-genome/key-genome/genome-recommendation.service';
import { GenomeFactService } from '../../business-genome/key-genome/genome-fact.service';
import { GenomeModuleReadinessService } from '../../business-genome/key-genome/genome-module-readiness.service';
import { GenomeScoringService } from '../../business-genome/key-genome/genome-scoring.service';
import { KeyOrganAdapter } from './key-organ-adapter.interface';
import {
  KeyCortexToolContext,
  KeyCortexToolDefinition,
  KeyCortexToolResult,
} from '../key-cortex-tool-registry.service';
import { KeyCortexEventBusService } from '../key-cortex-event-bus.service';

@Injectable()
export class KeyGenomeAdapterService extends KeyOrganAdapter {
  readonly organId = 'key_genome';
  readonly organName = 'Key Genome';
  private readonly logger = new Logger(KeyGenomeAdapterService.name);

  constructor(
    private readonly blueprint: BlueprintService,
    private readonly signalService: GenomeSignalService,
    @Inject(forwardRef(() => GenomeRecommendationService))
    private readonly recommendationService: GenomeRecommendationService,
    private readonly factService: GenomeFactService,
    private readonly readinessService: GenomeModuleReadinessService,
    private readonly scoringService: GenomeScoringService,
    eventBus: KeyCortexEventBusService,
  ) {
    super();
    this.connect(eventBus);
  }

  async getState(businessId: string): Promise<import('./key-organ-adapter.interface').KeyOrganState> {
    try {
      const [integrity, readiness] = await Promise.all([
        this.blueprint.calculateGenomeIntegrity(businessId).catch(() => null),
        this.readinessService.getReadiness(businessId).catch(() => null),
      ]);
      const score = this.scoringService.computeBusinessScore(businessId);
      return {
        healthy: true,
        status: 'Genome loaded',
        metadata: {
          integrity,
          readinessCount: Array.isArray(readiness) ? readiness.length : readiness ? 1 : 0,
          score,
        },
      };
    } catch (err: unknown) {
      this.logger.error(`getState failed: ${err instanceof Error ? err.message : String(err)}`);
      return { healthy: false, status: 'Genome state unavailable', gaps: ['genome_error'] };
    }
  }

  listTools(): KeyCortexToolDefinition[] {
    return [
      this.makeTool(
        'key_genome.get_blueprint',
        'Get the full business blueprint/DNA',
        1,
        false,
        [],
        {},
        async (ctx) => {
          const blueprint = await this.blueprint.getBlueprint(ctx.businessId);
          return { success: true, data: blueprint };
        },
      ),
      this.makeTool(
        'key_genome.calculate_integrity',
        'Calculate genome integrity scores across all DNA sections',
        1,
        false,
        [],
        {},
        async (ctx) => {
          const integrity = await this.blueprint.calculateGenomeIntegrity(ctx.businessId);
          return { success: true, data: integrity };
        },
      ),
      this.makeTool(
        'key_genome.list_signals',
        'List genome signals detected for the business',
        1,
        false,
        [],
        {
          status: { type: 'string' },
          limit: { type: 'number' },
        },
        async (ctx, input) => {
          const signals = await this.signalService.listSignals(ctx.businessId, {
            status: input.status as string,
            limit: input.limit as number,
          });
          return { success: true, data: { signals, count: signals.length } };
        },
      ),
      this.makeTool(
        'key_genome.list_recommendations',
        'List genome recommendations for the business',
        1,
        false,
        [],
        {
          status: { type: 'string' },
          limit: { type: 'number' },
        },
        async (ctx, input) => {
          const recommendations = await this.recommendationService.listRecommendations(ctx.businessId, {
            status: input.status as string,
            limit: input.limit as number,
          });
          return { success: true, data: { recommendations, count: recommendations.length } };
        },
      ),
      this.makeTool(
        'key_genome.list_facts',
        'List genome facts for the business',
        1,
        false,
        [],
        {
          section: { type: 'string' },
          limit: { type: 'number' },
        },
        async (ctx, input) => {
          const facts = await this.factService.listFacts(ctx.businessId, {
            section: input.section as string,
          });
          return { success: true, data: { facts, count: facts.length } };
        },
      ),
      this.makeTool(
        'key_genome.get_readiness',
        'Get module readiness for automation',
        1,
        false,
        [],
        {
          module: { type: 'string' },
        },
        async (ctx, input) => {
          const readiness = await this.readinessService.getReadiness(ctx.businessId, input.module as any);
          return { success: true, data: { readiness } };
        },
      ),
      this.makeTool(
        'key_genome.update_dna_section',
        'Update a DNA section in the business blueprint',
        2,
        true,
        ['sectionKey', 'data'],
        {},
        async (ctx, input) => {
          const updated = await this.blueprint.updateDnaSection(
            ctx.businessId,
            input.sectionKey as DnaSectionKey,
            input.data as Record<string, unknown>,
          );
          return { success: true, data: updated };
        },
      ),
    ];
  }

  async executeTool(
    toolName: string,
    ctx: KeyCortexToolContext,
    input: Record<string, unknown>,
  ): Promise<KeyCortexToolResult> {
    const tool = this.listTools().find((t) => t.name === toolName);
    if (!tool) return { success: false, error: `Tool ${toolName} not found` };
    return tool.handler(ctx, input);
  }

  // ========================================================================
  // Helpers
  // ========================================================================

  private makeTool(
    name: string,
    description: string,
    riskTier: 1 | 2 | 3 | 4,
    requiresApproval: boolean,
    required: string[],
    properties: Record<string, unknown>,
    handler: KeyCortexToolDefinition['handler'],
  ): KeyCortexToolDefinition {
    return {
      name,
      module: this.organId,
      description,
      riskTier,
      requiresApproval,
      parameters: { type: 'object', properties, required },
      handler,
    };
  }
}
