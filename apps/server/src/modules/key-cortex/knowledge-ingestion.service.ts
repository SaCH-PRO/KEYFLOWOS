import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { SemanticMemoryService } from '../ai/semantic-memory.service';

export interface IngestTextInput {
  businessId: string;
  title: string;
  sourceType: 'url' | 'document' | 'text';
  sourceUrl?: string;
  content: string;
}

/**
 * Ingests external knowledge (best practices, research, regulations) into
 * KEY's semantic memory and knowledge source ledger.
 *
 * Foundation implementation: stores the source, chunks the text, and indexes
 * each chunk via SemanticMemoryService. Future iterations will summarize,
 * link to Genome facts, and propose constitution amendments.
 */
@Injectable()
export class KnowledgeIngestionService {
  private readonly logger = new Logger(KnowledgeIngestionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly semanticMemory: SemanticMemoryService,
  ) {}

  async ingestText(input: IngestTextInput): Promise<string> {
    const source = await this.prisma.client.knowledgeSource.create({
      data: {
        businessId: input.businessId,
        title: input.title,
        sourceType: input.sourceType,
        sourceUrl: input.sourceUrl ?? null,
        content: input.content,
        status: 'pending',
      },
    });

    const chunks = this.chunkText(input.content, 2000);
    for (let i = 0; i < chunks.length; i++) {
      await this.semanticMemory.store({
        businessId: input.businessId,
        content: `[${input.title} chunk ${i + 1}/${chunks.length}]\n${chunks[i]}`,
        sourceType: 'document',
        sourceId: `${source.id}:${i}`,
        metadata: {
          knowledgeSourceId: source.id,
          title: input.title,
          sourceType: input.sourceType,
          chunkIndex: i,
        },
      });
    }

    await this.prisma.client.knowledgeSource.update({
      where: { id: source.id },
      data: { status: 'processed' },
    });

    this.logger.log(`[ingestText] Processed ${chunks.length} chunk(s) for ${source.id}`);
    return source.id;
  }

  async ingestUrl(businessId: string, url: string, _title?: string): Promise<string> {
    // Foundation: we do not fetch external URLs automatically in this pass.
    // The source is recorded so a worker or follow-up can fetch it safely.
    const source = await this.prisma.client.knowledgeSource.create({
      data: {
        businessId,
        title: _title ?? url,
        sourceType: 'url',
        sourceUrl: url,
        content: '',
        status: 'pending',
      },
    });
    return source.id;
  }

  async listSources(
    businessId: string,
    status?: string,
  ): Promise<Array<{ id: string; title: string; sourceType: string; status: string; createdAt: Date }>> {
    const rows = await this.prisma.client.knowledgeSource.findMany({
      where: { businessId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
    });

    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      sourceType: r.sourceType,
      status: r.status,
      createdAt: r.createdAt,
    }));
  }

  private chunkText(text: string, maxChars: number): string[] {
    const chunks: string[] = [];
    let start = 0;
    while (start < text.length) {
      chunks.push(text.slice(start, start + maxChars));
      start += maxChars;
    }
    return chunks;
  }
}
