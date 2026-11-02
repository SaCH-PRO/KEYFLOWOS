import { IsString, IsOptional, IsDateString, IsNumber, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * V1-25-EVT-BUSINESS-FEED: the largest page GET /timeline/businesses/:id/events
 * serves. The cockpit's business feed asks for 50; a larger page is a 400, not
 * an unbounded read of a business's whole Activity table. Paging further back
 * uses `cursor`.
 */
export const TIMELINE_MAX_LIMIT = 200;

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
