import { IsOptional, IsString, IsArray, IsNumber, IsBoolean, IsInt, Min, Max } from 'class-validator';

export class FinanceDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  startupCapital?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  currentCashReserve?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  monthlyBurnRate?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  monthlyFixedCosts?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  monthlyVariableCosts?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  debtTotal?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  fundingRaised?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  fundingSources?: string[];

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  profitMarginPercent?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  runwayMonths?: number;

  @IsOptional()
  @IsBoolean()
  hasAccountant?: boolean;

  @IsOptional()
  @IsBoolean()
  hasBookkeeper?: boolean;

  @IsOptional()
  @IsBoolean()
  taxCompliant?: boolean;

  @IsOptional()
  @IsString()
  notes?: string;
}
