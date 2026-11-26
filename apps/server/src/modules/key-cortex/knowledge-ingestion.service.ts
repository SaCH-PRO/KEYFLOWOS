import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

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

    if (existing.status !== 'approved') {
      await this.prisma.client.knowledgeSource.update({
        where: { id: existing.id },
        data: { status: 'approved' },
      });
    }

    return { sourceId: existing.id, status: 'approved' as const };
  }

  async listSources(
    businessId: string,
    status?: string,
    options: { limit?: number; offset?: number } = {},
  ): Promise<KnowledgeSourceMetadata[]> {
    const limit = Math.min(Math.max(Math.trunc(options.limit ?? 50), 1), 100);
    const offset = Math.max(Math.trunc(options.offset ?? 0), 0);
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
