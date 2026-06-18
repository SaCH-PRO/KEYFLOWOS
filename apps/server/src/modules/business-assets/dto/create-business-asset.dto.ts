import { IsIn, IsOptional, IsString, IsUrl, IsISO8601, IsObject, MinLength } from 'class-validator';

export const BUSINESS_ASSET_TYPES = [
  'DOMAIN',
  'WEBSITE',
  'SOCIAL',
  'BANK',
  'PAYMENT_PROCESSOR',
  'LICENSE',
  'EQUIPMENT',
  'CONTRACT',
  'BRAND_ASSET',
  'SOFTWARE',
] as const;

export type BusinessAssetType = (typeof BUSINESS_ASSET_TYPES)[number];

export const BUSINESS_ASSET_STATUSES = ['ACTIVE', 'PENDING', 'EXPIRED', 'ARCHIVED'] as const;

export class CreateBusinessAssetDto {
  @IsIn(BUSINESS_ASSET_TYPES)
  type!: BusinessAssetType;

  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsIn(BUSINESS_ASSET_STATUSES)
  status?: string;

  @IsOptional()
  @IsString()
  provider?: string;

  @IsOptional()
  @IsUrl()
  url?: string;

  @IsOptional()
  @IsString()
  identifier?: string;

  @IsOptional()
  @IsString()
  owner?: string;

  @IsOptional()
  @IsISO8601()
  expiresAt?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
