import { IsOptional, IsString, IsArray, IsNumber, Min, Max } from 'class-validator';

export class OfferDefinitionDto {
  @IsOptional()
  @IsString()
  primaryOffer?: string;

  @IsOptional()
  @IsString()
  offerType?: string;

  @IsOptional()
  @IsString()
  valueProposition?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  differentiators?: string[];

  @IsOptional()
  @IsString()
  pricingModel?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  priceRangeLow?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  priceRangeHigh?: number;

  @IsOptional()
  @IsString()
  deliveryMethod?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  productionCost?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  marginPercent?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
