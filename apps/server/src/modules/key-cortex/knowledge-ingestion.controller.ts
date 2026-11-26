import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { ModuleScopeGuard, RequireModuleScope } from '../../core/auth/module-scope.guard';
import { KnowledgeIngestionService } from './knowledge-ingestion.service';

export const MAX_SYNC_TEXT_BYTES = 64 * 1024;
export const MAX_URL_LENGTH = 4_096;

const ALLOWED_STATUSES = new Set([
  'pending',
  'quarantined',
  'approved',
  'processed',
  'failed',
]);

export const httpUrlSchema = z
  .string()
  .max(MAX_URL_LENGTH)
  .refine((value) => {
    try {
      const parsed = new URL(value);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }, 'URL must be a valid http or https URL');

export const textInputSchema = z.object({
  title: z.string().trim().min(1).max(300),
  content: z
    .string()
    .min(1)
    .refine(
      (value) => Buffer.byteLength(value, 'utf8') <= MAX_SYNC_TEXT_BYTES,
      'content exceeds the 64 KiB synchronous ingestion limit',
    ),
  sourceUrl: httpUrlSchema.optional(),
});

export const urlInputSchema = z.object({
  url: httpUrlSchema,
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

function parseStrictInt(raw: string): number {
  const trimmed = raw.trim();
  if (!/^-?\d+$/.test(trimmed)) return Number.NaN;
  return Number(trimmed);
}

/**
 * Module-scoped read/write surface for KnowledgeIngestionService.
 *
 * Important boundaries:
 * - Text uploads are stored quarantine-first (`status: 'quarantined'`) and are
 *   NOT admitted to `cortex.search_knowledge` until explicitly approved.
 * - URL registration stores metadata only (`status: 'pending'`) and NEVER
 *   performs an outbound HTTP fetch (zero SSRF).
 * - Listing returns bounded metadata only and never materializes `content`.
 */
@Controller('api/v1/cortex/businesses/:businessId/knowledge')
@UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
export class KnowledgeIngestionController {
  constructor(
    @Inject(KnowledgeIngestionService)
    private readonly knowledge: KnowledgeIngestionService,
  ) {}

  @Post('text')
  @RequireModuleScope('ai', 'write')
  async ingestText(
    @Param('businessId') businessId: string,
    @Body() body: unknown,
  ) {
    const input = parse(textInputSchema, body);
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
  @RequireModuleScope('ai', 'write')
  async registerUrl(
    @Param('businessId') businessId: string,
    @Body() body: unknown,
  ) {
    const input = parse(urlInputSchema, body);
    const sourceId = await this.knowledge.ingestUrl(
      businessId,
      input.url,
      input.title,
    );
    return {
      sourceId,
      status: 'pending' as const,
      acquisition: 'NOT_FETCHED' as const,
    };
  }

  @Post(':sourceId/approve')
  @RequireModuleScope('ai', 'write')
  async approveSource(
    @Param('businessId') businessId: string,
    @Param('sourceId') sourceId: string,
  ) {
    return this.knowledge.approveSource(businessId, sourceId);
  }

  @Get()
  @RequireModuleScope('ai', 'read')
  list(
    @Param('businessId') businessId: string,
    @Query('status') status?: string,
    @Query('limit') limitRaw?: string,
    @Query('offset') offsetRaw?: string,
  ) {
    if (status !== undefined && !ALLOWED_STATUSES.has(status)) {
      throw new BadRequestException({
        code: 'KNOWLEDGE_SOURCE_STATUS_INVALID',
        message: 'status must be one of pending, quarantined, approved, processed, or failed',
      });
    }

    const limit = limitRaw === undefined ? 50 : parseStrictInt(limitRaw);
    const offset = offsetRaw === undefined ? 0 : parseStrictInt(offsetRaw);
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      !Number.isInteger(offset) ||
      offset < 0
    ) {
      throw new BadRequestException({
        code: 'KNOWLEDGE_SOURCE_PAGE_INVALID',
        message: 'limit must be an integer from 1 to 100 and offset must be a non-negative integer',
      });
    }

    return this.knowledge.listSources(businessId, status, { limit, offset });
  }
}
