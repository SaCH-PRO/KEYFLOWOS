import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

export interface CognitiveEventInput {
  businessId: string;
  sourceType: string;
  sourceId?: string;
  eventType: string;
  payload: Record<string, unknown>;
  confidence?: number;
}

/**
 * Normalizes business signals into a single cognitive event store.
 *
 * The event bus is the Mind's perception layer: every connector event,
 * inbox message, genome signal, and cortex interaction is converted into
 * a structured CognitiveEvent with provenance and confidence.
 */
@Injectable()
export class CognitiveEventBusService {
  private readonly logger = new Logger(CognitiveEventBusService.name);

  constructor(private readonly prisma: PrismaService) {}

  async emit(input: CognitiveEventInput): Promise<string> {
    const record = await this.prisma.client.cognitiveEvent.create({
      data: {
        businessId: input.businessId,
        sourceType: input.sourceType,
        sourceId: input.sourceId ?? null,
        eventType: input.eventType,
        payload: input.payload,
        confidence: input.confidence ?? 0.8,
      },
    });

    this.logger.debug(
      `[emit] ${input.eventType} from ${input.sourceType} for ${input.businessId}`,
    );
    return record.id;
  }

  async list(
    businessId: string,
    options: { sourceType?: string; eventType?: string; limit?: number } = {},
  ): Promise<Array<{ id: string; sourceType: string; eventType: string; payload: Record<string, unknown>; createdAt: Date }>> {
    const rows = await this.prisma.client.cognitiveEvent.findMany({
      where: {
        businessId,
        ...(options.sourceType ? { sourceType: options.sourceType } : {}),
        ...(options.eventType ? { eventType: options.eventType } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: options.limit ?? 100,
    });

    return rows.map((r) => ({
      id: r.id,
      sourceType: r.sourceType,
      eventType: r.eventType,
      payload: (r.payload as Record<string, unknown>) ?? {},
      createdAt: r.createdAt,
    }));
  }
}
