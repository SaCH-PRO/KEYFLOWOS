import { Injectable, Logger, Optional, Inject } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { dnaScoresForReader } from '../../business-genome/key-genome/genome-finance-scope';
import { readsRevenueFor } from '../../business-genome/key-genome/genome-composites-for-reader';
import { ConnectorCommand, ConnectorResult } from '../key-cortex-connector.types';
import { connectorOk, connectorFail } from '../key-cortex-connector.utils';
import { KeyCortexGenomeBridgeService } from '../key-cortex-genome-bridge.service';

/**
 * Bridge adapter for the genome module only.  Other Phase-2 modules now have
 * dedicated typed adapters; this service remains as a fallback for genome
 * commands while the dedicated adapters handle intelligence, analytics,
 * finance, settings, and social commands.
 */
@Injectable()
export class KeyCortexBridgeAdapterService {
  private readonly logger = new Logger(KeyCortexBridgeAdapterService.name);

  constructor(
    @Optional()
    @Inject(KeyCortexGenomeBridgeService)
    private readonly genomeBridge?: KeyCortexGenomeBridgeService,
    @Optional()
    @Inject(PrismaService)
    private readonly prisma?: PrismaService,
  ) {}

  async execute(command: ConnectorCommand): Promise<ConnectorResult> {
    const start = Date.now();
    switch (command.module) {
      case 'genome':
        return await this.executeGenomeAction(command, start);
      default:
        return connectorFail(command, start, `Unknown bridge module: ${command.module}`);
    }
  }

  // ── Genome bridge ─────────────────────────────────────────────────────────

  private async executeGenomeAction(
    command: ConnectorCommand,
    start: number,
  ): Promise<ConnectorResult> {
    const readsRevenue = await readsRevenueFor(
      this.prisma,
      command.businessId,
      command.userId ? { id: command.userId } : null,
    );
    switch (command.action) {
      case 'get_dna': {
        const dna = await this.getGenomeDna(
          command.businessId,
          (command.parameters.recalculate as boolean) || false,
          readsRevenue,
        );
        return connectorOk(command, start, dna);
      }
      case 'get_stage': {
        const stage = await this.getGenomeStage(
          command.businessId,
          (command.parameters.detailed as boolean) || false,
          readsRevenue,
        );
        return connectorOk(command, start, stage);
      }
      case 'get_readiness': {
        const readiness = await this.getGenomeReadiness(
          command.businessId,
          command.parameters.initiative as string,
          readsRevenue,
        );
        return connectorOk(command, start, readiness);
      }
      case 'update_dna': {
        const updated = await this.updateGenomeDna(
          command.businessId,
          command.parameters.dimension as string,
          command.parameters.score as number,
          command.parameters.reason as string,
        );
        return connectorOk(command, start, updated);
      }
      case 'trigger_assessment': {
        const assessment = await this.triggerGenomeAssessment(command.businessId, (command.parameters.notify as boolean) ?? true);
        return connectorOk(command, start, assessment);
      }
      default:
        return connectorFail(command, start, `Unknown genome action: ${command.action}`);
    }
  }

  private async getGenomeDna(businessId: string, recalculate: boolean, readsRevenue: boolean): Promise<unknown> {
    this.logger.verbose(`getGenomeDna(${businessId}, recalculate=${recalculate})`);
    if (this.genomeBridge) {
      const dna = await this.genomeBridge.getDnaScores(businessId);
      if (!readsRevenue) {
        return {
          businessId,
          ...dna,
          scores: dnaScoresForReader(dna.scores, false),
          confidence: dnaScoresForReader(dna.confidence, false),
          stage: null,
          executiveReadiness: null,
          withheldForRevenue: ['stage', 'executiveReadiness', 'financial', 'sales', 'business'],
          recalculate,
        };
      }
      return { businessId, ...dna, recalculate };
    }
    // Graceful fallback when genome bridge is not available.
    return { businessId, status: 'unavailable', message: 'Genome bridge not available' };
  }

  private async getGenomeStage(businessId: string, detailed: boolean, readsRevenue: boolean): Promise<unknown> {
    this.logger.verbose(`getGenomeStage(${businessId}, detailed=${detailed})`);
    if (!readsRevenue) {
      return { businessId, stage: null, detailed, withheldForRevenue: ['stage'] };
    }
    return { businessId, stage: 'growth', detailed };
  }

  private async getGenomeReadiness(businessId: string, initiative: string | undefined, readsRevenue: boolean): Promise<unknown> {
    this.logger.verbose(`getGenomeReadiness(${businessId}, initiative=${initiative})`);
    if (!readsRevenue) {
      return { businessId, initiative, readinessScore: null, withheldForRevenue: ['readinessScore'] };
    }
    return { businessId, initiative, readinessScore: 0.75 };
  }

  private async updateGenomeDna(businessId: string, dimension: string, score: number, reason?: string): Promise<unknown> {
    this.logger.verbose(`updateGenomeDna(${businessId}, ${dimension}, ${score})`);
    return { businessId, dimension, score, reason, updated: true };
  }

  private async triggerGenomeAssessment(businessId: string, notify: boolean): Promise<unknown> {
    this.logger.verbose(`triggerGenomeAssessment(${businessId}, notify=${notify})`);
    return { businessId, assessmentId: `assess_${Date.now()}`, status: 'running', notify };
  }
}
