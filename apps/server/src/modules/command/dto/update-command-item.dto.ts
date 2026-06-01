import { IsString, IsOptional, IsInt, IsBoolean, IsObject, IsIn, Min, Max } from 'class-validator';
import { Transform } from 'class-transformer';
import { sanitize } from '../../../core/utils/sanitize';

const VALID_STATUSES = [
  'OPEN', 'IN_PROGRESS', 'WAITING_APPROVAL', 'EXECUTED', 'DISMISSED', 'FAILED', 'COMPLETED',
];

const VALID_OWNER_TYPES = ['USER', 'ROLE', 'KEY'];

export class UpdateCommandItemDto {
  @IsOptional()
  @IsString()
  @Transform(({ value }) => sanitize(value))
  title?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => (value ? sanitize(value) : value))
  description?: string;

  @IsOptional()
  @IsString()
  @IsIn(VALID_STATUSES)
  status?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  priority?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  urgency?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  impactScore?: number;

  @IsOptional()
  @IsBoolean()
  requiresApproval?: boolean;

  @IsOptional()
  @IsBoolean()
  executableByKey?: boolean;

  @IsOptional()
  @IsString()
  executionTool?: string;

  @IsOptional()
  @IsObject()
  executionPayload?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @IsIn(VALID_OWNER_TYPES)
  ownerType?: string;

  @IsOptional()
  @IsString()
  ownerId?: string;

  @IsOptional()
  dueAt?: Date;

  @IsOptional()
  snoozedUntil?: Date;

  @IsOptional()
  completedAt?: Date;

  @IsOptional()
  dismissedAt?: Date;
}
