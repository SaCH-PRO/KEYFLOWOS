import { IsString, IsOptional, IsBoolean, IsObject, IsIn } from 'class-validator';

const SEVERITIES = ['INFO', 'WARN', 'CRITICAL'] as const;

export class CreateBusinessRuleDto {
  @IsString() name!: string;
  @IsString() @IsOptional() description?: string;
  @IsString() module!: string;
  @IsString() triggerType!: string;
  @IsObject() condition!: Record<string, unknown>;
  @IsObject() action!: Record<string, unknown>;
  @IsIn(SEVERITIES) @IsOptional() severity?: string;
  @IsBoolean() @IsOptional() enabled?: boolean;
}

export class UpdateBusinessRuleDto {
  @IsString() @IsOptional() name?: string;
  @IsString() @IsOptional() description?: string;
  @IsString() @IsOptional() module?: string;
  @IsString() @IsOptional() triggerType?: string;
  @IsObject() @IsOptional() condition?: Record<string, unknown>;
  @IsObject() @IsOptional() action?: Record<string, unknown>;
  @IsIn(SEVERITIES) @IsOptional() severity?: string;
  @IsBoolean() @IsOptional() enabled?: boolean;
}
