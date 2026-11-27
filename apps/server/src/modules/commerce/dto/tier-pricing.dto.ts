import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsString,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { MAX_DOCUMENT_AMOUNT } from './document-line-item.dto';
import { PRICING_TIERS } from '../pricing.service';

export class TierPriceEntryDto {
  @IsString()
  @IsNotEmpty()
  tier!: string;

  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(MAX_DOCUMENT_AMOUNT)
  price!: number;
}

export class SetProductTierPricesDto {
  @IsArray()
  @ArrayMaxSize(PRICING_TIERS.length)
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
