import { IsOptional, IsString, IsArray, IsNumber, IsInt, Min, Max } from 'class-validator';

export class CustomerDefinitionDto {
  @IsOptional()
  @IsString()
  targetDemographic?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  ageRangeLow?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  ageRangeHigh?: number;

  @IsOptional()
  @IsString()
  incomeLevel?: string;

  @IsOptional()
  @IsString()
  geographicFocus?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  customerPainPoints?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  acquisitionChannels?: string[];

  @IsOptional()
  @IsString()
  retentionStrategy?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  customerLifetimeValue?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  currentCustomerCount?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  monthlyNewCustomers?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  churnRatePercent?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
