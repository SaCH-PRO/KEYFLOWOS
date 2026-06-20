import { IsBoolean, IsIn, IsISO8601, IsOptional, IsString } from 'class-validator';

export class GenerateKeyInboxIntelligenceDto {
  @IsString()
  @IsIn(['DAILY', 'WEEKLY', 'MONTHLY', 'CUSTOM'])
  scope!: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'CUSTOM';

  @IsOptional()
  @IsISO8601()
  start?: string;

  @IsOptional()
  @IsISO8601()
  end?: string;

  @IsOptional()
  @IsBoolean()
  forceRegenerate?: boolean;
}
