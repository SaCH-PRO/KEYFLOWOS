import { IsString, IsOptional, IsInt, IsBoolean } from 'class-validator';

export class UpdateDelegationRuleDto {
  @IsOptional()
  @IsString()
  delegatorId?: string;

  @IsOptional()
  @IsString()
  delegateId?: string;

  @IsOptional()
  @IsString()
  scope?: string;

  @IsOptional()
  @IsInt()
  maxTier?: number;

  @IsOptional()
  activeUntil?: string;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
