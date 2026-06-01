import { IsString, IsOptional, IsInt, IsIn, Min } from 'class-validator';
import { Transform } from 'class-transformer';

const VALID_CATEGORIES = [
  'MONEY', 'TIME', 'PEOPLE', 'WORK', 'SALES', 'MARKETING', 'GOVERNANCE', 'STRATEGY', 'SYSTEM',
];

const VALID_STATUSES = [
  'OPEN', 'IN_PROGRESS', 'WAITING_APPROVAL', 'EXECUTED', 'DISMISSED', 'FAILED', 'COMPLETED',
];

export class ListCommandItemsDto {
  @IsOptional()
  @IsString()
  @IsIn(VALID_STATUSES)
  status?: string;

  @IsOptional()
  @IsString()
  @IsIn(VALID_CATEGORIES)
  category?: string;

  @IsOptional()
  @IsString()
  sourceModule?: string;

  @IsOptional()
  @IsString()
  ownerId?: string;

  @IsOptional()
  @IsString()
  ownerType?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Transform(({ value }) => (value ? parseInt(value, 10) : 25))
  limit?: number = 25;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Transform(({ value }) => (value ? parseInt(value, 10) : 0))
  offset?: number = 0;
}
