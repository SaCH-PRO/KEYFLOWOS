import { IsNumber, IsString, Min, MinLength } from 'class-validator';

export class SetProductTierPriceDto {
  /** Tier name, e.g. "WHOLESALE". RETAIL is rejected (retail lives on the product). */
  @IsString()
  @MinLength(1)
  tier!: string;

  @IsNumber()
  @Min(0)
  price!: number;
}

export class SetContactPricingTierDto {
  /** Tier name to assign to the contact, e.g. "WHOLESALE" or "RETAIL". */
  @IsString()
  @MinLength(1)
  tier!: string;
}
