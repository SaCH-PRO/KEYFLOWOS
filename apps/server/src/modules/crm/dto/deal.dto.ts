import { Transform } from 'class-transformer';
import { IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { sanitize } from '../../../core/utils/sanitize';

export class CreateDealDto {
  @IsString() @MaxLength(200) @Transform(({ value }) => sanitize(value))
  title!: string;

  @IsString()
  contactId!: string;

  @IsString() @IsOptional() @MaxLength(2000) @Transform(({ value }) => sanitize(value))
  description?: string;

  @IsString() @IsOptional() @MaxLength(200) @Transform(({ value }) => sanitize(value))
  companyName?: string;

  @IsNumber() @IsOptional() @Min(0)
  value?: number;

  @IsString() @IsOptional() @MaxLength(10)
  currency?: string;

  @IsString() @IsOptional()
  stageId?: string;

  @IsString() @IsOptional()
  ownerUserId?: string | null;

  @IsString() @IsOptional() @MaxLength(100)
  source?: string;

  @IsString() @IsOptional() @MaxLength(200)
  sourceDetail?: string;

  @IsArray() @IsOptional()
  tags?: string[];

  @IsString() @IsOptional() @MaxLength(5000) @Transform(({ value }) => sanitize(value))
  notes?: string;

  @IsDateString() @IsOptional()
  expectedCloseAt?: string;

  @IsInt() @IsOptional() @Min(0) @Max(100)
  probability?: number;
}

export class UpdateDealDto {
  @IsString() @IsOptional() @MaxLength(200) @Transform(({ value }) => sanitize(value))
  title?: string;

  @IsString() @IsOptional() @MaxLength(2000) @Transform(({ value }) => sanitize(value))
  description?: string | null;

  @IsString() @IsOptional() @MaxLength(200) @Transform(({ value }) => sanitize(value))
  companyName?: string | null;

  @IsNumber() @IsOptional() @Min(0)
  value?: number | null;

  @IsString() @IsOptional() @MaxLength(10)
  currency?: string;

  @IsString() @IsOptional()
  ownerUserId?: string | null;

  @IsString() @IsOptional() @MaxLength(100)
  source?: string | null;

  @IsString() @IsOptional() @MaxLength(200)
  sourceDetail?: string | null;

  @IsArray() @IsOptional()
  tags?: string[];

  @IsString() @IsOptional() @MaxLength(5000) @Transform(({ value }) => sanitize(value))
  notes?: string | null;

  @IsDateString() @IsOptional()
  expectedCloseAt?: string | null;

  @IsInt() @IsOptional() @Min(0) @Max(100)
  probability?: number | null;
}

export class CreateDealStageDto {
  @IsString() @MaxLength(100) @Transform(({ value }) => sanitize(value))
  name!: string;

  @IsString() @IsOptional() @MaxLength(100)
  slug?: string;

  @IsString() @IsOptional() @MaxLength(20)
  color?: string;

  @IsString() @IsOptional() @IsIn(['OPEN', 'WON', 'LOST'])
  category?: 'OPEN' | 'WON' | 'LOST';

  @IsInt() @IsOptional()
  position?: number;
}

export class UpdateDealStageDto {
  @IsString() @IsOptional() @MaxLength(100) @Transform(({ value }) => sanitize(value))
  name?: string;

  @IsString() @IsOptional() @MaxLength(20)
  color?: string;

  @IsString() @IsOptional() @IsIn(['OPEN', 'WON', 'LOST'])
  category?: 'OPEN' | 'WON' | 'LOST';

  @IsInt() @IsOptional()
  position?: number;

  @IsBoolean() @IsOptional()
  archived?: boolean;
}

export class BulkMoveStageDto {
  @IsArray()
  dealIds!: string[];

  @IsString()
  stageId!: string;
}

export class WinDealDto {
  @IsDateString() @IsOptional()
  wonAt?: string;

  @IsNumber() @IsOptional() @Min(0)
  actualValue?: number;
}

export class LoseDealDto {
  @IsString() @IsOptional() @MaxLength(500) @Transform(({ value }) => sanitize(value))
  lossReason?: string;

  @IsDateString() @IsOptional()
  lostAt?: string;
}
