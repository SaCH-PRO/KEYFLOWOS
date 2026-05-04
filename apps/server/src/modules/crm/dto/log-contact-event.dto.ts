import { IsIn, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { CONTACT_EVENT_TYPES } from '@keyflow/shared';
import { sanitize } from '../../../core/utils/sanitize';

export class LogContactEventDto {
  @IsString()
  @IsIn([...CONTACT_EVENT_TYPES])
  type!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @Transform(({ value }) => (typeof value === 'string' ? sanitize(value) : value))
  description?: string;

  @IsOptional()
  @IsObject()
  data?: Record<string, unknown>;
}
