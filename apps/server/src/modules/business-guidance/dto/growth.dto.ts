import { IsOptional, IsString, IsArray, IsNumber, IsInt, IsBoolean, Min, Max } from 'class-validator';

export class GrowthDto {
  @IsOptional()
  @IsString()
  growthStage?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  marketingChannels?: string[];

  @IsOptional()
  @IsNumber()
  @Min(0)
  marketingBudget?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  customerAcquisitionCost?: number;

  @IsOptional()
  @IsString()
  brandAwareness?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  competitorCount?: number;

  @IsOptional()
  @IsString()
  competitiveAdvantage?: string;

  @IsOptional()
  @IsString()
  marketSize?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  marketSharePercent?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  partnershipCount?: number;

  @IsOptional()
  @IsBoolean()
  referralProgram?: boolean;

  @IsOptional()
  @IsString()
  notes?: string;
}
