import {
  IsIn,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import {
  TEMPORAL_FLOW_SOURCES,
  type TemporalFlowImportance,
  type TemporalFlowStatus,
  type TemporalFlowVisibility,
} from '../temporal-flow.types';

export class CreateTemporalFlowEventDto {
  @IsOptional()
  @IsString()
  userId?: string;

  @IsIn(TEMPORAL_FLOW_SOURCES)
  source!: string;

  @IsString()
  @MinLength(1)
  type!: string;

  @IsOptional()
  @IsString()
  module?: string;

  @IsOptional()
  @IsString()
  entityType?: string;

  @IsOptional()
  @IsString()
  entityId?: string;

  @IsString()
  @MinLength(1)
  title!: string;

  @IsOptional()
  @IsString()
  summary?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsISO8601()
  startsAt?: string;

  @IsOptional()
  @IsISO8601()
  endsAt?: string;

  @IsOptional()
  @IsISO8601()
  occurredAt?: string;

  @IsOptional()
  @IsIn(['RECORDED', 'ACTION_REQUIRED', 'RESOLVED', 'DISMISSED'])
  status?: TemporalFlowStatus;

  @IsOptional()
  @IsIn(['LOW', 'NORMAL', 'HIGH', 'CRITICAL'])
  importance?: TemporalFlowImportance;

  @IsOptional()
  @IsIn(['USER', 'SYSTEM', 'HIDDEN'])
  visibility?: TemporalFlowVisibility;

  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  signals?: Record<string, unknown>;

  @IsOptional()
  tags?: string[];

  @IsOptional()
  @IsISO8601()
  reminderAt?: string;

  @IsOptional()
  genomeImpactPotential?: boolean;

  @IsOptional()
  @IsString()
  externalId?: string;

  @IsOptional()
  @IsString()
  externalUrl?: string;
}
