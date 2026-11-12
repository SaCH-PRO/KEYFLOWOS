import { BadRequestException } from '@nestjs/common';
import { IsString, IsOptional, IsDateString, IsNumber, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * V1-25-EVT-BUSINESS-FEED: the largest page GET /timeline/businesses/:id/events
 * serves. The cockpit's business feed asks for 50; a larger page is a 400, not
 * an unbounded read of a business's whole Activity table. Paging further back
 * uses `cursor`.
 *
 * V1-84 (SEC-V125-3): the two sibling reads of the same table that take their
 * limit as a bare query string, GET /timeline/businesses/:id/upcoming
 * (timeline.controller.ts) and the legacy GET /api/flows/businesses/:id/activity
 * (flow.controller.ts, still called by fetchActivityFeed in
 * apps/web/src/lib/client.ts), are bounded by the same number through
 * parseTimelineLimit below.
 */
export const TIMELINE_MAX_LIMIT = 200;

/**
 * A `limit` query value of a feed read that does not go through
 * QueryTimelineDto: absent or empty is `fallback`; anything but an integer
 * from 1 to TIMELINE_MAX_LIMIT is a 400, as /events answers (the value is
 * parsed here, not left to a global pipe, so the bound holds wherever the
 * handler is mounted).
 */
export function parseTimelineLimit(raw: unknown, fallback: number): number {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const value = typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(value) || value < 1 || value > TIMELINE_MAX_LIMIT) {
    throw new BadRequestException(`limit must be an integer from 1 to ${TIMELINE_MAX_LIMIT}`);
  }
  return value;
}

export class QueryTimelineDto {
  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  contactId?: string;

  @IsOptional()
  @IsString()
  entityType?: string;

  @IsOptional()
  @IsString()
  entityId?: string;

  @IsOptional()
  @IsString()
  actorType?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  priority?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  // Query values arrive as strings: without @Type the ValidationPipe (no
  // implicit conversion) refused every numeric value, `limit=50` included.
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  minRevenueImpact?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(TIMELINE_MAX_LIMIT)
  limit?: number = 50;

  @IsOptional()
  @IsString()
  cursor?: string;
}
