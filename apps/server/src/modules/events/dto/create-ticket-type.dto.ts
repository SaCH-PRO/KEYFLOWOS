import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsISO8601,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { sanitize } from '../../../core/utils/sanitize';

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
  @IsISO8601()
  @Type(() => Date)
  salesStartAt?: Date;

  @IsOptional()
  @IsISO8601()
  @Type(() => Date)
  salesEndAt?: Date;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
