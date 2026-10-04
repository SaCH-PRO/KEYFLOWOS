import { BadRequestException, Body, Controller, Get, Inject, Param, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { KnowledgeIngestionService } from './knowledge-ingestion.service';

const MAX_SYNC_TEXT_BYTES = 64 * 1024;

const textInput = z.object({
  title: z.string().trim().min(1).max(300),
  content: z.string().min(1).refine(
    (value) => Buffer.byteLength(value, 'utf8') <= MAX_SYNC_TEXT_BYTES,
    'content exceeds the 64 KiB synchronous ingestion limit',
  ),
  sourceUrl: z.string().url().optional(),
});

const urlInput = z.object({
  url: z.string().url().max(4_096),
  title: z.string().trim().min(1).max(300).optional(),
});

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new BadRequestException({
      code: 'KNOWLEDGE_INGESTION_INPUT_INVALID',
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }
  return result.data;
}

/**
 * Reachable read/write surface for the existing KnowledgeIngestionService.
 *
 * Important boundary: URL registration does NOT fetch the URL. This controller
 * only makes the already-existing ingestion capability reachable through an
 * authenticated, business-scoped path. Network acquisition belongs to the
 * later governed Learning Stream receptor layer.
 */
@Controller('api/v1/cortex/businesses/:businessId/knowledge')
@UseGuards(AuthGuard, BusinessGuard)
export class KnowledgeIngestionController {
  constructor(
    @Inject(KnowledgeIngestionService)
    private readonly knowledge: KnowledgeIngestionService,
  ) {}

  @Post('text')
  async ingestText(
    @Param('businessId') businessId: string,
    @Body() body: unknown,
  ) {
    const input = parse(textInput, body);
    const sourceId = await this.knowledge.ingestText({
      businessId,
      title: input.title,
      content: input.content,
      sourceUrl: input.sourceUrl,
      sourceType: input.sourceUrl ? 'url' : 'text',
    });
    return {
      sourceId,
      status: 'quarantined' as const,
      retrieval: 'NOT_ADMITTED' as const,
    };
  }

  @Post('url')
  async registerUrl(
    @Param('businessId') businessId: string,
    @Body() body: unknown,
  ) {
    const input = parse(urlInput, body);
    const sourceId = await this.knowledge.ingestUrl(businessId, input.url, input.title);
    return {
      sourceId,
      status: 'pending' as const,
      acquisition: 'NOT_FETCHED' as const,
    };
  }

  @Get()
  list(
    @Param('businessId') businessId: string,
    @Query('status') status?: string,
    @Query('limit') limitRaw?: string,
    @Query('offset') offsetRaw?: string,
  ) {
    const limit = limitRaw === undefined ? 50 : Number(limitRaw);
    const offset = offsetRaw === undefined ? 0 : Number(offsetRaw);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0) {
      throw new BadRequestException({
        code: 'KNOWLEDGE_SOURCE_PAGE_INVALID',
        message: 'limit must be an integer from 1 to 100 and offset must be a non-negative integer',
      });
    }
    return this.knowledge.listSources(businessId, status, { limit, offset });
  }
}
