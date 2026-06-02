import { IsString, IsOptional, IsInt, IsBoolean, IsDecimal, IsObject, IsIn, Min, Max } from 'class-validator';
import { Transform } from 'class-transformer';
import { sanitize } from '../../../core/utils/sanitize';

const VALID_CATEGORIES = [
  'MONEY', 'TIME', 'PEOPLE', 'WORK', 'SALES', 'MARKETING', 'GOVERNANCE', 'STRATEGY', 'SYSTEM',
];

const VALID_STATUSES = [
  'OPEN', 'IN_PROGRESS', 'WAITING_APPROVAL', 'EXECUTED', 'DISMISSED', 'FAILED', 'COMPLETED',
];

const VALID_RECOMMENDED_BY = ['SYSTEM', 'KEY', 'USER', 'WORKFLOW'];
const VALID_OWNER_TYPES = ['USER', 'ROLE', 'KEY'];

export class CreateCommandItemDto {
  @IsString()
  @Transform(({ value }) => sanitize(value))
  sourceModule!: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => (value ? sanitize(value) : value))
  sourceType?: string;

  @IsOptional()
  @IsString()
  sourceId?: string;

  @IsString()
  @Transform(({ value }) => sanitize(value))
  title!: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => (value ? sanitize(value) : value))
  description?: string;

  @IsString()
  @IsIn(VALID_CATEGORIES)
  category!: string;

  @IsString()
  @Transform(({ value }) => sanitize(value))
  actionType!: string;

  @IsOptional()
  @IsString()
  @IsIn(VALID_STATUSES)
  status?: string = 'OPEN';

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  priority?: number = 50;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  urgency?: number = 50;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  impactScore?: number = 0;

  @IsOptional()
  @IsDecimal()
  expectedValue?: string;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(4)
  riskTier?: number = 1;

  @IsOptional()
  @IsBoolean()
  requiresApproval?: boolean = false;

  @IsOptional()
  @IsBoolean()
  executableByKey?: boolean = false;

  @IsOptional()
  @IsString()
  executionTool?: string;

  @IsOptional()
  @IsObject()
  executionPayload?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @IsIn(VALID_RECOMMENDED_BY)
  recommendedBy?: string;

  @IsOptional()
  @IsString()
  @IsIn(VALID_OWNER_TYPES)
  ownerType?: string;

  @IsOptional()
  @IsString()
  ownerId?: string;

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
  dueAt?: Date;

  @IsOptional()
  snoozedUntil?: Date;
}
