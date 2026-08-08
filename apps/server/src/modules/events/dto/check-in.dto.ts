import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { sanitize } from '../../../core/utils/sanitize';

export class CheckInDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Transform(({ value }) => sanitize(value, 255))
  checkedInBy?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  @Transform(({ value }) => sanitize(value, 1000))
  notes?: string;
}
