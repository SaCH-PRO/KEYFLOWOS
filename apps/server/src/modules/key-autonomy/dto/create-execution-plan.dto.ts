import { IsArray, IsIn, IsObject, IsOptional, IsString, IsNumber } from 'class-validator';

export class CreateExecutionPlanDto {
  @IsString()
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsIn(['manual', 'scheduled', 'signal', 'autonomous'])
  triggerType?: string;

  @IsOptional()
  @IsIn(['draft', 'queued', 'running', 'completed', 'failed', 'cancelled'])
  status?: string;

  @IsOptional()
  @IsArray()
  @IsObject({ each: true })
  steps?: Record<string, unknown>[];
}
