import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { sanitize } from '../../../core/utils/sanitize';

export const EVENT_STATUSES = ['DRAFT', 'PUBLISHED', 'CANCELLED', 'COMPLETED'] as const;

export class CreateEventDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  @Transform(({ value }) => sanitize(value, 255))
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  @Transform(({ value }) => sanitize(value, 5000))
  description?: string;

  @IsISO8601()
  @Type(() => Date)
  startsAt!: Date;

  @IsOptional()
  @IsISO8601()
  @Type(() => Date)
  endsAt?: Date;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(({ value }) => sanitize(value, 100))
  timezone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  @Transform(({ value }) => sanitize(value, 1000))
  location?: string;

  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  @Transform(({ value }) => sanitize(value, 1000))
  coverImageUrl?: string;

  @IsOptional()
  @IsString()
  @IsIn(EVENT_STATUSES)
  status?: string;
}
