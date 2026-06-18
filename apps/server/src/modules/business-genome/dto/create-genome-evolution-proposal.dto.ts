import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';
import { DNA_SECTION_KEYS, type DnaSectionKey } from '../../blueprint/blueprint.types';

export class CreateGenomeEvolutionProposalDto {
  @IsIn(DNA_SECTION_KEYS)
  section!: DnaSectionKey;

  @IsObject()
  proposedPatch!: Record<string, unknown>;

  @IsString()
  @MinLength(1)
  reason!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  evidence?: string[];

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  confidence?: number;

  @IsOptional()
  @IsString()
  createdBy?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  sourceEventIds?: string[];
}
