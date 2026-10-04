// @keyflow:dormant — registered in key-cortex.module.ts and injected by nothing.
//
// Verified 2026-08-06: zero injection sites repo-wide. Nothing ingests external
// knowledge into semantic memory, so docs/neuro-atlas-code-mapping.md §45
// (Neurodevelopment / Neurogenesis) currently maps to a file rather than to a
// behaviour.
//
// This is roadmap capability with no caller, not a wiring slip — writing the
// driver is the work, and until then the atlas entry overstates what runs.
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

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
  ) {}

  async ingestText(input: IngestTextInput): Promise<string> {
    // Learning Stream Phase A is quarantine-first. Supplied material is recorded
    // with provenance but is NOT embedded into live semantic memory here.
    // Admission into KEY's normal retrieval path is a later governed step.
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

    this.logger.log(`[ingestText] Quarantined source ${source.id}; no semantic-memory write performed`);
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
    options: { limit?: number; offset?: number } = {},
  ): Promise<Array<{ id: string; title: string; sourceType: string; status: string; createdAt: Date }>> {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
    const offset = Math.max(options.offset ?? 0, 0);
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
