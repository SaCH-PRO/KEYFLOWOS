import { IsOptional, IsString, IsIn, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';

const ENTITY_TYPES = ['contact', 'thread', 'channel', 'business'] as const;
const MEMORY_TYPES = ['summary', 'pattern', 'insight', 'recommendation'] as const;

export class TemporalFlowMemoryQueryDto {
  @IsOptional()
  @IsIn(ENTITY_TYPES)
  entityType?: (typeof ENTITY_TYPES)[number];

  @IsOptional()
  @IsString()
  entityId?: string;

  @IsOptional()
  @IsIn(MEMORY_TYPES)
  type?: (typeof MEMORY_TYPES)[number];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}
