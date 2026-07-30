import {
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { DNA_SECTION_KEYS, type DnaSectionKey } from '../../blueprint/blueprint.types';

export class ApplyUpdatesDto {
  @IsIn(DNA_SECTION_KEYS)
  section!: DnaSectionKey;

  @IsObject()
  data!: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  messageId?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  confidence?: number;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  source?: string;
}
