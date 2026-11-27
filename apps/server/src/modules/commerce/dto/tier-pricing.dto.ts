import { Type } from 'class-transformer';
import {
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsString,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class TierPriceEntryDto {
  @IsString()
  @IsNotEmpty()
  tier!: string;

  @IsNumber()
  @Min(0)
  price!: number;
}

export class SetProductTierPricesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TierPriceEntryDto)
  tierPrices!: TierPriceEntryDto[];
}

export class SetContactPricingTierDto {
  @ValidateIf((o: SetContactPricingTierDto) => o.pricingTier !== null)
  @IsString()
  @IsNotEmpty()
  pricingTier!: string | null;
}
