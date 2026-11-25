import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { sanitize } from '../../../core/utils/sanitize';
import { IsIsoDate } from './iso-date.decorator';

export class CreateTicketTypeDto {
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

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  price!: number;

  @IsOptional()
  @IsString()
  @MaxLength(3)
  @Transform(({ value }) => sanitize(value, 3))
  currency?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  quantity?: number;

  @IsOptional()
  @IsIsoDate()
  salesStartAt?: Date;

  @IsOptional()
  @IsIsoDate()
  salesEndAt?: Date;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
