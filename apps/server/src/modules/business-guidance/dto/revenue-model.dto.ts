import { IsOptional, IsString, IsArray, IsNumber, IsBoolean, IsDateString, Min, Max } from 'class-validator';

export class RevenueModelDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  monthlyRevenue?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  annualRevenue?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  revenueStreams?: string[];

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  recurringPercent?: number;

  @IsOptional()
  @IsBoolean()
  seasonalVariation?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  peakMonths?: string[];

  @IsOptional()
  @IsNumber()
  @Min(0)
  averageOrderValue?: number;

  @IsOptional()
  @IsNumber()
  revenueGrowthRate?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  targetMonthlyRevenue?: number;

  @IsOptional()
  @IsDateString()
  breakEvenDate?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
