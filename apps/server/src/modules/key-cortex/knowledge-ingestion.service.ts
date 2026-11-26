import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

export const MAX_PG_INT32 = 2_147_483_647;

export interface IngestTextInput {
  businessId: string;
  title: string;
  sourceType: 'url' | 'document' | 'text';
  sourceUrl?: string;
  content: string;
}

export interface KnowledgeSourceMetadata {
  id: string;
  title: string;
  sourceType: string;
  status: string;
  createdAt: Date;
}

/**
 * Manages business-scoped external knowledge sources with quarantine-first
 * ingestion, explicit approval before retrieval admission, metadata-only URL
 * registration (no outbound fetch), and bounded metadata listing.
 */
@Injectable()
export class KnowledgeIngestionService {
  private readonly logger = new Logger(KnowledgeIngestionService.name);

  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
  ) {}

  async ingestText(input: IngestTextInput): Promise<string> {
    // Quarantine-first ingestion: supplied material is recorded with provenance
    // and held out of retrieval until explicitly approved via approveSource().
    const source = await this.prisma.client.knowledgeSource.create({
      data: {
        businessId: input.businessId,
        title: input.title,
        sourceType: input.sourceType,
        sourceUrl: input.sourceUrl ?? null,
        content: input.content,
        status: 'quarantined',
      },
    });

    this.logger.log(
      `[ingestText] Quarantined source ${source.id}; no semantic-memory write performed`,
    );
    return source.id;
  }

  async ingestUrl(
    businessId: string,
    url: string,
    title?: string,
  ): Promise<string> {
    // Metadata registration only: never performs an outbound HTTP fetch here.
    const source = await this.prisma.client.knowledgeSource.create({
      data: {
        businessId,
        title: title ?? url,
        sourceType: 'url',
        sourceUrl: url,
        content: '',
        status: 'pending',
      },
    });
    return source.id;
  }

  async approveSource(
    businessId: string,
    sourceId: string,
  ): Promise<{ sourceId: string; status: 'approved' }> {
    const existing = await this.prisma.client.knowledgeSource.findFirst({
      where: { id: sourceId, businessId },
      select: { id: true, status: true },
    });

    if (!existing) {
      throw new NotFoundException('Knowledge source not found');
    }

    if (existing.status === 'approved') {
      return { sourceId: existing.id, status: 'approved' as const };
    }

    if (existing.status !== 'quarantined') {
      throw new ConflictException(
        `Knowledge source in status "${existing.status}" cannot be approved; only quarantined sources may be approved`,
      );
    }

    const updated = await this.prisma.client.knowledgeSource.updateMany({
      where: { id: existing.id, businessId, status: 'quarantined' },
      data: { status: 'approved' },
    });

    if (updated.count === 0) {
      const current = await this.prisma.client.knowledgeSource.findFirst({
        where: { id: existing.id, businessId },
        select: { id: true, status: true },
      });
      if (current?.status === 'approved') {
        return { sourceId: current.id, status: 'approved' as const };
      }
      throw new ConflictException(
        'Knowledge source status changed concurrently and cannot be approved',
      );
    }

    return { sourceId: existing.id, status: 'approved' as const };
  }

  async listSources(
    businessId: string,
    status?: string,
    options: { limit?: number; offset?: number } = {},
  ): Promise<KnowledgeSourceMetadata[]> {
    const rawLimit = Number.isFinite(options.limit)
      ? Math.trunc(options.limit!)
      : 50;
    const rawOffset = Number.isFinite(options.offset)
      ? Math.trunc(options.offset!)
      : 0;
    const limit = Math.min(Math.max(rawLimit, 1), 100);
    const offset = Math.min(Math.max(rawOffset, 0), MAX_PG_INT32);
    return this.prisma.client.knowledgeSource.findMany({
      where: { businessId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
      select: {
        id: true,
        title: true,
        sourceType: true,
        status: true,
        createdAt: true,
      },
    });
  }
}
