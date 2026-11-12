/**
 * KeyGenome Organ Adapter
 *
 * Plugs business DNA, genome signals, recommendations, and facts
 * into KEY's peripheral nervous system.
 */

import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { BlueprintService } from '../../blueprint/blueprint.service';
import { DnaSectionKey } from '../../blueprint/blueprint.types';
import { GenomeSignalService } from '../../business-genome/key-genome/genome-signal.service';
import { GenomeRecommendationService } from '../../business-genome/key-genome/genome-recommendation.service';
import {
  genomeReaderReadsRevenue,
  listRecommendationsForReader,
  listSignalsForReader,
} from '../../business-genome/key-genome/genome-finance-scope';
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
    /** W11A-SEAM-REPAIR (D-128): reads the revenue level of the member a list call runs for. */
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {
    super();
    this.connect(eventBus);
  }

  /**
   * W11A-SEAM-REPAIR (seam of B1 W11-KEY-ORGAN-AUTHORITY-MAP x B2 W11-GENOME-FINANCE-SCOPE; owner rulings
   * D-128, D-100, D-131): whether the member this call runs for reads revenue, by the rule GET .../key-genome
   * signals and recommendations apply (genome-finance-scope.ts: SUPER_ADMIN passes; else the membership's
   * explicit map or its role's defaults). D-131 opens key_genome.list_signals and list_recommendations to a
   * member holding settings read, so the finance rows are withheld here from one without revenue read, as REST
   * withholds them. The member is ctx.userId: the chat's requester (KeyCortexToolLoopService), an approved
   * proposal's plan member or executor (KeyCortexActionExecutorPlugin), the member memberToolRunAuthority judged.
   * ctx.auditUserId decides no permission (KeyCortexToolContext), and a call for no member is served no finance
   * row (fail closed; D-73: a run with no member reads no money).
   */
  private async readerReadsRevenue(ctx: KeyCortexToolContext): Promise<boolean> {
    if (!ctx.userId) return false;
    const user = await this.prisma.client.user.findUnique({ where: { id: ctx.userId }, select: { role: true } });
    return genomeReaderReadsRevenue(this.prisma, ctx.businessId, { id: ctx.userId, role: user?.role ?? undefined });
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
          // W11A-SEAM-REPAIR (D-128): no finance signal for a member without revenue read, as on REST.
          const signals = await listSignalsForReader(
            this.signalService,
            ctx.businessId,
            { status: input.status as string, limit: input.limit as number },
            await this.readerReadsRevenue(ctx),
          );
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
          // W11A-SEAM-REPAIR (D-128): no FINANCIAL recommendation for a member without revenue read, as on REST.
          const recommendations = await listRecommendationsForReader(
            this.recommendationService,
            ctx.businessId,
            { status: input.status as string, limit: input.limit as number },
            await this.readerReadsRevenue(ctx),
          );
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
