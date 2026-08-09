import { Injectable, Logger, Optional, Inject } from '@nestjs/common';
import { ModelGatewayService } from '../ai/model-gateway.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { RedisService } from '../../core/redis/redis.service';
import { KeyCortexGenomeBridgeService } from './key-cortex-genome-bridge.service';
import { KeyCortexEventService } from './key-cortex-event.service';
import { KeyCortexGenomeContextService } from './key-cortex-genome-context.service';
import {
  InteractionFeedback,
  GenomeEnrichedContext,
} from './key-cortex-reasoning.types';

/**
 * KeyCortexInteractionService
 *
 * Handles decision explanations and learning from user interactions.
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
   * Explain a decision by looking it up in the event log and generating
   * a human-readable explanation that includes genome context at the time.
   */
  async explainDecision(decisionId: string): Promise<string> {
    this.logger.debug(`[explainDecision] Looking up decision: ${decisionId}`);

    try {
      let eventLog: Array<{
        step: string;
        timestamp: Date;
        data: Record<string, unknown>;
      }> = [];

      if (this.eventService) {
        try {
          // getEventLog() has never existed on KeyCortexEventService. The cast
          // silenced the compiler, the call threw on every invocation, and the
          // catch below turned that into an empty log — so explainDecision has
          // always fallen through to the cortexSession branch and never once
          // used a business event.
          //
          // getEventChain(correlationId) is the method that was wanted. That
          // decisionId IS a correlationId is not a guess: the fallback directly
          // beneath queries cortexSession for metadata.correlationId equal to
          // this same decisionId.
          const chain = await this.eventService.getEventChain(decisionId);
          eventLog = chain.map((e) => ({
            step: `${e.eventType}:${e.action}`,
            timestamp: e.createdAt,
            data: {
              subjectType: e.subjectType,
              subjectId: e.subjectId,
              actorType: e.actorType,
              actorId: e.actorId,
              source: e.source,
              ...(e.before ? { before: e.before } : {}),
              ...(e.after ? { after: e.after } : {}),
            },
          }));
        } catch {
          // A decision with no recorded events is normal, not an error.
        }
      }

      let decisionData: Record<string, unknown> = {};
      if (eventLog.length === 0) {
        const session = await (this.prisma.client as any).cortexSession.findFirst(
          {
            where: {
              messages: {
                path: ['metadata', 'correlationId'],
                equals: decisionId,
              },
            },
            include: { messages: true },
          },
        );
        if (session) {
          decisionData = {
            sessionId: session.id,
            businessId: session.businessId,
            messages: session.messages,
          };
        }
      } else {
        decisionData = {
          eventLog,
          steps: eventLog.map((e: any) => e.step),
        };
      }

      let genomeContext: GenomeEnrichedContext | null = null;
      if (decisionData.businessId) {
        try {
          genomeContext = await this.genomeContextService.getGenomeEnrichedContext(
            decisionData.businessId as string,
          );
        } catch {
          // Genome context may not be available
        }
      }

      const explanationPrompt = `You are KEY's decision-explanation engine. Explain this decision clearly and concisely.

Decision ID: ${decisionId}

Decision Steps:
${eventLog.length > 0 ? eventLog.map((e: any) => `- ${e.step} at ${e.timestamp}`).join('\n') : 'Steps not available in event log'}

${genomeContext ? `Genome Context at Decision Time:
- Genome Stage: ${genomeContext.genomeStage}
- Executive Readiness: ${genomeContext.executiveReadiness}%
- DNA Scores: ${JSON.stringify(genomeContext.dnaScores)}
- Active Signals: ${genomeContext.signals.length}
- Top Recommendation: ${genomeContext.recommendations[0]?.title ?? 'None'}` : 'Genome context not available'}

Write a 3-4 sentence explanation of this decision that a non-technical business owner can understand. Be transparent about what data was used and why the decision was made. Use first person ("I decided...").`;

      const result = await (this.modelGateway as any).complete({
        messages: [
          {
            role: 'system',
            content:
              'You are KEY, an AI business partner. Explain your decisions clearly and transparently.',
          },
          { role: 'user', content: explanationPrompt },
        ],
        model: 'gpt-4o-mini',
        temperature: 0.4,
        maxTokens: 500,
      });

      return (
        result.content?.trim() ??
        `I made decision ${decisionId} based on the available business context and genome intelligence at that time.`
      );
    } catch (error: any) {
      this.logger.error(
        `[explainDecision] Failed for ${decisionId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return `Unable to explain decision ${decisionId}: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }

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
