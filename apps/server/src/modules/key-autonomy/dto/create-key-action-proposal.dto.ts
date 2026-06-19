import { IsArray, IsIn, IsObject, IsOptional, IsString } from 'class-validator';
import {
  KEY_ACTION_SOURCE_TYPES,
  KEY_EXECUTABLE_ACTION_TYPES,
  type KeyActionSourceType,
  type KeyExecutableActionType,
} from '../key-action-proposal.types';

export class CreateKeyActionProposalDto {
  @IsIn(KEY_ACTION_SOURCE_TYPES)
  sourceType!: KeyActionSourceType;

  @IsOptional()
  @IsString()
  sourceId?: string;

  @IsOptional()
  @IsString()
  sourceMode?: string;

  @IsString()
  title!: string;

  @IsOptional()
  @IsString()
  summary?: string;

  @IsOptional()
  @IsString()
  rationale?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  evidence?: string[];

  @IsIn(KEY_EXECUTABLE_ACTION_TYPES)
  actionType!: KeyExecutableActionType;

  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;
}
