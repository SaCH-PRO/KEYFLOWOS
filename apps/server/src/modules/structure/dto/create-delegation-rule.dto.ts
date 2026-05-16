import { IsString, IsOptional, IsInt, IsBoolean } from 'class-validator';

export class CreateDelegationRuleDto {
  @IsString()
  delegatorId!: string;

  @IsString()
  delegateId!: string;

  @IsString()
  scope!: string;

  @IsInt()
  maxTier!: number;

  @IsOptional()
  activeUntil?: string;

  @IsOptional()
  @IsString()
  reason?: string;
}
