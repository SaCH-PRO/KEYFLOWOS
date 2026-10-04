import { BadRequestException, Body, Controller, Get, Inject, Param, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { KnowledgeIngestionService } from './knowledge-ingestion.service';

const textInput = z.object({
  title: z.string().trim().min(1).max(300),
  content: z.string().min(1).max(2_000_000),
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
    return { sourceId, status: 'processed' as const };
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
  ) {
    return this.knowledge.listSources(businessId, status);
  }
}
