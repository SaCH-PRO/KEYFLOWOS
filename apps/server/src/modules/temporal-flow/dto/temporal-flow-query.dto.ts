import { IsIn, IsISO8601, IsNumberString, IsOptional, IsString } from 'class-validator';

export class TemporalFlowQueryDto {
  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsString()
  module?: string;

  @IsOptional()
  @IsIn(['RECORDED', 'ACTION_REQUIRED', 'RESOLVED', 'DISMISSED'])
  status?: string;

  @IsOptional()
  @IsIn(['LOW', 'NORMAL', 'HIGH', 'CRITICAL'])
  importance?: string;

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;

  @IsOptional()
  @IsNumberString()
  limit?: string;
}
