import { Injectable, Logger, Optional, Inject } from '@nestjs/common';
import { ModelGatewayService } from '../ai/model-gateway.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { RedisService } from '../../core/redis/redis.service';
import { KeyCortexGenomeBridgeService } from './key-cortex-genome-bridge.service';
import { KeyCortexEventService } from './key-cortex-event.service';
import { KeyCortexGenomeContextService } from './key-cortex-genome-context.service';
import { InteractionFeedback } from './key-cortex-reasoning.types';

/**
 * KeyCortexInteractionService
 *
 * Handles learning from user interactions (FU-KEY-GENOME-READS-RESIDUAL deleted its uncalled, unprojected
 * explainDecision).
 */
@Injectable()
export class KeyCortexInteractionService {
  private readonly logger = new Logger(KeyCortexInteractionService.name);

  constructor(
    @Inject(ModelGatewayService)
    private readonly modelGateway: ModelGatewayService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly genomeContextService: KeyCortexGenomeContextService,
    @Optional()
    @Inject(KeyCortexGenomeBridgeService)
    private readonly genomeBridgeService?: KeyCortexGenomeBridgeService,
    @Optional()
    @Inject(KeyCortexEventService)
    private readonly eventService?: KeyCortexEventService,
  ) {}

  /**
   * Learn from a user interaction by recording feedback and feeding outcomes
   * to the genome outcome learning system.
   */
  async learnFromInteraction(
    sessionId: string,
    interaction: InteractionFeedback,
    genomeV3Enabled = false,
  ): Promise<void> {
    this.logger.log(
      `[learnFromInteraction] session=${sessionId} rating=${interaction.userRating ?? 'none'}`,
    );

    try {
      await (this.prisma.client as any).keyInteractionFeedback.create({
        data: {
          sessionId,
          query: interaction.query.substring(0, 500),
          response: interaction.response.substring(0, 2000),
          userRating: interaction.userRating ?? null,
          userComment: interaction.userComment ?? null,
          actionsTaken: JSON.stringify(interaction.actionsTaken),
          actionsSkipped: JSON.stringify(interaction.actionsSkipped),
          metadata: interaction.metadata
            ? JSON.stringify(interaction.metadata)
            : null,
        },
      });

      if (interaction.userRating !== undefined) {
        const rating = interaction.userRating;
        const redisKey = `learning:ratings:${sessionId}`;
        const existing = await this.redis.getJson<{
          ratings: number[];
          count: number;
        }>(redisKey);

        const ratings = existing?.ratings ?? [];
        ratings.push(rating);

        await this.redis.setJson(
          redisKey,
          {
            ratings,
            count: ratings.length,
            average: ratings.reduce((a: any, b: any) => a + b, 0) / ratings.length,
          },
          86400 * 30,
        );

        this.logger.debug(
          `[learnFromInteraction] Rating ${rating}/5 recorded. Average: ${(ratings.reduce((a: any, b: any) => a + b, 0) / ratings.length).toFixed(2)}`,
        );
      }

      if (genomeV3Enabled && this.genomeBridgeService) {
        try {
          for (const actionId of interaction.actionsTaken) {
            await (this.genomeBridgeService as any).reportActionOutcome(
              interaction.metadata?.businessId as string,
              {
                actionId,
                status: 'success',
                description: `User-rated ${interaction.userRating ?? 'N/A'}/5 — action taken`,
                result: {
                  userRating: interaction.userRating,
                  userComment: interaction.userComment,
                  sessionId,
                },
                timestamp: new Date(),
                correlationId: sessionId,
              },
            );
          }

          for (const actionId of interaction.actionsSkipped) {
            await (this.genomeBridgeService as any).reportActionOutcome(
              interaction.metadata?.businessId as string,
              {
                actionId,
                status: 'skipped',
                description: `User skipped this action — may indicate low relevance`,
                result: {
                  userRating: interaction.userRating,
                  sessionId,
                },
                timestamp: new Date(),
                correlationId: sessionId,
              },
            );
          }

          if (interaction.userRating && interaction.userRating >= 4) {
            await (this.genomeBridgeService as any).createEvidence(
              interaction.metadata?.businessId as string,
              {
                type: 'user_feedback_positive',
                description: `User rated interaction ${interaction.userRating}/5: "${interaction.userComment ?? 'No comment'}"`,
                source: 'key_cortex',
                metadata: {
                  sessionId,
                  rating: interaction.userRating,
                  actionsTaken: interaction.actionsTaken,
                },
              },
            );
          }

          this.logger.log(
            `[learnFromInteraction] Genome outcome learning updated for session=${sessionId}`,
          );
        } catch (err: any) {
          this.logger.warn(
            `[learnFromInteraction] Genome outcome learning failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    } catch (error: any) {
      this.logger.error(
        `[learnFromInteraction] Failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }
}
