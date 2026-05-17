import { IsObject, IsOptional, IsArray, IsString, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class StoreSettingsDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  currency?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  timezone?: string;
}

class ContactOptionDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  type?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  value?: string;
}

class MerchandisingDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  featuredItemIds?: string[];
}

export class UpdateStorefrontConfigDto {
  @IsOptional()
  @IsArray()
  sections?: unknown[];

  @IsOptional()
  @IsArray()
  faqEntries?: unknown[];

  @IsOptional()
  @IsObject()
  policies?: Record<string, unknown>;

  @IsOptional()
  @ValidateNested()
  @Type(() => StoreSettingsDto)
  storeSettings?: StoreSettingsDto;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ContactOptionDto)
  contactOptions?: ContactOptionDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => MerchandisingDto)
  merchandising?: MerchandisingDto;

  [key: string]: unknown;
}
